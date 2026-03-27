'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { getRoleLabel } from '@/lib/roles';
import { api } from '@/lib/api';
import NotificationBell from './NotificationBell';

export default function TopBar() {
  const router = useRouter();
  const { user, token, logout } = useAuthStore();
  const [orgName, setOrgName] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    api.subscriptions.mySubscription(token)
      .then((sub) => {
        if (sub?.tenant?.name) setOrgName(sub.tenant.name);
        else if (sub?.plan?.name) setOrgName(sub.plan.name);
      })
      .catch(() => {});
  }, [token]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const initials = user
    ? `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || user.email.charAt(0).toUpperCase()
    : '?';

  const fullName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || '';

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: '260px',
      width: 'calc(100% - 260px)',
      height: '56px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 1.5rem',
      zIndex: 40,
    }}>
      {/* Left: Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Ascenda mini logo icon — 7 growing bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '24px' }}>
          {[6, 9, 12, 15, 18, 21, 24].map((h, i) => (
            <div key={i} style={{
              width: '3px',
              height: `${h}px`,
              borderRadius: '1px',
              background: `linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 100%)`,
              opacity: 0.4 + i * 0.09,
            }} />
          ))}
        </div>
        <span style={{
          fontSize: '1rem',
          fontWeight: 700,
          background: 'linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '0.02em',
        }}>
          Performance
        </span>
      </div>

      {/* Right: Notifications + User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <NotificationBell />

        {/* User dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem 0.35rem 0.35rem',
              cursor: 'pointer', transition: 'var(--transition)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {/* Avatar */}
            <div style={{
              width: '34px', height: '34px', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.8rem', fontWeight: 700, color: '#1a1206', flexShrink: 0,
            }}>
              {initials}
            </div>

            {/* Name + Org */}
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {fullName}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {orgName || (user?.role ? getRoleLabel(user.role) : '')}
              </div>
            </div>

            {/* Chevron */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 200ms', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: '0.5rem',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '0.5rem',
              minWidth: '200px', boxShadow: 'var(--shadow-card)',
              animation: 'fadeIn 0.15s ease-out',
              zIndex: 100,
            }}>
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {user?.email}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: '0.15rem' }}>
                  {user?.role ? getRoleLabel(user.role) : ''}
                </div>
              </div>

              <button
                onClick={() => { setDropdownOpen(false); router.push('/dashboard/ajustes'); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                  padding: '0.5rem 0.75rem', background: 'transparent', border: 'none',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem',
                  color: 'var(--text-secondary)', textAlign: 'left', transition: 'var(--transition)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                Mi perfil
              </button>

              <button
                onClick={handleLogout}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                  padding: '0.5rem 0.75rem', background: 'transparent', border: 'none',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem',
                  color: 'var(--danger)', textAlign: 'left', transition: 'var(--transition)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Cerrar sesion
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
