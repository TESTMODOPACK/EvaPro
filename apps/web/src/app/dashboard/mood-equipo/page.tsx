'use client';

import { useState } from 'react';
import { PlanGate } from '@/components/PlanGate';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { useTeamMoodToday, useTeamMoodHistory } from '@/hooks/useMoodCheckins';
import { useAuthStore } from '@/store/auth.store';

/**
 * v3.1 F3 — Página "Ánimo del Equipo"
 *
 * Solo manager y admin ven esta página (el PlanGate gatea por
 * MOOD_TRACKING; @Roles en el backend gatea el endpoint a manager+admin).
 *
 * Muestra:
 *   1. Promedio de HOY con distribución de scores (si >= 3 respuestas).
 *   2. Tendencia de los últimos 14 días (línea simple).
 *   3. Respuestas count por día.
 *
 * Privacidad: días con < 3 respuestas no se muestran en la tendencia
 * (el backend los filtra antes).
 */

function MoodLabel({ score }: { score: number }) {
  if (score >= 4.5) return <>😄 <strong>Muy bien</strong></>;
  if (score >= 3.5) return <>🙂 <strong>Bien</strong></>;
  if (score >= 2.5) return <>😐 <strong>Neutral</strong></>;
  if (score >= 1.5) return <>😟 <strong>Mal</strong></>;
  return <>😞 <strong>Muy mal</strong></>;
}

function MoodScoreColor(score: number): string {
  if (score >= 4.5) return '#10b981';   // verde
  if (score >= 3.5) return '#22c55e';
  if (score >= 2.5) return '#f59e0b';   // ámbar
  if (score >= 1.5) return '#f97316';
  return '#ef4444';                      // rojo
}

function TeamMoodContent() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const isAdmin = role === 'super_admin' || role === 'tenant_admin';
  const [days, setDays] = useState(14);

  const { data: todayData, isLoading: loadingToday } = useTeamMoodToday();
  const { data: history, isLoading: loadingHistory } = useTeamMoodHistory(days);

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
          😊 Ánimo del equipo
        </h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {isAdmin
            ? 'Agregado de ánimo de todos los colaboradores activos del tenant.'
            : 'Agregado de ánimo de tus reportes directos.'}{' '}
          Las respuestas son anónimas — solo se muestran promedios a partir de <strong>3 respuestas</strong> por día.
        </p>
      </div>

      {/* Hoy */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>Hoy</h2>
        {loadingToday ? (
          <LoadingState message="Cargando ánimo de hoy…" compact />
        ) : !todayData ? (
          <div className="card">
            <EmptyState
              icon="🤔"
              title="Aún no hay suficientes respuestas hoy"
              description="Se muestra el promedio cuando al menos 3 personas del equipo registran su ánimo del día."
              compact
            />
          </div>
        ) : (
          <div
            className="card animate-fade-up"
            style={{ padding: '1.25rem', borderLeft: `4px solid ${MoodScoreColor(todayData.avgScore)}` }}
          >
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: MoodScoreColor(todayData.avgScore), lineHeight: 1 }}>
                  {todayData.avgScore.toFixed(1)}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Promedio · {todayData.responseCount} respuestas
                </div>
              </div>
              <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                <MoodLabel score={todayData.avgScore} />
              </div>
              <div style={{ flex: 1, minWidth: '260px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Distribución
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'flex-end', height: '60px' }}>
                  {([1, 2, 3, 4, 5] as const).map((s) => {
                    const count = (todayData.distribution as any)[String(s)] ?? 0;
                    const pct = todayData.responseCount > 0 ? (count / todayData.responseCount) * 100 : 0;
                    const emojis: Record<number, string> = { 1: '😞', 2: '😟', 3: '😐', 4: '🙂', 5: '😄' };
                    return (
                      <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                        <div
                          style={{
                            width: '100%',
                            height: `${Math.max(pct, count > 0 ? 6 : 0)}%`,
                            background: MoodScoreColor(s),
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.3s',
                            minHeight: count > 0 ? '6px' : '0',
                          }}
                          title={`${count} respuestas (${pct.toFixed(0)}%)`}
                        />
                        <div style={{ fontSize: '1rem', lineHeight: 1 }}>{emojis[s]}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tendencia */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Tendencia</h2>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={days === d ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
              >
                {d} días
              </button>
            ))}
          </div>
        </div>
        {loadingHistory ? (
          <LoadingState message="Cargando tendencia…" compact />
        ) : !history || history.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="📈"
              title="Aún no hay suficientes datos"
              description="Se mostrará la tendencia cuando haya al menos 3 respuestas por día. Invita al equipo a registrar su ánimo diario."
              compact
            />
          </div>
        ) : (
          <div className="card animate-fade-up" style={{ padding: '1.25rem' }}>
            {/* Simple bar chart line: una barrita por día */}
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'flex-end', height: '140px', marginBottom: '0.75rem' }}>
              {history.map((h) => {
                const hPct = ((h.avgScore - 1) / 4) * 100; // 1→0%, 5→100%
                return (
                  <div
                    key={h.date}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      minWidth: '14px',
                    }}
                    title={`${h.date} — ${h.avgScore.toFixed(1)} (${h.responseCount} respuestas)`}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(hPct, 4)}%`,
                        background: MoodScoreColor(h.avgScore),
                        borderRadius: '3px 3px 0 0',
                        transition: 'height 0.3s',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              <span>{history[0]?.date}</span>
              <span>{history.length} días con datos</span>
              <span>{history[history.length - 1]?.date}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MoodTeamPage() {
  return (
    <PlanGate feature="MOOD_TRACKING">
      <TeamMoodContent />
    </PlanGate>
  );
}
