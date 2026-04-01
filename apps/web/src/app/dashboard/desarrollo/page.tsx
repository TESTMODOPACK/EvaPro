'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import ConfirmModal from '@/components/ConfirmModal';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  borrador: 'badge badge-warning',
  activo: 'badge badge-accent',
  en_revision: 'badge badge-warning',
  completado: 'badge badge-success',
  cancelado: 'badge badge-danger',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  borrador: 'desarrollo.status.borrador',
  activo: 'desarrollo.status.activo',
  en_revision: 'desarrollo.status.en_revision',
  completado: 'desarrollo.status.completado',
  cancelado: 'desarrollo.status.cancelado',
};

const ACTION_TYPE_BADGE: Record<string, string> = {
  curso: 'badge badge-accent',
  mentoring: 'badge badge-warning',
  proyecto: 'badge badge-success',
  taller: 'badge badge-accent',
  lectura: 'badge',
  rotacion: 'badge badge-danger',
  otro: 'badge',
};

const ACTION_TYPE_LABEL_KEYS: Record<string, string> = {
  curso: 'desarrollo.actionType.curso',
  mentoring: 'desarrollo.actionType.mentoring',
  proyecto: 'desarrollo.actionType.proyecto',
  taller: 'desarrollo.actionType.taller',
  lectura: 'desarrollo.actionType.lectura',
  rotacion: 'desarrollo.actionType.rotacion',
  otro: 'desarrollo.actionType.otro',
};

const PRIORITY_BADGE: Record<string, string> = {
  alta: 'badge badge-danger',
  media: 'badge badge-warning',
  baja: 'badge badge-accent',
};

const PRIORITY_LABEL_KEYS: Record<string, string> = {
  alta: 'desarrollo.priority.alta',
  media: 'desarrollo.priority.media',
  baja: 'desarrollo.priority.baja',
};

const COMMENT_TYPE_LABEL_KEYS: Record<string, string> = {
  comentario: 'desarrollo.commentType.comentario',
  felicitacion: 'desarrollo.commentType.felicitacion',
  seguimiento: 'desarrollo.commentType.seguimiento',
  revision: 'desarrollo.commentType.revision',
};

interface ActionForm {
  title: string;
  type: string;
  competencyId: string;
  dueDate: string;
  description: string;
}

const emptyActionForm: ActionForm = { title: '', type: 'curso', competencyId: '', dueDate: '', description: '' };

interface PlanForm {
  userId: string;
  title: string;
  description: string;
  priority: string;
  startDate: string;
  targetDate: string;
}

const emptyPlanForm: PlanForm = { userId: '', title: '', description: '', priority: 'media', startDate: '', targetDate: '' };

function DesarrolloPageContent() {
  const { t } = useTranslation();
  const { token, user } = useAuthStore();
  const toast = useToastStore();
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin';
  const isManager = role === 'manager';
  const canCreate = isAdmin || isManager;

  const [confirmState, setConfirmState] = useState<{
    message: string;
    detail?: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [competencies, setCompetencies] = useState<any[]>([]);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm);
  const [creating, setCreating] = useState(false);

  // Detail view
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [planActions, setPlanActions] = useState<any[]>([]);
  const [planComments, setPlanComments] = useState<any[]>([]);

  // Add action form
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [addingAction, setAddingAction] = useState(false);

  // Add comment form
  const [commentText, setCommentText] = useState('');
  const [commentType, setCommentType] = useState('comentario');
  const [addingComment, setAddingComment] = useState(false);

  // Edit action
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editActionForm, setEditActionForm] = useState<ActionForm>(emptyActionForm);

  // Suggest from assessment
  const [cycles, setCycles] = useState<any[]>([]);
  const [suggestCycleId, setSuggestCycleId] = useState('');
  const [suggestResult, setSuggestResult] = useState<any>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // Org initiatives (for optional PDI linking)
  const [orgInitiatives, setOrgInitiatives] = useState<any[]>([]);
  const [planFormOrgInitiativeId, setPlanFormOrgInitiativeId] = useState('');

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const promises: Promise<any>[] = [
        api.development.plans.list(token!),
        api.users.list(token!).catch(() => []),
        api.development.competencies.list(token!),
        api.orgDevelopment.activeInitiatives(token!).catch(() => []),
      ];
      if (canCreate) {
        promises.push(api.cycles.list(token!).catch(() => []));
      }
      // BUG #10 fix: evitar destructuring de array de tamaño variable
      const results = await Promise.all(promises);
      const [plansRes, usersRes, compsRes, orgInitRes] = results;
      const cyclesRes = canCreate ? results[4] : undefined;
      setPlans(Array.isArray(plansRes) ? plansRes : []);
      const userData = Array.isArray(usersRes) ? usersRes : (usersRes as any)?.data || [];
      setUsers(userData);
      setCompetencies(Array.isArray(compsRes) ? compsRes : []);
      setOrgInitiatives(Array.isArray(orgInitRes) ? orgInitRes : []);
      if (cyclesRes) setCycles(Array.isArray(cyclesRes) ? cyclesRes : []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    try {
      await api.development.plans.create(token, {
        userId: planForm.userId,
        title: planForm.title,
        description: planForm.description || undefined,
        priority: planForm.priority,
        startDate: planForm.startDate || undefined,
        targetDate: planForm.targetDate || undefined,
        ...(planFormOrgInitiativeId ? { orgInitiativeId: planFormOrgInitiativeId } : {}),
      });
      setPlanForm(emptyPlanForm);
      setPlanFormOrgInitiativeId('');
      setShowCreate(false);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Error al crear plan');
    } finally {
      setCreating(false);
    }
  }

  async function handleSuggest() {
    if (!token || !planForm.userId || !suggestCycleId) return;
    setSuggestLoading(true);
    setSuggestResult(null);
    try {
      const result = await api.development.suggest(token, planForm.userId, suggestCycleId);
      setSuggestResult(result);
    } catch (e: any) {
      toast.error(e.message || 'No se encontr\u00f3 evaluaci\u00f3n de talento para este usuario y ciclo');
    } finally {
      setSuggestLoading(false);
    }
  }

  async function openDetail(plan: any) {
    if (!token) return;
    setSelectedPlan(plan);
    setDetailLoading(true);
    setShowAddAction(false);
    setEditingActionId(null);
    try {
      const detail = await api.development.plans.getById(token, plan.id);
      setSelectedPlan(detail);
      setPlanActions(detail.actions || []);
      const comments = await api.development.comments.list(token, plan.id);
      setPlanComments(Array.isArray(comments) ? comments : []);
    } catch (e: any) {
      setPlanActions([]);
      setPlanComments([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleActivate(planId: string) {
    if (!token) return;
    try {
      await api.development.plans.activate(token, planId);
      await loadData();
      if (selectedPlan?.id === planId) await openDetail({ id: planId });
    } catch (e: any) {
      toast.error(e.message || 'Error al activar plan');
    }
  }

  async function handleCompletePlan(planId: string) {
    if (!token) return;
    try {
      await api.development.plans.complete(token, planId);
      await loadData();
      if (selectedPlan?.id === planId) await openDetail({ id: planId });
    } catch (e: any) {
      toast.error(e.message || 'Error al completar plan');
    }
  }

  async function handleAddAction(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedPlan) return;
    setAddingAction(true);
    try {
      await api.development.actions.create(token, selectedPlan.id, {
        title: actionForm.title,
        type: actionForm.type,
        competencyId: actionForm.competencyId || undefined,
        dueDate: actionForm.dueDate || undefined,
        description: actionForm.description || undefined,
      });
      setActionForm(emptyActionForm);
      setShowAddAction(false);
      await openDetail({ id: selectedPlan.id });
    } catch (e: any) {
      toast.error(e.message || 'Error al agregar acci\u00f3n');
    } finally {
      setAddingAction(false);
    }
  }

  async function handleCompleteAction(actionId: string) {
    if (!token) return;
    try {
      await api.development.actions.complete(token, actionId);
      if (selectedPlan) await openDetail({ id: selectedPlan.id });
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Error al completar acci\u00f3n');
    }
  }

  async function handleEditAction(actionId: string) {
    if (!token) return;
    try {
      await api.development.actions.update(token, actionId, {
        title: editActionForm.title,
        type: editActionForm.type,
        competencyId: editActionForm.competencyId || undefined,
        dueDate: editActionForm.dueDate || undefined,
        description: editActionForm.description || undefined,
      });
      setEditingActionId(null);
      if (selectedPlan) await openDetail({ id: selectedPlan.id });
    } catch (e: any) {
      toast.error(e.message || 'Error al editar acci\u00f3n');
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedPlan || !commentText.trim()) return;
    setAddingComment(true);
    try {
      await api.development.comments.create(token, selectedPlan.id, {
        content: commentText.trim(),
        type: commentType,
      });
      setCommentText('');
      setCommentType('comentario');
      const comments = await api.development.comments.list(token, selectedPlan.id);
      setPlanComments(Array.isArray(comments) ? comments : []);
    } catch (e: any) {
      toast.error(e.message || 'Error al agregar comentario');
    } finally {
      setAddingComment(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!token || !selectedPlan) return;
    setConfirmState({
      message: '¿Eliminar comentario?',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await api.development.comments.remove(token, selectedPlan.id, commentId);
          const comments = await api.development.comments.list(token, selectedPlan.id);
          setPlanComments(Array.isArray(comments) ? comments : []);
        } catch (e: any) {
          toast.error(e.message || 'Error al eliminar comentario');
        }
      },
    });
  }

  function getUserName(userId: string) {
    const u = users.find((x: any) => x.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : userId;
  }

  function getUserPosition(userId: string) {
    const u = users.find((x: any) => x.id === userId);
    return u?.position || '';
  }

  function getCompetencyName(id: string) {
    const c = competencies.find((x: any) => x.id === id);
    return c ? c.name : '';
  }

  const pageTitle = isAdmin
    ? t('desarrollo.title')
    : isManager
      ? t('desarrollo.titleManager')
      : t('desarrollo.titleEmployee');

  const availableUsers = isManager
    ? users.filter((u: any) => u.managerId === user?.userId || u.id === user?.userId)
    : users;

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{pageTitle}</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            {t('desarrollo.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? t('desarrollo.hideGuide') : t('desarrollo.showGuide')}
          </button>
          {canCreate && (
            <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? t('common.cancel') : t('desarrollo.newPlan')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Guide toggle button */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {t('desarrollo.guide.title')}
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {t('desarrollo.guide.whatIsDesc')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('desarrollo.guide.flow')}</div>
              <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>{t('desarrollo.guide.flowStep1')}</li>
                <li>{t('desarrollo.guide.flowStep2')}</li>
                <li>{t('desarrollo.guide.flowStep3')}</li>
                <li>{t('desarrollo.guide.flowStep4')}</li>
              </ol>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('desarrollo.guide.permissions')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('desarrollo.guide.permAdmin')}
                </div>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('desarrollo.guide.permEmployee')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && canCreate && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', borderLeft: '4px solid var(--accent)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.25rem' }}>
            {t('desarrollo.createFormTitle')}
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1.25rem' }}>
            {t('desarrollo.createFormSubtitle')}
          </p>
          <form onSubmit={handleCreatePlan} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {t('desarrollo.form.collaborator')}
                </label>
                <select
                  className="input"
                  value={planForm.userId}
                  onChange={(e) => setPlanForm({ ...planForm, userId: e.target.value })}
                  required
                  style={{ width: '100%' }}
                >
                  <option value="">{t('desarrollo.form.selectCollaborator')}</option>
                  {availableUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.position ? ` — ${u.position}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {t('desarrollo.form.title')}
                </label>
                <input
                  className="input"
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  required
                  placeholder={t('desarrollo.form.titlePlaceholder')}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {t('desarrollo.form.priority')}
                </label>
                <select
                  className="input"
                  value={planForm.priority}
                  onChange={(e) => setPlanForm({ ...planForm, priority: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="alta">{t(PRIORITY_LABEL_KEYS.alta)}</option>
                  <option value="media">{t(PRIORITY_LABEL_KEYS.media)}</option>
                  <option value="baja">{t(PRIORITY_LABEL_KEYS.baja)}</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                {t('desarrollo.form.description')}
              </label>
              <textarea
                className="input"
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                rows={2}
                placeholder={t('desarrollo.form.descriptionPlaceholder')}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {t('desarrollo.form.startDate')}
                </label>
                <input
                  className="input"
                  type="date"
                  value={planForm.startDate}
                  onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {t('desarrollo.form.targetDate')}
                </label>
                <input
                  className="input"
                  type="date"
                  value={planForm.targetDate}
                  onChange={(e) => setPlanForm({ ...planForm, targetDate: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {/* Suggest from assessment */}
            {planForm.userId && cycles.length > 0 && (
              <div style={{ padding: '1rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>
                  {'\u26a1 Sugerencias basadas en Evaluaci\u00f3n de Talento'}
                </div>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {'Esta herramienta consulta la Matriz Nine Box del colaborador seleccionado en un ciclo cerrado. Seg\u00fan su clasificaci\u00f3n de talento (Estrella, Alto Potencial, Riesgo, etc.) y su puntaje de desempe\u00f1o, sugiere competencias y tipos de acciones recomendadas para incluir en el plan de desarrollo.'}
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {'Ciclo de evaluaci\u00f3n:'}
                  </label>
                  <select
                    className="input"
                    value={suggestCycleId}
                    onChange={(e) => { setSuggestCycleId(e.target.value); setSuggestResult(null); }}
                    style={{ fontSize: '0.82rem', flex: 1 }}
                  >
                    <option value="">{'Seleccionar ciclo cerrado...'}</option>
                    {cycles.filter((c: any) => c.status === 'closed').map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                    onClick={handleSuggest}
                    disabled={suggestLoading || !suggestCycleId}
                  >
                    {suggestLoading ? 'Consultando...' : 'Consultar sugerencias'}
                  </button>
                </div>
                {suggestResult && (
                  <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.5rem' }}>
                      {'Resultado del an\u00e1lisis de talento'}
                    </div>
                    {/* Summary row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ padding: '0.5rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{`Desempe\u00f1o`}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{suggestResult.performanceScore}</div>
                      </div>
                      {suggestResult.potentialScore != null && (
                        <div style={{ padding: '0.5rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Potencial</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{suggestResult.potentialScore}</div>
                        </div>
                      )}
                      {suggestResult.nineBoxPosition && (
                        <div style={{ padding: '0.5rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Cuadrante</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{suggestResult.nineBoxPosition}</div>
                        </div>
                      )}
                      <div style={{ padding: '0.5rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{'Enfoque'}</div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)' }}>{suggestResult.focusArea}</div>
                      </div>
                    </div>
                    {/* Pool description */}
                    {suggestResult.poolDescription && (
                      <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, fontStyle: 'italic', borderLeft: '3px solid var(--accent)', paddingLeft: '0.5rem' }}>
                        {suggestResult.poolDescription}
                      </p>
                    )}
                    {/* Competencies */}
                    {suggestResult.suggestedCompetencies?.length > 0 && (
                      <>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.4rem' }}>
                          {'Competencias sugeridas (prioritarias primero):'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {suggestResult.suggestedCompetencies.filter((c: any) => c.priority).map((c: any) => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--success)', fontWeight: 700 }}>{'\u2605'}</span>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
                              <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{c.category}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{'\u2192'} {c.suggestedActionTypes?.join(', ')}</span>
                            </div>
                          ))}
                          {suggestResult.suggestedCompetencies.filter((c: any) => !c.priority).map((c: any) => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', opacity: 0.7 }}>
                              <span style={{ color: 'var(--text-muted)' }}>{'\u25cb'}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                              <span className="badge" style={{ fontSize: '0.68rem' }}>{c.category}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{'\u2192'} {c.suggestedActionTypes?.join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Vinculación opcional a iniciativa organizacional */}
            {orgInitiatives.length > 0 && (
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  Vincular a iniciativa organizacional{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span>
                </label>
                <select
                  className="input"
                  value={planFormOrgInitiativeId}
                  onChange={(e) => setPlanFormOrgInitiativeId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">{t('desarrollo.form.noLink')}</option>
                  {orgInitiatives.map((i: any) => (
                    <option key={i.id} value={i.id}>
                      {i.planTitle ? `${i.planTitle} — ` : ''}{i.title}{i.department ? ` (${i.department})` : ' (Toda la empresa)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? t('common.creating') : t('desarrollo.createPlan')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans list — managers only see their team's plans */}
      {(() => {
        const visiblePlans = isManager
          ? plans.filter((p: any) => {
              const planUser = users.find((u: any) => u.id === p.userId);
              return planUser?.managerId === user?.userId || p.userId === user?.userId;
            })
          : plans;
        return visiblePlans.length === 0 && !loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          {t('desarrollo.emptyPlans')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {visiblePlans.map((plan: any) => {
            const progress = plan.progress ?? 0;
            const planUser = plan.user || users.find((u: any) => u.id === plan.userId);
            const userName = planUser ? `${planUser.firstName} ${planUser.lastName}` : getUserName(plan.userId);
            const userPosition = planUser?.position || '';
            return (
              <div key={plan.id} className="card animate-fade-up" style={{ cursor: 'pointer', padding: 0, overflow: 'hidden' }} onClick={() => openDetail(plan)}>
                {/* Card header with user info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'rgba(99,102,241,0.03)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.82rem', flexShrink: 0 }}>
                      {userName.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{userName}</div>
                      {userPosition && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{userPosition}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className={STATUS_BADGE[plan.status] || 'badge'}>
                      {t(STATUS_LABEL_KEYS[plan.status] || plan.status, { defaultValue: plan.status })}
                    </span>
                    <span className={PRIORITY_BADGE[plan.priority] || 'badge'}>
                      {t(PRIORITY_LABEL_KEYS[plan.priority] || plan.priority, { defaultValue: plan.priority })}
                    </span>
                  </div>
                </div>
                {/* Card body */}
                <div style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    {plan.title}
                  </div>
                  {plan.description && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      {plan.description}
                    </div>
                  )}
                  {/* Progress bar */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      <span>{t('desarrollo.progress')}</span>
                      <span style={{ fontWeight: 700 }}>{progress}%</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progress}%`, background: progress >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  {/* Footer info */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {plan.targetDate && <span>{`Fecha l\u00edmite: ${new Date(plan.targetDate).toLocaleDateString('es-CL')}`}</span>}
                      {plan.actions && <span>{`${plan.actions.length} acci\u00f3n${plan.actions.length !== 1 ? 'es' : ''}`}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                      {plan.status === 'borrador' && canCreate && (
                        <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} onClick={() => handleActivate(plan.id)}>
                          {t('desarrollo.activate')}
                        </button>
                      )}
                      {plan.status === 'activo' && canCreate && (
                        <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} onClick={() => handleCompletePlan(plan.id)}>
                          {t('desarrollo.complete')}
                        </button>
                      )}
                      <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }} onClick={() => openDetail(plan)}>
                        {t('desarrollo.viewDetail')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
      })()}

      {/* Plan detail modal */}
      {selectedPlan && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
          onClick={() => { setSelectedPlan(null); setEditingActionId(null); }}
        >
          <div
            className="animate-fade-up"
            style={{ maxWidth: '860px', width: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 8px)', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <Spinner />
            ) : (
              <>
                {/* Header */}
                <div style={{ padding: '1.5rem 1.5rem 1rem', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div>
                      {(isAdmin || isManager) && (
                        <div style={{ marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {getUserName(selectedPlan.userId)}
                          </span>
                          {getUserPosition(selectedPlan.userId) && (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                              {getUserPosition(selectedPlan.userId)}
                            </span>
                          )}
                        </div>
                      )}
                      <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {selectedPlan.title}
                      </h2>
                      {selectedPlan.description && (
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {selectedPlan.description}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                      <span className={STATUS_BADGE[selectedPlan.status] || 'badge'}>
                        {t(STATUS_LABEL_KEYS[selectedPlan.status] || selectedPlan.status, { defaultValue: selectedPlan.status })}
                      </span>
                      <span className={PRIORITY_BADGE[selectedPlan.priority] || 'badge'}>
                        {t(PRIORITY_LABEL_KEYS[selectedPlan.priority] || selectedPlan.priority, { defaultValue: selectedPlan.priority })}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>

                {/* Info mini-card */}
                <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--accent)', marginBottom: '1.25rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {selectedPlan.status === 'borrador' && canCreate && 'Este plan est\u00e1 en Borrador. Activa el plan para que el colaborador pueda ver y ejecutar sus acciones.'}
                  {selectedPlan.status === 'activo' && canCreate && 'Plan activo. Agrega acciones de desarrollo y marca cada una como completada cuando el colaborador las finalice. Una vez que todas las acciones est\u00e9n listas, puedes marcar el plan como Completado.'}
                  {selectedPlan.status === 'activo' && !canCreate && 'Tu plan est\u00e1 activo. Revisa las acciones asignadas y m\u00e1rcalas como completadas cuando las finalices. Puedes agregar comentarios para comunicarte con tu encargado.'}
                  {selectedPlan.status === 'completado' && 'Este plan ha sido completado exitosamente.'}
                  {selectedPlan.status === 'cancelado' && 'Este plan fue cancelado.'}
                  {selectedPlan.status === 'en_revision' && 'Este plan est\u00e1 en revisi\u00f3n por el encargado.'}
                </div>

                {/* Progress */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    <span>{t('desarrollo.overallProgress')}</span>
                    <span style={{ fontWeight: 700 }}>{selectedPlan.progress ?? 0}%</span>
                  </div>
                  <div style={{ height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${selectedPlan.progress ?? 0}%`, background: (selectedPlan.progress ?? 0) >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '5px', transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Actions section */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {t('desarrollo.actions.title')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({planActions.length})</span>
                    </h3>
                    {(canCreate || selectedPlan.userId === user?.userId) && (
                      <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setShowAddAction(!showAddAction)}>
                        {showAddAction ? t('common.cancel') : t('desarrollo.actions.add')}
                      </button>
                    )}
                  </div>

                  {/* Add action form */}
                  {showAddAction && (
                    <form onSubmit={handleAddAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                        <input
                          className="input"
                          value={actionForm.title}
                          onChange={(e) => setActionForm({ ...actionForm, title: e.target.value })}
                          required
                          placeholder={t('desarrollo.actions.titlePlaceholder')}
                          style={{ fontSize: '0.82rem' }}
                        />
                        <select
                          className="input"
                          value={actionForm.type}
                          onChange={(e) => setActionForm({ ...actionForm, type: e.target.value })}
                          style={{ fontSize: '0.82rem' }}
                        >
                          {Object.entries(ACTION_TYPE_LABEL_KEYS).map(([val, key]) => (
                            <option key={val} value={val}>{t(key)}</option>
                          ))}
                        </select>
                        <select
                          className="input"
                          value={actionForm.competencyId}
                          onChange={(e) => setActionForm({ ...actionForm, competencyId: e.target.value })}
                          style={{ fontSize: '0.82rem' }}
                        >
                          <option value="">{t('desarrollo.actions.competencyOptional')}</option>
                          {competencies.map((c: any) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <input
                          className="input"
                          type="date"
                          value={actionForm.dueDate}
                          onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                          style={{ fontSize: '0.82rem' }}
                        />
                      </div>
                      <input
                        className="input"
                        value={actionForm.description}
                        onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                        placeholder={t('desarrollo.actions.descriptionOptional')}
                        style={{ fontSize: '0.82rem' }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button type="submit" className="btn-primary" style={{ fontSize: '0.78rem' }} disabled={addingAction}>
                          {addingAction ? t('common.adding') : t('common.add')}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Actions list */}
                  {planActions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {t('desarrollo.actions.empty')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {planActions.map((action: any) => (
                        <div key={action.id} style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: action.status === 'completada' ? 'rgba(16,185,129,0.05)' : 'transparent' }}>
                          {editingActionId === action.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
                                <input
                                  className="input"
                                  value={editActionForm.title}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, title: e.target.value })}
                                  style={{ fontSize: '0.82rem' }}
                                />
                                <select
                                  className="input"
                                  value={editActionForm.type}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, type: e.target.value })}
                                  style={{ fontSize: '0.82rem' }}
                                >
                                  {Object.entries(ACTION_TYPE_LABEL_KEYS).map(([val, key]) => (
                                    <option key={val} value={val}>{t(key)}</option>
                                  ))}
                                </select>
                                <input
                                  className="input"
                                  type="date"
                                  value={editActionForm.dueDate}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, dueDate: e.target.value })}
                                  style={{ fontSize: '0.82rem' }}
                                />
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button className="btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => setEditingActionId(null)}>{t('common.cancel')}</button>
                                <button className="btn-primary" style={{ fontSize: '0.75rem' }} onClick={() => handleEditAction(action.id)}>{t('common.save')}</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ flex: 1, minWidth: '150px' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                  <span className={ACTION_TYPE_BADGE[action.type] || 'badge'} style={{ fontSize: '0.7rem' }}>
                                    {t(ACTION_TYPE_LABEL_KEYS[action.type] || action.type, { defaultValue: action.type })}
                                  </span>
                                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', textDecoration: action.status === 'completada' ? 'line-through' : 'none' }}>
                                    {action.title}
                                  </span>
                                  {action.competencyId && (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                      ({getCompetencyName(action.competencyId)})
                                    </span>
                                  )}
                                </div>
                                {action.dueDate && (
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                    {t('desarrollo.actions.dueDate')}: {new Date(action.dueDate).toLocaleDateString('es-CL')}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span className={action.status === 'completada' ? 'badge badge-success' : 'badge badge-warning'} style={{ fontSize: '0.7rem' }}>
                                  {action.status === 'completada' ? t('desarrollo.actions.statusCompleted') : t('desarrollo.actions.statusPending')}
                                </span>
                                {action.status !== 'completada' && (
                                  <>
                                    <button className="btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }} onClick={() => {
                                      setEditingActionId(action.id);
                                      setEditActionForm({
                                        title: action.title || '',
                                        type: action.type || 'curso',
                                        competencyId: action.competencyId || '',
                                        dueDate: action.dueDate ? action.dueDate.split('T')[0] : '',
                                        description: action.description || '',
                                      });
                                    }}>
                                      {t('common.edit')}
                                    </button>
                                    <button className="btn-primary" style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }} onClick={() => handleCompleteAction(action.id)}>
                                      {t('desarrollo.complete')}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Comments section */}
                <div>
                  <div style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {t('desarrollo.comments.title')} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({planComments.length})</span>
                    </h3>
                  </div>

                  {/* Add comment form */}
                  <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        className="input"
                        value={commentType}
                        onChange={(e) => setCommentType(e.target.value)}
                        style={{ fontSize: '0.82rem', width: '160px' }}
                      >
                        {Object.entries(COMMENT_TYPE_LABEL_KEYS).map(([val, key]) => (
                          <option key={val} value={val}>{t(key)}</option>
                        ))}
                      </select>
                      <input
                        className="input"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder={t('desarrollo.comments.placeholder')}
                        style={{ flex: 1, fontSize: '0.82rem' }}
                      />
                      <button type="submit" className="btn-primary" style={{ fontSize: '0.78rem' }} disabled={addingComment || !commentText.trim()}>
                        {addingComment ? '...' : 'Enviar'}
                      </button>
                    </div>
                  </form>

                  {/* Comments list */}
                  {planComments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {t('desarrollo.comments.empty')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {planComments.map((comment: any) => (
                        <div key={comment.id} style={{ padding: '0.6rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.82rem' }}>
                                {comment.author ? `${comment.author.firstName} ${comment.author.lastName}` : getUserName(comment.authorId || comment.userId)}
                              </span>
                              <span className="badge" style={{ fontSize: '0.68rem' }}>
                                {t(COMMENT_TYPE_LABEL_KEYS[comment.type] || comment.type, { defaultValue: comment.type })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {new Date(comment.createdAt).toLocaleDateString('es-CL')}
                              </span>
                              {(comment.authorId === user?.userId || comment.userId === user?.userId || isAdmin) && (
                                <button
                                  className="btn-ghost"
                                  style={{ fontSize: '0.68rem', padding: '0.15rem 0.3rem', color: 'var(--danger)' }}
                                  onClick={() => handleDeleteComment(comment.id)}
                                >
                                  {t('common.delete')}
                                </button>
                              )}
                            </div>
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>{comment.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                </div>{/* close padding div */}

                {/* Action + Close buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {selectedPlan.status === 'borrador' && canCreate && (
                      <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={() => handleActivate(selectedPlan.id)}>
                        {t('desarrollo.activatePlan')}
                      </button>
                    )}
                    {selectedPlan.status === 'activo' && canCreate && (
                      <button className="btn-primary" style={{ fontSize: '0.82rem', background: 'var(--success)' }} onClick={() => handleCompletePlan(selectedPlan.id)}>
                        {t('desarrollo.markCompleted')}
                      </button>
                    )}
                  </div>
                  <button className="btn-ghost" onClick={() => { setSelectedPlan(null); setEditingActionId(null); }}>
                    {t('common.close')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
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
    </div>
  );
}

export default function DesarrolloPage() {
  return (
    <PlanGate feature="PDI">
      <DesarrolloPageContent />
    </PlanGate>
  );
}
