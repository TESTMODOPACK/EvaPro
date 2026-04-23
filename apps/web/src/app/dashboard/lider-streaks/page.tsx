'use client';

import { PlanGate } from '@/components/PlanGate';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { useTenantLeaderStreaks } from '@/hooks/useLeaderStreaks';

/**
 * v3.1 F6 — Ranking de líderes del tenant (solo admin).
 *
 * Muestra una tabla con todos los managers + tenant_admin del tenant,
 * ordenados por `totalScore` (suma de streaks activas). Cada fila
 * muestra: nombre, dept/cargo, las 3 rachas (current + best), score.
 *
 * Backend: `GET /leader-streaks/tenant` (@Roles super_admin + tenant_admin).
 */

function StreakCell({ current, best, unit }: { current: number; best: number; unit: string }) {
  if (current === 0 && best === 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>;
  }
  return (
    <span style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      {current > 0 ? (
        <span style={{ fontWeight: 700, color: 'var(--success)' }}>
          🔥 {current} {unit}
        </span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>0</span>
      )}
      {best > 0 && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          · récord {best}
        </span>
      )}
    </span>
  );
}

function Content() {
  const { data, isLoading, isError } = useTenantLeaderStreaks();

  if (isLoading) {
    return <LoadingState fullHeight message="Calculando rachas de líderes…" />;
  }

  if (isError) {
    return (
      <div style={{ padding: '2rem' }}>
        <div className="card">
          <EmptyState
            icon="⚠"
            title="No se pudieron cargar los streaks"
            description="Intenta nuevamente en unos segundos."
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
          🔥 Hábitos del líder
        </h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Rachas activas de tus managers y admins: semanas/meses consecutivos manteniendo
          buenas prácticas. El ranking ordena por suma de rachas vigentes.
        </p>
      </div>

      {(!data || data.length === 0) ? (
        <div className="card">
          <EmptyState
            icon="👥"
            title="Sin líderes para mostrar"
            description="Aún no hay managers ni admins activos en el tenant."
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base,#fafaf7)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>#</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>Líder</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>📅 Check-ins</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>💬 Feedback</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>🏆 Reconocimientos</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.map((l, idx) => {
                  const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Sin nombre';
                  const meta = [l.department, l.position].filter(Boolean).join(' · ');
                  return (
                    <tr key={l.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{name}</div>
                        {meta && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{meta}</div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <StreakCell
                          current={l.checkinsWeekly.current}
                          best={l.checkinsWeekly.best}
                          unit={l.checkinsWeekly.current === 1 ? 'semana' : 'sem'}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <StreakCell
                          current={l.feedbackWeekly.current}
                          best={l.feedbackWeekly.best}
                          unit={l.feedbackWeekly.current === 1 ? 'semana' : 'sem'}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <StreakCell
                          current={l.recognitionsMonthly.current}
                          best={l.recognitionsMonthly.best}
                          unit={l.recognitionsMonthly.current === 1 ? 'mes' : 'meses'}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <span
                          style={{
                            fontSize: '0.95rem',
                            fontWeight: 800,
                            color: l.totalScore > 0 ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          {l.totalScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeaderStreaksPage() {
  return (
    <PlanGate feature="LEADER_STREAKS">
      <Content />
    </PlanGate>
  );
}
