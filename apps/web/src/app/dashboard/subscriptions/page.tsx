'use client';

import { useEffect, useState } from 'react';
import { api, type Tenant } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCLP } from '@/lib/format';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Lookup maps ────────────────────────────────────────────────────────────

const planBadge: Record<string, string> = {
  starter: 'badge-accent',
  pro: 'badge-warning',
  enterprise: 'badge-success',
  custom: 'badge-danger',
};

const statusBadge: Record<string, string> = {
  active: 'badge-success',
  trial: 'badge-warning',
  suspended: 'badge-danger',
  cancelled: 'badge-danger',
  expired: 'badge-danger',
};

const statusLabel: Record<string, string> = {
  active: 'Activa',
  trial: 'En trial',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

const planStatusBadge: Record<string, string> = {
  active: 'badge-success',
  inactive: 'badge-danger',
};

// ─── Empty forms ────────────────────────────────────────────────────────────

const emptyPlanForm = {
  name: '',
  code: '',
  description: '',
  maxEmployees: 50,
  monthlyPrice: '',
  yearlyPrice: '',
  features: '',
  displayOrder: 0,
};

const emptySubForm = {
  planId: '',
  tenantId: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  notes: '',
  status: 'active',
};

// ─── Shared styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.75rem',
  fontSize: '0.85rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  transition: 'var(--transition)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.3rem',
  display: 'block',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const token = useAuthStore((s) => s.token);

  const [activeTab, setActiveTab] = useState<'plans' | 'subscriptions'>('plans');

  // Data
  const [plans, setPlans] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [statsData, setStatsData] = useState<any>(null);

  // UI
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  // Plan form
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ ...emptyPlanForm });

  // Subscription form
  const [showSubForm, setShowSubForm] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({ ...emptySubForm });

  // ── Fetch ───────────────────────────────────────────────────────────────

  const fetchData = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.subscriptions.plans.list(token).catch(() => []),
      api.subscriptions.list(token).catch(() => []),
      api.tenants.list(token).catch(() => []),
      api.subscriptions.stats(token).catch(() => null),
    ])
      .then(([pl, subs, ts, st]) => {
        setPlans(pl ?? []);
        setSubscriptions(subs ?? []);
        setTenants(ts ?? []);
        setStatsData(st);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  // ── Plan CRUD ───────────────────────────────────────────────────────────

  const resetPlanForm = () => {
    setPlanForm({ ...emptyPlanForm });
    setShowPlanForm(false);
    setEditingPlanId(null);
    setError('');
  };

  const handleCreatePlan = async () => {
    if (!token || !planForm.name || !planForm.code) {
      setError('Nombre y codigo son obligatorios');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const features = planForm.features
        ? planForm.features.split(',').map((f) => f.trim()).filter(Boolean)
        : [];
      await api.subscriptions.plans.create(token, {
        name: planForm.name,
        code: planForm.code,
        description: planForm.description || undefined,
        maxEmployees: Number(planForm.maxEmployees),
        monthlyPrice: planForm.monthlyPrice ? Number(planForm.monthlyPrice) : undefined,
        yearlyPrice: planForm.yearlyPrice ? Number(planForm.yearlyPrice) : undefined,
        features,
        displayOrder: Number(planForm.displayOrder),
      });
      setSuccess('Plan creado correctamente');
      resetPlanForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePlan = async () => {
    if (!token || !editingPlanId) return;
    setSaving(true);
    setError('');
    try {
      const features = planForm.features
        ? planForm.features.split(',').map((f) => f.trim()).filter(Boolean)
        : [];
      await api.subscriptions.plans.update(token, editingPlanId, {
        name: planForm.name,
        code: planForm.code,
        description: planForm.description || undefined,
        maxEmployees: Number(planForm.maxEmployees),
        monthlyPrice: planForm.monthlyPrice ? Number(planForm.monthlyPrice) : undefined,
        yearlyPrice: planForm.yearlyPrice ? Number(planForm.yearlyPrice) : undefined,
        features,
        displayOrder: Number(planForm.displayOrder),
      });
      setSuccess('Plan actualizado');
      resetPlanForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivatePlan = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Desactivar el plan "${name}"?`)) return;
    try {
      await api.subscriptions.plans.deactivate(token, id);
      setSuccess('Plan desactivado');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEditPlan = (plan: any) => {
    setPlanForm({
      name: plan.name ?? '',
      code: plan.code ?? '',
      description: plan.description ?? '',
      maxEmployees: plan.maxEmployees ?? 50,
      monthlyPrice: plan.monthlyPrice != null ? String(plan.monthlyPrice) : '',
      yearlyPrice: plan.yearlyPrice != null ? String(plan.yearlyPrice) : '',
      features: Array.isArray(plan.features) ? plan.features.join(', ') : (plan.features ?? ''),
      displayOrder: plan.displayOrder ?? 0,
    });
    setEditingPlanId(plan.id);
    setShowPlanForm(true);
    setError('');
  };

  // ── Subscription CRUD ──────────────────────────────────────────────────

  const resetSubForm = () => {
    setSubForm({ ...emptySubForm });
    setShowSubForm(false);
    setEditingSubId(null);
    setError('');
  };

  const handleCreateSub = async () => {
    if (!token || !subForm.planId || !subForm.tenantId) {
      setError('Selecciona un plan y una organizacion');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.subscriptions.create(token, {
        planId: subForm.planId,
        tenantId: subForm.tenantId,
        startDate: subForm.startDate,
        ...(subForm.endDate ? { endDate: subForm.endDate } : {}),
        ...(subForm.notes ? { notes: subForm.notes } : {}),
        status: subForm.status,
      });
      setSuccess('Suscripcion creada correctamente');
      resetSubForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSub = async () => {
    if (!token || !editingSubId) return;
    setSaving(true);
    setError('');
    try {
      await api.subscriptions.update(token, editingSubId, {
        planId: subForm.planId,
        status: subForm.status,
        startDate: subForm.startDate,
        ...(subForm.endDate ? { endDate: subForm.endDate } : {}),
        ...(subForm.notes ? { notes: subForm.notes } : {}),
      });
      setSuccess('Suscripcion actualizada');
      resetSubForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSub = async (id: string, tenantName: string) => {
    if (!token) return;
    if (!confirm(`Cancelar la suscripcion de "${tenantName}"?`)) return;
    try {
      await api.subscriptions.cancel(token, id);
      setSuccess('Suscripcion cancelada');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEditSub = (sub: any) => {
    setSubForm({
      planId: sub.planId ?? '',
      tenantId: sub.tenantId ?? '',
      startDate: sub.startDate ? sub.startDate.slice(0, 10) : '',
      endDate: sub.endDate ? sub.endDate.slice(0, 10) : '',
      notes: sub.notes ?? '',
      status: sub.status ?? 'active',
    });
    setEditingSubId(sub.id);
    setShowSubForm(true);
    setError('');
  };

  // ── Lookups ─────────────────────────────────────────────────────────────

  const tenantMap: Record<string, string> = {};
  tenants.forEach((t) => { tenantMap[t.id] = t.name; });

  const planMap: Record<string, any> = {};
  plans.forEach((p) => { planMap[p.id] = p; });

  // Stats
  const totalSubs = statsData?.total ?? subscriptions.length;
  const activeSubs = statsData?.active ?? subscriptions.filter((s: any) => s.status === 'active').length;
  const trialSubs = statsData?.trial ?? subscriptions.filter((s: any) => s.status === 'trial').length;
  const suspendedSubs = statsData?.suspended ?? subscriptions.filter((s: any) => s.status === 'suspended').length;

  const statCards = [
    { label: 'Total', value: totalSubs, color: '#6366f1' },
    { label: 'Activas', value: activeSubs, color: '#10b981' },
    { label: 'En trial', value: trialSubs, color: '#f59e0b' },
    { label: 'Suspendidas', value: suspendedSubs, color: '#ef4444' },
  ];

  // ── Tab bar style ───────────────────────────────────────────────────────

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '0.6rem 1.5rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
    transition: 'var(--transition)',
  });

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Suscripciones</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Gestion de planes y suscripciones</p>
      </div>

      {/* Tab bar */}
      <div
        className="animate-fade-up"
        style={{
          display: 'flex',
          gap: '0',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1.5rem',
        }}
      >
        <button style={tabStyle(activeTab === 'plans')} onClick={() => setActiveTab('plans')}>
          Planes
        </button>
        <button style={tabStyle(activeTab === 'subscriptions')} onClick={() => setActiveTab('subscriptions')}>
          Suscripciones
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--success)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {success}
        </div>
      )}

      {/* ═══════════════════════  TAB 1: PLANES  ═══════════════════════════ */}
      {activeTab === 'plans' && (
        <>
          {/* Action bar */}
          <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn-primary" onClick={() => { resetPlanForm(); setShowPlanForm(true); }}>
              + Nuevo plan
            </button>
          </div>

          {/* Plan form */}
          {showPlanForm && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                {editingPlanId ? 'Editar plan' : 'Nuevo plan'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Nombre *</label>
                  <input style={inputStyle} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="Ej: Starter" />
                </div>
                <div>
                  <label style={labelStyle}>Codigo *</label>
                  <input style={inputStyle} value={planForm.code} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })} placeholder="Ej: starter" />
                </div>
                <div>
                  <label style={labelStyle}>Max empleados</label>
                  <input style={inputStyle} type="number" value={planForm.maxEmployees} onChange={(e) => setPlanForm({ ...planForm, maxEmployees: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={labelStyle}>Precio mensual</label>
                  <input style={inputStyle} type="number" placeholder="0.00" value={planForm.monthlyPrice} onChange={(e) => setPlanForm({ ...planForm, monthlyPrice: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Precio anual</label>
                  <input style={inputStyle} type="number" placeholder="0.00" value={planForm.yearlyPrice} onChange={(e) => setPlanForm({ ...planForm, yearlyPrice: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Orden</label>
                  <input style={inputStyle} type="number" value={planForm.displayOrder} onChange={(e) => setPlanForm({ ...planForm, displayOrder: Number(e.target.value) })} />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={labelStyle}>Descripcion</label>
                  <input style={inputStyle} value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} placeholder="Descripcion del plan..." />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={labelStyle}>Features (separadas por coma)</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                    value={planForm.features}
                    onChange={(e) => setPlanForm({ ...planForm, features: e.target.value })}
                    placeholder="Ej: Evaluaciones 360, Reportes, Check-ins"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button className="btn-primary" onClick={editingPlanId ? handleUpdatePlan : handleCreatePlan} disabled={saving}>
                  {saving ? 'Guardando...' : editingPlanId ? 'Actualizar' : 'Crear plan'}
                </button>
                <button className="btn-ghost" onClick={resetPlanForm}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Plans table */}
          <div className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden' }}>
            {plans.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Sin planes</p>
                <p style={{ fontSize: '0.85rem' }}>Crea el primer plan para comenzar</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Codigo</th>
                      <th>Descripcion</th>
                      <th>Max empleados</th>
                      <th>Precio mensual</th>
                      <th>Precio anual</th>
                      <th>Features</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan: any) => (
                      <tr key={plan.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{plan.name}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{plan.code}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {plan.description ?? '-'}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{plan.maxEmployees ?? '-'}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {plan.monthlyPrice != null ? formatCLP(plan.monthlyPrice) : '-'}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {plan.yearlyPrice != null ? formatCLP(plan.yearlyPrice) : '-'}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {Array.isArray(plan.features) ? plan.features.join(', ') : (plan.features ?? '-')}
                        </td>
                        <td>
                          <span className={`badge ${planStatusBadge[plan.isActive === false ? 'inactive' : 'active']}`}>
                            {plan.isActive === false ? 'Inactivo' : 'Activo'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => startEditPlan(plan)}>
                              Editar
                            </button>
                            {plan.isActive !== false && (
                              <button
                                className="btn-ghost"
                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                                onClick={() => handleDeactivatePlan(plan.id, plan.name)}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════  TAB 2: SUSCRIPCIONES  ════════════════════════ */}
      {activeTab === 'subscriptions' && (
        <>
          {/* Stats row */}
          <div
            className="animate-fade-up"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            {statCards.map((s, i) => (
              <div key={i} className="card" style={{ padding: '1.2rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', top: '-15px', right: '-15px',
                  width: '60px', height: '60px', borderRadius: '50%',
                  background: `${s.color}18`,
                }} />
                <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1, marginBottom: '0.25rem', color: s.color }}>
                  {s.value}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Action bar */}
          <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn-primary" onClick={() => { resetSubForm(); setShowSubForm(true); }}>
              + Asignar plan
            </button>
          </div>

          {/* Subscription form */}
          {showSubForm && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                {editingSubId ? 'Editar suscripcion' : 'Asignar plan'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Plan *</label>
                  <select
                    style={inputStyle}
                    value={subForm.planId}
                    onChange={(e) => setSubForm({ ...subForm, planId: e.target.value })}
                  >
                    <option value="">Seleccionar plan...</option>
                    {plans.filter((p) => p.isActive !== false).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Organizacion *</label>
                  <select
                    style={inputStyle}
                    value={subForm.tenantId}
                    onChange={(e) => setSubForm({ ...subForm, tenantId: e.target.value })}
                    disabled={!!editingSubId}
                  >
                    <option value="">Seleccionar...</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Estado</label>
                  <select style={inputStyle} value={subForm.status} onChange={(e) => setSubForm({ ...subForm, status: e.target.value })}>
                    <option value="active">Activa</option>
                    <option value="trial">En trial</option>
                    <option value="suspended">Suspendida</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Fecha inicio</label>
                  <input style={inputStyle} type="date" value={subForm.startDate} onChange={(e) => setSubForm({ ...subForm, startDate: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Fecha vencimiento</label>
                  <input style={inputStyle} type="date" value={subForm.endDate} onChange={(e) => setSubForm({ ...subForm, endDate: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Notas</label>
                  <input style={inputStyle} value={subForm.notes} onChange={(e) => setSubForm({ ...subForm, notes: e.target.value })} placeholder="Notas opcionales..." />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button className="btn-primary" onClick={editingSubId ? handleUpdateSub : handleCreateSub} disabled={saving}>
                  {saving ? 'Guardando...' : editingSubId ? 'Actualizar' : 'Asignar plan'}
                </button>
                <button className="btn-ghost" onClick={resetSubForm}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Subscriptions table */}
          <div className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden' }}>
            {subscriptions.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Sin suscripciones</p>
                <p style={{ fontSize: '0.85rem' }}>Asigna el primer plan a una organizacion para comenzar</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Organizacion</th>
                      <th>Plan</th>
                      <th>Estado</th>
                      <th>Inicio</th>
                      <th>Vencimiento</th>
                      <th>Notas</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub: any) => {
                      const plan = planMap[sub.planId];
                      const planCode = plan?.code ?? sub.planName ?? sub.plan ?? '';
                      const planName = plan?.name ?? sub.planName ?? sub.plan ?? '-';
                      const orgName = sub.tenant?.name ?? tenantMap[sub.tenantId] ?? sub.tenantId;
                      return (
                        <tr key={sub.id}>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {orgName}
                          </td>
                          <td>
                            <span className={`badge ${planBadge[planCode] ?? 'badge-accent'}`}>
                              {planName}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${statusBadge[sub.status] ?? 'badge-accent'}`}>
                              {statusLabel[sub.status] ?? sub.status}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                            {sub.startDate ? new Date(sub.startDate).toLocaleDateString('es-ES') : '-'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                            {sub.endDate ? new Date(sub.endDate).toLocaleDateString('es-ES') : '-'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sub.notes ?? '-'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => startEditSub(sub)}>
                                Editar
                              </button>
                              {sub.status !== 'cancelled' && (
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                                  onClick={() => handleCancelSub(sub.id, orgName)}
                                >
                                  Cancelar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
