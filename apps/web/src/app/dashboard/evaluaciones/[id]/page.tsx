'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  useCycleById,
  useCycleAssignments,
  useLaunchCycle,
  useCloseCycle,
} from '@/hooks/useCycles';
import { usePeerAssignments, useAddPeerAssignment, useRemovePeerAssignment } from '@/hooks/usePeerAssignments';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  relationTypeLabel as relationLabels,
  assignmentStatusBadge as statusBadge,
  assignmentStatusLabel as statusLabels,
  cycleStatusBadge,
  cycleStatusLabel as cycleStatusLabels,
} from '@/lib/statusMaps';

export default function CycleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const user = useAuthStore((s) => s.user);
  const { data: cycle, isLoading, isError } = useCycleById(id);
  const { data: assignments } = useCycleAssignments(id);
  const launchCycle = useLaunchCycle();
  const closeCycle = useCloseCycle();

  // Peer assignment hooks
  const { data: peerAssignments } = usePeerAssignments(id);
  const addPeer = useAddPeerAssignment();
  const removePeer = useRemovePeerAssignment();
  const { data: usersData } = useUsers();

  const token = useAuthStore((s) => s.token);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [closing, setClosing] = useState(false);
  const [peerEvaluateeId, setPeerEvaluateeId] = useState('');
  const [peerEvaluatorId, setPeerEvaluatorId] = useState('');
  const [peerRelationType, setPeerRelationType] = useState('');
  const [allowedRelations, setAllowedRelations] = useState<{ value: string; label: string }[]>([]);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoGenResult, setAutoGenResult] = useState<{ created: number } | null>(null);

  // ── Filters: peer section (draft) ───────────────────────────────────────
  const [peerFilterSearch, setPeerFilterSearch] = useState('');
  const [peerFilterDept, setPeerFilterDept] = useState('');

  // ── Filters: assignments table (active/closed) ───────────────────────────
  const [assignFilterSearch, setAssignFilterSearch] = useState('');
  const [assignFilterDept, setAssignFilterDept] = useState('');
  const [assignFilterStatus, setAssignFilterStatus] = useState('');
  const [assignFilterRelation, setAssignFilterRelation] = useState('');

  // Fetch allowed relations when cycle loads
  useEffect(() => {
    if (!cycle || !token || cycle.status !== 'draft') return;
    api.peerAssignments.allowedRelations(token, id).then((rels) => {
      setAllowedRelations(rels);
      if (rels.length > 0 && !peerRelationType) setPeerRelationType(rels[0].value);
    }).catch(() => {});
  }, [cycle?.id, cycle?.status, cycle?.type, token]);

  const handleAutoGenerate = async () => {
    if (!token) return;
    const confirmed = window.confirm(
      '\u00bfGenerar asignaciones autom\u00e1ticamente seg\u00fan el tipo de ciclo y estructura organizacional?\n\nSe crear\u00e1n autoevaluaciones, evaluaciones de jefe directo y reportes directos seg\u00fan corresponda. Las asignaciones de pares deben agregarse manualmente.',
    );
    if (!confirmed) return;
    setAutoGenerating(true);
    setAutoGenResult(null);
    try {
      const result = await api.peerAssignments.autoGenerate(token, id);
      setAutoGenResult(result);
      // Refetch peer assignments
      window.location.reload();
    } catch (e: any) {
      alert(e.message || 'Error al generar asignaciones');
    } finally {
      setAutoGenerating(false);
    }
  };

  const handleLaunch = async () => {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres lanzar este ciclo? Las evaluaciones se enviarán a todos los participantes.',
    );
    if (!confirmed) return;
    setLaunching(true);
    setLaunchError('');
    try {
      await launchCycle.mutateAsync(id);
    } catch (e: any) {
      setLaunchError(
        e?.message || 'Error al lanzar el ciclo. Verifica que el ciclo tenga asignaciones configuradas e inténtalo de nuevo.',
      );
    } finally {
      setLaunching(false);
    }
  };

  const handleClose = async () => {
    const confirmed = window.confirm(
      '¿Cerrar este ciclo? No se podrán enviar más evaluaciones.',
    );
    if (!confirmed) return;
    setClosing(true);
    try {
      await closeCycle.mutateAsync(id);
    } finally {
      setClosing(false);
    }
  };

  const handleAddPeer = async () => {
    if (!peerEvaluateeId) return;
    const evaluatorId = peerRelationType === 'self' ? peerEvaluateeId : peerEvaluatorId;
    if (!evaluatorId) return;
    await addPeer.mutateAsync({ cycleId: id, evaluateeId: peerEvaluateeId, evaluatorId, relationType: peerRelationType });
    setPeerEvaluateeId('');
    setPeerEvaluatorId('');
  };

  const handleRemovePeer = async (peerAssignmentId: string) => {
    await removePeer.mutateAsync({ cycleId: id, id: peerAssignmentId });
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Cargando ciclo...</p>
      </div>
    );
  }

  if (isError || !cycle) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--danger)' }}>Error al cargar el ciclo de evaluaci&oacute;n.</p>
        <button
          className="btn-ghost"
          onClick={() => router.push('/dashboard/evaluaciones')}
          style={{ marginTop: '1rem' }}
        >
          &larr; Volver a evaluaciones
        </button>
      </div>
    );
  }

  const assignmentList: any[] = Array.isArray(assignments) ? assignments : [];
  const totalAssignments = assignmentList.length;
  const completedAssignments = assignmentList.filter(
    (a: any) => a.status === 'completed' || a.status === 'submitted',
  ).length;
  const progressPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

  const peerList: any[] = Array.isArray(peerAssignments) ? peerAssignments : [];
  const usersList: any[] = Array.isArray(usersData) ? usersData : (usersData as any)?.data ?? [];

  // Group peer assignments by evaluatee for cleaner display
  const peerListGrouped: Record<string, any[]> = peerList.reduce((acc, pa) => {
    const key = pa.evaluateeId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pa);
    return acc;
  }, {} as Record<string, any[]>);
  const showPeerSection = cycle.status === 'draft';

  // ── Unique dept options ────────────────────────────────────────────────
  const deptOptions: string[] = Array.from(new Set([
    ...usersList.map((u: any) => u.department),
    ...assignmentList.map((a: any) => a.evaluatee?.department),
  ].filter(Boolean))).sort() as string[];

  // ── Filtered peer groups ───────────────────────────────────────────────
  const filteredPeerEntries = Object.entries(peerListGrouped).filter(([, assignments]) => {
    const evaluatee = (assignments as any[])[0]?.evaluatee;
    const name = evaluatee
      ? `${evaluatee.firstName || ''} ${evaluatee.lastName || ''}`.toLowerCase()
      : '';
    if (peerFilterSearch && !name.includes(peerFilterSearch.toLowerCase())) return false;
    if (peerFilterDept && (evaluatee?.department || '') !== peerFilterDept) return false;
    return true;
  });

  // ── Filtered assignments ───────────────────────────────────────────────
  const uniqueRelations: string[] = Array.from(new Set(assignmentList.map((a: any) => a.relationType).filter(Boolean))) as string[];
  const filteredAssignments = assignmentList.filter((a: any) => {
    const evaluateeName = `${a.evaluatee?.firstName || ''} ${a.evaluatee?.lastName || ''}`.toLowerCase();
    const evaluatorName  = `${a.evaluator?.firstName  || ''} ${a.evaluator?.lastName  || ''}`.toLowerCase();
    if (assignFilterSearch) {
      const s = assignFilterSearch.toLowerCase();
      if (!evaluateeName.includes(s) && !evaluatorName.includes(s)) return false;
    }
    if (assignFilterDept     && (a.evaluatee?.department || '') !== assignFilterDept) return false;
    if (assignFilterStatus   && a.status !== assignFilterStatus) return false;
    if (assignFilterRelation && a.relationType !== assignFilterRelation) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Back link */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn-ghost"
          onClick={() => router.push('/dashboard/evaluaciones')}
          style={{ fontSize: '0.82rem', padding: '0.3rem 0.65rem' }}
        >
          &larr; Volver a evaluaciones
        </button>
      </div>

      {/* Cycle header */}
      <div
        className="card animate-fade-up"
        style={{ padding: '1.75rem', marginBottom: '1.5rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1rem',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              {cycle.name}
            </h1>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${cycleStatusBadge[cycle.status] || 'badge-accent'}`}>
                {cycleStatusLabels[cycle.status] || cycle.status}
              </span>
              {cycle.type && (
                <span className="badge badge-accent">{cycle.type}&deg;</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {cycle.status === 'draft' && (
              <button
                className="btn-primary"
                onClick={handleLaunch}
                disabled={launching}
                style={{ opacity: launching ? 0.6 : 1 }}
              >
                {launching ? 'Lanzando...' : 'Lanzar ciclo'}
              </button>
            )}
            {cycle.status === 'active' && (
              <>
                <button
                  className="btn-ghost"
                  onClick={() =>
                    window.alert('Recordatorios enviados a los participantes pendientes.')
                  }
                  style={{ fontSize: '0.85rem' }}
                >
                  Enviar recordatorio
                </button>
                <button
                  className="btn-primary"
                  onClick={handleClose}
                  disabled={closing}
                  style={{
                    opacity: closing ? 0.6 : 1,
                    background: 'var(--danger)',
                  }}
                >
                  {closing ? 'Cerrando...' : 'Cerrar ciclo'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Details row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            padding: '1rem',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-sm, 0.5rem)',
            border: '1px solid var(--border)',
          }}
        >
          {cycle.startDate && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Inicio
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {new Date(cycle.startDate).toLocaleDateString('es-ES')}
              </div>
            </div>
          )}
          {cycle.endDate && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Cierre
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {new Date(cycle.endDate).toLocaleDateString('es-ES')}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Asignaciones
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              {completedAssignments}/{totalAssignments}
            </div>
          </div>
        </div>

        {launchError && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span>&#9888; {launchError}</span>
            <button
              onClick={() => setLaunchError('')}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}
            >
              &times;
            </button>
          </div>
        )}

        {cycle.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '1rem' }}>
            {cycle.description}
          </p>
        )}
      </div>

      {/* Progress bar (active/closed) */}
      {(cycle.status === 'active' || cycle.status === 'closed') && totalAssignments > 0 && (
        <div
          className="card animate-fade-up"
          style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Progreso general &mdash; {completedAssignments}/{totalAssignments} completadas
            </span>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: progressPct === 100 ? 'var(--success)' : 'var(--accent-hover)',
              }}
            >
              {progressPct}%
            </span>
          </div>
          <div style={{ height: '8px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                borderRadius: '999px',
                background: progressPct === 100 ? 'var(--success)' : 'var(--accent)',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Peer assignment section for 270/360 draft cycles */}
      {showPeerSection && (
        <div
          className="card animate-fade-up"
          style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}
        >
          <div
            style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{'Asignaci\u00f3n de Evaluadores'}</h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {'Configura qui\u00e9n eval\u00faa a qui\u00e9n antes de lanzar el ciclo'}
                </p>
                <p style={{ fontSize: '0.72rem', color: 'var(--accent)', marginTop: '0.25rem', fontWeight: 600 }}>
                  {'Tipo: '}{cycle.type === '90' ? '90\u00b0 (solo jefe)' : cycle.type === '180' ? '180\u00b0 (jefe + auto)' : cycle.type === '270' ? '270\u00b0 (jefe + auto + pares)' : '360\u00b0 (todos)'}{' \u2014 Relaciones permitidas: '}{allowedRelations.map((r) => r.label).join(', ') || 'Cargando...'}
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={handleAutoGenerate}
                disabled={autoGenerating}
                style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', whiteSpace: 'nowrap' }}
              >
                {autoGenerating ? 'Generando...' : '\u26a1 Generar Asignaciones'}
              </button>
            </div>
          </div>

          {peerList.length > 0 && (
            <div style={{ padding: '0 1.5rem 1rem' }}>
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', paddingTop: '0.75rem' }}>
                <input
                  className="input"
                  placeholder="Buscar evaluado..."
                  value={peerFilterSearch}
                  onChange={(e) => setPeerFilterSearch(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', width: '180px' }}
                />
                {deptOptions.length > 0 && (
                  <select
                    className="input"
                    value={peerFilterDept}
                    onChange={(e) => setPeerFilterDept(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">Todos los departamentos</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                {(peerFilterSearch || peerFilterDept) && (
                  <button
                    className="btn-ghost"
                    onClick={() => { setPeerFilterSearch(''); setPeerFilterDept(''); }}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', color: 'var(--text-muted)' }}
                  >
                    {'✕ Limpiar'}
                  </button>
                )}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 'auto' }}>
                  {filteredPeerEntries.length} de {Object.keys(peerListGrouped).length} evaluado{Object.keys(peerListGrouped).length !== 1 ? 's' : ''}
                </span>
              </div>

              {filteredPeerEntries.length === 0 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                  {'Sin resultados para los filtros aplicados.'}
                </p>
              )}

              {filteredPeerEntries.map(([evaluateeId, assignments]) => {
                const first = assignments[0];
                const evalueeName = first.evaluatee
                  ? `${first.evaluatee.firstName || ''} ${first.evaluatee.lastName || ''}`.trim() || first.evaluatee.email
                  : evaluateeId;
                return (
                  <div
                    key={evaluateeId}
                    style={{
                      marginBottom: '0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Evaluatee header */}
                    <div style={{
                      padding: '0.6rem 1rem',
                      background: 'rgba(99,102,241,0.07)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)' }}>
                        {evalueeName}
                      </span>
                      {first.evaluatee?.department && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.1rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
                          {first.evaluatee.department}
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {assignments.length} evaluador{assignments.length !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    {/* Evaluators list */}
                    {assignments.map((pa: any, idx: number) => (
                      <div
                        key={pa.id}
                        style={{
                          padding: '0.5rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                          background: 'var(--bg-surface)',
                        }}
                      >
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>
                          {pa.evaluator?.firstName || pa.evaluator?.email || pa.evaluatorId || '\u2014'}
                          {pa.evaluator?.lastName ? ` ${pa.evaluator.lastName}` : ''}
                        </span>
                        <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
                          {relationLabels[pa.relationType] || pa.relationType}
                        </span>
                        <button
                          className="btn-ghost"
                          onClick={() => handleRemovePeer(pa.id)}
                          disabled={removePeer.isPending}
                          style={{ fontSize: '0.75rem', color: 'var(--danger)', padding: '0.2rem 0.5rem' }}
                        >
                          &times; Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {peerList.length === 0 && (
            <div style={{ padding: '1.25rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {'No hay evaluadores asignados a\u00fan. Usa "Generar Asignaciones" o agrega manualmente antes de lanzar el ciclo.'}
            </div>
          )}

          {/* Add assignment form */}
          <div
            style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: '140px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                {'Relaci\u00f3n'}
              </label>
              <select
                value={peerRelationType}
                onChange={(e) => setPeerRelationType(e.target.value)}
                style={{
                  width: '100%', padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem',
                }}
              >
                {allowedRelations.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                Evaluado
              </label>
              <select
                value={peerEvaluateeId}
                onChange={(e) => {
                  setPeerEvaluateeId(e.target.value);
                  if (e.target.value === peerEvaluatorId) setPeerEvaluatorId('');
                }}
                style={{
                  width: '100%', padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem',
                }}
              >
                <option value="">Seleccionar evaluado</option>
                {usersList.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName ? `${u.firstName} ${u.lastName || ''}${u.position ? ` - ${u.position}` : ''}` : u.email}
                  </option>
                ))}
              </select>
            </div>
            {peerRelationType !== 'self' && (
              <div style={{ flex: 1, minWidth: '160px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  Evaluador
                </label>
                <select
                  value={peerEvaluatorId}
                  onChange={(e) => setPeerEvaluatorId(e.target.value)}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)',
                    background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem',
                  }}
                >
                  <option value="">Seleccionar evaluador</option>
                  {usersList
                    .filter((u: any) => u.id !== peerEvaluateeId)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName ? `${u.firstName} ${u.lastName || ''}${u.position ? ` - ${u.position}` : ''}` : u.email}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <button
              className="btn-primary"
              onClick={handleAddPeer}
              disabled={!peerEvaluateeId || (peerRelationType !== 'self' && !peerEvaluatorId) || addPeer.isPending}
              style={{
                fontSize: '0.85rem', padding: '0.5rem 1.25rem',
                opacity: !peerEvaluateeId || (peerRelationType !== 'self' && !peerEvaluatorId) ? 0.5 : 1,
              }}
            >
              {addPeer.isPending ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Assignments table */}
      {(cycle.status === 'active' || cycle.status === 'closed' || cycle.status === 'draft') &&
        assignmentList.length > 0 && (
          <div
            className="card animate-fade-up"
            style={{ padding: 0, overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Asignaciones</h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    {filteredAssignments.length} de {assignmentList.length} asignaciones
                  </p>
                </div>
              </div>
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <input
                  className="input"
                  placeholder="Buscar nombre..."
                  value={assignFilterSearch}
                  onChange={(e) => setAssignFilterSearch(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', width: '170px' }}
                />
                {deptOptions.length > 0 && (
                  <select
                    className="input"
                    value={assignFilterDept}
                    onChange={(e) => setAssignFilterDept(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">Todos los departamentos</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                {uniqueRelations.length > 1 && (
                  <select
                    className="input"
                    value={assignFilterRelation}
                    onChange={(e) => setAssignFilterRelation(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">Todas las relaciones</option>
                    {uniqueRelations.map((r) => (
                      <option key={r} value={r}>{relationLabels[r] || r}</option>
                    ))}
                  </select>
                )}
                <select
                  className="input"
                  value={assignFilterStatus}
                  onChange={(e) => setAssignFilterStatus(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                >
                  <option value="">Todos los estados</option>
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En progreso</option>
                  <option value="completed">Completada</option>
                  <option value="submitted">Enviada</option>
                </select>
                {(assignFilterSearch || assignFilterDept || assignFilterStatus || assignFilterRelation) && (
                  <button
                    className="btn-ghost"
                    onClick={() => { setAssignFilterSearch(''); setAssignFilterDept(''); setAssignFilterStatus(''); setAssignFilterRelation(''); }}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', color: 'var(--text-muted)' }}
                  >
                    {'✕ Limpiar'}
                  </button>
                )}
              </div>
            </div>
            {/* Grouped by evaluatee — same layout as draft peer section */}
            <div style={{ padding: '0 1.5rem 1rem' }}>
              {filteredAssignments.length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                  Sin resultados para los filtros aplicados.
                </p>
              ) : (() => {
                // Group by evaluateeId
                const grouped: Record<string, any[]> = filteredAssignments.reduce((acc: Record<string, any[]>, a: any) => {
                  const key = a.evaluateeId || 'sin_evaluado';
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(a);
                  return acc;
                }, {});

                return Object.entries(grouped).map(([evaluateeId, items]) => {
                  const first = items[0];
                  const evalueeName = first.evaluatee
                    ? `${first.evaluatee.firstName || ''} ${first.evaluatee.lastName || ''}`.trim() || first.evaluatee.email
                    : evaluateeId;
                  const dept = first.evaluatee?.department;
                  const completed = items.filter((a: any) => a.status === 'completed' || a.status === 'submitted').length;
                  const total = items.length;
                  const allDone = completed === total;

                  return (
                    <div
                      key={evaluateeId}
                      style={{ marginBottom: '0.75rem', marginTop: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
                    >
                      {/* Evaluatee header */}
                      <div style={{
                        padding: '0.6rem 1rem',
                        background: 'rgba(99,102,241,0.07)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)' }}>
                          {evalueeName}
                        </span>
                        {dept && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.1rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
                            {dept}
                          </span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: allDone ? 'var(--success)' : 'var(--text-muted)', marginLeft: 'auto', fontWeight: allDone ? 700 : 400 }}>
                          {completed}/{total} {allDone ? '✓' : 'completadas'}
                        </span>
                      </div>

                      {/* Evaluators rows */}
                      {items.map((a: any, idx: number) => {
                        const evaluatorName = a.evaluator
                          ? `${a.evaluator.firstName || ''} ${a.evaluator.lastName || ''}`.trim() || a.evaluator.email
                          : a.evaluatorId || '\u2014';
                        const isDone = a.status === 'completed' || a.status === 'submitted';
                        const canRespond = cycle.status === 'active' && a.evaluatorId === user?.userId && !isDone;

                        return (
                          <div
                            key={a.id}
                            style={{
                              padding: '0.55rem 1rem',
                              display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                              borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                              background: isDone ? 'rgba(16,185,129,0.03)' : 'var(--bg-surface)',
                            }}
                          >
                            {/* Evaluator name */}
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1, minWidth: '120px' }}>
                              {evaluatorName}
                            </span>

                            {/* Relation */}
                            <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
                              {relationLabels[a.relationType] || a.relationType}
                            </span>

                            {/* Status */}
                            <span className={`badge ${statusBadge[a.status] || 'badge-accent'}`} style={{ fontSize: '0.7rem' }}>
                              {statusLabels[a.status] || a.status}
                            </span>

                            {/* Score (closed cycles) */}
                            {cycle.status === 'closed' && (
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, minWidth: '36px', textAlign: 'right', color: a.score != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                {a.score != null ? (typeof a.score === 'number' ? a.score.toFixed(1) : a.score) : '\u2014'}
                              </span>
                            )}

                            {/* Action (active cycles) */}
                            {cycle.status === 'active' && (
                              canRespond ? (
                                <Link
                                  href={`/dashboard/evaluaciones/${id}/responder/${a.id}`}
                                  className="btn-primary"
                                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                                >
                                  Responder
                                </Link>
                              ) : null
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

      {assignmentList.length === 0 && !isLoading && (
        <div
          className="card animate-fade-up"
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
          }}
        >
          No hay asignaciones en este ciclo a&uacute;n.
        </div>
      )}
    </div>
  );
}
