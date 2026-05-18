/**
 * Audit metadata helpers.
 *
 * The history page needs to surface critical events (deletes, refunds, cancels,
 * unsettlements, lockouts) clearly so a host or cashier can spot tampering
 * during a shift. This module classifies an action name into a severity bucket
 * and exposes the allow-list of money-touching actions used by the cashier
 * "money-only" filter.
 *
 * Pure functions only — safe to import from server routes and client pages.
 */

export type AuditSeverity = 'critical' | 'warning' | 'info';

/**
 * Critical (rose):
 *   Reversal of state that has financial / access consequences and that an
 *   admin would want to see at a glance. Deletes, cancels, refunds,
 *   unsettlements, expired-pass redeem attempts, PIN lockouts, phantom OTP.
 *
 * Warning (amber):
 *   Mistakes / soft failures that aren't destructive but are worth noticing:
 *   updates, login/PIN/OTP failures, no-shows, inactive-user OTP requests.
 *
 * Info (slate):
 *   Routine activity — creates, issuances, redemptions, settles, logins.
 */
export function auditSeverity(action: string): AuditSeverity {
  const a = action.toLowerCase();

  // critical — destructive / reversal / security
  if (
    /(_delete|_cancel|_revoke|_reverse|_unsettle|_void|_refund)$/.test(a) ||
    a.includes('_blocked') ||   // e.g. redeem_blocked_expired
    a.includes('_lockout') ||
    a.includes('redeem_error') ||
    a.includes('redeem_failed') ||
    a.includes('_phantom')
  ) return 'critical';

  // warning — soft failures / edits
  if (
    /(_update|_fail)$/.test(a) ||
    a === 'rotate_pin' ||
    a.includes('_no_show') ||
    a === 'otp_request_inactive'
  ) return 'warning';

  return 'info';
}

/**
 * Transaction-scoped actions.
 *
 * These are the events that belong on the operational History page —
 * entry / cover charges, redemptions, settlements, and any alteration to
 * those (voids, refunds, cancels, unsettlements, expired redeem attempts,
 * PIN failures during a redemption attempt).
 *
 * The History page filters to this set by default. Login / OTP / config
 * edits are deliberately excluded — they have their own audit surface
 * (the "Show system events" toggle on History exposes them on demand).
 */
export const MONEY_ACTIONS: readonly string[] = [
  // Cover / wallet lifecycle
  'issue_wallet',
  'wallet_void',
  'wallet_refund',
  'wallet_expired',
  // Offline ticket lifecycle
  'ticket_create',
  'ticket_cancel',
  // Booking lifecycle
  'booking_create',
  'booking_confirm',
  'booking_cancel',
  // Redemption (cover spent at bar)
  'redeem',
  'redeem_blocked_expired',
  'redeem_failed',
  'redeem_error',
  // PIN errors during a redemption attempt — operationally part of the txn
  'pin_fail',
  'pin_lockout',
  // Cashier settlement
  'cashier_settle',
  'cashier_unsettle',
];

/**
 * Pretty label for an action string.
 * Examples:
 *   redeem_blocked_expired → "Redeem blocked (expired)"
 *   cashier_unsettle       → "Cashier unsettle"
 *   otp_verify_phantom     → "OTP verify (phantom)"
 */
export function actionLabel(action: string): string {
  const a = action.toLowerCase();

  const overrides: Record<string, string> = {
    issue_wallet: 'Issue wallet',
    wallet_void: 'Wallet VOIDED',
    wallet_refund: 'Wallet refunded',
    wallet_expired: 'Wallet auto-expired',
    redeem: 'Redeem',
    redeem_blocked_expired: 'Redeem blocked (expired)',
    redeem_failed: 'Redeem failed',
    redeem_error: 'Redeem error',
    pin_fail: 'PIN failed',
    pin_lockout: 'PIN lockout',
    rotate_pin: 'PIN rotated',
    otp_request: 'OTP requested',
    otp_request_inactive: 'OTP request (inactive user)',
    otp_verify_success: 'OTP verified',
    otp_verify_fail: 'OTP verify failed',
    otp_verify_phantom: 'OTP verify (phantom)',
    cashier_settle: 'Cashier settle',
    cashier_unsettle: 'Cashier UNSETTLE',
    booking_create: 'Booking created',
    booking_confirm: 'Booking confirmed',
    booking_cancel: 'Booking cancelled',
    ticket_create: 'Ticket created',
    ticket_cancel: 'Ticket cancelled',
    event_create: 'Event created',
    event_update: 'Event updated',
    event_delete: 'Event deleted',
    venue_create: 'Venue created',
    venue_update: 'Venue updated',
    venue_delete: 'Venue deleted',
    artist_create: 'Artist created',
    artist_update: 'Artist updated',
    artist_delete: 'Artist deleted',
    table_create: 'Table created',
    table_update: 'Table updated',
    table_delete: 'Table deleted',
    user_create: 'User created',
    user_update: 'User updated',
    user_delete: 'User deleted',
    config_update: 'Config updated',
    reservation_no_show: 'No-show',
    reservations_sync: 'Reservations synced',
    login: 'Login',
    logout: 'Logout',
    login_fail: 'Login failed',
  };

  if (overrides[a]) return overrides[a];

  // generic title-case fallback
  return a
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * One-letter glyph for the severity badge; cheap to render and stays readable
 * in a compact mobile card list.
 */
export function severityGlyph(s: AuditSeverity): string {
  return s === 'critical' ? '!' : s === 'warning' ? '·' : '✓';
}

/**
 * Human-readable by-line for a transaction row: "Redeemed by Ravi",
 * "Settled by Anita", "Voided by Shashank". Each verb encodes which role
 * performed it (captain redeems, cashier settles, manager/host edits),
 * so the History page makes accountability unmistakable.
 */
export function byline(action: string, actor: string): string {
  const a = action.toLowerCase();
  const verb = bylineVerb(a);
  if (a === 'wallet_expired') return 'Auto-expired (system)';
  return `${verb} ${actor}`;
}

function bylineVerb(a: string): string {
  // Cover / wallet lifecycle
  if (a === 'issue_wallet')        return 'Issued by';
  if (a === 'wallet_void')         return 'Voided by';
  if (a === 'wallet_refund')       return 'Refunded by';

  // Offline ticket lifecycle
  if (a === 'ticket_create')       return 'Created by';
  if (a === 'ticket_cancel')       return 'Cancelled by';

  // Booking lifecycle
  if (a === 'booking_create')      return 'Booked by';
  if (a === 'booking_confirm')     return 'Confirmed by';
  if (a === 'booking_cancel')      return 'Cancelled by';

  // Redemption (cover spent at bar)
  if (a === 'redeem')              return 'Redeemed by';
  if (a === 'redeem_blocked_expired') return 'Redeem blocked (expired) — attempted by';
  if (a === 'redeem_failed')       return 'Redeem failed — attempted by';
  if (a === 'redeem_error')        return 'Redeem errored — attempted by';
  if (a === 'pin_fail')            return 'PIN attempt by';
  if (a === 'pin_lockout')         return 'PIN locked out for';

  // Cashier settlement
  if (a === 'cashier_settle')      return 'Settled by';
  if (a === 'cashier_unsettle')    return 'UNSETTLED by';

  // Generic edits — anything that mutates without a specific verb above
  if (/(_update|_delete|_revoke|_reverse)$/.test(a)) return 'Edited by';

  return 'By';
}

/**
 * Tailwind class set for a severity dot/pill — kept here so the page just maps
 * sev → classes.
 */
export const SEVERITY_PILL: Record<AuditSeverity, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  info:     'bg-slate-50 text-slate-700 border-slate-200',
};

export const SEVERITY_DOT: Record<AuditSeverity, string> = {
  critical: 'bg-rose-500',
  warning:  'bg-amber-400',
  info:     'bg-slate-300',
};
