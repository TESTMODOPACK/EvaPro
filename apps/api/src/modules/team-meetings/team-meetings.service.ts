import {
  BadRequestException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { runWithCronLock } from '../../common/utils/cron-lock';
import { TeamMeeting, TeamMeetingStatus } from './entities/team-meeting.entity';
import {
  ParticipantStatus,
  TeamMeetingParticipant,
} from './entities/team-meeting-participant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import {
  AddAgendaTopicDto, CancelTeamMeetingDto, CompleteTeamMeetingDto,
  CreateTeamMeetingDto, RespondInvitationDto, UpdateTeamMeetingDto,
} from './dto/team-meeting.dto';

/**
 * v3.1 Tema B — Service para reuniones de equipo (N participantes).
 *
 * Decisiones importantes:
 *   - Separado de FeedbackService (CheckIn queda 1:1 puro).
 *   - Usa mismo pool de MeetingLocation (no duplicar catálogo).
 *   - Sin emails/push en esta PR (deferido; la infra existente de
 *     feedback se puede reusar en un próximo sprint).
 *   - Sin integración IA (la prompt actual es 1:1; deferido).
 */
@Injectable()
export class TeamMeetingsService {
  private readonly logger = new Logger(TeamMeetingsService.name);

  constructor(
    @InjectRepository(TeamMeeting)
    private readonly meetingRepo: Repository<TeamMeeting>,
    @InjectRepository(TeamMeetingParticipant)
    private readonly participantRepo: Repository<TeamMeetingParticipant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Date helpers (consistentes con FeedbackService.assertFutureScheduledDatetime) ──

  private assertFutureScheduledDatetime(
    scheduledDate: string | Date | undefined,
    scheduledTime?: string | null,
  ): void {
    if (!scheduledDate) return;
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
      throw new BadRequestException('La fecha de la reunión no puede ser anterior a hoy.');
    }
    if (dateStr > todayStr) return;

    if (scheduledTime) {
      const [hh, mm] = scheduledTime.split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);
        if (scheduled.getTime() < now.getTime() - 60_000) {
          throw new BadRequestException(
            'La hora de la reunión ya pasó. Programa una hora futura.',
          );
        }
      }
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  async createMeeting(
    tenantId: string,
    organizerId: string,
    dto: CreateTeamMeetingDto,
  ): Promise<TeamMeeting> {
    this.assertFutureScheduledDatetime(dto.scheduledDate, dto.scheduledTime);

    // Validar que todos los participantIds existen en el tenant y están activos.
    // Filtramos al propio organizer de la lista — se autoincluye siempre como
    // participant "accepted" al crear, sin ocupar slot de invitación.
    const uniqueIds = Array.from(new Set(dto.participantIds.filter((id) => id !== organizerId)));
    if (uniqueIds.length === 0) {
      throw new BadRequestException(
        'Debes invitar al menos 1 participante distinto a ti.',
      );
    }
    const users = await this.userRepo.find({
      where: { id: In(uniqueIds), tenantId },
      select: ['id', 'isActive'],
    });
    if (users.length !== uniqueIds.length) {
      throw new BadRequestException(
        'Uno o más participantes no pertenecen a la organización o no existen.',
      );
    }
    const inactive = users.filter((u) => !u.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        'No puedes invitar a colaboradores inactivos.',
      );
    }

    // Transacción: meeting + participants (+ el organizer auto-aceptado).
    const meeting = await this.dataSource.transaction(async (mgr) => {
      const m = mgr.getRepository(TeamMeeting).create({
        tenantId,
        organizerId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        scheduledDate: new Date(dto.scheduledDate),
        scheduledTime: dto.scheduledTime || null,
        locationId: dto.locationId || null,
        status: TeamMeetingStatus.SCHEDULED,
      });
      const saved = await mgr.getRepository(TeamMeeting).save(m);

      // Organizer es participante auto-aceptado.
      const parts: Partial<TeamMeetingParticipant>[] = [
        {
          meetingId: saved.id,
          userId: organizerId,
          status: ParticipantStatus.ACCEPTED,
          respondedAt: new Date(),
        },
        ...uniqueIds.map((uid) => ({
          meetingId: saved.id,
          userId: uid,
          status: ParticipantStatus.INVITED,
        })),
      ];
      await mgr.getRepository(TeamMeetingParticipant).save(parts);

      return saved;
    });

    await this.auditService
      .log(tenantId, organizerId, 'team_meeting.created', 'team_meeting', meeting.id, {
        title: dto.title,
        participantCount: uniqueIds.length + 1,
      })
      .catch(() => undefined);

    return this.getMeetingById(tenantId, meeting.id, organizerId, 'organizer');
  }

  /**
   * Lista reuniones visibles para el caller.
   *   - admin/super_admin: todas del tenant.
   *   - otro rol: reuniones donde es organizer O participant.
   */
  async listMeetings(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<TeamMeeting[]> {
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    const qb = this.meetingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.organizer', 'organizer', 'organizer.tenant_id = m.tenant_id')
      .leftJoinAndSelect('m.location', 'location')
      .leftJoinAndSelect('m.participants', 'p')
      .leftJoinAndSelect('p.user', 'pu', 'pu.tenant_id = m.tenant_id')
      .where('m.tenantId = :tenantId', { tenantId })
      .orderBy('m.scheduledDate', 'DESC')
      .addOrderBy('m.createdAt', 'DESC');

    if (!isAdmin) {
      // visibility: organizer o participante.
      qb.andWhere(
        '(m.organizerId = :userId OR EXISTS (SELECT 1 FROM team_meeting_participants tmp WHERE tmp.meeting_id = m.id AND tmp.user_id = :userId))',
        { userId },
      );
    }

    return qb.take(200).getMany();
  }

  async getMeetingById(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
  ): Promise<TeamMeeting> {
    const m = await this.meetingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.organizer', 'organizer', 'organizer.tenant_id = m.tenant_id')
      .leftJoinAndSelect('m.location', 'location')
      .leftJoinAndSelect('m.participants', 'p')
      .leftJoinAndSelect('p.user', 'pu', 'pu.tenant_id = m.tenant_id')
      .where('m.id = :id AND m.tenantId = :tenantId', { id: meetingId, tenantId })
      .getOne();
    if (!m) throw new NotFoundException('Reunión no encontrada');

    // Bug fix: `role === 'organizer'` era dead code — el role JWT nunca
    // tiene ese valor. Se cubre con el check explícito `isOrganizer`.
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    const isOrganizer = m.organizerId === userId;
    const isParticipant = (m.participants || []).some((p) => p.userId === userId);
    if (!isAdmin && !isOrganizer && !isParticipant) {
      throw new ForbiddenException('No tienes acceso a esta reunión.');
    }
    return m;
  }

  // ─── Update / Cancel ─────────────────────────────────────────────────

  async updateMeeting(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
    dto: UpdateTeamMeetingDto,
  ): Promise<TeamMeeting> {
    // IMPORTANTE — NO cargar `relations: ['participants']` acá. Si
    // cargamos la relación OneToMany y después llamamos `meetingRepo.save(m)`,
    // TypeORM intenta "reconciliar" los participants en memoria con la BD:
    //   - Para los borrados vía participantRepo.delete(), trata de
    //     desasociarlos con UPDATE SET meeting_id = NULL → explota el
    //     NOT NULL constraint.
    // Fix: tratar a la meeting como entity plana y manejar participants
    // con su propio repo (consultas independientes para el diff).
    const m = await this.meetingRepo.findOne({
      where: { id: meetingId, tenantId },
    });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    if (!isAdmin && m.organizerId !== userId) {
      throw new ForbiddenException('Solo el organizador o un admin puede editar.');
    }
    if (m.status !== TeamMeetingStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden editar reuniones programadas.');
    }

    // Si se reprograma, validar fecha/hora futuras con merge.
    if (dto.scheduledDate !== undefined || dto.scheduledTime !== undefined) {
      const mergedDate: string | Date = dto.scheduledDate ?? m.scheduledDate;
      const mergedTime = dto.scheduledTime !== undefined ? dto.scheduledTime : m.scheduledTime;
      this.assertFutureScheduledDatetime(mergedDate, mergedTime);
    }

    if (dto.title !== undefined) m.title = dto.title.trim();
    if (dto.description !== undefined) m.description = dto.description?.trim() || null;
    if (dto.scheduledDate !== undefined) m.scheduledDate = new Date(dto.scheduledDate);
    if (dto.scheduledTime !== undefined) m.scheduledTime = dto.scheduledTime || null;
    if (dto.locationId !== undefined) m.locationId = dto.locationId || null;

    // Si se cambian participantes: diff add/remove con un query fresco
    // al participantRepo (NO usamos m.participants porque m no tiene la
    // relación cargada — intencional, ver nota arriba). No tocamos los
    // que ya aceptaron/rechazaron; solo agregamos nuevos invited y
    // eliminamos los que se excluyeron. El organizer nunca se toca.
    if (dto.participantIds !== undefined) {
      const currentParts = await this.participantRepo.find({
        where: { meetingId: m.id },
        select: ['id', 'userId'],
      });
      const currentUserIds = new Set(currentParts.map((p) => p.userId));
      const desired = new Set(dto.participantIds.filter((id) => id !== m.organizerId));
      const toAdd = Array.from(desired).filter((id) => !currentUserIds.has(id));
      const toRemove = currentParts.filter(
        (p) => p.userId !== m.organizerId && !desired.has(p.userId),
      );

      if (toAdd.length > 0) {
        const users = await this.userRepo.find({
          where: { id: In(toAdd), tenantId, isActive: true },
          select: ['id'],
        });
        if (users.length !== toAdd.length) {
          throw new BadRequestException(
            'Uno o más nuevos participantes no existen o están inactivos.',
          );
        }
        await this.participantRepo.save(
          toAdd.map((uid) => ({
            meetingId: m.id,
            userId: uid,
            status: ParticipantStatus.INVITED,
          })),
        );
      }

      if (toRemove.length > 0) {
        await this.participantRepo.delete({
          id: In(toRemove.map((p) => p.id)),
        });
      }
    }

    await this.meetingRepo.save(m);
    await this.auditService
      .log(tenantId, userId, 'team_meeting.updated', 'team_meeting', meetingId, {})
      .catch(() => undefined);

    return this.getMeetingById(tenantId, meetingId, userId, role);
  }

  async cancelMeeting(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
    dto: CancelTeamMeetingDto,
  ): Promise<TeamMeeting> {
    const m = await this.meetingRepo.findOne({ where: { id: meetingId, tenantId } });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    if (!isAdmin && m.organizerId !== userId) {
      throw new ForbiddenException('Solo el organizador o un admin puede cancelar.');
    }
    if (m.status !== TeamMeetingStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden cancelar reuniones programadas.');
    }

    m.status = TeamMeetingStatus.CANCELLED;
    m.cancelledAt = new Date();
    m.cancelReason = dto.reason?.trim() || null;
    await this.meetingRepo.save(m);

    await this.auditService
      .log(tenantId, userId, 'team_meeting.cancelled', 'team_meeting', meetingId, {
        reason: dto.reason,
      })
      .catch(() => undefined);

    return this.getMeetingById(tenantId, meetingId, userId, role);
  }

  async completeMeeting(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
    dto: CompleteTeamMeetingDto,
  ): Promise<TeamMeeting> {
    const m = await this.meetingRepo.findOne({ where: { id: meetingId, tenantId } });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    if (!isAdmin && m.organizerId !== userId) {
      throw new ForbiddenException('Solo el organizador o un admin puede completar.');
    }
    if (m.status !== TeamMeetingStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden completar reuniones programadas.');
    }

    if (dto.notes !== undefined) m.notes = dto.notes?.trim() || null;
    if (dto.minutes !== undefined) m.minutes = dto.minutes?.trim() || null;
    if (dto.rating !== undefined) m.rating = dto.rating;
    if (dto.actionItems !== undefined) {
      m.actionItems = (dto.actionItems || [])
        .filter((i) => (i.text || '').trim())
        .map((i) => ({
          text: i.text.trim(),
          completed: i.completed === true,
          assigneeId: i.assigneeId,
          assigneeName: i.assigneeName?.trim() || undefined,
          dueDate: i.dueDate,
        }));
    }
    m.status = TeamMeetingStatus.COMPLETED;
    m.completedAt = new Date();
    await this.meetingRepo.save(m);

    await this.auditService
      .log(tenantId, userId, 'team_meeting.completed', 'team_meeting', meetingId, {
        actionItems: m.actionItems.length,
      })
      .catch(() => undefined);

    return this.getMeetingById(tenantId, meetingId, userId, role);
  }

  // ─── Participant actions ─────────────────────────────────────────────

  async respondToInvitation(
    tenantId: string,
    meetingId: string,
    userId: string,
    dto: RespondInvitationDto,
  ): Promise<TeamMeetingParticipant> {
    const m = await this.meetingRepo.findOne({ where: { id: meetingId, tenantId } });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    if (m.status !== TeamMeetingStatus.SCHEDULED) {
      throw new BadRequestException(
        'La reunión ya no está activa; no se puede responder a la invitación.',
      );
    }

    const p = await this.participantRepo.findOne({
      where: { meetingId, userId },
    });
    if (!p) throw new ForbiddenException('No eres participante de esta reunión.');
    if (userId === m.organizerId) {
      throw new BadRequestException('El organizador no responde a su propia invitación.');
    }
    if (p.status === ParticipantStatus.ACCEPTED || p.status === ParticipantStatus.DECLINED) {
      // Permitir cambiar de opinión (ej. aceptar después de haber rechazado).
      // No es idempotente pero tampoco es error.
    }

    p.status = dto.status === 'accepted'
      ? ParticipantStatus.ACCEPTED
      : ParticipantStatus.DECLINED;
    p.respondedAt = new Date();
    p.declineReason = dto.status === 'declined' ? dto.declineReason?.trim() || null : null;
    await this.participantRepo.save(p);

    await this.auditService
      .log(tenantId, userId, `team_meeting.${dto.status}`, 'team_meeting', meetingId, {})
      .catch(() => undefined);

    return p;
  }

  async addAgendaTopic(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
    dto: AddAgendaTopicDto,
  ): Promise<TeamMeeting> {
    const m = await this.meetingRepo.findOne({
      where: { id: meetingId, tenantId },
      relations: ['participants'],
    });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    if (m.status !== TeamMeetingStatus.SCHEDULED) {
      throw new BadRequestException('Solo se pueden agregar temas a reuniones programadas.');
    }
    const isOrganizer = m.organizerId === userId;
    const isParticipant = (m.participants || []).some((p) => p.userId === userId);
    if (!isOrganizer && !isParticipant) {
      throw new ForbiddenException('Solo los participantes pueden agregar temas.');
    }

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'lastName'],
    });

    const text = dto.text.trim();
    if (!text) throw new BadRequestException('El tema no puede estar vacío.');

    m.agendaTopics = [
      ...(m.agendaTopics || []),
      {
        text,
        addedBy: userId,
        addedByName: user ? `${user.firstName} ${user.lastName}` : undefined,
        addedAt: new Date().toISOString(),
      },
    ];
    await this.meetingRepo.save(m);
    // Pasa el role real (no hardcoded) para preservar la semántica de
    // permisos del caller en el getMeetingById post-mutación.
    return this.getMeetingById(tenantId, meetingId, userId, role);
  }

  /**
   * v3.1 — Edición retroactiva de una reunión COMPLETED (típicamente
   * auto-cerrada por el cron). Permite agregar notas, minuta, acuerdos
   * y rating sin cambiar el status ni el flag `autoCompleted`. Solo
   * organizador o admin.
   */
  async editCompletedMeeting(
    tenantId: string,
    meetingId: string,
    userId: string,
    role: string,
    data: {
      notes?: string;
      minutes?: string;
      rating?: number;
      actionItems?: Array<{ text: string; completed?: boolean; assigneeId?: string; assigneeName?: string; dueDate?: string }>;
    },
  ): Promise<TeamMeeting> {
    const m = await this.meetingRepo.findOne({ where: { id: meetingId, tenantId } });
    if (!m) throw new NotFoundException('Reunión no encontrada');
    if (m.status !== TeamMeetingStatus.COMPLETED) {
      throw new BadRequestException(
        'Solo se puede editar información retroactiva de reuniones completadas.',
      );
    }
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';
    if (!isAdmin && m.organizerId !== userId) {
      throw new ForbiddenException(
        'Solo el organizador o un admin puede editar la información retroactiva.',
      );
    }

    if (data.notes !== undefined) m.notes = data.notes?.trim() || null;
    if (data.minutes !== undefined) m.minutes = data.minutes?.trim() || null;
    if (data.rating !== undefined) {
      if (data.rating !== null && (data.rating < 1 || data.rating > 5)) {
        throw new BadRequestException('Rating debe estar entre 1 y 5.');
      }
      m.rating = data.rating ?? null;
    }
    if (data.actionItems !== undefined) {
      m.actionItems = (data.actionItems || [])
        .filter((i) => (i.text || '').trim())
        .map((i) => ({
          text: i.text.trim(),
          completed: i.completed === true,
          assigneeId: i.assigneeId,
          assigneeName: i.assigneeName?.trim() || undefined,
          dueDate: i.dueDate,
        }));
    }

    await this.meetingRepo.save(m);
    await this.auditService
      .log(tenantId, userId, 'team_meeting.retroactive_edit', 'team_meeting', meetingId, {
        wasAutoCompleted: m.autoCompleted,
      })
      .catch(() => undefined);
    return this.getMeetingById(tenantId, meetingId, userId, role);
  }

  /**
   * v3.1 — Cron diario que auto-completa reuniones programadas cuya
   * fecha pasó hace más de 5 días sin cierre manual. Mismo comportamiento
   * que FeedbackService.autoCompleteStaleCheckIns para check-ins 1:1.
   *
   * Corre a las 02:05 UTC (5 min después del de checkins 1:1 para
   * desacoplar la carga del cron).
   */
  @Cron('5 2 * * *')
  async autoCompleteStaleMeetings(): Promise<void> {
    await runWithCronLock(
      'team_meetings.autoCompleteStaleMeetings',
      this.dataSource,
      this.logger,
      async () => {
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - 5);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        const stale = await this.meetingRepo.find({
          where: {
            status: TeamMeetingStatus.SCHEDULED,
            scheduledDate: LessThan(new Date(cutoffStr)) as any,
          },
          select: ['id', 'tenantId', 'title', 'scheduledDate'],
        });

        if (stale.length === 0) {
          this.logger.log('[autoCompleteStaleMeetings] 0 reuniones vencidas +5d');
          return;
        }

        const autoNote =
          'Cerrada automáticamente por política de cierre de Eva360: han pasado ' +
          'más de 5 días desde la fecha programada sin registrar el resultado de la ' +
          'reunión. El organizador puede agregar retroactivamente notas, minuta, ' +
          'acuerdos y valoración desde el botón "Editar información" en esta reunión.';

        for (const m of stale) {
          try {
            await this.meetingRepo.update(
              { id: m.id },
              {
                status: TeamMeetingStatus.COMPLETED,
                autoCompleted: true,
                completedAt: new Date(),
                notes: autoNote,
              },
            );
            await this.auditService
              .log(m.tenantId, null, 'team_meeting.auto_completed', 'team_meeting', m.id, {
                title: m.title,
                scheduledDate: m.scheduledDate,
              })
              .catch(() => undefined);
          } catch (err: any) {
            this.logger.warn(
              `[autoCompleteStaleMeetings] falló cerrar ${m.id}: ${err?.message}`,
            );
          }
        }

        this.logger.log(
          `[autoCompleteStaleMeetings] auto-cerradas: ${stale.length}`,
        );
      },
    );
  }
}
