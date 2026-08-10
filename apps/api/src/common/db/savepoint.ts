import { EntityManager } from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * savepoint.ts — Ejecuta trabajo "best-effort" contra la BD sin poder
 * romper la transacción del request.
 *
 * ── El problema que resuelve ──────────────────────────────────────────
 *
 * Cada request corre dentro de una transacción (TenantContextInterceptor).
 * En PostgreSQL, **una sola query fallida aborta la transacción completa**:
 * a partir de ahí toda query devuelve
 *
 *     25P02 — current transaction is aborted,
 *             commands ignored until end of transaction block
 *
 * y al cerrar, el COMMIT se degrada a ROLLBACK. Un `try/catch` alrededor
 * de la query atrapa el error en JavaScript pero NO rescata la
 * transacción: el daño ya está hecho a nivel de Postgres.
 *
 * Ese anti-patrón causó dos bugs de producción en EVA360:
 *   - Crear empresa respondía 200 pero la empresa nunca se guardaba
 *     (un INSERT de contrato violaba NOT NULL y abortaba la tx).
 *   - Eliminar un departamento sin uso devolvía 500 con 25P02
 *     (un chequeo opcional sobre una tabla abortaba la tx).
 *
 * ── La solución ──────────────────────────────────────────────────────
 *
 * Envolver el trabajo opcional en una transacción ANIDADA. TypeORM la
 * traduce a un SAVEPOINT, de modo que un fallo hace ROLLBACK TO SAVEPOINT
 * y la transacción principal sigue viva y utilizable.
 *
 * Usar SOLO para trabajo genuinamente opcional (métricas, sincronizaciones
 * de compatibilidad, chequeos sobre tablas que podrían no existir). Si el
 * fallo debe abortar la operación, NO uses esto: deja que la excepción
 * suba.
 *
 * @example
 * const count = await inSavepoint(
 *   this.repo.manager,
 *   async (m) => Number((await m.query(sql, params))?.[0]?.cnt ?? 0),
 *   { fallback: 0, logger: this.logger, context: 'uso de departamento' },
 * );
 */
export async function inSavepoint<T>(
  manager: EntityManager,
  work: (m: EntityManager) => Promise<T>,
  options: {
    /** Valor devuelto si el trabajo falla. */
    fallback: T;
    /** Si se pasa, el fallo se loguea como warn (no queda mudo). */
    logger?: Logger;
    /** Texto corto para identificar el punto de fallo en el log. */
    context?: string;
  },
): Promise<T> {
  try {
    return await manager.transaction(async (m) => work(m));
  } catch (err) {
    options.logger?.warn(
      `[savepoint] omitido${options.context ? ` (${options.context})` : ''}: ${
        (err as Error)?.message ?? err
      }`,
    );
    return options.fallback;
  }
}
