import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { FormTemplate } from './entities/form-template.entity';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(FormTemplate)
    private readonly templateRepo: Repository<FormTemplate>,
  ) {}

  async findAll(tenantId: string, includeAll = false): Promise<FormTemplate[]> {
    if (includeAll) {
      // Admin view: all statuses + global templates
      return this.templateRepo.find({
        where: [{ tenantId }, { tenantId: IsNull() }],
        relations: ['creator'],
        order: { createdAt: 'DESC' },
      });
    }
    // Regular view: only published templates + global
    return this.templateRepo.find({
      where: [
        { tenantId, status: 'published' },
        { tenantId: IsNull() },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, tenantId: string): Promise<FormTemplate> {
    const template = await this.templateRepo.findOne({
      where: [
        { id, tenantId },
        { id, tenantId: IsNull() },
      ],
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    return template;
  }

  async create(tenantId: string, userId: string, dto: CreateTemplateDto): Promise<FormTemplate> {
    const template = this.templateRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      sections: dto.sections,
      isDefault: dto.isDefault ?? false,
      createdBy: userId,
    });
    return this.templateRepo.save(template);
  }

  async update(id: string, tenantId: string, userId: string, dto: UpdateTemplateDto): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new NotFoundException('No se pueden editar plantillas globales');
    }

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
    });
    return this.templateRepo.save(template);
  }

  async getVersionHistory(id: string, tenantId: string) {
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

  async restoreVersion(id: string, tenantId: string, userId: string, version: number): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new BadRequestException('No se pueden editar plantillas globales');
    }
    const history = Array.isArray(template.versionHistory) ? template.versionHistory : [];
    const target = history.find((h: any) => h.version === version);
    if (!target) {
      throw new NotFoundException(`Versión ${version} no encontrada en el historial`);
    }

    // Snapshot current before restoring
    history.push({
      version: template.version,
      name: template.name,
      sections: template.sections,
      changedBy: userId,
      changedAt: new Date().toISOString(),
      changeNote: `Auto-snapshot antes de restaurar versión ${version}`,
    });
    if (history.length > 20) history.splice(0, history.length - 20);

    template.sections = target.sections;
    template.name = target.name || template.name;
    template.version = (template.version || 1) + 1;
    template.versionHistory = history;

    return this.templateRepo.save(template);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new NotFoundException('No se pueden eliminar plantillas globales');
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

  async duplicate(id: string, tenantId: string, userId: string): Promise<FormTemplate> {
    const original = await this.findById(id, tenantId);
    const copy = this.templateRepo.create({
      tenantId,
      name: `${original.name} (copia)`,
      description: original.description,
      sections: JSON.parse(JSON.stringify(original.sections)),
      isDefault: false,
      createdBy: userId,
    });
    return this.templateRepo.save(copy);
  }

  /**
   * Preview: returns a structured, renderable view of the template
   * with question counts, types breakdown, and estimated completion time.
   */
  async getPreview(id: string, tenantId: string) {
    const template = await this.findById(id, tenantId);
    const sections = (template.sections || []) as any[];

    let totalQuestions = 0;
    let scaleCount = 0;
    let textCount = 0;
    let multiCount = 0;

    const previewSections = sections.map((sec: any) => {
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
          condition: q.condition || null, // P2-#35: conditional logic support
        };
      });

      return {
        id: sec.id,
        title: sec.title,
        description: sec.description || null,
        questionCount: questions.length,
        questions,
      };
    });

    // Estimated time: ~30s per scale, ~90s per text, ~45s per multi
    const estimatedMinutes = Math.ceil((scaleCount * 30 + textCount * 90 + multiCount * 45) / 60);

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      isDefault: template.isDefault,
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
  async publish(id: string, tenantId: string, reviewerId: string, note?: string): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
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
  async reject(id: string, tenantId: string, reviewerId: string, note: string): Promise<FormTemplate> {
    if (!note || !note.trim()) {
      throw new BadRequestException('Se requiere una nota de rechazo');
    }
    const template = await this.findById(id, tenantId);
    if (template.status !== 'proposed') {
      throw new BadRequestException('Solo se pueden rechazar plantillas en estado "propuesta"');
    }
    template.status = 'rejected';
    template.reviewedBy = reviewerId;
    template.reviewNote = note.trim();
    template.reviewedAt = new Date();
    return this.templateRepo.save(template);
  }
}
