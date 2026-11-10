'use client';

import Link from 'next/link';

/** GENESIS — третьеличный хоррор на борту станции (iframe-рантайм из public/games/genesis). */
export function GenesisScreen() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <iframe
        src="/games/genesis/index.html"
        title="GENESIS"
        style={{ width: '100%', height: '100%', border: 'none' }}
        allow="pointer-lock; autoplay; fullscreen"
      />
      <Link
        href="/games"
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 10,
          padding: '6px 12px',
          background: 'rgba(2,6,10,.75)',
          border: '1px solid #1a3a55',
          color: '#9df',
          fontFamily: "'Courier New', monospace",
          fontSize: 'var(--nexus-type-caption-font-size, 13px)',
          letterSpacing: 2,
          textDecoration: 'none',
        }}
      >
        ← В КАТАЛОГ
      </Link>
    </div>
  );
}