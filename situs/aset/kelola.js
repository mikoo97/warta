/* Warta Flipbook — panel pengelola.
   Unggahan ditaruh di folder masuk/ pada repo GitHub; server mengubahnya menjadi flipbook
   lalu menulis hasilnya ke data/status.json. */
(function () {
  'use strict';
  var C = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var API = 'https://api.github.com/repos/' + C.repo;
  var KUNCI = 'warta-kunci';
  var kunci = null;
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var NAMA_JENIS = { warta: 'Warta', dokumen: 'Dokumen', album: 'Album foto' };

  function tampil(el, ya) { el.hidden = !ya; }
  function pesan(el, teks) { el.textContent = teks || ''; el.hidden = !teks; }
  function tunggu(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function simpan(v) { try { v ? localStorage.setItem(KUNCI, v) : localStorage.removeItem(KUNCI); } catch (_) {} }
  function ingat() { try { return localStorage.getItem(KUNCI); } catch (_) { return null; } }
  function b64teks(s) { return btoa(unescape(encodeURIComponent(s))); }
  function alamatSitus() { return C.situs || new URL('../', location.href).href.replace(/\/$/, ''); }

  function api(jalur, opsi) {
    opsi = opsi || {};
    var kepala = { 'Accept': opsi.mentah ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'Authorization': 'Bearer ' + kunci, 'X-GitHub-Api-Version': '2022-11-28' };
    return fetch(API + jalur, { method: opsi.method || 'GET', headers: kepala, cache: 'no-store',
      body: opsi.body ? JSON.stringify(opsi.body) : undefined });
  }
  function galatApi(r) {
    if (r.status === 401) return 'Kunci pengelola tidak berlaku lagi. Keluar, lalu masuk dengan kunci baru.';
    if (r.status === 403 || r.status === 404) return 'Kunci ini tidak punya izin menulis ke situs. Periksa izin “Contents: Read and write”.';
    if (r.status === 413 || r.status === 422) return 'Berkas ditolak server (mungkin terlalu besar).';
    return 'Server menolak permintaan (kode ' + r.status + '). Coba lagi sebentar.';
  }

  /* ---------- Masuk ---------- */

  function periksaKunci(k) {
    kunci = k;
    return api('').then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? 'Kunci tidak dikenali. Periksa lagi, jangan ada spasi yang ikut tersalin.'
        : 'Kunci ini tidak bisa membuka situs. Pastikan repo yang dipilih benar.');
      return r.json();
    }).then(function (j) {
      if (!j.permissions || !j.permissions.push) throw new Error('Kunci dikenali, tetapi belum punya izin menulis. Setel “Contents: Read and write”.');
      return true;
    });
  }

  function bukaPanel() {
    tampil($('bagian-masuk'), false);
    tampil($('bagian-panel'), true);
    muatDaftar();
  }

  $('form-masuk').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var k = $('kunci').value.trim(), tbl = this.querySelector('button');
    pesan($('galat-masuk'), '');
    tbl.disabled = true; tbl.textContent = 'Memeriksa…';
    periksaKunci(k).then(function () { simpan(k); $('kunci').value = ''; bukaPanel(); })
      .catch(function (g) { kunci = null; pesan($('galat-masuk'), g.message === 'Failed to fetch' ? 'Tidak bisa menghubungi server. Periksa sambungan internet.' : g.message); })
      .then(function () { tbl.disabled = false; tbl.textContent = 'Masuk'; });
  });

  $('tbl-keluar').addEventListener('click', function () {
    simpan(null); kunci = null;
    tampil($('bagian-panel'), false); tampil($('bagian-masuk'), true);
  });

  /* ---------- Formulir ---------- */

  var form = $('form-tambah');
  function jenis() { return form.elements.jenis.value; }

  function aturIsian() {
    var j = jenis();
    tampil($('isian-pdf'), j !== 'album');
    tampil($('isian-album'), j === 'album');
    tampil($('isian-judul'), j !== 'warta');
    $('judul-opsional').textContent = j === 'album' ? '(kosongkan untuk memakai nama folder)' : '';
    $('tanggal-opsional').textContent = j === 'warta' ? '(kosongkan agar dibaca dari isi warta)' : '(kosongkan untuk hari ini)';
    $('tbl-terbit').textContent = { warta: 'Terbitkan warta', dokumen: 'Terbitkan dokumen', album: 'Terbitkan album' }[j];
    pesan($('galat-tambah'), '');
  }
  [].forEach.call(form.elements.jenis, function (r) { r.addEventListener('change', aturIsian); });

  $('berkas').addEventListener('change', function () {
    var f = this.files[0], m = f && /(20\d\d)[ ._-]?(\d\d)[ ._-]?(\d\d)/.exec(f.name);
    if (m && !$('tanggal').value) {
      $('tanggal').value = m[1] + '-' + m[2] + '-' + m[3];
      $('petunjuk-tanggal').textContent = 'Tanggal terbaca dari nama berkas. Ubah bila keliru.';
    }
    if (f && jenis() === 'dokumen' && !$('judul').value) $('judul').value = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  });

  function bacaBerkas(f) {
    return new Promise(function (ok, gagal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1]); };
      r.onerror = function () { gagal(new Error('Berkas tidak bisa dibaca dari perangkat ini.')); };
      r.readAsDataURL(f);
    });
  }

  function taruh(nama, isiB64, catatan) {
    return api('/contents/masuk/' + nama, { method: 'PUT', body: { message: catatan, content: isiB64, branch: C.cabang } })
      .then(function (r) { if (!r.ok) throw new Error(galatApi(r)); return r.json(); });
  }

  function langkah(id, keadaan) { $(id).className = keadaan || ''; }

  // Tunggu server menulis hasil tugas ini ke data/status.json
  function tungguHasil(kode, komit) {
    var mulai = Date.now();
    function cek() {
      if (Date.now() - mulai > 12 * 60000) {
        throw new Error('Server belum selesai setelah 12 menit. Muat ulang halaman ini nanti untuk melihat hasilnya.');
      }
      return api('/contents/data/status.json?ref=' + C.cabang, { mentah: true })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (daftar) {
          var h = (daftar || []).filter(function (s) { return s.id === kode; })[0];
          if (h) return h;
          // Kalau server gagal total (bukan karena isi berkas), jangan menunggu sampai habis
          return api('/actions/runs?head_sha=' + komit + '&per_page=3').then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; })
            .then(function (j) {
              var lari = j && j.workflow_runs && j.workflow_runs[0];
              if (lari && lari.status === 'completed' && lari.conclusion !== 'success') {
                throw new Error('Server gagal memproses. Coba terbitkan lagi; bila tetap gagal, hubungi pengurus situs.');
              }
              var dtk = Math.round((Date.now() - mulai) / 1000);
              $('proses-pesan').textContent = 'Menunggu server… ' + (dtk < 60 ? dtk + ' detik' : Math.floor(dtk / 60) + ' menit ' + (dtk % 60) + ' detik');
              return tunggu(6000).then(cek);
            });
        });
    }
    return tunggu(8000).then(cek);
  }

  // Tunggu sampai halaman barunya benar-benar bisa dibuka
  function tungguTayang(slug) {
    var mulai = Date.now();
    function cek() {
      return fetch('../e/' + encodeURIComponent(slug) + '/?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok; }, function () { return false; })
        .then(function (ada) {
          if (ada || Date.now() - mulai > 4 * 60000) return ada;
          return tunggu(5000).then(cek);
        });
    }
    return cek();
  }

  function jalankan(tugas, lampiran) {
    var kode = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    tampil(form, false); tampil($('proses'), true); tampil($('hasil-terbit'), false); tampil($('tbl-lagi'), false);
    $('proses-judul').textContent = tugas.aksi === 'hapus' ? 'Sedang dihapus' : 'Sedang diterbitkan';
    $('l-konversi').firstChild.textContent = tugas.aksi === 'hapus' ? 'Menghapus dari arsip ' : 'Mengubah menjadi flipbook ';
    ['l-unggah', 'l-konversi', 'l-tayang'].forEach(function (id) { langkah(id, ''); });
    langkah('l-unggah', 'jalan');
    $('proses-pesan').textContent = lampiran ? 'Mengunggah PDF… jangan tutup halaman ini.' : '';
    $('proses').scrollIntoView({ block: 'start', behavior: 'smooth' });

    var awal = lampiran ? bacaBerkas(lampiran).then(function (b64) { return taruh(kode + '.pdf', b64, 'Unggah PDF'); }) : Promise.resolve();
    return awal.then(function () {
      return taruh(kode + '.json', b64teks(JSON.stringify(tugas)), tugas.aksi === 'hapus' ? 'Hapus terbitan' : 'Terbitan baru');
    }).then(function (j) {
      langkah('l-unggah', 'beres'); langkah('l-konversi', 'jalan');
      return tungguHasil(kode, j.commit.sha);
    }).then(function (h) {
      if (!h.ok) throw new Error(h.pesan);
      langkah('l-konversi', 'beres'); langkah('l-tayang', 'jalan');
      $('proses-pesan').textContent = 'Hampir selesai…';
      if (tugas.aksi === 'hapus') return tunggu(20000).then(function () { return h; });
      return tungguTayang(h.slug).then(function () { return h; });
    }).then(function (h) {
      langkah('l-tayang', 'beres');
      if (tugas.aksi === 'hapus') {
        $('proses-judul').textContent = 'Sudah dihapus';
        $('proses-pesan').textContent = 'Terbitan itu tidak lagi muncul di arsip.';
      } else {
        var url = alamatSitus() + '/e/' + h.slug + '/';
        $('proses-judul').textContent = 'Sudah terbit';
        $('proses-pesan').textContent = h.judul + ' — ' + h.jumlah + (h.jenis === 'album' ? ' foto' : ' halaman') + '.';
        $('hasil-url').textContent = url;
        $('hasil-buka').href = url;
        $('hasil-wa').href = 'https://wa.me/?text=' + encodeURIComponent(h.judul + '\n' + url);
        $('hasil-salin').textContent = 'Salin tautan';
        $('hasil-salin').onclick = function () { salin(url, this); };
        tampil($('hasil-terbit'), true);
      }
    }).catch(function (g) {
      ['l-unggah', 'l-konversi', 'l-tayang'].forEach(function (id) { if ($(id).className === 'jalan') langkah(id, 'gagal'); });
      $('proses-judul').textContent = 'Belum berhasil';
      $('proses-pesan').textContent = g.message === 'Failed to fetch' ? 'Sambungan internet terputus. Periksa sambungan lalu coba lagi.' : g.message;
    }).then(function () {
      tampil($('tbl-lagi'), true);
      muatDaftar();
    });
  }

  function salin(teks, tbl) {
    var beres = function () { tbl.textContent = 'Tautan tersalin'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(teks).then(beres, function () { prompt('Salin tautan ini:', teks); });
    else prompt('Salin tautan ini:', teks);
  }

  $('tbl-lagi').addEventListener('click', function () {
    form.reset(); aturIsian(); $('petunjuk-tanggal').textContent = '';
    tampil($('proses'), false); tampil(form, true);
    form.scrollIntoView({ block: 'start' });
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var j = jenis(), galat = $('galat-tambah');
    var tugas = { aksi: 'tambah', jenis: j };
    var berkas = null;
    pesan(galat, '');
    if (j === 'album') {
      var folder = $('drive-folder').value.trim();
      if (!/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//.test(folder)) return pesan(galat, 'Tempel tautan folder Google Drive (yang mengandung “/folders/”).');
      tugas.drive = folder;
    } else {
      berkas = $('berkas').files[0] || null;
      var tautan = $('drive-pdf').value.trim();
      if (!berkas && !tautan) return pesan(galat, 'Pilih berkas PDF, atau tempel tautan PDF di Google Drive.');
      if (berkas && tautan) return pesan(galat, 'Pilih salah satu saja: berkas PDF atau tautan Drive.');
      if (berkas) {
        if (!/\.pdf$/i.test(berkas.name)) return pesan(galat, 'Berkas harus PDF.');
        if (berkas.size > 45 * 1024 * 1024) return pesan(galat, 'PDF lebih dari 45 MB. Perkecil dulu, atau unggah ke Drive dan tempel tautannya.');
        tugas.nama_berkas = berkas.name;
      } else {
        if (!/drive\.google\.com\//.test(tautan)) return pesan(galat, 'Tautan harus dari Google Drive.');
        tugas.drive = tautan;
      }
      if (j === 'dokumen' && !$('judul').value.trim()) return pesan(galat, 'Isi judul dokumennya.');
    }
    if (j !== 'warta' && $('judul').value.trim()) tugas.judul = $('judul').value.trim();
    if ($('tanggal').value) tugas.tanggal = $('tanggal').value;
    jalankan(tugas, berkas);
  });

  /* ---------- Daftar terbitan ---------- */

  function muatDaftar() {
    var ul = $('daftar-terbit'), info = $('pesan-daftar');
    api('/contents/data/edisi.json?ref=' + C.cabang, { mentah: true })
      .then(function (r) { if (r.status === 404) return []; if (!r.ok) throw new Error(galatApi(r)); return r.json(); })
      .then(function (daftar) {
        daftar.sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; });
        ul.textContent = '';
        pesan(info, daftar.length ? '' : 'Belum ada terbitan. Unggah yang pertama lewat formulir di atas.');
        daftar.forEach(function (ed) {
          var li = document.createElement('li'), isi = document.createElement('div'), alat = document.createElement('div');
          var t = ed.tanggal.split('-');
          var jdl = document.createElement('b'), ket = document.createElement('span');
          jdl.textContent = ed.judul;
          ket.textContent = (+t[2]) + ' ' + BULAN[+t[1] - 1] + ' ' + t[0] + ' · ' + NAMA_JENIS[ed.jenis] + ' · ' + ed.halaman + (ed.jenis === 'album' ? ' foto' : ' hal.');
          isi.appendChild(jdl); isi.appendChild(ket);
          var url = alamatSitus() + '/e/' + ed.slug + '/';
          var buka = document.createElement('a'); buka.href = '../e/' + ed.slug + '/'; buka.target = '_blank'; buka.rel = 'noopener'; buka.textContent = 'Buka';
          var sal = document.createElement('button'); sal.type = 'button'; sal.textContent = 'Salin tautan';
          sal.addEventListener('click', function () { salin(url, sal); });
          var hps = document.createElement('button'); hps.type = 'button'; hps.className = 'bahaya'; hps.textContent = 'Hapus';
          hps.addEventListener('click', function () {
            if (!confirm('Hapus “' + ed.judul + '” (' + ket.textContent.split(' · ')[0] + ') dari situs?\nTautan yang sudah dibagikan tidak akan bisa dibuka lagi.')) return;
            jalankan({ aksi: 'hapus', slug: ed.slug }, null);
          });
          alat.className = 'alat'; alat.appendChild(buka); alat.appendChild(sal); alat.appendChild(hps);
          li.appendChild(isi); li.appendChild(alat); ul.appendChild(li);
        });
      })
      .catch(function (g) { pesan(info, g.message === 'Failed to fetch' ? 'Daftar gagal dimuat. Periksa sambungan internet.' : g.message); });
  }

  /* ---------- Mulai ---------- */

  if (!C.repo) { tampil($('bagian-belum'), true); return; }
  $('nama-repo').textContent = C.repo;
  aturIsian();
  var lama = ingat();
  if (lama) {
    periksaKunci(lama).then(bukaPanel, function () {
      kunci = null; tampil($('bagian-masuk'), true);
      pesan($('galat-masuk'), 'Kunci yang tersimpan tidak berlaku lagi. Tempel kunci baru.');
    });
  } else {
    tampil($('bagian-masuk'), true);
  }
})();
