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
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { CheckIn } from '../feedback/entities/checkin.entity';
import { User } from '../users/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

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
 * | Trial expirado             | Diario       | trialEndsAt < now                    |
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
    @InjectRepository(DevelopmentPlan)
    private readonly planRepo: Repository<DevelopmentPlan>,
    @InjectRepository(CheckIn)
    private readonly checkinRepo: Repository<CheckIn>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly subscriptionsService: SubscriptionsService,
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

  // ─── 6. Escalación: evaluaciones vencidas → manager + admin (diario 10am) ──

  @Cron('0 10 * * *')
  async escalateOverdueEvaluations() {
    this.logger.log('[Cron] Escalating overdue evaluations...');
    try {
      const activeCycles = await this.cycleRepo.find({
        where: { status: CycleStatus.ACTIVE },
      });

      const notifications: Array<{
        tenantId: string;
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        metadata?: Record<string, any>;
      }> = [];

      for (const cycle of activeCycles) {
        const daysUntilEnd = Math.ceil(
          (new Date(cycle.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );

        // Only escalate if cycle ends in <= 3 days or is already past due
        if (daysUntilEnd > 3) continue;

        // Find evaluators who haven't submitted (still PENDING or IN_PROGRESS)
        const overdueAssignments = await this.assignmentRepo.find({
          where: [
            { cycleId: cycle.id, status: AssignmentStatus.PENDING },
            { cycleId: cycle.id, status: AssignmentStatus.IN_PROGRESS },
          ],
          relations: ['evaluator', 'evaluatee'],
        });

        if (overdueAssignments.length === 0) continue;

        // Group overdue by manager (evaluatee's manager)
        const overdueByManager = new Map<string, typeof overdueAssignments>();
        for (const a of overdueAssignments) {
          if (!a.evaluatee?.managerId) continue;
          const list = overdueByManager.get(a.evaluatee.managerId) || [];
          list.push(a);
          overdueByManager.set(a.evaluatee.managerId, list);
        }

        // Notify managers about their team's overdue evaluations
        for (const [managerId, managerAssignments] of overdueByManager.entries()) {
          const evaluatorNames = [...new Set(
            managerAssignments
              .filter((a) => a.evaluator)
              .map((a) => `${a.evaluator.firstName} ${a.evaluator.lastName}`),
          )];

          notifications.push({
            tenantId: cycle.tenantId,
            userId: managerId,
            type: NotificationType.ESCALATION_EVALUATION_OVERDUE,
            title: '⚠️ Escalación: evaluaciones vencidas en tu equipo',
            message: `El ciclo "${cycle.name}" ${daysUntilEnd <= 0 ? 'ya venció' : `cierra en ${daysUntilEnd} día(s)`}. ${evaluatorNames.length} evaluador(es) no han completado: ${evaluatorNames.slice(0, 3).join(', ')}${evaluatorNames.length > 3 ? ` y ${evaluatorNames.length - 3} más` : ''}.`,
            metadata: {
              cycleId: cycle.id,
              daysUntilEnd,
              overdueCount: managerAssignments.length,
              evaluatorNames,
            },
          });
        }

        // Notify tenant admins about total overdue
        const admins = await this.userRepo.find({
          where: { tenantId: cycle.tenantId, role: In(['tenant_admin']), isActive: true },
        });

        for (const admin of admins) {
          notifications.push({
            tenantId: cycle.tenantId,
            userId: admin.id,
            type: NotificationType.ESCALATION_EVALUATION_OVERDUE,
            title: '⚠️ Escalación: evaluaciones sin completar',
            message: `El ciclo "${cycle.name}" ${daysUntilEnd <= 0 ? 'ya venció' : `cierra en ${daysUntilEnd} día(s)`} y hay ${overdueAssignments.length} evaluación(es) pendiente(s).`,
            metadata: {
              cycleId: cycle.id,
              daysUntilEnd,
              totalOverdue: overdueAssignments.length,
            },
          });
        }
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} escalation notifications`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in escalateOverdueEvaluations: ${error}`);
    }
  }

  // ─── 7. Escalación: acciones PDI vencidas > 7 días → manager (diario 10:30am) ──

  @Cron('30 10 * * *')
  async escalateOverduePDIActions() {
    this.logger.log('[Cron] Escalating overdue PDI actions to managers...');
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const overdueActions = await this.actionRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.plan', 'p')
        .leftJoinAndSelect('p.user', 'u')
        .where('a.status != :completed', { completed: 'completada' })
        .andWhere('a.due_date IS NOT NULL')
        .andWhere('a.due_date < :sevenDaysAgo', { sevenDaysAgo: sevenDaysAgo.toISOString().split('T')[0] })
        .andWhere('p.status = :active', { active: 'activo' })
        .getMany();

      // Group by manager
      const byManager = new Map<string, Array<{ userName: string; actionDesc: string; daysOverdue: number }>>();
      for (const action of overdueActions) {
        const user = action.plan?.user;
        if (!user?.managerId) continue;

        const daysOverdue = action.dueDate
          ? Math.floor((Date.now() - new Date(action.dueDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const list = byManager.get(user.managerId) || [];
        list.push({
          userName: `${user.firstName} ${user.lastName}`,
          actionDesc: (action.description || '').substring(0, 60),
          daysOverdue,
        });
        byManager.set(user.managerId, list);
      }

      const notifications: Array<{
        tenantId: string;
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        metadata?: Record<string, any>;
      }> = [];

      for (const [managerId, items] of byManager.entries()) {
        const user = overdueActions.find((a) => a.plan?.user?.managerId === managerId)?.plan?.user;
        if (!user) continue;

        notifications.push({
          tenantId: user.tenantId,
          userId: managerId,
          type: NotificationType.ESCALATION_PDI_OVERDUE,
          title: '⚠️ Escalación: acciones de desarrollo vencidas',
          message: `${items.length} acción(es) de desarrollo de tu equipo llevan más de 7 días vencidas. Empleados afectados: ${[...new Set(items.map((i) => i.userName))].slice(0, 3).join(', ')}.`,
          metadata: { overdueItems: items },
        });
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} PDI escalation notifications`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in escalateOverduePDIActions: ${error}`);
    }
  }

  // ─── 8. Escalación: objetivos críticos (<20% con < 7 días) → manager (diario 11am) ──

  @Cron('0 11 * * *')
  async escalateCriticalObjectives() {
    this.logger.log('[Cron] Escalating critical objectives...');
    try {
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      const criticalObjectives = await this.objectiveRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.user', 'u')
        .where('o.status = :status', { status: ObjectiveStatus.ACTIVE })
        .andWhere('o.progress < :threshold', { threshold: 20 })
        .andWhere('o.target_date IS NOT NULL')
        .andWhere('o.target_date <= :deadline', { deadline: sevenDaysFromNow.toISOString().split('T')[0] })
        .getMany();

      // Group by manager
      const byManager = new Map<string, typeof criticalObjectives>();
      for (const obj of criticalObjectives) {
        if (!obj.user?.managerId) continue;
        const list = byManager.get(obj.user.managerId) || [];
        list.push(obj);
        byManager.set(obj.user.managerId, list);
      }

      const notifications: Array<{
        tenantId: string;
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        metadata?: Record<string, any>;
      }> = [];

      for (const [managerId, objs] of byManager.entries()) {
        const first = objs[0];
        notifications.push({
          tenantId: first.tenantId,
          userId: managerId,
          type: NotificationType.ESCALATION_OBJECTIVE_CRITICAL,
          title: '🔴 Objetivos críticos en tu equipo',
          message: `${objs.length} objetivo(s) de tu equipo tienen menos de 20% de avance y vencen en menos de 7 días. Requieren atención inmediata.`,
          metadata: {
            objectives: objs.map((o) => ({
              id: o.id,
              title: o.title,
              progress: o.progress,
              userName: o.user ? `${o.user.firstName} ${o.user.lastName}` : null,
              targetDate: o.targetDate,
            })),
          },
        });
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} critical objective escalations`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in escalateCriticalObjectives: ${error}`);
    }
  }

  // ─── 10. PDI obligatorio 30 días post-evaluación (diario 7:30am) ────

  @Cron('30 7 * * *')
  async remindPDIRequired() {
    this.logger.log('[Cron] Checking PDI requirement post-evaluation...');
    try {
      // Find cycles closed in the last 30 days (use endDate as proxy for close date)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const closedInWindow = await this.cycleRepo.find({
        where: {
          status: CycleStatus.CLOSED,
          endDate: MoreThanOrEqual(thirtyDaysAgo),
        },
      });

      const notifications: Array<{
        tenantId: string; userId: string; type: NotificationType;
        title: string; message: string; metadata?: Record<string, any>;
      }> = [];

      for (const cycle of closedInWindow) {
        // Get all evaluated employees in this cycle
        const assignments = await this.assignmentRepo.find({
          where: { cycleId: cycle.id, status: AssignmentStatus.COMPLETED },
          select: ['evaluateeId', 'tenantId'],
        });
        const evaluatedUserIds = [...new Set(assignments.map((a) => a.evaluateeId))];

        if (evaluatedUserIds.length === 0) continue;

        // Check which ones DON'T have a PDI
        const existingPlans = await this.planRepo.find({
          where: { tenantId: cycle.tenantId, cycleId: cycle.id },
          select: ['userId'],
        });
        const usersWithPlan = new Set(existingPlans.map((p) => p.userId));
        const usersWithoutPlan = evaluatedUserIds.filter((uid) => !usersWithPlan.has(uid));

        if (usersWithoutPlan.length === 0) continue;

        // Get their managers
        const users = await this.userRepo.find({
          where: { id: In(usersWithoutPlan), tenantId: cycle.tenantId, isActive: true },
          select: ['id', 'firstName', 'lastName', 'managerId'],
        });

        // Group by manager
        const byManager = new Map<string, string[]>();
        for (const user of users) {
          if (!user.managerId) continue;
          const list = byManager.get(user.managerId) || [];
          list.push(`${user.firstName} ${user.lastName}`);
          byManager.set(user.managerId, list);
        }

        for (const [managerId, employeeNames] of byManager.entries()) {
          notifications.push({
            tenantId: cycle.tenantId,
            userId: managerId,
            type: NotificationType.PDI_REQUIRED,
            title: 'Plan de desarrollo requerido',
            message: `${employeeNames.length} colaborador(es) evaluados en "${cycle.name}" aún no tienen plan de desarrollo: ${employeeNames.slice(0, 3).join(', ')}${employeeNames.length > 3 ? ` y ${employeeNames.length - 3} más` : ''}.`,
            metadata: { cycleId: cycle.id, usersWithoutPlan: usersWithoutPlan.slice(0, 10) },
          });
        }
      }

      if (notifications.length > 0) {
        await this.notificationsService.createBulk(notifications);
        this.logger.log(`[Cron] Created ${notifications.length} PDI-required reminders`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindPDIRequired: ${error}`);
    }
  }

  // ─── 11. Limpieza de notificaciones viejas (domingo 3am) ─────────────

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

  // ─── 12. Expiración automática de trials (diario 1am) ──────────────

  @Cron('0 1 * * *')
  async expireTrialSubscriptions() {
    this.logger.log('[Cron] Checking expired trial subscriptions...');
    try {
      const count = await this.subscriptionsService.expireTrials();
      if (count > 0) {
        this.logger.log(`[Cron] Expired ${count} trial subscriptions`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in expireTrialSubscriptions: ${error}`);
    }
  }
}
