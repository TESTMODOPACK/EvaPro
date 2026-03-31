'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { canAccessPage } from '@/lib/roles';
import { formatRut } from '@/lib/rut';
import { useMySubscription } from '@/hooks/useSubscription';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// ─── Icon components ─────────────────────────────────────────────────────

const icons = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  myPerformance: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  evaluations: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  calibration: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  reports: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  talent: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  development: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22V8" /><path d="M5 12H2a10 10 0 0 0 20 0h-3" /><path d="M8 5.2C9.2 3.8 10.5 3 12 3c1.5 0 2.8.8 4 2.2" /><path d="M12 8a4.5 4.5 0 0 0-4.5 4.5" /><path d="M12 8a4.5 4.5 0 0 1 4.5 4.5" />
    </svg>
  ),
  orgDevelopment: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="6" height="6" rx="1"/>
      <rect x="16" y="3" width="6" height="6" rx="1"/>
      <rect x="9" y="15" width="6" height="6" rx="1"/>
      <line x1="5" y1="9" x2="5" y2="12"/><line x1="19" y1="9" x2="19" y2="12"/>
      <line x1="5" y1="12" x2="12" y2="12"/><line x1="19" y1="12" x2="12" y2="12"/>
      <line x1="12" y1="12" x2="12" y2="15"/>
    </svg>
  ),
  objectives: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  ),
  feedback: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  templates: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  ),
  competencies: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  subscription: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  log: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
};

// ─── Nav sections are built inside the component to support i18n ─────────

// ─── Section label style ──────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  color: 'rgba(201,147,58,0.5)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '0 0.5rem',
  marginBottom: '0.35rem',
  marginTop: '0.75rem',
};

// ─── Component ───────────────────────────────────────────────────────────

export default function Sidebar({ currentPath, isOpen, onToggle }: { currentPath: string; isOpen?: boolean; onToggle?: () => void }) {
  const { user } = useAuthStore();
  const { data: sub, isError: orgError, refetch: refetchSub } = useMySubscription();
  const orgInfo = sub?.tenant ? { name: sub.tenant.name, rut: sub.tenant.rut || null } : null;
  const { t } = useTranslation();

  const isAdmin = user?.role === 'tenant_admin';
  const isManager = user?.role === 'manager';
  const isAdminOrManager = isAdmin || isManager;

  const tenantNavSections: NavSection[] = [
    // ─── Mi Espacio (todos los roles) ───────────────────────────
    {
      title: t('nav.mySpace'),
      items: [
        { href: '/dashboard', label: t('nav.dashboard'), icon: icons.dashboard },
        { href: '/dashboard/mi-desempeno', label: t('nav.myPerformance'), icon: icons.myPerformance },
        { href: '/dashboard/notificaciones', label: t('nav.notifications'), icon: '🔔' },
      ],
    },
    // ─── Desempeño (evaluaciones, reportes, analytics) ──────────
    {
      title: t('nav.evaluation'),
      items: [
        { href: '/dashboard/evaluaciones', label: t('nav.evalCycles'), icon: icons.evaluations },
        ...(isAdminOrManager ? [
          { href: '/dashboard/calibracion', label: t('nav.calibration'), icon: icons.calibration },
          { href: '/dashboard/reportes', label: t('nav.reports'), icon: icons.reports },
          { href: '/dashboard/informes', label: t('nav.informes'), icon: icons.reports },
          { href: '/dashboard/analytics', label: t('nav.analytics'), icon: icons.analytics },
          { href: '/dashboard/insights', label: t('nav.aiInsights'), icon: '🤖' },
        ] : []),
      ],
    },
    // ─── Gestión de Talento ─────────────────────────────────────
    {
      title: t('nav.talentDev'),
      items: [
        ...(isAdminOrManager ? [
          { href: '/dashboard/talento', label: t('nav.talentMap'), icon: icons.talent },
        ] : []),
        { href: '/dashboard/desarrollo', label: t('nav.devPlans'), icon: icons.development },
        ...(isAdminOrManager ? [
          { href: '/dashboard/desarrollo-organizacional', label: t('nav.orgDev'), icon: icons.orgDevelopment },
          { href: '/dashboard/postulantes', label: t('nav.applicants'), icon: icons.users },
        ] : []),
      ],
    },
    // ─── Gestión Continua (OKRs, feedback, reconocimiento) ─────
    {
      title: t('nav.continuous'),
      items: [
        { href: '/dashboard/objetivos', label: t('nav.objectives'), icon: icons.objectives },
        { href: '/dashboard/feedback', label: t('nav.feedback'), icon: icons.feedback },
        { href: '/dashboard/reconocimientos', label: t('nav.recognitions'), icon: '⭐' },
      ],
    },
    // ─── Personas y Diversidad (admin/manager) ─────────────────
    ...(isAdminOrManager ? [{
      title: t('nav.people'),
      items: [
        { href: '/dashboard/dei', label: t('nav.dei'), icon: '🌍' },
        ...(isAdmin ? [
          { href: '/dashboard/usuarios', label: t('nav.users'), icon: icons.users },
        ] : []),
      ],
    }] : []),
    // ─── Configuración (admin) ─────────────────────────────────
    ...(isAdmin ? [{
      title: t('nav.config'),
      items: [
        { href: '/dashboard/plantillas', label: t('nav.templates'), icon: icons.templates },
        { href: '/dashboard/competencias', label: t('nav.competencies'), icon: icons.competencies },
        { href: '/dashboard/mantenedores', label: t('nav.customData'), icon: icons.settings },
        { href: '/dashboard/mi-suscripcion', label: t('nav.subscription'), icon: icons.subscription },
        { href: '/dashboard/solicitudes', label: t('nav.requests'), icon: '📋' },
        { href: '/dashboard/ajustes', label: t('nav.settings'), icon: icons.settings },
      ],
    }] : [
      // Non-admin: solo ajustes y suscripción
      {
        title: t('nav.config'),
        items: [
          { href: '/dashboard/ajustes', label: t('nav.settings'), icon: icons.settings },
          { href: '/dashboard/mi-suscripcion', label: t('nav.subscription'), icon: icons.subscription },
        ],
      },
    ]),
  ];

  const superAdminSections: NavSection[] = [
    {
      title: t('nav.admin'),
      items: [
        { href: '/dashboard', label: t('nav.systemPanel'), icon: icons.dashboard },
        { href: '/dashboard/tenants', label: t('nav.organizations'), icon: icons.home },
        { href: '/dashboard/subscriptions', label: t('nav.subscriptions'), icon: icons.subscription },
        { href: '/dashboard/audit-log', label: t('nav.systemLog'), icon: icons.log },
        { href: '/dashboard/system-metrics', label: t('nav.usageMetrics'), icon: icons.analytics },
        { href: '/dashboard/solicitudes', label: t('nav.requests'), icon: '📋' },
      ],
    },
  ];

  const sections = user?.role === 'super_admin' ? superAdminSections : tenantNavSections;

  return (
    <>
    {/* Mobile overlay */}
    {isOpen && (
      <div
        className="sidebar-overlay"
        onClick={onToggle}
        style={{ display: 'none', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90 }}
      />
    )}
    <aside className={`sidebar-desktop${isOpen ? ' sidebar-open' : ''}`} style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: '260px',
      background: '#1a1206',
      borderRight: '1px solid rgba(201,147,58,0.15)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100,
    }}>
      {/* Sidebar header — Ascenda bars icon */}
      <div style={{ padding: '1.25rem 1.25rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
            {[6, 9, 12, 15, 18, 21, 24].map((h, i) => (
              <div key={i} style={{
                width: '3px', height: `${h}px`, borderRadius: '1px',
                background: 'linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 100%)',
                opacity: 0.4 + i * 0.09,
              }} />
            ))}
          </div>
          <span style={{
            fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.02em',
            background: 'linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Ascenda
          </span>
        </div>
      </div>

      {/* Organization info */}
      {user?.role !== 'super_admin' && orgError && !orgInfo && (
        <div
          style={{ padding: '0.5rem 1.25rem', borderBottom: '1px solid rgba(201,147,58,0.15)', fontSize: '0.72rem', color: 'rgba(245,228,168,0.5)', cursor: 'pointer' }}
          onClick={() => refetchSub()}
        >
          No se cargó la info de la org. Click para reintentar
        </div>
      )}
      {user?.role !== 'super_admin' && orgInfo && (
        <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid rgba(201,147,58,0.15)', background: 'rgba(201,147,58,0.08)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#F5E4A8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {orgInfo.name}
          </div>
          {orgInfo.rut && (
            <div style={{ fontSize: '0.68rem', color: 'rgba(245,228,168,0.5)', fontWeight: 500, fontFamily: 'monospace' }}>
              RUT: {formatRut(orgInfo.rut)}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.125rem', overflowY: 'auto' }}>
        {sections.map((section, sIdx) => {
          const visibleItems = section.items.filter((item) =>
            canAccessPage(user?.role || '', item.href),
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title}>
              <div style={{ ...sectionLabelStyle, ...(sIdx === 0 ? { marginTop: '0.5rem' } : {}) }}>
                {section.title}
              </div>
              {visibleItems.map((item) => {
                const isActive = currentPath === item.href || (item.href !== '/dashboard' && currentPath.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-link${isActive ? ' active' : ''}`}
                  >
                    <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: typeof item.icon === 'string' ? '1rem' : undefined }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User info moved to TopBar component */}
    </aside>
    </>
  );
}
