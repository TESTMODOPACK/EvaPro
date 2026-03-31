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
import { Tenant } from './tenant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('support_tickets')
@Index('idx_ticket_tenant', ['tenantId'])
@Index('idx_ticket_status', ['tenantId', 'status'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, comment: 'nuevo_desarrollo | mejora_funcionalidad | soporte_tecnico | ampliacion_plan | reporte_error | consulta_general' })
  category: string;

  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20, default: 'open', comment: 'open | in_review | responded | closed' })
  status: string;

  @Column({ type: 'varchar', length: 20, default: 'normal', comment: 'low | normal | high | urgent' })
  priority: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'text', nullable: true, comment: 'Response from super_admin' })
  response: string | null;

  @Column({ type: 'uuid', name: 'responded_by', nullable: true })
  respondedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'responded_by' })
  responder: User;

  @Column({ type: 'timestamptz', name: 'responded_at', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
