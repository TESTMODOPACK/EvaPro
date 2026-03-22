'use client';

import { useState } from 'react';
import { useCheckIns, useCreateCheckIn, useCompleteCheckIn } from '@/hooks/useFeedback';
import { useReceivedFeedback, useGivenFeedback, useSendQuickFeedback, useFeedbackSummary } from '@/hooks/useFeedback';
import { useUsers } from '@/hooks/useUsers';

type ActiveTab = 'checkins' | 'quick';
type QuickSubTab = 'received' | 'given';
type Sentiment = 'positive' | 'neutral' | 'constructive';

const statusBadge: Record<string, string> = {
  scheduled: 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-danger',
};

const statusLabel: Record<string, string> = {
  scheduled: 'Programado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

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
  const { data: checkIns, isLoading } = useCheckIns();
  const { data: usersPage } = useUsers();
  const createCheckIn = useCreateCheckIn();
  const completeCheckIn = useCompleteCheckIn();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeId: '', scheduledDate: '', topic: '' });

  const users = usersPage?.data || [];

  const sorted = checkIns
    ? [...checkIns].sort((a: any, b: any) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
    : [];

  function handleCreate() {
    if (!form.employeeId || !form.scheduledDate || !form.topic) return;
    createCheckIn.mutate(
      { employeeId: form.employeeId, scheduledDate: form.scheduledDate, topic: form.topic },
      {
        onSuccess: () => {
          setForm({ employeeId: '', scheduledDate: '', topic: '' });
          setShowForm(false);
        },
      },
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>Check-ins 1:1</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : '+ Nuevo Check-in'}
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Empleado
              </label>
              <select
                className="input"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                style={{ width: '100%' }}
              >
                <option value="">Seleccionar...</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Fecha
              </label>
              <input
                className="input"
                type="date"
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Tema
            </label>
            <input
              className="input"
              type="text"
              placeholder="Tema del check-in..."
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={createCheckIn.isPending || !form.employeeId || !form.scheduledDate || !form.topic}
          >
            {createCheckIn.isPending ? 'Creando...' : 'Crear Check-in'}
          </button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            No hay check-ins registrados
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Crea tu primer check-in 1:1
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {sorted.map((ci: any) => (
            <div
              key={ci.id}
              className="card"
              style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{ci.topic}</span>
                  <span className={`badge ${statusBadge[ci.status] || 'badge-accent'}`}>
                    {statusLabel[ci.status] || ci.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span>{formatDate(ci.scheduledDate)}</span>
                  <span>Empleado: {userName(ci.employee)}</span>
                  <span>Manager: {userName(ci.manager)}</span>
                  {ci.actionItems && ci.actionItems.length > 0 && (
                    <span style={{ color: 'var(--accent)' }}>
                      {ci.actionItems.length} accion{ci.actionItems.length !== 1 ? 'es' : ''}
                    </span>
                  )}
                </div>
              </div>
              {ci.status === 'scheduled' && (
                <button
                  className="btn-primary"
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                  onClick={() => completeCheckIn.mutate(ci.id)}
                  disabled={completeCheckIn.isPending}
                >
                  Completar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Quick Feedback Tab ─────────────────────────────────────────────────── */

function QuickFeedbackTab() {
  const { data: received, isLoading: loadingReceived } = useReceivedFeedback();
  const { data: given, isLoading: loadingGiven } = useGivenFeedback();
  const { data: summary } = useFeedbackSummary();
  const { data: usersPage } = useUsers();
  const sendFeedback = useSendQuickFeedback();

  const [subTab, setSubTab] = useState<QuickSubTab>('received');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ toUserId: '', message: '', sentiment: 'positive' as Sentiment, category: '', isAnonymous: false });

  const users = usersPage?.data || [];
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
            { label: 'Positivos', count: summary.positive, color: 'var(--success)' },
            { label: 'Neutrales', count: summary.neutral, color: 'var(--text-muted)' },
            { label: 'Constructivos', count: summary.constructive, color: '#f59e0b' },
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
          {(['received', 'given'] as const).map((t) => (
            <button
              key={t}
              className={subTab === t ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
              onClick={() => setSubTab(t)}
            >
              {t === 'received' ? 'Recibido' : 'Enviado'}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : '+ Dar Feedback'}
        </button>
      </div>

      {/* Send form */}
      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Destinatario
            </label>
            <select
              className="input"
              value={form.toUserId}
              onChange={(e) => setForm({ ...form, toUserId: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="">Seleccionar usuario...</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
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
              {sentimentBtn('positive', 'Positivo', '#10b981')}
              {sentimentBtn('neutral', 'Neutral', '#6b7280')}
              {sentimentBtn('constructive', 'Constructivo', '#f59e0b')}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Categoria (opcional)
              </label>
              <input
                className="input"
                type="text"
                placeholder="Ej: Liderazgo, Comunicacion..."
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
              Anonimo
            </label>
          </div>
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={sendFeedback.isPending || !form.toUserId || !form.message}
          >
            {sendFeedback.isPending ? 'Enviando...' : 'Enviar Feedback'}
          </button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Spinner />
      ) : !feedbackList || feedbackList.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            No hay feedback {subTab === 'received' ? 'recibido' : 'enviado'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {feedbackList.map((fb: any) => {
            const si = sentimentIcon[fb.sentiment as Sentiment] || sentimentIcon.neutral;
            const isReceived = subTab === 'received';
            const personLabel = isReceived
              ? (fb.isAnonymous ? 'Anonimo' : `De: ${userName(fb.fromUser)}`)
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

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export default function FeedbackPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('checkins');

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
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Feedback</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Check-ins 1:1 y feedback continuo
        </p>
      </div>

      {/* Tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {tabBtn('checkins', 'Check-ins 1:1')}
        {tabBtn('quick', 'Quick Feedback')}
      </div>

      {/* Content */}
      <div className="animate-fade-up">
        {activeTab === 'checkins' ? <CheckInsTab /> : <QuickFeedbackTab />}
      </div>
    </div>
  );
}
