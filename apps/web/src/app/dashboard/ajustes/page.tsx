'use client';

import { useState, useEffect } from 'react';
import { useCurrentUser, useUpdateUser } from '@/hooks/useUsers';
import { getRoleLabel } from '@/lib/roles';
import { useMySubscription } from '@/hooks/useSubscription';
import { formatRut } from '@/lib/rut';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { CUSTOM_SETTINGS_DEFAULTS, CUSTOM_SETTINGS_META, CUSTOM_SETTINGS_KEYS } from '@/lib/constants';

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
  const { data: sub } = useMySubscription();
  const token = useAuthStore((s) => s.token);
  const isTenantAdmin = user?.role === 'tenant_admin';
  const orgName = sub?.tenant?.name || '';
  const orgRut = sub?.tenant?.rut ? formatRut(sub.tenant.rut) : '';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Custom settings state
  const [customSettings, setCustomSettings] = useState<Record<string, string[]>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingSaved, setSettingSaved] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);

  // Load custom settings
  useEffect(() => {
    if (token && isTenantAdmin) {
      api.tenants.getAllCustomSettings(token).then((data) => {
        setCustomSettings(data);
      }).catch(() => {
        // fallback to defaults
        setCustomSettings({ ...CUSTOM_SETTINGS_DEFAULTS });
      });
    }
  }, [token, isTenantAdmin]);

  const handleSaveSetting = async (key: string) => {
    if (!token) return;
    const items = customSettings[key];
    if (!items || items.length === 0) {
      setSettingError(key);
      setTimeout(() => setSettingError(null), 3000);
      return;
    }
    setSavingKey(key);
    setSettingError(null);
    try {
      await api.tenants.updateCustomSetting(token, key, items);
      setSettingSaved(key);
      setTimeout(() => setSettingSaved(null), 3000);
    } catch {
      setSettingError(key);
      setTimeout(() => setSettingError(null), 3000);
    }
    setSavingKey(null);
  };

  const handleAddItem = (key: string) => {
    const text = newItemText.trim();
    if (!text || customSettings[key]?.includes(text)) return;
    setCustomSettings((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), text],
    }));
    setNewItemText('');
  };

  const handleRemoveItem = (key: string, index: number) => {
    setCustomSettings((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  };

  const handleRestoreDefaults = (key: string) => {
    setCustomSettings((prev) => ({
      ...prev,
      [key]: [...CUSTOM_SETTINGS_DEFAULTS[key]],
    }));
  };

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

      {/* Company Info Section (tenant_admin only) */}
      {isTenantAdmin && (
        <div
          className="card animate-fade-up"
          style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '3px solid var(--accent)' }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Información de la empresa
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
            Datos registrados de tu organización (solo lectura)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Razón Social</label>
              <input
                className="input"
                type="text"
                value={orgName}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
            <div>
              <label style={labelStyle}>RUT Empresa</label>
              <input
                className="input"
                type="text"
                value={orgRut || 'No registrado'}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Para modificar estos datos, contacta al administrador del sistema.
          </p>
        </div>
      )}

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

      {/* Datos Personalizados (tenant_admin only) */}
      {isTenantAdmin && (
        <div
          className="card animate-fade-up-delay-1"
          style={{ padding: '1.75rem', marginTop: '1.5rem', borderLeft: '3px solid var(--accent)' }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Datos Personalizados
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
            Configura las listas y opciones que tu organización utiliza en el sistema
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {CUSTOM_SETTINGS_KEYS.map((key) => {
              const meta = CUSTOM_SETTINGS_META[key];
              const items = customSettings[key] || CUSTOM_SETTINGS_DEFAULTS[key];
              const isExpanded = expandedKey === key;
              const isSaving = savingKey === key;
              const justSaved = settingSaved === key;
              const hasError = settingError === key;

              return (
                <div
                  key={key}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  {/* Header - clickable */}
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedKey(isExpanded ? null : key);
                      setNewItemText('');
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.85rem 1rem',
                      background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{meta.label}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>
                        {items.length} {items.length === 1 ? 'elemento' : 'elementos'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      &#9660;
                    </span>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                        {meta.description}
                      </p>

                      {/* Items list */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                        {items.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.5rem 0.75rem',
                              background: 'var(--bg-secondary)',
                              borderRadius: '6px',
                              fontSize: '0.85rem',
                            }}
                          >
                            <span>{item}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(key, idx)}
                              title="Eliminar"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                                fontSize: '1rem',
                                padding: '0 0.25rem',
                                lineHeight: 1,
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                        {items.length === 0 && (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            Sin elementos. Agrega uno o restaura los predeterminados.
                          </p>
                        )}
                      </div>

                      {/* Add new item */}
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <input
                          className="input"
                          type="text"
                          value={expandedKey === key ? newItemText : ''}
                          onChange={(e) => setNewItemText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(key); } }}
                          placeholder="Nuevo elemento..."
                          style={{ flex: 1, fontSize: '0.85rem' }}
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleAddItem(key)}
                          disabled={!newItemText.trim()}
                          style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem', opacity: !newItemText.trim() ? 0.5 : 1 }}
                        >
                          Agregar
                        </button>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleSaveSetting(key)}
                          disabled={isSaving}
                          style={{ fontSize: '0.82rem', padding: '0.4rem 1rem', opacity: isSaving ? 0.6 : 1 }}
                        >
                          {isSaving ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRestoreDefaults(key)}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.4rem 0.85rem',
                            fontSize: '0.78rem',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          Restaurar predeterminados
                        </button>
                        {justSaved && (
                          <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>
                            &#10003; Guardado
                          </span>
                        )}
                        {hasError && (
                          <span style={{ color: 'var(--danger)', fontSize: '0.82rem', fontWeight: 600 }}>
                            {items.length === 0 ? 'Agrega al menos un elemento' : 'Error al guardar'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
