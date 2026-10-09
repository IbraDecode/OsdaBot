/**
 * Kartu-kartu Dasbor Ketua (ruang kerja `EXECUTIVE`).
 * Satu berkas = satu bentuk dasbor, supaya setiap peran mudah dirawat.
 */
import type { DasborKetua } from '@osda/contracts';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { DaftarRingkas } from '@/components/dasbor/daftar-ringkas';
import { GrafikTren } from '@/components/ui/tren';
import { Kartu } from '@/components/ui/kartu';
import { BilahProgres } from '@/components/ui/progres';
import { Tabel } from '@/components/ui/tabel';
import { tanggal, rupiah, angka, persen } from '@/lib/format';

export function DasborKetuaView({ data }: { readonly data: DasborKetua }) {
  const { hariIni, program, tugas, keuangan, persetujuan, aktivitas, pengumuman } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul="Dasbor Pimpinan"
        deskripsi={`Gambaran keseluruhan organisasi per ${tanggal(hariIni.tanggal)}.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Program aktif"
          nilai={angka(program.totalAktif)}
          petunjuk={`${angka(program.berjalan)} berjalan · ${angka(program.selesai)} selesai`}
        />
        <StatistikDasbor
          label="Tugas terlambat"
          nilai={angka(tugas.terlambat)}
          peringatan={tugas.terlambat > 0}
          petunjuk={`${angka(tugas.total)} tugas tercatat`}
        />
        <StatistikDasbor
          label="Belum diverifikasi"
          nilai={angka(tugas.belumDiverifikasi)}
          peringatan={tugas.belumDiverifikasi > 0}
          petunjuk="Perlu tindakan penguji"
        />
        <StatistikDasbor
          label="Menunggu persetujuan"
          nilai={angka(persetujuan.menungguSaya)}
          peringatan={persetujuan.menungguSaya > 0}
          petunjuk="Permintaan atas nama Anda"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu judul="Absensi hari ini" deskripsi="Sesi yang berjalan dan yang sudah dibuka">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Sesi dibuka" nilai={angka(hariIni.sesiAbsensiTerbuka)} />
            <BarisRingkas label="Sudah hadir" nilai={angka(hariIni.hadirHariIni)} />
            <BarisRingkas
              label="Belum absen"
              nilai={angka(hariIni.belumAbsen)}
              peringatan={hariIni.belumAbsen > 0}
            />
            <BarisRingkas label="Tugas saya" nilai={angka(hariIni.tugasSaya)} />
          </dl>
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">Rapat hari ini</p>
            {hariIni.rapatHariIni.length === 0 ? (
              <p className="text-sm text-slate-500">Tidak ada rapat terjadwal.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {hariIni.rapatHariIni.map((rapat) => (
                  <li key={rapat.id} className="flex justify-between gap-2">
                    <span className="truncate text-slate-700">{rapat.judul}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {rapat.waktuMulai.slice(11, 16)}
                      {rapat.lokasi ? ` · ${rapat.lokasi}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Kartu>

        <Kartu judul="Program kerja" deskripsi="Ringkasan keberjalanan program">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Total aktif" nilai={angka(program.totalAktif)} />
            <BarisRingkas label="Berjalan" nilai={angka(program.berjalan)} />
            <BarisRingkas label="Selesai" nilai={angka(program.selesai)} />
            <BarisRingkas
              label="Terlambat"
              nilai={angka(program.terlambat)}
              peringatan={program.terlambat > 0}
            />
          </dl>
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-slate-500">Progres rata-rata</p>
            <BilahProgres nilai={program.progresRataRata} label="Progres rata-rata program" />
          </div>
        </Kartu>

        <Kartu judul="Keuangan" deskripsi="Kas dan arus bulan ini">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Saldo" nilai={rupiah(keuangan.saldo)} />
            <BarisRingkas
              label="Pemasukan bulan ini"
              nilai={rupiah(keuangan.pemasukanBulanIni)}
            />
            <BarisRingkas
              label="Pengeluaran bulan ini"
              nilai={rupiah(keuangan.pengeluaranBulanIni)}
            />
            <BarisRingkas
              label="Pemakaian anggaran"
              nilai={persen(keuangan.utilizationAnggaranPersen)}
            />
          </dl>
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Tugas per divisi" deskripsi="Mana divisi yang paling perlu perhatian">
          <Tabel
            kolom={[
              { kunci: 'divisionNama', judul: 'Divisi' },
              {
                kunci: 'total',
                judul: 'Total',
                rata: 'kanan',
                nilai: (baris) => angka(baris.total),
              },
              {
                kunci: 'terlambat',
                judul: 'Terlambat',
                rata: 'kanan',
                nilai: (baris) => (
                  <span className={baris.terlambat > 0 ? 'font-semibold text-red-600' : ''}>
                    {angka(baris.terlambat)}
                  </span>
                ),
              },
            ]}
            data={tugas.perDivisi}
            kunciBaris={(baris) => baris.divisionId}
            pesanKosong="Belum ada data tugas per divisi."
          />
        </Kartu>

        <Kartu judul="Tren absensi" deskripsi="Jumlah kehadiran pada sesi terakhir">
          <GrafikTren titik={data.absensi} satuan="orang" />
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Permintaan persetujuan terbaru">
          <DaftarRingkas
            item={persetujuan.terbaru.map((satu) => ({
              id: satu.id,
              judul: satu.ringkasan,
              keterangan: `${satu.jenis}${satu.nominal !== null ? ` · ${rupiah(satu.nominal)}` : ''}`,
              waktu: satu.dibuatPada,
            }))}
            kosong="Tidak ada permintaan yang menunggu."
          />
        </Kartu>

        <Kartu judul="Aktivitas terbaru">
          <DaftarRingkas
            item={aktivitas.map((satu) => ({
              id: satu.id,
              judul: satu.pesan,
              keterangan: satu.oleh ? `oleh ${satu.oleh}` : 'sistem',
              waktu: satu.pada,
            }))}
            kosong="Belum ada aktivitas."
          />
        </Kartu>
      </div>

      <Kartu judul="Pengumuman">
        <DaftarRingkas
          item={pengumuman.map((satu) => ({
            id: satu.id,
            judul: satu.judul,
            waktu: satu.terbitPada,
          }))}
          kosong="Belum ada pengumuman terbit."
        />
      </Kartu>
    </div>
  );
}
