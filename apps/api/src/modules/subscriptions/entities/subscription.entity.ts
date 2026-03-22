import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('subscriptions')
@Index('idx_sub_tenant', ['tenantId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, name: 'plan_name', default: 'starter' })
  planName: string; // starter | pro | enterprise | custom

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status: string; // active | suspended | cancelled | trial

  @Column({ type: 'int', name: 'max_employees', default: 50 })
  maxEmployees: number;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'date', name: 'trial_ends_at', nullable: true })
  trialEndsAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'monthly_price', nullable: true })
  monthlyPrice: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
