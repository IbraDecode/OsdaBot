import { describe, expect, it } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';

import { ekstrakTeksPesan, wadahPesanMasuk } from './account.js';

function pesanTiruan(isi: Record<string, unknown>, opsi: Partial<WAMessage['key']> = {}): WAMessage {
  return {
    key: { remoteJid: '6281234567890@s.whatsapp.net', id: 'pesan-1', fromMe: false, ...opsi },
    message: isi,
  } as unknown as WAMessage;
}

describe('ekstrakTeksPesan', () => {
  it('membaca percakapan biasa', () => {
    expect(ekstrakTeksPesan(pesanTiruan({ conversation: 'HADIR' }))).toBe('HADIR');
  });

  it('membaca extended text', () => {
    expect(
      ekstrakTeksPesan(pesanTiruan({ extendedTextMessage: { text: 'IZIN ada keperluan' } })),
    ).toBe('IZIN ada keperluan');
  });

  it('membaca caption media', () => {
    expect(ekstrakTeksPesan(pesanTiruan({ imageMessage: { caption: 'KAS' } }))).toBe('KAS');
  });

  it('membuka lapisan ephemeral message', () => {
    expect(
      ekstrakTeksPesan(pesanTiruan({ ephemeralMessage: { message: { conversation: 'STATUS' } } })),
    ).toBe('STATUS');
  });

  it('mengembalikan string kosong untuk pesan tanpa teks', () => {
    expect(ekstrakTeksPesan(pesanTiruan({ locationMessage: {} }))).toBe('');
  });
});

describe('wadahPesanMasuk', () => {
  it('mengabaikan pesan dari bot sendiri', () => {
    expect(wadahPesanMasuk(pesanTiruan({ conversation: 'HADIR' }, { fromMe: true }))).toBeNull();
  });

  it('mengabaikan pesan tanpa teks', () => {
    expect(wadahPesanMasuk(pesanTiruan({ locationMessage: {} }))).toBeNull();
  });

  it('mengenali pengirim nomor telepon (PN)', () => {
    const wadah = wadahPesanMasuk(pesanTiruan({ conversation: 'HADIR' }));
    expect(wadah?.pengirimJid).toBe('6281234567890@s.whatsapp.net');
    expect(wadah?.nomor).toBe('6281234567890');
    expect(wadah?.grup).toBe(false);
  });

  it('mengenali pengirim di grup beserta pasangan LID-nya', () => {
    const wadah = wadahPesanMasuk(
      pesanTiruan(
        { conversation: 'HADIR' },
        { remoteJid: '999@g.us', participant: '6287777777777@s.whatsapp.net' },
      ),
    );
    expect(wadah?.grup).toBe(true);
    expect(wadah?.pengirimJid).toBe('6287777777777@s.whatsapp.net');
  });

  it('mengumpulkan daftar mention', () => {
    const wadah = wadahPesanMasuk(
      pesanTiruan({
        extendedTextMessage: {
          text: '/daftarin @Reva Nur',
          contextInfo: { mentionedJid: ['628999999999@s.whatsapp.net'] },
        },
      }),
    );
    expect(wadah?.mentions).toEqual(['628999999999@s.whatsapp.net']);
  });
});
