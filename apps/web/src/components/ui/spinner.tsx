/** Spinner pemuatan data. */
import { cn } from '@/lib/gaya';

import { PemuatKecil } from './tombol';

export function Pemuat({
  label = 'Memuat data…',
  className,
}: {
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 text-sm text-slate-500', className)}>
      <PemuatKecil className="size-4 border-2" />
      <span>{label}</span>
    </div>
  );
}

/** Pemuat layar penuh — dipakai saat sesi/profil sedang dimuat. */
export function PemuatHalaman({ label = 'Memuat…' }: { readonly label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <span
          role="status"
          aria-label={label}
          className="inline-block size-8 animate-spin rounded-full border-4 border-merek-200 border-t-merek-600"
        />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/** Kerangka tabel saat data masih dimuat. */
export function PemuatBaris({ jumlah = 5 }: { readonly jumlah?: number }) {
  return (
    <div className="space-y-2 py-2" aria-hidden="true">
      {Array.from({ length: jumlah }, (_, indeks) => (
        <div key={indeks} className="h-9 animate-pulse rounded-md bg-slate-100" />
      ))}
    </div>
  );
}
