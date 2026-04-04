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
import { User } from '../../users/entities/user.entity';

@Entity('contracts')
@Index('idx_contract_tenant', ['tenantId'])
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50 })
  type: string; // service_agreement | dpa | terms_conditions | privacy_policy | sla | nda | amendment

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'varchar', length: 30, default: 'draft' })
  status: string; // draft | pending_signature | active | expired | superseded

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'file_url' })
  fileUrl: string | null;

  @Column({ type: 'text', nullable: true, comment: 'HTML/markdown content for generated contracts' })
  content: string | null;

  @Column({ type: 'date', name: 'effective_date' })
  effectiveDate: Date;

  @Column({ type: 'date', name: 'expiration_date', nullable: true })
  expirationDate: Date | null;

  @Column({ type: 'uuid', name: 'parent_contract_id', nullable: true, comment: 'For amendments — references the original contract' })
  parentContractId: string | null;

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
