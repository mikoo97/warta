#!/usr/bin/env python3
"""Mesin Warta Flipbook GKJW Tempursari.

Sehari-hari tidak perlu menjalankan berkas ini: unggah lewat halaman Kelola di situs,
dan server (GitHub Actions) menjalankan perintah `proses` secara otomatis.

Perintah (untuk dipakai di komputer bila perlu):
  python alat/warta.py tambah "berkas.pdf"                 warta dari PDF
  python alat/warta.py tambah "berkas.pdf" --jenis dokumen --judul "Tata Ibadah Natal"
  python alat/warta.py tambah "https://drive.google.com/drive/folders/..."   album foto dari Google Drive
  python alat/warta.py bangun                              bangun ulang semua halaman
  python alat/warta.py daftar                              lihat semua terbitan
  python alat/warta.py hapus 2026-11-15                    hapus satu terbitan
  python alat/warta.py lihat                               pratinjau di komputer ini
  python alat/warta.py proses                              kerjakan antrean di folder masuk/

Butuh: Python 3.10+, pymupdf, pillow  (pip install pymupdf pillow)
"""
import argparse
import base64
import datetime as dt
import hashlib
import html
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / "sumber"
SITUS = AKAR / "situs"
MASUK = AKAR / "masuk"
BERKAS_EDISI = AKAR / "data" / "edisi.json"
BERKAS_STATUS = AKAR / "data" / "status.json"
BERKAS_ATUR = AKAR / "pengaturan.json"

BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
         "Agustus", "September", "Oktober", "November", "Desember"]
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]

# Warna kain mengikuti warna stola/liturgi. "netral" untuk dokumen dan album.
KAIN = {
    "hijau": "#1F5B41", "putih": "#EDE6D3", "ungu": "#4A2D6E", "merah": "#8C2026",
    "hitam": "#1E1D1C", "merah-muda": "#A8566F", "netral": "#2E4052",
}
SAMA = {"kuning": "putih", "emas": "putih", "pink": "merah-muda", "merah muda": "merah-muda",
        "biru": "netral"}
NAMA_JENIS = {"warta": "Warta", "dokumen": "Dokumen", "album": "Album foto"}

LEBAR_LAYAR, LEBAR_BESAR, LEBAR_KECIL = 1100, 2000, 320
FOTO = "https://lh3.googleusercontent.com/d/{id}=s{px}"          # pratinjau foto Drive
UNDUH_DRIVE = "https://drive.google.com/uc?export=download&id={id}"  # berkas asli

ATUR_BAWAAN = {
    "nama_gereja": "GKJW Jemaat Tempursari",
    "nama_pendek": "GKJW Tempursari",
    "nama_aplikasi": "Warta Jemaat",
    "pengelola": "Multimedia GKJW Tempursari",
    "hak_cipta": "Yemiko",
    "alamat_situs": "",
    "repo": "",
    "cabang": "main",
    "penjaga": "",
    "google_client_id": "",
}


class Galat(Exception):
    """Kesalahan yang pesannya layak ditampilkan ke pengelola."""


# ---------- utilitas ----------

def e(s):
    return html.escape(str(s), quote=True)


def muat_json(p, bawaan):
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return bawaan


def simpan_json(p, isi, rapat=False):
    p.parent.mkdir(parents=True, exist_ok=True)
    teks = json.dumps(isi, ensure_ascii=False, indent=None if rapat else 2,
                      separators=(",", ":") if rapat else None)
    p.write_text(teks + "\n", encoding="utf-8")


def sandi(isi):
    """JSON -> base64. Supaya isi warta (nama, nomor telepon) tidak ikut terindeks pencarian kode."""
    return base64.b64encode(json.dumps(isi, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")


def buka_sandi(teks):
    return json.loads(base64.b64decode(teks).decode("utf-8"))


def muat_atur():
    a = dict(ATUR_BAWAAN)
    a.update(muat_json(BERKAS_ATUR, {}))
    a["alamat_situs"] = a["alamat_situs"].strip().rstrip("/")
    return a


def muat_edisi():
    daftar = muat_json(BERKAS_EDISI, [])
    daftar.sort(key=lambda x: (x["tanggal"], x["slug"]), reverse=True)
    return daftar


def simpan_edisi(daftar):
    simpan_json(BERKAS_EDISI, sorted(daftar, key=lambda x: (x["tanggal"], x["slug"])))


def tgl(s):
    return dt.date.fromisoformat(s)


def tgl_panjang(s, dengan_hari=True):
    d = tgl(s)
    t = f"{d.day} {BULAN[d.month - 1]} {d.year}"
    return f"{HARI[d.weekday()]}, {t}" if dengan_hari else t


def tgl_pendek(s):
    d = tgl(s)
    return f"{d.day} {BULAN[d.month - 1][:3]} {d.year}"


def slugkan(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60].strip("-") or "dokumen"


def rapikan_warna(w):
    w = (w or "").strip().lower()
    w = SAMA.get(w, w)
    return w if w in KAIN else None


def judul_kecil(s):
    """HURUF BESAR SEMUA -> Huruf Judul; selain itu biarkan."""
    s = re.sub(r"\s+", " ", s).strip()
    return s.title() if s.isupper() else s


def ambil(url, batas_mb=80):
    """Unduh sebuah URL (hanya untuk Google Drive / googleusercontent)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        isi = r.read(batas_mb * 1024 * 1024 + 1)
    if len(isi) > batas_mb * 1024 * 1024:
        raise Galat(f"Berkas lebih besar dari {batas_mb} MB.")
    return isi


# ---------- laporan kemajuan ----------

BERKAS_TUGAS = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()) / "warta-tugas.json"


def diam(persen, pesan):
    """Pelapor bawaan saat dijalankan di komputer: cukup cetak."""
    print(f"   [{int(persen):3d}%] {pesan}", flush=True)


class Lapor:
    """Kirim kemajuan yang sebenarnya ke GitHub (commit status pada komit unggahan),
    supaya panel pengelola bisa menampilkan persen asli, bukan animasi kira-kira."""

    def __init__(self, sha):
        self.sha = sha
        self.token = os.environ.get("GITHUB_TOKEN")
        self.repo = os.environ.get("GITHUB_REPOSITORY")
        self.terakhir, self.persen = 0.0, -1

    def __call__(self, persen, pesan, keadaan="pending", url=None, paksa=False):
        persen = max(0, min(100, int(persen)))
        diam(persen, pesan)
        if not (self.sha and self.token and self.repo):
            return
        kini = time.monotonic()
        if not paksa and keadaan == "pending" and (persen == self.persen or kini - self.terakhir < 0.9):
            return
        self.terakhir, self.persen = kini, persen
        isi = {"state": keadaan, "context": "flipbook", "description": f"{persen}|{pesan}"[:140]}
        if url:
            isi["target_url"] = url
        req = urllib.request.Request(
            f"https://api.github.com/repos/{self.repo}/statuses/{self.sha}", data=json.dumps(isi).encode("utf-8"),
            method="POST", headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                                    "Content-Type": "application/json", "User-Agent": "warta-flipbook"})
        try:
            urllib.request.urlopen(req, timeout=15).read()
        except Exception as g:
            print(f"   (laporan kemajuan tidak terkirim: {g})")


def sha_tugas(berkas):
    """Komit yang menambahkan berkas tugas ini; panel pengelola memantau status komit tersebut."""
    try:
        return subprocess.run(["git", "log", "-1", "--format=%H", "--", str(berkas)], cwd=AKAR,
                              capture_output=True, text=True, timeout=30).stdout.strip() or None
    except Exception:
        return None


# ---------- PDF -> terbitan ----------

def tebak_meta(teks_hal, nama_berkas):
    """Tebak tanggal, nama Minggu, warna stola, tema dan bacaan dari isi warta."""
    meta = {}
    semua = "\n".join(teks_hal)
    hal1 = teks_hal[0] if teks_hal else ""

    m = re.search(r"(20\d\d)[ ._-]?(\d\d)[ ._-]?(\d\d)", nama_berkas)
    if m:
        try:
            meta["tanggal"] = dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass
    if "tanggal" not in meta:
        pola = r"(?:MINGGU|SABTU|JUMAT|KAMIS|RABU|SELASA|SENIN)\s*,\s*(\d{1,2})\s+(" + "|".join(BULAN) + r")\s+(20\d\d)"
        m = re.search(pola, hal1, re.I)
        if m:
            bln = [b.lower() for b in BULAN].index(m[2].lower()) + 1
            meta["tanggal"] = dt.date(int(m[3]), bln, int(m[1])).isoformat()

    if "tanggal" in meta:
        d = tgl(meta["tanggal"])
        pola = (rf"0?{d.day}\s+{BULAN[d.month - 1]}\s+{d.year}\s*[–—-]\s*(.+?)\s*[–—-]\s*"
                r"Stola\s+([A-Za-z]+(?: [A-Za-z]+)?)")
        m = re.search(pola, semua, re.I)
        if m:
            meta["nama_minggu"] = re.sub(r"\s+", " ", m[1]).strip()
            w = rapikan_warna(m[2]) or rapikan_warna(m[2].split()[0])
            if w:
                meta["warna"] = w
    if "warna" not in meta:
        m = re.search(r"Stola\s+([A-Za-z]+)", semua, re.I)
        if m and rapikan_warna(m[1]):
            meta["warna"] = rapikan_warna(m[1])

    m = re.search(r"(?:Waosan|Bacaan)\s*:\s*(.+?)\s{2,}(\S.+?)\s*\n", hal1)
    if m:
        b = re.sub(r"\s*:\s*", ":", m[1].strip())
        b = re.sub(r"(\d)\s+(\d)", r"\1-\2", b)
        meta["bacaan"] = b
        meta["tema"] = judul_kecil(m[2])
    return meta


def sampul_tautan(gambar, tujuan, potong_tengah=False):
    """Gambar pratinjau tautan WhatsApp, 1200x630."""
    from PIL import Image, ImageOps
    if potong_tengah:
        hasil = ImageOps.fit(gambar, (1200, 630), Image.LANCZOS, centering=(0.5, 0.35))
    else:  # dokumen: ambil bagian atas halaman pertama (kop + judul)
        g = gambar.resize((1200, round(gambar.height * 1200 / gambar.width)), Image.LANCZOS)
        hasil = Image.new("RGB", (1200, 630), "white")
        hasil.paste(g.crop((0, 0, 1200, min(g.height, 630))), (0, 0))
    hasil.save(tujuan, "JPEG", quality=84, optimize=True, progressive=True)


def buat_gambar(doc, folder, maju=diam):
    """Ubah tiap halaman PDF jadi gambar WebP (layar, besar, kecil) + sampul pratinjau tautan."""
    import pymupdf
    from PIL import Image

    def render(hal, lebar):
        z = lebar / hal.rect.width
        pm = hal.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)

    ukuran = []
    for i, hal in enumerate(doc, 1):
        render(hal, LEBAR_BESAR).save(folder / f"{i:02d}b.webp", "WEBP", quality=70, method=6)
        layar = render(hal, LEBAR_LAYAR)
        layar.save(folder / f"{i:02d}.webp", "WEBP", quality=74, method=6)
        kecil = layar.copy()
        kecil.thumbnail((LEBAR_KECIL, LEBAR_KECIL * 3), Image.LANCZOS)
        kecil.save(folder / f"{i:02d}k.webp", "WEBP", quality=70, method=6)
        ukuran.append([layar.width, layar.height])
        if i == 1:
            sampul_tautan(layar, folder / "sampul.jpg")
        maju(15 + 67 * i / doc.page_count, f"Halaman {i} dari {doc.page_count}")
    return ukuran


def siapkan_folder(slug):
    folder = SITUS / "e" / slug
    if folder.exists():
        print(f"Terbitan {slug} sudah ada, diganti dengan yang baru.")
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    return folder


def catat(edisi):
    simpan_edisi([x for x in muat_edisi() if x["slug"] != edisi["slug"]] + [edisi])
    return edisi


def tambah_pdf(pdf, jenis="warta", nama_asli=None, maju=diam, **o):
    try:
        import pymupdf
    except ImportError:
        raise Galat("Butuh pymupdf dan pillow. Jalankan:  pip install pymupdf pillow")
    pdf = Path(pdf)
    if not pdf.exists():
        raise Galat(f"Berkas tidak ditemukan: {pdf}")
    try:
        doc = pymupdf.open(pdf)
    except Exception:
        raise Galat("Berkas tidak bisa dibuka sebagai PDF. Pastikan yang diunggah adalah PDF.")
    if doc.page_count == 0:
        raise Galat("PDF ini tidak punya halaman.")
    if doc.page_count > 400:
        raise Galat("PDF lebih dari 400 halaman; terlalu besar untuk flipbook.")
    teks_hal = [h.get_text() for h in doc]
    meta = tebak_meta(teks_hal, nama_asli or pdf.name) if jenis == "warta" else {}

    tanggal = o.get("tanggal") or meta.get("tanggal") or dt.date.today().isoformat()
    try:
        tgl(tanggal)
    except ValueError:
        raise Galat(f"Tanggal tidak dikenali: {tanggal} (pakai format TTTT-BB-HH)")
    if jenis == "warta":
        judul = o.get("judul") or "Warta Jemaat"
        slug = o.get("slug") or tanggal
    else:
        judul = o.get("judul") or judul_kecil(re.sub(r"[_-]+", " ", Path(nama_asli or pdf.name).stem))
        slug = o.get("slug") or slugkan(judul)
    warna = rapikan_warna(o.get("warna")) or meta.get("warna") or ("hijau" if jenis == "warta" else "netral")

    folder = siapkan_folder(slug)
    maju(15, f"Membuka PDF, {doc.page_count} halaman")
    ukuran = buat_gambar(doc, folder, maju)
    nama_pdf = f"{slugkan(judul)}-{tanggal}.pdf" if jenis == "warta" else f"{slug}.pdf"
    shutil.copyfile(pdf, folder / nama_pdf)
    (folder / "teks.b64").write_text(sandi([re.sub(r"\s+", " ", t).strip() for t in teks_hal]), encoding="ascii")

    return catat({
        "slug": slug, "jenis": jenis, "tanggal": tanggal, "judul": judul,
        "nama_minggu": o.get("nama_minggu") or meta.get("nama_minggu", ""),
        "warna": warna,
        "tema": o.get("tema") or meta.get("tema", ""),
        "bacaan": o.get("bacaan") or meta.get("bacaan", ""),
        "halaman": doc.page_count, "ukuran": ukuran, "pdf": nama_pdf,
        "ditambahkan": dt.datetime.now().isoformat(timespec="seconds"),
    })


# ---------- Google Drive ----------

def kenali_drive(url):
    """-> ("folder" | "berkas", id) atau None."""
    m = re.search(r"drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|embeddedfolderview\?id=)([\w-]{10,})", url)
    if m:
        return "folder", m[1]
    m = re.search(r"drive\.google\.com/file/d/([\w-]{10,})", url) or \
        re.search(r"drive\.google\.com/(?:open|uc)\?(?:.*&)?id=([\w-]{10,})", url)
    if m:
        return "berkas", m[1]
    return None


def isi_folder_drive(fid):
    """Daftar berkas di folder Drive yang dibagikan 'siapa saja yang memiliki link'."""
    try:
        halaman = ambil(f"https://drive.google.com/embeddedfolderview?id={fid}#list", 20).decode("utf-8", "replace")
    except Exception:
        raise Galat("Folder Google Drive tidak bisa dibuka. Pastikan dibagikan ke "
                    "'Siapa saja yang memiliki link'.")
    m = re.search(r"<title>([^<]*)</title>", halaman)
    judul = html.unescape(m[1]).strip() if m else ""
    berkas = []
    for potong in halaman.split('<div class="flip-entry" id="entry-')[1:]:
        fid_ = potong.split('"', 1)[0]
        nama = re.search(r'flip-entry-title">([^<]*)<', potong)
        mime = re.search(r'/type/([\w.+-]+/[\w.+-]+)"', potong)
        berkas.append({"id": fid_, "nama": html.unescape(nama[1]) if nama else fid_,
                       "mime": mime[1] if mime else ""})
    if not berkas:
        raise Galat("Folder Google Drive kosong atau belum dibagikan ke 'Siapa saja yang memiliki link'.")

    def urut(b):  # urutan alami: DSC_2.JPG sebelum DSC_10.JPG
        return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", b["nama"])]
    berkas.sort(key=urut)
    return judul, berkas


def tambah_album(url, maju=diam, **o):
    from PIL import Image
    jenis_tautan = kenali_drive(url)
    if not jenis_tautan or jenis_tautan[0] != "folder":
        raise Galat("Album foto butuh tautan FOLDER Google Drive.")
    maju(12, "Membaca folder Google Drive")
    judul_folder, berkas = isi_folder_drive(jenis_tautan[1])
    foto = [b for b in berkas if b["mime"].startswith("image/")]
    if not foto:
        raise Galat("Tidak ada foto di folder itu.")
    semua = len(foto)
    try:
        batas = int(o.get("batas") or 0)
    except ValueError:
        batas = 0
    if batas > 0:
        foto = foto[:batas]
    maju(25, f"{semua} foto ditemukan" + (f", dipakai {len(foto)} pertama" if len(foto) < semua else ""))
    lain = len(berkas) - len(foto)

    nama_folder = re.sub(r"\s+", " ", judul_folder).strip()
    judul = o.get("judul") or (nama_folder if nama_folder.lower().startswith("dokumentasi")
                               else f"Dokumentasi {nama_folder}".strip())
    tanggal = o.get("tanggal") or dt.date.today().isoformat()
    try:
        tgl(tanggal)
    except ValueError:
        raise Galat(f"Tanggal tidak dikenali: {tanggal} (pakai format TTTT-BB-HH)")
    slug = o.get("slug") or slugkan(judul)

    # Ukur beberapa foto untuk menentukan bentuk halaman album (tegak / mendatar)
    langkah = max(1, len(foto) // 24)
    contoh = foto[::langkah][:24]

    def ukur(f):
        try:
            return Image.open(io.BytesIO(ambil(FOTO.format(id=f["id"], px=200), 5))).size
        except Exception:
            return None
    ukuran = []
    with ThreadPoolExecutor(6) as kolam:
        for k, u in enumerate(kolam.map(ukur, contoh), 1):
            if u:
                ukuran.append(u)
            maju(25 + 45 * k / len(contoh), f"Memeriksa foto {k} dari {len(contoh)} contoh")
    if not ukuran:
        raise Galat("Foto di folder itu tidak bisa ditampilkan. Pastikan folder dibagikan ke "
                    "'Siapa saja yang memiliki link'.")
    mendatar = [w / h for w, h in ukuran if w >= h]
    tegak = [w / h for w, h in ukuran if w < h]
    kelompok = sorted(mendatar if len(mendatar) >= len(tegak) else tegak)
    rasio = min(1.6, max(0.62, kelompok[len(kelompok) // 2]))
    hal = [1600, round(1600 / rasio)] if rasio >= 1 else [round(1600 * rasio), 1600]

    folder = siapkan_folder(slug)
    maju(75, "Membuat sampul album")
    sampul = Image.open(io.BytesIO(ambil(FOTO.format(id=foto[0]["id"], px=1200), 20))).convert("RGB")
    sampul.save(folder / "01.webp", "WEBP", quality=76, method=6)
    kecil = sampul.copy()
    kecil.thumbnail((LEBAR_KECIL, LEBAR_KECIL * 3), Image.LANCZOS)
    kecil.save(folder / "01k.webp", "WEBP", quality=70, method=6)
    sampul_tautan(sampul, folder / "sampul.jpg", potong_tengah=True)
    simpan_json(folder / "foto.json", [[f["id"], f["nama"]] for f in foto], rapat=True)
    maju(82, f"Album {len(foto)} foto tersusun")

    return catat({
        "slug": slug, "jenis": "album", "tanggal": tanggal, "judul": judul,
        "nama_minggu": "", "warna": rapikan_warna(o.get("warna")) or "netral", "tema": "", "bacaan": "",
        "halaman": len(foto), "ukuran": [hal], "sampul": list(sampul.size),
        "sumber": f"https://drive.google.com/drive/folders/{jenis_tautan[1]}", "lain": lain,
        "ditambahkan": dt.datetime.now().isoformat(timespec="seconds"),
    })


def tambah_dari_drive(url, jenis, maju=diam, **o):
    """Tautan Drive: folder -> album foto; berkas -> PDF yang diunduh lalu dikonversi."""
    kenal = kenali_drive(url)
    if not kenal:
        raise Galat("Tautan Google Drive tidak dikenali. Salin tautan dari tombol Bagikan di Drive.")
    if kenal[0] == "folder":
        return tambah_album(url, maju=maju, **o)
    maju(10, "Mengunduh PDF dari Google Drive")
    try:
        isi = ambil(UNDUH_DRIVE.format(id=kenal[1]))
    except Galat:
        raise
    except Exception:
        raise Galat("Berkas Google Drive tidak bisa diunduh. Pastikan dibagikan ke 'Siapa saja yang memiliki link'.")
    if not isi.startswith(b"%PDF"):
        raise Galat("Tautan itu bukan PDF (atau belum dibagikan ke 'Siapa saja yang memiliki link'). "
                    "Untuk foto, tempel tautan FOLDER-nya.")
    o.pop("batas", None)
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "dari-drive.pdf"
        p.write_bytes(isi)
        return tambah_pdf(p, "dokumen" if jenis == "album" else jenis, maju=maju, **o)


def hapus(slug):
    daftar = muat_edisi()
    if not any(x["slug"] == slug for x in daftar):
        raise Galat(f"Tidak ada terbitan dengan kode {slug}.")
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        raise Galat("Kode terbitan tidak sah.")
    shutil.rmtree(SITUS / "e" / slug, ignore_errors=True)
    simpan_edisi([x for x in daftar if x["slug"] != slug])


# ---------- membangun situs ----------

def isi_templat(nama, nilai):
    t = (SUMBER / nama).read_text(encoding="utf-8")

    def ganti(m):
        k = m[1]
        if k not in nilai:
            raise KeyError(f"Templat {nama}: kunci '{k}' tidak diisi")
        return str(nilai[k])
    return re.sub(r"\{\{(\w+)\}\}", ganti, t)


def versi_aset():
    h = hashlib.md5()
    for p in sorted((SUMBER / "aset").rglob("*")):
        if p.is_file():
            h.update(p.read_bytes())
    return h.hexdigest()[:8]


def keterangan(ed):
    """Baris kecil di bawah judul."""
    if ed["jenis"] == "album":
        return f"Album foto · {ed['halaman']} foto"
    bagian = []
    if ed.get("nama_minggu"):
        bagian.append(ed["nama_minggu"])
    if ed["jenis"] == "warta" and ed.get("warna") in KAIN and ed["warna"] != "netral":
        bagian.append("stola " + ed["warna"].replace("-", " "))
    if ed["jenis"] == "dokumen" and not bagian:
        bagian.append("Dokumen")
    return " · ".join(bagian)


def kalimat_tema(ed):
    if ed.get("tema") and ed.get("bacaan"):
        return f"“{ed['tema']}” — {ed['bacaan']}"
    return ed.get("tema") or ed.get("bacaan") or ""


def judul_lengkap(ed):
    if ed["jenis"] == "warta":
        return f"{ed['judul']} {tgl_panjang(ed['tanggal'], False)}"
    return ed["judul"]


def satuan(ed):
    return "foto" if ed["jenis"] == "album" else "halaman"


IKON_UNDUH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>'


def html_baca(ed, sblm, brkt, atur, v):
    akar = "../../"
    folder = SITUS / "e" / ed["slug"]
    url = f"{atur['alamat_situs']}/e/{ed['slug']}/" if atur["alamat_situs"] else ""
    gambar = f"{url}sampul.jpg" if url else "sampul.jpg"
    n = ed["halaman"]
    desk = " · ".join(x for x in [tgl_panjang(ed["tanggal"]), keterangan(ed), kalimat_tema(ed),
                                   "" if ed["jenis"] == "album" else f"{n} halaman"] if x)
    hal, mini = [], []
    if ed["jenis"] == "album":
        foto = json.loads((folder / "foto.json").read_text(encoding="utf-8"))
        for i, (fid, nama) in enumerate(foto, 1):
            malas = "" if i == 1 else ' loading="lazy"'
            hal.append(f'<div class="hal"><i class="latar" style="background-image:url({FOTO.format(id=fid, px=24)})"></i><img src="{FOTO.format(id=fid, px=1600)}" data-b="{FOTO.format(id=fid, px=2600)}" '
                       f'data-u="{UNDUH_DRIVE.format(id=fid)}" data-n="{e(nama)}" alt="Foto {i} dari {n}" '
                       f'decoding="async" referrerpolicy="no-referrer"{malas}></div>')
            mini.append(f'<li><button type="button" data-ke="{i}"><img src="{FOTO.format(id=fid, px=240)}" loading="lazy" '
                        f'alt="" referrerpolicy="no-referrer"><span>{i}</span></button></li>')
        unduh = f'<button type="button" id="tbl-unduh">{IKON_UNDUH}<span>Unduh foto</span></button>'
        catatan = (f'<a class="tetangga drive" href="{e(ed["sumber"])}" target="_blank" rel="noopener">'
                   f'<small>Semua berkas asli</small><b>Buka folder di Google Drive</b>'
                   f'<span>{n} foto{f", {ed["lain"]} berkas lain" if ed.get("lain") else ""}</span></a>')
    else:
        for i, (w, h) in enumerate(ed["ukuran"], 1):
            malas = "" if i == 1 else ' loading="lazy"'
            utama = ' fetchpriority="high"' if i == 1 else ""
            hal.append(f'<div class="hal"><img src="{i:02d}.webp" data-b="{i:02d}b.webp" width="{w}" height="{h}" '
                       f'alt="Halaman {i} dari {n}" decoding="async"{malas}{utama}></div>')
            mini.append(f'<li><button type="button" data-ke="{i}"><img src="{i:02d}k.webp" loading="lazy" alt="" '
                        f'width="{w}" height="{h}"><span>{i}</span></button></li>')
        unduh = f'<a id="tbl-unduh" href="{e(ed["pdf"])}" download>{IKON_UNDUH}<span>Unduh PDF</span></a>'
        catatan = ""

    def tetangga(x, arah, label):
        if not x:
            return ""
        return (f'<a class="tetangga {arah}" href="../{e(x["slug"])}/"><small>{label}</small>'
                f'<b>{e(x["judul"])}</b><span>{e(tgl_pendek(x["tanggal"]))}</span></a>')

    w0, h0 = ed["ukuran"][0]
    data = {"slug": ed["slug"], "judul": judul_lengkap(ed), "n": n, "l": w0, "t": h0,
            "gereja": atur["nama_pendek"], "jenis": ed["jenis"]}
    return isi_templat("baca.html", {
        "akar": akar, "v": v, "kain": e(ed["warna"]), "jenis": e(ed["jenis"]), "warna_tema": KAIN[ed["warna"]],
        "judul_tab": e(judul_lengkap(ed)),
        "judul": e(ed["judul"]),
        "sub": e(tgl_panjang(ed["tanggal"]) if ed["jenis"] == "warta" else tgl_panjang(ed["tanggal"], False)),
        "og_judul": e(judul_lengkap(ed)),
        "og_desk": e(atur["nama_gereja"]), "deskripsi": e(desk), "og_gambar": e(gambar),
        "og_url": f'<meta property="og:url" content="{e(url)}">' if url else "",
        "nama_gereja": e(atur["nama_gereja"]),
        "halaman": "\n      ".join(hal), "mini": "\n      ".join(mini),
        "n": n, "unduh": unduh, "catatan": catatan,
        "judul_lembar": "Semua foto" if ed["jenis"] == "album" else "Semua halaman",
        "kata_bagi": "album ini" if ed["jenis"] == "album" else ("warta ini" if ed["jenis"] == "warta" else "dokumen ini"),
        "sblm": tetangga(sblm, "lama", "Terbitan sebelumnya"),
        "brkt": tetangga(brkt, "baru", "Terbitan berikutnya"),
        "data": json.dumps(data, ensure_ascii=False).replace("</", "<\\/"),
    })


def ukuran_sampul(ed):
    return ed.get("sampul") or ed["ukuran"][0]


def html_beranda(daftar, atur, v):
    warta = [x for x in daftar if x["jenis"] == "warta"]
    utama = (warta or daftar or [None])[0]

    if utama:
        w0, h0 = ukuran_sampul(utama)
        ket = keterangan(utama)
        tema = kalimat_tema(utama)
        label = {"warta": "Warta minggu ini", "dokumen": "Dokumen terbaru", "album": "Album terbaru"}[utama["jenis"]]
        kata = {"warta": "Buka warta", "dokumen": "Buka dokumen", "album": "Buka album"}[utama["jenis"]]
        sorot = f"""
    <div class="sorot">
      <div class="sorot-teks">
        <p class="eyebrow">{label}</p>
        <h1>{e(utama['judul'])}</h1>
        <p class="sorot-tgl">{e(tgl_panjang(utama['tanggal']))}</p>
        {f'<p class="sorot-ket">{e(ket)}</p>' if ket else ''}
        {f'<p class="sorot-tema">{e(tema)}</p>' if tema else ''}
        <a class="tombol-utama" href="e/{e(utama['slug'])}/">{kata} <span aria-hidden="true">→</span></a>
      </div>
      <a class="sorot-sampul" href="e/{e(utama['slug'])}/" aria-label="Buka {e(judul_lengkap(utama))}">
        <img src="e/{e(utama['slug'])}/01.webp" width="{w0}" height="{h0}" alt="Halaman depan {e(judul_lengkap(utama))}" fetchpriority="high">
      </a>
    </div>"""
        kain = utama["warna"]
    else:
        sorot = """
    <div class="sorot kosong">
      <div class="sorot-teks">
        <h1>Warta Jemaat</h1>
        <p class="sorot-tgl">Belum ada warta yang diunggah.</p>
      </div>
    </div>"""
        kain = "hijau"

    # Arsip: dikelompokkan per bulan
    kelompok, baris_html = None, []
    for ed in daftar:
        d = tgl(ed["tanggal"])
        kunci = (d.year, d.month)
        if kunci != kelompok:
            if kelompok is not None:
                baris_html.append("</ul></section>")
            baris_html.append(f'<section class="bulan" data-tahun="{d.year}"><h3>{BULAN[d.month - 1]} <span>{d.year}</span></h3><ul>')
            kelompok = kunci
        ket = keterangan(ed)
        tema = kalimat_tema(ed)
        w, h = ukuran_sampul(ed)
        jml = f"{ed['halaman']} foto" if ed["jenis"] == "album" else f"{ed['halaman']} hal."
        baris_html.append(f"""<li class="baris" data-jenis="{e(ed['jenis'])}" data-kain="{e(ed['warna'])}">
  <a href="e/{e(ed['slug'])}/">
    <span class="tgl"><b>{d.day}</b><i>{BULAN[d.month - 1][:3]}</i></span>
    <span class="isi"><strong>{e(ed['judul'])}</strong>{f'<span class="ket">{e(ket)}</span>' if ket else ''}{f'<span class="tema">{e(tema)}</span>' if tema else ''}</span>
    <span class="jml">{jml}</span>
    <img class="mini" src="e/{e(ed['slug'])}/01k.webp" loading="lazy" alt="" width="{w}" height="{h}">
  </a>
</li>""")
    if kelompok is not None:
        baris_html.append("</ul></section>")

    tahun = sorted({tgl(x["tanggal"]).year for x in daftar}, reverse=True)
    jenis_ada = [j for j in ("warta", "dokumen", "album") if any(x["jenis"] == j for x in daftar)]
    keping = '<button type="button" data-jenis="" aria-pressed="true">Semua</button>' + "".join(
        f'<button type="button" data-jenis="{j}" aria-pressed="false">{NAMA_JENIS[j]}</button>' for j in jenis_ada)
    data = {"tahun": tahun,
            "edisi": {x["slug"]: [judul_lengkap(x), x["warna"], x["jenis"]] for x in daftar}}
    url = atur["alamat_situs"] + "/" if atur["alamat_situs"] else ""
    return isi_templat("beranda.html", {
        "v": v, "kain": e(kain), "warna_tema": KAIN[kain],
        "judul_tab": e(f"{atur['nama_aplikasi']} · {atur['nama_pendek']}"),
        "nama_gereja": e(atur["nama_gereja"]), "pengelola": e(atur["pengelola"]),
        "hak_cipta": e(f"© {dt.date.today().year} {atur['hak_cipta']}"),
        "og_gambar": e(f"{url}e/{utama['slug']}/sampul.jpg") if utama else "",
        "og_url": f'<meta property="og:url" content="{e(url)}">' if url else "",
        "sorot": sorot, "arsip": "\n".join(baris_html),
        "pilih_tahun": "".join(f'<option value="{t}">{t}</option>' for t in tahun),
        "jumlah": len(daftar), "keping": keping,
        "sembunyi_keping": "" if len(jenis_ada) > 1 else "hidden",
        "data": json.dumps(data, ensure_ascii=False).replace("</", "<\\/"),
    })


def bangun():
    atur = muat_atur()
    daftar = [x for x in muat_edisi() if (SITUS / "e" / x["slug"] / "01.webp").exists()]
    SITUS.mkdir(exist_ok=True)

    tujuan = SITUS / "aset"
    if tujuan.exists():
        shutil.rmtree(tujuan)
    shutil.copytree(SUMBER / "aset", tujuan)
    v = versi_aset()

    # halaman baca (urut terbaru dulu: "berikutnya" = indeks lebih kecil)
    for i, ed in enumerate(daftar):
        brkt = daftar[i - 1] if i > 0 else None
        sblm = daftar[i + 1] if i + 1 < len(daftar) else None
        (SITUS / "e" / ed["slug"] / "index.html").write_text(
            html_baca(ed, sblm, brkt, atur, v), encoding="utf-8")

    (SITUS / "index.html").write_text(html_beranda(daftar, atur, v), encoding="utf-8")

    # /terbaru/ : tautan tetap yang selalu menuju warta paling baru
    warta = [x for x in daftar if x["jenis"] == "warta"]
    if warta:
        t = warta[0]
        (SITUS / "terbaru").mkdir(exist_ok=True)
        (SITUS / "terbaru" / "index.html").write_text(isi_templat("terbaru.html", {
            "slug": e(t["slug"]), "nama_gereja": e(atur["nama_gereja"]),
            "judul": e(f"Warta Jemaat terbaru — {atur['nama_pendek']}"),
            "og_gambar": e(f"{atur['alamat_situs']}/e/{t['slug']}/sampul.jpg" if atur["alamat_situs"] else f"../e/{t['slug']}/sampul.jpg"),
        }), encoding="utf-8")

    # halaman Kelola
    (SITUS / "kelola").mkdir(exist_ok=True)
    (SITUS / "kelola" / "index.html").write_text(isi_templat("kelola.html", {
        "v": v, "pengelola": e(atur["pengelola"]),
        "hak_cipta": e(f"© {dt.date.today().year} {atur['hak_cipta']}"),
        "data": json.dumps({"repo": atur["repo"], "cabang": atur["cabang"], "situs": atur["alamat_situs"],
                            "penjaga": atur["penjaga"].strip(), "google": atur["google_client_id"].strip()}),
    }), encoding="utf-8")

    # indeks pencarian per tahun (disandikan base64)
    folder_data = SITUS / "data"
    if folder_data.exists():
        shutil.rmtree(folder_data)
    folder_data.mkdir()
    per_tahun = {}
    for ed in daftar:
        p = SITUS / "e" / ed["slug"] / "teks.b64"
        if p.exists():
            per_tahun.setdefault(tgl(ed["tanggal"]).year, []).append(
                {"s": ed["slug"], "h": buka_sandi(p.read_text(encoding="ascii"))})
    for th, isi in per_tahun.items():
        (folder_data / f"cari-{th}.txt").write_text(sandi(isi), encoding="ascii")

    simpan_json(SITUS / "manifest.webmanifest", {
        "name": f"{atur['nama_aplikasi']} {atur['nama_pendek']}", "short_name": atur["nama_aplikasi"],
        "lang": "id", "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": "#F4F5F1", "theme_color": KAIN["hijau"],
        "icons": [{"src": "aset/ikon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "aset/ikon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "aset/ikon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    })
    (SITUS / "404.html").write_text(isi_templat("404.html", {
        "beranda": (atur["alamat_situs"] + "/") if atur["alamat_situs"] else "/"}), encoding="utf-8")
    (SITUS / ".nojekyll").write_text("", encoding="utf-8")
    (SITUS / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
    print(f"Situs dibangun: {len(daftar)} terbitan -> {SITUS}")


# ---------- antrean dari halaman Kelola ----------

def proses():
    """Kerjakan semua tugas di masuk/*.json, lalu bangun situs. Dijalankan server."""
    atur = muat_atur()
    status = muat_json(BERKAS_STATUS, [])
    tugas = sorted(MASUK.glob("*.json")) if MASUK.exists() else []
    catatan = []
    for berkas in tugas:
        kode = berkas.stem
        hasil = {"id": kode, "waktu": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
        lampiran = MASUK / f"{kode}.pdf"
        sha = sha_tugas(berkas)
        maju = Lapor(sha)
        maju(10, "Server mulai mengerjakan", paksa=True)
        try:
            t = json.loads(berkas.read_text(encoding="utf-8"))
            aksi = t.get("aksi", "tambah")
            if aksi == "hapus":
                hapus(str(t.get("slug", "")))
                maju(82, "Terbitan dihapus dari arsip")
                hasil.update(ok=True, pesan="Terbitan dihapus.", slug=t.get("slug"), aksi="hapus")
            elif aksi == "tambah":
                jenis = t.get("jenis", "warta")
                if jenis not in NAMA_JENIS:
                    raise Galat("Jenis terbitan tidak dikenal.")
                o = {k: str(t[k]).strip() for k in ("judul", "tanggal", "warna", "nama_minggu", "tema", "bacaan", "batas")
                     if t.get(k)}
                if t.get("drive"):
                    ed = tambah_dari_drive(str(t["drive"]).strip(), jenis, maju=maju, **o)
                elif lampiran.exists():
                    ed = tambah_pdf(lampiran, "dokumen" if jenis == "album" else jenis,
                                    nama_asli=t.get("nama_berkas"), maju=maju, **o)
                else:
                    raise Galat("Tidak ada PDF maupun tautan Google Drive.")
                hasil.update(ok=True, slug=ed["slug"], judul=judul_lengkap(ed), jenis=ed["jenis"],
                             jumlah=ed["halaman"], pesan="Berhasil diterbitkan.",
                             url=f"{atur['alamat_situs']}/e/{ed['slug']}/" if atur["alamat_situs"] else f"e/{ed['slug']}/")
            else:
                raise Galat("Perintah tidak dikenal.")
        except Galat as g:
            hasil.update(ok=False, pesan=str(g))
        except Exception as g:  # jangan sampai satu tugas rusak menghentikan yang lain
            hasil.update(ok=False, pesan=f"Gagal diproses ({type(g).__name__}: {g})")
        print(("OK   " if hasil["ok"] else "GAGAL"), kode, "-", hasil["pesan"])
        if not hasil["ok"]:
            maju(0, hasil["pesan"], keadaan="failure", paksa=True)
        status = [s for s in status if s["id"] != kode] + [hasil]
        catatan.append({"sha": sha, "ok": hasil["ok"],
                        "url": hasil.get("url") if hasil.get("aksi") != "hapus" else None})
        berkas.unlink()
        lampiran.unlink(missing_ok=True)
    simpan_json(BERKAS_STATUS, status[-30:])
    simpan_json(BERKAS_TUGAS, catatan)
    bangun()
    lapor_semua(86, "Arsip dan halaman situs tersusun")


def lapor_semua(persen, pesan, keadaan="pending"):
    """Laporkan satu tahap untuk semua tugas yang sedang berjalan (dipanggil juga dari alur kerja server)."""
    if BERKAS_TUGAS.exists():
        tugas = [t for t in muat_json(BERKAS_TUGAS, []) if t["ok"]]
    else:  # sebelum `proses` berjalan: semua yang masih ada di antrean
        tugas = [{"sha": sha_tugas(b), "url": None}
                 for b in (sorted(MASUK.glob("*.json")) if MASUK.exists() else [])]
    for t in tugas:
        Lapor(t["sha"])(persen, pesan, keadaan=keadaan,
                        url=t.get("url") if keadaan == "success" else None, paksa=True)


# ---------- perintah ----------

def cmd_tambah(a):
    o = {k: getattr(a, k) for k in ("judul", "tanggal", "warna", "nama_minggu", "tema", "bacaan", "slug", "batas")
         if getattr(a, k)}
    if a.sumber.startswith("http"):
        ed = tambah_dari_drive(a.sumber, a.jenis, **o)
    else:
        ed = tambah_pdf(a.sumber, "dokumen" if a.jenis == "album" else a.jenis, **o)
    bangun()
    atur = muat_atur()
    print("\nSelesai. Kalau ada yang keliru, ubah di data/edisi.json lalu jalankan 'bangun'.")
    for k in ("jenis", "judul", "tanggal", "nama_minggu", "warna", "tema", "bacaan", "halaman"):
        if ed.get(k):
            print(f"   {k:12}: {ed[k]}")
    print(f"\nTautan: {atur['alamat_situs'] or 'situs'}/e/{ed['slug']}/")


def cmd_daftar(_):
    for ed in muat_edisi():
        print(f"{ed['slug']:34} {ed['jenis']:8} {ed['halaman']:>4} {satuan(ed):8} {ed['tanggal']}  {ed['judul']}")


def cmd_hapus(a):
    hapus(a.slug)
    bangun()
    print(f"Terbitan {a.slug} dihapus.")


def cmd_lihat(a):
    import functools
    import http.server
    import webbrowser
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITUS))
    with http.server.ThreadingHTTPServer(("127.0.0.1", a.port), h) as s:
        alamat = f"http://127.0.0.1:{a.port}/"
        print(f"Pratinjau di {alamat}  (Ctrl+C untuk berhenti)")
        if not a.diam:
            webbrowser.open(alamat)
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            pass


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Mesin Warta Flipbook")
    sub = p.add_subparsers(dest="perintah", required=True)

    t = sub.add_parser("tambah", help="tambah atau ganti satu terbitan dari PDF / tautan Google Drive")
    t.add_argument("sumber", help="berkas PDF, atau tautan Google Drive (folder foto / berkas PDF)")
    t.add_argument("--jenis", choices=list(NAMA_JENIS), default="warta")
    t.add_argument("--tanggal", help="TTTT-BB-HH; bawaan: dari nama berkas / isi warta / hari ini")
    t.add_argument("--judul")
    t.add_argument("--nama-minggu", dest="nama_minggu")
    t.add_argument("--warna", help="hijau, putih, ungu, merah, hitam, merah-muda, netral")
    t.add_argument("--tema")
    t.add_argument("--bacaan")
    t.add_argument("--slug")
    t.add_argument("--batas", help="album: pakai sekian foto pertama saja")
    t.set_defaults(f=cmd_tambah)

    sub.add_parser("bangun", help="bangun ulang situs").set_defaults(f=lambda a: bangun())
    sub.add_parser("proses", help="kerjakan antrean masuk/ lalu bangun situs").set_defaults(f=lambda a: proses())
    sub.add_parser("daftar", help="lihat semua terbitan").set_defaults(f=cmd_daftar)
    lp = sub.add_parser("lapor", help="(server) laporkan kemajuan tahap di luar konversi")
    lp.add_argument("persen", type=int)
    lp.add_argument("pesan")
    lp.add_argument("--keadaan", choices=["pending", "success", "error"], default="pending")
    lp.set_defaults(f=lambda a: lapor_semua(a.persen, a.pesan, a.keadaan))
    h = sub.add_parser("hapus", help="hapus satu terbitan")
    h.add_argument("slug")
    h.set_defaults(f=cmd_hapus)
    l = sub.add_parser("lihat", help="pratinjau lokal")
    l.add_argument("--port", type=int, default=8765)
    l.add_argument("--diam", action="store_true", help="jangan buka browser")
    l.set_defaults(f=cmd_lihat)

    a = p.parse_args()
    try:
        a.f(a)
    except Galat as g:
        sys.exit(f"Gagal: {g}")


if __name__ == "__main__":
    main()
