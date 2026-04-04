'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useDepartments } from '@/hooks/useDepartments';

// ─── Default climate survey template questions ────────────────────────
const TEMPLATE_QUESTIONS = [
  // Liderazgo y Jefatura (4)
  { category: 'Liderazgo', questionText: 'Mi jefatura directa me da retroalimentación constructiva regularmente', questionType: 'likert_5', isRequired: true },
  { category: 'Liderazgo', questionText: 'Mi jefatura se preocupa por mi desarrollo profesional', questionType: 'likert_5', isRequired: true },
  { category: 'Liderazgo', questionText: 'Recibo reconocimiento cuando realizo un buen trabajo', questionType: 'likert_5', isRequired: true },
  { category: 'Liderazgo', questionText: 'Confío en las decisiones que toma mi jefatura directa', questionType: 'likert_5', isRequired: true },
  // Comunicación (3)
  { category: 'Comunicación', questionText: 'La comunicación interna de la empresa es clara y oportuna', questionType: 'likert_5', isRequired: true },
  { category: 'Comunicación', questionText: 'Conozco los objetivos estratégicos de la organización', questionType: 'likert_5', isRequired: true },
  { category: 'Comunicación', questionText: 'Puedo expresar mis ideas y opiniones sin temor', questionType: 'likert_5', isRequired: true },
  // Bienestar y Equilibrio (3)
  { category: 'Bienestar', questionText: 'Siento que la empresa se preocupa por mi bienestar integral', questionType: 'likert_5', isRequired: true },
  { category: 'Bienestar', questionText: 'Puedo mantener un equilibrio saludable entre mi vida laboral y personal', questionType: 'likert_5', isRequired: true },
  { category: 'Bienestar', questionText: 'El ambiente de trabajo es respetuoso y libre de acoso', questionType: 'likert_5', isRequired: true },
  // Cultura y Pertenencia (3)
  { category: 'Cultura', questionText: 'Me siento orgulloso/a de trabajar en esta organización', questionType: 'likert_5', isRequired: true },
  { category: 'Cultura', questionText: 'Los valores de la empresa se reflejan en las decisiones del día a día', questionType: 'likert_5', isRequired: true },
  { category: 'Cultura', questionText: 'Siento que mi trabajo tiene un propósito y aporta valor', questionType: 'likert_5', isRequired: true },
  // Desarrollo y Crecimiento (3)
  { category: 'Desarrollo', questionText: 'Tengo oportunidades reales de crecimiento profesional aquí', questionType: 'likert_5', isRequired: true },
  { category: 'Desarrollo', questionText: 'La organización invierte en capacitación y formación', questionType: 'likert_5', isRequired: true },
  { category: 'Desarrollo', questionText: 'Sé qué competencias necesito desarrollar para avanzar en mi carrera', questionType: 'likert_5', isRequired: true },
  // Gestión y Recursos (3)
  { category: 'Gestión', questionText: 'Tengo los recursos y herramientas necesarios para hacer bien mi trabajo', questionType: 'likert_5', isRequired: true },
  { category: 'Gestión', questionText: 'Los procesos internos facilitan (en vez de obstaculizar) mi trabajo', questionType: 'likert_5', isRequired: true },
  { category: 'Gestión', questionText: 'La carga de trabajo es razonable y bien distribuida en mi equipo', questionType: 'likert_5', isRequired: true },
  // Trabajo en Equipo (2)
  { category: 'Equipo', questionText: 'Existe buena colaboración entre los miembros de mi equipo', questionType: 'likert_5', isRequired: true },
  { category: 'Equipo', questionText: 'Las distintas áreas de la organización colaboran entre sí de forma efectiva', questionType: 'likert_5', isRequired: true },
  // Compensación y Beneficios (2)
  { category: 'Compensación', questionText: 'Considero que mi remuneración es justa en relación a mi rol y responsabilidades', questionType: 'likert_5', isRequired: true },
  { category: 'Compensación', questionText: 'Los beneficios que ofrece la empresa son valorados y útiles', questionType: 'likert_5', isRequired: true },
  // eNPS (1)
  { category: 'NPS', questionText: 'Del 0 al 10, ¿qué tan probable es que recomiendes esta organización como lugar de trabajo?', questionType: 'nps', isRequired: true },
  // Preguntas abiertas (2)
  { category: 'General', questionText: '¿Qué es lo que más valoras de trabajar en esta organización?', questionType: 'open_text', isRequired: false },
  { category: 'General', questionText: '¿Qué cambio concreto mejoraría tu experiencia laboral?', questionType: 'open_text', isRequired: false },
];

const CATEGORIES = ['Liderazgo', 'Comunicación', 'Bienestar', 'Cultura', 'Desarrollo', 'Gestión', 'Equipo', 'Compensación', 'NPS', 'General'];
const QUESTION_TYPES = [
  { value: 'likert_5', label: 'Escala 1-5' },
  { value: 'nps', label: 'NPS (0-10)' },
  { value: 'open_text', label: 'Texto Abierto' },
  { value: 'multiple_choice', label: 'Opción Múltiple' },
];

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-ghost',
  active: 'badge-success',
  closed: 'badge-warning',
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
      toast(e.message || t('surveys.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [token]);

  const handleCreate = async () => {
    if (!token || !form.title.trim()) return;
    if (form.questions.length === 0) {
      toast(t('surveys.needOneQuestion'), 'error');
      return;
    }
    setCreating(true);
    try {
      const dto = {
        ...form,
        questions: form.questions.map((q, i) => ({ ...q, sortOrder: i })),
      };
      await api.surveys.create(token, dto);
      toast(t('surveys.createdSuccess'), 'success');
      setShowCreate(false);
      resetForm();
      loadData();
    } catch (e: any) {
      toast(e.message || t('surveys.createError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleLaunch = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.launch(token, id);
      toast(t('surveys.launchedSuccess'), 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || t('surveys.launchError'), 'error');
    }
  };

  const handleClose = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.close(token, id);
      toast(t('surveys.closedSuccess'), 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || t('surveys.closeError'), 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.delete(token, id);
      toast(t('surveys.deletedSuccess'), 'success');
      setConfirmDelete(null);
      loadData();
    } catch (e: any) {
      toast(e.message || t('surveys.deleteError'), 'error');
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
            {t('surveys.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? t('common.hideGuide') : t('common.showGuide')}
          </button>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setShowCreate(!showCreate); if (showCreate) resetForm(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('surveys.create')}
            </button>
          )}
        </div>
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {t('surveys.guide.title')}
          </h3>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('surveys.guide.whatIs')}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              {t('surveys.guide.whatIsDesc')}
            </p>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('surveys.guide.questionTypes')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { label: 'Likert 1-5:', desc: t('surveys.guide.likertDesc') },
                { label: 'NPS (0-10):', desc: t('surveys.guide.npsDesc') },
                { label: t('surveys.questionTypeLabels.open_text') + ':', desc: t('surveys.guide.openTextDesc') },
                { label: t('surveys.questionTypeLabels.multiple_choice') + ':', desc: t('surveys.guide.multipleChoiceDesc') },
              ].map((item, i) => (
                <div key={i} style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>{item.label}</strong> {item.desc}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('surveys.guide.flow')}</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              {['flowStep1', 'flowStep2', 'flowStep3', 'flowStep4', 'flowStep5', 'flowStep6'].map((key) => (
                <li key={key}>{t(`surveys.guide.${key}`)}</li>
              ))}
            </ol>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('surveys.guide.permissions')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {['permAdmin', 'permManager', 'permEmployee'].map((key) => (
                <div key={key} style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t(`surveys.guide.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── CREATE FORM (inline, not modal) ─── */}
      {showCreate && isAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem', margin: '0 0 1.25rem' }}>{t('surveys.newSurvey')}</h3>

          {/* Basic info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Título *</label>
              <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Encuesta de Clima Q1 2026" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descripción</label>
              <textarea className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Descripción opcional..." style={{ resize: 'vertical' }} />
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
                {t('surveys.anonymousResponses')}
              </label>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audiencia</label>
                <select className="input" value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value as any }))}>
                  <option value="all">{t('surveys.audienceAll')}</option>
                  <option value="by_department">{t('surveys.audienceByDept')}</option>
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
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{t('surveys.questionsCount', { count: form.questions.length })}</h4>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setForm((f) => ({ ...f, questions: [...TEMPLATE_QUESTIONS] }))}>
                  {t('surveys.useTemplate')}
                </button>
                <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={addQuestion}>
                  {t('surveys.addQuestion')}
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
                        {QUESTION_TYPES.map((tp) => <option key={tp.value} value={tp.value}>{t(`surveys.questionTypeLabels.${tp.value}`, tp.label)}</option>)}
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
            <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => { setShowCreate(false); resetForm(); }}>{t('common.cancel')}</button>
            <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={creating || !form.title.trim()}>
              {creating ? t('surveys.creating') : t('surveys.createSurvey')}
            </button>
          </div>
        </div>
      )}

      {/* ─── Pending surveys for employees ─── */}
      {pendingSurveys.length > 0 && (
        <div className="animate-fade-up-delay-1" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
            {t('surveys.pendingSurveys')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pendingSurveys.map((s) => (
              <div key={s.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.title}</span>
                    {s.isAnonymous && <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{t('surveys.anonymousLabel')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {s.description && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.description}</span>
                    )}
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {t('surveys.dueDate')}: <strong style={{ color: 'var(--warning)' }}>{new Date(s.endDate).toLocaleDateString('es-ES')}</strong>
                    </span>
                  </div>
                </div>
                <Link href={`/dashboard/encuestas-clima/${s.id}/responder`} className="btn-primary" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
                  {t('surveys.respondBtn')}
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
            {t('surveys.allSurveys')}
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
                {t('surveys.noSurveysCreated')}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {t('surveys.createFirst')}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
              {surveys.map((s) => (
                <div key={s.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>{s.title}</span>
                      <span className={`badge ${STATUS_BADGE[s.status] || 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
                        {t(`surveys.status.${s.status}`) || s.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <span>{s.isAnonymous ? t('surveys.anonymousLabel') : t('surveys.identifiedLabel')}</span>
                      <span>{s.responseCount || 0} {t('surveys.responses')}</span>
                      <span>{new Date(s.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} - {new Date(s.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {s.status === 'draft' && (
                      <>
                        <button onClick={() => handleLaunch(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(22,163,106,0.3)', background: 'rgba(22,163,106,0.08)', color: 'var(--success)', cursor: 'pointer' }}>{t('surveys.launch')}</button>
                        <button onClick={() => setConfirmDelete(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', cursor: 'pointer' }}>{t('common.delete')}</button>
                      </>
                    )}
                    {s.status === 'active' && (
                      <button onClick={() => handleClose(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: 'var(--warning)', cursor: 'pointer' }}>{t('surveys.close')}</button>
                    )}
                    {(s.status === 'active' || s.status === 'closed') && (
                      <Link href={`/dashboard/encuestas-clima/${s.id}/resultados`} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,147,58,0.3)', background: 'rgba(201,147,58,0.08)', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' }}>
                        {t('surveys.results')}
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
            <h3 style={{ margin: '0 0 1rem' }}>{t('surveys.deleteConfirm')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('surveys.deleteWarning')}</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer' }}>{t('common.delete')}</button>
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
