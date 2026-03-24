import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: any = null;

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
  ) {
    this.initResend();
  }

  // ─── Email (Resend) ─────────────────────────────────────────────────────

  private async initResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — emails will be logged to console');
      return;
    }
    try {
      const resendModule = await import('resend' as string);
      this.resend = new resendModule.Resend(apiKey);
      this.logger.log('Resend email service initialized');
    } catch {
      this.logger.warn('resend package not installed — emails will be logged to console');
    }
  }

  private async sendEmail(to: string, subject: string, html: string) {
    if (!this.resend) {
      this.logger.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: 'EvaPro <noreply@evapro.app>',
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error}`);
    }
  }

  async sendCycleLaunched(email: string, cycleName: string, dueDate: string) {
    await this.sendEmail(
      email,
      `Nueva evaluación: ${cycleName}`,
      `<h2>Has sido asignado a una evaluación</h2>
       <p>El ciclo <strong>${cycleName}</strong> ha sido lanzado.</p>
       <p>Fecha límite: <strong>${dueDate}</strong></p>
       <p>Ingresa a EvaPro para completar tus evaluaciones pendientes.</p>`,
    );
  }

  async sendReminder(email: string, cycleName: string, pendingCount: number) {
    await this.sendEmail(
      email,
      `Recordatorio: ${pendingCount} evaluaciones pendientes`,
      `<h2>Evaluaciones pendientes</h2>
       <p>Tienes <strong>${pendingCount}</strong> evaluaciones pendientes en el ciclo <strong>${cycleName}</strong>.</p>
       <p>Ingresa a EvaPro para completarlas.</p>`,
    );
  }

  async sendCycleClosed(email: string, cycleName: string) {
    await this.sendEmail(
      email,
      `Resultados disponibles: ${cycleName}`,
      `<h2>Resultados de evaluación disponibles</h2>
       <p>El ciclo <strong>${cycleName}</strong> ha sido cerrado.</p>
       <p>Ingresa a EvaPro para ver tus resultados.</p>`,
    );
  }

  async sendInvitation(email: string, tenantName: string) {
    await this.sendEmail(
      email,
      `Invitación a EvaPro — ${tenantName}`,
      `<h2>Has sido invitado a EvaPro</h2>
       <p>Tu organización <strong>${tenantName}</strong> te ha invitado a la plataforma de evaluación de desempeño.</p>
       <p>Ingresa con tu email y contraseña temporal para comenzar.</p>`,
    );
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

  /** Bulk create notifications for multiple users */
  async createBulk(notifications: Array<{
    tenantId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, any>;
  }>): Promise<void> {
    if (notifications.length === 0) return;
    const entities = notifications.map((n) =>
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
