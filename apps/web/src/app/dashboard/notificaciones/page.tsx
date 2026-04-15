'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import {
  useNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount,
  useDeleteNotification, useDeleteAllRead,
  useNotificationPreferences, useUpdateNotificationPreferences,
} from '@/hooks/useNotifications';
import { getNotificationHref, NOTIFICATION_CATEGORIES, NOTIFICATION_TYPE_LABELS } from '@/lib/notification-links';
import EmptyState from '@/components/EmptyState';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

// ─── Icons ──────────────────────────────────────────────────────────

const typeIcons: Record<string, string> = {
  evaluation_pending: '📝', evaluation_completed: '✅',
  checkin_scheduled: '📅', checkin_rejected: '❌', checkin_overdue: '⏰',
  feedback_received: '💬', pdi_action_due: '🎯',
  objective_at_risk: '⚠️', cycle_closing: '🔔', cycle_closed: '✅',
  calibration_pending: '⚖️', stage_advanced: '➡️',
  escalation_evaluation_overdue: '🚨', escalation_pdi_overdue: '🚨',
  escalation_objective_critical: '🚨', pdi_required: '📋',
  subscription_expiring: '⏳', subscription_expiring_urgent: '⚠️',
  survey_invitation: '📋', survey_reminder: '🔔', survey_closed: '✅',
  general: '🔵',
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relativeTime(d: string) {
  const now = Date.now();
  const diff = now - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days}d`;
  return formatDate(d);
}

interface DateGroup {
  label: string;
  items: any[];
}

function groupByDate(notifications: any[]): DateGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;

  const groups: Record<string, any[]> = { Hoy: [], Ayer: [], 'Esta Semana': [], Anteriores: [] };

  for (const n of notifications) {
    const ts = new Date(n.createdAt).getTime();
    if (ts >= todayStart) groups['Hoy'].push(n);
    else if (ts >= yesterdayStart) groups['Ayer'].push(n);
    else if (ts >= weekStart) groups['Esta Semana'].push(n);
    else groups['Anteriores'].push(n);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// ─── Category filter pills ─────────────────────────────────────────

const CATEGORY_KEYS = ['all', ...Object.keys(NOTIFICATION_CATEGORIES)] as const;
type CategoryFilter = typeof CATEGORY_KEYS[number];

const categoryLabels: Record<string, string> = {
  all: 'Todas',
  ...Object.fromEntries(Object.entries(NOTIFICATION_CATEGORIES).map(([k, v]) => [k, v.label])),
};

function matchesCategory(type: string, category: CategoryFilter): boolean {
  if (category === 'all') return true;
  const cat = NOTIFICATION_CATEGORIES[category as keyof typeof NOTIFICATION_CATEGORIES];
  return cat ? cat.types.includes(type) : true;
}

// ─── Tab type ───────────────────────────────────────────────────────

type TabKey = 'notifications' | 'preferences';

// ─── Notification Card ──────────────────────────────────────────────

function NotificationCard({ n, onMarkRead, onDelete }: { n: any; onMarkRead: (id: string) => void; onDelete: (id: string) => void }) {
  const href = getNotificationHref(n.type, n.metadata);

  const cardContent = (
    <div
      className="card"
      style={{
        padding: '0.85rem 1rem',
        cursor: 'pointer',
        background: n.isRead ? 'var(--bg-surface)' : 'rgba(201,147,58,0.04)',
        borderLeft: n.isRead ? 'none' : '3px solid var(--accent)',
        transition: 'background 0.15s',
        display: 'flex', gap: '0.65rem', alignItems: 'flex-start',
        position: 'relative',
      }}
      onClick={() => { if (!n.isRead && !href) onMarkRead(n.id); }}
    >
      <span style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: '0.05rem' }}>
        {typeIcons[n.type] || typeIcons.general}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.15rem' }}>
          <p style={{ fontSize: '0.85rem', fontWeight: n.isRead ? 500 : 700, margin: 0, color: 'var(--text-primary)' }}>
            {n.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
            {!n.isRead && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {relativeTime(n.createdAt)}
            </span>
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {n.message}
        </p>
        {href && (
          <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, marginTop: '0.25rem', display: 'inline-block' }}>
            Ver detalle →
          </span>
        )}
      </div>
      {/* Delete button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(n.id); }}
        title="Eliminar notificación"
        style={{
          position: 'absolute', top: '0.5rem', right: '0.5rem',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.2rem',
          opacity: 0.5, lineHeight: 1,
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.5'; }}
      >
        ✕
      </button>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}
        onClick={() => { if (!n.isRead) onMarkRead(n.id); }}>
        {cardContent}
      </Link>
    );
  }
  return cardContent;
}

// ─── Preferences Panel ──────────────────────────────────────────────

function PreferencesPanel() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  const handleToggle = (type: string, enabled: boolean) => {
    const current = prefs || {};
    updatePrefs.mutate({ ...current, [type]: enabled });
  };

  if (isLoading) return <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>;

  return (
    <div className="animate-fade-up">
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Elige qué notificaciones deseas recibir. Las notificaciones desactivadas no se crearán.
      </p>
      {Object.entries(NOTIFICATION_CATEGORIES).map(([catKey, cat]) => (
        <div key={catKey} className="card" style={{ padding: '1rem', marginBottom: '0.75rem' }}>
          <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>{cat.icon}</span> {cat.label}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {cat.types.map((type) => {
              const enabled = prefs?.[type] !== false; // default true (opt-out)
              return (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem', cursor: 'pointer', padding: '0.25rem 0' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => handleToggle(type, e.target.checked)}
                    style={{ accentColor: 'var(--accent)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ color: enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {NOTIFICATION_TYPE_LABELS[type] || type}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function NotificacionesPage() {
  const { t } = useTranslation();
  const { data: notifications, isLoading, refetch } = useNotifications(200);
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotif = useDeleteNotification();
  const deleteAllRead = useDeleteAllRead();
  const role = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const [cleaningUp, setCleaningUp] = useState(false);

  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [activeTab, setActiveTab] = useState<TabKey>('notifications');

  const unreadCount = unreadData?.count || 0;
  const allNotifs = notifications || [];
  const readCount = allNotifs.filter((n: any) => n.isRead).length;

  // Apply filters
  const filtered = allNotifs
    .filter((n: any) => readFilter === 'all' || !n.isRead)
    .filter((n: any) => matchesCategory(n.type, categoryFilter));

  const groups = groupByDate(filtered);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '860px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Centro de Actividad</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {unreadCount > 0
              ? `${unreadCount} notificación${unreadCount > 1 ? 'es' : ''} sin leer`
              : 'Todas las notificaciones leídas'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {readCount > 0 && activeTab === 'notifications' && (
            <button
              className="btn-ghost"
              style={{ fontSize: '0.78rem' }}
              onClick={() => deleteAllRead.mutate()}
              disabled={deleteAllRead.isPending}
            >
              {deleteAllRead.isPending ? 'Eliminando...' : 'Eliminar leídas'}
            </button>
          )}
          {unreadCount > 0 && activeTab === 'notifications' && (
            <button
              className="btn-primary"
              style={{ fontSize: '0.78rem' }}
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              {markAllAsRead.isPending ? 'Marcando...' : 'Marcar todas leídas'}
            </button>
          )}
        </div>
      </div>

      {/* Main tabs: Notificaciones | Preferencias */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'notifications' as TabKey, label: 'Notificaciones' },
          { id: 'preferences' as TabKey, label: 'Preferencias' },
        ]).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Preferences Tab ═══ */}
      {activeTab === 'preferences' && (
        <>
          <PreferencesPanel />
          {isAdmin && (
            <div className="card" style={{ padding: '1rem', marginTop: '1rem', borderLeft: '4px solid var(--warning)' }}>
              <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.35rem' }}>Mantenimiento</h4>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Elimina notificaciones referenciando encuestas eliminadas, ciclos cerrados y notificaciones antiguas (&gt;180 días).
              </p>
              <button
                className="btn-ghost"
                disabled={cleaningUp}
                style={{ fontSize: '0.78rem' }}
                onClick={async () => {
                  if (!token) return;
                  setCleaningUp(true);
                  try {
                    const result = await api.notifications.cleanupOrphans(token);
                    const total = (result.surveys || 0) + (result.cycles || 0) + (result.old || 0);
                    alert(`Limpieza completada: ${total} notificaciones eliminadas (${result.surveys} de encuestas, ${result.cycles} de ciclos, ${result.old} antiguas)`);
                    refetch();
                  } catch { alert('Error al ejecutar limpieza'); }
                  setCleaningUp(false);
                }}
              >
                {cleaningUp ? 'Limpiando...' : 'Ejecutar limpieza de notificaciones huérfanas'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ═══ Notifications Tab ═══ */}
      {activeTab === 'notifications' && (
        <>
          {/* Read filter */}
          <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}>
            {(['all', 'unread'] as const).map((f) => (
              <button key={f} onClick={() => setReadFilter(f)}
                style={{
                  padding: '0.4rem 0.85rem', fontSize: '0.78rem',
                  fontWeight: readFilter === f ? 700 : 500,
                  color: readFilter === f ? '#fff' : 'var(--text-muted)',
                  background: readFilter === f ? 'var(--accent)' : 'var(--bg-surface)',
                  border: readFilter === f ? 'none' : '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer',
                }}>
                {f === 'all' ? 'Todas' : 'Sin leer'}
                {f === 'unread' && unreadCount > 0 && (
                  <span style={{ marginLeft: '0.35rem', background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '1px 5px', fontSize: '0.65rem' }}>
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Category filter pills */}
          <div className="animate-fade-up" style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            {CATEGORY_KEYS.map((key) => {
              const isActive = categoryFilter === key;
              const cat = key !== 'all' ? NOTIFICATION_CATEGORIES[key as keyof typeof NOTIFICATION_CATEGORIES] : null;
              return (
                <button key={key} onClick={() => setCategoryFilter(key)}
                  style={{
                    padding: '0.3rem 0.65rem', fontSize: '0.72rem',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                    background: isActive ? 'rgba(201,147,58,0.1)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(201,147,58,0.3)' : 'var(--border)'}`,
                    borderRadius: '12px', cursor: 'pointer',
                  }}>
                  {cat ? `${cat.icon} ${cat.label}` : 'Todas'}
                </button>
              );
            })}
          </div>

          {/* Notification list grouped by date */}
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="🔔"
                title={readFilter === 'unread' ? 'Sin notificaciones pendientes' : 'No hay notificaciones'}
                description={
                  categoryFilter !== 'all'
                    ? 'Intenta cambiar el filtro de categoría, o elige "Todas" para ver el historial completo.'
                    : readFilter === 'unread'
                    ? 'Estás al día. Las nuevas notificaciones aparecerán aquí.'
                    : 'Aún no recibiste notificaciones. El sistema te avisará cuando tengas acciones pendientes.'
                }
              />
            </div>
          ) : (
            <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {groups.map((group) => (
                <div key={group.label}>
                  {/* Date group header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.6rem 0', marginTop: '0.25rem',
                  }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {group.label}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{group.items.length}</span>
                  </div>
                  {/* Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    {group.items.map((n: any) => (
                      <NotificationCard
                        key={n.id}
                        n={n}
                        onMarkRead={(id) => markAsRead.mutate(id)}
                        onDelete={(id) => deleteNotif.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
