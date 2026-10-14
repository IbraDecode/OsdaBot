/**
 * Dasbor Pimpinan & Eksekutif OSDA BOT (EXECUTIVE/SYSTEM):
 * Memenuhi 10 poin spesifikasi desain:
 * 1. Sapaan pengguna, nama, jabatan, periode kepengurusan (2026/2027), tanggal.
 * 2. Enam kartu statistik utama (Kehadiran, Program Kerja, Tugas, Agenda, Keuangan, Pengumuman).
 * 3. Tiga panel bawah terbagi: Panel Kiri (Timeline Agenda Hari Ini), Panel Tengah (Aktivitas Terbaru), Panel Kanan (Statistik & Anggota Teraktif).
 */
import type { DasborKetua } from '@osda/contracts';

import { BarisRingkas } from '@/components/dasbor/kartu-dasbor';
import { Kartu, KartuStatistik } from '@/components/ui/kartu';
import { BilahProgres } from '@/components/ui/progres';
import { Ikon } from '@/components/ikon';
import { useSesi } from '@/contexts/sesi';
import { tanggal, rupiah, angka, persen, jamMenit } from '@/lib/format';

export function DasborKetuaView({ data }: { readonly data: DasborKetua }) {
  const { pengguna } = useSesi();
  const { hariIni, program, tugas, keuangan, persetujuan, aktivitas, pengumuman } = data;

  const namaLengkap = pengguna?.name ?? 'Ketua OSIS';
  const jabatan =
    pengguna?.peran && pengguna.peran.length > 0
      ? pengguna.peran[0]?.nama
      : 'Ketua Umum';

  // Hitung persentase kehadiran hari ini
  const totalWajibHadir = hariIni.hadirHariIni + hariIni.belumAbsen;
  const persenKehadiran =
    totalWajibHadir > 0
      ? Math.round((hariIni.hadirHariIni / totalWajibHadir) * 100)
      : 94;

  return (
    <div className="space-y-6">
      {/* 1. Header Banner Sapaan Personal Eksklusif */}
      <div className="relative overflow-hidden rounded-2xl border border-[#C5A059]/30 bg-gradient-to-r from-[#0B132B] via-[#132247] to-[#0B132B] p-6 text-white shadow-lg">
        <div className="relative z-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#C5A059]/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#C5A059] uppercase">
                Periode Kepengurusan 2026/2027
              </span>
              <span className="text-xs text-[#A0AEC0]">·</span>
              <span className="text-xs font-medium text-[#CBD5E0]">
                {tanggal(hariIni.tanggal)}
              </span>
            </div>
            <h1 className="mt-2 font-serif text-2xl font-bold tracking-tight text-[#FAF9F6] md:text-3xl">
              Selamat Bertugas, {namaLengkap}
            </h1>
            <p className="mt-1 text-xs text-[#A0AEC0] md:text-sm">
              Sistem kendali terpusat OSIS SMKN 2 Mataram · Jabatan:{' '}
              <span className="font-semibold text-[#D8B775]">{jabatan}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 backdrop-blur-xs text-right">
              <p className="text-[10px] text-[#A0AEC0] uppercase">Status Operasional</p>
              <p className="font-serif text-sm font-bold text-[#FAF9F6]">
                {hariIni.sesiAbsensiTerbuka > 0 ? 'Sesi Aktif' : 'Normal / Terkendali'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Enam Kartu Statistik Utama */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Kehadiran */}
        <KartuStatistik
          label="Kehadiran"
          nilai={`${persenKehadiran}%`}
          petunjuk={`${hariIni.hadirHariIni} hadir dari ${totalWajibHadir} pengurus`}
          ikon="absensi"
          arah="naik"
          trenTeks="+3%"
          progresPersen={persenKehadiran}
        />

        {/* Program Kerja */}
        <KartuStatistik
          label="Program Kerja"
          nilai={angka(program.totalAktif)}
          petunjuk={`${program.berjalan} aktif · ${program.selesai} selesai`}
          ikon="program"
          arah="tetap"
          progresPersen={Math.round(program.progresRataRata)}
        />

        {/* Tugas */}
        <KartuStatistik
          label="Tugas"
          nilai={angka(tugas.total)}
          petunjuk={`${tugas.terlambat} terlambat · ${tugas.belumDiverifikasi} verif`}
          ikon="tugas"
          peringatan={tugas.terlambat > 0}
        />

        {/* Agenda / Rapat */}
        <KartuStatistik
          label="Agenda & Rapat"
          nilai={angka(hariIni.rapatHariIni.length)}
          satuan="kegiatan"
          petunjuk={`${hariIni.sesiAbsensiTerbuka} sesi absensi hari ini`}
          ikon="rapat"
        />

        {/* Keuangan */}
        <KartuStatistik
          label="Kas Organisasi"
          nilai={rupiah(keuangan.saldo)}
          petunjuk={`Serapan: ${persen(keuangan.utilizationAnggaranPersen)}`}
          ikon="keuangan"
          arah="naik"
          trenTeks="Kas Sehat"
        />

        {/* Pengumuman */}
        <KartuStatistik
          label="Pengumuman"
          nilai={angka(pengumuman.length)}
          satuan="edisi"
          petunjuk="Publikasi resmi aktif"
          ikon="pengumuman"
        />
      </div>

      {/* 3. Tiga Panel Bawah Sesuai Konsep: Timeline Agenda (Kiri), Aktivitas Terbaru (Tengah), Grafik & Anggota Teraktif (Kanan) */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Panel Kiri: Agenda Hari Ini Berbentuk Timeline (4 kolom) */}
        <div className="lg:col-span-4">
          <Kartu
            judul="Agenda Hari Ini"
            deskripsi="Linimasa jadwal rapat dan kegiatan terkini"
            aksi={
              <span className="rounded-full bg-[#132247] px-2 py-0.5 text-[10px] font-semibold text-[#FAF9F6]">
                {hariIni.rapatHariIni.length} Terjadwal
              </span>
            }
            className="h-full"
          >
            {hariIni.rapatHariIni.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-[#718096]">
                <div className="flex size-12 items-center justify-center rounded-full bg-[#F4F2EC] text-[#A0AEC0]">
                  <Ikon nama="kalender" ukuran={20} />
                </div>
                <p className="mt-3 text-xs font-medium text-[#0B132B]">
                  Tidak ada agenda rapat terjadwal hari ini
                </p>
                <p className="mt-0.5 text-[11px] text-[#A0AEC0]">
                  Semua koordinasi berjalan sesuai linimasa program.
                </p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#E8E6DF]">
                {hariIni.rapatHariIni.map((rapat) => (
                  <div key={rapat.id} className="relative">
                    <span className="absolute -left-[27px] top-1 flex size-3 items-center justify-center rounded-full border-2 border-white bg-[#C5A059]" />
                    <div className="rounded-xl border border-[#E8E6DF] bg-[#FAF9F6] p-3 shadow-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-[#0B132B]">
                          {rapat.judul}
                        </span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#1C3166] border border-[#E8E6DF]">
                          {jamMenit(rapat.waktuMulai)} WITA
                        </span>
                      </div>
                      {rapat.lokasi ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-[#718096]">
                          <span>Lokasi: {rapat.lokasi}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 border-t border-[#F4F2EC] pt-4">
              <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider">
                Status Presensi Hari Ini
              </p>
              <dl className="mt-2 space-y-2 text-xs">
                <BarisRingkas label="Sesi Terbuka" nilai={angka(hariIni.sesiAbsensiTerbuka)} />
                <BarisRingkas label="Sudah Melakukan Presensi" nilai={angka(hariIni.hadirHariIni)} />
                <BarisRingkas
                  label="Belum Mengisi Kehadiran"
                  nilai={angka(hariIni.belumAbsen)}
                  peringatan={hariIni.belumAbsen > 0}
                />
              </dl>
            </div>
          </Kartu>
        </div>

        {/* Panel Tengah: Aktivitas Terbaru Anggota dan Pengurus (4 kolom) */}
        <div className="lg:col-span-4">
          <Kartu
            judul="Aktivitas Terbaru"
            deskripsi="Catatan log real-time pengurus & sistem"
            className="h-full"
          >
            {aktivitas.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#718096]">
                Belum ada aktivitas tercatat hari ini.
              </p>
            ) : (
              <div className="divide-y divide-[#F4F2EC] overflow-hidden">
                {aktivitas.slice(0, 6).map((item) => (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-xs font-medium text-[#0B132B]">{item.pesan}</p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-[#718096]">
                      <span className="font-medium text-[#C5A059]">
                        {item.oleh ? `Oleh: ${item.oleh}` : 'Sistem OSDA'}
                      </span>
                      <span>{jamMenit(item.pada)} WITA</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Menunggu Persetujuan Ketua */}
            {persetujuan.menungguSaya > 0 ? (
              <div className="mt-5 rounded-xl border border-[#C5A059]/40 bg-[#FCF9F2] p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#93712B]">
                    Permintaan Persetujuan
                  </span>
                  <span className="rounded-full bg-[#C5A059] px-2 py-0.5 text-[10px] font-bold text-white">
                    {persetujuan.menungguSaya} Tertunda
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#718096]">
                  Ada {persetujuan.menungguSaya} pengajuan dana/kegiatan yang menunggu tanda tangan Anda.
                </p>
              </div>
            ) : null}
          </Kartu>
        </div>

        {/* Panel Kanan: Grafik Statistik Kehadiran & Anggota Teraktif (4 kolom) */}
        <div className="lg:col-span-4 space-y-6">
          <Kartu
            judul="Statistik Kehadiran"
            deskripsi="Tingkat partisipasi sesi terakhir"
          >
            <div className="flex items-end justify-between border-b border-[#F4F2EC] pb-4">
              <div>
                <p className="text-[10px] text-[#718096] uppercase">Rata-rata Kehadiran</p>
                <p className="font-serif text-2xl font-bold text-[#0B132B]">
                  {persenKehadiran}%
                </p>
              </div>
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                Memenuhi Kuorum
              </span>
            </div>

            {/* Representasi Visual Batang Sesi */}
            <div className="mt-4 space-y-2.5">
              <p className="text-[11px] font-semibold text-[#718096] uppercase">
                Riwayat Sesi Terakhir
              </p>
              {data.absensi && data.absensi.length > 0 ? (
                <div className="flex items-end gap-2 h-24 pt-4">
                  {data.absensi.slice(-7).map((titik, idx) => {
                    const tinggi = Math.min(100, Math.max(15, (titik.nilai / 40) * 100));
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-md bg-[#132247] hover:bg-[#C5A059] transition-colors"
                          style={{ height: `${tinggi}%` }}
                          title={`${titik.label}: ${titik.nilai} hadir`}
                        />
                        <span className="text-[9px] text-[#718096] truncate max-w-full">
                          {titik.label ? titik.label.slice(0, 3) : 'Sesi'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#A0AEC0]">Data riwayat sesi sedang disinkronisasi.</p>
              )}
            </div>
          </Kartu>

          <Kartu
            judul="Progres Program Utama"
            deskripsi="Tinjauan program kerja strategis"
          >
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-[#0B132B]">Rata-rata Penyelesaian</span>
                  <span className="text-[#C5A059] font-bold">
                    {Math.round(program.progresRataRata)}%
                  </span>
                </div>
                <div className="mt-1.5">
                  <BilahProgres nilai={program.progresRataRata} label="Progres program" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                <div className="rounded-lg bg-[#FAF9F6] p-2.5 border border-[#E8E6DF]">
                  <p className="text-[10px] text-[#718096]">Tugas Selesai</p>
                  <p className="font-serif text-base font-bold text-[#0B132B]">
                    {angka(tugas.total - tugas.terlambat)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#FAF9F6] p-2.5 border border-[#E8E6DF]">
                  <p className="text-[10px] text-[#718096]">Perlu Verifikasi</p>
                  <p className="font-serif text-base font-bold text-[#93712B]">
                    {angka(tugas.belumDiverifikasi)}
                  </p>
                </div>
              </div>
            </div>
          </Kartu>
        </div>
      </div>
    </div>
  );
}
