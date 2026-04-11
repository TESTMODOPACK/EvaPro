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
import { CalibrationSession } from './calibration-session.entity';
import { User } from '../../users/entities/user.entity';

@Entity('calibration_entries')
@Index('idx_calib_entry_session', ['sessionId'])
export class CalibrationEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'session_id' })
  sessionId: string;

  @ManyToOne(() => CalibrationSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: CalibrationSession;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'original_score', default: 0 })
  originalScore: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'adjusted_score', nullable: true })
  adjustedScore: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'original_potential', nullable: true })
  originalPotential: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'adjusted_potential', nullable: true })
  adjustedPotential: number | null;

  @Column({ type: 'text', nullable: true })
  rationale: string | null;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status: string; // pending | discussed | agreed

  @Column({ type: 'uuid', name: 'discussed_by', nullable: true })
  discussedBy: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'discussed_by' })
  discusser: User;

  @Column({ type: 'jsonb', name: 'change_log', nullable: true, default: '[]', comment: 'Historial de ajustes: [{date, userId, field, from, to, rationale}]' })
  changeLog: Array<{ date: string; userId: string; field: string; from: any; to: any; rationale?: string }>;

  @Column({ type: 'boolean', name: 'approval_required', default: false, comment: 'True si el ajuste supera 2 puntos y requiere aprobación CHRO' })
  approvalRequired: boolean;

  @Column({ type: 'varchar', length: 30, name: 'approval_status', default: 'not_required', comment: 'not_required | pending_approval | approved | rejected' })
  approvalStatus: string;

  @Column({ type: 'uuid', name: 'approved_by', nullable: true })
  approvedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver: User | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
