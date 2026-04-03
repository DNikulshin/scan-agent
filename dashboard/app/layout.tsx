import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { PushNotificationManager } from '@/components/PushNotificationManager';

const geist = Geist({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ScanAgent',
  description: 'Мониторинг заказов с фриланс-бирж',
  manifest: '/manifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ScanAgent',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: 'ScanAgent',
    title: 'ScanAgent',
    description: 'Мониторинг заказов с фриланс-бирж',
  },
  twitter: {
    card: 'summary',
    title: 'ScanAgent',
    description: 'Мониторинг заказов с фриланс-бирж',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${geist.className} bg-gray-950 text-gray-100 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
