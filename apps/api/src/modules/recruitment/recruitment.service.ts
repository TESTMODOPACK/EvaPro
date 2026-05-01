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
import { RecruitmentCandidateStageHistory } from './entities/recruitment-candidate-stage-history.entity';
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
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EmailService } from '../notifications/email.service';
import { Tenant } from '../tenants/entities/tenant.entity';

@Injectable()
export class RecruitmentService {
  private readonly logger = new Logger(RecruitmentService.name);

  constructor(
    @InjectRepository(RecruitmentProcess) private readonly processRepo: Repository<RecruitmentProcess>,
    @InjectRepository(RecruitmentCandidate) private readonly candidateRepo: Repository<RecruitmentCandidate>,
    @InjectRepository(RecruitmentEvaluator) private readonly evaluatorRepo: Repository<RecruitmentEvaluator>,
    @InjectRepository(RecruitmentInterview) private readonly interviewRepo: Repository<RecruitmentInterview>,
    // S6.1 — historial de transiciones de stage para metricas.
    @InjectRepository(RecruitmentCandidateStageHistory)
    private readonly stageHistoryRepo: Repository<RecruitmentCandidateStageHistory>,
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
    // S4.3 — para notificar tenant_admins de procesos legacy con
    // posibles cascadas pendientes (pre-S1).
    private readonly notificationsService: NotificationsService,
    // S5.1 — para enviar email de bienvenida al ganador externo
    // tras el hire (con tempPassword + URL de login).
    private readonly emailService: EmailService,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
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
  async updateProcess(
    tenantId: string | undefined,
    id: string,
    dto: any,
    callerUserId?: string,
  ): Promise<RecruitmentProcess> {
    const where = tenantId ? { id, tenantId } : { id };
    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    const effectiveTenantId = process.tenantId;
    const previousStatus = process.status;
    // S4.1 — snapshot para detectar cambios sensibles (scoringWeights,
    // requirements). Hacemos una copia profunda barata via JSON para no
    // capturar referencia mutable que despues se modifique en el merge.
    const previousScoringWeights = process.scoringWeights ? JSON.parse(JSON.stringify(process.scoringWeights)) : null;
    const previousRequirements = process.requirements ? JSON.parse(JSON.stringify(process.requirements)) : null;

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
        // S3.x v2 — REOPEN ya NO ejecuta el rollback automaticamente.
        // Antes este path:
        //   1. Cambiaba candidato HIRED → APPROVED
        //   2. Cambiaba NOT_HIRED → APPROVED
        //   3. Limpiaba winningCandidateId y hireData
        // Pero eso DESTRUIA `hireData.previousUserState` que el boton
        // "Revertir contratación" necesita para hacer rollback de la
        // cascada al empleado (dept/cargo/manager + user_movement).
        //
        // Nuevo comportamiento: reopen solo cambia status. Si hay un
        // hired pendiente (process.winningCandidateId), el frontend
        // muestra el boton "Revertir contratación" en la tarjeta del
        // candidato — el admin decide explicitamente si quiere:
        //   (a) Revertir el hire (rollback completo via el boton)
        //   (b) Reabrir sin revertir (caso: agregar mas candidatos
        //       a evaluar mientras conserva el hire actual)
        //
        // Si winningCandidateId esta seteado, el modal "Generar
        // contratacion" se va a bloquear con error claro hasta que
        // el admin haga la reversion explicita.
      }
    }

    const saved = await this.processRepo.save(process);

    // S4.2 — Al reabrir, restaurar CVs archivados (cv_url_archived → cv_url)
    // para que el recruiter pueda continuar el proceso con los CVs vigentes.
    // El flow del archivo es:
    //   close/complete → cv_url goes to cv_url_archived
    //   reopen        → cv_url_archived comes back to cv_url
    // Compliance OK: el clock de 24m se reinicia con cada cierre — si el
    // admin reabre y vuelve a cerrar, contamos desde el ultimo cierre.
    // Esta regeneracion solo aplica si el CV NO ha sido purgado por el
    // cron (que solo dispara despues de 24m de archivado).
    if (
      dto.status !== undefined &&
      dto.status !== previousStatus &&
      (previousStatus === ProcessStatus.COMPLETED || previousStatus === ProcessStatus.CLOSED) &&
      dto.status === ProcessStatus.ACTIVE
    ) {
      const restoreResult = await this.candidateRepo
        .createQueryBuilder()
        .update()
        .set({
          cvUrl: () => 'cv_url_archived',
          cvUrlArchived: null,
          cvArchivedAt: null,
        })
        .where('process_id = :processId AND cv_url_archived IS NOT NULL', { processId: id })
        .execute();
      const restored = restoreResult.affected ?? 0;
      if (restored > 0) {
        this.logger.log(`Restored ${restored} archived CV(s) on reopen of process ${id}`);
        this.auditService
          .log(effectiveTenantId, callerUserId ?? null, 'recruitment.cvs_restored', 'recruitment_process', id, {
            count: restored,
          })
          .catch(() => {});
      }
    }

    // S4.2 — Archivar CVs en lugar de borrarlos al cerrar proceso.
    // Compliance Chile (Ley 19.628): los CV de procesos de seleccion
    // deben conservarse 24 meses despues del cierre. Antes de S4 esta
    // misma rama borraba cv_url destruyendo el dato — esto era una
    // violacion de retencion legal.
    //
    // Nuevo comportamiento (solo si la transicion es real a closed/completed):
    //   - Mueve cv_url → cv_url_archived (preserva el data URL base64).
    //   - Setea cv_archived_at = NOW().
    //   - Setea cv_url = NULL (oculto en UI activa, libera referencias).
    //
    // El cron `purgeArchivedCvs` (definido mas abajo, corre diario) se
    // encarga de la deletion final cuando cv_archived_at < NOW() - 24m.
    //
    // Idempotente: el WHERE filtra cv_url IS NOT NULL, asi que un re-run
    // sobre el mismo proceso (que ya archivo) no toca filas. Si ya hay
    // valor en cv_url_archived no lo pisa porque la query filtra por
    // cv_url IS NOT NULL — solo afecta candidatos que tienen CV activo.
    const statusChanged = dto.status !== undefined && dto.status !== previousStatus;
    if (statusChanged && (dto.status === 'closed' || dto.status === 'completed')) {
      const result = await this.candidateRepo
        .createQueryBuilder()
        .update()
        .set({
          cvUrlArchived: () => 'cv_url',
          cvArchivedAt: () => 'NOW()',
          cvUrl: null,
        })
        .where('process_id = :processId AND cv_url IS NOT NULL', { processId: id })
        .execute();
      const affected = result.affected ?? 0;
      if (affected > 0) {
        this.logger.log(`Archived ${affected} CV(s) for closed process ${id} (compliance: 24m retention)`);
        this.auditService
          .log(effectiveTenantId, callerUserId ?? null, 'recruitment.cvs_archived', 'recruitment_process', id, {
            count: affected,
            reason: dto.status,
          })
          .catch(() => {});
      }
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
        .log(effectiveTenantId, callerUserId ?? null, action, 'recruitment_process', id, {
          from: previousStatus,
          to: dto.status,
        })
        .catch(() => undefined);
    }

    // S4.1 — auditar cambios sensibles que afectan el resultado del proceso:
    //   - scoringWeights: redistribuye los pesos del score final → puede
    //     cambiar el ranking de candidatos sin re-evaluar entrevistas.
    //   - requirements: el set de criterios contra el que se mide el cumplimiento
    //     y, por tanto, el % de match que entra al score.
    // Loguear ambos eventos por separado para que un audit trail muestre
    // claramente "el admin X modifico la formula" vs "el admin X cambio que
    // cuenta como requisito".
    if (
      dto.scoringWeights !== undefined &&
      JSON.stringify(previousScoringWeights) !== JSON.stringify(saved.scoringWeights)
    ) {
      this.auditService
        .log(effectiveTenantId, callerUserId ?? null, 'recruitment.scoring_weights_updated', 'recruitment_process', id, {
          previous: previousScoringWeights,
          new: saved.scoringWeights,
        })
        .catch(() => {});
    }
    if (
      dto.requirements !== undefined &&
      JSON.stringify(previousRequirements) !== JSON.stringify(saved.requirements)
    ) {
      this.auditService
        .log(effectiveTenantId, callerUserId ?? null, 'recruitment.requirements_updated', 'recruitment_process', id, {
          previousCount: Array.isArray(previousRequirements) ? previousRequirements.length : 0,
          newCount: Array.isArray(saved.requirements) ? saved.requirements.length : 0,
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * v3.1 — Cron diario que cierra automáticamente procesos ACTIVE con
   * endDate < hoy. Los marca como CLOSED con autoClosed=true para poder
   * distinguirlos en UI (badge "Cerrado automáticamente") y permitir
   * reabrir fácilmente.
   *
   * Corre a las 01:00 UTC (madrugada en LATAM). No dispara emails.
   *
   * S4.2 — Ahora SI archiva CVs al cerrar (compliance Chile 24m). El
   * comentario antiguo decia "no limpia CV data" porque la limpieza
   * antigua era destructiva (= violacion); con archivado preservamos
   * el dato 24m via cv_url_archived + cv_archived_at, asi que es seguro
   * (y necesario) hacerlo aca tambien.
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
                // S4.2 — Archivar CVs (mismo flow que cierre manual).
                const archiveResult = await this.candidateRepo
                  .createQueryBuilder()
                  .update()
                  .set({
                    cvUrlArchived: () => 'cv_url',
                    cvArchivedAt: () => 'NOW()',
                    cvUrl: null,
                  })
                  .where('process_id = :processId AND cv_url IS NOT NULL', { processId: p.id })
                  .execute();
                const archivedCount = archiveResult.affected ?? 0;
                await this.auditService
                  .log(p.tenantId, null, 'recruitment.process_auto_closed', 'recruitment_process', p.id, {
                    title: p.title,
                    closedAt: new Date().toISOString(),
                    cvsArchived: archivedCount,
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

  /**
   * S4.2 — Cron diario que purga (deletion permanente) CVs archivados
   * que ya cumplieron los 24 meses de retención post-cierre. Compliance
   * Chile: la Ley 19.628 + DT 19.628 establece que los datos personales
   * de procesos de selección no pueden conservarse mas alla del tiempo
   * necesario para la finalidad — interpretacion conservadora de la
   * industria es 24 meses post-decision.
   *
   * Despues del purge, queda en BD:
   *   - Audit log del proceso (no contiene CV, solo metadatos).
   *   - cv_analysis (ya no es PII si el admin lo limpio; futura mejora:
   *     borrar cv_analysis tambien).
   *   - El registro del candidato en si (nombre, email) — esto se evalua
   *     en otro sprint si requiere purge tambien.
   *
   * Corre diario a las 02:00 UTC (despues del autoClose). No requiere
   * iterar por tenant — es una operacion BD-wide segura porque tenant_id
   * se preserva en la query y RLS no aplica a CRON connection.
   *
   * Idempotente: si corre dos veces el mismo día solo afecta filas con
   * cv_url_archived IS NOT NULL → la segunda corrida encuentra 0.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeArchivedCvs(): Promise<void> {
    await runWithCronLock(
      'recruitment.purgeArchivedCvs',
      this.dataSource,
      this.logger,
      async () => {
        // Borra cv_url_archived + cv_archived_at de filas cuyo archivado
        // tiene 24m+. Postgres `INTERVAL '24 months'` es seguro y maneja
        // años bisiestos correctamente.
        const result = await this.candidateRepo
          .createQueryBuilder()
          .update()
          .set({
            cvUrlArchived: null,
            cvArchivedAt: null,
          })
          .where('cv_url_archived IS NOT NULL AND cv_archived_at < NOW() - INTERVAL \'24 months\'')
          .execute();
        const affected = result.affected ?? 0;
        if (affected > 0) {
          this.logger.log(`[purgeArchivedCvs] CVs purgados (24m retention): ${affected}`);
          await this.auditService
            .log(null, null, 'recruitment.cvs_purged', 'recruitment_candidate', null as any, {
              count: affected,
              retentionMonths: 24,
            })
            .catch(() => undefined);
        }
      },
    );
  }

  /**
   * S4.3 — Detector semanal de procesos COMPLETED legacy (pre-S1) donde
   * la cascada al User no se ejecuto.
   *
   * Contexto: antes de S1 (Sprint 1) el flow de "marcar como contratado"
   * solo cambiaba candidate.stage a 'hired' y process.status a 'completed',
   * pero NO actualizaba users.department/position/manager ni insertaba
   * user_movements. Esto generaba inconsistencias: el candidato quedaba
   * marcado como contratado en recruitment, pero su registro en users
   * no reflejaba el nuevo cargo. El historial de movilidad estaba vacio.
   *
   * S1+ todos los hires nuevos pasan por hireCandidate() que ejecuta
   * la cascada en una transaccion. Los hires post-S1 tienen:
   *   - process.winningCandidateId set
   *   - process.hireData con previousUserState/effectiveDate
   *   - user_movement insertado con effectiveDate del hire
   *
   * Este cron busca hires que tienen el primer flag pero no el ultimo
   * (i.e., hires hechos via UI antigua). Para cada uno detectado:
   *   1. Crea audit log 'recruitment.legacy_hire_detected' (para dedup
   *      en futuras corridas).
   *   2. Notifica al tenant_admin con metadata para que pueda revisar
   *      manualmente desde el modulo de Mantenedores → Usuarios.
   *
   * Idempotencia: chequea audit_logs antes de notificar de nuevo. Si
   * ya hay un 'recruitment.legacy_hire_detected' para este candidateId,
   * skip.
   *
   * Corre semanal (domingo 03:00 UTC) — es deteccion de edge cases, no
   * urgente. Tampoco va a producir muchos resultados; despues de la
   * primera corrida la mayoria queda atendida.
   */
  @Cron('0 03 * * 0')
  async detectLegacyHiresWithoutCascade(): Promise<void> {
    await runWithCronLock(
      'recruitment.detectLegacyHiresWithoutCascade',
      this.dataSource,
      this.logger,
      async () => {
        await this.tenantCronRunner.runForEachTenant(
          'recruitment.detectLegacyHiresWithoutCascade',
          async (tenantId) => {
            // 1. Buscar candidatos internos en stage HIRED cuyo proceso
            //    esta COMPLETED. Solo internos: externos siempre crean
            //    User (no hay "estado previo" que podamos verificar).
            const hiredInternals = await this.candidateRepo.find({
              where: {
                tenantId,
                stage: CandidateStage.HIRED,
                candidateType: 'internal',
              },
              relations: ['process'],
            });

            if (hiredInternals.length === 0) return;

            // 2. Filtrar a los que NO tienen evidencia de cascada:
            //    - hireData es null (definitivamente pre-S1), O
            //    - no existe user_movement con effective_date matching
            //      el hireData.effectiveDate.
            const auditRepo = this.dataSource.getRepository(AuditLog);
            const movementRepo = this.dataSource.getRepository(UserMovement);
            const flagged: Array<{ candidate: RecruitmentCandidate; reason: string }> = [];

            for (const cand of hiredInternals) {
              if (!cand.process || cand.process.status !== ProcessStatus.COMPLETED) continue;
              if (!cand.userId) continue;

              const hireData: any = cand.process.hireData;
              if (!hireData || !hireData.effectiveDate) {
                flagged.push({ candidate: cand, reason: 'no_hire_data' });
                continue;
              }
              // Verificar movement existe — si no existe, la cascada
              // probablemente no corrio. Comparamos como string YYYY-MM-DD
              // contra la columna `date` para evitar shifts por timezone
              // (new Date('2025-04-01') seria 2025-04-01T00:00:00Z y al
              // compararse contra date podria caer en 2025-03-31 segun TZ
              // del cliente Postgres).
              const movementCount = await movementRepo
                .createQueryBuilder('m')
                .where('m.tenant_id = :tid', { tid: tenantId })
                .andWhere('m.user_id = :uid', { uid: cand.userId })
                .andWhere('m.effective_date = :ed::date', { ed: String(hireData.effectiveDate) })
                .getCount();
              if (movementCount === 0) {
                flagged.push({ candidate: cand, reason: 'no_movement_for_effective_date' });
              }
            }

            if (flagged.length === 0) return;

            // 3. Para cada flagged, dedup contra audit_logs y notificar.
            const tenantAdmins = await this.userRepo.find({
              where: { tenantId, role: 'tenant_admin', isActive: true },
              select: ['id'],
            });
            if (tenantAdmins.length === 0) {
              this.logger.warn(
                `[detectLegacyHiresWithoutCascade] tenant=${tenantId.slice(0, 8)} sin tenant_admin activo, skip`,
              );
              return;
            }

            for (const f of flagged) {
              // Dedup: si ya existe audit log de detection para este
              // candidato, no re-notificamos (evita spam semanal hasta
              // que el admin atienda).
              const existing = await auditRepo.count({
                where: {
                  tenantId,
                  action: 'recruitment.legacy_hire_detected',
                  entityType: 'recruitment_candidate',
                  entityId: f.candidate.id,
                },
              });
              if (existing > 0) continue;

              // Audit (registra la deteccion para dedup futuro).
              await this.auditService
                .log(tenantId, null, 'recruitment.legacy_hire_detected', 'recruitment_candidate', f.candidate.id, {
                  processId: f.candidate.processId,
                  processTitle: f.candidate.process?.title,
                  userId: f.candidate.userId,
                  reason: f.reason,
                })
                .catch(() => undefined);

              // Notificar a cada tenant_admin activo.
              const candName = `${f.candidate.firstName ?? ''} ${f.candidate.lastName ?? ''}`.trim() || 'Candidato sin nombre';
              for (const admin of tenantAdmins) {
                await this.notificationsService
                  .create({
                    tenantId,
                    userId: admin.id,
                    type: NotificationType.GENERAL,
                    title: 'Proceso legacy sin cascada detectado',
                    message: `El proceso "${f.candidate.process?.title ?? 'sin titulo'}" tiene a ${candName} marcado como contratado, pero no hay registro de cambio de cargo/area en el empleado. Revise y actualice manualmente desde Mantenedores → Usuarios si corresponde.`,
                    metadata: {
                      kind: 'recruitment_legacy_hire',
                      processId: f.candidate.processId,
                      candidateId: f.candidate.id,
                      userId: f.candidate.userId,
                      reason: f.reason,
                    },
                  })
                  .catch((e: any) => {
                    this.logger.warn(
                      `[detectLegacyHiresWithoutCascade] no se pudo notificar a admin ${admin.id}: ${e?.message ?? e}`,
                    );
                  });
              }
            }

            this.logger.log(
              `[detectLegacyHiresWithoutCascade] tenant=${tenantId.slice(0, 8)} procesos legacy detectados: ${flagged.length}`,
            );
          },
        );
      },
    );
  }

  /**
   * S6.1 — Backfill de stage_history desde audit_logs para candidatos
   * legacy (creados antes de S6.1).
   *
   * Estrategia:
   *   1. Encuentra candidatos cuyo set de filas en
   *      recruitment_candidate_stage_history este vacio.
   *   2. Para cada uno, lee audit_logs.recruitment.candidate_stage_changed
   *      ordenado por created_at (cronologico) y reconstruye el historial.
   *   3. Tambien inserta la transicion inicial null → registered usando
   *      el `created_at` del candidato (mejor aproximacion al momento
   *      del create).
   *
   * Idempotente: si un candidato ya tiene >=1 fila, se skipea. Esto
   * evita doble-backfill si el cron corre 2x.
   *
   * Corre diario a las 04:00 UTC. Despues de la primera corrida que
   * limpia el backlog, las corridas siguientes son no-op excepto si se
   * agregan candidatos directo en BD (caso raro pero posible en
   * imports masivos).
   *
   * Limitado a 100 candidatos por corrida para no consumir recursos en
   * tenants con miles de candidatos legacy. Eventualmente todos se
   * cubren en N dias.
   */
  @Cron('0 04 * * *')
  async backfillStageHistoryFromAudit(): Promise<void> {
    await runWithCronLock(
      'recruitment.backfillStageHistoryFromAudit',
      this.dataSource,
      this.logger,
      async () => {
        await this.tenantCronRunner.runForEachTenant(
          'recruitment.backfillStageHistoryFromAudit',
          async (tenantId) => {
            // Identificar candidatos sin history.
            const candidatesWithoutHistory = await this.dataSource.query(
              `SELECT c.id, c.stage, c.created_at, c.tenant_id
               FROM recruitment_candidates c
               WHERE c.tenant_id = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM recruitment_candidate_stage_history h
                   WHERE h.candidate_id = c.id
                 )
               ORDER BY c.created_at ASC
               LIMIT 100`,
              [tenantId],
            );

            if (candidatesWithoutHistory.length === 0) return;

            const auditRepo = this.dataSource.getRepository(AuditLog);
            for (const cand of candidatesWithoutHistory) {
              try {
                // 1. Stage inicial (null → registered) usando candidate.created_at.
                // Asumimos que el primer stage al crear era 'registered' (default
                // del enum en el momento de la insercion). Si el candidato ya
                // estaba en otro stage al ser creado (caso raro), igual la
                // primer fila representa el momento del create — el stage
                // verdadero queda capturado en las filas siguientes derivadas
                // del audit log.
                await this.stageHistoryRepo.save(
                  this.stageHistoryRepo.create({
                    candidateId: cand.id,
                    tenantId: cand.tenant_id,
                    fromStage: null,
                    toStage: 'registered',
                    changedAt: cand.created_at,
                    changedBy: null,
                    source: 'backfill',
                  }),
                );

                // 2. Para cada audit log de candidate_stage_changed, insertar
                //    una fila reconstruida.
                const audits = await auditRepo.find({
                  where: {
                    tenantId,
                    action: 'recruitment.candidate_stage_changed',
                    entityType: 'recruitment_candidate',
                    entityId: cand.id,
                  },
                  order: { createdAt: 'ASC' },
                });
                if (audits.length > 0) {
                  const rows = audits.map((a) =>
                    this.stageHistoryRepo.create({
                      candidateId: cand.id,
                      tenantId: cand.tenant_id,
                      fromStage: (a.metadata as any)?.from ?? null,
                      toStage: (a.metadata as any)?.to ?? cand.stage,
                      changedAt: a.createdAt,
                      changedBy: a.userId ?? null,
                      source: 'backfill',
                    }),
                  );
                  await this.stageHistoryRepo.save(rows);
                }
              } catch (e: any) {
                this.logger.warn(
                  `[backfillStageHistoryFromAudit] candidato ${cand.id} fallo: ${e?.message ?? e}`,
                );
              }
            }

            this.logger.log(
              `[backfillStageHistoryFromAudit] tenant=${tenantId.slice(0, 8)} backfill: ${candidatesWithoutHistory.length} candidatos`,
            );
          },
        );
      },
    );
  }

  // ─── Candidates ───────────────────────────────────────────────────────

  async addExternalCandidate(
    tenantId: string | undefined,
    processId: string,
    dto: any,
    callerUserId?: string,
  ): Promise<RecruitmentCandidate> {
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
    const saved = await this.candidateRepo.save(candidate);
    // S4.1 — audit log
    this.auditService
      .log(effectiveTenantId, callerUserId ?? null, 'recruitment.candidate_added', 'recruitment_candidate', saved.id, {
        processId, processTitle: process.title, candidateType: 'external',
        firstName: saved.firstName, lastName: saved.lastName, email: saved.email,
      })
      .catch(() => {});
    // S6.1 — registro de stage inicial.
    await this.recordStageTransition({
      candidateId: saved.id,
      tenantId: effectiveTenantId,
      fromStage: null,
      toStage: saved.stage,
      changedBy: callerUserId ?? null,
      source: 'candidate_created',
    });
    return saved;
  }

  async addInternalCandidate(
    tenantId: string | undefined,
    processId: string,
    userId: string,
    callerUserId?: string,
  ): Promise<RecruitmentCandidate> {
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
    const saved = await this.candidateRepo.save(candidate);
    // S4.1 — audit log
    this.auditService
      .log(effectiveTenantId, callerUserId ?? null, 'recruitment.candidate_added', 'recruitment_candidate', saved.id, {
        processId, processTitle: process.title, candidateType: 'internal',
        userId, firstName: user.firstName, lastName: user.lastName,
      })
      .catch(() => {});
    // S6.1 — registro de stage inicial.
    await this.recordStageTransition({
      candidateId: saved.id,
      tenantId: effectiveTenantId,
      fromStage: null,
      toStage: saved.stage,
      changedBy: callerUserId ?? null,
      source: 'candidate_created',
    });
    return saved;
  }

  async updateCandidate(
    tenantId: string | undefined,
    candidateId: string,
    dto: any,
    callerUserId?: string,
  ): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    const changedFields: string[] = [];
    if (dto.email !== undefined && dto.email !== candidate.email) { candidate.email = dto.email; changedFields.push('email'); }
    if (dto.phone !== undefined && dto.phone !== candidate.phone) { candidate.phone = dto.phone; changedFields.push('phone'); }
    if (dto.linkedIn !== undefined && dto.linkedIn !== candidate.linkedIn) { candidate.linkedIn = dto.linkedIn; changedFields.push('linkedIn'); }
    if (dto.availability !== undefined && dto.availability !== candidate.availability) { candidate.availability = dto.availability; changedFields.push('availability'); }
    if (dto.salaryExpectation !== undefined && dto.salaryExpectation !== candidate.salaryExpectation) { candidate.salaryExpectation = dto.salaryExpectation; changedFields.push('salaryExpectation'); }
    if (dto.recruiterNotes !== undefined && dto.recruiterNotes !== candidate.recruiterNotes) { candidate.recruiterNotes = dto.recruiterNotes; changedFields.push('recruiterNotes'); }
    const saved = await this.candidateRepo.save(candidate);
    // S4.1 — audit log (solo si hubo cambios reales)
    if (changedFields.length > 0) {
      this.auditService
        .log(candidate.tenantId, callerUserId ?? null, 'recruitment.candidate_updated', 'recruitment_candidate', candidateId, {
          changedFields,
        })
        .catch(() => {});
    }
    return saved;
  }

  async updateCandidateStage(
    tenantId: string | undefined,
    candidateId: string,
    stage: string,
    callerUserId?: string,
  ): Promise<RecruitmentCandidate> {
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
    // S3.x — Bloquear cambio DESDE 'hired' hacia cualquier otro stage.
    // Si el admin quiere revertir una contratacion, debe usar "Reabrir
    // proceso" en Configuracion, lo cual ejecuta el rollback completo:
    // limpia winningCandidateId + hireData del proceso, y revierte
    // candidatos no_hired→approved. Permitir el cambio aqui dejaria
    // candidato en stage 'approved' pero process.winningCandidateId
    // todavia apuntando a el — banner de "contratado" no desaparece y
    // el modal no permite contratar a otro porque cree que ya hay
    // ganador. Defense-in-depth para calls API directos.
    if (candidate.stage === CandidateStage.HIRED) {
      throw new BadRequestException(
        'No se puede cambiar el estado de un candidato contratado directamente. Para revertir la contratación, use "Reabrir proceso" en Configuración → Estado del Proceso. Eso ejecuta el rollback completo (libera el proceso, revierte cascada al empleado).',
      );
    }
    const previousStage = candidate.stage;
    candidate.stage = stage as CandidateStage;
    const saved = await this.candidateRepo.save(candidate);
    // S4.1 — audit log (solo si realmente cambia el stage)
    if (previousStage !== saved.stage) {
      this.auditService
        .log(candidate.tenantId, callerUserId ?? null, 'recruitment.candidate_stage_changed', 'recruitment_candidate', candidateId, {
          from: previousStage,
          to: saved.stage,
          processId: candidate.processId,
        })
        .catch(() => {});
      // S6.1 — historial de transicion.
      await this.recordStageTransition({
        candidateId: saved.id,
        tenantId: candidate.tenantId,
        fromStage: previousStage,
        toStage: saved.stage,
        changedBy: callerUserId ?? null,
        source: 'manual',
      });
    }
    return saved;
  }

  /**
   * S3.x — Revertir contratación de un candidato.
   *
   * Operación opuesta a hireCandidate: el admin marcó accidentalmente
   * a alguien como contratado o quiere cambiar el ganador. Este metodo
   * deshace el flow del hire en una transacción atómica:
   *
   * 1. candidate.stage HIRED → APPROVED
   * 2. process.status COMPLETED → ACTIVE (solo si esta completed por
   *    este hire — si esta closed por otro motivo no tocamos)
   * 3. process.winningCandidateId → NULL, process.hireData → NULL
   * 4. Otros candidatos del proceso en stage NOT_HIRED → APPROVED
   *    (vuelven a ser candidatos viables)
   *
   * **Lo que NO revierte (limitación documentada en el frontend):**
   * - users.department / position / manager del candidato — quedaron
   *   actualizados al hire. Si el admin necesita revertir el cambio del
   *   empleado, debe editar desde Mantenedores → Usuarios manualmente.
   * - users_movements row insertada — se preserva como historial
   *   inmutable (si la persona realmente cambio de area aunque sea por
   *   horas, queda registro). Si fue puro error de admin, puede borrar
   *   la fila desde Mantenedores → Movimientos (futuro).
   *
   * Audit log: 'recruitment.hire_reverted' con metadata.
   *
   * @returns { candidate, process } actualizados.
   */
  async revertHire(
    tenantId: string,
    candidateId: string,
    callerUserId: string,
  ): Promise<{ candidate: RecruitmentCandidate; process: RecruitmentProcess }> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (candidate.stage !== CandidateStage.HIRED) {
      throw new BadRequestException(
        `Solo se puede revertir contrataciones. Este candidato esta en stage '${candidate.stage}', no 'hired'.`,
      );
    }

    const process = await this.processRepo.findOne({ where: { id: candidate.processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso del candidato no encontrado');

    // S3.x — Snapshot del state previo capturado al hire (solo internos).
    // Si existe, en la tx revertimos los cambios al User y borramos el
    // user_movement insertado por el hire.
    const previousUserState = (process.hireData as any)?.previousUserState ?? null;
    const previousCandidateStages: Record<string, string> | null =
      (process.hireData as any)?.previousCandidateStages ?? null;
    const hireEffectiveDate = (process.hireData as any)?.effectiveDate ?? null;
    const isInternalHire = candidate.candidateType === 'internal' && !!candidate.userId;

    await this.dataSource.transaction(async (manager) => {
      const candRepo = manager.getRepository(RecruitmentCandidate);
      const procRepo = manager.getRepository(RecruitmentProcess);
      const userRepoTx = manager.getRepository(User);
      const movementRepoTx = manager.getRepository(UserMovement);

      // 1. candidate.stage HIRED → estado previo (de previousCandidateStages
      //    si existe, sino fallback a APPROVED).
      const winnerPrevStage = (previousCandidateStages?.[candidateId] as CandidateStage) ?? CandidateStage.APPROVED;
      const c1 = await candRepo.update(
        { id: candidateId, tenantId, stage: CandidateStage.HIRED },
        { stage: winnerPrevStage },
      );
      if (!c1.affected) {
        throw new BadRequestException(
          'El candidato cambió de estado durante la reversión. Recargue y vuelva a intentar.',
        );
      }

      // 2. Restaurar otros candidatos a su estado previo (de
      //    previousCandidateStages). Si no hay snapshot, fallback al
      //    comportamiento anterior: NOT_HIRED → APPROVED.
      const stageHistoryRepoTx = manager.getRepository(RecruitmentCandidateStageHistory);
      // Acumulamos rows de historial para insertarlas en bulk al final.
      const revertHistoryRows: RecruitmentCandidateStageHistory[] = [];
      // Winner: HIRED → winnerPrevStage (siempre cambia, salvo edge case
      // donde winnerPrevStage === HIRED — no posible porque previo al hire
      // era hireable).
      revertHistoryRows.push(
        stageHistoryRepoTx.create({
          candidateId,
          tenantId,
          fromStage: CandidateStage.HIRED,
          toStage: winnerPrevStage,
          changedBy: callerUserId,
          source: 'revert_hire',
        }),
      );
      if (previousCandidateStages && Object.keys(previousCandidateStages).length > 0) {
        // Para cada otro candidato con snapshot, restaurarlo a su stage
        // previo SOLO si esta actualmente en NOT_HIRED (no pisar cambios
        // posteriores al hire que pudieran existir).
        for (const [cid, prevStage] of Object.entries(previousCandidateStages)) {
          if (cid === candidateId) continue; // ya manejado arriba
          const r = await candRepo
            .createQueryBuilder()
            .update(RecruitmentCandidate)
            .set({ stage: prevStage as CandidateStage })
            .where('id = :cid', { cid })
            .andWhere('tenant_id = :tid', { tid: tenantId })
            .andWhere('stage = :nh', { nh: CandidateStage.NOT_HIRED })
            .execute();
          // Solo registramos history si efectivamente se actualizo (affected>0).
          if ((r.affected ?? 0) > 0) {
            revertHistoryRows.push(
              stageHistoryRepoTx.create({
                candidateId: cid,
                tenantId,
                fromStage: CandidateStage.NOT_HIRED,
                toStage: prevStage,
                changedBy: callerUserId,
                source: 'revert_hire',
              }),
            );
          }
        }
      } else {
        // Backward compat: hires viejos sin snapshot → fallback a APPROVED
        const fallbackResult = await candRepo
          .createQueryBuilder()
          .update(RecruitmentCandidate)
          .set({ stage: CandidateStage.APPROVED })
          .where('process_id = :pid', { pid: candidate.processId })
          .andWhere('tenant_id = :tid', { tid: tenantId })
          .andWhere('stage = :nh', { nh: CandidateStage.NOT_HIRED })
          .execute();
        if ((fallbackResult.affected ?? 0) > 0) {
          // No tenemos los IDs en bulk update — para audit basta saber
          // que pasaron N candidatos a APPROVED via revert. Detallamos
          // a nivel candidato solo cuando hay snapshot. Esto es legacy
          // path por diseño.
          this.logger.log(
            `[revertHire] backfill legacy: ${fallbackResult.affected} candidatos NOT_HIRED → APPROVED (sin history individual por falta de snapshot)`,
          );
        }
      }
      if (revertHistoryRows.length > 0) {
        await stageHistoryRepoTx.save(revertHistoryRows);
      }

      // 3. ROLLBACK CASCADA AL USER (solo internos con previousUserState).
      // Restauramos dept/cargo/manager al estado pre-hire. Si no tenemos
      // snapshot (procesos hireados antes de S3.x), saltamos esta parte
      // y dejamos que el admin ajuste manualmente desde Mantenedores.
      if (isInternalHire && previousUserState) {
        await userRepoTx.update(
          { id: candidate.userId!, tenantId },
          {
            departmentId: previousUserState.departmentId as any,
            department: previousUserState.department as any,
            positionId: previousUserState.positionId as any,
            position: previousUserState.position as any,
            managerId: previousUserState.managerId as any,
            hierarchyLevel: previousUserState.hierarchyLevel as any,
          },
        );

        // 4. Borrar el user_movement insertado por el hire. Match por
        //    userId + effectiveDate (de hireData). Si hay multiples
        //    movements en la misma fecha (improbable), borramos el mas
        //    reciente (created_at DESC LIMIT 1).
        if (hireEffectiveDate) {
          const moveToDelete = await movementRepoTx
            .createQueryBuilder('m')
            .where('m.user_id = :uid', { uid: candidate.userId })
            .andWhere('m.tenant_id = :tid', { tid: tenantId })
            .andWhere('m.effective_date = :ed', { ed: hireEffectiveDate })
            .orderBy('m.created_at', 'DESC')
            .limit(1)
            .getOne();
          if (moveToDelete) {
            await movementRepoTx.delete({ id: moveToDelete.id });
          }
        }
      }

      // 5. process: limpiar winning + hireData. Si esta completed,
      //    pasarlo a active. Si esta closed (cierre manual sin hire),
      //    no tocamos status.
      const newStatus = process.status === ProcessStatus.COMPLETED
        ? ProcessStatus.ACTIVE
        : process.status;
      await procRepo.update(
        { id: process.id, tenantId },
        {
          winningCandidateId: null as any,
          hireData: null as any,
          status: newStatus,
          autoClosed: false,
        },
      );

      // S4.2 — Si el revert reactiva el proceso (COMPLETED → ACTIVE),
      // restauramos los CVs archivados. Si el proceso no transiciona
      // a ACTIVE (ya estaba CLOSED por otro motivo), no restauramos
      // porque los CVs deben quedar archivados hasta el purge.
      if (newStatus === ProcessStatus.ACTIVE && process.status === ProcessStatus.COMPLETED) {
        await candRepo
          .createQueryBuilder()
          .update(RecruitmentCandidate)
          .set({
            cvUrl: () => 'cv_url_archived',
            cvUrlArchived: null,
            cvArchivedAt: null,
          })
          .where('process_id = :pid', { pid: process.id })
          .andWhere('tenant_id = :tid', { tid: tenantId })
          .andWhere('cv_url_archived IS NOT NULL')
          .execute();
      }
    });

    // Audit log post-commit
    try {
      await this.auditService.log(
        tenantId, callerUserId,
        'recruitment.hire_reverted',
        'recruitment_candidate', candidateId,
        {
          processId: process.id,
          processTitle: process.title,
          previousStatus: process.status,
          newStatus: process.status === ProcessStatus.COMPLETED ? 'active' : process.status,
          winningCandidateId: process.winningCandidateId,
        },
      );
    } catch (e: any) {
      this.logger.warn(`Audit log de revertHire fallo: ${e?.message ?? e}`);
    }

    // Reload + return
    const updatedCandidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    const updatedProcess = await this.processRepo.findOne({ where: { id: candidate.processId, tenantId } });
    return { candidate: updatedCandidate!, process: updatedProcess! };
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
   * S6.1 — Helper para registrar una transicion de stage en el historial.
   *
   * Acepta opcionalmente un EntityManager (para correr dentro de una
   * transaccion existente, como en hireCandidate). Si no se pasa, usa
   * el repo inyectado (autocommit).
   *
   * No lanza nunca: el historial es side-effect informativo, un fallo no
   * debe romper la transicion principal del candidato.
   */
  private async recordStageTransition(opts: {
    candidateId: string;
    tenantId: string;
    fromStage: string | null;
    toStage: string;
    changedBy?: string | null;
    source?: string;
    manager?: import('typeorm').EntityManager;
  }): Promise<void> {
    try {
      const repo = opts.manager
        ? opts.manager.getRepository(RecruitmentCandidateStageHistory)
        : this.stageHistoryRepo;
      await repo.save(
        repo.create({
          candidateId: opts.candidateId,
          tenantId: opts.tenantId,
          fromStage: opts.fromStage,
          toStage: opts.toStage,
          changedBy: opts.changedBy ?? null,
          source: opts.source ?? 'manual',
        }),
      );
    } catch (e: any) {
      this.logger.warn(
        `[recordStageTransition] no se pudo registrar transicion ${opts.fromStage} → ${opts.toStage} para candidato ${opts.candidateId}: ${e?.message ?? e}`,
      );
    }
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
    emailSent: boolean;
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

      // S3.x — Capturar el stage ACTUAL de TODOS los candidatos del
      // proceso ANTES del hire. Esto se usa en revertHire para
      // restaurar exactamente el estado previo (en lugar de
      // homogeneizar a 'approved'). Map { candidateId: stage }.
      const allProcessCandidates = await candidateRepo.find({
        where: { processId, tenantId },
        select: ['id', 'stage'],
      });
      const previousCandidateStages: Record<string, string> = {};
      for (const ac of allProcessCandidates) {
        previousCandidateStages[ac.id] = ac.stage;
      }

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

      // S3.x — Capturar el estado PREVIO del User para hire interno,
      // antes de la cascada de transferUser. Se persiste en hireData.
      // Necesario para que revertHire pueda hacer rollback del cambio
      // a users.{department,position,manager} y borrar el user_movement.
      let previousUserState: {
        departmentId: string | null;
        department: string | null;
        positionId: string | null;
        position: string | null;
        managerId: string | null;
        hierarchyLevel: number | null;
      } | null = null;
      if (isInternal && candidate.userId) {
        const userBefore = await userRepoTx.findOne({
          where: { id: candidate.userId, tenantId },
          select: ['id', 'departmentId', 'department', 'positionId', 'position', 'managerId', 'hierarchyLevel'],
        });
        if (userBefore) {
          previousUserState = {
            departmentId: userBefore.departmentId,
            department: userBefore.department,
            positionId: userBefore.positionId,
            position: userBefore.position,
            managerId: userBefore.managerId,
            hierarchyLevel: userBefore.hierarchyLevel,
          };
        }
      }
      const fullHireData = { ...hireData, previousUserState, previousCandidateStages };

      // b. Marcar proceso completado (UPDATE atomico).
      // Condiciones: status='active' Y (winning IS NULL OR winning=candidateId).
      // Si otro admin marco otro winner en el medio, affected=0 → throw.
      const procResult = await processRepo
        .createQueryBuilder()
        .update(RecruitmentProcess)
        .set({
          status: ProcessStatus.COMPLETED,
          winningCandidateId: candidateId,
          hireData: fullHireData as any,
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

      // S3.x — Marcar a TODOS los demas candidatos del proceso como
      // 'not_hired'. Solo aplica a stages activos (no toca rejected ni
      // hired existentes). Es UPDATE atomico bulk: 1 query.
      await candidateRepo
        .createQueryBuilder()
        .update(RecruitmentCandidate)
        .set({ stage: CandidateStage.NOT_HIRED })
        .where('process_id = :pid', { pid: processId })
        .andWhere('tenant_id = :tid', { tid: tenantId })
        .andWhere('id != :winningId', { winningId: candidateId })
        .andWhere('stage NOT IN (:...excluded)', {
          excluded: [CandidateStage.REJECTED, CandidateStage.HIRED, CandidateStage.NOT_HIRED],
        })
        .execute();

      // S6.1 — historial de transiciones del hire (winner + losers).
      // Usamos los snapshots de previousCandidateStages para los losers.
      const stageHistoryRepoTx = manager.getRepository(RecruitmentCandidateStageHistory);
      const winnerPrevStage = previousCandidateStages[candidateId] ?? candidate.stage;
      await stageHistoryRepoTx.save(
        stageHistoryRepoTx.create({
          candidateId,
          tenantId,
          fromStage: winnerPrevStage,
          toStage: CandidateStage.HIRED,
          changedBy: callerUserId,
          source: 'hire',
        }),
      );
      const losersHistoryRows = Object.entries(previousCandidateStages)
        .filter(([cid, prev]) =>
          cid !== candidateId &&
          prev !== CandidateStage.REJECTED &&
          prev !== CandidateStage.HIRED &&
          prev !== CandidateStage.NOT_HIRED,
        )
        .map(([cid, prev]) =>
          stageHistoryRepoTx.create({
            candidateId: cid,
            tenantId,
            fromStage: prev,
            toStage: CandidateStage.NOT_HIRED,
            changedBy: callerUserId,
            source: 'hire',
          }),
        );
      if (losersHistoryRows.length > 0) {
        await stageHistoryRepoTx.save(losersHistoryRows);
      }

      // S4.2 — Archivar CVs del proceso (compliance Chile 24m). Mismo
      // flow que el cierre via updateProcess: cv_url → cv_url_archived,
      // cv_archived_at = NOW(), cv_url = NULL. Hire transiciona a
      // COMPLETED, asi que la regla aplica aca tambien.
      // Inclusive el CV del candidato contratado: el proceso se cerro,
      // su CV de seleccion debe archivarse — el contrato laboral es
      // documentacion separada (modulo contracts), no es el CV de
      // postulacion.
      await candidateRepo
        .createQueryBuilder()
        .update(RecruitmentCandidate)
        .set({
          cvUrlArchived: () => 'cv_url',
          cvArchivedAt: () => 'NOW()',
          cvUrl: null,
        })
        .where('process_id = :pid', { pid: processId })
        .andWhere('tenant_id = :tid', { tid: tenantId })
        .andWhere('cv_url IS NOT NULL')
        .execute();

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
            reason: `Contratación interna desde proceso "${process.title}"${hireData.notes ? ` — ${hireData.notes}` : ''}`,
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
          reason: `Contratación externa desde proceso "${process.title}"${hireData.notes ? ` — ${hireData.notes}` : ''}`,
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

    // S5.1 — Email de bienvenida al ganador externo (post-commit).
    // Solo para externos — internos ya tienen cuenta y conocen la
    // plataforma; ademas, el listener de `user.transferred` ya dispara
    // notificaciones internas para ellos.
    //
    // Diseño:
    //   - Sincrono (await) para que la respuesta incluya emailSent
    //     true/false. El admin sabe inmediatamente si necesita copiar
    //     y enviar el password manualmente.
    //   - try/catch agresivo: cualquier fallo de email NO debe romper
    //     el hire (que ya commiteo). El password queda en la response
    //     como fallback.
    //   - Audit log captura outcome (recruitment.hire_email_sent o
    //     recruitment.hire_email_failed) con metadata para soporte.
    let emailSent = false;
    if (!isInternal && tempPassword && candidate.email) {
      try {
        const tenantRow = await this.tenantRepo.findOne({
          where: { id: tenantId },
          select: ['id', 'name'],
        });
        await this.emailService.sendInvitation(candidate.email, {
          firstName: candidate.firstName ?? candidate.email.split('@')[0],
          orgName: tenantRow?.name ?? 'Eva360',
          tempPassword,
          tenantId,
        });
        emailSent = true;
        await this.auditService
          .log(tenantId, callerUserId, 'recruitment.hire_email_sent', 'recruitment_candidate', candidateId, {
            email: candidate.email,
            processId,
          })
          .catch(() => undefined);
      } catch (e: any) {
        this.logger.warn(
          `[hireCandidate] email a ${candidate.email} fallo: ${e?.message ?? e}`,
        );
        await this.auditService
          .log(tenantId, callerUserId, 'recruitment.hire_email_failed', 'recruitment_candidate', candidateId, {
            email: candidate.email,
            processId,
            error: String(e?.message ?? e).slice(0, 200),
          })
          .catch(() => undefined);
      }
    }

    // 8. Reload entidades actualizadas.
    const updatedProcess = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    const updatedCandidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });

    return {
      process: updatedProcess!,
      candidate: updatedCandidate!,
      userId: resultUserId,
      tempPassword, // null para internos, password unico para externos
      emailSent, // S5.1: true si email se envio; false si fallo o no aplica (interno)
    };
  }

  /**
   * S5.1 — Reenviar email de bienvenida a candidato externo contratado.
   *
   * Casos de uso:
   *   - El email original fallo (mostrado en modal post-hire).
   *   - El candidato no recibio el email (spam, typo en email del User
   *     creado, etc.) y el admin actualizo el email manualmente.
   *
   * Genera SIEMPRE un nuevo `tempPassword` y rota el password del User:
   * el password viejo deja de ser valido. Esto evita compromiso si el
   * password original quedo expuesto en historial de WhatsApp/SMS, y
   * ademas garantiza idempotencia (cada resend == nueva credencial).
   *
   * Solo aplica a candidatos:
   *   - candidateType === 'external'
   *   - stage === 'hired'
   *   - linkedUserId existe (la cuenta fue creada en el hire)
   *
   * Audit log `recruitment.welcome_email_resent` o `_resend_failed`.
   *
   * No retorna el tempPassword en la respuesta — solo emailSent. El
   * password viaja unicamente por email; el admin no debe verlo en el
   * resend para reducir superficie de exposicion.
   */
  async resendWelcomeEmail(
    tenantId: string,
    candidateId: string,
    callerUserId: string,
  ): Promise<{ emailSent: boolean }> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (candidate.candidateType !== 'external') {
      throw new BadRequestException(
        'Reenvio de email de bienvenida solo aplica a candidatos externos. Internos ya tienen cuenta activa.',
      );
    }
    if (candidate.stage !== CandidateStage.HIRED) {
      throw new BadRequestException(
        `El candidato debe estar contratado (hired) para reenviar el email. Estado actual: ${candidate.stage}.`,
      );
    }
    if (!candidate.email) {
      throw new BadRequestException('El candidato no tiene email registrado.');
    }

    // Buscar el User creado al hire (match por email + tenant).
    const user = await this.userRepo.findOne({
      where: { tenantId, email: candidate.email },
      select: ['id', 'firstName', 'email'],
    });
    if (!user) {
      throw new NotFoundException(
        'No se encontro la cuenta del candidato. Si el hire fue pre-S1, debe gestionarse manualmente.',
      );
    }

    const newPassword = this.generateTempPassword();
    const newHash = await bcrypt.hash(newPassword, 12);

    // Rotacion atomica: actualizar password + forzar cambio en primer
    // login. Si el email falla despues, el password viejo ya no vale —
    // pero el admin puede reintentar el resend (rota de nuevo).
    await this.userRepo.update(
      { id: user.id, tenantId },
      {
        passwordHash: newHash,
        mustChangePassword: true,
      } as any,
    );

    let emailSent = false;
    try {
      const tenantRow = await this.tenantRepo.findOne({
        where: { id: tenantId },
        select: ['id', 'name'],
      });
      await this.emailService.sendInvitation(candidate.email, {
        firstName: user.firstName ?? candidate.firstName ?? candidate.email.split('@')[0],
        orgName: tenantRow?.name ?? 'Eva360',
        tempPassword: newPassword,
        tenantId,
      });
      emailSent = true;
      await this.auditService
        .log(tenantId, callerUserId, 'recruitment.welcome_email_resent', 'recruitment_candidate', candidateId, {
          email: candidate.email,
          processId: candidate.processId,
        })
        .catch(() => undefined);
    } catch (e: any) {
      this.logger.warn(
        `[resendWelcomeEmail] email a ${candidate.email} fallo: ${e?.message ?? e}`,
      );
      await this.auditService
        .log(tenantId, callerUserId, 'recruitment.welcome_email_resend_failed', 'recruitment_candidate', candidateId, {
          email: candidate.email,
          processId: candidate.processId,
          error: String(e?.message ?? e).slice(0, 200),
        })
        .catch(() => undefined);
      // El password ya rolo. Lanzamos para que el frontend muestre error
      // — pero la cuenta queda con password nuevo, asi que un retry del
      // admin no falla por inconsistencia.
      throw new BadRequestException(
        'No se pudo enviar el email. La cuenta queda con un password temporal nuevo. Intente nuevamente o contacte soporte.',
      );
    }
    return { emailSent };
  }

  /**
   * S6.3 — Metricas del proceso.
   *
   * Devuelve KPIs computados a partir de:
   *   - process metadata (createdAt, startDate, endDate, status).
   *   - candidates count por stage actual.
   *   - stage_history (S6.1) para calcular avgDaysInStage y conversion.
   *   - winner/runner-up scores.
   *   - interviews count vs evaluators expected.
   *
   * Diseño:
   *   - Single endpoint, single response — el frontend renderiza widget
   *     con KPI cards.
   *   - Calculos en memoria sobre datos ya cargados (no rondas multiples
   *     de queries por cada KPI).
   *   - Defensive: divisiones por cero protegidas; null si no hay datos
   *     suficientes para un KPI (ej. winnerScore null si no hay hire).
   */
  async getProcessMetrics(tenantId: string, processId: string): Promise<{
    daysActive: number;
    daysSinceCreation: number;
    candidateCount: number;
    candidatesByStage: Record<string, number>;
    avgDaysInStage: Record<string, number | null>;
    conversionRate: { fromStage: string; toStage: string; percentage: number }[];
    interviewsCompleted: number;
    interviewsExpected: number;
    winnerScore: number | null;
    runnerUpScore: number | null;
    timeToHireDays: number | null;
  }> {
    const process = await this.processRepo.findOne({
      where: { id: processId, tenantId },
    });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const now = new Date();
    const start = process.startDate ? new Date(process.startDate) : process.createdAt;
    const daysSinceCreation = Math.floor((now.getTime() - process.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const daysActive = process.status === ProcessStatus.ACTIVE
      ? Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      : daysSinceCreation;

    // Candidates por stage actual.
    const candidates = await this.candidateRepo.find({
      where: { tenantId, processId },
    });
    const candidateCount = candidates.length;
    const candidatesByStage: Record<string, number> = {};
    for (const c of candidates) {
      candidatesByStage[c.stage] = (candidatesByStage[c.stage] || 0) + 1;
    }

    // Stage history para avgDaysInStage. Cargamos TODA la history de
    // candidatos del proceso ordenada por (candidate, changed_at).
    const candidateIds = candidates.map((c) => c.id);
    const allHistory = candidateIds.length > 0
      ? await this.stageHistoryRepo.find({
        where: { candidateId: In(candidateIds) },
        order: { candidateId: 'ASC', changedAt: 'ASC' },
      })
      : [];

    // avgDaysInStage: por cada stage, sumar duracion en ese stage y
    // promediar. La duracion es (next changedAt - this changedAt) si
    // hay siguiente, sino (now - this changedAt) si es el stage actual.
    const stageDurationsMs: Record<string, number[]> = {};
    const historyByCandidate = new Map<string, RecruitmentCandidateStageHistory[]>();
    for (const h of allHistory) {
      const arr = historyByCandidate.get(h.candidateId) ?? [];
      arr.push(h);
      historyByCandidate.set(h.candidateId, arr);
    }
    for (const c of candidates) {
      const hist = historyByCandidate.get(c.id) ?? [];
      for (let i = 0; i < hist.length; i++) {
        const h = hist[i];
        const next = hist[i + 1];
        const stage = h.toStage;
        const startTs = new Date(h.changedAt).getTime();
        const endTs = next
          ? new Date(next.changedAt).getTime()
          : (c.stage === stage ? now.getTime() : startTs); // si es el stage actual, mide hasta hoy
        const durMs = Math.max(0, endTs - startTs);
        if (!stageDurationsMs[stage]) stageDurationsMs[stage] = [];
        // Solo contamos si hay duracion real (>0) para evitar inflar
        // promedios con transiciones inmediatas (auto-advance same-tx).
        if (durMs > 0) stageDurationsMs[stage].push(durMs);
      }
    }
    const avgDaysInStage: Record<string, number | null> = {};
    for (const [stage, durations] of Object.entries(stageDurationsMs)) {
      if (durations.length === 0) {
        avgDaysInStage[stage] = null;
        continue;
      }
      const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
      avgDaysInStage[stage] = Math.round((avgMs / (1000 * 60 * 60 * 24)) * 100) / 100;
    }

    // Conversion rate: porcentaje de candidatos que pasaron por cada
    // stage en su trayectoria.
    const stagesReached: Record<string, Set<string>> = {};
    for (const h of allHistory) {
      if (!stagesReached[h.toStage]) stagesReached[h.toStage] = new Set();
      stagesReached[h.toStage].add(h.candidateId);
    }
    const stagesOrder = ['cv_review', 'interviewing', 'scored', 'approved', 'hired'];
    const conversionRate: { fromStage: string; toStage: string; percentage: number }[] = [];
    for (let i = 0; i < stagesOrder.length - 1; i++) {
      const from = stagesOrder[i], to = stagesOrder[i + 1];
      const fromCount = stagesReached[from]?.size ?? 0;
      const toCount = stagesReached[to]?.size ?? 0;
      const percentage = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;
      conversionRate.push({ fromStage: from, toStage: to, percentage });
    }

    // Interviews: count actual vs expected (evaluators × candidatos en
    // interviewing+). Si no hay candidatos, skip la query (TypeORM In([])
    // genera "WHERE candidate_id IN ()" que falla en Postgres).
    const interviewsCompleted = candidateIds.length > 0
      ? await this.interviewRepo.count({ where: { candidateId: In(candidateIds) } })
      : 0;
    const evaluatorsCount = await this.evaluatorRepo.count({ where: { processId } });
    const inInterviewingOrLater = candidates.filter((c) =>
      [CandidateStage.INTERVIEWING, CandidateStage.SCORED, CandidateStage.APPROVED, CandidateStage.HIRED, CandidateStage.NOT_HIRED].includes(c.stage),
    ).length;
    const interviewsExpected = evaluatorsCount * inInterviewingOrLater;

    // Winner score + runner-up.
    let winnerScore: number | null = null;
    let runnerUpScore: number | null = null;
    if (process.winningCandidateId) {
      const winner = candidates.find((c) => c.id === process.winningCandidateId);
      winnerScore = winner?.finalScore != null ? Number(winner.finalScore) : null;
      const others = candidates
        .filter((c) => c.id !== process.winningCandidateId && c.finalScore != null)
        .map((c) => Number(c.finalScore))
        .sort((a, b) => b - a);
      runnerUpScore = others.length > 0 ? others[0] : null;
    }

    // Time to hire: createdAt → hire_executed audit log para el winner.
    let timeToHireDays: number | null = null;
    if (process.winningCandidateId && process.hireData) {
      const hireDate = (process.hireData as any)?.effectiveDate;
      if (hireDate) {
        const ms = new Date(hireDate).getTime() - new Date(process.createdAt).getTime();
        timeToHireDays = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
      }
    }

    return {
      daysActive,
      daysSinceCreation,
      candidateCount,
      candidatesByStage,
      avgDaysInStage,
      conversionRate,
      interviewsCompleted,
      interviewsExpected,
      winnerScore,
      runnerUpScore,
      timeToHireDays,
    };
  }

  /**
   * S6.2 — Cambio de stage en bulk de N candidatos.
   *
   * Reglas:
   *   - Bloquea explicitamente transitions a `hired` (forzar uso de hireCandidate).
   *   - Bloquea explicitamente transitions DESDE `hired` (forzar revertHire).
   *   - Solo afecta candidatos del mismo tenant — query con tenant_id en
   *     where filtra accidental cross-tenant si admin pasa IDs ajenos.
   *   - Atomic: UPDATE WHERE id IN (...) — single query.
   *   - Audit log por candidato (no bulk audit, para rastreabilidad fina).
   *   - Stage history por candidato afectado.
   *
   * Retorna { affected, skipped, blocked } con detalle:
   *   - affected: cantidad realmente actualizada.
   *   - skipped: IDs que no pertenecen al tenant o no existen.
   *   - blocked: IDs ya en stage 'hired' que no se tocaron.
   */
  async bulkUpdateStage(
    tenantId: string,
    candidateIds: string[],
    newStage: string,
    callerUserId: string,
  ): Promise<{ affected: number; skipped: string[]; blocked: string[] }> {
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un candidato.');
    }
    if (candidateIds.length > 200) {
      throw new BadRequestException('Maximo 200 candidatos por operacion bulk.');
    }
    if (newStage === CandidateStage.HIRED || newStage === 'hired') {
      throw new BadRequestException(
        'No se puede contratar en bulk. Use el flow individual hireCandidate para cada caso.',
      );
    }
    // Validar que el stage destino sea uno valido del enum.
    if (!Object.values(CandidateStage).includes(newStage as CandidateStage)) {
      throw new BadRequestException(`Stage invalido: ${newStage}.`);
    }

    // Cargar candidatos para evaluar quienes se afectan/skippean/bloquean.
    const candidates = await this.candidateRepo.find({
      where: { tenantId, id: In(candidateIds) },
    });
    const foundIds = new Set(candidates.map((c) => c.id));
    const skipped = candidateIds.filter((id) => !foundIds.has(id));
    const blocked = candidates.filter((c) => c.stage === CandidateStage.HIRED).map((c) => c.id);
    const eligible = candidates.filter((c) => c.stage !== CandidateStage.HIRED);

    if (eligible.length === 0) {
      return { affected: 0, skipped, blocked };
    }

    // Atomic UPDATE con guard de stage != HIRED y tenant_id correcto.
    const eligibleIds = eligible.map((c) => c.id);
    const updateResult = await this.candidateRepo
      .createQueryBuilder()
      .update(RecruitmentCandidate)
      .set({ stage: newStage as CandidateStage })
      .whereInIds(eligibleIds)
      .andWhere('tenant_id = :tid', { tid: tenantId })
      .andWhere('stage != :hired', { hired: CandidateStage.HIRED })
      .execute();
    const affected = updateResult.affected ?? 0;

    // Audit + history por cada candidato afectado.
    const historyRows: RecruitmentCandidateStageHistory[] = [];
    for (const c of eligible) {
      // Skip si stage previo es igual al nuevo (no es realmente un cambio).
      if (c.stage === newStage) continue;
      this.auditService
        .log(tenantId, callerUserId, 'recruitment.candidate_stage_changed', 'recruitment_candidate', c.id, {
          from: c.stage,
          to: newStage,
          processId: c.processId,
          source: 'bulk',
        })
        .catch(() => undefined);
      historyRows.push(
        this.stageHistoryRepo.create({
          candidateId: c.id,
          tenantId,
          fromStage: c.stage,
          toStage: newStage,
          changedBy: callerUserId,
          source: 'bulk',
        }),
      );
    }
    if (historyRows.length > 0) {
      await this.stageHistoryRepo.save(historyRows).catch((e: any) => {
        this.logger.warn(`[bulkUpdateStage] history save fallo: ${e?.message ?? e}`);
      });
    }

    return { affected, skipped, blocked };
  }

  /**
   * S6.2 — Borrado en bulk de candidatos.
   *
   * Reglas:
   *   - tenant_admin only (validado en controller).
   *   - Bloquea si CUALQUIERA de los IDs esta en stage 'hired' (la
   *     operacion debe ser revertHire primero).
   *   - Atomic: la query DELETE corre con WHERE id IN AND tenant_id =
   *     AND stage != hired. Si alguno pasa esos filtros pero algun otro
   *     no, la query borra los que pasan — pero antes hacemos un check
   *     explicito y throw si hay hired.
   *   - Cascada: las interviews del candidato tienen ON DELETE CASCADE en
   *     la FK, asi que se limpian automaticamente. CV archivado se purga
   *     al borrar la fila (no quedan huerfanos).
   *   - Audit log por candidato (rastreabilidad fina).
   */
  async bulkDeleteCandidates(
    tenantId: string,
    candidateIds: string[],
    callerUserId: string,
  ): Promise<{ deleted: number; skipped: string[] }> {
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos un candidato.');
    }
    if (candidateIds.length > 100) {
      throw new BadRequestException('Maximo 100 candidatos por operacion bulk delete.');
    }

    const candidates = await this.candidateRepo.find({
      where: { tenantId, id: In(candidateIds) },
    });
    const foundIds = new Set(candidates.map((c) => c.id));
    const skipped = candidateIds.filter((id) => !foundIds.has(id));
    const hired = candidates.filter((c) => c.stage === CandidateStage.HIRED);
    if (hired.length > 0) {
      throw new BadRequestException(
        `No se puede borrar candidatos en estado contratado (hired). ${hired.length} candidato(s) afectado(s) — debe ejecutar Revertir contratacion primero.`,
      );
    }

    if (candidates.length === 0) {
      return { deleted: 0, skipped };
    }

    // Audit ANTES del delete (despues no hay registro accesible).
    for (const c of candidates) {
      this.auditService
        .log(tenantId, callerUserId, 'recruitment.candidate_deleted', 'recruitment_candidate', c.id, {
          processId: c.processId,
          stage: c.stage,
          candidateType: c.candidateType,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          source: 'bulk',
        })
        .catch(() => undefined);
    }

    const deleteResult = await this.candidateRepo
      .createQueryBuilder()
      .delete()
      .from(RecruitmentCandidate)
      .whereInIds(candidates.map((c) => c.id))
      .andWhere('tenant_id = :tid', { tid: tenantId })
      .andWhere('stage != :hired', { hired: CandidateStage.HIRED })
      .execute();

    return {
      deleted: deleteResult.affected ?? 0,
      skipped,
    };
  }

  /**
   * S5.2 — Acceso admin al CV archivado de un candidato (compliance Chile).
   *
   * Despues del cierre del proceso, `cv_url` se nulifica y el data URL se
   * mueve a `cv_url_archived` (S4.2). Esta funcion expone el archivado al
   * admin que necesite recuperarlo (ej. requerimiento legal de un
   * candidato no contratado pidiendo acceso a sus datos).
   *
   * Reglas:
   *   - Solo se puede invocar desde el controller con guard tenant_admin
   *     (no super_admin — alineado con F-001).
   *   - El admin DEBE proveer una razon de >=20 caracteres. Se persiste
   *     en audit_logs.metadata.reason para trazabilidad de quien accedio
   *     a que CV y por que.
   *   - 404 si el candidato no tiene CV archivado (ya purgado por cron
   *     o nunca tuvo CV).
   *
   * Retorna { cvUrl, archivedAt } — el cvUrl es el data URL base64 que
   * el frontend renderiza inline en un iframe sandboxed (no descarga
   * a disco automaticamente).
   */
  async getArchivedCv(
    tenantId: string,
    candidateId: string,
    reason: string,
    callerUserId: string,
  ): Promise<{ cvUrl: string; archivedAt: Date }> {
    if (!reason || reason.trim().length < 20) {
      throw new BadRequestException(
        'Debe proporcionar una razon de acceso de al menos 20 caracteres (compliance audit trail).',
      );
    }

    // Cargar el candidato con cv_url_archived explicito (select:false en
    // entity, pero addSelect lo trae bajo demanda).
    const row = await this.candidateRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.tenantId', 'c.cvArchivedAt'])
      .addSelect('c.cvUrlArchived', 'c_cv_url_archived')
      .where('c.id = :candidateId', { candidateId })
      .andWhere('c.tenantId = :tenantId', { tenantId })
      .getRawAndEntities();

    const candidate = row.entities[0];
    const cvUrlArchived = (row.raw[0] as any)?.c_cv_url_archived as string | null | undefined;

    if (!candidate) {
      throw new NotFoundException('Candidato no encontrado');
    }
    if (!cvUrlArchived || !candidate.cvArchivedAt) {
      throw new NotFoundException(
        'No hay CV archivado para este candidato (nunca se subio o ya fue purgado por retencion 24m).',
      );
    }

    // Audit obligatorio.
    await this.auditService
      .log(tenantId, callerUserId, 'recruitment.archived_cv_accessed', 'recruitment_candidate', candidateId, {
        reason: reason.trim().slice(0, 500),
        archivedAt: candidate.cvArchivedAt.toISOString?.() ?? String(candidate.cvArchivedAt),
      })
      .catch(() => undefined);

    return {
      cvUrl: cvUrlArchived,
      archivedAt: candidate.cvArchivedAt,
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

  async uploadCv(
    tenantId: string | undefined,
    candidateId: string,
    cvUrl: string,
    callerUserId?: string,
  ): Promise<RecruitmentCandidate> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    const previousCvUrl = candidate.cvUrl;
    const previousStage = candidate.stage;
    candidate.cvUrl = cvUrl;
    // Auto-advance stage to cv_review when CV is uploaded
    if (candidate.stage === CandidateStage.REGISTERED) {
      candidate.stage = CandidateStage.CV_REVIEW;
    }
    const saved = await this.candidateRepo.save(candidate);
    // S4.1 — audit log
    this.auditService
      .log(candidate.tenantId, callerUserId ?? null, 'recruitment.cv_uploaded', 'recruitment_candidate', candidateId, {
        processId: candidate.processId,
        replaced: !!previousCvUrl,
        stageAdvanced: previousStage !== saved.stage ? { from: previousStage, to: saved.stage } : null,
      })
      .catch(() => {});
    // S6.1 — historial de transicion si auto-advance disparado.
    if (previousStage !== saved.stage) {
      await this.recordStageTransition({
        candidateId: saved.id,
        tenantId: candidate.tenantId,
        fromStage: previousStage,
        toStage: saved.stage,
        changedBy: callerUserId ?? null,
        source: 'auto_advance_cv',
      });
    }
    return saved;
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

    // S4.1 — audit log
    this.auditService
      .log(effectiveTenantId, generatedBy, 'recruitment.cv_analyzed', 'recruitment_candidate', candidateId, {
        processId: candidate.processId,
        candidateType: candidate.candidateType,
        // Metadatos de la respuesta de IA — util para debug de tasa de fallos
        // y auditar cambios en formato/version del modelo.
        analysisLength: typeof analysis?.content === 'string' ? analysis.content.length : null,
      })
      .catch(() => {});

    return analysis;
  }

  async getCvAnalysis(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    return { cvUrl: candidate.cvUrl, cvAnalysis: candidate.cvAnalysis, recruiterNotes: candidate.recruiterNotes };
  }

  async addRecruiterNotes(
    tenantId: string | undefined,
    candidateId: string,
    notes: string,
    callerUserId?: string,
  ): Promise<void> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    const previousNotes = candidate.recruiterNotes;
    candidate.recruiterNotes = notes;
    await this.candidateRepo.save(candidate);
    // S4.1 — audit log (solo si realmente cambian las notas para evitar
    // ruido por re-saves idempotentes desde el frontend).
    if (previousNotes !== notes) {
      this.auditService
        .log(candidate.tenantId, callerUserId ?? null, 'recruitment.recruiter_notes_updated', 'recruitment_candidate', candidateId, {
          processId: candidate.processId,
          hadPreviousNotes: !!previousNotes,
        })
        .catch(() => {});
    }
  }

  // ─── Interviews ───────────────────────────────────────────────────────

  async submitInterview(tenantId: string | undefined, evaluatorId: string, candidateId: string, dto: any): Promise<RecruitmentInterview> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    let interview = await this.interviewRepo.findOne({ where: { candidateId, evaluatorId } });
    const isUpdate = !!interview;
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
    let interviewAutoAdvanceFrom: CandidateStage | null = null;
    if (candidate.stage === CandidateStage.REGISTERED || candidate.stage === CandidateStage.CV_REVIEW) {
      interviewAutoAdvanceFrom = candidate.stage;
      candidate.stage = CandidateStage.INTERVIEWING;
      await this.candidateRepo.save(candidate);
    }
    // S6.1 — historial de transicion auto_advance_interview.
    if (interviewAutoAdvanceFrom) {
      await this.recordStageTransition({
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        fromStage: interviewAutoAdvanceFrom,
        toStage: CandidateStage.INTERVIEWING,
        changedBy: evaluatorId,
        source: 'auto_advance_interview',
      });
    }

    // Recalculate candidate final score + auto-advance to scored
    await this.recalculateScore(tenantId, candidateId);

    // S4.1 — audit log (después del save + recalc para que cualquier
    // error en esos pasos no genere un log "fantasma" de evento exitoso).
    this.auditService
      .log(candidate.tenantId, evaluatorId, 'recruitment.interview_submitted', 'recruitment_interview', saved.id, {
        candidateId,
        processId: candidate.processId,
        action: isUpdate ? 'updated' : 'created',
        globalScore: saved.globalScore,
        manualScore: saved.manualScore,
        requirementChecksCount: Array.isArray(saved.requirementChecks) ? saved.requirementChecks.length : 0,
      })
      .catch(() => {});

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

  async adjustScore(
    tenantId: string | undefined,
    candidateId: string,
    adjustment: number,
    justification: string,
    callerUserId?: string,
  ): Promise<void> {
    const where = tenantId ? { id: candidateId, tenantId } : { id: candidateId };
    const candidate = await this.candidateRepo.findOne({ where });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    const previousAdjustment = candidate.scoreAdjustment;
    const previousJustification = candidate.scoreJustification;
    candidate.scoreAdjustment = adjustment;
    candidate.scoreJustification = justification;
    await this.candidateRepo.save(candidate);
    // Recalculate with adjustment usando el tenantId authoritative del candidato.
    await this.recalculateScore(candidate.tenantId, candidateId);
    // S4.1 — audit log (siempre, incluso si valores iguales: el admin
    // pudo "reescribir" la justificacion intencionalmente y eso debe
    // quedar trazado para compliance/transparencia del proceso).
    this.auditService
      .log(candidate.tenantId, callerUserId ?? null, 'recruitment.score_adjusted', 'recruitment_candidate', candidateId, {
        processId: candidate.processId,
        previousAdjustment,
        newAdjustment: adjustment,
        previousJustification,
        newJustification: justification,
      })
      .catch(() => {});
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
    let scoreAutoAdvanceFrom: CandidateStage | null = null;
    if (candidate.finalScore > 0 && candidate.stage === CandidateStage.INTERVIEWING) {
      scoreAutoAdvanceFrom = candidate.stage;
      candidate.stage = CandidateStage.SCORED;
    }

    await this.candidateRepo.save(candidate);

    // S6.1 — historial de transicion auto_advance_score.
    if (scoreAutoAdvanceFrom) {
      await this.recordStageTransition({
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        fromStage: scoreAutoAdvanceFrom,
        toStage: CandidateStage.SCORED,
        changedBy: null,
        source: 'auto_advance_score',
      });
    }
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
