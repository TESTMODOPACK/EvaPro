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

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  marginBottom: '0.25rem',
};

const sectionDescStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.82rem',
  marginBottom: '1.25rem',
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

  // Organization settings
  const [tenantTimezone, setTenantTimezone] = useState('');
  const [tenantSessionTimeout, setTenantSessionTimeout] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [notifEvaluations, setNotifEvaluations] = useState(true);
  const [notifFeedback, setNotifFeedback] = useState(true);
  const [notifObjectives, setNotifObjectives] = useState(true);
  const [notifRecognitions, setNotifRecognitions] = useState(true);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Populate form once user loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setPosition(user.position || '');
    }
  }, [user]);

  // Load full tenant data (name, rut, settings) for tenant_admin.
  useEffect(() => {
    if (!token || !isTenantAdmin) return;
    api.tenants.me(token)
      .then((t: any) => {
        setTenantName(t.name || '');
        setTenantRut(t.rut ? formatRut(t.rut) : '');
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
      })
      .catch(() => {});
  }, [token, isTenantAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

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
        emailNotifications,
        notificationTypes: {
          evaluations: notifEvaluations,
          feedback: notifFeedback,
          objectives: notifObjectives,
          recognitions: notifRecognitions,
        },
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch { /* silently fail */ }
    setSettingsSaving(false);
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
        <h2 style={sectionTitleStyle}>{t('settings.language.title')}</h2>
        <p style={sectionDescStyle}>{t('settings.language.description')}</p>
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
          <h2 style={sectionTitleStyle}>{t('settings.company.title')}</h2>
          <p style={sectionDescStyle}>{t('settings.company.subtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.company.legalName')}</label>
              <input className="input" type="text" value={tenantName || orgName || ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.company.taxId')}</label>
              <input className="input" type="text" value={tenantRut || orgRut || 'No registrado'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }} />
            </div>
            {tenantSettings.industry && (
              <div>
                <label style={labelStyle}>{t('settings.company.industry')}</label>
                <input className="input" type="text" value={tenantSettings.industry} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              </div>
            )}
            {tenantSettings.size && (
              <div>
                <label style={labelStyle}>{t('settings.company.size')}</label>
                <input className="input" type="text" value={tenantSettings.size} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              </div>
            )}
            {Array.isArray(tenantSettings.initialCompetencies) && tenantSettings.initialCompetencies.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t('settings.company.competencies')}</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {tenantSettings.initialCompetencies.map((c: string) => (
                    <span key={c} className="badge badge-accent" style={{ fontSize: '0.78rem' }}>{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            {t('settings.company.readOnlyNote')}
          </p>
        </div>
      )}

      {/* ─── Branding & Identity (tenant_admin only) ─── */}
      {isTenantAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
          <h2 style={sectionTitleStyle}>Marca e identidad</h2>
          <p style={sectionDescStyle}>Personaliza la apariencia de tu organizacion en la plataforma.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            {/* Logo URL */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Logo de la empresa (URL)</label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {logoUrl && (
                  <div style={{
                    width: '48px', height: '48px', borderRadius: 'var(--radius-sm, 6px)',
                    border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-surface)',
                  }}>
                    <img
                      src={logoUrl}
                      alt="Logo"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
                <input
                  className="input"
                  type="url"
                  placeholder="https://mi-empresa.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                URL directa a la imagen del logo (PNG, SVG o JPG). Recomendado: 200x200px minimo.
              </p>
            </div>

            {/* Primary color */}
            <div>
              <label style={labelStyle}>Color principal</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="color"
                  value={primaryColor || '#c9933a'}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  style={{
                    width: '40px', height: '36px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer', padding: '2px',
                    background: 'var(--bg-surface)',
                  }}
                />
                <input
                  className="input"
                  type="text"
                  placeholder="#c9933a"
                  value={primaryColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^#[0-9a-fA-F]{0,6}$/.test(val)) setPrimaryColor(val);
                  }}
                  maxLength={7}
                  style={{ width: '110px', fontFamily: 'monospace' }}
                />
                {primaryColor && (
                  <button
                    type="button"
                    onClick={() => setPrimaryColor('')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: '0.78rem',
                    }}
                  >
                    Restablecer
                  </button>
                )}
              </div>
            </div>

            {/* Default language */}
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
      )}

      {/* ─── Organization Settings (tenant_admin only) ─── */}
      {isTenantAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
          <h2 style={sectionTitleStyle}>{t('settings.org.title')}</h2>
          <p style={sectionDescStyle}>{t('settings.org.subtitle')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.org.timezone')}</label>
              <select className="input" value={tenantTimezone} onChange={(e) => setTenantTimezone(e.target.value)}>
                <option value="">{t('settings.org.timezoneDefault')}</option>
                <option value="America/Santiago">America/Santiago (CLT, UTC-3/-4)</option>
                <option value="America/Argentina/Buenos_Aires">America/Buenos Aires (ART, UTC-3)</option>
                <option value="America/Bogota">America/Bogota (COT, UTC-5)</option>
                <option value="America/Mexico_City">America/Mexico City (CST, UTC-6)</option>
                <option value="America/Lima">America/Lima (PET, UTC-5)</option>
                <option value="America/Sao_Paulo">America/Sao Paulo (BRT, UTC-3)</option>
                <option value="America/New_York">America/New York (EST, UTC-5)</option>
                <option value="Europe/Madrid">Europe/Madrid (CET, UTC+1)</option>
                <option value="Europe/London">Europe/London (GMT, UTC+0)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('settings.org.sessionTimeout')}</label>
              <select className="input" value={tenantSessionTimeout} onChange={(e) => setTenantSessionTimeout(e.target.value)}>
                <option value="">{t('settings.org.sessionDefault')}</option>
                <option value="15">15 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
                <option value="480">8 horas</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Formato de fecha</label>
              <select className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                <option value="">Por defecto (DD/MM/YYYY)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (31/12/2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (12/31/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2026-12-31)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ─── Email & Notifications (tenant_admin only) ─── */}
      {isTenantAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
          <h2 style={sectionTitleStyle}>Notificaciones por email</h2>
          <p style={sectionDescStyle}>Configura que notificaciones reciben los colaboradores de tu organizacion.</p>

          {/* Master toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.85rem 1rem', background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)',
            marginBottom: '0.75rem',
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Notificaciones por email</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Activar o desactivar todos los emails automaticos</div>
            </div>
            <button
              type="button"
              onClick={() => setEmailNotifications(!emailNotifications)}
              style={{
                width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                background: emailNotifications ? 'var(--accent)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: '2px',
                left: emailNotifications ? '22px' : '2px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>

          {/* Individual toggles */}
          {emailNotifications && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { label: 'Evaluaciones', desc: 'Asignaciones, recordatorios y resultados de ciclos', value: notifEvaluations, setter: setNotifEvaluations },
                { label: 'Feedback', desc: 'Feedback recibido y solicitudes de feedback', value: notifFeedback, setter: setNotifFeedback },
                { label: 'Objetivos', desc: 'Asignacion, vencimiento y aprobacion de objetivos', value: notifObjectives, setter: setNotifObjectives },
                { label: 'Reconocimientos', desc: 'Reconocimientos recibidos, insignias y desafios', value: notifRecognitions, setter: setNotifRecognitions },
              ].map((item) => (
                <div key={item.label} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.65rem 1rem', background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm, 6px)', border: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => item.setter(!item.value)}
                    style={{
                      width: '38px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer',
                      background: item.value ? 'var(--accent)' : 'var(--border)',
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: '2px',
                      left: item.value ? '18px' : '2px',
                      width: '18px', height: '18px', borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Save org settings button (tenant_admin) ─── */}
      {isTenantAdmin && (
        <div className="animate-fade-up" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={settingsSaving}
            style={{ opacity: settingsSaving ? 0.6 : 1, padding: '0.65rem 1.5rem' }}
            onClick={handleSaveOrgSettings}
          >
            {settingsSaving ? t('common.saving') : 'Guardar configuracion de organizacion'}
          </button>
          {settingsSaved && (
            <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>
              {t('settings.org.saved')}
            </span>
          )}
        </div>
      )}

      {/* ─── Profile Section ─── */}
      <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <h2 style={sectionTitleStyle}>{t('settings.profile.title')}</h2>
        <p style={sectionDescStyle}>{t('settings.profile.subtitle')}</p>

        <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.profile.email')}</label>
              <input className="input" type="email" value={user?.email || ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.role')}</label>
              <input className="input" type="text" value={user?.role ? getRoleLabel(user.role) : ''} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('settings.profile.firstName')}</label>
              <input className="input" type="text" placeholder={t('settings.profile.firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.lastName')}</label>
              <input className="input" type="text" placeholder={t('settings.profile.lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t('settings.profile.position')}</label>
            <input className="input" type="text" placeholder={t('settings.profile.positionPlaceholder')} value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={updateUser.isPending} style={{ opacity: updateUser.isPending ? 0.6 : 1 }}>
              {updateUser.isPending ? t('common.saving') : t('common.save')}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>{t('settings.profile.saved')}</span>}
            {updateUser.isError && !saved && <span style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>{t('settings.profile.saveError')}</span>}
          </div>
        </form>
      </div>

      {/* ─── Password Section ─── */}
      <div className="card animate-fade-up-delay-1" style={{ padding: '1.75rem' }}>
        <h2 style={sectionTitleStyle}>{t('settings.security.title')}</h2>
        <p style={sectionDescStyle}>{t('settings.security.subtitle')}</p>

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>{t('settings.security.currentPassword')}</label>
            <input className="input" type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>{t('settings.security.newPassword')}</label>
            <input className="input" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={!currentPassword || !newPassword} style={{ opacity: !currentPassword || !newPassword ? 0.5 : 1 }}>
              {t('settings.security.changePassword')}
            </button>
            {passwordSaved && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>{t('settings.security.passwordSaved')}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
