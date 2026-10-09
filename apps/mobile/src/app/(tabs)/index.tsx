/**
 * Beranda (Home) — tampilan anggota yang sederhana.
 *
 * Prinsip (spec §57): anggota tidak melihat complexity. Empat hal yang mereka
 * butuhkan hari ini: absensi, agenda, tugas, pengumuman.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { panggil } from '../../lib/api';
import { useSesi } from '../../contexts/sesi';
import { KotakAksi, Kartu, BarisRingkas } from '../../components/ui';

/** Bentuk dasbor anggota yang dipakai beranda. */
interface DasborAnggota {
  readonly nama: string;
  readonly kelas: string;
  readonly hariIni: {
    readonly tanggal: string;
    readonly sesiTerbuka: readonly {
      readonly id: string;
      readonly judul: string;
      readonly jenis: string;
      readonly waktuMulai: string | null;
      readonly lokasi: string | null;
      readonly qrAktif: boolean;
      readonly statusSaya: string | null;
    }[];
  };
  readonly tugasSaya: readonly {
    readonly id: string;
    readonly judul: string;
    readonly prioritas: string;
    readonly batasWaktu: string | null;
    readonly overdue: boolean;
    readonly status: string;
  }[];
  readonly acaraMendatang: readonly { readonly id: string; judul: string; tanggal: string; lokasi: string | null }[];
  readonly pengumuman: readonly { readonly id: string; judul: string; terbitPada: string | null; pin: boolean }[];
  readonly statistik: { readonly persenKehadiran: number; readonly tugasSelesai: number; readonly tugasTotal: number };
}

export default function Beranda(): React.ReactElement {
  const router = useRouter();
  const { pengguna, sudahMasuk: masuk, memuat } = useSesi();
  const [dasbor, setDasbor] = useState<DasborAnggota | null>(null);
  const [menyegarkan, setMenyegarkan] = useState(false);

  const muat = useCallback(async () => {
    if (!masuk) return;
    try {
      const data = await panggil<DasborAnggota>('/users/me/dashboard');
      setDasbor(data);
    } catch {
      setDasbor(null);
    } finally {
      setMenyegarkan(false);
    }
  }, [masuk]);

  useEffect(() => {
    void muat();
  }, [muat]);

  if (memuat) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <Text className="text-slate-500">Memuat…</Text>
      </View>
    );
  }

  if (!masuk) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-slate-50 p-6">
        <Text className="text-center text-slate-600">Anda belum masuk.</Text>
        <Pressable
          onPress={() => router.replace('/masuk')}
          className="rounded-lg bg-sky-700 px-6 py-3"
        >
          <Text className="font-semibold text-white">Masuk</Text>
        </Pressable>
      </View>
    );
  }

  const sesi = dasbor?.hariIni.sesiTerbuka ?? [];
  const tugas = dasbor?.tugasSaya ?? [];

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={menyegarkan}
          onRefresh={() => {
            setMenyegarkan(true);
            void muat();
          }}
        />
      }
    >
      {/* Sapaan */}
      <View className="gap-1">
        <Text className="text-sm text-slate-500">Selamat datang,</Text>
        <Text className="text-2xl font-bold text-slate-900">{pengguna?.name ?? dasbor?.nama}</Text>
        <Text className="text-sm text-slate-600">{dasbor?.kelas}</Text>
      </View>

      {/* Aksi cepat — empat aksi utama anggota */}
      <View className="flex-row flex-wrap gap-3">
        <KotakAksi label="ABSEN" nada="sky" />
        <KotakAksi label="IZIN" nada="amber" />
        <KotakAksi label="TUGAS" nada="emerald" />
        <KotakAksi label="AGENDA" nada="violet" />
      </View>

      {/* Sesi absensi hari ini */}
      <Kartu judul="Absensi Hari Ini">
        {sesi.length === 0 ? (
          <Text className="text-sm text-slate-500">Belum ada sesi absensi terbuka hari ini.</Text>
        ) : (
          sesi.map((s) => (
            <BarisRingkas
              key={s.id}
              judul={s.judul}
              keterangan={`${s.waktuMulai ?? '—'} · ${s.lokasi ?? 'Lokasi belum diisi'}`}
              nilai={s.statusSaya ?? 'BELUM'}
              sorot={s.statusSaya === null}
            />
          ))
        )}
      </Kartu>

      {/* Tugas */}
      <Kartu judul="Tugas Saya" aksi={{ label: 'Lihat semua', onTekan: () => router.push('/tugas') }}>
        {tugas.length === 0 ? (
          <Text className="text-sm text-slate-500">Tidak ada tugas yang belum selesai.</Text>
        ) : (
          tugas.slice(0, 5).map((t) => (
            <BarisRingkas
              key={t.id}
              judul={t.judul}
              keterangan={t.batasWaktu ? `Tenggat ${t.batasWaktu}` : 'Tanpa tenggat'}
              nilai={t.overdue ? 'TERLAMBAT' : t.status}
              sorot={t.overdue}
            />
          ))
        )}
      </Kartu>

      {/* Pengumuman */}
      <Kartu judul="Pengumuman">
        {(dasbor?.pengumuman ?? []).length === 0 ? (
          <Text className="text-sm text-slate-500">Belum ada pengumuman.</Text>
        ) : (
          (dasbor?.pengumuman ?? []).map((p) => (
            <BarisRingkas
              key={p.id}
              judul={p.judul}
              keterangan={p.terbitPada ? new Date(p.terbitPada).toLocaleDateString('id-ID') : ''}
              nilai={p.pin ? 'DISEMPATKAN' : undefined}
            />
          ))
        )}
      </Kartu>
    </ScrollView>
  );
}
