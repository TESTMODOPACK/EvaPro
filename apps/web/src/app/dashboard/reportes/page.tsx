'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCycles } from '@/hooks/useCycles';
import { useCycleSummary } from '@/hooks/useReports';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { getScoreLabel, getScoreColor } from '@/lib/scales';
import { useToastStore } from '@/store/toast.store';

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
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: summary, isLoading: loadingSummary } = useCycleSummary(selectedCycleId);

  // Executive dashboard data (objectives, eNPS, headcount, org dev)
  const [execData, setExecData] = useState<any>(null);
  useEffect(() => {
    if (!token || !selectedCycleId) { setExecData(null); return; }
    api.reports.executiveDashboard(token, selectedCycleId)
      .then(setExecData).catch(() => setExecData(null));
  }, [token, selectedCycleId]);

  const departmentColors = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#a78bfa', '#fb7185', '#ef4444', '#14b8a6'];

  const maxScore = summary?.departmentBreakdown?.length
    ? Math.max(...summary.departmentBreakdown.map((d: any) => Number(d.avgScore) || 0))
    : 10;

  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

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
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `resumen-ciclo-${selectedCycleId}.${format}`;
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

  const selectedCycle = cycles?.find((c: any) => c.id === selectedCycleId);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Resumen Ejecutivo del Ciclo</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Vista integral del ciclo de evaluación: desempeño, objetivos, desarrollo y clima organizacional
        </p>
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? 'Ocultar guía' : 'Cómo funciona'}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Resumen Ejecutivo del Ciclo</h3>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Qué muestra este reporte?</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Una vista integral de un ciclo de evaluación seleccionado, combinando datos de desempeño, objetivos, dotación, clima laboral (eNPS) y desarrollo organizacional. Incluye un análisis rápido automático con interpretaciones de los resultados.
            </p>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Secciones incluidas</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li><strong>Evaluación de Desempeño:</strong> Promedio global, tasa de completitud, desglose por departamento</li>
              <li><strong>Objetivos:</strong> Total, completados, en progreso, tasa de cumplimiento</li>
              <li><strong>Dotación y Clima:</strong> Usuarios activos, eNPS (si hay encuestas), desarrollo organizacional</li>
              <li><strong>Análisis Rápido:</strong> Interpretación automática de los indicadores con recomendaciones</li>
            </ul>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Exportación</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Disponible en PDF (con gráficos), Excel, PowerPoint y CSV. El reporte incluye el detalle de evaluaciones y puntajes por departamento.
            </p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores y encargados de equipo pueden acceder a este reporte. Los encargados ven únicamente los datos de su equipo.
          </div>
        </div>
      )}

      {/* Cycle selector + Export */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        {loadingCycles ? (
          <Spinner />
        ) : !cycles || cycles.length === 0 ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {t('reportes.noCycles')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ciclo:
            </label>
            <select
              style={selectStyle}
              value={selectedCycleId || ''}
              onChange={(e) => setSelectedCycleId(e.target.value || null)}
            >
              <option value="">{t('reportes.selectCycle')}</option>
              {cycles.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status === 'closed' ? 'Cerrado' : c.status === 'active' ? 'Activo' : c.status})
                </option>
              ))}
            </select>
            {selectedCycleId && (
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                {(['pdf', 'xlsx', 'csv'] as const).map((fmt) => (
                  <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}>
                    {exporting === fmt ? '...' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
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
              {/* Cycle info bar */}
              {selectedCycle && (
                <div className="card animate-fade-up" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <span><strong>{selectedCycle.name}</strong></span>
                  <span>Tipo: <strong>{selectedCycle.type}</strong></span>
                  {selectedCycle.startDate && <span>Inicio: <strong>{new Date(selectedCycle.startDate).toLocaleDateString('es-CL')}</strong></span>}
                  {selectedCycle.endDate && <span>Fin: <strong>{new Date(selectedCycle.endDate).toLocaleDateString('es-CL')}</strong></span>}
                  <span style={{
                    padding: '0.15rem 0.5rem', borderRadius: '999px', fontWeight: 600, fontSize: '0.72rem',
                    background: selectedCycle.status === 'closed' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                    color: selectedCycle.status === 'closed' ? 'var(--success)' : 'var(--warning)',
                  }}>
                    {selectedCycle.status === 'closed' ? 'Cerrado' : selectedCycle.status === 'active' ? 'En curso' : selectedCycle.status}
                  </span>
                </div>
              )}

              {/* ─── Section 1: Evaluación de Desempeño ─── */}
              <h2 className="animate-fade-up" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                Evaluación de Desempeño
              </h2>

              {/* KPI row */}
              <div className="animate-fade-up-delay-1 mobile-single-col" style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '1rem', marginBottom: '1.5rem',
              }}>
                {[
                  { label: 'Promedio Global', value: summary.averageScore ? `${Number(summary.averageScore).toFixed(1)}` : '–', sub: summary.averageScore ? getScoreLabel(Number(summary.averageScore)) : '', color: summary.averageScore ? getScoreColor(Number(summary.averageScore)) : '#94a3b8' },
                  { label: 'Tasa de Completitud', value: summary.completionRate != null ? `${summary.completionRate}%` : '–', sub: `${summary.completedAssignments || 0} de ${summary.totalAssignments || 0}`, color: (summary.completionRate || 0) >= 80 ? '#10b981' : (summary.completionRate || 0) >= 50 ? '#f59e0b' : '#ef4444' },
                  { label: 'Evaluaciones', value: String(summary.totalAssignments || 0), sub: `${summary.completedAssignments || 0} completadas`, color: '#6366f1' },
                  { label: 'Departamentos', value: String(summary.departmentBreakdown?.length || 0), sub: 'con evaluaciones', color: '#38bdf8' },
                ].map((m, i) => (
                  <div key={i} className="card" style={{ padding: '1.15rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>{m.label}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: m.color }}>{m.value}</div>
                    {m.sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{m.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Department breakdown */}
              {summary.departmentBreakdown && summary.departmentBreakdown.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '1rem' }}>Desempeño por Departamento</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[...summary.departmentBreakdown]
                      .sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore))
                      .map((d: any, i: number) => {
                        const avg = Number(d.avgScore) || 0;
                        const color = departmentColors[i % departmentColors.length];
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ minWidth: '120px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: 500 }}>
                              {d.department || 'Sin depto.'}
                            </div>
                            <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: maxScore > 0 ? `${(avg / maxScore) * 100}%` : '0%', background: color, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                            </div>
                            <div style={{ minWidth: '90px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontWeight: 800, color, fontSize: '0.88rem' }}>{avg.toFixed(1)}</span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({d.count} eval.)</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* ─── Section 2: Objetivos ─── */}
              {execData?.objectives && (
                <>
                  <h2 className="animate-fade-up" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', marginTop: '0.5rem', color: 'var(--text-primary)' }}>
                    Objetivos de la Organización
                  </h2>
                  <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {[
                      { label: 'Total', value: execData.objectives.total, color: 'var(--text-primary)' },
                      { label: 'Completados', value: execData.objectives.completed, color: '#10b981' },
                      { label: 'En Progreso', value: execData.objectives.inProgress, color: '#6366f1' },
                      { label: 'Pendientes', value: execData.objectives.pendingApproval, color: '#f59e0b' },
                      { label: 'Cumplimiento', value: `${execData.objectives.completionPct || 0}%`, color: (execData.objectives.completionPct || 0) >= 70 ? '#10b981' : '#f59e0b' },
                    ].map((m, i) => (
                      <div key={i} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{m.label}</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: m.color }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ─── Section 3: Headcount & Org ─── */}
              {execData?.headcount && (
                <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
                  {/* Headcount */}
                  <div className="card" style={{ padding: '1.25rem' }}>
                    <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Dotación</h3>
                    <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Activos</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>{execData.headcount.active}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{execData.headcount.total}</div>
                      </div>
                    </div>
                    {execData.headcount.byDepartment?.length > 0 && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {execData.headcount.byDepartment.slice(0, 6).map((d: any) => (
                          <div key={d.department} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{d.department}</span>
                            <strong>{d.count}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* eNPS + Org Development */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* eNPS */}
                    {execData.enps && (
                      <div className="card" style={{ padding: '1.25rem' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.5rem' }}>Clima Laboral (eNPS)</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ fontSize: '2rem', fontWeight: 800, color: execData.enps.score >= 30 ? '#10b981' : execData.enps.score >= 0 ? '#f59e0b' : '#ef4444' }}>
                            {execData.enps.score}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            <div>{execData.enps.promoters || 0} promotores</div>
                            <div>{execData.enps.detractors || 0} detractores</div>
                            <div>{execData.enps.totalResponses || 0} respuestas</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Org Development */}
                    {execData.orgDevelopment && (execData.orgDevelopment.totalPlans > 0 || execData.orgDevelopment.totalInitiatives > 0) && (
                      <div className="card" style={{ padding: '1.25rem' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.5rem' }}>Desarrollo Organizacional</h3>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div>Planes activos: <strong>{execData.orgDevelopment.activePlans}</strong> de {execData.orgDevelopment.totalPlans}</div>
                          <div>Iniciativas: <strong>{execData.orgDevelopment.completedInitiatives}</strong> completadas de {execData.orgDevelopment.totalInitiatives}</div>
                          {execData.orgDevelopment.inProgressInitiatives > 0 && (
                            <div>En progreso: <strong>{execData.orgDevelopment.inProgressInitiatives}</strong></div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── Section 4: Análisis Rápido ─── */}
              {summary.averageScore && (
                <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: `4px solid ${getScoreColor(Number(summary.averageScore))}` }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis Rápido</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {/* Performance interpretation */}
                    <p>
                      <strong>Desempeño:</strong> El promedio global de <strong style={{ color: getScoreColor(Number(summary.averageScore)) }}>{Number(summary.averageScore).toFixed(1)}</strong> ({getScoreLabel(Number(summary.averageScore))})
                      {Number(summary.averageScore) >= 7 ? ' indica un buen nivel de desempeño general en la organización.' :
                       Number(summary.averageScore) >= 5 ? ' está en un rango aceptable pero con oportunidad de mejora.' :
                       ' requiere atención y planes de acción para mejorar el rendimiento.'}
                    </p>

                    {/* Completion */}
                    <p>
                      <strong>Participación:</strong> {summary.completionRate}% de completitud
                      {(summary.completionRate || 0) >= 90 ? ' — excelente participación.' :
                       (summary.completionRate || 0) >= 70 ? ' — buena participación, pero se puede mejorar.' :
                       ' — se recomienda reforzar la comunicación para aumentar la participación.'}
                    </p>

                    {/* Department spread */}
                    {summary.departmentBreakdown?.length >= 2 && (() => {
                      const sorted = [...summary.departmentBreakdown].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
                      const best = sorted[0];
                      const worst = sorted[sorted.length - 1];
                      const gap = (Number(best.avgScore) - Number(worst.avgScore)).toFixed(1);
                      return (
                        <p>
                          <strong>Brecha departamental:</strong> La diferencia entre el departamento mejor evaluado ({best.department}: {Number(best.avgScore).toFixed(1)}) y el menor ({worst.department}: {Number(worst.avgScore).toFixed(1)}) es de <strong>{gap} puntos</strong>.
                          {Number(gap) > 2 ? ' Esta brecha significativa sugiere revisar condiciones específicas en los departamentos con menor puntaje.' : ' La brecha es moderada, indicando consistencia organizacional.'}
                        </p>
                      );
                    })()}

                    {/* Objectives */}
                    {execData?.objectives?.total > 0 && (
                      <p>
                        <strong>Objetivos:</strong> {execData.objectives.completionPct}% de cumplimiento ({execData.objectives.completed} de {execData.objectives.total} completados).
                        {execData.objectives.completionPct >= 70 ? ' Buen nivel de cumplimiento de metas.' :
                         ' Se recomienda revisar los objetivos en riesgo y ofrecer soporte a los equipos rezagados.'}
                      </p>
                    )}

                    {/* eNPS */}
                    {execData?.enps && (
                      <p>
                        <strong>Clima:</strong> eNPS de {execData.enps.score}
                        {execData.enps.score >= 30 ? ' (excelente) — alto nivel de compromiso.' :
                         execData.enps.score >= 0 ? ' (aceptable) — hay espacio para mejorar el compromiso.' :
                         ' (bajo) — se recomienda realizar encuestas de seguimiento e intervenciones de clima.'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ─── Export Section ─── */}
              <div className="card animate-fade-up" style={{ padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Exportar reporte completo:</span>
                  {(['pdf', 'xlsx', 'pptx', 'csv'] as const).map((fmt) => (
                    <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
                      {exporting === fmt ? 'Generando...' : fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  El reporte exportado incluye resumen del ciclo, puntajes por departamento y detalle de evaluaciones. Formatos PDF y PPTX incluyen gráficos.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
