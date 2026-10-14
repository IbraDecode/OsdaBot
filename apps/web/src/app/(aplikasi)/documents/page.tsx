/**
 * Halaman Dokumen OSDA BOT — OSIS SMKN 2 Mataram.
 * Pengarsipan surat keputusan (SK), notulen resmi, proposal program, dan berkas organisasi.
 */
'use client';

import { useState } from 'react';
import { JudulHalaman } from '@/components/judul-halaman';
import { Kartu } from '@/components/ui/kartu';
import { Tombol } from '@/components/ui/tombol';
import { Ikon } from '@/components/ikon';
import { tanggal } from '@/lib/format';

interface DokumenResmi {
  readonly id: string;
  readonly judul: string;
  readonly nomorSurat: string;
  readonly jenis: 'SK' | 'Proposal' | 'Notulen' | 'LPJ' | 'Surat';
  readonly tanggalDibuat: string;
  readonly ukuranBerkas: string;
}

const DATA_DOKUMEN_DUMMY: readonly DokumenResmi[] = [
  {
    id: 'doc-1',
    judul: 'SK Penetapan Struktur Pengurus OSIS SMKN 2 Mataram 2026/2027',
    nomorSurat: '001/OSIS/SMKN2/X/2026',
    jenis: 'SK',
    tanggalDibuat: '2026-10-01T00:00:00Z',
    ukuranBerkas: '2.4 MB',
  },
  {
    id: 'doc-2',
    judul: 'Proposal Pengajuan Anggaran Program LDKS & Masa Bakti',
    nomorSurat: '014/PROP/OSIS/X/2026',
    jenis: 'Proposal',
    tanggalDibuat: '2026-10-05T00:00:00Z',
    ukuranBerkas: '1.8 MB',
  },
  {
    id: 'doc-3',
    judul: 'Notulen Resmi Rapat Pleno Koordinasi Awal Periode',
    nomorSurat: '002/NOT/OSIS/X/2026',
    jenis: 'Notulen',
    tanggalDibuat: '2026-10-08T00:00:00Z',
    ukuranBerkas: '850 KB',
  },
  {
    id: 'doc-4',
    judul: 'Surat Undangan Rapat Kerja Pembina dan Perwakilan Kelas',
    nomorSurat: '025/UND/OSIS/X/2026',
    jenis: 'Surat',
    tanggalDibuat: '2026-10-11T00:00:00Z',
    ukuranBerkas: '420 KB',
  },
];

export default function HalamanDokumen() {
  const [kataKunci, setKataKunci] = useState('');
  const [filterJenis, setFilterJenis] = useState('');

  const hasilFilter = DATA_DOKUMEN_DUMMY.filter((doc) => {
    const cocokJenis = !filterJenis || doc.jenis === filterJenis;
    const cocokTeks =
      !kataKunci ||
      doc.judul.toLowerCase().includes(kataKunci.toLowerCase()) ||
      doc.nomorSurat.toLowerCase().includes(kataKunci.toLowerCase());
    return cocokJenis && cocokTeks;
  });

  return (
    <div className="space-y-6">
      <JudulHalaman
        judul="Dokumen & Administrasi"
        deskripsi="Penyimpanan dan verifikasi berkas resmi organisasi OSIS SMKN 2 Mataram."
        aksi={
          <Tombol varian="emas" ukuran="sedang" onClick={() => alert('Fitur unggah arsip terintegrasi')}>
            <Ikon nama="tambah" ukuran={16} />
            <span>Unggah Berkas</span>
          </Tombol>
        }
      />

      {/* Filter Dokumen */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E8E6DF] bg-white p-4 shadow-xs">
        <div className="relative min-w-[260px] flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#A0AEC0]">
            <Ikon nama="cari" ukuran={16} />
          </div>
          <input
            type="text"
            placeholder="Cari berdasarkan judul dokumen atau nomor surat…"
            value={kataKunci}
            onChange={(e) => setKataKunci(e.target.value)}
            className="w-full rounded-xl border border-[#E8E6DF] bg-[#FAF9F6] py-2 pr-4 pl-9 text-xs text-[#0B132B] placeholder-[#A0AEC0] focus:border-[#C5A059] focus:outline-hidden"
          />
        </div>

        <select
          value={filterJenis}
          onChange={(e) => setFilterJenis(e.target.value)}
          className="rounded-xl border border-[#E8E6DF] bg-white px-3 py-2 text-xs text-[#0B132B] focus:border-[#C5A059] focus:outline-hidden"
        >
          <option value="">Semua Jenis Dokumen</option>
          <option value="SK">Surat Keputusan (SK)</option>
          <option value="Proposal">Proposal</option>
          <option value="Notulen">Notulen</option>
          <option value="Surat">Surat Keluar/Masuk</option>
        </select>
      </div>

      {/* Daftar Dokumen Tabel Elegan */}
      <Kartu className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E8E6DF] bg-[#FAF9F6] font-semibold text-[#718096]">
              <tr>
                <th className="px-5 py-3.5">Judul Dokumen</th>
                <th className="px-5 py-3.5">Nomor Surat / Arsip</th>
                <th className="px-5 py-3.5">Jenis</th>
                <th className="px-5 py-3.5">Tanggal</th>
                <th className="px-5 py-3.5">Ukuran</th>
                <th className="px-5 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F4F2EC]">
              {hasilFilter.map((item) => (
                <tr key={item.id} className="hover:bg-[#FAF9F6]/80 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-[#0B132B]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-[#FCF9F2] text-[#93712B] border border-[#C5A059]/20">
                        <Ikon nama="dokumen" ukuran={14} />
                      </div>
                      <span className="truncate max-w-[280px] md:max-w-md">{item.judul}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[#718096]">{item.nomorSurat}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-md border border-[#C5A059]/30 bg-[#FCF9F2] px-2 py-0.5 text-[10px] font-semibold text-[#93712B]">
                      {item.jenis}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[#718096]">{tanggal(item.tanggalDibuat)}</td>
                  <td className="px-5 py-3.5 text-[#A0AEC0]">{item.ukuranBerkas}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => alert(`Mengunduh ${item.judul}`)}
                      className="font-medium text-[#0284c7] hover:underline"
                    >
                      Unduh PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Kartu>
    </div>
  );
}
