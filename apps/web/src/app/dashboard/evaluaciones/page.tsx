'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { useCycles } from '@/hooks/useCycles';
import { usePendingEvaluations, useMyCompletedEvaluations } from '@/hooks/useEvaluations';
import { useAuthStore } from '@/store/auth.store';
import { ScoreBadge, ScaleLegend } from '@/components/ScoreBadge';
import Link from 'next/link';
import {
  cycleStatusLabel, cycleStatusBadge,
  cycleTypeBadge, assignmentStatusLabel as evalStatusLabels,
  assignmentStatusBadge as evalStatusBadge,
  relationTypeLabel as relationLabels,
} from '@/lib/statusMaps';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import ConfirmModal from '@/components/ConfirmModal';

const typeLabels: Record<string, string> = {
  '90': '90\u00b0',
  '180': '180\u00b0',
  '270': '270\u00b0',
  '360': '360\u00b0',
};

const statusLabels = cycleStatusLabel;
const statusBadge = cycleStatusBadge;
const typeBadge = cycleTypeBadge;

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Employee view: only their assignments ──────────────────────────────────

function EmployeeEvaluationsView() {
  const { t } = useTranslation();
  const { data: pendingEvals, isLoading: loadingPending } = usePendingEvaluations();
  const { data: completedEvals, isLoading: loadingCompleted } = useMyCompletedEvaluations();
  const userId = useAuthStore((s) => s.user?.userId);

  const pending = pendingEvals || [];
  const allCompleted = completedEvals || [];

  // Filters + pagination for completed
  const [compSearch, setCompSearch] = useState('');
  const [compCycleFilter, setCompCycleFilter] = useState('');
  const [compPage, setCompPage] = useState(1);
  const compPageSize = 10;

  const compCycles = Array.from(new Set(allCompleted.map((e: any) => e.cycle?.name).filter(Boolean)));

  const filteredCompleted = allCompleted.filter((ev: any) => {
    if (compCycleFilter && ev.cycle?.name !== compCycleFilter) return false;
    if (compSearch) {
      const q = compSearch.toLowerCase();
      const name = ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}`.toLowerCase() : '';
      if (!name.includes(q) && !(ev.cycle?.name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const compTotalPages = Math.ceil(filteredCompleted.length / compPageSize);
  const completed = filteredCompleted.slice((compPage - 1) * compPageSize, compPage * compPageSize);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('evaluaciones.myTitle')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('evaluaciones.subtitle')}
        </p>
      </div>

      {/* Summary cards */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('evaluaciones.pending')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: pending.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{pending.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>{t('evaluaciones.completed')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{completed.length}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.4rem' }}>Total</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{pending.length + completed.length}</div>
        </div>
      </div>

      {/* Scale legend */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '1.5rem' }}>
        <ScaleLegend />
      </div>

      {/* Pending evaluations */}
      <div className="animate-fade-up-delay-1" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
          {t('evaluaciones.pendingEvals')}
        </h2>

        {loadingPending ? <Spinner /> : pending.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('evaluaciones.noPending')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pending.map((ev: any) => (
              <div key={ev.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : t('evaluaciones.unassigned')}
                    </span>
                    {ev.evaluateeId === userId && (
                      <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{t('evaluaciones.itsYou')}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {t('evaluaciones.typeLabel')}: <strong style={{ color: 'var(--text-secondary)' }}>{relationLabels[ev.relationType] || ev.relationType}</strong>
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {t('evaluaciones.cycleLabel')}: <strong style={{ color: 'var(--text-secondary)' }}>{ev.cycle?.name || '--'}</strong>
                    </span>
                    {ev.dueDate && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {t('evaluaciones.dueDate')}: <strong style={{ color: 'var(--warning)' }}>{new Date(ev.dueDate).toLocaleDateString('es-ES')}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/dashboard/evaluaciones/${ev.cycleId}/responder/${ev.id}`}
                  className="btn-primary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                >
                  {t('evaluaciones.respond')}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed evaluations */}
      <div className="animate-fade-up-delay-2">
        <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          {t('evaluaciones.completedEvals')}
          {allCompleted.length > 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({filteredCompleted.length})</span>}
        </h2>

        {/* Filters */}
        {allCompleted.length > 0 && (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input className="input" type="text" placeholder="Buscar evaluado..." value={compSearch}
              onChange={(e) => { setCompSearch(e.target.value); setCompPage(1); }}
              style={{ flex: '1 1 200px', fontSize: '0.82rem', minWidth: '160px' }} />
            <select className="input" value={compCycleFilter} onChange={(e) => { setCompCycleFilter(e.target.value); setCompPage(1); }}
              style={{ flex: '0 1 280px', fontSize: '0.82rem' }}>
              <option value="">Todos los ciclos</option>
              {compCycles.map((c: any) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {loadingCompleted ? <Spinner /> : filteredCompleted.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {allCompleted.length === 0 ? t('evaluaciones.noCompletedYet') : 'No se encontraron resultados con los filtros seleccionados'}
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>{t('evaluaciones.evaluatedCol')}</th>
                    <th>{t('evaluaciones.typeLabel')}</th>
                    <th>{t('evaluaciones.cycleLabel')}</th>
                    <th>{t('evaluaciones.score')}</th>
                    <th>{t('evaluaciones.dateCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((ev: any) => (
                    <tr key={ev.id}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {ev.evaluatee ? `${ev.evaluatee.firstName} ${ev.evaluatee.lastName}` : '--'}
                        {ev.evaluateeId === userId && <span className="badge badge-accent" style={{ marginLeft: '0.4rem', fontSize: '0.6rem' }}>{t('evaluaciones.you')}</span>}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{relationLabels[ev.relationType] || ev.relationType}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{ev.cycle?.name || '--'}</td>
                      <td>
                        <ScoreBadge score={ev.response?.overallScore} size="sm" />
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {ev.completedAt ? new Date(ev.completedAt).toLocaleDateString('es-ES') : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {compTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', padding: '0.5rem 0' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Mostrando {(compPage - 1) * compPageSize + 1}-{Math.min(compPage * compPageSize, filteredCompleted.length)} de {filteredCompleted.length}
                </span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button className="btn-ghost" disabled={compPage <= 1} onClick={() => setCompPage(p => p - 1)}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>Anterior</button>
                  {Array.from({ length: Math.min(compTotalPages, 5) }, (_, i) => {
                    const start = Math.max(1, Math.min(compPage - 2, compTotalPages - 4));
                    const p = start + i;
                    if (p > compTotalPages) return null;
                    return (
                      <button key={p} onClick={() => setCompPage(p)}
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', fontWeight: p === compPage ? 700 : 400, background: p === compPage ? 'var(--accent)' : 'transparent', color: p === compPage ? 'white' : 'var(--text-secondary)', border: p === compPage ? 'none' : '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', minWidth: '30px' }}>
                        {p}
                      </button>
                    );
                  })}
                  <button className="btn-ghost" disabled={compPage >= compTotalPages} onClick={() => setCompPage(p => p + 1)}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>Siguiente</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Admin/Manager view: cycles overview ────────────────────────────────────

function AdminEvaluationsView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: cycles, isLoading } = useCycles();
  const userRole = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token)!;
  const isAdmin = userRole === 'tenant_admin';
  const [showGuide, setShowGuide] = useState(false);
  const toast = useToastStore();
  const [confirmState, setConfirmState] = useState<{
    message: string; detail?: string; onConfirm: () => void;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  async function handleDeleteCycle(cycleId: string, cycleName: string) {
    setConfirmState({
      message: `¿Eliminar el ciclo "${cycleName}"?`,
      detail: 'Esta acción no se puede deshacer. El ciclo será eliminado permanentemente.',
      onConfirm: async () => {
        setConfirmState(null);
        setDeleting(cycleId);
        try {
          await api.cycles.remove(token, cycleId);
          toast.success(`Ciclo "${cycleName}" eliminado correctamente`);
          queryClient.invalidateQueries({ queryKey: ['cycles'] });
        } catch (e: any) {
          toast.error(e?.message || 'Error al eliminar el ciclo');
        } finally {
          setDeleting(null);
        }
      },
    });
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('evaluaciones.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('evaluaciones.title')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? t('common.hideGuide') : t('common.showGuide')}
          </button>
          {isAdmin && (
            <Link href="/dashboard/evaluaciones/nuevo" style={{ textDecoration: 'none' }}>
              <button className="btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('evaluaciones.newCycle')}
              </button>
            </Link>
          )}
        </div>
      </div>

      {/* Guide / Explainer */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {t('evaluaciones.guide.title')}
          </h3>

          {/* Section 1 */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.guide.whatIs')}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              {t('evaluaciones.guide.whatIsDesc')}
            </p>
          </div>

          {/* Section 2 - Types */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.guide.types')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {['type90', 'type180', 'type270', 'type360'].map((key) => (
                <div key={key} style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t(`evaluaciones.guide.${key}`)}
                </div>
              ))}
            </div>
          </div>

          {/* Section 3 - Stages */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {t('evaluaciones.guide.stages')}
              <span className="badge badge-accent" style={{ fontSize: '0.6rem' }}>{t('evaluaciones.guide.stagesNew')}</span>
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('evaluaciones.guide.stagesAutomatic')}</li>
              <li>{t('evaluaciones.guide.stagesComplete')}</li>
              <li style={{ marginTop: '0.25rem' }}><strong>{t('evaluaciones.guide.stagesFlow')}</strong></li>
            </ul>
          </div>

          {/* Section 4 - Flow */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('evaluaciones.guide.flow')}</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              {['flowStep1', 'flowStep2', 'flowStep3', 'flowStep4', 'flowStep5', 'flowStep6'].map((key) => (
                <li key={key}>{t(`evaluaciones.guide.${key}`)}</li>
              ))}
            </ol>
          </div>

          {/* Section 5 - Anonymity */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {t('evaluaciones.guide.anonymity')}
              <span className="badge badge-accent" style={{ fontSize: '0.6rem' }}>{t('evaluaciones.guide.anonymityNew')}</span>
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('evaluaciones.guide.anonymityConfig')}</li>
              <li>{t('evaluaciones.guide.anonymityDefault')}</li>
            </ul>
          </div>

          {/* Section 6 - Permissions */}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('evaluaciones.guide.permissions')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {['permAdmin', 'permManager', 'permEmployee'].map((key) => (
                <div key={key} style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t(`evaluaciones.guide.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {cycles && cycles.length > 0 && (
        <div className="animate-fade-up" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('evaluaciones.allStatuses')}</option>
            <option value="draft">{t('status.cycle.draft')}</option>
            <option value="active">{t('status.cycle.active')}</option>
            <option value="paused">{t('status.process.in_progress')}</option>
            <option value="closed">{t('status.cycle.closed')}</option>
          </select>
          <select
            style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
            value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">{t('evaluaciones.allYears')}</option>
            {Array.from(new Set((cycles || []).map((c: any) => c.startDate ? new Date(c.startDate).getFullYear().toString() : '').filter(Boolean))).sort().reverse().map((y: any) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {(() => {
              let f = cycles || [];
              if (statusFilter) f = f.filter((c: any) => c.status === statusFilter);
              if (yearFilter) f = f.filter((c: any) => c.startDate && new Date(c.startDate).getFullYear().toString() === yearFilter);
              return `${f.length} de ${cycles.length} ciclos`;
            })()}
          </span>
        </div>
      )}

      {isLoading ? (
        <PageSkeleton cards={0} tableRows={4} />
      ) : !cycles || cycles.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {t('evaluaciones.noCycles')}
          </p>
          {isAdmin && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {t('evaluaciones.createFirstCycle')}
            </p>
          )}
        </div>
      ) : (
        <div
          className="animate-fade-up-delay-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
        >
          {(cycles as any[]).filter((c: any) => {
            if (statusFilter && c.status !== statusFilter) return false;
            if (yearFilter && c.startDate && new Date(c.startDate).getFullYear().toString() !== yearFilter) return false;
            return true;
          }).map((cycle: any) => {
            const startDate = cycle.startDate
              ? new Date(cycle.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '\u2013';
            const endDate = cycle.endDate
              ? new Date(cycle.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '\u2013';
            const totalEval = cycle.totalEvaluated || 0;

            return (
              <Link
                key={cycle.id}
                href={`/dashboard/evaluaciones/${cycle.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  className="card"
                  style={{ padding: '1.4rem', cursor: 'pointer', transition: 'var(--transition)', height: '100%' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
                    <span className={`badge ${typeBadge[cycle.type] || 'badge-accent'}`}>
                      {typeLabels[cycle.type] || cycle.type}
                    </span>
                    <span className={`badge ${statusBadge[cycle.status] || 'badge-accent'}`}>
                      {statusLabels[cycle.status] || cycle.status}
                    </span>
                  </div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4 }}>
                    {cycle.name}
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    {startDate}{' \u2014 '}{endDate}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                    {totalEval} evaluado{totalEval !== 1 ? 's' : ''}
                  </p>

                  {cycle.status === 'active' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('evaluaciones.progress')}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-hover)' }}>
                          {totalEval > 0 ? t('evaluaciones.inProgress') : t('evaluaciones.noAssignments')}
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{
                          width: totalEval > 0 ? '50%' : '0%',
                          height: '100%', borderRadius: '999px',
                          background: 'var(--accent)',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  )}

                  {cycle.status === 'closed' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('evaluaciones.completedStatus')}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)' }}>100%</span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: '999px', background: 'var(--success)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}

                  {/* Delete button — only visible for draft cycles, admins only */}
                  {isAdmin && cycle.status === 'draft' && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteCycle(cycle.id, cycle.name);
                        }}
                        disabled={deleting === cycle.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.35rem',
                          padding: '0.3rem 0.65rem', borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)',
                          color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                          transition: 'all 0.15s',
                          opacity: deleting === cycle.id ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                        title="Solo se pueden eliminar ciclos en estado Borrador"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                        {deleting === cycle.id ? t('evaluaciones.deleting') : t('evaluaciones.deleteDraft')}
                      </button>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          detail={confirmState.detail}
          danger
          confirmLabel="Eliminar"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

// ─── Main: route by role ────────────────────────────────────────────────────

export default function EvaluacionesPage() {
  const userRole = useAuthStore((s) => s.user?.role);

  // Solo el Encargado del Sistema ve la vista administrativa de ciclos
  if (userRole === 'tenant_admin') {
    return <AdminEvaluationsView />;
  }

  // Encargado de Equipo, Colaborador y Asesor Externo ven sus evaluaciones personales
  return <EmployeeEvaluationsView />;
}
