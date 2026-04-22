'use client';

import React from 'react';

export interface AiSuggestion {
  id: string;
  topic: string;
  rationale: string;
  priority: 'high' | 'med' | 'low';
  dismissed?: boolean;
}

export interface AiSuggestionsCardProps {
  suggestions: AiSuggestion[];
  /** Si es null/undefined, el tenant no tiene plan con AI_INSIGHTS → mostrar degradación. */
  hasAi: boolean;
  /** Regenerar agenda — llamar a useGenerateMagicAgenda.mutate({ checkinId, force: true }) */
  onRegenerate?: () => void;
  /** Dismiss una sugerencia individual. */
  onDismiss?: (id: string) => void;
  isRegenerating?: boolean;
  /** Si la agenda nunca se ha generado. */
  neverGenerated?: boolean;
  /** Timestamp generatedAt ISO8601 — se muestra como relativo. */
  generatedAt?: string;
}

const priorityColor: Record<AiSuggestion['priority'], { bg: string; text: string; label: string }> = {
  high: { bg: 'rgba(239,68,68,0.1)', text: '#dc2626', label: 'Alta' },
  med: { bg: 'rgba(245,158,11,0.1)', text: '#d97706', label: 'Media' },
  low: { bg: 'rgba(107,114,128,0.1)', text: '#6b7280', label: 'Baja' },
};

function formatRelative(iso?: string): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export default function AiSuggestionsCard({
  suggestions,
  hasAi,
  onRegenerate,
  onDismiss,
  isRegenerating = false,
  neverGenerated = false,
  generatedAt,
}: AiSuggestionsCardProps) {
  const visible = (suggestions || []).filter((s) => !s.dismissed);
  const accentPurple = '#7c3aed';

  return (
    <div
      className="card animate-fade-up"
      style={{
        padding: '1.15rem 1.25rem',
        borderLeft: `3px solid ${accentPurple}`,
        background: 'linear-gradient(180deg, rgba(124,58,237,0.03) 0%, transparent 60%)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.6rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
          <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>
            ✨
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: '0.88rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Temas sugeridos por IA
          </h3>
          {visible.length > 0 && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                padding: '0.15rem 0.5rem',
                borderRadius: '999px',
                background: `${accentPurple}18`,
                color: accentPurple,
              }}
            >
              {visible.length}
            </span>
          )}
        </div>
        {hasAi && onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="btn-ghost"
            style={{
              fontSize: '0.72rem',
              padding: '0.25rem 0.7rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
            aria-label={isRegenerating ? 'Regenerando agenda IA' : 'Regenerar agenda IA'}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                animation: isRegenerating ? 'spin 0.8s linear infinite' : undefined,
              }}
            >
              ↻
            </span>
            {isRegenerating ? 'Generando…' : 'Regenerar'}
          </button>
        )}
      </div>

      {/* Degradación: plan sin AI_INSIGHTS */}
      {!hasAi && (
        <div
          style={{
            padding: '0.9rem 1rem',
            borderRadius: 'var(--radius-sm, 8px)',
            background: 'rgba(124,58,237,0.06)',
            border: '1px dashed rgba(124,58,237,0.3)',
            color: 'var(--text-secondary)',
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '0.2rem', color: 'var(--text-primary)' }}>
            Más insights con IA
          </div>
          Esta función sugiere temas de conversación analizando OKRs, feedback y reconocimientos.
          Disponible en plan <strong>Enterprise</strong>.
        </div>
      )}

      {/* Con IA pero nunca generada */}
      {hasAi && neverGenerated && visible.length === 0 && (
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--radius-sm, 8px)',
            background: 'rgba(124,58,237,0.04)',
            border: '1px dashed rgba(124,58,237,0.25)',
            color: 'var(--text-secondary)',
            fontSize: '0.8rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.4rem', marginBottom: '0.35rem' }}>✨</div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
            Aún no hay sugerencias
          </div>
          <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
            Genera la agenda para que la IA proponga temas específicos para este 1:1.
          </div>
          {onRegenerate && (
            <button
              type="button"
              className="btn-primary"
              onClick={onRegenerate}
              disabled={isRegenerating}
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.9rem' }}
            >
              {isRegenerating ? 'Generando…' : '✨ Generar agenda'}
            </button>
          )}
        </div>
      )}

      {/* Con IA pero todas dismissed o IA falló */}
      {hasAi && !neverGenerated && visible.length === 0 && (
        <div
          style={{
            padding: '0.75rem',
            color: 'var(--text-muted)',
            fontSize: '0.78rem',
            fontStyle: 'italic',
            textAlign: 'center',
          }}
        >
          Sin sugerencias activas.
        </div>
      )}

      {/* Sugerencias */}
      {visible.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            flex: 1,
          }}
        >
          {visible.map((s) => {
            const p = priorityColor[s.priority];
            return (
              <li
                key={s.id}
                style={{
                  padding: '0.65rem 0.8rem',
                  borderRadius: 'var(--radius-sm, 8px)',
                  background: 'rgba(124,58,237,0.04)',
                  border: '1px solid rgba(124,58,237,0.12)',
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.45rem',
                        borderRadius: '999px',
                        background: p.bg,
                        color: p.text,
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {p.label}
                    </span>
                    <span
                      style={{
                        fontSize: '0.83rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        lineHeight: 1.35,
                      }}
                    >
                      {s.topic}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    {s.rationale}
                  </p>
                </div>
                {onDismiss && (
                  <button
                    type="button"
                    onClick={() => onDismiss(s.id)}
                    title="Descartar sugerencia"
                    aria-label={`Descartar sugerencia: ${s.topic}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      fontSize: '0.9rem',
                      padding: '0.15rem 0.35rem',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--danger)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer: generatedAt + disclaimer */}
      {hasAi && !neverGenerated && generatedAt && (
        <div
          style={{
            marginTop: '0.65rem',
            fontSize: '0.68rem',
            color: 'var(--text-muted)',
            textAlign: 'right',
            fontStyle: 'italic',
          }}
        >
          Generado {formatRelative(generatedAt)}
        </div>
      )}
    </div>
  );
}
