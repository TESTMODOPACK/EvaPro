'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { calibrationStatusLabel as STATUS_LABEL, calibrationStatusBadge as STATUS_BADGE } from '@/lib/statusMaps';

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
  const [showGuide, setShowGuide] = useState(true);
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
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up">

        {/* Header */}
        <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
              {`Calibraci\u00f3n de Evaluaciones`}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {`Sesiones colaborativas para ajustar y validar puntajes de desempe\u00f1o y potencial`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-ghost"
              onClick={() => setShowGuide(!showGuide)}
              style={{ fontSize: '0.82rem' }}
            >
              {showGuide ? `Ocultar gu\u00eda` : `C\u00f3mo funciona`}
            </button>
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : `Nueva sesi\u00f3n`}
            </button>
          </div>
        </div>

        {/* Guide */}
        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              {`Gu\u00eda de uso: Calibraci\u00f3n de Evaluaciones`}
            </h3>

            {/* Qué es */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {`\u00bfQu\u00e9 es la calibraci\u00f3n?`}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {`Es un proceso donde el comit\u00e9 de liderazgo revisa y ajusta los puntajes de las evaluaciones para garantizar equidad y consistencia entre equipos. Se utiliza principalmente en evaluaciones 360\u00b0.`}
              </p>
            </div>

            {/* Cuándo se usa */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {`\u00bfCu\u00e1ndo se usa?`}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {`Despu\u00e9s de que todas las evaluaciones del ciclo est\u00e1n completadas, antes de entregar los resultados. Es una etapa del ciclo de evaluaci\u00f3n que se activa en evaluaciones 360\u00b0.`}
              </p>
            </div>

            {/* Flujo */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {`Flujo de calibraci\u00f3n`}
              </div>
              <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
                <li>{`Crear sesi\u00f3n vinculada a un ciclo cerrado o en etapa de calibraci\u00f3n`}</li>
                <li>{`Cargar participantes desde Gesti\u00f3n de Talento`}</li>
                <li>{`Revisar puntajes y realizar ajustes justificados`}</li>
                <li>{`Ajustes mayores a 1 punto requieren justificaci\u00f3n escrita`}</li>
                <li>{`Completar la sesi\u00f3n \u2014 los puntajes calibrados se aplican a la Matriz Nine Box`}</li>
              </ol>
            </div>

            {/* Conexión con otras funciones */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {`Conexi\u00f3n con otras funciones`}
              </div>
              <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
                <li><strong>{`Ciclos de Evaluaci\u00f3n:`}</strong>{` la calibraci\u00f3n es una etapa del ciclo 360\u00b0`}</li>
                <li><strong>{`Talento (Nine Box):`}</strong>{` el resultado calibrado alimenta la matriz de talento`}</li>
                <li><strong>{`Reportes:`}</strong>{` los puntajes calibrados se reflejan en analytics`}</li>
              </ul>
            </div>

            {/* Permisos */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {`Permisos`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>{`Administrador:`}</strong>{` Crea sesiones, ajusta puntajes, cierra la calibraci\u00f3n`}
                </div>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>{`Encargado de Equipo:`}</strong>{` Puede participar como revisor en sesiones de su departamento`}
                </div>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>{`Colaborador:`}</strong>{` No tiene acceso a esta funci\u00f3n`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="card animate-fade-up" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
              {`Nueva sesi\u00f3n de calibraci\u00f3n`}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
              {`Completa los datos para crear una nueva sesi\u00f3n de calibraci\u00f3n.`}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  {`Nombre *`}
                </label>
                <input
                  className="input"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={`Ej: Calibraci\u00f3n Q1 2026`}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  {`Ciclo *`}
                </label>
                <select
                  className="input"
                  value={form.cycleId}
                  onChange={(e) => setForm({ ...form, cycleId: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="">{`Seleccionar ciclo...`}</option>
                  {cycles.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  {`Departamento (opcional)`}
                </label>
                <input
                  className="input"
                  type="text"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder={`Ej: Tecnolog\u00eda`}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  {`Notas (opcional)`}
                </label>
                <textarea
                  className="input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder={`Notas adicionales...`}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={creating || !form.name || !form.cycleId}
              >
                {creating ? `Creando...` : `Crear sesi\u00f3n`}
              </button>
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Sessions list */}
        {loading ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
              {`No hay sesiones de calibraci\u00f3n creadas a\u00fan.`}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {`Crea una sesi\u00f3n vinculada a un ciclo completado para comenzar`}
            </p>
          </div>
        ) : (
          <div
            className="animate-fade-up-delay-1"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
          >
            {sessions.map((s: any) => {
              const cycleName = s.cycle?.name || cycles.find((c: any) => c.id === s.cycleId)?.name || '\u2014';
              const isActive   = s.status === 'in_progress';
              const isDone     = s.status === 'completed';

              return (
                <div
                  key={s.id}
                  className="card"
                  onClick={() => router.push(`/dashboard/calibracion/${s.id}`)}
                  style={{ cursor: 'pointer', padding: '1.4rem', transition: 'var(--transition)', height: '100%', display: 'flex', flexDirection: 'column' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {/* Row 1: department tag + status badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)',
                      background: 'rgba(99,102,241,0.1)', padding: '0.2rem 0.65rem',
                      borderRadius: '999px', letterSpacing: '0.02em',
                    }}>
                      {s.department || `General`}
                    </span>
                    <span className={`badge ${STATUS_BADGE[s.status] || 'badge-accent'}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </div>

                  {/* Row 2: session name */}
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4, color: 'var(--text-primary)' }}>
                    {s.name}
                  </h3>

                  {/* Row 3: cycle name */}
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    {cycleName}
                  </p>

                  {/* Row 4: meta — moderator + date */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', flex: 1 }}>
                    {s.moderator && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                        </svg>
                        <span>{s.moderator.firstName} {s.moderator.lastName}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span>{formatDate(s.createdAt)}</span>
                    </div>
                  </div>

                  {/* Row 5: status bar (matches evaluaciones card) */}
                  {isActive && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Progreso</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-hover)' }}>En curso</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '50%', height: '100%', borderRadius: '999px', background: 'var(--accent)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                  {isDone && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Progreso</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)' }}>Completada</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: '999px', background: 'var(--success)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
