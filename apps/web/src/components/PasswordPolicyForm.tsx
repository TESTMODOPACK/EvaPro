'use client';

/**
 * Password policy editor for tenant_admin. Lives inside the "Seguridad" tab
 * of /ajustes. Saves back to `tenant.settings.passwordPolicy` via the
 * existing PATCH /tenants/me/settings endpoint.
 *
 * Server-side clamps out-of-range values (see `PasswordPolicyService`) —
 * this form renders sensible ranges + helper text but does not pretend to
 * be the source of truth.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import type { PasswordPolicy } from '@/hooks/usePasswordPolicy';

interface Props {
  /** Current tenant settings (full JSONB). We patch `passwordPolicy` inside. */
  tenantSettings: Record<string, any>;
  /** Called after a successful save so the parent can refetch. */
  onSaved?: () => void;
}

const DEFAULTS: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: false,
  expiryDays: null,
  historyCount: 0,
  lockoutThreshold: 5,
  lockoutDurationMinutes: 15,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function PasswordPolicyForm({ tenantSettings, onSaved }: Props) {
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);
  const [policy, setPolicy] = useState<PasswordPolicy>({
    ...DEFAULTS,
    ...(tenantSettings?.passwordPolicy || {}),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPolicy({ ...DEFAULTS, ...(tenantSettings?.passwordPolicy || {}) });
  }, [tenantSettings]);

  function set<K extends keyof PasswordPolicy>(key: K, value: PasswordPolicy[K]) {
    setPolicy((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      // Merge into existing settings so we don't drop other fields.
      await api.tenants.updateSettings(token, { ...tenantSettings, passwordPolicy: policy });
      toast('Política de contraseñas actualizada', 'success');
      onSaved?.();
    } catch (err: any) {
      toast(err?.message || 'Error al guardar política', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.35rem' }}>
        Política de contraseñas
      </h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        Reglas aplicadas a todos los usuarios del tenant al crear o cambiar su contraseña.
      </p>

      <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>Largo mínimo</label>
          <input
            className="input"
            type="number"
            min={8}
            max={64}
            value={policy.minLength}
            onChange={(e) => set('minLength', Math.max(8, Math.min(64, Number(e.target.value) || 8)))}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Rango 8–64.</span>
        </div>

        <div>
          <label style={labelStyle}>Expiración (días)</label>
          <input
            className="input"
            type="number"
            min={0}
            max={365}
            value={policy.expiryDays ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              set('expiryDays', v <= 0 ? null : Math.min(365, v));
            }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            0 = nunca expira. Máx. 365.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Historial (rechaza últimas N)</label>
          <input
            className="input"
            type="number"
            min={0}
            max={24}
            value={policy.historyCount ?? 0}
            onChange={(e) => set('historyCount', Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            0 = desactivado. Máx. 24 (costoso en memoria y CPU).
          </span>
        </div>

        <div>
          <label style={labelStyle}>Intentos antes de bloquear</label>
          <input
            className="input"
            type="number"
            min={0}
            max={50}
            value={policy.lockoutThreshold ?? 5}
            onChange={(e) => set('lockoutThreshold', Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            0 = sin lockout. Default 5.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Duración del bloqueo (min)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={1440}
            value={policy.lockoutDurationMinutes ?? 15}
            onChange={(e) =>
              set('lockoutDurationMinutes', Math.max(1, Math.min(1440, Number(e.target.value) || 15)))
            }
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Default 15. Máx. 24h.
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: '1.25rem',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem 1rem',
        }}
      >
        {(
          [
            ['requireUppercase', 'Exigir mayúscula (A-Z)'],
            ['requireLowercase', 'Exigir minúscula (a-z)'],
            ['requireNumber', 'Exigir número (0-9)'],
            ['requireSymbol', 'Exigir símbolo (!@#$…)'],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(policy[key])}
              onChange={(e) => set(key, e.target.checked as any)}
            />
            {label}
          </label>
        ))}
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <button
          className="btn-primary"
          type="button"
          disabled={saving}
          onClick={save}
          style={{ fontSize: '0.85rem' }}
        >
          {saving ? 'Guardando…' : 'Guardar política'}
        </button>
      </div>
    </div>
  );
}
