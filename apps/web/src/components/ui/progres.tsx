/** Bilah progres program/tugas (0–100). */
import { cn } from '@/lib/gaya';

export function BilahProgres({
  nilai,
  label,
  className,
  warna,
}: {
  readonly nilai: number;
  readonly label?: string;
  readonly className?: string;
  readonly warna?: string;
}) {
  const persentase = Math.max(0, Math.min(100, Math.round(nilai)));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={persentase}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `Progres ${persentase}%`}
      >
        <div
          className={cn('h-full rounded-full bg-merek-600', warna)}
          style={{ width: `${persentase}%` }}
        />
      </div>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-slate-500">
        {persentase}%
      </span>
    </div>
  );
}
