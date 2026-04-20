import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/providers/QueryProvider';
import I18nProvider from '@/components/I18nProvider';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#C9933A' },
    { media: '(prefers-color-scheme: dark)',  color: '#08090B' },
  ],
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: 'EVA360 — Gestión de Desempeño',
    template: '%s · EVA360',
  },
  description: 'Plataforma de evaluaciones de desempeño 360°, feedback continuo, objetivos OKR, reconocimientos y desarrollo de talento por Ascenda.',
  applicationName: 'EVA360',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'EVA360',
    startupImage: ['/icons/apple-touch-icon.png'],
  },
  icons: {
    icon: [
      { url: '/icons/favicon-16.png', sizes: '16x16',   type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32',   type: 'image/png' },
      { url: '/icons/icon-192.png',   sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png',   sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'apple-mobile-web-app-title': 'EVA360',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), system-ui, -apple-system, sans-serif' }}>
        <I18nProvider>
          <QueryProvider>{children}</QueryProvider>
        </I18nProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
