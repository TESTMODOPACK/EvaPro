'use client';

/**
 * Persistent red banner shown above every dashboard page while the current
 * JWT is an impersonation token. Makes it IMPOSSIBLE for the support agent
 * to forget they are acting on someone else's behalf — a regulatory + UX
 * requirement, not just a nice-to-have.
 *
 * Clicking "Salir" calls `/support/impersonate/end`, which returns a fresh
 * JWT for the original super_admin. We swap the token in the auth store and
 * reload so every in-memory query key resets.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore, decodeJwtPayload } from '@/store/auth.store';

function formatCountdown(expiresAt: string | undefined): string {
  if (!expiresAt) return '';
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'expirada';
  const m = Math.floor(msLeft / 60000);
  const s = Math.floor((msLeft % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ImpersonationBanner() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);

  // Tick once a second so the countdown updates without triggering a global
  // store change. Cheap since only this component re-renders.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!user?.impersonatedBy) return null;

  const countdown = formatCountdown(user.impersonationExpiresAt);
  const expired =
    user.impersonationExpiresAt && new Date(user.impersonationExpiresAt).getTime() < now;

  async function onEnd() {
    if (!token) return;
    setEnding(true);
    try {
      const res = await api.impersonation.end(token);
      const nextUser = decodeJwtPayload(res.access_token);
      if (nextUser) {
        setAuth(res.access_token, nextUser);
        router.replace('/dashboard');
      } else {
        // Decoded null — the server returned an invalid token somehow;
        // fall back to logout so the user isn't stuck.
        useAuthStore.getState().logout();
        router.replace('/login');
      }
    } catch {
      // If end fails (e.g. the super_admin was deactivated mid-session),
      // just log out — safer than leaving them in a confusing state.
      useAuthStore.getState().logout();
      router.replace('/login');
    } finally {
      setEnding(false);
    }
  }

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(90deg,#7f1d1d 0%,#991b1b 100%)',
        color: '#ffffff',
        padding: '10px 20px',
        fontSize: '0.88rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
        boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '1.1rem' }}>🔍</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>
            Modo soporte — estás impersonando a{' '}
            <strong>
              {user.firstName || user.email}
            </strong>
          </div>
          <div
            style={{
              fontSize: '0.78rem',
              opacity: 0.9,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {user.impersonationReason
              ? `Motivo: ${user.impersonationReason}`
              : 'Toda acción queda auditada con tu identidad de super_admin.'}
            {countdown && ` · Expira en ${countdown}`}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onEnd}
        disabled={ending}
        style={{
          background: '#ffffff',
          color: '#991b1b',
          fontWeight: 700,
          padding: '6px 14px',
          borderRadius: 6,
          border: 'none',
          cursor: ending ? 'not-allowed' : 'pointer',
          fontSize: '0.82rem',
          opacity: ending ? 0.6 : 1,
        }}
      >
        {ending ? 'Saliendo…' : expired ? 'Sesión expirada — Salir' : 'Salir de impersonación'}
      </button>
    </div>
  );
}
