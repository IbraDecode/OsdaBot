/**
 * Tab Profil — identitas, peran, dan status keuangan milik sendiri.
 *
 * Tombol "Keluar" menghapus token dari penyimpanan aman dan mencabut sesi.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Lencana, Kartu } from '../../components/ui';
import { useSesi } from '../../contexts/sesi';

export default function Profil(): React.ReactElement {
  const { pengguna, keluar } = useSesi();

  if (!pengguna) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <Text className="text-slate-500">Silakan masuk terlebih dahulu.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View className="items-center gap-2 rounded-xl bg-white p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-sky-100">
          <Text className="text-2xl font-bold text-sky-800">
            {pengguna.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text className="text-xl font-bold text-slate-900">{pengguna.name}</Text>
        <Text className="text-sm text-slate-500">{pengguna.email ?? pengguna.phone ?? '—'}</Text>
        <View className="mt-2 flex-row flex-wrap justify-center gap-2">
          {pengguna.peran.map((p) => (
            <Lencana key={p.kode} teks={p.nama} nada="sky" />
          ))}
        </View>
      </View>

      <Kartu judul="Akun">
        <BarisData label="ID Pengguna" nilai={pengguna.userId} />
        <BarisData label="ID Anggota" nilai={pengguna.memberId ?? 'Belum tertaut ke anggota'} />
        <BarisData label="Status Akun" nilai={pengguna.status} />
        <BarisData label="Organisasi" nilai={`${pengguna.organizationIds.length} terhubung`} />
      </Kartu>

      <Kartu judul="Izin Efektif">
        <Text className="text-xs leading-5 text-slate-600">
          Izin di bawah dibaca dari server, bukan disimpan di perangkat. Backend tetap memeriksa
          ulang setiap permintaan.
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {pengguna.izin.map((i) => (
            <Lencana key={i} teks={i} />
          ))}
        </View>
      </Kartu>
    </ScrollView>
  );
}

/** Satu baris label → nilai di dalam kartu. */
function BarisData({ label, nilai }: { label: string; nilai: string }): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium text-slate-900" numberOfLines={1}>
        {nilai}
      </Text>
    </View>
  );
}
