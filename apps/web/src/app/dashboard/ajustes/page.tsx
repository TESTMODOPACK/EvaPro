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
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: '0.4rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

type SettingsTab = 'perfil' | 'organizacion' | 'notificaciones';

function Toggle({ value, onChange, size = 'md' }: { value: boolean; onChange: () => void; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 38 : 44;
  const h = size === 'sm' ? 22 : 24;
  const dot = size === 'sm' ? 18 : 20;
  return (
    <button type="button" onClick={onChange} style={{
      width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, border: 'none', cursor: 'pointer',
      background: value ? 'var(--accent)' : 'var(--border)',
      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: '2px',
        left: value ? `${w - dot - 2}px` : '2px',
        width: `${dot}px`, height: `${dot}px`, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

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
  const [tenantSettings, setTenantSettings] = useState<Record<string, any>>({});
  const [tenantName, setTenantName] = useState('');
  const [tenantRut, setTenantRut] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [tenantTimezone, setTenantTimezone] = useState('');
  const [tenantSessionTimeout, setTenantSessionTimeout] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [commercialAddress, setCommercialAddress] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [notifEvaluations, setNotifEvaluations] = useState(true);
  const [notifFeedback, setNotifFeedback] = useState(true);
  const [notifObjectives, setNotifObjectives] = useState(true);
  const [notifRecognitions, setNotifRecognitions] = useState(true);
  const [notifContracts, setNotifContracts] = useState(true);
  const [notifDevelopment, setNotifDevelopment] = useState(true);
  const [notifSurveys, setNotifSurveys] = useState(true);
  const [notifAi, setNotifAi] = useState(true);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('perfil');

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setPosition(user.position || '');
    }
  }, [user]);

  useEffect(() => {
    if (!token || !isTenantAdmin) return;
    api.tenants.me(token)
      .then((t: any) => {
        setTenantName(t.name || '');
        setTenantRut(t.rut ? formatRut(t.rut) : '');
        setCommercialAddress(t.commercialAddress || '');
        const s = t.settings || {};
        setTenantSettings(s);
        setTenantTimezone(s.timezone || '');
        setTenantSessionTimeout(s.sessionTimeoutMinutes?.toString() || '');
        setLogoUrl(s.logoUrl || '');
        setPrimaryColor(s.primaryColor || '');
        setDateFormat(s.dateFormat || '');
        setDefaultLanguage(s.defaultLanguage || '');
        setEmailNotifications(s.emailNotifications !== false);
        const nt = s.notificationTypes || {};
        setNotifEvaluations(nt.evaluations !== false);
        setNotifFeedback(nt.feedback !== false);
        setNotifObjectives(nt.objectives !== false);
        setNotifRecognitions(nt.recognitions !== false);
        setNotifContracts(nt.contracts !== false);
        setNotifDevelopment(nt.development !== false);
        setNotifSurveys(nt.surveys !== false);
        setNotifAi(nt.ai !== false);
      })
      .catch(() => {});
  }, [token, isTenantAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLanguageChange = async (lang: SupportedLocale) => {
    setLocale(lang);
    if (user?.id && token) {
      try { await api.users.update(token, user.id, { language: lang }); } catch {}
    }
    setLangSaved(true);
    setTimeout(() => setLangSaved(false), 2000);
  };

  const handleSaveOrgSettings = async () => {
    if (!token) return;
    setSettingsSaving(true);
    try {
      await api.tenants.updateSettings(token, {
        timezone: tenantTimezone || null,
        sessionTimeoutMinutes: tenantSessionTimeout ? parseInt(tenantSessionTimeout, 10) : null,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : null,
        dateFormat: dateFormat || null,
        defaultLanguage: defaultLanguage || null,
        commercialAddress: commercialAddress || null,
        emailNotifications,
        notificationTypes: {
          evaluations: notifEvaluations,
          feedback: notifFeedback,
          objectives: notifObjectives,
          recognitions: notifRecognitions,
          contracts: notifContracts,
          development: notifDevelopment,
          surveys: notifSurveys,
          ai: notifAi,
        },
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {}
    setSettingsSaving(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    try {
      await updateUser.mutateAsync({ id: user.id, data: { position } });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {}
  };

  const [passwordError, setPasswordError] = useState('');
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (!user?.id || !newPassword) return;
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPasswordError('Debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    try {
      await updateUser.mutateAsync({ id: user.id, data: { currentPassword, newPassword } });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Error al cambiar contraseña');
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  const tabs: Array<{ id: SettingsTab; label: string; icon: string; adminOnly?: boolean }> = [
    { id: 'perfil', label: 'Mi perfil', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
    ...(isTenantAdmin ? [
      { id: 'organizacion' as SettingsTab, label: 'Organización', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', adminOnly: true },
      { id: 'notificaciones' as SettingsTab, label: 'Notificaciones', icon: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0', adminOnly: true },
    ] : []),
  ];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('settings.title')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="animate-fade-up mobile-scroll-tabs" style={{
        display: 'flex', gap: '0.25rem', marginBottom: '1.5rem',
        borderBottom: '1px solid var(--border)', paddingBottom: '0',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.6rem 1rem', fontSize: '0.82rem',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
              transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Mi Perfil                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'perfil' && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Language */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {t('settings.language.title')}
            </h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {(['es', 'en', 'pt'] as SupportedLocale[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleLanguageChange(lang)}
                  style={{
                    padding: '0.45rem 1.1rem', borderRadius: '20px',
                    border: locale === lang ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: locale === lang ? 'rgba(201,147,58,0.1)' : 'transparent',
                    color: locale === lang ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: locale === lang ? 700 : 400,
                    cursor: 'pointer', fontSize: '0.82rem', transition: 'all 0.15s ease',
                  }}
                >
                  {{ es: '🇨🇱 Español', en: '🇺🇸 English', pt: '🇧🇷 Português' }[lang]}
                </button>
              ))}
            </div>
            {langSaved && (
              <p style={{ color: 'var(--success)', fontSize: '0.78rem', marginTop: '0.4rem', fontWeight: 600 }}>
                ✓ {t('settings.language.saved')}
              </p>
            )}
          </div>

          {/* Profile info */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>
              {t('settings.profile.title')}
            </h2>
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Nombres</label>
                  <input className="input" type="text" value={firstName} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>
                <div>
                  <label style={labelStyle}>Apellidos</label>
                  <input className="input" type="text" value={lastName} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>
                <div>
                  <label style={labelStyle}>{t('settings.profile.email')}</label>
                  <input className="input" type="email" value={user?.email || ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>
                <div>
                  <label style={labelStyle}>RUT</label>
                  <input className="input" type="text" value={(user as any)?.rut || 'No registrado'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={labelStyle}>{t('settings.profile.role')}</label>
                  <input className="input" type="text" value={user?.role ? getRoleLabel(user.role) : ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>
                <div>
                  <label style={labelStyle}>Cargo</label>
                  <input className="input" type="text" placeholder="Tu cargo" value={position} onChange={(e) => setPosition(e.target.value)} />
                </div>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                Los datos personales (nombres, apellidos, RUT) son gestionados por el administrador de tu organización.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button type="submit" className="btn-primary" disabled={updateUser.isPending} style={{ opacity: updateUser.isPending ? 0.6 : 1 }}>
                  {updateUser.isPending ? t('common.saving') : t('common.save')}
                </button>
                {saved && <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>{t('settings.profile.saved')}</span>}
                {updateUser.isError && !saved && <span style={{ color: 'var(--danger)', fontSize: '0.82rem', fontWeight: 600 }}>{t('settings.profile.saveError')}</span>}
              </div>
            </form>
          </div>

          {/* Change password */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {t('settings.security.title')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              {t('settings.security.subtitle')}
            </p>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
              <div>
                <label style={labelStyle}>{t('settings.security.currentPassword')}</label>
                <input className="input" type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.security.newPassword')}</label>
                <input className="input" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button type="submit" className="btn-primary" disabled={!currentPassword || !newPassword} style={{ opacity: !currentPassword || !newPassword ? 0.5 : 1 }}>
                  {t('settings.security.changePassword')}
                </button>
                {passwordSaved && <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>{t('settings.security.passwordSaved')}</span>}
                {passwordError && <span style={{ color: 'var(--danger)', fontSize: '0.82rem', fontWeight: 600 }}>{passwordError}</span>}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Organizacion (tenant_admin only)                              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'organizacion' && isTenantAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Company info */}
          <div className="card" style={{ padding: '1.5rem', borderLeft: '3px solid var(--accent)' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {t('settings.company.title')}
            </h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.company.legalName')}</label>
                <input className="input" type="text" value={tenantName || orgName || ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.company.taxId')}</label>
                <input className="input" type="text" value={tenantRut || orgRut || 'No registrado'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Industria</label>
                <input className="input" type="text" value={(sub?.tenant as any)?.industry || tenantSettings.industry || 'No registrada'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              </div>
              <div>
                <label style={labelStyle}>Rango de colaboradores</label>
                <input className="input" type="text" value={(sub?.tenant as any)?.employeeRange || tenantSettings.size || 'No registrado'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección comercial</label>
                <input className="input" type="text" placeholder="Ej: Av. Providencia 1234, Santiago"
                  value={commercialAddress} onChange={(e) => setCommercialAddress(e.target.value)} />
              </div>
            </div>
            {Array.isArray(tenantSettings.initialCompetencies) && tenantSettings.initialCompetencies.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={labelStyle}>{t('settings.company.competencies')}</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {tenantSettings.initialCompetencies.map((c: string) => (
                    <span key={c} className="badge badge-accent" style={{ fontSize: '0.78rem' }}>{c}</span>
                  ))}
                </div>
              </div>
            )}
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              {t('settings.company.readOnlyNote')}
            </p>
          </div>

          {/* Logo + branding */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Marca e identidad
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Logo de la empresa</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{
                    width: '64px', height: '64px', borderRadius: 'var(--radius-sm, 6px)',
                    border: '2px dashed var(--border)', overflow: 'hidden', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-surface)',
                  }}>
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                      </svg>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontWeight: 600,
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer', color: 'var(--text-primary)',
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Subir imagen
                      <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 500_000) { alert('Maximo 500KB.'); return; }
                          const reader = new FileReader();
                          reader.onload = () => setLogoUrl(reader.result as string);
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {logoUrl && (
                      <button type="button" onClick={() => setLogoUrl('')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '0.75rem', padding: 0, textAlign: 'left' }}>
                        Eliminar logo
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  PNG, JPG, SVG o WebP. Max 500KB. Aparece en emails a colaboradores.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Idioma por defecto</label>
                <select className="input" value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value)}>
                  <option value="">Segun preferencia del usuario</option>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="pt">Portugues</option>
                </select>
              </div>
            </div>
          </div>

          {/* General settings */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {t('settings.org.title')}
            </h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.org.timezone')}</label>
                <select className="input" value={tenantTimezone} onChange={(e) => setTenantTimezone(e.target.value)}>
                  <option value="">{t('settings.org.timezoneDefault')}</option>
                  <option value="America/Santiago">Santiago (UTC-3/-4)</option>
                  <option value="America/Argentina/Buenos_Aires">Buenos Aires (UTC-3)</option>
                  <option value="America/Bogota">Bogota (UTC-5)</option>
                  <option value="America/Mexico_City">Mexico (UTC-6)</option>
                  <option value="America/Lima">Lima (UTC-5)</option>
                  <option value="America/Sao_Paulo">Sao Paulo (UTC-3)</option>
                  <option value="America/New_York">New York (UTC-5)</option>
                  <option value="Europe/Madrid">Madrid (UTC+1)</option>
                  <option value="Europe/London">London (UTC+0)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('settings.org.sessionTimeout')}</label>
                <select className="input" value={tenantSessionTimeout} onChange={(e) => setTenantSessionTimeout(e.target.value)}>
                  <option value="">{t('settings.org.sessionDefault')}</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="60">1 hora</option>
                  <option value="120">2 horas</option>
                  <option value="480">8 horas</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Formato de fecha</label>
                <select className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                  <option value="">DD/MM/YYYY</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
            </div>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button type="button" className="btn-primary" disabled={settingsSaving}
              style={{ opacity: settingsSaving ? 0.6 : 1, padding: '0.6rem 1.5rem' }}
              onClick={handleSaveOrgSettings}>
              {settingsSaving ? t('common.saving') : 'Guardar cambios'}
            </button>
            {settingsSaved && (
              <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>
                {t('settings.org.saved')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Notificaciones (tenant_admin only)                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'notificaciones' && isTenantAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Emails automáticos
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Controla qué tipos de email reciben los colaboradores de tu organización.
            </p>

            {/* Master toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1rem', background: emailNotifications ? 'rgba(201,147,58,0.06)' : 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm, 6px)', border: `1px solid ${emailNotifications ? 'rgba(201,147,58,0.2)' : 'var(--border)'}`,
              marginBottom: '0.75rem',
            }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Notificaciones por email</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Activar o desactivar todos los emails</div>
              </div>
              <Toggle value={emailNotifications} onChange={() => setEmailNotifications(!emailNotifications)} />
            </div>

            {/* Category toggles */}
            {emailNotifications && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {[
                  { label: 'Evaluaciones', desc: 'Ciclos lanzados, recordatorios, resultados y calibración', value: notifEvaluations, setter: setNotifEvaluations },
                  { label: 'Feedback y check-ins', desc: 'Feedback recibido, reuniones 1:1 programadas y vencidas', value: notifFeedback, setter: setNotifFeedback },
                  { label: 'Objetivos y OKRs', desc: 'Asignación, progreso bajo, vencimientos y completados', value: notifObjectives, setter: setNotifObjectives },
                  { label: 'Desarrollo y PDI', desc: 'Planes de desarrollo asignados y acciones vencidas', value: notifDevelopment, setter: setNotifDevelopment },
                  { label: 'Reconocimientos', desc: 'Reconocimientos, insignias y desafíos', value: notifRecognitions, setter: setNotifRecognitions },
                  { label: 'Contratos y firmas', desc: 'Solicitudes de firma, códigos OTP de verificación', value: notifContracts, setter: setNotifContracts },
                  { label: 'Encuestas de clima', desc: 'Invitaciones a encuestas y recordatorios', value: notifSurveys, setter: setNotifSurveys },
                  { label: 'Informes de IA', desc: 'Notificaciones cuando un análisis IA está listo', value: notifAi, setter: setNotifAi },
                ].map((item) => (
                  <div key={item.label} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.6rem 1rem', background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.desc}</div>
                    </div>
                    <Toggle value={item.value} onChange={() => item.setter(!item.value)} size="sm" />
                  </div>
                ))}
              </div>
            )}

            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Los emails del sistema (invitaciones, recuperación de contraseña) siempre se envían.
            </p>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button type="button" className="btn-primary" disabled={settingsSaving}
              style={{ opacity: settingsSaving ? 0.6 : 1, padding: '0.6rem 1.5rem' }}
              onClick={handleSaveOrgSettings}>
              {settingsSaving ? t('common.saving') : 'Guardar cambios'}
            </button>
            {settingsSaved && (
              <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>
                {t('settings.org.saved')}
              </span>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
