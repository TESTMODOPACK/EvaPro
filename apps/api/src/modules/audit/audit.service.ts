import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

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

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
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

  async findAll(
    page: number,
    limit: number,
    action?: string,
    tenantId?: string,
  ): Promise<{ data: AuditLog[]; total: number; page: number; limit: number }> {
    const qb = this.auditRepo.createQueryBuilder('log');

    if (action) {
      qb.andWhere('log.action ILIKE :action', { action: `%${action}%` });
    }
    if (tenantId) {
      qb.andWhere('log.tenantId = :tenantId', { tenantId });
    }

    qb.orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
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
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 25;

    const qb = this.auditRepo.createQueryBuilder('log')
      .leftJoin('users', 'u', 'u.id = log.user_id')
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
      .where('log.tenant_id = :tenantId', { tenantId });

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
      qb.andWhere("(u.first_name ILIKE :search OR u.last_name ILIKE :search OR u.email ILIKE :search)", { search: '%' + filters.searchText + '%' });
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

    return { data: result, total, page, limit };
  }

  async exportTenantCsv(tenantId: string, dateFrom?: string, dateTo?: string): Promise<string> {
    const { data } = await this.findByTenant(tenantId, { page: 1, limit: 10000, dateFrom, dateTo });
    const header = 'Fecha,Usuario,Email,Accion,Tipo Entidad,ID Entidad,Detalle,IP,Evidencia Legal';
    const rows = data.map((d: any) => {
      const date = new Date(d.createdAt).toLocaleString('es-CL');
      const meta = d.metadata ? JSON.stringify(d.metadata).replace(/"/g, "'") : '';
      return '"' + [date, d.userName, d.userEmail || '', d.action, d.entityType || '', d.entityId || '', meta, d.ipAddress || '', d.isEvidence ? 'Si' : 'No'].join('","') + '"';
    });
    return header + '\n' + rows.join('\n');
  }
}
