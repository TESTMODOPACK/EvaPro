import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../users/entities/user.entity';

const EVIDENCE_ACTIONS = [
  'objective.approved', 'objective.rejected',
  'evaluation.submitted',
  'checkin.completed', 'checkin.rejected',
  'competency.approved', 'competency.rejected',
  'talent.assessed', 'calibration.entry_adjusted',
  'user.role_changed', 'user.deactivated',
  'candidate.hired', 'candidate.rejected',
  'document.signed',
  'pdi.status_changed',
];

/** Acciones consideradas "fallos operativos" — ver Stage B audit (commit
 *  d67406a). Se muestran agregadas en el dashboard del tenant_admin. */
export const FAILURE_ACTIONS = [
  'cron.failed',
  'notification.failed',
  'access.denied',
  'system.error',
] as const;
export type FailureAction = (typeof FAILURE_ACTIONS)[number];

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async log(
    tenantId: string | null,
    userId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    metadata?: any,
    ipAddress?: string,
  ): Promise<void> {
    const entry = this.auditRepo.create({
      tenantId: tenantId ?? undefined,
      userId: userId ?? undefined,
      action,
      entityType: entityType ?? undefined,
      entityId: entityId ?? undefined,
      metadata: metadata ?? undefined,
      ipAddress: ipAddress ?? undefined,
    } as any);
    await this.auditRepo.save(entry);
  }

  /**
   * Helper seguro para registrar fallos de sistema en el audit log.
   * Nunca lanza (fire-and-forget). Trunca el stack para no inflar BD.
   *
   * - `cron.failed`        → fallo de un job programado
   * - `notification.failed`→ fallo al enviar notificación/email
   * - `access.denied`      → intento de acceso bloqueado por guard
   * - `system.error`       → puente genérico desde Sentry beforeSend
   */
  async logFailure(
    action: 'cron.failed' | 'notification.failed' | 'access.denied' | 'system.error',
    opts: {
      tenantId?: string | null;
      userId?: string | null;
      entityType?: string;
      entityId?: string;
      error?: unknown;
      metadata?: Record<string, any>;
      ipAddress?: string;
    } = {},
  ): Promise<void> {
    try {
      const err = opts.error as any;
      const errMsg = err?.message ? String(err.message) : err ? String(err) : undefined;
      const errStack = err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined;
      const metadata = {
        ...(opts.metadata || {}),
        ...(errMsg ? { errorMessage: errMsg.slice(0, 500) } : {}),
        ...(errStack ? { stack: errStack } : {}),
      };
      await this.log(
        opts.tenantId ?? null,
        opts.userId ?? null,
        action,
        opts.entityType,
        opts.entityId,
        Object.keys(metadata).length ? metadata : undefined,
        opts.ipAddress,
      );
    } catch {
      // Never let the audit logger itself throw.
    }
  }

  async findAll(
    page: number,
    limit: number,
    filters?: { action?: string; tenantId?: string; dateFrom?: string; dateTo?: string; entityType?: string; searchText?: string },
  ): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number; hasNext: boolean }> {
    // Cap limit to prevent OOM — MAX 200 rows per page
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(Math.max(1, limit || 50), 200);
    const qb = this.auditRepo.createQueryBuilder('log');

    if (filters?.action) {
      qb.andWhere('log.action ILIKE :action', { action: `%${filters.action}%` });
    }
    if (filters?.tenantId) {
      qb.andWhere('log.tenantId = :tenantId', { tenantId: filters.tenantId });
    }
    if (filters?.dateFrom) {
      qb.andWhere('log.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters?.dateTo) {
      qb.andWhere('log.createdAt <= :dateTo', { dateTo: `${filters.dateTo}T23:59:59` });
    }
    if (filters?.entityType) {
      qb.andWhere('log.entityType = :entityType', { entityType: filters.entityType });
    }

    qb.orderBy('log.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [rawData, total] = await qb.getManyAndCount();

    // Enrich with user info
    const userIds = [...new Set(rawData.filter(l => l.userId).map(l => l.userId))];
    const userMap = new Map<string, { firstName: string; lastName: string; email: string }>();
    if (userIds.length > 0) {
      const users = await this.userRepo.find({
        where: userIds.map(id => ({ id })),
        select: ['id', 'email', 'firstName', 'lastName'],
      });
      for (const u of users) userMap.set(u.id, u);
    }

    // Filter by searchText (user name/email) after enrichment
    let data = rawData.map(log => {
      const u = log.userId ? userMap.get(log.userId) : null;
      return {
        ...log,
        userName: u ? `${u.firstName} ${u.lastName}` : null,
        userEmail: u?.email || null,
      };
    });

    if (filters?.searchText) {
      const search = filters.searchText.toLowerCase();
      data = data.filter(d =>
        (d.userName && d.userName.toLowerCase().includes(search)) ||
        (d.userEmail && d.userEmail.toLowerCase().includes(search))
      );
    }

    const finalTotal = filters?.searchText ? data.length : total;
    const totalPages = Math.ceil(finalTotal / safeLimit);
    return { data, total: finalTotal, page: safePage, limit: safeLimit, totalPages, hasNext: safePage < totalPages };
  }

  async findByTenant(
    tenantId: string,
    filters: {
      page?: number;
      limit?: number;
      dateFrom?: string;
      dateTo?: string;
      action?: string;
      entityType?: string;
      evidenceOnly?: boolean;
      searchText?: string;
    },
  ): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number; hasNext: boolean }> {
    const page = Math.max(1, filters.page || 1);
    // Cap at 200 for API requests but allow up to 10000 for internal callers
    // (CSV export). The controller enforces the 200 cap via ParseIntPipe +
    // DefaultValuePipe; internal callers like exportTenantCsv pass the
    // explicit higher limit.
    const maxCap = (filters as any)._internalMaxLimit || 200;
    const limit = Math.min(Math.max(1, filters.limit || 25), maxCap);

    // Join excludes super_admin actors so system-level actions never leak into
    // a tenant's audit view, even if legacy rows carry a tenantId.
    const qb = this.auditRepo.createQueryBuilder('log')
      .leftJoin('users', 'u', 'u.id = log.user_id AND u.tenant_id = log.tenant_id')
      .select([
        'log.id as id',
        'log.action as action',
        'log.entity_type as "entityType"',
        'log.entity_id as "entityId"',
        'log.metadata as metadata',
        'log.ip_address as "ipAddress"',
        'log.created_at as "createdAt"',
        'log.user_id as "userId"',
        "COALESCE(u.first_name || ' ' || u.last_name, 'Sistema') as \"userName\"",
        'u.email as "userEmail"',
      ])
      .where('log.tenant_id = :tenantId', { tenantId })
      // Defensive isolation: never surface super_admin/system actions in
      // tenant-scoped views, regardless of any legacy tenant_id value.
      .andWhere(
        "(log.user_id IS NULL OR EXISTS (SELECT 1 FROM users usr WHERE usr.id = log.user_id AND usr.role <> 'super_admin'))",
      );

    if (filters.dateFrom) {
      qb.andWhere('log.created_at >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      qb.andWhere('log.created_at <= :dateTo', { dateTo: filters.dateTo + 'T23:59:59' });
    }
    if (filters.action) {
      qb.andWhere('log.action ILIKE :action', { action: '%' + filters.action + '%' });
    }
    if (filters.entityType) {
      qb.andWhere('log.entity_type = :entityType', { entityType: filters.entityType });
    }
    if (filters.evidenceOnly) {
      qb.andWhere('log.action IN (:...evidenceActions)', { evidenceActions: EVIDENCE_ACTIONS });
    }
    if (filters.searchText) {
      // Búsqueda full-text en: nombre, email, action, entity_id (uuid),
      // y dentro del JSONB metadata (cast a texto). Permite que el admin
      // encuentre logs por palabras clave que aparezcan en el detalle
      // ("OKR de ventas", "evaluación 360", etc.).
      qb.andWhere(
        `(
          u.first_name ILIKE :search
          OR u.last_name ILIKE :search
          OR u.email ILIKE :search
          OR log.action ILIKE :search
          OR CAST(log.entity_id AS text) ILIKE :search
          OR CAST(log.metadata AS text) ILIKE :search
        )`,
        { search: '%' + filters.searchText + '%' },
      );
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('log.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    // Add evidence flag
    const result = data.map((d: any) => ({
      ...d,
      isEvidence: EVIDENCE_ACTIONS.includes(d.action),
    }));

    const totalPages = Math.ceil(total / limit);
    return { data: result, total, page, limit, totalPages, hasNext: page < totalPages };
  }

  /**
   * Resumen de fallos operativos para el widget del admin dashboard.
   *
   * Devuelve el conteo por tipo de fallo en los últimos N días (default 7).
   * Mantiene la misma regla de scoping multi-tenant que findByTenant
   * (excluye logs de super_admin) y filtra solo las acciones de fallo.
   *
   * Útil para detectar rápidamente:
   *   · cron.failed         → un job programado se cayó
   *   · notification.failed → emails que no se enviaron (Resend down, etc.)
   *   · access.denied       → tenta tivas de acceso bloqueadas (auditoría seguridad)
   *   · system.error        → 5xx no manejados (Sentry también los recibe)
   */
  async getFailureSummary(
    tenantId: string,
    daysBack: number = 7,
  ): Promise<{
    daysBack: number;
    periodStart: Date;
    counts: Record<FailureAction, number>;
    total: number;
    lastFailureAt: Date | null;
  }> {
    const periodStart = new Date(Date.now() - daysBack * 86_400_000);

    const rows = await this.auditRepo
      .createQueryBuilder('log')
      .leftJoin('users', 'u', 'u.id = log.user_id AND u.tenant_id = log.tenant_id')
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(log.created_at)', 'lastAt')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere('log.action IN (:...actions)', { actions: [...FAILURE_ACTIONS] })
      .andWhere('log.created_at >= :periodStart', { periodStart })
      // Misma regla defensiva que findByTenant: nunca incluir actores
      // super_admin (sus errores son system-level, no del tenant).
      .andWhere(
        "(log.user_id IS NULL OR EXISTS (SELECT 1 FROM users usr WHERE usr.id = log.user_id AND usr.role <> 'super_admin'))",
      )
      .groupBy('log.action')
      .getRawMany();

    const counts: Record<FailureAction, number> = {
      'cron.failed': 0,
      'notification.failed': 0,
      'access.denied': 0,
      'system.error': 0,
    };
    let lastFailureAt: Date | null = null;
    for (const r of rows) {
      const action = r.action as FailureAction;
      if (action in counts) counts[action] = parseInt(r.count, 10);
      const at = r.lastAt ? new Date(r.lastAt) : null;
      if (at && (!lastFailureAt || at > lastFailureAt)) lastFailureAt = at;
    }
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    return { daysBack, periodStart, counts, total, lastFailureAt };
  }

  async exportTenantCsv(tenantId: string, filters: { dateFrom?: string; dateTo?: string; action?: string; entityType?: string; evidenceOnly?: boolean; searchText?: string } = {}): Promise<string> {
    const { data } = await this.findByTenant(tenantId, { page: 1, limit: 10000, ...filters, _internalMaxLimit: 10000 } as any);
    const header = 'Fecha,Usuario,Email,Accion,Tipo Entidad,ID Entidad,Detalle,IP,Evidencia Legal';
    const escCsv = (v: string) => v.replace(/"/g, '""');
    const rows = data.map((d: any) => {
      const date = new Date(d.createdAt).toLocaleString('es-CL');
      const meta = d.metadata ? JSON.stringify(d.metadata) : '';
      return '"' + [date, escCsv(d.userName || ''), escCsv(d.userEmail || ''), escCsv(d.action || ''), escCsv(d.entityType || ''), d.entityId || '', escCsv(meta), d.ipAddress || '', d.isEvidence ? 'Si' : 'No'].join('","') + '"';
    });
    return header + '\n' + rows.join('\n');
  }
}
