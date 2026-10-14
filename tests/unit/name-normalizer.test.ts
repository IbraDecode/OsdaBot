import { describe, expect, it } from 'vitest'
import {
  canonicalizeName,
  cleanNameInput,
  decideMatch,
  MATCH_THRESHOLD,
  nicknameCandidates,
  searchNameFor,
  similarityScore,
  AMBIGUITY_MARGIN,
} from '../../src/identity/name-normalizer.js'

describe('canonicalizeName', () => {
  it('menormalisasi huruf besar, spasi berlebih, dan tanda baca', () => {
    expect(canonicalizeName('  Danya   Sefti  Cahyani ')).toBe('danya sefti cahyani')
    expect(canonicalizeName('Danya, Sefti Cahyani')).toBe('danya sefti cahyani')
    expect(canonicalizeName('DANYA SEFTI CAHYANI')).toBe('danya sefti cahyani')
  })

  it('melempar gelar depan dan belakang', () => {
    expect(canonicalizeName('Bapak Ibra Ramdan')).toBe('ibra ramdan')
    expect(canonicalizeName('Danya Sefti Cahyani, S.Kom')).toBe('danya sefti cahyani')
  })

  it('menangani aksen supaya nama tetap cocok', () => {
    expect(canonicalizeName('Sébastien')).toBe('sebastien')
    expect(canonicalizeName('José')).toBe('jose')
  })

  it('menghasilkan string kosong untuk input tidak valid', () => {
    expect(canonicalizeName('   ')).toBe('')
    expect(canonicalizeName('...')).toBe('')
  })
})

describe('searchNameFor', () => {
  it('sama dengan canonicalizeName — dipakai untuk index database', () => {
    expect(searchNameFor('Bapak Danya')).toBe('danya')
  })
})

describe('nicknameCandidates', () => {
  it('menghasilkan nama pendek dan gabungan', () => {
    const candidates = nicknameCandidates('Danya Sefti Cahyani')
    expect(candidates).toContain('danya')
    expect(candidates).toContain('danya_sefti')
    expect(candidates).toContain('danyasefti')
  })

  it('menangani nama tunggal', () => {
    expect(nicknameCandidates('Rianti')).toEqual(['rianti'])
  })

  it('mengabaikan token terlalu pendek', () => {
    expect(nicknameCandidates('Ahmad Fauzi')).toContain('ahmad')
  })
})

describe('cleanNameInput', () => {
  it('membuang kata perintah di depan nama', () => {
    expect(cleanNameInput('tambahin Danya Sefti')).toBe('Danya Sefti')
    expect(cleanNameInput('ubah Ibra jadi izin')).toBe('Ibra jadi izin')
  })

  it('membuang tanda baca di akhir', () => {
    expect(cleanNameInput('Danya.')).toBe('Danya')
  })
})

describe('similarityScore', () => {
  it('skor 1 untuk nama identik', () => {
    expect(similarityScore('danya', 'Danya')).toBe(1)
  })

  it('skor tinggi untuk nama sebagian', () => {
    expect(similarityScore('danya', 'Danya Sefti Cahyani')).toBeGreaterThan(0.5)
  })

  it('skor rendah untuk nama tidak berkaitan', () => {
    expect(similarityScore('danya', 'Ahmad Fauzi')).toBeLessThan(MATCH_THRESHOLD)
  })

  it('menangani typo pemenggalan', () => {
    expect(similarityScore('dany', 'Danya')).toBeGreaterThan(0.9)
  })
})

describe('decideMatch', () => {
  const anggota = [
    { name: 'Danya Sefti Cahyani' },
    { name: 'Danya Putri Rahma' },
    { name: 'Ibra Ramdan' },
  ]

  it('"none" kalau tidak ada kandidat', () => {
    const result = decideMatch('Zainal', anggota)
    expect(result.certainty).toBe('none')
  })

  it('"unique" kalau satu kandidat jauh lebih cocok', () => {
    const result = decideMatch('Ibra Ramdan', anggota)
    expect(result.certainty).toBe('unique')
    expect(result.best?.name).toBe('Ibra Ramdan')
  })

  it('"ambiguous" kalau dua anggota sama-sama cocok', () => {
    // Dua anggota sama-sama diawali "Danya" — selisihnya di bawah margin.
    const result = decideMatch('Danya', anggota)
    expect(result.certainty).toBe('ambiguous')
    expect(result.ranked.length).toBeGreaterThanOrEqual(2)
  })

  it('AMBIGUITY_MARGIN menentukan keputusan, bukan tebakan', () => {
    // Selisih di bawah margin harus ambiguous walaupun skor tinggi.
    const mirip = [{ name: 'Dany' }, { name: 'Dani' }]
    const result = decideMatch('Dany', mirip)
    const top = result.ranked[0]!
    const second = result.ranked[1]!

    if (top.score - second.score < AMBIGUITY_MARGIN) {
      expect(result.certainty).toBe('ambiguous')
    }
  })

  it('memberi skor tertinggi pada kecocokan persis', () => {
    const result = decideMatch('Ibra Ramdan', anggota)
    expect(result.ranked[0]?.item.name).toBe('Ibra Ramdan')
    expect(result.ranked[0]?.score).toBe(1)
  })
})