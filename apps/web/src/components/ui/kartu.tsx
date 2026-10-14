/** Kartu dasar dasbor & kartu statistik berkelas (Navy, Gold, Ivory). */
import type { ReactNode } from 'react';

import { cn } from '@/lib/gaya';
import { Ikon, type IkonNama } from '@/components/ikon';

export interface PropertiKartu {
  readonly judul?: ReactNode;
  readonly deskripsi?: ReactNode;
  readonly aksi?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function Kartu({ judul, deskripsi, aksi, className, children }: PropertiKartu) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-[#E8E6DF] bg-white shadow-xs transition-shadow duration-200 hover:shadow-md',
        className,
      )}
    >
      {judul || aksi ? (
        <header className="flex items-center justify-between border-b border-[#F4F2EC] px-5 py-4">
          <div>
            {judul ? (
              <h2 className="font-serif text-sm font-bold text-[#0B132B] md:text-base">
                {judul}
              </h2>
            ) : null}
            {deskripsi ? <p className="mt-0.5 text-xs text-[#718096]">{deskripsi}</p> : null}
          </div>
          {aksi ? <div className="shrink-0">{aksi}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export interface PropertiKartuStatistik {
  readonly label: string;
  readonly nilai: string | number;
  readonly satuan?: string;
  readonly petunjuk?: string;
  readonly ikon?: IkonNama;
  /** Arah perubahan dari periode sebelumnya. */
  readonly arah?: 'naik' | 'turun' | 'tetap';
  readonly trenTeks?: string;
  /** Tandai merah bila nilainya perlu perhatian khusus. */
  readonly peringatan?: boolean;
  readonly progresPersen?: number;
  readonly className?: string;
}

/** Enam Kartu Statistik Utama Dasbor OSDA BOT */
export function KartuStatistik({
  label,
  nilai,
  satuan,
  petunjuk,
  ikon,
  arah,
  trenTeks,
  peringatan = false,
  progresPersen,
  className,
}: PropertiKartuStatistik) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        peringatan ? 'border-red-200 bg-red-50/30' : 'border-[#E8E6DF]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-[#718096] uppercase">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={cn(
                'font-serif text-2xl font-bold tracking-tight md:text-3xl',
                peringatan ? 'text-red-700' : 'text-[#0B132B]',
              )}
            >
              {nilai}
            </span>
            {satuan ? (
              <span className="text-xs font-medium text-[#718096]">{satuan}</span>
            ) : null}
          </div>
        </div>

        {ikon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#C5A059]/20 bg-[#FCF9F2] text-[#93712B] shadow-2xs">
            <Ikon nama={ikon} ukuran={20} />
          </div>
        ) : null}
      </div>

      {/* Indikator Progres Bar jika relevan */}
      {typeof progresPersen === 'number' ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-[#718096]">
            <span>Capaian target</span>
            <span className="font-semibold text-[#0B132B]">{progresPersen}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#E8E6DF]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#C5A059] to-[#93712B]"
              style={{ width: `${Math.min(100, Math.max(0, progresPersen))}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Baris Tren & Keterangan Singkat */}
      {(petunjuk || trenTeks) ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-[#718096]">
          {arah ? (
            <span
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                arah === 'naik' && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                arah === 'turun' && 'bg-rose-50 text-rose-700 border border-rose-200',
                arah === 'tetap' && 'bg-slate-100 text-slate-600',
              )}
            >
              {arah === 'naik' ? '↑' : arah === 'turun' ? '↓' : '→'} {trenTeks ?? ''}
            </span>
          ) : null}
          {petunjuk ? <span className="truncate text-[11px]">{petunjuk}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
