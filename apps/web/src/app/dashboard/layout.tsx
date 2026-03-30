'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import { useMySubscription } from '@/hooks/useSubscription';

function OnboardingBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(201,147,58,0.12) 0%, rgba(201,147,58,0.06) 100%)',
      borderBottom: '1px solid rgba(201,147,58,0.25)',
      padding: '0.65rem 1.5rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '8px',
          background: 'rgba(201,147,58,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9933A" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          Completa la configuración inicial para sacar el máximo partido a EvaPro.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <Link
          href="/dashboard/onboarding"
          style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: '#C9933A', textDecoration: 'none',
            background: 'rgba(201,147,58,0.12)', padding: '5px 14px',
            borderRadius: '999px', border: '1px solid rgba(201,147,58,0.3)',
            transition: 'background 0.15s',
          }}
        >
          Configurar ahora →
        </Link>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Descartar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, token, user, logout } = useAuthStore();
  const { data: sub, isLoading: subLoading, isError: subError } = useMySubscription();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || token === 'demo-token' || !token) {
      logout();
      router.replace('/login');
    }
  }, [isAuthenticated, token, router, logout]);

  // Show the onboarding banner for tenant_admin only if they haven't completed onboarding.
  // Completion is persisted in localStorage ('evapro_onboarding_done').
  useEffect(() => {
    if (user?.role === 'tenant_admin' && !pathname.startsWith('/dashboard/onboarding')) {
      const done = typeof window !== 'undefined'
        ? localStorage.getItem('evapro_onboarding_done')
        : null;
      if (!done) setShowOnboarding(true);
    }
  }, [user, pathname]);

  // Derive subscription status from shared hook
  const subStatus: 'loading' | 'active' | 'none' | 'suspended' | 'skip' = (() => {
    if (user?.role === 'super_admin') return 'skip';
    if (subLoading) return 'loading';
    if (subError) return 'active'; // If endpoint fails, allow access
    if (!sub || !sub.plan) return 'none';
    if (sub.status === 'active' || sub.status === 'trial') return 'active';
    return 'suspended';
  })();

  if (!isAuthenticated || token === 'demo-token' || !token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  // Show subscription block screen
  if (subStatus === 'none' || subStatus === 'suspended') {
    // Allow access to ajustes so user can see their profile
    const allowedPaths = ['/dashboard/ajustes'];
    const isAllowed = allowedPaths.some((p) => pathname.startsWith(p));

    if (!isAllowed) {
      return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar currentPath={pathname} />
          <TopBar />
          <main style={{
            flex: 1, marginLeft: '260px', marginTop: '56px', background: 'var(--bg-base)',
            minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ textAlign: 'center', maxWidth: '500px', padding: '2rem' }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: subStatus === 'none' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1.5rem',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                  stroke={subStatus === 'none' ? '#f59e0b' : '#ef4444'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                {subStatus === 'none' ? 'Sin suscripción activa' : 'Suscripción suspendida'}
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {subStatus === 'none'
                  ? 'Tu organización no tiene un plan asignado. Contacta al administrador del sistema para activar una suscripción.'
                  : 'Tu suscripción ha sido suspendida. Contacta al administrador del sistema para reactivarla.'}
              </p>
              <button
                className="btn-ghost"
                style={{ marginTop: '1.5rem' }}
                onClick={() => { logout(); router.replace('/login'); }}
              >
                Cerrar sesión
              </button>
            </div>
          </main>
        </div>
      );
    }
  }

  // Still loading subscription check
  if (subStatus === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  // Session-only dismiss: only updates React state, no localStorage write.
  // Banner reappears on next login automatically.
  const dismissOnboarding = () => {
    setShowOnboarding(false);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar currentPath={pathname} />
      <TopBar />
      <main style={{
        flex: 1,
        marginLeft: '260px',
        marginTop: '56px',
        background: 'var(--bg-base)',
        minHeight: 'calc(100vh - 56px)',
        overflowY: 'auto',
      }}>
        {showOnboarding && <OnboardingBanner onDismiss={dismissOnboarding} />}
        {children}
      </main>
    </div>
  );
}
