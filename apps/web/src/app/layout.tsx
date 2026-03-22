import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/QueryProvider';

export const metadata: Metadata = {
  title: 'EvaPro – Evaluación de Desempeño',
  description: 'Plataforma multi-tenant de evaluación de desempeño para empresas',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
