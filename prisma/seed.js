/**
 * Seed data pengembangan.
 *
 * ATURAN: semua data di sini FIKTIF. Jangan pernah menaruh data pribadi nyata
 * (nama asli anggota sekolah, nomor WhatsApp asli) di dalam repository.
 *
 * Gunanya: supaya developer bisa menjalankan dan menguji alur lengkap tanpa
 * menyentuh data organisasi yang sebenarnya.
 */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, PERMISSION_GROUPS } from '../src/security/permissions.js';
import { ROLE_TEMPLATES, expandPermissions } from '../src/security/role-templates.js';
import { canonicalizeName } from '../src/identity/name-normalizer.js';
const prisma = new PrismaClient();
/** Anggota fiktif untuk uji resolusi nama & ambiguitas. */
const FAKE_MEMBERS = [
    { fullName: 'Danya Sefti Cahyani', className: 'X AKL 3', aliases: ['Danya', 'Dany'] },
    { fullName: 'Danya Putri Rahma', className: 'X MPK 1', aliases: ['Danya Putri'] },
    { fullName: 'Ibra Ramdan', className: 'X BDG 1', aliases: ['Ibra'] },
    { fullName: 'Ni Ketut Rianti', className: 'X MPK 1', aliases: ['Rianti'] },
    { fullName: 'Ahmad Fauzi', className: 'XI RPL 2', aliases: ['Fauzi'] },
];
export async function seed() {
    console.log('Menyiapkan data contoh OSDABOT...');
    // 1. Permission global (dipakai semua organisasi).
    for (const permission of ALL_PERMISSIONS) {
        await prisma.permission.upsert({
            where: { key: permission },
            create: {
                key: permission,
                group: findGroup(permission),
                description: PERMISSION_DESCRIPTIONS[permission] ?? null,
            },
            update: { group: findGroup(permission), description: PERMISSION_DESCRIPTIONS[permission] ?? null },
        });
    }
    console.log(`  ✓ ${ALL_PERMISSIONS.length} permission`);
    // 2. Organisasi contoh.
    const organization = await prisma.organization.upsert({
        where: { slug: 'organisasi-contoh' },
        create: {
            name: 'OSIS Contoh (DATA FIKTIF)',
            slug: 'organisasi-contoh',
            timezone: 'Asia/Makassar',
            locale: 'id',
            settings: {
                groupActivation: 'MENTION_OR_REPLY',
                requireApprovalForBulkMessages: true,
                note: 'Organisasi contoh untuk pengembangan. Semua data di sini fiktif.',
            },
        },
        update: {},
    });
    console.log(`  ✓ organisasi "${organization.name}"`);
    // 3. Role template + permission.
    for (const template of ROLE_TEMPLATES) {
        const permissions = expandPermissions(template.permissions, ALL_PERMISSIONS);
        const role = await prisma.organizationRole.upsert({
            where: { organizationId_key: { organizationId: organization.id, key: template.key } },
            create: {
                organizationId: organization.id,
                key: template.key,
                name: template.name,
                description: template.description,
                isSystem: true,
            },
            update: { name: template.name, description: template.description },
        });
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
        await prisma.rolePermission.createMany({
            data: permissions.map((permissionId) => ({ roleId: role.id, permissionId })),
            skipDuplicates: true,
        });
    }
    console.log(`  ✓ ${ROLE_TEMPLATES.length} role`);
    // 4. Anggota fiktif.
    for (const member of FAKE_MEMBERS) {
        const searchName = canonicalizeName(member.fullName);
        const existing = await prisma.organizationMember.findFirst({
            where: { organizationId: organization.id, searchName },
        });
        if (existing)
            continue;
        await prisma.organizationMember.create({
            data: {
                organizationId: organization.id,
                fullName: member.fullName,
                className: member.className,
                searchName,
                nickname: member.aliases[0] ?? null,
                aliases: { create: member.aliases.map((alias) => ({ alias: canonicalizeName(alias) })) },
            },
        });
    }
    console.log(`  ✓ ${FAKE_MEMBERS.length} anggota fiktif`);
    // 5. Kegiatan contoh dengan daftar hadir.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const existingAttendance = await prisma.attendanceEvent.findFirst({
        where: { organizationId: organization.id, title: 'Latihan LKBB (contoh)' },
    });
    if (!existingAttendance) {
        const attendance = await prisma.attendanceEvent.create({
            data: {
                organizationId: organization.id,
                title: 'Latihan LKBB (contoh)',
                eventDate: tomorrow,
                location: 'Lapangan sekolah',
                markdownTemplate: '*LIST YANG HADIR LKBB (CONTOH)*\n\n1. Contoh Anggota\n\n*IZIN*\n-',
                formatHints: { boldMarker: '*', emptyMarker: '-' },
            },
        });
        const members = await prisma.organizationMember.findMany({
            where: { organizationId: organization.id },
            take: 3,
            select: { id: true, fullName: true, className: true },
        });
        for (const [index, member] of members.entries()) {
            await prisma.attendanceEntry.create({
                data: {
                    attendanceEventId: attendance.id,
                    memberId: member.id,
                    displayName: member.fullName,
                    className: member.className,
                    status: index === 0 ? 'PRESENT' : 'UNCONFIRMED',
                    sortOrder: index,
                },
            });
        }
        console.log('  ✓ kegiatan contoh + daftar hadir');
    }
    console.log('\nSelesai. Data contoh siap dipakai.');
    console.log('Catatan: semua nama dan data di atas adalah FIKTIF untuk keperluan pengembangan.');
}
/** Kelompokkan permission berdasarkan grup yang sudah didefinisikan. */
function findGroup(permission) {
    for (const [group, permissions] of Object.entries(PERMISSION_GROUPS)) {
        if (permissions.includes(permission))
            return group;
    }
    return 'Lainnya';
}
seed()
    .catch((error) => {
    console.error('Seed gagal:', error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map