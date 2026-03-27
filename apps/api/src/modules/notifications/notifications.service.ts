import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { EmailService } from './email.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    private readonly emailService: EmailService,
  ) {}

  // ─── Email facade (delegates to EmailService) ────────────────────────────

  async sendCycleLaunched(
    email: string,
    cycleName: string,
    dueDate: string,
    extra?: { firstName?: string; cycleType?: string; cycleId?: string },
  ) {
    await this.emailService.sendCycleLaunched(email, {
      firstName: extra?.firstName || 'Colaborador',
      cycleName,
      cycleType: extra?.cycleType || '90',
      dueDate,
      cycleId: extra?.cycleId || '',
    });
  }

  async sendReminder(
    email: string,
    cycleName: string,
    pendingCount: number,
    extra?: { firstName?: string; daysLeft?: number; cycleId?: string },
  ) {
    await this.emailService.sendEvaluationReminder(email, {
      firstName: extra?.firstName || 'Colaborador',
      cycleName,
      pendingCount,
      daysLeft: extra?.daysLeft ?? 3,
      cycleId: extra?.cycleId || '',
    });
  }

  async sendCycleClosed(email: string, cycleName: string, extra?: { firstName?: string; cycleId?: string }) {
    await this.emailService.sendCycleClosed(email, {
      firstName: extra?.firstName || 'Colaborador',
      cycleName,
      cycleId: extra?.cycleId || '',
    });
  }

  async sendInvitation(email: string, tenantName: string, extra?: { firstName?: string; tempPassword?: string }) {
    await this.emailService.sendInvitation(email, {
      firstName: extra?.firstName || email.split('@')[0],
      orgName: tenantName,
      tempPassword: extra?.tempPassword,
    });
  }

  // ─── In-App Notifications ──────────────────────────────────────────────

  async create(data: {
    tenantId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, any>;
  }): Promise<Notification> {
    const notif = this.notifRepo.create({
      tenantId: data.tenantId,
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      metadata: data.metadata || {},
      isRead: false,
    });
    return this.notifRepo.save(notif);
  }

  /** Check if a similar notification was created within the last N hours (deduplication) */
  async existsRecent(tenantId: string, userId: string, type: NotificationType, hoursBack = 12): Promise<boolean> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);
    const count = await this.notifRepo.count({
      where: { tenantId, userId, type, createdAt: MoreThan(cutoff) },
    });
    return count > 0;
  }

  /** Bulk create notifications for multiple users (with dedup) */
  async createBulk(notifications: Array<{
    tenantId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, any>;
  }>): Promise<void> {
    if (notifications.length === 0) return;

    // Dedup: filter out notifications where a similar one exists in last 12h
    const filtered: typeof notifications = [];
    for (const n of notifications) {
      const exists = await this.existsRecent(n.tenantId, n.userId, n.type);
      if (!exists) filtered.push(n);
    }
    if (filtered.length === 0) return;

    const entities = filtered.map((n) =>
      this.notifRepo.create({
        tenantId: n.tenantId,
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        metadata: n.metadata || {},
        isRead: false,
      }),
    );
    await this.notifRepo.save(entities);
  }

  async findByUser(tenantId: string, userId: string, limit = 50): Promise<Notification[]> {
    return this.notifRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async countUnread(tenantId: string, userId: string): Promise<number> {
    return this.notifRepo.count({
      where: { tenantId, userId, isRead: false },
    });
  }

  async markAsRead(tenantId: string, userId: string, notifId: string): Promise<Notification> {
    const notif = await this.notifRepo.findOne({
      where: { id: notifId, tenantId, userId },
    });
    if (!notif) throw new NotFoundException('Notificación no encontrada');
    notif.isRead = true;
    return this.notifRepo.save(notif);
  }

  async markAllAsRead(tenantId: string, userId: string): Promise<void> {
    await this.notifRepo.update(
      { tenantId, userId, isRead: false },
      { isRead: true },
    );
  }

  /** Delete notifications older than N days (cleanup) */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await this.notifRepo.delete({
      createdAt: LessThan(cutoff),
      isRead: true,
    });
    return result.affected || 0;
  }
}
