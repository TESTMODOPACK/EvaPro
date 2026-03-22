import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
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

    return {
      access_token: this.jwtService.sign(payload),
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

    // Send email
    await this.sendResetEmail(user.email, code, user.firstName);
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

  private async sendResetEmail(to: string, code: string, firstName: string): Promise<void> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'noreply@evapro.app';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn('[EvaPro] SMTP not configured — reset code:', code, 'for', to);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"EvaPro" <${smtpFrom}>`,
      to,
      subject: 'Código de recuperación — EvaPro',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
          <h2 style="color: #6366f1; margin-bottom: 0.5rem;">EvaPro</h2>
          <p>Hola ${firstName || ''},</p>
          <p>Tu código de recuperación de contraseña es:</p>
          <div style="background: #f1f5f9; border-radius: 8px; padding: 1.5rem; text-align: center; margin: 1.5rem 0;">
            <span style="font-size: 2rem; font-weight: 800; letter-spacing: 0.3em; color: #1e293b;">${code}</span>
          </div>
          <p style="color: #64748b; font-size: 0.85rem;">Este código expira en <strong>15 minutos</strong>. Si no solicitaste este cambio, ignora este correo.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0;" />
          <p style="color: #94a3b8; font-size: 0.75rem;">© ${new Date().getFullYear()} EvaPro · Evaluación de Desempeño</p>
        </div>
      `,
    });
  }
}
