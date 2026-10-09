/** Ikon inline (stroke) untuk navigasi dasbor — tanpa dependensi ikon eksternal. */
import type { SVGProps } from 'react';

export type IkonNama =
  | 'dasbor'
  | 'lonceng'
  | 'anggota'
  | 'absensi'
  | 'rapat'
  | 'program'
  | 'tugas'
  | 'keuangan'
  | 'laporan'
  | 'pengaturan'
  | 'keluar'
  | 'menu';

/** Jarak (path) setiap ikon dalam kotak 24×24. */
const JALUR: Readonly<Record<IkonNama, readonly string[]>> = {
  dasbor: ['M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z'],
  lonceng: [
    'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8Z',
    'M13.7 21a2 2 0 0 1-3.4 0',
  ],
  anggota: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13A4 4 0 0 1 16 11',
  ],
  absensi: [
    'M9 11l3 3L22 4',
    'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  ],
  rapat: [
    'M8 2v4M16 2v4',
    'M3 10h18',
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  ],
  program: [
    'M12 2v4',
    'M12 22v-4',
    'M20 12h-4',
    'M8 12H4',
    'M15.5 8.5l2.8-2.8',
    'M5.7 18.3l2.8-2.8',
    'M15.5 15.5l2.8 2.8',
    'M5.7 5.7l2.8 2.8',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  ],
  tugas: [
    'M9 11l3 3 8-8',
    'M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9',
  ],
  keuangan: [
    'M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    'M3 7l2-3h14l2 3',
    'M12 12v4',
  ],
  laporan: [
    'M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z',
    'M14 2v5h5',
    'M9 13h6M9 17h6',
  ],
  pengaturan: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.06-.06A2 2 0 1 1 8.57 5.2l.06.06A1.7 1.7 0 0 0 11.5 4.6V4.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 12h.1a2 2 0 1 1 0 4h-.1Z',
  ],
  keluar: [
    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    'M16 17l5-5-5-5',
    'M21 12H9',
  ],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
};

export interface PropertiIkon extends SVGProps<SVGSVGElement> {
  readonly nama: IkonNama;
  readonly ukuran?: number;
}

export function Ikon({ nama, ukuran = 20, className, ...sisa }: PropertiIkon) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={ukuran}
      height={ukuran}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...sisa}
    >
      {(JALUR[nama] ?? []).map((d, indeks) => (
        <path key={`${nama}-${indeks}`} d={d} />
      ))}
    </svg>
  );
}
