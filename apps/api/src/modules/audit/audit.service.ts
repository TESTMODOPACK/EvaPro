import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

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
}
