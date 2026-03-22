import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('form_templates')
@Index('idx_templates_tenant', ['tenantId'])
export class FormTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @ManyToOne(() => Tenant, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * JSONB structure:
   * [{ id: "sec1", title: "Competencias", questions: [
   *   { id: "q1", text: "...", type: "scale"|"text"|"multi",
   *     scale?: { min: 1, max: 5, labels: { 1: "Deficiente", 5: "Excelente" } },
   *     options?: ["opA", "opB"],
   *     required: true }
   * ]}]
   */
  @Column({ type: 'jsonb' })
  sections: any;

  @Column({ type: 'boolean', default: false, name: 'is_default' })
  isDefault: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
