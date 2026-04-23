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

@Entity('document_signatures')
@Index('idx_dsig_tenant', ['tenantId'])
@Index('idx_dsig_document', ['tenantId', 'documentType', 'documentId'])
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
}
