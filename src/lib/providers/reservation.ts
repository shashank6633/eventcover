/**
 * Reservation provider adapter interface.
 *
 * Any reservation source (Reservego, Dineout, Zomato, EazyDiner, District, or a manual CSV
 * import) implements this interface. Swap providers via config without touching the admin UI.
 *
 * When real Reservego credentials arrive, implement `reservego.ts` against this interface
 * (hit their REST API), drop it into PROVIDERS, and flip RESERVATION_PROVIDER in config.
 */
export type ProviderId = 'reservego-mock' | 'reservego' | 'dineout' | 'manual';

export interface ProviderReservation {
  externalRef: string;       // stable ID from the upstream system
  name: string;
  phone: string;             // E.164 preferred
  email?: string | null;
  pax: number;
  arrivalTime?: string | null; // HH:MM (24h, venue TZ)
  notes?: string | null;
  raw: unknown;              // the raw upstream object (for debugging/audit)
}

export interface ReservationProvider {
  id: ProviderId;
  displayName: string;
  /**
   * Fetch reservations for a specific event date (YYYY-MM-DD, IST).
   * Implementations should be idempotent — callers will de-dupe by (provider, externalRef).
   */
  fetchForDate(dateISO: string, opts?: { venueId?: string }): Promise<ProviderReservation[]>;
}
