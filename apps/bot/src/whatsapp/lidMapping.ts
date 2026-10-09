/**
 * Pemetaan LID ⇄ PN untuk OSDA Bot.
 *
 * WhatsApp (Baileys v7) memakai session-key LID (`@lid`) yang bersifat
 * sementara, sementara nomor telepon (`@s.whatsapp.net`) adalah identitas
 * stabil. Seluruh pasangan LID↔PN yang terlihat — dari pesan maupun event
 * `lid-mapping.update` — didaftarkan di sini supaya identitas pengirim bisa
 * selalu dikanonikkan ke PN tanpa memanggil jaringan.
 *
 * CATATAN: cache ini hanya optimasi. Identitas akhir (PN → member) selalu
 * ditentukan oleh OSDA API lewat `POST /identity/whatsapp/resolve`.
 */
import { isLidUser, isPnUser, jidNormalizedUser as ju } from '@whiskeysockets/baileys';

const lidKePn = new Map<string, string>();

/** Batas jumlah entri agar memori tidak tumbuh tanpa batas. */
const BATAS_ENTRI = 5000;

function setTerbatas(kunci: string, nilai: string): void {
  if (lidKePn.size >= BATAS_ENTRI && !lidKePn.has(kunci)) {
    const kunciPertama = lidKePn.keys().next();
    if (!kunciPertama.done) lidKePn.delete(kunciPertama.value);
  }
  lidKePn.set(kunci, nilai);
}

/** Daftarkan pasangan LID → PN. */
export function daftarLidPn(lid: string, pn: string): void {
  const l = ju(lid);
  const p = ju(pn);
  if (!l || !p) return;
  if (isLidUser(l) && isPnUser(p)) setTerbatas(l, p);
}

/** Daftarkan pasangan dari dua JID yang belum tentu urutannya LID/PN. */
export function daftarPasangan(a: string | undefined, b: string | undefined): void {
  if (!a || !b) return;
  const x = ju(a);
  const y = ju(b);
  if (!x || !y) return;
  if (isLidUser(x) && isPnUser(y)) daftarLidPn(x, y);
  else if (isLidUser(y) && isPnUser(x)) daftarLidPn(y, x);
}

/** PN stabil untuk sebuah LID, bila pasangannya pernah terlihat. */
export function cariPn(lid: string): string | undefined {
  return lidKePn.get(ju(lid));
}

/** Jumlah entri cache — dipakai untuk log diagnostik. */
export function ukuranPetaLid(): number {
  return lidKePn.size;
}

/** Kosongkan cache (dipakai saat logout/self-heal 401). */
export function resetPetaLid(): void {
  lidKePn.clear();
}
