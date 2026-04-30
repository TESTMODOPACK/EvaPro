/**
 * ObjectivesUserTransferredListener — S2.3 Sprint 2.
 *
 * Reacciona a `user.transferred` para notificar al nuevo manager (y al
 * anterior) que el colaborador transferido tiene Objetivos / OKRs
 * activos que ahora cuelgan de su equipo.
 *
 * Como en development, NO actualiza datos: la relacion manager↔objetivo
 * se deriva de `users.managerId` cuando se filtra "objetivos de mi
 * equipo". Cambiar managerId redirige automaticamente la visibilidad.
 *
 * Adicionalmente, si hay objetivos en estado `pending_approval`, alerta
 * al nuevo manager con prioridad — heredo objetivos pendientes de su
 * aprobacion.
 *
 * Solo dispara si event.hasManagerChanged().
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  USER_TRANSFERRED_EVENT,
  UserTransferredEvent,
} from '../../users/events/user-transferred.event';
import { Objective, ObjectiveStatus } from '../entities/objective.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { AuditService } from '../../audit/audit.service';

/** Estados de objetivo que requieren atencion del manager actual. */
const ACTIVE_OBJ_STATUSES: ObjectiveStatus[] = [
  ObjectiveStatus.DRAFT,
  ObjectiveStatus.PENDING_APPROVAL,
  ObjectiveStatus.ACTIVE,
];

@Injectable()
export class ObjectivesUserTransferredListener {
  private readonly logger = new Logger(ObjectivesUserTransferredListener.name);

  constructor(
    @InjectRepository(Objective) private readonly objRepo: Repository<Objective>,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(USER_TRANSFERRED_EVENT, { async: true, promisify: true })
  async handleUserTransferred(event: UserTransferredEvent): Promise<void> {
    if (!event.hasManagerChanged()) return;

    try {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [event.tenantId],
      );

      const activeObjs = await this.objRepo.find({
        where: {
          tenantId: event.tenantId,
          userId: event.userId,
          status: In(ACTIVE_OBJ_STATUSES),
        },
        select: ['id', 'title', 'status', 'targetDate'],
      });

      if (activeObjs.length === 0) return;

      const pendingApproval = activeObjs.filter((o) => o.status === ObjectiveStatus.PENDING_APPROVAL);

      // Notificar al NUEVO manager
      if (event.current.managerId) {
        const summary = activeObjs.slice(0, 5).map((o) => `• ${o.title}${o.status === ObjectiveStatus.PENDING_APPROVAL ? ' (pendiente aprobación)' : ''}`).join('\n');
        const overflow = activeObjs.length > 5 ? `\n…y ${activeObjs.length - 5} más` : '';
        const pendingNote = pendingApproval.length > 0
          ? `\n\n⚠ ${pendingApproval.length} objetivo${pendingApproval.length > 1 ? 's' : ''} pendiente${pendingApproval.length > 1 ? 's' : ''} de TU aprobación.`
          : '';

        await this.safeNotify(event.tenantId, event.current.managerId, {
          type: NotificationType.GENERAL,
          title: `Heredaste ${activeObjs.length} objetivo${activeObjs.length > 1 ? 's' : ''} activo${activeObjs.length > 1 ? 's' : ''}`,
          message: `Por traslado del colaborador, ahora supervisas los siguientes objetivos:\n${summary}${overflow}${pendingNote}`,
          metadata: {
            transferredUserId: event.userId,
            role: 'new_manager',
            objectiveIds: activeObjs.map((o) => o.id),
            pendingApprovalCount: pendingApproval.length,
          },
        });
      }

      // Notificar al ANTERIOR manager (si no es quien dispara la transferencia)
      if (event.previous.managerId && event.previous.managerId !== event.triggeredByUserId) {
        await this.safeNotify(event.tenantId, event.previous.managerId, {
          type: NotificationType.GENERAL,
          title: `Colaborador trasladado — objetivos reasignados`,
          message: `El colaborador fue transferido fuera de tu equipo. Sus ${activeObjs.length} objetivo${activeObjs.length > 1 ? 's' : ''} activo${activeObjs.length > 1 ? 's' : ''} ahora pertenece${activeObjs.length > 1 ? 'n' : ''} al nuevo manager.`,
          metadata: {
            transferredUserId: event.userId,
            role: 'previous_manager',
            objectiveIds: activeObjs.map((o) => o.id),
          },
        });
      }

      await this.auditService.log(
        event.tenantId,
        event.triggeredByUserId,
        'cascade.objectives_reassigned',
        'user',
        event.userId,
        {
          objCount: activeObjs.length,
          pendingApprovalCount: pendingApproval.length,
          objectiveIds: activeObjs.map((o) => o.id),
          oldManagerId: event.previous.managerId,
          newManagerId: event.current.managerId,
        },
      ).catch(() => {});
    } catch (e: any) {
      this.logger.error(
        `Cascade objectives fallo para user=${event.userId}: ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }

  private async safeNotify(
    tenantId: string,
    userId: string,
    payload: {
      type: NotificationType;
      title: string;
      message: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.notificationsService.create({ tenantId, userId, ...payload });
    } catch (e: any) {
      this.logger.warn(`Notificacion objectives-cascade fallo (target=${userId}): ${e?.message ?? e}`);
    }
  }
}
