'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';

/**
 * Right-to-explanation del empleado (ADR 0002 §8.bis).
 *
 * Muestra al empleado SOLO sus fortalezas y áreas de oportunidad.
 * NUNCA muestra:
 *  - Su readiness level (READY_NOW / READY_12M / etc.)
 *  - Su composite score numérico
 *  - Ranking comparativo con peers
 *  - Si fue endorsed o no por su manager
 *
 * El backend filtra esta info antes de retornarla — el frontend solo
 * presenta lo que recibe en lenguaje natural.
 */
export default function ExplicacionPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<{ strengths: string[]; opportunities: string[]; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.promotions
      .myExplanation(token)
      .then((d) => setData(d))
      .catch(() => setData({ strengths: [], opportunities: [], message: t('promotions.myExplanationEmpty') }))
      .finally(() => setLoading(false));
  }, [token, t]);

  if (loading) return <PageSkeleton cards={2} />;

  const hasData = data && (data.strengths.length > 0 || data.opportunities.length > 0);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('promotions.myExplanationTitle')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('promotions.myExplanationSubtitle')}
        </p>
      </div>

      {!hasData ? (
        <div className="card animate-fade-up" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>{t('promotions.myExplanationEmpty')}</p>
        </div>
      ) : (
        <>
          {/* Strengths */}
          {data!.strengths.length > 0 && (
            <div
              className="card animate-fade-up"
              style={{
                padding: '1.5rem', marginBottom: '1.25rem',
                borderLeft: '4px solid var(--success)',
              }}
            >
              <h3 style={{ fontWeight: 700, marginBottom: '1rem', color: 'var(--success)' }}>
                ✨ {t('promotions.strengthsTitle')}
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data!.strengths.map((s, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '0.6rem 0.85rem',
                      background: 'rgba(16,185,129,0.06)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                    }}
                  >
                    🟢 {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opportunities */}
          {data!.opportunities.length > 0 && (
            <div
              className="card animate-fade-up"
              style={{
                padding: '1.5rem', marginBottom: '1.25rem',
                borderLeft: '4px solid #6366f1',
              }}
            >
              <h3 style={{ fontWeight: 700, marginBottom: '1rem', color: '#6366f1' }}>
                🌱 {t('promotions.opportunitiesTitle')}
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data!.opportunities.map((o, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '0.6rem 0.85rem',
                      background: 'rgba(99,102,241,0.06)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                    }}
                  >
                    💡 {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Disclaimer footer (compliance) */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          background: 'rgba(0,0,0,0.02)',
        }}
      >
        ℹ️ {data?.message || t('promotions.myExplanationFooter')}
      </div>
    </div>
  );
}
