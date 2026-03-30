'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import ConfirmModal from '@/components/ConfirmModal';

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
  const { t } = useTranslation();
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: completedEvals, isLoading: loadingCompleted } = useMyCompletedEvaluations();
  const userId = useAuthStore((s) => s.user?.userId);

  const pending = pendingEvals || [];
  const completed = completedEvals || [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('evaluaciones.myTitle')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('evaluaciones.subtitle')}
        </p>
      </div>

      {/* Summary cards */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('evaluaciones.pending')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: pending.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{pending.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('evaluaciones.completed')}</div>
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
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('evaluaciones.noPending')}</p>
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
  const { t } = useTranslation();
  const { data: cycles, isLoading, mutate } = useCycles() as any;
  const userRole = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token)!;
  const isAdmin = userRole === 'tenant_admin';
  const [showGuide, setShowGuide] = useState(false);
  const toast = useToastStore();
  const [confirmState, setConfirmState] = useState<{
    message: string; detail?: string; onConfirm: () => void;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDeleteCycle(cycleId: string, cycleName: string) {
    setConfirmState({
      message: `¿Eliminar el ciclo "${cycleName}"?`,
      detail: 'Esta acción no se puede deshacer. El ciclo será eliminado permanentemente.',
      onConfirm: async () => {
        setConfirmState(null);
        setDeleting(cycleId);
        try {
          await api.cycles.remove(token, cycleId);
          toast.success(`Ciclo "${cycleName}" eliminado correctamente`);
          if (mutate) mutate();
        } catch (e: any) {
          toast.error(e?.message || 'Error al eliminar el ciclo');
        } finally {
          setDeleting(null);
        }
      },
    });
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('evaluaciones.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('evaluaciones.title')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? 'Ocultar gu\u00eda' : 'C\u00f3mo funciona'}
          </button>
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
      </div>

      {/* Guide / Explainer */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {'Gu\u00eda de uso: Ciclos de Evaluaci\u00f3n'}
          </h3>

          {/* Section 1 */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {'\u00bfQu\u00e9 es un ciclo de evaluaci\u00f3n?'}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              {'Un ciclo agrupa las evaluaciones de desempe\u00f1o de un per\u00edodo. Se configura el tipo (90\u00b0, 180\u00b0, 270\u00b0, 360\u00b0), se asignan evaluadores y se procesan los resultados.'}
            </p>
          </div>

          {/* Section 2 - Types */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {'Tipos de evaluaci\u00f3n'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'90\u00b0:'}</strong>{' Solo el encargado eval\u00faa al colaborador'}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'180\u00b0:'}</strong>{' Autoevaluaci\u00f3n + evaluaci\u00f3n del encargado'}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'270\u00b0:'}</strong>{' 180\u00b0 + evaluaci\u00f3n de pares'}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'360\u00b0:'}</strong>{' 270\u00b0 + calibraci\u00f3n + entrega de feedback'}
              </div>
            </div>
          </div>

          {/* Section 3 - Stages */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {'Etapas del ciclo'}
              <span className="badge badge-accent" style={{ fontSize: '0.6rem' }}>B3.14 - NUEVO</span>
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{'Al crear un ciclo se generan etapas autom\u00e1ticas seg\u00fan el tipo'}</li>
              <li>{'Cada etapa debe completarse antes de avanzar a la siguiente'}</li>
              <li style={{ marginTop: '0.25rem' }}>
                {'Etapas: '}
                <strong>{'Autoevaluaci\u00f3n \u2192 Evaluaci\u00f3n Encargado \u2192 Evaluaci\u00f3n Pares \u2192 Calibraci\u00f3n \u2192 Entrega Feedback \u2192 Cierre'}</strong>
              </li>
            </ul>
          </div>

          {/* Section 4 - Flow */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Flujo</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{'Crear ciclo (borrador)'}</li>
              <li>{'Asignar evaluadores'}</li>
              <li>{'Lanzar ciclo (se notifica a evaluadores)'}</li>
              <li>{'Evaluadores completan formularios por etapa'}</li>
              <li>{'Calibraci\u00f3n (360\u00b0)'}</li>
              <li>{'Cierre y visualizaci\u00f3n de resultados'}</li>
            </ol>
          </div>

          {/* Section 5 - Anonymity */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {'Anonimato configurable'}
              <span className="badge badge-accent" style={{ fontSize: '0.6rem' }}>B2.13 - NUEVO</span>
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{'En la configuraci\u00f3n del ciclo se puede definir qu\u00e9 tipos de evaluador son an\u00f3nimos'}</li>
              <li>{'Por defecto: pares y externos son an\u00f3nimos, encargado y autoevaluaci\u00f3n son visibles'}</li>
            </ul>
          </div>

          {/* Section 6 - Permissions */}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Permisos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Administrador:</strong>{' Crea ciclos, asigna evaluadores, avanza etapas, cierra'}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'Encargado de Equipo:'}</strong>{' Ve asignaciones de su equipo, completa evaluaciones'}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>{'Colaborador:'}</strong>{' Completa su autoevaluaci\u00f3n, ve resultados al cierre'}
              </div>
            </div>
          </div>
        </div>
      )}

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
            No hay ciclos de evaluaci\u00f3n
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
                    {startDate}{' \u2014 '}{endDate}
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

                  {/* Delete button — only visible for draft cycles, admins only */}
                  {isAdmin && cycle.status === 'draft' && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteCycle(cycle.id, cycle.name);
                        }}
                        disabled={deleting === cycle.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.35rem',
                          padding: '0.3rem 0.65rem', borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)',
                          color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                          transition: 'all 0.15s',
                          opacity: deleting === cycle.id ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                        title="Solo se pueden eliminar ciclos en estado Borrador"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                        {deleting === cycle.id ? 'Eliminando...' : 'Eliminar borrador'}
                      </button>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          detail={confirmState.detail}
          danger
          confirmLabel="Eliminar"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
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
