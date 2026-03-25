'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  useEvaluationDetail,
  useSaveResponse,
  useSubmitResponse,
} from '@/hooks/useEvaluations';
import { ScaleLegend } from '@/components/ScoreBadge';

const relationLabels: Record<string, string> = {
  self: 'Autoevaluación',
  manager: 'Jefatura',
  peer: 'Par',
  direct_report: 'Reporte directo',
};

export default function ResponderEvaluacionPage() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.assignmentId as string;
  const cycleId = params.id as string;

  const { data: detail, isLoading, isError } = useEvaluationDetail(assignmentId);
  const saveResponse = useSaveResponse();
  const submitResponse = useSubmitResponse();

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [initialized, setInitialized] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize answers from existing response
  useEffect(() => {
    if (detail?.response && !initialized) {
      const existing =
        typeof detail.response === 'object' ? detail.response : {};
      setAnswers(existing);
      setInitialized(true);
    } else if (detail && !initialized) {
      setInitialized(true);
    }
  }, [detail, initialized]);

  // Autosave with 30s debounce
  const doSave = useCallback(() => {
    if (Object.keys(answers).length === 0) return;
    setSaveStatus('saving');
    saveResponse.mutate(
      { assignmentId, answers },
      {
        onSuccess: () => setSaveStatus('saved'),
        onError: () => setSaveStatus('idle'),
      },
    );
  }, [answers, assignmentId, saveResponse]);

  useEffect(() => {
    if (!initialized) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doSave, 30000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [answers, initialized, doSave]);

  const setAnswer = (questionId: string, value: any) => {
    setSaveStatus('idle');
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSaveDraft = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus('saving');
    saveResponse.mutate(
      { assignmentId, answers },
      {
        onSuccess: () => setSaveStatus('saved'),
        onError: () => setSaveStatus('idle'),
      },
    );
  };

  const handleSubmit = async () => {
    const confirmed = window.confirm(
      '¿Enviar esta evaluación? No podrás modificar las respuestas después de enviarla.',
    );
    if (!confirmed) return;
    try {
      await submitResponse.mutateAsync({ assignmentId, answers });
      setSubmitted(true);
      setTimeout(() => {
        router.push(`/dashboard/evaluaciones/${cycleId}`);
      }, 2000);
    } catch {
      // error available via submitResponse.error
    }
  };

  // Count questions and answered
  const template = detail?.template;
  const sections: any[] = template?.sections || [];
  const allQuestions = sections.flatMap((s: any) => s.questions || []);
  const totalQuestions = allQuestions.length;
  const answeredQuestions = allQuestions.filter(
    (q: any) => answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null,
  ).length;

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Cargando evaluaci&oacute;n...</p>
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--danger)' }}>Error al cargar la evaluaci&oacute;n.</p>
        <button
          className="btn-ghost"
          onClick={() => router.push(`/dashboard/evaluaciones/${cycleId}`)}
          style={{ marginTop: '1rem' }}
        >
          &larr; Volver al ciclo
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '700px' }}>
        <div
          className="card animate-fade-up"
          style={{ padding: '3rem', textAlign: 'center' }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(16,185,129,0.15)',
              color: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              fontSize: '1.5rem',
              fontWeight: 700,
            }}
          >
            &#10003;
          </div>
          <h2 style={{ fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.5rem' }}>
            Evaluaci&oacute;n enviada
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Tus respuestas han sido registradas exitosamente. Redirigiendo...
          </p>
        </div>
      </div>
    );
  }

  const evaluatee = detail.assignment?.evaluatee;
  const evaluateeName = evaluatee
    ? `${evaluatee.firstName || ''} ${evaluatee.lastName || ''}`.trim() ||
      evaluatee.email
    : '—';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      {/* Back */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn-ghost"
          onClick={() => router.push(`/dashboard/evaluaciones/${cycleId}`)}
          style={{ fontSize: '0.82rem', padding: '0.3rem 0.65rem' }}
        >
          &larr; Volver al ciclo
        </button>
      </div>

      {/* Assignment info header */}
      <div
        className="card animate-fade-up"
        style={{ padding: '1.5rem 1.75rem', marginBottom: '1.5rem' }}
      >
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          Evaluar a {evaluateeName}
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {detail.assignment?.cycle?.name && (
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {detail.assignment?.cycle?.name}
            </span>
          )}
          {detail.assignment?.relationType && (
            <span className="badge badge-accent">
              {relationLabels[detail.assignment?.relationType] || detail.assignment?.relationType}
            </span>
          )}
        </div>
      </div>

      {/* Progress indicator */}
      <div
        className="card animate-fade-up"
        style={{
          padding: '1rem 1.75rem',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {answeredQuestions} de {totalQuestions} preguntas respondidas
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '120px',
              height: '6px',
              borderRadius: '999px',
              background: 'var(--bg-surface)',
            }}
          >
            <div
              style={{
                width:
                  totalQuestions > 0
                    ? `${Math.round((answeredQuestions / totalQuestions) * 100)}%`
                    : '0%',
                height: '100%',
                borderRadius: '999px',
                background:
                  answeredQuestions === totalQuestions && totalQuestions > 0
                    ? 'var(--success)'
                    : 'var(--accent)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color:
                answeredQuestions === totalQuestions && totalQuestions > 0
                  ? 'var(--success)'
                  : 'var(--accent-hover)',
            }}
          >
            {totalQuestions > 0
              ? `${Math.round((answeredQuestions / totalQuestions) * 100)}%`
              : '0%'}
          </span>
        </div>
      </div>

      {/* Scale legend */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Sections + Questions */}
      {sections.map((section: any, sIdx: number) => (
        <div
          key={section.id || sIdx}
          className="card animate-fade-up"
          style={{ padding: '1.75rem', marginBottom: '1.5rem' }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            {section.title || `Sección ${sIdx + 1}`}
          </h2>
          {section.description && (
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.82rem',
                marginBottom: '1.25rem',
              }}
            >
              {section.description}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {(section.questions || []).filter((q: any) => {
              // P2-#35: Conditional logic — hide question if condition not met
              if (!q.condition) return true;
              const { questionId, operator, value } = q.condition;
              const currentAnswer = answers[questionId];
              if (currentAnswer === undefined || currentAnswer === null) return false;
              switch (operator) {
                case 'equals': return String(currentAnswer) === String(value);
                case 'not_equals': return String(currentAnswer) !== String(value);
                case 'greater_than': return Number(currentAnswer) > Number(value);
                case 'less_than': return Number(currentAnswer) < Number(value);
                case 'contains': return String(currentAnswer).includes(String(value));
                default: return true;
              }
            }).map((q: any, qIdx: number) => (
              <div key={q.id || qIdx}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '0.6rem',
                  }}
                >
                  {qIdx + 1}. {q.text}
                  {q.required && (
                    <span style={{ color: 'var(--danger)', marginLeft: '0.25rem' }}>*</span>
                  )}
                </label>

                {/* Scale type */}
                {q.type === 'scale' && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5].map((val) => {
                      const isSelected = answers[q.id] === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setAnswer(q.id, val)}
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: 'var(--radius-sm, 0.5rem)',
                            border: isSelected
                              ? '2px solid var(--accent)'
                              : '1.5px solid var(--border)',
                            background: isSelected ? 'var(--accent)' : 'transparent',
                            color: isSelected ? '#fff' : 'var(--text-secondary)',
                            fontSize: '1rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {val}
                        </button>
                      );
                    })}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        width: '100%',
                        marginTop: '0.25rem',
                      }}
                    >
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {q.minLabel || 'Muy bajo'}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {q.maxLabel || 'Excelente'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Text type */}
                {q.type === 'text' && (
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Escribe tu respuesta..."
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    style={{ resize: 'vertical', minHeight: '80px' }}
                  />
                )}

                {/* Multi (checkbox) type */}
                {q.type === 'multi' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {(q.options || []).map((opt: any, oIdx: number) => {
                      const optValue = typeof opt === 'string' ? opt : opt.value || opt.label;
                      const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                      const currentVals: string[] = Array.isArray(answers[q.id])
                        ? answers[q.id]
                        : [];
                      const isChecked = currentVals.includes(optValue);
                      return (
                        <label
                          key={oIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            padding: '0.5rem 0.75rem',
                            borderRadius: 'var(--radius-sm, 0.5rem)',
                            border: isChecked
                              ? '1.5px solid var(--accent)'
                              : '1.5px solid var(--border)',
                            background: isChecked ? 'var(--bg-surface)' : 'transparent',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const next = isChecked
                                ? currentVals.filter((v) => v !== optValue)
                                : [...currentVals, optValue];
                              setAnswer(q.id, next);
                            }}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          {optLabel}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Action buttons */}
      <div
        className="animate-fade-up"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn-ghost" onClick={handleSaveDraft}>
            Guardar borrador
          </button>
          {saveStatus === 'saving' && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Guardando...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>
              &#10003; Guardado
            </span>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={submitResponse.isPending}
          style={{ opacity: submitResponse.isPending ? 0.6 : 1 }}
        >
          {submitResponse.isPending ? 'Enviando...' : 'Enviar evaluación'}
        </button>
      </div>

      {submitResponse.isError && (
        <div
          className="animate-fade-up"
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm, 0.5rem)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          Error al enviar la evaluaci&oacute;n. Int&eacute;ntalo de nuevo.
        </div>
      )}
    </div>
  );
}
