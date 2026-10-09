/**
 * Konteks sesi pengguna.
 *
 * Menyimpan profil pengguna hasil `GET /api/v1/users/me` beserta IZIN EFEKTIF
 * dan CAKUPAN yang dipakai seluruh UI:
 *   - `punyaIzin('member.write')` → menentukan tombol/kolom yang tampil
 *   - `punyaCakupan('ORGANIZATION')` → menentukan keluasan data yang tampil
 *
 * PENTING: pemeriksaan ini hanya untuk UX. Otorisasi sebenarnya ditegakkan
 * backend (JwtAuthGuard + IzinGuard + OrganizationGuard). Menyembunyikan menu
 * TIDAK membuat endpoint menjadi aman — backend selalu dipercaya sebagai
 * satu-satunya penjaga.
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Cakupan, ProfilPengguna } from '@osda/contracts';

import { api, ambilTokenAkses, pesanDariGalat } from '@/lib/api-client';
import { ruangKerjaDariPeran } from '@/lib/ruang-kerja';

/** Nilai yang disediakan konteks sesi. */
export interface NilaiSesi {
  readonly pengguna: ProfilPengguna | null;
  /** Daftar izin efektif milik pengguna (dari API, bukan dari peran di UI). */
  readonly izin: readonly string[];
  /** Daftar cakupan efektif milik pengguna. */
  readonly cakupan: readonly Cakupan[];
  /** Ruang kerja default hasil `RUANG_KERJA_PERAN`. */
  readonly ruangKerja: string;
  readonly memuat: boolean;
  readonly galat: string | null;
  /** Apakah pengguna punya sesi/login (ada token). */
  readonly adaSesiAktif: boolean;
  masuk: (email: string, kataSandi: string) => Promise<void>;
  keluar: () => Promise<void>;
  segarkanProfil: () => Promise<void>;
  /** Cek satu izin, mis. `punyaIzin('member.write')`. */
  punyaIzin: (izin: string) => boolean;
  /** Cek beberapa izin sekaligus (semua wajib ada). */
  punyaSemuaIzin: (...izin: readonly string[]) => boolean;
  /** Cek salah satu izin (cukup satu ada). */
  punyaSalahSatuIzin: (...izin: readonly string[]) => boolean;
  /** Cek cakupan efektif, mis. `punyaCakupan('ORGANIZATION')`. */
  punyaCakupan: (cakupan: Cakupan) => boolean;
}

const KonteksSesi = createContext<NilaiSesi | null>(null);

export function PenyediaSesi({ children }: Readonly<{ children: ReactNode }>) {
  const [pengguna, setPengguna] = useState<ProfilPengguna | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const muatProfil = useCallback(async () => {
    if (!ambilTokenAkses()) {
      setPengguna(null);
      setMemuat(false);
      return;
    }
    try {
      const profil = await api.ambil<ProfilPengguna>('/api/v1/users/me');
      setPengguna(profil);
      setGalat(null);
    } catch (kesalahan: unknown) {
      setPengguna(null);
      setGalat(pesanDariGalat(kesalahan));
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatProfil();
  }, [muatProfil]);

  const masuk = useCallback(async (email: string, kataSandi: string) => {
    const hasil = await api.masuk(email, kataSandi);
    // Profil sudah ikut dalam hasil masuk; ambil ulang agar izin terbaru terpakai.
    const profil = await api.ambil<ProfilPengguna>('/api/v1/users/me').catch(() => hasil.pengguna);
    setPengguna(profil);
    setGalat(null);
    setMemuat(false);
  }, []);

  const keluar = useCallback(async () => {
    await api.keluar();
    setPengguna(null);
  }, []);

  const izin = useMemo<readonly string[]>(() => pengguna?.izin ?? [], [pengguna]);
  const cakupan = useMemo<readonly Cakupan[]>(
    () =>
      pengguna?.peran.flatMap((peran) => [...peran.cakupan]) ?? [],
    [pengguna],
  );

  const ruangKerja = useMemo(
    () => ruangKerjaDariPeran(pengguna?.peran.map((peran) => peran.kode) ?? []),
    [pengguna],
  );

  const punyaIzin = useCallback((kunciIzin: string) => izin.includes(kunciIzin), [izin]);

  const punyaSemuaIzin = useCallback(
    (...kunciIzin: readonly string[]) => kunciIzin.every((satu) => izin.includes(satu)),
    [izin],
  );

  const punyaSalahSatuIzin = useCallback(
    (...kunciIzin: readonly string[]) => kunciIzin.some((satu) => izin.includes(satu)),
    [izin],
  );

  const punyaCakupan = useCallback(
    (kunciCakupan: Cakupan) => cakupan.includes(kunciCakupan),
    [cakupan],
  );

  const nilai = useMemo<NilaiSesi>(
    () => ({
      pengguna,
      izin,
      cakupan,
      ruangKerja,
      memuat,
      galat,
      adaSesiAktif: pengguna !== null,
      masuk,
      keluar,
      segarkanProfil: muatProfil,
      punyaIzin,
      punyaSemuaIzin,
      punyaSalahSatuIzin,
      punyaCakupan,
    }),
    [
      pengguna,
      izin,
      cakupan,
      ruangKerja,
      memuat,
      galat,
      masuk,
      keluar,
      muatProfil,
      punyaIzin,
      punyaSemuaIzin,
      punyaSalahSatuIzin,
      punyaCakupan,
    ],
  );

  return <KonteksSesi.Provider value={nilai}>{children}</KonteksSesi.Provider>;
}

/** Akses konteks sesi. Harus dipakai di dalam {@link PenyediaSesi}. */
export function useSesi(): NilaiSesi {
  const nilai = useContext(KonteksSesi);
  if (!nilai) {
    throw new Error('useSesi harus dipakai di dalam <PenyediaSesi>.');
  }
  return nilai;
}
