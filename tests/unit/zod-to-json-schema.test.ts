/**
 * Test konversi skema Zod ke JSON Schema.
 *
 * Bug paling penting yang ditemukan lewat pengujian live: `.describe()` pada
 * parameter tool HILANG saat konversi, sehingga model tidak pernah menerima
 * petunjuk cara mengisi parameter.
 *
 * Gejalanya halus: tool dipanggil dengan argumen kosong, validasi gagal, dan
 * tidak ada yang tahu bahwa instruksinya sebenarnya tidak pernah dikirim.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchema } from '../../src/tools/registry.js'

describe('zodToJsonSchema', () => {
  it('BUG REGRESSION: description ikut ke JSON Schema', () => {
    const schema = z.object({
      title: z.string().describe('WAJIB. Nama kegiatan dari kalimat pengguna.'),
    })

    const hasil = zodToJsonSchema(schema as never) as {
      properties: Record<string, { description?: string }>
    }

    expect(hasil.properties.title?.description).toBe('WAJIB. Nama kegiatan dari kalimat pengguna.')
  })

  it('mempertahankan description pada SEMUA jenis field', () => {
    // Kalau ada satu jenis yang lupa, model kehilangan petunjuknya di sana
    // saja — dan bug-nya tidak terlihat.
    const schema = z.object({
      teks: z.string().describe('deskripsi string'),
      angka: z.number().describe('deskripsi number'),
      bulat: z.number().int().describe('deskripsi integer'),
      benar: z.boolean().describe('deskripsi boolean'),
      daftar: z.array(z.string()).describe('deskripsi array'),
      objek: z.object({ a: z.string() }).describe('deskripsi object'),
      pilihan: z.enum(['a', 'b']).describe('deskripsi enum'),
    })

    const hasil = zodToJsonSchema(schema as never) as {
      properties: Record<string, { description?: string }>
    }

    for (const [key, expected] of Object.entries({
      teks: 'deskripsi string',
      angka: 'deskripsi number',
      bulat: 'deskripsi integer',
      benar: 'deskripsi boolean',
      daftar: 'deskripsi array',
      objek: 'deskripsi object',
      pilihan: 'deskripsi enum',
    })) {
      expect(hasil.properties[key]?.description, key).toBe(expected)
    }
  })

  it('description tetap ikut pada field optional dan nullable', () => {
    // Wrapper (optional/nullable/default) tidak boleh menelan description
    // dari field di dalamnya.
    const schema = z.object({
      a: z.string().optional().describe('opsional'),
      b: z.string().nullish().describe('nullable'),
      c: z.string().default('x').describe('default'),
    })

    const hasil = zodToJsonSchema(schema as never) as {
      properties: Record<string, { description?: string }>
    }

    expect(hasil.properties.a?.description).toBe('opsional')
    expect(hasil.properties.b?.description).toBe('nullable')
    expect(hasil.properties.c?.description).toBe('default')
  })

  it('TETAP menjaga aturan validasi', () => {
    // Menambahkan description tidak boleh mengubah aturan.
    const schema = z.object({
      nama: z.string().min(3).max(20),
      kode: z.string().uuid(),
      jumlah: z.number().int().min(1).max(10),
    })

    const hasil = zodToJsonSchema(schema as never) as {
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }

    expect(hasil.properties.nama).toMatchObject({ type: 'string', minLength: 3, maxLength: 20 })
    expect(hasil.properties.kode).toMatchObject({ type: 'string', format: 'uuid' })
    expect(hasil.properties.jumlah).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
    expect(hasil.required.sort()).toEqual(['jumlah', 'kode', 'nama'])
  })

  it('field tanpa description tidak mendapat key kosong', () => {
    const schema = z.object({ polos: z.string() })
    const hasil = zodToJsonSchema(schema as never) as {
      properties: Record<string, Record<string, unknown>>
    }

    expect(hasil.properties.polos).not.toHaveProperty('description')
  })

  it('tidak menambah description yang menipu pada field required', () => {
    // Poinnya: `required` dan `description` adalah dua hal berbeda. Tool
    // `attendance.create` sempat gagal karena model tidak tahu `title` wajib
    // diisi meski sudah ditulis "WAJIB" di description — description-nya
    // sendiri yang hilang.
    const schema = z.object({
      title: z.string().describe('WAJIB'),
    })
    const hasil = zodToJsonSchema(schema as never) as {
      required: string[]
      properties: Record<string, { description?: string }>
    }

    expect(hasil.required).toEqual(['title'])
    expect(hasil.properties.title?.description).toBe('WAJIB')
  })
})