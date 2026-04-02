import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
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
    let expiresIn = this.configService.get('JWT_EXPIRATION', '15m');
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

    // Send branded email via EmailService (Resend)
    await this.emailService.sendPasswordReset(user.email, {
      firstName: user.firstName,
      code,
      expiryMinutes: 15,
      tenantId: user.tenantId || undefined,
    });
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
    await this.userRepo.save(user);
  }

}
