// Uji penjaga tanpa jaringan: Google, GitHub, dan penyimpanan diganti tiruan.
import assert from 'node:assert/strict';
import { tangani, buatSesi, bacaSesi } from './netlify/functions/penjaga.mjs';

const atur = { repo: 'x/y', cabang: 'main', token: 't', klien: 'klien', rahasia: 'rahasia-uji', utama: ['utama@contoh.id'], asal: ['https://warta.masmik.id'] };
let simpanan = [];
const toko = { baca: async () => simpanan, tulis: async (d) => { simpanan = d; } };
const panggilan = [];
const github = async (jalur, opsi = {}) => {
  panggilan.push([opsi.method || 'GET', jalur]);
  const j = (isi, status = 200) => new Response(JSON.stringify(isi), { status });
  if (jalur.startsWith('/contents/masuk/')) return j({ commit: { sha: 'a'.repeat(40) } }, 201);
  if (jalur.startsWith('/contents/data/edisi.json')) return j([{ slug: '2026-11-15' }]);
  if (jalur.includes('/statuses')) return j([{ context: 'flipbook', state: 'pending', description: '43|Halaman 3 dari 7' }]);
  return j({}, 404);
};
const verifikasiGoogle = async (k) => {
  if (!k.startsWith('ok:')) throw Object.assign(new Error('x'), {});
  return { email: k.slice(3), nama: 'Uji' };
};
const alat = { atur, toko, github, verifikasiGoogle };
const kirim = async (isi, sesi, asal = 'https://warta.masmik.id') => {
  const r = await tangani(new Request('https://p.test/', { method: 'POST', body: JSON.stringify(isi),
    headers: { origin: asal, ...(sesi ? { authorization: 'Bearer ' + sesi } : {}) } }), alat);
  return [r.status, await r.json(), r.headers];
};

// sesi
const s = buatSesi('a@b.c', 'r');
assert.equal(bacaSesi(s, 'r'), 'a@b.c');
assert.equal(bacaSesi(s, 'lain'), null);
assert.equal(bacaSesi(s.slice(0, -2) + 'xx', 'r'), null);
assert.equal(bacaSesi(s, 'r', Date.now() + 31 * 864e5), null, 'sesi kedaluwarsa ditolak');

// masuk
let [kode, isi, kepala] = await kirim({ aksi: 'masuk', kredensial: 'ok:utama@contoh.id' });
assert.equal(kode, 200); assert.equal(isi.utama, true);
assert.equal(kepala.get('access-control-allow-origin'), 'https://warta.masmik.id');
const sesiUtama = isi.sesi;
[kode, isi] = await kirim({ aksi: 'masuk', kredensial: 'ok:asing@contoh.id' });
assert.equal(kode, 403, 'email tak terdaftar ditolak');

// tanpa sesi / asal asing
[kode] = await kirim({ aksi: 'daftar' });
assert.equal(kode, 401);
[kode, , kepala] = await kirim({ aksi: 'daftar' }, sesiUtama, 'https://jahat.contoh');
assert.equal(kode, 403); assert.equal(kepala.get('access-control-allow-origin'), null);
[kode] = await kirim({ aksi: 'daftar' }, buatSesi('utama@contoh.id', 'rahasia-palsu'));
assert.equal(kode, 401, 'sesi bertanda tangan palsu ditolak');

// daftar, taruh, status
[kode, isi] = await kirim({ aksi: 'daftar' }, sesiUtama);
assert.deepEqual([kode, isi[0].slug], [200, '2026-11-15']);
[kode, isi] = await kirim({ aksi: 'taruh', nama: '20261115101010-ab12.pdf', isi: 'QUJD', catatan: 'Unggah PDF' }, sesiUtama);
assert.deepEqual([kode, isi.sha.length], [200, 40]);
[kode] = await kirim({ aksi: 'taruh', nama: '../../.github/workflows/x.yml', isi: 'QUJD' }, sesiUtama);
assert.equal(kode, 400, 'nama berkas di luar pola ditolak');
[kode] = await kirim({ aksi: 'taruh', nama: '20261115101010-ab12.pdf', isi: 'A'.repeat(5_700_000) }, sesiUtama);
assert.equal(kode, 413);
[kode, isi] = await kirim({ aksi: 'status', sha: 'a'.repeat(40) }, sesiUtama);
assert.deepEqual([kode, isi.persen, isi.pesan, isi.keadaan], [200, 43, 'Halaman 3 dari 7', 'pending']);

// pengelola: tambah, masuk sebagai pengelola biasa, tidak boleh mengatur, lalu dicabut
[kode, isi] = await kirim({ aksi: 'pengelola', ubah: 'tambah', email: 'Rekan@Contoh.id' }, sesiUtama);
assert.deepEqual([kode, isi.lain.map((p) => p.email)], [200, ['rekan@contoh.id']]);
[kode, isi] = await kirim({ aksi: 'masuk', kredensial: 'ok:rekan@contoh.id' });
assert.deepEqual([kode, isi.utama], [200, false]);
const sesiRekan = isi.sesi;
[kode] = await kirim({ aksi: 'pengelola' }, sesiRekan);
assert.equal(kode, 403, 'pengelola biasa tidak bisa mengatur daftar');
[kode] = await kirim({ aksi: 'daftar' }, sesiRekan);
assert.equal(kode, 200);
[kode] = await kirim({ aksi: 'pengelola', ubah: 'hapus', email: 'utama@contoh.id' }, sesiUtama);
assert.equal(kode, 400, 'admin utama tidak bisa dihapus dari panel');
[kode, isi] = await kirim({ aksi: 'pengelola', ubah: 'hapus', email: 'rekan@contoh.id' }, sesiUtama);
assert.deepEqual([kode, isi.lain.length], [200, 0]);
[kode] = await kirim({ aksi: 'daftar' }, sesiRekan);
assert.equal(kode, 401, 'sesi pengelola yang dicabut langsung tidak berlaku');

// belum disiapkan
const r = await tangani(new Request('https://p.test/', { method: 'POST', body: '{}', headers: { origin: 'https://warta.masmik.id' } }),
  { ...alat, atur: { ...atur, token: '' } });
assert.equal(r.status, 503);
console.log('semua uji penjaga lulus;', panggilan.length, 'panggilan penyimpanan tiruan');
