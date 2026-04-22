'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import ConfirmModal from '@/components/ConfirmModal';
import { FirstVisitTip } from '@/components/FirstVisitTip';
import { useCheckIns, useCreateCheckIn, useCompleteCheckIn, useRejectCheckIn, useCancelCheckIn, useRequestCheckIn, useAcceptCheckIn, useMeetingLocations, useCreateLocation, useDeleteLocation, useMyTopicsHistory, useEditCompletedCheckIn } from '@/hooks/useFeedback';
import { useReceivedFeedback, useGivenFeedback, useSendQuickFeedback, useFeedbackSummary } from '@/hooks/useFeedback';
import { useActiveUsersForPicker } from '@/hooks/useUsers';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import SearchableSelect from '@/components/SearchableSelect';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import Link from 'next/link';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import {
  useTeamMeetings,
  useCreateTeamMeeting,
  useCancelTeamMeeting,
  useCompleteTeamMeeting,
  useRespondTeamMeeting,
  useAddTopicToTeamMeeting,
  useEditCompletedTeamMeeting,
} from '@/hooks/useTeamMeetings';

type ActiveTab = 'checkins' | 'quick' | 'locations' | 'teamMeetings';
type QuickSubTab = 'received' | 'given';
type Sentiment = 'positive' | 'neutral' | 'constructive';

const statusBadge: Record<string, string> = {
  requested: 'badge-accent',
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

// Spinner legacy — usa LoadingState directamente. Wrapper mantenido para
// backward-compat con los 3 callsites existentes. Migrar cuando toque.
function Spinner() {
  return <LoadingState />;
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  // Extract only the date part (handle both "2026-04-08" and "2026-04-08T10:30:00.000Z")
  const dateOnly = d.length > 10 ? d.slice(0, 10) : d;
  const parts = dateOnly.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function userName(user?: { firstName: string; lastName: string }) {
  return user ? `${user.firstName} ${user.lastName}` : '—';
}

/* ─── Check-ins Tab ──────────────────────────────────────────────────────── */

function CheckInsTab() {
  const { t } = useTranslation();
  const { user, token } = useAuthStore();
  const toast = useToastStore();
  const role = user?.role || '';
  const currentUserId = user?.userId || '';
  const canCreateCheckIn = role === 'tenant_admin' || role === 'manager' || role === 'super_admin';

  const statusLabel: Record<string, string> = {
    requested: 'Solicitada',
    scheduled: t('feedback.statusScheduled'),
    completed: t('feedback.statusCompleted'),
    cancelled: t('feedback.statusCancelled'),
    rejected: t('feedback.statusRejected'),
  };

  const { hasFeature } = useFeatureAccess();
  const hasMagicMeetings = hasFeature('MAGIC_MEETINGS');
  const { data: checkIns, isLoading, refetch: refetchCheckIns } = useCheckIns();
  const { data: usersPage } = useActiveUsersForPicker();
  const { data: locations } = useMeetingLocations();
  const createCheckIn = useCreateCheckIn();
  const completeCheckIn = useCompleteCheckIn();
  const editCompletedCheckIn = useEditCompletedCheckIn();
  const rejectCheckIn = useRejectCheckIn();
  const cancelCheckIn = useCancelCheckIn();
  const requestCheckIn = useRequestCheckIn();
  const acceptCheckIn = useAcceptCheckIn();
  const isEmployee = role === 'employee';
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ topic: '', suggestedDate: '' });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeId: '', scheduledDate: '', scheduledTime: '', topic: '', locationId: '' });
  const [rejectModal, setRejectModal] = useState<{ id: string; topic: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [completeModal, setCompleteModal] = useState<{ id: string; topic: string; employee: string } | null>(null);
  // v3.1 — modal de edición retroactiva de check-ins completados
  // (típicamente auto-cerrados por el cron +5d).
  const [retroEditModal, setRetroEditModal] = useState<{ id: string; topic: string; employee: string; current: { notes: string; minutes: string; rating: number; actionItems: Array<{ text: string; assigneeName: string; dueDate: string; completed: boolean }> } } | null>(null);
  const [completeForm, setCompleteForm] = useState({ notes: '', rating: 0, minutes: '', actionItems: [{ text: '', assigneeName: '', dueDate: '' }] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMinutesId, setEditingMinutesId] = useState<string | null>(null);
  const [editingMinutesText, setEditingMinutesText] = useState('');
  const [savingMinutes, setSavingMinutes] = useState(false);

  const allCiUsers = usersPage?.data || [];
  const [ciSearch, setCiSearch] = useState('');
  const [ciDeptFilter, setCiDeptFilter] = useState('');

  const users = allCiUsers.filter((u: any) => {
    if (u.id === currentUserId) return false;
    if (!u.isActive) return false;
    if (ciDeptFilter && u.department !== ciDeptFilter) return false;
    if (ciSearch) {
      const q = ciSearch.toLowerCase();
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      if (!name.includes(q) && !(u.position || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const { departments: ciDepts } = useDepartments();

  const [ciPage, setCiPage] = useState(1);
  const CI_PAGE_SIZE = 15;

  // v3.1 — Sub-tabs para separar check-ins por rol del usuario en el check-in
  // y por estado. "Enviadas" = yo soy el manager; "Recibidas" = yo soy el
  // employee. "Completadas" y "Canceladas" juntan ambos roles.
  type CiSubTab = 'sent' | 'received' | 'completed' | 'cancelled';
  const [ciSubTab, setCiSubTab] = useState<CiSubTab>('sent');

  const allSorted = checkIns
    ? [...checkIns].sort((a: any, b: any) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
    : [];

  // Aplicar filtro de sub-tab antes de paginar.
  const matchesSubTab = (ci: any, tab: CiSubTab): boolean => {
    const openStatus = ci.status === 'scheduled' || ci.status === 'requested';
    const isMineAsManager = ci.managerId === currentUserId;
    const isMineAsEmployee = ci.employeeId === currentUserId;
    switch (tab) {
      case 'sent':
        return openStatus && isMineAsManager;
      case 'received':
        return openStatus && isMineAsEmployee;
      case 'completed':
        return ci.status === 'completed' && (isMineAsManager || isMineAsEmployee);
      case 'cancelled':
        return (ci.status === 'cancelled' || ci.status === 'rejected') &&
          (isMineAsManager || isMineAsEmployee);
    }
  };

  // Contadores para los badges (sobre el listado completo, sin paginar).
  const counts: Record<CiSubTab, number> = {
    sent: allSorted.filter((ci: any) => matchesSubTab(ci, 'sent')).length,
    received: allSorted.filter((ci: any) => matchesSubTab(ci, 'received')).length,
    completed: allSorted.filter((ci: any) => matchesSubTab(ci, 'completed')).length,
    cancelled: allSorted.filter((ci: any) => matchesSubTab(ci, 'cancelled')).length,
  };

  const sorted = allSorted.filter((ci: any) => matchesSubTab(ci, ciSubTab));
  const ciTotalPages = Math.max(1, Math.ceil(sorted.length / CI_PAGE_SIZE));
  const pagedCheckIns = sorted.slice((ciPage - 1) * CI_PAGE_SIZE, ciPage * CI_PAGE_SIZE);

  // Reset a página 1 al cambiar de sub-tab.
  const switchSubTab = (tab: CiSubTab) => {
    setCiSubTab(tab);
    setCiPage(1);
    setExpandedId(null);
  };

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
          toast.success('Check-in agendado correctamente');
        },
        onError: (err: any) => {
          toast.error(err?.message || 'Error al agendar el check-in');
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {canCreateCheckIn && (
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? t('common.cancel') : t('feedback.newCheckIn')}
            </button>
          )}
          {isEmployee && (
            <button className="btn-primary" onClick={() => setShowRequestForm(!showRequestForm)}>
              {showRequestForm ? t('common.cancel') : 'Solicitar Reunión'}
            </button>
          )}
        </div>
      </div>

      {/* Employee: Request meeting form */}
      {showRequestForm && isEmployee && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>Solicitar reunión 1:1 con tu jefatura</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Tu encargado recibirá una notificación y podrá agendar la reunión.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: '200px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Tema de la reunión *</label>
              <input className="input" type="text" placeholder="¿De qué te gustaría conversar?" style={{ width: '100%' }}
                value={requestForm.topic} onChange={(e) => setRequestForm({ ...requestForm, topic: e.target.value })} />
            </div>
            <div style={{ minWidth: '150px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Fecha sugerida (opcional)</label>
              <input
                className="input"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                style={{ width: '100%' }}
                value={requestForm.suggestedDate}
                onChange={(e) => setRequestForm({ ...requestForm, suggestedDate: e.target.value })}
              />
            </div>
            <button className="btn-primary" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
              disabled={!requestForm.topic.trim() || requestCheckIn.isPending}
              onClick={async () => {
                try {
                  await requestCheckIn.mutateAsync({ topic: requestForm.topic.trim(), suggestedDate: requestForm.suggestedDate || undefined });
                  setRequestForm({ topic: '', suggestedDate: '' });
                  setShowRequestForm(false);
                } catch (e: any) {
                  alert(e.message || 'Error al solicitar reunión');
                }
              }}>
              {requestCheckIn.isPending ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </div>
      )}

      {/* Inline form */}
      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          {/* Collaborator search + filter */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Colaborador
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
              <input className="input" type="text" placeholder="Buscar por nombre o cargo..."
                value={ciSearch} onChange={(e) => setCiSearch(e.target.value)}
                style={{ flex: '1 1 200px', fontSize: '0.82rem' }} />
              <select className="input" value={ciDeptFilter} onChange={(e) => setCiDeptFilter(e.target.value)}
                style={{ flex: '0 1 180px', fontSize: '0.82rem' }}>
                <option value="">Todos los departamentos</option>
                {ciDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <SearchableSelect
              value={form.employeeId}
              onChange={(v) => setForm({ ...form, employeeId: v })}
              placeholder={`Seleccionar colaborador (${users.length} disponibles)...`}
              ariaLabel="Colaborador para el check-in"
              options={users.map((u: any) => ({
                value: u.id,
                label: `${u.firstName} ${u.lastName}`,
                hint: [u.department, u.position].filter(Boolean).join(' · '),
                initials: `${(u.firstName || '?')[0]}${(u.lastName || '?')[0]}`.toUpperCase(),
              }))}
            />
          </div>
          {/* v3.1 — bloquea fechas pasadas. Si el usuario elige hoy, el input
              de hora también toma min para evitar reuniones ya vencidas.
              El backend re-valida; esto es UX pura. */}
          {(() => {
            const today = new Date().toISOString().slice(0, 10);
            const isToday = form.scheduledDate === today;
            const nowHHmm = (() => {
              const n = new Date();
              return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
            })();
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                    {'Fecha'}
                  </label>
                  <input
                    className="input"
                    type="date"
                    min={today}
                    value={form.scheduledDate}
                    onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                    {'Hora'}
                  </label>
                  <input
                    className="input"
                    type="time"
                    min={isToday ? nowHHmm : undefined}
                    value={form.scheduledTime}
                    onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {'Tema'}
              </label>
              {/* v3.1 — Combobox con historial: sugiere temas previos del usuario
                  (admin ve del tenant, manager solo los suyos). */}
              <TopicCombobox
                value={form.topic}
                onChange={(t) => setForm({ ...form, topic: t })}
                placeholder="Tema del check-in..."
              />
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

      {/* Complete check-in modal */}
      {completeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '560px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Completar Check-in</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{completeModal.topic}</strong> — {completeModal.employee}
            </p>

            {/* Rating */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
                ¿Cómo fue la reunión?
              </label>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} type="button" onClick={() => setCompleteForm({ ...completeForm, rating: star })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: '0.1rem', opacity: star <= completeForm.rating ? 1 : 0.3, transition: 'opacity 0.15s' }}>
                    ⭐
                  </button>
                ))}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem', alignSelf: 'center' }}>
                  {completeForm.rating === 5 ? 'Muy productiva' : completeForm.rating === 4 ? 'Productiva' : completeForm.rating === 3 ? 'Normal' : completeForm.rating === 2 ? 'Poco productiva' : completeForm.rating === 1 ? 'No productiva' : 'Sin valorar'}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Notas de la reunión
              </label>
              <textarea className="input" rows={4} placeholder="Resumen de lo conversado, puntos importantes..."
                value={completeForm.notes} onChange={(e) => setCompleteForm({ ...completeForm, notes: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            {/* Minutes */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Minuta de la reunión <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional — se puede agregar después)</span>
              </label>
              <textarea className="input" rows={5} placeholder="Detalle lo conversado: contexto, decisiones, seguimientos, próximos pasos..."
                value={completeForm.minutes} onChange={(e) => setCompleteForm({ ...completeForm, minutes: e.target.value })}
                style={{ width: '100%', resize: 'vertical', fontSize: '0.82rem' }} />
            </div>

            {/* Action Items */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Acuerdos y compromisos
              </label>
              {completeForm.actionItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'flex-start' }}>
                  <input className="input" type="text" placeholder="Acuerdo o compromiso..."
                    value={item.text} onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], text: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ flex: 2, fontSize: '0.82rem' }} />
                  <input className="input" type="text" placeholder="Responsable"
                    value={item.assigneeName} onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], assigneeName: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ flex: 1, fontSize: '0.82rem' }} />
                  <input className="input" type="date"
                    value={item.dueDate} onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], dueDate: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ width: '130px', fontSize: '0.82rem' }} />
                  {completeForm.actionItems.length > 1 && (
                    <button type="button" onClick={() => {
                      const items = completeForm.actionItems.filter((_, i) => i !== idx);
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '1rem', padding: '0.3rem' }}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}
                onClick={() => setCompleteForm({ ...completeForm, actionItems: [...completeForm.actionItems, { text: '', assigneeName: '', dueDate: '' }] })}>
                + Agregar acuerdo
              </button>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-ghost" onClick={() => setCompleteModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={completeCheckIn.isPending}
                onClick={() => {
                  const data: any = {};
                  if (completeForm.notes.trim()) data.notes = completeForm.notes.trim();
                  if (completeForm.minutes.trim()) data.minutes = completeForm.minutes.trim();
                  if (completeForm.rating > 0) data.rating = completeForm.rating;
                  const validItems = completeForm.actionItems.filter(i => i.text.trim());
                  if (validItems.length > 0) data.actionItems = validItems;
                  completeCheckIn.mutate({ id: completeModal.id, data }, {
                    onSuccess: () => setCompleteModal(null),
                  });
                }}>
                {completeCheckIn.isPending ? 'Guardando...' : 'Completar Check-in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v3.1 — Sub-tabs por rol/estado con contadores */}
      <div
        role="tablist"
        aria-label="Filtrar check-ins"
        style={{
          display: 'flex',
          gap: '0.4rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.3rem',
        }}
      >
        {([
          { key: 'sent' as const, label: '📤 Enviadas', hint: 'Reuniones que tú programaste' },
          { key: 'received' as const, label: '📥 Recibidas', hint: 'Reuniones donde te invitaron' },
          { key: 'completed' as const, label: '✅ Completadas', hint: 'Reuniones cerradas con minuta' },
          { key: 'cancelled' as const, label: '✕ Canceladas', hint: 'Anuladas o rechazadas' },
        ]).map(({ key, label, hint }) => {
          const active = ciSubTab === key;
          const count = counts[key];
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              title={hint}
              onClick={() => switchSubTab(key)}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'rgba(201,147,58,0.1)' : 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s',
              }}
            >
              {label}
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.05rem 0.45rem',
                  borderRadius: '999px',
                  background: active ? 'var(--accent)' : 'var(--border)',
                  color: active ? '#fff' : 'var(--text-muted)',
                  minWidth: '1.4rem',
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState message="Cargando check-ins…" />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ciSubTab === 'sent' ? '📤' : ciSubTab === 'received' ? '📥' : ciSubTab === 'completed' ? '✅' : '✕'}
            title={
              ciSubTab === 'sent'
                ? 'No has enviado invitaciones'
                : ciSubTab === 'received'
                  ? 'No tienes invitaciones recibidas'
                  : ciSubTab === 'completed'
                    ? 'Aún no tienes check-ins completados'
                    : 'Sin check-ins cancelados'
            }
            description={
              ciSubTab === 'sent'
                ? 'Programa tu primer 1:1 con un miembro de tu equipo.'
                : ciSubTab === 'received'
                  ? 'Cuando alguien agende un 1:1 contigo, aparecerá aquí.'
                  : 'Las reuniones cerradas con su minuta aparecerán en esta pestaña.'
            }
            ctaLabel={canCreateCheckIn && ciSubTab === 'sent' ? t('feedback.newCheckIn') : undefined}
            ctaOnClick={canCreateCheckIn && ciSubTab === 'sent' ? () => setShowForm(true) : undefined}
          />
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
                    {ci.autoCompleted && (
                      <span
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          background: 'rgba(245,158,11,0.12)',
                          color: '#d97706',
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                        }}
                        title="Cerrado automáticamente por política de +5 días sin registro. Puedes editar la información desde 'Editar información'."
                      >
                        ⏱ cerrado automáticamente
                      </span>
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
                  {/* Completed check-in details — expandable.
                      v3.1: siempre mostrar para completados (incluidos auto-cerrados
                      sin info todavía) para dar acceso al botón "Editar información". */}
                  {ci.status === 'completed' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      <button
                        onClick={() => setExpandedId(expandedId === ci.id ? null : ci.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        <span style={{ transform: expandedId === ci.id ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                        Ver registro de la reunión
                        {ci.rating && <span style={{ marginLeft: '0.3rem' }}>{'⭐'.repeat(ci.rating)}</span>}
                      </button>
                      {/* Botón editar retroactivo: solo manager del ci o admin. */}
                      {(ci.managerId === currentUserId || role === 'tenant_admin' || role === 'super_admin') && (
                        <button
                          onClick={() => {
                            setRetroEditModal({
                              id: ci.id,
                              topic: ci.topic,
                              employee: userName(ci.employee),
                              current: {
                                notes: ci.notes || '',
                                minutes: ci.minutes || '',
                                rating: ci.rating || 0,
                                actionItems: (ci.actionItems || []).length > 0
                                  ? (ci.actionItems as any[]).map((a: any) => ({
                                      text: a.text || '',
                                      assigneeName: a.assigneeName || '',
                                      dueDate: a.dueDate || '',
                                      completed: !!a.completed,
                                    }))
                                  : [{ text: '', assigneeName: '', dueDate: '', completed: false }],
                              },
                            });
                          }}
                          style={{ background: 'none', border: '1px solid var(--accent)', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 'var(--radius-sm,6px)' }}
                          title={ci.autoCompleted ? 'Agrega notas, minuta, acuerdos y valoración retroactivos' : 'Edita la información registrada de esta reunión'}
                        >
                          📝 Editar información
                        </button>
                      )}
                    </div>
                  )}
                  {ci.status === 'completed' && expandedId === ci.id && (
                    <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                      {ci.rating && (
                        <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Valoración:</span>
                          <span>{'⭐'.repeat(ci.rating)}{'☆'.repeat(5 - ci.rating)}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            ({ci.rating === 5 ? 'Muy productivo' : ci.rating === 4 ? 'Productivo' : ci.rating === 3 ? 'Normal' : ci.rating === 2 ? 'Poco productivo' : 'No productivo'})
                          </span>
                        </div>
                      )}
                      {ci.notes && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Notas de la reunión:</div>
                          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ci.notes}</div>
                        </div>
                      )}
                      {/* Minuta — editable post-completar */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Minuta de la reunión:</span>
                          {(ci.managerId === currentUserId || ci.employeeId === currentUserId) && editingMinutesId !== ci.id && (
                            <button className="btn-ghost" style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}
                              onClick={() => { setEditingMinutesId(ci.id); setEditingMinutesText(ci.minutes || ''); }}>
                              {ci.minutes ? 'Editar' : '+ Agregar minuta'}
                            </button>
                          )}
                        </div>
                        {editingMinutesId === ci.id ? (
                          <div>
                            <textarea className="input" rows={5} value={editingMinutesText}
                              onChange={(e) => setEditingMinutesText(e.target.value)}
                              placeholder="Detalle lo conversado: contexto, decisiones, seguimientos..."
                              style={{ width: '100%', resize: 'vertical', fontSize: '0.82rem', marginBottom: '0.4rem' }} />
                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                              <button className="btn-ghost" style={{ fontSize: '0.75rem' }}
                                onClick={() => setEditingMinutesId(null)}>Cancelar</button>
                              <button className="btn-primary" style={{ fontSize: '0.75rem' }} disabled={savingMinutes}
                                onClick={async () => {
                                  setSavingMinutes(true);
                                  try {
                                    await api.feedback.updateMinutes(token!, ci.id, editingMinutesText.trim());
                                    setEditingMinutesId(null);
                                    refetchCheckIns();
                                  } catch { /* ignore */ }
                                  setSavingMinutes(false);
                                }}>
                                {savingMinutes ? 'Guardando...' : 'Guardar minuta'}
                              </button>
                            </div>
                          </div>
                        ) : ci.minutes ? (
                          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6, padding: '0.5rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.1)' }}>
                            {ci.minutes}
                          </div>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>Sin minuta registrada</div>
                        )}
                      </div>
                      {ci.actionItems?.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Acuerdos y compromisos ({ci.actionItems.length}):</div>
                          {ci.actionItems.map((item: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.3rem 0', borderBottom: idx < ci.actionItems.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <span style={{ color: item.completed ? 'var(--success)' : 'var(--text-muted)' }}>{item.completed ? '✅' : '○'}</span>
                              <div style={{ flex: 1 }}>
                                <span style={{ color: 'var(--text-primary)' }}>{item.text}</span>
                                {item.assigneeName && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>— {item.assigneeName}</span>}
                                {item.dueDate && <span style={{ fontSize: '0.72rem', color: 'var(--warning)', marginLeft: '0.5rem' }}>Vence: {item.dueDate}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        Completado el {ci.completedAt ? new Date(ci.completedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* v3.1 F1 — Agenda Mágica: deep-link según rol del usuario.
                      - Manager del checkin o admin del tenant → "Preparar agenda"
                        (primary, puede editar).
                      - Employee del checkin → "Ver agenda" (ghost, read-only).
                      - Completed → siempre ghost "Ver agenda" para todos. */}
                  {(() => {
                    if (!hasMagicMeetings) return null;
                    if (ci.status !== 'scheduled' && ci.status !== 'completed') return null;
                    const isCheckinManager = ci.managerId === currentUserId;
                    const isCheckinEmployee = ci.employeeId === currentUserId;
                    const isTenantAdmin = role === 'tenant_admin' || role === 'super_admin';
                    const isParticipantOrAdmin =
                      isCheckinManager || isCheckinEmployee || isTenantAdmin;
                    if (!isParticipantOrAdmin) return null;

                    const canPrepare =
                      ci.status === 'scheduled' && (isCheckinManager || isTenantAdmin);
                    const className = canPrepare ? 'btn-primary' : 'btn-ghost';
                    const label = canPrepare ? 'Preparar agenda' : 'Ver agenda';

                    return (
                      <Link
                        href={`/dashboard/feedback/${ci.id}/agenda`}
                        className={className}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.3rem 0.65rem',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        ✨ {label}
                      </Link>
                    );
                  })()}
                  {/* Manager: Accept a requested check-in */}
                  {ci.status === 'requested' && canCreateCheckIn && ci.managerId === currentUserId && (
                    <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                      onClick={async () => {
                        try {
                          await acceptCheckIn.mutateAsync({ id: ci.id });
                        } catch (e: any) { alert(e.message || 'Error'); }
                      }}
                      disabled={acceptCheckIn.isPending}>
                      {acceptCheckIn.isPending ? '...' : '✓ Aceptar'}
                    </button>
                  )}
                  {ci.status === 'scheduled' && canCreateCheckIn && (() => {
                    // Only allow completion after scheduled date/time has passed
                    const parts = ci.scheduledDate?.split('-') || [];
                    const schedDate = parts.length === 3 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) : new Date(ci.scheduledDate);
                    if (ci.scheduledTime) {
                      const [hh, mm] = ci.scheduledTime.split(':').map(Number);
                      schedDate.setHours(hh || 0, mm || 0);
                    } else {
                      schedDate.setHours(23, 59); // If no time, allow at end of day
                    }
                    const canComplete = new Date() >= schedDate;
                    return (
                      <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', opacity: canComplete ? 1 : 0.5 }}
                        disabled={!canComplete}
                        title={canComplete ? 'Completar reunión' : 'Solo se puede completar después de la fecha y hora programada'}
                        onClick={() => {
                          setCompleteModal({ id: ci.id, topic: ci.topic, employee: userName(ci.employee) });
                          setCompleteForm({ notes: '', rating: 0, minutes: '', actionItems: [{ text: '', assigneeName: '', dueDate: '' }] });
                        }}>
                        {t('feedback.complete')}
                      </button>
                    );
                  })()}
                  {ci.status === 'scheduled' && ci.employeeId === currentUserId && (
                    <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setRejectModal({ id: ci.id, topic: ci.topic })}>
                      {t('feedback.reject')}
                    </button>
                  )}
                  {ci.status === 'scheduled' && canCreateCheckIn && (ci.managerId === currentUserId || role === 'tenant_admin' || role === 'super_admin') && (
                    <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', color: 'var(--danger)' }}
                      onClick={() => {
                        if (confirm(`¿Anular el check-in "${ci.topic}"? El registro se mantendrá con estado "Anulada".`)) {
                          cancelCheckIn.mutate(ci.id);
                        }
                      }}
                      disabled={cancelCheckIn.isPending}>
                      Anular
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

      {/* v3.1 — Modal de edición retroactiva para check-ins completados */}
      {retroEditModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '1rem' }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '560px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>📝 Editar información retroactiva</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{retroEditModal.topic}</strong> — {retroEditModal.employee}
            </p>
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm,6px)', border: '1px solid rgba(245,158,11,0.18)', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
              ⏱ <strong>Política de cierre automático:</strong> los check-ins con más de 5 días desde la fecha programada se cierran automáticamente. Desde acá puedes agregar retroactivamente las notas, minuta, acuerdos y valoración.
            </div>

            {/* Rating */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>Valoración</label>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} type="button"
                    onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, rating: star } } : r)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', opacity: star <= retroEditModal.current.rating ? 1 : 0.3 }}>
                    ⭐
                  </button>
                ))}
                {retroEditModal.current.rating > 0 && (
                  <button type="button"
                    onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, rating: 0 } } : r)}
                    className="btn-ghost" style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Notas</label>
              <textarea className="input" rows={3}
                value={retroEditModal.current.notes}
                onChange={(e) => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, notes: e.target.value } } : r)}
                placeholder="Qué se conversó, contexto, decisiones…"
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            {/* Minutes */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Minuta</label>
              <textarea className="input" rows={4}
                value={retroEditModal.current.minutes}
                onChange={(e) => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, minutes: e.target.value } } : r)}
                placeholder="Detalle formal de la reunión…"
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            {/* Action items */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Acuerdos y compromisos</label>
              {retroEditModal.current.actionItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.3rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={item.completed}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], completed: e.target.checked };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ accentColor: 'var(--accent)' }} />
                  <input className="input" type="text" placeholder="Acuerdo…"
                    value={item.text}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], text: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ flex: 2, fontSize: '0.82rem', textDecoration: item.completed ? 'line-through' : 'none', opacity: item.completed ? 0.6 : 1 }} />
                  <input className="input" type="text" placeholder="Responsable"
                    value={item.assigneeName}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], assigneeName: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ flex: 1, fontSize: '0.82rem' }} />
                  <input className="input" type="date"
                    value={item.dueDate}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], dueDate: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ width: '130px', fontSize: '0.82rem' }} />
                  {retroEditModal.current.actionItems.length > 1 && (
                    <button type="button"
                      onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, actionItems: r.current.actionItems.filter((_, i) => i !== idx) } } : r)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '1rem', padding: '0.3rem' }}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem' }}
                onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, actionItems: [...r.current.actionItems, { text: '', assigneeName: '', dueDate: '', completed: false }] } } : r)}>
                + Agregar acuerdo
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-ghost" onClick={() => setRetroEditModal(null)} disabled={editCompletedCheckIn.isPending}>Cancelar</button>
              <button className="btn-primary" disabled={editCompletedCheckIn.isPending}
                onClick={() => {
                  const data: any = {};
                  data.notes = retroEditModal.current.notes.trim();
                  data.minutes = retroEditModal.current.minutes.trim();
                  data.rating = retroEditModal.current.rating > 0 ? retroEditModal.current.rating : null;
                  data.actionItems = retroEditModal.current.actionItems
                    .filter(i => i.text.trim())
                    .map(i => ({
                      text: i.text.trim(),
                      completed: i.completed,
                      assigneeName: i.assigneeName.trim() || undefined,
                      dueDate: i.dueDate || undefined,
                    }));
                  editCompletedCheckIn.mutate({ id: retroEditModal.id, data }, {
                    onSuccess: () => { setRetroEditModal(null); toast.success('Información actualizada'); },
                    onError: (e: any) => toast.error(e?.message || 'Error al guardar'),
                  });
                }}>
                {editCompletedCheckIn.isPending ? 'Guardando…' : 'Guardar información'}
              </button>
            </div>
          </div>
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
  const { data: usersPage } = useActiveUsersForPicker();
  const sendFeedback = useSendQuickFeedback();
  const token = useAuthStore((s) => s.token);
  const { data: competencies } = useQuery({
    queryKey: ['competencies-feedback'],
    queryFn: () => api.development.competencies.list(token!),
    enabled: !!token,
  });
  // Load feedback configuration from tenant settings
  // Load feedback config (endpoint accessible to all roles)
  const { data: fbConfigData } = useQuery({
    queryKey: ['tenant-feedback-config'],
    queryFn: () => api.tenants.feedbackConfig(token!),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
  const fbAllowAnonymous = (fbConfigData as any)?.allowAnonymous !== false;
  const fbRequireCompetency = (fbConfigData as any)?.requireCompetency === true;
  const fbScope = (fbConfigData as any)?.scope || 'all';

  const [subTab, setSubTab] = useState<QuickSubTab>('received');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ toUserId: '', message: '', sentiment: 'positive' as Sentiment, category: '', isAnonymous: false });
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientDeptFilter, setRecipientDeptFilter] = useState('');

  const allUsers = usersPage?.data || [];
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const currentRole = useAuthStore((s) => s.user?.role) || '';
  // Find current user's department and managerId from the loaded users list
  const currentUserData = allUsers.find((u: any) => u.id === currentUserId);
  const myDepartment = currentUserData?.department || '';
  const myManagerId = currentUserData?.managerId || '';

  // Filter users by configurable scope (from tenant settings)
  const isAdminRole = currentRole === 'tenant_admin' || currentRole === 'super_admin';
  const scopedUsers = allUsers.filter((u: any) => {
    if (u.id === currentUserId || !u.isActive) return false;
    // Admins always see everyone
    if (isAdminRole) return true;
    // Apply scope from config
    if (fbScope === 'department') {
      return !!(myDepartment && u.department && u.department === myDepartment);
    }
    if (fbScope === 'team') {
      const sameDept = !!(myDepartment && u.department && u.department === myDepartment);
      const isDirectReport = u.managerId === currentUserId;
      const isMyManager = myManagerId === u.id;
      return sameDept || isDirectReport || isMyManager;
    }
    return true; // scope === 'all'
  });
  // Apply UI search/department filters on top
  const users = scopedUsers.filter((u: any) => {
    if (recipientDeptFilter && u.department !== recipientDeptFilter) return false;
    if (recipientSearch) {
      const q = recipientSearch.toLowerCase();
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      if (!name.includes(q) && !(u.position || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const { departments: recipientDepts } = useDepartments();
  const feedbackList = subTab === 'received' ? received : given;
  const isLoading = subTab === 'received' ? loadingReceived : loadingGiven;

  const [sendError, setSendError] = useState('');
  function handleSend() {
    if (!form.toUserId || !form.message) return;
    setSendError('');
    sendFeedback.mutate(
      {
        toUserId: form.toUserId,
        message: form.message,
        sentiment: form.sentiment,
        ...(form.category ? { category: form.category } : {}),
        isAnonymous: form.isAnonymous,
      },
      {
        onSuccess: () => {
          setForm({ toUserId: '', message: '', sentiment: 'positive', category: '', isAnonymous: false });
          setShowForm(false);
          setSendError('');
        },
        onError: (err: any) => {
          setSendError(err?.message || 'Error al enviar feedback. Verifique que el destinatario sea de su departamento o equipo directo.');
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
              onClick={() => { setSubTab(tab); setShowForm(false); }}
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
            {users.length === 0 && scopedUsers.length === 0 ? (
              <div style={{ padding: '0.75rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                No tienes colaboradores disponibles para enviar feedback. Verifica que tengas un departamento asignado o una jefatura directa configurada.
              </div>
            ) : (
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
            )}
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
                Competencia {fbRequireCompetency ? '(obligatoria)' : '(opcional)'}
              </label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={{ width: '100%' }}
              >
                <option value="">— Sin competencia asociada —</option>
                {(Array.isArray(competencies) ? competencies : []).map((c: any) => (
                  <option key={c.id} value={c.name}>{c.name}{c.category ? ` (${c.category})` : ''}</option>
                ))}
              </select>
            </div>
            {fbAllowAnonymous && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', paddingBottom: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={form.isAnonymous}
                  onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Anónimo
              </label>
            )}
          </div>
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={sendFeedback.isPending || !form.toUserId || !form.message || (fbRequireCompetency && !form.category)}
          >
            {sendFeedback.isPending ? t('common.loading') : t('feedback.sendFeedback')}
          </button>
          {sendError && (
            <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{sendError}</p>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <LoadingState message="Cargando feedback…" />
      ) : !feedbackList || feedbackList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="💬"
            title={subTab === 'received' ? t('feedback.noFeedbackReceived') : t('feedback.noFeedbackSent')}
            description={subTab === 'received'
              ? 'Pide retroalimentación a tu encargado o colegas. El feedback constructivo es clave para tu crecimiento.'
              : 'Envía feedback rápido a tus colegas. Reconoce un logro, entrega una observación o simplemente agradece.'}
          />
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
      {isLoading ? <LoadingState message="Cargando ubicaciones…" /> : !locations || locations.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="📍"
            title={t('feedback.noLocations')}
            description="Define ubicaciones (virtuales o físicas) donde se realizarán los check-ins 1:1. Facilita la agenda."
          />
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
  // Employee starts on Quick Feedback tab (they can't create check-ins)
  const [activeTab, setActiveTab] = useState<ActiveTab>(role === 'employee' ? 'quick' : 'checkins');
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
      <FirstVisitTip
        id="feedback"
        icon="💬"
        title="Retroalimentación continua"
        description="Agenda reuniones 1:1 con tu equipo (check-ins), envía feedback rápido a cualquier compañero y registra minutas de las reuniones. Todo queda documentado para seguimiento."
      />
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
              <li>{'Son reuniones de seguimiento periódicas entre encargado y colaborador'}</li>
              <li>{'El encargado solo puede crear check-ins con sus reportes directos'}</li>
              <li>{'El administrador puede crear check-ins con cualquier colaborador'}</li>
              <li><strong>{'Flujo: '}</strong>{'Programar → Reunión → Completar (con registro)'}</li>
              <li><strong>{'Al completar se registra: '}</strong>{'notas de la reunión, acuerdos/compromisos con responsable y fecha, y valoración de productividad (1-5 ⭐)'}</li>
              <li>{'El colaborador puede rechazar un check-in indicando el motivo'}</li>
              <li>{'Se envía invitación por email con archivo de calendario (.ics)'}</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              {'Quick Feedback (Retroalimentaci\u00f3n r\u00e1pida) - Feedback 360\u00b0:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li><strong>{'Administrador:'}</strong>{' Puede enviar feedback a cualquier colaborador de la organización'}</li>
              <li><strong>{'Encargado de equipo:'}</strong>{' Puede enviar a su equipo directo y miembros de su mismo departamento'}</li>
              <li><strong>{'Colaborador:'}</strong>{' Puede enviar a miembros de su departamento y a su jefatura directa'}</li>
              <li>{'Tipos de sentimiento: Positivo, Neutral, Constructivo'}</li>
              <li>{'Opción de envío anónimo'}</li>
              <li>{'Visibilidad configurable: Público (todos ven), Privado (solo emisor/receptor), Solo encargado (receptor y su encargado)'}</li>
              <li>{'Categorías personalizables'}</li>
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
              <li><strong>{'Administrador:'}</strong>{' Crea check-ins con cualquier colaborador, envía feedback a todos, gestiona lugares de reunión'}</li>
              <li><strong>{'Encargado de Equipo:'}</strong>{' Crea check-ins con sus reportes directos, envía feedback a su equipo y departamento, gestiona lugares'}</li>
              <li><strong>{'Colaborador:'}</strong>{' Ve sus check-ins asignados, envía feedback a su departamento y jefatura directa'}</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {tabBtn('checkins', t('feedback.tabCheckIns'))}
        {tabBtn('quick', t('feedback.tabQuickFeedback'))}
        {tabBtn('teamMeetings', '👥 Reuniones de Equipo')}
        {isAdminOrManager && tabBtn('locations', t('feedback.tabLocations'))}
      </div>

      {/* Content */}
      <div className="animate-fade-up">
        {activeTab === 'checkins' && <CheckInsTab />}
        {activeTab === 'quick' && <QuickFeedbackTab />}
        {activeTab === 'teamMeetings' && <TeamMeetingsTab />}
        {activeTab === 'locations' && isAdminOrManager && <LocationsTab />}
      </div>
    </div>
  );
}

/**
 * v3.1 Tema B — TeamMeetingsTab: tab completo para reuniones de equipo.
 *
 * Maneja listado + form de creación inline + detalle inline (expandible).
 * Mantenemos todo en un solo componente para no explotar el árbol — es
 * ~350 LoC pero cada pieza es corta.
 */
function TeamMeetingsTab() {
  const { user } = useAuthStore();
  const toast = useToastStore((s) => s.toast);
  const currentUserId = user?.userId || '';
  const role = user?.role || '';
  const canCreate = role === 'tenant_admin' || role === 'super_admin' || role === 'manager';

  const { data: meetings, isLoading } = useTeamMeetings();
  const { data: usersPage } = useActiveUsersForPicker();
  const { data: locations } = useMeetingLocations();
  const createMeeting = useCreateTeamMeeting();
  const cancelMeeting = useCancelTeamMeeting();
  const completeMeeting = useCompleteTeamMeeting();
  const editCompletedMeeting = useEditCompletedTeamMeeting();
  const respondMeeting = useRespondTeamMeeting();
  const addTopic = useAddTopicToTeamMeeting();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    scheduledDate: '',
    scheduledTime: '',
    locationId: '',
    participantIds: [] as string[],
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTopicText, setNewTopicText] = useState('');
  const [completeModal, setCompleteModal] = useState<{ id: string; title: string } | null>(null);
  // v3.1 — modal edición retroactiva de reuniones completadas (ej. auto-cerradas).
  const [retroEditModal, setRetroEditModal] = useState<{
    id: string; title: string;
    current: { notes: string; minutes: string; rating: number; actionItems: Array<{ text: string; assigneeName: string; dueDate: string; completed: boolean }> };
  } | null>(null);
  const [completeForm, setCompleteForm] = useState({
    notes: '', minutes: '', rating: 0,
    actionItems: [{ text: '', assigneeName: '', dueDate: '' }],
  });

  const allUsers = (usersPage as any)?.data || [];
  const baseSelectable = allUsers.filter((u: any) => u.id !== currentUserId && u.isActive);
  const { departments: tmDepts } = useDepartments();

  // v3.1 — Filtros de búsqueda en el multi-select de participantes
  // (búsqueda por nombre/cargo + filtro por departamento). Reset al
  // cerrar el form.
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantDeptFilter, setParticipantDeptFilter] = useState('');

  // Lista filtrada + selected para mantener a los ya elegidos visibles
  // aunque no matcheen los filtros actuales (UX clave: el usuario puede
  // cambiar filtros sin perder a los que ya marcó).
  const selectableUsers = baseSelectable.filter((u: any) => {
    if (form.participantIds.includes(u.id)) return true; // ya seleccionado → siempre visible
    if (participantDeptFilter && u.department !== participantDeptFilter) return false;
    if (participantSearch) {
      const q = participantSearch.toLowerCase();
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const pos = (u.position || '').toLowerCase();
      const dept = (u.department || '').toLowerCase();
      if (!name.includes(q) && !pos.includes(q) && !dept.includes(q)) return false;
    }
    return true;
  });

  const resetForm = () => {
    setForm({
      title: '', description: '', scheduledDate: '', scheduledTime: '',
      locationId: '', participantIds: [],
    });
    setParticipantSearch('');
    setParticipantDeptFilter('');
  };

  const handleCreate = () => {
    if (!form.title.trim() || !form.scheduledDate || form.participantIds.length === 0) return;
    createMeeting.mutate(
      {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        scheduledDate: form.scheduledDate,
        scheduledTime: form.scheduledTime || undefined,
        locationId: form.locationId || undefined,
        participantIds: form.participantIds,
      },
      {
        onSuccess: () => {
          toast('Reunión creada y participantes invitados.', 'success');
          resetForm();
          setShowForm(false);
        },
        onError: (e: any) => toast(e?.message || 'Error al crear la reunión', 'error'),
      },
    );
  };

  const togglePart = (uid: string) => {
    setForm((f) => ({
      ...f,
      participantIds: f.participantIds.includes(uid)
        ? f.participantIds.filter((x) => x !== uid)
        : [...f.participantIds, uid],
    }));
  };

  const today = new Date().toISOString().slice(0, 10);
  const nowHHmm = (() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  })();

  const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: { bg: 'rgba(245,158,11,0.12)', text: '#d97706', label: 'PROGRAMADA' },
    completed: { bg: 'rgba(16,185,129,0.12)', text: '#059669', label: 'COMPLETADA' },
    cancelled: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', label: 'CANCELADA' },
  };
  const pStatus: Record<string, { icon: string; color: string; label: string }> = {
    invited: { icon: '⏳', color: 'var(--text-muted)', label: 'Pendiente' },
    accepted: { icon: '✓', color: 'var(--success)', label: 'Aceptó' },
    declined: { icon: '✕', color: 'var(--danger)', label: 'Rechazó' },
    attended: { icon: '✅', color: 'var(--success)', label: 'Asistió' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>Reuniones de Equipo</h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Convoca reuniones con múltiples participantes. Cada uno puede aceptar, rechazar y proponer temas.
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Nueva reunión'}
          </button>
        )}
      </div>

      {/* Form crear */}
      {showForm && canCreate && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Título *
              </label>
              <input className="input" type="text" placeholder="Ej. Retrospectiva del Q2"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Descripción (opcional)
              </label>
              <textarea className="input" rows={2} placeholder="Contexto o agenda general…"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={2000}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Fecha *</label>
                <input className="input" type="date" min={today}
                  value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                  style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Hora</label>
                <input className="input" type="time"
                  min={form.scheduledDate === today ? nowHHmm : undefined}
                  value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
                  style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Lugar (opcional)</label>
                <select className="input" value={form.locationId}
                  onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                  style={{ width: '100%' }}>
                  <option value="">Sin lugar</option>
                  {(locations as any[] || []).map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.type === 'virtual' ? '💻' : '🏢'} {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Participantes ({form.participantIds.length} seleccionados) *
              </label>

              {/* v3.1 — Filtros de búsqueda del multi-select */}
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  type="text"
                  placeholder="Buscar por nombre, cargo o departamento…"
                  value={participantSearch}
                  onChange={(e) => setParticipantSearch(e.target.value)}
                  style={{ flex: '1 1 240px', fontSize: '0.82rem' }}
                />
                <select
                  className="input"
                  value={participantDeptFilter}
                  onChange={(e) => setParticipantDeptFilter(e.target.value)}
                  style={{ flex: '0 1 200px', fontSize: '0.82rem' }}
                >
                  <option value="">Todos los departamentos</option>
                  {tmDepts.map((d: string) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {(participantSearch || participantDeptFilter) && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setParticipantSearch(''); setParticipantDeptFilter(''); }}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                    title="Limpiar filtros"
                  >
                    ✕ Limpiar
                  </button>
                )}
              </div>

              <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm,6px)', padding: '0.5rem' }}>
                {selectableUsers.length === 0 ? (
                  <div style={{ padding: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {baseSelectable.length === 0
                      ? 'No hay colaboradores activos disponibles.'
                      : 'Ningún colaborador coincide con los filtros.'}
                  </div>
                ) : (
                  selectableUsers.map((u: any) => {
                    const checked = form.participantIds.includes(u.id);
                    return (
                      <label key={u.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.55rem',
                          padding: '0.3rem 0.4rem', fontSize: '0.82rem', cursor: 'pointer',
                          borderRadius: 'var(--radius-sm,4px)',
                          background: checked ? 'rgba(201,147,58,0.08)' : 'transparent',
                        }}>
                        <input type="checkbox" checked={checked} onChange={() => togglePart(u.id)}
                          style={{ accentColor: 'var(--accent)' }} />
                        <span>
                          <strong>{u.firstName} {u.lastName}</strong>
                          {(u.department || u.position) && (
                            <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                              — {[u.department, u.position].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                {(participantSearch || participantDeptFilter)
                  ? `Mostrando ${selectableUsers.length} de ${baseSelectable.length} colaboradores — los ya seleccionados permanecen visibles aunque no coincidan con los filtros. `
                  : ''}
                Tú quedas incluido automáticamente como organizador.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</button>
              <button className="btn-primary"
                onClick={handleCreate}
                disabled={
                  createMeeting.isPending ||
                  !form.title.trim() ||
                  !form.scheduledDate ||
                  form.participantIds.length === 0
                }>
                {createMeeting.isPending ? 'Creando…' : 'Crear y enviar invitaciones'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <LoadingState message="Cargando reuniones de equipo…" />
      ) : !meetings || meetings.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="👥"
            title="Sin reuniones de equipo"
            description={canCreate
              ? 'Programa tu primera reunión con más de un colaborador.'
              : 'Cuando el admin o un manager te invite, aparecerá aquí.'}
            ctaLabel={canCreate ? '+ Nueva reunión' : undefined}
            ctaOnClick={canCreate ? () => setShowForm(true) : undefined}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {meetings.map((m: any) => {
            const myPart = (m.participants || []).find((p: any) => p.userId === currentUserId);
            const isOrganizer = m.organizerId === currentUserId;
            const isAdmin = role === 'tenant_admin' || role === 'super_admin';
            const canManage = isOrganizer || isAdmin;
            const st = statusBadge[m.status];
            const accepted = (m.participants || []).filter((p: any) => p.status === 'accepted').length;
            const declined = (m.participants || []).filter((p: any) => p.status === 'declined').length;
            const pending = (m.participants || []).filter((p: any) => p.status === 'invited').length;
            const isExpanded = expandedId === m.id;

            return (
              <div key={m.id} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '260px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{m.title}</span>
                      <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px', background: st.bg, color: st.text, letterSpacing: '0.03em' }}>
                        {st.label}
                      </span>
                      {m.autoCompleted && (
                        <span
                          style={{
                            fontSize: '0.66rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            background: 'rgba(245,158,11,0.12)', color: '#d97706',
                            letterSpacing: '0.03em', textTransform: 'uppercase',
                          }}
                          title="Cerrada automáticamente por política de +5 días. Puedes editar la información desde 'Editar información'."
                        >
                          ⏱ cerrada automáticamente
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span>📅 {formatDate(m.scheduledDate)}{m.scheduledTime ? ` a las ${String(m.scheduledTime).slice(0, 5)}` : ''}</span>
                      <span>👤 Organiza: {userName(m.organizer)}</span>
                      <span>👥 {accepted} aceptaron · {declined} rechazaron · {pending} pendientes</span>
                      {m.location && (
                        <span>{m.location.type === 'virtual' ? '💻' : '🏢'} {m.location.name}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {m.status === 'scheduled' && myPart && !isOrganizer && myPart.status === 'invited' && (
                      <>
                        <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                          disabled={respondMeeting.isPending}
                          onClick={() =>
                            respondMeeting.mutate({ id: m.id, status: 'accepted' }, {
                              onSuccess: () => toast('Aceptaste la invitación.', 'success'),
                              onError: (e: any) => toast(e?.message || 'Error', 'error'),
                            })
                          }>
                          ✓ Aceptar
                        </button>
                        <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', color: 'var(--danger)' }}
                          disabled={respondMeeting.isPending}
                          onClick={() => {
                            const reason = prompt('Motivo del rechazo (opcional):') || undefined;
                            respondMeeting.mutate({ id: m.id, status: 'declined', declineReason: reason }, {
                              onSuccess: () => toast('Rechazaste la invitación.', 'info'),
                              onError: (e: any) => toast(e?.message || 'Error', 'error'),
                            });
                          }}>
                          ✕ Rechazar
                        </button>
                      </>
                    )}
                    {m.status === 'scheduled' && canManage && (
                      <>
                        <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                          onClick={() => { setCompleteModal({ id: m.id, title: m.title }); setCompleteForm({ notes: '', minutes: '', rating: 0, actionItems: [{ text: '', assigneeName: '', dueDate: '' }] }); }}>
                          Completar
                        </button>
                        <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', color: 'var(--danger)' }}
                          onClick={() => {
                            const reason = prompt('Motivo de la cancelación (opcional):') || undefined;
                            if (confirm(`¿Cancelar la reunión "${m.title}"?`)) {
                              cancelMeeting.mutate({ id: m.id, reason }, {
                                onSuccess: () => toast('Reunión cancelada.', 'info'),
                                onError: (e: any) => toast(e?.message || 'Error', 'error'),
                              });
                            }
                          }}>
                          Cancelar
                        </button>
                      </>
                    )}
                    <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                      {isExpanded ? 'Cerrar' : 'Ver detalle'}
                    </button>
                  </div>
                </div>

                {/* Estado del caller dentro de la reunión */}
                {myPart && !isOrganizer && (
                  <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Tu estado: <strong style={{ color: pStatus[myPart.status]?.color }}>{pStatus[myPart.status]?.icon} {pStatus[myPart.status]?.label}</strong>
                    {myPart.status === 'declined' && myPart.declineReason && <span> — {myPart.declineReason}</span>}
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm, 8px)', border: '1px solid rgba(99,102,241,0.12)' }}>
                    {m.description && (
                      <div style={{ marginBottom: '0.85rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Descripción</div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.description}</div>
                      </div>
                    )}
                    {/* Participants list */}
                    <div style={{ marginBottom: '0.85rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Participantes ({(m.participants || []).length})</div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {(m.participants || []).map((p: any) => (
                          <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span>
                              {p.userId === m.organizerId && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.05rem 0.35rem', borderRadius: '999px', background: 'rgba(201,147,58,0.15)', color: 'var(--accent)', marginRight: '0.4rem' }}>ORGANIZA</span>}
                              {p.user ? `${p.user.firstName} ${p.user.lastName}` : p.userId.slice(0, 8)}
                            </span>
                            <span style={{ color: pStatus[p.status]?.color || 'var(--text-muted)', fontWeight: 600 }}>
                              {pStatus[p.status]?.icon} {pStatus[p.status]?.label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Agenda topics */}
                    <div style={{ marginBottom: '0.85rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                        Temas propuestos ({(m.agendaTopics || []).length})
                      </div>
                      {(m.agendaTopics || []).length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.4rem' }}>Aún nadie propuso un tema.</div>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
                          {(m.agendaTopics || []).map((topic: any, idx: number) => (
                            <li key={idx} style={{ padding: '0.4rem 0.6rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm, 6px)', marginBottom: '0.3rem', fontSize: '0.82rem' }}>
                              <div>{topic.text}</div>
                              {topic.addedByName && (
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                                  — {topic.addedByName}{topic.addedAt ? ` · ${formatDate(topic.addedAt)}` : ''}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {m.status === 'scheduled' && (isOrganizer || (myPart && (myPart.status === 'accepted' || myPart.status === 'invited'))) && (
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                          <input className="input" type="text" placeholder="Propón un tema…"
                            value={newTopicText}
                            maxLength={300}
                            disabled={addTopic.isPending}
                            onChange={(e) => setNewTopicText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newTopicText.trim() && !addTopic.isPending) {
                                e.preventDefault();
                                addTopic.mutate({ id: m.id, text: newTopicText.trim() }, {
                                  onSuccess: () => { setNewTopicText(''); toast('Tema agregado', 'success'); },
                                  onError: (e: any) => toast(e?.message || 'Error', 'error'),
                                });
                              }
                            }}
                            style={{ flex: 1, fontSize: '0.82rem' }} />
                          <button className="btn-primary"
                            disabled={addTopic.isPending || !newTopicText.trim()}
                            onClick={() =>
                              addTopic.mutate({ id: m.id, text: newTopicText.trim() }, {
                                onSuccess: () => { setNewTopicText(''); toast('Tema agregado', 'success'); },
                                onError: (e: any) => toast(e?.message || 'Error', 'error'),
                              })
                            }
                            style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}>
                            + Agregar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Completed details */}
                    {m.status === 'completed' && (
                      <>
                        {/* Botón Editar información (organizer o admin) */}
                        {canManage && (
                          <div style={{ marginBottom: '0.75rem' }}>
                            <button
                              onClick={() => setRetroEditModal({
                                id: m.id,
                                title: m.title,
                                current: {
                                  notes: m.notes || '',
                                  minutes: m.minutes || '',
                                  rating: m.rating || 0,
                                  actionItems: (m.actionItems || []).length > 0
                                    ? (m.actionItems as any[]).map((a: any) => ({
                                        text: a.text || '',
                                        assigneeName: a.assigneeName || '',
                                        dueDate: a.dueDate || '',
                                        completed: !!a.completed,
                                      }))
                                    : [{ text: '', assigneeName: '', dueDate: '', completed: false }],
                                },
                              })}
                              style={{ background: 'none', border: '1px solid var(--accent)', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-sm,6px)' }}
                              title={m.autoCompleted ? 'Agrega notas, minuta, acuerdos y valoración retroactivos' : 'Edita la información registrada'}
                            >
                              📝 Editar información
                            </button>
                          </div>
                        )}
                        {m.rating && (
                          <div style={{ marginBottom: '0.5rem', fontSize: '0.82rem' }}>
                            <strong>Valoración:</strong> {'⭐'.repeat(m.rating)}{'☆'.repeat(5 - m.rating)}
                          </div>
                        )}
                        {m.notes && (
                          <div style={{ marginBottom: '0.5rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Notas</div>
                            <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.notes}</div>
                          </div>
                        )}
                        {m.minutes && (
                          <div style={{ marginBottom: '0.5rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Minuta</div>
                            <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.minutes}</div>
                          </div>
                        )}
                        {m.actionItems && m.actionItems.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Acuerdos ({m.actionItems.length})</div>
                            {m.actionItems.map((ai: any, i: number) => (
                              <div key={i} style={{ fontSize: '0.82rem', padding: '0.25rem 0' }}>
                                {ai.completed ? '✅' : '○'} {ai.text}
                                {ai.assigneeName && <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>— {ai.assigneeName}</span>}
                                {ai.dueDate && <span style={{ color: 'var(--warning)', marginLeft: '0.4rem', fontSize: '0.75rem' }}>vence: {ai.dueDate}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {m.status === 'cancelled' && m.cancelReason && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--danger)', padding: '0.5rem', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm,6px)' }}>
                        <strong>Motivo de cancelación:</strong> {m.cancelReason}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Complete modal */}
      {completeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '560px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Completar reunión</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{completeModal.title}</strong>
            </p>
            <div style={{ marginBottom: '0.9rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>¿Cómo fue la reunión?</label>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} type="button"
                    onClick={() => setCompleteForm({ ...completeForm, rating: star })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', opacity: star <= completeForm.rating ? 1 : 0.3 }}>
                    ⭐
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: '0.9rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Notas</label>
              <textarea className="input" rows={3}
                value={completeForm.notes}
                onChange={(e) => setCompleteForm({ ...completeForm, notes: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: '0.9rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Minuta</label>
              <textarea className="input" rows={4}
                value={completeForm.minutes}
                onChange={(e) => setCompleteForm({ ...completeForm, minutes: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: '0.9rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Acuerdos y compromisos</label>
              {completeForm.actionItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.3rem' }}>
                  <input className="input" type="text" placeholder="Acuerdo…"
                    value={item.text}
                    onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], text: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ flex: 2, fontSize: '0.82rem' }} />
                  <input className="input" type="text" placeholder="Responsable"
                    value={item.assigneeName}
                    onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], assigneeName: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ flex: 1, fontSize: '0.82rem' }} />
                  <input className="input" type="date"
                    value={item.dueDate}
                    onChange={(e) => {
                      const items = [...completeForm.actionItems];
                      items[idx] = { ...items[idx], dueDate: e.target.value };
                      setCompleteForm({ ...completeForm, actionItems: items });
                    }}
                    style={{ width: '130px', fontSize: '0.82rem' }} />
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem' }}
                onClick={() => setCompleteForm({ ...completeForm, actionItems: [...completeForm.actionItems, { text: '', assigneeName: '', dueDate: '' }] })}>
                + Agregar acuerdo
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-ghost" onClick={() => setCompleteModal(null)}>Cancelar</button>
              <button className="btn-primary"
                disabled={completeMeeting.isPending}
                onClick={() => {
                  const data: any = {};
                  if (completeForm.notes.trim()) data.notes = completeForm.notes.trim();
                  if (completeForm.minutes.trim()) data.minutes = completeForm.minutes.trim();
                  if (completeForm.rating > 0) data.rating = completeForm.rating;
                  const validItems = completeForm.actionItems.filter(i => i.text.trim());
                  if (validItems.length > 0) data.actionItems = validItems;
                  completeMeeting.mutate({ id: completeModal.id, data }, {
                    onSuccess: () => { setCompleteModal(null); toast('Reunión completada', 'success'); },
                    onError: (e: any) => toast(e?.message || 'Error', 'error'),
                  });
                }}>
                {completeMeeting.isPending ? 'Guardando…' : 'Completar reunión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v3.1 — Modal edición retroactiva de reunión de equipo completada */}
      {retroEditModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '1rem' }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '560px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>📝 Editar información retroactiva</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{retroEditModal.title}</strong>
            </p>
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm,6px)', border: '1px solid rgba(245,158,11,0.18)', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
              ⏱ <strong>Política de cierre automático:</strong> las reuniones con más de 5 días desde la fecha programada se cierran automáticamente. Desde acá puedes agregar retroactivamente las notas, minuta, acuerdos y valoración.
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>Valoración</label>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} type="button"
                    onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, rating: star } } : r)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', opacity: star <= retroEditModal.current.rating ? 1 : 0.3 }}>
                    ⭐
                  </button>
                ))}
                {retroEditModal.current.rating > 0 && (
                  <button type="button"
                    onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, rating: 0 } } : r)}
                    className="btn-ghost" style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>Limpiar</button>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Notas</label>
              <textarea className="input" rows={3}
                value={retroEditModal.current.notes}
                onChange={(e) => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, notes: e.target.value } } : r)}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Minuta</label>
              <textarea className="input" rows={4}
                value={retroEditModal.current.minutes}
                onChange={(e) => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, minutes: e.target.value } } : r)}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Acuerdos y compromisos</label>
              {retroEditModal.current.actionItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.3rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={item.completed}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], completed: e.target.checked };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ accentColor: 'var(--accent)' }} />
                  <input className="input" type="text" placeholder="Acuerdo…"
                    value={item.text}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], text: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ flex: 2, fontSize: '0.82rem', textDecoration: item.completed ? 'line-through' : 'none', opacity: item.completed ? 0.6 : 1 }} />
                  <input className="input" type="text" placeholder="Responsable"
                    value={item.assigneeName}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], assigneeName: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ flex: 1, fontSize: '0.82rem' }} />
                  <input className="input" type="date"
                    value={item.dueDate}
                    onChange={(e) => setRetroEditModal((r) => {
                      if (!r) return r;
                      const items = [...r.current.actionItems];
                      items[idx] = { ...items[idx], dueDate: e.target.value };
                      return { ...r, current: { ...r.current, actionItems: items } };
                    })}
                    style={{ width: '130px', fontSize: '0.82rem' }} />
                  {retroEditModal.current.actionItems.length > 1 && (
                    <button type="button"
                      onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, actionItems: r.current.actionItems.filter((_, i) => i !== idx) } } : r)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '1rem', padding: '0.3rem' }}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem' }}
                onClick={() => setRetroEditModal((r) => r ? { ...r, current: { ...r.current, actionItems: [...r.current.actionItems, { text: '', assigneeName: '', dueDate: '', completed: false }] } } : r)}>
                + Agregar acuerdo
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-ghost" onClick={() => setRetroEditModal(null)} disabled={editCompletedMeeting.isPending}>Cancelar</button>
              <button className="btn-primary" disabled={editCompletedMeeting.isPending}
                onClick={() => {
                  const data: any = {};
                  data.notes = retroEditModal.current.notes.trim();
                  data.minutes = retroEditModal.current.minutes.trim();
                  data.rating = retroEditModal.current.rating > 0 ? retroEditModal.current.rating : null;
                  data.actionItems = retroEditModal.current.actionItems
                    .filter(i => i.text.trim())
                    .map(i => ({
                      text: i.text.trim(),
                      completed: i.completed,
                      assigneeName: i.assigneeName.trim() || undefined,
                      dueDate: i.dueDate || undefined,
                    }));
                  editCompletedMeeting.mutate({ id: retroEditModal.id, data }, {
                    onSuccess: () => { setRetroEditModal(null); toast('Información actualizada', 'success'); },
                    onError: (e: any) => toast(e?.message || 'Error al guardar', 'error'),
                  });
                }}>
                {editCompletedMeeting.isPending ? 'Guardando…' : 'Guardar información'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * v3.1 — TopicCombobox: input con autocomplete basado en el historial
 * de temas usados en check-ins previos por este usuario (o del tenant si
 * es admin). El usuario puede:
 *   - Escribir libre: crea un tema nuevo.
 *   - Click en una sugerencia: rellena el input con ese tema.
 *   - Ver contexto de cada sugerencia: cuántas veces se usó, con quién,
 *     y cuándo fue la última.
 *
 * Funcionamiento:
 *   - Al enfocar el input, se muestra el dropdown con top-20 temas.
 *   - Si el usuario tipea, se filtra client-side (case-insensitive).
 *   - El dropdown se cierra al: blur (con 150ms delay para permitir click
 *     en las sugerencias), Escape, o click fuera.
 *   - Si el backend devuelve [] (empleado o tenant sin historial), el input
 *     funciona como un <input> normal — sin dropdown.
 *
 * No usamos una lib externa (Downshift/Combobox) — el alcance es chico.
 */
function TopicCombobox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { data: topics } = useMyTopicsHistory();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtro case-insensitive por lo que el usuario tipea.
  const filtered = useMemo(() => {
    const list = topics || [];
    const q = value.trim().toLowerCase();
    if (!q) return list.slice(0, 10);
    return list
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 10);
  }, [topics, value]);

  // Click afuera → cerrar dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const showDropdown = open && (topics?.length || 0) > 0 && filtered.length > 0;

  const formatLastUsed = (iso: string): string => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        className="input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
          setOpen(true);
        }}
        onBlur={() => {
          // Delay para permitir que un mousedown en el dropdown dispare
          // onClick antes que el blur cierre el dropdown.
          closeTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ width: '100%' }}
        autoComplete="off"
      />
      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.25rem)',
            left: 0,
            right: 0,
            maxHeight: '280px',
            overflowY: 'auto',
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm, 8px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: '0.4rem 0.7rem',
              fontSize: '0.68rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-base, #fafaf7)',
            }}
          >
            Temas recientes
          </div>
          {filtered.map((t) => {
            const people = t.history
              .slice(0, 3)
              .map((h) => h.employeeName)
              .filter(Boolean);
            const peopleStr = people.length > 0
              ? 'con ' + people.join(', ') + (t.history.length > 3 ? ` y ${t.history.length - 3} más` : '')
              : '';
            return (
              <button
                key={t.title}
                type="button"
                role="option"
                // Importante: mousedown dispara ANTES de blur → permite
                // seleccionar sin cerrar el dropdown prematuramente.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(t.title);
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.55rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(201,147,58,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '0.15rem',
                  }}
                >
                  {t.title}
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.4,
                  }}
                >
                  Usado {t.usedCount} {t.usedCount === 1 ? 'vez' : 'veces'}
                  {peopleStr ? ' · ' + peopleStr : ''}
                  {' · último ' + formatLastUsed(t.lastUsedAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}
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
