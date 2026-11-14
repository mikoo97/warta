// Penjaga pintu panel pengelola Warta Flipbook.
//
// Tugasnya: memeriksa login Google, mencocokkan email dengan daftar pengelola, lalu
// meneruskan unggahan ke repo GitHub. Kunci GitHub hanya ada di sini (variabel lingkungan
// Netlify) dan tidak pernah dikirim ke browser.
//
// Variabel lingkungan (diisi di Netlify, bukan di repo):
//   GITHUB_TOKEN      kunci GitHub dengan izin Contents: Read and write pada repo situs
//   GOOGLE_CLIENT_ID  Client ID "Masuk dengan Google"
//   ADMIN_UTAMA       email admin utama (boleh beberapa, dipisah koma)
//   SESI_RAHASIA      teks acak panjang untuk menandatangani sesi
//   REPO              opsional, bawaan mikoo97/warta
//   ASAL_DIIZINKAN    opsional, bawaan https://warta.masmik.id
import crypto from 'node:crypto';

const LAMA_SESI = 30 * 24 * 3600 * 1000;
const BATAS_ISI = 5_600_000; // karakter base64; batas badan permintaan fungsi Netlify ±6 MB

class Galat extends Error {
  constructor(kode, pesan) { super(pesan); this.kode = kode; }
}

function atur() {
  const e = process.env;
  return {
    repo: e.REPO || 'mikoo97/warta',
    cabang: e.CABANG || 'main',
    token: e.GITHUB_TOKEN || '',
    klien: e.GOOGLE_CLIENT_ID || '',
    rahasia: e.SESI_RAHASIA || '',
    utama: (e.ADMIN_UTAMA || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
    asal: (e.ASAL_DIIZINKAN || 'https://warta.masmik.id').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/* ---------- sesi (ditandatangani HMAC, tanpa basis data) ---------- */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function tanda(isi, rahasia) {
  return crypto.createHmac('sha256', rahasia).update(isi).digest('base64url');
}
export function buatSesi(email, rahasia, kini = Date.now()) {
  const isi = b64url(JSON.stringify({ e: email, x: kini + LAMA_SESI }));
  return `${isi}.${tanda(isi, rahasia)}`;
}
export function bacaSesi(sesi, rahasia, kini = Date.now()) {
  const [isi, ttd] = String(sesi || '').split('.');
  if (!isi || !ttd || !rahasia) return null;
  const benar = tanda(isi, rahasia);
  if (ttd.length !== benar.length || !crypto.timingSafeEqual(Buffer.from(ttd), Buffer.from(benar))) return null;
  try {
    const d = JSON.parse(Buffer.from(isi, 'base64url').toString('utf8'));
    return d.x > kini && typeof d.e === 'string' ? d.e : null;
  } catch { return null; }
}

/* ---------- ketergantungan ke luar (bisa diganti saat diuji) ---------- */

// Periksa token login Google lewat layanan Google sendiri
async function verifikasiGoogle(kredensial, klien) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'id_token=' + encodeURIComponent(kredensial),
  });
  if (!r.ok) throw new Galat(401, 'Login Google tidak sah atau sudah kedaluwarsa. Coba masuk lagi.');
  const k = await r.json();
  const penerbit = ['accounts.google.com', 'https://accounts.google.com'];
  if (k.aud !== klien || !penerbit.includes(k.iss) || Number(k.exp) * 1000 < Date.now()) {
    throw new Galat(401, 'Login Google tidak sah untuk aplikasi ini.');
  }
  if (String(k.email_verified) !== 'true' || !k.email) throw new Galat(401, 'Email akun Google ini belum terverifikasi.');
  return { email: String(k.email).toLowerCase(), nama: k.name || '' };
}

async function tokoBawaan() {
  const { getStore } = await import('@netlify/blobs');
  const toko = getStore({ name: 'pengelola', consistency: 'strong' });
  return {
    baca: async () => (await toko.get('daftar', { type: 'json' })) || [],
    tulis: (daftar) => toko.setJSON('daftar', daftar),
  };
}

function github(a) {
  return async (jalur, opsi = {}) => {
    const r = await fetch(`https://api.github.com/repos/${a.repo}${jalur}`, {
      method: opsi.method || 'GET',
      headers: {
        Authorization: `Bearer ${a.token}`,
        Accept: opsi.mentah ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'penjaga-warta',
        ...(opsi.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opsi.body ? JSON.stringify(opsi.body) : undefined,
    });
    return r;
  };
}

/* ---------- inti ---------- */

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function tangani(req, alat = {}) {
  const a = alat.atur || atur();
  const asal = req.headers.get('origin') || '';
  const kepala = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(a.asal.includes(asal) ? {
      'Access-Control-Allow-Origin': asal,
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    } : {}),
  };
  const jawab = (isi, kode = 200) => new Response(JSON.stringify(isi), { status: kode, headers: kepala });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: kepala });
  try {
    if (req.method !== 'POST') throw new Galat(405, 'Hanya menerima POST.');
    if (asal && !a.asal.includes(asal)) throw new Galat(403, 'Asal permintaan tidak diizinkan.');
    if (!a.token || !a.klien || !a.rahasia || !a.utama.length) {
      throw new Galat(503, 'Penjaga belum selesai disiapkan (variabel lingkungan belum lengkap).');
    }
    let d;
    try { d = await req.json(); } catch { throw new Galat(400, 'Permintaan tidak terbaca.'); }
    const toko = alat.toko || await tokoBawaan();
    const gh = alat.github || github(a);
    const pengelola = async () => {
      const lain = (await toko.baca()).filter((p) => !a.utama.includes(p.email));
      return { utama: a.utama, lain };
    };
    const bolehkah = async (email) => a.utama.includes(email) || (await toko.baca()).some((p) => p.email === email);

    /* --- masuk: tukar login Google dengan sesi --- */
    if (d.aksi === 'masuk') {
      const siapa = await (alat.verifikasiGoogle || verifikasiGoogle)(String(d.kredensial || ''), a.klien);
      if (!(await bolehkah(siapa.email))) {
        throw new Galat(403, `Akun ${siapa.email} belum terdaftar sebagai pengelola. Minta admin utama menambahkannya.`);
      }
      return jawab({ sesi: buatSesi(siapa.email, a.rahasia), email: siapa.email, nama: siapa.nama, utama: a.utama.includes(siapa.email) });
    }

    /* --- selain itu wajib membawa sesi, dan email-nya masih harus terdaftar --- */
    const email = bacaSesi((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), a.rahasia);
    if (!email || !(await bolehkah(email))) throw new Galat(401, 'Sesi berakhir. Silakan masuk lagi.');
    const utama = a.utama.includes(email);

    switch (d.aksi) {
      case 'saya':
        return jawab({ email, utama });

      case 'daftar': {
        const r = await gh(`/contents/data/edisi.json?ref=${a.cabang}`, { mentah: true });
        if (r.status === 404) return jawab([]);
        if (!r.ok) throw new Galat(502, `Penyimpanan menolak (kode ${r.status}).`);
        return jawab(await r.json());
      }

      case 'taruh': {
        const nama = String(d.nama || ''), isi = String(d.isi || '');
        if (!/^\d{14}-[a-z0-9]{4}\.(pdf|json)$/.test(nama)) throw new Galat(400, 'Nama berkas tidak sah.');
        if (!isi || !/^[A-Za-z0-9+/=]+$/.test(isi)) throw new Galat(400, 'Isi berkas tidak sah.');
        if (isi.length > BATAS_ISI) throw new Galat(413, 'Berkas terlalu besar untuk diunggah langsung. Unggah ke Google Drive lalu tempel tautannya.');
        const r = await gh(`/contents/masuk/${nama}`, {
          method: 'PUT',
          body: { message: `${String(d.catatan || 'Unggahan').slice(0, 60)} (oleh pengelola)`, content: isi, branch: a.cabang },
        });
        if (!r.ok) throw new Galat(502, r.status === 401 || r.status === 403
          ? 'Kunci penyimpanan di penjaga tidak berlaku. Admin utama perlu memperbaruinya di Netlify.'
          : `Penyimpanan menolak (kode ${r.status}).`);
        return jawab({ sha: (await r.json()).commit.sha });
      }

      case 'status': {
        const sha = String(d.sha || '');
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Galat(400, 'Kode komit tidak sah.');
        const r = await gh(`/commits/${sha}/statuses?per_page=10`);
        if (!r.ok) throw new Galat(502, `Penyimpanan menolak (kode ${r.status}).`);
        const s = (await r.json()).find((x) => x.context === 'flipbook');
        if (s) {
          const [p, ...sisa] = String(s.description || '').split('|');
          return jawab({ keadaan: s.state, persen: parseInt(p, 10) || 0, pesan: sisa.join('|'), url: s.target_url || null });
        }
        // Belum ada laporan: server masih antre atau baru menyala
        const l = await gh(`/actions/runs?head_sha=${sha}&per_page=1`);
        const lari = l.ok ? (await l.json()).workflow_runs?.[0] : null;
        if (lari && lari.status === 'completed' && lari.conclusion !== 'success') {
          return jawab({ keadaan: 'error', persen: 0, pesan: 'Server gagal memproses. Coba terbitkan lagi.', url: null });
        }
        return jawab({ keadaan: null, antre: lari ? lari.status : null });
      }

      case 'pengelola': {
        if (!utama) throw new Galat(403, 'Hanya admin utama yang bisa mengatur daftar pengelola.');
        if (d.ubah === 'tambah' || d.ubah === 'hapus') {
          const sasaran = String(d.email || '').trim().toLowerCase();
          if (!POLA_EMAIL.test(sasaran) || sasaran.length > 120) throw new Galat(400, 'Alamat email tidak sah.');
          if (a.utama.includes(sasaran)) throw new Galat(400, 'Itu admin utama; diatur di Netlify, bukan di sini.');
          let daftar = (await toko.baca()).filter((p) => p.email !== sasaran);
          if (d.ubah === 'tambah') {
            if (daftar.length >= 50) throw new Galat(400, 'Daftar pengelola sudah penuh (50).');
            daftar.push({ email: sasaran, oleh: email, sejak: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) }); // tanggal WIB
          }
          await toko.tulis(daftar);
        } else if (d.ubah) {
          throw new Galat(400, 'Perintah tidak dikenal.');
        }
        return jawab(await pengelola());
      }

      default:
        throw new Galat(400, 'Perintah tidak dikenal.');
    }
  } catch (g) {
    if (g instanceof Galat) return jawab({ galat: g.message }, g.kode);
    console.error(g);
    return jawab({ galat: 'Penjaga mengalami gangguan. Coba lagi sebentar.' }, 500);
  }
}

export default (req) => tangani(req);
