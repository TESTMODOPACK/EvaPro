import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'crypto';
import { OidcConfiguration } from '../entities/oidc-configuration.entity';
import { User } from '../../users/entities/user.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AuditService } from '../../audit/audit.service';
import { encryptSecret, decryptSecret, isSecretCryptoAvailable } from '../../../common/utils/secret-crypto';
import { SsoConfigDto } from './dto/sso-config.dto';

/**
 * Short-lived HMAC-signed cookie that carries (state, nonce, tenantId,
 * codeVerifier) through the OIDC redirect flow. We use an HMAC rather
 * than a DB row so the backend stays stateless. JWT_SECRET is reused.
 */
const STATE_TTL_SECONDS = 10 * 60; // 10 min

export interface DiscoverResult {
  ssoEnabled: boolean;
  ssoLoginUrl?: string;
  tenantName?: string;
}

export interface SsoLoginResult {
  authorizeUrl: string;
  stateCookie: string;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';
  private readonly apiUrl = process.env.API_URL || '';
  private readonly jwtSecret = process.env.JWT_SECRET || '';

  constructor(
    @InjectRepository(OidcConfiguration)
    private readonly oidcRepo: Repository<OidcConfiguration>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Feature availability ─────────────────────────────────────────────

  get isAvailable(): boolean {
    return isSecretCryptoAvailable() && !!this.apiUrl && !!this.jwtSecret;
  }

  private ensureAvailable() {
    if (!isSecretCryptoAvailable()) {
      throw new ServiceUnavailableException(
        'SSO no está configurado en este servidor (falta SSO_SECRET_KEY).',
      );
    }
    if (!this.apiUrl) {
      throw new ServiceUnavailableException(
        'SSO requiere la env var API_URL (URL pública del backend).',
      );
    }
  }

  // ─── Tenant admin: CRUD config ────────────────────────────────────────

  async getConfig(tenantId: string): Promise<{
    hasSecret: boolean;
    issuerUrl?: string;
    clientId?: string;
    enabled?: boolean;
    requireSso?: boolean;
    allowedEmailDomains?: string[];
    roleMapping?: Record<string, string[]>;
  }> {
    const row = await this.oidcRepo.findOne({ where: { tenantId } });
    if (!row) return { hasSecret: false };
    return {
      hasSecret: !!row.clientSecretEnc,
      issuerUrl: row.issuerUrl,
      clientId: row.clientId,
      enabled: row.enabled,
      requireSso: row.requireSso,
      allowedEmailDomains: row.allowedEmailDomains || [],
      roleMapping: row.roleMapping || {},
    };
  }

  async upsertConfig(tenantId: string, dto: SsoConfigDto, actorUserId: string): Promise<void> {
    this.ensureAvailable();
    await this.validateIssuer(dto.issuerUrl);

    const existing = await this.oidcRepo.findOne({ where: { tenantId } });
    const normalizedDomains = (dto.allowedEmailDomains ?? [])
      .map((d) => String(d).trim().toLowerCase().replace(/^@/, ''))
      .filter((d) => d.length > 0 && d.length <= 253);

    const entity = existing ?? this.oidcRepo.create({ tenantId });
    entity.issuerUrl = dto.issuerUrl;
    entity.clientId = dto.clientId;
    // Only rotate the stored secret if the caller actually supplied a new
    // one. On first creation we require it (guarded below); on edit we keep
    // the existing ciphertext so the UI can preserve it without round-trip.
    if (dto.clientSecret) {
      entity.clientSecretEnc = encryptSecret(dto.clientSecret);
    } else if (!entity.clientSecretEnc) {
      throw new BadRequestException('clientSecret es requerido en la primera configuración.');
    }
    entity.enabled = dto.enabled ?? false;
    entity.requireSso = dto.requireSso ?? false;
    entity.allowedEmailDomains = normalizedDomains;
    entity.roleMapping = dto.roleMapping ?? {};
    await this.oidcRepo.save(entity);

    await this.auditService
      .log(tenantId, actorUserId, 'sso.config_updated', 'OidcConfiguration', entity.id, {
        issuerUrl: dto.issuerUrl,
        enabled: entity.enabled,
        requireSso: entity.requireSso,
      })
      .catch(() => undefined);
  }

  async disable(tenantId: string, actorUserId: string): Promise<void> {
    const row = await this.oidcRepo.findOne({ where: { tenantId } });
    if (!row) throw new NotFoundException('Configuración SSO no encontrada.');
    row.enabled = false;
    row.requireSso = false;
    await this.oidcRepo.save(row);
    await this.auditService
      .log(tenantId, actorUserId, 'sso.disabled', 'OidcConfiguration', row.id, {})
      .catch(() => undefined);
  }

  /** Probe the issuer's discovery document — fast failure for typos. */
  private async validateIssuer(issuerUrl: string): Promise<void> {
    try {
      const { Issuer } = await import('openid-client');
      await Issuer.discover(issuerUrl);
    } catch (err: any) {
      throw new BadRequestException(
        `No pudimos consultar el issuer OIDC: ${err?.message || err}`,
      );
    }
  }

  // ─── Public: discover by email ────────────────────────────────────────

  async discoverByEmail(email: string, tenantSlug?: string): Promise<DiscoverResult> {
    if (!this.isAvailable) return { ssoEnabled: false };
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (!domain) return { ssoEnabled: false };

    // Find an enabled OIDC config whose allowedEmailDomains contains this
    // domain. If multiple tenants share the same email domain (rare for
    // enterprise, but possible for `gmail.com`), narrow by tenantSlug.
    const qb = this.oidcRepo
      .createQueryBuilder('o')
      .innerJoin(Tenant, 't', 't.id = o.tenantId')
      .where('o.enabled = true')
      .andWhere(`(o.allowedEmailDomains @> :domainArr OR o.allowedEmailDomains = '[]'::jsonb)`, {
        domainArr: JSON.stringify([domain]),
      })
      .andWhere('t.isActive = true')
      .select(['o.id', 'o.tenantId', 't.name AS tenant_name', 't.slug AS tenant_slug', 't.rut AS tenant_rut']);
    if (tenantSlug) {
      qb.andWhere('(t.slug = :tenantSlug OR t.rut = :tenantSlug)', { tenantSlug });
    }

    const rows = await qb.getRawMany();
    if (rows.length === 0) return { ssoEnabled: false };
    if (rows.length > 1 && !tenantSlug) {
      // Ambiguous — tell the UI to ask for the tenant identifier.
      return { ssoEnabled: false };
    }
    const row = rows[0];
    const loginUrl = `${this.apiUrl}/auth/sso/login?tenantId=${row.o_tenantId}`;
    return {
      ssoEnabled: true,
      ssoLoginUrl: loginUrl,
      tenantName: row.tenant_name,
    };
  }

  /** Look up an OIDC config by tenantId — used by `start` and `callback`. */
  private async loadEnabledConfig(tenantId: string): Promise<OidcConfiguration> {
    const cfg = await this.oidcRepo.findOne({ where: { tenantId } });
    if (!cfg || !cfg.enabled) {
      throw new UnauthorizedException('SSO no está activo para este tenant.');
    }
    return cfg;
  }

  /**
   * Check whether a tenant's policy FORCES SSO for users matching its
   * allowed email domains. Used by `auth.service.login` to block password
   * login for SSO-only users.
   */
  async isSsoRequiredForEmail(email: string, tenantId: string): Promise<{ required: boolean; loginUrl?: string }> {
    const cfg = await this.oidcRepo.findOne({ where: { tenantId } });
    if (!cfg || !cfg.enabled || !cfg.requireSso) return { required: false };
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (!domain) return { required: false };
    const domains = (cfg.allowedEmailDomains || []).map((d) => String(d).toLowerCase());
    if (domains.length > 0 && !domains.includes(domain)) return { required: false };
    return { required: true, loginUrl: `${this.apiUrl}/auth/sso/login?tenantId=${tenantId}` };
  }

  // ─── Public: start login (redirect to IdP) ────────────────────────────

  async startLogin(tenantId: string): Promise<SsoLoginResult> {
    this.ensureAvailable();
    const cfg = await this.loadEnabledConfig(tenantId);

    // Load the discovery document fresh per-login. For prod hardening we
    // could cache the Issuer instance, but it's rare enough not to bother.
    const { Issuer, generators } = await import('openid-client');
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: decryptSecret(cfg.clientSecretEnc),
      redirect_uris: [`${this.apiUrl}/auth/sso/callback`],
      response_types: ['code'],
    });

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    // HMAC-sign the state bag so the callback can recover tenantId + nonce +
    // PKCE verifier without DB lookups. `iat`+`exp` are checked on the way back.
    const cookie = this.signStateCookie({
      tenantId,
      state,
      nonce,
      codeVerifier,
      iat: Math.floor(Date.now() / 1000),
    });

    const authorizeUrl = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { authorizeUrl, stateCookie: cookie };
  }

  // ─── Public: callback from IdP ────────────────────────────────────────

  async handleCallback(
    rawStateCookie: string,
    callbackQuery: Record<string, unknown>,
  ): Promise<{ access_token: string }> {
    this.ensureAvailable();

    const parsed = this.verifyStateCookie(rawStateCookie);
    if (!parsed) {
      throw new UnauthorizedException('Sesión SSO expirada o manipulada.');
    }
    const { tenantId, state, nonce, codeVerifier } = parsed;

    if (typeof callbackQuery.state !== 'string' || callbackQuery.state !== state) {
      throw new UnauthorizedException('State mismatch en callback SSO.');
    }

    const cfg = await this.loadEnabledConfig(tenantId);
    const { Issuer } = await import('openid-client');
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: decryptSecret(cfg.clientSecretEnc),
      redirect_uris: [`${this.apiUrl}/auth/sso/callback`],
      response_types: ['code'],
    });

    let tokenSet;
    try {
      tokenSet = await client.callback(
        `${this.apiUrl}/auth/sso/callback`,
        callbackQuery as any,
        { state, nonce, code_verifier: codeVerifier },
      );
    } catch (err: any) {
      this.logger.warn(`SSO callback failed: ${err?.message || err}`);
      throw new UnauthorizedException('El proveedor rechazó el login.');
    }

    const claims = tokenSet.claims();
    if (!claims?.email) {
      throw new UnauthorizedException('El IdP no entregó el email del usuario.');
    }
    const email = String(claims.email).toLowerCase();
    const emailDomain = email.split('@')[1] || '';

    // Prevent IdP → wrong tenant crossover.
    if (cfg.allowedEmailDomains.length > 0 && !cfg.allowedEmailDomains.includes(emailDomain)) {
      await this.auditService
        .log(tenantId, null, 'sso.domain_rejected', 'OidcConfiguration', cfg.id, {
          email,
          allowedDomains: cfg.allowedEmailDomains,
        })
        .catch(() => undefined);
      throw new ForbiddenException('Tu dominio de email no está autorizado para este tenant.');
    }

    const user = await this.resolveOrProvisionUser(tenantId, claims);
    await this.auditService
      .log(tenantId, user.id, 'sso.login', 'User', user.id, {
        email,
        provider: cfg.issuerUrl,
      })
      .catch(() => undefined);

    // Emit the JWT. `authMethod: 'sso'` flag lets /perfil show "2FA managed
    // by your IdP" instead of our own TOTP setup. Session timeout honors
    // the same per-tenant override as password logins.
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
    let expiresIn: string | number = process.env.JWT_EXPIRATION || '30m';
    const timeout = (tenant?.settings as any)?.sessionTimeoutMinutes;
    if (typeof timeout === 'number' && timeout > 0) expiresIn = `${timeout}m`;

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      tv: user.tokenVersion ?? 0,
      authMethod: 'sso',
    };
    // Cast expiresIn to `any` — the SignOptions type accepts both number and
    // the `ms` string format ('30m' etc.) but the TS typings only list the
    // number form via StringValue. AuthService uses the same cast.
    return { access_token: this.jwtService.sign(payload, { expiresIn } as any) };
  }

  private async resolveOrProvisionUser(tenantId: string, claims: any): Promise<User> {
    const email = String(claims.email).toLowerCase();
    const existing = await this.userRepo.findOne({ where: { tenantId, email } });
    if (existing) {
      if (!existing.isActive) {
        throw new UnauthorizedException('Usuario inactivo.');
      }
      return existing;
    }

    // JIT provisioning — enforce the tenant's `maxEmployees` limit so a
    // compromised IdP can't fill the tenant to its plan cap with spam users.
    // Count only active users (inactive ones don't consume seats).
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'maxEmployees'],
    });
    if (tenant && typeof tenant.maxEmployees === 'number' && tenant.maxEmployees > 0) {
      const currentUsers = await this.userRepo.count({
        where: { tenantId, isActive: true },
      });
      if (currentUsers >= tenant.maxEmployees) {
        await this.auditService
          .log(tenantId, null, 'sso.user_limit_exceeded', 'Tenant', tenantId, {
            email,
            currentUsers,
            maxEmployees: tenant.maxEmployees,
          })
          .catch(() => undefined);
        throw new ForbiddenException(
          'Tu organización alcanzó el límite de usuarios del plan. Contacta al admin.',
        );
      }
    }

    const cfg = await this.oidcRepo.findOne({ where: { tenantId } });
    const mapping = (cfg?.roleMapping || {}) as Record<string, string[]>;
    const resolvedRole = this.pickRoleFromClaims(claims, mapping);

    const firstName = String(claims.given_name || claims.name || email.split('@')[0]);
    const lastName = String(claims.family_name || '');

    const created = this.userRepo.create({
      tenantId,
      email,
      firstName,
      lastName,
      role: resolvedRole,
      isActive: true,
      mustChangePassword: false,
      // SSO users have no password; `password_hash` is null. Other auth
      // paths (forgot password, change password) check for this and refuse
      // to operate on passwordless accounts.
      passwordHash: null as any,
      twoFactorEnabled: false,
      tokenVersion: 0,
    });
    const saved = await this.userRepo.save(created);
    await this.auditService
      .log(tenantId, saved.id, 'sso.user_provisioned', 'User', saved.id, {
        role: resolvedRole,
        email,
        provider: cfg?.issuerUrl || null,
      })
      .catch(() => undefined);
    return saved;
  }

  /**
   * First match in priority order wins: tenant_admin > manager > employee.
   * Rules are `"<claim>:<value>"` strings; `claim` is looked up on the
   * OIDC claims object. Arrays are checked for inclusion.
   */
  private pickRoleFromClaims(claims: any, mapping: Record<string, string[]>): string {
    const priority = ['tenant_admin', 'manager', 'employee', 'external'];
    for (const role of priority) {
      const rules = mapping[role] || [];
      for (const rule of rules) {
        const sep = rule.indexOf(':');
        if (sep <= 0) continue;
        const claimKey = rule.slice(0, sep);
        const expected = rule.slice(sep + 1);
        const val = claims[claimKey];
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          if (val.map(String).includes(expected)) return role;
        } else if (String(val) === expected) {
          return role;
        }
      }
    }
    // Default fallback: `employee`. We never auto-promote to tenant_admin.
    return 'employee';
  }

  // ─── State cookie signing (HMAC, stateless) ───────────────────────────

  private signStateCookie(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.jwtSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyStateCookie(raw: string): {
    tenantId: string;
    state: string;
    nonce: string;
    codeVerifier: string;
    iat: number;
  } | null {
    if (!raw || typeof raw !== 'string' || !raw.includes('.')) return null;
    const [body, sig] = raw.split('.');
    const expected = createHmac('sha256', this.jwtSecret).update(body).digest('base64url');
    if (sig !== expected) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (
      typeof parsed?.tenantId !== 'string' ||
      typeof parsed?.state !== 'string' ||
      typeof parsed?.nonce !== 'string' ||
      typeof parsed?.codeVerifier !== 'string' ||
      typeof parsed?.iat !== 'number'
    ) {
      return null;
    }
    const age = Math.floor(Date.now() / 1000) - parsed.iat;
    if (age < 0 || age > STATE_TTL_SECONDS) return null;
    return parsed;
  }
}
