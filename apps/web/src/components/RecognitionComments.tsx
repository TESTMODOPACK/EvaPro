'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

/**
 * v3.1 F7 — Hilo de comentarios debajo de un reconocimiento.
 *
 * Lazy load: la lista se pide solo si `expanded=true`. Por default
 * muestra solo el contador ("N comentarios") — click expande.
 *
 * Permisos:
 *   - Cualquier user activo del tenant puede comentar (backend gate).
 *   - Solo el autor del comentario o admin puede borrarlo.
 */

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

export default function RecognitionComments({
  recognitionId,
  initialCount = 0,
}: {
  recognitionId: string;
  initialCount?: number;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const currentUserId = user?.userId || '';
  const toast = useToastStore((s) => s.toast);
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');

  const { data: comments, isLoading } = useQuery({
    queryKey: ['recognition', recognitionId, 'comments'],
    queryFn: () => api.recognition.listComments(token!, recognitionId),
    enabled: !!token && expanded,
    staleTime: 30_000,
  });

  const addComment = useMutation({
    mutationFn: (t: string) => api.recognition.addComment(token!, recognitionId, t),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['recognition', recognitionId, 'comments'] });
    },
    onError: (e: any) => toast(e?.message || 'Error al comentar', 'error'),
  });

  const deleteComment = useMutation({
    mutationFn: (id: string) => api.recognition.deleteComment(token!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recognition', recognitionId, 'comments'] });
    },
    onError: (e: any) => toast(e?.message || 'Error al borrar', 'error'),
  });

  const count = comments?.length ?? initialCount;

  const handleSubmit = () => {
    const t = text.trim();
    if (!t) return;
    addComment.mutate(t);
  };

  return (
    <div style={{ marginTop: '0.5rem', borderTop: '1px dashed var(--border)', paddingTop: '0.5rem' }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600,
          padding: '0.15rem 0', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        }}
      >
        💬 {expanded ? 'Cerrar' : count > 0 ? `${count} comentarios` : 'Comentar'}
      </button>

      {expanded && (
        <div style={{ marginTop: '0.5rem' }}>
          {isLoading && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Cargando…</div>
          )}
          {!isLoading && (comments || []).length === 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.4rem' }}>
              Sé el primero en comentar este reconocimiento.
            </div>
          )}
          {(comments || []).map((c) => {
            const canDelete = c.fromUserId === currentUserId || isAdmin;
            const authorName = c.fromUser
              ? `${c.fromUser.firstName} ${c.fromUser.lastName}`
              : 'Usuario';
            return (
              <div
                key={c.id}
                style={{
                  padding: '0.4rem 0.6rem',
                  background: 'rgba(99,102,241,0.04)',
                  border: '1px solid rgba(99,102,241,0.1)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  marginBottom: '0.35rem',
                  fontSize: '0.82rem',
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{authorName}</strong>
                    {' · '}{formatRelative(c.createdAt)}
                  </div>
                  <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {c.text}
                  </div>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('¿Borrar este comentario?')) deleteComment.mutate(c.id);
                    }}
                    title="Borrar comentario"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: '0.82rem',
                      padding: '0.1rem 0.35rem', lineHeight: 1, flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem' }}>
            <input
              className="input"
              type="text"
              placeholder="Agrega un comentario…"
              value={text}
              maxLength={1000}
              disabled={addComment.isPending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() && !addComment.isPending) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              style={{ flex: 1, fontSize: '0.82rem' }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={handleSubmit}
              disabled={addComment.isPending || !text.trim()}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
            >
              {addComment.isPending ? '…' : 'Enviar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
