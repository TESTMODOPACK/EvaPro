import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemChangelog, ChangelogType } from './entities/system-changelog.entity';
import { CreateChangelogDto, UpdateChangelogDto } from './dto/changelog.dto';

@Injectable()
export class SystemService {
  constructor(
    @InjectRepository(SystemChangelog)
    private readonly changelogRepo: Repository<SystemChangelog>,
  ) {}

  async getChangelog(limit = 5): Promise<SystemChangelog[]> {
    return this.changelogRepo.find({
      where: { isActive: true },
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  async getAllChangelog(): Promise<SystemChangelog[]> {
    return this.changelogRepo.find({ order: { publishedAt: 'DESC' } });
  }

  async createChangelog(dto: CreateChangelogDto): Promise<SystemChangelog> {
    return this.changelogRepo.save(this.changelogRepo.create({
      version: dto.version,
      title: dto.title,
      description: dto.description,
      type: dto.type || ChangelogType.FEATURE,
      isActive: true,
      publishedAt: new Date(),
    }));
  }

  async updateChangelog(id: string, dto: UpdateChangelogDto): Promise<SystemChangelog> {
    const entry = await this.changelogRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada de changelog no encontrada');
    // Explicit field assignment to prevent mass-assignment
    if (dto.version !== undefined) entry.version = dto.version;
    if (dto.title !== undefined) entry.title = dto.title;
    if (dto.description !== undefined) entry.description = dto.description;
    if (dto.type !== undefined) entry.type = dto.type;
    if (dto.isActive !== undefined) entry.isActive = dto.isActive;
    return this.changelogRepo.save(entry);
  }

  async deleteChangelog(id: string): Promise<void> {
    const entry = await this.changelogRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada de changelog no encontrada');
    await this.changelogRepo.remove(entry);
  }
}
