/** Kartu dasar dasbor: wadah dengan judul, deskripsi, dan aksi opsional. */
import type { ReactNode } from 'react';

import { cn } from '@/lib/gaya';

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
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        className,
      )}
    >
      {judul || aksi ? (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            {judul ? <h2 className="text-sm font-semibold text-slate-900">{judul}</h2> : null}
            {deskripsi ? <p className="mt-0.5 text-xs text-slate-500">{deskripsi}</p> : null}
          </div>
          {aksi ? <div className="shrink-0">{aksi}</div> : null}
        </header>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export interface PropertiKartuStatistik {
  readonly label: string;
  readonly nilai: string | number;
  readonly satuan?: string;
  readonly petunjuk?: string;
  /** Arah perubahan dari periode sebelumnya. */
  readonly arah?: 'naik' | 'turun' | 'tetap';
  /** Tandai merah bila nilainya perlu perhatian. */
  readonly peringatan?: boolean;
  readonly className?: string;
}

/** Kartu angka ringkas — dipakai semua bentuk dasbor. */
export function KartuStatistik({
  label,
  nilai,
  satuan,
  petunjuk,
  arah,
  peringatan = false,
  className,
}: PropertiKartuStatistik) {
  const penandaArah =
    arah === 'naik' ? '↑' : arah === 'turun' ? '↓' : arah === 'tetap' ? '→' : null;

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 shadow-sm',
        peringatan ? 'border-red-200 bg-red-50' : 'border-slate-200',
        className,
      )}
    >
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span
          className={cn(
            'text-2xl font-semibold tabular-nums',
            peringatan ? 'text-red-700' : 'text-slate-900',
          )}
        >
          {nilai}
        </span>
        {satuan ? <span className="text-sm text-slate-500">{satuan}</span> : null}
        {penandaArah ? (
          <span
            className={cn(
              'text-sm font-medium',
              arah === 'naik' && 'text-emerald-600',
              arah === 'turun' && 'text-rose-600',
              arah === 'tetap' && 'text-slate-400',
            )}
            aria-hidden="true"
          >
            {penandaArah}
          </span>
        ) : null}
      </p>
      {petunjuk ? <p className="mt-1 text-xs text-slate-500">{petunjuk}</p> : null}
    </div>
  );
}
