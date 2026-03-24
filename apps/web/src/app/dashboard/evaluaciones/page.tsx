'use client';

import { useCycles } from '@/hooks/useCycles';
import { usePendingEvaluations, useMyCompletedEvaluations } from '@/hooks/useEvaluations';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge, ScaleLegend } from '@/components/ScoreBadge';
import Link from 'next/link';
import {
  cycleStatusLabel, cycleStatusBadge,
  cycleTypeBadge, assignmentStatusLabel as evalStatusLabels,
  assignmentStatusBadge as evalStatusBadge,
  relationTypeLabel as relationLabels,
} from '@/lib/statusMaps';

const typeLabels: Record<string, string> = {
  '90': '90\u00b0',
  '180': '180\u00b0',
  '270': '270\u00b0',
  '360': '360\u00b0',
};

const statusLabels = cycleStatusLabel;
const statusBadge = cycleStatusBadge;
const typeBadge = cycleTypeBadge;

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Employee view: only their assignments ──────────────────────────────────

function EmployeeEvaluationsView() {
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: completedEvals, isLoading: loadingCompleted } = useMyCompletedEvaluations();
  const userId = useAuthStore((s) => s.user?.userId);

  const pending = pendingEvals || [];
  const completed = completedEvals || [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Mis Evaluaciones</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Evaluaciones asignadas a ti
        </p>
      </div>

      {/* Summary cards */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Pendientes</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: pending.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{pending.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Completadas</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{completed.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Total</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{pending.length + completed.length}</div>
        </div>
      </div>

      {/* Scale legend */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Pending evaluations */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
          Evaluaciones pendientes
        </h2>

        {loadingPending ? <Spinner /> : pending.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No tienes evaluaciones pendientes</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pending.map((ev: any) => (
              <div key={ev.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : 'Sin asignar'}
                    </span>
                    {ev.evaluateeId === userId && (
                      <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>Eres tu</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Tipo: <strong style={{ color: 'var(--text-secondary)' }}>{relationLabels[ev.relationType] || ev.relationType}</strong>
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Ciclo: <strong style={{ color: 'var(--text-secondary)' }}>{ev.cycle?.name || '--'}</strong>
                    </span>
                    {ev.dueDate && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Fecha limite: <strong style={{ color: 'var(--warning)' }}>{new Date(ev.dueDate).toLocaleDateString('es-ES')}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                  className="btn-primary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                >
                  Responder
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed evaluations */}
      <div className="animate-fade-up-delay-2">
        <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          Evaluaciones completadas
        </h2>

        {loadingCompleted ? <Spinner /> : completed.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Aun no has completado evaluaciones</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Evaluado</th>
                  <th>Tipo</th>
                  <th>Ciclo</th>
                  <th>Puntaje</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((ev: any) => (
                  <tr key={ev.id}>
                    <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : '--'}
                      {ev.evaluateeId === userId && <span className="badge badge-accent" style={{ marginLeft: '0.4rem', fontSize: '0.6rem' }}>Tu</span>}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{relationLabels[ev.relationType] || ev.relationType}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{ev.cycle?.name || '--'}</td>
                    <td>
                      <ScoreBadge score={ev.response?.overallScore} size="sm" />
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-ES') : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin/Manager view: cycles overview ────────────────────────────────────

function AdminEvaluationsView() {
  const { data: cycles, isLoading } = useCycles();
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'tenant_admin';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Evaluaciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {isAdmin ? 'Gestiona los ciclos de evaluacion de desempeno' : 'Ciclos de evaluacion'}
          </p>
        </div>
        {isAdmin && (
          <Link href="/dashboard/evaluaciones/nuevo" style={{ textDecoration: 'none' }}>
            <button className="btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Nuevo ciclo
            </button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !cycles || cycles.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            No hay ciclos de evaluacion
          </p>
          {isAdmin && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              Crea tu primer ciclo para comenzar
            </p>
          )}
        </div>
      ) : (
        <div
          className="animate-fade-up-delay-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
        >
          {cycles.map((cycle: any) => {
            const startDate = cycle.startDate
              ? new Date(cycle.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '\u2013';
            const endDate = cycle.endDate
              ? new Date(cycle.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '\u2013';
            const totalEval = cycle.totalEvaluated || 0;

            return (
              <Link
                key={cycle.id}
                href={`/dashboard/evaluaciones/${cycle.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  className="card"
                  style={{ padding: '1.4rem', cursor: 'pointer', transition: 'var(--transition)', height: '100%' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
                    <span className={`badge ${typeBadge[cycle.type] || 'badge-accent'}`}>
                      {typeLabels[cycle.type] || cycle.type}
                    </span>
                    <span className={`badge ${statusBadge[cycle.status] || 'badge-accent'}`}>
                      {statusLabels[cycle.status] || cycle.status}
                    </span>
                  </div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4 }}>
                    {cycle.name}
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    {startDate} \u2014 {endDate}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                    {totalEval} evaluado{totalEval !== 1 ? 's' : ''}
                  </p>

                  {cycle.status === 'active' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Progreso</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-hover)' }}>
                          {totalEval > 0 ? 'En curso' : 'Sin asignaciones'}
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{
                          width: totalEval > 0 ? '50%' : '0%',
                          height: '100%', borderRadius: '999px',
                          background: 'var(--accent)',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  )}

                  {cycle.status === 'closed' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Completado</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)' }}>100%</span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: '999px', background: 'var(--success)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main: route by role ────────────────────────────────────────────────────

export default function EvaluacionesPage() {
  const userRole = useAuthStore((s) => s.user?.role);

  // Solo el Encargado del Sistema ve la vista administrativa de ciclos
  if (userRole === 'tenant_admin') {
    return <AdminEvaluationsView />;
  }

  // Encargado de Equipo, Colaborador y Asesor Externo ven sus evaluaciones personales
  return <EmployeeEvaluationsView />;
}
