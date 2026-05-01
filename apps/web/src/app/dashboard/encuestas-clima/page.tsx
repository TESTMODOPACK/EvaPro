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
  // T3 — `settings` controla flags del responder (barra progreso, shuffle,
  // partial save server-side). Defaults conservadores: solo showProgressBar
  // queda en true para no romper la UX existente.
  const [form, setForm] = useState({
    title: '',
    description: '',
    isAnonymous: true,
    targetAudience: 'all' as 'all' | 'by_department',
    targetDepartments: [] as string[],
    // T4 — IDs paralelos a los nombres. El backend los prioriza para
    // matching robusto frente a renames. Si el departmentRecords del
    // tenant viene del fallback legacy (custom-settings sin id), el id
    // sera string vacio y filtramos esos antes de enviar al backend.
    targetDepartmentIds: [] as string[],
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    settings: {
      showProgressBar: true,
      randomizeQuestions: false,
      allowPartialSave: false,
      // T12 — k-anonymity threshold (solo aplica a encuestas anonimas).
      // Default 5 = estandar de privacidad agregada para grupos chicos.
      kAnonymityThreshold: 5,
    },
    questions: [] as any[],
  });

  const { departments, departmentRecords } = useDepartments();
  const [competencies, setCompetencies] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    api.development.competencies.list(token).then((data) => setCompetencies(Array.isArray(data) ? data : [])).catch(() => {});
  }, [token]);

  /**
   * T3 — Infiere la categoria de la encuesta de clima a partir del
   * nombre de la competencia (y como fallback su categoria nativa).
   *
   * Bug previo: la plantilla hacia `category: comp.category || comp.name`,
   * lo cual mete todas las preguntas en la categoria nativa de la
   * competencia (Tecnica/Blanda/Gestion/Liderazgo). Como en muchos
   * tenants el seed pone la mayoria en "Liderazgo", el 90% de las
   * preguntas terminaba taggeadas como Liderazgo y el reporte por
   * categoria perdia toda granularidad.
   *
   * Estrategia:
   *   1. Intentar match por keywords del nombre de la competencia
   *      contra el catalogo de categorias de la encuesta de clima.
   *      Esto asume nombres en es-CL (acentos ignorados).
   *   2. Si no hay match, traducir la categoria nativa (Tecnica→
   *      Desarrollo, Blanda→Cultura, Gestion→Gestion, Liderazgo→
   *      Liderazgo).
   *   3. Si todo falla, usar el NOMBRE de la competencia como su
   *      propia categoria. Asi nunca todo queda en un solo balde.
   *
   * El admin igual puede editar la categoria por pregunta en el form,
   * esto solo mejora el default sugerido.
   */
  const inferSurveyClimateCategory = (comp: { name?: string; category?: string }): string => {
    // U+0300..U+036F = Combining Diacritical Marks block; quitarlos tras
    // NFD nos da string sin acentos para hacer matching robusto.
    const stripAccents = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const name = stripAccents(comp.name || '');
    const cat = stripAccents(comp.category || '');

    // Orden de keywords pensado para que las mas especificas ganen primero.
    const KEYWORDS: Array<[string, RegExp]> = [
      ['Comunicación', /\bcomunic|escucha|oratoria|feedback|asertiv|presenta/],
      ['Bienestar', /bienestar|equilibrio|balance|estres|salud|autocuid|emocional/],
      ['Compensación', /compensac|salario|remunerac|beneficio|reconocim/],
      ['Equipo', /equipo|colaborac|cooperac|sinergi|trabajo en equipo/],
      ['Liderazgo', /liderazgo|lider|coach|mentor|inspir|motivac/],
      ['Gestión', /gestion|planific|organiz|delegac|resultados|estrateg|decision|prioriza/],
      ['Desarrollo', /desarrollo|aprend|adapt|innovac|creativ|crecimiento|mejora|capacit/],
      ['Cultura', /cultur|valor|etic|integr|diversidad|inclusion|respeto|confianza/],
    ];
    for (const [climateCat, rx] of KEYWORDS) {
      if (rx.test(name)) return climateCat;
    }

    // Fallback 2: traducir la categoria nativa de la competencia.
    if (cat.includes('liderazgo')) return 'Liderazgo';
    if (cat.includes('gestion')) return 'Gestión';
    if (cat.includes('tecnica')) return 'Desarrollo';
    if (cat.includes('blanda')) return 'Cultura';

    // Fallback 3: nombre de la competencia como su propia categoria.
    // Garantiza diversidad y permite que el reporte por categoria sea
    // util incluso con seeds raros.
    return comp.name?.trim() || 'General';
  };

  const generateTemplateQuestions = (level: 1 | 2 | 3) => {
    const questions: any[] = [];
    const qBanks = [
      (name: string) => `¿Cómo evalúas la competencia de ${name} en tu equipo/organización?`,
      (name: string) => `¿Tu encargado demuestra ${name} en su gestión diaria?`,
      (name: string) => `¿La organización fomenta activamente el desarrollo de ${name}?`,
    ];
    for (const comp of competencies) {
      const climateCategory = inferSurveyClimateCategory(comp);
      for (let i = 0; i < level; i++) {
        questions.push({ category: climateCategory, questionText: qBanks[i](comp.name), questionType: 'likert_5', isRequired: true });
      }
    }
    // NPS
    questions.push({ category: 'NPS', questionText: 'Del 0 al 10, ¿qué tan probable es que recomiendes esta organización como lugar de trabajo?', questionType: 'nps', isRequired: true });
    if (level >= 3) questions.push({ category: 'NPS', questionText: 'Del 0 al 10, ¿qué tan satisfecho/a estás con tu experiencia laboral actual?', questionType: 'nps', isRequired: true });
    // Open text
    questions.push({ category: 'General', questionText: '¿Qué es lo que más valoras de trabajar en esta organización?', questionType: 'open_text', isRequired: false });
    if (level >= 2) questions.push({ category: 'General', questionText: '¿Qué cambio concreto mejoraría tu experiencia laboral?', questionType: 'open_text', isRequired: false });
    if (level >= 3) {
      questions.push({ category: 'General', questionText: '¿Qué sugerencia tienes para mejorar el clima laboral?', questionType: 'open_text', isRequired: false });
    }
    return questions;
  };

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
      targetDepartments: [], targetDepartmentIds: [], startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      settings: { showProgressBar: true, randomizeQuestions: false, allowPartialSave: false, kAnonymityThreshold: 5 },
      questions: [],
    });
  };

  const addQuestion = () => {
    setForm((f) => ({
      ...f,
      questions: [{ category: 'General', questionText: '', questionType: 'likert_5', isRequired: true, options: null }, ...f.questions],
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
            {isAdmin
              ? t('surveys.subtitle')
              : 'Participa en las encuestas de clima de tu organización'}
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

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{'📊'} ¿Qué es el eNPS?</div>
            <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 0.35rem' }}>
                El <strong>eNPS (Employee Net Promoter Score)</strong> mide la lealtad y satisfacción de los colaboradores. Se calcula como <strong>% Promotores − % Detractores</strong>.
              </p>
              <p style={{ margin: '0 0 0.35rem' }}>
                <strong>Escala:</strong> va de <strong>−100</strong> (todos detractores) a <strong>+100</strong> (todos promotores).
              </p>
              <p style={{ margin: '0 0 0.35rem' }}>
                <strong>Clasificación de respuestas (escala 1-10):</strong>
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                <span><span style={{ color: '#16a34a', fontWeight: 700 }}>Promotores (9-10):</span> Recomendarían la empresa</span>
                <span><span style={{ color: '#eab308', fontWeight: 700 }}>Pasivos (7-8):</span> Neutrales</span>
                <span><span style={{ color: '#ef4444', fontWeight: 700 }}>Detractores (0-6):</span> No recomendarían</span>
              </div>
              <p style={{ margin: 0 }}>
                <strong>Interpretación:</strong> {'\u2265'}50 excelente · 30-49 muy bueno · 0-29 aceptable · {'\u003C'}0 requiere atención urgente.
              </p>
            </div>
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
                <input
                  type="checkbox"
                  checked={form.isAnonymous}
                  onChange={(e) => setForm((f) => {
                    const next = e.target.checked;
                    // T3 — al activar anonima, allowPartialSave debe quedar
                    // en false (no se puede asociar progreso parcial a un
                    // userId sin romper anonimato). Backend tambien lo
                    // fuerza, esto es solo para UX consistente.
                    return {
                      ...f,
                      isAnonymous: next,
                      settings: next ? { ...f.settings, allowPartialSave: false } : f.settings,
                    };
                  })}
                />
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
            {/* T3 — Configuracion del responder */}
            <div style={{ padding: '0.75rem 1rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Configuracion del responder
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }} title="Muestra una barra de progreso al respondente. Util en encuestas largas; puedes ocultarla en encuestas muy cortas para no presionar.">
                  <input
                    type="checkbox"
                    checked={form.settings.showProgressBar}
                    onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, showProgressBar: e.target.checked } }))}
                  />
                  Mostrar barra de progreso
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }} title="Aleatoriza las preguntas dentro de cada categoria por respondente (orden estable por usuario). Reduce sesgo de orden.">
                  <input
                    type="checkbox"
                    checked={form.settings.randomizeQuestions}
                    onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, randomizeQuestions: e.target.checked } }))}
                  />
                  Aleatorizar preguntas
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', opacity: form.isAnonymous ? 0.5 : 1 }}
                  title={form.isAnonymous
                    ? 'Solo disponible en encuestas no anonimas (en anonimas el progreso vive en el navegador del respondente).'
                    : 'Permite al respondente guardar y continuar mas tarde sin perder respuestas.'}
                >
                  <input
                    type="checkbox"
                    checked={form.settings.allowPartialSave}
                    disabled={form.isAnonymous}
                    onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, allowPartialSave: e.target.checked } }))}
                  />
                  Permitir guardar progreso
                </label>
              </div>
              {/* T12 — threshold de k-anonymity solo para encuestas anonimas */}
              {form.isAnonymous && (
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <label htmlFor="kAnon" title="Departamentos con menos de N respuestas no veran sus agregados (proteccion contra re-identificacion en grupos chicos). N=5 es el estandar; subir a 10+ para alta sensibilidad.">
                    Privacidad — supresión bajo
                  </label>
                  <input
                    id="kAnon"
                    type="number"
                    min={2}
                    max={100}
                    step={1}
                    className="input"
                    style={{ width: 70 }}
                    value={form.settings.kAnonymityThreshold ?? 5}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      const safe = isNaN(n) ? 5 : Math.min(100, Math.max(2, n));
                      setForm((f) => ({ ...f, settings: { ...f.settings, kAnonymityThreshold: safe } }));
                    }}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>respuestas</span>
                </div>
              )}
            </div>
            {form.targetAudience === 'by_department' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Departamentos</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {/* T4 — iteramos sobre departmentRecords para tener el ID
                      junto al nombre. Mantenemos targetDepartments (nombres)
                      en paralelo para retrocompat y como fallback cuando el
                      departamento viene de legacy custom-settings sin id. */}
                  {departmentRecords.map((d) => {
                    const checked = d.id
                      ? form.targetDepartmentIds.includes(d.id)
                      : form.targetDepartments.includes(d.name);
                    return (
                      <label key={d.id || d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setForm((f) => {
                              const isOn = e.target.checked;
                              const nextIds = d.id
                                ? (isOn
                                    ? [...f.targetDepartmentIds, d.id]
                                    : f.targetDepartmentIds.filter((x) => x !== d.id))
                                : f.targetDepartmentIds;
                              const nextNames = isOn
                                ? (f.targetDepartments.includes(d.name) ? f.targetDepartments : [...f.targetDepartments, d.name])
                                : f.targetDepartments.filter((x) => x !== d.name);
                              return { ...f, targetDepartmentIds: nextIds, targetDepartments: nextNames };
                            });
                          }}
                        />
                        {d.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Create button — positioned after general fields for visibility */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => { setShowCreate(false); resetForm(); }}>{t('common.cancel')}</button>
            <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={creating || !form.title.trim() || form.questions.length === 0}>
              {creating ? t('surveys.creating') : t('surveys.createSurvey')}
            </button>
          </div>

          {/* Template buttons — generate questions from org competencies */}
          {form.questions.length === 0 && (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Genera preguntas automáticamente a partir de las competencias de tu organización ({competencies.length} competencias):
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {([
                  { level: 1 as const, icon: '📋', name: 'Encuesta Rápida', desc: '1 pregunta por competencia' },
                  { level: 2 as const, icon: '📊', name: 'Encuesta Completa', desc: '2 preguntas por competencia' },
                  { level: 3 as const, icon: '📈', name: 'Encuesta Exhaustiva', desc: '3 preguntas por competencia' },
                ]).map(tpl => {
                  const count = competencies.length * tpl.level + (tpl.level >= 3 ? 2 : 1) + tpl.level;
                  return (
                    <button key={tpl.level} className="btn-ghost" disabled={competencies.length === 0}
                      style={{ flex: '1 1 150px', padding: '0.75rem', textAlign: 'center', border: '2px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                      onClick={() => setForm(f => ({ ...f, questions: generateTemplateQuestions(tpl.level) }))}>
                      <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{tpl.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{tpl.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{tpl.desc}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, marginTop: '0.2rem' }}>{count} preguntas</div>
                    </button>
                  );
                })}
              </div>
              {competencies.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
                  No hay competencias registradas. Ve a Catálogo de Competencias para agregar.
                </p>
              )}
            </div>
          )}

          {/* Questions builder */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{t('surveys.questionsCount', { count: form.questions.length })}</h4>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
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

          {/* Bottom create button (duplicate for convenience after scrolling through questions) */}
          {form.questions.length > 3 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={creating || !form.title.trim() || form.questions.length === 0}>
                {creating ? t('surveys.creating') : t('surveys.createSurvey')}
              </button>
            </div>
          )}
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

      {/* ─── Employee empty state ─── */}
      {!isAdmin && pendingSurveys.length === 0 && (
        <div className="card animate-fade-up" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' }}>
            No tienes encuestas pendientes
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            Cuando se lance una nueva encuesta de clima, aparecerá aquí para que puedas responderla.
          </p>
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
                        {/* Draft: cualquier admin puede eliminar */}
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
                    {/* Admin puede eliminar encuestas en CUALQUIER estado
                        (activas, cerradas). El backend valida el rol. */}
                    {s.status !== 'draft' && isAdmin && (
                      <button
                        onClick={() => setConfirmDelete(s.id)}
                        title="Eliminar encuesta permanentemente (solo administrador del sistema)"
                        style={{
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(239,68,68,0.3)',
                          background: 'rgba(239,68,68,0.08)',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation — warning reforzado para encuestas no-draft */}
      {confirmDelete && (() => {
        const surveyToDelete = surveys.find((s: any) => s.id === confirmDelete);
        const isDraft = surveyToDelete?.status === 'draft';
        const hasResponses = (surveyToDelete?.responseCount || 0) > 0;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
            <div className="card animate-fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, padding: '1.75rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', color: 'var(--danger)' }}>
                {isDraft ? t('surveys.deleteConfirm') : '⚠️ Eliminar encuesta con datos'}
              </h3>
              {isDraft ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('surveys.deleteWarning')}</p>
              ) : (
                <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <p style={{ marginBottom: '0.5rem' }}>
                    Estás a punto de eliminar la encuesta <strong>&ldquo;{surveyToDelete?.title}&rdquo;</strong> que está en estado <strong>{surveyToDelete?.status === 'active' ? 'Activa' : 'Cerrada'}</strong>.
                  </p>
                  {hasResponses && (
                    <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.5rem' }}>
                      Esta encuesta tiene {surveyToDelete.responseCount} respuesta(s). Se eliminarán permanentemente junto con el análisis de IA asociado.
                    </p>
                  )}
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Esta acción no se puede deshacer.
                  </p>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
                <button onClick={() => handleDelete(confirmDelete)} style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer' }}>
                  {isDraft ? t('common.delete') : 'Eliminar permanentemente'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
