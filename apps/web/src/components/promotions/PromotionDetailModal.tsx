'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import useFocusTrap from '@/hooks/useFocusTrap';

const READINESS_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  READY_NOW: { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)', color: 'var(--success)' },
  READY_12M: { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.35)', color: '#6366f1' },
  DEVELOP_FIRST: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', color: '#d97706' },
  NOT_READY: { bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', color: '#6b7280' },
  INSUFFICIENT_DATA: { bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', color: '#6b7280' },
};

const DIM_KEYS = ['performance', 'potential', 'behavioral', 'growth', 'recognition', 'engagement'] as const;

export default function PromotionDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.promotions
      .explainCandidate(token, userId)
      .then((d: any) => setData(d))
      .catch((e: any) => setError(e?.message || t('promotions.loadError')))
      .finally(() => setLoading(false));
  }, [token, userId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promotion-detail-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        className="card animate-fade-up"
        style={{
          maxWidth: '760px', width: '100%', maxHeight: '90vh',
          overflowY: 'auto', padding: '1.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="promotion-detail-title" style={{ fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.25rem' }}>
          {t('promotions.detailTitle')}
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          {t('promotions.detailSubtitle')}
        </p>

        {loading && <p style={{ color: 'var(--text-muted)' }}>...</p>}
        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

        {data && (
          <>
            {/* Header con user info + readiness badge */}
            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.85rem 1rem', background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)', marginBottom: '1rem',
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {data.user?.firstName} {data.user?.lastName}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {data.user?.email} · {data.user?.position || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
                    ...(READINESS_COLORS[data.readiness] || READINESS_COLORS.NOT_READY),
                    background: (READINESS_COLORS[data.readiness] || READINESS_COLORS.NOT_READY).bg,
                    border: `1px solid ${(READINESS_COLORS[data.readiness] || READINESS_COLORS.NOT_READY).border}`,
                  }}
                >
                  {t(`promotions.readiness.${data.readiness}`)}
                </span>
                {data.compositeScore !== null && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Score: {Number(data.compositeScore).toFixed(2)}σ ·{' '}
                    {t(`promotions.confidence.${data.confidence}`)}
                  </div>
                )}
              </div>
            </div>

            {/* Explanation */}
            {data.explanation && (
              <div
                style={{
                  padding: '0.85rem 1rem', borderLeft: '3px solid var(--accent)',
                  background: 'rgba(201,147,58,0.04)', fontSize: '0.85rem',
                  lineHeight: 1.6, marginBottom: '1.25rem',
                }}
              >
                {data.explanation}
              </div>
            )}

            {/* 5 Dimensiones */}
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {t('promotions.dimensions')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
              {DIM_KEYS.map((key) => {
                const dim = data.dimensions?.[key];
                if (!dim) return null;
                const z = dim.zScore ?? 0;
                // Bar visual: -2σ a +2σ rango, normalizar a 0-100%
                const pct = Math.max(0, Math.min(100, ((z + 2) / 4) * 100));
                const color = z > 0.5 ? 'var(--success)' : z < -0.5 ? 'var(--danger)' : 'var(--text-muted)';
                return (
                  <div key={key} style={{ background: 'var(--bg-surface)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {t(`promotions.dim.${key}`)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          {t(`promotions.dim.${key}Desc`)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 80 }}>
                        <div style={{ fontWeight: 700, color, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {z >= 0 ? '+' : ''}{z.toFixed(2)}σ
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {Math.round((dim.weight ?? 0) * 100)}%
                        </div>
                      </div>
                    </div>
                    {/* Visual bar */}
                    <div
                      style={{
                        height: 6, background: 'var(--border)', borderRadius: 3, position: 'relative',
                        overflow: 'hidden', marginTop: '0.35rem',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute', left: '50%', top: 0, bottom: 0,
                          width: 2, background: 'var(--text-muted)', opacity: 0.4,
                        }}
                      />
                      <div
                        style={{
                          height: '100%', width: `${pct}%`, background: color, opacity: 0.7,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Filtros eliminatorios */}
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {t('promotions.filtersApplied')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
              {Object.entries(data.filters || {}).map(([key, info]: any) => (
                <div
                  key={key}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.4rem 0.6rem', fontSize: '0.78rem',
                    background: info.passed ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {t(`promotions.filtersBlock.${key}`, { defaultValue: key }) as string}
                  </span>
                  <span style={{ fontWeight: 600, color: info.passed ? 'var(--success)' : 'var(--danger)' }}>
                    {info.passed ? '✓ ' + t('promotions.filterPassed') : '✗ ' + t('promotions.filterFailed')}
                  </span>
                </div>
              ))}
            </div>

            {/* Cohort info */}
            {data.cohortInfo && (
              <div
                style={{
                  padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)', fontSize: '0.78rem',
                  color: 'var(--text-muted)', marginBottom: '1rem',
                }}
              >
                <strong>{t('promotions.cohortInfo')}:</strong>{' '}
                {t(`promotions.cohortStrategy.${data.cohortInfo.strategy}`)} · {' '}
                {t('promotions.cohortSize', { size: data.cohortInfo.size })}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
