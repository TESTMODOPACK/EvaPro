'use client';

import React, { useEffect, useState } from 'react';
import { api, type Tenant } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCLP } from '@/lib/format';
import { subscriptionStatusLabel as statusLabel, subscriptionStatusBadge as statusBadge } from '@/lib/statusMaps';

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

const planStatusBadge: Record<string, string> = {
  active: 'badge-success',
  inactive: 'badge-danger',
};

// ─── Empty forms ────────────────────────────────────────────────────────────

const FEATURE_OPTIONS = [
  { key: 'EVAL_90_180', label: 'Evaluaciones 90\u00b0/180\u00b0' },
  { key: 'EVAL_270', label: 'Evaluaciones 270\u00b0' },
  { key: 'EVAL_360', label: 'Evaluaciones 360\u00b0' },
  { key: 'BASIC_REPORTS', label: 'Reportes b\u00e1sicos' },
  { key: 'ADVANCED_REPORTS', label: 'Reportes avanzados' },
  { key: 'OKR', label: 'OKRs / Objetivos' },
  { key: 'FEEDBACK', label: 'Feedback continuo' },
  { key: 'CHECKINS', label: 'Check-ins 1:1' },
  { key: 'TEMPLATES_CUSTOM', label: 'Plantillas personalizadas' },
  { key: 'PDI', label: 'Planes de desarrollo' },
  { key: 'NINE_BOX', label: 'Nine Box' },
  { key: 'CALIBRATION', label: 'Calibraci\u00f3n' },
  { key: 'AI_INSIGHTS', label: 'IA / Insights' },
  { key: 'PUBLIC_API', label: 'API p\u00fablica' },
];

const CURRENCY_OPTIONS = ['UF', 'CLP', 'USD'];

const emptyPlanForm = {
  name: '',
  code: '',
  description: '',
  maxEmployees: 50,
  monthlyPrice: '',
  yearlyPrice: '',
  currency: 'UF',
  features: [] as string[],
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

  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentSubId, setPaymentSubId] = useState<string | null>(null);
  const [paymentSubName, setPaymentSubName] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '', periodStart: '', periodEnd: '',
    paymentMethod: 'transferencia', transactionRef: '', notes: '', status: 'paid',
  });
  const resetPaymentForm = () => {
    setShowPaymentForm(false); setPaymentSubId(null); setPaymentSubName('');
    setPaymentForm({ amount: '', periodStart: '', periodEnd: '', paymentMethod: 'transferencia', transactionRef: '', notes: '', status: 'paid' });
    setError('');
  };

  // Payment history
  const [showPaymentsFor, setShowPaymentsFor] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);

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
      await api.subscriptions.plans.create(token, {
        name: planForm.name,
        code: planForm.code,
        description: planForm.description || undefined,
        maxEmployees: Number(planForm.maxEmployees),
        monthlyPrice: planForm.monthlyPrice ? Number(planForm.monthlyPrice) : undefined,
        yearlyPrice: planForm.yearlyPrice ? Number(planForm.yearlyPrice) : undefined,
        currency: (planForm as any).currency || 'UF',
        features: planForm.features,
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
      await api.subscriptions.plans.update(token, editingPlanId, {
        name: planForm.name,
        code: planForm.code,
        description: planForm.description || undefined,
        maxEmployees: Number(planForm.maxEmployees),
        monthlyPrice: planForm.monthlyPrice ? Number(planForm.monthlyPrice) : undefined,
        yearlyPrice: planForm.yearlyPrice ? Number(planForm.yearlyPrice) : undefined,
        currency: (planForm as any).currency || 'UF',
        features: planForm.features,
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
      currency: plan.currency || 'UF',
      features: Array.isArray(plan.features) ? plan.features : [],
      displayOrder: plan.displayOrder ?? 0,
    } as any);
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

  // ── Payments ───────────────────────────────────────────────────────────

  const startPayment = (sub: any) => {
    const orgName = sub.tenant?.name ?? tenantMap[sub.tenantId] ?? sub.tenantId;
    setPaymentSubId(sub.id);
    setPaymentSubName(orgName);
    // Auto-fill period based on current date
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Pre-fill amount from plan price
    const plan = planMap[sub.planId];
    setPaymentForm({
      amount: plan?.monthlyPrice ? String(Number(plan.monthlyPrice)) : '',
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      paymentMethod: 'transferencia',
      transactionRef: '',
      notes: '',
      status: 'paid',
    });
    setShowPaymentForm(true);
    setError('');
  };

  const handleRegisterPayment = async () => {
    if (!token || !paymentSubId) return;
    if (!paymentForm.amount || !paymentForm.periodStart || !paymentForm.periodEnd) {
      setError('Complete monto, fecha inicio y fecha fin del per\u00edodo');
      return;
    }
    if (new Date(paymentForm.periodEnd) < new Date(paymentForm.periodStart)) {
      setError('La fecha fin del per\u00edodo debe ser posterior a la fecha inicio');
      return;
    }
    setSaving(true); setError('');
    try {
      await api.subscriptions.registerPayment(token, paymentSubId, {
        amount: parseFloat(paymentForm.amount),
        periodStart: paymentForm.periodStart,
        periodEnd: paymentForm.periodEnd,
        paymentMethod: paymentForm.paymentMethod || null,
        transactionRef: paymentForm.transactionRef || null,
        notes: paymentForm.notes || null,
        status: paymentForm.status,
      });
      setSuccess('Pago registrado exitosamente');
      resetPaymentForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message || 'Error al registrar el pago');
    } finally {
      setSaving(false);
    }
  };

  const loadPaymentHistory = async (subId: string) => {
    if (showPaymentsFor === subId) { setShowPaymentsFor(null); return; }
    if (!token) return;
    setPaymentHistory([]);
    setShowPaymentsFor(subId);
    try {
      const payments = await api.subscriptions.getPayments(token, subId);
      setPaymentHistory(payments ?? []);
    } catch { setPaymentHistory([]); }
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
                  <input style={inputStyle} type="number" step="0.1" placeholder="0.00" value={planForm.yearlyPrice} onChange={(e) => setPlanForm({ ...planForm, yearlyPrice: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Moneda</label>
                  <select style={inputStyle} value={(planForm as any).currency || 'UF'} onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value } as any)}>
                    {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Orden</label>
                  <input style={inputStyle} type="number" value={planForm.displayOrder} onChange={(e) => setPlanForm({ ...planForm, displayOrder: Number(e.target.value) })} />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={labelStyle}>Descripci&oacute;n</label>
                  <input style={inputStyle} value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} placeholder="Descripcion del plan..." />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={labelStyle}>Features incluidas</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: '0.35rem' }}>
                    {FEATURE_OPTIONS.map((fo) => {
                      const checked = Array.isArray(planForm.features) && planForm.features.includes(fo.key);
                      return (
                        <label key={fo.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer', padding: '0.3rem 0.5rem', borderRadius: 'var(--radius-sm)', background: checked ? 'var(--accent-light, rgba(99,102,241,0.08))' : 'transparent' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const current = Array.isArray(planForm.features) ? [...planForm.features] : [];
                              if (checked) {
                                setPlanForm({ ...planForm, features: current.filter((f) => f !== fo.key) } as any);
                              } else {
                                setPlanForm({ ...planForm, features: [...current, fo.key] } as any);
                              }
                            }}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          <span style={{ fontWeight: checked ? 600 : 400 }}>{fo.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* Error inline dentro del formulario de planes */}
              {error && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontSize: '0.85rem', marginTop: '1rem' }}>
                  ⚠️ {error}
                </div>
              )}
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
                          {plan.monthlyPrice > 0 ? `${Number(plan.monthlyPrice).toFixed(1)} ${plan.currency || 'UF'}` : 'Gratis'}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {plan.yearlyPrice > 0 ? `${Number(plan.yearlyPrice).toFixed(0)} ${plan.currency || 'UF'}` : '-'}
                        </td>
                        <td style={{ maxWidth: '200px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {Array.isArray(plan.features) ? plan.features.map((f: string) => {
                              const label = FEATURE_OPTIONS.find((fo) => fo.key === f)?.label || f;
                              return <span key={f} className="badge badge-accent" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>{label}</span>;
                            }) : '-'}
                          </div>
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

          {/* Reglas de cambio de plan */}
          <details className="card animate-fade-up" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
            <summary style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>📋</span> Reglas para cambios de plan
            </summary>
            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>✅ Upgrade (subir de plan)</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    <li>Se puede realizar en cualquier momento</li>
                    <li>Las nuevas funcionalidades se activan de inmediato</li>
                    <li>El límite de usuarios se actualiza automáticamente</li>
                  </ul>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>⚠️ Downgrade (bajar de plan)</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    <li>Solo permitido si los usuarios activos no exceden el límite del nuevo plan</li>
                    <li>Si la empresa tiene 80 usuarios y el plan destino permite 50, debe desactivar usuarios primero</li>
                    <li>Las funcionalidades del plan superior se desactivan al cambiar</li>
                  </ul>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>🚫 Cancelación</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    <li>La suscripción pasa a estado "cancelada"</li>
                    <li>No se pueden registrar nuevos pagos hasta reactivar</li>
                    <li>Los datos se conservan pero el acceso queda restringido</li>
                  </ul>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>📝 Auditoría</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    <li>Cada cambio de plan queda registrado con fecha, usuario y detalle</li>
                    <li>Se registra el plan anterior y el nuevo</li>
                    <li>Los cambios de estado también se auditan</li>
                  </ul>
                </div>
              </div>
            </div>
          </details>

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
              {/* Error inline dentro del formulario de suscripción */}
              {error && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontSize: '0.85rem', marginTop: '1rem' }}>
                  ⚠️ {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button className="btn-primary" onClick={editingSubId ? handleUpdateSub : handleCreateSub} disabled={saving}>
                  {saving ? 'Guardando...' : editingSubId ? 'Actualizar' : 'Asignar plan'}
                </button>
                <button className="btn-ghost" onClick={resetSubForm}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Payment form */}
          {showPaymentForm && paymentSubId && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                Registrar pago — {paymentSubName}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Monto (UF) *</label>
                  <input style={inputStyle} type="number" step="0.01" min="0" placeholder="3.50"
                    value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Per\u00edodo inicio *</label>
                  <input style={inputStyle} type="date" value={paymentForm.periodStart}
                    onChange={(e) => setPaymentForm({ ...paymentForm, periodStart: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Per\u00edodo fin *</label>
                  <input style={inputStyle} type="date" value={paymentForm.periodEnd}
                    onChange={(e) => setPaymentForm({ ...paymentForm, periodEnd: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>M\u00e9todo de pago</label>
                  <select style={inputStyle} value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}>
                    <option value="transferencia">Transferencia bancaria</option>
                    <option value="tarjeta">Tarjeta de cr\u00e9dito</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>N\u00b0 comprobante / referencia</label>
                  <input style={inputStyle} placeholder="Ej: TRF-123456"
                    value={paymentForm.transactionRef} onChange={(e) => setPaymentForm({ ...paymentForm, transactionRef: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Estado</label>
                  <select style={inputStyle} value={paymentForm.status}
                    onChange={(e) => setPaymentForm({ ...paymentForm, status: e.target.value })}>
                    <option value="paid">Pagado</option>
                    <option value="pending">Pendiente</option>
                    <option value="overdue">Vencido</option>
                  </select>
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={labelStyle}>Notas</label>
                  <input style={inputStyle} placeholder="Notas opcionales..."
                    value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
                </div>
              </div>
              {error && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontSize: '0.85rem', marginTop: '1rem' }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button className="btn-primary" onClick={handleRegisterPayment} disabled={saving}>
                  {saving ? 'Registrando...' : 'Registrar pago'}
                </button>
                <button className="btn-ghost" onClick={resetPaymentForm}>Cancelar</button>
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
                      return (<React.Fragment key={sub.id}>
                        <tr>
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
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <button className="btn-ghost" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => startEditSub(sub)}>
                                Editar
                              </button>
                              {sub.status !== 'cancelled' && (
                                <button className="btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => startPayment(sub)}>
                                  Pago
                                </button>
                              )}
                              <button className="btn-ghost" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => loadPaymentHistory(sub.id)}>
                                {showPaymentsFor === sub.id ? 'Ocultar' : 'Historial'}
                              </button>
                              {sub.status !== 'cancelled' && (
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }}
                                  onClick={() => handleCancelSub(sub.id, orgName)}
                                >
                                  Cancelar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {showPaymentsFor === sub.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--bg-surface)', padding: '1rem' }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                                Historial de pagos — {orgName}
                              </div>
                              {paymentHistory.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin pagos registrados</p>
                              ) : (
                                <table style={{ width: '100%', fontSize: '0.8rem' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ padding: '0.35rem 0.5rem', textAlign: 'left' }}>Fecha</th>
                                      <th style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>Monto</th>
                                      <th style={{ padding: '0.35rem 0.5rem' }}>Per\u00edodo</th>
                                      <th style={{ padding: '0.35rem 0.5rem' }}>M\u00e9todo</th>
                                      <th style={{ padding: '0.35rem 0.5rem' }}>Referencia</th>
                                      <th style={{ padding: '0.35rem 0.5rem' }}>Estado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {paymentHistory.map((p: any) => (
                                      <tr key={p.id}>
                                        <td style={{ padding: '0.35rem 0.5rem' }}>
                                          {p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-CL') : '-'}
                                        </td>
                                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                                          {Number(p.amount).toFixed(2)} {p.currency || 'UF'}
                                        </td>
                                        <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)' }}>
                                          {p.periodStart ? new Date(p.periodStart).toLocaleDateString('es-CL') : '?'} — {p.periodEnd ? new Date(p.periodEnd).toLocaleDateString('es-CL') : '?'}
                                        </td>
                                        <td style={{ padding: '0.35rem 0.5rem' }}>{p.paymentMethod || '-'}</td>
                                        <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)' }}>{p.transactionRef || '-'}</td>
                                        <td style={{ padding: '0.35rem 0.5rem' }}>
                                          <span className={`badge ${p.status === 'paid' ? 'badge-success' : p.status === 'pending' ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                                            {p.status === 'paid' ? 'Pagado' : p.status === 'pending' ? 'Pendiente' : p.status === 'overdue' ? 'Vencido' : p.status}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>);
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
