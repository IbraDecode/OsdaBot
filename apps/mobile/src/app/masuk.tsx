/**
 * Halaman Masuk Aplikasi Mobile OSDA BOT.
 * Identitas: Navy gelap (#0B132B), Emas (#C5A059), Ivory (#FAF9F6).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useSesi } from '../contexts/sesi';

export default function Masuk(): React.ReactElement {
  const router = useRouter();
  const { masuk } = useSesi();

  const [email, setEmail] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [memproses, setMemproses] = useState(false);
  const [pesanGalat, setPesanGalat] = useState<string | null>(null);

  async function handleMasuk() {
    if (!email.trim() || !kataSandi) {
      setPesanGalat('Email dan kata sandi wajib diisi.');
      return;
    }
    setMemproses(true);
    setPesanGalat(null);
    try {
      await masuk(email.trim(), kataSandi);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      setPesanGalat(err instanceof Error ? err.message : 'Gagal masuk akun.');
    } finally {
      setMemproses(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: '#0B132B' }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
        }}
      >
        {/* Identitas Logo */}
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View
            style={{
              width: 80,
              height: 80,
              backgroundColor: '#132247',
              borderColor: 'rgba(197, 160, 89, 0.5)',
              borderWidth: 1.5,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 5,
            }}
          >
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 56, height: 56, resizeMode: 'contain' }}
            />
          </View>

          <Text
            style={{
              marginTop: 16,
              fontSize: 24,
              fontWeight: '800',
              color: '#FAF9F6',
              letterSpacing: 1,
            }}
          >
            OSDA BOT
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 11,
              fontWeight: '700',
              color: '#C5A059',
              letterSpacing: 2,
            }}
          >
            OSIS SMKN 2 MATARAM
          </Text>
          <Text style={{ marginTop: 2, fontSize: 11, color: '#A0AEC0' }}>
            Portal Anggota Periode 2026/2027
          </Text>
        </View>

        {/* Kotak Formulir */}
        <View
          style={{
            backgroundColor: '#132247',
            borderColor: '#1C3166',
            borderWidth: 1,
            borderRadius: 20,
            padding: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 6,
            elevation: 3,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FAF9F6' }}>
            Masuk Pengurus
          </Text>
          <Text style={{ fontSize: 11, color: '#A0AEC0', marginTop: 2, marginBottom: 20 }}>
            Gunakan email terdaftar pada sistem OSDA BOT.
          </Text>

          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#FAF9F6', marginBottom: 6 }}>
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="nama@smkn2mataram.sch.id"
                placeholderTextColor="#718096"
                style={{
                  backgroundColor: '#050B18',
                  borderColor: '#1C3166',
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 13,
                  color: '#FAF9F6',
                }}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#FAF9F6', marginBottom: 6 }}>
                Kata Sandi
              </Text>
              <TextInput
                value={kataSandi}
                onChangeText={setKataSandi}
                secureTextEntry
                placeholder="••••••••••••"
                placeholderTextColor="#718096"
                style={{
                  backgroundColor: '#050B18',
                  borderColor: '#1C3166',
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 13,
                  color: '#FAF9F6',
                }}
              />
            </View>

            {pesanGalat ? (
              <View
                style={{
                  backgroundColor: 'rgba(229, 62, 62, 0.15)',
                  borderColor: '#E53E3E',
                  borderWidth: 1,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <Text style={{ fontSize: 11, color: '#FC8181', fontWeight: '500' }}>
                  {pesanGalat}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleMasuk}
              disabled={memproses}
              style={{
                backgroundColor: '#C5A059',
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 6,
              }}
            >
              {memproses ? (
                <ActivityIndicator color="#0B132B" size="small" />
              ) : (
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#0B132B' }}>
                  Masuk Sekarang
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        <Text style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#718096' }}>
          &copy; 2026/2027 OSIS SMKN 2 Mataram
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
