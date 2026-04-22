'use client';

import { useState, useEffect } from 'react';
import { useMyMoodToday, useSubmitMood } from '@/hooks/useMoodCheckins';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { useToastStore } from '@/store/toast.store';

/**
 * v3.1 F3 — MoodCheckinWidget
 *
 * Widget de 1-click para que el usuario registre su ánimo del día con
 * 5 emojis. Upsert: si ya registró hoy, precarga el valor y permite
 * editar (el usuario puede cambiar de opinión a lo largo del día).
 *
 * Comportamiento:
 *   - Se oculta si el plan del tenant no tiene MOOD_TRACKING.
 *   - Compact layout para embeber en dashboard.
 *   - Nota opcional expandible con "Agregar nota".
 */
const MOODS: Array<{ score: 1 | 2 | 3 | 4 | 5; emoji: string; label: string }> = [
  { score: 1, emoji: '😞', label: 'Muy mal' },
  { score: 2, emoji: '😟', label: 'Mal' },
  { score: 3, emoji: '😐', label: 'Neutral' },
  { score: 4, emoji: '🙂', label: 'Bien' },
  { score: 5, emoji: '😄', label: 'Muy bien' },
];

export default function MoodCheckinWidget() {
  const { hasFeature, isSuperAdmin } = useFeatureAccess();
  const hasAccess = isSuperAdmin || hasFeature('MOOD_TRACKING');

  const { data: today } = useMyMoodToday();
  const submit = useSubmitMood();
  const toast = useToastStore((s) => s.toast);

  const [selectedScore, setSelectedScore] = useState<number>(0);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  // Al cargar el registro existente, reflejarlo en el widget.
  useEffect(() => {
    if (today) {
      setSelectedScore(today.score);
      setNote(today.note || '');
    }
  }, [today?.id, today?.score, today?.note]);

  if (!hasAccess) return null;

  const handleSelect = (score: number) => {
    setSelectedScore(score);
    // Submit inmediato (sin esperar note) — UX one-click.
    submit.mutate(
      { score, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1500);
        },
        onError: (e: any) => toast(e?.message || 'Error al registrar', 'error'),
      },
    );
  };

  const handleSaveNote = () => {
    if (!selectedScore) {
      toast('Elegí un ánimo antes de agregar una nota.', 'warning');
      return;
    }
    submit.mutate(
      { score: selectedScore, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1500);
          setShowNoteInput(false);
        },
        onError: (e: any) => toast(e?.message || 'Error al guardar nota', 'error'),
      },
    );
  };

  return (
    <div
      className="card animate-fade-up"
      style={{
        padding: '1rem 1.25rem',
        borderLeft: today ? '3px solid var(--success)' : '3px solid var(--accent)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700 }}>
          {today ? 'Tu ánimo de hoy' : '¿Cómo estás hoy?'}
        </h3>
        {savedFlash && (
          <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600 }}>
            ✓ Guardado
          </span>
        )}
        {today && !savedFlash && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Podés cambiarlo si quieres
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'space-around', padding: '0.25rem 0' }}>
        {MOODS.map((m) => {
          const selected = selectedScore === m.score;
          return (
            <button
              key={m.score}
              onClick={() => handleSelect(m.score)}
              disabled={submit.isPending}
              aria-label={m.label}
              title={m.label}
              style={{
                background: selected ? 'rgba(201,147,58,0.12)' : 'transparent',
                border: selected ? '2px solid var(--accent)' : '2px solid transparent',
                borderRadius: '50%',
                width: '52px',
                height: '52px',
                fontSize: '1.7rem',
                cursor: submit.isPending ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: selected ? 1 : 0.6,
              }}
              onMouseEnter={(e) => {
                if (!selected) e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                if (!selected) e.currentTarget.style.opacity = '0.6';
              }}
            >
              {m.emoji}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {selectedScore
            ? `Seleccionado: ${MOODS.find((m) => m.score === selectedScore)?.label}`
            : 'Tu respuesta es privada — solo agregados por equipo (≥3 respuestas).'}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowNoteInput(!showNoteInput)}
          style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
        >
          {showNoteInput ? 'Cerrar' : (note ? 'Editar nota' : '+ Agregar nota')}
        </button>
      </div>

      {showNoteInput && (
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem' }}>
          <input
            className="input"
            type="text"
            placeholder="Qué la hace hoy (opcional)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            style={{ flex: 1, fontSize: '0.82rem' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submit.isPending && selectedScore) {
                e.preventDefault();
                handleSaveNote();
              }
            }}
          />
          <button
            className="btn-primary"
            onClick={handleSaveNote}
            disabled={submit.isPending || !selectedScore}
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}
          >
            {submit.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  );
}
