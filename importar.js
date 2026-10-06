/* Showtime — importar.js · «Pegar horario» (ESPEC-2c, parte A)
 * Lee tablas (Excel/Numbers/Sheets pegadas, .csv, .tsv) y texto libre (PDF, WhatsApp, correo),
 * PROPONE un mapeo y una vista previa, y solo importa lo que el regidor confirma.
 * Puro: sin DOM. Necesita core.js (ShowtimeCore). Tests: node tests/importar.test.js
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.ShowtimeCore;
  const pad2 = n => String(n).padStart(2, '0');

  // ── Texto ───────────────────────────────────────────────────────────
  /** minúsculas, sin acentos, espacios simples */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function cleanName(s) {
    return String(s == null ? '' : s).replace(/^[\s\-–—|·•:,;*>]+|[\s\-–—|·•:,;*<]+$/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Palabras pegadas al copiar de un PDF: «LlegaOmega» → «Llega Omega» (minúscula seguida de mayúscula).
   *  Excepciones: Mc/Mac (McCartney, MacDonald), una sola minúscula delante (iPhone, eBay) y siglas (DJ, PA).
   *  Devuelve { text, changes:[['LlegaOmega','Llega Omega'], …] } — el cambio se AVISA en la fila. */
  function splitGlued(line) {
    const changes = [];
    const text = String(line == null ? '' : line).replace(/\S+/g, tok => {
      const out = tok.replace(/([a-záéíóúñü]{2,})(?=[A-ZÁÉÍÓÚÑÜ])/g, (m, low, off) => {
        const before = tok.slice(0, off + m.length);
        if (/(^|[^A-Za-zÁÉÍÓÚÑÜáéíóúñü])Mac$/.test(before)) return m;   // MacDonald
        return m + ' ';
      });
      if (out !== tok) changes.push([tok, out]);
      return out;
    });
    return { text, changes };
  }

  // ── Tipo de entrada propuesto (el regidor lo confirma o lo cambia en la vista previa) ──
  // show | sc (soundcheck) | tarea | hito
  const TIPO_KEYS = ['show', 'sc', 'tarea', 'hito'];
  const TIPO_LABEL = { show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Hito' };
  const TAREA_RE = /\b(comida|comidas|almuerzo|cena|cenas|desayuno|catering|montaje|desmontaje|carga|descarga|get ?in|get ?out|load ?in|load ?out|pruebas? de (?:luces|luz|video|iluminacion|led)|ensayo|ensayos|reunion|briefing|acreditacion|acreditaciones|transfer|traslado|traslados|hotel|check ?in|check ?out|limpieza|comer|parada|pausa|descanso|break|line ?check|linecheck)\b/;
  const HITO_RE = /\b(puertas|apertura|cierre de puertas|curfew|toque de queda|fin de (?:sonido|evento|jornada|actividad|pruebas|prueba|soundcheck)|llegada|llega|llegan|salida|desalojo|hora limite|limite de sonido)\b/;
  const SC_HEAD = /^(pruebas? de sonido|soundcheck|sound check|pruebas?|sc)\b[\s:\-–—·.]*/i;
  const SC_TAIL = /[\s:\-–—·(\[]+(pruebas? de sonido|soundcheck|sound check|prueba)[)\]]?$/i;
  const SHOW_HEAD = /^(show|concierto|actuacion|actuación)\b[\s:\-–—·.]*/i;

  /** Tipo escrito en una columna «Tipo» → clave, o null. */
  function tipoFromText(t) {
    const n = norm(t);
    if (!n) return null;
    if (/^(hito|hitos|milestone|marca|momento)$/.test(n)) return 'hito';
    if (/^(tarea|tareas|task|produccion|operativa|logistica)$/.test(n)) return 'tarea';
    if (/^(sc|soundcheck|sound check|prueba|pruebas|prueba de sonido|line check)$/.test(n)) return 'sc';
    if (/^(show|concierto|actuacion|banda|directo|live)$/.test(n)) return 'show';
    return null;
  }

  /** Propone el tipo por la columna «Tipo» o por palabras del nombre. Puede limpiar el nombre
   *  («Prueba Omega» → soundcheck de «Omega»). Devuelve { tipo, banda, why }. */
  function proposeTipo(rec, defMode) {
    const def = defMode === 'sc' ? 'sc' : 'show';
    const byCol = tipoFromText(rec.tipoTxt);
    let banda = rec.banda || '';
    if (byCol) return { tipo: byCol, banda, why: 'columna Tipo' };
    const n = norm(banda);
    let m;
    if ((m = TAREA_RE.exec(n))) return { tipo: 'tarea', banda, why: '«' + m[1] + '»' };
    if ((m = SC_HEAD.exec(banda)) && banda.slice(m[0].length).trim()) return { tipo: 'sc', banda: banda.slice(m[0].length), why: '«' + m[1] + '»' };
    if ((m = SC_TAIL.exec(banda)) && banda.slice(0, m.index).trim()) return { tipo: 'sc', banda: banda.slice(0, m.index), why: '«' + m[1] + '»' };
    if ((m = HITO_RE.exec(n))) return { tipo: 'hito', banda, why: '«' + m[1] + '»' };
    if ((m = SHOW_HEAD.exec(banda)) && banda.slice(m[0].length).trim()) return { tipo: 'show', banda: banda.slice(m[0].length), why: '«' + m[1] + '»' };
    return { tipo: def, banda, why: '' };
  }

  // ── Horas ───────────────────────────────────────────────────────────
  /** "21:00", "21.00", "21h", "21h30", "2100", "930", "21:00:00", "9:00 PM", "9pm", "25:30" (= 01:30).
   *  Devuelve { hm:'HH:MM', warn?:'…' } o null. */
  function parseTime(raw) {
    let t = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, function (m, i, s) { return /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '') ? ':' : ''; });
    if (!t) return null;
    let ap = null;
    const mAp = /(a|p)m$/.exec(t);
    if (mAp) { ap = mAp[1]; t = t.slice(0, -2); }
    let h, mi;
    let m;
    if ((m = /^(\d{1,2})[:h](\d{2})(?::\d{2})?$/.exec(t))) { h = +m[1]; mi = +m[2]; }
    else if ((m = /^(\d{1,2})h?$/.exec(t)) && (ap || /h$/.test(t))) { h = +m[1]; mi = 0; }
    else if ((m = /^(\d{1,2})(\d{2})$/.exec(t)) && !ap) { h = +m[1]; mi = +m[2]; }
    else return null;
    if (mi > 59) return null;
    let warn;
    if (ap) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (ap === 'p' ? 12 : 0);
    }
    if (h >= 24 && h <= 29) { warn = pad2(h) + ':' + pad2(mi) + ' se lee como ' + pad2(h - 24) + ':' + pad2(mi) + ' (madrugada)'; h -= 24; }
    if (h > 23) return null;
    return warn ? { hm: pad2(h) + ':' + pad2(mi), warn } : { hm: pad2(h) + ':' + pad2(mi) };
  }

  /** "21:00-22:15", "21:00 – 22:15", "21h a 22h" → { ini, fin } o null */
  function parseRange(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = /^(.+?)\s*(?:-|–|—|a|hasta|to|>|\/)\s*(.+)$/i.exec(s);
    if (!m) return null;
    const a = parseTime(m[1]), b = parseTime(m[2]);
    return a && b ? { ini: a, fin: b } : null;
  }

  // ── Fechas ──────────────────────────────────────────────────────────
  const MESES = { ene: 1, enero: 1, jan: 1, january: 1, feb: 2, febrero: 2, february: 2, mar: 3, marzo: 3, march: 3, abr: 4, abril: 4, apr: 4, april: 4,
    may: 5, mayo: 5, jun: 6, junio: 6, june: 6, jul: 7, julio: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8, sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
    oct: 10, octubre: 10, october: 10, nov: 11, noviembre: 11, november: 11, dic: 12, diciembre: 12, dec: 12, december: 12 };
  const DIAS = { lun: 1, lunes: 1, mon: 1, monday: 1, mar: 2, martes: 2, tue: 2, tuesday: 2, mie: 3, miercoles: 3, wed: 3, wednesday: 3,
    jue: 4, jueves: 4, thu: 4, thursday: 4, vie: 5, viernes: 5, fri: 5, friday: 5, sab: 6, sabado: 6, sat: 6, saturday: 6, dom: 0, domingo: 0, sun: 0, sunday: 0 };

  function isoOk(y, mo, d) { const iso = y + '-' + pad2(mo) + '-' + pad2(d); return C.dayIndex(iso) !== null ? iso : null; }
  function weekdayOf(iso) { return new Date(Date.UTC(2000, 0, 1) + C.dayIndex(iso) * 864e5).getUTCDay(); }

  /** Fecha suelta → { iso, warn? } o null.
   *  ctx: { year, days:[iso...] } (jornadas del evento, para «vie 10» o «viernes»). */
  function parseDate(raw, ctx) {
    const c = ctx || {};
    const s = norm(raw).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const year = c.year || new Date().getFullYear();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { const iso = isoOk(+m[1], +m[2], +m[3]); return iso ? { iso } : null; }
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/.exec(s))) {
      let y = m[3] ? +m[3] : year; if (y < 100) y += 2000;
      const iso = isoOk(y, +m[2], +m[1]); return iso ? { iso } : null;
    }
    // [día-semana] 10 [de] jul[io] [2026]
    const tok = s.split(/[\s\-\/]+/).filter(x => x && x !== 'de' && x !== 'del');
    let wd = null, dd = null, mo = null, yy = null;
    for (const t of tok) {
      if (DIAS[t] !== undefined && wd === null && dd === null) wd = DIAS[t];
      else if (/^\d{1,2}$/.test(t) && dd === null) dd = +t;
      else if (MESES[t] && mo === null) mo = MESES[t];
      else if (/^\d{4}$/.test(t)) yy = +t;
      else return null;                                    // palabra que no es fecha
    }
    if (dd !== null && mo !== null) { const iso = isoOk(yy || year, mo, dd); return iso ? { iso } : null; }
    const days = c.days || [];
    if (dd !== null) {                                     // «vie 10»: el día 10 del evento
      const hit = days.filter(d => +d.slice(8) === dd && (wd === null || weekdayOf(d) === wd));
      if (hit.length === 1) return { iso: hit[0] };
      return null;
    }
    if (wd !== null) {                                     // «viernes»: el viernes del evento, si solo hay uno
      const hit = days.filter(d => weekdayOf(d) === wd);
      if (hit.length === 1) return { iso: hit[0], warn: '«' + String(raw).trim() + '» se lee como ' + hit[0] };
    }
    return null;
  }

  // ── Tablas ──────────────────────────────────────────────────────────
  /** ¿Tabla o texto libre? Devuelve { kind:'tabla', sep } o { kind:'texto' } */
  function detect(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { kind: 'vacio' };
    for (const sep of ['\t', ';', ',']) {
      const counts = lines.map(l => splitRow(l, sep).length);
      const withSep = counts.filter(n => n >= 2).length;
      if (withSep >= Math.max(1, Math.ceil(lines.length * 0.6))) {
        if (sep === ',' && lines.some(l => /\d,\d/.test(l) && !/["']/.test(l)) && withSep < lines.length) continue;
        return { kind: 'tabla', sep };
      }
    }
    return { kind: 'texto' };
  }

  /** Divide una línea respetando comillas (CSV). */
  function splitRow(line, sep) {
    if (sep === '\t') return line.split('\t').map(x => x.trim());
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parseTable(text, sep) {
    return String(text || '').split(/\r?\n/).filter(l => l.trim()).map(l => splitRow(l, sep));
  }

  const KEYS = ['banda', 'tipo', 'escenario', 'jornada', 'inicio', 'fin', 'duracion', 'call', 'notas', 'ignorar'];
  const KEY_LABEL = { banda: 'Banda', tipo: 'Tipo', escenario: 'Escenario', jornada: 'Jornada', inicio: 'Inicio', fin: 'Fin', duracion: 'Duración (min)', call: 'CALL', notas: 'Notas', ignorar: 'Ignorar columna' };
  const HEADERS = {
    tipo: ['tipo', 'type', 'categoria', 'category', 'clase', 'kind'],
    banda: ['artista', 'artistas', 'artist', 'banda', 'band', 'grupo', 'nombre', 'name', 'act', 'line up', 'lineup'],
    escenario: ['escenario', 'stage', 'sala', 'room', 'lugar', 'espacio'],
    jornada: ['dia', 'fecha', 'jornada', 'day', 'date'],
    inicio: ['inicio', 'hora', 'start', 'begin', 'desde', 'empieza', 'comienzo', 'hora inicio', 'horario', 'show'],
    fin: ['fin', 'end', 'finish', 'hasta', 'termina', 'hora fin', 'final'],
    duracion: ['duracion', 'dur', 'min', 'mins', 'minutos', 'length', 'duration'],
    call: ['call', 'llamada', 'aviso'],
    notas: ['notas', 'nota', 'notes', 'obs', 'observaciones', 'comentarios', 'comments', 'info']
  };

  /** Si la fila parece cabecera, devuelve el mapeo propuesto; si no, null. */
  function guessHeader(row) {
    const map = row.map(cell => {
      const n = norm(cell);
      if (!n) return 'ignorar';
      for (const k of Object.keys(HEADERS)) if (HEADERS[k].indexOf(n) >= 0) return k;
      for (const k of Object.keys(HEADERS)) if (HEADERS[k].some(w => w.length > 3 && n.split(/[\s_\-\/]+/).indexOf(w) >= 0)) return k;
      return null;
    });
    const known = map.filter(k => k && k !== 'ignorar').length;
    const looksData = row.some(cell => parseTime(cell) || parseRange(cell));
    if (known >= 2 || (known >= 1 && !looksData)) return map.map(k => k || 'ignorar');
    return null;
  }

  /** Sin cabecera: propone el mapeo por el contenido de cada columna. */
  function guessColumns(rows, ctx) {
    const n = Math.max.apply(null, rows.map(r => r.length).concat([0]));
    const stages = (ctx && ctx.stageNames || []).map(norm);
    const stat = [];
    for (let c = 0; c < n; c++) {
      const cells = rows.map(r => r[c] || '').filter(x => x.trim());
      const f = fn => cells.length ? cells.filter(fn).length / cells.length : 0;
      stat.push({ c,
        time: f(x => parseTime(x) || parseRange(x)), range: f(x => parseRange(x)),
        date: f(x => parseDate(x, ctx)), int: f(x => /^\d{1,3}$/.test(x.trim()) && +x >= 5 && +x <= 600),
        stage: f(x => stages.indexOf(norm(x)) >= 0), text: f(x => /[a-zñáéíóú]/i.test(x)), len: cells.length ? cells.reduce((a, x) => a + x.length, 0) / cells.length : 0 });
    }
    const map = new Array(n).fill('ignorar');
    const take = (pred, key) => { const s = stat.find(x => map[x.c] === 'ignorar' && pred(x)); if (s) map[s.c] = key; return !!s; };
    take(x => x.time >= 0.6, 'inicio');
    if (!stat.some(x => map[x.c] === 'inicio' && x.range >= 0.6)) take(x => x.time >= 0.6, 'fin');
    take(x => x.date >= 0.6, 'jornada');
    take(x => x.stage >= 0.5, 'escenario');
    take(x => x.int >= 0.6, 'duracion');
    take(x => x.text >= 0.6, 'banda');
    if (!map.includes('escenario')) take(x => x.text >= 0.6 && x.len <= 20, 'escenario');
    take(x => x.text >= 0.5, 'notas');
    return map;
  }

  /** Filas de tabla + mapeo → registros. */
  function tableRecords(rows, map, ctx) {
    return rows.map((r, i) => {
      const rec = { src: i, raw: r.join(' | '), banda: '', tipoTxt: '', escenario: '', jornadaTxt: '', inicioTxt: '', finTxt: '', duracion: '', callTxt: '', notas: '' };
      r.forEach((cell, c) => {
        const k = map[c]; const v = String(cell || '').trim(); if (!v || !k || k === 'ignorar') return;
        if (k === 'banda') rec.banda = rec.banda ? rec.banda + ' ' + v : v;
        else if (k === 'escenario') rec.escenario = v;
        else if (k === 'tipo') rec.tipoTxt = v;
        else if (k === 'jornada') rec.jornadaTxt = v;
        else if (k === 'inicio') rec.inicioTxt = v;
        else if (k === 'fin') rec.finTxt = v;
        else if (k === 'duracion') rec.duracion = v;
        else if (k === 'call') rec.callTxt = v;
        else if (k === 'notas') rec.notas = rec.notas ? rec.notas + ' · ' + v : v;
      });
      return interpret(rec, ctx);
    });
  }

  // ── Texto libre ─────────────────────────────────────────────────────
  // Hora con separador (21:00, 21.00, 21h, 21h30, 9pm, 9:00 PM). Sin separador NO cuenta (no confundir «Blink 182»).
  const TIME_RE = /(\d{1,2})(?:[:.h](\d{2}))(?::\d{2})?\s*(?:([ap])\.?\s?m\.?)?(?![\d])|(\d{1,2})\s*h(?![a-zñ\d])|(\d{1,2})\s*([ap])\.?\s?m\.?(?![a-z])/gi;

  function findTimes(line) {
    const out = []; let m; TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(line))) { const t = parseTime(m[0]); if (t) out.push({ t, i: m.index, j: m.index + m[0].length }); }
    return out;
  }

  /** Busca una fecha en cualquier parte de la línea («VIERNES 10 JULIO», «10/07», «vie 10»). */
  function findDate(line, ctx, needNumber) {
    const words = line.split(/\s+/);
    for (let len = Math.min(5, words.length); len >= 1; len--) {
      for (let a = 0; a + len <= words.length; a++) {
        const chunk = words.slice(a, a + len).join(' ');
        if (needNumber && !/\d/.test(chunk)) continue;      // en una línea con hora, «sábado» suelto puede ser parte del nombre
        const d = parseDate(chunk, ctx);
        if (d) return { d, rest: words.slice(0, a).concat(words.slice(a + len)).join(' ') };
      }
    }
    return null;
  }

  function findStage(text, stageNames) {
    const n = ' ' + norm(text).replace(/[()\[\]@·|,\-–—:]/g, ' ') + ' ';
    const sorted = stageNames.slice().sort((a, b) => b.length - a.length);
    for (const s of sorted) { const k = norm(s); if (k && n.indexOf(' ' + k + ' ') >= 0) return s; }
    return null;
  }

  function removeWord(text, word) {
    const k = norm(word); if (!k) return text;
    const parts = text.split(/(\s+)/); const toks = parts.filter((x, i) => i % 2 === 0);
    // quitar la secuencia de palabras que coincide (sin acentos)
    const w = k.split(' '); const toksN = toks.map(t => norm(t.replace(/[()\[\]@·|,:]/g, '')));
    for (let i = 0; i + w.length <= toks.length; i++) {
      if (w.every((x, j) => toksN[i + j] === x)) { toks.splice(i, w.length); return toks.join(' '); }
    }
    return text;
  }

  /** Texto libre → registros. Líneas solo con fecha o con escenario hacen de CABECERA para las siguientes. */
  function textRecords(text, ctx) {
    const stageNames = (ctx && ctx.stageNames) || [];
    const recs = [], ignored = [];
    let curDay = '', curStage = '';
    String(text || '').split(/\r?\n/).forEach((line00, i) => {
      // Comentarios entre *** … *** (avisos de la hoja de ruta): no son entradas
      if (/^\s*\*{2,}.*\*{2,}\s*$/.test(line00)) { ignored.push({ n: i + 1, line: line00.trim() }); return; }
      // PDF con columnas: lo que va tras un tabulador o 3+ espacios DESPUÉS del nombre son notas
      let line0 = line00.replace(/\u00a0/g, ' '), colNote = '';
      const cols = line0.trim().split(/\t+|\s{3,}/);
      if (cols.length >= 3 && findTimes(cols[0]).length && !findTimes(cols.slice(2).join(' ')).length) {
        colNote = cols.slice(2).join(' · '); line0 = cols[0] + ' ' + cols[1];
      }
      const glued = splitGlued(line0);
      const line = glued.text.replace(/[*_~]/g, ' ').replace(/^\s*[•·\-–—>]+\s*/, '').replace(/\s+/g, ' ').trim();
      if (!line) return;
      const times = findTimes(line);
      if (!times.length) {
        const fd = findDate(line, ctx);
        if (fd && !/[a-z]{3,}/i.test(norm(fd.rest).replace(/\b(de|del|jornada|dia|day)\b/g, ''))) { curDay = fd.d.iso; return; }
        // Cabecera con fecha completa y más texto («HOJA DE RUTA · VIERNES 10 JULIO»)
        const fdn = findDate(line, ctx, true);
        if (fdn) { curDay = fdn.d.iso; return; }
        const st = findStage(line, stageNames);
        if (st) { curStage = st; return; }
        const m = /^(?:escenario|stage|sala)\s*[:\-–]?\s*(.+)$/i.exec(norm(line)) ? /^(?:escenario|stage|sala)\s*[:\-–]?\s*(.+)$/i.exec(line) : null;
        if (m) { curStage = cleanName(m[1]); return; }
        ignored.push({ n: i + 1, line });
        return;
      }
      let rest = line;
      const t1 = times[0], t2 = times[1];
      let ini = t1.t, fin = null;
      if (t2) {
        const between = line.slice(t1.j, t2.i);
        if (/^\s*(?:-|–|—|a|hasta|to|>|\/)?\s*$/i.test(between)) fin = t2.t;
      }
      const cut = [t1].concat(fin ? [t2] : []);
      for (let k = cut.length - 1; k >= 0; k--) rest = rest.slice(0, cut[k].i) + ' ' + rest.slice(cut[k].j);
      rest = rest.replace(/^\s*(?:-|–|—|a|hasta|to|>|\/)\s+/i, ' ').replace(/\s+(?:-|–|—|hasta|to)\s*$/i, ' ');
      let jornadaTxt = '';
      const fd = findDate(rest, ctx, true);
      if (fd) { jornadaTxt = fd.d.iso; rest = fd.rest; }
      let escenario = '', notas = colNote;
      const paren = /\(([^)]+)\)|\[([^\]]+)\]/.exec(rest);
      const st = findStage(rest, stageNames);
      if (st) { escenario = st; rest = removeWord(rest.replace(/[()\[\]]/g, ' '), st); }
      else if (paren && /\b(escenario|stage|sala|carpa|tarima|auditorio|plaza|club|room)\b/i.test(paren[1] || paren[2])) { escenario = cleanName(paren[1] || paren[2]); rest = rest.replace(paren[0], ' '); }
      else {
        // Paréntesis que no es un escenario («(por turnos)», «(con Kiki)»): a notas
        if (paren) { notas = cleanName(paren[1] || paren[2]) + (notas ? ' · ' + notas : ''); rest = rest.replace(paren[0], ' '); }
        if (curStage) escenario = curStage;
      }
      const rec = { src: i, raw: line, banda: cleanName(rest), escenario,
        jornadaTxt: jornadaTxt || curDay, inicioTxt: ini.hm, finTxt: fin ? fin.hm : '', duracion: '', callTxt: '', notas: notas };
      const r = interpret(rec, ctx);
      glued.changes.forEach(c => r.warns.push('Palabras separadas: «' + c[0] + '» → «' + c[1] + '»'));
      if (ini.warn) r.warns.push(ini.warn);
      if (fin && fin.warn) r.warns.push(fin.warn);
      recs.push(r);
    });
    return { records: recs, ignored };
  }

  /** Normaliza un registro (horas, fecha, rango en una celda). */
  function interpret(rec, ctx) {
    const r = Object.assign({}, rec, { warns: [], errs: [] });
    // Rango en la celda de inicio («21:00-22:15»)
    let ini = parseTime(r.inicioTxt);
    if (!ini && r.inicioTxt) {
      const rg = parseRange(r.inicioTxt);
      if (rg) { ini = rg.ini; if (!r.finTxt) { r.finTxt = rg.fin.hm; r.warns.push('Inicio y fin venían en la misma celda'); } }
    }
    r.inicio = ini ? ini.hm : '';
    if (ini && ini.warn) r.warns.push(ini.warn);
    if (r.inicioTxt && !ini) r.errs.push('Hora de inicio no reconocida: «' + r.inicioTxt + '»');
    const fin = parseTime(r.finTxt);
    r.fin = fin ? fin.hm : '';
    if (fin && fin.warn) r.warns.push(fin.warn);
    if (r.finTxt && !fin) r.errs.push('Hora de fin no reconocida: «' + r.finTxt + '»');
    const cl = parseTime(r.callTxt);
    r.call = cl ? cl.hm : '';
    if (r.callTxt && !cl && !/^[-—–]$/.test(r.callTxt.trim())) r.errs.push('CALL no reconocido: «' + r.callTxt + '»');
    r.jornada = '';
    if (r.jornadaTxt) {
      if (C.dayIndex(r.jornadaTxt) !== null) r.jornada = r.jornadaTxt;
      else { const d = parseDate(r.jornadaTxt, ctx); if (d) { r.jornada = d.iso; if (d.warn) r.warns.push(d.warn); } else r.errs.push('Jornada no reconocida: «' + r.jornadaTxt + '»'); }
    }
    r.banda = cleanName(r.banda);
    r.escenario = cleanName(r.escenario);
    r.duracion = String(r.duracion || '').trim().replace(/\s*(min|mins|minutos|')$/i, '');
    return r;
  }

  // ── Vista previa (validación contra el evento) ──────────────────────
  /** opts: { mode (tipo por defecto de las bandas: show|sc), defaultJornada, defaultStageId, createStages:{normName:true},
   *          include:{idx:bool}, edits:{idx:{campo:valor}} } — edits.tipo cambia el tipo propuesto.
   *  Devuelve { rows, newStages:[nombre], outside:[iso], counts }. Cada fila lleva tipo (show|sc|tarea|hito) y tipoWhy. */
  function preview(state, records, opts) {
    const o = opts || {};
    const defMode = o.mode === 'sc' ? 'sc' : 'show';
    const stagesByNorm = {};
    (state.escenarios || []).forEach(e => { stagesByNorm[norm(e.nombre)] = e; });
    const evDays = C.eventDays(state);
    const newStages = [], seenNew = {}, outside = [];
    const rows = records.map((r0, idx) => {
      const ed = (o.edits && o.edits[idx]) || null;
      const r = Object.assign({}, r0, ed ? reinterpretEdits(r0, ed, o.ctx) : {});
      const warns = r.warns.slice(), errs = r.errs.slice();
      // Tipo: el elegido en la vista previa o el propuesto (que puede limpiar el nombre: «Prueba Omega» → Omega)
      const prop = proposeTipo(r, defMode);
      let tipo = prop.tipo, tipoWhy = prop.why;
      const chosen = ed && TIPO_KEYS.indexOf(ed.tipo) >= 0 ? ed.tipo : null;
      if (chosen) { tipo = chosen; tipoWhy = ''; }
      // El nombre limpio («Prueba Omega» → «Omega») solo si se queda el tipo propuesto y no se ha editado a mano
      if (!(ed && ed.banda !== undefined) && (!chosen || chosen === prop.tipo)) r.banda = cleanName(prop.banda);
      const band = tipo === 'show' || tipo === 'sc';
      const mode = tipo === 'sc' ? 'sc' : 'show';
      if (!r.banda) errs.push(band ? 'Falta el nombre de la banda' : 'Falta el nombre');
      // Cada línea es una ENTRADA INDEPENDIENTE: nunca se une a otra por el nombre.
      // Solo se AVISA si ya hay una entrada igual (mismo nombre, tipo y jornada), por si se pega dos veces.
      const jornada0 = r.jornada || o.defaultJornada || '';
      const sameDay = (state.artists || []).find(a => r.banda && norm(a.nombre) === norm(r.banda) &&
        (band ? C.tipoOf(a) === 'banda' && C.entersMode(a, mode) : C.tipoOf(a) === tipo) && C.jornadaOf(state, a, mode) === jornada0);
      // Escenario
      let stage = null, stageNew = '';
      if (r.escenario) {
        stage = stagesByNorm[norm(r.escenario)] || null;
        if (!stage) {
          stageNew = r.escenario;
          if (!seenNew[norm(r.escenario)]) { seenNew[norm(r.escenario)] = true; newStages.push(r.escenario); }
          if (o.createStages && o.createStages[norm(r.escenario)] === false) errs.push('El escenario «' + r.escenario + '» no existe (marca «crear» o cámbialo)');
          else warns.push('Escenario nuevo: ' + r.escenario);
        }
      } else if (!band) { /* tareas e hitos: escenario opcional */ }
      else if (o.defaultStageId) stage = C.getEscenario(state, o.defaultStageId);
      else if ((state.escenarios || []).length) errs.push('Falta el escenario (elige uno por defecto o una columna)');
      // Jornada
      const jornada = r.jornada || o.defaultJornada || '';
      if (!jornada) errs.push('Falta la jornada (elige una por defecto)');
      else if (evDays.length && evDays.indexOf(jornada) < 0) { warns.push('Jornada fuera del evento: ' + jornada); if (outside.indexOf(jornada) < 0) outside.push(jornada); }
      // Horas
      if (!r.inicio && !r.inicioTxt) errs.push('Falta la hora de inicio');
      let fin = r.fin;
      if (r.duracion !== '') {
        if (!/^\d{1,4}$/.test(r.duracion) || +r.duracion < 1 || +r.duracion > 1440) errs.push('Duración no válida: «' + r.duracion + '»');
        else if (r.inicio) {
          const byDur = C.fmtHM(C.parseHM(r.inicio) + Number(r.duracion));
          if (fin && fin !== byDur) errs.push('El fin (' + fin + ') no cuadra con la duración (' + byDur + ')');
          else if (!fin) { fin = byDur; warns.push('Fin calculado con la duración: ' + byDur); }
        }
      }
      let call = r.call;
      if (tipo === 'hito') {
        if (fin) warns.push('Un hito no tiene fin: se ignora ' + fin);
        fin = '';
      } else if (r.inicio && !fin) warns.push('Sin hora de fin (la Live supone 60 min)');
      if (!band && call) { warns.push((tipo === 'hito' ? 'Los hitos' : 'Las tareas') + ' no tienen CALL: se ignora ' + call); call = ''; }
      if (r.inicio && fin && C.parseHM(fin) <= C.parseHM(r.inicio)) warns.push('Cruza medianoche: termina al día siguiente');
      if (r.inicio && jornada && C.fechaFor(state, jornada, r.inicio) !== jornada) warns.push('Antes de la hora de corte: fecha real ' + C.fechaFor(state, jornada, r.inicio));
      // ¿Ya hay una igual? Solo AVISO; la casilla no se toca: el regidor decide.
      let action = 'nueva', target = null;
      if (sameDay) { action = 'duplicada'; target = sameDay.id; warns.push('Ya hay una entrada igual en esta jornada (' + TIPO_LABEL[tipo].toLowerCase() + ' ' + C.fieldValue(sameDay, mode, 'inicio') + '): ¿pegada dos veces?'); }
      const status = errs.length ? 'err' : warns.length ? 'warn' : 'ok';
      const defInclude = status !== 'err';
      const include = o.include && o.include[idx] !== undefined ? (o.include[idx] && status !== 'err') : defInclude;
      return { idx, src: r.src, raw: r.raw, banda: r.banda, tipo, tipoWhy, escenario: stage ? stage.nombre : stageNew, stageId: stage ? stage.id : '', stageNew,
        jornada, inicio: r.inicio, fin: fin || '', finTxt: r.fin, duracion: r.duracion, call: call, notas: r.notas,
        action, target, warns, errs, status, include };
    });
    // Solapes: solo entre bandas del mismo tipo (show/sc), escenario y jornada (existentes + importadas).
    // Tareas e hitos conviven con todo: no solapan.
    const existingOf = { show: C.buildBlocks(state, { mode: 'show', day: 'all' }), sc: C.buildBlocks(state, { mode: 'sc', day: 'all' }) };
    rows.forEach(r => {
      if (!r.include || r.status === 'err' || !r.inicio || (r.tipo !== 'show' && r.tipo !== 'sc')) return;
      const existing = existingOf[r.tipo];
      const key = (r.stageId || 'new:' + norm(r.stageNew)) + '|' + r.jornada;
      const si = C.toAbs(C.fechaFor(state, r.jornada, r.inicio), r.inicio);
      const sf = r.fin ? C.adjustEnd(si, C.toAbs(C.fechaFor(state, r.jornada, r.inicio), r.fin)) : si + C.DEFAULT_DURATION;
      const clash = existing.filter(b => (b.stageId || 'new:' + norm(b.stage)) + '|' + b.jornada === key && String(b.id) !== String(r.target) && b.si < sf && C.blockEnd(b) > si)
        .map(b => b.name)
        .concat(rows.filter(x => x !== r && x.tipo === r.tipo && x.include && x.status !== 'err' && x.inicio && ((x.stageId || 'new:' + norm(x.stageNew)) + '|' + x.jornada) === key && (() => {
          const xi = C.toAbs(C.fechaFor(state, x.jornada, x.inicio), x.inicio);
          const xf = x.fin ? C.adjustEnd(xi, C.toAbs(C.fechaFor(state, x.jornada, x.inicio), x.fin)) : xi + C.DEFAULT_DURATION;
          return xi < sf && xf > si;
        })()).map(x => x.banda));
      if (clash.length) { r.warns.push('Se solapa con ' + clash.join(', ')); if (r.status === 'ok') r.status = 'warn'; }
    });
    const counts = { total: rows.length, ok: 0, warn: 0, err: 0, importar: 0 };
    rows.forEach(r => { counts[r.status]++; if (r.include && r.status !== 'err') counts.importar++; });
    return { rows, newStages, outside: outside.sort(), counts };
  }

  /** Ediciones hechas en la vista previa (texto tal cual) → campos reinterpretados. */
  function reinterpretEdits(r0, ed, ctx) {
    const rec = Object.assign({}, r0);
    ['banda', 'escenario', 'notas'].forEach(k => { if (ed[k] !== undefined) rec[k] = ed[k]; });
    if (ed.tipo !== undefined) rec.tipoTxt = '';
    if (ed.jornada !== undefined) rec.jornadaTxt = ed.jornada;
    if (ed.inicio !== undefined) rec.inicioTxt = ed.inicio;
    if (ed.fin !== undefined) { rec.finTxt = ed.fin; rec.duracion = ''; }
    if (ed.call !== undefined) rec.callTxt = ed.call;
    const r = interpret(Object.assign({}, rec, { warns: undefined, errs: undefined }), ctx);
    return r;
  }

  /** Aplica la importación confirmada. Cada fila entra con SU tipo (show, soundcheck, tarea o hito).
   *  opts: { createStages:{normName:bool}, extendEvent:bool }. Devuelve { ok, state, added, updated (siempre 0), stagesCreated, errors } */
  function apply(state, pv, opts) {
    const o = opts || {};
    let s = state;
    const stageId = {}; let stagesCreated = 0;
    (s.escenarios || []).forEach(e => { stageId[norm(e.nombre)] = e.id; });
    const rows = pv.rows.filter(r => r.include && r.status !== 'err');
    rows.forEach(r => {
      if (r.stageNew && !stageId[norm(r.stageNew)] && !(o.createStages && o.createStages[norm(r.stageNew)] === false)) {
        const a = C.addStage(s, r.stageNew); if (a.ok) { s = a.state; stageId[norm(r.stageNew)] = a.id; stagesCreated++; }
      }
    });
    if (o.extendEvent && pv.outside.length) {
      const all = C.eventDays(s).concat(pv.outside).sort();
      const u = C.updateEvent(s, { fechaInicio: all[0], fechaFin: all[all.length - 1] });
      if (u.ok) s = u.state;
    }
    let added = 0; const errors = [];
    rows.forEach(r => {
      const esc = r.stageId || (r.stageNew ? stageId[norm(r.stageNew)] : '') || '';
      const tipo = r.tipo || (o.mode === 'sc' ? 'sc' : 'show');
      const mode = tipo === 'sc' ? 'sc' : 'show';
      // Siempre una entrada nueva e independiente (nunca se completa ni se une a otra)
      const a = C.addArtist(s, mode, { tipo: (tipo === 'tarea' || tipo === 'hito') ? tipo : 'banda', nombre: r.banda, escenarioId: esc, jornada: r.jornada, inicio: r.inicio, fin: r.fin, call: r.call, notas: r.notas });
      if (a.ok) { s = a.state; added++; } else errors.push(r.banda + ': ' + a.error);
    });
    return { ok: true, state: s, added, updated: 0, stagesCreated, errors };
  }

  /** Contexto para leer fechas y escenarios con el evento actual. */
  function contextOf(state) {
    const days = C.eventDays(state);
    const y = days.length ? +days[0].slice(0, 4) : new Date().getFullYear();
    return { year: y, days: days, stageNames: (state.escenarios || []).map(e => e.nombre) };
  }

  /** Atajo: texto → { kind, sep?, rows?, map?, header?, records, ignored } */
  function read(text, ctx, forced) {
    const d = detect(text);
    if (d.kind === 'vacio') return { kind: 'vacio', records: [], ignored: [] };
    if (d.kind === 'texto') { const t = textRecords(text, ctx); return { kind: 'texto', records: t.records, ignored: t.ignored }; }
    const rows = parseTable(text, d.sep);
    const head = guessHeader(rows[0] || []);
    const hasHeader = forced && forced.header !== undefined ? forced.header : !!head;
    const data = hasHeader ? rows.slice(1) : rows;
    const map = forced && forced.map ? forced.map : (hasHeader && head ? head : guessColumns(data, ctx));
    return { kind: 'tabla', sep: d.sep, rows, header: hasHeader ? rows[0] : null, hasHeader, map, records: tableRecords(data, map, ctx), ignored: [] };
  }

  const API = { norm, parseTime, parseRange, parseDate, detect, splitRow, parseTable, guessHeader, guessColumns, tableRecords,
    textRecords, findTimes, interpret, preview, apply, contextOf, read, KEYS, KEY_LABEL, splitGlued, proposeTipo, tipoFromText, TIPO_KEYS, TIPO_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeImport = API;
})(typeof window !== 'undefined' ? window : globalThis);
