/**
 * Navigasi Tab Bawah Mobile OSDA BOT:
 * Sesuai konsep desain poin 6:
 * Lima menu utama: Beranda, Agenda, Tugas, Notifikasi, dan Profil.
 * Warna: Navy (#0B132B), Emas (#C5A059), Ivory (#FAF9F6).
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LayoutTab(): React.ReactElement {
  const dalam = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#C5A059',
        tabBarInactiveTintColor: '#A0AEC0',
        tabBarStyle: {
          paddingBottom: Math.max(dalam.bottom, 6),
          paddingTop: 6,
          height: 60 + Math.max(dalam.bottom, 0),
          borderTopColor: '#E8E6DF',
          backgroundColor: '#0B132B',
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Beranda' }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda' }} />
      <Tabs.Screen name="tugas" options={{ title: 'Tugas' }} />
      <Tabs.Screen name="notifikasi" options={{ title: 'Notifikasi' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
