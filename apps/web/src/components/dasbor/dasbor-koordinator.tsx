/** Kartu-kartu Dasbor Koordinator Divisi (ruang kerja `DIVISION`). */
import type { DasborKoordinator } from '@osda/contracts';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { GrafikTren } from '@/components/ui/tren';
import { Kartu } from '@/components/ui/kartu';
import { LencanaStatus } from '@/components/ui/badge';
import { BilahProgres } from '@/components/ui/progres';
import { Tabel } from '@/components/ui/tabel';
import { labelStatus, angka, persen, tanggalPendek } from '@/lib/format';

export function DasborKoordinatorView({ data }: { readonly data: DasborKoordinator }) {
  const { division, anggota, tugas, program, absensi } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul={`Dasbor Divisi ${division.nama}`}
        deskripsi={`Koordinator: ${division.koordinator ?? 'belum ditetapkan'}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Anggota aktif"
          nilai={angka(anggota.aktif)}
          petunjuk={`${angka(anggota.total)} anggota pada divisi`}
        />
        <StatistikDasbor
          label="Kehadiran"
          nilai={persen(anggota.persenKehadiran)}
          petunjuk="Rata-rata kehadiran divisi"
        />
        <StatistikDasbor
          label="Tugas terlambat"
          nilai={angka(tugas.terlambat)}
          peringatan={tugas.terlambat > 0}
          petunjuk={`${angka(tugas.total)} tugas tercatat`}
        />
        <StatistikDasbor
          label="Menunggu verifikasi"
          nilai={angka(tugas.menungguVerifikasi)}
          peringatan={tugas.menungguVerifikasi > 0}
          petunjuk="Perlu Anda periksa"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Tugas per anggota">
          <Tabel
            kolom={[
              { kunci: 'nama', judul: 'Anggota', nilai: (baris) => baris.nama },
              {
                kunci: 'kelas',
                judul: 'Kelas',
                nilai: (baris) => baris.kelas ?? '—',
              },
              {
                kunci: 'selesai',
                judul: 'Selesai',
                rata: 'kanan',
                nilai: (baris) => `${baris.selesai}/${baris.total}`,
              },
              {
                kunci: 'terlambat',
                judul: 'Terlambat',
                rata: 'kanan',
                nilai: (baris) => (
                  <span className={baris.terlambat > 0 ? 'font-semibold text-red-600' : ''}>
                    {baris.terlambat}
                  </span>
                ),
              },
            ]}
            data={tugas.perAnggota}
            kunciBaris={(baris) => baris.memberId}
            pesanKosong="Belum ada tugas pada divisi ini."
          />
        </Kartu>

        <Kartu judul="Program divisi">
          <Tabel
            kolom={[
              { kunci: 'nama', judul: 'Program', nilai: (baris) => baris.nama },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => (
                  <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />
                ),
              },
              {
                kunci: 'progres',
                judul: 'Progres',
                nilai: (baris) => <BilahProgres nilai={baris.progres} label={`Progres ${baris.nama}`} />,
              },
              {
                kunci: 'selesaiPada',
                judul: 'Target',
                nilai: (baris) => (
                  <span className={baris.terlambat ? 'font-medium text-red-600' : ''}>
                    {baris.selesaiPada ? tanggalPendek(baris.selesaiPada) : '—'}
                  </span>
                ),
              },
            ]}
            data={program}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Belum ada program pada divisi ini."
          />
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Tren absensi divisi">
          <GrafikTren titik={absensi} satuan="orang" />
        </Kartu>
        <Kartu judul="Ringkasan anggota">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Total anggota" nilai={angka(anggota.total)} />
            <BarisRingkas label="Aktif" nilai={angka(anggota.aktif)} />
            <BarisRingkas label="Persentase kehadiran" nilai={persen(anggota.persenKehadiran)} />
            <BarisRingkas label="Total tugas" nilai={angka(tugas.total)} />
          </dl>
        </Kartu>
      </div>
    </div>
  );
}
