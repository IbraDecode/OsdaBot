/** Tombol dasbor. Seluaikan warna melalui varian, bukan className acak. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/gaya';

export type VarianTombol = 'utama' | 'sekunder' | 'bahaya' | 'hantu';
export type UkuranTombol = 'kecil' | 'sedang';

const GAYA_VARIAN: Readonly<Record<VarianTombol, string>> = {
  utama: 'bg-merek-600 text-white hover:bg-merek-700 disabled:hover:bg-merek-600',
  sekunder: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  bahaya: 'bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600',
  hantu: 'text-slate-600 hover:bg-slate-100',
};

const GAYA_UKURAN: Readonly<Record<UkuranTombol, string>> = {
  kecil: 'px-2.5 py-1.5 text-xs',
  sedang: 'px-3.5 py-2 text-sm',
};

export interface PropertiTombol extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly varian?: VarianTombol;
  readonly ukuran?: UkuranTombol;
  /** Tampilkan spinner dan nonaktifkan tombol. */
  readonly memuat?: boolean;
  readonly children?: ReactNode;
}

export function Tombol({
  varian = 'sekunder',
  ukuran = 'sedang',
  memuat = false,
  className,
  children,
  disabled,
  type = 'button',
  ...sisa
}: PropertiTombol) {
  return (
    <button
      type={type}
      disabled={disabled === true || memuat}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        GAYA_VARIAN[varian],
        GAYA_UKURAN[ukuran],
        className,
      )}
      {...sisa}
    >
      {memuat ? <PemuatKecil /> : null}
      {children}
    </button>
  );
}

/** Spinner kecil di dalam tombol. */
export function PemuatKecil({ className }: { readonly className?: string }) {
  return (
    <span
      role="status"
      aria-label="Memuat"
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
