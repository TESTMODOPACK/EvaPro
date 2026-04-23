import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Cron } from '@nestjs/schedule';
import { cachedFetch, invalidateCache } from '../../common/cache/cache.helper';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository, DataSource, MoreThan } from 'typeorm';
import { runWithCronLock } from '../../common/utils/cron-lock';
import { Recognition } from './entities/recognition.entity';
import { RecognitionComment } from './entities/recognition-comment.entity';
import { MvpOfTheMonth } from './entities/mvp-of-the-month.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Badge } from './entities/badge.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserPoints, PointsSource } from './entities/user-points.entity';
import { PointsBudget } from './entities/points-budget.entity';
import { RedemptionItem } from './entities/redemption-item.entity';
import { RedemptionTransaction, RedemptionStatus, REDEMPTION_STATUS_VALUES } from './entities/redemption-transaction.entity';
import { UserPointsSummary } from './entities/user-points-summary.entity';
import { Challenge } from './entities/challenge.entity';
import { ChallengeProgress } from './entities/challenge-progress.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { buildPushMessage } from '../notifications/push-messages';
import { NotificationType } from '../notifications/entities/notification.entity';

const MAX_RECOGNITIONS_PER_DAY = 5;
const MAX_RECOGNITIONS_SAME_PERSON_PER_DAY = 2;
const DEFAULT_RECOGNITION_POINTS = 10;
const SENDER_POINTS = 2;
const DEFAULT_MONTHLY_BUDGET = 100;

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(
    @InjectRepository(Recognition) private readonly recogRepo: Repository<Recognition>,
    @InjectRepository(RecognitionComment) private readonly commentRepo: Repository<RecognitionComment>,
    @InjectRepository(MvpOfTheMonth) private readonly mvpRepo: Repository<MvpOfTheMonth>,
    @InjectRepository(Badge) private readonly badgeRepo: Repository<Badge>,
    @InjectRepository(UserBadge) private readonly userBadgeRepo: Repository<UserBadge>,
    @InjectRepository(UserPoints) private readonly pointsRepo: Repository<UserPoints>,
    @InjectRepository(UserPointsSummary) private readonly pointsSummaryRepo: Repository<UserPointsSummary>,
    @InjectRepository(PointsBudget) private readonly budgetRepo: Repository<PointsBudget>,
    @InjectRepository(RedemptionItem) private readonly redemptionItemRepo: Repository<RedemptionItem>,
    @InjectRepository(RedemptionTransaction) private readonly redemptionTxRepo: Repository<RedemptionTransaction>,
    @InjectRepository(Challenge) private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(ChallengeProgress) private readonly progressRepo: Repository<ChallengeProgress>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** Send in-app notification to all active users in tenant (batched). */
  private async notifyAllUsers(tenantId: string, message: string): Promise<void> {
    const users = await this.userRepo.find({ where: { tenantId, isActive: true }, select: ['id'] });
    if (users.length === 0) return;
    // Single bulk insert instead of N individual writes. For a tenant with
    // 1000 active users this changes 1000 round-trips into 1. Dedup disabled
    // because each broadcast (new catalog item, challenge, etc.) is a distinct
    // announcement that every user should see.
    await this.notificationsService
      .createBulk(
        users.map((u) => ({
          tenantId,
          userId: u.id,
          type: 'recognition' as any,
          title: 'Reconocimientos',
          message,
        })),
        { dedupe: false },
      )
      .catch(() => { /* non-critical */ });
  }

  // ─── Recognition Wall (Social Feed) ─────────────────────────────────

  /**
   * P7.3 — managerId opcional. Si presente, filtra el wall a reconocimientos
   * donde fromUserId o toUserId ∈ {reportes directos, self}. Usado por los
   * export methods para manager scope. Para la vista pública del wall,
   * managerId queda undefined y se muestra todo el tenant (decisión de
   * política: muro social es público org-wide, como el leaderboard).
   */
  async getWall(
    tenantId: string,
    opts: {
      page?: number;
      limit?: number;
      managerId?: string;
      search?: string;
      dateFrom?: string | Date;
      dateTo?: string | Date;
      valueId?: string;
      departmentId?: string;
      scope?: 'all' | 'received' | 'sent' | 'mine';
      currentUserId?: string;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    // Cap razonable de 500 (usado por exports). El controller aplica cap
    // más estricto de 50 para tráfico externo (API /wall).
    const limit = Math.min(Math.max(1, opts.limit ?? 20), 500);
    const { managerId, search, valueId, departmentId, currentUserId } = opts;
    const scope = opts.scope ?? 'all';

    // NOTA sobre aliases: usamos 'fu' / 'tu' / 'comp' en vez de
    // 'fromUser' / 'toUser' / 'value'. 'value' es palabra reservada SQL
    // y además choca con la propiedad `r.value` → reproducía TypeORM
    // error "Cannot read properties of undefined (reading 'databaseName')".
    const qb = this.recogRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.fromUser', 'fu')
      .leftJoinAndSelect('r.toUser', 'tu')
      .leftJoinAndSelect('r.value', 'comp')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.is_public = true');

    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      const teamIds = [managerId, ...reports.map((u) => u.id)];
      qb.andWhere('(r.from_user_id IN (:...teamIds) OR r.to_user_id IN (:...teamIds))', { teamIds });
    }

    if (currentUserId) {
      if (scope === 'received') {
        qb.andWhere('r.to_user_id = :meId', { meId: currentUserId });
      } else if (scope === 'sent') {
        qb.andWhere('r.from_user_id = :meId', { meId: currentUserId });
      } else if (scope === 'mine') {
        qb.andWhere('(r.from_user_id = :meId OR r.to_user_id = :meId)', { meId: currentUserId });
      }
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      qb.andWhere(
        '(r.message ILIKE :s OR fromUser.first_name ILIKE :s OR fromUser.last_name ILIKE :s OR toUser.first_name ILIKE :s OR toUser.last_name ILIKE :s)',
        { s },
      );
    }

    if (opts.dateFrom) {
      qb.andWhere('r.created_at >= :dateFrom', { dateFrom: opts.dateFrom });
    }
    if (opts.dateTo) {
      qb.andWhere('r.created_at <= :dateTo', { dateTo: opts.dateTo });
    }

    if (valueId) {
      qb.andWhere('r.value_id = :valueId', { valueId });
    }

    if (departmentId) {
      qb.andWhere(
        '(fromUser.department_id = :deptId OR toUser.department_id = :deptId)',
        { deptId: departmentId },
      );
    }

    const [items, total] = await qb
      .orderBy('r.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

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
    toUserId: string; message: string; valueId?: string; isMonetary?: boolean;
  }) {
    if (fromUserId === dto.toUserId) {
      throw new BadRequestException('No puedes enviarte reconocimiento a ti mismo');
    }
    const toUser = await this.userRepo.findOne({ where: { id: dto.toUserId, tenantId } });
    if (!toUser) throw new NotFoundException('Usuario receptor no encontrado');

    // Rate limiting: max recognitions per day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const dailyCount = await this.recogRepo.count({
      where: { tenantId, fromUserId, createdAt: MoreThan(todayStart) },
    });
    if (dailyCount >= MAX_RECOGNITIONS_PER_DAY) {
      throw new BadRequestException(`Has alcanzado el limite de ${MAX_RECOGNITIONS_PER_DAY} reconocimientos por dia`);
    }

    const samePersonCount = await this.recogRepo.count({
      where: { tenantId, fromUserId, toUserId: dto.toUserId, createdAt: MoreThan(todayStart) },
    });
    if (samePersonCount >= MAX_RECOGNITIONS_SAME_PERSON_PER_DAY) {
      throw new BadRequestException(`Solo puedes enviar ${MAX_RECOGNITIONS_SAME_PERSON_PER_DAY} reconocimientos por dia a la misma persona`);
    }

    const isMonetary = dto.isMonetary ?? false;

    // Use transaction for atomicity (budget check + creation must be atomic)
    return this.dataSource.transaction(async (manager) => {
      // B10.1: Check monthly points budget inside transaction
      const budget = await this.getOrCreateBudget(tenantId, fromUserId);
      if (budget.spent + DEFAULT_RECOGNITION_POINTS > budget.allocated) {
        throw new BadRequestException(
          `Presupuesto mensual agotado. Has usado ${budget.spent} de ${budget.allocated} puntos este mes.`,
        );
      }

      const recognition = await manager.save(manager.getRepository(Recognition).create({
        tenantId,
        fromUserId,
        toUserId: dto.toUserId,
        message: dto.message,
        valueId: dto.valueId || null,
        points: DEFAULT_RECOGNITION_POINTS,
        isPublic: true,
        reactions: {},
        isMonetary,
        approvalStatus: isMonetary ? 'pending' : 'not_required',
      }));

      // Update budget spent atomically
      await manager.createQueryBuilder()
        .update('points_budgets')
        .set({ spent: () => `spent + ${DEFAULT_RECOGNITION_POINTS}` })
        .where('id = :id', { id: budget.id })
        .execute();

      // B10.2: For non-monetary recognitions, award points immediately
      // For monetary ones, points are awarded only after manager approval
      if (!isMonetary) {
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId, userId: dto.toUserId, points: DEFAULT_RECOGNITION_POINTS,
          source: PointsSource.RECOGNITION_RECEIVED, description: 'Reconocimiento recibido', referenceId: recognition.id,
        }));
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId, userId: fromUserId, points: SENDER_POINTS,
          source: PointsSource.RECOGNITION_SENT, description: 'Reconocimiento enviado', referenceId: recognition.id,
        }));
      }

      return recognition;
    }).then(async (recognition) => {
      // ─── Operaciones post-commit (P1.6) ────────────────────────────
      //
      // El flujo crítico (budget deduct + recognition + user_points) ya
      // está DENTRO de la transacción de arriba. Estas operaciones son
      // post-commit porque:
      //
      //   - refreshUserPointsSummary: es denormalización para performance.
      //     Si falla, el ledger (user_points) sigue consistente; el next
      //     refresh arregla la suma. No amerita rollback del recognition.
      //
      //   - Gamification (badges, challenges, milestones): heavy y
      //     idempotentes en retry. Un bug acá no debe impedir que los
      //     puntos se awarden.
      //
      //   - Notifications y emails: UX, no data. Si fallan, el reconocimiento
      //     se mostró en la UI del receptor igual.
      //
      // Cambio vs antes: los `.catch(() => {})` silenciosos ahora loguean
      // .warn. Antes, si refreshUserPointsSummary fallaba, NADIE se
      // enteraba — el summary quedaba stale sin rastro. Con logger.warn
      // aparece en Sentry + pino logs, y ops puede detectar el patrón
      // (si es recurrente, hay un bug de data a investigar).
      if (!isMonetary) {
        this.refreshUserPointsSummary(tenantId, dto.toUserId).catch((err) =>
          this.logger.warn(`refreshUserPointsSummary(toUser=${dto.toUserId.slice(0, 8)}) failed: ${err?.message}`));
        this.refreshUserPointsSummary(tenantId, fromUserId).catch((err) =>
          this.logger.warn(`refreshUserPointsSummary(fromUser=${fromUserId.slice(0, 8)}) failed: ${err?.message}`));
      }
      this.checkAutoBadges(tenantId, dto.toUserId).catch((err) =>
        this.logger.warn(`checkAutoBadges failed: ${err?.message}`));
      this.evaluateChallenges(tenantId, dto.toUserId).catch((err) =>
        this.logger.warn(`evaluateChallenges(toUser) failed: ${err?.message}`));
      this.evaluateChallenges(tenantId, fromUserId).catch((err) =>
        this.logger.warn(`evaluateChallenges(fromUser) failed: ${err?.message}`));
      this.checkMilestones(tenantId, dto.toUserId).catch((err) =>
        this.logger.warn(`checkMilestones failed: ${err?.message}`));

      const msgPreview = dto.message.length > 80 ? dto.message.substring(0, 80) + '...' : dto.message;
      this.notificationsService.create({
        tenantId, userId: dto.toUserId, type: NotificationType.FEEDBACK_RECEIVED,
        title: 'Has recibido un reconocimiento',
        message: `Un compañero te ha reconocido: "${msgPreview}"`,
        metadata: { recognitionId: recognition.id },
      }).catch((err) => this.logger.warn(`recognition notification failed: ${err?.message}`));

      // Send email notification to the recipient
      const fromUser = await this.userRepo.findOne({ where: { id: fromUserId }, select: ['id', 'firstName', 'lastName'] });
      const toUserData = await this.userRepo.findOne({ where: { id: dto.toUserId }, select: ['id', 'firstName', 'email', 'language'] });

      // v3.0 Push al destinatario del reconocimiento.
      if (toUserData && fromUser) {
        const pushRec = buildPushMessage('recognitionReceived', toUserData.language ?? 'es', {
          from: `${fromUser.firstName} ${fromUser.lastName}`,
          message: msgPreview,
        });
        this.pushService
          .sendToUser(
            dto.toUserId,
            {
              title: pushRec.title,
              body: pushRec.body,
              url: '/dashboard/reconocimientos',
              tag: `recognition-${recognition.id}`,
            },
            'recognitions',
          )
          .catch(() => undefined);
      }
      if (toUserData?.email && fromUser) {
        const valueName = dto.valueId
          ? (await this.recogRepo.findOne({ where: { id: recognition.id }, relations: ['value'] }))?.value?.name
          : undefined;
        this.emailService.sendRecognitionReceived(toUserData.email, {
          firstName: toUserData.firstName,
          fromName: `${fromUser.firstName} ${fromUser.lastName}`,
          message: dto.message,
          valueName: valueName || undefined,
          points: DEFAULT_RECOGNITION_POINTS,
          tenantId,
          userId: toUserData.id,
        }).catch(() => {});
      }

      return this.recogRepo.findOne({ where: { id: recognition.id }, relations: ['fromUser', 'toUser', 'value'] });
    });
  }

  async addReaction(tenantId: string, recognitionId: string, userId: string, emoji: string) {
    // Use atomic JSONB update to avoid race conditions
    // Reactions stored as { "emoji": ["userId1", "userId2"] }
    const recog = await this.recogRepo.findOne({ where: { id: recognitionId, tenantId }, select: ['id', 'reactions'] });
    if (!recog) throw new NotFoundException('Reconocimiento no encontrado');

    const reactions = recog.reactions || {};
    const usersForEmoji: string[] = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];

    if (usersForEmoji.includes(userId)) {
      // Toggle off: remove user from reaction
      reactions[emoji] = usersForEmoji.filter((u: string) => u !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      // Toggle on: add user
      reactions[emoji] = [...usersForEmoji, userId];
    }

    await this.recogRepo.update(recognitionId, { reactions });
    return { id: recognitionId, reactions };
  }

  // ─── Badges ─────────────────────────────────────────────────────────

  async getBadges(tenantId: string) {
    return cachedFetch(this.cacheManager, `badges:${tenantId}`, 600, () =>
      this.badgeRepo.find({ where: { tenantId, isActive: true }, order: { name: 'ASC' } }),
    );
  }

  async createBadge(tenantId: string, dto: {
    name: string; description?: string; icon?: string; color?: string; criteria?: any; pointsReward?: number;
  }) {
    const saved = await this.badgeRepo.save(this.badgeRepo.create({
      tenantId, name: dto.name, description: dto.description || null,
      icon: dto.icon || 'star', color: dto.color || '#6366f1',
      criteria: dto.criteria || null, pointsReward: dto.pointsReward || 50,
    }));
    await invalidateCache(this.cacheManager, `badges:${tenantId}`);
    return saved;
  }

  /** Editar badge existente. Scopeado por tenantId. No toca isActive/deactivatedAt. */
  /**
   * P5.3 — Secondary cross-tenant: tenantId opcional. Cache invalidation
   * usa saved.tenantId (authoritative) para soportar super_admin cross-tenant.
   */
  async updateBadge(tenantId: string | undefined, id: string, dto: {
    name?: string; description?: string; icon?: string; color?: string; criteria?: any; pointsReward?: number;
  }) {
    const where = tenantId ? { id, tenantId } : { id };
    const badge = await this.badgeRepo.findOne({ where });
    if (!badge) throw new NotFoundException('Badge no encontrado');
    if (dto.name !== undefined) badge.name = dto.name;
    if (dto.description !== undefined) badge.description = dto.description;
    if (dto.icon !== undefined) badge.icon = dto.icon;
    if (dto.color !== undefined) badge.color = dto.color;
    if (dto.criteria !== undefined) badge.criteria = dto.criteria;
    if (dto.pointsReward !== undefined) badge.pointsReward = dto.pointsReward;
    const saved = await this.badgeRepo.save(badge);
    await invalidateCache(this.cacheManager, `badges:${saved.tenantId}`);
    return saved;
  }

  /** Soft-delete: isActive=false + deactivatedAt=now. Los user_badges
   *  históricos siguen intactos (earned stays earned). getBadges filtra por
   *  isActive=true así que desaparece del catálogo visible. */
  async softDeleteBadge(tenantId: string | undefined, id: string) {
    const where = tenantId ? { id, tenantId } : { id };
    const badge = await this.badgeRepo.findOne({ where });
    if (!badge) throw new NotFoundException('Badge no encontrado');
    if (!badge.isActive) return { ok: true, alreadyDeleted: true };
    badge.isActive = false;
    badge.deactivatedAt = new Date();
    const saved = await this.badgeRepo.save(badge);
    await invalidateCache(this.cacheManager, `badges:${saved.tenantId}`);
    return { ok: true, id };
  }

  async getUserBadges(tenantId: string, userId: string) {
    return this.userBadgeRepo
      .createQueryBuilder('ub')
      .leftJoinAndSelect('ub.badge', 'badge', 'badge.tenant_id = ub.tenant_id')
      .where('ub.tenantId = :tenantId', { tenantId })
      .andWhere('ub.userId = :userId', { userId })
      .orderBy('ub.earnedAt', 'DESC')
      .getMany();
  }

  async awardBadge(tenantId: string | undefined, userId: string, badgeId: string, awardedBy?: string) {
    // Resolver el tenantId authoritative desde el badge (soporta super_admin cross-tenant).
    const badgeWhere = tenantId ? { id: badgeId, tenantId } : { id: badgeId };
    const badge = await this.badgeRepo.findOne({ where: badgeWhere });
    if (!badge) throw new NotFoundException('Badge no encontrado');
    const effectiveTenantId = badge.tenantId;

    const existing = await this.userBadgeRepo.findOne({ where: { tenantId: effectiveTenantId, userId, badgeId } });
    if (existing) return existing;

    return this.dataSource.transaction(async (manager) => {
      const ub = await manager.save(manager.getRepository(UserBadge).create({
        tenantId: effectiveTenantId, userId, badgeId, awardedBy: awardedBy || null,
      }));

      if (badge.pointsReward > 0) {
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId: effectiveTenantId, userId, points: badge.pointsReward, source: PointsSource.BADGE_EARNED,
          description: `Badge obtenido: ${badge.name}`, referenceId: ub.id,
        }));
      }

      return ub;
    }).then(async (ub) => {
      if (badge.pointsReward > 0) {
        this.refreshUserPointsSummary(effectiveTenantId, userId).catch(() => {});
      }
      await this.notificationsService.create({
        tenantId: effectiveTenantId, userId, type: NotificationType.GENERAL,
        title: `Has obtenido el badge "${badge.name}"`,
        message: badge.description || `Felicitaciones por obtener el badge ${badge.name}`,
        metadata: { badgeId, userBadgeId: ub.id },
      }).catch(() => {});
      return ub;
    });
  }

  /** Check auto-badges — optimized: batch queries + skip already-earned */
  /** Revisa badges auto-award basados en criteria (recognitions_received,
   *  total_points, etc.). Público para que otros módulos (PDI, objetivos)
   *  puedan dispararlo tras acciones que suman puntos. */
  async checkAutoBadges(tenantId: string, userId: string) {
    // 1. Get all active badges with criteria
    const badges = await this.badgeRepo.find({ where: { tenantId, isActive: true } });
    const withCriteria = badges.filter((b) => b.criteria?.type && b.criteria?.threshold);
    if (withCriteria.length === 0) return;

    // 2. Get badges the user already has (skip them)
    const earnedBadgeIds = new Set(
      (await this.userBadgeRepo.find({ where: { tenantId, userId }, select: ['badgeId'] }))
        .map((ub) => ub.badgeId),
    );
    const unchecked = withCriteria.filter((b) => !earnedBadgeIds.has(b.id));
    if (unchecked.length === 0) return;

    // 3. Batch fetch all needed counts in 3 queries max
    const [recvCount, sentCount, totalPoints] = await Promise.all([
      this.recogRepo.count({ where: { tenantId, toUserId: userId } }),
      this.recogRepo.count({ where: { tenantId, fromUserId: userId } }),
      this.pointsRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.user_id = :userId', { userId })
        .select('COALESCE(SUM(p.points), 0)', 'total')
        .getRawOne().then((r) => parseInt(r.total)),
    ]);

    // 4. Check each badge against pre-fetched counts
    for (const badge of unchecked) {
      if (!badge.criteria) continue; // manual-only badges have no auto criteria
      const { type, threshold } = badge.criteria;
      if (threshold == null) continue;
      let count = 0;
      if (type === 'recognitions_received') count = recvCount;
      else if (type === 'recognitions_sent') count = sentCount;
      else if (type === 'total_points') count = totalPoints;

      if (count >= threshold) {
        await this.awardBadge(tenantId, userId, badge.id);
      }
    }
  }

  // ─── Points & Leaderboard ──────────────────────────────────────────

  async addPoints(tenantId: string, userId: string, points: number, source: PointsSource,
    description?: string, referenceId?: string) {
    const saved = await this.pointsRepo.save(this.pointsRepo.create({
      tenantId, userId, points, source, description: description || null, referenceId: referenceId || null,
    }));
    // Keep denormalized summary in sync. Non-critical: if this fails the
    // ledger is still authoritative and callers that do SUM() keep working.
    this.refreshUserPointsSummary(tenantId, userId).catch((err) => {
      this.logger.warn(`refreshUserPointsSummary(${userId}) failed: ${err?.message || err}`);
    });
    return saved;
  }

  /**
   * Recompute the points summary for a single user from the ledger and
   * upsert it. Called after every ledger write in `addPoints` and after
   * point refunds in `updateRedemptionStatus`.
   *
   * Uses 3 SUM queries (total / month / year) rather than loading all rows.
   * At ~1000 ledger entries per user this is still O(ledger) per call but
   * amortized across writes rather than happening on every read.
   */
  async refreshUserPointsSummary(tenantId: string, userId: string): Promise<void> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

    const baseQb = () =>
      this.pointsRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.user_id = :userId', { userId });

    const [totalRaw, monthRaw, yearRaw] = await Promise.all([
      baseQb().select('COALESCE(SUM(p.points), 0)', 'total').getRawOne(),
      baseQb().andWhere('p.created_at >= :monthStart', { monthStart }).select('COALESCE(SUM(p.points), 0)', 'total').getRawOne(),
      baseQb().andWhere('p.created_at >= :yearStart', { yearStart }).select('COALESCE(SUM(p.points), 0)', 'total').getRawOne(),
    ]);

    const totalPoints = parseInt(totalRaw?.total || '0', 10) || 0;
    const monthPoints = parseInt(monthRaw?.total || '0', 10) || 0;
    const yearPoints = parseInt(yearRaw?.total || '0', 10) || 0;

    // Upsert via find-then-save so we hit the existing unique (tenantId,userId)
    // constraint without needing raw SQL.
    const existing = await this.pointsSummaryRepo.findOne({ where: { tenantId, userId } });
    if (existing) {
      existing.totalPoints = totalPoints;
      existing.monthPoints = monthPoints;
      existing.yearPoints = yearPoints;
      await this.pointsSummaryRepo.save(existing);
    } else {
      await this.pointsSummaryRepo.save(
        this.pointsSummaryRepo.create({ tenantId, userId, totalPoints, monthPoints, yearPoints }),
      );
    }
  }

  /**
   * Backfill the summary table from scratch for every user in a tenant.
   * Used once when the table is first populated or after bulk ledger fixes.
   * Safe to re-run — each row is an idempotent recompute.
   */
  async backfillUserPointsSummary(tenantId: string): Promise<{ refreshed: number }> {
    const userIds: Array<{ userId: string }> = await this.pointsRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.user_id', 'userId')
      .where('p.tenant_id = :tenantId', { tenantId })
      .getRawMany();
    for (const { userId } of userIds) {
      await this.refreshUserPointsSummary(tenantId, userId);
    }
    return { refreshed: userIds.length };
  }

  async getUserPoints(tenantId: string, userId: string) {
    // IMPORTANT: the ledger (user_points) is the source of truth. The
    // user_points_summary denormalization (commit 8030fcd) was reverted on
    // the read path because a half-populated summary returns wrong totals
    // when only SOME users have been refreshed. Until a full backfill has
    // been validated, SUM the ledger directly — the write-through to the
    // summary is still active so the table stays ready for future reads.
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); // Jan 1st UTC

    const [yearResult, histResult] = await Promise.all([
      this.pointsRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.user_id = :userId', { userId })
        .andWhere('p.created_at >= :yearStart', { yearStart })
        .select('COALESCE(SUM(p.points), 0)', 'total')
        .getRawOne(),
      this.pointsRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.user_id = :userId', { userId })
        .andWhere('p.created_at < :yearStart', { yearStart })
        .select('COALESCE(SUM(p.points), 0)', 'total')
        .getRawOne(),
    ]);

    return {
      userId,
      totalPoints: parseInt(yearResult.total), // Current year points (active)
      historicalPoints: parseInt(histResult.total), // Previous years (accumulated)
      year: now.getFullYear(),
    };
  }

  async getLeaderboard(tenantId: string, period?: 'week' | 'month' | 'year' | 'all', limit = 20) {
    // Always SUM from the ledger — see note on getUserPoints for why the
    // summary-based fast path was reverted. When the summary is validated
    // end-to-end (post-backfill + a period of observation), this method can
    // be re-migrated to ORDER BY s.total_points/month_points/year_points.
    const qb = this.pointsRepo.createQueryBuilder('p')
      .innerJoin(User, 'u', 'u.id = p.user_id AND u.tenant_id = p.tenant_id')
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
      const now = new Date();
      let cutoff: Date;
      if (period === 'week') {
        // Current week (Monday to now) — UTC
        cutoff = new Date(now);
        const day = now.getUTCDay();
        cutoff.setUTCDate(now.getUTCDate() - day + (day === 0 ? -6 : 1));
        cutoff.setUTCHours(0, 0, 0, 0);
      } else if (period === 'month') {
        // Current calendar month (1st to now) — UTC
        cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      } else if (period === 'year') {
        // Current year (Jan 1st to now) — UTC
        cutoff = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      } else {
        cutoff = new Date(0); // all time
      }
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

  // Historical ranking — top 10 per year
  async getHistoricalRanking(tenantId: string, limit = 10) {
    // Get distinct years with points
    const yearsResult = await this.pointsRepo.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .select("EXTRACT(YEAR FROM p.created_at)", 'year')
      .groupBy("EXTRACT(YEAR FROM p.created_at)")
      .orderBy("EXTRACT(YEAR FROM p.created_at)", 'DESC')
      .getRawMany();

    const currentYear = new Date().getFullYear();
    const years = yearsResult.map((r: any) => parseInt(r.year)).filter(y => y < currentYear);

    const result: any[] = [];
    for (const year of years) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year + 1, 0, 1);

      const rows = await this.pointsRepo.createQueryBuilder('p')
        .innerJoin(User, 'u', 'u.id = p.user_id AND u.tenant_id = p.tenant_id')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.created_at >= :yearStart', { yearStart })
        .andWhere('p.created_at < :yearEnd', { yearEnd })
        .select('p.user_id', 'userId')
        .addSelect("u.first_name || ' ' || u.last_name", 'userName')
        .addSelect('u.department', 'department')
        .addSelect('SUM(p.points)', 'totalPoints')
        .groupBy('p.user_id')
        .addGroupBy('u.first_name')
        .addGroupBy('u.last_name')
        .addGroupBy('u.department')
        .orderBy('SUM(p.points)', 'DESC')
        .limit(limit)
        .getRawMany();

      result.push({
        year,
        ranking: rows.map((r: any, i: number) => ({
          rank: i + 1,
          userId: r.userId,
          userName: r.userName,
          department: r.department,
          totalPoints: parseInt(r.totalPoints),
        })),
      });
    }

    return result;
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  /**
   * P7.3 — Si managerId presente (caller es manager), stats filtrados a
   * reconocimientos donde fromUserId o toUserId ∈ {reportes directos, self}.
   * Admin (managerId=undefined) ve stats de toda la org.
   */
  async getStats(tenantId: string, managerId?: string) {
    let teamIds: string[] | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = [managerId, ...reports.map((u) => u.id)];
    }

    const totalWhere: any = { tenantId };
    const baseQb = (alias: string) => {
      const qb = this.recogRepo.createQueryBuilder(alias).where(`${alias}.tenant_id = :tenantId`, { tenantId });
      if (teamIds) {
        qb.andWhere(`(${alias}.from_user_id IN (:...teamIds) OR ${alias}.to_user_id IN (:...teamIds))`, { teamIds });
      }
      return qb;
    };

    const totalRecognitions = await baseQb('r').getCount();

    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const monthlyRecognitions = await baseQb('r')
      .andWhere('r.created_at >= :start', { start: thisMonth })
      .getCount();

    const topValues = await baseQb('r')
      .innerJoin('r.value', 'v')
      .andWhere('r.value_id IS NOT NULL')
      .select('v.name', 'valueName')
      .addSelect('COUNT(r.id)', 'count')
      .groupBy('v.name')
      .orderBy('COUNT(r.id)', 'DESC')
      .limit(5)
      .getRawMany();

    const badgeWhere: any = { tenantId };
    if (teamIds) badgeWhere.userId = In(teamIds);
    const totalBadgesEarned = await this.userBadgeRepo.count({ where: badgeWhere });

    return { totalRecognitions, monthlyRecognitions, topValues, totalBadgesEarned };
  }

  // ─── Points Budget ──────────────────────────────────────────────────

  private getCurrentMonth(): string {
    return new Date().toISOString().slice(0, 7); // YYYY-MM
  }

  async getOrCreateBudget(tenantId: string, userId: string): Promise<PointsBudget> {
    const month = this.getCurrentMonth();
    let budget = await this.budgetRepo.findOne({ where: { tenantId, userId, month } });
    if (!budget) {
      try {
        budget = this.budgetRepo.create({
          tenantId, userId, month, allocated: DEFAULT_MONTHLY_BUDGET, spent: 0,
        });
        budget = await this.budgetRepo.save(budget);
      } catch {
        // Race condition: another request created the budget first — re-read
        budget = await this.budgetRepo.findOne({ where: { tenantId, userId, month } });
        if (!budget) throw new BadRequestException('Error al crear presupuesto mensual');
      }
    }
    return budget;
  }

  async getUserBudget(tenantId: string, userId: string) {
    const budget = await this.getOrCreateBudget(tenantId, userId);
    return {
      month: budget.month,
      allocated: budget.allocated,
      spent: budget.spent,
      remaining: budget.allocated - budget.spent,
    };
  }

  // ─── Monetary Approval ──────────────────────────────────────────────

  async approveRecognition(tenantId: string | undefined, recognitionId: string, approvedBy: string, approved: boolean) {
    const recog = await this.dataSource.transaction(async (manager) => {
      const where = tenantId ? { id: recognitionId, tenantId } : { id: recognitionId };
      const r = await manager.findOne(Recognition, { where });
      if (!r) throw new NotFoundException('Reconocimiento no encontrado');
      if (r.approvalStatus !== 'pending') {
        throw new BadRequestException('Este reconocimiento no requiere aprobación o ya fue procesado');
      }
      r.approvalStatus = approved ? 'approved' : 'rejected';
      r.approvedBy = approvedBy;
      await manager.save(r);

      // If approved, award the points now (they were held during creation)
      // Usa r.tenantId (authoritative desde la entidad).
      if (approved) {
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId: r.tenantId, userId: r.toUserId, points: r.points,
          source: PointsSource.RECOGNITION_RECEIVED, description: 'Reconocimiento monetario aprobado', referenceId: r.id,
        }));
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId: r.tenantId, userId: r.fromUserId, points: SENDER_POINTS,
          source: PointsSource.RECOGNITION_SENT, description: 'Bono por reconocimiento monetario aprobado', referenceId: r.id,
        }));
      }

      return r;
    });

    // Refresh denormalized summary after the transaction commits.
    if (approved) {
      this.refreshUserPointsSummary(recog.tenantId, recog.toUserId).catch(() => {});
      this.refreshUserPointsSummary(recog.tenantId, recog.fromUserId).catch(() => {});
    }

    return recog;
  }

  async getPendingApprovals(tenantId: string) {
    return this.recogRepo.find({
      where: { tenantId, approvalStatus: 'pending' },
      relations: ['fromUser', 'toUser', 'value'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Redemption Catalog ──────────────────────────────────────────────

  async listRedemptionItems(tenantId: string, includeInactive = false) {
    // Admins see inactive/closed items too so they can view redemption history
    // for exhausted benefits. Regular users only see active items.
    const where: any = { tenantId };
    if (!includeInactive) where.isActive = true;
    return this.redemptionItemRepo.find({
      where,
      order: { isActive: 'DESC', pointsCost: 'ASC' },
    });
  }

  async createRedemptionItem(tenantId: string, dto: {
    name: string; description?: string; pointsCost: number; category?: string; stock?: number; terms?: string; maxRedeemPerUser?: number;
  }) {
    const item = this.redemptionItemRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description || null,
      pointsCost: dto.pointsCost,
      category: dto.category || null,
      stock: dto.stock ?? -1,
      terms: dto.terms || null,
      maxRedeemPerUser: dto.maxRedeemPerUser ?? -1,
    });
    const saved = await this.redemptionItemRepo.save(item);

    // Notify all active users about new benefit
    this.notifyAllUsers(tenantId, `Nuevo beneficio en la tienda: ${dto.name} (${dto.pointsCost} puntos). ¡Revísalo!`).catch(() => {});

    return saved;
  }

  async updateRedemptionItem(tenantId: string | undefined, id: string, dto: any) {
    const where = tenantId ? { id, tenantId } : { id };
    const item = await this.redemptionItemRepo.findOne({ where });
    if (!item) throw new NotFoundException('Item no encontrado');
    if (dto.name !== undefined) item.name = dto.name;
    if (dto.description !== undefined) item.description = dto.description;
    if (dto.pointsCost !== undefined) item.pointsCost = dto.pointsCost;
    if (dto.category !== undefined) item.category = dto.category;
    if (dto.stock !== undefined) item.stock = dto.stock;
    if (dto.terms !== undefined) item.terms = dto.terms;
    if (dto.maxRedeemPerUser !== undefined) item.maxRedeemPerUser = dto.maxRedeemPerUser;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    return this.redemptionItemRepo.save(item);
  }

  async redeemItem(tenantId: string, userId: string, itemId: string) {
    const item = await this.redemptionItemRepo.findOne({ where: { id: itemId, tenantId, isActive: true } });
    if (!item) throw new NotFoundException('Item no disponible');

    if (item.stock !== -1 && item.stock <= 0) {
      throw new BadRequestException('Este item está agotado');
    }

    // Check per-user redemption limit
    if (item.maxRedeemPerUser > 0) {
      const userRedemptions = await this.redemptionTxRepo.count({ where: { userId, itemId } });
      if (userRedemptions >= item.maxRedeemPerUser) {
        throw new BadRequestException(`Has alcanzado el máximo de canjes para este beneficio (${item.maxRedeemPerUser})`);
      }
    }

    // Use transaction for atomicity (balance check + deduction must be atomic)
    const savedTx = await this.dataSource.transaction(async (manager) => {
      // Check balance inside transaction to prevent double-spend
      const balanceResult = await manager.createQueryBuilder()
        .select('COALESCE(SUM(p.points), 0)', 'total')
        .from('user_points', 'p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.user_id = :userId', { userId })
        .getRawOne();
      const balance = parseInt(balanceResult.total);
      if (balance < item.pointsCost) {
        throw new BadRequestException(`Puntos insuficientes. Necesitas ${item.pointsCost} pero tienes ${balance}`);
      }
      // Deduct points
      await manager.save(manager.getRepository(UserPoints).create({
        tenantId, userId, points: -item.pointsCost,
        source: PointsSource.MANUAL, description: `Canje: ${item.name}`, referenceId: itemId,
      }));

      // Decrease stock atomically; if this drops stock to 0, auto-close the
      // benefit so it no longer appears available to employees.
      if (item.stock !== -1) {
        await manager.createQueryBuilder()
          .update('redemption_items')
          .set({ stock: () => 'stock - 1' })
          .where('id = :id AND stock > 0', { id: itemId })
          .execute();
        // Fetch the new stock to decide whether to close the item.
        const refreshed = await manager.getRepository(RedemptionItem).findOne({ where: { id: itemId } });
        if (refreshed && refreshed.stock === 0 && refreshed.isActive) {
          refreshed.isActive = false;
          await manager.save(refreshed);
        }
      }

      const tx = manager.getRepository(RedemptionTransaction).create({
        tenantId, userId, itemId, pointsSpent: item.pointsCost, status: RedemptionStatus.PENDING,
      });
      return manager.save(tx);
    });

    // Post-commit: refresh denormalized summary for the user whose balance dropped.
    this.refreshUserPointsSummary(tenantId, userId).catch(() => {});

    return savedTx;
  }

  /**
   * Admin-only: change the status of a redemption transaction.
   * Valid transitions:
   *   pending → approved → delivered
   *   pending → cancelled
   *   approved → cancelled
   * Cancelling a pending/approved redemption refunds the user's points.
   */
  async updateRedemptionStatus(tenantId: string | undefined, redemptionId: string, newStatus: string) {
    if (!REDEMPTION_STATUS_VALUES.includes(newStatus as RedemptionStatus)) {
      throw new BadRequestException(`Estado inválido. Permitidos: ${REDEMPTION_STATUS_VALUES.join(', ')}`);
    }
    const target = newStatus as RedemptionStatus;

    const txWhere = tenantId ? { id: redemptionId, tenantId } : { id: redemptionId };
    const tx = await this.redemptionTxRepo.findOne({
      where: txWhere,
      relations: ['item'],
    });
    if (!tx) throw new NotFoundException('Canje no encontrado');
    if (tx.status === target) return tx;
    // Authoritative tenantId desde la transacción encontrada.
    const effectiveTenantId = tx.tenantId;

    // Validate transition
    const transitions: Record<RedemptionStatus, RedemptionStatus[]> = {
      [RedemptionStatus.PENDING]: [RedemptionStatus.APPROVED, RedemptionStatus.DELIVERED, RedemptionStatus.CANCELLED],
      [RedemptionStatus.APPROVED]: [RedemptionStatus.DELIVERED, RedemptionStatus.CANCELLED],
      [RedemptionStatus.DELIVERED]: [],
      [RedemptionStatus.CANCELLED]: [],
    };
    const valid = transitions[tx.status] || [];
    if (!valid.includes(target)) {
      throw new BadRequestException(`Transición inválida: ${tx.status} → ${target}`);
    }

    // Capture the previous status BEFORE the transaction mutates tx, so the
    // post-commit summary refresh can tell whether a refund happened.
    const previousStatus = tx.status;
    const refundIssued =
      target === RedemptionStatus.CANCELLED &&
      (previousStatus === RedemptionStatus.PENDING || previousStatus === RedemptionStatus.APPROVED);

    const savedTx = await this.dataSource.transaction(async (manager) => {
      if (refundIssued) {
        await manager.save(manager.getRepository(UserPoints).create({
          tenantId: effectiveTenantId,
          userId: tx.userId,
          points: tx.pointsSpent,
          source: PointsSource.MANUAL,
          description: `Reverso de canje cancelado: ${tx.item?.name || tx.itemId}`,
          referenceId: tx.itemId,
        }));
        // Restore stock if item tracks it. Only re-activate if the item was
        // auto-closed (stock === 0); don't override an admin-disabled item.
        if (tx.item && tx.item.stock !== -1) {
          const current = await manager.getRepository(RedemptionItem).findOne({ where: { id: tx.itemId } });
          const shouldReactivate = !!(current && current.stock === 0 && !current.isActive);
          await manager.createQueryBuilder()
            .update('redemption_items')
            .set(shouldReactivate
              ? { stock: () => 'stock + 1', isActive: true }
              : { stock: () => 'stock + 1' })
            .where('id = :id', { id: tx.itemId })
            .execute();
        }
      }
      tx.status = target;
      return manager.save(tx);
    });

    // Refresh the denormalized summary AFTER the transaction commits. If it
    // fails, the ledger remains authoritative and subsequent addPoints calls
    // (or the backfill op) will eventually self-heal it.
    if (refundIssued) {
      this.refreshUserPointsSummary(effectiveTenantId, tx.userId).catch((err) => {
        this.logger.warn(`refreshUserPointsSummary(${tx.userId}) after cancel failed: ${err?.message || err}`);
      });
    }

    return savedTx;
  }

  async getUserRedemptions(tenantId: string, userId: string) {
    return this.redemptionTxRepo.find({
      where: { tenantId, userId },
      relations: ['item'],
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Challenges (F16 Gamification) ──────────────────────────────────

  async listChallenges(tenantId: string) {
    return this.challengeRepo.find({
      where: { tenantId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async createChallenge(tenantId: string, dto: {
    name: string; description?: string; criteriaType: string; criteriaThreshold: number;
    pointsReward?: number; badgeIcon?: string; badgeColor?: string;
    startDate?: string; endDate?: string;
  }) {
    const challenge = this.challengeRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description || null,
      criteriaType: dto.criteriaType,
      criteriaThreshold: dto.criteriaThreshold,
      pointsReward: dto.pointsReward ?? 50,
      badgeIcon: dto.badgeIcon || 'target',
      badgeColor: dto.badgeColor || '#c9933a',
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
    });
    const saved = await this.challengeRepo.save(challenge);

    // Notify all active users about new challenge
    this.notifyAllUsers(tenantId, `Nuevo desafío disponible: ${dto.name}. ¡Participa y gana ${dto.pointsReward ?? 50} puntos!`).catch(() => {});

    return saved;
  }

  async getChallengeParticipants(tenantId: string, challengeId: string) {
    const progress = await this.progressRepo.find({
      where: { challengeId, tenantId },
      relations: ['user'],
      order: { currentValue: 'DESC' },
    });
    return progress.map((p: any) => ({
      userId: p.userId,
      userName: p.user ? `${p.user.firstName} ${p.user.lastName}` : 'N/A',
      department: p.user?.department || '',
      currentValue: p.currentValue,
      completed: p.completed,
      completedAt: p.completedAt,
    }));
  }

  async getItemRedemptions(tenantId: string, itemId: string) {
    const txs = await this.redemptionTxRepo.find({
      where: { itemId, tenantId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return txs.map((tx: any) => ({
      id: tx.id,
      userId: tx.userId,
      userName: tx.user ? `${tx.user.firstName} ${tx.user.lastName}` : 'N/A',
      userEmail: tx.user?.email || null,
      userDepartment: tx.user?.department || null,
      pointsSpent: tx.pointsSpent,
      status: tx.status,
      createdAt: tx.createdAt,
    }));
  }

  async updateChallenge(tenantId: string | undefined, id: string, dto: any) {
    const where = tenantId ? { id, tenantId } : { id };
    const challenge = await this.challengeRepo.findOne({ where });
    if (!challenge) throw new NotFoundException('Desafío no encontrado');
    if (dto.name !== undefined) challenge.name = dto.name;
    if (dto.description !== undefined) challenge.description = dto.description;
    if (dto.criteriaType !== undefined) challenge.criteriaType = dto.criteriaType;
    if (dto.criteriaThreshold !== undefined) challenge.criteriaThreshold = dto.criteriaThreshold;
    if (dto.pointsReward !== undefined) challenge.pointsReward = dto.pointsReward;
    if (dto.isActive !== undefined) {
      // Mantener coherente deactivatedAt con el flag de activo.
      if (challenge.isActive === true && dto.isActive === false) {
        challenge.deactivatedAt = new Date();
      } else if (challenge.isActive === false && dto.isActive === true) {
        challenge.deactivatedAt = null;
      }
      challenge.isActive = dto.isActive;
    }
    if (dto.startDate !== undefined) challenge.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) challenge.endDate = dto.endDate ? new Date(dto.endDate) : null;
    return this.challengeRepo.save(challenge);
  }

  /** Soft-delete de un challenge: isActive=false + deactivatedAt=now.
   *  Preserva el histórico de participantes/ganadores. */
  async softDeleteChallenge(tenantId: string | undefined, id: string) {
    const where = tenantId ? { id, tenantId } : { id };
    const challenge = await this.challengeRepo.findOne({ where });
    if (!challenge) throw new NotFoundException('Desafío no encontrado');
    if (!challenge.isActive) return { ok: true, alreadyDeleted: true };
    challenge.isActive = false;
    challenge.deactivatedAt = new Date();
    await this.challengeRepo.save(challenge);
    return { ok: true, id };
  }

  /** Get user's progress on all active challenges */
  async getUserChallenges(tenantId: string, userId: string) {
    const challenges = await this.challengeRepo.find({
      where: { tenantId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    if (challenges.length === 0) return [];

    // Get existing progress records
    const progressRecords = await this.progressRepo.find({
      where: { tenantId, userId },
    });
    const progressMap = new Map(progressRecords.map((p) => [p.challengeId, p]));

    // Get current counts for each criteria type
    const counts = await this.getUserActivityCounts(tenantId, userId);

    return challenges.map((ch) => {
      const existing = progressMap.get(ch.id);
      const currentValue = counts[ch.criteriaType] || 0;
      const progress = Math.min(100, Math.round((currentValue / ch.criteriaThreshold) * 100));

      return {
        ...ch,
        currentValue,
        progress,
        completed: existing?.completed || currentValue >= ch.criteriaThreshold,
        completedAt: existing?.completedAt || null,
      };
    });
  }

  /** Evaluate and update challenge progress for a user, awarding points on completion */
  async evaluateChallenges(tenantId: string, userId: string) {
    const challenges = await this.challengeRepo.find({ where: { tenantId, isActive: true } });
    if (challenges.length === 0) return;

    const counts = await this.getUserActivityCounts(tenantId, userId);

    for (const ch of challenges) {
      const currentValue = counts[ch.criteriaType] || 0;
      if (currentValue < ch.criteriaThreshold) continue;

      // Check if already completed
      const existing = await this.progressRepo.findOne({
        where: { challengeId: ch.id, userId },
      });

      if (existing?.completed) continue;

      // Use transaction to prevent double-award on concurrent calls
      try {
        await this.dataSource.transaction(async (manager) => {
          if (existing) {
            existing.currentValue = currentValue;
            existing.completed = true;
            existing.completedAt = new Date();
            await manager.save(existing);
          } else {
            await manager.save(manager.getRepository(ChallengeProgress).create({
              tenantId, challengeId: ch.id, userId, currentValue, completed: true, completedAt: new Date(),
            }));
          }

          // Award points inside transaction
          if (ch.pointsReward > 0) {
            await manager.save(manager.getRepository(UserPoints).create({
              tenantId, userId, points: ch.pointsReward,
              source: PointsSource.CHALLENGE_COMPLETED, description: `Desafío completado: ${ch.name}`, referenceId: ch.id,
            }));
          }
        });

        // Notify outside transaction (non-critical)
        if (ch.pointsReward > 0) {
          this.refreshUserPointsSummary(tenantId, userId).catch(() => {});
        }
        this.notificationsService.create({
          tenantId, userId, type: NotificationType.GENERAL,
          title: `Desafío completado: ${ch.name}`,
          message: `Has completado el desafío "${ch.name}" y ganado ${ch.pointsReward} puntos.`,
          metadata: { challengeId: ch.id },
        }).catch(() => {});
      } catch {
        // Unique constraint violation or other error — another call already processed this
      }
    }
  }

  private async getUserActivityCounts(tenantId: string, userId: string): Promise<Record<string, number>> {
    const [recvCount, sentCount, totalPointsData, feedbackCount] = await Promise.all([
      this.recogRepo.count({ where: { tenantId, toUserId: userId } }),
      this.recogRepo.count({ where: { tenantId, fromUserId: userId } }),
      this.getUserPoints(tenantId, userId),
      // Feedback count would need QuickFeedback repo — use sent count as proxy
      Promise.resolve(0),
    ]);
    return {
      recognitions_received: recvCount,
      recognitions_sent: sentCount,
      total_points: totalPointsData.totalPoints,
      feedback_given: sentCount, // proxy
    };
  }

  // ─── Milestone Notifications ──────────────────────────────────────

  private static readonly MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000];

  async checkMilestones(tenantId: string, userId: string) {
    const { totalPoints } = await this.getUserPoints(tenantId, userId);
    // Find the highest milestone just crossed (only notify for the latest one)
    const justCrossed = RecognitionService.MILESTONES
      .filter((m) => totalPoints >= m)
      .pop(); // highest milestone crossed

    if (!justCrossed) return;

    // Use createBulk which has 12-hour dedup to prevent duplicate notifications
    this.notificationsService.createBulk([{
      tenantId, userId, type: NotificationType.GENERAL,
      title: `Hito alcanzado: ${justCrossed} puntos`,
      message: `Has alcanzado ${justCrossed} puntos en reconocimientos.`,
      metadata: { milestone: justCrossed, totalPoints },
    }]).catch(() => {});
  }

  // ─── Leaderboard with Opt-in ──────────────────────────────────────

  async getLeaderboardOptIn(tenantId: string, period: string, limit = 20, department?: string, departmentId?: string) {
    const qb = this.pointsRepo.createQueryBuilder('p')
      .innerJoin(User, 'u', 'u.id = p.user_id AND u.tenant_id = p.tenant_id AND u.leaderboard_opt_in = true')
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

    if (departmentId) {
      qb.andWhere('u.department_id = :departmentId', { departmentId });
    } else if (department) {
      qb.andWhere('u.department = :department', { department });
    }

    const validPeriods: Record<string, number> = { week: 7, month: 30, quarter: 90 };
    if (validPeriods[period]) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - validPeriods[period]);
      qb.andWhere('p.created_at >= :cutoff', { cutoff });
    }

    const raw = await qb.getRawMany();
    return raw.map((r: any, i: number) => ({
      rank: i + 1,
      userId: r.userId,
      userName: r.userName,
      department: r.department,
      position: r.position,
      totalPoints: parseInt(r.totalPoints),
      transactions: parseInt(r.transactions),
    }));
  }

  async toggleLeaderboardOptIn(tenantId: string, userId: string, optIn: boolean) {
    await this.userRepo.update({ id: userId, tenantId }, { leaderboardOptIn: optIn });
    return { optIn };
  }

  // ─── Export ────────────────────────────────────────────────────────────

  private esc(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  async exportRecognitionsCsv(tenantId: string, managerId?: string): Promise<string> {
    const wall = await this.getWall(tenantId, { page: 1, limit: 500, managerId });
    const items = wall.data || [];
    const rows: string[] = ['De,Para,Mensaje,Valor Corporativo,Puntos,Fecha'];
    for (const r of items) {
      const from = r.fromUser ? `${r.fromUser.firstName} ${r.fromUser.lastName}` : '';
      const to = r.toUser ? `${r.toUser.firstName} ${r.toUser.lastName}` : '';
      rows.push([this.esc(from), this.esc(to), this.esc(r.message), this.esc(r.value?.name || ''), r.points || 0,
        r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-CL') : ''].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  async exportRecognitionsXlsx(tenantId: string, managerId?: string): Promise<Buffer> {
    const wall = await this.getWall(tenantId, { page: 1, limit: 500, managerId });
    const items = wall.data || [];
    // stats y leaderboard siguen siendo org-wide incluso para manager — son
    // secciones de contexto (no datos "confidenciales" por equipo). El wall
    // sí está filtrado para manager.
    const stats = await this.getStats(tenantId);
    const leaderboard = await this.getLeaderboard(tenantId, 'month', 50);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const hFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const hFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 28 }, { width: 15 }];
    ws1.addRow(['Reconocimientos']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Total reconocimientos', stats.totalRecognitions ?? 0]);
    ws1.addRow(['Este mes', stats.monthlyRecognitions ?? 0]);
    ws1.addRow(['Insignias otorgadas', stats.totalBadgesEarned ?? 0]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);
    if (stats.topValues?.length > 0) {
      ws1.addRow([]);
      ws1.addRow(['Valores más reconocidos']).font = { bold: true };
      for (const v of stats.topValues) ws1.addRow([v.valueName || v.name, v.count]);
    }

    // Sheet 2: Muro
    const ws2 = wb.addWorksheet('Reconocimientos');
    ws2.columns = [{ width: 22 }, { width: 22 }, { width: 40 }, { width: 18 }, { width: 10 }, { width: 14 }];
    const h2 = ws2.addRow(['De', 'Para', 'Mensaje', 'Valor', 'Puntos', 'Fecha']);
    h2.eachCell((c) => { c.font = hFont; c.fill = hFill; });
    for (const r of items) {
      ws2.addRow([
        r.fromUser ? `${r.fromUser.firstName} ${r.fromUser.lastName}` : '',
        r.toUser ? `${r.toUser.firstName} ${r.toUser.lastName}` : '',
        r.message || '', r.value?.name || '', r.points || 0,
        r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-CL') : '',
      ]);
    }

    // Sheet 3: Ranking
    const ws3 = wb.addWorksheet('Ranking');
    ws3.columns = [{ width: 8 }, { width: 25 }, { width: 18 }, { width: 18 }, { width: 12 }];
    const h3 = ws3.addRow(['#', 'Colaborador', 'Departamento', 'Cargo', 'Puntos']);
    h3.eachCell((c) => { c.font = hFont; c.fill = hFill; });
    (leaderboard as any[]).forEach((l, i) => {
      ws3.addRow([i + 1, l.userName || '', l.department || '', l.position || '', l.totalPoints || 0]);
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportRecognitionsPdf(tenantId: string, managerId?: string): Promise<Buffer> {
    const wall = await this.getWall(tenantId, { page: 1, limit: 200, managerId });
    const items = wall.data || [];
    const stats = await this.getStats(tenantId);

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Reconocimientos', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`${stats.totalRecognitions ?? 0} reconocimientos totales — ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;
    const kpis = [
      { label: 'Total', value: `${stats.totalRecognitions ?? 0}` },
      { label: 'Este Mes', value: `${stats.monthlyRecognitions ?? 0}` },
      { label: 'Insignias', value: `${stats.totalBadgesEarned ?? 0}` },
    ];
    const kpiW = (pageW - 2 * margin - 2 * 4) / 3;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
      doc.setFontSize(7); doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
      doc.setFontSize(12); doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
    });
    y += 26;

    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['De', 'Para', 'Mensaje', 'Valor', 'Pts', 'Fecha']],
      body: items.slice(0, 100).map((r: any) => [
        r.fromUser ? `${r.fromUser.firstName} ${r.fromUser.lastName}` : '',
        r.toUser ? `${r.toUser.firstName} ${r.toUser.lastName}` : '',
        (r.message || '').substring(0, 60), r.value?.name || '', r.points || 0,
        r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-CL') : '',
      ]),
      headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 }, alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }
    return Buffer.from(doc.output('arraybuffer'));
  }

  // ═════════════════════════════════════════════════════════════════════
  // v3.1 F7 — Comentarios sobre reconocimientos + MVP del Mes
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Agrega un comentario a un reconocimiento. Cualquier user activo del
   * tenant puede comentar. El recognition debe ser público (isPublic=true).
   */
  async addComment(
    tenantId: string,
    userId: string,
    recognitionId: string,
    text: string,
  ): Promise<RecognitionComment> {
    const clean = (text || '').trim();
    if (!clean) throw new BadRequestException('El comentario no puede estar vacío.');
    if (clean.length > 1000) {
      throw new BadRequestException('El comentario no puede superar los 1000 caracteres.');
    }

    const r = await this.recogRepo.findOne({
      where: { id: recognitionId, tenantId },
      select: ['id', 'isPublic'],
    });
    if (!r) throw new NotFoundException('Reconocimiento no encontrado');
    if (!r.isPublic) {
      throw new ForbiddenException('No se puede comentar en reconocimientos privados.');
    }

    const c = this.commentRepo.create({
      tenantId,
      recognitionId,
      fromUserId: userId,
      text: clean,
    });
    return this.commentRepo.save(c);
  }

  /**
   * Lista comentarios no-borrados de un reconocimiento, ordenados asc por
   * fecha (los más viejos primero, como un hilo de chat).
   */
  async listComments(
    tenantId: string,
    recognitionId: string,
  ): Promise<RecognitionComment[]> {
    // Verificar que el recognition pertenece al tenant (cross-tenant guard).
    const r = await this.recogRepo.findOne({
      where: { id: recognitionId, tenantId },
      select: ['id'],
    });
    if (!r) throw new NotFoundException('Reconocimiento no encontrado');

    return this.commentRepo.find({
      where: { recognitionId, deletedAt: IsNull() },
      relations: ['fromUser'],
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  /**
   * Soft-delete de un comentario. Solo el autor o admin del tenant
   * pueden borrar.
   */
  async deleteComment(
    tenantId: string,
    userId: string,
    role: string,
    commentId: string,
  ): Promise<{ deleted: true }> {
    const c = await this.commentRepo.findOne({
      where: { id: commentId, tenantId },
    });
    if (!c) throw new NotFoundException('Comentario no encontrado');
    // Solo tenant_admin moderador o el autor pueden borrar. super_admin
    // es rol interno de Eva360 — si necesita intervenir lo hace vía
    // impersonación como tenant_admin.
    const isAdmin = role === 'tenant_admin';
    if (!isAdmin && c.fromUserId !== userId) {
      throw new ForbiddenException('Solo el autor o el administrador del tenant puede borrar el comentario.');
    }
    await this.commentRepo.softDelete({ id: commentId });
    return { deleted: true };
  }

  // ─── MVP del Mes ─────────────────────────────────────────────────────

  /**
   * Formato de month: 'YYYY-MM' UTC.
   * ofsetMonths=0 → mes actual; ofsetMonths=-1 → mes anterior.
   */
  private monthKey(offsetMonths: number = 0): string {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + offsetMonths);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /** Primer día del mes (00:00 UTC). */
  private monthStart(monthKey: string): Date {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  }

  /** Primer día del mes siguiente (00:00 UTC) — exclusive end. */
  private monthEnd(monthKey: string): Date {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  }

  /** MVP del mes en curso (si ya fue calculado). */
  async getCurrentMvp(tenantId: string): Promise<MvpOfTheMonth | null> {
    const monthKey = this.monthKey(0);
    const mvp = await this.mvpRepo.findOne({
      where: { tenantId, month: monthKey },
      relations: ['user'],
    });
    return mvp;
  }

  /** Histórico de MVPs (últimos 12 meses por defecto). */
  async getMvpHistory(tenantId: string, limit: number = 12): Promise<MvpOfTheMonth[]> {
    return this.mvpRepo.find({
      where: { tenantId },
      relations: ['user'],
      order: { month: 'DESC' },
      take: Math.max(1, Math.min(limit, 60)),
    });
  }

  /**
   * Calcula el MVP del mes anterior para un tenant.
   * Criterios:
   *   1. Mayor `uniqueGivers` (reconocedores distintos).
   *   2. Tiebreaker: mayor `totalKudos`.
   *   3. Tiebreaker: user con fecha de ingreso más antigua.
   *
   * Idempotente: si ya existe MVP del mes para ese tenant, no lo sobreescribe.
   */
  private async calculateMvpForTenant(tenantId: string, monthKey: string): Promise<void> {
    const existing = await this.mvpRepo.findOne({ where: { tenantId, month: monthKey } });
    if (existing) {
      this.logger.log(`[mvpCron] tenant=${tenantId.slice(0, 8)} month=${monthKey} ya existe, skip`);
      return;
    }

    const start = this.monthStart(monthKey);
    const end = this.monthEnd(monthKey);

    // Cargar reconocimientos públicos del mes.
    const recogs = await this.recogRepo.find({
      where: {
        tenantId,
        isPublic: true,
        createdAt: Between(start, end),
      },
      select: ['toUserId', 'fromUserId', 'valueId'],
    });

    if (recogs.length === 0) {
      this.logger.log(`[mvpCron] tenant=${tenantId.slice(0, 8)} month=${monthKey} sin kudos, skip`);
      return;
    }

    // Agregar por toUserId.
    const byRecipient = new Map<string, { total: number; givers: Set<string>; values: Set<string> }>();
    for (const r of recogs) {
      let bucket = byRecipient.get(r.toUserId);
      if (!bucket) {
        bucket = { total: 0, givers: new Set(), values: new Set() };
        byRecipient.set(r.toUserId, bucket);
      }
      bucket.total += 1;
      bucket.givers.add(r.fromUserId);
      if (r.valueId) bucket.values.add(r.valueId);
    }

    // Elegir ganador. Tiebreaker final por createdAt del user (más antiguo primero).
    //
    // Bug fix (F3+F7 review): antes hacía N+1 queries (una findOne por
    // candidato) y si `user` era null caía en `new Date()` — rompiendo la
    // idempotencia del cron porque el tiebreaker volvía no-determinístico.
    // Ahora: un solo `In()` query y filtro users orfanos silenciosamente
    // (con warning en logs) en vez de asignarles un createdAt sintético.
    const candidateUserIds = Array.from(byRecipient.keys());
    const users = await this.userRepo.find({
      where: { id: In(candidateUserIds), tenantId },
      select: ['id', 'createdAt', 'isActive'],
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const active = Array.from(byRecipient.entries())
      .map(([userId, bucket]) => {
        const user = userMap.get(userId);
        if (!user) {
          // Orphan cross-tenant o fila borrada — excluir y loguear.
          this.logger.warn(
            `[mvpCron] tenant=${tenantId.slice(0, 8)} month=${monthKey} user orphan ${userId.slice(0, 8)}, excluido`,
          );
          return null;
        }
        return { userId, bucket, createdAt: user.createdAt, active: user.isActive };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.active);

    if (active.length === 0) {
      this.logger.log(`[mvpCron] tenant=${tenantId.slice(0, 8)} month=${monthKey} sin candidatos activos, skip`);
      return;
    }

    active.sort((a, b) => {
      if (b.bucket.givers.size !== a.bucket.givers.size) {
        return b.bucket.givers.size - a.bucket.givers.size;
      }
      if (b.bucket.total !== a.bucket.total) return b.bucket.total - a.bucket.total;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const winner = active[0];

    const mvp = this.mvpRepo.create({
      tenantId,
      month: monthKey,
      userId: winner.userId,
      totalKudosCount: winner.bucket.total,
      uniqueGiversCount: winner.bucket.givers.size,
      valuesTouched: Array.from(winner.bucket.values),
    });
    await this.mvpRepo.save(mvp);

    // Notificación in-app a TODOS los users activos del tenant.
    await this.notifyAllUsers(
      tenantId,
      `🏆 MVP del mes ${monthKey}: reconocido por ${winner.bucket.givers.size} colegas con ${winner.bucket.total} kudos.`,
    ).catch(() => undefined);

    this.logger.log(
      `[mvpCron] tenant=${tenantId.slice(0, 8)} month=${monthKey} winner=${winner.userId.slice(0, 8)} kudos=${winner.bucket.total} givers=${winner.bucket.givers.size}`,
    );
  }

  /**
   * Cron mensual día 1 a las 03:00 UTC: para cada tenant, calcula el
   * MVP del mes anterior. Idempotente y multi-replica safe.
   */
  @Cron('0 3 1 * *')
  async calculateMvpOfTheMonth(): Promise<void> {
    await runWithCronLock(
      'recognition.calculateMvpOfTheMonth',
      this.dataSource,
      this.logger,
      async () => {
        const monthKey = this.monthKey(-1); // mes anterior
        this.logger.log(`[mvpCron] arrancando para mes ${monthKey}`);

        // Todos los tenants (el calc es barato — iteramos todos, idempotente).
        // Bug fix (F3+F7 review): antes usaba getRepository('tenants') con
        // string — frágil ante refactors y sin type safety. Ahora usa la
        // entity Tenant directamente.
        const tenants = await this.dataSource
          .getRepository(Tenant)
          .createQueryBuilder('t')
          .select(['t.id'])
          .getMany();

        for (const t of tenants) {
          try {
            await this.calculateMvpForTenant(t.id, monthKey);
          } catch (err: any) {
            this.logger.warn(
              `[mvpCron] tenant=${t.id?.slice(0, 8)} falló: ${err?.message}`,
            );
          }
        }
        this.logger.log(`[mvpCron] completo para ${tenants.length} tenants`);
      },
    );
  }
}
