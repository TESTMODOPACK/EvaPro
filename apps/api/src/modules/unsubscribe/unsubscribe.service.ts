import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { signToken, verifyToken, InvalidSignedTokenError } from '../../common/utils/signed-token';
import {
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
  UserNotificationPreferences,
} from '../../common/types/jsonb-schemas';

export const UNSUBSCRIBE_PURPOSE = 'unsubscribe';
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

export interface UnsubscribeTokenPayload {
  uid: string;
  tid: string | null;
}

export interface PublicUnsubscribePayload {
  email: string;
  firstName: string;
  orgName: string;
  preferences: UserNotificationPreferences;
}

@Injectable()
export class UnsubscribeService {
  private readonly logger = new Logger(UnsubscribeService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly auditService: AuditService,
  ) {}

  /** Public entry point for mint-time. Used by EmailService only. */
  mintToken(userId: string, tenantId: string | null): string {
    return signToken(
      { uid: userId, tid: tenantId },
      UNSUBSCRIBE_PURPOSE,
      UNSUBSCRIBE_TOKEN_TTL_SECONDS,
    );
  }

  /**
   * Validate a token and load the corresponding user + tenant branding.
   * Throws UnauthorizedException on any failure — the HTTP layer must NOT
   * reveal the exact reason to the caller (avoids enumeration).
   */
  async validate(token: string): Promise<{ payload: UnsubscribeTokenPayload; user: User; tenant: Tenant | null }> {
    let decoded;
    try {
      decoded = verifyToken<Record<string, never>>(token, UNSUBSCRIBE_PURPOSE);
    } catch (err) {
      if (err instanceof InvalidSignedTokenError) {
        this.logger.warn(`Unsubscribe token rejected: ${err.reason}`);
      }
      throw new UnauthorizedException('Enlace inválido o expirado.');
    }

    const user = await this.userRepo.findOne({ where: { id: decoded.uid } });
    if (!user) {
      // Don't leak — same error as bad token.
      throw new UnauthorizedException('Enlace inválido o expirado.');
    }

    // Token bound to a tenant? If the user has been moved since (rare), reject.
    // Use loose comparison because the token stores null for super_admin.
    if ((user.tenantId ?? null) !== (decoded.tid ?? null)) {
      this.logger.warn(`Unsubscribe token tenant mismatch — user=${user.id} tokenTid=${decoded.tid} userTid=${user.tenantId}`);
      throw new UnauthorizedException('Enlace inválido o expirado.');
    }

    let tenant: Tenant | null = null;
    if (user.tenantId) {
      tenant = await this.tenantRepo.findOne({ where: { id: user.tenantId }, select: ['id', 'name', 'settings', 'isActive'] });
    }

    return {
      payload: { uid: decoded.uid, tid: decoded.tid },
      user,
      tenant,
    };
  }

  /**
   * Shape a user's preferences map for the public UI. Returns a deterministic
   * value for every known category (defaulting to `true`), so the UI can
   * render the 8 toggles without probing for undefined keys.
   */
  buildPublicPayload(user: User, tenant: Tenant | null): PublicUnsubscribePayload {
    const stored = (user.notificationPreferences ?? {}) as UserNotificationPreferences;
    const preferences = Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((cat) => [cat, stored[cat] !== false]),
    ) as UserNotificationPreferences;
    return {
      email: user.email,
      firstName: user.firstName,
      orgName: tenant?.name ?? '',
      preferences,
    };
  }

  /**
   * Merge partial preferences into the stored map.
   *
   * Only keys from NOTIFICATION_CATEGORIES are accepted — unknown keys are
   * silently dropped. Values are coerced to strict booleans: anything truthy
   * becomes `true`. This prevents injection of arbitrary JSONB contents.
   */
  async updatePreferences(
    userId: string,
    tenantId: string | null,
    patch: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Enlace inválido o expirado.');

    const current: UserNotificationPreferences = { ...(user.notificationPreferences ?? {}) } as UserNotificationPreferences;
    const applied: Record<string, boolean> = {};

    for (const cat of NOTIFICATION_CATEGORIES) {
      if (Object.prototype.hasOwnProperty.call(patch, cat)) {
        const coerced = Boolean(patch[cat]);
        current[cat as NotificationCategory] = coerced;
        applied[cat] = coerced;
      }
    }

    user.notificationPreferences = current;
    await this.userRepo.save(user);

    await this.auditService.log(
      tenantId,
      userId,
      'email.preferences_updated',
      'User',
      userId,
      { applied, via: 'public_unsubscribe_link' },
      ipAddress,
    );
  }

  /**
   * Opt out of every known unsubscribable category. Transactional categories
   * are NOT stored in the map and are always sent regardless.
   */
  async unsubscribeAll(userId: string, tenantId: string | null, ipAddress?: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Enlace inválido o expirado.');

    const next: UserNotificationPreferences = { ...(user.notificationPreferences ?? {}) } as UserNotificationPreferences;
    for (const cat of NOTIFICATION_CATEGORIES) {
      next[cat as NotificationCategory] = false;
    }
    user.notificationPreferences = next;
    await this.userRepo.save(user);

    await this.auditService.log(
      tenantId,
      userId,
      'email.unsubscribe_all',
      'User',
      userId,
      { categories: NOTIFICATION_CATEGORIES, via: 'public_unsubscribe_link' },
      ipAddress,
    );
  }
}
