/** Kartu-kartu Dasbor Humas (ruang kerja `COMMUNICATION`). */
import type { DasborHumas } from '@osda/contracts';

import { JudulHalaman } from '@/components/judul-halaman';
import { BarisRingkas, StatistikDasbor } from '@/components/dasbor/kartu-dasbor';
import { Kartu } from '@/components/ui/kartu';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Tabel } from '@/components/ui/tabel';
import { angka, persen, tanggalPendek, tanggalWaktu } from '@/lib/format';

export function DasborHumasView({ data }: { readonly data: DasborHumas }) {
  const { antrean, terjadwal, acaraMendatang, aktivitas, perKanal, kontak } = data;

  return (
    <div className="space-y-5">
      <JudulHalaman
        judul="Dasbor Komunikasi"
        deskripsi="Antrean publikasi, jadwal pengiriman, dan efektivitas kanal."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatistikDasbor
          label="Terbit bulan ini"
          nilai={angka(aktivitas.terbitBulanIni)}
          petunjuk={`${angka(aktivitas.totalTerkirim)} pengiriman total`}
        />
        <StatistikDasbor
          label="Tingkat pembacaan"
          nilai={persen(aktivitas.tingkatPembacaan)}
          petunjuk={`${angka(aktivitas.totalTerbaca)} terbaca`}
        />
        <StatistikDasbor
          label="Gagal kirim"
          nilai={angka(aktivitas.gagal)}
          peringatan={aktivitas.gagal > 0}
          petunjuk="Perlu dikirim ulang"
        />
        <StatistikDasbor
          label="Tanpa WhatsApp"
          nilai={angka(kontak.tanpaWhatsapp)}
          petunjuk={`${angka(kontak.denganWhatsapp)} anggota punya WhatsApp`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Antrean publikasi" deskripsi="Menunggu persetujuan atau revisi">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Pengumuman', nilai: (baris) => baris.judul },
              {
                kunci: 'status',
                judul: 'Status',
                nilai: (baris) => <LencanaStatus status={baris.status} />,
              },
              {
                kunci: 'perluPersetujuan',
                judul: 'Persetujuan',
                nilai: (baris) =>
                  baris.perluPersetujuan ? (
                    <Lencana warna="kuning">Perlu</Lencana>
                  ) : (
                    <Lencana warna="abu">Tidak</Lencana>
                  ),
              },
              {
                kunci: 'dibuatPada',
                judul: 'Dibuat',
                nilai: (baris) => tanggalPendek(baris.dibuatPada),
              },
              {
                kunci: 'pengusul',
                judul: 'Pengusul',
                nilai: (baris) => baris.pengusul ?? '—',
              },
            ]}
            data={antrean}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada pengumuman yang menunggu."
          />
        </Kartu>

        <Kartu judul="Terjadwal" deskripsi="Sudah dijadwalkan, belum terbit">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Judul', nilai: (baris) => baris.judul },
              {
                kunci: 'jadwalkanPada',
                judul: 'Jadwal',
                nilai: (baris) => tanggalWaktu(baris.jadwalkanPada),
              },
              {
                kunci: 'kanal',
                judul: 'Kanal',
                nilai: (baris) => baris.kanal.join(', '),
              },
              {
                kunci: 'totalPenerima',
                judul: 'Penerima',
                rata: 'kanan',
                nilai: (baris) => angka(baris.totalPenerima),
              },
            ]}
            data={terjadwal}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada pengiriman terjadwal."
          />
        </Kartu>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kartu judul="Acara mendatang" className="lg:col-span-2">
          <Tabel
            kolom={[
              { kunci: 'judul', judul: 'Acara', nilai: (baris) => baris.judul },
              {
                kunci: 'tanggal',
                judul: 'Tanggal',
                nilai: (baris) => tanggalPendek(baris.tanggal),
              },
              {
                kunci: 'sudahDikomunikasikan',
                judul: 'Komunikasi',
                nilai: (baris) =>
                  baris.sudahDikomunikasikan ? (
                    <Lencana warna="hijau">Sudah</Lencana>
                  ) : (
                    <Lencana warna="merah">Belum</Lencana>
                  ),
              },
            ]}
            data={acaraMendatang}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Tidak ada acara mendatang."
          />
        </Kartu>

        <Kartu judul="Kontak anggota">
          <dl className="space-y-2 text-sm">
            <BarisRingkas label="Total anggota" nilai={angka(kontak.totalAnggota)} />
            <BarisRingkas label="Dengan WhatsApp" nilai={angka(kontak.denganWhatsapp)} />
            <BarisRingkas
              label="Tanpa WhatsApp"
              nilai={angka(kontak.tanpaWhatsapp)}
              peringatan={kontak.tanpaWhatsapp > 0}
            />
          </dl>
        </Kartu>
      </div>

      <Kartu judul="Kinerja per kanal">
        <Tabel
          kolom={[
            { kunci: 'kanal', judul: 'Kanal', nilai: (baris) => baris.kanal },
            {
              kunci: 'terkirim',
              judul: 'Terkirim',
              rata: 'kanan',
              nilai: (baris) => angka(baris.terkirim),
            },
            {
              kunci: 'terbaca',
              judul: 'Terbaca',
              rata: 'kanan',
              nilai: (baris) => angka(baris.terbaca),
            },
            {
              kunci: 'gagal',
              judul: 'Gagal',
              rata: 'kanan',
              nilai: (baris) => (
                <span className={baris.gagal > 0 ? 'font-semibold text-red-600' : ''}>
                  {angka(baris.gagal)}
                </span>
              ),
            },
          ]}
          data={perKanal}
          kunciBaris={(baris) => baris.kanal}
          pesanKosong="Belum ada data pengiriman."
        />
      </Kartu>
    </div>
  );
}
