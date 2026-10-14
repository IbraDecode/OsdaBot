/**
 * Tab Agenda Mobile OSDA BOT — Jadwal Rapat & Kegiatan Organisasi.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Kartu, BarisRingkas } from '../../components/ui';

const AGENDA_MOBILE = [
  {
    id: 'ag-1',
    judul: 'Rapat Pleno Koordinasi Panitia LDKS',
    waktu: 'Hari ini · 14:30 WITA',
    lokasi: 'Ruang OSIS SMKN 2 Mataram',
    status: 'Wajib Hadir',
  },
  {
    id: 'ag-2',
    judul: 'Latihan Gabungan Pasukan Paskibra',
    waktu: '16 Okt · 16:00 WITA',
    lokasi: 'Lapangan Utama',
    status: 'Latihan',
  },
  {
    id: 'ag-3',
    judul: 'Upacara Peringatan Hari Sumpah Pemuda',
    waktu: '28 Okt · 07:30 WITA',
    lokasi: 'Halaman Sekolah',
    status: 'Upacara',
  },
];

export default function TabAgenda(): React.ReactElement {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FAF9F6' }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <View style={{ paddingTop: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#0B132B' }}>
          Agenda & Rapat
        </Text>
        <Text style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
          Jadwal resmi kepengurusan OSIS SMKN 2 Mataram 2026/2027
        </Text>
      </View>

      <Kartu judul="Agenda Mendatang">
        {AGENDA_MOBILE.map((item) => (
          <BarisRingkas
            key={item.id}
            judul={item.judul}
            keterangan={`${item.waktu} · ${item.lokasi}`}
            status={item.status}
          />
        ))}
      </Kartu>
    </ScrollView>
  );
}
