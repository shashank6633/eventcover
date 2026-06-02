/**
 * /p/[token] — Reservego prepay landing page.
 *
 * Public, no auth. The HMAC-signed token IS the auth — verified server-side
 * by /api/reservations/prepay-resolve. Renders a focused PrepayForm that
 * collects the M/F/C breakdown, opens Razorpay, and writes payment_id back
 * to the reservation on capture.
 *
 * No AdminShell, no nav. Single-column mobile-first layout — the customer
 * usually opens this from WhatsApp on their phone.
 *
 * Failure modes the page handles cleanly:
 *   - Invalid / expired token → "Link no longer valid" panel
 *   - Reservation cancelled → "Cancelled" panel
 *   - Already paid → "Paid ✓" panel with reservation summary
 *   - No event linked yet → "Pending event setup, contact venue" panel
 *
 * Force dynamic so the resolve endpoint runs on every request — the row
 * state (token validity, paid status) can change between requests.
 */
import { headers } from 'next/headers';
import { PrepayForm } from '@/components/PrepayForm';

export const dynamic = 'force-dynamic';

interface ResolveResponse {
  ok: boolean;
  paid?: boolean;
  message?: string;
  reservation?: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    pax: number;
    eventDate: string | null;
    arrivalTime: string | null;
    tables: string[];
    status: string;
    paymentId?: string | null;
  };
  event?: {
    id: string;
    slug: string;
    name: string;
    event_date: string;
    start_time: string | null;
    description: string | null;
    image_data: string | null;
    genre: string | null;
  };
  paymentGatewayFeePayer?: 'customer' | 'host';
  platformFeePayer?: 'customer' | 'host';
  gstEnabled?: boolean;
  paymentGatewayFeePct?: number;
  platformFeePct?: number;
  gstPercent?: number;
  discountPercent?: number;
  coverRates?: { male_stag?: number; female_stag?: number; couple?: number };
  entryFeePerPerson?: number;
}

async function resolve(token: string): Promise<ResolveResponse> {
  // Build the same-origin URL from incoming headers — works for both dev
  // (localhost) and prod (custom domain) without env vars.
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3100';
  const url = `${proto}://${host}/api/reservations/prepay-resolve/${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return (await res.json().catch(() => ({ ok: false }))) as ResolveResponse;
  } catch {
    return { ok: false, message: 'Network error. Please try again.' };
  }
}

export default async function PrepayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await resolve(token);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto px-4 py-8 sm:py-12">
        <header className="mb-6 text-center">
          <div className="text-[11px] tracking-widest uppercase text-slate-400">Pay your cover</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            {data.event?.name || 'Reservation'}
          </h1>
          {data.event?.event_date && (
            <div className="text-sm text-slate-500 mt-1">
              {formatDate(data.event.event_date)}
            </div>
          )}
        </header>

        {!data.ok ? (
          <ErrorPanel message={data.message || 'This link is no longer valid.'} />
        ) : data.paid ? (
          <PaidPanel reservation={data.reservation} eventName={data.event?.name || ''} />
        ) : data.reservation && data.event ? (
          <PrepayForm
            token={token}
            reservation={data.reservation}
            eventName={data.event.name}
            eventDate={formatDate(data.event.event_date)}
            coverRates={{
              male_stag: Number(data.coverRates?.male_stag) || 0,
              female_stag: Number(data.coverRates?.female_stag) || 0,
              couple: Number(data.coverRates?.couple) || 0,
            }}
            entryFeePerPerson={Number(data.entryFeePerPerson) || 0}
            paymentGatewayFeePayer={data.paymentGatewayFeePayer || 'host'}
            platformFeePayer={data.platformFeePayer || 'host'}
            gstEnabled={!!data.gstEnabled}
            paymentGatewayFeePct={Number(data.paymentGatewayFeePct) || 0}
            platformFeePct={Number(data.platformFeePct) || 0}
            gstPercent={Number(data.gstPercent) || 0}
            discountPercent={Number(data.discountPercent) || 0}
          />
        ) : (
          <ErrorPanel message="Could not load the reservation details." />
        )}

        <footer className="text-center text-[11px] text-slate-400 mt-8">
          Powered by EventCover · Secure payment via Razorpay
        </footer>
      </div>
    </main>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6 text-center">
      <div className="text-base font-semibold text-rose-900 mb-2">Link no longer valid</div>
      <p className="text-sm text-rose-700">{message}</p>
      <p className="text-xs text-rose-600/80 mt-3">
        Please contact the venue for an updated payment link.
      </p>
    </div>
  );
}

function PaidPanel({
  reservation,
  eventName,
}: {
  reservation?: ResolveResponse['reservation'];
  eventName: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
      <div className="text-2xl font-bold text-emerald-900 mb-1">✓ Already paid</div>
      <p className="text-sm text-emerald-800 mb-4">
        This reservation has been settled. Show your WhatsApp confirmation at the door.
      </p>
      {reservation && (
        <div className="text-xs text-emerald-800/70 bg-white/60 rounded-lg p-3 text-left">
          <div><strong>Guest:</strong> {reservation.name}</div>
          <div><strong>Event:</strong> {eventName}</div>
          <div><strong>Pax:</strong> {reservation.pax}</div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}
