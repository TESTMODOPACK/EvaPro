'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useToastStore } from '@/store/toast.store';

interface DeviceRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * NotificationSettingsCard — UI completa para gestionar push en /perfil.
 *
 * Estados que maneja:
 *   - Browser no soporta → mensaje + alternativa (email).
 *   - Permiso denegado → instrucciones para habilitar desde browser.
 *   - No suscrito → botón "Activar".
 *   - Suscrito → lista de devices + botón "Desactivar en este".
 *   - Dev-only: botón "Enviar notificación de prueba".
 */
export function NotificationSettingsCard() {
  const token = useAuthStore((s) => s.token);
  const { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe, refresh } = usePushNotifications();
  const toastSuccess = useToastStore((s) => s.success);
  const toastError = useToastStore((s) => s.error);
  const toastInfo = useToastStore((s) => s.info);

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const isDev = process.env.NODE_ENV !== 'production';

  // Cargar lista de devices cuando el user está suscrito.
  useEffect(() => {
    if (!token || !isSubscribed) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    setLoadingDevices(true);
    api.push
      .listDevices(token)
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDevices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, isSubscribed]);

  const handleToggle = async () => {
    if (isSubscribed) {
      const res = await unsubscribe();
      if (res.ok) {
        toastSuccess('Notificaciones desactivadas en este dispositivo');
      } else {
        toastError('No se pudo desactivar: ' + (res.error || ''));
      }
    } else {
      const res = await subscribe();
      if (res.ok) {
        toastSuccess('Notificaciones activadas en este dispositivo');
      } else if (res.error === 'denied') {
        toastError('Permiso denegado. Habilítalo desde la configuración del navegador.');
      } else if (res.error === 'no-support') {
        toastError('Tu navegador no soporta notificaciones push.');
      } else {
        toastError('No se pudieron activar: ' + (res.error || ''));
      }
    }
  };

  const handleTest = async () => {
    if (!token) return;
    try {
      const res = await api.push.test(token);
      if (res.sent > 0) {
        toastSuccess(`Push de prueba enviado a ${res.sent} dispositivo(s)`);
      } else if (res.skipped > 0) {
        toastInfo('Notificación skippeada (preferencias/quiet hours)');
      } else {
        toastError('Push falló en todos los dispositivos');
      }
    } catch (err: any) {
      toastError(err?.message || 'Error al enviar prueba');
    }
  };

  // ─── Variantes por estado ───

  if (!isSupported) {
    return (
      <Card borderColor="var(--warning)">
        <h3 style={headerStyle}>Notificaciones push</h3>
        <p style={bodyStyle}>
          Tu navegador no soporta notificaciones push. Puedes actualizar a Chrome, Firefox, Edge
          o Safari 16.4+ (en iPhone solo funciona si instalas EVA360 en la pantalla de inicio).
        </p>
      </Card>
    );
  }

  if (permission === 'denied') {
    return (
      <Card borderColor="var(--danger)">
        <h3 style={headerStyle}>Notificaciones bloqueadas</h3>
        <p style={bodyStyle}>
          Dijiste "Bloquear" antes. Para activarlas:
        </p>
        <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Haz clic en el ícono de candado junto a la URL</li>
          <li>Cambia "Notificaciones" a "Permitir"</li>
          <li>Recarga esta página</li>
        </ol>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={headerStyle}>Notificaciones push</h3>
          <p style={bodyStyle}>
            Recibe alertas de evaluaciones, check-ins, objetivos y reconocimientos aunque EVA360 esté cerrado.
            {isSubscribed && ' Tu dispositivo actual está activo.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className={isSubscribed ? 'btn-ghost' : 'btn-primary'}
            onClick={handleToggle}
            disabled={isLoading}
            style={{ fontSize: '0.85rem', minHeight: 40 }}
          >
            {isLoading ? '...' : isSubscribed ? 'Desactivar en este dispositivo' : 'Activar notificaciones'}
          </button>
          {isDev && isSubscribed && (
            <button
              className="btn-ghost"
              onClick={handleTest}
              disabled={isLoading}
              style={{ fontSize: '0.82rem', minHeight: 40 }}
              title="Solo disponible en desarrollo"
            >
              Enviar prueba
            </button>
          )}
        </div>
      </div>

      {isSubscribed && devices.length > 0 && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dispositivos registrados ({devices.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {devices.map((d) => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.78rem',
                  background: 'var(--bg-hover)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatUserAgent(d.userAgent)}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                  {d.lastUsedAt ? `Último uso: ${new Date(d.lastUsedAt).toLocaleDateString('es-CL')}` : 'Nunca usado'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {loadingDevices && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Cargando dispositivos…
        </div>
      )}
    </Card>
  );
}

// ─── Helpers de estilo ────────────────────────────────────────────

const headerStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  marginBottom: '0.35rem',
  color: 'var(--text-primary)',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--text-muted)',
  lineHeight: 1.55,
  margin: '0 0 0.5rem',
};

function Card({ children, borderColor }: { children: React.ReactNode; borderColor?: string }) {
  return (
    <div
      className="card"
      style={{
        padding: '1.25rem',
        borderLeft: borderColor ? `3px solid ${borderColor}` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Normaliza un user agent a algo legible: "Chrome en Android" etc.
 * Si no se puede parsear, devuelve los primeros 50 chars.
 */
function formatUserAgent(ua: string | null): string {
  if (!ua) return 'Dispositivo desconocido';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isMac = /Macintosh/.test(ua);
  const isWindows = /Windows/.test(ua);
  const isLinux = /Linux/.test(ua) && !isAndroid;

  let browser = 'Navegador';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  let os = '';
  if (isIOS) os = 'iOS';
  else if (isAndroid) os = 'Android';
  else if (isMac) os = 'Mac';
  else if (isWindows) os = 'Windows';
  else if (isLinux) os = 'Linux';

  return os ? `${browser} en ${os}` : browser;
}

export default NotificationSettingsCard;
