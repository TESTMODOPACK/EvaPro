import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Executes the irreversible "delete my account" cascade in a single DB
 * transaction. The general policy is ANONYMIZE, not hard-delete:
 *
 *   - Personal columns on `users` → overwritten with placeholders.
 *   - Row-level PII in related tables (CVs, notifications, notes) → deleted.
 *   - Domain rows that are historical evidence for the organization
 *     (evaluations, recognitions, audit_logs) → retained with the now-
 *     anonymized FK. Other users' evaluations of this person remain valid,
 *     but the person is no longer identifiable.
 *
 * Why not full delete: GDPR Art. 17 allows retention when needed for
 * "legitimate interest" or "public interest", and the org's historical
 * record of performance decisions falls under that. The user-facing
 * confirmation email is explicit about this.
 */
@Injectable()
export class GdprAnonymizerService {
  private readonly logger = new Logger(GdprAnonymizerService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns a report of affected tables for the audit log.
   * Throws on fatal errors — the caller should update GdprRequest.status to
   * 'failed' and surface the error.
   */
  async anonymizeUser(userId: string): Promise<{
    anonymizedEmail: string;
    affectedTables: string[];
  }> {
    const affectedTables: string[] = [];
    const anonymizedEmail = `deleted_${randomUUID()}@deleted.local`;

    await this.dataSource.transaction(async (em) => {
      const queryRunner = em.queryRunner!;

      // Helper to run idempotent SQL and track the table name only if the
      // statement actually ran (no exception thrown by table-not-found).
      const safeExec = async (sql: string, params: unknown[], trackAs: string): Promise<void> => {
        try {
          await queryRunner.query(sql, params);
          if (!affectedTables.includes(trackAs)) affectedTables.push(trackAs);
        } catch (err: any) {
          const msg = err?.message || String(err);
          // Common ignorable error: table or column does not exist because
          // the feature was never used or is in a stale dev DB. We log a
          // warn but do NOT abort the transaction — the cascade is best-
          // effort for optional tables, strict for the users table.
          this.logger.warn(`[GDPR anon] Non-fatal on ${trackAs}: ${msg}`);
        }
      };

      // ── 1. users row: anonymize all personal columns, invalidate JWT ────
      //    This one MUST succeed; if it throws, the transaction rolls back
      //    and the user remains intact. We use a plain UPDATE so an ORM
      //    entity listener can't silently override our wipe.
      await queryRunner.query(
        `UPDATE users SET
          first_name = 'Usuario',
          last_name = 'Eliminado',
          email = $2,
          rut = NULL,
          birth_date = NULL,
          gender = NULL,
          nationality = NULL,
          password_hash = NULL,
          two_factor_enabled = false,
          two_factor_secret = NULL,
          reset_code = NULL,
          reset_code_expires = NULL,
          signature_otp = NULL,
          signature_otp_expires = NULL,
          cv_url = NULL,
          cv_file_name = NULL,
          notification_preferences = '{}'::jsonb,
          is_active = false,
          departure_date = CURRENT_DATE,
          token_version = COALESCE(token_version, 0) + 1
        WHERE id = $1`,
        [userId, anonymizedEmail],
      );
      affectedTables.push('users');

      // ── 2. Hard-delete strictly personal rows ────────────────────────────
      //    notifications: in-app messages addressed to this user only.
      await safeExec(`DELETE FROM notifications WHERE user_id = $1`, [userId], 'notifications');
      //    user_notes: HR private notes ABOUT this user.
      await safeExec(`DELETE FROM user_notes WHERE user_id = $1`, [userId], 'user_notes');
      //    gamification counters — purely personal, safe to drop.
      await safeExec(`DELETE FROM user_points WHERE user_id = $1`, [userId], 'user_points');
      await safeExec(`DELETE FROM user_points_summary WHERE user_id = $1`, [userId], 'user_points_summary');
      await safeExec(`DELETE FROM user_badges WHERE user_id = $1`, [userId], 'user_badges');
      await safeExec(`DELETE FROM challenge_progress WHERE user_id = $1`, [userId], 'challenge_progress');
      await safeExec(`DELETE FROM points_budget WHERE user_id = $1`, [userId], 'points_budget');

      // ── 3. Cascade to terminal status on in-flight objects ───────────────
      //    objectives: mark as abandoned so other users' reports don't show
      //    a "ghost" active objective owned by a deleted user.
      await safeExec(
        `UPDATE objectives SET status = 'abandoned' WHERE user_id = $1 AND status NOT IN ('completed','abandoned')`,
        [userId],
        'objectives',
      );
      //    direct reports: detach so they don't point to a deleted manager.
      await safeExec(
        `UPDATE users SET manager_id = NULL WHERE manager_id = $1`,
        [userId],
        'users.manager_id',
      );
      //    development plans (PDI): cancel in-progress, keep completed.
      await safeExec(
        `UPDATE development_plans SET status = 'cancelled' WHERE user_id = $1 AND status NOT IN ('completed','cancelled')`,
        [userId],
        'development_plans',
      );
      await safeExec(
        `UPDATE development_actions SET status = 'cancelled'
         WHERE plan_id IN (SELECT id FROM development_plans WHERE user_id = $1)
           AND status NOT IN ('completed','cancelled')`,
        [userId],
        'development_actions',
      );
      //    check-ins: cancel pending/scheduled as either manager or employee.
      await safeExec(
        `UPDATE checkins SET status = 'cancelled'
         WHERE (employee_id = $1 OR manager_id = $1)
           AND status NOT IN ('completed','cancelled','rejected')`,
        [userId],
        'checkins',
      );
      //    recruitment: detach user from evaluator FKs but keep the history.
      await safeExec(
        `UPDATE recruitment_evaluators SET user_id = NULL WHERE user_id = $1`,
        [userId],
        'recruitment_evaluators',
      );

      // ── 4. Sessions & tokens: already invalidated by bumping token_version
      //    above. Nothing else to do here; refresh tokens (none persisted
      //    today) would also be cleared if the table existed.

      // ── 5. Retain for legal/historical reasons (NO changes):
      //    evaluation_assignments, evaluation_responses, peer_assignments,
      //    quick_feedbacks, recognitions, contracts, invoices, audit_logs,
      //    ai_insights, talent_assessments, calibration_entries,
      //    user_movements, user_departures.
    });

    return { anonymizedEmail, affectedTables };
  }
}
