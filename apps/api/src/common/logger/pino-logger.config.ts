/**
 * pino-logger.config.ts — Configuracion centralizada del logger estructurado.
 *
 * Caracteristicas clave:
 * - Formato JSON en produccion (indexable por jq, Grafana, Loki, etc.)
 * - Pretty print en desarrollo (colores + timestamps legibles)
 * - Request-ID auto-generado por request via nestjs-pino, accesible en
 *   cualquier servicio via AsyncLocalStorage SIN tener que pasarlo manual
 * - Enriquecimiento automatico del log con tenantId + userId cuando existen
 *   en el req.user (Passport JWT)
 * - Redact de campos sensibles (passwords, tokens, cookies) para cumplir
 *   con GDPR/SOC2 y evitar que credenciales queden en logs de produccion
 * - Logs de request exitosos solo en nivel `info` (no `debug`) para que
 *   el volumen sea manejable. Errores 5xx van como `error`.
 *
 * Uso en servicios:
 *   constructor(@InjectPinoLogger(MyService.name) private logger: PinoLogger) {}
 *   this.logger.info({ userId, action: 'foo' }, 'Did something');
 *
 * O mas simple, usando el Logger de Nest (que ahora es Pino bajo el capo):
 *   private readonly logger = new Logger(MyService.name);
 *   this.logger.log('Did something');
 */
import type { Params } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Campos a redactar en el output. Pino usa un path-based redact con soporte
 * de wildcards. Cualquier log que contenga uno de estos paths sera
 * reemplazado por "[REDACTED]".
 *
 * La lista es deliberadamente agresiva: prefiero perder un log util por
 * accidente a dejar un token en produccion.
 */
const REDACT_PATHS = [
  // Passwords en cualquier nivel
  'password', '*.password', '*.*.password',
  'passwordHash', '*.passwordHash', '*.*.passwordHash',
  'currentPassword', '*.currentPassword',
  'newPassword', '*.newPassword',
  // Tokens JWT y similares
  'token', '*.token', '*.*.token',
  'accessToken', '*.accessToken',
  'refreshToken', '*.refreshToken',
  'authToken', '*.authToken',
  // 2FA
  'twoFactorSecret', '*.twoFactorSecret',
  'twoFactorCode', '*.twoFactorCode',
  // Reset codes
  'resetCode', '*.resetCode',
  'passwordResetCode', '*.passwordResetCode',
  'passwordResetToken', '*.passwordResetToken',
  // HTTP headers que leakean credenciales
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  // API keys de servicios externos
  'apiKey', '*.apiKey',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'JWT_SECRET',
  'DB_PASSWORD',
];

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

/** Config object para LoggerModule.forRoot(). */
export const pinoLoggerConfig: Params = {
  pinoHttp: {
    level: logLevel,

    // Request-ID: si el cliente manda `x-request-id`, lo respetamos
    // (util para correlacionar con logs del frontend). Si no, generamos
    // uno propio.
    genReqId: (req: any) => {
      const existing = req.headers['x-request-id'] || req.headers['x-correlation-id'];
      return (typeof existing === 'string' && existing.length > 0 && existing.length < 100)
        ? existing
        : randomUUID();
    },

    // El logger custom: en prod devolvemos JSON puro (sin transports);
    // en dev usamos pino-pretty para legibilidad humana.
    transport: isProduction ? undefined : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,req,res',
        singleLine: false,
      },
    },

    // Redact agresivo para nunca leakear credenciales.
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
      // `remove: true` borraria el campo entero; preferimos dejar el
      // placeholder para poder detectar en review que el redact funciona.
      remove: false,
    },

    // Enriquecer cada log con contexto del request (tenantId, userId,
    // role) que Passport inyecta en req.user. Se ejecuta una vez por
    // request y se propaga a TODOS los logs hijos via AsyncLocalStorage.
    customProps: (req: any) => {
      const user = req.user; // Passport JWT guard lo setea
      if (!user) return {};
      return {
        tenantId: user.tenantId || undefined,
        userId: user.userId || user.id || undefined,
        role: user.role || undefined,
      };
    },

    // Nivel custom por status code — responses 5xx siempre como error,
    // 4xx como warn, resto como info. Esto ayuda a que Sentry/alertas
    // se disparen solo con errores genuinos del servidor.
    customLogLevel: (_req: Request, res: Response, err?: Error) => {
      if (err) return 'error';
      const status = res.statusCode;
      if (status >= 500) return 'error';
      if (status >= 400) return 'warn';
      if (status >= 300) return 'info';
      return 'info';
    },

    // Mensaje legible para cada request completado.
    customSuccessMessage: (req: Request, res: Response) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },

    customErrorMessage: (req: Request, res: Response, err: Error) => {
      return `${req.method} ${req.url} ${res.statusCode} — ${err.message}`;
    },

    // Serializers minimalistas para que req/res no spameen los logs
    // con metadata irrelevante (headers enteros, cookies, etc.).
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          // userAgent es util para debug de mobile vs web, pero es largo
          userAgent: req.headers?.['user-agent'],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },

    // NO loguear requests a health checks — ruido puro.
    autoLogging: {
      ignore: (req: any) => {
        const url = req.url || '';
        return url.startsWith('/health') || url === '/favicon.ico';
      },
    },
  },
};

/** Exportamos los paths de redact para los tests — asi podemos verificar
 *  en un test que cualquier log futuro con `password` o `token` queda
 *  redactado, evitando regresiones. */
export const REDACTED_FIELDS = REDACT_PATHS;
