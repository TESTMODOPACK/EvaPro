import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Objective } from './objective.entity';

export enum KRStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('key_results')
@Index('idx_kr_tenant', ['tenantId'])
@Index('idx_kr_objective', ['objectiveId'])
export class KeyResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'objective_id' })
  objectiveId: string;

  @ManyToOne(() => Objective, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objective_id' })
  objective: Objective;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: 'Unidad de medida: %, cantidad, moneda, etc.' })
  unit: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'base_value', default: 0, comment: 'Valor inicial/base' })
  baseValue: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'target_value', default: 100, comment: 'Valor meta objetivo' })
  targetValue: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'current_value', default: 0, comment: 'Valor actual' })
  currentValue: number;

  @Column({ type: 'enum', enum: KRStatus, default: KRStatus.ACTIVE })
  status: KRStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
