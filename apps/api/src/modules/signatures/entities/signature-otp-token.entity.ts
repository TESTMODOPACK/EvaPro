import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * SignatureOtpToken — TAREA 3 / G9 (audit fix).
 *
 * Tabla dedicada para OTPs de firma con bcrypt + tracking de intentos
 * y consumo. Reemplaza los campos `signatureOtp` / `signatureOtpExpires`
 * en `users` (que se deprecan, no se eliminan en este release).
 *
 * Reglas:
 *  - codeHash: bcrypt del OTP de 6 dígitos (NUNCA plaintext en DB).
 *  - expiresAt: 10 minutos desde createdAt.
 *  - attempts: cuántas veces el usuario intentó verificar (max 5).
 *  - consumedAt: NULL = vivo; set una vez al consumirse exitosamente.
 *  - Rate limiting: max 3 tokens vivos por usuario en la última hora.
 *
 * Token "activo" = consumedAt IS NULL AND expiresAt > NOW() AND attempts < 5
 */
@Entity('signature_otp_tokens')
@Index('idx_sigotp_user_active', ['userId', 'consumedAt', 'expiresAt'])
@Index('idx_sigotp_tenant_created', ['tenantId', 'createdAt'])
@Index('idx_sigotp_user_doc', ['userId', 'documentType', 'documentId'])
export class SignatureOtpToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 50, name: 'document_type' })
  documentType: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  /** bcrypt hash del OTP plaintext de 6 dígitos. */
  @Column({ type: 'varchar', length: 120, name: 'code_hash' })
  codeHash: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** NULL = vivo. Una vez consumido, no se puede reusar. */
  @Column({ type: 'timestamptz', nullable: true, name: 'consumed_at' })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
