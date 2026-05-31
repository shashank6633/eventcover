import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { computeBilling } from '@/lib/pricing-calculator';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/billing-preview — admin-only "what would the
 * customer pay?" calculator. Powers the live preview card in the wizard
 * Settings section (SectionSettings.tsx) so the host can sanity-check
 * the per-event fee/GST configuration before saving.
 *
 * NOT public — the public booking flow derives the same breakdown
 * server-side via the same computeBilling() helper inside
 * /api/payments/order, so the preview and the actual charge always
 * agree.
 *
 * Body: { pax?: number, zonePrice?: number }
 *   - pax defaults to 2 to match the spec's sample preview
 *   - zonePrice (optional) overrides the per-person entry fee. When
 *     omitted we derive the base from event.entry_fee_per_person × pax.
 *     Cover charges intentionally aren't previewed here — they depend
 *     on a guest mix the wizard doesn't collect.
 *
 * Response: { ok, breakdown, pax }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) {
    return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    pax?: unknown;
    zonePrice?: unknown;
  };
  const pax = Math.max(1, Math.floor(Number(body.pax) || 2));
  const rawZone = Number(body.zonePrice);
  const zonePrice = Number.isFinite(rawZone) && rawZone >= 0 ? rawZone : undefined;

  const breakdown = computeBilling({
    event: {
      entry_fee_per_person: event.entry_fee_per_person,
      cover_rates: event.cover_rates,
      discount_percent: event.discount_percent,
      gst_percent: event.gst_percent,
      gst_enabled: event.gst_enabled,
      payment_gateway_fee_payer: event.payment_gateway_fee_payer,
      platform_fee_payer: event.platform_fee_payer,
    },
    pax,
    zonePrice,
  });

  return NextResponse.json({ ok: true, breakdown, pax });
}
