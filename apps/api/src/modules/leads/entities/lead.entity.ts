import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Lead capture de la landing pública de Ascenda (ascenda.cl + eva360.ascenda.cl/contacto).
 *
 * Diseño:
 *   - Es un prospecto pre-tenant (no tiene tenantId — todavía no existe como cliente).
 *   - El super_admin opera el pipeline desde /dashboard/leads.
 *   - Al convertir a cliente real, se crea el Tenant y se marca el lead como 'converted'
 *     con un puntero opcional al tenant creado (no implementado en P4, futuro).
 *
 * Estados:
 *   - new       — recién llegó, aún no contactado
 *   - contacted — Ricardo/equipo ya le escribió o llamó
 *   - qualified — lead califica (budget + timing + interés concreto)
 *   - converted — se firmó contrato y/o creó tenant
 *   - discarded — spam, mal fit, o no respondió
 */
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'discarded';

export type LeadOrigin = 'ascenda.cl' | 'eva360.ascenda.cl' | 'other';

@Entity('leads')
@Index('idx_leads_status', ['status'])
@Index('idx_leads_created_at', ['createdAt'])
@Index('idx_leads_email', ['email'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Datos enviados por el lead desde el form ─────────────────────────

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 150 })
  company: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  role: string | null;

  @Column({ type: 'varchar', length: 200 })
  email: string;

  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 20, name: 'company_size', nullable: true })
  companySize: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  industry: string | null;

  /** Región chilena (CL: metropolitana, valparaiso, biobio, etc.) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  region: string | null;

  /** Cómo nos conoció (linkedin, referencia, google, evento, prensa, otro) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  source: string | null;

  @Column({ type: 'text' })
  message: string;

  /** Origen de la petición: landing corporativa o la app de Eva360. */
  @Column({ type: 'varchar', length: 30, default: 'ascenda.cl' })
  origin: LeadOrigin;

  // ─── Metadata de seguridad / auditoría del envío ──────────────────────

  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 500, name: 'user_agent', nullable: true })
  userAgent: string | null;

  /** Token del CAPTCHA Turnstile que fue verificado contra Cloudflare al ingresar. */
  @Column({ type: 'varchar', length: 30, name: 'captcha_verdict', default: 'verified' })
  captchaVerdict: 'verified' | 'bypassed_dev' | 'failed';

  // ─── Pipeline interno operado por super_admin ────────────────────────

  @Column({ type: 'varchar', length: 20, default: 'new' })
  status: LeadStatus;

  /** Notas internas del equipo comercial (no visibles al lead). */
  @Column({ type: 'text', name: 'internal_notes', nullable: true })
  internalNotes: string | null;

  /** Usuario (super_admin) que tomó el lead / lo está atendiendo. */
  @Column({ type: 'uuid', name: 'assigned_to', nullable: true })
  assignedTo: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignee: User | null;

  /** Cuando se cambió el estado por última vez — útil para SLAs ("contactar en 24h"). */
  @Column({ type: 'timestamptz', name: 'status_changed_at', nullable: true })
  statusChangedAt: Date | null;

  @Column({ type: 'uuid', name: 'converted_tenant_id', nullable: true })
  convertedTenantId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
