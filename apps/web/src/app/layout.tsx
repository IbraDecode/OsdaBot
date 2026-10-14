import type { ReactNode } from 'react';
import { Inter, Playfair_Display } from 'next/font/google';

import { PenyediaSesi } from '@/contexts/sesi';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'OSDA BOT · OSIS SMKN 2 MATARAM',
    template: '%s · OSDA BOT',
  },
  description:
    'Sistem Operasi dan Administrasi OSIS SMKN 2 Mataram Periode 2026/2027.',
  applicationName: 'OSDA BOT',
  locale: 'id_ID',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-screen bg-[#FAF9F6] font-sans text-[#0B132B] antialiased">
        <PenyediaSesi>{children}</PenyediaSesi>
      </body>
    </html>
  );
}
