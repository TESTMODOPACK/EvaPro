'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { calibrationEntryStatusLabel as STATUS_LABEL, calibrationEntryStatusBadge as STATUS_BADGE } from '@/lib/statusMaps';

const CAUSALS = [
  'Ajuste por desempeño real observado',
  'Consideración de circunstancias excepcionales',
  'Alineación con el equipo',
  'Contexto adicional del período evaluado',
  'Inconsistencia en la autoevaluación',
  'Reconocimiento de logros no capturados',
  'Criterio del comité calibrador',
  'Otro',
];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function CalibracionDetailPage({ params }: { params: { id: string } }) {
  const token = useAuthStore((s) => s.token);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [populating, setPopulating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [editState, setEditState] = useState<Record<string, {
    adjustedScore: number | '';
    adjustedPotential: number | '';
    rationale: string;
    rationaleType: string;
  }>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);

  const presetCausals = CAUSALS.slice(0, -1); // all except 'Otro'

  async function fetchSession() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.talent.calibration.detail(token, params.id);
      setSession(data);
      const es: typeof editState = {};
      if (data.entries) {
        for (const entry of data.entries) {
          const rationaleType = presetCausals.includes(entry.rationale ?? '')
            ? (entry.rationale ?? '')
            : (entry.rationale ? 'Otro' : '');
          es[entry.id] = {
            adjustedScore: entry.adjustedScore ?? entry.originalScore ?? '',
            adjustedPotential: entry.adjustedPotential ?? entry.originalPotential ?? '',
            rationale: entry.rationale ?? '',
            rationaleType,
          };
        }
      }
      setEditState(es);
    } catch { setSession(null); }
    setLoading(false);
  }

  useEffect(() => { fetchSession(); }, [token, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePopulate() {
    if (!token) return;
    setPopulating(true);
    try {
      await api.talent.calibration.populate(token, params.id);
      await fetchSession();
    } catch { /* ignore */ }
    setPopulating(false);
  }

  async function handleSaveEntry(entryId: string) {
    if (!token) return;
    const e = editState[entryId];
    if (!e) return;
    setSavingEntry(entryId);
    try {
      await api.talent.calibration.updateEntry(token, entryId, {
        adjustedScore: e.adjustedScore === '' ? null : Number(e.adjustedScore),
        adjustedPotential: e.adjustedPotential === '' ? null : Number(e.adjustedPotential),
        rationale: e.rationale,
      });
      await fetchSession();
    } catch { /* ignore */ }
    setSavingEntry(null);
  }

  async function handleComplete() {
    if (!token) return;
    setCompleting(true);
    try {
      await api.talent.calibration.complete(token, params.id);
      await fetchSession();
      setSuccessMsg(`Sesión de calibración completada exitosamente. Los ajustes se aplicaron a la Matriz Nine Box.`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch { /* ignore */ }
    setCompleting(false);
  }

  function updateEntry(entryId: string, field: string, value: any) {
    setEditState((prev) => ({
      ...prev,
      [entryId]: { ...prev[entryId], [field]: value },
    }));
  }

  if (!token) return null;
  if (loading) return <Spinner />;
  if (!session) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
        <div className="animate-fade-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          {`No se encontró la sesión de calibración.`}
        </div>
      </div>
    );
  }

  const entries = session.entries || [];
  const isReadOnly = session.status === 'completed';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
    <div className="animate-fade-up">
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{session.name}</h1>
              <span className={`badge ${STATUS_BADGE[session.status] || 'badge-accent'}`}>
                {STATUS_LABEL[session.status] || session.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
              {session.cycle && <span>{`Ciclo: `}<strong>{session.cycle.name}</strong></span>}
              {session.department && <span>{`Departamento: `}<strong>{session.department}</strong></span>}
              {session.moderator && <span>{`Moderador: `}<strong>{session.moderator.firstName} {session.moderator.lastName}</strong></span>}
            </div>
          </div>
        </div>
      </div>

      {/* Info hint */}
      <div className="card" style={{ padding: '0.875rem 1rem', background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {`Ajusta los puntajes de desempeño y potencial de cada colaborador. Al completar la sesión, los puntajes ajustados se aplicarán automáticamente a la Matriz Nine Box y se recalculará la clasificación de talento.`}
        </p>
      </div>

      {/* Read-only notice */}
      {isReadOnly && (
        <div className="card" style={{ padding: '0.875rem 1rem', background: 'rgba(245,158,11,0.08)', borderLeft: '4px solid var(--warning)', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            🔒 Esta sesión está completada y es de solo lectura. No se pueden realizar más ajustes.
          </p>
        </div>
      )}

      {/* Success message */}
      {successMsg && (
        <div className="card animate-fade-up" style={{ background: 'var(--success)', color: '#fff', marginBottom: '1rem', padding: '.75rem 1rem', fontWeight: 600 }}>
          {successMsg}
        </div>
      )}

      {/* Empty state: populate */}
      {entries.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {`No hay participantes cargados en esta sesión.`}
          </p>
          {!isReadOnly && (
            <button className="btn-primary" onClick={handlePopulate} disabled={populating}>
              {populating ? 'Cargando participantes...' : 'Cargar participantes'}
            </button>
          )}
        </div>
      )}

      {/* Entries table */}
      {entries.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Departamento</th>
                <th>{`Desempeño Original`}</th>
                <th>{`Desempeño Ajustado`}</th>
                <th>Potencial Original</th>
                <th>Potencial Ajustado</th>
                <th>{`Causal del ajuste`}</th>
                <th>Estado</th>
                {!isReadOnly && <th>{`Acción`}</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => {
                const u = entry.user || {};
                const es = editState[entry.id] || { adjustedScore: '', adjustedPotential: '', rationale: '', rationaleType: '' };
                const isSaving = savingEntry === entry.id;
                return (
                  <tr key={entry.id}>
                    <td style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</td>
                    <td>{u.department || '—'}</td>
                    <td>{entry.originalScore ?? '—'}</td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={es.adjustedScore}
                        disabled={isReadOnly}
                        onChange={(e) => updateEntry(entry.id, 'adjustedScore', e.target.value === '' ? '' : +e.target.value)}
                        style={{ width: '70px', fontSize: '0.85rem', cursor: isReadOnly ? 'not-allowed' : undefined, opacity: isReadOnly ? 0.7 : 1 }}
                      />
                    </td>
                    <td>{entry.originalPotential ?? '—'}</td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={es.adjustedPotential}
                        disabled={isReadOnly}
                        onChange={(e) => updateEntry(entry.id, 'adjustedPotential', e.target.value === '' ? '' : +e.target.value)}
                        style={{ width: '70px', fontSize: '0.85rem', cursor: isReadOnly ? 'not-allowed' : undefined, opacity: isReadOnly ? 0.7 : 1 }}
                      />
                    </td>
                    <td>
                      <div style={{ minWidth: '180px' }}>
                        <select
                          className="input"
                          value={es.rationaleType}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditState((prev) => ({
                              ...prev,
                              [entry.id]: {
                                ...prev[entry.id],
                                rationaleType: v,
                                rationale: v !== 'Otro' ? v : prev[entry.id].rationale,
                              },
                            }));
                          }}
                          style={{ width: '100%', fontSize: '0.85rem', cursor: isReadOnly ? 'not-allowed' : undefined, opacity: isReadOnly ? 0.7 : 1 }}
                        >
                          <option value="">Seleccionar causal...</option>
                          {CAUSALS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        {es.rationaleType === 'Otro' && (
                          <input
                            className="input"
                            type="text"
                            value={es.rationale}
                            disabled={isReadOnly}
                            onChange={(e) => updateEntry(entry.id, 'rationale', e.target.value)}
                            placeholder="Describe la causal..."
                            style={{ marginTop: '4px', width: '100%', fontSize: '0.85rem', cursor: isReadOnly ? 'not-allowed' : undefined, opacity: isReadOnly ? 0.7 : 1 }}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[entry.status] || 'badge-accent'}`}>
                        {STATUS_LABEL[entry.status] || entry.status || 'Pendiente'}
                      </span>
                    </td>
                    {!isReadOnly && (
                      <td>
                        <button
                          className="btn-primary"
                          onClick={() => handleSaveEntry(entry.id)}
                          disabled={isSaving}
                          style={{ fontSize: '.8rem', padding: '.35rem .75rem' }}
                        >
                          {isSaving ? '...' : 'Guardar'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Complete button */}
      {entries.length > 0 && session.status === 'in_progress' && (
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={handleComplete} disabled={completing}
            style={{ background: 'var(--success)', padding: '.6rem 1.5rem' }}>
            {completing ? 'Completando...' : `Completar calibración`}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
