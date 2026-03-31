'use client';

import { useTranslation } from 'react-i18next';
import { useNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount } from '@/hooks/useNotifications';

const typeIcons: Record<string, string> = {
  evaluation_pending: '\uD83D\uDCDD',
  evaluation_completed: '\u2705',
  checkin_scheduled: '\uD83D\uDCC5',
  checkin_rejected: '\u274C',
  checkin_overdue: '\u23F0',
  feedback_received: '\uD83D\uDCAC',
  pdi_action_due: '\uD83C\uDFAF',
  objective_at_risk: '\u26A0\uFE0F',
  cycle_closing: '\uD83D\uDD14',
  cycle_closed: '\u2705',
  calibration_pending: '\u2696\uFE0F',
  stage_advanced: '\u27A1\uFE0F',
  escalation_evaluation_overdue: '\uD83D\uDEA8',
  escalation_pdi_overdue: '\uD83D\uDEA8',
  escalation_objective_critical: '\uD83D\uDEA8',
  pdi_required: '\uD83D\uDCCB',
  subscription_expiring: '\u23F3',
  subscription_expiring_urgent: '\u26A0\uFE0F',
  general: '\uD83D\uDD35',
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
  const { t } = useTranslation();
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('notificaciones.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {unreadCount > 0
              ? `${unreadCount} ${t('notificaciones.unread')}`
              : t('notificaciones.allRead')}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            className="btn-primary"
            style={{ fontSize: '0.82rem' }}
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            {markAllAsRead.isPending ? t('notificaciones.marking') : t('notificaciones.markAllRead')}
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : !notifications || notifications.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\uD83D\uDD14'}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{t('notificaciones.empty')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {t('notificaciones.emptyHint')}
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
                {typeIcons[n.type] || typeIcons.general}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <p style={{ fontSize: '0.88rem', fontWeight: n.isRead ? 500 : 700, margin: 0, color: 'var(--text-primary)' }}>
                    {n.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <span className={`badge ${n.isRead ? 'badge-ghost' : 'badge-accent'}`} style={{ fontSize: '0.6rem' }}>
                      {t(`notificaciones.types.${n.type}`, { defaultValue: n.type })}
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
