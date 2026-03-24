'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

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

const STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  en_revision: 'En revisi\u00f3n',
  completado: 'Completado',
  cancelado: 'Cancelado',
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

const ACTION_TYPE_LABEL: Record<string, string> = {
  curso: 'Curso',
  mentoring: 'Mentoring',
  proyecto: 'Proyecto',
  taller: 'Taller',
  lectura: 'Lectura',
  rotacion: 'Rotaci\u00f3n',
  otro: 'Otro',
};

const PRIORITY_BADGE: Record<string, string> = {
  alta: 'badge badge-danger',
  media: 'badge badge-warning',
  baja: 'badge badge-accent',
};

const PRIORITY_LABEL: Record<string, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

const COMMENT_TYPE_LABEL: Record<string, string> = {
  comentario: 'Comentario',
  felicitacion: 'Felicitaci\u00f3n',
  seguimiento: 'Seguimiento',
  revision: 'Revisi\u00f3n',
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

export default function DesarrolloPage() {
  const { token, user } = useAuthStore();
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin';
  const isManager = role === 'manager';
  const canCreate = isAdmin || isManager;

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [competencies, setCompetencies] = useState<any[]>([]);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
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
      ];
      if (canCreate) {
        promises.push(api.cycles.list(token!).catch(() => []));
      }
      const [plansRes, usersRes, compsRes, cyclesRes] = await Promise.all(promises);
      setPlans(Array.isArray(plansRes) ? plansRes : []);
      const userData = Array.isArray(usersRes) ? usersRes : (usersRes as any)?.data || [];
      setUsers(userData);
      setCompetencies(Array.isArray(compsRes) ? compsRes : []);
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
      });
      setPlanForm(emptyPlanForm);
      setShowCreate(false);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Error al crear plan');
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
      alert(e.message || 'No se encontr\u00f3 evaluaci\u00f3n de talento para este usuario y ciclo');
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
      alert(e.message || 'Error al activar plan');
    }
  }

  async function handleCompletePlan(planId: string) {
    if (!token) return;
    try {
      await api.development.plans.complete(token, planId);
      await loadData();
      if (selectedPlan?.id === planId) await openDetail({ id: planId });
    } catch (e: any) {
      alert(e.message || 'Error al completar plan');
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
      alert(e.message || 'Error al agregar acci\u00f3n');
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
      alert(e.message || 'Error al completar acci\u00f3n');
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
      alert(e.message || 'Error al editar acci\u00f3n');
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
      alert(e.message || 'Error al agregar comentario');
    } finally {
      setAddingComment(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!token || !selectedPlan) return;
    if (!confirm('\u00bfEliminar este comentario?')) return;
    try {
      await api.development.comments.remove(token, selectedPlan.id, commentId);
      const comments = await api.development.comments.list(token, selectedPlan.id);
      setPlanComments(Array.isArray(comments) ? comments : []);
    } catch (e: any) {
      alert(e.message || 'Error al eliminar comentario');
    }
  }

  function getUserName(userId: string) {
    const u = users.find((x: any) => x.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : userId;
  }

  function getCompetencyName(id: string) {
    const c = competencies.find((x: any) => x.id === id);
    return c ? c.name : '';
  }

  const pageTitle = isAdmin
    ? 'Planes de Desarrollo'
    : isManager
      ? 'Planes de Desarrollo del Equipo'
      : 'Mi Plan de Desarrollo';

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
            {'Gesti\u00f3n de planes de desarrollo individual (PDI)'}
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancelar' : '+ Nuevo Plan'}
          </button>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Info card */}
      <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>
          {'\u00bfQu\u00e9 son los Planes de Desarrollo Individual (PDI)?'}
        </p>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {'Los PDI permiten definir acciones concretas para el crecimiento profesional de cada colaborador. Cada plan se compone de acciones espec\u00edficas (cursos, mentor\u00edas, proyectos, talleres, lecturas o rotaciones) vinculadas a competencias del cat\u00e1logo organizacional.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <div>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700 }}>
              {'Flujo de trabajo'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li><strong>{'1. Crear plan (Borrador)'}</strong>{' \u2192 El Administrador o Encargado crea un PDI para un colaborador'}</li>
              <li><strong>{'2. Activar plan'}</strong>{' \u2192 Se confirma y el colaborador puede ver sus acciones asignadas'}</li>
              <li><strong>{'3. Ejecutar acciones'}</strong>{' \u2192 El colaborador completa cursos, proyectos, mentor\u00edas, etc.'}</li>
              <li><strong>{'4. Completar plan'}</strong>{' \u2192 Solo el Administrador o Encargado marca el plan como finalizado'}</li>
            </ul>
          </div>
          <div>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700 }}>
              {'Permisos y conexiones'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li><strong>{'Administrador / Encargado'}</strong>{': Crean planes, agregan acciones, activan y completan'}</li>
              <li><strong>{'Colaborador'}</strong>{': Ve su plan, completa acciones individuales, agrega comentarios'}</li>
              <li><strong>{'Evaluaci\u00f3n de Talento'}</strong>{': Sugiere competencias seg\u00fan la Matriz Nine Box'}</li>
              <li><strong>{'Cat\u00e1logo de Competencias'}</strong>{': Las acciones se vinculan a competencias organizacionales'}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create form */}
      {showCreate && canCreate && (
        <div className="card animate-fade-up">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 0 }}>
            {'Crear Nuevo Plan de Desarrollo'}
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 0.75rem' }}>
            {'Selecciona un colaborador y define el plan. Una vez creado quedar\u00e1 en estado Borrador hasta que lo actives.'}
          </p>
          <form onSubmit={handleCreatePlan} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Colaborador
                <select
                  value={planForm.userId}
                  onChange={(e) => setPlanForm({ ...planForm, userId: e.target.value })}
                  required
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <option value="">Seleccionar...</option>
                  {availableUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {'T\u00edtulo'}
                <input
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  required
                  placeholder={'T\u00edtulo del plan'}
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Prioridad
                <select
                  value={planForm.priority}
                  onChange={(e) => setPlanForm({ ...planForm, priority: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {'Descripci\u00f3n'}
              <textarea
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                rows={2}
                placeholder={'Descripci\u00f3n del plan (opcional)'}
                style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Fecha inicio
                <input
                  type="date"
                  value={planForm.startDate}
                  onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Fecha objetivo
                <input
                  type="date"
                  value={planForm.targetDate}
                  onChange={(e) => setPlanForm({ ...planForm, targetDate: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                />
              </label>
            </div>
            {/* Suggest from assessment */}
            {planForm.userId && cycles.length > 0 && (
              <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  {'Sugerir acciones desde evaluaci\u00f3n de talento'}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={suggestCycleId}
                    onChange={(e) => { setSuggestCycleId(e.target.value); setSuggestResult(null); }}
                    style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem', flex: 1 }}
                  >
                    <option value="">{'Seleccionar ciclo...'}</option>
                    {cycles.filter((c: any) => c.status === 'closed').map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}
                    onClick={handleSuggest}
                    disabled={suggestLoading || !suggestCycleId}
                  >
                    {suggestLoading ? 'Consultando...' : 'Sugerir'}
                  </button>
                </div>
                {suggestResult && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      {'Puntaje: '}{suggestResult.performanceScore}{' \u2014 \u00c1rea de enfoque: '}{suggestResult.focusArea}
                    </div>
                    {suggestResult.suggestedCompetencies?.length > 0 && (
                      <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {suggestResult.suggestedCompetencies.map((c: any) => (
                          <span key={c.id} className="badge badge-accent" style={{ fontSize: '0.75rem' }}>
                            {c.name} ({c.suggestedActionTypes?.join(', ')})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Creando...' : 'Crear Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans list */}
      {plans.length === 0 && !loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No hay planes de desarrollo registrados.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {plans.map((plan: any) => {
            const progress = plan.progress ?? 0;
            return (
              <div key={plan.id} className="card animate-fade-up" style={{ cursor: 'pointer' }} onClick={() => openDetail(plan)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    {(isAdmin || isManager) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        {getUserName(plan.userId)}
                      </div>
                    )}
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {plan.title}
                    </div>
                    {plan.description && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {plan.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={STATUS_BADGE[plan.status] || 'badge'}>
                      {STATUS_LABEL[plan.status] || plan.status}
                    </span>
                    <span className={PRIORITY_BADGE[plan.priority] || 'badge'}>
                      {PRIORITY_LABEL[plan.priority] || plan.priority}
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    <span>Progreso</span>
                    <span>{progress}%</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progress}%`, background: progress >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '3px', transition: 'width 0.3s' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {plan.targetDate && `Fecha l\u00edmite: ${new Date(plan.targetDate).toLocaleDateString('es-CL')}`}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                    {plan.status === 'borrador' && canCreate && (
                      <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem' }} onClick={() => handleActivate(plan.id)}>
                        Activar
                      </button>
                    )}
                    {plan.status === 'activo' && canCreate && (
                      <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem' }} onClick={() => handleCompletePlan(plan.id)}>
                        Completar
                      </button>
                    )}
                    <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.75rem' }} onClick={() => openDetail(plan)}>
                      Ver detalle
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
            className="card animate-fade-up"
            style={{ maxWidth: '800px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <Spinner />
            ) : (
              <>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    {(isAdmin || isManager) && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        {getUserName(selectedPlan.userId)}
                      </div>
                    )}
                    <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {selectedPlan.title}
                    </h2>
                    {selectedPlan.description && (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {selectedPlan.description}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    <span className={STATUS_BADGE[selectedPlan.status] || 'badge'}>
                      {STATUS_LABEL[selectedPlan.status] || selectedPlan.status}
                    </span>
                    <span className={PRIORITY_BADGE[selectedPlan.priority] || 'badge'}>
                      {PRIORITY_LABEL[selectedPlan.priority] || selectedPlan.priority}
                    </span>
                  </div>
                </div>

                {/* Info mini-card */}
                <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--accent)', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {selectedPlan.status === 'borrador' && canCreate && `Este plan est\u00e1 en Borrador. Activa el plan para que el colaborador pueda ver y ejecutar sus acciones.`}
                  {selectedPlan.status === 'activo' && canCreate && `Plan activo. Agrega acciones de desarrollo y marca cada una como completada cuando el colaborador las finalice. Una vez que todas las acciones est\u00e9n listas, puedes marcar el plan como Completado.`}
                  {selectedPlan.status === 'activo' && !canCreate && `Tu plan est\u00e1 activo. Revisa las acciones asignadas y m\u00e1rcalas como completadas cuando las finalices. Puedes agregar comentarios para comunicarte con tu encargado.`}
                  {selectedPlan.status === 'completado' && `Este plan ha sido completado exitosamente.`}
                  {selectedPlan.status === 'cancelado' && 'Este plan fue cancelado.'}
                  {selectedPlan.status === 'en_revision' && `Este plan est\u00e1 en revisi\u00f3n por el encargado.`}
                </div>

                {/* Progress */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    <span>Progreso general</span>
                    <span>{selectedPlan.progress ?? 0}%</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${selectedPlan.progress ?? 0}%`, background: (selectedPlan.progress ?? 0) >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Actions section */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Acciones ({planActions.length})
                    </h3>
                    {(canCreate || selectedPlan.userId === user?.userId) && (
                      <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setShowAddAction(!showAddAction)}>
                        {showAddAction ? 'Cancelar' : '+ Agregar acci\u00f3n'}
                      </button>
                    )}
                  </div>

                  {/* Add action form */}
                  {showAddAction && (
                    <form onSubmit={handleAddAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                        <input
                          value={actionForm.title}
                          onChange={(e) => setActionForm({ ...actionForm, title: e.target.value })}
                          required
                          placeholder={'T\u00edtulo de la acci\u00f3n'}
                          style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                        />
                        <select
                          value={actionForm.type}
                          onChange={(e) => setActionForm({ ...actionForm, type: e.target.value })}
                          style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                        >
                          {Object.entries(ACTION_TYPE_LABEL).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                        <select
                          value={actionForm.competencyId}
                          onChange={(e) => setActionForm({ ...actionForm, competencyId: e.target.value })}
                          style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                        >
                          <option value="">Competencia (opcional)</option>
                          {competencies.map((c: any) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={actionForm.dueDate}
                          onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                          style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                        />
                      </div>
                      <input
                        value={actionForm.description}
                        onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                        placeholder={'Descripci\u00f3n (opcional)'}
                        style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button type="submit" className="btn-primary" style={{ fontSize: '0.78rem' }} disabled={addingAction}>
                          {addingAction ? 'Agregando...' : 'Agregar'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Actions list */}
                  {planActions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Sin acciones registradas
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {planActions.map((action: any) => (
                        <div key={action.id} style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: action.status === 'completada' ? 'rgba(16,185,129,0.05)' : 'transparent' }}>
                          {editingActionId === action.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
                                <input
                                  value={editActionForm.title}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, title: e.target.value })}
                                  style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                                />
                                <select
                                  value={editActionForm.type}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, type: e.target.value })}
                                  style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                                >
                                  {Object.entries(ACTION_TYPE_LABEL).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={editActionForm.dueDate}
                                  onChange={(e) => setEditActionForm({ ...editActionForm, dueDate: e.target.value })}
                                  style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                                />
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button className="btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => setEditingActionId(null)}>Cancelar</button>
                                <button className="btn-primary" style={{ fontSize: '0.75rem' }} onClick={() => handleEditAction(action.id)}>Guardar</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ flex: 1, minWidth: '150px' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                  <span className={ACTION_TYPE_BADGE[action.type] || 'badge'} style={{ fontSize: '0.7rem' }}>
                                    {ACTION_TYPE_LABEL[action.type] || action.type}
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
                                    Vence: {new Date(action.dueDate).toLocaleDateString('es-CL')}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span className={action.status === 'completada' ? 'badge badge-success' : 'badge badge-warning'} style={{ fontSize: '0.7rem' }}>
                                  {action.status === 'completada' ? 'Completada' : 'Pendiente'}
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
                                      Editar
                                    </button>
                                    <button className="btn-primary" style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }} onClick={() => handleCompleteAction(action.id)}>
                                      Completar
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
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Comentarios ({planComments.length})
                  </h3>

                  {/* Add comment form */}
                  <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        value={commentType}
                        onChange={(e) => setCommentType(e.target.value)}
                        style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem', width: '160px' }}
                      >
                        {Object.entries(COMMENT_TYPE_LABEL).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                      <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Escribir un comentario..."
                        style={{ flex: 1, padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                      />
                      <button type="submit" className="btn-primary" style={{ fontSize: '0.78rem' }} disabled={addingComment || !commentText.trim()}>
                        {addingComment ? '...' : 'Enviar'}
                      </button>
                    </div>
                  </form>

                  {/* Comments list */}
                  {planComments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {'Sin comentarios a\u00fan'}
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
                                {COMMENT_TYPE_LABEL[comment.type] || comment.type}
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
                                  Eliminar
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

                {/* Action + Close buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {selectedPlan.status === 'borrador' && canCreate && (
                      <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={() => handleActivate(selectedPlan.id)}>
                        {'Activar Plan'}
                      </button>
                    )}
                    {selectedPlan.status === 'activo' && canCreate && (
                      <button className="btn-primary" style={{ fontSize: '0.82rem', background: 'var(--success)' }} onClick={() => handleCompletePlan(selectedPlan.id)}>
                        {'Marcar como Completado'}
                      </button>
                    )}
                  </div>
                  <button className="btn-ghost" onClick={() => { setSelectedPlan(null); setEditingActionId(null); }}>
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
