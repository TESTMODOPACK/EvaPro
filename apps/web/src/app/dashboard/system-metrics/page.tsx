'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const planBadge: Record<string, string> = {
  starter: 'badge-accent',
  pro: 'badge-warning',
  enterprise: 'badge-success',
  custom: 'badge-danger',
};

export default function SystemMetricsPage() {
  const token = useAuthStore((s) => s.token);
  const [stats, setStats] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.tenants.systemStats(token),
      api.tenants.usageMetrics(token),
    ])
      .then(([s, m]) => { setStats(s); setMetrics(m); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const kpis = [
    { label: 'Orgs activas', value: stats?.activeTenants ?? 0, color: '#10b981' },
    { label: 'Total usuarios', value: stats?.totalUsers ?? 0, color: '#6366f1' },
    { label: 'Accesos hoy', value: stats?.todayAccesses ?? 0, color: '#f59e0b' },
    { label: 'Fallas (7 dias)', value: stats?.totalFailures7d ?? 0, color: '#ef4444' },
  ];

  // Plan distribution for bar chart
  const planDistribution: { plan: string; count: number }[] = stats?.usersPerPlan ?? [];
  const maxCount = Math.max(...planDistribution.map((p: any) => Number(p.tenantCount || p.count || 0)), 1);

  // Top orgs by users
  const topOrgs: any[] = metrics?.tenantActivity ?? stats?.recentTenants ?? [];

  // Subscription summary
  const subsByPlan: any[] = stats?.subscriptionsByPlan ?? [];

  // Daily accesses
  const dailyAccesses: { date: string; count: number }[] = stats?.dailyAccesses ?? [];

  // Recent failures
  const recentFailures: { date: string; count: number }[] = stats?.recentFailures ?? [];

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Metricas de Uso</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Vista general del sistema</p>
      </div>

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>
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

      {/* Two column layout */}
      <div className="animate-fade-up-delay-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        {/* Bar chart: Orgs by plan */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Organizaciones por plan
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Distribucion de planes activos
          </p>

          {planDistribution.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin datos de distribucion
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {planDistribution.map((item, i) => {
                const pct = (item.count / maxCount) * 100;
                const colors: Record<string, string> = {
                  starter: '#6366f1',
                  pro: '#f59e0b',
                  enterprise: '#10b981',
                  custom: '#ef4444',
                };
                const barColor = colors[item.plan] ?? '#6366f1';
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>
                        {item.plan}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: barColor }}>
                        {item.count}
                      </span>
                    </div>
                    <div style={{ height: '24px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 'var(--radius-sm)',
                        background: barColor,
                        transition: 'width 0.6s ease',
                        minWidth: item.count > 0 ? '24px' : '0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: '0.5rem',
                      }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>
                          {item.count}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top orgs table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.1rem' }}>
              Top organizaciones por usuarios
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Ordenado por cantidad de usuarios
            </p>
          </div>

          {topOrgs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin datos disponibles
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Plan</th>
                    <th>Usuarios</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {topOrgs.slice(0, 10).map((org: any, i: number) => (
                    <tr key={org.id || i}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{org.name}</td>
                      <td>
                        <span className={`badge ${planBadge[org.plan] ?? 'badge-accent'}`}>
                          {org.plan}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {org.userCount ?? org.maxEmployees ?? '-'}
                      </td>
                      <td>
                        <span className={`badge ${org.isActive !== false ? 'badge-success' : 'badge-danger'}`}>
                          {org.isActive !== false ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Subscriptions summary + Daily accesses */}
      <div className="animate-fade-up-delay-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '1.25rem' }}>
        {/* Subscription breakdown */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Resumen de suscripciones
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Por plan y estado
          </p>
          {subsByPlan.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin suscripciones registradas</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Plan</th><th>Estado</th><th>Cantidad</th></tr></thead>
                <tbody>
                  {subsByPlan.map((row: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{row.plan || 'Sin plan'}</td>
                      <td>
                        <span className={`badge ${row.status === 'active' ? 'badge-success' : row.status === 'trial' ? 'badge-warning' : 'badge-danger'}`}>
                          {row.status === 'active' ? 'Activa' : row.status === 'trial' ? 'Trial' : row.status === 'suspended' ? 'Suspendida' : row.status}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Daily accesses + failures */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Accesos diarios (7 dias)
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Logins y fallas registradas
          </p>
          {dailyAccesses.length === 0 && recentFailures.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos de acceso</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {dailyAccesses.map((day: any, i: number) => {
                const failures = recentFailures.find((f: any) => f.date === day.date);
                const accessCount = Number(day.count);
                const failCount = failures ? Number(failures.count) : 0;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', minWidth: '80px', fontWeight: 500 }}>
                      {new Date(day.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div style={{ flex: 1, height: '8px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(accessCount * 10, 100)}%`, background: '#10b981', borderRadius: '999px' }} />
                      </div>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981', minWidth: '30px' }}>{accessCount}</span>
                      {failCount > 0 && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>
                          {failCount} fallas
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
