import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * v3.1 F3 — Mood Check-in: registro diario del ánimo del colaborador.
 *
 * Modelo:
 *   - score: 1..5 (1 = muy mal, 5 = muy bien). smallint para analytics.
 *   - note: comentario opcional libre del usuario.
 *   - checkinDate: columna date (sin hora) — permite constraint único por
 *     día. Distinta de createdAt (timestamptz) que registra cuándo se
 *     envió el check-in.
 *
 * Constraint UNIQUE(tenantId, userId, checkinDate): un registro por día
 * por persona. El service hace upsert — si ya existe para hoy, actualiza.
 *
 * Privacidad: el agregado del equipo solo se muestra si hay >= 3
 * respuestas en el período consultado (implementado en service).
 */
@Entity('mood_checkins')
@Unique('uq_mood_tenant_user_date', ['tenantId', 'userId', 'checkinDate'])
@Index('idx_mood_tenant_date', ['tenantId', 'checkinDate'])
@Index('idx_mood_user', ['userId'])
export class MoodCheckin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Fecha (sin hora) del check-in. Determina el constraint único. */
  @Column({ type: 'date', name: 'checkin_date' })
  checkinDate: string;

  /** Ánimo 1-5. 1=muy mal, 3=neutral, 5=muy bien. */
  @Column({ type: 'smallint' })
  score: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
