'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

/**
 * Fase 5 / Tarea 5.2 — Defense-in-depth de roles en frontend.
 *
 * Pre-fix: las paginas billing (`/dashboard/facturacion`, `/mi-suscripcion`,
 * `/dashboard/subscriptions`) se confiaban 100% en la proteccion del
 * middleware Next + JWT del backend. Si el middleware fallaba en un
 * deploy o el JWT carga roles erroneos, un user con rol equivocado
 * podia ver el render parcial antes del fetch fallar.
 *
 * Post-fix: cada pagina sensible llama useRequireRole(allowedRoles).
 * Si el rol no matchea, redirect inmediato a `/dashboard` (o a una
 * pagina segura). No bloquea hydration — los efectos se ejecutan
 * post-mount, pero el componente puede leer `isReady` para decidir
 * si renderizar.
 *
 * Reglas de negocio:
 *   - Si user no esta cargado (auth aun hidratando), `isReady=false`
 *     y no redirect (espera).
 *   - Si user.role NO esta en allowedRoles, redirect a redirectTo
 *     (default `/dashboard`).
 *   - Acepta `string | string[]` para multi-rol (e.g. ['tenant_admin',
 *     'super_admin']).
 */
export function useRequireRole(
  allowedRoles: string | string[],
  options: { redirectTo?: string } = {},
): { isReady: boolean; isAllowed: boolean; role: string | null } {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  const role = user?.role ?? null;
  const isReady = hasHydrated && user !== null;
  const isAllowed = !!role && roles.includes(role);

  useEffect(() => {
    if (!isReady) return; // aun hidratando, esperar.
    if (!isAllowed) {
      // Log defensivo — si esto se dispara con frecuencia, hay un bug
      // en routing o auth.
      // eslint-disable-next-line no-console
      console.warn(
        `[useRequireRole] role=${role} no autorizado para ${roles.join(',')}; redirigiendo.`,
      );
      router.replace(options.redirectTo ?? '/dashboard');
    }
  }, [isReady, isAllowed, role, options.redirectTo, router, roles]);

  return { isReady, isAllowed, role };
}
