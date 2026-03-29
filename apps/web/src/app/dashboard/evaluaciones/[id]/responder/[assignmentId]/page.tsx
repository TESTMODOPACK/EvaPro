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

// ─── Confirm Modal ────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  isOpen: boolean;
  answeredCount: number;
  totalCount: number;
  missingRequired: number;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function ConfirmModal({ isOpen, answeredCount, totalCount, missingRequired, onConfirm, onCancel, isSubmitting }: ConfirmModalProps) {
  if (!isOpen) return null;

  const pct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        className="card animate-fade-up"
        style={{ maxWidth: '460px', width: '100%', padding: '2rem', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div style={{
          width: '52px', height: '52px', borderRadius: '50%',
          background: missingRequired > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1.25rem',
        }}>
          {missingRequired > 0 ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          )}
        </div>

        <h2 style={{ textAlign: 'center', fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {missingRequired > 0 ? 'Preguntas obligatorias sin responder' : 'Enviar evaluación'}
        </h2>

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          {missingRequired > 0
            ? `Tienes ${missingRequired} pregunta${missingRequired > 1 ? 's' : ''} obligatoria${missingRequired > 1 ? 's' : ''} sin responder. ¿Deseas enviar de todas formas?`
            : 'Una vez enviada, no podrás modificar tus respuestas. ¿Confirmas el envío?'
          }
        </p>

        {/* Progress summary */}
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', padding: '1rem',
          marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span>Preguntas respondidas</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? 'var(--success)' : 'var(--accent)' }}>
              {answeredCount} / {totalCount} ({pct}%)
            </span>
          </div>
          <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: '999px',
              background: pct === 100 ? 'var(--success)' : 'var(--accent)',
              transition: 'width 0.3s ease',
            }}/>
          </div>
          {missingRequired > 0 && (
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--danger)', fontWeight: 600 }}>
              ⚠ {missingRequired} pregunta{missingRequired > 1 ? 's' : ''} obligatoria{missingRequired > 1 ? 's' : ''} sin responder
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={onCancel} disabled={isSubmitting}>
            Volver a revisar
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1, opacity: isSubmitting ? 0.7 : 1 }}
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Enviando...' : 'Confirmar envío'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Save Status Bar ──────────────────────────────────────────────────────────

function SaveBar({ status, onSave }: { status: 'idle' | 'saving' | 'saved' | 'error'; onSave: () => void }) {
  return (
    <div style={{
      position: 'sticky', top: '56px', zIndex: 50,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      padding: '0.5rem 1.75rem',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
        {status === 'saving' && (
          <>
            <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}/>
            <span style={{ color: 'var(--text-muted)' }}>Guardando borrador...</span>
          </>
        )}
        {status === 'saved' && (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>Borrador guardado</span>
          </>
        )}
        {status === 'error' && (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Error al guardar</span>
          </>
        )}
        {status === 'idle' && (
          <span style={{ color: 'var(--text-muted)' }}>Se guarda automáticamente cada 30s · <kbd style={{ fontSize: '0.72rem', background: 'var(--border)', borderRadius: '4px', padding: '1px 5px' }}>Ctrl+S</kbd> para guardar ahora</span>
        )}
      </div>
      <button
        className="btn-ghost"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
        onClick={onSave}
        disabled={status === 'saving'}
      >
        Guardar borrador
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initialize from existing response ─────────────────────────────────────

  useEffect(() => {
    if (detail?.response && !initialized) {
      const existing = typeof detail.response === 'object' ? detail.response : {};
      setAnswers(existing);
      setInitialized(true);
    } else if (detail && !initialized) {
      setInitialized(true);
    }
  }, [detail, initialized]);

  // ── Save logic ────────────────────────────────────────────────────────────

  const doSave = useCallback(() => {
    if (Object.keys(answers).length === 0) return;
    setSaveStatus('saving');
    setHasUnsaved(false);
    saveResponse.mutate(
      { assignmentId, answers },
      {
        onSuccess: () => setSaveStatus('saved'),
        onError: () => { setSaveStatus('error'); setHasUnsaved(true); },
      },
    );
  }, [answers, assignmentId, saveResponse]);

  // Auto-save debounce (30s)
  useEffect(() => {
    if (!initialized) return;
    setHasUnsaved(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doSave, 30_000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [answers, initialized, doSave]);

  // Ctrl+S — manual save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doSave]);

  // beforeunload — warn about unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = 'Tienes cambios sin guardar. ¿Seguro que quieres salir?';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  // ── Answers ───────────────────────────────────────────────────────────────

  const setAnswer = (questionId: string, value: any) => {
    setSaveStatus('idle');
    setHasUnsaved(true);
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  // ── Conditional logic ─────────────────────────────────────────────────────

  const evalCondition = (condition: any): boolean => {
    if (!condition) return true;
    const { questionId, operator, value } = condition;
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
  };

  const isQuestionVisible = (q: any) => evalCondition(q.condition);
  const isSectionVisible = (sec: any) => evalCondition(sec.condition);

  // ── Progress counters ─────────────────────────────────────────────────────

  const template = detail?.template;
  const sections: any[] = template?.sections || [];
  const visibleSections = sections.filter(isSectionVisible);
  const allQuestions = visibleSections.flatMap((s: any) => s.questions || []);
  const visibleQuestions = allQuestions.filter(isQuestionVisible);
  const totalQuestions = visibleQuestions.length;
  const answeredQuestions = visibleQuestions.filter(
    (q: any) => answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null,
  ).length;
  const requiredUnanswered = visibleQuestions.filter(
    (q: any) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || answers[q.id] === null),
  ).length;

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSaveDraft = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave();
  };

  const handleSubmitClick = () => {
    // Save draft first, then open confirm modal
    if (hasUnsaved) doSave();
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    // Only submit answers for currently visible questions (conditional logic)
    const visibleIds = new Set(visibleQuestions.map((q: any) => q.id));
    const filteredAnswers = Object.fromEntries(
      Object.entries(answers).filter(([id]) => visibleIds.has(id)),
    );
    try {
      await submitResponse.mutateAsync({ assignmentId, answers: filteredAnswers });
      setHasUnsaved(false);
      setSubmitted(true);
      setTimeout(() => router.push(`/dashboard/evaluaciones/${cycleId}`), 2200);
    } catch {
      setShowConfirm(false);
    }
  };

  // ── Loading / Error states ────────────────────────────────────────────────

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
        <button className="btn-ghost" onClick={() => router.push(`/dashboard/evaluaciones/${cycleId}`)} style={{ marginTop: '1rem' }}>
          &larr; Volver al ciclo
        </button>
      </div>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '700px' }}>
        <div className="card animate-fade-up" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(16,185,129,0.12)', color: 'var(--success)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.25rem', fontSize: '1.75rem',
          }}>
            ✓
          </div>
          <h2 style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.5rem' }}>
            ¡Evaluaci&oacute;n enviada!
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Tus respuestas han sido registradas exitosamente.<br/>Redirigiendo al ciclo...
          </p>
          <div style={{ height: '4px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--success)', borderRadius: '999px', animation: 'progress-fill 2.2s linear forwards' }}/>
          </div>
          <style>{`@keyframes progress-fill { from { width: 0 } to { width: 100% } }`}</style>
        </div>
      </div>
    );
  }

  const evaluatee = detail.assignment?.evaluatee;
  const evaluateeName = evaluatee
    ? `${evaluatee.firstName || ''} ${evaluatee.lastName || ''}`.trim() || evaluatee.email
    : '—';
  const pct = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;

  return (
    <>
      {/* Confirm Submit Modal */}
      <ConfirmModal
        isOpen={showConfirm}
        answeredCount={answeredQuestions}
        totalCount={totalQuestions}
        missingRequired={requiredUnanswered}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
        isSubmitting={submitResponse.isPending}
      />

      {/* Sticky Save Bar */}
      <SaveBar status={saveStatus} onSave={handleSaveDraft} />

      <div style={{ padding: '1.5rem 2.5rem', maxWidth: '820px' }}>

        {/* Back */}
        <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
          <button
            className="btn-ghost"
            onClick={() => {
              if (hasUnsaved && !window.confirm('Tienes cambios sin guardar. ¿Salir de todas formas?')) return;
              router.push(`/dashboard/evaluaciones/${cycleId}`);
            }}
            style={{ fontSize: '0.82rem', padding: '0.3rem 0.65rem' }}
          >
            &larr; Volver al ciclo
          </button>
        </div>

        {/* Assignment header */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem 1.75rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.4rem' }}>
                Evaluar a {evaluateeName}
              </h1>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {detail.assignment?.cycle?.name && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {detail.assignment.cycle.name}
                  </span>
                )}
                {detail.assignment?.relationType && (
                  <span className="badge badge-accent">
                    {relationLabels[detail.assignment.relationType] || detail.assignment.relationType}
                  </span>
                )}
              </div>
            </div>

            {/* Inline progress ring */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <svg width="52" height="52" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="22" fill="none" stroke="var(--border)" strokeWidth="4"/>
                <circle
                  cx="26" cy="26" r="22" fill="none"
                  stroke={pct === 100 ? 'var(--success)' : 'var(--accent)'}
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 22}`}
                  strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 26 26)"
                  style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                />
                <text x="26" y="30" textAnchor="middle" fontSize="11" fontWeight="700"
                  fill={pct === 100 ? 'var(--success)' : 'var(--accent)'}>
                  {pct}%
                </text>
              </svg>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{answeredQuestions}/{totalQuestions}</div>
                respondidas
              </div>
            </div>
          </div>
        </div>

        {/* Scale legend */}
        <div className="animate-fade-up" style={{ marginBottom: '1.25rem' }}>
          <ScaleLegend />
        </div>

        {/* Submit error */}
        {submitResponse.isError && (
          <div className="animate-fade-up" style={{
            padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)',
            border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem',
          }}>
            Error al enviar la evaluaci&oacute;n. Int&eacute;ntalo de nuevo.
          </div>
        )}

        {/* Sections */}
        {visibleSections.map((section: any, sIdx: number) => (
          <div key={section.id || sIdx} className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.2rem' }}>
              {section.title || `Sección ${sIdx + 1}`}
            </h2>
            {section.description && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                {section.description}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {(section.questions || []).filter(isQuestionVisible).map((q: any, qIdx: number) => {
                const isAnswered = answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null;
                const isMissingRequired = q.required && !isAnswered;
                return (
                  <div key={q.id || qIdx} style={{
                    padding: '1rem 1.25rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isMissingRequired ? 'rgba(239,68,68,0.03)' : 'transparent',
                    border: isMissingRequired ? '1px dashed rgba(239,68,68,0.3)' : '1px solid transparent',
                    transition: 'all 0.2s ease',
                  }}>
                    <label style={{
                      display: 'block', fontSize: '0.875rem', fontWeight: 600,
                      color: 'var(--text-primary)', marginBottom: '0.75rem',
                    }}>
                      {qIdx + 1}. {q.text}
                      {q.required && <span style={{ color: 'var(--danger)', marginLeft: '0.3rem' }}>*</span>}
                      {isAnswered && !isMissingRequired && (
                        <svg style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </label>

                    {/* Scale */}
                    {q.type === 'scale' && (
                      <div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {[1, 2, 3, 4, 5].map((val) => {
                            const isSelected = answers[q.id] === val;
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setAnswer(q.id, val)}
                                style={{
                                  width: '50px', height: '50px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: isSelected ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                                  background: isSelected ? 'var(--accent)' : 'transparent',
                                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                                  fontSize: '1rem', fontWeight: 700,
                                  cursor: 'pointer', transition: 'all 0.15s ease',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  transform: isSelected ? 'scale(1.08)' : 'scale(1)',
                                }}
                              >
                                {val}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', maxWidth: '280px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {q.scale?.labels?.[1] || 'Deficiente'}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {q.scale?.labels?.[5] || 'Excelente'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Text */}
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

                    {/* Multi */}
                    {q.type === 'multi' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(q.options || []).map((opt: any, oIdx: number) => {
                          const optValue = typeof opt === 'string' ? opt : opt.value || opt.label;
                          const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                          const currentVals: string[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];
                          const isChecked = currentVals.includes(optValue);
                          return (
                            <label key={oIdx} style={{
                              display: 'flex', alignItems: 'center', gap: '0.6rem',
                              padding: '0.5rem 0.75rem',
                              borderRadius: 'var(--radius-sm)',
                              border: isChecked ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                              background: isChecked ? 'rgba(99,102,241,0.06)' : 'transparent',
                              cursor: 'pointer', fontSize: '0.875rem', transition: 'all 0.15s ease',
                            }}>
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
                );
              })}
            </div>
          </div>
        ))}

        {/* Action bar */}
        <div className="animate-fade-up" style={{
          position: 'sticky', bottom: '1.5rem',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '1rem 1.5rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {requiredUnanswered > 0
              ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ {requiredUnanswered} pregunta{requiredUnanswered > 1 ? 's' : ''} obligatoria{requiredUnanswered > 1 ? 's' : ''} pendiente{requiredUnanswered > 1 ? 's' : ''}</span>
              : <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Todas las preguntas obligatorias respondidas</span>
            }
          </div>
          <button
            className="btn-primary"
            onClick={handleSubmitClick}
            disabled={submitResponse.isPending}
            style={{ padding: '0.6rem 1.5rem' }}
          >
            Enviar evaluaci&oacute;n →
          </button>
        </div>

        <div style={{ height: '5rem' }} />
      </div>
    </>
  );
}
