import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { slug, isActive: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Organización no encontrada');
    return tenant;
  }

  async create(dto: any): Promise<any> {
    // Check slug uniqueness
    const existing = await this.tenantRepository.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('El slug ya existe');

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      plan: dto.plan || 'starter',
      ownerType: dto.ownerType || 'company',
      maxEmployees: dto.maxEmployees || 50,
      isActive: true,
      settings: dto.settings || {},
    });
    const saved = await this.tenantRepository.save(tenant);

    // Optionally create admin user for this tenant
    let adminUser = null;
    if (dto.adminEmail && dto.adminPassword) {
      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      adminUser = this.userRepository.create({
        tenantId: saved.id,
        email: dto.adminEmail,
        passwordHash,
        firstName: dto.adminFirstName || 'Admin',
        lastName: dto.adminLastName || saved.name,
        role: 'tenant_admin',
        department: 'Administración',
        position: 'Encargado del Sistema',
        isActive: true,
      });
      adminUser = await this.userRepository.save(adminUser);
    }

    return { tenant: saved, adminUser: adminUser ? { id: adminUser.id, email: adminUser.email } : null };
  }

  async update(id: string, dto: any): Promise<Tenant> {
    const tenant = await this.findById(id);
    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.plan !== undefined) tenant.plan = dto.plan;
    if (dto.maxEmployees !== undefined) tenant.maxEmployees = dto.maxEmployees;
    if (dto.ownerType !== undefined) tenant.ownerType = dto.ownerType;
    if (dto.isActive !== undefined) tenant.isActive = dto.isActive;
    if (dto.settings !== undefined) tenant.settings = dto.settings;
    return this.tenantRepository.save(tenant);
  }

  async deactivate(id: string): Promise<void> {
    const tenant = await this.findById(id);
    tenant.isActive = false;
    await this.tenantRepository.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getSystemStats(): Promise<any> {
    const totalTenants = await this.tenantRepository.count();
    const activeTenants = await this.tenantRepository.count({ where: { isActive: true } });
    const totalUsers = await this.userRepository.count();
    const activeUsers = await this.userRepository.count({ where: { isActive: true } });

    // Users per plan
    const usersPerPlan = await this.tenantRepository
      .createQueryBuilder('t')
      .select('t.plan', 'plan')
      .addSelect('COUNT(t.id)', 'tenantCount')
      .groupBy('t.plan')
      .getRawMany();

    // Recent tenants
    const recentTenants = await this.tenantRepository.find({
      order: { createdAt: 'DESC' },
      take: 5,
    });

    // Count users per tenant for recent tenants
    const recentTenantsWithUsers = [];
    for (const t of recentTenants) {
      const userCount = await this.userRepository.count({ where: { tenantId: t.id } });
      recentTenantsWithUsers.push({ ...t, userCount });
    }

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      activeUsers,
      usersPerPlan,
      recentTenants: recentTenantsWithUsers,
    };
  }

  async getUsageMetrics(): Promise<any> {
    // Users created per month (last 6 months)
    const usersPerMonth = await this.userRepository
      .createQueryBuilder('u')
      .select("TO_CHAR(u.created_at, 'YYYY-MM')", 'month')
      .addSelect('COUNT(u.id)', 'count')
      .where("u.created_at > NOW() - INTERVAL '6 months'")
      .groupBy("TO_CHAR(u.created_at, 'YYYY-MM')")
      .orderBy("TO_CHAR(u.created_at, 'YYYY-MM')", 'ASC')
      .getRawMany();

    // Tenants with user counts
    const tenantActivity = await this.tenantRepository
      .createQueryBuilder('t')
      .leftJoin('users', 'u', 'u.tenant_id = t.id')
      .select('t.id', 'id')
      .addSelect('t.name', 'name')
      .addSelect('t.plan', 'plan')
      .addSelect('t.is_active', 'isActive')
      .addSelect('COUNT(u.id)', 'userCount')
      .groupBy('t.id, t.name, t.plan, t.is_active')
      .orderBy('COUNT(u.id)', 'DESC')
      .limit(10)
      .getRawMany();

    return { usersPerMonth, tenantActivity };
  }
}
