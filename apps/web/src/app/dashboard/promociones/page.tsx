'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import dynamic from 'next/dynamic';
import { PlanGate } from '@/components/PlanGate';

const PromotionDetailModal = dynamic(
  () => import('@/components/promotions/PromotionDetailModal'),
  { ssr: false },
);
const PromotionActionModal = dynamic(
  () => import('@/components/promotions/PromotionActionModal'),
  { ssr: false },
);

type Readiness = 'READY_NOW' | 'READY_12M' | 'DEVELOP_FIRST' | 'NOT_READY' | 'INSUFFICIENT_DATA';
type Tab = 'candidates' | 'pending' | 'bias';

const READINESS_COLORS: Record<Readiness, { bg: string; border: string; color: string }> = {
  READY_NOW: { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)', color: 'var(--success)' },
  READY_12M: { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.35)', color: '#6366f1' },
  DEVELOP_FIRST: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', color: '#d97706' },
  NOT_READY: { bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', color: '#6b7280' },
  INSUFFICIENT_DATA: { bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', color: '#6b7280' },
};

function PromotionsPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const isManager = role === 'manager';
  const canSeePromotions = isAdmin || isManager;

  const [activeTab, setActiveTab] = useState<Tab>('candidates');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [pendingDecisions, setPendingDecisions] = useState<any[]>([]);
  const [biasData, setBiasData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [readinessFilter, setReadinessFilter] = useState<Readiness[]>([
    'READY_NOW', 'READY_12M', 'DEVELOP_FIRST',
  ]);
  const [searchText, setSearchText] = useState('');

  // Modal state
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    type: 'endorse' | 'reject' | 'decide';
    candidate?: any;
    decision?: any;
  } | null>(null);

  const reloadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const promises: Promise<any>[] = [];
      promises.push(
        api.promotions
          .listCandidates(token, { readiness: readinessFilter, q: searchText || undefined })
          .then((data: any) => setCandidates(Array.isArray(data) ? data : []))
          .catch(() => setCandidates([])),
      );
      if (isAdmin) {
        promises.push(
          api.promotions
            .pendingDecisions(token)
            .then((data: any) => setPendingDecisions(Array.isArray(data) ? data : []))
            .catch(() => setPendingDecisions([])),
        );
        promises.push(
          api.promotions
            .biasReport(token)
            .then((data: any) => setBiasData(data))
            .catch(() => setBiasData(null)),
        );
      }
      await Promise.all(promises);
    } catch (e: any) {
      setError(e?.message || t('promotions.loadError'));
    }
    setLoading(false);
  }, [token, readinessFilter, searchText, isAdmin, t]);

  useEffect(() => {
    if (canSeePromotions) reloadAll();
  }, [canSeePromotions, reloadAll]);

  const counts = useMemo(() => {
    const byReadiness = candidates.reduce(
      (acc: any, c: any) => {
        acc[c.readiness] = (acc[c.readiness] || 0) + 1;
        return acc;
      },
      {} as Record<Readiness, number>,
    );
    return {
      readyNow: byReadiness.READY_NOW || 0,
      ready12m: byReadiness.READY_12M || 0,
      developFirst: byReadiness.DEVELOP_FIRST || 0,
      pending: pendingDecisions.length,
    };
  }, [candidates, pendingDecisions]);

  if (!canSeePromotions) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t('promotions.pageTitle')}</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Esta vista solo está disponible para managers, RRHH y administradores.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;

  const subtitle = isAdmin ? t('promotions.subtitleAdmin') : t('promotions.subtitleManager');

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('promotions.pageTitle')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{subtitle}</p>
      </div>

      {/* Policy disclosure (compliance) */}
      <div
        className="card animate-fade-up"
        style={{
          padding: '0.85rem 1.1rem',
          marginBottom: '1.25rem',
          borderLeft: '3px solid #6366f1',
          background: 'rgba(99,102,241,0.04)',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        ℹ️ {t('promotions.policyDisclosure')}
      </div>

      {/* KPIs */}
      <div
        className="animate-fade-up-delay-1"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {[
          { label: t('promotions.kpiReadyNow'), value: counts.readyNow, color: READINESS_COLORS.READY_NOW.color },
          { label: t('promotions.kpiReady12m'), value: counts.ready12m, color: READINESS_COLORS.READY_12M.color },
          { label: t('promotions.kpiDevelopFirst'), value: counts.developFirst, color: READINESS_COLORS.DEVELOP_FIRST.color },
          ...(isAdmin
            ? [{ label: t('promotions.kpiPending'), value: counts.pending, color: 'var(--accent)' }]
            : []),
        ].map((kpi) => (
          <div key={kpi.label} className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                fontWeight: 600,
                marginBottom: '0.35rem',
              }}
            >
              {kpi.label}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div
        className="animate-fade-up-delay-1"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1rem',
        }}
      >
        {[
          { key: 'candidates' as Tab, label: t('promotions.tabCandidates'), count: candidates.length },
          ...(isAdmin
            ? [
                { key: 'pending' as Tab, label: t('promotions.tabPending'), count: counts.pending },
                { key: 'bias' as Tab, label: t('promotions.tabBias'), count: null as number | null },
              ]
            : []),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              padding: '0.6rem 1rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {tab.count !== null && (
              <span
                style={{
                  marginLeft: '0.4rem',
                  fontSize: '0.7rem',
                  background: activeTab === tab.key ? 'var(--accent)' : 'var(--bg-hover)',
                  color: activeTab === tab.key ? '#fff' : 'var(--text-muted)',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '10px',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="card"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            borderLeft: '3px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Tab Candidates */}
      {activeTab === 'candidates' && (
        <CandidatesView
          candidates={candidates}
          readinessFilter={readinessFilter}
          setReadinessFilter={setReadinessFilter}
          searchText={searchText}
          setSearchText={setSearchText}
          onViewDetail={(uid: string) => setDetailUserId(uid)}
          onEndorse={(c: any) => setActionModal({ type: 'endorse', candidate: c })}
          onReject={(c: any) => setActionModal({ type: 'reject', candidate: c })}
        />
      )}

      {/* Tab Pending Decisions (admin only) */}
      {activeTab === 'pending' && isAdmin && (
        <PendingDecisionsView
          decisions={pendingDecisions}
          onDecide={(d: any) => setActionModal({ type: 'decide', decision: d })}
          onViewDetail={(uid: string) => setDetailUserId(uid)}
        />
      )}

      {/* Tab Bias Report (admin only) */}
      {activeTab === 'bias' && isAdmin && <BiasReportView data={biasData} />}

      {/* Modals */}
      {detailUserId && (
        <PromotionDetailModal
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
        />
      )}
      {actionModal && (
        <PromotionActionModal
          mode={actionModal.type}
          candidate={actionModal.candidate}
          decision={actionModal.decision}
          onClose={() => setActionModal(null)}
          onSuccess={() => {
            setActionModal(null);
            reloadAll();
          }}
        />
      )}
    </div>
  );
}

/* ── Candidates View ─────────────────────────────────────────────── */

function CandidatesView({
  candidates,
  readinessFilter,
  setReadinessFilter,
  searchText,
  setSearchText,
  onViewDetail,
  onEndorse,
  onReject,
}: {
  candidates: any[];
  readinessFilter: Readiness[];
  setReadinessFilter: (r: Readiness[]) => void;
  searchText: string;
  setSearchText: (s: string) => void;
  onViewDetail: (userId: string) => void;
  onEndorse: (c: any) => void;
  onReject: (c: any) => void;
}) {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.user?.role || '');
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';

  const toggleReadiness = (r: Readiness) => {
    if (readinessFilter.includes(r)) {
      setReadinessFilter(readinessFilter.filter((x) => x !== r));
    } else {
      setReadinessFilter([...readinessFilter, r]);
    }
  };

  return (
    <>
      {/* Filters */}
      <div
        className="card"
        style={{
          padding: '1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          style={{
            padding: '0.4rem 0.65rem',
            fontSize: '0.82rem',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm, 6px)',
            color: 'var(--text-primary)',
            width: '220px',
          }}
          placeholder={t('promotions.filterSearch')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {t('promotions.filterReadiness')}:
          </span>
          {(['READY_NOW', 'READY_12M', 'DEVELOP_FIRST'] as Readiness[]).map((r) => {
            const active = readinessFilter.includes(r);
            const colors = READINESS_COLORS[r];
            return (
              <button
                key={r}
                onClick={() => toggleReadiness(r)}
                style={{
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: `1px solid ${active ? colors.border : 'var(--border)'}`,
                  background: active ? colors.bg : 'transparent',
                  color: active ? colors.color : 'var(--text-muted)',
                  borderRadius: '20px',
                  cursor: 'pointer',
                }}
              >
                {t(`promotions.readinessShort.${r}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {candidates.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{t('promotions.noCandidates')}</p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {t('promotions.noCandidatesDesc')}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('promotions.thName')}</th>
                  <th>{t('promotions.thPosition')}</th>
                  <th>{t('promotions.thReadiness')}</th>
                  <th>{t('promotions.thScore')}</th>
                  <th>{t('promotions.thConfidence')}</th>
                  <th>{t('promotions.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c: any) => {
                  const colors = READINESS_COLORS[c.readiness as Readiness] || READINESS_COLORS.NOT_READY;
                  const u = c.user || {};
                  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{u.position || '—'}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 20,
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            color: colors.color,
                          }}
                        >
                          {t(`promotions.readiness.${c.readiness}`)}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {c.compositeScore !== null ? `${Number(c.compositeScore).toFixed(2)}σ` : '—'}
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {t(`promotions.confidence.${c.confidence}`)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                            onClick={() => onViewDetail(c.userId)}
                          >
                            {t('promotions.viewDetail')}
                          </button>
                          {(c.readiness === 'READY_NOW' || c.readiness === 'READY_12M') && !isAdmin && (
                            <>
                              <button
                                className="btn-primary"
                                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                                onClick={() => onEndorse(c)}
                              >
                                {t('promotions.endorseBtn')}
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', color: 'var(--danger)' }}
                                onClick={() => onReject(c)}
                              >
                                {t('promotions.rejectBtn')}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Pending Decisions View (Admin) ──────────────────────────────── */

function PendingDecisionsView({
  decisions,
  onDecide,
  onViewDetail,
}: {
  decisions: any[];
  onDecide: (d: any) => void;
  onViewDetail: (userId: string) => void;
}) {
  const { t } = useTranslation();

  if (decisions.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontWeight: 600 }}>Sin endorsements pendientes de tu decisión</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>{t('promotions.thName')}</th>
              <th>{t('promotions.endorsementOf', { name: '...', date: '...' }).split(' el ')[0]}</th>
              <th style={{ minWidth: 120 }}>Comentario</th>
              <th>{t('promotions.thActions')}</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d: any) => {
              const u = d.user || {};
              const e = d.endorser || {};
              const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
              const endorserName = `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—';
              return (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ fontSize: '0.82rem' }}>
                    <div>{endorserName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {d.endorsedAt ? new Date(d.endorsedAt).toLocaleDateString('es-CL') : '—'}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.78rem', maxWidth: 320 }}>{d.endorsementComment || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => onViewDetail(d.userId)}
                      >
                        {t('promotions.viewDetail')}
                      </button>
                      <button
                        className="btn-primary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => onDecide(d)}
                      >
                        {t('promotions.decideBtn')}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Bias Report View (Admin) ────────────────────────────────────── */

function BiasReportView({ data }: { data: any | null }) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('promotions.biasNoData')}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t('promotions.biasReportTitle')}</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {t('promotions.biasReportDesc')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {t('promotions.totalEligibleLabel')}
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{data.totalEligible}</div>
        </div>
        <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {t('promotions.totalRecommendedLabel')}
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            {data.totalRecommended}
          </div>
        </div>
      </div>
      <div
        style={{
          padding: '0.85rem 1rem',
          borderRadius: 'var(--radius-sm)',
          background: data.flagged ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
          color: data.flagged ? 'var(--danger)' : 'var(--success)',
          fontWeight: 600,
          fontSize: '0.85rem',
        }}
      >
        {data.flagged ? t('promotions.biasFlagged') : t('promotions.biasOk')}
      </div>
      {(!data.reports || data.reports.length === 0) && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
          {t('promotions.biasNoData')}
        </p>
      )}
    </div>
  );
}

export default function PromotionsPage() {
  return (
    <PlanGate feature="PROMOTIONS">
      <PromotionsPageContent />
    </PlanGate>
  );
}
