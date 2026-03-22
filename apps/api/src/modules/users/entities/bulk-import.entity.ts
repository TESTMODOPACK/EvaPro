import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from './user.entity';

export enum ImportStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('bulk_imports')
export class BulkImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, default: 'users' })
  type: string;

  @Column({
    type: 'enum',
    enum: ImportStatus,
    default: ImportStatus.PROCESSING,
  })
  status: ImportStatus;

  @Column({ type: 'int', name: 'total_rows', default: 0 })
  totalRows: number;

  @Column({ type: 'int', name: 'success_rows', default: 0 })
  successRows: number;

  @Column({ type: 'int', name: 'error_rows', default: 0 })
  errorRows: number;

  /** [{ row: 3, message: "Email duplicado" }] */
  @Column({ type: 'jsonb', nullable: true })
  errors: any;

  @Column({ type: 'uuid', name: 'uploaded_by' })
  uploadedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
