import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, LessThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { runWithCronLock } from '../../common/utils/cron-lock';
import { RecruitmentProcess, ProcessStatus } from './entities/recruitment-process.entity';
import { RecruitmentCandidate, CandidateStage } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { User } from '../users/entities/user.entity';
import { UserMovement, MovementType } from '../users/entities/user-movement.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { UserTransferredEvent } from '../users/events/user-transferred.event';
import { TenantCronRunner } from '../../common/rls/tenant-cron-runner';

@Injectable()
export class RecruitmentService {
  private readonly logger = new Logger(RecruitmentService.name);

  constructor(
    @InjectRepository(RecruitmentProcess) private readonly processRepo: Repository<RecruitmentProcess>,
    @InjectRepository(RecruitmentCandidate) private readonly candidateRepo: Repository<RecruitmentCandidate>,
    @InjectRepository(RecruitmentEvaluator) private readonly evaluatorRepo: Repository<RecruitmentEvaluator>,
    @InjectRepository(RecruitmentInterview) private readonly interviewRepo: Repository<RecruitmentInterview>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationAssignment) private readonly evalAssignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse) private readonly evalResponseRepo: Repository<EvaluationResponse>,
    @InjectRepository(TalentAssessment) private readonly talentRepo: Repository<TalentAssessment>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Position) private readonly positionRepo: Repository<Position>,
    // S1.2 Hire flow: para insertar user_movements al ejecutar hire
    // (interno o externo). Reutilizamos el repo aqui dentro de la
    // transaccion para garantizar atomicidad (process+candidate+user+
    // movement todo o nada).
    @InjectRepository(UserMovement) private readonly movementRepo: Repository<UserMovement>,
    private readonly aiInsightsService: AiInsightsService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    // F4 A3 — para setear app.current_tenant_id en crons.
    private readonly tenantCronRunner: TenantCronRunner,
    // S2.1 — para delegar la cascada de cambio de dept/cargo/manager
    // al primitivo `transferUser` que centraliza la logica + emite
    // `user.transferred` para que listeners (evaluaciones, PDI, etc)
    // reaccionen automaticamente.
    private readonly usersService: UsersService,
  ) {}

  // ─── Date & status validators (v3.1 — date flow rules) ──────────────────

  /**
   * Fecha de "hoy" en UTC (00:00) usada para comparar contra columnas
   * `date` de Postgres. Las columnas `date` NO tienen timezone, así que
   * comparamos solo por día. Convertimos ambos a string YYYY-MM-DD.
   */
  private todayYmd(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Normaliza un valor de fecha a string YYYY-MM-DD (o null).
   * TypeORM retorna columnas `date` como string en algunos drivers y Date
   * en otros — normalizamos acá.
   */
  private toYmd(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    if (typeof d === 'string') {
      // Acepta "YYYY-MM-DD" o ISO; toma solo el día.
      return d.length >= 10 ? d.slice(0, 10) : d;
    }
    try {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return null;
    }
  }

  /**
   * Valida coherencia básica: startDate <= endDate. Lanza si falla.
   * Se llama tanto en create como en update, con los valores ya
   * mergeados (DTO sobre los existentes).
   */
  private assertCoherentDates(
    startDate: Date | string | null | undefined,
    endDate: Date | string | null | undefined,
  ): void {
    const s = this.toYmd(startDate);
    const e = this.toYmd(endDate);
    if (s && e && s > e) {
      throw new BadRequestException(
        'La fecha de inicio no puede ser posterior a la fecha de término.',
      );
    }
  }

  /**
   * Máquina de transiciones de estado para RecruitmentProcess.
   * - DRAFT → ACTIVE: exige startDate, endDate y endDate >= hoy.
   * - ACTIVE → COMPLETED | CLOSED: libre.
   * - ACTIVE → DRAFT: BLOQUEADO (no se retrocede).
   * - COMPLETED | CLOSED → ACTIVE: permitido (reabrir). Exige endDate >= hoy
   *   (o pedir una nueva). Marca autoClosed=false.
   * - COMPLETED ↔ CLOSED: BLOQUEADO (reabrir primero).
   * - Misma status → no-op (permitido, sin efectos).
   *
   * Nota: super_admin y tenant_admin comparten estas reglas — son reglas
   * de negocio, no de permisos. El control de permisos se hace en el
   * controller con @Roles.
   */
  private assertValidTransition(
    from: ProcessStatus,
    to: ProcessStatus,
    mergedStart: Date | string | null,
    mergedEnd: Date | string | null,
  ): void {
    if (from === to) return; // no-op

    const today = this.todayYmd();

    // DRAFT → ACTIVE
    if (from === ProcessStatus.DRAFT && to === ProcessStatus.ACTIVE) {
      if (!mergedStart || !mergedEnd) {
        throw new BadRequestException(
          'Para activar el proceso debes definir fecha de inicio y fecha de término.',
        );
      }
      if ((this.toYmd(mergedEnd) ?? '') < today) {
        throw new BadRequestException(
          'No se puede activar un proceso cuya fecha de término ya venció.',
        );
      }
      return;
    }

    // ACTIVE → COMPLETED | CLOSED
    if (
      from === ProcessStatus.ACTIVE &&
      (to === ProcessStatus.COMPLETED || to === ProcessStatus.CLOSED)
    ) {
      return;
    }

    // Reopen: COMPLETED | CLOSED → ACTIVE
    if (
      (from === ProcessStatus.COMPLETED || from === ProcessStatus.CLOSED) &&
      to === ProcessStatus.ACTIVE
    ) {
      if (!mergedEnd || (this.toYmd(mergedEnd) ?? '') < today) {
        throw new BadRequestException(
          'Para reabrir el proceso debes extender la fecha de término a hoy o después.',
        );
      }
      return;
    }

    // ACTIVE → DRAFT
    if (from === ProcessStatus.ACTIVE && to === ProcessStatus.DRAFT) {
      throw new BadRequestException(
        'Un proceso activo no puede volver a borrador. Si necesitas corregir, ciérralo y crea uno nuevo.',
      );
    }

    // COMPLETED ↔ CLOSED
    if (
      (from === ProcessStatus.COMPLETED && to === ProcessStatus.CLOSED) ||
      (from === ProcessStatus.CLOSED && to === ProcessStatus.COMPLETED)
    ) {
      throw new BadRequestException(
        'Para cambiar entre "completado" y "cerrado" primero reabre el proceso.',
      );
    }

    // DRAFT → COMPLETED/CLOSED (no tiene sentido)
    if (from === ProcessStatus.DRAFT) {
      throw new BadRequestException(
        'Un proceso en borrador solo puede pasar a activo.',
      );
    }

    throw new BadRequestException(
      `Transición de estado no permitida: ${from} → ${to}.`,
    );
  }

  /** Resolve department text↔ID bidirectionally */
  private async resolveDept(tenantId: string, deptId?: string, deptName?: string): Promise<{ departmentId: string | null; department: string | null }> {
    if (deptId) {
      const d = await this.departmentRepo.findOne({ where: { id: deptId, tenantId } });
      if (d) return { departmentId: d.id, department: d.name };
    }
    if (deptName?.trim()) {
      const d = await this.departmentRepo.createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name: deptName.trim() })
        .getOne();
      if (d) return { departmentId: d.id, department: d.name };
      return { departmentId: null, department: deptName.trim() };
    }
    return { departmentId: null, department: null };
  }

  /** Resolve position text↔ID bidirectionally */
  private async resolvePos(tenantId: string, posId?: string, posName?: string): Promise<{ positionId: string | null; position: string | null }> {
    if (posId) {
      const p = await this.positionRepo.findOne({ where: { id: posId, tenantId } });
      if (p) return { positionId: p.id, position: p.name };
    }
    if (posName?.trim()) {
      const p = await this.positionRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name: posName.trim() })
        .getOne();
      if (p) return { positionId: p.id, position: p.name };
      return { positionId: null, position: posName.trim() };
    }
    return { positionId: null, position: null };
  }

  // ─── Processes CRUD ───────────────────────────────────────────────────

  async createProcess(tenantId: string, creatorId: string, dto: any): Promise<RecruitmentProcess> {
    if (!dto.processType || !['external', 'internal'].includes(dto.processType)) {
      throw new BadRequestException('Tipo de proceso requerido: external o internal');
    }
    if (!dto.title?.trim() || !dto.position?.trim()) {
      throw new BadRequestException('Titulo y cargo son requeridos');
    }

    // v3.1 — validar coherencia de fechas (no importa el status en create;
    // los procesos nacen en DRAFT y la activación se valida en update).
    this.assertCoherentDates(dto.startDate, dto.endDate);

    // Dual-write: resolve department and position IDs
    const rd = await this.resolveDept(tenantId, dto.departmentId, dto.department);
    const rp = await this.resolvePos(tenantId, dto.positionId, dto.position);

    const process = this.processRepo.create({
      tenantId,
      processType: dto.processType,
      title: dto.title.trim(),
      position: rp.position || dto.position.trim(),
      positionId: rp.positionId,
      department: rd.department,
      departmentId: rd.departmentId,
      description: dto.description || null,
      requirements: Array.isArray(dto.requirements) ? dto.requirements : [],
      requireCvForInternal: dto.requireCvForInternal ?? false,
      scoringWeights: dto.scoringWeights ?? { history: 40, interview: 60 },
      startDate: dto.startDate || null,
      endDate: dto.endDate || null,
      createdBy: creatorId,
    });
    const saved = await this.processRepo.save(process);

    // Add evaluators
    if (dto.evaluatorIds?.length) {
      const evaluators = dto.evaluatorIds.map((evaluatorId: string) =>
        this.evaluatorRepo.create({ processId: saved.id, evaluatorId }),
      );
      await this.evaluatorRepo.save(evaluators);
    }

    await this.auditService.log(tenantId, creatorId, 'recruitment.process_created', 'recruitment_process', saved.id, { title: dto.title });
    return this.getProcess(tenantId, saved.id);
  }

  async listProcesses(tenantId: string, status?: string): Promise<any[]> {
    const where: any = { tenantId };
    if (status) where.status = status;

    const processes = await this.processRepo.find({
      where,
      relations: ['creator'],
      order: { createdAt: 'DESC' },
    });

    // Single query for all candidates across all processes
    const processIds = processes.map(p => p.id);
    const allCandidates = processIds.length > 0
      ? await this.candidateRepo.find({ where: { processId: In(processIds) }, relations: ['user'], order: { createdAt: 'ASC' } })
      : [];
    const candidatesByProcess = new Map<string, any[]>();
    for (const c of allCandidates) {
      if (!candidatesByProcess.has(c.processId)) candidatesByProcess.set(c.processId, []);
      candidatesByProcess.get(c.processId)!.push({
        id: c.id,
        firstName: c.firstName || c.user?.firstName || '',
        lastName: c.lastName || c.user?.lastName || '',
        candidateType: c.candidateType,
        stage: c.stage,
        finalScore: c.finalScore,
        position: c.user?.position || null,
        department: c.user?.department || null,
      });
    }
    return processes.map(p => {
      const candidates = candidatesByProcess.get(p.id) || [];
      return { ...p, candidateCount: candidates.length, candidates };
    });
  }

  async getProcess(tenantId: string, id: string): Promise<any> {
    // Tenant guard on creator/user/evaluator joins — any of these FKs could
    // be orphan cross-tenant after a data migration.
    const process = await this.processRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.creator', 'creator', 'creator.tenant_id = p.tenant_id')
      .where('p.id = :id', { id })
      .andWhere('p.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const candidates = await this.candidateRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.user', 'user', 'user.tenant_id = c.tenant_id')
      .where('c.processId = :processId', { processId: id })
      .andWhere('c.tenantId = :tenantId', { tenantId })
      .orderBy('c.createdAt', 'DESC')
      .getMany();

    // recruitment_evaluators NO tiene tenant_id (es una tabla de relacion
    // pura processId+evaluatorId). El aislamiento multi-tenant se garantiza
    // porque filtramos por processId de un proceso que YA fue validado
    // como perteneciente al tenant (query de arriba). El JOIN al user
    // usa el tenant del proceso para evitar cross-tenant leak.
    const evaluators = await this.evaluatorRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.evaluator', 'evaluator', 'evaluator.tenant_id = :tenantId', { tenantId })
      .where('e.processId = :processId', { processId: id })
      .getMany();

    return { ...process, candidates, evaluators };
  }

  /**
   * P5.5 — Secondary cross-tenant: tenantId opcional. resolvePos/resolveDept
   * usan process.tenantId authoritative cuando super_admin hace cross-tenant.
   */
  async updateProcess(tenantId: string | undefined, id: string, dto: any): Promise<RecruitmentProcess> {
    const where = tenantId ? { id, tenantId } : { id };
    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    const effectiveTenantId = process.tenantId;
    const previousStatus = process.status;

    // processType is immutable after active
    if (dto.processType && process.status !== ProcessStatus.DRAFT) {
      throw new BadRequestException('El tipo de proceso no se puede cambiar despues de activado');
    }

    // v3.1 — startDate inmutable una vez ACTIVE (evita mover un proceso en
    // marcha a otra ventana de aplicación). endDate sí se puede extender.
    if (
      dto.startDate !== undefined &&
      process.status === ProcessStatus.ACTIVE &&
      this.toYmd(dto.startDate) !== this.toYmd(process.startDate)
    ) {
      throw new BadRequestException(
        'La fecha de inicio no se puede modificar con el proceso activo.',
      );
    }

    if (dto.title !== undefined) process.title = dto.title;
    // Dual-write: resolve position and department
    if (dto.positionId !== undefined || dto.position !== undefined) {
      const rp = await this.resolvePos(effectiveTenantId, dto.positionId, dto.position ?? process.position);
      process.position = rp.position || process.position;
      process.positionId = rp.positionId;
    }
    if (dto.departmentId !== undefined || dto.department !== undefined) {
      const rd = await this.resolveDept(effectiveTenantId, dto.departmentId, dto.department ?? process.department);
      process.department = rd.department;
      process.departmentId = rd.departmentId;
    }
    if (dto.description !== undefined) process.description = dto.description;
    if (dto.requirements !== undefined) process.requirements = dto.requirements;
    if (dto.requireCvForInternal !== undefined) process.requireCvForInternal = dto.requireCvForInternal;
    if (dto.scoringWeights !== undefined) process.scoringWeights = dto.scoringWeights;
    if (dto.startDate !== undefined) process.startDate = dto.startDate;
    if (dto.endDate !== undefined) process.endDate = dto.endDate;

    // v3.1 — validar coherencia de fechas con los valores ya mergeados.
    this.assertCoherentDates(process.startDate, process.endDate);

    // v3.1 — máquina de estados. Si el DTO intenta cambiar el status,
    // validamos la transición contra las fechas mergeadas (para que el
    // frontend pueda enviar { status: 'active', endDate: '2026-06-01' }
    // en un solo request y funcione).
    if (dto.status !== undefined && dto.status !== previousStatus) {
      this.assertValidTransition(
        previousStatus,
        dto.status as ProcessStatus,
        process.startDate,
        process.endDate,
      );
      process.status = dto.status;

      // Al reabrir (COMPLETED/CLOSED → ACTIVE) limpiamos el flag autoClosed.
      if (
        (previousStatus === ProcessStatus.COMPLETED ||
          previousStatus === ProcessStatus.CLOSED) &&
        dto.status === ProcessStatus.ACTIVE
      ) {
        process.autoClosed = false;
      }
    }

    const saved = await this.processRepo.save(process);

    // Clean up CV data when process is closed or completed (free DB space).
    // Solo en la transición real a un estado terminal — no en updates que
    // no cambian status.
    const statusChanged = dto.status !== undefined && dto.status !== previousStatus;
    if (statusChanged && (dto.status === 'closed' || dto.status === 'completed')) {
      await this.candidateRepo
        .createQueryBuilder()
        .update()
        .set({ cvUrl: null })
        .where('process_id = :processId AND cv_url IS NOT NULL', { processId: id })
        .execute();
      this.logger.log(`Cleaned CV data for closed process ${id}`);
    }

    // Audit de eventos de cambio de estado (útil para soporte + compliance).
    if (statusChanged) {
      const action =
        previousStatus === ProcessStatus.DRAFT && dto.status === ProcessStatus.ACTIVE
          ? 'recruitment.process_activated'
          : (previousStatus === ProcessStatus.COMPLETED || previousStatus === ProcessStatus.CLOSED) &&
              dto.status === ProcessStatus.ACTIVE
            ? 'recruitment.process_reopened'
            : 'recruitment.process_status_changed';
      await this.auditService
        .log(effectiveTenantId, null, action, 'recruitment_process', id, {
          from: previousStatus,
          to: dto.status,
        })
        .catch(() => undefined);
    }

    return saved;
  }

  /**
   * v3.1 — Cron diario que cierra automáticamente procesos ACTIVE con
   * endDate < hoy. Los marca como CLOSED con autoClosed=true para poder
   * distinguirlos en UI (badge "Cerrado automáticamente") y permitir
   * reabrir fácilmente.
   *
   * Corre a las 01:00 UTC (madrugada en LATAM). No dispara emails ni
   * limpia CV data — el cierre manual existente ya se encarga de eso
   * (si necesitamos limpiarlos acá, replicar la query de updateProcess).
   *
   * Idempotente por diseño: si corre dos veces el mismo día, la segunda
   * corrida encuentra 0 filas porque todas ya están CLOSED.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async autoCloseExpiredProcesses(): Promise<void> {
    await runWithCronLock(
      'recruitment.autoCloseExpiredProcesses',
      this.dataSource,
      this.logger,
      async () => {
        // F4 A3 — runForEachTenant: cierra procesos vencidos por tenant.
        await this.tenantCronRunner.runForEachTenant(
          'recruitment.autoCloseExpiredProcesses',
          async (tenantId) => {
            const today = this.todayYmd();
            // Comparación directa contra columna date (YYYY-MM-DD string).
            const expired = await this.processRepo.find({
              where: {
                tenantId,
                status: ProcessStatus.ACTIVE,
                endDate: LessThan(new Date(today)) as any,
              },
              select: ['id', 'tenantId', 'title'],
            });

            if (expired.length === 0) {
              return;
            }

            for (const p of expired) {
              try {
                await this.processRepo.update(
                  { id: p.id },
                  { status: ProcessStatus.CLOSED, autoClosed: true },
                );
                await this.auditService
                  .log(p.tenantId, null, 'recruitment.process_auto_closed', 'recruitment_process', p.id, {
                    title: p.title,
                    closedAt: new Date().toISOString(),
                  })
                  .catch(() => undefined);
              } catch (err: any) {
                this.logger.warn(
                  `[autoCloseExpiredProcesses] falló cerrar proceso ${p.id}: ${err?.message}`,
                );
              }
            }

            this.logger.log(
              `[autoCloseExpiredProcesses] tenant=${tenantId.slice(0, 8)} cerrados: ${expired.length}`,
            );
          },
        );
      },
    );
  }

  // ─── Candidates ───────────────────────────────────────────────────────

  async addExternalCandidate(tenantId: string | undefined, processId: string, dto: any): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: processId, tenantId } : { id: processId };
    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    const effectiveTenantId = process.tenantId;
    if (process.processType !== 'external') throw new BadRequestException('Este proceso es solo para candidatos externos');

    if (!dto.firstName?.trim() || !dto.lastName?.trim()) throw new BadRequestException('Nombres y apellidos son requeridos');
    if (!dto.email?.trim()) throw new BadRequestException('Email es requerido');

    // Check unique email in process
    const existing = await this.candidateRepo.findOne({ where: { processId, email: dto.email } });
    if (existing) throw new BadRequestException('Ya existe un candidato con ese email en este proceso');

    const candidate = this.candidateRepo.create({
      processId, tenantId: effectiveTenantId, candidateType: 'external',
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim(),
      phone: dto.phone || null,
      linkedIn: dto.linkedIn || null,
      availability: dto.availability || null,
      salaryExpectation: dto.salaryExpectation || null,
    });
    return this.candidateRepo.save(candidate);
  }

  async addInternalCandidate(tenantId: string | undefined, processId: string, userId: string): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: processId, tenantId } : { id: processId };
    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    const effectiveTenantId = process.tenantId;
    if (process.processType !== 'internal') throw new BadRequestException('Este proceso es solo para candidatos internos');

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId: effectiveTenantId } });
    if (!user) throw new NotFoundException('Colaborador no encontrado');

    // Check unique user in process
    const existing = await this.candidateRepo.findOne({ where: { processId, userId } });
    if (existing) throw new BadRequestException('Este colaborador ya esta en el proceso');

    const candidate = this.candidateRepo.create({
      processId, tenantId: effectiveTenantId, candidateType: 'internal',
      userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
    return this.candidateRepo.save(candidate);
  }

  async updateCandidate(tenantId: string | undefined, candidateId: string, dto: any): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (dto.email !== undefined) candidate.email = dto.email;
    if (dto.phone !== undefined) candidate.phone = dto.phone;
    if (dto.linkedIn !== undefined) candidate.linkedIn = dto.linkedIn;
    if (dto.availability !== undefined) candidate.availability = dto.availability;
    if (dto.salaryExpectation !== undefined) candidate.salaryExpectation = dto.salaryExpectation;
    if (dto.recruiterNotes !== undefined) candidate.recruiterNotes = dto.recruiterNotes;
    return this.candidateRepo.save(candidate);
  }

  async updateCandidateStage(tenantId: string | undefined, candidateId: string, stage: string): Promise<RecruitmentCandidate> {
    // S1.2 / fix: el cambio a stage='hired' DEBE pasar por hireCandidate
    // (POST /processes/:id/hire/:candidateId) que ejecuta la cascada
    // completa al User + user_movements + audit. Permitir setearlo aqui
    // dejaria datos inconsistentes (candidato hired sin proceso completed
    // y sin actualizar el registro de empleado). El frontend ya bloquea
    // este path desde el dropdown, esto es defense-in-depth para llamadas
    // directas al API.
    if (stage === CandidateStage.HIRED || stage === 'hired') {
      throw new BadRequestException(
        'Para contratar use el endpoint POST /recruitment/processes/:id/hire/:candidateId, que ejecuta la cascada al empleado. Cambiar a hired desde aqui dejaria datos inconsistentes.',
      );
    }
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.stage = stage as CandidateStage;
    return this.candidateRepo.save(candidate);
  }

  // ─── S1.2 — Hire Candidate (cierre del flow de seleccion) ─────────────────

  /**
   * Genera un password temporal alfanumerico de longitud `length`. Excluye
   * caracteres ambiguos (0/O/1/I/l) para que el admin pueda dictarlo si
   * llega a hacer falta. Se setea con mustChangePassword=true en el User
   * creado para forzar cambio en primer login.
   */
  private generateTempPassword(length = 14): string {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Valida y normaliza el payload de hire. Defensivo: el controller pasa
   * `dto: any` sin class-validator (consistente con el resto del modulo).
   */
  private validateHireDto(dto: any): {
    effectiveDate: string;
    newDepartmentId: string | null;
    newPositionId: string | null;
    newManagerId: string | null;
    salary: number | null;
    contractType: 'indefinido' | 'plazo_fijo' | 'honorarios' | 'practicante' | null;
    notes: string | null;
  } {
    if (!dto?.effectiveDate) throw new BadRequestException('effectiveDate es requerido');
    const ymd = String(dto.effectiveDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw new BadRequestException('effectiveDate debe ser ISO YYYY-MM-DD');
    }
    const parsed = new Date(ymd);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('effectiveDate invalida');
    }

    const validContracts = ['indefinido', 'plazo_fijo', 'honorarios', 'practicante'];
    if (dto.contractType && !validContracts.includes(dto.contractType)) {
      throw new BadRequestException(`contractType invalido. Valores permitidos: ${validContracts.join(', ')}`);
    }

    let salary: number | null = null;
    if (dto.salary !== undefined && dto.salary !== null && dto.salary !== '') {
      const s = Number(dto.salary);
      if (isNaN(s) || s < 0) throw new BadRequestException('salary debe ser un numero >= 0');
      salary = s;
    }

    return {
      effectiveDate: ymd,
      newDepartmentId: dto.newDepartmentId || null,
      newPositionId: dto.newPositionId || null,
      newManagerId: dto.newManagerId || null,
      salary,
      contractType: dto.contractType || null,
      notes: dto.notes ? String(dto.notes).slice(0, 1000) : null,
    };
  }

  /**
   * Determina el MovementType a partir de los cambios. Reglas:
   * - Si hay cambio de cargo Y el nuevo level es MENOR (mas alto en
   *   jerarquia, ej. nivel 3 → nivel 2) → PROMOTION.
   * - Si hay cambio de cargo Y el nuevo level es MAYOR → DEMOTION.
   * - Si cambio dept Y cargo (mismo level) → LATERAL_TRANSFER.
   * - Solo dept → DEPARTMENT_CHANGE.
   * - Solo cargo (mismo level — raro, pero posible si renombre) →
   *   POSITION_CHANGE.
   */
  private detectMovementType(opts: {
    deptChanged: boolean;
    posChanged: boolean;
    prevLevel: number | null;
    newLevel: number | null;
  }): MovementType {
    const { deptChanged, posChanged, prevLevel, newLevel } = opts;
    if (posChanged && prevLevel != null && newLevel != null) {
      if (newLevel < prevLevel) return MovementType.PROMOTION;
      if (newLevel > prevLevel) return MovementType.DEMOTION;
    }
    if (deptChanged && posChanged) return MovementType.LATERAL_TRANSFER;
    if (deptChanged) return MovementType.DEPARTMENT_CHANGE;
    return MovementType.POSITION_CHANGE;
  }

  /**
   * S1.2 — Hire Candidate (Sprint 1).
   *
   * Cierra el flow de seleccion de personal: marca el candidato como
   * contratado, actualiza el proceso (status COMPLETED + winning) y
   * ejecuta la cascada minima sobre `users`:
   *
   * - **Interno**: actualiza el User existente con nuevo dept/cargo/manager
   *   e inserta una fila en `user_movements` con MovementType detectado
   *   automaticamente (PROMOTION / DEMOTION / LATERAL_TRANSFER /
   *   DEPARTMENT_CHANGE / POSITION_CHANGE).
   *
   * - **Externo**: crea un nuevo User con password temporal +
   *   `mustChangePassword=true`. Inserta tambien fila en `user_movements`
   *   semanticamente "joined company" (POSITION_CHANGE con from=null).
   *   Retorna el `tempPassword` al admin UNA SOLA VEZ (la API responde con
   *   esto en el body); el admin debe entregarselo al empleado nuevo.
   *   No persistimos el clear-text en ningun lado; solo se devuelve.
   *
   * Cascada de evaluaciones / PDI / objetivos / meetings → S2 (proximo
   * sprint, event-driven). En S1 solo cubrimos la cascada hacia `users`
   * y `user_movements` para que la dotacion quede consistente desde el
   * dia 1.
   *
   * Atomicidad: TODO esto va en una transaccion. Si falla cualquier paso
   * (ej. usuario duplicado por email), todo rollback — el proceso NO
   * queda como completed sin la cascada ejecutada.
   *
   * Idempotencia: si el candidato ya esta en stage=HIRED, lanzamos error
   * (no permite re-hire). Si el proceso ya esta COMPLETED con un
   * winningCandidateId distinto, tambien lanzamos.
   *
   * @returns process actualizado, candidate actualizado, userId resultado
   *   (existente para internos, nuevo para externos), y tempPassword
   *   (solo para externos — null en interno).
   */
  async hireCandidate(
    tenantId: string,
    processId: string,
    candidateId: string,
    rawDto: any,
    callerUserId: string,
  ): Promise<{
    process: RecruitmentProcess;
    candidate: RecruitmentCandidate;
    userId: string;
    tempPassword: string | null;
  }> {
    const hireData = this.validateHireDto(rawDto);

    // 1. Validar proceso
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    if (process.status !== ProcessStatus.ACTIVE) {
      throw new BadRequestException(
        `No se puede contratar en un proceso ${process.status}. Debe estar ACTIVE. Reabra el proceso si es necesario.`,
      );
    }
    if (process.winningCandidateId && process.winningCandidateId !== candidateId) {
      throw new BadRequestException(
        'Este proceso ya tiene un candidato ganador asignado. Debe revertirse antes de contratar a otro.',
      );
    }

    // 2. Validar candidato
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (candidate.processId !== processId) {
      throw new BadRequestException('El candidato no pertenece a este proceso');
    }
    if (candidate.stage === CandidateStage.HIRED) {
      throw new BadRequestException('El candidato ya fue contratado');
    }
    if (candidate.stage === CandidateStage.REJECTED) {
      throw new BadRequestException('No se puede contratar a un candidato rechazado');
    }
    // Permitimos hire desde INTERVIEWING/SCORED/APPROVED. Bloqueamos
    // REGISTERED y CV_REVIEW (todavia no fue evaluado).
    const allowedStages: CandidateStage[] = [
      CandidateStage.INTERVIEWING,
      CandidateStage.SCORED,
      CandidateStage.APPROVED,
    ];
    if (!allowedStages.includes(candidate.stage)) {
      throw new BadRequestException(
        `Candidato debe estar al menos en stage INTERVIEWING/SCORED/APPROVED para contratar (actual: ${candidate.stage}).`,
      );
    }

    const isInternal = candidate.candidateType === 'internal';
    if (isInternal && !candidate.userId) {
      throw new BadRequestException('Candidato interno sin userId asociado');
    }
    if (!isInternal && (!candidate.firstName || !candidate.lastName || !candidate.email)) {
      throw new BadRequestException('Candidato externo requiere firstName, lastName y email para contratar');
    }

    // 3. Resolver dept/pos/manager (con tenant scope)
    const newDept = hireData.newDepartmentId
      ? await this.departmentRepo.findOne({ where: { id: hireData.newDepartmentId, tenantId } })
      : null;
    if (hireData.newDepartmentId && !newDept) {
      throw new BadRequestException('Departamento destino no existe en este tenant');
    }
    const newPos = hireData.newPositionId
      ? await this.positionRepo.findOne({ where: { id: hireData.newPositionId, tenantId } })
      : null;
    if (hireData.newPositionId && !newPos) {
      throw new BadRequestException('Cargo destino no existe en este tenant');
    }
    let newManager: User | null = null;
    if (hireData.newManagerId) {
      newManager = await this.userRepo.findOne({ where: { id: hireData.newManagerId, tenantId } });
      if (!newManager) {
        throw new BadRequestException('Manager destino no existe en este tenant');
      }
      if (newManager.role !== 'manager' && newManager.role !== 'tenant_admin') {
        throw new BadRequestException('Manager destino no tiene rol de jefatura (manager o tenant_admin)');
      }
    }

    // 4. Pre-check externo: email duplicado dentro del mismo tenant
    if (!isInternal) {
      const dup = await this.userRepo.findOne({ where: { email: candidate.email!, tenantId } });
      if (dup) {
        throw new ConflictException(
          `Ya existe un usuario con el email ${candidate.email} en esta organizacion. Debe ingresar como interno o cambiar el email del candidato.`,
        );
      }
    }

    // 5. Para externo, generar password ANTES de la transaccion (hash es
    //    CPU bound; no queremos bloquear la tx con el bcrypt).
    let tempPassword: string | null = null;
    let passwordHash: string | null = null;
    if (!isInternal) {
      tempPassword = this.generateTempPassword();
      passwordHash = await bcrypt.hash(tempPassword, 12);
    }

    // 6. Transaccion: candidate + process + user + movement (atomico).
    //    S2.1 — capturamos el evento `user.transferred` para emitirlo
    //    POST-COMMIT (asi los listeners ven datos persistidos).
    //    S2.4 — SELECT FOR UPDATE pesimista sobre el proceso al inicio
    //    de la tx para serializar hires concurrentes. Sin esto, dos
    //    admins clickeando "Marcar como contratado" en paralelo veian
    //    cada uno winningCandidateId=null en su snapshot MVCC, ambos
    //    procedian, y el segundo COMMIT sobreescribia al primero
    //    (ambos candidatos quedaban hired pero solo uno como winning).
    //    Con FOR UPDATE, la 2da tx espera al COMMIT/ROLLBACK de la 1ra
    //    y reevalua winningCandidateId, encontrandolo ya seteado y
    //    fallando con el guard correspondiente.
    let resultUserId = '';
    let pendingTransferEvent: UserTransferredEvent | null = null;
    await this.dataSource.transaction(async (manager) => {
      const candidateRepo = manager.getRepository(RecruitmentCandidate);
      const processRepo = manager.getRepository(RecruitmentProcess);
      const userRepoTx = manager.getRepository(User);
      const movementRepoTx = manager.getRepository(UserMovement);

      // S2.4 fix2 — REMOVIDO el SELECT FOR UPDATE (setLock pesimista) que
      // causaba 500 Internal Server Error con single-conn pool (max:1):
      // TypeORM acquireia el lock en la conexion de la tx, pero el save()
      // posterior generaba un nuevo subject-executor que internamente
      // intentaba un nuevo queryRunner → segunda conexion no disponible
      // → statement_timeout en la UPDATE → tx caia.
      //
      // Reemplazo: UPDATE ... WHERE con condiciones atomicas de Postgres.
      // Mismo nivel de proteccion contra race condition (SQL atomico
      // garantiza una sola tx puede ganar) sin necesidad de lock pesimista.
      // Ej: UPDATE process SET winning=$1 WHERE id=$2 AND status='active'
      // AND (winning IS NULL OR winning=$1). result.affected=0 → race
      // perdida → throw error claro.

      // a. Marcar candidato como contratado (UPDATE atomico con guard).
      // Solo actualiza si stage es uno de los hireables Y no esta ya hired.
      const candResult = await candidateRepo.update(
        {
          id: candidateId,
          tenantId,
          stage: In([CandidateStage.INTERVIEWING, CandidateStage.SCORED, CandidateStage.APPROVED]),
        },
        { stage: CandidateStage.HIRED },
      );
      if (!candResult.affected || candResult.affected === 0) {
        // Re-fetch para dar error especifico sobre el estado actual.
        const current = await candidateRepo.findOne({ where: { id: candidateId, tenantId } });
        if (!current) {
          throw new NotFoundException('Candidato no encontrado (race con delete)');
        }
        if (current.stage === CandidateStage.HIRED) {
          throw new BadRequestException('El candidato ya fue contratado por otro admin justo ahora.');
        }
        if (current.stage === CandidateStage.REJECTED) {
          throw new BadRequestException('El candidato fue rechazado por otro admin durante el hire. Operacion abortada.');
        }
        throw new BadRequestException(
          `El candidato cambio de estado durante el hire (ahora ${current.stage}). Recargue y vuelva a intentar.`,
        );
      }

      // b. Marcar proceso completado (UPDATE atomico).
      // Condiciones: status='active' Y (winning IS NULL OR winning=candidateId).
      // Si otro admin marco otro winner en el medio, affected=0 → throw.
      const procResult = await processRepo
        .createQueryBuilder()
        .update(RecruitmentProcess)
        .set({
          status: ProcessStatus.COMPLETED,
          winningCandidateId: candidateId,
          hireData: hireData as any,
          autoClosed: false,
        })
        .where('id = :id', { id: processId })
        .andWhere('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :active', { active: ProcessStatus.ACTIVE })
        .andWhere('(winning_candidate_id IS NULL OR winning_candidate_id = :cid)', { cid: candidateId })
        .execute();
      if (!procResult.affected || procResult.affected === 0) {
        const current = await processRepo.findOne({ where: { id: processId, tenantId } });
        if (!current) {
          throw new NotFoundException('Proceso no encontrado (race con delete)');
        }
        if (current.status !== ProcessStatus.ACTIVE) {
          throw new BadRequestException(
            `El proceso cambio de estado durante el hire (ahora ${current.status}). Recargue y vuelva a intentar.`,
          );
        }
        if (current.winningCandidateId && current.winningCandidateId !== candidateId) {
          throw new BadRequestException(
            'Otro admin contrato a un candidato distinto en este proceso justo ahora. Recargue para ver el estado actual.',
          );
        }
        throw new BadRequestException('El proceso no pudo actualizarse (race condition). Recargue.');
      }

      // c. Cascada a User. Las UPDATEs atomicas anteriores ya garantizan
      // que el estado en BD es consistente; usamos las variables pre-tx
      // `candidate` y `process` para leer userId, email, title (datos
      // inmutables que no cambian con un hire).
      if (isInternal) {
        // S2.1 — delegar la actualizacion del User + insercion del
        // user_movement al primitivo centralizado `transferUser`. Pasamos
        // el EntityManager para que la operacion ocurra en la MISMA
        // transaccion (atomicidad del flow hire). El evento queda
        // capturado en `pendingTransferEvent` y se emite POST-COMMIT.
        const transferResult = await this.usersService.transferUser(
          candidate.userId!,
          tenantId,
          {
            newDepartmentId: hireData.newDepartmentId,
            newPositionId: hireData.newPositionId,
            newManagerId: hireData.newManagerId,
            effectiveDate: hireData.effectiveDate,
            reason: `Hire interno desde proceso "${process.title}"${hireData.notes ? ` — ${hireData.notes}` : ''}`,
            triggerSource: 'recruitment_hire',
            cascadePolicy: 'manual', // S2.2 — admin decide caso a caso por defecto
          },
          callerUserId,
          manager,
        );
        resultUserId = transferResult.user.id;
        pendingTransferEvent = transferResult.event;
      } else {
        // Externo: crear nuevo User.
        const newUser = userRepoTx.create({
          tenantId,
          email: candidate.email!,
          firstName: candidate.firstName!,
          lastName: candidate.lastName!,
          passwordHash: passwordHash!,
          role: 'employee',
          managerId: newManager?.id ?? null,
          department: newDept?.name ?? null,
          departmentId: newDept?.id ?? null,
          position: newPos?.name ?? null,
          positionId: newPos?.id ?? null,
          hierarchyLevel: newPos?.level ?? null,
          hireDate: new Date(hireData.effectiveDate),
          isActive: true,
          mustChangePassword: true,
          secondaryManagers: [],
        } as Partial<User>);
        const savedUser = await userRepoTx.save(newUser) as User;

        // Insertar movimiento "joined company" (from=null) para audit
        await movementRepoTx.save(movementRepoTx.create({
          tenantId,
          userId: savedUser.id,
          // POSITION_CHANGE con fromPosition=null representa el alta inicial.
          // En reportes de movilidad este se filtra por effectiveDate +
          // fromPosition IS NULL para distinguir "ingreso" de movimientos
          // internos posteriores.
          movementType: MovementType.POSITION_CHANGE,
          effectiveDate: new Date(hireData.effectiveDate),
          fromDepartment: null,
          toDepartment: savedUser.department || null,
          fromPosition: null,
          toPosition: savedUser.position || null,
          reason: `Contratacion externa desde proceso "${process.title}"${hireData.notes ? ` — ${hireData.notes}` : ''}`,
          approvedBy: callerUserId,
        }));

        resultUserId = savedUser.id;
      }
    });

    // 7. Audit log post-commit (no bloqueamos la respuesta si falla).
    try {
      await this.auditService.log(
        tenantId, callerUserId,
        'recruitment.candidate_hired',
        'recruitment_process', processId,
        {
          candidateId,
          candidateType: candidate.candidateType,
          userId: resultUserId,
          processName: process.title,
          isExternal: !isInternal,
          hireData: {
            effectiveDate: hireData.effectiveDate,
            newDepartmentId: hireData.newDepartmentId,
            newPositionId: hireData.newPositionId,
            newManagerId: hireData.newManagerId,
            contractType: hireData.contractType,
            // No registramos `salary` en audit metadata por privacidad — el dato vive en hire_data del proceso, accesible solo a admins.
          },
        },
      );
    } catch (e: any) {
      this.logger.warn(`Audit log de hire fallo: ${e?.message ?? e}`);
    }

    // S2.1 — emitir `user.transferred` POST-COMMIT para que listeners
    // (evaluaciones, PDI, meetings) reaccionen sobre datos persistidos.
    // Solo aplica para hires INTERNOS — externos crean usuario nuevo
    // (no hay "transfer" desde un estado anterior).
    if (pendingTransferEvent) {
      this.usersService.emitTransferredEvent(pendingTransferEvent);
    }

    // 8. Reload entidades actualizadas.
    const updatedProcess = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    const updatedCandidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });

    return {
      process: updatedProcess!,
      candidate: updatedCandidate!,
      userId: resultUserId,
      tempPassword, // null para internos, password unico para externos
    };
  }

  async getCandidateProfile(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.user', 'user', 'user.tenant_id = c.tenant_id')
      .leftJoinAndSelect('c.process', 'process', 'process.tenant_id = c.tenant_id')
      .where('c.id = :id', { id: candidateId })
      .andWhere('c.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    const interviews = await this.interviewRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.evaluator', 'evaluator', 'evaluator.tenant_id = i.tenant_id')
      .where('i.candidateId = :candidateId', { candidateId })
      .andWhere('i.tenantId = :tenantId', { tenantId })
      .orderBy('i.createdAt', 'DESC')
      .getMany();

    let internalProfile = null;
    if (candidate.candidateType === 'internal' && candidate.userId) {
      internalProfile = await this.getInternalUserProfile(tenantId, candidate.userId);
    }

    return { ...candidate, interviews, internalProfile };
  }

  // ─── Internal User Profile ────────────────────────────────────────────

  private async getInternalUserProfile(tenantId: string, userId: string): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      select: ['id', 'firstName', 'lastName', 'email', 'department', 'position', 'hireDate', 'createdAt'],
    });
    if (!user) return null;

    // Evaluation history
    const assignments = await this.evalAssignmentRepo.find({
      where: { evaluateeId: userId },
      relations: ['cycle'],
      order: { createdAt: 'DESC' },
    });

    const evaluationHistory: any[] = [];
    for (const a of assignments) {
      const response = await this.evalResponseRepo.findOne({
        where: { assignmentId: a.id },
        select: ['overallScore', 'submittedAt'],
      });
      if (response?.overallScore) {
        evaluationHistory.push({
          cycleName: a.cycle?.name || 'Sin nombre',
          score: Number(response.overallScore),
          date: response.submittedAt,
        });
      }
    }

    // Talent assessment
    const talentData = await this.talentRepo.findOne({
      where: { userId, tenantId },
      order: { createdAt: 'DESC' },
    });

    // Calculate tenure
    const startDate = user.hireDate || user.createdAt;
    const tenureMonths = startDate
      ? Math.floor((Date.now() - new Date(startDate).getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    const scores = evaluationHistory.map((e) => e.score);
    const avgScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;

    return {
      user: { ...user, tenureMonths },
      evaluationHistory,
      avgScore,
      talentData: talentData ? {
        performanceScore: talentData.performanceScore,
        potentialScore: talentData.potentialScore,
        nineBoxPosition: talentData.nineBoxPosition,
        talentPool: talentData.talentPool,
      } : null,
    };
  }

  // ─── CV & AI ──────────────────────────────────────────────────────────

  async uploadCv(tenantId: string | undefined, candidateId: string, cvUrl: string): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.cvUrl = cvUrl;
    // Auto-advance stage to cv_review when CV is uploaded
    if (candidate.stage === CandidateStage.REGISTERED) {
      candidate.stage = CandidateStage.CV_REVIEW;
    }
    return this.candidateRepo.save(candidate);
  }

  async analyzeCvWithAi(tenantId: string | undefined, candidateId: string, generatedBy: string): Promise<any> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({
      where,
      relations: ['process'],
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    const effectiveTenantId = candidate.tenantId;
    if (!candidate.cvUrl) throw new BadRequestException('El candidato no tiene CV cargado');

    // This will check AI_INSIGHTS feature + monthly limit + weekly limit
    // and throw if exceeded
    const requirements = candidate.process?.requirements || [];
    const position = candidate.process?.position || '';

    // Build rich context for AI
    const description = candidate.process?.description || '';
    const department = candidate.process?.department || '';

    let context = `CARGO: ${position}\n`;
    if (department) context += `DEPARTAMENTO: ${department}\n`;
    if (description) context += `DESCRIPCION DEL CARGO:\n${description}\n\n`;
    if (requirements.length > 0) {
      // Group requirements by category
      const byCategory: Record<string, string[]> = {};
      for (const r of requirements) {
        const cat = (r as any).category || 'General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push((r as any).text);
      }
      context += 'REQUISITOS DEL CARGO:\n';
      for (const [cat, items] of Object.entries(byCategory)) {
        context += `  ${cat}:\n${items.map((t) => `    - ${t}`).join('\n')}\n`;
      }
    }

    // For internal candidates, add historical context
    if (candidate.candidateType === 'internal' && candidate.userId) {
      const profile = await this.getInternalUserProfile(effectiveTenantId, candidate.userId);
      if (profile?.avgScore) context += `Promedio historico de evaluaciones: ${profile.avgScore}/5\n`;
      if (profile?.talentData?.nineBoxPosition) context += `Posicion 9-Box: ${profile.talentData.nineBoxPosition}\n`;
      if (profile?.user?.tenureMonths) context += `Antiguedad: ${profile.user.tenureMonths} meses\n`;
    }

    // Use AI insights service to analyze (checks rate limits + creates AiInsight record)
    const analysis = await this.aiInsightsService.analyzeCvForRecruitment(
      effectiveTenantId, candidateId, generatedBy, candidate.cvUrl, context,
    );

    // Save analysis to candidate
    candidate.cvAnalysis = analysis.content;
    await this.candidateRepo.save(candidate);

    return analysis;
  }

  async getCvAnalysis(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    return { cvUrl: candidate.cvUrl, cvAnalysis: candidate.cvAnalysis, recruiterNotes: candidate.recruiterNotes };
  }

  async addRecruiterNotes(tenantId: string | undefined, candidateId: string, notes: string): Promise<void> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.recruiterNotes = notes;
    await this.candidateRepo.save(candidate);
  }

  // ─── Interviews ───────────────────────────────────────────────────────

  async submitInterview(tenantId: string | undefined, evaluatorId: string, candidateId: string, dto: any): Promise<RecruitmentInterview> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    let interview = await this.interviewRepo.findOne({ where: { candidateId, evaluatorId } });
    if (interview) {
      interview.requirementChecks = dto.requirementChecks || [];
      interview.comments = dto.comments || null;
      interview.globalScore = dto.globalScore ?? null;
      interview.manualScore = dto.manualScore ?? null;
    } else {
      interview = this.interviewRepo.create({
        candidateId, evaluatorId,
        requirementChecks: dto.requirementChecks || [],
        comments: dto.comments || null,
        globalScore: dto.globalScore ?? null,
        manualScore: dto.manualScore ?? null,
      });
    }
    const saved = await this.interviewRepo.save(interview);

    // Auto-advance stage
    if (candidate.stage === CandidateStage.REGISTERED || candidate.stage === CandidateStage.CV_REVIEW) {
      candidate.stage = CandidateStage.INTERVIEWING;
      await this.candidateRepo.save(candidate);
    }

    // Recalculate candidate final score + auto-advance to scored
    await this.recalculateScore(tenantId, candidateId);
    return saved;
  }

  async getInterviews(tenantId: string, candidateId: string): Promise<RecruitmentInterview[]> {
    // Verify candidate belongs to tenant
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    return this.interviewRepo.find({
      where: { candidateId },
      relations: ['evaluator'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Scorecard ────────────────────────────────────────────────────────

  /**
   * P7 — Si managerCheckUserId es provisto (caller es manager), verifica
   * que haya participado como evaluator en este candidato. Si no, 403.
   * Admin (managerCheckUserId=undefined) ve cualquier scorecard.
   */
  async getScorecard(tenantId: string, candidateId: string, managerCheckUserId?: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId, tenantId },
      relations: ['process', 'user'],
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    const interviews = await this.interviewRepo.find({
      where: { candidateId },
      relations: ['evaluator'],
    });

    // Manager scope: valida participación como evaluator.
    if (managerCheckUserId) {
      const participated = interviews.some((i) => i.evaluatorId === managerCheckUserId);
      if (!participated) {
        throw new ForbiddenException(
          'Solo puedes ver la evaluación de candidatos donde participaste como evaluador.',
        );
      }
    }

    // Calculate interview average
    const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
    const interviewAvg = interviewScores.length > 0
      ? Number((interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length).toFixed(2))
      : null;

    // Calculate requirement fulfillment % (weighted if process has weights)
    const allChecks = interviews.flatMap((i) => i.requirementChecks || []);
    const totalChecks = allChecks.length;
    const hasWeights = allChecks.some((c: any) => c.weight > 0);
    let requirementPct: number | null = null;
    if (totalChecks > 0) {
      if (hasWeights) {
        const scoreMap: Record<string, number> = { cumple: 1, parcial: 0.5, no_cumple: 0 };
        const totalWeight = allChecks.reduce((s: number, c: any) => s + (c.weight || 0), 0);
        const weightedScore = allChecks.reduce((s: number, c: any) => s + (scoreMap[c.status] || 0) * (c.weight || 0), 0);
        requirementPct = totalWeight > 0 ? Number(((weightedScore / totalWeight) * 100).toFixed(1)) : null;
      } else {
        const fulfilledChecks = allChecks.filter((c) => c.status === 'cumple').length;
        const partialChecks = allChecks.filter((c) => c.status === 'parcial').length;
        requirementPct = Number((((fulfilledChecks + partialChecks * 0.5) / totalChecks) * 100).toFixed(1));
      }
    }

    // CV AI match %
    const cvMatchPct = candidate.cvAnalysis?.matchPercentage ?? null;

    // For internal: historical average
    let historyAvg = null;
    if (candidate.candidateType === 'internal' && candidate.userId) {
      const profile = await this.getInternalUserProfile(tenantId, candidate.userId);
      historyAvg = profile?.avgScore ?? null;
    }

    return {
      candidate,
      interviews,
      scores: {
        cvMatchPct,
        interviewAvg,
        requirementPct,
        historyAvg,
        finalScore: candidate.finalScore,
        scoreAdjustment: candidate.scoreAdjustment,
        scoreJustification: candidate.scoreJustification,
      },
      process: candidate.process,
    };
  }

  async adjustScore(tenantId: string | undefined, candidateId: string, adjustment: number, justification: string): Promise<void> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.scoreAdjustment = adjustment;
    candidate.scoreJustification = justification;
    await this.candidateRepo.save(candidate);
    // Recalculate with adjustment usando el tenantId authoritative del candidato.
    await this.recalculateScore(candidate.tenantId, candidateId);
  }

  /**
   * Recalculate the final score for a candidate using ALL available data:
   *
   * CANDIDATO INTERNO:
   *   Pesos por defecto (configurables via process.scoringWeights):
   *     - Entrevistas:   40%  (promedio de globalScore de evaluadores)
   *     - Historial:     30%  (avgScore de evaluaciones pasadas, escala 0-10)
   *     - Requisitos:    20%  (% cumplimiento de requisitos del cargo)
   *     - Match CV IA:   10%  (cvMatchScore del analisis IA, si existe)
   *
   * CANDIDATO EXTERNO:
   *     - Entrevistas:   50%
   *     - Requisitos:    30%
   *     - Match CV IA:   20%
   *
   * Si un componente no tiene datos (ej: no hay entrevistas aun), su peso
   * se redistribuye proporcionalmente entre los que si tienen datos.
   */
  private async recalculateScore(tenantId: string | undefined, candidateId: string): Promise<void> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({
      where,
      relations: ['process'],
    });
    if (!candidate) return;

    // ── 1. Interview average ─────────────────────────────────────────
    const interviews = await this.interviewRepo.find({ where: { candidateId } });
    const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
    const interviewAvg = interviewScores.length > 0
      ? interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length
      : null; // null = no data, not 0

    // ── 2. Requirement fulfillment % → normalized to 0-10 ───────────
    // Calculate from interviews req checks (same logic as getScorecard)
    let reqScore: number | null = null;
    const allReqChecks = interviews.flatMap((i: any) => i.reqChecks || []);
    if (allReqChecks.length > 0) {
      const statusScore: Record<string, number> = { fulfilled: 1, partial: 0.5, not_fulfilled: 0 };
      const hasWeights = allReqChecks.some((c: any) => c.weight > 0);
      if (hasWeights) {
        const totalW = allReqChecks.reduce((s: number, c: any) => s + (c.weight || 0), 0);
        const scored = allReqChecks.reduce((s: number, c: any) => s + (statusScore[c.status] || 0) * (c.weight || 0), 0);
        reqScore = totalW > 0 ? (scored / totalW) * 10 : null;
      } else {
        const fulfilled = allReqChecks.filter((c: any) => c.status === 'fulfilled').length;
        const partial = allReqChecks.filter((c: any) => c.status === 'partial').length;
        reqScore = ((fulfilled + partial * 0.5) / allReqChecks.length) * 10;
      }
    }

    // ── 3. CV Match % → normalized to 0-10 ──────────────────────────
    const cvMatchPct = (candidate as any).cvAnalysis?.matchPercentage ?? null;
    const cvScore = cvMatchPct != null ? (Number(cvMatchPct) / 100) * 10 : null;

    // ── 4. History score (internal only) ─────────────────────────────
    let historyScore: number | null = null;
    if (candidate.candidateType === 'internal' && candidate.userId) {
      const profile = await this.getInternalUserProfile(candidate.tenantId, candidate.userId);
      historyScore = profile?.avgScore ? Math.min(10, Number(profile.avgScore)) : null;
    }

    // ── 5. Build weighted components ─────────────────────────────────
    const isInternal = candidate.candidateType === 'internal';
    const customWeights = candidate.process?.scoringWeights;

    // Components: { value (0-10), weight (%) }
    const components: Array<{ value: number | null; weight: number; label: string }> = isInternal
      ? [
          { value: interviewAvg, weight: customWeights?.interview ?? 40, label: 'interview' },
          { value: historyScore, weight: customWeights?.history ?? 30, label: 'history' },
          { value: reqScore,     weight: customWeights?.requirements ?? 20, label: 'requirements' },
          { value: cvScore,      weight: customWeights?.cvMatch ?? 10, label: 'cvMatch' },
        ]
      : [
          { value: interviewAvg, weight: 50, label: 'interview' },
          { value: reqScore,     weight: 30, label: 'requirements' },
          { value: cvScore,      weight: 20, label: 'cvMatch' },
        ];

    // Filter to components with actual data and redistribute weights
    const withData = components.filter((c) => c.value != null);
    if (withData.length === 0) {
      // No data at all — keep existing score
      return;
    }
    const totalWeight = withData.reduce((s, c) => s + c.weight, 0);

    // Weighted average normalized to the available weights
    let finalScore = withData.reduce((s, c) => s + (c.value! * (c.weight / totalWeight)), 0);

    // Apply manual adjustment if exists
    if (candidate.scoreAdjustment != null) {
      finalScore += Number(candidate.scoreAdjustment);
    }

    candidate.finalScore = Number(Math.max(0, Math.min(10, finalScore)).toFixed(2));

    // Auto-advance to 'scored' if there's a score and still in interviewing
    if (candidate.finalScore > 0 && candidate.stage === CandidateStage.INTERVIEWING) {
      candidate.stage = CandidateStage.SCORED;
    }

    await this.candidateRepo.save(candidate);
  }

  /** Recalculate finalScore for ALL candidates with stale scores.
   *  Needed after fixing the avgScore normalization bug (was /5*10, now direct). */
  async recalculateAllScores(tenantId: string): Promise<{ updated: number }> {
    const candidates = await this.candidateRepo.find({
      where: { tenantId },
      select: ['id'],
    });
    let updated = 0;
    for (const c of candidates) {
      try {
        await this.recalculateScore(tenantId, c.id);
        updated++;
      } catch { /* skip individual failures */ }
    }
    return { updated };
  }

  // ─── Comparative (internal only) ─────────────────────────────────────

  /**
   * P7 — Si managerCheckUserId es provisto (caller es manager), verifica
   * que haya participado como evaluator en al menos un candidato del
   * proceso. Si no, 403.
   */
  async getComparative(tenantId: string, processId: string, managerCheckUserId?: string): Promise<any> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const candidates = await this.candidateRepo.find({
      where: { processId },
      relations: ['user'],
      order: { finalScore: 'DESC' },
    });

    // Manager scope: valida participación como evaluator en al menos un
    // candidato del proceso. Si el proceso no tiene candidatos, tampoco
    // tiene business el manager de verlo (bug found in review — el guard
    // anterior se salteaba con candidates.length === 0).
    if (managerCheckUserId) {
      if (candidates.length === 0) {
        throw new ForbiddenException(
          'Solo puedes ver la comparativa de procesos donde participaste como evaluador.',
        );
      }
      const candidateIds = candidates.map((c) => c.id);
      const hasParticipated = await this.interviewRepo.count({
        where: { candidateId: In(candidateIds), evaluatorId: managerCheckUserId },
      });
      if (hasParticipated === 0) {
        throw new ForbiddenException(
          'Solo puedes ver la comparativa de procesos donde participaste como evaluador.',
        );
      }
    }

    const rows = [];
    for (const c of candidates) {
      const interviews = await this.interviewRepo.find({ where: { candidateId: c.id } });
      const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
      const interviewAvg = interviewScores.length > 0
        ? Number((interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length).toFixed(2))
        : null;

      let internalProfile = null;
      if (c.candidateType === 'internal' && c.userId) {
        internalProfile = await this.getInternalUserProfile(tenantId, c.userId);
      }

      // Requirement fulfillment
      const allChecks = interviews.flatMap((i) => i.requirementChecks || []);
      const requirementSummary: Record<string, { cumple: number; parcial: number; no_cumple: number; total: number }> = {};
      for (const check of allChecks) {
        const key = `${check.category}:${check.text}`;
        if (!requirementSummary[key]) requirementSummary[key] = { cumple: 0, parcial: 0, no_cumple: 0, total: 0 };
        requirementSummary[key][check.status as 'cumple' | 'parcial' | 'no_cumple']++;
        requirementSummary[key].total++;
      }

      rows.push({
        candidate: c,
        interviewAvg,
        internalProfile,
        requirementSummary,
        cvMatchPct: c.cvAnalysis?.matchPercentage ?? null,
      });
    }

    return { process, requirements: process.requirements, rows };
  }

  async generateAiRecommendation(tenantId: string | undefined, processId: string, generatedBy: string): Promise<any> {
    // Resolver process primero para el tenantId authoritative.
    const processWhere = tenantId ? { id: processId, tenantId } : { id: processId };
    const processEntity = await this.processRepo.findOne({ where: processWhere });
    if (!processEntity) throw new NotFoundException('Proceso no encontrado');
    const effectiveTenantId = processEntity.tenantId;

    const comparative = await this.getComparative(effectiveTenantId, processId);

    // Use AI insights service (checks rate limits)
    return this.aiInsightsService.generateRecruitmentRecommendation(
      effectiveTenantId, processId, generatedBy, comparative,
    );
  }
}
