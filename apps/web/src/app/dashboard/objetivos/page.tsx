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
  useKeyResults,
  useCreateKeyResult,
  useUpdateKeyResult,
  useDeleteKeyResult,
  useTeamObjectivesSummary,
  useAtRiskObjectives,
  useObjectiveTree,
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
  felicitacion: 'Felicitación',
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
  if (days < 0) return { color: 'var(--danger)', text: `Vencido hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? 's' : ''}`, icon: '!' };
  if (days === 0) return { color: 'var(--danger)', text: 'Vence hoy', icon: '!' };
  if (days <= 3) return { color: 'var(--danger)', text: `Vence en ${days} día${days !== 1 ? 's' : ''}`, icon: '!' };
  if (days <= 7) return { color: 'var(--warning)', text: `Vence en ${days} días`, icon: '~' };
  if (days <= 15) return { color: '#f59e0b', text: `Vence en ${days} días`, icon: '' };
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

  const token = useAuthStore((s) => s.token);
  const [content, setContent] = useState('');
  const [type, setType] = useState<CommentType>('comentario');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
      const res = await fetch(`${BASE_URL}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al subir archivo');
      }
      const result = await res.json();
      setAttachmentUrl(result.url);
      setAttachmentName(result.originalName || file.name);
    } catch (err: any) {
      alert(err.message || 'Error al subir el archivo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '180px' }}>
              {!attachmentUrl ? (
                <>
                  <label
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border)', cursor: uploading ? 'wait' : 'pointer',
                      fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--bg-surface)',
                    }}
                  >
                    {uploading ? 'Subiendo...' : '\uD83D\uDCCE Cargar archivo'}
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {'M\u00e1x. 10MB \u2022 PDF, Word, Excel, im\u00e1genes'}
                  </span>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--success)' }}>{'✓'}</span>
                  <span style={{ color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {attachmentName}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setAttachmentUrl(''); setAttachmentName(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '0.8rem', padding: 0 }}
                    title="Quitar archivo"
                  >
                    {'✕'}
                  </button>
                </div>
              )}
            </div>
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

/* ─── Key Results Sub-component ───────────────────────────────────────────── */

function KeyResultsSection({ objectiveId }: { objectiveId: string }) {
  const { data: keyResults, isLoading } = useKeyResults(objectiveId);
  const createKR = useCreateKeyResult();
  const updateKR = useUpdateKeyResult();
  const deleteKR = useDeleteKeyResult();

  const [showAddKR, setShowAddKR] = useState(false);
  const [krForm, setKrForm] = useState({ description: '', unit: '%', baseValue: 0, targetValue: 100 });
  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(0);

  function handleAddKR() {
    if (!krForm.description.trim()) return;
    createKR.mutate(
      { objectiveId, data: krForm },
      { onSuccess: () => { setKrForm({ description: '', unit: '%', baseValue: 0, targetValue: 100 }); setShowAddKR(false); } },
    );
  }

  function handleUpdateValue(krId: string, currentValue: number) {
    updateKR.mutate({ krId, data: { currentValue } }, { onSuccess: () => setEditingKrId(null) });
  }

  function krProgress(kr: any): number {
    const range = Number(kr.targetValue) - Number(kr.baseValue);
    if (range <= 0) return kr.status === 'completed' ? 100 : 0;
    return Math.min(100, Math.max(0, ((Number(kr.currentValue) - Number(kr.baseValue)) / range) * 100));
  }

  return (
    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Key Results
        </div>
        <button
          className="btn-ghost"
          style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
          onClick={() => setShowAddKR(!showAddKR)}
        >
          {showAddKR ? 'Cancelar' : '+ Agregar KR'}
        </button>
      </div>

      {/* Add KR form */}
      {showAddKR && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.6rem', padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
          <input
            className="input"
            type="text"
            placeholder="Descripcion del resultado clave..."
            value={krForm.description}
            onChange={(e) => setKrForm({ ...krForm, description: e.target.value })}
            style={{ width: '100%', fontSize: '0.78rem' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Unidad</label>
              <input className="input" type="text" value={krForm.unit} onChange={(e) => setKrForm({ ...krForm, unit: e.target.value })} style={{ width: '100%', fontSize: '0.78rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Valor base</label>
              <input className="input" type="number" value={krForm.baseValue} onChange={(e) => setKrForm({ ...krForm, baseValue: Number(e.target.value) })} style={{ width: '100%', fontSize: '0.78rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Meta</label>
              <input className="input" type="number" value={krForm.targetValue} onChange={(e) => setKrForm({ ...krForm, targetValue: Number(e.target.value) })} style={{ width: '100%', fontSize: '0.78rem' }} />
            </div>
          </div>
          <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', alignSelf: 'flex-start' }} onClick={handleAddKR} disabled={createKR.isPending || !krForm.description.trim()}>
            {createKR.isPending ? 'Creando...' : 'Crear KR'}
          </button>
        </div>
      )}

      {/* KR list */}
      {isLoading ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : keyResults && keyResults.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {keyResults.map((kr: any) => {
            const prog = Math.round(krProgress(kr));
            const progColor = progressColor(prog);
            const isEditing = editingKrId === kr.id;
            return (
              <div key={kr.id} style={{ padding: '0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{kr.description}</span>
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <span className={`badge ${kr.status === 'completed' ? 'badge-success' : 'badge-accent'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                      {kr.status === 'completed' ? 'Completado' : 'Activo'}
                    </span>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.7rem', padding: '0.15rem 0.3rem', color: 'var(--danger)' }}
                      onClick={() => { if (confirm('Eliminar este KR?')) deleteKR.mutate(kr.id); }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <div style={{ flex: 1, height: '5px', borderRadius: '999px', background: 'var(--border)' }}>
                    <div style={{ width: `${prog}%`, height: '100%', borderRadius: '999px', background: progColor, transition: 'width 0.3s ease' }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: progColor, minWidth: '35px', textAlign: 'right' }}>{prog}%</span>
                </div>
                {/* Values */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span>Base: {kr.baseValue} {kr.unit}</span>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <input className="input" type="number" value={editValue} onChange={(e) => setEditValue(Number(e.target.value))} style={{ width: '80px', fontSize: '0.72rem', padding: '0.2rem 0.4rem' }} />
                      <button className="btn-primary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }} onClick={() => handleUpdateValue(kr.id, editValue)}>OK</button>
                      <button className="btn-ghost" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }} onClick={() => setEditingKrId(null)}>X</button>
                    </div>
                  ) : (
                    <span style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--accent)' }} onClick={() => { setEditingKrId(kr.id); setEditValue(Number(kr.currentValue)); }}>
                      Actual: {kr.currentValue} / {kr.targetValue} {kr.unit}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sin Key Results. Agrega resultados clave para medir el avance.</p>
      )}
    </div>
  );
}

/* ─── Team Summary Sub-component ─────────────────────────────────────────── */

function TeamSummaryView() {
  const { data, isLoading } = useTeamObjectivesSummary();
  const [searchName, setSearchName] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [filterRisk, setFilterRisk] = useState<'all' | 'at_risk' | 'ok'>('all');

  if (isLoading) return <Spinner />;
  if (!data || !data.members || data.members.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No hay colaboradores con objetivos asignados.</p>
      </div>
    );
  }

  const { members, totals } = data;

  // Build unique departments for filter
  const departments: string[] = Array.from(
    new Set(members.map((m: any) => m.department).filter(Boolean))
  ).sort() as string[];

  // Apply filters
  const filtered = members.filter((m: any) => {
    if (searchName && !m.userName.toLowerCase().includes(searchName.toLowerCase())) return false;
    if (filterDept !== 'all' && m.department !== filterDept) return false;
    if (filterRisk === 'at_risk' && m.atRiskCount === 0) return false;
    if (filterRisk === 'ok' && m.atRiskCount > 0) return false;
    return true;
  });

  return (
    <div>
      {/* Explanation */}
      <div style={{
        padding: '0.65rem 0.9rem', marginBottom: '1.25rem',
        background: 'rgba(99,102,241,0.05)', borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        Resumen del progreso de objetivos de cada miembro directo de tu equipo.
        Permite detectar quién está en riesgo de no cumplir sus metas.
      </div>

      {/* Team totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{totals.totalMembers}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Miembros del equipo</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{totals.totalObjectives}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Objetivos totales</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: progressColor(totals.avgProgress) }}>{totals.avgProgress}%</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Progreso promedio</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: totals.totalAtRisk > 0 ? 'var(--danger)' : 'var(--success)' }}>{totals.totalAtRisk}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>En riesgo</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Buscar colaborador..."
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          style={{
            padding: '0.4rem 0.75rem', fontSize: '0.82rem',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)', color: 'var(--text-primary)',
            minWidth: '200px',
          }}
        />
        {departments.length > 0 && (
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            style={{
              padding: '0.4rem 0.75rem', fontSize: '0.82rem',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)',
            }}
          >
            <option value="all">Todos los departamentos</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select
          value={filterRisk}
          onChange={(e) => setFilterRisk(e.target.value as any)}
          style={{
            padding: '0.4rem 0.75rem', fontSize: '0.82rem',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)', color: 'var(--text-primary)',
          }}
        >
          <option value="all">Todos los estados</option>
          <option value="at_risk">En riesgo</option>
          <option value="ok">Sin riesgo</option>
        </select>
        {(searchName || filterDept !== 'all' || filterRisk !== 'all') && (
          <button
            className="btn-ghost"
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
            onClick={() => { setSearchName(''); setFilterDept('all'); setFilterRisk('all'); }}
          >
            Limpiar filtros
          </button>
        )}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length} de {members.length} miembro{members.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Per-member cards */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No se encontraron colaboradores con los filtros aplicados.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {filtered.map((m: any) => {
            const color = progressColor(m.avgProgress);
            return (
              <div key={m.userId} className="card" style={{ padding: '1rem', borderLeft: m.atRiskCount > 0 ? '3px solid var(--danger)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{m.userName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {[m.position, m.department].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {m.atRiskCount > 0 && (
                    <span className="badge badge-danger" style={{ fontSize: '0.68rem' }}>{m.atRiskCount} en riesgo</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                    <div style={{ width: `${m.avgProgress}%`, height: '100%', borderRadius: '999px', background: color, transition: 'width 0.3s ease' }} />
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color }}>{m.avgProgress}%</span>
                </div>
                {m.totalObjectives === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Sin objetivos asignados
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>Activos: {m.activeCount}</span>
                    <span>Completados: {m.completedCount}</span>
                    {m.totalWeight > 0 && <span>Peso: {m.totalWeight}%</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Objective Tree View ─────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  draft: '#f59e0b',
  pending_approval: '#94a3b8',
  active: '#10b981',
  completed: '#6366f1',
  abandoned: '#ef4444',
};

function TreeNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const color = STATUS_COLORS[node.status] || '#94a3b8';

  return (
    <div style={{ marginLeft: depth > 0 ? '1.5rem' : 0 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.75rem', marginBottom: '0.25rem',
          background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          borderLeft: `3px solid ${color}`,
        }}
      >
        {hasChildren && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', padding: 0, width: 16 }}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        )}
        {!hasChildren && <span style={{ width: 16, display: 'inline-block' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.title}
          </div>
          {node.userName && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{node.userName}{node.userPosition ? ` · ${node.userPosition}` : ''}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: color }}>{node.progress}%</span>
          <div style={{ width: 48, height: 5, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${node.progress}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: '0.68rem', background: `${color}20`, color, borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
            {node.type}
          </span>
          {hasChildren && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{node.children.length} sub</span>
          )}
        </div>
      </div>
      {hasChildren && !collapsed && (
        <div style={{ borderLeft: '2px dashed var(--border)', marginLeft: '0.85rem', paddingLeft: '0.25rem' }}>
          {node.children.map((child: any) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveTreeView({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (!data || data.length === 0) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No hay objetivos para mostrar en el árbol</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.25rem' }}>Los objetivos con "objetivo padre" asignado aparecerán aquí como jerarquía</p>
      </div>
    );
  }
  const totalCount = (nodes: any[]): number => nodes.reduce((sum, n) => sum + 1 + totalCount(n.children || []), 0);
  return (
    <div className="animate-fade-up">
      <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        {totalCount(data)} objetivo(s) · Raíces: {data.length} · Haz clic en ▼ para colapsar ramas
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {data.map((root: any) => (
          <TreeNode key={root.id} node={root} />
        ))}
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
  const [searchFilter, setSearchFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [progressForm, setProgressForm] = useState<{ value: number; notes: string }>({ value: 50, notes: '' });
  const [form, setForm] = useState({ title: '', description: '', type: 'OKR' as ObjType, targetDate: '', userId: '', parentObjectiveId: '' });
  const [activeTab, setActiveTab] = useState<'list' | 'team' | 'tree'>('list');
  const { data: treeData, isLoading: treeLoading } = useObjectiveTree();

  // Item 13: At-risk objectives count
  const { data: atRiskData } = useAtRiskObjectives();
  const atRiskCount = atRiskData?.length || 0;

  // Item 10: Weight total calculation
  const myObjectives = objectives?.filter((o: any) => {
    const uid = o.userId || o.user?.id;
    return uid === userId && o.status !== 'abandoned';
  }) || [];
  const totalWeight = myObjectives.reduce((sum: number, o: any) => sum + Number(o.weight || 0), 0);

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

  // Dept options for filter dropdown
  const deptOptions = Array.from(new Set(
    (objectives || []).map((o: any) => o.user?.department).filter(Boolean)
  )).sort() as string[];

  // Filter objectives
  const filtered = objectives
    ? objectives.filter((o: any) => {
        if (filter !== 'all' && o.status !== filter) return false;
        if (userFilter !== 'all') {
          const uid = o.userId || o.user?.id;
          if (uid !== userFilter) return false;
        }
        if (typeFilter && o.type !== typeFilter) return false;
        if (deptFilter && (o.user?.department || '') !== deptFilter) return false;
        if (searchFilter) {
          const name = o.user
            ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.toLowerCase()
            : '';
          const title = (o.title || '').toLowerCase();
          const q = searchFilter.toLowerCase();
          if (!name.includes(q) && !title.includes(q)) return false;
        }
        return true;
      })
    : [];

  // Title and subtitle based on role
  const pageTitle = isAdmin
    ? 'Objetivos de la organización'
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
    if (form.parentObjectiveId) {
      payload.parentObjectiveId = form.parentObjectiveId;
    }
    createObjective.mutate(payload, {
      onSuccess: () => {
        setForm({ title: '', description: '', type: 'OKR', targetDate: '', userId: '', parentObjectiveId: '' });
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {pageTitle}
            {atRiskCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--danger)', color: '#fff', borderRadius: '999px',
                fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                minWidth: '22px',
              }}>
                {atRiskCount} en riesgo
              </span>
            )}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {pageSubtitle}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? 'Ocultar guía' : 'Cómo funciona'}
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
          Los objetivos que propongas quedarán en estado &lsquo;Borrador&rsquo; hasta que tu encargado los apruebe.
        </div>
      )}

      {/* Guide / Explainer */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid #6366f1' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: '#6366f1' }}>
            Guía de uso: Objetivos
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
            Los objetivos permiten definir metas medibles para cada colaborador, alineadas con la estrategia de la organización.
            Se pueden vincular a ciclos de evaluación para medir el cumplimiento en las revisiones de desempeño.
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
                  Define <strong>qué quieres lograr</strong> (el objetivo) y <strong>cómo sabrás que lo lograste</strong> (los resultados clave).
                  Se usa cuando la meta es grande y necesitas dividirla en pasos medibles.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#6366f1' }}>Ejemplo:</strong> &quot;Mejorar la satisfacción del cliente&quot; con resultados clave como:
                  aumentar NPS de 60 a 80, reducir tiempo de respuesta a menos de 2 horas, lograr 95% de resolución en primer contacto.
                </div>
              </div>

              {/* KPI */}
              <div style={{ padding: '1rem', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-warning">KPI</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Indicador numérico de rendimiento</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>
                  Es un <strong>número que se mide de forma continua</strong> para saber si el trabajo va bien.
                  Se actualiza periódicamente (semanal, mensual) y permite detectar tendencias.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#f59e0b' }}>Ejemplo:</strong> &quot;Ventas mensuales: alcanzar $5.000.000&quot;, &quot;Tickets resueltos por semana: 30&quot;,
                  &quot;Tasa de retención de clientes: mantener sobre 90%&quot;.
                </div>
              </div>

              {/* SMART */}
              <div style={{ padding: '1rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-success">SMART</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Tarea concreta con fecha límite</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', lineHeight: 1.5 }}>
                  Es un objetivo <strong>específico, medible, alcanzable, relevante y con plazo definido</strong>.
                  Se usa para tareas o proyectos puntuales que tienen un inicio y un fin claro.
                </p>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(16,185,129,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#10b981' }}>Ejemplo:</strong> &quot;Completar la certificación de seguridad antes del 30 de junio&quot;,
                  &quot;Implementar el nuevo sistema de facturación en 3 meses&quot;, &quot;Capacitar a 20 personas en el nuevo proceso antes de diciembre&quot;.
                </div>
              </div>

            </div>
          </div>

          {/* Role permissions */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Qué puede hacer cada perfil</div>
            <div className="table-wrapper" style={{ fontSize: '0.78rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Acción</th>
                    <th>Enc. del Sistema</th>
                    <th>Enc. de Equipo</th>
                    <th>Colaborador</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Crear objetivos</td><td style={{ color: 'var(--success)' }}>Sí (para cualquiera)</td><td style={{ color: 'var(--success)' }}>Sí (para su equipo)</td><td style={{ color: 'var(--success)' }}>Sí (proponer propios)</td></tr>
                  <tr><td>Aprobar objetivos</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí (su equipo)</td><td style={{ color: 'var(--text-muted)' }}>No</td></tr>
                  <tr><td>Ver objetivos</td><td style={{ color: 'var(--success)' }}>Todos</td><td style={{ color: 'var(--success)' }}>Su equipo + propios</td><td style={{ color: 'var(--success)' }}>Solo los suyos</td></tr>
                  <tr><td>Actualizar progreso</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí (solo los suyos)</td></tr>
                  <tr><td>Comentar</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí</td></tr>
                  <tr><td>Eliminar objetivos</td><td style={{ color: 'var(--success)' }}>Sí</td><td style={{ color: 'var(--success)' }}>Sí (su equipo)</td><td style={{ color: 'var(--text-muted)' }}>No</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Workflow */}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Flujo de trabajo</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              {[
                { step: '1', label: 'Crear / Proponer', desc: 'Se define título, tipo y fecha. Queda como Borrador' },
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

      {/* Tabs: Lista / Resumen del Equipo / Árbol */}
      {(isAdmin || isManager) && (
        <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
          <button
            onClick={() => setActiveTab('list')}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: activeTab === 'list' ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === 'list' ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '-2px',
            }}
          >
            Lista de Objetivos
          </button>
          {isManager && (
            <button
              onClick={() => setActiveTab('team')}
              style={{
                padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none', borderBottom: activeTab === 'team' ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === 'team' ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '-2px',
              }}
            >
              Resumen del Equipo
            </button>
          )}
          <button
            onClick={() => setActiveTab('tree')}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: activeTab === 'tree' ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === 'tree' ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '-2px',
            }}
          >
            Árbol de Alineación
          </button>
        </div>
      )}

      {/* Tree View — admin/manager only */}
      {activeTab === 'tree' && (isAdmin || isManager) ? (
        <ObjectiveTreeView data={treeData || []} loading={treeLoading} />
      ) : activeTab === 'team' && isManager ? (
        <TeamSummaryView />
      ) : (
      <>

      {/* Weight total bar — only shown when at least one objective has a weight > 0 */}
      {myObjectives.length > 0 && totalWeight > 0 && (
        <div className="animate-fade-up" style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.6rem 0.9rem', marginBottom: '1rem',
          background: totalWeight > 100 ? 'rgba(239,68,68,0.08)' : totalWeight === 100 ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${totalWeight > 100 ? 'rgba(239,68,68,0.2)' : totalWeight === 100 ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
          borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Peso relativo:</span>
          <div style={{ flex: 1, maxWidth: '200px', height: '6px', borderRadius: '999px', background: 'var(--border)' }}>
            <div style={{
              width: `${Math.min(100, totalWeight)}%`, height: '100%', borderRadius: '999px',
              background: totalWeight > 100 ? 'var(--danger)' : totalWeight === 100 ? 'var(--success)' : 'var(--warning)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{
            fontWeight: 700, fontSize: '0.85rem',
            color: totalWeight > 100 ? 'var(--danger)' : totalWeight === 100 ? 'var(--success)' : 'var(--warning)',
          }}>
            {totalWeight}% / 100%
          </span>
          {totalWeight > 100 && <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Excede el 100%</span>}
          {totalWeight < 100 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>La suma de pesos de tus objetivos no llega al 100%</span>}
        </div>
      )}

      {/* Filters bar */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {/* Status pills row */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
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
        </div>
        {/* Search + additional filters (admin/manager) */}
        {showAssignedTo && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Search by name or title */}
            <input
              className="input"
              type="text"
              placeholder="Buscar por nombre o título..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', width: '220px' }}
            />
            {/* Department filter */}
            {deptOptions.length > 0 && (
              <select
                className="input"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
              >
                <option value="">Todos los departamentos</option>
                {deptOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            {/* Type filter */}
            <select
              className="input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
            >
              <option value="">Todos los tipos</option>
              <option value="OKR">OKR</option>
              <option value="KPI">KPI</option>
              <option value="SMART">SMART</option>
            </select>
            {/* User filter */}
            {uniqueUsers.length > 0 && (
              <select
                className="input"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
              >
                <option value="all">Todos los colaboradores</option>
                {uniqueUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
            {/* Reset filters */}
            {(searchFilter || deptFilter || typeFilter || userFilter !== 'all') && (
              <button
                className="btn-ghost"
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: 'var(--text-muted)' }}
                onClick={() => { setSearchFilter(''); setDeptFilter(''); setTypeFilter(''); setUserFilter('all'); }}
              >
                ✕ Limpiar filtros
              </button>
            )}
          </div>
        )}
        {/* Employee: search by title + type only */}
        {!showAssignedTo && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              type="text"
              placeholder="Buscar objetivo..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', width: '200px' }}
            />
            <select
              className="input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', width: 'auto' }}
            >
              <option value="">Todos los tipos</option>
              <option value="OKR">OKR</option>
              <option value="KPI">KPI</option>
              <option value="SMART">SMART</option>
            </select>
            {(searchFilter || typeFilter) && (
              <button
                className="btn-ghost"
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: 'var(--text-muted)' }}
                onClick={() => { setSearchFilter(''); setTypeFilter(''); }}
              >
                ✕ Limpiar
              </button>
            )}
          </div>
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
                Título
              </label>
              <input
                className="input"
                type="text"
                placeholder="Título del objetivo..."
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Descripción
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
                  <option value="KPI">KPI — Indicador numérico</option>
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
            {/* Parent objective selector — cascading OKR alignment */}
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Objetivo padre <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional — para alineación jerárquica)</span>
              </label>
              <select
                className="input"
                value={form.parentObjectiveId}
                onChange={(e) => setForm({ ...form, parentObjectiveId: e.target.value })}
                style={{ width: '100%' }}
              >
                <option value="">Sin objetivo padre (nivel raíz)</option>
                {(objectives || []).filter((o: any) => o.status !== 'abandoned').map((o: any) => (
                  <option key={o.id} value={o.id}>
                    [{o.type}] {o.title}
                  </option>
                ))}
              </select>
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

      {/* Objectives list */}
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
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          {/* Build a flat list with optional group headers for admin/manager */}
          {(() => {
            type ListItem =
              | { type: 'header'; uid: string; user: any; objs: any[] }
              | { type: 'row'; obj: any };

            let items: ListItem[];
            if (showAssignedTo && userFilter === 'all') {
              // Group by collaborator
              const grouped: Record<string, any[]> = (filtered as any[]).reduce((acc: Record<string, any[]>, o: any) => {
                const uid = o.userId || o.user?.id || 'sin_asignar';
                if (!acc[uid]) acc[uid] = [];
                acc[uid].push(o);
                return acc;
              }, {});
              items = [];
              Object.entries(grouped).forEach(([uid, objs]) => {
                items.push({ type: 'header', uid, user: objs[0]?.user, objs });
                objs.forEach((obj) => items.push({ type: 'row', obj }));
              });
            } else {
              items = (filtered as any[]).map((obj) => ({ type: 'row' as const, obj }));
            }

            return items.map((item, idx) => {
              if (item.type === 'header') {
                const u = item.user;
                const userName = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Sin asignar';
                const dept = u?.department || '';
                const completedCount = item.objs.filter((o: any) => o.status === 'completed').length;
                const avgProg = Math.round(item.objs.reduce((s: number, o: any) => s + (Number(o.progress) || 0), 0) / item.objs.length);
                const pc = avgProg >= 75 ? 'var(--success)' : avgProg >= 40 ? 'var(--warning)' : 'var(--danger)';
                return (
                  <div key={`hdr-${item.uid}`} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    marginTop: idx > 0 ? '0.75rem' : 0,
                  }}>
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '50%',
                      background: 'var(--accent)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
                    }}>
                      {(userName[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{userName}</div>
                      {dept && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{dept}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.78rem', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {item.objs.length} objetivo{item.objs.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{
                        color: completedCount === item.objs.length ? 'var(--success)' : 'var(--text-muted)',
                        fontWeight: completedCount === item.objs.length ? 700 : 400,
                      }}>
                        {completedCount}/{item.objs.length} completados
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ width: '60px', height: '5px', borderRadius: '999px', background: 'var(--border)' }}>
                          <div style={{ width: `${avgProg}%`, height: '100%', borderRadius: '999px', background: pc }} />
                        </div>
                        <span style={{ fontWeight: 700, color: pc }}>{avgProg}%</span>
                      </div>
                    </div>
                  </div>
                );
              }

              /* ── objective card ─────────────────────────────────────── */
              const obj = item.obj;
              const progress = Number(obj.progress) || 0;
              const color = progressColor(progress);
              const isExpanded = expandedId === obj.id;
              const days = daysUntil(obj.targetDate);
              const alert = deadlineAlert(days, obj.status);
              const assignedName = obj.user ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim() : null;

              return (
              <div key={obj.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', borderLeft: (obj.status === 'active' && progress < 40) ? '3px solid var(--danger)' : alert ? `3px solid ${alert.color}` : undefined }}>
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
                    Fecha límite: {formatDate(obj.targetDate)}
                    {days !== null && days >= 0 && obj.status !== 'completed' && obj.status !== 'abandoned' && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({days} días restantes)</span>
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
                {isExpanded && (() => {
                  const isOwnObjective = (obj.userId || obj.user?.id) === userId;
                  const isOverrideByAdmin = (isAdmin || isManager) && !isOwnObjective;
                  const noteRequired = isOverrideByAdmin;
                  const canSaveProgress = !noteRequired || progressForm.notes.trim().length > 0;
                  return (
                  <>
                    {/* Progress update */}
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                      {/* Warning banner for admin/manager updating someone else's objective */}
                      {isOverrideByAdmin && (
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                          padding: '0.6rem 0.75rem', marginBottom: '0.75rem',
                          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                          borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--warning)', lineHeight: 1.5,
                        }}>
                          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
                          <span>
                            Estás modificando el progreso de <strong>{assignedName}</strong>.
                            Debes indicar el motivo en la nota — quedará registrado en el historial.
                          </span>
                        </div>
                      )}
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
                        <label style={{ fontSize: '0.72rem', color: noteRequired ? 'var(--warning)' : 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                          {isOverrideByAdmin ? 'Motivo de la actualización *' : 'Notas sobre el avance'}
                        </label>
                        <textarea
                          className="input"
                          rows={2}
                          placeholder={isOverrideByAdmin ? 'Ej: Actualizado en reunión de seguimiento del 27/03...' : 'Notas sobre el avance...'}
                          value={progressForm.notes}
                          onChange={(e) => setProgressForm({ ...progressForm, notes: e.target.value })}
                          style={{
                            width: '100%', resize: 'vertical', fontSize: '0.8rem',
                            borderColor: noteRequired && !progressForm.notes.trim() ? 'var(--warning)' : undefined,
                          }}
                        />
                        {noteRequired && !progressForm.notes.trim() && (
                          <p style={{ fontSize: '0.72rem', color: 'var(--warning)', marginTop: '0.2rem' }}>
                            La nota es obligatoria cuando actualizas el progreso de otro colaborador.
                          </p>
                        )}
                      </div>
                      <button
                        className="btn-primary"
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                        onClick={() => handleProgress(obj.id)}
                        disabled={addProgress.isPending || !canSaveProgress}
                      >
                        {addProgress.isPending ? 'Guardando...' : 'Guardar progreso'}
                      </button>
                    </div>

                    {/* Key Results section */}
                    <KeyResultsSection objectiveId={obj.id} />

                    {/* Comments section */}
                    <CommentsSection
                      objectiveId={obj.id}
                      currentUserId={userId}
                      isAdmin={isAdmin}
                    />
                  </>
                  );
                })()}
              </div>
            );
          })
        })()}
        </div>
      )}
      </>
      )}
    </div>
  );
}
