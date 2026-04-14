'use client';

import { useState } from 'react';
import { useHeatmap } from '@/hooks/useReports';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      <span className="spinner" />
    </div>
  );
}

function scoreColor(score: number): string {
  if (score < 4) return 'var(--danger)';
  if (score < 7) return 'var(--warning)';
  return 'var(--success)';
}

function scoreLabel(score: number): string {
  if (score < 4) return 'Bajo';
  if (score < 7) return 'Medio';
  return 'Alto';
}

export default function PerformanceHeatmap({ cycleId }: { cycleId: string }) {
  const { data, isLoading } = useHeatmap(cycleId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (!data || !data.heatmap || data.heatmap.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos para el heatmap</p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        Mapa de Calor por Departamento
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Distribuci&oacute;n de colaboradores por nivel de desempe&ntilde;o en cada departamento
      </p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.72rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--danger)', display: 'inline-block' }} /> {'Bajo (<4)'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--warning)', display: 'inline-block' }} /> {'Medio (4-7)'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--success)', display: 'inline-block' }} /> {'Alto (\u22657)'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {data.heatmap.map((dept: any) => {
          const total = dept.total || 1;
          return (
            <div key={dept.department}>
              <div className="card" style={{ padding: '0.75rem 1rem', cursor: 'pointer' }} onClick={() => setExpanded(expanded === dept.department ? null : dept.department)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{dept.department}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: scoreColor(Number(dept.avgScore)) }}>
                      {Number(dept.avgScore).toFixed(1)}
                    </span>
                    <span className={`badge ${Number(dept.avgScore) >= 7 ? 'badge-success' : Number(dept.avgScore) >= 4 ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: '0.65rem' }}>
                      {scoreLabel(dept.avgScore)}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {dept.total} {dept.total === 1 ? 'persona' : 'personas'}
                    {' '}{expanded === dept.department ? '\u25BC' : '\u25B6'}
                  </span>
                </div>
                <div style={{ display: 'flex', height: '16px', borderRadius: '8px', overflow: 'hidden', background: 'var(--border)' }}>
                  {dept.low > 0 && <div style={{ width: `${(dept.low / total) * 100}%`, background: 'var(--danger)', transition: 'width 0.3s' }} title={`Bajo: ${dept.low}`} />}
                  {dept.mid > 0 && <div style={{ width: `${(dept.mid / total) * 100}%`, background: 'var(--warning)', transition: 'width 0.3s' }} title={`Medio: ${dept.mid}`} />}
                  {dept.high > 0 && <div style={{ width: `${(dept.high / total) * 100}%`, background: 'var(--success)', transition: 'width 0.3s' }} title={`Alto: ${dept.high}`} />}
                </div>
              </div>
              {expanded === dept.department && dept.users && (
                <div style={{ padding: '0.5rem 1rem', marginTop: '-0.25rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {dept.users.map((u: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>{u.name}</span>
                          {u.position && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '0.5rem' }}>· {u.position}</span>}
                        </div>
                        <span style={{ fontWeight: 700, color: scoreColor(u.score), flexShrink: 0 }}>{u.score.toFixed(1)}</span>
                      </div>
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
