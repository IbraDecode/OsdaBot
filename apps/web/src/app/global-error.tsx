/**
 * Batas galat global (menggantikan root layout).
 *
 * Komponen ini menggantikan `src/app/layout.tsx` ketika galat muncul sebelum
 * batas galat mana pun sempat dirender, karena itu ia harus menyertakan
 * <html> dan <body> sendiri.
 *
 * Sengaja TIDAK memakai hook apa pun: berkas ini dirender pada kondisi khusus
 * (halaman galat statis) dan beberapa versi Next 16 masih mem-prerender rute
 * sintetis `/_global-error`.
 */
'use client';

export default function GalatGlobal({
  error,
}: {
  readonly error: Error & { digest?: string };
}) {
  return (
    <html lang="id">
      <body className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Terjadi kesalahan</h1>
          <p className="mt-2 text-sm text-slate-600">
            Dasbor OSDA mengalami gangguan tak terduga. Silakan muat ulang halaman.
          </p>
          {error?.digest ? (
            <p className="mt-2 text-xs text-slate-400">Kode acuan: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-merek-600 px-4 py-2 text-sm font-medium text-white hover:bg-merek-700"
          >
            Muat ulang
          </button>
        </div>
      </body>
    </html>
  );
}
