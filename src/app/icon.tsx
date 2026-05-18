import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * App icon — rust square with "A" wordmark.
 * Used by browsers as favicon, by PWA install (home screen),
 * and by the manifest's icons array.
 */
export default function Icon() {
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
          fontSize: 340,
          fontWeight: 800,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.04em',
          borderRadius: 96,
        }}
      >
        A
      </div>
    ),
    { ...size },
  );
}
