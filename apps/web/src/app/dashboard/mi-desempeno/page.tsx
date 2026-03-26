'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge, ScaleLegend } from '@/components/ScoreBadge';
import { getScaleLevel } from '@/lib/scales';

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

export default function MiDesempenoPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<any>(null);
  const [completed, setCompleted] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [cycleTypeFilter, setCycleTypeFilter] = useState('');

  // Unified history sections
  const [feedbackReceived, setFeedbackReceived] = useState<any[]>([]);
  const [devPlans, setDevPlans] = useState<any[]>([]);
  const [objectives, setObjectives] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'evaluaciones' | 'feedback' | 'pdi' | 'objetivos'>('evaluaciones');

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
    ])
      .then(([h, c, p, fb, dp, obj]) => {
        setHistory(h);
        setCompleted(Array.isArray(c) ? c : []);
        setPending(Array.isArray(p) ? p : []);
        setFeedbackReceived(Array.isArray(fb) ? fb : []);
        setDevPlans(Array.isArray(dp) ? dp : (dp as any)?.data ? (dp as any).data : []);
        setObjectives(Array.isArray(obj) ? obj : (obj as any)?.data ? (obj as any).data : []);
      })
      .finally(() => setLoading(false));
  }, [token, user?.userId, cycleTypeFilter]);

  if (loading) return <Spinner />;

  const cycles = history?.cycles || history?.history || [];
  const latestScore = cycles.length > 0 ? cycles[cycles.length - 1] : null;

  const completedWithScore = completed.filter((e: any) => e.response?.overallScore != null);
  const latestCompleted = completedWithScore.length > 0 ? completedWithScore[0] : null;
  const displayScore = latestScore?.avgOverall ?? latestCompleted?.response?.overallScore ?? null;

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

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '960px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {'Mi Desempe\u00f1o'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {'Tu historial completo: evaluaciones, feedback, desarrollo y objetivos'}
        </p>
      </div>

      {/* Current score + pending */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
            {objectives.filter((o: any) => o.status === 'active').length}
          </div>
        </div>
      </div>

      {/* Scale legend */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Tab navigation */}
      <div className="animate-fade-up-delay-2" style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
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
        </>
      )}

      {/* ─── TAB: Feedback ─────────────────────────────────────────────── */}
      {activeTab === 'feedback' && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
            Feedback recibido
          </h2>
          {feedbackReceived.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              Aun no has recibido feedback
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {feedbackReceived.slice(0, 20).map((fb: any, i: number) => (
                <div key={i} style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {fb.isAnonymous ? 'An\u00f3nimo' : fb.fromUser ? `${fb.fromUser.firstName} ${fb.fromUser.lastName}` : 'An\u00f3nimo'}
                    </span>
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: PDI / Desarrollo ─────────────────────────────────────── */}
      {activeTab === 'pdi' && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
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
                const completedActions = actions.filter((a: any) => a.status === 'completed').length;
                const totalActions = actions.length;
                const progress = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;
                const statusColors: Record<string, string> = { borrador: 'var(--text-muted)', activo: 'var(--accent)', en_revision: '#f59e0b', completado: 'var(--success)', cancelado: 'var(--danger)' };
                const statusLabels: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', en_revision: 'En revision', completado: 'Completado', cancelado: 'Cancelado' };
                return (
                  <div key={i} style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{dp.title || dp.name || `Plan #${i + 1}`}</span>
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: Objetivos ────────────────────────────────────────────── */}
      {activeTab === 'objetivos' && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
            Mis objetivos
          </h2>
          {objectives.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              No tienes objetivos asignados
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {objectives.map((obj: any, i: number) => {
                const progress = obj.progress || 0;
                const statusColors: Record<string, string> = { active: 'var(--accent)', completed: 'var(--success)', cancelled: 'var(--danger)', draft: 'var(--text-muted)' };
                const statusLabels: Record<string, string> = { active: 'Activo', completed: 'Completado', cancelled: 'Cancelado', draft: 'Borrador' };
                return (
                  <div key={i} style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)' }}>
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
                    {obj.targetDate && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        Fecha objetivo: {new Date(obj.targetDate).toLocaleDateString('es-CL')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
