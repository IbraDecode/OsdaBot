/** Kartu-kartu Dasbor Sekretaris (ruang kerja `ADMINISTRATION`). */
import type { DasborSekretaris } from '@osda/contracts';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { Kartu } from '@/components/ui/kartu';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Tabel } from '@/components/ui/tabel';
import { jamSaja, tanggal, tanggalPendek, angka } from '@/lib/format';

export function DasborSekretarisView({ data }: { readonly data: DasborSekretaris }) {
  const { absensiHariIni, rapatMendatang, notulen, surat, dokumen, anggota, kalender } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul="Dasbor Administrasi"
        deskripsi="Pusat administrasi organisasi: anggota, rapat, notulen, surat, dan arsip."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Notulen belum selesai"
          nilai={angka(notulen.belumSelesai)}
          peringatan={notulen.belumSelesai > 0}
          petunjuk="Rapat yang harus ditulis"
        />
        <StatistikDasbor
          label="Notulen menunggu persetujuan"
          nilai={angka(notulen.menungguPersetujuan)}
          petunjuk="Menunggu keputusan pimpinan"
        />
        <StatistikDasbor
          label="Dokumen menunggu persetujuan"
          nilai={angka(dokumen.menungguPersetujuan)}
          petunjuk={`${angka(dokumen.draft)} draf tersimpan`}
        />
        <StatistikDasbor
          label="Surat perlu tindak lanjut"
          nilai={angka(surat.perluTindakLanjut)}
          peringatan={surat.perluTindakLanjut > 0}
          petunjuk={`${angka(surat.masuk)} masuk · ${angka(surat.keluar)} keluar`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Absensi hari ini" deskripsi="Rekap kehadiran wajib hari ini">
          <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <BarisRingkas label="Sudah hadir" nilai={angka(absensiHariIni.totalHadir)} />
            <BarisRingkas
              label="Total wajib"
              nilai={angka(absensiHariIni.totalWajib)}
            />
          </dl>
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Sesi', nilai: (baris) => baris.judul },
              {
                kunci: 'waktuMulai',
                judul: 'Mulai',
                nilai: (baris) => jamSaja(baris.waktuMulai),
              },
              {
                kunci: 'sudahHadir',
                judul: 'Hadir',
                rata: 'kanan',
                nilai: (baris) => `${baris.sudahHadir}/${baris.totalWajib}`,
              },
            ]}
            data={absensiHariIni.sesi}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada sesi absensi hari ini."
          />
        </Kartu>

        <Kartu judul="Rapat mendatang" deskripsi="Yang membutuhkan notulen ditandai">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Rapat', nilai: (baris) => baris.judul },
              {
                kunci: 'tanggal',
                judul: 'Tanggal',
                nilai: (baris) => (
                  <span>
                    {tanggalPendek(baris.tanggal)} · {jamSaja(baris.waktuMulai)}
                  </span>
                ),
              },
              {
                kunci: 'perluNotulen',
                judul: 'Notulen',
                nilai: (baris) =>
                  baris.perluNotulen ? (
                    <Lencana warna="kuning">Perlu notulen</Lencana>
                  ) : (
                    <Lencana warna="abu">{baris.notulenId ? 'Sudah ada' : 'Tidak wajib'}</Lencana>
                  ),
              },
            ]}
            data={rapatMendatang}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada rapat mendatang."
          />
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu judul="Notulen" className="lg:col-span-2">
          <Tabel
            kolom={[
              { kunci: 'rapatJudul', judul: 'Rapat', nilai: (baris) => baris.rapatJudul },
              {
                kunci: 'tanggal',
                judul: 'Tanggal',
                nilai: (baris) => tanggalPendek(baris.tanggal),
              },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} />,
              },
            ]}
            data={notulen.daftar}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Belum ada notulen yang perlu ditangani."
          />
        </Kartu>

        <Kartu judul="Data anggota">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Total anggota" nilai={angka(anggota.total)} />
            <BarisRingkas label="Aktif" nilai={angka(anggota.aktif)} />
            <BarisRingkas
              label="Berubah bulan ini"
              nilai={angka(anggota.berubahBulanIni)}
            />
            <BarisRingkas
              label="Belum punya akun"
              nilai={angka(anggota.belumPunyaAkun)}
              peringatan={anggota.belumPunyaAkun > 0}
            />
            <BarisRingkas label="Total arsip dokumen" nilai={angka(dokumen.totalArsip)} />
          </dl>
        </Kartu>
      </div>

      <Kartu judul="Kalender kegiatan">
        <ul className="grid gap-2 sm:grid-cols-2">
          {kalender.map((satu) => (
            <li
              key={satu.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-slate-800">{satu.judul}</p>
                <p className="text-xs text-slate-500">
                  {tanggal(satu.tanggal)} · {satu.tipe}
                </p>
              </div>
              <LencanaStatus status={satu.tipe} />
            </li>
          ))}
          {kalender.length === 0 ? (
            <li className="text-sm text-slate-500">Belum ada agenda pada kalender.</li>
          ) : null}
        </ul>
      </Kartu>
    </div>
  );
}
