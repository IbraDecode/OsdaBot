/** Peringatan (alert) dan kotak kosong. */
import type { ReactNode } from 'react';

import { cn } from '@/lib/gaya';

export type NadaPeringatan = 'informasi' | 'sukses' | 'peringatan' | 'bahaya';

const GAYA_NADA: Readonly<Record<NadaPeringatan, string>> = {
  informasi: 'border-merek-200 bg-merek-50 text-merek-800',
  sukses: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  peringatan: 'border-amber-200 bg-amber-50 text-amber-800',
  bahaya: 'border-red-200 bg-red-50 text-red-800',
};

export interface PropertiPeringatan {
  readonly nada?: NadaPeringatan;
  readonly judul?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Peringatan({ nada = 'informasi', judul, children, className }: PropertiPeringatan) {
  return (
    <div
      role={nada === 'bahaya' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-3 py-2 text-sm', GAYA_NADA[nada], className)}
    >
      {judul ? <p className="font-semibold">{judul}</p> : null}
      <div className={cn(judul && 'mt-0.5')}>{children}</div>
    </div>
  );
}

export function KotakKosong({
  judul,
  deskripsi,
  aksi,
}: {
  readonly judul: string;
  readonly deskripsi?: string;
  readonly aksi?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{judul}</p>
      {deskripsi ? <p className="max-w-md text-sm text-slate-500">{deskripsi}</p> : null}
      {aksi}
    </div>
  );
}
