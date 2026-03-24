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

  async findAll(tenantId: string): Promise<FormTemplate[]> {
    return this.templateRepo.find({
      where: [{ tenantId }, { tenantId: IsNull() }],
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

  async update(id: string, tenantId: string, dto: UpdateTemplateDto): Promise<FormTemplate> {
    const template = await this.findById(id, tenantId);
    if (template.tenantId === null) {
      throw new NotFoundException('No se pueden editar plantillas globales');
    }
    Object.assign(template, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.sections !== undefined && { sections: dto.sections }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    });
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
}
