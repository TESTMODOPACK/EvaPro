import { sanitizeUser, SENSITIVE_USER_FIELDS } from './sanitize-user';

describe('sanitizeUser (B1-10)', () => {
  const fullUser = {
    id: 'u1',
    email: 'a@b.cl',
    firstName: 'Ana',
    role: 'employee',
    twoFactorEnabled: true,
    passwordHash: '$2b$12$hash',
    twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    resetCode: '123456',
    resetCodeExpires: new Date(),
    signatureOtp: '654321',
    signatureOtpExpires: new Date(),
    tokenVersion: 4,
    failedLoginAttempts: 2,
    lockedUntil: new Date(),
  };

  it('elimina TODOS los campos sensibles', () => {
    const out = sanitizeUser(fullUser) as Record<string, unknown>;
    for (const f of SENSITIVE_USER_FIELDS) {
      expect(out[f]).toBeUndefined();
    }
  });

  it('conserva los campos no sensibles (incl. twoFactorEnabled boolean)', () => {
    const out = sanitizeUser(fullUser)!;
    expect(out.id).toBe('u1');
    expect(out.email).toBe('a@b.cl');
    expect(out.firstName).toBe('Ana');
    expect(out.role).toBe('employee');
    expect(out.twoFactorEnabled).toBe(true);
  });

  it('no muta el objeto original (entidades que luego se persisten)', () => {
    const original = { ...fullUser };
    sanitizeUser(fullUser);
    expect(fullUser).toEqual(original);
    expect(fullUser.passwordHash).toBe('$2b$12$hash');
  });

  it('es null-safe', () => {
    expect(sanitizeUser(null)).toBeNull();
    expect(sanitizeUser(undefined)).toBeUndefined();
  });
});
