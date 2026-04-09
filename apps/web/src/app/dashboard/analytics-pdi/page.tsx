'use client';
import React from 'react';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

const DEPT_PAGE_SIZE = 5;

function DepartmentSection({ departments, statusLabels, t }: { departments: any[]; statusLabels: Record<string, string>; t: any }) {
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  if (!departments.length) return null;

  const totalPages = Math.ceil(departments.length / DEPT_PAGE_SIZE);
  const paginated = departments.slice(page * DEPT_PAGE_SIZE, (page + 1) * DEPT_PAGE_SIZE);

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>{t('analyticsPdi.byDepartment')}</h2>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem' }}>
            <button
              className="btn-ghost"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', opacity: page === 0 ? 0.4 : 1 }}
            >
              ← Anterior
            </button>
            <span style={{ color: 'var(--text-muted)' }}>{page + 1} / {totalPages}</span>
            <button
              className="btn-ghost"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', opacity: page >= totalPages - 1 ? 0.4 : 1 }}
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>

      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, width: '30px' }}></th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('common.department')}</th>
              <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('common.total')}</th>
              <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analyticsPdi.completed')}</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analyticsPdi.avgProgress')}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((d: any) => {
              const isExpanded = expandedDept === d.department;
              return (
                <React.Fragment key={d.department}>
                  <tr
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => setExpandedDept(isExpanded ? null : d.department)}
                  >
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <span style={{ transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{d.department}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{d.total}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{d.completed}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ flex: 1, maxWidth: '100px', height: '6px', borderRadius: '999px', background: 'var(--border)' }}>
                          <div style={{ height: '100%', width: `${d.avgProgress}%`, borderRadius: '999px', background: d.avgProgress >= 70 ? 'var(--success)' : d.avgProgress >= 40 ? 'var(--warning)' : 'var(--danger)' }} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: '0.78rem' }}>{d.avgProgress}%</span>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded plans */}
                  {isExpanded && d.plans && d.plans.length > 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <div style={{ padding: '0.75rem 1rem 0.75rem 2.5rem', background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
                            Planes de desarrollo ({d.plans.length})
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Colaborador</th>
                                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Plan</th>
                                <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Estado</th>
                                <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Progreso</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.plans.map((p: any, i: number) => (
                                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{p.userName}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{p.planTitle}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center' }}>
                                    <span className="badge badge-ghost" style={{ fontSize: '0.7rem' }}>{statusLabels[p.status] || p.status}</span>
                                  </td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center', fontWeight: 600 }}>{p.progress}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                  {isExpanded && (!d.plans || d.plans.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0.75rem 2.5rem', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: '0.78rem', borderBottom: '1px solid var(--border)' }}>
                        Sin planes de desarrollo en este departamento
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PdiCompliancePageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<'current' | 'historical'>('current');
  const [historicalData, setHistoricalData] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    setError(null);
    fetch(`${API}/reports/analytics/pdi-compliance`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (!r.ok) throw new Error('Error al cargar los datos');
      return r.json();
    }).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // Load historical data
    fetch(`${API}/reports/analytics/pdi-historical`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : null).then(setHistoricalData).catch(() => {});
  }, [token]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${API}/reports/analytics/pdi-compliance/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cumplimiento-pdi.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={4} tableRows={5} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.5rem' }}>{t('common.errorLoading')}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  const statusLabels: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', completado: 'Completado', cancelado: 'Cancelado', en_revision: 'En Revisión' };

  // Analysis helpers
  const completionLevel = data.completionRate >= 70 ? 'bueno' : data.completionRate >= 40 ? 'moderado' : 'bajo';
  const overdueLevel = data.overdueActions > 5 ? 'alto' : data.overdueActions > 0 ? 'moderado' : 'ninguno';
  const bestDept = data.byDepartment?.length ? [...data.byDepartment].sort((a: any, b: any) => b.avgProgress - a.avgProgress)[0] : null;
  const worstDept = data.byDepartment?.length >= 2 ? [...data.byDepartment].sort((a: any, b: any) => a.avgProgress - b.avgProgress)[0] : null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header + Export */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analyticsPdi.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('analyticsPdi.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => handleExport('xlsx')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
            {exporting === 'xlsx' ? t('common.exporting') : t('common.exportExcel')}
          </button>
        </div>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('analyticsPdi.guide.title')}</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>¿Qué muestra?</strong> Estado de los planes de desarrollo individual — cuántos planes existen, tasa de completitud, acciones completadas vs vencidas, y desglose por departamento.</p>
            <p><strong>Indicadores clave:</strong> Total de planes, tasa de completitud (%), acciones completadas vs total, acciones vencidas (requieren seguimiento inmediato).</p>
            <p><strong>Por departamento:</strong> Muestra progreso promedio por área para identificar cuáles necesitan más apoyo.</p>
            <p><strong>Análisis:</strong> Incluye interpretación automática del nivel de cumplimiento y recomendaciones.</p>
            <p><strong>Exportación:</strong> Excel y CSV con detalle de planes y acciones.</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores ven toda la organización. Encargados de equipo ven solo su equipo.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {[
          { key: 'current' as const, label: 'Planes Vigentes' },
          { key: 'historical' as const, label: 'Histórico' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: activeTab === tab.key ? 700 : 500,
            color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
            background: 'none', border: 'none', cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* ═══ TAB: PLANES VIGENTES ═══ */}
      {activeTab === 'current' && <>

      {/* KPIs */}
      <div className="animate-fade-up-delay-1 mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsPdi.totalPlans')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.totalPlans}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsPdi.completionRate')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.completionRate >= 70 ? 'var(--success)' : data.completionRate >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{data.completionRate}%</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsPdi.actionsCompleted')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{data.actionCompletionRate}%</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data.completedActions}/{data.totalActions}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsPdi.overdueActions')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.overdueActions > 0 ? 'var(--danger)' : 'var(--success)' }}>{data.overdueActions}</div>
        </div>
      </div>

      {/* Status breakdown — large cards */}
      <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsPdi.statusDistribution')}</h2>
        <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
          {Object.entries(data.byStatus || {}).map(([status, count]) => {
            const colorMap: Record<string, string> = {
              borrador: 'var(--text-muted)', activo: '#6366f1', completado: 'var(--success)',
              cancelado: 'var(--danger)', en_revision: '#f59e0b',
            };
            const color = colorMap[status] || 'var(--text-secondary)';
            return (
              <div key={status} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color }}>{count as number}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginTop: '0.2rem' }}>
                  {statusLabels[status] || status}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By Department — collapsible + paginated */}
      <DepartmentSection departments={data.byDepartment || []} statusLabels={statusLabels} t={t} />

      {/* Analysis Section */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', borderLeft: `4px solid ${completionLevel === 'bueno' ? 'var(--success)' : completionLevel === 'moderado' ? 'var(--warning)' : 'var(--danger)'}` }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>{t('analyticsPdi.analysis')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>
            <strong>Cumplimiento general:</strong> {data.completionRate}% de los planes de desarrollo están completados.
            {completionLevel === 'bueno' ? ' Este es un buen nivel que refleja compromiso con el desarrollo profesional.' :
             completionLevel === 'moderado' ? ' El nivel es aceptable pero puede mejorarse con mayor seguimiento de las jefaturas.' :
             ' El nivel es bajo. Se recomienda revisar la comunicación y el compromiso de los colaboradores con sus planes.'}
          </p>
          <p>
            <strong>Acciones:</strong> Se han completado {data.completedActions} de {data.totalActions} acciones de desarrollo ({data.actionCompletionRate}%).
            {overdueLevel === 'alto' && ` Hay ${data.overdueActions} acciones vencidas que requieren atención inmediata.`}
            {overdueLevel === 'moderado' && ` Existen ${data.overdueActions} acciones vencidas pendientes de seguimiento.`}
            {overdueLevel === 'ninguno' && ' No hay acciones vencidas, lo cual indica buen seguimiento.'}
          </p>
          {bestDept && worstDept && bestDept.department !== worstDept.department && (
            <p>
              <strong>Departamentos:</strong> {bestDept.department} lidera con {bestDept.avgProgress}% de progreso promedio,
              mientras que {worstDept.department} tiene el menor avance ({worstDept.avgProgress}%).
              {bestDept.avgProgress - worstDept.avgProgress > 30 && ' La brecha significativa sugiere necesidad de intervención focalizada.'}
            </p>
          )}
          {data.totalPlans === 0 && (
            <p style={{ color: 'var(--warning)' }}>
              <strong>Sin datos:</strong> No se han creado planes de desarrollo. Se recomienda que cada jefatura defina planes individuales vinculados a los resultados de evaluación.
            </p>
          )}
        </div>
      </div>

      </>}

      {/* ═══ TAB: HISTÓRICO ═══ */}
      {activeTab === 'historical' && (
        <div>
          {!historicalData ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
          ) : (
            <>
              {/* Historical KPIs */}
              <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Total Planes (histórico)</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{historicalData.totalPlansAllTime}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>% Completados</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{historicalData.completedPct}%</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{historicalData.completedAllTime} planes</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>% Cancelados</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{historicalData.cancelledPct}%</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{historicalData.cancelledAllTime} planes</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Duración promedio</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{historicalData.avgDurationDays}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>días</div>
                </div>
              </div>

              {/* Actions summary */}
              <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Acciones de Desarrollo (todos los tiempos)</h3>
                <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <div>Total acciones: <strong>{historicalData.totalActions}</strong></div>
                  <div>Completadas: <strong style={{ color: 'var(--success)' }}>{historicalData.completedActions}</strong></div>
                  <div>Pendientes: <strong style={{ color: 'var(--warning)' }}>{historicalData.totalActions - historicalData.completedActions}</strong></div>
                  <div>Tasa cumplimiento: <strong>{historicalData.actionCompletionPct}%</strong></div>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Nota: Un plan se marca como &quot;completado&quot; manualmente por la jefatura. Las acciones individuales pueden completarse antes de cerrar el plan.
                </p>
              </div>

              {/* Top departments */}
              {historicalData.topDepartments?.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Top Departamentos con Planes Completados</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {historicalData.topDepartments.map((d: any, i: number) => (
                      <div key={d.department} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, minWidth: '25px', color: 'var(--accent)' }}>#{i + 1}</span>
                        <span style={{ fontSize: '0.82rem', flex: 1 }}>{d.department}</span>
                        <span style={{ fontWeight: 700, color: 'var(--success)' }}>{d.completed} completados</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By year — collapsible */}
              {historicalData.byYear?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem' }}>Planes por Año</h3>
                  {historicalData.byYear.map((y: any) => {
                    const pct = y.total > 0 ? Math.round((y.completed / y.total) * 100) : 0;
                    const statusColors: Record<string, string> = { activo: 'var(--accent)', completado: 'var(--success)', cancelado: 'var(--danger)', borrador: 'var(--text-muted)' };
                    const statusLabels: Record<string, string> = { activo: 'Activo', completado: 'Completado', cancelado: 'Cancelado', borrador: 'Borrador' };
                    return (
                      <details key={y.year} className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden' }}>
                        <summary style={{ padding: '0.85rem 1.25rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none', listStyle: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', transition: 'transform 0.2s' }}>&#9654;</span>
                            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{y.year}</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{y.total} planes</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.78rem' }}>
                            <span>Completados: <strong style={{ color: 'var(--success)' }}>{y.completed}</strong></span>
                            <span style={{ fontWeight: 600, color: pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{pct}%</span>
                          </div>
                        </summary>
                        <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1.25rem' }}>
                          {(y.plans || []).length === 0 ? (
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin planes en este año</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {(y.plans || []).map((p: any) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.82rem' }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600 }}>{p.title || 'Sin título'}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                      {p.userName}{p.department ? ` — ${p.department}` : ''}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'center', minWidth: '70px' }}>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Acciones</div>
                                    <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{p.completedActions}/{p.totalActions}</div>
                                  </div>
                                  <div style={{ textAlign: 'center', minWidth: '55px' }}>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Progreso</div>
                                    <div style={{ fontWeight: 700, fontSize: '0.78rem', color: p.progress >= 80 ? 'var(--success)' : p.progress >= 40 ? 'var(--warning)' : 'var(--text-secondary)' }}>{p.progress}%</div>
                                  </div>
                                  <span style={{ padding: '0.2rem 0.5rem', borderRadius: '10px', fontSize: '0.68rem', fontWeight: 600, background: `${statusColors[p.status] || 'var(--text-muted)'}15`, color: statusColors[p.status] || 'var(--text-muted)' }}>
                                    {statusLabels[p.status] || p.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function PdiCompliancePage() {
  return (
    <PlanGate feature="ANALYTICS_REPORTS">
      <PdiCompliancePageContent />
    </PlanGate>
  );
}
