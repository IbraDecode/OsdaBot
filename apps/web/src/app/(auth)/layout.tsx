/**
 * Layout Halaman Masuk OSDA BOT:
 * Desain serius, eksklusif, dan berkelas perpaduan navy gelap dan aksen emas.
 */
import type { ReactNode } from 'react';
import Image from 'next/image';

export const metadata = {
  title: 'Masuk · OSDA BOT',
  description: 'Portal Masuk Pengurus OSIS SMKN 2 Mataram Periode 2026/2027.',
};

export default function LayoutAuth({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#0B132B] px-4 py-12">
      {/* Aksen Latar Belakang Elegan */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 size-96 rounded-full bg-[#1C3166]/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 size-96 rounded-full bg-[#C5A059]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Identitas Logo & Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-[#C5A059]/40 bg-[#132247] p-2 shadow-xl shadow-black/40">
            <Image
              src="/logo.png"
              alt="Logo OSDA BOT SMKN 2 Mataram"
              width={48}
              height={48}
              className="object-contain"
              priority
            />
          </div>
          <h1 className="mt-4 font-serif text-2xl font-bold tracking-wide text-[#FAF9F6]">
            OSDA BOT
          </h1>
          <p className="mt-1 text-xs font-semibold tracking-widest text-[#C5A059] uppercase">
            OSIS SMKN 2 MATARAM
          </p>
          <p className="mt-0.5 text-xs text-[#A0AEC0]">
            Sistem Administrasi &amp; Operasi Organisasi 2026/2027
          </p>
        </div>

        {children}

        {/* Footer Hak Cipta & Keamanan */}
        <p className="mt-6 text-center text-xs text-[#718096]">
          &copy; 2026/2027 OSIS SMKN 2 Mataram · Dilindungi Kebijakan Keamanan RBAC
        </p>
      </div>
    </main>
  );
}
