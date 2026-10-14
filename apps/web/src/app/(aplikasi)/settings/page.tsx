/**
 * Halaman Pengaturan — pengaturan organisasi & feature flag.
 *
 * SELURUH halaman hanya dirender bila pengguna punya izin `settings.manage`.
 */
'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { PenjagaIzin, CatatanIzin } from '@/components/penjaga-izin';
import { api, pesanDariGalat } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';

import { Kartu } from '@/components/ui/kartu';
import { Bidang, Masukan } from '@/components/ui/input';
import { Lencana } from '@/components/ui/badge';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';

/** Bentuk baris pengaturan sesuai tabel `settings` di database. */
interface BarisPengaturan {
  readonly id: string;
  readonly kunci: string;
  readonly nilai: string;
  readonly deskripsi: string | null;
  readonly tipe: string;
}

/** Bentuk baris feature flag sesuai tabel `feature_flags`. */
interface BarisFeatureFlag {
  readonly id: string;
  readonly kunci: string;
  readonly status: 'ON' | 'OFF';
  readonly persentase: number;
  readonly deskripsi: string | null;
}

export default function HalamanPengaturan() {
  return (
    <PenjagaIzin
      izin="settings.manage"
      pesanTolak="Anda tidak memiliki izin untuk mengubah pengaturan organisasi."
    >
      <IsiPengaturan />
    </PenjagaIzin>
  );
}

function IsiPengaturan() {
  const [kunci, setKunci] = useState('');
  const [nilai, setNilai] = useState('');
  const [sedangMemproses, setSedangMemproses] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [memprosesFlagId, setMemprosesFlagId] = useState<string | null>(null);

  const pengaturan = useAmbil<readonly BarisPengaturan[]>(
    () => api.ambil<readonly BarisPengaturan[]>('/api/v1/settings'),
    'pengaturan',
  );

  const flag = useAmbil<readonly BarisFeatureFlag[]>(
    () => api.ambil<readonly BarisFeatureFlag[]>('/api/v1/feature-flags'),
    'feature-flags',
  );

  // Muat ulang pengaturan setelah berhasil menyimpan.
  useEffect(() => {
    if (pesan?.startsWith('Pengaturan tersimpan')) pengaturan.muatUlang();
    if (pesan?.startsWith('Feature flag')) flag.muatUlang();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pesan]);

  async function simpanPengaturan(peristiwa: FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    if (kunci.trim().length < 2 || nilai.trim().length < 1) {
      setPesan('Kunci minimal 2 karakter dan nilai tidak boleh kosong.');
      return;
    }
    setSedangMemproses(true);
    setPesan(null);
    try {
      await api.kirim('/api/v1/settings', { kunci: kunci.trim(), nilai: nilai.trim() });
      setPesan('Pengaturan tersimpan.');
      setKunci('');
      setNilai('');
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    } finally {
      setSedangMemproses(false);
    }
  }

  async function ubahFlag(id: string, status: 'ON' | 'OFF') {
    setMemprosesFlagId(id);
    setPesan(null);
    try {
      await api.ubah(`/api/v1/feature-flags/${id}`, { status });
      setPesan(`Feature flag ${id} sekarang ${status}.`);
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    } finally {
      setMemprosesFlagId(null);
    }
  }

  return (
    <div>
      <JudulHalaman
        judul="Pengaturan"
        deskripsi="Konfigurasi organisasi dan feature flag untuk migrasi bertahap."
      />

      {pesan ? (
        <Peringatan className="mb-3" nada={pesan.includes('tersimpan') || pesan.includes('sekarang') ? 'sukses' : 'bahaya'}>
          {pesan}
        </Peringatan>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Kartu judul="Simpan pengaturan" deskripsi="Membuat atau memperbarui satu kunci pengaturan.">
          <form className="space-y-3" onSubmit={simpanPengaturan}>
            <Bidang label="Kunci" htmlFor="pengaturan-kunci" wajib>
              <Masukan
                id="pengaturan-kunci"
                value={kunci}
                onChange={(peristiwa) => setKunci(peristiwa.target.value)}
                placeholder="mis. zona_waktu"
              />
            </Bidang>
            <Bidang label="Nilai" htmlFor="pengaturan-nilai" wajib>
              <Masukan
                id="pengaturan-nilai"
                value={nilai}
                onChange={(peristiwa) => setNilai(peristiwa.target.value)}
                placeholder="mis. Asia/Makassar"
              />
            </Bidang>
            <Tombol type="submit" varian="utama" memuat={sedangMemproses}>
              Simpan
            </Tombol>
          </form>
        </Kartu>

        <Kartu judul="Daftar pengaturan">
          {pengaturan.memuat && !pengaturan.data ? (
            <Pemuat label="Memuat pengaturan…" />
          ) : null}
          {pengaturan.galat ? (
            <Peringatan nada="bahaya" judul="Gagal memuat pengaturan">
              {pengaturan.galat}
            </Peringatan>
          ) : null}
          <Tabel
            kolom={[
              { kunci: 'kunci', judul: 'Kunci', nilai: (baris) => baris.kunci },
              { kunci: 'nilai', judul: 'Nilai', nilai: (baris) => baris.nilai },
              {
                kunci: 'tipe',
                judul: 'Tipe',
                nilai: (baris) => <Lencana warna="abu">{baris.tipe}</Lencana>,
              },
            ]}
            data={pengaturan.data ?? []}
            kunciBaris={(baris) => baris.id}
            pesanKosong="Belum ada pengaturan tersimpan."
          />
        </Kartu>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Feature flag</h2>
          <p className="text-xs text-slate-500">
            Menyalakan modul baru secara bertahap tanpa mengganggu pengguna lain.
          </p>
        </div>

        {flag.memuat && !flag.data ? (
          <div className="p-4">
            <Pemuat label="Memuat feature flag…" />
          </div>
        ) : null}

        {flag.galat ? (
          <div className="p-4">
            <Peringatan nada="bahaya" judul="Gagal memuat feature flag">
              {flag.galat}
            </Peringatan>
          </div>
        ) : null}

        <Tabel
          kolom={[
            { kunci: 'kunci', judul: 'Kunci', nilai: (baris) => baris.kunci },
            {
              kunci: 'deskripsi',
              judul: 'Keterangan',
              nilai: (baris) => baris.deskripsi ?? '—',
            },
            {
              kunci: 'persentase',
              judul: 'Rollout',
              nilai: (baris) => `${baris.persentase}%`,
            },
            {
              kunci: 'status',
              judul: 'Status',
              nilai: (baris) => (
                <Lencana warna={baris.status === 'ON' ? 'hijau' : 'abu'}>{baris.status}</Lencana>
              ),
            },
          ]}
          data={flag.data ?? []}
          kunciBaris={(baris) => baris.id}
          pesanKosong="Belum ada feature flag."
          aksi={(baris) => (
            <span className="flex justify-end gap-2">
              {baris.status === 'OFF' ? (
                <Tombol
                  ukuran="kecil"
                  varian="utama"
                  memuat={memprosesFlagId === baris.id}
                  onClick={() => ubahFlag(baris.id, 'ON')}
                >
                  Aktifkan
                </Tombol>
              ) : (
                <Tombol
                  ukuran="kecil"
                  varian="sekunder"
                  memuat={memprosesFlagId === baris.id}
                  onClick={() => ubahFlag(baris.id, 'OFF')}
                >
                  Nonaktifkan
                </Tombol>
              )}
            </span>
          )}
        />
      </div>

      <CatatanIzin izin="settings.manage" />
    </div>
  );
}
