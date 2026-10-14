/**
 * Halaman dasbor — sesuai ruang kerja pengguna.
 *
 * Bentuk data datang utuh dari `GET /api/v1/users/me/dashboard`:
 *   EXECUTIVE/SYSTEM → DasborKetua
 *   OPERATIONS       → DasborWakil
 *   ADMINISTRATION   → DasborSekretaris
 *   FINANCE          → DasborBendahara
 *   COMMUNICATION    → DasborHumas
 *   DIVISION         → DasborKoordinator
 *   PERSONAL         → DasborAnggota
 */
'use client';

import type { BentukDasbor } from '@osda/contracts';

import { JudulHalaman } from '@/components/judul-halaman';
import { PilihDasbor } from '@/components/dasbor';
import { useSesi } from '@/contexts/sesi';
import { api } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { labelRuangKerja } from '@/lib/ruang-kerja';

import { KotakKosong, Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tombol } from '@/components/ui/tombol';

export default function HalamanDasbor() {
  const { pengguna, ruangKerja, izin } = useSesi();
  const kunci = pengguna?.userId ?? 'anon';

  const { data, memuat, galat, muatUlang } = useAmbil<BentukDasbor>(
    () => api.ambil<BentukDasbor>('/api/v1/users/me/dashboard'),
    `dasbor:${kunci}`,
  );

  return (
    <div>
      <JudulHalaman
        judul="Dasbor"
        deskripsi={
          <>
            Ruang kerja: <strong className="text-slate-700">{labelRuangKerja(ruangKerja)}</strong>{' '}
            · {izin.length} izin efektif aktif
          </>
        }
        aksi={
          <Tombol ukuran="kecil" onClick={muatUlang} disabled={memuat}>
            Muat ulang
          </Tombol>
        }
      />

      {memuat && !data ? <Pemuat label="Menyiapkan dasbor Anda…" /> : null}

      {galat && !data ? (
        <div className="space-y-3">
          <Peringatan nada="bahaya" judul="Dasbor gagal dimuat">
            {galat}
          </Peringatan>
          <Tombol varian="sekunder" onClick={muatUlang}>
            Coba lagi
          </Tombol>
        </div>
      ) : null}

      {data ? <PilihDasbor data={data} ruangKerjaCadangan={ruangKerja} /> : null}

      {!memuat && !galat && !data ? (
        <KotakKosong
          judul="Belum ada data dasbor"
          deskripsi="Server tidak mengirimkan bentuk dasbor apa pun untuk akun ini."
        />
      ) : null}
    </div>
  );
}
