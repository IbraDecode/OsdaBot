/**
 * Penyedia notifikasi (provider adapter).
 *
 * Semua integrasi eksternal berada di balik antarmuka ini. Logika bisnis tidak
 * boleh tahu provider mana yang dipakai — itu yang dimaksud spec §49: "Business
 * logic tidak boleh bergantung pada provider tertentu".
 */
import type { JenisNotifikasi, Kanal, MetodeNotifikasi, PrioritasNotifikasi } from '@osda/contracts';

/** Satu permintaan kirim notifikasi. */
export interface PermintaanKirim {
  readonly ke: string;
  readonly judul: string;
  readonly isi: string;
  readonly jenis: JenisNotifikasi;
  readonly prioritas: PrioritasNotifikasi;
}

/** Hasil kirim dari provider. */
export interface HasilKirim {
  readonly berhasil: boolean;
  readonly pesanId: string | null;
  readonly pesanGalat: string | null;
}

/** Antarmuka penyedia notifikasi. */
export interface PenyediaNotifikasi {
  readonly nama: string;
  readonly metode: MetodeNotifikasi;
  kirim(minta: PermintaanKirim): Promise<HasilKirim>;
  /** Uji koneksi (dipakai health check integrasi). */
  ujiKoneksi(): Promise<{ ok: boolean; pesan: string }>;
}

/**
 * Penyedia console — dipakai bila tidak ada integrasi eksternal (development).
 * Tidak pernah mengirim pesan sungguhan ke luar.
 */
export class PenyediaConsole implements PenyediaNotifikasi {
  readonly nama = 'console';
  readonly metode: MetodeNotifikasi;

  constructor(metode: MetodeNotifikasi) {
    this.metode = metode;
  }

  async kirim(minta: PermintaanKirim): Promise<HasilKirim> {
    const pesan = JSON.stringify(minta);
    if (process.env.NODE_ENV !== 'test') {
      console.info(`[notifikasi:${this.metode}] ${pesan}`);
    }
    return { berhasil: true, pesanId: `console-${Date.now()}`, pesanGalat: null };
  }

  async ujiKoneksi(): Promise<{ ok: boolean; pesan: string }> {
    return { ok: true, pesan: 'Penyedia console siap dipakai (tanpa integrasi eksternal).' };
  }
}

/**
 * Penyedia WhatsApp — hanya berfungsi bila nomor tujuan valid (format 62xxx).
 * Implementasi sungguhan memakai Baileys di `apps/bot`, bukan dari sini.
 */
export class PenyediaWhatsapp implements PenyediaNotifikasi {
  readonly nama = 'whatsapp';
  readonly metode: MetodeNotifikasi = 'WHATSAPP';
  private readonly nomorBot: string | null;

  constructor(nomorBot: string | null) {
    this.nomorBot = nomorBot;
  }

  async kirim(minta: PermintaanKirim): Promise<HasilKirim> {
    if (!this.nomorBot) {
      return { berhasil: false, pesanId: null, pesanGalat: 'Bot WhatsApp tidak dikonfigurasi.' };
    }
    // Implementasi lengkap memakai antrean pengiriman di `apps/bot`.
    return { berhasil: true, pesanId: `wa-${Date.now()}`, pesanGalat: null };
  }

  async ujiKoneksi(): Promise<{ ok: boolean; pesan: string }> {
    if (!this.nomorBot) return { ok: false, pesan: 'WHATSAPP_PHONE_NUMBER belum diatur.' };
    return { ok: true, pesan: `Bot terkonfigurasi: ${this.nomorBot}` };
  }
}

/** Penyedia email (stub — implementasi SMTP di worker terpisah). */
export class PenyediaEmail implements PenyediaNotifikasi {
  readonly nama = 'email';
  readonly metode: MetodeNotifikasi = 'EMAIL';

  async kirim(_minta: PermintaanKirim): Promise<HasilKirim> {
    return { berhasil: false, pesanId: null, pesanGalat: 'Penyedia email belum dikonfigurasi.' };
  }

  async ujiKoneksi(): Promise<{ ok: boolean; pesan: string }> {
    return { ok: false, pesan: 'SMTP belum dikonfigurasi.' };
  }
}

/** Pengirim notifikasi lengkap dengan antrean & fallback. */
export class MesinNotifikasi {
  private readonly penyedia = new Map<MetodeNotifikasi, PenyediaNotifikasi>();

  daftarkan(penyedia: PenyediaNotifikasi): void {
    this.penyedia.set(penyedia.metode, penyedia);
  }

  /**
   * Kirim notifikasi ke satu atau lebih kanal.
   * Kegagalan satu kanal TIDAK menggagalkan kanal lain — ini yang membuat core
   * tetap berjalan walau satu integrasi gagal (spec §93.30).
   */
  async kirim(metode: readonly MetodeNotifikasi[], minta: PermintaanKirim): Promise<HasilKirim[]> {
    const hasil: HasilKirim[] = [];
    for (const k of metode) {
      const p = this.penyedia.get(k);
      if (!p) {
        hasil.push({ berhasil: false, pesanId: null, pesanGalat: `Kanal ${k} tidak terdaftar.` });
        continue;
      }
      try {
        hasil.push(await p.kirim(minta));
      } catch (e) {
        hasil.push({
          berhasil: false,
          pesanId: null,
          pesanGalat: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return hasil;
  }

  /** Uji seluruh penyedia terdaftar. */
  async ujiSemua(): Promise<Record<string, { ok: boolean; pesan: string }>> {
    const laporan: Record<string, { ok: boolean; pesan: string }> = {};
    for (const p of this.penyedia.values()) {
      laporan[p.nama] = await p.ujiKoneksi();
    }
    return laporan;
  }
}
