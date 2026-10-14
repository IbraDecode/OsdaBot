/**
 * Modal dasar (kosong).
 *
 * Sengaja tidak memuat logika apa pun selain pembukaan/penutupan dan
 * penanganan tombol Escape — isi modal disusun oleh pemanggil.
 */
'use client';

import { useCallback, useEffect, type ReactNode } from 'react';

import { cn } from '@/lib/gaya';

import { Tombol } from './tombol';

export interface PropertiModal {
  readonly terbuka: boolean;
  readonly judul: string;
  readonly deskripsi?: string;
  readonly onTutup: () => void;
  readonly children?: ReactNode;
  readonly kaki?: ReactNode;
  readonly lebar?: 'sedang' | 'lebar';
}

export function Modal({
  terbuka,
  judul,
  deskripsi,
  onTutup,
  children,
  kaki,
  lebar = 'sedang',
}: PropertiModal) {
  const tutupDenganEscape = useCallback(
    (peristiwa: KeyboardEvent) => {
      if (peristiwa.key === 'Escape') onTutup();
    },
    [onTutup],
  );

  useEffect(() => {
    if (!terbuka) return undefined;
    document.addEventListener('keydown', tutupDenganEscape);
    const gayaAwal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tutupDenganEscape);
      document.body.style.overflow = gayaAwal;
    };
  }, [terbuka, tutupDenganEscape]);

  if (!terbuka) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Tutup jendela"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onTutup}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        className={cn(
          'relative max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white shadow-xl',
          lebar === 'lebar' ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{judul}</h2>
            {deskripsi ? <p className="mt-1 text-sm text-slate-500">{deskripsi}</p> : null}
          </div>
          <Tombol varian="hantu" ukuran="kecil" onClick={onTutup} aria-label="Tutup">
            ✕
          </Tombol>
        </header>
        <div className="px-5 py-4">{children}</div>
        {kaki ? (
          <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            {kaki}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
