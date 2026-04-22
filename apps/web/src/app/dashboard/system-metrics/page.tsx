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
  growth: 'badge-warning',
  pro: 'badge-warning',
  enterprise: 'badge-success',
  custom: 'badge-danger',
};

const insightTypeLabels: Record<string, string> = {
  summary: 'Resumen IA',
  bias: 'Detección de Sesgos',
  suggestions: 'Sugerencias',
  survey_analysis: 'Análisis Encuesta',
  cycle_comparison: 'Comparativa Ciclos',
  cv_analysis: 'Análisis CV',
  recommendation: 'Recomendación',
};

export default function SystemMetricsPage() {
  const token = useAuthStore((s) => s.token);
  const [stats, setStats] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [aiUsage, setAiUsage] = useState<any[]>([]);
  const [pushMetrics, setPushMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.tenants.systemStats(token),
      api.tenants.usageMetrics(token),
      api.tenants.aiUsage(token).catch(() => []),
      api.push.metrics(token).catch(() => null),
    ])
      .then(([s, m, ai, push]) => {
        setStats(s);
        setMetrics(m);
        setAiUsage(ai || []);
        setPushMetrics(push);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const kpis = [
    { label: 'Orgs activas', value: stats?.activeTenants ?? 0, color: '#10b981' },
    { label: 'Total usuarios', value: stats?.totalUsers ?? 0, color: '#6366f1' },
    { label: 'Accesos hoy', value: stats?.todayAccesses ?? 0, color: '#f59e0b' },
    { label: 'Fallas (7 días)', value: stats?.totalFailures7d ?? 0, color: '#ef4444' },
  ];

  // AI KPIs
  const totalAiCalls = aiUsage.reduce((sum, t) => sum + (t.totalAllTime || 0), 0);
  const totalAiTokens = aiUsage.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
  const totalPeriodUsed = aiUsage.reduce((sum, t) => sum + (t.periodUsed || 0), 0);
  const orgsUsingAi = aiUsage.filter(t => t.totalAllTime > 0).length;

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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Métricas de Uso</h1>
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
            Distribución de planes activos
          </p>

          {planDistribution.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin datos de distribución
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {planDistribution.map((item, i) => {
                const pct = (item.count / maxCount) * 100;
                const colors: Record<string, string> = {
                  starter: '#6366f1',
                  growth: '#8b5cf6',
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

      {/* ══════ Push Notifications Section (v3.0) ══════ */}
      {pushMetrics && (
        <div className="animate-fade-up-delay-2" style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.3rem' }}>📲</span> Notificaciones Push
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
            Subscripciones activas, tasa de entrega y distribución por navegador
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            marginBottom: '1rem',
          }}>
            {[
              { label: 'Subscripciones totales', value: pushMetrics.total, color: '#6366f1' },
              { label: 'Activas últimos 7 días', value: pushMetrics.activeLast7d, color: '#10b981' },
              {
                label: 'Fallos últimos 7 días',
                value: pushMetrics.failuresLast7d,
                color: pushMetrics.failuresLast7d > pushMetrics.total * 0.05 ? '#ef4444' : '#9ca3af',
              },
              {
                label: 'Tasa de éxito',
                value:
                  pushMetrics.total > 0
                    ? `${Math.round((1 - pushMetrics.failuresLast7d / Math.max(pushMetrics.total, 1)) * 100)}%`
                    : '—',
                color: '#C9933A',
              },
            ].map((k) => (
              <div key={k.label} className="card" style={{ padding: '1rem' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.25rem' }}>{k.label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
          {Object.keys(pushMetrics.byBrowser || {}).length > 0 && (
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Por navegador
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {Object.entries(pushMetrics.byBrowser as Record<string, number>).map(([browser, count]) => (
                  <div key={browser} style={{
                    padding: '0.4rem 0.75rem',
                    background: 'var(--bg-hover)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                  }}>
                    <strong>{browser}</strong>: {count as number}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ AI Usage Section ══════ */}
      <div className="animate-fade-up-delay-3" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.3rem' }}>{'🤖'}</span> Uso de Inteligencia Artificial
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
          Consumo de créditos IA por organización — período actual y acumulado
        </p>

        {/* AI KPI Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}>
          {[
            { label: 'Consultas IA (período)', value: totalPeriodUsed, color: '#8b5cf6' },
            { label: 'Consultas IA (total)', value: totalAiCalls, color: '#6366f1' },
            { label: 'Tokens consumidos', value: totalAiTokens > 1000000 ? `${(totalAiTokens / 1000000).toFixed(1)}M` : totalAiTokens > 1000 ? `${(totalAiTokens / 1000).toFixed(1)}K` : totalAiTokens, color: '#f59e0b' },
            { label: 'Orgs usando IA', value: orgsUsingAi, color: '#10b981' },
          ].map((kpi, i) => (
            <div key={i} className="card" style={{ padding: '1.2rem', position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: '-15px', right: '-15px',
                width: '60px', height: '60px', borderRadius: '50%',
                background: `${kpi.color}18`,
              }} />
              <div style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '0.25rem', color: kpi.color }}>
                {kpi.value}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* AI Usage Table by Organization */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.1rem' }}>
              Créditos IA por organización
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Uso del período actual, límites y addon — ordenado por consumo
            </p>
          </div>

          {aiUsage.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin datos de uso IA
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Organización</th>
                    <th>Plan</th>
                    <th style={{ textAlign: 'center' }}>Período</th>
                    <th style={{ textAlign: 'center' }}>Límite Plan</th>
                    <th style={{ textAlign: 'center' }}>Addon</th>
                    <th style={{ textAlign: 'center' }}>Total</th>
                    <th style={{ textAlign: 'center' }}>% Uso</th>
                    <th style={{ textAlign: 'center' }}>Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.map((org: any, i: number) => {
                    const pct = org.pctUsed || 0;
                    const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
                    return (
                      <tr key={org.tenantId || i}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {org.tenantName}
                        </td>
                        <td>
                          <span className={`badge ${planBadge[org.planCode] ?? 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                            {org.plan}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {org.periodUsed}
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {org.planLimit}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {org.addonCalls > 0 ? (
                            <span style={{ fontSize: '0.82rem' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{org.addonRemaining}</span>
                              <span style={{ color: 'var(--text-muted)' }}>/{org.addonCalls}</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>
                          {org.totalLimit}
                        </td>
                        <td style={{ textAlign: 'center', minWidth: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                            <div style={{ flex: 1, maxWidth: '60px', height: '6px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor, borderRadius: '999px', transition: 'width 0.4s ease' }} />
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: barColor, minWidth: '35px' }}>
                              {pct}%
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {org.totalAllTime}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* AI Usage by Type — Breakdown */}
        {aiUsage.some(t => Object.keys(t.byType || {}).length > 0) && (
          <div className="card" style={{ padding: '1.4rem', marginTop: '1.25rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
              Distribución por tipo de análisis
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Cantidad de consultas IA agrupadas por tipo — todas las organizaciones
            </p>

            {(() => {
              // Aggregate by type across all tenants
              const typeAgg: Record<string, number> = {};
              aiUsage.forEach(org => {
                Object.entries(org.byType || {}).forEach(([type, count]) => {
                  typeAgg[type] = (typeAgg[type] || 0) + Number(count);
                });
              });
              const sortedTypes = Object.entries(typeAgg).sort((a, b) => b[1] - a[1]);
              const maxTypeCount = Math.max(...sortedTypes.map(t => t[1]), 1);

              if (sortedTypes.length === 0) {
                return <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos por tipo</div>;
              }

              const typeColors: Record<string, string> = {
                summary: '#6366f1',
                bias: '#ef4444',
                suggestions: '#10b981',
                survey_analysis: '#f59e0b',
                cycle_comparison: '#8b5cf6',
                cv_analysis: '#06b6d4',
                recommendation: '#ec4899',
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {sortedTypes.map(([type, count]) => {
                    const pct = (count / maxTypeCount) * 100;
                    const color = typeColors[type] ?? '#6366f1';
                    return (
                      <div key={type}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {insightTypeLabels[type] || type}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color }}>
                            {count}
                          </span>
                        </div>
                        <div style={{ height: '20px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`,
                            height: '100%',
                            borderRadius: 'var(--radius-sm)',
                            background: color,
                            transition: 'width 0.6s ease',
                            minWidth: count > 0 ? '20px' : '0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            paddingRight: '0.4rem',
                          }}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff' }}>
                              {count}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Subscriptions summary + Daily accesses */}
      <div className="animate-fade-up-delay-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '1.25rem' }}>
        {/* Subscription breakdown */}
        <div className="card" style={{ padding: '1.4rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
            Historial de suscripciones
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Todas las suscripciones — activas e inactivas
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
                        <span className={`badge ${
                          row.status === 'active' ? 'badge-success' :
                          row.status === 'trial' ? 'badge-warning' :
                          row.status === 'cancelled' || row.status === 'expired' ? 'badge-ghost' :
                          'badge-danger'
                        }`}>
                          {row.status === 'active' ? 'Activa' :
                           row.status === 'trial' ? 'Trial' :
                           row.status === 'suspended' ? 'Suspendida' :
                           row.status === 'cancelled' ? 'Cancelada' :
                           row.status === 'expired' ? 'Expirada' : row.status}
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
            Accesos diarios (7 días)
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
