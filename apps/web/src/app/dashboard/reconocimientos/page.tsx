'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useRecognitionWall, useCreateRecognition, useAddReaction,
  useMyBadges, useMyPoints, useLeaderboard, useRecognitionStats,
} from '@/hooks/useRecognition';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const ICONS: Record<string, string> = {
  star: '\u2B50', trophy: '\uD83C\uDFC6', rocket: '\uD83D\uDE80', heart: '\u2764\uFE0F',
  fire: '\uD83D\uDD25', diamond: '\uD83D\uDC8E', crown: '\uD83D\uDC51', medal: '\uD83C\uDFC5',
  lightning: '\u26A1', brain: '\uD83E\uDDE0', handshake: '\uD83E\uDD1D', target: '\uD83C\uDFAF',
};
const REACTIONS = ['\uD83D\uDC4F', '\u2764\uFE0F', '\uD83D\uDE80', '\uD83D\uDD25', '\uD83D\uDCAA', '\uD83C\uDF1F'];

const TAB_KEYS = ['wall', 'leaderboard', 'challenges', 'badges', 'store'] as const;
const TAB_LABELS: Record<string, string> = { wall: 'Muro', leaderboard: 'Ranking', challenges: 'Desafíos', badges: 'Insignias', store: 'Tienda' };
const TAB_ICONS: Record<string, string> = { wall: '\uD83D\uDCE3', leaderboard: '\uD83C\uDFC6', challenges: '\uD83C\uDFAF', badges: '\uD83C\uDFC5', store: '\uD83D\uDED2' };
const CRITERIA_TYPES = [
  { value: 'recognitions_received', label: 'Reconocimientos recibidos' },
  { value: 'recognitions_sent', label: 'Reconocimientos enviados' },
  { value: 'total_points', label: 'Puntos acumulados' },
];

function RecognitionCard({ item, onReact }: { item: any; onReact: (id: string, emoji: string) => void }) {
  const [showReactions, setShowReactions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const initials = (item.fromUser?.firstName?.[0] || '') + (item.fromUser?.lastName?.[0] || '');
  const msgShort = item.message.length > 100 ? item.message.substring(0, 100) + '...' : item.message;
  const hasLongMsg = item.message.length > 100;
  const timeAgo = (() => {
    const diff = Date.now() - new Date(item.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'min';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    const days = Math.floor(hrs / 24);
    return days + 'd';
  })();

  return (
    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{item.fromUser?.firstName}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>reconoce a</span>
          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{item.toUser?.firstName} {item.toUser?.lastName}</span>
          {item.value && (
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 10, background: 'rgba(201,147,58,0.1)', color: 'var(--accent)', fontWeight: 600 }}>
              {item.value.name}
            </span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{timeAgo}</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          {expanded ? item.message : msgShort}
          {hasLongMsg && (
            <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, marginLeft: '0.25rem' }}>
              {expanded ? 'ver menos' : 'ver mas'}
            </button>
          )}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: 600 }}>+{item.points}pts</span>
          {Object.entries(item.reactions || {}).map(([emoji, users]) => (
            <button key={emoji} onClick={() => onReact(item.id, emoji)}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px', fontSize: '0.72rem', cursor: 'pointer', lineHeight: 1.3 }}>
              {emoji}{Array.isArray(users) ? users.length : ''}
            </button>
          ))}
          <button onClick={() => setShowReactions(!showReactions)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
            +
          </button>
          {showReactions && REACTIONS.map((r) => (
            <button key={r} onClick={() => { onReact(item.id, r); setShowReactions(false); }}
              style={{ background: 'none', border: 'none', fontSize: '0.95rem', cursor: 'pointer', padding: '1px' }}>
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewRecognitionForm({ onSuccess, t }: { onSuccess: () => void; t: any }) {
  const { data: usersPage } = useUsers();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const { data: competencies } = useQuery({
    queryKey: ['competencies'],
    queryFn: () => api.development.competencies.list(token!),
    enabled: !!token,
  });
  const createMut = useCreateRecognition();
  const [toUserId, setToUserId] = useState('');
  const [message, setMessage] = useState('');
  const [valueId, setValueId] = useState('');
  const [error, setError] = useState('');

  const users = (usersPage as any)?.data || usersPage || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toUserId || !message) return;
    setError('');
    try {
      await createMut.mutateAsync({ toUserId, message, valueId: valueId || undefined });
      setToUserId(''); setMessage(''); setValueId('');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Error al enviar reconocimiento');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>{'✨'} {t('reconocimientos.sendTitle')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <select className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)} required>
          <option value="">{t('reconocimientos.selectPerson')}</option>
          {(Array.isArray(users) ? users : []).filter((u: any) => u.id !== user?.userId).map((u: any) => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.department ? ` — ${u.department}` : ''}</option>
          ))}
        </select>
        <select className="input" value={valueId} onChange={(e) => setValueId(e.target.value)}>
          <option value="">{t('reconocimientos.valueOptional')}</option>
          {(Array.isArray(competencies) ? competencies : []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} ({c.category})</option>
          ))}
        </select>
      </div>
      <textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} required
        placeholder={t('reconocimientos.messagePlaceholder')} rows={2} style={{ resize: 'vertical', marginBottom: '0.75rem' }} />
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>{error}</p>}
      <button type="submit" className="btn-primary" disabled={createMut.isPending} style={{ fontSize: '0.85rem' }}>
        {createMut.isPending ? t('reconocimientos.sending') : t('reconocimientos.send')}
      </button>
    </form>
  );
}

export default function ReconocimientosPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const isManager = role === 'manager';
  const [tab, setTab] = useState<typeof TAB_KEYS[number]>('wall');
  const [myChallenges, setMyChallenges] = useState<any[]>([]);
  const [allBadges, setAllBadges] = useState<any[]>([]);
  const [showCreateBadge, setShowCreateBadge] = useState(false);
  const [badgeForm, setBadgeForm] = useState({ name: '', description: '', icon: 'star', color: '#c9933a', criteriaType: '', criteriaThreshold: 10, pointsReward: 50 });
  const [badgeSaving, setBadgeSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<string>('month');
  const [rankingView, setRankingView] = useState<'team' | 'general'>(isManager ? 'team' : 'general');
  // Challenge admin
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [challengeForm, setChallengeForm] = useState({ name: '', description: '', criteriaType: 'recognitions_received', criteriaThreshold: 10, pointsReward: 50, startDate: '', endDate: '' });
  const [challengeSaving, setChallengeSaving] = useState(false);
  // Store / Catalog
  const [catalog, setCatalog] = useState<any[]>([]);
  const [myRedemptions, setMyRedemptions] = useState<any[]>([]);
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [itemForm, setItemForm] = useState({ name: '', description: '', pointsCost: 100, category: '', stock: -1 });
  const [itemSaving, setItemSaving] = useState(false);
  // Budget
  const [budget, setBudget] = useState<any>(null);
  // Approvals
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  // Leaderboard opt-in
  const [deptFilter, setDeptFilter] = useState('');
  const { data: wall, refetch: refetchWall } = useRecognitionWall(page);
  const { data: myBadges } = useMyBadges();
  const { data: myPoints } = useMyPoints();
  const { data: leaderboard } = useLeaderboard(period);
  const { data: stats } = useRecognitionStats();
  const reactMut = useAddReaction();

  const handleReact = (id: string, emoji: string) => {
    reactMut.mutate({ id, emoji });
  };

  useEffect(() => {
    if (!token) return;
    api.recognition.myChallenges(token).then(setMyChallenges).catch(() => {});
    api.recognition.badges(token).then(setAllBadges).catch(() => {});
    api.recognition.catalog(token).then(setCatalog).catch(() => {});
    api.recognition.myRedemptions(token).then(setMyRedemptions).catch(() => {});
    api.recognition.budget(token).then(setBudget).catch(() => {});
    if (isAdmin || isManager) {
      api.recognition.pendingApprovals(token).then(setPendingApprovals).catch(() => {});
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaderboard: team vs general view
  const myUserId = useAuthStore((s) => s.user?.userId);
  const userDept = (leaderboard || []).find((e: any) => e.userId === myUserId)?.department;
  const teamLeaderboard = isManager && userDept
    ? (leaderboard || []).filter((e: any) => e.department === userDept).map((e: any, i: number) => ({ ...e, rank: i + 1 }))
    : null;
  const leaderboardData = rankingView === 'team' && teamLeaderboard ? teamLeaderboard : (leaderboard || []);

  const [showGuide, setShowGuide] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${BASE_URL}/recognition/export?format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Error');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `reconocimientos.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {} finally { setExporting(null); }
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1000px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('reconocimientos.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('reconocimientos.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {isAdmin && (['pdf', 'xlsx', 'csv'] as const).map((fmt) => (
            <button key={fmt} type="button" disabled={!!exporting} onClick={() => handleExport(fmt)}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.72rem', fontWeight: 600, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', background: exporting === fmt ? 'var(--bg-hover)' : 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: exporting ? 'wait' : 'pointer', opacity: exporting && exporting !== fmt ? 0.5 : 1 }}>
              {exporting === fmt ? '...' : fmt.toUpperCase()}
            </button>
          ))}
          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? 'Ocultar guia' : 'Como funciona'}
          </button>
        </div>
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            Como funciona el sistema de Reconocimientos
          </h3>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Sistema de Puntos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Al enviar un reconocimiento:</strong> Se descuentan 10 puntos de tu presupuesto mensual y recibes 2 puntos de bonus por reconocer a otros.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Al recibir un reconocimiento:</strong> Recibes 10 puntos que se suman a tu balance total.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Presupuesto mensual:</strong> Cada colaborador tiene 100 puntos por mes para dar reconocimientos (10 reconocimientos). Se renueva el 1ro de cada mes.
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Reglas</div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>Maximo 5 reconocimientos por dia</li>
              <li>Maximo 2 reconocimientos a la misma persona por dia</li>
              <li>El valor corporativo es opcional y no otorga puntos adicionales, solo etiqueta el reconocimiento</li>
              <li>Los puntos acumulados se pueden canjear en la Tienda de beneficios</li>
            </ul>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Secciones</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Muro:</strong> Feed publico de reconocimientos. Puedes enviar nuevos reconocimientos y reaccionar a los de otros.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Ranking:</strong> Tabla de posiciones por puntos acumulados. Los encargados de equipo pueden ver ranking de su equipo vs general.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Desafios:</strong> Metas colectivas o individuales con recompensa de puntos al cumplir el objetivo.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Insignias:</strong> Logros que se otorgan automaticamente al alcanzar hitos (ej: 10 reconocimientos recibidos).
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Tienda:</strong> Catalogo de beneficios canjeables con puntos acumulados (dias libres, gift cards, etc.).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending approvals banner */}
      {(isAdmin || isManager) && pendingApprovals.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '0.75rem 1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{t('reconocimientos.pendingApprovals', { count: pendingApprovals.length })}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {pendingApprovals.slice(0, 3).map((pa: any) => (
              <div key={pa.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{pa.fromUser?.firstName} → {pa.toUser?.firstName}</span>
                <button className="btn-primary" style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                  onClick={async () => { if (!token) return; await api.recognition.approve(token, pa.id, true); setPendingApprovals(prev => prev.filter(x => x.id !== pa.id)); }}>
                  {t('reconocimientos.approve')}
                </button>
                <button className="btn-ghost" style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                  onClick={async () => { if (!token) return; await api.recognition.approve(token, pa.id, false); setPendingApprovals(prev => prev.filter(x => x.id !== pa.id)); }}>
                  {t('reconocimientos.reject')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="animate-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { value: myPoints?.totalPoints || 0, label: t('reconocimientos.myPoints') },
          { value: budget ? `${budget.remaining}/${budget.allocated}` : '—', label: t('reconocimientos.monthlyBudget') },
          { value: (myBadges as any)?.length || 0, label: t('reconocimientos.myBadges') },
          { value: stats?.totalRecognitions || 0, label: t('reconocimientos.totalRecognitions') },
          { value: stats?.monthlyRecognitions || 0, label: t('reconocimientos.thisMonth') },
        ].map((card) => (
          <div key={card.label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{card.value}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* My Badges */}
      {(myBadges as any)?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 700 }}>{t('reconocimientos.myBadges')}</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(myBadges as any[]).map((ub: any) => (
              <div key={ub.id} title={ub.badge?.description || ub.badge?.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  background: 'rgba(201,147,58,0.08)', border: '1px solid rgba(201,147,58,0.2)',
                  borderRadius: 20, padding: '4px 12px', fontSize: '0.8rem',
                }}>
                <span>{ICONS[ub.badge?.icon] || '\u2B50'}</span>
                <span style={{ fontWeight: 600 }}>{ub.badge?.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {TAB_KEYS.map((key) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: tab === key ? 700 : 500,
              color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {TAB_ICONS[key]} {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Wall Tab */}
      {tab === 'wall' && (
        <div className="animate-fade-up">
          <NewRecognitionForm onSuccess={() => {
            refetchWall();
            if (token) api.recognition.budget(token).then(setBudget).catch(() => {});
          }} t={t} />
          {wall?.data?.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'✨'}</p>
              <p>{t('reconocimientos.emptyWall')}</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden', maxHeight: '600px', overflowY: 'auto' }}>
              {wall?.data?.map((item: any) => (
                <RecognitionCard key={item.id} item={item} onReact={handleReact} />
              ))}
            </div>
          )}
          {wall?.meta && wall.meta.totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', alignItems: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-ghost" style={{ fontSize: '0.82rem' }}>
                {t('common.previous')}
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {page} / {wall.meta.totalPages}
              </span>
              <button disabled={page >= wall.meta.totalPages} onClick={() => setPage(page + 1)} className="btn-ghost" style={{ fontSize: '0.82rem' }}>
                {t('common.next')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Tab */}
      {tab === 'leaderboard' && (
        <div className="animate-fade-up">
          {isManager && (
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}>
              <button onClick={() => setRankingView('team')}
                className={rankingView === 'team' ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}>Mi Equipo</button>
              <button onClick={() => setRankingView('general')}
                className={rankingView === 'general' ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}>General</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
            {[
              { val: 'week', label: t('reconocimientos.week') }, { val: 'month', label: t('reconocimientos.month') },
              { val: 'quarter', label: t('reconocimientos.quarter') }, { val: 'all', label: t('reconocimientos.allTime') },
            ].map((p) => (
              <button key={p.val} onClick={() => setPeriod(p.val)}
                className={period === p.val ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrapper" style={{ margin: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th style={{ textAlign: 'left' }}>{t('reconocimientos.colEmployee')}</th>
                    <th style={{ textAlign: 'left' }}>{t('reconocimientos.colDepartment')}</th>
                    <th style={{ textAlign: 'right' }}>{t('reconocimientos.colPoints')}</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardData.map((entry: any) => (
                    <tr key={entry.userId}>
                      <td style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {entry.rank <= 3
                          ? <span dangerouslySetInnerHTML={{ __html: ['&#129351;', '&#129352;', '&#129353;'][entry.rank - 1] }} />
                          : entry.rank}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{entry.userName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entry.position}</div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{entry.department}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>
                        {entry.totalPoints} pts
                      </td>
                    </tr>
                  ))}
                  {leaderboardData.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {t('reconocimientos.noLeaderboard')}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Challenges Tab */}
      {tab === 'challenges' && (
        <div className="animate-fade-up">
          {/* Admin: Create challenge */}
          {isAdmin && (
            <div style={{ marginBottom: '1rem' }}>
              <button className="btn-primary" style={{ fontSize: '0.82rem', marginBottom: '0.75rem' }} onClick={() => setShowCreateChallenge(!showCreateChallenge)}>
                {showCreateChallenge ? t('common.cancel') : t('reconocimientos.createChallenge')}
              </button>
              {showCreateChallenge && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.challengeName')}</label>
                      <input className="input" value={challengeForm.name} onChange={e => setChallengeForm({ ...challengeForm, name: e.target.value })} placeholder="Ej: Embajador del mes" style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.badgeCriteria')}</label>
                      <select className="input" value={challengeForm.criteriaType} onChange={e => setChallengeForm({ ...challengeForm, criteriaType: e.target.value })} style={{ fontSize: '0.82rem' }}>
                        {CRITERIA_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.badgeThreshold')}</label>
                      <input className="input" type="number" min={1} value={challengeForm.criteriaThreshold} onChange={e => setChallengeForm({ ...challengeForm, criteriaThreshold: parseInt(e.target.value) || 10 })} style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.badgeReward')}</label>
                      <input className="input" type="number" min={0} value={challengeForm.pointsReward} onChange={e => setChallengeForm({ ...challengeForm, pointsReward: parseInt(e.target.value) || 0 })} style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.startDate')}</label>
                      <input className="input" type="date" value={challengeForm.startDate} onChange={e => setChallengeForm({ ...challengeForm, startDate: e.target.value })} style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.endDate')}</label>
                      <input className="input" type="date" value={challengeForm.endDate} onChange={e => setChallengeForm({ ...challengeForm, endDate: e.target.value })} style={{ fontSize: '0.82rem' }} />
                    </div>
                  </div>
                  <button className="btn-primary" style={{ fontSize: '0.82rem' }} disabled={challengeSaving || !challengeForm.name.trim()}
                    onClick={async () => {
                      if (!token) return;
                      setChallengeSaving(true);
                      try {
                        await api.recognition.createChallenge(token, challengeForm);
                        const updated = await api.recognition.myChallenges(token);
                        setMyChallenges(updated);
                        setChallengeForm({ name: '', description: '', criteriaType: 'recognitions_received', criteriaThreshold: 10, pointsReward: 50, startDate: '', endDate: '' });
                        setShowCreateChallenge(false);
                      } catch {}
                      setChallengeSaving(false);
                    }}>
                    {challengeSaving ? t('common.saving') : t('reconocimientos.createChallenge')}
                  </button>
                </div>
              )}
            </div>
          )}

          {myChallenges.length === 0 && !showCreateChallenge ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'🎯'}</p>
              <p>{t('reconocimientos.noChallenges')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {myChallenges.map((ch: any) => (
                <div key={ch.id} className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '1.2rem' }}>{ICONS[ch.badgeIcon] || '\uD83C\uDFAF'}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{ch.name}</span>
                        {ch.completed && <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>{t('reconocimientos.challengeCompleted')}</span>}
                      </div>
                      {ch.description && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>{ch.description}</p>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: ch.completed ? 'var(--success)' : 'var(--accent)' }}>{ch.progress}%</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{ch.pointsReward} pts</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${ch.progress}%`, borderRadius: 4, transition: 'width 0.3s',
                      background: ch.completed ? 'var(--success)' : 'var(--accent)',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>{ch.currentValue} / {ch.criteriaThreshold}</span>
                    {ch.endDate && <span>{t('reconocimientos.challengeEnds')}: {new Date(ch.endDate).toLocaleDateString('es-CL')}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Badges Tab */}
      {tab === 'badges' && (
        <div className="animate-fade-up">
          {/* Top values */}
          {(stats?.topValues || []).length > 0 && (
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '0.9rem' }}>{t('reconocimientos.topValues')}</h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {stats.topValues.map((v: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{v.valueName}</span>
                    <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>{v.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All badges catalog */}
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>{t('reconocimientos.badgesCatalog')}</h4>
              {isAdmin && (
                <button className="btn-primary" style={{ fontSize: '0.8rem' }} onClick={() => setShowCreateBadge(!showCreateBadge)}>
                  {showCreateBadge ? t('common.cancel') : t('reconocimientos.createBadge')}
                </button>
              )}
            </div>

            {/* Create badge form (admin only) */}
            {showCreateBadge && isAdmin && (
              <div style={{ padding: '1rem', background: 'rgba(201,147,58,0.04)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      {t('reconocimientos.badgeName')}
                    </label>
                    <input className="input" value={badgeForm.name} onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
                      placeholder="Ej: Colaborador Estrella" style={{ fontSize: '0.82rem' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      {t('reconocimientos.badgeIcon')}
                    </label>
                    <select className="input" value={badgeForm.icon} onChange={(e) => setBadgeForm({ ...badgeForm, icon: e.target.value })} style={{ fontSize: '0.82rem' }}>
                      {Object.entries(ICONS).map(([key, emoji]) => (
                        <option key={key} value={key}>{emoji} {key}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                    {t('reconocimientos.badgeDescription')}
                  </label>
                  <input className="input" value={badgeForm.description} onChange={(e) => setBadgeForm({ ...badgeForm, description: e.target.value })}
                    placeholder="Descripción de la insignia..." style={{ fontSize: '0.82rem' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      {t('reconocimientos.badgeCriteria')}
                    </label>
                    <select className="input" value={badgeForm.criteriaType} onChange={(e) => setBadgeForm({ ...badgeForm, criteriaType: e.target.value })} style={{ fontSize: '0.82rem' }}>
                      <option value="">{t('reconocimientos.badgeManualOnly')}</option>
                      <option value="recognitions_received">{t('reconocimientos.criteriaReceived')}</option>
                      <option value="recognitions_sent">{t('reconocimientos.criteriaSent')}</option>
                      <option value="total_points">{t('reconocimientos.criteriaPoints')}</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      {t('reconocimientos.badgeThreshold')}
                    </label>
                    <input className="input" type="number" min={1} value={badgeForm.criteriaThreshold}
                      onChange={(e) => setBadgeForm({ ...badgeForm, criteriaThreshold: parseInt(e.target.value) || 10 })} style={{ fontSize: '0.82rem' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      {t('reconocimientos.badgeReward')}
                    </label>
                    <input className="input" type="number" min={0} value={badgeForm.pointsReward}
                      onChange={(e) => setBadgeForm({ ...badgeForm, pointsReward: parseInt(e.target.value) || 0 })} style={{ fontSize: '0.82rem' }} />
                  </div>
                </div>
                <button className="btn-primary" style={{ fontSize: '0.82rem' }} disabled={badgeSaving || !badgeForm.name.trim()}
                  onClick={async () => {
                    if (!token) return;
                    setBadgeSaving(true);
                    try {
                      const created = await api.recognition.createBadge(token, {
                        name: badgeForm.name, description: badgeForm.description || undefined,
                        icon: badgeForm.icon, color: badgeForm.color,
                        criteria: badgeForm.criteriaType ? { type: badgeForm.criteriaType, threshold: badgeForm.criteriaThreshold } : undefined,
                        pointsReward: badgeForm.pointsReward,
                      });
                      setAllBadges((prev) => [...prev, created]);
                      setBadgeForm({ name: '', description: '', icon: 'star', color: '#c9933a', criteriaType: '', criteriaThreshold: 10, pointsReward: 50 });
                      setShowCreateBadge(false);
                    } catch {}
                    setBadgeSaving(false);
                  }}>
                  {badgeSaving ? t('common.saving') : t('reconocimientos.createBadge')}
                </button>
              </div>
            )}

            {/* Badge cards grid */}
            {allBadges.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {allBadges.map((b: any) => {
                  const earned = (myBadges as any[] || []).some((ub: any) => ub.badgeId === b.id || ub.badge?.id === b.id);
                  return (
                    <div key={b.id} className="card" style={{
                      padding: '1rem', textAlign: 'center',
                      opacity: earned ? 1 : 0.5,
                      border: earned ? '2px solid var(--accent)' : undefined,
                    }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.3rem' }}>{ICONS[b.icon] || '⭐'}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.2rem' }}>{b.name}</div>
                      {b.description && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.3rem' }}>{b.description}</p>}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {b.criteria?.type
                          ? `${b.criteria.type === 'recognitions_received' ? t('reconocimientos.criteriaReceived') : b.criteria.type === 'recognitions_sent' ? t('reconocimientos.criteriaSent') : t('reconocimientos.criteriaPoints')}: ${b.criteria.threshold}`
                          : t('reconocimientos.badgeManualAward')}
                      </div>
                      {b.pointsReward > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>+{b.pointsReward} pts</div>}
                      {earned && <span className="badge badge-success" style={{ fontSize: '0.68rem', marginTop: '0.3rem' }}>{t('reconocimientos.badgeEarned')}</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('reconocimientos.noBadgesDefined')}</p>
            )}
          </div>

          {/* My earned badges */}
          {(!myBadges || (myBadges as any[]).length === 0) && allBadges.length === 0 && (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'🏅'}</p>
              <p>{t('reconocimientos.noBadges')}</p>
            </div>
          )}
        </div>
      )}

      {/* Store Tab */}
      {tab === 'store' && (
        <div className="animate-fade-up">
          {/* My redemption history */}
          {myRedemptions.length > 0 && (
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '0.9rem' }}>{t('reconocimientos.myRedemptions')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {myRedemptions.slice(0, 5).map((r: any) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{r.item?.name || 'Item'}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>-{r.pointsSpent} pts</span>
                      <span className={`badge ${r.status === 'delivered' ? 'badge-success' : r.status === 'cancelled' ? 'badge-danger' : 'badge-accent'}`} style={{ fontSize: '0.68rem' }}>{r.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin: Create catalog item */}
          {isAdmin && (
            <div style={{ marginBottom: '1rem' }}>
              <button className="btn-primary" style={{ fontSize: '0.82rem', marginBottom: '0.75rem' }} onClick={() => setShowCreateItem(!showCreateItem)}>
                {showCreateItem ? t('common.cancel') : t('reconocimientos.createItem')}
              </button>
              {showCreateItem && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.itemName')}</label>
                      <input className="input" value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Ej: Dia libre" style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.itemCategory')}</label>
                      <select className="input" value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} style={{ fontSize: '0.82rem' }}>
                        <option value="">{t('reconocimientos.itemCategoryNone')}</option>
                        <option value="experiencia">{t('reconocimientos.catExperience')}</option>
                        <option value="beneficio">{t('reconocimientos.catBenefit')}</option>
                        <option value="regalo">{t('reconocimientos.catGift')}</option>
                        <option value="tiempo_libre">{t('reconocimientos.catTimeOff')}</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.itemCost')}</label>
                      <input className="input" type="number" min={1} value={itemForm.pointsCost} onChange={e => setItemForm({ ...itemForm, pointsCost: parseInt(e.target.value) || 100 })} style={{ fontSize: '0.82rem' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('reconocimientos.itemStock')}</label>
                      <input className="input" type="number" min={-1} value={itemForm.stock} onChange={e => setItemForm({ ...itemForm, stock: parseInt(e.target.value) })} style={{ fontSize: '0.82rem' }} />
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>-1 = {t('reconocimientos.unlimited')}</span>
                    </div>
                  </div>
                  <button className="btn-primary" style={{ fontSize: '0.82rem' }} disabled={itemSaving || !itemForm.name.trim()}
                    onClick={async () => {
                      if (!token) return;
                      setItemSaving(true);
                      try {
                        const created = await api.recognition.createCatalogItem(token, itemForm);
                        setCatalog(prev => [...prev, created]);
                        setItemForm({ name: '', description: '', pointsCost: 100, category: '', stock: -1 });
                        setShowCreateItem(false);
                      } catch {}
                      setItemSaving(false);
                    }}>
                    {itemSaving ? t('common.saving') : t('reconocimientos.saveItem', 'Guardar Beneficio')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Catalog grid */}
          {catalog.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
              {catalog.map((item: any) => (
                <div key={item.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{item.name}</div>
                    {item.description && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>{item.description}</p>}
                    {item.category && <span className="badge badge-ghost" style={{ fontSize: '0.68rem', marginBottom: '0.5rem' }}>{item.category}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '1rem' }}>{item.pointsCost} pts</span>
                    <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                      disabled={(myPoints?.totalPoints || 0) < item.pointsCost}
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await api.recognition.redeem(token, item.id);
                          const [updatedRedemptions, updatedBudget] = await Promise.all([
                            api.recognition.myRedemptions(token),
                            api.recognition.budget(token),
                          ]);
                          setMyRedemptions(updatedRedemptions);
                          setBudget(updatedBudget);
                        } catch {}
                      }}>
                      {t('reconocimientos.redeem')}
                    </button>
                  </div>
                  {item.stock !== -1 && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{t('reconocimientos.stockLeft')}: {item.stock}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'🛒'}</p>
              <p>{t('reconocimientos.emptyStore')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
