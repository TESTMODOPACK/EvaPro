'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';

const LIKERT_LABELS = [
  { value: 1, label: 'Muy en desacuerdo', color: '#ef4444' },
  { value: 2, label: 'En desacuerdo', color: '#f97316' },
  { value: 3, label: 'Neutral', color: '#eab308' },
  { value: 4, label: 'De acuerdo', color: '#22c55e' },
  { value: 5, label: 'Muy de acuerdo', color: '#16a34a' },
];

export default function ResponderEncuestaPage() {
  const params = useParams();
  const router = useRouter();
  const surveyId = params.id as string;
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);

  const [survey, setSurvey] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || !surveyId) return;
    api.surveys.findById(token, surveyId)
      .then((data) => {
        setSurvey(data);
        // Initialize answers
        const init: Record<string, any> = {};
        (data.questions || []).forEach((q: any) => { init[q.id] = null; });
        setAnswers(init);
      })
      .catch((e) => toast(e.message || 'Error al cargar encuesta', 'error'))
      .finally(() => setLoading(false));
  }, [token, surveyId]);

  const handleAnswer = (questionId: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const totalQuestions = survey?.questions?.length || 0;
  const answeredCount = Object.values(answers).filter((v) => v !== null && v !== '' && v !== undefined).length;
  const progress = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  const handleSubmit = async () => {
    if (!token || !survey) return;

    // Validate required questions
    const unanswered = (survey.questions || []).filter(
      (q: any) => q.isRequired && (answers[q.id] === null || answers[q.id] === '' || answers[q.id] === undefined),
    );
    if (unanswered.length > 0) {
      toast(`Hay ${unanswered.length} pregunta(s) obligatoria(s) sin responder`, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const formattedAnswers = Object.entries(answers)
        .filter(([, v]) => v !== null && v !== '' && v !== undefined)
        .map(([questionId, value]) => ({ questionId, value }));

      await api.surveys.respond(token, surveyId, formattedAnswers);
      toast('Respuestas enviadas exitosamente. ¡Gracias por participar!', 'success');
      router.push('/dashboard/encuestas-clima');
    } catch (e: any) {
      toast(e.message || 'Error al enviar respuestas', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando encuesta...</div>;
  if (!survey) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Encuesta no encontrada</div>;

  // Group questions by category
  const categories: Record<string, any[]> = {};
  (survey.questions || []).forEach((q: any) => {
    if (!categories[q.category]) categories[q.category] = [];
    categories[q.category].push(q);
  });

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{survey.title}</h1>
        {survey.description && (
          <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 0', fontSize: '0.9rem' }}>{survey.description}</p>
        )}
        {survey.isAnonymous && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.08)', borderRadius: 8, fontSize: '0.85rem', color: '#16a34a', border: '1px solid rgba(34,197,94,0.2)' }}>
            🔒 Tus respuestas son completamente anónimas. No se registrará tu identidad.
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
          <span>Progreso</span>
          <span style={{ fontWeight: 600 }}>{answeredCount}/{totalQuestions} ({progress}%)</span>
        </div>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Questions by category */}
      {Object.entries(categories).map(([cat, questions]) => (
        <div key={cat} className="card" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1rem', color: 'var(--accent)', borderBottom: '2px solid var(--accent)', paddingBottom: '0.5rem' }}>
            {cat}
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {questions.map((q: any) => (
              <div key={q.id}>
                <p style={{ fontWeight: 500, margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                  {q.questionText}
                  {q.isRequired && <span style={{ color: 'var(--danger)' }}> *</span>}
                </p>

                {/* Likert 1-5 */}
                {q.questionType === 'likert_5' && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {LIKERT_LABELS.map((l) => (
                      <button
                        key={l.value}
                        onClick={() => handleAnswer(q.id, l.value)}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: 8,
                          border: answers[q.id] === l.value ? `2px solid ${l.color}` : '2px solid var(--border)',
                          background: answers[q.id] === l.value ? `${l.color}15` : 'transparent',
                          color: answers[q.id] === l.value ? l.color : 'var(--text-main)',
                          cursor: 'pointer',
                          fontWeight: answers[q.id] === l.value ? 600 : 400,
                          fontSize: '0.85rem',
                          transition: 'all 0.2s',
                          flex: '1 1 auto',
                          textAlign: 'center',
                          minWidth: 80,
                        }}
                      >
                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{l.value}</div>
                        <div style={{ fontSize: '0.7rem' }}>{l.label}</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* NPS 0-10 */}
                {q.questionType === 'nps' && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {Array.from({ length: 11 }, (_, i) => i).map((n) => {
                      const color = n <= 6 ? '#ef4444' : n <= 8 ? '#eab308' : '#16a34a';
                      return (
                        <button
                          key={n}
                          onClick={() => handleAnswer(q.id, n)}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            border: answers[q.id] === n ? `2px solid ${color}` : '2px solid var(--border)',
                            background: answers[q.id] === n ? `${color}20` : 'transparent',
                            color: answers[q.id] === n ? color : 'var(--text-main)',
                            cursor: 'pointer',
                            fontWeight: answers[q.id] === n ? 700 : 400,
                            fontSize: '0.9rem',
                            transition: 'all 0.2s',
                          }}
                        >
                          {n}
                        </button>
                      );
                    })}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      <span>Nada probable</span>
                      <span>Muy probable</span>
                    </div>
                  </div>
                )}

                {/* Open text */}
                {q.questionType === 'open_text' && (
                  <textarea
                    className="input"
                    rows={3}
                    value={answers[q.id] || ''}
                    onChange={(e) => handleAnswer(q.id, e.target.value)}
                    placeholder="Escribe tu respuesta..."
                    style={{ fontSize: '0.9rem' }}
                  />
                )}

                {/* Multiple choice */}
                {q.questionType === 'multiple_choice' && q.options && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {q.options.map((opt: string) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', padding: '0.4rem', borderRadius: 6, background: (answers[q.id] || []).includes(opt) ? 'rgba(201,147,58,0.08)' : 'transparent' }}>
                        <input
                          type="checkbox"
                          checked={(answers[q.id] || []).includes(opt)}
                          onChange={(e) => {
                            const current = answers[q.id] || [];
                            handleAnswer(q.id, e.target.checked ? [...current, opt] : current.filter((x: string) => x !== opt));
                          }}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Submit */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0' }}>
        <button className="btn-ghost" onClick={() => router.push('/dashboard/encuestas-clima')}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Enviando...' : 'Enviar Respuestas'}
        </button>
      </div>
    </div>
  );
}
