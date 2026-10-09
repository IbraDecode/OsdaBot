/**
 * Layout aplikasi (semua halaman dasbor).
 *
 * Berisi SIDEBAR DINAMIS + TOPBAR. Sidebar disusun dari izin efektif pengguna,
 * bukan dari peran (lihat `src/lib/menu.ts` dan `src/components/sidebar.tsx`).
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { PemuatHalaman } from '@/components/ui/spinner';
import { useSesi } from '@/contexts/sesi';

export default function LayoutAplikasi({ children }: Readonly<{ children: ReactNode }>) {
  const { pengguna, memuat } = useSesi();
  const router = useRouter();
  const [menuTerbuka, setMenuTerbuka] = useState(false);

  // Tanpa sesi → kembalikan ke halaman masuk.
  useEffect(() => {
    if (!memuat && !pengguna) router.replace('/login');
  }, [memuat, pengguna, router]);

  if (memuat) return <PemuatHalaman label="Memuat sesi Anda…" />;
  if (!pengguna) return null; // sedang dialihkan ke /login

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar terbuka={menuTerbuka} onTutup={() => setMenuTerbuka(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onBukaMenu={() => setMenuTerbuka(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
          Otorisasi akhir ditegakkan oleh API OSDA. Menu yang disembunyikan hanya
          pertanyaan kenyamanan, bukan pengaman.
        </footer>
      </div>
    </div>
  );
}
