/**
 * Halaman Rapat — daftar rapat (izin `meeting.read`).
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin } from '@/components/penjaga-izin';
import { Paginasi } from '@/components/paginasi';
import { api } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { angka, labelStatus, jamSaja, tanggalPendek } from '@/lib/format';
import type { HasilDaftar, Rapat, StatusRapat } from '@osda/contracts';
import { STATUS_RAPAT } from '@osda/contracts/enums';

import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';

export default function HalamanRapat() {
  const [halaman, setHalaman] = useState(1);
  const [batas] = useState(20);
  const [status, setStatus] = useState<StatusRapat | ''>('');

  const { data, memuat, galat } = useAmbil<HasilDaftar<Rapat>>(
    () =>
      api.ambil<HasilDaftar<Rapat>>('/api/v1/meetings', {
        status: status || undefined,
        page: halaman,
        limit: batas,
      }),
    `rapat:${status}:${halaman}`,
  );

  return (
    <PenjagaIzin izin="meeting.read" pesanTolak="Anda tidak memiliki izin untuk melihat daftar rapat.">
      <div>
        <JudulHalaman
          judul="Rapat"
          deskripsi="Jadwal rapat, agenda, dan status notulennya."
        />

        <div className="mb-4 w-56 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label htmlFor="filter-status-rapat" className="mb-1 block text-sm font-medium text-slate-700">
            Status rapat
          </label>
          <select
            id="filter-status-rapat"
            value={status}
            onChange={(peristiwa) => {
              setStatus(peristiwa.target.value as StatusRapat | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua status</option>
            {STATUS_RAPAT.map((satu) => (
              <option key={satu} value={satu}>
                {labelStatus(satu)}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {galat ? (
            <div className="p-4">
              <Peringatan nada="bahaya" judul="Gagal memuat rapat">
                {galat}
              </Peringatan>
            </div>
          ) : null}

          {memuat && !data ? (
            <div className="p-4">
              <Pemuat label="Memuat daftar rapat…" />
            </div>
          ) : null}

          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Rapat', nilai: (baris) => baris.judul },
              {
                kunci: 'tanggal',
                judul: 'Waktu',
                nilai: (baris) => (
                  <span>
                    {tanggalPendek(baris.tanggal)} · {jamSaja(baris.waktuMulai)}–
                    {jamSaja(baris.waktuSelesai)}
                  </span>
                ),
              },
              { kunci: 'jenis', judul: 'Jenis', nilai: (baris) => <LencanaStatus status={baris.jenis} /> },
              {
                kunci: 'lokasi',
                judul: 'Lokasi',
                nilai: (baris) => baris.lokasi ?? '—',
              },
              {
                kunci: 'sudahHadir',
                judul: 'Kehadiran',
                rata: 'kanan',
                nilai: (baris) => `${angka(baris.sudahHadir)}/${angka(baris.totalPeserta)}`,
              },
              {
                kunci: 'notulenId',
                judul: 'Notulen',
                nilai: (baris) =>
                  baris.notulenId ? (
                    <Lencana warna="hijau">Sudah ada</Lencana>
                  ) : (
                    <Lencana warna="abu">Belum</Lencana>
                  ),
              },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />,
              },
            ]}
            data={data?.data ?? []}
            kunciBaris={(baris) => baris.id}
            memuat={memuat && !data}
            pesanKosong="Belum ada rapat yang tercatat."
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
        </div>
      </div>
    </PenjagaIzin>
  );
}
