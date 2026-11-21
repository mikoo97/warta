/* Warta Flipbook — panel pengelola.
   Laman 1: unggah.  Laman 2: mengunggah ke server (persen = byte terkirim), lalu mengubah jadi
   flipbook (persen = laporan server per halaman).  Laman 3: flipbook-nya, dengan lembar bagikan.

   Dua cara masuk:
   - lewat "penjaga" (fungsi server): Masuk dengan Google; kunci GitHub tinggal di server.
   - langsung dengan kunci GitHub (cadangan, dipakai bila penjaga belum dipasang). */
(function () {
  'use strict';
  var C = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var API = 'https://api.github.com/repos/' + C.repo;
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var NAMA_JENIS = { warta: 'Warta', dokumen: 'Dokumen', album: 'Album foto' };
  var lewatPenjaga = !!(C.penjaga && C.google);
  var kunci = null;   // mode kunci: token GitHub
  var sesi = null;    // mode penjaga: { sesi, email, utama }

  function tampil(el, ya) { el.hidden = !ya; }
  function pesan(el, teks) { el.textContent = teks || ''; el.hidden = !teks; }
  function tunggu(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function simpan(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} }
  function ingat(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function b64teks(s) { return btoa(unescape(encodeURIComponent(s))); }
  function alamatSitus() { return C.situs || new URL('../', location.href).href.replace(/\/$/, ''); }
  function mb(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }
  function manusiawi(g) { return g && g.message === 'Failed to fetch' ? 'Sambungan internet terputus. Periksa sambungan lalu coba lagi.' : (g && g.message) || 'Terjadi kesalahan.'; }

  /* ================= Penghubung ke server ================= */

  // --- lewat penjaga ---
  function panggil(aksi, isi, kemajuan) {
    return new Promise(function (ok, gagal) {
      var x = new XMLHttpRequest(), badan = isi || {};
      badan.aksi = aksi;
      x.open('POST', C.penjaga);
      x.setRequestHeader('Content-Type', 'application/json');
      if (sesi) x.setRequestHeader('Authorization', 'Bearer ' + sesi.sesi);
      if (kemajuan) x.upload.onprogress = function (e) { if (e.lengthComputable) kemajuan(e.loaded / e.total); };
      x.onload = function () {
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (_) {}
        if (x.status >= 200 && x.status < 300 && j) return ok(j);
        if (x.status === 401 && aksi !== 'masuk') { keluar('Sesi berakhir. Silakan masuk lagi.'); }
        gagal(new Error((j && j.galat) || (x.status === 413 ? 'Berkas terlalu besar untuk diunggah langsung. Unggah ke Google Drive lalu tempel tautannya.' : 'Server menolak permintaan (kode ' + x.status + ').')));
      };
      x.onerror = function () { gagal(new Error('Failed to fetch')); };
      x.send(JSON.stringify(badan));
    });
  }

  // --- langsung ke GitHub dengan kunci ---
  function kepala(mentah) {
    return { 'Accept': mentah ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'Authorization': 'Bearer ' + kunci, 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function api(jalur, mentah) { return fetch(API + jalur, { headers: kepala(mentah), cache: 'no-store' }); }
  function galatApi(kode) {
    if (kode === 401) return 'Kunci pengelola tidak berlaku lagi. Keluar, lalu masuk dengan kunci baru.';
    if (kode === 403 || kode === 404) return 'Kunci ini tidak punya izin menulis ke situs. Periksa izin “Contents: Read and write”.';
    if (kode === 413 || kode === 422) return 'Berkas ditolak server (mungkin terlalu besar).';
    return 'Server menolak permintaan (kode ' + kode + '). Coba lagi sebentar.';
  }

  var B = lewatPenjaga ? {
    batasPdf: 4 * 1024 * 1024,
    daftar: function () { return panggil('daftar'); },
    taruh: function (nama, b64, catatan, kemajuan) { return panggil('taruh', { nama: nama, isi: b64, catatan: catatan }, kemajuan); },
    status: function (sha) { return panggil('status', { sha: sha }); }
  } : {
    batasPdf: 45 * 1024 * 1024,
    daftar: function () {
      return api('/contents/data/edisi.json?ref=' + C.cabang, true).then(function (r) {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(galatApi(r.status));
        return r.json();
      });
    },
    taruh: function (nama, b64, catatan, kemajuan) {
      return new Promise(function (ok, gagal) {
        var x = new XMLHttpRequest(), h = kepala(false);
        x.open('PUT', API + '/contents/masuk/' + nama);
        Object.keys(h).forEach(function (k) { x.setRequestHeader(k, h[k]); });
        x.setRequestHeader('Content-Type', 'application/json');
        if (kemajuan) x.upload.onprogress = function (e) { if (e.lengthComputable) kemajuan(e.loaded / e.total); };
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) { try { ok({ sha: JSON.parse(x.responseText).commit.sha }); } catch (_) { gagal(new Error('Jawaban server tidak terbaca.')); } }
          else gagal(new Error(galatApi(x.status)));
        };
        x.onerror = function () { gagal(new Error('Failed to fetch')); };
        x.send(JSON.stringify({ message: catatan, content: b64, branch: C.cabang }));
      });
    },
    status: function (sha) {
      return api('/commits/' + sha + '/statuses?per_page=10').then(function (r) {
        if (!r.ok) throw new Error(galatApi(r.status));
        return r.json();
      }).then(function (arr) {
        var s = arr.filter(function (x) { return x.context === 'flipbook'; })[0];
        if (s) {
          var bagi = String(s.description || '').split('|');
          return { keadaan: s.state, persen: parseInt(bagi[0], 10) || 0, pesan: bagi.slice(1).join('|'), url: s.target_url || null };
        }
        return api('/actions/runs?head_sha=' + sha + '&per_page=1').then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (j) {
            var lari = j && j.workflow_runs && j.workflow_runs[0];
            if (lari && lari.status === 'completed' && lari.conclusion !== 'success') {
              return { keadaan: 'error', persen: 0, pesan: 'Server gagal memproses. Coba terbitkan lagi.', url: null };
            }
            return { keadaan: null, antre: lari ? lari.status : null };
          });
      });
    }
  };

  /* ================= Masuk ================= */

  function bukaPanel() {
    tampil($('bagian-masuk'), false);
    tampil($('bagian-panel'), true);
    $('siapa').textContent = sesi ? 'Masuk sebagai ' + sesi.email + (sesi.utama ? ' (admin utama)' : '') : '';
    tampil($('bagian-pengelola'), !!(sesi && sesi.utama));
    if (sesi && sesi.utama) muatPengelola();
    muatDaftar();
    lanjutkanBilaAda();
  }

  function keluar(alasan) {
    simpan('warta-kunci', null); simpan('warta-sesi', null);
    kunci = null; sesi = null;
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (_) {}
    tutupMuat();
    tampil($('bagian-panel'), false); tampil($('bagian-masuk'), true);
    pesan($(lewatPenjaga ? 'galat-google' : 'galat-masuk'), alasan || '');
    if (lewatPenjaga) siapkanGoogle();
  }
  $('tbl-keluar').addEventListener('click', function () { keluar(''); });

  // --- Google ---
  var googleSiap = false;
  function siapkanGoogle() {
    function pasang() {
      if (!googleSiap) {
        google.accounts.id.initialize({ client_id: C.google, callback: terimaGoogle, ux_mode: 'popup', auto_select: false });
        googleSiap = true;
      }
      $('tombol-google').textContent = '';
      google.accounts.id.renderButton($('tombol-google'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'id', width: 280 });
    }
    if (window.google && google.accounts && google.accounts.id) return pasang();
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = pasang;
    s.onerror = function () { pesan($('galat-google'), 'Tombol Google gagal dimuat. Periksa sambungan internet, lalu muat ulang halaman.'); };
    document.head.appendChild(s);
  }
  function terimaGoogle(jawaban) {
    pesan($('galat-google'), '');
    $('tombol-google').classList.add('sibuk');
    panggil('masuk', { kredensial: jawaban.credential }).then(function (j) {
      sesi = { sesi: j.sesi, email: j.email, utama: j.utama };
      simpan('warta-sesi', JSON.stringify(sesi));
      bukaPanel();
    }).catch(function (g) { pesan($('galat-google'), manusiawi(g)); })
      .then(function () { $('tombol-google').classList.remove('sibuk'); });
  }

  // --- kunci (cadangan) ---
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
  $('form-masuk').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var k = $('kunci').value.trim(), tbl = this.querySelector('button');
    pesan($('galat-masuk'), '');
    tbl.disabled = true; tbl.textContent = 'Memeriksa…';
    periksaKunci(k).then(function () { simpan('warta-kunci', k); $('kunci').value = ''; bukaPanel(); })
      .catch(function (g) { kunci = null; pesan($('galat-masuk'), g.message === 'Failed to fetch' ? 'Tidak bisa menghubungi server. Periksa sambungan internet.' : g.message); })
      .then(function () { tbl.disabled = false; tbl.textContent = 'Masuk'; });
  });

  /* ================= Laman 1: formulir unggah ================= */

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
        if (berkas.size > B.batasPdf) return pesan(galat, 'PDF ini ' + mb(berkas.size) + ', melebihi batas unggah langsung (' + mb(B.batasPdf) + '). Unggah ke Google Drive, lalu tempel tautannya di kolom di bawahnya.');
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

  /* ================= Laman 2: layar kemajuan ================= */

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

  function jalankan(tugas, lampiran) {
    var kode = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    var hapus = tugas.aksi === 'hapus';
    layarMuat('Langkah 1 dari 2', lampiran ? 'Mengunggah ke server' : 'Mengirim ke server', 'Jangan tutup atau tinggalkan halaman ini.');
    var awal = Promise.resolve();
    if (lampiran) {
      // Byte PDF memakai rentang 0–90; sisanya menunggu server menyimpan dan mencatat perintah
      awal = bacaBerkas(lampiran).then(function (b64) {
        return B.taruh(kode + '.pdf', b64, 'Unggah PDF', function (f) {
          setPersen(f * 90, f < 1 ? mb(f * lampiran.size) + ' dari ' + mb(lampiran.size) : 'Menyimpan di server');
        });
      });
    }
    awal.then(function () {
      if (lampiran) setPersen(96, 'Mencatat perintah terbit');
      return B.taruh(kode + '.json', b64teks(JSON.stringify(tugas)), hapus ? 'Hapus terbitan' : 'Terbitan baru',
        lampiran ? null : function (f) { setPersen(f * 90, ''); });
    }).then(function (j) {
      setPersen(100, 'Diterima server');
      try { history.replaceState(null, '', '#proses=' + kode + '.' + j.sha + '.' + (hapus ? 'h' : 't')); } catch (_) {}
      return tunggu(700).then(function () { return pantau(j.sha, hapus); });
    }).catch(function (g) { muatGagal(manusiawi(g)); });
  }

  // Langkah 2: baca laporan server sampai selesai
  function pantau(sha, hapus) {
    layarMuat('Langkah 2 dari 2', hapus ? 'Menghapus dari arsip' : 'Mengubah jadi flipbook',
      'Dikerjakan server. Halaman ini boleh dibiarkan terbuka; biasanya 1–3 menit.');
    var mulai = Date.now(), galatBeruntun = 0;

    function putar() {
      if (Date.now() - mulai > 15 * 60000) throw new Error('Server belum selesai setelah 15 menit. Muat ulang halaman ini nanti untuk melihat kelanjutannya.');
      return B.status(sha).then(function (s) {
        galatBeruntun = 0;
        if (!s.keadaan) {   // belum ada laporan: masih antre atau server baru menyala
          setPersen(s.antre === 'in_progress' ? 3 : (s.antre ? 2 : 1), s.antre === 'in_progress' ? 'Server menyala' : 'Menunggu giliran di server');
          return tunggu(2500).then(putar);
        }
        if (s.keadaan === 'failure' || s.keadaan === 'error') throw new Error(s.pesan || 'Server gagal memproses.');
        if (s.keadaan === 'success') { setPersen(100, 'Selesai'); return s; }
        setPersen(s.persen, s.pesan);
        return tunggu(2000).then(putar);
      }, function (g) {
        if (!sesi && !kunci) throw g;            // sudah dikeluarkan (sesi berakhir)
        if (++galatBeruntun > 8) throw g;        // sambungan putus sebentar: coba lagi dulu
        $('muat-rinci').textContent = 'Sambungan terputus, mencoba lagi…';
        return tunggu(4000).then(putar);
      });
    }

    return putar().then(function (s) {
      if (hapus) {
        return tunggu(1200).then(function () { tutupMuat(); muatDaftar(); pesan($('pesan-daftar'), 'Terbitan sudah dihapus.'); });
      }
      var slug = (/\/e\/([^/]+)\/?$/.exec(s.url || '') || [])[1];
      if (!slug) { tutupMuat(); muatDaftar(); return; }
      $('muat-rinci').textContent = 'Membuka flipbook…';
      return tungguTayang(slug).then(function () {
        try { history.replaceState(null, '', location.pathname); } catch (_) {}
        // Laman 3: flipbook-nya sendiri, dengan lembar bagikan terbuka
        location.href = '../e/' + encodeURIComponent(slug) + '/?baru=1';
      });
    }).catch(function (g) { if (sesi || kunci) muatGagal(manusiawi(g)); });
  }

  // Pastikan halaman barunya sudah benar-benar bisa dibuka sebelum pindah
  // Alamat persis yang nanti dibagikan (tanpa ?t=), supaya yang dicek adalah salinan di CDN yang juga
  // akan dibaca WhatsApp. Lalu jeda sebentar agar server CDN lain ikut segar sebelum tautan dibagikan;
  // kalau WhatsApp keburu membaca versi lama, pratinjaunya kosong dan tersimpan di WA.
  function tungguTayang(slug) {
    var mulai = Date.now(), url = '../e/' + encodeURIComponent(slug) + '/';
    function cek() {
      return fetch(url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; })
        .then(function (isi) {
          if (isi.indexOf('og:image') >= 0) {
            $('muat-rinci').textContent = 'Menyiapkan pratinjau tautan…';
            return tunggu(25000).then(function () { return true; });
          }
          if (Date.now() - mulai > 4 * 60000) return false;
          return tunggu(4000).then(cek);
        });
    }
    return cek();
  }

  // Halaman dimuat ulang saat server masih bekerja: lanjutkan pemantauan
  function lanjutkanBilaAda() {
    var m = /#proses=[\w-]+\.([0-9a-f]{40})\.([ht])/.exec(location.hash);
    if (m) pantau(m[1], m[2] === 'h');
  }

  /* ================= Daftar terbitan ================= */

  function salin(teks, tbl) {
    var beres = function () { tbl.textContent = 'Tautan tersalin'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(teks).then(beres, function () { prompt('Salin tautan ini:', teks); });
    else prompt('Salin tautan ini:', teks);
  }

  function muatDaftar() {
    var ul = $('daftar-terbit'), info = $('pesan-daftar');
    B.daftar().then(function (daftar) {
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
    }).catch(function (g) { if (sesi || kunci) pesan(info, g.message === 'Failed to fetch' ? 'Daftar gagal dimuat. Periksa sambungan internet.' : g.message); });
  }

  /* ================= Daftar pengelola (hanya admin utama) ================= */

  function gambarPengelola(d) {
    var ul = $('daftar-pengelola');
    ul.textContent = '';
    d.utama.forEach(function (e) {
      var li = document.createElement('li'), isi = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span');
      b.textContent = e; s.textContent = 'Admin utama';
      isi.appendChild(b); isi.appendChild(s); li.appendChild(isi); ul.appendChild(li);
    });
    d.lain.forEach(function (p) {
      var li = document.createElement('li'), isi = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span');
      var alat = document.createElement('div'), cabut = document.createElement('button');
      b.textContent = p.email; s.textContent = 'Pengelola' + (p.sejak ? ' · sejak ' + p.sejak : '');
      cabut.type = 'button'; cabut.className = 'bahaya'; cabut.textContent = 'Cabut akses';
      cabut.addEventListener('click', function () {
        if (!confirm('Cabut akses ' + p.email + '?\nIa langsung tidak bisa lagi mengunggah atau menghapus.')) return;
        ubahPengelola('hapus', p.email);
      });
      alat.className = 'alat'; alat.appendChild(cabut);
      isi.appendChild(b); isi.appendChild(s); li.appendChild(isi); li.appendChild(alat); ul.appendChild(li);
    });
  }
  function muatPengelola() {
    panggil('pengelola').then(gambarPengelola).catch(function (g) { if (sesi) pesan($('galat-pengelola'), manusiawi(g)); });
  }
  function ubahPengelola(ubah, email) {
    pesan($('galat-pengelola'), '');
    return panggil('pengelola', { ubah: ubah, email: email }).then(gambarPengelola)
      .catch(function (g) { if (sesi) pesan($('galat-pengelola'), manusiawi(g)); throw g; });
  }
  $('form-pengelola').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var kotak = $('email-pengelola'), email = kotak.value.trim().toLowerCase(), tbl = this.querySelector('button');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return pesan($('galat-pengelola'), 'Tulis alamat email Google yang lengkap, misalnya nama@gmail.com.');
    tbl.disabled = true;
    ubahPengelola('tambah', email).then(function () { kotak.value = ''; }, function () {})
      .then(function () { tbl.disabled = false; });
  });

  /* ================= Mulai ================= */

  if (!C.repo) { tampil($('bagian-belum'), true); return; }
  $('nama-repo').textContent = C.repo;
  aturIsian();
  tampil($('masuk-google'), lewatPenjaga);
  tampil($('masuk-kunci'), !lewatPenjaga);

  if (lewatPenjaga) {
    try { sesi = JSON.parse(ingat('warta-sesi') || 'null'); } catch (_) { sesi = null; }
    if (sesi && sesi.sesi) {
      panggil('saya').then(function (j) {
        sesi.email = j.email; sesi.utama = j.utama;
        simpan('warta-sesi', JSON.stringify(sesi));
        bukaPanel();
      }, function (g) {
        if (sesi) { sesi = null; tampil($('bagian-masuk'), true); siapkanGoogle(); pesan($('galat-google'), manusiawi(g)); }
      });
    } else {
      sesi = null;
      tampil($('bagian-masuk'), true);
      siapkanGoogle();
    }
  } else {
    var lama = ingat('warta-kunci');
    if (lama) {
      periksaKunci(lama).then(bukaPanel, function () {
        kunci = null; tampil($('bagian-masuk'), true);
        pesan($('galat-masuk'), 'Kunci yang tersimpan tidak berlaku lagi. Tempel kunci baru.');
      });
    } else {
      tampil($('bagian-masuk'), true);
    }
  }
})();
