/**
 * Dump cadangan data OSDA BOT v0.4 dari database legacy.
 *
 * Dipakai untuk:
 *  - membuktikan ada cadangan sebelum mengosongkan database (spec §79)
 *  - menjadi bahan migrasi ke skema OSDA v2
 *
 * Keluaran:
 *  - <OUT_DIR>/osda-bot-legacy-<stamp>.sql   (restore-able)
 *  - <OUT_DIR>/osda-bot-legacy-<stamp>.json   (sumber migrasi)
 */
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

const ENV_LEGACY = '/home/jelastic/osda-bot/.env';
const OUT_DIR = process.argv[2] ?? '/home/jelastic/osda-backup';

/** Baca DATABASE_URL dari bot lama. */
function legacyUrl() {
  const txt = readFileSync(ENV_LEGACY, 'utf8');
  const m = txt.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`DATABASE_URL tidak ditemukan di ${ENV_LEGACY}`);
  return m[1].trim();
}

/** Literal SQL yang aman untuk berbagai tipe kolom. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'::bytea`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const sql = postgres(legacyUrl(), { ssl: 'require', max: 1, connect_timeout: 20 });
  mkdirSync(OUT_DIR, { recursive: true });

  const adaDump = readdirSync(OUT_DIR).filter((f) => f.endsWith('.sql'));
  if (adaDump.length > 0) {
    console.log('Dump sudah ada, dilewati:');
    for (const f of adaDump) console.log('  -', f);
    await sql.end();
    return;
  }

  const tabels = await sql`select tablename from pg_tables where schemaname='public' order by 1`;
  const urut = [
    'members',
    'attendance_sessions',
    'attendance',
    'moderators',
    'treasurers',
    'settings',
    'kas_weeks',
    'kas_payments',
    'kas_expenses',
  ];
  const daftar = urut
    .filter((t) => tabels.some((x) => x.tablename === t))
    .concat(tabels.map((t) => t.tablename).filter((t) => !urut.includes(t)));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = [
    '-- =====================================================================',
    '-- DUMP CADANGAN DATABASE OSDA BOT v0.4 (LEGACY)',
    `-- Dibuat : ${new Date().toISOString()}`,
    '-- Sumber : Neon PostgreSQL',
    '-- =====================================================================',
    '',
    'BEGIN;',
    '',
  ];

  const json = { dibuatPada: new Date().toISOString(), tabel: {} };

  for (const nama of daftar) {
    const kolom = await sql.unsafe(
      `select column_name, data_type, udt_name, is_nullable, column_default
         from information_schema.columns
        where table_schema='public' and table_name='${nama}'
        order by ordinal_position`,
    );
    const def = kolom.map((c) => {
      let tipe = c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type;
      if (c.data_type === 'ARRAY') tipe = c.udt_name.replace(/^_/, '') + '[]';
      return `${c.column_name} ${tipe}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`;
    });
    const constraint = await sql.unsafe(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = '${nama}'::regclass order by conname`,
    );

    out.push(`-- TABEL: ${nama}`);
    out.push(`DROP TABLE IF EXISTS "${nama}" CASCADE;`);
    out.push(`CREATE TABLE "${nama}" (\n  ${def.join(',\n  ')}\n);`);
    for (const c of constraint) out.push(`ALTER TABLE "${nama}" ADD CONSTRAINT ${c.conname} ${c.def};`);

    const baris = await sql.unsafe(`select * from public."${nama}"`);
    json.tabel[nama] = baris.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) {
        o[k] = Buffer.isBuffer(r[k])
          ? `<bytea ${r[k].length}>`
          : r[k] instanceof Date
            ? r[k].toISOString()
            : r[k];
      }
      return o;
    });

    if (baris.length > 0) {
      const daftarKolom = kolom.map((c) => `"${c.column_name}"`).join(', ');
      const nilai = baris.map(
        (r) => `  (${kolom.map((c) => lit(r[c.column_name])).join(', ')})`,
      );
      out.push('');
      out.push(`INSERT INTO "${nama}" (${daftarKolom}) VALUES`);
      out.push(nilai.join(',\n') + ';');
    }
    out.push('');

    // Sequence BIGSERIAL
    const seqKolom = kolom.filter((c) => /nextval\(/.test(c.column_default || ''));
    for (const c of seqKolom) {
      const sq = `${nama}_${c.column_name}_seq`;
      out.push(`CREATE SEQUENCE IF NOT EXISTS "${sq}" OWNED BY "${nama}"."${c.column_name}";`);
      out.push(
        `ALTER TABLE "${nama}" ALTER COLUMN "${c.column_name}" SET DEFAULT nextval('"${sq}"');`,
      );
    }
    console.log(`  ${nama}: ${baris.length} baris`);
  }

  // Setel sequence agar hasil restore bisa insert baru
  out.push('-- PENYETELAN SEQUENCE');
  for (const nama of daftar) {
    const seqKolom = (
      await sql.unsafe(
        `select a.attname
           from pg_attribute a
          where a.attrelid = '${nama}'::regclass and a.attnum > 0
            and pg_get_serial_sequence('${nama}', a.attname) is not null`,
      )
    ).map((r) => r.attname);
    for (const k of seqKolom) {
      const maks = (
        await sql.unsafe(`select coalesce(max("${k}"), 0) as m from public."${nama}"`)
      )[0].m;
      const nilai = String(maks) === '0' ? '1, false' : `${maks}, true`;
      out.push(
        `SELECT setval(pg_get_serial_sequence('"${nama}"', '${k}'), ${nilai}); -- ${nama}.${k}`,
      );
    }
  }

  out.push('COMMIT;', '');

  const namaSql = `${OUT_DIR}/osda-bot-legacy-${stamp}.sql`;
  const namaJson = `${OUT_DIR}/osda-bot-legacy-${stamp}.json`;
  writeFileSync(namaSql, out.join('\n'));
  writeFileSync(namaJson, JSON.stringify(json, null, 2));
  console.log('\n✓ Dump tersimpan:');
  console.log('  SQL :', namaSql);
  console.log('  JSON:', namaJson);
  await sql.end();
}

main().catch((e) => {
  console.error('Gagal dump:', e.message, e);
  process.exit(1);
});
