/** Daftar ringkas (aktivitas, pengumuman, permintaan) pada kartu dasbor. */
import { tanggalPendek } from '@/lib/format';

export interface ItemRingkas {
  readonly id: string;
  readonly judul: string;
  readonly keterangan?: string;
  /** ISO string; kosong berarti tidak ditampilkan. */
  readonly waktu?: string | null;
  readonly tautan?: string | null;
}

export function DaftarRingkas({
  item,
  kosong = 'Tidak ada data.',
}: {
  readonly item: readonly ItemRingkas[];
  readonly kosong?: string;
}) {
  if (item.length === 0) return <p className="text-sm text-slate-500">{kosong}</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {item.map((satu) => (
        <li key={satu.id} className="flex items-start justify-between gap-3 py-2 first:pt-0">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-800">{satu.judul}</p>
            {satu.keterangan ? (
              <p className="truncate text-xs text-slate-500">{satu.keterangan}</p>
            ) : null}
          </div>
          {satu.waktu ? (
            <span className="shrink-0 text-xs whitespace-nowrap text-slate-400">
              {tanggalPendek(satu.waktu)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
