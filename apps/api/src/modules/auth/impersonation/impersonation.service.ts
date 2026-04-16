import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from '../../users/entities/user.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AuditService } from '../../audit/audit.service';
import { EmailService } from '../../notifications/email.service';

/**
 * Controlled impersonation — a super_admin receives a short-lived JWT that
 * identifies them AS a tenant's user (usually the primary tenant_admin) with
 * an explicit `impersonatedBy` + `impersonationReason` claim. All mutations
 * during the session are audited with these claims attached.
 *
 * Hard 1h cap enforced by both (a) the `expiresIn` used here and (b) a
 * defense-in-depth check in `jwt.strategy`. The cap is DELIBERATE and
 * applies regardless of per-tenant session timeouts.
 */
const IMPERSONATION_TTL_SECONDS = 60 * 60; // 1 hour

export interface ImpersonationResult {
  access_token: string;
  expiresAt: string;
  targetUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  tenant: { id: string; name: string };
}

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Start an impersonation session. Only callable by super_admin.
   *
   * If `targetUserId` is omitted we pick the tenant's primary tenant_admin
   * (oldest active one). We refuse to impersonate super_admin accounts
   * (meaningless — and would erase the audit distinction) or inactive users
   * (their session would fail validation immediately anyway).
   */
  async start(
    superAdminId: string,
    tenantId: string,
    reason: string,
    targetUserId?: string,
    ipAddress?: string,
  ): Promise<ImpersonationResult> {
    const superAdmin = await this.userRepo.findOne({
      where: { id: superAdminId },
      select: ['id', 'firstName', 'lastName', 'email', 'role', 'isActive'],
    });
    if (!superAdmin || !superAdmin.isActive || superAdmin.role !== 'super_admin') {
      throw new ForbiddenException('Solo super_admin puede iniciar impersonación.');
    }

    const trimmedReason = (reason || '').trim();
    if (trimmedReason.length < 5 || trimmedReason.length > 500) {
      throw new BadRequestException('La razón debe tener entre 5 y 500 caracteres.');
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado.');
    if (!tenant.isActive) {
      throw new BadRequestException('El tenant está inactivo.');
    }

    // Resolve target user. Explicit id wins; otherwise pick primary admin.
    let target: User | null = null;
    if (targetUserId) {
      target = await this.userRepo.findOne({ where: { id: targetUserId, tenantId } });
      if (!target) throw new NotFoundException('Usuario objetivo no encontrado en este tenant.');
    } else {
      target = await this.userRepo.findOne({
        where: { tenantId, role: 'tenant_admin', isActive: true },
        order: { createdAt: 'ASC' },
      });
      if (!target) {
        throw new BadRequestException(
          'No hay tenant_admin activo en este tenant. Especifica targetUserId explícitamente.',
        );
      }
    }
    if (!target.isActive) {
      throw new BadRequestException('El usuario objetivo está inactivo.');
    }
    if (target.role === 'super_admin') {
      throw new BadRequestException('No se puede impersonar super_admin.');
    }

    // Mint the JWT. IMPORTANT: use `tv` of the TARGET user so the
    // jwt.strategy token-version check validates the right identity. If
    // the target's password changes mid-session, the impersonation token
    // invalidates too — which is the right behavior.
    const payload: Record<string, unknown> = {
      sub: target.id,
      email: target.email,
      tenantId: target.tenantId,
      role: target.role,
      firstName: target.firstName || '',
      lastName: target.lastName || '',
      tv: target.tokenVersion ?? 0,
      impersonatedBy: superAdmin.id,
      impersonationReason: trimmedReason,
    };
    // Use a string expiresIn ('1h') for consistency with AuthService/SsoService;
    // both shapes are accepted by `jsonwebtoken` but mixing creates friction.
    const access_token = this.jwtService.sign(payload as any, {
      expiresIn: '1h',
    } as any);
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);

    await this.auditService
      .log(
        tenantId,
        superAdmin.id,
        'impersonation.started',
        'User',
        target.id,
        {
          superAdminId: superAdmin.id,
          superAdminEmail: superAdmin.email,
          targetUserId: target.id,
          targetEmail: target.email,
          reason: trimmedReason,
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress,
      )
      .catch(() => undefined);

    // Notify the target (same inbox as tenant_admin — so they find out even
    // if the target is themselves). Transactional.
    this.emailService
      .sendImpersonationStarted(target.email, {
        firstName: target.firstName,
        superAdminName: `${superAdmin.firstName} ${superAdmin.lastName}`.trim() || 'Soporte Eva360',
        reason: trimmedReason,
        durationMinutes: Math.floor(IMPERSONATION_TTL_SECONDS / 60),
        tenantId,
      })
      .catch((err) =>
        this.logger.warn(`Impersonation-started email failed: ${err?.message || err}`),
      );

    return {
      access_token,
      expiresAt: expiresAt.toISOString(),
      targetUser: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
      },
      tenant: { id: tenant.id, name: tenant.name },
    };
  }

  /**
   * End the impersonation session. Re-mints a JWT for the original
   * super_admin identity so the UI can switch back seamlessly. Audits the
   * event + optionally emails the target if the session was long (>5 min).
   */
  async end(
    impersonatedBy: string,
    targetUserId: string,
    tenantId: string | null,
    startedAtMs?: number,
    ipAddress?: string,
  ): Promise<{ access_token: string }> {
    const superAdmin = await this.userRepo.findOne({
      where: { id: impersonatedBy },
      select: ['id', 'firstName', 'lastName', 'email', 'role', 'isActive', 'tokenVersion'],
    });
    if (!superAdmin || !superAdmin.isActive || superAdmin.role !== 'super_admin') {
      throw new ForbiddenException('Impersonador inválido.');
    }

    const payload = {
      sub: superAdmin.id,
      email: superAdmin.email,
      tenantId: null,
      role: 'super_admin',
      firstName: superAdmin.firstName || '',
      lastName: superAdmin.lastName || '',
      tv: superAdmin.tokenVersion ?? 0,
    };
    const access_token = this.jwtService.sign(payload as any, {
      expiresIn: process.env.JWT_EXPIRATION || '30m',
    } as any);

    const durationMs = startedAtMs ? Date.now() - startedAtMs : null;
    await this.auditService
      .log(
        tenantId,
        superAdmin.id,
        'impersonation.ended',
        'User',
        targetUserId,
        {
          superAdminId: superAdmin.id,
          targetUserId,
          durationSeconds: durationMs ? Math.floor(durationMs / 1000) : null,
        },
        ipAddress,
      )
      .catch(() => undefined);

    // Long sessions (>5 min) get a follow-up email to the target. Short
    // ones (quick diagnostic) are noisy if we notify every time.
    if (durationMs && durationMs > 5 * 60 * 1000) {
      const target = await this.userRepo.findOne({ where: { id: targetUserId } });
      if (target?.email) {
        this.emailService
          .sendImpersonationEnded(target.email, {
            firstName: target.firstName,
            superAdminName: `${superAdmin.firstName} ${superAdmin.lastName}`.trim() || 'Soporte Eva360',
            durationMinutes: Math.ceil(durationMs / 60000),
            tenantId: tenantId ?? undefined,
          })
          .catch(() => undefined);
      }
    }

    return { access_token };
  }
}
