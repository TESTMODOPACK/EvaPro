'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, token, logout } = useAuthStore();

  useEffect(() => {
    // Reject demo tokens or missing auth
    if (!isAuthenticated || token === 'demo-token' || !token) {
      logout();
      router.replace('/login');
    }
  }, [isAuthenticated, token, router, logout]);

  if (!isAuthenticated || token === 'demo-token' || !token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar currentPath={pathname} />
      <main style={{
        flex: 1,
        marginLeft: '260px',
        background: 'var(--bg-base)',
        minHeight: '100vh',
        overflowY: 'auto',
      }}>
        {children}
      </main>
    </div>
  );
}
