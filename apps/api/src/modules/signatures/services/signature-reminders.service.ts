import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { SignatureReminderSent } from '../entities/signature-reminder-sent.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle, CycleStatus } from '../../evaluations/entities/evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { runWithCronLock } from '../../../common/utils/cron-lock';
import { TenantCronRunner } from '../../../common/rls/tenant-cron-runner';

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
    // Mejora #5 — DataSource para advisory lock (anti race entre replicas).
    // TenantCronRunner para iterar tenants activos con app.current_tenant_id
    // seteado (defense vs RLS cuando se active).
    private readonly dataSource: DataSource,
    private readonly tenantCronRunner: TenantCronRunner,
  ) {}

  /**
   * Mejora #5 — Cron job diario que dispara processTenant por cada tenant
   * activo. Corre a las 9:00 AM (timezone del server). El advisory lock
   * via runWithCronLock previene que dos replicas de la API ejecuten el
   * mismo cron simultaneamente (en deployment multi-replica de Render).
   *
   * Las firmas pendientes con D+3/D+7/D+15 reciben recordatorio escalonado.
   * Idempotencia garantizada por la tabla signature_reminders_sent (UNIQUE
   * constraint), asi que reintento manual o restart del worker no genera
   * duplicados.
   */
  @Cron('0 9 * * *')
  async runDailyReminders(): Promise<void> {
    await runWithCronLock(
      'signatureRemindersDaily',
      this.dataSource,
      this.logger,
      async () => {
        this.logger.log('[Cron signatureRemindersDaily] start');
        const totals = { 3: 0, 7: 0, 15: 0 };
        const results = await this.tenantCronRunner.runForEachTenant(
          'signatureRemindersDaily',
          async (tenantId) => {
            return this.processTenant(tenantId);
          },
        );
        // Agregar contadores para visibilidad en logs
        for (const r of results) {
          if (!r) continue;
          totals[3] += r.sent[3];
          totals[7] += r.sent[7];
          totals[15] += r.sent[15];
        }
        this.logger.log(
          `[Cron signatureRemindersDaily] done — L3=${totals[3]} L7=${totals[7]} L15=${totals[15]}`,
        );
      },
    );
  }

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

    // B3 fix: ventana extendida a 30 días para cubrir outages del worker.
    // El loop por nivel + idempotencia previenen duplicados; el cutoff
    // amplio asegura que un L15 atrasado por outage del cron aún se envíe.
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const closedCycles = await this.cycleRepo.find({
      where: { tenantId, status: CycleStatus.CLOSED, endDate: LessThanOrEqual(now) },
    });

    for (const cycle of closedCycles) {
      // Días transcurridos desde el endDate del ciclo (proxy de "cierre").
      const cycleEnd = new Date(cycle.endDate);
      if (cycleEnd < cutoff) continue;
      const daysSince = Math.floor((now.getTime() - cycleEnd.getTime()) / (24 * 60 * 60 * 1000));

      if (daysSince < 3) continue; // ningún nivel ha sido alcanzado

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

        // B3 fix: traer TODOS los niveles ya enviados para (doc, user)
        // y elegir el LOWEST unsent reached. Esto:
        //  - Garantiza que cada nivel se envía exactamente 1 vez
        //  - Si el worker estuvo caído, "catch up" desde el nivel más bajo
        //    no enviado en la próxima ejecución (en runs sucesivos)
        const sentRecords = await this.reminderRepo.find({
          where: {
            documentType: 'evaluation_response',
            documentId: responseId,
            userId: evaluateeId,
          },
          select: ['reminderLevel'],
        });
        const sentLevels = new Set(sentRecords.map((r) => r.reminderLevel));
        const applicableLevel = this.pickNextLevel(daysSince, sentLevels);
        if (applicableLevel === null) {
          // Ya se enviaron todos los aplicables, o ninguno alcanzado
          for (const lvl of REMINDER_LEVELS) {
            if (sentLevels.has(lvl) && daysSince >= lvl) skipped[lvl]++;
          }
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

  /**
   * B3 fix: devuelve el nivel MÁS BAJO no enviado que ya fue alcanzado.
   *
   * Esto garantiza que:
   *  - Cada nivel se envía exactamente 1 vez por (doc, user).
   *  - Si el worker estuvo caído (ej. outage de 5 días), al recuperarse
   *    envía el siguiente nivel pendiente. En runs sucesivos enviará los
   *    superiores, asegurando todos los recordatorios.
   *  - No spamea: 1 sola notificación por ejecución por (doc, user).
   *
   * Ejemplos:
   *  - daysSince=3, sentLevels={} → 3
   *  - daysSince=8, sentLevels={3} → 7
   *  - daysSince=8, sentLevels={3, 7} → null (15 aún no alcanzado)
   *  - daysSince=20, sentLevels={3, 7} → 15
   *  - daysSince=20, sentLevels={3, 7, 15} → null (todos enviados)
   */
  private pickNextLevel(daysSince: number, sentLevels: Set<number>): ReminderLevel | null {
    for (const level of REMINDER_LEVELS) {
      if (daysSince >= level && !sentLevels.has(level)) return level;
    }
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
