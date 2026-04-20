import { useTranslation } from 'react-i18next';

export interface RoleConfig {
  label: string;
  color: string;
  badge: string;
}

export const ROLE_CONFIG: Record<string, RoleConfig> = {
  super_admin:  { label: 'Super Admin',           color: '#ef4444', badge: 'badge-danger' },
  tenant_admin: { label: 'Encargado del Sistema',  color: '#6366f1', badge: 'badge-accent' },
  manager:      { label: 'Encargado de Equipo',    color: '#f59e0b', badge: 'badge-warning' },
  employee:     { label: 'Colaborador',             color: '#10b981', badge: 'badge-success' },
  external:     { label: 'Asesor Externo',          color: '#64748b', badge: 'badge-ghost' },
};

export function getRoleLabel(role: string): string {
  return ROLE_CONFIG[role]?.label || role;
}

export function getRoleBadge(role: string): string {
  return ROLE_CONFIG[role]?.badge || 'badge-accent';
}

export function getRoleColor(role: string): string {
  return ROLE_CONFIG[role]?.color || '#64748b';
}

/** Roles that can appear in the create/edit user form */
export const ASSIGNABLE_ROLES = [
  { value: 'tenant_admin', label: 'Encargado del Sistema' },
  { value: 'manager',      label: 'Encargado de Equipo' },
  { value: 'employee',     label: 'Colaborador' },
  { value: 'external',     label: 'Asesor Externo' },
];

/** Sidebar visibility rules per page path */
export const SIDEBAR_ACCESS: Record<string, string[]> = {
  // Super admin pages (system administration)
  '/dashboard':              ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
  '/dashboard/tenants':      ['super_admin'],
  '/dashboard/audit-log':    ['super_admin'],
  '/dashboard/system-metrics': ['super_admin'],
  '/dashboard/subscriptions': ['super_admin'],
  '/dashboard/facturacion':   ['super_admin'],
  // Tenant user pages (not for super_admin)
  '/dashboard/evaluaciones': ['tenant_admin', 'manager', 'employee', 'external'],
  // P6 — manager ve solo sus reportes directos (backend filtra por managerId).
  '/dashboard/usuarios':     ['tenant_admin', 'manager'],
  '/dashboard/reportes':     ['tenant_admin', 'manager'],
  '/dashboard/analytics':    ['tenant_admin', 'manager'],
  '/dashboard/informes':     ['tenant_admin', 'manager'],
  '/dashboard/plantillas':   ['tenant_admin'],
  '/dashboard/objetivos':    ['tenant_admin', 'manager', 'employee'],
  '/dashboard/feedback':     ['tenant_admin', 'manager', 'employee'],
  '/dashboard/mi-suscripcion': ['tenant_admin'],
  '/dashboard/talento':      ['tenant_admin', 'manager'],
  '/dashboard/calibracion':  ['tenant_admin'],
  '/dashboard/desarrollo':   ['tenant_admin', 'manager', 'employee'],
  '/dashboard/desarrollo-organizacional': ['tenant_admin'],
  '/dashboard/postulantes':   ['tenant_admin', 'manager'],
  '/dashboard/competencias':  ['tenant_admin'],
  '/dashboard/mantenedores':  ['tenant_admin'],
  '/dashboard/insights':       ['tenant_admin', 'manager'],
  '/dashboard/notificaciones': ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
  '/dashboard/mi-desempeno': ['tenant_admin', 'manager', 'employee'],
  '/dashboard/perfil':       ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
  '/dashboard/ajustes':      ['super_admin', 'tenant_admin'],
  '/dashboard/reconocimientos': ['tenant_admin', 'manager', 'employee'],
  '/dashboard/dei':          ['tenant_admin'],
  '/dashboard/onboarding':   ['tenant_admin', 'manager', 'employee'],
  '/dashboard/encuestas-clima': ['tenant_admin', 'manager', 'employee'],
  '/dashboard/ejecutivo':    ['tenant_admin'],
  '/dashboard/solicitudes':  ['super_admin', 'tenant_admin'],
  '/dashboard/auditoria':    ['super_admin', 'tenant_admin'],
  '/dashboard/analytics-pdi': ['tenant_admin', 'manager'],
  '/dashboard/analytics-uso': ['super_admin', 'tenant_admin'],
  '/dashboard/analytics-ciclos': ['tenant_admin', 'manager'],
  '/dashboard/analytics-rotacion': ['tenant_admin'],
  '/dashboard/firmas': ['tenant_admin', 'manager', 'employee'],
  '/dashboard/contratos': ['super_admin', 'tenant_admin'],
  '/dashboard/organigrama': ['super_admin', 'tenant_admin', 'manager'],
  '/dashboard/analisis-integrado': ['tenant_admin'],
  // Pipeline de leads pre-venta (solo super_admin de Ascenda)
  '/dashboard/leads': ['super_admin'],
};

// ─── i18n-aware hooks ─────────────────────────────────────────────────────────

export function useRoleLabel(role: string): string {
  const { t } = useTranslation();
  return t(`roles.${role}`, { defaultValue: ROLE_CONFIG[role]?.label || role });
}

export function useAssignableRoles() {
  const { t } = useTranslation();
  return ASSIGNABLE_ROLES.map((r) => ({
    ...r,
    label: t(`roles.${r.value}`, { defaultValue: r.label }),
  }));
}

export function canAccessPage(role: string, path: string): boolean {
  // Anchor links (submenu parents like #reportes) are always accessible
  if (path.startsWith('#')) return true;

  // Exact match
  const exact = SIDEBAR_ACCESS[path];
  if (exact) return exact.includes(role);

  // Prefix match for dynamic sub-routes (e.g. /dashboard/evaluaciones/uuid/responder/uuid)
  // Exclude '/dashboard' itself from prefix matching to avoid it matching everything
  const prefix = Object.keys(SIDEBAR_ACCESS).find(
    (k) => k !== '/dashboard' && path.startsWith(k + '/'),
  );
  if (prefix) return SIDEBAR_ACCESS[prefix].includes(role);

  // Unknown path: deny by default (security-first; new pages must be listed explicitly)
  return false;
}
