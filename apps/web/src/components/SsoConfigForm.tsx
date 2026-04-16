'use client';

/**
 * OIDC Single Sign-On configuration form — rendered inside the "Seguridad"
 * tab of /ajustes. Lets a tenant_admin point the app at their IdP
 * (Google Workspace, Microsoft Entra, Okta, Auth0, Keycloak, …).
 *
 * Security notes:
 *   - The client secret is never returned from the backend — `hasSecret: true`
 *     tells us one is stored. The user must re-type it to rotate.
 *   - The backend probes the issuer's `.well-known/openid-configuration` on
 *     save; a typo fails with a clear 400.
 *   - `allowedEmailDomains` is a hard safety net — the JIT login rejects
 *     users whose email domain isn't listed, preventing IdP → wrong tenant
 *     crossover on shared IdPs (e.g. multiple Eva360 tenants using the same
 *     Google Workspace domain).
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

type Mode = 'idle' | 'loading' | 'saving';

export default function SsoConfigForm() {
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);
  const [mode, setMode] = useState<Mode>('loading');
  const [hasSecret, setHasSecret] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [requireSso, setRequireSso] = useState(false);
  const [domainsText, setDomainsText] = useState('');
  const [mappingText, setMappingText] = useState('{}');

  useEffect(() => {
    if (!token) return;
    setMode('loading');
    api.sso
      .getConfig(token)
      .then((cfg) => {
        setHasSecret(cfg.hasSecret);
        setIssuerUrl(cfg.issuerUrl || '');
        setClientId(cfg.clientId || '');
        setEnabled(cfg.enabled || false);
        setRequireSso(cfg.requireSso || false);
        setDomainsText((cfg.allowedEmailDomains || []).join(', '));
        setMappingText(JSON.stringify(cfg.roleMapping || {}, null, 2));
      })
      .catch(() => {
        // No config yet — leave fields empty.
      })
      .finally(() => setMode('idle'));
  }, [token]);

  async function save() {
    if (!token) return;
    if (!issuerUrl || !clientId) {
      toast('Issuer URL y Client ID son obligatorios', 'error');
      return;
    }
    // If we don't already have a stored secret AND the user didn't type one,
    // refuse — we won't create a config without a secret.
    if (!hasSecret && !clientSecret) {
      toast('Necesitas ingresar el client secret al menos la primera vez', 'error');
      return;
    }
    let roleMapping: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(mappingText || '{}');
      if (parsed && typeof parsed === 'object') roleMapping = parsed;
    } catch {
      toast('El JSON de roleMapping es inválido', 'error');
      return;
    }
    const allowedEmailDomains = domainsText
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    setMode('saving');
    try {
      // Don't send `clientSecret` at all if the user didn't type one — the
      // backend keeps the stored ciphertext intact. Sending any placeholder
      // would silently overwrite the secret with garbage.
      const payload: Parameters<typeof api.sso.upsertConfig>[1] = {
        issuerUrl: issuerUrl.trim(),
        clientId: clientId.trim(),
        enabled,
        requireSso,
        allowedEmailDomains,
        roleMapping,
      };
      if (clientSecret) payload.clientSecret = clientSecret;
      await api.sso.upsertConfig(token, payload);
      toast('SSO guardado', 'success');
      setClientSecret('');
      setHasSecret(true);
    } catch (err: any) {
      toast(err?.message || 'Error al guardar SSO', 'error');
    } finally {
      setMode('idle');
    }
  }

  async function disable() {
    if (!token) return;
    if (!confirm('¿Desactivar SSO? Los usuarios existentes seguirán pudiendo loguear con contraseña.')) {
      return;
    }
    try {
      await api.sso.disable(token);
      toast('SSO desactivado', 'success');
      setEnabled(false);
      setRequireSso(false);
    } catch (err: any) {
      toast(err?.message || 'Error al desactivar', 'error');
    }
  }

  if (mode === 'loading') {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando configuración…</p>;
  }

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.35rem' }}>
        Single Sign-On (OIDC)
      </h2>
      <p
        style={{
          fontSize: '0.82rem',
          color: 'var(--text-muted)',
          marginBottom: '1.25rem',
          lineHeight: 1.55,
        }}
      >
        Configura el Identity Provider OIDC de tu organización (Google Workspace,
        Microsoft Entra ID, Okta, Auth0, Keycloak, …). Los usuarios que inicien
        sesión con SSO no necesitan contraseña local.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>Issuer URL</label>
          <input
            className="input"
            type="url"
            placeholder="https://accounts.google.com"
            value={issuerUrl}
            onChange={(e) => setIssuerUrl(e.target.value)}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            El endpoint `.well-known/openid-configuration` se consulta al guardar.
          </span>
        </div>

        <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Client ID</label>
            <input
              className="input"
              type="text"
              placeholder="eva360-app"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Client Secret</label>
            <input
              className="input"
              type="password"
              placeholder={hasSecret ? '••••••••  (guardado)' : 'Pega el secret del IdP'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {hasSecret
                ? 'Déjalo en blanco para conservar el actual; rellénalo para rotar.'
                : 'Requerido la primera vez.'}
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Dominios de email permitidos</label>
          <input
            className="input"
            type="text"
            placeholder="acme.com, acme.cl"
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Separados por coma. Deja vacío para aceptar cualquier dominio (menos seguro).
          </span>
        </div>

        <div>
          <label style={labelStyle}>Mapeo de roles (JSON)</label>
          <textarea
            className="input"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
            value={mappingText}
            onChange={(e) => setMappingText(e.target.value)}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Ejemplo: <code>{'{ "tenant_admin": ["groups:eva-admins"] }'}</code>. Sin match → employee.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Activar SSO
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requireSso}
              onChange={(e) => setRequireSso(e.target.checked)}
              disabled={!enabled}
            />
            Forzar SSO (bloquea login con contraseña)
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={mode === 'saving'}
            onClick={save}
            style={{ fontSize: '0.85rem' }}
          >
            {mode === 'saving' ? 'Guardando…' : 'Guardar SSO'}
          </button>
          {hasSecret && (
            <button
              type="button"
              className="btn-ghost"
              disabled={mode === 'saving'}
              onClick={disable}
              style={{ fontSize: '0.85rem', color: 'var(--danger)' }}
            >
              Desactivar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
