'use client';

import { useState, useEffect } from 'react';
import {
  useObjectives,
  useCreateObjective,
  useUpdateObjective,
  useDeleteObjective,
  useAddObjectiveProgress,
  useObjectiveComments,
  useCreateObjectiveComment,
  useDeleteObjectiveComment,
  useSubmitForApproval,
  useApproveObjective,
  useRejectObjective,
} from '@/hooks/useObjectives';
import { useAuthStore } from '@/store/auth.store';
import { useUsers } from '@/hooks/useUsers';
import { getRoleLabel } from '@/lib/roles';

type FilterStatus = 'all' | 'draft' | 'pending_approval' | 'active' | 'completed' | 'abandoned';
type ObjType = 'OKR' | 'KPI' | 'SMART';
type CommentType = 'comentario' | 'felicitacion' | 'seguimiento' | 'adjunto';

const typeBadge: Record<string, string> = {
  OKR: 'badge-accent',
  KPI: 'badge-warning',
  SMART: 'badge-success',
};

const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  pending_approval: 'Pendiente de aprobación',
  active: 'En progreso',
  completed: 'Completado',
  abandoned: 'Abandonado',
};

const statusBadge: Record<string, string> = {
  draft: 'badge-warning',
  pending_approval: 'badge-ghost',
  active: 'badge-success',
  completed: 'badge-accent',
  abandoned: 'badge-danger',
};

const filterPills: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'draft', label: 'Borradores' },
  { key: 'pending_approval', label: 'Por aprobar' },
  { key: 'active', label: 'En progreso' },
  { key: 'completed', label: 'Completados' },
  { key: 'abandoned', label: 'Abandonados' },
];

const commentTypeBadge: Record<string, string> = {
  comentario: 'badge-accent',
  felicitacion: 'badge-success',
  seguimiento: 'badge-warning',
  adjunto: 'badge-accent',
};

const commentTypeLabel: Record<string, string> = {
  comentario: 'Comentario',
  felicitacion: 'Felicitacion',
  seguimiento: 'Seguimiento',
  adjunto: 'Adjunto',
};

/** Returns days until target date. Negative = overdue */
function daysUntil(targetDate: string | null): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Returns deadline alert config based on days remaining */
function deadlineAlert(days: number | null, status: string): { color: string; text: string; icon: string } | null {
  if (days === null || status === 'completed' || status === 'abandoned') return null;
  if (days < 0) return { color: 'var(--danger)', text: `Vencido hace ${Math.abs(days)} dia${Math.abs(days) !== 1 ? 's' : ''}`, icon: '!' };
  if (days === 0) return { color: 'var(--danger)', text: 'Vence hoy', icon: '!' };
  if (days <= 3) return { color: 'var(--danger)', text: `Vence en ${days} dia${days !== 1 ? 's' : ''}`, icon: '!' };
  if (days <= 7) return { color: 'var(--warning)', text: `Vence en ${days} dias`, icon: '~' };
  if (days <= 15) return { color: '#f59e0b', text: `Vence en ${days} dias`, icon: '' };
  return null;
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function progressColor(p: number) {
  if (p < 30) return 'var(--danger)';
  if (p < 70) return 'var(--warning)';
  return 'var(--success)';
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─── Comments Sub-component ──────────────────────────────────────────────── */

function CommentsSection({ objectiveId, currentUserId, isAdmin }: { objectiveId: string; currentUserId: string; isAdmin: boolean }) {
  const { data: comments, isLoading } = useObjectiveComments(objectiveId);
  const createComment = useCreateObjectiveComment();
  const deleteComment = useDeleteObjectiveComment();

  const [content, setContent] = useState('');
  const [type, setType] = useState<CommentType>('comentario');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  function handleSubmit() {
    if (!content.trim()) return;
    const data: any = { content: content.trim(), type };
    if (type === 'adjunto' && attachmentUrl) {
      data.attachmentUrl = attachmentUrl;
      data.attachmentName = attachmentName || 'Adjunto';
    }
    createComment.mutate(
      { objectiveId, data },
      {
        onSuccess: () => {
          setContent('');
          setType('comentario');
          setAttachmentUrl('');
          setAttachmentName('');
        },
      },
    );
  }

  return (
    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
        Comentarios
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>Cargando...</div>
      ) : comments && comments.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem', maxHeight: '250px', overflowY: 'auto' }}>
          {comments.map((c: any) => (
            <div key={c.id} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem' }}>
              {/* Avatar */}
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
              }}>
                {(c.user?.firstName || c.authorId || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>
                    {c.user ? `${c.user.firstName} ${c.user.lastName}` : 'Usuario'}
                  </span>
                  <span className={`badge ${commentTypeBadge[c.type] || 'badge-accent'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                    {c.type === 'adjunto' && <span style={{ marginRight: '0.2rem' }}>&#128206;</span>}
                    {commentTypeLabel[c.type] || c.type}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {formatDate(c.createdAt)}
                  </span>
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {c.content}
                </div>
                {c.attachmentUrl && (
                  <a
                    href={c.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.3rem', textDecoration: 'underline' }}
                  >
                    &#128206; {c.attachmentName || 'Ver adjunto'}
                  </a>
                )}
              </div>
              {/* Delete button */}
              {(c.authorId === currentUserId || isAdmin) && (
                <button
                  onClick={() => deleteComment.mutate({ objectiveId, commentId: c.id })}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 0.3rem',
                    alignSelf: 'flex-start', lineHeight: 1,
                  }}
                  title="Eliminar comentario"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Sin comentarios aun.</p>
      )}

      {/* Add comment form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <textarea
          className="input"
          rows={2}
          placeholder="Escribe un comentario..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontSize: '0.78rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as CommentType)}
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
          >
            <option value="comentario">Comentario</option>
            <option value="felicitacion">Felicitacion</option>
            <option value="seguimiento">Seguimiento</option>
            <option value="adjunto">Adjunto</option>
          </select>
          {type === 'adjunto' && (
            <>
              <input
                className="input"
                type="url"
                placeholder="URL del adjunto"
                value={attachmentUrl}
                onChange={(e) => setAttachmentUrl(e.target.value)}
                style={{ fontSize: '0.78rem', flex: 1, minWidth: '120px' }}
              />
              <input
                className="input"
                type="text"
                placeholder="Nombre del adjunto"
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
                style={{ fontSize: '0.78rem', flex: 1, minWidth: '100px' }}
              />
            </>
          )}
          <button
            className="btn-primary"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
            onClick={handleSubmit}
            disabled={createComment.isPending || !content.trim()}
          >
            {createComment.isPending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */

export default function ObjetivosPage() {
  const userRole = useAuthStore((s) => s.user?.role) || '';
  const userId = useAuthStore((s) => s.user?.userId) || '';

  const isAdmin = userRole === 'tenant_admin';
  const isManager = userRole === 'manager';
  const isEmployee = userRole === 'employee';
  const canCreate = true; // all roles can create
  const canDelete = isAdmin || isManager;
  const canApprove = isAdmin || isManager;
  const showAssignedTo = isAdmin || isManager;

  const { data: objectives, isLoading } = useObjectives();
  const createObjective = useCreateObjective();
  const updateObjective = useUpdateObjective();
  const deleteObjective = useDeleteObjective();
  const addProgress = useAddObjectiveProgress();
  const submitForApproval = useSubmitForApproval();
  const approveObjective = useApproveObjective();
  const rejectObjective = useRejectObjective();

  // Fetch users for assignment (admin/manager only)
  const { data: usersData } = useUsers(1, 200);
  const allUsers: any[] = usersData?.data || [];

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [progressForm, setProgressForm] = useState<{ value: number; notes: string }>({ value: 50, notes: '' });
  const [form, setForm] = useState({ title: '', description: '', type: 'OKR' as ObjType, targetDate: '', userId: '' });

  // Build unique users from objectives for the user filter dropdown
  const uniqueUsers: { id: string; name: string }[] = [];
  if (objectives && showAssignedTo) {
    const seen = new Set<string>();
    objectives.forEach((o: any) => {
      const uid = o.userId || o.user?.id;
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        const name = o.user ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim() : uid;
        uniqueUsers.push({ id: uid, name });
      }
    });
    uniqueUsers.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Filter objectives
  const filtered = objectives
    ? objectives.filter((o: any) => {
        if (filter !== 'all' && o.status !== filter) return false;
        if (userFilter !== 'all') {
          const uid = o.userId || o.user?.id;
          if (uid !== userFilter) return false;
        }
        return true;
      })
    : [];

  // Title and subtitle based on role
  const pageTitle = isAdmin
    ? 'Objetivos de la organizacion'
    : isManager
      ? 'Objetivos del equipo'
      : 'Mis Objetivos';

  const pageSubtitle = isAdmin
    ? 'Define y supervisa los objetivos de todos los colaboradores'
    : isManager
      ? 'Gestiona los objetivos de tu equipo y los tuyos propios'
      : 'Visualiza, propone y actualiza el progreso de tus objetivos';

  function handleCreate() {
    if (!form.title) return;
    const payload: any = {
      title: form.title,
      description: form.description || null,
      type: form.type,
      targetDate: form.targetDate || null,
    };
    // Admin/manager can assign to another user
    if ((isAdmin || isManager) && form.userId) {
      payload.userId = form.userId;
    }
    createObjective.mutate(payload, {
      onSuccess: () => {
        setForm({ title: '', description: '', type: 'OKR', targetDate: '', userId: '' });
        setShowForm(false);
      },
    });
  }

  function handleProgress(id: string) {
    addProgress.mutate(
      { id, data: { progressValue: progressForm.value, notes: progressForm.notes || null } },
      {
        onSuccess: () => {
          setExpandedId(null);
          setProgressForm({ value: 50, notes: '' });
        },
      },
    );
  }

  function handleSubmitForApproval(id: string) {
    submitForApproval.mutate(id);
  }

  function handleApprove(id: string) {
    approveObjective.mutate(id);
  }

  function handleReject(id: string) {
    rejectObjective.mutate(id);
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {pageTitle}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {pageSubtitle}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? 'Ocultar guia' : 'Como funciona'}
          </button>
          {canCreate && (
            <button className="btn-primary" onClick={() => { setShowForm(!showForm); setShowGuide(false); }}>
              {showForm ? 'Cancelar' : isEmployee ? '+ Proponer Objetivo' : '+ Nuevo Objetivo'}
            </button>
          )}
        </div>
      </div>

      {/* Employee note */}
      {isEmployee && (
        <div className="animate-fade-up" style={{
          padding: '0.6rem 0.9rem', marginBottom: '1rem',
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--warning)',
          lineHeight: 1.5,
        }}>
          Los objetivos que propongas quedaran en estado &lsquo;Ingresado&rsquo; hasta que tu encargado los apruebe.
        </div>
      )}

      {/* Guide / Explainer */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid #6366f1' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: '#6366f1' }}>
            Guia de uso: Objetivos
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
            Los objetivos permiten definir metas medibles para cada colaborador, alineadas con la estrategia de la organizacion.
            Se pueden vincular a ciclos de evaluacion para medir el cumplimiento en las revisiones de desempeno.
          </p>

          {/* Types explanation */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Tipos de objetivo</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

              {/* OKR */}
              <div style={{ padding: '1rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-accent">OKR</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Meta con resultados clave</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>
                  Define <strong>que quieres lograr</strong> (el objetivo) y <strong>como sabras que lo lograste</strong> (los resultados clave).
                  Se usa cuando la meta es grande y necesitas dividirla en pasos medibles.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#6366f1' }}>Ejemplo:</strong> &quot;Mejorar la satisfaccion del cliente&quot; con resultados clave como:
                  aumentar NPS de 60 a 80, reducir tiempo de respuesta a menos de 2 horas, lograr 95% de resolucion en primer contacto.
                </div>
              </div>

              {/* KPI */}
              <div style={{ padding: '1rem', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-warning">KPI</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Indicador numerico de rendimiento</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>
                  Es un <strong>numero que se mide de forma continua</strong> para saber si el trabajo va bien.
                  Se actualiza periodicamente (semanal, mensual) y permite detectar tendencias.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#f59e0b' }}>Ejemplo:</strong> &quot;Ventas mensuales: alcanzar $5.000.000&quot;, &quot;Tickets resueltos por semana: 30&quot;,
                  &quot;Tasa de retencion de clientes: mantener sobre 90%&quot;.
                </div>
              </div>

              {/* SMART */}
              <div style={{ padding: '1rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-success">SMART</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Tarea concreta con fecha limite</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>
                  Es un objetivo <strong>especifico, medible, alcanzable, relevante y con plazo definido</strong>.
                  Se usa para tareas o proyectos puntuales que tienen un inicio y un fin claro.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(16,185,129,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#10b981' }}>Ejemplo:</strong> &quot;Completar la certificacion de seguridad antes del 30 de junio&quot;,
                  &quot;Implementar el nuevo sistema de facturacion en 3 meses&quot;, &quot;Capacitar a 20 personas en el nuevo proceso antes de diciembre&quot;.
                </div>
              </div>

            </div>
          </div>

          {/* Role permissions */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Que puede hacer cada perfil</div>
            <div className="table-wrapper" style={{ fontSize: '0.78rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Accion</th>
                    <th>Enc. del Sistema</th>
                    <th>Enc. de Equipo</th>
                    <th>Colaborador</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Crear objetivos</td><td style={{ color: 'var(--success)' }}>Si (para cualquiera)</td><td style={{ color: 'var(--success)' }}>Si (para su equipo)</td><td style={{ color: 'var(--success)' }}>Si (proponer propios)</td></tr>
                  <tr><td>Aprobar objetivos</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si (su equipo)</td><td style={{ color: 'var(--text-muted)' }}>No</td></tr>
                  <tr><td>Ver objetivos</td><td style={{ color: 'var(--success)' }}>Todos</td><td style={{ color: 'var(--success)' }}>Su equipo + propios</td><td style={{ color: 'var(--success)' }}>Solo los suyos</td></tr>
                  <tr><td>Actualizar progreso</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si (solo los suyos)</td></tr>
                  <tr><td>Comentar</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si</td></tr>
                  <tr><td>Eliminar objetivos</td><td style={{ color: 'var(--success)' }}>Si</td><td style={{ color: 'var(--success)' }}>Si (su equipo)</td><td style={{ color: 'var(--text-muted)' }}>No</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Workflow */}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Flujo de trabajo</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              {[
                { step: '1', label: 'Crear / Proponer', desc: 'Se define titulo, tipo y fecha. Queda como Ingresado' },
                { step: '2', label: 'Aprobar', desc: 'El encargado aprueba y pasa a En progreso' },
                { step: '3', label: 'Avanzar', desc: 'El colaborador actualiza el % de avance' },
                { step: '4', label: 'Completar', desc: 'Al llegar al 100% se marca como completado' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>&rarr;</span>}
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, color: '#6366f1' }}>Paso {s.step}: {s.label}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter pills + user filter */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {filterPills.map((fp) => (
          <button
            key={fp.key}
            className={filter === fp.key ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            onClick={() => setFilter(fp.key)}
          >
            {fp.label}
          </button>
        ))}
        {showAssignedTo && uniqueUsers.length > 0 && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0.25rem' }}>|</span>
            <select
              className="input"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
            >
              <option value="all">Todos los usuarios</option>
              {uniqueUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* New objective form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            {isEmployee ? 'Proponer Objetivo' : 'Nuevo Objetivo'}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Assign to (admin/manager only) */}
            {(isAdmin || isManager) && (
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  Asignar a
                </label>
                <select
                  className="input"
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="">-- Seleccionar usuario --</option>
                  {allUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}{u.position ? ` - ${u.position}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Titulo
              </label>
              <input
                className="input"
                type="text"
                placeholder="Titulo del objetivo..."
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Descripcion
              </label>
              <textarea
                className="input"
                rows={2}
                placeholder="Describe el objetivo..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  Tipo
                </label>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as ObjType })}
                  style={{ width: '100%' }}
                >
                  <option value="OKR">OKR — Meta con resultados clave</option>
                  <option value="KPI">KPI — Indicador numerico</option>
                  <option value="SMART">SMART — Tarea concreta con plazo</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  Fecha objetivo
                </label>
                <input
                  className="input"
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={createObjective.isPending || !form.title || ((isAdmin || isManager) && !form.userId)}
              style={{ alignSelf: 'flex-start' }}
            >
              {createObjective.isPending ? 'Creando...' : isEmployee ? 'Proponer Objetivo' : 'Crear Objetivo'}
            </button>
          </div>
        </div>
      )}

      {/* Objectives grid */}
      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {objectives && objectives.length > 0
              ? 'No hay objetivos con este filtro'
              : 'No hay objetivos registrados'}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {objectives && objectives.length > 0
              ? 'Prueba con otro filtro'
              : isEmployee
                ? 'Propone tu primer objetivo para comenzar'
                : 'Crea tu primer objetivo para comenzar'}
          </p>
        </div>
      ) : (
        <div
          className="animate-fade-up"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}
        >
          {filtered.map((obj: any) => {
            const progress = Number(obj.progress) || 0;
            const color = progressColor(progress);
            const isExpanded = expandedId === obj.id;
            const days = daysUntil(obj.targetDate);
            const alert = deadlineAlert(days, obj.status);
            const assignedName = obj.user ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim() : null;

            return (
              <div key={obj.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', borderLeft: alert ? `3px solid ${alert.color}` : undefined }}>
                {/* Deadline alert banner */}
                {alert && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.4rem 0.6rem', marginBottom: '0.6rem',
                    background: `${alert.color}12`, borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem', fontWeight: 600, color: alert.color,
                  }}>
                    <span style={{ fontSize: '0.9rem' }}>{alert.icon === '!' ? '\u26a0' : '\u23f0'}</span>
                    {alert.text}
                  </div>
                )}

                {/* Assigned to (admin/manager only) */}
                {showAssignedTo && assignedName && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '50%',
                      background: 'var(--accent)', color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '0.6rem', flexShrink: 0,
                    }}>
                      {assignedName[0]?.toUpperCase()}
                    </span>
                    Asignado a: <strong style={{ color: 'var(--text-secondary)' }}>{assignedName}</strong>
                  </div>
                )}

                {/* Title + badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.4, flex: 1, marginRight: '0.5rem' }}>
                    {obj.title}
                  </h3>
                  <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                    <span className={`badge ${typeBadge[obj.type] || 'badge-accent'}`}>{obj.type}</span>
                    <span className={`badge ${statusBadge[obj.status] || 'badge-accent'}`}>
                      {statusLabel[obj.status] || obj.status}
                    </span>
                  </div>
                </div>

                {/* Description */}
                {obj.description && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', lineHeight: 1.5 }}>
                    {obj.description}
                  </p>
                )}

                {/* Progress bar */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Progreso</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color }}>{progress}%</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                    <div style={{
                      width: `${progress}%`,
                      height: '100%',
                      borderRadius: '999px',
                      background: color,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>

                {/* Target date */}
                {obj.targetDate && (
                  <p style={{ fontSize: '0.75rem', color: days !== null && days < 0 ? 'var(--danger)' : 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: days !== null && days <= 7 ? 600 : 400 }}>
                    Fecha limite: {formatDate(obj.targetDate)}
                    {days !== null && days >= 0 && obj.status !== 'completed' && obj.status !== 'abandoned' && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({days} dias restantes)</span>
                    )}
                    {days !== null && days < 0 && obj.status !== 'completed' && obj.status !== 'abandoned' && (
                      <span style={{ color: 'var(--danger)', fontWeight: 600 }}> (vencido)</span>
                    )}
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedId(null);
                      } else {
                        setExpandedId(obj.id);
                        setProgressForm({ value: progress, notes: '' });
                      }
                    }}
                  >
                    {isExpanded ? 'Cerrar' : 'Actualizar'}
                  </button>
                  {/* Submit for approval button (employee, draft only) */}
                  {isEmployee && obj.status === 'draft' && obj.userId === userId && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--accent)', fontWeight: 600 }}
                      onClick={() => handleSubmitForApproval(obj.id)}
                      disabled={submitForApproval.isPending}
                    >
                      {'Enviar a aprobaci\u00f3n'}
                    </button>
                  )}
                  {/* Approve button for pending_approval objectives (admin/manager) */}
                  {canApprove && obj.status === 'pending_approval' && (
                    <>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--success)', fontWeight: 600 }}
                        onClick={() => handleApprove(obj.id)}
                        disabled={approveObjective.isPending}
                      >
                        Aprobar
                      </button>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--danger)', fontWeight: 600 }}
                        onClick={() => handleReject(obj.id)}
                        disabled={rejectObjective.isPending}
                      >
                        Rechazar
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--danger)' }}
                      onClick={() => {
                        if (confirm('Eliminar este objetivo?')) deleteObjective.mutate(obj.id);
                      }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>

                {/* Expanded section: progress update + comments */}
                {isExpanded && (
                  <>
                    {/* Progress update */}
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                          Progreso: {progressForm.value}%
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={progressForm.value}
                          onChange={(e) => setProgressForm({ ...progressForm, value: Number(e.target.value) })}
                          style={{ width: '100%', accentColor: 'var(--accent)' }}
                        />
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <textarea
                          className="input"
                          rows={2}
                          placeholder="Notas sobre el avance..."
                          value={progressForm.notes}
                          onChange={(e) => setProgressForm({ ...progressForm, notes: e.target.value })}
                          style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem' }}
                        />
                      </div>
                      <button
                        className="btn-primary"
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                        onClick={() => handleProgress(obj.id)}
                        disabled={addProgress.isPending}
                      >
                        {addProgress.isPending ? 'Guardando...' : 'Guardar progreso'}
                      </button>
                    </div>

                    {/* Comments section */}
                    <CommentsSection
                      objectiveId={obj.id}
                      currentUserId={userId}
                      isAdmin={isAdmin}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
