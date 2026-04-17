/**
 * cron-lock.ts — Distributed lock para `@Cron` jobs en deployment
 * multi-replica.
 *
 * Contexto del bug:
 *   Si escalamos la API a 2+ replicas (docker compose scale api=2,
 *   kubernetes deployment replicas=N), los `@Cron` decorators de
 *   `@nestjs/schedule` disparan EN CADA REPLICA. Eso significa:
 *
 *     - dunning sends 2x → cliente recibe 2 emails "tu factura está
 *       vencida", y el counter avanza 2x (stage 3 → stage 14 en un día)
 *     - trial nurture emails 2x
 *     - processAutoRenewals crea invoices DUPLICADAS en tenants activos
 *     - cleanupOldNotifications borra rows 2x (idempotente en sí pero
 *       crea contención DB)
 *     - sendWeeklyManagerSummary manda resumen 2x
 *
 *   Todo lo anterior es indeseable en producción. Hoy corremos con 1
 *   replica, pero el próximo escalamiento rompe todo silenciosamente.
 *
 * Solución elegida: **Postgres advisory locks** (nativos, session-level).
 *   - `pg_try_advisory_lock(key)` — intenta tomar el lock; retorna
 *     boolean true si lo tomó, false si otra sesión ya lo tiene.
 *   - `pg_advisory_unlock(key)` — lo libera explícitamente.
 *   - Si la sesión crashea, Postgres libera el lock automáticamente al
 *     terminar la conexión → safe ante replica que se reinicia.
 *   - No requiere Redis u otra dependencia nueva. Gratis.
 *
 * Alternativas descartadas:
 *   - Redis (redlock): agrega un failure domain nuevo; overkill para
 *     20 tenants.
 *   - DB row con status='processing': requiere cleanup manual si crash;
 *     los advisory locks se limpian solos.
 *   - SELECT FOR UPDATE SKIP LOCKED: funciona pero requiere una tabla
 *     de "jobs" — más código a mantener.
 *
 * Uso:
 *   @Cron('0 9 * * *')
 *   async escalateOverdueInvoices() {
 *     await runWithCronLock('escalateOverdueInvoices', this.dataSource, this.logger, async () => {
 *       // ... lógica del cron
 *     });
 *   }
 *
 * Si otra replica ya está ejecutando el mismo cron, este método retorna
 * inmediatamente sin correr el body y loguea un INFO para visibilidad.
 */
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * Hashea un nombre de cron a un int64 estable. Usamos FNV-1a (64-bit) porque
 * es rápido, determinista y produce distribución uniforme sobre strings
 * cortos como los nombres de métodos. El valor resultante se pasa a
 * `pg_advisory_lock(bigint)`.
 */
function hashToInt64(s: string): bigint {
  // FNV-1a offset basis 64-bit
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    hash = BigInt.asUintN(64, hash ^ BigInt(s.charCodeAt(i)));
    hash = BigInt.asUintN(64, hash * prime);
  }
  // Postgres bigint es signed int64 — convertir uint64 a int64 range.
  return BigInt.asIntN(64, hash);
}

/**
 * Ejecuta `fn` solo si logramos tomar el advisory lock para `name`.
 * Si otra replica ya lo tiene, skip con log INFO (no es error).
 *
 * - `name`: identificador estable del cron (típicamente el nombre del
 *   método). Dos crons diferentes DEBEN tener nombres distintos.
 * - `dataSource`: inyectado por TypeORM en el service que llama.
 * - `logger`: el Logger del service, para trazabilidad en los logs.
 * - `fn`: la lógica del cron.
 */
export async function runWithCronLock(
  name: string,
  dataSource: DataSource,
  logger: Logger,
  fn: () => Promise<void>,
): Promise<void> {
  const key = hashToInt64(name);
  const runner = dataSource.createQueryRunner();
  await runner.connect();

  try {
    // pg_try_advisory_lock devuelve { pg_try_advisory_lock: true } o false.
    const result = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [key.toString()]);
    const locked = result?.[0]?.locked === true;

    if (!locked) {
      logger.log(`[CronLock] '${name}' already running in another replica; skipping this tick.`);
      return;
    }

    logger.log(`[CronLock] '${name}' lock acquired; running.`);
    try {
      await fn();
    } finally {
      // Siempre liberar, incluso si fn() lanzó. Usamos unlock explícito
      // aunque Postgres libera al cerrar la conexión; esto deja la
      // conexión libre para otro job en la misma query runner.
      await runner.query('SELECT pg_advisory_unlock($1)', [key.toString()]).catch((err) => {
        logger.warn(`[CronLock] '${name}' unlock failed (auto-released on release()): ${err?.message}`);
      });
      logger.log(`[CronLock] '${name}' lock released.`);
    }
  } finally {
    await runner.release();
  }
}

/**
 * Variante blocking del advisory lock. A diferencia de `runWithCronLock`
 * (que skipea si otro proceso tiene el lock), ésta ESPERA hasta obtenerlo
 * antes de correr `fn`. Útil cuando el trabajo DEBE ejecutarse — no es
 * opcional.
 *
 * Caso de uso principal: generación de números de factura. Dos requests
 * concurrentes para el mismo tenant DEBEN serializarse para no asignar
 * el mismo `invoice_number`. No queremos que uno se saltee — ambos tienen
 * que emitir una factura, solo que una después de la otra.
 *
 * Scope del lock: pasa un `name` que incluya la dimensión a serializar
 * (e.g. `'invoice-numbering:<tenantId>'`). Dos tenants distintos no
 * bloquean entre sí porque el hash es distinto.
 *
 * Timeout: Postgres no tiene timeout nativo en pg_advisory_lock. Si el
 * caller teme un deadlock (no debería ocurrir en este patrón porque
 * siempre adquirimos el mismo lock antes del trabajo y lo liberamos al
 * salir), puede setear `statement_timeout` o usar un wrapper con
 * `Promise.race` + timeout. Por ahora asumimos que no.
 */
export async function runWithBlockingAdvisoryLock<T>(
  name: string,
  dataSource: DataSource,
  fn: () => Promise<T>,
): Promise<T> {
  const key = hashToInt64(name);
  const runner = dataSource.createQueryRunner();
  await runner.connect();

  try {
    // pg_advisory_lock (blocking): si otra sesión lo tiene, esperamos.
    // Al retornar, garantizamos que somos los dueños exclusivos del lock.
    await runner.query('SELECT pg_advisory_lock($1)', [key.toString()]);
    try {
      return await fn();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1)', [key.toString()]).catch(() => undefined);
    }
  } finally {
    await runner.release();
  }
}
