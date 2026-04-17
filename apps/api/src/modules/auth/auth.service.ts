import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { generateTotpSecret, generateTotpUri, verifyTotp } from '../../common/utils/totp';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { PasswordPolicyService } from './password-policy.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async validateUser(email: string, pass: string, tenantId?: string): Promise<any> {
    const user = await this.usersService.findByEmail(email, tenantId);
    if (!user || !user.passwordHash) {
      // Don't reveal which half failed. Also don't increment lockout — we
      // can't pin a counter to a non-existent user. The controller's IP-
      // level rate limiter handles that case.
      return null;
    }

    // Lockout short-circuit. Resolve the tenant's policy once per login
    // rather than on every failed bcrypt — the read is cached upstream.
    const policy = await this.passwordPolicy.resolvePolicy(user.tenantId ?? null);
    const minsLeft = this.passwordPolicy.minutesUntilUnlocked(user);
    if (minsLeft !== null) {
      // Still locked — don't even bother comparing the password.
      throw new UnauthorizedException(
        `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minsLeft} minuto${minsLeft > 1 ? 's' : ''}.`,
      );
    }

    const validPassword = await bcrypt.compare(pass, user.passwordHash);
    if (!validPassword) {
      // Record against the actual user id so a brute-force doesn't hit a
      // moving target when the attacker varies the email case/spelling.
      await this.passwordPolicy.recordFailedAttempt(user.id, policy).catch(() => undefined);
      return null;
    }

    // Check user is active
    if (!user.isActive) return null;

    // Check tenant is active (super_admin may not have a tenant relation loaded)
    if (user.role !== 'super_admin' && user.tenant && !user.tenant.isActive) {
      return null;
    }

    // Password correct + user/tenant active — reset lockout counters.
    await this.passwordPolicy.clearFailedAttempts(user.id).catch(() => undefined);

    // Surface expiry status so the caller can force a password change
    // without issuing a full session token.
    const expired = this.passwordPolicy.isExpired(user, policy);

    const { passwordHash, ...result } = user;
    return { ...result, passwordExpired: expired };
  }

  async login(user: any, ipAddress?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      // tv: bump en BD invalida todos los JWTs emitidos (usado por cascade
      // de desvinculación y cualquier logout remoto futuro).
      tv: user.tokenVersion ?? 0,
    };

    // Log successful login — super_admin logs are system-level (tenantId=null)
    // to prevent them from leaking into tenant_admin audit views.
    await this.auditService.log(
      user.role === 'super_admin' ? null : (user.tenantId || null),
      user.id,
      'login',
      'User',
      user.id,
      { email: user.email, role: user.role },
      ipAddress,
    );

    // B11.1: Per-tenant session timeout (falls back to global JWT_EXPIRATION)
    let expiresIn = this.configService.get('JWT_EXPIRATION', '30m');
    if (user.tenantId) {
      try {
        const tenant = await this.tenantRepo.findOne({
          where: { id: user.tenantId },
          select: ['id', 'settings'],
        });
        const timeout = tenant?.settings?.sessionTimeoutMinutes;
        if (typeof timeout === 'number' && timeout > 0) {
          expiresIn = `${timeout}m`;
        }
      } catch {
        // Fallback to global timeout on any error
      }
    }

    return {
      access_token: this.jwtService.sign(payload, { expiresIn }),
    };
  }

  // ─── Token Refresh ──────────────────────────────────────────────────

  async refreshToken(userId: string, tenantId: string | null): Promise<{ access_token: string }> {
    // Scope the lookup to the tenant claimed in the token. If the user no
    // longer belongs to that tenant (moved, deleted, claim tampered), we
    // return 401 — preventing cross-tenant refresh attacks.
    const user = await this.userRepo.findOne({
      where: tenantId
        ? { id: userId, tenantId }
        : { id: userId, tenantId: IsNull() }, // super_admin: no tenant
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      tv: user.tokenVersion ?? 0,
    };

    // Same per-tenant timeout logic as login
    let expiresIn = this.configService.get('JWT_EXPIRATION', '30m');
    if (user.tenantId) {
      try {
        const tenant = await this.tenantRepo.findOne({
          where: { id: user.tenantId },
          select: ['id', 'settings'],
        });
        const timeout = tenant?.settings?.sessionTimeoutMinutes;
        if (typeof timeout === 'number' && timeout > 0) {
          expiresIn = `${timeout}m`;
        }
      } catch {
        // Fallback to global timeout
      }
    }

    return {
      access_token: this.jwtService.sign(payload, { expiresIn }),
    };
  }

  /**
   * Resolve the tenantId for an email (used by the public password-policy
   * endpoint so the force-change modal on /login can fetch the right rules
   * WITHOUT leaking whether the email exists). Returns null on any failure —
   * the caller falls back to the default policy.
   */
  async resolveTenantIdForEmail(email: string, tenantSlug?: string): Promise<string | null> {
    try {
      const user = await this.usersService.findByEmail(email, tenantSlug);
      return user?.tenantId ?? null;
    } catch {
      return null;
    }
  }

  // ─── Password Reset ──────────────────────────────────────────────────

  async requestPasswordReset(email: string, tenantSlug?: string): Promise<void> {
    const user = await this.usersService.findByEmail(email, tenantSlug);
    if (!user) {
      // Don't reveal if user exists — silently succeed
      return;
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.resetCode = code;
    user.resetCodeExpires = expires;
    await this.userRepo.save(user);

    // Send branded email via EmailService (Resend) — fire-and-forget to avoid 500 on email failure
    try {
      await this.emailService.sendPasswordReset(user.email, {
        firstName: user.firstName,
        code,
        expiryMinutes: 15,
        tenantId: user.tenantId || undefined,
      });
    } catch {
      // Email failure should not block password reset flow
    }
  }

  /** Log failed login attempt to audit log */
  async logFailedLogin(email: string, ipAddress: string, tenantSlug?: string): Promise<void> {
    try {
      const user = await this.usersService.findByEmail(email, tenantSlug);
      await this.auditService.log(
        user?.role === 'super_admin' ? null : (user?.tenantId || null),
        user?.id || null,
        'login.failed',
        'User',
        user?.id || undefined,
        { email, reason: user ? (user.isActive ? 'invalid_password' : 'inactive_user') : 'user_not_found' },
        ipAddress,
      );
    } catch {
      // Non-critical — don't block login flow
    }
  }

  /** Change password on first login (mustChangePassword flow) */
  async changePasswordFirstLogin(email: string, currentPassword: string, newPassword: string, tenantSlug?: string): Promise<void> {
    const user = await this.usersService.findByEmail(email, tenantSlug);
    if (!user || !user.passwordHash) {
      throw new BadRequestException('Credenciales inválidas');
    }
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    // Tenant-scoped policy validation (replaces the hardcoded regex).
    const policy = await this.passwordPolicy.resolvePolicy(user.tenantId ?? null);
    const err = this.passwordPolicy.validate(newPassword, policy);
    if (err) throw new BadRequestException(err);

    // Reject reuse of any of the last N passwords (if history enforcement is on).
    if (await this.passwordPolicy.matchesHistory(user.id, newPassword, policy.historyCount)) {
      throw new BadRequestException(
        `La nueva contraseña no puede ser igual a las últimas ${policy.historyCount} ya usadas.`,
      );
    }

    const newHash = await bcrypt.hash(newPassword, this.passwordPolicy.bcryptRounds);
    user.passwordHash = newHash;
    user.mustChangePassword = false;
    user.resetCode = null;
    user.resetCodeExpires = null;
    // Bump token_version so older JWTs (including the force-change redirect
    // one) are invalidated — the user must re-login with the new password.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);

    // Persist in history + stamp passwordChangedAt — done after save so a
    // transaction rollback on save() prevents an orphan history row.
    await this.passwordPolicy.recordChange(user.id, newHash);

    await this.auditService.log(
      user.role === 'super_admin' ? null : (user.tenantId || null),
      user.id,
      'password.changed_first_login',
      'User',
      user.id,
    ).catch(() => {});
  }

  async resetPassword(email: string, code: string, newPassword: string, tenantSlug?: string): Promise<void> {
    const user = await this.usersService.findByEmail(email, tenantSlug);
    if (!user) {
      throw new BadRequestException('Código inválido o expirado');
    }

    if (
      !user.resetCode ||
      user.resetCode !== code ||
      !user.resetCodeExpires ||
      new Date() > user.resetCodeExpires
    ) {
      throw new BadRequestException('Código inválido o expirado');
    }

    // Validate against the tenant's policy (replaces the controller's regex).
    const policy = await this.passwordPolicy.resolvePolicy(user.tenantId ?? null);
    const err = this.passwordPolicy.validate(newPassword, policy);
    if (err) throw new BadRequestException(err);

    if (await this.passwordPolicy.matchesHistory(user.id, newPassword, policy.historyCount)) {
      throw new BadRequestException(
        `La nueva contraseña no puede ser igual a las últimas ${policy.historyCount} ya usadas.`,
      );
    }

    const newHash = await bcrypt.hash(newPassword, this.passwordPolicy.bcryptRounds);
    user.passwordHash = newHash;
    user.resetCode = null;
    user.resetCodeExpires = null;
    user.mustChangePassword = false;
    // Bump token_version so any session stolen with the previous password
    // is immediately invalidated — without this, an attacker who captured
    // the old JWT could still use it until natural expiry.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    // Reset any lockout so the user can log in with the new password.
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.userRepo.save(user);

    await this.passwordPolicy.recordChange(user.id, newHash);

    await this.auditService.log(
      user.role === 'super_admin' ? null : (user.tenantId || null),
      user.id,
      'password.reset',
      'User',
      user.id,
    ).catch(() => {});
  }

  // ─── 2FA / MFA ─────────────────────────────────────────────────────

  /**
   * Build the tenant-scoped WHERE clause for user lookups used by 2FA methods.
   * super_admin users may not have a tenantId, so we match on NULL in that case.
   */
  private tenantScopedUserWhere(userId: string, tenantId: string | null): any {
    if (tenantId) return { id: userId, tenantId };
    return { id: userId, tenantId: IsNull() };
  }

  /** Step 1: Generate secret and return URI for QR code */
  async setup2FA(userId: string, tenantId: string | null): Promise<{ secret: string; uri: string }> {
    const user = await this.userRepo.findOne({ where: this.tenantScopedUserWhere(userId, tenantId) });
    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA ya está activado');

    const secret = generateTotpSecret();
    user.twoFactorSecret = secret;
    await this.userRepo.save(user);

    const uri = generateTotpUri(secret, user.email);
    return { secret, uri };
  }

  /** Step 2: Verify code and enable 2FA */
  async enable2FA(userId: string, tenantId: string | null, code: string): Promise<{ enabled: boolean }> {
    const user = await this.userRepo.findOne({ where: this.tenantScopedUserWhere(userId, tenantId) });
    if (!user || !user.twoFactorSecret) throw new BadRequestException('Primero debes configurar 2FA');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA ya está activado');

    if (!verifyTotp(user.twoFactorSecret, code)) {
      throw new BadRequestException('Código inválido. Verifica que tu app autenticadora esté sincronizada.');
    }

    user.twoFactorEnabled = true;
    await this.userRepo.save(user);
    await this.auditService.log(
      user.role === 'super_admin' ? null : (user.tenantId || null),
      userId,
      '2fa.enabled',
      'User',
      userId,
    ).catch(() => {});
    return { enabled: true };
  }

  /** Disable 2FA */
  async disable2FA(userId: string, tenantId: string | null, password: string): Promise<{ disabled: boolean }> {
    const user = await this.userRepo.findOne({ where: this.tenantScopedUserWhere(userId, tenantId) });
    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (!user.twoFactorEnabled) throw new BadRequestException('2FA no está activado');

    // Require password to disable (security)
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BadRequestException('Contraseña incorrecta');
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await this.userRepo.save(user);
    await this.auditService.log(
      user.role === 'super_admin' ? null : (user.tenantId || null),
      userId,
      '2fa.disabled',
      'User',
      userId,
    ).catch(() => {});
    return { disabled: true };
  }

  /**
   * Verify 2FA code during login.
   *
   * Invariantes de seguridad (todos deben cumplirse para que retorne true):
   *
   *   1. `user` proviene de `validateUser()`, que ya lo resolvió por
   *      email+password+tenantSlug — garantiza que no hay cross-tenant
   *      manipulation aquí. Si este método se llama desde otro contexto
   *      en el futuro, el caller es responsable de scopear `user`.
   *
   *   2. `user.twoFactorEnabled === true` — requerido explícitamente
   *      (antes se confiaba en que el caller chequeó). Un user con
   *      `twoFactorSecret` seteado pero no-enabled (hizo setup pero no
   *      completó enable) NO puede autenticar con TOTP.
   *
   *   3. `user.twoFactorSecret` presente y `code` válido contra ese
   *      secret. El TOTP lib usa una ventana de tolerancia de ±30s para
   *      clock drift, lo cual no es configurable desde aquí.
   *
   *   4. `code` es un string de 6 dígitos. Cualquier otra cosa (null,
   *      undefined, string vacío, formato raro) retorna false sin
   *      leakear info sobre por qué falló.
   */
  verify2FACode(user: { twoFactorEnabled?: boolean; twoFactorSecret?: string | null } | null, code: string): boolean {
    if (!user) return false;
    if (user.twoFactorEnabled !== true) return false;
    if (!user.twoFactorSecret) return false;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    return verifyTotp(user.twoFactorSecret, code);
  }
}
