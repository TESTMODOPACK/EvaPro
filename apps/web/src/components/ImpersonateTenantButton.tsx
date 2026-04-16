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
        onClick={() => setOpen(true)}
        disabled={disabled}
        style={{
          padding: '6px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
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
            style={{ padding: '1.75rem', maxWidth: 500, width: '100%' }}
          >
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Iniciar impersonación
            </h2>
            <p
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                marginBottom: '1rem',
                lineHeight: 1.5,
              }}
            >
              Accederás al dashboard de <strong>{tenantName}</strong> actuando como su
              tenant_admin. Duración máxima: <strong>1 hora</strong>. Toda acción queda
              registrada en el audit log con tu identidad.
            </p>

            <label
              style={{
                display: 'block',
                fontSize: '0.78rem',
                fontWeight: 600,
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
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {reason.length}/500
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
                style={{ fontSize: '0.875rem' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={loading || reason.trim().length < 5}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: loading ? 0.6 : 1,
                }}
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
