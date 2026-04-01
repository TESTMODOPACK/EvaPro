'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useDepartments } from '@/hooks/useDepartments';

// ─── Default template questions ────────────────────────────────────────
const TEMPLATE_QUESTIONS = [
  { category: 'Liderazgo', questionText: 'Mi lider directo me da retroalimentacion constructiva regularmente', questionType: 'likert_5', isRequired: true },
  { category: 'Comunicacion', questionText: 'La comunicacion interna de la empresa es clara y oportuna', questionType: 'likert_5', isRequired: true },
  { category: 'Bienestar', questionText: 'Siento que la empresa se preocupa por mi bienestar', questionType: 'likert_5', isRequired: true },
  { category: 'Cultura', questionText: 'Me siento orgulloso/a de trabajar en esta empresa', questionType: 'likert_5', isRequired: true },
  { category: 'Desarrollo', questionText: 'Tengo oportunidades reales de crecimiento profesional aqui', questionType: 'likert_5', isRequired: true },
  { category: 'Gestion', questionText: 'Tengo los recursos necesarios para hacer bien mi trabajo', questionType: 'likert_5', isRequired: true },
  { category: 'NPS', questionText: 'Del 0 al 10, que tan probable es que recomiendes esta empresa como lugar de trabajo?', questionType: 'nps', isRequired: true },
  { category: 'General', questionText: 'Que mejorarias de tu experiencia en la empresa?', questionType: 'open_text', isRequired: false },
];

const CATEGORIES = ['Liderazgo', 'Comunicacion', 'Bienestar', 'Cultura', 'Desarrollo', 'Gestion', 'NPS', 'General'];
const QUESTION_TYPES = [
  { value: 'likert_5', label: 'Escala 1-5' },
  { value: 'nps', label: 'NPS (0-10)' },
  { value: 'open_text', label: 'Texto Abierto' },
  { value: 'multiple_choice', label: 'Opcion Multiple' },
];

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Borrador', badge: 'badge-ghost' },
  active: { label: 'Activa', badge: 'badge-success' },
  closed: { label: 'Cerrada', badge: 'badge-warning' },
};

function EncuestasClimaPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = user?.role === 'tenant_admin' || user?.role === 'super_admin';

  const [surveys, setSurveys] = useState<any[]>([]);
  const [pendingSurveys, setPendingSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    isAnonymous: true,
    targetAudience: 'all' as 'all' | 'by_department',
    targetDepartments: [] as string[],
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    questions: [...TEMPLATE_QUESTIONS] as any[],
  });

  const { departments } = useDepartments();

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (isAdmin) {
        const data = await api.surveys.list(token);
        setSurveys(data);
      }
      const pending = await api.surveys.getMyPending(token);
      setPendingSurveys(pending);
    } catch (e: any) {
      toast(e.message || 'Error al cargar encuestas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [token]);

  const handleCreate = async () => {
    if (!token || !form.title.trim()) return;
    if (form.questions.length === 0) {
      toast('La encuesta debe tener al menos una pregunta', 'error');
      return;
    }
    setCreating(true);
    try {
      const dto = {
        ...form,
        questions: form.questions.map((q, i) => ({ ...q, sortOrder: i })),
      };
      await api.surveys.create(token, dto);
      toast('Encuesta creada exitosamente', 'success');
      setShowCreate(false);
      resetForm();
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al crear encuesta', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleLaunch = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.launch(token, id);
      toast('Encuesta lanzada exitosamente', 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al lanzar encuesta', 'error');
    }
  };

  const handleClose = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.close(token, id);
      toast('Encuesta cerrada exitosamente', 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al cerrar encuesta', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.delete(token, id);
      toast('Encuesta eliminada', 'success');
      setConfirmDelete(null);
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al eliminar', 'error');
    }
  };

  const resetForm = () => {
    setForm({
      title: '', description: '', isAnonymous: true, targetAudience: 'all',
      targetDepartments: [], startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      questions: [...TEMPLATE_QUESTIONS],
    });
  };

  const addQuestion = () => {
    setForm((f) => ({
      ...f,
      questions: [...f.questions, { category: 'General', questionText: '', questionType: 'likert_5', isRequired: true, options: null }],
    }));
  };

  const removeQuestion = (idx: number) => {
    setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));
  };

  const updateQuestion = (idx: number, field: string, value: any) => {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === idx ? { ...q, [field]: value } : q)),
    }));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= form.questions.length) return;
    setForm((f) => {
      const qs = [...f.questions];
      [qs[idx], qs[newIdx]] = [qs[newIdx], qs[idx]];
      return { ...f, questions: qs };
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('surveys.title', 'Encuestas de Clima')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Mide el compromiso y satisfaccion de tu equipo
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? 'Ocultar guia' : 'Como funciona'}
          </button>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setShowCreate(!showCreate); if (showCreate) resetForm(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Nueva Encuesta
            </button>
          )}
        </div>
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            Guia de Encuestas de Clima
          </h3>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Que es una encuesta de clima?
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Una encuesta de clima mide el compromiso, satisfaccion y bienestar de los colaboradores. Los resultados permiten identificar fortalezas y areas de mejora en la organizacion.
            </p>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Tipos de pregunta</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Likert 1-5:</strong> Escala de acuerdo (Muy en desacuerdo a Muy de acuerdo)
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>NPS (0-10):</strong> Net Promoter Score, mide la probabilidad de recomendar la empresa
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Texto Abierto:</strong> Respuesta libre para capturar feedback cualitativo
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Opcion Multiple:</strong> Seleccion de una o varias opciones predefinidas
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Flujo</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>Crear encuesta (borrador) con preguntas y configuracion</li>
              <li>Lanzar encuesta (se notifica a los colaboradores)</li>
              <li>Colaboradores responden (anonimamente si esta configurado)</li>
              <li>Cerrar encuesta y ver resultados</li>
              <li>Generar analisis con IA (plan Enterprise)</li>
              <li>Crear iniciativas de desarrollo desde el analisis</li>
            </ol>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Permisos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Administrador:</strong> Crea, lanza, cierra encuestas. Ve resultados completos y genera analisis IA
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Encargado:</strong> Ve resultados de su departamento
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Colaborador:</strong> Responde encuestas asignadas
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── CREATE FORM (inline, not modal) ─── */}
      {showCreate && isAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem', margin: '0 0 1.25rem' }}>Nueva Encuesta de Clima</h3>

          {/* Basic info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Titulo *</label>
              <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Encuesta de Clima Q1 2026" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descripcion</label>
              <textarea className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Descripcion opcional..." style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha Inicio</label>
                <input className="input" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha Fin</label>
                <input className="input" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={form.isAnonymous} onChange={(e) => setForm((f) => ({ ...f, isAnonymous: e.target.checked }))} />
                Respuestas anonimas
              </label>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audiencia</label>
                <select className="input" value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value as any }))}>
                  <option value="all">Todos los colaboradores</option>
                  <option value="by_department">Por departamento</option>
                </select>
              </div>
            </div>
            {form.targetAudience === 'by_department' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Departamentos</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {departments.map((d) => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                      <input
                        type="checkbox"
                        checked={form.targetDepartments.includes(d)}
                        onChange={(e) => {
                          setForm((f) => ({
                            ...f,
                            targetDepartments: e.target.checked ? [...f.targetDepartments, d] : f.targetDepartments.filter((x) => x !== d),
                          }));
                        }}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Questions builder */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Preguntas ({form.questions.length})</h4>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setForm((f) => ({ ...f, questions: [...TEMPLATE_QUESTIONS] }))}>
                  Usar plantilla
                </button>
                <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={addQuestion}>
                  + Agregar
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {form.questions.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button className="btn-ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} onClick={() => moveQuestion(i, -1)} disabled={i === 0}>&#8593;</button>
                    <button className="btn-ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} onClick={() => moveQuestion(i, 1)} disabled={i === form.questions.length - 1}>&#8595;</button>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <input
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                      value={q.questionText}
                      onChange={(e) => updateQuestion(i, 'questionText', e.target.value)}
                      placeholder="Texto de la pregunta..."
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <select className="input" style={{ flex: 1, minWidth: 120, fontSize: '0.8rem' }} value={q.category} onChange={(e) => updateQuestion(i, 'category', e.target.value)}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select className="input" style={{ flex: 1, minWidth: 120, fontSize: '0.8rem' }} value={q.questionType} onChange={(e) => updateQuestion(i, 'questionType', e.target.value)}>
                        {QUESTION_TYPES.map((tp) => <option key={tp.value} value={tp.value}>{tp.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <button className="btn-ghost" style={{ color: 'var(--danger)', padding: '0.25rem', fontSize: '0.8rem' }} onClick={() => removeQuestion(i)}>&#10005;</button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => { setShowCreate(false); resetForm(); }}>Cancelar</button>
            <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={creating || !form.title.trim()}>
              {creating ? 'Creando...' : 'Crear Encuesta'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Pending surveys for employees ─── */}
      {pendingSurveys.length > 0 && (
        <div className="animate-fade-up-delay-1" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
            Encuestas Pendientes
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pendingSurveys.map((s) => (
              <div key={s.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.title}</span>
                    {s.isAnonymous && <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>Anonima</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {s.description && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.description}</span>
                    )}
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Fecha limite: <strong style={{ color: 'var(--warning)' }}>{new Date(s.endDate).toLocaleDateString('es-ES')}</strong>
                    </span>
                  </div>
                </div>
                <Link href={`/dashboard/encuestas-clima/${s.id}/responder`} className="btn-primary" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
                  Responder
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Admin: surveys list ─── */}
      {isAdmin && (
        <div className="animate-fade-up-delay-2">
          <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            Todas las Encuestas
          </h2>

          {surveys.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
                No hay encuestas creadas
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Crea tu primera encuesta de clima para comenzar
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
              {surveys.map((s) => (
                <div key={s.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>{s.title}</span>
                      <span className={`badge ${STATUS_MAP[s.status]?.badge || 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
                        {STATUS_MAP[s.status]?.label || s.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <span>{s.isAnonymous ? 'Anonima' : 'Identificada'}</span>
                      <span>{s.responseCount || 0} respuestas</span>
                      <span>{new Date(s.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} - {new Date(s.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {s.status === 'draft' && (
                      <>
                        <button onClick={() => handleLaunch(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(22,163,106,0.3)', background: 'rgba(22,163,106,0.08)', color: 'var(--success)', cursor: 'pointer' }}>Lanzar</button>
                        <button onClick={() => setConfirmDelete(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', cursor: 'pointer' }}>Eliminar</button>
                      </>
                    )}
                    {s.status === 'active' && (
                      <button onClick={() => handleClose(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: 'var(--warning)', cursor: 'pointer' }}>Cerrar</button>
                    )}
                    {(s.status === 'active' || s.status === 'closed') && (
                      <Link href={`/dashboard/encuestas-clima/${s.id}/resultados`} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,147,58,0.3)', background: 'rgba(201,147,58,0.08)', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' }}>
                        Resultados
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div className="card animate-fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: '1.75rem' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Eliminar encuesta?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Esta accion no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EncuestasClimaPage() {
  return (
    <PlanGate feature="ENGAGEMENT_SURVEYS">
      <EncuestasClimaPageContent />
    </PlanGate>
  );
}
