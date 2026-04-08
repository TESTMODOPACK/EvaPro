'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter, useParams } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useToastStore } from '@/store/toast.store';
import {
  useCycleById,
  useCycleAssignments,
  useLaunchCycle,
  useCloseCycle,
} from '@/hooks/useCycles';
import { usePeerAssignments, useAddPeerAssignment, useRemovePeerAssignment } from '@/hooks/usePeerAssignments';
import { useUsers } from '@/hooks/useUsers';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  relationTypeLabel as relationLabels,
  assignmentStatusBadge as statusBadge,
  assignmentStatusLabel as statusLabels,
  cycleStatusBadge,
  cycleStatusLabel as cycleStatusLabels,
} from '@/lib/statusMaps';

export default function CycleDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const toast = useToastStore();
  const user = useAuthStore((s) => s.user);
  const { data: cycle, isLoading, isError } = useCycleById(id);
  const { data: assignments } = useCycleAssignments(id);
  const launchCycle = useLaunchCycle();
  const closeCycle = useCloseCycle();

  // Template data
  const [template, setTemplate] = useState<any>(null);
  const [showTemplate, setShowTemplate] = useState(false);

  // Peer assignment hooks
  const { data: peerAssignments } = usePeerAssignments(id);
  const addPeer = useAddPeerAssignment();
  const removePeer = useRemovePeerAssignment();
  const { data: usersData } = useUsers(1, 500);

  const token = useAuthStore((s) => s.token);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    detail?: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Load template when cycle has templateId
  useEffect(() => {
    if (!cycle?.templateId || !token) return;
    api.templates.getById(token, cycle.templateId).then(setTemplate).catch(() => {});
  }, [cycle?.templateId, token]);

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [closing, setClosing] = useState(false);

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editForm, setEditForm] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [peerEvaluateeId, setPeerEvaluateeId] = useState('');
  const [peerEvaluatorId, setPeerEvaluatorId] = useState('');
  const [peerRelationType, setPeerRelationType] = useState('');
  const [manualDeptFilter, setManualDeptFilter] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Exception assignment states
  const [excRelationType, setExcRelationType] = useState('manager');
  const [excEvaluateeId, setExcEvaluateeId] = useState('');
  const [excEvaluatorId, setExcEvaluatorId] = useState('');
  const [excDeptFilter, setExcDeptFilter] = useState('');
  const [excEvalDeptFilter, setExcEvalDeptFilter] = useState('');
  const [allowedRelations, setAllowedRelations] = useState<{ value: string; label: string }[]>([]);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoGenResult, setAutoGenResult] = useState<{
    created: number;
    skipped: number;
    exceptions: Array<{
      evaluateeId: string;
      evaluateeName: string;
      department: string | null;
      type: string;
      message: string;
      relationType: string;
      available?: number;
      required?: number;
    }>;
  } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [cycleHistory, setCycleHistory] = useState<any[]>([]);

  // ── Departments from Mantenedores ────────────────────────────────────────
  const { departments: deptOptions } = useDepartments();

  // ── Filters: peer section (draft) ───────────────────────────────────────
  const [peerFilterSearch, setPeerFilterSearch] = useState('');
  const [peerFilterDept, setPeerFilterDept] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // ── Filters: assignments table (active/closed) ───────────────────────────
  const [assignFilterSearch, setAssignFilterSearch] = useState('');
  const [assignFilterDept, setAssignFilterDept] = useState('');
  const [assignFilterStatus, setAssignFilterStatus] = useState('');
  const [assignFilterRelation, setAssignFilterRelation] = useState('');

  // Fetch allowed relations when cycle loads
  useEffect(() => {
    if (!cycle || !token || cycle.status !== 'draft') return;
    api.peerAssignments.allowedRelations(token, id).then((rels) => {
      setAllowedRelations(rels);
      if (rels.length > 0 && !peerRelationType) setPeerRelationType(rels[0].value);
    }).catch(() => {});
  }, [cycle?.id, cycle?.status, cycle?.type, token]);

  // Fetch cycle change history
  useEffect(() => {
    if (!token || !cycle?.id) return;
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
    fetch(`${API}/evaluations/evaluation-cycles/${cycle.id}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : []).then(setCycleHistory).catch(() => {});
  }, [token, cycle?.id]);

  const handleAutoGenerate = async () => {
    if (!token) return;
    setConfirmState({
      message: t('evaluaciones.detail.confirmAutoGen'),
      detail: t('evaluaciones.detail.autoGenDetail'),
      danger: false,
      onConfirm: async () => {
        setConfirmState(null);
        setAutoGenerating(true);
        setAutoGenResult(null);
        try {
          const result = await api.peerAssignments.autoGenerate(token, id);
          setAutoGenResult(result);
          if (result.exceptions.length === 0) {
            toast.success(`${result.created} asignaciones creadas exitosamente`);
            window.location.reload();
          }
          // If there are exceptions, the report modal will show automatically
        } catch (e: any) {
          toast.error(e.message || 'Error al generar asignaciones');
        } finally {
          setAutoGenerating(false);
        }
      },
    });
  };

  const handleLaunch = async () => {
    setConfirmState({
      message: t('evaluaciones.detail.confirmLaunch'),
      detail: t('evaluaciones.detail.launchDetail'),
      danger: false,
      onConfirm: async () => {
        setConfirmState(null);
        setLaunching(true);
        setLaunchError('');
        try {
          await launchCycle.mutateAsync(id);
        } catch (e: any) {
          setLaunchError(
            e?.message || 'Error al lanzar el ciclo. Verifica que el ciclo tenga asignaciones configuradas e inténtalo de nuevo.',
          );
        } finally {
          setLaunching(false);
        }
      },
    });
  };

  const handleClose = async () => {
    setConfirmState({
      message: t('evaluaciones.detail.confirmClose'),
      detail: t('evaluaciones.detail.closeDetail'),
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        setClosing(true);
        try {
          await closeCycle.mutateAsync(id);
        } finally {
          setClosing(false);
        }
      },
    });
  };

  const openEdit = () => {
    if (!cycle) return;
    setEditForm({
      name: cycle.name || '',
      description: cycle.description || '',
      startDate: cycle.startDate ? String(cycle.startDate).split('T')[0] : '',
      endDate:   cycle.endDate   ? String(cycle.endDate).split('T')[0]   : '',
    });
    setEditError('');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!token) return;
    setEditSaving(true);
    setEditError('');
    try {
      await api.cycles.update(token, id, {
        name:        editForm.name.trim()        || undefined,
        description: editForm.description.trim() || undefined,
        startDate:   editForm.startDate          || undefined,
        endDate:     editForm.endDate            || undefined,
      });
      setEditing(false);
      window.location.reload();
    } catch (e: any) {
      setEditError(e.message || 'Error al guardar los cambios. Verifica las fechas e inténtalo de nuevo.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddPeer = async () => {
    if (!peerEvaluateeId) return;
    const evaluatorId = peerRelationType === 'self' ? peerEvaluateeId : peerEvaluatorId;
    if (!evaluatorId) return;

    // Check for duplicate assignment
    const duplicate = peerList.some((pa: any) =>
      pa.evaluateeId === peerEvaluateeId &&
      pa.evaluatorId === evaluatorId &&
      pa.relationType === peerRelationType
    );
    if (duplicate) {
      toast.error('Esta asignación ya existe. Elimínela primero si desea cambiarla.');
      return;
    }

    try {
      await addPeer.mutateAsync({ cycleId: id, evaluateeId: peerEvaluateeId, evaluatorId, relationType: peerRelationType });
      setPeerEvaluateeId('');
      setPeerEvaluatorId('');
    } catch (e: any) {
      toast.error(e.message || 'Error al agregar asignación');
    }
  };

  const handleRemovePeer = async (peerAssignmentId: string) => {
    await removePeer.mutateAsync({ cycleId: id, id: peerAssignmentId });
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('evaluaciones.detail.loading')}</p>
      </div>
    );
  }

  if (isError || !cycle) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--danger)' }}>{t('evaluaciones.detail.loadError')}</p>
        <button
          className="btn-ghost"
          onClick={() => router.push('/dashboard/evaluaciones')}
          style={{ marginTop: '1rem' }}
        >
          &larr; {t('evaluaciones.detail.backToEvals')}
        </button>
      </div>
    );
  }

  const assignmentList: any[] = Array.isArray(assignments) ? assignments : [];
  const totalAssignments = assignmentList.length;
  const completedAssignments = assignmentList.filter(
    (a: any) => a.status === 'completed' || a.status === 'submitted',
  ).length;
  const progressPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

  const peerList: any[] = Array.isArray(peerAssignments) ? peerAssignments : [];
  const usersList: any[] = Array.isArray(usersData) ? usersData : (usersData as any)?.data ?? [];

  // Group peer assignments by evaluatee for cleaner display
  const peerListGrouped: Record<string, any[]> = peerList.reduce((acc, pa) => {
    const key = pa.evaluateeId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pa);
    return acc;
  }, {} as Record<string, any[]>);
  const showPeerSection = cycle.status === 'draft';

  // ── Filtered peer groups ───────────────────────────────────────────────
  const filteredPeerEntries = Object.entries(peerListGrouped).filter(([, assignments]) => {
    const evaluatee = (assignments as any[])[0]?.evaluatee;
    const name = evaluatee
      ? `${evaluatee.firstName || ''} ${evaluatee.lastName || ''}`.toLowerCase()
      : '';
    if (peerFilterSearch && !name.includes(peerFilterSearch.toLowerCase())) return false;
    if (peerFilterDept && (evaluatee?.department || '') !== peerFilterDept) return false;
    return true;
  });

  // ── Filtered assignments ───────────────────────────────────────────────
  const uniqueRelations: string[] = Array.from(new Set(assignmentList.map((a: any) => a.relationType).filter(Boolean))) as string[];
  const filteredAssignments = assignmentList.filter((a: any) => {
    const evaluateeName = `${a.evaluatee?.firstName || ''} ${a.evaluatee?.lastName || ''}`.toLowerCase();
    const evaluatorName  = `${a.evaluator?.firstName  || ''} ${a.evaluator?.lastName  || ''}`.toLowerCase();
    if (assignFilterSearch) {
      const s = assignFilterSearch.toLowerCase();
      if (!evaluateeName.includes(s) && !evaluatorName.includes(s)) return false;
    }
    if (assignFilterDept     && (a.evaluatee?.department || '') !== assignFilterDept) return false;
    if (assignFilterStatus   && a.status !== assignFilterStatus) return false;
    if (assignFilterRelation && a.relationType !== assignFilterRelation) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Back link */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn-ghost"
          onClick={() => router.push('/dashboard/evaluaciones')}
          style={{ fontSize: '0.82rem', padding: '0.3rem 0.65rem' }}
        >
          &larr; {t('evaluaciones.detail.backToEvals')}
        </button>
      </div>

      {/* Cycle header */}
      <div
        className="card animate-fade-up"
        style={{ padding: '1.75rem', marginBottom: '1.5rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1rem',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              {cycle.name}
            </h1>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${cycleStatusBadge[cycle.status] || 'badge-accent'}`}>
                {cycleStatusLabels[cycle.status] || cycle.status}
              </span>
              {cycle.type && (
                <span className="badge badge-accent">{cycle.type}&deg;</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {cycle.status !== 'closed' && !editing && (
              <button
                className="btn-ghost"
                onClick={openEdit}
                style={{ fontSize: '0.82rem' }}
              >
                {t('evaluaciones.detail.editCycle')}
              </button>
            )}
            {cycle.status === 'draft' && (
              <button
                className="btn-primary"
                onClick={handleLaunch}
                disabled={launching}
                style={{ opacity: launching ? 0.6 : 1 }}
              >
                {launching ? t('evaluaciones.detail.launching') : t('evaluaciones.detail.launchCycle')}
              </button>
            )}
            {cycle.status === 'active' && (
              <>
                <button
                  className="btn-ghost"
                  onClick={() =>
                    toast.success(t('evaluaciones.detail.reminderSent'))
                  }
                  style={{ fontSize: '0.85rem' }}
                >
                  {t('evaluaciones.detail.sendReminder')}
                </button>
                <button
                  className="btn-primary"
                  onClick={handleClose}
                  disabled={closing}
                  style={{
                    opacity: closing ? 0.6 : 1,
                    background: 'var(--danger)',
                  }}
                >
                  {closing ? t('evaluaciones.detail.closing') : t('evaluaciones.detail.closeCycle')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline edit form */}
        {editing && (
          <div style={{
            marginBottom: '1rem', padding: '1.25rem',
            background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: '1rem',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('evaluaciones.detail.cycleName')}
                </label>
                <input
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre del ciclo..."
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('evaluaciones.detail.startDate')}
                </label>
                <input
                  className="input"
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('evaluaciones.detail.endDate')}
                </label>
                <input
                  className="input"
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('evaluaciones.detail.descriptionLabel')}
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Descripción del ciclo..."
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
            {editError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: 0 }}>⚠ {editError}</p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={editSaving}
                style={{ opacity: editSaving ? 0.6 : 1 }}
              >
                {editSaving ? t('common.saving') : t('common.save')}
              </button>
              <button
                className="btn-ghost"
                onClick={() => setEditing(false)}
                disabled={editSaving}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Details row — visual summary cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {cycle.startDate && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.9rem 1rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>{t('evaluaciones.detail.start')}</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {new Date(cycle.startDate).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            </div>
          )}
          {cycle.endDate && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.9rem 1rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                background: 'rgba(239,68,68,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  <polyline points="9 14 11 16 15 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>{t('evaluaciones.detail.end')}</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {new Date(cycle.endDate).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.9rem 1rem', background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
          }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
              background: 'rgba(201,147,58,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C9933A" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>{t('evaluaciones.detail.assignments')}</div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {completedAssignments}/{totalAssignments}
                {totalAssignments > 0 && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                    ({progressPct}%)
                  </span>
                )}
              </div>
            </div>
          </div>
          {cycle.type && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.9rem 1rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                background: 'rgba(16,185,129,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>{t('evaluaciones.detail.typeLabel')}</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t('evaluaciones.detail.evaluation')} {cycle.type}°
                </div>
              </div>
            </div>
          )}
        </div>

        {launchError && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span>&#9888; {launchError}</span>
            <button
              onClick={() => setLaunchError('')}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}
            >
              &times;
            </button>
          </div>
        )}

        {cycle.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '1rem' }}>
            {cycle.description}
          </p>
        )}
      </div>

      {/* Progress bar (active/closed) */}
      {(cycle.status === 'active' || cycle.status === 'closed') && totalAssignments > 0 && (
        <div
          className="card animate-fade-up"
          style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Progreso general &mdash; {completedAssignments}/{totalAssignments} completadas
            </span>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: progressPct === 100 ? 'var(--success)' : 'var(--accent-hover)',
              }}
            >
              {progressPct}%
            </span>
          </div>
          <div style={{ height: '8px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                borderRadius: '999px',
                background: progressPct === 100 ? 'var(--success)' : 'var(--accent)',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Template section */}
      {template && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTemplate ? '0.75rem' : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1rem' }}>{'📋'}</span>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Plantilla: {template.name}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
                  {template.sections?.length || 0} secciones · {template.sections?.reduce((sum: number, s: any) => sum + (s.questions?.length || 0), 0) || 0} preguntas
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setShowTemplate(!showTemplate)}>
                {showTemplate ? 'Ocultar' : 'Ver plantilla'}
              </button>
              {cycle?.status === 'draft' && template?.id && (
                <Link href={`/dashboard/plantillas?edit=${template.id}`} className="btn-ghost" style={{ fontSize: '0.78rem', textDecoration: 'none' }}>
                  Editar plantilla
                </Link>
              )}
            </div>
          </div>

          {showTemplate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(template.sections || []).map((sec: any, si: number) => (
                <div key={sec.id || si} style={{ padding: '0.75rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--accent)' }}>
                    {si + 1}. {sec.title}
                  </div>
                  {sec.description && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{sec.description}</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {(sec.questions || []).map((q: any, qi: number) => (
                      <div key={q.id || qi} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-muted)', minWidth: '20px', fontSize: '0.72rem' }}>{qi + 1}.</span>
                        <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{q.text}</span>
                        <span className="badge badge-ghost" style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                          {q.type === 'scale' ? `Escala ${q.scale?.min || 1}-${q.scale?.max || 10}` : q.type === 'text' ? 'Texto' : q.type === 'multi' ? 'Opción múltiple' : q.type}
                        </span>
                        {q.required && <span style={{ color: 'var(--danger)', fontSize: '0.7rem' }}>*</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Guide toggle — only for draft cycles (before assignments are generated) */}
      {cycle.status === 'draft' && (
        <>
          <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
            <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
              {showGuide ? t('common.hideGuide') : t('common.showGuide')}
            </button>
          </div>
          {showGuide && (
            <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('evaluaciones.detail.guideTitle')}</h3>
              <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem', margin: '0 0 1rem' }}>
                <li>{t('evaluaciones.detail.guideManage')}</li>
                <li>{t('evaluaciones.detail.guideStates')}</li>
                <li>{t('evaluaciones.detail.guideAutoAssign')}</li>
                <li>{t('evaluaciones.detail.guidePeers')}</li>
                <li>{t('evaluaciones.detail.guideLaunch')}</li>
              </ul>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {t('evaluaciones.detail.guidePermissions')}
              </div>
            </div>
          )}
        </>
      )}

      {/* Change history */}
      {cycleHistory.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Historial de cambios</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
            {cycleHistory.map((entry: any) => {
              const actionLabels: Record<string, string> = {
                'cycle.created': 'Ciclo creado',
                'cycle.updated': 'Ciclo editado',
                'cycle.launched': 'Ciclo lanzado',
                'cycle.closed': 'Ciclo cerrado',
                'cycle.paused': 'Ciclo pausado',
                'cycle.resumed': 'Ciclo reanudado',
                'cycle.stage_advanced': 'Etapa avanzada',
              };
              const fieldLabels: Record<string, string> = {
                name: 'Nombre', description: 'Descripción', startDate: 'Fecha inicio',
                endDate: 'Fecha fin', type: 'Tipo', status: 'Estado', period: 'Período', templateId: 'Plantilla',
              };
              const changes = entry.metadata?.changes;
              const date = new Date(entry.createdAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
              return (
                <div key={entry.id} style={{ padding: '0.5rem 0.75rem', borderLeft: `3px solid ${entry.action === 'cycle.updated' ? 'var(--accent)' : entry.action === 'cycle.created' ? 'var(--success)' : 'var(--border)'}`, background: 'var(--bg-base)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: changes ? '0.3rem' : 0 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{actionLabels[entry.action] || entry.action}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{entry.userName} · {date}</span>
                  </div>
                  {changes && Object.keys(changes).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      {Object.entries(changes).map(([field, vals]: [string, any]) => (
                        <div key={field} style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          <strong>{fieldLabels[field] || field}:</strong>{' '}
                          <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{vals.before || '—'}</span>
                          {' → '}
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{vals.after || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Peer assignment section for 270/360 draft cycles */}
      {showPeerSection && (
        <div
          className="card animate-fade-up"
          style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}
        >
          <div
            style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{t('evaluaciones.detail.assignEvaluators')}</h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {t('evaluaciones.detail.assignDesc')}
                </p>
                <p style={{ fontSize: '0.72rem', color: 'var(--accent)', marginTop: '0.25rem', fontWeight: 600 }}>
                  {'Tipo: '}{cycle.type === '90' ? '90\u00b0 (solo jefe)' : cycle.type === '180' ? '180\u00b0 (jefe + auto)' : cycle.type === '270' ? '270\u00b0 (jefe + auto + pares)' : '360\u00b0 (todos)'}{' \u2014 Relaciones permitidas: '}{allowedRelations.map((r) => r.label).join(', ') || 'Cargando...'}
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={handleAutoGenerate}
                disabled={autoGenerating}
                style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', whiteSpace: 'nowrap' }}
              >
                {autoGenerating ? t('evaluaciones.detail.generating') : `\u26a1 ${t('evaluaciones.detail.generateAssignments')}`}
              </button>
            </div>
          </div>

          {peerList.length > 0 && (
            <div style={{ padding: '0 1.5rem 1rem' }}>
              {/* Filter bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem', paddingTop: '0.75rem' }}>
                <input
                  className="input"
                  placeholder={t('evaluaciones.detail.searchEvaluated')}
                  value={peerFilterSearch}
                  onChange={(e) => setPeerFilterSearch(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                />
                {deptOptions.length > 0 && (
                  <select
                    className="input"
                    value={peerFilterDept}
                    onChange={(e) => setPeerFilterDept(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">{t('common.allDepartments')}</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                {(peerFilterSearch || peerFilterDept) && (
                  <button
                    className="btn-ghost"
                    onClick={() => { setPeerFilterSearch(''); setPeerFilterDept(''); }}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', color: 'var(--text-muted)' }}
                  >
                    {`✕ ${t('evaluaciones.detail.cleanFilters')}`}
                  </button>
                )}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 'auto' }}>
                  {filteredPeerEntries.length} de {Object.keys(peerListGrouped).length} evaluado{Object.keys(peerListGrouped).length !== 1 ? 's' : ''}
                </span>
              </div>

              {filteredPeerEntries.length === 0 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                  {t('evaluaciones.detail.noFilterResults')}
                </p>
              )}

              {filteredPeerEntries.map(([evaluateeId, assignments]) => {
                const first = assignments[0];
                const evalueeName = first.evaluatee
                  ? `${first.evaluatee.firstName || ''} ${first.evaluatee.lastName || ''}`.trim() || first.evaluatee.email
                  : evaluateeId;
                return (
                  <div
                    key={evaluateeId}
                    style={{
                      marginBottom: '0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Evaluatee header — clickable to collapse */}
                    <div
                      onClick={() => setCollapsedGroups(prev => {
                        const next = new Set(prev);
                        next.has(evaluateeId) ? next.delete(evaluateeId) : next.add(evaluateeId);
                        return next;
                      })}
                      style={{
                      padding: '0.6rem 1rem',
                      background: 'rgba(99,102,241,0.07)',
                      borderBottom: collapsedGroups.has(evaluateeId) ? 'none' : '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)' }}>
                        {evalueeName}{first.evaluatee?.position ? ` (${first.evaluatee.position})` : ''}
                      </span>
                      {first.evaluatee?.department && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.1rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
                          {first.evaluatee.department}
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        {assignments.length} evaluador{assignments.length !== 1 ? 'es' : ''}
                        <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s', transform: collapsedGroups.has(evaluateeId) ? 'rotate(0deg)' : 'rotate(90deg)', display: 'inline-block' }}>▶</span>
                      </span>
                    </div>
                    {/* Evaluators list — collapsible */}
                    {!collapsedGroups.has(evaluateeId) && assignments.map((pa: any, idx: number) => (
                      <div
                        key={pa.id}
                        style={{
                          padding: '0.5rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                          background: 'var(--bg-surface)',
                        }}
                      >
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>
                          {pa.evaluator?.firstName || pa.evaluator?.email || pa.evaluatorId || '\u2014'}
                          {pa.evaluator?.lastName ? ` ${pa.evaluator.lastName}` : ''}
                          {pa.evaluator?.position ? <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> ({pa.evaluator.position})</span> : ''}
                        </span>
                        <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
                          {relationLabels[pa.relationType] || pa.relationType}
                        </span>
                        <button
                          className="btn-ghost"
                          onClick={() => handleRemovePeer(pa.id)}
                          disabled={removePeer.isPending}
                          style={{ fontSize: '0.75rem', color: 'var(--danger)', padding: '0.2rem 0.5rem' }}
                        >
                          &times; {t('evaluaciones.detail.remove')}
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {peerList.length === 0 && (
            <div style={{ padding: '1.25rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('evaluaciones.detail.noAssignments')}
            </div>
          )}

          {/* Manual assignment section */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.5rem' }}>
            {/* Explanatory note */}
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--accent)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Asignación manual de evaluadores. Seleccione la relación, departamento, evaluado y evaluador. Si ya existe una asignación con la misma relación para el evaluado, debe eliminarla primero.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {/* Relación — filtered by cycle type */}
              <div style={{ minWidth: '140px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  {t('evaluaciones.detail.relation')}
                </label>
                <select
                  value={peerRelationType}
                  onChange={(e) => {
                    const newRel = e.target.value;
                    setPeerRelationType(newRel);
                    setPeerEvaluatorId('');
                    // Auto-fill evaluator if switching to 'manager' with evaluatee already selected
                    if (newRel === 'manager' && peerEvaluateeId) {
                      const selectedUser = usersList.find((u: any) => u.id === peerEvaluateeId);
                      if (selectedUser?.managerId) setPeerEvaluatorId(selectedUser.managerId);
                    }
                  }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                >
                  {allowedRelations.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Departamento filter */}
              <div style={{ minWidth: '140px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  Departamento
                </label>
                <select
                  value={manualDeptFilter}
                  onChange={(e) => { setManualDeptFilter(e.target.value); setPeerEvaluateeId(''); setPeerEvaluatorId(''); }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                >
                  <option value="">Todos</option>
                  {deptOptions.map((d: string) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Evaluado — filtered by department */}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  {t('evaluaciones.detail.evaluatee')}
                </label>
                <select
                  value={peerEvaluateeId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setPeerEvaluateeId(newId);
                    setPeerEvaluatorId('');
                    // Auto-fill evaluator based on relation type
                    if (newId && peerRelationType === 'manager') {
                      const selectedUser = usersList.find((u: any) => u.id === newId);
                      if (selectedUser?.managerId) setPeerEvaluatorId(selectedUser.managerId);
                    }
                  }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                >
                  <option value="">Seleccionar evaluado ({usersList.filter((u: any) => !manualDeptFilter || u.department === manualDeptFilter).length})</option>
                  {usersList
                    .filter((u: any) => !manualDeptFilter || u.department === manualDeptFilter)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName || ''}{u.position ? ` (${u.position})` : ''}{u.department ? ` — ${u.department}` : ''}
                      </option>
                    ))}
                </select>
              </div>

              {/* Evaluador — auto-filled or filtered by relation */}
              {peerRelationType !== 'self' && (
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    {t('evaluaciones.detail.evaluator')}
                    {peerRelationType === 'manager' && peerEvaluatorId && <span style={{ color: 'var(--success)', fontSize: '0.7rem', marginLeft: '0.3rem' }}>(auto-asignado)</span>}
                  </label>
                  <select
                    value={peerEvaluatorId}
                    onChange={(e) => setPeerEvaluatorId(e.target.value)}
                    disabled={peerRelationType === 'manager'}
                    style={{
                      width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)',
                      background: peerRelationType === 'manager' ? 'var(--bg-secondary)' : 'var(--bg-surface)',
                      color: 'var(--text-primary)', fontSize: '0.85rem',
                    }}
                  >
                    <option value="">Seleccionar evaluador</option>
                    {usersList
                      .filter((u: any) => {
                        if (u.id === peerEvaluateeId) return false;
                        // Filter by relation type
                        if (peerRelationType === 'manager') {
                          // Only show the direct manager
                          const evaluatee = usersList.find((eu: any) => eu.id === peerEvaluateeId);
                          return evaluatee?.managerId === u.id;
                        }
                        if (peerRelationType === 'direct_report') {
                          // Only show users whose manager is the evaluatee
                          return u.managerId === peerEvaluateeId;
                        }
                        // peer: show all (except evaluatee)
                        return true;
                      })
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName || ''}{u.position ? ` (${u.position})` : ''}{u.department ? ` — ${u.department}` : ''}
                        </option>
                      ))}
                  </select>
                  {peerRelationType === 'manager' && peerEvaluateeId && !peerEvaluatorId && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--warning)' }}>Este colaborador no tiene jefatura asignada</span>
                  )}
                  {peerRelationType === 'manager' && peerEvaluateeId && peerEvaluatorId && (() => {
                    const ev = usersList.find((u: any) => u.id === peerEvaluateeId);
                    const mgr = usersList.find((u: any) => u.id === peerEvaluatorId);
                    if (ev?.department && mgr?.department && ev.department !== mgr.department) {
                      return <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>⚠ El jefe ({mgr.department}) es de un departamento diferente al evaluado ({ev.department})</span>;
                    }
                    return null;
                  })()}
                </div>
              )}

              <button
                className="btn-primary"
                onClick={handleAddPeer}
                disabled={!peerEvaluateeId || (peerRelationType !== 'self' && !peerEvaluatorId) || addPeer.isPending || (() => {
                  // Block if manager is from different department
                  if (peerRelationType === 'manager' && peerEvaluateeId && peerEvaluatorId) {
                    const ev = usersList.find((u: any) => u.id === peerEvaluateeId);
                    const mgr = usersList.find((u: any) => u.id === peerEvaluatorId);
                    return !!(ev?.department && mgr?.department && ev.department !== mgr.department);
                  }
                  return false;
                })()}
                style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem', opacity: !peerEvaluateeId || (peerRelationType !== 'self' && !peerEvaluatorId) ? 0.5 : 1 }}
              >
                {addPeer.isPending ? t('common.saving') : t('evaluaciones.detail.addAssignment')}
              </button>
            </div>

            {/* Suggest peers button */}
            {peerEvaluateeId && peerRelationType === 'peer' && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    if (!token) return;
                    setSuggestingFor(peerEvaluateeId);
                    setLoadingSuggestions(true);
                    try {
                      const result = await api.peerAssignments.suggestPeers(token, id, peerEvaluateeId);
                      setSuggestions(result);
                    } catch { setSuggestions([]); }
                    setLoadingSuggestions(false);
                  }}
                  disabled={loadingSuggestions}
                  style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
                >
                  {loadingSuggestions ? t('evaluaciones.detail.loadingSuggestions') : t('evaluaciones.detail.suggestPeers')}
                </button>
              </div>
            )}
          </div>

          {/* Peer suggestions panel */}
          {suggestions.length > 0 && suggestingFor && (
            <div style={{ padding: '0.75rem 1.5rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                {t('evaluaciones.detail.suggestedPeers')}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {suggestions.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      if (!token) return;
                      await addPeer.mutateAsync({ cycleId: id, evaluateeId: suggestingFor, evaluatorId: s.id, relationType: 'peer' });
                      setSuggestions(prev => prev.filter(p => p.id !== s.id));
                    }}
                    style={{
                      padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                      cursor: 'pointer', fontSize: '0.78rem', textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '0.3rem' }}>
                      {s.position && <span>{s.position}</span>}
                      {s.sameLevel && <span style={{ color: 'var(--success)' }}>· Mismo nivel</span>}
                      {s.sameDepartment && <span style={{ color: '#6366f1' }}>· Mismo depto.</span>}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => { setSuggestions([]); setSuggestingFor(null); }}
                style={{ marginTop: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {t('common.close')}
              </button>
            </div>
          )}
          {/* ═══ Exception Assignment Section ═══ */}
          <div style={{ borderTop: '2px solid var(--border)', padding: '1rem 1.5rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {'⚡'} Asignación de excepciones
              </h3>
              <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--warning)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Permite asignar evaluadores fuera del departamento del colaborador:
                <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0, lineHeight: 1.7 }}>
                  <li><strong>Jefatura:</strong> Cualquier colaborador de nivel jerárquico superior (cualquier departamento)</li>
                  <li><strong>Par:</strong> Cualquier colaborador del mismo nivel jerárquico (cualquier departamento)</li>
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {/* Tipo de relación */}
              <div style={{ minWidth: '130px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Relación</label>
                <select value={excRelationType} onChange={(e) => { setExcRelationType(e.target.value); setExcEvaluatorId(''); }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  {allowedRelations.filter(r => r.value === 'manager' || r.value === 'peer').map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Departamento del evaluado */}
              <div style={{ minWidth: '130px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Depto. evaluado</label>
                <select value={excDeptFilter} onChange={(e) => { setExcDeptFilter(e.target.value); setExcEvaluateeId(''); setExcEvaluatorId(''); }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  <option value="">Todos</option>
                  {deptOptions.map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Evaluado */}
              <div style={{ flex: 1, minWidth: '180px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Evaluado</label>
                <select value={excEvaluateeId} onChange={(e) => { setExcEvaluateeId(e.target.value); setExcEvaluatorId(''); }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  <option value="">Seleccionar evaluado</option>
                  {usersList.filter((u: any) => !excDeptFilter || u.department === excDeptFilter).map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.position ? ` (${u.position})` : ''}{u.department ? ` — ${u.department}` : ''}</option>
                  ))}
                </select>
              </div>

              {/* Departamento del evaluador */}
              <div style={{ minWidth: '130px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Depto. evaluador</label>
                <select value={excEvalDeptFilter} onChange={(e) => { setExcEvalDeptFilter(e.target.value); setExcEvaluatorId(''); }}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  <option value="">Todos</option>
                  {deptOptions.map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Evaluador — filtrado por jerarquía */}
              <div style={{ flex: 1, minWidth: '180px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  Evaluador
                  {excRelationType === 'manager' && <span style={{ color: 'var(--accent)', fontSize: '0.68rem', marginLeft: '0.3rem' }}>(nivel superior)</span>}
                  {excRelationType === 'peer' && <span style={{ color: '#6366f1', fontSize: '0.68rem', marginLeft: '0.3rem' }}>(mismo nivel)</span>}
                </label>
                <select value={excEvaluatorId} onChange={(e) => setExcEvaluatorId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm, 0.375rem)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  <option value="">Seleccionar evaluador</option>
                  {(() => {
                    const evaluatee = usersList.find((u: any) => u.id === excEvaluateeId);
                    if (!evaluatee) return [];
                    return usersList.filter((u: any) => {
                      if (u.id === excEvaluateeId) return false;
                      if (excEvalDeptFilter && u.department !== excEvalDeptFilter) return false;
                      if (excRelationType === 'manager') {
                        // Higher hierarchy level (lower number = higher)
                        const evalLevel = evaluatee.hierarchyLevel ?? 99;
                        const uLevel = u.hierarchyLevel ?? 99;
                        return uLevel < evalLevel;
                      }
                      if (excRelationType === 'peer') {
                        // Same hierarchy level
                        if (!evaluatee.hierarchyLevel || !u.hierarchyLevel) return false;
                        return u.hierarchyLevel === evaluatee.hierarchyLevel;
                      }
                      return true;
                    });
                  })().map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}{u.position ? ` (${u.position})` : ''}{u.department ? ` — ${u.department}` : ''}
                      {u.hierarchyLevel ? ` [Nv.${u.hierarchyLevel}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn-primary" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
                disabled={!excEvaluateeId || !excEvaluatorId || addPeer.isPending}
                onClick={async () => {
                  // Duplicate check
                  const dup = peerList.some((pa: any) => pa.evaluateeId === excEvaluateeId && pa.evaluatorId === excEvaluatorId && pa.relationType === excRelationType);
                  if (dup) { toast.error('Esta asignación ya existe.'); return; }
                  try {
                    await addPeer.mutateAsync({ cycleId: id, evaluateeId: excEvaluateeId, evaluatorId: excEvaluatorId, relationType: excRelationType });
                    setExcEvaluateeId(''); setExcEvaluatorId('');
                    toast.success('Asignación de excepción agregada');
                  } catch (e: any) { toast.error(e.message || 'Error al agregar'); }
                }}>
                Agregar excepción
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignments table */}
      {(cycle.status === 'active' || cycle.status === 'closed' || cycle.status === 'draft') &&
        assignmentList.length > 0 && (
          <div
            className="card animate-fade-up"
            style={{ padding: 0, overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>{t('evaluaciones.detail.assignmentsTable')}</h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    {filteredAssignments.length} de {assignmentList.length} asignaciones
                  </p>
                </div>
              </div>
              {/* Filter bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.75rem' }}>
                <input
                  className="input"
                  placeholder={t('evaluaciones.detail.filterSearch')}
                  value={assignFilterSearch}
                  onChange={(e) => setAssignFilterSearch(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                />
                {deptOptions.length > 0 && (
                  <select
                    className="input"
                    value={assignFilterDept}
                    onChange={(e) => setAssignFilterDept(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">{t('common.allDepartments')}</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                {uniqueRelations.length > 1 && (
                  <select
                    className="input"
                    value={assignFilterRelation}
                    onChange={(e) => setAssignFilterRelation(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  >
                    <option value="">{t('evaluaciones.detail.filterRelation')}</option>
                    {uniqueRelations.map((r) => (
                      <option key={r} value={r}>{relationLabels[r] || r}</option>
                    ))}
                  </select>
                )}
                <select
                  className="input"
                  value={assignFilterStatus}
                  onChange={(e) => setAssignFilterStatus(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                >
                  <option value="">{t('evaluaciones.detail.filterStatus')}</option>
                  <option value="pending">{t('status.assignment.pending')}</option>
                  <option value="in_progress">{t('status.assignment.in_progress')}</option>
                  <option value="completed">{t('status.assignment.completed')}</option>
                  <option value="submitted">{t('status.assignment.submitted')}</option>
                </select>
                {(assignFilterSearch || assignFilterDept || assignFilterStatus || assignFilterRelation) && (
                  <button
                    className="btn-ghost"
                    onClick={() => { setAssignFilterSearch(''); setAssignFilterDept(''); setAssignFilterStatus(''); setAssignFilterRelation(''); }}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', color: 'var(--text-muted)' }}
                  >
                    {`✕ ${t('evaluaciones.detail.cleanFilters')}`}
                  </button>
                )}
              </div>
            </div>
            {/* Grouped by evaluatee — same layout as draft peer section */}
            <div style={{ padding: '0 1.5rem 1rem' }}>
              {filteredAssignments.length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                  {t('evaluaciones.detail.noFilterResults')}
                </p>
              ) : (() => {
                // Group by evaluateeId
                const grouped: Record<string, any[]> = filteredAssignments.reduce((acc: Record<string, any[]>, a: any) => {
                  const key = a.evaluateeId || 'sin_evaluado';
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(a);
                  return acc;
                }, {});

                return Object.entries(grouped).map(([evaluateeId, items]) => {
                  const first = items[0];
                  const evalueeName = first.evaluatee
                    ? `${first.evaluatee.firstName || ''} ${first.evaluatee.lastName || ''}`.trim() || first.evaluatee.email
                    : evaluateeId;
                  const dept = first.evaluatee?.department;
                  const completed = items.filter((a: any) => a.status === 'completed' || a.status === 'submitted').length;
                  const total = items.length;
                  const allDone = completed === total;

                  return (
                    <div
                      key={evaluateeId}
                      style={{ marginBottom: '0.75rem', marginTop: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
                    >
                      {/* Evaluatee header */}
                      <div style={{
                        padding: '0.6rem 1rem',
                        background: 'rgba(99,102,241,0.07)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)' }}>
                          {evalueeName}
                        </span>
                        {dept && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.1rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border)' }}>
                            {dept}
                          </span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: allDone ? 'var(--success)' : 'var(--text-muted)', marginLeft: 'auto', fontWeight: allDone ? 700 : 400 }}>
                          {completed}/{total} {allDone ? '✓' : 'completadas'}
                        </span>
                      </div>

                      {/* Evaluators rows */}
                      {items.map((a: any, idx: number) => {
                        const evaluatorName = a.evaluator
                          ? `${a.evaluator.firstName || ''} ${a.evaluator.lastName || ''}`.trim() || a.evaluator.email
                          : a.evaluatorId || '\u2014';
                        const isDone = a.status === 'completed' || a.status === 'submitted';
                        const canRespond = cycle.status === 'active' && a.evaluatorId === user?.userId && !isDone;

                        return (
                          <div
                            key={a.id}
                            style={{
                              padding: '0.55rem 1rem',
                              display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                              borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                              background: isDone ? 'rgba(16,185,129,0.03)' : 'var(--bg-surface)',
                            }}
                          >
                            {/* Evaluator name */}
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1, minWidth: '120px' }}>
                              {evaluatorName}
                            </span>

                            {/* Relation */}
                            <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
                              {relationLabels[a.relationType] || a.relationType}
                            </span>

                            {/* Status */}
                            <span className={`badge ${statusBadge[a.status] || 'badge-accent'}`} style={{ fontSize: '0.7rem' }}>
                              {statusLabels[a.status] || a.status}
                            </span>

                            {/* Score (closed cycles) */}
                            {cycle.status === 'closed' && (
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, minWidth: '36px', textAlign: 'right', color: a.score != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                {a.score != null ? (typeof a.score === 'number' ? a.score.toFixed(1) : a.score) : '\u2014'}
                              </span>
                            )}

                            {/* Action (active cycles) */}
                            {cycle.status === 'active' && (
                              canRespond ? (
                                <Link
                                  href={`/dashboard/evaluaciones/${id}/responder/${a.id}`}
                                  className="btn-primary"
                                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                                >
                                  Responder
                                </Link>
                              ) : null
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

      {assignmentList.length === 0 && !isLoading && (
        <div
          className="card animate-fade-up"
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
          }}
        >
          No hay asignaciones en este ciclo a&uacute;n.
        </div>
      )}
      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          detail={confirmState.detail}
          danger={confirmState.danger}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* ── Auto-generation report modal ── */}
      {autoGenResult && autoGenResult.exceptions.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {t('evaluaciones.detail.autoGenReportTitle')}
              </h3>
              <div className="mt-2 flex gap-4 text-sm">
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full font-medium">
                  {autoGenResult.created} {t('evaluaciones.detail.autoGenCreated')}
                </span>
                <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-medium">
                  {autoGenResult.exceptions.length} {t('evaluaciones.detail.autoGenExceptions')}
                </span>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-sm text-gray-500 mb-4">
                {t('evaluaciones.detail.autoGenExceptionsDetail')}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 font-medium">{t('evaluaciones.detail.autoGenColEmployee')}</th>
                    <th className="pb-2 font-medium">{t('evaluaciones.detail.autoGenColDept')}</th>
                    <th className="pb-2 font-medium">{t('evaluaciones.detail.autoGenColType')}</th>
                    <th className="pb-2 font-medium">{t('evaluaciones.detail.autoGenColDetail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {autoGenResult.exceptions.map((exc, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium text-gray-900">{exc.evaluateeName}</td>
                      <td className="py-2 text-gray-600">{exc.department || '—'}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          exc.type === 'INSUFFICIENT_PEERS' ? 'bg-amber-100 text-amber-800' :
                          exc.type === 'NO_MANAGER' ? 'bg-red-100 text-red-800' :
                          exc.type === 'MANAGER_DIFF_DEPT' ? 'bg-orange-100 text-orange-800' :
                          exc.type === 'NO_DEPARTMENT' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {exc.type === 'NO_MANAGER' && t('evaluaciones.detail.excNoManager')}
                          {exc.type === 'MANAGER_DIFF_DEPT' && t('evaluaciones.detail.excManagerDiffDept')}
                          {exc.type === 'NO_DEPARTMENT' && t('evaluaciones.detail.excNoDept')}
                          {exc.type === 'INSUFFICIENT_PEERS' && t('evaluaciones.detail.excInsufficientPeers')}
                          {exc.type === 'NO_DIRECT_REPORTS' && t('evaluaciones.detail.excNoDirectReports')}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600 text-xs">{exc.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                className="btn-secondary"
                onClick={() => { setAutoGenResult(null); window.location.reload(); }}
              >
                {t('evaluaciones.detail.autoGenClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
