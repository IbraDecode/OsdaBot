/**
 * Komponen UI dasar Mobile.
 *
 * Sengaja sederhana: hanya komponen yang benar-benar dipakai. Warna memakai
 * palet `tailwind` agar konsisten dengan Web Dashboard.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

/** Warna aksi cepat. */
const WARNA_NADA = {
  sky: 'bg-sky-600',
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
  violet: 'bg-violet-600',
  slate: 'bg-slate-600',
} as const;

/** Nada warna aksi cepat. */
export type Nada = keyof typeof WARNA_NADA;

/** Kotak aksi cepat (tombol besar di beranda). */
export function KotakAksi({
  label,
  nada = 'slate',
  onTekan,
}: {
  label: string;
  nada?: Nada;
  onTekan?: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onTekan}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`min-w-[100px] flex-1 items-center rounded-xl px-3 py-4 ${WARNA_NADA[nada]}`}
    >
      <Text className="text-sm font-bold text-white">{label}</Text>
    </Pressable>
  );
}

/** Kartu berisi satu kelompok informasi. */
export function Kartu({
  judul,
  aksi,
  children,
}: {
  judul: string;
  aksi?: { label: string; onTekan: () => void };
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View className="rounded-xl border border-slate-200 bg-white p-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-slate-900">{judul}</Text>
        {aksi ? (
          <Pressable onPress={aksi.onTekan} accessibilityRole="button">
            <Text className="text-sm font-medium text-sky-700">{aksi.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Satu baris ringkasan: judul, keterangan, dan nilai/status di kanan. */
export function BarisRingkas({
  judul,
  keterangan,
  nilai,
  sorot = false,
  onTekan,
}: {
  judul: string;
  keterangan?: string;
  nilai?: string;
  sorot?: boolean;
  onTekan?: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onTekan}
      className={`flex-row items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        sorot ? 'border-amber-300 bg-amber-50' : 'border-slate-100'
      }`}
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-slate-900" numberOfLines={2}>
          {judul}
        </Text>
        {keterangan ? <Text className="text-xs text-slate-500">{keterangan}</Text> : null}
      </View>
      {nilai ? (
        <Text className="text-xs font-semibold text-slate-600" numberOfLines={1}>
          {nilai}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Lencana status berwarna. */
export function Lencana({
  teks,
  nada = 'slate',
}: {
  teks: string;
  nada?: Nada;
}): React.ReactElement {
  const pegas = {
    sky: 'bg-sky-100 text-sky-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    violet: 'bg-violet-100 text-violet-800',
    slate: 'bg-slate-100 text-slate-700',
  }[nada];
  return (
    <View className={`self-start rounded-full px-2 py-0.5 ${pegas}`}>
      <Text className="text-[11px] font-semibold">{teks}</Text>
    </View>
  );
}

/** Pesan kosong atau keterangan galat untuk sebuah layar. */
export function PesanKosong({ teks }: { teks: string }): React.ReactElement {
  return (
    <View className="items-center justify-center gap-2 p-8">
      <Text className="text-center text-sm text-slate-500">{teks}</Text>
    </View>
  );
}
