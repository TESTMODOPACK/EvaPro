import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // ─── Plans CRUD ────────────────────────────────────────────────────────

  async createPlan(dto: any): Promise<SubscriptionPlan> {
    const existing = await this.planRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Ya existe un plan con ese código');

    const plan = this.planRepo.create({
      name: dto.name,
      code: dto.code,
      description: dto.description || null,
      maxEmployees: dto.maxEmployees ?? 50,
      monthlyPrice: dto.monthlyPrice ?? 0,
      yearlyPrice: dto.yearlyPrice ?? null,
      features: dto.features || [],
      isActive: true,
      displayOrder: dto.displayOrder ?? 0,
    });
    return this.planRepo.save(plan);
  }

  async findAllPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ order: { displayOrder: 'ASC', name: 'ASC' } });
  }

  async findPlanById(id: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async updatePlan(id: string, dto: any): Promise<SubscriptionPlan> {
    const plan = await this.findPlanById(id);
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.maxEmployees !== undefined) plan.maxEmployees = dto.maxEmployees;
    if (dto.monthlyPrice !== undefined) plan.monthlyPrice = dto.monthlyPrice;
    if (dto.yearlyPrice !== undefined) plan.yearlyPrice = dto.yearlyPrice;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) plan.displayOrder = dto.displayOrder;
    return this.planRepo.save(plan);
  }

  async deactivatePlan(id: string): Promise<void> {
    const plan = await this.findPlanById(id);
    plan.isActive = false;
    await this.planRepo.save(plan);
  }

  // ─── Subscriptions CRUD ────────────────────────────────────────────────

  async create(dto: any): Promise<Subscription> {
    // Validate plan exists
    const plan = await this.findPlanById(dto.planId);

    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planId: dto.planId,
      status: dto.status || 'active',
      startDate: dto.startDate || new Date(),
      endDate: dto.endDate || null,
      trialEndsAt: dto.trialEndsAt || null,
      notes: dto.notes || null,
    });
    const saved = await this.subRepo.save(sub);

    // Sync tenant plan & maxEmployees
    await this.syncTenantPlan(dto.tenantId, plan);

    return this.findById(saved.id);
  }

  async findAll(): Promise<Subscription[]> {
    return this.subRepo.find({
      relations: ['tenant', 'plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['tenant', 'plan'],
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  async findByTenantId(tenantId: string): Promise<Subscription | null> {
    return this.subRepo.findOne({
      where: { tenantId, status: 'active' },
      relations: ['plan', 'tenant'],
    });
  }

  async findMySubscription(tenantId: string): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { tenantId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
    return sub;
  }

  async update(id: string, dto: any): Promise<Subscription> {
    const sub = await this.findById(id);

    if (dto.planId !== undefined) {
      sub.planId = dto.planId;
      const plan = await this.findPlanById(dto.planId);
      await this.syncTenantPlan(sub.tenantId, plan);
    }
    if (dto.status !== undefined) sub.status = dto.status;
    if (dto.startDate !== undefined) sub.startDate = dto.startDate;
    if (dto.endDate !== undefined) sub.endDate = dto.endDate;
    if (dto.trialEndsAt !== undefined) sub.trialEndsAt = dto.trialEndsAt;
    if (dto.notes !== undefined) sub.notes = dto.notes;

    await this.subRepo.save(sub);
    return this.findById(id);
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
      .leftJoin('s.plan', 'p')
      .select('p.name', 'plan')
      .addSelect('COUNT(s.id)', 'count')
      .groupBy('p.name')
      .getRawMany();

    return { total, active, trial, suspended, cancelled, byPlan };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async syncTenantPlan(tenantId: string, plan: SubscriptionPlan): Promise<void> {
    await this.tenantRepo.update(tenantId, {
      plan: plan.code,
      maxEmployees: plan.maxEmployees,
    });
  }
}
