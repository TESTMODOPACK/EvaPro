'use client';

/**
 * One-row button for the super_admin tenants table: opens a modal that
 * captures the support reason, calls `/support/impersonate`, swaps the
 * JWT into the auth store and navigates to `/dashboard`. The red banner
 * (ImpersonationBanner) takes over from there.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore, decodeJwtPayload } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

interface Props {
  tenantId: string;
  tenantName: string;
  disabled?: boolean;
}

export default function ImpersonateTenantButton({ tenantId, tenantName, disabled }: Props) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const toast = useToastStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!token) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      toast('La razón debe tener al menos 5 caracteres', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await api.impersonation.start(token, { tenantId, reason: trimmed });
      const nextUser = decodeJwtPayload(res.access_token);
      if (!nextUser) throw new Error('Token inválido del servidor');
      setAuth(res.access_token, nextUser);
      setOpen(false);
      setReason('');
      router.replace('/dashboard');
    } catch (err: any) {
      toast(err?.message || 'No pudimos iniciar la impersonación', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(true)}
        disabled={disabled}
        style={{
          padding: '0.25rem 0.6rem',
          fontSize: '0.78rem',
          color: 'var(--accent)',
        }}
        title="Inicia una sesión de soporte actuando como el admin de este tenant (auditado, 1h máx.)"
      >
        Impersonar
      </button>

      {open && (
        <div
          onClick={() => !loading && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card animate-fade-up"
            role="dialog"
            aria-modal="true"
            style={{ padding: '1.75rem', maxWidth: 520, width: '100%', position: 'relative' }}
          >
            {/* Botón X para cerrar en la esquina superior derecha */}
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => !loading && setOpen(false)}
              disabled={loading}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: '50%',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)',
                fontSize: '1.1rem',
                lineHeight: 1,
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              ×
            </button>

            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.25rem', paddingRight: '2rem' }}>
              Iniciar impersonación
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Sesión de soporte sobre <strong style={{ color: 'var(--text-primary)' }}>{tenantName}</strong>
            </p>

            {/* Banner informativo con tono de advertencia suave */}
            <div style={{
              padding: '0.75rem 0.9rem',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: '1.1rem',
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}>⚠</span>
              <span>
                Vas a actuar como su <strong>tenant_admin</strong> por máximo <strong>1 hora</strong>.
                Todas tus acciones quedan registradas en el audit log con tu identidad de super_admin.
              </span>
            </div>

            <label
              style={{
                display: 'block',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: '0.4rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Motivo (ticket, email del cliente, etc.)
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="ej. Ticket #123 — cliente reporta que no puede lanzar su ciclo."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              autoFocus
              maxLength={500}
              style={{ resize: 'vertical', minHeight: 80 }}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {reason.length}/500 (mínimo 5)
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={loading || reason.trim().length < 5}
              >
                {loading ? 'Iniciando…' : 'Iniciar impersonación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
