/**
 * Hook pengambil data dari API OSDA.
 *
 * Dipakai semua halaman agar pola memuat/muat-ulang/penanganan galat seragam.
 * `kunci` menentukan kapan data perlu diambil ulang (mis. nomor halaman atau
 * filter) — jadi fungsi pemuat boleh dibuat inline tanpa efek berulang.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { pesanDariGalat } from '@/lib/api-client';

export interface HasilAmbil<T> {
  readonly data: T | null;
  readonly memuat: boolean;
  readonly galat: string | null;
  /** Panggil setelah aksi (simpan/ubah status) untuk mengambil data terbaru. */
  readonly muatUlang: () => void;
}

export function useAmbil<T>(pemuat: () => Promise<T>, kunci: string): HasilAmbil<T> {
  const [data, setData] = useState<T | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const pemuatRef = useRef(pemuat);

  pemuatRef.current = pemuat;

  useEffect(() => {
    let masihAktif = true;
    setMemuat(true);
    setGalat(null);

    pemuatRef
      .current()
      .then((hasil) => {
        if (masihAktif) setData(hasil);
      })
      .catch((kesalahan: unknown) => {
        if (masihAktif) setGalat(pesanDariGalat(kesalahan));
      })
      .finally(() => {
        if (masihAktif) setMemuat(false);
      });

    return () => {
      masihAktif = false;
    };
  }, [kunci, nonce]);

  const muatUlang = useCallback(() => {
    setNonce((nilai) => nilai + 1);
  }, []);

  return { data, memuat, galat, muatUlang };
}

/** Unduhan berkas: jalankan aksi, lalu tampilkan hasil/hasil galat sebagai teks. */
export interface HasilUnduh {
  readonly sedangMengunduh: boolean;
  readonly pesan: string | null;
  readonly unduh: () => Promise<void>;
}

export function useUnduh(aksi: () => Promise<void>): HasilUnduh {
  const [sedangMengunduh, setSedangMengunduh] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const aksiRef = useRef(aksi);
  aksiRef.current = aksi;

  const unduh = useCallback(async () => {
    setSedangMengunduh(true);
    setPesan(null);
    try {
      await aksiRef.current();
      setPesan('Berkas laporan berhasil diunduh.');
    } catch (kesalahan: unknown) {
      setPesan(pesanDariGalat(kesalahan));
    } finally {
      setSedangMengunduh(false);
    }
  }, []);

  return { sedangMengunduh, pesan, unduh };
}
