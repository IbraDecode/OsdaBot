/**
 * Sidebar OSDA BOT — Navy gelap, aksen emas (gold), menu aktif ivory.
 * Konsisten untuk seluruh dasbor pengurus OSIS SMKN 2 Mataram 2026/2027.
 */
'use client';

import Image from 'next/image';
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
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={onTutup}
        />
      ) : null}

      <aside
        aria-label="Menu utama"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0B132B] text-white shadow-xl transition-transform lg:static lg:translate-x-0',
          terbuka ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Identitas Visual Brand Header */}
        <div className="flex items-center gap-3 border-b border-[#1C3166]/60 px-5 py-4">
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-[#C5A059]/40 bg-[#132247] shadow-inner">
            <Image
              src="/logo.png"
              alt="Logo OSDA BOT"
              width={32}
              height={32}
              className="object-contain"
              priority
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-serif text-base font-bold tracking-wide text-[#FAF9F6]">
                OSDA BOT
              </span>
              <span className="rounded-sm bg-[#C5A059]/20 px-1 py-0.5 text-[9px] font-semibold text-[#C5A059]">
                PRO
              </span>
            </div>
            <p className="truncate text-[10px] font-medium tracking-wider text-[#A0AEC0] uppercase">
              OSIS SMKN 2 MATARAM
            </p>
          </div>
        </div>

        {/* Daftar Navigasi Berkelompok */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 text-sm">
          {GRUP_MENU.map((grup) => {
            const itemTerlihat = grup.item.filter(
              (item) => !item.izin || punyaIzin(item.izin),
            );
            if (itemTerlihat.length === 0) return null;

            return (
              <div key={grup.nama}>
                <p className="px-3 pb-1 text-[10px] font-semibold tracking-widest text-[#718096] uppercase">
                  {grup.nama}
                </p>
                <ul className="space-y-1">
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
                            'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-150',
                            aktif
                              ? 'bg-[#FAF9F6] text-[#0B132B] font-semibold shadow-md'
                              : 'text-[#CBD5E0] hover:bg-[#132247] hover:text-[#FAF9F6]',
                          )}
                        >
                          <Ikon
                            nama={item.ikon}
                            ukuran={18}
                            className={cn(
                              'shrink-0 transition-colors',
                              aktif
                                ? 'text-[#C5A059]'
                                : 'text-[#A0AEC0] group-hover:text-[#C5A059]',
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Footer Sidebar: Ruang Kerja & Identitas Periode */}
        <div className="border-t border-[#1C3166]/60 bg-[#050B18]/50 p-3.5">
          <div className="rounded-lg border border-[#C5A059]/20 bg-[#132247]/70 p-2.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-[#C5A059]">Periode 2026/2027</span>
              <span className="rounded bg-[#C5A059]/10 px-1 py-0.5 text-[9px] text-[#D8B775]">
                {labelRuangKerja(ruangKerja)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs font-medium text-[#FAF9F6]">
              {pengguna?.name ?? 'Pengurus OSIS'}
            </p>
            <p className="truncate text-[10px] text-[#A0AEC0]">
              {pengguna?.email ?? 'smkn2mataram.sch.id'}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
