'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { calibrationEntryStatusLabel as STATUS_LABEL, calibrationEntryStatusBadge as STATUS_BADGE } from '@/lib/statusMaps';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function CalibracionDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = React.use(props.params);
  const token = useAuthStore((s) => s.token);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [populating, setPopulating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [editState, setEditState] = useState<Record<string, { adjustedScore: number | ''; adjustedPotential: number | ''; rationale: string }>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);

  async function fetchSession() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.talent.calibration.detail(token, params.id);
      setSession(data);
      const es: typeof editState = {};
      if (data.entries) {
        for (const entry of data.entries) {
          es[entry.id] = {
            adjustedScore: entry.adjustedScore ?? entry.originalScore ?? '',
            adjustedPotential: entry.adjustedPotential ?? entry.originalPotential ?? '',
            rationale: entry.rationale ?? '',
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
      setSuccessMsg(`Sesi\u00f3n de calibraci\u00f3n completada exitosamente. Los ajustes se aplicaron a la Matriz Nine Box.`);
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
          {`No se encontr\u00f3 la sesi\u00f3n de calibraci\u00f3n.`}
        </div>
      </div>
    );
  }

  const entries = session.entries || [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
    <div className="animate-fade-up">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>{session.name}</h1>
          <span className={`badge ${STATUS_BADGE[session.status] || 'badge-accent'}`}>
            {STATUS_LABEL[session.status] || session.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '.5rem', fontSize: '.875rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          {session.department && <span>Departamento: <strong>{session.department}</strong></span>}
          {session.moderator && <span>Moderador: <strong>{session.moderator.firstName} {session.moderator.lastName}</strong></span>}
          {session.cycle && <span>Ciclo: <strong>{session.cycle.name}</strong></span>}
        </div>
      </div>

      {/* Info card */}
      <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {`Ajusta los puntajes de desempe\u00f1o y potencial de cada colaborador. Al completar la sesi\u00f3n, los puntajes ajustados se aplicar\u00e1n autom\u00e1ticamente a la Matriz Nine Box y se recalcular\u00e1 la clasificaci\u00f3n de talento.`}
        </p>
      </div>

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
            {`No hay participantes cargados en esta sesi\u00f3n.`}
          </p>
          <button className="btn-primary" onClick={handlePopulate} disabled={populating}>
            {populating ? 'Cargando participantes...' : 'Cargar participantes'}
          </button>
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
                <th>{`Desempe\u00f1o Original`}</th>
                <th>{`Desempe\u00f1o Ajustado`}</th>
                <th>Potencial Original</th>
                <th>Potencial Ajustado</th>
                <th>{`Justificaci\u00f3n`}</th>
                <th>Estado</th>
                <th>{`Acci\u00f3n`}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => {
                const u = entry.user || {};
                const es = editState[entry.id] || { adjustedScore: '', adjustedPotential: '', rationale: '' };
                const isSaving = savingEntry === entry.id;
                return (
                  <tr key={entry.id}>
                    <td style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</td>
                    <td>{u.department || '\u2014'}</td>
                    <td>{entry.originalScore ?? '\u2014'}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={es.adjustedScore}
                        onChange={(e) => updateEntry(entry.id, 'adjustedScore', e.target.value === '' ? '' : +e.target.value)}
                        style={{
                          width: '70px', padding: '.3rem .5rem', borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)', background: 'var(--bg-surface)',
                          color: 'var(--text-primary)', fontSize: '.85rem',
                        }}
                      />
                    </td>
                    <td>{entry.originalPotential ?? '\u2014'}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={es.adjustedPotential}
                        onChange={(e) => updateEntry(entry.id, 'adjustedPotential', e.target.value === '' ? '' : +e.target.value)}
                        style={{
                          width: '70px', padding: '.3rem .5rem', borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)', background: 'var(--bg-surface)',
                          color: 'var(--text-primary)', fontSize: '.85rem',
                        }}
                      />
                    </td>
                    <td>
                      <textarea
                        value={es.rationale}
                        onChange={(e) => updateEntry(entry.id, 'rationale', e.target.value)}
                        rows={1}
                        placeholder={`Justificaci\u00f3n del ajuste...`}
                        style={{
                          width: '100%', minWidth: '150px', padding: '.3rem .5rem', borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)', background: 'var(--bg-surface)',
                          color: 'var(--text-primary)', fontSize: '.85rem', resize: 'vertical',
                        }}
                      />
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[entry.status] || 'badge-accent'}`}>
                        {STATUS_LABEL[entry.status] || entry.status || 'Pendiente'}
                      </span>
                    </td>
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
            {completing ? 'Completando...' : `Completar calibraci\u00f3n`}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
