'use client';

/**
 * Toast que aparece cuando hay una nueva versión del SW esperando activarse.
 * User clickea "Actualizar" → SW toma control → la página recarga.
 *
 * Recibe `updateAvailable` y `applyUpdate` como props para NO registrar un
 * segundo SW — el registro lo hace ServiceWorkerRegister una sola vez.
 *
 * Decisión UX: toast persistente (no auto-dismiss) porque el usuario DEBE
 * decidir recargar — forzarlo sería destruir estado sin aviso.
 */
export function UpdateAvailableToast({
  updateAvailable,
  applyUpdate,
}: {
  updateAvailable: boolean;
  applyUpdate: () => void;
}) {
  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(80px + env(safe-area-inset-bottom, 0))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 40px)',
        maxWidth: 360,
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-strong, rgba(201,147,58,0.3))',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
        Nueva versión disponible
      </div>
      <button
        onClick={applyUpdate}
        className="btn-primary"
        style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem', minHeight: 36 }}
      >
        Actualizar
      </button>
    </div>
  );
}

export default UpdateAvailableToast;
