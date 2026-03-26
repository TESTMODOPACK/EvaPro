import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemChangelog, ChangelogType } from './entities/system-changelog.entity';

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

  async createChangelog(dto: {
    version: string; title: string; description: string; type?: ChangelogType;
  }): Promise<SystemChangelog> {
    return this.changelogRepo.save(this.changelogRepo.create({
      version: dto.version,
      title: dto.title,
      description: dto.description,
      type: dto.type || ChangelogType.FEATURE,
      isActive: true,
      publishedAt: new Date(),
    }));
  }

  async updateChangelog(id: string, dto: Partial<{
    version: string; title: string; description: string; type: ChangelogType; isActive: boolean;
  }>): Promise<SystemChangelog> {
    const entry = await this.changelogRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada de changelog no encontrada');
    Object.assign(entry, dto);
    return this.changelogRepo.save(entry);
  }

  async deleteChangelog(id: string): Promise<void> {
    const entry = await this.changelogRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada de changelog no encontrada');
    await this.changelogRepo.remove(entry);
  }
}
