'use client';

import { useState } from 'react';
import { useCycles } from '@/hooks/useCycles';
import { useCycleSummary } from '@/hooks/useReports';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { getScoreLabel, getScoreColor } from '@/lib/scales';

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

  const [showGuide, setShowGuide] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (format: 'csv' | 'pdf' | 'xlsx' | 'pptx') => {
    if (!selectedCycleId || !token) return;
    setExporting(format);
    try {
      const url = `${BASE_URL}/reports/cycle/${selectedCycleId}/export?format=${format}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const ext = format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : format === 'pptx' ? 'pptx' : 'csv';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `reporte-${selectedCycleId}.${ext}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      alert(err.message || 'Error al exportar');
    } finally {
      setExporting(null);
    }
  };

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
          {'An\u00e1lisis de desempe\u00f1o por ciclo'}
        </p>
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => setShowGuide(!showGuide)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: 0 }}
        >
          {showGuide ? '\u25BC Ocultar gu\u00eda' : '\u25B6 \u00bfQu\u00e9 incluyen los reportes?'}
        </button>

        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              {'Gu\u00eda de uso: Reportes'}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {'Los reportes consolidan los resultados de un ciclo de evaluaci\u00f3n. Selecciona un ciclo para ver el resumen ejecutivo con m\u00e9tricas clave, desglose por departamento y la posibilidad de exportar los datos.'}
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{'Contenido del reporte'}</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li><strong>Resumen ejecutivo:</strong>{' Total de evaluaciones, puntaje promedio general, tasa de completitud'}</li>
                <li><strong>Desglose por departamento:</strong>{' Puntaje promedio, cantidad de evaluaciones y barra comparativa por cada \u00e1rea'}</li>
                <li><strong>{'Exportaci\u00f3n:'}</strong>{' Descarga en formato CSV (para Excel) o PDF (para presentaciones)'}</li>
              </ul>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{'Conexi\u00f3n con otras funciones'}</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li><strong>{'An\u00e1lisis Avanzado:'}</strong>{' Para gr\u00e1ficos m\u00e1s detallados (distribuci\u00f3n, benchmarks) usa la p\u00e1gina de An\u00e1lisis'}</li>
                <li><strong>{'Calibraci\u00f3n:'}</strong>{' Los puntajes calibrados se reflejan autom\u00e1ticamente en los reportes'}</li>
                <li><strong>{'Desempe\u00f1o individual:'}</strong>{' Haz clic en un colaborador para ver su historial detallado'}</li>
              </ul>
            </div>

            <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>Permisos:</strong>{' Solo Administradores y Encargados de Equipo pueden acceder a los reportes. Los Encargados ven solo los datos de su equipo.'}
            </div>
          </div>
        )}
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
                    value: summary.averageScore ? `${Number(summary.averageScore).toFixed(1)} — ${getScoreLabel(Number(summary.averageScore))}` : '–',
                    color: summary.averageScore ? getScoreColor(Number(summary.averageScore)) : '#f59e0b',
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
              <div className="card animate-fade-up-delay-3" style={{ padding: '1.25rem 1.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.875rem' }}>
                  Exportar reporte
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {/* PDF */}
                  <button
                    className="btn-primary"
                    onClick={() => handleExport('pdf')}
                    disabled={!!exporting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                    {exporting === 'pdf' ? 'Generando...' : 'PDF'}
                  </button>

                  {/* Excel */}
                  <button
                    className="btn-ghost"
                    onClick={() => handleExport('xlsx')}
                    disabled={!!exporting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#10b981', borderColor: '#10b981' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                    </svg>
                    {exporting === 'xlsx' ? 'Generando...' : 'Excel (.xlsx)'}
                  </button>

                  {/* PowerPoint */}
                  <button
                    className="btn-ghost"
                    onClick={() => handleExport('pptx')}
                    disabled={!!exporting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#f59e0b', borderColor: '#f59e0b' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                    </svg>
                    {exporting === 'pptx' ? 'Generando...' : 'PowerPoint'}
                  </button>

                  {/* CSV */}
                  <button
                    className="btn-ghost"
                    onClick={() => handleExport('csv')}
                    disabled={!!exporting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {exporting === 'csv' ? 'Generando...' : 'CSV'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                  Excel incluye 4 hojas: Resumen, Por Departamento, Detalle de evaluaciones y Ranking por evaluado.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
