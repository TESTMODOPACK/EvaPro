'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import { useCycles } from '@/hooks/useCycles';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0891b2', '#8b5cf6', '#ec4899'];
const PIE_COLORS = { completed: '#10b981', inProgress: '#f59e0b', pending: '#6366f1', draft: '#94a3b8', abandoned: '#ef4444' };

export default function DashboardEjecutivoPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const toast = useToastStore((s) => s.toast);
  const { data: cycles } = useCycles();

  const [selectedCycleId, setSelectedCycleId] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Phase 2: Chart data
  const [analytics, setAnalytics] = useState<any>(null);
  const [surveyTrends, setSurveyTrends] = useState<any[]>([]);
  const [latestSurveyResults, setLatestSurveyResults] = useState<any>(null);
  const [orgPlans, setOrgPlans] = useState<any[]>([]);
  const [atRiskObjectives, setAtRiskObjectives] = useState<any[]>([]);
  const [recognitionStats, setRecognitionStats] = useState<any>(null);
  const [chartsLoading, setChartsLoading] = useState(true);

  // Phase 1: Load KPI summary
  useEffect(() => {
    if (!token) return;
    setLoadingSummary(true);
    api.reports.executiveDashboard(token, selectedCycleId || undefined)
      .then(setSummary)
      .catch((e) => toast(e.message || 'Error al cargar dashboard ejecutivo', 'error'))
      .finally(() => setLoadingSummary(false));
  }, [token, selectedCycleId]);

  // Phase 2: Load chart data in parallel
  useEffect(() => {
    if (!token) return;
    setChartsLoading(true);

    const cycleId = selectedCycleId || summary?.performance?.cycleId;

    Promise.all([
      cycleId ? api.reports.analytics(token, cycleId).catch(() => null) : Promise.resolve(null),
      api.surveys.getTrends(token).catch(() => []),
      summary?.enps?.surveyId ? api.surveys.getResults(token, summary.enps.surveyId).catch(() => null) : Promise.resolve(null),
      api.orgDevelopment.plans.list(token).catch(() => []),
      api.objectives.atRisk(token).catch(() => []),
      api.recognition.stats(token).catch(() => null),
    ]).then(([analyticsData, trends, surveyResults, plans, atRisk, recStats]) => {
      setAnalytics(analyticsData);
      setSurveyTrends(trends || []);
      setLatestSurveyResults(surveyResults);
      setOrgPlans(plans || []);
      setAtRiskObjectives(atRisk || []);
      setRecognitionStats(recStats);
    }).finally(() => setChartsLoading(false));
  }, [token, selectedCycleId, summary?.performance?.cycleId, summary?.enps?.surveyId]);

  // Derive org initiatives data from plans
  const orgInitiatives = orgPlans.flatMap((p: any) => p.initiatives || []);
  const initiativeStatusData = (() => {
    const counts: Record<string, number> = {};
    for (const init of orgInitiatives) {
      const s = init.status || 'pendiente';
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  })();

  // Derive objective status data
  const objectiveStatusData = summary?.objectives ? [
    { name: 'Completados', value: summary.objectives.completed, color: PIE_COLORS.completed },
    { name: 'En Progreso', value: summary.objectives.inProgress, color: PIE_COLORS.inProgress },
    { name: 'Borrador', value: summary.objectives.draft || 0, color: PIE_COLORS.draft },
    { name: 'Pendientes', value: summary.objectives.pendingApproval || 0, color: PIE_COLORS.pending },
    { name: 'Abandonados', value: summary.objectives.abandoned || 0, color: PIE_COLORS.abandoned },
  ].filter((d) => d.value > 0) : [];

  // eNPS trend data from survey trends
  const enpsTrendData = surveyTrends
    .filter((s: any) => s.overallAverage > 0)
    .map((s: any) => ({
      name: s.title ? (s.title.length > 20 ? s.title.substring(0, 20) + '...' : s.title) : 'Sin titulo',
      promedio: s.overallAverage,
      respuestas: s.responseRate,
    }));

  // Radar data from latest survey results
  const radarData = (latestSurveyResults?.averageByCategory || []).map((c: any) => ({
    category: c.category,
    promedio: c.average,
    fullMark: 5,
  }));

  if (loadingSummary) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('executiveDashboard.title', 'Dashboard Ejecutivo')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('executiveDashboard.subtitle', 'Vista estrategica de la organizacion')}
          </p>
        </div>
        <div>
          <select
            className="input"
            style={{ fontSize: '0.82rem', minWidth: 220 }}
            value={selectedCycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
          >
            <option value="">Ultimo ciclo</option>
            {(cycles || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard label="Colaboradores" value={summary?.headcount?.active ?? '--'} color="#6366f1" />
        <KPICard label="eNPS" value={summary?.enps ? `${summary.enps.score > 0 ? '+' : ''}${summary.enps.score}` : '--'} color="#10b981" subtitle={summary?.enps?.surveyName} />
        <KPICard label="Desempeno Prom." value={summary?.performance?.avgScore ? `${summary.performance.avgScore}/5` : '--'} color="#C9933A" subtitle={summary?.performance?.cycleName} />
        <KPICard label="Objetivos %" value={summary?.objectives?.completionPct != null ? `${summary.objectives.completionPct}%` : '--'} color="#8b5cf6" subtitle={`${summary?.objectives?.completed || 0}/${summary?.objectives?.total || 0}`} />
        <KPICard label="Eval. Completitud" value={summary?.performance?.completionRate != null ? `${summary.performance.completionRate}%` : '--'} color="#0891b2" subtitle={`${summary?.performance?.completedAssignments || 0}/${summary?.performance?.totalAssignments || 0}`} />
        <KPICard label="Iniciativas Activas" value={summary?.orgDevelopment?.inProgressInitiatives ?? '--'} color="#f59e0b" subtitle={`${summary?.orgDevelopment?.totalInitiatives || 0} total`} />
      </div>

      {/* ─── Section: Performance & Evaluations ─── */}
      <SectionTitle icon="var(--accent)" text="Desempeno y Evaluaciones" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Distribucion de Puntajes</h4>
          {analytics?.scoreDistribution?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.scoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#C9933A" radius={[4, 4, 0, 0]} name="Empleados" />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Comparativa por Departamento</h4>
          {analytics?.departmentComparison?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.departmentComparison.map((d: any) => ({ ...d, avgScore: Number(d.avgScore) }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} />
                <YAxis dataKey="department" type="category" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="avgScore" fill="#6366f1" radius={[0, 4, 4, 0]} name="Promedio" />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </div>
      </div>

      {/* ─── Section: Climate & Engagement ─── */}
      <SectionTitle icon="#10b981" text="Clima y Engagement" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Tendencia de Encuestas</h4>
          {enpsTrendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={enpsTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="promedio" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Promedio General" />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Se necesitan al menos 2 encuestas cerradas" />}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Engagement por Categoria</h4>
          {radarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="category" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10 }} />
                <Radar name="Promedio" dataKey="promedio" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Sin datos de encuestas de clima" />}
        </div>
      </div>

      {/* ─── Section: Org Development ─── */}
      <SectionTitle icon="#f59e0b" text="Desarrollo Organizacional" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Estado de Iniciativas</h4>
          {initiativeStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={initiativeStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }: any) => `${name}: ${value}`}>
                  {initiativeStatusData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Sin iniciativas de desarrollo" />}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Planes de Desarrollo</h4>
          {orgPlans.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {orgPlans.slice(0, 5).map((plan: any) => {
                const total = (plan.initiatives || []).length;
                const completed = (plan.initiatives || []).filter((i: any) => i.status === 'completada').length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                return (
                  <div key={plan.id} style={{ padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{plan.title}</span>
                      <span className={`badge ${plan.status === 'activo' ? 'badge-success' : 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>{plan.status}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{completed}/{total} ({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyChart message="Sin planes de desarrollo" />}
        </div>
      </div>

      {/* ─── Section: Objectives ─── */}
      <SectionTitle icon="#8b5cf6" text="Objetivos" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Distribucion por Estado</h4>
          {objectiveStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={objectiveStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }: any) => `${name}: ${value}`}>
                  {objectiveStatusData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Sin objetivos registrados" />}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Objetivos en Riesgo</h4>
          {atRiskObjectives.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 280, overflowY: 'auto' }}>
              {atRiskObjectives.slice(0, 8).map((obj: any) => (
                <div key={obj.id} style={{ padding: '0.6rem 0.75rem', background: 'rgba(239,68,68,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.2rem' }}>{obj.title}</div>
                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>{obj.owner?.firstName} {obj.owner?.lastName}</span>
                    {obj.progress != null && <span>Progreso: {obj.progress}%</span>}
                    {obj.dueDate && <span>Vence: {new Date(obj.dueDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin objetivos en riesgo
            </div>
          )}
        </div>
      </div>

      {/* ─── Section: People ─── */}
      <SectionTitle icon="#6366f1" text="Personas y Talento" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Distribucion por Departamento</h4>
          {summary?.headcount?.byDepartment?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={summary.headcount.byDepartment}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="department" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Colaboradores" />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Reconocimiento</h4>
          {recognitionStats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 0' }}>
              <StatRow label="Reconocimientos Totales" value={recognitionStats.totalRecognitions ?? 0} />
              <StatRow label="Este Mes" value={recognitionStats.thisMonth ?? 0} />
              <StatRow label="Usuarios Activos" value={recognitionStats.activeUsers ?? 0} />
              <StatRow label="Insignias Otorgadas" value={recognitionStats.badgesAwarded ?? 0} />
            </div>
          ) : <EmptyChart message="Sin datos de reconocimiento" />}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function KPICard({ label, value, color, subtitle }: { label: string; value: string | number; color: string; subtitle?: string }) {
  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: -20, right: -20,
        width: 70, height: 70, borderRadius: '50%',
        background: `${color}18`,
      }} />
      <div style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '0.3rem', color }}>
        {value}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{subtitle}</div>
      )}
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: string; text: string }) {
  return (
    <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: icon, display: 'inline-block' }} />
      {text}
    </h2>
  );
}

function EmptyChart({ message = 'Sin datos disponibles' }: { message?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      {message}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
