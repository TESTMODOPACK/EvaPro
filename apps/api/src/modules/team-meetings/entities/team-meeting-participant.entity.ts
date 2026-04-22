import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { TeamMeeting } from './team-meeting.entity';
import { User } from '../../users/entities/user.entity';

/**
 * v3.1 Tema B — Participante de una reunión de equipo (tabla pivote).
 *
 * Cada fila representa la invitación de UN user a UNA reunión, con su
 * estado de respuesta. Constraint único (meeting_id, user_id) evita
 * invitar al mismo user dos veces.
 *
 * Semántica de estado:
 *   - invited   — fue invitado, aún no respondió.
 *   - accepted  — confirmó asistencia.
 *   - declined  — rechazó la invitación (opcional cancelReason).
 *   - attended  — marcado post-reunión por el organizador (deferido;
 *                 por ahora el cierre no distingue, lo dejamos en enum
 *                 para futuras stats de asistencia).
 */
export enum ParticipantStatus {
  INVITED = 'invited',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  ATTENDED = 'attended',
}

@Entity('team_meeting_participants')
@Unique('uq_tmp_meeting_user', ['meetingId', 'userId'])
@Index('idx_tmp_user', ['userId'])
@Index('idx_tmp_meeting', ['meetingId'])
export class TeamMeetingParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'meeting_id' })
  meetingId: string;

  @ManyToOne(() => TeamMeeting, (m) => m.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: TeamMeeting;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: ParticipantStatus,
    default: ParticipantStatus.INVITED,
  })
  status: ParticipantStatus;

  @Column({ type: 'text', name: 'decline_reason', nullable: true })
  declineReason: string | null;

  @Column({ type: 'timestamptz', name: 'invited_at', default: () => 'NOW()' })
  invitedAt: Date;

  @Column({ type: 'timestamptz', name: 'responded_at', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
