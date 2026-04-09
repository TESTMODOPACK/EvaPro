import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from './entities/tenant.entity';
import { Department } from './entities/department.entity';
import { Position } from './entities/position.entity';
import { User } from '../users/entities/user.entity';
import { normalizeRut, validateRut } from '../../common/utils/rut-validator';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { AiInsight } from '../ai-insights/entities/ai-insight.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
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
    @InjectRepository(AiInsight)
    private readonly aiInsightRepo: Repository<AiInsight>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Position)
    private readonly positionRepo: Repository<Position>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { slug, isActive: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /** Validate and normalize a RUT, throwing BadRequestException if invalid */
  private validateAndNormalizeRut(rut: string, label = 'RUT'): string {
    const normalized = normalizeRut(rut);
    if (!validateRut(normalized)) {
      throw new BadRequestException(`RUT del ${label} inválido. Verifique el formato y dígito verificador.`);
    }
    return normalized;
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
      industry: dto.industry || null,
      employeeRange: dto.employeeRange || null,
      commercialAddress: dto.commercialAddress || null,
      legalRepName: dto.legalRepName || null,
      legalRepRut: dto.legalRepRut ? this.validateAndNormalizeRut(dto.legalRepRut, 'representante legal') : null,
      settings: dto.settings || { ...CUSTOM_SETTINGS_DEFAULTS },
    });
    const saved = await this.tenantRepository.save(tenant);

    // Auto-create department and position records from settings
    try {
      await this.ensureDepartmentRecords(saved.id);
      await this.ensurePositionRecords(saved.id);
    } catch { /* non-critical */ }

    // Optionally create admin user for this tenant
    let adminUser = null;
    if (dto.adminEmail && dto.adminPassword) {
      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      // Resolve department/position IDs
      const deptId = await this.findOrCreateDepartment(saved.id, dto.adminDepartment || 'Administración');
      const posId = await this.findOrCreatePosition(saved.id, dto.adminPosition || 'Encargado del Sistema');
      adminUser = this.userRepository.create({
        tenantId: saved.id,
        email: dto.adminEmail,
        passwordHash,
        firstName: dto.adminFirstName || 'Admin',
        lastName: dto.adminLastName || saved.name,
        role: 'tenant_admin',
        department: dto.adminDepartment || 'Administración',
        departmentId: deptId,
        position: dto.adminPosition || 'Encargado del Sistema',
        positionId: posId,
        isActive: true,
      });
      adminUser = await this.userRepository.save(adminUser);

      // Auto-add admin's department to catalog if not already there
      if (adminUser.department) {
        const depts: string[] = saved.settings?.departments || [];
        if (!depts.includes(adminUser.department)) {
          saved.settings = { ...saved.settings, departments: [...depts, adminUser.department] };
          await this.tenantRepository.save(saved);
        }
      }
    }

    // Auto-create base contracts (draft)
    try {
      const contractRepo = this.tenantRepository.manager.getRepository('contracts');
      const createdBy = adminUser?.id || null;
      for (const ct of [
        { type: 'service_agreement', title: 'Contrato de Prestación de Servicios' },
        { type: 'dpa', title: 'Acuerdo de Procesamiento de Datos (DPA)' },
        { type: 'terms_conditions', title: 'Términos y Condiciones de Uso' },
        { type: 'privacy_policy', title: 'Política de Privacidad' },
      ]) {
        await contractRepo.save(contractRepo.create({
          tenantId: saved.id, type: ct.type, title: ct.title,
          status: 'draft', effectiveDate: new Date(), createdBy,
        }));
      }
    } catch { /* contracts table may not exist yet */ }

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
    if (dto.industry !== undefined) tenant.industry = typeof dto.industry === 'string' ? dto.industry.trim() || null : null;
    if (dto.employeeRange !== undefined) tenant.employeeRange = typeof dto.employeeRange === 'string' ? dto.employeeRange.trim() || null : null;
    if (dto.commercialAddress !== undefined) tenant.commercialAddress = typeof dto.commercialAddress === 'string' ? dto.commercialAddress.trim() || null : null;
    if (dto.legalRepName !== undefined) tenant.legalRepName = typeof dto.legalRepName === 'string' ? dto.legalRepName.trim() || null : null;
    if (dto.legalRepRut !== undefined) {
      tenant.legalRepRut = dto.legalRepRut ? this.validateAndNormalizeRut(dto.legalRepRut, 'representante legal') : null;
    }
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
        const usageParts: string[] = [];

        const userDeptCount = await this.userRepository.count({ where: { tenantId, department: value } });
        if (userDeptCount > 0) {
          usageParts.push(`${userDeptCount} usuario(s)`);
          count += userDeptCount;
        }

        // Check active recruitment processes (safe — ignore if table doesn't exist)
        try {
          const recruitCount = await this.userRepository.manager.query(
            `SELECT COUNT(*) as cnt FROM recruitment_processes WHERE tenant_id = $1 AND department = $2 AND status NOT IN ('closed', 'cancelled')`,
            [tenantId, value],
          );
          const rc = Number(recruitCount?.[0]?.cnt || 0);
          if (rc > 0) { usageParts.push(`${rc} proceso(s) de reclutamiento`); count += rc; }
        } catch { /* table may not exist */ }

        // Check active calibration sessions (safe)
        try {
          const calibCount = await this.userRepository.manager.query(
            `SELECT COUNT(*) as cnt FROM calibration_sessions WHERE tenant_id = $1 AND department = $2 AND status != 'completed'`,
            [tenantId, value],
          );
          const cc = Number(calibCount?.[0]?.cnt || 0);
          if (cc > 0) { usageParts.push(`${cc} calibraci\ón(es)`); count += cc; }
        } catch { /* table may not exist */ }

        entity = usageParts.length > 0 ? usageParts.join(', ') : 'usuarios';
        break;
      }
      // competencyCategories removed — categories managed via Competencias page
      case 'evaluationPeriods': {
        try {
          const result = await this.userRepository.manager.query(
            `SELECT COUNT(*) as cnt FROM evaluation_cycles WHERE tenant_id = $1 AND LOWER(period) = $2`,
            [tenantId, value.toLowerCase()],
          );
          count = Number(result?.[0]?.cnt || 0);
        } catch { count = 0; }
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
      const message = key === 'departments'
        ? `No se puede eliminar "${value}" porque está en uso en: ${entity}. Reasigna primero los registros.`
        : `No se puede eliminar "${value}" porque está asignado a ${count} ${entity}. Reasigna primero los registros.`;
      return {
        inUse: true,
        count,
        entity,
        message,
      };
    }

    return { inUse: false, count: 0, entity, message: '' };
  }

  async setCustomSetting(tenantId: string, key: string, values: string[]): Promise<string[]> {
    if (!VALID_CUSTOM_KEYS.includes(key)) {
      throw new BadRequestException(`Clave no v\álida: ${key}`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un valor');
    }
    const sanitized = values
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
    if (sanitized.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un valor v\álido');
    }

    const tenant = await this.findById(tenantId);

    // For departments: detect renames and update users automatically
    if (key === 'departments') {
      const currentValues: string[] = Array.isArray(tenant.settings?.[key]) ? tenant.settings[key] : [];
      if (currentValues.length > 0) {
        const removedValues = currentValues.filter((v) => !sanitized.includes(v));
        const addedValues = sanitized.filter((v) => !currentValues.includes(v));

        // Try to match removed → added as renames (by position or 1-to-1)
        for (const removed of removedValues) {
          // Check if users have this department
          const userCount = await this.userRepository.count({ where: { tenantId, department: removed } });
          if (userCount > 0) {
            // Find the best rename candidate: new value at same index position
            const oldIdx = currentValues.indexOf(removed);
            const newAtSameIdx = oldIdx >= 0 && oldIdx < sanitized.length ? sanitized[oldIdx] : null;
            const renameTarget = addedValues.length === 1 ? addedValues[0]
              : (newAtSameIdx && addedValues.includes(newAtSameIdx)) ? newAtSameIdx
              : null;

            if (renameTarget) {
              // Rename: update all users with old department to new name
              await this.userRepository.update(
                { tenantId, department: removed },
                { department: renameTarget },
              );
              // Remove from addedValues so it's not matched again
              const idx = addedValues.indexOf(renameTarget);
              if (idx >= 0) addedValues.splice(idx, 1);
            }
            // If no rename target found, allow deletion anyway (users keep old name as orphan)
          }
        }
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

    // Logo: accepts data URI (base64, max ~500KB) or HTTPS URL
    if (dto.logoUrl !== undefined) {
      if (dto.logoUrl === null || dto.logoUrl === '') {
        currentSettings.logoUrl = null;
      } else if (typeof dto.logoUrl === 'string') {
        const isDataUri = /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(dto.logoUrl);
        const isHttpUrl = /^https?:\/\/.+/.test(dto.logoUrl.trim());
        if (isDataUri && dto.logoUrl.length <= 700_000) {
          // ~500KB image after base64 encoding
          currentSettings.logoUrl = dto.logoUrl;
        } else if (isHttpUrl && dto.logoUrl.length <= 2048) {
          currentSettings.logoUrl = dto.logoUrl.trim();
        }
      }
    }

    // Primary brand color (hex color)
    if (dto.primaryColor !== undefined) {
      if (dto.primaryColor === null || dto.primaryColor === '') {
        currentSettings.primaryColor = null;
      } else if (typeof dto.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(dto.primaryColor)) {
        currentSettings.primaryColor = dto.primaryColor;
      }
    }

    // Email notification preferences
    if (dto.emailNotifications !== undefined) {
      if (typeof dto.emailNotifications === 'boolean') {
        currentSettings.emailNotifications = dto.emailNotifications;
      }
    }

    // Notification types (object with boolean flags)
    if (dto.notificationTypes !== undefined && typeof dto.notificationTypes === 'object' && dto.notificationTypes !== null) {
      currentSettings.notificationTypes = {
        ...(currentSettings.notificationTypes || {}),
        ...dto.notificationTypes,
      };
    }

    // Date format preference
    if (dto.dateFormat !== undefined) {
      const validFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
      if (dto.dateFormat === null || dto.dateFormat === '') {
        currentSettings.dateFormat = null;
      } else if (typeof dto.dateFormat === 'string' && validFormats.includes(dto.dateFormat)) {
        currentSettings.dateFormat = dto.dateFormat;
      }
    }

    // Default organization language
    if (dto.defaultLanguage !== undefined) {
      const validLangs = ['es', 'en', 'pt'];
      if (dto.defaultLanguage === null || dto.defaultLanguage === '') {
        currentSettings.defaultLanguage = null;
      } else if (typeof dto.defaultLanguage === 'string' && validLangs.includes(dto.defaultLanguage)) {
        currentSettings.defaultLanguage = dto.defaultLanguage;
      }
    }

    // Email FROM address per organization
    if (dto.emailFrom !== undefined) {
      if (dto.emailFrom === null || dto.emailFrom === '') {
        currentSettings.emailFrom = null;
      } else if (typeof dto.emailFrom === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.emailFrom.trim())) {
        currentSettings.emailFrom = dto.emailFrom.trim();
      }
    }

    // Feedback configuration
    if (dto.feedbackConfig !== undefined && typeof dto.feedbackConfig === 'object') {
      const fc = dto.feedbackConfig;
      currentSettings.feedbackConfig = {
        scope: ['all', 'department', 'team'].includes(fc.scope) ? fc.scope : 'all',
        allowAnonymous: fc.allowAnonymous !== false,
        minMessageLength: Math.max(10, Math.min(500, Number(fc.minMessageLength) || 20)),
        allowPeerFeedback: fc.allowPeerFeedback !== false,
        requireCompetency: fc.requireCompetency === true,
      };
    }

    // Tenant column fields (editable by tenant admin)
    if (dto.commercialAddress !== undefined) {
      tenant.commercialAddress = typeof dto.commercialAddress === 'string' ? dto.commercialAddress.trim() || null : null;
    }
    if (dto.industry !== undefined) {
      tenant.industry = typeof dto.industry === 'string' ? dto.industry.trim() || null : null;
    }
    if (dto.employeeRange !== undefined) {
      tenant.employeeRange = typeof dto.employeeRange === 'string' ? dto.employeeRange.trim() || null : null;
    }

    // Legal representative data (for contracts)
    if (dto.legalRepName !== undefined) {
      tenant.legalRepName = typeof dto.legalRepName === 'string' ? dto.legalRepName.trim() || null : null;
    }
    if (dto.legalRepRut !== undefined) {
      tenant.legalRepRut = dto.legalRepRut ? this.validateAndNormalizeRut(dto.legalRepRut, 'representante legal') : null;
    }

    tenant.settings = currentSettings;
    await this.tenantRepository.save(tenant);
    return {
      timezone: currentSettings.timezone,
      sessionTimeoutMinutes: currentSettings.sessionTimeoutMinutes,
      logoUrl: currentSettings.logoUrl,
      primaryColor: currentSettings.primaryColor,
      emailNotifications: currentSettings.emailNotifications,
      notificationTypes: currentSettings.notificationTypes,
      dateFormat: currentSettings.dateFormat,
      defaultLanguage: currentSettings.defaultLanguage,
      emailFrom: currentSettings.emailFrom,
      commercialAddress: tenant.commercialAddress,
      industry: tenant.industry,
      employeeRange: tenant.employeeRange,
      legalRepName: tenant.legalRepName,
      legalRepRut: tenant.legalRepRut,
    };
  }

  async getAllCustomSettings(tenantId: string): Promise<Record<string, string[]>> {
    const tenant = await this.findById(tenantId);
    const result: Record<string, string[]> = {};
    for (const key of VALID_CUSTOM_KEYS) {
      result[key] = tenant.settings?.[key] ?? CUSTOM_SETTINGS_DEFAULTS[key];
    }
    return result;
  }

  // ─── Positions Catalog (structured, separate from string[] settings) ────

  private static readonly DEFAULT_POSITIONS = [
    { name: 'Gerente General', level: 1 },
    { name: 'Gerente de Área', level: 2 },
    { name: 'Subgerente', level: 3 },
    { name: 'Jefe de Área', level: 4 },
    { name: 'Coordinador', level: 5 },
    { name: 'Analista', level: 6 },
    { name: 'Asistente', level: 7 },
  ];

  async getPositionsCatalog(tenantId: string): Promise<{ name: string; level: number }[]> {
    const tenant = await this.findById(tenantId);
    const positions = tenant.settings?.positions;
    if (Array.isArray(positions) && positions.length > 0) return positions;
    return TenantsService.DEFAULT_POSITIONS;
  }

  async setPositionsCatalog(tenantId: string, positions: { name: string; level: number }[]): Promise<{ name: string; level: number }[]> {
    const tenant = await this.findById(tenantId);
    // Validate: non-empty, levels are positive integers, names non-empty
    if (!Array.isArray(positions) || positions.length === 0) {
      throw new BadRequestException('Debe incluir al menos un cargo');
    }
    for (const p of positions) {
      if (!p.name?.trim()) throw new BadRequestException('El nombre del cargo no puede estar vacío');
      if (!Number.isInteger(p.level) || p.level < 1) throw new BadRequestException(`Nivel inválido para "${p.name}": debe ser un entero >= 1`);
    }

    // Check for positions being removed that are in use
    const currentPositions: { name: string; level: number }[] = Array.isArray(tenant.settings?.positions) && tenant.settings.positions.length > 0
      ? tenant.settings.positions
      : [...TenantsService.DEFAULT_POSITIONS];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\̀-\ͯ]/g, '').trim();
    const newNamesNorm = new Set(positions.map(p => norm(p.name)));
    const removedPositions = currentPositions.filter(p => !newNamesNorm.has(norm(p.name)));

    if (removedPositions.length > 0) {
      const blocked: string[] = [];

      for (const removed of removedPositions) {
        const usages: string[] = [];

        // Check users with this position
        const userCount = await this.userRepository.count({
          where: { tenantId, position: removed.name, isActive: true },
        });
        if (userCount > 0) {
          usages.push(`${userCount} usuario(s)`);
        }

        // Check RoleCompetency profiles with this position
        const roleCompRepo = this.userRepository.manager.getRepository('role_competencies');
        const rcCount = await roleCompRepo.createQueryBuilder('rc')
          .where('rc.tenant_id = :tenantId', { tenantId })
          .andWhere('rc.position = :position', { position: removed.name })
          .getCount();
        if (rcCount > 0) {
          usages.push(`${rcCount} perfil(es) de competencias`);
        }

        if (usages.length > 0) {
          blocked.push(`"${removed.name}" (en uso en ${usages.join(' y ')})`);
        }
      }

      if (blocked.length > 0) {
        throw new BadRequestException(
          `No se pueden eliminar los siguientes cargos porque están en uso: ${blocked.join('; ')}. Reasigna primero los registros.`,
        );
      }
    }

    // Sort by level ascending
    const sorted = [...positions].sort((a, b) => a.level - b.level);
    tenant.settings = { ...(tenant.settings || {}), positions: sorted };
    await this.tenantRepository.save(tenant);
    return sorted;
  }

  async checkPositionUsage(tenantId: string, positionName: string): Promise<{ inUse: boolean; count: number }> {
    const count = await this.userRepository.count({ where: { tenantId, position: positionName } });
    return { inUse: count > 0, count };
  }

  /** Returns all positions from catalog + any custom positions assigned to users */
  async getPositionsWithInUse(tenantId: string): Promise<{ name: string; level: number }[]> {
    const catalog = await this.getPositionsCatalog(tenantId);
    const catalogNames = new Set(catalog.map(p => p.name.toLowerCase()));
    // Find positions assigned to users that aren't in catalog
    const users = await this.userRepository.find({
      where: { tenantId },
      select: ['position', 'hierarchyLevel'],
    });
    const extras: { name: string; level: number }[] = [];
    const seen = new Set<string>();
    for (const u of users) {
      if (u.position && !catalogNames.has(u.position.toLowerCase()) && !seen.has(u.position.toLowerCase())) {
        seen.add(u.position.toLowerCase());
        extras.push({ name: u.position, level: u.hierarchyLevel || 99 });
      }
    }
    return [...catalog, ...extras].sort((a, b) => a.level - b.level);
  }

  // ─── Bulk Onboarding (from Excel data) ─────────────────────────────

  async bulkOnboard(data: {
    org: { name: string; rut?: string; ownerType?: string; industry?: string; employeeRange?: string; commercialAddress?: string; legalRepName?: string; legalRepRut?: string; plan?: string; billingPeriod?: string; startDate?: string };
    admin: { email: string; firstName: string; lastName: string; rut?: string; password: string; position?: string; department?: string };
    departments?: string[];
    positions?: { name: string; level: number }[];
    competencies?: { name: string; category: string; description?: string; expectedLevel?: number }[];
    users?: { email: string; firstName: string; lastName: string; rut?: string; password: string; role: string; department?: string; position?: string; hireDate?: string; managerEmail?: string }[];
  }): Promise<{ tenant: any; admin: any; usersCreated: number; competenciesCreated: number; summary: string[] }> {
    const summary: string[] = [];

    // Validate required fields
    if (!data.org?.name?.trim()) throw new BadRequestException('Nombre de la organización es requerido');
    if (!data.admin?.email?.trim() || !data.admin.email.includes('@')) throw new BadRequestException('Email del administrador es requerido y debe ser válido');
    if (!data.admin?.password?.trim()) throw new BadRequestException('Contraseña del administrador es requerida');
    if (!data.admin?.firstName?.trim()) throw new BadRequestException('Nombre del administrador es requerido');
    if (!data.admin?.lastName?.trim()) throw new BadRequestException('Apellido del administrador es requerido');

    // Check for duplicate email
    const existingEmail = await this.userRepository.findOne({ where: { email: data.admin.email.trim().toLowerCase() } });
    if (existingEmail) throw new BadRequestException(`El email ${data.admin.email} ya está registrado en otra organización`);

    // 1. Create tenant (auto-generate unique slug)
    let slug = data.org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const existingSlug = await this.tenantRepository.findOne({ where: { slug } });
    if (existingSlug) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const tenant = await this.create({
      name: data.org.name,
      slug,
      rut: data.org.rut,
      ownerType: data.org.ownerType || 'company',
      industry: data.org.industry,
      employeeRange: data.org.employeeRange,
      commercialAddress: data.org.commercialAddress,
      legalRepName: data.org.legalRepName || null,
      legalRepRut: data.org.legalRepRut || null,
    });
    summary.push(`Organización "${tenant.name}" creada (ID: ${tenant.id})`);

    // 2. Configure settings (departments + positions)
    const settings: any = { ...(tenant.settings || {}) };
    if (data.departments?.length) {
      settings.departments = data.departments;
      summary.push(`${data.departments.length} departamentos configurados`);
    }
    if (data.positions?.length) {
      settings.positions = data.positions.sort((a, b) => a.level - b.level);
      summary.push(`${data.positions.length} cargos configurados`);
    }
    tenant.settings = settings;
    await this.tenantRepository.save(tenant);

    // 3. Create subscription (optional — defaults to starter if not specified)
    const planCode = data.org.plan || 'starter';
    const billingPeriod = data.org.billingPeriod || 'monthly';
    const planRepo = this.subscriptionRepo.manager.getRepository('subscription_plans');
    const plan = await planRepo.findOne({ where: { code: planCode, isActive: true } });
    if (plan) {
      const sub = this.subscriptionRepo.create({
        tenantId: tenant.id,
        planId: (plan as any).id,
        status: 'active',
        startDate: data.org.startDate ? new Date(data.org.startDate) : new Date(),
        billingPeriod: billingPeriod as any,
        autoRenew: true,
      });
      await this.subscriptionRepo.save(sub);
      summary.push(`Suscripción plan "${(plan as any).name}" (${billingPeriod}) activada`);
    } else {
      summary.push(`ADVERTENCIA: Plan "${planCode}" no encontrado. Sin suscripción.`);
    }

    // 4. Create admin user
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.hash(data.admin.password, 12);
    const adminUser = this.userRepository.create({
      tenantId: tenant.id,
      email: data.admin.email,
      firstName: data.admin.firstName,
      lastName: data.admin.lastName,
      rut: data.admin.rut || null,
      passwordHash: adminHash,
      role: 'tenant_admin',
      department: data.admin.department || null,
      position: data.admin.position || null,
      isActive: true,
      mustChangePassword: true,
    } as any);
    const savedAdmin: any = await this.userRepository.save(adminUser);
    summary.push(`Administrador "${data.admin.firstName} ${data.admin.lastName}" creado (${data.admin.email})`);

    // 5. Create competencies
    let competenciesCreated = 0;
    if (data.competencies?.length) {
      const compRepo = this.userRepository.manager.getRepository('competencies');
      for (const comp of data.competencies) {
        await compRepo.save(compRepo.create({
          tenantId: tenant.id,
          name: comp.name,
          category: comp.category,
          description: comp.description || null,
          expectedLevel: comp.expectedLevel || null,
          isActive: true,
          status: 'approved',
        }));
        competenciesCreated++;
      }
      summary.push(`${competenciesCreated} competencias creadas`);
    }

    // 6. Create additional users
    let usersCreated = 0;
    const emailToId = new Map<string, string>();
    emailToId.set(data.admin.email.toLowerCase(), savedAdmin.id);

    if (data.users?.length) {
      // First pass: create users without managerId
      for (const u of data.users) {
        const hash = await bcrypt.hash(u.password, 12);
        const user = this.userRepository.create({
          tenantId: tenant.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          rut: u.rut || null,
          passwordHash: hash,
          role: u.role || 'employee',
          department: u.department || null,
          position: u.position || null,
          hireDate: u.hireDate ? new Date(u.hireDate) : null,
          isActive: true,
          mustChangePassword: true,
        } as any);
        const saved: any = await this.userRepository.save(user);
        emailToId.set(u.email.toLowerCase(), saved.id);
        usersCreated++;
      }

      // Second pass: assign managers by email
      for (const u of data.users) {
        if (u.managerEmail) {
          const managerId = emailToId.get(u.managerEmail.toLowerCase());
          if (managerId) {
            const userId = emailToId.get(u.email.toLowerCase());
            if (userId) {
              await this.userRepository.update(userId, { managerId });
            }
          }
        }
      }
      summary.push(`${usersCreated} colaboradores creados`);
    }

    // 7. Auto-create base contracts (draft)
    try {
      const contractRepo = this.tenantRepository.manager.getRepository('contracts');
      const contractTypes = [
        { type: 'service_agreement', title: 'Contrato de Prestación de Servicios' },
        { type: 'dpa', title: 'Acuerdo de Procesamiento de Datos (DPA)' },
        { type: 'terms_conditions', title: 'Términos y Condiciones de Uso' },
        { type: 'privacy_policy', title: 'Política de Privacidad' },
      ];
      for (const ct of contractTypes) {
        await contractRepo.save(contractRepo.create({
          tenantId: tenant.id,
          type: ct.type,
          title: ct.title,
          status: 'draft',
          effectiveDate: data.org.startDate ? new Date(data.org.startDate) : new Date(),
          createdBy: savedAdmin.id,
        }));
      }
      summary.push(`4 contratos base creados (borrador)`);
    } catch { /* contracts table may not exist yet */ }

    // 8. Audit
    await this.auditLogRepo.save(this.auditLogRepo.create({
      tenantId: tenant.id,
      userId: null as any,
      action: 'tenant.bulk_onboarded',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { usersCreated, competenciesCreated, plan: data.org.plan },
    } as any));

    return { tenant, admin: savedAdmin, usersCreated, competenciesCreated, summary };
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

  // ─── AI Usage per Tenant ─────────────────────────────────────────────

  async getAiUsageByTenant(): Promise<any[]> {
    try {
      // Get all active tenants with their subscriptions & plans
      const tenants = await this.tenantRepository.find({
        where: { isActive: true },
        order: { name: 'ASC' },
      });

      const results = [];

      for (const tenant of tenants) {
        // Get subscription with plan
        const sub = await this.subscriptionRepo.findOne({
          where: { tenantId: tenant.id, status: 'active' },
          relations: ['plan'],
        }) || await this.subscriptionRepo.findOne({
          where: { tenantId: tenant.id, status: 'trial' },
          relations: ['plan'],
        });

        const planLimit = sub?.plan?.maxAiCallsPerMonth ?? 0;
        const addonCalls = sub?.aiAddonCalls ?? 0;
        const addonUsed = sub?.aiAddonUsed ?? 0;

        // Count total AI insights for this tenant (all time)
        const totalAllTime = await this.aiInsightRepo.count({
          where: { tenantId: tenant.id },
        });

        // Count insights this month (current billing period)
        const startDate = sub?.startDate ? new Date(sub.startDate) : new Date();
        const now = new Date();
        const subDay = startDate.getUTCDate();
        const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), subDay));
        const periodStart = now >= thisMonthStart
          ? thisMonthStart
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, subDay));

        const periodUsed = await this.aiInsightRepo
          .createQueryBuilder('i')
          .where('i.tenant_id = :tenantId', { tenantId: tenant.id })
          .andWhere('i.created_at > :start', { start: periodStart })
          .getCount();

        // Count by type for this tenant (all time)
        const byType = await this.aiInsightRepo
          .createQueryBuilder('i')
          .select('i.type', 'type')
          .addSelect('COUNT(i.id)', 'count')
          .where('i.tenant_id = :tenantId', { tenantId: tenant.id })
          .groupBy('i.type')
          .getRawMany();

        // Tokens used total
        const tokensResult = await this.aiInsightRepo
          .createQueryBuilder('i')
          .select('COALESCE(SUM(i.tokens_used), 0)', 'totalTokens')
          .where('i.tenant_id = :tenantId', { tenantId: tenant.id })
          .getRawOne();

        const totalLimit = planLimit + Math.max(0, addonCalls - addonUsed);
        const addonRemaining = Math.max(0, addonCalls - addonUsed);
        const planUsed = Math.min(periodUsed, planLimit);
        const pctUsed = totalLimit > 0 ? Math.round((periodUsed / totalLimit) * 100) : 0;

        results.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          plan: sub?.plan?.name ?? 'Sin plan',
          planCode: sub?.plan?.code ?? null,
          planLimit,
          addonCalls,
          addonUsed,
          addonRemaining,
          periodUsed,
          totalLimit,
          planUsed,
          pctUsed,
          totalAllTime,
          totalTokens: Number(tokensResult?.totalTokens) || 0,
          byType: byType.reduce((acc: Record<string, number>, r: any) => {
            acc[r.type] = Number(r.count);
            return acc;
          }, {}),
          status: sub?.status ?? 'none',
        });
      }

      // Sort by periodUsed DESC (most active first)
      results.sort((a, b) => b.periodUsed - a.periodUsed);

      return results;
    } catch (err) {
      return [];
    }
  }

  // ─── Departments Table CRUD ──────────────────────────────────────────

  async getDepartmentsTable(tenantId: string): Promise<Department[]> {
    return this.departmentRepo.find({
      where: { tenantId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createDepartmentRecord(tenantId: string, dto: { name: string; sortOrder?: number }): Promise<Department> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre del departamento es requerido');

    // Check uniqueness (case-insensitive)
    const existing = await this.departmentRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(d.name) = LOWER(:name)', { name })
      .getOne();
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        existing.name = name;
        const reactivated = await this.departmentRepo.save(existing);
        await this.syncDepartmentsToSettings(tenantId);
        return reactivated;
      }
      throw new ConflictException(`El departamento "${name}" ya existe`);
    }

    const dept = this.departmentRepo.create({
      tenantId,
      name,
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    });
    const saved = await this.departmentRepo.save(dept);

    // Sync to tenant.settings for backward compat
    await this.syncDepartmentsToSettings(tenantId);

    return saved;
  }

  async updateDepartmentRecord(tenantId: string, deptId: string, dto: { name?: string; sortOrder?: number; isActive?: boolean }): Promise<Department> {
    const dept = await this.departmentRepo.findOne({ where: { id: deptId, tenantId } });
    if (!dept) throw new NotFoundException('Departamento no encontrado');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre no puede estar vacío');

      // Check uniqueness
      const existing = await this.departmentRepo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name })
        .andWhere('d.id != :id', { id: deptId })
        .getOne();
      if (existing) throw new ConflictException(`El departamento "${name}" ya existe`);

      // Rename users with old department name
      const oldName = dept.name;
      if (oldName !== name) {
        await this.userRepository.update(
          { tenantId, department: oldName },
          { department: name },
        );
      }

      dept.name = name;
    }
    if (dto.sortOrder !== undefined) dept.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) dept.isActive = dto.isActive;

    const saved = await this.departmentRepo.save(dept);
    await this.syncDepartmentsToSettings(tenantId);
    return saved;
  }

  async deleteDepartmentRecord(tenantId: string, deptId: string): Promise<void> {
    const dept = await this.departmentRepo.findOne({ where: { id: deptId, tenantId } });
    if (!dept) throw new NotFoundException('Departamento no encontrado');

    // Check usage
    const usage = await this.checkSettingUsage(tenantId, 'departments', dept.name);
    if (usage.inUse) {
      throw new BadRequestException(usage.message);
    }

    // Soft-delete (deactivate)
    dept.isActive = false;
    await this.departmentRepo.save(dept);
    await this.syncDepartmentsToSettings(tenantId);
  }

  /** Sync departments table → tenant.settings.departments for backward compat */
  async syncDepartmentsToSettings(tenantId: string): Promise<void> {
    const depts = await this.departmentRepo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const tenant = await this.findById(tenantId);
    tenant.settings = { ...(tenant.settings || {}), departments: depts.map(d => d.name) };
    await this.tenantRepository.save(tenant);
  }

  /** Ensure department records exist for a tenant (creates from settings if needed) */
  async ensureDepartmentRecords(tenantId: string): Promise<void> {
    const existing = await this.departmentRepo.count({ where: { tenantId } });
    if (existing > 0) return; // Already migrated

    const tenant = await this.findById(tenantId);
    const deptNames: string[] = tenant.settings?.departments || CUSTOM_SETTINGS_DEFAULTS.departments;
    for (let i = 0; i < deptNames.length; i++) {
      const name = deptNames[i]?.trim();
      if (!name) continue;
      try {
        await this.departmentRepo.save(this.departmentRepo.create({
          tenantId, name, sortOrder: i, isActive: true,
        }));
      } catch { /* duplicate — skip */ }
    }
  }

  /** Find or create a department by name, returning its ID */
  async findOrCreateDepartment(tenantId: string, name: string): Promise<string | null> {
    if (!name?.trim()) return null;
    const trimmed = name.trim();
    let dept = await this.departmentRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(d.name) = LOWER(:name)', { name: trimmed })
      .getOne();
    if (dept) {
      if (!dept.isActive) {
        dept.isActive = true;
        await this.departmentRepo.save(dept);
      }
      return dept.id;
    }
    // Create new
    dept = this.departmentRepo.create({ tenantId, name: trimmed, isActive: true });
    const saved = await this.departmentRepo.save(dept);
    await this.syncDepartmentsToSettings(tenantId);
    return saved.id;
  }

  // ─── Positions Table CRUD ──────────────────────────────────────────

  async getPositionsTable(tenantId: string): Promise<Position[]> {
    return this.positionRepo.find({
      where: { tenantId },
      order: { level: 'ASC', name: 'ASC' },
    });
  }

  async createPositionRecord(tenantId: string, dto: { name: string; level?: number }): Promise<Position> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre del cargo es requerido');

    const existing = await this.positionRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(p.name) = LOWER(:name)', { name })
      .getOne();
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        existing.name = name;
        if (dto.level !== undefined) existing.level = dto.level;
        const reactivated = await this.positionRepo.save(existing);
        await this.syncPositionsToSettings(tenantId);
        return reactivated;
      }
      throw new ConflictException(`El cargo "${name}" ya existe`);
    }

    const pos = this.positionRepo.create({
      tenantId,
      name,
      level: dto.level ?? 0,
      isActive: true,
    });
    const saved = await this.positionRepo.save(pos);
    await this.syncPositionsToSettings(tenantId);
    return saved;
  }

  async updatePositionRecord(tenantId: string, posId: string, dto: { name?: string; level?: number; isActive?: boolean }): Promise<Position> {
    const pos = await this.positionRepo.findOne({ where: { id: posId, tenantId } });
    if (!pos) throw new NotFoundException('Cargo no encontrado');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre no puede estar vacío');

      const existing = await this.positionRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name })
        .andWhere('p.id != :id', { id: posId })
        .getOne();
      if (existing) throw new ConflictException(`El cargo "${name}" ya existe`);

      const oldName = pos.name;
      if (oldName !== name) {
        await this.userRepository.update(
          { tenantId, position: oldName },
          { position: name },
        );
      }
      pos.name = name;
    }
    if (dto.level !== undefined) pos.level = dto.level;
    if (dto.isActive !== undefined) pos.isActive = dto.isActive;

    const saved = await this.positionRepo.save(pos);
    await this.syncPositionsToSettings(tenantId);
    return saved;
  }

  async deletePositionRecord(tenantId: string, posId: string): Promise<void> {
    const pos = await this.positionRepo.findOne({ where: { id: posId, tenantId } });
    if (!pos) throw new NotFoundException('Cargo no encontrado');

    const usage = await this.checkPositionUsage(tenantId, pos.name);
    if (usage.inUse) {
      throw new BadRequestException(`No se puede eliminar "${pos.name}" porque está asignado a ${usage.count} usuario(s)`);
    }

    pos.isActive = false;
    await this.positionRepo.save(pos);
    await this.syncPositionsToSettings(tenantId);
  }

  /** Sync positions table → tenant.settings.positions for backward compat */
  async syncPositionsToSettings(tenantId: string): Promise<void> {
    const positions = await this.positionRepo.find({
      where: { tenantId, isActive: true },
      order: { level: 'ASC', name: 'ASC' },
    });
    const tenant = await this.findById(tenantId);
    tenant.settings = {
      ...(tenant.settings || {}),
      positions: positions.map(p => ({ name: p.name, level: p.level })),
    };
    await this.tenantRepository.save(tenant);
  }

  /** Ensure position records exist for a tenant (creates from settings if needed) */
  async ensurePositionRecords(tenantId: string): Promise<void> {
    const existing = await this.positionRepo.count({ where: { tenantId } });
    if (existing > 0) return;

    const tenant = await this.findById(tenantId);
    const positions: { name: string; level: number }[] = Array.isArray(tenant.settings?.positions) && tenant.settings.positions.length > 0
      ? tenant.settings.positions
      : TenantsService.DEFAULT_POSITIONS;
    for (const p of positions) {
      const name = p.name?.trim();
      if (!name) continue;
      try {
        await this.positionRepo.save(this.positionRepo.create({
          tenantId, name, level: p.level || 0, isActive: true,
        }));
      } catch { /* duplicate — skip */ }
    }
  }

  /** Find or create a position by name, returning its ID */
  async findOrCreatePosition(tenantId: string, name: string, level?: number): Promise<string | null> {
    if (!name?.trim()) return null;
    const trimmed = name.trim();
    let pos = await this.positionRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(p.name) = LOWER(:name)', { name: trimmed })
      .getOne();
    if (pos) {
      if (!pos.isActive) {
        pos.isActive = true;
        await this.positionRepo.save(pos);
      }
      return pos.id;
    }
    pos = this.positionRepo.create({ tenantId, name: trimmed, level: level ?? 0, isActive: true });
    const saved = await this.positionRepo.save(pos);
    await this.syncPositionsToSettings(tenantId);
    return saved.id;
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
