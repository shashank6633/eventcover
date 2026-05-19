import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PWAInit } from '@/components/PWAInit';
import { RefCapture } from '@/components/RefCapture';

export const metadata: Metadata = {
  title: {
    default: 'EventCover by Akan',
    template: '%s · EventCover',
  },
  description:
    'Akan EventCover — entry, cover, and redemption wallet for events, pubs, and clubs.',
  applicationName: 'EventCover',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'EventCover',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#C1551A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PWAInit />
        <RefCapture />
      </body>
    </html>
  );
}
