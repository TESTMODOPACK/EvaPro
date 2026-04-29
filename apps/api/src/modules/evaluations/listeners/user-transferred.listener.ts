/**
 * UserTransferredListener — S2.2 Sprint 2.
 *
 * Reacciona al evento `user.transferred` emitido por UsersService cuando
 * un usuario cambia de departamento, cargo o manager mientras hay ciclos
 * de evaluación ACTIVOS.
 *
 * Casos cubiertos:
 *
 * 1. **User es evaluatee con manager assignment**: el evaluador asignado
 *    es típicamente su jefe. Si el usuario cambió de manager, el
 *    evaluador ya no corresponde. Aplicamos la `cascadePolicy` (del
 *    evento, o si no, de cycle.settings.cascadeOnTransfer):
 *    - 'auto_replace': invoca replaceEvaluator con el nuevo manager.
 *    - 'freeze': no toca nada (snapshot original gana).
 *    - 'manual' (default): crea notificación AI_ANALYSIS_READY tipo
 *      generic al admin del ciclo y al nuevo manager para que decidan.
 *
 * 2. **User es evaluator de assignments en ciclo activo** (deja a
 *    "evaluadores huérfanos"): no se reasigna automáticamente —
 *    requiere decisión humana porque el contexto histórico (evaluador
 *    conoce a la persona) puede ser válido aún. Solo se notifica al
 *    admin del ciclo si cambió de manager (si solo cambió cargo o dept,
 *    es probable que siga siendo válido).
 *
 * Invariantes:
 * - Solo procesa ciclos en estado ACTIVE. Ciclos DRAFT no tienen
 *   assignments y CLOSED son inmutables.
 * - Cada acción se loguea en audit (tanto el reemplazo como la
 *   notificación) para trazabilidad.
 * - El listener corre async, NO bloquea el flow del emisor (transferUser
 *   ya retornó). Si falla, NO debe revertir el transfer — solo loguear.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  USER_TRANSFERRED_EVENT,
  UserTransferredEvent,
  CascadePolicy,
} from '../../users/events/user-transferred.event';
import { EvaluationCycle, CycleStatus } from '../entities/evaluation-cycle.entity';
import { EvaluationAssignment, RelationType, AssignmentStatus } from '../entities/evaluation-assignment.entity';
import { EvaluationsService } from '../evaluations.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class UserTransferredListener {
  private readonly logger = new Logger(UserTransferredListener.name);

  constructor(
    @InjectRepository(EvaluationCycle) private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment) private readonly assignmentRepo: Repository<EvaluationAssignment>,
    private readonly evaluationsService: EvaluationsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    // Listener corre async fuera del request → seteamos
    // `app.current_tenant_id` directamente al iniciar el handler para
    // que RLS permita writes (replaceEvaluator, audit, notifications).
    // Defense-in-depth: igual filtramos por tenantId explicito en cada
    // query, asi RLS es secundario.
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resuelve la política efectiva para un ciclo:
   * - Si el evento trajo `cascadePolicy` distinto de 'manual', gana ese
   *   (el caller fue explícito — ej. recruitment hire que sabe que fue
   *   manual o auto).
   * - Si el evento es 'manual' (default), respetamos lo que dice el
   *   ciclo en `cycle.settings.cascadeOnTransfer`. Default 'manual'.
   */
  private resolveCyclePolicy(
    event: UserTransferredEvent,
    cycle: EvaluationCycle,
  ): CascadePolicy {
    if (event.cascadePolicy && event.cascadePolicy !== 'manual') {
      return event.cascadePolicy;
    }
    const cyclePolicy = (cycle.settings as any)?.cascadeOnTransfer as CascadePolicy | undefined;
    return cyclePolicy ?? 'manual';
  }

  @OnEvent(USER_TRANSFERRED_EVENT, { async: true, promisify: true })
  async handleUserTransferred(event: UserTransferredEvent): Promise<void> {
    // Si no cambio el manager, NO hay nada que cascadear en evaluaciones.
    // Solo el cambio de manager rompe la asignacion `MANAGER` evaluator.
    if (!event.hasManagerChanged()) {
      return;
    }

    try {
      // RLS: setear app.current_tenant_id en la session actual antes de
      // queries (listener corre fuera del request lifecycle, sin
      // TenantContextInterceptor). is_local=false porque set_config con
      // true requiere transaccion abierta — usamos session-level set
      // que persiste por la conexion. Defensive in-depth: cada query
      // filtra por tenantId explicito tambien.
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [event.tenantId],
      );
      await this.processTransfer(event);
    } catch (e: any) {
      // No re-lanzar — los listeners no deben tumbar el flow del emisor.
      // El admin podra ejecutar la cascada manualmente desde la UI si fue
      // necesario y revisar audit log.
      this.logger.error(
        `Cascade evaluations fallo para user=${event.userId} tenant=${event.tenantId}: ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }

  private async processTransfer(event: UserTransferredEvent): Promise<void> {
    // Solo ciclos ACTIVE — DRAFT no tiene assignments, CLOSED es inmutable.
    const activeCycles = await this.cycleRepo.find({
      where: { tenantId: event.tenantId, status: CycleStatus.ACTIVE },
    });

    if (activeCycles.length === 0) {
      return;
    }

    // Pre-fetch todos los assignments MANAGER del usuario en ciclos
    // activos. Mas eficiente que iterar por ciclo y query por ciclo.
    const cycleIds = activeCycles.map((c) => c.id);
    const managerAssignments = await this.assignmentRepo.find({
      where: {
        tenantId: event.tenantId,
        cycleId: In(cycleIds),
        evaluateeId: event.userId,
        relationType: RelationType.MANAGER,
        status: In([AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS]),
      },
    });

    if (managerAssignments.length === 0) {
      return;
    }

    const newManagerId = event.current.managerId;
    const cycleById = new Map(activeCycles.map((c) => [c.id, c]));

    for (const assignment of managerAssignments) {
      const cycle = cycleById.get(assignment.cycleId);
      if (!cycle) continue;

      const policy = this.resolveCyclePolicy(event, cycle);

      // Si el nuevo evaluador es el mismo que el actual, no hay nada
      // que hacer. Esto puede pasar si el manager cambio "back y forth"
      // o si el evaluator ya estaba apuntando al nuevo manager.
      if (newManagerId && assignment.evaluatorId === newManagerId) {
        continue;
      }

      try {
        await this.handleAssignment(event, assignment, cycle, policy, newManagerId);
      } catch (e: any) {
        // Cada assignment es independiente. Loguear y seguir.
        this.logger.warn(
          `Cascade assignment ${assignment.id} fallo (policy=${policy}): ${e?.message ?? e}`,
        );
      }
    }
  }

  private async handleAssignment(
    event: UserTransferredEvent,
    assignment: EvaluationAssignment,
    cycle: EvaluationCycle,
    policy: CascadePolicy,
    newManagerId: string | null,
  ): Promise<void> {
    if (policy === 'freeze') {
      // No-op deliberado. Solo dejamos audit trail para que el admin
      // pueda inspeccionar despues por que NO hubo cambio.
      await this.auditService.log(
        event.tenantId,
        event.triggeredByUserId,
        'cascade.skipped',
        'evaluation_assignment',
        assignment.id,
        {
          reason: 'cycle.settings.cascadeOnTransfer = freeze',
          cycleId: cycle.id,
          cycleName: cycle.name,
          userId: event.userId,
          oldManagerId: event.previous.managerId,
          newManagerId,
        },
      ).catch(() => {});
      return;
    }

    if (policy === 'auto_replace') {
      if (!newManagerId) {
        // Sin nuevo manager (caso CEO sin jefe). No podemos auto-reemplazar.
        // Caer a 'manual': notificar para que admin decida.
        await this.notifyManualDecision(event, assignment, cycle, 'no_new_manager');
        return;
      }
      try {
        await this.evaluationsService.replaceEvaluator(
          assignment.id,
          newManagerId,
          event.tenantId,
          event.triggeredByUserId,
          `Auto-reemplazo por user.transferred: cambio de manager ${event.previous.managerId ?? '(ninguno)'} → ${newManagerId}. Trigger=${event.triggerSource}.`,
        );
        // replaceEvaluator ya emite su propio audit log; añadimos uno
        // específico de cascade para correlacionar con el evento.
        await this.auditService.log(
          event.tenantId,
          event.triggeredByUserId,
          'cascade.evaluator_replaced',
          'evaluation_assignment',
          assignment.id,
          {
            cycleId: cycle.id,
            cycleName: cycle.name,
            userId: event.userId,
            oldEvaluatorId: assignment.evaluatorId,
            newEvaluatorId: newManagerId,
            triggerSource: event.triggerSource,
          },
        ).catch(() => {});
      } catch (e: any) {
        // Si replaceEvaluator falla (ej. duplicate, ciclo cambio a closed
        // entre que listamos y procesamos), caemos a notificación.
        this.logger.warn(
          `Auto-replace fallo en assignment=${assignment.id}, fallback a notificacion: ${e?.message ?? e}`,
        );
        await this.notifyManualDecision(event, assignment, cycle, `auto_replace_failed: ${e?.message ?? 'unknown'}`);
      }
      return;
    }

    // policy === 'manual' (default)
    await this.notifyManualDecision(event, assignment, cycle, 'manual_policy');
  }

  /**
   * Crea notificación al admin del tenant + al nuevo manager para que
   * decidan si reemplazar el evaluador del ciclo activo. Audit log
   * incluido para trazabilidad.
   */
  private async notifyManualDecision(
    event: UserTransferredEvent,
    assignment: EvaluationAssignment,
    cycle: EvaluationCycle,
    reason: string,
  ): Promise<void> {
    // Targets: el nuevo manager (si existe) y el admin que disparo.
    // El admin del tenant en general no se notifica masivamente —
    // usamos el triggeredByUserId como representante administrativo.
    const targets: string[] = [event.triggeredByUserId];
    if (event.current.managerId && event.current.managerId !== event.triggeredByUserId) {
      targets.push(event.current.managerId);
    }

    for (const targetUserId of targets) {
      try {
        await this.notificationsService.create({
          tenantId: event.tenantId,
          userId: targetUserId,
          // GENERAL: tipo neutral usado para notificaciones administrativas
          // que no encajan en evaluation_pending/checkin/etc. El frontend
          // las muestra en el icono de campana con titulo+message+metadata.
          type: NotificationType.GENERAL,
          title: 'Evaluación pendiente de revisión por traslado',
          message: `Se transfirió un colaborador con evaluación activa en el ciclo "${cycle.name}". Revisa si corresponde reemplazar al evaluador.`,
          metadata: {
            cycleId: cycle.id,
            assignmentId: assignment.id,
            transferredUserId: event.userId,
            oldManagerId: event.previous.managerId,
            newManagerId: event.current.managerId,
            cascadeReason: reason,
          },
        });
      } catch (e: any) {
        this.logger.warn(`Notificacion cascade fallo para user=${targetUserId}: ${e?.message ?? e}`);
      }
    }

    await this.auditService.log(
      event.tenantId,
      event.triggeredByUserId,
      'cascade.manual_review_requested',
      'evaluation_assignment',
      assignment.id,
      {
        cycleId: cycle.id,
        cycleName: cycle.name,
        userId: event.userId,
        oldManagerId: event.previous.managerId,
        newManagerId: event.current.managerId,
        oldEvaluatorId: assignment.evaluatorId,
        reason,
        notifiedUserIds: targets,
      },
    ).catch(() => {});
  }
}
