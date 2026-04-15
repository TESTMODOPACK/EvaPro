'use client';

import React from 'react';
import Link from 'next/link';

type BoxUsers = { users?: any[] };
interface NineBoxData {
  boxes?: Record<string, BoxUsers>;
}

interface Recommendation {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  description: string;
  userCount: number;
  sampleNames: string[];
  ctaLabel: string;
  ctaHref: string;
}

/**
 * TalentRecommendations — analiza la matriz 9-box y sugiere acciones
 * priorizadas basadas en reglas de negocio (no IA real, pero basado en
 * señales que el propio 9-box ya captura: flightRisk, readiness,
 * quadrant position).
 *
 * Las 5 reglas aplicadas:
 *   1. STARS en flight risk       → activar retención (critical)
 *   2. STARS sin readiness=now    → plan de sucesión (warning)
 *   3. Underperformers (box 1-2)  → considerar salida con dignidad (warning)
 *   4. High potential (box 6-7)   → PDI prioritario (info)
 *   5. Inconsistentes (box 4)     → feedback + mentoring (info)
 */
export default function TalentRecommendations({
  nineBoxData,
  cycleId,
}: {
  nineBoxData: NineBoxData | null;
  cycleId: string;
}) {
  if (!nineBoxData?.boxes) return null;

  const recommendations = buildRecommendations(nineBoxData, cycleId);
  if (recommendations.length === 0) return null;

  return (
    <section
      className="animate-fade-up"
      style={{
        padding: '1.25rem 1.4rem',
        marginTop: '1rem',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius, 12px)',
        borderLeft: '4px solid var(--accent)',
      }}
      aria-label="Recomendaciones accionables basadas en el 9-Box"
    >
      <div style={{ marginBottom: '0.85rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span aria-hidden="true">💡</span> Recomendaciones accionables
        </h3>
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Análisis automático del 9-Box. Priorizado por urgencia de acción.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {recommendations.map((r) => (
          <RecommendationRow key={r.id} rec={r} />
        ))}
      </div>
    </section>
  );
}

function RecommendationRow({ rec }: { rec: Recommendation }) {
  const styles = {
    critical: { color: '#b91c1c', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.30)' },
    warning:  { color: '#b45309', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.30)' },
    info:     { color: '#1e40af', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)' },
  }[rec.severity];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: '0.75rem 0.9rem',
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: 'var(--radius-sm, 8px)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0, marginTop: '0.1rem' }}>
        {rec.icon}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: styles.color, marginBottom: '0.15rem' }}>
          {rec.userCount} · {rec.title}
        </div>
        <p style={{ margin: '0 0 0.3rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          {rec.description}
        </p>
        {rec.sampleNames.length > 0 && (
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Ejemplos: {rec.sampleNames.slice(0, 3).join(', ')}
            {rec.userCount > 3 ? ` y ${rec.userCount - 3} más` : ''}
          </p>
        )}
      </div>

      <Link
        href={rec.ctaHref}
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: styles.color,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          padding: '0.35rem 0.7rem',
          border: `1px solid ${styles.border}`,
          borderRadius: 'var(--radius-sm, 6px)',
          background: 'rgba(255,255,255,0.5)',
        }}
      >
        {rec.ctaLabel} →
      </Link>
    </div>
  );
}

function userName(entry: any): string {
  const u = entry.user || entry;
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '—';
}

function usersInBoxes(data: NineBoxData, boxes: number[]): any[] {
  const out: any[] = [];
  for (const b of boxes) {
    const bx = data.boxes?.[String(b)];
    if (bx?.users) out.push(...bx.users);
  }
  return out;
}

/** Reglas de negocio que transforman la matriz en acciones accionables. */
function buildRecommendations(data: NineBoxData, cycleId: string): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. STARS (box 9) en flight risk alto → retención urgente
  const stars = usersInBoxes(data, [9]);
  const starsAtRisk = stars.filter((u) => (u.flightRisk || '').toLowerCase() === 'high');
  if (starsAtRisk.length > 0) {
    recs.push({
      id: 'stars-flight-risk',
      severity: 'critical',
      icon: '🚨',
      title: 'Top talent en riesgo de salida',
      description: 'Colaboradores en cuadrante "Estrella" con señal de flight risk alto. Activa conversación de retención inmediata: revisa comp & ben, trayectoria y bloqueadores.',
      userCount: starsAtRisk.length,
      sampleNames: starsAtRisk.map(userName),
      ctaLabel: 'Ver lista',
      ctaHref: `/dashboard/talento?cycle=${encodeURIComponent(cycleId)}&pool=star&risk=high`,
    });
  }

  // 2. STARS sin readiness=ready_now → sucesión crítica
  const starsNoSuccession = stars.filter((u) => {
    const r = (u.readiness || '').toLowerCase();
    return r && r !== 'ready_now';
  });
  if (starsNoSuccession.length > 0) {
    recs.push({
      id: 'stars-no-succession',
      severity: 'warning',
      icon: '👑',
      title: 'Sucesión sin pipeline listo',
      description: 'Estrellas que aún no están listas para asumir rol superior. Define plan de sucesión con mentoría, proyectos de alcance y fast-track de desarrollo.',
      userCount: starsNoSuccession.length,
      sampleNames: starsNoSuccession.map(userName),
      ctaLabel: 'Planificar',
      ctaHref: '/dashboard/desarrollo',
    });
  }

  // 3. High potential (box 6-7) → PDI prioritario
  const highPot = usersInBoxes(data, [6, 7]);
  if (highPot.length > 0) {
    // Filtrar solo los que NO están ya listos (que tengan gap real)
    const withGap = highPot.filter((u) => {
      const r = (u.readiness || '').toLowerCase();
      return !r || r !== 'ready_now';
    });
    if (withGap.length > 0) {
      recs.push({
        id: 'high-potential-pdi',
        severity: 'info',
        icon: '🌱',
        title: 'Alto potencial para acelerar',
        description: 'Colaboradores con potencial alto y desempeño sólido que se beneficiarían de un PDI robusto. Invierte en ellos antes de que busquen afuera.',
        userCount: withGap.length,
        sampleNames: withGap.map(userName),
        ctaLabel: 'Crear PDI',
        ctaHref: '/dashboard/desarrollo',
      });
    }
  }

  // 4. Underperformers (box 1-2) → decisión necesaria
  const under = usersInBoxes(data, [1, 2]);
  if (under.length > 0) {
    recs.push({
      id: 'underperformers',
      severity: 'warning',
      icon: '⚖️',
      title: 'Decisión pendiente sobre bajo desempeño',
      description: 'Colaboradores sostenidamente por debajo del promedio. Activa PIP (plan de mejora con plazos) o gestiona salida con dignidad. Postergar solo empeora el equipo.',
      userCount: under.length,
      sampleNames: under.map(userName),
      ctaLabel: 'Revisar casos',
      ctaHref: `/dashboard/talento?cycle=${encodeURIComponent(cycleId)}&pool=underperformer`,
    });
  }

  // 5. Inconsistentes (box 4) → feedback y mentoring
  const inconsistent = usersInBoxes(data, [4]);
  if (inconsistent.length > 0) {
    recs.push({
      id: 'inconsistent-mentoring',
      severity: 'info',
      icon: '🎯',
      title: 'Desempeño irregular — oportunidad de coaching',
      description: 'Potencial alto pero entrega inconsistente. Suele ser falta de foco, mentor adecuado o claridad de expectativas. Check-ins frecuentes y metas SMART ayudan mucho.',
      userCount: inconsistent.length,
      sampleNames: inconsistent.map(userName),
      ctaLabel: 'Agendar 1:1',
      ctaHref: '/dashboard/feedback',
    });
  }

  return recs;
}
