'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

/**
 * RootPage — decide a dónde redirigir: /dashboard si hay sesión, /login si no.
 *
 * v3.1 fix: **esperar a que Zustand termine de hidratar desde localStorage**
 * antes de redirigir. Sin este guard, en la PWA standalone (start_url="/")
 * el useEffect corría con isAuthenticated=false (estado inicial) y mandaba
 * al usuario autenticado a /login → loop con auto-login fallido → spinner
 * infinito. El flag `_hasHydrated` se marca true dentro de
 * `onRehydrateStorage` del persist middleware (auth.store.ts).
 *
 * Fallback de seguridad: si la hidratación no resuelve en 4s (storage
 * corrupto, bug del browser), redirigir a /login para que el usuario
 * pueda al menos intentar iniciar sesión — mejor que spinner eterno.
 */
export default function RootPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const [timedOut, setTimedOut] = useState(false);

  // Safety net: 4s de timeout para no colgarse si la hidratación falla.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Esperar a que hidrate (o al timeout) antes de decidir.
    if (!hasHydrated && !timedOut) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [isAuthenticated, hasHydrated, timedOut, router]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        background: 'var(--bg-base)',
      }}
    >
      <span className="spinner" />
      {timedOut && !hasHydrated && (
        <p
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
            maxWidth: '320px',
            textAlign: 'center',
            padding: '0 1rem',
            margin: 0,
          }}
        >
          Cargando… Si esta pantalla persiste, cierra y vuelve a abrir la
          aplicación.
        </p>
      )}
    </div>
  );
}
