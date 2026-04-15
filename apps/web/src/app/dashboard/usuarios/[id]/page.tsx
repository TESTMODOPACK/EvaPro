'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { api, UserData, UserNoteData, PerformanceHistoryEntry } from '@/lib/api';
import { getRoleLabel, getRoleColor } from '@/lib/roles';
import { useToastStore } from '@/store/toast.store';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function fmtScore(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(1);
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

const MOVEMENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  department_change: { label: 'Cambio de Departamento', color: '#6366f1' },
  position_change: { label: 'Cambio de Cargo', color: '#f59e0b' },
  promotion: { label: 'Promoción', color: '#10b981' },
  demotion: { label: 'Democión', color: '#ef4444' },
  lateral_transfer: { label: 'Transferencia Lateral', color: '#14b8a6' },
};

const DEPARTURE_TYPE_LABELS: Record<string, string> = {
  resignation: 'Renuncia', termination: 'Despido', retirement: 'Jubilación',
  contract_end: 'Fin de contrato', abandonment: 'Abandono', mutual_agreement: 'Mutuo acuerdo',
};

const DEPARTURE_REASON_LABELS: Record<string, string> = {
  better_offer: 'Mejor oferta',
  work_climate: 'Clima laboral',
  performance: 'Desempeño',
  restructuring: 'Reestructuración',
  personal: 'Motivos personales',
  relocation: 'Cambio de ciudad',
  career_growth: 'Crecimiento de carrera',
  compensation: 'Compensación',
  health: 'Salud',
  other: 'Otro',
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  general: { label: 'General', color: '#64748b' },
  performance: { label: 'Desempeño', color: '#6366f1' },
  conduct: { label: 'Conducta', color: '#f59e0b' },
  development: { label: 'Desarrollo', color: '#10b981' },
  recognition: { label: 'Reconocimiento', color: '#a78bfa' },
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '0.15rem 0.5rem',
  borderRadius: '999px',
  fontSize: '0.7rem',
  fontWeight: 600,
  background: `${color}18`,
  color,
});

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: '1.5rem',
  marginBottom: '1.25rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.2rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 8px)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
};

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore();
  const currentUser = useAuthStore((s) => s.user);

  const [user, setUser] = useState<UserData | null>(null);
  const [manager, setManager] = useState<UserData | null>(null);
  const [history, setHistory] = useState<PerformanceHistoryEntry[]>([]);
  const [notes, setNotes] = useState<UserNoteData[]>([]);
  const [loading, setLoading] = useState(true);

  // Note form
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteForm, setNoteForm] = useState({ title: '', content: '', category: 'general', isConfidential: false });
  const [savingNote, setSavingNote] = useState(false);

  // Movement tracking
  const [movements, setMovements] = useState<any[]>([]);
  const [departures, setDepartures] = useState<any[]>([]);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movForm, setMovForm] = useState({ movementType: 'department_change', effectiveDate: new Date().toISOString().split('T')[0], fromDepartment: '', toDepartment: '', fromPosition: '', toPosition: '', reason: '' });
  const [savingMovement, setSavingMovement] = useState(false);

  // Departure form
  const [showDepartureForm, setShowDepartureForm] = useState(false);
  const [depForm, setDepForm] = useState<{
    departureType: string;
    departureDate: string;
    isVoluntary: boolean;
    reasonCategory: string;
    reasonDetail: string;
    wouldRehire: 'yes' | 'no' | 'unknown';
    reassignToManagerId: string;
  }>({
    departureType: 'resignation',
    departureDate: new Date().toISOString().split('T')[0],
    isVoluntary: true,
    reasonCategory: '',
    reasonDetail: '',
    wouldRehire: 'unknown',
    reassignToManagerId: '',
  });
  const [savingDeparture, setSavingDeparture] = useState(false);
  // List of potential managers (active managers + admins) for reassignment
  const [availableManagers, setAvailableManagers] = useState<Array<{ id: string; firstName: string; lastName: string; role: string }>>([]);

  // Stage C: reactivation + edit/cancel departure
  const [showReactivateForm, setShowReactivateForm] = useState(false);
  const [reactForm, setReactForm] = useState<{ reasonForReactivation: string; managerId: string }>({ reasonForReactivation: '', managerId: '' });
  const [savingReactivation, setSavingReactivation] = useState(false);
  const [editingDepartureId, setEditingDepartureId] = useState<string | null>(null);
  const [editDepForm, setEditDepForm] = useState<{ reasonCategory: string; reasonDetail: string; wouldRehire: 'yes' | 'no' | 'unknown' }>({ reasonCategory: '', reasonDetail: '', wouldRehire: 'unknown' });
  const [savingEditDeparture, setSavingEditDeparture] = useState(false);

  const isAdmin = currentUser?.role === 'tenant_admin' || currentUser?.role === 'super_admin';
  const isManager = currentUser?.role === 'manager' || isAdmin;

  const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

  const loadData = useCallback(async () => {
    if (!token || !userId) return;
    setLoading(true);
    try {
      const [userData, historyData, notesData] = await Promise.all([
        api.users.getById(token, userId),
        api.reports.performanceHistory(token, userId).catch(() => ({ userId, history: [] })),
        isManager ? api.users.listNotes(token, userId).catch(() => []) : Promise.resolve([]),
      ]);
      setUser(userData);
      setHistory(historyData.history || []);
      setNotes(notesData as UserNoteData[]);

      if (userData.managerId) {
        api.users.getById(token, userData.managerId).then(setManager).catch(() => {});
      }

      // Load movements & departures
      if (isManager) {
        Promise.all([
          fetch(`${API}/users/${userId}/movements`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
          fetch(`${API}/users/${userId}/departures`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
        ]).then(([movs, deps]) => { setMovements(movs); setDepartures(deps); }).catch(() => {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, userId, isManager]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateNote = async () => {
    if (!token || !noteForm.title.trim() || !noteForm.content.trim()) return;
    setSavingNote(true);
    try {
      await api.users.createNote(token, userId, noteForm);
      setNoteForm({ title: '', content: '', category: 'general', isConfidential: false });
      setShowNoteForm(false);
      const updated = await api.users.listNotes(token, userId);
      setNotes(updated);
    } catch (err: any) {
      toast.error(err.message || 'Error al crear nota');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!token || !confirm('¿Eliminar esta nota?')) return;
    try {
      await api.users.deleteNote(token, userId, noteId);
      setNotes(notes.filter((n) => n.id !== noteId));
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    }
  };

  const handleCreateMovement = async () => {
    if (!token || !movForm.effectiveDate) return;
    setSavingMovement(true);
    try {
      const res = await fetch(`${API}/users/${userId}/movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(movForm),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Error'); }
      setShowMovementForm(false);
      setMovForm({ movementType: 'department_change', effectiveDate: new Date().toISOString().split('T')[0], fromDepartment: '', toDepartment: '', fromPosition: '', toPosition: '', reason: '' });
      // Reload
      const movs = await fetch(`${API}/users/${userId}/movements`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => []);
      setMovements(movs);
      toast.success('Movimiento registrado');
    } catch (err: any) {
      toast.error(err.message || 'Error al registrar movimiento');
    } finally {
      setSavingMovement(false);
    }
  };

  // Load available managers (for reassignment dropdown) lazily when form opens
  const loadAvailableManagers = useCallback(async () => {
    if (!token || availableManagers.length > 0) return;
    try {
      const res = await api.users.list(token, 1, 200, { status: 'active' });
      const list = (res.data || [])
        .filter((u: any) => u.id !== userId && (u.role === 'manager' || u.role === 'tenant_admin'))
        .map((u: any) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, role: u.role }));
      setAvailableManagers(list);
    } catch { /* silent */ }
  }, [token, userId, availableManagers.length]);

  const handleRegisterDeparture = async () => {
    if (!token || !depForm.departureDate) return;
    const confirmed = confirm(
      `¿Confirmar desvinculación?\n\n` +
      `Se aplicará de forma automática (transacción atómica):\n\n` +
      `── Seguridad ──\n` +
      `• Desactiva al usuario inmediatamente\n` +
      `• Cierra todas sus sesiones activas (JWT invalidado)\n` +
      `• Elimina su configuración de 2FA\n\n` +
      `── Jerarquía ──\n` +
      `• Reasigna sus reportes directos ${depForm.reassignToManagerId ? 'al manager seleccionado' : '(quedarán sin jefatura)'}\n\n` +
      `── Trabajo en curso ──\n` +
      `• Objetivos activos/draft/pendientes → abandonados\n` +
      `• Planes de desarrollo (PDI) activos → cancelados\n` +
      `• Acciones PDI pendientes → canceladas\n` +
      `• Check-ins agendados → cancelados\n` +
      `• Evaluaciones pendientes/en progreso (como evaluador o evaluado) → canceladas\n` +
      `• Notificaciones no leídas → archivadas\n` +
      `• Candidaturas internas activas → rechazadas\n` +
      `• Entries de calibración pendientes → retirados\n\n` +
      `Esta acción NO se puede deshacer desde la UI.`,
    );
    if (!confirmed) return;

    setSavingDeparture(true);
    try {
      const payload: any = {
        departureType: depForm.departureType,
        departureDate: depForm.departureDate,
        isVoluntary: depForm.isVoluntary,
      };
      if (depForm.reasonCategory) payload.reasonCategory = depForm.reasonCategory;
      if (depForm.reasonDetail.trim()) payload.reasonDetail = depForm.reasonDetail.trim();
      if (depForm.wouldRehire !== 'unknown') payload.wouldRehire = depForm.wouldRehire === 'yes';
      if (depForm.reassignToManagerId) payload.reassignToManagerId = depForm.reassignToManagerId;

      await api.users.registerDeparture(token, userId, payload);
      toast.success('Desvinculación registrada');
      setShowDepartureForm(false);
      // Reload user + departures
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Error al registrar desvinculación');
    } finally {
      setSavingDeparture(false);
    }
  };

  // ─── Stage C handlers ─────────────────────────────────────────────────

  const handleReactivateUser = async () => {
    if (!token) return;
    const confirmed = confirm(
      `¿Reactivar a este usuario?\n\n` +
      `Esto:\n` +
      `• Activará al usuario y limpiará su fecha de desvinculación\n` +
      `• Le enviará un email de bienvenida con una contraseña temporal\n` +
      `• Forzará cambio de contraseña al primer login\n` +
      `• Invalidará cualquier token JWT residual\n\n` +
      `⚠️ NO se restaurarán sus objetivos, PDI, evaluaciones ni otros registros cancelados previamente — deben re-generarse manualmente si corresponde.\n\n` +
      `¿Continuar?`,
    );
    if (!confirmed) return;

    setSavingReactivation(true);
    try {
      const payload: any = {};
      if (reactForm.reasonForReactivation.trim()) payload.reasonForReactivation = reactForm.reasonForReactivation.trim();
      if (reactForm.managerId) payload.managerId = reactForm.managerId;
      const res = await api.users.reactivate(token, userId, payload);
      toast.success(`Usuario reactivado. Email enviado a ${res.tempPasswordSentTo}`);
      setShowReactivateForm(false);
      setReactForm({ reasonForReactivation: '', managerId: '' });
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Error al reactivar usuario');
    } finally {
      setSavingReactivation(false);
    }
  };

  const handleStartEditDeparture = (d: any) => {
    setEditingDepartureId(d.id);
    setEditDepForm({
      reasonCategory: d.reasonCategory || '',
      reasonDetail: d.reasonDetail || '',
      wouldRehire: d.wouldRehire === true ? 'yes' : d.wouldRehire === false ? 'no' : 'unknown',
    });
  };

  const handleSaveEditDeparture = async () => {
    if (!token || !editingDepartureId) return;
    setSavingEditDeparture(true);
    try {
      const payload: any = {
        reasonCategory: editDepForm.reasonCategory || null,
        reasonDetail: editDepForm.reasonDetail.trim() || null,
        wouldRehire: editDepForm.wouldRehire === 'yes' ? true : editDepForm.wouldRehire === 'no' ? false : null,
      };
      await api.users.updateDeparture(token, userId, editingDepartureId, payload);
      toast.success('Registro de desvinculación actualizado');
      setEditingDepartureId(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar desvinculación');
    } finally {
      setSavingEditDeparture(false);
    }
  };

  const handleCancelDeparture = async (d: any) => {
    if (!token) return;
    const reason = prompt(
      `Cancelar esta desvinculación (del ${new Date(d.departureDate).toLocaleDateString()})?\n\n` +
      `Esto eliminará el registro y reactivará al usuario si está inactivo.\n` +
      `⚠️ NO se restaurarán objetivos, PDI, evaluaciones ni otros registros cancelados previamente.\n\n` +
      `Motivo (requerido):`,
    );
    if (!reason || !reason.trim()) return;

    try {
      const res = await api.users.cancelDeparture(token, userId, d.id, reason.trim());
      toast.success(res.reactivated ? 'Desvinculación cancelada y usuario reactivado' : 'Desvinculación cancelada');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Error al cancelar desvinculación');
    }
  };

  // Evolution metrics
  const firstScore = history.find((h) => h.avgOverall !== null)?.avgOverall ?? null;
  const lastScore = history.length > 0 ? history[history.length - 1].avgOverall : null;
  const evolution = firstScore !== null && lastScore !== null ? Number(lastScore) - Number(firstScore) : null;
  const bestScore = history.reduce((max, h) => {
    const v = h.avgOverall !== null ? Number(h.avgOverall) : -1;
    return v > max ? v : max;
  }, -1);

  if (loading) return <Spinner />;
  if (!user) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Usuario no encontrado</div>;

  const roleInfo = { label: getRoleLabel(user.role), color: getRoleColor(user.role) };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn-ghost"
          style={{ fontSize: '0.8rem', marginBottom: '0.75rem', padding: '0.3rem 0.6rem' }}
          onClick={() => router.push('/dashboard/usuarios')}
        >
          ← Volver a Usuarios
        </button>
      </div>

      {/* User Info Card */}
      <div className="animate-fade-up" style={cardStyle}>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Avatar */}
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%',
            background: `${roleInfo.color}20`, color: roleInfo.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', fontWeight: 800, flexShrink: 0,
          }}>
            {user.firstName.charAt(0)}{user.lastName.charAt(0)}
          </div>

          <div style={{ flex: 1, minWidth: '200px' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.25rem' }}>
              {user.firstName} {user.lastName}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {user.email}
            </p>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
              <div>
                <div style={labelStyle}>Rol</div>
                <span style={badgeStyle(roleInfo.color)}>{roleInfo.label}</span>
              </div>
              <div>
                <div style={labelStyle}>Departamento</div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{user.department || '—'}</span>
              </div>
              <div>
                <div style={labelStyle}>Cargo</div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{user.position || '—'}</span>
              </div>
              <div>
                <div style={labelStyle}>Encargado de Equipo</div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {manager ? `${manager.firstName} ${manager.lastName}` : '—'}
                </span>
              </div>
              <div>
                <div style={labelStyle}>Fecha ingreso</div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fmtDate(user.hireDate)}</span>
              </div>
              <div>
                <div style={labelStyle}>Estado</div>
                <span style={badgeStyle(user.isActive ? '#10b981' : '#ef4444')}>
                  {user.isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button className="btn-ghost" onClick={() => router.push(`/dashboard/desempeno/${userId}`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Ver gráfico
            </button>
          </div>
        </div>
      </div>

      {/* Evolution KPIs */}
      {history.length > 0 && (
        <div
          className="animate-fade-up-delay-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}
        >
          {[
            { label: 'Ciclos evaluados', value: String(history.length), color: '#6366f1' },
            { label: 'Último puntaje', value: lastScore !== null ? fmtScore(lastScore) : '—', color: '#10b981' },
            { label: 'Mejor puntaje', value: bestScore >= 0 ? bestScore.toFixed(1) : '—', color: '#f59e0b' },
            {
              label: 'Evolución',
              value: evolution !== null ? `${evolution >= 0 ? '+' : ''}${evolution.toFixed(1)}` : '—',
              color: evolution !== null && evolution >= 0 ? '#10b981' : '#ef4444',
            },
          ].map((m, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                {m.label}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: m.color, marginTop: '0.25rem' }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Performance History Table */}
      <div className="animate-fade-up-delay-1" style={cardStyle}>
        <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>Historial de Evaluaciones</h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Resultados por ciclo de evaluación y tipo de relación
        </p>

        {history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
            Sin evaluaciones completadas aún
          </p>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Ciclo', 'Período', 'Auto', 'Jefatura', 'Pares', 'General'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.72rem', fontWeight: 600,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ transition: 'background 0.15s' }}>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                      {h.cycleName}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                      {fmtDate(h.startDate)} – {fmtDate(h.endDate)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#6366f1', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                      {fmtScore(h.avgSelf)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#10b981', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                      {fmtScore(h.avgManager)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#f59e0b', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                      {fmtScore(h.avgPeer)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 800, borderBottom: '1px solid var(--border)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.2rem 0.6rem', borderRadius: '999px',
                        background: h.avgOverall !== null ? '#a78bfa18' : 'transparent',
                        color: h.avgOverall !== null ? '#a78bfa' : 'var(--text-muted)',
                      }}>
                        {fmtScore(h.avgOverall)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HR Notes / Informes */}
      {isManager && (
        <div className="animate-fade-up-delay-2" style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.15rem' }}>Informes y Notas de RRHH</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Registros personalizados por el encargado de evaluaciones
              </p>
            </div>
            <button className="btn-primary" onClick={() => setShowNoteForm(!showNoteForm)}>
              {showNoteForm ? 'Cancelar' : '+ Nuevo informe'}
            </button>
          </div>

          {/* Create note form */}
          {showNoteForm && (
            <div style={{
              background: 'var(--bg-main, #fafafa)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm, 8px)', padding: '1.25rem', marginBottom: '1.25rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Título</label>
                  <input
                    style={inputStyle}
                    placeholder="Título del informe"
                    value={noteForm.title}
                    onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Categoría</label>
                  <select
                    style={inputStyle}
                    value={noteForm.category}
                    onChange={(e) => setNoteForm({ ...noteForm, category: e.target.value })}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Contenido</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
                  placeholder="Descripción del informe, observaciones, recomendaciones..."
                  value={noteForm.content}
                  onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={noteForm.isConfidential}
                    onChange={(e) => setNoteForm({ ...noteForm, isConfidential: e.target.checked })}
                  />
                  Confidencial (solo admin)
                </label>
                <button className="btn-primary" onClick={handleCreateNote} disabled={savingNote || !noteForm.title.trim() || !noteForm.content.trim()}>
                  {savingNote ? 'Guardando...' : 'Guardar informe'}
                </button>
              </div>
            </div>
          )}

          {/* Notes list */}
          {notes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
              No hay informes registrados para este usuario
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {notes.map((note) => {
                const cat = CATEGORY_LABELS[note.category] || CATEGORY_LABELS.general;
                return (
                  <div
                    key={note.id}
                    style={{
                      padding: '1rem 1.25rem',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm, 8px)',
                      borderLeft: `3px solid ${cat.color}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{note.title}</span>
                          <span style={badgeStyle(cat.color)}>{cat.label}</span>
                          {note.isConfidential && (
                            <span style={badgeStyle('#ef4444')}>Confidencial</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Por {note.author ? `${note.author.firstName} ${note.author.lastName}` : 'Sistema'} — {fmtDate(note.createdAt)}
                        </div>
                      </div>
                      {isAdmin && (
                        <button
                          className="btn-ghost"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                          onClick={() => handleDeleteNote(note.id)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {note.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Historial de Movimientos ─────────────────────────────────────── */}
      {isManager && (
        <div className="animate-fade-up-delay-2" style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.15rem' }}>Historial de Movimientos</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Movimientos internos y salidas registradas
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {isAdmin && !user?.isActive && user?.departureDate && (
                <button
                  onClick={() => {
                    setShowReactivateForm(!showReactivateForm);
                    if (!showReactivateForm) loadAvailableManagers();
                  }}
                  style={{
                    background: showReactivateForm ? 'var(--bg-surface)' : '#10b981',
                    color: showReactivateForm ? 'var(--text-primary)' : '#fff',
                    border: showReactivateForm ? '1px solid var(--border)' : 'none',
                    padding: '0.5rem 0.9rem',
                    borderRadius: 'var(--radius-sm, 8px)',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                  }}
                >
                  {showReactivateForm ? 'Cancelar' : '↻ Reactivar Usuario'}
                </button>
              )}
              {isAdmin && user?.isActive && (
                <button
                  onClick={() => {
                    setShowDepartureForm(!showDepartureForm);
                    if (!showDepartureForm) loadAvailableManagers();
                  }}
                  style={{
                    background: showDepartureForm ? 'var(--bg-surface)' : '#ef4444',
                    color: showDepartureForm ? 'var(--text-primary)' : '#fff',
                    border: showDepartureForm ? '1px solid var(--border)' : 'none',
                    padding: '0.5rem 0.9rem',
                    borderRadius: 'var(--radius-sm, 8px)',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                  }}
                >
                  {showDepartureForm ? 'Cancelar' : '× Registrar Desvinculación'}
                </button>
              )}
              <button className="btn-primary" onClick={() => setShowMovementForm(!showMovementForm)}>
                {showMovementForm ? 'Cancelar' : '+ Registrar Movimiento'}
              </button>
            </div>
          </div>

          {/* Reactivation form */}
          {showReactivateForm && (
            <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius-sm, 8px)', padding: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(16,185,129,0.08)', borderRadius: '6px', fontSize: '0.78rem', color: '#065f46' }}>
                ↻ Reactivación de usuario desvinculado. Se enviará un email con contraseña temporal. Los objetivos/PDI/evaluaciones previos <strong>no se restauran</strong> automáticamente.
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Asignar manager (opcional)</label>
                <select style={inputStyle} value={reactForm.managerId} onChange={(e) => setReactForm({ ...reactForm, managerId: e.target.value })}>
                  <option value="">— Sin manager asignado —</option>
                  {availableManagers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.role === 'tenant_admin' ? 'Admin' : 'Manager'})</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Motivo de reactivación (opcional)</label>
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ej: Acepta nueva oferta, regreso tras licencia, etc." value={reactForm.reasonForReactivation} onChange={(e) => setReactForm({ ...reactForm, reasonForReactivation: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleReactivateUser}
                  disabled={savingReactivation}
                  style={{
                    background: '#10b981', color: '#fff', border: 'none',
                    padding: '0.55rem 1rem', borderRadius: 'var(--radius-sm, 8px)',
                    cursor: savingReactivation ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem', fontWeight: 600, opacity: savingReactivation ? 0.6 : 1,
                  }}
                >
                  {savingReactivation ? 'Reactivando...' : 'Confirmar reactivación'}
                </button>
              </div>
            </div>
          )}

          {/* Departure form */}
          {showDepartureForm && (
            <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm, 8px)', padding: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '6px', fontSize: '0.78rem', color: '#b91c1c' }}>
                ⚠️ La desvinculación es <strong>irreversible desde la UI</strong>: desactiva al usuario, invalida sus sesiones, reasigna sus reportes directos y limpia su 2FA.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Tipo de salida</label>
                  <select style={inputStyle} value={depForm.departureType} onChange={(e) => setDepForm({ ...depForm, departureType: e.target.value, isVoluntary: ['resignation', 'retirement', 'mutual_agreement'].includes(e.target.value) })}>
                    <option value="resignation">Renuncia</option>
                    <option value="termination">Despido</option>
                    <option value="retirement">Jubilación</option>
                    <option value="contract_end">Fin de contrato</option>
                    <option value="abandonment">Abandono</option>
                    <option value="mutual_agreement">Mutuo acuerdo</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Fecha efectiva</label>
                  <input type="date" style={inputStyle} value={depForm.departureDate} onChange={(e) => setDepForm({ ...depForm, departureDate: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Categoría de motivo</label>
                  <select style={inputStyle} value={depForm.reasonCategory} onChange={(e) => setDepForm({ ...depForm, reasonCategory: e.target.value })}>
                    <option value="">— Sin especificar —</option>
                    {Object.entries(DEPARTURE_REASON_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>¿Recontratable?</label>
                  <select style={inputStyle} value={depForm.wouldRehire} onChange={(e) => setDepForm({ ...depForm, wouldRehire: e.target.value as 'yes' | 'no' | 'unknown' })}>
                    <option value="unknown">Sin determinar</option>
                    <option value="yes">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Reasignar reportes directos a</label>
                <select style={inputStyle} value={depForm.reassignToManagerId} onChange={(e) => setDepForm({ ...depForm, reassignToManagerId: e.target.value })}>
                  <option value="">— Dejar sin jefatura (managerId = null) —</option>
                  {availableManagers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.role === 'tenant_admin' ? 'Admin' : 'Manager'})</option>
                  ))}
                </select>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                  Sólo se ofrecen usuarios activos con rol manager o tenant_admin.
                </p>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Detalle adicional (opcional)</label>
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ej: Aceptó oferta en otra empresa, cierre de proyecto, etc." value={depForm.reasonDetail} onChange={(e) => setDepForm({ ...depForm, reasonDetail: e.target.value })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="checkbox" id="isVoluntary" checked={depForm.isVoluntary} onChange={(e) => setDepForm({ ...depForm, isVoluntary: e.target.checked })} />
                <label htmlFor="isVoluntary" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>Salida voluntaria</label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleRegisterDeparture}
                  disabled={savingDeparture || !depForm.departureDate}
                  style={{
                    background: '#ef4444', color: '#fff', border: 'none',
                    padding: '0.55rem 1rem', borderRadius: 'var(--radius-sm, 8px)',
                    cursor: savingDeparture ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem', fontWeight: 600, opacity: savingDeparture ? 0.6 : 1,
                  }}
                >
                  {savingDeparture ? 'Registrando...' : 'Confirmar desvinculación'}
                </button>
              </div>
            </div>
          )}

          {/* Create movement form */}
          {showMovementForm && (
            <div style={{ background: 'var(--bg-main, #fafafa)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)', padding: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Tipo de movimiento</label>
                  <select style={inputStyle} value={movForm.movementType} onChange={(e) => setMovForm({ ...movForm, movementType: e.target.value })}>
                    <option value="department_change">Cambio de Departamento</option>
                    <option value="position_change">Cambio de Cargo</option>
                    <option value="promotion">Promoción</option>
                    <option value="demotion">Democión</option>
                    <option value="lateral_transfer">Transferencia Lateral</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Fecha efectiva</label>
                  <input type="date" style={inputStyle} value={movForm.effectiveDate} onChange={(e) => setMovForm({ ...movForm, effectiveDate: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Desde Departamento</label>
                  <input style={inputStyle} placeholder={user?.department || '—'} value={movForm.fromDepartment} onChange={(e) => setMovForm({ ...movForm, fromDepartment: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Hacia Departamento</label>
                  <input style={inputStyle} placeholder="Nuevo departamento" value={movForm.toDepartment} onChange={(e) => setMovForm({ ...movForm, toDepartment: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Desde Cargo</label>
                  <input style={inputStyle} placeholder={user?.position || '—'} value={movForm.fromPosition} onChange={(e) => setMovForm({ ...movForm, fromPosition: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Hacia Cargo</label>
                  <input style={inputStyle} placeholder="Nuevo cargo" value={movForm.toPosition} onChange={(e) => setMovForm({ ...movForm, toPosition: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Motivo</label>
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Motivo del movimiento..." value={movForm.reason} onChange={(e) => setMovForm({ ...movForm, reason: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" onClick={handleCreateMovement} disabled={savingMovement || !movForm.effectiveDate}>
                  {savingMovement ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </div>
          )}

          {/* Timeline */}
          {movements.length === 0 && departures.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
              Sin movimientos registrados
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Departures */}
              {departures.map((d: any, idx: number) => {
                const isEditing = editingDepartureId === d.id;
                const isLatest = idx === 0; // departures are sorted DESC by date
                return (
                  <div key={d.id} style={{ padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)', borderLeft: '3px solid #ef4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Salida de la empresa</span>
                        <span style={badgeStyle('#ef4444')}>{DEPARTURE_TYPE_LABELS[d.departureType] || d.departureType}</span>
                        <span style={badgeStyle(d.isVoluntary ? '#f59e0b' : '#ef4444')}>{d.isVoluntary ? 'Voluntaria' : 'Involuntaria'}</span>
                        {d.reasonCategory && <span style={badgeStyle('#64748b')}>{DEPARTURE_REASON_LABELS[d.reasonCategory] || d.reasonCategory}</span>}
                        {d.wouldRehire === true && <span style={badgeStyle('#10b981')}>Recontratable</span>}
                        {d.wouldRehire === false && <span style={badgeStyle('#ef4444')}>No recontratable</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(d.departureDate)}</span>
                        {isAdmin && !isEditing && (
                          <button
                            onClick={() => handleStartEditDeparture(d)}
                            title="Editar detalles"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0.2rem 0.4rem' }}
                          >
                            ✏️
                          </button>
                        )}
                        {isAdmin && !isEditing && isLatest && (
                          <button
                            onClick={() => handleCancelDeparture(d)}
                            title="Cancelar desvinculación (reactiva al usuario)"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#ef4444', padding: '0.2rem 0.4rem' }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    {!isEditing && d.reasonDetail && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>{d.reasonDetail}</p>
                    )}
                    {isEditing && (
                      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-main, #fafafa)', borderRadius: '6px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <div>
                            <label style={labelStyle}>Categoría</label>
                            <select style={inputStyle} value={editDepForm.reasonCategory} onChange={(e) => setEditDepForm({ ...editDepForm, reasonCategory: e.target.value })}>
                              <option value="">— Sin especificar —</option>
                              {Object.entries(DEPARTURE_REASON_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>¿Recontratable?</label>
                            <select style={inputStyle} value={editDepForm.wouldRehire} onChange={(e) => setEditDepForm({ ...editDepForm, wouldRehire: e.target.value as 'yes' | 'no' | 'unknown' })}>
                              <option value="unknown">Sin determinar</option>
                              <option value="yes">Sí</option>
                              <option value="no">No</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ marginBottom: '0.5rem' }}>
                          <label style={labelStyle}>Detalle</label>
                          <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }} value={editDepForm.reasonDetail} onChange={(e) => setEditDepForm({ ...editDepForm, reasonDetail: e.target.value })} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button onClick={() => setEditingDepartureId(null)} style={{ padding: '0.35rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>Cancelar</button>
                          <button onClick={handleSaveEditDeparture} disabled={savingEditDeparture} style={{ padding: '0.35rem 0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: savingEditDeparture ? 'not-allowed' : 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                            {savingEditDeparture ? 'Guardando...' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Movements */}
              {movements.map((m: any) => {
                const mInfo = MOVEMENT_TYPE_LABELS[m.movementType] || { label: m.movementType, color: '#64748b' };
                return (
                  <div key={m.id} style={{ padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)', borderLeft: `3px solid ${mInfo.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{mInfo.label}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(m.effectiveDate)}</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {m.fromDepartment && m.toDepartment && m.fromDepartment !== m.toDepartment && (
                        <span>Depto: {m.fromDepartment} → {m.toDepartment}</span>
                      )}
                      {m.fromPosition && m.toPosition && m.fromPosition !== m.toPosition && (
                        <span>{m.fromDepartment && m.toDepartment ? ' · ' : ''}Cargo: {m.fromPosition} → {m.toPosition}</span>
                      )}
                    </div>
                    {m.reason && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{m.reason}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
