import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * SignatureReminderSent — TAREA 10 / G11.
 *
 * Tracking de recordatorios de firma escalonados (D+3, D+7, D+15).
 * Garantiza que NO se reenvíe el mismo nivel de recordatorio para el
 * mismo (documento, usuario). El UNIQUE constraint compuesto da
 * idempotencia ante reinicios del worker, retries, o ejecuciones
 * concurrentes.
 *
 * Cleanup: filas con sent_at > 30 días pueden eliminarse via job de
 * mantenimiento (no incluido aquí — fuera de scope de TAREA 10).
 */
@Entity('signature_reminders_sent')
@Unique('uq_sigremind_doc_user_level', ['documentType', 'documentId', 'userId', 'reminderLevel'])
@Index('idx_sigremind_sent_at', ['sentAt'])
export class SignatureReminderSent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, name: 'document_type' })
  documentType: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Nivel del recordatorio: 3, 7 o 15 (días desde la fecha base). */
  @Column({ type: 'int', name: 'reminder_level' })
  reminderLevel: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'sent_at' })
  sentAt: Date;
}
