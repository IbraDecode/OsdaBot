/** Bidang masukan berlabel + pesan galat. */
import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/gaya';

export interface PropertiBidang {
  readonly label: string;
  readonly htmlFor?: string;
  readonly pesanGalat?: string | null;
  readonly petunjuk?: string;
  readonly wajib?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Bidang({
  label,
  htmlFor,
  pesanGalat,
  petunjuk,
  wajib = false,
  className,
  children,
}: PropertiBidang) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
        {wajib ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {petunjuk && !pesanGalat ? <p className="text-xs text-slate-500">{petunjuk}</p> : null}
      {pesanGalat ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {pesanGalat}
        </p>
      ) : null}
    </div>
  );
}

export interface PropertiMasukan extends InputHTMLAttributes<HTMLInputElement> {
  readonly tidakValid?: boolean;
}

export function Masukan({ className, tidakValid = false, ...sisa }: PropertiMasukan) {
  return (
    <input
      className={cn(
        'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs',
        'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50',
        tidakValid ? 'border-red-400' : 'border-slate-300',
        className,
      )}
      aria-invalid={tidakValid || undefined}
      {...sisa}
    />
  );
}
