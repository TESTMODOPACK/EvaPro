'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { useDashboardStats } from '@/hooks/useDashboard';
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

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Super Admin Dashboard ──────────────────────────────────────────────────

function SuperAdminDashboard() {
  const token = useAuthStore((s) => s.token);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.tenants.systemStats(token)
      .then(setStats)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const kpis = [
    { label: 'Total organizaciones', value: stats?.totalTenants ?? 0, color: '#6366f1' },
    { label: 'Usuarios globales', value: stats?.totalUsers ?? 0, color: '#10b981' },
    { label: 'Orgs activas', value: stats?.activeTenants ?? 0, color: '#f59e0b' },
    { label: 'Usuarios activos', value: stats?.activeUsers ?? 0, color: '#8b5cf6' },
  ];

  const recentTenants: any[] = stats?.recentTenants ?? [];

  const planBadge: Record<string, string> = {
    starter: 'badge-accent',
    pro: 'badge-warning',
    enterprise: 'badge-success',
  };

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
          Panel del Sistema
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {`Administraci\u00f3n central de EvaPro`}
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

      {/* Quick nav */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Organizaciones', href: '/dashboard/tenants' },
          { label: 'Suscripciones', href: '/dashboard/subscriptions' },
          { label: 'Log del Sistema', href: '/dashboard/audit-log' },
          { label: 'Metricas de Uso', href: '/dashboard/system-metrics' },
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
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Ultimas organizaciones</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Registros mas recientes</p>
          </div>
          <Link href="/dashboard/tenants" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
            {'Ver todas \u2192'}
          </Link>
        </div>

        {recentTenants.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Sin organizaciones registradas
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Plan</th>
                  <th>Usuarios</th>
                  <th>Creado</th>
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
  const user = useAuthStore((s) => s.user);
  const { data: stats, isLoading: loadingStats } = useDashboardStats();
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: perfHistory } = usePerformanceHistory(user?.userId ?? null);
  const { data: feedbackSummary } = useFeedbackSummary();
  const { data: atRiskObjectives } = useAtRiskObjectives();

  const activeCycle = cycles?.find((c: any) => c.status === 'active');
  const atRiskCount = atRiskObjectives?.length || 0;

  const kpis = [
    {
      label: 'Evaluaciones activas',
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
      label: 'Empleados evaluados',
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
      label: 'Puntuacion promedio',
      value: stats?.averageScore ? Number(stats.averageScore).toFixed(1) : '\u2013',
      color: '#f59e0b',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      label: 'Pendientes de completar',
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
            ? 'Panel de Revision'
            : `Hola, ${user?.firstName || user?.email?.split('@')[0] || 'usuario'}`}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

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
                  {stats.completionRate != null ? `${stats.completionRate}% completado` : ''}
                </div>
              )}
            </div>
          ))}
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
              {atRiskCount} objetivo{atRiskCount !== 1 ? 's' : ''} en riesgo
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              (progreso menor al 40%)
            </span>
          </div>
          <Link
            href="/dashboard/objetivos"
            style={{ fontSize: '0.78rem', color: 'var(--danger)', textDecoration: 'none', fontWeight: 600 }}
          >
            {'Ver objetivos \u2192'}
          </Link>
        </div>
      )}

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
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Evaluaciones pendientes</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Asignaciones por completar</p>
            </div>
            <Link href="/dashboard/evaluaciones" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
              {'Ver todas \u2192'}
            </Link>
          </div>

          {loadingPending ? (
            <Spinner />
          ) : !pendingEvals || pendingEvals.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin evaluaciones pendientes
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Evaluado</th>
                    <th>Ciclo</th>
                    <th>Estado</th>
                    <th>{`Acci\u00f3n`}</th>
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
                          Responder
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
              {activeCycle ? activeCycle.name : 'Ciclo activo'}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              {activeCycle
                ? `Finaliza el ${new Date(activeCycle.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`
                : 'Sin ciclo activo'}
            </p>

            {loadingCycles ? (
              <Spinner />
            ) : stats ? (
              <>
                {[
                  { label: 'Completadas', value: stats.completedAssignments, total: stats.totalAssignments, color: 'var(--success)' },
                  { label: 'Pendientes', value: stats.pendingAssignments, total: stats.totalAssignments, color: 'var(--warning)' },
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
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin datos disponibles</p>
            )}
          </div>

          {/* Quick actions — only for tenant_admin */}
          {user?.role === 'tenant_admin' && (
            <div className="card" style={{ padding: '1.4rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem' }}>Acciones rapidas</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {[
                  { label: 'Nueva evaluacion', icon: '+', href: '/dashboard/evaluaciones' },
                  { label: 'Agregar usuario', icon: '>', href: '/dashboard/usuarios' },
                  { label: 'Ver reportes', icon: '#', href: '/dashboard/reportes' },
                ].map((action, i) => (
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
                    <span style={{ fontSize: '1rem', fontWeight: 700 }}>{action.icon}</span>
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
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
            {`Tendencia de Desempe\u00f1o`}
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            {`Puntuaci\u00f3n promedio por ciclo`}
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
              {`Sin historial de desempe\u00f1o a\u00fan`}
            </div>
          )}
        </div>

        {/* Mi Feedback — show only when user has received feedback */}
        {totalFeedback > 0 && <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Mi Feedback
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Resumen de feedback recibido
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
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Positivo</span>
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
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Neutral</span>
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
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Constructivo</span>
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
              Total: <strong style={{ color: 'var(--text-primary)' }}>{totalFeedback}</strong>
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
              {'Ver feedback \u2192'}
            </Link>
          </div>
        </div>}
      </div>
    </div>
  );
}

// ─── Employee Dashboard ─────────────────────────────────────────────────────

function EmployeeDashboard() {
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
          Hola, {user?.firstName || user?.email?.split('@')[0] || 'usuario'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Quick KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Evaluaciones pendientes</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: pendingList.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{pendingList.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Objetivos activos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{activeObjectives.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Feedback recibido</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{totalFeedback}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Ultimo puntaje</div>
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
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Mis evaluaciones pendientes</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Evaluaciones que debes completar</p>
            </div>
          </div>
          {loadingPending ? <Spinner /> : pendingList.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No tienes evaluaciones pendientes
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Evaluado</th>
                    <th>Tipo</th>
                    <th>Ciclo</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingList.map((ev: any, i: number) => (
                    <tr key={ev.id || i}>
                      <td style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                        {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : 'Sin asignar'}
                        {ev.evaluateeId === user?.userId && <span className="badge badge-accent" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>Autoevaluacion</span>}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {ev.relationType === 'self' ? 'Autoevaluacion' : ev.relationType === 'manager' ? 'Jefatura' : ev.relationType === 'peer' ? 'Par' : ev.relationType || '--'}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{ev.cycle?.name || '--'}</td>
                      <td>
                        <Link
                          href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                          className="btn-primary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
                        >
                          Responder
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
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>Mi historial de desempeno</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>Evolucion de tu puntaje por ciclo</p>
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
              Aun no tienes historial de evaluaciones
            </div>
          )}
        </div>

        {/* Active objectives */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.1rem' }}>Mis objetivos</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{activeObjectives.length} activos</p>
            </div>
            <Link href="/dashboard/objetivos" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
              {'Ver todos \u2192'}
            </Link>
          </div>
          {loadingObj ? <Spinner /> : activeObjectives.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No tienes objetivos activos
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
    { icon: '\uD83D\uDC65', title: 'Gestionar equipo', desc: 'Importa o crea los usuarios de tu organizacion', href: '/dashboard/usuarios' },
    { icon: '\uD83D\uDCCB', title: 'Crear plantilla', desc: 'Disena el formulario de evaluacion', href: '/dashboard/plantillas' },
    { icon: '\uD83D\uDD04', title: 'Lanzar ciclo', desc: 'Configura y lanza la evaluacion', href: '/dashboard/evaluaciones/nuevo' },
    { icon: '\uD83D\uDCCA', title: 'Ver resultados', desc: 'Analiza el desempeno con reportes avanzados', href: '/dashboard/informes' },
    { icon: '\uD83C\uDFAF', title: 'Definir objetivos', desc: 'Establece OKRs para el equipo', href: '/dashboard/objetivos' },
    { icon: '\uD83D\uDCC8', title: 'Calibrar talento', desc: 'Ajusta y valida los resultados', href: '/dashboard/calibracion' },
  ],
  manager: [
    { icon: '\u2705', title: 'Evaluar equipo', desc: 'Completa las evaluaciones de tu equipo', href: '/dashboard/evaluaciones' },
    { icon: '\uD83C\uDFAF', title: 'Revisar OKRs', desc: 'Da seguimiento a los objetivos', href: '/dashboard/objetivos' },
    { icon: '\uD83D\uDCAC', title: 'Check-ins 1:1', desc: 'Agenda reuniones con tu equipo', href: '/dashboard/feedback' },
    { icon: '\uD83D\uDCC8', title: 'Ver desempeno', desc: 'Revisa los resultados del equipo', href: '/dashboard/reportes' },
    { icon: '\u2B50', title: 'Reconocer', desc: 'Destaca los logros de tu equipo', href: '/dashboard/reconocimientos' },
    { icon: '\uD83D\uDCCB', title: 'Planes desarrollo', desc: 'Crea planes de mejora', href: '/dashboard/desarrollo' },
  ],
  employee: [
    { icon: '\u270F\uFE0F', title: 'Autoevaluacion', desc: 'Completa tu autoevaluacion', href: '/dashboard/evaluaciones' },
    { icon: '\uD83C\uDFAF', title: 'Mis objetivos', desc: 'Define y avanza en tus OKRs', href: '/dashboard/objetivos' },
    { icon: '\uD83D\uDCCA', title: 'Mi desempeno', desc: 'Revisa tus resultados', href: '/dashboard/mi-desempeno' },
    { icon: '\uD83D\uDCAC', title: 'Pedir feedback', desc: 'Solicita retroalimentacion', href: '/dashboard/feedback' },
    { icon: '\uD83D\uDCCB', title: 'Mi plan desarrollo', desc: 'Trabaja en tu plan de mejora', href: '/dashboard/desarrollo' },
    { icon: '\u2B50', title: 'Reconocer', desc: 'Reconoce a tus companeros', href: '/dashboard/reconocimientos' },
  ],
  external: [
    { icon: '\u2705', title: 'Evaluaciones', desc: 'Completa las evaluaciones asignadas', href: '/dashboard/evaluaciones' },
    { icon: '\uD83D\uDCCA', title: 'Resultados', desc: 'Revisa los resultados disponibles', href: '/dashboard/mi-desempeno' },
  ],
};

const TYPE_ICONS: Record<string, string> = { feature: '\uD83C\uDD95', improvement: '\u2728', fix: '\uD83D\uDD27' };

// ─── Stats Sidebar (role-aware) ──────────────────────────────────────────────

function DashboardStats() {
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
        Resumen
      </h3>

      {/* Pending evaluations — all roles */}
      <div style={cardStyle}>
        <div style={labelStyle}>Evaluaciones pendientes</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ ...valueStyle, color: pendingCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {pendingCount}
          </span>
          {pendingCount > 0 && (
            <Link href="/dashboard/evaluaciones" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>
              Completar
            </Link>
          )}
        </div>
      </div>

      {/* Active cycles — admin/manager */}
      {isAdminOrManager && (
        <div style={cardStyle}>
          <div style={labelStyle}>Ciclos activos</div>
          <div style={valueStyle}>{activeCycles.length}</div>
          {stats && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Completitud</span>
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
          <div style={labelStyle}>Puntaje promedio</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={valueStyle}>{Number(stats.averageScore).toFixed(1)}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/ 10</span>
          </div>
        </div>
      )}

      {/* At-risk objectives — all roles */}
      <div style={cardStyle}>
        <div style={labelStyle}>Objetivos en riesgo</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ ...valueStyle, color: atRiskCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {atRiskCount}
          </span>
          {atRiskCount > 0 && (
            <Link href="/dashboard/objetivos" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>
              Ver detalle
            </Link>
          )}
        </div>
      </div>

      {/* Feedback summary — all roles */}
      {feedbackSummary && feedbackSummary.total > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>Feedback recibido</div>
          <div style={valueStyle}>{feedbackSummary.total}</div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
            <span className="badge badge-success">{feedbackSummary.positive} positivo</span>
            <span className="badge badge-warning">{feedbackSummary.neutral} neutral</span>
            <span className="badge badge-danger">{feedbackSummary.constructive} constructivo</span>
          </div>
        </div>
      )}

      {/* Admin-specific: total users */}
      {role === 'tenant_admin' && stats && (
        <div style={cardStyle}>
          <div style={labelStyle}>Total evaluaciones</div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{stats.completedAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>completadas</div>
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>{stats.pendingAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>pendientes</div>
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats.totalAssignments}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>total</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Welcome Page ────────────────────────────────────────────────────────────

function WelcomePage() {
  const user = useAuthStore((s) => s.user);
  const { data: changelog, isLoading: loadingCL, isError: errorCL } = useChangelog(5);
  const steps = ROLE_STEPS[user?.role || 'employee'] || ROLE_STEPS.employee;
  const today = new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const quickLinks = [
    { label: 'Evaluaciones', href: '/dashboard/evaluaciones', icon: '\uD83D\uDCDD' },
    { label: 'Objetivos', href: '/dashboard/objetivos', icon: '\uD83C\uDFAF' },
    { label: 'Feedback', href: '/dashboard/feedback', icon: '\uD83D\uDCAC' },
    { label: 'Notificaciones', href: '/dashboard/notificaciones', icon: '\uD83D\uDD14' },
  ];

  return (
    <div style={{ display: 'flex', gap: '2rem', maxWidth: '1200px' }}>
    {/* Left: main content */}
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Welcome Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {'\uD83D\uDC4B'} Bienvenido/a, {user?.firstName || 'Usuario'}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {getRoleLabel(user?.role || 'employee')} {'\u00B7'} {today}
        </p>
      </div>

      {/* System Changelog */}
      {loadingCL && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--border)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando novedades...</p>
        </div>
      )}
      {errorCL && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid #f59e0b' }}>
          <p style={{ color: '#92400e', fontSize: '0.85rem' }}>No se pudieron cargar las novedades del sistema.</p>
        </div>
      )}
      {!loadingCL && changelog && changelog.length > 0 && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--primary)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\uD83D\uDCE2'} Novedades del Sistema
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
          {'\uD83D\uDDFA\uFE0F'} Como usar EvaPro
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
                  Ir {'\u2192'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Access */}
      <div className="card" style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.75rem' }}>{'\u26A1'} Accesos rápidos</h3>
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

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'super_admin') {
    return <SuperAdminDashboard />;
  }

  return <WelcomePage />;
}
