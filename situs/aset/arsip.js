/* Warta Flipbook — beranda: saring arsip dan cari isi semua terbitan. */
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var daftar = $('daftar'), hasil = $('hasil-cari'), kotak = $('kotak-cari');
  var pilih = $('pilih-tahun'), kosong = $('kosong');
  var jenis = '', tahun = '';

  function saring() {
    var ada = 0;
    [].forEach.call(daftar.querySelectorAll('.bulan'), function (b) {
      var n = 0, cocok = !tahun || b.dataset.tahun === tahun;
      [].forEach.call(b.querySelectorAll('.baris'), function (r) {
        var ok = cocok && (!jenis || r.dataset.jenis === jenis);
        r.hidden = !ok;
        if (ok) n++;
      });
      b.hidden = !n;
      ada += n;
    });
    kosong.hidden = ada > 0 || !hasil.hidden;
  }

  [].forEach.call(document.querySelectorAll('.keping button'), function (b) {
    b.addEventListener('click', function () {
      jenis = b.dataset.jenis;
      [].forEach.call(b.parentNode.children, function (x) { x.setAttribute('aria-pressed', x === b); });
      segarkan();
    });
  });
  pilih.addEventListener('change', function () { tahun = pilih.value; segarkan(); });

  /* ---------- Pencarian: indeks per tahun, dimuat saat pertama kali dipakai ---------- */

  var indeks = {};
  function muat(th) {
    return indeks[th] || (indeks[th] = fetch('data/cari-' + th + '.txt')
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        if (!t) return [];
        var biner = atob(t.trim()), bita = new Uint8Array(biner.length);
        for (var i = 0; i < biner.length; i++) bita[i] = biner.charCodeAt(i);
        return JSON.parse(new TextDecoder().decode(bita));
      })
      .catch(function () { delete indeks[th]; return null; }));
  }
  function aman(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function cuplik(teks, pos, pj) {
    var a = Math.max(0, pos - 60), b = Math.min(teks.length, pos + pj + 100);
    while (a > 0 && teks[a] !== ' ') a--;
    while (b < teks.length && teks[b] !== ' ') b++;
    return (a > 0 ? '… ' : '') + aman(teks.slice(a, pos)) + '<mark>' + aman(teks.slice(pos, pos + pj)) + '</mark>' +
      aman(teks.slice(pos + pj, b)) + (b < teks.length ? ' …' : '');
  }

  var giliran = 0;
  function cari() {
    var q = kotak.value.trim().replace(/\s+/g, ' ');
    if (q.length < 2) {
      hasil.hidden = true; daftar.hidden = false;
      saring();
      return;
    }
    var no = ++giliran, kata = q.toLowerCase();
    var ths = tahun ? [+tahun] : D.tahun;
    hasil.hidden = false; daftar.hidden = true; kosong.hidden = true;
    if (!hasil.firstChild) hasil.innerHTML = '<p class="hasil-info">Mencari…</p>';

    Promise.all(ths.map(muat)).then(function (semua) {
      if (no !== giliran) return;
      if (semua.some(function (x) { return x === null; })) {
        hasil.innerHTML = '<p class="hasil-info">Pencarian gagal dimuat. Periksa sambungan internet, lalu ketik ulang.</p>';
        return;
      }
      var temuan = [];
      semua.forEach(function (arr) {
        arr.forEach(function (ed) {
          var info = D.edisi[ed.s];
          if (!info || (jenis && info[2] !== jenis)) return;
          ed.h.forEach(function (teks, i) {
            var pos = teks.toLowerCase().indexOf(kata);
            if (pos >= 0) temuan.push({ s: ed.s, judul: info[0], hal: i + 1, teks: teks, pos: pos });
          });
        });
      });
      if (!temuan.length) {
        hasil.innerHTML = '<p class="hasil-info">Tidak ada halaman yang memuat “' + aman(q) + '”. Coba kata lain atau ejaan lain.</p>';
        return;
      }
      var batas = 80, tampil = temuan.slice(0, batas);
      hasil.innerHTML = '<p class="hasil-info">' + temuan.length + ' halaman memuat “' + aman(q) + '”' +
        (temuan.length > batas ? ' — menampilkan ' + batas + ' yang terbaru' : '') + '</p><ul>' +
        tampil.map(function (t) {
          return '<li><a href="e/' + encodeURIComponent(t.s) + '/#h=' + t.hal + '"><b>' + aman(t.judul) +
            '</b><span class="hal-ke">halaman ' + t.hal + '</span><p>' + cuplik(t.teks, t.pos, kata.length) + '</p></a></li>';
        }).join('') + '</ul>';
    });
  }

  var tunda = 0;
  function segarkan() {
    clearTimeout(tunda);
    if (kotak.value.trim().length >= 2) cari(); else { hasil.hidden = true; hasil.innerHTML = ''; daftar.hidden = false; saring(); }
  }
  kotak.addEventListener('input', function () { clearTimeout(tunda); tunda = setTimeout(segarkan, 200); });
})();
