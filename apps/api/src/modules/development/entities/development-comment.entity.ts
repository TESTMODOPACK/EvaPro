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
import { DevelopmentPlan } from './development-plan.entity';
import { User } from '../../users/entities/user.entity';

@Entity('development_comments')
@Index('idx_devcomment_plan', ['tenantId', 'planId'])
export class DevelopmentComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne(() => DevelopmentPlan, (p) => p.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: DevelopmentPlan;

  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 30, default: 'comentario' })
  type: string; // comentario | felicitacion | seguimiento | revision

  @Column({ type: 'varchar', length: 500, name: 'attachment_url', nullable: true })
  attachmentUrl: string | null;

  @Column({ type: 'varchar', length: 200, name: 'attachment_name', nullable: true })
  attachmentName: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
