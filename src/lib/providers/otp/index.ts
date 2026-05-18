import type { OtpProvider, OtpProviderId } from './types';
import { consoleOtpProvider } from './console';
import { emailOtpProvider } from './email';
import { whatsappOtpProvider } from './whatsapp';
import { getConfig } from '@/lib/db';

const REGISTRY: Record<OtpProviderId, OtpProvider> = {
  console: consoleOtpProvider,
  email: emailOtpProvider,
  whatsapp: whatsappOtpProvider,
};

/**
 * Resolve the active OTP provider for a given identifier type.
 *
 * Strategy:
 *   1. Read the user-configured provider from config.OTP_PROVIDER.
 *   2. If it doesn't match the identifier type (e.g. WhatsApp for an email), fall back to console.
 *   3. If the chosen provider is not configured (missing creds), fall back to console + log a warning.
 *
 * The console provider is always available, so login never breaks because of a misconfig.
 */
export function resolveOtpProvider(type: 'email' | 'phone'): OtpProvider {
  const configured = getConfig('OTP_PROVIDER', 'console') as OtpProviderId;
  let chosen = REGISTRY[configured] ?? consoleOtpProvider;

  // Channel compatibility: email provider only handles email; whatsapp only handles phone.
  if (chosen.id === 'email' && type !== 'email') chosen = consoleOtpProvider;
  if (chosen.id === 'whatsapp' && type !== 'phone') chosen = consoleOtpProvider;

  if (!chosen.isConfigured()) {
    /* eslint-disable no-console */
    console.warn(`[otp] Provider "${chosen.id}" is not configured — falling back to console`);
    /* eslint-enable no-console */
    return consoleOtpProvider;
  }
  return chosen;
}

export function listConfiguredProviders(): OtpProviderId[] {
  return (Object.keys(REGISTRY) as OtpProviderId[]).filter((id) => REGISTRY[id].isConfigured());
}

export type { OtpProvider, OtpProviderId };
