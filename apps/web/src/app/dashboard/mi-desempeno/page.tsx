'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge, ScaleLegend } from '@/components/ScoreBadge';
import { getScaleLevel } from '@/lib/scales';
import { useCycles } from '@/hooks/useCycles';
import CompetencyRadarChart from '@/components/CompetencyRadarChart';
import SelfVsOthersChart from '@/components/SelfVsOthersChart';
import GapAnalysisChart from '@/components/GapAnalysisChart';
import { useGapAnalysisIndividual } from '@/hooks/useReports';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const cycleTypeLabels: Record<string, string> = {
  '': 'Todos',
  '90': '90\u00b0',
  '180': '180\u00b0',
  '270': '270\u00b0',
  '360': '360\u00b0',
};

const selectStyle: React.CSSProperties = {
  padding: '0.45rem 0.7rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text-primary)',
  fontSize: '0.82rem',
  outline: 'none',
};

function GapSection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data, isLoading } = useGapAnalysisIndividual(cycleId, userId);
  if (isLoading) return <div style={{ padding: '1rem', textAlign: 'center' }}><span className="spinner" /></div>;
  if (!data || !data.competencies || data.competencies.length === 0) return null;
  return <GapAnalysisChart data={data} isLoading={false} />;
}

export default function MiDesempenoPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<any>(null);
  const [completed, setCompleted] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Radar cycle selector
  const { data: allCycles } = useCycles();
  const [radarCycleId, setRadarCycleId] = useState('');
  const closedCycles = (allCycles || []).filter((c: any) => c.status === 'closed' || c.status === 'active');

  // Filter state
  const [cycleTypeFilter, setCycleTypeFilter] = useState('');

  // Unified history sections
  const [feedbackReceived, setFeedbackReceived] = useState<any[]>([]);
  const [devPlans, setDevPlans] = useState<any[]>([]);
  const [objectives, setObjectives] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'evaluaciones' | 'feedback' | 'pdi' | 'objetivos' | 'reconocimientos'>('evaluaciones');

  // Recognition data
  const [myPoints, setMyPoints] = useState<number>(0);
  const [myBadges, setMyBadges] = useState<any[]>([]);
  const [recognitionsReceived, setRecognitionsReceived] = useState<any[]>([]);

  // PDI expandable actions
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user?.userId) return;
    setLoading(true);
    Promise.all([
      api.reports.performanceHistory(token, user.userId, cycleTypeFilter || undefined).catch(() => null),
      api.evaluations.completed(token).catch(() => []),
      api.evaluations.pending(token).catch(() => []),
      api.feedback.receivedFeedback(token).catch(() => []),
      api.development.plans.list(token).catch(() => []),
      api.objectives.list(token).catch(() => []),
      api.recognition.myPoints(token).catch(() => ({ total: 0 })),
      api.recognition.myBadges(token).catch(() => []),
      api.recognition.wall(token, 1, 50).catch(() => ({ data: [] })),
    ])
      .then(([h, c, p, fb, dp, obj, pts, badges, wall]) => {
        setHistory(h);
        setCompleted(Array.isArray(c) ? c : []);
        setPending(Array.isArray(p) ? p : []);
        setFeedbackReceived(Array.isArray(fb) ? fb : []);
        setDevPlans(Array.isArray(dp) ? dp : (dp as any)?.data ? (dp as any).data : []);
        setObjectives(Array.isArray(obj) ? obj : (obj as any)?.data ? (obj as any).data : []);
        setMyPoints(pts?.total ?? pts?.points ?? 0);
        setMyBadges(Array.isArray(badges) ? badges : []);
        // Filter wall to only show recognitions received by current user
        const wallData = wall?.data || (Array.isArray(wall) ? wall : []);
        setRecognitionsReceived(wallData.filter((r: any) => r.toUserId === user.userId || r.toUser?.id === user.userId));
      })
      .finally(() => setLoading(false));
  }, [token, user?.userId, cycleTypeFilter]);

  if (loading) return <Spinner />;

  const cycles = history?.cycles || history?.history || [];
  const latestScore = cycles.length > 0 ? cycles[cycles.length - 1] : null;

  const completedWithScore = completed.filter((e: any) => e.response?.overallScore != null);
  const latestCompleted = completedWithScore.length > 0 ? completedWithScore[0] : null;
  const displayScore = latestScore?.avgOverall ?? latestCompleted?.response?.overallScore ?? null;

  // Objectives grouped by status
  const activeObjectives = objectives.filter((o: any) => o.status === 'active');
  const otherObjectives = objectives.filter((o: any) => o.status !== 'active');

  // Feedback grouped by type
  const feedbackPositive = feedbackReceived.filter((fb: any) => fb.type === 'positive' || fb.type === 'recognition' || fb.sentiment === 'positive');
  const feedbackConstructive = feedbackReceived.filter((fb: any) => fb.type === 'constructive' || fb.type === 'improvement' || fb.sentiment === 'constructive');
  const feedbackNeutral = feedbackReceived.filter((fb: any) => !feedbackPositive.includes(fb) && !feedbackConstructive.includes(fb));

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    fontSize: '0.82rem',
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: active ? 'var(--accent)' : 'transparent',
  });

  const sentimentIcon = (type: string) => {
    if (type === 'positive') return { icon: '\u2B50', color: '#10b981', label: 'Positivo' };
    if (type === 'constructive') return { icon: '\uD83D\uDCA1', color: '#f59e0b', label: 'Constructivo' };
    return { icon: '\uD83D\uDCAC', color: 'var(--text-muted)', label: 'General' };
  };

  const handleExportCsv = () => {
    const rows: string[] = [];
    const esc = (v: any) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };

    rows.push('RESUMEN MI DESEMPEÑO');
    rows.push(`Último puntaje,${displayScore ?? 'Sin datos'}`);
    rows.push(`Evaluaciones pendientes,${pending.length}`);
    rows.push(`Feedback recibido,${feedbackReceived.length}`);
    rows.push(`Objetivos activos,${activeObjectives.length}`);
    rows.push(`Puntos reconocimiento,${myPoints}`);
    rows.push('');

    rows.push('EVALUACIONES COMPLETADAS');
    rows.push('Evaluado,Tipo,Ciclo,Puntaje,Fecha');
    for (const ev of completed) {
      const name = ev.evaluatee ? `${ev.evaluatee.firstName || ''} ${ev.evaluatee.lastName || ''}`.trim() : '';
      rows.push([esc(name), ev.relationType, esc(ev.cycle?.name || ''), ev.response?.overallScore ?? '', ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : ''].join(','));
    }
    rows.push('');

    rows.push('FEEDBACK RECIBIDO');
    rows.push('De,Tipo,Sentimiento,Mensaje,Fecha');
    for (const fb of feedbackReceived) {
      const from = fb.isAnonymous ? 'Anónimo' : fb.fromUser ? `${fb.fromUser.firstName} ${fb.fromUser.lastName}` : 'Anónimo';
      rows.push([esc(from), fb.type || '', fb.sentiment || '', esc(fb.message || ''), fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('es-CL') : ''].join(','));
    }
    rows.push('');

    rows.push('OBJETIVOS');
    rows.push('Título,Tipo,Estado,Progreso %,Fecha Meta');
    for (const obj of objectives) {
      rows.push([esc(obj.title), obj.type || '', obj.status || '', obj.progress || 0, obj.targetDate ? new Date(obj.targetDate).toLocaleDateString('es-CL') : ''].join(','));
    }

    const csv = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'mi-desempeno.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '960px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {'Mi Desempeño'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {'Tu historial completo: evaluaciones, feedback, desarrollo, objetivos y reconocimientos'}
          </p>
        </div>
        <button type="button" onClick={handleExportCsv}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Exportar CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            {'\u00DAltimo puntaje'}
          </div>
          {displayScore != null ? (
            <ScoreBadge score={displayScore} size="lg" />
          ) : (
            <div style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Sin datos</div>
          )}
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Pendientes
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: pending.length > 0 ? '#f59e0b' : '#10b981', lineHeight: 1 }}>
            {pending.length}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Feedback recibido
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>
            {feedbackReceived.length}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Objetivos activos
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1', lineHeight: 1 }}>
            {activeObjectives.length}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>
            Puntos ganados
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: '#c9933a', lineHeight: 1 }}>
              {myPoints}
            </span>
            {myBadges.length > 0 && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {myBadges.length} insignia{myBadges.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Scale legend */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Tab navigation */}
      <div className="animate-fade-up-delay-2" style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        <button style={tabStyle(activeTab === 'evaluaciones')} onClick={() => setActiveTab('evaluaciones')}>
          Evaluaciones ({completed.length})
        </button>
        <button style={tabStyle(activeTab === 'feedback')} onClick={() => setActiveTab('feedback')}>
          Feedback ({feedbackReceived.length})
        </button>
        <button style={tabStyle(activeTab === 'pdi')} onClick={() => setActiveTab('pdi')}>
          Desarrollo ({devPlans.length})
        </button>
        <button style={tabStyle(activeTab === 'objetivos')} onClick={() => setActiveTab('objetivos')}>
          Objetivos ({objectives.length})
        </button>
        <button style={tabStyle(activeTab === 'reconocimientos')} onClick={() => setActiveTab('reconocimientos')}>
          Reconocimientos ({recognitionsReceived.length})
        </button>
      </div>

      {/* ─── TAB: Evaluaciones ─────────────────────────────────────────── */}
      {activeTab === 'evaluaciones' && (
        <>
          {/* Cycle type filter */}
          <div className="card animate-fade-up" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Filtrar por tipo:</span>
            <select style={selectStyle} value={cycleTypeFilter} onChange={(e) => setCycleTypeFilter(e.target.value)}>
              {Object.entries(cycleTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Completed evaluations table */}
          {completed.length > 0 && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                Evaluaciones completadas
              </h2>
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Evaluado</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Tipo</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Ciclo</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Puntaje</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completed.map((ev: any, i: number) => {
                      const evaluateeName = ev.evaluatee ? `${ev.evaluatee.firstName || ''} ${ev.evaluatee.lastName || ''}`.trim() : '--';
                      const relLabel: Record<string, string> = { self: 'Autoevaluacion', manager: 'Jefatura', peer: 'Par', direct_report: 'Reporte directo' };
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{evaluateeName}</td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <span className="badge badge-accent">{relLabel[ev.relationType] || ev.relationType}</span>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>{ev.cycle?.name || '--'}</td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <ScoreBadge score={ev.response?.overallScore} size="sm" />
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>
                            {ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Performance History by cycle */}
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>
              {'Evoluci\u00f3n por ciclo'}
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              {'Puntaje promedio en cada periodo (escala 0 - 10)'}
            </p>

            {cycles.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {completed.length > 0
                  ? 'Las evaluaciones se reflejaran aqui al cerrar el ciclo'
                  : 'Aun no tienes evaluaciones completadas'
                }
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {cycles.map((c: any, i: number) => {
                  const score = Number(c.avgOverall || 0);
                  const level = getScaleLevel(score);
                  const color = level?.color || 'var(--text-muted)';
                  const typeLabel = c.cycleType ? ` (${c.cycleType}\u00b0)` : '';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ minWidth: '160px', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {c.cycleName || `Ciclo ${i + 1}`}
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{typeLabel}</span>
                      </div>
                      <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${(score / 10) * 100}%`,
                          background: color,
                          borderRadius: '999px',
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                      <div style={{ minWidth: '110px' }}>
                        <ScoreBadge score={score} size="sm" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Score breakdown */}
          {latestScore && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                {'Desglose \u00faltima evaluaci\u00f3n'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                {[
                  { label: 'Autoevaluacion', value: latestScore.avgSelf },
                  { label: 'Jefatura', value: latestScore.avgManager },
                  { label: 'Pares', value: latestScore.avgPeer },
                  { label: 'General', value: latestScore.avgOverall },
                ].filter(s => s.value != null).map((s, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <ScoreBadge score={s.value} size="lg" />
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Radar de Competencias ─────────────────────────────────────── */}
          {closedCycles.length > 0 && (
            <div className="animate-fade-up" style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  {'Radar de Competencias'}
                </h2>
                <select
                  className="input"
                  value={radarCycleId}
                  onChange={(e) => setRadarCycleId(e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem', width: 'auto', minWidth: '220px' }}
                >
                  <option value="">{'Seleccionar ciclo\u2026'}</option>
                  {closedCycles.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>
              {radarCycleId && user?.userId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem' }}>
                    <CompetencyRadarChart cycleId={radarCycleId} userId={user.userId} />
                    <SelfVsOthersChart cycleId={radarCycleId} userId={user.userId} />
                  </div>
                  <GapSection cycleId={radarCycleId} userId={user.userId} />
                </div>
              )}
              {!radarCycleId && (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {'Selecciona un ciclo para ver tu radar de competencias'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── TAB: Feedback ─────────────────────────────────────────────── */}
      {activeTab === 'feedback' && (
        <div className="animate-fade-up">
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
              Feedback recibido
            </h2>
            {feedbackReceived.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                Aun no has recibido feedback
              </p>
            ) : (
              <>
                {/* Summary by type */}
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Positivo', count: feedbackPositive.length, color: '#10b981', icon: '\u2B50' },
                    { label: 'Constructivo', count: feedbackConstructive.length, color: '#f59e0b', icon: '\uD83D\uDCA1' },
                    { label: 'General', count: feedbackNeutral.length, color: 'var(--text-muted)', icon: '\uD83D\uDCAC' },
                  ].map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.5rem 0.85rem', background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)',
                      fontSize: '0.82rem',
                    }}>
                      <span>{s.icon}</span>
                      <span style={{ fontWeight: 600, color: s.color }}>{s.count}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {feedbackReceived.slice(0, 20).map((fb: any, i: number) => {
                    const fbType = feedbackPositive.includes(fb) ? 'positive' : feedbackConstructive.includes(fb) ? 'constructive' : 'neutral';
                    const si = sentimentIcon(fbType);
                    return (
                      <div key={i} style={{
                        padding: '1rem', background: 'var(--bg-surface)',
                        borderRadius: 'var(--radius-sm, 6px)',
                        border: '1px solid var(--border)',
                        borderLeft: `3px solid ${si.color}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>{si.icon}</span>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                              {fb.isAnonymous ? 'An\u00f3nimo' : fb.fromUser ? `${fb.fromUser.firstName} ${fb.fromUser.lastName}` : 'An\u00f3nimo'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            {fb.type && <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{fb.type}</span>}
                            {fb.competencyName && <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>{fb.competencyName}</span>}
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('es-CL') : ''}
                            </span>
                          </div>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', margin: 0 }}>{fb.message}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: PDI / Desarrollo ─────────────────────────────────────── */}
      {activeTab === 'pdi' && (
        <div className="animate-fade-up">
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
              Planes de desarrollo
            </h2>
            {devPlans.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                No tienes planes de desarrollo asignados
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {devPlans.map((dp: any, i: number) => {
                  const actions = dp.actions || [];
                  const completedActions = actions.filter((a: any) => a.status === 'completed' || a.status === 'completada').length;
                  const totalActions = actions.length;
                  const progress = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;
                  const statusColors: Record<string, string> = { borrador: 'var(--text-muted)', activo: 'var(--accent)', en_revision: '#f59e0b', completado: 'var(--success)', cancelado: 'var(--danger)' };
                  const statusLabels: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', en_revision: 'En revision', completado: 'Completado', cancelado: 'Cancelado' };
                  const isActive = dp.status === 'activo';
                  const isExpanded = expandedPlan === (dp.id || i.toString());
                  return (
                    <div key={dp.id || i} style={{
                      padding: '1rem', background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      boxShadow: isActive ? '0 0 0 1px rgba(201,147,58,0.15)' : 'none',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {isActive && (
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
                          )}
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{dp.title || dp.name || `Plan #${i + 1}`}</span>
                        </div>
                        <span className="badge" style={{ fontSize: '0.72rem', color: statusColors[dp.status] || 'var(--text-muted)', borderColor: statusColors[dp.status] }}>
                          {statusLabels[dp.status] || dp.status}
                        </span>
                      </div>
                      {totalActions > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                            <span>{completedActions} de {totalActions} acciones</span>
                            <span>{progress}%</span>
                          </div>
                          <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: '999px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      )}
                      {dp.createdAt && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                          Creado: {new Date(dp.createdAt).toLocaleDateString('es-CL')}
                        </div>
                      )}

                      {/* Expandable actions */}
                      {totalActions > 0 && (
                        <>
                          <button
                            onClick={() => setExpandedPlan(isExpanded ? null : (dp.id || i.toString()))}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600,
                              padding: '0.35rem 0', marginTop: '0.5rem',
                              display: 'flex', alignItems: 'center', gap: '0.3rem',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                              style={{ transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                            {isExpanded ? 'Ocultar acciones' : 'Ver acciones'}
                          </button>
                          {isExpanded && (
                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {actions.map((action: any, ai: number) => {
                                const actionStatusColors: Record<string, string> = { pendiente: 'var(--text-muted)', en_progreso: '#f59e0b', completed: 'var(--success)', completada: 'var(--success)', cancelada: 'var(--danger)' };
                                const actionStatusLabels: Record<string, string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', completed: 'Completada', completada: 'Completada', cancelada: 'Cancelada' };
                                const isDone = action.status === 'completed' || action.status === 'completada';
                                return (
                                  <div key={ai} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.5rem 0.75rem', background: 'var(--bg-base)',
                                    borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.82rem',
                                  }}>
                                    <span style={{
                                      width: '18px', height: '18px', borderRadius: '50%',
                                      border: isDone ? 'none' : '2px solid var(--border)',
                                      background: isDone ? 'var(--success)' : 'transparent',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      flexShrink: 0,
                                    }}>
                                      {isDone && (
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                      )}
                                    </span>
                                    <span style={{ flex: 1, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                      {action.title || action.description || `Acci\u00f3n ${ai + 1}`}
                                    </span>
                                    {action.dueDate && (
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        {new Date(action.dueDate).toLocaleDateString('es-CL')}
                                      </span>
                                    )}
                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: actionStatusColors[action.status] || 'var(--text-muted)' }}>
                                      {actionStatusLabels[action.status] || action.status}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: Objetivos ────────────────────────────────────────────── */}
      {activeTab === 'objetivos' && (
        <div className="animate-fade-up">
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
              Mis objetivos
            </h2>
            {objectives.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                No tienes objetivos asignados
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Active objectives first */}
                {activeObjectives.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                      Activos ({activeObjectives.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {activeObjectives.map((obj: any, i: number) => (
                        <ObjectiveCard key={obj.id || i} obj={obj} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Other objectives */}
                {otherObjectives.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                      Completados / Otros ({otherObjectives.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {otherObjectives.map((obj: any, i: number) => (
                        <ObjectiveCard key={obj.id || i} obj={obj} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: Reconocimientos ──────────────────────────────────────── */}
      {activeTab === 'reconocimientos' && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Points & Badges summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {/* Points card */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #c9933a 0%, #f5e4a8 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.2rem',
                }}>
                  {'\u2B50'}
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                    Puntos acumulados
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#c9933a', lineHeight: 1.1 }}>
                    {myPoints}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Acumulas puntos por reconocimientos recibidos, evaluaciones completadas, feedback y logro de objetivos.
              </div>
            </div>

            {/* Badges card */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                Insignias ganadas ({myBadges.length})
              </div>
              {myBadges.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Aun no has ganado insignias. Sigue participando para desbloquearlas.
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {myBadges.map((ub: any, i: number) => {
                    const badge = ub.badge || ub;
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.5rem 0.75rem', background: 'var(--bg-surface)',
                        borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)',
                      }}>
                        <span style={{
                          width: '32px', height: '32px', borderRadius: '50%',
                          background: badge.color || 'linear-gradient(135deg, #c9933a, #f5e4a8)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1rem',
                        }}>
                          {badge.icon || '\uD83C\uDFC5'}
                        </span>
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{badge.name}</div>
                          {badge.description && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{badge.description}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recognitions received */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
              Reconocimientos recibidos
            </h2>
            {recognitionsReceived.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                Aun no has recibido reconocimientos
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recognitionsReceived.map((r: any, i: number) => {
                  const fromName = r.fromUser ? `${r.fromUser.firstName || ''} ${r.fromUser.lastName || ''}`.trim() : 'Alguien';
                  const valueName = r.value?.name || r.competency?.name || '';
                  const reactions = r.reactions || {};
                  const reactionEntries = Object.entries(reactions).filter(([, count]) => (count as number) > 0);
                  return (
                    <div key={r.id || i} style={{
                      padding: '1rem', background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--border)',
                      borderLeft: '3px solid #c9933a',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.1rem' }}>{'\u2B50'}</span>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{fromName}</span>
                          {r.points > 0 && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c9933a', background: 'rgba(201,147,58,0.1)', padding: '0.15rem 0.4rem', borderRadius: '999px' }}>
                              +{r.points} pts
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          {valueName && <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>{valueName}</span>}
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-CL') : ''}
                          </span>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', margin: '0 0 0.35rem' }}>{r.message}</p>
                      {reactionEntries.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {reactionEntries.map(([emoji, count]) => (
                            <span key={emoji} style={{
                              fontSize: '0.75rem', padding: '0.15rem 0.4rem',
                              background: 'var(--bg-base)', borderRadius: '999px',
                              border: '1px solid var(--border)',
                            }}>
                              {emoji} {count as number}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Objective Card Component ──────────────────────────────────────────── */
function ObjectiveCard({ obj }: { obj: any }) {
  const progress = obj.progress || 0;
  const statusColors: Record<string, string> = { active: 'var(--accent)', completed: 'var(--success)', cancelled: 'var(--danger)', draft: 'var(--text-muted)' };
  const statusLabels: Record<string, string> = { active: 'Activo', completed: 'Completado', cancelled: 'Cancelado', draft: 'Borrador' };
  const keyResults = obj.keyResults || [];

  return (
    <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{obj.title}</span>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{obj.type}</span>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: statusColors[obj.status] || 'var(--text-muted)' }}>
            {statusLabels[obj.status] || obj.status}
          </span>
        </div>
      </div>
      {obj.description && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0.5rem' }}>{obj.description}</p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        <span>Progreso</span>
        <span style={{ fontWeight: 600, color: progress >= 80 ? 'var(--success)' : progress < 40 ? 'var(--danger)' : 'var(--warning)' }}>{progress}%</span>
      </div>
      <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(progress, 100)}%`, background: progress >= 80 ? 'var(--success)' : progress < 40 ? 'var(--danger)' : 'var(--warning)', borderRadius: '999px', transition: 'width 0.4s ease' }} />
      </div>

      {/* Key Results for OKR objectives */}
      {keyResults.length > 0 && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Key Results ({keyResults.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {keyResults.map((kr: any, ki: number) => {
              const krProgress = kr.progress || 0;
              return (
                <div key={ki} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    background: krProgress >= 100 ? 'var(--success)' : 'var(--bg-base)',
                    border: krProgress >= 100 ? 'none' : '2px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {krProgress >= 100 && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{kr.title || kr.description || `KR ${ki + 1}`}</span>
                  <div style={{ width: '60px', height: '4px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(krProgress, 100)}%`, background: krProgress >= 80 ? 'var(--success)' : krProgress < 40 ? 'var(--danger)' : 'var(--warning)', borderRadius: '999px' }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '32px', textAlign: 'right' }}>{krProgress}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {obj.targetDate && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Fecha objetivo: {new Date(obj.targetDate).toLocaleDateString('es-CL')}
        </div>
      )}
    </div>
  );
}
