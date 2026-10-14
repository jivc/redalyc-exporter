// ==UserScript==
// @name         Redalyc Exporter
// @namespace    https://juliovega.org
// @version      1.0.0
// @description  Exporta los resultados de búsqueda de Redalyc a RIS, BibTeX o CSV, con resumen, palabras clave y DOI.
// @author       Julio Isaac Vega-Cauich
// @license      MIT
// @match        https://www.redalyc.org/busquedaArticulo*
// @match        https://redalyc.org/busquedaArticulo*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Julio Isaac Vega-Cauich
/*
 * Exportador de resultados de Redalyc a RIS, BibTeX y CSV
 * Versión 1.0.0 (octubre de 2026)
 *
 * Lee la búsqueda y los filtros activos en la página de resultados de
 * redalyc.org, recorre todas las páginas del servicio interno que usa el
 * propio buscador (service/r2020/getArticles) y genera un archivo de
 * referencias con título, autores, año, revista, volumen, número, páginas,
 * ISSN, DOI, idioma, resumen, palabras clave y enlaces al artículo y al PDF.
 *
 * Funciona como marcador (bookmarklet), como extensión (Chrome/Firefox,
 * content script en el mundo MAIN) o como userscript (Violentmonkey/Tampermonkey).
 */
(function () {
  'use strict';

  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  if (W.__redalycExporterLoaded) return;
  W.__redalycExporterLoaded = true;

  var PAGE_SIZE = 100;      // registros por petición
  var DELAY_MS = 250;       // pausa entre peticiones, por cortesía con el servidor
  var BASE = 'https://www.redalyc.org';

  // ------------------------------------------------------------------
  // Utilidades de texto
  // ------------------------------------------------------------------
  var decoder = document.createElement('textarea');
  function clean(s) {
    if (s == null) return '';
    s = String(s).replace(/<[^>]*>/g, ' ');
    decoder.innerHTML = s;             // decodifica entidades HTML (&amp;, &eacute;...)
    return decoder.value
      .replace(/([A-Za-zÀ-ɏ])¿/g, "$1'")  // Redalyc a veces guarda el apóstrofo como "¿" (students¿ behavior)
      .replace(/\s+/g, ' ').trim();
  }
  function isBlank(s) {
    s = clean(s);
    return s === '' || s === '-' || s === '0';
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9,
    oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12
  };
  var BIB_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseMonth(s) {
    s = clean(s).toLowerCase();
    if (!s) return null;
    var first = s.split(/[-\/\s]+/)[0].normalize('NFD').replace(/[̀-ͯ]/g, '');
    return MESES[first] || null;
  }

  // ------------------------------------------------------------------
  // Normalización de un registro del servicio de Redalyc
  // ------------------------------------------------------------------
  function parseAbstracts(resumen) {
    var out = [];
    String(resumen || '').split('>>>').forEach(function (part) {
      var t = clean(part);
      if (!t) return;
      var m = t.match(/^([a-zA-Z]{2,3})\s*:\s*([\s\S]*)$/);
      if (m) out.push({ lang: m[1].toLowerCase(), text: m[2].trim() });
      else out.push({ lang: '', text: t });
    });
    return out.filter(function (a) { return a.text; });
  }

  function pickAbstract(list, pref) {
    if (!list.length) return '';
    if (pref && pref !== 'all') {
      for (var i = 0; i < list.length; i++) if (list[i].lang === pref) return list[i].text;
      return list[0].text;
    }
    if (list.length === 1) return list[0].text;
    return list.map(function (a) {
      return (a.lang ? '[' + a.lang.toUpperCase() + '] ' : '') + a.text;
    }).join('  ');
  }

  var KW_LABEL = /^(palabras?[\s-]*claves?|key[\s-]*words?|palavras?[\s-]*chaves?|mots?[\s-]*cl[eé]s?|descriptores|descritores)\s*:?$/i;
  function parseKeywords(palabras) {
    var seen = {}, out = [];
    String(palabras || '').split('>>>').forEach(function (block) {
      block = clean(block).replace(/\((fuente|fonte|source)\s*:[^)]*\)/gi, '');
      block = block.replace(/^(palabras?[\s-]*claves?|key[\s-]*words?|palavras?[\s-]*chaves?|mots?[\s-]*cl[eé]s?)\s*:\s*/i, '');
      block.split(/[;,]/).forEach(function (k) {
        k = k.replace(/[.\s]+$/, '').trim();
        if (!k || KW_LABEL.test(k)) return;
        var key = k.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(k);
      });
    });
    return out;
  }

  function parseAuthors(a) {
    var list = String(a.apellidoNombre || '').split('>>>').map(clean).filter(Boolean);
    if (!list.length) list = String(a.autores || '').split(/\s*,\s*/).map(clean).filter(Boolean);
    return list;
  }

  function parseDOI(s) {
    s = clean(s).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
    return /^10\.\S+\/\S+/.test(s) ? s : '';
  }

  function pdfUrl(a) {
    var ruta = clean(a.rutaArchivo).replace(/\\/g, '/');
    if (ruta && /\.pdf$/i.test(ruta)) return BASE + '/pdf/' + ruta;
    if (!isBlank(a.nomArchivo) && !isBlank(a.cveRevista)) return BASE + '/pdf/' + clean(a.cveRevista) + '/' + clean(a.nomArchivo);
    return '';
  }

  function normalize(a, absPref) {
    var pages = clean(a.paginas).split(/\s*[-–]\s*/);
    var sp = pages[0] && pages[0] !== '0' ? pages[0] : '';
    var ep = pages[1] && pages[1] !== '0' ? pages[1] : '';
    var abstracts = parseAbstracts(a.resumen);
    return {
      id: clean(a.cveArticulo),
      title: clean(a.titulo),
      authors: parseAuthors(a),
      year: clean(a.anioArticulo || a.anoEdcNum),
      month: parseMonth(a.mesNumero),
      journal: clean(a.nomRevista),
      publisher: clean(a.nomInstitucionRev),
      volume: isBlank(a.volRevNum) ? '' : clean(a.volRevNum),
      issue: isBlank(a.numRevNum) ? '' : clean(a.numRevNum),
      sp: sp, ep: ep,
      issn: isBlank(a.issnrev) ? '' : clean(a.issnrev),
      eissn: isBlank(a.issnelerev) ? '' : clean(a.issnelerev),
      doi: parseDOI(a.doiTitulo),
      language: clean(a.idiomaArticulo),
      abstract: pickAbstract(abstracts, absPref),
      abstractLangs: abstracts.map(function (x) { return x.lang; }).filter(Boolean).join(', '),
      keywords: parseKeywords(a.palabras),
      url: BASE + '/articulo.oa?id=' + clean(a.cveArticulo),
      pdf: pdfUrl(a)
    };
  }

  // ------------------------------------------------------------------
  // Serializadores
  // ------------------------------------------------------------------
  function toRIS(recs) {
    return recs.map(function (r) {
      var L = [];
      function add(tag, v) {
        if (v == null) return;
        v = String(v).replace(/[\r\n]+/g, ' ').trim();
        if (v) L.push(tag + '  - ' + v);
      }
      add('TY', 'JOUR');
      add('TI', r.title);
      r.authors.forEach(function (au) { add('AU', au); });
      add('PY', r.year);
      if (r.year && r.month) add('DA', r.year + '/' + pad2(r.month) + '//');
      add('T2', r.journal);
      add('JF', r.journal);
      add('VL', r.volume);
      add('IS', r.issue);
      add('SP', r.sp);
      add('EP', r.ep);
      add('SN', r.issn);
      if (r.eissn && r.eissn !== r.issn) add('SN', r.eissn);
      add('DO', r.doi);
      add('LA', r.language);
      add('PB', r.publisher);
      add('AB', r.abstract);
      r.keywords.forEach(function (k) { add('KW', k); });
      add('UR', r.url);
      add('L1', r.pdf);
      add('DB', 'Redalyc');
      add('AN', r.id);
      L.push('ER  - ');
      return L.join('\r\n');
    }).join('\r\n\r\n') + '\r\n';
  }

  var BIB_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
  function bibEsc(s) { return String(s).replace(/[\\{}&%$#_~^]/g, function (c) { return BIB_ESC[c]; }); }
  function bibRaw(s) { return String(s).replace(/[{}]/g, ''); }

  function toBibTeX(recs) {
    return recs.map(function (r) {
      var F = [];
      function add(k, v, raw) {
        if (v == null || String(v).trim() === '') return;
        F.push('  ' + k + ' = {' + (raw ? bibRaw(v) : bibEsc(v)) + '}');
      }
      add('author', r.authors.join(' and '));
      add('title', r.title);
      add('journal', r.journal);
      add('year', r.year);
      if (r.month) F.push('  month = ' + BIB_MONTHS[r.month - 1]);
      add('volume', r.volume);
      add('number', r.issue);
      add('pages', r.sp && r.ep ? r.sp + '--' + r.ep : r.sp);
      add('issn', [r.issn, r.eissn].filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', '));
      add('doi', r.doi, true);
      add('url', r.url, true);
      add('language', r.language);
      add('publisher', r.publisher);
      add('abstract', r.abstract);
      add('keywords', r.keywords.join('; '));
      add('note', 'Redalyc ID: ' + r.id);
      return '@article{redalyc' + r.id + ',\n' + F.join(',\n') + '\n}';
    }).join('\n\n') + '\n';
  }

  function toCSV(recs) {
    var cols = [
      ['redalyc_id', 'id'], ['titulo', 'title'], ['autores', function (r) { return r.authors.join('; '); }],
      ['anio', 'year'], ['revista', 'journal'], ['volumen', 'volume'], ['numero', 'issue'],
      ['paginas', function (r) { return r.sp && r.ep ? r.sp + '-' + r.ep : r.sp; }],
      ['issn', 'issn'], ['eissn', 'eissn'], ['doi', 'doi'], ['idioma', 'language'],
      ['idiomas_resumen', 'abstractLangs'], ['resumen', 'abstract'],
      ['palabras_clave', function (r) { return r.keywords.join('; '); }],
      ['editorial', 'publisher'], ['url', 'url'], ['pdf', 'pdf']
    ];
    function cell(v) {
      v = v == null ? '' : String(v);
      return /[",\r\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var lines = [cols.map(function (c) { return c[0]; }).join(',')];
    recs.forEach(function (r) {
      lines.push(cols.map(function (c) {
        return cell(typeof c[1] === 'function' ? c[1](r) : r[c[1]]);
      }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  var FORMATS = {
    ris: { ext: 'ris', mime: 'application/x-research-info-systems;charset=utf-8', fn: toRIS, label: 'RIS' },
    bib: { ext: 'bib', mime: 'application/x-bibtex;charset=utf-8', fn: toBibTeX, label: 'BibTeX' },
    csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', fn: toCSV, label: 'CSV' }
  };

  // ------------------------------------------------------------------
  // Estado de la búsqueda (texto, filtros, orden) tomado de la página
  // ------------------------------------------------------------------
  function joinClaves(arr, fallback) {
    if (Array.isArray(arr)) {
      return arr.map(function (x) { return x && typeof x === 'object' ? (x.clave != null ? x.clave : '') : x; })
        .filter(function (x) { return x !== '' && x != null; }).join('-');
    }
    return fallback || '';
  }
  // Traduce las claves aplicadas (p. ej., "2022-2021" o "1") a nombres legibles,
  // buscándolas en los filtros que muestra la página y en las casillas marcadas.
  function claveNames(cadena, sc, idx, arr) {
    if (!cadena) return '';
    var map = {};
    try {
      var cat = (sc.filterData || [])[idx];
      (cat && cat.elementos || []).forEach(function (e) { map[String(e.clave)] = e.nombre; });
    } catch (e) { }
    (Array.isArray(arr) ? arr : []).forEach(function (e) { if (e && e.clave != null) map[String(e.clave)] = e.nombre; });
    return String(cadena).split('-').map(function (c) { return clean(map[c] || c); }).join(', ');
  }

  function getState() {
    var sc = null;
    try {
      var el = document.querySelector('[ng-controller="articleController"]') || document.querySelector('[ng-controller]');
      if (W.angular && el) sc = W.angular.element(el).scope();
    } catch (e) { sc = null; }

    if (sc && typeof sc.textoABuscar === 'string') {
      // Las cadenas cadena* son los filtros APLICADOS (las arma applyFilters);
      // los arreglos filter* son las casillas marcadas, aplicadas o no.
      var year = sc.cadenaYear || '', idioma = sc.cadenaIdioma || '',
        disciplina = sc.cadenaDisciplina || '', pais = sc.cadenaPais || '';
      var pending =
        joinClaves(sc.filterYear) !== year || joinClaves(sc.filterIdioma) !== idioma ||
        joinClaves(sc.filterDisciplina) !== disciplina || joinClaves(sc.filterPais) !== pais;
      return {
        source: 'page',
        pending: pending,
        texto: sc.textoABuscar,
        year: year, idioma: idioma, disciplina: disciplina, pais: pais,
        names: {
          'Año': claveNames(year, sc, 0, sc.filterYear),
          'Idioma': claveNames(idioma, sc, 1, sc.filterIdioma),
          'Disciplina': claveNames(disciplina, sc, 2, sc.filterDisciplina),
          'País': claveNames(pais, sc, 3, sc.filterPais)
        },
        orderBy: sc.orderBy || 'default',
        typeLoadSearch: sc.typeLoadSearch || '',
        clacsoWords: sc.clacsoWords, typeArea: sc.typeArea,
        currentPage: sc.currentPage || 1,
        pageSize: sc.pageSize || 10
      };
    }
    // Respaldo: solo el texto de la URL, sin filtros
    var q = new URLSearchParams(location.search).get('q') || '';
    return {
      source: 'url', texto: q, year: '', idioma: '', disciplina: '', pais: '', names: {},
      orderBy: 'default', typeLoadSearch: '', currentPage: 1, pageSize: 10
    };
  }

  function hasFilters(st) { return !!(st.year || st.idioma || st.disciplina || st.pais); }

  function serviceUrl(st, page, size) {
    var texto = String(st.texto || '').replace(/\//g, 's-s');
    if (texto === '' && st.typeLoadSearch) texto = '0';
    if (hasFilters(st)) texto += '<<<' + st.year + '<<<' + st.idioma + '<<<' + st.disciplina + '<<<' + st.pais;
    var path = st.typeLoadSearch
      ? 'service/r2020/getArticlesClacso/' + texto + '/' + st.clacsoWords + '/' + st.typeArea + '/' + st.typeLoadSearch + '/' + page + '/' + size + '/0/' + st.orderBy
      : 'service/r2020/getArticles/' + texto + '/' + page + '/' + size + '/0/' + st.orderBy;
    return '/' + encodeURI(path);
  }

  async function getJSON(url, tries) {
    tries = tries || 3;
    for (var i = 0; i < tries; i++) {
      try {
        var r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        if (i === tries - 1) throw e;
        await sleep(1500 * (i + 1));
      }
    }
  }

  // ------------------------------------------------------------------
  // Descarga
  // ------------------------------------------------------------------
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }
  function slug(s) {
    return String(s || 'busqueda').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'busqueda';
  }
  function stamp(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function stampTime(d) {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { }
    return stamp(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (tz ? ' (' + tz + ')' : '');
  }

  // ------------------------------------------------------------------
  // Interfaz (en shadow DOM para no chocar con los estilos de Redalyc)
  // ------------------------------------------------------------------
  var host = document.createElement('div');
  host.id = 'redalyc-exporter-host';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.fab{display:flex;align-items:center;gap:8px;background:#0b3d6b;color:#fff;border:0;border-radius:999px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}',
    '.fab:hover{background:#0e4f8a}',
    '.panel{display:none;width:360px;background:#fff;color:#1d2433;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.28);padding:18px 18px 16px;font-size:13.5px;line-height:1.4}',
    '.open .panel{display:block}.open .fab{display:none}',
    '.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
    '.hd b{font-size:15px}',
    '.x{background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:#667;padding:0 4px}',
    '.info{background:#f2f5f9;border-radius:8px;padding:9px 10px;margin-bottom:12px;font-size:12.5px;color:#334;word-break:break-word}',
    '.info .n{font-weight:700;color:#0b3d6b}',
    'fieldset{border:0;margin:0 0 10px;padding:0}',
    'legend{font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#556;margin-bottom:5px;padding:0}',
    '.seg{display:flex;gap:6px;flex-wrap:wrap}',
    '.seg label{flex:1;min-width:70px;text-align:center;border:1px solid #cdd5df;border-radius:8px;padding:7px 4px;cursor:pointer;font-size:13px;user-select:none}',
    '.seg input{display:none}',
    '.seg input:checked+span{font-weight:700;color:#0b3d6b}',
    '.seg label:has(input:checked){border-color:#0b3d6b;background:#e8f0f8}',
    'select{width:100%;padding:7px;border:1px solid #cdd5df;border-radius:8px;font-size:13px;background:#fff;color:#1d2433}',
    '.go{width:100%;margin-top:6px;background:#0b3d6b;color:#fff;border:0;border-radius:9px;padding:10px;font-size:14px;font-weight:600;cursor:pointer}',
    '.go:disabled{opacity:.5;cursor:default}',
    '.sec{width:100%;margin-top:8px;background:#fff;color:#0b3d6b;border:1px solid #0b3d6b;border-radius:9px;padding:8px;font-size:13px;font-weight:600;cursor:pointer;display:none}',
    '.bar{height:6px;background:#e3e8ef;border-radius:3px;overflow:hidden;margin-top:12px;display:none}',
    '.bar i{display:block;height:100%;width:0;background:#0b3d6b;transition:width .2s}',
    '.msg{margin-top:8px;font-size:12.5px;color:#445;min-height:1em}',
    '.msg.err{color:#b00020}',
    '.warn{font-size:12px;color:#8a5a00;margin-top:-4px;margin-bottom:8px;display:none}',
    '.foot{margin-top:12px;padding-top:10px;border-top:1px solid #e3e8ef;font-size:11.5px;color:#778;text-align:center}',
    '.foot a{color:#0b3d6b;text-decoration:none}.foot a:hover{text-decoration:underline}',
    '</style>',
    '<div class="wrap">',
    '  <button class="fab" title="Exportar resultados de esta búsqueda">⤓ Exportar referencias</button>',
    '  <div class="panel" role="dialog" aria-label="Exportar resultados de Redalyc">',
    '    <div class="hd"><b>Exportar resultados</b><button class="x" title="Cerrar">×</button></div>',
    '    <div class="info"></div>',
    '    <div class="warn"></div>',
    '    <fieldset><legend>Formato</legend><div class="seg">',
    '      <label><input type="radio" name="fmt" value="ris" checked><span>RIS</span></label>',
    '      <label><input type="radio" name="fmt" value="bib"><span>BibTeX</span></label>',
    '      <label><input type="radio" name="fmt" value="csv"><span>CSV</span></label>',
    '    </div></fieldset>',
    '    <fieldset><legend>Registros</legend><div class="seg">',
    '      <label><input type="radio" name="scope" value="all" checked><span>Todos</span></label>',
    '      <label><input type="radio" name="scope" value="page"><span>Solo esta página</span></label>',
    '    </div></fieldset>',
    '    <fieldset><legend>Resumen</legend>',
    '      <select name="abs">',
    '        <option value="all">Todos los idiomas disponibles</option>',
    '        <option value="es">Preferir español</option>',
    '        <option value="en">Preferir inglés</option>',
    '        <option value="pt">Preferir portugués</option>',
    '      </select>',
    '    </fieldset>',
    '    <button class="go">Exportar</button>',
    '    <div class="bar"><i></i></div>',
    '    <div class="msg"></div>',
    '    <button class="sec log">Descargar registro de búsqueda (.txt)</button>',
    '    <div class="foot">Exportador Redalyc 1.0 · <a href="https://juliovega.org/exportador_redalyc.html" target="_blank" rel="noopener">J. I. Vega-Cauich</a></div>',
    '  </div>',
    '</div>'
  ].join('\n');
  document.body.appendChild(host);

  var $ = function (s) { return root.querySelector(s); };
  var wrap = $('.wrap'), info = $('.info'), warn = $('.warn'), go = $('.go'),
    bar = $('.bar'), barI = $('.bar i'), msg = $('.msg'), logBtn = $('.log');
  var busy = false, cancelled = false, lastLog = null, lastLogName = '';

  function setMsg(t, isErr) { msg.textContent = t; msg.className = 'msg' + (isErr ? ' err' : ''); }
  function setProgress(p) { bar.style.display = 'block'; barI.style.width = Math.round(p * 100) + '%'; }
  function val(name) { var el = root.querySelector('[name="' + name + '"]:checked') || root.querySelector('[name="' + name + '"]'); return el && el.value; }

  function filtersText(st) {
    var parts = [];
    Object.keys(st.names || {}).forEach(function (k) { if (st.names[k]) parts.push(k + ': ' + st.names[k]); });
    if (!parts.length && hasFilters(st)) {
      if (st.year) parts.push('Año: ' + st.year.replace(/-/g, ', '));
      if (st.idioma) parts.push('Idioma (clave): ' + st.idioma);
      if (st.disciplina) parts.push('Disciplina (clave): ' + st.disciplina);
      if (st.pais) parts.push('País (clave): ' + st.pais);
    }
    return parts.join(' · ');
  }

  async function refreshInfo() {
    var st = getState();
    var f = filtersText(st);
    info.innerHTML = '';
    var line1 = document.createElement('div');
    line1.textContent = 'Búsqueda: ' + (st.texto || '(vacía)');
    info.appendChild(line1);
    if (f) { var l2 = document.createElement('div'); l2.textContent = 'Filtros: ' + f; info.appendChild(l2); }
    var l3 = document.createElement('div');
    l3.innerHTML = 'Resultados: <span class="n">…</span>';
    info.appendChild(l3);
    var w = '';
    if (st.source === 'url') w = 'No pude leer los filtros de la página; se exportará la búsqueda de la URL sin filtros.';
    else if (st.pending) w = 'Hay casillas de filtro marcadas que aún no se aplican. Se exportará lo que muestra la página; aplica los filtros primero si quieres incluirlos.';
    warn.style.display = w ? 'block' : 'none';
    warn.textContent = w;
    try {
      var d = await getJSON(serviceUrl(st, 1, 1));
      l3.querySelector('.n').textContent = Number(d.totalResultados || 0).toLocaleString('es-MX');
    } catch (e) {
      l3.querySelector('.n').textContent = 'no disponible';
    }
  }

  async function runExport() {
    if (busy) { cancelled = true; go.textContent = 'Cancelando…'; return; }
    busy = true; cancelled = false;
    go.textContent = 'Cancelar';
    logBtn.style.display = 'none';
    setMsg('');
    setProgress(0);

    var st = getState();
    var fmt = FORMATS[val('fmt')];
    var scope = val('scope');
    var absPref = root.querySelector('[name="abs"]').value;
    var started = new Date();
    var raw = [], total = 0, url0 = '';

    try {
      if (scope === 'page') {
        url0 = serviceUrl(st, st.currentPage, st.pageSize);
        var dp = await getJSON(url0);
        raw = dp.resultados || [];
        total = Number(dp.totalResultados || raw.length);
        setProgress(1);
      } else {
        url0 = serviceUrl(st, 1, PAGE_SIZE);
        var d1 = await getJSON(url0);
        total = Number(d1.totalResultados || 0);
        raw = raw.concat(d1.resultados || []);
        if (total > 20000 && !W.confirm('La búsqueda tiene ' + total.toLocaleString('es-MX') + ' resultados. Descargarlos todos puede tardar varios minutos. ¿Continuar?')) {
          throw new Error('cancelado');
        }
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        setProgress(1 / pages);
        setMsg('Descargando ' + raw.length + ' de ' + total.toLocaleString('es-MX') + '…');
        for (var p = 2; p <= pages; p++) {
          if (cancelled) throw new Error('cancelado');
          await sleep(DELAY_MS);
          var dn = await getJSON(serviceUrl(st, p, PAGE_SIZE));
          var batch = dn.resultados || [];
          raw = raw.concat(batch);
          setProgress(p / pages);
          setMsg('Descargando ' + raw.length.toLocaleString('es-MX') + ' de ' + total.toLocaleString('es-MX') + '…');
          if (!batch.length) break;
        }
      }

      // Duplicados internos (mismo artículo en dos páginas)
      var seen = {}, recs = [], dups = 0;
      raw.forEach(function (a) {
        var id = clean(a.cveArticulo);
        if (seen[id]) { dups++; return; }
        seen[id] = true;
        recs.push(normalize(a, absPref));
      });

      var name = 'redalyc_' + slug(st.texto) + '_' + stamp(started) + '_n' + recs.length + '.' + fmt.ext;
      download(name, fmt.fn(recs), fmt.mime);

      var f = filtersText(st);
      lastLog = [
        'Registro de búsqueda en Redalyc',
        '===============================',
        'Fecha y hora de la búsqueda: ' + stampTime(started),
        'Base de datos: Redalyc (https://www.redalyc.org)',
        'Cadena de búsqueda: ' + st.texto,
        'Filtros aplicados: ' + (f || 'ninguno'),
        'Orden: ' + st.orderBy,
        'Alcance exportado: ' + (scope === 'page' ? 'solo la página ' + st.currentPage + ' (' + st.pageSize + ' por página)' : 'todos los resultados'),
        'Resultados informados por Redalyc: ' + total,
        'Registros exportados: ' + recs.length + (dups ? ' (se omitieron ' + dups + ' duplicados internos)' : ''),
        'Archivo: ' + name,
        'URL de la página: ' + location.href,
        'Servicio consultado: ' + BASE + url0,
        'Herramienta: Exportador Redalyc 1.0 (Vega-Cauich, 2026), https://juliovega.org/exportador_redalyc.html',
        ''
      ].join('\r\n');
      lastLogName = name.replace(/\.[a-z]+$/, '') + '_registro.txt';

      var faltan = scope === 'all' ? total - recs.length - dups : 0;
      setMsg('Listo: ' + recs.length.toLocaleString('es-MX') + ' registros en ' + fmt.label + '.' +
        (dups ? ' Se omitieron ' + dups + ' duplicados.' : '') +
        (faltan > 0 ? ' Atención: Redalyc informó ' + total + ' resultados y llegaron ' + (recs.length + dups) + '.' : ''), faltan > 0);
      logBtn.style.display = 'block';
    } catch (e) {
      setMsg(e.message === 'cancelado' ? 'Exportación cancelada.' : 'Error al descargar: ' + e.message + '. Intenta de nuevo en un momento.', e.message !== 'cancelado');
    } finally {
      busy = false;
      go.textContent = 'Exportar';
    }
  }

  function openPanel() { wrap.classList.add('open'); refreshInfo(); }
  $('.fab').addEventListener('click', openPanel);
  $('.x').addEventListener('click', function () { if (!busy) wrap.classList.remove('open'); });
  go.addEventListener('click', runExport);
  logBtn.addEventListener('click', function () { if (lastLog) download(lastLogName, '﻿' + lastLog, 'text/plain;charset=utf-8'); });

  // Expuesto para depuración desde la consola
  W.__redalycExporter = { open: openPanel, getState: getState, serviceUrl: serviceUrl, normalize: normalize, toRIS: toRIS, toBibTeX: toBibTeX, toCSV: toCSV };
})();
