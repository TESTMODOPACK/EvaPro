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

export enum DepartureType {
  RESIGNATION = 'resignation',
  TERMINATION = 'termination',
  RETIREMENT = 'retirement',
  CONTRACT_END = 'contract_end',
  ABANDONMENT = 'abandonment',
  MUTUAL_AGREEMENT = 'mutual_agreement',
}

export enum DepartureReasonCategory {
  BETTER_OFFER = 'better_offer',
  WORK_CLIMATE = 'work_climate',
  PERFORMANCE = 'performance',
  RESTRUCTURING = 'restructuring',
  PERSONAL = 'personal',
  RELOCATION = 'relocation',
  CAREER_GROWTH = 'career_growth',
  COMPENSATION = 'compensation',
  HEALTH = 'health',
  OTHER = 'other',
}

@Entity('user_departures')
@Index('idx_departures_tenant', ['tenantId'])
@Index('idx_departures_user', ['userId'])
@Index('idx_departures_date', ['tenantId', 'departureDate'])
export class UserDeparture {
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

  @Column({ type: 'date', name: 'departure_date' })
  departureDate: Date;

  @Column({ type: 'enum', enum: DepartureType, name: 'departure_type' })
  departureType: DepartureType;

  @Column({ type: 'boolean', name: 'is_voluntary', default: true })
  isVoluntary: boolean;

  @Column({ type: 'enum', enum: DepartureReasonCategory, name: 'reason_category', nullable: true })
  reasonCategory: DepartureReasonCategory | null;

  @Column({ type: 'text', name: 'reason_detail', nullable: true })
  reasonDetail: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_department', nullable: true })
  lastDepartment: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_position', nullable: true })
  lastPosition: string | null;

  @Column({ type: 'boolean', name: 'would_rehire', nullable: true })
  wouldRehire: boolean | null;

  @Column({ type: 'uuid', name: 'processed_by', nullable: true })
  processedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  /**
   * Populated whenever admin edits departure details (e.g., corrects a
   * reason category or adds would-rehire info after exit interview).
   */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
