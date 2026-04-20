'use client';

import { useEffect, useRef } from 'react';
import useFocusTrap from '@/hooks/useFocusTrap';

interface ConfirmModalProps {
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  message,
  detail,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // P8-A: escape key para cerrar, accesibilidad de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // P8-D: focus trap dentro del dialog mientras está abierto.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  return (
    /* Overlay */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-message"
      onClick={(e) => {
        // P8-A fix drag-close: cierra solo si el click terminó en el
        // overlay mismo (no si el usuario arrastró desde el card).
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="card animate-fade-up"
        style={{
          padding: '1.75rem',
          maxWidth: '420px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: danger ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            marginBottom: '1rem',
          }}
        >
          {danger ? '🗑' : '⚠️'}
        </div>

        {/* Message */}
        <p
          id="confirm-modal-message"
          style={{
            fontWeight: 700,
            fontSize: '1rem',
            color: 'var(--text-primary)',
            marginBottom: detail ? '0.4rem' : '1.25rem',
          }}
        >
          {message}
        </p>

        {detail && (
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              marginBottom: '1.25rem',
              lineHeight: 1.5,
            }}
          >
            {detail}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onCancel} style={{ fontSize: '0.875rem' }}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.875rem',
              background: danger ? 'var(--danger)' : 'var(--accent)',
              color: '#fff',
              transition: 'var(--transition)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
