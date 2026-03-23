'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-accent',
  in_progress: 'badge-warning',
  completed: 'badge-success',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  in_progress: 'En progreso',
  completed: 'Completado',
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

export default function CalibracionPage() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();

  const [sessions, setSessions] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', cycleId: '', department: '', notes: '' });

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api.talent.calibration.list(token),
      api.cycles.list(token),
    ])
      .then(([sess, cyc]) => {
        setSessions(sess || []);
        setCycles(cyc || []);
      })
      .catch(() => { setSessions([]); setCycles([]); })
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCreate() {
    if (!form.name || !form.cycleId || !token) return;
    setCreating(true);
    try {
      const data: any = { name: form.name, cycleId: form.cycleId };
      if (form.department) data.department = form.department;
      if (form.notes) data.notes = form.notes;
      await api.talent.calibration.create(token, data);
      const updated = await api.talent.calibration.list(token);
      setSessions(updated || []);
      setForm({ name: '', cycleId: '', department: '', notes: '' });
      setShowForm(false);
    } catch { /* ignore */ }
    setCreating(false);
  }

  if (!token) return null;

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>Calibración</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '.875rem', marginTop: '.25rem' }}>
            Sesiones de calibración de evaluaciones
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : 'Nueva sesión'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
            Nueva sesión de calibración
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
              Nombre *
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Calibración Q1 2026"
                style={{
                  width: '100%', padding: '.5rem .75rem', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  color: 'var(--text-primary)', marginTop: '.25rem', fontSize: '.875rem',
                }}
              />
            </label>
            <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
              Ciclo *
              <select
                value={form.cycleId}
                onChange={(e) => setForm({ ...form, cycleId: e.target.value })}
                style={{
                  width: '100%', padding: '.5rem .75rem', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  color: 'var(--text-primary)', marginTop: '.25rem', fontSize: '.875rem',
                }}
              >
                <option value="">Seleccionar ciclo...</option>
                {cycles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
              Departamento (opcional)
              <input
                type="text"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="Ej: Tecnología"
                style={{
                  width: '100%', padding: '.5rem .75rem', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  color: 'var(--text-primary)', marginTop: '.25rem', fontSize: '.875rem',
                }}
              />
            </label>
            <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
              Notas (opcional)
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Notas adicionales..."
                style={{
                  width: '100%', padding: '.5rem .75rem', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  color: 'var(--text-primary)', marginTop: '.25rem', fontSize: '.875rem', resize: 'vertical',
                }}
              />
            </label>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem' }}>
            <button className="btn-primary" onClick={handleCreate} disabled={creating || !form.name || !form.cycleId}>
              {creating ? 'Creando...' : 'Crear sesión'}
            </button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Sessions list */}
      {loading ? (
        <Spinner />
      ) : sessions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
          No hay sesiones de calibración creadas aún.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {sessions.map((s: any) => {
            const cycleName = s.cycle?.name || cycles.find((c: any) => c.id === s.cycleId)?.name || '—';
            return (
              <div
                key={s.id}
                className="card"
                onClick={() => router.push(`/dashboard/calibracion/${s.id}`)}
                style={{ cursor: 'pointer', transition: 'var(--transition)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{s.name}</h3>
                  <span className={`badge ${STATUS_BADGE[s.status] || 'badge-accent'}`}>
                    {STATUS_LABEL[s.status] || s.status}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.85rem', color: 'var(--text-secondary)' }}>
                  <div>Ciclo: <strong>{cycleName}</strong></div>
                  <div>Departamento: <strong>{s.department || 'Todos'}</strong></div>
                  {s.moderator && <div>Moderador: <strong>{s.moderator.firstName} {s.moderator.lastName}</strong></div>}
                  <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', marginTop: '.25rem' }}>
                    {formatDate(s.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
