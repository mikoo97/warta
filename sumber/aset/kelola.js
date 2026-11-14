/* Warta Flipbook — panel pengelola.
   Laman 1: unggah.  Laman 2: mengunggah ke server (persen = byte terkirim), lalu mengubah jadi
   flipbook (persen = laporan server per halaman).  Laman 3: flipbook-nya, dengan lembar bagikan.
   Unggahan ditaruh di folder masuk/ pada repo GitHub; server mengerjakannya dan melaporkan
   kemajuan sebagai "commit status" pada komit unggahan itu. */
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
  function mb(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }
  function manusiawi(g) { return g && g.message === 'Failed to fetch' ? 'Sambungan internet terputus. Periksa sambungan lalu coba lagi.' : (g && g.message) || 'Terjadi kesalahan.'; }

  function kepala(mentah) {
    return { 'Accept': mentah ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'Authorization': 'Bearer ' + kunci, 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function api(jalur, opsi) {
    opsi = opsi || {};
    return fetch(API + jalur, { method: opsi.method || 'GET', headers: kepala(opsi.mentah), cache: 'no-store',
      body: opsi.body ? JSON.stringify(opsi.body) : undefined });
  }
  function galatApi(kode) {
    if (kode === 401) return 'Kunci pengelola tidak berlaku lagi. Keluar, lalu masuk dengan kunci baru.';
    if (kode === 403 || kode === 404) return 'Kunci ini tidak punya izin menulis ke situs. Periksa izin “Contents: Read and write”.';
    if (kode === 413 || kode === 422) return 'Berkas ditolak server (mungkin terlalu besar).';
    return 'Server menolak permintaan (kode ' + kode + '). Coba lagi sebentar.';
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
    lanjutkanBilaAda();
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

  /* ---------- Laman 1: formulir unggah ---------- */

  var form = $('form-tambah');
  function jenis() { return form.elements.jenis.value; }

  function aturIsian() {
    var j = jenis();
    tampil($('isian-pdf'), j !== 'album');
    tampil($('isian-album'), j === 'album');
    tampil($('isian-judul'), j !== 'warta');
    $('judul').placeholder = j === 'album' ? 'Misalnya: Dokumentasi Kalipinusan' : 'Misalnya: Tata Ibadah Natal 2026';
    $('judul-opsional').textContent = j === 'album' ? '(dipakai sebagai judul tautan saat dibagikan)' : '';
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
      if (+$('batas').value > 0) tugas.batas = Math.floor(+$('batas').value);
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

  /* ---------- Laman 2: layar kemajuan ---------- */

  var persenKini = 0;
  function layarMuat(langkah, judul, catatan) {
    document.body.classList.add('sedang-muat');
    tampil($('bagian-muat'), true); tampil($('muat-gagal'), false); tampil($('muat-jalan'), true);
    $('muat-langkah').textContent = langkah;
    $('muat-judul').textContent = judul;
    $('muat-catatan').textContent = catatan || '';
    persenKini = -1;
    setPersen(0, '');
    window.scrollTo(0, 0);
  }
  // Persen hanya berubah bila ada kabar nyata (byte terkirim / laporan server); tidak pernah mundur
  function setPersen(p, rinci) {
    p = Math.max(0, Math.min(100, Math.floor(p)));
    if (p > persenKini) {
      persenKini = p;
      $('muat-angka').textContent = p;
      $('muat-isi').style.width = p + '%';
      $('muat-batang').setAttribute('aria-valuenow', p);
      document.title = p + '% · ' + $('muat-judul').textContent;
    }
    if (rinci != null) $('muat-rinci').textContent = rinci;
  }
  function muatGagal(teks) {
    tampil($('muat-jalan'), false); tampil($('muat-gagal'), true);
    $('muat-galat').textContent = teks;
    document.title = 'Belum berhasil · Kelola terbitan';
  }
  function tutupMuat() {
    document.body.classList.remove('sedang-muat');
    tampil($('bagian-muat'), false);
    document.title = 'Kelola terbitan';
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
  }
  $('muat-kembali').addEventListener('click', function () { tutupMuat(); muatDaftar(); });

  function bacaBerkas(f) {
    return new Promise(function (ok, gagal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1]); };
      r.onerror = function () { gagal(new Error('Berkas tidak bisa dibaca dari perangkat ini.')); };
      r.readAsDataURL(f);
    });
  }

  // Taruh satu berkas di masuk/ ; kemajuan(0..1) dipanggil sesuai byte yang benar-benar terkirim
  function taruh(nama, isiB64, catatan, kemajuan) {
    return new Promise(function (ok, gagal) {
      var x = new XMLHttpRequest(), h = kepala(false);
      x.open('PUT', API + '/contents/masuk/' + nama);
      Object.keys(h).forEach(function (k) { x.setRequestHeader(k, h[k]); });
      x.setRequestHeader('Content-Type', 'application/json');
      if (kemajuan) x.upload.onprogress = function (e) { if (e.lengthComputable) kemajuan(e.loaded / e.total); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) { try { ok(JSON.parse(x.responseText)); } catch (_) { gagal(new Error('Jawaban server tidak terbaca.')); } }
        else gagal(new Error(galatApi(x.status)));
      };
      x.onerror = function () { gagal(new Error('Failed to fetch')); };
      x.send(JSON.stringify({ message: catatan, content: isiB64, branch: C.cabang }));
    });
  }

  function jalankan(tugas, lampiran) {
    var kode = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    var hapus = tugas.aksi === 'hapus';
    layarMuat('Langkah 1 dari 2', lampiran ? 'Mengunggah ke server' : 'Mengirim ke server', 'Jangan tutup atau tinggalkan halaman ini.');
    var awal = Promise.resolve();
    if (lampiran) {
      // PDF memakai hampir seluruh rentang 0–100; berkas perintah yang kecil menyusul di ujung
      awal = bacaBerkas(lampiran).then(function (b64) {
        return taruh(kode + '.pdf', b64, 'Unggah PDF', function (f) {
          setPersen(f * 97, mb(f * lampiran.size) + ' dari ' + mb(lampiran.size));
        });
      });
    }
    awal.then(function () {
      if (lampiran) setPersen(97, 'Mencatat perintah terbit');
      return taruh(kode + '.json', b64teks(JSON.stringify(tugas)), hapus ? 'Hapus terbitan' : 'Terbitan baru',
        lampiran ? null : function (f) { setPersen(f * 99, ''); });
    }).then(function (j) {
      setPersen(100, 'Diterima server');
      var tanda = kode + '.' + j.commit.sha + '.' + (hapus ? 'h' : 't');
      try { history.replaceState(null, '', '#proses=' + tanda); } catch (_) {}
      return tunggu(700).then(function () { return pantau(j.commit.sha, hapus); });
    }).catch(function (g) { muatGagal(manusiawi(g)); });
  }

  // Langkah 2: baca laporan server sampai selesai
  function pantau(sha, hapus) {
    layarMuat('Langkah 2 dari 2', hapus ? 'Menghapus dari arsip' : 'Mengubah jadi flipbook',
      'Dikerjakan server. Halaman ini boleh dibiarkan terbuka; biasanya 1–3 menit.');
    var mulai = Date.now(), galatBeruntun = 0;

    function status() {
      return api('/commits/' + sha + '/statuses?per_page=10').then(function (r) {
        if (!r.ok) throw new Error(galatApi(r.status));
        return r.json();
      }).then(function (arr) {
        return arr.filter(function (s) { return s.context === 'flipbook'; })[0] || null;
      });
    }
    function antre() {  // belum ada laporan: server masih antre / baru menyala
      return api('/actions/runs?head_sha=' + sha + '&per_page=1').then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) {
          var lari = j && j.workflow_runs && j.workflow_runs[0];
          if (!lari) return setPersen(1, 'Menunggu giliran di server');
          if (lari.status === 'completed' && lari.conclusion !== 'success') throw new Error('Server gagal memproses. Coba terbitkan lagi.');
          setPersen(lari.status === 'in_progress' ? 3 : 2, lari.status === 'in_progress' ? 'Server menyala' : 'Menunggu giliran di server');
        });
    }
    function putar() {
      if (Date.now() - mulai > 15 * 60000) throw new Error('Server belum selesai setelah 15 menit. Muat ulang halaman ini nanti untuk melihat kelanjutannya.');
      return status().then(function (s) {
        galatBeruntun = 0;
        if (!s) return antre().then(function () { return tunggu(2500).then(putar); });
        var bagi = String(s.description || '').split('|'), p = parseInt(bagi[0], 10) || 0, teks = bagi.slice(1).join('|');
        if (s.state === 'failure' || s.state === 'error') throw new Error(teks || 'Server gagal memproses.');
        if (s.state === 'success') { setPersen(100, 'Selesai'); return s; }
        setPersen(p, teks);
        return tunggu(2000).then(putar);
      }, function (g) {
        if (++galatBeruntun > 8) throw g;   // sambungan putus sebentar: coba lagi dulu
        $('muat-rinci').textContent = 'Sambungan terputus, mencoba lagi…';
        return tunggu(4000).then(putar);
      });
    }

    return putar().then(function (s) {
      if (hapus) {
        return tunggu(1200).then(function () { tutupMuat(); muatDaftar(); pesan($('pesan-daftar'), 'Terbitan sudah dihapus.'); });
      }
      var slug = (/\/e\/([^/]+)\/?$/.exec(s.target_url || '') || [])[1];
      if (!slug) { tutupMuat(); muatDaftar(); return; }
      $('muat-rinci').textContent = 'Membuka flipbook…';
      return tungguTayang(slug).then(function () {
        try { history.replaceState(null, '', location.pathname); } catch (_) {}
        // Laman 3: flipbook-nya sendiri, dengan lembar bagikan terbuka
        location.href = '../e/' + encodeURIComponent(slug) + '/?baru=1';
      });
    }).catch(function (g) { muatGagal(manusiawi(g)); });
  }

  // Pastikan halaman barunya sudah benar-benar bisa dibuka sebelum pindah
  function tungguTayang(slug) {
    var mulai = Date.now();
    function cek() {
      return fetch('../e/' + encodeURIComponent(slug) + '/?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok; }, function () { return false; })
        .then(function (ada) {
          if (ada || Date.now() - mulai > 3 * 60000) return ada;
          return tunggu(3000).then(cek);
        });
    }
    return cek();
  }

  // Halaman dimuat ulang saat server masih bekerja: lanjutkan pemantauan
  function lanjutkanBilaAda() {
    var m = /#proses=[\w-]+\.([0-9a-f]{40})\.([ht])/.exec(location.hash);
    if (m) pantau(m[1], m[2] === 'h');
  }

  /* ---------- Daftar terbitan ---------- */

  function salin(teks, tbl) {
    var beres = function () { tbl.textContent = 'Tautan tersalin'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(teks).then(beres, function () { prompt('Salin tautan ini:', teks); });
    else prompt('Salin tautan ini:', teks);
  }

  function muatDaftar() {
    var ul = $('daftar-terbit'), info = $('pesan-daftar');
    api('/contents/data/edisi.json?ref=' + C.cabang, { mentah: true })
      .then(function (r) { if (r.status === 404) return []; if (!r.ok) throw new Error(galatApi(r.status)); return r.json(); })
      .then(function (daftar) {
        daftar.sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; });
        ul.textContent = '';
        pesan(info, daftar.length ? '' : 'Belum ada terbitan. Unggah yang pertama lewat formulir di atas.');
        daftar.forEach(function (ed) {
          var li = document.createElement('li'), isi = document.createElement('div'), alat = document.createElement('div');
          var t = ed.tanggal.split('-');
          var jdl = document.createElement('b'), ket = document.createElement('span');
          var tgl = (+t[2]) + ' ' + BULAN[+t[1] - 1] + ' ' + t[0];
          jdl.textContent = ed.judul;
          ket.textContent = tgl + ' · ' + NAMA_JENIS[ed.jenis] + ' · ' + ed.halaman + (ed.jenis === 'album' ? ' foto' : ' hal.');
          isi.appendChild(jdl); isi.appendChild(ket);
          var url = alamatSitus() + '/e/' + ed.slug + '/';
          var buka = document.createElement('a'); buka.href = '../e/' + ed.slug + '/'; buka.target = '_blank'; buka.rel = 'noopener'; buka.textContent = 'Buka';
          var sal = document.createElement('button'); sal.type = 'button'; sal.textContent = 'Salin tautan';
          sal.addEventListener('click', function () { salin(url, sal); });
          var hps = document.createElement('button'); hps.type = 'button'; hps.className = 'bahaya'; hps.textContent = 'Hapus';
          hps.addEventListener('click', function () {
            if (!confirm('Hapus “' + ed.judul + '” (' + tgl + ') dari situs?\nTautan yang sudah dibagikan tidak akan bisa dibuka lagi.')) return;
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
