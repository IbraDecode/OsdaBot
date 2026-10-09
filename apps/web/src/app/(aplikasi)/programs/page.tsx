/**
 * Halaman Program Kerja — daftar program dengan progres.
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin } from '@/components/penjaga-izin';
import { Paginasi } from '@/components/paginasi';
import { api } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { angka, labelStatus, labelSisaHari, rupiah, tanggalPendek } from '@/lib/format';
import type { HasilDaftar, Program, StatusProgram } from '@osda/contracts';
import { STATUS_PROGRAM } from '@osda/contracts/enums';

import { LencanaStatus } from '@/components/ui/badge';
import { BilahProgres } from '@/components/ui/progres';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';

export default function HalamanProgram() {
  const [halaman, setHalaman] = useState(1);
  const [batas] = useState(20);
  const [status, setStatus] = useState<StatusProgram | ''>('');

  const { data, memuat, galat } = useAmbil<HasilDaftar<Program>>(
    () =>
      api.ambil<HasilDaftar<Program>>('/api/v1/programs', {
        status: status || undefined,
        page: halaman,
        limit: batas,
      }),
    `program:${status}:${halaman}`,
  );

  return (
    <PenjagaIzin izin="program.read" pesanTolak="Anda tidak memiliki izin untuk melihat program kerja.">
      <div>
        <JudulHalaman
          judul="Program Kerja"
          deskripsi="Program adalah ruang kerja utama OSDA: tugas, tim, anggaran, dan evaluasi dalam satu tempat."
        />

        <div className="mb-4 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label htmlFor="filter-status-program" className="mb-1 block text-sm font-medium text-slate-700">
            Status program
          </label>
          <select
            id="filter-status-program"
            value={status}
            onChange={(peristiwa) => {
              setStatus(peristiwa.target.value as StatusProgram | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua status</option>
            {STATUS_PROGRAM.map((satu) => (
              <option key={satu} value={satu}>
                {labelStatus(satu)}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {galat ? (
            <div className="p-4">
              <Peringatan nada="bahaya" judul="Gagal memuat program">

                {galat}
              </Peringatan>
            </div>
          ) : null}

          {memuat && !data ? (
            <div className="p-4">
              <Pemuat label="Memuat program kerja…" />
            </div>
          ) : null}

          <Tabel
            kolom={[
              { kunci: 'kode', judul: 'Kode', nilai: (baris) => baris.kode },
              {
                kunci: 'nama',
                judul: 'Program',
                nilai: (baris) => (
                  <div>
                    <p className="font-medium text-slate-900">{baris.nama}</p>
                    <p className="text-xs text-slate-500">
                      {baris.divisionNama ?? 'Tanpa divisi'} · pemilik {baris.ownerNama}
                    </p>
                  </div>
                ),
              },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />,
              },
              {
                kunci: 'progres',
                judul: 'Progres',
                lebar: '14rem',
                nilai: (baris) => <BilahProgres nilai={baris.progres} label={`Progres ${baris.nama}`} />,
              },
              {
                kunci: 'jumlahTugas',
                judul: 'Tugas',
                rata: 'kanan',
                nilai: (baris) => `${angka(baris.tugasSelesai)}/${angka(baris.jumlahTugas)}`,
              },
              {
                kunci: 'anggaranDisetujui',
                judul: 'Anggaran',
                rata: 'kanan',
                nilai: (baris) =>
                  baris.anggaranDisetujui !== null ? rupiah(baris.anggaranDisetujui) : '—',
              },
              {
                kunci: 'selesaiPada',
                judul: 'Tenggat',
                nilai: (baris) => (
                  <span className={baris.overdue ? 'font-medium text-red-600' : ''}>
                    {baris.selesaiPada ? tanggalPendek(baris.selesaiPada) : '—'}
                    {baris.hariTersisa !== null ? ` · ${labelSisaHari(baris.selesaiPada)}` : ''}
                  </span>
                ),
              },
            ]}
            data={data?.data ?? []}
            kunciBaris={(baris) => baris.id}
            memuat={memuat && !data}
            pesanKosong="Belum ada program kerja."
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
