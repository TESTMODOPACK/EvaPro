import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { normalizeRut, validateRut } from '../../common/utils/rut-validator';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

const CUSTOM_SETTINGS_DEFAULTS: Record<string, string[]> = {
  calibrationCausals: [
    'Ajuste por desempeño real observado',
    'Consideración de circunstancias excepcionales',
    'Alineación con el equipo',
    'Contexto adicional del período evaluado',
    'Inconsistencia en la autoevaluación',
    'Reconocimiento de logros no capturados',
    'Criterio del comité calibrador',
  ],
  evaluationScaleLabels: [
    '1 - Insuficiente',
    '2 - Necesita mejora',
    '3 - Cumple expectativas',
    '4 - Supera expectativas',
    '5 - Excepcional',
  ],
  objectiveTypes: [
    'Estratégico',
    'Operativo',
    'Desarrollo profesional',
    'Individual',
  ],
  potentialLevels: [
    'Alto potencial',
    'Potencial medio',
    'En desarrollo',
  ],
  evaluationPeriods: [
    'Anual',
    'Semestral',
    'Trimestral',
  ],
  departments: [
    'Tecnología',
    'Recursos Humanos',
    'Ventas',
    'Marketing',
    'Operaciones',
    'Finanzas',
    'Legal',
    'Administración',
  ],
  jobRequirements: [
    'Educación media completa',
    'Título técnico de nivel superior',
    'Título profesional universitario',
    'Postgrado / Magíster',
    'Certificaciones profesionales vigentes',
    'Sin experiencia requerida',
    '1-2 años de experiencia en cargo similar',
    '3-5 años de experiencia en cargo similar',
    '5-10 años de experiencia en el área',
    'Más de 10 años de experiencia',
    'Experiencia en liderazgo de equipos',
    'Experiencia en gestión de proyectos',
    'Dominio de herramientas Office / Google Workspace',
    'Manejo de software especializado del área',
    'Conocimiento de normativa legal del sector',
    'Manejo de ERP / sistemas de gestión',
    'Habilidades de análisis de datos',
    'Manejo de idioma inglés (nivel intermedio o superior)',
    'Trabajo en equipo',
    'Comunicación efectiva',
    'Orientación a resultados',
    'Capacidad de resolución de problemas',
    'Liderazgo y toma de decisiones',
    'Adaptabilidad al cambio',
    'Proactividad e iniciativa',
    'Disponibilidad para trabajar presencial',
    'Disponibilidad para trabajo remoto/híbrido',
    'Disponibilidad para viajar',
    'Disponibilidad inmediata',
    'Licencia de conducir vigente',
    'Currículum vitae actualizado',
    'Certificado de antecedentes',
    'Referencias laborales (mínimo 2)',
    'Pretensiones de renta',
  ],
};

const VALID_CUSTOM_KEYS = Object.keys(CUSTOM_SETTINGS_DEFAULTS);

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    private readonly notificationsService: NotificationsService,
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

  async findByRut(rut: string): Promise<Tenant | null> {
    const normalized = normalizeRut(rut);
    return this.tenantRepository.findOne({ where: { rut: normalized } });
  }

  async create(dto: any): Promise<any> {
    // Check slug uniqueness
    const existing = await this.tenantRepository.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('El slug ya existe');

    // Validate and normalize RUT if provided
    let rut: string | null = null;
    if (dto.rut) {
      const normalized = normalizeRut(dto.rut);
      if (!validateRut(normalized)) {
        throw new BadRequestException('RUT inválido. Verifique el formato y dígito verificador.');
      }
      const existingRut = await this.tenantRepository.findOne({ where: { rut: normalized } });
      if (existingRut) throw new ConflictException('Ya existe una organización con ese RUT');
      rut = normalized;
    }

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      rut,
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
    if (dto.rut !== undefined) {
      if (dto.rut) {
        const normalized = normalizeRut(dto.rut);
        if (!validateRut(normalized)) {
          throw new BadRequestException('RUT inválido');
        }
        const existingRut = await this.tenantRepository.findOne({ where: { rut: normalized } });
        if (existingRut && existingRut.id !== id) throw new ConflictException('RUT ya registrado');
        tenant.rut = normalized;
      } else {
        tenant.rut = null;
      }
    }
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

  async getCustomSetting(tenantId: string, key: string): Promise<string[]> {
    if (!VALID_CUSTOM_KEYS.includes(key)) {
      throw new BadRequestException(`Clave no válida: ${key}`);
    }
    const tenant = await this.findById(tenantId);
    return tenant.settings?.[key] ?? CUSTOM_SETTINGS_DEFAULTS[key];
  }

  /**
   * Check if a custom setting value is in use before allowing deletion.
   * Returns usage count and entity references.
   */
  async checkSettingUsage(tenantId: string, key: string, value: string): Promise<{ inUse: boolean; count: number; entity: string; message: string }> {
    let count = 0;
    let entity = '';

    switch (key) {
      case 'departments': {
        count = await this.userRepository.count({ where: { tenantId, department: value } });
        entity = 'usuarios';
        break;
      }
      // competencyCategories removed — categories managed via Competencias page
      case 'evaluationPeriods': {
        const cycleRepo = this.userRepository.manager.getRepository('evaluation_cycles');
        count = await cycleRepo.createQueryBuilder('c')
          .where('c.tenant_id = :tenantId', { tenantId })
          .andWhere('c.period = :value', { value: value.toLowerCase() })
          .getCount();
        entity = 'ciclos de evaluación';
        break;
      }
      case 'potentialLevels':
      case 'objectiveTypes':
      case 'calibrationCausals':
      case 'evaluationScaleLabels': {
        // These are used as reference labels, not FK — allow deletion always
        return { inUse: false, count: 0, entity: '', message: '' };
      }
      default:
        return { inUse: false, count: 0, entity: '', message: '' };
    }

    if (count > 0) {
      return {
        inUse: true,
        count,
        entity,
        message: `No se puede eliminar "${value}" porque está asignado a ${count} ${entity}. Reasigna primero los registros.`,
      };
    }

    return { inUse: false, count: 0, entity, message: '' };
  }

  async setCustomSetting(tenantId: string, key: string, values: string[]): Promise<string[]> {
    if (!VALID_CUSTOM_KEYS.includes(key)) {
      throw new BadRequestException(`Clave no válida: ${key}`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un valor');
    }
    const sanitized = values
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
    if (sanitized.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un valor válido');
    }
    const tenant = await this.findById(tenantId);

    // Check if any removed values are in use
    const currentValues: string[] = tenant.settings?.[key] || CUSTOM_SETTINGS_DEFAULTS[key] || [];
    const removedValues = currentValues.filter((v) => !sanitized.includes(v));
    for (const removed of removedValues) {
      const usage = await this.checkSettingUsage(tenantId, key, removed);
      if (usage.inUse) {
        throw new BadRequestException(usage.message);
      }
    }

    tenant.settings = { ...(tenant.settings || {}), [key]: sanitized };
    await this.tenantRepository.save(tenant);
    return sanitized;
  }

  private static readonly VALID_TIMEZONES = [
    'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Bogota',
    'America/Mexico_City', 'America/Lima', 'America/Sao_Paulo',
    'America/New_York', 'Europe/Madrid', 'Europe/London', 'UTC',
  ];

  async updateTenantSettings(tenantId: string, dto: Record<string, any>): Promise<any> {
    const tenant = await this.findById(tenantId);
    const currentSettings = tenant.settings || {};

    // Timezone validation
    if (dto.timezone !== undefined) {
      if (dto.timezone === null || dto.timezone === '') {
        currentSettings.timezone = null;
      } else if (typeof dto.timezone === 'string' && TenantsService.VALID_TIMEZONES.includes(dto.timezone)) {
        currentSettings.timezone = dto.timezone;
      } else {
        throw new BadRequestException(`Zona horaria no válida: ${dto.timezone}`);
      }
    }

    // Session timeout validation (must be positive integer in minutes)
    if (dto.sessionTimeoutMinutes !== undefined) {
      if (dto.sessionTimeoutMinutes === null) {
        currentSettings.sessionTimeoutMinutes = null;
      } else {
        const val = Number(dto.sessionTimeoutMinutes);
        if (!Number.isInteger(val) || val < 5 || val > 1440) {
          throw new BadRequestException('La duración de sesión debe ser un número entero entre 5 y 1440 minutos');
        }
        currentSettings.sessionTimeoutMinutes = val;
      }
    }

    tenant.settings = currentSettings;
    await this.tenantRepository.save(tenant);
    return { timezone: currentSettings.timezone, sessionTimeoutMinutes: currentSettings.sessionTimeoutMinutes };
  }

  async getAllCustomSettings(tenantId: string): Promise<Record<string, string[]>> {
    const tenant = await this.findById(tenantId);
    const result: Record<string, string[]> = {};
    for (const key of VALID_CUSTOM_KEYS) {
      result[key] = tenant.settings?.[key] ?? CUSTOM_SETTINGS_DEFAULTS[key];
    }
    return result;
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

    // Subscription breakdown by plan (may fail if tables don't exist yet)
    let subscriptionsByPlan: any[] = [];
    try {
      subscriptionsByPlan = await this.subscriptionRepo
        .createQueryBuilder('s')
        .leftJoin('s.plan', 'p')
        .select('p.name', 'plan')
        .addSelect('s.status', 'status')
        .addSelect('COUNT(s.id)', 'count')
        .groupBy('p.name, s.status')
        .getRawMany();
    } catch { /* table may not exist yet */ }

    // Daily accesses (login events from audit log, last 7 days)
    let dailyAccesses: any[] = [];
    let recentFailures: any[] = [];
    try {
      dailyAccesses = await this.auditLogRepo
        .createQueryBuilder('l')
        .select("TO_CHAR(l.created_at, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(l.id)', 'count')
        .where("l.action ILIKE '%login%'")
        .andWhere("l.created_at > NOW() - INTERVAL '7 days'")
        .groupBy("TO_CHAR(l.created_at, 'YYYY-MM-DD')")
        .orderBy("TO_CHAR(l.created_at, 'YYYY-MM-DD')", 'DESC')
        .getRawMany();

      recentFailures = await this.auditLogRepo
        .createQueryBuilder('l')
        .select("TO_CHAR(l.created_at, 'YYYY-MM-DD')", 'date')
        .addSelect('COUNT(l.id)', 'count')
        .where("l.action ILIKE '%error%' OR l.action ILIKE '%fail%'")
        .andWhere("l.created_at > NOW() - INTERVAL '7 days'")
        .groupBy("TO_CHAR(l.created_at, 'YYYY-MM-DD')")
        .orderBy("TO_CHAR(l.created_at, 'YYYY-MM-DD')", 'DESC')
        .getRawMany();
    } catch { /* table may not exist yet */ }

    const totalFailures = recentFailures.reduce((sum: number, r: any) => sum + Number(r.count), 0);
    const todayAccesses = dailyAccesses.find((d: any) => d.date === new Date().toISOString().slice(0, 10));

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      activeUsers,
      usersPerPlan,
      recentTenants: recentTenantsWithUsers,
      subscriptionsByPlan,
      dailyAccesses,
      todayAccesses: todayAccesses ? Number(todayAccesses.count) : 0,
      recentFailures,
      totalFailures7d: totalFailures,
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

  // ─── Support Tickets ────────────────────────────────────────────────

  async listTickets(tenantId?: string) {
    const where = tenantId ? { tenantId } : {};
    return this.ticketRepo.find({
      where,
      relations: ['creator', 'responder', 'tenant'],
      order: { createdAt: 'DESC' },
    });
  }

  async createTicket(tenantId: string, createdBy: string, dto: {
    category: string; subject: string; description: string; priority?: string;
    attachments?: Array<{ name: string; size?: number; type?: string; data?: string }>;
  }) {
    // Validate attachment sizes (max 5MB each, stored as base64 in DB)
    const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
    if (dto.attachments?.length) {
      for (const att of dto.attachments) {
        if (att.size && att.size > MAX_ATTACHMENT_SIZE) {
          throw new BadRequestException(`El archivo "${att.name}" excede el límite de 5MB.`);
        }
      }
    }

    const ticket = this.ticketRepo.create({
      tenantId,
      createdBy,
      category: dto.category,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority || 'normal',
      status: 'open',
      attachments: dto.attachments || [],
    });
    const saved = await this.ticketRepo.save(ticket);

    // Notify all super_admins about the new ticket
    const superAdmins = await this.userRepository.find({
      where: { role: 'super_admin', isActive: true },
      select: ['id'],
    });
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId }, select: ['id', 'name'] });
    const orgName = tenant?.name || '';
    const notifications = superAdmins.map((sa) => ({
      tenantId: null as any,
      userId: sa.id,
      type: NotificationType.GENERAL,
      title: `Nueva solicitud: ${dto.subject}`,
      message: `${orgName} ha enviado una solicitud de tipo "${dto.category}". Prioridad: ${dto.priority || 'normal'}.`,
      metadata: { ticketId: saved.id, tenantId, category: dto.category },
    }));
    if (notifications.length > 0) {
      this.notificationsService.createBulk(notifications).catch(() => {});
    }

    return saved;
  }

  async respondTicket(ticketId: string, respondedBy: string, response: string, status?: string, responseAttachments?: Array<{ name: string; size?: number; type?: string; data?: string }>) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Solicitud no encontrada');
    ticket.response = response;
    ticket.respondedBy = respondedBy;
    if (responseAttachments?.length) {
      ticket.responseAttachments = responseAttachments;
    }

    // Notify the ticket creator about the response
    this.notificationsService.create({
      tenantId: ticket.tenantId,
      userId: ticket.createdBy,
      type: NotificationType.GENERAL,
      title: `Solicitud respondida: ${ticket.subject}`,
      message: `Tu solicitud "${ticket.subject}" ha sido respondida. Revisa la respuesta en la sección de Solicitudes.`,
      metadata: { ticketId },
    }).catch(() => {});
    ticket.respondedAt = new Date();
    ticket.status = status || 'responded';
    return this.ticketRepo.save(ticket);
  }

  async updateTicketStatus(ticketId: string, status: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Solicitud no encontrada');
    ticket.status = status;
    return this.ticketRepo.save(ticket);
  }
}
