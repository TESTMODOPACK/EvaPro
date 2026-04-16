import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Per-tenant OIDC Identity Provider configuration. One row per tenant;
 * disabled = row exists but `enabled=false` (we keep it for audit so we
 * can tell "client deactivated SSO" from "never had SSO").
 *
 * The client secret is stored encrypted (see `secret-crypto.ts`). We
 * NEVER return the ciphertext to the UI — the GET endpoint returns
 * `hasSecret: true/false` instead.
 */
@Entity('oidc_configurations')
@Unique(['tenantId'])
@Index('idx_oidc_configurations_enabled', ['enabled'])
export class OidcConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Issuer URL (e.g. `https://accounts.google.com`). We hit
   *  `${issuerUrl}/.well-known/openid-configuration` during config + login. */
  @Column({ type: 'varchar', length: 500, name: 'issuer_url' })
  issuerUrl: string;

  @Column({ type: 'varchar', length: 255, name: 'client_id' })
  clientId: string;

  /** Envelope produced by `encryptSecret()`. See secret-crypto.ts. */
  @Column({ type: 'varchar', length: 1000, name: 'client_secret_enc' })
  clientSecretEnc: string;

  /** When false, SSO endpoints refuse to create sessions for this tenant.
   *  Useful for staging configs that aren't ready to go live. */
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** When true, users whose email domain matches `allowedEmailDomains` MUST
   *  authenticate via SSO — password login returns 403 for them. Does NOT
   *  apply to super_admin (who may need to log in if the IdP is broken). */
  @Column({ type: 'boolean', default: false, name: 'require_sso' })
  requireSso: boolean;

  /**
   * Email domains this tenant's SSO accepts. Stored lowercase without the
   * `@`. Empty array = accept any domain (less safe; callers must still
   * match the tenant_slug).
   */
  @Column({ type: 'jsonb', default: () => "'[]'", name: 'allowed_email_domains' })
  allowedEmailDomains: string[];

  /**
   * Claim-to-role mapping. Keys are EvaPro roles; values are arrays of
   * `"<claim>:<value>"` matchers that promote the user to that role.
   *
   *   { "tenant_admin": ["groups:eva-admins"], "manager": ["groups:managers"] }
   *
   * First-match-wins, iterated in a fixed order (tenant_admin → manager →
   * employee fallback). The fallback role for unmapped users is always
   * `employee` — never `tenant_admin` to avoid accidental privilege
   * escalation from a misconfigured mapping.
   */
  @Column({ type: 'jsonb', default: () => "'{}'", name: 'role_mapping' })
  roleMapping: Record<string, string[]>;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
