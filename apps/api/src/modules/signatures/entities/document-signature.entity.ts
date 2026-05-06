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

/**
 * SignatureRole — TAREA 4 / Auditoría CTO firmas.
 *
 * Distingue el rol del firmante en el documento:
 *  - recipient: el evaluado/dueño firma de recepción (caso default histórico).
 *  - author: el manager/external firma como autor del feedback emitido (G2).
 *  - employer_witness: el tenant_admin co-firma como representante del empleador (G3).
 */
export enum SignatureRole {
  RECIPIENT = 'recipient',
  AUTHOR = 'author',
  EMPLOYER_WITNESS = 'employer_witness',
}

/**
 * AcknowledgmentType — TAREA 4 / G5.
 *
 * Tipo de reconocimiento de la firma:
 *  - agree: firma plena ("acuerdo").
 *  - agree_with_comments: firma con comentarios (no es rechazo).
 *  - decline: firma de rechazo formal (queda registrada para auditoría).
 *    NO transiciona estados de cierre del documento.
 */
export enum AcknowledgmentType {
  AGREE = 'agree',
  AGREE_WITH_COMMENTS = 'agree_with_comments',
  DECLINE = 'decline',
}

@Entity('document_signatures')
@Index('idx_dsig_tenant', ['tenantId'])
@Index('idx_dsig_document', ['tenantId', 'documentType', 'documentId'])
@Index('idx_dsig_doc_role', ['tenantId', 'documentType', 'documentId', 'signatureRole'])
export class DocumentSignature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 50, name: 'document_type', comment: 'evaluation_cycle | calibration_session | development_plan | evaluation_response' })
  documentType: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar', length: 300, name: 'document_name', nullable: true, comment: 'Human-readable document name for display' })
  documentName: string | null;

  @Column({ type: 'varchar', length: 64, name: 'document_hash', comment: 'SHA-256 hash of the document content at signing time' })
  documentHash: string;

  @Column({ type: 'uuid', name: 'signed_by' })
  signedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'signed_by' })
  signer: User;

  @Column({ type: 'varchar', length: 45, name: 'signer_ip', nullable: true })
  signerIp: string | null;

  @Column({ type: 'varchar', length: 30, name: 'verification_method', default: 'otp_email', comment: 'otp_email | password' })
  verificationMethod: string;

  @Column({ type: 'varchar', length: 20, default: 'valid', comment: 'valid | revoked' })
  status: string;

  /**
   * Rol del firmante en este documento. TAREA 4 / G2 / G3.
   * default 'recipient' (compat con comportamiento histórico).
   */
  @Column({
    type: 'varchar',
    length: 30,
    name: 'signature_role',
    default: SignatureRole.RECIPIENT,
    comment: 'recipient | author | employer_witness',
  })
  signatureRole: SignatureRole;

  /**
   * Tipo de reconocimiento. TAREA 4 / G5. NULL para firmas pre-G5
   * (legacy se considera 'agree' implícito).
   */
  @Column({
    type: 'varchar',
    length: 30,
    name: 'acknowledgment_type',
    nullable: true,
    comment: 'agree | agree_with_comments | decline',
  })
  acknowledgmentType: AcknowledgmentType | null;

  /**
   * Comentario opcional asociado al acknowledgment. Obligatorio en
   * service layer cuando acknowledgmentType !== 'agree'.
   */
  @Column({ type: 'text', name: 'acknowledgment_comment', nullable: true })
  acknowledgmentComment: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'signed_at' })
  signedAt: Date;

  // F-002 — Signature rerouting al desvincular firmante. Cuando un user
  // con firmas pendientes es desvinculado, registerDeparture marca sus
  // firmas completadas con rerouted_to = nuevo responsable designado
  // (reassignToManagerId) para trazabilidad de auditoría.
  @Column({ type: 'uuid', name: 'rerouted_to', nullable: true, comment: 'F-002 — Usuario al que se re-asignó la firma tras desvinculación del firmante original' })
  reroutedTo: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rerouted_to' })
  rerouter: User | null;

  @Column({ type: 'timestamptz', name: 'rerouted_at', nullable: true, comment: 'F-002 — Timestamp del reroute de firma' })
  reroutedAt: Date | null;

  // ─── G8 (TAREA 9) — Revocación de firma ────────────────────────────
  // Una firma revocada NO se elimina (auditoría legal exige preservarla).
  // Solo super_admin puede revocar. La firma original sigue siendo
  // visible en historial pero no cuenta para validaciones de cierre.

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'uuid', name: 'revoked_by', nullable: true })
  revokedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'revoked_by' })
  revoker: User | null;

  @Column({ type: 'text', name: 'revocation_reason', nullable: true })
  revocationReason: string | null;
}
