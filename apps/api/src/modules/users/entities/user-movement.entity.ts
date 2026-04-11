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
import { User } from './user.entity';

export enum MovementType {
  DEPARTMENT_CHANGE = 'department_change',
  POSITION_CHANGE = 'position_change',
  PROMOTION = 'promotion',
  DEMOTION = 'demotion',
  LATERAL_TRANSFER = 'lateral_transfer',
}

@Entity('user_movements')
@Index('idx_movements_tenant', ['tenantId'])
@Index('idx_movements_user', ['userId'])
@Index('idx_movements_date', ['tenantId', 'effectiveDate'])
export class UserMovement {
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

  @Column({ type: 'enum', enum: MovementType, name: 'movement_type' })
  movementType: MovementType;

  @Column({ type: 'date', name: 'effective_date' })
  effectiveDate: Date;

  @Column({ type: 'varchar', length: 100, name: 'from_department', nullable: true })
  fromDepartment: string | null;

  @Column({ type: 'varchar', length: 100, name: 'to_department', nullable: true })
  toDepartment: string | null;

  @Column({ type: 'varchar', length: 100, name: 'from_position', nullable: true })
  fromPosition: string | null;

  @Column({ type: 'varchar', length: 100, name: 'to_position', nullable: true })
  toPosition: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', name: 'approved_by', nullable: true })
  approvedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  /** Populated whenever admin corrects movement details (e.g., approval, reason). */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
