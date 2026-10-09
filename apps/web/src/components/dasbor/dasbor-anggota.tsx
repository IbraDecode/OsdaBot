/** Kartu-kartu Dasbor Anggota (ruang kerja `PERSONAL`) — tampilan paling sederhana. */
import type { DasborAnggota } from '@osda/contracts';
import Link from 'next/link';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { Kartu } from '@/components/ui/kartu';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Tabel } from '@/components/ui/tabel';
import { angka, labelSisaHari, persen, rupiah, tanggalPendek, jamSaja } from '@/lib/format';

export function DasborAnggotaView({ data }: { readonly data: DasborAnggota }) {
  const { nama, kelas, hariIni, tugasSaya, acaraMendatang, pengumuman, permintaanSaya, keuanganSaya, statistik } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul={`Halo, ${nama}`}
        deskripsi={`${kelas} · ringkasan kegiatan Anda per ${tanggalPendek(hariIni.tanggal)}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Kehadiran saya"
          nilai={persen(statistik.persenKehadiran)}
          petunjuk="Rata-rata kehadiran pada sesi wajib"
        />
        <StatistikDasbor
          label="Tugas selesai"
          nilai={`${angka(statistik.tugasSelesai)}/${angka(statistik.tugasTotal)}`}
          petunjuk="Termasuk yang belum diverifikasi"
        />
        <StatistikDasbor
          label="Sesi terbuka"
          nilai={angka(hariIni.sesiTerbuka.length)}
          peringatan={hariIni.sesiTerbuka.length > 0}
          petunjuk="Absen sebelum sesi ditutup"
        />
        <StatistikDasbor
          label="Belum lunas"
          nilai={rupiah(keuanganSaya.belumLunas)}
          peringatan={keuanganSaya.belumLunas > 0}
          petunjuk={keuanganSaya.statusIuran}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Sesi absensi terbuka" deskripsi="Segera lakukan absensi">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Sesi', nilai: (baris) => baris.judul },
              {
                kunci: 'jenis',
                judul: 'Jenis',
                nilai: (baris) => <LencanaStatus status={baris.jenis} />,
              },
              {
                kunci: 'waktuMulai',
                judul: 'Mulai',
                nilai: (baris) => jamSaja(baris.waktuMulai),
              },
              {
                kunci: 'statusSaya',
                judul: 'Status saya',
                nilai: (baris) =>
                  baris.statusSaya ? (
                    <LencanaStatus status={baris.statusSaya} />
                  ) : (
                    <Lencana warna="merah">Belum absen</Lencana>
                  ),
              },
              {
                kunci: 'qrAktif',
                judul: 'QR',
                nilai: (baris) =>
                  baris.qrAktif ? (
                    <Lencana warna="hijau">Aktif</Lencana>
                  ) : (
                    <Lencana warna="abu">Nonaktif</Lencana>
                  ),
              },
            ]}
            data={hariIni.sesiTerbuka}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada sesi absensi yang terbuka saat ini."
          />
        </Kartu>

        <Kartu judul="Tugas saya">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Tugas', nilai: (baris) => baris.judul },
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
                    {labelSisaHari(baris.batasWaktu)}
                  </span>
                ),
              },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => (
                  <LencanaStatus status={baris.status} label={labelStatusTugas(baris.status)} />
                ),
              },
            ]}
            data={tugasSaya}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada tugas yang perlu dikerjakan."
          />
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu judul="Acara mendatang">
          <ul className="space-y-2 text-sm">
            {acaraMendatang.map((satu) => (
              <li key={satu.id} className="flex items-start justify-between gap-2">
                <span className="truncate text-slate-700">{satu.judul}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {tanggalPendek(satu.tanggal)}
                </span>
              </li>
            ))}
            {acaraMendatang.length === 0 ? (
              <li className="text-slate-500">Tidak ada acara mendatang.</li>
            ) : null}
          </ul>
        </Kartu>

        <Kartu judul="Pengumuman">
          <ul className="space-y-2 text-sm">
            {pengumuman.map((satu) => (
              <li key={satu.id} className="flex items-start justify-between gap-2">
                <span className="truncate text-slate-700">
                  {satu.pin ? <Lencana warna="kuning">Disematkan</Lencana> : null} {satu.judul}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {satu.terbitPada ? tanggalPendek(satu.terbitPada) : '—'}
                </span>
              </li>
            ))}
            {pengumuman.length === 0 ? (
              <li className="text-slate-500">Belum ada pengumuman.</li>
            ) : null}
          </ul>
        </Kartu>

        <Kartu judul="Keuangan saya">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Status iuran" nilai={keuanganSaya.statusIuran} />
            <BarisRingkas label="Nominal" nilai={rupiah(keuanganSaya.nominal)} />
            <BarisRingkas
              label="Belum lunas"
              nilai={rupiah(keuanganSaya.belumLunas)}
              peringatan={keuanganSaya.belumLunas > 0}
            />
            <BarisRingkas
              label="Belum diterima sistem"
              nilai={rupiah(keuanganSaya.belumDiterima)}
            />
          </dl>
          {permintaanSaya.length > 0 ? (
            <Link
              href="/notifications"
              className="mt-3 inline-block text-sm font-medium text-merek-700 hover:underline"
            >
              Lihat {permintaanSaya.length} permintaan saya
            </Link>
          ) : null}
        </Kartu>
      </div>

      {permintaanSaya.length > 0 ? (
        <Kartu judul="Permintaan saya" deskripsi="Izin & persetujuan yang Anda ajukan">
          <Tabel
            kolom={[
              { kunci: 'ringkasan', judul: 'Ringkasan', nilai: (baris) => baris.ringkasan },
              { kunci: 'tipe', judul: 'Jenis', nilai: (baris) => baris.tipe },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} />,
              },
              {
                kunci: 'dibuatPada',
                judul: 'Diajukan',
                nilai: (baris) => tanggalPendek(baris.dibuatPada),
              },
            ]}
            data={permintaanSaya}
            kunciBaris={(baris) => baris.id}
          />
        </Kartu>
      ) : null}
    </div>
  );
}

/** Label status tugas yang dipahami anggota. */
function labelStatusTugas(status: string): string {
  const peta: Readonly<Record<string, string>> = {
    TODO: 'Belum mulai',
    IN_PROGRESS: 'Dikerjakan',
    BLOCKED: 'Terhambat',
    DONE: 'Selesai',
    CANCELLED: 'Dibatalkan',
  };
  return peta[status] ?? status;
}
