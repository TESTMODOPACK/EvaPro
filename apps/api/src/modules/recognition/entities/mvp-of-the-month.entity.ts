import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * v3.1 F7 — MVP del Mes.
 *
 * Una fila por tenant × mes. Calculado por el cron
 * `RecognitionService.calculateMvpOfTheMonth` el día 1 de cada mes
 * a las 03:00 UTC (sobre los reconocimientos del mes anterior).
 *
 * Tiebreaker: mayor uniqueGivers > mayor totalKudos > user más antiguo
 * en el tenant (fallback determinístico).
 */
@Entity('mvp_of_the_month')
@Unique('uq_mvp_tenant_month', ['tenantId', 'month'])
@Index('idx_mvp_tenant', ['tenantId'])
@Index('idx_mvp_user', ['userId'])
export class MvpOfTheMonth {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Formato 'YYYY-MM' (ej. '2026-04'). */
  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'int', name: 'total_kudos_count', default: 0 })
  totalKudosCount: number;

  @Column({ type: 'int', name: 'unique_givers_count', default: 0 })
  uniqueGiversCount: number;

  /** Array de valueIds (competency ids) referenciados en los kudos del mes. */
  @Column({ type: 'jsonb', name: 'values_touched', default: () => "'[]'" })
  valuesTouched: string[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
