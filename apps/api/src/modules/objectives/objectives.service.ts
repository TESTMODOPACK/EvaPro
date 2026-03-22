import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Objective, ObjectiveStatus } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';

@Injectable()
export class ObjectivesService {
  constructor(
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(ObjectiveUpdate)
    private readonly updateRepo: Repository<ObjectiveUpdate>,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateObjectiveDto): Promise<Objective> {
    const obj = this.objectiveRepo.create({
      tenantId,
      userId,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      cycleId: dto.cycleId,
      status: ObjectiveStatus.DRAFT,
      progress: 0,
    });
    return this.objectiveRepo.save(obj);
  }

  async findByUser(tenantId: string, userId: string): Promise<Objective[]> {
    return this.objectiveRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.objectiveRepo.findOne({ where: { id, tenantId } });
    if (!obj) throw new NotFoundException('Objetivo no encontrado');
    return obj;
  }

  async update(tenantId: string, id: string, dto: UpdateObjectiveDto): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (dto.title !== undefined) obj.title = dto.title;
    if (dto.description !== undefined) obj.description = dto.description;
    if (dto.type !== undefined) obj.type = dto.type;
    if (dto.status !== undefined) obj.status = dto.status;
    if (dto.targetDate !== undefined) obj.targetDate = new Date(dto.targetDate);
    if (dto.progress !== undefined) obj.progress = dto.progress;
    return this.objectiveRepo.save(obj);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const obj = await this.findById(tenantId, id);
    obj.status = ObjectiveStatus.ABANDONED;
    await this.objectiveRepo.save(obj);
  }

  async addProgressUpdate(
    tenantId: string,
    userId: string,
    objectiveId: string,
    dto: CreateObjectiveUpdateDto,
  ): Promise<ObjectiveUpdate> {
    const obj = await this.findById(tenantId, objectiveId);
    obj.progress = dto.progressValue;
    if (dto.progressValue >= 100) {
      obj.status = ObjectiveStatus.COMPLETED;
    } else if (obj.status === ObjectiveStatus.DRAFT) {
      obj.status = ObjectiveStatus.ACTIVE;
    }
    await this.objectiveRepo.save(obj);

    const update = this.updateRepo.create({
      tenantId,
      objectiveId,
      progressValue: dto.progressValue,
      notes: dto.notes,
      createdBy: userId,
    });
    return this.updateRepo.save(update);
  }

  async getProgressHistory(tenantId: string, objectiveId: string): Promise<ObjectiveUpdate[]> {
    return this.updateRepo.find({
      where: { tenantId, objectiveId },
      order: { createdAt: 'ASC' },
    });
  }

  async getCompletionStats(tenantId: string, userId: string) {
    const total = await this.objectiveRepo.count({ where: { tenantId, userId } });
    const completed = await this.objectiveRepo.count({
      where: { tenantId, userId, status: ObjectiveStatus.COMPLETED },
    });
    return { total, completed, inProgress: total - completed };
  }
}
