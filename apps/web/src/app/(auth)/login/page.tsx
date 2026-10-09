/**
 * Halaman masuk — email + kata sandi.
 *
 * Token yang diterima dari `POST /api/v1/auth/login` disimpan oleh klien API
 * (`src/lib/api-client.ts`) lalu profil beserta izin efektif dimuat ulang lewat
 * `GET /api/v1/users/me`.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useSesi } from '@/contexts/sesi';
import { pesanDariGalat } from '@/lib/api-client';

import { Bidang, Masukan } from '@/components/ui/input';
import { Peringatan } from '@/components/ui/peringatan';
import { Tombol } from '@/components/ui/tombol';

export default function HalamanMasuk() {
  const { masuk, pengguna, memuat } = useSesi();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [sedangMemproses, setSedangMemproses] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  // Sudah punya sesi → langsung ke dasbor.
  useEffect(() => {
    if (!memuat && pengguna) router.replace('/');
  }, [memuat, pengguna, router]);

  async function kirimMasukan(peristiwa: FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    setGalat(null);

    if (!email.trim() || !kataSandi) {
      setGalat('Email dan kata sandi wajib diisi.');
      return;
    }

    setSedangMemproses(true);
    try {
      await masuk(email.trim(), kataSandi);
      router.replace('/');
    } catch (kesalahan: unknown) {
      setGalat(pesanDariGalat(kesalahan));
    } finally {
      setSedangMemproses(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Masuk ke akun Anda</h2>
      <p className="mt-1 text-sm text-slate-500">
        Gunakan email organisasi yang terdaftar pada OSDA.
      </p>

      <form className="mt-5 space-y-4" onSubmit={kirimMasukan} noValidate>
        <Bidang label="Email" htmlFor="email" wajib>
          <Masukan
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="nama@sekolah.sch.id"
            value={email}
            onChange={(peristiwa) => setEmail(peristiwa.target.value)}
            tidakValid={galat !== null && email.length === 0}
            required
          />
        </Bidang>

        <Bidang label="Kata sandi" htmlFor="kata-sandi" wajib>
          <Masukan
            id="kata-sandi"
            name="kataSandi"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={kataSandi}
            onChange={(peristiwa) => setKataSandi(peristiwa.target.value)}
            tidakValid={galat !== null && kataSandi.length === 0}
            required
          />
        </Bidang>

        {galat ? (
          <Peringatan nada="bahaya" judul="Gagal masuk">
            {galat}
          </Peringatan>
        ) : null}

        <Tombol
          type="submit"
          varian="utama"
          className="w-full"
          memuat={sedangMemproses}
          disabled={sedangMemproses}
        >
          {sedangMemproses ? 'Memproses…' : 'Masuk'}
        </Tombol>
      </form>

      <p className="mt-4 text-xs text-slate-400">
        Dasbor ini selalu meminta data ke API OSDA ({' '}
        <code className="font-mono">NEXT_PUBLIC_API_URL</code>) — tidak ada akses langsung ke
        basis data.
      </p>
    </div>
  );
}
