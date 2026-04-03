'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function CycleComparisonPage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/cycle-comparison`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PageSkeleton cards={3} tableRows={5} />;
  if (!data?.cycles?.length) return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Comparativa de Ciclos</h1>
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
        No hay ciclos cerrados para comparar. Cierra al menos 2 ciclos de evaluación para ver la comparativa.
      </div>
    </div>
  );

  const cycles = data.cycles;
  const chartData = cycles.map((c: any) => ({ name: c.cycleName, promedio: c.avgScore, evaluados: c.withScores }));

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Comparativa de Ciclos</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Evolución de puntajes entre períodos de evaluación</p>
      </div>

      {/* Evolution chart */}
      {chartData.length >= 2 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Tendencia de Puntaje Promedio</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="promedio" fill="#C9933A" name="Promedio" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cycle cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {cycles.map((c: any, i: number) => {
          const prev = i > 0 ? cycles[i - 1] : null;
          const delta = prev && c.avgScore && prev.avgScore ? (c.avgScore - prev.avgScore).toFixed(2) : null;
          return (
            <div key={c.cycleId} className="card animate-fade-up" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>{c.cycleName}</h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {c.cycleType} — {c.startDate ? new Date(c.startDate).toLocaleDateString('es-CL') : ''} al {c.endDate ? new Date(c.endDate).toLocaleDateString('es-CL') : ''}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{c.avgScore ?? '—'}</div>
                  {delta && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: Number(delta) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {Number(delta) >= 0 ? '▲' : '▼'} {Math.abs(Number(delta))} vs anterior
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>Evaluados: <strong>{c.totalEvaluated}</strong></span>
                <span>Con puntaje: <strong>{c.withScores}</strong></span>
                {c.minScore != null && <span>Mín: <strong>{c.minScore}</strong></span>}
                {c.maxScore != null && <span>Máx: <strong>{c.maxScore}</strong></span>}
              </div>
              {/* Department breakdown */}
              {c.byDepartment?.length > 0 && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {c.byDepartment.slice(0, 6).map((d: any) => (
                      <span key={d.department} style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.75rem' }}>
                        {d.department}: <strong>{d.avgScore}</strong> ({d.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
