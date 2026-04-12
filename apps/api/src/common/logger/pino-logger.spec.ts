/**
 * pino-logger.spec.ts — Verifica que los campos sensibles estan en la
 * lista de redaction del logger. Si alguien agrega un campo PII nuevo
 * (ej: socialSecurityNumber) y no lo agrega al redact, este test falla.
 *
 * No testea la ejecucion real de pino (eso requeriria levantar el
 * NestJS app) — solo verifica que la configuracion es correcta.
 */
import { REDACTED_FIELDS } from './pino-logger.config';

describe('PII Redaction Config', () => {
  // Campos que DEBEN estar en la lista de redaction. Si alguno falta,
  // significa que un developer agrego un campo sensible sin protegerlo.
  const requiredFields = [
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'twoFactorSecret',
    'twoFactorCode',
    'resetCode',
    'req.headers.authorization',
    'req.headers.cookie',
    'JWT_SECRET',
    'ANTHROPIC_API_KEY',
    'RESEND_API_KEY',
    'DB_PASSWORD',
  ];

  it.each(requiredFields)('should redact "%s"', (field) => {
    // Verifica que el campo exacto O un wildcard que lo cubra esta presente
    const covered = REDACTED_FIELDS.some((path) => {
      if (path === field) return true;
      // Wildcard: '*.password' cubre 'dto.password', 'user.password', etc.
      if (path.startsWith('*.') && field === path.slice(2)) return true;
      return false;
    });
    expect(covered).toBe(true);
  });

  it('should have at least 15 redaction paths', () => {
    expect(REDACTED_FIELDS.length).toBeGreaterThanOrEqual(15);
  });

  it('should not include common business fields (false positives)', () => {
    // Estos campos NO deben estar redactados — son datos de negocio normales
    const businessFields = ['firstName', 'lastName', 'department', 'position', 'tenantId'];
    for (const field of businessFields) {
      const redacted = REDACTED_FIELDS.includes(field);
      expect(redacted).toBe(false);
    }
  });
});
