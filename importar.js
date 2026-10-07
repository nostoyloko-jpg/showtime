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
    return String(s == null ? '' : s)
      .replace(/[\p{So}\p{Sk}\uFE0F\u200D\u20E3\u2190-\u21FF\u25A0-\u25FF]+/gu, ' ')     // emojis, flechas, ▶ ■ ●
      .replace(/(?:\s*[._…]){3,}\s*/g, ' ')                                         // puntos o guiones bajos de relleno
      .replace(/^[\s\-–—|·•:,;*>]+|[\s\-–—|·•:,;*<]+$/g, '').replace(/\s+/g, ' ').trim();
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
  // Tareas: palabras FUERTES (inequívocas en cualquier documento) y DÉBILES (también pueden ser nombre de banda: «Hotel Costes»,
  // «Ave Fénix», «The Press»…). Las débiles solo cuentan en documentos de producción (hojas de ruta, day sheets).
  const TAREA_RE = /\b(comida|comidas|almuerzo|cena|cenas|desayuno|catering|montaje|desmontaje|carga y descarga|descarga|get ?in|get ?out|load ?in|load ?out|pruebas? de (?:luces|luz|video|iluminacion|led)|ensayo|ensayos|reunion|briefing|acreditacion|acreditaciones|transfer|traslado|traslados|check ?in|check ?out|checkout|limpieza|line ?check|linecheck|lunch|dinner|breakfast|meal|meals|crew meal|crew lunch|crew dinner|changeover meal|furgoneta|recogida|transporte|cambio (?:de )?escenario|changeover|salida (?:de(?:l)? )?(?:furgoneta|furgo|bus|autobus|van|coche|crew|banda)|rueda de prensa|entrevista|entrevistas|interview|interviews|meet (?:&|and|y) greet|m&g|photocall|firma de discos|signing)\b/;
  const WEAK_TAREA_RE = /\b(hotel|bus|autobus|ave|tren|train|drive|driving|travel|viaje|vuelo|flight|avion|press|prensa|promo|lobby|backline|ducha|shower|vestuario|maquillaje|make ?up|calentamiento|warm ?up|parada|pausa|descanso|break|comer|pick ?up|furgo|carga)\b/;
  const HITO_RE = /\b(puertas|apertura|cierre de puertas|curfew|toque de queda|fin de (?:sonido|evento|jornada|actividad|pruebas|prueba|soundcheck)|llegada|llega|llegan|salida|desalojo|hora limite|limite de sonido|citacion|citaciones|fin (?:del? )?(?:show|concierto)|doors|(?:lobby|bus|van|band|crew|artist|artista|banda) call|showtime|show time)\b/;
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
    if (rec.tipoCol) return { tipo: rec.tipoCol, banda, why: rec.tipoWhy || '' };   // hora en la columna de prueba o de concierto
    const n = norm(banda);
    let m;
    // Tarea o hito: si hay de las dos, manda la tarea («Llegada y descarga» = trabajo), salvo un hito «fuerte» al principio
    // («Fin de pruebas + Cambio escenario», «Citación…», «Apertura de puertas» = hito). «Salida furgoneta» = tarea.
    const mT = TAREA_RE.exec(n) || (rec.docProd ? WEAK_TAREA_RE.exec(n) : null), mH = HITO_RE.exec(n);
    const hitoFirst = !!mH && (!mT || (mH.index === mT.index && mH[0].length > mT[0].length) || (mH.index === 0 && mT.index > 0 && /^(fin |apertura|puertas|cierre|citacion|curfew|doors|toque|desalojo|hora limite|limite)|\bcall$/.test(mH[1])));
    if (mT && !hitoFirst) return { tipo: 'tarea', banda, why: '«' + mT[1] + '»' };
    if ((m = SC_HEAD.exec(banda)) && banda.slice(m[0].length).trim()) return { tipo: 'sc', banda: banda.slice(m[0].length), why: '«' + m[1] + '»' };
    if ((m = SC_TAIL.exec(banda)) && banda.slice(0, m.index).trim()) return { tipo: 'sc', banda: banda.slice(0, m.index), why: '«' + m[1] + '»' };
    if (mH) return { tipo: 'hito', banda, why: '«' + mH[1] + '»' };
    if ((m = SHOW_HEAD.exec(banda)) && banda.slice(m[0].length).trim()) return { tipo: 'show', banda: banda.slice(m[0].length), why: '«' + m[1] + '»' };
    return { tipo: def, banda, why: '' };
  }

  // ── Horas ───────────────────────────────────────────────────────────
  /** "21:00", "21.00", "21h", "21h30", "2100", "930", "21:00:00", "9:00 PM", "9pm", "25:30" (= 01:30).
   *  Devuelve { hm:'HH:MM', warn?:'…' } o null. */
  function parseTime(raw) {
    let t = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, function (m, i, s) { return /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '') ? ':' : ''; });
    t = t.replace(/^(\d{1,2}[:h]\d{2}):?(?:h|hs|hrs|horas)?$/, '$1');
    if (/^(noon|mediodia|mediodía|12noon)$/.test(t)) return { hm: '12:00' };
    if (/^(midnight|medianoche)$/.test(t)) return { hm: '00:00' };   // «15:00 h.», «16:30: h.» (tras quitar espacios y puntos)
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
    const m = /^(.+?)\s*(?:-|–|—|→|~|>|\/|\b(?:a|al|hasta|to|till|until)\b)\s*(.+)$/i.exec(s);
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
    const s0 = norm(raw).trim(); let mDot;
    if ((mDot = /^(?:[a-z]+\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s0))) { let y = +mDot[3]; if (y < 100) y += 2000; const iso = isoOk(y, +mDot[2], +mDot[1]); return iso ? { iso } : null; }
    const s = s0.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const year = c.year || new Date().getFullYear();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { const iso = isoOk(+m[1], +m[2], +m[3]); return iso ? { iso } : null; }
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/.exec(s))) {
      let y = m[3] ? +m[3] : year; if (y < 100) y += 2000;
      let d = +m[1], mo = +m[2];
      // Día/mes (Europa) salvo que no pueda serlo: «09/25/2026» es mes/día (EE. UU.); si las dos valen, manda la del evento
      if (mo > 12 && d <= 12) { const x = d; d = mo; mo = x; }
      else if (d <= 12 && mo <= 12 && d !== mo && (c.days || []).length) {
        const eu = isoOk(y, mo, d), us = isoOk(y, d, mo);
        if (us && c.days.indexOf(us) >= 0 && c.days.indexOf(eu) < 0) { const x = d; d = mo; mo = x; }
      }
      const iso = isoOk(y, mo, d); return iso ? { iso } : null;
    }
    // [día-semana] 10 [de] jul[io] [2026]
    const tok = s.split(/[\s\-\/]+/).filter(x => x && x !== 'de' && x !== 'del' && x !== 'the' && x !== 'of').map(x => x.replace(/^(\d{1,2})(?:st|nd|rd|th|º|ª|o|er)$/, '$1'));
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
      if (wd !== null && !hit.length) return inferWeekdayDate(dd, wd, c, raw);   // «Jueves 27» fuera del evento (o sin evento)
      return null;
    }
    if (wd !== null) {                                     // «viernes»: el viernes del evento, si solo hay uno
      const hit = days.filter(d => weekdayOf(d) === wd);
      if (hit.length === 1) return { iso: hit[0], warn: '«' + String(raw).trim() + '» se lee como ' + hit[0] };
    }
    return null;
  }

  /** «Jueves 27» sin mes: el día 27 que cae en jueves más cercano a la referencia (la primera fecha deducida de este
   *  mismo horario o, si es la primera, hoy). Siempre con aviso: el Stage Manager lo revisa en la vista previa. */
  function inferWeekdayDate(dd, wd, c, raw) {
    const ref = c._anchor || c.today || isoToday();
    const r0 = Date.parse(ref + 'T12:00:00Z');
    let best = null;
    for (let k = -14; k <= 14; k++) {
      const d0 = new Date(r0); d0.setUTCDate(1); d0.setUTCMonth(d0.getUTCMonth() + k);
      const y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1, iso = isoOk(y, mo, dd);
      if (!iso || +iso.slice(8) !== dd || new Date(iso + 'T12:00:00Z').getUTCDay() !== wd) continue;
      const dist = Math.abs(Date.parse(iso + 'T12:00:00Z') - r0);
      if (!best || dist < best.dist) best = { iso, dist };
    }
    if (!best) return null;
    if (c && typeof c === 'object' && !c._anchor) c._anchor = best.iso;
    return { iso: best.iso, warn: '«' + String(raw).trim() + '» sin mes: se lee como ' + best.iso + ' (revísalo)' };
  }
  function isoToday() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

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
    if (sep === '\t') return line.split('\t').map(x => unquote(x.trim()));
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

  function unquote(x) { return /^"[\s\S]*"$/.test(x) && x.length >= 2 ? x.slice(1, -1).replace(/""/g, '"').trim() : x; }

  /** Excel pone entre comillas las celdas con salto de línea («"14:45 - 01:00⏎(10:45 h.)"»): el salto pasa a ser un espacio
   *  para que la celda no parta la fila. Solo cuenta la comilla al principio de una celda. Si las comillas no cierran, no se toca nada. */
  function joinQuotedLines(text) {
    const t = String(text || '');
    if (t.indexOf('"') < 0) return t;
    let out = '', q = false, start = true;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"') { if (t[i + 1] === '"') { out += '""'; i++; continue; } q = false; out += ch; continue; }
        if (ch === '\r') continue;
        out += ch === '\n' ? ' ' : ch; continue;
      }
      if (ch === '"' && start) { q = true; out += ch; start = false; continue; }
      out += ch;
      start = ch === '\t' || ch === '\n' || ch === ';' || ch === ',';
    }
    return q ? t : out;
  }

  function parseTable(text, sep) {
    return String(text || '').split(/\r?\n/).filter(l => l.trim()).map(l => splitRow(l, sep));
  }

  const KEYS = ['banda', 'tipo', 'escenario', 'jornada', 'inicio', 'fin', 'pinicio', 'pfin', 'concierto', 'duracion', 'call', 'notas', 'ignorar'];
  const KEY_LABEL = { banda: 'Banda', tipo: 'Tipo', escenario: 'Zona', jornada: 'Jornada', inicio: 'Inicio', fin: 'Fin',
    pinicio: 'Prueba · entrada', pfin: 'Prueba · salida', concierto: 'Show · hora o rango', duracion: 'Duración', call: 'CALL', notas: 'Notas', ignorar: 'Ignorar columna' };
  const HEADERS = {
    tipo: ['tipo', 'type', 'categoria', 'category', 'clase', 'kind'],
    banda: ['artista', 'artistas', 'artist', 'banda', 'band', 'grupo', 'nombre', 'name', 'act', 'line up', 'lineup', 'accion', 'acciones', 'actividad', 'activity', 'evento', 'event', 'descripcion', 'description', 'concepto', 'what', 'item', 'artistas / actividad'],
    escenario: ['zona', 'escenario', 'stage', 'sala', 'room', 'lugar', 'espacio', 'area', 'zone', 'location', 'venue', 'place', 'ubicacion', 'escenarios', 'stages'],
    jornada: ['dia', 'fecha', 'jornada', 'day', 'date'],
    inicio: ['inicio', 'hora', 'start', 'begin', 'desde', 'empieza', 'comienzo', 'hora inicio', 'horario', 'time', 'start time'],
    fin: ['fin', 'end', 'finish', 'hasta', 'termina', 'hora fin', 'final'],
    duracion: ['duracion', 'dur', 'min', 'mins', 'minutos', 'length', 'duration'],
    call: ['call', 'llamada', 'aviso', 'citacion', 'citaciones', 'convocatoria', 'crew call', 'band call', 'artist call'],
    notas: ['notas', 'nota', 'notes', 'obs', 'observaciones', 'comentarios', 'comments', 'info', 'personal', 'quien', 'quienes', 'who', 'equipo', 'asistentes']
  };

  // Turnos del personal (regiduría, técnicos…): NO son zonas ni horas de las bandas
  const STAFF_RE = /\b(stage ?managers?|regidor|regidora|regiduria|turnos?|shifts?|crew hours|staff hours|horas totales|total hours|staff|guardia|rota)\b/;
  const CALL_RE = /\b(citacion|citaciones|call|calls|llamada|convocatoria)\b/;
  const PIN_RE = /\b(entrada|subida|in|on)\b.*\b(escenario|stage|tarima)\b|\bstage ?in\b|^(soundcheck|sound check|prueba|pruebas|prueba de sonido|pruebas de sonido|line ?check|sc)(\s(inicio|start|desde|in))?$/;
  const POUT_RE = /\b(salida|bajada|out|off)\b.*\b(escenario|stage|tarima)\b|\bstage ?out\b|^(soundcheck|sound check|prueba|pruebas|prueba de sonido|sc)\s(fin|end|hasta|out)$/;
  const SHOW_RE = /^(concierto|conciertos|show|shows|performance|performances|actuacion|actuaciones|live|directo|set|set ?time|set ?times|showtime|show ?time|horario (?:del? )?(?:show|concierto|actuacion))$|\b(concierto|performance|actuacion)\b/;
  /** Cabecera → clave, 'ignorar' o null (desconocida: se decide luego por el contenido de la columna). */
  function headerKey(cell) {
    const n = norm(cell);
    if (!n) return 'ignorar';
    if (STAFF_RE.test(n)) return 'ignorar';
    if (CALL_RE.test(n)) return 'call';
    if (PIN_RE.test(n)) return 'pinicio';
    if (POUT_RE.test(n)) return 'pfin';
    if (SHOW_RE.test(n)) return 'concierto';
    for (const k of Object.keys(HEADERS)) if (HEADERS[k].indexOf(n) >= 0) return k;
    for (const k of Object.keys(HEADERS)) if (HEADERS[k].some(w => w.length > 3 && n.split(/[\s_\-\/]+/).indexOf(w) >= 0)) return k;
    return null;
  }
  function headerKeys(row) {
    const map = row.map(headerKey);
    const known = map.filter(k => k && k !== 'ignorar').length;
    const looksData = row.some(cell => parseTime(cell) || parseRange(cell));
    if (row.filter(x => String(x || '').trim()).length < 2) return null;   // una sola celda: título o sección, no cabecera
    return known >= 2 || (known >= 1 && !looksData) ? map : null;
  }
  /** Si la fila parece cabecera, devuelve el mapeo propuesto; si no, null. */
  function guessHeader(row) {
    const map = headerKeys(row);
    return map ? map.map(k => k || 'ignorar') : null;
  }

  /** ¿Parrilla con una columna por escenario? Una columna de horas, ninguna de «Banda», y 2+ columnas de nombres (texto, no horas)
   *  cuyo título es un escenario («ESCENARIO 1», «Main Stage», «Carpa») o desconocido. → { time, jor, stages:[col] } o null */
  function matrixColumns(head, header, data, ctx) {
    if (head.indexOf('banda') >= 0) return null;
    const cells = c => data.map(r => String(r[c] || '').trim()).filter(Boolean);
    const frac = (c, fn) => { const x = cells(c); return x.length ? x.filter(fn).length / x.length : 0; };
    let time = head.indexOf('inicio');
    if (time < 0) time = head.findIndex((k, c) => k === null && frac(c, x => parseTime(x) || parseRange(x)) >= 0.8);
    if (time < 0) return null;
    const jor = head.indexOf('jornada');
    const stages = head.map((k, c) => c).filter(c => c !== time && c !== jor && (head[c] === 'escenario' || head[c] === null) && cleanName(header[c]) &&
      cells(c).length && frac(c, x => /[a-zñáéíóú]/i.test(x) && !parseTime(x) && !parseRange(x) && !parseDate(x, Object.assign({}, ctx || {}))) >= 0.8);
    return stages.length >= 2 ? { time, jor, stages } : null;
  }

  /** ¿La cabecera es un nombre de zona («MAIN STAGE», «GIGANTE») y no la etiqueta de la columna («Stage», «Zona»)? */
  function isZoneTitle(h) { const n = norm(h); return !!n && HEADERS.escenario.indexOf(n) < 0 && (headerKey(h) === null || headerKey(h) === 'escenario'); }

  /** Cabecera con columnas desconocidas: se decide por el contenido (fecha → Jornada, texto → Banda). Si ya hay columnas de hora,
   *  las demás columnas de horas (turnos, «ENTRADA»/«SALIDA» del personal…) se ignoran. */
  function resolveHeader(head, header, data, ctx) {
    const map = head.map(k => k);
    const has = k => map.indexOf(k) >= 0;
    const cells = c => data.map(r => r[c] || '').filter(x => String(x).trim());
    const frac = (c, fn) => { const x = cells(c); return x.length ? x.filter(fn).length / x.length : 0; };
    // «MAIN STAGE», «Escenario Principal»… sobre una columna de fechas: es el NOMBRE de la zona (título), no la columna de zonas
    map.forEach((k, c) => { if (k === 'escenario' && isZoneTitle(header[c]) && frac(c, x => parseDate(x, Object.assign({}, ctx || {}))) >= 0.6) map[c] = null; });
    map.forEach((k, c) => {
      if (k !== null) return;
      const n = norm(header[c]);
      if (/^(entrada|salida|in|out)$/.test(n) && (has('pinicio') || has('concierto'))) { map[c] = 'ignorar'; return; }
      if (!has('jornada') && frac(c, x => parseDate(x, Object.assign({}, ctx || {}))) >= 0.6) { map[c] = 'jornada'; return; }
      if (frac(c, x => parseTime(x) || parseRange(x)) >= 0.6) { map[c] = has('pinicio') || has('pfin') || has('concierto') ? 'ignorar' : !has('inicio') ? 'inicio' : !has('fin') ? 'fin' : 'ignorar'; return; }
      if (!has('banda') && frac(c, x => /[a-zñáéíóú]/i.test(x)) >= 0.6) { map[c] = 'banda'; return; }
      map[c] = 'ignorar';
    });
    // «Entrada»/«Salida» sueltas leídas como inicio/fin pero ya hay horas de prueba o de concierto: son el turno del personal
    if (has('pinicio') || has('concierto')) map.forEach((k, c) => { if ((k === 'inicio' || k === 'fin') && /^(entrada|salida)$/.test(norm(header[c]))) map[c] = 'ignorar'; });
    return map;
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
    // Zona por el contenido solo si se repite como una zona (pocos valores distintos) y no son listas de personas («ANA + BEA», «ALL», «CREW»)
    const zoneLike = c => { const v = rows.map(r => norm(r[c] || '')).filter(Boolean); const d = new Set(v).size;
      return v.length && d <= Math.max(2, Math.ceil(v.length * 0.5)) && v.filter(x => /\+|^(all|crew|todos|todo el equipo|everyone|banda|band)$/.test(x)).length < v.length * 0.2; };
    if (!map.includes('escenario')) take(x => x.text >= 0.6 && x.len <= 20 && zoneLike(x.c), 'escenario');
    take(x => x.text >= 0.5, 'notas');
    return map;
  }

  /** Duración escrita → minutos (texto): «75», «75 min», «1:45 h.», «0:45», «2h», «1,5 h». Lo que no se entiende queda tal cual (y avisa la vista previa). */
  function durMinutes(raw) {
    const t = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, ' ');
    let m;
    if (!t) return '';
    if ((m = /^(\d{1,4})\s*(?:min|mins|minutos|minutes|m|')?\.?$/.exec(t))) return m[1];
    if ((m = /^(\d{1,2})\s*[:h.]\s*(\d{2})\s*(?:h|hs|hrs|horas|hours)?\.?$/.exec(t))) return String(+m[1] * 60 + +m[2]);
    if ((m = /^(\d{1,2})(?:[.,](\d+))?\s*(?:h|hs|hrs|horas|hours)\.?$/.exec(t))) return String(Math.round((+m[1] + (m[2] ? +('0.' + m[2]) : 0)) * 60));
    return t;
  }

  /** Nombre con horas dentro («COMIDA 14:30 - 15:50 (REVISAR)») → { banda, ini, fin, notas } (o null si no lleva hora). */
  function nameWithTimes(text) {
    const times = findTimes(text);
    if (!times.length) return null;
    const t1 = times[0], t2 = times[1];
    let fin = null;
    if (t2 && /^\s*(?:-|–|—|a|hasta|to|>|\/)?\s*$/i.test(text.slice(t1.j, t2.i))) fin = t2;
    let rest = text.slice(0, t1.i) + ' ' + text.slice(fin ? fin.j : t1.j);
    let notas = '';
    rest = rest.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (m, a, b) => { const x = cleanName(a || b); if (x) notas = notas ? notas + ' · ' + x : x; return ' '; });
    return { banda: cleanName(rest), ini: t1.t.hm, fin: fin ? fin.t.hm : '', notas };
  }

  /** Filas de tabla + mapeo → { records, ignored }. Tablas reales de festival:
   *  - Relleno hacia abajo: una celda combinada de Excel (Jornada, Zona) solo trae texto en su primera fila → las de debajo la heredan.
   *  - Cabeceras repetidas (una por jornada): se saltan; si su primera celda es el nombre de la zona («GIGANTE»), cambia la zona.
   *  - Horas de PRUEBA (entrada/salida a escenario) → soundcheck; hora o rango de CONCIERTO → show; las dos en la misma fila → dos entradas.
   *  - Filas sin nombre ni hora de inicio (turnos, subtítulos «STAGE TARDE»…) → no son entradas: van a «ignoradas».
   *  o: { header (fila de cabecera), zoneCol (índice de la columna cuyo título es la zona), zone (zona inicial) } */
  function tableRead(rows, map, ctx, o) {
    o = o || {};
    const recs = [], ignored = [];
    const idx = k => map.reduce((a, x, i) => (x === k ? a.concat([i]) : a), []);
    const headNorm = o.header ? o.header.map(norm) : null;
    const isHeaderRepeat = r => headNorm && map.every((k, c) => k === 'ignorar' || c === o.zoneCol || norm(r[c]) === headNorm[c]) && r.some((x, c) => norm(x) && norm(x) === headNorm[c] && c !== o.zoneCol);
    let lastJor = '', lastEsc = '', zone = o.zone || '', secDay = o.day || '';
    const ctxD = Object.assign({}, ctx || {});            // la primera fecha deducida («Jueves 27») ancla las siguientes
    rows.forEach((r, i) => {
      if (isHeaderRepeat(r)) {
        if (o.zoneCol !== undefined && o.zoneCol !== null && cleanName(r[o.zoneCol])) zone = cleanName(r[o.zoneCol]);
        ignored.push({ n: i + 1, line: r.filter(x => x).join(' | '), why: 'cabecera repetida' });
        return;
      }
      // Fila con solo el título de la primera columna y que no es fecha («VIBRAMAHOU»): cambio de zona
      if (o.zoneCol !== undefined && o.zoneCol !== null && cleanName(r[o.zoneCol]) && r.every((x, c) => c === o.zoneCol || !String(x || '').trim()) && !parseDate(r[o.zoneCol], ctxD)) {
        zone = cleanName(r[o.zoneCol]); lastEsc = ''; ignored.push({ n: i + 1, line: zone, why: 'zona' }); return;
      }
      const nonEmpty = r.map(x => String(x || '').trim()).filter(Boolean);
      // Fila con solo una fecha («HORARIOS SÁBADO 05.09.2026»): jornada de lo que viene (si no hay columna de jornada)
      if (nonEmpty.length === 1 && map.indexOf('jornada') < 0) {
        const fd = findDate(nonEmpty[0], ctxD, true) || (parseDate(nonEmpty[0], ctxD) ? { d: parseDate(nonEmpty[0], ctxD) } : null);
        if (fd && !parseTime(nonEmpty[0])) { secDay = fd.d.iso; ignored.push({ n: i + 1, line: nonEmpty[0], why: 'jornada' }); return; }
      }
      const vals = k => idx(k).map(c => String(r[c] || '').trim()).filter(x => x && !/^[-–—·*]+$/.test(x));
      const first = k => vals(k)[0] || '';
      // Sin hora todavía («TBC», «En ruta», «por confirmar»): no es importable; se lista entre las ignoradas
      const st0 = first('inicio') || first('pinicio') || first('concierto');
      if (st0 && !findTimes(st0).length && /^(tbc|tbd|tba|por confirmar|a confirmar|pendiente|en ruta|sin hora|a definir)\b/i.test(norm(st0))) {
        ignored.push({ n: i + 1, line: nonEmpty.join(' | '), why: 'sin hora (' + st0 + ')' }); return;
      }
      let jor = first('jornada') || '', esc = first('escenario');
      const banda0 = vals('banda').join(' ');
      const starts = [first('inicio'), first('pinicio'), first('concierto')].filter(Boolean);
      const filled = map.filter((k, c) => k !== 'ignorar' && String(r[c] || '').trim()).length;
      // Relleno hacia abajo (celdas combinadas): solo en filas con contenido
      if (jor) lastJor = jor; else if (filled) jor = lastJor;
      if (esc) lastEsc = esc; else if (filled) esc = lastEsc;
      if (!esc && zone) esc = zone;
      const inName = !starts.length && banda0 ? nameWithTimes(banda0) : null;
      if (!banda0 && !starts.length) { if (r.some(x => String(x || '').trim())) ignored.push({ n: i + 1, line: r.filter(x => x).join(' | '), why: 'sin nombre ni hora' }); return; }
      if (!starts.length && !inName && !first('fin') && !first('pfin') && filled <= 1) { ignored.push({ n: i + 1, line: r.filter(x => x).join(' | '), why: 'sin hora' }); return; }
      const base = { src: i, raw: r.filter(x => x !== '').join(' | '), banda: banda0, tipoTxt: first('tipo'), escenario: esc, jornadaTxt: jor || secDay,
        inicioTxt: '', finTxt: '', duracion: '', callTxt: '', notas: vals('notas').join(' · ') };
      const head = c => o.header && o.header[c] ? '«' + cleanName(o.header[c]) + '»' : '';
      const out = [];
      const hasSc = first('pinicio') || first('pfin'), hasShow = first('concierto');
      if (hasSc) out.push(Object.assign({}, base, { inicioTxt: first('pinicio') || first('inicio'), finTxt: first('pfin'), tipoCol: 'sc', tipoWhy: 'columna ' + head(idx('pinicio')[0] !== undefined ? idx('pinicio')[0] : idx('pfin')[0]) }));
      if (hasShow) {   // la columna de concierto suele traer el rango entero («21:05 - 22:15»): no es una rareza, no se avisa
        const rg = parseTime(hasShow) ? null : parseRange(hasShow);
        out.push(Object.assign({}, base, { inicioTxt: rg ? rg.ini.hm : hasShow, finTxt: rg ? rg.fin.hm : (hasSc ? '' : first('fin')), tipoCol: 'show', tipoWhy: 'columna ' + head(idx('concierto')[0]) }));
      }
      if (!out.length) {
        const g = Object.assign({}, base, { inicioTxt: first('inicio'), finTxt: first('fin') });
        if (inName) { g.banda = inName.banda; g.inicioTxt = inName.ini; g.finTxt = inName.fin; if (inName.notas) g.notas = g.notas ? inName.notas + ' · ' + g.notas : inName.notas; }
        out.push(g);
      }
      // CALL: con dos entradas en la fila, cada CALL va a la que empieza justo después; la duración solo si hay una entrada
      const calls = vals('call'), mins = t => { const x = parseTime(t) || (parseRange(t) || {}).ini; return x ? C.parseHM(x.hm) : null; };
      out.forEach(rec => {
        if (out.length === 1) { rec.callTxt = calls[0] || ''; rec.duracion = first('duracion'); }
        else {
          const st = mins(rec.inicioTxt);
          const best = calls.map(c => ({ c, m: mins(c) })).filter(x => x.m !== null && st !== null && (st - x.m + 1440) % 1440 <= 240).sort((a, b) => ((st - a.m + 1440) % 1440) - ((st - b.m + 1440) % 1440))[0];
          rec.callTxt = best ? best.c : '';
        }
        recs.push(interpret(rec, ctxD));
      });
    });
    return { records: recs, ignored };
  }
  /** Compatibilidad: solo los registros. */
  function tableRecords(rows, map, ctx) { return tableRead(rows, map, ctx).records; }

  // ── Texto libre ─────────────────────────────────────────────────────
  // Hora con separador (21:00, 21.00, 21h, 21h30, 9pm, 9:00 PM). Sin separador NO cuenta (no confundir «Blink 182»).
  const TIME_RE = /(\d{1,2})(?:[:.h](\d{2}))(?::\d{2})?(?:h(?![a-zñ]))?\s*(?:([ap])\.?\s?m\.?)?(?![\d])|(\d{1,2})\s*h(?![a-zñ\d])|(\d{1,2})\s*([ap])\.?\s?m\.?(?![a-z])/gi;

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

  // Palabras de sitio de escenario: una línea corta con una de ellas es la cabecera de una zona
  const STAGE_WORD_RE = /\b(escenario|escenarios|stage|sala|carpa|tarima|auditorio|plaza|club|room|zona|terraza|patio|arena|tent|hall|pabellon|anfiteatro|teatro|theatre|theater|main|carpa)\b/;
  /** ¿Línea corta de título de sección? 'zona' (lleva palabra de escenario) · 'otra' (título en mayúsculas: «ACTIVIDADES») · null */
  function sectionTitle(line) {
    const t = cleanName(line);
    if (!t || t.split(/\s+/).length > 5 || findTimes(t).length || /[.,;!?]$/.test(t)) return null;
    if (STAGE_WORD_RE.test(norm(t))) return 'zona';
    if (t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3,}/.test(t)) return 'otra';
    return null;
  }

  /** Texto libre → registros. Líneas solo con fecha o con escenario hacen de CABECERA para las siguientes. */
  function textRecords(text, ctx) {
    const stageNames = (ctx && ctx.stageNames) || [];
    const recs = [], ignored = [];
    let curDay = '', curStage = '';
    // Hoja de ruta en BLOQUES (copiada de Word/PDF): una línea con solo la hora, la siguiente es la actividad
    // y las demás hasta la próxima hora son notas (quién va: «ANA + BEA», «CREW», «ALL»).
    let pend = null;
    function finish(p) {
      const r = interpret(p.rec, ctx);
      p.glued.changes.forEach(c => r.warns.push('Palabras separadas: «' + c[0] + '» → «' + c[1] + '»'));
      if (p.ini.warn) r.warns.push(p.ini.warn);
      if (p.fin && p.fin.warn) r.warns.push(p.fin.warn);
      recs.push(r);
    }
    function flush() { if (pend) { finish(pend); pend = null; } }
    /** Nombre de la actividad: duración «(45')» aparte y otros paréntesis a notas. */
    function activity(txt) {
      const td = takeDuration(txt); let name = td.text, notas = '';
      name = name.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (m, a, b) => { const x = cleanName(a || b); if (x) notas = notas ? notas + ' · ' + x : x; return ' '; });
      return { banda: cleanName(name), dur: td.dur, notas };
    }
    String(text || '').split(/\r?\n/).forEach((line00, i) => {
      // Comentarios entre *** … *** (avisos de la hoja de ruta): no son entradas. Una hora en negrita («**08:45H**») sí cuenta.
      // (con 3+ asteriscos; con 2 es negrita de Markdown/Word: «**08:45H**», «**Salida furgoneta**»)
      if (/^\s*\*{3,}.*\*{3,}\s*$/.test(line00)) { ignored.push({ n: i + 1, line: line00.trim() }); return; }
      // PDF con columnas: lo que va tras un tabulador o 3+ espacios DESPUÉS del nombre son notas
      let line0 = line00.replace(/\u00a0/g, ' '), colNote = '';
      const cols = line0.trim().split(/\t+|\s{3,}/);
      if (cols.length >= 3 && findTimes(cols[0]).length && !findTimes(cols.slice(2).join(' ')).length) {
        colNote = cols.slice(2).join(' · '); line0 = cols[0] + ' ' + cols[1];
      }
      const glued = splitGlued(line0);
      const line = glued.text.replace(/[*_~]/g, ' ').replace(/^\s*[•·\-–—>]+\s*/, '').replace(/\s+/g, ' ').trim();
      if (!line) return;
      // Fecha con puntos («05.09.2026»): es fecha, no una hora «05.09»
      const dot = /(^|[^\d.])(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?![\d.])/.exec(line);
      if (dot) {
        const d = parseDate(dot[2], ctx);
        if (d) {
          const sinFecha = (line.slice(0, dot.index + dot[1].length) + ' ' + line.slice(dot.index + dot[0].length)).replace(/\s+/g, ' ').trim();
          if (!findTimes(sinFecha).length) { flush(); curDay = d.iso; return; }   // cabecera de jornada («HORARIOS SÁBADO 05.09.2026»)
        }
      }
      const times = findTimes(line);
      if (!times.length) {
        const fd = findDate(line, ctx);
        if (fd && !/[a-z]{3,}/i.test(norm(fd.rest).replace(/\b(de|del|jornada|dia|day)\b/g, ''))) { flush(); curDay = fd.d.iso; return; }
        // Cabecera con fecha completa y más texto («HOJA DE RUTA · VIERNES 10 JULIO», «HORARIOS SÁBADO 05.09.2026»)
        const fdn = findDate(line, ctx, true);
        if (fdn) { flush(); curDay = fdn.d.iso; return; }
        if (pend) {                                            // dentro de un bloque: actividad y luego notas
          if (!pend.rec.banda) {
            const a = activity(line);
            pend.rec.banda = a.banda; pend.rec.raw += ' | ' + line;
            if (a.dur) pend.rec.duracion = a.dur;
            if (a.notas) pend.rec.notas = pend.rec.notas ? a.notas + ' · ' + pend.rec.notas : a.notas;
          } else { pend.rec.notas = pend.rec.notas ? pend.rec.notas + ' · ' + line : line; pend.rec.raw += ' | ' + line; }
          return;
        }
        const st = findStage(line, stageNames);
        if (st) { curStage = st; return; }
        // «Escenario: Principal» → Principal · «ESCENARIO PRINCIPAL», «CARPA», «MAIN STAGE» → la línea entera es la zona
        const m = /^(?:escenario|stage|sala|zona)\s*[:\-–]\s*(.+)$/i.exec(line);
        if (m) { curStage = cleanName(m[1]); return; }
        const sec = sectionTitle(line);
        if (sec === 'zona') { curStage = cleanName(line); return; }
        if (sec === 'otra') { curStage = ''; ignored.push({ n: i + 1, line, why: 'sección' }); return; }
        ignored.push({ n: i + 1, line });
        return;
      }
      flush();
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
      const td = takeDuration(rest); rest = td.text;
      const paren = /\(([^)]+)\)|\[([^\]]+)\]/.exec(rest);
      const st = findStage(rest, stageNames);
      if (st) { escenario = st; rest = removeWord(rest.replace(/[()\[\]]/g, ' '), st); }
      else if (paren && /\b(escenario|stage|sala|carpa|tarima|auditorio|plaza|club|room)\b/i.test(paren[1] || paren[2])) { escenario = cleanName(paren[1] || paren[2]); rest = rest.replace(paren[0], ' '); }
      else {
        // Paréntesis que no es un escenario («(por turnos)», «(con Kiki)»): a notas
        if (paren) { notas = cleanName(paren[1] || paren[2]) + (notas ? ' · ' + notas : ''); rest = rest.replace(paren[0], ' '); }
        if (curStage) escenario = curStage;
      }
      // Si hay más paréntesis (no de zona) también van a notas
      rest = rest.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (m, a, b) => { const x = cleanName(a || b); if (x) notas = notas ? notas + ' · ' + x : x; return ' '; });
      const rec = { src: i, raw: line, banda: cleanName(rest), escenario,
        jornadaTxt: jornadaTxt || curDay, inicioTxt: ini.hm, finTxt: fin ? fin.hm : '', duracion: td.dur, callTxt: '', notas: notas };
      const p = { rec, glued, ini, fin };
      if (!rec.banda) { pend = p; return; }               // solo la hora: empieza un bloque
      finish(p);
    });
    flush();
    return { records: recs, ignored };
  }

  /** «Show Paula Mattheus (45')» → { text: 'Show Paula Mattheus', dur: '45' }. */
  const DUR_PAREN = /\(\s*(\d{1,3})\s*(?:['’′´`]{1,2}|min|mins|minutos|minutes)\s*\)/i;
  function takeDuration(text) {
    const m = DUR_PAREN.exec(text || '');
    return m ? { text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), dur: m[1] } : { text: text || '', dur: '' };
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
    if (!ini && r.inicioTxt) {
      const ft = findTimes(r.inicioTxt);
      if (ft.length) {
        ini = ft[0].t; let end = ft[0].j;
        if (ft[1] && /^\s*(?:-|–|—|a|hasta|to|>|\/)?\s*$/i.test(r.inicioTxt.slice(ft[0].j, ft[1].i)) && !r.finTxt) { r.finTxt = ft[1].t.hm; end = ft[1].j; }
        const extra = cleanName((r.inicioTxt.slice(0, ft[0].i) + ' ' + r.inicioTxt.slice(end)).replace(/[()\[\]]/g, ' '));
        if (extra) r.notas = r.notas ? extra + ' · ' + r.notas : extra;
      }
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
    if (!String(r.duracion || '').trim()) { const td = takeDuration(r.banda); if (td.dur) { r.banda = td.text; r.duracion = td.dur; } }
    r.banda = cleanName(r.banda);
    r.escenario = cleanName(r.escenario);
    r.duracion = durMinutes(r.duracion);
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
          if (o.createStages && o.createStages[norm(r.escenario)] === false) errs.push('La zona «' + r.escenario + '» no existe (marca «crear» o cámbiala)');
          else warns.push('Zona nueva: ' + r.escenario);
        }
      } else if (o.defaultStageId && C.getEscenario(state, o.defaultStageId)) stage = C.getEscenario(state, o.defaultStageId);   // «Zona por defecto»: para todo lo que no trae zona
      else if (!band) { /* tareas e hitos: escenario opcional */ }
      else if ((state.escenarios || []).length) errs.push('Falta la zona (elige una por defecto o una columna)');
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
          // Con las dos horas escritas mandan las horas: la duración no cuadra → aviso (en las tablas reales a veces está mal la duración)
          if (fin && fin !== byDur) warns.push('La duración (' + r.duracion + ' min) no cuadra con ' + r.inicio + '–' + fin + ': se queda la hora de fin');
          else if (!fin) { fin = byDur; warns.push('Fin calculado con la duración: ' + byDur); }
        }
      }
      let call = r.call;
      if (tipo === 'hito') {
        if (fin) warns.push('Un hito no tiene fin: se ignora ' + fin);
        fin = '';
      } else if (r.inicio && !fin) warns.push('Sin fin: se estiman ' + C.DEFAULT_DURATION + ' min');   // un hito es un instante: nunca lleva este aviso
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
    // Zonas NUEVAS solo de shows y soundchecks: el sitio de una tarea o un hito («Hotel», «Aeropuerto», «Recinto») no es un escenario.
    // Si ninguna banda toca en ese sitio, va a notas y no se crea la zona.
    const bandPlaces = new Set(rows.filter(r => (r.tipo === 'show' || r.tipo === 'sc') && r.stageNew).map(r => norm(r.stageNew)));
    rows.forEach(r => {
      if (!r.stageNew || r.tipo === 'show' || r.tipo === 'sc' || bandPlaces.has(norm(r.stageNew))) return;
      const place = r.stageNew;
      r.notas = r.notas ? place + ' · ' + r.notas : place;
      r.warns = r.warns.filter(w => w !== 'Zona nueva: ' + place);
      r.errs = r.errs.filter(w => w.indexOf('La zona «' + place + '» no existe') !== 0);
      r.escenario = ''; r.stageNew = '';
      r.status = r.errs.length ? 'err' : r.warns.length ? 'warn' : 'ok';
      if (r.include === false && !r.errs.length && !(o.include && o.include[r.idx] === false)) r.include = true;
    });
    for (let k = newStages.length - 1; k >= 0; k--) if (!rows.some(r => r.stageNew && norm(r.stageNew) === norm(newStages[k]))) newStages.splice(k, 1);
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

  /** ¿Hoja de producción (hoja de ruta, day sheet) y no un cartel? Si al menos 2 entradas y un 25 % llevan palabras inequívocas de
   *  producción (comidas, montaje, transfer, puertas, citación, prueba…), las palabras «débiles» (hotel, bus, prensa…) también cuentan. */
  function markProduction(rd) {
    const recs = rd.records || [];
    const hits = recs.filter(r => { const n = norm(r.banda); return TAREA_RE.test(n) || HITO_RE.test(n) || SC_HEAD.test(r.banda || '') || r.tipoCol === 'sc'; }).length;
    rd.production = recs.length > 0 && hits >= 2 && hits >= recs.length * 0.25;
    if (rd.production) recs.forEach(r => { r.docProd = true; });
    return rd;
  }

  /** Atajo: texto → { kind, sep?, rows?, map?, header?, records, ignored } */
  function read(text, ctx, forced) { return markProduction(read0(text, ctx, forced)); }
  function read0(text, ctx, forced) {
    text = joinQuotedLines(text);
    const d = detect(text);
    if (d.kind === 'vacio') return { kind: 'vacio', records: [], ignored: [] };
    if (d.kind === 'texto') { const t = textRecords(text, ctx); return { kind: 'texto', records: t.records, ignored: t.ignored }; }
    const rows = parseTable(text, d.sep);
    // La cabecera puede no ser la primera fila (títulos encima): se busca en las 6 primeras
    let hi = 0, head = null;
    for (let i = 0; i < Math.min(6, rows.length) && !head; i++) { const h = headerKeys(rows[i]); if (h && h.filter(k => k && k !== 'ignorar').length >= 2) { head = h; hi = i; } }
    if (!head) { head = headerKeys(rows[0] || []); hi = 0; }
    const hasHeader = forced && forced.header !== undefined ? forced.header : !!head;
    if (!hasHeader) hi = 0;
    const header = hasHeader ? rows[hi] : null;
    const data = hasHeader ? rows.slice(hi + 1) : rows;
    const pre = hasHeader ? rows.slice(0, hi).map((r, i) => ({ n: i + 1, line: r.filter(x => x).join(' | '), why: 'título' })) : [];
    // Parrilla con UNA COLUMNA POR ESCENARIO (HORA · ESCENARIO 1 · ESCENARIO 2…): cada celda es una banda en esa zona y hora
    if (hasHeader && head && !(forced && forced.map)) {
      const mx = matrixColumns(head, header, data, ctx);
      if (mx) {
        const prow = [];
        data.forEach(r => mx.stages.forEach(c => { if (String(r[c] || '').trim()) prow.push([r[mx.time], cleanName(header[c]), r[c], mx.jor >= 0 ? r[mx.jor] : '']); }));
        const pmap = ['inicio', 'escenario', 'banda', mx.jor >= 0 ? 'jornada' : 'ignorar'];
        const tr = tableRead(prow, pmap, ctx, {});
        return { kind: 'tabla', sep: d.sep, rows, header, headerRow: hi, hasHeader, map: head.map((k, c) => c === mx.time ? 'inicio' : c === mx.jor ? 'jornada' : mx.stages.indexOf(c) >= 0 ? 'escenario' : 'ignorar'),
          matrix: true, zone: '', records: tr.records, ignored: tr.ignored };
      }
    }
    let map, zoneCol = null, zone = '';
    if (forced && forced.map) map = forced.map;
    else if (hasHeader && head) map = resolveHeader(head, header, data, ctx);
    else map = guessColumns(data, ctx);
    // Zona en el título de la primera columna («GIGANTE», «MAIN STAGE»): si no hay columna de zona y esa columna no es de datos de zona
    if (hasHeader && header && map.indexOf('escenario') < 0) {
      const c0 = map.findIndex((k, c) => (k === 'jornada' || k === 'ignorar') && cleanName(header[c]) && isZoneTitle(header[c]));
      if (c0 === 0) { zoneCol = 0; zone = cleanName(header[0]); }
    }
    let day = '';
    rows.slice(0, hasHeader ? hi : 0).forEach(r => { const t = r.filter(x => x).join(' '), fd = findDate(t, ctx, true); if (fd) day = fd.d.iso; });
    const tr = tableRead(data, map, ctx, { header, zoneCol, zone, day });
    return { kind: 'tabla', sep: d.sep, rows, header, headerRow: hasHeader ? hi : -1, hasHeader, map, zone, records: tr.records, ignored: pre.concat(tr.ignored) };
  }

  /** Libro de Excel con una hoja por zona («GIGANTE», «VIBRAMAHOU»…): junta las hojas que son horarios con LAS MISMAS columnas
   *  (cada una aporta su zona por el título de su cabecera). Las hojas sin horarios (personal, turnos) o con otras columnas se dejan fuera.
   *  sheets: [{ name, text }] → { text, used: [nombres], skipped: [nombres] } */
  function mergeSheets(sheets, ctx) {
    const used = [], skipped = [], parts = []; let key = null;
    (sheets || []).forEach(sh => {
      const rd = read(sh.text, Object.assign({}, ctx || {}));
      const good = rd.kind === 'tabla' && rd.hasHeader && rd.records.filter(r => r.inicio).length >= 1 && rd.map.indexOf('banda') >= 0;
      if (!good) { skipped.push(sh.name); return; }
      const k = rd.header.slice(1).map(norm).join('|').replace(/\|+$/, '');   // sin las columnas vacías del final
      if (key === null) key = k;
      if (k !== key) { skipped.push(sh.name); return; }
      used.push(sh.name); parts.push(sh.text);
    });
    return { text: parts.join('\n'), used, skipped };
  }

  /** Sin evento abierto: evento PROVISIONAL para la vista previa, con las jornadas que trae el horario (de la primera a la
   *  última, máx. 31) o, si no trae fechas, la jornada de hoy. Solo se guarda si el Stage Manager pulsa «Importar».
   *  forced: las mismas opciones de lectura que la vista previa (cabecera, columnas). now: minutos absolutos (para los tests). */
  function provisionalState(text, now, forced) {
    const cut = { event: { dayCutoff: C.DEFAULT_CUTOFF } };
    const today = C.jornadaOfAbs(cut, Number.isFinite(now) ? now : C.nowAbs());
    const rd = read(text, { year: +today.slice(0, 4), days: [], stageNames: [], today }, forced || {});
    const days = Array.from(new Set(rd.records.map(r => r.jornada).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')))).sort();
    let fi = days.length ? days[0] : today, ff = days.length ? days[days.length - 1] : today;
    const span = (Date.parse(ff) - Date.parse(fi)) / 86400000;
    if (span > 30) ff = new Date(Date.parse(fi) + 30 * 86400000).toISOString().slice(0, 10);   // el resto saldrá como «fuera del evento»
    return C.newFestival({ nombre: 'Evento sin nombre', fechaInicio: fi, fechaFin: ff, dayCutoff: C.DEFAULT_CUTOFF }).state;
  }

  const API = { norm, parseTime, parseRange, parseDate, detect, splitRow, parseTable, guessHeader, guessColumns, tableRecords,
    textRecords, findTimes, interpret, preview, apply, contextOf, read, KEYS, KEY_LABEL, headerKey, durMinutes, joinQuotedLines, tableRead, mergeSheets, splitGlued, proposeTipo, tipoFromText, TIPO_KEYS, TIPO_LABEL, provisionalState };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeImport = API;
})(typeof window !== 'undefined' ? window : globalThis);
