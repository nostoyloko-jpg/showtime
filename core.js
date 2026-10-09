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
  const TIPO_COLORS = { tarea: '#6b7280', hito: '#9ca3af' };   // neutros: trabajo técnico (comidas, descargas, montajes) e hitos
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

  /** Color de una entrada. Los colores (arcoíris) son para las BANDAS (shows y soundchecks);
   *  tareas e hitos van en gris de trabajo técnico, salvo que se les elija un color a mano. */
  function artistColor(state, artist) {
    if (artist && artist.color) return artist.color;
    const t = tipoOf(artist);
    if (t !== 'banda') return TIPO_COLORS[t];
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
    show: { fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'showtimeCall', notas: 'notas', standby: 'showtimeStandby', real: 'showtimeReal', base: 'showtimeBase', alargar: 'showtimeAlargar' },
    sc:   { fecha: 'soundcheckFecha', inicio: 'soundcheckInicio', fin: 'soundcheckFin', call: 'soundcheckCall', notas: 'soundcheckNotas', standby: 'showtimeStandbySC', real: 'showtimeRealSC', base: 'showtimeBaseSC', alargar: 'showtimeAlargarSC' }
  };

  // ── De proyecto Stage Master a bloques ────────────────────────────────
  /**
   * opts: { mode: 'show' | 'sc' | 'all', day: 'all' | 'YYYY-MM-DD', now?: minutos absolutos (por defecto, ahora) }
   * Devuelve los bloques ordenados por inicio ESTIMADO (sin inicio, al final).
   * Cada bloque lleva kind: 'show' | 'sc' | 'tarea' | 'hito' y key = id:kind (única en la vista).
   *
   * Dos horarios por bloque (decisión 82):
   *   psi / psf  PREVISTO: lo escrito en la tabla (la escaleta). Los retrasos NO lo tocan.
   *   si  / sf   ESTIMADO / REAL: lo calcula la app (retrasos manuales, desbordes, ▶/■, «Alargar»). Nunca se escribe solo.
   * Más: pmi/pmf (previsto + retrasos manuales) · nf (fin nominal, sin el «sigue tocando») · live (alargando ahora)
   *      · dev (minutos de más de esta banda) · push (lo que empuja a esta banda el desborde de la anterior) · A (colchón)
   *      · clash (entrada fija pisada por la anterior) · alargar.
   */
  function rawBlocks(state) {
    return entriesOf(state, 'all').map(e => {
      const a = e.a, sc = e.sc, kind = e.kind, band = kind === 'show' || kind === 'sc', F = FIELDS[sc ? 'sc' : 'show'];
      const f = sc ? (a.soundcheckFecha || a.fecha) : a.fecha;
      const psi = toAbs(f, sc ? a.soundcheckInicio : a.inicio);
      const psf = kind === 'hito' ? null : adjustEnd(psi, toAbs(f, sc ? a.soundcheckFin : a.fin));
      // Horas REALES (opcionales: ▶ / ■). Sin ellas, todo va en hora.
      const real = kind !== 'hito' ? (a[F.real] || null) : null;
      const ri = real && Number.isFinite(real.i) ? real.i : null;
      const rf = real && Number.isFinite(real.f) ? real.f : null;
      const delta = rf !== null && psf !== null ? rf - psf : ri !== null && psi !== null ? ri - psi : null;
      const bs = a[F.base], base = Number.isFinite(bs) ? bs : null;
      const call = band ? ((sc ? a.soundcheckCall : a[FIELDS.show.call]) || '') : '';
      const esc = getEscenario(state, a.escenarioId);
      return {
        id: a.id, kind: kind, key: a.id + ':' + kind,
        si: psi, sf: psf, psi: psi, psf: psf, ri: ri, rf: rf, delta: delta, base: base,
        fija: isFija(a), libre: isLibre(a), alargar: band && !!a[F.alargar],
        name: a.nombre === null || a.nombre === undefined ? '' : String(a.nombre),   // un nombre numérico (p. ej. «1975») no puede tumbar la Live
        color: artistColor(state, a),
        notes: (sc ? a.soundcheckNotas : a.notas) || '',
        call: call,
        callAbs: call ? callAbsFor(psi, call, f) : null,
        stage: esc && esc.nombre !== null && esc.nombre !== undefined ? String(esc.nombre) : '',
        stageId: esc ? esc.id : '',
        stageColor: esc ? (esc.color || '') : '',
        standby: band && !!a[F.standby],   // hueco ANTES de este bloque marcado a mano como STANDBY
        jornada: festivalDateOf(state, a, sc)                 // día del festival (con la hora de corte)
      };
    });
  }

  function buildBlocks(state, opts) {
    const o = opts || {};
    const day = o.day || 'all';
    const all = projectAll(state, rawBlocks(state), Number.isFinite(o.now) ? o.now : nowAbs());
    let blocks = all.filter(b => isAll(o.mode) ? true : isSC(o.mode) ? b.kind === 'sc' : b.kind === 'show');
    if (day !== 'all') blocks = blocks.filter(b => b.jornada === day);
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
    return hasStart(b) && now >= b.si && (now < blockEnd(b) || (!!b.alargar && b.rf === null));   // con «Tiempo extra», sigue hasta ■ (aunque pase su hora)
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
    if (prev.kind === 'sc' && b.kind === 'show') return true;     // soundcheck → show, aunque sean bandas distintas (dec. 101)
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

  /** Clave del OK de CALL: zona + nombre + hora PREVISTA (un retraso no lo borra; cambiar la hora en la tabla, sí).
   *  Lleva la zona para que dos bandas con el mismo nombre a la misma hora en zonas distintas no compartan OK.
   *  Formato «idZona|nombre@minutos» (los minutos siempre al final: pruneCallDone los lee de ahí). */
  function callKey(b) { return (b.stageId || '') + '|' + b.name + '@' + (b.psi !== undefined && b.psi !== null ? b.psi : b.si); }
  /** Clave de antes (sin zona): los OK guardados con la versión anterior siguen valiendo. */
  function legacyCallKey(b) { return b.name + '@' + (b.psi !== undefined && b.psi !== null ? b.psi : b.si); }
  /** ¿Tiene ya OK de CALL? (clave nueva o la antigua). */
  function callIsDone(done, b) { const d = done instanceof Set ? done : new Set(done || []); return d.has(callKey(b)) || d.has(legacyCallKey(b)); }
  /** Nombre de la banda a partir de su clave de CALL (nueva o antigua). */
  function callKeyName(key) { key = String(key); const at = key.lastIndexOf('@'), bar = key.indexOf('|'); return key.slice(bar >= 0 && bar < at ? bar + 1 : 0, at >= 0 ? at : key.length); }

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
      return !callIsDone(d, b);
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

  /** Evento sin nombre (importar sin poner nombre): se guarda con este texto (el nombre es obligatorio) y se ENSEÑA
   *  traducido («Untitled event» en inglés) en el Dashboard, la Live, el mando, la impresión y el informe. */
  const UNNAMED = 'Evento sin nombre';
  function isUnnamed(nombre) { const n = String(nombre == null ? '' : nombre).trim(); return !n || n === UNNAMED; }
  /** Nombre para enseñar: el del evento o, sin nombre, «Evento sin nombre» pasado por `t` (el traductor de cada pantalla). */
  function eventName(state, t) { const n = state && state.event && state.event.nombre; return isUnnamed(n) ? (t ? t(UNNAMED) : UNNAMED) : String(n).trim(); }
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
    if (tipoOf(state.artists[i]) === 'hito') return { ok: false, error: 'Un marcador no tiene hora real.' };
    const next = clone(state), a = next.artists[i], k = FIELDS[modeKey(mode)].real;
    const r = Object.assign({}, a[k] || {});
    if (abs === null || abs === undefined) delete r[which]; else r[which] = Math.floor(abs);
    if (which === 'i' && (abs === null || abs === undefined)) delete r.f;
    if (r.i === undefined && r.f === undefined) delete a[k]; else a[k] = r;
    return { ok: true, state: next };
  }

  /** Jornada ACTIVA en un instante: la del reloj (jornadaOfAbs) salvo que, pasada la hora de corte, una banda de la jornada
   *  anterior siga sonando (empezó, no tiene ■ y no ha llegado a su fin estimado, o tiene Tiempo extra). Entonces manda la anterior:
   *  Confidence, la cinta, los desfases y el mando siguen con lo que está en el escenario, no con el reloj. */
  function activeJornada(state, now) {
    const n = Math.floor(now), j = jornadaOfAbs(state, n);
    if (!state) return j;
    const tod = ((n % 1440) + 1440) % 1440, sinceCut = ((tod - cutoffMins(state)) % 1440 + 1440) % 1440;
    if (sinceCut > 720) return j;                                   // lejos del corte: no hace falta mirar
    const prev = isoOfDay(dayIndex(j) - 1);
    const playing = buildBlocks(state, { mode: 'all', day: prev, now: n })
      .some(b => isBand(b) && b.rf === null && b.si !== null && b.si <= n && (b.alargar || (b.nf !== null && b.nf !== undefined ? n < b.nf : blockEnd(b) > n)));   // misma regla que el ■: sin Tiempo extra, se para a su hora
    return playing ? prev : j;
  }

  /** «Solo hoy» (dec. 105): copia del evento con SOLO lo de una jornada, para la emisión a los QR (privacidad de artistas en
   *  ciclos largos). Fuera: las entradas de otros días (y la parte de otro día de una banda: su prueba de ayer o su show de
   *  mañana) y los retrasos de otras jornadas. Zonas, ajustes y datos del evento se quedan. */
  function scopeToJornada(state, day) {
    if (!state || dayIndex(day) === null) return state;
    const next = clone(state);
    next.artists = (state.artists || []).map(a => {
      const sh = jornadaOf(state, a, 'show') === day, sc = tipoOf(a) === 'banda' && jornadaOf(state, a, 'sc') === day;
      if (!sh && !sc) return null;
      const r = clone(a);
      if (!sh) { r.soundcheckFecha = fieldValue(a, 'sc', 'fecha'); Object.keys(FIELDS.show).forEach(k => { delete r[FIELDS.show[k]]; }); }
      if (!sc) Object.keys(FIELDS.sc).forEach(k => { delete r[FIELDS.sc[k]]; });
      return r;
    }).filter(Boolean);
    if (Array.isArray(state.showtimeRetrasos)) next.showtimeRetrasos = state.showtimeRetrasos.filter(d => d && d.day === day);
    return next;
  }
  /** ¿Ha terminado la jornada? Tiene entradas con hora y ninguna suena ni está por llegar (marcadores incluidos: el curfew también cuenta). */
  function jornadaOver(state, day, now) {
    if (!state || dayIndex(day) === null) return false;
    const bl = buildBlocks(state, { mode: 'all', day: day, now: now }).filter(hasStart);
    return bl.length > 0 && !bl.some(b => isPlaying(b, now) || blockEnd(b) > now);
  }

  /** Jornada (día del evento) en la que cae un instante absoluto, con la hora de corte. */
  function jornadaOfAbs(state, abs) {
    const d = Math.floor(abs / 1440), t = abs - d * 1440;
    return isoOfDay(t < cutoffMins(state) ? d - 1 : d);
  }

  // ── Estimado / Real (decisión 82): retrasos manuales + desbordes, calculado en pantalla ──
  /** Órdenes de retraso manual guardadas en el evento: [{ id, at, minutes, zones: 'all'|[ids], day, from, blocked, extra, src }]. */
  function retrasosOf(state) {
    const l = state && Array.isArray(state.showtimeRetrasos) ? state.showtimeRetrasos : [];
    return l.filter(d => d && Number.isFinite(d.minutes) && d.minutes > 0 && Number.isFinite(d.from) && dayIndex(d.day) !== null && (d.zones === 'all' || Array.isArray(d.zones)));
  }
  /** Bloqueos de categorías ({ all: {show,sc,tarea,hito}, <zona>: {…} }): ¿está bloqueada esta categoría en esta zona? */
  function blockedIn(map, kind, zoneId) { const g = (map && map.all) || {}, z = (map && map[zoneId || '']) || {}; return !!(g[kind] || z[kind]); }
  /** ¿Se mueve con un retraso? LED rojo > LED verde > bloqueos extra de la orden > bloqueos del menú Retrasos. */
  function movesBy(b, map, extra) { if (b.fija) return false; if (b.libre) return true; if (extra && extra[b.kind]) return false; return !blockedIn(map, b.kind, b.stageId); }

  /** Minutos de retraso MANUAL de cada entrada (las órdenes, en el orden en que se dieron). */
  function manualOffsets(state, raw) {
    const M = new Map(); raw.forEach(b => M.set(b.key, 0));
    retrasosOf(state).forEach(d => {
      const zs = d.zones === 'all' ? null : d.zones;
      raw.forEach(b => {
        if (b.psi === null || b.jornada !== d.day) return;
        if (zs && zs.indexOf(b.stageId || '') < 0) return;
        if (b.psi + M.get(b.key) < d.from) return;                       // solo lo que empieza desde «desde»
        if (b.ri !== null && Number.isFinite(d.at) && b.ri <= d.at) return;  // lo que ya había empezado no se mueve
        if (!movesBy(b, d.blocked, d.extra)) return;
        M.set(b.key, M.get(b.key) + Math.round(d.minutes));
      });
    });
    return M;
  }

  /**
   * Proyección por zona y jornada (regla del colchón, decisión 48 + 82):
   *  - una banda empieza a su hora prevista + retraso manual + el retraso que arrastra la zona (lo fijo/bloqueado no se mueve);
   *  - ▶ manda (inicio real). Si empieza ANTES de lo estimado, el retraso de lo que viene baja (nunca por debajo de lo previsto);
   *  - sin «Alargar», la banda se para A SU HORA (parada automática), aunque saliera tarde: no retrasa nada. ■ antes = fin anticipado;
   *  - con «Alargar», lo que se pasa (en directo hasta ■) se absorbe primero en el colchón del cambio
   *    (A = cambio previsto − changeover mínimo) y solo lo que sobra (el DESBORDE) pasa solo a todo lo que viene de su zona;
   *    llevarlo a otras zonas lo decide el regidor en Retrasos (la ventana enseña los desbordes del día);
   *  - acabar antes (■) no adelanta a nadie.
   */
  function projectAll(state, raw, now) {
    const M = manualOffsets(state, raw);
    const blk = (state && state.showtimeBloqueos) || {};
    const n = Math.floor(now);
    raw.forEach(b => {
      const m = M.get(b.key) || 0;
      b.man = m; b.pmi = b.psi === null ? null : b.psi + m; b.pmf = b.psf === null ? null : b.psf + m;
      b.si = b.pmi; b.sf = b.pmf; b.nf = b.pmf; b.live = false; b.dev = 0; b.push = 0; b.pushFrom = ''; b.A = null; b.clash = false; b.clashWith = '';
    });
    const groups = {};
    raw.filter(b => b.psi !== null).forEach(b => { const k = (b.stageId || '') + '|' + b.jornada; (groups[k] = groups[k] || []).push(b); });
    const RANK = { show: 0, sc: 0, tarea: 1, hito: 2 };
    Object.keys(groups).forEach(k => {
      const list = groups[k].sort((x, y) => (x.pmi - y.pmi) || (RANK[x.kind] - RANK[y.kind]));
      const coMin = coMinFor(state, k.split('|')[0]);
      let prev = null;                                  // última banda: { pmf, lend, dev, cOut, si, name, alargar, key }
      list.forEach(e => {
        const mov = movesBy(e, blk, null);
        if (isBand(e)) {
          const dur = e.pmf !== null ? e.pmf - e.pmi : DEFAULT_DURATION;
          const A = prev ? Math.max(0, (e.pmi - prev.pmf) - coMin) : null;
          const push = prev ? Math.max(0, prev.dev - A) : 0;               // desborde: lo que la anterior se pasó por encima del colchón
          if (push) e.pushFrom = prev.name;
          const cin = prev ? prev.cOut + push : 0;
          const est = mov ? e.pmi + cin : e.pmi;
          if (!mov && prev && prev.lend > e.pmi) { e.clash = true; e.clashWith = prev.name; }
          const S = e.ri !== null ? e.ri : est;
          const cOut = S < est ? Math.max(0, S - e.pmi) : cin;   // empezar antes de lo estimado recupera retraso
          const ref = (mov ? e.pmi + cOut : e.pmi) + dur;          // fin de referencia de esta banda
          const hora = Math.max(S, est + dur);                     // su hora de acabar (parada automática sin Alargar)
          const nf = e.alargar ? (e.rf !== null ? e.rf : S + dur) : (e.rf !== null ? Math.min(e.rf, hora) : hora);
          const live = e.rf === null && e.alargar && n >= S && n >= S + dur;   // con Tiempo extra, pasada su hora: sigue hasta ■
          const lend = live ? Math.max(nf, n) : nf;
          e.si = S; e.nf = nf; e.sf = lend; e.live = live; e.A = A; e.push = push;   // push: lo que el desborde de la anterior pasa del colchón (aunque esta no se mueva)
          e.dev = Math.max(0, lend - ref);
          prev = { pmf: e.pmf !== null ? e.pmf : e.pmi + dur, lend, dev: e.dev, cOut, si: S, name: e.name, alargar: e.alargar, key: e.key };
        } else {
          // Tareas e hitos de la zona: les llega lo que sobra después de la banda anterior (sin changeover mínimo)
          const cin = prev ? prev.cOut + Math.max(0, prev.dev - Math.max(0, e.pmi - prev.pmf)) : 0;
          const est = mov ? e.pmi + cin : e.pmi;
          if (e.kind === 'hito' && !mov && prev && prev.si < e.pmi && prev.lend > e.pmi) { e.clash = true; e.clashWith = prev.name; }
          const S = e.kind !== 'hito' && e.ri !== null ? e.ri : est;
          e.si = S;
          if (e.kind === 'hito') { e.sf = null; e.nf = null; }
          else { const dur = e.pmf !== null ? e.pmf - e.pmi : DEFAULT_DURATION; e.nf = e.rf !== null ? e.rf : S + dur; e.sf = e.nf; }
        }
        if (e.callAbs !== null && e.callAbs !== undefined) e.callAbs += e.si - e.psi;   // el CALL escrito va con su banda
      });
    });
    return raw;
  }

  /** Retraso por zona en la jornada de `now` (radiografía del directo):
   *  acc  = retraso de lo que viene: el mayor «estimado − previsto» de las bandas que aún no han empezado;
   *  live = minutos de más de la última banda con ▶/■ o alargando (lo que se absorbe en el cambio o desborda);
   *  early = adelanto en vivo; status: 'ontime' · 'early' · 'absorb' (cabe en el colchón) · 'overflow' (empuja lo que viene).
   *  Zonas en el orden de la Live; «sin zona» al final. */
  function delayByZone(state, now) {
    if (!state) return [];
    const n = Math.floor(now), jor = activeJornada(state, n);
    const blocks = buildBlocks(state, { mode: 'all', day: jor, now: n });
    const groups = {};
    blocks.filter(b => isBand(b) && b.psi !== null).forEach(b => { const k = b.stageId || ''; (groups[k] = groups[k] || []).push(b); });
    const order = (state.escenarios || []).map(e => e.id).concat(['']);
    return order.filter(k => groups[k]).map(k => {
      const list = groups[k].slice().sort((x, y) => x.pmi - y.pmi);
      const pend = list.filter(b => b.ri === null && b.rf === null && !b.live && b.si > n);
      // + la que está sonando ahora con su retraso (sin ▶: se dio por empezada a su hora estimada). Así la última banda de la
      //   noche con desfase no sale como «EN HORA» solo porque ya no queda nada pendiente detrás.
      const cur = list.find(b => b.ri === null && b.rf === null && !b.live && b.si <= n && n < blockEnd(b) && b.si > b.psi);
      const acc = Math.max(pend.reduce((m, b) => Math.max(m, b.si - b.psi), 0), cur ? cur.si - cur.psi : 0);
      let lb = null;
      list.forEach(b => { if ((b.ri !== null || b.rf !== null || b.live) && b.si <= n) lb = b; });
      let next = lb ? list[list.indexOf(lb) + 1] || null : null;
      if (lb && next && next.si <= n) lb = null;        // la siguiente ya ha empezado: lo de la anterior ya no está «en vivo»
      if (!lb) next = null;
      const live = lb ? lb.dev : 0, overflow = next ? next.push : 0;
      const early = lb && !live && lb.delta !== null && lb.delta < 0 ? -lb.delta : 0;
      const esc = getEscenario(state, k);
      return { zoneId: k, zone: esc ? esc.nombre : '', color: esc ? esc.color : '', acc: acc, live: live, early: early,
        status: live > 0 ? (overflow > 0 ? 'overflow' : 'absorb') : early ? 'early' : 'ontime', overflow: overflow,
        liveBlock: lb, next: next, A: next ? next.A : null };
    });
  }

  /** Desfase en vivo por zona (para la Live): las zonas con algo «en vivo» (delta > 0 de más; < 0 adelanto). */
  function driftByZone(state, blocks, now) {
    return delayByZone(state, now).filter(z => z.liveBlock).map(z => ({ zoneId: z.zoneId, zone: z.zone, color: z.color, block: z.liveBlock, next: z.next,
      delta: z.live > 0 ? z.live : -z.early, A: z.A, status: z.status, overflow: z.overflow }));
  }

  /**
   * Retraso MANUAL (+5, +10…): se guarda como ORDEN en el evento; el previsto no se toca y el estimado se recalcula.
   * opts: { minutes, zone: 'all' | id | [ids] ('' = sin zona), fromAbs, day, blocked (bloqueos del menú Retrasos), extra (solo esta vez), at, src, now }
   * → { ok, state, moved:[{key,id,kind,name,stage,from,to}], kept:[…], clashes:[…], jornada, order }. No toca el original.
   */
  function addRetraso(state, opts) {
    const o = opts || {};
    const mins = Math.round(Number(o.minutes) || 0);
    const day = o.day || activeJornada(state, o.fromAbs);
    const zones = Array.isArray(o.zone) ? o.zone.slice() : (o.zone === 'all' || !o.zone ? 'all' : [o.zone]);
    const at = Number.isFinite(o.at) ? Math.floor(o.at) : Math.floor(nowAbs());
    const now = Number.isFinite(o.now) ? o.now : at;
    const extra = {}; ['show', 'sc', 'tarea', 'hito'].forEach(k => { extra[k] = !!(o.extra && o.extra[k]); });
    const order = { id: 'r' + at.toString(36) + Math.random().toString(36).slice(2, 6), at: at, minutes: mins, zones: zones, day: day,
      from: Math.floor(o.fromAbs), blocked: clone(o.blocked || {}), extra: extra, src: o.src === 'mando' ? 'mando' : 'panel' };
    const next = clone(state);
    next.showtimeRetrasos = retrasosOf(state).concat(mins > 0 ? [order] : []);
    const before = new Map(); buildBlocks(state, { mode: 'all', day: day, now: now }).forEach(b => before.set(b.key, b));
    const after = buildBlocks(next, { mode: 'all', day: day, now: now });
    const moved = [], kept = [], clashes = [];
    after.forEach(b => {
      const a = before.get(b.key); if (!a || b.psi === null) return;
      if (b.man > a.man) moved.push({ id: b.id, key: b.key, kind: b.kind, name: b.name, stage: b.stage, from: a.si, to: b.si });
      else {
        const inScope = (zones === 'all' || zones.indexOf(b.stageId || '') >= 0) && a.pmi >= order.from && !(a.ri !== null && a.ri <= at);
        if (inScope && !movesBy(b, order.blocked, extra)) kept.push({ name: b.name, kind: b.kind, stage: b.stage, at: b.si });
      }
      if (b.clash && !a.clash && b.kind !== 'tarea') clashes.push({ name: b.clashWith, with: b.name, at: b.si });
    });
    return { ok: true, state: next, moved: moved, kept: kept, clashes: clashes, jornada: day, order: order };
  }

  /** «Alargar»: la banda puede gastar el colchón del cambio; hasta ■, cada minuto de más cuenta en el estimado. */
  function setAlargar(state, id, mode, on) {
    const i = findArtistIndex(state, id);
    if (i < 0) return { ok: false, error: 'Entrada no encontrada.' };
    if (tipoOf(state.artists[i]) !== 'banda') return { ok: false, error: 'Solo los shows y soundchecks tienen Tiempo extra.' };
    const next = clone(state), k = FIELDS[modeKey(mode)].alargar;
    if (on) next.artists[i][k] = true; else delete next.artists[i][k];
    return { ok: true, state: next, changed: !!state.artists[i][k] !== !!on };
  }

  /** Márgenes de los hitos: para cada hito, la última banda que debía acabar antes de él (de su zona; sin zona, de cualquiera),
   *  con su fin ESTIMADO. level: 'ok' · 'tight' (margen < 15) · 'over' (rebasado). Solo avisa. */
  function hitoMargins(state, blocks, now) {
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
      const end = blockEnd(best);
      const margin = Math.round(h.si - end);
      out.push({ hito: h, band: best, projEnd: end, margin: margin, level: margin < 0 ? 'over' : margin < MARGIN_WARN ? 'tight' : 'ok' });
    });
    return out;
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
    if (JSON.stringify(original.showtimeRetrasos || []) !== JSON.stringify(current.showtimeRetrasos || [])) r.festival++;
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
    MARGIN_WARN, UNNAMED, isUnnamed, eventName, scopeToJornada, jornadaOver, isLibre, setDelayFlag, movesWithDelay, setReal, jornadaOfAbs, activeJornada, legacyCallKey, callIsDone, callKeyName, driftByZone, delayByZone, addRetraso, retrasosOf, blockedIn, movesBy, setAlargar, hitoMargins, MAX_NEXT, ARTIST_COLORS, TIPO_COLORS,
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
