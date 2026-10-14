/** Kartu-kartu Dasbor Wakil Ketua (ruang kerja `OPERATIONS`) — fokus "apa yang belum selesai". */
import type { DasborWakil } from '@osda/contracts';
import Link from 'next/link';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { GrafikTren } from '@/components/ui/tren';
import { Kartu } from '@/components/ui/kartu';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Tabel } from '@/components/ui/tabel';
import { labelSisaHari, tanggalPendek } from '@/lib/format';

export function DasborWakilView({ data }: { readonly data: DasborWakil }) {
  const { tugas, divisi, absensi, followUp, tenggat } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul="Dasbor Operasional"
        deskripsi="Satu tempat untuk menelusuri pekerjaan yang belum tuntas."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Tugas terlambat"
          nilai={tugas.terlambat}
          peringatan={tugas.terlambat > 0}
          petunjuk="Lewat batas waktu"
        />
        <StatistikDasbor
          label="Terblokir"
          nilai={tugas.terblokir}
          peringatan={tugas.terblokir > 0}
          petunjuk="Butuh keputusan segera"
        />
        <StatistikDasbor
          label="Menunggu verifikasi"
          nilai={tugas.menungguVerifikasi}
          petunjuk="Sudah selesai, belum disahkan"
        />
        <StatistikDasbor
          label="Tanpa penanggung jawab"
          nilai={tugas.tanpaPIC}
          peringatan={tugas.tanpaPIC > 0}
          petunjuk="Perlu segera ditugaskan"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu
          judul="Tugas yang perlu ditindaklanjuti"
          deskripsi="Diurutkan berdasarkan kondisi paling mendesak"
          className="lg:col-span-2"
        >
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Tugas', nilai: (baris) => baris.judul },
              {
                kunci: 'assignee',
                judul: 'Penanggung jawab',
                nilai: (baris) =>
                  baris.assignee.length === 0 ? (
                    <Lencana warna="merah">Belum ada PIC</Lencana>
                  ) : (
                    baris.assignee.join(', ')
                  ),
              },
              {
                kunci: 'prioritas',
                judul: 'Prioritas',
                nilai: (baris) => <LencanaStatus status={baris.prioritas} />,
              },
              {
                kunci: 'batasWaktu',
                judul: 'Batas waktu',
                nilai: (baris) => (
                  <span className={baris.hariTersisa !== null && baris.hariTersisa < 0 ? 'text-red-600' : ''}>
                    {baris.batasWaktu ? tanggalPendek(baris.batasWaktu) : '—'}
                  </span>
                ),
              },
              {
                kunci: 'hariTersisa',
                judul: 'Sisa',
                nilai: (baris) => labelSisaHari(baris.batasWaktu),
              },
            ]}
            data={tugas.daftar}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada tugas bermasalah. Kerja bagus!"
          />
        </Kartu>

        <div className="space-y-4">
          <Kartu judul="Butuh tindak lanjut">
            <ul className="space-y-2 text-sm">
              {followUp.map((satu) => (
                <li key={`${satu.tipe}-${satu.jumlah}`} className="flex items-center justify-between gap-2">
                  <Link href={satu.tautan} className="text-merek-700 hover:underline">
                    {satu.label}
                  </Link>
                  <span className="font-semibold text-slate-900 tabular-nums">{satu.jumlah}</span>
                </li>
              ))}
              {followUp.length === 0 ? (
                <li className="text-slate-500">Tidak ada hal tertunggak.</li>
              ) : null}
            </ul>
          </Kartu>

          <Kartu judul="Tenggat terdekat">
            <ul className="space-y-2 text-sm">
              {tenggat.map((satu) => (
                <li key={satu.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-slate-800">{satu.label}</p>
                    <p className="text-xs text-slate-500">
                      {tanggalPendek(satu.tanggal)} · {satu.jenis}
                    </p>
                  </div>
                  <span
                    className={
                      satu.hariTersisa < 0
                        ? 'shrink-0 text-xs font-medium text-red-600'
                        : 'shrink-0 text-xs text-slate-500'
                    }
                  >
                    {labelSisaHari(satu.tanggal)}
                  </span>
                </li>
              ))}
              {tenggat.length === 0 ? (
                <li className="text-slate-500">Belum ada tenggat mendatang.</li>
              ) : null}
            </ul>
          </Kartu>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Kondisi divisi" deskripsi="Kehadiran dan beban tiap divisi">
          <Tabel
            kolom={[
              { kunci: 'nama', judul: 'Divisi', nilai: (baris) => baris.nama },
              {
                kunci: 'koordinator',
                judul: 'Koordinator',
                nilai: (baris) => baris.koordinator ?? '—',
              },
              {
                kunci: 'anggotaAktif',
                judul: 'Anggota',
                rata: 'kanan',
                nilai: (baris) => baris.anggotaAktif,
              },
              {
                kunci: 'tugasTerlambat',
                judul: 'Terlambat',
                rata: 'kanan',
                nilai: (baris) => (
                  <span className={baris.tugasTerlambat > 0 ? 'font-semibold text-red-600' : ''}>
                    {baris.tugasTerlambat}
                  </span>
                ),
              },
              {
                kunci: 'persenKehadiran',
                judul: 'Kehadiran',
                nilai: (baris) => `${baris.persenKehadiran}%`,
              },
            ]}
            data={divisi}
            kunciBaris={(baris) => baris.divisionId}
            pesanKosong="Belum ada data divisi."
          />
        </Kartu>

        <div className="space-y-4">
          <Kartu judul="Tren kehadiran">
            <GrafikTren titik={absensi.trenKehadiran} satuan="orang" />
          </Kartu>
          <Kartu judul="Sesi tanpa rekap" deskripsi="Sesi yang sudah ditutup tetapi belum direkap">
            <ul className="space-y-2 text-sm">
              {absensi.sesiTanpaRekap.map((satu) => (
                <li key={satu.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-700">{satu.judul}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {tanggalPendek(satu.tanggal)}
                  </span>
                </li>
              ))}
              {absensi.sesiTanpaRekap.length === 0 ? (
                <li className="space-y-1">
                  <p className="text-slate-500">Semua sesi sudah punya rekap.</p>
                </li>
              ) : null}
            </ul>
          </Kartu>
        </div>
      </div>

      <Kartu judul="Ringkasan tugas">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <BarisRingkas label="Terlambat" nilai={tugas.terlambat} peringatan={tugas.terlambat > 0} />
          <BarisRingkas label="Terblokir" nilai={tugas.terblokir} peringatan={tugas.terblokir > 0} />
          <BarisRingkas label="Menunggu verifikasi" nilai={tugas.menungguVerifikasi} />
          <BarisRingkas label="Tanpa PIC" nilai={tugas.tanpaPIC} peringatan={tugas.tanpaPIC > 0} />
        </dl>
      </Kartu>
    </div>
  );
}
