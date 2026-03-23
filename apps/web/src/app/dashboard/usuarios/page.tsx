'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUsers, useCreateUser, useUpdateUser, useRemoveUser } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { getRoleLabel, getRoleBadge, ASSIGNABLE_ROLES } from '@/lib/roles';
import { api } from '@/lib/api';

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#38bdf8', '#a78bfa'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div style={{
      width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
      background: `${color}30`, color, border: `1.5px solid ${color}60`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700,
    }}>
      {initials}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const emptyForm = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  role: 'employee',
  department: '',
  position: '',
  managerId: '',
};

export default function UsuariosPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const currentUserRole = useAuthStore((s) => s.user?.role || '');
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'tenant_admin';
  const { data: paginated, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const removeUser = useRemoveUser();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [maxEmployees, setMaxEmployees] = useState<number>(0);
  const [planName, setPlanName] = useState<string>('');

  // Fetch subscription limits
  useEffect(() => {
    if (!token || currentUserRole === 'super_admin') return;
    api.subscriptions.mySubscription(token)
      .then((sub: any) => {
        if (sub?.plan) {
          setMaxEmployees(sub.plan.maxEmployees || 0);
          setPlanName(sub.plan.name || '');
        }
      })
      .catch(() => {});
  }, [token, currentUserRole]);

  const users = paginated?.data || [];

  // Extract unique departments and positions for dropdown suggestions
  const departments = Array.from(new Set(users.map((u: any) => u.department).filter(Boolean))).sort() as string[];
  const positions = Array.from(new Set(users.map((u: any) => u.position).filter(Boolean))).sort() as string[];

  const totalUsers = users.length;
  const activeUsers = users.filter((u: any) => u.isActive).length;
  const inactiveUsers = totalUsers - activeUsers;
  const managersCount = users.filter((u: any) => u.role === 'manager' || u.role === 'tenant_admin').length;

  // Helper to get manager name from id
  const getManagerName = (managerId: string | null) => {
    if (!managerId) return null;
    const mgr = users.find((u: any) => u.id === managerId);
    if (!mgr) return null;
    return `${mgr.firstName || ''} ${mgr.lastName || ''}`.trim() || mgr.email;
  };

  // Users who can be managers
  const managerOptions = users.filter((u: any) =>
    u.isActive && (u.role === 'manager' || u.role === 'tenant_admin'),
  );

  const handleCreate = async () => {
    if (!form.email || !form.firstName || !form.lastName || (!editingId && !form.password)) return;
    setErrorMsg('');

    // Check limit before creating
    if (!editingId && maxEmployees > 0 && activeUsers >= maxEmployees) {
      setErrorMsg(`Limite de usuarios alcanzado para el plan "${planName}". Maximo: ${maxEmployees}. Contacte al administrador del sistema para ampliar su plan.`);
      return;
    }

    setCreating(true);
    try {
      if (editingId) {
        const data: any = {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          department: form.department || undefined,
          position: form.position || undefined,
          managerId: form.managerId || null,
        };
        if (form.password) data.password = form.password;
        await updateUser.mutateAsync({ id: editingId, data });
      } else {
        await createUser.mutateAsync({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          password: form.password,
          role: form.role,
          department: form.department || null,
          position: form.position || null,
          managerId: form.managerId || undefined,
        });
      }
      setForm(emptyForm);
      setShowCreateForm(false);
      setEditingId(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar usuario');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (u: any) => {
    setEditingId(u.id);
    setForm({
      email: u.email,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      password: '',
      role: u.role || 'employee',
      department: u.department || '',
      position: u.position || '',
      managerId: u.managerId || '',
    });
    setShowCreateForm(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar a ${name}?`)) return;
    try {
      await removeUser.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Error al eliminar usuario');
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const inputStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    outline: 'none',
    width: '100%',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Usuarios</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona empleados, roles y jerarquías de la organización
          </p>
        </div>
        {isAdmin && (
          <button
            className="btn-primary"
            onClick={() => { setShowCreateForm(!showCreateForm); if (showCreateForm) { setEditingId(null); setForm(emptyForm); } }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Agregar usuario
          </button>
        )}
      </div>

      {/* Create/Edit form */}
      {showCreateForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>
            {editingId ? 'Editar usuario' : 'Nuevo usuario'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                style={{ ...inputStyle, ...(editingId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                placeholder="usuario@empresa.com"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                readOnly={!!editingId}
              />
            </div>
            <div>
              <label style={labelStyle}>{editingId ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label>
              <input
                style={inputStyle}
                placeholder={editingId ? 'Dejar vacío para no cambiar' : 'Mínimo 6 caracteres'}
                type="password"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input
                style={inputStyle}
                placeholder="Nombre"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Apellido *</label>
              <input
                style={inputStyle}
                placeholder="Apellido"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Rol</label>
              <select
                style={inputStyle}
                value={form.role}
                onChange={(e) => updateField('role', e.target.value)}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Jefatura directa</label>
              <select
                style={inputStyle}
                value={form.managerId}
                onChange={(e) => updateField('managerId', e.target.value)}
              >
                <option value="">Sin jefatura asignada</option>
                {managerOptions
                  .filter((m: any) => m.id !== editingId)
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({getRoleLabel(m.role)})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Departamento</label>
              <input
                style={inputStyle}
                list="dept-options"
                placeholder="Seleccionar o escribir nuevo"
                value={form.department}
                onChange={(e) => updateField('department', e.target.value)}
              />
              <datalist id="dept-options">
                {departments.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <input
                style={inputStyle}
                list="pos-options"
                placeholder="Seleccionar o escribir nuevo"
                value={form.position}
                onChange={(e) => updateField('position', e.target.value)}
              />
              <datalist id="pos-options">
                {positions.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear usuario'}
            </button>
            <button className="btn-ghost" onClick={() => { setShowCreateForm(false); setForm(emptyForm); setEditingId(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Subscription usage warning */}
      {maxEmployees > 0 && (
        <div className="animate-fade-up-delay-1" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Usuarios: {activeUsers} / {maxEmployees} ({planName})
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: activeUsers >= maxEmployees ? 'var(--danger)' : activeUsers / maxEmployees > 0.8 ? 'var(--warning)' : 'var(--success)' }}>
              {Math.round((activeUsers / maxEmployees) * 100)}%
            </span>
          </div>
          <div style={{ height: '6px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((activeUsers / maxEmployees) * 100, 100)}%`,
              background: activeUsers >= maxEmployees ? 'var(--danger)' : activeUsers / maxEmployees > 0.8 ? 'var(--warning)' : 'var(--success)',
              borderRadius: '999px', transition: 'width 0.6s ease',
            }} />
          </div>
          {activeUsers >= maxEmployees && (
            <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 500 }}>
              Has alcanzado el limite de usuarios de tu plan. Contacta al administrador del sistema para ampliar tu suscripcion.
            </p>
          )}
          {activeUsers / maxEmployees > 0.8 && activeUsers < maxEmployees && (
            <p style={{ color: 'var(--warning)', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 500 }}>
              Estas cerca del limite de usuarios de tu plan ({maxEmployees - activeUsers} disponibles).
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMsg && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, fontSize: '1rem' }}>x</button>
        </div>
      )}

      {/* Stats row */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total usuarios', value: String(totalUsers), color: 'var(--accent-hover)' },
          { label: 'Activos', value: String(activeUsers), color: 'var(--success)' },
          { label: 'Inactivos', value: String(inactiveUsers), color: 'var(--text-muted)' },
          { label: 'Managers / Admins', value: String(managersCount), color: 'var(--warning)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay usuarios registrados</p>
        </div>
      ) : (
        <div className="card animate-fade-up-delay-2" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Cargo</th>
                  <th>Departamento</th>
                  <th>Jefatura</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                  const managerName = getManagerName(u.managerId);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                          onClick={() => router.push(`/dashboard/usuarios/${u.id}`)}
                        >
                          <Avatar name={fullName} />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>{fullName}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {u.position || '–'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem' }}>
                          {u.department || '–'}
                        </span>
                      </td>
                      <td>
                        {managerName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-hover)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                            </svg>
                            <span style={{ fontSize: '0.82rem', color: 'var(--accent-hover)', fontWeight: 500 }}>
                              {managerName}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Sin jefatura
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${getRoleBadge(u.role)}`}>
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${u.isActive ? 'badge-success' : 'badge-warning'}`}>
                          {u.isActive ? 'activo' : 'inactivo'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                            onClick={() => router.push(`/dashboard/usuarios/${u.id}`)}
                          >
                            Perfil
                          </button>
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                              onClick={() => handleEdit(u)}
                            >
                              Editar
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                              onClick={() => handleDelete(u.id, fullName)}
                            >
                              Eliminar
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
        </div>
      )}
    </div>
  );
}
