/** Kartu-kartu Dasbor Bendahara (ruang kerja `FINANCE`). */
import type { DasborBendahara } from '@osda/contracts';
import Link from 'next/link';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { GrafikTren } from '@/components/ui/tren';
import { Kartu } from '@/components/ui/kartu';
import { LencanaStatus } from '@/components/ui/badge';
import { BilahProgres } from '@/components/ui/progres';
import { Tabel } from '@/components/ui/tabel';
import { labelStatus, rupiah, tanggalPendek, angka } from '@/lib/format';

export function DasborBendaharaView({ data }: { readonly data: DasborBendahara }) {
  const { kas, bulanIni, pending, anggaran, belumLunas, trenMingguan, laporanTersedia } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul="Dasbor Keuangan"
        deskripsi={`Periode ${kas.periode.nama} (${tanggalPendek(kas.periode.dari)} – ${tanggalPendek(kas.periode.sampai)}).`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor label="Saldo saat ini" nilai={rupiah(kas.saldoSaatIni)} />
        <StatistikDasbor
          label="Pemasukan bulan ini"
          nilai={rupiah(bulanIni.pemasukan)}
          arah={bulanIni.dibandingBulanLalu >= 0 ? 'naik' : 'turun'}
          petunjuk={
            bulanIni.dibandingBulanLalu === 0
              ? 'Setara bulan lalu'
              : `${bulanIni.dibandingBulanLalu > 0 ? '+' : ''}${rupiah(bulanIni.dibandingBulanLalu)} dibanding bulan lalu`
          }
        />
        <StatistikDasbor label="Pengeluaran bulan ini" nilai={rupiah(bulanIni.pengeluaran)} />
        <StatistikDasbor
          label="Neto bulan ini"
          nilai={rupiah(bulanIni.net)}
          peringatan={bulanIni.net < 0}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu judul="Menunggu keputusan">
          <dl className="space-y-2 text-sm">
            <BarisRingkas
              label="Reimbursement tertunda"
              nilai={angka(pending.reimbursement)}
              peringatan={pending.reimbursement > 0}
            />
            <BarisRingkas
              label="Nilai reimbursement"
              nilai={rupiah(pending.reimbursementJumlah)}
            />
            <BarisRingkas
              label="Pengajuan pengeluaran"
              nilai={angka(pending.expense)}
              peringatan={pending.expense > 0}
            />
            <BarisRingkas label="Nilai pengajuan" nilai={rupiah(pending.expenseJumlah)} />
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Saldo kas dihitung dari buku besar (ledger), bukan dari satu angka tersimpan.
          </p>
        </Kartu>

        <Kartu judul="Kas periode berjalan" className="lg:col-span-2">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <BarisRingkas label="Saldo awal periode" nilai={rupiah(kas.saldoAwal)} />
            <BarisRingkas label="Total pemasukan" nilai={rupiah(kas.totalPemasukan)} />
            <BarisRingkas label="Total pengeluaran" nilai={rupiah(kas.totalPengeluaran)} />
            <BarisRingkas label="Saldo saat ini" nilai={rupiah(kas.saldoSaatIni)} />
          </dl>
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Tren mingguan</p>
            <GrafikTren titik={trenMingguan} satuan="rupiah" />
          </div>
        </Kartu>
      </div>

      <Kartu judul="Realisasi anggaran" deskripsi="Perbandingan anggaran disetujui dan realisasi">
        <Tabel
          kolom={[
            { kunci: 'programNama', judul: 'Program', nilai: (baris) => baris.programNama },
            {
              kunci: 'disetujui',
              judul: 'Disetujui',
              rata: 'kanan',
              nilai: (baris) => rupiah(baris.disetujui),
            },
            {
              kunci: 'realisasi',
              judul: 'Realisasi',
              rata: 'kanan',
              nilai: (baris) => rupiah(baris.realisasi),
            },
            {
              kunci: 'sisa',
              judul: 'Sisa',
              rata: 'kanan',
              nilai: (baris) => (
                <span className={baris.sisa < 0 ? 'font-semibold text-red-600' : ''}>
                  {rupiah(baris.sisa)}
                </span>
              ),
            },
            {
              kunci: 'persen',
              judul: 'Terpakai',
              nilai: (baris) => <BilahProgres nilai={baris.persen} label={`Pemakaian ${baris.programNama}`} />,
            },
            {
              kunci: 'status',
              judul: 'Status',
              nilai: (baris) => (
                <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />
              ),
            },
          ]}
          data={anggaran}
          kunciBaris={(baris) => baris.programId}
          pesanKosong="Belum ada anggaran pada periode ini."
        />
      </Kartu>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Belum lunas" deskripsi="Anggota dengan kewajiban yang masih berjalan">
          <Tabel
            kolom={[
              { kunci: 'nama', judul: 'Anggota', nilai: (baris) => baris.nama },
              { kunci: 'kelas', judul: 'Kelas', nilai: (baris) => baris.kelas },
              {
                kunci: 'nominal',
                judul: 'Nominal',
                rata: 'kanan',
                nilai: (baris) => rupiah(baris.nominal),
              },
              {
                kunci: 'periode',
                judul: 'Periode',
                nilai: (baris) => baris.periode ?? '—',
              },
            ]}
            data={belumLunas}
            kunciBaris={(baris) => baris.memberId}
            pesanKosong="Semua kewajiban sudah lunas."
          />
        </Kartu>

        <Kartu judul="Laporan siap unduh">
          <ul className="space-y-2 text-sm">
            {laporanTersedia.map((satu, indeks) => (
              <li
                key={`${satu.jenis}-${satu.format}-${indeks}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
              >
                <span className="truncate text-slate-700">
                  Laporan {satu.jenis} ({satu.format})
                </span>
                <Link
                  href={satu.tautan}
                  className="shrink-0 text-sm font-medium text-merek-700 hover:underline"
                >
                  Unduh
                </Link>
              </li>
            ))}
            {laporanTersedia.length === 0 ? (
              <li className="text-slate-500">Belum ada laporan yang bisa dibuat.</li>
            ) : null}
          </ul>
        </Kartu>
      </div>
    </div>
  );
}
