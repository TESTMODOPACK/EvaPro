'use client';

import React, { useEffect, useRef, useState } from 'react';
import useFocusTrap from '@/hooks/useFocusTrap';
import { useCompleteCheckIn } from '@/hooks/useFeedback';

export interface CheckInCompletionModalProps {
  open: boolean;
  checkinId: string;
  topic: string;
  employeeName: string;
  /** ActionItems pre-cargados desde la Agenda Mágica (carriedOver + pending del anterior). */
  seedActionItems?: Array<{ text: string; assigneeName?: string; dueDate?: string | null }>;
  onClose: () => void;
  onCompleted?: () => void;
}

interface EditableActionItem {
  text: string;
  assigneeName: string;
  dueDate: string;
  completed: boolean;
  /** True si el item viene pre-cargado desde carriedOverActionItems/pending.
   *  Solo los seeds son afectados por el toggle "Propagar pendientes". */
  isSeed: boolean;
}

export default function CheckInCompletionModal({
  open,
  checkinId,
  topic,
  employeeName,
  seedActionItems = [],
  onClose,
  onCompleted,
}: CheckInCompletionModalProps) {
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [minutes, setMinutes] = useState('');
  const [actionItems, setActionItems] = useState<EditableActionItem[]>([
    { text: '', assigneeName: '', dueDate: '', completed: false, isSeed: false },
  ]);
  const [propagatePending, setPropagatePending] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const complete = useCompleteCheckIn();

  useFocusTrap(dialogRef, open);

  // Seed actionItems desde la agenda (pending + carried-over) al abrir.
  useEffect(() => {
    if (!open) return;
    if (seedActionItems.length === 0) {
      setActionItems([{ text: '', assigneeName: '', dueDate: '', completed: false, isSeed: false }]);
      return;
    }
    setActionItems(
      seedActionItems.map((it) => ({
        text: it.text,
        assigneeName: it.assigneeName || '',
        dueDate: it.dueDate || '',
        completed: false,
        isSeed: true,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkinId]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !complete.isPending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, complete.isPending]);

  if (!open) return null;

  const ratingLabel = (r: number) =>
    r === 5 ? 'Muy productiva'
    : r === 4 ? 'Productiva'
    : r === 3 ? 'Normal'
    : r === 2 ? 'Poco productiva'
    : r === 1 ? 'No productiva'
    : 'Sin valorar';

  const handleSubmit = async () => {
    // Filtrar items vacíos.
    const valid = actionItems.filter((i) => i.text.trim());

    // Si el usuario desmarca "Propagar pendientes", marcamos SOLO los
    // SEEDS como completed=true → el snapshotPendingForNext del backend
    // los filtra fuera. Items NUEVOS ingresados en este 1:1 respetan
    // su checkbox local (para no perder compromisos recién capturados).
    const itemsToSend = valid.map((i) => ({
      text: i.text.trim(),
      completed: !propagatePending && i.isSeed ? true : i.completed,
      assigneeName: i.assigneeName.trim() || undefined,
      dueDate: i.dueDate || undefined,
    }));

    const data: any = {};
    if (notes.trim()) data.notes = notes.trim();
    if (minutes.trim()) data.minutes = minutes.trim();
    if (rating > 0) data.rating = rating;
    if (itemsToSend.length > 0) data.actionItems = itemsToSend;

    complete.mutate(
      { id: checkinId, data },
      {
        onSuccess: () => {
          onCompleted?.();
          onClose();
        },
      },
    );
  };

  const updateItem = (idx: number, patch: Partial<EditableActionItem>) => {
    setActionItems((items) => items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const removeItem = (idx: number) => {
    setActionItems((items) => items.filter((_, i) => i !== idx));
  };
  const addItem = () => {
    setActionItems((items) => [
      ...items,
      { text: '', assigneeName: '', dueDate: '', completed: false, isSeed: false },
    ]);
  };

  // Solo seeds uncompleted cuentan para el badge de propagación.
  const uncompletedSeedCount = actionItems.filter(
    (i) => i.text.trim() && !i.completed && i.isSeed,
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-completion-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !complete.isPending) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="card animate-fade-up"
        style={{
          padding: '1.5rem',
          maxWidth: '640px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h3
          id="checkin-completion-title"
          style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}
        >
          Completar Check-in 1:1
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 1.1rem' }}>
          <strong>{topic}</strong> — {employeeName}
        </p>

        {/* Rating */}
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'block',
              marginBottom: '0.4rem',
            }}
          >
            ¿Cómo fue la reunión?
          </label>
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                aria-label={`${star} estrella${star > 1 ? 's' : ''}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.4rem',
                  padding: '0.1rem',
                  opacity: star <= rating ? 1 : 0.3,
                  transition: 'opacity 0.15s',
                }}
              >
                ⭐
              </button>
            ))}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              {ratingLabel(rating)}
            </span>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'block',
              marginBottom: '0.3rem',
            }}
          >
            Notas de la reunión
          </label>
          <textarea
            className="input"
            rows={3}
            placeholder="Resumen de lo conversado, puntos importantes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        {/* Minutes */}
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'block',
              marginBottom: '0.3rem',
            }}
          >
            Minuta de la reunión{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
              (opcional — se puede agregar después)
            </span>
          </label>
          <textarea
            className="input"
            rows={4}
            placeholder="Detalle lo conversado: contexto, decisiones, seguimientos, próximos pasos…"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.82rem' }}
          />
        </div>

        {/* Action items */}
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'block',
              marginBottom: '0.3rem',
            }}
          >
            Acuerdos y compromisos
            {seedActionItems.length > 0 && (
              <span
                style={{
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                  marginLeft: '0.4rem',
                }}
              >
                (pre-cargados desde la agenda)
              </span>
            )}
          </label>
          {actionItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                gap: '0.4rem',
                marginBottom: '0.4rem',
                alignItems: 'center',
              }}
            >
              <input
                type="checkbox"
                checked={item.completed}
                onChange={(e) => updateItem(idx, { completed: e.target.checked })}
                aria-label="Marcar como cumplido"
                style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <input
                className="input"
                type="text"
                placeholder="Acuerdo o compromiso…"
                value={item.text}
                onChange={(e) => updateItem(idx, { text: e.target.value })}
                style={{
                  flex: 2,
                  fontSize: '0.82rem',
                  textDecoration: item.completed ? 'line-through' : 'none',
                  opacity: item.completed ? 0.6 : 1,
                }}
              />
              <input
                className="input"
                type="text"
                placeholder="Responsable"
                value={item.assigneeName}
                onChange={(e) => updateItem(idx, { assigneeName: e.target.value })}
                style={{ flex: 1, fontSize: '0.82rem' }}
              />
              <input
                className="input"
                type="date"
                value={item.dueDate}
                onChange={(e) => updateItem(idx, { dueDate: e.target.value })}
                style={{ width: '130px', fontSize: '0.82rem' }}
              />
              {actionItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label="Quitar acuerdo"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--danger)',
                    fontSize: '1rem',
                    padding: '0.3rem',
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}
            onClick={addItem}
          >
            + Agregar acuerdo
          </button>
        </div>

        {/* Propagar pendientes — solo aparece si hay SEEDS sin marcar */}
        {uncompletedSeedCount > 0 && (
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.55rem',
              padding: '0.7rem 0.85rem',
              borderRadius: 'var(--radius-sm, 8px)',
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(245,158,11,0.2)',
              marginBottom: '1rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={propagatePending}
              onChange={(e) => setPropagatePending(e.target.checked)}
              style={{ accentColor: 'var(--accent)', marginTop: '0.15rem' }}
            />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                Propagar pendientes al próximo 1:1
              </div>
              <div style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
                {uncompletedSeedCount} pendiente{uncompletedSeedCount !== 1 ? 's' : ''} heredado
                {uncompletedSeedCount !== 1 ? 's' : ''} del 1:1 anterior aparecerá
                {uncompletedSeedCount !== 1 ? 'n' : ''} automáticamente en la próxima reunión.
                Desmárcalo para cerrarlos aquí.
              </div>
            </div>
          </label>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
            borderTop: '1px solid var(--border)',
            paddingTop: '1rem',
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={complete.isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={complete.isPending}
          >
            {complete.isPending ? 'Guardando…' : 'Completar Check-in'}
          </button>
        </div>

        {complete.isError && (
          <p
            style={{
              margin: '0.75rem 0 0',
              fontSize: '0.78rem',
              color: 'var(--danger)',
              textAlign: 'right',
            }}
          >
            {(complete.error as any)?.message || 'Error al completar el check-in'}
          </p>
        )}
      </div>
    </div>
  );
}
