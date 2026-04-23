'use client';

import { useMyLeaderStreaks } from '@/hooks/useLeaderStreaks';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { useAuthStore } from '@/store/auth.store';

/**
 * v3.1 F6 — Widget de rachas del líder en el dashboard.
 *
 * Se muestra solo si:
 *   - El plan tiene LEADER_STREAKS (Growth+), Y
 *   - El usuario es manager/admin (employee no tiene streaks de liderazgo).
 */

function StreakCard({
  icon,
  title,
  current,
  best,
  period,
  color,
}: {
  icon: string;
  title: string;
  current: number;
  best: number;
  period: 'weekly' | 'monthly';
  color: string;
}) {
  const unit = period === 'weekly' ? (current === 1 ? 'semana' : 'semanas') : (current === 1 ? 'mes' : 'meses');
  const bestUnit = period === 'weekly' ? (best === 1 ? 'semana' : 'semanas') : (best === 1 ? 'mes' : 'meses');
  const hasCurrent = current > 0;

  return (
    <div
      style={{
        flex: '1 1 180px',
        padding: '0.9rem 1rem',
        borderRadius: 'var(--radius-sm, 8px)',
        background: hasCurrent ? `${color}10` : 'var(--bg-base, #fafaf7)',
        border: `1px solid ${hasCurrent ? color + '30' : 'var(--border)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
        <span
          style={{
            fontSize: '1.65rem',
            fontWeight: 800,
            color: hasCurrent ? color : 'var(--text-muted)',
            lineHeight: 1,
          }}
        >
          {current}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{unit}</span>
        {hasCurrent && <span style={{ fontSize: '0.9rem' }}>🔥</span>}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {best > 0 ? (
          <>
            🏆 Récord: <strong>{best}</strong> {bestUnit}
          </>
        ) : (
          <>Sin actividad aún</>
        )}
      </div>
    </div>
  );
}

export default function LeaderStreaksWidget() {
  const { hasFeature, isSuperAdmin } = useFeatureAccess();
  const { user } = useAuthStore();
  const role = user?.role || '';
  const hasAccess = isSuperAdmin || hasFeature('LEADER_STREAKS');
  const isLeader = role === 'super_admin' || role === 'tenant_admin' || role === 'manager';

  const enabled = hasAccess && isLeader;
  const { data, isLoading, isError } = useMyLeaderStreaks({ enabled });

  if (!enabled) return null;
  if (isLoading) return null;
  if (isError || !data) return null;

  return (
    <div className="card animate-fade-up" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700 }}>
          🔥 Tus hábitos como líder
        </h3>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Rachas activas se mantienen con actividad semanal/mensual
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <StreakCard
          icon="📅"
          title="Check-ins semanales"
          current={data.checkinsWeekly.current}
          best={data.checkinsWeekly.best}
          period="weekly"
          color="#3b82f6"
        />
        <StreakCard
          icon="💬"
          title="Feedback semanal"
          current={data.feedbackWeekly.current}
          best={data.feedbackWeekly.best}
          period="weekly"
          color="#10b981"
        />
        <StreakCard
          icon="🏆"
          title="Reconocimientos mensuales"
          current={data.recognitionsMonthly.current}
          best={data.recognitionsMonthly.best}
          period="monthly"
          color="#a855f7"
        />
      </div>
    </div>
  );
}
