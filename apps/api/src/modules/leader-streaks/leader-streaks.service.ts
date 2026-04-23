import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { CheckIn, CheckInStatus } from '../feedback/entities/checkin.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { User } from '../users/entities/user.entity';

/**
 * v3.1 F6 — Leader Streaks (hábitos del líder).
 *
 * Feature de gamificación: cuenta "rachas" de semanas/meses consecutivos
 * donde el manager cumplió con una práctica. Agregación pura sobre data
 * existente — NO hay entity propia ni cache persistente.
 *
 * Rachas tracked:
 *   - checkinsWeekly: semanas consecutivas con ≥1 check-in COMPLETED
 *     donde managerId=userId. (bloque ISO: lunes-domingo UTC).
 *   - recognitionsMonthly: meses consecutivos con ≥1 recognition
 *     enviado (fromUserId=userId).
 *   - feedbackWeekly: semanas consecutivas con ≥1 quick feedback
 *     enviado (fromUserId=userId).
 *
 * Cada racha retorna { current, best, period } donde:
 *   - current: racha VIGENTE (incluye semana/mes actual si ya tiene
 *     actividad). Si no hay actividad esta semana/mes, `current` es 0
 *     (se rompió) aunque la semana anterior tuviera algo.
 *   - best: récord histórico de racha (desde el user creado).
 *   - period: 'weekly' | 'monthly' para rendering UI.
 *
 * Performance: 1 query por source (checkins/recognitions/feedback),
 * agrupación en memoria. Cap a 156 semanas (3 años) para limitar data.
 */

type Period = 'weekly' | 'monthly';
type StreakSnapshot = { current: number; best: number; period: Period };

type LeaderStreaks = {
  userId: string;
  firstName?: string;
  lastName?: string;
  department?: string | null;
  position?: string | null;
  checkinsWeekly: StreakSnapshot;
  recognitionsMonthly: StreakSnapshot;
  feedbackWeekly: StreakSnapshot;
  /** Suma simple: sirve como "score" para el ranking del admin. */
  totalScore: number;
};

@Injectable()
export class LeaderStreaksService {
  private readonly logger = new Logger(LeaderStreaksService.name);

  /** Límite de data considerada (3 años). */
  private static readonly MAX_WEEKS = 156;
  private static readonly MAX_MONTHS = 36;

  constructor(
    @InjectRepository(CheckIn)
    private readonly checkInRepo: Repository<CheckIn>,
    @InjectRepository(QuickFeedback)
    private readonly qfRepo: Repository<QuickFeedback>,
    @InjectRepository(Recognition)
    private readonly recogRepo: Repository<Recognition>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Date utils (UTC-based, ISO-week) ────────────────────────────────

  /** Key de la semana ISO: YYYY-Www (ej. '2026-W17'). UTC. */
  private weekKey(d: Date): string {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // ISO week: thursday of the week determina el año.
    dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  /** Key del mes: YYYY-MM. UTC. */
  private monthKey(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /** Genera los últimos N week keys terminando en la semana actual (UTC). */
  private lastNWeekKeys(n: number): string[] {
    const keys: string[] = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i * 7);
      keys.push(this.weekKey(d));
    }
    // Dedup (si alguna semana se repite por edge case borde de año).
    return Array.from(new Set(keys));
  }

  private lastNMonthKeys(n: number): string[] {
    const keys: string[] = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      keys.push(this.monthKey(d));
    }
    return keys;
  }

  /**
   * Dado un set de keys (semanas o meses) donde hay actividad y una
   * lista completa ordenada de keys a considerar (del más viejo al más
   * reciente), calcula current streak + best streak.
   *
   * - current: cuenta hacia atrás desde el último key; se incrementa
   *   mientras el key tenga actividad.
   * - best: el mayor run consecutivo en toda la lista.
   */
  private computeStreak(
    allKeys: string[],
    activeSet: Set<string>,
  ): { current: number; best: number } {
    let best = 0;
    let running = 0;
    for (const k of allKeys) {
      if (activeSet.has(k)) {
        running += 1;
        if (running > best) best = running;
      } else {
        running = 0;
      }
    }
    // Current: recorro desde el final mientras el key tenga actividad.
    let current = 0;
    for (let i = allKeys.length - 1; i >= 0; i--) {
      if (activeSet.has(allKeys[i])) current += 1;
      else break;
    }
    return { current, best };
  }

  // ─── Single-user computation ─────────────────────────────────────────

  async computeStreaksForUser(
    tenantId: string,
    userId: string,
  ): Promise<LeaderStreaks> {
    // Load user meta (for UI).
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      select: ['id', 'firstName', 'lastName', 'department', 'position'],
    });

    // ─── Check-ins COMPLETED donde el user fue manager ─────────────
    const weekKeys = this.lastNWeekKeys(LeaderStreaksService.MAX_WEEKS);
    const monthKeys = this.lastNMonthKeys(LeaderStreaksService.MAX_MONTHS);

    // Cutoff: cap los queries a los últimos 3 años (156 semanas / 36 meses).
    // Sin esto, un manager con 10k+ check-ins históricos hace que
    // .find() traiga todo el historial → query lenta + memoria alta.
    // Bug encontrado en review exhaustivo F6.
    const threeYearsAgo = new Date();
    threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);

    const checkins = await this.checkInRepo.find({
      where: {
        tenantId,
        managerId: userId,
        status: CheckInStatus.COMPLETED,
        completedAt: MoreThanOrEqual(threeYearsAgo),
      },
      select: ['completedAt', 'scheduledDate'],
    });
    const checkinWeeks = new Set<string>();
    for (const c of checkins) {
      // Usar completedAt si está, sino scheduledDate (fallback para
      // historiales antiguos sin completedAt).
      const d = c.completedAt || c.scheduledDate;
      if (!d) continue;
      const dt = d instanceof Date ? d : new Date(d);
      if (!Number.isFinite(dt.getTime())) continue;
      checkinWeeks.add(this.weekKey(dt));
    }
    const checkinsWeekly = this.computeStreak(weekKeys, checkinWeeks);

    // ─── Recognitions enviados (fromUser) ──────────────────────────
    const recogs = await this.recogRepo.find({
      where: {
        tenantId,
        fromUserId: userId,
        createdAt: MoreThanOrEqual(threeYearsAgo),
      },
      select: ['createdAt'],
    });
    const recogMonths = new Set<string>();
    for (const r of recogs) {
      if (!r.createdAt) continue;
      const dt = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      if (!Number.isFinite(dt.getTime())) continue;
      recogMonths.add(this.monthKey(dt));
    }
    const recognitionsMonthly = this.computeStreak(monthKeys, recogMonths);

    // ─── Quick feedback enviado (fromUser) ─────────────────────────
    const qfs = await this.qfRepo.find({
      where: {
        tenantId,
        fromUserId: userId,
        createdAt: MoreThanOrEqual(threeYearsAgo),
      },
      select: ['createdAt'],
    });
    const qfWeeks = new Set<string>();
    for (const q of qfs) {
      if (!q.createdAt) continue;
      const dt = q.createdAt instanceof Date ? q.createdAt : new Date(q.createdAt);
      if (!Number.isFinite(dt.getTime())) continue;
      qfWeeks.add(this.weekKey(dt));
    }
    const feedbackWeekly = this.computeStreak(weekKeys, qfWeeks);

    return {
      userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
      department: user?.department ?? null,
      position: user?.position ?? null,
      checkinsWeekly: { ...checkinsWeekly, period: 'weekly' },
      recognitionsMonthly: { ...recognitionsMonthly, period: 'monthly' },
      feedbackWeekly: { ...feedbackWeekly, period: 'weekly' },
      totalScore:
        checkinsWeekly.current +
        recognitionsMonthly.current +
        feedbackWeekly.current,
    };
  }

  // ─── Admin: ranking de managers del tenant ───────────────────────────

  async computeTenantLeaderboard(
    tenantId: string,
    role: string,
  ): Promise<LeaderStreaks[]> {
    // Solo tenant_admin. super_admin es rol interno de Eva360, no
    // funcional del cliente.
    if (role !== 'tenant_admin') {
      throw new ForbiddenException('Solo el administrador del tenant puede ver el ranking.');
    }

    // Managers del tenant (NO incluye tenant_admin — el admin ve el
    // ranking pero no aparece en él, no es líder operativo).
    const leaders = await this.userRepo.find({
      where: { tenantId, role: 'manager', isActive: true },
      select: ['id', 'firstName', 'lastName', 'department', 'position'],
      take: 100,
    });

    if (leaders.length === 0) return [];

    // Calcular en paralelo (controlado — max 100 queries de cada tipo).
    // Limitación aceptable para la primera iteración; si escala mal,
    // migrar a un solo query agregado por semana via SQL.
    const results = await Promise.all(
      leaders.map((l) => this.computeStreaksForUser(tenantId, l.id)),
    );

    return results.sort((a, b) => b.totalScore - a.totalScore);
  }
}
