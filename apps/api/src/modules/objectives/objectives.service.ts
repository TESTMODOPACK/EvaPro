import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Objective, ObjectiveStatus } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult, KRStatus } from './entities/key-result.entity';
import { ObjectiveRejection } from './entities/objective-rejection.entity';
import { EvaluationObjectiveSnapshot } from '../evaluations/entities/evaluation-objective-snapshot.entity';
import { User } from '../users/entities/user.entity';
import {
  EvaluationCycle,
  CycleStatus,
} from '../evaluations/entities/evaluation-cycle.entity';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import {
  UpdateObjectiveDto,
  CreateObjectiveUpdateDto,
} from './dto/update-objective.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { RecognitionService } from '../recognition/recognition.service';
import { PointsSource } from '../recognition/entities/user-points.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { PushService } from '../notifications/push.service';
import { buildPushMessage } from '../notifications/push-messages';
import { assertManagerCanAccessUser } from '../../common/utils/validate-manager-scope';

@Injectable()
export class ObjectivesService {
  private readonly logger = new Logger(ObjectivesService.name);

  constructor(
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(ObjectiveUpdate)
    private readonly updateRepo: Repository<ObjectiveUpdate>,
    @InjectRepository(ObjectiveComment)
    private readonly commentRepo: Repository<ObjectiveComment>,
    @InjectRepository(KeyResult)
    private readonly keyResultRepo: Repository<KeyResult>,
    @InjectRepository(ObjectiveRejection)
    private readonly rejectionRepo: Repository<ObjectiveRejection>,
    @InjectRepository(EvaluationObjectiveSnapshot)
    private readonly objSnapshotRepo: Repository<EvaluationObjectiveSnapshot>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly recognitionService: RecognitionService,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  // ─── Validation Helpers ──────────────────────────────────────────────────────

  /** B7.1: targetDate cannot be in the past */
  private validateTargetDate(dateStr?: string): void {
    if (!dateStr) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(dateStr) < today) {
      throw new BadRequestException(
        'La fecha objetivo no puede ser una fecha pasada',
      );
    }
  }

  /** B7.2: Cycle must exist and not be closed */
  private async validateCycleOpen(
    cycleId: string,
    tenantId: string,
  ): Promise<void> {
    const cycle = await this.cycleRepo.findOne({
      where: { id: cycleId, tenantId },
    });
    if (!cycle)
      throw new BadRequestException('El ciclo de evaluación no existe');
    if (cycle.status === CycleStatus.CLOSED) {
      throw new BadRequestException(
        'No se puede asignar un objetivo a un ciclo de evaluación cerrado',
      );
    }
  }

  /**
   * T2.1 — BUG-3 fix. Valida que la suma de pesos de los objetivos del usuario
   * dentro de un mismo bucket de ciclo no exceda 100%.
   *
   * Bucketing: dos objetivos comparten bucket si tienen el mismo `(userId, cycleId)`.
   * `cycleId=null` define el bucket "sin ciclo", independiente de cualquier ciclo
   * concreto. Esto permite proponer un objetivo de peso 100% en Q2 aunque el
   * usuario ya tenga 100% completado en Q1 — los buckets son independientes.
   *
   * Conteo:
   *   - ABANDONED se excluye (objetivo cancelado, no compromete capacidad)
   *   - DRAFT, PENDING_APPROVAL, ACTIVE, COMPLETED suman
   *   - El `excludeId` opcional permite ignorar el objetivo que se está
   *     actualizando (caso update/submit) para no contarlo dos veces
   *
   * Antes de T2.1 esta validación vivía inline en submitForApproval, no
   * filtraba por cycleId, y no se ejecutaba en create/update — permitiendo
   * crear DRAFTs con 200% que quedaban bloqueados al intentar enviarse.
   *
   * @throws BadRequestException si el total excedería 100%
   */
  private async validateWeightSum(params: {
    tenantId: string;
    userId: string;
    cycleId: string | null | undefined;
    candidateWeight: number;
    excludeId?: string;
  }): Promise<void> {
    const { tenantId, userId, cycleId, candidateWeight, excludeId } = params;
    if (!candidateWeight || candidateWeight <= 0) return; // peso 0 no aporta a la suma

    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.userId = :userId', { userId })
      // T7: ABANDONED y CANCELLED no consumen capacidad — el evaluado ya
      // no compromete avance en ellos.
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          ObjectiveStatus.ABANDONED,
          ObjectiveStatus.CANCELLED,
        ],
      });

    if (cycleId) {
      qb.andWhere('o.cycleId = :cycleId', { cycleId });
    } else {
      qb.andWhere('o.cycleId IS NULL');
    }

    if (excludeId) {
      qb.andWhere('o.id != :excludeId', { excludeId });
    }

    const siblings = await qb.getMany();
    const existingWeight = siblings.reduce(
      (sum, o) => sum + Number(o.weight || 0),
      0,
    );
    const totalWeight = existingWeight + Number(candidateWeight);

    if (totalWeight > 100) {
      const bucketLabel = cycleId ? 'este ciclo' : 'objetivos sin ciclo';
      throw new BadRequestException(
        `La suma de pesos de los objetivos del colaborador en ${bucketLabel} sería ${totalWeight}%. El total no puede superar 100%.`,
      );
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string,
    dto: CreateObjectiveDto,
  ): Promise<Objective> {
    // B7.1: targetDate must not be in the past
    this.validateTargetDate(dto.targetDate);
    // B7.2: cycleId must be an open cycle
    if (dto.cycleId) await this.validateCycleOpen(dto.cycleId, tenantId);
    // B3.15: Validate parent objective if provided
    if (dto.parentObjectiveId) {
      await this.validateParentObjective(tenantId, dto.parentObjectiveId);
    }
    // T2.2 — BUG-3: validar suma de pesos en el bucket de ciclo del candidato
    if (dto.weight && dto.weight > 0) {
      await this.validateWeightSum({
        tenantId,
        userId,
        cycleId: dto.cycleId ?? null,
        candidateWeight: dto.weight,
      });
    }

    const obj = this.objectiveRepo.create({
      tenantId,
      userId,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      cycleId: dto.cycleId,
      weight: dto.weight ?? 0,
      parentObjectiveId: dto.parentObjectiveId || null,
      status: ObjectiveStatus.DRAFT,
      progress: 0,
    });
    const saved = await this.objectiveRepo.save(obj);
    this.auditService
      .log(tenantId, userId, 'objective.created', 'objective', saved.id, {
        title: dto.title,
        type: dto.type,
        assignedTo: userId,
      })
      .catch(() => {});

    // Send email to the objective owner
    const owner = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName'],
    });
    if (owner?.email) {
      this.emailService
        .sendObjectiveAssigned(owner.email, {
          firstName: owner.firstName,
          objectiveTitle: dto.title,
          objectiveType: dto.type || 'OKR',
          targetDate: dto.targetDate
            ? new Date(dto.targetDate).toLocaleDateString('es-CL')
            : undefined,
          tenantId,
          userId: owner.id,
        })
        .catch(() => {});
    }

    return saved;
  }

  // ─── Queries by role ────────────────────────────────────────────────────────

  /**
   * Shared queryBuilder: loads objectives with their user/updates/keyResults
   * and enforces tenant-match on every joined relation. Prevents cross-tenant
   * leaks caused by orphan FKs (e.g. objective.user_id pointing at a user in
   * a different tenant after a data migration).
   */
  private objectivesWithRelationsQb(tenantId: string) {
    return this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'user', 'user.tenant_id = o.tenant_id')
      .leftJoinAndSelect(
        'o.updates',
        'updates',
        'updates.tenant_id = o.tenant_id',
      )
      .leftJoinAndSelect(
        'updates.creator',
        'creator',
        'creator.tenant_id = o.tenant_id',
      )
      .leftJoinAndSelect('o.keyResults', 'kr', 'kr.tenant_id = o.tenant_id')
      .where('o.tenantId = :tenantId', { tenantId })
      .orderBy('o.createdAt', 'DESC');
  }

  /** All objectives in the tenant (for tenant_admin). Capped at 200
   *  to prevent OOM with tenants that accumulate 1000+ OKRs over time.
   *  The frontend applies its own client-side filtering on the capped set. */
  async findAll(tenantId: string, filterUserId?: string): Promise<Objective[]> {
    const qb = this.objectivesWithRelationsQb(tenantId);
    if (filterUserId) qb.andWhere('o.userId = :filterUserId', { filterUserId });
    return qb.take(200).getMany();
  }

  /** Objectives of manager's direct reports + own (for manager) */
  async findByManager(
    tenantId: string,
    managerId: string,
  ): Promise<Objective[]> {
    const subordinates = await this.userRepo.find({
      where: { tenantId, managerId, isActive: true },
      select: ['id', 'role'],
    });
    // Exclude tenant_admin from manager's team view — they are system admins, not operational subordinates
    const userIds = [
      managerId,
      ...subordinates.filter((u) => u.role !== 'tenant_admin').map((u) => u.id),
    ];

    return this.objectivesWithRelationsQb(tenantId)
      .andWhere('o.userId IN (:...userIds)', { userIds })
      .take(200)
      .getMany();
  }

  /** Only the user's own objectives (for employee) */
  async findByUser(tenantId: string, userId: string): Promise<Objective[]> {
    return this.objectivesWithRelationsQb(tenantId)
      .andWhere('o.userId = :userId', { userId })
      .take(200)
      .getMany();
  }

  /**
   * T12 — Audit P2: listado paginado con filtros server-side.
   *
   * Reemplaza el patrón legacy `findAll(...).take(200)` + filtrado JS.
   * Soporta paginación real (page + pageSize), búsqueda case-insensitive
   * sobre title/owner, y filtros por status/type/cycleId/department.
   *
   * Scope por rol:
   *   - super_admin / tenant_admin: todos los objetivos del tenant.
   *     `opts.userId` filtra por owner si se pasa.
   *   - manager: propios + reportes directos. `opts.userId` se ignora
   *     (manager no puede ver objetivos de otros equipos via este filtro).
   *   - employee / external: solo propios. `opts.userId` se ignora.
   *
   * Devuelve { data, total, page, pageSize, totalPages }. La cuenta es
   * post-filtros pero pre-paginación (cuántos hay en total que matchean).
   */
  async listObjectives(
    tenantId: string,
    role: string,
    currentUserId: string,
    opts: {
      page?: number;
      pageSize?: number;
      userId?: string;
      status?: ObjectiveStatus;
      type?: string;
      cycleId?: string;
      search?: string;
      department?: string;
    },
  ): Promise<{
    data: Objective[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

    const qb = this.objectivesWithRelationsQb(tenantId);

    // ─── Role scope ────────────────────────────────────────────────────
    if (role === 'employee' || role === 'external') {
      qb.andWhere('o.userId = :selfUid', { selfUid: currentUserId });
    } else if (role === 'manager') {
      const subordinates = await this.userRepo.find({
        where: { tenantId, managerId: currentUserId, isActive: true },
        select: ['id', 'role'],
      });
      const userIds = [
        currentUserId,
        ...subordinates
          .filter((u) => u.role !== 'tenant_admin')
          .map((u) => u.id),
      ];
      qb.andWhere('o.userId IN (:...mgrScope)', { mgrScope: userIds });
    } else if (opts.userId) {
      qb.andWhere('o.userId = :filterUid', { filterUid: opts.userId });
    }

    // ─── Filters ──────────────────────────────────────────────────────
    if (opts.status) {
      qb.andWhere('o.status = :fStatus', { fStatus: opts.status });
    }
    if (opts.type) {
      qb.andWhere('o.type = :fType', { fType: opts.type });
    }
    if (opts.cycleId) {
      qb.andWhere('o.cycleId = :fCycle', { fCycle: opts.cycleId });
    }
    if (opts.department) {
      qb.andWhere('user.department = :fDept', { fDept: opts.department });
    }
    if (opts.search) {
      qb.andWhere(
        `(LOWER(o.title) LIKE LOWER(:fSearch)
          OR LOWER(COALESCE(user.firstName, '')) LIKE LOWER(:fSearch)
          OR LOWER(COALESCE(user.lastName, '')) LIKE LOWER(:fSearch))`,
        { fSearch: `%${opts.search}%` },
      );
    }

    // ─── Total post-filtros, pre-paginación ────────────────────────────
    // getCount() respeta WHERE pero ignora skip/take; nos da el total
    // de matches independiente de la página actual.
    const total = await qb.getCount();

    qb.skip((page - 1) * pageSize).take(pageSize);
    const data = await qb.getMany();

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * B1.3: OKR history grouped by evaluation cycle / period.
   *
   * T9 — Audit P1 (Issue B): el reporte por período antes solo incluía
   * objetivos terminales (COMPLETED, ABANDONED, CANCELLED). Esto dejaba
   * fuera del histórico de Q1 a los objetivos que estaban en curso al
   * cerrar Q1 y siguen activos hoy — la pregunta "¿qué objetivos tenía
   * la organización en Q1?" no podía responderse correctamente.
   *
   * Con `includeActive=true` el reporte trae también ACTIVE / OVERDUE.
   * Para esos:
   *   - Si existe un cycle-wide snapshot del cierre del ciclo (Tarea 5),
   *     prefiere los valores del snapshot (progress, status del cierre)
   *     y marca `fromSnapshot: true`.
   *   - Si no hay snapshot (ciclo abierto, o legacy sin snapshot),
   *     muestra los valores live + `inProgress: true`.
   * Los terminales siempre usan los valores live (ya son finales).
   */
  async getObjectiveHistory(
    tenantId: string,
    userId?: string,
    cycleId?: string,
    includeActive: boolean = false,
  ) {
    const baseStatuses = [
      ObjectiveStatus.COMPLETED,
      ObjectiveStatus.ABANDONED,
      ObjectiveStatus.CANCELLED,
    ];
    const statuses = includeActive
      ? [...baseStatuses, ObjectiveStatus.ACTIVE, ObjectiveStatus.OVERDUE]
      : baseStatuses;

    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status IN (:...statuses)', { statuses });

    if (userId) {
      qb.andWhere('o.userId = :userId', { userId });
    }
    if (cycleId) {
      qb.andWhere('o.cycleId = :cycleId', { cycleId });
    }

    qb.leftJoinAndSelect(
      'o.user',
      'user',
      'user.tenant_id = o.tenant_id',
    ).orderBy('o.updatedAt', 'DESC');

    const objectives = await qb.getMany();

    if (objectives.length === 0) {
      return { periods: [], totalObjectives: 0 };
    }

    // Load Key Results for all objectives
    const objectiveIds = objectives.map((o) => o.id);
    const keyResults = await this.keyResultRepo
      .createQueryBuilder('kr')
      .where('kr.objectiveId IN (:...ids)', { ids: objectiveIds })
      .getMany();

    const krByObjective = new Map<string, typeof keyResults>();
    for (const kr of keyResults) {
      const list = krByObjective.get(kr.objectiveId) || [];
      list.push(kr);
      krByObjective.set(kr.objectiveId, list);
    }

    // Group by cycleId (null cycleId grouped as 'sin_ciclo')
    const groups = new Map<string, Objective[]>();
    for (const obj of objectives) {
      const key = obj.cycleId || 'sin_ciclo';
      const list = groups.get(key) || [];
      list.push(obj);
      groups.set(key, list);
    }

    // Load cycle names
    const cycleIds = [...groups.keys()].filter((k) => k !== 'sin_ciclo');
    const cycles =
      cycleIds.length > 0
        ? await this.cycleRepo.find({
            where: { id: In(cycleIds) },
            select: [
              'id',
              'name',
              'startDate',
              'endDate',
              'type',
              'period',
              'status',
            ],
          })
        : [];
    const cycleMap = new Map(cycles.map((c) => [c.id, c]));

    // T9.2 — cargar snapshots cycle-wide de los ciclos cerrados, indexados
    // por (cycleId, objectiveId). Para objetivos no terminales (ACTIVE/
    // OVERDUE) preferiremos el snapshot del cierre si existe.
    const closedCycleIds = cycles
      .filter((c) => c.status === CycleStatus.CLOSED)
      .map((c) => c.id);
    const snapshotByObjective = new Map<string, EvaluationObjectiveSnapshot>();
    if (closedCycleIds.length > 0) {
      const snapshots = await this.objSnapshotRepo
        .createQueryBuilder('s')
        .where('s.tenantId = :tenantId', { tenantId })
        .andWhere('s.cycleId IN (:...ids)', { ids: closedCycleIds })
        .andWhere('s.assignmentId IS NULL')
        .orderBy('s.capturedAt', 'DESC')
        .getMany();
      // Si hay duplicados, queda el más reciente (orden DESC)
      for (const snap of snapshots) {
        const key = `${snap.cycleId}::${snap.objectiveId}`;
        if (!snapshotByObjective.has(key)) {
          snapshotByObjective.set(key, snap);
        }
      }
    }

    const periods = [...groups.entries()].map(([key, objs]) => {
      const cycle = cycleMap.get(key);
      const cycleIsClosed = cycle?.status === CycleStatus.CLOSED;

      // T9.2 — Para cada objetivo, decidir source: terminal usa live;
      // active/overdue usa snapshot si el ciclo está cerrado y existe,
      // sino live + inProgress flag.
      const enrichedObjs = objs.map((o) => {
        const snapKey = cycle ? `${cycle.id}::${o.id}` : null;
        const snap = snapKey ? snapshotByObjective.get(snapKey) : undefined;
        const isTerminal =
          o.status === ObjectiveStatus.COMPLETED ||
          o.status === ObjectiveStatus.ABANDONED ||
          o.status === ObjectiveStatus.CANCELLED;
        const isActiveAtCycleClose =
          !isTerminal &&
          (o.status === ObjectiveStatus.ACTIVE ||
            o.status === ObjectiveStatus.OVERDUE);

        if (snap && isActiveAtCycleClose && cycleIsClosed) {
          // Foto al cierre del ciclo — preferida para in-progress en
          // ciclos cerrados.
          return {
            ...o,
            progress: snap.progress,
            status: snap.objectiveStatus as ObjectiveStatus,
            keyResults: snap.keyResultsJson ?? [],
            fromSnapshot: true,
            inProgress: true,
            currentLiveStatus: o.status,
            currentLiveProgress: o.progress,
          };
        }
        return {
          ...o,
          keyResults: krByObjective.get(o.id) || [],
          fromSnapshot: false,
          inProgress: !isTerminal,
        };
      });

      const totalProgress = enrichedObjs.reduce(
        (sum, o) => sum + (o.progress || 0),
        0,
      );
      return {
        cycleId: key === 'sin_ciclo' ? null : key,
        cycleName: cycle?.name || 'Sin ciclo asignado',
        startDate: cycle?.startDate || null,
        endDate: cycle?.endDate || null,
        cycleType: cycle?.type || null,
        cycleStatus: cycle?.status || null,
        totalObjectives: enrichedObjs.length,
        completedCount: enrichedObjs.filter(
          (o) => o.status === ObjectiveStatus.COMPLETED,
        ).length,
        abandonedCount: enrichedObjs.filter(
          (o) => o.status === ObjectiveStatus.ABANDONED,
        ).length,
        cancelledCount: enrichedObjs.filter(
          (o) => o.status === ObjectiveStatus.CANCELLED,
        ).length,
        inProgressCount: enrichedObjs.filter((o) => o.inProgress).length,
        avgProgress:
          enrichedObjs.length > 0
            ? Math.round(totalProgress / enrichedObjs.length)
            : 0,
        objectives: enrichedObjs,
      };
    });

    return {
      periods,
      totalObjectives: objectives.length,
    };
  }

  /**
   * P5.4 — Firma tenantId opcional para soportar super_admin cross-tenant.
   * Si tenantId es undefined, busca solo por id (cross-tenant).
   * El resto de los métodos del service siguen pasando string cuando son
   * acciones user-scoped (update, comments, key-results, progress).
   */
  async findById(tenantId: string | undefined, id: string): Promise<Objective> {
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'user', 'user.tenant_id = o.tenant_id')
      .where('o.id = :id', { id });
    if (tenantId) qb.andWhere('o.tenantId = :tenantId', { tenantId });
    const obj = await qb.getOne();
    if (!obj) throw new NotFoundException('Objetivo no encontrado');
    return obj;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateObjectiveDto,
  ): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    // B7.3: Cannot modify completed or abandoned objectives
    if (
      obj.status === ObjectiveStatus.COMPLETED ||
      obj.status === ObjectiveStatus.ABANDONED ||
      obj.status === ObjectiveStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'No se pueden modificar objetivos completados, cancelados o abandonados',
      );
    }
    // B7.1: targetDate must not be in the past (only when field is being changed)
    if (dto.targetDate !== undefined) this.validateTargetDate(dto.targetDate);
    // B7.2: cycleId must be an open cycle (only when field is being changed)
    if (dto.cycleId !== undefined && dto.cycleId)
      await this.validateCycleOpen(dto.cycleId, tenantId);
    // T2.3 — BUG-3: si cambia weight o cycleId, validar contra el bucket
    // resultante. Usa el cycleId nuevo si se está cambiando, y el peso nuevo
    // si se está cambiando. excludeId=id para no contar el mismo objetivo.
    if (dto.weight !== undefined || dto.cycleId !== undefined) {
      const effectiveWeight =
        dto.weight !== undefined ? dto.weight : Number(obj.weight || 0);
      const effectiveCycleId =
        dto.cycleId !== undefined
          ? (dto.cycleId ?? null)
          : (obj.cycleId ?? null);
      if (effectiveWeight > 0) {
        await this.validateWeightSum({
          tenantId,
          userId: obj.userId,
          cycleId: effectiveCycleId,
          candidateWeight: effectiveWeight,
          excludeId: id,
        });
      }
    }
    if (dto.title !== undefined) obj.title = dto.title;
    if (dto.description !== undefined) obj.description = dto.description;
    if (dto.type !== undefined) obj.type = dto.type;
    if (dto.status !== undefined) obj.status = dto.status;
    if (dto.targetDate !== undefined) {
      const newTargetDate = new Date(dto.targetDate);
      // T6.3 — Audit P1: si el objetivo está OVERDUE y se extiende la fecha
      // a hoy o futuro, vuelve a ACTIVE automáticamente. La validación
      // validateTargetDate (B7.1) ya garantiza que dto.targetDate no es
      // pasada, así que cualquier valor llegado aquí es ≥ hoy.
      // Si dto.status también se setea explícitamente arriba, ese gana
      // (admin override). El check `obj.status === OVERDUE` aplica al
      // estado tras el assign de dto.status, así que solo dispara cuando
      // el caller no forzó otro status.
      obj.targetDate = newTargetDate;
      if (obj.status === ObjectiveStatus.OVERDUE) {
        obj.status = ObjectiveStatus.ACTIVE;
      }
    }
    if (dto.progress !== undefined) obj.progress = dto.progress;
    if (dto.weight !== undefined) obj.weight = dto.weight;
    // T2.3 incidental fix: cycleId estaba en el DTO y se validaba, pero nunca
    // se aplicaba al obj — los cambios de ciclo no persistían. Se aplica
    // ahora para que la validación de pesos por bucket sea coherente.
    if (dto.cycleId !== undefined) obj.cycleId = dto.cycleId;
    if (dto.parentObjectiveId !== undefined) {
      if (dto.parentObjectiveId) {
        if (dto.parentObjectiveId === id) {
          throw new BadRequestException(
            'Un objetivo no puede ser padre de sí mismo',
          );
        }
        await this.validateParentObjective(tenantId, dto.parentObjectiveId, id);
      }
      obj.parentObjectiveId = dto.parentObjectiveId || null;
    }
    return this.objectiveRepo.save(obj);
  }

  async submitForApproval(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.DRAFT) {
      throw new BadRequestException(
        'Solo objetivos en estado borrador pueden enviarse a aprobación',
      );
    }

    // T2.4 — BUG-3: usa el helper compartido. Reemplaza la validación inline
    // que (a) no filtraba por cycleId y (b) sumaba COMPLETED de todos los
    // ciclos del usuario, bloqueando submits válidos en períodos nuevos.
    if (Number(obj.weight) > 0) {
      await this.validateWeightSum({
        tenantId,
        userId: obj.userId,
        cycleId: obj.cycleId ?? null,
        candidateWeight: Number(obj.weight),
        excludeId: id,
      });
    }

    obj.status = ObjectiveStatus.PENDING_APPROVAL;
    obj.rejectionReason = null; // Clear previous rejection reason
    const saved = await this.objectiveRepo.save(obj);
    this.auditService
      .log(
        tenantId,
        obj.userId,
        'objective.submitted_for_approval',
        'objective',
        id,
        { title: obj.title },
      )
      .catch(() => {});

    // Notify manager that an objective needs approval
    const employee = await this.userRepo.findOne({
      where: { id: obj.userId },
      select: ['id', 'firstName', 'lastName', 'managerId'],
    });
    if (employee?.managerId) {
      const manager = await this.userRepo.findOne({
        where: { id: employee.managerId },
        select: ['id', 'email', 'firstName', 'language'],
      });
      if (manager?.email) {
        this.emailService
          .sendObjectiveAssigned(manager.email, {
            firstName: manager.firstName,
            objectiveTitle: `[Pendiente de aprobación] ${obj.title}`,
            objectiveType: obj.type || 'OKR',
            assignedBy: `${employee.firstName} ${employee.lastName}`,
            tenantId,
            userId: manager.id,
          })
          .catch(() => {});
      }
      // v3.0 Push al manager con el objetivo pendiente.
      if (manager) {
        const pushMsg = buildPushMessage(
          'objectivePendingApproval',
          manager.language ?? 'es',
          {
            employee: `${employee.firstName} ${employee.lastName}`,
            title: obj.title,
          },
        );
        this.pushService
          .sendToUser(
            manager.id,
            {
              title: pushMsg.title,
              body: pushMsg.body,
              url: '/dashboard/objetivos',
              tag: `obj-approval-${obj.id}`,
            },
            'objectives',
          )
          .catch(() => undefined);
      }
    }

    return saved;
  }

  /**
   * T4.1 — BUG-10: aprobación en batch transaccional por-item.
   *
   * Cada id se procesa en su propio try/catch. Un fallo (objetivo no
   * existe, no está en PENDING_APPROVAL, manager fuera de scope, etc.)
   * NO aborta los siguientes — devuelve `{ approved, failed }` con el
   * detalle. Esto reemplaza el loop secuencial cliente-side previo
   * que ante un fallo en la mitad dejaba estado parcial sin reportarlo.
   *
   * No se envuelve en una transacción única intencionalmente: por diseño,
   * cada aprobación es independiente y debe persistir si tiene éxito,
   * aunque otra del mismo batch falle.
   *
   * Validación de scope idéntica al single-approve:
   *   - super_admin / tenant_admin: aprueban cualquier objetivo del tenant
   *   - manager: solo objetivos propios o de reportes directos
   *     (assertManagerCanAccessUser per-item)
   */
  async bulkApprove(
    tenantId: string | undefined,
    ids: string[],
    callerUserId: string,
    callerRole: string,
  ): Promise<{
    approved: string[];
    failed: Array<{ id: string; reason: string }>;
  }> {
    const approved: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        // Manager scope check (mirrors controller's single-approve flow)
        if (callerRole === 'manager') {
          const objective = await this.findById(tenantId, id);
          if (objective.userId !== callerUserId) {
            await assertManagerCanAccessUser(
              this.userRepo,
              callerUserId,
              callerRole,
              objective.userId,
              objective.tenantId,
            );
          }
        }

        await this.approve(tenantId, id, callerUserId);
        approved.push(id);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'Error desconocido';
        failed.push({ id, reason });
      }
    }

    return { approved, failed };
  }

  async approve(
    tenantId: string | undefined,
    id: string,
    approvedBy?: string,
  ): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    const effectiveTenantId = obj.tenantId;
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Solo objetivos pendientes de aprobación pueden ser aprobados',
      );
    }
    obj.status = ObjectiveStatus.ACTIVE;
    obj.approvedBy = approvedBy || null;
    obj.approvedAt = new Date();
    obj.rejectionReason = null;
    const saved = await this.objectiveRepo.save(obj);
    this.auditService
      .log(
        effectiveTenantId,
        approvedBy || obj.userId,
        'objective.approved',
        'objective',
        id,
        { title: obj.title, approvedBy },
      )
      .catch(() => {});

    // Notify objective owner that it was approved
    const owner = await this.userRepo.findOne({
      where: { id: obj.userId },
      select: ['id', 'email', 'firstName'],
    });
    if (owner?.email) {
      this.emailService
        .sendObjectiveAssigned(owner.email, {
          firstName: owner.firstName,
          objectiveTitle: `[Aprobado] ${obj.title}`,
          objectiveType: obj.type || 'OKR',
          targetDate: obj.targetDate
            ? new Date(obj.targetDate).toLocaleDateString('es-CL')
            : undefined,
          tenantId: effectiveTenantId,
          userId: owner.id,
        })
        .catch(() => {});
    }

    return saved;
  }

  async reject(
    tenantId: string | undefined,
    id: string,
    rejectedBy?: string,
    reason?: string,
  ): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    const effectiveTenantId = obj.tenantId;
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Solo objetivos pendientes de aprobación pueden ser rechazados',
      );
    }
    obj.status = ObjectiveStatus.DRAFT;
    obj.rejectionReason = reason || null;
    obj.approvedBy = null;
    obj.approvedAt = null;
    const saved = await this.objectiveRepo.save(obj);

    // T8.2 — Audit P1: persistir el rechazo como fila en
    // objective_rejections para preservar el historial completo. La
    // columna `rejection_reason` en `objectives` queda como
    // denormalización del último rechazo (compat con UI legacy y
    // listados rápidos).
    if (rejectedBy) {
      this.rejectionRepo
        .save(
          this.rejectionRepo.create({
            tenantId: effectiveTenantId,
            objectiveId: id,
            rejectedBy,
            reason: reason || null,
            objectiveTitleSnapshot: obj.title,
          }),
        )
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Failed to persist objective rejection for ${id}: ${msg}`,
          );
        });
    }

    this.auditService
      .log(
        effectiveTenantId,
        rejectedBy || obj.userId,
        'objective.rejected',
        'objective',
        id,
        { title: obj.title, rejectedBy, reason },
      )
      .catch(() => {});

    // Notify objective owner that it was rejected
    const owner = await this.userRepo.findOne({
      where: { id: obj.userId },
      select: ['id', 'email', 'firstName'],
    });
    if (owner?.email) {
      this.emailService
        .sendObjectiveAssigned(owner.email, {
          firstName: owner.firstName,
          objectiveTitle: `[Rechazado] ${obj.title}`,
          objectiveType: reason
            ? `Motivo: ${reason}`
            : 'Sin motivo especificado',
          tenantId: effectiveTenantId,
          userId: owner.id,
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * T8.2 — Audit P1: lista el historial completo de rechazos de un
   * objetivo, ordenado del más reciente al más antiguo. Cada fila
   * incluye razón, autor (con datos básicos del user) y timestamp.
   * Si el objetivo nunca fue rechazado, devuelve [].
   */
  async listRejectionHistory(
    tenantId: string,
    objectiveId: string,
  ): Promise<ObjectiveRejection[]> {
    return this.rejectionRepo.find({
      where: { tenantId, objectiveId },
      relations: ['rejector'],
      order: { rejectedAt: 'DESC' },
    });
  }

  /**
   * T7.3 — Audit P1: ABANDONED queda reservado para soft-delete técnico
   * admin (este endpoint), no para cancelaciones de negocio. Para
   * cancelar por scope-change usar POST /:id/cancel (estado CANCELLED
   * con razón obligatoria + cancelledBy + cancelledAt).
   *
   * El controller restringe este endpoint a `super_admin` y `tenant_admin`
   * solamente — owner/manager no pueden disparar ABANDONED.
   *
   * El audit action 'objective.cancelled' se mantiene por compatibilidad
   * con histórico, pero el evento real es un soft-delete admin.
   */
  async remove(tenantId: string | undefined, id: string): Promise<void> {
    const obj = await this.findById(tenantId, id);
    const effectiveTenantId = obj.tenantId;
    obj.status = ObjectiveStatus.ABANDONED;
    await this.objectiveRepo.save(obj);
    this.auditService
      .log(
        effectiveTenantId,
        obj.userId,
        'objective.cancelled',
        'objective',
        id,
        { title: obj.title },
      )
      .catch(() => {});
  }

  /**
   * T7.2 — Audit P1: cancela un objetivo por decisión de negocio (cambio
   * de estrategia, scope-change, re-org). Reemplaza el uso anterior de
   * ABANDONED como cubo semántico — ahora ABANDONED queda solo para el
   * soft-delete técnico admin (DELETE).
   *
   * Estado terminal: una vez CANCELLED, el objetivo no se puede
   * reactivar (igual que COMPLETED). El owner debe crear uno nuevo si
   * cambian de opinión.
   *
   * Reglas:
   *   - Solo se puede cancelar desde DRAFT, PENDING_APPROVAL, ACTIVE u
   *     OVERDUE. Bloqueado desde COMPLETED/ABANDONED/CANCELLED.
   *   - Reason es obligatoria (validada por el DTO con MinLength=5).
   *   - Trazabilidad: cancelledBy, cancelledAt, cancellationReason
   *     quedan registrados en columnas dedicadas + audit log.
   */
  async cancel(
    tenantId: string | undefined,
    id: string,
    reason: string,
    cancelledBy: string,
  ): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    const effectiveTenantId = obj.tenantId;

    if (
      obj.status === ObjectiveStatus.COMPLETED ||
      obj.status === ObjectiveStatus.ABANDONED ||
      obj.status === ObjectiveStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede cancelar un objetivo que ya está completado, abandonado o cancelado',
      );
    }

    obj.status = ObjectiveStatus.CANCELLED;
    obj.cancellationReason = reason;
    obj.cancelledBy = cancelledBy;
    obj.cancelledAt = new Date();
    const saved = await this.objectiveRepo.save(obj);

    this.auditService
      .log(
        effectiveTenantId,
        cancelledBy,
        'objective.cancelled_by_business',
        'objective',
        id,
        { title: obj.title, reason, cancelledBy },
      )
      .catch(() => {});

    return saved;
  }

  // ─── Completion (shared helper) ─────────────────────────────────────────────

  /**
   * Transitions an objective to COMPLETED status, persists it, and fires the
   * standard completion side-effects:
   *   - Audit log "objective.completed"
   *   - +10 recognition points (G4)
   *   - In-app notification to the owner
   *   - Auto-badge check
   *   - Email to the direct manager (best-effort)
   *
   * Idempotent: if the objective is already COMPLETED the helper returns
   * without re-firing side-effects (no duplicate points, no duplicate emails).
   *
   * Caller responsibilities:
   *   - Validate prerequisites (e.g. OKR with all KRs completed) before
   *     invoking — the helper does NOT validate, it only completes.
   *   - Trigger `propagateProgressToParent` afterwards if the cascading-OKR
   *     hierarchy needs to be updated.
   *
   * Used by: addProgressUpdate (manual SMART/KPI/OKR-no-KR completion),
   * recalculateProgressFromKRs (auto-completion when KRs reach 100%, T1.2),
   * propagateProgressToParent (parent auto-completion when all children
   * complete, Task 3).
   */
  private async completeObjective(
    obj: Objective,
    completedBy: string,
  ): Promise<Objective> {
    if (obj.status === ObjectiveStatus.COMPLETED) {
      return obj; // idempotent: side-effects already fired on the original transition
    }

    obj.status = ObjectiveStatus.COMPLETED;
    if (obj.progress < 100) {
      obj.progress = 100;
    }
    const saved = await this.objectiveRepo.save(obj);

    this.auditService
      .log(
        saved.tenantId,
        completedBy,
        'objective.completed',
        'objective',
        saved.id,
        {
          title: saved.title,
          type: saved.type,
          completedBy,
        },
      )
      .catch(() => {});

    // G4: +10 puntos al completar un objetivo
    this.recognitionService
      .addPoints(
        saved.tenantId,
        saved.userId,
        10,
        PointsSource.OBJECTIVE_COMPLETED,
        `Objetivo "${saved.title}" completado`,
        saved.id,
      )
      .catch(() => {});

    // Notificación de logro al colaborador
    this.notificationsService
      .create({
        tenantId: saved.tenantId,
        userId: saved.userId,
        type: NotificationType.GENERAL,
        title: '🏆 ¡Objetivo cumplido!',
        message: `Completaste tu objetivo "${saved.title}". +10 puntos sumados a tu perfil. ¡Sigue así!`,
        metadata: { objectiveId: saved.id, objectiveCompleted: true },
      })
      .catch(() => {});

    // Auto-badge check (por si hay badges que requieran N objetivos completados)
    this.recognitionService
      .checkAutoBadges(saved.tenantId, saved.userId)
      .catch(() => {});

    // Email al manager directo (best-effort)
    try {
      const employee = await this.userRepo.findOne({
        where: { id: saved.userId },
        select: ['id', 'firstName', 'lastName', 'managerId'],
      });
      if (employee?.managerId) {
        const manager = await this.userRepo.findOne({
          where: { id: employee.managerId },
          select: ['id', 'email', 'firstName'],
        });
        if (manager?.email) {
          this.emailService
            .sendObjectiveCompleted(manager.email, {
              managerName: manager.firstName,
              employeeName: `${employee.firstName} ${employee.lastName}`,
              objectiveTitle: saved.title,
              objectiveType: saved.type || 'OKR',
              tenantId: saved.tenantId,
              userId: manager.id,
            })
            .catch(() => {});
        }
      }
    } catch {
      // best-effort: errores en lookups no propagan
    }

    return saved;
  }

  // ─── Progress ───────────────────────────────────────────────────────────────

  async addProgressUpdate(
    tenantId: string,
    userId: string,
    objectiveId: string,
    dto: CreateObjectiveUpdateDto,
  ): Promise<ObjectiveUpdate> {
    // Validate notes FIRST (no DB operation needed)
    if (!dto.notes || dto.notes.trim().length === 0) {
      throw new BadRequestException(
        'Debe indicar qué avance realizó para actualizar el progreso.',
      );
    }

    const obj = await this.findById(tenantId, objectiveId);
    if (obj.status === ObjectiveStatus.COMPLETED) {
      throw new BadRequestException(
        'Este objetivo ya está completado. No se puede actualizar el progreso',
      );
    }
    if (obj.status === ObjectiveStatus.ABANDONED) {
      throw new BadRequestException(
        'No se puede actualizar el progreso de un objetivo abandonado',
      );
    }
    if (obj.status === ObjectiveStatus.CANCELLED) {
      throw new BadRequestException(
        'No se puede actualizar el progreso de un objetivo cancelado',
      );
    }

    // OKR with Key Results: progress is calculated automatically from KRs
    const krs = await this.keyResultRepo.find({ where: { objectiveId } });
    if (obj.type === 'OKR' && krs.length > 0) {
      throw new BadRequestException(
        'Este objetivo OKR tiene Resultados Clave. El progreso se calcula automáticamente al actualizar los KRs. Use la sección "Resultados Clave" para registrar avances.',
      );
    }

    const previousProgress = obj.progress;
    obj.progress = dto.progressValue;
    let willComplete = false;

    if (dto.progressValue >= 100) {
      // OKR: must have KRs defined and all completed
      if (obj.type === 'OKR') {
        if (krs.length === 0) {
          throw new BadRequestException(
            'No se puede completar un OKR sin Resultados Clave definidos. Agregue al menos un KR.',
          );
        }
        const incompleteKrs = krs.filter(
          (kr: any) => kr.status !== 'completed',
        );
        if (incompleteKrs.length > 0) {
          throw new BadRequestException(
            `No se puede completar: tiene ${incompleteKrs.length} Resultado(s) Clave pendiente(s). Complete los KRs primero.`,
          );
        }
      }
      willComplete = true;
    } else if (obj.status === ObjectiveStatus.DRAFT) {
      obj.status = ObjectiveStatus.ACTIVE;
    }

    if (willComplete) {
      // Helper sets status=COMPLETED, persists, and fires side-effects
      // (audit, gamification, owner notification, manager email, auto-badges).
      await this.completeObjective(obj, userId);
    } else {
      await this.objectiveRepo.save(obj);
    }

    // B3.15: Propagate progress to parent objective (T3.1: pasa userId
    // como actor para audit del completion del padre si llega a 100%)
    await this.propagateProgressToParent(tenantId, objectiveId, userId);

    const update = this.updateRepo.create({
      tenantId,
      objectiveId,
      progressValue: dto.progressValue,
      notes: dto.notes,
      createdBy: userId,
    });
    const saved = await this.updateRepo.save(update);
    this.auditService
      .log(
        tenantId,
        userId,
        'objective.progress_updated',
        'objective',
        objectiveId,
        {
          title: obj.title,
          previousProgress,
          newProgress: dto.progressValue,
          notes: dto.notes,
        },
      )
      .catch(() => {});

    return saved;
  }

  async getProgressHistory(
    tenantId: string,
    objectiveId: string,
  ): Promise<ObjectiveUpdate[]> {
    return this.updateRepo.find({
      where: { tenantId, objectiveId },
      relations: ['creator'],
      order: { createdAt: 'ASC' },
    });
  }

  // B2.11: Objectives at risk — considers both progress AND time elapsed
  //
  // T13 — Audit P2: el cálculo de pace ahora corre en SQL en lugar de
  // traer todos los activos a memoria y filtrar en JS. Beneficio:
  //   - Postgres usa los índices y solo retorna at-risk
  //   - Tenants con miles de objetivos activos dejan de degradar
  //   - Memoria del proceso baja drásticamente (no carga todos los activos)
  //
  // Expresión SQL del threshold de at-risk:
  //   - target_date IS NULL              → progress < 40 (threshold simple)
  //   - target_date <= CURRENT_DATE      → progress < 100 (vencido = at-risk si no completado)
  //   - target_date <= created_at::date  → progress < 100 (totalDuration <= 0 edge case)
  //   - default                          → progress < pace * 0.6
  //     donde pace = (elapsed / total_duration, capped to 1) * 100
  async getAtRiskObjectives(
    tenantId: string,
    filterUserId?: string,
    role?: string,
    currentUserId?: string,
  ): Promise<Objective[]> {
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u', 'u.tenant_id = o.tenant_id')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE })
      // Filtro at-risk en SQL: el WHERE final solo deja pasar objetivos
      // cuyo progress está por debajo del threshold calculado per-fila.
      .andWhere(
        `o.progress < (
          CASE
            WHEN o.target_date IS NULL THEN 40
            WHEN o.target_date <= CURRENT_DATE THEN 100
            WHEN o.target_date::timestamp <= o.created_at THEN 100
            ELSE LEAST(
              1.0,
              EXTRACT(EPOCH FROM (NOW() - o.created_at)) /
              NULLIF(EXTRACT(EPOCH FROM (o.target_date::timestamp - o.created_at)), 0)
            ) * 100 * 0.6
          END
        )`,
      );

    if (role === 'manager' && currentUserId) {
      // Manager: only see at-risk objectives for their direct reports + own
      qb.andWhere('(o.userId = :mgr OR u.manager_id = :mgr)', {
        mgr: currentUserId,
      });
    } else if (filterUserId) {
      qb.andWhere('o.userId = :filterUserId', { filterUserId });
    }

    return qb.orderBy('o.progress', 'ASC').getMany();
  }

  async getCompletionStats(tenantId: string, userId: string) {
    const total = await this.objectiveRepo.count({
      where: { tenantId, userId },
    });
    const completed = await this.objectiveRepo.count({
      where: { tenantId, userId, status: ObjectiveStatus.COMPLETED },
    });
    return { total, completed, inProgress: total - completed };
  }

  // ─── Team Summary (B4 Item 12) ─────────────────────────────────────────────

  async getTeamObjectivesSummary(tenantId: string, managerId?: string) {
    // managerId undefined = admin view (all active users in tenant)
    const subordinates = await this.userRepo.find({
      where: managerId
        ? { tenantId, managerId, isActive: true }
        : { tenantId, isActive: true },
      select: ['id', 'firstName', 'lastName', 'position', 'department'],
    });

    if (subordinates.length === 0) {
      return {
        members: [],
        totals: {
          totalMembers: 0,
          totalObjectives: 0,
          totalAtRisk: 0,
          avgProgress: 0,
        },
      };
    }

    const userIds = subordinates.map((u) => u.id);

    // Single query: all objectives for all subordinates
    const allObjectives = await this.objectiveRepo.find({
      where: { tenantId, userId: In(userIds) },
    });

    // Group by userId
    const byUser = new Map<string, typeof allObjectives>();
    for (const obj of allObjectives) {
      const list = byUser.get(obj.userId) || [];
      list.push(obj);
      byUser.set(obj.userId, list);
    }

    const summary = subordinates.map((user) => {
      const objectives = byUser.get(user.id) || [];
      const active = objectives.filter(
        (o) => o.status === ObjectiveStatus.ACTIVE,
      );
      const completed = objectives.filter(
        (o) => o.status === ObjectiveStatus.COMPLETED,
      );
      const atRisk = active.filter((o) => o.progress < 40);
      const totalWeight = active.reduce(
        (sum, o) => sum + Number(o.weight || 0),
        0,
      );
      const avgProgress =
        active.length > 0
          ? Math.round(
              active.reduce((sum, o) => sum + o.progress, 0) / active.length,
            )
          : 0;

      return {
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        position: user.position,
        department: user.department,
        totalObjectives: objectives.length,
        activeCount: active.length,
        completedCount: completed.length,
        atRiskCount: atRisk.length,
        avgProgress,
        totalWeight,
      };
    });

    const teamTotals = {
      totalMembers: subordinates.length,
      totalObjectives: summary.reduce((s, m) => s + m.totalObjectives, 0),
      totalAtRisk: summary.reduce((s, m) => s + m.atRiskCount, 0),
      avgProgress:
        summary.length > 0
          ? Math.round(
              summary.reduce((s, m) => s + m.avgProgress, 0) / summary.length,
            )
          : 0,
    };

    return { members: summary, totals: teamTotals };
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  async listComments(
    tenantId: string,
    objectiveId: string,
  ): Promise<ObjectiveComment[]> {
    return this.commentRepo.find({
      where: { tenantId, objectiveId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async createComment(
    tenantId: string,
    objectiveId: string,
    authorId: string,
    data: {
      content: string;
      type?: string;
      attachmentUrl?: string;
      attachmentName?: string;
    },
  ): Promise<ObjectiveComment> {
    // Verify objective exists
    await this.findById(tenantId, objectiveId);

    const comment = this.commentRepo.create({
      tenantId,
      objectiveId,
      authorId,
      content: data.content,
      type: data.type || 'comentario',
      attachmentUrl: data.attachmentUrl || null,
      attachmentName: data.attachmentName || null,
    });
    const saved = await this.commentRepo.save(comment);
    return this.commentRepo.findOne({
      where: { id: saved.id },
      relations: ['author'],
    }) as Promise<ObjectiveComment>;
  }

  async deleteComment(
    tenantId: string,
    commentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId, tenantId },
    });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    // Only the author or tenant_admin can delete
    if (comment.authorId !== requesterId && requesterRole !== 'tenant_admin') {
      throw new ForbiddenException(
        'Solo el autor o el administrador puede eliminar este comentario',
      );
    }

    await this.commentRepo.remove(comment);
  }

  // ─── Objective Tree / Cascading OKR (B3.15) ────────────────────────────────

  /**
   * Returns all objectives for a tenant organized as a tree.
   * Root objectives (parentObjectiveId = null) are at the top,
   * with children nested recursively.
   */
  async getObjectiveTree(
    tenantId: string,
    role?: string,
    currentUserId?: string,
  ): Promise<any[]> {
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.tenantId = :tenantId', { tenantId })
      .orderBy('o.createdAt', 'ASC');

    // Manager: only see objectives from their team + own
    if (role === 'manager' && currentUserId) {
      qb.andWhere('(o.userId = :mgr OR u.manager_id = :mgr)', {
        mgr: currentUserId,
      });
    }

    const all = await qb.getMany();

    const map = new Map<string, any>();
    for (const obj of all) {
      map.set(obj.id, {
        id: obj.id,
        title: obj.title,
        description: obj.description,
        type: obj.type,
        status: obj.status,
        progress: obj.progress,
        weight: Number(obj.weight),
        targetDate: obj.targetDate,
        parentObjectiveId: obj.parentObjectiveId,
        userId: obj.userId,
        userName: obj.user
          ? `${obj.user.firstName} ${obj.user.lastName}`
          : null,
        userPosition: obj.user?.position || null,
        children: [],
      });
    }

    const roots: any[] = [];
    for (const node of map.values()) {
      if (node.parentObjectiveId && map.has(node.parentObjectiveId)) {
        map.get(node.parentObjectiveId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Validates that a parent objective exists, belongs to same tenant,
   * and doesn't create a circular reference.
   */
  private async validateParentObjective(
    tenantId: string,
    parentId: string,
    currentId?: string,
  ): Promise<void> {
    const parent = await this.objectiveRepo.findOne({
      where: { id: parentId, tenantId },
    });
    if (!parent) {
      throw new BadRequestException(
        'El objetivo padre no existe en esta organización',
      );
    }

    // Check for circular reference: walk up the chain
    if (currentId) {
      let checkId: string | null = parent.parentObjectiveId;
      const visited = new Set<string>([currentId]);
      while (checkId) {
        if (visited.has(checkId)) {
          throw new BadRequestException(
            'No se puede crear una referencia circular entre objetivos',
          );
        }
        visited.add(checkId);
        const ancestor = await this.objectiveRepo.findOne({
          where: { id: checkId, tenantId },
        });
        checkId = ancestor?.parentObjectiveId || null;
      }
    }
  }

  /**
   * When a child objective updates its progress, recalculate the parent's
   * progress as the weighted average of all its children, recursively up
   * the chain.
   *
   * T3.1 — BUG-9: además del recálculo de progress, dispara la auto-completion
   * del padre cuando `parentProgress >= 100` y el padre está ACTIVE (helper
   * compartido con Tarea 1). El completeObjective es idempotente: re-llamadas
   * sobre un padre ya COMPLETED no re-disparan side-effects.
   *
   * T3.2 — Guard contra cadenas circulares latentes. validateParentObjective
   * previene crear ciclos en runtime, pero data legacy (migraciones, fixes
   * manuales) podrían tener A→B→A. El parámetro `visited` arranca vacío y
   * acumula los IDs de padres visitados en la cadena; si reaparece uno,
   * abortamos sin loop infinito.
   *
   * `actorUserId` se propaga a completeObjective como `completedBy`. Si no
   * se pasa (paths internos sin contexto de usuario), cae al `userId` del
   * owner del padre.
   */
  async propagateProgressToParent(
    tenantId: string,
    objectiveId: string,
    actorUserId?: string,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    const obj = await this.objectiveRepo.findOne({
      where: { id: objectiveId, tenantId },
    });
    if (!obj?.parentObjectiveId) return;

    // T3.2: abortar si la cadena ya visitó este padre (ciclo legacy)
    if (visited.has(obj.parentObjectiveId)) {
      this.logger.warn(
        `Circular parent chain detected at objective ${obj.parentObjectiveId} (tenant ${tenantId}); aborting propagation`,
      );
      return;
    }
    visited.add(obj.parentObjectiveId);

    const siblings = await this.objectiveRepo.find({
      where: { tenantId, parentObjectiveId: obj.parentObjectiveId },
    });

    if (siblings.length === 0) return;

    const totalWeight = siblings.reduce(
      (sum, s) => sum + Number(s.weight || 0),
      0,
    );

    let parentProgress: number;
    if (totalWeight > 0) {
      // Weighted average
      parentProgress = Math.round(
        siblings.reduce(
          (sum, s) => sum + s.progress * Number(s.weight || 0),
          0,
        ) / totalWeight,
      );
    } else {
      // Simple average if no weights
      parentProgress = Math.round(
        siblings.reduce((sum, s) => sum + s.progress, 0) / siblings.length,
      );
    }
    parentProgress = Math.min(100, parentProgress);

    await this.objectiveRepo.update(
      { id: obj.parentObjectiveId, tenantId },
      { progress: parentProgress },
    );

    // T3.1: si el padre alcanza 100% y está ACTIVE u OVERDUE, auto-completarlo
    if (parentProgress >= 100) {
      const parent = await this.objectiveRepo.findOne({
        where: { id: obj.parentObjectiveId, tenantId },
      });
      if (
        parent &&
        (parent.status === ObjectiveStatus.ACTIVE ||
          parent.status === ObjectiveStatus.OVERDUE)
      ) {
        await this.completeObjective(parent, actorUserId ?? parent.userId);
      }
    }

    // Recurse up the chain (con el mismo visited set y actorUserId)
    await this.propagateProgressToParent(
      tenantId,
      obj.parentObjectiveId,
      actorUserId,
      visited,
    );
  }

  // ─── Key Results (B2.10) ──────────────────────────────────────────────────

  async listKeyResults(
    tenantId: string,
    objectiveId: string,
  ): Promise<KeyResult[]> {
    return this.keyResultRepo.find({
      where: { tenantId, objectiveId },
      order: { createdAt: 'ASC' },
    });
  }

  async createKeyResult(
    tenantId: string,
    objectiveId: string,
    data: {
      description: string;
      unit?: string;
      baseValue?: number;
      targetValue?: number;
    },
  ): Promise<KeyResult> {
    await this.findById(tenantId, objectiveId);
    // B7.6: targetValue must be > 0
    const base = data.baseValue ?? 0;
    const target = data.targetValue ?? 100;
    if (target <= 0) {
      throw new BadRequestException(
        'El valor objetivo del KR debe ser mayor a 0',
      );
    }
    // B7.7: targetValue must not equal baseValue (division by zero in progress calc)
    if (target === base) {
      throw new BadRequestException(
        'El valor objetivo no puede ser igual al valor base (causaría división por cero)',
      );
    }
    const kr = this.keyResultRepo.create({
      tenantId,
      objectiveId,
      description: data.description,
      unit: data.unit || '%',
      baseValue: data.baseValue ?? 0,
      targetValue: data.targetValue ?? 100,
      currentValue: data.baseValue ?? 0,
      status: KRStatus.ACTIVE,
    });
    return this.keyResultRepo.save(kr);
  }

  async updateKeyResult(
    tenantId: string,
    krId: string,
    data: {
      currentValue?: number;
      description?: string;
      targetValue?: number;
      status?: KRStatus;
    },
    actorUserId?: string,
  ): Promise<KeyResult> {
    const kr = await this.keyResultRepo.findOne({
      where: { id: krId, tenantId },
    });
    if (!kr) throw new NotFoundException('Key Result no encontrado');
    if (data.currentValue !== undefined) kr.currentValue = data.currentValue;
    if (data.description !== undefined) kr.description = data.description;
    if (data.targetValue !== undefined) kr.targetValue = data.targetValue;
    if (data.status !== undefined) kr.status = data.status;

    // Auto-complete KR if currentValue >= targetValue
    if (
      Number(kr.currentValue) >= Number(kr.targetValue) &&
      kr.status === KRStatus.ACTIVE
    ) {
      kr.status = KRStatus.COMPLETED;
    }

    const saved = await this.keyResultRepo.save(kr);

    // Recalculate objective progress from KR completion (and possibly auto-complete)
    await this.recalculateProgressFromKRs(
      tenantId,
      kr.objectiveId,
      actorUserId,
    );

    return saved;
  }

  async deleteKeyResult(
    tenantId: string,
    krId: string,
    actorUserId?: string,
  ): Promise<void> {
    const kr = await this.keyResultRepo.findOne({
      where: { id: krId, tenantId },
    });
    if (!kr) throw new NotFoundException('Key Result no encontrado');
    const objectiveId = kr.objectiveId;
    await this.keyResultRepo.remove(kr);
    await this.recalculateProgressFromKRs(tenantId, objectiveId, actorUserId);
  }

  /**
   * Recalcula el progreso del objetivo a partir del estado actual de sus KRs.
   *
   * T1.2: además del cálculo de progress, dispara la auto-completion del
   * objetivo cuando se cumplen TODAS estas condiciones simultáneamente:
   *   1. avgProgress >= 100
   *   2. Todos los KRs están en estado COMPLETED
   *   3. El objetivo está en estado ACTIVE
   *
   * El doble check (progress + status de KRs) es defensivo: avgProgress
   * podría llegar a 100 por redondeo aunque algún KR siga ACTIVE, y un KR
   * podría tener `status=COMPLETED` con `currentValue>targetValue` (caso
   * raro). Solo cuando ambas condiciones coinciden disparamos la
   * transición — evita falsos positivos.
   *
   * `actorUserId` se usa como `completedBy` en el helper. Si no se pasa
   * (callers internos como propagateProgressToParent — Tarea 3), cae al
   * `userId` del owner del objetivo.
   */
  private async recalculateProgressFromKRs(
    tenantId: string,
    objectiveId: string,
    actorUserId?: string,
  ): Promise<void> {
    const krs = await this.keyResultRepo.find({
      where: { tenantId, objectiveId },
    });
    if (krs.length === 0) return;

    const totalProgress = krs.reduce((sum, kr) => {
      const range = Number(kr.targetValue) - Number(kr.baseValue);
      if (range <= 0) return sum + (kr.status === KRStatus.COMPLETED ? 100 : 0);
      const krProgress = Math.min(
        100,
        Math.max(
          0,
          ((Number(kr.currentValue) - Number(kr.baseValue)) / range) * 100,
        ),
      );
      return sum + krProgress;
    }, 0);

    const avgProgress = Math.round(totalProgress / krs.length);
    await this.objectiveRepo.update(
      { id: objectiveId, tenantId },
      { progress: avgProgress },
    );

    // T1.2: auto-complete objective when KRs reach 100% (fixes BUG-1)
    const allCompleted = krs.every((kr) => kr.status === KRStatus.COMPLETED);
    if (allCompleted && avgProgress >= 100) {
      const obj = await this.objectiveRepo.findOne({
        where: { id: objectiveId, tenantId },
      });
      // Complete from ACTIVE u OVERDUE (T6: vencido también puede cerrar
      // con KRs completados). DRAFT/PENDING/ABANDONED no auto-completan.
      // Helper es idempotente sobre objetivos ya COMPLETED.
      if (
        obj &&
        (obj.status === ObjectiveStatus.ACTIVE ||
          obj.status === ObjectiveStatus.OVERDUE)
      ) {
        await this.completeObjective(obj, actorUserId ?? obj.userId);
      }
    }

    // T3.2 — BUG-9 bridge: propagar al padre tras recalcular desde KRs.
    // Antes de este fix, las completaciones via KR no actualizaban el
    // progress del padre — el cascading OKR solo funcionaba para
    // SMART/KPI vía addProgressUpdate.
    await this.propagateProgressToParent(tenantId, objectiveId, actorUserId);
  }

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  }

  private async getExportData(
    tenantId: string,
    userId?: string,
    role?: string,
  ): Promise<any[]> {
    if (role === 'employee' || role === 'external') {
      return this.findByUser(tenantId, userId!);
    }
    if (role === 'manager' && userId) {
      return this.findByManager(tenantId, userId);
    }
    return this.findAll(tenantId);
  }

  async exportObjectivesCsv(
    tenantId: string,
    userId?: string,
    role?: string,
  ): Promise<string> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const rows: string[] = [];
    rows.push(
      'Título,Tipo,Estado,Progreso %,Peso,Fecha Meta,Responsable,Departamento',
    );
    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      pending_approval: 'Pendiente',
      active: 'Activo',
      overdue: 'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
      abandoned: 'Abandonado',
    };
    for (const obj of objectives) {
      const userName = obj.user
        ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim()
        : '';
      const dept = obj.user?.department || '';
      rows.push(
        [
          this.escapeCsv(obj.title),
          obj.type || 'OKR',
          statusLabels[obj.status] || obj.status,
          obj.progress,
          obj.weight || 0,
          obj.targetDate
            ? new Date(obj.targetDate).toLocaleDateString('es-CL')
            : '',
          this.escapeCsv(userName),
          this.escapeCsv(dept),
        ].join(','),
      );
    }
    return '\uFEFF' + rows.join('\n');
  }

  async exportObjectivesXlsx(
    tenantId: string,
    userId?: string,
    role?: string,
  ): Promise<Buffer> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      pending_approval: 'Pendiente',
      active: 'Activo',
      overdue: 'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
      abandoned: 'Abandonado',
    };

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: accent,
    };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Objetivos / OKRs']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    const total = objectives.length;
    const active = objectives.filter((o: any) => o.status === 'active').length;
    const completed = objectives.filter(
      (o: any) => o.status === 'completed',
    ).length;
    const atRisk = objectives.filter(
      (o: any) => o.status === 'active' && o.progress < 40,
    ).length;
    const avgProgress =
      total > 0
        ? Math.round(
            objectives.reduce((s: number, o: any) => s + (o.progress || 0), 0) /
              total,
          )
        : 0;
    ws1.addRow(['Total objetivos', total]);
    ws1.addRow(['Activos', active]);
    ws1.addRow(['Completados', completed]);
    ws1.addRow(['En riesgo (<40%)', atRisk]);
    ws1.addRow(['Progreso promedio', `${avgProgress}%`]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);

    // Sheet 2: Detalle
    const ws2 = wb.addWorksheet('Objetivos');
    ws2.columns = [
      { width: 35 },
      { width: 10 },
      { width: 14 },
      { width: 12 },
      { width: 10 },
      { width: 14 },
      { width: 22 },
      { width: 18 },
    ];
    const h2 = ws2.addRow([
      'Título',
      'Tipo',
      'Estado',
      'Progreso %',
      'Peso',
      'Fecha Meta',
      'Responsable',
      'Departamento',
    ]);
    h2.eachCell((cell) => {
      cell.font = headerFont;
      cell.fill = headerFill;
    });
    for (const obj of objectives) {
      const userName = obj.user
        ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim()
        : '';
      ws2.addRow([
        obj.title,
        obj.type || 'OKR',
        statusLabels[obj.status] || obj.status,
        obj.progress,
        obj.weight || 0,
        obj.targetDate
          ? new Date(obj.targetDate).toLocaleDateString('es-CL')
          : '',
        userName,
        obj.user?.department || '',
      ]);
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportObjectivesPdf(
    tenantId: string,
    userId?: string,
    role?: string,
  ): Promise<Buffer> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      pending_approval: 'Pendiente',
      active: 'Activo',
      overdue: 'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
      abandoned: 'Abandonado',
    };

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4'); // landscape for more columns
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Objetivos / OKRs', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(
      `Exportado el ${new Date().toLocaleDateString('es-CL')}`,
      margin,
      24,
    );

    let y = 38;

    // KPIs
    const total = objectives.length;
    const active = objectives.filter((o: any) => o.status === 'active').length;
    const completedCount = objectives.filter(
      (o: any) => o.status === 'completed',
    ).length;
    const atRisk = objectives.filter(
      (o: any) => o.status === 'active' && o.progress < 40,
    ).length;
    const avgProgress =
      total > 0
        ? Math.round(
            objectives.reduce((s: number, o: any) => s + (o.progress || 0), 0) /
              total,
          )
        : 0;

    const kpis = [
      { label: 'Total', value: `${total}` },
      { label: 'Activos', value: `${active}` },
      { label: 'Completados', value: `${completedCount}` },
      { label: 'En Riesgo', value: `${atRisk}` },
      { label: 'Progreso Prom.', value: `${avgProgress}%` },
    ];
    const kpiW = (pageW - 2 * margin - 4 * 4) / 5;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
      doc.setFontSize(12);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
    });
    y += 26;

    // Table
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [
        [
          'Título',
          'Tipo',
          'Estado',
          'Progreso',
          'Peso',
          'Fecha Meta',
          'Responsable',
        ],
      ],
      body: objectives.map((o: any) => [
        o.title,
        o.type || 'OKR',
        statusLabels[o.status] || o.status,
        `${o.progress}%`,
        o.weight || 0,
        o.targetDate ? new Date(o.targetDate).toLocaleDateString('es-CL') : '-',
        o.user
          ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim()
          : '',
      ]),
      headStyles: {
        fillColor: [201, 147, 58],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`,
        margin,
        doc.internal.pageSize.getHeight() - 8,
      );
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageW - margin,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' },
      );
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Tree Export (hierarchical view) ─────────────────────────────────

  private flattenTree(nodes: any[], depth = 0): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.children?.length) {
        result.push(...this.flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }

  async exportObjectivesTreeXlsx(
    tenantId: string,
    role?: string,
    userId?: string,
  ): Promise<Buffer> {
    const tree = await this.getObjectiveTree(tenantId, role, userId);
    const flat = this.flattenTree(tree);
    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      pending_approval: 'Pendiente',
      active: 'Activo',
      overdue: 'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
      abandoned: 'Abandonado',
    };

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: accent,
    };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Objetivos / OKRs — Vista Árbol']).font = {
      bold: true,
      size: 14,
    };
    ws1.addRow([]);
    const total = flat.length;
    const active = flat.filter((o) => o.status === 'active').length;
    const completed = flat.filter((o) => o.status === 'completed').length;
    const roots = tree.length;
    ws1.addRow(['Total objetivos', total]);
    ws1.addRow(['Objetivos raíz', roots]);
    ws1.addRow(['Activos', active]);
    ws1.addRow(['Completados', completed]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);

    // Sheet 2: Árbol
    const ws2 = wb.addWorksheet('Árbol de Objetivos');
    ws2.columns = [
      { width: 6 },
      { width: 40 },
      { width: 10 },
      { width: 14 },
      { width: 12 },
      { width: 10 },
      { width: 14 },
      { width: 22 },
    ];
    const h2 = ws2.addRow([
      'Nivel',
      'Título',
      'Tipo',
      'Estado',
      'Progreso %',
      'Peso',
      'Fecha Meta',
      'Responsable',
    ]);
    h2.eachCell((cell) => {
      cell.font = headerFont;
      cell.fill = headerFill;
    });
    for (const obj of flat) {
      const indent = '  '.repeat(obj.depth);
      const prefix = obj.depth > 0 ? '└ ' : '';
      const row = ws2.addRow([
        obj.depth,
        `${indent}${prefix}${obj.title}`,
        obj.type || 'OKR',
        statusLabels[obj.status] || obj.status,
        obj.progress,
        obj.weight || 0,
        obj.targetDate
          ? new Date(obj.targetDate).toLocaleDateString('es-CL')
          : '',
        obj.userName || '',
      ]);
      if (obj.depth > 0) {
        row.getCell(2).font = { italic: true, color: { argb: 'FF6B7280' } };
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportObjectivesTreePdf(
    tenantId: string,
    role?: string,
    userId?: string,
  ): Promise<Buffer> {
    const tree = await this.getObjectiveTree(tenantId, role, userId);
    const flat = this.flattenTree(tree);
    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      pending_approval: 'Pendiente',
      active: 'Activo',
      overdue: 'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
      abandoned: 'Abandonado',
    };

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Objetivos / OKRs — Vista Árbol', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(
      `Exportado el ${new Date().toLocaleDateString('es-CL')}`,
      margin,
      24,
    );

    let y = 38;

    // KPIs
    const total = flat.length;
    const active = flat.filter((o) => o.status === 'active').length;
    const completedCount = flat.filter((o) => o.status === 'completed').length;
    const roots = tree.length;

    const kpis = [
      { label: 'Total', value: `${total}` },
      { label: 'Raíz', value: `${roots}` },
      { label: 'Activos', value: `${active}` },
      { label: 'Completados', value: `${completedCount}` },
    ];
    const kpiW = (pageW - 2 * margin - 3 * 4) / 4;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
      doc.setFontSize(12);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
    });
    y += 26;

    // Table with indentation
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [
        [
          'Título',
          'Tipo',
          'Estado',
          'Progreso',
          'Peso',
          'Fecha Meta',
          'Responsable',
        ],
      ],
      body: flat.map((o: any) => {
        const indent = '  '.repeat(o.depth);
        const prefix = o.depth > 0 ? '└ ' : '';
        return [
          `${indent}${prefix}${o.title}`,
          o.type || 'OKR',
          statusLabels[o.status] || o.status,
          `${o.progress}%`,
          o.weight || 0,
          o.targetDate
            ? new Date(o.targetDate).toLocaleDateString('es-CL')
            : '-',
          o.userName || '',
        ];
      }),
      headStyles: {
        fillColor: [201, 147, 58],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data: any) => {
        // Bold root objectives
        if (data.section === 'body' && data.column.index === 0) {
          const rowFlat = flat[data.row.index];
          if (rowFlat && rowFlat.depth === 0) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`,
        margin,
        doc.internal.pageSize.getHeight() - 8,
      );
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageW - margin,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' },
      );
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
