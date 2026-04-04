'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useRouter } from 'next/navigation';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function ResultadosEncuestaPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const surveyId = params.id as string;
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = user?.role === 'tenant_admin' || user?.role === 'super_admin';
  const { isBlocked: aiBlocked } = useAiQuota();

  const [results, setResults] = useState<any>(null);
  const [enps, setEnps] = useState<any>(null);
  const [deptResults, setDeptResults] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [orgPlans, setOrgPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [creatingInitiatives, setCreatingInitiatives] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [showInitiativeModal, setShowInitiativeModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'department' | 'responses' | 'ai' | 'trends'>('overview');
  const [exporting, setExporting] = useState<string | null>(null);

  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!token || !surveyId) return;
    setExporting(format);
    try {
      const res = await fetch(`${BASE_URL}/surveys/${surveyId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const link = document.createElement('a');
      const extMap: Record<string, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
      link.href = URL.createObjectURL(blob);
      link.download = `encuesta-clima.${extMap[format]}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast('Error al exportar', 'error');
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (!token || !surveyId) return;
    loadResults();
  }, [token, surveyId]);

  const loadResults = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [res, enpsData, dept, trendData] = await Promise.all([
        api.surveys.getResults(token, surveyId),
        api.surveys.getENPS(token, surveyId),
        isAdmin ? api.surveys.getResultsByDept(token, surveyId) : Promise.resolve([]),
        isAdmin ? api.surveys.getTrends(token) : Promise.resolve([]),
      ]);
      setResults(res);
      setEnps(enpsData);
      setDeptResults(dept);
      setTrends(trendData);

      // Load AI analysis if exists
      try {
        const ai = await api.surveys.getAiAnalysis(token, surveyId);
        if (ai) setAiAnalysis(ai);
      } catch {}
    } catch (e: any) {
      toast(e.message || 'Error al cargar resultados', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!token) return;
    setGeneratingAi(true);
    try {
      const analysis = await api.surveys.generateAiAnalysis(token, surveyId);
      setAiAnalysis(analysis);
      toast('Analisis AI generado exitosamente', 'success');
    } catch (e: any) {
      toast(e.message || 'Error al generar analisis AI', 'error');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleCreateInitiatives = async () => {
    if (!token) return;
    setCreatingInitiatives(true);
    try {
      const result = await api.surveys.createInitiatives(token, surveyId, selectedPlanId || undefined);
      toast(`Se crearon ${result.created} iniciativas de desarrollo`, 'success');
      setShowInitiativeModal(false);
    } catch (e: any) {
      toast(e.message || 'Error al crear iniciativas', 'error');
    } finally {
      setCreatingInitiatives(false);
    }
  };

  const loadOrgPlans = async () => {
    if (!token) return;
    try {
      const plans = await api.orgDevelopment?.plans?.list?.(token) || [];
      setOrgPlans(plans);
    } catch {}
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando resultados...</div>;
  if (!results) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No se encontraron resultados</div>;

  const radarData = (results.averageByCategory || []).map((c: any) => ({
    category: c.category,
    promedio: c.average,
    fullMark: 5,
  }));

  const enpsColors = { promoters: '#16a34a', passives: '#eab308', detractors: '#ef4444' };
  const enpsPieData = enps ? [
    { name: 'Promotores', value: enps.promoters, color: enpsColors.promoters },
    { name: 'Pasivos', value: enps.passives, color: enpsColors.passives },
    { name: 'Detractores', value: enps.detractors, color: enpsColors.detractors },
  ] : [];

  const TABS = [
    { key: 'overview', label: 'Resumen' },
    ...(isAdmin ? [{ key: 'department', label: 'Por Departamento' }] : []),
    { key: 'responses', label: 'Comentarios' },
    ...(isAdmin ? [{ key: 'ai', label: 'Análisis IA' }] : []),
    ...(isAdmin ? [{ key: 'trends', label: 'Tendencias' }] : []),
  ];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => router.push('/dashboard/encuestas-clima')}>
            &#8592; Encuestas
          </button>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            Resultados: {results.survey?.title}
          </h1>
          <span className={`badge ${results.survey?.status === 'closed' ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: '0.65rem' }}>
            {results.survey?.status === 'closed' ? 'Cerrada' : 'Activa'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0, flex: 1 }}>
            {results.totalResponses} respuestas de {results.totalAssigned} asignados ({results.responseRate}% tasa de respuesta)
          </p>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {(['pdf', 'xlsx', 'csv'] as const).map((fmt) => (
                <button key={fmt} type="button" disabled={!!exporting}
                  onClick={() => handleExport(fmt)}
                  style={{
                    padding: '0.35rem 0.7rem', fontSize: '0.72rem', fontWeight: 600,
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
                    background: exporting === fmt ? 'var(--bg-hover)' : 'var(--bg-surface)',
                    color: 'var(--text-secondary)', cursor: exporting ? 'wait' : 'pointer',
                    opacity: exporting && exporting !== fmt ? 0.5 : 1,
                  }}>
                  {exporting === fmt ? t('common.exporting') : fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Tasa de Respuesta</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>{results.responseRate}%</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{results.totalResponses}/{results.totalAssigned}</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Promedio General</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: results.overallAverage >= 4 ? '#16a34a' : results.overallAverage >= 3 ? '#eab308' : '#ef4444' }}>
            {results.overallAverage}/5
          </div>
        </div>
        {enps && enps.enps !== null && (
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>eNPS</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: enps.enps >= 50 ? '#16a34a' : enps.enps >= 0 ? '#eab308' : '#ef4444' }}>
              {enps.enps > 0 ? '+' : ''}{enps.enps}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{enps.total} respuestas NPS</div>
          </div>
        )}
        {results.survey?.isAnonymous && (
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Tipo</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>&#128274;</div>
            <div style={{ fontSize: '0.75rem', color: '#16a34a' }}>Anónima</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '0.6rem 1rem',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2,
              whiteSpace: 'nowrap',
              fontSize: '0.9rem',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Radar Chart */}
          {radarData.length > 0 && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Promedio por Categoría</h3>
              <ResponsiveContainer width="100%" height={350}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10 }} />
                  <Radar name="Promedio" dataKey="promedio" stroke="#C9933A" fill="#C9933A" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bar Chart per question */}
          {(results.averageByQuestion || []).length > 0 && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Promedio por Pregunta</h3>
              <ResponsiveContainer width="100%" height={Math.max(250, results.averageByQuestion.length * 40)}>
                <BarChart data={results.averageByQuestion} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 5]} />
                  <YAxis dataKey="questionText" type="category" width={250} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="average" fill="#C9933A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* eNPS Pie */}
          {enps && enps.total > 0 && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Distribución eNPS</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie data={enpsPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {enpsPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: enpsColors.promoters }} />
                    <span style={{ fontSize: '0.9rem' }}>Promotores (9-10): {enps.promoterPercent}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: enpsColors.passives }} />
                    <span style={{ fontSize: '0.9rem' }}>Pasivos (7-8): {enps.passivePercent}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: enpsColors.detractors }} />
                    <span style={{ fontSize: '0.9rem' }}>Detractores (0-6): {enps.detractorPercent}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Likert Distribution */}
          {(results.likertDistribution || []).length > 0 && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Distribución de Respuestas</h3>
              {results.likertDistribution.map((q: any) => (
                <div key={q.questionId} style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.85rem', margin: '0 0 0.25rem', fontWeight: 500 }}>{q.questionText}</p>
                  <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', background: 'var(--border)' }}>
                    {q.distribution.map((d: any) => {
                      const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];
                      return d.percentage > 0 ? (
                        <div
                          key={d.level}
                          style={{
                            width: `${d.percentage}%`,
                            background: colors[d.level],
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.65rem',
                            color: '#fff',
                            fontWeight: 600,
                          }}
                          title={`Nivel ${d.level}: ${d.percentage}% (${d.count})`}
                        >
                          {d.percentage >= 8 ? `${d.level}` : ''}
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Department Tab ─── */}
      {activeTab === 'department' && isAdmin && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Resultados por Departamento</h3>
          {deptResults.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No hay datos por departamento disponibles.</p>
          ) : (
            <>
              <div className="table-wrapper" style={{ marginBottom: '1.5rem' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Departamento</th>
                      <th>Respuestas</th>
                      <th>Promedio</th>
                      <th>Nivel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptResults.map((d: any) => (
                      <tr key={d.department}>
                        <td style={{ fontWeight: 500 }}>{d.department}</td>
                        <td>{d.responseCount}</td>
                        <td style={{ fontWeight: 600 }}>{d.average}/5</td>
                        <td>
                          <div style={{ width: 80, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${(d.average / 5) * 100}%`, height: '100%', background: d.average >= 4 ? '#16a34a' : d.average >= 3 ? '#eab308' : '#ef4444', borderRadius: 4 }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={deptResults}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 5]} />
                  <Tooltip />
                  <Bar dataKey="average" fill="#C9933A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      )}

      {/* ─── Comentarios Tab ─── */}
      {activeTab === 'responses' && (
        <CommentsTab openResponses={results.openResponses || []} />
      )}

      {/* ─── AI Analysis Tab ─── */}
      {activeTab === 'ai' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <AiQuotaBar />
          {!aiAnalysis ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 0.5rem' }}>Análisis con Inteligencia Artificial</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Genera un informe ejecutivo completo con fortalezas, áreas críticas, análisis de sentimiento y recomendaciones accionables.
              </p>
              <button className="btn-primary" onClick={handleGenerateAi} disabled={generatingAi || results.totalResponses === 0 || aiBlocked}>
                {aiBlocked ? 'Créditos IA agotados' : generatingAi ? 'Generando análisis...' : 'Generar Análisis con IA'}
              </button>
              {results.totalResponses === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Se necesitan respuestas para generar el analisis.
                </p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Executive Summary */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Resumen Ejecutivo</h3>
                  {aiAnalysis.content?.overallHealthScore !== undefined && (
                    <div style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: 20,
                      background: aiAnalysis.content.overallHealthScore >= 80 ? '#dcfce7' : aiAnalysis.content.overallHealthScore >= 60 ? '#fef3c7' : '#fecaca',
                      color: aiAnalysis.content.overallHealthScore >= 80 ? '#16a34a' : aiAnalysis.content.overallHealthScore >= 60 ? '#d97706' : '#dc2626',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                    }}>
                      Health Score: {aiAnalysis.content.overallHealthScore}/100
                    </div>
                  )}
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                  {aiAnalysis.content?.executiveSummary}
                </p>
                {aiAnalysis.content?.enpsInterpretation && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {aiAnalysis.content.enpsInterpretation}
                  </p>
                )}
              </div>

              {/* Strengths & Critical Areas */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
                {/* Strengths */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600, color: '#16a34a' }}>Fortalezas</h3>
                  {(aiAnalysis.content?.topStrengths || []).map((s: any, i: number) => (
                    <div key={i} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(22,163,106,0.05)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem' }}>
                        <span>{s.category}</span>
                        <span style={{ color: '#16a34a' }}>{s.score}/5</span>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{s.insight}</p>
                    </div>
                  ))}
                </div>

                {/* Critical Areas */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600, color: '#ef4444' }}>Áreas Críticas</h3>
                  {(aiAnalysis.content?.criticalAreas || []).map((a: any, i: number) => (
                    <div key={i} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(239,68,68,0.05)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem' }}>
                        <span>{a.category}</span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ color: '#ef4444' }}>{a.score}/5</span>
                          <span className={`badge ${a.urgency === 'high' ? 'badge-danger' : a.urgency === 'medium' ? 'badge-warning' : 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
                            {a.urgency === 'high' ? 'Urgente' : a.urgency === 'medium' ? 'Media' : 'Baja'}
                          </span>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{a.insight}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sentiment Analysis */}
              {aiAnalysis.content?.sentimentAnalysis && (
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>Análisis de Sentimiento</h3>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>&#128522;</div>
                      <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Positivo</div><div style={{ fontWeight: 700 }}>{aiAnalysis.content.sentimentAnalysis.positive}%</div></div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>&#128528;</div>
                      <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Neutral</div><div style={{ fontWeight: 700 }}>{aiAnalysis.content.sentimentAnalysis.neutral}%</div></div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>&#128542;</div>
                      <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Negativo</div><div style={{ fontWeight: 700 }}>{aiAnalysis.content.sentimentAnalysis.negative}%</div></div>
                    </div>
                  </div>
                  {aiAnalysis.content.sentimentAnalysis.keyThemes?.length > 0 && (
                    <div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Temas clave: </span>
                      {aiAnalysis.content.sentimentAnalysis.keyThemes.map((thm: string, i: number) => (
                        <span key={i} className="badge badge-ghost" style={{ marginRight: '0.25rem', fontSize: '0.75rem' }}>{thm}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Recommendations */}
              {(aiAnalysis.content?.recommendations || []).length > 0 && (
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>Recomendaciones</h3>
                  {aiAnalysis.content.recommendations.map((r: any, i: number) => (
                    <div key={i} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{r.title}</strong>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <span className={`badge ${r.priority === 'high' ? 'badge-danger' : r.priority === 'medium' ? 'badge-warning' : 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
                            {r.priority === 'high' ? 'Alta' : r.priority === 'medium' ? 'Media' : 'Baja'}
                          </span>
                          <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{r.type}</span>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{r.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Create Initiatives Button */}
              {(aiAnalysis.content?.suggestedInitiatives || []).length > 0 && (
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600 }}>Iniciativas Sugeridas</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    La IA sugiere las siguientes iniciativas de desarrollo organizacional:
                  </p>
                  {aiAnalysis.content.suggestedInitiatives.map((init: any, i: number) => (
                    <div key={i} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{init.title}</strong>
                      {init.department && <span className="badge badge-ghost" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>{init.department}</span>}
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.25rem 0' }}>{init.description}</p>
                      {init.actionItems?.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {init.actionItems.map((a: string, j: number) => <li key={j}>{a}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  <button
                    className="btn-primary"
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => { setShowInitiativeModal(true); loadOrgPlans(); }}
                  >
                    Crear Iniciativas en Plan de Desarrollo Organizacional
                  </button>
                </div>
              )}

              {/* Regenerate */}
              <button className="btn-ghost" style={{ fontSize: '0.85rem' }} onClick={handleGenerateAi} disabled={generatingAi || aiBlocked}>
                {aiBlocked ? 'Sin créditos' : generatingAi ? 'Regenerando...' : 'Regenerar análisis'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Trends Tab ─── */}
      {activeTab === 'trends' && isAdmin && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Tendencias Históricas</h3>
          {trends.length < 2 ? (
            <p style={{ color: 'var(--text-muted)' }}>Se necesitan al menos 2 encuestas cerradas para ver tendencias.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="title" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 5]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="overallAverage" name="Promedio General" stroke="#C9933A" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>

              {/* Category trends */}
              {(() => {
                const allCategories = Array.from(new Set(trends.flatMap((t: any) => (t.categories || []).map((c: any) => c.category))));
                const catTrendData = trends.map((t: any) => {
                  const row: any = { name: t.title };
                  (t.categories || []).forEach((c: any) => { row[c.category] = c.average; });
                  return row;
                });
                return allCategories.length > 0 ? (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.75rem' }}>Tendencia por Categoría</h4>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={catTrendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 5]} />
                        <Tooltip />
                        <Legend />
                        {allCategories.map((cat, i) => (
                          <Line key={cat} type="monotone" dataKey={cat} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}

      {/* Initiative creation modal */}
      {showInitiativeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowInitiativeModal(false)}>
          <div className="card animate-fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, padding: '1.75rem' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Crear Iniciativas de Desarrollo</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Se crearán {aiAnalysis?.content?.suggestedInitiatives?.length || 0} iniciativas en estado borrador dentro del plan seleccionado.
            </p>
            {orgPlans.length > 0 ? (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan de Desarrollo Organizacional</label>
                <select className="input" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                  <option value="">Plan activo del ano actual (auto)</option>
                  {orgPlans.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.title} ({p.year})</option>
                  ))}
                </select>
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Se usara el plan activo del ano actual. Si no existe, se mostrara un error.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setShowInitiativeModal(false)}>Cancelar</button>
              <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleCreateInitiatives} disabled={creatingInitiatives}>
                {creatingInitiatives ? 'Creando...' : 'Crear Iniciativas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentsTab({ openResponses }: { openResponses: any[] }) {
  // Group by question, deduplicate and count repetitions
  const grouped: Record<string, { question: string; category: string; responses: Array<{ text: string; count: number }> }> = {};
  for (const r of openResponses) {
    const key = r.questionId || r.category;
    if (!grouped[key]) grouped[key] = { question: r.questionText || r.category, category: r.category, responses: [] };
    const existing = grouped[key].responses.find((x: any) => x.text === r.text);
    if (existing) { existing.count++; } else { grouped[key].responses.push({ text: r.text, count: 1 }); }
  }
  for (const g of Object.values(grouped)) {
    g.responses.sort((a, b) => b.count - a.count);
  }
  const groups = Object.values(grouped);
  const totalComments = openResponses.length;
  const uniqueComments = groups.reduce((sum, g) => sum + g.responses.length, 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Comentarios de Colaboradores</h3>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {totalComments} comentarios ({uniqueComments} temas distintos)
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No hay comentarios en esta encuesta.
        </div>
      ) : groups.map((g, gIdx) => (
        <div key={gIdx} className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>{g.category}</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{g.question}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {g.responses.map((resp, rIdx) => (
              <div key={rIdx} style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                padding: '0.6rem 0.85rem', background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', fontStyle: 'italic', flex: 1, lineHeight: 1.5 }}>
                  &ldquo;{resp.text}&rdquo;
                </p>
                {resp.count > 1 && (
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)',
                    background: 'rgba(201,147,58,0.1)', padding: '0.15rem 0.5rem',
                    borderRadius: 10, whiteSpace: 'nowrap',
                  }}>
                    {resp.count}x
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
