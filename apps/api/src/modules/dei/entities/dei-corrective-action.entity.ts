import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('dei_corrective_actions')
@Index('idx_dei_ca_tenant', ['tenantId'])
export class DeiCorrectiveAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, name: 'alert_type', comment: 'Dimension that triggered the alert: gender, seniority, age, tenure' })
  alertType: string;

  @Column({ type: 'varchar', length: 20, comment: 'Alert severity: medium | high' })
  severity: string;

  @Column({ type: 'text', comment: 'Original alert message that triggered this action' })
  alertMessage: string;

  @Column({ type: 'uuid', name: 'cycle_id', nullable: true })
  cycleId: string | null;

  @Column({ type: 'text', comment: 'Description of the corrective action to be taken' })
  action: string;

  @Column({ type: 'uuid', name: 'responsible_id', nullable: true })
  responsibleId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'responsible_id' })
  responsible: User;

  @Column({ type: 'varchar', length: 30, default: 'pending', comment: 'pending | in_progress | completed | cancelled' })
  status: string;

  @Column({ type: 'text', nullable: true, comment: 'Evidence or notes on completion' })
  evidence: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
