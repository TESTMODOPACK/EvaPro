'use client';

/**
 * TemplatePreview.tsx — Lote 3 Fase 3 (Opción A).
 *
 * Vista previa READ-ONLY de una plantilla con tabs por subplantilla,
 * renderizada como la vería un evaluador real. NO permite editar
 * (no hay controles de guardar, ni inputs editables).
 *
 * Sirve para que el admin valide cómo se ve el formulario antes de
 * lanzar el ciclo. Se accede desde:
 *   - Botón "Vista previa" en la lista de plantillas
 *   - Botón "Ver plantilla" en el detalle del ciclo
 *   - Query param ?preview=ID en /dashboard/plantillas
 */

import { useState, useEffect } from 'react';
import { useTemplateWithSubTemplates } from '@/hooks/useTemplates';

interface Question {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'multi';
  scale?: { min?: number; max?: number; labels?: Record<string, string> };
  options?: string[];
  required?: boolean;
}

interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

interface SubTemplate {
  id: string;
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

export function TemplatePreview({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useTemplateWithSubTemplates(templateId);
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    if (data?.subTemplates && data.subTemplates.length > 0 && !activeTab) {
      setActiveTab(data.subTemplates[0].relationType);
    }
  }, [data, activeTab]);

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

  const subs = (data.subTemplates as unknown as SubTemplate[]) || [];

  // Si la plantilla no tiene subplantillas, mostrar mensaje claro
  if (subs.length === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: '700px' }}>
        <button
          className="btn-ghost"
          onClick={onClose}
          style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}
        >
          &larr; Volver a plantillas
        </button>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Esta plantilla no tiene subplantillas configuradas.
          </p>
          <p
            style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
          >
            Es una plantilla en formato legacy. Editela para configurar
            subplantillas por rol.
          </p>
        </div>
      </div>
    );
  }

  const activeSub = subs.find((s) => s.relationType === activeTab);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <button
        className="btn-ghost"
        onClick={onClose}
        style={{ marginBottom: '1.5rem', fontSize: '0.82rem' }}
      >
        &larr; Volver
      </button>

      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            background: 'rgba(99,102,241,0.12)',
            color: 'var(--accent-hover)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginBottom: '0.5rem',
          }}
        >
          👁 Vista previa
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {data.template.name}
        </h1>
        {data.template.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {data.template.description}
          </p>
        )}
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            marginTop: '0.4rem',
            fontStyle: 'italic',
          }}
        >
          Esta es la vista que verá cada evaluador según su rol. Las respuestas
          NO se guardan — solo es preview.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1.25rem',
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
          const totalQs = (sub.sections || []).reduce(
            (acc, s) => acc + (s.questions?.length || 0),
            0,
          );
          const isActiveTab = sub.relationType === activeTab;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveTab(sub.relationType)}
              title={meta.hint}
              disabled={!sub.isActive}
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
                cursor: sub.isActive ? 'pointer' : 'not-allowed',
                marginBottom: '-2px',
                opacity: sub.isActive ? 1 : 0.4,
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

      {/* Active tab content - render como evaluador */}
      {activeSub && (
        <>
          <div
            style={{
              padding: '0.85rem 1rem',
              background: 'rgba(99,102,241,0.05)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
            }}
          >
            <strong>
              {RELATION_LABELS[activeSub.relationType]?.label || activeSub.relationType}
            </strong>{' '}
            · Peso en score: {(activeSub.weight * 100).toFixed(1)}% ·{' '}
            {activeSub.sections.length} secciones ·{' '}
            {activeSub.sections.reduce((a, s) => a + (s.questions?.length || 0), 0)}{' '}
            preguntas
          </div>

          {(activeSub.sections || []).length === 0 && (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}
            >
              Esta subplantilla aún no tiene preguntas configuradas.
            </div>
          )}

          {(activeSub.sections || []).map((sec, si) => (
            <div
              key={sec.id || si}
              className="card"
              style={{ padding: '1.5rem', marginBottom: '1rem' }}
            >
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  marginBottom: '0.25rem',
                  color: 'var(--accent-hover)',
                }}
              >
                {si + 1}. {sec.title || `Sección ${si + 1}`}
              </h2>
              {sec.description && (
                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-muted)',
                    marginBottom: '1rem',
                  }}
                >
                  {sec.description}
                </p>
              )}

              {(sec.questions || []).map((q, qi) => (
                <div
                  key={q.id || qi}
                  style={{
                    padding: '1rem 0',
                    borderTop:
                      qi > 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <p
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      marginBottom: '0.6rem',
                    }}
                  >
                    {qi + 1}. {q.text}
                    {q.required && (
                      <span style={{ color: 'var(--danger)', marginLeft: '0.25rem' }}>*</span>
                    )}
                  </p>

                  {/* Scale 1-5 disabled */}
                  {q.type === 'scale' && (
                    <div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        {[1, 2, 3, 4, 5].map((val) => (
                          <button
                            key={val}
                            disabled
                            style={{
                              width: '50px',
                              height: '50px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1.5px solid var(--border)',
                              background: 'var(--bg-surface)',
                              color: 'var(--text-secondary)',
                              fontSize: '1rem',
                              fontWeight: 700,
                              cursor: 'not-allowed',
                              opacity: 0.6,
                            }}
                            title={q.scale?.labels?.[String(val)] || ''}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          maxWidth: '300px',
                          marginTop: '0.3rem',
                        }}
                      >
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {q.scale?.labels?.['1'] || 'Deficiente'}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {q.scale?.labels?.['5'] || 'Excelente'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Text disabled */}
                  {q.type === 'text' && (
                    <textarea
                      disabled
                      rows={3}
                      placeholder="(Respuesta de texto del evaluador)"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        background: 'var(--bg-surface)',
                        border: '1.5px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-muted)',
                        fontSize: '0.85rem',
                        opacity: 0.6,
                        resize: 'vertical',
                        cursor: 'not-allowed',
                      }}
                    />
                  )}

                  {/* Multi disabled */}
                  {q.type === 'multi' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {(q.options || []).length === 0 && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                          ⚠️ Esta pregunta múltiple no tiene opciones configuradas.
                        </span>
                      )}
                      {(q.options || []).map((opt, oi) => (
                        <label
                          key={oi}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            padding: '0.5rem 0.75rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1.5px solid var(--border)',
                            fontSize: '0.85rem',
                            color: 'var(--text-muted)',
                            opacity: 0.7,
                            cursor: 'not-allowed',
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
