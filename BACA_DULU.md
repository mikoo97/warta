# Warta Flipbook — GKJW Jemaat Tempursari

Situs: https://warta.masmik.id/
Panel pengelola: https://warta.masmik.id/kelola/
Tautan tetap ke warta terbaru: https://warta.masmik.id/terbaru/

## Menerbitkan (tiap minggu)

1. Buka panel pengelola, masuk dengan kunci pengelola (cukup sekali per perangkat).
2. Pilih jenis:
   - **Warta jemaat** — unggah PDF. Tanggal, nama Minggu, warna stola, tema dan bacaan dibaca otomatis dari isi warta.
   - **Dokumen** — PDF lain (liturgi, laporan), beri judul.
   - **Album foto** — tempel tautan *folder* Google Drive yang dibagikan ke "Siapa saja yang memiliki link".
3. Tekan **Terbitkan**, tunggu 1–3 menit, lalu salin tautan / kirim ke WhatsApp.

Mengunggah warta dengan tanggal yang sama akan mengganti edisi lama (berguna untuk ralat).

## Cara kerjanya

- `masuk/` — antrean unggahan dari panel pengelola.
- `.github/workflows/terbit.yml` — server GitHub menjalankan `python alat/warta.py proses`:
  PDF diubah menjadi gambar halaman, situs dibangun ulang, lalu ditayangkan.
- `situs/` — hasil jadi yang ditayangkan (jangan disunting tangan; akan ditimpa).
- `sumber/` — tampilan (HTML, CSS, JS). `data/edisi.json` — daftar semua terbitan.
- `pengaturan.json` — nama, alamat situs, hak cipta.
- Album foto tidak disalin: flipbook menampilkan versi ringan langsung dari Google Drive, dan
  tombol unduh mengambil JPG aslinya. Kalau folder Drive dihapus atau tidak lagi dibagikan,
  albumnya ikut kosong.

## Menjalankan di komputer (opsional)

    pip install -r alat/requirements.txt
    python alat/warta.py tambah "WARTA JEMAAT 2026 11 15.pdf"
    python alat/warta.py lihat

Pustaka pihak ketiga: page-flip (StPageFlip, MIT), fon Young Serif dan Atkinson Hyperlegible Next (OFL).

## Masuk dengan Google (penjaga pintu)

Folder `penjaga/` berisi fungsi server kecil (Netlify) yang memeriksa login Google, mencocokkan
email dengan daftar pengelola, lalu meneruskan unggahan ke repo ini. Kunci GitHub hanya disimpan
di sana. Uji tanpa jaringan: `cd penjaga && node uji.mjs`.

Variabel lingkungan di Netlify: `GITHUB_TOKEN`, `GOOGLE_CLIENT_ID`, `ADMIN_UTAMA`, `SESI_RAHASIA`.
Di `pengaturan.json`: `penjaga` (alamat fungsi) dan `google_client_id`. Selama keduanya kosong,
panel memakai cara lama (kunci pengelola).

- Admin utama ditentukan lewat `ADMIN_UTAMA` di Netlify dan bisa menambah/mencabut pengelola dari panel.
- Unggah PDF langsung lewat penjaga dibatasi 4 MB; yang lebih besar: unggah ke Google Drive lalu tempel tautannya.
