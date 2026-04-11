import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import type { AuditLogMetadata } from '../../../common/types/jsonb-schemas';

@Entity('audit_logs')
@Index('idx_audit_tenant_date', ['tenantId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ type: 'varchar', length: 50, name: 'entity_type', nullable: true })
  entityType: string;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: AuditLogMetadata | null;

  @Column({ type: 'varchar', length: 45, name: 'ip_address', nullable: true })
  ipAddress: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
