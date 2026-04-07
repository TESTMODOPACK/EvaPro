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

const retentionActionLabels: Record<string, string> = {
  pdi: 'Plan de Desarrollo', coaching: 'Coaching', engagement: 'Compromiso',
  retention: 'Retención', conversation: 'Conversación',
};

const departureTypeLabels: Record<string, string> = {
  resignation: 'Renuncia', termination: 'Despido', retirement: 'Jubilación',
  contract_end: 'Fin de contrato', abandonment: 'Abandono', mutual_agreement: 'Mutuo acuerdo',
};
// reasonLabels removed — not used in executive dashboard summary view

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
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlanData, setSelectedPlanData] = useState<any>(null);
  const [planInitiatives, setPlanInitiatives] = useState<any[]>([]);

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

  // Team members (for manager filtering)
  const [teamUserIds, setTeamUserIds] = useState<Set<string>>(new Set());

  // Flight risk (uses react-query hook) — filtered for managers
  const { data: rawFlightRisk } = useFlightRisk();
  const { data: rawRetentionRecs } = useRetentionRecommendations();

  // Filter flight risk and retention for managers (only show their team)
  const flightRisk = !isAdmin && rawFlightRisk && teamUserIds.size > 0
    ? {
        ...rawFlightRisk,
        scores: (rawFlightRisk.scores || []).filter((s: any) => teamUserIds.has(s.userId)),
        totalEmployees: teamUserIds.size,
        summary: {
          high: (rawFlightRisk.scores || []).filter((s: any) => teamUserIds.has(s.userId) && s.riskLevel === 'high').length,
          medium: (rawFlightRisk.scores || []).filter((s: any) => teamUserIds.has(s.userId) && s.riskLevel === 'medium').length,
          low: (rawFlightRisk.scores || []).filter((s: any) => teamUserIds.has(s.userId) && s.riskLevel === 'low').length,
        },
      }
    : rawFlightRisk;
  const retentionRecs = !isAdmin && rawRetentionRecs && teamUserIds.size > 0
    ? {
        ...rawRetentionRecs,
        recommendations: (rawRetentionRecs.recommendations || []).filter((r: any) => teamUserIds.has(r.userId)),
        totalHighRisk: (rawRetentionRecs.recommendations || []).filter((r: any) => teamUserIds.has(r.userId) && r.riskLevel === 'high').length,
        totalMediumRisk: (rawRetentionRecs.recommendations || []).filter((r: any) => teamUserIds.has(r.userId) && r.riskLevel === 'medium').length,
      }
    : rawRetentionRecs;

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
    api.orgDevelopment?.plans?.list?.(token)?.then((plans) => {
      setOrgPlans(plans || []);
      // Auto-select the most recent active plan
      const active = (plans || []).find((p: any) => p.status === 'activo');
      if (active && !selectedPlanId) {
        setSelectedPlanId(active.id);
        setSelectedPlanData(active);
      }
    }).catch(() => {});
  }, [token]);

  // Load initiatives when plan selected
  useEffect(() => {
    if (!token || !selectedPlanId) { setPlanInitiatives([]); return; }
    const plan = orgPlans.find((p: any) => p.id === selectedPlanId);
    setSelectedPlanData(plan || null);
    api.orgDevelopment?.initiatives?.listByPlan?.(token, selectedPlanId)?.then(setPlanInitiatives).catch(() => setPlanInitiatives([]));
  }, [selectedPlanId, token]);

  // Load shared data on cycle change
  useEffect(() => {
    if (!token || !selectedCycleId) return;
    api.reports.executiveDashboard(token, selectedCycleId).then(setExecData).catch(() => {});
    // For managers: load team members (direct reports) to filter cross-tab data
    if (!isAdmin) {
      api.users.list(token, 1, 500).then((res: any) => {
        const users = Array.isArray(res) ? res : res?.data || [];
        const myId = useAuthStore.getState().user?.userId;
        const myTeam = users.filter((u: any) => u.managerId === myId);
        setTeamUserIds(new Set(myTeam.map((u: any) => u.id)));
      }).catch(() => {});
    }
    // Reset tab-specific data
    setLoadedTabs(new Set());
    setCycleCompData(null); setTurnoverData(null); setMovData(null);
    setPdiData(null); setPdiHistData(null); setCompareSummary(null); setCompareCycleId(null);
  }, [token, selectedCycleId]);

  // Lazy load tab data — mark as loaded AFTER API resolves (not before)
  useEffect(() => {
    if (!token || loadedTabs.has(activeTab)) return;
    const mark = () => setLoadedTabs(prev => new Set(prev).add(activeTab));

    if (activeTab === 'performance' && !cycleCompData) {
      api.reports.cycleComparison(token).then((d) => { setCycleCompData(d); mark(); }).catch(() => mark());
    }
    if (activeTab === 'climate' && selectedSurveyId && !enpsData) {
      api.reports.enpsBySurvey(token, selectedSurveyId).then((d) => { setEnpsData(d); mark(); }).catch(() => mark());
    }
    if (activeTab === 'headcount') {
      if (isAdmin && !turnoverData) {
        Promise.all([
          api.reports.turnover(token).then(setTurnoverData).catch(() => {}),
          api.reports.movements(token).then(setMovData).catch(() => {}),
        ]).then(() => mark());
      } else { mark(); }
    }
    if (activeTab === 'development' && !pdiData) {
      Promise.all([
        api.reports.pdiCompliance(token).then(setPdiData).catch(() => {}),
        api.reports.pdiHistorical(token).then(setPdiHistData).catch(() => {}),
      ]).then(() => mark());
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
  const handleExport = async (format: 'pdf') => {
    if (!token || !selectedCycleId) return;
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId, format });
      if (selectedSurveyId) params.set('surveyId', selectedSurveyId);
      const res = await fetch(`${BASE_URL}/reports/executive-dashboard/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al generar el reporte');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dashboard-ejecutivo.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { toast(e.message || 'Error al exportar', 'error'); }
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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Resumen Ejecutivo Organizacional</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Vista estratégica integral: desempeño, clima, dotación, objetivos, desarrollo y riesgos.
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
          <select className="input" value={selectedPlanId || ''} onChange={(e) => setSelectedPlanId(e.target.value || null)} style={{ fontSize: '0.82rem' }}>
            <option value="">— Sin selección —</option>
            {orgPlans.map((p: any) => <option key={p.id} value={p.id}>{p.title} ({p.year}) — {p.status}</option>)}
          </select>
        </div>
        {selectedCycleId && (
          <button className="btn-ghost" onClick={() => handleExport('pdf')} style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', marginLeft: 'auto' }}>
            Exportar PDF
          </button>
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
                    <KPI label="Promedio Global" value={Number(summary.averageScore || 0)?.toFixed(1) || '--'} color={getScoreColor(Number(summary.averageScore || 0))} sub={getScoreLabel(Number(summary.averageScore || 0))} />
                    <KPI label="Completitud" value={`${Number(summary.completionRate) || 0}%`} color={Number(summary.completionRate) >= 80 ? 'var(--success)' : 'var(--warning)'} />
                    <KPI label="Evaluaciones" value={`${summary.completedAssignments || 0}/${summary.totalAssignments || 0}`} />
                    <KPI label="Departamentos" value={depts.length} />
                  </div>

                  {/* Department Ranking BarChart */}
                  {depts.length > 0 && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Ranking por Departamento</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Puntaje promedio de evaluación por área, ordenado de mayor a menor (escala 1-10).</p>
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
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Semáforo de Áreas</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Vista rápida del estado de cada departamento. 🟢 ≥7.0 (Alto) | 🟡 5.0-6.9 (Medio) | 🔴 &lt;5.0 (Bajo).</p>
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
                  {summary.averageScore != null && (
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
                    <KPI label="Promotores" value={enpsData.promoters || 0} color="var(--success)" sub="Puntaje 9-10" />
                    <KPI label="Pasivos" value={(enpsData.total || 0) - (enpsData.promoters || 0) - (enpsData.detractors || 0)} color="#94a3b8" sub="Puntaje 7-8" />
                    <KPI label="Detractores" value={enpsData.detractors || 0} color="var(--danger)" sub="Puntaje 0-6" />
                    <KPI label="Total Respuestas" value={enpsData.total || 0} />
                  </div>

                  {/* eNPS Donut */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="card" style={{ padding: '1.25rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Distribución eNPS</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Employee Net Promoter Score: promotores (9-10), pasivos (7-8) y detractores (0-6).</p>
                      {(enpsData.total || 0) > 0 ? (
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
                      ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '3rem 0' }}>Sin respuestas en esta encuesta.</p>}
                    </div>

                    {/* Headcount chart is in Tab 3 (Dotación) */}
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

              {/* Headcount by department */}
              {headcount?.byDepartment?.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Dotación por Departamento</h4>
                  <div style={{ height: Math.max(180, (headcount.byDepartment.length || 1) * 30) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={headcount.byDepartment.slice(0, 10)} layout="vertical" margin={{ left: 80 }}>
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

              {/* Turnover by month (admin only) */}
              {isAdmin && turnoverData?.byMonth?.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Tendencia de Salidas (12 meses)</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Cantidad de desvinculaciones por mes. Permite identificar patrones estacionales o picos de rotación.</p>
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
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Por Tipo de Salida</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Distribución según motivo de la desvinculación.</p>
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
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Voluntario vs Involuntario</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Proporción de salidas por decisión propia vs decisión de la empresa.</p>
                    {(turnoverData.voluntary || 0) + (turnoverData.involuntary || 0) > 0 ? (
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
                    ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '2rem 0' }}>Sin datos de salidas clasificadas en el período.</p>}
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
              {!objectives && !execData ? <Spinner /> : !objectives ? <EmptyState msg="No hay datos de objetivos disponibles." /> : (
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
                            <Pie data={(() => {
                              const raw = [
                                { name: 'Completados', value: objectives.completed || 0, color: '#10b981' },
                                { name: 'En progreso', value: objectives.inProgress || 0, color: '#6366f1' },
                                { name: 'Borrador', value: objectives.draft || 0, color: '#94a3b8' },
                                { name: 'Pendientes', value: objectives.pendingApproval || 0, color: '#f59e0b' },
                                { name: 'Abandonados', value: objectives.abandoned || 0, color: '#ef4444' },
                              ];
                              return raw.filter(d => d.value > 0);
                            })()} innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value">
                              {[
                                { name: 'Completados', value: objectives.completed || 0, color: '#10b981' },
                                { name: 'En progreso', value: objectives.inProgress || 0, color: '#6366f1' },
                                { name: 'Borrador', value: objectives.draft || 0, color: '#94a3b8' },
                                { name: 'Pendientes', value: objectives.pendingApproval || 0, color: '#f59e0b' },
                                { name: 'Abandonados', value: objectives.abandoned || 0, color: '#ef4444' },
                              ].filter(d => d.value > 0).map((d, i) => <Cell key={i} fill={d.color} />)}
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
              {!pdiData && !loadedTabs.has('development') ? <Spinner /> : !pdiData ? <EmptyState msg="No hay datos de planes de desarrollo disponibles." /> : (
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

                  {/* Plan Organizacional — if selected */}
                  {selectedPlanData && (
                    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '3px solid var(--accent)' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        Plan Organizacional: {selectedPlanData.title} ({selectedPlanData.year})
                      </h4>
                      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                        <span>Estado: <strong style={{ color: selectedPlanData.status === 'activo' ? 'var(--success)' : 'var(--text-muted)' }}>{selectedPlanData.status}</strong></span>
                        <span>Iniciativas: <strong>{planInitiatives.length}</strong></span>
                        <span>Completadas: <strong style={{ color: 'var(--success)' }}>{planInitiatives.filter((i: any) => i.status === 'completada').length}</strong></span>
                        <span>En curso: <strong style={{ color: 'var(--accent)' }}>{planInitiatives.filter((i: any) => i.status === 'en_curso').length}</strong></span>
                        <span>Pendientes: <strong>{planInitiatives.filter((i: any) => i.status === 'pendiente').length}</strong></span>
                      </div>
                      {selectedPlanData.description && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>{selectedPlanData.description}</p>
                      )}
                      {planInitiatives.length > 0 && (
                        <div className="table-wrapper">
                          <table>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left' }}>Iniciativa</th>
                                <th>Departamento</th>
                                <th>Estado</th>
                                <th style={{ textAlign: 'right' }}>Progreso</th>
                                <th>Fecha meta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {planInitiatives.map((ini: any) => (
                                <tr key={ini.id}>
                                  <td style={{ fontWeight: 600, fontSize: '0.8rem' }}>{ini.title}</td>
                                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{ini.department || '—'}</td>
                                  <td>
                                    <span className={`badge ${ini.status === 'completada' ? 'badge-success' : ini.status === 'en_curso' ? 'badge-accent' : 'badge-ghost'}`} style={{ fontSize: '0.68rem' }}>
                                      {ini.status === 'completada' ? 'Completada' : ini.status === 'en_curso' ? 'En curso' : 'Pendiente'}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'flex-end' }}>
                                      <div style={{ width: 50, height: 5, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${ini.progress || 0}%`, background: ini.progress >= 70 ? 'var(--success)' : 'var(--warning)', borderRadius: 3 }} />
                                      </div>
                                      <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{ini.progress || 0}%</span>
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ini.targetDate ? new Date(ini.targetDate).toLocaleDateString('es-CL') : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {planInitiatives.length === 0 && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Este plan no tiene iniciativas registradas.</p>
                      )}
                    </div>
                  )}

                  {/* Analysis */}
                  <AnalysisCard title="Análisis de Desarrollo" borderColor={pdiData.completionRate >= 70 ? 'var(--success)' : 'var(--warning)'}>
                    <p><strong>Cumplimiento PDI:</strong> {pdiData.completionRate}% de los planes completados. {pdiData.completionRate >= 70 ? 'Buen avance en desarrollo de talento.' : 'Hay espacio para mejorar el seguimiento de los planes.'}</p>
                    <p><strong>Acciones:</strong> {pdiData.completedActions || 0} de {pdiData.totalActions || 0} completadas ({pdiData.actionCompletionRate || 0}%). {pdiData.overdueActions > 0 ? `⚠️ ${pdiData.overdueActions} acciones vencidas requieren atención.` : '✅ Sin acciones vencidas.'}</p>
                    {selectedPlanData && planInitiatives.length > 0 && (
                      <p><strong>Plan "{selectedPlanData.title}":</strong> {planInitiatives.filter((i: any) => i.status === 'completada').length} de {planInitiatives.length} iniciativas completadas ({planInitiatives.length > 0 ? Math.round((planInitiatives.filter((i: any) => i.status === 'completada').length / planInitiatives.length) * 100) : 0}%).</p>
                    )}
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
                <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{'⚠️'}</p>
                  <p style={{ fontWeight: 600, color: 'var(--warning)', marginBottom: '0.5rem' }}>Análisis de riesgo no disponible</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '500px', margin: '0 auto' }}>
                    El cálculo de riesgo de fuga requiere un plan que incluya análisis de IA (Pro o Enterprise).
                    Este análisis utiliza un algoritmo que combina datos de evaluaciones, objetivos, feedback y nine-box para generar un score de riesgo por colaborador.
                  </p>
                </div>
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
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Distribución de Riesgo de Fuga</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Score algorítmico (0-100) basado en: evaluaciones (30%), objetivos (25%), feedback (20%), OKRs en riesgo (15%) y nine-box (10%).</p>
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
                                <span key={i} className={`badge ${a.priority === 'alta' ? 'badge-danger' : a.priority === 'media' ? 'badge-accent' : 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>{retentionActionLabels[a.type] || a.type}</span>
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
