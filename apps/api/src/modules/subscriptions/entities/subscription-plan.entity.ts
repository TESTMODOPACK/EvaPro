import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('subscription_plans')
@Unique(['code'])
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', name: 'max_employees', default: 50 })
  maxEmployees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'monthly_price', default: 0 })
  monthlyPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'quarterly_price', nullable: true })
  quarterlyPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'semiannual_price', nullable: true })
  semiannualPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'yearly_price', nullable: true })
  yearlyPrice: number | null;

  @Column({ type: 'varchar', length: 10, default: 'UF' })
  currency: string; // UF | CLP | USD

  @Column({ type: 'jsonb', default: [] })
  features: string[];

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
