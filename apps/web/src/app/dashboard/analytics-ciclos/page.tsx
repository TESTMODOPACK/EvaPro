'use client';
import { PlanGate } from '@/components/PlanGate';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAiBias, useAnalyzeBias } from '@/hooks/useAiInsights';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

const biasTypeLabel: Record<string, string> = {
  leniency: 'Lenidad', severity: 'Severidad', halo: 'Efecto Halo',
  central_tendency: 'Tendencia Central', contrast: 'Contraste',
};
const severityBadge: Record<string, string> = {
  high: 'badge-danger', medium: 'badge-warning', low: 'badge-success',
};

function CycleComparisonPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<any>(null);
  const { isBlocked: aiBlocked } = useAiQuota();
  const [showGuide, setShowGuide] = useState(false);
  const [biasSelectedCycleId, setBiasSelectedCycleId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/reports/analytics/cycle-comparison`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));

    // Load AI quota
    fetch(`${API}/ai/usage`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setQuotaInfo).catch(() => {});
  }, [token]);

  const toggleCycle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setAiAnalysis(null);
    setAnalyzeError(null);
  };

  const selectAll = () => {
    if (!data?.cycles) return;
    if (selected.size === data.cycles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.cycles.map((c: any) => c.cycleId)));
    }
    setAiAnalysis(null);
  };

  const handleAnalyze = async () => {
    if (!token || selected.size < 2) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`${API}/ai/cycle-comparison`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al generar análisis');
      }
      const result = await res.json();
      setAiAnalysis(result);
      // Refresh quota
      fetch(`${API}/ai/usage`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null).then(setQuotaInfo).catch(() => {});
    } catch (e: any) {
      setAnalyzeError(e.message);
    }
    setAnalyzing(false);
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${API}/reports/analytics/cycle-comparison/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparativa-ciclos.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={3} tableRows={5} />;
  if (!data?.cycles?.length) return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analyticsCiclos.title')}</h1>
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
        {t('analyticsCiclos.noCycles')}
      </div>
    </div>
  );

  const cycles = data.cycles;
  const selectedCycles = cycles.filter((c: any) => selected.has(c.cycleId));
  const chartData = (selectedCycles.length >= 2 ? selectedCycles : cycles)
    .map((c: any) => ({ name: c.cycleName, promedio: c.avgScore, min: c.minScore, max: c.maxScore }));

  // Department comparison across selected cycles
  const allDepts = new Set<string>();
  selectedCycles.forEach((c: any) => c.byDepartment?.forEach((d: any) => allDepts.add(d.department)));
  const deptCompareData = Array.from(allDepts).map(dept => {
    const row: any = { department: dept };
    selectedCycles.forEach((c: any) => {
      const d = c.byDepartment?.find((dd: any) => dd.department === dept);
      row[c.cycleName] = d?.avgScore ?? null;
    });
    return row;
  }).sort((a, b) => a.department.localeCompare(b.department));

  const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analyticsCiclos.title')}</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('analyticsCiclos.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => handleExport('xlsx')} disabled={!!exporting}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
              {exporting === 'xlsx' ? t('common.exporting') : t('common.exportExcel')}
            </button>
          </div>
        </div>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('analyticsCiclos.guide.title')}</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>¿Qué muestra?</strong> Comparación entre 2 o más ciclos de evaluación cerrados, mostrando evolución de puntajes y distribución por departamento.</p>
            <p><strong>Cómo usar:</strong> 1) Seleccionar 2+ ciclos haciendo clic en cada uno. 2) Ver gráficos comparativos automáticos. 3) Opcionalmente, generar análisis con IA.</p>
            <p><strong>Gráficos:</strong> Tendencia de puntaje promedio/mín/máx entre ciclos, y comparativa por departamento en gráfico horizontal agrupado.</p>
            <p><strong>Análisis IA comparativo:</strong> Genera un análisis profundo con resumen ejecutivo, tendencias, fortalezas, alertas, departamentos que mejoraron/empeoraron, y recomendaciones. Consume 1 crédito de su cuota mensual de IA.</p>
            <p><strong>Detección de Sesgos:</strong> Identifica patrones de sesgo en evaluadores del ciclo (lenidad, severidad, efecto halo, tendencia central) con evidencia estadística y recomendaciones. Consume 1 crédito IA.</p>
            <p><strong>Exportación:</strong> Excel y CSV con datos de todos los ciclos y desglose departamental.</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores ven todos los ciclos. Encargados ven solo los datos de su equipo.
          </div>
        </div>
      )}

      {/* Cycle Selection */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{t('analyticsCiclos.selectCycles')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={selectAll} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600,
            }}>
              {selected.size === cycles.length ? t('analyticsCiclos.deselectAll') : t('analyticsCiclos.selectAll')}
            </button>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{selected.size} de {cycles.length} {t('analyticsCiclos.selected')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {cycles.map((c: any) => {
            const isSelected = selected.has(c.cycleId);
            return (
              <button
                key={c.cycleId}
                onClick={() => toggleCycle(c.cycleId)}
                style={{
                  padding: '0.5rem 0.85rem', borderRadius: 'var(--radius-sm, 6px)',
                  border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: isSelected ? 'rgba(201,147,58,0.1)' : 'var(--bg-surface)',
                  cursor: 'pointer', fontSize: '0.82rem', fontWeight: isSelected ? 700 : 400,
                  color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>{c.cycleName}</span>
                  <span className="badge badge-ghost" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>{c.cycleType}°</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {c.avgScore ? `Prom: ${c.avgScore}` : `${c.totalEvaluated} evaluados · sin puntajes`} {c.avgScore ? `· ${c.withScores} eval.` : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mixed cycle types warning */}
      {(() => {
        const selectedCycles = cycles.filter((c: any) => selected.has(c.cycleId));
        const types = new Set(selectedCycles.map((c: any) => c.cycleType));
        if (types.size > 1 && selectedCycles.length >= 2) {
          const typeList = Array.from(types).map((t: any) => `${t}°`).join(', ');
          return (
            <div className="card animate-fade-up" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--warning)', background: 'rgba(245,158,11,0.06)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--warning)' }}>Tipos de evaluación diferentes:</strong> Has seleccionado ciclos de tipo {typeList}. Los puntajes pueden diferir significativamente entre tipos de evaluación (un 360° incluye más evaluadores que un 90°), por lo que la comparación debe interpretarse con precaución.
              </p>
            </div>
          );
        }
        return null;
      })()}

      {/* AI Quota Bar */}
      <AiQuotaBar />

      {/* AI Analysis Button */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          onClick={handleAnalyze}
          disabled={selected.size < 2 || analyzing || aiBlocked}
          style={{ fontSize: '0.85rem', opacity: selected.size < 2 || analyzing || aiBlocked ? 0.5 : 1 }}
        >
          {analyzing ? t('analyticsCiclos.analyzing') : `${t('analyticsCiclos.analyzeCycles')} (${selected.size})`}
        </button>
        {selected.size < 2 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('analyticsCiclos.selectAtLeast2')}</span>
        )}
        {analyzeError && (
          <span style={{ fontSize: '0.82rem', color: 'var(--danger)', fontWeight: 500 }}>{analyzeError}</span>
        )}
      </div>

      {/* Evolution chart */}
      {chartData.length >= 2 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>
            {t('analyticsCiclos.trend')} {selectedCycles.length >= 2 ? '(seleccionados)' : '(todos)'}
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="promedio" fill="#C9933A" name="Promedio" radius={[4, 4, 0, 0]} />
              <Bar dataKey="min" fill="#10b981" name="Mínimo" radius={[4, 4, 0, 0]} />
              <Bar dataKey="max" fill="#6366f1" name="Máximo" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Department comparison chart (only if 2+ cycles selected) */}
      {selectedCycles.length >= 2 && deptCompareData.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsCiclos.deptComparison')}</h2>
          <ResponsiveContainer width="100%" height={Math.max(250, deptCompareData.length * 40)}>
            <BarChart data={deptCompareData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="department" tick={{ fontSize: 10 }} width={120} />
              <Tooltip />
              <Legend />
              {selectedCycles.map((c: any, i: number) => (
                <Bar key={c.cycleId} dataKey={c.cycleName} fill={COLORS[i % COLORS.length]} name={c.cycleName} radius={[0, 4, 4, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cycle cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        {(selectedCycles.length >= 2 ? selectedCycles : cycles).map((c: any, i: number, arr: any[]) => {
          const prev = i > 0 ? arr[i - 1] : null;
          const delta = prev && c.avgScore && prev.avgScore ? (c.avgScore - prev.avgScore).toFixed(2) : null;
          return (
            <div key={c.cycleId} className="card animate-fade-up" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>{c.cycleName}</h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {c.cycleType} — {c.startDate ? new Date(c.startDate).toLocaleDateString('es-CL') : ''} al {c.endDate ? new Date(c.endDate).toLocaleDateString('es-CL') : ''}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{c.avgScore ?? '—'}</div>
                  {delta && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: Number(delta) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {Number(delta) >= 0 ? '▲' : '▼'} {Math.abs(Number(delta))} vs anterior
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>Evaluados: <strong>{c.totalEvaluated}</strong></span>
                <span>Con puntaje: <strong>{c.withScores}</strong></span>
                {c.minScore != null && <span>Mín: <strong>{c.minScore}</strong></span>}
                {c.maxScore != null && <span>Máx: <strong>{c.maxScore}</strong></span>}
              </div>
              {c.byDepartment?.length > 0 && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {c.byDepartment.slice(0, 6).map((d: any) => (
                      <span key={d.department} style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.75rem' }}>
                        {d.department}: <strong>{d.avgScore}</strong> ({d.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Analysis Results */}
      {aiAnalysis?.analysis && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', borderLeft: '4px solid #6366f1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {t('analyticsCiclos.aiAnalysis')}
              <span style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', borderRadius: '999px', fontWeight: 600 }}>
                Anthropic Claude
              </span>
            </h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {aiAnalysis.generatedAt ? new Date(aiAnalysis.generatedAt).toLocaleString('es-CL') : ''} · {aiAnalysis.tokensUsed || 0} tokens
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.88rem', lineHeight: 1.6 }}>
            {/* Summary */}
            <div>
              <strong>{t('analyticsCiclos.summary')}</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.84rem', whiteSpace: 'pre-line' }}>
                {aiAnalysis.analysis.resumen}
              </p>
            </div>

            {/* Trends */}
            {aiAnalysis.analysis.tendencias?.length > 0 && (
              <div>
                <strong>{t('analyticsCiclos.trends')}</strong>
                <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {aiAnalysis.analysis.tendencias.map((t: string, i: number) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Strengths */}
              {aiAnalysis.analysis.fortalezas?.length > 0 && (
                <div style={{ padding: '0.85rem', background: 'rgba(16,185,129,0.06)', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <strong style={{ color: 'var(--success)', fontSize: '0.85rem' }}>{t('analyticsCiclos.strengths')}</strong>
                  <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {aiAnalysis.analysis.fortalezas.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}

              {/* Alerts */}
              {aiAnalysis.analysis.alertas?.length > 0 && (
                <div style={{ padding: '0.85rem', background: 'rgba(239,68,68,0.06)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <strong style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{t('analyticsCiclos.alerts')}</strong>
                  <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {aiAnalysis.analysis.alertas.map((a: string, i: number) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
            </div>

            {/* Department changes */}
            {aiAnalysis.analysis.departamentos && (
              <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {aiAnalysis.analysis.departamentos.mejoraron?.length > 0 && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--success)' }}>{t('analyticsCiclos.deptsImproved')}</strong>
                    <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {aiAnalysis.analysis.departamentos.mejoraron.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
                {aiAnalysis.analysis.departamentos.empeoraron?.length > 0 && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>{t('analyticsCiclos.deptsDeclined')}</strong>
                    <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {aiAnalysis.analysis.departamentos.empeoraron.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Recommendations */}
            {aiAnalysis.analysis.recomendaciones?.length > 0 && (
              <div style={{ padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <strong style={{ fontSize: '0.85rem' }}>Recomendaciones</strong>
                <ul style={{ margin: '0.3rem 0 0 1.25rem', padding: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {aiAnalysis.analysis.recomendaciones.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}

            {/* Conclusion */}
            {aiAnalysis.analysis.conclusion && (
              <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', fontWeight: 500, fontSize: '0.85rem' }}>
                {aiAnalysis.analysis.conclusion}
              </div>
            )}
          </div>

          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {t('analyticsCiclos.aiDisclaimer')}
          </div>
        </div>
      )}
      {/* ═══ Bias Detection Section — admin only ═══ */}
      {isAdmin && <div className="animate-fade-up" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {'🔍'} Detección de Sesgos por Ciclo
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1rem' }}>
          Analiza patrones de evaluación (lenidad, severidad, efecto halo) de todos los evaluadores de un ciclo
        </p>

        {/* Cycle selector for bias */}
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
            Seleccionar ciclo para análisis de sesgos
          </label>
          <select
            className="input"
            style={{ width: '100%', maxWidth: '400px' }}
            value={biasSelectedCycleId || ''}
            onChange={(e) => setBiasSelectedCycleId(e.target.value || null)}
          >
            <option value="">Selecciona un ciclo</option>
            {cycles.map((c: any) => (
              <option key={c.cycleId} value={c.cycleId}>{c.cycleName} — Prom: {c.avgScore ?? '—'} ({c.withScores} eval.)</option>
            ))}
          </select>
        </div>

        {biasSelectedCycleId && (
          <BiasAnalysisSection key={`bias-${biasSelectedCycleId}`} cycleId={biasSelectedCycleId} aiBlocked={aiBlocked} />
        )}
      </div>}
    </div>
  );
}

/* ─── Bias Analysis Section (inline in cycle analytics) ───────────────── */
function BiasAnalysisSection({ cycleId, aiBlocked }: { cycleId: string; aiBlocked: boolean }) {
  const { data: cached, isLoading } = useAiBias(cycleId);
  const analyze = useAnalyzeBias();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
        <span className="spinner" />
      </div>
    );
  }

  const data = cached?.content;

  if (!data) {
    return (
      <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>{'🔍'}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '0.5rem' }}>
          No hay análisis de sesgos para este ciclo
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '1rem' }}>
          Cada generación consume 1 crédito de la cuota mensual de tu organización.
        </p>
        <button
          className="btn-primary"
          onClick={() => analyze.mutate(cycleId)}
          disabled={analyze.isPending || aiBlocked}
        >
          {analyze.isPending ? 'Analizando sesgos...' : aiBlocked ? 'Créditos IA agotados' : 'Analizar Sesgos con IA'}
        </button>
        {analyze.isPending && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Analizando patrones estadísticos del ciclo... Este proceso puede tardar hasta 30 segundos.
          </p>
        )}
        {analyze.isError && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--danger)' }}>
            No se pudo completar el análisis. Posibles causas: la IA tardó más de lo esperado, no hay suficientes evaluaciones completadas (mínimo 3), o se agotó la cuota mensual de IA. Intente nuevamente en unos minutos.
          </p>
        )}
      </div>
    );
  }

  const handleExportBias = () => {
    if (!data) return;
    const lines: string[] = [
      '══════════════════════════════════════════════════════',
      '  INFORME DE DETECCIÓN DE SESGOS — EvaPro',
      '══════════════════════════════════════════════════════',
      '',
      `Fecha: ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      `Confianza: ${data.confidenceLevel != null ? `${Math.round(data.confidenceLevel * 100)}%` : 'N/A'}`,
      '',
      '── EVALUACIÓN GENERAL ──',
      data.overallAssessment || '',
      '',
    ];
    if (data.dataQuality) {
      lines.push('── CALIDAD DE DATOS ──', data.dataQuality, '');
    }
    if (data.biasesDetected?.length > 0) {
      lines.push(`── SESGOS DETECTADOS (${data.biasesDetected.length}) ──`, '');
      data.biasesDetected.forEach((b: any, i: number) => {
        lines.push(`${i + 1}. ${biasTypeLabel[b.type] || b.type} — Severidad: ${b.severity === 'high' ? 'Alta' : b.severity === 'medium' ? 'Media' : 'Baja'}`);
        lines.push(`   Evaluador: ${b.evaluatorName}`);
        lines.push(`   Evidencia: ${b.evidence}`);
        if (b.affectedEvaluatees) lines.push(`   Evaluados afectados: ${b.affectedEvaluatees.join(', ')}`);
        if (b.recommendation) lines.push(`   → Recomendación: ${b.recommendation}`);
        lines.push('');
      });
    } else {
      lines.push('── No se detectaron sesgos significativos ──', '');
    }
    lines.push('──────────────────────────────────────────────────', 'Generado por IA (Claude) • Los resultados son orientativos');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `informe-sesgos-${cycleId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Export button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={handleExportBias}>
          {'📄'} Descargar informe de sesgos
        </button>
      </div>

      {/* Overall Assessment */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Evaluación General</h3>
          {data.confidenceLevel != null && (
            <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
              Confianza: {Math.round(data.confidenceLevel * 100)}%
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.overallAssessment}</p>
        {data.dataQuality && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{data.dataQuality}</p>
        )}
      </div>

      {/* Biases */}
      {data.biasesDetected && data.biasesDetected.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Sesgos Detectados ({data.biasesDetected.length})</h3>
          {data.biasesDetected.map((b: any, i: number) => (
            <div key={i} className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{biasTypeLabel[b.type] || b.type}</span>
                <span className={`badge ${severityBadge[b.severity] || 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                  {b.severity === 'high' ? 'Alta' : b.severity === 'medium' ? 'Media' : 'Baja'}
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                <strong>Evaluador:</strong> {b.evaluatorName}
              </p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                <strong>Evidencia:</strong> {b.evidence}
              </p>
              {b.affectedEvaluatees && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Evaluados afectados: {b.affectedEvaluatees.join(', ')}
                </p>
              )}
              {b.recommendation && (
                <p style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: '0.3rem', fontWeight: 600 }}>
                  → {b.recommendation}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--success)', fontSize: '1.2rem', marginBottom: '0.25rem' }}>✅</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No se detectaron sesgos significativos en este ciclo</p>
        </div>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        Generado por IA (Claude) • Solo visible para administradores
      </p>
    </div>
  );
}

export default function CycleComparisonPage() {
  return (
    <PlanGate feature="ANALYTICS_REPORTS">
      <CycleComparisonPageContent />
    </PlanGate>
  );
}
