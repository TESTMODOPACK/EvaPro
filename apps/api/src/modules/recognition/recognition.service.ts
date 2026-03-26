import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recognition } from './entities/recognition.entity';
import { Badge } from './entities/badge.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserPoints, PointsSource } from './entities/user-points.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class RecognitionService {
  constructor(
    @InjectRepository(Recognition) private readonly recogRepo: Repository<Recognition>,
    @InjectRepository(Badge) private readonly badgeRepo: Repository<Badge>,
    @InjectRepository(UserBadge) private readonly userBadgeRepo: Repository<UserBadge>,
    @InjectRepository(UserPoints) private readonly pointsRepo: Repository<UserPoints>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Recognition Wall (Social Feed) ─────────────────────────────────

  async getWall(tenantId: string, page = 1, limit = 20) {
    const [items, total] = await this.recogRepo.findAndCount({
      where: { tenantId, isPublic: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['fromUser', 'toUser', 'value'],
    });
    return {
      data: items.map((r) => ({
        id: r.id,
        fromUser: { id: r.fromUser.id, firstName: r.fromUser.firstName, lastName: r.fromUser.lastName, position: r.fromUser.position, department: r.fromUser.department },
        toUser: { id: r.toUser.id, firstName: r.toUser.firstName, lastName: r.toUser.lastName, position: r.toUser.position, department: r.toUser.department },
        message: r.message,
        value: r.value ? { id: r.value.id, name: r.value.name, category: r.value.category } : null,
        points: r.points,
        reactions: r.reactions,
        createdAt: r.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createRecognition(tenantId: string, fromUserId: string, dto: {
    toUserId: string; message: string; valueId?: string; points?: number;
  }) {
    if (fromUserId === dto.toUserId) {
      throw new BadRequestException('No puedes enviarte reconocimiento a ti mismo');
    }
    const toUser = await this.userRepo.findOne({ where: { id: dto.toUserId, tenantId } });
    if (!toUser) throw new NotFoundException('Usuario receptor no encontrado');

    const recognition = await this.recogRepo.save(this.recogRepo.create({
      tenantId,
      fromUserId,
      toUserId: dto.toUserId,
      message: dto.message,
      valueId: dto.valueId || null,
      points: dto.points || 10,
      isPublic: true,
    }));

    // Award points to receiver
    await this.addPoints(tenantId, dto.toUserId, recognition.points, PointsSource.RECOGNITION_RECEIVED,
      `Reconocimiento recibido`, recognition.id);
    // Award small points to sender for participation
    await this.addPoints(tenantId, fromUserId, 2, PointsSource.RECOGNITION_SENT,
      `Reconocimiento enviado`, recognition.id);

    // Check auto-badges for receiver
    await this.checkAutoBadges(tenantId, dto.toUserId);

    // Notify receiver
    await this.notificationsService.create({
      tenantId, userId: dto.toUserId, type: NotificationType.FEEDBACK_RECEIVED,
      title: 'Has recibido un reconocimiento',
      message: `Un compañero te ha reconocido: "${dto.message.substring(0, 80)}..."`,
      metadata: { recognitionId: recognition.id },
    });

    return this.recogRepo.findOne({ where: { id: recognition.id }, relations: ['fromUser', 'toUser', 'value'] });
  }

  async addReaction(tenantId: string, recognitionId: string, emoji: string) {
    const recog = await this.recogRepo.findOne({ where: { id: recognitionId, tenantId } });
    if (!recog) throw new NotFoundException('Reconocimiento no encontrado');
    const reactions = recog.reactions || {};
    reactions[emoji] = (reactions[emoji] || 0) + 1;
    recog.reactions = reactions;
    return this.recogRepo.save(recog);
  }

  // ─── Badges ─────────────────────────────────────────────────────────

  async getBadges(tenantId: string) {
    return this.badgeRepo.find({ where: { tenantId, isActive: true }, order: { name: 'ASC' } });
  }

  async createBadge(tenantId: string, dto: {
    name: string; description?: string; icon?: string; color?: string; criteria?: any; pointsReward?: number;
  }) {
    return this.badgeRepo.save(this.badgeRepo.create({
      tenantId, name: dto.name, description: dto.description || null,
      icon: dto.icon || 'star', color: dto.color || '#6366f1',
      criteria: dto.criteria || null, pointsReward: dto.pointsReward || 50,
    }));
  }

  async getUserBadges(tenantId: string, userId: string) {
    return this.userBadgeRepo.find({
      where: { tenantId, userId },
      relations: ['badge'],
      order: { earnedAt: 'DESC' },
    });
  }

  async awardBadge(tenantId: string, userId: string, badgeId: string, awardedBy?: string) {
    const existing = await this.userBadgeRepo.findOne({ where: { userId, badgeId } });
    if (existing) return existing; // Already has this badge

    const badge = await this.badgeRepo.findOne({ where: { id: badgeId, tenantId } });
    if (!badge) throw new NotFoundException('Badge no encontrado');

    const ub = await this.userBadgeRepo.save(this.userBadgeRepo.create({
      tenantId, userId, badgeId, awardedBy: awardedBy || null,
    }));

    // Award points for earning badge
    if (badge.pointsReward > 0) {
      await this.addPoints(tenantId, userId, badge.pointsReward, PointsSource.BADGE_EARNED,
        `Badge obtenido: ${badge.name}`, ub.id);
    }

    // Notify user
    await this.notificationsService.create({
      tenantId, userId, type: NotificationType.GENERAL,
      title: `Has obtenido el badge "${badge.name}"`,
      message: badge.description || `Felicitaciones por obtener el badge ${badge.name}`,
      metadata: { badgeId, userBadgeId: ub.id },
    });

    return ub;
  }

  /** Check if user qualifies for any auto-awarded badges */
  private async checkAutoBadges(tenantId: string, userId: string) {
    const badges = await this.badgeRepo.find({ where: { tenantId, isActive: true } });
    for (const badge of badges) {
      if (!badge.criteria) continue;
      const { type, threshold } = badge.criteria;
      let count = 0;

      if (type === 'recognitions_received') {
        count = await this.recogRepo.count({ where: { tenantId, toUserId: userId } });
      } else if (type === 'recognitions_sent') {
        count = await this.recogRepo.count({ where: { tenantId, fromUserId: userId } });
      } else if (type === 'total_points') {
        const result = await this.pointsRepo.createQueryBuilder('p')
          .where('p.tenant_id = :tenantId', { tenantId })
          .andWhere('p.user_id = :userId', { userId })
          .select('COALESCE(SUM(p.points), 0)', 'total')
          .getRawOne();
        count = parseInt(result.total);
      }

      if (count >= threshold) {
        await this.awardBadge(tenantId, userId, badge.id);
      }
    }
  }

  // ─── Points & Leaderboard ──────────────────────────────────────────

  async addPoints(tenantId: string, userId: string, points: number, source: PointsSource,
    description?: string, referenceId?: string) {
    return this.pointsRepo.save(this.pointsRepo.create({
      tenantId, userId, points, source, description: description || null, referenceId: referenceId || null,
    }));
  }

  async getUserPoints(tenantId: string, userId: string) {
    const result = await this.pointsRepo.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.user_id = :userId', { userId })
      .select('COALESCE(SUM(p.points), 0)', 'total')
      .getRawOne();
    return { userId, totalPoints: parseInt(result.total) };
  }

  async getLeaderboard(tenantId: string, period?: 'week' | 'month' | 'quarter' | 'all', limit = 20) {
    const qb = this.pointsRepo.createQueryBuilder('p')
      .innerJoin(User, 'u', 'u.id = p.user_id')
      .where('p.tenant_id = :tenantId', { tenantId })
      .select('p.user_id', 'userId')
      .addSelect("u.first_name || ' ' || u.last_name", 'userName')
      .addSelect('u.department', 'department')
      .addSelect('u.position', 'position')
      .addSelect('SUM(p.points)', 'totalPoints')
      .addSelect('COUNT(p.id)', 'transactions')
      .groupBy('p.user_id')
      .addGroupBy('u.first_name')
      .addGroupBy('u.last_name')
      .addGroupBy('u.department')
      .addGroupBy('u.position')
      .orderBy('SUM(p.points)', 'DESC')
      .limit(limit);

    if (period && period !== 'all') {
      const cutoff = new Date();
      if (period === 'week') cutoff.setDate(cutoff.getDate() - 7);
      else if (period === 'month') cutoff.setMonth(cutoff.getMonth() - 1);
      else if (period === 'quarter') cutoff.setMonth(cutoff.getMonth() - 3);
      qb.andWhere('p.created_at >= :cutoff', { cutoff });
    }

    const rows = await qb.getRawMany();
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      userName: r.userName,
      department: r.department,
      position: r.position,
      totalPoints: parseInt(r.totalPoints),
      transactions: parseInt(r.transactions),
    }));
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const totalRecognitions = await this.recogRepo.count({ where: { tenantId } });
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const monthlyRecognitions = await this.recogRepo.createQueryBuilder('r')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.created_at >= :start', { start: thisMonth })
      .getCount();

    const topValues = await this.recogRepo.createQueryBuilder('r')
      .innerJoin('r.value', 'v')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.value_id IS NOT NULL')
      .select('v.name', 'valueName')
      .addSelect('COUNT(r.id)', 'count')
      .groupBy('v.name')
      .orderBy('COUNT(r.id)', 'DESC')
      .limit(5)
      .getRawMany();

    const totalBadgesEarned = await this.userBadgeRepo.count({ where: { tenantId } });

    return { totalRecognitions, monthlyRecognitions, topValues, totalBadgesEarned };
  }
}
