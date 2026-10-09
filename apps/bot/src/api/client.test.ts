import { afterEach, describe, expect, it, vi } from 'vitest';

import { KesalahanApi, panggilApi, susunUrl } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function responsJson(nilai: unknown, status = 200): Response {
  return new Response(JSON.stringify(nilai), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('panggilApi', () => {
  it('membuka envelope { data } dan mengirim header bot', async () => {
    const fetchPalsu = vi.fn(async () => responsJson({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchPalsu);

    const hasil = await panggilApi<{ ok: boolean }>('/health', { percobaan: 0 });

    expect(hasil).toEqual({ ok: true });
    const [, opsi] = fetchPalsu.mock.calls[0] as unknown as [string, RequestInit];
    expect(opsi.headers).toMatchObject({
      authorization: 'Bearer token-uji',
      'x-osda-sumber': 'WHATSAPP',
    });
  });

  it('melempar KesalahanApi dengan kode dari { error: { code, message } }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        responsJson({ error: { code: 'DATA_TIDAK_VALID', message: 'Anggota sudah absen' } }, 409),
      ),
    );

    await expect(
      panggilApi('/attendance/records', { metode: 'POST', percobaan: 0 }),
    ).rejects.toMatchObject({
      kode: 'DATA_TIDAK_VALID',
      status: 409,
      message: 'Anggota sudah absen',
    });
  });

  it('menyusun query string dan melewatkan nilai kosong', async () => {
    const fetchPalsu = vi.fn(async () => responsJson([]));
    vi.stubGlobal('fetch', fetchPalsu);

    await panggilApi('/attendance/sessions', {
      query: { tanggal: '2026-10-09', status: 'OPEN', limit: 5, kosong: undefined, nihil: '' },
      percobaan: 0,
    });

    const [url] = fetchPalsu.mock.calls[0] as unknown as [string];
    expect(url).toContain('tanggal=2026-10-09');
    expect(url).toContain('status=OPEN');
    expect(url).not.toContain('kosong=');
    expect(url).not.toContain('nihil=');
  });

  it('mencoba ulang untuk 5xx lalu berhasil', async () => {
    const fetchPalsu = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(responsJson({ error: 'galat sementara' }, 503))
      .mockResolvedValueOnce(responsJson({ data: { nama: 'Ibra' } }));
    vi.stubGlobal('fetch', fetchPalsu);

    const hasil = await panggilApi<{ nama: string }>('/members/1', { percobaan: 2 });
    expect(hasil).toEqual({ nama: 'Ibra' });
    expect(fetchPalsu).toHaveBeenCalledTimes(2);
  });

  it('tidak mengulang permintaan untuk 4xx', async () => {
    const fetchPalsu = vi.fn(async () => responsJson({ error: 'tidak ditemukan' }, 404));
    vi.stubGlobal('fetch', fetchPalsu);

    await expect(panggilApi('/members/x', { percobaan: 3 })).rejects.toBeInstanceOf(KesalahanApi);
    expect(fetchPalsu).toHaveBeenCalledTimes(1);
  });
});

describe('susunUrl', () => {
  it('menggabungkan base URL dan jalur', () => {
    expect(susunUrl('/members')).toBe('http://localhost:4000/api/v1/members');
  });
});
