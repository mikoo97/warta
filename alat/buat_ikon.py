"""Buat ikon aplikasi dari simbol logo Multimedia GKJW Tempursari. Cukup dijalankan sekali.

  python alat/buat_ikon.py "D:/GKJW Tempursari/Logo/logo-mulmed-putih-emas_2.svg"
"""
import re
import sys
from pathlib import Path

import pymupdf

ASET = Path(__file__).resolve().parent.parent / "sumber" / "aset"
HIJAU, EMAS = "#1F5B41", "#E6C56E"

svg = Path(sys.argv[1]).read_text(encoding="utf-8")
d = re.search(r'<path id="Simbol"[^>]*? d="([^"]+)"', svg)[1]
angka = [float(x) for x in re.findall(r"-?\d+\.?\d*", d)]
x0, x1, y0, y1 = min(angka[0::2]), max(angka[0::2]), min(angka[1::2]), max(angka[1::2])
w, h = x1 - x0, y1 - y0
jalur = f'<path fill="{EMAS}" fill-rule="evenodd" d="{d}"/>'

(ASET / "simbol.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}">{jalur}</svg>', encoding="utf-8")


def ikon(porsi, sudut):
    s = 512 * porsi / max(w, h)
    tx, ty = (512 - w * s) / 2 - x0 * s, (512 - h * s) / 2 - y0 * s
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="{sudut}" fill="{HIJAU}"/>'
            f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})">{jalur}</g></svg>')


(ASET / "ikon.svg").write_text(ikon(0.6, 104), encoding="utf-8")
for nama, isi, px in [("ikon-192.png", ikon(0.6, 104), 192), ("ikon-512.png", ikon(0.6, 104), 512),
                      ("ikon-maskable-512.png", ikon(0.46, 0), 512)]:
    hal = pymupdf.open(stream=isi.encode(), filetype="svg")[0]
    z = px / hal.rect.width
    hal.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=True).save(ASET / nama)
    print("dibuat", nama)
