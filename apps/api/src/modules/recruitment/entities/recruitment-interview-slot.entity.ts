import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, Index,
} from 'typeorm';

export enum InterviewSlotStatus {
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

/**
 * S7.2 — Slot agendado para entrevistar a un candidato.
 *
 * Diferente de RecruitmentInterview (resultado de la entrevista con
 * scores y comentarios): este es la planificacion + invitacion, anterior
 * al evento.
 *
 * Lifecycle:
 *   1. Admin agenda slot → status='scheduled', envia .ics email.
 *   2a. Si entrevista ocurre → admin marca completed (manual) y
 *       submitInterview crea el registro de scoring.
 *   2b. Si candidato no aparece → admin marca no_show.
 *   2c. Si se cancela antes → admin marca cancelled con cancelReason.
 *   3. Cron `markPastSlotsCompleted` corre diario y marca como
 *      'completed' los slots cuya scheduledAt + duration < now() y
 *      siguen en 'scheduled' (auto-transicion para que el flow de
 *      scoring no se bloquee).
 *
 * Multi-tenant: tenant_id obligatorio. Indexes para queries comunes:
 * proximos slots por evaluator, slots por candidato.
 */
@Entity('recruitment_interview_slots')
@Index('idx_ris_evaluator_scheduled', ['evaluatorId', 'scheduledAt'])
@Index('idx_ris_candidate_scheduled', ['candidateId', 'scheduledAt'])
@Index('idx_ris_tenant_status', ['tenantId', 'status'])
export class RecruitmentInterviewSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @Column({ type: 'timestamptz', name: 'scheduled_at' })
  scheduledAt: Date;

  @Column({ type: 'int', name: 'duration_minutes', default: 60 })
  durationMinutes: number;

  /**
   * URL de la reunion (Google Meet, Zoom, etc). Opcional — si no se
   * provee, el .ics se manda como evento de calendario sin link.
   * El admin puede pegar el link al agendar o agregar uno luego.
   */
  @Column({ type: 'text', name: 'meeting_url', nullable: true })
  meetingUrl: string | null;

  @Column({ type: 'enum', enum: InterviewSlotStatus, default: InterviewSlotStatus.SCHEDULED })
  status: InterviewSlotStatus;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason: string | null;

  /**
   * Notas privadas del admin sobre la entrevista (preguntas a hacer,
   * areas a evaluar). NO se envian al candidato. El evaluator si las
   * ve cuando carga la app.
   */
  @Column({ type: 'text', name: 'admin_notes', nullable: true })
  adminNotes: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  /**
   * S7.2 — Tracking de notificaciones enviadas para evitar spam:
   *   - reminderSent24h: cron que envia recordatorio 24h antes lo marca true.
   *   - reminderSent1h: cron que envia recordatorio 1h antes lo marca true.
   * Se resetean si se reagenda el slot (admin cambia scheduledAt).
   */
  @Column({ type: 'boolean', name: 'reminder_sent_24h', default: false })
  reminderSent24h: boolean;

  @Column({ type: 'boolean', name: 'reminder_sent_1h', default: false })
  reminderSent1h: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
