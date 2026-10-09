/**
 * Halaman Anggota — daftar anggota dengan filter (nama, status, tingkat) dan
 * paginasi.
 *
 * Tombol "Tambah anggota" hanya tampil bila pengguna punya izin `member.write`.
 * Penyembunyian ini untuk kenyamanan saja; API tetap memeriksa izin.
 */
'use client';

import { useState, type FormEvent } from 'react';

import { JudulHalaman } from '@/components/judul-halaman';
import { Paginasi } from '@/components/paginasi';
import { useSesi } from '@/contexts/sesi';
import { api, pesanDariGalat } from '@/lib/api-client';
import { useAmbil } from '@/lib/use-ambil';
import { labelStatus } from '@/lib/format';
import type { Anggota, HasilDaftar, StatusAnggota, TingkatKelas } from '@osda/contracts';
// Nilai runtime diambil langsung dari modul sumbernya (bukan lewat `export *`
// di index) supaya bundler (Turbopack) dapat menyusun impor secara statis.
import { STATUS_ANGGOTA } from '@osda/contracts/enums';
import { TINGKAT_KELAS } from '@osda/contracts/profile';

import { Bidang, Masukan } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Lencana, LencanaStatus } from '@/components/ui/badge';
import { Peringatan } from '@/components/ui/peringatan';
import { Pemuat } from '@/components/ui/spinner';
import { Tabel } from '@/components/ui/tabel';
import { Tombol } from '@/components/ui/tombol';

const BATAS_AWAL = 20;

const OPSI_TINGKAT = TINGKAT_KELAS.map((tingkat) => ({
  nilai: tingkat as TingkatKelas,
  label: `Kelas ${tingkat as TingkatKelas}`,
}));

export default function HalamanAnggota() {
  const { punyaIzin } = useSesi();
  const bolehTambahAnggota = punyaIzin('member.write');

  const [kueri, setKueri] = useState('');
  const [status, setStatus] = useState<StatusAnggota | ''>('');
  const [tingkat, setTingkat] = useState<TingkatKelas | ''>('');
  const [halaman, setHalaman] = useState(1);
  const [batas, setBatas] = useState(BATAS_AWAL);

  const kunci = `members:${kueri}:${status}:${tingkat}:${halaman}:${batas}`;

  const { data, memuat, galat, muatUlang } = useAmbil<HasilDaftar<Anggota>>(
    () =>
      api.ambil<HasilDaftar<Anggota>>('/api/v1/members', {
        q: kueri || undefined,
        status: status || undefined,
        tingkat: tingkat || undefined,
        page: halaman,
        limit: batas,
      }),
    kunci,
  );

  function terapkanFilter(peristiwa: FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    setHalaman(1);
  }

  return (
    <div>
      <JudulHalaman
        judul="Anggota"
        deskripsi="Daftar anggota organisasi beserta divisi dan jabatannya."
        aksi={
          bolehTambahAnggota ? (
            <ModalTambahAnggota
              onBerhasil={() => {
                setHalaman(1);
                muatUlang();
              }}
            />
          ) : null
        }
      />

      <form
        onSubmit={terapkanFilter}
        className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
      >
        <Bidang label="Cari nama / NIS" htmlFor="filter-kueri">
          <Masukan
            id="filter-kueri"
            type="search"
            placeholder="mis. Favian"
            value={kueri}
            onChange={(peristiwa) => setKueri(peristiwa.target.value)}
          />
        </Bidang>

        <Bidang label="Status" htmlFor="filter-status">
          <select
            id="filter-status"
            value={status}
            onChange={(peristiwa) => {
              setStatus(peristiwa.target.value as StatusAnggota | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua status</option>
            {STATUS_ANGGOTA.map((satu) => (
              <option key={satu} value={satu}>
                {labelStatus(satu)}
              </option>
            ))}
          </select>
        </Bidang>

        <Bidang label="Tingkat kelas" htmlFor="filter-tingkat">
          <select
            id="filter-tingkat"
            value={tingkat}
            onChange={(peristiwa) => {
              setTingkat(peristiwa.target.value as TingkatKelas | '');
              setHalaman(1);
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Semua tingkat</option>
            {OPSI_TINGKAT.map((satu) => (
              <option key={satu.nilai} value={satu.nilai}>
                {satu.label}
              </option>
            ))}
          </select>
        </Bidang>

        <div className="flex items-end gap-2">
          <Tombol type="submit" varian="utama">
            Terapkan
          </Tombol>
          <Tombol
            varian="sekunder"
            onClick={() => {
              setKueri('');
              setStatus('');
              setTingkat('');
              setHalaman(1);
            }}
          >
            Bersihkan
          </Tombol>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {galat ? (
          <div className="p-4">
            <Peringatan nada="bahaya" judul="Gagal memuat anggota">
              {galat}
            </Peringatan>
          </div>
        ) : null}

        {memuat && !data ? (
          <div className="p-4">
            <Pemuat label="Memuat daftar anggota…" />
          </div>
        ) : null}

        <Tabel
          kolom={[
            { kunci: 'nomor', judul: 'Nomor', nilai: (baris) => baris.nomor },
            {
              kunci: 'nama',
              judul: 'Nama',
              nilai: (baris) => (
                <div>
                  <p className="font-medium text-slate-900">{baris.nama}</p>
                  <p className="text-xs text-slate-500">{baris.email ?? '—'}</p>
                </div>
              ),
            },
            {
              kunci: 'labelKelas',
              judul: 'Kelas',
              nilai: (baris) => baris.labelKelas || '—',
            },
            {
              kunci: 'divisionNama',
              judul: 'Divisi',
              nilai: (baris) => baris.divisionNama ?? '—',
            },
            {
              kunci: 'jabatan',
              judul: 'Jabatan',
              nilai: (baris) =>
                baris.jabatan.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {baris.jabatan.map((satu) => (
                      <Lencana key={satu.id} warna="biru">
                        {satu.nama}
                      </Lencana>
                    ))}
                  </span>
                ),
            },
            {
              kunci: 'status',
              judul: 'Status',
              nilai: (baris) => <LencanaStatus status={baris.status} label={labelStatus(baris.status)} />,
            },
          ]}
          data={data?.data ?? []}
          kunciBaris={(baris) => baris.id}
          memuat={memuat && !data}
          pesanKosong="Tidak ada anggota yang cocok dengan filter."
        />

        {data ? (
          <div className="px-4">
            <Paginasi
              halaman={data.meta.page}
              totalHalaman={data.meta.totalPages}
              total={data.meta.total}
              batas={batas}
              onUbah={setHalaman}
              onUbahBatas={(nilai) => {
                setBatas(nilai);
                setHalaman(1);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Tombol + modal tambah anggota (izin `member.write`). */
function ModalTambahAnggota({ onBerhasil }: { readonly onBerhasil: () => void }) {
  const [terbuka, setTerbuka] = useState(false);
  const [nama, setNama] = useState('');
  const [tingkat, setTingkat] = useState<TingkatKelas>('X');
  const [jurusan, setJurusan] = useState('');
  const [subKelas, setSubKelas] = useState('');
  const [sedangMemproses, setSedangMemproses] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function simpan() {
    if (nama.trim().length < 2) {
      setGalat('Nama anggota minimal 2 karakter.');
      return;
    }
    setSedangMemproses(true);
    setGalat(null);
    try {
      await api.kirim('/api/v1/members', {
        nama: nama.trim(),
        tingkat,
        jurusan: jurusan.trim() || undefined,
        subKelas: subKelas.trim() || undefined,
      });
      setTerbuka(false);
      setNama('');
      setJurusan('');
      setSubKelas('');
      onBerhasil();
    } catch (kesalahan: unknown) {
      setGalat(pesanDariGalat(kesalahan));
    } finally {
      setSedangMemproses(false);
    }
  }

  return (
    <>
      <Tombol varian="utama" onClick={() => setTerbuka(true)}>
        Tambah anggota
      </Tombol>

      <Modal
        terbuka={terbuka}
        judul="Tambah anggota baru"
        deskripsi="Data dikirim ke POST /api/v1/members. Organisasi & periode diambil dari sesi Anda."
        onTutup={() => setTerbuka(false)}
        kaki={
          <>
            <Tombol varian="sekunder" onClick={() => setTerbuka(false)}>
              Batal
            </Tombol>
            <Tombol varian="utama" onClick={simpan} memuat={sedangMemproses}>
              Simpan
            </Tombol>
          </>
        }
      >
        <div className="space-y-3">
          <Bidang label="Nama lengkap" htmlFor="anggota-nama" wajib>
            <Masukan
              id="anggota-nama"
              value={nama}
              onChange={(peristiwa) => setNama(peristiwa.target.value)}
              placeholder="mis. Favian Rapha"
            />
          </Bidang>

          <Bidang label="Tingkat kelas" htmlFor="anggota-tingkat">
            <select
              id="anggota-tingkat"
              value={tingkat}
              onChange={(peristiwa) => setTingkat(peristiwa.target.value as TingkatKelas)}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {TINGKAT_KELAS.map((satu) => (
                <option key={satu} value={satu}>
                  Kelas {satu}
                </option>
              ))}
            </select>
          </Bidang>

          <div className="grid grid-cols-2 gap-3">
            <Bidang label="Jurusan" htmlFor="anggota-jurusan">
              <Masukan
                id="anggota-jurusan"
                value={jurusan}
                onChange={(peristiwa) => setJurusan(peristiwa.target.value)}
                placeholder="mis. RPL"
              />
            </Bidang>
            <Bidang label="Sub kelas" htmlFor="anggota-subkelas">
              <Masukan
                id="anggota-subkelas"
                value={subKelas}
                onChange={(peristiwa) => setSubKelas(peristiwa.target.value)}
                placeholder="mis. 2"
              />
            </Bidang>
          </div>

          {galat ? (
            <Peringatan nada="bahaya" judul="Gagal menyimpan">
              {galat}
            </Peringatan>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
