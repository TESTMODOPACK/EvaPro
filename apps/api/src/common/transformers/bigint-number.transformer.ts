import { ValueTransformer } from 'typeorm';

/**
 * TypeORM transformer for `bigint` columns that should behave as JS `number`.
 *
 * Why this exists:
 *   PostgreSQL `bigint` (int8) has range ±9.2E18, which protects cumulative
 *   counters from int32 overflow. TypeORM, however, returns bigint columns
 *   as `string` in JavaScript to avoid precision loss past 2^53 (the JS
 *   safe-integer limit). That's correct in theory but breaks every caller
 *   that treats the column as a number (arithmetic, comparisons, JSON).
 *
 *   This transformer does the conversion at the ORM boundary: DB → JS is
 *   `parseInt(str, 10)`, JS → DB is the number unchanged (TypeORM serializes
 *   numbers to bigint correctly in write paths).
 *
 * Precision envelope:
 *   - Values up to `Number.MAX_SAFE_INTEGER` (2^53 − 1 = 9,007,199,254,740,991)
 *     round-trip losslessly. That's ~4 million× the int32 max (2^31 − 1).
 *   - Beyond that, `parseInt` silently truncates. The transformer logs
 *     a one-shot warning in that edge case. For counters in this codebase
 *     (addon usage, points ledger) this is essentially impossible:
 *       - 1B API calls/day for 24,000 years before overflow.
 *       - 1M points per user × 9 billion users before overflow.
 *
 * Usage:
 *   `@Column({ type: 'bigint', transformer: bigintNumberTransformer })`
 */
export const bigintNumberTransformer: ValueTransformer = {
  /** JS → DB: pass the number through; TypeORM/pg handles the cast to bigint. */
  to: (value: number | null | undefined): number | null | undefined => value,

  /** DB → JS: parse the string postgres returns back into a plain number. */
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const parsed = parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      // Alert once (ring-buffer in module scope) so we notice if the precision
      // envelope is ever approached. Not a hard error — readers still get a
      // usable number, just truncated.
      warnOnce(value);
    }
    return parsed;
  },
};

/** Minimal ring-buffer to warn at most once per distinct value prefix. */
const warned = new Set<string>();
function warnOnce(value: string): void {
  const key = value.slice(0, 16);
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[bigintNumberTransformer] Value ${value} exceeds Number.MAX_SAFE_INTEGER ` +
      `(2^53 − 1). Precision will be lost on read. Consider migrating the ` +
      `column's callers to BigInt/string handling.`,
  );
}
