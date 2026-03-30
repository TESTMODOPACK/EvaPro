import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/providers/QueryProvider';
import I18nProvider from '@/components/I18nProvider';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Ascenda Performance – Evaluación de Desempeño',
  description: 'Plataforma multi-tenant de evaluación de desempeño para empresas',
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
      </body>
    </html>
  );
}
