/**
 * OTP delivery provider interface.
 *
 * Implementations: console (default, logs to stdout), email (Gmail SMTP), whatsapp.
 * The active provider is read from config.OTP_PROVIDER and resolved via the registry.
 */
export type OtpProviderId = 'console' | 'email' | 'whatsapp';

export interface OtpDeliveryPayload {
  identifier: string;
  type: 'email' | 'phone';
  code: string;
  expiresAt: number;
  venueName: string;
  /** Recipient display name, if known. May be empty. */
  recipientName?: string;
}

export interface OtpDeliveryResult {
  ok: boolean;
  channel: OtpProviderId;
  /** Provider-specific reference for ops/debugging. */
  ref?: string;
  error?: string;
}

export interface OtpProvider {
  id: OtpProviderId;
  displayName: string;
  /** Returns true if the provider has the credentials it needs to run. */
  isConfigured(): boolean;
  send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult>;
}
