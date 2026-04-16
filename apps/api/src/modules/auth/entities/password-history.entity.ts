import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Rolling log of the last N password hashes for each user, used to enforce
 * `PasswordPolicy.historyCount` on password changes.
 *
 * Retention: `PasswordPolicyService.recordChange` trims to 24 entries per
 * user (hard cap). We NEVER store plaintext — only bcrypt hashes — so even
 * a full table dump reveals no usable passwords.
 *
 * CASCADE on delete: when a user is hard-deleted (rare; GDPR anonymizes
 * instead), the history goes with them automatically.
 */
@Entity('password_history')
@Index('idx_password_history_user_created', ['userId', 'createdAt'])
export class PasswordHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
