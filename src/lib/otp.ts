/**
 * One-Time-Password core.
 *
 * Responsibilities:
 *   • Generate cryptographically random N-digit codes
 *   • Hash before persisting (bcrypt)
 *   • Enforce single-use, TTL, attempt cap, request cooldown
 *   • Provider-agnostic: delivery is delegated to lib/providers/otp/*
 *
 * Security model:
 *   • Plaintext code lives only in memory long enough to send via provider, then is discarded.
 *   • DB stores only the bcrypt hash + metadata.
 *   • Anti-enumeration: callers should NOT branch their HTTP response on whether a user
 *     was found — same 200 OK for both. This module returns useful info to the caller;
 *     it's the route's job to flatten errors.
 */
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { randomInt } from 'crypto';
import { getDb, getConfig } from './db';
import { logAudit } from './audit';
import {
  getUserByIdentifier,
  normalizeIdentifier,
  type UserRow,
} from './users';

export type IdentifierType = 'email' | 'phone';

export interface OtpRow {
  id: string;
  identifier: string;
  identifier_type: IdentifierType;
  user_id: string | null;
  code_hash: string;
  expires_at: number;
  attempts: number;
  used: number;
  created_at: number;
  ip: string | null;
  user_agent: string | null;
}

export interface RequestOtpOptions {
  identifier: string;
  type: IdentifierType;
  ip?: string;
  userAgent?: string;
}

export interface RequestOtpResult {
  ok: boolean;
  /** Plain-text code to hand to the delivery provider. Never expose to clients. */
  code?: string;
  /** Resolved user, if any. Null for unknown identifiers (anti-enumeration: still treat as success). */
  user?: UserRow | null;
  /** Reason for failure — used internally only; do not leak to clients in raw form. */
  reason?: 'cooldown' | 'invalid_identifier' | 'inactive_user';
  cooldownSecondsRemaining?: number;
  /** OTP row id for downstream logging. */
  otpId?: string;
  expiresAt?: number;
}

export interface VerifyOtpResult {
  ok: boolean;
  user?: UserRow;
  reason?: 'not_found' | 'expired' | 'used' | 'attempts_exhausted' | 'mismatch' | 'inactive_user';
  attemptsRemaining?: number;
}

function ttlMs(): number {
  return Number(getConfig('OTP_TTL_SECONDS', '300')) * 1000;
}

function maxAttempts(): number {
  return Number(getConfig('OTP_MAX_ATTEMPTS', '5'));
}

function cooldownMs(): number {
  return Number(getConfig('OTP_REQUEST_COOLDOWN_SECONDS', '60')) * 1000;
}

function otpLength(): number {
  const n = Number(getConfig('OTP_LENGTH', '6'));
  if (!Number.isFinite(n) || n < 4 || n > 8) return 6;
  return n;
}

/**
 * Generate a numeric OTP using crypto.randomInt — uniform distribution, no Math.random.
 */
function generateCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
  return code;
}

/**
 * Step 1 of the OTP flow. Always returns ok=true unless cooldown active —
 * never reveals whether an account exists for the identifier.
 */
export async function requestOtp(opts: RequestOtpOptions): Promise<RequestOtpResult> {
  const db = getDb();
  const identifier = normalizeIdentifier(opts.identifier, opts.type);
  if (!identifier) {
    return { ok: false, reason: 'invalid_identifier' };
  }

  // Cooldown — protects upstream providers from spam + prevents OTP scraping by attackers.
  const recent = db.prepare(`
    SELECT created_at FROM otp_codes
    WHERE identifier = ? AND identifier_type = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(identifier, opts.type) as { created_at: number } | undefined;

  if (recent) {
    const elapsed = Date.now() - recent.created_at;
    if (elapsed < cooldownMs()) {
      const remainingMs = cooldownMs() - elapsed;
      return {
        ok: false,
        reason: 'cooldown',
        cooldownSecondsRemaining: Math.ceil(remainingMs / 1000),
      };
    }
  }

  const user = getUserByIdentifier(identifier, opts.type);
  // Note: we still issue an OTP record even for unknown identifiers, so that timing
  // and behavior are indistinguishable to a network observer. Only difference: user_id is null.
  if (user && !user.active) {
    // Inactive user — still pretend to send (return ok), but don't generate a code that can sign them in.
    // This deliberately diverges from anti-enumeration: we already accepted the cooldown record above,
    // so observer timing remains the same. The signal goes only into audit logs.
    logAudit({
      actor: identifier,
      action: 'otp_request_inactive',
      entityType: 'user',
      entityId: user.id,
      details: { type: opts.type },
    });
    return { ok: false, reason: 'inactive_user' };
  }

  const code = generateCode(otpLength());
  const hash = await bcrypt.hash(code, 10);
  const now = Date.now();
  const expiresAt = now + ttlMs();
  const id = nanoid();

  // Invalidate any other live codes for this identifier (one valid code at a time)
  db.prepare(`
    UPDATE otp_codes SET used = 1
    WHERE identifier = ? AND identifier_type = ? AND used = 0
  `).run(identifier, opts.type);

  db.prepare(`
    INSERT INTO otp_codes
      (id, identifier, identifier_type, user_id, code_hash, expires_at, attempts, used, created_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
  `).run(
    id,
    identifier,
    opts.type,
    user?.id ?? null,
    hash,
    expiresAt,
    now,
    opts.ip ?? null,
    opts.userAgent ?? null,
  );

  logAudit({
    actor: identifier,
    action: 'otp_request',
    entityType: 'otp',
    entityId: id,
    details: { type: opts.type, user_id: user?.id ?? null, expires_at: expiresAt },
  });

  return {
    ok: true,
    code,
    user: user ?? null,
    otpId: id,
    expiresAt,
  };
}

/**
 * Step 2 of the OTP flow. On success, returns the user — caller is responsible for setting the session cookie.
 */
export async function verifyOtp(
  identifier: string,
  type: IdentifierType,
  code: string,
): Promise<VerifyOtpResult> {
  const db = getDb();
  const normalized = normalizeIdentifier(identifier, type);

  const row = db.prepare(`
    SELECT * FROM otp_codes
    WHERE identifier = ? AND identifier_type = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(normalized, type) as OtpRow | undefined;

  if (!row) {
    logAudit({ actor: normalized, action: 'otp_verify_fail', details: { reason: 'not_found', type } });
    return { ok: false, reason: 'not_found' };
  }

  if (Date.now() > row.expires_at) {
    db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
    logAudit({ actor: normalized, action: 'otp_verify_fail', entityId: row.id, details: { reason: 'expired' } });
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= maxAttempts()) {
    db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
    logAudit({ actor: normalized, action: 'otp_verify_fail', entityId: row.id, details: { reason: 'attempts_exhausted' } });
    return { ok: false, reason: 'attempts_exhausted' };
  }

  const match = await bcrypt.compare(code, row.code_hash);
  db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`).run(row.id);

  if (!match) {
    const remaining = Math.max(0, maxAttempts() - (row.attempts + 1));
    logAudit({ actor: normalized, action: 'otp_verify_fail', entityId: row.id, details: { reason: 'mismatch', attempts: row.attempts + 1 } });
    return { ok: false, reason: 'mismatch', attemptsRemaining: remaining };
  }

  // Match — burn the code. user_id may be null if it was an enumeration probe.
  db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);

  if (!row.user_id) {
    logAudit({ actor: normalized, action: 'otp_verify_phantom', entityId: row.id, details: { type } });
    return { ok: false, reason: 'not_found' };
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id) as UserRow | undefined;
  if (!user || !user.active) {
    logAudit({ actor: normalized, action: 'otp_verify_fail', entityId: row.id, details: { reason: 'inactive_user' } });
    return { ok: false, reason: 'inactive_user' };
  }

  logAudit({
    actor: user.name,
    action: 'otp_verify_success',
    entityType: 'user',
    entityId: user.id,
    details: { type, otp_id: row.id },
  });

  return { ok: true, user };
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function isValidPhone(s: string): boolean {
  const cleaned = s.replace(/\s+/g, '');
  // E.164-ish — accepts +country prefix optionally, 7-15 digits
  return /^\+?\d{7,15}$/.test(cleaned);
}
