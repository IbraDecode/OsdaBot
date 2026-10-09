/** Paginasi sederhana berbasis nomor halaman (cocok dengan `HasilDaftar` API). */
import { cn } from '@/lib/gaya';

import { Tombol } from './ui/tombol';

export interface PropertiPaginasi {
  readonly halaman: number;
  readonly totalHalaman: number;
  readonly total: number;
  readonly batas: number;
  readonly onUbah: (halamanBaru: number) => void;
  readonly onUbahBatas?: (batasBaru: number) => void;
  readonly className?: string;
}

export function Paginasi({
  halaman,
  totalHalaman,
  total,
  batas,
  onUbah,
  onUbahBatas,
  className,
}: PropertiPaginasi) {
  const mulai = total === 0 ? 0 : (halaman - 1) * batas + 1;
  const akhir = Math.min(halaman * batas, total);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-1 py-3 text-sm text-slate-500',
        className,
      )}
    >
      <p>
        Menampilkan <span className="font-medium text-slate-700">{mulai}</span>–
        <span className="font-medium text-slate-700">{akhir}</span> dari{' '}
        <span className="font-medium text-slate-700">{total}</span> data
      </p>

      <div className="flex items-center gap-2">
        {onUbahBatas ? (
          <label className="flex items-center gap-1 text-xs">
            Per halaman
            <select
              value={batas}
              onChange={(peristiwa) => onUbahBatas(Number(peristiwa.target.value))}
              className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        ) : null}

        <Tombol
          ukuran="kecil"
          onClick={() => onUbah(halaman - 1)}
          disabled={halaman <= 1}
          aria-label="Halaman sebelumnya"
        >
          Sebelumnya
        </Tombol>
        <span className="tabular-nums">
          {halaman} / {Math.max(1, totalHalaman)}
        </span>
        <Tombol
          ukuran="kecil"
          onClick={() => onUbah(halaman + 1)}
          disabled={halaman >= totalHalaman}
          aria-label="Halaman berikutnya"
        >
          Berikutnya
        </Tombol>
      </div>
    </div>
  );
}
