/**
 * FeedbackUserTransferredListener — S2.3 Sprint 2.
 *
 * Reacciona a `user.transferred` para cancelar check-ins agendados con
 * el MANAGER ANTERIOR (porque ya no es su jefe). Operacion de escritura
 * real — a diferencia de development/objectives, aqui el dato del
 * manager esta DESNORMALIZADO en `checkins.manager_id` y debe limpiarse.
 *
 * Que cancelamos:
 * - Check-ins en estado SCHEDULED o REQUESTED (no commiteados aun)
 * - Donde manager_id === oldManagerId AND employee_id === userId
 * - Cuyo `scheduled_date` es HOY o futuro (los pasados ya ocurrieron)
 *
 * Que NO cancelamos:
 * - Check-ins COMPLETED (historico, no se borra)
 * - Check-ins ya CANCELLED o REJECTED (idempotente)
 * - Check-ins con manager actual === newManagerId (ya estan bien)
 *
 * Notificacion al ANTERIOR manager: aviso que se cancelaron N check-ins
 * por traslado. NO notificamos al nuevo manager para "agendar nuevo
 * check-in" — eso es decision del nuevo manager segun su cadencia.
 *
 * Solo dispara si event.hasManagerChanged().
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, MoreThanOrEqual } from 'typeorm';
import {
  USER_TRANSFERRED_EVENT,
  UserTransferredEvent,
} from '../../users/events/user-transferred.event';
import { CheckIn, CheckInStatus } from '../entities/checkin.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class FeedbackUserTransferredListener {
  private readonly logger = new Logger(FeedbackUserTransferredListener.name);

  constructor(
    @InjectRepository(CheckIn) private readonly checkinRepo: Repository<CheckIn>,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(USER_TRANSFERRED_EVENT, { async: true, promisify: true })
  async handleUserTransferred(event: UserTransferredEvent): Promise<void> {
    if (!event.hasManagerChanged()) return;
    if (!event.previous.managerId) return; // Sin manager anterior, no hay check-ins a cancelar

    try {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [event.tenantId],
      );

      // Tomamos solo SCHEDULED + REQUESTED, futuros, con el manager anterior.
      // YYYY-MM-DD del dia de hoy (la columna es 'date' sin timezone).
      const today = new Date().toISOString().slice(0, 10);

      const targets = await this.checkinRepo.find({
        where: {
          tenantId: event.tenantId,
          managerId: event.previous.managerId,
          employeeId: event.userId,
          status: In([CheckInStatus.SCHEDULED, CheckInStatus.REQUESTED]),
          scheduledDate: MoreThanOrEqual(today as any),
        },
        // CheckIn entity tiene `topic` (no `title`) como campo descriptivo.
        select: ['id', 'topic', 'scheduledDate', 'status'],
      });

      if (targets.length === 0) return;

      // Cancelar todos en una update batch
      const cancelReason = `Cancelado por traslado del colaborador. Anterior manager: ${event.previous.managerId}, nuevo: ${event.current.managerId ?? '(sin asignar)'}.`;
      await this.checkinRepo
        .createQueryBuilder()
        .update()
        .set({
          status: CheckInStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason,
        } as any)
        .where('id IN (:...ids)', { ids: targets.map((t) => t.id) })
        .execute();

      // Notificar al ANTERIOR manager (los check-ins eran suyos)
      if (event.previous.managerId !== event.triggeredByUserId) {
        await this.safeNotify(event.tenantId, event.previous.managerId, {
          type: NotificationType.GENERAL,
          title: `${targets.length} check-in${targets.length > 1 ? 's' : ''} cancelado${targets.length > 1 ? 's' : ''} por traslado`,
          message: `Se cancelaron ${targets.length} check-in${targets.length > 1 ? 's' : ''} agendado${targets.length > 1 ? 's' : ''} con el colaborador transferido. Si quedaba algo pendiente, coordina con el nuevo manager.`,
          metadata: {
            transferredUserId: event.userId,
            role: 'previous_manager',
            cancelledCheckinIds: targets.map((t) => t.id),
            newManagerId: event.current.managerId,
          },
        });
      }

      // Notificar al NUEVO manager: sugerir agendar primer check-in (no obligatorio)
      if (event.current.managerId) {
        await this.safeNotify(event.tenantId, event.current.managerId, {
          type: NotificationType.GENERAL,
          title: `Nuevo colaborador en tu equipo`,
          message: `Recibiste un colaborador trasladado. Considera agendar un primer check-in para alinear expectativas.`,
          metadata: {
            transferredUserId: event.userId,
            role: 'new_manager',
            previousManagerId: event.previous.managerId,
          },
        });
      }

      await this.auditService.log(
        event.tenantId,
        event.triggeredByUserId,
        'cascade.checkins_cancelled',
        'user',
        event.userId,
        {
          cancelledCount: targets.length,
          cancelledIds: targets.map((t) => t.id),
          oldManagerId: event.previous.managerId,
          newManagerId: event.current.managerId,
          reason: 'user_transferred',
        },
      ).catch(() => {});
    } catch (e: any) {
      this.logger.error(
        `Cascade feedback fallo para user=${event.userId}: ${e?.message ?? e}`,
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
      this.logger.warn(`Notificacion feedback-cascade fallo (target=${userId}): ${e?.message ?? e}`);
    }
  }
}
