'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { processStatusLabel, processStatusBadge, postulantEntryStatusLabel, postulantEntryStatusBadge } from '@/lib/statusMaps';

const ENTRY_STATUSES = ['applied', 'evaluating', 'approved', 'rejected', 'hired'];

export default function ProcesoDetailPage({ params }: { params: { id: string } }) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.userId);
  const role = useAuthStore((s) => s.user?.role);
  const toast = useToastStore((s) => s.toast);
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

  // CV Analysis
  const [showCvPanel, setShowCvPanel] = useState(false);
  const [selectedPostulantForCv, setSelectedPostulantForCv] = useState<any>(null);

  // Assessment
  const [assessmentScores, setAssessmentScores] = useState<Record<string, { score: number; comment: string }>>({});
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [assessmentSaved, setAssessmentSaved] = useState(false);

  // Internal profile
  const [internalProfiles, setInternalProfiles] = useState<Record<string, any>>({});

  // Config tab edit form
  const [configEditing, setConfigEditing] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configForm, setConfigForm] = useState({ title: '', position: '', department: '', description: '', startDate: '', endDate: '' });

  async function fetchProcess() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.postulants.processes.get(token, params.id);
      setProcess(data);
    } catch (_) { setProcess(null); }
    setLoading(false);
  }

  useEffect(() => { fetchProcess(); }, [token, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load internal profiles when process is loaded and is internal type
  useEffect(() => {
    if (!token || !process || process.processType !== 'internal') return;
    const internalEntries = (process.entries || []).filter((e: any) => e.postulant?.type === 'internal' && e.postulant?.userId);
    for (const entry of internalEntries) {
      if (internalProfiles[entry.postulant.userId]) continue;
      api.postulants.getInternalProfile(token, params.id, entry.postulant.userId)
        .then((profile) => setInternalProfiles((prev) => ({ ...prev, [entry.postulant.userId]: profile })))
        .catch(() => {});
    }
  }, [token, process?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validatePhone = (phone: string) => !phone || /^[+\d\s()-]{7,20}$/.test(phone);

  const handleAddNewCandidate = async () => {
    if (!token || !newPostulant.firstName.trim() || !newPostulant.lastName.trim()) return;
    if (!validateEmail(newPostulant.email)) {
      toast('Ingrese un email valido', 'error');
      return;
    }
    if (newPostulant.phone && !validatePhone(newPostulant.phone)) {
      toast('Ingrese un telefono valido (min 7 caracteres, solo numeros, +, -, espacios)', 'error');
      return;
    }
    setAddingCandidate(true);
    try {
      const postulant = await api.postulants.create(token, newPostulant);
      await api.postulants.processes.addPostulant(token, params.id, postulant.id);
      setShowAddModal(false);
      setNewPostulant({ firstName: '', lastName: '', email: '', phone: '', type: 'external' });
      await fetchProcess();
    } catch (e: any) {
      toast(e.message || 'Error al agregar candidato', 'error');
    }
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
    } catch (_) { /* error */ }
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
    } catch (_) { /* error */ }
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

  const openConfigEdit = () => {
    setConfigForm({
      title: process.title || '',
      position: process.position || '',
      department: process.department || '',
      description: process.description || '',
      startDate: process.startDate ? process.startDate.slice(0, 10) : '',
      endDate: process.endDate ? process.endDate.slice(0, 10) : '',
    });
    setConfigEditing(true);
  };

  const handleSaveConfig = async () => {
    if (!token) return;
    setConfigSaving(true);
    try {
      await api.postulants.processes.update(token, params.id, {
        ...configForm,
        startDate: configForm.startDate || undefined,
        endDate: configForm.endDate || undefined,
      });
      setConfigSaved(true);
      setConfigEditing(false);
      setTimeout(() => setConfigSaved(false), 3000);
      await fetchProcess();
    } catch (_) { /* ignore */ }
    setConfigSaving(false);
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{process.title}</h1>
          <span className={`badge ${processStatusBadge[process.status]}`}>
            {processStatusLabel[process.status]}
          </span>
          <span className="badge" style={{ fontSize: '0.65rem', background: process.processType === 'internal' ? 'rgba(99,102,241,0.1)' : 'rgba(201,147,58,0.1)', color: process.processType === 'internal' ? '#6366f1' : 'var(--accent)', border: `1px solid ${process.processType === 'internal' ? 'rgba(99,102,241,0.3)' : 'rgba(201,147,58,0.3)'}` }}>
            {process.processType === 'internal' ? 'Proceso Interno' : 'Proceso Externo'}
          </span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {process.position}{process.department ? ` — ${process.department}` : ''} &middot; {evaluators.length} evaluadores &middot; {entries.length} candidatos
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'candidatos', label: 'Candidatos' },
          { key: 'scorecard', label: 'Evaluacion' },
          { key: 'comparativa', label: 'Comparativa' },
          { key: 'configuracion', label: 'Configuracion' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => {
              if (t.key === 'comparativa') loadComparative();
              else setTab(t.key);
            }}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}
          >
            {t.label}
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>
                      {entry.postulant?.firstName} {entry.postulant?.lastName}
                      {entry.postulant?.type === 'internal' && (
                        <span style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.15rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem', fontWeight: 700 }}>INTERNO</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{entry.postulant?.email}</div>
                    {/* Internal candidate inline data */}
                    {entry.postulant?.type === 'internal' && entry.postulant?.userId && internalProfiles[entry.postulant.userId] && (() => {
                      const p = internalProfiles[entry.postulant.userId];
                      return (
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {p.avgScore && <span>Prom. Eval: <strong style={{ color: '#6366f1' }}>{p.avgScore}/5</strong></span>}
                          {p.talentData?.nineBoxPosition && <span>9-Box: <strong style={{ color: '#6366f1' }}>{p.talentData.nineBoxPosition}</strong></span>}
                          {p.user?.department && <span>Depto: <strong>{p.user.department}</strong></span>}
                          {p.user?.tenureMonths != null && <span>Antiguedad: <strong>{p.user.tenureMonths >= 12 ? `${Math.floor(p.user.tenureMonths / 12)}a ${p.user.tenureMonths % 12}m` : `${p.user.tenureMonths}m`}</strong></span>}
                          {p.objectives && <span>Obj: <strong style={{ color: 'var(--success)' }}>{p.objectives.completed}/{p.objectives.total}</strong></span>}
                        </div>
                      );
                    })()}
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
                      Evaluar
                    </button>
                    {entry.postulant?.type === 'external' && isAdmin && (
                      <button className="btn-ghost" onClick={() => { setSelectedPostulantForCv(entry.postulant); setShowCvPanel(true); }}
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}>
                        {entry.postulant?.cvAnalysis ? '📋 Perfil IA' : '📄 CV'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CV Analysis Panel */}
          {showCvPanel && selectedPostulantForCv && (
            <CvAnalysisPanel
              postulant={selectedPostulantForCv}
              token={token!}
              onClose={() => { setShowCvPanel(false); setSelectedPostulantForCv(null); }}
              onUpdate={() => fetchProcess()}
            />
          )}
        </div>
      )}

      {/* ─── Tab: Tarjeta de Evaluacion ─────────────────────────────── */}
      {tab === 'scorecard' && scorecard && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              Tarjeta de Evaluacion: {scorecard.entry?.postulant?.firstName} {scorecard.entry?.postulant?.lastName}
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

          {/* Internal candidate historical profile */}
          {scorecard.entry?.postulant?.type === 'internal' && scorecard.entry?.postulant?.userId && internalProfiles[scorecard.entry.postulant.userId] && (() => {
            const p = internalProfiles[scorecard.entry.postulant.userId];
            return (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid #6366f1' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#6366f1', margin: '0 0 0.75rem' }}>Perfil Interno del Candidato</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cargo Actual</div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.user?.position || '—'}</div>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Departamento</div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.user?.department || '—'}</div>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Antiguedad</div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.user?.tenureMonths >= 12 ? `${Math.floor(p.user.tenureMonths / 12)} anos ${p.user.tenureMonths % 12} meses` : `${p.user?.tenureMonths || 0} meses`}</div>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prom. Evaluaciones</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#6366f1' }}>{p.avgScore ? `${p.avgScore}/5` : '—'}</div>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Objetivos</div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.objectives?.completed || 0}/{p.objectives?.total || 0} completados</div>
                  </div>
                </div>
                {/* Evaluation history */}
                {p.evaluationHistory?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Historial de Evaluaciones</div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {(p.evaluationHistory || []).slice(0, 6).map((ev: any, i: number) => (
                        <div key={i} style={{ padding: '0.35rem 0.6rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>
                          <strong>{ev.cycleName}</strong>: {ev.score.toFixed(1)}/5
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Competency scores table */}
          {competencies.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: '0.5rem' }}>No hay competencias configuradas para el cargo &quot;{process.position}&quot;</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Configure las competencias en Desarrollo &rarr; Competencias por Cargo para poder evaluar candidatos.</p>
            </div>
          ) : (
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%' }}>
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
              {savingAssessment ? 'Guardando...' : 'Guardar Evaluacion'}
            </button>
            {assessmentSaved && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.85rem' }}>&#10003; Guardado</span>}
          </div>
          )}

          {/* Requirements Check Section */}
          {(process.requirements || []).length > 0 && (
            <RequirementsCheckSection
              requirements={process.requirements}
              entryId={selectedEntry!}
              token={token!}
              processId={process.id}
            />
          )}
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
                {/* Internal data rows (only for internal processes) */}
                {process.processType === 'internal' && (
                  <>
                    <tr style={{ borderTop: '1px solid var(--border)', background: 'rgba(99,102,241,0.03)' }}>
                      <td style={{ fontSize: '0.82rem', color: '#6366f1', fontWeight: 600 }}>Prom. Evaluaciones</td>
                      <td></td>
                      {comparative.candidates?.map((c: any) => {
                        const profile = c.entry.postulant?.userId ? internalProfiles[c.entry.postulant.userId] : null;
                        return (
                          <td key={c.entry.id} style={{ textAlign: 'center', fontWeight: 600, color: '#6366f1' }}>
                            {profile?.avgScore ? `${profile.avgScore}/5` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr style={{ background: 'rgba(99,102,241,0.03)' }}>
                      <td style={{ fontSize: '0.82rem', color: '#6366f1', fontWeight: 600 }}>Antiguedad</td>
                      <td></td>
                      {comparative.candidates?.map((c: any) => {
                        const profile = c.entry.postulant?.userId ? internalProfiles[c.entry.postulant.userId] : null;
                        const m = profile?.user?.tenureMonths;
                        return (
                          <td key={c.entry.id} style={{ textAlign: 'center', fontSize: '0.82rem' }}>
                            {m != null ? (m >= 12 ? `${Math.floor(m / 12)}a ${m % 12}m` : `${m}m`) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr style={{ background: 'rgba(99,102,241,0.03)' }}>
                      <td style={{ fontSize: '0.82rem', color: '#6366f1', fontWeight: 600 }}>Objetivos Completados</td>
                      <td></td>
                      {comparative.candidates?.map((c: any) => {
                        const profile = c.entry.postulant?.userId ? internalProfiles[c.entry.postulant.userId] : null;
                        return (
                          <td key={c.entry.id} style={{ textAlign: 'center', fontSize: '0.82rem' }}>
                            {profile?.objectives ? `${profile.objectives.completed}/${profile.objectives.total}` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
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
      {tab === 'configuracion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* ── Información del Proceso ── */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Información del Proceso</h2>
              {isAdmin && !configEditing && (
                <button className="btn-ghost" onClick={openConfigEdit} style={{ fontSize: '0.82rem' }}>
                  ✏️ Editar
                </button>
              )}
            </div>

            {!configEditing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem', fontSize: '0.875rem' }}>
                {[
                  { label: 'Título', value: process.title },
                  { label: 'Cargo', value: process.position },
                  { label: 'Departamento', value: process.department || '—' },
                  { label: 'Inicio', value: process.startDate ? new Date(process.startDate).toLocaleDateString('es-CL') : '—' },
                  { label: 'Cierre', value: process.endDate ? new Date(process.endDate).toLocaleDateString('es-CL') : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
                  </div>
                ))}
                {process.description && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Descripción</div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{process.description}</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Título *</label>
                    <input className="input" value={configForm.title} onChange={(e) => setConfigForm((f) => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Cargo *</label>
                    <input className="input" value={configForm.position} onChange={(e) => setConfigForm((f) => ({ ...f, position: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Departamento</label>
                    <input className="input" value={configForm.department} onChange={(e) => setConfigForm((f) => ({ ...f, department: e.target.value }))} />
                  </div>
                  <div />
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Fecha Inicio</label>
                    <input className="input" type="date" value={configForm.startDate} onChange={(e) => setConfigForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Fecha Cierre</label>
                    <input className="input" type="date" value={configForm.endDate} onChange={(e) => setConfigForm((f) => ({ ...f, endDate: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>Descripción</label>
                  <textarea className="input" rows={3} value={configForm.description} onChange={(e) => setConfigForm((f) => ({ ...f, description: e.target.value }))} style={{ resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-primary" onClick={handleSaveConfig} disabled={configSaving || !configForm.title || !configForm.position}>
                    {configSaving ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  <button className="btn-ghost" onClick={() => setConfigEditing(false)}>Cancelar</button>
                </div>
              </div>
            )}
            {configSaved && (
              <p style={{ color: 'var(--success)', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 600 }}>✓ Proceso actualizado</p>
            )}
          </div>

          {/* ── Estado del Proceso ── */}
          {isAdmin && (
            <div className="card" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Estado del Proceso</h2>
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
          )}

          {/* ── Evaluadores ── */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Evaluadores Asignados
              <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({evaluators.length})</span>
            </h2>
            {evaluators.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin evaluadores asignados. Los evaluadores se asignan al crear el proceso.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {evaluators.map((ev: any) => (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(201,147,58,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.82rem', color: 'var(--accent)', flexShrink: 0 }}>
                      {(ev.evaluator?.firstName?.[0] || '?')}{ev.evaluator?.lastName?.[0] || ''}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{ev.evaluator?.firstName} {ev.evaluator?.lastName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ev.evaluator?.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Competencias del Proceso ── */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Competencias a Evaluar
              <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({competencies.length})</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Las competencias se determinan automáticamente según el cargo del proceso. Se usan en la Evaluacion de cada candidato.
            </p>
            {competencies.length === 0 ? (
              <div style={{ padding: '1rem', background: 'rgba(245,158,11,0.07)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.85rem', color: 'var(--warning)' }}>
                No hay competencias asociadas al cargo <strong>{process.position}</strong>. Configúralas en Competencias → Competencias por Rol.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {competencies.map((rc: any) => (
                  <div key={rc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', background: 'rgba(99,102,241,0.07)', borderRadius: '999px', border: '1px solid rgba(99,102,241,0.2)', fontSize: '0.8rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rc.competency?.name || rc.name}</span>
                    {rc.expectedLevel && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>— nivel {rc.expectedLevel}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

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
                <input className="input" placeholder="Nombres *" value={newPostulant.firstName}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, firstName: e.target.value }))} />
                <input className="input" placeholder="Apellidos *" value={newPostulant.lastName}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <input className="input" type="email" placeholder="Email *" value={newPostulant.email}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, email: e.target.value }))} />
                <input className="input" placeholder="Teléfono" value={newPostulant.phone}
                  onChange={(e) => setNewPostulant((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <button className="btn-primary" onClick={handleAddNewCandidate}
                disabled={!newPostulant.firstName.trim() || !newPostulant.lastName.trim() || !newPostulant.email.trim() || addingCandidate}
                style={{ fontSize: '0.85rem', opacity: !newPostulant.firstName.trim() || !newPostulant.lastName.trim() || !newPostulant.email.trim() ? 0.5 : 1 }}>
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

/* ─── CV Analysis Panel Component ──────────────────────────────── */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function CvAnalysisPanel({ postulant, token, onClose, onUpdate }: {
  postulant: any; token: string; onClose: () => void; onUpdate: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(postulant.cvAnalysis || null);
  const [cvUrl, setCvUrl] = useState<string | null>(postulant.cvUrl || null);
  const [error, setError] = useState('');

  const handleUploadCv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      // Upload file
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch(`${BASE_URL}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => ({}));
        throw new Error(errBody.message || 'Error al subir archivo');
      }
      const { url } = await uploadRes.json();

      // Save CV URL
      await api.postulants.uploadCv(token, postulant.id, url);
      setCvUrl(url);
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Error al subir CV');
    }
    // Reset file input so same file can be re-selected
    e.target.value = '';
    setUploading(false);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError('');
    try {
      const result = await api.postulants.analyzeCv(token, postulant.id);
      setAnalysis(result);
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Error al analizar CV');
    }
    setAnalyzing(false);
  };

  const fitColor = (level: string) => {
    if (level === 'alto') return 'var(--success)';
    if (level === 'medio') return 'var(--accent)';
    return 'var(--danger)';
  };

  return (
    <div className="card animate-fade-up" style={{ padding: '1.75rem', marginTop: '1rem', borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>
          Análisis de CV — {postulant.firstName} {postulant.lastName}
        </h3>
        <button className="btn-ghost" onClick={onClose} style={{ fontSize: '0.82rem' }}>Cerrar</button>
      </div>

      {/* Upload section */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <label style={{
          padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem',
          border: '1px dashed var(--border)', cursor: 'pointer', color: 'var(--text-secondary)',
        }}>
          {uploading ? 'Subiendo...' : cvUrl ? '📄 Cambiar CV' : '📄 Subir CV (PDF/Word)'}
          <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadCv} style={{ display: 'none' }} />
        </label>
        {cvUrl && (
          <>
            <a href={cvUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>
              Ver CV ↗
            </a>
            <button className="btn-primary" onClick={handleAnalyze} disabled={analyzing}
              style={{ fontSize: '0.82rem', padding: '0.4rem 1rem' }}>
              {analyzing ? 'Analizando con IA...' : analysis ? '🔄 Re-analizar' : '🤖 Analizar con IA'}
            </button>
          </>
        )}
      </div>

      {analyzing && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ marginBottom: '0.5rem' }} />
          <p style={{ fontSize: '0.82rem' }}>Analizando el CV con inteligencia artificial... Esto puede tomar 10-20 segundos.</p>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{error}</p>}

      {/* Analysis results */}
      {analysis && !analyzing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Fit level badge */}
          {analysis.nivelAjuste && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Nivel de ajuste al cargo:</span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: fitColor(analysis.nivelAjuste), textTransform: 'uppercase' }}>
                {analysis.nivelAjuste}
              </span>
            </div>
          )}

          {/* Summary */}
          {analysis.resumenProfesional && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {analysis.resumenProfesional}
            </div>
          )}

          {/* Grid: strengths, areas, competencies */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {analysis.fortalezas?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.3rem', color: 'var(--success)' }}>Fortalezas</div>
                <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {analysis.fortalezas.map((f: string, i: number) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {analysis.areasDesarrollo?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.3rem', color: 'var(--accent)' }}>Áreas de desarrollo</div>
                <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {analysis.areasDesarrollo.map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Competencies chips */}
          {analysis.competenciasClave?.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.3rem' }}>Competencias clave</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {analysis.competenciasClave.map((c: string, i: number) => (
                  <span key={i} style={{ padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.72rem', background: 'rgba(201,147,58,0.1)', color: 'var(--accent)', fontWeight: 600 }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
            {analysis.nivelEducativo && (
              <div><span style={{ color: 'var(--text-muted)' }}>Educación:</span> {analysis.nivelEducativo}</div>
            )}
            {analysis.anosExperiencia && (
              <div><span style={{ color: 'var(--text-muted)' }}>Experiencia:</span> {analysis.anosExperiencia}</div>
            )}
            {analysis.idiomasDetectados?.length > 0 && (
              <div><span style={{ color: 'var(--text-muted)' }}>Idiomas:</span> {analysis.idiomasDetectados.join(', ')}</div>
            )}
          </div>

          {/* Recommendation */}
          {analysis.recomendacion && (
            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--success)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 700, color: 'var(--success)' }}>Recomendación: </span>
              {analysis.recomendacion}
            </div>
          )}

          {analysis.observaciones && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              {analysis.observaciones}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Requirements Check Sub-component ─────────────────────────────────────

function RequirementsCheckSection({ requirements, entryId, token, processId }: {
  requirements: string[];
  entryId: string;
  token: string;
  processId: string;
}) {
  const [checks, setChecks] = useState<Record<string, { status: string; comment: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token || !entryId) return;
    api.postulants.getRequirementChecks(token, entryId).then((data) => {
      const map: Record<string, { status: string; comment: string }> = {};
      for (const r of requirements) {
        const existing = (data || []).find((c: any) => c.requirement === r);
        map[r] = existing ? { status: existing.status, comment: existing.comment || '' } : { status: 'pendiente', comment: '' };
      }
      setChecks(map);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [token, entryId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const checksList = Object.entries(checks).map(([requirement, val]) => ({
        requirement, status: val.status, comment: val.comment || undefined,
      }));
      await api.postulants.saveRequirementChecks(token, entryId, checksList);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (_) {}
    setSaving(false);
  };

  if (!loaded) return null;

  const statusColors: Record<string, string> = {
    cumple: 'var(--success)',
    parcial: 'var(--warning)',
    no_cumple: 'var(--danger)',
    pendiente: 'var(--text-muted)',
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Cumplimiento de Requisitos</h3>
      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Requisito</th>
              <th style={{ width: 150 }}>Estado</th>
              <th>Comentario</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((req) => {
              const check = checks[req] || { status: 'pendiente', comment: '' };
              return (
                <tr key={req}>
                  <td style={{ fontSize: '0.85rem' }}>{req}</td>
                  <td>
                    <select
                      className="input"
                      value={check.status}
                      onChange={(e) => setChecks((prev) => ({ ...prev, [req]: { ...prev[req], status: e.target.value } }))}
                      style={{ fontSize: '0.82rem', color: statusColors[check.status] || 'inherit', fontWeight: 600 }}
                    >
                      <option value="pendiente">Pendiente</option>
                      <option value="cumple">Cumple</option>
                      <option value="parcial">Parcial</option>
                      <option value="no_cumple">No Cumple</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="input" type="text"
                      value={check.comment}
                      onChange={(e) => setChecks((prev) => ({ ...prev, [req]: { ...prev[req], comment: e.target.value } }))}
                      placeholder="Comentario..."
                      style={{ fontSize: '0.82rem', minWidth: 150 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: '0.82rem' }}>
          {saving ? 'Guardando...' : 'Guardar Requisitos'}
        </button>
        {saved && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.85rem' }}>&#10003; Guardado</span>}
      </div>
    </div>
  );
}
