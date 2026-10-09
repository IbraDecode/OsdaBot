/**
 * Tab Notifikasi — milik pengguna yang sedang masuk saja (object-level
 * authorization ditegakkan backend; Mobile hanya menampilkan).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { panggil } from '../../lib/api';
import { Lencana, PesanKosong } from '../../components/ui';

/** Bentuk notifikasi dari kontrak. */
interface Notifikasi {
  readonly id: string;
  readonly jenis: string;
  readonly judul: string;
  readonly isi: string;
  readonly prioritas: string;
  readonly sudahDibaca: boolean;
  readonly dibuatPada: string;
}

export default function Notifikasi(): React.ReactElement {
  const [daftar, setDaftar] = useState<Notifikasi[]>([]);
  const [menyegarkan, setMenyegarkan] = useState(false);

  const muat = useCallback(async () => {
    try {
      const hasil = await panggil<{ data: Notifikasi[] }>('/notifications?limit=50');
      setDaftar(hasil.data ?? []);
    } catch {
      setDaftar([]);
    } finally {
      setMenyegarkan(false);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tandaiDibaca = async (id: string): Promise<void> => {
    setDaftar((lama) =>
      lama.map((n) => (n.id === id ? { ...n, sudahDibaca: true } : n)),
    );
    await panggil(`/notifications/${id}/read`, { metode: 'POST', badan: {} }).catch(() => undefined);
  };

  const belumDibaca = daftar.filter((n) => !n.sudahDibaca).length;

  return (
    <FlatList
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={daftar}
      keyExtractor={(n) => n.id}
      refreshControl={
        <RefreshControl
          refreshing={menyegarkan}
          onRefresh={() => {
            setMenyegarkan(true);
            void muat();
          }}
        />
      }
      ListEmptyComponent={<PesanKosong teks="Tidak ada notifikasi." />}
      ListHeaderComponent={
        <View className="gap-1 pb-2">
          <Text className="text-2xl font-bold text-slate-900">Notifikasi</Text>
          <Text className="text-sm text-slate-600">
            {belumDibaca > 0 ? `${belumDibaca} belum dibaca` : 'Semua sudah dibaca'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => void tandaiDibaca(item.id)}
          className={`gap-1 rounded-xl border p-4 ${
            item.sudahDibaca ? 'border-slate-200 bg-white' : 'border-sky-300 bg-sky-50'
          }`}
        >
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 font-semibold text-slate-900">{item.judul}</Text>
            <Lencana
              teks={item.jenis}
              nada={item.prioritas === 'HIGH' || item.prioritas === 'CRITICAL' ? 'amber' : 'slate'}
            />
          </View>
          <Text className="text-sm text-slate-700">{item.isi}</Text>
          <Text className="text-xs text-slate-400">
            {new Date(item.dibuatPada).toLocaleString('id-ID')}
          </Text>
        </Pressable>
      )}
    />
  );
}
