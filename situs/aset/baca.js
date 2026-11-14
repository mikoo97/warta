/* Warta Flipbook — halaman baca.
   Tanpa skrip ini halaman tetap terbaca (ditumpuk dan digulir). */
(function () {
  'use strict';
  if (!window.St || !St.PageFlip) return;

  var D = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var akar = document.documentElement;
  var panggung = $('panggung'), lensa = $('lensa'), buku = $('buku');
  var halaman = [].slice.call(buku.querySelectorAll('.hal'));
  var gambar = halaman.map(function (h) { return h.querySelector('img'); });
  var N = halaman.length;
  var rasio = D.l / D.t;
  var sentuh = matchMedia('(pointer: coarse)').matches;
  var hemat = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function jepit(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function simpan(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function ambil(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  var awal = (function () {
    var m = /h=(\d+)/.exec(location.hash);
    return m ? jepit(+m[1], 1, N) - 1 : 0;
  })();

  akar.classList.add('siap');
  window.scrollTo(0, 0);

  /* ---------- Buku ---------- */

  // Satu halaman (HP tegak) atau dua halaman terbuka (layar lebar)?
  // Tinggi buku dibuat pas dengan tinggi halaman; pustaka mengandaikan buku menempel di tepi atas wadahnya.
  function aturMode() {
    var cs = getComputedStyle(lensa);
    var w = lensa.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = lensa.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var satu = Math.min(w, h * rasio), dua = Math.min(w / 2, h * rasio);
    var tunggal = !(w >= 560 && dua >= satu * 0.72);
    buku.style.height = Math.floor((tunggal ? satu : dua) / rasio) + 'px';
    atur.minWidth = tunggal ? 1e6 : 1;
  }

  var pf = new St.PageFlip(buku, {
    width: D.l, height: D.t, size: 'stretch',
    minWidth: 1, maxWidth: 8000, minHeight: 1, maxHeight: 12000,
    autoSize: false, showCover: true, usePortrait: true,
    drawShadow: true, maxShadowOpacity: 0.3, flippingTime: hemat ? 200 : 900,
    mobileScrollSupport: false, swipeDistance: 28, showPageCorners: !sentuh,
    disableFlipByClick: true, startPage: awal, startZIndex: 1
  });
  var atur = pf.getSettings();
  // Pustaka menolak flipNext/flipPrev di beberapa posisi bila disableFlipByClick aktif; matikan sesaat.
  ['flipNext', 'flipPrev'].forEach(function (n) {
    var asli = pf[n].bind(pf);
    pf[n] = function (sudut) {
      atur.disableFlipByClick = false;
      try { asli(sudut); } finally { atur.disableFlipByClick = true; }
    };
  });

  // Didaftarkan sebelum pustaka memasang pendengarnya sendiri, supaya jalan lebih dulu
  window.addEventListener('resize', function () { aturMode(); zoomKe(1); });
  aturMode();
  pf.loadFromHTML(halaman);

  // Semua halaman lentur, termasuk sampul: warta adalah buklet kertas, bukan buku bersampul keras.
  // (Pustaka mengeraskan sampul tiap kali menyusun ulang halaman, jadi dilenturkan lagi sesudahnya.)
  var koleksi = pf.getPageCollection();
  function lenturkan() {
    for (var i = 0; i < N; i++) { var h = pf.getPage(i); h.setDensity('soft'); h.setDrawingDensity('soft'); }
  }
  var susunAsli = koleksi.createSpread.bind(koleksi);
  koleksi.createSpread = function () { susunAsli(); lenturkan(); };
  lenturkan();

  // Animasi balik: lamanya sama di semua ukuran layar, mulai pelan dan mendarat pelan
  var LAMA = hemat ? 200 : 900;
  var mesin = pf.getRender(), animasiAsli = mesin.startAnimation.bind(mesin);
  mesin.startAnimation = function (bingkai, lama, selesai) {
    var n = bingkai.length;
    if (n > 2 && !hemat) {
      lama = Math.max(260, Math.min(1, n / (2 * pf.getBoundsRect().pageWidth)) * LAMA);
      var jumlah = Math.max(2, Math.round(lama / 8)), halus = [];
      for (var k = 0; k < jumlah; k++) {
        var t = k / (jumlah - 1);
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        halus.push(bingkai[Math.min(n - 1, Math.round(e * (n - 1)))]);
      }
      bingkai = halus;
    }
    animasiAsli(bingkai, lama, selesai);
  };
  buku.style.setProperty('--balik', LAMA + 'ms');

  function tegak() { return pf.getOrientation() === 'portrait'; }
  function indeks() { return pf.getCurrentPageIndex(); }

  // Halaman yang sedang tampak (indeks 0..N-1)
  function tampak(i) {
    if (i == null) i = indeks();
    if (tegak() || i === 0) return [i];
    var a = i % 2 ? i : i - 1;
    return a + 1 < N ? [a, a + 1] : [a];
  }

  // Muat gambar halaman di sekitar posisi sekarang sebelum dibutuhkan
  function muatSekitar() {
    var i = indeks();
    for (var k = Math.max(0, i - 2); k <= Math.min(N - 1, i + 4); k++) {
      var g = gambar[k];
      if (g.loading !== 'eager') {
        g.loading = 'eager';
        if (!g.complete) { var p = new Image(); p.src = g.getAttribute('src'); }
      }
    }
  }

  // Ganti ke gambar tajam ketika diperbesar
  function tajamkan() {
    tampak().forEach(function (k) {
      var g = gambar[k];
      if (!g || g.dataset.tajam) return;
      g.dataset.tajam = '1';
      var p = new Image();
      p.onload = function () { g.src = p.src; };
      p.onerror = function () { delete g.dataset.tajam; };
      p.src = g.dataset.b;
    });
  }

  // Di layar lebar, sampul (dan halaman terakhir yang sendirian) digeser ke tengah
  function geserBuku(untuk) {
    var x = 0;
    if (!tegak()) {
      var pw = pf.getBoundsRect().pageWidth;
      if (untuk === 0) x = -pw / 2;
      else if (N % 2 === 0 && untuk >= N - 1) x = pw / 2;
    }
    buku.style.transform = x ? 'translateX(' + x + 'px)' : '';
  }

  var penggeser = $('penggeser'), nomor = $('nomor');
  var tblSblm = [$('tbl-sblm'), $('panah-sblm')], tblBrkt = [$('tbl-brkt'), $('panah-brkt')];

  function segarkan() {
    var i = indeks(), t = tampak(i);
    nomor.textContent = (t.length > 1 ? (t[0] + 1) + '–' + (t[1] + 1) : (t[0] + 1)) + ' / ' + N;
    penggeser.value = i + 1;
    penggeser.setAttribute('aria-valuetext', 'Halaman ' + (i + 1) + ' dari ' + N);
    tblSblm.forEach(function (b) { b.disabled = t[0] === 0; });
    tblBrkt.forEach(function (b) { b.disabled = t[t.length - 1] === N - 1; });
    geserBuku(i);
    muatSekitar();
    if (z.s > 1.3) tajamkan();
    try { history.replaceState(null, '', i ? '#h=' + (i + 1) : location.pathname + location.search); } catch (_) {}
  }

  pf.on('flip', function () { segarkan(); tutupPetunjuk(); });
  pf.on('changeOrientation', function () { segarkan(); });
  pf.on('changeState', function (e) {
    // Mulai membalik: geser buku ke posisi tujuan bersamaan dengan animasi
    if (e.data !== 'flipping' && e.data !== 'user_fold') { if (e.data === 'read') geserBuku(indeks()); return; }
    try {
      var c = pf.getFlipController().calc;
      if (!c || tegak()) return;
      var t = tampak();
      geserBuku(c.getDirection() === 0 ? Math.min(N - 1, t[t.length - 1] + 1) : Math.max(0, t[0] - 1));
    } catch (_) {}
  });

  function maju() { if (z.s > 1) zoomKe(1); pf.flipNext(); }
  function mundur() { if (z.s > 1) zoomKe(1); pf.flipPrev(); }
  function ke(i) { if (z.s > 1) zoomKe(1); pf.turnToPage(jepit(i, 0, N - 1)); }

  tblSblm.forEach(function (b) { b.addEventListener('click', mundur); });
  tblBrkt.forEach(function (b) { b.addEventListener('click', maju); });
  penggeser.addEventListener('input', function () { ke(+penggeser.value - 1); });

  /* ---------- Perbesar / geser ---------- */

  var z = { s: 1, x: 0, y: 0 };
  var Z_MAKS = 5, Z_KETUK = 2.4;
  var tblZoom = $('tbl-zoom');

  function terapZoom(halus) {
    lensa.style.transition = halus && !hemat ? 'transform .22s ease' : '';
    lensa.style.transform = z.s === 1 ? '' : 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
    var besar = z.s > 1;
    if (akar.classList.contains('zoom') !== besar) {
      akar.classList.toggle('zoom', besar);
      tblZoom.setAttribute('aria-pressed', besar);
      tblZoom.lastElementChild.textContent = besar ? 'Perkecil' : 'Perbesar';
    }
  }
  function batasi() {
    var W = panggung.clientWidth, H = panggung.clientHeight;
    z.x = jepit(z.x, W - W * z.s, 0);
    z.y = jepit(z.y, H - H * z.s, 0);
  }
  function zoomKe(s, px, py, halus) {
    s = jepit(s, 1, Z_MAKS);
    if (s === z.s && s === 1) return;
    if (px == null) { px = panggung.clientWidth / 2; py = panggung.clientHeight / 2; }
    var k = s / z.s;
    z.x = px - (px - z.x) * k;
    z.y = py - (py - z.y) * k;
    z.s = s;
    if (s === 1) { z.x = 0; z.y = 0; }
    batasi();
    terapZoom(halus);
    if (s > 1.3) tajamkan();
  }
  function titik(t) {
    var r = panggung.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  tblZoom.addEventListener('click', function () {
    if (z.s > 1) zoomKe(1, null, null, true);
    else zoomKe(Z_KETUK, panggung.clientWidth / 2, panggung.clientHeight * 0.3, true);
  });

  // Hentikan lipatan yang sedang dipegang pustaka (dipakai saat jari kedua menyentuh layar)
  function lepasBalik() {
    try {
      pf.getUI().touchPoint = null;
      if (pf.isUserTouch) {
        if (pf.isUserMove) pf.userStop({ x: 0, y: 0 }, false);
        else pf.isUserTouch = false;
      }
    } catch (_) {}
  }

  var g = null;          // gerakan yang sedang berlangsung
  var ketukLalu = null;  // untuk ketuk dua kali

  function ketuk(p) {
    var W = panggung.clientWidth, kini = Date.now();
    var dobel = ketukLalu && kini - ketukLalu.t < 330 && Math.abs(p.x - ketukLalu.x) < 36 && Math.abs(p.y - ketukLalu.y) < 36;
    if (z.s > 1) {
      if (dobel) { zoomKe(1, null, null, true); ketukLalu = null; } else ketukLalu = { x: p.x, y: p.y, t: kini };
      return;
    }
    if (p.x < W * 0.16) { ketukLalu = null; mundur(); return; }
    if (p.x > W * 0.84) { ketukLalu = null; maju(); return; }
    if (dobel) { zoomKe(Z_KETUK, p.x, p.y, true); ketukLalu = null; tutupPetunjuk(); }
    else ketukLalu = { x: p.x, y: p.y, t: kini };
  }

  function jarak(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  function tengah(t) { return titik({ clientX: (t[0].clientX + t[1].clientX) / 2, clientY: (t[0].clientY + t[1].clientY) / 2 }); }

  panggung.addEventListener('touchstart', function (e) {
    if (e.target.closest('button')) return;
    var t = e.touches;
    if (t.length >= 2) {
      lepasBalik();
      var c = tengah(t);
      g = { jenis: 'cubit', d0: jarak(t) || 1, s0: z.s, cx: c.x, cy: c.y, x0: z.x, y0: z.y };
      e.stopPropagation(); e.preventDefault();
      return;
    }
    var p = titik(t[0]);
    g = { jenis: z.s > 1 ? 'geser' : 'baca', x: p.x, y: p.y, x0: z.x, y0: z.y, t: Date.now(), jauh: 0 };
    if (z.s > 1) { e.stopPropagation(); e.preventDefault(); }
  }, { capture: true, passive: false });

  panggung.addEventListener('touchmove', function (e) {
    if (!g) return;
    var t = e.touches;
    if (g.jenis === 'cubit') {
      if (t.length >= 2) {
        var c = tengah(t), s = jepit(g.s0 * jarak(t) / g.d0, 1, Z_MAKS), k = s / g.s0;
        z.s = s; z.x = c.x - (g.cx - g.x0) * k; z.y = c.y - (g.cy - g.y0) * k;
        batasi(); terapZoom();
      }
      e.stopPropagation(); e.preventDefault();
      return;
    }
    var p = titik(t[0]);
    g.jauh = Math.max(g.jauh, Math.abs(p.x - g.x), Math.abs(p.y - g.y));
    if (g.jenis === 'geser') {
      z.x = g.x0 + p.x - g.x; z.y = g.y0 + p.y - g.y;
      batasi(); terapZoom();
      e.stopPropagation(); e.preventDefault();
    }
  }, { capture: true, passive: false });

  function akhirSentuh(e) {
    if (!g) return;
    if (g.jenis === 'cubit') {
      e.stopPropagation();
      if (e.touches.length === 0) {
        if (z.s < 1.08) zoomKe(1, null, null, true); else tajamkan();
        g = null;
      }
      return;
    }
    var tap = g.jauh < 10 && Date.now() - g.t < 300;
    var p = { x: g.x, y: g.y };
    if (g.jenis === 'geser') e.stopPropagation();
    g = null;
    if (tap && e.type === 'touchend') ketuk(p);
  }
  panggung.addEventListener('touchend', akhirSentuh, true);
  panggung.addEventListener('touchcancel', akhirSentuh, true);

  // Tetikus
  var seret = null;
  panggung.addEventListener('mousedown', function (e) {
    if (z.s <= 1 || e.button !== 0 || e.target.closest('button')) return;
    seret = { x: e.clientX, y: e.clientY, x0: z.x, y0: z.y };
    panggung.classList.add('seret');
    e.stopPropagation(); e.preventDefault();
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (seret) {
      z.x = seret.x0 + e.clientX - seret.x; z.y = seret.y0 + e.clientY - seret.y;
      batasi(); terapZoom();
    }
    if (z.s > 1) e.stopPropagation();
  }, true);
  window.addEventListener('mouseup', function (e) {
    if (!seret) return;
    seret = null; panggung.classList.remove('seret');
    e.stopPropagation();
  }, true);
  panggung.addEventListener('dblclick', function (e) {
    if (e.target.closest('button')) return;
    var p = titik(e);
    if (z.s > 1) zoomKe(1, null, null, true); else zoomKe(Z_KETUK, p.x, p.y, true);
    tutupPetunjuk();
  });
  var rodaLalu = 0;
  panggung.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = titik(e);
    if (e.ctrlKey || e.metaKey) { zoomKe(z.s * Math.exp(-e.deltaY * 0.01), p.x, p.y); return; }
    if (z.s > 1) { z.x -= e.deltaX; z.y -= e.deltaY; batasi(); terapZoom(); return; }
    var kini = Date.now();
    if (Math.abs(e.deltaY) < 12 || kini - rodaLalu < 650) return;
    rodaLalu = kini;
    if (e.deltaY > 0) maju(); else mundur();
  }, { passive: false });

  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]') || e.target === penggeser || e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': maju(); break;
      case 'ArrowLeft': case 'PageUp': mundur(); break;
      case 'Home': ke(0); break;
      case 'End': ke(N - 1); break;
      case '+': case '=': zoomKe(z.s * 1.4, null, null, true); break;
      case '-': zoomKe(z.s / 1.4, null, null, true); break;
      case '0': case 'Escape': zoomKe(1, null, null, true); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------- Lembar: daftar halaman & bagikan ---------- */

  var lembarHal = $('lembar-hal'), lembarBagi = $('lembar-bagi'), lembarUnduh = $('lembar-unduh');
  [lembarHal, lembarBagi, lembarUnduh].forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-tutup]')) d.close();
    });
  });

  $('tbl-hal').addEventListener('click', function () {
    var t = tampak();
    [].forEach.call(lembarHal.querySelectorAll('[data-ke]'), function (b) {
      var kini = t.indexOf(+b.dataset.ke - 1) >= 0;
      if (kini) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    lembarHal.showModal();
    var s = lembarHal.querySelector('[aria-current]');
    if (s) { s.scrollIntoView({ block: 'center' }); s.focus({ preventScroll: true }); }
  });
  lembarHal.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ke]');
    if (!b) return;
    lembarHal.close();
    ke(+b.dataset.ke - 1);
  });

  // Album foto: unduh JPG asli (dari Google Drive) untuk foto yang sedang dibuka
  if (D.jenis === 'album') {
    var unduhFoto = function (g) {
      var a = document.createElement('a');
      a.href = g.dataset.u; a.download = g.dataset.n || ''; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    };
    $('tbl-unduh').addEventListener('click', function () {
      var t = tampak();
      if (t.length === 1) { unduhFoto(gambar[t[0]]); return; }
      var wadah = $('unduh-pilihan');
      wadah.textContent = '';
      t.forEach(function (k) {
        var g = gambar[k], b = document.createElement('button'), im = new Image(), nama = document.createElement('small');
        b.type = 'button';
        im.referrerPolicy = 'no-referrer'; im.alt = '';
        im.src = g.getAttribute('src').replace(/=s\d+$/, '=s240');
        nama.textContent = g.dataset.n || '';
        b.appendChild(im); b.appendChild(document.createTextNode('Foto ' + (k + 1))); b.appendChild(nama);
        b.addEventListener('click', function () { lembarUnduh.close(); unduhFoto(g); });
        wadah.appendChild(b);
      });
      lembarUnduh.showModal();
    });
    // Foto dari Drive kadang gagal dimuat sesaat; coba lagi dua kali
    gambar.forEach(function (g) {
      var coba = 0;
      g.addEventListener('error', function () {
        if (coba++ >= 2) return;
        var src = g.getAttribute('src');
        setTimeout(function () { g.src = src; }, 1500 * coba);
      });
    });
  }

  var tautan = location.origin + location.pathname;
  var pesan = D.judul;
  function bukaBagi(lembarSaja) {
    if (navigator.share && sentuh && !lembarSaja) {
      navigator.share({ title: D.judul, url: tautan }).catch(function () {});
      return;
    }
    $('bagi-wa').href = 'https://wa.me/?text=' + encodeURIComponent(pesan + '\n' + tautan);
    $('bagi-url').textContent = tautan;
    $('bagi-salin').textContent = 'Salin tautan';
    lembarBagi.showModal();
  }
  $('tbl-bagi').addEventListener('click', function () { bukaBagi(false); });
  // Datang dari panel pengelola setelah terbit: langsung tawarkan untuk dibagikan
  if (/[?&]baru=1/.test(location.search)) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {}
    $('jdl-bagi').textContent = 'Sudah terbit. Bagikan sekarang';
    bukaBagi(true);
  }
  $('bagi-salin').addEventListener('click', function () {
    var tbl = this;
    function beres() { tbl.textContent = 'Tautan tersalin'; }
    function manual() {
      var r = document.createRange(); r.selectNodeContents($('bagi-url'));
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { if (document.execCommand('copy')) beres(); } catch (_) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tautan).then(beres, manual);
    else manual();
  });

  // Layar penuh. Browser tidak mengizinkan layar penuh tanpa sentuhan, jadi sentuhan/klik pertama
  // di halaman langsung memicunya. Kalau pembaca keluar sendiri, tidak dipaksa masuk lagi.
  var tblLayar = $('tbl-layar');
  var mintaPenuh = akar.requestFullscreen || akar.webkitRequestFullscreen;
  var keluarPenuh = document.exitFullscreen || document.webkitExitFullscreen;
  function sedangPenuh() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function masukPenuh() {
    try {
      var janji = mintaPenuh.call(akar, { navigationUI: 'hide' });
      if (janji && janji.catch) janji.catch(function () {});
    } catch (_) {}
  }
  if (mintaPenuh && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    tblLayar.hidden = false;
    tblLayar.addEventListener('click', function () {
      if (sedangPenuh()) keluarPenuh.call(document); else masukPenuh();
    });
    var otomatis = true;
    var pertama = function (e) {
      if (!otomatis) return;
      if (e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Tab' || e.altKey || e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      if (t && t.closest && t.closest('a[href], dialog, #tbl-layar')) return;  // tautan pindah halaman; lembar; tombolnya sendiri
      otomatis = false;
      if (!sedangPenuh()) masukPenuh();
    };
    ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (n) { window.addEventListener(n, pertama, true); });
    var ganti = function () {
      var penuh = sedangPenuh();
      if (penuh) otomatis = false;
      tblLayar.setAttribute('aria-label', penuh ? 'Keluar dari layar penuh' : 'Layar penuh');
      tblLayar.classList.toggle('aktif', penuh);
    };
    document.addEventListener('fullscreenchange', ganti);
    document.addEventListener('webkitfullscreenchange', ganti);
  }

  /* ---------- Petunjuk singkat untuk beberapa kunjungan pertama ---------- */

  var petunjuk = $('petunjuk'), jam = 0;
  function tutupPetunjuk() { if (!petunjuk.hidden) { petunjuk.hidden = true; clearTimeout(jam); } }
  var kali = +(ambil('warta-petunjuk') || 0);
  if (kali < 3 && N > 1) {
    petunjuk.textContent = sentuh
      ? 'Geser untuk membalik halaman · ketuk dua kali untuk memperbesar'
      : 'Klik panah atau seret sudut halaman · klik dua kali untuk memperbesar';
    petunjuk.hidden = false;
    simpan('warta-petunjuk', kali + 1);
    jam = setTimeout(tutupPetunjuk, 7000);
  }

  segarkan();
})();
