import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from './entities/push-subscription.entity';
import { User } from '../users/entities/user.entity';

export type PushEventType =
  | 'evaluations'
  | 'checkins'
  | 'objectives'
  | 'feedback'
  | 'recognitions'
  | 'surveys';

export interface PushPayload {
  title: string;
  body: string;
  /** URL destino cuando el usuario toca la notificación. Relative a /. */
  url?: string;
  /** URL de ícono custom (default: /icons/icon-192.png). */
  icon?: string;
  badge?: string;
  /** Si se repite `tag`, el OS reemplaza la notif previa (evita apilar). */
  tag?: string;
  /** Data arbitraria que llega al SW junto al payload. */
  data?: Record<string, unknown>;
  /** Si true, la notif no se auto-cierra (usar con moderación). */
  requireInteraction?: boolean;
}

/**
 * Preferencias de notificaciones del usuario. Shape del campo JSON
 * `users.notification_prefs`. Si null → tratar como todo habilitado.
 */
export interface UserNotificationPrefs {
  pushEnabled?: boolean;
  pushEvents?: Partial<Record<PushEventType, boolean>>;
  quietHours?: {
    enabled?: boolean;
    start?: string; // "HH:MM" 24h local-timezone
    end?: string; // "HH:MM"
    timezone?: string; // "America/Santiago"
  };
  emailEnabled?: boolean;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private readonly isDisabled: boolean;
  private initialized = false;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subsRepo: Repository<PushSubscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    this.isDisabled = process.env.PUSH_DISABLED === 'true';
  }

  onModuleInit() {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!pub || !priv || !subject) {
      this.logger.warn(
        'VAPID keys no configuradas — push deshabilitado. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.',
      );
      return;
    }
    try {
      webpush.setVapidDetails(subject, pub, priv);
      this.initialized = true;
      this.logger.log(
        `PushService ready (disabled=${this.isDisabled}, subject=${subject})`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to init VAPID: ${err.message}`);
    }
  }

  // ─── Subscribe / Unsubscribe ──────────────────────────────────────

  async subscribe(
    tenantId: string,
    userId: string,
    dto: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ): Promise<PushSubscription> {
    // Upsert por endpoint único: si el mismo browser re-suscribe (porque
    // sus keys fueron rotadas), actualizamos en vez de error de unique.
    let sub = await this.subsRepo.findOne({ where: { endpoint: dto.endpoint } });
    if (sub) {
      sub.userId = userId;
      sub.tenantId = tenantId;
      sub.p256dh = dto.keys.p256dh;
      sub.auth = dto.keys.auth;
      sub.userAgent = dto.userAgent || sub.userAgent;
      sub.lastUsedAt = new Date();
      sub.failureCount = 0;
      sub.lastFailureAt = null;
      return this.subsRepo.save(sub);
    }
    sub = this.subsRepo.create({
      tenantId,
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: dto.userAgent ?? null,
      lastUsedAt: new Date(),
    });
    return this.subsRepo.save(sub);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subsRepo.delete({ userId, endpoint });
  }

  /** Lista dispositivos registrados por un usuario (sin claves). */
  async listForUser(
    userId: string,
  ): Promise<
    Array<
      Pick<
        PushSubscription,
        'id' | 'userAgent' | 'createdAt' | 'lastUsedAt'
      >
    >
  > {
    return this.subsRepo.find({
      where: { userId },
      select: ['id', 'userAgent', 'createdAt', 'lastUsedAt'],
      order: { lastUsedAt: 'DESC' },
    });
  }

  // ─── Envío ──────────────────────────────────────────────────────

  /**
   * Envía push a todas las subscripciones de un usuario. Respeta preferences,
   * quiet hours y el killswitch global. No lanza; errores se logean y se
   * cuentan en `failed`. Subs inválidas (410/404) se borran automáticamente.
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
    eventType?: PushEventType,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    if (this.isDisabled || !this.initialized) {
      return { sent: 0, failed: 0, skipped: 1 };
    }

    // Preferencias del usuario. Usamos QueryBuilder con addSelect para
    // asegurar que el mapping column→property (notification_prefs →
    // notificationPrefs) se resuelve correctamente sin ambigüedad.
    const user = await this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .addSelect('u.notification_prefs', 'notificationPrefs')
      .where('u.id = :userId', { userId })
      .getRawOne<{ id: string; notificationPrefs: UserNotificationPrefs | null }>();
    if (!user) return { sent: 0, failed: 0, skipped: 1 };

    const prefs: UserNotificationPrefs | null = user.notificationPrefs ?? null;
    if (prefs) {
      if (prefs.pushEnabled === false) {
        return { sent: 0, failed: 0, skipped: 1 };
      }
      if (
        eventType &&
        prefs.pushEvents &&
        prefs.pushEvents[eventType] === false
      ) {
        return { sent: 0, failed: 0, skipped: 1 };
      }
      if (
        prefs.quietHours?.enabled &&
        this.isInQuietHours(prefs.quietHours as any)
      ) {
        this.logger.debug(`Push suppressed for user ${userId} (quiet hours)`);
        return { sent: 0, failed: 0, skipped: 1 };
      }
    }

    const subs = await this.subsRepo.find({ where: { userId } });
    if (subs.length === 0) return { sent: 0, failed: 0, skipped: 1 };

    const payloadStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/dashboard',
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/badge-72.png',
      tag: payload.tag,
      data: payload.data || {},
      requireInteraction: payload.requireInteraction === true,
    });

    let sent = 0;
    let failed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          // P8 SSRF/DoS fix: timeout explícito para que un push service
          // lento (FCM degradado, Mozilla unreachable) no bloquee el
          // request del caller. 10s es generoso; FCM normal responde <1s.
          await Promise.race([
            webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payloadStr,
              { TTL: 60 * 60 * 24 }, // 24h TTL del push service.
            ),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Push send timeout (>10s)')),
                10000,
              ),
            ),
          ]);
          sub.lastUsedAt = new Date();
          sub.failureCount = 0;
          sub.lastFailureAt = null;
          await this.subsRepo.save(sub);
          sent++;
        } catch (err: any) {
          failed++;
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            await this.subsRepo.delete(sub.id);
            this.logger.debug(
              `Deleted expired subscription ${sub.id} (status=${status})`,
            );
            return;
          }
          sub.failureCount = (sub.failureCount || 0) + 1;
          sub.lastFailureAt = new Date();
          if (sub.failureCount >= 5) {
            await this.subsRepo.delete(sub.id);
            this.logger.warn(
              `Deleted subscription ${sub.id} after 5 consecutive failures`,
            );
          } else {
            await this.subsRepo.save(sub);
          }
          this.logger.error(
            `Push failed for sub ${sub.id} (status=${status}): ${err?.message || err}`,
          );
        }
      }),
    );

    return { sent, failed, skipped: 0 };
  }

  /** Envío bulk. Los resultados se agregan y el error handling es el mismo. */
  async sendToUsers(
    userIds: string[],
    payload: PushPayload,
    eventType?: PushEventType,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const results = await Promise.all(
      userIds.map((id) => this.sendToUser(id, payload, eventType)),
    );
    return results.reduce(
      (acc, r) => ({
        sent: acc.sent + r.sent,
        failed: acc.failed + r.failed,
        skipped: acc.skipped + r.skipped,
      }),
      { sent: 0, failed: 0, skipped: 0 },
    );
  }

  // ─── Quiet hours ───────────────────────────────────────────────

  /**
   * Determina si el "ahora" (en la timezone del usuario) está dentro del
   * rango definido. Acepta rangos cross-midnight (ej 22:00→07:00).
   */
  private isInQuietHours(qh: {
    start?: string;
    end?: string;
    timezone?: string;
  }): boolean {
    if (!qh.start || !qh.end) return false;
    try {
      const tz = qh.timezone || 'America/Santiago';
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      const parts = fmt.format(now); // "23:45" o "HH:MM"
      const current = parts.replace(':', '').padStart(4, '0');
      const start = qh.start.replace(':', '').padStart(4, '0');
      const end = qh.end.replace(':', '').padStart(4, '0');
      if (start === end) return false;
      if (start > end) {
        // Cross-midnight: 22:00–07:00 → dentro si >=22 o <07
        return current >= start || current < end;
      }
      return current >= start && current < end;
    } catch {
      return false;
    }
  }

  // ─── Cleanup cron ──────────────────────────────────────────────

  /**
   * Borra suscripciones que no se han usado en 90 días, o que acumulan
   * 5+ fallos. Debe llamarse desde un cron envuelto con runWithCronLock.
   */
  async pruneDeadSubscriptions(
    inactivityDays = 90,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - inactivityDays);
    // SQL con paréntesis explícitos para evitar ambigüedad AND/OR precedence.
    // Condición: borrar si
    //   (failure_count >= 5) OR
    //   (last_used_at IS NOT NULL AND last_used_at < cutoff) OR
    //   (last_used_at IS NULL AND created_at < cutoff)
    const result = await this.subsRepo
      .createQueryBuilder()
      .delete()
      .where(
        `(failure_count >= :threshold)
         OR (last_used_at IS NOT NULL AND last_used_at < :cutoff)
         OR (last_used_at IS NULL AND created_at < :cutoff)`,
        { threshold: 5, cutoff },
      )
      .execute();
    const deleted = result.affected || 0;
    this.logger.log(
      `pruneDeadSubscriptions: ${deleted} subs eliminadas (inactivas >${inactivityDays}d o failure_count>=5)`,
    );
    return { deleted };
  }

  // ─── Métricas (admin) ──────────────────────────────────────────

  async getMetrics(): Promise<{
    total: number;
    activeLast7d: number;
    failuresLast7d: number;
    byBrowser: Record<string, number>;
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, activeLast7d, failuresLast7d, allSubs] = await Promise.all([
      this.subsRepo.count(),
      this.subsRepo
        .createQueryBuilder('s')
        .where('s.last_used_at >= :since', { since: sevenDaysAgo })
        .getCount(),
      this.subsRepo
        .createQueryBuilder('s')
        .where('s.last_failure_at >= :since', { since: sevenDaysAgo })
        .getCount(),
      this.subsRepo
        .createQueryBuilder('s')
        .select('s.user_agent', 'ua')
        .getRawMany<{ ua: string | null }>(),
    ]);

    const byBrowser: Record<string, number> = {};
    for (const { ua } of allSubs) {
      const family = this.classifyBrowser(ua);
      byBrowser[family] = (byBrowser[family] || 0) + 1;
    }
    return { total, activeLast7d, failuresLast7d, byBrowser };
  }

  private classifyBrowser(ua: string | null): string {
    if (!ua) return 'unknown';
    const lc = ua.toLowerCase();
    if (lc.includes('edg/')) return 'Edge';
    if (lc.includes('chrome/') && !lc.includes('edg/')) return 'Chrome';
    if (lc.includes('firefox/')) return 'Firefox';
    if (lc.includes('safari/') && !lc.includes('chrome/')) return 'Safari';
    return 'other';
  }
}
