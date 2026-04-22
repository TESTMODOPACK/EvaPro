'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * v3.1 F7 — MVP del Mes.
 *
 * Card compacto para mostrar el MVP elegido el mes pasado (se calcula
 * el día 1 de cada mes via cron). Durante el primer día del mes,
 * puede no haber data todavía si el cron no corrió — se muestra un
 * placeholder.
 */
export default function MvpOfTheMonthCard() {
  const token = useAuthStore((s) => s.token);

  const { data: mvp, isLoading } = useQuery({
    queryKey: ['recognition', 'mvp', 'current'],
    queryFn: () => api.recognition.currentMvp(token!),
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
  });

  // Formato "abril 2026" desde "2026-04".
  const formatMonthLabel = (m: string): string => {
    if (!m || m.length !== 7) return m;
    const [y, mo] = m.split('-').map(Number);
    const names = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    return `${names[mo - 1]} ${y}`;
  };

  if (isLoading) return null;
  if (!mvp) {
    // Sin MVP calculado este mes → mostrar placeholder motivador.
    return (
      <div
        className="card animate-fade-up"
        style={{
          padding: '1.15rem 1.25rem',
          borderLeft: '4px solid #a855f7',
          background: 'linear-gradient(180deg, rgba(168,85,247,0.05) 0%, transparent 60%)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '1.5rem' }} aria-hidden>🏆</span>
          <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>MVP del Mes</h3>
        </div>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          El MVP se elige automáticamente el día 1 de cada mes según los reconocimientos
          del mes anterior. ¡Reconocé a tus colegas para definir al próximo!
        </p>
      </div>
    );
  }

  const userName = mvp.user
    ? `${mvp.user.firstName} ${mvp.user.lastName}`.trim()
    : 'Colaborador destacado';

  return (
    <div
      className="card animate-fade-up"
      style={{
        padding: '1.15rem 1.25rem',
        borderLeft: '4px solid #a855f7',
        background: 'linear-gradient(180deg, rgba(168,85,247,0.08) 0%, rgba(168,85,247,0.02) 100%)',
      }}
    >
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.8rem' }} aria-hidden>🏆</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            MVP del mes · {formatMonthLabel(mvp.month)}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
            {userName}
          </div>
          {mvp.user?.position && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {mvp.user.position}
              {mvp.user.department ? ` · ${mvp.user.department}` : ''}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <span>
          🎉 <strong style={{ color: 'var(--text-primary)' }}>{mvp.totalKudosCount}</strong> reconocimientos
        </span>
        <span>
          👥 <strong style={{ color: 'var(--text-primary)' }}>{mvp.uniqueGiversCount}</strong> colegas lo/la reconocieron
        </span>
      </div>
    </div>
  );
}
