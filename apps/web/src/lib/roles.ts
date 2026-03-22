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
  '/dashboard':              ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
  '/dashboard/evaluaciones': ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
  '/dashboard/usuarios':     ['super_admin', 'tenant_admin', 'manager'],
  '/dashboard/tenants':      ['super_admin'],
  '/dashboard/reportes':     ['super_admin', 'tenant_admin', 'manager', 'external'],
  '/dashboard/analytics':    ['super_admin', 'tenant_admin', 'manager', 'external'],
  '/dashboard/plantillas':   ['super_admin', 'tenant_admin'],
  '/dashboard/objetivos':    ['super_admin', 'tenant_admin', 'manager', 'employee'],
  '/dashboard/feedback':     ['super_admin', 'tenant_admin', 'manager', 'employee'],
  '/dashboard/ajustes':      ['super_admin', 'tenant_admin', 'manager', 'employee', 'external'],
};

export function canAccessPage(role: string, path: string): boolean {
  const allowed = SIDEBAR_ACCESS[path];
  if (!allowed) return true; // pages not listed are open
  return allowed.includes(role);
}
