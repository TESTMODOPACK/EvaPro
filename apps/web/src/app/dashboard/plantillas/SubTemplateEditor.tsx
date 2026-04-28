'use client';

/**
 * SubTemplateEditor.tsx — Fase 3 (Opción A) del plan auditoria.
 *
 * Editor de plantillas con tabs por subplantilla (uno por relationType).
 * Cada tab edita las sections/preguntas que SOLO ese rol responde.
 * Al final hay sliders de pesos con auto-balance que validan suma == 100%.
 *
 * Backwards-compat: si la plantilla no tiene subplantillas (porque es
 * legacy y no se migró), el componente muestra un mensaje "Plantilla
 * legacy - editar como antes" y delega al editor clásico.
 */

import { useState, useEffect, useMemo } from 'react';
import { useToastStore } from '@/store/toast.store';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import {
  useTemplateWithSubTemplates,
  useSaveAllSubTemplates,
} from '@/hooks/useTemplates';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'multi';
  scale?: { min: number; max: number; labels: Record<string, string> };
  options?: string[];
  required: boolean;
}

interface Section {
  id: string;
  title: string;
  competencyId?: string | null;
  description?: string;
  questions: Question[];
}

interface SubTemplate {
  id: string;
  parentTemplateId: string;
  relationType: string;
  sections: Section[];
  weight: number;
  displayOrder: number;
  isActive: boolean;
}

const RELATION_LABELS: Record<string, { label: string; emoji: string; hint: string }> = {
  self: { label: 'Auto-evaluación', emoji: '🧑', hint: 'Lo responde el propio evaluado' },
  manager: { label: 'Jefe directo', emoji: '👔', hint: 'Quien lidera al evaluado' },
  peer: { label: 'Pares', emoji: '👥', hint: 'Compañeros del mismo nivel' },
  direct_report: { label: 'Reportes directos', emoji: '👇', hint: 'Subordinados del evaluado' },
  external: { label: 'Externo', emoji: '🌐', hint: 'Cliente, proveedor, stakeholder' },
};

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

// ─── Component ──────────────────────────────────────────────────────────────

export function SubTemplateEditor({
  templateId,
  onClose,
  competencies,
}: {
  templateId: string;
  onClose: () => void;
  competencies: any[];
}) {
  const toast = useToastStore();
  const token = useAuthStore((s) => s.token);
  const { data, isLoading, refetch } = useTemplateWithSubTemplates(templateId);
  const saveAll = useSaveAllSubTemplates();

  // Local state — copia editable de las subplantillas (para guardar todo
  // junto cuando el admin clica "Guardar").
  const [subs, setSubs] = useState<SubTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // ─── IA suggestions state (Fase 3 A6 bonus) ───────────────────────────
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any | null>(null);
  const [aiApplying, setAiApplying] = useState(false);

  const handleSuggestWithAI = async () => {
    if (!token) return;
    setAiSuggesting(true);
    try {
      const result = await api.templates.suggestDistribution(token, templateId);
      setAiSuggestions(result);
      toast.success(
        `Sugerencias generadas. Revisa antes de aplicar.`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Error generando sugerencias con IA');
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleApplyAiSuggestions = async () => {
    if (!token || !aiSuggestions) return;
    if (!confirm('Aplicar las sugerencias a las subplantillas? Las preguntas se agregarán a las secciones existentes (no se sobrescriben).')) {
      return;
    }
    setAiApplying(true);
    try {
      await api.templates.applySuggestions(token, templateId, aiSuggestions.suggestions);
      toast.success('Sugerencias aplicadas');
      setAiSuggestions(null);
      await refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Error aplicando sugerencias');
    } finally {
      setAiApplying(false);
    }
  };

  // Sync state con data del backend
  useEffect(() => {
    if (data?.subTemplates) {
      const normalized = data.subTemplates.map((s: any) => ({
        ...s,
        weight: Number(s.weight) || 0,
        sections: Array.isArray(s.sections) ? s.sections : [],
      }));
      setSubs(normalized);
      if (normalized.length > 0 && !activeTab) {
        setActiveTab(normalized[0].relationType);
      }
    }
  }, [data, activeTab]);

  const activeSub = subs.find((s) => s.relationType === activeTab);
  const totalWeight = useMemo(
    () => subs.filter((s) => s.isActive).reduce((sum, s) => sum + s.weight, 0),
    [subs],
  );
  const weightOK = Math.abs(totalWeight - 1.0) < 0.001;

  // ─── State updaters ───────────────────────────────────────────────────────

  const updateActiveSubSections = (newSections: Section[]) => {
    if (!activeSub) return;
    setSubs((prev) =>
      prev.map((s) =>
        s.relationType === activeTab ? { ...s, sections: newSections } : s,
      ),
    );
  };

  const updateWeight = (relationType: string, newWeight: number) => {
    setSubs((prev) =>
      prev.map((s) =>
        s.relationType === relationType ? { ...s, weight: newWeight } : s,
      ),
    );
  };

  const autoBalance = () => {
    // Distribuye 1.0 equitativamente entre todas las subs activas
    const activeSubs = subs.filter((s) => s.isActive);
    if (activeSubs.length === 0) return;
    const equal = Math.round((1.0 / activeSubs.length) * 1000) / 1000;
    // Ajustar el último para que sume exactamente 1.0 (corrige round error)
    const adjustedLast = Math.round((1.0 - equal * (activeSubs.length - 1)) * 1000) / 1000;
    setSubs((prev) =>
      prev.map((s, idx) => {
        if (!s.isActive) return s;
        const activeIdx = activeSubs.findIndex((as) => as.id === s.id);
        if (activeIdx === activeSubs.length - 1) return { ...s, weight: adjustedLast };
        return { ...s, weight: equal };
      }),
    );
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  // Fase 3 opcion B: usa el endpoint atomico save-all que actualiza todas
  // las subs + pesos en UNA sola transaccion + hace UN snapshot en
  // versionHistory. Reemplaza N llamadas separadas (que generaban N
  // versiones).

  const handleSave = async () => {
    if (!weightOK) {
      toast.warning(`Los pesos deben sumar 100%. Actual: ${(totalWeight * 100).toFixed(1)}%`);
      return;
    }
    // Validar que todas las preguntas tengan texto
    for (const sub of subs) {
      for (const sec of sub.sections) {
        if (!sec.title?.trim()) {
          toast.warning(`En "${RELATION_LABELS[sub.relationType]?.label || sub.relationType}" hay secciones sin título`);
          return;
        }
        for (const q of sec.questions) {
          if (!q.text?.trim()) {
            toast.warning(`En "${RELATION_LABELS[sub.relationType]?.label || sub.relationType}" hay preguntas sin texto`);
            return;
          }
        }
      }
    }

    setSaving(true);
    try {
      await saveAll.mutateAsync({
        parentId: templateId,
        data: {
          subTemplates: subs.map((s) => ({
            id: s.id,
            sections: s.sections,
            weight: s.weight,
            isActive: s.isActive,
            displayOrder: s.displayOrder,
          })),
          // changeNote opcional — Lote 2 agregará un input UI para esto.
        },
      });
      toast.success('Plantilla guardada exitosamente');
      await refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // ─── Section/Question editors ───────────────────────────────────────────

  const addSection = () => {
    if (!activeSub) return;
    updateActiveSubSections([...activeSub.sections, emptySection()]);
  };
  const removeSection = (sIdx: number) => {
    if (!activeSub) return;
    if (activeSub.sections.length <= 1) return;
    updateActiveSubSections(activeSub.sections.filter((_, i) => i !== sIdx));
  };
  const updateSection = (sIdx: number, field: string, value: any) => {
    if (!activeSub) return;
    updateActiveSubSections(
      activeSub.sections.map((s, i) => (i === sIdx ? { ...s, [field]: value } : s)),
    );
  };
  const addQuestion = (sIdx: number) => {
    if (!activeSub) return;
    updateActiveSubSections(
      activeSub.sections.map((s, i) =>
        i === sIdx ? { ...s, questions: [...s.questions, emptyQuestion()] } : s,
      ),
    );
  };
  const removeQuestion = (sIdx: number, qIdx: number) => {
    if (!activeSub) return;
    updateActiveSubSections(
      activeSub.sections.map((s, i) =>
        i === sIdx
          ? { ...s, questions: s.questions.filter((_, qi) => qi !== qIdx) }
          : s,
      ),
    );
  };
  const updateQuestion = (sIdx: number, qIdx: number, field: string, value: any) => {
    if (!activeSub) return;
    updateActiveSubSections(
      activeSub.sections.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              questions: s.questions.map((q, qi) =>
                qi === qIdx ? { ...q, [field]: value } : q,
              ),
            }
          : s,
      ),
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Cargando plantilla...
      </div>
    );
  }

  if (!data?.template) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--danger)' }}>
        No se pudo cargar la plantilla.
      </div>
    );
  }

  // Caso especial: plantilla legacy sin subplantillas (no migrable —
  // sin applicableTo y sin defaultCycleType). Mostrar mensaje.
  if (subs.length === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: '700px' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Esta plantilla no tiene subplantillas configuradas.
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Es una plantilla en formato legacy sin restricciones por rol. Para
            usar el modelo de subplantillas con pesos por evaluador, edítala
            con el editor clásico y agrega <code>applicableTo</code> a cada
            pregunta — luego al volver a abrirla aquí se migrarán
            automáticamente.
          </p>
          <button className="btn-ghost" onClick={onClose}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <button
        className="btn-ghost"
        onClick={onClose}
        style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}
      >
        &larr; Volver a plantillas
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            Editar plantilla: {data.template.name}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Cada tab corresponde a una subplantilla — un set de preguntas que
            ese tipo de evaluador responde. Los pesos al final controlan cómo
            se combinan los puntajes en el score final.
          </p>
        </div>
        <button
          className="btn-ghost"
          onClick={handleSuggestWithAI}
          disabled={aiSuggesting}
          style={{
            fontSize: '0.85rem',
            whiteSpace: 'nowrap',
            border: '1.5px solid var(--accent)',
            color: 'var(--accent-hover)',
            padding: '0.5rem 1rem',
          }}
        >
          {aiSuggesting ? '✨ Pensando...' : '✨ Sugerir distribución con IA'}
        </button>
      </div>

      {/* IA Suggestions preview dialog */}
      {aiSuggestions && (
        <div
          className="card animate-fade-up"
          style={{
            padding: '1.5rem',
            marginBottom: '1.5rem',
            borderLeft: '4px solid var(--accent)',
            background: 'rgba(99,102,241,0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                ✨ Sugerencias de IA — {aiSuggestions.cycleType}°
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Revisa las sugerencias antes de aplicar. Las preguntas se
                AGREGAN (no sobrescriben) a las secciones existentes.
              </p>
            </div>
            <button
              className="btn-ghost"
              style={{ fontSize: '0.78rem' }}
              onClick={() => setAiSuggestions(null)}
            >
              Descartar
            </button>
          </div>

          {Object.entries(aiSuggestions.suggestions || {}).map(([rel, items]: [string, any]) => (
            <div key={rel} style={{ marginBottom: '1rem' }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  marginBottom: '0.4rem',
                  color: 'var(--accent-hover)',
                }}
              >
                {RELATION_LABELS[rel]?.emoji || '📋'} {RELATION_LABELS[rel]?.label || rel} —{' '}
                {Array.isArray(items) ? items.length : 0} competencias sugeridas
              </div>
              <div style={{ paddingLeft: '1rem', fontSize: '0.78rem' }}>
                {Array.isArray(items) && items.map((item: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: '0.5rem', borderLeft: '2px solid var(--border)', paddingLeft: '0.6rem' }}>
                    <div style={{ fontWeight: 600 }}>{item.competencyName}</div>
                    {item.perspective && (
                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.2rem' }}>
                        {item.perspective}
                      </div>
                    )}
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)' }}>
                      {(item.suggestedQuestions || []).map((q: string, qi: number) => (
                        <li key={qi}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              className="btn-primary"
              onClick={handleApplyAiSuggestions}
              disabled={aiApplying}
            >
              {aiApplying ? 'Aplicando...' : 'Aplicar sugerencias'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => setAiSuggestions(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1rem',
          borderBottom: '2px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        {subs.map((sub) => {
          const meta = RELATION_LABELS[sub.relationType] || {
            label: sub.relationType,
            emoji: '📋',
            hint: '',
          };
          const totalQs = sub.sections.reduce(
            (acc, s) => acc + (s.questions?.length || 0),
            0,
          );
          const isActiveTab = sub.relationType === activeTab;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveTab(sub.relationType)}
              title={meta.hint}
              style={{
                padding: '0.6rem 1rem',
                background: isActiveTab ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                borderBottom: isActiveTab
                  ? '3px solid var(--accent)'
                  : '3px solid transparent',
                color: isActiveTab ? 'var(--accent-hover)' : 'var(--text-secondary)',
                fontSize: '0.85rem',
                fontWeight: isActiveTab ? 700 : 500,
                cursor: 'pointer',
                marginBottom: '-2px',
                opacity: sub.isActive ? 1 : 0.5,
              }}
            >
              {meta.emoji} {meta.label}
              <span
                style={{
                  marginLeft: '0.4rem',
                  fontSize: '0.72rem',
                  color: 'var(--text-muted)',
                  fontWeight: 400,
                }}
              >
                ({totalQs})
              </span>
              {!sub.isActive && (
                <span style={{ fontSize: '0.65rem', marginLeft: '0.3rem' }}>
                  inactiva
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Contenido del tab activo */}
      {activeSub && (
        <div>
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'rgba(99,102,241,0.05)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <strong>
                {RELATION_LABELS[activeSub.relationType]?.label || activeSub.relationType}
              </strong>{' '}
              · Peso: {(activeSub.weight * 100).toFixed(1)}% · {activeSub.sections.length} secciones · {activeSub.sections.reduce((a, s) => a + s.questions.length, 0)} preguntas
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={activeSub.isActive}
                onChange={(e) =>
                  setSubs((prev) =>
                    prev.map((s) =>
                      s.relationType === activeTab
                        ? {
                            ...s,
                            isActive: e.target.checked,
                            // Si se desactiva, peso → 0 (sino el total no
                            // suma 100% y bloquea el guardado).
                            // Si se reactiva, dejarle mantener su peso anterior.
                            weight: e.target.checked ? s.weight : 0,
                          }
                        : s,
                    ),
                  )
                }
                style={{ accentColor: 'var(--accent)' }}
              />
              Subplantilla activa
            </label>
          </div>

          {/* Sections editor */}
          {activeSub.sections.map((sec, si) => (
            <div key={sec.id} className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Sección {si + 1}</h3>
                {activeSub.sections.length > 1 && (
                  <button
                    className="btn-ghost"
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--danger)',
                      padding: '0.2rem 0.5rem',
                    }}
                    onClick={() => removeSection(si)}
                  >
                    Eliminar sección
                  </button>
                )}
              </div>

              {/* Section title — competency picker or custom */}
              {(() => {
                const isCustom = !sec.competencyId;
                const selectValue = sec.competencyId || (sec.title || isCustom ? '__custom__' : '');
                return (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                    <select
                      style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
                      value={selectValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__custom__') {
                          updateSection(si, 'competencyId', undefined);
                          updateSection(si, 'title', sec.title || '');
                        } else if (val) {
                          const comp = competencies.find((c: any) => c.id === val);
                          if (comp) {
                            updateSection(si, 'competencyId', comp.id);
                            updateSection(si, 'title', comp.name);
                          }
                        } else {
                          updateSection(si, 'competencyId', undefined);
                          updateSection(si, 'title', '');
                        }
                      }}
                    >
                      <option value="">— Seleccionar competencia —</option>
                      {competencies.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.category || 'General'})
                        </option>
                      ))}
                      <option value="__custom__">— Sección personalizada (texto libre) —</option>
                    </select>
                    {isCustom && (
                      <input
                        style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
                        value={sec.title}
                        onChange={(e) => updateSection(si, 'title', e.target.value)}
                        placeholder="Nombre de la sección personalizada"
                      />
                    )}
                  </div>
                );
              })()}

              {/* Questions */}
              {sec.questions.map((q, qi) => (
                <div
                  key={q.id}
                  style={{
                    padding: '1rem',
                    marginBottom: '0.75rem',
                    background: 'var(--bg-base)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Pregunta {qi + 1}
                    </span>
                    <button
                      className="btn-ghost"
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--danger)',
                        padding: '0.15rem 0.4rem',
                      }}
                      onClick={() => removeQuestion(si, qi)}
                    >
                      Eliminar
                    </button>
                  </div>

                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: '50px',
                      resize: 'vertical',
                      marginBottom: '0.75rem',
                    }}
                    value={q.text}
                    onChange={(e) => updateQuestion(si, qi, 'text', e.target.value)}
                    placeholder="Texto de la pregunta *"
                  />

                  <div
                    style={{
                      display: 'flex',
                      gap: '0.75rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <select
                      style={{ ...inputStyle, width: 'auto', minWidth: '160px' }}
                      value={q.type}
                      onChange={(e) => updateQuestion(si, qi, 'type', e.target.value)}
                    >
                      <option value="scale">Escala (1-5)</option>
                      <option value="text">Texto libre</option>
                      <option value="multi">Opción múltiple</option>
                    </select>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={(e) => updateQuestion(si, qi, 'required', e.target.checked)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      Requerida
                    </label>
                  </div>
                </div>
              ))}

              <button
                className="btn-ghost"
                style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}
                onClick={() => addQuestion(si)}
              >
                + Agregar pregunta
              </button>
            </div>
          ))}

          <button
            className="btn-ghost"
            style={{
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              width: '100%',
              padding: '0.75rem',
              border: '1.5px dashed var(--border)',
            }}
            onClick={addSection}
          >
            + Agregar sección
          </button>
        </div>
      )}

      {/* Pesos */}
      <div
        className="card"
        style={{ padding: '1.5rem', marginTop: '2rem', marginBottom: '1.5rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            ⚖ Peso de cada perspectiva en el score final
          </h3>
          <button
            className="btn-ghost"
            style={{ fontSize: '0.78rem' }}
            onClick={autoBalance}
          >
            Balancear equitativamente
          </button>
        </div>

        {subs.map((sub) => {
          const meta = RELATION_LABELS[sub.relationType] || {
            label: sub.relationType,
            emoji: '📋',
            hint: '',
          };
          return (
            <div
              key={sub.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '0.6rem',
                opacity: sub.isActive ? 1 : 0.5,
              }}
            >
              <div style={{ width: '180px', fontSize: '0.85rem' }}>
                {meta.emoji} {meta.label}
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sub.weight}
                onChange={(e) => updateWeight(sub.relationType, parseFloat(e.target.value))}
                disabled={!sub.isActive}
                style={{
                  flex: 1,
                  accentColor: 'var(--accent)',
                  cursor: sub.isActive ? 'pointer' : 'not-allowed',
                }}
              />
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Math.round(sub.weight * 100)}
                onChange={(e) =>
                  updateWeight(sub.relationType, parseInt(e.target.value) / 100)
                }
                disabled={!sub.isActive}
                style={{
                  ...inputStyle,
                  width: '80px',
                  textAlign: 'center',
                  fontWeight: 600,
                }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>%</span>
            </div>
          );
        })}

        <div
          style={{
            marginTop: '1rem',
            padding: '0.6rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            background: weightOK ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: weightOK ? 'var(--success)' : 'var(--danger)',
            fontSize: '0.85rem',
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Total: {(totalWeight * 100).toFixed(1)}%{' '}
          {weightOK ? '✅' : '⚠️ Debe ser 100%'}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !weightOK}
          style={{ padding: '0.65rem 1.5rem' }}
        >
          {saving ? 'Guardando...' : 'Guardar plantilla'}
        </button>
        <button className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
