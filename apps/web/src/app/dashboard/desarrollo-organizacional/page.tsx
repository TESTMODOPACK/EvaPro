'use client';

import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { useRequireRole } from '@/hooks/useRequireRole';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';
import { useDepartments } from '@/hooks/useDepartments';

// ─── Tipos auxiliares ────────────────────────────────────────────────────────

const STATUS_LABEL_KEYS: Record<string, string> = {
  borrador: 'orgDesarrollo.status.borrador',
  activo: 'orgDesarrollo.status.activo',
  completado: 'orgDesarrollo.status.completado',
  cancelado: 'orgDesarrollo.status.cancelado',
  pendiente: 'orgDesarrollo.status.pendiente',
  en_curso: 'orgDesarrollo.status.en_curso',
  completada: 'orgDesarrollo.status.completada',
  cancelada: 'orgDesarrollo.status.cancelada',
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

const ACTION_TYPE_KEYS = [
  { value: 'curso', key: 'desarrollo.actionType.curso' },
  { value: 'mentoring', key: 'desarrollo.actionType.mentoring' },
  { value: 'proyecto', key: 'desarrollo.actionType.proyecto' },
  { value: 'taller', key: 'desarrollo.actionType.taller' },
  { value: 'lectura', key: 'desarrollo.actionType.lectura' },
  { value: 'rotacion', key: 'desarrollo.actionType.rotacion' },
  { value: 'otro', key: 'desarrollo.actionType.otro' },
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

function DesarrolloOrganizacionalPageContent() {
  // P11 audit tenant_admin — guard defensivo: backend org-development.controller @Roles(tenant_admin, manager).
  const authorized = useRequireRole(['tenant_admin', 'manager']);
  const { t } = useTranslation();
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

  const [showGuide, setShowGuide] = useState(false);

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
  const [participantPage, setParticipantPage] = useState(1);
  const PARTICIPANT_PAGE_SIZE = 10;
  const [savingInit, setSavingInit] = useState(false);

  // ── Acciones de iniciativa ─────────────────────────────────────────────
  const [expandedInitId, setExpandedInitId] = useState<string | null>(null);
  const [showActionForm, setShowActionForm] = useState<string | null>(null); // initiativeId
  const [actionForm, setActionForm] = useState({ title: '', actionType: 'curso', dueDate: '', assignedToId: '', notes: '' });
  const [savingAction, setSavingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);

  // ── PDIs vinculados ────────────────────────────────────────────────────
  const [linkedPdis, setLinkedPdis] = useState<Record<string, any[]>>({});

  // ── Departamentos configurados en Mantenedores ───────────────────────
  const { departments, departmentRecords } = useDepartments();

  // ─── Carga inicial ────────────────────────────────────────────────────────

  async function loadData() {
    if (!token) return;
    setLoading(true);
    try {
      // BUG #5 fix: managers también pueden cargar planes (el backend lo permite ahora)
      const [pl, us] = await Promise.all([
        api.orgDevelopment.plans.list(token).catch(() => []),
        api.users.list(token, 1, 500).catch(() => []),
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
        departmentId: (() => { const r = departmentRecords.find(d => d.name.toLowerCase() === (initForm.department || '').toLowerCase()); return r?.id || null; })(),
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
      setInitForm({ title: '', description: '', department: '', targetDate: '', responsibleId: '', progress: 0, budget: '', currency: 'UF', participantIds: [] }); setParticipantPage(1); setParticipantSearch('');
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
            {t('orgDesarrollo.employeeRestricted')}
          </p>
        </div>
      </div>
    );
  }

  // P11 audit — bloquear render si no autorizado (useRequireRole ya disparó redirect).
  if (!authorized) return null;
  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      <div className="animate-fade-up">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {t('orgDesarrollo.title')}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {isAdmin
                ? t('orgDesarrollo.subtitleAdmin')
                : t('orgDesarrollo.subtitleManager')}
            </p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => {
              setEditingPlanId(null);
              setPlanForm({ title: '', description: '', year: new Date().getFullYear(), status: 'borrador' });
              setShowPlanForm(true);
              setError('');
            }}>
              {t('orgDesarrollo.newPlan')}
            </button>
          )}
        </div>

        {/* Guide toggle */}
        <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? t('common.hideGuide') : t('common.showGuide')}
          </button>
        </div>
        {showGuide && (
          <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Desarrollo Organizacional</h3>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem', margin: '0 0 1rem' }}>
              <li><strong>¿Qué es?</strong> Gestión de planes e iniciativas de desarrollo a nivel organizacional — programas de capacitación, mejora de procesos, proyectos estratégicos.</li>
              <li><strong>Planes:</strong> Agrupaciones temáticas que contienen iniciativas. Cada plan tiene un nombre, descripción, fechas y departamentos asociados.</li>
              <li><strong>Iniciativas:</strong> Acciones concretas dentro de un plan, con responsable, progreso (%) y fecha límite.</li>
              <li><strong>Flujo:</strong> 1) Crear un plan. 2) Agregar iniciativas al plan. 3) Asignar responsables. 4) Actualizar progreso periódicamente. 5) Marcar como completada al finalizar.</li>
              <li><strong>Estadísticas:</strong> Progreso promedio, cantidad de iniciativas por estado, departamentos involucrados.</li>
              <li><strong>Responsable:</strong> Es la persona encargada de liderar y dar seguimiento a la iniciativa. Solo puede haber uno por iniciativa.</li>
              <li><strong>Participantes:</strong> Son los colaboradores involucrados en la ejecución de la iniciativa. Reciben notificación por correo cuando la iniciativa inicia y pueden vincular sus Planes de Desarrollo (PDI) individuales a la iniciativa.</li>
            </ul>
            <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '0.75rem' }}>
              <strong style={{ color: 'var(--accent)' }}>Estructura: Empresa → Departamento → Acción.</strong>{' '}
              Cada plan anual contiene iniciativas por departamento (o para toda la empresa). Los colaboradores pueden vincular sus PDIs individuales a estas iniciativas para mostrar la contribución de su desarrollo a los objetivos organizacionales.
            </div>
            <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores crean y gestionan planes. Encargados pueden ver planes de su área. Colaboradores no tienen acceso.
            </div>
          </div>
        )}

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
              {editingPlanId ? t('orgDesarrollo.editPlan') : t('orgDesarrollo.newStrategicPlan')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                  {t('orgDesarrollo.form.title')}
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
                  {t('orgDesarrollo.form.year')}
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
                    {t('common.status')}
                  </label>
                  <select className="input" value={planForm.status} onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}>
                    <option value="borrador">{t(STATUS_LABEL_KEYS.borrador)}</option>
                    <option value="activo">{t(STATUS_LABEL_KEYS.activo)}</option>
                    <option value="completado">{t(STATUS_LABEL_KEYS.completado)}</option>
                    <option value="cancelado">{t(STATUS_LABEL_KEYS.cancelado)}</option>
                  </select>
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                {t('orgDesarrollo.form.description')}
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
                {savingPlan ? t('common.saving') : editingPlanId ? t('common.update') : t('orgDesarrollo.createPlan')}
              </button>
              <button className="btn-ghost" onClick={() => { setShowPlanForm(false); setEditingPlanId(null); setError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Sin planes */}
        {plans.length === 0 && !showPlanForm && (
          <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏢</div>
            <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              {t('orgDesarrollo.noPlans')}
            </p>
            <p style={{ fontSize: '0.85rem' }}>
              {isAdmin
                ? t('orgDesarrollo.noPlansAdmin')
                : t('orgDesarrollo.noPlansManager')}
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
                    {p.year} — {p.title} ({t(STATUS_LABEL_KEYS[p.status] ?? p.status, { defaultValue: p.status })})
                  </option>
                ))}
              </select>
              {isAdmin && selectedPlan && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} onClick={() => startEditPlan(selectedPlan)}>
                    {t('orgDesarrollo.editPlan')}
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem', color: 'var(--danger)' }}
                    onClick={() => handleDeletePlan(selectedPlan.id, selectedPlan.title)}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>

            {/* Resumen del plan */}
            {selectedPlan && (
              <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1.25rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{t('common.status')}</span>
                  <span className={`badge ${STATUS_BADGE[selectedPlan.status] ?? 'badge-accent'}`} style={{ marginTop: '0.2rem' }}>
                    {t(STATUS_LABEL_KEYS[selectedPlan.status] ?? selectedPlan.status, { defaultValue: selectedPlan.status })}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{t('orgDesarrollo.initiatives')}</span>
                  <strong style={{ fontSize: '1.1rem' }}>{initiatives.length}</strong>
                </div>
                {depts.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{t('orgDesarrollo.departments')}</span>
                    <span style={{ fontSize: '0.85rem' }}>{depts.join(', ')}</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    {t('orgDesarrollo.avgProgress')}: <strong>{avgProgress}%</strong>
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
                      setInitForm({ title: '', description: '', department: '', targetDate: '', responsibleId: '', progress: 0, budget: '', currency: 'UF', participantIds: [] }); setParticipantPage(1); setParticipantSearch('');
                      setShowInitForm(true);
                      setError('');
                    }}
                  >
                    {t('orgDesarrollo.newInitiative')}
                  </button>
                )}
              </div>
            )}

            {/* Formulario de iniciativa */}
            {showInitForm && isAdmin && (
              <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '3px solid var(--accent)' }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  {editingInitId ? t('orgDesarrollo.editInitiative') : t('orgDesarrollo.newInitiativeForm')}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      {t('orgDesarrollo.form.initiativeTitle')}
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
                      {t('orgDesarrollo.form.department')}
                    </label>
                    <select className="input" value={initForm.department} onChange={(e) => { setInitForm({ ...initForm, department: e.target.value }); setParticipantPage(1); setParticipantSearch(''); }}>
                      <option value="">{t('orgDesarrollo.allCompany')}</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      {t('orgDesarrollo.form.targetDate')}
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
                      {t('orgDesarrollo.form.responsible', 'Responsable')} (líder de la iniciativa)
                    </label>
                    <select className="input" value={initForm.responsibleId} onChange={(e) => setInitForm({ ...initForm, responsibleId: e.target.value })}>
                      <option value="">— Seleccionar responsable —</option>
                      {users
                        .filter((u: any) => u.isActive !== false)
                        .filter((u: any) => !initForm.department || u.department === initForm.department || !u.department)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}{u.position ? ` — ${u.position}` : ''}{u.department ? ` (${u.department})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                  {/* Progress only shown when editing, not creating */}
                  {editingInitId && (
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                        {t('orgDesarrollo.form.progress')}
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
                  )}
                  <div style={!editingInitId ? { gridColumn: 'span 2' } : undefined}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                      {t('orgDesarrollo.form.budget')}
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
                      {t('orgDesarrollo.form.description')}
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

                  {/* ── Participantes ──────────────────────────────────────── */}
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {t('orgDesarrollo.form.participants', 'Participantes')}
                        {initForm.participantIds.length > 0 && (
                          <span style={{ marginLeft: '0.5rem', background: 'var(--accent)', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700 }}>
                            {initForm.participantIds.length} seleccionado{initForm.participantIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </label>
                      {initForm.participantIds.length > 0 && (
                        <button type="button" onClick={() => setInitForm({ ...initForm, participantIds: [] })}
                          style={{ fontSize: '0.72rem', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          Quitar todos
                        </button>
                      )}
                    </div>

                    {/* ─ CASO 1: Toda la empresa (sin departamento) ─ */}
                    {!initForm.department && (
                      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem', background: 'var(--bg-surface)' }}>
                        <button
                          type="button"
                          className={initForm.participantIds.length === users.filter((u: any) => u.isActive !== false).length ? 'btn-primary' : 'btn-ghost'}
                          style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', marginBottom: '0.75rem' }}
                          onClick={() => {
                            const allActive = users.filter((u: any) => u.isActive !== false).map((u: any) => u.id);
                            const allSelected = allActive.length > 0 && allActive.every((id: string) => initForm.participantIds.includes(id));
                            setInitForm({ ...initForm, participantIds: allSelected ? [] : allActive });
                          }}
                        >
                          {(() => {
                            const allActive = users.filter((u: any) => u.isActive !== false);
                            const allSelected = allActive.length > 0 && allActive.every((u: any) => initForm.participantIds.includes(u.id));
                            return allSelected ? `✓ Toda la empresa seleccionada (${allActive.length})` : `Seleccionar toda la empresa (${allActive.length} colaboradores)`;
                          })()}
                        </button>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                          O busca colaboradores específicos para agregar individualmente:
                        </p>
                        <input
                          className="input"
                          placeholder="Buscar por nombre, departamento o cargo..."
                          value={participantSearch}
                          onChange={(e) => { setParticipantSearch(e.target.value); setParticipantPage(1); }}
                          style={{ marginBottom: '0.4rem', fontSize: '0.82rem' }}
                        />
                        {participantSearch.trim() && (() => {
                          const q = participantSearch.toLowerCase();
                          const results = users.filter((u: any) => u.isActive !== false && (
                            `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
                            (u.department || '').toLowerCase().includes(q) ||
                            (u.position || '').toLowerCase().includes(q)
                          ));
                          return results.length === 0 ? (
                            <div style={{ padding: '0.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('common.noResults')}</div>
                          ) : (
                            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', maxHeight: '200px', overflowY: 'auto' }}>
                              {results.slice(0, 20).map((u: any) => {
                                const checked = initForm.participantIds.includes(u.id);
                                return (
                                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.75rem', cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.07)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                                    <input type="checkbox" checked={checked} onChange={(e) => {
                                      const ids = e.target.checked ? [...initForm.participantIds, u.id] : initForm.participantIds.filter((id) => id !== u.id);
                                      setInitForm({ ...initForm, participantIds: ids });
                                    }} />
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: '0.85rem', fontWeight: checked ? 600 : 400 }}>{u.firstName} {u.lastName}</div>
                                      {(u.department || u.position) && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{[u.position, u.department].filter(Boolean).join(' · ')}</div>}
                                    </div>
                                  </label>
                                );
                              })}
                              {results.length > 20 && <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Mostrando 20 de {results.length} resultados. Refina tu búsqueda.</div>}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* ─ CASO 2: Departamento específico ─ */}
                    {initForm.department && (() => {
                      const deptUsers = users.filter((u: any) => u.isActive !== false && u.department === initForm.department);
                      const totalPages = Math.max(1, Math.ceil(deptUsers.length / PARTICIPANT_PAGE_SIZE));
                      const safePage = Math.min(participantPage, totalPages);
                      const pageUsers = deptUsers.slice((safePage - 1) * PARTICIPANT_PAGE_SIZE, safePage * PARTICIPANT_PAGE_SIZE);
                      const allDeptSelected = deptUsers.length > 0 && deptUsers.every((u: any) => initForm.participantIds.includes(u.id));
                      return (
                        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' }}>
                          {/* Header: select all dept + count */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              <input type="checkbox" checked={allDeptSelected} style={{ accentColor: 'var(--accent)' }}
                                onChange={(e) => {
                                  const deptIds = deptUsers.map((u: any) => u.id);
                                  if (e.target.checked) {
                                    const merged = Array.from(new Set([...initForm.participantIds, ...deptIds]));
                                    setInitForm({ ...initForm, participantIds: merged });
                                  } else {
                                    const deptSet = new Set(deptIds);
                                    setInitForm({ ...initForm, participantIds: initForm.participantIds.filter((id) => !deptSet.has(id)) });
                                  }
                                }}
                              />
                              Seleccionar todo {initForm.department} ({deptUsers.length})
                            </label>
                            {totalPages > 1 && (
                              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                <button type="button" className="btn-ghost" disabled={safePage <= 1} onClick={() => setParticipantPage(p => p - 1)} style={{ padding: '0.15rem 0.4rem', fontSize: '0.72rem' }}>←</button>
                                <span>{safePage}/{totalPages}</span>
                                <button type="button" className="btn-ghost" disabled={safePage >= totalPages} onClick={() => setParticipantPage(p => p + 1)} style={{ padding: '0.15rem 0.4rem', fontSize: '0.72rem' }}>→</button>
                              </div>
                            )}
                          </div>

                          {/* User list — paginated */}
                          {deptUsers.length === 0 ? (
                            <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                              No hay colaboradores en {initForm.department}
                            </div>
                          ) : pageUsers.map((u: any) => {
                            const checked = initForm.participantIds.includes(u.id);
                            return (
                              <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.75rem', cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.07)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                                <input type="checkbox" checked={checked} style={{ accentColor: 'var(--accent)' }}
                                  onChange={(e) => {
                                    const ids = e.target.checked ? [...initForm.participantIds, u.id] : initForm.participantIds.filter((id) => id !== u.id);
                                    setInitForm({ ...initForm, participantIds: ids });
                                  }}
                                />
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: '0.85rem', fontWeight: checked ? 600 : 400, color: 'var(--text-primary)' }}>{u.firstName} {u.lastName}</div>
                                  {u.position && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.position}</div>}
                                </div>
                              </label>
                            );
                          })}

                          {/* Search for other departments */}
                          <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.35rem' }}>
                              Agregar colaborador de otro departamento:
                            </p>
                            <input
                              className="input"
                              placeholder="Buscar por nombre..."
                              value={participantSearch}
                              onChange={(e) => setParticipantSearch(e.target.value)}
                              style={{ fontSize: '0.82rem' }}
                            />
                            {participantSearch.trim() && (() => {
                              const q = participantSearch.toLowerCase();
                              const results = users.filter((u: any) => u.isActive !== false && u.department !== initForm.department && (
                                `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
                                (u.department || '').toLowerCase().includes(q) ||
                                (u.position || '').toLowerCase().includes(q)
                              ));
                              return results.length === 0 ? (
                                <div style={{ padding: '0.4rem 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Sin resultados</div>
                              ) : (
                                <div style={{ maxHeight: '120px', overflowY: 'auto', marginTop: '0.3rem' }}>
                                  {results.slice(0, 10).map((u: any) => {
                                    const checked = initForm.participantIds.includes(u.id);
                                    return (
                                      <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.82rem', background: checked ? 'rgba(99,102,241,0.07)' : 'transparent', borderRadius: 'var(--radius-sm)' }}>
                                        <input type="checkbox" checked={checked} style={{ accentColor: 'var(--accent)' }}
                                          onChange={(e) => {
                                            const ids = e.target.checked ? [...initForm.participantIds, u.id] : initForm.participantIds.filter((id) => id !== u.id);
                                            setInitForm({ ...initForm, participantIds: ids });
                                          }}
                                        />
                                        <span style={{ fontWeight: checked ? 600 : 400 }}>{u.firstName} {u.lastName}</span>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.department || ''}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}

                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', marginBottom: 0 }}>
                      Los participantes seleccionados recibirán un correo cuando la iniciativa pase a estado &quot;En curso&quot;. Pueden vincular sus PDI individuales a esta iniciativa.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-primary" onClick={handleSaveInitiative} disabled={savingInit}>
                    {savingInit ? t('common.saving') : editingInitId ? t('common.update') : t('orgDesarrollo.createInitiative')}
                  </button>
                  <button className="btn-ghost" onClick={() => { setShowInitForm(false); setEditingInitId(null); setParticipantSearch(''); setError(''); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Cargando iniciativas */}
            {initLoading && <Spinner />}

            {/* Sin iniciativas */}
            {!initLoading && initiatives.length === 0 && selectedPlanId && (
              <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>{t('orgDesarrollo.noInitiatives')}</p>
                <p style={{ fontSize: '0.85rem' }}>
                  {isAdmin ? t('orgDesarrollo.noInitiativesAdmin') : t('orgDesarrollo.noInitiativesManager')}
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
                          {t(STATUS_LABEL_KEYS[ini.status] ?? ini.status, { defaultValue: ini.status })}
                        </span>
                        <span className="badge badge-accent" style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' }}>
                          {ini.department ?? t('orgDesarrollo.allCompany')}
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
                            {t('common.edit')}
                          </button>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: 'var(--danger)' }}
                            onClick={(e) => { e.stopPropagation(); handleDeleteInitiative(ini.id, ini.title); }}
                          >
                            {t('common.delete')}
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
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', flexShrink: 0 }}>{t('desarrollo.progress')}:</span>
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
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{t('orgDesarrollo.actionsSection')}</span>
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
                              {t('desarrollo.actions.add')}
                            </button>
                          )}
                        </div>

                        {/* Form de acción */}
                        {showActionForm === ini.id && isAdmin && (
                          <div style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '0.75rem', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  {t('orgDesarrollo.form.actionTitle')}
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
                                  {t('orgDesarrollo.form.actionType')}
                                </label>
                                <select className="input" style={{ fontSize: '0.82rem' }} value={actionForm.actionType} onChange={(e) => setActionForm({ ...actionForm, actionType: e.target.value })}>
                                  {ACTION_TYPE_KEYS.map((at) => (
                                    <option key={at.value} value={at.value}>{t(at.key)}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                                  {t('orgDesarrollo.form.targetDate')}
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
                                  {t('orgDesarrollo.form.responsible')}
                                </label>
                                <select className="input" style={{ fontSize: '0.82rem' }} value={actionForm.assignedToId} onChange={(e) => setActionForm({ ...actionForm, assignedToId: e.target.value })}>
                                  <option value="">{t('common.unassigned')}</option>
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
                                {savingAction ? '...' : editingActionId ? t('common.update') : t('common.add')}
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                onClick={() => { setShowActionForm(null); setEditingActionId(null); }}
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Lista de acciones */}
                        {actions.length === 0 ? (
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('orgDesarrollo.noActions')}</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {actions.map((a: any) => (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                                <span className={`badge ${STATUS_BADGE[a.status] ?? 'badge-accent'}`} style={{ fontSize: '0.68rem', flexShrink: 0 }}>
                                  {t(STATUS_LABEL_KEYS[a.status] ?? a.status, { defaultValue: a.status })}
                                </span>
                                <span style={{ flex: 1, fontSize: '0.83rem', fontWeight: 500 }}>{a.title}</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                                  {t(ACTION_TYPE_KEYS.find((at) => at.value === a.actionType)?.key ?? a.actionType, { defaultValue: a.actionType })}
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
                                      {t('common.edit')}
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
                            {t('orgDesarrollo.linkedPdis')}: {pdis.length}
                          </span>
                          {pdis.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                              {pdis.map((p: any) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.7rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                                  <span style={{ fontWeight: 500 }}>{p.userName}</span>
                                  <span className={`badge ${STATUS_BADGE[p.status] ?? 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                                    {t(STATUS_LABEL_KEYS[p.status] ?? p.status, { defaultValue: p.status })}
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

export default function DesarrolloOrganizacionalPage() {
  return (
    <PlanGate feature="ORG_DEVELOPMENT">
      <DesarrolloOrganizacionalPageContent />
    </PlanGate>
  );
}
