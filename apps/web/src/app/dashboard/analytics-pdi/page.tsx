'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function PdiCompliancePageContent() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!token) return;
    setError(null);
    fetch(`${API}/reports/analytics/pdi-compliance`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (!r.ok) throw new Error('Error al cargar los datos');
      return r.json();
    }).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
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
        <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.5rem' }}>Error al cargar el reporte</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  const statusLabels: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', completado: 'Completado', cancelado: 'Cancelado', pendiente_aprobacion: 'Pend. Aprobación', en_revision: 'En Revisión', aprobado: 'Aprobado' };

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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Cumplimiento de Desarrollo (PDI)</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Estado de los planes de desarrollo individual en la organización</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => handleExport('xlsx')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
            {exporting === 'xlsx' ? 'Exportando...' : 'Excel'}
          </button>
          <button className="btn-ghost" onClick={() => handleExport('csv')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
            {exporting === 'csv' ? 'Exportando...' : 'CSV'}
          </button>
        </div>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? 'Ocultar guía' : 'Cómo funciona'}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Cumplimiento de Desarrollo (PDI)</h3>
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

      {/* KPIs */}
      <div className="animate-fade-up-delay-1 mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Total Planes</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.totalPlans}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Tasa Completado</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.completionRate >= 70 ? 'var(--success)' : data.completionRate >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{data.completionRate}%</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Acciones Completadas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{data.actionCompletionRate}%</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data.completedActions}/{data.totalActions}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Acciones Vencidas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.overdueActions > 0 ? 'var(--danger)' : 'var(--success)' }}>{data.overdueActions}</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Distribución por Estado</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {Object.entries(data.byStatus || {}).map(([status, count]) => (
            <div key={status} style={{ padding: '0.5rem 1rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.82rem' }}>
              <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{count as number}</span>
              <span style={{ color: 'var(--text-muted)' }}>{statusLabels[status] || status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By Department */}
      {data.byDepartment?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Por Departamento</h2>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Completados</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Progreso Prom.</th>
                </tr>
              </thead>
              <tbody>
                {(data.byDepartment || []).map((d: any) => (
                  <tr key={d.department} style={{ borderBottom: '1px solid var(--border)' }}>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analysis Section */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', borderLeft: `4px solid ${completionLevel === 'bueno' ? 'var(--success)' : completionLevel === 'moderado' ? 'var(--warning)' : 'var(--danger)'}` }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis del Resultado</h3>
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
