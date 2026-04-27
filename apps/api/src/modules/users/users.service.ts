import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull, Not, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserNote } from './entities/user-note.entity';
import { UserDeparture } from './entities/user-departure.entity';
import { UserMovement, MovementType } from './entities/user-movement.entity';
import { BulkImport, ImportStatus } from './entities/bulk-import.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepartureDto } from './dto/create-departure.dto';
import { UpdateDepartureDto } from './dto/update-departure.dto';
import { ReactivateUserDto } from './dto/reactivate-user.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
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
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Position)
    private readonly positionRepo: Repository<Position>,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly dataSource: DataSource,
  ) {}

  private static readonly DEFAULT_DEPARTMENTS = [
    'Tecnología', 'Recursos Humanos', 'Ventas', 'Marketing',
    'Operaciones', 'Finanzas', 'Legal', 'Administración',
  ];

  private async getConfiguredDepartments(tenantId: string): Promise<string[]> {
    // Read from departments table first, fallback to JSONB settings
    const depts = await this.departmentRepo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    if (depts.length > 0) return depts.map(d => d.name);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return tenant?.settings?.departments ?? UsersService.DEFAULT_DEPARTMENTS;
  }

  /** Sync department/position tables → JSONB settings for backward compat (fire-and-forget) */
  private async syncDeptPosToSettings(tenantId: string): Promise<void> {
    try {
      const [depts, positions, tenant] = await Promise.all([
        this.departmentRepo.find({ where: { tenantId, isActive: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
        this.positionRepo.find({ where: { tenantId, isActive: true }, order: { level: 'ASC', name: 'ASC' } }),
        this.tenantRepo.findOne({ where: { id: tenantId } }),
      ]);
      if (!tenant) return;
      tenant.settings = {
        ...(tenant.settings || {}),
        departments: depts.map(d => d.name),
        positions: positions.map(p => ({ name: p.name, level: p.level })),
      };
      await this.tenantRepo.save(tenant);
    } catch { /* fire-and-forget */ }
  }

  /**
   * Dual-write helper: resolves departmentId ↔ department text bidirectionally.
   * If departmentId is provided → look up name. If only department text → look up or create record.
   */
  private async resolveDepartment(tenantId: string, departmentId?: string | null, departmentName?: string | null): Promise<{ departmentId: string | null; department: string | null }> {
    if (departmentId) {
      const dept = await this.departmentRepo.findOne({ where: { id: departmentId, tenantId } });
      if (dept) return { departmentId: dept.id, department: dept.name };
      // ID not found — fall through to text lookup
    }
    if (departmentName?.trim()) {
      const trimmed = departmentName.trim();
      const dept = await this.departmentRepo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name: trimmed })
        .getOne();
      if (dept) {
        if (!dept.isActive) { dept.isActive = true; await this.departmentRepo.save(dept); }
        return { departmentId: dept.id, department: dept.name };
      }
      // Not in table — create it (ensures FK consistency)
      try {
        const newDept = await this.departmentRepo.save(this.departmentRepo.create({
          tenantId, name: trimmed, isActive: true,
        }));
        return { departmentId: newDept.id, department: newDept.name };
      } catch {
        // Unique constraint race — try lookup again
        const retry = await this.departmentRepo
          .createQueryBuilder('d')
          .where('d.tenant_id = :tenantId', { tenantId })
          .andWhere('LOWER(d.name) = LOWER(:name)', { name: trimmed })
          .getOne();
        if (retry) return { departmentId: retry.id, department: retry.name };
        return { departmentId: null, department: trimmed };
      }
    }
    return { departmentId: null, department: null };
  }

  /**
   * Dual-write helper: resolves positionId ↔ position text bidirectionally.
   */
  private async resolvePosition(tenantId: string, positionId?: string | null, positionName?: string | null): Promise<{ positionId: string | null; position: string | null; hierarchyLevel: number | null }> {
    if (positionId) {
      const pos = await this.positionRepo.findOne({ where: { id: positionId, tenantId } });
      if (pos) return { positionId: pos.id, position: pos.name, hierarchyLevel: pos.level };
    }
    if (positionName?.trim()) {
      const trimmed = positionName.trim();
      const pos = await this.positionRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name: trimmed })
        .getOne();
      if (pos) {
        if (!pos.isActive) { pos.isActive = true; await this.positionRepo.save(pos); }
        return { positionId: pos.id, position: pos.name, hierarchyLevel: pos.level };
      }
      // Not in table — create it
      try {
        const newPos = await this.positionRepo.save(this.positionRepo.create({
          tenantId, name: trimmed, level: 0, isActive: true,
        }));
        return { positionId: newPos.id, position: newPos.name, hierarchyLevel: newPos.level };
      } catch {
        const retry = await this.positionRepo
          .createQueryBuilder('p')
          .where('p.tenant_id = :tenantId', { tenantId })
          .andWhere('LOWER(p.name) = LOWER(:name)', { name: trimmed })
          .getOne();
        if (retry) return { positionId: retry.id, position: retry.name, hierarchyLevel: retry.level };
        return { positionId: null, position: trimmed, hierarchyLevel: null };
      }
    }
    return { positionId: null, position: null, hierarchyLevel: null };
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

  /**
   * P6.2 — Guard de acceso por rol para endpoints detail (perfil, notas,
   * movimientos, desvinculaciones, etc.).
   *
   *   - super_admin / tenant_admin  → siempre pasan (admin del tenant).
   *   - employee                    → solo puede ver su propio perfil (self).
   *   - manager                     → sus reportes directos + self.
   *
   * Siempre retorna 404 (no 403) para no filtrar existencia de IDs
   * cross-tenant o cross-equipo. Consistente con el patrón del resto del
   * API (findByIdScoped también tira 404 en mismatch de tenant).
   */
  async assertCanAccessUser(
    callerUserId: string,
    callerRole: string,
    targetUserId: string,
    tenantId: string | undefined,
  ): Promise<User> {
    const target = await this.findByIdScoped(targetUserId, tenantId);

    if (callerRole === 'super_admin' || callerRole === 'tenant_admin') {
      return target;
    }
    if (callerUserId === targetUserId) {
      // Self-access siempre permitido (perfil propio, notas propias, etc.)
      return target;
    }
    if (callerRole === 'manager' && target.managerId === callerUserId) {
      return target;
    }
    // employee con target != self, o manager con user que no es su reporte.
    throw new NotFoundException('Usuario no encontrado');
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    page = 1,
    limit = 50,
    filters?: { search?: string; department?: string; departmentId?: string; role?: string; position?: string; status?: string },
    // P6.1 — Scope por rol del caller. Opcionales para backward compat
    // con callers internos (crons, imports, etc.) que no pasan estos
    // params y siguen viendo toda la lista.
    callerRole?: string,
    callerUserId?: string,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const qb = this.userRepository.createQueryBuilder('user')
      .where('user.tenantId = :tenantId', { tenantId })
      .andWhere('user.role != :excluded', { excluded: 'super_admin' });

    // P6.1 — Scope manager a sus reportes directos + self.
    // Sin esto, un manager podría listar TODOS los users del tenant via
    // `?search=foo` y obtener info sensible. El filtro aplica ANTES de
    // los demás filtros de búsqueda/paginación para que el counter total
    // también quede scoped al equipo del manager.
    if (callerRole === 'manager' && callerUserId) {
      qb.andWhere(
        '(user.managerId = :callerUserId OR user.id = :callerUserId)',
        { callerUserId },
      );
    }

    // P9 audit colaborador — employees y external ven una vista REDUCIDA
    // del directorio. Sin esto, employee podía listar todos los users del
    // tenant con demographic (gender, birthDate, nationality), seniority,
    // contractType, rut, hireDate — campos sensibles que otros colegas
    // no deben ver. La lista sigue siendo útil para buscar a quién dar
    // feedback/reconocimientos: nombre, email, cargo, departamento.
    if (callerRole === 'employee' || callerRole === 'external') {
      qb.select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.position',
        'user.positionId',
        'user.department',
        'user.departmentId',
        'user.role',
        'user.managerId',
        'user.isActive',
        'user.language',
      ]);
    }

    if (filters?.search) {
      qb.andWhere(
        '(LOWER(user.first_name) LIKE :search OR LOWER(user.last_name) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: `%${filters.search.toLowerCase()}%` },
      );
    }
    if (filters?.departmentId) {
      qb.andWhere('user.department_id = :departmentId', { departmentId: filters.departmentId });
    } else if (filters?.department) {
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

    // Resolve department: dual-write (ID ↔ text)
    const resolvedDept = await this.resolveDepartment(tenantId, dto.departmentId, dto.department);

    // Validate department against configured list (only if text-based, skip if by ID)
    if (!dto.departmentId && resolvedDept.department) {
      const configuredDepts = await this.getConfiguredDepartments(tenantId);
      this.validateDepartment(resolvedDept.department, configuredDepts);
    }

    // Resolve position: dual-write (ID ↔ text)
    const resolvedPos = await this.resolvePosition(tenantId, dto.positionId, dto.position);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const userData: any = {
      tenantId,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash,
      rut: dto.rut || null,
      role: dto.role ?? 'employee',
      managerId: dto.managerId,
      department: resolvedDept.department,
      departmentId: resolvedDept.departmentId,
      position: resolvedPos.position,
      positionId: resolvedPos.positionId,
      hierarchyLevel: dto.hierarchyLevel ?? resolvedPos.hierarchyLevel ?? null,
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      isActive: true,
      mustChangePassword: true,
    };

    const user = this.userRepository.create(userData as Partial<User>);
    const saved = await this.userRepository.save(user) as User;
    await this.auditService.log(tenantId, saved.id, 'user.created', 'user', saved.id);
    // Sync department/position tables → JSONB settings (backward compat)
    this.syncDeptPosToSettings(tenantId).catch(() => {});
    return saved;
  }

  async updateCv(userId: string, tenantId: string, cvUrl: string | null, cvFileName: string | null): Promise<void> {
    await this.userRepository.update({ id: userId, tenantId }, { cvUrl, cvFileName });
  }

  async update(id: string, tenantId: string | undefined, dto: UpdateUserDto, callerRole?: string, callerUserId?: string): Promise<User> {
    const user = await this.findById(id);
    // super_admin can update any user (tenantId=undefined); others only their own tenant.
    if (callerRole !== 'super_admin' && user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }
    // Non-admin callers can ONLY update their own profile. Without this check
    // an `employee` or `manager` could PATCH another user's managerId /
    // departmentId / password since the controller does not restrict by role.
    const isAdmin = callerRole === 'super_admin' || callerRole === 'tenant_admin';
    if (!isAdmin && callerUserId && id !== callerUserId) {
      throw new ForbiddenException('Solo puede editar su propio perfil');
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

    // Dual-write: resolve department
    if (dto.departmentId !== undefined || dto.department !== undefined) {
      const resolved = await this.resolveDepartment(user.tenantId, dto.departmentId, dto.department ?? user.department);
      user.department = resolved.department as any;
      user.departmentId = resolved.departmentId as any;
    }
    // Dual-write: resolve position
    if (dto.positionId !== undefined || dto.position !== undefined) {
      const resolved = await this.resolvePosition(user.tenantId, dto.positionId, dto.position ?? user.position);
      user.position = resolved.position as any;
      user.positionId = resolved.positionId as any;
      if (resolved.hierarchyLevel !== null && dto.hierarchyLevel === undefined) {
        user.hierarchyLevel = resolved.hierarchyLevel;
      }
    }

    // Auto-create movement records for dept/position changes (detect both text and ID changes)
    const deptChanged = user.department !== prevDept;
    const posChanged = user.position !== prevPos;
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
      // Actor is the caller (manager/admin), target is the edited user.
      // Fallback to target user when caller wasn't passed (legacy paths).
      this.auditService.log(
        user.tenantId,
        callerUserId || user.id,
        deptChanged ? 'user.department_changed' : 'user.position_changed',
        'user',
        user.id,
        {
          from: { department: prevDept, position: prevPos },
          to: { department: user.department, position: user.position },
        },
      ).catch(() => {});
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
    // Sync tables → JSONB if department or position changed
    if (dto.department !== undefined || dto.departmentId !== undefined || dto.position !== undefined || dto.positionId !== undefined) {
      this.syncDeptPosToSettings(user.tenantId).catch(() => {});
    }
    return saved;
  }

  /**
   * Soft-delete con cascada esencial en una transacción (P1.8).
   *
   * Antes: solo hacía `isActive = false` + audit. Dejaba datos huérfanos:
   *   - Objectives activos del user seguían en estado 'active' apuntando
   *     a un user desactivado → aparecían en reports ejecutivos
   *   - Checkins scheduled/requested no se cancelaban → manager/employee
   *     recibía notificaciones de sesiones con un user muerto
   *   - Evaluation assignments pending quedaban colgados → el ciclo no
   *     podía cerrar limpiamente
   *   - Notifications unread del user se acumulaban para siempre
   *   - JWT del user seguía válido (tokenVersion no bumpeado)
   *
   * Ahora: transacción atómica con cascada. Para el flow RRHH formal
   * (registerDeparture) hay cascada MÁS completa con PDI + calibration +
   * recruitment. Acá solo lo esencial para un soft-delete "simple".
   */
  async remove(id: string, tenantId: string | undefined, callerRole?: string): Promise<void> {
    const user = await this.findById(id);
    if (callerRole !== 'super_admin' && user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }
    // targetTenantId se deriva del user (authoritative). Los downstream side-effects
    // (audit log, cascade, notifications) deben usar este, no el parámetro tenantId.
    const targetTenantId = user.tenantId;
    const targetUserId = user.id;

    // safeExec: ignora errores de "tabla/columna no existe" (primer deploy)
    // pero propaga cualquier otro error para que la transacción haga rollback.
    const cascadeStats = await this.dataSource.transaction(async (em) => {
      const safeExec = async (sql: string, params: any[]): Promise<number> => {
        try {
          const res: any = await em.query(sql, params);
          if (Array.isArray(res) && res.length === 2 && typeof res[1] === 'number') return res[1];
          if (res && typeof res.rowCount === 'number') return res.rowCount;
          if (res && typeof res.affected === 'number') return res.affected;
          return 0;
        } catch (err) {
          const msg = (err as any)?.message || '';
          if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('column')) {
            return 0;
          }
          throw err;
        }
      };

      // 1. Desactivar + invalidar JWTs + limpiar 2FA (un solo UPDATE atómico)
      await em
        .createQueryBuilder()
        .update(User)
        .set({
          isActive: false,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          tokenVersion: () => '"token_version" + 1',
        })
        .where('id = :id', { id: targetUserId })
        .execute();

      // 2. Objectives del user → abandoned
      const objectivesAbandoned = await safeExec(
        `UPDATE objectives SET status = 'abandoned', updated_at = NOW()
           WHERE user_id = $1 AND tenant_id = $2
             AND status IN ('draft', 'pending_approval', 'active')`,
        [targetUserId, targetTenantId],
      );

      // 3. Checkins donde es manager o employee → cancelled
      const checkinsCancelled = await safeExec(
        `UPDATE checkins SET status = 'cancelled', updated_at = NOW()
           WHERE tenant_id = $1
             AND status IN ('requested', 'scheduled')
             AND (manager_id = $2 OR employee_id = $2)`,
        [targetTenantId, targetUserId],
      );

      // 4. Evaluation assignments pending/in_progress → cancelled
      const assignmentsCancelled = await safeExec(
        `UPDATE evaluation_assignments SET status = 'cancelled'
           WHERE tenant_id = $1
             AND status IN ('pending', 'in_progress')
             AND (evaluator_id = $2 OR evaluatee_id = $2)`,
        [targetTenantId, targetUserId],
      );

      // 5. Notifications unread del user → marcar como leídas (evita spam post-mortem)
      const notificationsArchived = await safeExec(
        `UPDATE notifications SET is_read = true, updated_at = NOW()
           WHERE user_id = $1 AND tenant_id = $2 AND is_read = false`,
        [targetUserId, targetTenantId],
      );

      return { objectivesAbandoned, checkinsCancelled, assignmentsCancelled, notificationsArchived };
    });

    this.auditService.log(targetTenantId, targetUserId, 'user.deactivated', 'user', targetUserId, {
      method: 'soft-delete_with_cascade',
      ...cascadeStats,
    }).catch(() => undefined);
  }

  // ─── Departure Tracking ────────────────────────────────────────────────

  /**
   * Registra una desvinculación con cascade atómico (transacción).
   *
   * ═══ Etapa A (seguridad / jerarquía) ═══
   *   1. Inserta UserDeparture (snapshot de dept/cargo al momento de la salida)
   *   2. Si dto.reassignToManagerId fue provisto: valida que sea manager/admin
   *      activo del mismo tenant, y reasigna todos los direct reports. Si no
   *      se provee, sus reportes quedan con managerId = null.
   *   3. Limpia 2FA (silent — el usuario ya no debe poder usar la cuenta)
   *   4. Desactiva user + setea departureDate
   *   5. Incrementa tokenVersion → invalida todos los JWTs emitidos
   *
   * ═══ Etapa B (trabajo en curso) ═══
   *   6. Objetivos del user (DRAFT/PENDING_APPROVAL/ACTIVE) → ABANDONED
   *   7. Desliga children: parent_objective_id = NULL en objetivos de OTROS
   *      users que apuntaban a objetivos recién abandonados
   *   8. DevelopmentPlans del user (borrador/activo/en_revision) → cancelado
   *   9. DevelopmentActions asignadas al user o en planes del user → cancelada
   *  10. CheckIns (manager_id o employee_id = user, requested/scheduled) → cancelled
   *  11. EvaluationAssignments (evaluator o evaluatee = user, pending/in_progress)
   *      → cancelled
   *  12. Notifications no-leídas del user → marked as read (archive)
   *  13. RecruitmentCandidates (candidate_type='internal', user_id=user, stage
   *      no-terminal) → rejected + recruiter_notes con razón
   *  14. CalibrationEntries (user_id=user, status != agreed) → status='withdrawn'
   *
   *  15. Audit log con metadata estructurada del cascade completo
   *
   * Si cualquier paso falla, toda la transacción hace rollback y el usuario
   * queda ACTIVE. El audit log es fire-and-forget post-commit (no crítico).
   */
  async registerDeparture(
    userId: string,
    inputTenantId: string | undefined,
    dto: CreateDepartureDto,
    processedById: string,
  ): Promise<UserDeparture> {
    const user = await this.findById(userId);
    // Validación: tenant_admin debe coincidir; super_admin (undefined) puede cross-tenant.
    if (inputTenantId !== undefined && user.tenantId !== inputTenantId) throw new NotFoundException('Usuario no encontrado');
    if (!user.isActive) throw new BadRequestException('El usuario ya está inactivo');
    // Shadow el parámetro: dentro del método todo queda scoped al tenant del user
    // (authoritative) para que todas las queries de cascade, audit y notifications
    // funcionen correctamente tanto para tenant_admin como super_admin cross-tenant.
    const tenantId = user.tenantId;

    // Validación pre-transacción del manager de reasignación (si se provee)
    let reassignManager: User | null = null;
    if (dto.reassignToManagerId) {
      if (dto.reassignToManagerId === userId) {
        throw new BadRequestException('No se puede reasignar reportes al propio usuario desvinculado');
      }
      reassignManager = await this.userRepository.findOne({
        where: { id: dto.reassignToManagerId, tenantId },
      });
      if (!reassignManager) {
        throw new BadRequestException('Manager de reasignación no encontrado en la organización');
      }
      if (!reassignManager.isActive) {
        throw new BadRequestException('El manager de reasignación está inactivo');
      }
      if (reassignManager.role !== 'manager' && reassignManager.role !== 'tenant_admin') {
        throw new BadRequestException('El usuario de reasignación no es manager ni admin');
      }
    }

    const departureDateObj = new Date(dto.departureDate);
    const snapshotDept = user.department || null;
    const snapshotPos = user.position || null;

    // Cascade atómico
    const cascadeResult =
      await this.dataSource.transaction(async (em) => {
        // ─── Etapa A ───────────────────────────────────────────────

        // 1. Departure record
        const departure = em.getRepository(UserDeparture).create({
          tenantId,
          userId,
          departureDate: departureDateObj,
          departureType: dto.departureType,
          isVoluntary: dto.isVoluntary,
          reasonCategory: dto.reasonCategory || null,
          reasonDetail: dto.reasonDetail || null,
          lastDepartment: snapshotDept,
          lastPosition: snapshotPos,
          wouldRehire: dto.wouldRehire ?? null,
          processedBy: processedById,
        });
        const saved = await em.getRepository(UserDeparture).save(departure);

        // 2. Reasignar direct reports
        const userRepo = em.getRepository(User);
        const newManagerId = dto.reassignToManagerId || null;
        const updateResult = await userRepo.update(
          { tenantId, managerId: userId, isActive: true },
          { managerId: newManagerId as any }, // TS: User.managerId is `string` but DB column is nullable
        );
        const reportsAffected = updateResult.affected ?? 0;

        // 3-5. Desactivar user + limpiar 2FA + bump tokenVersion (un solo UPDATE).
        // Se usa QueryBuilder para poder usar expresión SQL raw `token_version + 1`
        // de forma atómica en el mismo UPDATE (evita read-then-write race).
        const clearedTwoFactor = !!user.twoFactorEnabled || !!user.twoFactorSecret;
        await em
          .createQueryBuilder()
          .update(User)
          .set({
            isActive: false,
            departureDate: departureDateObj,
            twoFactorEnabled: false,
            twoFactorSecret: null,
            tokenVersion: () => '"token_version" + 1',
          })
          .where('id = :id', { id: userId })
          .execute();

        // ─── Etapa B (trabajo en curso) ───────────────────────────
        // Todos los UPDATEs se filtran por tenant_id para aislar multi-tenant
        // y por status para no tocar entidades ya en estado terminal.
        // Usamos em.query() con parámetros posicionales para simplicidad;
        // cada entidad que no exista (tabla ausente en primera corrida) se
        // maneja individualmente con try/catch para no abortar la transacción.

        /**
         * Ejecuta un UPDATE raw y retorna el número de filas afectadas.
         * TypeORM+pg devuelve `[rows, rowCount]` para UPDATEs simples, pero
         * algunos paths legacy devuelven sólo `rows` o un Result object.
         * Probamos varios formatos en orden; si ninguno encaja devolvemos 0
         * (la operación igualmente se ejecutó — sólo se pierde el contador).
         *
         * Si la tabla/columna no existe (primer deploy pre-sync) el error se
         * ignora. Cualquier otro error aborta la transacción.
         */
        const safeExec = async (sql: string, params: any[]): Promise<number> => {
          try {
            const res: any = await em.query(sql, params);
            if (Array.isArray(res) && res.length === 2 && typeof res[1] === 'number') {
              return res[1]; // [rows, rowCount]
            }
            if (res && typeof res.rowCount === 'number') {
              return res.rowCount; // pg Result object
            }
            if (res && typeof res.affected === 'number') {
              return res.affected; // TypeORM UpdateResult shape
            }
            return 0;
          } catch (err) {
            const msg = (err as any)?.message || '';
            if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('column')) {
              return 0;
            }
            throw err;
          }
        };

        // 6. Objetivos: abandonar los activos/draft/pending del user
        const objectivesAbandoned = await safeExec(
          `UPDATE objectives SET status = 'abandoned', updated_at = NOW()
             WHERE user_id = $1 AND tenant_id = $2
               AND status IN ('draft', 'pending_approval', 'active')`,
          [userId, tenantId],
        );

        // 7. Desligar children: objetivos de OTROS users que apuntaban a los
        //    objetivos recién abandonados → parent_objective_id = NULL
        const childrenDetached = await safeExec(
          `UPDATE objectives SET parent_objective_id = NULL, updated_at = NOW()
             WHERE tenant_id = $1
               AND parent_objective_id IN (
                 SELECT id FROM objectives
                  WHERE user_id = $2 AND tenant_id = $1 AND status = 'abandoned'
               )
               AND user_id <> $2`,
          [tenantId, userId],
        );

        // 8. DevelopmentPlans del user → cancelado
        const plansCancelled = await safeExec(
          `UPDATE development_plans SET status = 'cancelado', updated_at = NOW()
             WHERE user_id = $1 AND tenant_id = $2
               AND status IN ('borrador', 'activo', 'en_revision')`,
          [userId, tenantId],
        );

        // 9. DevelopmentActions en planes del user → cancelada.
        //    development_actions no tiene assigned_to_id; se scopea vía
        //    plan_id → plan.user_id (dueño del PDI).
        const actionsCancelled = await safeExec(
          `UPDATE development_actions SET status = 'cancelada', updated_at = NOW()
             WHERE tenant_id = $1
               AND status IN ('pendiente', 'en_progreso')
               AND plan_id IN (SELECT id FROM development_plans WHERE user_id = $2 AND tenant_id = $1)`,
          [tenantId, userId],
        );

        // 10. CheckIns: manager o employee = user, no-terminales → cancelled
        const checkinsCancelled = await safeExec(
          `UPDATE checkins SET status = 'cancelled', updated_at = NOW()
             WHERE tenant_id = $1
               AND status IN ('requested', 'scheduled')
               AND (manager_id = $2 OR employee_id = $2)`,
          [tenantId, userId],
        );

        // 11. EvaluationAssignments: evaluator o evaluatee = user, pending/in_progress
        const assignmentsCancelled = await safeExec(
          `UPDATE evaluation_assignments SET status = 'cancelled'
             WHERE tenant_id = $1
               AND status IN ('pending', 'in_progress')
               AND (evaluator_id = $2 OR evaluatee_id = $2)`,
          [tenantId, userId],
        );

        // 12. Notifications no-leídas del user → marcar como leídas
        //     (Notification entity no tiene read_at; updated_at lo registra TypeORM)
        const notificationsArchived = await safeExec(
          `UPDATE notifications SET is_read = true, updated_at = NOW()
             WHERE user_id = $1 AND tenant_id = $2 AND is_read = false`,
          [userId, tenantId],
        );

        // 13. RecruitmentCandidates: candidaturas internas activas → rejected
        const candidaturesRejected = await safeExec(
          `UPDATE recruitment_candidates
              SET stage = 'rejected',
                  recruiter_notes = COALESCE(recruiter_notes, '') ||
                    CASE WHEN recruiter_notes IS NULL OR recruiter_notes = '' THEN '' ELSE E'\n' END ||
                    '[Auto ' || TO_CHAR(NOW(), 'YYYY-MM-DD') || '] Candidato desvinculado de la organización',
                  updated_at = NOW()
             WHERE tenant_id = $1
               AND candidate_type = 'internal'
               AND user_id = $2
               AND stage NOT IN ('hired', 'rejected')`,
          [tenantId, userId],
        );

        // 14. CalibrationEntries: status != agreed → withdrawn.
        //     calibration_entries no tiene tenant_id (se scopea vía session);
        //     hacemos JOIN implícito para aislar multi-tenant defensivamente.
        const calibrationWithdrawn = await safeExec(
          `UPDATE calibration_entries SET status = 'withdrawn', updated_at = NOW()
             WHERE user_id = $1
               AND status IN ('pending', 'discussed')
               AND session_id IN (
                 SELECT id FROM calibration_sessions WHERE tenant_id = $2
               )`,
          [userId, tenantId],
        );

        // 15. F-003 — Calibration moderator reassignment.
        //     Si el desvinculado era moderador de sesiones no-cerradas, reasignar
        //     al reassignToManagerId. Si no hay target → primer tenant_admin activo.
        //     Sesiones cerradas NO se tocan (auditoría histórica).
        let moderatorReassigned = 0;
        const newModeratorId = newManagerId
          ?? (await em.query(
                `SELECT id FROM users
                  WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true AND id <> $2
                  ORDER BY created_at ASC
                  LIMIT 1`,
                [tenantId, userId],
              ))?.[0]?.id
          ?? null;
        if (newModeratorId) {
          moderatorReassigned = await safeExec(
            `UPDATE calibration_sessions
                SET moderator_id = $1, updated_at = NOW()
              WHERE tenant_id = $2 AND moderator_id = $3 AND status <> 'closed'`,
            [newModeratorId, tenantId, userId],
          );
        }

        // 16. F-002 — Signature rerouting audit trail.
        //     Marca las firmas válidas del desvinculado con rerouted_to
        //     (reassignToManagerId o primer admin activo). Es un mark de
        //     auditoría — no revoca las firmas, solo documenta quién
        //     hereda la responsabilidad futura.
        let signaturesRerouted = 0;
        if (newModeratorId) {
          signaturesRerouted = await safeExec(
            `UPDATE document_signatures
                SET rerouted_to = $1, rerouted_at = NOW()
              WHERE tenant_id = $2 AND signed_by = $3 AND status = 'valid' AND rerouted_to IS NULL`,
            [newModeratorId, tenantId, userId],
          );
        }

        return {
          saved,
          reportsAffected,
          tokensInvalidated: true,
          clearedTwoFactor,
          objectivesAbandoned,
          childrenDetached,
          plansCancelled,
          actionsCancelled,
          checkinsCancelled,
          assignmentsCancelled,
          notificationsArchived,
          candidaturesRejected,
          calibrationWithdrawn,
          moderatorReassigned,
          signaturesRerouted,
          newModeratorId,
        };
      });

    const {
      saved,
      reportsAffected,
      tokensInvalidated,
      clearedTwoFactor,
      objectivesAbandoned,
      childrenDetached,
      plansCancelled,
      actionsCancelled,
      checkinsCancelled,
      assignmentsCancelled,
      notificationsArchived,
      candidaturesRejected,
      calibrationWithdrawn,
      moderatorReassigned,
      signaturesRerouted,
      newModeratorId,
    } = cascadeResult;

    // ── Post-commit: Signature rerouting ─────────────────────────────
    // Si el desvinculado era tenant_admin y hay contratos pending_signature,
    // alertar a los admins restantes para que asuman las firmas pendientes.
    // El modelo DocumentSignature no tiene "pending" (solo registra firmas
    // ya realizadas), pero los contratos SÍ quedan en pending_signature
    // esperando que alguien firme. Esta notificación cierra ese gap.
    if (user.role === 'tenant_admin') {
      try {
        const pendingContracts = await this.dataSource.query(
          `SELECT COUNT(*) AS cnt FROM contracts WHERE tenant_id = $1 AND status = 'pending_signature'`,
          [tenantId],
        );
        const pendingCount = parseInt(pendingContracts?.[0]?.cnt || '0', 10);
        if (pendingCount > 0) {
          const remainingAdmins = await this.userRepository.find({
            where: { tenantId, role: 'tenant_admin', isActive: true, id: Not(userId) },
            select: ['id'],
          });
          for (const admin of remainingAdmins) {
            await this.notificationsService.create({
              tenantId,
              userId: admin.id,
              type: 'general' as any,
              title: `Contratos pendientes de firma — admin desvinculado`,
              message: `${user.firstName} ${user.lastName} fue desvinculado/a y hay ${pendingCount} contrato(s) pendiente(s) de firma. Revisa y firma los contratos que queden sin firmante.`,
              metadata: { departedUserId: userId, pendingContracts: pendingCount },
            }).catch(() => {});
          }
        }
      } catch {
        // No-crítico — la firma sigue pendiente, solo faltó la notificación
      }
    }

    // 15. Audit (post-commit, fire-and-forget) con metadata completa
    await this.auditService
      .log(tenantId, processedById, 'user.departed', 'user', userId, {
        departureType: dto.departureType,
        isVoluntary: dto.isVoluntary,
        reasonCategory: dto.reasonCategory ?? null,
        lastDepartment: snapshotDept,
        lastPosition: snapshotPos,
        cascade: {
          // Etapa A
          reportsReassigned: reportsAffected,
          reassignedTo: dto.reassignToManagerId ?? null,
          clearedTwoFactor,
          tokensInvalidated,
          // Etapa B
          objectivesAbandoned,
          childrenDetached,
          plansCancelled,
          actionsCancelled,
          checkinsCancelled,
          assignmentsCancelled,
          notificationsArchived,
          candidaturesRejected,
          calibrationWithdrawn,
          // Etapa C (F-002 + F-003)
          moderatorReassigned,
          signaturesRerouted,
          reroutedTo: newModeratorId ?? null,
        },
      })
      .catch(() => {});

    return saved;
  }

  async getUserDepartures(userId: string, tenantId: string): Promise<UserDeparture[]> {
    return this.departureRepo.find({
      where: { userId, tenantId },
      order: { departureDate: 'DESC' },
    });
  }

  // ─── Stage C: Reactivación / Edit / Cancel departure ──────────────────

  /**
   * Reactiva un usuario previamente desvinculado (boomerang rehire).
   *
   * Acciones atómicas (una sola transacción):
   *   1. Valida que user.isActive === false (si ya está activo, 400)
   *   2. Pre-flight: verifica que su email sigue disponible (no colisión)
   *   3. Opcionalmente reasigna un nuevo manager (valida activo/rol)
   *   4. Genera password temporal + bump tokenVersion + mustChangePassword
   *   5. Setea isActive = true, departureDate = null
   *   6. Audit log `user.reactivated` con metadata
   *   7. Post-commit: envía email "welcome back" con temp password
   *
   * NO intenta restaurar objetivos/PDI/evaluaciones/etc del Stage B cascade.
   * Esos registros quedan en su estado final (ABANDONED / CANCELLED) y el
   * admin debe re-generarlos manualmente si corresponde.
   */
  async reactivateUser(
    userId: string,
    inputTenantId: string | undefined,
    dto: ReactivateUserDto,
    processedById: string,
  ): Promise<{ ok: boolean; tempPasswordSentTo: string }> {
    const user = await this.findByIdScoped(userId, inputTenantId);
    if (user.isActive) throw new BadRequestException('El usuario ya está activo');
    // Shadow: dentro del método todas las queries usan el tenantId authoritative del user.
    const tenantId = user.tenantId;

    // Pre-flight: email collision check (alguien pudo haber tomado el email)
    const emailCollision = await this.userRepository.findOne({
      where: { tenantId, email: user.email, id: Not(userId), isActive: true },
    });
    if (emailCollision) {
      throw new ConflictException(
        `El email ${user.email} ya está en uso por otro usuario activo. ` +
        'Debe cambiar el email del otro usuario antes de reactivar.',
      );
    }

    // Validación de manager de reasignación (si se provee)
    if (dto.managerId) {
      if (dto.managerId === userId) {
        throw new BadRequestException('Un usuario no puede ser su propio manager');
      }
      const newManager = await this.userRepository.findOne({
        where: { id: dto.managerId, tenantId },
      });
      if (!newManager) throw new BadRequestException('Manager no encontrado');
      if (!newManager.isActive) throw new BadRequestException('El manager está inactivo');
      if (newManager.role !== 'manager' && newManager.role !== 'tenant_admin') {
        throw new BadRequestException('El usuario asignado no tiene rol de manager o admin');
      }
    }

    // Generar password temporal + hash
    const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!';
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const daysInactive = user.departureDate
      ? Math.floor((Date.now() - new Date(user.departureDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const lastDepartureDate = user.departureDate;

    // Cascade atómico
    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(User)
        .set({
          isActive: true,
          departureDate: null as any,
          passwordHash,
          mustChangePassword: true,
          tokenVersion: () => '"token_version" + 1',
          ...(dto.managerId !== undefined ? { managerId: (dto.managerId || null) as any } : {}),
        })
        .where('id = :id', { id: userId })
        .execute();
    });

    // Audit (post-commit)
    await this.auditService
      .log(tenantId, processedById, 'user.reactivated', 'user', userId, {
        lastDepartureDate,
        daysInactive,
        reasonForReactivation: dto.reasonForReactivation || null,
        managerAssigned: dto.managerId || null,
      })
      .catch(() => {});

    // Email welcome-back (fire-and-forget)
    try {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      await this.emailService.sendWelcomeBack(user.email, {
        firstName: user.firstName,
        orgName: tenant?.name || 'Eva360',
        tempPassword,
        tenantId,
        daysInactive: daysInactive ?? undefined,
      });
    } catch {
      // Email no-crítico; el admin puede reenviar invite si falla
    }

    return { ok: true, tempPasswordSentTo: user.email };
  }

  /**
   * Edita los campos de diagnóstico/seguimiento de un registro de
   * desvinculación existente. Sólo se permite modificar reasonCategory,
   * reasonDetail, wouldRehire (los datos legales son inmutables).
   */
  async updateDeparture(
    userId: string,
    departureId: string,
    inputTenantId: string | undefined,
    dto: UpdateDepartureDto,
    processedById: string,
  ): Promise<UserDeparture> {
    // Si inputTenantId es undefined (super_admin cross-tenant), busca por id + userId sin filtro.
    const where = inputTenantId
      ? { id: departureId, userId, tenantId: inputTenantId }
      : { id: departureId, userId };
    const departure = await this.departureRepo.findOne({ where });
    if (!departure) throw new NotFoundException('Registro de desvinculación no encontrado');
    // Shadow: queries/audit posteriores usan el tenantId authoritative del departure.
    const tenantId = departure.tenantId;

    const changes: Record<string, { from: any; to: any }> = {};
    if (dto.reasonCategory !== undefined && dto.reasonCategory !== departure.reasonCategory) {
      changes.reasonCategory = { from: departure.reasonCategory, to: dto.reasonCategory };
      departure.reasonCategory = dto.reasonCategory;
    }
    if (dto.reasonDetail !== undefined && dto.reasonDetail !== departure.reasonDetail) {
      changes.reasonDetail = { from: departure.reasonDetail, to: dto.reasonDetail };
      departure.reasonDetail = dto.reasonDetail;
    }
    if (dto.wouldRehire !== undefined && dto.wouldRehire !== departure.wouldRehire) {
      changes.wouldRehire = { from: departure.wouldRehire, to: dto.wouldRehire };
      departure.wouldRehire = dto.wouldRehire;
    }

    if (Object.keys(changes).length === 0) return departure;

    const saved = await this.departureRepo.save(departure);

    await this.auditService
      .log(tenantId, processedById, 'user_departure.edited', 'user_departure', departureId, {
        userId,
        fieldsChanged: Object.keys(changes),
        changes,
      })
      .catch(() => {});

    return saved;
  }

  /**
   * Cancela una desvinculación registrada por error (soft rollback):
   *   1. Valida que el registro sea el MÁS RECIENTE del usuario (no se
   *      puede rollbackear una desvinculación antigua si hay otra posterior)
   *   2. Si el usuario está inactivo, lo reactiva (sin email welcome-back
   *      — el admin lo notifica manualmente)
   *   3. Elimina el registro UserDeparture
   *   4. Audit log `user_departure.cancelled` con snapshot del registro
   *
   * NO restaura el cascade Stage B (objetivos/PDI/evals quedan en su
   * estado final — admin debe re-generar manualmente si corresponde).
   * NO restaura direct reports reasignados (el nuevo manager ya opera —
   * romper eso es peor que mantenerlo).
   */
  async cancelDeparture(
    userId: string,
    departureId: string,
    inputTenantId: string | undefined,
    processedById: string,
    reason?: string,
  ): Promise<{ ok: boolean; reactivated: boolean }> {
    const depWhere = inputTenantId
      ? { id: departureId, userId, tenantId: inputTenantId }
      : { id: departureId, userId };
    const departure = await this.departureRepo.findOne({
      where: depWhere,
    });
    if (!departure) throw new NotFoundException('Registro de desvinculación no encontrado');
    // Shadow: el resto del método opera con el tenantId authoritative del departure.
    const tenantId = departure.tenantId;

    // Verificar que sea el más reciente (tiebreaker: createdAt DESC si
    // dos desvinculaciones comparten fecha — no debería pasar pero defensivo)
    const latest = await this.departureRepo.findOne({
      where: { userId, tenantId },
      order: { departureDate: 'DESC', createdAt: 'DESC' },
    });
    if (!latest || latest.id !== departureId) {
      throw new BadRequestException(
        'Sólo se puede cancelar la desvinculación más reciente del usuario',
      );
    }

    const user = await this.findByIdScoped(userId, tenantId);

    const wasInactive = !user.isActive;
    const snapshot = {
      departureDate: departure.departureDate,
      departureType: departure.departureType,
      isVoluntary: departure.isVoluntary,
      reasonCategory: departure.reasonCategory,
      reasonDetail: departure.reasonDetail,
      wouldRehire: departure.wouldRehire,
    };

    // Soft rollback atómico
    await this.dataSource.transaction(async (em) => {
      // 1. Reactivar user (si estaba inactivo)
      if (wasInactive) {
        await em
          .createQueryBuilder()
          .update(User)
          .set({
            isActive: true,
            departureDate: null as any,
            tokenVersion: () => '"token_version" + 1',
          })
          .where('id = :id', { id: userId })
          .execute();
      }
      // 2. Eliminar el registro de desvinculación
      await em.getRepository(UserDeparture).delete({ id: departureId });
    });

    await this.auditService
      .log(tenantId, processedById, 'user_departure.cancelled', 'user_departure', departureId, {
        userId,
        reactivated: wasInactive,
        reason: reason || null,
        cancelledDeparture: snapshot,
        warning: 'El cascade de trabajo en curso (objetivos, PDI, evaluaciones) NO se restauró — el admin debe re-generarlos manualmente si corresponde',
      })
      .catch(() => {});

    return { ok: true, reactivated: wasInactive };
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

    // P6 fix (bug review): el audit log debe identificar al CALLER
    // (manager o admin que registra el movimiento), NO al target user.
    // Antes se usaba `userId` (target) como actor, perdiendo la trazabilidad
    // de quién hizo la operación. Si approvedById viene (caso normal desde
    // el controller), lo usamos; si no, fallback al userId (cron o caller
    // interno sin contexto).
    this.auditService.log(tenantId, approvedById || userId, 'user.movement_registered', 'user', userId, {
      movementType: dto.movementType,
      from: { department: movement.fromDepartment, position: movement.fromPosition },
      to: { department: movement.toDepartment, position: movement.toPosition },
      targetUserId: userId,
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

  /**
   * Bulk import transaccional con pre-checks optimizados.
   *
   * Diseño:
   *   1. Pre-checks (fuera de tx): structural validation, plan limit,
   *      detección de duplicados intra-CSV, carga batch de existing emails
   *      y potential managers en 1 query cada (no N+1).
   *   2. Transacción principal (`dataSource.transaction`): loop de saves
   *      de users. Si ocurre un error DB catastrófico (crash, deadlock,
   *      FK violation inesperada) → rollback de TODA la importación. Si
   *      son errores de validación per-row, se acumulan en errors[] y el
   *      loop continúa (comportamiento previo preservado pero atomic).
   *   3. Post-commit (fuera de tx): sync JSONB settings best-effort +
   *      audit log. Ninguno de los dos es crítico si falla.
   *
   * Antes (bug P0): cada user.save se committeaba inmediatamente. Si la
   * row 250 crasheaba la DB, las 249 anteriores quedaban persistidas sin
   * forma de rollback. Ahora es todo-o-nada para errores no-recoverable.
   */
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

    // Crear record del job FUERA de la transacción. Queda visible para el
    // frontend aunque el transaccional falle (y el save final lo actualiza).
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
    const newDepartments: string[] = [];
    const newPositions: string[] = [];

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

    // ── Pre-checks batch (1 query cada, no N+1) ───────────────────────
    //
    // 1. Recolectar todos los emails del CSV (normalizados a lowercase).
    //    Detectar duplicados intra-CSV aquí para evitar que se procesen
    //    2 filas con mismo email donde la primera inserta y la segunda
    //    falla por UNIQUE constraint.
    const csvEmails: string[] = [];
    const csvEmailSeen = new Map<string, number>(); // email → primer rowNum donde apareció
    const duplicateInCsv = new Set<number>(); // rowIdx con duplicados dentro del mismo CSV
    for (let i = 0; i < dataLines.length; i++) {
      const cols = dataLines[i].split(',').map((c) => c.trim());
      const email = (cols[emailIdx] || '').toLowerCase();
      if (!email) continue;
      if (csvEmailSeen.has(email)) {
        duplicateInCsv.add(i);
      } else {
        csvEmailSeen.set(email, i + 2);
        csvEmails.push(email);
      }
    }

    // 2. Cargar emails que ya existen en DB para este tenant (1 query).
    //    Usamos createQueryBuilder con LOWER() para comparación
    //    case-insensitive. Sin esto, si DB tiene 'Foo@Bar.com' y el CSV
    //    trae 'foo@bar.com', el pre-check no detecta el duplicado y el
    //    INSERT crearía dos users con emails solo-distintos-en-capitalización.
    const existingEmailsRows = csvEmails.length > 0
      ? await this.userRepository
          .createQueryBuilder('u')
          .select('u.email', 'email')
          .where('u.tenant_id = :tenantId', { tenantId })
          .andWhere('LOWER(u.email) IN (:...emails)', { emails: csvEmails })
          .getRawMany()
      : [];
    const existingEmailSet = new Set(existingEmailsRows.map((u) => String(u.email).toLowerCase()));

    // 3. Cargar managers potenciales del CSV en 1 query.
    const managerEmails = new Set<string>();
    if (managerEmailIdx >= 0) {
      for (const line of dataLines) {
        const cols = line.split(',').map((c) => c.trim());
        const mEmail = (cols[managerEmailIdx] || '').toLowerCase();
        if (mEmail) managerEmails.add(mEmail);
      }
    }
    // Lookup case-insensitive igual que emails del CSV (ver explicación arriba).
    const managersRows = managerEmails.size > 0
      ? await this.userRepository
          .createQueryBuilder('u')
          .select(['u.id AS id', 'u.email AS email'])
          .where('u.tenant_id = :tenantId', { tenantId })
          .andWhere('LOWER(u.email) IN (:...emails)', { emails: [...managerEmails] })
          .getRawMany()
      : [];
    const managerByEmail = new Map<string, string>();
    for (const m of managersRows) managerByEmail.set(String(m.email).toLowerCase(), m.id);

    // 4. Load tenant settings once (antes se cargaba 1x por row → N queries).
    const tenantOnce = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
    const posCatalog: { name: string; level: number }[] = tenantOnce?.settings?.positions ?? [];
    const existingConfiguredPos = new Set(posCatalog.map((p) => this.normStr(p.name)));

    // 5. Load configured departments (para tracking de newDepartments).
    const configuredDepts = await this.getConfiguredDepartments(tenantId);
    const validDeptSet = new Set(configuredDepts.map((d) => this.normStr(d)));

    // ── Transacción principal ─────────────────────────────────────────
    //
    // Envolvemos el loop de saves en `dataSource.transaction()`. Si un
    // error catastrófico ocurre (DB crash, deadlock, FK inesperada), la
    // transacción hace rollback y todas las inserts se revierten. Los
    // errores de validación per-row se acumulan en errors[] sin abortar
    // la tx (el usuario ve la lista y decide qué hacer con el CSV).
    try {
      await this.dataSource.transaction(async (em) => {
        const userRepo = em.getRepository(User);

        for (let i = 0; i < dataLines.length; i++) {
          const cols = dataLines[i].split(',').map((c) => c.trim());
          const rowNum = i + 2; // 1-indexed, skip header

          try {
            const rawEmail = cols[emailIdx] || '';
            const email = rawEmail.toLowerCase();
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
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
              errors.push({ row: rowNum, message: `Email inválido: ${rawEmail}` });
              continue;
            }

            // Duplicado intra-CSV (detectado en pre-check).
            if (duplicateInCsv.has(i)) {
              const firstAppearance = csvEmailSeen.get(email);
              errors.push({
                row: rowNum,
                message: `Email duplicado dentro del CSV (ya aparece en fila ${firstAppearance}): ${rawEmail}`,
              });
              continue;
            }

            // Duplicado contra DB (pre-cargado en 1 query).
            if (existingEmailSet.has(email)) {
              errors.push({ row: rowNum, message: `Email duplicado: ${rawEmail}` });
              continue;
            }

            const role = roleIdx >= 0 ? (cols[roleIdx] || 'employee') : 'employee';
            const validRoles = ['employee', 'manager', 'tenant_admin', 'external'];
            if (!validRoles.includes(role)) {
              errors.push({ row: rowNum, message: `Rol inválido: ${role}` });
              continue;
            }

            // Track new departments for summary (resolveDepartment crea el record).
            if (department && !validDeptSet.has(this.normStr(department))) {
              validDeptSet.add(this.normStr(department));
              newDepartments.push(department);
            }

            // Resolve manager — lookup en memoria (no query por row).
            let managerId: string | undefined;
            if (managerEmailIdx >= 0 && cols[managerEmailIdx]) {
              const mEmail = cols[managerEmailIdx].toLowerCase();
              managerId = managerByEmail.get(mEmail);
              // Si el manager no existe todavía (puede estar más abajo en el CSV),
              // queda null. No es error: managerId se resuelve post-import si hace falta.
            }

            // Validate and normalize RUT (required)
            let parsedRut: string | null = null;
            const rawRut = rutIdx >= 0 ? (cols[rutIdx] || '').trim() : '';
            if (!rawRut) {
              errors.push({ row: rowNum, message: 'RUT es obligatorio' });
              continue;
            }
            const normalizedRut = normalizeRut(rawRut);
            if (!validateRut(normalizedRut)) {
              errors.push({ row: rowNum, message: `RUT inválido: ${rawRut}` });
              continue;
            }
            parsedRut = normalizedRut;

            const tempPassword = 'EvaPro2026!';
            const passwordHash = await bcrypt.hash(tempPassword, 10);

            // Parse hierarchy level from CSV or lookup from position catalog (en memoria).
            let hierarchyLevel: number | undefined;
            if (hierarchyLevelIdx >= 0 && cols[hierarchyLevelIdx]) {
              const parsed = parseInt(cols[hierarchyLevelIdx]);
              if (!isNaN(parsed) && parsed >= 1) hierarchyLevel = parsed;
            }
            if (!hierarchyLevel && position) {
              const match = posCatalog.find((p) => this.normStr(p.name) === this.normStr(position));
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

            // Resolve department/position to IDs (dual-write). Usan los repos
            // "no-tx" a propósito: si el user falla, el department/position
            // catalog queda — pero son entidades compartidas idempotentes,
            // no data per-row. Aceptable trade-off vs la complejidad de
            // refactorizarlos a tx-aware.
            const resolvedDept = await this.resolveDepartment(tenantId, null, department || null);
            const resolvedPos = await this.resolvePosition(tenantId, null, position || null);

            await userRepo.save(
              userRepo.create({
                tenantId,
                email: rawEmail, // preservar capitalización original en DB
                firstName,
                lastName,
                passwordHash,
                role,
                managerId,
                rut: parsedRut,
                department: resolvedDept.department || undefined,
                departmentId: resolvedDept.departmentId || undefined,
                position: resolvedPos.position || undefined,
                positionId: resolvedPos.positionId || undefined,
                hierarchyLevel: hierarchyLevel || resolvedPos.hierarchyLevel || undefined,
                hireDate: hireDateIdx >= 0 && cols[hireDateIdx] ? new Date(cols[hireDateIdx]) : undefined,
                gender: validGenders.includes(rawGender) ? rawGender : undefined,
                birthDate: rawBirthDate ? new Date(rawBirthDate) : undefined,
                nationality: rawNationality || undefined,
                seniorityLevel: validSeniority.includes(rawSeniority) ? rawSeniority : undefined,
                contractType: validContract.includes(rawContract) ? rawContract : undefined,
                workLocation: validLocation.includes(rawLocation) ? rawLocation : undefined,
                isActive: true,
                mustChangePassword: true,
              } as any),
            );

            // Track new positions (lookup en memoria).
            if (position && hierarchyLevel && !existingConfiguredPos.has(this.normStr(position))) {
              existingConfiguredPos.add(this.normStr(position));
              newPositions.push(position);
            }

            // Cachear el email recién insertado — si más filas abajo intentan
            // dup, las detectamos sin ir a DB.
            existingEmailSet.add(email);

            successCount++;
          } catch (err) {
            // Errores de validación por row: acumular y seguir.
            // Errores catastróficos de DB (UNIQUE violation que nos sorprendió,
            // FK inesperada, conexión cortada) caen acá también pero entran
            // al ciclo de error TypeORM; si el error es recuperable, seguimos.
            // Si la transacción externa detecta un estado inconsistente, hará
            // rollback automático.
            errors.push({ row: rowNum, message: `Error: ${(err as Error).message}` });
          }
        }
      });
    } catch (txErr) {
      // Error catastrófico que abortó la tx entera. Ningún user se guardó.
      saved.status = ImportStatus.FAILED;
      saved.successRows = 0;
      saved.errorRows = dataLines.length;
      saved.errors = [{
        row: 0,
        message: `Transacción abortada: ${(txErr as Error).message}. Ninguna fila fue importada; reintentá el CSV.`,
      }];
      return this.bulkImportRepo.save(saved);
    }

    // ── Post-commit: sync settings + audit (best-effort) ──────────────
    // Si algo acá falla no hace rollback de los usuarios ya insertados.
    await this.syncDeptPosToSettings(tenantId);

    saved.successRows = successCount;
    saved.errorRows = errors.length;
    saved.errors = errors.length > 0 ? errors : null;
    saved.status = errors.length === dataLines.length ? ImportStatus.FAILED : ImportStatus.COMPLETED;

    const summary: any = {
      newDepartments: [...new Set(newDepartments)],
      newPositions: [...new Set(newPositions)],
    };
    (saved as any).summary = summary;

    await this.auditService.log(tenantId, uploadedBy, 'users.bulk_imported', 'bulk_import', saved.id, {
      totalRows: dataLines.length,
      successRows: successCount,
      errorRows: errors.length,
      newDepartments: summary.newDepartments,
      newPositions: summary.newPositions,
    }).catch(() => undefined);

    return this.bulkImportRepo.save(saved);
  }

  /** Normaliza string para comparación case+accent-insensitive. */
  private normStr(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  async getBulkImport(id: string, tenantId: string): Promise<BulkImport> {
    const imp = await this.bulkImportRepo.findOne({ where: { id, tenantId } });
    if (!imp) throw new NotFoundException('Importación no encontrada');
    return imp;
  }

  // ─── User Notes (HR Reports) ───────────────────────────────────────────────

  /**
   * P6.3 — Manager ve notas no-confidenciales MÁS las confidenciales que
   * él mismo escribió. Las confidenciales de tenant_admin (típicamente
   * sobre performance sensible del manager o info delicada) se ocultan.
   *
   * Admin ve todo. Employee no llega acá (el controller solo permite
   * super_admin/tenant_admin/manager en GET /users/:id/notes).
   */
  async listNotes(
    tenantId: string,
    userId: string,
    requesterRole?: string,
    requesterUserId?: string,
  ): Promise<UserNote[]> {
    const qb = this.noteRepo
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.author', 'author', 'author.tenant_id = note.tenant_id')
      .where('note.tenantId = :tenantId', { tenantId })
      .andWhere('note.userId = :userId', { userId });

    if (requesterRole === 'manager' && requesterUserId) {
      qb.andWhere(
        '(note.is_confidential = false OR note.author_id = :requesterId)',
        { requesterId: requesterUserId },
      );
    }

    qb.orderBy('note.createdAt', 'DESC');
    return qb.getMany();
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

  /**
   * P6.2 fix (bug review): manager solo puede editar notas de sus reportes
   * directos. Antes, un manager con un noteId conocido (ej. filtrado de
   * logs o enumeración) podía editar notas de cualquier equipo del tenant
   * — el service solo validaba tenantId sin verificar el target.
   *
   * Admin conserva acceso completo.
   */
  async updateNote(
    noteId: string,
    tenantId: string,
    data: { title?: string; content?: string; category?: string; isConfidential?: boolean },
    callerUserId?: string,
    callerRole?: string,
  ): Promise<UserNote> {
    const note = await this.noteRepo.findOne({ where: { id: noteId, tenantId } });
    if (!note) throw new NotFoundException('Nota no encontrada');

    // Guard: manager debe tener al target user como reporte directo.
    if (callerRole === 'manager' && callerUserId) {
      const target = await this.userRepository.findOne({
        where: { id: note.userId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!target || (target.managerId !== callerUserId && target.id !== callerUserId)) {
        // 404 en vez de 403 — consistente con assertCanAccessUser, no
        // filtra existencia del noteId a un manager externo.
        throw new NotFoundException('Nota no encontrada');
      }
    }

    if (data.title !== undefined) note.title = data.title;
    if (data.content !== undefined) note.content = data.content;
    if (data.category !== undefined) note.category = data.category;
    if (data.isConfidential !== undefined) note.isConfidential = data.isConfidential;
    return this.noteRepo.save(note);
  }

  async deleteNote(noteId: string, tenantId: string | undefined): Promise<void> {
    const where = tenantId ? { id: noteId, tenantId } : { id: noteId };
    const note = await this.noteRepo.findOne({ where });
    if (!note) throw new NotFoundException('Nota no encontrada');
    await this.noteRepo.remove(note);
  }

  // ─── Invitations ─────────────────────────────────────────────────────────

  /**
   * Reenvía invitación al user objetivo.
   *
   * @param userId  id del user a quien se le reenvía
   * @param tenantId  si se provee, restringe la búsqueda a ese tenant
   *                  (tenant_admin solo puede operar sobre su propio tenant).
   *                  Si es `undefined`, busca por id sin filtrar por tenant
   *                  (super_admin puede reenviar cross-tenant).
   */
  async resendInvite(userId: string, tenantId?: string): Promise<{ ok: boolean }> {
    const where: any = { id: userId };
    if (tenantId) where.tenantId = tenantId;
    const user = await this.userRepository.findOne({ where, relations: ['tenant'] });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!';
    user.passwordHash = await bcrypt.hash(tempPassword, 12);
    await this.userRepository.save(user);

    await this.notificationsService.sendInvitation(
      user.email,
      user.tenant?.name || 'EvaPro',
      { firstName: user.firstName, tempPassword },
    ).catch(() => {});

    // Logueamos sobre el tenant del user (no del caller) para que el audit
    // log quede scoped al tenant correcto cuando super_admin opera cross-tenant.
    await this.auditService.log(user.tenantId, userId, 'user.invite_resent', 'user', userId);
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
    // Get configured departments from table (with JSONB fallback)
    const deptRecords = await this.departmentRepo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    let configuredDepts: string[];
    if (deptRecords.length > 0) {
      configuredDepts = deptRecords.map(d => d.name);
    } else {
      const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
      configuredDepts = tenant.settings?.departments ?? [];
    }
    if (configuredDepts.length === 0) {
      return { mismatches: [], fixed: 0 };
    }

    // Build lookup map: lowercase name → { name, id }
    const deptMap = new Map<string, { name: string; id: string | null }>();
    for (const d of deptRecords) deptMap.set(d.name.toLowerCase().trim(), { name: d.name, id: d.id });
    // Fallback for JSONB-only entries
    for (const name of configuredDepts) {
      if (!deptMap.has(name.toLowerCase().trim())) {
        deptMap.set(name.toLowerCase().trim(), { name, id: null });
      }
    }

    // Get all users with a department set
    const users = await this.userRepository.find({
      where: { tenantId, isActive: true },
      select: ['id', 'firstName', 'lastName', 'department', 'departmentId'],
    });

    const lowerConfigured = configuredDepts.map(d => d.toLowerCase().trim());

    const mismatches: { userId: string; name: string; current: string; suggested: string | null }[] = [];
    for (const u of users) {
      if (!u.department) continue;
      const dept = u.department.trim();
      const idx = lowerConfigured.indexOf(dept.toLowerCase());
      if (idx >= 0) {
        if (dept !== configuredDepts[idx]) {
          mismatches.push({ userId: u.id, name: `${u.firstName} ${u.lastName}`, current: dept, suggested: configuredDepts[idx] });
        }
        continue;
      }
      const partial = configuredDepts.find(cd =>
        cd.toLowerCase().includes(dept.toLowerCase()) || dept.toLowerCase().includes(cd.toLowerCase()),
      );
      mismatches.push({ userId: u.id, name: `${u.firstName} ${u.lastName}`, current: dept, suggested: partial || null });
    }

    let fixed = 0;
    if (apply) {
      for (const m of mismatches) {
        if (m.suggested) {
          const record = deptMap.get(m.suggested.toLowerCase().trim());
          const updates: any = { department: m.suggested };
          if (record?.id) updates.departmentId = record.id;
          await this.userRepository.update(m.userId, updates);
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
        // Necesario en el frontend para que el manager pueda discriminar
        // sus directos (mostrar boton "Ver perfil" solo para ellos) sin
        // hacer otra llamada al API. Empleados/admin no usan este campo.
        managerId: u.managerId || null,
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
