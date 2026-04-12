/**
 * cache.helper.ts — Utilidades para simplificar el patron cache-aside
 * (get-or-fetch) en los servicios de EvaPro.
 *
 * El patron es siempre el mismo:
 *   1. Buscar en cache por key
 *   2. Si existe, devolverlo
 *   3. Si no, ejecutar la query, guardar en cache, devolver
 *
 * Este helper encapsula ese patron en una funcion generica tipada.
 * El TTL se pasa en SEGUNDOS (cache-manager v6).
 *
 * Uso en un servicio:
 *
 *   constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}
 *
 *   async findPlanById(id: string) {
 *     return cachedFetch(this.cacheManager, `plan:${id}`, 300, () =>
 *       this.planRepo.findOne({ where: { id } }),
 *     );
 *   }
 *
 * El `cachedFetch` es seguro: si el cache falla (ej. store lleno),
 * ejecuta el fetcher sin cache y loguea un warning. Nunca rompe el
 * request por un problema de cache.
 */
import type { Cache } from 'cache-manager';

/**
 * Cache-aside pattern generico.
 *
 * @param cache    - Instancia de cache-manager inyectada via CACHE_MANAGER.
 * @param key      - Clave unica en el cache. Convension: `entity:tenantId:entityId`.
 * @param ttlSecs  - Time-to-live en segundos. 0 = sin cache.
 * @param fetcher  - Funcion async que obtiene el dato fresco si no esta en cache.
 * @returns        - El dato (del cache o del fetcher).
 */
export async function cachedFetch<T>(
  cache: Cache,
  key: string,
  ttlSecs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (ttlSecs <= 0) return fetcher();

  try {
    const cached = await cache.get<T>(key);
    if (cached !== undefined && cached !== null) return cached;
  } catch {
    // Cache read failed — continue to fetcher (degraded, not broken)
  }

  const fresh = await fetcher();

  try {
    // cache-manager v6 usa `ttl` en milisegundos si el store es memory
    // y en segundos si es redis. Para memory store, convertimos a ms.
    await cache.set(key, fresh, ttlSecs * 1000);
  } catch {
    // Cache write failed — dato ya se devuelve, solo perdemos el cache
  }

  return fresh;
}

/**
 * Invalida una key del cache. Safe — nunca tira.
 */
export async function invalidateCache(cache: Cache, key: string): Promise<void> {
  try {
    await cache.del(key);
  } catch {
    // Ignore — cache miss es equivalente a invalidacion exitosa
  }
}

/**
 * Invalida todas las keys que empiecen con un prefix.
 * NOTA: cache-manager in-memory NO soporta scan/pattern. Este helper
 * borra las keys conocidas pasadas como array. Para Redis, se puede
 * usar SCAN + DEL con un pattern.
 */
export async function invalidateCacheByKeys(cache: Cache, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => invalidateCache(cache, k)));
}
