'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge } from '@/components/ScoreBadge';
import CompetencyRadarChart from '@/components/CompetencyRadarChart';
import SelfVsOthersChart from '@/components/SelfVsOthersChart';
import GapAnalysisChart from '@/components/GapAnalysisChart';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { SignatureBadge } from '@/components/SignatureModal';
import { NextActionsWidget } from '@/components/NextActionsWidget';
import { FirstVisitTip } from '@/components/FirstVisitTip';
import { getScaleLevel } from '@/lib/scales';
import { useCycles } from '@/hooks/useCycles';
import { useGapAnalysisIndividual, useCompetencyRadar } from '@/hooks/useReports';

function Spinner() { return <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><span className="spinner" /></div>; }

function GapSection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data } = useGapAnalysisIndividual(cycleId, userId);
  if (!data) return null;
  return <GapAnalysisChart data={data} />;
}

function CompetencyInsights({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data } = useCompetencyRadar(cycleId, userId);
  if (!data?.sections?.length || data.sections.length < 2) return null;
  const sorted = [...data.sections].sort((a: any, b: any) => (b.overall || 0) - (a.overall || 0));
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  if (!strongest || !weakest) return null;
  return (
    <div className="card animate-fade-up" style={{ padding: '1rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
      <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--accent)' }}>Insights de Competencias</h4>
      <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <p>{'🟢'} Tu competencia más fuerte: <strong style={{ color: '#10b981' }}>{strongest.section}</strong> ({Number(strongest.overall || 0).toFixed(1)})</p>
        <p>{'🔴'} Tu área de mejora: <strong style={{ color: '#ef4444' }}>{weakest.section}</strong> ({Number(weakest.overall || 0).toFixed(1)})</p>
      </div>
      <a href={`/dashboard/desarrollo?competency=${encodeURIComponent(weakest.section)}`}
        className="btn-ghost" style={{ fontSize: '0.78rem', marginTop: '0.5rem', display: 'inline-block' }}>
        Crear acción de desarrollo →
      </a>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = { padding: '0.45rem 0.7rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' };
const labelStyle: React.CSSProperties = { fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.15rem' };
const relLabel: Record<string, string> = { self: 'Autoevaluación', manager: 'Jefatura', peer: 'Par', direct_report: 'Reporte directo' };
const objStatusLabels: Record<string, string> = { active: 'Activo', completed: 'Completado', draft: 'Borrador', pending_approval: 'Pendiente', abandoned: 'Abandonado' };
const objTypeLabels: Record<string, string> = { OKR: 'OKR', KPI: 'KPI', SMART: 'SMART' };
const pdiStatusLabels: Record<string, string> = { borrador: 'Borrador', pendiente_aprobacion: 'Pendiente', aprobado: 'Aprobado', activo: 'Activo', completado: 'Completado', cancelado: 'Cancelado' };
const pdiStatusColors: Record<string, string> = { borrador: '#94a3b8', activo: '#6366f1', completado: '#10b981', cancelado: '#ef4444', pendiente_aprobacion: '#f59e0b', aprobado: '#22c55e' };

function KPI({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

// ─── Objective Card ──────────────────────────────────────────────────

function ObjectiveCard({ obj, showDetail }: { obj: any; showDetail?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = obj.status === 'completed' ? '#10b981' : obj.status === 'active' ? '#6366f1' : obj.status === 'abandoned' ? '#ef4444' : '#94a3b8';
  return (
    <div style={{ padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{obj.title}</span>
          <span className="badge badge-ghost" style={{ fontSize: '0.65rem' }}>{objTypeLabels[obj.type] || obj.type}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: `${statusColor}15`, color: statusColor }}>{objStatusLabels[obj.status] || obj.status}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: statusColor }}>{obj.progress || 0}%</span>
          {showDetail !== false && (
            <button className="btn-ghost" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Ocultar' : 'Ver detalle'}
            </button>
          )}
        </div>
      </div>
      <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${obj.progress || 0}%`, background: statusColor, borderRadius: 3 }} />
      </div>
      {expanded && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {obj.description && <p style={{ margin: '0 0 0.3rem' }}>{obj.description}</p>}
          {obj.targetDate && <p style={{ margin: '0 0 0.3rem', color: 'var(--text-muted)' }}>Fecha meta: {new Date(obj.targetDate).toLocaleDateString('es-CL')}</p>}
          {obj.keyResults?.length > 0 && (
            <div style={{ marginTop: '0.3rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Resultados Clave:</div>
              {obj.keyResults.map((kr: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
                  <div style={{ width: 50, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${kr.progress || 0}%`, background: '#6366f1', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.75rem' }}>{kr.title || kr.description} — {kr.progress || 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function MiDesempenoPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const role = user?.role || 'employee';
  const isManager = role === 'manager';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const hasTeam = isManager || isAdmin;

  // Data
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [feedbackReceived, setFeedbackReceived] = useState<any[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<any[]>([]);
  const [devPlans, setDevPlans] = useState<any[]>([]);
  const [objectives, setObjectives] = useState<any[]>([]);
  const [myPoints, setMyPoints] = useState<any>(null);
  const [myBadges, setMyBadges] = useState<any[]>([]);
  const [recognitionsReceived, setRecognitionsReceived] = useState<any[]>([]);
  const [myRedemptions, setMyRedemptions] = useState<any[]>([]);
  const [pendingSurveys, setPendingSurveys] = useState<any[]>([]);
  const [teamObjectives, setTeamObjectives] = useState<any>(null);
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<any>(null);
  const [signatureMap, setSignatureMap] = useState<Record<string, any[]>>({});

  // Tabs
  const [parentTab, setParentTab] = useState<'personal' | 'team'>('personal');
  const [personalTab, setPersonalTab] = useState<'evaluaciones' | 'feedback' | 'pdi' | 'objetivos' | 'reconocimientos' | 'clima'>('evaluaciones');
  const [teamTab, setTeamTab] = useState<'evaluaciones' | 'objetivos' | 'pdi'>('evaluaciones');

  // Filters
  const [evalStatusFilter, setEvalStatusFilter] = useState('');
  const [evalCycleFilter, setEvalCycleFilter] = useState('');
  const [objStatusFilter, setObjStatusFilter] = useState('');
  const [objTypeFilter, setObjTypeFilter] = useState('');
  const [pdiStatusFilter, setPdiStatusFilter] = useState('');
  const [teamPdiStatusFilter, setTeamPdiStatusFilter] = useState('');
  const [teamEvalCycleFilter, setTeamEvalCycleFilter] = useState('');

  // Expandables
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [expandedTeamMember, setExpandedTeamMember] = useState<string | null>(null);
  const [expandedFbRecipient, setExpandedFbRecipient] = useState<string | null>(null);
  // signModal removed — was dead code (setSignModal never called with value)

  // Cycles for filter
  const { data: allCycles } = useCycles();
  const closedCycles = (allCycles || []).filter((c: any) => c.status === 'closed' || c.status === 'active');

  // Load data
  useEffect(() => {
    if (!token || !user?.userId) return;
    setLoading(true);
    Promise.all([
      api.reports.performanceHistory(token, user.userId).catch(() => null),
      api.evaluations.completed(token).catch(() => []),
      api.evaluations.received(token).catch(() => []),
      api.evaluations.pending(token).catch(() => []),
      api.feedback.receivedFeedback(token).catch(() => []),
      api.feedback.givenFeedback(token).catch(() => []),
      api.development.plans.list(token).catch(() => []),
      api.objectives.list(token).catch(() => []),
      api.recognition.myPoints(token).catch(() => ({ total: 0 })),
      api.recognition.myBadges(token).catch(() => []),
      api.recognition.wall(token, 1, 50).catch(() => []),
      api.recognition.myRedemptions(token).catch(() => []),
      ...(hasTeam ? [api.objectives.teamSummary(token).catch(() => null)] : []),
      ...(hasTeam ? [api.users.list(token, 1, 500).catch(() => ({ data: [] }))] : []),
    ]).then(([hist, comp, recv, pend, fbRecv, fbGiven, plans, objs, pts, badges, wall, redemptions, teamObj, usersRes]) => {
      setHistory(hist);
      setCompleted(Array.isArray(comp) ? comp : []);
      setReceived(Array.isArray(recv) ? recv : []);
      setPending(Array.isArray(pend) ? pend : []);
      setFeedbackReceived(Array.isArray(fbRecv) ? fbRecv : []);
      setFeedbackGiven(Array.isArray(fbGiven) ? fbGiven : []);
      setDevPlans(Array.isArray(plans) ? plans : []);
      setObjectives(Array.isArray(objs) ? objs : []);
      setMyPoints(pts);
      setMyBadges(Array.isArray(badges) ? badges : []);
      const wallItems = Array.isArray(wall) ? wall : (wall as any)?.data || [];
      setRecognitionsReceived(wallItems.filter((r: any) => r.toUser?.id === user.userId || r.toUserId === user.userId));
      setMyRedemptions(Array.isArray(redemptions) ? redemptions : []);
      if (teamObj) setTeamObjectives(teamObj);
      // Build team member IDs set for filtering
      if (usersRes && hasTeam) {
        const allU = Array.isArray(usersRes) ? usersRes : usersRes?.data || [];
        const directReports = allU.filter((u: any) => u.managerId === user.userId && u.isActive);
        setTeamMemberIds(new Set(directReports.map((u: any) => u.id)));
      }
    }).finally(() => setLoading(false));
    // Load pending climate surveys separately (no need to block main load)
    api.surveys.getMyPending(token).then((s) => setPendingSurveys(Array.isArray(s) ? s : [])).catch(() => {});
  }, [token, user?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load signatures
  useEffect(() => {
    if (!token || (completed.length === 0 && received.length === 0)) return;
    const loadSigs = async () => {
      const map: Record<string, any[]> = {};
      for (const ev of [...completed, ...received]) {
        const respId = ev.response?.id || ev.responseId;
        if (!respId || map[respId]) continue;
        try {
          const sigs = await api.signatures.list(token, 'evaluation_response', respId);
          if (sigs?.length) map[respId] = sigs;
        } catch {}
      }
      setSignatureMap(map);
    };
    loadSigs();
  }, [completed.length, received.length, token]);

  if (loading) return <PageSkeleton cards={5} tableRows={6} />;

  // Derived data
  const myUserId = user?.userId;
  const cycles = history?.cycles || history?.history || [];
  // Find the most recent cycle WITH a score (skip cycles with null avgOverall)
  const cyclesWithScore = cycles.filter((c: any) => c.avgOverall != null && !isNaN(Number(c.avgOverall)));
  const latestScore = cyclesWithScore.length > 0 ? cyclesWithScore[cyclesWithScore.length - 1] : null;
  const previousScore = cyclesWithScore.length > 1 ? cyclesWithScore[cyclesWithScore.length - 2] : null;
  const displayScore = latestScore?.avgOverall ?? null;
  const scoreDelta = displayScore != null && previousScore?.avgOverall != null
    ? Number(displayScore) - Number(previousScore.avgOverall)
    : null;

  // Personal evaluations: where I'm the evaluatee (received endpoint)
  const myEvaluationsReceived = received;
  // Pending = evaluations I need to complete (as evaluator) — ALL go to personal tab
  const myPendingEvals = pending;

  // Team evaluations — strictly filter by direct reports only
  const teamCompletedEvals = completed.filter((e: any) =>
    e.evaluateeId !== myUserId &&
    e.evaluatee?.role !== 'tenant_admin' &&
    teamMemberIds.has(e.evaluateeId)
  );

  // My objectives vs team objectives (backend already filters by manager for managers)
  const myObjectives = objectives.filter((o: any) => o.userId === myUserId);
  const myDevPlans = devPlans.filter((p: any) => p.userId === myUserId);
  const teamDevPlans = devPlans.filter((p: any) =>
    p.userId !== myUserId &&
    p.user?.role !== 'tenant_admin' &&
    teamMemberIds.has(p.userId)
  );

  // KPIs
  const myActiveObj = myObjectives.filter((o: any) => o.status === 'active').length;
  const myActiveDevPlans = myDevPlans.filter((p: any) => p.status === 'activo').length;
  const teamMemberCount = teamObjectives?.totals?.totalMembers || teamDevPlans.length || 0;
  const teamActiveObj = teamObjectives?.totals?.totalObjectives || 0;
  const teamActivePdi = teamDevPlans.filter((p: any) => p.status === 'activo').length;

  // Tab styles
  const parentTabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.65rem 1.25rem', fontSize: '0.88rem', fontWeight: active ? 700 : 500,
    color: active ? '#fff' : 'var(--text-secondary)',
    background: active ? 'var(--accent)' : 'var(--bg-surface)',
    border: active ? 'none' : '1px solid var(--border)',
    borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer',
  });
  const subTabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 0.85rem', fontSize: '0.8rem', fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`, marginBottom: '-1px',
  });

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <FirstVisitTip
        id="mi-desempeno"
        icon="📊"
        title="Tu panel de desempeño"
        description="Aquí encuentras tu historial de evaluaciones, feedback recibido, planes de desarrollo y objetivos. Usa las pestañas para navegar entre secciones. El radar muestra tus competencias evaluadas por diferentes perspectivas."
      />

      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Mi Desempeño</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {hasTeam ? 'Tu rendimiento individual y el de tu equipo.' : 'Tu rendimiento, feedback, objetivos y desarrollo profesional.'}
        </p>
      </div>

      {/* KPI Row: Personal */}
      <div className="animate-fade-up" style={{ marginBottom: hasTeam ? '0.75rem' : '1.25rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Mi Resumen</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
          <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
            <div style={labelStyle}>Último puntaje</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: displayScore != null ? getScaleLevel(Number(displayScore))?.color : 'var(--text-primary)' }}>
              {displayScore != null ? Number(displayScore).toFixed(1) : '--'}
              {scoreDelta != null && scoreDelta !== 0 && (
                <span style={{ fontSize: '0.7rem', fontWeight: 700, marginLeft: '0.35rem', color: scoreDelta > 0 ? '#10b981' : '#ef4444' }}>
                  {scoreDelta > 0 ? '+' : ''}{scoreDelta.toFixed(1)} {scoreDelta > 0 ? '↑' : '↓'}
                </span>
              )}
            </div>
            {displayScore != null && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{getScaleLevel(Number(displayScore))?.label}</div>}
          </div>
          <KPI label="Pendientes" value={myPendingEvals.length} color={myPendingEvals.length > 0 ? '#f59e0b' : '#10b981'} />
          <KPI label="Feedback" value={feedbackReceived.length} />
          <KPI label="Objetivos" value={`${myActiveObj} act.`} />
          <KPI label="Puntos" value={myPoints?.yearPoints ?? myPoints?.total ?? 0} sub={`${myBadges.length} badges`} />
        </div>
      </div>

      {/* KPI Row: Team (only manager/admin) */}
      {hasTeam && (
        <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Mi Equipo</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
            <KPI label="Miembros" value={teamMemberCount} />
            <KPI label="Eval. completadas" value={teamCompletedEvals.length} />
            <KPI label="Objetivos equipo" value={`${teamActiveObj} act.`} />
            <KPI label="PDI equipo" value={`${teamActivePdi} act.`} />
          </div>
        </div>
      )}

      {/* Action Cards — "Qué necesita tu atención" */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
        <NextActionsWidget />
      </div>

      {/* Parent Tabs (only manager/admin) */}
      {hasTeam && (
        <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <button style={parentTabStyle(parentTab === 'personal')} onClick={() => setParentTab('personal')}>
            {'👤'} Mi Desempeño
          </button>
          <button style={parentTabStyle(parentTab === 'team')} onClick={() => setParentTab('team')}>
            {'👥'} Mi Equipo
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PERSONAL TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(parentTab === 'personal' || !hasTeam) && (
        <>
          {/* Sub-tabs */}
          <div className="animate-fade-up" style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            {[
              { id: 'evaluaciones' as const, label: `Mis Evaluaciones (${myEvaluationsReceived.length})` },
              { id: 'feedback' as const, label: `Mi Feedback (${feedbackReceived.length})` },
              { id: 'pdi' as const, label: `Planes de Desarrollo (${myDevPlans.length})` },
              { id: 'objetivos' as const, label: `Mis Objetivos (${myObjectives.length})` },
              { id: 'reconocimientos' as const, label: `Reconocimientos` },
              { id: 'clima' as const, label: `Encuestas de Clima` },
            ].map(tab => (
              <button key={tab.id} style={subTabStyle(personalTab === tab.id)} onClick={() => setPersonalTab(tab.id)}>{tab.label}</button>
            ))}
          </div>

          {/* ─── Mis Evaluaciones ─── */}
          {personalTab === 'evaluaciones' && (
            <div className="animate-fade-up">
              {/* Filters */}
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select style={selectStyle} value={evalStatusFilter} onChange={(e) => setEvalStatusFilter(e.target.value)}>
                  <option value="">Todos los estados</option>
                  <option value="pending">Pendientes</option>
                  <option value="completed">Completadas</option>
                </select>
                <select style={selectStyle} value={evalCycleFilter} onChange={(e) => setEvalCycleFilter(e.target.value)}>
                  <option value="">Todos los ciclos</option>
                  {closedCycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Pending — collapsible */}
              {(() => {
                const pendingFiltered = myPendingEvals.filter((ev: any) => !evalCycleFilter || ev.cycleId === evalCycleFilter);
                return pendingFiltered.length > 0 && evalStatusFilter !== 'completed' && (
                <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--warning)' }}>
                  <button onClick={() => setExpandedPlan(expandedPlan === 'pending-evals' ? null : 'pending-evals')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0', textAlign: 'left' }}>
                    <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedPlan === 'pending-evals' ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--warning)' }}>Evaluaciones Pendientes ({pendingFiltered.length})</span>
                  </button>
                  {expandedPlan === 'pending-evals' && (() => {
                    const byCycle: Record<string, { name: string; items: any[] }> = {};
                    for (const ev of pendingFiltered) {
                      const cid = ev.cycleId || 'sin-ciclo';
                      const cname = ev.cycle?.name || 'Sin ciclo';
                      if (!byCycle[cid]) byCycle[cid] = { name: cname, items: [] };
                      byCycle[cid].items.push(ev);
                    }
                    return (
                    <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {Object.entries(byCycle).map(([cid, { name, items }]) => (
                        <div key={cid}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem', padding: '0.2rem 0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                            {name} ({items.length})
                          </div>
                          {items.map((ev: any, j: number) => (
                            <a key={j} href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.5rem 0.4rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.82rem', textDecoration: 'none', color: 'inherit', borderRadius: '4px', transition: 'background 0.15s', cursor: 'pointer' }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : '--'}</span>
                                <span className="badge badge-accent" style={{ fontSize: '0.65rem', marginLeft: '0.4rem' }}>{relLabel[ev.relationType] || ev.relationType}</span>
                              </div>
                              <span className="btn-primary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>Responder</span>
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                    );
                  })()}
                </div>
              );
              })()}

              {/* Completed — evaluations where I was evaluated */}
              {(() => {
                const receivedFiltered = myEvaluationsReceived.filter((ev: any) => !evalCycleFilter || ev.cycleId === evalCycleFilter);
                return receivedFiltered.length > 0 && evalStatusFilter !== 'pending' && (
                <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--success)' }}>
                  <button onClick={() => setExpandedPlan(expandedPlan === 'received-evals' ? null : 'received-evals')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0', textAlign: 'left' }}>
                    <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedPlan === 'received-evals' ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--success)' }}>Evaluaciones Recibidas ({receivedFiltered.length})</span>
                  </button>
                  {expandedPlan === 'received-evals' && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div className="table-wrapper">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left' }}>Evaluador</th>
                              <th>Tipo</th>
                              <th>Ciclo</th>
                              <th>Puntaje</th>
                              <th>Fecha</th>
                              <th>Firma</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receivedFiltered.map((ev: any, i: number) => {
                              const evaluatorName = ev.evaluator ? `${ev.evaluator.firstName || ''} ${ev.evaluator.lastName || ''}`.trim() : (ev.relationType === 'self' ? 'Autoevaluación' : '--');
                              const respId = ev.response?.id || ev.responseId;
                              const sigs = respId ? signatureMap[respId] : null;
                              return (
                                <tr key={i}>
                                  <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{evaluatorName}</td>
                                  <td><span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{relLabel[ev.relationType] || ev.relationType}</span></td>
                                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.cycle?.name || '--'}</td>
                                  <td><ScoreBadge score={ev.response?.overallScore} size="sm" /></td>
                                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : '--'}</td>
                                  <td>{sigs?.length ? <SignatureBadge signatures={sigs} /> : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
              })()}

              {/* Evolution */}
              {cycles.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Evolución por Ciclo</h3>
                  {cycles.map((c: any, i: number) => {
                    const score = Number(c.avgOverall || 0);
                    const level = getScaleLevel(score);
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <div style={{ minWidth: 140, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{c.cycleName || c.name}</div>
                        <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(score / 10) * 100}%`, background: level?.color || '#94a3b8', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: level?.color, minWidth: 40 }}>{score.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Radar — usa el filtro de ciclo superior (evalCycleFilter) */}
              {closedCycles.length > 0 && (
                <div className="card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Radar de Competencias</h3>
                  {evalCycleFilter && myUserId ? (
                    <div>
                      <CompetencyRadarChart cycleId={evalCycleFilter} userId={myUserId} />
                      <SelfVsOthersChart cycleId={evalCycleFilter} userId={myUserId} />
                      <GapSection cycleId={evalCycleFilter} userId={myUserId} />
                      <CompetencyInsights cycleId={evalCycleFilter} userId={myUserId} />
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      Selecciona un ciclo en el filtro superior para visualizar tu radar de competencias.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Mi Feedback ─── */}
          {personalTab === 'feedback' && (
            <div className="animate-fade-up">
              {/* Received */}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{'📩'} Feedback dirigido a mí ({feedbackReceived.length})</h3>
                {feedbackReceived.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin feedback recibido aún.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {feedbackReceived.slice(0, 20).map((fb: any, i: number) => (
                      <div key={i} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${fb.sentiment === 'positive' ? '#10b981' : fb.sentiment === 'constructive' ? '#f59e0b' : '#94a3b8'}`, fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: 600 }}>{fb.isAnonymous ? 'Anónimo' : fb.fromUser ? `${fb.fromUser.firstName} ${fb.fromUser.lastName}` : '--'}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('es-CL') : ''}</span>
                        </div>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{fb.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Given — grouped by recipient */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{'📤'} Feedback que envié ({feedbackGiven.length})</h3>
                {feedbackGiven.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No has enviado feedback aún.</p> : (() => {
                  const byRecipient: Record<string, { name: string; items: any[] }> = {};
                  for (const fb of feedbackGiven) {
                    const rid = fb.toUserId || 'unknown';
                    const rname = fb.toUser ? `${fb.toUser.firstName} ${fb.toUser.lastName}` : '--';
                    if (!byRecipient[rid]) byRecipient[rid] = { name: rname, items: [] };
                    byRecipient[rid].items.push(fb);
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {Object.entries(byRecipient).map(([rid, { name, items }]) => (
                        <div key={rid}>
                          <button onClick={() => setExpandedFbRecipient(expandedFbRecipient === rid ? null : rid)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.4rem 0.5rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.82rem' }}>
                            <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedFbRecipient === rid ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            <span style={{ fontWeight: 600 }}>{name}</span>
                            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{items.length} feedback{items.length !== 1 ? 's' : ''}</span>
                          </button>
                          {expandedFbRecipient === rid && (
                            <div style={{ marginLeft: '1rem', borderLeft: '2px solid var(--border)', paddingLeft: '0.75rem', marginTop: '0.25rem' }}>
                              {items.map((fb: any, j: number) => (
                                <div key={j} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span className="badge badge-ghost" style={{ fontSize: '0.62rem' }}>{fb.sentiment === 'positive' ? 'Positivo' : fb.sentiment === 'constructive' ? 'Constructivo' : 'Neutral'}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('es-CL') : ''}</span>
                                  </div>
                                  <p style={{ margin: '0.15rem 0 0', color: 'var(--text-secondary)' }}>{fb.message}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ─── Mi PDI ─── */}
          {personalTab === 'pdi' && (
            <div className="animate-fade-up">
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select style={selectStyle} value={pdiStatusFilter} onChange={(e) => setPdiStatusFilter(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(pdiStatusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{myDevPlans.filter((p: any) => !pdiStatusFilter || p.status === pdiStatusFilter).length} planes</span>
              </div>
              {myDevPlans.filter((p: any) => !pdiStatusFilter || p.status === pdiStatusFilter).length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin planes de desarrollo.</div>
              ) : myDevPlans.filter((p: any) => !pdiStatusFilter || p.status === pdiStatusFilter).map((plan: any) => {
                const actions = plan.actions || [];
                const completedAct = actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length;
                return (
                  <div key={plan.id} className="card" style={{ padding: '1rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{plan.title || plan.name}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 6px', borderRadius: 3, marginLeft: '0.4rem', background: `${pdiStatusColors[plan.status] || '#94a3b8'}15`, color: pdiStatusColors[plan.status] || '#94a3b8' }}>{pdiStatusLabels[plan.status] || plan.status}</span>
                      </div>
                      <button className="btn-ghost" style={{ fontSize: '0.72rem' }} onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}>
                        {expandedPlan === plan.id ? 'Ocultar' : `Ver acciones (${completedAct}/${actions.length})`}
                      </button>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: '0.4rem' }}>
                      <div style={{ height: '100%', width: `${actions.length > 0 ? (completedAct / actions.length) * 100 : 0}%`, background: 'var(--success)', borderRadius: 3 }} />
                    </div>
                    {expandedPlan === plan.id && actions.length > 0 && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {actions.map((a: any, j: number) => (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                            <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', background: (a.status === 'completada' || a.status === 'completed') ? 'var(--success)' : 'transparent', color: '#fff' }}>
                              {(a.status === 'completada' || a.status === 'completed') ? '✓' : ''}
                            </span>
                            <span style={{ flex: 1, color: (a.status === 'completada' || a.status === 'completed') ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: (a.status === 'completada' || a.status === 'completed') ? 'line-through' : 'none' }}>{a.title || a.description}</span>
                            {a.dueDate && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(a.dueDate).toLocaleDateString('es-CL')}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Mis Objetivos ─── */}
          {personalTab === 'objetivos' && (
            <div className="animate-fade-up">
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select style={selectStyle} value={objStatusFilter} onChange={(e) => setObjStatusFilter(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(objStatusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select style={selectStyle} value={objTypeFilter} onChange={(e) => setObjTypeFilter(e.target.value)}>
                  <option value="">Todos los tipos</option>
                  {Object.entries(objTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {myObjectives.filter((o: any) => (!objStatusFilter || o.status === objStatusFilter) && (!objTypeFilter || o.type === objTypeFilter)).length} de {myObjectives.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {myObjectives.filter((o: any) => (!objStatusFilter || o.status === objStatusFilter) && (!objTypeFilter || o.type === objTypeFilter)).map((obj: any) => (
                  <ObjectiveCard key={obj.id} obj={obj} showDetail={true} />
                ))}
                {myObjectives.filter((o: any) => (!objStatusFilter || o.status === objStatusFilter) && (!objTypeFilter || o.type === objTypeFilter)).length === 0 && (
                  <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin objetivos.</div>
                )}
              </div>
            </div>
          )}

          {/* ─── Mis Reconocimientos ─── */}
          {personalTab === 'reconocimientos' && (
            <div className="animate-fade-up">
              {/* Points + Badges */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{'⭐'} Puntos</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{myPoints?.yearPoints ?? myPoints?.total ?? 0}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Puntos del año</div>
                </div>
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{'🏅'} Insignias</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{myBadges.length}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Insignias obtenidas</div>
                </div>
              </div>

              {/* Recognitions received */}
              {recognitionsReceived.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Reconocimientos Recibidos ({recognitionsReceived.length})</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {recognitionsReceived.slice(0, 10).map((r: any, i: number) => (
                      <div key={i} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--accent)', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600 }}>{r.fromUser?.firstName} {r.fromUser?.lastName}</span>
                          {r.points > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>+{r.points} pts</span>}
                        </div>
                        <p style={{ margin: '0.15rem 0 0', color: 'var(--text-secondary)' }}>{r.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Redemptions (NEW) */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{'🛒'} Beneficios Canjeados</h3>
                {myRedemptions.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No has canjeado beneficios aún.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {myRedemptions.map((r: any) => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                        <span style={{ fontWeight: 600 }}>{r.item?.name || 'Beneficio'}</span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>-{r.pointsSpent} pts</span>
                          <span className={`badge ${r.status === 'delivered' ? 'badge-success' : r.status === 'cancelled' ? 'badge-danger' : 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                            {r.status === 'delivered' ? 'Entregado' : r.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-CL') : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Encuestas de Clima ─── */}
          {personalTab === 'clima' && (
            <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Encuestas pendientes por responder — visible para TODOS los roles */}
              {pendingSurveys.length > 0 ? (
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                    {'🔔'} Encuestas Pendientes por Responder ({pendingSurveys.length})
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {pendingSurveys.map((s: any) => (
                      <div key={s.id} className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid var(--warning)' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.title}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', marginTop: '0.2rem' }}>
                            <span>{s.isAnonymous ? 'Anónima' : 'Identificada'}</span>
                            <span>Fecha límite: <strong style={{ color: 'var(--warning)' }}>{new Date(s.endDate).toLocaleDateString('es-CL')}</strong></span>
                          </div>
                        </div>
                        <a
                          href={`/dashboard/encuestas-clima/${s.id}/responder`}
                          style={{
                            padding: '0.5rem 1.25rem',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--accent)',
                            color: '#fff',
                            textDecoration: 'none',
                          }}
                        >
                          Responder
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {'✅'} No tienes encuestas de clima pendientes por responder.
                  </p>
                </div>
              )}

              {/* Info administrativa — solo para admin */}
              {isAdmin && (
                <div className="card" style={{ padding: '1.25rem', borderLeft: '3px solid var(--accent)' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{'📊'} Gestión de Encuestas</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                    Como administrador, puedes crear, gestionar y analizar encuestas de clima organizacional.
                    Los resultados incluyen el <strong>eNPS</strong> (escala −100 a +100) y análisis por categoría.
                  </p>
                  <a
                    href="/dashboard/encuestas-clima"
                    style={{
                      padding: '0.5rem 1rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--accent)',
                      color: '#fff',
                      textDecoration: 'none',
                      display: 'inline-block',
                    }}
                  >
                    Ir a Encuestas de Clima
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TEAM TAB (only manager/admin)                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {parentTab === 'team' && hasTeam && (
        <>
          {/* Sub-tabs */}
          <div className="animate-fade-up" style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
            {[
              { id: 'evaluaciones' as const, label: `Evaluaciones (${teamCompletedEvals.length})` },
              { id: 'objetivos' as const, label: `Objetivos` },
              { id: 'pdi' as const, label: `Planes de Desarrollo (${teamDevPlans.length})` },
            ].map(tab => (
              <button key={tab.id} style={subTabStyle(teamTab === tab.id)} onClick={() => setTeamTab(tab.id)}>{tab.label}</button>
            ))}
          </div>

          {/* ─── Team Alerts ─── */}
          {(() => {
            const atRiskObj = teamObjectives?.members?.reduce((sum: number, m: any) => sum + (m.atRiskCount || 0), 0) || 0;
            const today = new Date();
            const overduePdiCount = teamDevPlans.filter((p: any) =>
              (p.actions || []).some((a: any) =>
                a.status !== 'completada' && a.status !== 'completed' && a.status !== 'cancelada' &&
                a.dueDate && new Date(a.dueDate) < today
              )
            ).length;
            if (atRiskObj === 0 && overduePdiCount === 0) return null;
            return (
              <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid #ef4444', background: 'rgba(239,68,68,0.04)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.35rem', color: '#ef4444' }}>⚠️ Alertas del equipo</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {atRiskObj > 0 && <span>🎯 {atRiskObj} objetivo{atRiskObj > 1 ? 's' : ''} en riesgo</span>}
                  {overduePdiCount > 0 && <span>📋 {overduePdiCount} miembro{overduePdiCount > 1 ? 's' : ''} con acciones PDI vencidas</span>}
                </div>
              </div>
            );
          })()}

          {/* ─── Team Evaluaciones ─── */}
          {teamTab === 'evaluaciones' && (
            <div className="animate-fade-up">
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select style={selectStyle} value={teamEvalCycleFilter} onChange={(e) => setTeamEvalCycleFilter(e.target.value)}>
                  <option value="">Todos los ciclos</option>
                  {closedCycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{teamCompletedEvals.filter((ev: any) => !teamEvalCycleFilter || ev.cycleId === teamEvalCycleFilter).length} evaluaciones</span>
              </div>

              {/* Team evals — split into Direct Reports + Other Departments */}
              {(() => {
                const allFiltered = completed.filter((ev: any) => ev.evaluateeId !== myUserId && ev.evaluatee?.role !== 'tenant_admin')
                  .filter((ev: any) => !teamEvalCycleFilter || ev.cycleId === teamEvalCycleFilter);
                const directEvals = allFiltered.filter((ev: any) => teamMemberIds.has(ev.evaluateeId));
                const otherEvals = allFiltered.filter((ev: any) => !teamMemberIds.has(ev.evaluateeId));

                const renderGroup = (evals: any[], prefix: string) => {
                  const byPerson: Record<string, { name: string; dept: string; items: any[] }> = {};
                  for (const ev of evals) {
                    const eid = ev.evaluateeId || 'unknown';
                    const ename = ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : '--';
                    const dept = ev.evaluatee?.department || '';
                    if (!byPerson[eid]) byPerson[eid] = { name: ename, dept, items: [] };
                    byPerson[eid].items.push(ev);
                  }
                  return Object.entries(byPerson).map(([eid, { name, dept, items }]) => (
                    <div key={eid} className="card" style={{ padding: '0.75rem 1rem' }}>
                      <button onClick={() => setExpandedTeamMember(expandedTeamMember === `${prefix}-${eid}` ? null : `${prefix}-${eid}`)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                        <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedTeamMember === `${prefix}-${eid}` ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{name}</span>
                        {dept && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {dept}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{items.length} eval.</span>
                      </button>
                      {expandedTeamMember === `${prefix}-${eid}` && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div className="table-wrapper">
                            <table>
                              <thead><tr>
                                <th style={{ textAlign: 'left' }}>Evaluador</th>
                                <th>Tipo</th><th>Ciclo</th><th>Puntaje</th><th>Fecha</th>
                              </tr></thead>
                              <tbody>
                                {items.map((ev: any, j: number) => (
                                  <tr key={j}>
                                    <td style={{ fontSize: '0.82rem' }}>{ev.evaluator ? `${ev.evaluator.firstName} ${ev.evaluator.lastName}` : '--'}</td>
                                    <td><span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{relLabel[ev.relationType] || ev.relationType}</span></td>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.cycle?.name || '--'}</td>
                                    <td><ScoreBadge score={ev.response?.overallScore} size="sm" /></td>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : '--'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ));
                };

                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Section 1: Mi Equipo Directo */}
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                      Mi Equipo Directo ({directEvals.length} evaluaciones)
                    </div>
                    {directEvals.length === 0 ? (
                      <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin evaluaciones de tu equipo directo.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{renderGroup(directEvals, 'direct')}</div>
                    )}
                  </div>

                  {/* Section 2: Otras evaluaciones de otros departamentos */}
                  {otherEvals.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Otras evaluaciones realizadas ({otherEvals.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{renderGroup(otherEvals, 'other')}</div>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          )}

          {/* ─── Team Objetivos ─── */}
          {teamTab === 'objetivos' && (
            <div className="animate-fade-up">
              {!teamObjectives?.members?.length ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin datos de objetivos del equipo.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {teamObjectives.members.map((m: any) => (
                    <div key={m.userId} className="card" style={{ padding: '0.75rem 1rem' }}>
                      <button onClick={() => setExpandedTeamMember(expandedTeamMember === m.userId ? null : m.userId)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                        <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedTeamMember === m.userId ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{m.userName}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{m.position}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{m.totalObjectives} obj. — Prom: {m.avgProgress}%</span>
                      </button>
                      {expandedTeamMember === m.userId && (
                        <div style={{ marginTop: '0.5rem', marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {/* Load individual objectives — for now show summary */}
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem' }}>
                            <span>Activos: {m.activeCount}</span>
                            <span>Completados: {m.completedCount}</span>
                            <span>En riesgo: {m.atRiskCount}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Team PDI ─── */}
          {teamTab === 'pdi' && (
            <div className="animate-fade-up">
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select style={selectStyle} value={teamPdiStatusFilter} onChange={(e) => setTeamPdiStatusFilter(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(pdiStatusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {teamDevPlans.filter((p: any) => !teamPdiStatusFilter || p.status === teamPdiStatusFilter).length} planes
                </span>
              </div>
              {(() => {
                const filtered = teamDevPlans.filter((p: any) => !teamPdiStatusFilter || p.status === teamPdiStatusFilter);
                const byUser: Record<string, { name: string; plans: any[] }> = {};
                for (const p of filtered) {
                  const uid = p.userId || 'unknown';
                  const uname = p.user ? `${p.user.firstName} ${p.user.lastName}` : '--';
                  if (!byUser[uid]) byUser[uid] = { name: uname, plans: [] };
                  byUser[uid].plans.push(p);
                }
                return Object.keys(byUser).length === 0 ? (
                  <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin planes de desarrollo del equipo.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {Object.entries(byUser).map(([uid, { name, plans }]) => (
                      <div key={uid} className="card" style={{ padding: '0.75rem 1rem' }}>
                        <button onClick={() => setExpandedTeamMember(expandedTeamMember === `pdi-${uid}` ? null : `pdi-${uid}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                          <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedTeamMember === `pdi-${uid}` ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{name}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{plans.length} plan{plans.length !== 1 ? 'es' : ''}</span>
                        </button>
                        {expandedTeamMember === `pdi-${uid}` && (
                          <div style={{ marginTop: '0.5rem', marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {plans.map((plan: any) => {
                              const actions = plan.actions || [];
                              const doneAct = actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length;
                              return (
                                <div key={plan.id} style={{ padding: '0.5rem 0.65rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                    <span style={{ fontWeight: 600 }}>{plan.title || plan.name}</span>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: `${pdiStatusColors[plan.status] || '#94a3b8'}15`, color: pdiStatusColors[plan.status] || '#94a3b8' }}>{pdiStatusLabels[plan.status] || plan.status}</span>
                                  </div>
                                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: '0.3rem' }}>
                                    <div style={{ height: '100%', width: `${actions.length > 0 ? (doneAct / actions.length) * 100 : 0}%`, background: 'var(--success)', borderRadius: 2 }} />
                                  </div>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doneAct}/{actions.length} acciones</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}

    </div>
  );
}
