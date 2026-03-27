'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, token, user, logout } = useAuthStore();
  const [subStatus, setSubStatus] = useState<'loading' | 'active' | 'none' | 'suspended' | 'skip'>('loading');

  useEffect(() => {
    // Reject demo tokens or missing auth
    if (!isAuthenticated || token === 'demo-token' || !token) {
      logout();
      router.replace('/login');
    }
  }, [isAuthenticated, token, router, logout]);

  // Check subscription for non-super_admin users
  useEffect(() => {
    if (!token || !user) return;

    // Super admin doesn't need a subscription
    if (user.role === 'super_admin') {
      setSubStatus('skip');
      return;
    }

    api.subscriptions.mySubscription(token)
      .then((sub) => {
        if (!sub || !sub.plan) {
          setSubStatus('none');
        } else if (sub.status === 'active' || sub.status === 'trial') {
          setSubStatus('active');
        } else {
          setSubStatus('suspended');
        }
      })
      .catch(() => {
        // If endpoint fails (e.g. table doesn't exist yet), allow access
        setSubStatus('active');
      });
  }, [token, user]);

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
          <main style={{
            flex: 1, marginLeft: '260px', background: 'var(--bg-base)',
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                {subStatus === 'none' ? 'Sin suscripcion activa' : 'Suscripcion suspendida'}
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {subStatus === 'none'
                  ? 'Tu organizacion no tiene un plan asignado. Contacta al administrador del sistema para activar una suscripcion.'
                  : 'Tu suscripcion ha sido suspendida. Contacta al administrador del sistema para reactivarla.'}
              </p>
              <button
                className="btn-ghost"
                style={{ marginTop: '1.5rem' }}
                onClick={() => { logout(); router.replace('/login'); }}
              >
                Cerrar sesion
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
        {children}
      </main>
    </div>
  );
}
