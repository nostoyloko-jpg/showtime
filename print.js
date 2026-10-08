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
          aviso: AVISO_RE.test(name) || AVISO_RE.test(notes),
          s: Number.isFinite(ini) ? ini : null,      // minutos absolutos (para el cronograma)
          e: Number.isFinite(fin) ? fin : null
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
    'th{font-size:6.5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#334155;text-align:left;padding:4px 5px;border-bottom:.75pt solid #0f172a;vertical-align:bottom;white-space:nowrap;overflow:hidden}',
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
    '.gantt{display:block;width:100%;height:100%}',
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

  /** Parte el texto en líneas que caben en maxW (mm). Si no caben en maxLines, la última acaba en «…».
   *  Al final, la hora («15:20–16:10») va en su propia línea si hay sitio. */
  function wrapLines(name, time, maxW, fs, maxLines) {
    if (maxLines < 1) return [];
    const cw = fs * 0.66, per = Math.max(1, Math.floor(maxW / cw));   // 0.66 em: margen para negrita
    const words = String(name || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(w => {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length <= per) cur = cand;
      else { if (cur) lines.push(cur); cur = w.length > per ? w.slice(0, per) : w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      const last = kept[maxLines - 1];
      kept[maxLines - 1] = (last.length >= per ? last.slice(0, per - 1) : last) + '…';
      return kept;
    }
    if (time && lines.length < maxLines && time.length * cw <= maxW) lines.push(time);
    return lines;
  }

  /** Etiqueta que cabe en un ancho (mm): «Nombre horario» → «Nombre» → «Nomb…» → vacío. */
  function fitLabel(name, time, maxW, fs) {
    const cw = fs * 0.6;                       // ancho medio de carácter (mm) con negrita
    const full = name + '  ' + time;
    if (full.length * cw <= maxW) return full;
    if (name.length * cw <= maxW) return name;
    const n = Math.floor(maxW / cw) - 1;
    return n >= 4 ? name.slice(0, n) + '…' : '';
  }

  /**
   * Cronograma (Gantt) de un día: geometría en mm dentro de un viewBox W×H.
   * Rango dinámico: desde el primer bloque (−30 min, a hora completa) hasta el último (+30 min, a hora completa).
   * Carriles = escenarios; bloques solapados en el mismo escenario van en sub-filas; hitos = líneas verticales.
   * list: filas de rowsOf (con s/e en minutos). Devuelve null si no hay nada que dibujar.
   */
  function layoutGantt(list, W, H) {
    const items = (list || []).filter(r => !r.aviso && Number.isFinite(r.s));
    if (!items.length) return null;
    const minS = Math.min.apply(null, items.map(r => r.s));
    const maxE = Math.max.apply(null, items.map(r => Number.isFinite(r.e) ? r.e : r.s));
    const a = Math.floor((minS - 30) / 60) * 60;
    const b = Math.ceil((maxE + 30) / 60) * 60;
    const step = b - a <= 360 ? 30 : 60;
    const LW = 44, AX = 13, GAP = 1.4, x0 = LW, x1 = W - 2;
    const X = t => x0 + (t - a) / (b - a) * (x1 - x0);
    const laneMap = new Map();
    items.filter(r => r.kind !== 'hito').slice().sort((p, q) => p.s - q.s).forEach(r => {
      if (!laneMap.has(r.zone)) laneMap.set(r.zone, { name: r.zone, color: r.zoneColor, items: [] });
      laneMap.get(r.zone).items.push(r);
    });
    const lanes = [];
    laneMap.forEach(l => {
      const ends = [];
      l.items.forEach(r => {
        const e = Number.isFinite(r.e) ? r.e : r.s;
        let row = ends.findIndex(x => x <= r.s);
        if (row < 0) { row = ends.length; ends.push(e); } else ends[row] = e;
        r.row = row;
      });
      l.rows = Math.max(1, ends.length);
      lanes.push(l);
    });
    const totalRows = lanes.reduce((n, l) => n + l.rows, 0);
    const avail = H - AX - lanes.length * GAP - 2;
    const rowH = Math.min(22, avail / totalRows);      // pocas filas → barras altas y nombres grandes
    const fs = Math.min(4.2, rowH * 0.36);
    let y = AX + 0.5;
    lanes.forEach(l => { l.y = y; l.h = l.rows * rowH; y += l.h + GAP; });
    const bars = [];
    lanes.forEach(l => l.items.forEach(r => {
      const e = Number.isFinite(r.e) ? r.e : r.s;
      const x = X(r.s), w = Math.max(0.8, X(e) - X(r.s));
      const time = C.fmtHM(r.s) + (Number.isFinite(r.e) ? '–' + C.fmtHM(r.e) : '');
      // Letra por barra: las barras estrechas bajan de tamaño para que las palabras no se partan
      const bfs = Math.max(2.4, Math.min(fs, w / 9));
      const maxLines = Math.max(0, Math.floor((rowH - 1.2) / (bfs * 1.2)));
      bars.push({ kind: r.kind, x: x, y: l.y + r.row * rowH + 0.5, w: w, h: rowH - 1, color: r.zoneColor,
        strong: isStrong(r), zone: r.zone, fs: bfs, lines: wrapLines(clean(r.name), time, w - 2.6, bfs, maxLines) });
    }));
    const ticks = [];
    for (let t = a; t <= b; t += step) ticks.push({ x: X(t), label: C.fmtHM(t) });
    const hitos = items.filter(r => r.kind === 'hito').map(r => ({ x: X(r.s), label: clean(r.name) }));
    return { W: W, H: H, a: a, b: b, step: step, x0: x0, x1: x1, AX: AX, LW: LW, lanes: lanes, bars: bars, ticks: ticks, hitos: hitos, rowH: rowH, fs: fs };
  }

  /** SVG vectorial inline del cronograma (sin gráficos de fondo: se imprime igual con o sin esa opción). */
  function ganttSvg(L) {
    const f = (n) => Math.round(n * 100) / 100;
    const out = [];
    out.push('<svg class="gantt" viewBox="0 0 ' + L.W + ' ' + L.H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cronograma de escenarios">');
    L.ticks.forEach(t => {
      out.push('<line x1="' + f(t.x) + '" x2="' + f(t.x) + '" y1="' + L.AX + '" y2="' + (L.H - 1) + '" stroke="#e2e8f0" stroke-width="0.15"/>');
      out.push('<text x="' + f(t.x) + '" y="' + (L.AX - 1.5) + '" text-anchor="middle" font-size="2.8" fill="#334155">' + esc(t.label) + '</text>');
    });
    L.lanes.forEach((l, i) => {
      out.push('<rect x="0" y="' + f(l.y) + '" width="1.2" height="' + f(l.h) + '" fill="' + esc(l.color) + '"/>');
      const maxC = Math.floor((L.LW - 5) / (3.2 * 0.6));
      const nm = l.name.length > maxC ? l.name.slice(0, maxC - 1) + '…' : l.name;
      out.push('<text x="3" y="' + f(l.y + l.h / 2 + 1.1) + '" font-size="3.2" font-weight="700" fill="#0f172a">' + esc(nm) + '</text>');
      if (i < L.lanes.length - 1) out.push('<line x1="0" x2="' + L.W + '" y1="' + f(l.y + l.h + 0.7) + '" y2="' + f(l.y + l.h + 0.7) + '" stroke="#cbd5e1" stroke-width="0.2"/>');
    });
    L.bars.forEach(b => {
      const show = b.kind === 'show';
      const style = show ? 'fill="#fff" stroke="#0f172a" stroke-width="0.3"'
        : b.kind === 'sc' ? 'fill="#f5f3ff" stroke="#7c3aed" stroke-width="0.3" stroke-dasharray="1,0.6"'
        : 'fill="#e0f2fe" stroke="#0284c7" stroke-width="0.3"';
      out.push('<rect x="' + f(b.x) + '" y="' + f(b.y) + '" width="' + f(b.w) + '" height="' + f(b.h) + '" rx="0.6" ' + style + '/>');
      if (show) out.push('<rect x="' + f(b.x) + '" y="' + f(b.y) + '" width="1.1" height="' + f(b.h) + '" fill="' + esc(b.color) + '"/>');
      if (b.lines.length) {
        const lh = b.fs * 1.2, top = b.y + (b.h - b.lines.length * lh) / 2 + b.fs * 0.85;
        out.push('<text x="' + f(b.x + (show ? 2.2 : 1.4)) + '" y="' + f(top) + '" font-size="' + f(b.fs) + '" font-weight="' + (b.strong ? 800 : 500) + '" fill="#0f172a">' +
          b.lines.map((t, i) => '<tspan x="' + f(b.x + (show ? 2.2 : 1.4)) + '" dy="' + (i ? f(lh) : 0) + '">' + esc(t) + '</tspan>').join('') + '</text>');
      }
    });
    L.hitos.forEach(h => {
      out.push('<line x1="' + f(h.x) + '" x2="' + f(h.x) + '" y1="' + (L.AX - 6) + '" y2="' + (L.H - 1) + '" stroke="#dc2626" stroke-width="0.3" stroke-dasharray="1.1,0.8"/>');
      const anchor = h.x > L.x1 - 30 ? 'end' : 'start';
      out.push('<text x="' + f(h.x + (anchor === 'end' ? -0.8 : 0.8)) + '" y="' + (L.AX - 7) + '" text-anchor="' + anchor + '" font-size="2.6" font-weight="700" fill="#991b1b">' + esc(h.label) + '</text>');
    });
    out.push('</svg>');
    return out.join('');
  }

  /** Una hoja de cronograma (apaisada) para un día. */
  function ganttSheet(list, d, idx, total, title, printed) {
    const L = layoutGantt(list, 273, 160);
    const bloques = list.filter(r => !r.aviso).length;
    const meta = [d ? dayLabel(d) : 'Todas las jornadas', (L ? L.lanes.length : 0) + ' escenarios', bloques + ' bloques'].join(' · ');
    const footerLeft = 'Showtime Regiduría · ' + title + ' · ' + (d ? dayLabel(d) : 'Todas las jornadas');
    return '<section class="sheet landscape">' +
      '<div class="hd"><div class="brand">Showtime · Cronograma</div><h1>' + esc(title) + '</h1><div class="meta">' + esc(meta) + '</div></div>' +
      (L ? '<div class="tbl">' + ganttSvg(L) + '</div>' : '<p class="empty">Nada que dibujar con estos filtros.</p>') +
      '<footer class="sheet-foot"><span>' + esc(footerLeft) + '</span><span>Impreso: ' + esc(printed) + '</span><span>Pág ' + (idx + 1) + '/' + total + '</span></footer>' +
      '</section>';
  }

  /**
   * Documento HTML completo.
   * opts: { rows: [...] (de rowsOf), days: [ISO], title, orient:'portrait'|'landscape', notes:bool, call:bool, now: Date }
   */
  function html(opts) {
    const o = opts || {};
    const rows = o.rows || [];
    const days = o.days && o.days.length ? o.days : [null];
    const gantt = o.format === 'gantt';                    // el cronograma es siempre apaisado
    const land = o.orient === 'landscape' || gantt;
    const printed = printedAt(o.now);
    const title = o.title || 'Evento';
    const sheets = days.map((d, idx) => {
      const list = rows.filter(r => !d || r.jornada === d);
      if (gantt) return ganttSheet(list, d, idx, days.length, title, printed);
      const dens = densityFor(list.length);
      const zones = [];
      list.forEach(r => { if (!r.aviso && zones.indexOf(r.zone) < 0) zones.push(r.zone); });
      const zoneOne = zones.length === 1 ? zones[0] : null;             // todas las filas en la misma zona → cabecera
      const showZone = !zoneOne;
      const showCall = !!o.call && list.some(r => !r.aviso && r.call);  // CALL solo si alguna fila la tiene
      const showNotes = !!o.notes;
      const cols = [{ h: 'Horario', w: 15 }, { h: 'Duración', w: 11 }]
        .concat(showCall ? [{ h: 'CALL', w: 7 }] : [])
        .concat(showZone ? [{ h: 'Escenario / zona', w: 19 }] : [])
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

  const API = { CONTENT, TYPE, rowsOf, densityFor, dayLabel, printedAt, daysOf, html, summary, launch, esc, layoutGantt, ganttSvg, fitLabel, wrapLines };
  if (isNode) module.exports = API;
  else root.ShowtimePrint = API;
})(typeof window !== 'undefined' ? window : globalThis);
