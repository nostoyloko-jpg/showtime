/* Showtime · Hoja de ruta imprimible (Running Order) — Fase 1: tabla.
 * 0 dependencias. Genera HTML para A4 (vertical u horizontal) que se imprime desde un <iframe> oculto
 * (en el diálogo, «Guardar como PDF»). Usa C.buildBlocks: horarios PREVISTOS (la escaleta), no los reales.
 * Ordenador:  node tests/print.test.js
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

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hexOk(c, d) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d; }

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
        return {
          jornada: b.jornada || null,
          start: ini === null || ini === undefined ? '—' : C.fmtHM(ini),
          end: fin === null || fin === undefined ? '' : C.fmtHM(fin),
          dur: dur === null ? '—' : dur + ' min',
          call: b.callAbs !== null && b.callAbs !== undefined ? C.fmtHM(b.callAbs) : '',
          zone: b.stage || 'Sin zona',
          zoneColor: hexOk(b.stageColor || b.color, '#94a3b8'),
          kind: b.kind,
          name: b.name || '',
          notes: b.notes || ''
        };
      });
  }

  /** Letra y relleno según cuántas filas hay: una jornada tiene que caber en una A4 sin cortarse. */
  function densityFor(n) {
    if (n <= 10) return { fs: '10pt', pad: '3mm' };
    if (n <= 16) return { fs: '9pt', pad: '2.4mm' };
    if (n <= 24) return { fs: '8pt', pad: '1.8mm' };
    if (n <= 32) return { fs: '7.2pt', pad: '1.3mm' };
    return { fs: '6.5pt', pad: '0.9mm' };
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
    'body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Inter,Arial,sans-serif;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}',
    '.sheet{padding:0}.sheet+.sheet{break-before:page}',
    '.hd{border-bottom:1.5px solid #0f172a;padding-bottom:6px;margin-bottom:8px}',
    '.brand{font-size:6.5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#334155}',
    'h1{font-size:15pt;line-height:1.1;margin:3px 0 4px;letter-spacing:-.01em;color:#0f172a}',
    '.meta{font-size:7.5pt;color:#334155;letter-spacing:.02em}',
    'table{width:100%;border-collapse:collapse;table-layout:fixed}',
    'th{font-size:6.5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#334155;text-align:left;padding:4px 5px;border-bottom:.75pt solid #0f172a}',
    'td{padding:var(--pad,2mm) 5px;border-bottom:.5pt solid #cbd5e1;vertical-align:middle;font-size:var(--fs,8pt);line-height:1.25}',
    'tr{break-inside:avoid}',
    'td.t{font-weight:700;white-space:nowrap}td.n{color:#334155;white-space:nowrap}',
    'td.z{position:relative;padding-left:9px}td.z i{position:absolute;left:0;top:0;bottom:0;width:3px}',
    '.pill{display:inline-block;font-size:6.5pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:.75pt solid;background:transparent;white-space:nowrap}',
    '.p-show{border-color:#0f172a;color:#0f172a}.p-prueba{border-color:#7c3aed;color:#5b21b6}.p-tarea{border-color:#0284c7;color:#075985}.p-hito{border-color:#dc2626;color:#991b1b}',
    'td.name{font-weight:700}td.notes{font-size:.92em;color:#334155}',
    '.empty{font-size:9pt;color:#334155;padding:10mm 0}',
    '.bar{position:sticky;top:0;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:10px 20px;background:#14161b;color:#e5e7eb;font-size:13px;z-index:2}',
    '@media print{.bar{display:none}}'
  ].join('\n');

  /** Pie de página (márgenes de @page): evento · jornada · impresión · páginas. */
  function pageCss(o) {
    const size = o.orient === 'landscape' ? 'A4 landscape' : 'A4 portrait';
    const f = 'font:6.5pt -apple-system,Helvetica,Arial,sans-serif;color:#64748b;letter-spacing:.02em';
    return '@page{size:' + size + ';margin:' + (o.orient === 'landscape' ? '10mm 12mm 14mm' : '12mm 12mm 15mm') + '}' +
      '@page{@bottom-left{content:"' + esc(o.footer).replace(/"/g, '\\"') + '";' + f + '}' +
      '@bottom-center{content:"Impreso: ' + esc(o.printed) + '";' + f + '}' +
      '@bottom-right{content:"Pág " counter(page) "/" counter(pages);' + f + '}}';
  }

  /**
   * Documento HTML completo.
   * opts: { rows: [...] (de rowsOf), days: [ISO], title, orient:'portrait'|'landscape', notes:bool, call:bool, now: Date }
   */
  function html(opts) {
    const o = opts || {};
    const rows = o.rows || [];
    const days = o.days && o.days.length ? o.days : [null];
    const printed = printedAt(o.now);
    const single = days.length === 1 && days[0];
    const footer = 'Showtime Regiduría · ' + (o.title || 'Evento') + ' · ' + (single ? dayLabel(days[0]) : 'Todas las jornadas');
    const cols = ['Horario', 'Duración'].concat(o.call ? ['CALL'] : []).concat(['Escenario / zona', 'Tipo', 'Artista / actividad']).concat(o.notes ? ['Notas / operativa'] : []);
    const sheets = days.map(d => {
      const list = rows.filter(r => !d || r.jornada === d);
      const dens = densityFor(list.length);
      const W = { 'Horario': 15, 'Duración': 9, 'CALL': 7, 'Escenario / zona': 16, 'Tipo': 9, 'Notas / operativa': 20 };
      const fixed = cols.reduce((a, c) => a + (W[c] || 0), 0);
      const cg = '<colgroup>' + cols.map(c => '<col style="width:' + (c === 'Artista / actividad' ? Math.max(20, 100 - fixed) : (W[c] || 0)) + '%">').join('') + '</colgroup>';
      const head = '<tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr>';
      const body = list.map(r => {
        const cells = ['<td class="t">' + esc(r.start) + (r.end ? ' – ' + esc(r.end) : '') + '</td>', '<td class="n">' + esc(r.dur) + '</td>'];
        if (o.call) cells.push('<td class="n">' + esc(r.call) + '</td>');
        cells.push('<td class="z"><i style="background:' + esc(r.zoneColor) + '"></i>' + esc(r.zone) + '</td>');
        const t = TYPE[r.kind] || { txt: esc(r.kind), cls: 'p-show' };
        cells.push('<td><span class="pill ' + t.cls + '">' + t.txt + '</span></td>');
        cells.push('<td class="name">' + esc(r.name) + '</td>');
        if (o.notes) cells.push('<td class="notes">' + esc(r.notes) + '</td>');
        return '<tr>' + cells.join('') + '</tr>';
      }).join('');
      const meta = (single || d ? dayLabel(d) : 'Todas las jornadas') + ' · ' + list.length + ' bloques';
      return '<section class="sheet" style="--fs:' + dens.fs + ';--pad:' + dens.pad + '">' +
        '<div class="hd"><div class="brand">Showtime · Hoja de ruta</div><h1>' + esc(o.title || 'Evento') + '</h1><div class="meta">' + esc(meta) + '</div></div>' +
        (list.length ? '<table>' + cg + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table>' : '<p class="empty">Nada que imprimir con estos filtros.</p>') +
        '</section>';
    }).join('');
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(o.title || 'Hoja de ruta') + '</title>' +
      '<style>' + pageCss({ orient: o.orient, footer: footer, printed: printed }) + '\n' + PRINT_CSS + '</style></head><body>' + sheets + '</body></html>';
  }

  /** Resumen para la vista del modal: cuántas filas y qué letra saldrá. */
  function summary(rows, days) {
    const list = rows || [];
    const multi = !!(days && days.length > 1);
    const per = multi ? days.map(d => list.filter(r => r.jornada === d).length) : [list.length];
    const worst = Math.max(0, ...per);
    return { bloques: list.length, hojas: multi ? days.length : 1, letra: densityFor(worst).fs, dens: densityFor(worst) };
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
