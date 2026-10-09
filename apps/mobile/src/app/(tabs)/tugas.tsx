/**
 * Tab Tugas.
 *
 * Menegaskan aturan utama OSDA: `DONE` belum berarti `VERIFIED`. Tugas yang
 * sudah dikerjakan tapi belum diverifikasi tetap ditampilkan dengan lencana
 * "Menunggu Verifikasi".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { panggil } from '../../lib/api';
import { BarisRingkas, Kartu, Lencana, PesanKosong } from '../../components/ui';

/** Bentuk tugas dari kontrak. */
interface Tugas {
  readonly id: string;
  readonly judul: string;
  readonly status: string;
  readonly verifikasi: string;
  readonly butuhVerifikasi: boolean;
  readonly prioritas: string;
  readonly batasWaktu: string | null;
  readonly overdue: boolean;
  readonly divisionNama: string | null;
  readonly programNama: string | null;
}

export default function Tugas(): React.ReactElement {
  const [daftar, setDaftar] = useState<Tugas[]>([]);
  const [menyegarkan, setMenyegarkan] = useState(false);

  const muat = useCallback(async () => {
    try {
      const hasil = await panggil<{ data: Tugas[] }>('/tasks?limit=50');
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

  const belumSelesai = daftar.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const menungguVerifikasi = daftar.filter(
    (t) => t.status === 'DONE' && t.butuhVerifikasi && t.verifikasi === 'UNVERIFIED',
  );

  return (
    <FlatList
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      data={belumSelesai}
      keyExtractor={(t) => t.id}
      refreshControl={
        <RefreshControl
          refreshing={menyegarkan}
          onRefresh={() => {
            setMenyegarkan(true);
            void muat();
          }}
        />
      }
      ListEmptyComponent={<PesanKosong teks="Tidak ada tugas yang belum selesai. Bagus!" />}
      ListHeaderComponent={
        <View className="gap-4">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-slate-900">Tugas</Text>
            <Text className="text-sm text-slate-600">
              {belumSelesai.length} belum selesai · {menungguVerifikasi.length} menunggu verifikasi
            </Text>
          </View>
          {menungguVerifikasi.length > 0 ? (
            <Kartu judul="Menunggu Verifikasi">
              {menungguVerifikasi.map((t) => (
                <BarisRingkas
                  key={t.id}
                  judul={t.judul}
                  keterangan={t.divisionNama ?? undefined}
                  nilai="DONE · belum diverifikasi"
                  sorot
                />
              ))}
            </Kartu>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View className="gap-1">
          <BarisRingkas
            judul={item.judul}
            keterangan={[
              item.programNama ?? item.divisionNama,
              item.batasWaktu ? `Tenggat ${item.batasWaktu}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            nilai={item.overdue ? 'TERLAMBAT' : item.status}
            sorot={item.overdue}
          />
          <View className="flex-row gap-2 pl-1">
            <Lencana teks={item.prioritas} nada={item.prioritas === 'URGENT' ? 'amber' : 'slate'} />
            {item.verifikasi === 'VERIFIED' ? <Lencana teks="TERVERIFIKASI" nada="emerald" /> : null}
          </View>
        </View>
      )}
    />
  );
}
