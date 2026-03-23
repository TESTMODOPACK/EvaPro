'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge, ScaleLegend } from '@/components/ScoreBadge';
import { getScaleLevel } from '@/lib/scales';

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
  const [completed, setCompleted] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !user?.userId) return;
    setLoading(true);
    Promise.all([
      api.reports.performanceHistory(token, user.userId).catch(() => null),
      api.evaluations.completed(token).catch(() => []),
      api.evaluations.pending(token).catch(() => []),
    ])
      .then(([h, c, p]) => {
        setHistory(h);
        setCompleted(Array.isArray(c) ? c : []);
        setPending(Array.isArray(p) ? p : []);
      })
      .finally(() => setLoading(false));
  }, [token, user?.userId]);

  if (loading) return <Spinner />;

  const cycles = history?.cycles || [];
  const latestScore = cycles.length > 0 ? cycles[cycles.length - 1] : null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {'Mi Desempe\u00f1o'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {'Tu historial de evaluaciones y evoluci\u00f3n profesional'}
        </p>
      </div>

      {/* Current score + pending */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            {'\u00DAltimo puntaje'}
          </div>
          {latestScore ? (
            <div style={{ marginTop: '0.25rem' }}>
              <ScoreBadge score={latestScore.avgOverall} size="lg" />
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                {latestScore.cycleName}
              </div>
            </div>
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

      {/* Scale legend */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Completed evaluations detail */}
      {completed.length > 0 && (
        <div className="card animate-fade-up-delay-2" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
            Evaluaciones completadas
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Evaluado</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Tipo</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Ciclo</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Puntaje</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {completed.map((ev: any, i: number) => {
                const evaluateeName = ev.evaluatee ? `${ev.evaluatee.firstName || ''} ${ev.evaluatee.lastName || ''}`.trim() : '--';
                const relLabel: Record<string, string> = { self: 'Autoevaluacion', manager: 'Jefatura', peer: 'Par', direct_report: 'Reporte directo' };
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{evaluateeName}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <span className="badge badge-accent">{relLabel[ev.relationType] || ev.relationType}</span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>{ev.cycle?.name || '--'}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <ScoreBadge score={ev.response?.overallScore} size="sm" />
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>
                      {ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Performance History by cycle */}
      <div className="card animate-fade-up-delay-2" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
          {'Evoluci\u00f3n por ciclo'}
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          {'Puntaje promedio en cada periodo de evaluaci\u00f3n (escala 0 - 10)'}
        </p>

        {cycles.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {completed.length > 0
              ? 'Las evaluaciones completadas se reflejaran aqui cuando se cierre el ciclo'
              : 'Aun no tienes evaluaciones completadas'
            }
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {cycles.map((c: any, i: number) => {
              const score = Number(c.avgOverall || 0);
              const level = getScaleLevel(score);
              const color = level?.color || 'var(--text-muted)';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ minWidth: '140px', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {c.cycleName || `Ciclo ${i + 1}`}
                  </div>
                  <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(score / 10) * 100}%`,
                      background: color,
                      borderRadius: '999px',
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                  <div style={{ minWidth: '110px' }}>
                    <ScoreBadge score={score} size="sm" />
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
            {'Desglose \u00faltima evaluaci\u00f3n'}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'Autoevaluacion', value: latestScore.avgSelf },
              { label: 'Jefatura', value: latestScore.avgManager },
              { label: 'Pares', value: latestScore.avgPeer },
              { label: 'General', value: latestScore.avgOverall },
            ].filter(s => s.value != null).map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <ScoreBadge score={s.value} size="lg" />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
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
