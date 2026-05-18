import { ImageResponse } from 'next/og';

/**
 * Maskable icon — full bleed, Android adaptive-icon safe zone (40% center).
 * Background extends to the edges so the OS can mask it into any shape (circle, squircle, rounded square).
 */
export const runtime = 'edge';
export const dynamic = 'force-static';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#C1551A',
          color: 'white',
          fontSize: 260,
          fontWeight: 800,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.04em',
        }}
      >
        A
      </div>
    ),
    { width: 512, height: 512 },
  );
}
