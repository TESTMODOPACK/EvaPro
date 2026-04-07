'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { api } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, Cell, ZAxis } from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

const QUADRANT_CONFIG: Record<string, { label: string; color: string; icon: string; action: string }> = {
  star: { label: 'Estrella', color: '#10b981', icon: '★', action: 'Mantener y replicar buenas prácticas en otras áreas' },
  burnout_risk: { label: 'Riesgo de Burnout', color: '#f59e0b', icon: '⚠', action: 'Intervenir clima urgente — alto riesgo de rotación pese a buen desempeño' },
  opportunity: { label: 'Oportunidad', color: '#6366f1', icon: '↗', action: 'Invertir en capacitación técnica y gestión — el equipo está motivado' },
  critical: { label: 'Crítico', color: '#ef4444', icon: '✕', action: 'Plan de acción integral urgente — bajo desempeño y bajo compromiso' },
  no_data: { label: 'Sin datos', color: '#94a3b8', icon: '?', action: 'No hay datos suficientes para clasificar' },
};

// ─── Cross Result Tab Content ─────────────────────────────────────────

function CrossTabContent({ data, t }: { data: any; t: any }) {
  const { summary, departments, quadrants, categoryCorrelation, insights } = data || {};
  const scatterData = (departments || []).filter((d: any) => d.performance != null && d.engagement != null)
    .map((d: any) => ({ x: d.performance, y: d.engagement, name: d.department, quadrant: d.quadrant }));
  const corrLabel = summary?.correlation == null ? '—' : summary.correlation >= 0.5 ? 'Fuerte positiva' : summary.correlation >= 0.2 ? 'Moderada' : summary.correlation >= -0.2 ? 'Débil' : 'Negativa';

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>Desempeño Prom.</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: summary?.avgPerformance >= 7 ? '#10b981' : summary?.avgPerformance >= 5 ? '#f59e0b' : '#ef4444' }}>{summary?.avgPerformance ?? '–'}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Escala 0-10</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>Clima Prom.</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: summary?.avgEngagement >= 3.5 ? '#10b981' : summary?.avgEngagement >= 2.5 ? '#f59e0b' : '#ef4444' }}>{summary?.avgEngagement ?? '–'}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Escala 1-5</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>eNPS</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: (summary?.eNPS ?? 0) >= 30 ? '#10b981' : (summary?.eNPS ?? 0) >= 0 ? '#f59e0b' : '#ef4444' }}>{summary?.eNPS ?? '–'}</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>Correlación</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{summary?.correlation ?? '–'}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{corrLabel}</div>
        </div>
      </div>

      {/* Scatter Chart */}
      {scatterData.length < 2 && (departments || []).length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
          <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Mapa de Cuadrantes</h4>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No hay suficientes departamentos con datos de desempeno y clima para generar el grafico. Se requieren al menos 2 departamentos con ambos valores.</p>
        </div>
      )}
      {scatterData.length >= 2 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Mapa de Cuadrantes</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Cada punto es un departamento. Eje X: desempeño (0-10), Eje Y: clima (1-5). Los umbrales definen 4 cuadrantes.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="x" name="Desempeño" domain={[0, 10]} tick={{ fontSize: 10 }}
                label={{ value: 'Desempeño (0-10)', position: 'bottom', fontSize: 10, fill: '#94a3b8' }} />
              <YAxis type="number" dataKey="y" name="Clima" domain={[1, 5]} tick={{ fontSize: 10 }}
                label={{ value: 'Clima (1-5)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }} />
              <ZAxis range={[80, 80]} />
              <Tooltip content={({ payload }: any) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                const q = QUADRANT_CONFIG[d.quadrant];
                return (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}>
                    <strong>{d.name}</strong><br/>Desempeño: {d.x} | Clima: {d.y}<br/>
                    <span style={{ color: q?.color }}>{q?.icon} {q?.label}</span>
                  </div>
                );
              }} />
              <Scatter data={scatterData} name="Departamentos">
                {scatterData.map((d: any, i: number) => <Cell key={i} fill={QUADRANT_CONFIG[d.quadrant]?.color || '#94a3b8'} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Umbral desempeño: ≥ 7.0</span><span>Umbral clima: ≥ 3.5</span>
          </div>
        </div>
      )}

      {/* Quadrant Analysis — detailed interpretation */}
      {(departments || []).length > 0 && (() => {
        const depts = departments || [];
        const stars = (quadrants?.star || []);
        const burnout = (quadrants?.burnout_risk || []);
        const opportunity = (quadrants?.opportunity || []);
        const critical = (quadrants?.critical || []);
        const totalDepts = depts.length;
        const withData = depts.filter((d: any) => d.performance != null && d.engagement != null).length;

        // Best and worst
        const sorted = [...depts].filter((d: any) => d.performance != null).sort((a: any, b: any) => b.performance - a.performance);
        const bestPerf = sorted[0];
        const worstPerf = sorted[sorted.length - 1];
        const sortedClima = [...depts].filter((d: any) => d.engagement != null).sort((a: any, b: any) => b.engagement - a.engagement);
        const bestClima = sortedClima[0];
        const worstClima = sortedClima[sortedClima.length - 1];

        // Correlation interpretation
        const corr = summary?.correlation;
        const corrText = corr == null ? null
          : corr >= 0.5 ? 'Existe una correlacion positiva fuerte: los departamentos con mejor clima tienden a tener mejor desempeno. Esto sugiere que las iniciativas de bienestar impactan directamente en la productividad.'
          : corr >= 0.2 ? 'Existe una correlacion positiva moderada: hay una tendencia a que mejor clima se asocie con mejor desempeno, aunque otros factores tambien influyen.'
          : corr >= -0.2 ? 'La correlacion es debil o nula: el clima y el desempeno parecen ser independientes en esta medicion. Puede indicar que los equipos mantienen productividad independiente de su satisfaccion, o que los instrumentos miden aspectos diferentes.'
          : 'Existe una correlacion negativa: algunos departamentos con buen desempeno tienen bajo clima (posible burnout) y viceversa. Esto requiere atencion inmediata.';

        return (
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
            <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>Analisis del Mapa de Cuadrantes</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>

              {/* Overview */}
              <p style={{ margin: 0 }}>
                <strong>Resumen:</strong> De {totalDepts} departamentos analizados, {withData} tienen datos completos de desempeno y clima.
                {stars.length > 0 && <> <strong style={{ color: '#10b981' }}>{stars.length}</strong> se clasifican como <strong style={{ color: '#10b981' }}>Estrella</strong> (alto desempeno + buen clima).</>}
                {burnout.length > 0 && <> <strong style={{ color: '#f59e0b' }}>{burnout.length}</strong> presentan <strong style={{ color: '#f59e0b' }}>Riesgo de Burnout</strong> (buen desempeno pero clima bajo).</>}
                {opportunity.length > 0 && <> <strong style={{ color: '#6366f1' }}>{opportunity.length}</strong> son <strong style={{ color: '#6366f1' }}>Oportunidad</strong> (buen clima pero desempeno mejorable).</>}
                {critical.length > 0 && <> <strong style={{ color: '#ef4444' }}>{critical.length}</strong> estan en estado <strong style={{ color: '#ef4444' }}>Critico</strong> (bajo en ambos indicadores).</>}
              </p>

              {/* Correlation */}
              {corrText && <p style={{ margin: 0 }}><strong>Correlacion desempeno-clima:</strong> {corrText}</p>}

              {/* Highlights */}
              {bestPerf && worstPerf && bestPerf.department !== worstPerf.department && (
                <p style={{ margin: 0 }}>
                  <strong>Desempeno:</strong> El departamento con mayor puntaje es <strong style={{ color: '#10b981' }}>{bestPerf.department}</strong> ({bestPerf.performance}/10)
                  y el menor es <strong style={{ color: '#ef4444' }}>{worstPerf.department}</strong> ({worstPerf.performance}/10),
                  una brecha de {(bestPerf.performance - worstPerf.performance).toFixed(1)} puntos.
                </p>
              )}
              {bestClima && worstClima && bestClima.department !== worstClima.department && (
                <p style={{ margin: 0 }}>
                  <strong>Clima:</strong> El mejor clima lo tiene <strong style={{ color: '#10b981' }}>{bestClima.department}</strong> ({bestClima.engagement}/5)
                  y el mas bajo <strong style={{ color: '#ef4444' }}>{worstClima.department}</strong> ({worstClima.engagement}/5).
                </p>
              )}

              {/* Action items per quadrant */}
              {burnout.length > 0 && (
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.15)' }}>
                  <strong style={{ color: '#f59e0b' }}>{'⚠'} Atencion — Riesgo de Burnout:</strong> {burnout.map((d: any) => d.department).join(', ')} tienen buen desempeno pero clima deteriorado. Esto puede provocar rotacion de talento clave. Se recomienda: revisar cargas de trabajo, implementar encuestas de pulso, y abrir espacios de retroalimentacion.
                </div>
              )}
              {critical.length > 0 && (
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <strong style={{ color: '#ef4444' }}>{'✕'} Alerta — Departamentos Criticos:</strong> {critical.map((d: any) => d.department).join(', ')} requieren intervencion integral. Se sugiere: diagnostico profundo de causas, reunion con lideres de area, plan de accion con metas a 30/60/90 dias.
                </div>
              )}
              {opportunity.length > 0 && (
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.15)' }}>
                  <strong style={{ color: '#6366f1' }}>{'↗'} Oportunidad de Desarrollo:</strong> {opportunity.map((d: any) => d.department).join(', ')} tienen equipos motivados con espacio para mejorar desempeno. Se recomienda: capacitacion tecnica, mentorias cruzadas con departamentos estrella, y definicion de OKRs claros.
                </div>
              )}
              {stars.length > 0 && (
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <strong style={{ color: '#10b981' }}>{'★'} Departamentos Estrella:</strong> {stars.map((d: any) => d.department).join(', ')} son referentes de la organizacion. Documentar sus buenas practicas y replicarlas en otras areas. Considerar reconocimiento publico al equipo.
                </div>
              )}

              {stars.length === 0 && burnout.length === 0 && opportunity.length === 0 && critical.length === 0 && (
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>No hay departamentos clasificados en cuadrantes. Esto puede deberse a falta de datos de clima o desempeno para este cruce.</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Quadrant Legend */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <h4 style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.5rem' }}>Clasificacion por Cuadrante</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {Object.entries(QUADRANT_CONFIG).filter(([k]) => k !== 'no_data').map(([key, q]) => {
            const count = (quadrants?.[key] || []).length;
            return (
              <div key={key} style={{ padding: '0.5rem 0.75rem', background: `${q.color}08`, borderLeft: `3px solid ${q.color}`, borderRadius: '0 6px 6px 0', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <strong style={{ color: q.color }}>{q.icon} {q.label}</strong>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{count} depto.</span>
                </div>
                {count > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{(quadrants?.[key] || []).map((d: any) => d.department).join(', ')}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Department Table */}
      {departments?.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Detalle por Departamento</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Puntaje de desempeño (evaluaciones) y clima (encuesta) por área, con clasificación de cuadrante.</p>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Departamento</th>
                  <th style={{ textAlign: 'center' }}>Desempeño</th>
                  <th style={{ textAlign: 'center' }}>Clima</th>
                  <th style={{ textAlign: 'center' }}>Cuadrante</th>
                  <th style={{ textAlign: 'center' }}>Eval.</th>
                  <th style={{ textAlign: 'center' }}>Resp.</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d: any) => {
                  const q = QUADRANT_CONFIG[d.quadrant];
                  return (
                    <tr key={d.department}>
                      <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{d.department}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: d.performance >= 7 ? '#10b981' : d.performance >= 5 ? '#f59e0b' : '#ef4444' }}>{d.performance ?? '–'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: d.engagement >= 3.5 ? '#10b981' : d.engagement >= 2.5 ? '#f59e0b' : '#ef4444' }}>{d.engagement ?? '–'}</td>
                      <td style={{ textAlign: 'center' }}><span style={{ padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, background: `${q?.color}15`, color: q?.color }}>{q?.icon} {q?.label}</span></td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{d.performanceCount}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{d.engagementCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Climate Dimensions */}
      {categoryCorrelation?.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Dimensiones de Clima</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Promedio de cada categoría de la encuesta de clima (escala 1-5).</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {categoryCorrelation.map((c: any) => {
              const pct = ((c.avgScore - 1) / 4) * 100;
              const color = c.avgScore >= 4 ? '#10b981' : c.avgScore >= 3 ? '#f59e0b' : '#ef4444';
              return (
                <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <span style={{ minWidth: 110, fontWeight: 500 }}>{c.category}</span>
                  <div style={{ flex: 1, height: 7, borderRadius: 999, background: 'var(--border)' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: color, transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ fontWeight: 700, color, minWidth: 30, textAlign: 'right' }}>{c.avgScore}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Insights */}
      {insights?.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
          <h4 style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.5rem' }}>Análisis del Cruce</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {insights.map((ins: string, i: number) => (
              <p key={i} style={{ margin: 0, paddingLeft: '0.75rem', borderLeft: '2px solid var(--border)' }}>{ins}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────

function AnalisisIntegradoContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Selectors
  const [availableCycles, setAvailableCycles] = useState<any[]>([]);
  const [availableSurveys, setAvailableSurveys] = useState<any[]>([]);
  const [selectedCycleIds, setSelectedCycleIds] = useState<Set<string>>(new Set());
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('');
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Results: global summary + per-cycle results
  const [globalData, setGlobalData] = useState<any>(null);
  const [perCycleData, setPerCycleData] = useState<Map<string, any>>(new Map());
  const [activeTabCycleId, setActiveTabCycleId] = useState<string | null>(null);

  // Load available data
  useEffect(() => {
    if (!token) return;
    api.reports.crossAnalysisAvailable(token)
      .then(({ cycles, surveys }: any) => { setAvailableCycles(cycles || []); setAvailableSurveys(surveys || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleAnalyze = async () => {
    if (!token || selectedCycleIds.size === 0 || !selectedSurveyId) return;
    setLoadingAnalysis(true);
    setError(null);
    setGlobalData(null);
    setPerCycleData(new Map());

    const cycleIdsArr = Array.from(selectedCycleIds);

    try {
      // 1. Global + per-cycle analysis in parallel
      const [globalRes, ...perCycleResults] = await Promise.all([
        api.reports.crossAnalysis(token, cycleIdsArr, selectedSurveyId),
        ...cycleIdsArr.map(cid => api.reports.crossAnalysis(token, [cid], selectedSurveyId).catch(() => null)),
      ]);
      const perCycleMap = new Map<string, any>();
      cycleIdsArr.forEach((cid, i) => perCycleMap.set(cid, perCycleResults[i]));
      // Set all data at once to avoid flash of partial content
      setGlobalData(globalRes);
      setPerCycleData(perCycleMap);
      setActiveTabCycleId(cycleIdsArr[0]);
    } catch (e: any) { setError(e.message); }
    setLoadingAnalysis(false);
  };

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const exportParams = new URLSearchParams({ format });
      if (selectedCycleIds.size > 0) exportParams.set('cycleIds', Array.from(selectedCycleIds).join(','));
      if (selectedSurveyId) exportParams.set('surveyId', selectedSurveyId);
      const res = await fetch(`${API}/reports/cross-analysis/export?${exportParams}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `analisis-integrado.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;

  // Build cycle name map
  const cycleNameMap = new Map(availableCycles.map((c: any) => [c.id, c.name]));
  const selectedSurveyName = availableSurveys.find((s: any) => s.id === selectedSurveyId)?.title || '';

  // Generate comparative analysis
  const generateComparativeAnalysis = (): string[] => {
    if (perCycleData.size < 2) return [];
    const analyses: string[] = [];
    const entries = Array.from(perCycleData.entries()).filter(([, d]) => d?.summary);

    // Best/worst correlation (spread to avoid mutating entries)
    const byCorr = [...entries].sort(([, a], [, b]) => (b.summary?.correlation || 0) - (a.summary?.correlation || 0));
    if (byCorr.length >= 2) {
      analyses.push(`${cycleNameMap.get(byCorr[0][0]) || 'Ciclo'} tiene la correlación más fuerte entre desempeño y clima (r=${byCorr[0][1].summary?.correlation}), mientras que ${cycleNameMap.get(byCorr[byCorr.length - 1][0]) || 'Ciclo'} tiene la más débil (r=${byCorr[byCorr.length - 1][1].summary?.correlation}).`);
    }

    // eNPS comparison
    const byEnps = [...entries].sort(([, a], [, b]) => (b.summary?.eNPS || 0) - (a.summary?.eNPS || 0));
    if (byEnps.length >= 2) {
      analyses.push(`El eNPS más alto corresponde a ${cycleNameMap.get(byEnps[0][0]) || 'Ciclo'} (${byEnps[0][1].summary?.eNPS}) y el más bajo a ${cycleNameMap.get(byEnps[byEnps.length - 1][0]) || 'Ciclo'} (${byEnps[byEnps.length - 1][1].summary?.eNPS}).`);
    }

    // Consistent star departments
    const allStars = entries.map(([, d]) => new Set<string>((d.quadrants?.star || []).map((dep: any) => dep.department)));
    if (allStars.length >= 2) {
      const consistent = Array.from(allStars[0]).filter(dept => allStars.every(s => s.has(dept)));
      if (consistent.length > 0) analyses.push(`Departamentos "Estrella" consistentes en todos los cruces: ${consistent.join(', ')}.`);
    }

    // Consistent critical departments
    const allCritical = entries.map(([, d]) => new Set<string>((d.quadrants?.critical || []).map((dep: any) => dep.department)));
    if (allCritical.length >= 2) {
      const consistent = Array.from(allCritical[0]).filter(dept => allCritical.every(s => s.has(dept)));
      if (consistent.length > 0) analyses.push(`Departamentos en cuadrante "Crítico" en todos los cruces: ${consistent.join(', ')}. Requieren intervención urgente.`);
    }

    // Performance trend
    const byPerf = [...entries].sort(([, a], [, b]) => (b.summary?.avgPerformance || 0) - (a.summary?.avgPerformance || 0));
    if (byPerf.length >= 2) {
      const diff = (byPerf[0][1].summary?.avgPerformance || 0) - (byPerf[byPerf.length - 1][1].summary?.avgPerformance || 0);
      if (diff > 0.5) analyses.push(`La diferencia de desempeño promedio entre cruces es de ${diff.toFixed(1)} puntos, lo que indica variabilidad entre períodos.`);
    }

    return analyses;
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('crossAnalysis.title')}</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Correlación entre evaluación de desempeño y clima laboral — un tab por cada cruce ciclo↔encuesta.
            </p>
          </div>
          {globalData && !globalData.error && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['pdf', 'xlsx'] as const).map(fmt => (
                <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
                  {exporting === fmt ? '...' : fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.75rem' }}>Guía del Análisis Integrado</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p><strong>¿Qué es?</strong> Cruce estadístico entre evaluaciones de desempeño y encuestas de clima. Identifica patrones que no se ven al analizar cada sistema por separado.</p>
            <p><strong>¿Cómo funciona?</strong> Seleccione 1 encuesta de clima y 1 o más ciclos de evaluación. Se generará un tab por cada cruce ciclo↔encuesta, más un resumen comparativo global.</p>
            <p><strong>Los 4 Cuadrantes:</strong></p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.5rem' }}>
              {Object.entries(QUADRANT_CONFIG).filter(([k]) => k !== 'no_data').map(([key, q]) => (
                <div key={key} style={{ padding: '0.35rem 0.6rem', background: `${q.color}10`, borderLeft: `3px solid ${q.color}`, borderRadius: '0 4px 4px 0', fontSize: '0.78rem' }}>
                  <strong style={{ color: q.color }}>{q.icon} {q.label}:</strong> {q.action}
                </div>
              ))}
            </div>
            <p><strong>Correlación:</strong> Coeficiente Pearson entre clima y desempeño por departamento. Valores ≥0.5 indican relación fuerte positiva.</p>
          </div>
        </div>
      )}

      {/* Selectors */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 250px' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Encuesta de Clima</label>
            <select className="input" value={selectedSurveyId} onChange={(e) => { setSelectedSurveyId(e.target.value); setSelectedCycleIds(new Set()); setGlobalData(null); setPerCycleData(new Map()); setActiveTabCycleId(null); }} style={{ fontSize: '0.82rem' }}>
              <option value="">Seleccionar encuesta...</option>
              {availableSurveys.map((s: any) => (
                <option key={s.id} value={s.id}>{s.title} ({s.endDate ? new Date(s.endDate).toLocaleDateString('es-CL') : ''})</option>
              ))}
            </select>
          </div>
          {selectedSurveyId && (() => {
            const survey = availableSurveys.find((s: any) => s.id === selectedSurveyId);
            const surveyEnd = survey?.endDate ? new Date(survey.endDate).getTime() : 0;
            const oneYear = 365 * 24 * 60 * 60 * 1000;
            const filteredCycles = surveyEnd ? availableCycles.filter((c: any) => {
              const cycleEnd = c.endDate ? new Date(c.endDate).getTime() : 0;
              return cycleEnd > 0 && Math.abs(cycleEnd - surveyEnd) <= oneYear;
            }) : availableCycles;
            return (
              <div style={{ flex: '2 1 350px' }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                  Ciclos de Evaluación <span style={{ fontWeight: 400, textTransform: 'none' }}>(cada ciclo genera un tab)</span>
                </label>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {filteredCycles.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sin ciclos en el rango de ±1 año</span>}
                  {filteredCycles.map((c: any) => {
                    const sel = selectedCycleIds.has(c.id);
                    return (
                      <button key={c.id} type="button"
                        onClick={() => setSelectedCycleIds(prev => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })}
                        style={{
                          padding: '0.35rem 0.65rem', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.78rem',
                          border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: sel ? 'rgba(201,147,58,0.1)' : 'var(--bg-surface)',
                          color: sel ? 'var(--accent)' : 'var(--text-primary)', fontWeight: sel ? 700 : 400, cursor: 'pointer',
                        }}>{c.name}</button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <button className="btn-primary" onClick={handleAnalyze} disabled={loadingAnalysis || !selectedSurveyId || selectedCycleIds.size === 0}
            style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
            {loadingAnalysis ? 'Analizando...' : `Analizar (${selectedCycleIds.size} cruce${selectedCycleIds.size !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--danger)' }}>{error}</div>
      )}

      {/* Loading */}
      {loadingAnalysis && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ marginBottom: '1rem' }} />
          <p>Analizando {selectedCycleIds.size} cruce{selectedCycleIds.size !== 1 ? 's' : ''}...</p>
        </div>
      )}

      {/* ═══ RESULTS ═══ */}
      {globalData && !globalData.error && !loadingAnalysis && (
        <>
          {/* Global Summary */}
          <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              Resumen Global — {selectedCycleIds.size} cruce{selectedCycleIds.size !== 1 ? 's' : ''} con "{selectedSurveyName}"
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Desempeño Prom.</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{globalData.summary?.avgPerformance ?? '–'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Clima Prom.</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{globalData.summary?.avgEngagement ?? '–'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>eNPS Global</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: (globalData.summary?.eNPS ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{globalData.summary?.eNPS ?? '–'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Correlación</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent)' }}>{globalData.summary?.correlation ?? '–'}</div>
              </div>
            </div>

            {/* Comparative analysis (only if 2+ cycles) */}
            {perCycleData.size >= 2 && (() => {
              const analyses = generateComparativeAnalysis();
              return analyses.length > 0 ? (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>Análisis Comparativo entre Cruces:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {analyses.map((a, i) => <p key={i} style={{ margin: 0, paddingLeft: '0.75rem', borderLeft: '2px solid var(--accent)' }}>• {a}</p>)}
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {/* Dynamic Tabs — 1 per cycle */}
          {perCycleData.size > 0 && (
            <>
              <div className="animate-fade-up" style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                {Array.from(selectedCycleIds).map((cid: string) => (
                  <button key={cid} onClick={() => setActiveTabCycleId(cid)} style={{
                    padding: '0.55rem 0.85rem', fontSize: '0.8rem', whiteSpace: 'nowrap',
                    fontWeight: activeTabCycleId === cid ? 700 : 500,
                    color: activeTabCycleId === cid ? 'var(--accent)' : 'var(--text-secondary)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: `2px solid ${activeTabCycleId === cid ? 'var(--accent)' : 'transparent'}`,
                    marginBottom: '-1px',
                  }}>
                    {cycleNameMap.get(cid) || cid.slice(0, 8)} ↔ {selectedSurveyName?.slice(0, 20) || 'Clima'}
                  </button>
                ))}
              </div>

              {/* Active tab content */}
              {activeTabCycleId && perCycleData.get(activeTabCycleId) && (
                <div className="animate-fade-up">
                  <CrossTabContent data={perCycleData.get(activeTabCycleId)} t={t} />
                </div>
              )}
              {activeTabCycleId && !perCycleData.get(activeTabCycleId) && (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No se pudo cargar el análisis para este ciclo.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function AnalisisIntegradoPage() {
  return (
    <PlanGate feature="ADVANCED_REPORTS">
      <AnalisisIntegradoContent />
    </PlanGate>
  );
}
