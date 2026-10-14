/** Badge/lencana status. Warna otomatis dari nama status bila tidak ditentukan. */
import type { ReactNode } from 'react';

import { cn } from '@/lib/gaya';

export type WarnaLencana = 'abu' | 'biru' | 'hijau' | 'kuning' | 'merah' | 'ungu';

const GAYA_WARNA: Readonly<Record<WarnaLencana, string>> = {
  abu: 'bg-slate-100 text-slate-700 ring-slate-200',
  biru: 'bg-merek-50 text-merek-700 ring-merek-200',
  hijau: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  kuning: 'bg-amber-50 text-amber-700 ring-amber-200',
  merah: 'bg-red-50 text-red-700 ring-red-200',
  ungu: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export interface PropertiLencana {
  readonly warna?: WarnaLencana;
  readonly children: ReactNode;
  readonly judul?: string;
  readonly className?: string;
}

export function Lencana({ warna = 'abu', children, judul, className }: PropertiLencana) {
  return (
    <span
      title={judul}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        GAYA_WARNA[warna],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Peta status teknis → warna lencana. */
const WARNA_STATUS: Readonly<Record<string, WarnaLencana>> = {
  ACTIVE: 'hijau',
  ONGOING: 'hijau',
  PUBLISHED: 'hijau',
  VERIFIED: 'hijau',
  PRESENT: 'hijau',
  PAID: 'hijau',
  COMPLETED: 'hijau',
  DONE: 'hijau',
  READ: 'hijau',
  DELIVERED: 'hijau',
  APPROVED: 'hijau',

  PENDING: 'kuning',
  REVIEW: 'kuning',
  SCHEDULED: 'kuning',
  SUBMITTED: 'kuning',
  PLANNED: 'kuning',
  RUNNING: 'kuning',
  IN_PROGRESS: 'kuning',
  OPEN: 'kuning',
  SENT: 'kuning',
  UNVERIFIED: 'kuning',
  PROPOSED: 'kuning',

  DRAFT: 'abu',
  ARCHIVED: 'abu',
  INACTIVE: 'abu',
  ALUMNI: 'abu',
  CLOSED: 'abu',
  UPCOMING: 'abu',
  TODO: 'abu',

  BLOCKED: 'merah',
  CANCELLED: 'merah',
  REJECTED: 'merah',
  ABSENT: 'merah',
  SUSPENDED: 'merah',
  FAILED: 'merah',
  OVERDUE: 'merah',
  OFF: 'abu',
};

export interface PropertiLencanaStatus {
  readonly status: string;
  /** Label pengganti; bila kosong memakai `labelStatus(status)`. */
  readonly label?: string;
  readonly warna?: WarnaLencana;
  readonly className?: string;
}

export function LencanaStatus({ status, label, warna, className }: PropertiLencanaStatus) {
  return (
    <Lencana warna={warna ?? WARNA_STATUS[status] ?? 'biru'} className={className}>
      {label ?? status.replace(/_/g, ' ')}
    </Lencana>
  );
}
