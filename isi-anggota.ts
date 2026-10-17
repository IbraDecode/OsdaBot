/**
 * Isi ulang data organisasi dengan daftar anggota sungguhan.
 *
 * ── Kenapa skrip terpisah, bukan `db:seed` ───────────────────────────────────
 *
 * `db:seed` mengisi data fiktif untuk pengembangan. Yang dibutuhkan di sini
 * berbeda: mengganti seluruh isi satu organisasi dengan daftar orang nyata,
 * termasuk nomor WhatsApp-nya.
 *
 * Dan "ganti" harus berarti benar-benar mengganti — bukan menumpuk di atas data
 * lama. Kalau tidak, "hapus semua anggota" menjadi setengah jadi, dan daftar
 * fiktif lama masih muncul di `organization_list_members`.
 *
 * ── Yang TIDAK dihapus ───────────────────────────────────────────────────────
 *
 * `User`, `WhatsAppIdentity`, dan `Conversation` untuk admin TIDAK dihapus.
 * Menghapus `User` milik admin akan memutus tautan nomor bot ke organisasi, dan
 * itu persis Hal yang membuat "bot tidak tahu saya siapa".
 *
 * Jalankan: pnpm exec tsx --env-file-if-exists=.env isi-anggota.ts --jalankan
 */
import { PrismaClient } from '@prisma/client'
import { MemberProvisioner } from './src/organization/member-onboarding.js'

const prisma = new PrismaClient()

/** Diisi di `main()`; dipakai oleh langkah pembersihan. */
let ORGANISASI_ID = ''

const SLUG = process.env.SLUG_ORG ?? 'osis-smkn-2-mataram'
const JALANKAN = process.argv.includes('--jalankan')

/**
 * Daftar anggota.
 *
 * Nomor diambil apa adanya dari daftar yang dikirim pemilik. `MemberProvisioner`
 * yang menormalkan — termasuk membuang karakter tak terlihat yang ikut terbawa
 * saat menyalin dari WhatsApp (`U+2060`, `U+202A`, dan sejenisnya). Kalau
 * karakter itu tidak dibuang, nama tersimpan tidak bisa diketik ulang dan
 * pencarian nama akan gagal diam-diam.
 *
 * Role `admin` diberikan ke pemilik (baris pertama) supaya dia tetap bisa
 * mengelola; sisanya `anggota`.
 */
const ANGGOTA: Array<{ nama: string; kelas: string; nomor: string; peran: string; alias: string[] }> = [
  { nama: 'Ibra Ramdan', kelas: 'X TKJ 3', nomor: '6285792820173', peran: 'admin', alias: ['Ibra'] },
  { nama: 'Ni Made Ayu Sugiartini', kelas: 'X AKL 3', nomor: '6287862619366', peran: 'member', alias: ['Ayu'] },
  { nama: 'Favian Rapha Putra Wibowo', kelas: 'X RPL 1', nomor: '6285738157086', peran: 'member', alias: ['Favian'] },
  { nama: 'Elyena Nuril Lian', kelas: 'X ULW 1', nomor: '6287896443886', peran: 'member', alias: ['Elyena'] },
  { nama: 'Ni Kadek Indri Eshyafany', kelas: 'X AKL 2', nomor: '6287768092701', peran: 'member', alias: ['Indri'] },
  { nama: 'Ni Made Sri Bukti Wulandari', kelas: 'X AKL 3', nomor: '6287826561882', peran: 'member', alias: ['Sri Bukti'] },
  { nama: 'Ni Kadek Purnami Oktavia Elyana', kelas: 'X BRT 1', nomor: '6282341115739', peran: 'member', alias: ['Purnami'] },
  { nama: 'Riani Febrina Khairo Ummatin', kelas: 'X AKL 3', nomor: '6281928051962', peran: 'member', alias: ['Riani'] },
  { nama: 'Ni Ketut Rianti', kelas: 'X MPK 1', nomor: '6285923637216', peran: 'member', alias: ['Rianti'] },
  { nama: 'Novidiya Salsa', kelas: 'X AKL 3', nomor: '6287712943871', peran: 'member', alias: ['Novidiya'] },
  { nama: 'Ghaitsa Kirani', kelas: 'X AKL 1', nomor: '6285337637573', peran: 'member', alias: ['Ghaitsa'] },
  { nama: 'Pandya Andika Daryanta', kelas: 'X RPL 1', nomor: '6288231170968', peran: 'member', alias: ['Pandya'] },
  { nama: 'Rania Sipa Akila', kelas: 'X TKJ 1', nomor: '6287775859621', peran: 'member', alias: ['Rania'] },
]

/** Tabel yang dibersihkan, berurutan sesuai ketergantungan foreign key. */
const BERSIHKAN: Array<{ label: string; jalankan: () => Promise<{ count: number }> }> = [
  {
    label: 'pembayaran',
    jalankan: () => prisma.payment.deleteMany({ where: { organizationId: ORGANISASI_ID } }),
  },
  {
    label: 'catatan kas',
    jalankan: () =>
      prisma.cashbookEntry.deleteMany({ where: { financeAccount: { organizationId: ORGANISASI_ID } } }),
  },
  {
    label: 'baris tagihan',
    jalankan: () => prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: ORGANISASI_ID } } }),
  },
  { label: 'tagihan', jalankan: () => prisma.invoice.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  { label: 'rekening', jalankan: () => prisma.financeAccount.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  {
    label: 'entri absensi',
    jalankan: () =>
      prisma.attendanceEntry.deleteMany({ where: { attendanceEvent: { organizationId: ORGANISASI_ID } } }),
  },
  { label: 'acara absensi', jalankan: () => prisma.attendanceEvent.deleteMany({ where: { organizationId: ORGANISASI_ID } } ) },
  {
    label: 'penugasan tugas',
    jalankan: () => prisma.taskAssignment.deleteMany({ where: { task: { organizationId: ORGANISASI_ID } } }),
  },
  {
    label: 'ketergantungan tugas',
    jalankan: () =>
      prisma.taskDependency.deleteMany({ where: { task: { organizationId: ORGANISASI_ID } } }),
  },
  { label: 'tugas', jalankan: () => prisma.task.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  { label: 'pengingat terjadwal', jalankan: () => prisma.scheduledJob.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  {
    label: 'tautan identitas anggota',
    jalankan: () => prisma.memberIdentityLink.deleteMany({ where: { organizationId: ORGANISASI_ID } }),
  },
  { label: 'alias anggota', jalankan: () => prisma.memberAlias.deleteMany({ where: { member: { organizationId: ORGANISASI_ID } } }) },
  {
    label: 'peran anggota',
    jalankan: () => prisma.memberRoleBinding.deleteMany({ where: { member: { organizationId: ORGANISASI_ID } } }),
  },
  { label: 'anggota', jalankan: () => prisma.organizationMember.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  {
    label: 'rekamasan agent',
    jalankan: () => prisma.agentTask.deleteMany({ where: { organizationId: ORGANISASI_ID } }),
  },
  { label: 'eksekusi tool', jalankan: () => prisma.toolExecution.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  { label: 'audit', jalankan: () => prisma.auditLog.deleteMany({ where: { organizationId: ORGANISASI_ID } }) },
  {
    label: 'sinyal organisasi',
   jalankan: () => prisma.organizationSignal.deleteMany({ where: { organizationId: ORGANISASI_ID } }),
  },
]


async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: SLUG },
    select: { id: true, name: true, timezone: true },
  })

  if (!org) {
    console.error(`Organisasi "${SLUG}" tidak ditemukan.`)
    console.error('Buat dulu dengan: pnpm osda org:create --name="..." --slug=... --admin-name="..." --admin-phone=...')
    await prisma.$disconnect()
    process.exit(1)
  }

  ORGANISASI_ID = org.id

  console.log('')
  console.log(`Organisasi : ${org.name} (${SLUG})`)
  console.log(`Zona waktu : ${org.timezone}`)
  console.log(`Akan diisi  : ${ANGGOTA.length} anggota`)
  console.log('')

  if (!JALANKAN) {
    console.log('MODE KERING — belum ada yang diubah.')
    console.log('Jalankan ulang dengan --jalankan untuk benar-benar menulis.')
    console.log('')
    for (const a of ANGGOTA) console.log(`  ${a.nama} (${a.kelas}) ${a.nomor} [${a.peran}]`)
    await prisma.$disconnect()
    process.exit(0)
  }

  // ── 1. Bersihkan ───────────────────────────────────────────────────────────
  console.log('Membersihkan data lama')
  for (const langkah of BERSIHKAN) {
    const hasil = await langkah.jalankan()
    if (hasil.count > 0) console.log(`  ${hasil.count.toString().padStart(5)} ${langkah.label}`)
  }

  // Percakapan tetap ada — isinya riwayat, bukan data organisasi. Menghapusnya
  // tidak memperbaiki apa pun dan hanya menghapus bukti.
  console.log('')

  // ── 2. Pastikan peran tersedia ─────────────────────────────────────────────
  const provisioner = new MemberProvisioner(prisma as never)
  const peranTersedia = await provisioner.listRoles(org.id)
  console.log(`Peran tersedia: ${peranTersedia.join(', ')}`)

  const peranDipakai = [...new Set(ANGGOTA.map((a) => a.peran))].filter((p) => !peranTersedia.includes(p))
  if (peranDipakai.length > 0) {
    console.error(`\nPeran tidak tersedia: ${peranDipakai.join(', ')}`)
    console.error(`Tersedia: ${peranTersedia.join(', ')}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log('')

  // ── 3. Isi anggota ─────────────────────────────────────────────────────────
  console.log('Menulis anggota')
  const hasil: Array<{ nama: string; nomor: string; status: string; memberId: string }> = []

  for (const a of ANGGOTA) {
    const r = await provisioner.addMembers({
      organizationId: org.id,
      members: [
        {
          fullName: a.nama,
          phone: a.nomor,
          className: a.kelas,
          roleKey: a.peran,
          ...(a.alias.length > 0 ? { aliases: a.alias } : {}),
        },
      ],
    })
    const satu = Array.isArray(r) ? r[0] : undefined
    if (!satu) {
      console.error(`  GAGAL  ${a.nama} — tidak ada hasil`)
      continue
    }
    hasil.push({
      nama: satu.fullName,
      nomor: satu.phone ?? a.nomor,
      status: satu.status,
      memberId: satu.memberId ?? '',
    })
    const tanda = satu.status === 'created' ? '+' : satu.status === 'updated' ? '~' : '!'
    console.log(`  ${tanda} ${satu.status.padEnd(12)} ${satu.fullName} (${a.kelas}) ${satu.phone}`)
  }

  // ── 3b. Samakan nama tampilan akun dengan nama anggota ─────────────────────
  //
  // Tanpa ini, bot menyapa "Admin OsdaBot" padahal daftar anggota sudah berisi
  // "Ibra Ramdan". Dan jawaban "nama asli kamu belum saya tahu" untuk orang yang
  // baru saja mengirim daftar lengkapnya terasa seperti kegagalan total.
  //
  // `MemberProvisioner` sengaja tidak menyentuh `User.displayName`: itu milik
  // akun, bukan milik organisasi. Di sini kebutusan eksplisit pemilik.
  const identitasPemilik = await prisma.whatsAppIdentity.findFirst({
    where: { phoneNumber: ANGGOTA[0]!.nomor },
    select: { userId: true },
  })
  if (identitasPemilik?.userId) {
    const lama = await prisma.user.findUnique({
      where: { id: identitasPemilik.userId },
      select: { displayName: true },
    })
    if (lama?.displayName !== ANGGOTA[0]!.nama) {
      await prisma.user.update({
        where: { id: identitasPemilik.userId },
        data: { displayName: ANGGOTA[0]!.nama },
      })
      console.log('')
      console.log(`Nama tampilan: "${lama?.displayName ?? '(kosong)'}" → "${ANGGOTA[0]!.nama}"`)
    }
  } else {
    console.log('')
    console.log('PERINGATAN: identitas pemilik tidak tertaut ke user. Bot tidak akan tahu nama Anda.')
  }

  // ── 4. Verifikasi ──────────────────────────────────────────────────────────
  const jumlah = await prisma.organizationMember.count({
    where: { organizationId: org.id, isActive: true },
  })

  console.log('')
  console.log(`Anggota aktif di database: ${jumlah}`)

  // Nama yang tersimpan harus bisa diketik ulang persis seperti yang dikirim.
  const tersimpan = await prisma.organizationMember.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { fullName: 'asc' },
    select: { fullName: true, className: true, searchName: true, identityLinks: { select: { identity: { select: { pnJid: true } } } } },
  })

  console.log('')
  console.log('ANGGOTA TERSIMPAN')
  for (const m of tersimpan) {
    const jid = m.identityLinks[0]?.identity.pnJid ?? '(tanpa nomor)'
    console.log(`  ${m.fullName} — ${m.className ?? '(tanpa kelas)'} — ${jid}`)
  }

  // Karakter tak terlihat = nama yang tidak bisa diketik ulang. Ini yang membuat
  // "cari Budi" gagal diam-diam beberapa minggu kemudian.
  const rusak = tersimpan.filter((m) => /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(m.fullName))
  if (rusak.length > 0) {
    console.error('')
    console.error(`PERINGATAN: ${rusak.length} nama masih mengandung karakter tak terlihat.`)
    for (const m of rusak) console.error(`  ${JSON.stringify(m.fullName)}`)
  }

  console.log('')
  const dibuat = hasil.filter((h) => h.status === 'created').length
  const diperbarui = hasil.filter((h) => h.status === 'updated').length
  const dilewati = hasil.filter((h) => h.status === 'skipped').length
  console.log(`Selesai. ${dibuat} dibuat, ${diperbarui} diperbarui, ${dilewati} dilewati.`)

  // ── 5. Cek kelengkapan ──────────────────────────────────────────────────────
  //
  // Kekurangan diam-diam adalah kegagalan yang paling menyesatkan: skrip
  // "berhasil" padahal satu orang tidak masuk. Jadi diperiksa eksplisit.
  const nomorDipakai = new Map(
    tersimpan.map((m) => [m.identityLinks[0]?.identity.pnJid?.split('@')[0] ?? '', m]),
  )
  const hilang = ANGGOTA.filter((a) => !nomorDipakai.has(a.nomor))
  const namaBeda = ANGGOTA.filter((a) => {
    const row = nomorDipakai.get(a.nomor)
    return row !== undefined && row.fullName !== a.nama
  })

  console.log('')
  if (hilang.length > 0) {
    console.log(`PERINGATAN: ${hilang.length} anggota tidak punya nomor tertaut:`)
    for (const a of hilang) console.log(`  ${a.nama} — ${a.nomor}`)
  } else {
    console.log(`Semua ${ANGGOTA.length} nomor tertaut ke anggota yang sesuai.`)
  }

  if (namaBeda.length > 0) {
    console.log('')
    console.log('PERINGATAN: nama tersimpan berbeda dari yang dikirim:')
    for (const a of namaBeda) {
      console.log(`  dikirim  : ${JSON.stringify(a.nama)}`)
      console.log(`  tersimpan: ${JSON.stringify(nomorDipakai.get(a.nomor)!.fullName)}`)
    }
  }

  await prisma.$disconnect()
  process.exit(0)
}

void main()