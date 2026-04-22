import {
  Column, CreateDateColumn, DeleteDateColumn, Entity, Index,
  JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Recognition } from './recognition.entity';
import { User } from '../../users/entities/user.entity';

/**
 * v3.1 F7 — Comentarios sobre un Recognition (muro social).
 *
 * Soft-delete con `deletedAt`: al borrar, ocultamos del feed pero
 * conservamos la fila (auditoría + restore eventual).
 */
@Entity('recognition_comments')
@Index('idx_rc_recognition', ['recognitionId'])
@Index('idx_rc_from', ['fromUserId'])
export class RecognitionComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'recognition_id' })
  recognitionId: string;

  @ManyToOne(() => Recognition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recognition_id' })
  recognition: Recognition;

  @Column({ type: 'uuid', name: 'from_user_id' })
  fromUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_user_id' })
  fromUser: User;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
