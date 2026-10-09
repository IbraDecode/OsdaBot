/** Tabel data generik berbasis kolom — dipakai seluruh halaman daftar. */
import type { ReactNode } from 'react';

import { cn } from '@/lib/gaya';

import { PemuatBaris } from './spinner';

export interface KolomTabel<T> {
  /** Kunci unik kolom. */
  readonly kunci: string;
  readonly judul: string;
  readonly lebar?: string;
  readonly rata?: 'kiri' | 'tengah' | 'kanan';
  /** Isi sel. Bila tidak diisi, nilai teks diambil langsung dari baris. */
  readonly nilai?: (baris: T, indeks: number) => ReactNode;
  readonly sembunyikanDiLayarKecil?: boolean;
}

export interface PropertiTabel<T> {
  readonly kolom: readonly KolomTabel<T>[];
  readonly data: readonly T[];
  readonly kunciBaris: (baris: T, indeks: number) => string;
  readonly memuat?: boolean;
  readonly pesanKosong?: string;
  /** Sel aksi tambahan di kolom paling kanan. */
  readonly aksi?: (baris: T) => ReactNode;
  /** Class tambahan untuk baris tertentu (mis. sorot tugas perlu verifikasi). */
  readonly barisClassName?: (baris: T) => string | undefined;
  readonly className?: string;
}

const GAYA_RATA = {
  kiri: 'text-left',
  tengah: 'text-center',
  kanan: 'text-right',
} as const;

export function Tabel<T>({
  kolom,
  data,
  kunciBaris,
  memuat = false,
  pesanKosong = 'Belum ada data untuk ditampilkan.',
  aksi,
  barisClassName,
  className,
}: PropertiTabel<T>) {
  const kosong = !memuat && data.length === 0;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {kolom.map((satu) => (
              <th
                key={satu.kunci}
                scope="col"
                style={satu.lebar ? { width: satu.lebar } : undefined}
                className={cn(
                  'px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase',
                  GAYA_RATA[satu.rata ?? 'kiri'],
                  satu.sembunyikanDiLayarKecil ? 'hidden md:table-cell' : undefined,
                )}
              >
                {satu.judul}
              </th>
            ))}
            {aksi ? (
              <th
                scope="col"
                className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase"
              >
                Aksi
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {memuat ? (
            <tr>
              <td colSpan={kolom.length + (aksi ? 1 : 0)} className="px-3 py-2">
                <PemuatBaris />
              </td>
            </tr>
          ) : null}

          {kosong ? (
            <tr>
              <td
                colSpan={kolom.length + (aksi ? 1 : 0)}
                className="px-3 py-10 text-center text-sm text-slate-500"
              >
                {pesanKosong}
              </td>
            </tr>
          ) : null}

          {!memuat &&
            data.map((baris, indeks) => (
              <tr
                key={kunciBaris(baris, indeks)}
                className={cn('hover:bg-slate-50/80', barisClassName?.(baris))}
              >
                {kolom.map((satu) => (
                  <td
                    key={satu.kunci}
                    className={cn(
                      'px-3 py-2 align-middle text-slate-700',
                      GAYA_RATA[satu.rata ?? 'kiri'],
                      satu.sembunyikanDiLayarKecil ? 'hidden md:table-cell' : undefined,
                    )}
                  >
                    {satu.nilai
                      ? satu.nilai(baris, indeks)
                      : String((baris as Record<string, unknown>)[satu.kunci] ?? '—')}
                  </td>
                ))}
                {aksi ? (
                  <td className="px-3 py-2 text-right whitespace-nowrap">{aksi(baris)}</td>
                ) : null}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
