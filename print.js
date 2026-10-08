/* Showtime · Hoja de ruta imprimible (Running Order) — tabla por jornada.
 * 0 dependencias. Genera HTML para A4 (vertical u horizontal) que se imprime desde un <iframe> oculto
 * (en el diálogo, «Guardar como PDF»). Usa C.buildBlocks: horarios PREVISTOS (la escaleta), no los reales.
 * Maquetación: márgenes y pie DENTRO de cada hoja (no dependen de @page, que Safari no respeta);
 * una jornada = una hoja; la tabla estira sus filas hasta llenar la altura útil.
 * Ordenador:  node tests/print.test.js   ·   node --test tests/print.test.js
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.ShowtimeCore;

  /** Filtros de contenido: qué tipos de bloque entran. */
  const CONTENT = {
    all: { label: 'Todo el horario', kinds: ['show', 'sc', 'tarea', 'hito'] },
    shows: { label: 'Shows y Pruebas', kinds: ['show', 'sc'] },
    solo: { label: 'Solo Shows', kinds: ['show'] }
  };
  /** Píldoras «ghost»: texto y contorno por tipo (SHOW negro · PRUEBA púrpura · TAREA azul · HITO rojo). */
  const TYPE = {
    show: { txt: 'SHOW', cls: 'p-show' },
    sc: { txt: 'PRUEBA', cls: 'p-prueba' },
    tarea: { txt: 'TAREA', cls: 'p-tarea' },
    hito: { txt: 'HITO', cls: 'p-hito' }
  };
  /** Convención de avisos: texto entre asteriscos («*** Restricciones de PA… ***») → fila de ancho completo. */
  const AVISO_RE = /\*\*\*/;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hexOk(c, d) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d; }
  function clean(s) { return String(s == null ? '' : s).replace(/\*\*\*/g, ' ').replace(/\s+/g, ' ').trim(); }

  /**
   * Filas de la tabla para una jornada (o todas).
   * opts: { day: ISO|'all', zone: id|'all', content: 'all'|'shows'|'solo' }
   */
  function rowsOf(state, opts) {
    const o = opts || {};
    const kinds = (CONTENT[o.content] || CONTENT.all).kinds;
    const blocks = C.buildBlocks(state, { mode: 'all', day: o.day || 'all' });
    return blocks
      .filter(b => kinds.indexOf(b.kind) >= 0)
      .filter(b => !o.zone || o.zone === 'all' || b.stageId === o.zone)
      .map(b => {
        const ini = b.psi !== undefined && b.psi !== null ? b.psi : b.si;
        const fin = b.psf !== undefined && b.psf !== null ? b.psf : b.sf;
        const dur = ini !== null && ini !== undefined && fin !== null && fin !== undefined ? fin - ini : null;
        const name = b.name || '';
        const notes = b.notes || '';
        return {
          jornada: b.jornada || null,
          start: ini === null || ini === undefined ? '—' : C.fmtHM(ini),
          end: fin === null || fin === undefined ? '' : C.fmtHM(fin),
          dur: dur === null ? '—' : dur + ' min',
          call: b.callAbs !== null && b.callAbs !== undefined ? C.fmtHM(b.callAbs) : '',
          zone: b.stage || 'Sin zona',
          zoneColor: hexOk(b.stageColor || b.color, '#94a3b8'),
          kind: b.kind,
          name: name,
          notes: notes,
          aviso: AVISO_RE.test(name) || AVISO_RE.test(notes)
        };
      });
  }

  /** Clase de densidad según filas de la jornada: normal ≤14 · compact 15–22 · ultra-compact >22
   *  (letra 10pt → 8.5pt → 7.5pt). El relleno es mínimo: la tabla estira las filas hasta llenar la hoja. */
  function densityFor(n) {
    if (n <= 14) return { cls: 'density-normal', fs: '10pt', pad: '3mm' };
    if (n <= 22) return { cls: 'density-compact', fs: '8.5pt', pad: '2mm' };
    return { cls: 'density-ultra-compact', fs: '7.5pt', pad: '1.2mm' };
  }

  function dayLabel(iso) {
    if (!iso || iso === 'all') return 'Todo el evento';
    const i = C.dayIndex(iso);
    const d = i === null ? null : new Date(Date.UTC(2000, 0, 1) + i * 864e5);
    return d ? d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : iso;
  }
  function printedAt(d) {
    const x = d || new Date();
    return pad2(x.getDate()) + '/' + pad2(x.getMonth() + 1) + '/' + x.getFullYear() + ' ' + pad2(x.getHours()) + ':' + pad2(x.getMinutes());
  }

  /** Días a imprimir: uno por hoja (o un único día). */
  function daysOf(state, day) {
    if (day && day !== 'all') return [day];
    return C.festivalDays(state, 'all');
  }

  const PRINT_CSS = [
    '*{box-sizing:border-box}html,body{margin:0;background:#fff}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Inter,Arial,sans-serif;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}',
    '.sheet{display:flex;flex-direction:column;overflow:visible;padding:12mm 14mm 11mm}',
    '.sheet+.sheet{break-before:page}',
    '.sheet.portrait{width:210mm;height:296mm}.sheet.landscape{width:297mm;height:209mm;padding:10mm 12mm 9mm}',
    '.hd{border-bottom:1.5px solid #0f172a;padding-bottom:6px;margin-bottom:8px;flex:0 0 auto}',
    '.brand{font-size:6.5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#334155}',
    'h1{font-size:15pt;line-height:1.1;margin:3px 0 4px;letter-spacing:-.01em;color:#0f172a}',
    '.meta{font-size:7.5pt;color:#334155;letter-spacing:.02em}',
    '.tbl{flex:1 1 auto;min-height:0}',
    'table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}',
    'th{font-size:6.5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#334155;text-align:left;padding:4px 5px;border-bottom:.75pt solid #0f172a;vertical-align:bottom}',
    'td{padding:var(--pad,2mm) 5px;border-bottom:.5pt solid #cbd5e1;vertical-align:middle;font-size:var(--fs,8.5pt);line-height:1.25}',
    'tr{break-inside:avoid}',
    'tr.sep td{border-top:1.6pt solid #0f172a}',
    'td.t{font-weight:700;white-space:nowrap}td.n{color:#334155;white-space:nowrap}',
    'td.z{position:relative;padding-left:9px}td.z i{position:absolute;left:0;top:0;bottom:0;width:3px}',
    '.pill{display:inline-block;font-size:6.5pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:.75pt solid;background:transparent;white-space:nowrap}',
    '.p-show{border-color:#0f172a;color:#0f172a}.p-prueba{border-color:#7c3aed;color:#5b21b6}.p-tarea{border-color:#0284c7;color:#075985}.p-hito{border-color:#dc2626;color:#991b1b}',
    'td.name{font-weight:400}td.name.strong{font-weight:800}',
    'td.notes{color:#334155}',
    'tr.aviso td{text-align:center;font-style:italic;font-weight:600;background:#f1f5f9;color:#334155}',
    '.density-normal{--fs:10pt;--pad:3mm}.density-compact{--fs:8.5pt;--pad:2mm}.density-ultra-compact{--fs:7.5pt;--pad:1.2mm}.density-min{--fs:6.8pt;--pad:.6mm}',
    '.sheet-foot{flex:0 0 auto;display:flex;justify-content:space-between;gap:10px;margin-top:3mm;padding-top:2mm;border-top:.5pt solid #cbd5e1;font-size:6.5pt;color:#64748b;letter-spacing:.02em}',
    '.empty{font-size:9pt;color:#334155;padding:10mm 0}',
    '.bar{position:sticky;top:0;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:10px 20px;background:#14161b;color:#e5e7eb;font-size:13px;z-index:2}',
    '@media print{.bar{display:none}}'
  ].join('\n');

  /** Ajuste al cargar: si la última fila se sale del pie, la hoja baja un escalón de densidad (y, como último
   *  recurso, density-min). Así una jornada no deja una 2.ª hoja huérfana. Se mide con el diseño real del navegador. */
  const FIT_JS = "(function(){var T=['density-normal','density-compact','density-ultra-compact','density-min'];" +
    "document.querySelectorAll('section.sheet').forEach(function(s){var ft=s.querySelector('.sheet-foot');var rows=s.querySelectorAll('tbody tr');" +
    "if(!ft||!rows.length)return;var last=rows[rows.length-1];" +
    "function over(){return last.getBoundingClientRect().bottom>ft.getBoundingClientRect().top+0.5;}" +
    "var i=0;for(var k=0;k<T.length;k++){if(s.classList.contains(T[k])){i=k;break;}}" +
    "while(over()&&i<T.length-1){s.classList.remove(T[i]);i++;s.classList.add(T[i]);}});})();";

  /** Tipos que se marcan en negrita: shows y los hitos clave (curfews, apertura, fin). */
  function isStrong(r) {
    return r.kind === 'show' || (r.kind === 'hito' && /curfew|apertura|fin de/i.test(r.name));
  }

  /**
   * Documento HTML completo.
   * opts: { rows: [...] (de rowsOf), days: [ISO], title, orient:'portrait'|'landscape', notes:bool, call:bool, now: Date }
   */
  function html(opts) {
    const o = opts || {};
    const rows = o.rows || [];
    const days = o.days && o.days.length ? o.days : [null];
    const land = o.orient === 'landscape';
    const printed = printedAt(o.now);
    const title = o.title || 'Evento';
    const sheets = days.map((d, idx) => {
      const list = rows.filter(r => !d || r.jornada === d);
      const dens = densityFor(list.length);
      const zones = [];
      list.forEach(r => { if (!r.aviso && zones.indexOf(r.zone) < 0) zones.push(r.zone); });
      const zoneOne = zones.length === 1 ? zones[0] : null;             // todas las filas en la misma zona → cabecera
      const showZone = !zoneOne;
      const showCall = !!o.call && list.some(r => !r.aviso && r.call);  // CALL solo si alguna fila la tiene
      const showNotes = !!o.notes;
      const cols = [{ h: 'Horario', w: 15 }, { h: 'Duración', w: 9 }]
        .concat(showCall ? [{ h: 'CALL', w: 7 }] : [])
        .concat(showZone ? [{ h: 'Escenario / zona', w: 16 }] : [])
        .concat([{ h: 'Tipo', w: 9 }, { h: 'Artista / actividad', w: 0 }])
        .concat(showNotes ? [{ h: 'Notas / operativa', w: 20 }] : []);
      const fixed = cols.reduce((a, c) => a + c.w, 0);
      const cg = '<colgroup>' + cols.map(c => '<col style="width:' + (c.w ? c.w : Math.max(20, 100 - fixed)) + '%">').join('') + '</colgroup>';
      const head = '<tr>' + cols.map(c => '<th>' + esc(c.h) + '</th>').join('') + '</tr>';
      const sepAt = list.findIndex((r, i) => i > 0 && /apertura de puertas/i.test(r.name));
      const body = list.map((r, i) => {
        if (r.aviso) {
          const txt = clean(AVISO_RE.test(r.name) ? r.name : r.notes);
          return '<tr class="aviso"><td colspan="' + cols.length + '">' + esc(txt) + '</td></tr>';
        }
        const cells = ['<td class="t">' + esc(r.start) + (r.end ? ' – ' + esc(r.end) : '') + '</td>', '<td class="n">' + esc(r.dur) + '</td>'];
        if (showCall) cells.push('<td class="n">' + esc(r.call) + '</td>');
        if (showZone) cells.push('<td class="z"><i style="background:' + esc(r.zoneColor) + '"></i>' + esc(r.zone) + '</td>');
        const t = TYPE[r.kind] || { txt: esc(r.kind), cls: 'p-show' };
        cells.push('<td><span class="pill ' + t.cls + '">' + t.txt + '</span></td>');
        cells.push('<td class="name' + (isStrong(r) ? ' strong' : '') + '">' + esc(clean(r.name)) + '</td>');
        if (showNotes) cells.push('<td class="notes">' + esc(clean(r.notes)) + '</td>');
        return '<tr' + (i === sepAt ? ' class="sep"' : '') + '>' + cells.join('') + '</tr>';
      }).join('');
      const metaParts = [d ? dayLabel(d) : 'Todas las jornadas', list.length + ' bloques'];
      if (zoneOne) metaParts.push('Zona: ' + zoneOne);
      const footerLeft = 'Showtime Regiduría · ' + title + ' · ' + (d ? dayLabel(d) : 'Todas las jornadas');
      const footerRight = 'Pág ' + (idx + 1) + '/' + days.length;
      return '<section class="sheet ' + (land ? 'landscape' : 'portrait') + ' ' + dens.cls + '">' +
        '<div class="hd"><div class="brand">Showtime · Hoja de ruta</div><h1>' + esc(title) + '</h1><div class="meta">' + esc(metaParts.join(' · ')) + '</div></div>' +
        (list.length
          ? '<div class="tbl"><table>' + cg + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
          : '<p class="empty">Nada que imprimir con estos filtros.</p>') +
        '<footer class="sheet-foot"><span>' + esc(footerLeft) + '</span><span>Impreso: ' + esc(printed) + '</span><span>' + esc(footerRight) + '</span></footer>' +
        '</section>';
    }).join('');
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>@page{size:A4 ' + (land ? 'landscape' : 'portrait') + ';margin:0}\n' + PRINT_CSS + '</style></head><body>' + sheets +
      '<script>' + FIT_JS + '</script></body></html>';
  }

  /** Resumen para la vista del modal: cuántas filas y qué letra saldrá. */
  function summary(rows, days) {
    const list = rows || [];
    const multi = !!(days && days.length > 1);
    const per = multi ? days.map(d => list.filter(r => r.jornada === d).length) : [list.length];
    const worst = Math.max(0, ...per);
    return { bloques: list.length, hojas: multi ? days.length : 1, letra: densityFor(worst).fs, cls: densityFor(worst).cls };
  }

  /** Imprime el HTML desde un iframe oculto (no abre pestañas ni depende de popups). */
  function launch(htmlDoc) {
    if (typeof document === 'undefined') return false;
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    f.onload = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {}
      setTimeout(() => f.remove(), 60000);
    };
    f.srcdoc = htmlDoc;
    return true;
  }

  const API = { CONTENT, TYPE, rowsOf, densityFor, dayLabel, printedAt, daysOf, html, summary, launch, esc };
  if (isNode) module.exports = API;
  else root.ShowtimePrint = API;
})(typeof window !== 'undefined' ? window : globalThis);
