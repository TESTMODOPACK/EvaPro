'use client';

import { useEffect, useState } from 'react';
import { api, type Tenant } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatRutInput, validateRut, formatRut } from '@/lib/rut';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const planColor: Record<string, string> = {
  starter: 'badge-accent',
  pro: 'badge-warning',
  enterprise: 'badge-success',
  custom: 'badge-danger',
};

const emptyForm = {
  name: '',
  slug: '',
  rut: '',
  plan: 'starter',
  maxEmployees: 50,
  ownerType: 'company',
  adminEmail: '',
  adminPassword: '',
  adminFirstName: '',
  adminLastName: '',
};

export default function TenantsPage() {
  const token = useAuthStore((s) => s.token);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const fetchTenants = () => {
    if (!token) return;
    setLoading(true);
    api.tenants.list(token)
      .then(setTenants)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTenants();
  }, [token]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setShowForm(false);
    setEditingId(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!token || !form.name || !form.slug || !form.rut) {
      setError('Nombre, slug y RUT son obligatorios');
      return;
    }
    if (!validateRut(form.rut)) {
      setError('RUT inválido. Verifique el formato y dígito verificador.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.tenants.create({
        name: form.name,
        slug: form.slug,
        rut: form.rut,
        plan: form.plan,
        maxEmployees: Number(form.maxEmployees),
        ownerType: form.ownerType,
        ...(form.adminEmail ? {
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
          adminFirstName: form.adminFirstName,
          adminLastName: form.adminLastName,
        } : {}),
      }, token);
      setSuccess('Organizacion creada correctamente');
      resetForm();
      fetchTenants();
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
      await api.tenants.update(token, editingId, {
        name: form.name,
        slug: form.slug,
        rut: form.rut,
        plan: form.plan,
        maxEmployees: Number(form.maxEmployees),
        ownerType: form.ownerType,
      });
      setSuccess('Organizacion actualizada');
      resetForm();
      fetchTenants();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Desactivar la organizacion "${name}"?`)) return;
    try {
      await api.tenants.deactivate(token, id);
      setSuccess('Organizacion desactivada');
      fetchTenants();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEdit = (t: Tenant) => {
    setForm({
      name: t.name,
      slug: t.slug,
      rut: t.rut ? formatRut(t.rut) : '',
      plan: t.plan,
      maxEmployees: t.maxEmployees,
      ownerType: t.ownerType,
      adminEmail: '',
      adminPassword: '',
      adminFirstName: '',
      adminLastName: '',
    });
    setEditingId(t.id);
    setShowForm(true);
    setError('');
  };

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

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Organizaciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Gestion de tenants de la plataforma</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Nueva organizacion
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

      {/* Inline Form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
            {editingId ? 'Editar organizacion' : 'Nueva organizacion'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi Empresa" />
            </div>
            <div>
              <label style={labelStyle}>Slug *</label>
              <input style={inputStyle} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="mi-empresa" />
            </div>
            <div>
              <label style={labelStyle}>RUT Empresa *</label>
              <input style={inputStyle} value={form.rut} onChange={(e) => setForm({ ...form, rut: formatRutInput(e.target.value) })} placeholder="76.123.456-7" maxLength={12} />
            </div>
            <div>
              <label style={labelStyle}>Plan</label>
              <select style={inputStyle} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Max empleados</label>
              <input style={inputStyle} type="number" value={form.maxEmployees} onChange={(e) => setForm({ ...form, maxEmployees: Number(e.target.value) })} />
            </div>
            <div>
              <label style={labelStyle}>Tipo propietario</label>
              <select style={inputStyle} value={form.ownerType} onChange={(e) => setForm({ ...form, ownerType: e.target.value })}>
                <option value="company">Empresa</option>
                <option value="consultant">Consultor</option>
              </select>
            </div>
          </div>

          {/* Admin fields (only for create) */}
          {!editingId && (
            <>
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Admin inicial (opcional)
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Email admin</label>
                  <input style={inputStyle} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="admin@empresa.com" />
                </div>
                <div>
                  <label style={labelStyle}>Password admin</label>
                  <input style={inputStyle} type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="********" />
                </div>
                <div>
                  <label style={labelStyle}>Nombre</label>
                  <input style={inputStyle} value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} placeholder="Juan" />
                </div>
                <div>
                  <label style={labelStyle}>Apellido</label>
                  <input style={inputStyle} value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} placeholder="Perez" />
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn-primary" onClick={editingId ? handleUpdate : handleCreate} disabled={saving}>
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear organizacion'}
            </button>
            <button className="btn-ghost" onClick={resetForm}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Spinner />
      ) : (
        <div className="card animate-fade-up-delay-1" style={{ padding: 0, overflow: 'hidden' }}>
          {tenants.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Sin organizaciones</p>
              <p style={{ fontSize: '0.85rem' }}>Crea la primera organizacion para comenzar</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>RUT</th>
                    <th>Slug</th>
                    <th>Plan</th>
                    <th>Max empleados</th>
                    <th>Estado</th>
                    <th>Creado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t.rut ? formatRut(t.rut) : '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.slug}</td>
                      <td>
                        <span className={`badge ${planColor[t.plan] ?? 'badge-accent'}`}>{t.plan}</span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t.maxEmployees}</td>
                      <td>
                        <span className={`badge ${t.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {t.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {new Date(t.createdAt).toLocaleDateString('es-ES')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => startEdit(t)}>
                            Editar
                          </button>
                          {t.isActive && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                              onClick={() => handleDeactivate(t.id, t.name)}
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
      )}
    </div>
  );
}
