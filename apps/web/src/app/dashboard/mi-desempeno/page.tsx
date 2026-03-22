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

export default function MiDesempenoPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !user?.userId) return;
    setLoading(true);
    Promise.all([
      api.reports.performanceHistory(token, user.userId).catch(() => null),
      api.evaluations.pending(token).catch(() => []),
    ])
      .then(([h, p]) => {
        setHistory(h);
        setPending(Array.isArray(p) ? p : []);
      })
      .finally(() => setLoading(false));
  }, [token, user?.userId]);

  if (loading) return <Spinner />;

  const cycles = history?.cycles || [];
  const latestScore = cycles.length > 0 ? cycles[cycles.length - 1] : null;

  // Score color
  const scoreColor = (score: number) => {
    if (score >= 75) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          Mi Desempeno
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Tu historial de evaluaciones y evolucion profesional
        </p>
      </div>

      {/* Current score + pending */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Ultimo puntaje
          </div>
          {latestScore ? (
            <>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: scoreColor(Number(latestScore.avgOverall || 0)), lineHeight: 1 }}>
                {Number(latestScore.avgOverall || 0).toFixed(1)}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                / 100 &mdash; {latestScore.cycleName}
              </div>
            </>
          ) : (
            <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Sin evaluaciones</div>
          )}
        </div>

        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Evaluaciones pendientes
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: pending.length > 0 ? '#f59e0b' : '#10b981', lineHeight: 1 }}>
            {pending.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {pending.length === 0 ? 'Todo al dia' : 'Por completar'}
          </div>
        </div>
      </div>

      {/* Performance History */}
      <div className="card animate-fade-up-delay-2" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
          Evolucion por ciclo
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Puntaje promedio en cada periodo de evaluacion
        </p>

        {cycles.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Aun no tienes evaluaciones completadas
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {cycles.map((c: any, i: number) => {
              const score = Number(c.avgOverall || 0);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ minWidth: '140px', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {c.cycleName || `Ciclo ${i + 1}`}
                  </div>
                  <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${score}%`,
                      background: scoreColor(score),
                      borderRadius: '999px',
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  <div style={{ minWidth: '50px', fontWeight: 800, color: scoreColor(score), fontSize: '0.9rem', textAlign: 'right' }}>
                    {score.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Score breakdown by type */}
      {latestScore && (
        <div className="card animate-fade-up-delay-3" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
            Desglose ultima evaluacion
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'Autoevaluacion', value: latestScore.avgSelf, color: '#6366f1' },
              { label: 'Jefatura', value: latestScore.avgManager, color: '#10b981' },
              { label: 'Pares', value: latestScore.avgPeer, color: '#f59e0b' },
              { label: 'General', value: latestScore.avgOverall, color: '#8b5cf6' },
            ].filter(s => s.value != null).map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>
                  {Number(s.value).toFixed(1)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
