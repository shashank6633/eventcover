import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

/**
 * Layout shell for /w/[token] — the customer-facing wallet view.
 *
 * Exists solely to attach `noindex` / `nofollow` / `noarchive` / `nosnippet`
 * meta tags to a per-customer private URL. The page itself is a client
 * component (interactive top-up flow), and a client component cannot export
 * `metadata`, so this server-component layout is the cleanest place to
 * declare it.
 *
 * If a customer pastes the link into a system that crawls (Google Drive
 * preview, Slack unfurl backend, WhatsApp link preview, etc.) we don't want
 * the wallet balance + payer name + redemption history landing in a search
 * index.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function WalletViewLayout({ children }: { children: ReactNode }) {
  return children;
}
