'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';

// ─── Tipos auxiliares ────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  completado: 'Completado',
  cancelado: 'Cancelado',
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

const STATUS_BADGE: Record<string, string> = {
  borrador: 'badge-warning',
  activo: 'badge-accent',
  completado: 'badge-success',
  cancelado: 'badge-danger',
  pendiente: 'badge-warning',
  en_curso: 'badge-accent',
  completada: 'badge-success',
  cancelada: 'badge-danger',
};

const ACTION_TYPES = [
  { value: 'curso', label: 'Curso' },
  { value: 'mentoring', label: 'Mentoring' },
  { value: 'proyecto', label: 'Proyecto' },
  { value: 'taller', label: 'Taller' },
  { value: 'lectura', label: 'Lectura' },
  { value: 'rotacion', label: 'Rotación' },
  { value: 'otro', label: 'Otro' },
];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(100, Math.max(0, value))}%`,
        background: value >= 100 ? 'var(--success)' : 'var(--accent)',
        borderRadius: '999px',
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function DesarrolloOrganizacionalPage() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const userDept = useAuthStore((s) => (s.user as any)?.department);

  const isAdmin = role === 'tenant_admin';

  // ── Confirm modal ──────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    message: string;
    detail?: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // ── Estado general ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [initiatives, setInitiatives] = useState<any[]>([]);
  const [initLoading, setInitLoading] = useState(false);

  // ── Mensajes ───────────────────────────────────────────────────────────
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  // ── Modal Plan ────────────────────────────────────────────────────────
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ title: '', description: '', year: new Date().getFullYear(), status: 'borrador' });
  const [savingPlan, setSavingPlan] = useState(false);

  // ── Modal Iniciativa ──────────────────────────────────────────────────
  const [showInitForm, setShowInitForm] = useState(false);
  const [editingInitId, setEditingInitId] = useState<string | null>(null);
  const [initForm, setInitForm] = useState({
    title: '', description: '', department: '', targetDate: '',
    responsibleId: '', progress: 0, budget: '', currency: 'UF',
    participantIds: [] as string[],
  });
  const [participantSearch, setParticipantSearch] = useState('');
  const [savingInit, setSavingInit] = useState(false);

  // ── Acciones de iniciativa ─────────────────────────────────────────────
  const [expandedInitId, setExpandedInitId] = useState<string | null>(null);
  const [showActionForm, setShowActionForm] = useState<string | null>(null); // initiativeId
  const [actionForm, setActionForm] = useState({ title: '', actionType: 'curso', dueDate: '', assignedToId: '', notes: '' });
  const [savingAction, setSavingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);

  // ── PDIs vinculados ────────────────────────────────────────────────────
  const [linkedPdis, setLinkedPdis] = useState<Record<string, any[]>>({});

  // ── Departamentos únicos del tenant ───────────────────────────────────
  const departments = Array.from(new Set(users.map((u: any) => u.department).filter(Boolean))).sort();

  // ─── Carga inicial ────────────────────────────────────────────────────────

  async function loadData() {
    if (!token) return;
    setLoading(true);
    try {
      // BUG #5 fix: managers también pueden cargar planes (el backend lo permite ahora)
      const [pl, us] = await Promise.all([
        api.orgDevelopment.plans.list(token).catch(() => []),
        api.users.list(token).catch(() => []),
      ]);
      setPlans(pl ?? []);
      const usersData = Array.isArray(us) ? us : (us as any)?.data ?? [];
      setUsers(usersData);
      if (!selectedPlanId && pl && pl.length > 0) {
        setSelectedPlanId(pl[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cargar iniciativas al cambiar de plan ────────────────────────────────

  useEffect(() => {
    if (!token || !selectedPlanId) { setInitiatives([]); return; }
    setInitLoading(true);
    api.orgDevelopment.initiatives.listByPlan(token, selectedPlanId)
      .then((data) => setInitiatives(data ?? []))
      .catch(() => setInitiatives([]))
      .finally(() => setInitLoading(false));
  }, [token, selectedPlanId]);

  // ─── CRUD Planes ──────────────────────────────────────────────────────────

  async function handleSavePlan() {
    if (!token || !planForm.title || !planForm.year) {
      setError('El título y el año son obligatorios');
      return;
    }
    setSavingPlan(true);
    setError('');
    try {
      if (editingPlanId) {
        await api.orgDevelopment.plans.update(token, editingPlanId, planForm);
        showSuccess('Plan actualizado');
      } else {
        const created = await api.orgDevelopment.plans.create(token, planForm);
        showSuccess('Plan creado correctamente');
        setSelectedPlanId(created.id);
      }
      setShowPlanForm(false);
      setEditingPlanId(null);
      setPlanForm({ title: '', description: '', year: new Date().getFullYear(), status: 'borrador' });
      await loadData();
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar el plan');
    } finally {
      setSavingPlan(false);
    }
  }

  function startEditPlan(plan: any) {
    setPlanForm({ title: plan.title, description: plan.description ?? '', year: plan.year, status: plan.status });
    setEditingPlanId(plan.id);
    setShowPlanForm(true);
    setError('');
  }

  async function handleDeletePlan(id: string, title: string) {
    if (!token) return;
    setConfirmState({
      message: `¿Eliminar el plan "${title}"?`,
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await api.orgDevelopment.plans.delete(token, id);
          showSuccess('Plan eliminado');
          if (selectedPlanId === id) setSelectedPlanId('');
          await loadData();
        } catch (e: any) {
          setError(e.message ?? 'Error al eliminar el plan');
        }
      },
    });
  }

  // ─── CRUD Iniciativas ─────────────────────────────────────────────────────

  async function handleSaveInitiative() {
    if (!token || !selectedPlanId || !initForm.title) {
      setError('El título de la iniciativa es obligatorio');
      return;
    }
    setSavingInit(true);
    setError('');
    try {
      const payload = {
        title: initForm.title,
        description: initForm.description || null,
        department: initForm.department || null,
        targetDate: initForm.targetDate || null,
        responsibleId: initForm.responsibleId || null,
        progress: Number(initForm.progress) || 0,
        budget: initForm.budget ? Number(initForm.budget) : null,
        currency: initForm.currency || 'UF',
        participantIds: initForm.participantIds,
      };
      if (editingInitId) {
        await api.orgDevelopment.initiatives.update(token, editingInitId, payload);
        showSuccess('Iniciativa actualizada');
      } else {
        await api.orgDevelopment.initiatives.create(token, selectedPlanId, payload);
        showSuccess('Iniciativa creada correctamente');
      }
      setShowInitForm(false);
      setEditingInitId(null);
      setParticipantSearch('');
      setInitForm({ title: '', description: '', department: '', targetDate: '', responsibleId: '', progress: 0, budget: '', currency: 'UF', participantIds: [] });
      // Reload initiatives
      const data = await api.orgDevelopment.initiatives.listByPlan(token, selectedPlanId);
      setInitiatives(data ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar la iniciativa');
    } finally {
      setSavingInit(false);
    }
  }

  function startEditInitiative(ini: any) {
    setInitForm({
      title: ini.title,
      description: ini.description ?? '',
      department: ini.department ?? '',
      targetDate: ini.targetDate ?? '',
      responsibleId: ini.responsibleId ?? '',
      progress: ini.progress ?? 0,
      budget: ini.budget != null ? String(ini.budget) : '',
      currency: ini.currency ?? 'UF',
      participantIds: ini.participantIds ?? [],
    });
    setParticipantSearch('');
    setEditingInitId(ini.id);
    setShowInitForm(true);
    setError('');
  }

  async function handleDeleteInitiative(id: string, title: string) {
    if (!token) return;
    setConfirmState({
      message: `¿Eliminar la iniciativa "${title}"?`,
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await api.orgDevelopment.initiatives.delete(token, id);
          showSuccess('Iniciativa eliminada');
          setInitiatives((prev) => prev.filter((i) => i.id !== id));
        } catch (e: any) {
          setError(e.message ?? 'Error al eliminar la iniciativa');
        }
      },
    });
  }

  // ─── CRUD Acciones ────────────────────────────────────────────────────────

  async function handleAddAction(initiativeId: string) {
    if (!token || !actionForm.title) {
      setError('El título de la acción es obligatorio');
      return;
    }
    setSavingAction(true);
    setError('');
    try {
      const payload = {
        title: actionForm.title,
        actionType: actionForm.actionType,
        dueDate: actionForm.dueDate || null,
        assignedToId: actionForm.assignedToId || null,
        notes: actionForm.notes || null,
      };
      if (editingActionId) {
        await api.orgDevelopment.actions.update(token, editingActionId, payload);
        showSuccess('Acción actualizada');
      } else {
        await api.orgDevelopment.actions.create(token, initiativeId, payload);
        showSuccess('Acción agregada');
      }
      setShowActionForm(null);
      setEditingActionId(null);
      setActionForm({ title: '', actionType: 'curso', dueDate: '', assignedToId: '', notes: '' });
      const data = await api.orgDevelopment.initiatives.listByPlan(token, selectedPlanId);
      setInitiatives(data ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar la acción');
    } finally {
      setSavingAction(false);
    }
  }

  async function handleDeleteAction(actionId: string) {
    if (!token) return;
    setConfirmState({
      message: '¿Eliminar esta acción?',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await api.orgDevelopment.actions.delete(token, actionId);
          showSuccess('Acción eliminada');
          const data = await api.orgDevelopment.initiatives.listByPlan(token, selectedPlanId);
          setInitiatives(data ?? []);
        } catch (e: any) {
          setError(e.message ?? 'Error al eliminar la acción');
        }
      },
    });
  }

  async function loadLinkedPdis(initiativeId: string) {
    if (!token || linkedPdis[initiativeId]) return;
    try {
      const pdis = await api.orgDevelopment.initiatives.linkedPdis(token, initiativeId);
      setLinkedPdis((prev) => ({ ...prev, [initiativeId]: pdis ?? [] }));
    } catch { /* ignore */ }
  }

  // ─── Estadísticas del plan seleccionado ──────────────────────────────────

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const avgProgress = initiatives.length
    ? Math.round(initiatives.reduce((s, i) => s + (i.progress ?? 0), 0) / initiatives.length)
    : 0;
  const depts = Array.from(new Set(initiatives.map((i: any) => i.department).filter(Boolean)));

  // ─── Guard de acceso ──────────────────────────────────────────────────────

  if (!token) return null;

  // employee: redirigir o mostrar mensaje
  if (role === 'employee') {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '0.9rem' }}>
            Los planes de desarrollo organizacional son gestionados por el administrador y los managers.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      <div className="animate-fade-up">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              Plan de Desarrollo Organizacional
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {isAdmin
                ? 'Define iniciativas estratégicas de formación y desarrollo para toda la empresa o por departamento.'
                : 'Consulta las iniciativas de desarrollo definidas para tu equipo.'}
            </p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => {
              setEditingPlanId(null);
              setPlanForm({ title: '', description: '', year: new Date().getFullYear(), status: 'borrador' });
              setShowPlanForm(true);
              setError('');
            }}>
              + Nuevo plan
            </button>
          )}
        </div>

        {/* Info card */}
        <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong>Empresa → Departamento → Acción.</strong>{' '}
            Cada plan anual contiene iniciativas por departamento (o para toda la empresa). Los colaboradores pueden vincular sus PDIs individuales a estas iniciativas para mostrar la contribución de su desarrollo a los objetivos organizacionales.
          </p>
        </div>

        {/* Mensajes */}
        {error && (
          <div className="card" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#dc2626', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}
        {success && (
          <div className="card animate-fade-up" style={{ background: 'var(--success)', color: '#fff', padding: '0.75rem 1rem', marginBottom: '1rem', fontWeight: 600, fontSize: '0.85rem' }}>
            ✓ {success}
          </div>
        )}

        {/* Form de plan */}
        {showPlanForm && isAdmin && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '3px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
              {editingPlanId ? 'Editar plan' : 'Nuevo plan estratégico'}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                  Título *
                </label>
                <input
                  className="input"
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  placeholder="Ej: Programa de Liderazgo 2026"
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                  Año *
                </label>
                <input
                  className="input"
                  type="number"
                  min={2020}
                  max={2035}
                  value={planForm.year}
                  onChange={(e) => setPlanForm({ ...planForm, year: Number(e.target.value) })}
                />
              </div>
              {editingPlanId && (
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                    Estado
                  </label>
                  <select className="input" value={planForm.status} onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}>
                    <option value="borrador">Borrador</option>
                    <option value="activo">Activo</option>
                    <option value="completado">Completado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                Descripción
              </label>
              <textarea
                className="input"
                rows={2}
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Objetivos y contexto del plan..."
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn-primary" onClick={handleSavePlan} disabled={savingPlan}>
                {savingPlan ? 'Guardando...' : editingPlanId ? 'Actualizar' : 'Crear plan'}
              </button>
              <button className="btn-ghost" onClick={() => { setShowPlanForm(false); setEditingPlanId(null); setError(''); }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Sin planes */}
        {plans.length === 0 && !showPlanForm && (
          <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏢</div>
            <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              No hay planes organizacionales aún
            </p>
            <p style={{ fontSize: '0.85rem' }}>
              {isAdmin
                ? 'Crea el primer plan estratégico para comenzar a definir iniciativas de desarrollo.'
                : 'El administrador aún no ha creado ningún plan organizacional.'}
            </p>
          </div>
        )}

        {/* Selector de plan */}
        {plans.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <select
                className="input"
                style={{ maxWidth: '400px' }}
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.year} — {p.title} ({STATUS_LABEL[p.status] ?? p.status})
                  </option>
                ))}
              </select>
              {isAdmin && selectedPlan && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} onClick={() => startEditPlan(selectedPlan)}>
                    Editar plan
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem', color: 'var(--danger)' }}
                    onClick={() => handleDeletePlan(selectedPlan.id, selectedPlan.title)}
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>

            {/* Resumen del plan */}
            {selectedPlan && (
              <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1.25rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Estado</span>
                  <span className={`badge ${STATUS_BADGE[selectedPlan.status] ?? 'badge-accent'}`} style={{ marginTop: '0.2rem' }}>
                    {STATUS_LABEL[selectedPlan.status] ?? selectedPlan.status}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Iniciativas</span>
                  <strong style={{ fontSize: '1.1rem' }}>{initiatives.length}</strong>
                </div>
                {depts.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Departamentos</span>
                    <span style={{ fontSize: '0.85rem' }}>{depts.join(', ')}</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    Progreso promedio: <strong>{avgProgress}%</strong>
                  </span>
                  <ProgressBar value={avgProgress} />
                </div>
                {isAdmin && (
                  <button
                    className="btn-primary"
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                    onClick={() => {
                      setEditingInitId(null);
                      setParticipantSearch('');
                      setInitForm({ title: '', description: '', department: '', targetDate: '', responsibleId: '', progress: 0, budget: '', currency: 'UF', participantIds: [] });
                      setShowInitForm(true);
                      setError('');
                    }}
                  >
                    + Nueva iniciativa
                  </button>
                )}
              </div>
            )}

            {/* Formulario de iniciativa */}
            {showInitForm && isAdmin && (
              <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '3px solid var(--accent)' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  {editingInitId ? 'Editar iniciativa' : 'Nueva iniciativa'}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Título *
                    </label>
                    <input
                      className="input"
                      value={initForm.title}
                      onChange={(e) => setInitForm({ ...initForm, title: e.target.value })}
                      placeholder="Ej: Capacitación en Cloud Computing"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Departamento
                    </label>
                    <select className="input" value={initForm.department} onChange={(e) => setInitForm({ ...initForm, department: e.target.value })}>
                      <option value="">Toda la empresa</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Fecha límite
                    </label>
                    <input
                      className="input"
                      type="date"
                      value={initForm.targetDate}
                      onChange={(e) => setInitForm({ ...initForm, targetDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Responsable
                    </label>
                    <select className="input" value={initForm.responsibleId} onChange={(e) => setInitForm({ ...initForm, responsibleId: e.target.value })}>
                      <option value="">Sin asignar</option>
                      {users.filter((u: any) => u.isActive !== false).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Progreso (%)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      value={initForm.progress}
                      onChange={(e) => setInitForm({ ...initForm, progress: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Presupuesto (opcional)
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={initForm.budget}
                        onChange={(e) => setInitForm({ ...initForm, budget: e.target.value })}
                        placeholder="0"
                        style={{ flex: 1 }}
                      />
                      <select className="input" style={{ width: '80px' }} value={initForm.currency} onChange={(e) => setInitForm({ ...initForm, currency: e.target.value })}>
                        <option value="UF">UF</option>
                        <option value="CLP">CLP</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      Descripción
                    </label>
                    <textarea
                      className="input"
                      rows={2}
                      value={initForm.description}
                      onChange={(e) => setInitForm({ ...initForm, description: e.target.value })}
                      placeholder="Objetivos y alcance de la iniciativa..."
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  {/* Participants multi-select */}
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Participantes
                        {initForm.participantIds.length > 0 && (
                          <span style={{ marginLeft: '0.5rem', background: 'var(--accent)', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700 }}>
                            {initForm.participantIds.length}
                          </span>
                        )}
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={
                              users.filter((u: any) => u.isActive !== false).length > 0 &&
                              users.filter((u: any) => u.isActive !== false).every((u: any) => initForm.participantIds.includes(u.id))
                            }
                            onChange={(e) => {
                              const activeIds = users.filter((u: any) => u.isActive !== false).map((u: any) => u.id);
                              setInitForm({ ...initForm, participantIds: e.target.checked ? activeIds : [] });
                            }}
                          />
                          Seleccionar todos
                        </label>
                        {initForm.participantIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setInitForm({ ...initForm, participantIds: [] })}
                            style={{ fontSize: '0.72rem', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            Limpiar
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      className="input"
                      placeholder="Buscar colaborador..."
                      value={participantSearch}
                      onChange={(e) => setParticipantSearch(e.target.value)}
                      style={{ marginBottom: '0.4rem', fontSize: '0.82rem' }}
                    />
                    <div style={{
                      maxHeight: '180px', overflowY: 'auto',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                    }}>
                      {users
                        .filter((u: any) => u.isActive !== false)
                        .filter((u: any) => {
                          if (!participantSearch.trim()) return true;
                          const q = participantSearch.toLowerCase();
                          return (
                            `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
                            (u.department || '').toLowerCase().includes(q) ||
                            (u.position || '').toLowerCase().includes(q)
                          );
                        })
                        .map((u: any) => {
                          const checked = initForm.participantIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                padding: '0.45rem 0.75rem', cursor: 'pointer',
                                background: checked ? 'rgba(99,102,241,0.07)' : 'transparent',
                                borderBottom: '1px solid var(--border)',
                                transition: 'background 0.1s',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const ids = e.target.checked
                                    ? [...initForm.participantIds, u.id]
                                    : initForm.participantIds.filter((id) => id !== u.id);
                                  setInitForm({ ...initForm, participantIds: ids });
                                }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: checked ? 600 : 400, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {u.firstName} {u.lastName}
                                </div>
                                {(u.department || u.position) && (
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    {[u.position, u.department].filter(Boolean).join(' · ')}
                                  </div>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      {users.filter((u: any) => u.isActive !== false).filter((u: any) => {
                        if (!participantSearch.trim()) return true;
                        const q = participantSearch.toLowerCase();
                        return `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
                          (u.department || '').toLowerCase().includes(q);
                      }).length === 0 && (
                        <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          Sin resultados
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', marginBottom: 0 }}>
                      Los colaboradores seleccionados recibirán un correo cuando la iniciativa esté en curso.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-primary" onClick={handleSaveInitiative} disabled={savingInit}>
                    {savingInit ? 'Guardando...' : editingInitId ? 'Actualizar' : 'Crear iniciativa'}
                  </button>
                  <button className="btn-ghost" onClick={() => { setShowInitForm(false); setEditingInitId(null); setParticipantSearch(''); setError(''); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Cargando iniciativas */}
            {initLoading && <Spinner />}

            {/* Sin iniciativas */}
            {!initLoading && initiatives.length === 0 && selectedPlanId && (
              <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Sin iniciativas</p>
                <p style={{ fontSize: '0.85rem' }}>
                  {isAdmin ? 'Haz clic en "+ Nueva iniciativa" para comenzar.' : 'No hay iniciativas definidas para este plan.'}
                </p>
              </div>
            )}

            {/* Lista de iniciativas */}
            {!initLoading && initiatives.map((ini: any) => {
              const isExpanded = expandedInitId === ini.id;
              const actions = ini.actions ?? [];
              const responsible = ini.responsible;
              const pdis = linkedPdis[ini.id];

              return (
                <div key={ini.id} className="card animate-fade-up" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
                  {/* Header de la iniciativa */}
                  <div
                    style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}
                    onClick={() => {
                      const next = isExpanded ? null : ini.id;
                      setExpandedInitId(next);
                      if (next) loadLinkedPdis(next);
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{ini.title}</span>
                        <span className={`badge ${STATUS_BADGE[ini.status] ?? 'badge-accent'}`} style={{ fontSize: '0.72rem' }}>
                          {STATUS_LABEL[ini.status] ?? ini.status}
                        </span>
                        <span className="badge badge-accent" style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' }}>
                          {ini.department ?? 'Toda la empresa'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        {responsible && (
                          <span>👤 {responsible.firstName} {responsible.lastName}</span>
                        )}
                        {Array.isArray(ini.participantIds) && ini.participantIds.length > 0 && (
                          <span title={`${ini.participantIds.length} colaborador${ini.participantIds.length !== 1 ? 'es' : ''} asignado${ini.participantIds.length !== 1 ? 's' : ''}`}>
                            👥 {ini.participantIds.length} participante{ini.participantIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {ini.targetDate && (
                          <span>📅 {new Date(ini.targetDate).toLocaleDateString('es-CL')}</span>
                        )}
                        <span>📋 {actions.length} acción{actions.length !== 1 ? 'es' : ''}</span>
                        {ini.budget != null && (
                          <span>💰 {Number(ini.budget).toLocaleString('es-CL')} {ini.currency}</span>
                        )}
                      </div>
                      <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <ProgressBar value={ini.progress} />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0 }}>{ini.progress}%</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, alignItems: 'center' }}>
                      {isAdmin && (
                        <>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                            onClick={(e) => { e.stopPropagation(); startEditInitiative(ini); }}
                          >
                            Editar
                          </button>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: 'var(--danger)' }}
                            onClick={(e) => { e.stopPropagation(); handleDeleteInitiative(ini.id, ini.title); }}
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                      <span style={{ color: 'var(--text-muted)', fontSize: '1rem', marginLeft: '0.25rem' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {/* Contenido expandido */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', background: 'var(--bg-surface)' }}>

                      {/* Descripción */}
                      {ini.description && (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
                          {ini.description}
                        </p>
                      )}

                      {/* Actualizar progreso (admin) */}
                      {isAdmin && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', flexShrink: 0 }}>Progreso:</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={ini.progress}
                            onChange={async (e) => {
                              if (!token) return;
                              const newProgress = Number(e.target.value);
                              const prevProgress = ini.progress;
                              // Actualización optimista
                              setInitiatives((prev) =>
                                prev.map((x) => x.id === ini.id ? { ...x, progress: newProgress } : x),
                              );
                              try {
                                await api.orgDevelopment.initiatives.update(token, ini.id, { progress: newProgress });
                              } catch {
                                // BUG #6 fix: rollback si falla la API
                                setInitiatives((prev) =>
                                  prev.map((x) => x.id === ini.id ? { ...x, progress: prevProgress } : x),
                                );
                                setError('Error al actualizar el progreso');
                              }
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', minWidth: '36px' }}>
                            {ini.progress}%
                          </span>
                        </div>
                      )}

                      {/* Acciones */}
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Acciones</span>
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
                              onClick={() => {
                                setEditingActionId(null);
                                setActionForm({ title: '', actionType: 'curso', dueDate: '', assignedToId: '', notes: '' });
                                setShowActionForm(ini.id);
                                setError('');
                              }}
                            >
                              + Agregar acción
                            </button>
                          )}
                        </div>

                        {/* Form de acción */}
                        {showActionForm === ini.id && isAdmin && (
                          <div style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '0.75rem', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  Título *
                                </label>
                                <input
                                  className="input"
                                  style={{ fontSize: '0.82rem' }}
                                  value={actionForm.title}
                                  onChange={(e) => setActionForm({ ...actionForm, title: e.target.value })}
                                  placeholder="Ej: Curso AWS Fundamentals"
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  Tipo
                                </label>
                                <select className="input" style={{ fontSize: '0.82rem' }} value={actionForm.actionType} onChange={(e) => setActionForm({ ...actionForm, actionType: e.target.value })}>
                                  {ACTION_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  Fecha límite
                                </label>
                                <input
                                  className="input"
                                  style={{ fontSize: '0.82rem' }}
                                  type="date"
                                  value={actionForm.dueDate}
                                  onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  Responsable
                                </label>
                                <select className="input" style={{ fontSize: '0.82rem' }} value={actionForm.assignedToId} onChange={(e) => setActionForm({ ...actionForm, assignedToId: e.target.value })}>
                                  <option value="">Sin asignar</option>
                                  {users.filter((u: any) => u.isActive !== false).map((u: any) => (
                                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="btn-primary"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                onClick={() => handleAddAction(ini.id)}
                                disabled={savingAction}
                              >
                                {savingAction ? '...' : editingActionId ? 'Actualizar' : 'Agregar'}
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                onClick={() => { setShowActionForm(null); setEditingActionId(null); }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Lista de acciones */}
                        {actions.length === 0 ? (
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin acciones definidas</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {actions.map((a: any) => (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                                <span className={`badge ${STATUS_BADGE[a.status] ?? 'badge-accent'}`} style={{ fontSize: '0.68rem', flexShrink: 0 }}>
                                  {STATUS_LABEL[a.status] ?? a.status}
                                </span>
                                <span style={{ flex: 1, fontSize: '0.83rem', fontWeight: 500 }}>{a.title}</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                                  {ACTION_TYPES.find((t) => t.value === a.actionType)?.label ?? a.actionType}
                                </span>
                                {a.dueDate && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                                    📅 {new Date(a.dueDate).toLocaleDateString('es-CL')}
                                  </span>
                                )}
                                {a.assignedTo && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                                    👤 {a.assignedTo.firstName}
                                  </span>
                                )}
                                {isAdmin && (
                                  <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                                    <button
                                      className="btn-ghost"
                                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem' }}
                                      onClick={() => {
                                        setEditingActionId(a.id);
                                        setActionForm({
                                          title: a.title,
                                          actionType: a.actionType,
                                          dueDate: a.dueDate ?? '',
                                          assignedToId: a.assignedToId ?? '',
                                          notes: a.notes ?? '',
                                        });
                                        setShowActionForm(ini.id);
                                      }}
                                    >
                                      Editar
                                    </button>
                                    <button
                                      className="btn-ghost"
                                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', color: 'var(--danger)' }}
                                      onClick={(e) => { e.stopPropagation(); handleDeleteAction(a.id); }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* PDIs vinculados */}
                      {pdis !== undefined && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            PDIs vinculados: {pdis.length}
                          </span>
                          {pdis.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                              {pdis.map((p: any) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.7rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                                  <span style={{ fontWeight: 500 }}>{p.userName}</span>
                                  <span className={`badge ${STATUS_BADGE[p.status] ?? 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                                    {STATUS_LABEL[p.status] ?? p.status}
                                  </span>
                                  <span style={{ color: 'var(--text-muted)' }}>{p.progress}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })}
          </>
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
