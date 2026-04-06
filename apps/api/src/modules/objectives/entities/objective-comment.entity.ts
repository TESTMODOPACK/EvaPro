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
import { Objective } from './objective.entity';
import { User } from '../../users/entities/user.entity';

@Entity('objective_comments')
@Index('idx_obj_comments_tenant_obj', ['tenantId', 'objectiveId'])
export class ObjectiveComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'objective_id' })
  objectiveId: string;

  @ManyToOne(() => Objective, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objective_id' })
  objective: Objective;

  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 30, default: 'comentario' })
  type: string; // seguimiento | felicitacion | bloqueo | decision | comentario | adjunto

  @Column({ type: 'varchar', length: 500, name: 'attachment_url', nullable: true })
  attachmentUrl: string | null;

  @Column({ type: 'varchar', length: 200, name: 'attachment_name', nullable: true })
  attachmentName: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
