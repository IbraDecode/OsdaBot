/**
 * Halaman Laporan — pratinjau laporan dan unduh CSV.
 *
 * Endpoint: `POST /api/v1/reports/:jenis/export` (izin `report.export`)
 * untuk berkas CSV, dan `GET /api/v1/reports/:jenis` untuk pratinjau.
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin, CatatanIzin } from '@/components/penjaga-izin';
import { useSesi } from '@/contexts/sesi';
import { api } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';

import { Modal } from '@/components/ui/modal';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tombol } from '@/components/ui/tombol';

/** Jenis laporan yang didukung API. */
type JenisLaporan = 'ABSENSI' | 'ANGGOTA' | 'KEUANGAN' | 'PROGRAM' | 'TUGAS';

/** Jalur GET untuk pratinjau tiap jenis laporan. */
const RUTE_PRATINJAU: Readonly<Record<JenisLaporan, string>> = {
  ABSENSI: '/api/v1/reports/attendance',
  ANGGOTA: '/api/v1/reports/members',
  KEUANGAN: '/api/v1/reports/finance',
  PROGRAM: '/api/v1/reports/programs',
  TUGAS: '/api/v1/reports/tasks',
};

const DAFTAR_LAPORAN: readonly {
  readonly jenis: JenisLaporan;
  readonly judul: string;
  readonly deskripsi: string;
}[] = [
  {
    jenis: 'ABSENSI',
    judul: 'Laporan Absensi',
    deskripsi: 'Kehadiran per sesi: hadir, izin, sakit, tidak hadir.',
  },
  {
    jenis: 'ANGGOTA',
    judul: 'Laporan Anggota',
    deskripsi: 'Daftar anggota, kelas, divisi, dan status keanggotaan.',
  },
  {
    jenis: 'KEUANGAN',
    judul: 'Laporan Keuangan',
    deskripsi: 'Arus kas dan buku besar pada periode aktif.',
  },
  {
    jenis: 'PROGRAM',
    judul: 'Laporan Program',
    deskripsi: 'Anggaran, realisasi, dan progres program kerja.',
  },
  {
    jenis: 'TUGAS',
    judul: 'Laporan Tugas',
    deskripsi: 'Status, verifikasi, dan tenggat tugas.',
  },
];

export default function HalamanLaporan() {
  const { punyaIzin } = useSesi();
  const bolehEkspor = punyaIzin('report.export');
  const [pratinjau, setPratinjau] = useState<JenisLaporan | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [memproses, setMemproses] = useState<JenisLaporan | null>(null);

  async function unduhCsv(jenis: JenisLaporan) {
    setMemproses(jenis);
    setPesan(null);
    try {
      await api.unduh(`/api/v1/reports/${jenis}/export`, {
        namaBerkas: `laporan-${jenis.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
        metode: 'POST',
      });
      setPesan(`Laporan ${jenis.toLowerCase()} berhasil diunduh.`);
    } catch (kesalahan: unknown) {
      setPesan(kesalahan instanceof Error ? kesalahan.message : 'Unduhan gagal.');
    } finally {
      setMemproses(null);
    }
  }

  return (
    <PenjagaIzin izin="report.read" pesanTolak="Anda tidak memiliki izin untuk melihat laporan.">
      <div>
        <JudulHalaman
          judul="Laporan"
          deskripsi="Unduh laporan organisasi dalam format CSV (XLSX/PDF dibuat terpisah)."
        />

        {pesan ? (
          <Peringatan
            className="mb-3"
            nada={pesan.includes('berhasil') ? 'sukses' : 'bahaya'}
          >
            {pesan}
          </Peringatan>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {DAFTAR_LAPORAN.map((laporan) => (
            <div
              key={laporan.jenis}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{laporan.judul}</h2>
                <p className="mt-1 text-sm text-slate-500">{laporan.deskripsi}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Tombol ukuran="kecil" varian="sekunder" onClick={() => setPratinjau(laporan.jenis)}>
                  Pratinjau
                </Tombol>
                {bolehEkspor ? (
                  <Tombol
                    ukuran="kecil"
                    varian="utama"
                    memuat={memproses === laporan.jenis}
                    onClick={() => unduhCsv(laporan.jenis)}
                  >
                    Unduh CSV
                  </Tombol>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <CatatanIzin izin="report.read" />
      </div>

      {pratinjau ? (
        <ModalPratinjau jenis={pratinjau} onTutup={() => setPratinjau(null)} />
      ) : null}
    </PenjagaIzin>
  );
}

/** Modal pratinjau berbentuk JSON mentah (aman untuk semua bentuk laporan). */
function ModalPratinjau({
  jenis,
  onTutup,
}: {
  readonly jenis: JenisLaporan;
  readonly onTutup: () => void;
}) {
  const { data, memuat, galat } = useAmbil<unknown>(
    () => api.ambil<unknown>(RUTE_PRATINJAU[jenis], { limit: 10 }),
    `pratinjau:${jenis}`,
  );

  return (
    <Modal
      terbuka
      judul={`Pratinjau laporan ${jenis.toLowerCase()}`}
      deskripsi="Maksimal 10 baris pertama. Gunakan unduhan CSV untuk data lengkap."
      onTutup={onTutup}
      lebar="lebar"
      kaki={
        <Tombol varian="sekunder" onClick={onTutup}>
          Tutup
        </Tombol>
      }
    >
      {memuat ? <Pemuat label="Memuat pratinjau…" /> : null}
      {galat ? (
        <Peringatan nada="bahaya" judul="Gagal memuat pratinjau">

          {galat}
        </Peringatan>
      ) : null}
      {data ? (
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : null}
    </Modal>
  );
}
