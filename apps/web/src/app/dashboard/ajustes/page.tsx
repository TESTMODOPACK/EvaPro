'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '@/hooks/useUsers';
import { useMySubscription } from '@/hooks/useSubscription';
import { formatRut, formatRutInput } from '@/lib/rut';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: '0.4rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

type SettingsTab = 'organizacion' | 'notificaciones' | 'feedback';

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
        { id: 'organizacion', label: 'Plataforma', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
      ]
    : [
        { id: 'organizacion', label: 'Organizacion', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
        { id: 'notificaciones', label: 'Notificaciones', icon: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0' },
        { id: 'feedback', label: 'Retroalimentacion', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
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
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Configuracion General de la Plataforma</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Nombre de la plataforma</label>
                <input className="input" type="text" value="Eva360" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Version</label>
                <input className="input" type="text" value="2.6.0" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Entorno</label>
                <input className="input" type="text" value="Produccion" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Dominio</label>
                <input className="input" type="text" value={typeof window !== 'undefined' ? window.location.hostname : ''} disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Configuracion de IA</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Proveedor IA</label>
                <input className="input" type="text" value="Anthropic (Claude)" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Modelo predeterminado</label>
                <input className="input" type="text" value="claude-haiku-4-5" disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              La clave API de Anthropic se configura en las variables de entorno del servidor (ANTHROPIC_API_KEY). Los creditos IA por organizacion se gestionan desde la seccion Suscripciones.
            </p>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Email y Notificaciones</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Proveedor email</label>
                <input className="input" type="text" value="Resend" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Email remitente</label>
                <input className="input" type="text" value="Eva360 <onboarding@resend.dev>" disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Las credenciales de email se configuran en variables de entorno del servidor (RESEND_API_KEY, EMAIL_FROM).
            </p>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Base de Datos</h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Motor</label>
                <input className="input" type="text" value="PostgreSQL 16" disabled style={{ opacity: 0.7 }} />
              </div>
              <div>
                <label style={labelStyle}>Modelo multi-tenant</label>
                <input className="input" type="text" value="Schema compartido (row-level)" disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Seguridad</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>Autenticacion</span><strong>JWT (Bearer Token)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>Firmas digitales</span><strong>OTP por email + SHA-256</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>Encriptacion passwords</span><strong>bcrypt (10 rounds)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span>SSL/TLS</span><strong>Let{"'"}s Encrypt (auto-renewal)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                <span>Registro de auditoria</span><strong>Habilitado (todas las acciones)</strong>
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
                <input className="input" type="text" value={tenantRut || orgRut || 'No registrado'} readOnly style={{ opacity: 0.7, cursor: 'not-allowed', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={labelStyle}>Industria</label>
                <input className="input" type="text" placeholder="Ej: Tecnología, Retail, Servicios..." value={industry} onChange={(e) => setIndustry(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Rango de colaboradores</label>
                <input className="input" type="text" placeholder="Ej: 1-15, 16-50, 51-200" value={employeeRange} onChange={(e) => setEmployeeRange(e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección comercial</label>
                <input className="input" type="text" placeholder="Ej: Av. Providencia 1234, Santiago"
                  value={commercialAddress} onChange={(e) => setCommercialAddress(e.target.value)} />
              </div>
            </div>

            {/* Legal representative */}
            <div style={{ marginTop: '1.25rem' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>Representante Legal</h3>
              <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Nombres y Apellidos</label>
                  <input className="input" type="text" placeholder="Ej: Juan Pérez González" maxLength={200}
                    value={legalRepName} onChange={(e) => setLegalRepName(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>RUT</label>
                  <input className="input" type="text" placeholder="Ej: 12.345.678-9" maxLength={12}
                    value={legalRepRut} onChange={(e) => setLegalRepRut(formatRutInput(e.target.value))} />
                </div>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Datos del representante legal para efectos de contratos y documentos formales.
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
              Marca e identidad
            </h2>
            <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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

          {/* Email FROM configuration */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Remitente de emails
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Dirección de email corporativo desde la cual se enviarán las notificaciones de tu organización. Debe ser un dominio verificado en el proveedor de email.
            </p>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Email corporativo (FROM)
              </label>
              <input className="input" type="email" placeholder="Ej: notificaciones@miempresa.cl"
                value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)}
                style={{ width: '100%', maxWidth: '400px' }} />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Si no se configura, se usa el remitente por defecto del sistema. El dominio debe estar verificado en Resend para que los emails lleguen correctamente.
              </p>
            </div>
            {emailFrom && (
              <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Los emails se enviarán desde: <strong>{emailFrom}</strong>
              </div>
            )}
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
      {/* TAB: Retroalimentación (tenant_admin only)                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'feedback' && isTenantAdmin && (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Configuración de Retroalimentación
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              Define las reglas del módulo de feedback rápido para tu organización.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Scope */}
              <div>
                <label style={labelStyle}>Alcance de envío</label>
                <select className="input" value={fbScope} onChange={(e) => setFbScope(e.target.value)} style={{ maxWidth: '350px' }}>
                  <option value="all">Toda la organización — cualquiera puede enviar a cualquiera</option>
                  <option value="department">Solo mismo departamento — feedback entre compañeros de área</option>
                  <option value="team">Equipo directo + departamento — jefatura, reportes y compañeros</option>
                </select>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Los administradores siempre pueden enviar a cualquier colaborador independiente de esta configuración.
                </p>
              </div>

              {/* Allow anonymous */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Permitir feedback anónimo</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Los colaboradores pueden ocultar su nombre al enviar feedback.</div>
                </div>
                <Toggle value={fbAllowAnonymous} onChange={() => setFbAllowAnonymous(!fbAllowAnonymous)} />
              </div>

              {/* Allow peer feedback */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Permitir feedback entre pares</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Colaboradores del mismo nivel jerárquico pueden enviarse feedback mutuamente.</div>
                </div>
                <Toggle value={fbAllowPeer} onChange={() => setFbAllowPeer(!fbAllowPeer)} />
              </div>

              {/* Require competency */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Requerir competencia</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Obligar a seleccionar una competencia del catálogo al enviar feedback.</div>
                </div>
                <Toggle value={fbRequireCompetency} onChange={() => setFbRequireCompetency(!fbRequireCompetency)} />
              </div>

              {/* Min message length */}
              <div>
                <label style={labelStyle}>Largo mínimo del mensaje</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input className="input" type="number" min={10} max={500} value={fbMinLength}
                    onChange={(e) => setFbMinLength(Math.max(10, Math.min(500, parseInt(e.target.value) || 20)))}
                    style={{ maxWidth: '100px' }} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>caracteres (mínimo 10, máximo 500)</span>
                </div>
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

    </div>
  );
}
