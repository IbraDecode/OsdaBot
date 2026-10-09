/**
 * Halaman Notifikasi — daftar notifikasi milik pengguna yang login.
 *
 * Backend selalu membatasi notifikasi kepada pemiliknya; halaman ini hanya
 * menampilkan dan menandai sudah dibaca (`notification.read`).
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin } from '@/components/penjaga-izin';
import { Paginasi } from '@/components/paginasi';
import { api, pesanDariGalat } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { labelStatus, tanggalWaktu } from '@/lib/format';
import type { HasilDaftar, Notifikasi } from '@osda/contracts';

import { Lencana } from '@/components/ui/badge';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';

export default function HalamanNotifikasi() {
  const [halaman, setHalaman] = useState(1);
  const [batas] = useState(20);
  const [belumDibaca, setBelumDibaca] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  const { data, memuat, galat, muatUlang } = useAmbil<HasilDaftar<Notifikasi>>(
    () =>
      api.ambil<HasilDaftar<Notifikasi>>('/api/v1/notifications', {
        belumDibaca: belumDibaca ? true : undefined,
        page: halaman,
        limit: batas,
      }),
    `notifikasi:${belumDibaca}:${halaman}`,
  );

  async function tandaiDibaca(id: string) {
    setPesan(null);
    try {
      await api.kirim(`/api/v1/notifications/${id}/read`, {});
      muatUlang();
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    }
  }

  async function tandaiSemuaDibaca() {
    setPesan(null);
    try {
      await api.kirim('/api/v1/notifications/read-all', {});
      setPesan('Semua notifikasi ditandai sudah dibaca.');
      muatUlang();
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    }
  }

  return (
    <PenjagaIzin
      izin="notification.read"
      pesanTolak="Anda tidak memiliki izin untuk membaca notifikasi."
    >
      <div>
        <JudulHalaman
          judul="Notifikasi"
          deskripsi="Pemberitahuan absensi, tugas, rapat, keuangan, dan pengumuman."
          aksi={
            <Tombol varian="sekunder" onClick={tandaiSemuaDibaca}>
              Tandai semua dibaca
            </Tombol>
          }
        />

        {pesan ? (
          <Peringatan
            className="mb-3"
            nada={pesan.includes('dibaca') && !pesan.toLowerCase().includes('gagal') ? 'sukses' : 'bahaya'}
          >
            {pesan}
          </Peringatan>
        ) : null}

        <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            id="filter-belum-dibaca"
            type="checkbox"
            checked={belumDibaca}
            onChange={(peristiwa) => {
              setBelumDibaca(peristiwa.target.checked);
              setHalaman(1);
            }}
            className="size-4 rounded border-slate-300"
          />
          <label htmlFor="filter-belum-dibaca" className="text-sm text-slate-700">
            Hanya yang belum dibaca
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {galat ? (
            <div className="p-4">
              <Peringatan nada="bahaya" judul="Gagal memuat notifikasi">

                {galat}
              </Peringatan>
            </div>
          ) : null}

          {memuat && !data ? (
            <div className="p-4">
              <Pemuat label="Memuat notifikasi…" />
            </div>
          ) : null}

          <Tabel
            kolom={[
              {
                kunci: 'judul',
                judul: 'Notifikasi',
                nilai: (baris) => (
                  <div>
                    <p className={baris.sudahDibaca ? 'text-slate-600' : 'font-medium text-slate-900'}>
                      {baris.judul}
                    </p>
                    <p className="text-xs text-slate-500">{baris.isi}</p>
                  </div>
                ),
              },
              {
                kunci: 'jenis',
                judul: 'Jenis',
                nilai: (baris) => <Lencana warna="biru">{labelStatus(baris.jenis)}</Lencana>,
              },
              {
                kunci: 'prioritas',
                judul: 'Prioritas',
                nilai: (baris) => (
                  <Lencana
                    warna={
                      baris.prioritas === 'CRITICAL'
                        ? 'merah'
                        : baris.prioritas === 'HIGH'
                          ? 'kuning'
                          : 'abu'
                    }
                  >
                    {baris.prioritas}
                  </Lencana>
                ),
              },
              {
                kunci: 'dibuatPada',
                judul: 'Waktu',
                nilai: (baris) => tanggalWaktu(baris.dibuatPada),
              },
              {
                kunci: 'sudahDibaca',
                judul: 'Status',
                nilai: (baris) =>
                  baris.sudahDibaca ? (
                    <Lencana warna="abu">Sudah dibaca</Lencana>
                  ) : (
                    <Lencana warna="hijau">Baru</Lencana>
                  ),
              },
            ]}
            data={data?.data ?? []}
            kunciBaris={(baris) => baris.id}
            memuat={memuat && !data}
            pesanKosong="Tidak ada notifikasi."
            aksi={(baris) =>
              baris.sudahDibaca ? null : (
                <Tombol ukuran="kecil" onClick={() => tandaiDibaca(baris.id)}>
                  Tandai dibaca
                </Tombol>
              )
            }
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
