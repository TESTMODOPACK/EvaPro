import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, FindOptionsWhere } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { PasswordHistory } from './entities/password-history.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PasswordPolicy } from '../../common/types/jsonb-schemas';

/** Defaults that apply when the tenant has NOT customized the policy. Aligned
 *  with the previous hardcoded regex in `auth.controller.ts` so existing
 *  users don't suddenly fail validation on day one. */
export const DEFAULT_PASSWORD_POLICY: Required<PasswordPolicy> = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: false,
  expiryDays: null, // opt-in per tenant
  historyCount: 0, // opt-in per tenant
  lockoutThreshold: 5,
  lockoutDurationMinutes: 15,
};

/** Hard caps — any tenant-supplied value above these is silently clamped.
 *  Prevents a misconfigured UI from locking out everyone or DoS'ing the
 *  bcrypt.compare loop on password changes. */
const LIMITS = {
  minLength: { min: 8, max: 64 },
  expiryDays: { min: 0, max: 365 },
  historyCount: { min: 0, max: 24 },
  lockoutThreshold: { min: 0, max: 50 },
  lockoutDurationMinutes: { min: 1, max: 1440 },
};

/** Salt rounds for bcrypt. Matches the value used elsewhere in the app. */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);

  constructor(
    @InjectRepository(PasswordHistory)
    private readonly historyRepo: Repository<PasswordHistory>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  /**
   * Criterio TypeORM para seleccionar un user scoped a su tenant. Se usa
   * en todos los `userRepo.update/findOne` del servicio para garantizar
   * que un userId de otro tenant no pueda actualizar/leer la fila.
   *
   * - tenantId !== null: matchea (id AND tenant_id = tenantId)
   * - tenantId === null: matchea (id AND tenant_id IS NULL) — caso super_admin
   */
  private scopedUserCriteria(
    userId: string,
    tenantId: string | null,
  ): FindOptionsWhere<User> {
    return tenantId
      ? { id: userId, tenantId }
      : { id: userId, tenantId: IsNull() };
  }

  // ─── Policy resolution ────────────────────────────────────────────────

  async resolvePolicy(
    tenantId: string | null,
  ): Promise<Required<PasswordPolicy>> {
    if (!tenantId) return DEFAULT_PASSWORD_POLICY;
    try {
      const tenant = await this.tenantRepo.findOne({
        where: { id: tenantId },
        select: ['id', 'settings'],
      });
      const custom = tenant?.settings?.passwordPolicy ?? {};
      return this.mergeAndClamp(custom);
    } catch {
      return DEFAULT_PASSWORD_POLICY;
    }
  }

  private mergeAndClamp(
    raw: Partial<PasswordPolicy>,
  ): Required<PasswordPolicy> {
    const clamp = (
      v: number | undefined | null,
      { min, max }: { min: number; max: number },
      fallback: number,
    ): number => {
      if (
        v === undefined ||
        v === null ||
        typeof v !== 'number' ||
        !isFinite(v)
      )
        return fallback;
      return Math.min(Math.max(v, min), max);
    };
    return {
      minLength: clamp(
        raw.minLength,
        LIMITS.minLength,
        DEFAULT_PASSWORD_POLICY.minLength,
      ),
      requireUppercase:
        typeof raw.requireUppercase === 'boolean'
          ? raw.requireUppercase
          : DEFAULT_PASSWORD_POLICY.requireUppercase,
      requireLowercase:
        typeof raw.requireLowercase === 'boolean'
          ? raw.requireLowercase
          : DEFAULT_PASSWORD_POLICY.requireLowercase,
      requireNumber:
        typeof raw.requireNumber === 'boolean'
          ? raw.requireNumber
          : DEFAULT_PASSWORD_POLICY.requireNumber,
      requireSymbol:
        typeof raw.requireSymbol === 'boolean'
          ? raw.requireSymbol
          : DEFAULT_PASSWORD_POLICY.requireSymbol,
      // expiryDays allows `null` to mean "never". We map 0→null for
      // consistency (0 days would be a useless policy anyway).
      expiryDays:
        raw.expiryDays === null ||
        raw.expiryDays === undefined ||
        raw.expiryDays === 0
          ? null
          : clamp(raw.expiryDays, LIMITS.expiryDays, 0) || null,
      historyCount: clamp(
        raw.historyCount,
        LIMITS.historyCount,
        DEFAULT_PASSWORD_POLICY.historyCount,
      ),
      lockoutThreshold: clamp(
        raw.lockoutThreshold,
        LIMITS.lockoutThreshold,
        DEFAULT_PASSWORD_POLICY.lockoutThreshold,
      ),
      lockoutDurationMinutes: clamp(
        raw.lockoutDurationMinutes,
        LIMITS.lockoutDurationMinutes,
        DEFAULT_PASSWORD_POLICY.lockoutDurationMinutes,
      ),
    };
  }

  // ─── Validation ───────────────────────────────────────────────────────

  /**
   * Validate a new password against the policy. Returns a user-facing error
   * message (Spanish) on failure, or `null` on success.
   */
  validate(password: string, policy: Required<PasswordPolicy>): string | null {
    if (typeof password !== 'string') return 'La contraseña es inválida.';
    if (password.length < policy.minLength) {
      return `La contraseña debe tener al menos ${policy.minLength} caracteres.`;
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      return 'La contraseña debe incluir al menos una mayúscula.';
    }
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      return 'La contraseña debe incluir al menos una minúscula.';
    }
    if (policy.requireNumber && !/\d/.test(password)) {
      return 'La contraseña debe incluir al menos un número.';
    }
    if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
      return 'La contraseña debe incluir al menos un símbolo.';
    }
    return null;
  }

  // ─── History check ────────────────────────────────────────────────────

  /**
   * Returns `true` if the candidate password matches ANY of the user's last
   * `historyCount` stored hashes. Bcrypt.compare is expensive (~100ms each);
   * `historyCount` is hard-capped to 24 in `mergeAndClamp` to bound the cost.
   */
  async matchesHistory(
    userId: string,
    newPassword: string,
    historyCount: number,
  ): Promise<boolean> {
    if (historyCount <= 0) return false;
    const rows = await this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: historyCount,
    });
    for (const row of rows) {
      try {
        if (await bcrypt.compare(newPassword, row.passwordHash)) return true;
      } catch {
        // Corrupt hash — skip, don't block the change.
      }
    }
    return false;
  }

  // ─── Record a successful change ───────────────────────────────────────

  /**
   * Persist the new password hash in history, prune to hard cap 24, and
   * stamp `user.passwordChangedAt`. Called AFTER the new password has been
   * written to `user.passwordHash` by the caller.
   *
   * `tenantId` scopea el update del user para que un userId de otro
   * tenant no pueda sobrescribirse por error. password_history se purga
   * por user_id solo (la tabla no tiene tenant_id; el FK al user ya la
   * ata implicitamente al tenant correspondiente).
   */
  async recordChange(
    userId: string,
    tenantId: string | null,
    newHash: string,
  ): Promise<void> {
    await this.historyRepo.save(
      this.historyRepo.create({ userId, passwordHash: newHash }),
    );

    // Trim to hard cap so we never keep more than 24 rows per user.
    // Using a raw query — faster than fetching everything into memory.
    try {
      await this.historyRepo.query(
        `DELETE FROM password_history
         WHERE user_id = $1
           AND id NOT IN (
             SELECT id FROM password_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 24
           )`,
        [userId],
      );
    } catch (err) {
      // Non-fatal — history just grows a bit larger.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`password_history prune failed for user ${userId}: ${msg}`);
    }

    await this.userRepo.update(this.scopedUserCriteria(userId, tenantId), {
      passwordChangedAt: new Date(),
    });
  }

  // ─── Expiry ───────────────────────────────────────────────────────────

  isExpired(
    user: Pick<User, 'passwordChangedAt'>,
    policy: Required<PasswordPolicy>,
  ): boolean {
    if (!policy.expiryDays || policy.expiryDays <= 0) return false;
    // Users with no change timestamp (pre-feature) are NOT treated as expired.
    // They become subject to expiry the next time they change their password.
    if (!user.passwordChangedAt) return false;
    const expiresAt =
      new Date(user.passwordChangedAt).getTime() +
      policy.expiryDays * 24 * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }

  // ─── Lockout ──────────────────────────────────────────────────────────

  /**
   * Record a failed login attempt. If `lockoutThreshold > 0` and the user
   * reaches it, sets `locked_until = now + lockoutDurationMinutes`. Idempotent
   * — a user already locked stays locked until the window passes.
   *
   * `tenantId` scopea tanto el findOne como el update para garantizar
   * aislamiento multi-tenant (un userId cruzado de otro tenant => no-op).
   */
  async recordFailedAttempt(
    userId: string,
    tenantId: string | null,
    policy: Required<PasswordPolicy>,
  ): Promise<void> {
    if (policy.lockoutThreshold <= 0) return;
    const criteria = this.scopedUserCriteria(userId, tenantId);
    const user = await this.userRepo.findOne({
      where: criteria,
      select: ['id', 'failedLoginAttempts', 'lockedUntil'],
    });
    if (!user) return;
    const now = new Date();
    // If an existing lockout window is still active, just increment — the
    // threshold was already reached and UX messaging already covered.
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    // Tipado como Partial<Pick<User, ...>> para evitar el `as any` que
    // historicamente se usaba aca: QueryDeepPartialEntity<User> se quejaba
    // por la relacion anidada Tenant. Picking solo las columnas escalares
    // que vamos a mutar sortea ese problema sin perder type-safety.
    const update: Partial<Pick<User, 'failedLoginAttempts' | 'lockedUntil'>> = {
      failedLoginAttempts: attempts,
    };
    if (attempts >= policy.lockoutThreshold) {
      update.lockedUntil = new Date(
        now.getTime() + policy.lockoutDurationMinutes * 60 * 1000,
      );
    }
    await this.userRepo.update(criteria, update);
  }

  /** Reset counters on successful authentication. Called from `validateUser`. */
  async clearFailedAttempts(
    userId: string,
    tenantId: string | null,
  ): Promise<void> {
    await this.userRepo.update(this.scopedUserCriteria(userId, tenantId), {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  /** Returns the remaining lockout minutes (>=1) if the user is currently
   *  locked, else null. */
  minutesUntilUnlocked(user: Pick<User, 'lockedUntil'>): number | null {
    if (!user.lockedUntil) return null;
    const ms = new Date(user.lockedUntil).getTime() - Date.now();
    if (ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / 60_000));
  }

  // ─── Exposed salt rounds for consistent hashing ───────────────────────
  get bcryptRounds(): number {
    return BCRYPT_ROUNDS;
  }
}
