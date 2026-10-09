import { describe, expect, it } from 'vitest';

import { bacakanMaksudAbsen } from './attendance.js';

describe('bacakanMaksudAbsen', () => {
  it('membaca HADIR', () => {
    expect(bacakanMaksudAbsen('HADIR')).toEqual({ status: 'HADIR', alasan: undefined });
    expect(bacakanMaksudAbsen('hadir')).toEqual({ status: 'HADIR', alasan: undefined });
  });

  it('membaca IZIN dan SAKIT beserta alasan', () => {
    expect(bacakanMaksudAbsen('IZIN ada keperluan keluarga')).toEqual({
      status: 'IZIN',
      alasan: 'ada keperluan keluarga',
    });
    expect(bacakanMaksudAbsen('sakit demam')).toEqual({ status: 'SAKIT', alasan: 'demam' });
  });

  it('menolak IZIN/SAKIT tanpa alasan', () => {
    expect(bacakanMaksudAbsen('IZIN')).toBeNull();
    expect(bacakanMaksudAbsen('SAKIT ')).toBeNull();
  });

  it('menolak pesan lain', () => {
    expect(bacakanMaksudAbsen('Halo')).toBeNull();
    expect(bacakanMaksudAbsen('STATUS')).toBeNull();
  });
});
