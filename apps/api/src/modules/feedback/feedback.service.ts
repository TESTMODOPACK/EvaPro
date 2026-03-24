import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckIn, CheckInStatus } from './entities/checkin.entity';
import { QuickFeedback, Sentiment } from './entities/quick-feedback.entity';
import { CreateCheckInDto, UpdateCheckInDto } from './dto/create-checkin.dto';
import { CreateQuickFeedbackDto } from './dto/create-quick-feedback.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(CheckIn)
    private readonly checkInRepo: Repository<CheckIn>,
    @InjectRepository(QuickFeedback)
    private readonly quickFeedbackRepo: Repository<QuickFeedback>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Check-ins ────────────────────────────────────────────────────────────

  async createCheckIn(tenantId: string, managerId: string, role: string, dto: CreateCheckInDto): Promise<CheckIn> {
    // Managers can only create check-ins with their direct reports
    // Admins (super_admin, tenant_admin) are exempt from this restriction
    if (role === 'manager') {
      const employee = await this.userRepo.findOne({
        where: { id: dto.employeeId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!employee) {
        throw new NotFoundException('Colaborador no encontrado');
      }
      if (employee.managerId !== managerId) {
        throw new ForbiddenException(
          'Solo puedes crear check-ins con tus reportes directos',
        );
      }
    }

    const ci = this.checkInRepo.create({
      tenantId,
      managerId,
      employeeId: dto.employeeId,
      scheduledDate: new Date(dto.scheduledDate),
      topic: dto.topic,
      notes: dto.notes,
      actionItems: [],
      status: CheckInStatus.SCHEDULED,
    });
    return this.checkInRepo.save(ci);
  }

  async updateCheckIn(tenantId: string, id: string, dto: UpdateCheckInDto): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    if (dto.topic !== undefined) ci.topic = dto.topic;
    if (dto.notes !== undefined) ci.notes = dto.notes;
    if (dto.actionItems !== undefined) ci.actionItems = dto.actionItems;
    return this.checkInRepo.save(ci);
  }

  async completeCheckIn(tenantId: string, id: string): Promise<CheckIn> {
    const ci = await this.checkInRepo.findOne({ where: { id, tenantId } });
    if (!ci) throw new NotFoundException('Check-in no encontrado');
    ci.status = CheckInStatus.COMPLETED;
    ci.completedAt = new Date();
    return this.checkInRepo.save(ci);
  }

  async findCheckIns(tenantId: string, userId: string, role: string): Promise<CheckIn[]> {
    const where = role === 'manager' || role === 'tenant_admin'
      ? [{ tenantId, managerId: userId }, { tenantId, employeeId: userId }]
      : [{ tenantId, employeeId: userId }];
    return this.checkInRepo.find({
      where,
      relations: ['manager', 'employee'],
      order: { scheduledDate: 'DESC' },
    });
  }

  // ─── Quick Feedback ───────────────────────────────────────────────────────

  async createQuickFeedback(tenantId: string, fromUserId: string, dto: CreateQuickFeedbackDto): Promise<QuickFeedback> {
    const qf = this.quickFeedbackRepo.create({
      tenantId,
      fromUserId,
      toUserId: dto.toUserId,
      message: dto.message,
      sentiment: dto.sentiment,
      category: dto.category,
      isAnonymous: dto.isAnonymous ?? false,
      visibility: dto.visibility,
    });
    return this.quickFeedbackRepo.save(qf);
  }

  async findFeedbackReceived(tenantId: string, userId: string): Promise<QuickFeedback[]> {
    return this.quickFeedbackRepo.find({
      where: { tenantId, toUserId: userId },
      relations: ['fromUser'],
      order: { createdAt: 'DESC' },
    });
  }

  async findFeedbackGiven(tenantId: string, userId: string): Promise<QuickFeedback[]> {
    return this.quickFeedbackRepo.find({
      where: { tenantId, fromUserId: userId },
      relations: ['toUser'],
      order: { createdAt: 'DESC' },
    });
  }

  async getFeedbackSummary(tenantId: string, userId: string) {
    const received = await this.quickFeedbackRepo.find({
      where: { tenantId, toUserId: userId },
      select: ['sentiment'],
    });
    const positive = received.filter((f) => f.sentiment === Sentiment.POSITIVE).length;
    const neutral = received.filter((f) => f.sentiment === Sentiment.NEUTRAL).length;
    const constructive = received.filter((f) => f.sentiment === Sentiment.CONSTRUCTIVE).length;
    return { positive, neutral, constructive, total: received.length };
  }
}
