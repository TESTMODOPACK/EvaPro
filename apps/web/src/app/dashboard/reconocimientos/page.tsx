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

const TAB_KEYS = ['wall', 'leaderboard', 'challenges', 'badges'] as const;
const TAB_LABELS: Record<string, string> = { wall: 'Muro', leaderboard: 'Ranking', challenges: 'Desafíos', badges: 'Badges' };
const TAB_ICONS: Record<string, string> = { wall: '\uD83D\uDCE3', leaderboard: '\uD83C\uDFC6', challenges: '\uD83C\uDFAF', badges: '\uD83C\uDFC5' };

function RecognitionCard({ item, onReact }: { item: any; onReact: (id: string, emoji: string) => void }) {
  const [showReactions, setShowReactions] = useState(false);
  const initials = `${item.fromUser.firstName[0]}${item.fromUser.lastName[0]}`;
  return (
    <div className="card" style={{ padding: '1.25rem', marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>
            <strong>{item.fromUser.firstName} {item.fromUser.lastName}</strong>
            <span style={{ color: 'var(--text-muted)', margin: '0 0.3rem' }}>\u2192</span>
            <strong>{item.toUser.firstName} {item.toUser.lastName}</strong>
            {item.value && (
              <span className="badge badge-accent" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                {item.value.name}
              </span>
            )}
          </div>
          <p style={{ margin: '0.25rem 0 0.5rem', fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>{item.message}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              +{item.points} pts \u00B7 {new Date(item.createdAt).toLocaleDateString('es-CL')}
            </span>
            {Object.entries(item.reactions || {}).map(([emoji, users]) => (
              <button key={emoji} onClick={() => onReact(item.id, emoji)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px', fontSize: '0.78rem', cursor: 'pointer' }}>
                {emoji} {Array.isArray(users) ? users.length : String(users)}
              </button>
            ))}
            <button onClick={() => setShowReactions(!showReactions)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px', fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
              +
            </button>
          </div>
          {showReactions && (
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.3rem' }}>
              {REACTIONS.map((r) => (
                <button key={r} onClick={() => { onReact(item.id, r); setShowReactions(false); }}
                  style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', padding: '2px' }}>
                  {r}
                </button>
              ))}
            </div>
          )}
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
      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>\u2728 {t('reconocimientos.sendTitle')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <select className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)} required>
          <option value="">{t('reconocimientos.selectPerson')}</option>
          {(Array.isArray(users) ? users : []).filter((u: any) => u.id !== user?.userId).map((u: any) => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.department ? ` \u2014 ${u.department}` : ''}</option>
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
  const [tab, setTab] = useState<'wall' | 'leaderboard' | 'challenges' | 'badges'>('wall');
  const [myChallenges, setMyChallenges] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<string>('month');
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
  }, [token]);

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
      </div>

      {/* Stats Cards */}
      <div className="animate-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { value: myPoints?.totalPoints || 0, label: t('reconocimientos.myPoints') },
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
          <NewRecognitionForm onSuccess={() => refetchWall()} t={t} />
          {wall?.data?.length === 0 && (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>\u2728</p>
              <p>{t('reconocimientos.emptyWall')}</p>
            </div>
          )}
          {wall?.data?.map((item: any) => (
            <RecognitionCard key={item.id} item={item} onReact={handleReact} />
          ))}
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
                  {(leaderboard || []).map((entry: any) => (
                    <tr key={entry.userId}>
                      <td style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {entry.rank <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][entry.rank - 1] : entry.rank}
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
                  {(!leaderboard || leaderboard.length === 0) && (
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
          {myChallenges.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\uD83C\uDFAF'}</p>
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
          {(!myBadges || (myBadges as any[]).length === 0) && (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>\uD83C\uDFC5</p>
              <p>{t('reconocimientos.noBadges')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
