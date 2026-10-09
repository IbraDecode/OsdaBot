/**
 * Root layout Dasbor OSDA.
 *
 * Penyedia sesi dipasang di sini agar seluruh halaman (termasuk halaman
 * masuk) dapat membaca pengguna yang sedang login beserta izin efektifnya.
 */
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import { PenyediaSesi } from '@/contexts/sesi';

import './globals.css';

/** Font Inter (Google Fonts) — diekspor sebagai variabel CSS `--font-inter`. */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Dasbor OSDA',
    template: '%s · Dasbor OSDA',
  },
  description:
    'OSDA Platform — OSIS Digital Administration & Operations Platform. ' +
    'Satu sistem untuk mengelola organisasi, satu sumber data untuk semua.',
  applicationName: 'Dasbor OSDA',
  locale: 'id_ID',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <PenyediaSesi>{children}</PenyediaSesi>
      </body>
    </html>
  );
}
