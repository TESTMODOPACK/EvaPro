/**
 * cleanup-buggy-future-invoices.ts — Limpieza one-shot de facturas DRAFT
 * generadas con el bug de periodStart pre-Fase 0 (Tarea 0.1).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CONTEXTO DEL BUG
 *
 * Antes del fix de Tarea 0.1 (Fase 0), `invoices.service.generateInvoice`
 * usaba `sub.nextBillingDate` como `periodStart` para la primera factura
 * de una suscripcion. Como `nextBillingDate` esta 1 ciclo adelante de
 * `startDate`, la factura cubria un periodo en el FUTURO en vez del
 * actual:
 *
 *   - Plan mensual creado el 2026-05-01 -> factura cubria jun/2026 (1 mes
 *     adelantado, sintoma menos visible)
 *   - Plan trimestral -> factura cubria Q3/2026 en vez de Q2
 *   - Plan anual -> factura cubria 2027-05 a 2028-05 en vez de 2026-05 a
 *     2027-05 (caso real reproducido: EVA-2026-0002)
 *
 * Este script identifica facturas DRAFT con `period_start` claramente en
 * el futuro (>= now + 30 dias) y las cancela registrando audit log.
 * Decision: solo DRAFT — facturas SENT o PAID ya tuvieron interaccion
 * con el cliente; manipularlas requiere flujo de credit note (Fase 2).
 *
 * ════════════════════════════════════════════════════════════════════════
 * REGLAS DE EJECUCION
 *
 * 1. Por DEFAULT corre en DRY-RUN: solo imprime que haria, no toca BD.
 * 2. Para aplicar los cambios pasar --apply.
 * 3. Es idempotente: la 2da corrida no encuentra mas facturas DRAFT
 *    futuras porque ya las cancelo.
 * 4. NO borra registros. Solo cambia status DRAFT -> CANCELLED.
 * 5. Registra audit log con accion `invoice.bug_cleanup_T0_1` y razon.
 *
 * ════════════════════════════════════════════════════════════════════════
 * USO
 *
 *   # Inspeccionar que haria, sin tocar nada
 *   pnpm --filter api exec ts-node apps/api/src/database/cleanup-buggy-future-invoices.ts
 *
 *   # Aplicar de verdad
 *   pnpm --filter api exec ts-node apps/api/src/database/cleanup-buggy-future-invoices.ts --apply
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const apply = process.argv.includes('--apply');

// Umbral conservador: 30 dias en el futuro. Una factura legitima nunca
// deberia tener periodStart tan adelantado bajo la nueva logica
// (continuidad historica), porque el periodStart siempre es el
// periodEnd de la factura anterior — y el periodEnd anterior nunca
// puede estar 30+ dias en el futuro respecto al momento de generacion.
const FUTURE_DAYS_THRESHOLD = 30;

async function main() {
  if (!DATABASE_URL) {
    console.error('[cleanup-buggy-invoices] DATABASE_URL no definido. Abort.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    console.log(
      `[cleanup-buggy-invoices] Conectado. Modo: ${apply ? 'APPLY' : 'DRY-RUN'}.`,
    );

    // 1. Identificar candidatos
    const { rows: candidates } = await client.query(
      `
      SELECT i.id, i.invoice_number, i.tenant_id, i.subscription_id,
             i.period_start, i.period_end, i.due_date, i.total, i.currency, i.created_at
        FROM invoices i
       WHERE i.status = 'draft'
         AND i.period_start::date > (CURRENT_DATE + INTERVAL '${FUTURE_DAYS_THRESHOLD} days')
       ORDER BY i.tenant_id, i.created_at;
      `,
    );

    if (candidates.length === 0) {
      console.log(
        '[cleanup-buggy-invoices] No hay facturas DRAFT con period_start futuro. Nada que hacer.',
      );
      await client.end();
      return;
    }

    console.log(
      `[cleanup-buggy-invoices] ${candidates.length} factura(s) DRAFT con period_start futuro encontradas:`,
    );
    for (const c of candidates) {
      console.log(
        `  - ${c.invoice_number}  tenant=${c.tenant_id}  period=${c.period_start}..${c.period_end}  total=${c.total} ${c.currency}`,
      );
    }

    if (!apply) {
      console.log(
        '[cleanup-buggy-invoices] DRY-RUN. Para aplicar pasar --apply.',
      );
      await client.end();
      return;
    }

    // 2. Aplicar cancelacion en transaccion + audit log por cada una
    await client.query('BEGIN');
    let cancelled = 0;
    try {
      for (const c of candidates) {
        await client.query(
          `UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [c.id],
        );

        // Audit log — schema flexible (JSON metadata). Si la tabla no
        // existiera por algun motivo, abortamos transaccion para no
        // dejar facturas canceladas sin trazabilidad.
        await client.query(
          `
          INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata, created_at)
          VALUES ($1, NULL, 'invoice.bug_cleanup_T0_1', 'invoice', $2, $3::jsonb, NOW())
          `,
          [
            c.tenant_id,
            c.id,
            JSON.stringify({
              invoiceNumber: c.invoice_number,
              periodStart: c.period_start,
              periodEnd: c.period_end,
              total: c.total,
              currency: c.currency,
              reason:
                'Cancelada automaticamente por cleanup-buggy-future-invoices: period_start estaba >30d en el futuro por bug pre-Fase 0 de calculo de periodo (Tarea 0.1).',
            }),
          ],
        );
        cancelled++;
      }
      await client.query('COMMIT');
      console.log(
        `[cleanup-buggy-invoices] OK — ${cancelled} factura(s) canceladas con audit log.`,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[cleanup-buggy-invoices] ERROR — rollback:', err);
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('[cleanup-buggy-invoices] Fallo no manejado:', err);
  process.exit(1);
});
