/* Showtime — core.js
 * Reglas de tiempo puras: sin DOM, sin localStorage, sin reloj implícito.
 * Lo usan la pantalla Live y el panel de control. Tests: node tests/core.test.js
 *
 * REGLA DE ORO: todo el tiempo en MINUTOS ABSOLUTOS desde 2000-01-01 00:00 (hora local).
 * Nunca mezclar con «hora del día» (0–1439).
 */
(function (root) {
  'use strict';

  const DEFAULT_CUTOFF = '06:00';
  const DEFAULT_CALL_MINS = 15;
  const DEFAULT_CO_MIN = 15;            // changeover mínimo (min) del evento
  const DEFAULT_DURATION = 60;          // si un bloque no tiene fin
  const MAX_NEXT = 4;                   // «Siguiente»: máximo de filas
  const ARTIST_COLORS = ['#e94560','#4fc3f7','#1de9b6','#ffb347','#c77dff','#ff9a3c','#84fab0','#f77f00','#a8edea','#fed6e3'];
  const EPOCH_UTC = Date.UTC(2000, 0, 1);

  // ── Utilidades de formato ─────────────────────────────────────────────
  function pad2(n) { return String(n).padStart(2, '0'); }

  /** "HH:MM" → minutos del día, o null si no es válido. */
  function parseHM(hm) {
    if (!hm || typeof hm !== 'string') return null;
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hm);
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** Minutos absolutos → "HH:MM" (hora del día). */
  function fmtHM(abs) {
    if (abs === null || abs === undefined || !Number.isFinite(abs)) return '—';
    const a = Math.floor(abs);
    const hh = Math.floor((((a % 1440) + 1440) % 1440) / 60);
    const mm = ((a % 60) + 60) % 60;
    return pad2(hh) + ':' + pad2(mm);
  }

  /** "YYYY-MM-DD" → días desde 2000-01-01, o null. Cálculo en UTC: no le afecta el cambio de hora. */
  function dayIndex(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // 2026-02-30
    return Math.round((t - EPOCH_UTC) / 864e5);
  }

  /** Días desde 2000-01-01 → "YYYY-MM-DD". */
  function isoOfDay(idx) {
    const d = new Date(EPOCH_UTC + idx * 864e5);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function shiftDate(iso, days) {
    const i = dayIndex(iso);
    return i === null ? iso : isoOfDay(i + days);
  }

  /** (fecha, "HH:MM") → minutos absolutos. Sin fecha válida devuelve solo la hora del día (como Stage Master). */
  function toAbs(fecha, hm) {
    const t = parseHM(hm);
    if (t === null) return null;
    const di = dayIndex(fecha);
    if (di === null) return t;
    return di * 1440 + t;
  }

  /** Fin que cruza medianoche: si fin ≤ inicio, se le suma un día. */
  function adjustEnd(si, sf) {
    if (si === null || sf === null || si === undefined || sf === undefined) return sf;
    return sf <= si ? sf + 1440 : sf;
  }

  /** «Ahora» en minutos absolutos (con fracción de segundos), a partir de la hora local del Date. */
  function nowAbs(date) {
    const d = date || new Date();
    const days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / 864e5);
    return days * 1440 + d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  // ── Día de festival ───────────────────────────────────────────────────
  function cutoffMins(state) {
    const v = parseHM(state && state.event && state.event.dayCutoff);
    return v === null ? parseHM(DEFAULT_CUTOFF) : v;
  }

  /** Jornada del festival: lo que empieza antes de la hora de corte es del día anterior. Solo para filtrar. */
  function festivalDateOf(state, artist, useSoundcheck) {
    const fecha = (useSoundcheck ? (artist.soundcheckFecha || artist.fecha) : artist.fecha) || '';
    if (!fecha) return '';
    const mins = parseHM((useSoundcheck ? artist.soundcheckInicio : artist.inicio) || '');
    if (mins === null || mins >= cutoffMins(state)) return fecha;
    return shiftDate(fecha, -1);
  }

  function isSC(mode) { return mode === 'sc' || mode === 'soundcheck'; }
  /** Vista «Jornada completa»: shows, soundchecks, tareas e hitos juntos. */
  function isAll(mode) { return mode === 'all'; }

  // ── Tipos de entrada (los elige el regidor; nunca se deducen solos) ────
  // banda: show y/o soundcheck, con changeover, CALL y solapes.
  // tarea: operativa del día (comidas, montajes…): barra en la Live, sin solapes, changeover ni CALL.
  // hito:  momento puntual (puertas, curfew…): línea vertical en la Live; no tiene fin.
  // Tareas e hitos guardan su horario en los campos del show (fecha, inicio, fin, notas).
  const TIPOS = ['banda', 'tarea', 'hito'];
  /** LED de la columna DELAY: rojo = fija (no se mueve con los retrasos). Por defecto, verde. */
  function isFija(artist) { return !!(artist && artist.showtimeFija); }
  /** LED forzado a verde: se mueve aunque su categoría esté bloqueada en Retrasos. */
  function isLibre(artist) { return !!(artist && artist.showtimeLibre); }
  function tipoOf(artist) { const t = artist && artist.showtimeTipo; return t === 'tarea' || t === 'hito' ? t : 'banda'; }
  /** ¿Bloque de banda (show o soundcheck)? Los bloques sin «kind» (antiguos) cuentan como banda. */
  function isBand(b) { return !!b && (!b.kind || b.kind === 'show' || b.kind === 'sc'); }

  /** ¿Entra el artista en esta vista? Show: inicio o fin. Soundcheck: inicio o CALL.
   *  Jornada completa: cualquier horario (y tareas/hitos con inicio). Tareas e hitos solo salen en Jornada completa. */
  function entersMode(artist, mode) {
    const t = tipoOf(artist);
    if (isAll(mode)) return t === 'banda' ? !!(artist.inicio || artist.fin || artist.soundcheckInicio || artist.soundcheckCall) : !!artist.inicio;
    if (t !== 'banda') return false;
    return isSC(mode) ? !!(artist.soundcheckInicio || artist.soundcheckCall) : !!(artist.inicio || artist.fin);
  }

  /** Entradas de una vista: [{ a, sc, kind }]. En Jornada completa una banda puede salir dos veces (show y soundcheck). */
  function entriesOf(state, mode) {
    const out = [];
    ((state && state.artists) || []).forEach(a => {
      const t = tipoOf(a);
      if (t !== 'banda') { if (isAll(mode) && a.inicio) out.push({ a, sc: false, kind: t }); return; }
      const show = !!(a.inicio || a.fin), sc = !!(a.soundcheckInicio || a.soundcheckCall);
      if (show && !isSC(mode)) out.push({ a, sc: false, kind: 'show' });
      if (sc && (isSC(mode) || isAll(mode))) out.push({ a, sc: true, kind: 'sc' });
    });
    return out;
  }

  /** Jornadas presentes en los datos de una vista (para el selector de día), ordenadas. */
  function festivalDays(state, mode) {
    const set = new Set();
    entriesOf(state, mode).forEach(e => {
      const d = festivalDateOf(state, e.a, e.sc);
      if (d) set.add(d);
    });
    return Array.from(set).sort();
  }

  // ── Escenarios y colores ──────────────────────────────────────────────
  function getEscenario(state, id) {
    return ((state && state.escenarios) || []).find(e => e.id === id) || null;
  }

  function artistColor(state, artist) {
    if (artist && artist.color) return artist.color;
    const i = ((state && state.artists) || []).indexOf(artist);
    return ARTIST_COLORS[(i < 0 ? 0 : i) % ARTIST_COLORS.length];
  }

  /** Hora de CALL "HH:MM" → minutos absolutos, en la ocurrencia más cercana al inicio (±12 h).
   *  Arregla ESPEC §8: un CALL a las 23:30 para un show a las 00:30 cae la víspera, no un día tarde.
   *  Sin inicio, se usa la fecha del bloque. */
  function callAbsFor(si, callHM, fecha) {
    const t = parseHM(callHM);
    if (t === null) return null;
    if (si === null || si === undefined) return toAbs(fecha, callHM);
    let c = Math.floor(si / 1440) * 1440 + t;
    const diff = c - si;
    if (diff > 720) c -= 1440;
    else if (diff < -720) c += 1440;
    return c;
  }

  // ── Campos del proyecto por modo ──────────────────────────────────────
  // Los de Stage Master y, con prefijo «showtime», los que añade Showtime (Stage Master los ignora).
  const FIELDS = {
    show: { fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'showtimeCall', notas: 'notas', standby: 'showtimeStandby', real: 'showtimeReal', base: 'showtimeBase' },
    sc:   { fecha: 'soundcheckFecha', inicio: 'soundcheckInicio', fin: 'soundcheckFin', call: 'soundcheckCall', notas: 'soundcheckNotas', standby: 'showtimeStandbySC', real: 'showtimeRealSC', base: 'showtimeBaseSC' }
  };

  // ── De proyecto Stage Master a bloques ────────────────────────────────
  /**
   * opts: { mode: 'show' | 'sc' | 'all', day: 'all' | 'YYYY-MM-DD' }
   * Devuelve los bloques ordenados por inicio absoluto (sin inicio, al final).
   * Cada bloque lleva kind: 'show' | 'sc' | 'tarea' | 'hito' y key = id:kind (única en la vista).
   */
  function buildBlocks(state, opts) {
    const o = opts || {};
    const day = o.day || 'all';
    let arr = entriesOf(state, isAll(o.mode) ? 'all' : isSC(o.mode) ? 'sc' : 'show');
    if (day !== 'all') arr = arr.filter(e => festivalDateOf(state, e.a, e.sc) === day);

    const blocks = arr.map(e => {
      const a = e.a, sc = e.sc, kind = e.kind, band = kind === 'show' || kind === 'sc';
      const f = sc ? (a.soundcheckFecha || a.fecha) : a.fecha;
      const psi = toAbs(f, sc ? a.soundcheckInicio : a.inicio);
      const psf = kind === 'hito' ? null : adjustEnd(psi, toAbs(f, sc ? a.soundcheckFin : a.fin));
      // Horas REALES (opcionales: «Empezar» / «Terminar»). Sin ellas, todo va en hora (real = teórica).
      const real = kind !== 'hito' ? (a[FIELDS[sc ? 'sc' : 'show'].real] || null) : null;
      const ri = real && Number.isFinite(real.i) ? real.i : null;
      const rf = real && Number.isFinite(real.f) ? real.f : null;
      const dur = (psi !== null && psf !== null) ? psf - psi : null;
      const si = ri !== null ? ri : psi;                                   // inicio efectivo
      const sf = kind === 'hito' ? null : rf !== null ? rf : (ri !== null && dur !== null ? ri + dur : psf);   // fin efectivo (previsto)
      const delta = rf !== null && psf !== null ? rf - psf : ri !== null && psi !== null ? ri - psi : null;
      // Inicio ORIGINAL antes de los retrasos (se apunta la primera vez que un retraso la mueve; editar a mano lo borra)
      const bs = a[FIELDS[sc ? 'sc' : 'show'].base], base = Number.isFinite(bs) ? bs : null;
      const call = band ? ((sc ? a.soundcheckCall : a[FIELDS.show.call]) || '') : '';
      const esc = getEscenario(state, a.escenarioId);
      return {
        id: a.id, kind: kind, key: a.id + ':' + kind,
        si: si, sf: sf, psi: psi, psf: psf, ri: ri, rf: rf, delta: delta, base: base,
        fija: isFija(a), libre: isLibre(a),
        name: a.nombre || '',
        color: artistColor(state, a),
        notes: (sc ? a.soundcheckNotas : a.notas) || '',
        call: call,
        callAbs: call ? callAbsFor(si, call, f) : null,
        stage: esc ? (esc.nombre || '') : '',
        stageId: esc ? esc.id : '',
        stageColor: esc ? (esc.color || '') : '',
        standby: band && !!a[FIELDS[sc ? 'sc' : 'show'].standby],   // hueco ANTES de este bloque marcado a mano como STANDBY
        jornada: festivalDateOf(state, a, sc)                 // día del festival (con la hora de corte)
      };
    });

    blocks.sort((a, b) => {
      const an = a.si === null, bn = b.si === null;
      if (an || bn) return an === bn ? 0 : (an ? 1 : -1);
      return a.si - b.si;
    });
    return blocks;
  }

  // ── Quién está, quién viene, a quién avisar ───────────────────────────
  function blockEnd(b) {
    if (b.kind === 'hito') return b.si;
    return (b.sf !== null && b.sf !== undefined) ? b.sf : b.si + DEFAULT_DURATION;
  }

  function hasStart(b) { return b && b.si !== null && b.si !== undefined; }

  function isPlaying(b, now) {
    return hasStart(b) && now >= b.si && now < blockEnd(b);
  }

  /** En escena: todos los que suenan ahora (puede haber varios escenarios). */
  function playingNow(blocks, now) {
    return blocks.filter(b => isBand(b) && isPlaying(b, now));
  }

  /** Tareas en curso ahora (operativa del día; no son de escenario). */
  function tasksNow(blocks, now) {
    return blocks.filter(b => b.kind === 'tarea' && isPlaying(b, now));
  }

  /** Hitos de una jornada (o de todas), en cualquier vista: líneas de referencia en la Live. */
  function hitosOf(state, day) {
    return buildBlocks(state, { mode: 'all', day: day || 'all' }).filter(b => b.kind === 'hito' && hasStart(b));
  }

  /** Siguiente: el próximo de cada escenario (sin escenario cuenta como un grupo), hasta max. */
  function nextPerStage(blocks, now, max) {
    const lim = max || MAX_NEXT;
    const up = blocks.filter(b => isBand(b) && hasStart(b) && b.si > now).sort((a, b) => a.si - b.si);
    const seen = new Set(), out = [];
    for (const b of up) {
      const key = stageKey(b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
      if (out.length >= lim) break;
    }
    return out;
  }

  function stageKey(b) { return b.stageId || b.stage || '__none__'; }

  /** Changeover antes de un bloque: hueco desde el final del anterior del MISMO escenario.
   *  Devuelve { prev, mins, idle } o null si es el primero de su escenario. mins < 0 = solapan. */
  /** Solo dentro de la MISMA jornada: la primera banda de cada día no tiene cambio previo. */
  /** Solo entre BANDAS (show o soundcheck): tareas e hitos no tienen changeover ni solapan. */
  /** idle = el hueco NO es un cambio real (decisión 76): misma entrada (soundcheck → show de la misma banda)
   *  o una tarea de la misma zona dentro del hueco. Los hitos (puertas…) no rompen el cambio.
   *  `tareas` (opcional): tareas a tener en cuenta (por defecto, las que haya en `blocks`). Solo etiqueta: no toca Δ/A. */
  function changeoverBefore(blocks, b, tareas) {
    if (!hasStart(b) || !isBand(b)) return null;
    const k = stageKey(b);
    let prev = null;
    blocks.forEach(x => {
      if (x === b || !isBand(x) || !hasStart(x) || stageKey(x) !== k || x.si >= b.si) return;
      if ((x.jornada || '') !== (b.jornada || '')) return;
      if (!prev || x.si > prev.si) prev = x;
    });
    return prev ? { prev: prev, mins: Math.round(b.si - blockEnd(prev)), idle: gapIdle(prev, b, tareas || blocks) } : null;
  }

  /** ¿El hueco entre prev y b (misma zona) es «sin actividad» y no un changeover? */
  function gapIdle(prev, b, tareas) {
    if (!prev) return true;
    if (prev.id && prev.id === b.id) return true;                 // soundcheck → show de la misma banda
    const k = stageKey(b), s = blockEnd(prev), e = b.si;
    return (tareas || []).some(x => x.kind === 'tarea' && hasStart(x) && stageKey(x) === k && x.si < e && blockEnd(x) > s);
  }

  /** Próxima banda de una zona después de `now` (para «después: …» de tareas y huecos). */
  function nextBandIn(blocks, stageId, now) {
    const k = stageId || '__none__';
    let best = null;
    blocks.forEach(x => { if (isBand(x) && hasStart(x) && stageKey(x) === k && x.si > now && (!best || x.si < best.si)) best = x; });
    return best;
  }

  /** Escenarios SIN BANDA ahora con una banda después (decisión 76):
   *  - con una tarea en curso en la zona (de las de `blocks`) no sale nada: manda la tarjeta de la tarea;
   *  - kind 'changeover': cambio real entre dos bandas consecutivas (la anterior ya acabó);
   *  - kind 'idle': hueco sin cambio (tarea en medio, misma banda SC→show, o antes de la primera banda del día);
   *  - standby: marcado a mano (manda sobre el tipo; solo en huecos entre dos bandas).
   *  Devuelve [{ kind, stage, stageId, stageColor, standby, prev, next, start, end, total, remaining, pct }].
   *  remaining/total en minutos (con fracción). En 'idle' antes de la primera banda: prev/start null, pct 0.
   *  `tareas` (opcional): tareas para clasificar el hueco aunque la vista no las pinte. */
  function changeoversNow(blocks, now, tareas) {
    const out = [], seen = new Set();
    const busy = new Set(blocks.filter(b => (isBand(b) || b.kind === 'tarea') && isPlaying(b, now)).map(stageKey));
    // Jornada «en curso» (para no anunciar la primera banda de otro día en la vista de todos los días)
    let cur = null;
    blocks.forEach(b => { if (hasStart(b) && b.si <= now && (!cur || b.si >= cur.si)) cur = b; });
    if (!cur) blocks.forEach(b => { if (hasStart(b) && (!cur || b.si < cur.si)) cur = b; });
    const curJor = cur ? (cur.jornada || '') : '';
    blocks.forEach(b => {
      if (!isBand(b) || !hasStart(b) || b.si <= now) return;
      const k = stageKey(b);
      if (seen.has(k) || busy.has(k)) return;
      seen.add(k);                                   // b = el próximo de su escenario
      const co = changeoverBefore(blocks, b, tareas);
      const base = { stage: b.stage, stageId: b.stageId, stageColor: b.stageColor, next: b, end: b.si, remaining: Math.max(0, b.si - now) };
      if (!co) {                                     // primera banda del día en su zona
        if ((b.jornada || '') !== curJor) return;
        out.push(Object.assign(base, { kind: 'idle', standby: false, prev: null, start: null, total: null, pct: 0 }));
        return;
      }
      if (blockEnd(co.prev) > now) return;           // solapa con el anterior
      const start = blockEnd(co.prev), total = Math.max(0, b.si - start);
      out.push(Object.assign(base, {
        kind: co.idle ? 'idle' : 'changeover', standby: !!b.standby,
        prev: co.prev, start: start, total: total,
        pct: total > 0 ? Math.max(0, Math.min(100, (now - start) / total * 100)) : 100
      }));
    });
    return out;
  }

  /** Progreso de un bloque que suena: minutos restantes y porcentaje. */
  function progress(b, now) {
    const s = b.si, e = blockEnd(b);
    const span = Math.max(1, e - s);
    const done = Math.max(0, now - s);
    return {
      pct: Math.max(0, Math.min(100, done / span * 100)),
      remaining: Math.max(0, Math.round(span - done))
    };
  }

  function callKey(b) { return b.name + '@' + b.si; }

  /** Momento en que salta el aviso (cascada):
   *  1) hora de CALL escrita en el artista (callAbs), si es válida y anterior al inicio;
   *  2) si no (vacía, «—», inválida), inicio − callMins. */
  function callAt(b, callMins) {
    if (!hasStart(b)) return null;
    const cm = Number.isFinite(callMins) ? callMins : DEFAULT_CALL_MINS;
    if (b.callAbs !== null && b.callAbs !== undefined && Number.isFinite(b.callAbs) && b.callAbs < b.si) return b.callAbs;
    return b.si - cm;
  }

  /** CALL por MARGEN, no por instante: sale desde callAt hasta el inicio (sin incluirlo),
   *  aunque se abra tarde. done: Set (o array) de claves callKey ya avisadas. */
  function callList(blocks, now, callMins, done) {
    const d = done instanceof Set ? done : new Set(done || []);
    return blocks.filter(b => {
      if (!isBand(b)) return false;
      const at = callAt(b, callMins);
      if (at === null) return false;
      if (!(now >= at && now < b.si)) return false;
      return !d.has(callKey(b));
    }).sort((a, b) => a.si - b.si);
  }

  /** Barras de abajo: desde el que suena (primero en orden) o, si no suena nadie, desde el siguiente.
   *  Si ya ha pasado todo: ended = true y barras vacías («FIN DE JORNADA»). */
  /** Los hitos no tienen barra (son líneas). Desde el primero, se saltan los que ya han terminado
   *  (con varios escenarios o tareas largas, un bloque posterior puede acabar antes). */
  function pickBlocks(blocks, now, n) {
    const bl = blocks.filter(b => b.kind !== 'hito');
    let cur = null, nxt = null;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (!hasStart(b)) continue;
      if (isPlaying(b, now)) { cur = b; break; }
      if (b.si > now && !nxt) nxt = b;
    }
    const start = cur || nxt;
    const ended = !start && bl.some(hasStart);
    const idx = start ? bl.indexOf(start) : -1;
    const list = [];
    if (idx >= 0) for (let i = idx; i < bl.length && list.length < n; i++) {
      const b = bl[i];
      if (b !== start && hasStart(b) && blockEnd(b) <= now) continue;
      list.push(b);
    }
    while (list.length < n) list.push(null);
    return { list: list, playing: !!cur, ended: ended };
  }

  /** Etiqueta de cada barra. Sin nadie sonando, la primera es SIGUIENTE y las demás corren un puesto
   *  (antes salían dos «SIGUIENTE» seguidas). */
  function stripLabel(i, playing) {
    if (playing) return i === 0 ? 'AHORA' : i === 1 ? 'SIGUIENTE' : 'EN ' + i + 'º LUGAR';
    return i === 0 ? 'SIGUIENTE' : 'EN ' + (i + 1) + 'º LUGAR';
  }

  /** Etiquetas de las barras según el ESTADO de cada bloque (no su posición):
   *  banda sonando → AHORA · tarea en curso → TAREA · EN CURSO · tarea pendiente → TAREA · HH:MM
   *  bandas que vienen → SIGUIENTE, EN 2º LUGAR, EN 3º LUGAR… (solo cuentan las bandas). */
  function stripLabels(list, now) {
    let k = 0;
    return list.map(b => {
      if (!b) return '';
      if (b.kind === 'tarea') return isPlaying(b, now) ? 'TAREA · EN CURSO' : 'TAREA · ' + fmtHM(b.si);
      if (isPlaying(b, now)) return 'AHORA';
      const l = k === 0 ? 'SIGUIENTE' : 'EN ' + (k + 1) + 'º LUGAR';
      k++;
      return l;
    });
  }

  // ── Edición (siempre explícita: devuelve un estado NUEVO, nunca toca el original) ──
  /** Hora tecleada → "HH:MM". Acepta 21:30, 21.30, 2130, 9:05. Vacío, «—» o «-» → ''. Inválida → null. */
  function normHM(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '' || t === '—' || t === '-' || t === '–') return '';
    const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(t);
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }

  function modeKey(mode) { return isSC(mode) ? 'sc' : 'show'; }
  const SHARED_KEYS = ['nombre', 'escenario', 'color', 'tipo', 'fija'];  // iguales en show y soundcheck
  const MODE_KEYS = ['fecha', 'inicio', 'fin', 'call', 'notas', 'standby'];

  /** Valor efectivo de un campo (en soundcheck la fecha cae a la del show si falta). */
  function fieldValue(artist, mode, key) {
    if (key === 'nombre') return String(artist.nombre || '');
    if (key === 'escenario') return String(artist.escenarioId || '');
    if (key === 'color') return String(artist.color || '');
    if (key === 'tipo') return tipoOf(artist);
    if (key === 'fija') return isFija(artist) ? 'si' : isLibre(artist) ? 'libre' : '';
    const F = FIELDS[modeKey(mode)];
    if (key === 'standby') return !!artist[F.standby];
    if (key === 'fecha' && isSC(mode)) return artist[F.fecha] || artist.fecha || '';
    return artist[F[key]] == null ? '' : String(artist[F[key]]);
  }

  function findArtistIndex(state, id) {
    return ((state && state.artists) || []).findIndex(a => String(a.id) === String(id));
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** Fecha real a partir de la JORNADA y la hora: antes de la hora de corte es el día siguiente.
   *  (La misma regla del día de festival, aplicada al revés: jornada vie + 02:00 → fecha sáb.) */
  function fechaFor(state, jornada, hm) {
    const t = parseHM(hm);
    if (dayIndex(jornada) === null) return '';
    return (t !== null && t < cutoffMins(state)) ? shiftDate(jornada, 1) : jornada;
  }

  /** Jornada de un artista en un modo ('' si no tiene fecha). */
  function jornadaOf(state, artist, mode) {
    const sc = isSC(mode);
    // Soundcheck sin fecha ni hora propias: no se toma la del show (sería suponer). La elige el regidor.
    if (sc && !artist.soundcheckFecha && !artist.soundcheckInicio) return '';
    const fecha = fieldValue(artist, mode, 'fecha');
    if (!fecha) return '';
    const a = sc ? Object.assign({}, artist, { soundcheckFecha: fecha }) : artist;
    return festivalDateOf(state, a, sc);
  }

  function normName(raw) { return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 80); }
  function normColor(raw) { const c = String(raw || '').trim(); return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null; }

  /** Cambia un campo de un artista. Claves por modo: jornada | fecha | inicio | fin | call | notas.
   *  Comunes: nombre | escenario | color. Devuelve { ok, state, changed, value } o { ok:false, error }.
   *  Al cambiar inicio o jornada se recalcula la FECHA con la hora de corte (la jornada no cambia sola). */
  function editArtist(state, id, mode, key, raw) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Artista no encontrado.' };
    const next = clone(state);
    const a = next.artists[i];
    const F = FIELDS[modeKey(mode)];
    let value, before;

    if (key === 'nombre') {
      value = normName(raw);
      if (!value) return { ok: false, error: 'El nombre no puede quedar vacío.' };
      before = a.nombre || ''; a.nombre = value;
    } else if (key === 'escenario') {
      value = String(raw || '');
      if (value && !getEscenario(next, value)) return { ok: false, error: 'Esa zona no existe.' };
      before = a.escenarioId || ''; a.escenarioId = value;
    } else if (key === 'color') {
      value = String(raw || '') === '' ? '' : normColor(raw);
      if (value === null) return { ok: false, error: 'Color no válido.' };
      before = a.color || '';
      if (value) a.color = value; else delete a.color;
    } else if (key === 'tipo') {
      value = String(raw || '').trim();
      if (TIPOS.indexOf(value) < 0) return { ok: false, error: 'Tipo no válido.' };
      before = tipoOf(a);
      if (value === before) return { ok: true, state: state, changed: false, value: value, before: before };
      // Desde la fila de soundcheck, una tarea/hito se lleva ese horario (si no hay horario de show que pisar).
      if (value !== 'banda' && isSC(mode)) {
        if (a.inicio || a.fin) return { ok: false, error: 'Tiene también horario de show: cambia el tipo desde la fila del show.' };
        const S = FIELDS.sc;
        a.fecha = a[S.fecha] || a.fecha || ''; a.inicio = a[S.inicio] || ''; a.fin = a[S.fin] || ''; a.notas = a[S.notas] || a.notas || '';
        [S.fecha, S.inicio, S.fin, S.call, S.notas, S.standby].forEach(k => { delete a[k]; });
      }
      if (value === 'banda') delete a.showtimeTipo; else a.showtimeTipo = value;
    } else if (key === 'jornada') {
      value = String(raw || '').trim();
      if (dayIndex(value) === null) return { ok: false, error: 'Elige la jornada.' };
      before = jornadaOf(state, state.artists[i], mode);
      a[F.fecha] = fechaFor(next, value, fieldValue(a, mode, 'inicio'));
    } else if (key === 'fecha') {
      value = String(raw || '').trim();
      if (dayIndex(value) === null) return { ok: false, error: 'Fecha no válida.' };
      before = fieldValue(a, mode, 'fecha'); a[F.fecha] = value;
    } else if (key === 'notas') {
      value = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 300);
      before = fieldValue(a, mode, 'notas'); a[F.notas] = value;
    } else if (key === 'inicio' || key === 'fin' || key === 'call') {
      value = normHM(raw);
      if (value === null) return { ok: false, error: 'Hora no válida (usa HH:MM).' };
      if (key === 'inicio' && value === '') return { ok: false, error: 'La hora de inicio no puede quedar vacía.' };
      before = fieldValue(a, mode, key);
      if (key === 'inicio') {
        const jor = jornadaOf(state, state.artists[i], mode);
        if (!jor) return { ok: false, error: 'Elige primero la jornada.' };
        a[F.fecha] = fechaFor(next, jor, value);   // la jornada se mantiene; la fecha real se ajusta
      }
      a[F[key]] = value;
    } else return { ok: false, error: 'Campo no editable.' };
    // Un cambio de hora a mano es el nuevo horario de referencia: deja de contar como retraso acumulado
    if ((key === 'inicio' || key === 'fecha' || key === 'jornada') && a[F.base] !== undefined) delete a[F.base];

    return { ok: true, state: next, changed: JSON.stringify(state.artists[i]) !== JSON.stringify(a), value: value, before: before };
  }

  /** Marca (o quita) STANDBY en el hueco ANTES de este artista. Solo lo hace el regidor. */
  function setStandby(state, id, mode, on) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Artista no encontrado.' };
    const next = clone(state);
    const k = FIELDS[modeKey(mode)].standby;
    if (on) next.artists[i][k] = true; else delete next.artists[i][k];
    return { ok: true, state: next, changed: !!state.artists[i][k] !== !!on };
  }

  /** LED de la columna DELAY. Rojo (on) = no se mueve con los retrasos. No bloquea la edición. */
  function setFija(state, id, on) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Entrada no encontrada.' };
    const next = clone(state);
    if (on) next.artists[i].showtimeFija = true; else delete next.artists[i].showtimeFija;
    if (on) delete next.artists[i].showtimeLibre;
    return { ok: true, state: next, changed: isFija(state.artists[i]) !== !!on };
  }

  /** LED de una entrada concreta, por encima de su categoría: 'lock' (rojo) · 'free' (verde aunque su categoría esté bloqueada) · null (sigue a su categoría). */
  function setDelayFlag(state, id, flag) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Entrada no encontrada.' };
    const next = clone(state), a = next.artists[i];
    delete a.showtimeFija; delete a.showtimeLibre;
    if (flag === 'lock') a.showtimeFija = true; else if (flag === 'free') a.showtimeLibre = true;
    return { ok: true, state: next, changed: JSON.stringify(state.artists[i]) !== JSON.stringify(a) };
  }
  /** ¿Se mueve con los retrasos? Rojo individual > verde individual > categoría. */
  function movesWithDelay(b, cats) { return b.fija ? false : b.libre ? true : typeof cats === 'function' ? !!cats(b) : !!(cats && cats[b.kind]); }

  /** Changeover mínimo de una zona: el suyo o, si no tiene, el del evento. */
  function coMinFor(state, stageId) {
    const e = getEscenario(state, stageId);
    if (e && Number.isFinite(e.coMin) && e.coMin >= 0) return e.coMin;
    const v = Number(state && state.event && state.event.coMin);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CO_MIN;
  }

  // ── Festival, escenarios y bandas creados en Showtime ─────────────────
  /** Días de la jornada del evento (de fechaInicio a fechaFin, máx. 31). */
  function eventDays(state) {
    const ev = (state && state.event) || {};
    const a = dayIndex(ev.fechaInicio), b = dayIndex(ev.fechaFin);
    if (a === null) return [];
    const out = [];
    for (let i = a; i <= (b === null ? a : b) && out.length < 31; i++) out.push(isoOfDay(i));
    return out;
  }

  /** Comprueba y normaliza los datos generales del festival. */
  function checkEvent(ev) {
    const nombre = normName(ev.nombre);
    if (!nombre) return { ok: false, error: 'Pon un nombre al evento.' };
    const fi = String(ev.fechaInicio || '').trim(), ff = String(ev.fechaFin || ev.fechaInicio || '').trim();
    if (dayIndex(fi) === null) return { ok: false, error: 'Primera jornada no válida.' };
    if (dayIndex(ff) === null) return { ok: false, error: 'Última jornada no válida.' };
    if (dayIndex(ff) < dayIndex(fi)) return { ok: false, error: 'La última jornada es anterior a la primera.' };
    if (dayIndex(ff) - dayIndex(fi) > 30) return { ok: false, error: 'Máximo 31 jornadas.' };
    const cut = normHM(ev.dayCutoff == null ? DEFAULT_CUTOFF : ev.dayCutoff);
    if (!cut) return { ok: false, error: 'Hora de corte no válida (HH:MM).' };
    const cm = Math.round(Number(ev.callMins == null || ev.callMins === '' ? DEFAULT_CALL_MINS : ev.callMins));
    if (!(cm >= 1 && cm <= 180)) return { ok: false, error: 'Aviso CALL: entre 1 y 180 minutos.' };
    const co = Math.round(Number(ev.coMin == null || ev.coMin === '' ? DEFAULT_CO_MIN : ev.coMin));
    if (!(co >= 0 && co <= 180)) return { ok: false, error: 'Changeover mínimo: entre 0 y 180 minutos.' };
    return { ok: true, event: { nombre, fechaInicio: fi, fechaFin: ff, dayCutoff: cut, callMins: cm, coMin: co } };
  }

  function newFestival(ev) {
    const r = checkEvent(ev || {});
    if (!r.ok) return r;
    return { ok: true, state: { event: r.event, escenarios: [], artists: [], showtime: { creado: true } } };
  }

  function updateEvent(state, ev) {
    const r = checkEvent(Object.assign({}, state.event || {}, ev || {}));
    if (!r.ok) return r;
    const next = clone(state);
    next.event = Object.assign({}, next.event || {}, r.event);
    return { ok: true, state: next, changed: JSON.stringify(state.event) !== JSON.stringify(next.event) };
  }

  const STAGE_COLORS = ['#e94560', '#4fc3f7', '#1de9b6', '#ffb347', '#c77dff', '#84fab0', '#f77f00', '#a8edea'];

  function addStage(state, nombre, color) {
    const n = normName(nombre);
    if (!n) return { ok: false, error: 'Pon un nombre a la zona.' };
    const esc = (state.escenarios || []);
    if (esc.some(e => String(e.nombre || '').toLowerCase() === n.toLowerCase())) return { ok: false, error: 'Ya hay una zona con ese nombre.' };
    let k = esc.length + 1, id;
    do { id = 'esc' + k++; } while (esc.some(e => e.id === id));
    const next = clone(state);
    next.escenarios = next.escenarios || [];
    next.escenarios.push({ id, nombre: n, color: normColor(color) || STAGE_COLORS[esc.length % STAGE_COLORS.length] });
    return { ok: true, state: next, id };
  }

  function updateStage(state, id, patch) {
    const i = (state.escenarios || []).findIndex(e => e.id === id);
    if (i < 0) return { ok: false, error: 'Zona no encontrada.' };
    const next = clone(state), e = next.escenarios[i];
    if (patch.nombre !== undefined) {
      const n = normName(patch.nombre);
      if (!n) return { ok: false, error: 'El nombre no puede quedar vacío.' };
      if (next.escenarios.some((x, j) => j !== i && String(x.nombre || '').toLowerCase() === n.toLowerCase())) return { ok: false, error: 'Ya hay una zona con ese nombre.' };
      e.nombre = n;
    }
    if (patch.color !== undefined) {
      const c = normColor(patch.color);
      if (!c) return { ok: false, error: 'Color no válido.' };
      e.color = c;
    }
    if (patch.coMin !== undefined) {                    // '' = usar el del evento
      const raw = String(patch.coMin == null ? '' : patch.coMin).trim();
      if (raw === '') delete e.coMin;
      else {
        const v = Math.round(Number(raw));
        if (!/^\d+$/.test(raw) || v > 180) return { ok: false, error: 'Changeover mínimo: entre 0 y 180 minutos (vacío = el del evento).' };
        e.coMin = v;
      }
    }
    return { ok: true, state: next, changed: JSON.stringify(state.escenarios[i]) !== JSON.stringify(e) };
  }

  function moveStage(state, id, dir) {
    const i = (state.escenarios || []).findIndex(e => e.id === id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= state.escenarios.length) return { ok: false, error: 'No se puede mover.' };
    const next = clone(state);
    const t = next.escenarios[i]; next.escenarios[i] = next.escenarios[j]; next.escenarios[j] = t;
    return { ok: true, state: next, changed: true };
  }

  function stageUse(state, id) { return (state.artists || []).filter(a => a.escenarioId === id).length; }

  function removeStage(state, id) {
    const i = (state.escenarios || []).findIndex(e => e.id === id);
    if (i < 0) return { ok: false, error: 'Zona no encontrada.' };
    const n = stageUse(state, id);
    if (n) return { ok: false, error: 'Tiene ' + n + (n === 1 ? ' banda' : ' bandas') + '. Muévelas a otra zona o bórralas antes.' };
    const next = clone(state);
    next.escenarios.splice(i, 1);
    return { ok: true, state: next, changed: true };
  }

  /** Añade una banda con su horario en el modo indicado.
   *  d: { nombre, escenarioId, jornada, inicio, fin, duracion, call, notas, color }.
   *  Si se da duración (min), el fin se calcula: inicio + duración. Si se dan fin y duración, deben cuadrar. */
  function addArtist(state, mode, d) {
    const tipo = TIPOS.indexOf(d.tipo) >= 0 ? d.tipo : 'banda';
    if (tipo !== 'banda' || isAll(mode)) mode = (tipo === 'banda' && isSC(d.modo)) ? 'sc' : 'show';   // tareas e hitos: campos del show
    const nombre = normName(d.nombre);
    if (!nombre) return { ok: false, error: tipo === 'banda' ? 'Pon el nombre de la banda.' : 'Pon el nombre (p. ej. ' + (tipo === 'hito' ? 'Puertas' : 'Comida técnicos') + ').', field: 'nombre' };
    const esc = String(d.escenarioId || '');
    if (esc && !getEscenario(state, esc)) return { ok: false, error: 'Esa zona no existe.', field: 'escenario' };
    if (tipo === 'banda' && (state.escenarios || []).length && !esc) return { ok: false, error: 'Elige la zona.', field: 'escenario' };
    const jor = String(d.jornada || '').trim();
    if (dayIndex(jor) === null) return { ok: false, error: 'Elige la jornada.', field: 'jornada' };
    const ini = normHM(d.inicio);
    if (!ini) return { ok: false, error: ini === '' ? 'Pon la hora de inicio.' : 'Hora de inicio no válida (HH:MM).', field: 'inicio' };
    let fin = tipo === 'hito' ? '' : normHM(d.fin);
    if (fin === null) return { ok: false, error: 'Hora de fin no válida (HH:MM).', field: 'fin' };
    const durRaw = tipo === 'hito' ? '' : String(d.duracion == null ? '' : d.duracion).trim();
    if (durRaw !== '') {
      const dur = Math.round(Number(durRaw));
      if (!(dur >= 1 && dur <= 1440) || !/^\d+$/.test(durRaw)) return { ok: false, error: 'Duración en minutos (1–1440).', field: 'duracion' };
      const byDur = fmtHM(parseHM(ini) + dur);
      if (fin && fin !== byDur) return { ok: false, error: 'El fin (' + fin + ') no cuadra con la duración (' + byDur + '). Deja uno de los dos.', field: 'fin' };
      fin = byDur;
    }
    const call = tipo === 'banda' ? normHM(d.call) : '';
    if (call === null) return { ok: false, error: 'Hora de CALL no válida (HH:MM).', field: 'call' };
    const color = d.color ? normColor(d.color) : '';
    if (color === null) return { ok: false, error: 'Color no válido.', field: 'color' };

    const next = clone(state);
    next.artists = next.artists || [];
    const ids = next.artists.map(a => Number(a.id)).filter(Number.isFinite);
    const id = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
    const F = FIELDS[modeKey(mode)];
    const a = { id, nombre, escenarioId: esc };
    if (tipo !== 'banda') a.showtimeTipo = tipo;
    if (color) a.color = color;
    a[F.fecha] = fechaFor(next, jor, ini);
    a[F.inicio] = ini;
    a[F.fin] = fin;
    a[F.call] = call;
    a[F.notas] = String(d.notas == null ? '' : d.notas).replace(/\s+/g, ' ').trim().slice(0, 300);
    next.artists.push(a);
    return { ok: true, state: next, id };
  }

  /** Duplica una banda en otra jornada (mismo modo): copia nombre, escenario, color y notas.
   *  La hora la escribe el regidor. d: { jornada, inicio, fin, duracion, nombre? }. */
  function duplicateArtist(state, id, mode, d) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Artista no encontrado.' };
    const a = state.artists[i];
    return addArtist(state, mode, {
      nombre: d.nombre != null && String(d.nombre).trim() ? d.nombre : a.nombre,
      escenarioId: a.escenarioId || '', color: a.color || '', tipo: tipoOf(a),
      notas: fieldValue(a, mode, 'notas'),
      jornada: d.jornada, inicio: d.inicio, fin: d.fin, duracion: d.duracion, call: d.call
    });
  }

  /** ¿La jornada elegida ya ha terminado y hay otra después con bandas? → { done, next } (solo aviso). */
  function nextJornadaAfter(state, mode, day, now) {
    if (!state || !day || day === 'all') return null;
    const cur = buildBlocks(state, { mode: mode, day: day });
    if (!cur.length || !pickBlocks(cur, now, 1).ended) return null;
    const next = festivalDays(state, mode).filter(d => d > day)[0];
    return next ? { done: day, next: next } : null;
  }

  function removeArtist(state, id) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Artista no encontrado.' };
    const next = clone(state);
    const gone = next.artists.splice(i, 1)[0];
    return { ok: true, state: next, removed: gone };
  }

  // ── Regiduría en vivo (2c-B): horas reales, desfase Δ/A, cascada y márgenes ──
  const MARGIN_WARN = 15;   // min: aviso ámbar cuando un hito queda a menos de esto

  /** Registra la hora REAL de inicio ('i') o de fin ('f') de una banda en un modo. abs = minutos absolutos.
   *  Solo mide: no mueve nada. abs null = borrar. */
  function setReal(state, id, mode, which, abs) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Entrada no encontrada.' };
    if (tipoOf(state.artists[i]) === 'hito') return { ok: false, error: 'Un hito no tiene hora real.' };
    const next = clone(state), a = next.artists[i], k = FIELDS[modeKey(mode)].real;
    const r = Object.assign({}, a[k] || {});
    if (abs === null || abs === undefined) delete r[which]; else r[which] = Math.floor(abs);
    if (which === 'i' && (abs === null || abs === undefined)) delete r.f;
    if (r.i === undefined && r.f === undefined) delete a[k]; else a[k] = r;
    return { ok: true, state: next };
  }

  /** Jornada (día del evento) en la que cae un instante absoluto, con la hora de corte. */
  function jornadaOfAbs(state, abs) {
    const d = Math.floor(abs / 1440), t = abs - d * 1440;
    return isoOfDay(t < cutoffMins(state) ? d - 1 : d);
  }

  /** Desfase por zona. Para cada zona, la última banda con hora real registrada (en su jornada) da Δ.
   *  A = changeover programado hasta la siguiente banda − changeover mínimo de la zona.
   *  status: 'early' (Δ<0) · 'ontime' (Δ=0) · 'absorb' (0<Δ≤A) · 'overflow' (Δ>A; overflow = Δ−A).
   *  Comportamiento pasivo: si la siguiente ya debería haber empezado y no se ha registrado, se da por en hora. */
  function driftByZone(state, blocks, now) {
    const bands = blocks.filter(b => isBand(b) && b.psi !== null);
    const zones = {};
    bands.forEach(b => { const k = b.stageId || ''; (zones[k] = zones[k] || []).push(b); });
    const out = [];
    Object.keys(zones).forEach(k => {
      const list = zones[k].slice().sort((x, y) => x.psi - y.psi);
      let last = null;
      list.forEach(b => { if (b.delta !== null && (!last || b.psi > last.psi)) last = b; });
      if (!last) return;
      const next = list.find(b => b.psi > last.psi && b.jornada === last.jornada) || null;
      // Pasivo: si la anterior acabó a tiempo para que la siguiente empiece en hora y ya es su hora, se da por en hora
      if (next && next.ri === null && now !== undefined && now >= next.psi && last.rf !== null && last.rf <= next.psi) return;
      const coMin = coMinFor(state, k);
      const A = next ? Math.max(0, (next.psi - last.psf) - coMin) : Infinity;
      const d = last.delta;
      let status = d < 0 ? 'early' : d === 0 ? 'ontime' : d <= A ? 'absorb' : 'overflow';
      const esc = getEscenario(state, k);
      out.push({ zoneId: k, zone: esc ? esc.nombre : '', color: esc ? esc.color : '', block: last, next: next,
        delta: d, A: A === Infinity ? null : A, coMin: coMin, status: status, overflow: status === 'overflow' ? d - A : 0 });
    });
    return out;
  }

  /** Retraso por zona en la jornada de `now` (radiografía del directo):
   *  acc  = retraso ACUMULADO de lo que viene: el mayor corrimiento de las bandas aún sin empezar respecto a su hora
   *         original (cascadas y desbordes aplicados; no cuentan los cambios hechos a mano);
   *  live = desfase EN VIVO (> 0) de la última banda con hora real (lo que aún se está absorbiendo o desborda);
   *  early = adelanto en vivo; status/overflow como driftByZone. Zonas en el orden de la Live; «sin zona» al final. */
  function delayByZone(state, now) {
    if (!state) return [];
    const n = Math.floor(now), jor = jornadaOfAbs(state, n);
    const blocks = buildBlocks(state, { mode: 'all', day: jor });
    const drift = driftByZone(state, blocks, n);
    const groups = {};
    blocks.filter(b => isBand(b) && b.psi !== null).forEach(b => { const k = b.stageId || ''; (groups[k] = groups[k] || []).push(b); });
    const order = (state.escenarios || []).map(e => e.id).concat(['']);
    return order.filter(k => groups[k]).map(k => {
      // Lo que viene: bandas sin empezar que aún no han pasado. El acumulado es el mayor corrimiento entre ellas.
      const pend = groups[k].filter(b => b.ri === null && b.rf === null && blockEnd(b) > n);
      const acc = pend.reduce((m, b) => Math.max(m, b.base !== null ? b.psi - b.base : 0), 0);
      const dz = drift.find(z => z.zoneId === k);
      const esc = getEscenario(state, k);
      return { zoneId: k, zone: esc ? esc.nombre : '', color: esc ? esc.color : '', acc: acc,
        live: dz && dz.delta > 0 ? dz.delta : 0, early: dz && dz.delta < 0 ? -dz.delta : 0,
        status: dz ? dz.status : 'ontime', overflow: dz ? dz.overflow : 0, liveBlock: dz ? dz.block : null };
    });
  }

  /** Mueve en cascada `minutes` las entradas que cumplan TODO esto:
   *  - de la jornada de `fromAbs`, con inicio programado >= fromAbs (y > afterAbs si se da), sin hora real de inicio;
   *  - de las zonas `zone` ('all' = todas; un id; o lista de ids, '' = sin zona);
   *  - de una categoría autorizada en `cats` ({ show, sc, tarea, hito }, o función (bloque) → bool, p. ej. por zona);
   *  - con DELAY en verde (las de LED rojo no se mueven; NO hacen de tope: lo verde de después sí se mueve).
   *  Devuelve { state, moved:[...], kept:[...entradas rojas afectadas], clashes:[...] }. No toca el original. */
  function shiftEntries(state, opts) {
    const o = opts || {};
    const mins = Math.round(Number(o.minutes) || 0);
    const cats = o.cats || {};
    const jor = o.day || jornadaOfAbs(state, o.fromAbs);
    const all = buildBlocks(state, { mode: 'all', day: jor });
    // Zonas: 'all' (o vacío) = todas; un id; o una lista de ids ('' = entradas sin zona)
    const zs = Array.isArray(o.zone) ? o.zone : (o.zone === 'all' || !o.zone ? null : [o.zone]);
    const inScope = b => b.psi !== null && b.psi >= o.fromAbs && (o.afterAbs === undefined || b.psi > o.afterAbs) && b.ri === null &&
      (!zs || zs.indexOf(b.stageId || '') >= 0);
    const cand = all.filter(inScope);
    const move = cand.filter(b => movesWithDelay(b, cats));
    const kept = cand.filter(b => !movesWithDelay(b, cats));
    let next = clone(state);
    const moved = [];
    move.forEach(b => {
      const i = findArtistIndex(next, b.id); if (i < 0) return;
      const a = next.artists[i], F = FIELDS[b.kind === 'sc' ? 'sc' : 'show'];
      const ns = b.psi + mins;
      if (!Number.isFinite(a[F.base])) a[F.base] = b.psi;          // hora original, para el retraso acumulado
      a[F.fecha] = isoOfDay(Math.floor(ns / 1440));
      a[F.inicio] = fmtHM(ns);
      if (b.kind !== 'hito' && b.psf !== null) a[F.fin] = fmtHM(b.psf + mins);
      moved.push({ id: b.id, key: b.key, kind: b.kind, name: b.name, stage: b.stage, from: b.psi, to: ns, fromEnd: b.psf, toEnd: b.psf !== null ? b.psf + mins : null });
    });
    // Choques: lo movido invade una entrada en rojo (o un hito en rojo) de su zona que antes no invadía
    const after = buildBlocks(next, { mode: 'all', day: jor });
    const fixed = after.filter(b => b.psi !== null && !movesWithDelay(b, cats) && moved.every(m => m.key !== b.key));
    const clashes = [];
    moved.forEach(m => {
      const mb = after.find(b => b.key === m.key); if (!mb) return;
      fixed.forEach(f => {
        if (f.key === m.key || f.kind === 'tarea' || mb.kind === 'tarea') return;   // las tareas conviven: no hay choque
        if (f.stageId && mb.stageId && f.stageId !== mb.stageId) return;
        if (f.stageId && !mb.stageId) return;
        const ov = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
        const fEnd = f.kind === 'hito' ? f.psi : blockEnd(f);
        const mEnd = mb.kind === 'hito' ? mb.psi : blockEnd(mb);
        const nowOv = f.kind === 'hito' ? (mb.psi < f.psi && mEnd > f.psi) : mb.kind === 'hito' ? (f.psi < mb.psi && fEnd > mb.psi) : ov(mb.psi, mEnd, f.psi, fEnd);
        const was = f.kind === 'hito' ? (m.from < f.psi && (m.fromEnd !== null ? m.fromEnd : m.from) > f.psi) : mb.kind === 'hito' ? (f.psi < m.from && fEnd > m.from) : ov(m.from, m.fromEnd !== null ? m.fromEnd : m.from + DEFAULT_DURATION, f.psi, fEnd);
        if (nowOv && !was) clashes.push({ name: m.name, with: f.name, at: f.psi });
      });
    });
    return { ok: true, state: next, moved: moved, kept: kept.map(b => ({ name: b.name, kind: b.kind, stage: b.stage, at: b.psi })), clashes: clashes, jornada: jor };
  }

  /** Márgenes de los hitos: para cada hito, la última banda que debía acabar antes de él (de su zona; sin zona, de cualquiera),
   *  con su fin PROYECTADO (retraso acumulado incluido: lo que se ha registrado y el desborde que arrastra).
   *  level: 'ok' · 'tight' (margen < 15) · 'over' (rebasado). Solo avisa. */
  function hitoMargins(state, blocks, now) {
    const proj = projectBands(state, blocks, now);
    const out = [];
    blocks.filter(b => b.kind === 'hito' && b.psi !== null).forEach(h => {
      let best = null;
      blocks.forEach(b => {
        if (!isBand(b) || b.psf === null || b.jornada !== h.jornada) return;
        if (h.stageId && b.stageId !== h.stageId) return;
        if (b.psf > h.psi || b.psi >= h.psi) return;
        if (!best || b.psf > best.psf) best = b;
      });
      if (!best) return;
      const end = proj[best.key] ? proj[best.key].pe : blockEnd(best);
      const margin = Math.round(h.psi - end);
      out.push({ hito: h, band: best, projEnd: end, margin: margin, level: margin < 0 ? 'over' : margin < MARGIN_WARN ? 'tight' : 'ok' });
    });
    return out;
  }

  /** Proyección por zona: una banda futura no puede empezar antes de que acabe la anterior (con su retraso) + el changeover mínimo.
   *  Solo se arrastra retraso real registrado; sin registros, todo coincide con el horario. */
  function projectBands(state, blocks, now) {
    const res = {}, zones = {};
    blocks.filter(b => isBand(b) && b.psi !== null).forEach(b => { const k = (b.stageId || '') + '|' + b.jornada; (zones[k] = zones[k] || []).push(b); });
    Object.keys(zones).forEach(k => {
      const list = zones[k].sort((x, y) => x.psi - y.psi);
      let prevEnd = null, prevLate = false;
      const coMin = coMinFor(state, k.split('|')[0]);
      list.forEach(b => {
        const dur = b.psf !== null ? b.psf - b.psi : DEFAULT_DURATION;
        let ps;
        if (b.ri !== null) ps = b.ri;
        else if (prevLate && prevEnd + coMin > b.psi) ps = prevEnd + coMin;   // no pudo empezar antes de que acabara la anterior
        else ps = b.psi;
        const pe = b.rf !== null ? b.rf : ps + dur;
        res[b.key] = { ps: ps, pe: pe };
        prevLate = pe > (b.psf !== null ? b.psf : b.psi + dur);
        prevEnd = pe;
      });
    });
    return res;
  }

  // ── Cambios respecto a la última importación / exportación ────────────
  /** Campos cambiados por artista en un modo (incluye los comunes): { id: ['inicio', ...] }. Artistas nuevos no aparecen. */
  function modifiedFields(original, current, mode) {
    const out = {};
    if (!original || !current) return out;
    (current.artists || []).forEach(a => {
      const j = findArtistIndex(original, a.id);
      if (j < 0) return;
      const o = original.artists[j];
      const keys = SHARED_KEYS.concat(MODE_KEYS).filter(k => fieldValue(o, mode, k) !== fieldValue(a, mode, k));
      if (keys.length) out[a.id] = keys;
    });
    return out;
  }

  /** Ids de artistas que no estaban en la referencia. */
  function newArtistIds(original, current) {
    if (!original || !current) return [];
    return (current.artists || []).filter(a => findArtistIndex(original, a.id) < 0).map(a => a.id);
  }

  /** Resumen de cambios: { fields, added, removed, festival, total }. */
  function diffSummary(original, current) {
    const r = { fields: 0, added: 0, removed: 0, festival: 0, total: 0 };
    if (!original || !current) return r;
    (current.artists || []).forEach(a => {
      const j = findArtistIndex(original, a.id);
      if (j < 0) { r.added++; return; }
      const o = original.artists[j];
      SHARED_KEYS.forEach(k => { if (fieldValue(o, 'show', k) !== fieldValue(a, 'show', k)) r.fields++; });
      ['show', 'sc'].forEach(m => MODE_KEYS.forEach(k => { if (fieldValue(o, m, k) !== fieldValue(a, m, k)) r.fields++; }));
    });
    (original.artists || []).forEach(o => { if (findArtistIndex(current, o.id) < 0) r.removed++; });
    if (JSON.stringify(original.event || {}) !== JSON.stringify(current.event || {})) r.festival++;
    if (JSON.stringify(original.escenarios || []) !== JSON.stringify(current.escenarios || [])) r.festival++;
    r.total = r.fields + r.added + r.removed + r.festival;
    return r;
  }

  /** Número total de cambios (compatibilidad). */
  function countModified(original, current) { return diffSummary(original, current).total; }


  // ── Festival de demostración (formato Stage Master, relativo a «ahora») ──
  /** Solo se usa cuando alguien la pide (botón del Panel o live.html?demo=1). */
  function demoFestival(nowAbsMin) {
    const now = Math.floor(nowAbsMin);
    const at = off => { const a = now + off; return { f: isoOfDay(Math.floor(a / 1440)), h: fmtHM(a) }; };
    const A = (id, nombre, color, esc, ini, fin, notas, sc) => {
      const i = at(ini), f = at(fin);
      const o = { id, nombre, color, escenarioId: esc, fecha: i.f, inicio: i.h, fin: f.h, notas: notas || '' };
      if (sc) {
        const si = at(sc[0]), sf = at(sc[1]);
        Object.assign(o, { soundcheckFecha: si.f, soundcheckInicio: si.h, soundcheckFin: sf.h,
          soundcheckCall: sc[2] === null ? '' : at(sc[2]).h, soundcheckNotas: sc[3] || '' });
      }
      return o;
    };
    return {
      event: { nombre: 'Evento de demostración', dayCutoff: '06:00', callMins: 15 },
      escenarios: [{ id: 'esc1', nombre: 'Principal', color: '#e94560' }, { id: 'esc2', nombre: 'Carpa', color: '#4fc3f7' }],
      artists: [
        A(1, 'Los Ejemplos', '#e94560', 'esc1', -20, 5, 'Intro con playback', [-30, 10, -45, 'Backline propio']),
        A(2, 'Banda Demo', '#4fc3f7', 'esc2', -5, 35, '', [8, 40, null, '']),
        A(3, 'Cabeza de Cartel', '#1de9b6', 'esc1', 12, 100, 'Pirotecnia al final · confeti en el último tema', [35, 75, 5, 'Llegan con su técnico de monitores']),
        A(4, 'Grupo Invitado', '#ffb347', 'esc2', 50, 110, '', [80, 110, null, '']),
        A(5, 'DJ de Cierre', '#c77dff', 'esc2', 125, 245, 'Cierre hasta las 4', null)
      ]
    };
  }

  // ── Importar ──────────────────────────────────────────────────────────
  /** Comprueba un JSON de Stage Master. Devuelve { ok, state, errors[], warnings[] }. No modifica el original. */
  function validateProject(json) {
    const errors = [], warnings = [];
    let data = json;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return { ok: false, state: null, errors: ['El archivo no es JSON válido.'], warnings }; }
    }
    if (!data || typeof data !== 'object') return { ok: false, state: null, errors: ['Archivo vacío.'], warnings };
    if (!Array.isArray(data.artists)) errors.push('No hay lista de artistas (artists).');
    if (errors.length) return { ok: false, state: null, errors, warnings };

    const state = JSON.parse(JSON.stringify(data));
    state.event = state.event || {};
    state.escenarios = Array.isArray(state.escenarios) ? state.escenarios : [];

    if (state.event.dayCutoff && parseHM(state.event.dayCutoff) === null)
      warnings.push('Hora de corte no válida («' + state.event.dayCutoff + '»): se usa ' + DEFAULT_CUTOFF + '.');

    state.artists.forEach(a => {
      const n = a.nombre || '(sin nombre)';
      if ((a.inicio || a.fin) && dayIndex(a.fecha) === null)
        warnings.push(n + ': show sin fecha válida, no aparecerá en la línea de tiempo.');
      [['inicio', a.inicio], ['fin', a.fin], ['soundcheckInicio', a.soundcheckInicio],
       ['soundcheckFin', a.soundcheckFin], ['soundcheckCall', a.soundcheckCall]].forEach(([k, v]) => {
        if (v && parseHM(v) === null) warnings.push(n + ': hora no válida en ' + k + ' («' + v + '»).');
      });
      if (a.escenarioId && !getEscenario(state, a.escenarioId))
        warnings.push(n + ': escenario «' + a.escenarioId + '» no existe.');
    });
    return { ok: true, state, errors, warnings };
  }

  const API = {
    DEFAULT_CUTOFF, DEFAULT_CALL_MINS, DEFAULT_DURATION, DEFAULT_CO_MIN, isFija, setFija, coMinFor,
    MARGIN_WARN, isLibre, setDelayFlag, movesWithDelay, setReal, jornadaOfAbs, driftByZone, delayByZone, shiftEntries, hitoMargins, projectBands, MAX_NEXT, ARTIST_COLORS,
    pad2, parseHM, fmtHM, dayIndex, isoOfDay, shiftDate, toAbs, adjustEnd, nowAbs,
    cutoffMins, festivalDateOf, entersMode, festivalDays, TIPOS, tipoOf, isBand, isAll, entriesOf, tasksNow, hitosOf,
    getEscenario, artistColor, callAbsFor, buildBlocks,
    blockEnd, isPlaying, playingNow, nextPerStage, progress, changeoverBefore, changeoversNow, gapIdle, nextBandIn, callKey, callAt, callList,
    pickBlocks, stripLabel, stripLabels, validateProject,
    demoFestival, FIELDS, normHM, fieldValue, editArtist, setStandby, modifiedFields, countModified,
    fechaFor, jornadaOf, eventDays, checkEvent, newFestival, updateEvent, STAGE_COLORS,
    addStage, updateStage, moveStage, removeStage, stageUse, addArtist, removeArtist, duplicateArtist, nextJornadaAfter, newArtistIds, diffSummary
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
