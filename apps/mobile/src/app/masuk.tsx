/**
 * Halaman Masuk.
 *
 * Token hasil masuk langsung disimpan di penyimpanan aman (Keychain/Keystore)
 * oleh `lib/api.ts` — tidak pernah di state React.
 */
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { GalatApi, masuk } from '../lib/api';
import { useSesi } from '../contexts/sesi';

export default function Masuk(): React.ReactElement {
  const router = useRouter();
  const { muatUlang } = useSesi();
  const [email, setEmail] = useState('');
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  const kirim = async (): Promise<void> => {
    setMemproses(true);
    setGalat(null);
    try {
      await masuk(email.trim(), sandi);
      await muatUlang();
      router.replace('/');
    } catch (e) {
      setGalat(
        e instanceof GalatApi
          ? e.message
          : 'Tidak dapat menghubungi server. Periksa jaringan Anda.',
      );
    } finally {
      setMemproses(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 justify-center bg-slate-50 p-6"
    >
      <View className="gap-6">
        <View className="gap-1">
          <Text className="text-3xl font-bold text-slate-900">OSDA</Text>
          <Text className="text-sm text-slate-600">
            Satu sistem untuk mengelola organisasi OSIS.
          </Text>
        </View>

        <View className="gap-3">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900"
          />
          <TextInput
            value={sandi}
            onChangeText={setSandi}
            placeholder="Kata sandi"
            secureTextEntry
            className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900"
          />
        </View>

        {galat ? (
          <Text className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{galat}</Text>
        ) : null}

        <Pressable
          onPress={() => void kirim()}
          disabled={memproses || email.length === 0 || sandi.length === 0}
          className="items-center rounded-lg bg-sky-700 px-4 py-3 disabled:opacity-50"
        >
          {memproses ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Masuk</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
