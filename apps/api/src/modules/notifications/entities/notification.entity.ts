import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import type { NotificationMetadata } from '../../../common/types/jsonb-schemas';

export enum NotificationType {
  EVALUATION_PENDING = 'evaluation_pending',
  EVALUATION_COMPLETED = 'evaluation_completed',
  CHECKIN_SCHEDULED = 'checkin_scheduled',
  CHECKIN_REJECTED = 'checkin_rejected',
  CHECKIN_OVERDUE = 'checkin_overdue',
  PDI_ACTION_DUE = 'pdi_action_due',
  OBJECTIVE_AT_RISK = 'objective_at_risk',
  CYCLE_CLOSING = 'cycle_closing',
  CYCLE_CLOSED = 'cycle_closed',
  CALIBRATION_PENDING = 'calibration_pending',
  FEEDBACK_RECEIVED = 'feedback_received',
  STAGE_ADVANCED = 'stage_advanced',
  ESCALATION_EVALUATION_OVERDUE = 'escalation_evaluation_overdue',
  ESCALATION_PDI_OVERDUE = 'escalation_pdi_overdue',
  ESCALATION_OBJECTIVE_CRITICAL = 'escalation_objective_critical',
  PDI_REQUIRED = 'pdi_required',
  SUBSCRIPTION_EXPIRING = 'subscription_expiring',
  SUBSCRIPTION_EXPIRING_URGENT = 'subscription_expiring_urgent',
  SURVEY_INVITATION = 'survey_invitation',
  SURVEY_REMINDER = 'survey_reminder',
  SURVEY_CLOSED = 'survey_closed',
  GENERAL = 'general',
}

/**
 * Notificaciones internas (in-app).
 *
 * Se generan automáticamente por el sistema de recordatorios (cron)
 * o por eventos de negocio (feedback recibido, etapa avanzada, etc.).
 *
 * El frontend muestra estas notificaciones en un icono de campana
 * con badge de no leídas.
 */
@Entity('notifications')
@Index('idx_notifications_user', ['userId'])
@Index('idx_notifications_tenant_unread', ['tenantId', 'userId', 'isRead'])
@Index('idx_notifications_created', ['createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.GENERAL })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false, name: 'is_read' })
  isRead: boolean;

  @Column({ type: 'jsonb', nullable: true, comment: 'Datos extra: cycleId, assignmentId, objectiveId, etc.' })
  metadata: NotificationMetadata | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  /**
   * Updated whenever the row mutates — most importantly when `isRead` flips
   * from false to true. Lets the UI show "marked as read N minutes ago"
   * and gives ops a way to identify stale notifications that never mutated.
   */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
