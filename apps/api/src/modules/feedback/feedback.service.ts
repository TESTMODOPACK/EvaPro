import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckIn, CheckInStatus } from './entities/checkin.entity';
import { QuickFeedback, Sentiment } from './entities/quick-feedback.entity';
import { MeetingLocation } from './entities/meeting-location.entity';
import { CreateCheckInDto, UpdateCheckInDto, RejectCheckInDto } from './dto/create-checkin.dto';
import { CreateQuickFeedbackDto } from './dto/create-quick-feedback.dto';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { Resend } from 'resend';

@Injectable()
export class FeedbackService {
  private resend: Resend | null = null;

  constructor(
    @InjectRepository(CheckIn)
    private readonly checkInRepo: Repository<CheckIn>,
    @InjectRepository(QuickFeedback)
    private readonly quickFeedbackRepo: Repository<QuickFeedback>,
    @InjectRepository(MeetingLocation)
    private readonly locationRepo: Repository<MeetingLocation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
  }

  // ─── Check-ins ────────────────────────────────────────────────────────────

  async createCheckIn(tenantId: string, managerId: string, role: string, dto: CreateCheckInDto): Promise<CheckIn> {
    // Managers can only create check-ins with their direct reports
    // Admins (super_admin, tenant_admin) are exempt from this restriction
    if (role === 'manager') {
      const employee = await this.userRepo.findOne({
        where: { id: dto.employeeId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!employee) {
        throw new NotFoundException('Colaborador no encontrado');
      }
      if (employee.managerId !== managerId) {
        throw new ForbiddenException(
          'Solo puedes crear check-ins con tus reportes directos',
        );
      }
    }

    const ci = this.checkInRepo.create({
      tenantId,
      managerId,
      employeeId: dto.employeeId,
      scheduledDate: new Date(dto.scheduledDate),
      scheduledTime: dto.scheduledTime || null,
      locationId: dto.locationId || null,
      topic: dto.topic,
      notes: dto.notes,
      actionItems: [],
      agendaTopics: [],
      developmentPlanId: dto.developmentPlanId || null,
      status: CheckInStatus.SCHEDULED,
    } as Partial<CheckIn>);
    const saved = await this.checkInRepo.save(ci as CheckIn);

    // Send email invitation if Resend is configured
    await this.sendCheckInInvitation(saved as CheckIn, tenantId);

    // Create in-app notification for employee
    const manager = await this.userRepo.findOne({ where: { id: managerId }, select: ['id', 'firstName', 'lastName'] });
    const managerName = manager ? `${manager.firstName} ${manager.lastName}` : 'Tu encargado';
    await this.notificationsService.create({
      tenantId,
      userId: dto.employeeId,
      type: NotificationType.CHECKIN_SCHEDULED,
      title: 'Nuevo check-in programado',
      message: `${managerName} ha programado un check-in contigo: "${dto.topic}"`,
      metadata: { checkInId: (saved as CheckIn).id },
    }).catch(() => {}); // non-blocking

    return saved as CheckIn;
  }

  async updateCheckIn(tenantId: string, id: string, dto: UpdateCheckInDto): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (dto.topic !== undefined) ci.topic = dto.topic;
    if (dto.notes !== undefined) ci.notes = dto.notes;
    if (dto.scheduledTime !== undefined) ci.scheduledTime = dto.scheduledTime;
    if (dto.locationId !== undefined) ci.locationId = dto.locationId;
    if (dto.actionItems !== undefined) ci.actionItems = dto.actionItems;
    return this.checkInRepo.save(ci);
  }

  async addTopicToCheckIn(tenantId: string, checkInId: string, userId: string, text: string): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id: checkInId, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (ci.status !== CheckInStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden agregar temas a check-ins programados');
    }
    // Validate user is participant (manager or employee)
    if (ci.managerId !== userId && ci.employeeId !== userId) {
      throw new ForbiddenException('Solo los participantes pueden agregar temas');
    }
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'firstName', 'lastName'] });
    const topics = ci.agendaTopics || [];
    topics.push({
      text,
      addedBy: userId,
      addedByName: user ? `${user.firstName} ${user.lastName}` : undefined,
      addedAt: new Date().toISOString(),
    });
    ci.agendaTopics = topics;
    return this.checkInRepo.save(ci);
  }

  async completeCheckIn(tenantId: string, id: string, userId?: string): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (ci.status !== CheckInStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden completar check-ins programados');
    }
    if (userId && ci.managerId !== userId && ci.employeeId !== userId) {
      throw new ForbiddenException('Solo los participantes pueden completar este check-in');
    }
    ci.status = CheckInStatus.COMPLETED;
    ci.completedAt = new Date();
    return this.checkInRepo.save(ci);
  }

  async findCheckIns(tenantId: string, userId: string, role: string): Promise<CheckIn[]> {
    const where = role === 'manager' || role === 'tenant_admin'
      ? [{ tenantId, managerId: userId }, { tenantId, employeeId: userId }]
      : [{ tenantId, employeeId: userId }];
    return this.checkInRepo.find({
      where,
      relations: ['manager', 'employee', 'location', 'developmentPlan'],
      order: { scheduledDate: 'DESC' },
    });
  }

  // ─── Check-in Rejection ──────────────────────────────────────────────────

  async rejectCheckIn(tenantId: string, checkInId: string, userId: string, dto: RejectCheckInDto): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({
      where: { id: checkInId, tenantId },
      relations: ['manager', 'employee'],
    });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (ci.employeeId !== userId) {
      throw new ForbiddenException('Solo el colaborador asignado puede rechazar este check-in');
    }
    if (ci.status !== CheckInStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden rechazar check-ins programados');
    }
    ci.status = CheckInStatus.REJECTED;
    ci.rejectionReason = dto.reason;
    ci.rejectedBy = userId;
    const saved = await this.checkInRepo.save(ci);

    // Create in-app notification for manager
    const employeeName = ci.employee ? `${ci.employee.firstName} ${ci.employee.lastName}` : 'El colaborador';
    await this.notificationsService.create({
      tenantId,
      userId: ci.managerId,
      type: NotificationType.CHECKIN_REJECTED,
      title: 'Check-in rechazado',
      message: `${employeeName} ha rechazado el check-in "${ci.topic}". Motivo: ${dto.reason}`,
      metadata: { checkInId: ci.id },
    }).catch(() => {});

    // Send rejection email to manager if Resend configured
    if (this.resend && ci.manager?.email) {
      try {
        await this.resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'EvaPro <onboarding@resend.dev>',
          to: ci.manager.email,
          subject: `Check-in rechazado: ${ci.topic}`,
          html: `<p><strong>${ci.employee.firstName} ${ci.employee.lastName}</strong> ha rechazado el check-in programado para el ${new Date(ci.scheduledDate).toLocaleDateString('es-CL')}${ci.scheduledTime ? ' a las ' + ci.scheduledTime : ''}.</p><p><strong>Motivo:</strong> ${dto.reason}</p><p style="color:#64748b;font-size:12px;">— EvaPro</p>`,
        });
      } catch (e) {
        console.error('[Resend] Error sending rejection email:', e);
      }
    }

    return saved;
  }

  // ─── Email Invitation ──────────────────────────────────────────────────

  private async sendCheckInInvitation(checkIn: CheckIn, tenantId: string): Promise<void> {
    const employee = await this.userRepo.findOne({ where: { id: checkIn.employeeId } });
    const manager = await this.userRepo.findOne({ where: { id: checkIn.managerId } });
    if (!employee || !manager) return;

    let locationName = '';
    if (checkIn.locationId) {
      const loc = await this.locationRepo.findOne({ where: { id: checkIn.locationId } });
      locationName = loc ? loc.name + (loc.address ? ` (${loc.address})` : '') : '';
    }

    // Generate .ics (iCalendar) content
    const schedDate = new Date(checkIn.scheduledDate);
    const dateStr = schedDate.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = checkIn.scheduledTime ? checkIn.scheduledTime.replace(':', '') + '00' : '090000';

    // Handle end time with midnight overflow (e.g., 23:30 → next day 00:30)
    const startH = checkIn.scheduledTime ? parseInt(checkIn.scheduledTime.split(':')[0]) : 9;
    const startM = checkIn.scheduledTime ? checkIn.scheduledTime.split(':')[1] : '00';
    const endH = (startH + 1) % 24;
    let endDateStr = dateStr;
    if (endH < startH) {
      // Rolled over midnight — advance date by 1 day
      const nextDay = new Date(schedDate);
      nextDay.setDate(nextDay.getDate() + 1);
      endDateStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');
    }
    const endTimeStr = `${String(endH).padStart(2, '0')}${startM}00`;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EvaPro//Check-in//ES',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `DTSTART:${dateStr}T${timeStr}`,
      `DTEND:${endDateStr}T${endTimeStr}`,
      `SUMMARY:Check-in 1:1 - ${checkIn.topic}`,
      `DESCRIPTION:Reuni\u00f3n 1:1 con ${manager.firstName} ${manager.lastName}\\nTema: ${checkIn.topic}`,
      locationName ? `LOCATION:${locationName}` : '',
      `ORGANIZER;CN=${manager.firstName} ${manager.lastName}:mailto:${manager.email}`,
      `ATTENDEE;CN=${employee.firstName} ${employee.lastName}:mailto:${employee.email}`,
      `UID:${checkIn.id}@evapro`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    if (!this.resend || !employee.email) return;

    try {
      await this.resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'EvaPro <onboarding@resend.dev>',
        to: employee.email,
        subject: `Nueva reuni\u00f3n 1:1: ${checkIn.topic}`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;">
            <h2 style="color:#6366f1;">Reuni\u00f3n 1:1 Programada</h2>
            <p><strong>Tema:</strong> ${checkIn.topic}</p>
            <p><strong>Fecha:</strong> ${new Date(checkIn.scheduledDate).toLocaleDateString('es-CL')}</p>
            <p><strong>Hora:</strong> ${checkIn.scheduledTime || 'Por confirmar'}</p>
            ${locationName ? `<p><strong>Lugar:</strong> ${locationName}</p>` : ''}
            <p><strong>Encargado:</strong> ${manager.firstName} ${manager.lastName}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:1rem 0;">
            <p style="color:#64748b;font-size:12px;">Puedes aceptar o rechazar esta cita desde EvaPro.</p>
          </div>`,
        attachments: [{
          filename: 'checkin.ics',
          content: Buffer.from(icsContent).toString('base64'),
          contentType: 'text/calendar',
        }],
      });
      await this.checkInRepo.update(checkIn.id, { emailSent: true });
    } catch (e) {
      console.error('[Resend] Error sending check-in invitation:', e);
    }
  }

  // ─── Meeting Locations ──────────────────────────────────────────────────

  async findLocations(tenantId: string): Promise<MeetingLocation[]> {
    return this.locationRepo.find({
      where: { tenantId, isActive: true },
      order: { type: 'ASC', name: 'ASC' },
    });
  }

  async createLocation(tenantId: string, data: { name: string; type: string; address?: string; capacity?: number }): Promise<MeetingLocation> {
    const loc = this.locationRepo.create({
      tenantId,
      name: data.name,
      type: data.type,
      address: data.address || null,
      capacity: data.capacity || null,
    } as Partial<MeetingLocation>);
    return this.locationRepo.save(loc as MeetingLocation);
  }

  async updateLocation(tenantId: string, id: string, data: { name?: string; type?: string; address?: string; capacity?: number }): Promise<MeetingLocation> {
    const loc = await this.locationRepo.findOne({ where: { id, tenantId } });
    if (!loc) throw new NotFoundException('Lugar no encontrado');
    if (data.name !== undefined) loc.name = data.name;
    if (data.type !== undefined) loc.type = data.type as any;
    if (data.address !== undefined) loc.address = data.address;
    if (data.capacity !== undefined) loc.capacity = data.capacity;
    return this.locationRepo.save(loc);
  }

  async deactivateLocation(tenantId: string, id: string): Promise<void> {
    const loc = await this.locationRepo.findOne({ where: { id, tenantId } });
    if (!loc) throw new NotFoundException('Lugar no encontrado');
    loc.isActive = false;
    await this.locationRepo.save(loc);
  }

  // ─── Quick Feedback ───────────────────────────────────────────────────────

  // B4.1: Prohibited words list for content filtering
  private readonly PROHIBITED_WORDS = [
    'idiota', 'estupido', 'estúpido', 'imbecil', 'imbécil', 'inutil', 'inútil',
    'incompetente', 'basura', 'mediocre', 'perdedor', 'tarado', 'tonto',
    'maldito', 'desgraciado', 'miserable', 'porqueria', 'porquería',
  ];

  private validateFeedbackContent(message: string): void {
    const trimmed = message.trim();
    if (trimmed.length < 20) {
      throw new BadRequestException(
        `El feedback debe tener al menos 20 caracteres (actual: ${trimmed.length}). Proporciona un mensaje más descriptivo.`,
      );
    }
    // Normalize: lowercase, strip accents/diacritics, remove non-alpha chars for comparison
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
      .replace(/[^a-z\s]/g, '');       // keep only letters and spaces
    const normalizedWords = this.PROHIBITED_WORDS.map((w) =>
      w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    );
    const found = normalizedWords.find((word) => normalized.includes(word));
    if (found) {
      throw new BadRequestException(
        'El feedback contiene lenguaje inapropiado. El feedback debe estar enfocado en comportamientos y resultados, no en la persona.',
      );
    }
  }

  async createQuickFeedback(tenantId: string, fromUserId: string, dto: CreateQuickFeedbackDto): Promise<QuickFeedback> {
    this.validateFeedbackContent(dto.message);

    const qf = this.quickFeedbackRepo.create({
      tenantId,
      fromUserId,
      toUserId: dto.toUserId,
      message: dto.message,
      sentiment: dto.sentiment,
      category: dto.category,
      isAnonymous: dto.isAnonymous ?? false,
      visibility: dto.visibility,
      competencyId: dto.competencyId || null,
    });
    const saved = await this.quickFeedbackRepo.save(qf);

    // Create in-app notification for recipient
    const sender = await this.userRepo.findOne({ where: { id: fromUserId }, select: ['id', 'firstName', 'lastName'] });
    const senderName = dto.isAnonymous ? 'Alguien' : (sender ? `${sender.firstName} ${sender.lastName}` : 'Un colega');
    const sentimentLabel = dto.sentiment === 'positive' ? 'positivo' : dto.sentiment === 'constructive' ? 'constructivo' : 'neutral';
    await this.notificationsService.create({
      tenantId,
      userId: dto.toUserId,
      type: NotificationType.FEEDBACK_RECEIVED,
      title: `Feedback ${sentimentLabel} recibido`,
      message: `${senderName} te ha enviado feedback ${sentimentLabel}`,
      metadata: { feedbackId: saved.id },
    }).catch(() => {});

    return saved;
  }

  async findFeedbackReceived(tenantId: string, userId: string): Promise<QuickFeedback[]> {
    return this.quickFeedbackRepo.find({
      where: { tenantId, toUserId: userId },
      relations: ['fromUser', 'competency'],
      order: { createdAt: 'DESC' },
    });
  }

  async findFeedbackGiven(tenantId: string, userId: string): Promise<QuickFeedback[]> {
    return this.quickFeedbackRepo.find({
      where: { tenantId, fromUserId: userId },
      relations: ['toUser', 'competency'],
      order: { createdAt: 'DESC' },
    });
  }

  async getFeedbackSummary(tenantId: string, userId: string) {
    const received = await this.quickFeedbackRepo.find({
      where: { tenantId, toUserId: userId },
      relations: ['competency'],
      order: { createdAt: 'DESC' },
    });

    const positive = received.filter((f) => f.sentiment === Sentiment.POSITIVE).length;
    const neutral = received.filter((f) => f.sentiment === Sentiment.NEUTRAL).length;
    const constructive = received.filter((f) => f.sentiment === Sentiment.CONSTRUCTIVE).length;

    // Trend by month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const trend: Array<{ month: string; positive: number; neutral: number; constructive: number; total: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthFeedbacks = received.filter((f) => {
        const fd = new Date(f.createdAt);
        return fd.getFullYear() === d.getFullYear() && fd.getMonth() === d.getMonth();
      });
      trend.push({
        month: monthKey,
        positive: monthFeedbacks.filter((f) => f.sentiment === Sentiment.POSITIVE).length,
        neutral: monthFeedbacks.filter((f) => f.sentiment === Sentiment.NEUTRAL).length,
        constructive: monthFeedbacks.filter((f) => f.sentiment === Sentiment.CONSTRUCTIVE).length,
        total: monthFeedbacks.length,
      });
    }

    // Top competencies mentioned
    const competencyCounts = new Map<string, { name: string; count: number }>();
    for (const f of received) {
      if (f.competencyId && f.competency) {
        const existing = competencyCounts.get(f.competencyId) || { name: f.competency.name, count: 0 };
        existing.count++;
        competencyCounts.set(f.competencyId, existing);
      }
    }
    const topCompetencies = [...competencyCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Category breakdown
    const categoryBreakdown = new Map<string, number>();
    for (const f of received) {
      if (f.category) {
        categoryBreakdown.set(f.category, (categoryBreakdown.get(f.category) || 0) + 1);
      }
    }
    const categories = [...categoryBreakdown.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      positive,
      neutral,
      constructive,
      total: received.length,
      trend,
      topCompetencies,
      categories,
    };
  }
}
