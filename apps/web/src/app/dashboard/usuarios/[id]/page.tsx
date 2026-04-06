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
            <button className="btn-primary" onClick={() => setShowMovementForm(!showMovementForm)}>
              {showMovementForm ? 'Cancelar' : '+ Registrar Movimiento'}
            </button>
          </div>

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
              {departures.map((d: any) => (
                <div key={d.id} style={{ padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)', borderLeft: '3px solid #ef4444' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Salida de la empresa</span>
                      <span style={badgeStyle('#ef4444')}>{DEPARTURE_TYPE_LABELS[d.departureType] || d.departureType}</span>
                      <span style={badgeStyle(d.isVoluntary ? '#f59e0b' : '#ef4444')}>{d.isVoluntary ? 'Voluntaria' : 'Involuntaria'}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(d.departureDate)}</span>
                  </div>
                  {d.reasonDetail && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>{d.reasonDetail}</p>}
                </div>
              ))}

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
