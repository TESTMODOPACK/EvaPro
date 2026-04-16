import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { GdprRequest, GdprRequestType } from './entities/gdpr-request.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { GdprExportBuilder } from './export-builder.service';
import { GdprAnonymizerService } from './anonymizer.service';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';

const EXPORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DELETE_CODE_TTL_MINUTES = 30;
const USER_EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 per 24h
const TENANT_EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DELETE_REQUEST_COOLDOWN_MS = 60 * 60 * 1000; // 1h
const DELETE_REQUEST_MAX_PER_HOUR = 3;

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    @InjectRepository(GdprRequest) private readonly requestRepo: Repository<GdprRequest>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly exportBuilder: GdprExportBuilder,
    private readonly anonymizer: GdprAnonymizerService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Export user (self) ────────────────────────────────────────────────

  async exportMyData(userId: string, tenantId: string | null, ipAddress?: string): Promise<{
    requestId: string;
    status: string;
    estimatedMinutes: number;
  }> {
    // Rate limit: 1 completed/pending request per 24h.
    await this.assertNoRecentRequest(userId, 'export_user', USER_EXPORT_COOLDOWN_MS);

    const req = await this.requestRepo.save(
      this.requestRepo.create({
        userId,
        tenantId,
        type: 'export_user',
        status: 'processing',
      }),
    );

    this.auditService
      .log(tenantId, userId, 'gdpr.export_user_requested', 'GdprRequest', req.id, {}, ipAddress)
      .catch(() => undefined);

    // For v1 we run synchronously inside the request. Normal user exports
    // are <2MB and complete in <10s. BullMQ migration is tracked in P0-1.
    try {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new Error(`User ${userId} not found`);

      const { buffer, sizeBytes, truncated } = await this.exportBuilder.buildUserExport(userId);
      const { url } = await this.exportBuilder.uploadZip(buffer, 'user', userId);

      req.fileUrl = url;
      req.fileExpiresAt = new Date(Date.now() + EXPORT_LINK_TTL_MS);
      req.status = 'completed';
      req.completedAt = new Date();
      req.metadata = { sizeBytes, truncated };
      await this.requestRepo.save(req);

      const tenant = tenantId ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
      await this.emailService
        .sendGdprExportReady(user.email, {
          firstName: user.firstName,
          downloadUrl: url,
          expiresAt: req.fileExpiresAt.toLocaleDateString('es-CL'),
          scope: 'user',
          orgName: tenant?.name,
          tenantId: tenantId ?? undefined,
        })
        .catch((err) =>
          this.logger.warn(`GDPR export-ready email failed: ${err?.message || err}`),
        );

      this.auditService
        .log(tenantId, userId, 'gdpr.export_user_completed', 'GdprRequest', req.id, {
          sizeBytes,
          truncated,
        }, ipAddress)
        .catch(() => undefined);

      return { requestId: req.id, status: req.status, estimatedMinutes: 0 };
    } catch (err: any) {
      req.status = 'failed';
      req.errorMessage = String(err?.message || err).slice(0, 500);
      await this.requestRepo.save(req);
      this.auditService
        .log(tenantId, userId, 'gdpr.export_user_failed', 'GdprRequest', req.id, {
          error: req.errorMessage,
        }, ipAddress)
        .catch(() => undefined);
      throw new BadRequestException('No pudimos generar tu export. El equipo de soporte ha sido notificado.');
    }
  }

  // ─── Export tenant (tenant_admin) ──────────────────────────────────────

  async exportTenantData(
    adminUserId: string,
    tenantId: string,
    anonymize: boolean,
    ipAddress?: string,
  ): Promise<{ requestId: string; status: string; estimatedMinutes: number }> {
    const admin = await this.userRepo.findOne({ where: { id: adminUserId, tenantId } });
    if (!admin) throw new NotFoundException('Administrador no encontrado en este tenant.');

    // One tenant-level export per 24h to cap load and dedupe accidental clicks.
    const recentTenant = await this.requestRepo.findOne({
      where: {
        tenantId,
        type: 'export_tenant',
        requestedAt: MoreThan(new Date(Date.now() - TENANT_EXPORT_COOLDOWN_MS)),
      },
      order: { requestedAt: 'DESC' },
    });
    if (recentTenant && recentTenant.status !== 'failed') {
      throw new BadRequestException(
        'Ya se generó un export del tenant en las últimas 24h. Inténtalo más tarde.',
      );
    }

    const req = await this.requestRepo.save(
      this.requestRepo.create({
        userId: adminUserId,
        tenantId,
        type: 'export_tenant',
        status: 'processing',
        metadata: { anonymize },
      }),
    );

    this.auditService
      .log(tenantId, adminUserId, 'gdpr.export_tenant_requested', 'GdprRequest', req.id, { anonymize }, ipAddress)
      .catch(() => undefined);

    try {
      const { buffer, sizeBytes, truncated } = await this.exportBuilder.buildTenantExport(tenantId, {
        anonymize,
      });
      const { url } = await this.exportBuilder.uploadZip(buffer, 'tenant', tenantId);

      req.fileUrl = url;
      req.fileExpiresAt = new Date(Date.now() + EXPORT_LINK_TTL_MS);
      req.status = 'completed';
      req.completedAt = new Date();
      req.metadata = { ...(req.metadata ?? {}), sizeBytes, truncated };
      await this.requestRepo.save(req);

      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      await this.emailService
        .sendGdprExportReady(admin.email, {
          firstName: admin.firstName,
          downloadUrl: url,
          expiresAt: req.fileExpiresAt.toLocaleDateString('es-CL'),
          scope: 'tenant',
          orgName: tenant?.name,
          tenantId,
        })
        .catch((err) =>
          this.logger.warn(`GDPR tenant export-ready email failed: ${err?.message || err}`),
        );

      this.auditService
        .log(tenantId, adminUserId, 'gdpr.export_tenant_completed', 'GdprRequest', req.id, {
          sizeBytes,
          truncated,
          anonymize,
        }, ipAddress)
        .catch(() => undefined);

      return { requestId: req.id, status: req.status, estimatedMinutes: 0 };
    } catch (err: any) {
      req.status = 'failed';
      req.errorMessage = String(err?.message || err).slice(0, 500);
      await this.requestRepo.save(req);
      this.auditService
        .log(tenantId, adminUserId, 'gdpr.export_tenant_failed', 'GdprRequest', req.id, {
          error: req.errorMessage,
        }, ipAddress)
        .catch(() => undefined);
      throw new BadRequestException('No pudimos generar el export del tenant. Intenta más tarde.');
    }
  }

  // ─── Delete account (self) — 2-step flow ──────────────────────────────

  async requestAccountDeletion(userId: string, tenantId: string | null, ipAddress?: string): Promise<{
    requestId: string;
    expiresInMinutes: number;
  }> {
    // Rate limit: max N requests/hour.
    const recent = await this.requestRepo.count({
      where: {
        userId,
        type: 'delete_user',
        requestedAt: MoreThan(new Date(Date.now() - DELETE_REQUEST_COOLDOWN_MS)),
      },
    });
    if (recent >= DELETE_REQUEST_MAX_PER_HOUR) {
      throw new BadRequestException(
        'Has solicitado eliminación demasiadas veces. Inténtalo en una hora.',
      );
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    if (!user.isActive) {
      throw new BadRequestException('La cuenta ya está inactiva.');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + DELETE_CODE_TTL_MINUTES * 60 * 1000);

    const req = await this.requestRepo.save(
      this.requestRepo.create({
        userId,
        tenantId,
        type: 'delete_user',
        status: 'confirmed_pending',
        confirmationCode: code,
        confirmationCodeExpires: expires,
      }),
    );

    this.auditService
      .log(tenantId, userId, 'gdpr.delete_user_requested', 'GdprRequest', req.id, {}, ipAddress)
      .catch(() => undefined);

    await this.emailService
      .sendGdprDeleteConfirmationCode(user.email, {
        firstName: user.firstName,
        code,
        expiryMinutes: DELETE_CODE_TTL_MINUTES,
        tenantId: tenantId ?? undefined,
      })
      .catch((err) =>
        this.logger.warn(`GDPR delete-code email failed: ${err?.message || err}`),
      );

    return { requestId: req.id, expiresInMinutes: DELETE_CODE_TTL_MINUTES };
  }

  async confirmAccountDeletion(
    userId: string,
    tenantId: string | null,
    requestId: string,
    code: string,
    ipAddress?: string,
  ): Promise<{ success: true }> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada.');
    // Strict ownership check — you can only confirm your own request.
    if (req.userId !== userId || req.type !== 'delete_user') {
      throw new ForbiddenException('No puedes confirmar esta solicitud.');
    }
    if (req.status !== 'confirmed_pending') {
      throw new BadRequestException('Esta solicitud ya fue procesada o canceló.');
    }
    if (!req.confirmationCode || !req.confirmationCodeExpires) {
      throw new BadRequestException('Solicitud inválida.');
    }
    if (req.confirmationCodeExpires < new Date()) {
      throw new BadRequestException('El código ha expirado. Solicita uno nuevo.');
    }
    if (req.confirmationCode !== code) {
      // Audit the failed attempt explicitly — do not increment a counter
      // inline here (rate limit already enforced on the request step).
      this.auditService
        .log(tenantId, userId, 'gdpr.delete_user_invalid_code', 'GdprRequest', req.id, {}, ipAddress)
        .catch(() => undefined);
      throw new BadRequestException('El código no es válido.');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    // IMPORTANT: send the "confirmed" email BEFORE the anonymization commits
    // so we still have the real email + firstName available. Resend delivery
    // happens async so the user sees it shortly after they get logged out.
    const tenant = tenantId ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
    const userEmailBefore = user.email;
    const userFirstNameBefore = user.firstName;

    req.status = 'processing';
    await this.requestRepo.save(req);

    try {
      const { anonymizedEmail, affectedTables } = await this.anonymizer.anonymizeUser(userId);

      req.status = 'completed';
      req.completedAt = new Date();
      req.confirmationCode = null;
      req.confirmationCodeExpires = null;
      req.metadata = { ...(req.metadata ?? {}), anonymizedEmail, affectedTables };
      await this.requestRepo.save(req);

      // Post-commit notifications — we use the captured pre-anonymization
      // email/name because the user row has already been wiped.
      this.emailService
        .sendGdprDeleteConfirmed(userEmailBefore, {
          firstName: userFirstNameBefore,
          orgName: tenant?.name,
          tenantId: tenantId ?? undefined,
        })
        .catch((err) =>
          this.logger.warn(`GDPR delete-confirmed email failed: ${err?.message || err}`),
        );

      this.auditService
        .log(tenantId, userId, 'gdpr.delete_user_completed', 'GdprRequest', req.id, {
          affectedTables,
        }, ipAddress)
        .catch(() => undefined);

      return { success: true };
    } catch (err: any) {
      req.status = 'failed';
      req.errorMessage = String(err?.message || err).slice(0, 500);
      await this.requestRepo.save(req);
      this.auditService
        .log(tenantId, userId, 'gdpr.delete_user_failed', 'GdprRequest', req.id, {
          error: req.errorMessage,
        }, ipAddress)
        .catch(() => undefined);
      throw new BadRequestException(
        'No pudimos completar la eliminación. El equipo de soporte ha sido notificado.',
      );
    }
  }

  // ─── My requests list ──────────────────────────────────────────────────

  async listMyRequests(userId: string): Promise<GdprRequest[]> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.requestRepo.find({
      where: { userId, requestedAt: MoreThan(since) },
      order: { requestedAt: 'DESC' },
      // IMPORTANT: never expose confirmationCode to the UI.
      select: [
        'id',
        'type',
        'status',
        'fileUrl',
        'fileExpiresAt',
        'errorMessage',
        'metadata',
        'requestedAt',
        'completedAt',
      ],
    });
    // Redact expired download URLs — the link might technically still work on
    // Cloudinary but our contract says it expires.
    const now = new Date();
    return rows.map((r) => ({
      ...r,
      fileUrl: r.fileExpiresAt && r.fileExpiresAt < now ? null : r.fileUrl,
    })) as GdprRequest[];
  }

  async listTenantRequests(tenantId: string): Promise<GdprRequest[]> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await this.requestRepo.find({
      where: { tenantId, requestedAt: MoreThan(since) },
      order: { requestedAt: 'DESC' },
      select: [
        'id',
        'userId',
        'type',
        'status',
        'fileExpiresAt',
        'errorMessage',
        'metadata',
        'requestedAt',
        'completedAt',
      ],
    });
    return rows;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async assertNoRecentRequest(
    userId: string,
    type: GdprRequestType,
    windowMs: number,
  ): Promise<void> {
    const recent = await this.requestRepo.findOne({
      where: {
        userId,
        type,
        requestedAt: MoreThan(new Date(Date.now() - windowMs)),
      },
      order: { requestedAt: 'DESC' },
    });
    // Only block if the previous request isn't failed — a failed one
    // shouldn't lock the user out from retrying.
    if (recent && recent.status !== 'failed') {
      const hoursLeft = Math.ceil(
        (recent.requestedAt.getTime() + windowMs - Date.now()) / (60 * 60 * 1000),
      );
      throw new BadRequestException(
        `Ya solicitaste este tipo de export recientemente. Inténtalo en ${hoursLeft} hora${hoursLeft > 1 ? 's' : ''}.`,
      );
    }
  }
}
