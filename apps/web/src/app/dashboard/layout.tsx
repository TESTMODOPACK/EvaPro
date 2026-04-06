'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import Toast from '@/components/Toast';
import { useMySubscription } from '@/hooks/useSubscription';

function OnboardingBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
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
          {t('layout.onboardingBanner')}
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
          {t('layout.configureNow')}
        </Link>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={t('layout.dismiss')}
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
  const { t } = useTranslation();
  const router   = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, token, user, logout, _hasHydrated } = useAuthStore();
  const { data: sub, isLoading: subLoading, isError: subError } = useMySubscription();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Wait for Zustand to rehydrate from localStorage before checking auth
    if (!_hasHydrated) return;
    if (!isAuthenticated || token === 'demo-token' || !token) {
      logout();
      router.replace('/login');
    }
  }, [_hasHydrated, isAuthenticated, token, router, logout]);

  // ─── Silent token refresh based on user activity ─────────────────────
  const lastActivityRef = useRef(Date.now());
  const refreshingRef = useRef(false);
  const CHECK_INTERVAL = 2 * 60 * 1000; // Check every 2 minutes
  const REFRESH_MARGIN = 5 * 60 * 1000; // Refresh 5 min before expiration
  const INACTIVITY_LIMIT = 60 * 60 * 1000; // Logout after 60 min of inactivity

  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Track user activity
  useEffect(() => {
    let lastUpdate = 0;
    const throttled = () => { const now = Date.now(); if (now - lastUpdate > 1000) { lastUpdate = now; updateActivity(); } };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, throttled, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, throttled));
  }, [updateActivity]);

  // Periodic check: refresh token if about to expire and user is active
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

    // Decode token expiration
    const getTokenExp = (): number => {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return (payload.exp || 0) * 1000; // Convert to ms
      } catch { return Date.now() + 30 * 60 * 1000; } // Fallback 30min
    };

    const interval = setInterval(async () => {
      const idleTime = Date.now() - lastActivityRef.current;

      // Inactive too long → logout
      if (idleTime > INACTIVITY_LIMIT) {
        clearInterval(interval);
        logout();
        router.replace('/login');
        return;
      }

      // Token about to expire and user is active → refresh
      const expMs = getTokenExp();
      const timeLeft = expMs - Date.now();

      if (timeLeft < REFRESH_MARGIN && !refreshingRef.current) {
        refreshingRef.current = true;
        try {
          const res = await fetch(`${API}/auth/refresh`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.access_token && user) {
              useAuthStore.getState().setAuth(data.access_token, user);
            }
          }
        } catch {
          // Network error — skip this refresh cycle
        } finally {
          refreshingRef.current = false;
        }
      }
    }, CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [token, isAuthenticated, user, logout, router]);

  // Onboarding banner disabled — configuration is now handled in Ajustes (Settings)
  // The onboarding page still exists for manual access if needed.

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
    // Allow access to perfil and ajustes even with suspended subscription
    const allowedPaths = ['/dashboard/perfil', '/dashboard/ajustes'];
    const isAllowed = allowedPaths.some((p) => pathname.startsWith(p));

    if (!isAllowed) {
      return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar currentPath={pathname} isOpen={sidebarOpen} onToggle={() => setSidebarOpen(false)} />
          <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <main className="main-content" style={{
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
                {subStatus === 'none' ? t('layout.noSubscription') : t('layout.suspended')}
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {subStatus === 'none' ? t('layout.noSubscriptionMsg') : t('layout.suspendedMsg')}
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
      <Sidebar currentPath={pathname} isOpen={sidebarOpen} onToggle={() => setSidebarOpen(false)} />
      <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
      <main className="main-content" style={{
        flex: 1,
        marginLeft: '260px', /* overridden to 0 on mobile via .main-content class */
        marginTop: '56px',
        background: 'var(--bg-base)',
        minHeight: 'calc(100vh - 56px)',
        overflowY: 'auto',
      }}>
        {showOnboarding && <OnboardingBanner onDismiss={dismissOnboarding} />}
        {children}
      </main>
      <Toast />
    </div>
  );
}
