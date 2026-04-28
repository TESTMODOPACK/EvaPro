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
  useCreateSubTemplate,
  useDeleteSubTemplate,
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
  const createSub = useCreateSubTemplate();
  const deleteSub = useDeleteSubTemplate();

  // Local state — copia editable de las subplantillas (para guardar todo
  // junto cuando el admin clica "Guardar").
  const [subs, setSubs] = useState<SubTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // Lote 2: nota de cambio (versionHistory.changeNote) opcional al save.
  const [changeNote, setChangeNote] = useState('');

  // Lote 3: estado del dropdown "+ Agregar subplantilla".
  const [showAddDropdown, setShowAddDropdown] = useState(false);

  // UX fix: secciones colapsadas (set de section ids). Default depende
  // del activeSub: si tiene >4 secciones, auto-colapsar todas excepto la
  // primera al cambiar de tab. Click en el header hace toggle.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Auto-colapsar al cargar/cambiar de tab si hay muchas secciones,
  // para que la pagina no sea tan larga. El admin puede expandir
  // las que quiera con click.
  useEffect(() => {
    const sub = subs.find((s) => s.relationType === activeTab);
    if (!sub) return;
    if (sub.sections.length > 4) {
      // Colapsar todas excepto la primera
      const toCollapse = new Set(sub.sections.slice(1).map((s) => s.id));
      setCollapsedSections(toCollapse);
    } else {
      // Pocas secciones → expandir todas
      setCollapsedSections(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, subs.length]);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const collapseAllSections = () => {
    if (!activeSub) return;
    setCollapsedSections(new Set(activeSub.sections.map((s) => s.id)));
  };

  const expandAllSections = () => {
    setCollapsedSections(new Set());
  };

  // Lote 3 revision: click-outside cierra el dropdown automaticamente.
  useEffect(() => {
    if (!showAddDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Si el click no fue en un elemento dentro del dropdown ni en el
      // boton "+ Agregar", cerrar.
      if (!target.closest('[data-add-subtemplate-dropdown]')) {
        setShowAddDropdown(false);
      }
    };
    // Delay 1 tick para evitar que el mismo click que abrio el dropdown
    // lo cierre inmediatamente.
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [showAddDropdown]);

  // Lote 3 (Pregunta 1A): roles que aún NO tienen subplantilla — los
  // que aparecen en el dropdown del tab "+ Agregar".
  const availableRolesToAdd = (Object.keys(RELATION_LABELS) as Array<keyof typeof RELATION_LABELS>)
    .filter((rel) => !subs.some((s) => s.relationType === rel));

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

  // ─── Lote 3: agregar/eliminar subplantilla ────────────────────────────────

  const handleAddSubTemplate = async (relationType: string) => {
    setShowAddDropdown(false);
    try {
      await createSub.mutateAsync({
        parentId: templateId,
        data: {
          relationType,
          sections: [],
          weight: 0, // user debe ajustar pesos despues + balancear
          isActive: true,
        },
      });
      toast.success(
        `Subplantilla "${RELATION_LABELS[relationType]?.label || relationType}" creada. Recordá ajustar los pesos para que sumen 100%.`,
      );
      await refetch();
      // Cambiar al tab nuevo
      setActiveTab(relationType);
    } catch (err: any) {
      toast.error(err?.message || 'Error al agregar subplantilla');
    }
  };

  const handleDeleteSubTemplate = async () => {
    if (!activeSub) return;
    const meta = RELATION_LABELS[activeSub.relationType];
    const label = meta?.label || activeSub.relationType;
    const totalQs = activeSub.sections.reduce((acc, s) => acc + s.questions.length, 0);
    const confirmMsg = totalQs > 0
      ? `¿Eliminar definitivamente la subplantilla "${label}"? Tiene ${totalQs} pregunta(s) configurada(s) que se perderán. Esta acción no se puede deshacer.`
      : `¿Eliminar definitivamente la subplantilla "${label}"?`;
    if (!confirm(confirmMsg)) return;

    const subIdToDelete = activeSub.id;
    try {
      await deleteSub.mutateAsync({ subId: subIdToDelete, parentId: templateId });
      toast.success(`Subplantilla "${label}" eliminada`);
      // Cambiar al primer tab restante
      const remaining = subs.filter((s) => s.id !== subIdToDelete);
      setActiveTab(remaining.length > 0 ? remaining[0].relationType : '');
      await refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Error al eliminar subplantilla');
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
    // Validar que todas las preguntas tengan texto + multi tenga ≥2 opciones
    for (const sub of subs) {
      const subLabel = RELATION_LABELS[sub.relationType]?.label || sub.relationType;
      for (const sec of sub.sections) {
        if (!sec.title?.trim()) {
          toast.warning(`En "${subLabel}" hay secciones sin título`);
          return;
        }
        for (const q of sec.questions) {
          if (!q.text?.trim()) {
            toast.warning(`En "${subLabel}" hay preguntas sin texto`);
            return;
          }
          // Lote 2: validar que tipo "multi" tenga al menos 2 opciones no vacías
          if (q.type === 'multi') {
            const validOpts = (q.options || []).filter((o) => o && o.trim().length > 0);
            if (validOpts.length < 2) {
              toast.warning(
                `En "${subLabel}" la pregunta "${q.text.slice(0, 40)}..." tipo opción múltiple debe tener al menos 2 opciones`,
              );
              return;
            }
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
          changeNote: changeNote.trim() || undefined,
        },
      });
      toast.success('Plantilla guardada exitosamente');
      setChangeNote(''); // limpiar despues del save exitoso
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

  /**
   * Cambia el tipo de pregunta inicializando los campos correspondientes
   * (scale tiene labels default, multi tiene 2 opciones default).
   * Mantiene id/text/required del original.
   */
  const changeQuestionType = (sIdx: number, qIdx: number, newType: Question['type']) => {
    if (!activeSub) return;
    const q = activeSub.sections[sIdx]?.questions[qIdx];
    if (!q) return;
    const updated: Question = { ...q, type: newType };
    if (newType === 'scale') {
      updated.scale = q.scale || {
        min: 1,
        max: 5,
        labels: { ...defaultScaleLabels },
      };
      updated.options = undefined;
    } else if (newType === 'multi') {
      updated.options = q.options && q.options.length > 0
        ? q.options
        : ['Opción 1', 'Opción 2'];
      updated.scale = undefined;
    } else {
      // text
      updated.scale = undefined;
      updated.options = undefined;
    }
    updateActiveSubSections(
      activeSub.sections.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              questions: s.questions.map((qq, qi) => (qi === qIdx ? updated : qq)),
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

      {/* Pesos (movido arriba — Lote UX) */}
      <div
        className="card"
        style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
          }}
        >
          <h3 style={{ fontWeight: 700, fontSize: '0.92rem' }}>
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
                marginBottom: '0.5rem',
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
            marginTop: '0.85rem',
            padding: '0.5rem 0.75rem',
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

        {/* Lote 3 (Pregunta 1A): tab "+ Agregar" con dropdown de roles disponibles */}
        {availableRolesToAdd.length > 0 && (
          <div
            data-add-subtemplate-dropdown
            style={{ position: 'relative', marginBottom: '-2px' }}
          >
            <button
              onClick={() => setShowAddDropdown((v) => !v)}
              title="Agregar subplantilla para otro tipo de evaluador"
              disabled={createSub.isPending}
              style={{
                padding: '0.6rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: '3px solid transparent',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
                fontWeight: 500,
                cursor: createSub.isPending ? 'wait' : 'pointer',
              }}
            >
              {createSub.isPending ? '⏳ Agregando...' : '+ Agregar'}
            </button>
            {showAddDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 10,
                  minWidth: '220px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '0.4rem 0',
                }}
              >
                <div
                  style={{
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Tipo de evaluador
                </div>
                {availableRolesToAdd.map((rel) => {
                  const meta = RELATION_LABELS[rel];
                  return (
                    <button
                      key={rel}
                      onClick={() => handleAddSubTemplate(rel)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.55rem 0.75rem',
                        background: 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        fontSize: '0.85rem',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                      title={meta.hint}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {meta.emoji} {meta.label}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {meta.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
            {/* Lote 3 (Pregunta 2B): hard delete de subplantilla con confirmacion */}
            <button
              type="button"
              onClick={handleDeleteSubTemplate}
              disabled={deleteSub.isPending}
              title="Elimina la subplantilla y todas sus preguntas (irreversible)"
              style={{
                marginLeft: '0.75rem',
                padding: '0.3rem 0.6rem',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--danger)',
                fontSize: '0.78rem',
                cursor: deleteSub.isPending ? 'wait' : 'pointer',
              }}
            >
              {deleteSub.isPending ? '⏳ Eliminando...' : '🗑 Eliminar subplantilla'}
            </button>
          </div>

          {/* Toolbar de colapsar/expandir todas las secciones — UX fix */}
          {activeSub.sections.length > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                marginBottom: '0.5rem',
              }}
            >
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={collapseAllSections}
                title="Colapsar todas las secciones para ver solo títulos"
              >
                ▶ Colapsar todas
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={expandAllSections}
                title="Expandir todas las secciones"
              >
                ▼ Expandir todas
              </button>
            </div>
          )}

          {/* Sections editor */}
          {activeSub.sections.map((sec, si) => {
            const isCollapsed = collapsedSections.has(sec.id);
            const totalQs = sec.questions?.length || 0;
            return (
            <div key={sec.id} className="card" style={{ padding: isCollapsed ? '0.85rem 1.5rem' : '1.5rem', marginBottom: '0.75rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: isCollapsed ? 0 : '1rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => toggleSection(sec.id)}
                title={isCollapsed ? 'Click para expandir' : 'Click para colapsar'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      transition: 'transform 0.15s ease',
                      display: 'inline-block',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  >
                    ▼
                  </span>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>
                    Sección {si + 1}
                    {sec.title && (
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                        : {sec.title}
                      </span>
                    )}
                  </h3>
                  {isCollapsed && (
                    <span
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--text-muted)',
                        marginLeft: '0.5rem',
                      }}
                    >
                      ({totalQs} pregunta{totalQs !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {activeSub.sections.length > 1 && (
                  <button
                    className="btn-ghost"
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--danger)',
                      padding: '0.2rem 0.5rem',
                    }}
                    onClick={(e) => {
                      e.stopPropagation(); // no togglear al borrar
                      removeSection(si);
                    }}
                  >
                    Eliminar sección
                  </button>
                )}
              </div>
              {!isCollapsed && (<>
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
                      onChange={(e) => changeQuestionType(si, qi, e.target.value as Question['type'])}
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

                  {/* Lote 2: editor de etiquetas para escala 1-5.
                      La escala es fija 1-5 (todos los reports normalizan a 0-10).
                      El admin puede personalizar las etiquetas que ve el evaluador. */}
                  {q.type === 'scale' && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginBottom: '0.4rem',
                          display: 'block',
                          fontWeight: 600,
                        }}
                      >
                        Etiquetas de la escala 1-5 (lo que verá el evaluador):
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <div
                            key={n}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                          >
                            <span
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                color: 'var(--accent)',
                                width: '20px',
                                textAlign: 'center',
                              }}
                            >
                              {n}:
                            </span>
                            <input
                              style={{ ...inputStyle, fontSize: '0.78rem' }}
                              value={q.scale?.labels?.[String(n)] ?? ''}
                              onChange={(e) => {
                                const newScale = {
                                  min: 1,
                                  max: 5,
                                  labels: {
                                    ...(q.scale?.labels || {}),
                                    [String(n)]: e.target.value,
                                  },
                                };
                                updateQuestion(si, qi, 'scale', newScale);
                              }}
                              placeholder={`Ej: ${defaultScaleLabels[String(n)]}`}
                            />
                          </div>
                        ))}
                      </div>
                      <p
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.5rem',
                          fontStyle: 'italic',
                        }}
                      >
                        Los puntajes se normalizan a 0-10 en todos los reportes
                        (radar, comparaciones, IA) para consistencia. La escala
                        1-5 es solo para la respuesta del evaluador.
                      </p>
                    </div>
                  )}

                  {/* Lote 2: editor de opciones para tipo múltiple.
                      Lista editable con +Agregar opción y X para eliminar. */}
                  {q.type === 'multi' && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginBottom: '0.4rem',
                          display: 'block',
                          fontWeight: 600,
                        }}
                      >
                        Opciones que el evaluador podrá seleccionar:
                      </label>
                      {(q.options || []).map((opt, oi) => (
                        <div
                          key={oi}
                          style={{
                            display: 'flex',
                            gap: '0.5rem',
                            marginBottom: '0.4rem',
                            alignItems: 'center',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--text-muted)',
                              minWidth: '20px',
                              textAlign: 'center',
                            }}
                          >
                            {oi + 1}.
                          </span>
                          <input
                            style={{ ...inputStyle, flex: 1, fontSize: '0.82rem' }}
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...(q.options || [])];
                              newOpts[oi] = e.target.value;
                              updateQuestion(si, qi, 'options', newOpts);
                            }}
                            placeholder={`Opción ${oi + 1}`}
                          />
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--danger)',
                              padding: '0.2rem 0.5rem',
                            }}
                            onClick={() =>
                              updateQuestion(
                                si,
                                qi,
                                'options',
                                (q.options || []).filter((_, idx) => idx !== oi),
                              )
                            }
                            title="Eliminar opción"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{
                          fontSize: '0.78rem',
                          padding: '0.3rem 0.6rem',
                          marginTop: '0.25rem',
                        }}
                        onClick={() =>
                          updateQuestion(si, qi, 'options', [
                            ...(q.options || []),
                            `Opción ${(q.options?.length || 0) + 1}`,
                          ])
                        }
                      >
                        + Agregar opción
                      </button>
                    </div>
                  )}
                </div>
              ))}

              <button
                className="btn-ghost"
                style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}
                onClick={() => addQuestion(si)}
              >
                + Agregar pregunta
              </button>
              </>)}{/* /!isCollapsed */}
            </div>
            );
          })}

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

      {/* Lote 2: nota de cambio (queda en versionHistory) */}
      <div style={{ marginBottom: '1rem' }}>
        <label
          style={{
            display: 'block',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '0.3rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Nota de cambio{' '}
          <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-muted)' }}>
            (opcional, queda en el historial de versiones)
          </span>
        </label>
        <textarea
          style={{ ...inputStyle, minHeight: '48px', resize: 'vertical' }}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder="Ej: Agregadas competencias de liderazgo, ajustados pesos para Q2 2026..."
        />
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
