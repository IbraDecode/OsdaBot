/** Grafik tren sederhana (batang) — cukup untuk membaca arah tanpa chart library. */
import type { TitikTren } from '@osda/contracts';

import { tanggalPendek } from '@/lib/format';

export interface PropertiTren {
  readonly titik: readonly TitikTren[];
  readonly satuan?: string;
  readonly labelKosong?: string;
  readonly className?: string;
}

export function GrafikTren({
  titik,
  satuan,
  labelKosong = 'Belum ada data tren.',
  className,
}: PropertiTren) {
  if (titik.length === 0) {
    return <p className="text-sm text-slate-500">{labelKosong}</p>;
  }

  const nilaiMaksimum = Math.max(...titik.map((satu) => satu.nilai), 1);

  return (
    <div className={className}>
      <div className="flex h-28 items-end gap-1" role="img" aria-label="Grafik tren nilai">
        {titik.map((satu, indeks) => {
          const tinggi = Math.max(4, Math.round((satu.nilai / nilaiMaksimum) * 100));
          return (
            <div key={`${satu.tanggal}-${indeks}`} className="group flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                {satu.nilai}
                {satuan ? ` ${satuan}` : ''}
              </span>
              <div
                className="w-full rounded-t-sm bg-merek-500/80 hover:bg-merek-600"
                style={{ height: `${tinggi}%` }}
                title={`${tanggalPendek(satu.tanggal)}: ${satu.nilai}${satuan ? ` ${satuan}` : ''}`}
              />
              <span className="hidden text-[10px] text-slate-400 sm:block">
                {tanggalPendek(satu.tanggal).slice(0, 6)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
