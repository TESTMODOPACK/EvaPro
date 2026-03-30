'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastStore } from '@/store/toast.store';
import {
  useTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useRemoveTemplate,
  useDuplicateTemplate,
  useVersionHistory,
  useRestoreVersion,
} from '@/hooks/useTemplates';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Condition {
  questionId: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than';
  value: string;
}

interface Question {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'multi';
  scale?: { min: number; max: number; labels: Record<string, string> };
  options?: string[];
  required: boolean;
  condition?: Condition | null;
}

interface Section {
  id: string;
  title: string;
  questions: Question[];
  condition?: Condition | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).slice(2, 10);

const defaultScaleLabels: Record<string, string> = {
  '1': 'Deficiente',
  '2': 'Regular',
  '3': 'Bueno',
  '4': 'Muy Bueno',
  '5': 'Excelente',
};

const emptyQuestion = (): Question => ({
  id: genId(),
  text: '',
  type: 'scale',
  scale: { min: 1, max: 5, labels: { ...defaultScaleLabels } },
  required: true,
});

const emptySection = (): Section => ({
  id: genId(),
  title: '',
  questions: [emptyQuestion()],
});

const typeLabels: Record<string, string> = {
  scale: 'Escala',
  text: 'Texto libre',
  multi: 'Opción múltiple',
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  width: '100%',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── ConditionBuilder ────────────────────────────────────────────────────────

function ConditionBuilder({
  condition,
  onChange,
  allQuestions,
  excludeId,
}: {
  condition?: Condition | null;
  onChange: (c: Condition | null) => void;
  allQuestions: Question[];
  excludeId?: string;
}) {
  const { t } = useTranslation();
  const eligible = allQuestions.filter(
    (q) => (q.type === 'scale' || q.type === 'multi') && q.id !== excludeId,
  );

  return (
    <div style={{ marginTop: '0.6rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!condition}
          style={{ accentColor: 'var(--accent)' }}
          onChange={(e) => {
            if (e.target.checked && eligible.length > 0) {
              onChange({ questionId: eligible[0].id, operator: 'equals', value: '' });
            } else {
              onChange(null);
            }
          }}
        />
        Mostrar solo si...
      </label>
      {condition && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap', paddingLeft: '1.2rem', alignItems: 'center' }}>
          {eligible.length === 0 ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
              {t('plantillas.noTrigger')}
            </span>
          ) : (
            <>
              <select
                style={{ ...inputStyle, width: 'auto', minWidth: '180px', fontSize: '0.78rem' }}
                value={condition.questionId}
                onChange={(e) => onChange({ ...condition, questionId: e.target.value })}
              >
                {eligible.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.text.length > 45 ? q.text.slice(0, 45) + '…' : q.text || `Pregunta (${q.id.slice(0, 4)})`}
                  </option>
                ))}
              </select>
              <select
                style={{ ...inputStyle, width: 'auto', minWidth: '140px', fontSize: '0.78rem' }}
                value={condition.operator}
                onChange={(e) => onChange({ ...condition, operator: e.target.value as Condition['operator'] })}
              >
                <option value="equals">es igual a</option>
                <option value="not_equals">es distinto de</option>
                <option value="greater_than">es mayor que</option>
                <option value="less_than">es menor que</option>
              </select>
              <input
                style={{ ...inputStyle, width: '80px', fontSize: '0.78rem' }}
                value={condition.value}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
                placeholder="valor"
              />
            </>
          )}
          <button
            className="btn-ghost"
            style={{ fontSize: '0.72rem', color: 'var(--danger)', padding: '0.2rem 0.4rem' }}
            onClick={() => onChange(null)}
          >
            Quitar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PlantillasPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore();
  const { data: templates, isLoading, refetch: reloadTemplates } = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const removeTemplate = useRemoveTemplate();
  const duplicateTemplate = useDuplicateTemplate();

  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'preview' | 'history'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<Section[]>([emptySection()]);
  const [saving, setSaving] = useState(false);
  const [changeNote, setChangeNote] = useState('');

  // Version history
  const [historyTemplateId, setHistoryTemplateId] = useState<string | null>(null);
  const [historyTemplateName, setHistoryTemplateName] = useState('');
  const { data: versionData, isLoading: versionLoading } = useVersionHistory(historyTemplateId);
  const restoreVersion = useRestoreVersion();

  // CSV Import
  const [showImport, setShowImport] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [csvDesc, setCsvDesc] = useState('');
  const [csvData, setCsvData] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // ─── Handlers ───────────────────────────────────────────────────────

  const resetForm = () => {
    setName('');
    setDescription('');
    setSections([emptySection()]);
    setEditingId(null);
    setChangeNote('');
  };

  const handleNew = () => {
    resetForm();
    setMode('create');
  };

  const handleEdit = (tpl: any) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setDescription(tpl.description || '');
    setSections(tpl.sections?.length > 0 ? tpl.sections : [emptySection()]);
    setChangeNote('');
    setMode('edit');
  };

  const handlePreview = (tpl: any) => {
    setName(tpl.name);
    setDescription(tpl.description || '');
    setSections(tpl.sections || []);
    setMode('preview');
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.warning('El nombre es requerido'); return; }
    if (sections.some((s) => !s.title.trim())) { toast.warning(t('plantillas.allSectionsNeedTitle')); return; }
    if (sections.some((s) => s.questions.some((q) => !q.text.trim()))) { toast.warning('Todas las preguntas necesitan texto'); return; }

    setSaving(true);
    try {
      const data: any = { name, description, sections };
      if (editingId && changeNote.trim()) data.changeNote = changeNote.trim();
      if (editingId) {
        await updateTemplate.mutateAsync({ id: editingId, data });
      } else {
        await createTemplate.mutateAsync(data);
      }
      resetForm();
      setMode('list');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, tplName: string) => {
    if (!confirm(`¿Eliminar la plantilla "${tplName}"?`)) return;
    try {
      await removeTemplate.mutateAsync(id);
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateTemplate.mutateAsync(id);
    } catch (err: any) {
      toast.error(err.message || 'Error al duplicar');
    }
  };

  const handleOpenHistory = (tpl: any) => {
    setHistoryTemplateId(tpl.id);
    setHistoryTemplateName(tpl.name);
    setMode('history');
  };

  const handleRestoreVersion = async (version: number) => {
    if (!historyTemplateId) return;
    if (!confirm(t('plantillas.restoreConfirm', { version }))) return;
    try {
      await restoreVersion.mutateAsync({ id: historyTemplateId, version });
    } catch (err: any) {
      toast.error(err.message || 'Error al restaurar');
    }
  };

  // ─── Section/Question builders ──────────────────────────────────────

  const updateSection = (sIdx: number, field: string, value: any) => {
    setSections((prev) => prev.map((s, i) => (i === sIdx ? { ...s, [field]: value } : s)));
  };

  const addSection = () => setSections((prev) => [...prev, emptySection()]);

  const removeSection = (sIdx: number) => {
    if (sections.length <= 1) return;
    // Collect IDs of all questions in the removed section for condition cleanup
    const removedIds = new Set(sections[sIdx].questions.map((q) => q.id));
    setSections((prev) =>
      prev
        .filter((_, i) => i !== sIdx)
        .map((s) => ({
          ...s,
          condition: s.condition && removedIds.has(s.condition.questionId) ? null : s.condition,
          questions: s.questions.map((q) =>
            q.condition && removedIds.has(q.condition.questionId) ? { ...q, condition: null } : q,
          ),
        })),
    );
  };

  const updateQuestion = (sIdx: number, qIdx: number, field: string, value: any) => {
    setSections((prev) =>
      prev.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              questions: s.questions.map((q, qi) => (qi === qIdx ? { ...q, [field]: value } : q)),
            }
          : s,
      ),
    );
  };

  const addQuestion = (sIdx: number) => {
    setSections((prev) =>
      prev.map((s, i) => (i === sIdx ? { ...s, questions: [...s.questions, emptyQuestion()] } : s)),
    );
  };

  const removeQuestion = (sIdx: number, qIdx: number) => {
    const removedId = sections[sIdx].questions[qIdx].id;
    setSections((prev) =>
      prev.map((s, si) => ({
        ...s,
        // Clean up section condition if it references the deleted question
        condition: s.condition?.questionId === removedId ? null : s.condition,
        questions: (si === sIdx ? s.questions.filter((_, qi) => qi !== qIdx) : s.questions).map((q) =>
          q.condition?.questionId === removedId ? { ...q, condition: null } : q,
        ),
      })),
    );
  };

  const changeQuestionType = (sIdx: number, qIdx: number, newType: string) => {
    const q = sections[sIdx].questions[qIdx];
    const updated: any = { ...q, type: newType };
    if (newType === 'scale' && !q.scale) {
      updated.scale = { min: 1, max: 5, labels: { ...defaultScaleLabels } };
    }
    if (newType === 'multi' && !q.options) {
      updated.options = ['Opción 1', 'Opción 2'];
    }
    updateQuestion(sIdx, qIdx, 'type', undefined); // force re-render
    setSections((prev) =>
      prev.map((s, si) =>
        si === sIdx
          ? { ...s, questions: s.questions.map((qq, qi) => (qi === qIdx ? updated : qq)) }
          : s,
      ),
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────

  // Preview mode
  if (mode === 'preview') {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
        <button className="btn-ghost" onClick={() => setMode('list')} style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}>
          &larr; Volver a plantillas
        </button>
        <div className="card" style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.25rem' }}>{name}</h1>
          {description && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>{description}</p>}
          {sections.map((sec, si) => (
            <div key={sec.id} style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--accent-hover)' }}>
                {si + 1}. {sec.title}
              </h2>
              {sec.questions.map((q, qi) => (
                <div key={q.id} style={{ marginBottom: '1.25rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    {q.text} {q.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                  </p>
                  {q.type === 'scale' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {Array.from({ length: (q.scale?.max || 5) - (q.scale?.min || 1) + 1 }, (_, i) => {
                        const val = (q.scale?.min || 1) + i;
                        return (
                          <div key={val} style={{
                            padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', fontSize: '0.8rem', textAlign: 'center',
                            color: 'var(--text-secondary)', background: 'var(--bg-surface)', minWidth: '60px',
                          }}>
                            <div style={{ fontWeight: 700 }}>{val}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{q.scale?.labels?.[String(val)] || ''}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {q.type === 'text' && (
                    <div style={{ ...inputStyle, height: '60px', opacity: 0.5 }}>Respuesta de texto...</div>
                  )}
                  {q.type === 'multi' && q.options?.map((opt, oi) => (
                    <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                      <input type="checkbox" disabled /> {opt}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // History mode
  if (mode === 'history') {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
        <button
          className="btn-ghost"
          onClick={() => { setMode('list'); setHistoryTemplateId(null); }}
          style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}
        >
          &larr; Volver a plantillas
        </button>

        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.15rem' }}>Historial de versiones</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>{historyTemplateName}</p>
        </div>

        {versionLoading ? (
          <Spinner />
        ) : !versionData ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No se pudo cargar el historial
          </div>
        ) : (
          <>
            {/* Current version card */}
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '3px solid var(--accent)', background: 'rgba(99,102,241,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="badge badge-accent" style={{ fontSize: '0.72rem', marginBottom: '0.4rem', display: 'inline-block' }}>{t('plantillas.versionCurrent')}</span>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>v{versionData.currentVersion}</div>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {versionData.totalVersions} {versionData.totalVersions !== 1 ? t('plantillas.countHistoryPlural') : t('plantillas.countHistory')}
                </span>
              </div>
            </div>

            {/* History list */}
            {versionData.history.length === 0 ? (
              <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
                  {t('plantillas.noHistory')}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {versionData.history.map((v: any) => (
                  <div key={v.version} className="card animate-fade-up" style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>v{v.version}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {new Date(v.changedAt).toLocaleString('es-ES', {
                              day: 'numeric', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {v.sectionCount} {v.sectionCount !== 1 ? t('plantillas.countSectionsPlural') : t('plantillas.countSections')} · {v.questionCount} {v.questionCount !== 1 ? t('plantillas.countQuestionsPlural') : t('plantillas.countQuestions')}
                        </div>
                        {v.changeNote && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontStyle: 'italic', marginTop: '0.4rem', paddingLeft: '0.6rem', borderLeft: '2px solid var(--border)' }}>
                            &ldquo;{v.changeNote}&rdquo;
                          </div>
                        )}
                      </div>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', whiteSpace: 'nowrap', marginLeft: '1rem' }}
                        disabled={restoreVersion.isPending}
                        onClick={() => handleRestoreVersion(v.version)}
                      >
                        {restoreVersion.isPending ? '...' : 'Restaurar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Create/Edit mode
  if (mode === 'create' || mode === 'edit') {
    const allQuestions = sections.flatMap((s) => s.questions);
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
        <button className="btn-ghost" onClick={() => { resetForm(); setMode('list'); }} style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}>
          &larr; Volver a plantillas
        </button>

        <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {editingId ? 'Editar plantilla' : 'Nueva plantilla'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Configura las secciones y preguntas del formulario de evaluación
          </p>
        </div>

        {/* Name & Description */}
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Nombre *
              </label>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Competencias de Liderazgo" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('plantillas.description')}
              </label>
              <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('plantillas.descriptionPlaceholder')} />
            </div>
          </div>
        </div>

        {/* Sections */}
        {sections.map((sec, si) => (
          <div key={sec.id} className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t('plantillas.sectionN', { n: si + 1 })}</h3>
              {sections.length > 1 && (
                <button className="btn-ghost" style={{ fontSize: '0.75rem', color: 'var(--danger)', padding: '0.2rem 0.5rem' }} onClick={() => removeSection(si)}>
                  {t('plantillas.deleteSection')}
                </button>
              )}
            </div>

            <input
              style={{ ...inputStyle, fontWeight: 600 }}
              value={sec.title}
              onChange={(e) => updateSection(si, 'title', e.target.value)}
              placeholder={t('plantillas.sectionTitle')}
            />
            <ConditionBuilder
              condition={sec.condition}
              onChange={(c) => updateSection(si, 'condition', c)}
              allQuestions={allQuestions}
            />
            <div style={{ marginBottom: '1rem' }} />

            {/* Questions */}
            {sec.questions.map((q, qi) => (
              <div key={q.id} style={{
                padding: '1rem', marginBottom: '0.75rem',
                background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    Pregunta {qi + 1}
                  </span>
                  <button className="btn-ghost" style={{ fontSize: '0.72rem', color: 'var(--danger)', padding: '0.15rem 0.4rem' }} onClick={() => removeQuestion(si, qi)}>
                    Eliminar
                  </button>
                </div>

                <textarea
                  style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', marginBottom: '0.75rem' }}
                  value={q.text}
                  onChange={(e) => updateQuestion(si, qi, 'text', e.target.value)}
                  placeholder="Texto de la pregunta *"
                />

                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    style={{ ...inputStyle, width: 'auto', minWidth: '160px' }}
                    value={q.type}
                    onChange={(e) => changeQuestionType(si, qi, e.target.value)}
                  >
                    <option value="scale">Escala (1-5)</option>
                    <option value="text">Texto libre</option>
                    <option value="multi">Opción múltiple</option>
                  </select>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => updateQuestion(si, qi, 'required', e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    Requerida
                  </label>
                </div>

                {/* Multi-choice options editor */}
                {q.type === 'multi' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>Opciones:</label>
                    {(q.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        <input
                          style={{ ...inputStyle, flex: 1 }}
                          value={opt}
                          onChange={(e) => {
                            const newOpts = [...(q.options || [])];
                            newOpts[oi] = e.target.value;
                            updateQuestion(si, qi, 'options', newOpts);
                          }}
                        />
                        <button
                          className="btn-ghost"
                          style={{ fontSize: '0.72rem', color: 'var(--danger)', padding: '0.2rem 0.4rem' }}
                          onClick={() => updateQuestion(si, qi, 'options', (q.options || []).filter((_, idx) => idx !== oi))}
                        >
                          X
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', marginTop: '0.25rem' }}
                      onClick={() => updateQuestion(si, qi, 'options', [...(q.options || []), `${t('plantillas.optionN', { n: (q.options?.length || 0) + 1 })}`])}
                    >
                      {t('plantillas.addOption')}
                    </button>
                  </div>
                )}

                {/* Condition builder */}
                <ConditionBuilder
                  condition={q.condition}
                  onChange={(c) => updateQuestion(si, qi, 'condition', c)}
                  allQuestions={allQuestions}
                  excludeId={q.id}
                />
              </div>
            ))}

            <button className="btn-ghost" style={{ fontSize: '0.82rem', marginTop: '0.5rem' }} onClick={() => addQuestion(si)}>
              + Agregar pregunta
            </button>
          </div>
        ))}

        <button className="btn-ghost" style={{ fontSize: '0.85rem', marginBottom: '1.5rem', width: '100%', padding: '0.75rem', border: '1.5px dashed var(--border)' }} onClick={addSection}>
          {t('plantillas.addSection')}
        </button>

        {/* Change note — only when editing */}
        {editingId && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Nota de cambio <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span>
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: '48px', resize: 'vertical' }}
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder={t('plantillas.changeNote')}
            />
          </div>
        )}

        {/* Save */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.65rem 1.5rem' }}>
            {saving ? t('common.loading') : editingId ? t('common.save') : 'Crear plantilla'}
          </button>
          <button className="btn-ghost" onClick={() => { resetForm(); setMode('list'); }}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ─── List mode ────────────────────────────────────────────────────

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('plantillas.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('plantillas.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowImport(!showImport)} style={{ fontSize: '0.82rem' }}>
            {'\u2B06 Importar CSV'}
          </button>
          <button className="btn-primary" onClick={handleNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('plantillas.newTemplate')}
          </button>
        </div>
      </div>

      {/* CSV Import Panel */}
      {showImport && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {'Importar Plantilla desde CSV'}
          </h3>

          {/* Help section */}
          <div style={{ padding: '1rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{'Formato del archivo CSV:'}</p>
            <p style={{ margin: '0 0 0.5rem' }}>{'El archivo debe tener 4 columnas separadas por coma. La primera fila es el encabezado:'}</p>
            <code style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
              {'seccion,pregunta,tipo,requerida\n'}
              {'Competencias T\u00e9cnicas,Domina las herramientas del cargo,scale,si\n'}
              {'Competencias T\u00e9cnicas,Se mantiene actualizado en su \u00e1rea,scale,si\n'}
              {'Habilidades Blandas,Comunicaci\u00f3n efectiva con el equipo,scale,si\n'}
              {'Comentarios,\u00bfCu\u00e1les son sus principales fortalezas?,text,si\n'}
              {'Comentarios,\u00bfEn qu\u00e9 \u00e1reas puede mejorar?,text,no'}
            </code>
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: '0 0 0.3rem' }}><strong>seccion:</strong>{' Agrupa las preguntas. Preguntas con la misma secci\u00f3n quedan juntas.'}</p>
              <p style={{ margin: '0 0 0.3rem' }}><strong>pregunta:</strong>{' Texto de la pregunta que ver\u00e1 el evaluador.'}</p>
              <p style={{ margin: '0 0 0.3rem' }}><strong>tipo:</strong>{' "scale" (escala 1-5: Deficiente a Excelente) o "text" (respuesta abierta).'}</p>
              <p style={{ margin: 0 }}><strong>requerida:</strong>{' "si" o "no". Si se omite, se asume "si".'}</p>
            </div>
          </div>

          {importError && (
            <div style={{ padding: '0.75rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.82rem' }}>
              {importError}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="text"
              placeholder="Nombre de la plantilla"
              value={csvName}
              onChange={(e) => setCsvName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder={'Descripci\u00f3n (opcional)'}
              value={csvDesc}
              onChange={(e) => setCsvDesc(e.target.value)}
              style={inputStyle}
            />
            <textarea
              placeholder={'Pega aqu\u00ed el contenido CSV (o carga un archivo abajo)'}
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
              rows={8}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="file"
                  accept=".csv,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => setCsvData(ev.target?.result as string || '');
                      reader.readAsText(file);
                    }
                  }}
                />
                <span className="btn-ghost" style={{ fontSize: '0.82rem' }}>{'\ud83d\udcc1 Cargar archivo CSV'}</span>
              </label>
              <div style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => { setShowImport(false); setImportError(''); }} style={{ fontSize: '0.82rem' }}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                disabled={importing || !csvName.trim() || !csvData.trim()}
                onClick={async () => {
                  setImporting(true);
                  setImportError('');
                  try {
                    await api.templates.importCsv(token!, { name: csvName.trim(), description: csvDesc.trim(), csvData });
                    setShowImport(false);
                    setCsvName('');
                    setCsvDesc('');
                    setCsvData('');
                    reloadTemplates();
                  } catch (err: any) {
                    setImportError(err.message || 'Error al importar CSV');
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? 'Importando...' : 'Importar plantilla'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : !templates || templates.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.3 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>{t('plantillas.noTemplates')}</p>
          <button className="btn-primary" onClick={handleNew}>Crear primera plantilla</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {templates.map((tpl: any) => {
            const totalQuestions = (tpl.sections || []).reduce((acc: number, s: any) => acc + (s.questions?.length || 0), 0);
            return (
              <div key={tpl.id} className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{tpl.name}</h3>
                  {tpl.isDefault && <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>Default</span>}
                </div>
                {tpl.description && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                    {tpl.description}
                  </p>
                )}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  {(tpl.sections || []).length} {(tpl.sections || []).length !== 1 ? t('plantillas.countSectionsPlural') : t('plantillas.countSections')} &middot; {totalQuestions} {totalQuestions !== 1 ? t('plantillas.countQuestionsPlural') : t('plantillas.countQuestions')}
                </div>

                {/* Section preview */}
                <div style={{ marginBottom: '1rem' }}>
                  {(tpl.sections || []).slice(0, 3).map((sec: any, si: number) => (
                    <div key={si} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{si + 1}.</span>
                      {sec.title} ({sec.questions?.length || 0} preguntas)
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => handlePreview(tpl)}>
                    Vista previa
                  </button>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => handleEdit(tpl)}>
                    Editar
                  </button>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => handleDuplicate(tpl.id)}>
                    Duplicar
                  </button>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => handleOpenHistory(tpl)}>
                    Historial
                  </button>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: 'var(--danger)' }} onClick={() => handleDelete(tpl.id, tpl.name)}>
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
