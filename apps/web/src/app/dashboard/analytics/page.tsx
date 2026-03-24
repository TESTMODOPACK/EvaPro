'use client';

import { useState } from 'react';
import { useAnalytics } from '@/hooks/usePerformanceHistory';
import { useCycles } from '@/hooks/useCycles';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function bucketColor(range: string): string {
  // Parse the first number of the range (0-10 scale) to determine color
  const match = range.match(/([\d.]+)/);
  if (!match) return 'var(--accent)';
  const num = Number(match[1]);
  if (num < 4) return 'var(--danger)';
  if (num < 7) return 'var(--warning)';
  return 'var(--success)';
}

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  minWidth: '250px',
};

export default function AnalyticsPage() {
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: analytics, isLoading: loadingAnalytics } = useAnalytics(selectedCycleId);

  // Prefer closed cycles, sort them first
  const sortedCycles = cycles
    ? [...cycles].sort((a: any, b: any) => {
        if (a.status === 'closed' && b.status !== 'closed') return -1;
        if (a.status !== 'closed' && b.status === 'closed') return 1;
        return 0;
      })
    : [];

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.6rem 0.85rem',
        fontSize: '0.78rem',
      }}>
        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color || 'var(--text-secondary)' }}>
            {entry.name || entry.dataKey}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{'An\u00e1lisis Avanzado'}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {'Distribuci\u00f3n de puntajes, comparaci\u00f3n por departamento y referencias de equipo'}
        </p>
      </div>

      {/* Cycle selector */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {loadingCycles ? (
          <Spinner />
        ) : !sortedCycles.length ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{'No hay ciclos disponibles'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ciclo:
            </label>
            <select
              style={selectStyle}
              value={selectedCycleId || ''}
              onChange={(e) => setSelectedCycleId(e.target.value || null)}
            >
              <option value="">Selecciona un ciclo</option>
              {sortedCycles.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* No cycle selected */}
      {!selectedCycleId && !loadingCycles && sortedCycles.length > 0 && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {'Selecciona un ciclo para ver el an\u00e1lisis'}
          </p>
        </div>
      )}

      {/* Analytics content */}
      {selectedCycleId && (
        <>
          {loadingAnalytics ? (
            <Spinner />
          ) : !analytics ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{'Sin datos de an\u00e1lisis para este ciclo'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* 1. Score Distribution */}
              {analytics.scoreDistribution && analytics.scoreDistribution.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {'Distribuci\u00f3n de Puntajes'}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                    Cantidad de evaluaciones por rango de puntaje
                  </p>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={analytics.scoreDistribution} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="range"
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                        allowDecimals={false}
                      />
                      <Tooltip content={customTooltip} />
                      <Bar dataKey="count" name="Evaluaciones" radius={[4, 4, 0, 0]}>
                        {analytics.scoreDistribution.map((entry: any, idx: number) => (
                          <Cell key={idx} fill={bucketColor(entry.range)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 2. Department Comparison */}
              {analytics.departmentComparison && analytics.departmentComparison.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {'Comparaci\u00f3n por Departamento'}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                    Puntaje promedio por departamento
                  </p>
                  <ResponsiveContainer width="100%" height={Math.max(200, analytics.departmentComparison.length * 45)}>
                    <BarChart
                      data={analytics.departmentComparison.map((d: any) => ({
                        department: d.department || 'Sin depto.',
                        avgScore: Number(d.avgScore) || 0,
                        count: d.count,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 10]}
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                      />
                      <YAxis
                        type="category"
                        dataKey="department"
                        width={120}
                        tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                      />
                      <Tooltip content={customTooltip} />
                      <Bar dataKey="avgScore" name="Puntaje Promedio" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 3. Team Benchmarks */}
              {analytics.teamBenchmarks && analytics.teamBenchmarks.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {'Rendimiento por Equipo'}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    {'Rendimiento promedio por Encargado de Equipo, ordenado por puntaje'}
                  </p>
                  <div className="table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Encargado de Equipo', 'Puntaje Promedio', 'Tama\u00f1o Equipo'].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: 'left',
                                padding: '0.6rem 0.75rem',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: 'var(--text-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...analytics.teamBenchmarks]
                          .sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore))
                          .map((tb: any, i: number) => {
                            const score = Number(tb.avgScore) || 0;
                            const scoreColor = score < 4 ? 'var(--danger)' : score < 7 ? 'var(--warning)' : 'var(--success)';
                            return (
                              <tr key={i}>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                                  {tb.managerName || tb.managerId}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: scoreColor, borderBottom: '1px solid var(--border)' }}>
                                  {score.toFixed(1)}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                                  {tb.teamSize}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
