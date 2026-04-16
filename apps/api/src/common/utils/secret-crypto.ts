/**
 * Application-level AES-256-GCM envelope encryption for secrets we must
 * store (SSO client_secret is the first consumer).
 *
 * Why not pgcrypto: a DB dump made with `pg_dump` would still contain the
 * ciphertext — but without the KEY (kept in `SSO_SECRET_KEY` env var,
 * outside the backup), the ciphertext is useless. A pg_dump that DOES
 * include plaintext-wrapping key material is a far higher-risk artifact.
 *
 * Key rotation: re-encrypting all rows is a one-off migration script. We
 * do NOT attempt key rotation on the fly.
 *
 * Output format: `v1.<ivBase64url>.<authTagBase64url>.<cipherBase64url>`.
 * The `v1` prefix leaves room for future algorithm changes.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;          // GCM recommended
const TAG_LEN = 16;         // GCM auth tag
const KEY_HEX_LEN = 64;     // 32 bytes

let cachedKey: Buffer | null = null;

/** Load the key once; fail loudly on any misconfiguration. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.SSO_SECRET_KEY;
  if (!hex) {
    throw new Error(
      'SSO_SECRET_KEY env var is required for SSO. Generate with: openssl rand -hex 32',
    );
  }
  if (hex.length !== KEY_HEX_LEN) {
    throw new Error(
      `SSO_SECRET_KEY must be exactly ${KEY_HEX_LEN} hex chars (32 bytes). Got ${hex.length}.`,
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(hex, 'hex');
  } catch {
    throw new Error('SSO_SECRET_KEY is not valid hex');
  }
  if (buf.length !== 32) throw new Error('SSO_SECRET_KEY must decode to 32 bytes');
  cachedKey = buf;
  return buf;
}

/** Is the encryption key configured? Modules use this to gate feature availability. */
export function isSecretCryptoAvailable(): boolean {
  const hex = process.env.SSO_SECRET_KEY;
  return !!(hex && hex.length === KEY_HEX_LEN);
}

function toB64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Buffer {
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4 !== 0) pad += '=';
  return Buffer.from(pad, 'base64');
}

/**
 * Encrypt a plaintext string. Throws if key is missing — callers should gate
 * with `isSecretCryptoAvailable()` to give a friendlier error in the UI.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${toB64Url(iv)}.${toB64Url(tag)}.${toB64Url(enc)}`;
}

export class SecretDecryptError extends Error {
  constructor(public readonly reason: string) {
    super(`Secret decryption failed: ${reason}`);
    this.name = 'SecretDecryptError';
  }
}

export function decryptSecret(envelope: string): string {
  if (!envelope || typeof envelope !== 'string') {
    throw new SecretDecryptError('empty envelope');
  }
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new SecretDecryptError('unsupported envelope version');
  }
  const iv = fromB64Url(parts[1]);
  const tag = fromB64Url(parts[2]);
  const enc = fromB64Url(parts[3]);
  if (iv.length !== IV_LEN) throw new SecretDecryptError('bad iv length');
  if (tag.length !== TAG_LEN) throw new SecretDecryptError('bad tag length');
  try {
    const decipher = createDecipheriv(ALG, getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (err: any) {
    // Most common causes: corrupted ciphertext, wrong key (rotation without
    // migration). Either way, don't leak the node error message — it can
    // include partial buffer bytes.
    throw new SecretDecryptError('invalid ciphertext or wrong key');
  }
}
