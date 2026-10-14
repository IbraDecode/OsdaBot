/**
 * Beranda Mobile OSDA BOT — Konsep Desain Poin 6:
 * - Header dengan logo, identitas pengguna, dan notifikasi.
 * - Sapaan personal, tombol aksi cepat untuk Hadir, Izin, Agenda, dan Tugas.
 * - Kartu pengumuman terbaru dan daftar agenda mendatang.
 * - Layout vertikal yang nyaman di layar ponsel, teks tidak terpotong.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { panggil } from '../../lib/api';
import { useSesi } from '../../contexts/sesi';
import { KotakAksiEmas, Kartu, BarisRingkas } from '../../components/ui';

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
  readonly acaraMendatang: readonly {
    readonly id: string;
    readonly judul: string;
    readonly tanggal: string;
    readonly lokasi: string | null;
  }[];
  readonly pengumuman: readonly {
    readonly id: string;
    readonly judul: string;
    readonly terbitPada: string | null;
    readonly pin: boolean;
  }[];
  readonly statistik: {
    readonly persenKehadiran: number;
    readonly tugasSelesai: number;
    readonly tugasTotal: number;
  };
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAF9F6' }}>
        <Text style={{ color: '#718096', fontSize: 13 }}>Memuat dasbor OSDA BOT…</Text>
      </View>
    );
  }

  if (!masuk) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAF9F6' }}>
        <Text style={{ textAlign: 'center', color: '#718096', marginBottom: 16 }}>
          Sesi Anda belum aktif.
        </Text>
        <Pressable
          onPress={() => router.replace('/masuk')}
          style={{ backgroundColor: '#0B132B', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
        >
          <Text style={{ fontWeight: '700', color: '#FAF9F6' }}>Masuk Akun</Text>
        </Pressable>
      </View>
    );
  }

  const sesi = dasbor?.hariIni.sesiTerbuka ?? [];
  const tugas = dasbor?.tugasSaya ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FAF9F6' }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
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
      {/* Header Aplikasi Mobile: Logo, Identitas Sekolah, Notifikasi */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              backgroundColor: '#132247',
              borderColor: 'rgba(197, 160, 89, 0.4)',
              borderWidth: 1,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={require('../../../assets/logo.png')}
              style={{ width: 28, height: 28, resizeMode: 'contain' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0B132B' }}>
              OSDA BOT
            </Text>
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#C5A059', letterSpacing: 0.5 }}>
              OSIS SMKN 2 MATARAM
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/notifikasi')}
          style={{
            backgroundColor: '#FFFFFF',
            borderColor: '#E8E6DF',
            borderWidth: 1,
            borderRadius: 20,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#0B132B' }}>
            🔔 Lonceng
          </Text>
        </Pressable>
      </View>

      {/* Kartu Sapaan Personal */}
      <View
        style={{
          backgroundColor: '#0B132B',
          borderRadius: 20,
          padding: 18,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
          elevation: 3,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 11, color: '#C5A059', fontWeight: '700', textTransform: 'uppercase' }}>
            Periode 2026/2027
          </Text>
          <Text style={{ fontSize: 10, color: '#A0AEC0' }}>
            {dasbor?.hariIni.tanggal ?? 'Aktif'}
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#FAF9F6', marginTop: 6 }}>
          Hai, {pengguna?.name ?? dasbor?.nama}
        </Text>
        <Text style={{ fontSize: 12, color: '#CBD5E0', marginTop: 2 }}>
          {dasbor?.kelas ? `Kelas: ${dasbor.kelas}` : 'Pengurus OSIS SMKN 2 Mataram'}
        </Text>
      </View>

      {/* Tombol Aksi Cepat: Hadir, Izin, Agenda, Tugas */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <KotakAksiEmas
          label="HADIR"
          sublabel="Absen QR"
          onTekan={() => alert('Buka kamera pemindai QR kehadiran')}
        />
        <KotakAksiEmas
          label="IZIN"
          sublabel="Ajukan"
          onTekan={() => alert('Formulir surat izin/sakit')}
        />
        <KotakAksiEmas
          label="AGENDA"
          sublabel="Jadwal"
          onTekan={() => router.push('/agenda')}
        />
        <KotakAksiEmas
          label="TUGAS"
          sublabel="Daftar"
          onTekan={() => router.push('/tugas')}
        />
      </View>

      {/* Sesi Absensi Aktif Hari Ini */}
      <Kartu judul="Sesi Absensi Hari Ini">
        {sesi.length === 0 ? (
          <Text style={{ fontSize: 12, color: '#718096', paddingVertical: 4 }}>
            Tidak ada sesi presensi yang sedang dibuka saat ini.
          </Text>
        ) : (
          sesi.map((s) => (
            <BarisRingkas
              key={s.id}
              judul={s.judul}
              keterangan={s.lokasi ?? s.jenis}
              status={s.statusSaya ?? 'Belum Presensi'}
            />
          ))
        )}
      </Kartu>

      {/* Tugas Saya */}
      <Kartu judul="Tugas Prioritas Anda" aksi={{ label: 'Lihat Semua', onTekan: () => router.push('/tugas') }}>
        {tugas.length === 0 ? (
          <Text style={{ fontSize: 12, color: '#718096', paddingVertical: 4 }}>
            Semua tugas Anda telah diselesaikan. Kerja bagus!
          </Text>
        ) : (
          tugas.slice(0, 3).map((t) => (
            <BarisRingkas
              key={t.id}
              judul={t.judul}
              keterangan={t.batasWaktu ? `Batas: ${t.batasWaktu.slice(0, 10)}` : null}
              status={t.status}
            />
          ))
        )}
      </Kartu>

      {/* Kartu Pengumuman Terbaru */}
      <Kartu judul="Pengumuman Terbaru">
        {dasbor?.pengumuman && dasbor.pengumuman.length > 0 ? (
          dasbor.pengumuman.slice(0, 2).map((p) => (
            <BarisRingkas
              key={p.id}
              judul={p.judul}
              keterangan={p.terbitPada ? `Rilis: ${p.terbitPada.slice(0, 10)}` : null}
              status="Resmi"
            />
          ))
        ) : (
          <Text style={{ fontSize: 12, color: '#718096', paddingVertical: 4 }}>
            Belum ada edaran baru hari ini.
          </Text>
        )}
      </Kartu>
    </ScrollView>
  );
}
