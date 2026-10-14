/**
 * Halaman Keuangan — ringkasan kas, tabel transaksi, tombol ekspor.
 *
 * SELURUH halaman hanya dirender bila pengguna punya izin `finance.read`
 * (spec §47). Tanpa izin, tampilkan pesan bahwa akses tidak diberikan.
 * Pemeriksaan di sini untuk UX; API tetap memutuskan.
 */
'use client';

import { useState } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin, CatatanIzin } from '@/components/penjaga-izin';
import { Paginasi } from '@/components/paginasi';
import { useSesi } from '@/contexts/sesi';
import { api } from '@/lib/api-client';
import { useAmbil, useUnduh } from '@/lib/use-ambil';
import { angka, labelStatus, rupiah, tanggalPendek } from '@/lib/format';
import type { HasilDaftar, Kas, Transaksi } from '@osda/contracts';

import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { Kartu } from '@/components/ui/kartu';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';

export default function HalamanKeuangan() {
  const { punyaIzin } = useSesi();
  const bolehEkspor = punyaIzin('report.export');

  const [halaman, setHalaman] = useState(1);
  const [batas] = useState(20);

  const kas = useAmbil<Kas>(
    () => api.ambil<Kas>('/api/v1/finance/kas'),
    'kas',
  );

  const transaksi = useAmbil<HasilDaftar<Transaksi>>(
    () =>
      api.ambil<HasilDaftar<Transaksi>>('/api/v1/finance/transactions', {
        page: halaman,
        limit: batas,
      }),
    `transaksi:${halaman}`,
  );

  const unduhan = useUnduh(() =>
    // Ekspor CSV resmi lewat endpoint laporan (izin `report.export`);
    // laporan keuangan hanya tersedia untuk peran yang diizinkan.
    api.unduh('/api/v1/reports/KEUANGAN/export', {
      namaBerkas: `laporan-keuangan-${new Date().toISOString().slice(0, 10)}.csv`,
      metode: 'POST',
    }),
  );

  return (
    <PenjagaIzin izin="finance.read" pesanTolak="Anda tidak memiliki izin untuk melihat data keuangan.">
      <div>
        <JudulHalaman
          judul="Keuangan"
          deskripsi="Kas dihitung dari buku besar (ledger) yang tidak dapat diubah."
          aksi={
            bolehEkspor ? (
              <Tombol varian="utama" onClick={unduhan.unduh} memuat={unduhan.sedangMengunduh}>
                Ekspor laporan CSV
              </Tombol>
            ) : null
          }
        />

        {unduhan.pesan ? (
          <Peringatan
            className="mb-3"
            nada={unduhan.pesan.startsWith('Berkas') ? 'sukses' : 'bahaya'}
          >
            {unduhan.pesan}
          </Peringatan>
        ) : null}

        {kas.memuat && !kas.data ? (
          <div className="mb-4">
            <Pemuat label="Memuat ringkasan kas…" />
          </div>
        ) : null}

        {kas.galat ? (
          <div className="mb-4">
            <Peringatan nada="bahaya" judul="Gagal memuat kas">
              {kas.galat}
            </Peringatan>
          </div>
        ) : null}

        {kas.data ? (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatistikDasbor label="Saldo akhir" nilai={rupiah(kas.data.saldoAkhir)} />
              <StatistikDasbor label="Saldo awal" nilai={rupiah(kas.data.saldoAwal)} />
              <StatistikDasbor label="Total pemasukan" nilai={rupiah(kas.data.totalPemasukan)} />
              <StatistikDasbor label="Total pengeluaran" nilai={rupiah(kas.data.totalPengeluaran)} />
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <Kartu judul="Periode" deskripsi={`${kas.data.nama}`}>
                <dl className="space-y-2 text-sm">
                  <BarisRingkas label="Mulai" nilai={tanggalPendek(kas.data.periode.dari)} />
                  <BarisRingkas label="Sampai" nilai={tanggalPendek(kas.data.periode.sampai)} />
                </dl>
              </Kartu>

              <Kartu judul="Belum lunas" deskripsi="Anggota dengan kewajiban berjalan">
                {kas.data.belumLunas.length === 0 ? (
                  <p className="text-sm text-slate-500">Semua kewajiban sudah lunas.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {kas.data.belumLunas.map((satu) => (
                      <li key={satu.memberId} className="flex justify-between gap-2 py-1.5">
                        <span className="truncate text-slate-700">{satu.nama}</span>
                        <span className="shrink-0 font-medium text-slate-900">
                          {rupiah(satu.nominal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Kartu>
            </div>
          </>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Transaksi</h2>
            <p className="text-xs text-slate-500">Riwayat pemasukan dan pengeluaran tercatat.</p>
          </div>

          {transaksi.galat ? (
            <div className="p-4">
              <Peringatan nada="bahaya" judul="Gagal memuat transaksi">

                {transaksi.galat}
              </Peringatan>
            </div>
          ) : null}

          {transaksi.memuat && !transaksi.data ? (
            <div className="p-4">
              <Pemuat label="Memuat transaksi…" />
            </div>
          ) : null}

          <Tabel
            kolom={[
              { kunci: 'kode', judul: 'Kode', nilai: (baris) => baris.kode },
              {
                kunci: 'tanggal',
                judul: 'Tanggal',
                nilai: (baris) => tanggalPendek(baris.tanggal),
              },
              {
                kunci: 'keterangan',
                judul: 'Keterangan',
                nilai: (baris) => baris.keterangan,
              },
              {
                kunci: 'akunNama',
                judul: 'Akun',
                nilai: (baris) => `${baris.akunKode} · ${baris.akunNama}`,
              },
              {
                kunci: 'programNama',
                judul: 'Program',
                nilai: (baris) => baris.programNama ?? '—',
              },
              {
                kunci: 'arah',
                judul: 'Arah',
                nilai: (baris) => (
                  <Lencana warna={baris.arah === 'IN' ? 'hijau' : 'kuning'}>
                    {baris.arah === 'IN' ? 'Masuk' : 'Keluar'}
                  </Lencana>
                ),
              },
              {
                kunci: 'nominal',
                judul: 'Nominal',
                rata: 'kanan',
                nilai: (baris) => rupiah(baris.nominal),
              },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />,
              },
            ]}
            data={transaksi.data?.data ?? []}
            kunciBaris={(baris) => baris.id}
            memuat={transaksi.memuat && !transaksi.data}
            pesanKosong="Belum ada transaksi pada periode ini."
          />

          {transaksi.data ? (
            <div className="px-4">
              <Paginasi
                halaman={transaksi.data.meta.page}
                totalHalaman={transaksi.data.meta.totalPages}
                total={transaksi.data.meta.total}
                batas={batas}
                onUbah={setHalaman}
              />
              <p className="pb-3 text-xs text-slate-400">
                Total {angka(transaksi.data.meta.total)} transaksi tercatat.
              </p>
            </div>
          ) : null}
        </div>

        <CatatanIzin izin="finance.read" />
      </div>
    </PenjagaIzin>
  );
}
