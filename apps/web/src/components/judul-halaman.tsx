/** Judul halaman + deskripsi singkat. */
import type { ReactNode } from 'react';

export function JudulHalaman({
  judul,
  deskripsi,
  aksi,
}: {
  readonly judul: string;
  readonly deskripsi?: ReactNode;
  readonly aksi?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{judul}</h1>
        {deskripsi ? <p className="mt-1 text-sm text-slate-500">{deskripsi}</p> : null}
      </div>
      {aksi ? <div className="flex flex-wrap items-center gap-2">{aksi}</div> : null}
    </div>
  );
}
