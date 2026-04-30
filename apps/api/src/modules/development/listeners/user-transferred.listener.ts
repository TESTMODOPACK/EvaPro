/**
 * DevelopmentUserTransferredListener — S2.3 Sprint 2.
 *
 * Reacciona a `user.transferred` para notificar al nuevo manager (y al
 * anterior) que el colaborador transferido tiene Plan(es) de Desarrollo
 * Individual (PDI) activos.
 *
 * Por que NO actualiza datos: el modelo de PDI (`development_plans`) NO
 * tiene un campo `currentManagerId` — la relacion del manager con el
 * plan se deriva de `users.managerId` en runtime cuando se filtran
 * planes para "mi equipo". Asi que cuando user.transferred cambia el
 * managerId, los planes del usuario aparecen automaticamente en el feed
 * del nuevo manager y desaparecen del anterior — sin tocar la tabla.
 *
 * Lo unico que falta es la NOTIFICACION explicita: avisar al nuevo
 * manager "heredaste estos PDI" y al anterior "estos PDI ya no son
 * tuyos". Eso es lo que hace este listener.
 *
 * Solo dispara si event.hasManagerChanged() — cambios de dept/cargo
 * dentro del mismo team no requieren notificacion (mismo manager).
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  USER_TRANSFERRED_EVENT,
  UserTransferredEvent,
} from '../../users/events/user-transferred.event';
import { DevelopmentPlan } from '../entities/development-plan.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { AuditService } from '../../audit/audit.service';

/**
 * Estados de PDI que se consideran "activos" para efectos de cascade.
 * Excluye 'completado' y 'cancelado' — esos son terminales y no requieren
 * follow-up del nuevo manager.
 */
const ACTIVE_PLAN_STATUSES = ['borrador', 'activo', 'en_revision', 'pausado', 'aprobado'];

@Injectable()
export class DevelopmentUserTransferredListener {
  private readonly logger = new Logger(DevelopmentUserTransferredListener.name);

  constructor(
    @InjectRepository(DevelopmentPlan) private readonly planRepo: Repository<DevelopmentPlan>,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(USER_TRANSFERRED_EVENT, { async: true, promisify: true })
  async handleUserTransferred(event: UserTransferredEvent): Promise<void> {
    if (!event.hasManagerChanged()) return;

    try {
      // RLS: setear app.current_tenant_id (listener corre fuera del request)
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [event.tenantId],
      );

      const activePlans = await this.planRepo.find({
        where: {
          tenantId: event.tenantId,
          userId: event.userId,
          status: In(ACTIVE_PLAN_STATUSES),
        },
        select: ['id', 'title', 'status', 'targetDate'],
      });

      if (activePlans.length === 0) return;

      const planSummary = activePlans
        .slice(0, 5)
        .map((p) => `• ${p.title}`)
        .join('\n');
      const overflowNote = activePlans.length > 5 ? `\n…y ${activePlans.length - 5} más` : '';

      // Notificar al NUEVO manager: "heredaste estos PDI"
      if (event.current.managerId) {
        await this.safeNotify(
          event.tenantId,
          event.current.managerId,
          {
            type: NotificationType.GENERAL,
            title: `Heredaste ${activePlans.length} plan${activePlans.length > 1 ? 'es' : ''} de desarrollo`,
            message: `Por traslado del colaborador, ahora supervisas los siguientes PDI activos:\n${planSummary}${overflowNote}`,
            metadata: {
              transferredUserId: event.userId,
              role: 'new_manager',
              planIds: activePlans.map((p) => p.id),
            },
          },
        );
      }

      // Notificar al ANTERIOR manager: "estos PDI ya no son tuyos"
      if (event.previous.managerId && event.previous.managerId !== event.triggeredByUserId) {
        await this.safeNotify(
          event.tenantId,
          event.previous.managerId,
          {
            type: NotificationType.GENERAL,
            title: `Colaborador trasladado — ${activePlans.length} PDI${activePlans.length > 1 ? 's' : ''} reasignado${activePlans.length > 1 ? 's' : ''}`,
            message: `El colaborador fue transferido fuera de tu equipo. Sus PDI activos ahora pertenecen al nuevo manager. Si tenías seguimientos pendientes, coordina la transición.`,
            metadata: {
              transferredUserId: event.userId,
              role: 'previous_manager',
              planIds: activePlans.map((p) => p.id),
            },
          },
        );
      }

      await this.auditService.log(
        event.tenantId,
        event.triggeredByUserId,
        'cascade.development_plans_reassigned',
        'user',
        event.userId,
        {
          planCount: activePlans.length,
          planIds: activePlans.map((p) => p.id),
          oldManagerId: event.previous.managerId,
          newManagerId: event.current.managerId,
        },
      ).catch(() => {});
    } catch (e: any) {
      this.logger.error(
        `Cascade development fallo para user=${event.userId}: ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }

  /**
   * Wrapper para que un fallo en una notificación no rompa las demás.
   */
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
      this.logger.warn(`Notificacion development-cascade fallo (target=${userId}): ${e?.message ?? e}`);
    }
  }
}
