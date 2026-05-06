import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { SignatureReminderSent } from '../entities/signature-reminder-sent.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle, CycleStatus } from '../../evaluations/entities/evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';

const REMINDER_LEVELS = [3, 7, 15] as const;
type ReminderLevel = (typeof REMINDER_LEVELS)[number];

const TEMPLATES: Record<ReminderLevel, { title: string; tone: string }> = {
  3: {
    title: 'Recordatorio: firma de tu evaluación pendiente',
    tone: 'Hola, te recordamos que tu evaluación está esperando tu firma. Toma 1 minuto.',
  },
  7: {
    title: 'Tu evaluación sigue pendiente de firma',
    tone: 'Han pasado 7 días desde el cierre del ciclo y tu evaluación aún no ha sido firmada. Por favor revísala.',
  },
  15: {
    title: 'URGENTE: Tu evaluación sigue sin firma (15 días)',
    tone: 'Tu evaluación lleva 15 días sin firma. RRHH ha sido notificado para hacer seguimiento contigo.',
  },
};

/**
 * SignatureRemindersService — TAREA 10 / G11.
 *
 * Servicio para enviar recordatorios escalonados de firma de evaluación
 * a empleados que no han firmado tras el cierre de un ciclo.
 *
 * Niveles: D+3 (amistoso), D+7 (firme), D+15 (escalado a tenant_admin
 * vía notificación adicional al tenant).
 *
 * Idempotencia: la tabla signature_reminders_sent tiene unique constraint
 * (documentType, documentId, userId, reminderLevel). Reintentar el mismo
 * recordatorio simplemente no reenvía.
 *
 * Multi-tenant: invocar `processTenant(tenantId)` por cada tenant activo.
 * El método NO se auto-dispara con @Cron en este release — se expone
 * como API para que un job futuro o llamada admin manual lo invoque.
 */
@Injectable()
export class SignatureRemindersService {
  private readonly logger = new Logger(SignatureRemindersService.name);

  constructor(
    @InjectRepository(SignatureReminderSent)
    private readonly reminderRepo: Repository<SignatureReminderSent>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Procesa recordatorios pendientes para un tenant. Identifica
   * evaluation_responses con recipientSignedAt IS NULL cuyo ciclo
   * cerró hace 3/7/15 días, y envía recordatorios no enviados aún.
   *
   * @returns conteo de recordatorios enviados por nivel.
   */
  async processTenant(tenantId: string, now: Date = new Date()): Promise<{
    sent: Record<ReminderLevel, number>;
    skipped: Record<ReminderLevel, number>;
  }> {
    const sent: Record<ReminderLevel, number> = { 3: 0, 7: 0, 15: 0 };
    const skipped: Record<ReminderLevel, number> = { 3: 0, 7: 0, 15: 0 };

    // Ciclos cerrados en los últimos 16 días (ventana suficiente para D+15)
    const cutoff = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000);
    const closedCycles = await this.cycleRepo.find({
      where: { tenantId, status: CycleStatus.CLOSED, endDate: LessThanOrEqual(now) },
    });

    for (const cycle of closedCycles) {
      // Días transcurridos desde el endDate del ciclo (proxy de "cierre").
      const cycleEnd = new Date(cycle.endDate);
      if (cycleEnd < cutoff) continue;
      const daysSince = Math.floor((now.getTime() - cycleEnd.getTime()) / (24 * 60 * 60 * 1000));

      // Determinar el nivel APLICABLE — el más alto que ya correspondió.
      const applicableLevel = this.pickLevel(daysSince);
      if (applicableLevel === null) continue;

      // Encontrar evaluatees con evaluation_response sin firma de recipient
      const pendingResponses = await this.responseRepo
        .createQueryBuilder('er')
        .innerJoin(EvaluationAssignment, 'ea', 'ea.id = er.assignmentId')
        .where('er.tenantId = :tenantId', { tenantId })
        .andWhere('ea.cycleId = :cycleId', { cycleId: cycle.id })
        .andWhere('er.recipientSignedAt IS NULL')
        .select(['er.id', 'ea.evaluateeId'])
        .getRawMany();

      for (const row of pendingResponses) {
        const responseId = row.er_id;
        const evaluateeId = row.ea_evaluateeId;
        if (!responseId || !evaluateeId) continue;

        // Idempotencia: chequear si ya enviamos ESTE nivel para este (doc,user)
        const exists = await this.reminderRepo.findOne({
          where: {
            documentType: 'evaluation_response',
            documentId: responseId,
            userId: evaluateeId,
            reminderLevel: applicableLevel,
          },
        });
        if (exists) {
          skipped[applicableLevel]++;
          continue;
        }

        // Enviar notificación in-app
        const tpl = TEMPLATES[applicableLevel];
        try {
          await this.notificationsService.create({
            tenantId,
            userId: evaluateeId,
            type: 'evaluation_signature_reminder' as any,
            title: tpl.title,
            message: tpl.tone,
            metadata: {
              cycleId: cycle.id,
              documentType: 'evaluation_response',
              documentId: responseId,
              reminderLevel: applicableLevel,
            },
          });

          // Persistir tracking
          await this.reminderRepo.save(
            this.reminderRepo.create({
              tenantId,
              documentType: 'evaluation_response',
              documentId: responseId,
              userId: evaluateeId,
              reminderLevel: applicableLevel,
            }),
          );
          sent[applicableLevel]++;

          // D+15: notificar también a tenant_admin para escalado
          if (applicableLevel === 15) {
            await this.notifyTenantAdmins(tenantId, cycle.id, evaluateeId, responseId);
          }
        } catch (err) {
          this.logger.warn(
            `Failed to send reminder L=${applicableLevel} for resp=${responseId}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { sent, skipped };
  }

  /** Devuelve el nivel aplicable (3/7/15) o null si daysSince está fuera de ventana. */
  private pickLevel(daysSince: number): ReminderLevel | null {
    // Ventana de 1 día a cada nivel para tolerar variación en hora de ejecución.
    if (daysSince >= 15 && daysSince < 16) return 15;
    if (daysSince >= 7 && daysSince < 8) return 7;
    if (daysSince >= 3 && daysSince < 4) return 3;
    return null;
  }

  /** Escalado D+15: notifica a todos los tenant_admin del tenant. */
  private async notifyTenantAdmins(
    tenantId: string, cycleId: string, evaluateeId: string, responseId: string,
  ) {
    const admins = await this.userRepo.find({
      where: { tenantId, role: 'tenant_admin', isActive: true },
      select: ['id'],
    });
    if (admins.length === 0) return;
    const evaluatee = await this.userRepo.findOne({
      where: { id: evaluateeId, tenantId },
      select: ['firstName', 'lastName'],
    });
    const evaluateeLabel = evaluatee
      ? `${evaluatee.firstName} ${evaluatee.lastName}`
      : 'un colaborador';

    for (const admin of admins) {
      try {
        await this.notificationsService.create({
          tenantId,
          userId: admin.id,
          type: 'evaluation_signature_overdue' as any,
          title: 'Firma de evaluación atrasada (15 días)',
          message: `${evaluateeLabel} no ha firmado su evaluación tras 15 días del cierre del ciclo. Considera hacer seguimiento.`,
          metadata: { cycleId, documentType: 'evaluation_response', documentId: responseId, evaluateeId },
        });
      } catch {
        // Best-effort
      }
    }
  }
}
