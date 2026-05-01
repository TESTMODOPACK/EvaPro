import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, IsNull, DataSource } from 'typeorm';
import { EngagementSurvey, SurveySettings } from './entities/engagement-survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyResponse } from './entities/survey-response.entity';
import { SurveyAssignment } from './entities/survey-assignment.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { buildPushMessage } from '../notifications/push-messages';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { OrgDevelopmentService } from '../org-development/org-development.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AuditService } from '../audit/audit.service';
import { PlanFeature } from '../../common/constants/plan-features';
import { TenantCronRunner } from '../../common/rls/tenant-cron-runner';

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    @InjectRepository(EngagementSurvey)
    private readonly surveyRepo: Repository<EngagementSurvey>,
    @InjectRepository(SurveyQuestion)
    private readonly questionRepo: Repository<SurveyQuestion>,
    @InjectRepository(SurveyResponse)
    private readonly responseRepo: Repository<SurveyResponse>,
    @InjectRepository(SurveyAssignment)
    private readonly assignmentRepo: Repository<SurveyAssignment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
    private readonly aiInsightsService: AiInsightsService,
    private readonly orgDevService: OrgDevelopmentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditService: AuditService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    // F4 A3 — para setear app.current_tenant_id en crons.
    private readonly tenantCronRunner: TenantCronRunner,
  ) {}

  // ─── Settings ──────────────────────────────────────────────────────────

  /**
   * T3 — Sanitiza el jsonb `settings` que llega del cliente.
   *
   * Solo conserva las llaves conocidas y las normaliza a boolean. Esto:
   *   - evita que un admin malicioso o un cliente buggy nos guarde basura
   *     en el jsonb (por ejemplo strings, objetos anidados o llaves
   *     desconocidas que despues confundirian al responder).
   *   - garantiza que el frontend reciba siempre la misma forma del
   *     objeto, asi puede usar `survey.settings.showProgressBar ?? true`
   *     sin defensas extra.
   *   - centraliza los defaults aqui (mismo lugar para create/update).
   */
  /**
   * T4 — Sanitiza un array de UUIDs de departamento. Acepta solo strings
   * con shape de UUID v1-v5 y descarta el resto. Asi evitamos guardar
   * basura (e.g., nombres de departamento mezclados con IDs cuando el
   * cliente envia mal el payload).
   */
  private sanitizeDeptIds(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return input
      .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v.trim()))
      .map((s) => s.trim());
  }

  private sanitizeSettings(input: unknown, isAnonymous?: boolean): SurveySettings {
    if (!input || typeof input !== 'object') input = {};
    const src = input as Record<string, unknown>;
    const out: SurveySettings = {};
    if (typeof src.showProgressBar === 'boolean') out.showProgressBar = src.showProgressBar;
    if (typeof src.randomizeQuestions === 'boolean') out.randomizeQuestions = src.randomizeQuestions;
    if (typeof src.allowPartialSave === 'boolean') out.allowPartialSave = src.allowPartialSave;

    // Defense-in-depth: partial save server-side requiere asociar la
    // respuesta parcial a un userId. Si la encuesta es anonima, NO podemos
    // hacerlo sin romper anonimato, asi que forzamos allowPartialSave=false
    // aunque el cliente lo haya enviado en true. Esto evita que una mala
    // configuracion en el form quede persistida y luego confunda al
    // respondente con un boton "Guardar progreso" que el endpoint rechaza.
    if (isAnonymous && out.allowPartialSave) {
      out.allowPartialSave = false;
    }
    return out;
  }

  // ─── Feature gate ──────────────────────────────────────────────────────

  private async checkFeature(tenantId: string, feature: string = PlanFeature.ENGAGEMENT_SURVEYS): Promise<void> {
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (!sub || !sub.plan) {
      throw new ForbiddenException('No se encontró una suscripción activa para este tenant.');
    }
    const features: string[] = sub.plan.features || [];
    if (!features.includes(feature)) {
      throw new ForbiddenException(
        `Su plan "${sub.plan.name}" no incluye esta funcionalidad. Actualice a un plan superior.`,
      );
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string,
    dto: {
      title: string;
      description?: string;
      isAnonymous?: boolean;
      targetAudience?: string;
      targetDepartments?: string[];
      /** T4 — preferido sobre `targetDepartments` para evitar matching
       *  por nombre. Si llega vacio, se mantiene matching legacy por
       *  nombre (retrocompat con tenants sin IDs estables). */
      targetDepartmentIds?: string[];
      startDate: string;
      endDate: string;
      settings?: Record<string, any>;
      questions: Array<{
        category: string;
        questionText: string;
        questionType: string;
        options?: string[];
        isRequired?: boolean;
        sortOrder?: number;
      }>;
    },
  ): Promise<EngagementSurvey> {
    await this.checkFeature(tenantId);

    if (!dto.questions || dto.questions.length === 0) {
      throw new BadRequestException('La encuesta debe tener al menos una pregunta.');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio.');
    }

    const isAnonymous = dto.isAnonymous ?? true;
    // T4 — Sanitizar arrays: solo strings no vacios. departmentIds se valida
    // con regex UUID basico para evitar guardar basura en el jsonb.
    const sanitizedDeptNames = Array.isArray(dto.targetDepartments)
      ? dto.targetDepartments.filter((s) => typeof s === 'string' && s.trim().length > 0)
      : [];
    const sanitizedDeptIds = this.sanitizeDeptIds(dto.targetDepartmentIds);

    const survey = this.surveyRepo.create({
      tenantId,
      title: dto.title,
      description: dto.description ?? null,
      isAnonymous,
      targetAudience: dto.targetAudience ?? 'all',
      targetDepartments: sanitizedDeptNames,
      targetDepartmentIds: sanitizedDeptIds,
      startDate,
      endDate,
      createdBy: userId,
      settings: this.sanitizeSettings(dto.settings, isAnonymous),
      status: 'draft',
    });
    const saved = await this.surveyRepo.save(survey);

    // Create questions
    const questions = dto.questions.map((q, i) =>
      this.questionRepo.create({
        surveyId: saved.id,
        category: q.category,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.options ?? null,
        isRequired: q.isRequired ?? true,
        sortOrder: q.sortOrder ?? i,
      }),
    );
    await this.questionRepo.save(questions);

    await this.auditService.log(tenantId, userId, 'survey_created', 'engagement_survey', saved.id, { title: dto.title });

    return this.findById(tenantId, saved.id);
  }

  async findAll(tenantId: string): Promise<EngagementSurvey[]> {
    // Tenant guard on creator join — survey.createdBy could be orphan
    // cross-tenant after a data migration.
    return this.surveyRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.creator', 'creator', 'creator.tenant_id = s.tenant_id')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.createdAt', 'DESC')
      .take(200) // Safety cap — surveys are low-volume
      .getMany();
  }

  /**
   * P5.1 — Secondary cross-tenant pattern: si tenantId es undefined
   * (super_admin actuando cross-tenant), busca por id sin filtro de
   * tenant. El service consumer debe usar `survey.tenantId` authoritative
   * para todas las operaciones side-effect posteriores.
   */
  async findById(tenantId: string | undefined, surveyId: string): Promise<EngagementSurvey> {
    const qb = this.surveyRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.creator', 'creator', 'creator.tenant_id = s.tenant_id')
      .leftJoinAndSelect('s.questions', 'questions')
      .where('s.id = :id', { id: surveyId })
      .orderBy('questions.sortOrder', 'ASC');
    if (tenantId) qb.andWhere('s.tenantId = :tenantId', { tenantId });
    const survey = await qb.getOne();
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    return survey;
  }

  /**
   * T3 — Vista de la encuesta para el respondente.
   *
   * Identica a findById, pero si `settings.randomizeQuestions` esta
   * activo, hace shuffle DENTRO de cada categoria (preserva el
   * agrupamiento visual que ya tiene el responder) usando un PRNG
   * con seed estable derivada de (surveyId + userId). Esto garantiza
   * que un mismo respondente vea siempre el mismo orden si recarga
   * la pagina, pero respondentes distintos ven ordenes distintos.
   *
   * No se usa para admin/manager: solo se invoca desde el endpoint
   * `respond-view`. El findById regular sigue retornando preguntas
   * por sortOrder ASC.
   */
  async findByIdForRespondent(
    tenantId: string,
    surveyId: string,
    userId: string,
  ): Promise<EngagementSurvey> {
    const survey = await this.findById(tenantId, surveyId);

    if (!survey.settings?.randomizeQuestions || !survey.questions?.length) {
      return survey;
    }

    // Agrupa por categoria preservando el orden de aparicion de las
    // categorias (no las shuffleamos — solo shuffle interno).
    const byCategory = new Map<string, SurveyQuestion[]>();
    for (const q of survey.questions) {
      const list = byCategory.get(q.category) ?? [];
      list.push(q);
      byCategory.set(q.category, list);
    }

    // PRNG determinista: mulberry32 con seed = hash(surveyId + userId).
    // Es suficientemente uniforme para shuffle visual y reproducible
    // sin depender de Math.random ni de crypto.
    const seed = this.hashSeed(`${surveyId}:${userId}`);
    const rng = this.mulberry32(seed);

    const shuffled: SurveyQuestion[] = [];
    for (const [, list] of byCategory) {
      // Fisher-Yates con el PRNG seedeado.
      const arr = list.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      shuffled.push(...arr);
    }

    survey.questions = shuffled;
    return survey;
  }

  /** Hash 32-bit estable para seedear el PRNG (FNV-1a). */
  private hashSeed(input: string): number {
    let hash = 2166136261; // FNV offset
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /** PRNG mulberry32 — pequeño, rápido, determinista. */
  private mulberry32(seed: number): () => number {
    let a = seed;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async update(
    tenantId: string | undefined,
    surveyId: string,
    dto: {
      title?: string;
      description?: string;
      isAnonymous?: boolean;
      targetAudience?: string;
      targetDepartments?: string[];
      /** T4 — preferido sobre targetDepartments. */
      targetDepartmentIds?: string[];
      startDate?: string;
      endDate?: string;
      settings?: Record<string, any>;
      questions?: Array<{
        id?: string;
        category: string;
        questionText: string;
        questionType: string;
        options?: string[];
        isRequired?: boolean;
        sortOrder?: number;
      }>;
    },
  ): Promise<EngagementSurvey> {
    const where = tenantId ? { id: surveyId, tenantId } : { id: surveyId };
    const survey = await this.surveyRepo.findOne({ where });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'draft') throw new BadRequestException('Solo se pueden editar encuestas en borrador.');

    if (dto.title !== undefined) survey.title = dto.title;
    if (dto.description !== undefined) survey.description = dto.description;
    if (dto.isAnonymous !== undefined) survey.isAnonymous = dto.isAnonymous;
    if (dto.targetAudience !== undefined) survey.targetAudience = dto.targetAudience;
    if (dto.targetDepartments !== undefined) {
      survey.targetDepartments = Array.isArray(dto.targetDepartments)
        ? dto.targetDepartments.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [];
    }
    if (dto.targetDepartmentIds !== undefined) {
      survey.targetDepartmentIds = this.sanitizeDeptIds(dto.targetDepartmentIds);
    }
    if (dto.startDate !== undefined) survey.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) survey.endDate = new Date(dto.endDate);
    // Sanitize tomando isAnonymous DESPUES de aplicar el dto: si el admin
    // cambia isAnonymous y settings en la misma request, la coherencia se
    // valida sobre el estado final. Si solo viene settings, usamos el
    // isAnonymous actual de la entidad.
    if (dto.settings !== undefined) {
      survey.settings = this.sanitizeSettings(dto.settings, survey.isAnonymous);
    } else if (dto.isAnonymous !== undefined && survey.settings) {
      // Si solo cambia isAnonymous (no settings), re-sanitizamos los
      // settings actuales para forzar allowPartialSave=false si quedo
      // incompatible con el nuevo isAnonymous.
      survey.settings = this.sanitizeSettings(survey.settings, survey.isAnonymous);
    }

    // Wrap the survey save and question replace in a single transaction so
    // a crash between DELETE and INSERT of the new questions cannot leave the
    // survey with zero questions (or a mix of old+new).
    await this.dataSource.transaction(async (manager) => {
      await manager.save(survey);

      if (dto.questions) {
        await manager.delete(SurveyQuestion, { surveyId });
        const questions = dto.questions!.map((q, i) =>
          manager.getRepository(SurveyQuestion).create({
            surveyId,
            category: q.category,
            questionText: q.questionText,
            questionType: q.questionType,
            options: q.options ?? null,
            isRequired: q.isRequired ?? true,
            sortOrder: q.sortOrder ?? i,
          }),
        );
        await manager.save(questions);
      }
    });

    // Usa survey.tenantId authoritative (soporta super_admin cross-tenant).
    return this.findById(survey.tenantId, surveyId);
  }

  /**
   * Eliminar una encuesta. Dos modos:
   * - role != super_admin → solo puede eliminar en status 'draft'
   * - role == super_admin (force=true) → puede eliminar en CUALQUIER estado,
   *   incluyendo 'closed'. Elimina en cascada: responses, assignments, questions,
   *   y el insight de AI si existe.
   *
   * La eliminacion es HARD DELETE (no soft-delete) porque las encuestas
   * contienen datos anonimizados que no deben persistir si el admin decide
   * borrarlas. Las respuestas se eliminan via CASCADE en la relacion FK.
   */
  async delete(tenantId: string | undefined, surveyId: string, callerRole?: string): Promise<void> {
    const where = tenantId ? { id: surveyId, tenantId } : { id: surveyId };
    const survey = await this.surveyRepo.findOne({ where });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    const effectiveTenantId = survey.tenantId;

    const isAdmin = callerRole === 'super_admin' || callerRole === 'tenant_admin';

    // Non-admin (manager/employee) solo puede eliminar borradores
    if (!isAdmin && survey.status !== 'draft') {
      throw new BadRequestException('Solo se pueden eliminar encuestas en borrador. Contacte al administrador para eliminar encuestas activas o cerradas.');
    }

    // Si la encuesta tiene respuestas, advertir (pero permitir si es super_admin)
    if (survey.status !== 'draft') {
      const responseCount = await this.responseRepo.count({ where: { surveyId, tenantId: effectiveTenantId } });
      if (responseCount > 0) {
        this.logger.warn(
          `Super admin deleting survey "${survey.title}" (${surveyId}) with ${responseCount} responses`,
        );
      }
    }

    // Eliminar insight de AI si existe (no tiene CASCADE a la encuesta)
    try {
      await this.aiInsightsService.clearCache(effectiveTenantId, 'survey_analysis' as any, surveyId);
    } catch { /* ignore — insight may not exist */ }

    await this.surveyRepo.remove(survey);

    // Cleanup notifications referencing this survey
    this.notificationsService.cleanupByMetadata(effectiveTenantId, 'surveyId', surveyId).catch((e) => this.logger.warn(`Survey notification cleanup failed: ${e.message}`));
  }

  // ─── Distribution ──────────────────────────────────────────────────────

  async launch(tenantId: string | undefined, surveyId: string): Promise<EngagementSurvey> {
    const survey = await this.findById(tenantId, surveyId);
    // Authoritative tenantId desde la entidad (soporta super_admin cross-tenant).
    const effectiveTenantId = survey.tenantId;
    if (survey.status !== 'draft') throw new BadRequestException('La encuesta ya fue lanzada.');
    if (!survey.questions || survey.questions.length === 0) throw new BadRequestException('La encuesta no tiene preguntas.');

    // Resolve target users
    const targetUsers = await this.getTargetUsers(effectiveTenantId, survey);
    if (targetUsers.length === 0) throw new BadRequestException('No hay usuarios objetivo para esta encuesta.');

    // Update status
    survey.status = 'active';
    await this.surveyRepo.save(survey);

    // Create assignments
    const assignments = targetUsers.map((u) =>
      this.assignmentRepo.create({
        surveyId,
        tenantId: effectiveTenantId,
        userId: u.id,
        status: 'pending',
      }),
    );
    await this.assignmentRepo.save(assignments);

    // Send notifications + emails
    const notifications = targetUsers.map((u) => ({
      tenantId: effectiveTenantId,
      userId: u.id,
      type: 'survey_invitation' as any,
      title: 'Nueva encuesta de clima',
      message: `Se te ha asignado la encuesta "${survey.title}". ${survey.isAnonymous ? 'Tus respuestas serán anónimas.' : ''}`,
      metadata: { surveyId },
    }));
    await this.notificationsService.createBulk(notifications);

    // Send emails (non-blocking)
    for (const u of targetUsers) {
      this.emailService.sendSurveyInvitation(u.email, {
        firstName: u.firstName,
        surveyTitle: survey.title,
        dueDate: survey.endDate.toISOString().split('T')[0],
        isAnonymous: survey.isAnonymous,
        tenantId: effectiveTenantId,
        userId: u.id,
      }).catch((e) => this.logger.error(`Error sending survey email to ${u.email}: ${e.message}`));

      // v3.0 Push notification a cada target user (fire-and-forget).
      const pushMsg = buildPushMessage('surveyActive', u.language ?? 'es', {
        title: survey.title,
      });
      this.pushService
        .sendToUser(
          u.id,
          {
            title: pushMsg.title,
            body: pushMsg.body,
            url: `/dashboard/encuestas-clima/${surveyId}/responder`,
            tag: `survey-${surveyId}`,
          },
          'surveys',
        )
        .catch(() => undefined);
    }

    this.logger.log(`Survey "${survey.title}" launched to ${targetUsers.length} users`);
    return this.findById(effectiveTenantId, surveyId);
  }

  private async getTargetUsers(tenantId: string, survey: EngagementSurvey): Promise<User[]> {
    const where: any = { tenantId, isActive: true };

    if (survey.targetAudience === 'by_department') {
      // T4 — preferir matching por departmentId (estable frente a renames).
      // Fallback a matching por nombre cuando aplica.
      const idCount = survey.targetDepartmentIds?.length ?? 0;
      const nameCount = survey.targetDepartments?.length ?? 0;

      if (idCount > 0 && nameCount > idCount) {
        // Catalogo mixto: el admin selecciono mas departamentos por nombre
        // de los que tienen IDs (tipico cuando el tenant tiene legacy
        // custom-settings sin id mezclados con la tabla nueva). Caer a
        // matching por nombre para no perder los legacy silenciosamente.
        where.department = In(survey.targetDepartments);
      } else if (idCount > 0) {
        where.departmentId = In(survey.targetDepartmentIds);
      } else if (nameCount > 0) {
        where.department = In(survey.targetDepartments);
      }
      // Si ambos estan vacios y target=='by_department', no se aplica filtro
      // de dept (devuelve todos los users del tenant). Es coherente con el
      // comportamiento previo a T4 — el launch ya valida que haya users.
    }
    // 'all' or 'custom' (custom uses all for now, can be extended)

    const users = await this.userRepo.find({
      where,
      select: ['id', 'email', 'firstName', 'lastName', 'department', 'role', 'language'],
    });
    // Exclude super_admin — they are platform administrators, not organization collaborators
    return users.filter((u) => u.role !== 'super_admin');
  }

  // ─── Responses ─────────────────────────────────────────────────────────

  async submitResponse(
    tenantId: string,
    surveyId: string,
    userId: string,
    answers: Array<{ questionId: string; value: number | string | string[] }>,
  ): Promise<SurveyResponse> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'active') throw new BadRequestException('La encuesta no está activa.');

    // Get user department snapshot
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: ['id', 'department'] });

    // Check if already responded (for non-anonymous surveys)
    let existing: SurveyResponse | null = null;
    if (!survey.isAnonymous) {
      existing = await this.responseRepo.findOne({
        where: { surveyId, tenantId, respondentId: userId },
      });
      if (existing && existing.isComplete) {
        throw new BadRequestException('Ya has respondido esta encuesta.');
      }
    }

    // For anonymous surveys, check via assignment to prevent double submissions
    const assignment = await this.assignmentRepo.findOne({ where: { surveyId, userId, tenantId } });
    if (survey.isAnonymous && assignment?.status === 'completed') {
      throw new BadRequestException('Ya has respondido esta encuesta.');
    }

    // Create or update response
    const isNewResponse = !existing;
    const response = existing || this.responseRepo.create({
      surveyId,
      tenantId,
      respondentId: survey.isAnonymous ? null : userId,
      department: user?.department ?? null,
    });

    // T3 — el contador de respuestas debe incrementarse cuando el response
    // pasa por primera vez a `isComplete=true`. Antes se incrementaba solo
    // cuando `isNewResponse`, lo cual era correcto pre-T3 porque no habia
    // saves parciales: ahora con allowPartialSave un response puede existir
    // (parcial) ANTES del submit, por eso miramos la transicion.
    const wasCompleteBefore = existing?.isComplete === true;

    response.answers = answers;
    response.isComplete = true;
    response.submittedAt = new Date();

    const saved = await this.responseRepo.save(response);

    // Update assignment
    if (assignment && assignment.status !== 'completed') {
      assignment.status = 'completed';
      assignment.completedAt = new Date();
      await this.assignmentRepo.save(assignment);
    }

    // Update response count: incrementar cuando es nuevo, o cuando un partial
    // existente se convierte en completo (transicion isComplete false→true).
    if (isNewResponse || !wasCompleteBefore) {
      await this.surveyRepo.increment({ id: surveyId, tenantId }, 'responseCount', 1);
    }

    // Cleanup survey notifications for this user (they already responded)
    this.notificationsService.cleanupByMetadata(tenantId, 'surveyId', surveyId, {
      userId,
      types: ['survey_invitation', 'survey_reminder'],
    }).catch(() => {});

    return saved;
  }

  // ─── Partial save (T3) ────────────────────────────────────────────────

  /**
   * T3 — Guarda respuestas parciales server-side.
   *
   * Restricciones (defensivas en privacidad):
   *   - encuesta debe estar `active`.
   *   - encuesta NO debe ser anonima (sino respondentId tendria que
   *     resolverse de alguna forma — out of scope T3, queda para T10
   *     via localStorage).
   *   - `settings.allowPartialSave` debe estar activo.
   *   - el respondente debe tener una asignacion para esta encuesta
   *     (cierra el bypass por POST directo).
   *   - el respondente no debe haber completado ya la encuesta.
   *
   * No incrementa responseCount; eso ocurre solo al submit final.
   * No completa la asignacion; sigue en `pending` hasta el submit.
   */
  async saveProgress(
    tenantId: string,
    surveyId: string,
    userId: string,
    answers: Array<{ questionId: string; value: number | string | string[] }>,
  ): Promise<SurveyResponse> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'active') throw new BadRequestException('La encuesta no esta activa.');
    if (survey.isAnonymous) {
      throw new BadRequestException(
        'No se puede guardar progreso server-side en encuestas anonimas. Tu progreso queda en el navegador.',
      );
    }
    if (!survey.settings?.allowPartialSave) {
      throw new BadRequestException('Esta encuesta no permite guardar progreso parcial.');
    }

    const assignment = await this.assignmentRepo.findOne({ where: { surveyId, userId, tenantId } });
    if (!assignment) {
      throw new ForbiddenException('No tienes una asignacion activa para esta encuesta.');
    }
    if (assignment.status === 'completed') {
      throw new BadRequestException('Ya has completado esta encuesta.');
    }

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: ['id', 'department'] });

    let response = await this.responseRepo.findOne({
      where: { surveyId, tenantId, respondentId: userId },
    });
    if (response?.isComplete) {
      throw new BadRequestException('Ya has completado esta encuesta.');
    }

    if (!response) {
      response = this.responseRepo.create({
        surveyId,
        tenantId,
        respondentId: userId,
        department: user?.department ?? null,
      });
    }
    response.answers = answers;
    response.isComplete = false;
    response.submittedAt = null;
    return this.responseRepo.save(response);
  }

  /**
   * T3 — Devuelve la respuesta parcial del usuario para una encuesta si
   * existe (y aun no esta completa). Solo aplica a encuestas no anonimas
   * con allowPartialSave activo. Si no se cumple alguna condicion, retorna
   * null sin lanzar — el frontend simplemente arranca con state vacio.
   */
  async getMyProgress(
    tenantId: string,
    surveyId: string,
    userId: string,
  ): Promise<{ answers: SurveyResponse['answers']; updatedAt: Date } | null> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) return null;
    if (survey.isAnonymous || !survey.settings?.allowPartialSave) return null;

    const response = await this.responseRepo.findOne({
      where: { surveyId, tenantId, respondentId: userId, isComplete: false },
    });
    if (!response) return null;
    return { answers: response.answers, updatedAt: response.updatedAt };
  }

  async getMyPendingSurveys(tenantId: string, userId: string): Promise<any[]> {
    const assignments = await this.assignmentRepo.find({
      where: { tenantId, userId, status: 'pending' },
      relations: ['survey'],
    });

    return assignments
      .filter((a) => a.survey && a.survey.status === 'active')
      .map((a) => ({
        id: a.survey.id,
        title: a.survey.title,
        description: a.survey.description,
        isAnonymous: a.survey.isAnonymous,
        endDate: a.survey.endDate,
        questionCount: 0, // Will be filled in frontend if needed
        assignmentId: a.id,
      }));
  }

  // ─── Results ───────────────────────────────────────────────────────────

  /**
   * Encuestas activas que terminarán pronto Y tienen baja participación.
   * Se usa en el CommandCenter del dashboard del admin como alerta.
   *
   * Reglas:
   *   - status === 'active'
   *   - endDate ≤ ahora + `daysWindow` (default 5 días por cerrar)
   *   - participación < `threshold` (default 50%)
   *
   * Retorna metadata mínima por encuesta: id, title, daysLeft, %participación.
   */
  async getLowParticipationActiveSurveys(
    tenantId: string,
    threshold: number = 50,
    daysWindow: number = 5,
  ): Promise<Array<{ id: string; title: string; endDate: Date | null; daysLeft: number | null; participationPct: number; respondents: number; assigned: number }>> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + daysWindow * 86_400_000);
    // Sólo encuestas activas; si tienen endDate, filtramos por ventana.
    const activeSurveys = await this.surveyRepo.find({
      where: { tenantId, status: 'active' },
    });
    if (activeSurveys.length === 0) return [];

    const out = [] as Array<{ id: string; title: string; endDate: Date | null; daysLeft: number | null; participationPct: number; respondents: number; assigned: number }>;
    for (const survey of activeSurveys) {
      const end = survey.endDate ? new Date(survey.endDate) : null;
      // Si tiene endDate y queda fuera de la ventana de alerta, skip
      if (end && end > windowEnd) continue;
      // Si ya venció (endDate < ahora), también lo incluimos — el admin
      // necesita saber que está sin cerrar manualmente.
      const assigned = await this.assignmentRepo.count({ where: { surveyId: survey.id, tenantId } });
      if (assigned === 0) continue; // no asignada → no aplica alerta de baja participación
      const respondents = await this.responseRepo.count({ where: { surveyId: survey.id, tenantId, isComplete: true } });
      const participationPct = Math.round((respondents / assigned) * 100);
      if (participationPct >= threshold) continue;

      const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86_400_000) : null;
      out.push({
        id: survey.id,
        title: survey.title,
        endDate: end,
        daysLeft,
        participationPct,
        respondents,
        assigned,
      });
    }
    // Ordenar por más urgentes primero (menos días restantes / más vencidas)
    out.sort((a, b) => {
      if (a.daysLeft == null && b.daysLeft == null) return a.participationPct - b.participationPct;
      if (a.daysLeft == null) return 1;
      if (b.daysLeft == null) return -1;
      return a.daysLeft - b.daysLeft;
    });
    return out;
  }

  /**
   * P7.2 — Manager scope:
   *   - Si el survey ES anónimo y el caller es manager → 403 (filtrar por
   *     equipo rompería el anonimato con equipos pequeños; solo admin puede
   *     ver resultados de encuestas anónimas).
   *   - Si el survey NO es anónimo y caller es manager → filtra responses
   *     a las de respondentId ∈ {reportes directos, self}.
   *   - Admin (managerId=undefined) → sin filtro, igual que antes.
   */
  async getResults(tenantId: string, surveyId: string, managerId?: string): Promise<any> {
    const survey = await this.findById(tenantId, surveyId);

    // Guard anonimato para manager.
    if (managerId && survey.isAnonymous) {
      throw new ForbiddenException(
        'Las encuestas anónimas solo pueden ser revisadas por administradores. Los managers no tienen acceso para preservar el anonimato de los respondientes.',
      );
    }

    // Filtro manager (solo si survey NO es anónimo).
    let teamIds: Set<string> | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = new Set(reports.map((u) => u.id));
      teamIds.add(managerId);
    }

    const responseWhere: any = { surveyId, tenantId, isComplete: true };
    if (teamIds) responseWhere.respondentId = In([...teamIds]);
    const responses = await this.responseRepo.find({ where: responseWhere });

    const assignWhere: any = { surveyId, tenantId };
    if (teamIds) assignWhere.userId = In([...teamIds]);
    const totalAssignments = await this.assignmentRepo.count({ where: assignWhere });

    if (responses.length === 0) {
      return {
        survey: { id: survey.id, title: survey.title, status: survey.status },
        responseRate: 0,
        totalResponses: 0,
        totalAssigned: totalAssignments,
        averageByCategory: [],
        averageByQuestion: [],
        likertDistribution: [],
        openResponses: [],
      };
    }

    // Calculate averages by category
    // Note: climate surveys use likert_5 internally (scores 1-5) but we
    // present results on a 1-10 scale (×2) so they can be compared directly
    // against the 1-10 performance evaluation scale. NPS questions are
    // already 0-10 and remain unchanged.
    const categoryScores: Record<string, number[]> = {};
    const questionScores: Record<string, number[]> = {};
    const openResponses: Array<{ questionId: string; questionText: string; category: string; text: string }> = [];

    for (const r of responses) {
      for (const ans of r.answers) {
        const question = survey.questions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        if (question.questionType === 'likert_5' || question.questionType === 'nps') {
          const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(raw)) {
            // Normalize likert_5 (1-5) → 2-10 to align with NPS/perf scale.
            const numVal = question.questionType === 'likert_5' ? raw * 2 : raw;
            if (!categoryScores[question.category]) categoryScores[question.category] = [];
            categoryScores[question.category].push(numVal);

            if (!questionScores[question.id]) questionScores[question.id] = [];
            questionScores[question.id].push(numVal);
          }
        } else if (question.questionType === 'open_text' && ans.value) {
          openResponses.push({
            questionId: question.id,
            questionText: question.questionText,
            category: question.category,
            text: String(ans.value),
          });
        }
      }
    }

    // Average by category (already in 1-10 scale)
    const averageByCategory = Object.entries(categoryScores).map(([category, scores]) => ({
      category,
      average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      count: scores.length,
    })).sort((a, b) => b.average - a.average);

    // Average by question (1-10 scale)
    const averageByQuestion = survey.questions
      .filter((q) => q.questionType === 'likert_5')
      .map((q) => {
        const scores = questionScores[q.id] || [];
        return {
          questionId: q.id,
          questionText: q.questionText,
          category: q.category,
          average: scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
          count: scores.length,
        };
      })
      .sort((a, b) => b.average - a.average);

    // Likert distribution per question — buckets 2,4,6,8,10 (×2 of 1-5 raw)
    const likertDistribution = survey.questions
      .filter((q) => q.questionType === 'likert_5')
      .map((q) => {
        const scores = questionScores[q.id] || []; // already ×2
        const dist: Record<number, number> = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
        for (const s of scores) {
          const bucket = Math.round(s) as number;
          if (dist[bucket] !== undefined) dist[bucket] += 1;
        }
        const total = scores.length || 1;
        return {
          questionId: q.id,
          questionText: q.questionText,
          category: q.category,
          distribution: Object.entries(dist).map(([level, count]) => ({
            level: Number(level),
            count,
            percentage: Number(((count / total) * 100).toFixed(1)),
          })),
        };
      });

    // Overall average (1-10 scale)
    const allScores = Object.values(categoryScores).flat().filter((v) => v >= 0 && v <= 10);
    const overallAverage = allScores.length > 0
      ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
      : 0;

    return {
      survey: { id: survey.id, title: survey.title, status: survey.status, isAnonymous: survey.isAnonymous },
      responseRate: totalAssignments > 0 ? Number(((responses.length / totalAssignments) * 100).toFixed(1)) : 0,
      totalResponses: responses.length,
      totalAssigned: totalAssignments,
      overallAverage,
      averageByCategory,
      averageByQuestion,
      likertDistribution,
      openResponses,
    };
  }

  /** P7.2 — ver getResults para el detalle del manager scope. */
  async getENPS(tenantId: string, surveyId: string, managerId?: string): Promise<any> {
    const survey = await this.findById(tenantId, surveyId);

    if (managerId && survey.isAnonymous) {
      throw new ForbiddenException(
        'Las encuestas anónimas solo pueden ser revisadas por administradores.',
      );
    }

    let teamIds: Set<string> | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = new Set(reports.map((u) => u.id));
      teamIds.add(managerId);
    }

    const responseWhere: any = { surveyId, tenantId, isComplete: true };
    if (teamIds) responseWhere.respondentId = In([...teamIds]);
    const responses = await this.responseRepo.find({ where: responseWhere });

    const npsQuestions = survey.questions.filter((q) => q.questionType === 'nps');
    const likertQuestions = survey.questions.filter((q) => q.questionType === 'likert_5');

    // Strategy: prefer native NPS questions if available; otherwise derive
    // eNPS from likert_5 responses by applying the standard 0-10 classification
    // on each respondent's likert average ×2 (so max 5 → 10 = promoter).
    // See AIHR/CultureMonkey/Matter references — this is equivalent to the
    // 5-point eNPS mapping Promoter=5, Passive=4, Detractor=1-3.
    const useNps = npsQuestions.length > 0;
    const sourceQuestions = useNps ? npsQuestions : likertQuestions;

    if (sourceQuestions.length === 0) {
      return { enps: null, message: 'La encuesta no tiene preguntas Likert ni NPS con las que calcular eNPS.' };
    }

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of responses) {
      const scores: number[] = [];
      for (const ans of r.answers) {
        const question = sourceQuestions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (isNaN(raw)) continue;
        // Likert 1-5 → 2-10 for classification; NPS already 0-10.
        scores.push(question.questionType === 'likert_5' ? raw * 2 : raw);
      }

      if (scores.length === 0) continue;

      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avgScore >= 9) promoters++;
      else if (avgScore >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    if (total === 0) {
      return { enps: null, message: 'Sin respuestas suficientes para calcular eNPS.', source: useNps ? 'nps_question' : 'likert_derived' };
    }
    const enps = Math.round(((promoters - detractors) / total) * 100);

    return {
      enps,
      promoters,
      passives,
      detractors,
      total,
      promoterPercent: Number(((promoters / total) * 100).toFixed(1)),
      passivePercent: Number(((passives / total) * 100).toFixed(1)),
      detractorPercent: Number(((detractors / total) * 100).toFixed(1)),
      source: useNps ? 'nps_question' : 'likert_derived',
    };
  }

  async getResultsByDepartment(tenantId: string, surveyId: string): Promise<any[]> {
    const survey = await this.findById(tenantId, surveyId);
    const responses = await this.responseRepo.find({ where: { surveyId, tenantId, isComplete: true } });

    const deptScores: Record<string, { scores: number[]; count: number }> = {};

    for (const r of responses) {
      const dept = r.department || 'Sin departamento';
      if (!deptScores[dept]) deptScores[dept] = { scores: [], count: 0 };
      deptScores[dept].count++;

      for (const ans of r.answers) {
        const question = survey.questions.find((q) => q.id === ans.questionId);
        if (!question || question.questionType !== 'likert_5') continue;

        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (!isNaN(raw)) {
          // Normalize likert_5 (1-5) → 2-10 so the department averages match
          // the 1-10 scale used everywhere else (getSurveyResults, eNPS, etc).
          deptScores[dept].scores.push(raw * 2);
        }
      }
    }

    return Object.entries(deptScores).map(([department, data]) => ({
      department,
      responseCount: data.count,
      average: data.scores.length > 0 ? Number((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2)) : 0,
    })).sort((a, b) => b.average - a.average);
  }

  /**
   * T5 — Heatmap dept × categoria.
   *
   * Devuelve la matriz de promedios por (departamento, categoria) en
   * escala 1-10 (mismo ×2 que el resto). Permite drill-down visual:
   * un dept con buen promedio general puede tener una categoria
   * especifica baja (e.g., "Cultura" en IT alto pero "Bienestar" en
   * IT critico).
   *
   * Manager scope: mismo patron que getResults/getENPS/getTrends.
   *   - encuesta anonima + manager → 403 (no se puede filtrar por
   *     respondentId sin romper anonimato).
   *   - manager + encuesta no anonima → filtra responses al equipo.
   *   - admin → todas las respuestas.
   *
   * Forma de la respuesta:
   *   {
   *     departments: string[],        // ordenadas por overall asc (peor primero)
   *     categories: string[],         // unicas en la encuesta
   *     cells: Array<{                // matriz plana
   *       department: string,
   *       category: string,
   *       average: number | null,    // null si no hay respuestas
   *       count: number,
   *     }>,
   *     overallByDepartment: Record<string, number>, // promedio general por dept
   *   }
   *
   * El frontend pinta la matriz como CSS Grid con color por threshold
   * (≥8 verde, 6-8 ambar, <6 rojo, null gris).
   */
  async getResultsHeatmap(tenantId: string, surveyId: string, managerId?: string): Promise<any> {
    const survey = await this.findById(tenantId, surveyId);

    if (managerId && survey.isAnonymous) {
      throw new ForbiddenException(
        'Las encuestas anonimas solo pueden ser revisadas por administradores. Los managers no tienen acceso para preservar el anonimato.',
      );
    }

    let teamIds: Set<string> | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = new Set(reports.map((u) => u.id));
      teamIds.add(managerId);
    }

    const responseWhere: any = { surveyId, tenantId, isComplete: true };
    if (teamIds) responseWhere.respondentId = In([...teamIds]);
    const responses = await this.responseRepo.find({ where: responseWhere });

    // Indexar preguntas y categorias unicas (solo likert_5).
    const likertById = new Map<string, { id: string; category: string }>();
    const categories = new Set<string>();
    for (const q of survey.questions) {
      if (q.questionType !== 'likert_5') continue;
      likertById.set(q.id, { id: q.id, category: q.category });
      categories.add(q.category);
    }

    // Acumuladores: cellScores[dept][category] = number[]; deptOverall[dept] = number[]
    const cellScores: Record<string, Record<string, number[]>> = {};
    const deptOverall: Record<string, number[]> = {};

    for (const r of responses) {
      const dept = r.department || 'Sin departamento';
      if (!cellScores[dept]) cellScores[dept] = {};
      if (!deptOverall[dept]) deptOverall[dept] = [];

      for (const ans of r.answers) {
        const q = likertById.get(ans.questionId);
        if (!q) continue;
        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (isNaN(raw)) continue;
        const norm = raw * 2; // 1-5 → 2-10

        if (!cellScores[dept][q.category]) cellScores[dept][q.category] = [];
        cellScores[dept][q.category].push(norm);
        deptOverall[dept].push(norm);
      }
    }

    // Generar matriz plana en orden estable: dept × category, aunque
    // alguna celda no tenga datos (null para que el frontend pinte gris).
    const departments = Object.keys(cellScores);
    const categoryList = [...categories].sort();
    const cells: Array<{ department: string; category: string; average: number | null; count: number }> = [];
    for (const dept of departments) {
      for (const cat of categoryList) {
        const arr = cellScores[dept][cat] || [];
        cells.push({
          department: dept,
          category: cat,
          average: arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null,
          count: arr.length,
        });
      }
    }

    const overallByDepartment: Record<string, number> = {};
    for (const dept of departments) {
      const arr = deptOverall[dept];
      overallByDepartment[dept] = arr.length > 0
        ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
        : 0;
    }

    // Ordenar dept por overall ASC (peor primero — mas accionable visualmente).
    departments.sort((a, b) => (overallByDepartment[a] || 0) - (overallByDepartment[b] || 0));

    return {
      departments,
      categories: categoryList,
      cells,
      overallByDepartment,
    };
  }

  /**
   * Tendencias historicas de encuestas cerradas.
   *
   * T2 — Manager scope:
   *   - admin (managerId=undefined) → todas las encuestas cerradas, todas las
   *     respuestas (comportamiento original).
   *   - manager → resuelve su equipo (reportes directos + self) y, por cada
   *     encuesta:
   *       * encuestas anonimas se OMITEN del trend (filtrar respuestas por
   *         respondentId rompe el anonimato cuando el equipo es chico, mismo
   *         criterio que getResults/getENPS — ver P7.2).
   *       * encuestas no anonimas se filtran a respuestas del equipo y a
   *         asignaciones del equipo, igual que getResults.
   *       * encuestas sin asignaciones del equipo se omiten (no aplica el
   *         trend para el manager).
   *
   * Cada encuesta sigue retornando los mismos campos (surveyId, title,
   * endDate, responseRate, overallAverage, categories) — la respuesta
   * solo varia en cantidad de filas, manteniendo el contrato del frontend.
   */
  async getTrends(tenantId: string, managerId?: string): Promise<any[]> {
    const surveys = await this.surveyRepo.find({
      where: { tenantId, status: 'closed' },
      order: { endDate: 'ASC' },
    });

    // Resolver equipo del manager una sola vez (no por encuesta).
    let teamIds: Set<string> | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = new Set(reports.map((u) => u.id));
      teamIds.add(managerId);
    }

    const trends: any[] = [];

    for (const survey of surveys) {
      // Manager scope: omitir encuestas anonimas para preservar anonimato.
      if (teamIds && survey.isAnonymous) continue;

      const questions = await this.questionRepo.find({ where: { surveyId: survey.id } });

      const responseWhere: any = { surveyId: survey.id, tenantId, isComplete: true };
      if (teamIds) responseWhere.respondentId = In([...teamIds]);
      const responses = await this.responseRepo.find({ where: responseWhere });

      const assignWhere: any = { surveyId: survey.id, tenantId };
      if (teamIds) assignWhere.userId = In([...teamIds]);
      const totalAssigned = await this.assignmentRepo.count({ where: assignWhere });

      // Manager: si el equipo no fue asignado a esta encuesta, no aporta al
      // trend (evita filas con responseRate=0 / overallAverage=0 ruidosas).
      if (teamIds && totalAssigned === 0) continue;

      const categoryScores: Record<string, number[]> = {};
      for (const r of responses) {
        for (const ans of r.answers) {
          const q = questions.find((q) => q.id === ans.questionId);
          if (!q || q.questionType !== 'likert_5') continue;
          const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(raw)) {
            if (!categoryScores[q.category]) categoryScores[q.category] = [];
            // Normalize to 1-10 scale so trends are consistent with
            // getSurveyResults / getResultsByDepartment / eNPS.
            categoryScores[q.category].push(raw * 2);
          }
        }
      }

      const categories = Object.entries(categoryScores).map(([category, scores]) => ({
        category,
        average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      }));

      const allScores = Object.values(categoryScores).flat();

      trends.push({
        surveyId: survey.id,
        title: survey.title,
        endDate: survey.endDate,
        responseRate: totalAssigned > 0 ? Number(((responses.length / totalAssigned) * 100).toFixed(1)) : 0,
        overallAverage: allScores.length > 0 ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2)) : 0,
        categories,
      });
    }

    return trends;
  }

  // ─── Close ─────────────────────────────────────────────────────────────

  async closeSurvey(tenantId: string | undefined, surveyId: string): Promise<EngagementSurvey> {
    const where = tenantId ? { id: surveyId, tenantId } : { id: surveyId };
    const survey = await this.surveyRepo.findOne({ where });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    const effectiveTenantId = survey.tenantId;
    if (survey.status !== 'active') throw new BadRequestException('Solo se pueden cerrar encuestas activas.');

    // Validar que tenga al menos 1 respuesta completa antes de cerrar.
    // Cerrar sin respuestas genera reportes vacios y un eNPS sin datos,
    // lo cual confunde al admin cuando ve "0" o "—" en el dashboard.
    const responseCount = await this.responseRepo.count({
      where: { surveyId, tenantId: effectiveTenantId, isComplete: true },
    });
    if (responseCount === 0) {
      throw new BadRequestException(
        'No se puede cerrar la encuesta porque no tiene respuestas completadas. Espere a que al menos un colaborador responda antes de cerrar.',
      );
    }

    survey.status = 'closed';
    await this.surveyRepo.save(survey);

    // Cleanup pending survey notifications (invitation + reminders)
    this.notificationsService.cleanupByMetadata(effectiveTenantId, 'surveyId', surveyId, {
      types: ['survey_invitation', 'survey_reminder'],
    }).catch(() => {});

    this.logger.log(`Survey "${survey.title}" closed with ${responseCount} responses`);
    return this.findById(effectiveTenantId, surveyId);
  }

  // ─── AI Analysis ───────────────────────────────────────────────────────

  async generateAiAnalysis(
    tenantId: string | undefined,
    surveyId: string,
    generatedBy: string,
    force = false,
  ): Promise<any> {
    // Resolver el tenantId authoritative desde la encuesta.
    const survey = await this.findById(tenantId, surveyId);
    const effectiveTenantId = survey.tenantId;

    // Check AI feature usando el tenantId real de la encuesta.
    await this.checkFeature(effectiveTenantId, PlanFeature.AI_INSIGHTS);

    const results = await this.getResults(effectiveTenantId, surveyId);
    const enps = await this.getENPS(effectiveTenantId, surveyId);
    const deptResults = await this.getResultsByDepartment(effectiveTenantId, surveyId);

    if (results.totalResponses === 0) {
      throw new BadRequestException('No hay respuestas para analizar.');
    }

    return this.aiInsightsService.analyzeSurvey(
      effectiveTenantId,
      surveyId,
      generatedBy,
      {
        surveyTitle: results.survey.title,
        responseRate: results.responseRate,
        totalResponses: results.totalResponses,
        overallAverage: results.overallAverage,
        averageByCategory: results.averageByCategory,
        averageByQuestion: results.averageByQuestion,
        enps,
        departmentResults: deptResults,
        openResponses: results.openResponses.slice(0, 50), // Limit to avoid token overflow
      },
      { force },
    );
  }

  async getAiAnalysis(tenantId: string, surveyId: string): Promise<any> {
    return this.aiInsightsService.getInsight(tenantId, 'survey_analysis' as any, surveyId);
  }

  // ─── Org Development Integration ──────────────────────────────────────

  async createInitiativesFromSurvey(
    tenantId: string | undefined,
    surveyId: string,
    targetPlanId?: string,
  ): Promise<any> {
    // Resolver el tenantId authoritative desde la encuesta.
    const survey = await this.findById(tenantId, surveyId);
    const effectiveTenantId = survey.tenantId;

    const analysis = await this.aiInsightsService.getInsight(effectiveTenantId, 'survey_analysis' as any, surveyId);
    if (!analysis) throw new NotFoundException('Primero debe generar el análisis AI de la encuesta.');

    const suggestedInitiatives = analysis.content?.suggestedInitiatives;
    if (!suggestedInitiatives || suggestedInitiatives.length === 0) {
      throw new BadRequestException('El análisis AI no generó iniciativas sugeridas.');
    }

    // Find or determine the target org plan
    let planId = targetPlanId;
    if (!planId) {
      // Try to find active plan for current year
      const plans = await this.orgDevService.findAllPlans(effectiveTenantId);
      const currentYear = new Date().getFullYear();
      const activePlan = plans.find((p) => p.year === currentYear && p.status === 'activo');
      if (activePlan) {
        planId = activePlan.id;
      } else {
        throw new BadRequestException('No hay un plan de desarrollo organizacional activo. Seleccione un plan destino.');
      }
    }

    const createdInitiatives: any[] = [];

    for (const suggestion of suggestedInitiatives) {
      const initiative = await this.orgDevService.createInitiative(effectiveTenantId, planId, {
        title: `[Clima] ${suggestion.title}`,
        description: suggestion.description || undefined,
        department: suggestion.department || null,
        status: 'pendiente',
      });

      // Create actions from action items
      if (suggestion.actionItems && Array.isArray(suggestion.actionItems)) {
        for (const actionTitle of suggestion.actionItems) {
          await this.orgDevService.addAction(effectiveTenantId, initiative.id, {
            title: actionTitle,
            actionType: 'otro',
          });
        }
      }

      createdInitiatives.push(initiative);
    }

    this.logger.log(`Created ${createdInitiatives.length} org initiatives from survey ${surveyId}`);
    return { created: createdInitiatives.length, initiatives: createdInitiatives };
  }

  // ─── Cron: Survey Reminders ────────────────────────────────────────────

  @Cron('0 10 * * *') // Daily at 10am
  async remindIncompleteSurveys() {
    // F4 A3 — runForEachTenant: encuestas son tenant-scoped.
    await this.tenantCronRunner.runForEachTenant(
      'surveys.remindIncompleteSurveys',
      async (tenantId) => {
        this.logger.log(`[Cron] Checking incomplete survey responses for tenant ${tenantId.slice(0, 8)}...`);
        try {
          const activeSurveys = await this.surveyRepo.find({
            where: { tenantId, status: 'active' },
          });

          for (const survey of activeSurveys) {
            // Skip if past end date
            if (new Date() > survey.endDate) continue;

            const pendingAssignments = await this.assignmentRepo.find({
              where: { tenantId, surveyId: survey.id, status: 'pending' },
              relations: ['user'],
            });

            const toNotify = pendingAssignments.filter((a) => a.reminderCount < 3 && a.user);

            if (toNotify.length === 0) continue;

            const notifications = toNotify.map((a) => ({
              tenantId: a.tenantId,
              userId: a.userId,
              type: 'survey_reminder' as any,
              title: 'Recordatorio: encuesta pendiente',
              message: `Tienes pendiente la encuesta "${survey.title}". ${survey.isAnonymous ? 'Tus respuestas son anónimas.' : ''} Fecha límite: ${survey.endDate.toISOString().split('T')[0]}.`,
              metadata: { surveyId: survey.id },
            }));

            await this.notificationsService.createBulk(notifications);

            // Update reminder count
            for (const a of toNotify) {
              a.reminderCount = (a.reminderCount || 0) + 1;
            }
            await this.assignmentRepo.save(toNotify);

            this.logger.log(`[Cron] Sent ${toNotify.length} survey reminders for "${survey.title}"`);
          }
        } catch (error) {
          this.logger.error(`[Cron] Error in remindIncompleteSurveys (tenant=${tenantId.slice(0, 8)}): ${error}`);
          throw error;
        }
      },
    );
  }

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  async exportSurveyCsv(tenantId: string, surveyId: string): Promise<string> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const rows: string[] = [];
    rows.push(`Encuesta,${this.escapeCsv(results.survey.title)}`);
    rows.push(`Escala de puntuación,1 a 10 (normalizada desde likert 1-5 ×2)`);
    rows.push(`Tasa de respuesta,${results.responseRate}%`);
    rows.push(`Respuestas,${results.totalResponses} de ${results.totalAssigned}`);
    rows.push(`Promedio general,${results.overallAverage} / 10`);
    if (enps.enps !== null) rows.push(`eNPS,${enps.enps}`);
    rows.push('');

    // By category
    rows.push('Categoría,Promedio (1-10),Respuestas');
    for (const c of results.averageByCategory) {
      rows.push(`${this.escapeCsv(c.category)},${c.average},${c.count}`);
    }
    rows.push('');

    // By question
    rows.push('Pregunta,Categoría,Promedio (1-10),Respuestas');
    for (const q of results.averageByQuestion) {
      rows.push(`${this.escapeCsv(q.questionText)},${this.escapeCsv(q.category)},${q.average},${q.count}`);
    }
    rows.push('');

    // By department
    if (depts.length > 0) {
      rows.push('Departamento,Promedio (1-10),Respuestas');
      for (const d of depts) {
        rows.push(`${this.escapeCsv(d.department)},${d.average},${d.responseCount}`);
      }
      rows.push('');
    }

    // eNPS detail
    if (enps.enps !== null) {
      rows.push('eNPS Detalle');
      rows.push(`Promotores,${enps.promoters},${enps.promoterPercent}%`);
      rows.push(`Pasivos,${enps.passives},${enps.passivePercent}%`);
      rows.push(`Detractores,${enps.detractors},${enps.detractorPercent}%`);
      rows.push(`Score eNPS,${enps.enps}`);
    }

    return '\uFEFF' + rows.join('\n');
  }

  async exportSurveyXlsx(tenantId: string, surveyId: string): Promise<Buffer> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 20 }];
    ws1.addRow(['Encuesta de Clima']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Encuesta', results.survey.title]);
    ws1.addRow(['Escala de puntuación', '1 a 10 (normalizada desde likert 1-5 ×2)']);
    ws1.addRow(['Tasa de respuesta', `${results.responseRate}%`]);
    ws1.addRow(['Respuestas', `${results.totalResponses} de ${results.totalAssigned}`]);
    ws1.addRow(['Promedio general', `${results.overallAverage} / 10`]);
    if (enps.enps !== null) {
      ws1.addRow([]);
      ws1.addRow(['eNPS', enps.enps]);
      ws1.addRow(['Promotores', `${enps.promoters} (${enps.promoterPercent}%)`]);
      ws1.addRow(['Pasivos', `${enps.passives} (${enps.passivePercent}%)`]);
      ws1.addRow(['Detractores', `${enps.detractors} (${enps.detractorPercent}%)`]);
    }

    // Sheet 2: Por Categoría
    const ws2 = wb.addWorksheet('Por Categoría');
    ws2.columns = [{ width: 25 }, { width: 18 }, { width: 15 }];
    const h2 = ws2.addRow(['Categoría', 'Promedio (1-10)', 'Respuestas']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const c of results.averageByCategory) {
      ws2.addRow([c.category, c.average, c.count]);
    }

    // Sheet 3: Por Pregunta
    const ws3 = wb.addWorksheet('Por Pregunta');
    ws3.columns = [{ width: 50 }, { width: 20 }, { width: 18 }, { width: 12 }];
    const h3 = ws3.addRow(['Pregunta', 'Categoría', 'Promedio (1-10)', 'Respuestas']);
    h3.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const q of results.averageByQuestion) {
      ws3.addRow([q.questionText, q.category, q.average, q.count]);
    }

    // Sheet 4: Por Departamento
    if (depts.length > 0) {
      const ws4 = wb.addWorksheet('Por Departamento');
      ws4.columns = [{ width: 25 }, { width: 18 }, { width: 15 }];
      const h4 = ws4.addRow(['Departamento', 'Promedio (1-10)', 'Respuestas']);
      h4.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
      for (const d of depts) {
        ws4.addRow([d.department, d.average, d.responseCount]);
      }
    }

    // Sheet 5: Respuestas Abiertas
    if (results.openResponses.length > 0) {
      const ws5 = wb.addWorksheet('Respuestas Abiertas');
      ws5.columns = [{ width: 40 }, { width: 20 }, { width: 60 }];
      const h5 = ws5.addRow(['Pregunta', 'Categoría', 'Respuesta']);
      h5.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
      for (const r of results.openResponses) {
        ws5.addRow([r.questionText, r.category, r.text]);
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportSurveyPdf(tenantId: string, surveyId: string): Promise<Buffer> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 35, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Encuesta de Clima', margin, 18);
    doc.setFontSize(10);
    doc.setTextColor(201, 147, 58);
    doc.text(results.survey.title, margin, 28);

    let y = 45;

    // KPIs
    const kpis = [
      { label: 'Tasa Respuesta', value: `${results.responseRate}%` },
      { label: 'Promedio General', value: `${results.overallAverage}/10` },
      { label: 'Respuestas', value: `${results.totalResponses}/${results.totalAssigned}` },
    ];
    if (enps.enps !== null) kpis.push({ label: 'eNPS', value: `${enps.enps}` });

    const kpiW = (pageW - 2 * margin - (kpis.length - 1) * 4) / kpis.length;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 22, 3, 3, 'F');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 8, { align: 'center' });
      doc.setFontSize(14);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 18, { align: 'center' });
    });
    y += 30;

    // Categories table
    if (results.averageByCategory.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(26, 18, 6);
      doc.text('Resultados por Categoría', margin, y);
      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Categoría', 'Promedio', 'Respuestas']],
        body: results.averageByCategory.map((c: any) => [c.category, c.average.toFixed(2), c.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // Department table
    if (depts.length > 0 && y < 240) {
      doc.setFontSize(11);
      doc.setTextColor(26, 18, 6);
      doc.text('Resultados por Departamento', margin, y);
      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Departamento', 'Promedio', 'Respuestas']],
        body: depts.map((d: any) => [d.department, d.average.toFixed(2), d.responseCount]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
