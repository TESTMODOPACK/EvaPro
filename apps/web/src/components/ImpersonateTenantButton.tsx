'use client';

/**
 * Botón de impersonación para la tabla de organizaciones del super_admin.
 *
 * Al click, abre un modal que captura la razón de soporte, llama a
 * /support/impersonate, swappea el JWT en el auth store y navega a
 * /dashboard. ImpersonationBanner toma el control desde ahí.
 *
 * === Evolución del modal (historia del bug) ===
 *
 * v1 (legacy): reflect-mode primitivo.
 * v2: clon del modal de Encargados con `maxHeight: 88vh + overflowY: auto`.
 * v3: quitado `autoFocus` del textarea que causaba scrollIntoView y
 *     dejaba el header fuera del viewport visible.
 * v4: arquitectura flex 3-zone con header/footer `flex-shrink:0` y body
 *     `flex:1 + overflowY:auto`. Layout correcto.
 * v5 (este): **React Portal a document.body**. El bug real era que
 *     `<main className="main-content">` tiene `overflowY:auto` y varios
 *     elementos en el árbol del dashboard usan `transform` (hover en
 *     .btn-primary, iconos rotando con transform, etc.). Un `transform`
 *     en CUALQUIER ancestor convierte a ese ancestor en el contenedor
 *     de referencia de `position:fixed`, rompiendo el anclaje al
 *     viewport del browser. El dialog quedaba atrapado dentro del área
 *     de contenido con header/footer fuera de la ventana visible.
 *
 *     Solución: usar `createPortal` para montar el dialog como hijo
 *     directo de `document.body`, totalmente fuera del árbol del
 *     dashboard. Ahora `position:fixed` realmente apunta al viewport
 *     y las 3 zonas flex (header/body/footer) son siempre visibles.
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

      {open && (
        <ImpersonationDialog
          tenantName={tenantName}
          reason={reason}
          loading={loading}
          onReasonChange={setReason}
          onCancel={() => !loading && setOpen(false)}
          onSubmit={submit}
        />
      )}
    </>
  );
}

/**
 * Dialog extraído a componente separado y renderizado con createPortal
 * al `document.body`. Esto es CRÍTICO: si el dialog se renderiza en el
 * lugar natural del árbol React, queda dentro de `<main>` que tiene
 * `overflowY:auto` y hay ancestors con `transform` (btn hover, etc.).
 * Cualquier `transform` en un ancestor rompe el `position:fixed`
 * relativo al viewport — CSS spec: el elemento con transform pasa a
 * ser el contenedor de referencia.
 *
 * Al portalizar a document.body, el dialog queda como hermano del root
 * de Next.js y `position:fixed` realmente ancla al viewport del browser.
 *
 * Layout interno: flex column con maxHeight fijo.
 *   - header:  flex-shrink: 0  → SIEMPRE visible
 *   - body:    flex: 1 1 auto + overflowY: auto → el único que scrollea
 *   - footer:  flex-shrink: 0  → SIEMPRE visible
 */
function ImpersonationDialog(props: {
  tenantName: string;
  reason: string;
  loading: boolean;
  onReasonChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { tenantName, reason, loading, onReasonChange, onCancel, onSubmit } = props;

  // Guard para SSR: document no existe en el servidor. Solo hacemos
  // createPortal tras el primer render en cliente (evita hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Bloquear scroll del body mientras el modal está abierto
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!mounted) return null;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="imp-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        padding: '1rem',
      }}
    >
      {/* Card con 3 zonas en flex column */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '580px',
          maxWidth: '100%',
          maxHeight: '88vh',
          padding: 0, // padding lo manejan las zonas individuales
          position: 'relative',
          overflow: 'hidden', // contenedor no scrollea; solo el body interno
        }}
      >
        {/* ─── HEADER (siempre visible) ─────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            padding: '1.5rem 1.75rem 1rem',
            borderBottom: '1px solid var(--border)',
            position: 'relative',
          }}
        >
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCancel}
            disabled={loading}
            style={{
              position: 'absolute',
              top: '0.9rem',
              right: '0.9rem',
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: '50%',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted)', fontSize: '1.3rem', lineHeight: 1,
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            ×
          </button>

          <h3
            id="imp-dialog-title"
            style={{
              fontWeight: 700,
              fontSize: '1.1rem',
              margin: 0,
              marginBottom: '0.35rem',
              paddingRight: '2rem',
              color: 'var(--text-primary)',
            }}
          >
            Iniciar impersonación
          </h3>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              margin: 0,
            }}
          >
            Sesión de soporte sobre{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{tenantName}</strong>
          </p>
        </div>

        {/* ─── BODY (único scrollable) ──────────────────────────── */}
        <div
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '1.25rem 1.75rem',
          }}
        >
          {/* Banner warning con tono dorado suave */}
          <div
            style={{
              padding: '0.75rem 0.9rem',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: '1.25rem',
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}>⚠</span>
            <span>
              Vas a actuar como su <strong>tenant_admin</strong> por máximo{' '}
              <strong>1 hora</strong>. Todas tus acciones quedan registradas en el
              audit log con tu identidad de super_admin.
            </span>
          </div>

          <label
            htmlFor="imp-reason"
            style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem',
            }}
          >
            Motivo (ticket, email del cliente, etc.)
          </label>
          <textarea
            id="imp-reason"
            className="input"
            rows={4}
            placeholder="ej. Ticket #123 — cliente reporta que no puede lanzar su ciclo."
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={loading}
            maxLength={500}
            style={{ resize: 'vertical', minHeight: 96, width: '100%' }}
          />
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              textAlign: 'right',
              marginTop: '0.3rem',
            }}
          >
            {reason.length}/500 (mínimo 5)
          </div>
        </div>

        {/* ─── FOOTER (siempre visible) ─────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            padding: '1rem 1.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn-primary"
            onClick={onSubmit}
            disabled={loading || reason.trim().length < 5}
          >
            {loading ? 'Iniciando…' : 'Iniciar impersonación'}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );

  // Portal al document.body para escapar cualquier ancestor con
  // transform/overflow que rompa `position:fixed` al viewport.
  return createPortal(dialog, document.body);
}
