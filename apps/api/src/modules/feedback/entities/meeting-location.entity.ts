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

export enum LocationType {
  PHYSICAL = 'physical',
  VIRTUAL = 'virtual',
}

@Entity('meeting_locations')
@Index('idx_meeting_locations_tenant', ['tenantId'])
export class MeetingLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: LocationType, default: LocationType.PHYSICAL })
  type: LocationType;

  @Column({ type: 'text', nullable: true, comment: 'Direcci\u00f3n f\u00edsica o URL de sala virtual' })
  address: string;

  @Column({ type: 'int', nullable: true, comment: 'Capacidad (solo para lugares f\u00edsicos)' })
  capacity: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
