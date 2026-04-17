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
          whiteSpace: 'nowrap',
        }}
        title="Inicia una sesión de soporte actuando como el admin de este tenant (auditado, 1h máx.)"
      >
        Impersonar
      </button>

      {/* CLON EXACTO del modal de Encargados (tenants/page.tsx:912+):
          - overlay zIndex 9999, sin padding (no 1rem), onClick solo en backdrop
          - card sin animate-fade-up, sin role dialog, sin maxWidth:100%
          - estructura idéntica: card 580px + padding 1.75rem + X + h3 + p */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !loading) setOpen(false); }}>
          <div className="card" style={{ padding: '1.75rem', width: '580px', maxHeight: '88vh', overflowY: 'auto', position: 'relative' }}>
            {/* X para cerrar en la esquina superior derecha */}
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => !loading && setOpen(false)}
              disabled={loading}
              style={{
                position: 'absolute', top: '0.75rem', right: '0.75rem',
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', borderRadius: '50%',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1,
              }}
              onMouseOver={(e) => { if (!loading) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              ×
            </button>

            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem', paddingRight: '2rem' }}>
              Iniciar impersonación
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
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

            <div style={{ height: 1, background: 'var(--border)', marginBottom: '1.1rem' }} />

            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem',
            }}>
              Motivo (ticket, email del cliente, etc.)
            </div>
            {/* Sin autoFocus: el browser hacía scrollIntoView al textarea y
                saltaba el h3 + banner (el modal interno se scrolleaba hacia
                abajo dejando el título fuera del área visible). El modal de
                Encargados no sufre esto porque su primer input está arriba.
                Si queremos foco automático lo haríamos con useRef + focus({
                preventScroll: true }) después de montar. */}
            <textarea
              className="input"
              rows={4}
              placeholder="ej. Ticket #123 — cliente reporta que no puede lanzar su ciclo."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              maxLength={500}
              style={{ resize: 'vertical', minHeight: 96 }}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {reason.length}/500 (mínimo 5)
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={loading || reason.trim().length < 5}
              >
                {loading ? 'Iniciando…' : 'Iniciar impersonación'}
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
