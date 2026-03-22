import { Injectable, NotFoundException } from '@nestjs/common';
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
