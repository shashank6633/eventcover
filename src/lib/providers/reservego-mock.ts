/**
 * Mock Reservego provider.
 *
 * Returns a deterministic list of fake reservations for a given event date, so the full
 * sync → pre-populate → issue-wallet flow works end-to-end without real API credentials.
 *
 * When you get real Reservego docs, create `reservego.ts` next to this file with the same
 * interface, then flip `RESERVATION_PROVIDER` in the `config` table from `reservego-mock`
 * to `reservego`.
 */
import type { ReservationProvider, ProviderReservation } from './reservation';

const FAKE_GUESTS: Omit<ProviderReservation, 'externalRef'>[] = [
  { name: 'Rohit Kumar', phone: '+919876500001', email: 'rohit.k@example.in', pax: 2, arrivalTime: '21:30', notes: 'couple — anniversary' },
  { name: 'Priya Menon',  phone: '+919876500002', email: 'priya.m@example.in', pax: 4, arrivalTime: '22:00', notes: 'friends' },
  { name: 'Arjun Reddy',  phone: '+919876500003', email: null,                 pax: 1, arrivalTime: '22:15', notes: 'stag' },
  { name: 'Sana Iyer',    phone: '+919876500004', email: 'sana@example.in',    pax: 6, arrivalTime: '22:30', notes: 'birthday group' },
  { name: 'Vikram Shah',  phone: '+919876500005', email: null,                 pax: 2, arrivalTime: '23:00', notes: null },
  { name: 'Akash Gupta',  phone: '+919876500006', email: 'akash@example.in',   pax: 8, arrivalTime: '23:15', notes: 'corporate team' },
  { name: 'Neha Rao',     phone: '+919876500007', email: 'neha.r@example.in',  pax: 3, arrivalTime: '23:30', notes: 'VIP' },
  { name: 'Karan Bedi',   phone: '+919876500008', email: null,                 pax: 1, arrivalTime: '00:15', notes: 'late arrival' },
];

export const reservegoMock: ReservationProvider = {
  id: 'reservego-mock',
  displayName: 'Reservego (mock)',

  async fetchForDate(dateISO: string): Promise<ProviderReservation[]> {
    await delay(300 + Math.random() * 500);
    const compactDate = dateISO.replace(/-/g, '');
    return FAKE_GUESTS.map((g, i) => ({
      ...g,
      externalRef: `RSVG-${compactDate}-${String(i + 1).padStart(3, '0')}`,
      raw: {
        source: 'reservego-mock',
        booking_date: dateISO,
        booked_at: new Date(Date.now() - (1 + i) * 3600_000).toISOString(),
        ...g,
      },
    }));
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
