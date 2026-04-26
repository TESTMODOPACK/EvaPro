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
import EmptyState from '@/components/EmptyState';
import EvaluationResponseViewer from '@/components/EvaluationResponseViewer';
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
  // Evaluaciones que el equipo del manager RECIBIÓ (incluye self, peer,
  // manager, direct_report, external). Backend anonimiza el evaluador
  // en peer/direct_report cuando el caller es manager.
  const [teamReceived, setTeamReceived] = useState<any[]>([]);
  const [history, setHistory] = useState<any>(null);
  const [signatureMap, setSignatureMap] = useState<Record<string, any[]>>({});

  // Tabs
  const [parentTab, setParentTab] = useState<'personal' | 'team'>('personal');
  const [personalTab, setPersonalTab] = useState<'evaluaciones' | 'feedback' | 'pdi' | 'objetivos' | 'reconocimientos' | 'clima'>('evaluaciones');
  const [teamTab, setTeamTab] = useState<'evaluaciones' | 'objetivos' | 'pdi'>('evaluaciones');

  // Filters
  // NOTA: el filtro de estado (pendientes/completadas) se eliminó cuando
  // la lista de pendientes se movió a la bandeja /dashboard/evaluaciones.
  // La pestaña Personal "Evaluaciones" ahora solo muestra: call-out a
  // bandeja + evolución + lista de recibidas + radar (todos usan cycle).
  const [evalCycleFilter, setEvalCycleFilter] = useState('');
  const [objStatusFilter, setObjStatusFilter] = useState('');
  const [objTypeFilter, setObjTypeFilter] = useState('');
  const [pdiStatusFilter, setPdiStatusFilter] = useState('');
  const [teamPdiStatusFilter, setTeamPdiStatusFilter] = useState('');
  const [teamEvalCycleFilter, setTeamEvalCycleFilter] = useState('');

  // Expandables
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  // Viewer modal de evaluaciones recibidas (ver respuestas cualitativas)
  const [viewerAssignmentId, setViewerAssignmentId] = useState<string | null>(null);
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
      // Manager/admin: evaluaciones que recibió el equipo (self, peer,
      // manager, direct_report, external). Endpoint distinto a 'completed'
      // que es solo lo que el caller hizo. El backend anonimiza
      // evaluator en peer/direct_report cuando el caller es manager.
      ...(hasTeam ? [api.evaluations.teamReceived(token).catch(() => [])] : []),
    ]).then(([hist, comp, recv, pend, fbRecv, fbGiven, plans, objs, pts, badges, wall, redemptions, teamObj, usersRes, teamRecv]) => {
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
      if (hasTeam) {
        setTeamReceived(Array.isArray(teamRecv) ? teamRecv : []);
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

  // ── Evolución por Ciclo (Opción B) ─────────────────────────────────
  // Solo toma los ÚLTIMOS 4 ciclos CERRADOS (status === 'closed'), ordenados
  // cronológicamente por endDate. Si el user tenía assignments en un ciclo
  // cerrado pero nunca completaron sus evaluaciones (avgOverall === null),
  // se muestra el ciclo como "Sin evaluación" en vez de 0.0 para no confundir
  // al usuario con una nota inexistente.
  const MAX_EVOLUTION_CYCLES = 4;
  const strictlyClosedCycles = (allCycles || []).filter((c: any) => c.status === 'closed');
  const scoreByCycleId = new Map<string, number | null>();
  for (const h of cycles) scoreByCycleId.set(h.cycleId, h.avgOverall ?? null);
  const evolutionCycles = [...strictlyClosedCycles]
    .sort((a: any, b: any) => {
      const aT = new Date(a.endDate || a.startDate || 0).getTime();
      const bT = new Date(b.endDate || b.startDate || 0).getTime();
      return aT - bT; // ASC — más antiguo primero, evolución se lee de izquierda a derecha
    })
    .slice(-MAX_EVOLUTION_CYCLES)
    .map((c: any) => ({
      cycleId: c.id,
      cycleName: c.name,
      endDate: c.endDate,
      avgOverall: scoreByCycleId.get(c.id) ?? null,
    }));

  // Personal evaluations: where I'm the evaluatee (received endpoint)
  const myEvaluationsReceived = received;
  // Pending = evaluations I need to complete (as evaluator) — ALL go to personal tab
  const myPendingEvals = pending;

  // El header KPI "Eval. completadas" y el tab Evaluaciones consumen
  // teamReceived (evaluaciones que el equipo recibe — incluye self,
  // peer, manager, direct_report, external). Coincide en numero con
  // el dashboard /dashboard cuando el caller es manager.
  // Las anteriores variables teamCompletedEvals / otherCompletedEvals
  // / etc. se eliminaron porque mostraban Carlos como evaluador
  // (scope distinto), lo cual generaba inconsistencia entre dashboard
  // y mi-desempeno. La info "Carlos como evaluador" sigue accesible
  // en la bandeja /dashboard/evaluaciones.

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

      {/* G5: Mini widget de logros recientes — visible cuando hay badges */}
      {myBadges.length > 0 && (
        <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
          <div className="card" style={{ padding: '0.85rem 1.15rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto' }}>
              <span style={{ fontSize: '1.5rem' }}>🏅</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.15rem' }}>
                {myBadges.length} badge{myBadges.length !== 1 ? 's' : ''} obtenido{myBadges.length !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {(myBadges as any[]).slice(0, 5).map((ub: any) => (
                  <span
                    key={ub.id}
                    title={`${ub.badge?.name || 'Badge'} — ${ub.earnedAt ? new Date(ub.earnedAt).toLocaleDateString('es-CL') : ''}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.15rem 0.5rem',
                      background: 'rgba(99,102,241,0.08)',
                      borderRadius: '999px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: ub.badge?.color || '#6366f1',
                    }}
                  >
                    {ub.badge?.icon || '⭐'} {ub.badge?.name || 'Badge'}
                  </span>
                ))}
                {myBadges.length > 5 && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{myBadges.length - 5} más</span>
                )}
              </div>
            </div>
            <a
              href="/dashboard/reconocimientos"
              style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Ver logros →
            </a>
          </div>
        </div>
      )}

      {/* KPI Row: Team (only manager/admin) */}
      {hasTeam && (
        <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Mi Equipo</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
            <KPI label="Miembros" value={teamMemberCount} />
            <KPI
              label="Eval. completadas"
              value={teamReceived.length}
              sub={(() => {
                // Breakdown por tipo de relacion (consistente con el footer
                // del tab Evaluaciones). Muestra solo los tipos > 0.
                const byType: Record<string, number> = {};
                for (const ev of teamReceived) {
                  const t = ev.relationType || 'other';
                  byType[t] = (byType[t] || 0) + 1;
                }
                const labels: Record<string, string> = {
                  self: 'autoeval',
                  manager: 'jefe',
                  peer: 'pares',
                  direct_report: 'subord.',
                  external: 'externas',
                };
                return Object.entries(byType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => `${count} ${labels[type] || type}`)
                  .join(' · ') || undefined;
              })()}
            />
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
              {/* ── Call-out a la bandeja (cuando hay pendientes) ─────────
                  La lista detallada de pendientes vive ahora solo en
                  /dashboard/evaluaciones para evitar duplicación. Esta
                  tarjeta da visibilidad inmediata + acceso directo. */}
              {myPendingEvals.length > 0 && (
                <div
                  className="card animate-fade-up"
                  style={{
                    padding: '0.85rem 1rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    borderLeft: '4px solid var(--warning)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--warning)' }}>
                      {'📋'} Tienes {myPendingEvals.length} evaluación{myPendingEvals.length !== 1 ? 'es' : ''} pendiente{myPendingEvals.length !== 1 ? 's' : ''} por responder
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.4 }}>
                      Respóndelas desde la bandeja para acceder a búsqueda, urgencia, filtros por tipo de relación y orden.
                    </div>
                  </div>
                  <a
                    href="/dashboard/evaluaciones"
                    className="btn-primary"
                    style={{ fontSize: '0.78rem', padding: '0.45rem 0.95rem', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}
                  >
                    Ir a la bandeja →
                  </a>
                </div>
              )}

              {/* ── Evolución por Ciclo (ARRIBA de los filtros) ───────────
                  Vista histórica, no se afecta por los filtros de abajo.
                  Muestra los últimos 4 ciclos cerrados con tu promedio. */}
              {evolutionCycles.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                    <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>Evolución por Ciclo</h3>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.02em' }}>
                      Últimos {MAX_EVOLUTION_CYCLES} ciclos cerrados
                    </span>
                  </div>
                  <p style={{ margin: '0 0 0.9rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    Promedio general que obtuviste en cada ciclo de evaluación ya cerrado. Te permite ver tu evolución a lo largo del tiempo.
                    Solo se consideran ciclos que han sido formalmente cerrados; los ciclos en curso no aparecen porque todavía pueden cambiar.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    {evolutionCycles.map((c) => {
                      const hasScore = c.avgOverall != null && Number.isFinite(Number(c.avgOverall));
                      const score = hasScore ? Number(c.avgOverall) : null;
                      const level = score != null ? getScaleLevel(score) : null;
                      const barColor = level?.color || 'var(--border)';
                      const barWidth = score != null ? `${(score / 10) * 100}%` : '0%';
                      return (
                        <div key={c.cycleId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ minWidth: 180, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {c.cycleName}
                            {c.endDate && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                                {new Date(c.endDate).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', opacity: hasScore ? 1 : 0.45 }}>
                            <div style={{ height: '100%', width: barWidth, background: barColor, borderRadius: 4, transition: 'width 0.35s ease' }} />
                          </div>
                          <div style={{ minWidth: 90, textAlign: 'right' }}>
                            {hasScore ? (
                              <ScoreBadge score={score} size="sm" />
                            ) : (
                              <span
                                title="Este ciclo se cerró pero no tienes evaluaciones completadas en él. Puede ser porque no fuiste incluido/a o no hubo evaluadores asignados."
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  color: 'var(--text-muted)',
                                  background: 'rgba(148,163,184,0.12)',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '999px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Sin evaluación
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Filters — solo ciclo (filtra recibidas + alimenta radar) */}
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ciclo:</span>
                <select style={selectStyle} value={evalCycleFilter} onChange={(e) => setEvalCycleFilter(e.target.value)}>
                  <option value="">Todos los ciclos</option>
                  {closedCycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* La lista detallada de Evaluaciones Pendientes se eliminó
                  de aquí — vive en /dashboard/evaluaciones (bandeja). El
                  call-out arriba lleva al usuario allá. */}

              {/* Recibidas — evaluaciones en las que YO fui evaluado/a.
                  Esta vista NO está duplicada en la bandeja: es la única
                  forma del usuario de leer qué le escribieron sus
                  evaluadores (abre EvaluationResponseViewer). */}
              {(() => {
                const receivedFiltered = myEvaluationsReceived.filter((ev: any) => !evalCycleFilter || ev.cycleId === evalCycleFilter);
                return receivedFiltered.length > 0 && (
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
                                <tr
                                  key={i}
                                  onClick={() => setViewerAssignmentId(ev.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setViewerAssignmentId(ev.id);
                                    }
                                  }}
                                  tabIndex={0}
                                  role="button"
                                  aria-label={`Ver respuestas de ${evaluatorName}`}
                                  style={{ cursor: 'pointer' }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, rgba(0,0,0,0.03))'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
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

              {/* Nota: el bloque "Evolución por Ciclo" se movió ARRIBA de los
                  filtros al comienzo de la pestaña "Mis Evaluaciones" para dar
                  contexto antes de ver los detalles. Ver arriba. */}

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
                <div className="card">
                  <EmptyState
                    icon="📘"
                    title="Aún no tienes planes de desarrollo"
                    description="Un plan de desarrollo (PDI) te ayuda a organizar tus objetivos de aprendizaje y crecimiento profesional. Habla con tu jefatura para crear el primero."
                    ctaLabel="Ver mi perfil"
                    ctaHref="/dashboard/perfil"
                  />
                </div>
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
              { id: 'evaluaciones' as const, label: `Evaluaciones (${teamReceived.length})` },
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

          {/* ─── Team Evaluaciones ─── Vista 360 RECIBIDA por el equipo
              (no lo que el manager hizo). Agrupa por evaluatee y muestra
              quién lo evaluó (con anonimato en peer/direct_report — eso
              lo hace el backend antes de enviar para que la identidad
              nunca llegue al frontend). */}
          {teamTab === 'evaluaciones' && (
            <div className="animate-fade-up">
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select style={selectStyle} value={teamEvalCycleFilter} onChange={(e) => setTeamEvalCycleFilter(e.target.value)}>
                  <option value="">Todos los ciclos</option>
                  {closedCycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {teamReceived.filter((ev: any) => !teamEvalCycleFilter || ev.cycleId === teamEvalCycleFilter).length} evaluaciones recibidas por el equipo
                </span>
              </div>

              {/* Lista agrupada por miembro del equipo. El backend ya
                  filtró por managerId (solo directos del caller cuando
                  es manager) y anonimizó evaluador en peer/direct_report. */}
              {(() => {
                const filtered = teamReceived.filter((ev: any) =>
                  !teamEvalCycleFilter || ev.cycleId === teamEvalCycleFilter
                );

                if (filtered.length === 0) {
                  return (
                    <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      Sin evaluaciones recibidas por tu equipo {teamEvalCycleFilter ? 'en el ciclo seleccionado' : 'aún'}.
                    </div>
                  );
                }

                // Conteo por relationType para el footer
                const byType: Record<string, number> = {};
                for (const ev of filtered) {
                  const t = ev.relationType || 'other';
                  byType[t] = (byType[t] || 0) + 1;
                }

                // Agrupar por evaluatee (miembro del equipo)
                const byPerson: Record<string, { name: string; dept: string; items: any[] }> = {};
                for (const ev of filtered) {
                  const eid = ev.evaluateeId || 'unknown';
                  const ename = ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : '--';
                  const dept = ev.evaluatee?.department || '';
                  if (!byPerson[eid]) byPerson[eid] = { name: ename, dept, items: [] };
                  byPerson[eid].items.push(ev);
                }

                // Helper: render del evaluador respetando anonimato.
                // Backend null-ifica evaluator/evaluatorId en peer y
                // direct_report cuando el caller es manager — aquí
                // mostramos "Anónimo" en ese caso para preservar la
                // psychological safety del feedback.
                const renderEvaluator = (ev: any): string => {
                  const isAnonymized = !ev.evaluator && (ev.relationType === 'peer' || ev.relationType === 'direct_report');
                  if (isAnonymized) return 'Anónimo';
                  if (ev.relationType === 'self') return 'Autoevaluación';
                  if (ev.evaluator) return `${ev.evaluator.firstName || ''} ${ev.evaluator.lastName || ''}`.trim() || '--';
                  return '--';
                };

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Evaluaciones recibidas por tu equipo ({filtered.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {Object.entries(byPerson).map(([eid, { name, dept, items }]) => (
                          <div key={eid} className="card" style={{ padding: '0.75rem 1rem' }}>
                            <button
                              onClick={() => setExpandedTeamMember(expandedTeamMember === `recv-${eid}` ? null : `recv-${eid}`)}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                            >
                              <span style={{ fontSize: '0.7rem', transition: 'transform 0.15s', transform: expandedTeamMember === `recv-${eid}` ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{name}</span>
                              {dept && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {dept}</span>}
                              <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{items.length} eval. recibidas</span>
                            </button>
                            {expandedTeamMember === `recv-${eid}` && (
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
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((ev: any, j: number) => {
                                        const evaluatorLabel = renderEvaluator(ev);
                                        const isAnon = evaluatorLabel === 'Anónimo';
                                        return (
                                          <tr key={j}>
                                            <td style={{ fontSize: '0.82rem', fontStyle: isAnon ? 'italic' : 'normal', color: isAnon ? 'var(--text-muted)' : 'inherit' }}>
                                              {isAnon && '🔒 '}{evaluatorLabel}
                                            </td>
                                            <td><span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{relLabel[ev.relationType] || ev.relationType}</span></td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.cycle?.name || '--'}</td>
                                            <td><ScoreBadge score={ev.response?.overallScore} size="sm" /></td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-CL') : '--'}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Footer: desglose por tipo de relación. Útil para que
                        el manager entienda qué tipo de feedback está
                        recibiendo su equipo (mucho self vs poco peer
                        sugiere ciclo a medio camino, etc.). */}
                    {(() => {
                      const labels: Record<string, string> = {
                        self: 'autoevaluacion',
                        manager: 'del jefe',
                        peer: 'de pares',
                        direct_report: 'de subordinados',
                        external: 'externas',
                      };
                      const parts = Object.entries(byType)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => `${count} ${labels[type] || type}`);
                      const hasAnonymized = (byType['peer'] || 0) + (byType['direct_report'] || 0) > 0;
                      return (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.65rem 0.25rem 0', borderTop: '1px solid var(--border)', marginTop: '0.25rem' }}>
                          <strong style={{ color: 'var(--text-secondary)' }}>Total: {filtered.length}</strong>
                          {' · '}{parts.join(' · ')}
                          {hasAnonymized && (
                            <span style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem' }}>
                              🔒 El nombre del evaluador en evaluaciones de pares y subordinados se mantiene anónimo para preservar la confianza del feedback. RRHH (admin) sí ve el detalle completo.
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
                  <div className="card">
                    <EmptyState
                      icon="📘"
                      title="Tu equipo aún no tiene planes de desarrollo"
                      description="Un PDI ayuda a tus colaboradores a organizar su crecimiento. Comienza creándoles uno desde la ficha de cada persona."
                      compact
                    />
                  </div>
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

      {/* Modal de lectura de respuestas — se abre al clickear una fila de
          "Evaluaciones Recibidas" para ver qué respondió cada evaluador. */}
      <EvaluationResponseViewer
        assignmentId={viewerAssignmentId}
        onClose={() => setViewerAssignmentId(null)}
      />
    </div>
  );
}
