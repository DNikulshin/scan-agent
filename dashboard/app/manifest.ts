import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ScanAgent',
    short_name: 'ScanAgent',
    description: 'Мониторинг заказов с фриланс-бирж',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#030712',
    theme_color: '#030712',
    icons: [
      {
        src: '/icons/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
