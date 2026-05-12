/**
 * Fase 5 / Tarea 5.4 — Helper para anotar errores de billing con
 * tags consistentes en Sentry. Mejora drill-down en el dashboard del
 * equipo de ops.
 *
 * Tags standard:
 *   - `module: 'billing'`
 *   - `tenantId: <uuid>` (si aplica)
 *   - `invoiceNumber: 'EVA-...'` (si aplica)
 *   - `provider: 'stripe' | 'mercadopago'` (si aplica)
 *   - `subAction: <accion fina, ej. 'generate_invoice'>`
 *
 * Uso:
 *   try { ... } catch (err) {
 *     captureBillingError(err, { tenantId, invoiceNumber, subAction: 'generate_invoice' });
 *     throw err;
 *   }
 *
 * Si Sentry no esta configurado (no SENTRY_DSN env), el helper es
 * no-op — no falla el caller.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SentryRef: any | null = null;
try {
  // Lazy require para no romper si el paquete no esta presente en tests.

  SentryRef = require('@sentry/nestjs');
} catch {
  SentryRef = null;
}

export interface BillingErrorContext {
  tenantId?: string | null;
  invoiceNumber?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  provider?: 'stripe' | 'mercadopago' | null;
  subAction?: string;
  /** Extras: cualquier dato no PII (montos, status). */
  extras?: Record<string, unknown>;
}

export function captureBillingError(
  err: unknown,
  context: BillingErrorContext = {},
): void {
  if (!SentryRef) return;
  try {
    const tags: Record<string, string> = { module: 'billing' };
    if (context.tenantId) tags.tenantId = context.tenantId;
    if (context.invoiceNumber) tags.invoiceNumber = context.invoiceNumber;
    if (context.provider) tags.provider = context.provider;
    if (context.subAction) tags.subAction = context.subAction;
    const extra: Record<string, unknown> = { ...context.extras };
    if (context.invoiceId) extra.invoiceId = context.invoiceId;
    if (context.subscriptionId) extra.subscriptionId = context.subscriptionId;
    SentryRef.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags,
      extra,
    });
  } catch {
    // Nunca propagar errores del logger.
  }
}
