/**
 * Campos del entity `User` que NUNCA deben salir de la base como texto
 * plano hacia el cliente ni a un export. Fuente única de verdad para
 * /users/me, /users/:id, GET /users y el export GDPR (B1-10).
 */
export const SENSITIVE_USER_FIELDS = [
  'passwordHash',
  'twoFactorSecret',
  'resetCode',
  'resetCodeExpires',
  'signatureOtp',
  'signatureOtpExpires',
  'tokenVersion',
  'failedLoginAttempts',
  'lockedUntil',
] as const;

/**
 * Devuelve una copia superficial del usuario sin los campos sensibles.
 * Null-safe: si recibe falsy lo retorna tal cual. No muta el original
 * (no afecta entidades que luego se persisten con save()).
 */
export function sanitizeUser<T extends Record<string, any>>(
  user: T | null | undefined,
): T | null | undefined {
  if (!user) return user;
  const clone: Record<string, any> = { ...user };
  for (const field of SENSITIVE_USER_FIELDS) {
    delete clone[field];
  }
  return clone as T;
}
