import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserNote } from './entities/user-note.entity';
import { BulkImport, ImportStatus } from './entities/bulk-import.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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
    filters?: { search?: string; department?: string; role?: string; status?: string },
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
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
    if (filters?.status === 'active') {
      qb.andWhere('user.is_active = true');
    } else if (filters?.status === 'inactive') {
      qb.andWhere('user.is_active = false');
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
        throw new NotFoundException('Manager no encontrado en esta organizaci\u00f3n');
      }
      if (manager.role !== 'manager' && manager.role !== 'tenant_admin') {
        throw new BadRequestException('El usuario seleccionado como manager debe tener rol de manager o administrador');
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
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      isActive: true,
    });

    const saved = await this.userRepository.save(user);
    await this.auditService.log(tenantId, saved.id, 'user.created', 'user', saved.id);
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
    if (dto.email !== undefined) user.email = dto.email;
    // Only super_admin and tenant_admin can change roles
    if (dto.role !== undefined) {
      const canChangeRole = callerRole === 'super_admin' || callerRole === 'tenant_admin';
      if (canChangeRole) {
        user.role = dto.role;
      }
      // Silently ignore role changes from unauthorized users
    }
    if (dto.managerId !== undefined) user.managerId = dto.managerId;
    if (dto.department !== undefined) user.department = dto.department;
    if (dto.position !== undefined) user.position = dto.position;
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

    return this.userRepository.save(user);
  }

  async remove(id: string, tenantId: string, callerRole?: string): Promise<void> {
    const user = await this.findById(id);
    if (callerRole !== 'super_admin' && user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }
    user.isActive = false;
    await this.userRepository.save(user);
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
    const rutIdx = header.indexOf('rut');

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

        if (!email || !firstName || !lastName) {
          errors.push({ row: rowNum, message: 'email, first_name y last_name son requeridos' });
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

        // Validate department
        const department = departmentIdx >= 0 ? cols[departmentIdx] : undefined;
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

        await this.userRepository.save(
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
            position: positionIdx >= 0 ? cols[positionIdx] : undefined,
            hireDate: hireDateIdx >= 0 && cols[hireDateIdx] ? new Date(cols[hireDateIdx]) : undefined,
            isActive: true,
          }),
        );
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
        passwordHash, role: role as any, isActive: true,
      });
      const saved = await this.userRepository.save(newUser);

      await this.notificationsService.sendInvitation(email, orgName, { firstName, tempPassword }).catch(() => {});
      await this.auditService.log(tenantId, saved.id, 'user.invited', 'user', saved.id);
      invited++;
    }

    return { invited, skipped };
  }
}
