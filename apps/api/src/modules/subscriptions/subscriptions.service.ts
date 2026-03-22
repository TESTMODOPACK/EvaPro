import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
  ) {}

  async create(dto: any): Promise<Subscription> {
    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planName: dto.planName || 'starter',
      status: dto.status || 'active',
      maxEmployees: dto.maxEmployees || 50,
      startDate: dto.startDate || new Date(),
      endDate: dto.endDate || null,
      trialEndsAt: dto.trialEndsAt || null,
      monthlyPrice: dto.monthlyPrice || null,
      notes: dto.notes || null,
    });
    return this.subRepo.save(sub);
  }

  async findAll(): Promise<Subscription[]> {
    return this.subRepo.find({
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({ where: { id }, relations: ['tenant'] });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  async findByTenantId(tenantId: string): Promise<Subscription | null> {
    return this.subRepo.findOne({ where: { tenantId }, relations: ['tenant'] });
  }

  async update(id: string, dto: any): Promise<Subscription> {
    const sub = await this.findById(id);
    if (dto.planName !== undefined) sub.planName = dto.planName;
    if (dto.status !== undefined) sub.status = dto.status;
    if (dto.maxEmployees !== undefined) sub.maxEmployees = dto.maxEmployees;
    if (dto.startDate !== undefined) sub.startDate = dto.startDate;
    if (dto.endDate !== undefined) sub.endDate = dto.endDate;
    if (dto.trialEndsAt !== undefined) sub.trialEndsAt = dto.trialEndsAt;
    if (dto.monthlyPrice !== undefined) sub.monthlyPrice = dto.monthlyPrice;
    if (dto.notes !== undefined) sub.notes = dto.notes;
    return this.subRepo.save(sub);
  }

  async cancel(id: string): Promise<void> {
    const sub = await this.findById(id);
    sub.status = 'cancelled';
    await this.subRepo.save(sub);
  }

  async getStats(): Promise<any> {
    const total = await this.subRepo.count();
    const active = await this.subRepo.count({ where: { status: 'active' } });
    const trial = await this.subRepo.count({ where: { status: 'trial' } });
    const suspended = await this.subRepo.count({ where: { status: 'suspended' } });
    const cancelled = await this.subRepo.count({ where: { status: 'cancelled' } });

    const byPlan = await this.subRepo
      .createQueryBuilder('s')
      .select('s.plan_name', 'plan')
      .addSelect('COUNT(s.id)', 'count')
      .groupBy('s.plan_name')
      .getRawMany();

    return { total, active, trial, suspended, cancelled, byPlan };
  }
}
