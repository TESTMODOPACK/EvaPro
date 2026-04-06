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

@Entity('redemption_items')
@Index('idx_ri_tenant', ['tenantId'])
export class RedemptionItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', comment: 'Points required to redeem' })
  pointsCost: number;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: 'Category: experiencia, beneficio, regalo, tiempo_libre' })
  category: string | null;

  @Column({ type: 'int', default: -1, comment: '-1 = unlimited stock' })
  stock: number;

  @Column({ type: 'text', nullable: true, comment: 'Terms, conditions, and rules for redemption' })
  terms: string | null;

  @Column({ type: 'int', default: -1, name: 'max_redeem_per_user', comment: '-1 = unlimited per user' })
  maxRedeemPerUser: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
