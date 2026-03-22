'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  useCycleById,
  useCycleAssignments,
  useLaunchCycle,
  useCloseCycle,
} from '@/hooks/useCycles';

const relationLabels: Record<string, string> = {
  self: 'Autoevaluaci\u00f3n',
  manager: 'Jefatura',
  peer: 'Par',
  direct_report: 'Reporte directo',
};

const statusBadge: Record<string, string> = {
  pending: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
  submitted: 'badge-success',
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  submitted: 'Enviada',
};

const cycleStatusBadge: Record<string, string> = {
  draft: 'badge-warning',
  active: 'badge-success',
  closed: 'badge-info',
};

const cycleStatusLabels: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  closed: 'Cerrado',
};

export default function CycleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { data: cycle, isLoading, isError } = useCycleById(id);
  const { data: assignments } = useCycleAssignments(id);
  const launchCycle = useLaunchCycle();
  const closeCycle = useCloseCycle();

  const [launching, setLaunching] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleLaunch = async () => {
    const confirmed = window.confirm(
      '\u00bfEst\u00e1s seguro de que quieres lanzar este ciclo? Las evaluaciones se enviar\u00e1n a todos los participantes.',
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
      '\u00bfCerrar este ciclo? No se podr\u00e1n enviar m\u00e1s evaluaciones.',
    );
    if (!confirmed) return;
    setClosing(true);
    try {
      await closeCycle.mutateAsync(id);
    } finally {
      setClosing(false);
    }
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
                  </tr>
                </thead>
                <tbody>
                  {assignmentList.map((a: any) => (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                          {a.evaluatee?.firstName || a.evaluatee?.email || a.evaluateeId || '—'}
                          {a.evaluatee?.lastName ? ` ${a.evaluatee.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {a.evaluator?.firstName || a.evaluator?.email || a.evaluatorId || '—'}
                          {a.evaluator?.lastName ? ` ${a.evaluator.lastName}` : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {relationLabels[a.relationType] || a.relationType || '—'}
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
                              —
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
