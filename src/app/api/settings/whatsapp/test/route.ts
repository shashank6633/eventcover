import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { sendInteraktTemplate, splitPhone } from '@/lib/providers/whatsapp/interakt';
import { logAudit } from '@/lib/audit';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Test-send a pre-approved WhatsApp template via Interakt.
 *
 * Host-only — this is the "is the integration alive?" button on the
 * Settings → WhatsApp sub-page.
 *
 * Body:
 *   { template: 'akan_login_otp' | 'reservation_confirmed', phone: '+91…' }
 *
 * Test values are hard-coded per template — the goal is to prove the pipeline
 * works end-to-end, not to send real customer data.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  const template = String(body?.template || '').trim();
  const phone = String(body?.phone || '').trim();

  if (!phone) {
    return NextResponse.json({ ok: false, message: 'Phone number is required.' }, { status: 400 });
  }

  const { countryCode, phoneNumber } = splitPhone(phone);
  if (!phoneNumber || phoneNumber.length < 7) {
    return NextResponse.json({ ok: false, message: 'Enter a valid phone with country code.' }, { status: 400 });
  }

  const venueName = getConfig('VENUE_NAME', 'AKAN Hyderabad');

  let sendInput;
  switch (template) {
    case 'akan_login_otp': {
      const testCode = String(Math.floor(1000 + Math.random() * 9000));
      sendInput = {
        countryCode,
        phoneNumber,
        templateName: 'akan_login_otp',
        languageCode: 'en',
        bodyValues: [testCode],
        // Authentication templates with a "Copy code" button require the code
        // to be passed at the button level too (Meta auto-fill needs it).
        buttonValues: { '0': [testCode] },
        callbackData: 'test:otp',
      };
      break;
    }
    case 'reservation_confirmed': {
      sendInput = {
        countryCode,
        phoneNumber,
        templateName: 'reservation_confirmed',
        languageCode: 'en',
        bodyValues: [
          'Test Guest',                           // {{1}} Guest name
          'Saturday Night Live',                  // {{2}} Event name
          new Date().toLocaleDateString('en-IN', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
          }),                                     // {{3}} Event date
          '9:00 PM',                              // {{4}} Event start time
        ],
        callbackData: 'test:reservation',
      };
      break;
    }
    case 'ticket_confirmed': {
      const testQrId = String(Math.floor(1000 + Math.random() * 9000));
      sendInput = {
        countryCode,
        phoneNumber,
        templateName: 'ticket_confirmed',
        languageCode: 'en',
        bodyValues: [
          'Test Guest',                           // {{1}} Guest name
          'GA',                                   // {{2}} Ticket tier
          'Saturday Night Live',                  // {{3}} Event name
          new Date().toLocaleDateString('en-IN', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
          }),                                     // {{4}} Event date
          'FB000001',                             // {{5}} Invoice number
          '2000',                                 // {{6}} Cover amount
          testQrId,                               // {{7}} 4-digit QR Code ID
        ],
        callbackData: 'test:ticket',
      };
      break;
    }
    default:
      return NextResponse.json({
        ok: false,
        message: `Unknown template "${template}". Use akan_login_otp, reservation_confirmed, or ticket_confirmed.`,
      }, { status: 400 });
  }

  const result = await sendInteraktTemplate(sendInput);

  logAudit({
    actor: session.name,
    action: 'whatsapp_test_send',
    entityType: 'whatsapp',
    entityId: template,
    details: {
      to: `${countryCode}${phoneNumber}`,
      template,
      venue: venueName,
      ok: result.ok,
      status: result.status,
      error: result.error,
    },
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      message: result.error || 'Send failed.',
      status: result.status,
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    to: `${countryCode}${phoneNumber}`,
  });
}
