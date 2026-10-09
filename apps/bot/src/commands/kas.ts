/**
 * Perintah kas: `KAS` untuk anggota dan `/kas` untuk pengurus.
 *
 * Nominal selalu diformat dengan `formatRupiah` dari `@osda/contracts` supaya
 * tampilan rupiah identik di seluruh client OSDA. Bot tidak pernah menghitung
 * saldo sendiri — saldo dihitung dari ledger lewat OSDA API.
 */
import { detailKas, ringkasanKeuangan } from '../api/client.js';
import { logger } from '../logger.js';
import { lewatiGerbangPengurus, pastikanAnggota } from '../services/gerbang-pengurus.js';
import * as tmpl from '../services/templates.js';
import { kirimTeks } from '../whatsapp/baileys.js';
import type { PesanMasuk } from '../whatsapp/account.js';
import { kodeGalat } from '../util/galat.js';

/**
 * `KAS` — status kas untuk anggota biasa: saldo organisasi + tunggakan pribadi.
 */
export async function tanganiKasAnggota(pesan: PesanMasuk): Promise<void> {
  const identitas = await pastikanAnggota(pesan);
  if (!identitas) return;

  const member = identitas.member;
  if (!member) return;

  try {
    const kas = await detailKas();
    const tunggakanSaya = kas.belumLunas.find((item) => item.memberId === member.id)?.nominal ?? 0;

    await kirimTeks(
      pesan.chatJid,
      tmpl.pesanKasAnggota({
        nama: member.nama,
        saldoAkhir: kas.saldoAkhir,
        pemasukan: kas.totalPemasukan,
        pengeluaran: kas.totalPengeluaran,
        periode: kas.periode,
        tagihanSaya: tunggakanSaya,
      }),
    );
  } catch (galat) {
    logger.warn({ galat, memberId: member.id }, 'Gagal membaca data kas');
    await kirimTeks(pesan.chatJid, tmpl.pesanKasGagal(kodeGalat(galat)));
  }
}

/** `/kas` — rekap keuangan untuk pengurus (bendahara/sekretaris). */
export async function tanganiKasPengurus(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'finance.read', async (identitas) => {
    try {
      const ringkasan = await ringkasanKeuangan();
      await kirimTeks(
        pesan.chatJid,
        tmpl.pesanKasPengurus({
          saldoSaatIni: ringkasan.saldoSaatIni,
          pemasukanBulanIni: ringkasan.pemasukanBulanIni,
          pengeluaranBulanIni: ringkasan.pengeluaranBulanIni,
          saldoBulanLalu: ringkasan.saldoBulanLalu,
          pendingExpense: ringkasan.pendingExpense,
          pendingReimbursement: ringkasan.pendingReimbursement,
        }),
      );
      logger.info({ memberId: identitas.member?.id }, 'Rekap keuangan dilihat lewat WhatsApp');
    } catch (galat) {
      logger.warn({ galat }, 'Gagal membaca rekap keuangan');
      await kirimTeks(pesan.chatJid, tmpl.pesanKasGagal(kodeGalat(galat)));
    }
  });
}
