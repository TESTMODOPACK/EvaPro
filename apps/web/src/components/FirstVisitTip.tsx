'use client';

import { useState, useEffect } from 'react';

const STORAGE_PREFIX = 'evapro_tip_seen_';

interface FirstVisitTipProps {
  /** Unique key for this tip (persisted in localStorage) */
  id: string;
  /** Title of the tip */
  title: string;
  /** Description text */
  description: string;
  /** Optional icon (emoji) */
  icon?: string;
}

/**
 * Shows a dismissible tip card on the user's first visit to a section.
 * Once dismissed, it never shows again (persisted in localStorage).
 */
export function FirstVisitTip({ id, title, description, icon }: FirstVisitTipProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    if (!seen) setVisible(true);
  }, [id]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, '1');
    }
  };

  return (
    <div className="animate-fade-up" style={{
      padding: '0.85rem 1.15rem',
      marginBottom: '1.25rem',
      background: 'linear-gradient(135deg, rgba(201,147,58,0.06) 0%, rgba(201,147,58,0.02) 100%)',
      border: '1px solid rgba(201,147,58,0.2)',
      borderRadius: 'var(--radius-sm, 8px)',
      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
    }}>
      {icon && <span style={{ fontSize: '1.3rem', flexShrink: 0, marginTop: '0.1rem' }}>{icon}</span>}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', marginBottom: '0.2rem' }}>{title}</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{description}</p>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'rgba(201,147,58,0.1)', border: '1px solid rgba(201,147,58,0.25)',
          borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer',
          padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 600,
          color: 'var(--accent)', whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        Entendido
      </button>
    </div>
  );
}
