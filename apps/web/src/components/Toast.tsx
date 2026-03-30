'use client';

import { useEffect, useState } from 'react';
import { useToastStore, ToastItem, ToastType } from '@/store/toast.store';

const ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLOR: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: {
    bg: 'rgba(16,185,129,0.1)',
    border: 'rgba(16,185,129,0.35)',
    text: 'var(--success)',
  },
  error: {
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.3)',
    text: 'var(--danger)',
  },
  warning: {
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.35)',
    text: 'var(--warning)',
  },
  info: {
    bg: 'rgba(99,102,241,0.1)',
    border: 'rgba(99,102,241,0.3)',
    text: 'var(--accent)',
  },
};

function ToastEntry({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on mount
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const c = COLOR[toast.type];

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm, 0.5rem)',
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        minWidth: '260px',
        maxWidth: '380px',
        backdropFilter: 'blur(4px)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.22s ease, transform 0.22s ease',
      }}
    >
      {/* Icon */}
      <span
        style={{
          flexShrink: 0,
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: c.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.75rem',
          fontWeight: 800,
          color: c.text,
          marginTop: '0.05rem',
        }}
      >
        {ICON[toast.type]}
      </span>

      {/* Message */}
      <span
        style={{
          flex: 1,
          fontSize: '0.845rem',
          color: 'var(--text-primary)',
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        {toast.message}
      </span>

      {/* Dismiss */}
      <button
        onClick={() => dismiss(toast.id)}
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '0 0.15rem',
          marginTop: '-0.05rem',
          opacity: 0.6,
        }}
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  );
}

export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastEntry toast={t} />
        </div>
      ))}
    </div>
  );
}
