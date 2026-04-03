'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { getRoleLabel } from '@/lib/roles';
import { useMySubscription } from '@/hooks/useSubscription';
import NotificationBell from './NotificationBell';
import { useLocaleStore, SupportedLocale } from '@/store/locale.store';
import { api } from '@/lib/api';

const LANG_FLAGS: Record<SupportedLocale, string> = { es: 'ES', en: 'EN', pt: 'PT' };

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter();
  const { user, logout, token } = useAuthStore();
  const { data: sub } = useMySubscription();
  const orgName = sub?.tenant?.name || sub?.plan?.name || '';
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { locale, setLocale } = useLocaleStore();

  const handleLangChange = async (lang: SupportedLocale) => {
    if (lang === locale) return;
    setLocale(lang);
    if (user?.userId && token) {
      try { await api.users.update(token, user.userId, { language: lang }); } catch { /* non-critical */ }
    }
  };

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

  // Close dropdown on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dropdownOpen) setDropdownOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dropdownOpen]);

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
    <header className="topbar-desktop" style={{
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
      {/* Left: Hamburger + Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Hamburger menu button (mobile only) */}
        <button
          className="hamburger-btn"
          onClick={onMenuClick}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--accent)' }}
          aria-label="Menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
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
        <span className="topbar-brand-text" style={{
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

      {/* Right: Org + Language + Notifications + User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>

        {/* Organization name — hidden on mobile via CSS */}
        {orgName && (
          <div className="topbar-org-badge" style={{
            display: 'flex', alignItems: 'center', gap: '0.45rem',
            padding: '0.25rem 0.75rem',
            background: 'rgba(201,147,58,0.08)',
            border: '1px solid rgba(201,147,58,0.18)',
            borderRadius: 'var(--radius-sm)',
            height: '30px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              color: 'var(--gold)',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              maxWidth: '180px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {orgName}
            </span>
          </div>
        )}

        {/* Language selector */}
        <div style={{
          display: 'flex', alignItems: 'center',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          overflow: 'hidden', height: '30px',
        }}>
          {(['es', 'en', 'pt'] as SupportedLocale[]).map((lang, i) => (
            <button
              key={lang}
              onClick={() => handleLangChange(lang)}
              title={lang === 'es' ? 'Español' : lang === 'en' ? 'English' : 'Português'}
              style={{
                padding: '0 9px',
                height: '100%',
                border: 'none',
                borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                background: locale === lang ? 'rgba(201,147,58,0.12)' : 'transparent',
                color: locale === lang ? 'var(--gold)' : 'var(--text-muted)',
                fontWeight: locale === lang ? 700 : 400,
                fontSize: '0.7rem',
                letterSpacing: '0.04em',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { if (locale !== lang) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (locale !== lang) e.currentTarget.style.background = 'transparent'; }}
            >
              {LANG_FLAGS[lang]}
            </button>
          ))}
        </div>

        <NotificationBell />

        {/* User dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-label={t('topbar.userMenu')}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem 0.35rem 0.35rem',
              cursor: 'pointer', transition: 'var(--transition)',
              outline: 'none',
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
            <div role="menu" aria-label={t('topbar.userOptions')} style={{
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
                {t('topbar.myProfile')}
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
                {t('topbar.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
