import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('departments')
@Unique(['tenantId', 'name'])
@Index('idx_departments_tenant', ['tenantId'])
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /** Timestamp of when this row was soft-deleted (isActive=false). Null while active. */
  @Column({ type: 'timestamptz', name: 'deactivated_at', nullable: true })
  deactivatedAt: Date | null;

  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
