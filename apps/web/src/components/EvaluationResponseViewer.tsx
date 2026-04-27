'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { ScoreBadge } from './ScoreBadge';
import { useTranslation } from 'react-i18next';

/**
 * EvaluationResponseViewer — vista de solo lectura de las respuestas que un
 * evaluador dejó para un evaluado. Consume `GET /evaluations/:assignmentId`
 * que devuelve assignment + template + response (con JSONB `answers`).
 *
 * Usos:
 *   1. Desde /dashboard/evaluaciones — al clickear una fila de "Completadas"
 *      el manager/evaluador abre este viewer para releer lo que contestó.
 *   2. Desde /dashboard/mi-desempeno — el employee ve lo que los evaluadores
 *      contestaron sobre él (recibidas).
 *   3. Desde /dashboard/usuarios/[id] — pestaña "Retroalimentación": el
 *      manager ve TODAS las evaluaciones que su colaborador recibió.
 *
 * Modo: "modal" abre un overlay centrado; "inline" renderiza en flujo normal.
 */
export interface EvaluationResponseViewerProps {
  /** id del EvaluationAssignment (no del Response). El endpoint incluye response. */
  assignmentId: string | null;
  /** Callback para cerrar el modal. Requerido si mode='modal'. */
  onClose?: () => void;
  /** Modo de render. 'modal' = overlay con backdrop. 'inline' = en flujo normal. */
  mode?: 'modal' | 'inline';
}

// Labels de relación resueltos vía i18n en el componente ViewerBody.
// Fallback hardcoded si i18n no está disponible.
const RELATION_LABEL_FALLBACK: Record<string, string> = {
  self: 'Autoevaluación',
  manager: 'Jefatura',
  peer: 'Par',
  direct_report: 'Subordinado',
  external: 'Externo',
};

export default function EvaluationResponseViewer({
  assignmentId,
  onClose,
  mode = 'modal',
}: EvaluationResponseViewerProps) {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId || !token) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.evaluations
      .getDetail(token, assignmentId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || 'No se pudo cargar la evaluación');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, token]);

  // Cerrar con Escape en modo modal
  useEffect(() => {
    if (mode !== 'modal' || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, onClose]);

  if (mode === 'modal' && !assignmentId) return null;

  const inner = (
    <div
      style={{
        background: 'var(--bg-card, var(--bg-surface))',
        borderRadius: mode === 'modal' ? 'var(--radius, 12px)' : 'var(--radius-sm, 8px)',
        border: '1px solid var(--border)',
        maxWidth: mode === 'modal' ? '760px' : '100%',
        width: '100%',
        maxHeight: mode === 'modal' ? '90vh' : 'auto',
        overflow: 'auto',
        boxShadow: mode === 'modal' ? '0 20px 60px rgba(0,0,0,0.25)' : 'none',
      }}
      onClick={(e) => e.stopPropagation()}
      role={mode === 'modal' ? 'dialog' : undefined}
      aria-modal={mode === 'modal' ? true : undefined}
      aria-label="Detalle de evaluación"
    >
      <ViewerBody data={data} loading={loading} error={error} onClose={onClose} mode={mode} />
    </div>
  );

  if (mode === 'inline') return inner;

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      {inner}
    </div>
  );
}

function ViewerBody({
  data,
  loading,
  error,
  onClose,
  mode,
}: {
  data: any | null;
  loading: boolean;
  error: string | null;
  onClose?: () => void;
  mode: 'modal' | 'inline';
}) {
  const { t } = useTranslation();
  const relationLabel = (key: string) => {
    const i18nMap: Record<string, string> = {
      self: t('components.evaluationViewer.self'),
      manager: t('components.evaluationViewer.manager'),
      peer: t('components.evaluationViewer.peer'),
      direct_report: t('components.evaluationViewer.directReport'),
      external: t('components.evaluationViewer.external'),
    };
    return i18nMap[key] || RELATION_LABEL_FALLBACK[key] || key;
  };
  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <span className="spinner" />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Cargando evaluación...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--danger)', fontSize: '0.9rem', margin: 0 }}>⚠️ {error}</p>
        {onClose && (
          <button className="btn-ghost" onClick={onClose} style={{ marginTop: '1rem' }}>
            Cerrar
          </button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const { assignment, template, response } = data;
  const evaluator = assignment?.evaluator;
  const evaluatee = assignment?.evaluatee;
  const answers = (response?.answers as Record<string, any>) || {};
  const sections: any[] = Array.isArray(template?.sections)
    ? template.sections
    : typeof template?.sections === 'string'
    ? safeParse(template.sections)
    : [];

  // Anonimato peer/direct_report — el backend nulea evaluator/evaluatorId
  // en estos tipos para empleado/manager (no para admin) y cuando el caller
  // no es el propio evaluador. Render: "🔒 Anónimo".
  const isAnonymizedEvaluator =
    !evaluator &&
    (assignment?.relationType === 'peer' ||
      assignment?.relationType === 'direct_report');
  const evaluatorName = isAnonymizedEvaluator
    ? '🔒 Anónimo'
    : evaluator
    ? `${evaluator.firstName || ''} ${evaluator.lastName || ''}`.trim() || evaluator.email
    : assignment?.relationType === 'self'
    ? 'Autoevaluación'
    : '—';
  const evaluateeName = evaluatee
    ? `${evaluatee.firstName || ''} ${evaluatee.lastName || ''}`.trim() || evaluatee.email
    : '—';

  const completedAt = response?.submittedAt || assignment?.completedAt;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          position: 'sticky',
          top: 0,
          background: 'var(--bg-card, var(--bg-surface))',
          zIndex: 2,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
            Detalle de evaluación
          </div>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.25 }}>
            {evaluateeName}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.75rem', marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <span>
              <strong style={{ color: 'var(--text-secondary)' }}>{relationLabel(assignment?.relationType) || assignment?.relationType}</strong>
              {' · '}por {evaluatorName}
            </span>
            {assignment?.cycle?.name && <span>Ciclo: <strong style={{ color: 'var(--text-secondary)' }}>{assignment.cycle.name}</strong></span>}
            {completedAt && <span>Completada: {new Date(completedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
          </div>
        </div>
        {typeof response?.overallScore === 'number' && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Nota general</div>
            <ScoreBadge score={response.overallScore} size="lg" />
          </div>
        )}
        {onClose && mode === 'modal' && (
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.5rem',
              color: 'var(--text-muted)',
              padding: '0 0.3rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '1.25rem 1.5rem' }}>
        {!response && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontStyle: 'italic' }}>
            Esta evaluación aún no ha sido respondida.
          </p>
        )}

        {response && sections.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontStyle: 'italic' }}>
            No se pudo cargar la estructura del formulario. Las respuestas existen pero sin contexto
            de las preguntas.
          </p>
        )}

        {response && sections.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {sections.map((section, sIdx) => (
              <section key={section.id || sIdx}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {section.title || `Sección ${sIdx + 1}`}
                  </h3>
                  {section.description && (
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {section.description}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {(section.questions || []).map((q: any, qIdx: number) => (
                    <QuestionAnswer key={q.id || qIdx} question={q} answer={answers[q.id]} index={qIdx} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionAnswer({ question, answer, index }: { question: any; answer: any; index: number }) {
  const hasAnswer = answer !== undefined && answer !== null && answer !== '' && !(Array.isArray(answer) && answer.length === 0);

  return (
    <div
      style={{
        padding: '0.85rem 1rem',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-sm, 8px)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.6rem', lineHeight: 1.4 }}>
        {index + 1}. {question.text || question.label || 'Pregunta sin título'}
      </div>

      {!hasAnswer ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          — Sin respuesta —
        </div>
      ) : question.type === 'scale' ? (
        <ScaleAnswer value={Number(answer)} scale={question.scale} />
      ) : question.type === 'multi' ? (
        <MultiAnswer values={Array.isArray(answer) ? answer : [String(answer)]} options={question.options} />
      ) : (
        // text + cualquier otro tipo cae como texto libre
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-card, #fff)',
            padding: '0.65rem 0.8rem',
            borderRadius: 'var(--radius-sm, 6px)',
            border: '1px solid var(--border)',
            lineHeight: 1.5,
          }}
        >
          {String(answer)}
        </div>
      )}
    </div>
  );
}

function ScaleAnswer({ value, scale }: { value: number; scale?: { min?: number; max?: number; labels?: Record<string, string> } }) {
  if (!Number.isFinite(value)) {
    return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Respuesta inválida</span>;
  }
  const min = scale?.min ?? 1;
  const max = scale?.max ?? 5;
  const label = scale?.labels?.[String(value)] || null;
  const values: number[] = [];
  for (let i = min; i <= max; i++) values.push(i);

  // Color según proximidad al máximo (verde alto, rojo bajo)
  const pct = (value - min) / (max - min);
  const color = pct >= 0.75 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        {values.map((v) => {
          const selected = v === value;
          return (
            <div
              key={v}
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm, 8px)',
                border: selected ? `2px solid ${color}` : '1px solid var(--border)',
                background: selected ? color : 'transparent',
                color: selected ? '#fff' : 'var(--text-muted)',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
      {label && (
        <div style={{ fontSize: '0.75rem', color, fontWeight: 600 }}>
          → {label}
        </div>
      )}
      {!label && scale?.labels && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', maxWidth: values.length * 44 }}>
          <span>{scale.labels[String(min)] || ''}</span>
          <span>{scale.labels[String(max)] || ''}</span>
        </div>
      )}
    </div>
  );
}

function MultiAnswer({ values, options }: { values: string[]; options?: any[] }) {
  // Resolver labels de options si es posible
  const resolveLabel = (v: string): string => {
    if (!Array.isArray(options)) return v;
    const match = options.find((o: any) => {
      if (typeof o === 'string') return o === v;
      return o.value === v || o.label === v;
    });
    if (!match) return v;
    return typeof match === 'string' ? match : match.label || match.value || v;
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
            background: 'rgba(99,102,241,0.12)',
            color: '#4338ca',
            fontSize: '0.78rem',
            fontWeight: 600,
          }}
        >
          {resolveLabel(v)}
        </span>
      ))}
    </div>
  );
}

function safeParse(str: string): any[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
