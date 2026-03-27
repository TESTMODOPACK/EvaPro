'use client';

import Link from 'next/link';
import { useNextActions, type NextAction } from '@/hooks/useNextActions';

// ─── Icon set ────────────────────────────────────────────────────────────────

function IconEval() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  );
}

function IconOkr() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function IconCheckin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IconReview() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  );
}

// ─── Config per type ─────────────────────────────────────────────────────────

const typeConfig = {
  evaluation: {
    icon: <IconEval />,
    color: '#6366f1',
    bg: 'rgba(99,102,241,0.10)',
    label: 'Evaluación',
  },
  okr: {
    icon: <IconOkr />,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.10)',
    label: 'Objetivo',
  },
  checkin: {
    icon: <IconCheckin />,
    color: '#10b981',
    bg: 'rgba(16,185,129,0.10)',
    label: 'Check-in',
  },
  review: {
    icon: <IconReview />,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.10)',
    label: 'Revisión',
  },
};

const urgencyConfig = {
  high: { color: '#ef4444', label: 'Urgente', dot: '#ef4444' },
  medium: { color: '#f59e0b', label: 'Pronto', dot: '#f59e0b' },
  low: { color: '#94a3b8', label: '', dot: 'transparent' },
};

// ─── Action Row ───────────────────────────────────────────────────────────────

function ActionRow({ action }: { action: NextAction }) {
  const tc = typeConfig[action.type];
  const uc = urgencyConfig[action.urgency];

  const dueDateLabel = () => {
    if (action.daysLeft === null) return null;
    if (action.daysLeft < 0) return <span style={{ color: '#ef4444', fontWeight: 600 }}>Vencido</span>;
    if (action.daysLeft === 0) return <span style={{ color: '#ef4444', fontWeight: 600 }}>Hoy</span>;
    if (action.daysLeft === 1) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Mañana</span>;
    return <span style={{ color: 'var(--text-muted)' }}>en {action.daysLeft} días</span>;
  };

  return (
    <Link
      href={action.href}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.875rem',
        padding: '0.875rem 1rem',
        borderRadius: 'var(--radius-sm)',
        transition: 'background 0.15s ease',
        cursor: 'pointer',
      }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Type icon */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px',
          background: tc.bg, color: tc.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {tc.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {action.title}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
            {action.subtitle}
          </div>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem', flexShrink: 0 }}>
          <div style={{
            fontSize: '0.68rem', fontWeight: 600, color: tc.color,
            background: tc.bg, padding: '2px 8px', borderRadius: '999px',
          }}>
            {tc.label}
          </div>
          <div style={{ fontSize: '0.72rem' }}>
            {dueDateLabel()}
          </div>
        </div>

        {/* Urgency indicator */}
        {action.urgency !== 'low' && (
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: uc.dot, flexShrink: 0,
          }}/>
        )}

        {/* Arrow */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </Link>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '50%',
        background: 'rgba(16,185,129,0.10)', margin: '0 auto 0.75rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
        ¡Al día!
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        No tienes acciones pendientes por ahora.
      </p>
    </div>
  );
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

export function NextActionsWidget() {
  const { data, isLoading } = useNextActions();

  const actions = data?.actions ?? [];
  const highPriority = data?.highPriority ?? 0;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '1.1rem 1.25rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '8px',
            background: highPriority > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(99,102,241,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={highPriority > 0 ? '#ef4444' : '#6366f1'}
              strokeWidth="2.5" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>Próximas acciones</h2>
            {!isLoading && data && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                {data.total === 0
                  ? 'Todo al día'
                  : `${data.total} pendiente${data.total > 1 ? 's' : ''}${highPriority > 0 ? ` · ${highPriority} urgente${highPriority > 1 ? 's' : ''}` : ''}`
                }
              </p>
            )}
          </div>
        </div>

        {/* High-priority badge */}
        {highPriority > 0 && (
          <div style={{
            background: 'rgba(239,68,68,0.10)', color: '#ef4444',
            fontSize: '0.72rem', fontWeight: 700,
            padding: '3px 10px', borderRadius: '999px',
            animation: 'pulse 2s infinite',
          }}>
            {highPriority} urgente{highPriority > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
              <div className="skeleton" style={{ width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0 }}/>
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ height: '13px', width: '65%', borderRadius: '4px', marginBottom: '6px' }}/>
                <div className="skeleton" style={{ height: '11px', width: '40%', borderRadius: '4px' }}/>
              </div>
            </div>
          ))}
        </div>
      ) : actions.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ padding: '0.5rem 0' }}>
          {actions.map((action, i) => (
            <div key={action.id}>
              <ActionRow action={action} />
              {i < actions.length - 1 && (
                <div style={{ height: '1px', background: 'var(--border)', margin: '0 1rem' }}/>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {!isLoading && actions.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '0.6rem 1rem',
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
        }}>
          {Object.entries(typeConfig).map(([type, cfg]) => {
            const count = actions.filter((a) => a.type === type).length;
            if (count === 0) return null;
            return (
              <span key={type} style={{
                fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px',
                background: cfg.bg, color: cfg.color, fontWeight: 600,
              }}>
                {cfg.label}: {count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
