'use client';

import { useState, useEffect } from 'react';
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

export default function MantenedoresPage() {
  const token = useAuthStore((s) => s.token);

  const [customSettings, setCustomSettings] = useState<Record<string, string[]>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingSaved, setSettingSaved] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.tenants.getAllCustomSettings(token)
      .then((data) => setCustomSettings(data))
      .catch(() => setCustomSettings({ ...CUSTOM_SETTINGS_DEFAULTS }))
      .finally(() => setLoading(false));
  }, [token]);

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

  if (loading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Cargando configuración...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          Datos Personalizados
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Configura las listas y opciones que tu organización utiliza en el sistema.
          Cada sección incluye valores predeterminados que puedes personalizar según las necesidades de tu empresa.
        </p>
      </div>

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
              className="card animate-fade-up"
              style={{ overflow: 'hidden', padding: 0 }}
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
                  padding: '1rem 1.25rem',
                  background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{meta.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>
                    {items.length} {items.length === 1 ? 'elemento' : 'elementos'}
                  </span>
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}>
                  &#9660;
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                    {meta.description}
                  </p>

                  {/* Items list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.55rem 0.85rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '6px',
                          fontSize: '0.88rem',
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
                            fontSize: '1.1rem',
                            padding: '0 0.3rem',
                            lineHeight: 1,
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
                        Sin elementos. Agrega uno o restaura los predeterminados.
                      </p>
                    )}
                  </div>

                  {/* Add new item */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      className="input"
                      type="text"
                      value={expandedKey === key ? newItemText : ''}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(key); } }}
                      placeholder="Nuevo elemento..."
                      style={{ flex: 1, fontSize: '0.88rem' }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleAddItem(key)}
                      disabled={!newItemText.trim()}
                      style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', opacity: !newItemText.trim() ? 0.5 : 1 }}
                    >
                      Agregar
                    </button>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleSaveSetting(key)}
                      disabled={isSaving}
                      style={{ fontSize: '0.85rem', padding: '0.45rem 1.2rem', opacity: isSaving ? 0.6 : 1 }}
                    >
                      {isSaving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestoreDefaults(key)}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '0.45rem 1rem',
                        fontSize: '0.82rem',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Restaurar predeterminados
                    </button>
                    {justSaved && (
                      <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                        &#10003; Guardado
                      </span>
                    )}
                    {hasError && (
                      <span style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
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
  );
}
