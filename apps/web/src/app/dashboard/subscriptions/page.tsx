'use client';

import { useEffect, useState } from 'react';
import { api, type Tenant } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

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

const emptyForm = {
  tenantId: '',
  planName: 'starter',
  maxEmployees: 50,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  monthlyPrice: '',
  notes: '',
  status: 'active',
};

export default function SubscriptionsPage() {
  const token = useAuthStore((s) => s.token);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [statsData, setStatsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const fetchData = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.subscriptions.list(token),
      api.tenants.list(token),
      api.subscriptions.stats(token).catch(() => null),
    ])
      .then(([subs, ts, st]) => {
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

  const resetForm = () => {
    setForm({ ...emptyForm });
    setShowForm(false);
    setEditingId(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!token || !form.tenantId) {
      setError('Selecciona una organizacion');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.subscriptions.create(token, {
        tenantId: form.tenantId,
        planName: form.planName,
        maxEmployees: Number(form.maxEmployees),
        startDate: form.startDate,
        ...(form.endDate ? { endDate: form.endDate } : {}),
        ...(form.monthlyPrice ? { monthlyPrice: Number(form.monthlyPrice) } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
        status: form.status,
      });
      setSuccess('Suscripcion creada correctamente');
      resetForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!token || !editingId) return;
    setSaving(true);
    setError('');
    try {
      await api.subscriptions.update(token, editingId, {
        planName: form.planName,
        maxEmployees: Number(form.maxEmployees),
        startDate: form.startDate,
        ...(form.endDate ? { endDate: form.endDate } : {}),
        ...(form.monthlyPrice ? { monthlyPrice: Number(form.monthlyPrice) } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
        status: form.status,
      });
      setSuccess('Suscripcion actualizada');
      resetForm();
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string, tenantName: string) => {
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

  const startEdit = (sub: any) => {
    setForm({
      tenantId: sub.tenantId ?? '',
      planName: sub.planName ?? sub.plan ?? 'starter',
      maxEmployees: sub.maxEmployees ?? 50,
      startDate: sub.startDate ? sub.startDate.slice(0, 10) : '',
      endDate: sub.endDate ? sub.endDate.slice(0, 10) : '',
      monthlyPrice: sub.monthlyPrice != null ? String(sub.monthlyPrice) : '',
      notes: sub.notes ?? '',
      status: sub.status ?? 'active',
    });
    setEditingId(sub.id);
    setShowForm(true);
    setError('');
  };

  // Build tenant lookup
  const tenantMap: Record<string, string> = {};
  tenants.forEach((t) => { tenantMap[t.id] = t.name; });

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

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Suscripciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Gestion de planes y suscripciones</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Nueva suscripcion
        </button>
      </div>

      {/* Stats row */}
      <div
        className="animate-fade-up-delay-1"
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

      {/* Inline Form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
            {editingId ? 'Editar suscripcion' : 'Nueva suscripcion'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Organizacion *</label>
              <select
                style={inputStyle}
                value={form.tenantId}
                onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                disabled={!!editingId}
              >
                <option value="">Seleccionar...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Plan</label>
              <select style={inputStyle} value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Max empleados</label>
              <input style={inputStyle} type="number" value={form.maxEmployees} onChange={(e) => setForm({ ...form, maxEmployees: Number(e.target.value) })} />
            </div>
            <div>
              <label style={labelStyle}>Fecha inicio</label>
              <input style={inputStyle} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Fecha vencimiento</label>
              <input style={inputStyle} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Precio mensual ref.</label>
              <input style={inputStyle} type="number" placeholder="0.00" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Activa</option>
                <option value="trial">En trial</option>
                <option value="suspended">Suspendida</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas opcionales..." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn-primary" onClick={editingId ? handleUpdate : handleCreate} disabled={saving}>
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear suscripcion'}
            </button>
            <button className="btn-ghost" onClick={resetForm}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card animate-fade-up-delay-2" style={{ padding: 0, overflow: 'hidden' }}>
        {subscriptions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Sin suscripciones</p>
            <p style={{ fontSize: '0.85rem' }}>Crea la primera suscripcion para comenzar</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Organizacion</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Max empleados</th>
                  <th>Inicio</th>
                  <th>Vencimiento</th>
                  <th>Precio ref.</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub: any) => (
                  <tr key={sub.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {sub.tenant?.name ?? tenantMap[sub.tenantId] ?? sub.tenantId}
                    </td>
                    <td>
                      <span className={`badge ${planBadge[sub.planName ?? sub.plan] ?? 'badge-accent'}`}>
                        {sub.planName ?? sub.plan}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge[sub.status] ?? 'badge-accent'}`}>
                        {statusLabel[sub.status] ?? sub.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {sub.maxEmployees ?? '-'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {sub.startDate ? new Date(sub.startDate).toLocaleDateString('es-ES') : '-'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {sub.endDate ? new Date(sub.endDate).toLocaleDateString('es-ES') : '-'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {sub.monthlyPrice != null ? `$${sub.monthlyPrice}` : '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => startEdit(sub)}>
                          Editar
                        </button>
                        {sub.status !== 'cancelled' && (
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                            onClick={() => handleCancel(sub.id, sub.tenant?.name ?? tenantMap[sub.tenantId] ?? 'esta org')}
                          >
                            Cancelar
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
    </div>
  );
}
