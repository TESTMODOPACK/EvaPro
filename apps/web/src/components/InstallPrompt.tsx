'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'eva360_install_dismissed_at';
const DISMISS_COOLDOWN_DAYS = 7;

/**
 * BeforeInstallPromptEvent (Chromium-only, no está en TS libs).
 * Firma mínima que usamos aquí.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * InstallPrompt — card flotante que invita a instalar EVA360 como PWA.
 *
 * Comportamientos:
 *   - Android/Chrome/Edge: usa el evento nativo `beforeinstallprompt` y
 *     muestra un botón "Instalar" que dispara el prompt del browser.
 *   - iOS Safari: como iOS no expone el evento, mostramos hint manual
 *     con instrucciones ("Compartir → Agregar a pantalla de inicio").
 *   - Si el usuario dismisea, no volvemos a mostrar por 7 días (localStorage).
 *   - Si la app YA está instalada (standalone mode), no mostramos nada.
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Skip si ya está instalada (standalone).
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS:
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Skip si dismisó recientemente.
    const dismissedAtStr = localStorage.getItem(DISMISS_KEY);
    if (dismissedAtStr) {
      const days = (Date.now() - parseInt(dismissedAtStr, 10)) / (1000 * 60 * 60 * 24);
      if (days < DISMISS_COOLDOWN_DAYS) {
        setDismissed(true);
        return;
      }
    }

    // Android/Chrome: evento nativo.
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari: detectar user agent + mostrar hint después de 8s
    // (dar tiempo al usuario a engagear con la app primero).
    //
    // iPadOS 13+ reporta UA como "Macintosh" (desktop-class), así que
    // incluimos un check por touch support + plataforma Mac para
    // detectar iPads modernos que de otro modo se nos escapan.
    const ua = navigator.userAgent;
    const isIOSClassic = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isIPadOS13Plus =
      /Macintosh/.test(ua) &&
      typeof document !== 'undefined' &&
      'ontouchend' in document &&
      (navigator.maxTouchPoints || 0) > 1;
    const isIOS = isIOSClassic || isIPadOS13Plus;
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIOS && isSafari) {
      timer = setTimeout(() => setShowIOSHint(true), 8000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setDismissed(true);
    setInstallEvent(null);
    setShowIOSHint(false);
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === 'accepted') {
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
      }
    } catch (err) {
      console.warn('[Install] prompt failed:', err);
    }
    setInstallEvent(null);
  };

  if (dismissed) return null;
  if (!installEvent && !showIOSHint) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="install-prompt-title"
      style={{
        position: 'fixed',
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 40px)',
        maxWidth: 480,
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--accent, #C9933A)',
        borderRadius: 12,
        padding: '0.85rem 1rem',
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <img
        src="/icons/icon-96.png"
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          id="install-prompt-title"
          style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2, color: 'var(--text-primary)' }}
        >
          Instala EVA360
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {showIOSHint
            ? 'Toca Compartir y luego "Agregar a pantalla de inicio"'
            : 'Accede más rápido desde tu pantalla de inicio'}
        </div>
      </div>
      {installEvent && (
        <button
          className="btn-primary"
          onClick={install}
          style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem', minHeight: 36 }}
        >
          Instalar
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Cerrar"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '1.25rem',
          lineHeight: 1,
          padding: '0.4rem',
          minHeight: 36,
          minWidth: 36,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

export default InstallPrompt;
