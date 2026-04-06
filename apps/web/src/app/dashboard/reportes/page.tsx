'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCycles } from '@/hooks/useCycles';
import { useCycleSummary } from '@/hooks/useReports';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { getScoreLabel, getScoreColor } from '@/lib/scales';
import { useToastStore } from '@/store/toast.store';
import PerformanceHeatmap from '@/components/PerformanceHeatmap';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function ReportesPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: summary, isLoading: loadingSummary } = useCycleSummary(selectedCycleId);

  // Executive dashboard data
  const [execData, setExecData] = useState<any>(null);
  useEffect(() => {
    if (!token || !selectedCycleId) { setExecData(null); return; }
    api.reports.executiveDashboard(token, selectedCycleId)
      .then(setExecData).catch(() => setExecData(null));
  }, [token, selectedCycleId]);

  // Tabs
  const [activeTab, setActiveTab] = useState<'evaluation' | 'climate'>('evaluation');

  // Compare cycle (evaluation)
  const [compareCycleId, setCompareCycleId] = useState<string | null>(null);
  const { data: compareSummary } = useCycleSummary(compareCycleId);

  // Clima: surveys + eNPS
  const [surveys, setSurveys] = useState<any[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [enpsData, setEnpsData] = useState<any>(null);
  const [compareSurveyId, setCompareSurveyId] = useState<string | null>(null);
  const [compareEnps, setCompareEnps] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    api.reports.closedSurveys(token).then(setSurveys).catch(() => setSurveys([]));
  }, [token]);

  useEffect(() => {
    if (!token || !selectedSurveyId) { setEnpsData(null); return; }
    api.reports.enpsBySurvey(token, selectedSurveyId).then(setEnpsData).catch(() => setEnpsData(null));
  }, [token, selectedSurveyId]);

  useEffect(() => {
    if (!token || !compareSurveyId) { setCompareEnps(null); return; }
    api.reports.enpsBySurvey(token, compareSurveyId).then(setCompareEnps).catch(() => setCompareEnps(null));
  }, [token, compareSurveyId]);

  // Use latest survey by default when surveys load
  useEffect(() => {
    if (surveys.length > 0 && !selectedSurveyId) {
      setSelectedSurveyId(surveys[0].id);
    }
  }, [surveys]);

  const departmentColors = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#a78bfa', '#fb7185', '#ef4444', '#14b8a6'];
  const maxScore = summary?.departmentBreakdown?.length
    ? Math.max(...summary.departmentBreakdown.map((d: any) => Number(d.avgScore) || 0))
    : 10;

  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const handleExport = async (format: 'pdf' | 'xlsx' | 'pptx') => {
    if (!selectedCycleId || !token) return;
    setExporting(format);
    try {
      const res = await fetch(`${BASE_URL}/reports/cycle/${selectedCycleId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `resumen-ciclo.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      toast.error(err.message || 'Error al exportar');
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

  const closedCycles = cycles ? cycles.filter((c: any) => c.status === 'closed') : [];
  const selectedCycle = cycles?.find((c: any) => c.id === selectedCycleId);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.6rem 1.25rem', fontSize: '0.88rem', fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: 'none', border: 'none', cursor: 'pointer',
  });

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Resumen Ejecutivo</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Dashboard ejecutivo: evaluación de desempeño y clima laboral
        </p>
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Resumen Ejecutivo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Tab Evaluación de Desempeño</p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>KPIs: promedio global, tasa de completitud, evaluaciones, departamentos</li>
                <li>Desempeño por departamento: ranking con barras de progreso</li>
                <li>Mapa de calor: distribución de desempeño por departamento y colaborador</li>
                <li>Análisis rápido: interpretación automática del ciclo</li>
                <li>Comparativa de Ciclos: delta entre ciclo actual y otro cerrado</li>
              </ul>
            </div>
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Tab Clima Laboral</p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>eNPS: score, promotores, detractores, total respuestas</li>
                <li>Dotación: usuarios activos por departamento</li>
                <li>Desarrollo organizacional: planes e iniciativas</li>
                <li>Comparativa de Ciclos: delta entre encuesta actual y anterior</li>
              </ul>
            </div>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores ven toda la organización. Encargados de equipo ven solo su equipo.
          </div>
        </div>
      )}

      {/* Cycle selector */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1rem' }}>
        {loadingCycles ? <Spinner /> : !closedCycles.length ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay ciclos cerrados disponibles</p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ciclo:</label>
            <select style={selectStyle} value={selectedCycleId || ''} onChange={(e) => { setSelectedCycleId(e.target.value || null); setCompareCycleId(null); }}>
              <option value="">Selecciona un ciclo</option>
              {closedCycles.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} (Cerrado)</option>
              ))}
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Solo ciclos cerrados</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      {selectedCycleId && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
          <button style={tabStyle(activeTab === 'evaluation')} onClick={() => setActiveTab('evaluation')}>
            Evaluación de Desempeño
          </button>
          <button style={tabStyle(activeTab === 'climate')} onClick={() => setActiveTab('climate')}>
            Clima Laboral
          </button>
        </div>
      )}

      {/* ═══════════ TAB: EVALUACIÓN ═══════════ */}
      {selectedCycleId && activeTab === 'evaluation' && (
        <>
          {loadingSummary ? <Spinner /> : !summary ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)' }}>Sin datos para este ciclo</p>
            </div>
          ) : (
            <>
              {/* Cycle info bar */}
              {selectedCycle && (
                <div className="card animate-fade-up" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <span><strong>{selectedCycle.name}</strong></span>
                  <span>Tipo: <strong>{selectedCycle.type}°</strong></span>
                  {selectedCycle.startDate && <span>Inicio: <strong>{new Date(selectedCycle.startDate).toLocaleDateString('es-CL')}</strong></span>}
                  {selectedCycle.endDate && <span>Fin: <strong>{new Date(selectedCycle.endDate).toLocaleDateString('es-CL')}</strong></span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
                    {(['pdf', 'xlsx', 'pptx'] as const).map(fmt => (
                      <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting} style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>
                        {exporting === fmt ? '...' : fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* KPIs */}
              <div className="animate-fade-up-delay-1 mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Promedio Global', value: summary.averageScore ? Number(summary.averageScore).toFixed(1) : '–', color: summary.averageScore ? getScoreColor(Number(summary.averageScore)) : '#94a3b8' },
                  { label: 'Completitud', value: summary.completionRate != null ? `${summary.completionRate}%` : '–', color: (summary.completionRate || 0) >= 80 ? '#10b981' : '#f59e0b' },
                  { label: 'Evaluaciones', value: `${summary.completedAssignments || 0}/${summary.totalAssignments || 0}`, color: '#6366f1' },
                  { label: 'Departamentos', value: String(summary.departmentBreakdown?.length || 0), color: '#38bdf8' },
                ].map((m, i) => (
                  <div key={i} className="card" style={{ padding: '1.15rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>{m.label}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Department breakdown */}
              {summary.departmentBreakdown?.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '1rem' }}>Desempeño por Departamento</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[...summary.departmentBreakdown].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore)).map((d: any, i: number) => {
                      const avg = Number(d.avgScore) || 0;
                      const color = departmentColors[i % departmentColors.length];
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ minWidth: '120px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: 500 }}>{d.department || 'Sin depto.'}</div>
                          <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: maxScore > 0 ? `${(avg / maxScore) * 100}%` : '0%', background: color, borderRadius: '999px' }} />
                          </div>
                          <span style={{ fontWeight: 800, color, fontSize: '0.88rem', minWidth: '35px' }}>{avg.toFixed(1)}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({d.count})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Heatmap */}
              <div style={{ marginBottom: '1.5rem' }}><PerformanceHeatmap cycleId={selectedCycleId} /></div>

              {/* Análisis Rápido — solo datos del ciclo de evaluación */}
              {summary.averageScore && (
                <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: `4px solid ${getScoreColor(Number(summary.averageScore))}` }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis Rápido del Ciclo</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <p><strong>Desempeño:</strong> Promedio global de <strong style={{ color: getScoreColor(Number(summary.averageScore)) }}>{Number(summary.averageScore).toFixed(1)}</strong> ({getScoreLabel(Number(summary.averageScore))})
                      {Number(summary.averageScore) >= 7 ? ' — buen nivel de desempeño general.' : Number(summary.averageScore) >= 5 ? ' — aceptable, con oportunidad de mejora.' : ' — requiere atención y planes de acción.'}
                    </p>
                    <p><strong>Participación:</strong> {summary.completionRate}% de completitud ({summary.completedAssignments} de {summary.totalAssignments} evaluaciones).
                      {(summary.completionRate || 0) >= 90 ? ' Excelente nivel de participación.' : (summary.completionRate || 0) >= 70 ? ' Buena participación.' : ' Se recomienda reforzar la comunicación para aumentar la participación.'}
                    </p>
                    {summary.departmentBreakdown?.length >= 2 && (() => {
                      const sorted = [...summary.departmentBreakdown].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
                      const best = sorted[0];
                      const worst = sorted[sorted.length - 1];
                      const gap = (Number(best.avgScore) - Number(worst.avgScore)).toFixed(1);
                      return (
                        <p><strong>Brecha departamental:</strong> {best.department} ({Number(best.avgScore).toFixed(1)}) vs {worst.department} ({Number(worst.avgScore).toFixed(1)}) — diferencia de {gap} puntos.
                          {Number(gap) > 2 ? ' Brecha significativa, revisar condiciones en departamentos con menor puntaje.' : ' Brecha moderada, buena consistencia.'}
                        </p>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ── Comparativa de Ciclos ── */}
              <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Comparativa de Ciclos</h3>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Comparar con:</label>
                  <select className="input" style={{ minWidth: '200px', fontSize: '0.82rem' }}
                    value={compareCycleId || ''} onChange={(e) => setCompareCycleId(e.target.value || null)}>
                    <option value="">— Seleccionar ciclo —</option>
                    {closedCycles.filter((c: any) => c.id !== selectedCycleId).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {compareSummary && (
                  <div>
                    <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      {[
                        { label: 'Promedio', curr: summary?.averageScore, prev: compareSummary.averageScore },
                        { label: 'Completitud', curr: summary?.completionRate, prev: compareSummary.completionRate, suffix: '%' },
                      ].map((m, i) => {
                        const d = m.curr != null && m.prev != null ? Number(m.curr) - Number(m.prev) : null;
                        return (
                          <div key={i} style={{ padding: '0.5rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{m.label}</div>
                            <span>{Number(m.curr || 0).toFixed(1)}{m.suffix || ''}</span>
                            <span style={{ margin: '0 0.3rem', color: 'var(--text-muted)' }}>vs</span>
                            <span>{Number(m.prev || 0).toFixed(1)}{m.suffix || ''}</span>
                            {d != null && d !== 0 && (
                              <span style={{ marginLeft: '0.5rem', fontWeight: 700, color: d > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(1)}{m.suffix || ''}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!compareCycleId && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Selecciona otro ciclo cerrado para ver la comparativa</p>}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════ TAB: CLIMA LABORAL ═══════════ */}
      {selectedCycleId && activeTab === 'climate' && (
        <>
          {/* Survey selector */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Encuesta:</label>
            <select className="input" style={{ minWidth: '250px' }} value={selectedSurveyId || ''} onChange={(e) => { setSelectedSurveyId(e.target.value || null); setCompareSurveyId(null); }}>
              <option value="">Seleccionar encuesta</option>
              {surveys.map((s: any) => (
                <option key={s.id} value={s.id}>{s.title} ({s.endDate ? new Date(s.endDate).toLocaleDateString('es-CL') : 'Sin fecha'})</option>
              ))}
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Solo encuestas cerradas</span>
          </div>

          {/* eNPS KPIs */}
          {enpsData ? (
            <>
              <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>eNPS Score</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: enpsData.score >= 30 ? '#10b981' : enpsData.score >= 0 ? '#f59e0b' : '#ef4444' }}>{enpsData.score}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{enpsData.surveyName}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Promotores</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981' }}>{enpsData.promoters}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Detractores</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ef4444' }}>{enpsData.detractors}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Total Respuestas</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{enpsData.total}</div>
                </div>
              </div>

              {/* Interpretación */}
              <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: `4px solid ${enpsData.score >= 30 ? 'var(--success)' : enpsData.score >= 0 ? 'var(--warning)' : 'var(--danger)'}` }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.5rem' }}>Interpretación eNPS</h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  {enpsData.score >= 50 ? 'Excelente. Alto nivel de compromiso y satisfacción organizacional.' :
                   enpsData.score >= 30 ? 'Muy bueno. La mayoría de los colaboradores son promotores de la organización.' :
                   enpsData.score >= 0 ? 'Aceptable. Hay espacio para mejorar el compromiso. Se recomienda investigar las causas de insatisfacción.' :
                   'Bajo. Se requiere intervención urgente: encuestas de seguimiento, grupos focales e intervenciones de clima.'}
                </p>
              </div>
            </>
          ) : selectedSurveyId ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Sin datos eNPS para esta encuesta
            </div>
          ) : null}

          {/* Dotación */}
          {execData?.headcount && (
            <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Dotación</h3>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Activos</div><div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>{execData.headcount.active}</div></div>
                <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total</div><div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{execData.headcount.total}</div></div>
              </div>
              {execData.headcount.byDepartment?.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {execData.headcount.byDepartment.slice(0, 8).map((d: any) => (
                    <div key={d.department} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{d.department}</span><strong>{d.count}</strong></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Desarrollo Organizacional */}
          {execData?.orgDevelopment && (execData.orgDevelopment.totalPlans > 0 || execData.orgDevelopment.totalInitiatives > 0) && (
            <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.5rem' }}>Desarrollo Organizacional</h3>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div>Planes activos: <strong>{execData.orgDevelopment.activePlans}</strong> de {execData.orgDevelopment.totalPlans}</div>
                <div>Iniciativas: <strong>{execData.orgDevelopment.completedInitiatives}</strong> completadas de {execData.orgDevelopment.totalInitiatives}</div>
              </div>
            </div>
          )}

          {/* ── Comparativa de Ciclos (Clima) ── */}
          {enpsData && (
            <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Comparativa de Ciclos</h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Comparar con:</label>
                <select className="input" style={{ minWidth: '200px', fontSize: '0.82rem' }}
                  value={compareSurveyId || ''} onChange={(e) => setCompareSurveyId(e.target.value || null)}>
                  <option value="">— Seleccionar encuesta —</option>
                  {surveys.filter((s: any) => s.id !== selectedSurveyId).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>
              {compareEnps && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'eNPS Score', curr: enpsData.score, prev: compareEnps.score },
                    { label: 'Promotores', curr: enpsData.promoters, prev: compareEnps.promoters },
                    { label: 'Detractores', curr: enpsData.detractors, prev: compareEnps.detractors },
                  ].map((m, i) => {
                    const d = (m.curr ?? 0) - (m.prev ?? 0);
                    const good = m.label === 'Detractores' ? d < 0 : d > 0;
                    return (
                      <div key={i} style={{ padding: '0.5rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{m.label}</div>
                        <span>{m.curr}</span>
                        <span style={{ margin: '0 0.3rem', color: 'var(--text-muted)' }}>vs</span>
                        <span>{m.prev}</span>
                        {d !== 0 && (
                          <span style={{ marginLeft: '0.5rem', fontWeight: 700, color: good ? 'var(--success)' : 'var(--danger)' }}>
                            {d > 0 ? '▲' : '▼'}{Math.abs(d)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {!compareSurveyId && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Selecciona otra encuesta para comparar</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
