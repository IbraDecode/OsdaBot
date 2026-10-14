/**
 * Topbar Dasbor OSDA BOT:
 * Kolom pencarian cepat, notifikasi dengan badge, profil pengguna,
 * jabatan, dan dropdown akun dengan tema ivory terang yang menyatu ke konten.
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

interface RingkasanNotifikasi {
  readonly belumDibaca?: number;
}

const JUDUL_HALAMAN: Readonly<Record<string, string>> = {
  '/': 'Dashboard Utama',
  '/members': 'Manajemen Anggota',
  '/attendance': 'Kehadiran & Absensi',
  '/meetings': 'Jadwal & Notulen Rapat',
  '/tasks': 'Manajemen Tugas',
  '/programs': 'Program Kerja OSIS',
  '/finance': 'Keuangan & Kas Organisasi',
  '/announcements': 'Pusat Pengumuman',
  '/documents': 'Arsip & Dokumen Resmi',
  '/calendar': 'Kalender Agenda',
  '/reports': 'Laporan & Rekapitulasi',
  '/settings': 'Pengaturan Sistem',
  '/notifications': 'Pemberitahuan',
};

export function Topbar({ onBukaMenu }: { readonly onBukaMenu: () => void }) {
  const { pengguna, keluar, ruangKerja } = useSesi();
  const jalur = usePathname();
  const [dropdownTerbuka, setDropdownTerbuka] = useState(false);
  const [kataKunciCari, setKataKunciCari] = useState('');

  const bolehLihatNotifikasi = pengguna !== null;
  const { data } = useAmbil<RingkasanNotifikasi>(
    () => api.ambil<RingkasanNotifikasi>('/api/v1/notifications/ringkasan'),
    bolehLihatNotifikasi ? 'ringkasan-notifikasi' : 'tanpa-notifikasi',
  );
  const belumDibaca = data?.belumDibaca ?? 0;

  const judul = JUDUL_HALAMAN[jalur] ?? 'Dasbor OSDA';
  const namaPeran =
    pengguna?.peran && pengguna.peran.length > 0
      ? pengguna.peran.map((p) => p.nama).join(', ')
      : 'Pengurus OSIS';

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#E8E6DF] bg-[#FAF9F6]/90 px-4 py-3 backdrop-blur-md md:px-8">
      {/* Kiri: Tombol Menu Mobile & Judul Bagian */}
      <div className="flex items-center gap-3">
        <Tombol
          varian="hantu"
          ukuran="kecil"
          className="text-[#0B132B] lg:hidden"
          onClick={onBukaMenu}
          aria-label="Buka navigasi"
        >
          <Ikon nama="menu" />
        </Tombol>
        <div>
          <h1 className="font-serif text-base font-bold text-[#0B132B] md:text-lg">
            {judul}
          </h1>
          <p className="hidden text-xs text-[#718096] sm:block">
            {labelRuangKerja(ruangKerja)} · OSIS SMKN 2 Mataram
          </p>
        </div>
      </div>

      {/* Tengah: Kolom Pencarian Cepat */}
      <div className="mx-4 hidden max-w-md flex-1 md:block">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#A0AEC0]">
            <Ikon nama="cari" ukuran={16} />
          </div>
          <input
            type="text"
            placeholder="Cari anggota, agenda, tugas, atau dokumen…"
            value={kataKunciCari}
            onChange={(e) => setKataKunciCari(e.target.value)}
            className="w-full rounded-full border border-[#E8E6DF] bg-white py-1.5 pr-4 pl-9 text-xs text-[#0B132B] placeholder-[#A0AEC0] shadow-2xs transition-all focus:border-[#C5A059] focus:bg-white focus:ring-1 focus:ring-[#C5A059] focus:outline-hidden"
          />
        </div>
      </div>

      {/* Kanan: Notifikasi, Avatar & Dropdown Akun */}
      <div className="flex items-center gap-3">
        <Link
          href="/notifications"
          className="relative rounded-full border border-[#E8E6DF] bg-white p-2 text-[#4A5568] shadow-2xs transition-colors hover:border-[#C5A059] hover:text-[#0B132B]"
          aria-label={`Notifikasi${belumDibaca > 0 ? `, ${belumDibaca} baru` : ''}`}
        >
          <Ikon nama="lonceng" ukuran={18} />
          {belumDibaca > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E53E3E] px-1 text-[9px] font-bold text-white shadow-xs">
              {belumDibaca > 99 ? '99+' : belumDibaca}
            </span>
          ) : null}
        </Link>

        {/* Profil & Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownTerbuka(!dropdownTerbuka)}
            className="flex items-center gap-2.5 rounded-full border border-[#E8E6DF] bg-white p-1 pr-3 text-left shadow-2xs transition-colors hover:border-[#C5A059] focus:outline-hidden"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0B132B] font-serif text-xs font-bold text-[#FAF9F6] shadow-xs">
              {pengguna ? inisial(pengguna.name) : 'OS'}
            </span>
            <div className="hidden text-left md:block">
              <p className="max-w-[130px] truncate text-xs font-semibold text-[#0B132B]">
                {pengguna?.name ?? 'Pengurus'}
              </p>
              <p className="max-w-[130px] truncate text-[10px] text-[#C5A059] font-medium">
                {namaPeran}
              </p>
            </div>
            <Ikon nama="panah-bawah" ukuran={14} className="text-[#A0AEC0]" />
          </button>

          {dropdownTerbuka ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 bg-transparent"
                onClick={() => setDropdownTerbuka(false)}
                aria-label="Tutup menu pengguna"
              />
              <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-[#E8E6DF] bg-white p-2 shadow-xl animate-in fade-in zoom-in-95 duration-100">
                <div className="border-b border-[#E8E6DF] px-3 py-2 text-xs">
                  <p className="font-semibold text-[#0B132B]">{pengguna?.name}</p>
                  <p className="truncate text-[#718096]">{pengguna?.email}</p>
                  <div className="mt-1 inline-block rounded bg-[#C5A059]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#93712B]">
                    {namaPeran}
                  </div>
                </div>

                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setDropdownTerbuka(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#4A5568] hover:bg-[#FAF9F6] hover:text-[#0B132B]"
                  >
                    <Ikon nama="pengaturan" ukuran={16} />
                    <span>Pengaturan Akun</span>
                  </Link>
                </div>

                <div className="border-t border-[#E8E6DF] pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setDropdownTerbuka(false);
                      await keluar();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Ikon nama="keluar" ukuran={16} />
                    <span>Keluar dari Akun</span>
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
