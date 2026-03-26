'use client';

import { useState } from 'react';
import {
  useRecognitionWall, useCreateRecognition, useAddReaction,
  useMyBadges, useMyPoints, useLeaderboard, useRecognitionStats,
} from '@/hooks/useRecognition';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ─── Badge Icons ─────────────────────────────────────────────── */
const ICONS: Record<string, string> = {
  star: '\u2B50', trophy: '\uD83C\uDFC6', rocket: '\uD83D\uDE80', heart: '\u2764\uFE0F',
  fire: '\uD83D\uDD25', diamond: '\uD83D\uDC8E', crown: '\uD83D\uDC51', medal: '\uD83C\uDFC5',
  lightning: '\u26A1', brain: '\uD83E\uDDE0', handshake: '\uD83E\uDD1D', target: '\uD83C\uDFAF',
};

const REACTIONS = ['\uD83D\uDC4F', '\u2764\uFE0F', '\uD83D\uDE80', '\uD83D\uDD25', '\uD83D\uDCAA', '\uD83C\uDF1F'];

/* ─── Recognition Card ────────────────────────────────────────── */
function RecognitionCard({ item, onReact }: { item: any; onReact: (id: string, emoji: string) => void }) {
  const [showReactions, setShowReactions] = useState(false);
  return (
    <div className="card" style={{ padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
        }}>
          {item.fromUser.firstName[0]}{item.fromUser.lastName[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.85rem' }}>
            <strong>{item.fromUser.firstName} {item.fromUser.lastName}</strong>
            <span style={{ color: 'var(--text-muted)', margin: '0 0.25rem' }}>{'\u2192'}</span>
            <strong>{item.toUser.firstName} {item.toUser.lastName}</strong>
            {item.value && (
              <span className="badge" style={{ marginLeft: '0.5rem', fontSize: '0.7rem', background: '#ede9fe', color: '#7c3aed' }}>
                {item.value.name}
              </span>
            )}
          </div>
          <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', lineHeight: 1.5 }}>{item.message}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              +{item.points} pts {'\u00B7'} {new Date(item.createdAt).toLocaleDateString('es-CL')}
            </span>
            {Object.entries(item.reactions || {}).map(([emoji, users]) => (
              <button key={emoji} onClick={() => onReact(item.id, emoji)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}>
                {emoji} {Array.isArray(users) ? users.length : String(users)}
              </button>
            ))}
            <button onClick={() => setShowReactions(!showReactions)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
              +
            </button>
          </div>
          {showReactions && (
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
              {REACTIONS.map((r) => (
                <button key={r} onClick={() => { onReact(item.id, r); setShowReactions(false); }}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '2px' }}>
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

/* ─── New Recognition Form ────────────────────────────────────── */
function NewRecognitionForm({ onSuccess }: { onSuccess: () => void }) {
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
    <form onSubmit={handleSubmit} className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.75rem' }}>{'\u2728'} Enviar reconocimiento</h4>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} required
          style={{ flex: 1, minWidth: '200px', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <option value="">Seleccionar persona...</option>
          {(Array.isArray(users) ? users : []).filter((u: any) => u.id !== user?.userId).map((u: any) => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} — {u.department}</option>
          ))}
        </select>
        <select value={valueId} onChange={(e) => setValueId(e.target.value)}
          style={{ minWidth: '150px', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <option value="">Valor corporativo (opcional)</option>
          {(Array.isArray(competencies) ? competencies : []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} ({c.category})</option>
          ))}
        </select>
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} required
        placeholder="Escribe tu reconocimiento..." rows={2}
        style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
      {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={createMut.isPending}
        style={{ marginTop: '0.5rem' }}>
        {createMut.isPending ? 'Enviando...' : 'Enviar reconocimiento'}
      </button>
    </form>
  );
}

/* ─── Main Page ───────────────────────────────────────────────── */
export default function ReconocimientosPage() {
  const [tab, setTab] = useState<'wall' | 'leaderboard' | 'badges'>('wall');
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

  return (
    <div style={{ maxWidth: '900px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Reconocimientos</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Reconoce a tus compa&ntilde;eros, gana puntos y obt&eacute;n badges por tus logros.
      </p>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{myPoints?.totalPoints || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mis Puntos</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>{(myBadges as any)?.length || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mis Badges</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>{stats?.totalRecognitions || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Reconocimientos</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8b5cf6' }}>{stats?.monthlyRecognitions || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Este Mes</div>
        </div>
      </div>

      {/* My Badges Row */}
      {(myBadges as any)?.length > 0 && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Mis Badges</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(myBadges as any[]).map((ub: any) => (
              <div key={ub.id} title={ub.badge?.description || ub.badge?.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  background: ub.badge?.color + '20', border: `1px solid ${ub.badge?.color}40`,
                  borderRadius: 20, padding: '4px 10px', fontSize: '0.8rem',
                }}>
                <span>{ICONS[ub.badge?.icon] || '\u2B50'}</span>
                <span style={{ fontWeight: 600 }}>{ub.badge?.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
        {(['wall', 'leaderboard', 'badges'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '0.5rem 1rem', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tab === t ? 'var(--primary)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text-muted)', fontWeight: tab === t ? 600 : 400,
            }}>
            {t === 'wall' ? '\uD83D\uDCE3 Muro' : t === 'leaderboard' ? '\uD83C\uDFC6 Ranking' : '\uD83C\uDFC5 Badges'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'wall' && (
        <>
          <NewRecognitionForm onSuccess={() => refetchWall()} />
          {wall?.data?.length === 0 && (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\u2728'}</p>
              <p>A&uacute;n no hay reconocimientos. S&eacute; el primero en reconocer a un compa&ntilde;ero.</p>
            </div>
          )}
          {wall?.data?.map((item: any) => (
            <RecognitionCard key={item.id} item={item} onReact={handleReact} />
          ))}
          {wall?.meta && wall.meta.totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn">Anterior</button>
              <span style={{ padding: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                P&aacute;g {page} de {wall.meta.totalPages}
              </span>
              <button disabled={page >= wall.meta.totalPages} onClick={() => setPage(page + 1)} className="btn">Siguiente</button>
            </div>
          )}
        </>
      )}

      {tab === 'leaderboard' && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {[
              { val: 'week', label: 'Semana' }, { val: 'month', label: 'Mes' },
              { val: 'quarter', label: 'Trimestre' }, { val: 'all', label: 'Todo' },
            ].map((p) => (
              <button key={p.val} onClick={() => setPeriod(p.val)}
                className={`btn ${period === p.val ? 'btn-primary' : ''}`}
                style={{ fontSize: '0.8rem' }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', width: 50 }}>#</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Colaborador</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Departamento</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Puntos</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboard || []).map((entry: any) => (
                  <tr key={entry.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 700, fontSize: '1.1rem' }}>
                      {entry.rank <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][entry.rank - 1] : entry.rank}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ fontWeight: 600 }}>{entry.userName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entry.position}</div>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{entry.department}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                      {entry.totalPoints} pts
                    </td>
                  </tr>
                ))}
                {(!leaderboard || leaderboard.length === 0) && (
                  <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Sin datos para este per&iacute;odo
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'badges' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {(stats?.topValues || []).length > 0 && (
            <div className="card" style={{ padding: '1rem', gridColumn: '1 / -1' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Valores m&aacute;s reconocidos</h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {stats.topValues.map((v: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ fontWeight: 600 }}>{v.valueName}</span>
                    <span className="badge badge-info">{v.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(myBadges as any[] || []).length === 0 && (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\uD83C\uDFC5'}</p>
              <p>A&uacute;n no has obtenido badges. Sigue participando para ganarlos.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
