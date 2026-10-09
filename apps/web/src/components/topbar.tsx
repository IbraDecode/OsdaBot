/**
 * Topbar dasbor: identitas pengguna, ruang kerjanya, jumlah notifikasi belum
 * dibaca, dan tombol keluar.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Ikon } from '@/components/ikon';
import { useSesi } from '@/contexts/sesi';
import { api } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { inisial } from '@/lib/format';
import { labelRuangKerja } from '@/lib/ruang-kerja';

import { Tombol } from './ui/tombol';

/** Bentuk ringkasan notifikasi yang dipakai topbar. */
interface RingkasanNotifikasi {
  readonly belumDibaca?: number;
}

const JUDUL_HALAMAN: Readonly<Record<string, string>> = {
  '/': 'Dasbor',
  '/members': 'Anggota',
  '/attendance': 'Absensi',
  '/meetings': 'Rapat',
  '/tasks': 'Tugas',
  '/programs': 'Program Kerja',
  '/finance': 'Keuangan',
  '/reports': 'Laporan',
  '/settings': 'Pengaturan',
  '/notifications': 'Notifikasi',
};

export function Topbar({ onBukaMenu }: { readonly onBukaMenu: () => void }) {
  const { pengguna, keluar, ruangKerja } = useSesi();
  const jalur = usePathname();
  const [pesanKeluar, setPesanKeluar] = useState<string | null>(null);

  // Lonceng notifikasi hanya tampil bila pengguna boleh membaca notifikasi.
  const bolehLihatNotifikasi = pengguna !== null;
  const { data } = useAmbil<RingkasanNotifikasi>(
    () => api.ambil<RingkasanNotifikasi>('/api/v1/notifications/ringkasan'),
    bolehLihatNotifikasi ? 'ringkasan-notifikasi' : 'tanpa-notifikasi',
  );
  const belumDibaca = data?.belumDibaca ?? 0;

  const judul = JUDUL_HALAMAN[jalur] ?? 'Dasbor OSDA';
  const namaPeran = pengguna?.peran.map((peran) => peran.nama).join(', ') ?? '—';

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <Tombol
        varian="hantu"
        ukuran="kecil"
        className="lg:hidden"
        onClick={onBukaMenu}
        aria-label="Buka menu"
      >
        <Ikon nama="menu" />
      </Tombol>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold text-slate-900">{judul}</h1>
        <p className="truncate text-xs text-slate-500">
          {labelRuangKerja(ruangKerja)} · {namaPeran}
        </p>
      </div>

      <Link
        href="/notifications"
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Notifikasi${belumDibaca > 0 ? `, ${belumDibaca} belum dibaca` : ''}`}
      >
        <Ikon nama="lonceng" />
        {belumDibaca > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {belumDibaca > 99 ? '99+' : belumDibaca}
          </span>
        ) : null}
      </Link>

      <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex">
        <span className="grid size-8 place-items-center rounded-full bg-merek-100 text-xs font-semibold text-merek-700">
          {pengguna ? inisial(pengguna.name) : '?'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{pengguna?.name ?? '—'}</p>
          <p className="truncate text-xs text-slate-500">{pengguna?.email ?? '—'}</p>
        </div>
      </div>

      <Tombol
        varian="sekunder"
        ukuran="kecil"
        onClick={async () => {
          await keluar();
          setPesanKeluar('Anda telah keluar.');
        }}
      >
        <Ikon nama="keluar" ukuran={16} />
        <span className="hidden sm:inline">Keluar</span>
      </Tombol>

      {pesanKeluar ? (
        <span role="status" className="sr-only">
          {pesanKeluar}
        </span>
      ) : null}
    </header>
  );
}
