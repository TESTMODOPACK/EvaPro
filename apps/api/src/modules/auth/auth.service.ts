import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { generateTotpSecret, generateTotpUri, verifyTotp } from '../../common/utils/totp';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';

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
  ) {}

  async validateUser(email: string, pass: string, tenantId?: string): Promise<any> {
    const user = await this.usersService.findByEmail(email, tenantId);
    if (!user || !user.passwordHash || !(await bcrypt.compare(pass, user.passwordHash))) {
      return null;
    }

    // Check user is active
    if (!user.isActive) return null;

    // Check tenant is active (super_admin may not have a tenant relation loaded)
    if (user.role !== 'super_admin' && user.tenant && !user.tenant.isActive) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any, ipAddress?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    };

    // Log successful login
    await this.auditService.log(
      user.tenantId || null,
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
    const user = await this.usersService.findById(userId);
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
        user?.tenantId || null,
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

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.resetCode = null;
    user.resetCodeExpires = null;
    await this.userRepo.save(user);

    await this.auditService.log(user.tenantId, user.id, 'password.changed_first_login', 'User', user.id).catch(() => {});
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

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetCode = null;
    user.resetCodeExpires = null;
    user.mustChangePassword = false;
    await this.userRepo.save(user);
  }

  // ─── 2FA / MFA ─────────────────────────────────────────────────────

  /** Step 1: Generate secret and return URI for QR code */
  async setup2FA(userId: string): Promise<{ secret: string; uri: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA ya está activado');

    const secret = generateTotpSecret();
    user.twoFactorSecret = secret;
    await this.userRepo.save(user);

    const uri = generateTotpUri(secret, user.email);
    return { secret, uri };
  }

  /** Step 2: Verify code and enable 2FA */
  async enable2FA(userId: string, code: string): Promise<{ enabled: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new BadRequestException('Primero debes configurar 2FA');
    if (user.twoFactorEnabled) throw new BadRequestException('2FA ya está activado');

    if (!verifyTotp(user.twoFactorSecret, code)) {
      throw new BadRequestException('Código inválido. Verifica que tu app autenticadora esté sincronizada.');
    }

    user.twoFactorEnabled = true;
    await this.userRepo.save(user);
    await this.auditService.log(user.tenantId, userId, '2fa.enabled', 'User', userId).catch(() => {});
    return { enabled: true };
  }

  /** Disable 2FA */
  async disable2FA(userId: string, password: string): Promise<{ disabled: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (!user.twoFactorEnabled) throw new BadRequestException('2FA no está activado');

    // Require password to disable (security)
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BadRequestException('Contraseña incorrecta');
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await this.userRepo.save(user);
    await this.auditService.log(user.tenantId, userId, '2fa.disabled', 'User', userId).catch(() => {});
    return { disabled: true };
  }

  /** Verify 2FA code during login */
  verify2FACode(user: any, code: string): boolean {
    if (!user.twoFactorSecret) return false;
    return verifyTotp(user.twoFactorSecret, code);
  }
}
