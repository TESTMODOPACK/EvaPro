'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { useDashboardStats } from '@/hooks/useDashboard';
import { usePendingEvaluations } from '@/hooks/useEvaluations';
import { useCycles } from '@/hooks/useCycles';
import { usePerformanceHistory } from '@/hooks/usePerformanceHistory';
import { useFeedbackSummary } from '@/hooks/useFeedback';
import { api } from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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
          Administraci&oacute;n central de EvaPro
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
            Ver todas &rarr;
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

// ─── Regular Dashboard (existing) ───────────────────────────────────────────

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

const statusLabel: Record<string, string> = {
  pending: 'pendiente',
  in_progress: 'en progreso',
  completed: 'completada',
};
const statusBadge: Record<string, string> = {
  pending: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
};

function RegularDashboard() {
  const user = useAuthStore((s) => s.user);
  const { data: stats, isLoading: loadingStats } = useDashboardStats();
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: perfHistory } = usePerformanceHistory(user?.userId ?? null);
  const { data: feedbackSummary } = useFeedbackSummary();

  const activeCycle = cycles?.find((c: any) => c.status === 'active');

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
              Ver todas &rarr;
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
                    <th>Acci&oacute;n</th>
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

      {/* Performance Trend + Feedback cards — hide feedback for employee/external */}
      <div
        className="animate-fade-up-delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: (user?.role === 'tenant_admin' || user?.role === 'manager') ? '1fr 340px' : '1fr',
          gap: '1.25rem',
          marginTop: '1.25rem',
        }}
      >
        {/* Tendencia de Desempeno */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Tendencia de Desempe&ntilde;o
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Puntuaci&oacute;n promedio por ciclo
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
              Sin historial de desempe&ntilde;o a&uacute;n
            </div>
          )}
        </div>

        {/* Mi Feedback — only for tenant_admin and manager */}
        {(user?.role === 'tenant_admin' || user?.role === 'manager') && <div className="card" style={{ padding: '1.4rem' }}>
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
              Ver feedback &rarr;
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
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f59e0b' }}>
            {perfData.length > 0 ? Number(perfData[perfData.length - 1].avgOverall || 0).toFixed(1) : '--'}
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
              Ver todos &rarr;
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

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'super_admin') {
    return <SuperAdminDashboard />;
  }

  if (user?.role === 'employee') {
    return <EmployeeDashboard />;
  }

  return <RegularDashboard />;
}
