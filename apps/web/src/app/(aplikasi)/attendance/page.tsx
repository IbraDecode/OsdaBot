/**
 * Halaman Absensi — daftar sesi absensi.
 *
 * Tombol "Buka sesi" / "Tutup sesi" hanya tampil bila pengguna punya izin
 * `attendance.manage` (penyembunyian untuk UX; API tetap memutuskan).
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { Paginasi } from '@/components/paginasi';
import { useSesi } from '@/contexts/sesi';
import { api, pesanDariGalat } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { angka, labelStatus, tanggalPendek, persen } from '@/lib/format';
import type { HasilDaftar, RekapSesi, SesiAbsensi, StatusSesi } from '@osda/contracts';
import { STATUS_SESI } from '@osda/contracts/enums';

import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';

export default function HalamanAbsensi() {
  const { punyaIzin } = useSesi();
  const bolehKelolaSesi = punyaIzin('attendance.manage');

  const [halaman, setHalaman] = useState(1);
  const [batas, setBatas] = useState(20);
  const [status, setStatus] = useState<StatusSesi | ''>('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [sesiRekap, setSesiRekap] = useState<string | null>(null);
  const [memprosesId, setMemprosesId] = useState<string | null>(null);

  const kunci = `attendance:${status}:${halaman}:${batas}`;

  const { data, memuat, galat, muatUlang } = useAmbil<HasilDaftar<SesiAbsensi>>(
    () =>
      api.ambil<HasilDaftar<SesiAbsensi>>('/api/v1/attendance/sessions', {
        status: status || undefined,
        page: halaman,
        limit: batas,
      }),
    kunci,
  );

  async function ubahStatusSesi(id: string, aksi: 'buka' | 'tutup') {
    setMemprosesId(id);
    setPesan(null);
    try {
      await api.kirim(`/api/v1/attendance/sessions/${id}/${aksi}`, {});
      setPesan(aksi === 'buka' ? 'Sesi absensi berhasil dibuka.' : 'Sesi absensi berhasil ditutup.');
      muatUlang();
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    } finally {
      setMemprosesId(null);
    }
  }

  return (
    <div>
      <JudulHalaman
        judul="Absensi"
        deskripsi="Sesi absensi rapat, kegiatan, dan latihan beserta rekap kehadirannya."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="w-56">
          <label htmlFor="filter-status-sesi" className="mb-1 block text-sm font-medium text-slate-700">
            Status sesi
          </label>
          <select
            id="filter-status-sesi"
            value={status}
            onChange={(peristiwa) => {
              setStatus(peristiwa.target.value as StatusSesi | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua status</option>
            {STATUS_SESI.map((satu) => (
              <option key={satu} value={satu}>
                {labelStatus(satu)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {pesan ? (
        <div className="mb-3">
          <Peringatan nada={pesan.startsWith('Sesi absensi berhasil') ? 'sukses' : 'bahaya'}>
            {pesan}
          </Peringatan>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {galat ? (
          <div className="p-4">
            <Peringatan nada="bahaya" judul="Gagal memuat sesi">
              {galat}
            </Peringatan>
          </div>
        ) : null}

        {memuat && !data ? (
          <div className="p-4">
            <Pemuat label="Memuat sesi absensi…" />
          </div>
        ) : null}

        <Tabel
          kolom={[
            { kunci: 'judul', judul: 'Sesi', nilai: (baris) => baris.judul },
            {
              kunci: 'jenis',
              judul: 'Jenis',
              nilai: (baris) => <LencanaStatus status={baris.jenis} />,
            },
            {
              kunci: 'tanggal',
              judul: 'Tanggal',
              nilai: (baris) => tanggalPendek(baris.tanggal),
            },
            {
              kunci: 'lokasi',
              judul: 'Lokasi',
              nilai: (baris) => baris.lokasi ?? '—',
            },
            {
              kunci: 'sudahHadir',
              judul: 'Kehadiran',
              nilai: (baris) => (
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">
                    {angka(baris.sudahHadir)}/{angka(baris.totalWajib)}
                  </span>
                  {baris.totalWajib > 0 ? (
                    <Lencana warna={baris.sudahHadir < baris.totalWajib ? 'kuning' : 'hijau'}>
                      {persen((baris.sudahHadir / baris.totalWajib) * 100, 0)}
                    </Lencana>
                  ) : null}
                </span>
              ),
            },
            {
              kunci: 'status',
              judul: 'Status',
              nilai: (baris) => (
                <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />
              ),
            },
          ]}
          data={data?.data ?? []}
          kunciBaris={(baris) => baris.id}
          memuat={memuat && !data}
          pesanKosong="Belum ada sesi absensi."
          aksi={(baris) => (
            <span className="flex justify-end gap-2">
              <Tombol ukuran="kecil" onClick={() => setSesiRekap(baris.id)}>
                Rekap
              </Tombol>

              {/* Aksi buka/tutup hanya untuk pemegang izin attendance.manage */}
              {bolehKelolaSesi && baris.status !== 'OPEN' ? (
                <Tombol
                  ukuran="kecil"
                  varian="utama"
                  memuat={memprosesId === baris.id}
                  onClick={() => ubahStatusSesi(baris.id, 'buka')}
                >
                  Buka sesi
                </Tombol>
              ) : null}
              {bolehKelolaSesi && baris.status === 'OPEN' ? (
                <Tombol
                  ukuran="kecil"
                  varian="bahaya"
                  memuat={memprosesId === baris.id}
                  onClick={() => ubahStatusSesi(baris.id, 'tutup')}
                >
                  Tutup sesi
                </Tombol>
              ) : null}
            </span>
          )}
        />

        {data ? (
          <div className="px-4">
            <Paginasi
              halaman={data.meta.page}
              totalHalaman={data.meta.totalPages}
              total={data.meta.total}
              batas={batas}
              onUbah={setHalaman}
              onUbahBatas={(nilai) => {
                setBatas(nilai);
                setHalaman(1);
              }}
            />
          </div>
        ) : null}
      </div>

      {!bolehKelolaSesi ? (
        <p className="mt-3 text-xs text-slate-400">
          Anda tidak memiliki izin <code className="font-mono">attendance.manage</code>, sehingga
          tombol buka/tutup sesi tidak ditampilkan.
        </p>
      ) : null}

      {sesiRekap ? (
        <ModalRekap idSesi={sesiRekap} onTutup={() => setSesiRekap(null)} />
      ) : null}
    </div>
  );
}

/** Modal rekap kehadiran satu sesi (hanya dimount saat ada sesi dipilih). */
function ModalRekap({
  idSesi,
  onTutup,
}: {
  readonly idSesi: string;
  readonly onTutup: () => void;
}) {
  const { data, memuat, galat } = useAmbil<RekapSesi>(
    () => api.ambil<RekapSesi>(`/api/v1/attendance/sessions/${idSesi}/recap`),
    `rekap:${idSesi}`,
  );

  return (
    <Modal
      terbuka={idSesi !== null}
      judul="Rekap kehadiran sesi"
      deskripsi={data ? `${data.judul} · ${tanggalPendek(data.tanggal)}` : undefined}
      onTutup={onTutup}
      lebar="lebar"
    >
      {memuat ? <Pemuat label="Memuat rekap…" /> : null}
      {galat ? (
        <Peringatan nada="bahaya" judul="Gagal memuat rekap">
          {galat}
        </Peringatan>
      ) : null}
      {data ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Baris label="Hadir" nilai={angka(data.statistik.hadir)} />
            <Baris label="Izin" nilai={angka(data.statistik.izin)} />
            <Baris label="Sakit" nilai={angka(data.statistik.sakit)} />
            <Baris label="Tidak hadir" nilai={angka(data.statistik.tidakHadir)} />
            <Baris label="Belum absen" nilai={angka(data.statistik.belumAbsen)} />
            <Baris label="Persentase hadir" nilai={persen(data.statistik.persenHadir)} />
          </dl>

          <KelompokNama judul="Belum absen" anggota={data.belumAbsen} />
          <KelompokNama judul="Tidak hadir" anggota={data.tidakHadir} />
          <KelompokNama judul="Izin" anggota={data.izin} />
        </div>
      ) : null}
    </Modal>
  );
}

function Baris({ label, nilai }: { readonly label: string; readonly nilai: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 tabular-nums">{nilai}</dd>
    </div>
  );
}

function KelompokNama({
  judul,
  anggota,
}: {
  readonly judul: string;
  readonly anggota: readonly { memberId: string; nama: string }[];
}) {
  if (anggota.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{judul}</p>
      <p className="text-sm text-slate-700">{anggota.map((satu) => satu.nama).join(', ')}</p>
    </div>
  );
}
