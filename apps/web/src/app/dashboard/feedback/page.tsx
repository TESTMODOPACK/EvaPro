'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmModal from '@/components/ConfirmModal';
import { useCheckIns, useCreateCheckIn, useCompleteCheckIn, useRejectCheckIn, useMeetingLocations, useCreateLocation, useDeleteLocation } from '@/hooks/useFeedback';
import { useReceivedFeedback, useGivenFeedback, useSendQuickFeedback, useFeedbackSummary } from '@/hooks/useFeedback';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';

type ActiveTab = 'checkins' | 'quick' | 'locations';
type QuickSubTab = 'received' | 'given';
type Sentiment = 'positive' | 'neutral' | 'constructive';

const statusBadge: Record<string, string> = {
  scheduled: 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-danger',
  rejected: 'badge-danger',
};

// statusLabel is now built inside CheckInsTab using t()

const sentimentIcon: Record<Sentiment, { icon: string; color: string }> = {
  positive: { icon: '\u2191', color: 'var(--success)' },
  neutral: { icon: '~', color: 'var(--text-muted)' },
  constructive: { icon: '\u2197', color: '#f59e0b' },
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function userName(user?: { firstName: string; lastName: string }) {
  return user ? `${user.firstName} ${user.lastName}` : '—';
}

/* ─── Check-ins Tab ──────────────────────────────────────────────────────── */

function CheckInsTab() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const role = user?.role || '';
  const currentUserId = user?.userId || '';
  const canCreateCheckIn = role === 'tenant_admin' || role === 'manager' || role === 'super_admin';

  const statusLabel: Record<string, string> = {
    scheduled: t('feedback.statusScheduled'),
    completed: t('feedback.statusCompleted'),
    cancelled: t('feedback.statusCancelled'),
    rejected: t('feedback.statusRejected'),
  };

  const { data: checkIns, isLoading } = useCheckIns();
  const { data: usersPage } = useUsers(1, 500);
  const { data: locations } = useMeetingLocations();
  const createCheckIn = useCreateCheckIn();
  const completeCheckIn = useCompleteCheckIn();
  const rejectCheckIn = useRejectCheckIn();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeId: '', scheduledDate: '', scheduledTime: '', topic: '', locationId: '' });
  const [rejectModal, setRejectModal] = useState<{ id: string; topic: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const users = usersPage?.data || [];

  const [ciPage, setCiPage] = useState(1);
  const CI_PAGE_SIZE = 15;

  const sorted = checkIns
    ? [...checkIns].sort((a: any, b: any) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
    : [];
  const ciTotalPages = Math.max(1, Math.ceil(sorted.length / CI_PAGE_SIZE));
  const pagedCheckIns = sorted.slice((ciPage - 1) * CI_PAGE_SIZE, ciPage * CI_PAGE_SIZE);

  function handleCreate() {
    if (!form.employeeId || !form.scheduledDate || !form.scheduledTime || !form.topic) return;
    createCheckIn.mutate(
      {
        employeeId: form.employeeId,
        scheduledDate: form.scheduledDate,
        scheduledTime: form.scheduledTime,
        topic: form.topic,
        locationId: form.locationId || undefined,
      },
      {
        onSuccess: () => {
          setForm({ employeeId: '', scheduledDate: '', scheduledTime: '', topic: '', locationId: '' });
          setShowForm(false);
        },
      },
    );
  }

  function handleReject() {
    if (!rejectModal || !rejectReason.trim()) return;
    rejectCheckIn.mutate(
      { id: rejectModal.id, reason: rejectReason.trim() },
      { onSuccess: () => { setRejectModal(null); setRejectReason(''); } },
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>{'Check-ins 1:1'}</h2>
        {canCreateCheckIn && (
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? t('common.cancel') : t('feedback.newCheckIn')}
          </button>
        )}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Colaborador'}
              </label>
              <select className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} style={{ width: '100%' }}>
                <option value="">{'Seleccionar...'}</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.position ? ` - ${u.position}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Fecha'}
              </label>
              <input className="input" type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Hora'}
              </label>
              <input className="input" type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Tema'}
              </label>
              <input className="input" type="text" placeholder="Tema del check-in..." value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Lugar (opcional)'}
              </label>
              <select className="input" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} style={{ width: '100%' }}>
                <option value="">{'Sin lugar asignado'}</option>
                {locations && locations.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.type === 'virtual' ? '\uD83D\uDCBB' : '\uD83C\uDFE2'} {l.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn-primary" onClick={handleCreate} disabled={createCheckIn.isPending || !form.employeeId || !form.scheduledDate || !form.scheduledTime || !form.topic}>
              {createCheckIn.isPending ? t('common.loading') : t('feedback.createCheckIn')}
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {'Se enviar\u00e1 invitaci\u00f3n por email al colaborador con archivo de calendario (.ics)'}
            </span>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '450px', width: '90%' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>{t('feedback.rejectCheckIn')}</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {'Rechazar: '}<strong>{rejectModal.topic}</strong>
            </p>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              {'Motivo del rechazo'}
            </label>
            <textarea className="input" rows={3} placeholder="Indica el motivo del rechazo..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ width: '100%', resize: 'vertical', marginBottom: '1rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => { setRejectModal(null); setRejectReason(''); }}>{t('common.cancel')}</button>
              <button className="btn-primary" style={{ background: 'var(--danger)' }} onClick={handleReject} disabled={rejectCheckIn.isPending || !rejectReason.trim()}>
                {rejectCheckIn.isPending ? t('common.loading') : t('feedback.confirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{t('feedback.noCheckIns')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('feedback.noCheckInsHint')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {pagedCheckIns.map((ci: any) => (
            <div key={ci.id} className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{ci.topic}</span>
                    <span className={`badge ${statusBadge[ci.status] || 'badge-accent'}`}>
                      {statusLabel[ci.status] || ci.status}
                    </span>
                    {ci.emailSent && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--success)' }} title="Invitaci\u00f3n enviada por email">{'\u2709\uFE0F Enviado'}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>{'\uD83D\uDCC5'} {formatDate(ci.scheduledDate)}{ci.scheduledTime ? ` a las ${ci.scheduledTime.slice(0, 5)}` : ''}</span>
                    <span>{'Colaborador: '}{userName(ci.employee)}</span>
                    <span>{'Encargado: '}{userName(ci.manager)}</span>
                    {ci.location && (
                      <span>{ci.location.type === 'virtual' ? '\uD83D\uDCBB' : '\uD83C\uDFE2'} {ci.location.name}</span>
                    )}
                  </div>
                  {ci.status === 'rejected' && ci.rejectionReason && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--danger)' }}>
                      <strong>{'Motivo del rechazo:'}</strong> {ci.rejectionReason}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem', flexShrink: 0 }}>
                  {ci.status === 'scheduled' && canCreateCheckIn && (
                    <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }} onClick={() => completeCheckIn.mutate(ci.id)} disabled={completeCheckIn.isPending}>
                      {t('feedback.complete')}
                    </button>
                  )}
                  {ci.status === 'scheduled' && ci.employeeId === currentUserId && (
                    <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setRejectModal({ id: ci.id, topic: ci.topic })}>
                      {t('feedback.reject')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {ciTotalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={ciPage <= 1} onClick={() => setCiPage(p => p - 1)}>Anterior</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Página {ciPage} de {ciTotalPages} ({sorted.length} check-ins)</span>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={ciPage >= ciTotalPages} onClick={() => setCiPage(p => p + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

/* ─── Quick Feedback Tab ─────────────────────────────────────────────────── */

function QuickFeedbackTab() {
  const { t } = useTranslation();
  const { data: received, isLoading: loadingReceived } = useReceivedFeedback();
  const { data: given, isLoading: loadingGiven } = useGivenFeedback();
  const { data: summary } = useFeedbackSummary();
  const { data: usersPage } = useUsers(1, 500);
  const sendFeedback = useSendQuickFeedback();

  const [subTab, setSubTab] = useState<QuickSubTab>('received');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ toUserId: '', message: '', sentiment: 'positive' as Sentiment, category: '', isAnonymous: false });
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientDeptFilter, setRecipientDeptFilter] = useState('');

  const allUsers = usersPage?.data || [];
  const currentUserId = useAuthStore((s) => s.user?.userId);
  // Filter users for recipient: exclude self, filter by search and department
  const users = allUsers.filter((u: any) => {
    if (u.id === currentUserId) return false;
    if (!u.isActive) return false;
    if (recipientDeptFilter && u.department !== recipientDeptFilter) return false;
    if (recipientSearch) {
      const q = recipientSearch.toLowerCase();
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      if (!name.includes(q) && !(u.position || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const recipientDepts = Array.from(new Set(allUsers.filter((u: any) => u.isActive && u.id !== currentUserId).map((u: any) => u.department).filter(Boolean))).sort() as string[];
  const feedbackList = subTab === 'received' ? received : given;
  const isLoading = subTab === 'received' ? loadingReceived : loadingGiven;

  function handleSend() {
    if (!form.toUserId || !form.message) return;
    sendFeedback.mutate(
      {
        toUserId: form.toUserId,
        message: form.message,
        sentiment: form.sentiment,
        category: form.category || null,
        isAnonymous: form.isAnonymous,
      },
      {
        onSuccess: () => {
          setForm({ toUserId: '', message: '', sentiment: 'positive', category: '', isAnonymous: false });
          setShowForm(false);
        },
      },
    );
  }

  const sentimentBtn = (s: Sentiment, label: string, color: string) => (
    <button
      type="button"
      onClick={() => setForm({ ...form, sentiment: s })}
      style={{
        padding: '0.4rem 0.75rem',
        borderRadius: 'var(--radius-sm, 6px)',
        border: form.sentiment === s ? `2px solid ${color}` : '1px solid var(--border)',
        background: form.sentiment === s ? `${color}18` : 'transparent',
        color: form.sentiment === s ? color : 'var(--text-secondary)',
        fontWeight: 600,
        fontSize: '0.8rem',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {sentimentIcon[s].icon} {label}
    </button>
  );

  return (
    <div>
      {/* Summary bar */}
      {summary && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {[
            { label: t('feedback.positive'), count: summary.positive, color: 'var(--success)' },
            { label: t('feedback.neutral'), count: summary.neutral, color: 'var(--text-muted)' },
            { label: t('feedback.constructive'), count: summary.constructive, color: '#f59e0b' },
          ].map((s) => (
            <div
              key={s.label}
              className="card"
              style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 0' }}
            >
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color }}>{s.count}</span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tabs + action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['received', 'given'] as const).map((tab) => (
            <button
              key={tab}
              className={subTab === tab ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
              onClick={() => setSubTab(tab)}
            >
              {tab === 'received' ? t('feedback.received') : t('feedback.sent')}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('common.cancel') : t('feedback.giveFeedback')}
        </button>
      </div>

      {/* Send form */}
      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Destinatario
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
              <input className="input" type="text" placeholder="Buscar por nombre o cargo..."
                value={recipientSearch} onChange={(e) => setRecipientSearch(e.target.value)}
                style={{ flex: '1 1 200px', fontSize: '0.82rem' }} />
              <select className="input" value={recipientDeptFilter} onChange={(e) => setRecipientDeptFilter(e.target.value)}
                style={{ flex: '0 1 180px', fontSize: '0.82rem' }}>
                <option value="">Todos los departamentos</option>
                {recipientDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <select
              className="input"
              value={form.toUserId}
              onChange={(e) => setForm({ ...form, toUserId: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="">Seleccionar colaborador ({users.length} disponibles)...</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.department ? ` — ${u.department}` : ''}{u.position ? ` (${u.position})` : ''}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Mensaje
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="Escribe tu feedback..."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Sentimiento
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {sentimentBtn('positive', t('feedback.positive'), '#10b981')}
              {sentimentBtn('neutral', t('feedback.neutral'), '#6b7280')}
              {sentimentBtn('constructive', t('feedback.constructive'), '#f59e0b')}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Categor\u00eda (opcional)'}
              </label>
              <input
                className="input"
                type="text"
                placeholder={'Ej: Liderazgo, Comunicaci\u00f3n...'}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', paddingBottom: '0.35rem' }}>
              <input
                type="checkbox"
                checked={form.isAnonymous}
                onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
              {'An\u00f3nimo'}
            </label>
          </div>
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={sendFeedback.isPending || !form.toUserId || !form.message}
          >
            {sendFeedback.isPending ? t('common.loading') : t('feedback.sendFeedback')}
          </button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : !feedbackList || feedbackList.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {subTab === 'received' ? t('feedback.noFeedbackReceived') : t('feedback.noFeedbackSent')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {feedbackList.map((fb: any) => {
            const si = sentimentIcon[fb.sentiment as Sentiment] || sentimentIcon.neutral;
            const isReceived = subTab === 'received';
            const personLabel = isReceived
              ? (fb.isAnonymous ? 'An\u00f3nimo' : `De: ${userName(fb.fromUser)}`)
              : `Para: ${userName(fb.toUser)}`;

            return (
              <div key={fb.id} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        background: `${si.color}20`, color: si.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '0.85rem',
                      }}
                    >
                      {si.icon}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{personLabel}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {fb.category && (
                      <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>{fb.category}</span>
                    )}
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDate(fb.createdAt)}</span>
                  </div>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{fb.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Meeting Locations Tab ──────────────────────────────────────────────── */

function LocationsTab() {
  const { t } = useTranslation();
  const { data: locations, isLoading, error: loadError } = useMeetingLocations();
  const createLocation = useCreateLocation();
  const deleteLocation = useDeleteLocation();

  const [confirmState, setConfirmState] = useState<{
    message: string;
    detail?: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'physical', address: '', capacity: '' });
  const [createError, setCreateError] = useState('');

  function handleCreate() {
    if (!form.name) return;
    setCreateError('');
    createLocation.mutate(
      { name: form.name, type: form.type, address: form.address || undefined, capacity: form.capacity ? parseInt(form.capacity) : undefined },
      {
        onSuccess: () => { setForm({ name: '', type: 'physical', address: '', capacity: '' }); setShowForm(false); setCreateError(''); },
        onError: (err: any) => { setCreateError(err?.message || 'Error al crear el lugar. Verifique que su plan incluya esta funcionalidad.'); },
      },
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>{'Lugares de Reuni\u00f3n'}</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('common.cancel') : t('feedback.newLocation')}
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {'Administra los lugares disponibles para agendar reuniones 1:1. Los lugares aparecen como opciones al crear un check-in.'}
      </p>

      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>{'Nombre'}</label>
              <input className="input" type="text" placeholder="Ej: Sala de Reuniones 1, Google Meet..." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>{'Tipo'}</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ width: '100%' }}>
                <option value="physical">{'\uD83C\uDFE2 F\u00edsico'}</option>
                <option value="virtual">{'\uD83D\uDCBB Virtual'}</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {form.type === 'virtual' ? 'URL de la sala' : 'Direcci\u00f3n / Ubicaci\u00f3n'}
              </label>
              <input className="input" type="text" placeholder={form.type === 'virtual' ? 'https://meet.google.com/...' : 'Piso 3, Oficina 301'} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ width: '100%' }} />
            </div>
            {form.type === 'physical' && (
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>{'Capacidad'}</label>
                <input className="input" type="number" min="1" placeholder="Ej: 10" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} style={{ width: '100%' }} />
              </div>
            )}
          </div>
          {createError && (
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              {createError}
            </div>
          )}
          <button className="btn-primary" onClick={handleCreate} disabled={createLocation.isPending || !form.name}>
            {createLocation.isPending ? t('common.loading') : t('feedback.createLocation')}
          </button>
        </div>
      )}

      {loadError && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid var(--danger)' }}>
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>{t('common.errorLoading')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{(loadError as any)?.message || 'Verifique que su plan incluya la funcionalidad de Feedback.'}</p>
        </div>
      )}
      {isLoading ? <Spinner /> : !locations || locations.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('feedback.noLocations')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {locations.map((loc: any) => (
            <div key={loc.id} className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '1rem' }}>{loc.type === 'virtual' ? '\uD83D\uDCBB' : '\uD83C\uDFE2'}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{loc.name}</span>
                  <span className={`badge ${loc.type === 'virtual' ? 'badge-accent' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>
                    {loc.type === 'virtual' ? 'Virtual' : 'F\u00edsico'}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem' }}>
                  {loc.address && <span>{loc.address}</span>}
                  {loc.capacity && <span>{'Capacidad: '}{loc.capacity}</span>}
                </div>
              </div>
              <button
                className="btn-ghost"
                style={{ fontSize: '0.75rem', color: 'var(--danger)' }}
                onClick={() => setConfirmState({
                  message: '¿Desactivar este lugar?',
                  danger: true,
                  onConfirm: () => { setConfirmState(null); deleteLocation.mutate(loc.id); },
                })}
                disabled={deleteLocation.isPending}
              >
                {t('feedback.deactivate')}
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          detail={confirmState.detail}
          danger={confirmState.danger}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

function FeedbackPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<ActiveTab>('checkins');
  const [showGuide, setShowGuide] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/feedback/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `feedback-checkins.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* ignore */ }
    setExporting(null);
  };
  const isAdminOrManager = role === 'tenant_admin' || role === 'super_admin' || role === 'manager';

  const tabBtn = (tab: ActiveTab, label: string) => (
    <button
      key={tab}
      className={activeTab === tab ? 'btn-primary' : 'btn-ghost'}
      onClick={() => setActiveTab(tab)}
      style={{ fontSize: '0.85rem' }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('feedback.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('feedback.subtitle')}
          </p>
        </div>
        {isAdminOrManager && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-ghost" onClick={() => handleExport('xlsx')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
              {exporting === 'xlsx' ? t('common.exporting') : t('common.exportExcel')}
            </button>
            <button className="btn-ghost" onClick={() => handleExport('csv')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
              {exporting === 'csv' ? t('common.exporting') : t('common.exportCsv')}
            </button>
          </div>
        )}
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button
          className="btn-ghost"
          onClick={() => setShowGuide(!showGuide)}
          style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'\u25B6'}</span>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>
            {'Gu\u00eda de uso: Feedback y Reuniones 1:1'}
          </h3>

          {/* Section 1 */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'\u00bfQu\u00e9 incluye esta funci\u00f3n?'}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              {'Dos herramientas complementarias: Check-ins (reuniones 1:1 entre encargado y colaborador) y Quick Feedback (retroalimentaci\u00f3n r\u00e1pida entre cualquier miembro del equipo).'}
            </p>
          </div>

          {/* Section 2 */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'Check-ins (Reuniones 1:1):'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>{'Son reuniones de seguimiento peri\u00f3dicas entre encargado y colaborador'}</li>
              <li>{'El encargado solo puede crear check-ins con sus reportes directos (se valida la relaci\u00f3n managerId)'}</li>
              <li>{'El administrador puede crear check-ins con cualquier colaborador'}</li>
              <li>{'Se registra: fecha, tema, notas y acciones de seguimiento'}</li>
              <li>{'El sistema env\u00eda recordatorio autom\u00e1tico si no hay check-in en 14 d\u00edas'}</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'Quick Feedback (Retroalimentaci\u00f3n r\u00e1pida) - Feedback 360\u00b0:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>{'Cualquier usuario puede enviar feedback a cualquier otro usuario'}</li>
              <li>{'Tipos de sentimiento: Positivo, Neutral, Constructivo'}</li>
              <li>{'Opci\u00f3n de env\u00edo an\u00f3nimo'}</li>
              <li>{'Visibilidad configurable (NUEVO B2.12): P\u00fablico (todos ven), Privado (solo emisor/receptor), Solo encargado (receptor y su encargado)'}</li>
              <li>{'Categor\u00edas personalizables'}</li>
            </ul>
          </div>

          {/* Section 4 */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'Conexi\u00f3n con otras funciones:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>{'Evaluaciones: el feedback recibido complementa las evaluaciones formales'}</li>
              <li>{'Planes de Desarrollo: el feedback constructivo puede motivar acciones de mejora'}</li>
              <li>{'Notificaciones: se recibe notificaci\u00f3n autom\u00e1tica al recibir feedback'}</li>
            </ul>
          </div>

          {/* Section 5 */}
          <div>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'Permisos:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>{'Administrador: Crea check-ins con cualquiera, ve todo el feedback'}</li>
              <li>{'Encargado de Equipo: Crea check-ins con sus reportes directos, env\u00eda/recibe feedback'}</li>
              <li>{'Colaborador: Ve sus check-ins, env\u00eda/recibe feedback'}</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {tabBtn('checkins', t('feedback.tabCheckIns'))}
        {tabBtn('quick', t('feedback.tabQuickFeedback'))}
        {tabBtn('locations', t('feedback.tabLocations'))}
      </div>

      {/* Content */}
      <div className="animate-fade-up">
        {activeTab === 'checkins' && <CheckInsTab />}
        {activeTab === 'quick' && <QuickFeedbackTab />}
        {activeTab === 'locations' && <LocationsTab />}
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  return (
    <PlanGate feature="FEEDBACK">
      <FeedbackPageContent />
    </PlanGate>
  );
}
