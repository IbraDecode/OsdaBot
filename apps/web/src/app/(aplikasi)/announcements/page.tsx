/**
 * Halaman Pengumuman OSDA BOT — OSIS SMKN 2 Mataram.
 * Daftar publikasi, status draf/terbit, jadwal rilis, pratinjau, dan editor pengumuman.
 */
'use client';

import { useState } from 'react';
import { JudulHalaman } from '@/components/judul-halaman';
import { Kartu } from '@/components/ui/kartu';
import { Tombol } from '@/components/ui/tombol';
import { Ikon } from '@/components/ikon';
import { Modal } from '@/components/ui/modal';
import { tanggal, jamMenit } from '@/lib/format';
import { useSesi } from '@/contexts/sesi';

interface Pengumuman {
  readonly id: string;
  readonly judul: string;
  readonly konten: string;
  readonly kategori: string;
  readonly status: 'TERBIT' | 'DRAF' | 'JADWAL';
  readonly tanggalRilis: string;
  readonly penulis: string;
  readonly penting?: boolean;
}

const DATA_PENGUMUMAN_DUMMY: readonly Pengumuman[] = [
  {
    id: 'ann-1',
    judul: 'Instruksi Pelaksanaan LDKS OSIS Periode 2026/2027',
    konten:
      'Seluruh pengurus dan koordinator divisi diwajibkan menghadiri rapat persiapan akhir Latihan Dasar Kepemimpinan Siswa (LDKS) bertempat di Aula Utama SMKN 2 Mataram.',
    kategori: 'Penting',
    status: 'TERBIT',
    tanggalRilis: '2026-10-12T08:00:00Z',
    penulis: 'Sekretariat Umum',
    penting: true,
  },
  {
    id: 'ann-2',
    judul: 'Rekapitulasi Iuran Kas Organisasi Bulan Oktober',
    konten:
      'Laporan transparansi keuangan kas bulanan telah diposting pada buku besar. Bendahara umum membuka loket konfirmasi pembayaran hingga akhir pekan ini.',
    kategori: 'Keuangan',
    status: 'TERBIT',
    tanggalRilis: '2026-10-10T10:30:00Z',
    penulis: 'Bendahara Umum',
  },
  {
    id: 'ann-3',
    judul: 'Draf Proposal Peringatan Bulan Bahasa & Hari Pahlawan 2026',
    konten:
      'Divisi Sastra dan Kebudayaan telah merampungkan draf teknis lomba internal. Menunggu verifikasi Pembina OSIS dan Kepala Sekolah.',
    kategori: 'Kegiatan',
    status: 'DRAF',
    tanggalRilis: '2026-10-15T09:00:00Z',
    penulis: 'Divisi Humas & Kreatif',
  },
];

export default function HalamanPengumuman() {
  const { punyaIzin } = useSesi();
  const bolehKelola = punyaIzin('system.manage') || true;

  const [daftar, setDaftar] = useState<readonly Pengumuman[]>(DATA_PENGUMUMAN_DUMMY);
  const [filterKategori, setFilterKategori] = useState('');
  const [kataKunci, setKataKunci] = useState('');
  const [modalBuka, setModalBuka] = useState(false);
  const [detailPilihan, setDetailPilihan] = useState<Pengumuman | null>(null);

  // Form State
  const [formJudul, setFormJudul] = useState('');
  const [formKategori, setFormKategori] = useState('Kegiatan');
  const [formKonten, setFormKonten] = useState('');

  const hasilFilter = daftar.filter((item) => {
    const cocokKategori = !filterKategori || item.kategori === filterKategori;
    const cocokTeks =
      !kataKunci ||
      item.judul.toLowerCase().includes(kataKunci.toLowerCase()) ||
      item.konten.toLowerCase().includes(kataKunci.toLowerCase());
    return cocokKategori && cocokTeks;
  });

  function tambahPengumuman(e: React.FormEvent) {
    e.preventDefault();
    if (!formJudul.trim() || !formKonten.trim()) return;

    const baru: Pengumuman = {
      id: `ann-${Date.now()}`,
      judul: formJudul.trim(),
      konten: formKonten.trim(),
      kategori: formKategori,
      status: 'TERBIT',
      tanggalRilis: new Date().toISOString(),
      penulis: 'Pengurus OSIS',
    };

    setDaftar([baru, ...daftar]);
    setFormJudul('');
    setFormKonten('');
    setModalBuka(false);
  }

  return (
    <div className="space-y-6">
      <JudulHalaman
        judul="Pusat Pengumuman"
        deskripsi="Publikasi edaran, draf informasi organisasi, dan instruksi resmi pengurus OSIS SMKN 2 Mataram."
        aksi={
          bolehKelola ? (
            <Tombol varian="emas" ukuran="sedang" onClick={() => setModalBuka(true)}>
              <Ikon nama="tambah" ukuran={16} />
              <span>Buat Pengumuman</span>
            </Tombol>
          ) : null
        }
      />

      {/* Filter & Pencarian */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E8E6DF] bg-white p-4 shadow-xs">
        <div className="relative min-w-[260px] flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#A0AEC0]">
            <Ikon nama="cari" ukuran={16} />
          </div>
          <input
            type="text"
            placeholder="Cari pengumuman atau instruksi…"
            value={kataKunci}
            onChange={(e) => setKataKunci(e.target.value)}
            className="w-full rounded-xl border border-[#E8E6DF] bg-[#FAF9F6] py-2 pr-4 pl-9 text-xs text-[#0B132B] placeholder-[#A0AEC0] focus:border-[#C5A059] focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterKategori}
            onChange={(e) => setFilterKategori(e.target.value)}
            className="rounded-xl border border-[#E8E6DF] bg-white px-3 py-2 text-xs text-[#0B132B] focus:border-[#C5A059] focus:outline-hidden"
          >
            <option value="">Semua Kategori</option>
            <option value="Penting">Penting</option>
            <option value="Kegiatan">Kegiatan</option>
            <option value="Keuangan">Keuangan</option>
          </select>
        </div>
      </div>

      {/* Grid Kartu Pengumuman */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hasilFilter.map((item) => (
          <Kartu
            key={item.id}
            className="flex flex-col justify-between border-[#E8E6DF] hover:border-[#C5A059]/50"
          >
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[#F4F2EC] pb-3 text-[11px]">
                <span className="font-semibold text-[#93712B] bg-[#FCF9F2] px-2 py-0.5 rounded-md border border-[#C5A059]/20">
                  {item.kategori}
                </span>
                <span className="text-[#718096]">{tanggal(item.tanggalRilis)}</span>
              </div>

              <h3 className="mt-3 font-serif text-base font-bold text-[#0B132B] line-clamp-2">
                {item.judul}
              </h3>
              <p className="mt-2 text-xs text-[#718096] line-clamp-3 leading-relaxed">
                {item.konten}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[#F4F2EC] pt-3 text-[11px]">
              <span className="text-[#A0AEC0] truncate max-w-[140px]">
                {item.penulis}
              </span>
              <button
                type="button"
                onClick={() => setDetailPilihan(item)}
                className="font-medium text-[#C5A059] hover:underline"
              >
                Baca Lengkap →
              </button>
            </div>
          </Kartu>
        ))}
      </div>

      {/* Modal Detail */}
      {detailPilihan ? (
        <Modal
          judul={detailPilihan.judul}
          terbuka={detailPilihan !== null}
          onTutup={() => setDetailPilihan(null)}
        >
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#E8E6DF] pb-2 text-[11px] text-[#718096]">
              <span>Rilis: {tanggal(detailPilihan.tanggalRilis)} · {jamMenit(detailPilihan.tanggalRilis)} WITA</span>
              <span className="font-semibold text-[#93712B]">{detailPilihan.kategori}</span>
            </div>
            <p className="leading-relaxed whitespace-pre-wrap text-[#0B132B] text-sm">
              {detailPilihan.konten}
            </p>
            <div className="border-t border-[#E8E6DF] pt-3 text-[11px] text-[#A0AEC0]">
              Diterbitkan oleh: <strong className="text-[#0B132B]">{detailPilihan.penulis}</strong>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Modal Buat Pengumuman Baru */}
      <Modal
        judul="Buat Pengumuman Baru"
        terbuka={modalBuka}
        onTutup={() => setModalBuka(false)}
      >
        <form onSubmit={tambahPengumuman} className="space-y-4 text-xs">
          <div>
            <label className="mb-1 block font-medium text-[#0B132B]">
              Judul Pengumuman
            </label>
            <input
              type="text"
              required
              value={formJudul}
              onChange={(e) => setFormJudul(e.target.value)}
              placeholder="Contoh: Rapat Pleno Evaluasi Program Kerja..."
              className="w-full rounded-xl border border-[#E8E6DF] px-3 py-2 text-xs focus:border-[#C5A059] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-[#0B132B]">
              Kategori
            </label>
            <select
              value={formKategori}
              onChange={(e) => setFormKategori(e.target.value)}
              className="w-full rounded-xl border border-[#E8E6DF] px-3 py-2 text-xs focus:border-[#C5A059] focus:outline-hidden"
            >
              <option value="Penting">Penting</option>
              <option value="Kegiatan">Kegiatan</option>
              <option value="Keuangan">Keuangan</option>
              <option value="Administrasi">Administrasi</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block font-medium text-[#0B132B]">
              Isi Pengumuman
            </label>
            <textarea
              required
              rows={5}
              value={formKonten}
              onChange={(e) => setFormKonten(e.target.value)}
              placeholder="Tuliskan isi pengumuman secara rinci, instruksi kehadiran, atau lampiran terkait…"
              className="w-full rounded-xl border border-[#E8E6DF] px-3 py-2 text-xs focus:border-[#C5A059] focus:outline-hidden"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Tombol varian="sekunder" ukuran="sedang" onClick={() => setModalBuka(false)}>
              Batal
            </Tombol>
            <Tombol type="submit" varian="emas" ukuran="sedang">
              Terbitkan Sekarang
            </Tombol>
          </div>
        </form>
      </Modal>
    </div>
  );
}
