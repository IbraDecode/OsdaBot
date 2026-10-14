/**
 * Komponen UI Dasar Mobile OSDA BOT.
 * Identitas Visual: Navy (#0B132B), Emas/Gold (#C5A059), Ivory (#FAF9F6).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

export function KotakAksiEmas({
  label,
  sublabel,
  onTekan,
}: {
  readonly label: string;
  readonly sublabel?: string;
  readonly onTekan?: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onTekan}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        backgroundColor: '#132247',
        borderColor: 'rgba(197, 160, 89, 0.4)',
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minWidth: 75,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FAF9F6', letterSpacing: 0.5 }}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={{ fontSize: 10, color: '#C5A059', marginTop: 2, fontWeight: '500' }}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function KotakAksi({
  label,
  nada = 'slate',
  onTekan,
}: {
  readonly label: string;
  readonly nada?: 'sky' | 'emerald' | 'amber' | 'violet' | 'slate';
  readonly onTekan?: () => void;
}): React.ReactElement {
  return <KotakAksiEmas label={label} onTekan={onTekan} />;
}

export function Kartu({
  judul,
  aksi,
  children,
}: {
  readonly judul: string;
  readonly aksi?: { label: string; onTekan: () => void };
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderColor: '#E8E6DF',
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'between', marginBottom: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#0B132B' }}>
          {judul}
        </Text>
        {aksi ? (
          <Pressable onPress={aksi.onTekan} accessibilityRole="button">
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#C5A059' }}>{aksi.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function BarisRingkas({
  judul,
  keterangan,
  status,
}: {
  readonly judul: string;
  readonly keterangan?: string | null;
  readonly status?: string | null;
}): React.ReactElement {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F4F2EC',
      }}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#0B132B' }}>{judul}</Text>
        {keterangan ? (
          <Text style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{keterangan}</Text>
        ) : null}
      </View>
      {status ? (
        <View
          style={{
            backgroundColor: '#FCF9F2',
            borderColor: 'rgba(197, 160, 89, 0.4)',
            borderWidth: 1,
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#93712B' }}>{status}</Text>
        </View>
      ) : null}
    </View>
  );
}
