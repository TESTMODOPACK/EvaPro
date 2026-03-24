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
  const [showGuide, setShowGuide] = useState(false);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>{`Calibraci\u00f3n de Evaluaciones`}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '.875rem', marginTop: '.25rem' }}>
            {`Sesiones colaborativas para ajustar y validar puntajes de desempe\u00f1o y potencial`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : `Nueva sesi\u00f3n`}
        </button>
      </div>

      {/* Guide toggle */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          className="btn-ghost"
          onClick={() => setShowGuide(!showGuide)}
          style={{ fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}
        >
          {showGuide ? '\u25B2' : '\u25BC'}{' '}
          {showGuide ? `Ocultar gu\u00eda de uso` : `Ver gu\u00eda de uso`}
        </button>
      </div>

      {/* Collapsible guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
          <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>
            {`Gu\u00eda de uso: Calibraci\u00f3n de Evaluaciones`}
          </h2>

          {/* 1. Qué es */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`\u00bfQu\u00e9 es la calibraci\u00f3n?`}
            </p>
            <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {`Es un proceso donde el comit\u00e9 de liderazgo revisa y ajusta los puntajes de las evaluaciones para garantizar equidad y consistencia entre equipos. Se utiliza principalmente en evaluaciones 360\u00b0.`}
            </p>
          </div>

          {/* 2. Cuándo se usa */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`\u00bfCu\u00e1ndo se usa?`}
            </p>
            <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {`Despu\u00e9s de que todas las evaluaciones del ciclo est\u00e1n completadas, antes de entregar los resultados. Es una etapa del ciclo de evaluaci\u00f3n que se activa autom\u00e1ticamente en evaluaciones 360\u00b0.`}
            </p>
          </div>

          {/* 3. Flujo */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`Flujo de calibraci\u00f3n:`}
            </p>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li>{`Se crea una sesi\u00f3n de calibraci\u00f3n vinculada a un ciclo cerrado o en etapa de calibraci\u00f3n`}</li>
              <li>{`Se agregan los colaboradores a calibrar`}</li>
              <li>{`El comit\u00e9 revisa puntajes y puede hacer ajustes justificados`}</li>
              <li>{`Si el ajuste es mayor a 1 punto, se requiere justificaci\u00f3n obligatoria`}</li>
              <li>{`Se cierra la sesi\u00f3n y los puntajes calibrados quedan como definitivos`}</li>
            </ol>
          </div>

          {/* 4. Reglas de negocio */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`Reglas de negocio:`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li>{`Solo administradores pueden crear y gestionar sesiones de calibraci\u00f3n`}</li>
              <li>{`Ajustes mayores a 1 punto requieren justificaci\u00f3n escrita`}</li>
              <li>{`Los puntajes originales se preservan para auditor\u00eda`}</li>
              <li>{`Recomendado para organizaciones con m\u00e1s de 10 personas evaluadas`}</li>
            </ul>
          </div>

          {/* 5. Conexión con otras funciones */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`Conexi\u00f3n con otras funciones:`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{`Ciclos de Evaluaci\u00f3n`}</strong>{`: la calibraci\u00f3n es una etapa del ciclo 360\u00b0`}</li>
              <li><strong>{`Reportes`}</strong>{`: los puntajes calibrados se reflejan en analytics y reportes`}</li>
              <li><strong>{`Talento (Nine Box)`}</strong>{`: el resultado calibrado alimenta la matriz de talento`}</li>
            </ul>
          </div>

          {/* 6. Permisos */}
          <div>
            <p style={{ margin: '0 0 .25rem', fontWeight: 700, fontSize: '.88rem', color: 'var(--text-primary)' }}>
              {`Permisos:`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{`Administrador`}</strong>{`: Crea sesiones, ajusta puntajes, cierra calibraci\u00f3n`}</li>
              <li><strong>{`Encargado de Equipo`}</strong>{`: Puede participar como observador`}</li>
              <li><strong>{`Colaborador`}</strong>{`: No tiene acceso a esta funci\u00f3n`}</li>
            </ul>
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>
          {`\u00bfQu\u00e9 es la Calibraci\u00f3n y a qui\u00e9n est\u00e1 dirigida?`}
        </p>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {`La calibraci\u00f3n es un proceso donde el Administrador del Sistema re\u00fane a los l\u00edderes para revisar, discutir y ajustar los puntajes de desempe\u00f1o y potencial de los colaboradores, asegurando equidad y consistencia en las evaluaciones.`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.75rem' }}>
          <div>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700 }}>
              {`Dirigido a`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li>{`Administrador del Sistema: crea y modera las sesiones`}</li>
              <li>{`Encargados de Equipo: participan ajustando puntajes de sus reportes`}</li>
            </ul>
          </div>
          <div>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700 }}>
              {`Flujo de trabajo`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li><strong>{'1. Crear sesi\u00f3n'}</strong>{` \u2192 seleccionar ciclo y departamento`}</li>
              <li><strong>{'2. Cargar participantes'}</strong>{` \u2192 importa puntajes desde Gesti\u00f3n de Talento`}</li>
              <li><strong>{'3. Ajustar puntajes'}</strong>{` \u2192 modificar desempe\u00f1o, potencial y justificar`}</li>
              <li><strong>{'4. Completar'}</strong>{` \u2192 aplica ajustes a la Matriz Nine Box autom\u00e1ticamente`}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
            {`Nueva sesi\u00f3n de calibraci\u00f3n`}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
              Nombre *
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={`Ej: Calibraci\u00f3n Q1 2026`}
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
                placeholder={`Ej: Tecnolog\u00eda`}
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
              {creating ? 'Creando...' : `Crear sesi\u00f3n`}
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
          {`No hay sesiones de calibraci\u00f3n creadas a\u00fan.`}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {sessions.map((s: any) => {
            const cycleName = s.cycle?.name || cycles.find((c: any) => c.id === s.cycleId)?.name || '\u2014';
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
    </div>
  );
}
