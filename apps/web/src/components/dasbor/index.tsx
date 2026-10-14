/**
 * Pemilih bentuk dasbor.
 *
 * API mengirim SATU bentuk sesuai peran (`GET /api/v1/users/me/dashboard`).
 * Berkas ini hanya meneruskan ke komponen yang tepat — logika tiap dasbor
 * sengaja dipisahkan per berkas supaya tidak ada satu komponen raksasa.
 */
'use client';

import type {
  BentukDasbor,
  DasborAnggota,
  DasborBendahara,
  DasborHumas,
  DasborKetua,
  DasborKoordinator,
  DasborSekretaris,
  DasborWakil,
} from '@osda/contracts';

import { DasborAnggotaView } from '@/components/dasbor/dasbor-anggota';
import { DasborBendaharaView } from '@/components/dasbor/dasbor-bendahara';
import { DasborHumasView } from '@/components/dasbor/dasbor-humas';
import { DasborKetuaView } from '@/components/dasbor/dasbor-ketua';
import { DasborKoordinatorView } from '@/components/dasbor/dasbor-koordinator';
import { DasborSekretarisView } from '@/components/dasbor/dasbor-sekretaris';
import { DasborWakilView } from '@/components/dasbor/dasbor-wakil';
import { KotakKosong } from '@/components/ui/peringatan';

function adalahKetua(data: BentukDasbor): data is DasborKetua {
  return data.ruangKerja === 'EXECUTIVE';
}

function adalahWakil(data: BentukDasbor): data is DasborWakil {
  return data.ruangKerja === 'OPERATIONS';
}

function adalahSekretaris(data: BentukDasbor): data is DasborSekretaris {
  return data.ruangKerja === 'ADMINISTRATION';
}

function adalahBendahara(data: BentukDasbor): data is DasborBendahara {
  return data.ruangKerja === 'FINANCE';
}

function adalahHumas(data: BentukDasbor): data is DasborHumas {
  return data.ruangKerja === 'COMMUNICATION';
}

function adalahKoordinator(data: BentukDasbor): data is DasborKoordinator {
  return data.ruangKerja === 'DIVISION';
}

function adalahAnggota(data: BentukDasbor): data is DasborAnggota {
  return data.ruangKerja === 'PERSONAL';
}

export interface PropertiPilihDasbor {
  readonly data: BentukDasbor;
  /** Ruang kerja default pengguna — dipakai bila API mengirim bentuk tak dikenal. */
  readonly ruangKerjaCadangan?: string;
}

export function PilihDasbor({ data, ruangKerjaCadangan }: PropertiPilihDasbor) {
  // Peran sistem (SUPER_ADMIN) menerima bentuk pimpinan dari API.
  const ruangBalasan = (data as { ruangKerja?: unknown }).ruangKerja;
  if (
    ruangKerjaCadangan === 'SYSTEM' &&
    (typeof ruangBalasan !== 'string' || ruangBalasan === 'EXECUTIVE')
  ) {
    return <DasborKetuaView data={data as DasborKetua} />;
  }

  if (adalahKetua(data)) return <DasborKetuaView data={data} />;
  if (adalahWakil(data)) return <DasborWakilView data={data} />;
  if (adalahSekretaris(data)) return <DasborSekretarisView data={data} />;
  if (adalahBendahara(data)) return <DasborBendaharaView data={data} />;
  if (adalahHumas(data)) return <DasborHumasView data={data} />;
  if (adalahKoordinator(data)) return <DasborKoordinatorView data={data} />;
  if (adalahAnggota(data)) return <DasborAnggotaView data={data} />;

  return (
    <KotakKosong
      judul="Bentuk dasbor tidak dikenali"
      deskripsi="API mengirim ruang kerja yang belum didukung tampilan ini. Hubungi pengembang bila masalah berlanjut."
    />
  );
}
