/**
 * One-off: generates a sample cover pass PDF using current lib settings,
 * writes to /tmp/sample-pass.pdf. Used to visually QA the layout without
 * needing to log in + issue a real cover through the dev server.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { generatePassPdf } from '../src/lib/pdf/pass';

const dbPath = path.join(process.cwd(), 'data', 'eventcover.db');
const db = new Database(dbPath, { readonly: true });
const venueName = (db.prepare(`SELECT value FROM config WHERE key='VENUE_NAME'`).get() as { value: string } | undefined)?.value;
const venueLogo = (db.prepare(`SELECT value FROM config WHERE key='VENUE_LOGO'`).get() as { value: string } | undefined)?.value;
db.close();

console.log(`Using venue: ${venueName}, logo length: ${venueLogo?.length ?? 0}`);

void (async () => {
  const bytes = await generatePassPdf({
    txnId: 'SKY-0518-SAMPLE',
    qrCodeId: '4821',
    guestName: 'Anoop K',
    coverAmount: 5000,
    eventName: 'Saturday Night Live',
    venueName,
    venueLogo,
    expiresAt: Date.now() + 24 * 3600 * 1000,
  });

  const out = '/tmp/sample-pass.pdf';
  writeFileSync(out, bytes);
  console.log(`Wrote ${bytes.length} bytes → ${out}`);
})();
