'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { useDashboardStats } from '@/hooks/useDashboard';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { usePendingEvaluations } from '@/hooks/useEvaluations';
import { useCycles } from '@/hooks/useCycles';
import { usePerformanceHistory } from '@/hooks/usePerformanceHistory';
import { useFeedbackSummary } from '@/hooks/useFeedback';
import { useAtRiskObjectives } from '@/hooks/useObjectives';
import { assignmentStatusLabel, assignmentStatusBadge } from '@/lib/statusMaps';
import { api } from '@/lib/api';
import { ScoreBadge } from '@/components/ScoreBadge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useChangelog } from '@/hooks/useSystemChangelog';
import { getRoleLabel } from '@/lib/roles';
import { NextActionsWidget } from '@/components/NextActionsWidget';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Super Admin Dashboard ──────────────────────────────────────────────────

function SuperAdminDashboard() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [stats, setStats] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api.tenants.systemStats(token),
      api.tenants.listAllTickets(token).catch(() => []),
    ])
      .then(([statsData, ticketsData]) => {
        setStats(statsData);
        setTickets(Array.isArray(ticketsData) ? ticketsData : []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const kpis = [
    { label: t('dashboard.totalOrgs'), value: stats?.totalTenants ?? 0, color: '#6366f1' },
    { label: t('dashboard.globalUsers'), value: stats?.totalUsers ?? 0, color: '#10b981' },
    { label: t('dashboard.activeOrgs'), value: stats?.activeTenants ?? 0, color: '#f59e0b' },
    { label: t('dashboard.activeUsersCount'), value: stats?.activeUsers ?? 0, color: '#8b5cf6' },
  ];

  const recentTenants: any[] = stats?.recentTenants ?? [];

  const planBadge: Record<string, string> = {
    starter: 'badge-accent',
    pro: 'badge-warning',
    enterprise: 'badge-success',
  };

  if (loading) return <PageSkeleton cards={5} tableRows={4} />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
          {t('nav.systemPanel')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {t('dashboard.centralAdmin')}
        </p>
      </div>

      {error && (
        <div style={{
          padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '1.5rem',
        }}>
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div
        className="animate-fade-up-delay-1"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        {kpis.map((kpi, i) => (
          <div key={i} className="card" style={{ padding: '1.4rem', position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: '-20px', right: '-20px',
              width: '80px', height: '80px', borderRadius: '50%',
              background: `${kpi.color}18`,
            }} />
            <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '0.3rem', color: kpi.color }}>
              {kpi.value}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {kpi.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tickets summary */}
      {tickets.length > 0 && (() => {
        const open = tickets.filter((t: any) => t.status === 'open').length;
        const inReview = tickets.filter((t: any) => t.status === 'in_review').length;
        const responded = tickets.filter((t: any) => t.status === 'responded').length;
        const pending = open + inReview;
        return (
          <div className="card animate-fade-up-delay-1" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: pending > 0 ? '4px solid var(--accent)' : '4px solid var(--success)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: pending > 0 ? '0.75rem' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.3rem' }}>{'📋'}</span>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>{t('dashboard.requests')}</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                    {pending > 0 ? t('dashboard.pendingRequests', { count: pending }) : t('dashboard.allRequestsAnswered')}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.2rem', color: open > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{open}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.open')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.2rem', color: inReview > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{inReview}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.inReview')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--success)' }}>{responded}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.responded')}</div>
                </div>
                <Link href="/dashboard/solicitudes" className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', textDecoration: 'none' }}>
                  {t('dashboard.viewAll')}
                </Link>
              </div>
            </div>
            {/* Recent open tickets preview */}
            {open > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {tickets.filter((t: any) => t.status === 'open').slice(0, 3).map((t: any) => (
                  <Link key={t.id} href="/dashboard/solicitudes" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(201,147,58,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{t.subject}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                          {t.tenant?.name || ''} · {new Date(t.createdAt).toLocaleDateString('es-CL')}
                        </span>
                      </div>
                      <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>{t('solicitudes.status.open')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Quick nav */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[
          { label: t('dashboard.organizations'), href: '/dashboard/tenants' },
          { label: t('dashboard.subscriptions'), href: '/dashboard/subscriptions' },
          { label: t('dashboard.systemLog'), href: '/dashboard/audit-log' },
          { label: t('dashboard.usageMetrics'), href: '/dashboard/system-metrics' },
          { label: t('dashboard.requests'), href: '/dashboard/solicitudes' },
        ].map((nav, i) => (
          <Link key={i} href={nav.href} className="btn-ghost" style={{ fontSize: '0.85rem', textDecoration: 'none' }}>
            {nav.label}
          </Link>
        ))}
      </div>

      {/* Recent tenants table */}
      <div className="card animate-fade-up-delay-2" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{t('dashboard.lastOrgs')}</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{t('dashboard.recentRecords')}</p>
          </div>
          <Link href="/dashboard/tenants" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
            {`${t('dashboard.viewAll')} \u2192`}
          </Link>
        </div>

        {recentTenants.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {t('dashboard.noOrgsRegistered')}
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('dashboard.name')}</th>
                  <th>{t('dashboard.plan')}</th>
                  <th>{t('dashboard.users')}</th>
                  <th>{t('dashboard.created')}</th>
                </tr>
              </thead>
              <tbody>
                {recentTenants.slice(0, 10).map((t: any, i: number) => (
                  <tr key={t.id || i}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</td>
                    <td>
                      <span className={`badge ${planBadge[t.plan] ?? 'badge-accent'}`}>{t.plan}</span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t.userCount ?? t.maxEmployees ?? '-'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(t.createdAt).toLocaleDateString('es-ES')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Legacy Dashboards (kept for reference, not rendered) ────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8.5 ? '#10b981' : score >= 7 ? '#6366f1' : '#f59e0b';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <div style={{
        flex: 1, height: '6px', borderRadius: '999px',
        background: 'var(--bg-surface)',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '999px',
          background: color, transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color, minWidth: '2rem', textAlign: 'right' }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

const statusLabel = assignmentStatusLabel;
const statusBadge = assignmentStatusBadge;

function RegularDashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { data: stats, isLoading: loadingStats } = useDashboardStats();
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: perfHistory } = usePerformanceHistory(user?.userId ?? null);
  const { data: feedbackSummary } = useFeedbackSummary();
  const { data: atRiskObjectives } = useAtRiskObjectives();
  const { data: changelog } = useChangelog(3);
  const [showGuide, setShowGuide] = useState(true);

  const activeCycle = cycles?.find((c: any) => c.status === 'active');
  const atRiskCount = atRiskObjectives?.length || 0;

  const kpis = [
    {
      label: t('dashboard.activeEvals'),
      value: stats ? String(stats.totalAssignments) : '\u2013',
      color: '#6366f1',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      label: t('dashboard.evaluatedEmployees'),
      value: stats ? String(stats.completedAssignments) : '\u2013',
      color: '#10b981',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      label: t('dashboard.averageScore'),
      value: stats?.averageScore ? Number(stats.averageScore).toFixed(1) : '\u2013',
      color: '#f59e0b',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      label: t('dashboard.pendingToComplete'),
      value: stats ? String(stats.pendingAssignments) : '\u2013',
      color: '#ef4444',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  // Performance history chart data
  const perfData: any[] = Array.isArray(perfHistory?.history) ? perfHistory.history : [];

  // Feedback summary counters
  const positiveCount = feedbackSummary?.positive ?? 0;
  const neutralCount = feedbackSummary?.neutral ?? 0;
  const constructiveCount = feedbackSummary?.constructive ?? 0;
  const totalFeedback = positiveCount + neutralCount + constructiveCount;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
          {user?.role === 'external'
            ? t('dashboard.reviewPanel')
            : `${t('dashboard.hello')}, ${user?.firstName || user?.email?.split('@')[0] || 'usuario'}`}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {stats?.scope === 'team' && (
            <span style={{ marginLeft: '0.75rem', padding: '0.15rem 0.6rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>
              Mi equipo ({stats.teamSize} colaboradores)
            </span>
          )}
          {stats?.scope === 'personal' && (
            <span style={{ marginLeft: '0.75rem', padding: '0.15rem 0.6rem', background: 'rgba(16,185,129,0.1)', color: '#10b981', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>
              Mi desempeño
            </span>
          )}
        </p>
      </div>

      {/* Guide Panel — shown until user dismisses it */}
      {showGuide && (
        <div className="animate-fade-up-delay-1" style={{
          marginBottom: '2rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-card)',
          overflow: 'hidden',
        }}>
          {/* Guide header */}
          <div style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(201,147,58,0.08) 0%, transparent 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '8px',
                background: 'rgba(201,147,58,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C9933A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  {'\uD83D\uDDFA\uFE0F'} {t('dashboard.guideTitle')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t('dashboard.guideSubtitle')}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowGuide(false)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: '4px 8px', borderRadius: '6px',
                fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem',
                transition: 'background 0.15s',
              }}
              title="Descartar guía"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              {t('dashboard.dismissGuide')}
            </button>
          </div>

          {/* Steps grid */}
          <div style={{ padding: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {(ROLE_STEPS[user?.role || 'employee'] || ROLE_STEPS.employee).map((step, i) => (
              <Link key={i} href={step.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  padding: '0.875rem', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  position: 'relative', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201,147,58,0.4)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)';
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '8px', right: '8px',
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: 'var(--accent)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', fontWeight: 800, lineHeight: 1,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: '1.35rem', marginBottom: '0.4rem' }}>{step.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.2rem', color: 'var(--text-primary)' }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {step.desc}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {loadingStats ? (
        <Spinner />
      ) : (
        <div
          className="animate-fade-up-delay-1"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem',
          }}
        >
          {kpis.map((kpi, i) => (
            <div
              key={i}
              className="card"
              style={{ padding: '1.4rem', position: 'relative', overflow: 'hidden' }}
            >
              <div style={{
                position: 'absolute', top: '-20px', right: '-20px',
                width: '80px', height: '80px', borderRadius: '50%',
                background: `${kpi.color}18`,
              }} />
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '42px', height: '42px', borderRadius: '0.625rem',
                background: `${kpi.color}20`, color: kpi.color, marginBottom: '1rem',
              }}>
                {kpi.icon}
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '0.3rem' }}>
                {kpi.value}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                {kpi.label}
              </div>
              {stats && (
                <div style={{
                  fontSize: '0.75rem', fontWeight: 600,
                  color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                }}>
                  {stats.completionRate != null ? `${stats.completionRate}% ${t('dashboard.completed')}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* System changelog — compact strip */}
      {changelog && changelog.length > 0 && (
        <div className="animate-fade-up-delay-1" style={{
          padding: '0.75rem 1rem', marginBottom: '1.25rem',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, paddingTop: '1px' }}>
            {t('dashboard.news')}
          </span>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', flex: 1 }}>
            {changelog.map((entry: any) => (
              <span key={entry.id} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>v{entry.version}</strong> — {entry.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* At-risk objectives alert (Item 13) */}
      {atRiskCount > 0 && (
        <div className="animate-fade-up-delay-1" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', marginBottom: '1.25rem',
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
          borderRadius: 'var(--radius)', fontSize: '0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.1rem' }}>{'\u26a0'}</span>
            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>
              {t('dashboard.objectivesAtRisk', { count: atRiskCount })}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              {t('dashboard.objectivesAtRiskDetail')}
            </span>
          </div>
          <Link
            href="/dashboard/objetivos"
            style={{ fontSize: '0.78rem', color: 'var(--danger)', textDecoration: 'none', fontWeight: 600 }}
          >
            {`${t('dashboard.viewObjectives')} \u2192`}
          </Link>
        </div>
      )}

      {/* Next Actions widget — full width before grid */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.25rem' }}>
        <NextActionsWidget />
      </div>

      {/* Lower grid */}
      <div
        className="animate-fade-up-delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: '1.25rem',
        }}
      >
        {/* Recent evaluations table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{t('dashboard.pendingEvals')}</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{t('dashboard.assignmentsToComplete')}</p>
            </div>
            <Link href="/dashboard/evaluaciones" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
              {`${t('dashboard.viewAllLink')} \u2192`}
            </Link>
          </div>

          {loadingPending ? (
            <Spinner />
          ) : !pendingEvals || pendingEvals.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('dashboard.noPendingEvals')}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>{t('dashboard.evaluated')}</th>
                    <th>{t('dashboard.cycle')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('dashboard.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingEvals.slice(0, 5).map((ev: any, i: number) => (
                    <tr key={ev.id || i}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {ev.evaluatee
                            ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}`
                            : 'Sin asignar'}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {ev.cycle?.name || '\u2013'}
                      </td>
                      <td>
                        <span className={`badge ${statusBadge[ev.status] || 'badge-accent'}`}>
                          {statusLabel[ev.status] || ev.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                          className="btn-primary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
                        >
                          {t('dashboard.respond')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column: Progress + Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Cycle progress */}
          <div className="card" style={{ padding: '1.4rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
              {activeCycle ? activeCycle.name : t('dashboard.activeCycle')}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              {activeCycle
                ? t('dashboard.endsOn', { date: new Date(activeCycle.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) })
                : t('dashboard.noActiveCycle')}
            </p>

            {loadingCycles ? (
              <Spinner />
            ) : stats ? (
              <>
                {[
                  { label: t('dashboard.completedLabel'), value: stats.completedAssignments, total: stats.totalAssignments, color: 'var(--success)' },
                  { label: t('dashboard.pendingLabel'), value: stats.pendingAssignments, total: stats.totalAssignments, color: 'var(--warning)' },
                ].map((item, i) => (
                  <div key={i} style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.label}</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: item.color }}>
                        {item.value}/{item.total}
                      </span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                      <div style={{
                        width: item.total > 0 ? `${(item.value / item.total) * 100}%` : '0%',
                        height: '100%', borderRadius: '999px',
                        background: item.color, transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('dashboard.noDataAvailable')}</p>
            )}
          </div>

          {/* Quick actions */}
          <div className="card" style={{ padding: '1.4rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem' }}>{t('dashboard.quickActions')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {([
                { label: t('dashboard.myPerformance'), href: '/dashboard/mi-desempeno', roles: ['tenant_admin', 'manager', 'employee'] },
                { label: t('dashboard.newEvaluation'), href: '/dashboard/evaluaciones', roles: ['tenant_admin'] },
                { label: t('dashboard.addUser'), href: '/dashboard/usuarios', roles: ['tenant_admin'] },
                { label: t('dashboard.viewReports'), href: '/dashboard/reportes', roles: ['tenant_admin', 'manager'] },
              ] as { label: string; href: string; roles: string[] }[])
                .filter((a) => a.roles.includes(user?.role || ''))
                .map((action, i) => (
                  <Link
                    key={i}
                    href={action.href}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.65rem 0.875rem',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      transition: 'var(--transition)',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    {action.label}
                  </Link>
                ))}
            </div>
            {!showGuide && (
              <button
                onClick={() => setShowGuide(true)}
                style={{
                  marginTop: '0.75rem', width: '100%', background: 'transparent',
                  border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '0.5rem', cursor: 'pointer', fontSize: '0.78rem',
                  color: 'var(--text-muted)', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
                </svg>
                {t('dashboard.showGuide')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Performance Trend + Feedback cards — show feedback only if user has data */}
      <div
        className="animate-fade-up-delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: totalFeedback > 0 ? '1fr 340px' : '1fr',
          gap: '1.25rem',
          marginTop: '1.25rem',
        }}
      >
        {/* Tendencia de Desempeno */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            {t('dashboard.perfTrend')}
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            {t('dashboard.avgScoreByCycle')}
          </p>
          {perfData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={perfData}>
                <XAxis
                  dataKey="cycleName"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 10]}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avgOverall"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#6366f1', stroke: '#6366f1' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('dashboard.noPerfHistory')}
            </div>
          )}
        </div>

        {/* Mi Feedback — show only when user has received feedback */}
        {totalFeedback > 0 && <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            {t('dashboard.myFeedback')}
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            {t('dashboard.feedbackSummary')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Positivo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.15)', color: '#10b981',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '0.9rem', flexShrink: 0,
              }}>
                {positiveCount}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('dashboard.positive')}</span>
            </div>

            {/* Neutral */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: 'rgba(156, 163, 175, 0.15)', color: '#9ca3af',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '0.9rem', flexShrink: 0,
              }}>
                {neutralCount}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('dashboard.neutral')}</span>
            </div>

            {/* Constructivo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '0.9rem', flexShrink: 0,
              }}>
                {constructiveCount}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('dashboard.constructive')}</span>
            </div>
          </div>

          <div style={{
            marginTop: '1.25rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {t('common.total')}: <strong style={{ color: 'var(--text-primary)' }}>{totalFeedback}</strong>
            </span>
            <Link
              href="/dashboard/feedback"
              style={{
                fontSize: '0.78rem',
                color: 'var(--accent-hover)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              {`${t('dashboard.viewFeedback')} \u2192`}
            </Link>
          </div>
        </div>}
      </div>
    </div>
  );
}

// ─── Employee Dashboard ─────────────────────────────────────────────────────

function EmployeeDashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: perfHistory } = usePerformanceHistory(user?.userId ?? null);
  const [objectives, setObjectives] = useState<any[]>([]);
  const [loadingObj, setLoadingObj] = useState(true);
  const [feedbackCount, setFeedbackCount] = useState({ positive: 0, neutral: 0, constructive: 0 });

  // Fetch objectives for this user
  useEffect(() => {
    if (!token || !user?.userId) return;
    api.objectives.list(token, user.userId)
      .then((data: any) => setObjectives(Array.isArray(data) ? data : (data?.data || [])))
      .catch(() => {})
      .finally(() => setLoadingObj(false));
  }, [token, user?.userId]);

  // Fetch feedback summary
  useEffect(() => {
    if (!token) return;
    api.feedback.summary(token)
      .then((data: any) => {
        if (data) setFeedbackCount({ positive: data.positive || 0, neutral: data.neutral || 0, constructive: data.constructive || 0 });
      })
      .catch(() => {});
  }, [token]);

  const perfData: any[] = Array.isArray(perfHistory?.history) ? perfHistory.history : [];
  const pendingList = pendingEvals || [];
  const activeObjectives = objectives.filter((o: any) => o.status === 'active');
  const totalFeedback = feedbackCount.positive + feedbackCount.neutral + feedbackCount.constructive;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
          {t('dashboard.hello')}, {user?.firstName || user?.email?.split('@')[0] || 'usuario'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Quick KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('dashboard.pendingEvals')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: pendingList.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{pendingList.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('dashboard.activeObjectives')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{activeObjectives.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('dashboard.feedbackReceived')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{totalFeedback}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('dashboard.lastScore')}</div>
          <div style={{ marginTop: '0.25rem' }}>
            {perfData.length > 0
              ? <ScoreBadge score={perfData[perfData.length - 1].avgOverall} size="lg" />
              : <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-muted)' }}>--</span>
            }
          </div>
        </div>
      </div>

      {/* Pending evaluations */}
      <div className="animate-fade-up-delay-2" style={{ marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{t('dashboard.myPendingEvals')}</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{t('dashboard.evalsToComplete')}</p>
            </div>
          </div>
          {loadingPending ? <Spinner /> : pendingList.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('dashboard.noPendingEvalsEmployee')}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>{t('dashboard.evaluated')}</th>
                    <th>{t('dashboard.type')}</th>
                    <th>{t('dashboard.cycle')}</th>
                    <th>{t('dashboard.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingList.map((ev: any, i: number) => (
                    <tr key={ev.id || i}>
                      <td style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                        {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : 'Sin asignar'}
                        {ev.evaluateeId === user?.userId && <span className="badge badge-accent" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>{t('dashboard.selfEval')}</span>}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {ev.relationType === 'self' ? t('dashboard.selfEval') : ev.relationType === 'manager' ? t('dashboard.manager') : ev.relationType === 'peer' ? t('dashboard.peer') : ev.relationType || '--'}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{ev.cycle?.name || '--'}</td>
                      <td>
                        <Link
                          href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                          className="btn-primary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
                        >
                          {t('dashboard.respond')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom grid: Performance trend + Objectives */}
      <div className="animate-fade-up-delay-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        {/* Performance trend */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>{t('dashboard.myPerfHistory')}</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>{t('dashboard.perfEvolution')}</p>
          {perfData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={perfData}>
                <XAxis dataKey="cycleName" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} width={25} />
                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '0.5rem', fontSize: '0.8rem' }} />
                <Line type="monotone" dataKey="avgOverall" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('dashboard.noPerfHistoryEmployee')}
            </div>
          )}
        </div>

        {/* Active objectives */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.1rem' }}>{t('dashboard.myObjectives')}</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('dashboard.activeCount', { count: activeObjectives.length })}</p>
            </div>
            <Link href="/dashboard/objetivos" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
              {`${t('dashboard.viewAllObjectives')} \u2192`}
            </Link>
          </div>
          {loadingObj ? <Spinner /> : activeObjectives.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('dashboard.noActiveObjectives')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {activeObjectives.slice(0, 4).map((obj: any) => (
                <div key={obj.id} style={{ padding: '0.6rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{obj.title}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#6366f1' }}>{obj.progress || 0}%</span>
                  </div>
                  <div style={{ height: '4px', borderRadius: '999px', background: 'var(--border)' }}>
                    <div style={{ height: '100%', width: `${obj.progress || 0}%`, background: '#6366f1', borderRadius: '999px', transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main export: route by role ─────────────────────────────────────────────

// ─── Role-based Journey Steps ──────────────────────────────────────────────

const ROLE_STEPS: Record<string, Array<{ icon: string; title: string; desc: string; href: string }>> = {
  tenant_admin: [
    {
      icon: '\uD83D\uDC65',
      title: 'Configurar equipo',
      desc: 'Importa colaboradores, asigna roles y define departamentos',
      href: '/dashboard/usuarios',
    },
    {
      icon: '\uD83D\uDCCB',
      title: 'Crear plantilla',
      desc: 'Dise\u00f1a el formulario de evaluaci\u00f3n de competencias',
      href: '/dashboard/plantillas',
    },
    {
      icon: '\uD83D\uDD04',
      title: 'Lanzar ciclo',
      desc: 'Configura un ciclo 90\u00b0, 180\u00b0, 270\u00b0 o 360\u00b0 y asigna evaluadores',
      href: '/dashboard/evaluaciones/nuevo',
    },
    {
      icon: '\uD83D\uDCCA',
      title: 'Revisar resultados',
      desc: 'Analiza puntajes, brechas y tendencias de desempe\u00f1o',
      href: '/dashboard/informes',
    },
    {
      icon: '\uD83D\uDCC8',
      title: 'Calibrar evaluaciones',
      desc: 'Ajusta y valida puntajes en sesi\u00f3n de calibraci\u00f3n',
      href: '/dashboard/calibracion',
    },
    {
      icon: '\uD83C\uDFAF',
      title: 'Definir OKRs',
      desc: 'Establece objetivos clave y resultados medibles para el equipo',
      href: '/dashboard/objetivos',
    },
    {
      icon: '\uD83D\uDCAC',
      title: 'Feedback y Check-ins',
      desc: 'Gestiona retroalimentaci\u00f3n continua y reuniones 1:1 del equipo',
      href: '/dashboard/feedback',
    },
    {
      icon: '\uD83D\uDCCB',
      title: 'Planes de desarrollo',
      desc: 'Crea planes individuales con acciones y metas de crecimiento',
      href: '/dashboard/desarrollo',
    },
    {
      icon: '\uD83C\uDFE2',
      title: 'Plan organizacional',
      desc: 'Define iniciativas estrat\u00e9gicas de desarrollo a nivel empresa',
      href: '/dashboard/desarrollo-organizacional',
    },
  ],
  manager: [
    {
      icon: '\u2705',
      title: 'Evaluar mi equipo',
      desc: 'Completa las evaluaciones de desempe\u00f1o asignadas',
      href: '/dashboard/evaluaciones',
    },
    {
      icon: '\uD83D\uDCC5',
      title: 'Check-ins 1:1',
      desc: 'Agenda y registra reuniones peri\u00f3dicas con cada colaborador',
      href: '/dashboard/feedback',
    },
    {
      icon: '\u26A1',
      title: 'Feedback r\u00e1pido',
      desc: 'Env\u00eda reconocimiento o feedback constructivo en el momento',
      href: '/dashboard/feedback',
    },
    {
      icon: '\uD83C\uDFAF',
      title: 'OKRs del equipo',
      desc: 'Revisa el avance de objetivos y actualiza el progreso',
      href: '/dashboard/objetivos',
    },
    {
      icon: '\uD83D\uDCC8',
      title: 'Ver resultados',
      desc: 'Analiza el desempe\u00f1o consolidado de tu equipo',
      href: '/dashboard/reportes',
    },
    {
      icon: '\uD83D\uDCCB',
      title: 'Planes de desarrollo',
      desc: 'Crea y hace seguimiento a los PDI de cada colaborador',
      href: '/dashboard/desarrollo',
    },
    {
      icon: '\uD83C\uDFE2',
      title: 'Plan organizacional',
      desc: 'Consulta las iniciativas estrat\u00e9gicas de tu departamento',
      href: '/dashboard/desarrollo-organizacional',
    },
    {
      icon: '\u2B50',
      title: 'Reconocer logros',
      desc: 'Destaca las contribuciones y logros del equipo',
      href: '/dashboard/reconocimientos',
    },
  ],
  employee: [
    {
      icon: '\u270F\uFE0F',
      title: 'Autoevaluaci\u00f3n',
      desc: 'Completa tu autoevaluaci\u00f3n de desempe\u00f1o y competencias',
      href: '/dashboard/evaluaciones',
    },
    {
      icon: '\uD83C\uDFAF',
      title: 'Mis OKRs',
      desc: 'Define tus objetivos personales y registra el avance',
      href: '/dashboard/objetivos',
    },
    {
      icon: '\uD83D\uDCC5',
      title: 'Check-in con mi jefe',
      desc: 'Prepara y registra tus reuniones 1:1 peri\u00f3dicas',
      href: '/dashboard/feedback',
    },
    {
      icon: '\uD83D\uDCAC',
      title: 'Pedir feedback',
      desc: 'Solicita retroalimentaci\u00f3n de colegas, pares y jefatura',
      href: '/dashboard/feedback',
    },
    {
      icon: '\uD83D\uDCCB',
      title: 'Mi plan de desarrollo',
      desc: 'Trabaja en tus acciones de crecimiento y competencias',
      href: '/dashboard/desarrollo',
    },
    {
      icon: '\uD83D\uDCCA',
      title: 'Mi desempe\u00f1o',
      desc: 'Revisa tus evaluaciones, puntajes y evoluci\u00f3n hist\u00f3rica',
      href: '/dashboard/mi-desempeno',
    },
    {
      icon: '\u2B50',
      title: 'Reconocimientos',
      desc: 'Reconoce las contribuciones de tus compa\u00f1eros',
      href: '/dashboard/reconocimientos',
    },
    {
      icon: '\uD83D\uDCDD',
      title: 'Encuestas de clima',
      desc: 'Responde las encuestas de clima laboral y bienestar de tu organizaci\u00f3n',
      href: '/dashboard/encuestas',
    },
    {
      icon: '\u270D\uFE0F',
      title: 'Firmas digitales',
      desc: 'Revisa y firma documentos pendientes (evaluaciones, planes, contratos)',
      href: '/dashboard/firmas',
    },
  ],
  external: [
    {
      icon: '\u2705',
      title: 'Mis evaluaciones',
      desc: 'Completa las evaluaciones que te han sido asignadas',
      href: '/dashboard/evaluaciones',
    },
    {
      icon: '\uD83D\uDCAC',
      title: 'Feedback',
      desc: 'Env\u00eda retroalimentaci\u00f3n a los colaboradores evaluados',
      href: '/dashboard/feedback',
    },
    {
      icon: '\uD83D\uDCCA',
      title: 'Resultados',
      desc: 'Revisa los resultados disponibles para ti',
      href: '/dashboard/mi-desempeno',
    },
  ],
};

const TYPE_ICONS: Record<string, string> = { feature: '\uD83C\uDD95', improvement: '\u2728', fix: '\uD83D\uDD27' };

// ─── Stats Sidebar (role-aware) ──────────────────────────────────────────────

function DashboardStats() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const role = user?.role || 'employee';
  const isAdminOrManager = role === 'tenant_admin' || role === 'manager';

  const { data: stats } = useDashboardStats();
  const { data: pending } = usePendingEvaluations();
  const { data: cycles } = useCycles();
  const { data: feedbackSummary } = useFeedbackSummary();
  const { data: atRisk } = useAtRiskObjectives(isAdminOrManager ? undefined : user?.userId);

  const activeCycles = cycles?.filter((c: any) => c.status === 'active') || [];
  const pendingCount = Array.isArray(pending) ? pending.length : 0;
  const atRiskCount = Array.isArray(atRisk) ? atRisk.length : 0;

  const cardStyle: React.CSSProperties = {
    padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    background: 'var(--bg-card)',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem',
  };
  const valueStyle: React.CSSProperties = {
    fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem' }}>
        {t('dashboard.summary')}
      </h3>

      {/* Pending evaluations — all roles */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t('dashboard.pendingEvals')}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ ...valueStyle, color: pendingCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {pendingCount}
          </span>
          {pendingCount > 0 && (
            <Link href="/dashboard/evaluaciones" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>
              {t('dashboard.complete')}
            </Link>
          )}
        </div>
      </div>

      {/* Active cycles — admin/manager */}
      {isAdminOrManager && (
        <div style={cardStyle}>
          <div style={labelStyle}>{t('dashboard.activeCycles')}</div>
          <div style={valueStyle}>{activeCycles.length}</div>
          {stats && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{t('dashboard.completion')}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{stats.completionRate || 0}%</span>
              </div>
              <div style={{
                marginTop: '0.3rem', height: '6px', borderRadius: '3px',
                background: 'var(--border)',
              }}>
                <div style={{
                  height: '100%', borderRadius: '3px',
                  width: `${Math.min(stats.completionRate || 0, 100)}%`,
                  background: (stats.completionRate || 0) >= 80 ? 'var(--success)' : (stats.completionRate || 0) >= 50 ? 'var(--warning)' : 'var(--danger)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Score — admin/manager */}
      {isAdminOrManager && stats?.averageScore && (
        <div style={cardStyle}>
          <div style={labelStyle}>{t('dashboard.scoreAvg')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={valueStyle}>{Number(stats.averageScore).toFixed(1)}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/ 10</span>
          </div>
        </div>
      )}

      {/* At-risk objectives — all roles */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t('dashboard.atRiskObjectives')}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ ...valueStyle, color: atRiskCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {atRiskCount}
          </span>
          {atRiskCount > 0 && (
            <Link href="/dashboard/objetivos" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>
              {t('dashboard.viewDetail')}
            </Link>
          )}
        </div>
      </div>

      {/* Feedback summary — all roles */}
      {feedbackSummary && feedbackSummary.total > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>{t('dashboard.feedbackReceived')}</div>
          <div style={valueStyle}>{feedbackSummary.total}</div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
            <span className="badge badge-success">{feedbackSummary.positive} {t('dashboard.positiveLabel')}</span>
            <span className="badge badge-warning">{feedbackSummary.neutral} {t('dashboard.neutralLabel')}</span>
            <span className="badge badge-danger">{feedbackSummary.constructive} {t('dashboard.constructiveLabel')}</span>
          </div>
        </div>
      )}

      {/* Admin-specific: total users */}
      {role === 'tenant_admin' && stats && (
        <div style={cardStyle}>
          <div style={labelStyle}>{t('dashboard.totalEvals')}</div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{stats.completedAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.completedEvals')}</div>
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>{stats.pendingAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.pendingEvals2')}</div>
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats.totalAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('dashboard.totalLabel')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Welcome Page ────────────────────────────────────────────────────────────

function WelcomePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { data: changelog, isLoading: loadingCL, isError: errorCL } = useChangelog(5);
  const steps = ROLE_STEPS[user?.role || 'employee'] || ROLE_STEPS.employee;
  const today = new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const quickLinks = [
    { label: t('dashboard.evaluations'), href: '/dashboard/evaluaciones', icon: '\uD83D\uDCDD' },
    { label: t('dashboard.objectives'), href: '/dashboard/objetivos', icon: '\uD83C\uDFAF' },
    { label: t('dashboard.feedback'), href: '/dashboard/feedback', icon: '\uD83D\uDCAC' },
    { label: t('dashboard.notifications'), href: '/dashboard/notificaciones', icon: '\uD83D\uDD14' },
  ];

  return (
    <div style={{ display: 'flex', gap: '2rem', maxWidth: '1200px' }}>
    {/* Left: main content */}
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Welcome Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {'\uD83D\uDC4B'} {t('dashboard.welcomeTo')}, {user?.firstName || 'Usuario'}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {getRoleLabel(user?.role || 'employee')} {'\u00B7'} {today}
        </p>
      </div>

      {/* System Changelog */}
      {loadingCL && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--border)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('dashboard.loadingNews')}</p>
        </div>
      )}
      {errorCL && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid #f59e0b' }}>
          <p style={{ color: '#92400e', fontSize: '0.85rem' }}>{t('dashboard.newsLoadError')}</p>
        </div>
      )}
      {!loadingCL && changelog && changelog.length > 0 && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--primary)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\uD83D\uDCE2'} {t('dashboard.systemNews')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {changelog.map((entry: any) => (
              <div key={entry.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{TYPE_ICONS[entry.type] || '\uD83C\uDD95'}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    v{entry.version} — {entry.title}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{entry.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journey Steps */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {'\uD83D\uDDFA\uFE0F'} {t('dashboard.howToUse')}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
          {steps.map((step, i) => (
            <Link key={i} href={step.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card step-card" style={{
                padding: '1rem', cursor: 'pointer', position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700,
                }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{step.icon}</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>{step.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{step.desc}</div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                  {t('dashboard.go')} {'\u2192'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Access */}
      <div className="card" style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.75rem' }}>{'\u26A1'} {t('dashboard.quickAccess')}</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid var(--border)',
                textDecoration: 'none', color: 'var(--text-primary)', fontSize: '0.85rem',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span>{link.icon}</span> {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>

    {/* Right: Stats Panel */}
    <div style={{ width: '280px', flexShrink: 0 }} className="dashboard-stats-panel">
      <DashboardStats />
    </div>

    {/* Responsive: stack on small screens */}
    <style>{`
      @media (max-width: 900px) {
        .dashboard-stats-panel { display: none !important; }
      }
    `}</style>
    </div>
  );
}

// ─── Admin Dashboard (Tenant Admin — Vista Ejecutiva) ──────────────────────

function AdminDashboard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const { data: cycles } = useCycles();
  const [loading, setLoading] = useState(true);
  const [execData, setExecData] = useState<any>(null);
  const [turnover, setTurnover] = useState<any>(null);
  const [pdi, setPdi] = useState<any>(null);
  const [systemUsage, setSystemUsage] = useState<any>(null);
  const [aiQuota, setAiQuota] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [nextActions, setNextActions] = useState<any>(null);
  const [cycleSummary, setCycleSummary] = useState<any>(null);

  const closedCycles = (cycles || []).filter((c: any) => c.status === 'closed').sort((a: any, b: any) => new Date(b.endDate || b.createdAt).getTime() - new Date(a.endDate || a.createdAt).getTime());
  const activeCycles = (cycles || []).filter((c: any) => c.status === 'active');
  const latestClosedId = closedCycles[0]?.id;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      latestClosedId ? api.reports.executiveDashboard(token, latestClosedId).catch(() => null) : Promise.resolve(null),
      api.reports.turnover(token).catch(() => null),
      api.reports.pdiCompliance(token).catch(() => null),
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/system-usage`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).catch(() => null),
      api.ai.getUsage(token).catch(() => null),
      api.subscriptions.mySubscription(token).catch(() => null),
      api.contracts.list(token).catch(() => []),
      api.dashboard.nextActions(token).catch(() => null),
      latestClosedId ? api.reports.cycleSummary(token, latestClosedId).catch(() => null) : Promise.resolve(null),
    ]).then(([exec, turn, pdiData, usage, quota, sub, ctrs, actions, summary]) => {
      setExecData(exec); setTurnover(turn); setPdi(pdiData); setSystemUsage(usage);
      setAiQuota(quota); setSubscription(sub); setContracts(Array.isArray(ctrs) ? ctrs : []);
      setNextActions(actions); setCycleSummary(summary);
    }).finally(() => setLoading(false));
  }, [token, latestClosedId]);

  if (loading) return <PageSkeleton cards={9} tableRows={4} />;

  const hc = execData?.headcount || {};
  const perf = execData?.performance || {};
  const obj = execData?.objectives || {};
  const enps = execData?.enps;
  const depts = (cycleSummary?.departmentBreakdown || []).map((d: any) => ({ ...d, avgScore: Number(d.avgScore) || 0 })).sort((a: any, b: any) => b.avgScore - a.avgScore);
  const plan = subscription?.plan;
  const pendingContracts = contracts.filter((c: any) => c.status === 'pending_signature').length;
  const now = new Date();

  // Subscription days remaining
  const subEndDate = subscription?.nextBillingDate ? new Date(subscription.nextBillingDate) : (subscription?.endDate ? new Date(subscription.endDate) : null);
  const subDaysLeft = subEndDate ? Math.ceil((subEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Alerts
  const alerts: Array<{ icon: string; color: string; text: string; href?: string }> = [];
  if (nextActions?.highPriority > 0) alerts.push({ icon: '🔴', color: 'var(--danger)', text: `${nextActions.highPriority} acciones urgentes pendientes`, href: '/dashboard/evaluaciones' });
  if (((obj.total || 0) - (obj.completed || 0)) > 0 && (obj.completionPct || 0) < 50) alerts.push({ icon: '🟡', color: 'var(--warning)', text: `OKRs al ${obj.completionPct || 0}% — ${(obj.total || 0) - (obj.completed || 0)} pendientes`, href: '/dashboard/objetivos' });
  if (pdi?.overdueActions > 0) alerts.push({ icon: '🟡', color: 'var(--warning)', text: `${pdi.overdueActions} acciones PDI vencidas`, href: '/dashboard/desarrollo' });
  if (pendingContracts > 0) alerts.push({ icon: '🔵', color: 'var(--accent)', text: `${pendingContracts} contrato(s) pendiente(s) de firma`, href: '/dashboard/contratos' });
  if (subDaysLeft != null && subDaysLeft <= 30 && subDaysLeft > 0) alerts.push({ icon: '🔵', color: 'var(--accent)', text: `Suscripción se renueva en ${subDaysLeft} días` });

  const kpiStyle: React.CSSProperties = { padding: '0.85rem', textAlign: 'center' };
  const kpiLabel: React.CSSProperties = { fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.15rem' };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.15rem' }}>Hola, {user?.firstName}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Vista ejecutiva de tu organización — {now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPIs Row 1 — Principal */}
      <div className="animate-fade-up" style={{ marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Indicadores Clave</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>Colaboradores</div><div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--success)' }}>{hc.active || 0}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>activos</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>Desempeño</div><div style={{ fontSize: '1.3rem', fontWeight: 800, color: Number(perf.avgScore) >= 7 ? 'var(--success)' : Number(perf.avgScore) >= 5 ? 'var(--warning)' : 'var(--danger)' }}>{Number(perf.avgScore || 0).toFixed(1)}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>promedio</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>eNPS</div><div style={{ fontSize: '1.3rem', fontWeight: 800, color: (enps?.score ?? 0) >= 30 ? 'var(--success)' : (enps?.score ?? 0) >= 0 ? 'var(--warning)' : 'var(--danger)' }}>{enps?.score ?? '—'}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>clima</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>OKRs</div><div style={{ fontSize: '1.3rem', fontWeight: 800, color: obj.total > 0 ? (obj.completionPct >= 70 ? 'var(--success)' : obj.completionPct >= 40 ? 'var(--warning)' : 'var(--danger)') : 'var(--text-muted)' }}>{obj.total > 0 ? `${obj.completionPct || 0}%` : '—'}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>cumplimiento</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>Rotación</div><div style={{ fontSize: '1.3rem', fontWeight: 800, color: (turnover?.turnoverRate || 0) > 15 ? 'var(--danger)' : (turnover?.turnoverRate || 0) > 8 ? 'var(--warning)' : 'var(--success)' }}>{turnover?.turnoverRate || 0}%</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>anual</div></div>
        </div>
      </div>

      {/* KPIs Row 2 — Secundarios */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>PDI Completitud</div><div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{pdi?.completionRate || 0}%</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>Adopción (MAU)</div><div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{systemUsage?.adoptionRate || 0}%</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{systemUsage?.mau || 0} activos/mes</div></div>
          <div className="card" style={kpiStyle}><div style={kpiLabel}>Eval. Completitud</div><div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{perf.completionRate || 0}%</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{perf.completedAssignments || 0}/{perf.totalAssignments || 0}</div></div>
          {aiQuota && <div className="card" style={kpiStyle}><div style={kpiLabel}>IA Créditos</div><div style={{ fontSize: '1.2rem', fontWeight: 800, color: aiQuota.nearLimit ? 'var(--danger)' : 'var(--text-primary)' }}>{aiQuota.monthlyRemaining ?? '—'}/{aiQuota.monthlyLimit ?? '—'}</div></div>}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.25rem', borderLeft: '4px solid var(--warning)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--warning)' }}>Alertas y Acciones Urgentes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                <span>{a.icon}</span>
                <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{a.text}</span>
                {a.href && <Link href={a.href} style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>Ver →</Link>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
        {/* Semáforo de Áreas */}
        <div className="card animate-fade-up" style={{ padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Semáforo de Áreas</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Desempeño promedio por departamento del último ciclo cerrado.</p>
          {depts.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin datos de ciclos cerrados.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {depts.slice(0, 8).map((d: any) => {
                const color = d.avgScore >= 7 ? 'var(--success)' : d.avgScore >= 5 ? 'var(--warning)' : 'var(--danger)';
                return (
                  <div key={d.department} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{d.department}</span>
                    <span style={{ fontWeight: 700, color }}>{d.avgScore.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actividad Reciente */}
        <div className="card animate-fade-up" style={{ padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Actividad del Sistema</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Uso del sistema en los últimos días.</p>
          {!systemUsage ? <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin datos de uso disponibles.</p> : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.75rem' }}>
                {(systemUsage.dailyActivity || []).slice(-5).map((d: any) => (
                  <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.2rem 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{d.date}</span>
                    <span><strong>{d.actions}</strong> acciones · <strong>{d.users}</strong> usuarios</span>
                  </div>
                ))}
              </div>
              {(systemUsage.moduleUsage || []).length > 0 && (
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Módulos más usados:</div>
                  {systemUsage.moduleUsage.slice(0, 5).map((m: any) => (
                    <div key={m.module} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.15rem 0' }}>
                      <span>{m.module}</span><span style={{ fontWeight: 600 }}>{m.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Two column grid — processes + subscription */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
        {/* Estado de Procesos */}
        <div className="card animate-fade-up" style={{ padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Estado de Procesos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.82rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Ciclo activo</span>
              <span style={{ fontWeight: 600 }}>{activeCycles[0]?.name || 'Ninguno'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Completitud evaluaciones</span>
              <span style={{ fontWeight: 600 }}>{perf.completionRate || 0}% ({perf.completedAssignments || 0}/{perf.totalAssignments || 0})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>PDI activos</span>
              <span style={{ fontWeight: 600 }}>{pdi?.totalPlans || 0} ({pdi?.completionRate || 0}% completados)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Contratos pendientes</span>
              <span style={{ fontWeight: 600, color: pendingContracts > 0 ? 'var(--warning)' : 'var(--success)' }}>{pendingContracts}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Desarrollo organizacional</span>
              <span style={{ fontWeight: 600 }}>{execData?.orgDevelopment?.activePlans || 0} planes · {execData?.orgDevelopment?.completedInitiatives || 0}/{execData?.orgDevelopment?.totalInitiatives || 0} iniciativas</span>
            </div>
          </div>
        </div>

        {/* Mi Suscripción */}
        <div className="card animate-fade-up" style={{ padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Mi Suscripción</div>
          {!subscription ? <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin suscripción activa.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Plan</span>
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{plan?.name || subscription.planName || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Usuarios</span>
                <span style={{ fontWeight: 600 }}>{hc.active || 0} / {plan?.maxEmployees || '∞'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Estado</span>
                <span className={`badge ${subscription.status === 'active' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.68rem' }}>{subscription.status === 'active' ? 'Activa' : subscription.status}</span>
              </div>
              {subDaysLeft != null && subDaysLeft > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Renovación</span>
                  <span style={{ fontWeight: 600, color: subDaysLeft <= 15 ? 'var(--danger)' : 'var(--text-primary)' }}>{subDaysLeft} días</span>
                </div>
              )}
              {aiQuota && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Créditos IA</span>
                  <span style={{ fontWeight: 600 }}>{aiQuota.monthlyRemaining ?? 0} restantes de {aiQuota.monthlyLimit ?? 0}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card animate-fade-up" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Accesos Rápidos</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
          {[
            { label: 'Usuarios', href: '/dashboard/usuarios', icon: '👥' },
            { label: 'Evaluaciones', href: '/dashboard/evaluaciones', icon: '📋' },
            { label: 'Reportes', href: '/dashboard/reportes', icon: '📊' },
            { label: 'Ajustes', href: '/dashboard/ajustes', icon: '⚙️' },
            { label: 'Objetivos', href: '/dashboard/objetivos', icon: '🎯' },
            { label: 'Feedback', href: '/dashboard/feedback', icon: '💬' },
            { label: 'Desarrollo', href: '/dashboard/desarrollo', icon: '📈' },
            { label: 'Clima', href: '/dashboard/encuestas-clima', icon: '🌡️' },
          ].map((a) => (
            <Link key={a.href} href={a.href} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.85rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none', transition: 'var(--transition)' }}>
              <span style={{ fontSize: '1rem' }}>{a.icon}</span> {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'super_admin') {
    return <SuperAdminDashboard />;
  }

  if (user?.role === 'tenant_admin') {
    return <AdminDashboard />;
  }

  return <RegularDashboard />;
}
