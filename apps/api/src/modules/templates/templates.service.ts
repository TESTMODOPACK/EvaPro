import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { FormTemplate } from './entities/form-template.entity';
import { FormSubTemplate } from './entities/form-sub-template.entity';
import { Competency } from '../development/entities/competency.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { RelationType } from '../evaluations/entities/evaluation-assignment.entity';
import { AiCallLog } from '../ai-insights/entities/ai-call-log.entity';
import { AiInsight, InsightType } from '../ai-insights/entities/ai-insight.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  CreateSubTemplateDto,
  UpdateSubTemplateDto,
  UpdateWeightsDto,
  SaveAllSubTemplatesDto,
} from './dto/sub-template.dto';
import {
  DEFAULT_WEIGHTS_BY_CYCLE_TYPE,
  SUB_TEMPLATE_DISPLAY_ORDER,
  WEIGHT_SUM_TOLERANCE,
  getRelationsForCycleType,
} from './constants/sub-template-defaults';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private anthropicClient: Anthropic | null = null;

  constructor(
    @InjectRepository(FormTemplate)
    private readonly templateRepo: Repository<FormTemplate>,
    @InjectRepository(FormSubTemplate)
    private readonly subTemplateRepo: Repository<FormSubTemplate>,
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(AiCallLog)
    private readonly aiCallLogRepo: Repository<AiCallLog>,
    @InjectRepository(AiInsight)
    private readonly aiInsightRepo: Repository<AiInsight>,
    @Inject(forwardRef(() => AiInsightsService))
    private readonly aiInsightsService: AiInsightsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Lazy-init del cliente Anthropic para suggestCompetencyDistribution.
   * Sin ANTHROPIC_API_KEY → throw ServiceUnavailableException.
   */
  private ensureAnthropicClient(): Anthropic {
    if (this.anthropicClient) return this.anthropicClient;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'IA no configurada — falta ANTHROPIC_API_KEY en el entorno.',
      );
    }
    this.anthropicClient = new Anthropic({ apiKey });
    return this.anthropicClient;
  }

  /**
   * Fase 3 helper: agrega counts agregados de las subplantillas a una
   * lista de plantillas. Hace UNA sola query batch a form_sub_templates
   * para evitar N+1 — devuelve el mapa parentId → counts.
   *
   * Si una plantilla NO tiene subplantillas (caso legacy puro), los
   * counts se calculan desde template.sections (formato pre-Fase 3).
   *
   * Output (mutable): cada FormTemplate recibe `subTemplatesSummary`:
   *   { count, totalSections, totalQuestions }
   */
  private async enrichWithSubTemplateSummary(templates: FormTemplate[]): Promise<FormTemplate[]> {
    if (templates.length === 0) return templates;

    const ids = templates.map((t) => t.id);
    const allSubs = await this.subTemplateRepo
      .createQueryBuilder('s')
      .where('s.parentTemplateId IN (:...ids)', { ids })
      .getMany();

    const summaryByParent = new Map<string, { count: number; totalSections: number; totalQuestions: number }>();
    for (const sub of allSubs) {
      const cur = summaryByParent.get(sub.parentTemplateId) || { count: 0, totalSections: 0, totalQuestions: 0 };
      cur.count++;
      const sections = Array.isArray(sub.sections) ? (sub.sections as any[]) : [];
      cur.totalSections += sections.length;
      cur.totalQuestions += sections.reduce(
        (acc, s) => acc + (Array.isArray(s.questions) ? s.questions.length : 0),
        0,
      );
      summaryByParent.set(sub.parentTemplateId, cur);
    }

    for (const t of templates) {
      const summary = summaryByParent.get(t.id);
      if (summary && summary.count > 0) {
        (t as any).subTemplatesSummary = summary;
      } else {
        // Fallback legacy: contar desde template.sections
        const sections = Array.isArray(t.sections) ? (t.sections as any[]) : [];
        const totalQuestions = sections.reduce(
          (acc, s) => acc + (Array.isArray(s.questions) ? s.questions.length : 0),
          0,
        );
        (t as any).subTemplatesSummary = {
          count: 0,
          totalSections: sections.length,
          totalQuestions,
        };
      }
    }

    return templates;
  }

  async findAll(tenantId: string, includeAll = false): Promise<FormTemplate[]> {
    let templates: FormTemplate[];
    if (includeAll) {
      // Admin view: all statuses + global templates
      templates = await this.templateRepo.find({
        where: [{ tenantId }, { tenantId: IsNull() }],
        relations: ['creator'],
        order: { createdAt: 'DESC' },
      });
    } else {
      // Regular view: only published templates + global
      templates = await this.templateRepo.find({
        where: [
          { tenantId, status: 'published' },
          { tenantId: IsNull() },
        ],
        order: { createdAt: 'DESC' },
      });
    }
    // Fase 3: enriquecer con counts agregados de sub_templates
    return this.enrichWithSubTemplateSummary(templates);
  }

  /**
   * P5.2 — Secondary cross-tenant pattern: si tenantId es undefined
   * (super_admin cross-tenant), busca solo por id (incluye globales
   * automaticamente). Si tenantId es string, incluye su tenant y los
   * globales (tenantId IS NULL) como el comportamiento original.
   */
  async findById(id: string, tenantId: string | undefined): Promise<FormTemplate> {
    const where = tenantId
      ? [{ id, tenantId }, { id, tenantId: IsNull() }]
      : { id };
    const template = await this.templateRepo.findOne({ where });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    // Fase 3: enriquecer con summary de sub_templates
    const [enriched] = await this.enrichWithSubTemplateSummary([template]);
    return enriched;
  }

  // Validate no duplicate competencyIds across sections
  private validateSectionCompetencies(sections: any[]): void {
    const compIds = new Set<string>();
    for (const sec of sections) {
      if (sec.competencyId) {
        if (compIds.has(sec.competencyId)) {
          throw new BadRequestException(`La competencia ya está asignada a otra sección en esta plantilla`);
        }
        compIds.add(sec.competencyId);
      }
    }
  }

  async create(tenantId: string, userId: string, dto: CreateTemplateDto): Promise<FormTemplate> {
    if (dto.sections) this.validateSectionCompetencies(dto.sections);

    // Fase 3 (Opción A): si NO hay defaultCycleType pero TAMPOCO hay
    // sections, no podemos crear una plantilla vacia — exige al menos
    // uno de los dos.
    if (!dto.sections && !dto.defaultCycleType) {
      throw new BadRequestException(
        'Debes proporcionar `sections` (modo legacy) o `defaultCycleType` (modo Fase 3 con auto-creacion de subplantillas).',
      );
    }

    const template = this.templateRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      sections: dto.sections ?? [],
      defaultCycleType: dto.defaultCycleType ?? null,
      isDefault: dto.isDefault ?? false,
      language: dto.language || 'es',
      translations: dto.translations || {},
      createdBy: userId,
    });
    const saved = await this.templateRepo.save(template);

    // Fase 3 (Opción A): si trae defaultCycleType, auto-generamos las
    // subplantillas vacias correspondientes con weights default. El admin
    // las llenara con preguntas via el editor por tabs.
    if (dto.defaultCycleType) {
      await this.autoCreateSubTemplates(saved, dto.defaultCycleType);
    }

    return saved;
  }

  /**
   * Fase 3 (Opción A) — Auto-creación de subplantillas para un template
   * recien creado. Genera N rows en form_sub_templates segun el cycle
   * type del padre, con pesos default y secciones vacias.
   *
   * Idempotente: si ya existen subplantillas para el padre (race con
   * otro admin creando en paralelo), no las duplica — usa
   * upsert vía findOne.
   */
  private async autoCreateSubTemplates(
    parent: FormTemplate,
    cycleType: string,
  ): Promise<void> {
    const weights = DEFAULT_WEIGHTS_BY_CYCLE_TYPE[cycleType];
    if (!weights) {
      throw new BadRequestException(
        `Cycle type "${cycleType}" no esta soportado. Validos: 90, 180, 270, 360.`,
      );
    }

    const relations = getRelationsForCycleType(cycleType);
    for (const rel of relations) {
      const existing = await this.subTemplateRepo.findOne({
        where: { parentTemplateId: parent.id, relationType: rel },
      });
      if (existing) continue; // race condition / already exists

      const sub = this.subTemplateRepo.create({
        tenantId: parent.tenantId,
        parentTemplateId: parent.id,
        relationType: rel,
        sections: [],
        weight: weights[rel] ?? 0,
        displayOrder: SUB_TEMPLATE_DISPLAY_ORDER[rel] ?? 99,
        isActive: true,
      });
      await this.subTemplateRepo.save(sub);
    }
  }

  /** Get template sections in the requested language (falls back to primary) */
  getSectionsForLanguage(template: FormTemplate, lang: string): any[] {
    if (lang === template.language || !template.translations?.[lang]) {
      return template.sections;
    }
    return template.translations[lang];
  }

  async update(id: string, tenantId: string | undefined, userId: string, dto: UpdateTemplateDto): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new NotFoundException('No se pueden editar plantillas globales');
    }

    if (dto.sections) this.validateSectionCompetencies(dto.sections);

    // If sections changed, snapshot current version before overwriting
    const sectionsChanged = dto.sections !== undefined &&
      JSON.stringify(dto.sections) !== JSON.stringify(template.sections);

    if (sectionsChanged) {
      const history = Array.isArray(template.versionHistory) ? [...template.versionHistory] : [];
      history.push({
        version: template.version,
        name: template.name,
        sections: template.sections,
        changedBy: userId,
        changedAt: new Date().toISOString(),
        changeNote: dto.changeNote || null,
      });
      // Keep max 20 versions to avoid JSONB bloat
      if (history.length > 20) history.splice(0, history.length - 20);
      template.versionHistory = history;
      template.version = (template.version || 1) + 1;
    }

    Object.assign(template, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.sections !== undefined && { sections: dto.sections }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      ...(dto.language !== undefined && { language: dto.language }),
      ...(dto.translations !== undefined && { translations: dto.translations }),
    });
    return this.templateRepo.save(template);
  }

  async getVersionHistory(id: string, tenantId: string | undefined) {
    const template = await this.findById(id, tenantId);
    const history = Array.isArray(template.versionHistory) ? template.versionHistory : [];
    return {
      templateId: id,
      currentVersion: template.version || 1,
      totalVersions: history.length + 1,
      history: history.map((h: any) => ({
        version: h.version,
        name: h.name,
        changedBy: h.changedBy,
        changedAt: h.changedAt,
        changeNote: h.changeNote,
        sectionCount: Array.isArray(h.sections) ? h.sections.length : 0,
        questionCount: Array.isArray(h.sections)
          ? h.sections.reduce((sum: number, s: any) => sum + (s.questions?.length || 0), 0)
          : 0,
      })),
    };
  }

  async restoreVersion(id: string, tenantId: string | undefined, userId: string, version: number): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden editar plantillas globales');
    }
    const history = Array.isArray(template.versionHistory) ? template.versionHistory : [];
    const target = history.find((h: any) => h.version === version);
    if (!target) {
      throw new NotFoundException(`Versión ${version} no encontrada en el historial`);
    }

    // Fase 3: si el snapshot a restaurar tiene `subTemplates`, restaurar
    // tambien las subs (no solo el padre). Hace todo en transaccion para
    // garantizar atomicidad.
    return this.dataSource.transaction(async (manager) => {
      const txParentRepo = manager.getRepository(FormTemplate);
      const txSubRepo = manager.getRepository(FormSubTemplate);

      // 1. Cargar subs actuales para snapshot pre-restore (no perder
      //    el estado actual antes de sobreescribirlo).
      const currentSubs = await txSubRepo.find({
        where: { parentTemplateId: id },
      });

      // 2. Snapshot del estado ACTUAL antes de restaurar.
      history.push({
        version: template.version,
        name: template.name,
        sections: template.sections,
        subTemplates: currentSubs.map((s) => ({
          id: s.id,
          relationType: s.relationType,
          sections: s.sections,
          weight: Number(s.weight) || 0,
          displayOrder: s.displayOrder,
          isActive: s.isActive,
        })),
        changedBy: userId,
        changedAt: new Date().toISOString(),
        changeNote: `Auto-snapshot antes de restaurar versión ${version}`,
      });
      if (history.length > 20) history.splice(0, history.length - 20);

      // 3. Restaurar el padre (siempre)
      template.sections = target.sections;
      template.name = target.name || template.name;
      template.version = (template.version || 1) + 1;
      template.versionHistory = history;
      const savedTemplate = await txParentRepo.save(template);

      // 4. Restaurar subs si el snapshot las tiene (Fase 3+ snapshots).
      //    Snapshots legacy (Fase 2 o anterior) no tienen subTemplates →
      //    no restauramos nada de las subs (mantienen el estado actual).
      if (Array.isArray(target.subTemplates)) {
        // Estrategia de restore: actualizar las que existen por ID,
        // recrear las que ya no existen (raro), DEJAR las nuevas (creadas
        // post-snapshot) intactas — al user puede sorprenderle si esperaba
        // un "rollback total". Tradeoff aceptado: preservamos data nueva.
        for (const snapSub of target.subTemplates as any[]) {
          const existing = currentSubs.find((s) => s.id === snapSub.id);
          if (existing) {
            existing.sections = snapSub.sections;
            existing.weight = snapSub.weight;
            existing.displayOrder = snapSub.displayOrder;
            existing.isActive = snapSub.isActive;
            await txSubRepo.save(existing);
          } else {
            // La sub fue eliminada despues del snapshot — recrearla con
            // mismo id seria problematico (FK conflicts). Skipping para
            // evitar conflictos. El user puede ver el snapshot y agregar
            // manualmente la sub si la quiere.
            this.logger.warn(
              `restoreVersion: sub ${snapSub.id} del snapshot v${version} ya no existe — skip`,
            );
          }
        }
      }

      return savedTemplate;
    });
  }

  async remove(id: string, tenantId: string | undefined): Promise<void> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden eliminar plantillas globales');
    }

    // Validate: check if any evaluation cycles ACTIVOS estan usando esta
    // plantilla. EvaluationCycle.deleteCycle hace soft-delete (status →
    // 'cancelled'), por lo que un ciclo "eliminado" por el admin sigue
    // existiendo en BD. El count anterior no filtraba status, lo cual
    // bloqueaba la eliminacion de plantillas asociadas SOLO a ciclos
    // cancelados — bug reportado por usuario.
    //
    // Bloqueamos solo: draft, active, paused, closed (closed mantiene
    // referencia para reports historicos; admin debe ser explicito).
    // NO bloquea: cancelled (soft-deleted ya).
    const blockingStatuses = ['draft', 'active', 'paused', 'closed'];
    const cyclesUsingTemplate = await this.cycleRepo
      .createQueryBuilder('c')
      .where('c.templateId = :id', { id })
      .andWhere('c.status IN (:...statuses)', { statuses: blockingStatuses })
      .getCount();
    if (cyclesUsingTemplate > 0) {
      throw new BadRequestException(
        `No se puede eliminar esta plantilla porque está siendo utilizada por ${cyclesUsingTemplate} ciclo(s) de evaluación activos. Desasocie la plantilla de los ciclos antes de eliminarla.`,
      );
    }

    await this.templateRepo.remove(template);
  }

  /**
   * Import template from CSV.
   *
   * Expected CSV format (with header):
   *   seccion,pregunta,tipo,requerida
   *   Competencias Técnicas,Domina herramientas del cargo,scale,si
   *   Competencias Técnicas,Se mantiene actualizado,scale,si
   *   Comentarios,¿Cuáles son sus fortalezas?,text,si
   *
   * - seccion: groups questions into sections
   * - tipo: "scale" (1-5) or "text" (open answer)
   * - requerida: "si" or "no"
   */
  async importFromCsv(
    tenantId: string,
    userId: string,
    name: string,
    description: string,
    csvData: string,
  ): Promise<FormTemplate> {
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      throw new BadRequestException('El CSV debe tener al menos un encabezado y una fila de datos');
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const secIdx = header.indexOf('seccion');
    const pregIdx = header.indexOf('pregunta');
    const tipoIdx = header.indexOf('tipo');
    const reqIdx = header.indexOf('requerida');

    if (secIdx === -1 || pregIdx === -1) {
      throw new BadRequestException(
        'El CSV debe contener las columnas: seccion, pregunta. Opcionales: tipo, requerida',
      );
    }

    const scaleConfig = {
      min: 1, max: 5,
      labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' },
    };

    const sectionsMap = new Map<string, any[]>();
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const rowNum = i + 1;
      const seccion = cols[secIdx];
      const pregunta = cols[pregIdx];

      if (!seccion || !pregunta) {
        errors.push(`Fila ${rowNum}: seccion y pregunta son requeridos`);
        continue;
      }

      const tipo = tipoIdx >= 0 ? (cols[tipoIdx] || 'scale').toLowerCase() : 'scale';
      if (!['scale', 'text'].includes(tipo)) {
        errors.push(`Fila ${rowNum}: tipo debe ser "scale" o "text", se encontró "${tipo}"`);
        continue;
      }

      const requerida = reqIdx >= 0 ? cols[reqIdx]?.toLowerCase() : 'si';
      const required = requerida !== 'no';

      if (!sectionsMap.has(seccion)) {
        sectionsMap.set(seccion, []);
      }

      const questions = sectionsMap.get(seccion)!;
      const qId = `q${i}`;
      const question: any = { id: qId, text: pregunta, type: tipo, required };
      if (tipo === 'scale') {
        question.scale = scaleConfig;
      }
      questions.push(question);
    }

    if (sectionsMap.size === 0) {
      throw new BadRequestException(
        errors.length > 0
          ? `No se pudo importar. Errores: ${errors.join('; ')}`
          : 'El CSV no contiene datos válidos',
      );
    }

    const sections: any[] = [];
    let secIndex = 0;
    for (const [title, questions] of sectionsMap) {
      secIndex++;
      sections.push({ id: `sec${secIndex}`, title, questions });
    }

    const template = this.templateRepo.create({
      tenantId,
      name,
      description: description || `Plantilla importada desde CSV (${sections.length} secciones, ${lines.length - 1} preguntas)`,
      sections,
      isDefault: false,
      createdBy: userId,
    });

    const saved = await this.templateRepo.save(template);

    return {
      ...saved,
      ...(errors.length > 0 ? { importWarnings: errors } as any : {}),
    };
  }

  async duplicate(id: string, tenantId: string | undefined, userId: string): Promise<FormTemplate> {
    const original = await this.findById(id, tenantId);
    // La copia hereda el tenantId de la plantilla original (authoritative).
    // Si original es global (tenantId null), la copia queda como global solo
    // si el caller es super_admin sin tenant contexto; si es tenant_admin,
    // la copia queda en su tenant.
    const effectiveTenantId = tenantId ?? original.tenantId;

    // Fase 3: la copia tambien hereda defaultCycleType para que la
    // auto-creacion de subs (al estar set) se evite — vamos a copiar las
    // subs del original explicitamente abajo.
    const copy = this.templateRepo.create({
      tenantId: effectiveTenantId,
      name: `${original.name} (copia)`,
      description: original.description,
      sections: JSON.parse(JSON.stringify(original.sections || [])),
      defaultCycleType: original.defaultCycleType,
      language: original.language,
      translations: original.translations
        ? JSON.parse(JSON.stringify(original.translations))
        : {},
      isDefault: false,
      createdBy: userId,
    });
    const savedCopy = await this.templateRepo.save(copy);

    // Fase 3: copiar TODAS las sub_templates del original a la copia.
    // Cada sub recibe nuevo id (autogen) pero conserva relationType,
    // sections, weight, displayOrder e isActive.
    const originalSubs = await this.subTemplateRepo.find({
      where: { parentTemplateId: original.id },
    });
    if (originalSubs.length > 0) {
      const newSubs = originalSubs.map((origSub) =>
        this.subTemplateRepo.create({
          tenantId: savedCopy.tenantId,
          parentTemplateId: savedCopy.id,
          relationType: origSub.relationType,
          sections: JSON.parse(JSON.stringify(origSub.sections || [])),
          weight: Number(origSub.weight) || 0,
          displayOrder: origSub.displayOrder,
          isActive: origSub.isActive,
        }),
      );
      await this.subTemplateRepo.save(newSubs);
    }

    return savedCopy;
  }

  /**
   * Preview: returns a structured, renderable view of the template
   * with question counts, types breakdown, and estimated completion time.
   */
  async getPreview(id: string, tenantId: string) {
    const template = await this.findById(id, tenantId);

    // Fase 3 (Opción A): si la plantilla tiene sub_templates, el preview
    // se compone como `subTemplates: [{ relationType, weight, sections, ... }]`.
    // Si NO tiene subs, fallback al modo legacy (sections del padre).
    const subs = await this.subTemplateRepo.find({
      where: { parentTemplateId: id },
      order: { displayOrder: 'ASC' },
    });

    let totalQuestions = 0;
    let scaleCount = 0;
    let textCount = 0;
    let multiCount = 0;

    const buildPreviewSection = (sec: any) => {
      const questions = (sec.questions || []).map((q: any) => {
        totalQuestions++;
        if (q.type === 'scale') scaleCount++;
        else if (q.type === 'text') textCount++;
        else if (q.type === 'multi') multiCount++;
        return {
          id: q.id,
          text: q.text,
          type: q.type,
          required: q.required ?? true,
          scale: q.type === 'scale' ? q.scale : undefined,
          options: q.type === 'multi' ? q.options : undefined,
          condition: q.condition || null,
        };
      });
      return {
        id: sec.id,
        title: sec.title,
        description: sec.description || null,
        questionCount: questions.length,
        condition: sec.condition || null,
        questions,
      };
    };

    if (subs.length > 0) {
      // Path Fase 3: agrupa preview por subplantilla.
      const subTemplates = subs.map((sub) => ({
        id: sub.id,
        relationType: sub.relationType,
        weight: Number(sub.weight) || 0,
        isActive: sub.isActive,
        displayOrder: sub.displayOrder,
        sectionCount: Array.isArray(sub.sections) ? sub.sections.length : 0,
        sections: Array.isArray(sub.sections)
          ? (sub.sections as any[]).map(buildPreviewSection)
          : [],
      }));

      // estimatedMinutes consolida sobre TODAS las subs activas
      const estimatedMinutes = Math.ceil(
        (scaleCount * 30 + textCount * 90 + multiCount * 45) / 60,
      );

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        isDefault: template.isDefault,
        defaultCycleType: template.defaultCycleType ?? null,
        // Counters globales (sumados de todas las subs):
        sectionCount: subTemplates.reduce((acc, s) => acc + s.sectionCount, 0),
        totalQuestions,
        questionTypes: { scale: scaleCount, text: textCount, multi: multiCount },
        estimatedMinutes,
        subTemplates,
        // Backwards-compat: incluimos sections vacio para callers que no
        // detecten subTemplates aun (ej. clientes legacy).
        sections: [],
      };
    }

    // Path legacy: el padre tiene sections (Fase 1/2), sin subs.
    const sections = (template.sections || []) as any[];
    const previewSections = sections.map(buildPreviewSection);
    const estimatedMinutes = Math.ceil(
      (scaleCount * 30 + textCount * 90 + multiCount * 45) / 60,
    );

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      isDefault: template.isDefault,
      defaultCycleType: template.defaultCycleType ?? null,
      sectionCount: previewSections.length,
      totalQuestions,
      questionTypes: { scale: scaleCount, text: textCount, multi: multiCount },
      estimatedMinutes,
      sections: previewSections,
    };
  }

  // ─── Template Workflow (propose → review → publish) ──────────────────

  /** Manager proposes a template (status=proposed) */
  async propose(tenantId: string, userId: string, dto: CreateTemplateDto): Promise<FormTemplate> {
    const template = this.templateRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      sections: dto.sections,
      isDefault: false,
      createdBy: userId,
      status: 'proposed',
      proposedBy: userId,
    });
    return this.templateRepo.save(template);
  }

  /** List templates pending admin review */
  async findPending(tenantId: string): Promise<FormTemplate[]> {
    return this.templateRepo.find({
      where: { tenantId, status: 'proposed' },
      relations: ['creator'],
      order: { createdAt: 'ASC' },
    });
  }

  /** Admin publishes a proposed template */
  async publish(id: string, tenantId: string | undefined, reviewerId: string, note?: string): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    // Consistencia con update/remove: plantillas globales (tenantId=null) no
    // pasan por workflow de propuesta → revisión; se crean via seed/migración.
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden publicar plantillas globales');
    }
    if (template.status !== 'proposed') {
      throw new BadRequestException('Solo se pueden publicar plantillas en estado "propuesta"');
    }
    template.status = 'published';
    template.reviewedBy = reviewerId;
    template.reviewNote = note || null;
    template.reviewedAt = new Date();
    return this.templateRepo.save(template);
  }

  /** Admin rejects a proposed template */
  async reject(id: string, tenantId: string | undefined, reviewerId: string, note: string): Promise<FormTemplate> {
    if (!note || !note.trim()) {
      throw new BadRequestException('Se requiere una nota de rechazo');
    }
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden rechazar plantillas globales');
    }
    if (template.status !== 'proposed') {
      throw new BadRequestException('Solo se pueden rechazar plantillas en estado "propuesta"');
    }
    template.status = 'rejected';
    template.reviewedBy = reviewerId;
    template.reviewNote = note.trim();
    template.reviewedAt = new Date();
    return this.templateRepo.save(template);
  }

  // ─── Generate Sample Templates from Org Competencies ─────────────────

  async generateSampleTemplates(tenantId: string, userId: string): Promise<FormTemplate[]> {
    const competencies = await this.competencyRepo.find({
      where: { tenantId, isActive: true, status: 'approved' as any },
      order: { category: 'ASC', name: 'ASC' },
    });
    if (competencies.length < 3) {
      throw new BadRequestException('Se requieren al menos 3 competencias activas en el catálogo para generar plantillas de muestra. Actualmente hay ' + competencies.length + '.');
    }

    const scale = { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } };

    // Question banks per evaluation type perspective.
    // Fase 2 (plan auditoria evaluaciones): cada banco de preguntas se tagea
    // con `applicableTo` para que el helper filterTemplateForRelation muestre
    // solo las preguntas aplicables al rol del evaluador (self / manager /
    // peer / direct_report). Sin esto, un peer veria preguntas de manager
    // que no le corresponden, y viceversa.
    //
    // Optimized: 2 supervisor questions per competency (was 5) to keep
    // templates within 18-40 questions total.
    const supervisorQuestions = (name: string) => [
      { text: `El colaborador demuestra dominio en ${name}`, type: 'scale', scale, required: true, applicableTo: ['manager'] },
      { text: `Ha demostrado mejora en ${name} durante el período evaluado`, type: 'scale', scale, required: true, applicableTo: ['manager'] },
    ];
    const selfQuestions = (name: string) => [
      { text: `Considero que mi desempeño en ${name} es adecuado para mi cargo`, type: 'scale', scale, required: true, applicableTo: ['self'] },
    ];
    const peerQuestions = (name: string) => [
      { text: `Este compañero demuestra ${name} en la colaboración con el equipo`, type: 'scale', scale, required: true, applicableTo: ['peer'] },
    ];
    const reportQuestions = (name: string) => [
      { text: `Mi encargado me brinda orientación efectiva en ${name}`, type: 'scale', scale, required: true, applicableTo: ['direct_report'] },
    ];

    // Feedback section (common) — 2 questions to keep total count lean
    const feedbackSection = {
      id: `sec-feedback`,
      title: 'Retroalimentación General',
      competencyId: null,
      questions: [
        { id: `q-fb-1`, text: '¿Cuáles son las principales fortalezas de esta persona?', type: 'text', required: true },
        { id: `q-fb-2`, text: '¿En qué áreas podría mejorar y qué acción concreta recomendaría?', type: 'text', required: true },
      ],
    };

    const types = [
      { type: '90', name: 'Evaluación 90° — Jefatura + Auto', desc: 'Evaluación del supervisor combinada con la autoevaluación del colaborador. Cada perspectiva ve solo sus preguntas (filtrado por rol).' },
      { type: '180', name: 'Evaluación 180° — Jefatura + Auto + Pares', desc: 'Suma la perspectiva de pares al 90° estándar. Cada evaluador (manager / colaborador / par) responde un set de preguntas distinto adaptado a su rol.' },
      { type: '270', name: 'Evaluación 270° — Jefatura + Auto + Pares + Reportes directos', desc: 'Incluye además a los reportes directos del evaluado, que evalúan la calidad del liderazgo recibido.' },
      { type: '360', name: 'Evaluación 360° — Completa', desc: 'Evaluación integral: supervisor, autoevaluación, pares y reportes directos. Equivalente al 270° con etapa adicional de calibración.' },
    ];

    const templates: FormTemplate[] = [];

    // ─── Fase 3 (Opción A): el seed crea template padre VACIO + auto-crea
    // las subplantillas (form_sub_templates) con weights default + LLENA
    // cada subplantilla con preguntas espec­ficas para ese rol. Asi cada
    // subplantilla tiene SOLO las preguntas de su rol, sin applicableTo.
    //
    // La feedback section va a TODAS las subplantillas (todos los
    // evaluadores dan feedback abierto sobre fortalezas/mejoras).
    for (const evalType of types) {
      // 1. Crear template padre con defaultCycleType (sin sections legacy).
      const template = this.templateRepo.create({
        tenantId,
        name: evalType.name,
        description: evalType.desc,
        sections: [],
        defaultCycleType: evalType.type,
        status: 'published',
        language: 'es',
        createdBy: userId,
        isDefault: false,
      });
      const savedTemplate = await this.templateRepo.save(template);

      // 2. Auto-creación de subplantillas vacias con weights default
      //    (mismo metodo que usa el create() publico — DRY).
      await this.autoCreateSubTemplates(savedTemplate, evalType.type);

      // 3. Llenar cada subplantilla con preguntas correspondientes a su rol.
      const subs = await this.subTemplateRepo.find({
        where: { parentTemplateId: savedTemplate.id },
      });
      let qIdx = 0;

      for (const sub of subs) {
        const subSections: any[] = [];

        // Banco de preguntas por relationType: cada rol ve preguntas
        // distintas adaptadas a SU perspectiva sobre la competencia.
        const questionBank = this.getQuestionBankForRelation(
          sub.relationType,
          supervisorQuestions,
          selfQuestions,
          peerQuestions,
          reportQuestions,
        );

        for (const comp of competencies) {
          const secId = `sec-${comp.id.slice(0, 8)}`;
          const questions: any[] = [];
          for (const q of questionBank(comp.name)) {
            // Quitar applicableTo (no aplica en sub_templates — cada
            // subplantilla ya está implícitamente asociada a un rol).
            const { applicableTo, ...rest } = q as any;
            questions.push({ id: `q-${++qIdx}`, ...rest });
          }
          if (questions.length === 0) continue; // skip si el rol no tiene preguntas para esta competencia
          subSections.push({
            id: secId,
            title: comp.name,
            competencyId: comp.id,
            description: comp.description || `Evaluación de la competencia: ${comp.name}`,
            questions,
          });
        }

        // Feedback común — todas las subplantillas reciben las mismas
        // preguntas abiertas (cada evaluador puede aportar fortalezas/mejoras).
        subSections.push({
          ...feedbackSection,
          id: `sec-feedback-${sub.relationType}`,
          questions: feedbackSection.questions.map((q, i) => ({
            ...q,
            id: `q-fb-${sub.relationType}-${i}`,
          })),
        });

        sub.sections = subSections;
        await this.subTemplateRepo.save(sub);
      }

      templates.push(savedTemplate);
    }

    return templates;
  }

  /**
   * Helper de generateSampleTemplates: devuelve la funcion de banco de
   * preguntas correspondiente al relationType. Centraliza el mapping
   * rol → banco.
   */
  private getQuestionBankForRelation(
    rel: RelationType,
    supervisorQ: (n: string) => any[],
    selfQ: (n: string) => any[],
    peerQ: (n: string) => any[],
    reportQ: (n: string) => any[],
  ): (n: string) => any[] {
    switch (rel) {
      case RelationType.MANAGER:
        return supervisorQ;
      case RelationType.SELF:
        return selfQ;
      case RelationType.PEER:
        return peerQ;
      case RelationType.DIRECT_REPORT:
        return reportQ;
      case RelationType.EXTERNAL:
        return () => []; // external no esta en seed default
      default:
        return () => [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fase 3 (Opción A) — CRUD de subplantillas + migración legacy
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Devuelve la plantilla padre + sus subplantillas anidadas (ordenadas
   * por displayOrder). Si el padre tiene sections legacy con
   * `applicableTo` y NO tiene subplantillas, ejecuta migración inline
   * automatica (one-time): crea las form_sub_templates desde sections
   * filtradas por applicableTo. Idempotente — corre solo una vez.
   *
   * Este es el endpoint principal que usa el frontend (editor con tabs).
   */
  async findByIdWithSubTemplates(
    id: string,
    tenantId: string | undefined,
  ): Promise<{ template: FormTemplate; subTemplates: FormSubTemplate[] }> {
    const template = await this.findById(id, tenantId);

    let subTemplates = await this.subTemplateRepo.find({
      where: { parentTemplateId: id },
      order: { displayOrder: 'ASC' },
    });

    // Migración legacy inline: si el template tiene sections con
    // applicableTo y no tiene subplantillas → migra.
    if (subTemplates.length === 0 && this.isLegacyMigratable(template)) {
      subTemplates = await this.migrateLegacyToSubTemplates(template);
    }

    return { template, subTemplates };
  }

  /**
   * Detecta si una plantilla tiene formato legacy migratable: tiene
   * sections array con al menos UNA pregunta con applicableTo.
   * Plantillas sin applicableTo no se migran (no hay info para
   * distribuir entre roles — el admin debe definir manualmente).
   */
  private isLegacyMigratable(template: FormTemplate): boolean {
    if (!Array.isArray(template.sections) || template.sections.length === 0) {
      return false;
    }
    for (const sec of template.sections as any[]) {
      if (Array.isArray(sec.applicableTo) && sec.applicableTo.length > 0) return true;
      for (const q of sec.questions || []) {
        if (Array.isArray(q.applicableTo) && q.applicableTo.length > 0) return true;
      }
    }
    return false;
  }

  /**
   * Migración legacy → sub_templates. Recorre las sections del padre,
   * detecta los relationTypes presentes en applicableTo, y crea una
   * subplantilla por cada uno con SOLO las preguntas que aplican.
   *
   * Pesos: si el template ya tiene `defaultCycleType` → usa los pesos
   * default de ese cycle type. Si no, asigna pesos uniformes (1/N).
   *
   * Idempotente: usa findOne + skip si ya existe (race-safe).
   */
  private async migrateLegacyToSubTemplates(
    template: FormTemplate,
  ): Promise<FormSubTemplate[]> {
    // 1. Identificar todos los relationTypes presentes en applicableTo.
    const relationsPresent = new Set<RelationType>();
    for (const sec of template.sections as any[]) {
      for (const r of sec.applicableTo || []) relationsPresent.add(r as RelationType);
      for (const q of sec.questions || []) {
        for (const r of q.applicableTo || []) relationsPresent.add(r as RelationType);
      }
    }

    if (relationsPresent.size === 0) return [];

    // 2. Determinar pesos default. Si el template tiene defaultCycleType,
    //    usamos ese mapping; si no, usamos pesos uniformes.
    const cycleType = template.defaultCycleType ?? this.inferCycleTypeFromRelations([...relationsPresent]);
    const weights = cycleType ? DEFAULT_WEIGHTS_BY_CYCLE_TYPE[cycleType] : null;

    const created: FormSubTemplate[] = [];

    for (const rel of relationsPresent) {
      const existing = await this.subTemplateRepo.findOne({
        where: { parentTemplateId: template.id, relationType: rel },
      });
      if (existing) {
        created.push(existing);
        continue;
      }

      // 3. Filtrar sections + preguntas que aplican a este rol.
      const filteredSections: any[] = [];
      for (const sec of template.sections as any[]) {
        const secApplicable =
          !sec.applicableTo ||
          sec.applicableTo.length === 0 ||
          sec.applicableTo.includes(rel);
        if (!secApplicable) continue;

        const filteredQuestions = (sec.questions || []).filter((q: any) => {
          if (!q.applicableTo || q.applicableTo.length === 0) return true;
          return q.applicableTo.includes(rel);
        }).map((q: any) => {
          // Limpiar applicableTo en el resultado migrado (cada sub_template
          // ya esta implicitamente para un solo rol).
          const { applicableTo, ...rest } = q;
          return rest;
        });

        if (filteredQuestions.length === 0) continue;

        const { applicableTo: _secAt, ...secRest } = sec as any;
        filteredSections.push({ ...secRest, questions: filteredQuestions });
      }

      const weight = weights?.[rel] ?? (1 / relationsPresent.size);

      const sub = this.subTemplateRepo.create({
        tenantId: template.tenantId,
        parentTemplateId: template.id,
        relationType: rel,
        sections: filteredSections,
        weight: Math.round(weight * 1000) / 1000,
        displayOrder: SUB_TEMPLATE_DISPLAY_ORDER[rel] ?? 99,
        isActive: true,
      });
      created.push(await this.subTemplateRepo.save(sub));
    }

    // 4. Si el template no tenia defaultCycleType, lo seteamos ahora
    //    (basado en los roles presentes — se infiere).
    if (!template.defaultCycleType && cycleType) {
      template.defaultCycleType = cycleType;
      await this.templateRepo.save(template);
    }

    return created.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Infiere el cycle type a partir de los roles presentes:
   *   - {self, manager}                                  → 90
   *   - {self, manager, peer}                            → 180
   *   - {self, manager, peer, direct_report}             → 270 (default)
   *   - {self, manager, peer, direct_report, external}   → 360
   */
  private inferCycleTypeFromRelations(rels: RelationType[]): string | null {
    const set = new Set(rels);
    if (set.has(RelationType.EXTERNAL)) return '360';
    if (set.has(RelationType.DIRECT_REPORT)) return '270';
    if (set.has(RelationType.PEER)) return '180';
    if (set.has(RelationType.MANAGER)) return '90';
    return null;
  }

  /** Crea una subplantilla nueva manualmente (admin desde editor). */
  async createSubTemplate(
    parentId: string,
    tenantId: string | undefined,
    dto: CreateSubTemplateDto,
  ): Promise<FormSubTemplate> {
    const parent = await this.findById(parentId, tenantId);

    // Verificar que no exista una sub_template con el mismo relationType
    const existing = await this.subTemplateRepo.findOne({
      where: { parentTemplateId: parentId, relationType: dto.relationType },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe una subplantilla para el rol "${dto.relationType}" en esta plantilla.`,
      );
    }

    const sub = this.subTemplateRepo.create({
      tenantId: parent.tenantId,
      parentTemplateId: parentId,
      relationType: dto.relationType,
      sections: dto.sections ?? [],
      weight: dto.weight ?? 0,
      displayOrder: dto.displayOrder ?? SUB_TEMPLATE_DISPLAY_ORDER[dto.relationType] ?? 99,
      isActive: dto.isActive ?? true,
    });
    return this.subTemplateRepo.save(sub);
  }

  /** Actualiza una subplantilla (sections, weight, displayOrder, isActive). */
  async updateSubTemplate(
    subId: string,
    tenantId: string | undefined,
    dto: UpdateSubTemplateDto,
  ): Promise<FormSubTemplate> {
    const sub = await this.subTemplateRepo.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException('Subplantilla no encontrada');

    // Verificar tenant ownership via parent
    const parent = await this.findById(sub.parentTemplateId, tenantId);
    if (parent.tenantId === null) {
      throw new BadRequestException('No se pueden editar subplantillas de plantillas globales');
    }

    if (dto.sections !== undefined) sub.sections = dto.sections;
    if (dto.weight !== undefined) sub.weight = dto.weight;
    if (dto.displayOrder !== undefined) sub.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) sub.isActive = dto.isActive;

    return this.subTemplateRepo.save(sub);
  }

  /**
   * Elimina una subplantilla (hard delete) + snapshot del padre antes
   * de borrar para que quede en versionHistory. Sin el snapshot, una
   * eliminacion accidental seria irreversible (ni siquiera restoreVersion
   * ayudaria — la sub eliminada no esta en ninguna version).
   *
   * Lote 3 (Pregunta 2B): hard delete con audit completo.
   */
  async deleteSubTemplate(
    subId: string,
    tenantId: string | undefined,
    userId?: string,
  ): Promise<void> {
    const sub = await this.subTemplateRepo.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException('Subplantilla no encontrada');

    // Verificar tenant ownership via parent
    const parent = await this.findById(sub.parentTemplateId, tenantId);
    if (parent.tenantId === null) {
      throw new BadRequestException('No se pueden eliminar subplantillas de plantillas globales');
    }

    // Transaccion atomica: snapshot del padre con TODAS sus subs (incluida
    // la que se va a borrar) → delete sub → save padre con history actualizado.
    // Si admin restaura esta version, la sub se va a recrear (con nuevo id).
    await this.dataSource.transaction(async (manager) => {
      const txParentRepo = manager.getRepository(FormTemplate);
      const txSubRepo = manager.getRepository(FormSubTemplate);

      const allSubs = await txSubRepo.find({
        where: { parentTemplateId: parent.id },
      });
      const meta = (sub as any).relationType;

      const history = Array.isArray(parent.versionHistory)
        ? [...(parent.versionHistory as any[])]
        : [];
      history.push({
        version: parent.version,
        name: parent.name,
        sections: parent.sections,
        subTemplates: allSubs.map((s) => ({
          id: s.id,
          relationType: s.relationType,
          sections: s.sections,
          weight: Number(s.weight) || 0,
          displayOrder: s.displayOrder,
          isActive: s.isActive,
        })),
        changedBy: userId || null,
        changedAt: new Date().toISOString(),
        changeNote: `Auto-snapshot antes de eliminar subplantilla "${meta}"`,
      });
      if (history.length > 20) history.splice(0, history.length - 20);
      parent.versionHistory = history;
      parent.version = (parent.version || 1) + 1;
      await txParentRepo.save(parent);

      await txSubRepo.remove(sub);
    });
  }

  /**
   * Save-all atomico: actualiza TODAS las subs + pesos en una sola
   * transaccion + hace snapshot del estado actual ANTES de modificar
   * (versionHistory). Reemplaza N llamadas separadas
   * (updateSubTemplate × N + updateWeights) con UNA sola call.
   *
   * Garantias:
   *   - Atomicidad: si una sub falla, NINGUNA se persiste (rollback).
   *   - Snapshot UNICO en versionHistory por save (no N+1).
   *   - Validacion de suma de pesos == 1.0 antes del commit.
   *   - Si changeNote no se pasa, el snapshot lo deja como null.
   */
  async saveAllSubTemplates(
    parentId: string,
    tenantId: string | undefined,
    userId: string,
    dto: SaveAllSubTemplatesDto,
  ): Promise<{ template: FormTemplate; subTemplates: FormSubTemplate[] }> {
    const parent = await this.findById(parentId, tenantId);
    if (parent.tenantId === null) {
      throw new BadRequestException('No se pueden editar plantillas globales');
    }

    if (!Array.isArray(dto.subTemplates) || dto.subTemplates.length === 0) {
      throw new BadRequestException('subTemplates debe ser un array no vacio');
    }

    // Cargar TODAS las subs actuales para snapshot + validar IDs validos
    const allSubs = await this.subTemplateRepo.find({
      where: { parentTemplateId: parentId },
      order: { displayOrder: 'ASC' },
    });
    const subsById = new Map(allSubs.map((s) => [s.id, s]));

    // Validar que todos los IDs del DTO existen
    for (const item of dto.subTemplates) {
      if (!subsById.has(item.id)) {
        throw new BadRequestException(
          `Subplantilla "${item.id}" no encontrada en la plantilla padre.`,
        );
      }
    }

    // ─── Transacción atomica ───────────────────────────────────────────
    return this.dataSource.transaction(async (manager) => {
      const txParentRepo = manager.getRepository(FormTemplate);
      const txSubRepo = manager.getRepository(FormSubTemplate);

      // 1. Snapshot del estado ACTUAL antes de modificar (versionHistory).
      //    Snapshot incluye padre + todas las subs (formato JSONB compacto).
      const snapshot = {
        version: parent.version,
        name: parent.name,
        sections: parent.sections, // legacy, igual lo guardamos
        subTemplates: allSubs.map((s) => ({
          id: s.id,
          relationType: s.relationType,
          sections: s.sections,
          weight: Number(s.weight) || 0,
          displayOrder: s.displayOrder,
          isActive: s.isActive,
        })),
        changedBy: userId,
        changedAt: new Date().toISOString(),
        changeNote: dto.changeNote || null,
      };

      const history = Array.isArray(parent.versionHistory)
        ? [...(parent.versionHistory as any[])]
        : [];
      history.push(snapshot);
      // Cap a 20 versiones para evitar JSONB bloat
      if (history.length > 20) history.splice(0, history.length - 20);
      parent.versionHistory = history;
      parent.version = (parent.version || 1) + 1;
      await txParentRepo.save(parent);

      // 2. Aplicar updates de cada sub
      const updatedSubs: FormSubTemplate[] = [];
      for (const item of dto.subTemplates) {
        const sub = subsById.get(item.id)!;
        if (item.sections !== undefined) sub.sections = item.sections;
        if (item.weight !== undefined) sub.weight = item.weight;
        if (item.displayOrder !== undefined) sub.displayOrder = item.displayOrder;
        if (item.isActive !== undefined) sub.isActive = item.isActive;
        updatedSubs.push(await txSubRepo.save(sub));
      }

      // 3. Cargar TODAS las subs (incluyendo las no modificadas en el DTO)
      //    para validar suma de pesos activos == 1.0.
      const finalSubs = await txSubRepo.find({
        where: { parentTemplateId: parentId },
        order: { displayOrder: 'ASC' },
      });
      const totalActive = finalSubs
        .filter((s) => s.isActive)
        .reduce((sum, s) => sum + Number(s.weight), 0);
      if (Math.abs(totalActive - 1.0) > WEIGHT_SUM_TOLERANCE) {
        // El throw aqui rolleabackea TODA la transaccion (incluido el snapshot)
        throw new BadRequestException(
          `La suma de pesos de subplantillas activas debe ser 1.0 (= 100%). Actual: ${totalActive.toFixed(3)}.`,
        );
      }

      return { template: parent, subTemplates: finalSubs };
    });
  }

  /**
   * Update batch de pesos. Aplica los nuevos pesos y valida que la suma
   * de TODOS los pesos activos sea 1.0 ± tolerancia. Si no, rechaza
   * con BadRequestException explicando el delta.
   */
  async updateWeights(
    parentId: string,
    tenantId: string | undefined,
    dto: UpdateWeightsDto,
  ): Promise<FormSubTemplate[]> {
    const parent = await this.findById(parentId, tenantId);
    if (parent.tenantId === null) {
      throw new BadRequestException('No se pueden editar pesos de plantillas globales');
    }

    const allSubs = await this.subTemplateRepo.find({
      where: { parentTemplateId: parentId },
      order: { displayOrder: 'ASC' },
    });

    // Aplicar los nuevos pesos a las subs incluidas en el DTO
    for (const sub of allSubs) {
      const newWeight = dto.weights[sub.relationType];
      if (newWeight !== undefined) sub.weight = newWeight;
    }

    // Validar suma == 1.0 considerando solo subs activas
    const totalActive = allSubs
      .filter((s) => s.isActive)
      .reduce((sum, s) => sum + Number(s.weight), 0);

    if (Math.abs(totalActive - 1.0) > WEIGHT_SUM_TOLERANCE) {
      throw new BadRequestException(
        `La suma de pesos de subplantillas activas debe ser 1.0 (= 100%). Actual: ${totalActive.toFixed(3)}.`,
      );
    }

    return Promise.all(allSubs.map((s) => this.subTemplateRepo.save(s)));
  }

  /**
   * Devuelve solo las subplantillas de un padre (sin el padre).
   * Useful cuando ya tenes el padre en memoria.
   */
  async getSubTemplates(parentId: string): Promise<FormSubTemplate[]> {
    return this.subTemplateRepo.find({
      where: { parentTemplateId: parentId },
      order: { displayOrder: 'ASC' },
    });
  }

  /**
   * Devuelve la subplantilla activa para un parent + relationType.
   * Retorna null si no existe (caller decide fallback al legacy).
   */
  async getActiveSubTemplateForRelation(
    parentId: string,
    relationType: RelationType,
  ): Promise<FormSubTemplate | null> {
    return this.subTemplateRepo.findOne({
      where: { parentTemplateId: parentId, relationType, isActive: true },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fase 3 (Opción A) - Bonus IA: sugerencia de distribucion de competencias
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Pide a Claude que sugiera, para cada competencia activa del tenant,
   * qué tipo(s) de evaluador deberían responderla (y opcionalmente, qué
   * preguntas ejemplo). El resultado se devuelve como JSON estructurado
   * SIN persistirse — el admin acepta o ignora las sugerencias en la UI.
   *
   * El call queda registrado en `ai_call_logs` (audit trail de tokens).
   *
   * @param templateId — el FormTemplate padre para el cual sugerir
   * @param tenantId — para validar ownership y filtrar competencias
   * @param userId — quien dispara la generacion (audit)
   * @returns Sugerencias por relationType: { manager: [{ competencyId,
   *   competencyName, suggestedQuestions: [...] }, ...], self: [...], etc. }
   */
  async suggestCompetencyDistribution(
    templateId: string,
    tenantId: string,
    userId: string,
  ): Promise<{
    cycleType: string;
    relations: string[];
    suggestions: Record<string, Array<{
      competencyId: string;
      competencyName: string;
      perspective: string;
      suggestedQuestions: string[];
    }>>;
  }> {
    const template = await this.findById(templateId, tenantId);
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden generar sugerencias para plantillas globales');
    }

    // ─── Verificar cuota IA del tenant antes de gastar tokens ──────────
    // Lanza BadRequestException si excedido (90% warning + 100% block).
    // Comparte la misma logica de quota que ai-insights.service —
    // descuenta del plan + addon credits del tenant.
    await this.aiInsightsService.assertAiQuota(tenantId);

    const cycleType = template.defaultCycleType ?? '360';
    const relations = getRelationsForCycleType(cycleType);

    if (relations.length === 0) {
      throw new BadRequestException(
        `Cycle type "${cycleType}" no tiene roles configurados.`,
      );
    }

    // Cargar competencias activas del tenant
    const competencies = await this.competencyRepo.find({
      where: { tenantId, isActive: true } as any,
      order: { category: 'ASC', name: 'ASC' },
    });

    if (competencies.length === 0) {
      throw new BadRequestException(
        'No hay competencias activas en el catalogo para sugerir distribucion.',
      );
    }

    // ─── Prompt construction ───────────────────────────────────────────
    const competenciesDesc = competencies
      .map((c) => `- ${c.id}: "${c.name}" (categoría: ${c.category || 'General'}; descripción: ${c.description || 'sin descripción'})`)
      .join('\n');

    const relationLabels: Record<string, string> = {
      self: 'Auto-evaluación (el propio evaluado)',
      manager: 'Jefe directo (supervisor del evaluado)',
      peer: 'Pares (compañeros del mismo nivel)',
      direct_report: 'Reportes directos (subordinados del evaluado)',
      external: 'Externo (cliente, proveedor, stakeholder)',
    };
    const relationsDesc = relations
      .map((r) => `- "${r}": ${relationLabels[r] || r}`)
      .join('\n');

    const prompt = `Eres un experto en evaluación de desempeño y diseño de instrumentos 360°.

Te paso una plantilla de evaluación tipo ${cycleType}° con los siguientes evaluadores:
${relationsDesc}

Y un catálogo de competencias del tenant:
${competenciesDesc}

Tu tarea: para CADA evaluador, decidir qué competencias del catálogo le corresponden evaluar — basándote en si esa perspectiva puede observar la competencia mejor que las demás. Adicionalmente, sugerir 2 preguntas tipo escala (1-5) por competencia, redactadas DESDE la perspectiva del evaluador.

Reglas:
- Una competencia puede aparecer en múltiples evaluadores si es observable desde varias perspectivas (ej. "Comunicación" la ven todos).
- Competencias técnicas: principalmente manager + self.
- Competencias de liderazgo: principalmente direct_report + manager.
- Competencias conductuales (trabajo en equipo, etc.): todos.
- Competencias de auto-reflexión (autocrítica, autodisciplina): solo self.
- Las preguntas deben ser específicas a la perspectiva (ej. "El colaborador..." para manager; "Considero que mi desempeño en..." para self; "Este compañero..." para peer; "Mi encargado..." para direct_report).

Responde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto antes ni después) con la siguiente estructura:
{
  "suggestions": {
    "manager": [
      {
        "competencyId": "uuid-de-la-competencia",
        "competencyName": "nombre",
        "perspective": "una frase breve explicando por qué este rol la evalúa",
        "suggestedQuestions": ["Pregunta 1...", "Pregunta 2..."]
      }
    ],
    "self": [...],
    "peer": [...],
    "direct_report": [...]
  }
}

Solo incluye los relationTypes que aplican a este cycle type (${cycleType}°). Devuelve TODAS las competencias distribuidas — ninguna debe quedar sin asignar a al menos un evaluador.`;

    // ─── Llamar a Claude ───────────────────────────────────────────────
    const client = this.ensureAnthropicClient();
    const startTime = Date.now();
    let parsed: any = null;
    let parseError: string | null = null;
    let tokensUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const model = 'claude-haiku-4-5';

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      inputTokens = response.usage?.input_tokens || 0;
      outputTokens = response.usage?.output_tokens || 0;
      tokensUsed = inputTokens + outputTokens;

      // Intentar parsear el JSON
      try {
        // Strip de markdown fences si hubiera
        const cleaned = text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();
        parsed = JSON.parse(cleaned);
      } catch (e: any) {
        parseError = `JSON parse error: ${e.message}. Response prefix: ${text.slice(0, 200)}`;
      }
    } catch (err: any) {
      this.logger.error(`Anthropic API error: ${err.message}`);
      // Persist call log con error y throw
      await this.aiCallLogRepo.save(
        this.aiCallLogRepo.create({
          tenantId,
          type: InsightType.SUMMARY, // reusar el enum (no hay un type espec­fico)
          tokensUsed: 0,
          inputTokens: 0,
          outputTokens: 0,
          model,
          generatedBy: userId,
          parseSuccess: false,
          errorMessage: `Anthropic API error: ${err.message}`,
          insightId: null,
        }),
      );
      if (err.status === 429) {
        throw new BadRequestException('Límite de IA alcanzado. Intenta en unos minutos.');
      }
      if (err.status === 401) {
        throw new ServiceUnavailableException('Error de autenticación con la API de IA.');
      }
      throw new BadRequestException(`Error al comunicarse con la IA: ${err.message}`);
    }

    // ─── Persistir AiInsight (cuenta como crédito del plan) ──────────────
    // Si el parse fue OK, guardamos el insight para que cuente contra el
    // plan limit (mismo comportamiento que cualquier otro insight).
    let savedInsight: AiInsight | null = null;
    if (parseError === null && parsed) {
      savedInsight = await this.aiInsightRepo.save(
        this.aiInsightRepo.create({
          tenantId,
          type: InsightType.SUMMARY, // reusar enum existente (no romper el ENUM con ALTER TYPE)
          userId: null,
          cycleId: null,
          scopeEntityId: templateId, // el template es el scope
          content: parsed as any,
          model,
          tokensUsed,
          generatedBy: userId,
        }),
      );
    }

    // ─── Persistir audit log SIEMPRE (sucess o fail del parse) ──────────
    await this.aiCallLogRepo.save(
      this.aiCallLogRepo.create({
        tenantId,
        type: InsightType.SUMMARY,
        tokensUsed,
        inputTokens,
        outputTokens,
        model,
        generatedBy: userId,
        parseSuccess: parseError === null,
        errorMessage: parseError,
        insightId: savedInsight?.id || null,
      }),
    );

    // ─── Track addon usage (descuenta crédito addon si plan agotado) ────
    // Esto se llama SIEMPRE que el call fue exitoso (parse OK o no), pero
    // solo decuenta addon si el plan ya esta agotado en el período.
    if (parseError === null) {
      await this.aiInsightsService.trackAddonUsage(tenantId);
    }

    if (parseError !== null || !parsed) {
      throw new BadRequestException(
        `La IA respondió con formato inválido. Intenta de nuevo. Detalle: ${parseError || 'parsed=null'}`,
      );
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `suggestCompetencyDistribution OK: tenant=${tenantId}, template=${templateId}, tokens=${tokensUsed}, elapsed=${elapsed}ms`,
    );

    // Validar la estructura del response
    if (!parsed.suggestions || typeof parsed.suggestions !== 'object') {
      throw new BadRequestException('La IA respondió con estructura inesperada (falta `suggestions`).');
    }

    return {
      cycleType,
      relations,
      suggestions: parsed.suggestions,
    };
  }

  /**
   * Aplica las sugerencias de IA a las subplantillas: distribuye las
   * competencias y preguntas sugeridas en cada sub_template del rol
   * correspondiente. NO sobrescribe contenido existente — solo agrega.
   *
   * Defensive: valida que cada competencyId sugerido EXISTE realmente en
   * el catálogo del tenant — la IA puede alucinar UUIDs (Claude ocasionalmente
   * inventa IDs que parecen UUIDs válidos). Se omite cualquier sugerencia
   * con competencyId no encontrado y se loguea para diagnóstico.
   */
  async applySuggestions(
    templateId: string,
    tenantId: string,
    suggestions: Record<string, Array<{
      competencyId: string;
      competencyName: string;
      perspective?: string;
      suggestedQuestions: string[];
    }>>,
  ): Promise<FormSubTemplate[]> {
    await this.findById(templateId, tenantId); // validar ownership

    // Cargar IDs validos del catálogo del tenant (defensive vs IA hallucination).
    const validCompetencies = await this.competencyRepo.find({
      where: { tenantId } as any,
      select: ['id', 'name'],
    });
    const validIds = new Set(validCompetencies.map((c) => c.id));

    const subs = await this.subTemplateRepo.find({
      where: { parentTemplateId: templateId },
    });

    const updated: FormSubTemplate[] = [];
    let skippedHallucinated = 0;

    for (const sub of subs) {
      const rolSuggestions = suggestions[sub.relationType];
      if (!Array.isArray(rolSuggestions) || rolSuggestions.length === 0) {
        continue;
      }

      const existingSections = Array.isArray(sub.sections) ? [...(sub.sections as any[])] : [];
      const existingCompIds = new Set(
        existingSections.map((s: any) => s.competencyId).filter(Boolean),
      );

      let qIdx = existingSections.reduce(
        (acc, s) => acc + (Array.isArray(s.questions) ? s.questions.length : 0),
        0,
      );

      for (const item of rolSuggestions) {
        // Skip si la IA invento un UUID — solo aceptamos competencias del catálogo.
        if (!validIds.has(item.competencyId)) {
          skippedHallucinated++;
          this.logger.warn(
            `applySuggestions: competencyId hallucinated by IA, skipping. id=${item.competencyId}, name="${item.competencyName}"`,
          );
          continue;
        }

        if (existingCompIds.has(item.competencyId)) continue; // skip si ya existe esa competencia

        const questions = (item.suggestedQuestions || []).map((qText) => ({
          id: `q-ai-${++qIdx}-${Math.random().toString(36).slice(2, 6)}`,
          text: qText,
          type: 'scale',
          scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
          required: true,
        }));

        existingSections.push({
          id: `sec-ai-${item.competencyId.slice(0, 8)}`,
          title: item.competencyName,
          competencyId: item.competencyId,
          description: item.perspective || `Evaluación de ${item.competencyName}`,
          questions,
        });
      }

      sub.sections = existingSections;
      updated.push(await this.subTemplateRepo.save(sub));
    }

    if (skippedHallucinated > 0) {
      this.logger.log(
        `applySuggestions: ${skippedHallucinated} sugerencia(s) descartadas por competencyId no valido.`,
      );
    }

    return updated;
  }
}
