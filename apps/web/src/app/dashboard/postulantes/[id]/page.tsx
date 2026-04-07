'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useDepartments } from '@/hooks/useDepartments';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';

const STAGES = [
  { key: 'registered', label: 'Registrado', badge: 'badge-ghost' },
  { key: 'cv_review', label: 'CV en revisión', badge: 'badge-accent' },
  { key: 'interviewing', label: 'En entrevista', badge: 'badge-warning' },
  { key: 'scored', label: 'Puntuado', badge: 'badge-info' },
  { key: 'approved', label: 'Aprobado', badge: 'badge-success' },
  { key: 'rejected', label: 'Rechazado', badge: 'badge-danger' },
  { key: 'hired', label: 'Contratado', badge: 'badge-success' },
];

const PROCESS_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', active: 'Activo', completed: 'Completado', closed: 'Cerrado',
};

const CATEGORY_LABELS: Record<string, string> = {
  experiencia: 'Experiencia',
  conocimiento_tecnico: 'Conocimiento Técnico',
  habilidades_blandas: 'Habilidades Blandas',
  formacion: 'Formación',
  idiomas: 'Idiomas',
  General: 'General',
};

function categoryLabel(key: string): string {
  // Clean brackets if present: [habilidades_blandas] -> habilidades_blandas
  const cleaned = key.replace(/^\[|\]$/g, '').trim();
  return CATEGORY_LABELS[cleaned] || cleaned.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}


/* ── Admin read-only evaluation view ──────────────────────────────── */
function AdminEvaluationView({ candidate, token, onViewScorecard }: { candidate: any; token: string | null; onViewScorecard: () => void }) {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !candidate?.id) return;
    setLoading(true);
    api.recruitment.candidates.getInterviews(token, candidate.id)
      .then((data: any) => setInterviews(Array.isArray(data) ? data : []))
      .catch(() => setInterviews([]))
      .finally(() => setLoading(false));
  }, [token, candidate?.id]);

  const candidateName = candidate.firstName || candidate.user?.firstName || '';
  const candidateLastName = candidate.lastName || candidate.user?.lastName || '';

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
        Evaluaciones: {candidateName} {candidateLastName}
      </h2>

      {loading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando evaluaciones...</div>
      ) : interviews.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Este candidato aun no tiene evaluaciones de entrevista.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {interviews.map((iv: any) => {
            const checks = iv.requirementChecks || [];
            const answered = checks.filter((c: any) => c.status !== 'pendiente');
            const cumple = checks.filter((c: any) => c.status === 'cumple').length;
            const parcial = checks.filter((c: any) => c.status === 'parcial').length;
            const noCumple = checks.filter((c: any) => c.status === 'no_cumple').length;
            return (
              <div key={iv.id} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                      {iv.evaluator?.firstName} {iv.evaluator?.lastName}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      {iv.evaluator?.position || ''}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.3rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontWeight: 800, fontSize: '1.2rem', color: Number(iv.globalScore) >= 7 ? 'var(--success)' : Number(iv.globalScore) >= 4 ? 'var(--accent)' : 'var(--danger)' }}>
                      {iv.globalScore != null ? Number(iv.globalScore).toFixed(1) : '--'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>/10</span>
                  </div>
                </div>

                {/* Requirement summary */}
                {answered.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                    {cumple > 0 && <span style={{ color: 'var(--success)', fontWeight: 600 }}>Cumple: {cumple}</span>}
                    {parcial > 0 && <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>Parcial: {parcial}</span>}
                    {noCumple > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>No cumple: {noCumple}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>({answered.length}/{checks.length} evaluados)</span>
                  </div>
                )}

                {/* Requirement details */}
                {checks.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Requisito</th>
                          <th style={{ width: 110, padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Estado</th>
                          <th style={{ padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>Comentario</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks.map((rc: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              <span style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: 600 }}>{categoryLabel(rc.category)}</span>
                              <br />{rc.text}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', fontWeight: 600, fontSize: '0.78rem',
                              color: rc.status === 'cumple' ? 'var(--success)' : rc.status === 'no_cumple' ? 'var(--danger)' : rc.status === 'parcial' ? 'var(--warning, #f59e0b)' : 'var(--text-muted)',
                            }}>
                              {rc.status === 'cumple' ? 'Cumple' : rc.status === 'parcial' ? 'Parcial' : rc.status === 'no_cumple' ? 'No cumple' : 'Pendiente'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{rc.comment || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {iv.comments && (
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Comentarios:</strong> {iv.comments}
                  </div>
                )}

                {iv.createdAt && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    Evaluado el {new Date(iv.createdAt).toLocaleDateString('es-CL')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={onViewScorecard}>
          Ver Tarjeta de Puntuacion Completa
        </button>
      </div>
    </div>
  );
}

export default function ProcesoDetailPage({ params }: { params: { id: string } }) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.userId);
  const role = useAuthStore((s) => s.user?.role);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const { isBlocked: aiBlocked } = useAiQuota();

  const [process, setProcess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('candidatos');

  // Candidate forms
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [extForm, setExtForm] = useState({ firstName: '', lastName: '', email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '' });
  const [extErrors, setExtErrors] = useState<Record<string, string>>({});
  const [internalSearch, setInternalSearch] = useState('');
  const [internalUsers, setInternalUsers] = useState<any[]>([]);
  const [internalDeptFilter, setInternalDeptFilter] = useState('');
  const [internalPosFilter, setInternalPosFilter] = useState('');
  const { departments } = useDepartments();

  // Interview
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [interviewForm, setInterviewForm] = useState<{ reqChecks: any[]; comments: string; globalScore: string; manualScore: string }>({ reqChecks: [], comments: '', globalScore: '', manualScore: '' });
  const [savingInterview, setSavingInterview] = useState(false);

  // Scorecard
  const [scorecard, setScorecard] = useState<any>(null);

  // Comparative
  const [comparative, setComparative] = useState<any>(null);

  // CV
  const [uploadingCv, setUploadingCv] = useState(false);
  const [analyzingCvId, setAnalyzingCvId] = useState<string | null>(null);
  const [expandedCvPanel, setExpandedCvPanel] = useState<string | null>(null);

  // Edit candidate
  const [editingCandidate, setEditingCandidate] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '', recruiterNotes: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchProcess = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.recruitment.processes.get(token, params.id);
      setProcess(data);
    } catch (e) {
      setProcess(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchProcess(); }, [token, params.id]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (!process) return <div style={{ padding: '2rem 2.5rem', color: 'var(--text-muted)' }}>Proceso no encontrado</div>;

  const candidates = process.candidates || [];
  const evaluators = process.evaluators || [];
  const requirements = process.requirements || [];
  const isInternal = process.processType === 'internal';
  const isEvaluatorOfProcess = evaluators.some((ev: any) => ev.evaluatorId === userId);
  const canManageCv = isAdmin || isEvaluatorOfProcess; // Admin + evaluadores pueden gestionar CV

  // ─── Validation helpers ─────────────────────────────────────────────
  const validateExtForm = () => {
    const errors: Record<string, string> = {};
    if (!extForm.firstName.trim() || extForm.firstName.trim().length < 2) errors.firstName = 'Nombres requerido (min 2 caracteres)';
    if (extForm.firstName.trim() && !/^[a-zA-ZaeiouAEIOUnoN\s]+$/.test(extForm.firstName.trim())) errors.firstName = 'Solo letras y espacios';
    if (!extForm.lastName.trim() || extForm.lastName.trim().length < 2) errors.lastName = 'Apellidos requerido (min 2 caracteres)';
    if (!extForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extForm.email)) errors.email = 'Email válido requerido';
    if (!extForm.phone.trim()) errors.phone = 'Teléfono requerido';
    else if (!/^\+?[\d\s()-]{7,20}$/.test(extForm.phone.trim())) errors.phone = 'Teléfono no valido';
    setExtErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ─── Add external candidate ─────────────────────────────────────────
  const handleAddExternal = async () => {
    if (!token || !validateExtForm()) return;
    setAddingCandidate(true);
    try {
      await api.recruitment.candidates.add(token, params.id, extForm);
      setExtForm({ firstName: '', lastName: '', email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '' });
      setShowAddForm(false);
      toast('Candidato agregado', 'success');
      fetchProcess();
    } catch (e: any) {
      toast(e.message || 'Error al agregar candidato', 'error');
    }
    setAddingCandidate(false);
  };

  // ─── Add internal candidate ─────────────────────────────────────────
  const handleSearchInternal = async () => {
    if (!token) return;
    if (!internalSearch.trim() && !internalDeptFilter && !internalPosFilter) return;
    try {
      const filters: any = {};
      if (internalSearch.trim()) filters.search = internalSearch;
      if (internalDeptFilter) filters.department = internalDeptFilter;
      if (internalPosFilter) filters.position = internalPosFilter;
      const res = await api.users.list(token, 1, 50, filters);
      setInternalUsers((res as any).data || res || []);
    } catch (e) {
      setInternalUsers([]);
    }
  };

  const handleAddInternal = async (uId: string) => {
    if (!token) return;
    setAddingCandidate(true);
    try {
      await api.recruitment.candidates.add(token, params.id, { userId: uId });
      toast('Colaborador agregado al proceso', 'success');
      setShowAddForm(false);
      fetchProcess();
    } catch (e: any) {
      toast(e.message || 'Error al agregar colaborador', 'error');
    }
    setAddingCandidate(false);
  };

  // ─── CV Upload (base64 directo a BD, sin Cloudinary) ─────────────────
  const handleCvUpload = async (candidateId: string, e: any) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    if (file.type !== 'application/pdf') {
      toast('Solo se permiten archivos PDF. Si tienes un documento Word, conviértelo a PDF antes de subirlo.', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('El archivo excede el limite de 5MB', 'error');
      e.target.value = '';
      return;
    }

    setUploadingCv(true);
    try {
      // Convert to base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Error al leer el archivo'));
        reader.readAsDataURL(file);
      });

      // Save base64 directly as cvUrl
      await api.recruitment.candidates.uploadCv(token, candidateId, base64);
      toast('CV subido correctamente', 'success');
      fetchProcess();
    } catch (err: any) {
      toast(err.message || 'Error al subir CV', 'error');
    } finally {
      e.target.value = '';
      setUploadingCv(false);
    }
  };

  // ─── AI CV Analysis ─────────────────────────────────────────────────
  const handleAnalyzeCv = async (candidateId: string) => {
    if (!token || analyzingCvId) return;
    setAnalyzingCvId(candidateId);
    try {
      await api.recruitment.candidates.analyzeCv(token, candidateId);
      toast('Análisis de CV completado', 'success');
      fetchProcess();
    } catch (err: any) {
      toast(err.message || 'Error al analizar CV', 'error');
    }
    setAnalyzingCvId(null);
  };

  // ─── Interview ──────────────────────────────────────────────────────
  const openInterview = (candidate: any) => {
    setSelectedCandidate(candidate);
    const reqChecks = requirements.map((r: any) => ({
      category: r.category, text: r.text, status: 'pendiente', comment: '',
      weight: r.weight || undefined,
    }));
    setInterviewForm({ reqChecks, comments: '', globalScore: '', manualScore: '' });
    // Load existing interview
    if (token) {
      api.recruitment.candidates.getInterviews(token, candidate.id).then((interviews) => {
        const mine = (interviews || []).find((i: any) => i.evaluatorId === userId);
        if (mine) {
          setInterviewForm({
            reqChecks: mine.requirementChecks?.length > 0 ? mine.requirementChecks : reqChecks,
            comments: mine.comments || '',
            globalScore: mine.globalScore != null ? String(mine.globalScore) : '',
            manualScore: mine.manualScore != null ? String(mine.manualScore) : '',
          });
        }
      }).catch(() => {});
    }
    setTab('evaluacion');
  };

  const handleSaveInterview = async () => {
    if (!token || !selectedCandidate) return;
    setSavingInterview(true);
    try {
      await api.recruitment.candidates.submitInterview(token, selectedCandidate.id, {
        requirementChecks: interviewForm.reqChecks,
        comments: interviewForm.comments,
        globalScore: interviewForm.globalScore ? Number(interviewForm.globalScore) : null,
        manualScore: interviewForm.manualScore ? Number(interviewForm.manualScore) : null,
      });
      toast('Evaluación guardada', 'success');
      fetchProcess();
    } catch (e: any) {
      toast(e.message || 'Error al guardar evaluacion', 'error');
    }
    setSavingInterview(false);
  };

  // ─── Scorecard ──────────────────────────────────────────────────────
  const loadScorecard = async (candidateId: string) => {
    if (!token) return;
    try {
      const data = await api.recruitment.candidates.scorecard(token, candidateId);
      setScorecard(data);
      setTab('scorecard');
    } catch (e: any) {
      toast(e.message || 'Error al cargar puntuación', 'error');
    }
  };

  // ─── Comparative ────────────────────────────────────────────────────
  const loadComparative = async () => {
    if (!token) return;
    try {
      const data = await api.recruitment.processes.comparative(token, params.id);
      setComparative(data);
      setTab('comparativa');
    } catch (e: any) {
      toast(e.message || 'Error al cargar comparativa', 'error');
    }
  };

  // ─── Tabs config ────────────────────────────────────────────────────
  const tabs = [
    { key: 'candidatos', label: 'Candidatos' },
    { key: 'evaluacion', label: 'Evaluación' },
    { key: 'scorecard', label: 'Puntuación' },
    ...(isInternal ? [{ key: 'comparativa', label: 'Comparativa' }] : []),
    { key: 'configuracion', label: 'Configuración' },
  ];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* AI Quota */}
      <AiQuotaBar />
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <Link href="/dashboard/postulantes" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>&#8592; Procesos</Link>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{process.title}</h1>
          <span className={`badge ${STAGES.find((s) => s.key === process.status)?.badge || 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
            {STAGES.find((s) => s.key === process.status)?.label || process.status}
          </span>
          <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 700,
            background: isInternal ? 'rgba(99,102,241,0.1)' : 'rgba(201,147,58,0.1)',
            color: isInternal ? '#6366f1' : 'var(--accent)',
          }}>{isInternal ? 'Interno' : 'Externo'}</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {process.position}{process.department ? ' — ' + process.department : ''} | {evaluators.length} evaluadores | {candidates.length} candidatos
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { if (t.key === 'comparativa') loadComparative(); else setTab(t.key); }}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Candidatos ───────────────────────────────────────── */}
      {tab === 'candidatos' && (
        <div>
          {isAdmin && (
            <button className="btn-primary" style={{ marginBottom: '1rem', fontSize: '0.85rem' }} onClick={() => setShowAddForm(!showAddForm)}>
              + Agregar Candidato
            </button>
          )}

          {/* Add candidate form */}
          {showAddForm && isAdmin && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
              {!isInternal ? (
                <>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Nuevo Candidato Externo</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <input className="input" placeholder="Nombres *" value={extForm.firstName}
                        onChange={(e) => setExtForm((f) => ({ ...f, firstName: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.firstName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.firstName}</div>}
                    </div>
                    <div>
                      <input className="input" placeholder="Apellidos *" value={extForm.lastName}
                        onChange={(e) => setExtForm((f) => ({ ...f, lastName: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.lastName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.lastName}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <input className="input" type="email" placeholder="Email *" value={extForm.email}
                        onChange={(e) => setExtForm((f) => ({ ...f, email: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.email && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.email}</div>}
                    </div>
                    <div>
                      <input className="input" placeholder="Teléfono *" value={extForm.phone}
                        onChange={(e) => setExtForm((f) => ({ ...f, phone: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.phone && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.phone}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <input className="input" placeholder="LinkedIn (opcional)" value={extForm.linkedIn}
                      onChange={(e) => setExtForm((f) => ({ ...f, linkedIn: e.target.value }))} />
                    <select className="input" value={extForm.availability} onChange={(e) => setExtForm((f) => ({ ...f, availability: e.target.value }))}>
                      <option value="">Disponibilidad</option>
                      <option value="Inmediata">Inmediata</option>
                      <option value="15 dias">15 dias</option>
                      <option value="30 dias">30 dias</option>
                      <option value="60 dias">60 dias</option>
                      <option value="90 dias">90 dias</option>
                      <option value="A convenir">A convenir</option>
                    </select>
                    <input className="input" placeholder="Pretensión de renta ($)" value={extForm.salaryExpectation}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        const formatted = raw ? Number(raw).toLocaleString('es-CL') : '';
                        setExtForm((f) => ({ ...f, salaryExpectation: formatted }));
                      }} />
                  </div>
                  <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleAddExternal} disabled={addingCandidate}>
                    {addingCandidate ? 'Agregando...' : 'Agregar Candidato'}
                  </button>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Buscar Colaborador</h3>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Buscar por nombre o email..."
                      value={internalSearch} onChange={(e) => setInternalSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSearchInternal(); }} />
                    <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleSearchInternal}>Buscar</button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <select className="input" style={{ flex: 1, minWidth: '160px', fontSize: '0.82rem' }}
                      value={internalDeptFilter} onChange={(e) => setInternalDeptFilter(e.target.value)}>
                      <option value="">Todos los departamentos</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input className="input" style={{ flex: 1, minWidth: '140px', fontSize: '0.82rem' }}
                      placeholder="Filtrar por cargo..."
                      value={internalPosFilter} onChange={(e) => setInternalPosFilter(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSearchInternal(); }} />
                  </div>
                  {internalUsers.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {internalUsers.map((u: any) => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.firstName} {u.lastName}</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{u.position} — {u.department}</span>
                          </div>
                          <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            onClick={() => handleAddInternal(u.id)} disabled={addingCandidate}>
                            Agregar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Candidates list */}
          {candidates.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No hay candidatos en este proceso</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {candidates.map((c: any) => {
                const stageInfo = STAGES.find((s) => s.key === c.stage) || STAGES[0];
                const name = c.candidateType === 'internal' && c.user
                  ? c.user.firstName + ' ' + c.user.lastName
                  : (c.firstName || '') + ' ' + (c.lastName || '');
                const cvStatus = c.cvAnalysis ? 'analyzed' : c.cvUrl ? 'uploaded' : 'none';
                let matchPct: number | null = null;
                if (c.cvAnalysis) {
                  const analysis = typeof c.cvAnalysis === 'string' ? (() => { try { return JSON.parse(c.cvAnalysis); } catch (_e) { return null; } })() : c.cvAnalysis;
                  matchPct = analysis?.matchPercentage ?? null;
                }
                const hasFinalScore = c.finalScore != null && Number(c.finalScore) > 0;
                const showCv = c.candidateType === 'external' || process.requireCvForInternal;

                return (
                  <div key={c.id} className="card" style={{ padding: '1.25rem' }}>
                    {/* Header: Name + badges + score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{name}</span>
                          {c.candidateType === 'internal' && (
                            <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 700 }}>INTERNO</span>
                          )}
                          <span className={stageInfo.badge} style={{ fontSize: '0.68rem' }}>{stageInfo.label}</span>
                          {cvStatus === 'analyzed' && matchPct != null && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 10,
                              background: matchPct >= 70 ? 'rgba(16,185,129,0.1)' : matchPct >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                              color: matchPct >= 70 ? 'var(--success)' : matchPct >= 40 ? 'var(--warning)' : 'var(--danger)',
                            }}>CV {matchPct}%</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                          {c.email && <span>{c.email}</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.availability && <span>Disp: {c.availability}</span>}
                          {c.salaryExpectation && <span>Renta: ${(() => { const raw = String(c.salaryExpectation).replace(/\D/g, ''); return raw ? Number(raw).toLocaleString('es-CL') : c.salaryExpectation; })()}</span>}
                        </div>
                      </div>
                      {hasFinalScore && (
                        <div style={{ textAlign: 'center', minWidth: 55, padding: '0.3rem 0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', marginLeft: '0.75rem' }}>
                          <div style={{ fontWeight: 800, fontSize: '1.3rem', lineHeight: 1, color: Number(c.finalScore) >= 7 ? 'var(--success)' : Number(c.finalScore) >= 4 ? 'var(--accent)' : 'var(--danger)' }}>
                            {Number(c.finalScore).toFixed(1)}
                          </div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>de 10</div>
                        </div>
                      )}
                    </div>

                    {/* Actions row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {isEvaluatorOfProcess ? (
                          <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                            onClick={() => openInterview(c)}>Evaluar</button>
                        ) : isAdmin && (
                          <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                            onClick={() => { setSelectedCandidate(c); setTab('evaluacion'); }}>Ver Evaluaciones</button>
                        )}
                        <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                          onClick={() => loadScorecard(c.id)}>Tarjeta de Puntaje</button>
                        {showCv && (
                          <button className="btn-ghost" onClick={() => { setExpandedCvPanel(expandedCvPanel === c.id ? null : c.id); setEditingCandidate(null); }}
                            style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}>
                            {expandedCvPanel === c.id ? 'Cerrar CV' : (cvStatus === 'none' ? 'Subir CV' : 'Ver CV')}
                          </button>
                        )}
                        {isAdmin && (
                          <button className="btn-ghost" onClick={() => {
                            if (editingCandidate === c.id) { setEditingCandidate(null); } else {
                              setEditingCandidate(c.id); setExpandedCvPanel(null);
                              setEditForm({
                                email: c.email || '', phone: c.phone || '', linkedIn: c.linkedIn || '',
                                availability: c.availability || '', salaryExpectation: c.salaryExpectation || '',
                                recruiterNotes: c.recruiterNotes || '',
                              });
                            }
                          }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}>
                            {editingCandidate === c.id ? 'Cerrar' : 'Editar'}
                          </button>
                        )}
                      </div>

                      {/* Stage selector (only for final decisions) */}
                      {isAdmin && (c.stage === 'scored' || c.stage === 'approved' || c.stage === 'rejected' || c.stage === 'hired') && (
                        <select className="input" value={c.stage} onChange={(e) => {
                          if (token) api.recruitment.candidates.updateStage(token, c.id, e.target.value).then(() => fetchProcess());
                        }} style={{ fontSize: '0.75rem', width: 'auto', padding: '0.2rem 0.4rem' }}>
                          <option value="scored">Puntuado</option>
                          <option value="approved">Aprobado</option>
                          <option value="rejected">Rechazado</option>
                          <option value="hired">Contratado</option>
                        </select>
                      )}
                    </div>

                    {/* CV Expandable Panel */}
                    {expandedCvPanel === c.id && (
                      <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        {/* Step indicators */}
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvUrl ? 'var(--success)' : 'var(--border)', color: c.cvUrl ? '#fff' : 'var(--text-muted)' }}>1</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvUrl ? 600 : 400, color: c.cvUrl ? 'var(--success)' : 'var(--text-muted)' }}>Cargar CV</span>
                          </div>
                          <div style={{ width: 30, height: 2, background: c.cvUrl ? 'var(--success)' : 'var(--border)' }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)', color: c.cvAnalysis ? '#fff' : 'var(--text-muted)' }}>2</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvAnalysis ? 600 : 400, color: c.cvAnalysis ? 'var(--success)' : 'var(--text-muted)' }}>Analizar con IA</span>
                          </div>
                          <div style={{ width: 30, height: 2, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)' }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)', color: c.cvAnalysis ? '#fff' : 'var(--text-muted)' }}>3</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvAnalysis ? 600 : 400, color: c.cvAnalysis ? 'var(--success)' : 'var(--text-muted)' }}>Informe</span>
                          </div>
                        </div>

                        {/* Step 1: Upload */}
                        {!c.cvUrl ? (
                          <div style={{ textAlign: 'center', padding: '1.5rem', border: '2px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                              Sube el CV del candidato en formato PDF (max 5MB)
                            </p>
                            {canManageCv && (
                              <label className="btn-primary" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                                {uploadingCv ? 'Subiendo...' : 'Seleccionar archivo'}
                                <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                              </label>
                            )}
                          </div>
                        ) : !c.cvAnalysis ? (
                          /* Step 2: Analyze */
                          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>
                              CV cargado correctamente
                            </p>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                              La IA analizará el CV y lo cruzará con los requisitos del cargo para calcular el porcentaje de coincidencia.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              {canManageCv && (
                                <>
                                  <button className="btn-primary" onClick={() => handleAnalyzeCv(c.id)} disabled={!!analyzingCvId || aiBlocked} style={{ fontSize: '0.85rem' }}>
                                    {analyzingCvId === c.id ? 'Analizando... (10-20 seg)' : aiBlocked ? 'Créditos IA agotados' : 'Analizar CV con IA'}
                                  </button>
                                  <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: '0.82rem' }}>
                                    Cambiar CV
                                    <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                                  </label>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Step 3: Results summary */
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Resultado del Análisis</span>
                              {canManageCv && (
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                  <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                    onClick={() => handleAnalyzeCv(c.id)} disabled={!!analyzingCvId || aiBlocked}>
                                    {analyzingCvId === c.id ? 'Analizando...' : aiBlocked ? 'Sin créditos' : 'Re-analizar'}
                                  </button>
                                  <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                    Cambiar CV
                                    <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                                  </label>
                                </div>
                              )}
                            </div>
                            {(() => {
                              let a = c.cvAnalysis;
                              if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_e) { a = null; } }
                              if (!a) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos de análisis</p>;
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                  {a.resumenEjecutivo && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{a.resumenEjecutivo}</p>}
                                  {a.matchPercentage != null && (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ padding: '0.3rem 0.8rem', borderRadius: 20, fontWeight: 700, fontSize: '0.9rem',
                                        background: a.matchPercentage >= 70 ? 'rgba(16,185,129,0.1)' : a.matchPercentage >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                                        color: a.matchPercentage >= 70 ? 'var(--success)' : a.matchPercentage >= 40 ? 'var(--warning)' : 'var(--danger)',
                                      }}>Coincidencia: {a.matchPercentage}%</span>
                                    </div>
                                  )}
                                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>Ver informe completo en la Tarjeta de Puntuación</p>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Edit candidate panel */}
                    {editingCandidate === c.id && (
                      <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>Editar datos del candidato</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Email</label>
                            <input className="input" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Telefono</label>
                            <input className="input" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>LinkedIn</label>
                            <input className="input" value={editForm.linkedIn} onChange={(e) => setEditForm((f) => ({ ...f, linkedIn: e.target.value }))} placeholder="URL de perfil" style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Disponibilidad</label>
                            <select className="input" value={editForm.availability} onChange={(e) => setEditForm((f) => ({ ...f, availability: e.target.value }))} style={{ fontSize: '0.85rem' }}>
                              <option value="">Sin especificar</option>
                              <option value="Inmediata">Inmediata</option>
                              <option value="15 dias">15 dias</option>
                              <option value="30 dias">30 dias</option>
                              <option value="60 dias">60 dias</option>
                              <option value="90 dias">90 dias</option>
                              <option value="A convenir">A convenir</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Pretension de renta</label>
                            <input className="input" value={editForm.salaryExpectation}
                              onChange={(e) => { const raw = e.target.value.replace(/\D/g, ''); setEditForm((f) => ({ ...f, salaryExpectation: raw ? Number(raw).toLocaleString('es-CL') : '' })); }}
                              placeholder="$0" style={{ fontSize: '0.85rem' }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Notas del reclutador</label>
                          <textarea className="input" value={editForm.recruiterNotes} onChange={(e) => setEditForm((f) => ({ ...f, recruiterNotes: e.target.value }))}
                            rows={3} placeholder="Observaciones, comentarios internos..." style={{ fontSize: '0.85rem', resize: 'vertical' as const }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn-primary" style={{ fontSize: '0.82rem' }} disabled={savingEdit} onClick={async () => {
                            if (!token) return;
                            setSavingEdit(true);
                            try {
                              await api.recruitment.candidates.update(token, c.id, editForm);
                              toast('Datos actualizados', 'success');
                              setEditingCandidate(null);
                              fetchProcess();
                            } catch (err: any) { toast(err.message || 'Error al guardar', 'error'); }
                            setSavingEdit(false);
                          }}>
                            {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                          </button>
                          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setEditingCandidate(null)}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Evaluación (entrevista) ──────────────────────────── */}
      {tab === 'evaluacion' && (
        <div>
          {!selectedCandidate ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              {isEvaluatorOfProcess
                ? 'Selecciona un candidato desde la pestaña Candidatos y presiona "Evaluar"'
                : 'Selecciona un candidato desde la pestaña Candidatos para ver sus evaluaciones'}
            </div>
          ) : !isEvaluatorOfProcess ? (
            /* ── Admin read-only view of evaluations ──────────────── */
            <AdminEvaluationView candidate={selectedCandidate} token={token} onViewScorecard={() => loadScorecard(selectedCandidate.id)} />
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
                Evaluación: {selectedCandidate.firstName || selectedCandidate.user?.firstName} {selectedCandidate.lastName || selectedCandidate.user?.lastName}
              </h2>

              {/* Requirement checks */}
              {interviewForm.reqChecks.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Cumplimiento de Requisitos</h3>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontSize: '0.78rem' }}>Requisito</th>
                        <th style={{ width: 130, fontSize: '0.78rem' }}>Estado</th>
                        <th style={{ fontSize: '0.78rem' }}>Comentario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interviewForm.reqChecks.map((rc: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontSize: '0.85rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 600 }}>{categoryLabel(rc.category)}</span>
                            <br />{rc.text}
                          </td>
                          <td>
                            <select className="input" value={rc.status}
                              onChange={(e) => setInterviewForm((f) => {
                                const checks = [...f.reqChecks];
                                checks[i] = { ...checks[i], status: e.target.value };
                                return { ...f, reqChecks: checks };
                              })}
                              style={{ fontSize: '0.82rem', fontWeight: 600, minWidth: 140,
                                color: rc.status === 'cumple' ? 'var(--success)' : rc.status === 'no_cumple' ? 'var(--danger)' : rc.status === 'parcial' ? 'var(--warning)' : 'var(--text-muted)',
                              }}>
                              <option value="pendiente">Pendiente</option>
                              <option value="cumple">Cumple</option>
                              <option value="parcial">Cumple parcialmente</option>
                              <option value="no_cumple">No cumple</option>
                            </select>
                          </td>
                          <td>
                            <input className="input" value={rc.comment || ''} style={{ fontSize: '0.78rem' }}
                              onChange={(e) => setInterviewForm((f) => {
                                const checks = [...f.reqChecks];
                                checks[i] = { ...checks[i], comment: e.target.value };
                                return { ...f, reqChecks: checks };
                              })}
                              placeholder="Comentario..." />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Score section */}
              {(() => {
                const checks = interviewForm.reqChecks || [];
                const answered = checks.filter((c: any) => c.status !== 'pendiente');
                const scoreMap: Record<string, number> = { cumple: 10, parcial: 5, no_cumple: 0 };
                const hasWeights = answered.some((c: any) => c.weight > 0);
                const equalW = answered.length > 0 ? 100 / checks.length : 1;
                const autoScore = answered.length > 0
                  ? hasWeights
                    ? Number((answered.reduce((sum: number, c: any) => sum + (scoreMap[c.status] || 0) * (c.weight || equalW), 0) / answered.reduce((s: number, c: any) => s + (c.weight || equalW), 0)).toFixed(1))
                    : Number((answered.reduce((sum: number, c: any) => sum + (scoreMap[c.status] || 0), 0) / answered.length).toFixed(1))
                  : 0;
                // Compute final globalScore: weighted 70% requirements + 30% evaluator
                const manualScore = interviewForm.manualScore ? Number(interviewForm.manualScore) : null;
                const finalScore = manualScore != null && answered.length > 0
                  ? Number(((autoScore * 0.7) + (manualScore * 0.3)).toFixed(1))
                  : manualScore != null ? manualScore
                  : answered.length > 0 ? autoScore : 0;
                // Auto-update globalScore
                if (String(finalScore) !== interviewForm.globalScore) {
                  setTimeout(() => setInterviewForm((f) => ({ ...f, globalScore: String(finalScore) })), 0);
                }
                return null;
              })()}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 140px 1fr', gap: '1rem' }}>
                  {/* Auto score from requirements */}
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Puntaje Requisitos</label>
                    <div style={{ textAlign: 'center', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-muted)', padding: '0.3rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                      {(() => {
                        const checks = interviewForm.reqChecks || [];
                        const answered = checks.filter((c: any) => c.status !== 'pendiente');
                        const scoreMap: Record<string, number> = { cumple: 10, parcial: 5, no_cumple: 0 };
                        const hw = answered.some((c: any) => c.weight > 0);
                        const eqW = checks.length > 0 ? 100 / checks.length : 1;
                        if (answered.length === 0) return '--';
                        return hw
                          ? (answered.reduce((s: number, c: any) => s + (scoreMap[c.status] || 0) * (c.weight || eqW), 0) / answered.reduce((s: number, c: any) => s + (c.weight || eqW), 0)).toFixed(1)
                          : (answered.reduce((s: number, c: any) => s + (scoreMap[c.status] || 0), 0) / answered.length).toFixed(1);
                      })()}/10
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.2rem' }}>
                      {(interviewForm.reqChecks || []).some((c: any) => c.weight > 0) ? 'Ponderado por peso' : 'Auto-calculado'}
                    </div>
                  </div>
                  {/* Manual evaluator score */}
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Mi Puntuacion</label>
                    <input className="input" type="number" min={1} max={10} step={0.1}
                      value={interviewForm.manualScore || ''}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (val && Number(val) > 10) val = '10';
                        if (val && Number(val) < 0) val = '0';
                        setInterviewForm((f) => ({ ...f, manualScore: val }));
                      }}
                      placeholder="1-10"
                      style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '0.3rem' }} />
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.2rem' }}>Tu apreciacion</div>
                  </div>
                  {/* Final combined score */}
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0.5rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Puntaje Final</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>
                      {interviewForm.globalScore || '--'}<span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/10</span>
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Ponderado: 70% requisitos + 30% evaluador</div>
                  </div>
                </div>
              </div>

              {/* Comments */}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Comentarios generales</label>
                <textarea className="input" rows={3} value={interviewForm.comments}
                  onChange={(e) => setInterviewForm((f) => ({ ...f, comments: e.target.value }))}
                  style={{ resize: 'vertical', fontSize: '0.85rem' }} placeholder="Observaciones de la entrevista, impresion general del candidato..." />
              </div>

              <button className="btn-primary" onClick={handleSaveInterview} disabled={savingInterview}>
                {savingInterview ? 'Guardando...' : 'Guardar Evaluación'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Scorecard ────────────────────────────────────────── */}
      {tab === 'scorecard' && (
        <div>
          {!scorecard ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Selecciona un candidato y presiona "Puntaje" para ver su tarjeta de puntuacion
            </div>
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
                Tarjeta de Puntuación: {scorecard.candidate?.firstName || scorecard.candidate?.user?.firstName} {scorecard.candidate?.lastName || scorecard.candidate?.user?.lastName}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {scorecard.scores?.cvMatchPct != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Match IA (CV)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>{scorecard.scores.cvMatchPct}%</div>
                  </div>
                )}
                {scorecard.scores?.interviewAvg != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Prom. Entrevistas</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{scorecard.scores.interviewAvg}/10</div>
                  </div>
                )}
                {scorecard.scores?.requirementPct != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Requisitos</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{scorecard.scores.requirementPct}%</div>
                  </div>
                )}
                {scorecard.scores?.historyAvg != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Historial Eval.</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f59e0b' }}>{scorecard.scores.historyAvg}/5</div>
                  </div>
                )}
                <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Puntaje Final</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--success)' }}>
                    {scorecard.scores?.finalScore != null ? Number(scorecard.scores.finalScore).toFixed(1) : '--'}/10
                  </div>
                </div>
              </div>

              {/* Interviews detail */}
              {scorecard.interviews?.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Evaluaciónes de Entrevista</h3>
                  {scorecard.interviews.map((i: any) => (
                    <div key={i.id} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{i.evaluator?.firstName} {i.evaluator?.lastName}</span>
                        <span style={{ fontWeight: 700, color: '#6366f1' }}>{i.globalScore != null ? i.globalScore + '/10' : '--'}</span>
                      </div>
                      {i.comments && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{i.comments}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* CV Analysis */}
              {scorecard.candidate?.cvAnalysis && (() => {
                // Parse if stored as string
                let analysis = scorecard.candidate.cvAnalysis;
                if (typeof analysis === 'string') {
                  try { analysis = JSON.parse(analysis); } catch (_e) { analysis = null; }
                }
                if (!analysis) return null;
                return (
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--accent)' }}>Informe IA del CV</h3>
                    {analysis.resumenEjecutivo && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '0.75rem' }}>{analysis.resumenEjecutivo}</p>
                    )}
                    {analysis.experienciaRelevante && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Experiencia Relevante</div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{analysis.experienciaRelevante}</p>
                      </div>
                    )}
                    {analysis.habilidadesTecnicas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Habilidades T&eacute;cnicas</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {analysis.habilidadesTecnicas.map((h: string, i: number) => (
                            <span key={i} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'rgba(201,147,58,0.08)', borderRadius: 10, color: 'var(--accent)' }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.habilidadesBlandas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Habilidades Blandas</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {analysis.habilidadesBlandas.map((h: string, i: number) => (
                            <span key={i} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'rgba(99,102,241,0.08)', borderRadius: 10, color: '#6366f1' }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.formacionAcademica && (
                      <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <strong>Formaci&oacute;n:</strong> {analysis.formacionAcademica}
                      </div>
                    )}
                    {analysis.alertas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.3rem' }}>Alertas</div>
                        {analysis.alertas.map((a: string, i: number) => (
                          <div key={i} style={{ fontSize: '0.82rem', color: 'var(--danger)', padding: '0.25rem 0', lineHeight: 1.4 }}>&#9888; {a}</div>
                        ))}
                      </div>
                    )}
                    {analysis.recomendacion && (
                      <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                        <strong>Recomendaci&oacute;n:</strong> {analysis.recomendacion}
                      </div>
                    )}
                    {analysis.matchPercentage != null && (
                      <div style={{ display: 'inline-block', padding: '0.3rem 0.8rem', borderRadius: 20, fontWeight: 700, fontSize: '0.85rem',
                        background: analysis.matchPercentage >= 70 ? 'rgba(16,185,129,0.1)' : analysis.matchPercentage >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                        color: analysis.matchPercentage >= 70 ? 'var(--success)' : analysis.matchPercentage >= 40 ? 'var(--warning)' : 'var(--danger)',
                      }}>
                        Coincidencia: {analysis.matchPercentage}%
                        {analysis.matchJustification && (
                          <span style={{ fontWeight: 400, fontSize: '0.78rem', marginLeft: '0.5rem' }}>— {analysis.matchJustification}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Comparativa (solo internos) ──────────────────────── */}
      {tab === 'comparativa' && (
        <div>
          {!comparative ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando comparativa...</div>
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>Cuadro Comparativo</h2>
              <div className="card" style={{ overflow: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Candidato</th>
                      <th>Entrevistas</th>
                      {isInternal && <th>Historial</th>}
                      {isInternal && <th>Antiguedad</th>}
                      <th>Puntaje Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(comparative.rows || []).map((row: any) => {
                      const c = row.candidate;
                      const name = c.user ? c.user.firstName + ' ' + c.user.lastName : (c.firstName || '') + ' ' + (c.lastName || '');
                      return (
                        <tr key={c.id}>
                          <td>
                            <span style={{ fontWeight: 600 }}>{name}</span>
                            {c.candidateType === 'internal' && <span style={{ fontSize: '0.68rem', color: '#6366f1', fontWeight: 700, marginLeft: '0.4rem' }}>INTERNO</span>}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.interviewAvg != null ? row.interviewAvg + '/10' : '--'}</td>
                          {isInternal && <td style={{ textAlign: 'center', fontWeight: 600, color: '#6366f1' }}>{row.internalProfile?.avgScore ? row.internalProfile.avgScore + '/5' : '--'}</td>}
                          {isInternal && <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{row.internalProfile?.user?.tenureMonths != null ? (row.internalProfile.user.tenureMonths >= 12 ? Math.floor(row.internalProfile.user.tenureMonths / 12) + 'a ' + (row.internalProfile.user.tenureMonths % 12) + 'm' : row.internalProfile.user.tenureMonths + 'm') : '--'}</td>}
                          <td style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.1rem', color: 'var(--success)' }}>
                            {c.finalScore != null ? Number(c.finalScore).toFixed(1) : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Configuración ────────────────────────────────────── */}
      {tab === 'configuracion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Información del Proceso</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Titulo:</span> <strong>{process.title}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Cargo:</span> <strong>{process.position}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Departamento:</span> <strong>{process.department || '—'}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Tipo:</span> <strong>{isInternal ? 'Interno' : 'Externo'}</strong></div>
              {process.startDate && <div><span style={{ color: 'var(--text-muted)' }}>Inicio:</span> <strong>{new Date(process.startDate).toLocaleDateString('es-CL')}</strong></div>}
              {process.endDate && <div><span style={{ color: 'var(--text-muted)' }}>Fin:</span> <strong>{new Date(process.endDate).toLocaleDateString('es-CL')}</strong></div>}
            </div>
            {process.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>{process.description}</p>}
          </div>

          {requirements.length > 0 && (
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Requisitos del Cargo</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {requirements.map((r: any, i: number) => (
                  <span key={i} style={{ padding: '0.3rem 0.7rem', borderRadius: 20, fontSize: '0.78rem', background: 'rgba(201,147,58,0.08)', border: '1px solid rgba(201,147,58,0.2)', color: 'var(--accent)', fontWeight: 500 }}>
                    {categoryLabel(r.category)}: {r.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Evaluadores ({evaluators.length})</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {evaluators.map((ev: any) => (
                <div key={ev.id} style={{ padding: '0.4rem 0.8rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                  {ev.evaluator?.firstName} {ev.evaluator?.lastName}
                  {ev.evaluator?.department && <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>({ev.evaluator.department})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Status change (admin only) */}
          {isAdmin && (
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Estado del Proceso</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['draft', 'active', 'completed', 'closed'].map((s) => (
                  <button key={s} onClick={() => { if (token) api.recruitment.processes.update(token, params.id, { status: s }).then(() => fetchProcess()); }}
                    style={{
                      padding: '0.4rem 0.85rem', fontSize: '0.82rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      border: process.status === s ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: process.status === s ? 'rgba(201,147,58,0.1)' : 'transparent',
                      fontWeight: process.status === s ? 700 : 400,
                      color: process.status === s ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>
                    {PROCESS_STATUS_LABELS[s] || s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
