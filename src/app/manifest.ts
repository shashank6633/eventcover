import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — installable PWA descriptor.
 * Served at /manifest.webmanifest by Next.js.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EventCover by Akan',
    short_name: 'EventCover',
    description:
      'Akan EventCover — entry, cover, and redemption wallet for events, pubs, and clubs.',
    start_url: '/admin',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8F7F4',
    theme_color: '#C1551A',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    shortcuts: [
      {
        name: 'Issue Cover',
        short_name: 'Issue',
        description: 'Issue a new wallet at the door',
        url: '/admin/issue',
        icons: [{ src: '/icon', sizes: '96x96' }],
      },
      {
        name: 'Redeem Cover',
        short_name: 'Redeem',
        description: 'Scan QR + redeem wallet balance',
        url: '/admin/redeem',
        icons: [{ src: '/icon', sizes: '96x96' }],
      },
    ],
  };
}
