'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '@/hooks/useUsers';
import { useMySubscription } from '@/hooks/useSubscription';
import { formatRut, formatRutInput } from '@/lib/rut';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import GdprTenantTab from '@/components/GdprTenantTab';
import PasswordPolicyForm from '@/components/PasswordPolicyForm';
import SsoConfigForm from '@/components/SsoConfigForm';

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: '0.4rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

type SettingsTab = 'organizacion' | 'notificaciones' | 'feedback' | 'privacidad' | 'seguridad';

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
  const { data: sub } = useMySubscription();
  const isTenantAdmin = user?.role === 'tenant_admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const orgName = sub?.tenant?.name || '';
  const orgRut = sub?.tenant?.rut ? formatRut(sub.tenant.rut) : '';

  const token = useAuthStore((s) => s.token);
  const [tenantSettings, setTenantSettings] = useState<Record<string, any>>({});
  const [tenantName, setTenantName] = useState('');
  const [tenantRut, setTenantRut] = useState('');

  // Profile fields removed — now in /dashboard/perfil

  const [tenantTimezone, setTenantTimezone] = useState('');
  const [tenantSessionTimeout, setTenantSessionTimeout] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [commercialAddress, setCommercialAddress] = useState('');
  const [industry, setIndustry] = useState('');
  const [employeeRange, setEmployeeRange] = useState('');
  const [legalRepName, setLegalRepName] = useState('');
  const [legalRepRut, setLegalRepRut] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
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
  // Feedback config
  const [fbScope, setFbScope] = useState('all');
  const [fbAllowAnonymous, setFbAllowAnonymous] = useState(true);
  const [fbMinLength, setFbMinLength] = useState(20);
  const [fbAllowPeer, setFbAllowPeer] = useState(true);
  const [fbRequireCompetency, setFbRequireCompetency] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('organizacion');

  // Profile useEffect removed — now in /dashboard/perfil

  useEffect(() => {
    if (!token || !isTenantAdmin) return;
    api.tenants.me(token)
      .then((t: any) => {
        setTenantName(t.name || '');
        setTenantRut(t.rut ? formatRut(t.rut) : '');
        setCommercialAddress(t.commercialAddress || '');
        setIndustry(t.industry || '');
        setEmployeeRange(t.employeeRange || '');
        setLegalRepName(t.legalRepName || '');
        setLegalRepRut(t.legalRepRut ? formatRut(t.legalRepRut) : '');
        const s = t.settings || {};
        setTenantSettings(s);
        setTenantTimezone(s.timezone || '');
        setTenantSessionTimeout(s.sessionTimeoutMinutes?.toString() || '');
        setLogoUrl(s.logoUrl || '');
        setPrimaryColor(s.primaryColor || '');
        setDateFormat(s.dateFormat || '');
        setDefaultLanguage(s.defaultLanguage || '');
        setEmailFrom(s.emailFrom || '');
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
        // Load feedback config
        const fc = s.feedbackConfig || {};
        setFbScope(fc.scope || 'all');
        setFbAllowAnonymous(fc.allowAnonymous !== false);
        setFbMinLength(fc.minMessageLength || 20);
        setFbAllowPeer(fc.allowPeerFeedback !== false);
        setFbRequireCompetency(fc.requireCompetency === true);
      })
      .catch(() => {});
  }, [token, isTenantAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // handleLanguageChange removed — now in /dashboard/perfil

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
        industry: industry || null,
        employeeRange: employeeRange || null,
        legalRepName: legalRepName || null,
        legalRepRut: legalRepRut || null,
        emailFrom: emailFrom || null,
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
        feedbackConfig: {
          scope: fbScope,
          allowAnonymous: fbAllowAnonymous,
          minMessageLength: fbMinLength,
          allowPeerFeedback: fbAllowPeer,
          requireCompetency: fbRequireCompetency,
        },
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {}
    setSettingsSaving(false);
  };

  // handleSaveProfile + handleChangePassword removed — now in /dashboard/perfil

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = isSuperAdmin
    ? [
        { id: 'organizacion', label: t('settings.tabs.platform'), icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
      ]
    : [
        { id: 'organizacion', label: t('settings.tabs.organization'), icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
        { id: 'notificaciones', label: t('settings.tabs.notifications'), icon: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0' },
        { id: 'feedback', label: t('settings.tabs.feedback'), icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
        { id: 'privacidad', label: 'Privacidad y datos', icon: 'M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z' },
        { id: 'seguridad', label: 'Seguridad', icon: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z' },
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
      {/* TAB: Plataforma (super_admin)                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'organizacion' && isSuperAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.5rem', borderLeft: '3px solid var(--accent)' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.platform.title')}</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.platform.platformName')}</label>
                <input className="input" type="text" value="Eva360" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.version')}</label>
                <input className="input" type="text" value="2.6.0" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.environment')}</label>
                <input className="input" type="text" value={t('settings.platform.environmentValue')} disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.domain')}</label>
                <input className="input" type="text" value={typeof window !== 'undefined' ? window.location.hostname : ''} disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.platform.aiTitle')}</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.platform.aiProvider')}</label>
                <input className="input" type="text" value="Anthropic (Claude)" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.aiModel')}</label>
                <input className="input" type="text" value="claude-haiku-4-5" disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              {t('settings.platform.aiNote')}
            </p>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.platform.emailTitle')}</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.platform.emailProvider')}</label>
                <input className="input" type="text" value="Resend" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.emailSender')}</label>
                <input className="input" type="text" value="Eva360 <onboarding@resend.dev>" disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              {t('settings.platform.emailNote')}
            </p>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.platform.dbTitle')}</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>{t('settings.platform.dbEngine')}</label>
                <input className="input" type="text" value="PostgreSQL 16" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.platform.multiTenant')}</label>
                <input className="input" type="text" value={t('settings.platform.multiTenantValue')} disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.platform.securityTitle')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>{t('settings.platform.securityAuth')}</span><strong>{t('settings.platform.securityAuthValue')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>{t('settings.platform.securitySignatures')}</span><strong>{t('settings.platform.securitySignaturesValue')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>{t('settings.platform.securityEncryption')}</span><strong>{t('settings.platform.securityEncryptionValue')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>{t('settings.platform.securitySsl')}</span><strong>{t('settings.platform.securitySslValue')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                <span>{t('settings.platform.securityAudit')}</span><strong>{t('settings.platform.securityAuditValue')}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Organización (tenant_admin only)                               */}
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
                <input className="input" type="text" value={tenantRut || orgRut || t('settings.company.notRegistered')} readOnly style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.company.industry')}</label>
                <input className="input" type="text" placeholder={t('settings.company.industryPlaceholder')} value={industry} onChange={(e) => setIndustry(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>{t('settings.company.employeeRange')}</label>
                <input className="input" type="text" placeholder={t('settings.company.employeeRangePlaceholder')} value={employeeRange} onChange={(e) => setEmployeeRange(e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t('settings.company.commercialAddress')}</label>
                <input className="input" type="text" placeholder={t('settings.company.commercialAddressPlaceholder')}
                  value={commercialAddress} onChange={(e) => setCommercialAddress(e.target.value)} />
              </div>
            </div>

            {/* Legal representative */}
            <div style={{ marginTop: '1.25rem' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('settings.company.legalRep')}</h3>
              <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>{t('settings.company.legalRepFullName')}</label>
                  <input className="input" type="text" placeholder={t('settings.company.legalRepFullNamePlaceholder')} maxLength={200}
                    value={legalRepName} onChange={(e) => setLegalRepName(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>{t('settings.company.legalRepRut')}</label>
                  <input className="input" type="text" placeholder={t('settings.company.legalRepRutPlaceholder')} maxLength={12}
                    value={legalRepRut} onChange={(e) => setLegalRepRut(formatRutInput(e.target.value))} />
                </div>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {t('settings.company.legalRepNote')}
              </p>
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
              {t('settings.branding.title')}
            </h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t('settings.branding.companyLogo')}</label>
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
                      {t('settings.branding.uploadImage')}
                      <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 500_000) { alert(t('settings.branding.logoMaxSize')); return; }
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
                        {t('settings.branding.removeLogo')}
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  {t('settings.branding.logoNote')}
                </p>
              </div>
              <div>
                <label style={labelStyle}>{t('settings.branding.defaultLanguage')}</label>
                <select className="input" value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value)}>
                  <option value="">{t('settings.branding.langUserPreference')}</option>
                  <option value="es">{t('settings.branding.langEs')}</option>
                  <option value="en">{t('settings.branding.langEn')}</option>
                  <option value="pt">{t('settings.branding.langPt')}</option>
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
                  <option value="60">{t('settings.org.sessionHour')}</option>
                  <option value="120">{t('settings.org.sessionHours')}</option>
                  <option value="480">{t('settings.org.session8Hours')}</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('settings.org.dateFormat')}</label>
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
              {settingsSaving ? t('common.saving') : t('common.save')}
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
              {t('settings.notifications.title')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              {t('settings.notifications.subtitle')}
            </p>

            {/* Master toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1rem', background: emailNotifications ? 'rgba(201,147,58,0.06)' : 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm, 6px)', border: `1px solid ${emailNotifications ? 'rgba(201,147,58,0.2)' : 'var(--border)'}`,
              marginBottom: '0.75rem',
            }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('settings.notifications.masterToggle')}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('settings.notifications.masterToggleDesc')}</div>
              </div>
              <Toggle value={emailNotifications} onChange={() => setEmailNotifications(!emailNotifications)} />
            </div>

            {/* Category toggles */}
            {emailNotifications && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {[
                  { label: t('settings.notifications.evaluations'), desc: t('settings.notifications.evaluationsDesc'), value: notifEvaluations, setter: setNotifEvaluations },
                  { label: t('settings.notifications.feedback'), desc: t('settings.notifications.feedbackDesc'), value: notifFeedback, setter: setNotifFeedback },
                  { label: t('settings.notifications.objectives'), desc: t('settings.notifications.objectivesDesc'), value: notifObjectives, setter: setNotifObjectives },
                  { label: t('settings.notifications.development'), desc: t('settings.notifications.developmentDesc'), value: notifDevelopment, setter: setNotifDevelopment },
                  { label: t('settings.notifications.recognitions'), desc: t('settings.notifications.recognitionsDesc'), value: notifRecognitions, setter: setNotifRecognitions },
                  { label: t('settings.notifications.contracts'), desc: t('settings.notifications.contractsDesc'), value: notifContracts, setter: setNotifContracts },
                  { label: t('settings.notifications.surveys'), desc: t('settings.notifications.surveysDesc'), value: notifSurveys, setter: setNotifSurveys },
                  { label: t('settings.notifications.ai'), desc: t('settings.notifications.aiDesc'), value: notifAi, setter: setNotifAi },
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
              {t('settings.notifications.systemNote')}
            </p>
          </div>

          {/* Email FROM configuration */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {t('settings.notifications.senderTitle')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              {t('settings.notifications.senderSubtitle')}
            </p>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                {t('settings.notifications.senderLabel')}
              </label>
              <input className="input" type="email" placeholder={t('settings.notifications.senderPlaceholder')}
                value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)}
                style={{ width: '100%', maxWidth: '400px' }} />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {t('settings.notifications.senderNote')}
              </p>
            </div>
            {emailFrom && (
              <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                {t('settings.notifications.senderPreview')} <strong>{emailFrom}</strong>
              </div>
            )}

            {/* Resend configuration guide */}
            <div style={{ padding: '1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <p style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--accent)' }}>
                {'📧'} Cómo configurar tu dominio en Resend
              </p>
              <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <li>Ingresa a <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>resend.com/domains</a> con la cuenta del sistema.</li>
                <li>Haz clic en <strong>Add Domain</strong> e ingresa tu dominio (ej: <code>tuempresa.cl</code>).</li>
                <li>Resend te mostrará <strong>registros DNS</strong> que debes agregar en tu proveedor de dominio:
                  <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1rem' }}>
                    <li><strong>MX</strong> — para recibir respuestas</li>
                    <li><strong>TXT (SPF)</strong> — autoriza a Resend a enviar en tu nombre</li>
                    <li><strong>CNAME (DKIM)</strong> — firma criptográfica de autenticidad</li>
                  </ul>
                </li>
                <li>Agrega los registros en el panel DNS de tu proveedor (ej: Hostinger, GoDaddy, Cloudflare).</li>
                <li>Espera la <strong>verificación</strong> (puede tardar 5 min a 48 horas según el proveedor DNS).</li>
                <li>Una vez verificado, ingresa aquí el email con tu dominio: <code>notificaciones@tuempresa.cl</code></li>
              </ol>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Si no configuras un dominio propio, los emails se envían desde el remitente por defecto del sistema (onboarding@resend.dev) y pueden llegar a spam.
              </p>
            </div>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button type="button" className="btn-primary" disabled={settingsSaving}
              style={{ opacity: settingsSaving ? 0.6 : 1, padding: '0.6rem 1.5rem' }}
              onClick={handleSaveOrgSettings}>
              {settingsSaving ? t('common.saving') : t('common.save')}
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
      {/* TAB: Retroalimentación (tenant_admin only)                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'feedback' && isTenantAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {t('settings.feedbackConfig.title')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              {t('settings.feedbackConfig.subtitle')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Scope */}
              <div>
                <label style={labelStyle}>{t('settings.feedbackConfig.scopeLabel')}</label>
                <select className="input" value={fbScope} onChange={(e) => setFbScope(e.target.value)} style={{ maxWidth: '350px' }}>
                  <option value="all">{t('settings.feedbackConfig.scopeAll')}</option>
                  <option value="department">{t('settings.feedbackConfig.scopeDepartment')}</option>
                  <option value="team">{t('settings.feedbackConfig.scopeTeam')}</option>
                </select>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {t('settings.feedbackConfig.scopeNote')}
                </p>
              </div>

              {/* Allow anonymous */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t('settings.feedbackConfig.allowAnonymous')}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('settings.feedbackConfig.allowAnonymousDesc')}</div>
                </div>
                <Toggle value={fbAllowAnonymous} onChange={() => setFbAllowAnonymous(!fbAllowAnonymous)} />
              </div>

              {/* Allow peer feedback */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t('settings.feedbackConfig.allowPeer')}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('settings.feedbackConfig.allowPeerDesc')}</div>
                </div>
                <Toggle value={fbAllowPeer} onChange={() => setFbAllowPeer(!fbAllowPeer)} />
              </div>

              {/* Require competency */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t('settings.feedbackConfig.requireCompetency')}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('settings.feedbackConfig.requireCompetencyDesc')}</div>
                </div>
                <Toggle value={fbRequireCompetency} onChange={() => setFbRequireCompetency(!fbRequireCompetency)} />
              </div>

              {/* Min message length */}
              <div>
                <label style={labelStyle}>{t('settings.feedbackConfig.minLength')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input className="input" type="number" min={10} max={500} value={fbMinLength}
                    onChange={(e) => setFbMinLength(Math.max(10, Math.min(500, parseInt(e.target.value) || 20)))}
                    style={{ maxWidth: '100px' }} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('settings.feedbackConfig.minLengthUnit')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button type="button" className="btn-primary" disabled={settingsSaving}
              style={{ opacity: settingsSaving ? 0.6 : 1, padding: '0.6rem 1.5rem' }}
              onClick={handleSaveOrgSettings}>
              {settingsSaving ? t('common.saving') : t('common.save')}
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
      {/* TAB: Privacidad y datos (tenant_admin) — GDPR tenant export + audit  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'privacidad' && isTenantAdmin && (
        <div className="animate-fade-up">
          <GdprTenantTab />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Seguridad (tenant_admin) — password policy                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'seguridad' && isTenantAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <PasswordPolicyForm
            tenantSettings={tenantSettings}
            onSaved={() => {
              // Refetch the tenant settings so the form reflects what the
              // server persisted (post-clamp). Replacement-style refetch:
              // we don't have a queryClient here because the page uses
              // manual fetch via api.tenants.*. A simple reload works.
              window.location.reload();
            }}
          />
          <SsoConfigForm />
        </div>
      )}

    </div>
  );
}
