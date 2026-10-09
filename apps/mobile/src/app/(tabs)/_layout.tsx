/**
 * Navigasi tab bawah.
 *
 * Navigasi Mobile SENGAJA tidak meniru sidebar Web 1:1 (spec §65). Mobile
 * fokus pada quick action: Beranda, Tugas, Notifikasi, Profil.
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
        tabBarActiveTintColor: '#0369a1',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          paddingBottom: dalam.bottom,
          borderTopColor: '#e2e8f0',
          backgroundColor: '#ffffff',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Beranda' }} />
      <Tabs.Screen name="tugas" options={{ title: 'Tugas' }} />
      <Tabs.Screen name="notifikasi" options={{ title: 'Notifikasi' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
