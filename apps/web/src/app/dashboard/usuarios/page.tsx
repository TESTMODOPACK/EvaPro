'use client';

import { useState } from 'react';
import { useUsers, useCreateUser, useUpdateUser, useRemoveUser } from '@/hooks/useUsers';

const roleLabel: Record<string, string> = { super_admin: 'Super Admin', tenant_admin: 'Administrador', manager: 'Manager', employee: 'Empleado', external: 'Externo' };
const roleBadge: Record<string, string> = { super_admin: 'badge-danger', tenant_admin: 'badge-danger', manager: 'badge-warning', employee: 'badge-accent', external: 'badge-accent' };

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
};

export default function UsuariosPage() {
  const { data: paginated, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const removeUser = useRemoveUser();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  const users = paginated?.data || [];

  const totalUsers = users.length;
  const activeUsers = users.filter((u: any) => u.isActive).length;
  const inactiveUsers = totalUsers - activeUsers;
  const managers = users.filter((u: any) => u.role === 'manager').length;

  const handleCreate = async () => {
    if (!form.email || !form.firstName || !form.lastName || (!editingId && !form.password)) return;
    setCreating(true);
    try {
      if (editingId) {
        const data: any = {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          department: form.department || undefined,
          position: form.position || undefined,
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
        });
      }
      setForm(emptyForm);
      setShowCreateForm(false);
      setEditingId(null);
    } catch (err: any) {
      alert(err.message || 'Error al guardar usuario');
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
    });
    setShowCreateForm(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Eliminar a ${name}?`)) return;
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

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Usuarios</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona empleados y sus roles en la organizacion
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Agregar usuario
        </button>
      </div>

      {/* Create form (inline) */}
      {showCreateForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>{editingId ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <input
              style={{ ...inputStyle, ...(editingId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
              placeholder="Email *"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              readOnly={!!editingId}
            />
            <input
              style={inputStyle}
              placeholder={editingId ? 'Nueva password (dejar vacío para no cambiar)' : 'Password *'}
              type="password"
              value={form.password}
              onChange={(e) => updateField('password', e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Nombre *"
              value={form.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Apellido *"
              value={form.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
            />
            <select
              style={inputStyle}
              value={form.role}
              onChange={(e) => updateField('role', e.target.value)}
            >
              <option value="employee">Empleado</option>
              <option value="manager">Manager</option>
              <option value="tenant_admin">Administrador</option>
            </select>
            <input
              style={inputStyle}
              placeholder="Departamento"
              value={form.department}
              onChange={(e) => updateField('department', e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Cargo / Posicion"
              value={form.position}
              onChange={(e) => updateField('position', e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear usuario'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => { setShowCreateForm(false); setForm(emptyForm); setEditingId(null); }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total usuarios', value: String(totalUsers), color: 'var(--accent-hover)' },
          { label: 'Activos', value: String(activeUsers), color: 'var(--success)' },
          { label: 'Inactivos', value: String(inactiveUsers), color: 'var(--text-muted)' },
          { label: 'Managers', value: String(managers), color: 'var(--warning)' },
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
                  <th>Departamento</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <Avatar name={fullName} />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{fullName}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{u.department || '–'}</td>
                      <td>
                        <span className={`badge ${roleBadge[u.role] || 'badge-accent'}`}>
                          {roleLabel[u.role] || u.role}
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
                            onClick={() => handleEdit(u)}
                          >
                            Editar
                          </button>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                            onClick={() => handleDelete(u.id, fullName)}
                          >
                            Eliminar
                          </button>
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
