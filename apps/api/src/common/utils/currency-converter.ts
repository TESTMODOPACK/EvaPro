import { Logger } from '@nestjs/common';

/**
 * In-process converter from Chilean UF → CLP (and USD → CLP).
 *
 * Why: Stripe and MercadoPago do not support UF as a native currency, but our
 * SaaS prices a plan in UF to absorb inflation automatically. We resolve UF
 * to CLP at checkout time using the value-of-the-day published by the Chilean
 * Central Bank via https://mindicador.cl (free, no auth).
 *
 * Strategy:
 *  - 12-hour in-process cache. The UF value changes daily at best, so 12h
 *    is more than enough and avoids hammering the upstream.
 *  - On upstream failure, fall back to the last cached value (log a warn).
 *  - On cold start + upstream failure, fall back to a hard-coded conservative
 *    value so the app stays operational (`FALLBACK_UF_CLP`).
 *
 * Prod hardening backlog (out of scope for v1): replace the in-process cache
 * with a Redis cache shared across API replicas so all nodes see the same
 * rate for the same minute.
 */

const MINDICADOR_URL = 'https://mindicador.cl/api';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
// Conservative snapshot — deliberately stale but "safe" as last-resort.
// The real UF (2026-04) sits around CLP 39_600; we use a round number.
const FALLBACK_UF_CLP = 39_000;
const FALLBACK_USD_CLP = 950;

interface Cached {
  value: number;
  fetchedAt: number;
}

const cache = new Map<'uf' | 'dolar', Cached>();
const logger = new Logger('CurrencyConverter');

async function fetchRate(indicator: 'uf' | 'dolar'): Promise<number> {
  const cached = cache.get(indicator);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const res = await fetch(`${MINDICADOR_URL}/${indicator}`, {
      // Reasonable timeout — we'd rather fall back than block a checkout 30s.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { serie?: Array<{ valor: number }> };
    const valor = data.serie?.[0]?.valor;
    if (typeof valor !== 'number' || !isFinite(valor) || valor <= 0) {
      throw new Error('invalid payload');
    }
    cache.set(indicator, { value: valor, fetchedAt: Date.now() });
    return valor;
  } catch (err: any) {
    // Prefer stale cache to hard failure.
    if (cached) {
      logger.warn(`mindicador failed (${err?.message}); using stale ${indicator}=${cached.value}`);
      return cached.value;
    }
    const fallback = indicator === 'uf' ? FALLBACK_UF_CLP : FALLBACK_USD_CLP;
    logger.warn(`mindicador failed (${err?.message}) and no cache; using hardcoded fallback ${indicator}=${fallback}`);
    cache.set(indicator, { value: fallback, fetchedAt: Date.now() });
    return fallback;
  }
}

export interface ConversionResult {
  /** Amount in the target currency (CLP), rounded to integer. */
  amount: number;
  /** Currency code used upstream. Always 'CLP' today; future-proof for 'USD'. */
  currency: 'CLP' | 'USD';
  /** Conversion rate applied. `1` when no conversion was needed. */
  rate: number;
  /** Original amount before conversion. Preserved for audit. */
  originalAmount: number;
  /** Original currency before conversion. */
  originalCurrency: string;
}

/**
 * Convert any supported amount to the currency Stripe / MercadoPago expects.
 *
 * Today we force everything to CLP since that's the only common denominator
 * both providers handle well in Chile. If we add US or international pricing
 * later, extend this to route based on tenant country.
 */
export async function convertToCLP(amount: number, fromCurrency: string): Promise<ConversionResult> {
  const src = (fromCurrency || 'CLP').toUpperCase();
  if (src === 'CLP') {
    return {
      amount: Math.round(amount),
      currency: 'CLP',
      rate: 1,
      originalAmount: amount,
      originalCurrency: 'CLP',
    };
  }
  if (src === 'UF') {
    const rate = await fetchRate('uf');
    return {
      amount: Math.round(amount * rate),
      currency: 'CLP',
      rate,
      originalAmount: amount,
      originalCurrency: 'UF',
    };
  }
  if (src === 'USD') {
    const rate = await fetchRate('dolar');
    return {
      amount: Math.round(amount * rate),
      currency: 'CLP',
      rate,
      originalAmount: amount,
      originalCurrency: 'USD',
    };
  }
  // Unknown currency — refuse rather than charge an unspecified amount.
  throw new Error(`Unsupported source currency: ${fromCurrency}`);
}
