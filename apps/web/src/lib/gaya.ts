/** Pengganti `clsx`/`tailwind-merge` — cukup gabung className yang tidak kosong. */
export function cn(...kelas: ReadonlyArray<string | false | null | undefined>): string {
  return kelas.filter((nilai): nilai is string => typeof nilai === 'string' && nilai.length > 0).join(' ');
}
