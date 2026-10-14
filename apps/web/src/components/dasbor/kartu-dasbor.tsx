/** Potongan tampilan yang dipakai bersama oleh semua bentuk dasbor. */
import { KartuStatistik } from '@/components/ui/kartu';
import { Lencana } from '@/components/ui/badge';
import { cn } from '@/lib/gaya';

export interface PropertiBarisRingkas {
  readonly label: string;
  /** Nilai dapat berupa angka mentah atau teks yang sudah diformat. */
  readonly nilai: string | number;
  /** Sorot merah bila nilai perlu perhatian. */
  readonly peringatan?: boolean;
  readonly className?: string;
}

/** Baris "label — nilai" untuk ringkasan angka dalam kartu. */
export function BarisRingkas({
  label,
  nilai,
  peringatan = false,
  className,
}: PropertiBarisRingkas) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={cn(
          'font-medium tabular-nums',
          peringatan ? 'text-red-600' : 'text-slate-900',
        )}
      >
        {nilai}
      </dd>
    </div>
  );
}

export interface PropertiStatistikDasbor {
  readonly label: string;
  /** Nilai bisa angka mentah atau teks yang sudah diformat. */
  readonly nilai: string | number;
  readonly satuan?: string;
  readonly petunjuk?: string;
  readonly peringatan?: boolean;
  readonly arah?: 'naik' | 'turun' | 'tetap';
}

/** Kartu angka ringkas dengan format yang konsisten di semua dasbor. */
export function StatistikDasbor({
  label,
  nilai,
  satuan,
  petunjuk,
  peringatan = false,
  arah,
}: PropertiStatistikDasbor) {
  return (
    <KartuStatistik
      label={label}
      nilai={nilai}
      satuan={satuan}
      petunjuk={petunjuk}
      peringatan={peringatan}
      arah={arah}
    />
  );
}

/** Lencana kecil "perlu tindakan" untuk menarik perhatian pengguna. */
export function LencanaPerhatian({ teks }: { readonly teks: string }) {
  return <Lencana warna="merah">{teks}</Lencana>;
}
