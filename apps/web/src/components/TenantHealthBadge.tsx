'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

export type TenantHealthStatus = 'healthy' | 'at_risk' | 'critical' | 'no_sub' | 'trial';

export interface TenantHealthInput {
  tenant: { isActive?: boolean; createdAt?: string | null };
  subscription?: {
    status?: string;
    endDate?: string | null;
    nextBillingDate?: string | null;
    trialEndsAt?: string | null;
    plan?: { maxEmployees?: number | null } | null;
  } | null;
  /** Cantidad de usuarios activos del tenant (opcional — si no se provee,
   *  la señal de uso/límite queda fuera del cálculo). */
  activeUsers?: number | null;
}

export interface HealthResult {
  status: TenantHealthStatus;
  label: string;
  color: string;
  bg: string;
  reasons: string[];
}

/**
 * Calcula la "salud" de un tenant combinando varias señales disponibles hoy
 * (sin nuevos endpoints). Ningún dato bloqueante: si faltan inputs se asume
 * lo más benigno razonable.
 *
 * Criterios (en orden de prioridad):
 *   critical  → tenant.isActive === false, o subscription vencida, o uso >= 100%
 *   at_risk   → renovación en ≤ 7 días, uso >= 90%, o trial por expirar
 *   trial     → subscription.status === 'trialing'
 *   no_sub    → no hay subscription
 *   healthy   → default
 */
export function computeTenantHealth(input: TenantHealthInput): HealthResult {
  const reasons: string[] = [];
  const now = Date.now();
  const sub = input.subscription;
  const endDate = sub?.nextBillingDate || sub?.endDate;
  const daysLeft = endDate
    ? Math.ceil((new Date(endDate).getTime() - now) / 86_400_000)
    : null;
  const trialEnds = sub?.trialEndsAt
    ? Math.ceil((new Date(sub.trialEndsAt).getTime() - now) / 86_400_000)
    : null;
  const max = sub?.plan?.maxEmployees ?? null;
  const used = input.activeUsers ?? null;
  const usagePct = max && used != null ? Math.round((used / max) * 100) : null;

  // Crítico
  if (input.tenant?.isActive === false) {
    reasons.push('Tenant desactivado');
    return { status: 'critical', label: 'Inactivo', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)', reasons };
  }
  if (daysLeft != null && daysLeft < 0) {
    reasons.push(`Suscripción vencida hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) !== 1 ? 's' : ''}`);
    return { status: 'critical', label: 'Vencido', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)', reasons };
  }
  if (usagePct != null && usagePct >= 100) {
    reasons.push(`Uso del plan: ${usagePct}% (${used}/${max})`);
    return { status: 'critical', label: 'Límite superado', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)', reasons };
  }

  // At risk
  const riskReasons: string[] = [];
  if (daysLeft != null && daysLeft >= 0 && daysLeft <= 7) {
    riskReasons.push(`Renovación en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`);
  }
  if (usagePct != null && usagePct >= 90 && usagePct < 100) {
    riskReasons.push(`Uso del plan: ${usagePct}% (${used}/${max})`);
  }
  if (trialEnds != null && trialEnds >= 0 && trialEnds <= 7) {
    riskReasons.push(`Trial termina en ${trialEnds} día${trialEnds !== 1 ? 's' : ''}`);
  }
  if (riskReasons.length > 0) {
    return { status: 'at_risk', label: 'Atención', color: '#b45309', bg: 'rgba(245,158,11,0.12)', reasons: riskReasons };
  }

  // Trial vigente
  if (sub?.status === 'trialing') {
    return { status: 'trial', label: 'Trial', color: '#1e40af', bg: 'rgba(59,130,246,0.12)', reasons: ['En periodo de prueba'] };
  }

  // Sin suscripción
  if (!sub) {
    return { status: 'no_sub', label: 'Sin plan', color: '#64748b', bg: 'rgba(148,163,184,0.15)', reasons: ['No tiene suscripción asignada'] };
  }

  // Healthy
  return { status: 'healthy', label: 'Saludable', color: '#065f46', bg: 'rgba(16,185,129,0.12)', reasons: [] };
}

/**
 * Badge visual de salud del tenant. Muestra color + label; al hacer hover
 * (title attribute) muestra las razones que justifican el estado.
 */
export default function TenantHealthBadge({ input, size = 'md' }: { input: TenantHealthInput; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const h = computeTenantHealth(input);
  const fontSize = size === 'sm' ? '0.68rem' : '0.75rem';
  const padding = size === 'sm' ? '0.1rem 0.45rem' : '0.2rem 0.6rem';

  // Mapear label del computeTenantHealth a i18n (el compute sigue devolviendo
  // español como fallback para contextos sin React/i18n).
  const i18nLabelMap: Record<TenantHealthStatus, string> = {
    healthy: t('components.tenantHealth.healthy'),
    at_risk: t('components.tenantHealth.atRisk'),
    critical: t('components.tenantHealth.critical'),
    trial: t('components.tenantHealth.trial'),
    no_sub: t('components.tenantHealth.noSub'),
  };
  const translatedLabel = i18nLabelMap[h.status] || h.label;

  return (
    <span
      title={h.reasons.length ? h.reasons.join(' · ') : translatedLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding,
        background: h.bg,
        color: h.color,
        borderRadius: '999px',
        fontSize,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {h.status === 'healthy' && '🟢 '}
      {h.status === 'at_risk' && '🟡 '}
      {h.status === 'critical' && '🔴 '}
      {h.status === 'trial' && '🔵 '}
      {h.status === 'no_sub' && '⚪ '}
      {translatedLabel}
    </span>
  );
}
