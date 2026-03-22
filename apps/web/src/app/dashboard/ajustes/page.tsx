'use client';

import { useState, useEffect } from 'react';
import { useCurrentUser, useUpdateUser } from '@/hooks/useUsers';

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
  const updateUser = useUpdateUser();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Populate form once user loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setPosition(user.position || '');
    }
  }, [user]);

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
                value={user?.role || ''}
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
    </div>
  );
}
