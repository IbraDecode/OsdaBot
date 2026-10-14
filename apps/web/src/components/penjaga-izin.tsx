/**
 * Penjaga izin untuk pengalaman pengguna (UX).
 *
 * CATATAN PENTING: komponen ini HANYA menyembunyikan tampilan agar pengguna
 * tidak melihat aksi yang belum boleh ia lakukan. Ia BUKAN lapisan keamanan —
 * setiap request tetap diperiksa ulang oleh API OSDA (JwtAuthGuard, IzinGuard,
 * OrganizationGuard). Jangan pernah membuat keputusan keamanan di frontend.
 */
'use client';

import type { ReactNode } from 'react';

import { useSesi } from '@/contexts/sesi';
import { cn } from '@/lib/gaya';

import { Peringatan } from './ui/peringatan';

export interface PropertiPenjagaIzin {
  /** Satu izin atau beberapa izin (cukup salah satu). */
  readonly izin: string | readonly string[];
  readonly butuhSemua?: boolean;
  readonly children: ReactNode;
  readonly pesanTolak?: string;
  readonly className?: string;
}

export function PenjagaIzin({
  izin,
  butuhSemua = false,
  children,
  pesanTolak = 'Anda tidak memiliki izin untuk melihat bagian ini.',
  className,
}: PropertiPenjagaIzin) {
  const { punyaIzin, punyaSemuaIzin, punyaSalahSatuIzin } = useSesi();
  const daftar = typeof izin === 'string' ? [izin] : izin;

  const boleh = butuhSemua ? punyaSemuaIzin(...daftar) : punyaSalahSatuIzin(...daftar);

  if (!boleh) {
    return (
      <div className={cn('py-6', className)}>
        <Peringatan nada="bahaya" judul="Akses ditolak">
          {pesanTolak}
          <span className="mt-1 block text-xs opacity-80">
            Izin yang dibutuhkan: <code className="font-mono">{daftar.join(', ')}</code>
          </span>
        </Peringatan>
      </div>
    );
  }

  return <>{children}</>;
}

/** Teks bantuan singkat soal siapa yang memutuskan akses. */
export function CatatanIzin({ izin }: { readonly izin: string }) {
  return (
    <p className="text-xs text-slate-400">
      Tampilan ini mengikuti izin <code className="font-mono">{izin}</code>. Server tetap
      memeriksa ulang setiap tindakan.
    </p>
  );
}
