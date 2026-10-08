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
  const I = isNode ? require('./i18n.js') : root.ShowtimeI18n;   // idioma común de la suite

  /** Filtros de contenido: qué tipos de bloque entran. */
  const CONTENT = {
    all: { label: 'Todo el horario', kinds: ['show', 'sc', 'tarea', 'hito'] },
    shows: { label: 'Shows y Pruebas', kinds: ['show', 'sc'] },
    solo: { label: 'Solo Shows', kinds: ['show'] }
  };
  /** Casillas de tipo del modal (independientes: se pueden combinar). */
  const KINDS = [
    { k: 'show', label: 'Shows' },
    { k: 'sc', label: 'Pruebas (SC)' },
    { k: 'tarea', label: 'Tareas' },
    { k: 'hito', label: 'Hitos' }
  ];
  /** Píldoras «ghost»: contorno y color por tipo (SHOW negro · SOUNDCHECK púrpura · TAREA azul · HITO rojo).
   *  El texto sale del diccionario de idioma (I18N). */
  const TYPE = {
    show: { cls: 'p-show' },
    sc: { cls: 'p-prueba' },
    tarea: { cls: 'p-tarea' },
    hito: { cls: 'p-hito' }
  };
  /** Textos de la hoja impresa: rama «print» del diccionario común (i18n.js). Sin lang → el idioma activo de Showtime. */
  function T(lang) { return I.group('print', lang ? I.norm(lang) : I.getLang()); }
  /** Píldora de tipo en el idioma pedido. */
  function pillOf(kind, lang) {
    const t = TYPE[kind] || { cls: 'p-show' };
    return { txt: T(lang).pills[kind] || String(kind || '').toUpperCase(), cls: t.cls };
  }
  /** Convención de avisos: texto entre asteriscos («*** Restricciones de PA… ***») → fila de ancho completo. */
  const AVISO_RE = /\*\*\*/;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hexOk(c, d) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d; }
  function clean(s) { return String(s == null ? '' : s).replace(/\*\*\*/g, ' ').replace(/\s+/g, ' ').trim(); }

  /**
   * Filas de la tabla para una jornada (o todas).
   * opts: { day: ISO|'all', zone: id|'all', kinds: ['show','sc','tarea','hito'] (o content: 'all'|'shows'|'solo') }
   */
  function rowsOf(state, opts) {
    const o = opts || {};
    const kinds = Array.isArray(o.kinds) ? o.kinds.slice() : (CONTENT[o.content] || CONTENT.all).kinds;
    const blocks = C.buildBlocks(state, { mode: 'all', day: o.day || 'all' });
    const stageIds = ((state && state.escenarios) || []).map(e => e.id);   // orden de la configuración del evento
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
          zoneOrder: stageIds.indexOf(b.stageId) < 0 ? 1e6 : stageIds.indexOf(b.stageId),   // posición fija del carril en el cronograma
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

  function dayLabel(iso, lang) {
    const t = T(lang);
    if (!iso || iso === 'all') return t.noDay;
    const i = C.dayIndex(iso);
    const d = i === null ? null : new Date(Date.UTC(2000, 0, 1) + i * 864e5);
    if (!d) return iso;
    const opts = t.htmlLang === 'en'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
    return d.toLocaleDateString(t.locale, opts);
  }
  /** Fecha de impresión: DD/MM/AAAA (igual en los dos idiomas). */
  function printedAt(d) {
    const x = d || new Date();
    return pad2(x.getDate()) + '/' + pad2(x.getMonth() + 1) + '/' + x.getFullYear();
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

  /** Corta un texto a n caracteres como mucho sin partir palabras: acaba en «…» quitando palabras enteras. */
  function cutWords(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    if (n < 2) return '';
    const t = s.slice(0, n - 1);
    const sp = t.lastIndexOf(' ');
    if (sp <= 0) return '';                                  // una sola palabra que no cabe: mejor nada que una palabra amputada
    return t.slice(0, sp).replace(/[\s,;:.\-–]+$/, '') + '…';
  }

  /** Ancho aproximado (mm) de un texto sans-serif con letra de fs mm (negrita ≈ +10 %).
   *  Tabla por tipo de carácter: más fiel que contar caracteres (una «i» no ocupa lo que una «M»). */
  function textW(s, fs, bold) {
    let em = 0;
    for (const ch of String(s == null ? '' : s)) {
      if (ch === ' ') em += 0.28;
      else if ('iljI.,:;!|\'·'.indexOf(ch) >= 0) em += 0.26;
      else if ('ftr()[]/º°-'.indexOf(ch) >= 0) em += 0.35;
      else if ('mwMW'.indexOf(ch) >= 0) em += 0.86;
      else if (ch === '…' || ch === '—') em += 1.0;
      else if (ch === '–') em += 0.56;
      else if (/[A-ZÁÉÍÓÚÑÜÇ&]/.test(ch)) em += 0.70;
      else if (/[0-9]/.test(ch)) em += 0.57;
      else em += 0.56;
    }
    return em * fs * (bold ? 1.1 : 1);
  }

  /** Recorta un texto de una línea a maxW (mm) quitando palabras enteras del final y acabando en «…».
   *  Si ni la primera palabra cabe, devuelve la primera palabra (p. ej. la hora de un hito). */
  function fitText(s, fs, maxW, bold) {
    s = String(s || '');
    if (textW(s, fs, bold) <= maxW) return s;
    const w = s.split(' ');
    while (w.length > 1) {
      w.pop();
      const t = w.join(' ').replace(/[\s,;:.\/\-–]+$/, '') + '…';
      if (textW(t, fs, bold) <= maxW) return t;
    }
    return w[0];
  }

  /** Parte el texto en líneas que caben en maxW (mm), medidas con textW en negrita. Nunca parte una palabra:
   *  si no cabe todo, la última línea acaba en «…» quitando palabras enteras. Banda muy estrecha: solo la hora. */
  function wrapLines(name, time, maxW, fs, maxLines) {
    if (maxLines < 1) return [];
    const tOk = !!time && textW(time, fs) <= maxW;
    if (maxW < fs * 2.2) return tOk ? [time] : [];
    const words = String(name || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '', trunc = false;
    for (const w of words) {
      if (textW(w, fs, true) > maxW) { trunc = true; break; }   // no cabe ni sola: se corta aquí, sin partirla
      const cand = cur ? cur + ' ' + w : w;
      if (textW(cand, fs, true) <= maxW) cur = cand;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; trunc = true; }
    if (trunc && lines.length) {
      let last = lines[lines.length - 1];
      while (textW(last + '…', fs, true) > maxW && last.indexOf(' ') > 0) last = last.slice(0, last.lastIndexOf(' '));
      lines[lines.length - 1] = textW(last + '…', fs, true) <= maxW ? last + '…' : last;
    }
    if (tOk && lines.length < maxLines) lines.push(time);
    return lines;
  }

  /** Texto de una barra: nombre en negrita (hasta maxLines−1 líneas) y debajo el horario completo
   *  («14:00–15:15») o solo la hora de inicio si no cabe. complete = el nombre sale entero, sin «…». */
  function barText(name, time, maxW, fs, maxLines) {
    const words = String(name || '').split(/\s+/).filter(Boolean);
    if (maxLines < 1 || maxW < fs * 2.2) return { lines: [], complete: false };
    const hora = time.split('–')[0];
    const tLine = maxLines >= 2 || !words.length ? (textW(time, fs) <= maxW ? time : textW(hora, fs) <= maxW ? hora : '') : '';
    const nameLines = words.length ? wrapLines(name, '', maxW, fs, tLine ? maxLines - 1 : maxLines) : [];
    const last = nameLines[nameLines.length - 1] || '';
    const shown = nameLines.join(' ').replace(/…$/, '').split(/\s+/).filter(Boolean);
    const complete = words.length ? (shown.length === words.length && !/…$/.test(last)) : !!tLine;
    const lines = tLine && (nameLines.length || !words.length) ? nameLines.concat([tLine]) : nameLines;
    return { lines: lines, complete: complete };
  }

  /** A, B, … Z, AA, AB… (llamadas de shows). */
  function letters(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
    return s;
  }

  /** Nombre principal de un hito para la cabecera: sin aclaraciones entre paréntesis o corchetes
   *  («Curfew de camerinos (hora exacta TBC)» → «Curfew de camerinos») ni lo que va tras « · ». */
  function hitoName(name) {
    const n = clean(name).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').split(/\s+·\s+/)[0].trim();
    return n || clean(name);
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
   * De arriba abajo: pista de hitos (2 niveles alternos; los hitos a la misma hora van juntos), eje horario,
   * carriles (escenarios, con el nombre en vertical en una columna de 14 mm) y, si hace falta, la leyenda
   * de llamadas ①②③ de los bloques estrechos cuyo nombre no cabe. Ningún bloque queda vacío.
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
    const TOP = 6, LW = 14, GAP = 1.4, x0 = LW, x1 = W - 7;   // 7 mm a la derecha: la etiqueta 01:00 no se corta
    const X = t => x0 + (t - a) / (b - a) * (x1 - x0);
    const laneMap = new Map();
    items.filter(r => r.kind !== 'hito').slice().sort((p, q) => p.s - q.s).forEach(r => {
      if (!laneMap.has(r.zone)) laneMap.set(r.zone, { name: r.zone, color: r.zoneColor, items: [] });
      laneMap.get(r.zone).items.push(r);
    });
    const lanes = [];
    // Carriles en el orden de la configuración del evento: cada escenario, siempre en el mismo sitio
    // (los que no están en la configuración, al final, por orden de aparición).
    let seen = 0;
    laneMap.forEach(l => { l.order = Number.isFinite(l.items[0].zoneOrder) ? l.items[0].zoneOrder : 1e6; l.seen = seen++; });
    [...laneMap.values()].sort((p, q) => p.order - q.order || p.seen - q.seen).forEach(l => {
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

    // ── Hitos: un grupo por hora, en 2 niveles alternos. Anclaje inteligente: los del final del día (desde las 22:30)
    //    o cerca del borde derecho se escriben hacia la izquierda de su línea. Cada etiqueta se recorta sin pisar a otra. ──
    const HFS = 2.6, HROW = 3.4;
    const byTime = new Map();
    items.filter(r => r.kind === 'hito').forEach(r => {
      if (!byTime.has(r.s)) byTime.set(r.s, []);
      const n = hitoName(r.name);
      if (n && byTime.get(r.s).indexOf(n) < 0) byTime.get(r.s).push(n);
    });
    const hitos = [...byTime.entries()].sort((p, q) => p[0] - q[0])
      .map(([s, names], i) => ({ s: s, x: X(s), time: C.fmtHM(s), text: (C.fmtHM(s) + ' ' + names.join(' / ')).trim(), row: i % 2 }));
    const LATE = 22 * 60 + 30;
    hitos.forEach(h => {
      const late = (h.s % 1440) >= LATE || h.s >= 1440 || h.x > x0 + 0.7 * (x1 - x0);
      h.end = late && h.x - x0 > 40;                           // hacia la izquierda solo si hay sitio detrás
    });
    // Si una etiqueta que va hacia la derecha choca con una de las que vienen escritas hacia la izquierda,
    // también cambia de lado (de derecha a izquierda, en cascada), siempre que tenga sitio detrás.
    const ext = h => { const w = textW(h.text, HFS, true); return h.end ? [h.x - 0.8 - w, h.x - 0.8] : [h.x + 0.8, h.x + 0.8 + w]; };
    for (let i = hitos.length - 2; i >= 0; i--) {
      const h = hitos[i];
      if (h.end) continue;
      const e = ext(h), w = e[1] - e[0];
      const choca = hitos.slice(i + 1).some(o => { if (!o.end) return false; const oe = ext(o); return e[1] + 1.2 > oe[0] && e[0] < oe[1] + 1.2; });
      if (choca && h.x - 0.8 - w >= 0.5) h.end = true;
    }
    // Nivel: alterna con el anterior; si la etiqueta entera choca allí y en el otro nivel cabe, va al otro
    const placed = [[], []];
    hitos.forEach((h, i) => {
      const w = textW(h.text, HFS, true);
      const l = h.end ? h.x - 0.8 - w : h.x + 0.8, r = l + w;
      const free = k => placed[k].every(p => r + 1.2 <= p.l || l >= p.r + 1.2);
      const pref = i ? 1 - hitos[i - 1].row : 0;
      h.row = free(pref) ? pref : free(1 - pref) ? 1 - pref : pref;
      placed[h.row].push({ l: l, r: r });
    });
    hitos.forEach((h, i) => {
      const next = hitos.slice(i + 1).find(o => o.row === h.row);
      const prev = hitos.slice(0, i).reverse().find(o => o.row === h.row);
      let tx, avail;
      if (h.end) {
        tx = h.x - 0.8;
        avail = tx - (prev ? prev.endX + 1.2 : 0.5);
      } else {
        tx = h.x + 0.8;
        // si el siguiente de su nivel escribe hacia atrás, se le reserva su sitio (los del final del día mandan)
        let lim = next ? (next.end ? next.x - 0.8 - textW(next.text, HFS, true) - 1.2 : next.x - 1.2) : W - 0.5;
        lim = Math.max(lim, tx + textW(h.time, HFS, true));
        avail = lim - tx;
        if (!next && textW(h.text, HFS, true) > avail) {        // el último de su nivel: si cabe mejor, a la izquierda
          const availL = (h.x - 0.8) - (prev ? prev.endX + 1.2 : 0.5);
          if (availL > avail) { h.end = true; tx = h.x - 0.8; avail = availL; }
        }
      }
      h.label = fitText(h.text, HFS, avail, true);
      h.anchor = h.end ? 'end' : 'start'; h.tx = tx;
      h.endX = h.end ? tx : tx + textW(h.label, HFS, true);
    });
    const bandH = hitos.length ? Math.min(2, hitos.length) * HROW + 0.6 : 0;
    const tickY = TOP + bandH + 2.8;                          // línea base de las horas
    const lanesTop = tickY + 2.2;
    const nL = lanes.length;
    const totalRows = lanes.reduce((n, l) => n + l.rows, 0);

    // ── Carriles y barras; la leyenda resta alto a los carriles, así que se ajusta en unas pocas vueltas ──
    const LROW = 3.8, NARROW = 25;
    let legendN = 0, rowH = 0, fs = 0, bars = [], lanesBottom = 0, legendTop = 0;
    for (let pass = 0; pass < 5; pass++) {
      const legendH = legendN ? Math.ceil(legendN / 2) * LROW + 3 : 0;
      lanesBottom = H - 1 - legendH;
      legendTop = lanesBottom + 3;
      const avail = lanesBottom - lanesTop - (nL - 1) * GAP;
      rowH = Math.min(60, avail / totalRows);
      fs = Math.min(3.0, Math.max(2.4, rowH / 8));            // una sola letra para todo el cronograma (≈8.5 pt)
      let y = lanesTop;
      lanes.forEach(l => { l.y = y; l.h = l.rows * rowH; l.rowH = rowH; y += l.h + GAP; });
      bars = [];
      lanes.forEach((l, li) => l.items.forEach(r => {
        const e = Number.isFinite(r.e) ? r.e : r.s;
        const x = X(r.s), w = Math.max(0.8, X(e) - X(r.s));
        const time = C.fmtHM(r.s) + (Number.isFinite(r.e) ? '–' + C.fmtHM(r.e) : '');
        const h = rowH - 1;
        const maxLines = Math.max(0, Math.floor(h / (fs * 1.2)));
        const name = clean(r.name);
        const t = barText(name, time, w - (r.kind === 'show' ? 3.4 : 2.6), fs, maxLines);
        // Ancho ≥ 25 mm: nombre + horario (aunque haya que truncar). Estrecho: solo si el nombre cabe entero.
        const ok = t.lines.length && (w >= NARROW || t.complete);
        bars.push({ kind: r.kind, x: x, y: l.y + r.row * rowH + 0.5, w: w, h: h, color: r.zoneColor, s: r.s, lane: li, row: r.row,
          strong: isStrong(r), zone: r.zone, fs: fs, lines: ok ? t.lines : [], badge: ok ? 0 : -1, name: name, time: time });
      }));
      const n = bars.filter(bb => bb.badge < 0).length;
      if (n <= legendN) break;
      legendN = n;
    }
    // Llamadas por orden horario (y escenario), con 3 geometrías que se distinguen en blanco y negro:
    // shows → letra en cuadrado [A]; soundchecks → número en círculo ①; tareas → número en rombo ◆1. Leyenda en 2 columnas.
    const called = bars.filter(bb => bb.badge < 0).sort((p, q) => p.s - q.s || p.lane - q.lane || p.row - q.row);
    const cnt = { square: 0, circle: 0, diamond: 0 };
    called.forEach((bb, i) => {
      const shape = bb.kind === 'show' ? 'square' : bb.kind === 'sc' ? 'circle' : 'diamond';
      const n = ++cnt[shape];
      bb.badge = i + 1; bb.cx = bb.x + bb.w / 2; bb.cy = bb.y + bb.h / 2;
      bb.mark = { shape: shape, label: shape === 'square' ? letters(n) : String(n) };
    });
    const legend = [];
    if (called.length) {
      const rows = Math.ceil(called.length / 2), colW = (W - LW - 1) / 2;
      called.forEach((bb, i) => {
        const col = Math.floor(i / rows), row = i % rows;
        const x = LW + col * colW, y = legendTop + row * LROW;
        const tail = ' (' + bb.time + ')';
        const nm = bb.name ? fitText(bb.name, 2.6, colW - 6.8 - textW(tail, 2.6), false) : '';
        legend.push({ num: bb.badge, mark: bb.mark, x: x, y: y, text: (nm + tail).trim() });
      });
    }
    const ticks = [];
    for (let t = a; t <= b; t += step) ticks.push({ x: X(t), label: C.fmtHM(t) });
    return { W: W, H: H, TOP: TOP, tickY: tickY, bandH: bandH, hitoRow: HROW, hitoFs: HFS, a: a, b: b, step: step,
      x0: x0, x1: x1, LW: LW, lanes: lanes, bars: bars, ticks: ticks, hitos: hitos, lanesTop: lanesTop,
      lanesBottom: lanesBottom, legendTop: legendTop, legend: legend, rowH: rowH, fs: fs };
  }

  /** SVG vectorial inline del cronograma (sin gráficos de fondo: se imprime igual con o sin esa opción). */
  function ganttSvg(L) {
    const f = (n) => Math.round(n * 100) / 100;
    const out = [];
    // Distintivo de llamada: cuadrado (show) · círculo (soundcheck) · rombo (tarea); r = medio lado / radio
    const badge = (cx, cy, m, r) => {
      const st = ' fill="#fff" stroke="#0f172a" stroke-width="0.3"';
      const k = m.shape === 'diamond' ? 1.3 : 1;
      const shape = m.shape === 'square'
        ? '<rect x="' + f(cx - r) + '" y="' + f(cy - r) + '" width="' + f(2 * r) + '" height="' + f(2 * r) + '" rx="0.3"' + st + '/>'
        : m.shape === 'diamond'
          ? '<polygon points="' + [[cx, cy - r * k], [cx + r * k, cy], [cx, cy + r * k], [cx - r * k, cy]].map(p => f(p[0]) + ',' + f(p[1])).join(' ') + '"' + st + '/>'
          : '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + r + '"' + st + '/>';
      const fsz = m.label.length > 1 ? r * 0.95 : r * 1.2;
      return shape + '<text x="' + f(cx) + '" y="' + f(cy + fsz * 0.36) + '" text-anchor="middle" font-size="' + f(fsz) + '" font-weight="800" fill="#0f172a">' + esc(m.label) + '</text>';
    };
    out.push('<svg class="gantt" viewBox="0 0 ' + L.W + ' ' + L.H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cronograma de escenarios">');
    L.ticks.forEach(t => {
      out.push('<line x1="' + f(t.x) + '" x2="' + f(t.x) + '" y1="' + f(L.tickY + 0.8) + '" y2="' + f(L.lanesBottom) + '" stroke="#e2e8f0" stroke-width="0.15"/>');
      out.push('<text x="' + f(t.x) + '" y="' + f(L.tickY) + '" text-anchor="middle" font-size="2.8" fill="#334155">' + esc(t.label) + '</text>');
    });
    L.lanes.forEach((l, i) => {
      out.push('<rect x="0" y="' + f(l.y) + '" width="1.2" height="' + f(l.h) + '" fill="' + esc(l.color) + '"/>');
      // Nombre del escenario en vertical (de abajo arriba), centrado en su carril; 1 o 2 líneas
      let nl = wrapLines(l.name, '', l.h - 3, 3.2, 2);
      if (!nl.length) nl = [fitText(l.name, 3.2, l.h - 3, true)];
      const cy = f(l.y + l.h / 2), xs = nl.length === 1 ? [8.4] : [6.4, 10.6];
      nl.forEach((t, k) => {
        out.push('<text transform="rotate(-90 ' + xs[k] + ' ' + cy + ')" x="' + xs[k] + '" y="' + cy + '" text-anchor="middle" font-size="3.2" font-weight="700" fill="#0f172a">' + esc(t) + '</text>');
      });
      if (i < L.lanes.length - 1) out.push('<line x1="0" x2="' + L.W + '" y1="' + f(l.y + l.h + 0.7) + '" y2="' + f(l.y + l.h + 0.7) + '" stroke="#cbd5e1" stroke-width="0.2"/>');
    });
    // Líneas de hito por detrás de los bloques: guía limpia que no tapa nombres ni llamadas
    L.hitos.forEach(h => out.push('<line x1="' + f(h.x) + '" x2="' + f(h.x) + '" y1="' + f(L.tickY + 0.8) + '" y2="' + f(L.lanesBottom) + '" stroke="#dc2626" stroke-width="0.3" stroke-dasharray="1.1,0.8"/>'));
    L.bars.forEach(b => {
      const show = b.kind === 'show';
      const style = show ? 'fill="#fff" stroke="#0f172a" stroke-width="0.3"'
        : b.kind === 'sc' ? 'fill="#f5f3ff" stroke="#7c3aed" stroke-width="0.3" stroke-dasharray="1,0.6"'
        : 'fill="#e0f2fe" stroke="#0284c7" stroke-width="0.3"';
      out.push('<rect x="' + f(b.x) + '" y="' + f(b.y) + '" width="' + f(b.w) + '" height="' + f(b.h) + '" rx="0.6" ' + style + '/>');
      if (show) out.push('<rect x="' + f(b.x) + '" y="' + f(b.y) + '" width="1.1" height="' + f(b.h) + '" fill="' + esc(b.color) + '"/>');
      if (b.lines.length) {
        const lh = b.fs * 1.2, top = b.y + (b.h - b.lines.length * lh) / 2 + b.fs * 0.85;
        const tx = f(b.x + (show ? 2.2 : 1.4));
        const timeLast = /^\d\d:\d\d(–\d\d:\d\d)?$/.test(b.lines[b.lines.length - 1]);   // la última línea es el horario
        out.push('<text x="' + tx + '" y="' + f(top) + '" font-size="' + f(b.fs) + '" fill="#0f172a">' +
          b.lines.map((t, i) => '<tspan x="' + tx + '" dy="' + (i ? f(lh) : 0) + '" font-weight="' +
            (timeLast && i === b.lines.length - 1 ? 500 : (b.strong ? 800 : 700)) + '">' + esc(t) + '</tspan>').join('') + '</text>');
      } else if (b.badge > 0) {
        out.push(badge(b.cx, b.cy, b.mark, 2));
      }
    });
    // Hitos: etiqueta horizontal en la pista superior (2 niveles).
    L.hitos.forEach(h => {
      const ty = f(L.TOP + h.row * L.hitoRow + L.hitoFs * 0.9 + 0.3);
      out.push('<text x="' + f(h.tx) + '" y="' + ty + '" text-anchor="' + h.anchor + '" font-size="' + L.hitoFs + '" font-weight="700" fill="#991b1b">' + esc(h.label) + '</text>');
    });
    // Leyenda de llamadas (bloques estrechos)
    if (L.legend.length) {
      out.push('<line x1="' + L.LW + '" x2="' + (L.W - 1) + '" y1="' + f(L.legendTop - 1.6) + '" y2="' + f(L.legendTop - 1.6) + '" stroke="#cbd5e1" stroke-width="0.2"/>');
      L.legend.forEach(it => {
        out.push(badge(it.x + 2.2, it.y + 1.2, it.mark, 1.6));
        out.push('<text x="' + f(it.x + 5.2) + '" y="' + f(it.y + 2.1) + '" font-size="2.6" fill="#0f172a">' + esc(it.text) + '</text>');
      });
    }
    out.push('</svg>');
    return out.join('');
  }

  /** Una hoja de cronograma (apaisada) para un día. */
  function ganttSheet(list, d, idx, total, title, printed, lang) {
    const t = T(lang);
    const L = layoutGantt(list, 273, 164);
    const bloques = list.filter(r => !r.aviso).length;
    const meta = [d ? dayLabel(d, lang) : t.allDays, (L ? L.lanes.length : 0) + ' ' + t.stages, bloques + ' ' + t.blocks].join(' · ');
    const footerLeft = t.footer + ' · ' + title + ' · ' + (d ? dayLabel(d, lang) : t.allDays);
    return '<section class="sheet landscape">' +
      '<div class="hd"><div class="brand">' + esc(t.brandGantt) + '</div><h1>' + esc(title) + '</h1><div class="meta">' + esc(meta) + '</div></div>' +
      (L ? '<div class="tbl">' + ganttSvg(L) + '</div>' : '<p class="empty">' + esc(t.emptyGantt) + '</p>') +
      '<footer class="sheet-foot"><span>' + esc(footerLeft) + '</span><span>' + esc(t.printed) + esc(printed) + '</span><span>' + esc(t.page) + (idx + 1) + '/' + total + '</span></footer>' +
      '</section>';
  }

  /**
   * Documento HTML completo.
   * opts: { rows: [...] (de rowsOf), days: [ISO], title, orient:'portrait'|'landscape', notes:bool, call:bool, now: Date,
   *         lang:'es'|'en' (por defecto, el idioma activo de Showtime), full:bool (contenido = todo el horario) }
   */
  function html(opts) {
    const o = opts || {};
    const lang = o.lang ? I.norm(o.lang) : I.getLang();   // sin lang: el idioma activo de Showtime
    const t = T(lang);
    const rows = o.rows || [];
    const days = o.days && o.days.length ? o.days : [null];
    const gantt = o.format === 'gantt';                    // el cronograma es siempre apaisado
    const land = o.orient === 'landscape' || gantt;
    const printed = printedAt(o.now);
    const title = o.title || 'Evento';
    const sheets = days.map((d, idx) => {
      const list = rows.filter(r => !d || r.jornada === d);
      if (gantt) return ganttSheet(list, d, idx, days.length, title, printed, lang);
      const dens = densityFor(list.length);
      const zones = [];
      list.forEach(r => { if (!r.aviso && zones.indexOf(r.zone) < 0) zones.push(r.zone); });
      const zoneOne = zones.length === 1 ? zones[0] : null;             // todas las filas en la misma zona → cabecera
      const showZone = !zoneOne;
      const showCall = !!o.call && list.some(r => !r.aviso && r.call);  // CALL solo si alguna fila la tiene
      const showNotes = !!o.notes;
      const cols = [{ h: t.cols.time, w: 15 }, { h: t.cols.dur, w: 11 }]
        .concat(showCall ? [{ h: t.cols.call, w: 7 }] : [])
        .concat(showZone ? [{ h: t.cols.zone, w: 19 }] : [])
        .concat([{ h: t.cols.type, w: 15 }, { h: t.cols.name, w: 0 }])
        .concat(showNotes ? [{ h: t.cols.notes, w: 22 }] : []);
      const fixed = cols.reduce((a, c) => a + c.w, 0);
      const cg = '<colgroup>' + cols.map(c => '<col style="width:' + (c.w ? c.w : Math.max(20, 100 - fixed)) + '%">').join('') + '</colgroup>';
      const head = '<tr>' + cols.map(c => '<th>' + esc(c.h) + '</th>').join('') + '</tr>';
      const sepAt = list.findIndex((r, i) => i > 0 && /apertura de puertas|apertura recinto|doors|doors open|gates/i.test(r.name));
      const body = list.map((r, i) => {
        if (r.aviso) {
          const txt = clean(AVISO_RE.test(r.name) ? r.name : r.notes);
          return '<tr class="aviso"><td colspan="' + cols.length + '">' + esc(txt) + '</td></tr>';
        }
        const cells = ['<td class="t">' + esc(r.start) + (r.end ? ' – ' + esc(r.end) : '') + '</td>', '<td class="n">' + esc(r.dur) + '</td>'];
        if (showCall) cells.push('<td class="n">' + esc(r.call) + '</td>');
        if (showZone) cells.push('<td class="z"><i style="background:' + esc(r.zoneColor) + '"></i>' + esc(r.zone) + '</td>');
        const pill = pillOf(r.kind, lang);
        cells.push('<td><span class="pill ' + pill.cls + '">' + esc(pill.txt) + '</span></td>');
        cells.push('<td class="name' + (isStrong(r) ? ' strong' : '') + '">' + esc(clean(r.name)) + '</td>');
        if (showNotes) cells.push('<td class="notes">' + esc(clean(r.notes)) + '</td>');
        return '<tr' + (i === sepAt ? ' class="sep"' : '') + '>' + cells.join('') + '</tr>';
      }).join('');
      const metaParts = [d ? dayLabel(d, lang) : t.allDays, list.length + ' ' + t.blocks];
      if (zoneOne) metaParts.push(t.zone + zoneOne);
      else if (zones.length > 1) metaParts.push(t.allStages);
      if (o.full) metaParts.push(t.full);
      const footerLeft = t.footer + ' · ' + title + ' · ' + (d ? dayLabel(d, lang) : t.allDays);
      const footerRight = t.page + (idx + 1) + '/' + days.length;
      return '<section class="sheet ' + (land ? 'landscape' : 'portrait') + ' ' + dens.cls + '">' +
        '<div class="hd"><div class="brand">' + esc(t.brand) + '</div><h1>' + esc(title) + '</h1><div class="meta">' + esc(metaParts.join(' · ')) + '</div></div>' +
        (list.length
          ? '<div class="tbl"><table>' + cg + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
          : '<p class="empty">' + esc(t.empty) + '</p>') +
        '<footer class="sheet-foot"><span>' + esc(footerLeft) + '</span><span>' + esc(t.printed) + esc(printed) + '</span><span>' + esc(footerRight) + '</span></footer>' +
        '</section>';
    }).join('');
    return '<!doctype html><html lang="' + t.htmlLang + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
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

  const API = { CONTENT, KINDS, TYPE, rowsOf, densityFor, dayLabel, printedAt, daysOf, html, summary, launch, esc, layoutGantt, ganttSvg, fitLabel, wrapLines, cutWords, textW, fitText, letters, hitoName };
  if (isNode) module.exports = API;
  else root.ShowtimePrint = API;
})(typeof window !== 'undefined' ? window : globalThis);
