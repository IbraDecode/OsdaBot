/** Layout khusus halaman masuk — kartu di tengah layar. */
import type { ReactNode } from 'react';

import { Ikon } from '@/components/ikon';

export const metadata = {
  title: 'Masuk',
};

export default function LayoutAuth({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-merek-600 text-base font-bold text-white">
            <Ikon nama="dasbor" ukuran={24} />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">Dasbor OSDA</h1>
          <p className="text-sm text-slate-500">
            OSIS Digital Administration &amp; Operations Platform
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
