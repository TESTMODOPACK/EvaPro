'use client';

import { useNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount } from '@/hooks/useNotifications';

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

const typeLabels: Record<string, string> = {
  EVALUATION_PENDING: 'Evaluaci\u00f3n pendiente',
  EVALUATION_COMPLETED: 'Evaluaci\u00f3n completada',
  CHECKIN_SCHEDULED: 'Check-in programado',
  CHECKIN_REJECTED: 'Check-in rechazado',
  CHECKIN_OVERDUE: 'Check-in atrasado',
  FEEDBACK_RECEIVED: 'Feedback recibido',
  PDI_ACTION_DUE: 'Acci\u00f3n PDI vencida',
  OBJECTIVE_AT_RISK: 'Objetivo en riesgo',
  CYCLE_CLOSING: 'Ciclo por cerrar',
  CALIBRATION_PENDING: 'Calibraci\u00f3n pendiente',
  STAGE_ADVANCED: 'Etapa avanzada',
  GENERAL: 'General',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function NotificacionesPage() {
  const { data: notifications, isLoading } = useNotifications(100);
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unreadCount = unreadData?.count || 0;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{'Notificaciones'}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {unreadCount > 0
              ? `${unreadCount} notificaci${unreadCount === 1 ? '\u00f3n' : 'ones'} sin leer`
              : 'Todas las notificaciones le\u00eddas'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            className="btn-primary"
            style={{ fontSize: '0.82rem' }}
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            {markAllAsRead.isPending ? 'Marcando...' : 'Marcar todas como le\u00eddas'}
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : !notifications || notifications.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\uD83D\uDD14'}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{'No hay notificaciones'}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {'Las notificaciones se generan autom\u00e1ticamente cuando hay evaluaciones pendientes, check-ins, feedback recibido y m\u00e1s.'}
          </p>
        </div>
      ) : (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {notifications.map((n: any) => (
            <div
              key={n.id}
              className="card"
              onClick={() => { if (!n.isRead) markAsRead.mutate(n.id); }}
              style={{
                padding: '1rem 1.25rem',
                cursor: n.isRead ? 'default' : 'pointer',
                background: n.isRead ? 'var(--bg-surface)' : 'rgba(99,102,241,0.04)',
                borderLeft: n.isRead ? 'none' : '3px solid var(--accent)',
                transition: 'background 0.15s',
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: '1.3rem', flexShrink: 0, marginTop: '0.1rem' }}>
                {typeIcons[n.type] || typeIcons.GENERAL}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <p style={{ fontSize: '0.88rem', fontWeight: n.isRead ? 500 : 700, margin: 0, color: 'var(--text-primary)' }}>
                    {n.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <span className={`badge ${n.isRead ? 'badge-ghost' : 'badge-accent'}`} style={{ fontSize: '0.6rem' }}>
                      {typeLabels[n.type] || n.type}
                    </span>
                    {!n.isRead && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', lineHeight: 1.5 }}>
                  {n.message}
                </p>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>
                  {formatDate(n.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
