/**
 * Session tokens — HMAC-SHA256 signed, stored in HTTP-only cookie.
 * Uses Web Crypto API so it works in both Node and Edge runtimes (middleware).
 *
 * Format: base64url(JSON_payload) + '.' + base64url(HMAC_SHA256(JSON_payload, secret))
 * Payload: { sub, name, role, exp }   (exp in ms since epoch)
 */
import type { UserRole } from './users';

export interface SessionPayload {
  sub: string;    // user id
  name: string;
  role: UserRole;
  exp: number;    // ms since epoch
}

export const SESSION_COOKIE = 'ec_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function b64urlEncode(buf: ArrayBuffer | string): string {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function signSession(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string,
  ttlMs = SESSION_TTL_MS,
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Date.now() + ttlMs };
  const json = JSON.stringify(full);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(json));
  return `${b64urlEncode(json)}.${b64urlEncode(sig)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;
  try {
    const jsonBytes = b64urlDecode(payloadB64);
    const json = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;

    const key = await hmacKey(secret);
    const sigBytes = b64urlDecode(sigB64);
    // TS 5.x strict-typing of Uint8Array<ArrayBufferLike> doesn't match
    // BufferSource expectations on some platforms (SharedArrayBuffer concern).
    // Cast through BufferSource — the underlying buffer is always a real ArrayBuffer in our code path.
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as unknown as BufferSource,
      jsonBytes as unknown as BufferSource,
    );
    if (!valid) return null;
    return payload;
  } catch {
    return null;
  }
}
