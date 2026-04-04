'use client';
import { PlanGate } from '@/components/PlanGate';
import { AiQuotaBar } from '@/components/AiQuotaBar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function CycleComparisonPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<any>(null);
  const [showGuide, setShowGuide] = useState(false);

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
            <button className="btn-ghost" onClick={() => handleExport('csv')} disabled={!!exporting}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
              {exporting === 'csv' ? t('common.exporting') : t('common.exportCsv')}
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
            <p><strong>Análisis IA:</strong> Genera un análisis profundo con resumen ejecutivo, tendencias, fortalezas, alertas, departamentos que mejoraron/empeoraron, y recomendaciones. Consume 1 crédito de su cuota mensual de IA.</p>
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
                <div>{c.cycleName}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {c.avgScore ? `Prom: ${c.avgScore}` : 'Sin puntajes'} · {c.withScores} eval.
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Quota Bar */}
      <AiQuotaBar />

      {/* AI Analysis Button */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          onClick={handleAnalyze}
          disabled={selected.size < 2 || analyzing}
          style={{ fontSize: '0.85rem', opacity: selected.size < 2 || analyzing ? 0.5 : 1 }}
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
