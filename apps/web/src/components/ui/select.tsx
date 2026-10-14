/** Kotak pilihan (select) bergaya sama dengan komponen masukan. */
import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/gaya';

export interface OpsiPilihan {
  readonly nilai: string;
  readonly label: string;
}

export interface PropertiPilih extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly opsi: readonly OpsiPilihan[];
  /** Teks pilihan kosong di paling atas. */
  readonly placeholder?: string;
  readonly tidakValid?: boolean;
}

export function Pilih({
  opsi,
  placeholder = 'Semua',
  tidakValid = false,
  className,
  ...sisa
}: PropertiPilih) {
  return (
    <select
      className={cn(
        'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs',
        'disabled:cursor-not-allowed disabled:bg-slate-50',
        tidakValid ? 'border-red-400' : 'border-slate-300',
        className,
      )}
      aria-invalid={tidakValid || undefined}
      {...sisa}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {opsi.map((satu) => (
        <option key={satu.nilai} value={satu.nilai}>
          {satu.label}
        </option>
      ))}
    </select>
  );
}
