# EventCover Wallet — Local Prototype

Real clickable app for demoing to venue owners. Runs on your laptop. No cloud, no accounts, no payment keys. Data stored in a local SQLite file.

- **4 role-based screens:** Bouncer / Captain / Cashier / Admin
- **Real QR codes** — scan from your phone, opens the captain page directly
- **Real PIN security** — bcrypt hashed, 3-strike lockout, never embedded in QR
- **Live dashboards** — KPIs auto-refresh every 5s
- **SQLite** — single `data/eventcover.db` file, easy to reset or copy for a fresh demo

---

## Start here

### Prerequisites
- **Node.js 20+** ([nodejs.org](https://nodejs.org) — install the LTS if you don't have it)
- A terminal (macOS: Terminal.app)
- A phone with a camera (optional — only for scanning the QR on a second device)

### Run it (first time)

```bash
cd /Users/shashankreddy/Desktop/Claude/eventcover-wallet-local
npm install
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

> The first `npm install` will compile `better-sqlite3` for your machine (~30 sec on Apple Silicon). If it fails, you need Xcode Command Line Tools: run `xcode-select --install` and retry.

---

## Demo walkthrough (2 minutes)

You'll play four roles in four browser tabs. Best viewed on a single laptop for the demo, or laptop + phone to show the real QR scan.

### Tab 1 — Bouncer
1. From the home page, click **Bouncer**
2. Fill in:
   - Guest name: `Rohit Kumar`
   - Phone: `+919999999999`
   - Email: (leave blank — this prototype has no email delivery)
   - Entry fee: `1500`
   - Your name: `Ravi` (the bouncer)
   - Payment: click **Cash**
3. Click **Issue wallet**
4. You'll see:
   - A large QR code (white on black)
   - The wallet balance (₹1500)
   - A **6-digit PIN** in yellow
   - Three buttons: Issue next / Open captain link / Copy link

**Save for the next step:** the 6-digit PIN and the transaction ID (`DEM-MMDD-XXXXX`)

### Tab 2 — Captain (on your laptop)
1. Click **Open captain link** from the Bouncer success screen — or
2. Open a new tab → home → **Captain** → paste the transaction ID → **Look up wallet**
3. You'll see the guest name + remaining balance
4. Enter:
   - PIN (the 6 digits from Tab 1)
   - Amount: `500`
   - Order/KOT: `TEST-001` (anything)
   - Your name: `Arjun`
5. Click **Redeem**
6. Green success card: "Redeemed ₹500" / "Remaining ₹1000"

### Tab 2b — Captain (on your phone, optional but impressive for demos)
1. Open your phone camera
2. Point it at the QR code on the laptop screen
3. Tap the notification banner — opens the redemption page on your phone
4. Enter PIN + amount exactly as above — works the same

### Tab 3 — Cashier
1. Go back to home → click **Cashier**
2. Live redemption feed shows the ₹500 redemption with captain + time
3. Enter `500` in the POS box → delta shows `₹0` → **Match ✓**
4. Enter `600` instead → delta shows `+₹100` → **Investigate** (red)

### Tab 4 — Admin
1. Home → **Admin**
2. KPIs:
   - Entry fees: ₹1500
   - Cover issued: ₹1500
   - Redeemed: ₹500
   - **Unredeemed: ₹1000** (green — this is the "profit insight" metric for owners)
3. Payment mix shows 100% Cash
4. Toggle between Wallets and Redemptions tabs to see detail tables

That's the full product loop. Issue → redeem → reconcile → analyze.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `http://localhost:3000` — use this for demos |
| `npm run build` | Production build (not needed for demos) |
| `npm start` | Serve the production build |

---

## Data

- Your database lives at **`data/eventcover.db`** (inside this project folder)
- SQLite format — open it with [DB Browser for SQLite](https://sqlitebrowser.org) to poke around
- To **reset for a fresh demo:** stop the dev server, delete the `data/eventcover.db` file, restart
- Tables: `guests`, `wallets`, `redemptions`, `audit_log`, `config`

### Default config (auto-seeded)

| Key | Default | Override by editing `config` table |
|---|---|---|
| `VENUE_NAME` | Demo Lounge | Change for different demos |
| `EVENT_NAME` | Saturday Night | |
| `DEFAULT_ENTRY_FEE` | 1500 | |
| `PIN_LENGTH` | 6 | 4–8 |

To change: open `data/eventcover.db` in DB Browser, edit the `config` row, save, refresh the page.

---

## What's real vs. stubbed

| Thing | Status in this prototype |
|---|---|
| QR generation | ✅ Real (server-rendered PNG, scannable) |
| PIN hashing (bcrypt) | ✅ Real |
| Concurrency safety on redeem | ✅ Real (SQLite transaction) |
| 3-strike PIN lockout | ✅ Real (5 min lockout) |
| Live dashboards | ✅ Real (polling every 5s) |
| Audit log | ✅ Real (every action logged to `audit_log`) |
| Email delivery of QR+PIN | ❌ Stubbed — displayed on bouncer's screen instead |
| WhatsApp delivery | ❌ Stubbed |
| Razorpay payments | ❌ Stubbed — bouncer records method manually |
| Multi-tenant / venue isolation | ❌ Single-tenant |
| Auth / login | ❌ Staff type their name each action (logged but not authenticated) |
| Reservation API import | ❌ Not yet |

These are all the pieces that need real infra to test. The **flow and UX** — which is the hard part to validate — is fully working.

---

## File map

```
eventcover-wallet-local/
├── README.md                                  ← you are here
├── package.json                               deps + scripts
├── tsconfig.json                              TS config
├── next.config.mjs                            Next.js config
├── tailwind.config.ts                         Tailwind theme
├── postcss.config.mjs
├── next-env.d.ts
├── data/                                      SQLite files live here (auto-created)
└── src/
    ├── app/
    │   ├── layout.tsx                         root layout
    │   ├── globals.css                        Tailwind + component classes
    │   ├── page.tsx                           role picker (landing)
    │   ├── bouncer/page.tsx                   issue wallet + QR display
    │   ├── captain/page.tsx                   txn ID lookup
    │   ├── captain/redeem/page.tsx            PIN + amount → redeem
    │   ├── cashier/page.tsx                   live feed + reconciliation
    │   ├── admin/page.tsx                     KPIs + tables
    │   └── api/
    │       ├── wallets/route.ts               POST issue + GET list
    │       ├── wallets/[txnId]/route.ts       GET wallet
    │       ├── wallets/[txnId]/redeem/route.ts POST redeem
    │       ├── redemptions/route.ts           GET feed
    │       └── dashboard/route.ts             GET KPIs + config
    ├── components/
    │   └── RoleNav.tsx                        persistent top nav
    └── lib/
        ├── db.ts                              SQLite + schema
        ├── crypto.ts                          PIN + txn ID + bcrypt
        ├── wallet.ts                          issueWallet, lookup, list
        ├── redemption.ts                      redeemWallet (locked), list
        ├── dashboard.ts                       KPI aggregation
        ├── audit.ts                           append-only audit log
        ├── format.ts                          money + time helpers
        └── types.ts                           TS types
```

---

## Demoing to a venue owner — the pitch flow

1. Open Admin screen first. Show the empty dashboard and say: *"This is what you see on any night."*
2. Switch to Bouncer. Issue 3 wallets in 60 seconds with made-up guest names. Each time, show the QR + PIN.
3. Switch to Captain. Redeem ₹200 from guest 1. Redeem ₹500 from guest 2. Try a wrong PIN once — show the lockout warning.
4. Flip back to Admin. Point at the **Unredeemed balance** number and say: *"Tonight you issued ₹4,500 in cover and only ₹700 was redeemed. The remaining ₹3,800 is clean margin you'd normally lose to staff not tracking it. We show you every rupee."*
5. Switch to Cashier. Show the live feed. Type a fake POS total that doesn't match. Show the delta flag.
6. Close: *"Everything you just saw runs on a laptop, but production runs in the cloud with WhatsApp QR delivery, Razorpay integration, and multi-venue. 30-day pilot at ₹0 — we prove the leakage on your data."*

That's ~3 minutes. Usually enough to get the pilot agreement.

---

## Common issues

**"Module not found: better-sqlite3"**
→ `npm install` didn't finish. Re-run it. If it fails with node-gyp errors on macOS: `xcode-select --install` then retry.

**"Cannot read properties of null (reading 'pragma')"**
→ `data/` folder couldn't be created. Make sure you're running `npm run dev` from inside the project folder.

**QR scans but opens a different site**
→ The QR URL is based on the dev server's origin (`http://localhost:3000` by default). If you moved the dev server to another port, re-issue the wallet.

**"Transaction not found" on the captain page**
→ Hot reload wiped the DB? Check `data/eventcover.db` exists. If you deleted it mid-demo, re-issue the wallet.

**PIN locked and I want to keep demoing**
→ Quickest: stop dev server, delete `data/eventcover.db`, restart.

---

## When you outgrow this

This prototype is fine for demos, internal testing, and short pilots (< 200 wallets/night on one laptop). If the pilot works and you want to go live:
- Swap SQLite → Postgres (same schema, minor SQL tweaks)
- Add NestJS service layer for multi-tenant + auth
- Add WhatsApp Cloud API for QR+PIN delivery
- Add Razorpay for pre-event broadcast payments

The system design doc covers this — roughly 8 weeks of work.
