/**
 * Halaman Tugas — daftar tugas dengan badge status & verifikasi.
 *
 * Aturan domain penting: status `DONE` belum berarti selesai. Bila verifikasi
 * masih `UNVERIFIED`, tugas harus tampil JELAS menunggu pengesahan (spec §47).
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { Paginasi } from '@/components/paginasi';
import { useSesi } from '@/contexts/sesi';
import { api, pesanDariGalat } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { angka, labelSisaHari, tanggalPendek } from '@/lib/format';
import type { HasilDaftar, PrioritasTugas, StatusTugas, StatusVerifikasi, Tugas } from '@osda/contracts';
import { PRIORITAS_TUGAS, STATUS_TUGAS } from '@osda/contracts/enums';

import { Bidang } from '@/components/ui/input';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';
import { cn } from '@/lib/gaya';

export default function HalamanTugas() {
  const { punyaIzin } = useSesi();
  const bolehTulisTugas = punyaIzin('task.write');
  const bolehVerifikasi = punyaIzin('task.verify');

  const [halaman, setHalaman] = useState(1);
  const [batas] = useState(20);
  const [status, setStatus] = useState<StatusTugas | ''>('');
  const [prioritas, setPrioritas] = useState<PrioritasTugas | ''>('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [memprosesId, setMemprosesId] = useState<string | null>(null);
  const [tugasVerifikasi, setTugasVerifikasi] = useState<Tugas | null>(null);

  const { data, memuat, galat, muatUlang } = useAmbil<HasilDaftar<Tugas>>(
    () =>
      api.ambil<HasilDaftar<Tugas>>('/api/v1/tasks', {
        status: status || undefined,
        prioritas: prioritas || undefined,
        page: halaman,
        limit: batas,
      }),
    `tugas:${status}:${prioritas}:${halaman}`,
  );

  async function tandaiSelesai(id: string) {
    setMemprosesId(id);
    setPesan(null);
    try {
      await api.kirim(`/api/v1/tasks/${id}/status`, { status: 'DONE' });
      setPesan('Tugas ditandai selesai. Menunggu verifikasi bila diperlukan.');
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
        judul="Tugas"
        deskripsi="DONE belum berarti VERIFIED — tugas yang butuh verifikasi harus disahkan terpisah."
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <Bidang label="Status" htmlFor="filter-status-tugas">
          <select
            id="filter-status-tugas"
            value={status}
            onChange={(peristiwa) => {
              setStatus(peristiwa.target.value as StatusTugas | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua status</option>
            {STATUS_TUGAS.map((satu) => (
              <option key={satu} value={satu}>
                {satu.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Bidang>

        <Bidang label="Prioritas" htmlFor="filter-prioritas-tugas">
          <select
            id="filter-prioritas-tugas"
            value={prioritas}
            onChange={(peristiwa) => {
              setPrioritas(peristiwa.target.value as PrioritasTugas | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua prioritas</option>
            {PRIORITAS_TUGAS.map((satu) => (
              <option key={satu} value={satu}>
                {satu}
              </option>
            ))}
          </select>
        </Bidang>
      </div>

      {pesan ? <Peringatan className="mb-3" nada="bahaya" judul="Info">{pesan}</Peringatan> : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {galat ? (
          <div className="p-4">
            <Peringatan nada="bahaya" judul="Gagal memuat tugas">

              {galat}
            </Peringatan>
          </div>
        ) : null}

        {memuat && !data ? (
          <div className="p-4">
            <Pemuat label="Memuat daftar tugas…" />
          </div>
        ) : null}

        <Tabel
          kolom={[
            { kunci: 'kode', judul: 'Kode', nilai: (baris) => baris.kode },
            {
              kunci: 'judul',
              judul: 'Tugas',
              nilai: (baris) => (
                <div>
                  <p className="font-medium text-slate-900">{baris.judul}</p>
                  <p className="text-xs text-slate-500">
                    {baris.divisionNama ?? 'Tanpa divisi'}
                    {baris.programNama ? ` · ${baris.programNama}` : ''}
                  </p>
                </div>
              ),
            },
            {
              kunci: 'assignee',
              judul: 'Penanggung jawab',
              nilai: (baris) =>
                baris.assignee.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  baris.assignee.map((satu) => satu.nama).join(', ')
                ),
            },
            {
              kunci: 'prioritas',
              judul: 'Prioritas',
              nilai: (baris) => <LencanaStatus status={baris.prioritas} />,
            },
            {
              kunci: 'batasWaktu',
              judul: 'Batas',
              nilai: (baris) => (
                <span className={baris.overdue ? 'font-medium text-red-600' : ''}>
                  {baris.batasWaktu ? tanggalPendek(baris.batasWaktu) : '—'}
                  {baris.overdue ? ` (${labelSisaHari(baris.batasWaktu)})` : ''}
                </span>
              ),
            },
            {
              kunci: 'status',
              judul: 'Status',
              nilai: (baris) => <LencanaStatus status={baris.status} />,
            },
            {
              kunci: 'verifikasi',
              judul: 'Verifikasi',
              nilai: (baris) => <LencanaVerifikasi status={baris.status} verifikasi={baris.verifikasi} butuh={baris.butuhVerifikasi} />,
            },
          ]}
          data={data?.data ?? []}
          kunciBaris={(baris) => baris.id}
          memuat={memuat && !data}
          pesanKosong="Belum ada tugas."
          barisClassName={(baris) =>
            baris.status === 'DONE' && baris.verifikasi === 'UNVERIFIED' ? 'bg-amber-50/70' : undefined
          }
          aksi={(baris) => (
            <span className="flex justify-end gap-2">
              {bolehTulisTugas && baris.status !== 'DONE' && baris.status !== 'CANCELLED' ? (
                <Tombol
                  ukuran="kecil"
                  varian="sekunder"
                  memuat={memprosesId === baris.id}
                  onClick={() => tandaiSelesai(baris.id)}
                >
                  Tandai selesai
                </Tombol>
              ) : null}
              {bolehVerifikasi && baris.status === 'DONE' && baris.verifikasi === 'UNVERIFIED' ? (
                <Tombol ukuran="kecil" varian="utama" onClick={() => setTugasVerifikasi(baris)}>
                  Verifikasi
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
            />
          </div>
        ) : null}

        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
          Tombol aksi mengikuti izin <code className="font-mono">task.write</code> dan{' '}
          <code className="font-mono">task.verify</code>. Server tetap memeriksa setiap tindakan.
        </p>
      </div>

      {tugasVerifikasi ? (
        <ModalVerifikasi
          tugas={tugasVerifikasi}
          onTutup={() => setTugasVerifikasi(null)}
          onSelesai={(teks) => {
            setPesan(teks);
            setTugasVerifikasi(null);
            muatUlang();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Lencana verifikasi.
 * `DONE` + `UNVERIFIED` ditandai khusus karena sering tertukar dengan "selesai".
 */
function LencanaVerifikasi({
  status,
  verifikasi,
  butuh,
}: {
  readonly status: StatusTugas;
  readonly verifikasi: StatusVerifikasi;
  readonly butuh: boolean;
}) {
  if (status !== 'DONE') {
    return <span className="text-xs text-slate-400">—</span>;
  }
  if (verifikasi === 'VERIFIED') {
    return <Lencana warna="hijau">Terverifikasi</Lencana>;
  }
  if (verifikasi === 'REJECTED') {
    return <Lencana warna="merah">Ditolak</Lencana>;
  }
  return (
    <Lencana warna="kuning" judul={butuh ? 'Menunggu pengesahan' : 'Tidak wajib verifikasi'}>
      Perlu verifikasi
    </Lencana>
  );
}

/** Modal keputusan verifikasi (izin `task.verify`). */
function ModalVerifikasi({
  tugas,
  onTutup,
  onSelesai,
}: {
  readonly tugas: Tugas;
  readonly onTutup: () => void;
  readonly onSelesai: (pesan: string) => void;
}) {
  const [keputusan, setKeputusan] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED');
  const [komentar, setKomentar] = useState('');
  const [memproses, setMemproses] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function kirim() {
    if (komentar.trim().length < 3) {
      setGalat('Komentar minimal 3 karakter agar jejak audit jelas.');
      return;
    }
    setMemproses(true);
    setGalat(null);
    try {
      await api.kirim(`/api/v1/tasks/${tugas.id}/verifikasi`, {
        keputusan,
        komentar: komentar.trim(),
      });
      onSelesai(
        keputusan === 'VERIFIED'
          ? 'Tugas berhasil diverifikasi.'
          : 'Tugas dikembalikan ke pelaksana.',
      );
    } catch (kesalahan: unknown) {
      setGalat(pesanDariGalat(kesalahan));
    } finally {
      setMemproses(false);
    }
  }

  return (
    <Modal
      terbuka
      judul="Verifikasi tugas"
      deskripsi={`${tugas.kode} — ${tugas.judul}`}
      onTutup={onTutup}
      kaki={
        <>
          <Tombol varian="sekunder" onClick={onTutup}>
            Batal
          </Tombol>
          <Tombol
            varian={keputusan === 'VERIFIED' ? 'utama' : 'bahaya'}
            onClick={kirim}
            memuat={memproses}
          >
            Kirim keputusan
          </Tombol>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Tombol
            varian={keputusan === 'VERIFIED' ? 'utama' : 'sekunder'}
            onClick={() => setKeputusan('VERIFIED')}
          >
            Terima
          </Tombol>
          <Tombol
            varian={keputusan === 'REJECTED' ? 'bahaya' : 'sekunder'}
            onClick={() => setKeputusan('REJECTED')}
          >
            Tolak
          </Tombol>
        </div>

        <Bidang label="Komentar" htmlFor="verifikasi-komentar" wajib>
          <textarea
            id="verifikasi-komentar"
            value={komentar}
            onChange={(peristiwa) => setKomentar(peristiwa.target.value)}
            rows={4}
            className={cn(
              'block w-full rounded-lg border bg-white px-3 py-2 text-sm',
              'placeholder:text-slate-400',
              galat ? 'border-red-400' : 'border-slate-300',
            )}
            placeholder="Alasan keputusan (minimal 3 karakter)"
          />
        </Bidang>

        {galat ? (
          <Peringatan nada="bahaya">{galat}</Peringatan>
        ) : null}

        <p className="text-xs text-slate-500">
          Ringkasan tugas selesai: {angka(tugas.progres)}% · penanggung jawab{' '}
          {tugas.assignee.map((satu) => satu.nama).join(', ') || '—'}.
        </p>
      </div>
    </Modal>
  );
}
