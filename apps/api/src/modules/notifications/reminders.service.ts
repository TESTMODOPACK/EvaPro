import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './entities/notification.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { CheckIn } from '../feedback/entities/checkin.entity';
import { User } from '../users/entities/user.entity';

/**
 * Servicio de recordatorios automáticos.
 *
 * Ejecuta tareas cron periódicas que generan notificaciones in-app
 * basadas en reglas de negocio:
 *
 * | Evento                     | Frecuencia   | Trigger                              |
 * |----------------------------|------------- |--------------------------------------|
 * | Evaluación pendiente       | Cada 6 horas | Asignación IN_PROGRESS + ciclo activo |
 * | Ciclo próximo a cerrar     | Diario       | endDate - 5 días                     |
 * | Objetivo en riesgo         | Diario       | progress < 40% + activo              |
 * | Acción PDI vencida         | Diario       | dueDate pasado + no completada       |
 * | Check-in sin realizar      | Semanal      | Último check-in > 14 días            |
 * | Limpieza de notificaciones | Semanal      | Leídas > 90 días                     |
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(DevelopmentAction)
    private readonly actionRepo: Repository<DevelopmentAction>,
    @InjectRepository(CheckIn)
    private readonly checkinRepo: Repository<CheckIn>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── 1. Evaluaciones pendientes (cada 6 horas) ───────────────────────

  @Cron(CronExpression.EVERY_6_HOURS)
  async remindPendingEvaluations() {
    this.logger.log('[Cron] Checking pending evaluations...');
    try {
      const activeCycles = await this.cycleRepo.find({
        where: { status: CycleStatus.ACTIVE },
      });

      for (const cycle of activeCycles) {
        const pendingAssignments = await this.assignmentRepo.find({
          where: { cycleId: cycle.id, status: AssignmentStatus.IN_PROGRESS },
          relations: ['evaluator'],
        });

        const notifications = pendingAssignments
          .filter((a) => a.evaluator)
          .map((a) => ({
            tenantId: a.tenantId,
            userId: a.evaluatorId,
            type: NotificationType.EVALUATION_PENDING,
            title: 'Evaluación pendiente',
            message: `Tienes una evaluación pendiente en el ciclo "${cycle.name}". Complétala antes del ${new Date(cycle.endDate).toLocaleDateString('es-CL')}.`,
            metadata: { cycleId: cycle.id, assignmentId: a.id },
          }));

        if (notifications.length > 0) {
          await this.notificationsService.createBulk(notifications);
          this.logger.log(`[Cron] Created ${notifications.length} evaluation reminders for cycle ${cycle.name}`);
        }
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindPendingEvaluations: ${error}`);
    }
  }

  // ─── 2. Ciclos próximos a cerrar (diario a las 8am) ─────────────────

  @Cron('0 8 * * *')
  async remindCycleClosing() {
    this.logger.log('[Cron] Checking cycles closing soon...');
    try {
      const fiveDaysFromNow = new Date();
      fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
      const today = new Date();

      const closingCycles = await this.cycleRepo.find({
        where: {
          status: CycleStatus.ACTIVE,
          endDate: LessThanOrEqual(fiveDaysFromNow),
        },
      });

      for (const cycle of closingCycles) {
        if (new Date(cycle.endDate) < today) continue; // Already past

        const admins = await this.userRepo.find({
          where: { tenantId: cycle.tenantId, role: In(['tenant_admin']), isActive: true },
        });

        const daysLeft = Math.ceil(
          (new Date(cycle.endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

        const notifications = admins.map((admin) => ({
          tenantId: cycle.tenantId,
          userId: admin.id,
          type: NotificationType.CYCLE_CLOSING,
          title: 'Ciclo próximo a cerrar',
          message: `El ciclo "${cycle.name}" cierra en ${daysLeft} día(s). Verifica que todas las evaluaciones estén completadas.`,
          metadata: { cycleId: cycle.id, daysLeft },
        }));

        if (notifications.length > 0) {
          await this.notificationsService.createBulk(notifications);
        }
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindCycleClosing: ${error}`);
    }
  }

  // ─── 3. Objetivos en riesgo (diario a las 9am) ──────────────────────

  @Cron('0 9 * * *')
  async remindObjectivesAtRisk() {
    this.logger.log('[Cron] Checking objectives at risk...');
    try {
      const atRisk = await this.objectiveRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.user', 'u')
        .where('o.status = :status', { status: ObjectiveStatus.ACTIVE })
        .andWhere('o.progress < :threshold', { threshold: 40 })
        .andWhere('o.target_date IS NOT NULL')
        .getMany();

      const notifications: Array<{
        tenantId: string;
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        metadata?: Record<string, any>;
      }> = [];

      for (const obj of atRisk) {
        const daysLeft = obj.targetDate
          ? Math.ceil((new Date(obj.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;

        if (daysLeft !== null && daysLeft > 30) continue; // Only alert if < 30 days left

        notifications.push({
          tenantId: obj.tenantId,
          userId: obj.userId,
          type: NotificationType.OBJECTIVE_AT_RISK,
          title: 'Objetivo en riesgo',
          message: `Tu objetivo "${obj.title}" tiene ${obj.progress}% de avance${daysLeft !== null ? ` y faltan ${daysLeft} día(s)` : ''}. Revisa tu progreso.`,
          metadata: { objectiveId: obj.id, progress: obj.progress },
        });
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} objective-at-risk reminders`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindObjectivesAtRisk: ${error}`);
    }
  }

  // ─── 4. Acciones PDI vencidas (diario a las 9:30am) ─────────────────

  @Cron('30 9 * * *')
  async remindOverduePDIActions() {
    this.logger.log('[Cron] Checking overdue PDI actions...');
    try {
      const today = new Date();
      const overdueActions = await this.actionRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.plan', 'p')
        .where('a.status != :completed', { completed: 'completada' })
        .andWhere('a.due_date IS NOT NULL')
        .andWhere('a.due_date < :today', { today: today.toISOString().split('T')[0] })
        .andWhere('p.status = :active', { active: 'activo' })
        .getMany();

      const notifications = overdueActions
        .filter((a) => a.plan)
        .map((a) => ({
          tenantId: a.tenantId,
          userId: a.plan.userId,
          type: NotificationType.PDI_ACTION_DUE,
          title: 'Acción de desarrollo vencida',
          message: `La acción "${(a.description || '').substring(0, 80)}" de tu plan de desarrollo está vencida. Actualiza su estado.`,
          metadata: { planId: a.planId, actionId: a.id },
        }));

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} overdue PDI action reminders`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindOverduePDIActions: ${error}`);
    }
  }

  // ─── 5. Check-ins sin realizar (semanal, lunes 8am) ─────────────────

  @Cron('0 8 * * 1')
  async remindOverdueCheckins() {
    this.logger.log('[Cron] Checking overdue check-ins...');
    try {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      // Find managers who haven't had a check-in in 14+ days
      const managers = await this.userRepo.find({
        where: { role: In(['manager', 'tenant_admin']), isActive: true },
      });

      const notifications: Array<{
        tenantId: string;
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        metadata?: Record<string, any>;
      }> = [];

      for (const manager of managers) {
        const lastCheckin = await this.checkinRepo.findOne({
          where: { tenantId: manager.tenantId, managerId: manager.id },
          order: { scheduledDate: 'DESC' },
        });

        const lastDate = lastCheckin ? new Date(lastCheckin.scheduledDate) : null;
        if (!lastDate || lastDate < fourteenDaysAgo) {
          const daysSince = lastDate
            ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
            : null;

          notifications.push({
            tenantId: manager.tenantId,
            userId: manager.id,
            type: NotificationType.CHECKIN_OVERDUE,
            title: 'Check-in pendiente',
            message: daysSince
              ? `Han pasado ${daysSince} días desde tu último check-in. Agenda una reunión 1:1 con tu equipo.`
              : 'No tienes check-ins registrados. Agenda una reunión 1:1 con tu equipo.',
            metadata: { daysSince },
          });
        }
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} check-in reminders`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindOverdueCheckins: ${error}`);
    }
  }

  // ─── 6. Limpieza de notificaciones viejas (domingo 3am) ─────────────

  @Cron('0 3 * * 0')
  async cleanupOldNotifications() {
    this.logger.log('[Cron] Cleaning up old notifications...');
    try {
      const deleted = await this.notificationsService.deleteOlderThan(90);
      this.logger.log(`[Cron] Deleted ${deleted} read notifications older than 90 days`);
    } catch (error) {
      this.logger.error(`[Cron] Error in cleanupOldNotifications: ${error}`);
    }
  }
}
