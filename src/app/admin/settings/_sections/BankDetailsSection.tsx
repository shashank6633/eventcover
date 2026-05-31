'use client';

import { useState } from 'react';
import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = [
  'BANK_ACCOUNT_HOLDER',
  'BANK_ACCOUNT_NUMBER',
  'BANK_IFSC',
  'BANK_UPI_ID',
  'BANK_GSTIN',
];

const MASKED = '••••••••';

/**
 * BankDetailsSection — Finance → Bank Details.
 *
 * BANK_ACCOUNT_NUMBER is in SENSITIVE_KEYS: /api/config GET returns '••••••••'
 * when it's set (and the empty string when it isn't). The save flow lets us
 * skip rewriting the account number when the user hasn't actually changed it
 * — re-sending the masked placeholder would be a no-op server-side, but we
 * also UX-gate the field so the host doesn't accidentally overwrite it.
 */
export function BankDetailsSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);
  const [editingAccount, setEditingAccount] = useState(false);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  const hasAccountSet = config.BANK_ACCOUNT_NUMBER === MASKED;
  const showAccountInput = editingAccount || !hasAccountSet;

  async function handleSave() {
    const ok = await save();
    if (ok) setEditingAccount(false);
  }

  return (
    <SectionShell
      eyebrow="Finance"
      title="Bank Details"
      description="Used for affiliate payouts and revenue settlements. We never share this — only host + accountant roles can view."
      onSave={handleSave}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Payout Account
        </div>

        <div>
          <label className="label">Account holder name</label>
          <input
            className="input"
            value={config.BANK_ACCOUNT_HOLDER || ''}
            onChange={(e) => set('BANK_ACCOUNT_HOLDER', e.target.value)}
            placeholder="Full name as on the bank account"
          />
        </div>

        <div>
          <label className="label">Account number</label>
          {showAccountInput ? (
            <input
              className="input"
              value={config.BANK_ACCOUNT_NUMBER === MASKED ? '' : (config.BANK_ACCOUNT_NUMBER || '')}
              onChange={(e) => set('BANK_ACCOUNT_NUMBER', e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 123456789012"
              inputMode="numeric"
              autoComplete="off"
            />
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="input font-mono"
                value={MASKED}
                disabled
                readOnly
              />
              <button
                type="button"
                onClick={() => { setEditingAccount(true); set('BANK_ACCOUNT_NUMBER', ''); }}
                className="btn btn-secondary md:w-auto whitespace-nowrap"
              >
                Replace
              </button>
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1.5">
            Stored encrypted. Never shown back in plain text once saved.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">IFSC code</label>
            <input
              className="input font-mono uppercase"
              value={config.BANK_IFSC || ''}
              onChange={(e) => set('BANK_IFSC', e.target.value.toUpperCase())}
              placeholder="e.g. HDFC0001234"
              maxLength={11}
            />
          </div>
          <div>
            <label className="label">UPI ID</label>
            <input
              className="input"
              value={config.BANK_UPI_ID || ''}
              onChange={(e) => set('BANK_UPI_ID', e.target.value)}
              placeholder="e.g. venue@upi"
            />
          </div>
        </div>

        <div>
          <label className="label">GSTIN <span className="text-slate-400 text-xs">(optional)</span></label>
          <input
            className="input font-mono uppercase"
            value={config.BANK_GSTIN || ''}
            onChange={(e) => set('BANK_GSTIN', e.target.value.toUpperCase())}
            placeholder="e.g. 36ABCDE1234F1Z5"
            maxLength={15}
          />
          <div className="text-xs text-slate-500 mt-1.5">
            For tax-compliant payout receipts.
          </div>
        </div>
      </div>

      <div className="card space-y-2 border-amber-200 bg-amber-50/50">
        <div className="text-xs uppercase tracking-widest text-amber-700">
          Privacy
        </div>
        <p className="text-sm text-slate-700">
          Bank details are stored encrypted and only visible to host +
          accountant roles. They are never shared with affiliates, guests, or
          third-party integrations.
        </p>
      </div>
    </SectionShell>
  );
}
