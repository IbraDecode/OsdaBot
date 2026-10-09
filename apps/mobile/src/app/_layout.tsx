/**
 * Root layout Mobile.
 *
 * Pembungkus: penyedia sesi + area aman (safe area). Navigasi memakai
 * `expo-router` berbasis berkas (file-based routing).
 */
import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { PenyediaSesi } from '../contexts/sesi';

export default function LayoutAkar(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <PenyediaSesi>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#f8fafc' },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="masuk" options={{ headerShown: true, title: 'Masuk' }} />
        </Stack>
      </PenyediaSesi>
    </SafeAreaProvider>
  );
}
