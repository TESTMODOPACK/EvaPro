'use client';

import { useState, useRef, useEffect } from 'react';
import { useUnreadCount, useNotifications, useMarkAsRead, useMarkAllAsRead } from '@/hooks/useNotifications';

const typeIcons: Record<string, string> = {
  EVALUATION_PENDING: '\uD83D\uDCDD',
  EVALUATION_COMPLETED: '\u2705',
  CHECKIN_SCHEDULED: '\uD83D\uDCC5',
  CHECKIN_REJECTED: '\u274C',
  CHECKIN_OVERDUE: '\u23F0',
  FEEDBACK_RECEIVED: '\uD83D\uDCAC',
  PDI_ACTION_DUE: '\uD83C\uDFAF',
  OBJECTIVE_AT_RISK: '\u26A0\uFE0F',
  CYCLE_CLOSING: '\uD83D\uDD14',
  CALIBRATION_PENDING: '\u2696\uFE0F',
  STAGE_ADVANCED: '\u27A1\uFE0F',
  GENERAL: '\uD83D\uDD35',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

export default function NotificationBell() {
  const { data: unreadData } = useUnreadCount();
  const { data: notifications } = useNotifications(15);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = unreadData?.count || 0;

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={unreadCount > 0 ? `Notificaciones: ${unreadCount} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          padding: '0.4rem',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
          transition: 'color 0.15s',
        }}
        title="Notificaciones"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '0',
            right: '0',
            background: 'var(--danger)',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 800,
            borderRadius: '50%',
            width: '16px',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}>
            <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="region"
          aria-label="Panel de notificaciones"
          aria-live="polite"
          style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '360px',
          maxWidth: 'calc(100vw - 2rem)',
          maxHeight: '460px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 10px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          zIndex: 1000,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{'Notificaciones'}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllAsRead.mutate()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {'Marcar todas como le\u00eddas'}
                </button>
              )}
              <a
                href="/dashboard/notificaciones"
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
                onClick={() => setOpen(false)}
              >
                {'Ver todas'}
              </a>
            </div>
          </div>

          {/* Notification list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {!notifications || notifications.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{'No hay notificaciones'}</p>
              </div>
            ) : (
              notifications.map((n: any) => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markAsRead.mutate(n.id);
                  }}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    cursor: n.isRead ? 'default' : 'pointer',
                    background: n.isRead ? 'transparent' : 'rgba(99,102,241,0.04)',
                    transition: 'background 0.15s',
                    display: 'flex',
                    gap: '0.65rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: '0.1rem' }}>
                    {typeIcons[n.type] || typeIcons.GENERAL}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <p style={{
                        fontSize: '0.8rem',
                        fontWeight: n.isRead ? 500 : 700,
                        margin: 0,
                        color: 'var(--text-primary)',
                        lineHeight: 1.3,
                      }}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <span style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          flexShrink: 0,
                          marginTop: '0.3rem',
                        }} />
                      )}
                    </div>
                    <p style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                      margin: '0.15rem 0 0',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {n.message}
                    </p>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
