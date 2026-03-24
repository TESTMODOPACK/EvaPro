'use client';

import { useState } from 'react';
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

  const [launching, setLaunching] = useState(false);
  const [closing, setClosing] = useState(false);
  const [peerEvaluateeId, setPeerEvaluateeId] = useState('');
  const [peerEvaluatorId, setPeerEvaluatorId] = useState('');
  const [peerRelationType, setPeerRelationType] = useState('self');

  const handleLaunch = async () => {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres lanzar este ciclo? Las evaluaciones se enviarán a todos los participantes.',
    );
    if (!confirmed) return;
    setLaunching(true);
    try {
      await launchCycle.mutateAsync(id);
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
  const showPeerSection = cycle.status === 'draft';

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
            <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Asignaci&oacute;n de Evaluadores</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
              Configura qui&eacute;n eval&uacute;a a qui&eacute;n antes de lanzar el ciclo
            </p>
          </div>

          {peerList.length > 0 && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Evaluado</th>
                    <th>Evaluador</th>
                    <th>Relaci&oacute;n</th>
                    <th>Eliminar</th>
                  </tr>
                </thead>
                <tbody>
                  {peerList.map((pa: any) => (
                    <tr key={pa.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                          {pa.evaluatee?.firstName || pa.evaluatee?.email || pa.evaluateeId || '\u2014'}
                          {pa.evaluatee?.lastName ? ` ${pa.evaluatee.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {pa.evaluator?.firstName || pa.evaluator?.email || pa.evaluatorId || '\u2014'}
                          {pa.evaluator?.lastName ? ` ${pa.evaluator.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {relationLabels[pa.relationType] || pa.relationType || '\u2014'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-ghost"
                          onClick={() => handleRemovePeer(pa.id)}
                          disabled={removePeer.isPending}
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--danger)',
                            padding: '0.25rem 0.5rem',
                          }}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {peerList.length === 0 && (
            <div style={{ padding: '1.25rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No hay evaluadores asignados a&uacute;n. Agrega las asignaciones antes de lanzar el ciclo.
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
                Relaci&oacute;n
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
                <option value="self">Autoevaluaci&oacute;n</option>
                <option value="manager">Jefatura</option>
                <option value="peer">Par</option>
                <option value="direct_report">Reporte directo</option>
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
                    {u.firstName ? `${u.firstName} ${u.lastName || ''}` : u.email}
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
                        {u.firstName ? `${u.firstName} ${u.lastName || ''}` : u.email}
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
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Asignaciones</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                Detalle de evaluadores y evaluados
              </p>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Evaluado</th>
                    <th>Evaluador</th>
                    <th>Relaci&oacute;n</th>
                    <th>Estado</th>
                    {cycle.status === 'closed' && <th>Resultado</th>}
                    {cycle.status === 'active' && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {assignmentList.map((a: any) => (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                          {a.evaluatee?.firstName || a.evaluatee?.email || a.evaluateeId || '\u2014'}
                          {a.evaluatee?.lastName ? ` ${a.evaluatee.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {a.evaluator?.firstName || a.evaluator?.email || a.evaluatorId || '\u2014'}
                          {a.evaluator?.lastName ? ` ${a.evaluator.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {relationLabels[a.relationType] || a.relationType || '\u2014'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${statusBadge[a.status] || 'badge-accent'}`}>
                          {statusLabels[a.status] || a.status}
                        </span>
                      </td>
                      {cycle.status === 'closed' && (
                        <td>
                          {a.score != null ? (
                            <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>
                              {typeof a.score === 'number' ? a.score.toFixed(1) : a.score}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                              &#x2014;
                            </span>
                          )}
                        </td>
                      )}
                      {cycle.status === 'active' && (
                        <td>
                          {a.evaluatorId === user?.userId && a.status !== 'completed' ? (
                            <Link
                              href={`/dashboard/evaluaciones/${id}/responder/${a.id}`}
                              className="btn-primary"
                              style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
                            >
                              Responder
                            </Link>
                          ) : a.status === 'completed' ? (
                            <span style={{ color: 'var(--success)', fontSize: '0.78rem', fontWeight: 600 }}>
                              Completada
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                              &#x2014;
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
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
