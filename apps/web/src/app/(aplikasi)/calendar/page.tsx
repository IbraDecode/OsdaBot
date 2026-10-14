/**
 * Halaman Kalender Agenda OSDA BOT — OSIS SMKN 2 Mataram.
 * Penjadwalan agenda rapat, program kerja, hari libur, dan kegiatan organisasi.
 */
'use client';

import { useState } from 'react';
import { JudulHalaman } from '@/components/judul-halaman';
import { Kartu } from '@/components/ui/kartu';
import { Tombol } from '@/components/ui/tombol';
import { Ikon } from '@/components/ikon';
import { jamMenit } from '@/lib/format';

interface AgendaKegiatan {
  readonly id: string;
  readonly judul: string;
  readonly tanggalStr: string;
  readonly waktu: string;
  readonly lokasi: string;
  readonly kategori: 'Rapat' | 'Kegiatan' | 'Upacara' | 'Batas Waktu';
}

const AGENDA_BULAN_INI: readonly AgendaKegiatan[] = [
  {
    id: 'ag-1',
    judul: 'Rapat Pleno Koordinasi Panitia LDKS',
    tanggalStr: '2026-10-14',
    waktu: '14:30',
    lokasi: 'Ruang OSIS SMKN 2 Mataram',
    kategori: 'Rapat',
  },
  {
    id: 'ag-2',
    judul: 'Latihan Gabungan Pasukan Pengibar Bendera',
    tanggalStr: '2026-10-16',
    waktu: '16:00',
    lokasi: 'Lapangan Utama Sekolah',
    kategori: 'Kegiatan',
  },
  {
    id: 'ag-3',
    judul: 'Batas Akhir Pengumpulan LPJ Kegiatan Bulan Lalu',
    tanggalStr: '2026-10-20',
    waktu: '23:59',
    lokasi: 'Portal OSDA BOT',
    kategori: 'Batas Waktu',
  },
  {
    id: 'ag-4',
    judul: 'Peringatan Hari Sumpah Pemuda & Bulan Bahasa',
    tanggalStr: '2026-10-28',
    waktu: '07:30',
    lokasi: 'Aula & Halaman Sekolah',
    kategori: 'Upacara',
  },
];

export default function HalamanKalender() {
  const [filterKategori, setFilterKategori] = useState('');

  const agendaTerpilih = AGENDA_BULAN_INI.filter(
    (ag) => !filterKategori || ag.kategori === filterKategori,
  );

  return (
    <div className="space-y-6">
      <JudulHalaman
        judul="Kalender Kegiatan"
        deskripsi="Jadwal menyeluruh kegiatan, agenda rapat, dan tenggat waktu kepengurusan OSIS 2026/2027."
        aksi={
          <Tombol varian="emas" ukuran="sedang" onClick={() => alert('Jadwal baru tersimpan')}>
            <Ikon nama="tambah" ukuran={16} />
            <span>Tambah Agenda</span>
          </Tombol>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Kolom Kiri: Matriks Kalender Bulanan (7 kolom) */}
        <div className="lg:col-span-7">
          <Kartu
            judul="Oktober 2026"
            deskripsi="Jadwal kalender operasional semester ganjil"
            aksi={
              <span className="font-serif text-xs font-bold text-[#C5A059]">
                Tahun Ajaran 2026/2027
              </span>
            }
          >
            {/* Grid 7 Hari */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[#718096] pb-2 border-b border-[#F4F2EC]">
              <span>Min</span>
              <span>Sen</span>
              <span>Sel</span>
              <span>Rab</span>
              <span>Kam</span>
              <span>Jum</span>
              <span>Sab</span>
            </div>

            <div className="grid grid-cols-7 gap-1 pt-2 text-center text-xs">
              {/* Dummy hari bulan Oktober 2026 */}
              {Array.from({ length: 31 }, (_, i) => i + 1).map((hari) => {
                const adaAgenda = [14, 16, 20, 28].includes(hari);
                const hariIni = hari === 13;
                return (
                  <div
                    key={hari}
                    className={`relative flex min-h-[52px] flex-col items-center justify-start rounded-xl p-1 border transition-all ${
                      hariIni
                        ? 'border-[#C5A059] bg-[#FCF9F2] text-[#93712B] font-bold shadow-2xs'
                        : 'border-transparent hover:bg-[#FAF9F6] text-[#0B132B]'
                    }`}
                  >
                    <span className="text-[11px]">{hari}</span>
                    {adaAgenda ? (
                      <span className="mt-1 size-1.5 rounded-full bg-[#C5A059]" />
                    ) : null}
                    {hariIni ? (
                      <span className="text-[8px] font-semibold text-[#C5A059]">Hari Ini</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Kartu>
        </div>

        {/* Kolom Kanan: Rincian Kegiatan Mendatang (5 kolom) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-base font-bold text-[#0B132B]">
              Agenda Mendatang
            </h2>
            <select
              value={filterKategori}
              onChange={(e) => setFilterKategori(e.target.value)}
              className="rounded-xl border border-[#E8E6DF] bg-white px-2.5 py-1 text-xs text-[#0B132B]"
            >
              <option value="">Semua Agenda</option>
              <option value="Rapat">Rapat</option>
              <option value="Kegiatan">Kegiatan</option>
              <option value="Upacara">Upacara</option>
              <option value="Batas Waktu">Batas Waktu</option>
            </select>
          </div>

          <div className="space-y-3">
            {agendaTerpilih.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-2xl border border-[#E8E6DF] bg-white p-4 shadow-xs hover:border-[#C5A059]/40 transition-colors"
              >
                <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl border border-[#C5A059]/30 bg-[#FCF9F2] text-[#93712B]">
                  <span className="text-[10px] uppercase font-bold leading-none">Okt</span>
                  <span className="font-serif text-sm font-bold leading-tight">
                    {item.tanggalStr.slice(8, 10)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-bold text-[#0B132B]">
                      {item.judul}
                    </span>
                    <span className="rounded bg-[#FAF9F6] px-1.5 py-0.5 text-[9px] font-semibold text-[#718096] border border-[#E8E6DF]">
                      {item.kategori}
                    </span>
                  </div>

                  <p className="mt-1 text-[11px] text-[#718096] flex items-center gap-1">
                    <span>⏰ {item.waktu} WITA</span>
                    <span>·</span>
                    <span className="truncate">📍 {item.lokasi}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
