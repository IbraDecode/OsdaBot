/** Tombol dasbor OSDA BOT: Biru/Navy utama, emas sekunder/aksen, bahaya merah, hantu netral. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/gaya';

export type VarianTombol = 'utama' | 'emas' | 'sekunder' | 'bahaya' | 'hantu';
export type UkuranTombol = 'kecil' | 'sedang' | 'besar';

const GAYA_VARIAN: Readonly<Record<VarianTombol, string>> = {
  utama:
    'bg-[#0284c7] text-white hover:bg-[#0369a1] shadow-xs hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#0284c7]/40 disabled:hover:bg-[#0284c7]',
  emas:
    'bg-gradient-to-r from-[#C5A059] to-[#93712B] text-white hover:brightness-105 shadow-xs focus-visible:ring-2 focus-visible:ring-[#C5A059]/40',
  sekunder:
    'border border-[#E8E6DF] bg-white text-[#0B132B] hover:bg-[#FAF9F6] shadow-2xs focus-visible:ring-2 focus-visible:ring-[#C5A059]',
  bahaya:
    'bg-[#E53E3E] text-white hover:bg-[#C53030] shadow-xs focus-visible:ring-2 focus-visible:ring-red-400 disabled:hover:bg-[#E53E3E]',
  hantu:
    'text-[#4A5568] hover:bg-[#F4F2EC] hover:text-[#0B132B]',
};

const GAYA_UKURAN: Readonly<Record<UkuranTombol, string>> = {
  kecil: 'px-2.5 py-1.5 text-xs rounded-lg',
  sedang: 'px-4 py-2 text-xs md:text-sm rounded-xl font-medium',
  besar: 'px-5 py-2.5 text-sm md:text-base rounded-xl font-semibold',
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
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
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
