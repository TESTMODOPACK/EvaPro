'use client';

import { RefObject, useEffect } from 'react';

/**
 * useFocusTrap — atrapa el foco del teclado dentro de un contenedor
 * mientras esté activo (típicamente un modal/dialog).
 *
 * Cuando el modal abre:
 *   1. Guarda el elemento con foco actual (trigger).
 *   2. Mueve el foco al primer elemento focuseable del contenedor.
 *   3. Tab → cicla entre elementos focuseables internos.
 *   4. Shift+Tab → cicla en reverso.
 *
 * Cuando el modal cierra:
 *   - Restaura el foco al trigger original, si aún existe en DOM.
 *
 * Implementación sin dependencia externa (evita agregar focus-trap-react
 * por ~12 kB). Suficiente para modales simples. Si necesitamos más
 * control (portales anidados, iframes), migrar a focus-trap-react.
 *
 * Uso:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open);   // open = estado del modal
 *   <div ref={ref} role="dialog" ...>
 *
 * Nota: el contenedor no necesita `tabIndex={-1}`; el hook maneja el foco
 * inicial directamente en el primer elemento focuseable.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Guardar trigger para restaurar al cerrar.
    const previousActive = document.activeElement as HTMLElement | null;

    // Selector de elementos focuseables estándar HTML/ARIA.
    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusable = () => {
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('data-focus-trap-ignore') && el.offsetParent !== null,
      );
    };

    // Mover foco al primer elemento focuseable (o al contenedor si está vacío).
    const focusables = getFocusable();
    const initial = focusables[0] ?? container;
    // Permitir foco programático en container si no es focuseable naturalmente.
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    initial.focus({ preventScroll: true });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = getFocusable();
      if (list.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else {
        if (current === last || !container.contains(current)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('keydown', handleKey);
      // Restaurar foco al trigger solo si aún está en DOM.
      if (previousActive && document.body.contains(previousActive)) {
        previousActive.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef]);
}

export default useFocusTrap;
