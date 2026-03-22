'use client';

import { useState } from 'react';
import { useCycles } from '@/hooks/useCycles';
import { useCycleSummary } from '@/hooks/useReports';
import { useAuthStore } from '@/store/auth.store';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://evaluacion-desempeno-api.onrender.com';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function ReportesPage() {
  const token = useAuthStore((s) => s.token);
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: summary, isLoading: loadingSummary } = useCycleSummary(selectedCycleId);

  const departmentColors = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#a78bfa', '#fb7185', '#ef4444', '#14b8a6'];

  const maxScore = summary?.departmentBreakdown?.length
    ? Math.max(...summary.departmentBreakdown.map((d: any) => Number(d.avgScore) || 0))
    : 10;

  const exportUrl = selectedCycleId
    ? `${BASE_URL}/reports/cycle/${selectedCycleId}/export?format=csv`
    : null;

  const selectStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    outline: 'none',
    minWidth: '250px',
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Reportes</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Analisis de desempeno por ciclo
        </p>
      </div>

      {/* Cycle selector */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        {loadingCycles ? (
          <Spinner />
        ) : !cycles || cycles.length === 0 ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No hay ciclos disponibles
            </p>
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
              {cycles.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary content */}
      {selectedCycleId && (
        <>
          {loadingSummary ? (
            <Spinner />
          ) : !summary ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos para este ciclo</p>
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div
                className="animate-fade-up-delay-1"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                {[
                  {
                    label: 'Promedio global',
                    value: summary.averageScore ? `${Number(summary.averageScore).toFixed(1)} / 10` : '–',
                    color: '#f59e0b',
                  },
                  {
                    label: 'Evaluados',
                    value: String(summary.completedAssignments || 0),
                    color: '#6366f1',
                  },
                  {
                    label: 'Tasa de completado',
                    value: summary.completionRate != null ? `${summary.completionRate}%` : '–',
                    color: '#10b981',
                  },
                  {
                    label: 'Total asignaciones',
                    value: String(summary.totalAssignments || 0),
                    color: '#38bdf8',
                  },
                ].map((m, i) => (
                  <div key={i} className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      width: '42px', height: '42px', borderRadius: '0.625rem',
                      background: `${m.color}20`, color: m.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.1rem', fontWeight: 800,
                    }}>
                      {m.label.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: m.color, letterSpacing: '-0.02em' }}>
                        {m.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Department breakdown */}
              {summary.departmentBreakdown && summary.departmentBreakdown.length > 0 && (
                <div className="card animate-fade-up-delay-2" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>Promedio por departamento</h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Puntuacion media de evaluaciones completadas
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    {[...summary.departmentBreakdown]
                      .sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore))
                      .map((d: any, i: number) => {
                        const avg = Number(d.avgScore) || 0;
                        const color = departmentColors[i % departmentColors.length];
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ minWidth: '100px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: 500 }}>
                              {d.department || 'Sin depto.'}
                            </div>
                            <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: maxScore > 0 ? `${(avg / maxScore) * 100}%` : '0%',
                                  background: color,
                                  borderRadius: '999px',
                                  transition: 'width 0.6s ease',
                                }}
                              />
                            </div>
                            <div style={{ minWidth: '80px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontWeight: 800, color, fontSize: '0.9rem' }}>{avg.toFixed(1)}</span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({d.count})</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Export actions */}
              <div className="animate-fade-up-delay-3" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {exportUrl && (
                  <a
                    href={`${exportUrl}${token ? `&token=${token}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <button className="btn-ghost">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Exportar CSV
                    </button>
                  </a>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
