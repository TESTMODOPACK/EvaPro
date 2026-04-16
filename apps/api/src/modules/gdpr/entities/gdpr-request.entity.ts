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

export type GdprRequestType = 'export_user' | 'export_tenant' | 'delete_user';
export type GdprRequestStatus =
  | 'pending'            // created but not yet dispatched
  | 'processing'         // worker is building the export / anonymizing
  | 'confirmed_pending'  // delete_user waiting for email code confirmation
  | 'completed'          // export ready / delete done
  | 'failed';            // something blew up; error_message populated

/**
 * One GDPR-related request: user export, tenant export, or account deletion.
 *
 * Kept as an audit trail independent of the audit_logs table so we can surface
 * request status in the user's /perfil UI without joining against the generic
 * audit feed.
 */
@Entity('gdpr_requests')
@Index('idx_gdpr_requests_user', ['userId'])
@Index('idx_gdpr_requests_tenant', ['tenantId'])
@Index('idx_gdpr_requests_status', ['status'])
@Index('idx_gdpr_requests_type_requested', ['type', 'requestedAt'])
export class GdprRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for super_admin deletions that aren't scoped to a tenant. */
  @Column({ type: 'uuid', nullable: true, name: 'tenant_id' })
  tenantId: string | null;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', length: 30 })
  type: GdprRequestType;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status: GdprRequestStatus;

  /** Public/signed URL of the generated export. Expires per `file_expires_at`. */
  @Column({ type: 'varchar', length: 1000, nullable: true, name: 'file_url' })
  fileUrl: string | null;

  /** After this timestamp we stop serving the link even if Cloudinary still has the file. */
  @Column({ type: 'timestamptz', nullable: true, name: 'file_expires_at' })
  fileExpiresAt: Date | null;

  /** 6-digit email code used to confirm a delete request. Cleared after use. */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'confirmation_code' })
  confirmationCode: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'confirmation_code_expires' })
  confirmationCodeExpires: Date | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt: Date | null;
}
