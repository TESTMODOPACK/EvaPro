'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';

export default function PdiCompliancePage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/pdi-compliance`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PageSkeleton cards={4} tableRows={5} />;
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  const statusLabels: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', completado: 'Completado', cancelado: 'Cancelado', pendiente_aprobacion: 'Pend. Aprobación', en_revision: 'En Revisión', aprobado: 'Aprobado' };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Cumplimiento de Desarrollo (PDI)</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Estado de los planes de desarrollo individual en la organización</p>
      </div>

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Total Planes</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.totalPlans}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Tasa Completado</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{data.completionRate}%</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Acciones Completadas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{data.actionCompletionRate}%</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data.completedActions}/{data.totalActions}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Acciones Vencidas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.overdueActions}</div>
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
      <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Por Departamento</h2>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Completados</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Progreso Prom.</th>
              </tr>
            </thead>
            <tbody>
              {(data.byDepartment || []).map((d: any) => (
                <tr key={d.department} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{d.department}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>{d.total}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>{d.completed}</td>
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
    </div>
  );
}
