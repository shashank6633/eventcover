import type { ReservationProvider, ProviderId } from './reservation';
import { reservegoMock } from './reservego-mock';

const REGISTRY: Record<ProviderId, ReservationProvider | null> = {
  'reservego-mock': reservegoMock,
  // When real Reservego API docs arrive, implement reservego.ts and wire it here.
  reservego: null,
  dineout: null,
  manual: null,
};

export function getProvider(id: ProviderId): ReservationProvider {
  const provider = REGISTRY[id];
  if (!provider) {
    throw new Error(`Reservation provider "${id}" is not implemented. Available: ${listImplementedProviders().join(', ')}`);
  }
  return provider;
}

export function listImplementedProviders(): ProviderId[] {
  return (Object.keys(REGISTRY) as ProviderId[]).filter((k) => REGISTRY[k] !== null);
}

export type { ReservationProvider, ProviderId };
