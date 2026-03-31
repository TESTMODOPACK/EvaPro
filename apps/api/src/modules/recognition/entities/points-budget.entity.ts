import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('points_budgets')
@Index('idx_pb_tenant_month', ['tenantId', 'month'])
@Unique('uq_pb_tenant_user_month', ['tenantId', 'userId', 'month'])
export class PointsBudget {
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

  @Column({ type: 'varchar', length: 7, comment: 'YYYY-MM format' })
  month: string;

  @Column({ type: 'int', default: 100, comment: 'Monthly allocated points' })
  allocated: number;

  @Column({ type: 'int', default: 0, comment: 'Points spent this month' })
  spent: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
