'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const moduleLabels: Record<string, string> = {
  User: 'Usuarios', cycle: 'Ciclos', evaluation: 'Evaluaciones', objective: 'Objetivos',
  feedback: 'Feedback', checkin: 'Check-ins', development_plan: 'PDI', recognition: 'Reconocimientos',
  survey: 'Encuestas', tenant: 'Organizaciones', competency: 'Competencias',
};

export default function SystemUsagePage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/system-usage`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Adopción y Uso del Sistema</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Métricas de actividad de los últimos 30 días</p>
      </div>

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Usuarios Totales</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{data.totalUsers}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Activos Mes (MAU)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.mau}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Activos Semana (WAU)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{data.wau}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Tasa Adopción</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.adoptionRate >= 70 ? 'var(--success)' : data.adoptionRate >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{data.adoptionRate}%</div>
        </div>
      </div>

      {/* Daily activity chart */}
      {data.dailyActivity?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Actividad Diaria (últimos 30 días)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.dailyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="actions" stroke="#C9933A" strokeWidth={2} name="Acciones" />
              <Line type="monotone" dataKey="users" stroke="#6366f1" strokeWidth={2} name="Usuarios" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Module usage */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Uso por Módulo</h2>
          {data.moduleUsage?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {data.moduleUsage.slice(0, 10).map((m: any) => (
                <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem' }}>
                  <span style={{ minWidth: '120px', fontWeight: 500 }}>{moduleLabels[m.module] || m.module}</span>
                  <div style={{ flex: 1, height: '8px', borderRadius: '999px', background: 'var(--border)' }}>
                    <div style={{ height: '100%', width: `${Math.min((m.count / (data.moduleUsage[0]?.count || 1)) * 100, 100)}%`, borderRadius: '999px', background: 'var(--accent)' }} />
                  </div>
                  <span style={{ fontWeight: 600, minWidth: '40px', textAlign: 'right', color: 'var(--text-muted)' }}>{m.count}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</p>}
        </div>

        {/* Top actions */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Acciones Más Frecuentes</h2>
          {data.topActions?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {data.topActions.map((a: any, i: number) => (
                <div key={a.action} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', minWidth: '18px' }}>{i + 1}.</span>
                    <span>{a.action}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{a.count}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</p>}
        </div>
      </div>
    </div>
  );
}
