/**
 * Halaman Masuk OSDA BOT — Form Masuk Elegan Navy & Gold.
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
    <div className="rounded-2xl border border-[#1C3166] bg-[#0E1B3A]/90 p-6 shadow-2xl backdrop-blur-md md:p-8">
      <h2 className="font-serif text-lg font-bold text-[#FAF9F6]">
        Portal Masuk Pengurus
      </h2>
      <p className="mt-1 text-xs text-[#A0AEC0]">
        Silakan masukkan akun resmi organisasi SMKN 2 Mataram Anda.
      </p>

      <form className="mt-6 space-y-4" onSubmit={kirimMasukan} noValidate>
        <Bidang label="Email Organisasi" htmlFor="email" wajib>
          <Masukan
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="nama@smkn2mataram.sch.id"
            value={email}
            onChange={(peristiwa) => setEmail(peristiwa.target.value)}
            tidakValid={galat !== null && email.length === 0}
            className="border-[#1C3166] bg-[#050B18] text-[#FAF9F6] placeholder-[#718096] focus:border-[#C5A059]"
            required
          />
        </Bidang>

        <Bidang label="Kata Sandi" htmlFor="kata-sandi" wajib>
          <Masukan
            id="kata-sandi"
            name="kataSandi"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={kataSandi}
            onChange={(peristiwa) => setKataSandi(peristiwa.target.value)}
            tidakValid={galat !== null && kataSandi.length === 0}
            className="border-[#1C3166] bg-[#050B18] text-[#FAF9F6] placeholder-[#718096] focus:border-[#C5A059]"
            required
          />
        </Bidang>

        {galat ? (
          <Peringatan nada="bahaya" judul="Autentikasi Gagal">
            {galat}
          </Peringatan>
        ) : null}

        <div className="pt-2">
          <Tombol
            type="submit"
            varian="emas"
            ukuran="sedang"
            className="w-full font-bold shadow-md"
            memuat={sedangMemproses}
            disabled={sedangMemproses}
          >
            {sedangMemproses ? 'Memverifikasi Kredensial…' : 'Masuk ke Dasbor'}
          </Tombol>
        </div>
      </form>

      <div className="mt-6 rounded-xl border border-[#C5A059]/20 bg-[#C5A059]/10 p-3 text-center">
        <p className="text-[11px] text-[#D8B775]">
          Lupa kata sandi? Silakan hubungi Sekretaris OSIS atau masuk melalui verifikasi WhatsApp Bot OSDA.
        </p>
      </div>
    </div>
  );
}
