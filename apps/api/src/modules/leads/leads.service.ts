import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStatus } from './entities/lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';

/**
 * Servicio del módulo de leads. Responsabilidades:
 *   - Verificar el CAPTCHA Turnstile server-side contra Cloudflare.
 *   - Crear el registro en la tabla `leads` con metadata del request.
 *   - Disparar 2 emails (fire-and-forget): auto-responder al lead
 *     y notificación interna a contacto@ascenda.cl.
 *   - CRUD admin para el super_admin (list/detail/update).
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);
  private readonly TURNSTILE_VERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Public flow ──────────────────────────────────────────────────────

  /**
   * Verifica el token de Turnstile contra Cloudflare. Si el secret no está
   * configurado (dev), retorna 'bypassed_dev' para no romper el flujo local;
   * en producción es responsabilidad de ops setear TURNSTILE_SECRET_KEY.
   */
  async verifyCaptcha(token: string, ip?: string): Promise<'verified' | 'bypassed_dev' | 'failed'> {
    const secret = this.configService.get<string>('TURNSTILE_SECRET_KEY');
    if (!secret) {
      this.logger.warn(
        'TURNSTILE_SECRET_KEY no configurado — el CAPTCHA se acepta sin verificar. Configurar en producción.',
      );
      return 'bypassed_dev';
    }
    try {
      const body = new URLSearchParams();
      body.append('secret', secret);
      body.append('response', token);
      if (ip) body.append('remoteip', ip);
      const res = await fetch(this.TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Turnstile verify HTTP ${res.status}`);
        return 'failed';
      }
      const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
      if (!data.success) {
        this.logger.warn(`Turnstile verify rejected: ${(data['error-codes'] || []).join(',')}`);
        return 'failed';
      }
      return 'verified';
    } catch (err: any) {
      // Network error contra Cloudflare — por seguridad, no silenciamos: rechazamos.
      this.logger.error(`Turnstile verify error: ${err?.message || err}`);
      return 'failed';
    }
  }

  /**
   * Punto de entrada del endpoint público. Verifica el CAPTCHA, persiste
   * el lead y dispara emails asíncronamente (no bloquean la respuesta).
   */
  async createFromPublic(
    dto: CreateLeadDto,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ id: string; queuedAt: Date }> {
    const verdict = await this.verifyCaptcha(dto.captchaToken, ip || undefined);
    if (verdict === 'failed') {
      throw new BadRequestException(
        'No pudimos validar tu CAPTCHA. Recarga la página e intenta de nuevo, o escríbenos directo a contacto@ascenda.cl.',
      );
    }

    const lead = this.leadRepo.create({
      name: dto.name,
      company: dto.company,
      role: dto.role || null,
      email: dto.email,
      phone: dto.phone,
      companySize: dto.companySize || null,
      industry: dto.industry || null,
      region: dto.region || null,
      source: dto.source || null,
      message: dto.message,
      origin: (dto.origin as any) || 'ascenda.cl',
      ipAddress: ip,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
      captchaVerdict: verdict,
      status: 'new',
    });
    const saved = await this.leadRepo.save(lead);

    // Fire-and-forget: ambos emails.
    // 1) Auto-responder al lead — "gracias, te contactamos en 24h"
    this.emailService
      .sendLeadAutoresponder(saved.email, {
        firstName: saved.name.split(' ')[0],
        company: saved.company,
      })
      .catch((err) =>
        this.logger.error(`Autoresponder email failed for lead ${saved.id}: ${err?.message || err}`),
      );

    // 2) Notificación interna a contacto@ascenda.cl con los detalles
    this.emailService
      .sendLeadReceivedInternal({
        leadId: saved.id,
        name: saved.name,
        company: saved.company,
        role: saved.role,
        email: saved.email,
        phone: saved.phone,
        companySize: saved.companySize,
        industry: saved.industry,
        region: saved.region,
        source: saved.source,
        message: saved.message,
        origin: saved.origin,
        ipAddress: saved.ipAddress,
        captchaVerdict: saved.captchaVerdict,
      })
      .catch((err) =>
        this.logger.error(`Internal notification email failed for lead ${saved.id}: ${err?.message || err}`),
      );

    return { id: saved.id, queuedAt: saved.createdAt };
  }

  // ─── Admin flow ───────────────────────────────────────────────────────

  async findAll(filters: { status?: LeadStatus; origin?: string } = {}): Promise<Lead[]> {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.origin) where.origin = filters.origin;
    return this.leadRepo.find({
      where,
      relations: ['assignee'],
      order: { createdAt: 'DESC' },
      take: 500, // safety cap
    });
  }

  async findById(id: string): Promise<Lead> {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['assignee'],
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  /**
   * Update del pipeline por super_admin. No existe "tenant" para leads
   * pre-venta — el audit log se escribe con tenantId del super_admin
   * (suficiente para trazabilidad de quien tocó qué).
   */
  async update(id: string, dto: UpdateLeadDto, operatorUserId: string, operatorTenantId: string): Promise<Lead> {
    const lead = await this.findById(id);

    const prevStatus = lead.status;
    const changes: Record<string, { before: any; after: any }> = {};

    if (dto.status !== undefined && dto.status !== lead.status) {
      changes.status = { before: lead.status, after: dto.status };
      lead.status = dto.status;
      lead.statusChangedAt = new Date();
    }
    if (dto.internalNotes !== undefined && dto.internalNotes !== lead.internalNotes) {
      changes.internalNotes = { before: '[redacted]', after: '[updated]' };
      lead.internalNotes = dto.internalNotes;
    }
    if (dto.assignedTo !== undefined && dto.assignedTo !== lead.assignedTo) {
      changes.assignedTo = { before: lead.assignedTo, after: dto.assignedTo };
      lead.assignedTo = dto.assignedTo;
    }
    if (dto.convertedTenantId !== undefined && dto.convertedTenantId !== lead.convertedTenantId) {
      changes.convertedTenantId = { before: lead.convertedTenantId, after: dto.convertedTenantId };
      lead.convertedTenantId = dto.convertedTenantId;
    }

    const saved = await this.leadRepo.save(lead);

    if (Object.keys(changes).length > 0) {
      this.auditService
        .log(operatorTenantId, operatorUserId, 'lead.updated', 'lead', saved.id, {
          prevStatus,
          newStatus: saved.status,
          changes,
          leadEmail: saved.email,
        })
        .catch(() => {});
    }

    return saved;
  }

  async remove(id: string, operatorUserId: string, operatorTenantId: string): Promise<void> {
    const lead = await this.findById(id);
    await this.leadRepo.remove(lead);
    this.auditService
      .log(operatorTenantId, operatorUserId, 'lead.deleted', 'lead', id, {
        leadEmail: lead.email,
        leadCompany: lead.company,
      })
      .catch(() => {});
  }

  /** Contadores agrupados por status para el panel admin. */
  async getStats(): Promise<Record<LeadStatus, number> & { total: number }> {
    const rows = await this.leadRepo
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.status')
      .getRawMany<{ status: LeadStatus; count: string }>();

    const result: any = { new: 0, contacted: 0, qualified: 0, converted: 0, discarded: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.count);
      result[row.status] = n;
      result.total += n;
    }
    return result;
  }
}
