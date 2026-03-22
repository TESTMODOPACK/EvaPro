'use client';

import { useState, useEffect } from 'react';
import { useCurrentUser, useUpdateUser } from '@/hooks/useUsers';
import { getRoleLabel } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function AjustesPage() {
  const { data: user, isLoading } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const updateUser = useUpdateUser();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [mySub, setMySub] = useState<any>(null);
  const [userCount, setUserCount] = useState<number>(0);

  // Populate form once user loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setPosition(user.position || '');
    }
  }, [user]);

  // Fetch subscription for tenant_admin
  useEffect(() => {
    if (!token || authUser?.role === 'super_admin') return;
    api.subscriptions.mySubscription(token).then((sub) => setMySub(sub)).catch(() => {});
    api.users.list(token, 1, 1).then((res) => setUserCount(res.total || 0)).catch(() => {});
  }, [token, authUser?.role]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: { firstName, lastName, position },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error is available via updateUser.error
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !newPassword) return;
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: { currentPassword, newPassword },
      });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch {
      // error is available via updateUser.error
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Cargando perfil...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            marginBottom: '0.25rem',
          }}
        >
          Ajustes
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Configura tu perfil y preferencias de la plataforma
        </p>
      </div>

      {/* Profile Section */}
      <div
        className="card animate-fade-up"
        style={{ padding: '1.75rem', marginBottom: '1.5rem' }}
      >
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            marginBottom: '0.25rem',
          }}
        >
          Perfil de usuario
        </h2>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.82rem',
            marginBottom: '1.5rem',
          }}
        >
          Informaci&oacute;n de tu cuenta en EvaPro
        </p>

        <form
          onSubmit={handleSaveProfile}
          style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
            }}
          >
            <div>
              <label style={labelStyle}>Correo electr&oacute;nico</label>
              <input
                className="input"
                type="email"
                value={user?.email || ''}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Rol</label>
              <input
                className="input"
                type="text"
                value={user?.role ? getRoleLabel(user.role) : ''}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
            }}
          >
            <div>
              <label style={labelStyle}>Nombre</label>
              <input
                className="input"
                type="text"
                placeholder="Tu nombre"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Apellido</label>
              <input
                className="input"
                type="text"
                placeholder="Tu apellido"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Cargo</label>
            <input
              className="input"
              type="text"
              placeholder="Ej. Director de RRHH"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              paddingTop: '0.5rem',
            }}
          >
            <button
              type="submit"
              className="btn-primary"
              disabled={updateUser.isPending}
              style={{ opacity: updateUser.isPending ? 0.6 : 1 }}
            >
              {updateUser.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {saved && (
              <span
                style={{
                  color: 'var(--success)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                &#10003; Cambios guardados
              </span>
            )}
            {updateUser.isError && !saved && (
              <span
                style={{
                  color: 'var(--danger)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Error al guardar
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Password Section */}
      <div
        className="card animate-fade-up-delay-1"
        style={{ padding: '1.75rem' }}
      >
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            marginBottom: '0.25rem',
          }}
        >
          Seguridad
        </h2>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.82rem',
            marginBottom: '1.5rem',
          }}
        >
          Gestiona la seguridad de tu cuenta
        </p>

        <form
          onSubmit={handleChangePassword}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div>
            <label style={labelStyle}>Contrase&ntilde;a actual</label>
            <input
              className="input"
              type="password"
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Nueva contrase&ntilde;a</label>
            <input
              className="input"
              type="password"
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              paddingTop: '0.5rem',
            }}
          >
            <button
              type="submit"
              className="btn-primary"
              disabled={!currentPassword || !newPassword}
              style={{
                opacity: !currentPassword || !newPassword ? 0.5 : 1,
              }}
            >
              Cambiar contrase&ntilde;a
            </button>
            {passwordSaved && (
              <span
                style={{
                  color: 'var(--success)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                &#10003; Contrase&ntilde;a actualizada
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Subscription Section — visible only for tenant users */}
      {authUser?.role !== 'super_admin' && (
        <div
          className="card animate-fade-up-delay-2"
          style={{ padding: '1.75rem', marginTop: '1.5rem' }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Mi Suscripci&oacute;n
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem' }}>
            Plan y l&iacute;mites de tu organizaci&oacute;n
          </p>

          {mySub && mySub.plan ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Plan</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent)' }}>{mySub.plan.name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Estado</div>
                  <span className={`badge ${mySub.status === 'active' ? 'badge-success' : mySub.status === 'trial' ? 'badge-warning' : 'badge-danger'}`}>
                    {mySub.status === 'active' ? 'Activa' : mySub.status === 'trial' ? 'En trial' : mySub.status === 'suspended' ? 'Suspendida' : mySub.status}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Vencimiento</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {mySub.endDate ? new Date(mySub.endDate).toLocaleDateString('es-ES') : 'Sin vencimiento'}
                  </div>
                </div>
              </div>

              {/* Usage bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Usuarios: {userCount} / {mySub.plan.maxEmployees}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {mySub.plan.maxEmployees > 0 ? Math.round((userCount / mySub.plan.maxEmployees) * 100) : 0}%
                  </span>
                </div>
                <div style={{ height: '8px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: mySub.plan.maxEmployees > 0 ? `${Math.min((userCount / mySub.plan.maxEmployees) * 100, 100)}%` : '0%',
                    background: (userCount / mySub.plan.maxEmployees) > 0.9 ? 'var(--danger)' : (userCount / mySub.plan.maxEmployees) > 0.7 ? 'var(--warning)' : 'var(--success)',
                    borderRadius: '999px',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>

              {mySub.plan.features && mySub.plan.features.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem' }}>Caracter&iacute;sticas incluidas</div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {mySub.plan.features.map((f: string, i: number) => (
                      <span key={i} className="badge badge-accent" style={{ fontSize: '0.75rem' }}>{f}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Sin plan asignado</p>
              <p style={{ fontSize: '0.85rem' }}>Contacte al administrador del sistema para asignar un plan a su organizaci&oacute;n</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
