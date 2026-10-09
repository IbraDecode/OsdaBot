/**
 * Sidebar dinamis Dasbor OSDA.
 *
 * Sidebar dibangun dari GRUP_MENU di `src/lib/menu.ts` dan disaring memakai
 * izin efektif pengguna (`punyaIzin`). Nama peran TIDAK pernah dipakai untuk
 * menentukan menu (spec §34), sehingga peran/jabatan baru yang dibuat lewat
 * database langsung tercermin di sini tanpa mengubah kode.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Ikon } from '@/components/ikon';
import { useSesi } from '@/contexts/sesi';
import { cn } from '@/lib/gaya';
import { GRUP_MENU } from '@/lib/menu';
import { labelRuangKerja } from '@/lib/ruang-kerja';

export interface PropertiSidebar {
  readonly terbuka: boolean;
  readonly onTutup: () => void;
}

export function Sidebar({ terbuka, onTutup }: PropertiSidebar) {
  const { pengguna, punyaIzin, ruangKerja } = useSesi();
  const jalur = usePathname();

  return (
    <>
      {terbuka ? (
        <button
          type="button"
          aria-label="Tutup menu"
          className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden"
          onClick={onTutup}
        />
      ) : null}

      <aside
        aria-label="Menu utama"
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-200 bg-white',
          'transition-transform lg:static lg:translate-x-0',
          terbuka ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-merek-600 text-sm font-bold text-white">
            OS
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Dasbor OSDA</p>
            <p className="text-xs text-slate-500">OSIS Digital Admin</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {GRUP_MENU.map((grup) => {
            // Item disembunyikan bila izinnya tidak dimiliki pengguna.
            const itemTerlihat = grup.item.filter(
              (item) => !item.izin || punyaIzin(item.izin),
            );
            if (itemTerlihat.length === 0) return null;

            return (
              <div key={grup.nama}>
                <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  {grup.nama}
                </p>
                <ul className="space-y-0.5">
                  {itemTerlihat.map((item) => {
                    const aktif = jalur === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onTutup}
                          title={item.keterangan}
                          aria-current={aktif ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                            aktif
                              ? 'bg-merek-50 text-merek-700'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                          )}
                        >
                          <Ikon nama={item.ikon} ukuran={18} className="shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[11px] tracking-wider text-slate-400 uppercase">Ruang kerja</p>
          <p className="text-sm font-medium text-slate-700">{labelRuangKerja(ruangKerja)}</p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {pengguna?.name ?? '—'}
          </p>
        </div>
      </aside>
    </>
  );
}
