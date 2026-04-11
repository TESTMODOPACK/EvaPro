'use client';

// Read-only modal para mostrar el detalle de un plan de desarrollo (PDI) sin
// navegar a /dashboard/desarrollo. Lo usa analytics-pdi (Informes PDI) y
// cualquier otra vista de reporte que necesite "ver" un plan. No incluye
// botones de editar/completar/agregar — quien quiera modificar debe ir a
// /dashboard/desarrollo?planId=<id>.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import {
  PLAN_STATUS_COLORS,
  PLAN_STATUS_LABELS,
  PLAN_PRIORITY_COLORS,
  PLAN_PRIORITY_LABELS,
} from '@/lib/plan-status';

// Etiquetas locales para tipos de accion / comentario — se copian del modulo
// desarrollo para mantener paridad visual sin depender de un t() context.
const ACTION_TYPE_LABELS: Record<string, string> = {
  curso: 'Curso',
  mentoring: 'Mentoring',
  proyecto: 'Proyecto',
  taller: 'Taller',
  lectura: 'Lectura',
  rotacion: 'Rotación',
  otro: 'Otro',
};

const COMMENT_TYPE_LABELS: Record<string, string> = {
  comentario: 'Comentario',
  felicitacion: 'Felicitación',
  seguimiento: 'Seguimiento',
  revision: 'Revisión',
};

const STATUS_INFO_MESSAGE: Record<string, string> = {
  borrador: 'Este plan está en Borrador. Aún no ha sido activado.',
  activo: 'Plan activo. Se registran las acciones y comentarios aquí.',
  completado: 'Este plan ha sido completado exitosamente.',
  cancelado: 'Este plan fue cancelado.',
  en_revision: 'Este plan está en revisión por el encargado.',
  pausado: 'Este plan está pausado temporalmente.',
  aprobado: 'Este plan ha sido aprobado.',
};

export interface PlanDetailModalProps {
  /** Id del plan a mostrar. null = modal cerrado. */
  planId: string | null;
  /** Callback cuando el usuario cierra el modal (overlay click, boton Cerrar, Escape). */
  onClose: () => void;
}

/**
 * Modal de solo-lectura con el detalle de un plan PDI.
 *
 * Fetchea el plan y sus comentarios en cada apertura (useEffect sobre planId).
 * Cierra con click en el overlay, boton "Cerrar" o tecla Escape.
 */
export function PlanDetailModal({ planId, onClose }: PlanDetailModalProps) {
  const token = useAuthStore((s) => s.token);
  const [plan, setPlan] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load plan + comments when a new planId opens the modal.
  useEffect(() => {
    if (!planId || !token) {
      setPlan(null);
      setComments([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [detail, cmts] = await Promise.all([
          api.development.plans.getById(token, planId),
          api.development.comments.list(token, planId).catch(() => []),
        ]);
        if (cancelled) return;
        setPlan(detail);
        setComments(Array.isArray(cmts) ? cmts : []);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'No se pudo cargar el plan.');
        setPlan(null);
        setComments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, token]);

  // Close on Escape keypress
  useEffect(() => {
    if (!planId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [planId, onClose]);

  if (!planId) return null;

  const progress = typeof plan?.progress === 'number' ? plan.progress : 0;
  const statusColor = plan ? PLAN_STATUS_COLORS[plan.status] || 'var(--text-muted)' : 'var(--text-muted)';
  const statusLabel = plan ? PLAN_STATUS_LABELS[plan.status] || plan.status : '';
  const priorityColor = plan ? PLAN_PRIORITY_COLORS[plan.priority] || 'var(--text-muted)' : 'var(--text-muted)';
  const priorityLabel = plan ? PLAN_PRIORITY_LABELS[plan.priority] || plan.priority : '';
  const infoMessage = plan ? STATUS_INFO_MESSAGE[plan.status] : null;

  // Prefer the user object if the backend populated it, else fall back to any
  // denormalized name that callers may have attached.
  const userName = plan?.user
    ? `${plan.user.firstName || ''} ${plan.user.lastName || ''}`.trim()
    : plan?.userName || '';
  const userPosition = plan?.user?.position || plan?.user?.department || plan?.department || '';

  const actions: any[] = Array.isArray(plan?.actions) ? plan.actions : [];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="animate-fade-up"
        style={{
          maxWidth: '860px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-sm, 8px)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
            <span className="spinner" />
          </div>
        ) : error ? (
          <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</p>
            <button className="btn-ghost" onClick={onClose}>Cerrar</button>
          </div>
        ) : plan ? (
          <>
            {/* Header */}
            <div style={{ padding: '1.5rem 1.5rem 1rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {userName && (
                    <div style={{ marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {userName}
                      </span>
                      {userPosition && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                          {userPosition}
                        </span>
                      )}
                    </div>
                  )}
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {plan.title || 'Sin título'}
                  </h2>
                  {plan.description && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {plan.description}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: '10px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: `${statusColor}20`,
                      color: statusColor,
                      whiteSpace: 'nowrap',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {statusLabel}
                  </span>
                  {plan.priority && (
                    <span
                      style={{
                        padding: '0.3rem 0.7rem',
                        borderRadius: '10px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        background: `${priorityColor}20`,
                        color: priorityColor,
                        whiteSpace: 'nowrap',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {priorityLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding: '1.25rem 1.5rem' }}>
              {/* Info mini-card */}
              {infoMessage && (
                <div
                  style={{
                    padding: '0.6rem 0.85rem',
                    background: 'rgba(99,102,241,0.05)',
                    borderRadius: 'var(--radius-sm, 6px)',
                    borderLeft: '3px solid var(--accent)',
                    marginBottom: '1.25rem',
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.6,
                  }}
                >
                  {infoMessage}
                </div>
              )}

              {/* Progress bar */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.35rem',
                  }}
                >
                  <span>Progreso general</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{progress}%</span>
                </div>
                <div style={{ height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${progress}%`,
                      background: progress >= 100 ? 'var(--success)' : 'var(--accent)',
                      borderRadius: '5px',
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
              </div>

              {/* Actions — read only */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div
                  style={{
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '0.75rem',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Acciones de Desarrollo{' '}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({actions.length})</span>
                  </h3>
                </div>

                {actions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No hay acciones registradas en este plan.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {actions.map((action: any) => {
                      const isCompleted = action.status === 'completada' || action.status === 'completed';
                      return (
                        <div
                          key={action.id}
                          style={{
                            padding: '0.6rem 0.85rem',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm, 6px)',
                            background: isCompleted ? 'rgba(34,197,94,0.05)' : 'var(--bg-surface)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ flex: 1, minWidth: '150px' }}>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                {action.type && (
                                  <span className="badge" style={{ fontSize: '0.7rem' }}>
                                    {ACTION_TYPE_LABELS[action.type] || action.type}
                                  </span>
                                )}
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    color: 'var(--text-primary)',
                                    textDecoration: isCompleted ? 'line-through' : 'none',
                                  }}
                                >
                                  {action.title}
                                </span>
                                {action.competency?.name && (
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    ({action.competency.name})
                                  </span>
                                )}
                              </div>
                              {action.dueDate && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  Fecha límite: {new Date(action.dueDate).toLocaleDateString('es-CL')}
                                </div>
                              )}
                              {action.description && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                                  {action.description}
                                </div>
                              )}
                            </div>
                            <span
                              className={isCompleted ? 'badge badge-success' : 'badge badge-warning'}
                              style={{ fontSize: '0.7rem' }}
                            >
                              {isCompleted ? 'COMPLETADA' : 'PENDIENTE'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Comments — read only */}
              <div>
                <div
                  style={{
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '0.75rem',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Comentarios{' '}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({comments.length})</span>
                  </h3>
                </div>

                {comments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No hay comentarios en este plan.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {comments.map((comment: any) => {
                      const authorName = comment.author
                        ? `${comment.author.firstName || ''} ${comment.author.lastName || ''}`.trim()
                        : comment.authorName || 'Usuario';
                      return (
                        <div
                          key={comment.id}
                          style={{
                            padding: '0.6rem',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm, 6px)',
                            fontSize: '0.85rem',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.3rem',
                            }}
                          >
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.82rem' }}>
                                {authorName}
                              </span>
                              {comment.type && (
                                <span className="badge" style={{ fontSize: '0.68rem' }}>
                                  {COMMENT_TYPE_LABELS[comment.type] || comment.type}
                                </span>
                              )}
                            </div>
                            {comment.createdAt && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {new Date(comment.createdAt).toLocaleDateString('es-CL')}
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>{comment.content}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer — only close */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '1rem 1.5rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <button className="btn-ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
