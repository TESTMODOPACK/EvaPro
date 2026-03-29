'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { processStatusLabel, processStatusBadge, postulantEntryStatusLabel, postulantEntryStatusBadge } from '@/lib/statusMaps';

const ENTRY_STATUSES = ['applied', 'evaluating', 'approved', 'rejected', 'hired'];

export default function ProcesoDetailPage({ params }: { params: { id: string } }) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.userId);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'tenant_admin';

  const [process, setProcess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('candidatos');
  const [scorecard, setScorecard] = useState<any>(null);
  const [comparative, setComparative] = useState<any>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  // Add candidate modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPostulant, setNewPostulant] = useState({ firstName: '', lastName: '', email: '', phone: '', type: 'external' });
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [allPostulants, setAllPostulants] = useState<any[]>([]);
  const [selectedExistingId, setSelectedExistingId] = useState('');

  // Assessment
  const [assessmentScores, setAssessmentScores] = useState<Record<string, { score: number; comment: string }>>({});
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [assessmentSaved, setAssessmentSaved] = useState(false);

  async function fetchProcess() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.postulants.processes.get(token, params.id);
      setProcess(data);
    } catch { setProcess(null); }
    setLoading(false);
  }

  useEffect(() => { fetchProcess(); }, [token, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadScorecard = async (entryId: string) => {
    if (!token) return;
    setSelectedEntry(entryId);
    const data = await api.postulants.scorecard(token, entryId);
    setScorecard(data);
    // Pre-fill scores for current evaluator
    const myScores: Record<string, { score: number; comment: string }> = {};
    for (const a of data.assessments || []) {
      if (a.evaluatorId === userId) {
        myScores[a.competencyId] = { score: a.score, comment: a.comment || '' };
      }
    }
    setAssessmentScores(myScores);
    setTab('scorecard');
  };

  const loadComparative = async () => {
    if (!token) return;
    const data = await api.postulants.processes.comparative(token, params.id);
    setComparative(data);
    setTab('comparativa');
  };

  const handleAddNewCandidate = async () => {
    if (!token || !newPostulant.firstName || !newPostulant.email) return;
    setAddingCandidate(true);
    try {
      const postulant = await api.postulants.create(token, newPostulant);
      await api.postulants.processes.addPostulant(token, params.id, postulant.id);
      setShowAddModal(false);
      setNewPostulant({ firstName: '', lastName: '', email: '', phone: '', type: 'external' });
      await fetchProcess();
    } catch { /* error */ }
    setAddingCandidate(false);
  };

  const handleAddExistingCandidate = async () => {
    if (!token || !selectedExistingId) return;
    setAddingCandidate(true);
    try {
      await api.postulants.processes.addPostulant(token, params.id, selectedExistingId);
      setShowAddModal(false);
      setSelectedExistingId('');
      await fetchProcess();
    } catch { /* error */ }
    setAddingCandidate(false);
  };

  const handleStatusChange = async (entryId: string, status: string) => {
    if (!token) return;
    await api.postulants.updateEntryStatus(token, entryId, status);
    await fetchProcess();
  };

  const handleSubmitAssessment = async () => {
    if (!token || !selectedEntry) return;
    setSavingAssessment(true);
    try {
      const scores = Object.entries(assessmentScores).map(([competencyId, val]) => ({
        competencyId, score: val.score, comment: val.comment || undefined,
      }));
      await api.postulants.submitAssessment(token, { entryId: selectedEntry, scores });
      setAssessmentSaved(true);
      setTimeout(() => setAssessmentSaved(false), 3000);
      await loadScorecard(selectedEntry);
    } catch { /* error */ }
    setSavingAssessment(false);
  };

  const openAddModal = async () => {
    if (token) {
      const list = await api.postulants.list(token);
      setAllPostulants(list || []);
    }
    setShowAddModal(true);
  };

  if (loading) return <div style={{ padding: '2rem 2.5rem' }}><span className="spinner" /></div>;
  if (!process) return <div style={{ padding: '2rem 2.5rem', color: 'var(--text-muted)' }}>Proceso no encontrado</div>;

  const entries = process.entries || [];
  const evaluators = process.evaluators || [];
  const competencies = process.competencies || [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{process.title}</h1>
          <span className={`badge ${processStatusBadge[process.status]}`}>
            {processStatusLabel[process.status]}
          </span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {process.position}{process.department ? ` — ${process.department}` : ''} &middot; {evaluators.length} evaluadores &middot; {entries.length} candidatos
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {['candidatos', 'scorecard', 'comparativa', 'configuracion'].map((t) => (
          <button
            key={t}
            onClick={() => {
              if (t === 'comparativa') loadComparative();
              else setTab(t);
            }}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px', textTransform: 'capitalize',
            }}
          >
            {t === 'configuracion' ? 'Configuración' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ─── Tab: Candidatos ──────────────────────────────────────────── */}
      {tab === 'candidatos' && (
        <div>
          {isAdmin && (
            <button className="btn-primary" onClick={openAddModal}
              style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              + Agregar Candidato
            </button>
          )}
          {entries.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No hay candidatos en este proceso
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {entries.map((entry: any) => (
                <div key={entry.id} className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {entry.postulant?.firstName} {entry.postulant?.lastName}
                      {entry.postulant?.type === 'internal' && (
                        <span style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.15rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem', fontWeight: 700 }}>INTERNO</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{entry.postulant?.email}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {entry.finalScore != null && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{Number(entry.finalScore).toFixed(1)}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Puntaje</div>
                      </div>
                    )}
                    {isAdmin ? (
                      <select className="input" value={entry.status}
                        onChange={(e) => handleStatusChange(entry.id, e.target.value)}
                        style={{ fontSize: '0.8rem', width: 'auto', padding: '0.3rem 0.5rem' }}>
                        {ENTRY_STATUSES.map((s) => (
                          <option key={s} value={s}>{postulantEntryStatusLabel[s]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${postulantEntryStatusBadge[entry.status]}`}>
                        {postulantEntryStatusLabel[entry.status]}
                      </span>
                    )}
                    <button className="btn-primary" onClick={() => loadScorecard(entry.id)}
                      style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}>
                      Scorecard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Scorecard ───────────────────────────────────────────── */}
      {tab === 'scorecard' && scorecard && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              Scorecard: {scorecard.entry?.postulant?.firstName} {scorecard.entry?.postulant?.lastName}
            </h2>
            {scorecard.talentData && (
              <div className="card" style={{ padding: '0.5rem 1rem', display: 'flex', gap: '1rem', fontSize: '0.82rem' }}>
                <span>Desempeño: <strong>{Number(scorecard.talentData.performanceScore).toFixed(1)}</strong></span>
                <span>Potencial: <strong>{scorecard.talentData.potentialScore != null ? Number(scorecard.talentData.potentialScore).toFixed(1) : '—'}</strong></span>
                <span>9-Box: <strong>{scorecard.talentData.nineBoxPosition || '—'}</strong></span>
                <span>Pool: <strong>{scorecard.talentData.talentPool || '—'}</strong></span>
              </div>
            )}
          </div>

          {/* Competency scores table */}
          <div className="card" style={{ overflow: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Competencia</th>
                  <th>Nivel Esperado</th>
                  <th>Mi Evaluación</th>
                  <th>Comentario</th>
                  {evaluators.filter((ev: any) => ev.evaluatorId !== userId).map((ev: any) => (
                    <th key={ev.evaluatorId}>{ev.evaluator?.firstName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competencies.map((rc: any) => {
                  const comp = rc.competency || rc;
                  const compId = rc.competencyId || comp.id;
                  const myScore = assessmentScores[compId];
                  return (
                    <tr key={compId}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{comp.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{comp.category}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{rc.expectedLevel}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          className="input" type="number" min={1} max={10}
                          value={myScore?.score || ''}
                          onChange={(e) => setAssessmentScores((prev) => ({
                            ...prev,
                            [compId]: { ...prev[compId], score: +e.target.value, comment: prev[compId]?.comment || '' },
                          }))}
                          style={{ width: '60px', textAlign: 'center', fontSize: '0.9rem' }}
                        />
                      </td>
                      <td>
                        <input
                          className="input" type="text"
                          value={myScore?.comment || ''}
                          onChange={(e) => setAssessmentScores((prev) => ({
                            ...prev,
                            [compId]: { ...prev[compId], score: prev[compId]?.score || 0, comment: e.target.value },
                          }))}
                          placeholder="Comentario..."
                          style={{ fontSize: '0.82rem', minWidth: '150px' }}
                        />
                      </td>
                      {evaluators.filter((ev: any) => ev.evaluatorId !== userId).map((ev: any) => {
                        const otherScore = (scorecard.assessments || []).find(
                          (a: any) => a.competencyId === compId && a.evaluatorId === ev.evaluatorId,
                        );
                        return (
                          <td key={ev.evaluatorId} style={{ textAlign: 'center', fontWeight: 600, color: otherScore ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {otherScore ? otherScore.score : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="btn-primary" onClick={handleSubmitAssessment} disabled={savingAssessment}
              style={{ opacity: savingAssessment ? 0.6 : 1 }}>
              {savingAssessment ? 'Guardando...' : 'Guardar Evaluación'}
            </button>
            {assessmentSaved && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.85rem' }}>&#10003; Guardado</span>}
          </div>
        </div>
      )}
      {tab === 'scorecard' && !scorecard && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Selecciona un candidato desde la pestaña Candidatos para ver su scorecard
        </div>
      )}

      {/* ─── Tab: Comparativa ─────────────────────────────────────────── */}
      {tab === 'comparativa' && comparative && (
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>Vista Comparativa</h2>
          <div className="card" style={{ overflow: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Competencia</th>
                  <th>Esperado</th>
                  {comparative.candidates?.map((c: any) => (
                    <th key={c.entry.id}>
                      {c.entry.postulant?.firstName} {c.entry.postulant?.lastName}
                      {c.entry.postulant?.type === 'internal' && (
                        <div style={{ fontSize: '0.68rem', color: '#6366f1', fontWeight: 700 }}>INTERNO</div>
                      )}
                      {c.talentData && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          9-Box: {c.talentData.nineBoxPosition || '—'}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(comparative.competencies || []).map((rc: any) => {
                  const comp = rc.competency || rc;
                  const compId = rc.competencyId || comp.id;
                  return (
                    <tr key={compId}>
                      <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>{comp.name}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{rc.expectedLevel}</td>
                      {comparative.candidates?.map((c: any) => {
                        const sc = (c.scores || []).find((s: any) => s.competencyId === compId);
                        const avg = sc ? parseFloat(sc.avgScore) : null;
                        const gap = avg !== null ? avg - rc.expectedLevel : null;
                        return (
                          <td key={c.entry.id} style={{
                            textAlign: 'center', fontWeight: 700,
                            color: avg === null ? 'var(--text-muted)' : gap !== null && gap >= 0 ? 'var(--success)' : 'var(--danger)',
                          }}>
                            {avg !== null ? avg.toFixed(1) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* Final score row */}
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td>Puntaje Final</td>
                  <td></td>
                  {comparative.candidates?.map((c: any) => (
                    <td key={c.entry.id} style={{ textAlign: 'center', fontSize: '1.1rem' }}>
                      {c.entry.finalScore != null ? Number(c.entry.finalScore).toFixed(1) : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Tab: Configuración ───────────────────────────────────────── */}
      {tab === 'configuracion' && isAdmin && (
        <div>
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Estado del Proceso</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {['draft', 'in_progress', 'completed', 'closed'].map((s) => (
                <button
                  key={s}
                  className={process.status === s ? 'btn-primary' : ''}
                  onClick={async () => {
                    if (!token) return;
                    await api.postulants.processes.update(token, params.id, { status: s });
                    await fetchProcess();
                  }}
                  style={{
                    padding: '0.4rem 1rem', fontSize: '0.82rem', borderRadius: '6px',
                    border: process.status === s ? 'none' : '1px solid var(--border)',
                    background: process.status === s ? undefined : 'transparent',
                    cursor: 'pointer',
                    color: process.status === s ? undefined : 'var(--text-secondary)',
                  }}
                >
                  {processStatusLabel[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Evaluadores Asignados</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {evaluators.map((ev: any) => (
                <span key={ev.id} className="badge badge-accent" style={{ fontSize: '0.82rem' }}>
                  {ev.evaluator?.firstName} {ev.evaluator?.lastName}
                </span>
              ))}
              {evaluators.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin evaluadores asignados</p>}
            </div>
          </div>
        </div>
      )}
      {tab === 'configuracion' && !isAdmin && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Solo el administrador puede modificar la configuración del proceso
        </div>
      )}

      {/* ─── Add Candidate Modal ──────────────────────────────────────── */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
        }} onClick={() => setShowAddModal(false)}>
          <div className="card" style={{ padding: '1.75rem', width: '500px', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>Agregar Candidato</h2>

            {/* Existing postulants */}
            {allPostulants.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
                  Postulante existente
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select className="input" value={selectedExistingId} onChange={(e) => setSelectedExistingId(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Seleccionar...</option>
                    {allPostulants.map((p) => (
                      <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.email})</option>
                    ))}
                  </select>
                  <button className="btn-primary" onClick={handleAddExistingCandidate}
                    disabled={!selectedExistingId || addingCandidate} style={{ fontSize: '0.82rem' }}>
                    Agregar
                  </button>
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.75rem' }}>
                Nuevo candidato externo
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <input className="input" placeholder="Nombre *" value={newPostulant.firstName}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, firstName: e.target.value }))} />
                <input className="input" placeholder="Apellido" value={newPostulant.lastName}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <input className="input" type="email" placeholder="Email *" value={newPostulant.email}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, email: e.target.value }))} />
                <input className="input" placeholder="Teléfono" value={newPostulant.phone}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <button className="btn-primary" onClick={handleAddNewCandidate}
                disabled={!newPostulant.firstName || !newPostulant.email || addingCandidate}
                style={{ fontSize: '0.85rem', opacity: !newPostulant.firstName || !newPostulant.email ? 0.5 : 1 }}>
                {addingCandidate ? 'Agregando...' : 'Crear y Agregar'}
              </button>
            </div>

            <div style={{ textAlign: 'right', marginTop: '1rem' }}>
              <button onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
