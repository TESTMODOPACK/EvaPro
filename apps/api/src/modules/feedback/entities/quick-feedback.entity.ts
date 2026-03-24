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

export enum Sentiment {
  POSITIVE = 'positive',
  NEUTRAL = 'neutral',
  CONSTRUCTIVE = 'constructive',
}

export enum FeedbackVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  MANAGER_ONLY = 'manager_only',
}

@Entity('quick_feedbacks')
@Index('idx_qf_to_user', ['toUserId'])
@Index('idx_qf_from_user', ['fromUserId'])
export class QuickFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'from_user_id' })
  fromUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'from_user_id' })
  fromUser: User;

  @Column({ type: 'uuid', name: 'to_user_id' })
  toUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'to_user_id' })
  toUser: User;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: Sentiment })
  sentiment: Sentiment;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string;

  @Column({ type: 'boolean', default: false, name: 'is_anonymous' })
  isAnonymous: boolean;

  @Column({ type: 'enum', enum: FeedbackVisibility, default: FeedbackVisibility.PUBLIC, comment: 'public=visible a todos, private=solo emisor/receptor, manager_only=solo receptor y su manager' })
  visibility: FeedbackVisibility;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
