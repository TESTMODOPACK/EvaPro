'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCycles } from '@/hooks/useCycles';
import { useCycleSummary } from '@/hooks/useReports';
import { useFlightRisk, useRetentionRecommendations } from '@/hooks/useAiInsights';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { getScoreLabel, getScoreColor } from '@/lib/scales';
import { useToastStore } from '@/store/toast.store';
import PerformanceHeatmap from '@/components/PerformanceHeatmap';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#fb7185'];
const RISK_COLORS: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

type TabKey = 'performance' | 'climate' | 'headcount' | 'objectives' | 'development' | 'risks';
const TABS: { id: TabKey; label: string; icon: string }[] = [
  { id: 'performance', label: 'Desempeño', icon: '📊' },
  { id: 'climate', label: 'Clima Laboral', icon: '🌡️' },
  { id: 'headcount', label: 'Dotación', icon: '👥' },
  { id: 'objectives', label: 'Objetivos', icon: '🎯' },
  { id: 'development', label: 'Desarrollo', icon: '📈' },
  { id: 'risks', label: 'Riesgos', icon: '⚠️' },
];

const departureTypeLabels: Record<string, string> = {
  resignation: 'Renuncia', termination: 'Despido', retirement: 'Jubilación',
  contract_end: 'Fin de contrato', abandonment: 'Abandono', mutual_agreement: 'Mutuo acuerdo',
};
const reasonLabels: Record<string, string> = {
  better_offer: 'Mejor oferta', work_climate: 'Clima laboral', performance: 'Rendimiento',
  restructuring: 'Reestructuración', personal: 'Personal', relocation: 'Reubicación',
  health: 'Salud', studies: 'Estudios', other: 'Otro',
};

// ─── Helper Components ───────────────────────────────────────────────

function KPI({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function AnalysisCard({ title, borderColor, children }: { title: string; borderColor: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${borderColor}`, marginTop: '1rem' }}>
      <h4 style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.5rem', color: borderColor }}>{title}</h4>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{msg}</div>;
}

function Spinner() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><span className="spinner" /></div>;
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ReportesPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const toast = useToastStore((s) => s.toast);

  // Pre-selectors
  const { data: cycles } = useCycles();
  const closedCycles = (cycles || []).filter((c: any) => c.status === 'closed');
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [closedSurveys, setClosedSurveys] = useState<any[]>([]);
  const [orgPlans, setOrgPlans] = useState<any[]>([]);

  // Tab
  const [activeTab, setActiveTab] = useState<TabKey>('performance');
  const [showGuide, setShowGuide] = useState(false);

  // Shared data (loaded on cycle change)
  const { data: summary } = useCycleSummary(selectedCycleId);
  const [execData, setExecData] = useState<any>(null);

  // Tab-specific data (lazy loaded)
  const [cycleCompData, setCycleCompData] = useState<any>(null);
  const [enpsData, setEnpsData] = useState<any>(null);
  const [turnoverData, setTurnoverData] = useState<any>(null);
  const [movData, setMovData] = useState<any>(null);
  const [pdiData, setPdiData] = useState<any>(null);
  const [pdiHistData, setPdiHistData] = useState<any>(null);
  const [compareEnps, setCompareEnps] = useState<any>(null);
  const [compareSurveyId, setCompareSurveyId] = useState<string | null>(null);
  const [compareCycleId, setCompareCycleId] = useState<string | null>(null);
  const [compareSummary, setCompareSummary] = useState<any>(null);

  // Flight risk (uses react-query hook)
  const { data: flightRisk } = useFlightRisk();
  const { data: retentionRecs } = useRetentionRecommendations();

  // Tab loading flags
  const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set());

  // Auto-select latest cycle
  useEffect(() => {
    if (closedCycles.length > 0 && !selectedCycleId) {
      setSelectedCycleId(closedCycles[0].id);
    }
  }, [closedCycles]);

  // Load surveys + org plans on mount
  useEffect(() => {
    if (!token) return;
    api.reports.closedSurveys(token).then((s) => {
      setClosedSurveys(s);
      if (s.length > 0 && !selectedSurveyId) setSelectedSurveyId(s[0].id);
    }).catch(() => {});
    api.orgDevelopment?.plans?.list?.(token)?.then(setOrgPlans).catch(() => {});
  }, [token]);

  // Load shared data on cycle change
  useEffect(() => {
    if (!token || !selectedCycleId) return;
    api.reports.executiveDashboard(token, selectedCycleId).then(setExecData).catch(() => {});
    // Reset tab-specific data
    setLoadedTabs(new Set());
    setCycleCompData(null); setTurnoverData(null); setMovData(null);
    setPdiData(null); setPdiHistData(null);
  }, [token, selectedCycleId]);

  // Lazy load tab data
  useEffect(() => {
    if (!token || loadedTabs.has(activeTab)) return;
    const mark = () => setLoadedTabs(prev => new Set(prev).add(activeTab));

    if (activeTab === 'performance' && !cycleCompData) {
      api.reports.cycleComparison(token).then(setCycleCompData).catch(() => {});
      mark();
    }
    if (activeTab === 'climate' && selectedSurveyId && !enpsData) {
      api.reports.enpsBySurvey(token, selectedSurveyId).then(setEnpsData).catch(() => {});
      mark();
    }
    if (activeTab === 'headcount' && !turnoverData) {
      api.reports.turnover(token).then(setTurnoverData).catch(() => {});
      api.reports.movements(token).then(setMovData).catch(() => {});
      mark();
    }
    if (activeTab === 'development' && !pdiData) {
      api.reports.pdiCompliance(token).then(setPdiData).catch(() => {});
      api.reports.pdiHistorical(token).then(setPdiHistData).catch(() => {});
      mark();
    }
    if (activeTab === 'risks') mark();
  }, [activeTab, token, selectedSurveyId]);

  // Load eNPS when survey changes
  useEffect(() => {
    if (!token || !selectedSurveyId) return;
    api.reports.enpsBySurvey(token, selectedSurveyId).then(setEnpsData).catch(() => {});
  }, [selectedSurveyId]);

  // Compare cycle
  useEffect(() => {
    if (!token || !compareCycleId) return;
    api.reports.cycleSummary(token, compareCycleId).then(setCompareSummary).catch(() => {});
  }, [compareCycleId]);

  // Compare survey
  useEffect(() => {
    if (!token || !compareSurveyId) return;
    api.reports.enpsBySurvey(token, compareSurveyId).then(setCompareEnps).catch(() => {});
  }, [compareSurveyId]);

  // Export handler
  const handleExport = async (format: 'pdf' | 'xlsx' | 'pptx') => {
    if (!token || !selectedCycleId) return;
    try {
      const res = await fetch(`${BASE_URL}/reports/cycle/${selectedCycleId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `resumen-ejecutivo.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast('Error al exportar', 'error'); }
  };

  // Derived data
  const depts = (summary?.departmentBreakdown || []).map((d: any) => ({ ...d, avgScore: Number(d.avgScore) || 0 })).sort((a: any, b: any) => b.avgScore - a.avgScore);
  const topDepts = depts.slice(0, 3);
  const bottomDepts = [...depts].sort((a: any, b: any) => a.avgScore - b.avgScore).slice(0, 3);
  const objectives = execData?.objectives;
  const headcount = execData?.headcount;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Dashboard Ejecutivo</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Vista integral del desempeño, clima, dotación, objetivos, desarrollo y riesgos de la organización.
        </p>
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.75rem' }}>Guía del Dashboard Ejecutivo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <div>
              <p><strong>Desempeño:</strong> Resultados del ciclo de evaluación seleccionado — promedio, ranking, semáforo, mapa de calor y comparativa histórica.</p>
              <p><strong>Clima Laboral:</strong> eNPS de la encuesta seleccionada, distribución, tendencia y comparativa entre encuestas.</p>
              <p><strong>Dotación:</strong> Headcount, rotación, tipos de salida, movimientos internos y análisis de tendencia (últimos 12 meses).</p>
            </div>
            <div>
              <p><strong>Objetivos:</strong> Cumplimiento de OKRs, distribución por estado y objetivos en riesgo.</p>
              <p><strong>Desarrollo:</strong> Cumplimiento de planes de desarrollo (PDI), acciones completadas/vencidas, tendencia por año.</p>
              <p><strong>Riesgos:</strong> Riesgo de fuga algorítmico, recomendaciones de retención y alertas activas.</p>
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores ven toda la organización. Encargados de equipo ven solo su equipo.
          </div>
        </div>
      )}

      {/* Pre-selectors */}
      <div className="card animate-fade-up" style={{ padding: '0.85rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
          <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Ciclo de evaluación *</label>
          <select className="input" value={selectedCycleId || ''} onChange={(e) => setSelectedCycleId(e.target.value || null)} style={{ fontSize: '0.82rem' }}>
            <option value="">— Seleccionar ciclo —</option>
            {closedCycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
          <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Encuesta de clima</label>
          <select className="input" value={selectedSurveyId || ''} onChange={(e) => setSelectedSurveyId(e.target.value || null)} style={{ fontSize: '0.82rem' }}>
            {closedSurveys.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
            {closedSurveys.length === 0 && <option value="">Sin encuestas cerradas</option>}
          </select>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
          <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Plan organizacional</label>
          <select className="input" style={{ fontSize: '0.82rem' }}>
            <option value="">Todos los planes</option>
            {orgPlans.map((p: any) => <option key={p.id} value={p.id}>{p.title} ({p.year})</option>)}
          </select>
        </div>
        {selectedCycleId && (
          <div style={{ display: 'flex', gap: '0.35rem', marginLeft: 'auto' }}>
            {(['pdf', 'xlsx', 'pptx'] as const).map(fmt => (
              <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', textTransform: 'uppercase' }}>{fmt}</button>
            ))}
          </div>
        )}
      </div>

      {!selectedCycleId && (
        <EmptyState msg="Seleccione un ciclo de evaluación para ver el dashboard ejecutivo." />
      )}

      {selectedCycleId && (
        <>
          {/* Tab bar */}
          <div className="animate-fade-up" style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.55rem 0.85rem', fontSize: '0.8rem', whiteSpace: 'nowrap',
                fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                marginBottom: '-1px',
              }}>
                <span style={{ fontSize: '0.9rem' }}>{tab.icon}</span> {tab.label}
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 1: DESEMPEÑO                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'performance' && (
            <div className="animate-fade-up">
              {!summary ? <Spinner /> : (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <KPI label="Promedio Global" value={Number(Number(summary.averageScore))?.toFixed(1) || '--'} color={getScoreColor(Number(Number(summary.averageScore)))} sub={getScoreLabel(Number(Number(summary.averageScore)))} />
                    <KPI label="Completitud" value={`${Number(summary.completionRate) || 0}%`} color={Number(summary.completionRate) >= 80 ? 'var(--success)' : 'var(--warning)'} />
                    <KPI label="Evaluaciones" value={`${summary.completedAssignments || 0}/${summary.totalAssignments || 0}`} />
                    <KPI label="Departamentos" value={depts.length} />
                  </div>

                  {/* Department Ranking BarChart */}
                  {depts.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Ranking por Departamento</h4>
                      <div style={{ height: Math.max(200, depts.length * 35) }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={depts} layout="vertical" margin={{ left: 100 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="department" tick={{ fontSize: 11 }} width={95} />
                            <Tooltip />
                            <Bar dataKey="avgScore" name="Promedio" radius={[0, 4, 4, 0]}>
                              {depts.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Top / Bottom 3 */}
                  {depts.length >= 3 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                      <div className="card" style={{ padding: '1rem' }}>
                        <h4 style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--success)' }}>▲ Top 3 Departamentos</h4>
                        {topDepts.map((d: any, i: number) => (
                          <div key={d.department} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                            <span style={{ fontWeight: 600 }}>{i + 1}. {d.department}</span>
                            <span style={{ fontWeight: 700, color: getScoreColor(d.avgScore) }}>{Number(d.avgScore).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="card" style={{ padding: '1rem' }}>
                        <h4 style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--danger)' }}>▼ Bottom 3 Departamentos</h4>
                        {bottomDepts.map((d: any, i: number) => (
                          <div key={d.department} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                            <span style={{ fontWeight: 600 }}>{i + 1}. {d.department}</span>
                            <span style={{ fontWeight: 700, color: getScoreColor(d.avgScore) }}>{Number(d.avgScore).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Semáforo de áreas */}
                  {depts.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Semáforo de Áreas</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
                        {depts.map((d: any) => {
                          const score = Number(d.avgScore);
                          const color = score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)';
                          return (
                            <div key={d.department} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                              <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                              <span style={{ fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.department}</span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color }}>{score.toFixed(1)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Heatmap */}
                  <PerformanceHeatmap cycleId={selectedCycleId} />

                  {/* Quick Analysis */}
                  {Number(summary.averageScore) != null && (
                    <AnalysisCard title="Análisis del Ciclo" borderColor={getScoreColor(Number(summary.averageScore))}>
                      <p><strong>Desempeño:</strong> El promedio global es <strong>{Number(summary.averageScore)?.toFixed(1)}</strong> ({getScoreLabel(Number(summary.averageScore))}). {Number(summary.averageScore) >= 7 ? 'La organización muestra un desempeño sólido.' : Number(summary.averageScore) >= 5 ? 'Desempeño aceptable con espacio de mejora.' : 'Se requiere atención urgente al desempeño general.'}</p>
                      <p><strong>Participación:</strong> {Number(summary.completionRate)}% de completitud ({summary.completedAssignments}/{summary.totalAssignments} evaluaciones). {Number(summary.completionRate) >= 90 ? 'Excelente participación.' : Number(summary.completionRate) >= 70 ? 'Buena participación.' : 'Baja participación — reforzar comunicación.'}</p>
                      {depts.length >= 2 && (
                        <p><strong>Brecha departamental:</strong> La diferencia entre {topDepts[0]?.department} ({Number(topDepts[0]?.avgScore).toFixed(1)}) y {bottomDepts[0]?.department} ({Number(bottomDepts[0]?.avgScore).toFixed(1)}) es de {(Number(topDepts[0]?.avgScore) - Number(bottomDepts[0]?.avgScore)).toFixed(1)} puntos. {Number(topDepts[0]?.avgScore) - Number(bottomDepts[0]?.avgScore) > 2 ? 'Brecha significativa — investigar causas.' : 'Brecha moderada.'}</p>
                      )}
                    </AnalysisCard>
                  )}

                  {/* Cycle Comparison */}
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Comparativa de Ciclos</h4>
                    <select className="input" value={compareCycleId || ''} onChange={(e) => { setCompareCycleId(e.target.value || null); setCompareSummary(null); }} style={{ fontSize: '0.82rem', maxWidth: '300px', marginBottom: '0.75rem' }}>
                      <option value="">Seleccionar ciclo para comparar...</option>
                      {closedCycles.filter((c: any) => c.id !== selectedCycleId).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {compareSummary && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                          { label: 'Promedio', current: Number(summary.averageScore), compare: compareSummary.averageScore, fmt: (v: number) => v?.toFixed(1) },
                          { label: 'Completitud', current: Number(summary.completionRate), compare: compareSummary.completionRate, fmt: (v: number) => `${v}%` },
                        ].map(({ label, current, compare, fmt }) => {
                          const delta = Number(current) - Number(compare);
                          const positive = delta >= 0;
                          return (
                            <div key={label} className="card" style={{ padding: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{fmt(current)}</div>
                              </div>
                              <div style={{ textAlign: 'right', color: positive ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                                <span style={{ fontSize: '1rem' }}>{positive ? '▲' : '▼'}</span> {Math.abs(delta).toFixed(1)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Historical trend from cycle comparison */}
                    {cycleCompData?.cycles?.length >= 2 && (
                      <div style={{ marginTop: '1rem', height: 200 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Tendencia histórica de ciclos</div>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={cycleCompData.cycles.map((c: any) => ({ name: c.cycleName?.slice(0, 20), avg: c.avgScore }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="avg" name="Promedio" stroke="#C9933A" strokeWidth={2} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 2: CLIMA LABORAL                                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'climate' && (
            <div className="animate-fade-up">
              {!enpsData ? <EmptyState msg="Seleccione una encuesta de clima para ver los resultados." /> : (
                <>
                  {/* eNPS KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <KPI label="eNPS Score" value={enpsData.score ?? '--'} color={enpsData.score >= 30 ? 'var(--success)' : enpsData.score >= 0 ? 'var(--warning)' : 'var(--danger)'} />
                    <KPI label="Promotores" value={enpsData.promoters || 0} color="var(--success)" />
                    <KPI label="Detractores" value={enpsData.detractors || 0} color="var(--danger)" />
                    <KPI label="Total Respuestas" value={enpsData.total || 0} />
                  </div>

                  {/* eNPS Donut */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Distribución eNPS</h4>
                      <div style={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={[
                              { name: 'Promotores', value: enpsData.promoters || 0 },
                              { name: 'Pasivos', value: (enpsData.total || 0) - (enpsData.promoters || 0) - (enpsData.detractors || 0) },
                              { name: 'Detractores', value: enpsData.detractors || 0 },
                            ]} innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                              <Cell fill="#10b981" /><Cell fill="#94a3b8" /><Cell fill="#ef4444" />
                            </Pie>
                            <Legend />
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Headcount by dept */}
                    {headcount?.byDepartment?.length > 0 && (
                      <div className="card" style={{ padding: '1.25rem' }}>
                        <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Dotación por Departamento</h4>
                        <div style={{ height: 220 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={headcount.byDepartment.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                              <XAxis type="number" tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="department" tick={{ fontSize: 10 }} width={75} />
                              <Tooltip />
                              <Bar dataKey="count" name="Personas" fill="#C9933A" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* eNPS Interpretation */}
                  <AnalysisCard title="Interpretación eNPS" borderColor={enpsData.score >= 30 ? 'var(--success)' : enpsData.score >= 0 ? 'var(--warning)' : 'var(--danger)'}>
                    <p>
                      {enpsData.score >= 50 ? 'Excelente — alto nivel de compromiso y satisfacción.' :
                       enpsData.score >= 30 ? 'Muy bueno — mayoría son promotores de la organización.' :
                       enpsData.score >= 0 ? 'Aceptable — hay espacio para mejorar. Investigar causas de insatisfacción.' :
                       'Bajo — requiere intervención urgente. Revisar clima y condiciones laborales.'}
                    </p>
                    <p>De {enpsData.total} respuestas: {enpsData.promoters} promotores, {(enpsData.total || 0) - (enpsData.promoters || 0) - (enpsData.detractors || 0)} pasivos y {enpsData.detractors} detractores.</p>
                  </AnalysisCard>

                  {/* Org Development */}
                  {execData?.orgDevelopment && (execData.orgDevelopment.totalPlans > 0 || execData.orgDevelopment.totalInitiatives > 0) && (
                    <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Desarrollo Organizacional</h4>
                      <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem' }}>
                        <div><span style={{ fontWeight: 700, color: 'var(--accent)' }}>{execData.orgDevelopment.activePlans}</span> planes activos de {execData.orgDevelopment.totalPlans}</div>
                        <div><span style={{ fontWeight: 700, color: 'var(--success)' }}>{execData.orgDevelopment.completedInitiatives}</span> iniciativas completadas de {execData.orgDevelopment.totalInitiatives}</div>
                      </div>
                    </div>
                  )}

                  {/* Survey Comparison */}
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Comparativa de Encuestas</h4>
                    <select className="input" value={compareSurveyId || ''} onChange={(e) => { setCompareSurveyId(e.target.value || null); setCompareEnps(null); }} style={{ fontSize: '0.82rem', maxWidth: '300px', marginBottom: '0.75rem' }}>
                      <option value="">Seleccionar encuesta para comparar...</option>
                      {closedSurveys.filter((s: any) => s.id !== selectedSurveyId).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                    {compareEnps && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                        {[
                          { label: 'eNPS', current: enpsData.score, compare: compareEnps.score, positive: true },
                          { label: 'Promotores', current: enpsData.promoters, compare: compareEnps.promoters, positive: true },
                          { label: 'Detractores', current: enpsData.detractors, compare: compareEnps.detractors, positive: false },
                        ].map(({ label, current, compare, positive: moreIsBetter }) => {
                          const delta = Number(current) - Number(compare);
                          const isPositive = moreIsBetter ? delta >= 0 : delta <= 0;
                          return (
                            <div key={label} className="card" style={{ padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700 }}>{current}</div>
                              </div>
                              <span style={{ color: isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 700, fontSize: '0.9rem' }}>
                                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 3: DOTACIÓN Y ROTACIÓN                                    */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'headcount' && (
            <div className="animate-fade-up">
              {/* Headcount KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <KPI label="Activos" value={headcount?.active || 0} color="var(--success)" />
                <KPI label="Total" value={headcount?.total || 0} />
                {isAdmin && turnoverData && <KPI label="Tasa Rotación" value={`${turnoverData.turnoverRate || 0}%`} color={turnoverData.turnoverRate > 15 ? 'var(--danger)' : turnoverData.turnoverRate > 8 ? 'var(--warning)' : 'var(--success)'} />}
                {isAdmin && turnoverData && <KPI label="Bajas 12m" value={turnoverData.totalDeactivations12m || 0} color="var(--danger)" />}
              </div>

              {/* Turnover by month (admin only) */}
              {isAdmin && turnoverData?.byMonth?.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Tendencia de Salidas (12 meses)</h4>
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={turnoverData.byMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="count" name="Bajas" stroke="#ef4444" fill="rgba(239,68,68,0.15)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Turnover by type + voluntary/involuntary (admin only) */}
              {isAdmin && turnoverData && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  {turnoverData.byType?.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Por Tipo de Salida</h4>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={turnoverData.byType.map((t: any) => ({ name: departureTypeLabels[t.type] || t.type, value: t.count }))} innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value">
                              {turnoverData.byType.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  <div className="card" style={{ padding: '1.25rem' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Voluntario vs Involuntario</h4>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={[
                            { name: 'Voluntarias', value: turnoverData.voluntary || 0 },
                            { name: 'Involuntarias', value: turnoverData.involuntary || 0 },
                          ]} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                            <Cell fill="#f59e0b" /><Cell fill="#ef4444" />
                          </Pie>
                          <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* Movements */}
              {movData && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Movimientos Internos (12 meses)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <KPI label="Total" value={movData.totalMovements || 0} />
                    <KPI label="Promociones" value={movData.promotions || 0} color="var(--success)" />
                    <KPI label="Transferencias" value={movData.lateralTransfers || 0} color="var(--accent)" />
                    <KPI label="Cambios cargo" value={movData.positionChanges || 0} />
                  </div>
                </div>
              )}

              {/* Turnover Analysis */}
              {isAdmin && turnoverData && (
                <AnalysisCard title="Análisis de Dotación" borderColor={turnoverData.turnoverRate > 15 ? 'var(--danger)' : turnoverData.turnoverRate > 8 ? 'var(--warning)' : 'var(--success)'}>
                  <p><strong>Rotación:</strong> Tasa del {turnoverData.turnoverRate}% en los últimos 12 meses. {turnoverData.turnoverRate > 15 ? 'Alta — requiere atención urgente.' : turnoverData.turnoverRate > 8 ? 'Moderada — monitorear tendencias.' : 'Saludable.'}</p>
                  <p><strong>Salidas:</strong> {turnoverData.voluntary || 0} voluntarias y {turnoverData.involuntary || 0} involuntarias de {turnoverData.totalDeactivations12m || 0} total.</p>
                  {movData && <p><strong>Movimientos:</strong> {movData.promotions || 0} promociones y {movData.lateralTransfers || 0} transferencias laterales en el período.</p>}
                </AnalysisCard>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 4: OBJETIVOS Y OKRs                                       */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'objectives' && (
            <div className="animate-fade-up">
              {!objectives ? <Spinner /> : (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <KPI label="Cumplimiento" value={`${objectives.completionPct || 0}%`} color={objectives.completionPct >= 70 ? 'var(--success)' : objectives.completionPct >= 40 ? 'var(--warning)' : 'var(--danger)'} />
                    <KPI label="Completados" value={objectives.completed || 0} color="var(--success)" />
                    <KPI label="En Progreso" value={objectives.inProgress || 0} color="var(--accent)" />
                    <KPI label="Total" value={objectives.total || 0} />
                  </div>

                  {/* Status distribution PieChart */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Distribución por Estado</h4>
                      <div style={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={[
                              { name: 'Completados', value: objectives.completed || 0 },
                              { name: 'En progreso', value: objectives.inProgress || 0 },
                              { name: 'Borrador', value: objectives.draft || 0 },
                              { name: 'Pendientes', value: objectives.pendingApproval || 0 },
                              { name: 'Abandonados', value: objectives.abandoned || 0 },
                            ].filter(d => d.value > 0)} innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value">
                              <Cell fill="#10b981" /><Cell fill="#6366f1" /><Cell fill="#94a3b8" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" />
                            </Pie>
                            <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Compliance bar */}
                    <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Cumplimiento Global OKRs</h4>
                      <div style={{ fontSize: '2.5rem', fontWeight: 800, color: objectives.completionPct >= 70 ? 'var(--success)' : objectives.completionPct >= 40 ? 'var(--warning)' : 'var(--danger)', textAlign: 'center' }}>
                        {objectives.completionPct || 0}%
                      </div>
                      <div style={{ height: 12, background: 'var(--bg-secondary)', borderRadius: 6, overflow: 'hidden', marginTop: '0.75rem' }}>
                        <div style={{ height: '100%', width: `${objectives.completionPct || 0}%`, background: objectives.completionPct >= 70 ? 'var(--success)' : objectives.completionPct >= 40 ? 'var(--warning)' : 'var(--danger)', borderRadius: 6, transition: 'width 0.5s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        <span>{objectives.completed}/{objectives.total} completados</span>
                        <span>{objectives.abandoned || 0} abandonados</span>
                      </div>
                    </div>
                  </div>

                  {/* Analysis */}
                  <AnalysisCard title="Análisis de Objetivos" borderColor={objectives.completionPct >= 70 ? 'var(--success)' : objectives.completionPct >= 40 ? 'var(--warning)' : 'var(--danger)'}>
                    <p><strong>Cumplimiento:</strong> {objectives.completionPct}% de los objetivos están completados. {objectives.completionPct >= 70 ? 'Buen avance en las metas organizacionales.' : objectives.completionPct >= 40 ? 'Avance moderado — revisar priorización.' : 'Bajo cumplimiento — requiere atención urgente.'}</p>
                    <p><strong>Estado:</strong> {objectives.inProgress || 0} en progreso, {objectives.draft || 0} en borrador, {objectives.pendingApproval || 0} pendientes de aprobación.</p>
                    {(objectives.abandoned || 0) > 0 && <p><strong>Alerta:</strong> {objectives.abandoned} objetivos fueron abandonados — revisar si las metas siguen siendo relevantes.</p>}
                  </AnalysisCard>
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 5: DESARROLLO (PDI)                                       */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'development' && (
            <div className="animate-fade-up">
              {!pdiData ? <Spinner /> : (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <KPI label="Total Planes" value={pdiData.totalPlans || 0} />
                    <KPI label="Tasa Completitud" value={`${pdiData.completionRate || 0}%`} color={pdiData.completionRate >= 70 ? 'var(--success)' : 'var(--warning)'} />
                    <KPI label="Acciones Completadas" value={`${pdiData.completedActions || 0}/${pdiData.totalActions || 0}`} color="var(--success)" />
                    <KPI label="Acciones Vencidas" value={pdiData.overdueActions || 0} color={pdiData.overdueActions > 0 ? 'var(--danger)' : 'var(--success)'} />
                  </div>

                  {/* PDI by department table */}
                  {pdiData.byDepartment?.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>PDI por Departamento</h4>
                      <div className="table-wrapper">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left' }}>Departamento</th>
                              <th style={{ textAlign: 'right' }}>Planes</th>
                              <th style={{ textAlign: 'right' }}>Completados</th>
                              <th style={{ textAlign: 'right' }}>Progreso Prom.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pdiData.byDepartment.map((d: any) => (
                              <tr key={d.department}>
                                <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{d.department}</td>
                                <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>{d.total}</td>
                                <td style={{ textAlign: 'right', fontSize: '0.82rem', color: 'var(--success)' }}>{d.completed}</td>
                                <td style={{ textAlign: 'right' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                    <div style={{ width: 60, height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                                      <div style={{ height: '100%', width: `${d.avgProgress || 0}%`, background: d.avgProgress >= 70 ? 'var(--success)' : 'var(--warning)', borderRadius: 3 }} />
                                    </div>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{d.avgProgress || 0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Historical trend */}
                  {pdiHistData?.byYear?.length >= 2 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Tendencia Histórica PDI</h4>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={pdiHistData.byYear}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            <Bar dataKey="total" name="Total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="completed" name="Completados" fill="#10b981" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Analysis */}
                  <AnalysisCard title="Análisis de Desarrollo" borderColor={pdiData.completionRate >= 70 ? 'var(--success)' : 'var(--warning)'}>
                    <p><strong>Cumplimiento PDI:</strong> {pdiData.completionRate}% de los planes completados. {pdiData.completionRate >= 70 ? 'Buen avance en desarrollo de talento.' : 'Hay espacio para mejorar el seguimiento de los planes.'}</p>
                    <p><strong>Acciones:</strong> {pdiData.completedActions || 0} de {pdiData.totalActions || 0} completadas ({pdiData.actionCompletionRate || 0}%). {pdiData.overdueActions > 0 ? `⚠️ ${pdiData.overdueActions} acciones vencidas requieren atención.` : '✅ Sin acciones vencidas.'}</p>
                  </AnalysisCard>
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 6: RIESGOS Y ALERTAS                                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'risks' && (
            <div className="animate-fade-up">
              {!flightRisk ? (
                <EmptyState msg="Análisis de riesgo no disponible. Verifique su cuota de IA o espere a que se procesen los datos." />
              ) : (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <KPI label="Riesgo Alto" value={flightRisk.summary?.high || 0} color="var(--danger)" />
                    <KPI label="Riesgo Medio" value={flightRisk.summary?.medium || 0} color="var(--warning)" />
                    <KPI label="Riesgo Bajo" value={flightRisk.summary?.low || 0} color="var(--success)" />
                    {retentionRecs && <KPI label="Acciones Retención" value={retentionRecs.recommendations?.length || 0} />}
                  </div>

                  {/* Risk distribution */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Distribución de Riesgo</h4>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={[
                              { name: 'Alto', value: flightRisk.summary?.high || 0 },
                              { name: 'Medio', value: flightRisk.summary?.medium || 0 },
                              { name: 'Bajo', value: flightRisk.summary?.low || 0 },
                            ]} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                              <Cell fill="#ef4444" /><Cell fill="#f59e0b" /><Cell fill="#10b981" />
                            </Pie>
                            <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* High risk employees table */}
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Empleados en Riesgo Alto</h4>
                      {(flightRisk.scores || []).filter((s: any) => s.riskLevel === 'high').length === 0 ? (
                        <p style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>✅ Sin empleados en riesgo alto</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: 180, overflowY: 'auto' }}>
                          {(flightRisk.scores || []).filter((s: any) => s.riskLevel === 'high' || s.riskLevel === 'medium').slice(0, 10).map((s: any) => (
                            <div key={s.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.78rem' }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{s.name}</span>
                                <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>· {s.department}</span>
                              </div>
                              <span style={{ fontWeight: 700, color: RISK_COLORS[s.riskLevel] || '#94a3b8', fontSize: '0.75rem' }}>{s.riskScore}/100</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Retention recommendations */}
                  {retentionRecs?.recommendations?.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Recomendaciones de Retención</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {retentionRecs.recommendations.slice(0, 8).map((r: any) => (
                          <div key={r.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                            <div>
                              <span style={{ fontWeight: 600 }}>{r.name}</span>
                              <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>· {r.department}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              {(r.actions || []).slice(0, 3).map((a: any, i: number) => (
                                <span key={i} className={`badge ${a.priority === 'alta' ? 'badge-danger' : a.priority === 'media' ? 'badge-accent' : 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>{a.type}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Analysis */}
                  <AnalysisCard title="Análisis de Riesgos" borderColor={(flightRisk.summary?.high || 0) > 0 ? 'var(--danger)' : 'var(--success)'}>
                    <p><strong>Riesgo de Fuga:</strong> {flightRisk.summary?.high || 0} empleados en riesgo alto, {flightRisk.summary?.medium || 0} en riesgo medio de {flightRisk.totalEmployees || 0} evaluados.</p>
                    {(flightRisk.summary?.high || 0) > 0 && <p>⚠️ Se recomienda intervención inmediata para los empleados en riesgo alto: revisión salarial, plan de desarrollo, conversaciones de retención.</p>}
                    {retentionRecs && <p><strong>Retención:</strong> {retentionRecs.recommendations?.length || 0} acciones recomendadas para {retentionRecs.totalHighRisk || 0} empleados de alto riesgo y {retentionRecs.totalMediumRisk || 0} de riesgo medio.</p>}
                  </AnalysisCard>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
