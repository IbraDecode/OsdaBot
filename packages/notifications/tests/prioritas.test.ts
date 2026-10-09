/**
 * Tes mesin notifikasi.
 *
 * Fokus pada aturan yang paling mudah dilanggar: TIDAK mengirim WhatsApp
 * untuk semua hal (spesifikasi §31). Hanya prioritas HIGH dan CRITICAL yang
 * boleh keluar lewat WhatsApp.
 */
import { describe, expect, it, vi } from 'vitest';

import type { JenisNotifikasi } from '@osda/contracts';

import {
  gabungkanNotifikasi,
  jadwalPengingat,
  LABEL_JENIS,
  pilihKanal,
  PRIORITAS_DEFAULT,
  PRIORITAS_WHATSAPP,
} from '../src/prioritas.js';
import {
  MesinNotifikasi,
  PenyediaConsole,
  PenyediaEmail,
  PenyediaWhatsapp,
  type PermintaanKirim,
} from '../src/penyedia.js';

const permintaan: PermintaanKirim = {
  ke: '6281234567890',
  judul: 'Absensi rapat',
  isi: 'Sesi absensi sudah dibuka.',
  jenis: 'ATTENDANCE',
  prioritas: 'HIGH',
};

describe('Prioritas bawaan per jenis', () => {
  it('semua jenis punya prioritas bawaan', () => {
    const semuaJenis: JenisNotifikasi[] = [
      'ATTENDANCE', 'TASK', 'MEETING', 'PROGRAM',
      'FINANCE', 'APPROVAL', 'ANNOUNCEMENT', 'SYSTEM',
    ];
    for (const jenis of semuaJenis) {
      expect(PRIORITAS_DEFAULT[jenis]).toBeDefined();
    }
  });

  it('absensi, keuangan, dan persetujuan berprioritas HIGH', () => {
    expect(PRIORITAS_DEFAULT.ATTENDANCE).toBe('HIGH');
    expect(PRIORITAS_DEFAULT.FINANCE).toBe('HIGH');
    expect(PRIORITAS_DEFAULT.APPROVAL).toBe('HIGH');
  });

  it('tugas dan pengumuman berprioritas NORMAL', () => {
    expect(PRIORITAS_DEFAULT.TASK).toBe('NORMAL');
    expect(PRIORITAS_DEFAULT.ANNOUNCEMENT).toBe('NORMAL');
  });
});

describe('Pemilihan kanal', () => {
  it('prioritas LOW hanya in-app — tidak mengirim ke mana pun', () => {
    const kanal = pilihKanal('SYSTEM', 'LOW', true);
    expect(kanal).toEqual(['IN_APP']);
  });

  it('prioritas NORMAL tidak pernah WhatsApp walau WhatsApp aktif', () => {
    expect(pilihKanal('TASK', 'NORMAL', true)).not.toContain('WHATSAPP');
    expect(pilihKanal('ANNOUNCEMENT', 'NORMAL', true)).not.toContain('WHATSAPP');
  });

  it('prioritas HIGH boleh WhatsApp bila kanal diaktifkan', () => {
    expect(pilihKanal('ATTENDANCE', 'HIGH', true)).toContain('WHATSAPP');
  });

  it('prioritas HIGH TIDAK boleh WhatsApp bila kanal dimatikan', () => {
    expect(pilihKanal('ATTENDANCE', 'HIGH', false)).not.toContain('WHATSAPP');
  });

  it('prioritas CRITICAL boleh WhatsApp', () => {
    expect(pilihKanal('APPROVAL', 'CRITICAL', true)).toContain('WHATSAPP');
  });

  it('selalu ada IN_APP sebagai kanal utama', () => {
    for (const jenis of Object.keys(PRIORITAS_DEFAULT) as JenisNotifikasi[]) {
      for (const prioritas of ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const) {
        expect(pilihKanal(jenis, prioritas, true)).toContain('IN_APP');
      }
    }
  });

  it('daftar prioritas WhatsApp hanya HIGH dan CRITICAL', () => {
    expect(PRIORITAS_WHATSAPP).toEqual(['HIGH', 'CRITICAL']);
  });

  it('memakai prioritas bawaan bila prioritas tidak diberikan', () => {
    expect(pilihKanal('ATTENDANCE', undefined, true)).toContain('WHATSAPP');
    expect(pilihKanal('TASK', undefined, true)).not.toContain('WHATSAPP');
  });
});

describe('Jadwal pengingat', () => {
  it('menolak jadwal yang sudah lewat', () => {
    // Tenggat 3 jam lagi:
    //   1440 menit sebelumnya = 21 jam lalu  → sudah lewat, dibuang
    //   60 menit sebelumnya   = 2 jam lagi  → masih valid
    //   10 menit sebelumnya   = 2j50m lagi → masih valid
    const tenggat = new Date(Date.now() + 3 * 60 * 60_000);
    const jadwal = jadwalPengingat(tenggat, [1440, 60, 10]);
    expect(jadwal).toHaveLength(2);
    expect(jadwal.every((w) => w.getTime() < tenggat.getTime())).toBe(true);
    expect(jadwal.every((w) => w.getTime() > Date.now())).toBe(true);
  });

  it('menahan semua pengingat bila tenggat masih jauh', () => {
    const tenggat = new Date(Date.now() + 30 * 24 * 60 * 60_000); // 30 hari lagi
    expect(jadwalPengingat(tenggat, [1440, 60, 10])).toHaveLength(3);
  });

  it('membuang pengingat yang jatuh di masa lalu', () => {
    const tenggat = new Date(Date.now() + 30 * 60_000); // 30 menit lagi
    // 1440 dan 60 menit sebelum itu sudah lewat; 10 menit belum.
    expect(jadwalPengingat(tenggat, [1440, 60, 10])).toHaveLength(1);
  });

  it('mengurutkan dari yang paling awal', () => {
    const tenggat = new Date(Date.now() + 5 * 24 * 60 * 60_000); // 5 hari lagi
    const jadwal = jadwalPengingat(tenggat);
    const waktu = jadwal.map((w) => w.getTime());
    expect([...waktu].sort((a, b) => a - b)).toEqual(waktu);
  });

  it('mengembalikan daftar kosong bila semua pengingat sudah lewat', () => {
    const tenggat = new Date(Date.now() - 60_000); // sudah lewat
    expect(jadwalPengingat(tenggat, [10, 60])).toEqual([]);
  });
});

describe('Penggabungan notifikasi', () => {
  it('mengembalikan kosong bila tidak ada daftar', () => {
    expect(gabungkanNotifikasi('Tugas', [])).toEqual({ judul: 'Tugas', isi: '' });
  });

  it('tidak menambahkan hitungan bila hanya satu', () => {
    expect(gabungkanNotifikasi('Tugas', ['Buat notulen'])).toEqual({
      judul: 'Tugas',
      isi: 'Buat notulen',
    });
  });

  it('menambahkan hitungan bila lebih dari satu', () => {
    const hasil = gabungkanNotifikasi('Tugas', ['A', 'B', 'C']);
    expect(hasil.judul).toBe('Tugas (3)');
    // Menyebut item pertama, lalu jumlah sisanya.
    expect(hasil.isi).toBe('A dan 2 lainnya');
  });
});

describe('Label jenis', () => {
  it('setiap jenis punya label Bahasa Indonesia', () => {
    for (const [jenis, label] of Object.entries(LABEL_JENIS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(jenis);
    }
  });
});

describe('Penyedia notifikasi', () => {
  it('penyedia console selalu berhasil', async () => {
    const p = new PenyediaConsole('IN_APP');
    const hasil = await p.kirim(permintaan);
    expect(hasil.berhasil).toBe(true);
    expect(hasil.pesanId).toBeTruthy();
  });

  it('penyedia WhatsApp gagal bila nomor bot belum diatur', async () => {
    const p = new PenyediaWhatsapp(null);
    const hasil = await p.kirim(permintaan);
    expect(hasil.berhasil).toBe(false);
    expect(hasil.pesanGalat).toContain('tidak dikonfigurasi');
  });

  it('uji koneksi WhatsApp melaporkan konfigurasi', async () => {
    expect((await new PenyediaWhatsapp(null).ujiKoneksi()).ok).toBe(false);
    expect((await new PenyediaWhatsapp('628123').ujiKoneksi()).ok).toBe(true);
  });

  it('penyedia email belum dikonfigurasi', async () => {
    expect((await new PenyediaEmail().kirim(permintaan)).berhasil).toBe(false);
  });
});

describe('Mesin notifikasi', () => {
  it('menggagalkan hanya kanal yang bermasalah, kanal lain tetap jalan', async () => {
    // Ini inti syarat "core tetap berjalan walaupun satu integrasi gagal".
    const mesin = new MesinNotifikasi();
    mesin.daftarkan(new PenyediaConsole('IN_APP'));
    mesin.daftarkan(new PenyediaWhatsapp(null)); // pasti gagal

    const hasil = await mesin.kirim(['IN_APP', 'WHATSAPP'], permintaan);
    expect(hasil).toHaveLength(2);
    expect(hasil.find((h) => h.berhasil)?.berhasil).toBe(true);
    expect(hasil.some((h) => !h.berhasil)).toBe(true);
  });

  it('menandai kanal yang tidak terdaftar sebagai gagal, bukan melempar galat', async () => {
    const mesin = new MesinNotifikasi();
    const hasil = await mesin.kirim(['PUSH'], permintaan);
    expect(hasil[0]?.berhasil).toBe(false);
    expect(hasil[0]?.pesanGalat).toContain('tidak terdaftar');
  });

  it('menyelimuti galat penyedia menjadi hasil, bukan exception', async () => {
    const mesin = new MesinNotifikasi();
    const rusak = {
      nama: 'rusak',
      metode: 'PUSH' as const,
      kirim: vi.fn().mockRejectedValue(new Error('Jaringan mati')),
      ujiKoneksi: async () => ({ ok: false, pesan: 'rusak' }),
    };
    mesin.daftarkan(rusak as never);
    const hasil = await mesin.kirim(['PUSH'], permintaan);
    expect(hasil[0]?.berhasil).toBe(false);
    expect(hasil[0]?.pesanGalat).toBe('Jaringan mati');
  });

  it('uji Semua melaporkan status setiap penyedia', async () => {
    const mesin = new MesinNotifikasi();
    mesin.daftarkan(new PenyediaConsole('IN_APP'));
    const laporan = await mesin.ujiSemua();
    expect(laporan.console?.ok).toBe(true);
  });
});
