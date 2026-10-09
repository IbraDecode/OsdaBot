/**
 * Konteks sesi Mobile.
 *
 * Menyimpan profil pengguna + izin efektif. Token TIDAK ada di sini — token
 * hanya hidup di penyimpanan aman (lihat `lib/api.ts`).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { ProfilPengguna } from '@osda/contracts';

import { profil, sudahMasuk } from '../lib/api';

/** Bentuk konteks sesi. */
export interface KonteksSesi {
  readonly memuat: boolean;
  readonly pengguna: ProfilPengguna | null;
  readonly sudahMasuk: boolean;
  punyaIzin(izin: string): boolean;
  punyaCakupan(cakupan: string): boolean;
  muatUlang(): Promise<void>;
  keluar(): Promise<void>;
}

const KonteksSesiReact = createContext<KonteksSesi | null>(null);

/** Penyedia konteks sesi. */
export function PenyediaSesi({ children }: { children: React.ReactNode }): React.ReactElement {
  const [memuat, setMemuat] = useState(true);
  const [pengguna, setPengguna] = useState<ProfilPengguna | null>(null);

  const muatUlang = useCallback(async () => {
    setMemuat(true);
    try {
      if (await sudahMasuk()) {
        setPengguna(await profil());
      } else {
        setPengguna(null);
      }
    } catch {
      setPengguna(null);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  const nilai = useMemo<KonteksSesi>(
    () => ({
      memuat,
      pengguna,
      sudahMasuk: pengguna !== null,
      punyaIzin: (izin: string) => pengguna?.izin.includes(izin) ?? false,
      punyaCakupan: (cakupan: string) => pengguna?.peran.some((p) => p.cakupan.includes(cakupan as never)) ?? false,
      muatUlang,
      keluar: async () => {
        const { keluar: keluarApi } = await import('../lib/api');
        await keluarApi();
        setPengguna(null);
      },
    }),
    [memuat, pengguna, muatUlang],
  );

  return <KonteksSesiReact.Provider value={nilai}>{children}</KonteksSesiReact.Provider>;
}

/** Ambil konteks sesi. Melempar galat bila dipakai di luar penyedia. */
export function useSesi(): KonteksSesi {
  const konteks = useContext(KonteksSesiReact);
  if (!konteks) throw new Error('useSesi harus dipakai di dalam PenyediaSesi.');
  return konteks;
}
