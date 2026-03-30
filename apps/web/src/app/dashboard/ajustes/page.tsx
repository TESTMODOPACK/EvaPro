'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser, useUpdateUser } from '@/hooks/useUsers';
import { getRoleLabel } from '@/lib/roles';
import { useMySubscription } from '@/hooks/useSubscription';
import { formatRut } from '@/lib/rut';
import { useLocaleStore, SupportedLocale } from '@/store/locale.store';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function AjustesPage() {
  const { t } = useTranslation();
  const { data: user, isLoading } = useCurrentUser();
  const updateUser = useUpdateUser();
  const { data: sub } = useMySubscription();
  const isTenantAdmin = user?.role === 'tenant_admin';
  const orgName = sub?.tenant?.name || '';
  const orgRut = sub?.tenant?.rut ? formatRut(sub.tenant.rut) : '';

  const { locale, setLocale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);
  const [langSaved, setLangSaved] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Populate form once user loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setPosition(user.position || '');
    }
  }, [user]);

  const handleLanguageChange = async (lang: SupportedLocale) => {
    setLocale(lang);
    if (user?.id && token) {
      try {
        await api.users.update(token, user.id, { language: lang });
      } catch {
        // silently ignore — locale is already set in store/localStorage
      }
    }
    setLangSaved(true);
    setTimeout(() => setLangSaved(false), 2000);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: { firstName, lastName, position },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error is available via updateUser.error
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !newPassword) return;
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: { currentPassword, newPassword },
      });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch {
      // error is available via updateUser.error
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('settings.title')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Language selector */}
      <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {t('settings.language.title')}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
          {t('settings.language.description')}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {(['es', 'en', 'pt'] as SupportedLocale[]).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => handleLanguageChange(lang)}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '20px',
                border: locale === lang ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: locale === lang ? 'rgba(201,147,58,0.1)' : 'transparent',
                color: locale === lang ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: locale === lang ? 700 : 400,
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.15s ease',
              }}
            >
              {{ es: '🇨🇱 Español', en: '🇺🇸 English', pt: '🇧🇷 Português' }[lang]}
            </button>
          ))}
        </div>
        {langSaved && (
          <p style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 600 }}>
            ✓ {t('settings.language.saved')}
          </p>
        )}
      </div>

      {/* Company Info Section (tenant_admin only) */}
      {isTenantAdmin && (
        <div
          className="card animate-fade-up"
          style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '3px solid var(--accent)' }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            {t('settings.company.title')}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
            {t('settings.company.subtitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.company.legalName')}</label>
              <input
                className="input"
                type="text"
                value={orgName}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.company.taxId')}</label>
              <input
                className="input"
                type="text"
                value={orgRut || 'No registrado'}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            {t('settings.company.readOnlyNote')}
          </p>
        </div>
      )}

      {/* Profile Section */}
      <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {t('settings.profile.title')}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem' }}>
          {t('settings.profile.subtitle')}
        </p>

        <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.profile.email')}</label>
              <input
                className="input"
                type="email"
                value={user?.email || ''}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.role')}</label>
              <input
                className="input"
                type="text"
                value={user?.role ? getRoleLabel(user.role) : ''}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.profile.firstName')}</label>
              <input
                className="input"
                type="text"
                placeholder={t('settings.profile.firstName')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.lastName')}</label>
              <input
                className="input"
                type="text"
                placeholder={t('settings.profile.lastName')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t('settings.profile.position')}</label>
            <input
              className="input"
              type="text"
              placeholder={t('settings.profile.positionPlaceholder')}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={updateUser.isPending}
              style={{ opacity: updateUser.isPending ? 0.6 : 1 }}
            >
              {updateUser.isPending ? t('common.saving') : t('common.save')}
            </button>
            {saved && (
              <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                {t('settings.profile.saved')}
              </span>
            )}
            {updateUser.isError && !saved && (
              <span style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                {t('settings.profile.saveError')}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Password Section */}
      <div className="card animate-fade-up-delay-1" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {t('settings.security.title')}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem' }}>
          {t('settings.security.subtitle')}
        </p>

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>{t('settings.security.currentPassword')}</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('settings.security.newPassword')}</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={!currentPassword || !newPassword}
              style={{ opacity: !currentPassword || !newPassword ? 0.5 : 1 }}
            >
              {t('settings.security.changePassword')}
            </button>
            {passwordSaved && (
              <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                {t('settings.security.passwordSaved')}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
