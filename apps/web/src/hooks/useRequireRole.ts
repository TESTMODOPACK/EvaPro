'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

/**
 * useRequireRole — guard defensivo para páginas restringidas por rol.
 *
 * El backend ya rechaza accesos no autorizados (via RolesGuard +
 * @Roles decorator), pero sin este guard frontend la página carga,
 * hace requests, el API devuelve 403 y la UI queda con errores feos
 * o spinners indefinidos.
 *
 * ── Retorno ──────────────────────────────────────────────────────
 * Retorna `authorized: boolean` para que el caller pueda bloquear
 * el render del contenido sensible hasta confirmar el rol. Sin esto,
 * los `useEffect` que disparan API calls (que dependen sólo del
 * token, no del user) se ejecutan ANTES de que el redirect tome
 * efecto — generan requests 403 innecesarias.
 *
 * ── Uso correcto ─────────────────────────────────────────────────
 *   export default function SuperAdminOnlyPage() {
 *     const authorized = useRequireRole(['super_admin']);
 *     // ...resto de hooks aquí (react-hooks rule)...
 *     const { data } = useQuery(...);
 *
 *     // Bloquear render hasta autorizar — evita que los useEffect
 *     // con API calls se ejecuten para usuarios no autorizados.
 *     if (!authorized) return null;
 *
 *     return <AdminContent data={data} />;
 *   }
 *
 * ── Estado del auth store ────────────────────────────────────────
 * El hook espera `_hasHydrated=true` antes de validar. Sin esto, en
 * el primer render el user aparece null (aunque la sesión sea
 * válida) y los componentes hijos podrían disparar requests antes
 * del redirect.
 *
 * Nota: este hook NO reemplaza al backend — es UX defensivo. El
 * backend debe seguir aplicando RolesGuard en todos los endpoints
 * sensibles.
 */
export function useRequireRole(
  allowedRoles: string[],
  redirectTo: string = '/dashboard',
): boolean {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const router = useRouter();

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user) return;
    if (!allowedRoles.includes(user.role)) {
      router.replace(redirectTo);
    }
    // allowedRoles es array — estabilizamos la dep con join(',').
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasHydrated, router, redirectTo, allowedRoles.join(',')]);

  // Derivado síncrono — se evalúa en cada render. Permite al caller
  // hacer early return antes de renderizar contenido sensible.
  return hasHydrated && !!user && allowedRoles.includes(user.role);
}

export default useRequireRole;
