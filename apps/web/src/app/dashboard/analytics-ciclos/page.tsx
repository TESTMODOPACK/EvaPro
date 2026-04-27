'use client';
import { PlanGate } from '@/components/PlanGate';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';
// P8-C: import dinámico de Recharts.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from '@/components/DynamicCharts';
// useAiBias, useAnalyzeBias moved to analytics/page.tsx

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

// Bias constants moved to analytics/page.tsx

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
  // biasSelectedCycleId removed — bias analysis moved to analytics/page.tsx

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
      // F3 Fase 3: usar wrapper api.ts para que cookie + X-CSRF-Token
      // se incluyan correctamente. El fetch directo se rompia con 403
      // CSRF al desplegar Fase 3 (sin header X-CSRF-Token).
      const result = await api.ai.analyzeCycleComparison(token, Array.from(selected));
      setAiAnalysis(result);
      // Refresh quota (GET, no necesita CSRF — pero usar wrapper igual
      // para consistencia y para que mande la cookie automaticamente).
      api.ai.getUsage(token).then(setQuotaInfo).catch(() => {});
    } catch (e: any) {
      setAnalyzeError(e.message || t('analyticsCiclos.errorGeneratingAnalysis'));
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
            <p><strong>{t('analyticsCiclos.guide.whatTitle')}</strong> {t('analyticsCiclos.guide.whatDesc')}</p>
            <p><strong>{t('analyticsCiclos.guide.howToTitle')}</strong> {t('analyticsCiclos.guide.howToDesc')}</p>
            <p><strong>{t('analyticsCiclos.guide.chartsTitle')}</strong> {t('analyticsCiclos.guide.chartsDesc')}</p>
            <p><strong>{t('analyticsCiclos.guide.aiTitle')}</strong> {t('analyticsCiclos.guide.aiDesc')}</p>
            <p><strong>{t('analyticsCiclos.guide.biasTitle')}</strong> {t('analyticsCiclos.guide.biasDesc')}</p>
            <p><strong>{t('analyticsCiclos.guide.exportTitle')}</strong> {t('analyticsCiclos.guide.exportDesc')}</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>{t('analyticsCiclos.guide.permissionsLabel')}</strong> {t('analyticsCiclos.guide.permissions')}
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
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{selected.size} {t('analyticsCiclos.ofTotal')} {cycles.length} {t('analyticsCiclos.selected')}</span>
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
                  {c.avgScore ? t('analyticsCiclos.avgPrefix', { score: c.avgScore }) : t('analyticsCiclos.evaluatedNoScores', { count: c.totalEvaluated })} {c.avgScore ? `· ${t('analyticsCiclos.evalSuffix', { count: c.withScores })}` : ''}
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
          const typeList = Array.from(types).map((tp: any) => `${tp}°`).join(', ');
          return (
            <div className="card animate-fade-up" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--warning)', background: 'rgba(245,158,11,0.06)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--warning)' }}>{t('analyticsCiclos.mixedTypesTitle')}</strong> {t('analyticsCiclos.mixedTypesMsg', { types: typeList })}
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
            {t('analyticsCiclos.trend')} {selectedCycles.length >= 2 ? t('analyticsCiclos.trendSelected') : t('analyticsCiclos.trendAll')}
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="promedio" fill="#C9933A" name={t('analyticsCiclos.chartAvg')} radius={[4, 4, 0, 0]} />
              <Bar dataKey="min" fill="#10b981" name={t('analyticsCiclos.chartMin')} radius={[4, 4, 0, 0]} />
              <Bar dataKey="max" fill="#6366f1" name={t('analyticsCiclos.chartMax')} radius={[4, 4, 0, 0]} />
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
                    {c.cycleType} — {c.startDate ? new Date(c.startDate).toLocaleDateString() : ''} {t('analyticsCiclos.dateTo')} {c.endDate ? new Date(c.endDate).toLocaleDateString() : ''}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{c.avgScore ?? '—'}</div>
                  {delta && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: Number(delta) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {Number(delta) >= 0 ? '▲' : '▼'} {Math.abs(Number(delta))} {t('analyticsCiclos.vsPrevious')}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>{t('analyticsCiclos.evaluated')} <strong>{c.totalEvaluated}</strong></span>
                <span>{t('analyticsCiclos.withScore')} <strong>{c.withScores}</strong></span>
                {c.minScore != null && <span>{t('analyticsCiclos.minLabel')} <strong>{c.minScore}</strong></span>}
                {c.maxScore != null && <span>{t('analyticsCiclos.maxLabel')} <strong>{c.maxScore}</strong></span>}
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
              {aiAnalysis.generatedAt ? new Date(aiAnalysis.generatedAt).toLocaleString() : ''} · {aiAnalysis.tokensUsed || 0} tokens
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
                <strong style={{ fontSize: '0.85rem' }}>{t('analyticsCiclos.recommendations')}</strong>
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
      {/* Nota: Detección de Sesgos se movió a Análisis de Ciclo individual */}
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
