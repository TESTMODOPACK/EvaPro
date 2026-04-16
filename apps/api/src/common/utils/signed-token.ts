/**
 * HMAC-signed stateless tokens.
 *
 * Used for public "action" links embedded in transactional emails (unsubscribe,
 * GDPR download, etc.) where we need to identify the user WITHOUT requiring
 * them to log in. The token carries the claim set, is signed with the app's
 * JWT_SECRET, and is validated on each request — no DB lookup needed.
 *
 * Why NOT reuse the existing auth JWT:
 *  - Auth JWTs have a short TTL (30 min) and carry session state.
 *  - Action links must survive weeks/months embedded in old emails.
 *  - We want a different `purpose` field so an auth token can never be used
 *    as an unsubscribe link (and vice versa) even by accident.
 *
 * Security notes:
 *  - Uses Node's built-in `crypto.createHmac` — no external dependency.
 *  - base64url encoding (not base64) to be URL-safe.
 *  - Constant-time comparison (`timingSafeEqual`) to avoid timing attacks.
 *  - `exp` is UNIX seconds, same convention as JWT.
 *  - If JWT_SECRET rotates, all outstanding tokens become invalid — acceptable
 *    for unsubscribe (users can click the link from any newer email).
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface SignedTokenBase {
  /** User UUID the token is issued for. */
  uid: string;
  /** Tenant UUID (null for super_admin or system). */
  tid: string | null;
  /** Schema version — bump if payload shape changes incompatibly. */
  v: number;
  /** Issued-at (UNIX seconds). */
  iat: number;
  /** Expiration (UNIX seconds). */
  exp: number;
  /** Guards against cross-purpose reuse. */
  purpose: string;
}

export type SignedTokenPayload<Extras = Record<string, never>> = SignedTokenBase & Extras;

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Buffer {
  // Restore standard base64 padding.
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64');
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    // Fail loud — we never want to sign with a weak secret.
    throw new Error('JWT_SECRET must be set (>=16 chars) to sign stateless tokens.');
  }
  return secret;
}

/**
 * Sign a payload. `purpose` is mandatory and gets embedded in the token, so
 * `verifyToken(..., 'unsubscribe')` rejects tokens minted for other purposes.
 *
 * @param payload  Extra claims to carry (e.g. `{ uid, tid }`). The base fields
 *                 `v`, `iat`, `exp`, `purpose` are added automatically.
 * @param purpose  Short stable string. Use a constant exported from the caller.
 * @param ttlSeconds  How long the token is valid. Common: 180 days for
 *                 unsubscribe, 7 days for download links, 30 min for codes.
 */
export function signToken(
  payload: { uid: string; tid: string | null } & Record<string, unknown>,
  purpose: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SignedTokenBase & Record<string, unknown> = {
    ...payload,
    v: 1,
    iat: now,
    exp: now + ttlSeconds,
    purpose,
  };

  const headerJson = JSON.stringify(full);
  const encodedPayload = base64urlEncode(Buffer.from(headerJson, 'utf8'));
  const sig = createHmac('sha256', getSecret()).update(encodedPayload).digest();
  const encodedSig = base64urlEncode(sig);
  return `${encodedPayload}.${encodedSig}`;
}

export class InvalidSignedTokenError extends Error {
  constructor(public readonly reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_purpose' | 'unsupported_version') {
    super(`Invalid signed token: ${reason}`);
    this.name = 'InvalidSignedTokenError';
  }
}

/**
 * Verify a token and return its payload.
 *
 * Throws `InvalidSignedTokenError` on any failure. The reason is in `.reason`
 * so the controller can log it but MUST NOT expose it to the client (to avoid
 * leaking info to scanners). The public response should always be a generic
 * 401 "Enlace inválido o expirado".
 */
export function verifyToken<Extras = Record<string, never>>(
  token: string,
  expectedPurpose: string,
): SignedTokenPayload<Extras> {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new InvalidSignedTokenError('malformed');
  }
  const parts = token.split('.');
  if (parts.length !== 2) throw new InvalidSignedTokenError('malformed');
  const [encodedPayload, encodedSig] = parts;

  // Recompute signature and compare in constant time.
  const expectedSig = createHmac('sha256', getSecret()).update(encodedPayload).digest();
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(encodedSig);
  } catch {
    throw new InvalidSignedTokenError('malformed');
  }
  if (providedSig.length !== expectedSig.length) {
    throw new InvalidSignedTokenError('bad_signature');
  }
  if (!timingSafeEqual(providedSig, expectedSig)) {
    throw new InvalidSignedTokenError('bad_signature');
  }

  let parsed: SignedTokenPayload<Extras>;
  try {
    const json = base64urlDecode(encodedPayload).toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidSignedTokenError('malformed');
  }

  if (parsed.v !== 1) throw new InvalidSignedTokenError('unsupported_version');
  if (parsed.purpose !== expectedPurpose) throw new InvalidSignedTokenError('wrong_purpose');

  const now = Math.floor(Date.now() / 1000);
  if (typeof parsed.exp !== 'number' || parsed.exp < now) {
    throw new InvalidSignedTokenError('expired');
  }
  return parsed;
}
