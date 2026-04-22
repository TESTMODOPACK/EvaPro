import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { CheckIn, CheckInStatus } from './entities/checkin.entity';
import { QuickFeedback, Sentiment } from './entities/quick-feedback.entity';
import { MeetingLocation } from './entities/meeting-location.entity';
import { CreateCheckInDto, UpdateCheckInDto, RejectCheckInDto } from './dto/create-checkin.dto';
import { CreateQuickFeedbackDto } from './dto/create-quick-feedback.dto';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
// v3.1 F1 — Agenda Mágica: lectura de objetivos, reconocimientos + AI opt.
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { Competency } from '../development/entities/competency.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { buildPushMessage } from '../notifications/push-messages';
import { AuditService } from '../audit/audit.service';

/**
 * v3.1 F1 — Versión del generador de la Agenda Mágica. Bump cuando cambie
 * el shape del jsonb `magicAgenda` para que el frontend pueda detectar
 * agendas regeneradas vs viejas.
 */
const MAGIC_AGENDA_GENERATOR_VERSION = 'v1';

/** Truncado seguro de mensajes largos para previews en la agenda. */
function truncatePreview(text: string | null | undefined, maxLen = 200): string {
  if (!text) return '';
  const t = text.trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen - 1) + '…';
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectRepository(CheckIn)
    private readonly checkInRepo: Repository<CheckIn>,
    @InjectRepository(QuickFeedback)
    private readonly quickFeedbackRepo: Repository<QuickFeedback>,
    @InjectRepository(MeetingLocation)
    private readonly locationRepo: Repository<MeetingLocation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    // v3.1 F1 — read-only para snapshot en la agenda mágica.
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(Recognition)
    private readonly recognitionRepo: Repository<Recognition>,
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
    // v3.1 F1 — opcional (AI suggestions, degradación graceful).
    @Inject(forwardRef(() => AiInsightsService))
    private readonly aiInsightsService: AiInsightsService,
    // v3.1 F1 — para detectar si el tenant tiene plan con AI_INSIGHTS.
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Check-ins ────────────────────────────────────────────────────────────

  /**
   * v3.1 — Valida que una combinación scheduledDate + scheduledTime no
   * apunte al pasado. Se usa al crear, aceptar solicitudes y reprogramar.
   *
   * - Si `scheduledTime` viene (HH:mm), valida timestamp completo con una
   *   tolerancia de 60 segundos (para evitar falsos negativos por el lag
   *   entre click del usuario y llegada al servidor).
   * - Si no viene hora, valida solo la fecha (no puede ser anterior a hoy).
   *
   * Lanza BadRequestException con mensaje específico en español.
   */
  private assertFutureScheduledDatetime(
    scheduledDate: string | Date | undefined,
    scheduledTime?: string | null,
  ): void {
    if (!scheduledDate) return; // otros validators manejan "faltante"

    // Normalizar fecha a YYYY-MM-DD usando UTC para evitar que la zona
    // horaria del server cambie el día.
    const dateStr = typeof scheduledDate === 'string'
      ? scheduledDate.slice(0, 10)
      : (() => {
          const d = scheduledDate as Date;
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        })();

    const now = new Date();
    const todayStr = (() => {
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();

    if (dateStr < todayStr) {
      throw new BadRequestException(
        'La fecha del check-in no puede ser anterior a hoy.',
      );
    }

    // Si la fecha es estrictamente futura, no validamos hora.
    if (dateStr > todayStr) return;

    // Fecha = hoy. Si hay hora, validar que sea futura (con 60s de tolerancia).
    if (scheduledTime) {
      const [hh, mm] = scheduledTime.split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);
        if (scheduled.getTime() < now.getTime() - 60_000) {
          throw new BadRequestException(
            'La hora del check-in ya pasó. Programa una hora futura.',
          );
        }
      }
    }
  }

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

    // v3.1 — validar que la fecha/hora sean futuras. Un 1:1 no puede
    // programarse en el pasado. Si se provee hora, validamos fecha+hora;
    // si no, validamos solo fecha (permitiendo programar "hoy sin hora").
    this.assertFutureScheduledDatetime(dto.scheduledDate, dto.scheduledTime);

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

    const employee = await this.userRepo.findOne({ where: { id: dto.employeeId }, select: ['id', 'firstName', 'lastName', 'language'] });

    // v3.0 Push notification al empleado (fire-and-forget).
    const scheduledDateStr = dto.scheduledDate ? new Date(dto.scheduledDate).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '';
    const timeStr = dto.scheduledTime ? ` a las ${dto.scheduledTime.slice(0, 5)}` : '';
    const checkinMsg = buildPushMessage('checkinScheduled', employee?.language ?? 'es', {
      other: managerName,
      date: scheduledDateStr,
      time: timeStr,
    });
    this.pushService
      .sendToUser(
        dto.employeeId,
        {
          title: checkinMsg.title,
          body: checkinMsg.body,
          url: '/dashboard/feedback',
          tag: `checkin-${(saved as CheckIn).id}`,
        },
        'checkins',
      )
      .catch((err) => this.logger.warn(`Push checkin failed: ${err?.message}`));
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : dto.employeeId;
    this.auditService.log(tenantId, managerId, 'checkin.created', 'checkin', (saved as CheckIn).id, {
      managerName, employeeName, topic: dto.topic, scheduledDate: dto.scheduledDate,
    }).catch(() => {});

    return saved as CheckIn;
  }

  async updateCheckIn(tenantId: string, id: string, dto: UpdateCheckInDto): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');

    // v3.1 — si se reprograma (cambia date y/o time), validar que no quede
    // en el pasado. Merge con lo existente para validar con la combinación
    // final, no solo lo que llega en el DTO.
    if (dto.scheduledDate !== undefined || dto.scheduledTime !== undefined) {
      const mergedDate = dto.scheduledDate ?? ci.scheduledDate;
      const mergedTime = dto.scheduledTime !== undefined ? dto.scheduledTime : ci.scheduledTime;
      this.assertFutureScheduledDatetime(mergedDate as any, mergedTime);
    }

    if (dto.topic !== undefined) ci.topic = dto.topic;
    if (dto.notes !== undefined) ci.notes = dto.notes;
    if (dto.scheduledDate !== undefined) ci.scheduledDate = new Date(dto.scheduledDate) as any;
    if (dto.scheduledTime !== undefined) ci.scheduledTime = dto.scheduledTime;
    if (dto.locationId !== undefined) ci.locationId = dto.locationId;
    if (dto.actionItems !== undefined) ci.actionItems = dto.actionItems;
    if (dto.status !== undefined) ci.status = dto.status as any;
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

  async completeCheckIn(
    tenantId: string, id: string, userId?: string,
    data?: { notes?: string; actionItems?: any[]; rating?: number; minutes?: string },
  ): Promise<CheckIn> {
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
    // Save completion data: notes, action items, rating
    if (data?.notes !== undefined) ci.notes = data.notes;
    if (data?.actionItems && Array.isArray(data.actionItems)) {
      ci.actionItems = data.actionItems.map((item: any) => ({
        text: item.text || '',
        completed: false,
        assigneeName: item.assigneeName || '',
        dueDate: item.dueDate || null,
      }));
    }
    if (data?.rating && data.rating >= 1 && data.rating <= 5) ci.rating = data.rating;
    if (data?.minutes !== undefined) ci.minutes = data.minutes || null;

    const saved = await this.checkInRepo.save(ci);
    this.auditService.log(tenantId, userId || null, 'checkin.completed', 'checkin', ci.id, {
      topic: ci.topic, managerId: ci.managerId, employeeId: ci.employeeId,
      rating: ci.rating, actionItemsCount: ci.actionItems?.length || 0,
    }).catch(() => {});

    // v3.1 F1 — Propagar pendientes al próximo 1:1 scheduled (si existe)
    // entre los mismos 2 usuarios. Fire-and-forget — no bloquea respuesta.
    this.snapshotPendingForNext(saved).catch((err) =>
      this.logger.warn(`snapshotPendingForNext (post-complete) failed: ${err?.message}`),
    );

    return saved;
  }

  /** Update minutes on a completed check-in (manager or employee) */
  async updateMinutes(tenantId: string, id: string, userId: string, minutes: string): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (ci.status !== CheckInStatus.COMPLETED) {
      throw new BadRequestException('Solo se puede agregar minuta a check-ins completados');
    }
    if (ci.managerId !== userId && ci.employeeId !== userId) {
      throw new ForbiddenException('Solo los participantes pueden editar la minuta');
    }
    ci.minutes = minutes || null;
    return this.checkInRepo.save(ci);
  }

  async deleteCheckIn(tenantId: string | undefined, id: string, userId: string, role: string): Promise<{ deleted: boolean }> {
    const where = tenantId ? { id, tenantId } : { id };
    const ci = await this.checkInRepo.findOne({ where });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    const effectiveTenantId = ci.tenantId;

    // Solo el creador (manager) o un admin puede eliminar
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    if (!isAdmin && ci.managerId !== userId) {
      throw new ForbiddenException('Solo el creador del check-in o un administrador puede eliminarlo.');
    }

    // Solo se pueden eliminar check-ins programados (no completados)
    if (ci.status === CheckInStatus.COMPLETED) {
      throw new BadRequestException('No se puede eliminar un check-in ya completado. Los registros completados son evidencia.');
    }

    await this.checkInRepo.remove(ci);
    this.auditService.log(effectiveTenantId, userId, 'checkin.deleted', 'checkin', id, {
      topic: ci.topic, employeeId: ci.employeeId, status: ci.status,
    }).catch(() => {});

    return { deleted: true };
  }

  /** Employee requests a check-in with their direct manager */
  async requestCheckIn(tenantId: string, employeeId: string, dto: { topic: string; suggestedDate?: string }): Promise<CheckIn> {
    // Find the employee's direct manager
    const employee = await this.userRepo.findOne({
      where: { id: employeeId, tenantId },
      select: ['id', 'managerId', 'firstName', 'lastName'],
    });
    if (!employee) throw new NotFoundException('Colaborador no encontrado');
    if (!employee.managerId) {
      throw new BadRequestException('No tienes una jefatura directa asignada. Contacta al administrador.');
    }

    const ci = this.checkInRepo.create({
      tenantId,
      managerId: employee.managerId,
      employeeId,
      scheduledDate: dto.suggestedDate ? new Date(dto.suggestedDate) : new Date(),
      topic: dto.topic,
      actionItems: [],
      agendaTopics: [],
      status: CheckInStatus.REQUESTED,
    } as any);
    const saved = await this.checkInRepo.save(ci);

    // Notify the manager
    const employeeName = `${employee.firstName} ${employee.lastName}`;
    await this.notificationsService.create({
      tenantId,
      userId: employee.managerId,
      type: NotificationType.CHECKIN_SCHEDULED,
      title: 'Solicitud de reunión 1:1',
      message: `${employeeName} ha solicitado una reunión 1:1: "${dto.topic}"`,
      metadata: { checkInId: (saved as any).id, requestedBy: employeeId },
    }).catch(() => {});

    this.auditService.log(tenantId, employeeId, 'checkin.requested', 'checkin', (saved as any).id, {
      topic: dto.topic, managerId: employee.managerId,
    }).catch(() => {});

    return saved as any;
  }

  /** Manager accepts a requested check-in — changes status to scheduled */
  async acceptCheckInRequest(tenantId: string | undefined, checkInId: string, managerId: string, data?: { scheduledDate?: string; scheduledTime?: string; locationId?: string }): Promise<CheckIn> {
    const where = tenantId ? { id: checkInId, tenantId } : { id: checkInId };
    const ci = await this.checkInRepo.findOne({ where });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    const effectiveTenantId = ci.tenantId;
    if (ci.status !== CheckInStatus.REQUESTED) {
      throw new BadRequestException('Solo se pueden aceptar solicitudes pendientes');
    }
    // Semántica: super_admin puede aceptar cross-tenant (soporte); tenant_admin/manager
    // siguen validados contra managerId.
    if (ci.managerId !== managerId && !tenantId) {
      // Super_admin OK — se acepta en nombre del manager. Log claro para auditoría.
      this.logger.log(`super_admin ${managerId} accepting check-in ${checkInId} on behalf of manager ${ci.managerId}`);
    } else if (ci.managerId !== managerId) {
      throw new ForbiddenException('Solo el encargado asignado puede aceptar esta solicitud');
    }

    // v3.1 — validar fecha/hora futuras. Si el manager ajusta fecha al
    // aceptar, usamos los valores nuevos; si no, los existentes.
    const finalDate = data?.scheduledDate ?? ci.scheduledDate;
    const finalTime = data?.scheduledTime ?? ci.scheduledTime;
    this.assertFutureScheduledDatetime(finalDate as any, finalTime);

    // Atomic update to prevent double-accept race condition
    const updateResult = await this.checkInRepo.update(
      { id: checkInId, status: CheckInStatus.REQUESTED },
      {
        status: CheckInStatus.SCHEDULED,
        ...(data?.scheduledDate ? { scheduledDate: new Date(data.scheduledDate) } : {}),
        ...(data?.scheduledTime ? { scheduledTime: data.scheduledTime } : {}),
        ...(data?.locationId ? { locationId: data.locationId } : {}),
      },
    );
    if (!updateResult.affected) {
      throw new BadRequestException('Esta solicitud ya fue procesada por otro usuario.');
    }
    const saved = await this.checkInRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.manager', 'manager', 'manager.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.employee', 'employee', 'employee.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.location', 'location')
      .where('c.id = :id', { id: checkInId })
      .andWhere('c.tenantId = :tenantId', { tenantId: effectiveTenantId })
      .getOne();

    if (!saved) return ci; // fallback

    // Notify employee that request was accepted
    const managerUser = await this.userRepo.findOne({ where: { id: ci.managerId }, select: ['id', 'firstName', 'lastName'] });
    const managerName = managerUser ? `${managerUser.firstName} ${managerUser.lastName}` : 'Tu encargado';
    await this.notificationsService.create({
      tenantId: effectiveTenantId,
      userId: saved.employeeId,
      type: NotificationType.CHECKIN_SCHEDULED,
      title: 'Solicitud de reunión aceptada',
      message: `${managerName} ha aceptado tu solicitud de reunión: "${saved.topic}"`,
      metadata: { checkInId: saved.id },
    }).catch(() => {});

    // Send email invitation
    await this.sendCheckInInvitation(saved, effectiveTenantId);

    return saved;
  }

  /**
   * v3.1 — Retorna el historial agrupado de temas (`topic`) usados en
   * check-ins, para autocompletar al crear uno nuevo. Se filtra por rol:
   *
   *   - super_admin / tenant_admin → todos los check-ins del tenant.
   *   - manager                    → solo los check-ins donde managerId = userId
   *                                  (sus propios temas).
   *   - employee                   → no debería llegar acá (no crea check-ins);
   *                                  si llega, retorna [].
   *
   * Salida: top-20 temas ordenados por `lastUsedAt DESC`. Cada item trae:
   *   - title       texto del topic
   *   - usedCount   cuántas veces ese topic apareció
   *   - lastUsedAt  ISO8601 de la última vez que se usó
   *   - history     hasta 5 entradas con employeeName + scheduledDate
   *
   * Matching case-insensitive sobre `LOWER(topic)` (usuarios tipean con
   * distinta casing). Ignoramos check-ins `cancelled`/`rejected` para no
   * proponer temas que nunca se conversaron.
   */
  async findMyTopicsHistory(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<Array<{
    title: string;
    usedCount: number;
    lastUsedAt: string;
    history: Array<{ employeeName: string; date: string }>;
  }>> {
    if (role === 'employee') return []; // no expone historial a empleados

    const isAdmin = role === 'super_admin' || role === 'tenant_admin';

    const qb = this.checkInRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.employee', 'employee', 'employee.tenant_id = c.tenant_id')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.status NOT IN (:...blocked)', { blocked: ['cancelled', 'rejected'] });

    if (!isAdmin) {
      qb.andWhere('c.managerId = :userId', { userId });
    }

    // Traemos últimos 200 para agrupar en memoria (más simple que SQL pivot;
    // 200 es suficiente para generar top-20 de temas frecuentes).
    const rows = await qb.orderBy('c.scheduledDate', 'DESC').take(200).getMany();

    // Agrupar por lowercased topic preservando la primera variante vista
    // (la más reciente gana el casing del title).
    const groups = new Map<string, {
      title: string;
      usedCount: number;
      lastUsedAt: string;
      history: Array<{ employeeName: string; date: string }>;
    }>();

    for (const ci of rows) {
      const raw = (ci.topic || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const dateIso = (ci.scheduledDate instanceof Date
        ? ci.scheduledDate
        : new Date(ci.scheduledDate as any)
      ).toISOString();
      const employeeName = ci.employee
        ? `${ci.employee.firstName} ${ci.employee.lastName}`.trim()
        : 'Colaborador';

      const existing = groups.get(key);
      if (existing) {
        existing.usedCount += 1;
        // history: mantener sólo las 5 más recientes. Como rows vienen
        // ordenadas DESC por fecha, la primera en aparecer es la más reciente.
        if (existing.history.length < 5) {
          existing.history.push({ employeeName, date: dateIso });
        }
        // lastUsedAt ya es el más reciente (primera entrada del grupo).
      } else {
        groups.set(key, {
          title: raw, // conserva el casing del más reciente
          usedCount: 1,
          lastUsedAt: dateIso,
          history: [{ employeeName, date: dateIso }],
        });
      }
    }

    // Ordenar por lastUsedAt DESC y tomar top 20.
    return Array.from(groups.values())
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, 20);
  }

  async findCheckIns(tenantId: string, userId: string, role: string): Promise<CheckIn[]> {
    const isAdminOrManager = role === 'super_admin' || role === 'tenant_admin' || role === 'manager';
    // queryBuilder with tenant guards on every joined relation to prevent
    // cross-tenant leak if a checkin has an orphan manager_id/employee_id.
    const qb = this.checkInRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.manager', 'manager', 'manager.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.employee', 'employee', 'employee.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.location', 'location')
      .leftJoinAndSelect('c.developmentPlan', 'dp', 'dp.tenant_id = c.tenant_id')
      .where('c.tenantId = :tenantId', { tenantId })
      .orderBy('c.scheduledDate', 'DESC');

    if (isAdminOrManager) {
      qb.andWhere('(c.managerId = :userId OR c.employeeId = :userId)', { userId });
    } else {
      qb.andWhere('c.employeeId = :userId', { userId });
    }

    return qb.take(200).getMany();
  }

  // ─── Check-in Rejection ──────────────────────────────────────────────────

  async rejectCheckIn(tenantId: string, checkInId: string, userId: string, dto: RejectCheckInDto): Promise<CheckIn> {
    const ci = await this.checkInRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.manager', 'manager', 'manager.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.employee', 'employee', 'employee.tenant_id = c.tenant_id')
      .where('c.id = :id', { id: checkInId })
      .andWhere('c.tenantId = :tenantId', { tenantId })
      .getOne();
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

    this.auditService.log(tenantId, userId, 'checkin.rejected', 'checkin', ci.id, {
      topic: ci.topic, rejectedBy: userId, reason: dto.reason,
    }).catch(() => {});

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

    // Send rejection email to manager via EmailService (branded template)
    if (ci.manager?.email) {
      this.emailService.sendCheckinRejected(ci.manager.email, {
        managerName: `${ci.manager.firstName} ${ci.manager.lastName}`,
        employeeName: `${ci.employee.firstName} ${ci.employee.lastName}`,
        topic: ci.topic,
        scheduledDate: new Date(ci.scheduledDate).toLocaleDateString('es-CL'),
        scheduledTime: ci.scheduledTime || undefined,
        reason: dto.reason,
        tenantId,
        userId: ci.managerId,
      }).catch(() => {});
    }

    return saved;
  }

  // ─── Email Invitation ──────────────────────────────────────────────────

  private async sendCheckInInvitation(checkIn: CheckIn, tenantId: string): Promise<void> {
    const employee = await this.userRepo.findOne({ where: { id: checkIn.employeeId } });
    const manager = await this.userRepo.findOne({ where: { id: checkIn.managerId } });
    if (!employee?.email || !manager) return;

    let locationName = '';
    if (checkIn.locationId) {
      const loc = await this.locationRepo.findOne({ where: { id: checkIn.locationId } });
      locationName = loc ? loc.name + (loc.address ? ` (${loc.address})` : '') : '';
    }

    // Generate .ics (iCalendar) content
    const schedDate = new Date(checkIn.scheduledDate);
    const dateStr = schedDate.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = checkIn.scheduledTime ? checkIn.scheduledTime.replace(':', '') + '00' : '090000';

    const startH = checkIn.scheduledTime ? parseInt(checkIn.scheduledTime.split(':')[0]) : 9;
    const startM = checkIn.scheduledTime ? checkIn.scheduledTime.split(':')[1] : '00';
    const endH = (startH + 1) % 24;
    let endDateStr = dateStr;
    if (endH < startH) {
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

    try {
      // Use branded EmailService template (sendCheckinScheduled) with .ics attachment
      const html = await this.emailService.buildCheckinScheduledHtml({
        firstName: employee.firstName,
        managerName: `${manager.firstName} ${manager.lastName}`,
        scheduledAt: `${new Date(checkIn.scheduledDate).toLocaleDateString('es-CL')}${checkIn.scheduledTime ? ' ' + checkIn.scheduledTime : ''}`,
        topic: checkIn.topic,
        checkinId: checkIn.id,
        tenantId,
        userId: employee.id,
      });
      if (!html) return; // Emails disabled for this tenant

      await this.emailService.sendWithAttachments(
        employee.email,
        `Nueva reunión 1:1: ${checkIn.topic}`,
        html,
        [{
          filename: 'checkin.ics',
          content: Buffer.from(icsContent).toString('base64'),
          contentType: 'text/calendar',
        }],
        undefined,
        { userIdForUnsubscribe: employee.id },
      );
      await this.checkInRepo.update(checkIn.id, { emailSent: true });
      // NO loggeamos el email (PII) — solo el checkInId para diagnosticar.
      // El redactor de pino filtra `email` por default, pero mejor ni
      // exponerlo en el string del mensaje.
      this.logger.log({ checkInId: checkIn.id, employeeId: employee.id }, 'CheckIn email sent');
    } catch (e: any) {
      this.logger.error(
        { checkInId: checkIn.id, employeeId: employee.id, err: e?.message || String(e) },
        'CheckIn email failed',
      );
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

  async updateLocation(tenantId: string | undefined, id: string, data: { name?: string; type?: string; address?: string; capacity?: number }): Promise<MeetingLocation> {
    const where = tenantId ? { id, tenantId } : { id };
    const loc = await this.locationRepo.findOne({ where });
    if (!loc) throw new NotFoundException('Lugar no encontrado');
    if (data.name !== undefined) loc.name = data.name;
    if (data.type !== undefined) loc.type = data.type as any;
    if (data.address !== undefined) loc.address = data.address;
    if (data.capacity !== undefined) loc.capacity = data.capacity;
    return this.locationRepo.save(loc);
  }

  async deactivateLocation(tenantId: string | undefined, id: string): Promise<void> {
    const where = tenantId ? { id, tenantId } : { id };
    const loc = await this.locationRepo.findOne({ where });
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

  private validateFeedbackContent(message: string, minLength: number = 20): void {
    const trimmed = message.trim();
    if (trimmed.length < minLength) {
      throw new BadRequestException(
        `El feedback debe tener al menos ${minLength} caracteres (actual: ${trimmed.length}). Proporciona un mensaje más descriptivo.`,
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

  async createQuickFeedback(tenantId: string, fromUserId: string, dto: CreateQuickFeedbackDto, role: string = 'employee'): Promise<QuickFeedback> {
    // 1. Load tenant feedback configuration
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
    const fbConfig = tenant?.settings?.feedbackConfig || {};
    const scope: string = fbConfig.scope || 'all';
    const allowAnonymous: boolean = fbConfig.allowAnonymous !== false;
    const minLength: number = fbConfig.minMessageLength || 20;
    const requireCompetency: boolean = fbConfig.requireCompetency === true;

    // 2. Validate recipient exists in same tenant
    const recipientData = await this.userRepo.findOne({ where: { id: dto.toUserId, tenantId }, select: ['id', 'department', 'departmentId', 'managerId'] });
    if (!recipientData) throw new NotFoundException('Destinatario no encontrado en esta organización');

    // 3. Apply scope restrictions (configurable by admin)
    if (scope !== 'all' && role !== 'tenant_admin' && role !== 'super_admin') {
      const sender = await this.userRepo.findOne({ where: { id: fromUserId, tenantId }, select: ['id', 'department', 'departmentId', 'managerId'] });
      if (sender) {
        const sameDept = !!(sender.departmentId && (recipientData as any).departmentId
          ? sender.departmentId === (recipientData as any).departmentId
          : sender.department && recipientData.department && sender.department === recipientData.department);
        if (scope === 'department' && !sameDept) {
          throw new ForbiddenException('La configuración de tu organización permite enviar feedback solo a miembros de tu mismo departamento.');
        }
        if (scope === 'team') {
          const isDirectReport = recipientData.managerId === fromUserId;
          const isMyManager = sender.managerId === recipientData.id;
          if (!sameDept && !isDirectReport && !isMyManager) {
            throw new ForbiddenException('La configuración de tu organización permite enviar feedback solo a tu equipo directo o miembros de tu departamento.');
          }
        }
      }
    }

    // 3b. Validate peer feedback restriction
    const allowPeerFeedback: boolean = fbConfig.allowPeerFeedback !== false;
    if (!allowPeerFeedback && role !== 'tenant_admin' && role !== 'super_admin') {
      const sender = await this.userRepo.findOne({ where: { id: fromUserId, tenantId }, select: ['id', 'managerId'] });
      if (sender) {
        const isManager = recipientData.managerId === fromUserId;
        const isSubordinate = sender.managerId === recipientData.id;
        if (!isManager && !isSubordinate) {
          throw new ForbiddenException('La configuración de tu organización no permite feedback entre pares. Solo puedes enviar feedback a tu jefatura directa o subordinados.');
        }
      }
    }

    // 4. Validate anonymous setting
    if (!allowAnonymous && dto.isAnonymous) {
      throw new BadRequestException('La organización no permite enviar feedback anónimo.');
    }

    // 5. Validate competency requirement
    if (requireCompetency && !dto.category) {
      throw new BadRequestException('Es obligatorio seleccionar una competencia al enviar feedback.');
    }

    // 6. Validate content (uses configurable min length)
    this.validateFeedbackContent(dto.message, minLength);

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

    this.auditService.log(tenantId, fromUserId, 'feedback.sent', 'feedback', saved.id, {
      toUserId: dto.toUserId, sentiment: dto.sentiment, category: dto.category, isAnonymous: dto.isAnonymous,
    }).catch(() => {});

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

    // v3.0 Push notification al destinatario.
    const recipient = await this.userRepo.findOne({ where: { id: dto.toUserId }, select: ['id', 'language'] });
    const pushFb = buildPushMessage('feedbackReceived', recipient?.language ?? 'es', {
      from: senderName,
    });
    this.pushService
      .sendToUser(
        dto.toUserId,
        {
          title: pushFb.title,
          body: pushFb.body,
          url: '/dashboard/feedback',
          tag: `feedback-${saved.id}`,
        },
        'feedback',
      )
      .catch((err) => this.logger.warn(`Push feedback failed: ${err?.message}`));

    // Send email to feedback recipient
    const recipientUser = await this.userRepo.findOne({ where: { id: dto.toUserId }, select: ['id', 'email', 'firstName'] });
    if (recipientUser?.email) {
      this.emailService.sendFeedbackReceived(recipientUser.email, {
        firstName: recipientUser.firstName,
        senderName,
        sentiment: dto.sentiment || 'neutral',
        message: dto.message,
        tenantId,
        userId: recipientUser.id,
      }).catch(() => {});
    }

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

  // ─── Export ──────────────────────────────────────────────────────────

  /**
   * P7.3 — Manager export: filtra check-ins donde managerId o employeeId
   * sea del equipo (self + reportes directos) y quick feedback donde
   * fromUserId o toUserId sea del equipo. Admin (managerId=undefined)
   * exporta todo el tenant sin filtro.
   */
  private async getTeamScopeForFeedbackExport(
    tenantId: string,
    managerId: string | undefined,
  ): Promise<string[] | null> {
    if (!managerId) return null;
    const reports = await this.userRepo.find({
      where: { tenantId, managerId },
      select: ['id'],
    });
    return [managerId, ...reports.map((u) => u.id)];
  }

  async exportFeedbackCsv(tenantId: string, managerId?: string): Promise<string> {
    const teamIds = await this.getTeamScopeForFeedbackExport(tenantId, managerId);
    const checkinWhere: any = { tenantId };
    const feedbackWhere: any = { tenantId };
    if (teamIds) {
      // Manager: ve checkins donde participa un miembro del equipo
      // (managerId O employeeId). OR requiere array de where clauses.
      const orClauses: any[] = [
        { tenantId, managerId: In(teamIds) },
        { tenantId, employeeId: In(teamIds) },
      ];
      const checkins = await this.checkInRepo.find({
        where: orClauses,
        relations: ['manager', 'employee'],
        order: { scheduledDate: 'DESC' },
      });
      const feedback = await this.quickFeedbackRepo.find({
        where: [
          { tenantId, fromUserId: In(teamIds) },
          { tenantId, toUserId: In(teamIds) },
        ],
        relations: ['fromUser', 'toUser'],
        order: { createdAt: 'DESC' },
      });
      return this.buildFeedbackCsv(checkins, feedback);
    }

    const checkins = await this.checkInRepo.find({
      where: checkinWhere,
      relations: ['manager', 'employee'],
      order: { scheduledDate: 'DESC' },
    });
    const feedback = await this.quickFeedbackRepo.find({
      where: feedbackWhere,
      relations: ['fromUser', 'toUser'],
      order: { createdAt: 'DESC' },
    });
    return this.buildFeedbackCsv(checkins, feedback);
  }

  private buildFeedbackCsv(checkins: any[], feedback: any[]): string {

    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];

    lines.push('Feedback y Check-ins — Resumen');
    lines.push(`Total Check-ins,${checkins.length}`);
    lines.push(`Check-ins Completados,${checkins.filter(c => c.status === 'completed').length}`);
    lines.push(`Total Feedback Rápido,${feedback.length}`);
    lines.push('');

    lines.push('Check-ins');
    lines.push('Fecha,Jefe,Colaborador,Estado,Tema,Notas');
    for (const c of checkins) {
      const mgr = c.manager ? `${c.manager.firstName} ${c.manager.lastName}` : '';
      const emp = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : '';
      const date = c.scheduledDate ? new Date(c.scheduledDate).toLocaleDateString('es-CL') : '';
      lines.push([date, esc(mgr), esc(emp), c.status, esc(c.topic || ''), esc(c.notes || '')].join(','));
    }
    lines.push('');

    lines.push('Feedback Rápido');
    lines.push('Fecha,De,Para,Categoría,Sentimiento,Mensaje');
    for (const f of feedback) {
      const from = f.fromUser ? `${f.fromUser.firstName} ${f.fromUser.lastName}` : '';
      const to = f.toUser ? `${f.toUser.firstName} ${f.toUser.lastName}` : '';
      const date = f.createdAt ? new Date(f.createdAt).toLocaleDateString('es-CL') : '';
      lines.push([date, esc(from), esc(to), esc(f.category || ''), f.sentiment || '', esc(f.message || '')].join(','));
    }

    return '\uFEFF' + lines.join('\n');
  }

  async exportFeedbackXlsx(tenantId: string, managerId?: string): Promise<Buffer> {
    const teamIds = await this.getTeamScopeForFeedbackExport(tenantId, managerId);
    const checkins = teamIds
      ? await this.checkInRepo.find({
          where: [
            { tenantId, managerId: In(teamIds) },
            { tenantId, employeeId: In(teamIds) },
          ],
          relations: ['manager', 'employee'],
          order: { scheduledDate: 'DESC' },
        })
      : await this.checkInRepo.find({
          where: { tenantId },
          relations: ['manager', 'employee'],
          order: { scheduledDate: 'DESC' },
        });
    const feedback = teamIds
      ? await this.quickFeedbackRepo.find({
          where: [
            { tenantId, fromUserId: In(teamIds) },
            { tenantId, toUserId: In(teamIds) },
          ],
          relations: ['fromUser', 'toUser'],
          order: { createdAt: 'DESC' },
        })
      : await this.quickFeedbackRepo.find({
          where: { tenantId },
          relations: ['fromUser', 'toUser'],
          order: { createdAt: 'DESC' },
        });

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    const ws1 = wb.addWorksheet('Check-ins');
    ws1.columns = [
      { header: 'Fecha', width: 12 }, { header: 'Jefe', width: 22 },
      { header: 'Colaborador', width: 22 }, { header: 'Estado', width: 12 },
      { header: 'Tema', width: 30 }, { header: 'Notas', width: 35 },
    ];
    for (const c of checkins) {
      ws1.addRow([
        c.scheduledDate ? new Date(c.scheduledDate).toLocaleDateString('es-CL') : '',
        c.manager ? `${c.manager.firstName} ${c.manager.lastName}` : '',
        c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : '',
        c.status, c.topic || '', c.notes || '',
      ]);
    }

    const ws2 = wb.addWorksheet('Feedback Rápido');
    ws2.columns = [
      { header: 'Fecha', width: 12 }, { header: 'De', width: 22 },
      { header: 'Para', width: 22 }, { header: 'Categoría', width: 12 },
      { header: 'Sentimiento', width: 12 }, { header: 'Mensaje', width: 40 },
    ];
    for (const f of feedback) {
      ws2.addRow([
        f.createdAt ? new Date(f.createdAt).toLocaleDateString('es-CL') : '',
        f.fromUser ? `${f.fromUser.firstName} ${f.fromUser.lastName}` : '',
        f.toUser ? `${f.toUser.firstName} ${f.toUser.lastName}` : '',
        f.category || '', f.sentiment || '', f.message || '',
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // v3.1 F1 — Agenda Mágica de 1:1
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Valida que el caller pueda acceder a la agenda de este check-in.
   * Rules:
   *   - Admin (super_admin, tenant_admin) puede ver cualquier check-in del tenant.
   *   - Manager dueño del check-in (managerId === userId) puede ver/generar.
   *   - Employee participante puede ver pero NO generar (read-only).
   *   - Cualquier otro → ForbiddenException.
   * Retorna el CheckIn con relaciones manager/employee cargadas.
   */
  private async assertAccessToCheckinAgenda(
    tenantId: string,
    checkinId: string,
    userId: string,
    role: string,
    { requireWrite = false }: { requireWrite?: boolean } = {},
  ): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({
      where: { id: checkinId, tenantId },
      relations: ['manager', 'employee'],
    });
    if (!ci) throw new NotFoundException('Check-in no encontrado');

    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    const isManager = ci.managerId === userId;
    const isEmployee = ci.employeeId === userId;

    if (requireWrite) {
      // Generar/regenerar/editar agenda: solo manager o admin.
      if (!isAdmin && !isManager) {
        throw new ForbiddenException(
          'Solo el manager del check-in o un administrador puede preparar la agenda.',
        );
      }
    } else {
      // Leer: participante o admin.
      if (!isAdmin && !isManager && !isEmployee) {
        throw new ForbiddenException('No tienes acceso a este check-in.');
      }
    }
    return ci;
  }

  /**
   * Solo retorna el magicAgenda existente (no regenera). Usado por
   * GET /feedback/checkins/:id/agenda.
   */
  async getMagicAgenda(
    tenantId: string,
    checkinId: string,
    userId: string,
    role: string,
  ): Promise<{ magicAgenda: CheckIn['magicAgenda']; carriedOverActionItems: CheckIn['carriedOverActionItems']; hasAi: boolean }> {
    const ci = await this.assertAccessToCheckinAgenda(tenantId, checkinId, userId, role);
    // hasAi refleja si el PLAN del tenant incluye AI_INSIGHTS — NO si la
    // agenda actual tiene sugerencias. El frontend usa este flag para
    // decidir si mostrar el banner de upgrade vs. el estado "sin sugerencias".
    // Fail-safe: si el lookup falla, asumimos sin AI (no ofrecemos función).
    let hasAi = false;
    try {
      const sub = await this.subscriptionsService.findByTenantId(tenantId);
      hasAi = (sub?.plan?.features || []).includes('AI_INSIGHTS');
    } catch (err: any) {
      this.logger.warn(
        `getMagicAgenda: plan lookup failed for tenant ${tenantId.slice(0, 8)}: ${err?.message}`,
      );
    }
    return {
      magicAgenda: ci.magicAgenda,
      carriedOverActionItems: ci.carriedOverActionItems || [],
      hasAi,
    };
  }

  /**
   * Genera la agenda mágica on-demand.
   *   - Si ya existe y !force → retorna la cacheada (update rápido).
   *   - Si force → regenera todo (incluye quema de crédito IA si aplica).
   *
   * Graceful degradation: si AI_INSIGHTS no está en el plan o la API call
   * falla, `aiSuggestedTopics = []` y los otros 4 bloques se pueblan igual.
   */
  async generateMagicAgenda(
    tenantId: string,
    checkinId: string,
    userId: string,
    role: string,
    options: { force?: boolean; includeAi?: boolean } = {},
  ): Promise<CheckIn> {
    // v3.1 — `includeAi` (default true) controla si se quema crédito IA.
    // Si el caller (frontend) desmarca el checkbox, pasamos false y saltamos
    // la llamada a Anthropic aunque el plan tenga AI_INSIGHTS. Los otros
    // 4 bloques de datos SQL se pueblan igual (son gratis).
    const { force = false, includeAi = true } = options;
    const ci = await this.assertAccessToCheckinAgenda(tenantId, checkinId, userId, role, { requireWrite: true });

    // Resolver features del plan para decidir si llamamos a la IA.
    // Si falla el lookup, degradamos a "no AI" (seguro).
    let tenantPlanFeatures: string[] = [];
    try {
      const sub = await this.subscriptionsService.findByTenantId(tenantId);
      tenantPlanFeatures = sub?.plan?.features || [];
    } catch (err: any) {
      this.logger.warn(`Failed to resolve plan features for tenant ${tenantId.slice(0, 8)}: ${err?.message}`);
    }

    // Si ya existe y no es force → retorna el checkin tal cual.
    if (!force && ci.magicAgenda && ci.magicAgenda.generatorVersion === MAGIC_AGENDA_GENERATOR_VERSION) {
      return ci;
    }

    // 1. Pendientes del 1:1 anterior entre el mismo manager y employee.
    const previousCheckin = await this.checkInRepo.findOne({
      where: {
        tenantId,
        managerId: ci.managerId,
        employeeId: ci.employeeId,
        status: CheckInStatus.COMPLETED,
        id: Not(checkinId),
      },
      order: { completedAt: 'DESC' },
    });
    const pendingFromPrevious: NonNullable<CheckIn['magicAgenda']>['pendingFromPrevious'] =
      previousCheckin
        ? (previousCheckin.actionItems || [])
            .filter((item) => !item.completed)
            .map((item) => ({
              text: item.text,
              addedByUserId: item.assigneeId || previousCheckin.managerId,
              addedByName: item.assigneeName,
              previousCheckinId: previousCheckin.id,
            }))
        : [];

    // 2. OKRs activos del employee.
    const okrs = await this.objectiveRepo.find({
      where: {
        tenantId,
        userId: ci.employeeId,
        status: In([ObjectiveStatus.ACTIVE, ObjectiveStatus.PENDING_APPROVAL]),
      },
      order: { targetDate: 'ASC' },
      take: 10,
    });
    const now = Date.now();
    const okrSnapshot: NonNullable<CheckIn['magicAgenda']>['okrSnapshot'] = okrs.map((o) => {
      const daysToTarget =
        o.targetDate == null
          ? null
          : Math.floor((new Date(o.targetDate).getTime() - now) / (1000 * 60 * 60 * 24));
      return {
        objectiveId: o.id,
        title: o.title,
        progress: o.progress,
        status: o.status,
        targetDate: o.targetDate ? new Date(o.targetDate).toISOString().split('T')[0] : null,
        daysToTarget,
      };
    });

    // 3. QuickFeedback dado/recibido por el employee en las últimas 4 semanas.
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const feedbacks = await this.quickFeedbackRepo.find({
      where: [
        { tenantId, toUserId: ci.employeeId, createdAt: MoreThanOrEqual(fourWeeksAgo) },
        { tenantId, fromUserId: ci.employeeId, createdAt: MoreThanOrEqual(fourWeeksAgo) },
      ],
      relations: ['fromUser'],
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const recentFeedback: NonNullable<CheckIn['magicAgenda']>['recentFeedback'] = feedbacks.map((f) => ({
      feedbackId: f.id,
      fromUserId: f.fromUserId,
      fromName: f.fromUser ? `${f.fromUser.firstName} ${f.fromUser.lastName}` : undefined,
      sentiment: f.sentiment,
      messagePreview: truncatePreview(f.message),
      createdAt: f.createdAt.toISOString(),
    }));

    // 4. Recognitions recibidos por el employee en las últimas 4 semanas.
    const recognitions = await this.recognitionRepo.find({
      where: {
        tenantId,
        toUserId: ci.employeeId,
        createdAt: MoreThanOrEqual(fourWeeksAgo),
      },
      relations: ['value'],
      order: { createdAt: 'DESC' },
      take: 8,
    });
    const recentRecognitions: NonNullable<CheckIn['magicAgenda']>['recentRecognitions'] = recognitions.map((r) => ({
      recognitionId: r.id,
      valueId: r.valueId,
      valueName: r.value?.name,
      messagePreview: truncatePreview(r.message, 140),
      createdAt: r.createdAt.toISOString(),
    }));

    // 5. AI-suggested topics — SOLO si el plan tiene AI_INSIGHTS.
    //    Degradación graceful si falla la API o si el tenant no tiene el plan.
    const hasAiPlan = tenantPlanFeatures.includes('AI_INSIGHTS');
    const aiSuggestedTopics: NonNullable<CheckIn['magicAgenda']>['aiSuggestedTopics'] = [];
    // Solo llamamos a IA si el plan la soporta Y el caller lo pidió
    // explícitamente (includeAi). Si el usuario desmarca el checkbox
    // "Incluir sugerencias IA", ahorramos el crédito.
    if (hasAiPlan && includeAi) {
      try {
        const insight = await this.aiInsightsService.generateAgendaSuggestions(
          tenantId,
          checkinId,
          {
            employeeName: ci.employee
              ? `${ci.employee.firstName} ${ci.employee.lastName}`
              : 'Colaborador',
            employeePosition: ci.employee?.position || '',
            employeeDepartment: ci.employee?.department || '',
            okrs: okrSnapshot.map((o) => ({
              title: o.title,
              progress: o.progress,
              status: o.status,
              daysToTarget: o.daysToTarget,
            })),
            recentFeedback: recentFeedback.map((f) => ({
              sentiment: f.sentiment,
              messagePreview: f.messagePreview,
              createdAt: f.createdAt,
            })),
            recentRecognitions: recentRecognitions.map((r) => ({
              valueName: r.valueName,
              messagePreview: r.messagePreview,
              createdAt: r.createdAt,
            })),
            pendingFromPrevious: pendingFromPrevious.map((p) => ({ text: p.text })),
            checkinTopic: ci.topic,
          },
          userId,
        );
        const topics = (insight.content?.topics || []) as Array<{
          topic: string;
          rationale: string;
          priority: 'high' | 'med' | 'low';
        }>;
        topics.forEach((t, i) => {
          aiSuggestedTopics.push({
            id: `${insight.id}:${i}`,
            topic: t.topic,
            rationale: t.rationale,
            priority: t.priority,
            dismissed: false,
          });
        });
      } catch (err: any) {
        // No bloquea — solo log + dejar array vacío.
        this.logger.warn(
          `generateAgendaSuggestions failed for checkin ${checkinId.slice(0, 8)}: ${err?.message}`,
        );
      }
    }

    // Persistir el snapshot en el checkin.
    ci.magicAgenda = {
      pendingFromPrevious,
      okrSnapshot,
      recentFeedback,
      recentRecognitions,
      aiSuggestedTopics,
      generatedAt: new Date().toISOString(),
      generatorVersion: MAGIC_AGENDA_GENERATOR_VERSION,
    };
    const saved = await this.checkInRepo.save(ci);

    this.auditService
      .log(tenantId, userId, 'checkin.agenda_generated', 'checkin', checkinId, {
        okrs: okrSnapshot.length,
        feedback: recentFeedback.length,
        recognitions: recentRecognitions.length,
        pending: pendingFromPrevious.length,
        aiTopics: aiSuggestedTopics.length,
        force,
      })
      .catch(() => {});

    return saved;
  }

  /**
   * Permite al manager dismissear sugerencias de IA (sin regenerar).
   * Body: `{ dismissedSuggestionIds: string[] }`.
   */
  async patchMagicAgenda(
    tenantId: string,
    checkinId: string,
    userId: string,
    role: string,
    body: { dismissedSuggestionIds?: string[] },
  ): Promise<CheckIn> {
    const ci = await this.assertAccessToCheckinAgenda(tenantId, checkinId, userId, role, { requireWrite: true });
    if (!ci.magicAgenda) {
      throw new BadRequestException('El check-in no tiene una agenda generada todavía.');
    }
    const dismissed = new Set(body.dismissedSuggestionIds || []);
    ci.magicAgenda.aiSuggestedTopics = ci.magicAgenda.aiSuggestedTopics.map((t) =>
      dismissed.has(t.id) ? { ...t, dismissed: true } : t,
    );
    return this.checkInRepo.save(ci);
  }

  /**
   * Se invoca internamente al completar un check-in: si quedan actionItems
   * con `completed=false`, los guarda como `carriedOverActionItems` en el
   * próximo check-in scheduled entre los mismos 2 usuarios (si existe).
   * Si no existe próximo check-in scheduled, es no-op (el snapshot quedará
   * guardado solo cuando se cree uno nuevo — ver generateMagicAgenda que
   * lee del checkin completado más reciente).
   */
  private async snapshotPendingForNext(completedCheckin: CheckIn): Promise<void> {
    try {
      const uncompleted = (completedCheckin.actionItems || []).filter((i) => !i.completed);
      if (uncompleted.length === 0) return;

      const nextCheckin = await this.checkInRepo.findOne({
        where: {
          tenantId: completedCheckin.tenantId,
          managerId: completedCheckin.managerId,
          employeeId: completedCheckin.employeeId,
          status: In([CheckInStatus.SCHEDULED, CheckInStatus.REQUESTED]),
          scheduledDate: MoreThanOrEqual(completedCheckin.completedAt || completedCheckin.scheduledDate),
        },
        order: { scheduledDate: 'ASC' },
      });
      if (!nextCheckin) return;

      const previousDate = (completedCheckin.completedAt || completedCheckin.scheduledDate || new Date())
        .toISOString()
        .split('T')[0];

      const carryItems = uncompleted.map((item) => ({
        text: item.text,
        assigneeName: item.assigneeName,
        dueDate: item.dueDate || null,
        previousCheckinId: completedCheckin.id,
        previousCheckinDate: previousDate,
      }));

      // Append (no overwrite) — si el usuario ya preparó la agenda, los items
      // se mezclan con los existentes.
      nextCheckin.carriedOverActionItems = [
        ...(nextCheckin.carriedOverActionItems || []),
        ...carryItems,
      ];
      await this.checkInRepo.save(nextCheckin);
    } catch (err: any) {
      // No bloquea el flujo de completar check-in.
      this.logger.warn(`snapshotPendingForNext failed: ${err?.message}`);
    }
  }
}
