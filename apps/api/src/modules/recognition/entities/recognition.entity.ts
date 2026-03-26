import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
  Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { Competency } from '../../development/entities/competency.entity';

/**
 * Recognition: A public "kudos" from one user to another,
 * optionally linked to a corporate value (competency).
 * Each recognition awards points to the receiver.
 */
@Entity('recognitions')
@Index('idx_recog_tenant', ['tenantId'])
@Index('idx_recog_to', ['tenantId', 'toUserId'])
@Index('idx_recog_from', ['tenantId', 'fromUserId'])
export class Recognition {
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

  /** Corporate value linked to this recognition (optional) */
  @Column({ type: 'uuid', name: 'value_id', nullable: true })
  valueId: string | null;

  @ManyToOne(() => Competency, { nullable: true })
  @JoinColumn({ name: 'value_id' })
  value: Competency;

  /** Points awarded for this recognition */
  @Column({ type: 'int', default: 10 })
  points: number;

  /** Emoji reactions with user tracking (JSON: { "emoji": ["userId1", "userId2"] }) */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  reactions: Record<string, string[]>;

  @Column({ type: 'boolean', default: true, name: 'is_public' })
  isPublic: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
