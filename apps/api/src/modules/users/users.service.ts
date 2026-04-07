import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserNote } from './entities/user-note.entity';
import { UserDeparture } from './entities/user-departure.entity';
import { UserMovement, MovementType } from './entities/user-movement.entity';
import { BulkImport, ImportStatus } from './entities/bulk-import.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepartureDto } from './dto/create-departure.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { looksLikeRut, normalizeRut, validateRut } from '../../common/utils/rut-validator';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserNote)
    private readonly noteRepo: Repository<UserNote>,
    @InjectRepository(BulkImport)
    private readonly bulkImportRepo: Repository<BulkImport>,
    @InjectRepository(UserDeparture)
    private readonly departureRepo: Repository<UserDeparture>,
    @InjectRepository(UserMovement)
    private readonly movementRepo: Repository<UserMovement>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private static readonly DEFAULT_DEPARTMENTS = [
    'Tecnología', 'Recursos Humanos', 'Ventas', 'Marketing',
    'Operaciones', 'Finanzas', 'Legal', 'Administración',
  ];

  private async getConfiguredDepartments(tenantId: string): Promise<string[]> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return tenant?.settings?.departments ?? UsersService.DEFAULT_DEPARTMENTS;
  }

  /** Auto-add custom position to tenant catalog if not already there */
  private async autoAddPositionToCatalog(tenantId: string, position: string | undefined, hierarchyLevel: number | null | undefined): Promise<void> {
    if (!position?.trim() || hierarchyLevel == null || hierarchyLevel < 1) return;
    try {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      if (!tenant) return;
      const DEFAULT_POSITIONS = [
        { name: 'Gerente General', level: 1 }, { name: 'Gerente de Área', level: 2 },
        { name: 'Subgerente', level: 3 }, { name: 'Jefe de Área', level: 4 },
        { name: 'Coordinador', level: 5 }, { name: 'Analista', level: 6 }, { name: 'Asistente', level: 7 },
      ];
      const current: { name: string; level: number }[] = Array.isArray(tenant.settings?.positions) && tenant.settings.positions.length > 0
        ? [...tenant.settings.positions]
        : [...DEFAULT_POSITIONS];
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (current.some(p => norm(p.name) === norm(position.trim()))) return;
      current.push({ name: position.trim(), level: hierarchyLevel });
      current.sort((a, b) => a.level - b.level);
      tenant.settings = { ...(tenant.settings || {}), positions: current };
      await this.tenantRepo.save(tenant);
    } catch { /* fire-and-forget: don't block user creation */ }
  }

  private validateDepartment(department: string | undefined, configuredDepts: string[]): void {
    if (!department) return; // null/undefined is OK
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = configuredDepts.some((d) => norm(d) === norm(department));
    if (!match) {
      throw new BadRequestException(
        `El departamento "${department}" no está configurado. Departamentos válidos: ${configuredDepts.join(', ')}`,
      );
    }
  }

  // ─── Auth helper ──────────────────────────────────────────────────────────

  async findByEmail(email: string, tenantIdOrSlug?: string): Promise<User | null> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.tenant', 'tenant')
      .where('user.email = :email', { email });

    if (tenantIdOrSlug) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrSlug);
      if (isUuid) {
        query.andWhere('user.tenantId = :tid', { tid: tenantIdOrSlug });
      } else if (looksLikeRut(tenantIdOrSlug)) {
        // RUT lookup
        query.andWhere('tenant.rut = :rut', { rut: normalizeRut(tenantIdOrSlug) });
      } else {
        // Slug lookup
        query.andWhere('tenant.slug = :slug', { slug: tenantIdOrSlug });
      }
    }

    return query.getOne();
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async findByIdScoped(id: string, tenantId?: string): Promise<User> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const user = await this.userRepository.findOne({ where });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    page = 1,
    limit = 50,
    filters?: { search?: string; department?: string; role?: string; position?: string; status?: string },
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const qb = this.userRepository.createQueryBuilder('user')
      .where('user.tenantId = :tenantId', { tenantId })
      .andWhere('user.role != :excluded', { excluded: 'super_admin' });

    if (filters?.search) {
      qb.andWhere(
        '(LOWER(user.first_name) LIKE :search OR LOWER(user.last_name) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: `%${filters.search.toLowerCase()}%` },
      );
    }
    if (filters?.department) {
      qb.andWhere('user.department = :department', { department: filters.department });
    }
    if (filters?.role) {
      qb.andWhere('user.role = :role', { role: filters.role });
    }
    if (filters?.position) {
      qb.andWhere('user.position = :position', { position: filters.position });
    }
    if (filters?.status === 'inactive') {
      qb.andWhere('user.is_active = false');
    } else if (filters?.status === 'all') {
      // Show all users (active + inactive) — for admin views
    } else {
      // Default: show only active users
      qb.andWhere('user.is_active = true');
    }

    qb.orderBy('user.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: safePage, limit: safeLimit };
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<User> {
    // Check plan limits
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (sub && sub.plan) {
      const currentCount = await this.userRepository.count({
        where: { tenantId, isActive: true },
      });
      if (currentCount >= sub.plan.maxEmployees) {
        throw new ForbiddenException(
          `Límite de usuarios alcanzado para el plan "${sub.plan.name}". Máximo: ${sub.plan.maxEmployees}`,
        );
      }
    }

    const existing = await this.findByEmail(dto.email, tenantId);
    if (existing) {
      throw new ConflictException(
        `Ya existe un usuario con el email ${dto.email}`,
      );
    }

    if (dto.managerId) {
      const manager = await this.userRepository.findOne({ where: { id: dto.managerId, tenantId } });
      if (!manager) {
        throw new NotFoundException('Manager no encontrado en esta organización');
      }
      if (manager.role !== 'manager' && manager.role !== 'tenant_admin') {
        throw new BadRequestException('El usuario seleccionado como jefatura debe tener rol de encargado de equipo o administrador');
      }
      // Validate hierarchy: manager must have higher level (lower number) than the user
      const userLevel = dto.hierarchyLevel;
      if (userLevel && manager.hierarchyLevel && manager.hierarchyLevel >= userLevel) {
        throw new BadRequestException(
          `La jefatura seleccionada (${manager.firstName} ${manager.lastName}, Nv.${manager.hierarchyLevel}) debe tener un nivel jerárquico superior (número menor) al colaborador (Nv.${userLevel}).`,
        );
      }
    }

    // Validate department against configured list
    if (dto.department) {
      const configuredDepts = await this.getConfiguredDepartments(tenantId);
      this.validateDepartment(dto.department, configuredDepts);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = this.userRepository.create({
      tenantId,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash,
      rut: dto.rut || null,
      role: dto.role ?? 'employee',
      managerId: dto.managerId,
      department: dto.department,
      position: dto.position,
      hierarchyLevel: dto.hierarchyLevel ?? null,
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      isActive: true,
      mustChangePassword: true,
    });

    const saved = await this.userRepository.save(user);
    await this.auditService.log(tenantId, saved.id, 'user.created', 'user', saved.id);
    // Auto-add custom position to catalog
    this.autoAddPositionToCatalog(tenantId, saved.position, saved.hierarchyLevel).catch(() => {});
    return saved;
  }

  async update(id: string, tenantId: string, dto: UpdateUserDto, callerRole?: string): Promise<User> {
    const user = await this.findById(id);
    // super_admin can update any user; others only their own tenant
    if (callerRole !== 'super_admin' && user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 12);
    }
    // Only admins can change name fields and RUT
    const canEditIdentity = callerRole === 'super_admin' || callerRole === 'tenant_admin';
    if (dto.firstName !== undefined && canEditIdentity) user.firstName = dto.firstName;
    if (dto.lastName !== undefined && canEditIdentity) user.lastName = dto.lastName;
    if (dto.rut !== undefined && canEditIdentity) user.rut = dto.rut || null;
    // Only super_admin can change email (it's the login credential)
    if (dto.email !== undefined && callerRole === 'super_admin') user.email = dto.email;
    // Only super_admin and tenant_admin can change roles
    if (dto.role !== undefined) {
      const canChangeRole = callerRole === 'super_admin' || callerRole === 'tenant_admin';
      if (canChangeRole) {
        user.role = dto.role;
      }
      // Silently ignore role changes from unauthorized users
    }
    if (dto.managerId !== undefined) {
      if (dto.managerId) {
        const mgr = await this.userRepository.findOne({ where: { id: dto.managerId, tenantId: user.tenantId } });
        if (!mgr) throw new NotFoundException('Jefatura no encontrada en esta organización');
        // Validate hierarchy: manager level must be lower number (higher rank)
        const effectiveLevel = dto.hierarchyLevel ?? user.hierarchyLevel;
        if (effectiveLevel && mgr.hierarchyLevel && mgr.hierarchyLevel >= effectiveLevel) {
          throw new BadRequestException(
            `La jefatura seleccionada (${mgr.firstName} ${mgr.lastName}, Nv.${mgr.hierarchyLevel}) debe tener un nivel jerárquico superior (número menor) al colaborador (Nv.${effectiveLevel}).`,
          );
        }
      }
      user.managerId = dto.managerId;
    }

    // Track department/position changes as internal movements
    const prevDept = user.department;
    const prevPos = user.position;
    if (dto.department !== undefined) user.department = dto.department;
    if (dto.position !== undefined) user.position = dto.position;

    // Auto-create movement records for dept/position changes
    const deptChanged = dto.department !== undefined && dto.department !== prevDept;
    const posChanged = dto.position !== undefined && dto.position !== prevPos;
    if (deptChanged || posChanged) {
      const mType = deptChanged && posChanged ? MovementType.LATERAL_TRANSFER
        : deptChanged ? MovementType.DEPARTMENT_CHANGE
        : MovementType.POSITION_CHANGE;
      this.movementRepo.save(this.movementRepo.create({
        tenantId: user.tenantId,
        userId: user.id,
        movementType: mType,
        effectiveDate: new Date(),
        fromDepartment: prevDept || null,
        toDepartment: dto.department || user.department || null,
        fromPosition: prevPos || null,
        toPosition: dto.position || user.position || null,
      })).catch(() => {}); // fire-and-forget, don't block update
      this.auditService.log(user.tenantId, user.id, deptChanged ? 'user.department_changed' : 'user.position_changed', 'user', user.id, {
        from: { department: prevDept, position: prevPos },
        to: { department: user.department, position: user.position },
      }).catch(() => {});
    }

    if (dto.hierarchyLevel !== undefined) user.hierarchyLevel = dto.hierarchyLevel;
    if (dto.hireDate !== undefined) user.hireDate = new Date(dto.hireDate);
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    // Demographic fields
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.birthDate !== undefined) user.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    if (dto.nationality !== undefined) user.nationality = dto.nationality;
    if (dto.seniorityLevel !== undefined) user.seniorityLevel = dto.seniorityLevel;
    if (dto.contractType !== undefined) user.contractType = dto.contractType;
    if (dto.workLocation !== undefined) user.workLocation = dto.workLocation;
    if (dto.language !== undefined) user.language = dto.language;

    const saved = await this.userRepository.save(user);
    // Auto-add custom position to catalog if position/level changed
    if (dto.position !== undefined || dto.hierarchyLevel !== undefined) {
      this.autoAddPositionToCatalog(user.tenantId, saved.position, saved.hierarchyLevel).catch(() => {});
    }
    return saved;
  }

  async remove(id: string, tenantId: string, callerRole?: string): Promise<void> {
    const user = await this.findById(id);
    if (callerRole !== 'super_admin' && user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }
    user.isActive = false;
    await this.userRepository.save(user);
    this.auditService.log(tenantId, id, 'user.deactivated', 'user', id).catch(() => {});
  }

  // ─── Departure Tracking ────────────────────────────────────────────────

  async registerDeparture(
    userId: string,
    tenantId: string,
    dto: CreateDepartureDto,
    processedById: string,
  ): Promise<UserDeparture> {
    const user = await this.findById(userId);
    if (user.tenantId !== tenantId) throw new NotFoundException('Usuario no encontrado');
    if (!user.isActive) throw new BadRequestException('El usuario ya está inactivo');

    // Create departure record
    const departure = this.departureRepo.create({
      tenantId,
      userId,
      departureDate: new Date(dto.departureDate),
      departureType: dto.departureType,
      isVoluntary: dto.isVoluntary,
      reasonCategory: dto.reasonCategory || null,
      reasonDetail: dto.reasonDetail || null,
      lastDepartment: user.department || null,
      lastPosition: user.position || null,
      wouldRehire: dto.wouldRehire ?? null,
      processedBy: processedById,
    });
    const saved = await this.departureRepo.save(departure);

    // Deactivate user
    user.isActive = false;
    user.departureDate = new Date(dto.departureDate);
    await this.userRepository.save(user);

    // Audit
    await this.auditService.log(tenantId, processedById, 'user.departed', 'user', userId, {
      departureType: dto.departureType,
      isVoluntary: dto.isVoluntary,
      reasonCategory: dto.reasonCategory,
      lastDepartment: user.department,
      lastPosition: user.position,
    }).catch(() => {});

    return saved;
  }

  async getUserDepartures(userId: string, tenantId: string): Promise<UserDeparture[]> {
    return this.departureRepo.find({
      where: { userId, tenantId },
      order: { departureDate: 'DESC' },
    });
  }

  // ─── Internal Movement Tracking ────────────────────────────────────────

  async registerMovement(
    userId: string,
    tenantId: string,
    dto: CreateMovementDto,
    approvedById?: string,
  ): Promise<UserMovement> {
    const user = await this.findById(userId);
    if (user.tenantId !== tenantId) throw new NotFoundException('Usuario no encontrado');

    const movement = this.movementRepo.create({
      tenantId,
      userId,
      movementType: dto.movementType,
      effectiveDate: new Date(dto.effectiveDate),
      fromDepartment: dto.fromDepartment || user.department || null,
      toDepartment: dto.toDepartment || null,
      fromPosition: dto.fromPosition || user.position || null,
      toPosition: dto.toPosition || null,
      reason: dto.reason || null,
      approvedBy: approvedById || null,
    });
    const saved = await this.movementRepo.save(movement);

    this.auditService.log(tenantId, userId, 'user.movement_registered', 'user', userId, {
      movementType: dto.movementType,
      from: { department: movement.fromDepartment, position: movement.fromPosition },
      to: { department: movement.toDepartment, position: movement.toPosition },
    }).catch(() => {});

    return saved;
  }

  async getUserMovements(userId: string, tenantId: string): Promise<UserMovement[]> {
    return this.movementRepo.find({
      where: { userId, tenantId },
      order: { effectiveDate: 'DESC' },
      relations: ['user'],
    });
  }

  // ─── Bulk Import ──────────────────────────────────────────────────────────

  async bulkImport(
    tenantId: string,
    csvData: string,
    uploadedBy: string,
  ): Promise<BulkImport> {
    const MAX_IMPORT_ROWS = 500;
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      throw new ConflictException('El CSV debe tener al menos una fila de datos');
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const dataLines = lines.slice(1);

    // Limit max rows to prevent performance issues
    if (dataLines.length > MAX_IMPORT_ROWS) {
      throw new ConflictException(
        `El CSV tiene ${dataLines.length} filas. El máximo permitido es ${MAX_IMPORT_ROWS}. Divida el archivo en lotes más pequeños.`,
      );
    }

    // Validate subscription plan user limit BEFORE processing
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (sub?.plan) {
      const currentCount = await this.userRepository.count({ where: { tenantId, isActive: true } });
      const projectedTotal = currentCount + dataLines.length;
      if (projectedTotal > sub.plan.maxEmployees) {
        const available = sub.plan.maxEmployees - currentCount;
        throw new ForbiddenException(
          `La importación excede el límite del plan "${sub.plan.name}". ` +
          `Usuarios actuales: ${currentCount}, CSV: ${dataLines.length} filas, ` +
          `Máximo permitido: ${sub.plan.maxEmployees}. Disponibles: ${Math.max(0, available)}.`,
        );
      }
    }

    const bulkImport = this.bulkImportRepo.create({
      tenantId,
      type: 'users',
      status: ImportStatus.PROCESSING,
      totalRows: dataLines.length,
      uploadedBy,
    });
    const saved = await this.bulkImportRepo.save(bulkImport);

    const errors: { row: number; message: string }[] = [];
    let successCount = 0;

    const emailIdx = header.indexOf('email');
    const firstNameIdx = header.indexOf('first_name');
    const lastNameIdx = header.indexOf('last_name');
    const roleIdx = header.indexOf('role');
    const departmentIdx = header.indexOf('department');
    const positionIdx = header.indexOf('position');
    const managerEmailIdx = header.indexOf('manager_email');
    const hireDateIdx = header.indexOf('hire_date');
    const hierarchyLevelIdx = header.indexOf('hierarchy_level');
    const rutIdx = header.indexOf('rut');
    // Demographic columns
    const genderIdx = header.indexOf('gender');
    const birthDateIdx = header.indexOf('birth_date');
    const nationalityIdx = header.indexOf('nationality');
    const seniorityIdx = header.indexOf('seniority_level');
    const contractIdx = header.indexOf('contract_type');
    const locationIdx = header.indexOf('work_location');

    if (emailIdx === -1 || firstNameIdx === -1 || lastNameIdx === -1) {
      saved.status = ImportStatus.FAILED;
      saved.errors = [{ row: 0, message: 'CSV debe contener columnas: email, first_name, last_name' }];
      return this.bulkImportRepo.save(saved);
    }

    // Load configured departments once for validation
    const configuredDepts = await this.getConfiguredDepartments(tenantId);
    const normDept = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const validDeptSet = new Set(configuredDepts.map(normDept));

    for (let i = 0; i < dataLines.length; i++) {
      const cols = dataLines[i].split(',').map((c) => c.trim());
      const rowNum = i + 2; // 1-indexed, skip header

      try {
        const email = cols[emailIdx];
        const firstName = cols[firstNameIdx];
        const lastName = cols[lastNameIdx];

        const department = departmentIdx >= 0 ? (cols[departmentIdx] || '').trim() : '';
        const position = positionIdx >= 0 ? (cols[positionIdx] || '').trim() : '';

        if (!email || !firstName || !lastName) {
          errors.push({ row: rowNum, message: 'email, nombre y apellido son requeridos' });
          continue;
        }

        if (!department) {
          errors.push({ row: rowNum, message: 'Departamento es requerido' });
          continue;
        }

        if (!position) {
          errors.push({ row: rowNum, message: 'Cargo es requerido' });
          continue;
        }

        // Check email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push({ row: rowNum, message: `Email inválido: ${email}` });
          continue;
        }

        // Check duplicate
        const existing = await this.findByEmail(email, tenantId);
        if (existing) {
          errors.push({ row: rowNum, message: `Email duplicado: ${email}` });
          continue;
        }

        const role = roleIdx >= 0 ? (cols[roleIdx] || 'employee') : 'employee';
        const validRoles = ['employee', 'manager', 'tenant_admin', 'external'];
        if (!validRoles.includes(role)) {
          errors.push({ row: rowNum, message: `Rol inválido: ${role}` });
          continue;
        }

        // Validate department against configured list
        if (department && !validDeptSet.has(normDept(department))) {
          errors.push({ row: rowNum, message: `Departamento no válido: "${department}". Valores permitidos: ${configuredDepts.join(', ')}` });
          continue;
        }

        // Resolve manager
        let managerId: string | undefined;
        if (managerEmailIdx >= 0 && cols[managerEmailIdx]) {
          const manager = await this.findByEmail(cols[managerEmailIdx], tenantId);
          if (manager) {
            managerId = manager.id;
          }
        }

        // Validate and normalize RUT if provided
        let parsedRut: string | null = null;
        const rawRut = rutIdx >= 0 ? (cols[rutIdx] || '').trim() : '';
        if (rawRut) {
          const normalized = normalizeRut(rawRut);
          if (!validateRut(normalized)) {
            errors.push({ row: rowNum, message: `RUT inválido: ${rawRut}` });
            continue;
          }
          parsedRut = normalized;
        }

        const tempPassword = 'EvaPro2026!';
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        // Parse hierarchy level from CSV or lookup from position catalog
        let hierarchyLevel: number | undefined;
        if (hierarchyLevelIdx >= 0 && cols[hierarchyLevelIdx]) {
          const parsed = parseInt(cols[hierarchyLevelIdx]);
          if (!isNaN(parsed) && parsed >= 1) hierarchyLevel = parsed;
        }
        // If no level from CSV but position exists in catalog, use catalog level
        if (!hierarchyLevel && position) {
          const posNorm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
          const posCatalog: { name: string; level: number }[] = tenant?.settings?.positions || [];
          const match = posCatalog.find(p => posNorm(p.name) === posNorm(position));
          if (match) hierarchyLevel = match.level;
        }

        // Parse demographic fields (all optional, validate enums)
        const validGenders = ['masculino', 'femenino', 'no_binario', 'prefiero_no_decir'];
        const validSeniority = ['junior', 'mid', 'senior', 'lead', 'director', 'executive'];
        const validContract = ['indefinido', 'plazo_fijo', 'honorarios', 'practicante'];
        const validLocation = ['oficina', 'remoto', 'hibrido'];

        const rawGender = genderIdx >= 0 ? (cols[genderIdx] || '').trim().toLowerCase() : '';
        const rawBirthDate = birthDateIdx >= 0 ? (cols[birthDateIdx] || '').trim() : '';
        const rawNationality = nationalityIdx >= 0 ? (cols[nationalityIdx] || '').trim() : '';
        const rawSeniority = seniorityIdx >= 0 ? (cols[seniorityIdx] || '').trim().toLowerCase() : '';
        const rawContract = contractIdx >= 0 ? (cols[contractIdx] || '').trim().toLowerCase() : '';
        const rawLocation = locationIdx >= 0 ? (cols[locationIdx] || '').trim().toLowerCase() : '';

        const savedUser = await this.userRepository.save(
          this.userRepository.create({
            tenantId,
            email,
            firstName,
            lastName,
            passwordHash,
            role,
            managerId,
            rut: parsedRut,
            department: department || undefined,
            position: position || undefined,
            hierarchyLevel: hierarchyLevel || undefined,
            hireDate: hireDateIdx >= 0 && cols[hireDateIdx] ? new Date(cols[hireDateIdx]) : undefined,
            gender: validGenders.includes(rawGender) ? rawGender : undefined,
            birthDate: rawBirthDate ? new Date(rawBirthDate) : undefined,
            nationality: rawNationality || undefined,
            seniorityLevel: validSeniority.includes(rawSeniority) ? rawSeniority : undefined,
            contractType: validContract.includes(rawContract) ? rawContract : undefined,
            workLocation: validLocation.includes(rawLocation) ? rawLocation : undefined,
            isActive: true,
            mustChangePassword: true,
          }),
        );
        // Auto-add custom position to catalog
        if (position && hierarchyLevel) {
          this.autoAddPositionToCatalog(tenantId, position, hierarchyLevel).catch(() => {});
        }
        successCount++;
      } catch (err) {
        errors.push({ row: rowNum, message: `Error: ${(err as Error).message}` });
      }
    }

    saved.successRows = successCount;
    saved.errorRows = errors.length;
    saved.errors = errors.length > 0 ? errors : null;
    saved.status = errors.length === dataLines.length ? ImportStatus.FAILED : ImportStatus.COMPLETED;

    await this.auditService.log(tenantId, uploadedBy, 'users.bulk_imported', 'bulk_import', saved.id, {
      totalRows: dataLines.length,
      successRows: successCount,
      errorRows: errors.length,
    });

    return this.bulkImportRepo.save(saved);
  }

  async getBulkImport(id: string, tenantId: string): Promise<BulkImport> {
    const imp = await this.bulkImportRepo.findOne({ where: { id, tenantId } });
    if (!imp) throw new NotFoundException('Importación no encontrada');
    return imp;
  }

  // ─── User Notes (HR Reports) ───────────────────────────────────────────────

  async listNotes(tenantId: string, userId: string, requesterRole?: string): Promise<UserNote[]> {
    const where: any = { tenantId, userId };
    // Gap 2: Managers only see non-confidential notes; admins see all
    if (requesterRole === 'manager') {
      where.isConfidential = false;
    }
    return this.noteRepo.find({
      where,
      relations: ['author'],
      order: { createdAt: 'DESC' },
    });
  }

  async createNote(
    tenantId: string,
    userId: string,
    authorId: string,
    data: { title: string; content: string; category?: string; isConfidential?: boolean },
  ): Promise<UserNote> {
    const note = this.noteRepo.create({
      tenantId,
      userId,
      authorId,
      title: data.title,
      content: data.content,
      category: data.category || 'general',
      isConfidential: data.isConfidential || false,
    });
    return this.noteRepo.save(note);
  }

  async updateNote(
    noteId: string,
    tenantId: string,
    data: { title?: string; content?: string; category?: string; isConfidential?: boolean },
  ): Promise<UserNote> {
    const note = await this.noteRepo.findOne({ where: { id: noteId, tenantId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    if (data.title !== undefined) note.title = data.title;
    if (data.content !== undefined) note.content = data.content;
    if (data.category !== undefined) note.category = data.category;
    if (data.isConfidential !== undefined) note.isConfidential = data.isConfidential;
    return this.noteRepo.save(note);
  }

  async deleteNote(noteId: string, tenantId: string): Promise<void> {
    const note = await this.noteRepo.findOne({ where: { id: noteId, tenantId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    await this.noteRepo.remove(note);
  }

  // ─── Invitations ─────────────────────────────────────────────────────────

  async resendInvite(tenantId: string, userId: string): Promise<{ ok: boolean }> {
    const user = await this.userRepository.findOne({
      where: { id: userId, tenantId },
      relations: ['tenant'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!';
    user.passwordHash = await bcrypt.hash(tempPassword, 12);
    await this.userRepository.save(user);

    await this.notificationsService.sendInvitation(
      user.email,
      user.tenant?.name || 'EvaPro',
      { firstName: user.firstName, tempPassword },
    ).catch(() => {});

    await this.auditService.log(tenantId, userId, 'user.invite_resent', 'user', userId);
    return { ok: true };
  }

  async inviteBulk(
    tenantId: string,
    emails: string[],
    role = 'employee',
  ): Promise<{ invited: number; skipped: string[] }> {
    const tenant = await this.userRepository.manager
      .getRepository('tenants')
      .findOne({ where: { id: tenantId } }) as any;
    const orgName = tenant?.name || 'EvaPro';

    const skipped: string[] = [];
    let invited = 0;

    for (const rawEmail of emails) {
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes('@')) { skipped.push(email); continue; }

      const existing = await this.userRepository.findOne({ where: { email, tenantId } });
      if (existing) { skipped.push(email); continue; }

      const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!';
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const firstName = email.split('@')[0];

      const newUser = this.userRepository.create({
        tenantId, email, firstName, lastName: '',
        passwordHash, role: role as any, isActive: true, mustChangePassword: true,
      });
      const saved = await this.userRepository.save(newUser);

      await this.notificationsService.sendInvitation(email, orgName, { firstName, tempPassword }).catch(() => {});
      await this.auditService.log(tenantId, saved.id, 'user.invited', 'user', saved.id);
      invited++;
    }

    return { invited, skipped };
  }

  // ─── Generate fake RUTs for users without one ─────────────────────────

  private generateValidRut(base: number): string {
    const body = String(base);
    const digits = body.split('').reverse().map(Number);
    const series = [2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      sum += digits[i] * series[i % series.length];
    }
    const remainder = 11 - (sum % 11);
    const dv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
    return `${body}-${dv}`;
  }

  /**
   * Normalize user departments: find users whose department doesn't match
   * any value in the tenant's configured department list (Mantenedores).
   * Returns a preview of mismatches or applies fixes with closest match.
   */
  async normalizeDepartments(tenantId: string, apply = false): Promise<{
    mismatches: { userId: string; name: string; current: string; suggested: string | null }[];
    fixed: number;
  }> {
    // Get configured departments
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    const configuredDepts: string[] = tenant.settings?.departments ?? [];
    if (configuredDepts.length === 0) {
      return { mismatches: [], fixed: 0 };
    }

    // Get all users with a department set
    const users = await this.userRepository.find({
      where: { tenantId, isActive: true },
      select: ['id', 'firstName', 'lastName', 'department'],
    });

    const lowerConfigured = configuredDepts.map(d => d.toLowerCase().trim());

    const mismatches: { userId: string; name: string; current: string; suggested: string | null }[] = [];
    for (const u of users) {
      if (!u.department) continue;
      const dept = u.department.trim();
      const idx = lowerConfigured.indexOf(dept.toLowerCase());
      if (idx >= 0) {
        // Exact match (case-insensitive) — fix casing if different
        if (dept !== configuredDepts[idx]) {
          mismatches.push({
            userId: u.id,
            name: `${u.firstName} ${u.lastName}`,
            current: dept,
            suggested: configuredDepts[idx],
          });
        }
        continue;
      }
      // No exact match — try partial match
      const partial = configuredDepts.find(cd =>
        cd.toLowerCase().includes(dept.toLowerCase()) || dept.toLowerCase().includes(cd.toLowerCase()),
      );
      mismatches.push({
        userId: u.id,
        name: `${u.firstName} ${u.lastName}`,
        current: dept,
        suggested: partial || null,
      });
    }

    let fixed = 0;
    if (apply) {
      for (const m of mismatches) {
        if (m.suggested) {
          await this.userRepository.update(m.userId, { department: m.suggested });
          fixed++;
        }
      }
    }

    return { mismatches, fixed };
  }

  // ─── Org Chart ──────────────────────────────────────────────────────

  async getOrgChart(tenantId: string): Promise<any[]> {
    // Exclude super_admin — it's a system account, not part of the org hierarchy
    const users = await this.userRepository.find({
      where: { tenantId, isActive: true, role: Not('super_admin') },
      select: ['id', 'firstName', 'lastName', 'position', 'hierarchyLevel', 'department', 'managerId', 'role'],
      order: { firstName: 'ASC' },
    });

    const map = new Map<string, any>();
    for (const u of users) {
      map.set(u.id, {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        position: u.position || null,
        level: u.hierarchyLevel || null,
        department: u.department || null,
        role: u.role,
        children: [],
      });
    }

    const roots: any[] = [];
    for (const u of users) {
      const node = map.get(u.id);
      if (u.managerId && map.has(u.managerId)) {
        map.get(u.managerId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort roots by hierarchy level (lower number = higher rank, nulls last)
    roots.sort((a, b) => (a.level || 999) - (b.level || 999));

    // Sort children at every level by hierarchy level
    const sortChildren = (node: any) => {
      if (node.children?.length) {
        node.children.sort((a: any, b: any) => (a.level || 999) - (b.level || 999));
        node.children.forEach(sortChildren);
      }
    };
    roots.forEach(sortChildren);

    return roots;
  }

  async fillFakeRuts(tenantId?: string): Promise<{ updated: number }> {
    const where: any = { rut: IsNull() };
    if (tenantId) where.tenantId = tenantId;

    const users = await this.userRepository.find({ where, select: ['id'] });
    if (users.length === 0) return { updated: 0 };

    // Generate unique RUTs starting from a random base in the 10M-25M range
    const startBase = 10_000_000 + Math.floor(Math.random() * 15_000_000);
    let updated = 0;

    for (let i = 0; i < users.length; i++) {
      const rut = this.generateValidRut(startBase + i);
      await this.userRepository.update(users[i].id, { rut });
      updated++;
    }

    return { updated };
  }
}
