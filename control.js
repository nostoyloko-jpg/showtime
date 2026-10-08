/* Showtime — control.js · Panel de Control
 * El regidor crea y manda en los horarios: festival, escenarios y bandas se crean aquí.
 * REGLA DE ORO: nada se cambia solo. Cada cambio de datos lo hace el regidor con una acción explícita.
 * Las reglas de tiempo salen de core.js; el estado compartido y la sincronización, de datos.js.
 */
(function () {
  'use strict';
  const C = window.ShowtimeCore;
  const Dt = window.ShowtimeDatos;
  const M = window.ShowtimeMando;
  const $ = id => document.getElementById(id);

  // ── Estado (declarado antes de usarse) ───────────────────────────────
  let FEST = null, ORIG = null, CONFIG = Dt.getConfig();
  let BLOCKS = [], ALL_MODE = [], TAREAS = [], DAY_MISSING = '';
  const UNDO = [];                 // festivales anteriores (JSON), para «Deshacer»
  const UNDO_MAX = 30;
  const LIVES = new Map();            // ventanas Live abiertas desde aquí: nombre → ventana (una por vista; Confidence, una por zona)
  const Vs = window.ShowtimeVistas;
  let MSG_TO = null;                  // destino de los mensajes flash: null = todas las pantallas; si no, lista de vistas
  let MSG_ZONES = null;               // zonas de las pantallas Confidence que lo reciben: null = todas
  function zoneLabel(id) { const z = FEST && C.getEscenario(FEST, id); return z ? z.nombre : 'Sin zona'; }
  const SPLASH_MS = 2500;   // pantalla de inicio (se va sola; clic o Esc la cierran antes)
  function liveOpen(name) { const w = name ? LIVES.get(name) : null; if (name) return !!(w && !w.closed); return Array.from(LIVES.values()).some(x => x && !x.closed); }
  let pendingRender = false;       // si llegan datos mientras se edita una casilla, se pinta al salir
  const KEY_LABEL = { nombre: 'nombre', escenario: 'zona', color: 'color', tipo: 'tipo', jornada: 'jornada', fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'CALL', notas: 'notas' };
  const TIPO_TXT = { banda: 'banda', tarea: 'tarea', hito: 'hito' };
  // Vistas: Jornada completa (todo) · Shows · Soundchecks
  const VIEW = { all: { title: 'Jornada completa', short: 'Todo', what: 'entradas' }, show: { title: 'Shows', what: 'shows' }, sc: { title: 'Soundchecks', what: 'soundchecks' } };

  // ── Utilidades ────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function safeColor(c, d) { return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(String(c || '').trim()) ? String(c).trim() : d; }
  function hex6(c, d) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : d; }
  const pad2 = C.pad2;
  function fmtDay(iso) {
    const i = C.dayIndex(iso);
    if (i === null) return iso || '—';
    return new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function fmtCountdown(mins) {
    const s = Math.max(0, Math.ceil(mins * 60));
    if (s >= 3600) { const m = Math.floor(s / 60); return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm'; }
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  let toastT = 0;
  /** Aviso efímero abajo: entra y se va solo, con un fundido suave. ms: cuánto se ve (por defecto 2,6 s; los errores 4,5 s). */
  let toastOut = 0;
  function toast(msg, bad, ms) {
    const t = $('toast'), d = ms || (bad ? 4500 : 2600);
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); clearTimeout(toastOut);
    toastOut = setTimeout(() => t.classList.add('out'), Math.max(0, d - 300));
    toastT = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, d);
  }
  function modeName(m) { return (m || CONFIG.mode) === 'sc' ? 'soundcheck' : 'show'; }
  function viewOf(m) { return VIEW[m || CONFIG.mode] || VIEW.show; }
  function viewLabel() { return (viewOf().short || viewOf().title) + (focusOn() ? ' · Foco' : ''); }
  // ── Modo foco (para operar en directo a 1-2 m): menos columnas, filas y letra más grandes. Preferencia de este equipo ──
  const FOCUS_KEY = 'showtime.panel.focus';
  function focusOn() { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch (e) { return false; } }
  function applyFocus() {
    const on = focusOn(), b = document.getElementById('btn-focus');
    document.body.classList.toggle('focus', on);
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.title = (on ? 'Modo foco ACTIVO' : 'Modo foco') + ': solo lo de directo, filas y letra más grandes. Clic: activar / desactivar (⇧⌘F)'; }
    const l = document.getElementById('view-lbl'); if (l) l.textContent = viewLabel();
  }
  function setFocus(on) { try { if (on) localStorage.setItem(FOCUS_KEY, '1'); else localStorage.removeItem(FOCUS_KEY); } catch (e) {} applyFocus(); }
  /** Modo de los campos de una fila (show o soundcheck), según su bloque. */
  function rowModeOf(b) { return b && b.kind === 'sc' ? 'sc' : CONFIG.mode === 'sc' && !b ? 'sc' : 'show'; }

  // ── Modal propio (sin alert/confirm del navegador) ───────────────────
  // actions: [{ label, kind, run, keep }] — keep:true no cierra (p. ej. si el formulario tiene errores: run devuelve false).
  function modal(title, html, actions, opts) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    $('modal').querySelector('.modal-box').classList.toggle('wide', !!(opts && opts.wide));
    const box = $('modal-actions');
    box.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn' + (a.kind ? ' ' + a.kind : '');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        const res = a.run ? a.run() : undefined;
        if (res !== false) closeModal();
      });
      box.appendChild(b);
    });
    $('modal').hidden = false;
    const first = $('modal-body').querySelector('input,select');
    const prim = box.querySelector('.primary') || box.lastChild;
    if (first) first.focus(); else if (prim) prim.focus();
  }
  function closeModal() { $('modal').hidden = true; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // ── Carga de estado y cálculo ────────────────────────────────────────
  function loadState() {
    FEST = Dt.getFestival();
    ORIG = Dt.getOriginal();
    CONFIG = Dt.getConfig();
    if (FEST && !Dt.READONLY) { const f2 = M.withBlk(FEST, CONFIG); if (f2 !== FEST) { FEST = f2; Dt.setFestival(FEST); } }
    compute();
  }

  function compute() {
    if (!FEST) { BLOCKS = []; ALL_MODE = []; TAREAS = []; DAY_MISSING = ''; MARGINS = []; return; }
    const day = CONFIG.day || 'all';
    DAY_MISSING = (day !== 'all' && C.festivalDays(FEST, CONFIG.mode).indexOf(day) < 0) ? day : '';
    BLOCKS = DAY_MISSING ? [] : C.buildBlocks(FEST, { mode: CONFIG.mode, day: day });
    ALL_MODE = C.buildBlocks(FEST, { mode: CONFIG.mode, day: 'all' });
    const allB = C.buildBlocks(FEST, { mode: 'all', day: 'all' });
    TAREAS = allB.filter(b => b.kind === 'tarea');   // para «Sin actividad» aunque la vista no pinte tareas (decisión 76)
    MARGINS = C.hitoMargins(FEST, allB, Math.floor(C.nowAbs()));
  }

  /** Aplica un festival nuevo hecho por el regidor: guarda deshacer, sincroniza, lo apunta en el log y pinta.
   *  lctx (log): { src: 'panel'|'mando', t, ev: [incidencias de la orden], noTimes, skip } */
  function commitFestival(next0, msg, lctx) {
    const prev = FEST, next = M.withBlk(next0, CONFIG);   // los bloqueos del menú Retrasos viajan con el evento (el desborde los respeta)
    UNDO.push({ s: JSON.stringify(FEST), m: undoTxt(msg) });
    if (UNDO.length > UNDO_MAX) UNDO.shift();
    FEST = next;
    Dt.setFestival(FEST);
    logCommit(prev, next, lctx);
    compute();
    renderAll();
    if (msg) toast(msg);
  }
  /** Descripción del paso para «Deshecho: …» en el log. */
  function undoTxt(msg) { return String(msg || '').replace(/^Desde el mando del Stage Manager · /, '').replace(/ \(Deshacer para recuperarla\)$/, ''); }

  function undo() {
    if (!UNDO.length) return;
    const u = UNDO.pop();
    FEST = M.withBlk(JSON.parse(u.s), CONFIG);
    Dt.setFestival(FEST);
    if (u.m) logEvent('undo', u.m);      // el log nunca borra: apunta lo que se deshizo («Deshecho: …»)
    compute(); renderAll();
    toast('Deshecho');
  }

  // ── Event Log (caja negra): solo añade. Vive en este navegador y viaja dentro de «Exportar JSON». ──
  const Lg = window.ShowtimeLog;
  const LOG_KEY = 'showtime.log', LOG_PREV = 'showtime.log.prev';
  let LOG = null, LOG_WARN = false;
  function logLoad() {
    try { LOG = Lg ? Lg.norm(JSON.parse(localStorage.getItem(LOG_KEY) || 'null')) : null; } catch (e) { LOG = null; }
    if (!LOG && Lg && FEST) LOG = Lg.empty(FEST);
  }
  function logSave() {
    if (!LOG) return;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(LOG)); LOG_WARN = false; }
    catch (e) { if (!LOG_WARN) { LOG_WARN = true; toast('No se puede guardar el log del evento: el almacenamiento del navegador está lleno. Exporta el JSON.', true); } }
  }
  function logSet(next) { if (next && next !== LOG) { LOG = next; logSave(); } }
  function logNow() { return Math.floor(C.nowAbs()); }
  /** El log anterior se guarda como copia antes de empezar otro (abrir o crear otro evento). */
  function logArchive() { if (LOG && LOG.entries.length) { try { localStorage.setItem(LOG_PREV, JSON.stringify(LOG)); } catch (e) {} } }
  /** Cambio del festival (lo llama commitFestival): foto de la jornada si falta, lo que cambió y la orden. */
  function logCommit(prev, next, ctx) {
    if (!Lg || !(prev || next)) return;
    if (!LOG) LOG = Lg.empty(next || prev);
    let lg = Lg.commit(LOG, prev, next, Object.assign({ src: 'panel', t: logNow() }, ctx || {}));
    const k = Lg.eventKey(next || prev);
    if (lg.ev !== k) lg = Object.assign({}, lg, { ev: k });           // el log sigue al evento aunque se renombre
    logSet(lg);
  }
  /** Incidencia que no cambia el horario: mensajes, el tiempo, Deshacer. */
  function logEvent(type, text, ctx) {
    if (!Lg || !FEST) return;
    if (!LOG) LOG = Lg.empty(FEST);
    const c = Object.assign({ src: 'panel', t: logNow() }, ctx || {});
    logSet(Lg.record(Lg.ensureFoto(LOG, FEST, c.t), [{ type, text, jors: c.jors, amber: c.amber }], c, FEST));
  }
  /** Foto del horario al empezar la jornada (o la primera vez que el Dashboard la ve). */
  function logFoto() { if (!Lg || !FEST) return; if (!LOG) LOG = Lg.empty(FEST); logSet(Lg.ensureFoto(LOG, FEST, logNow())); }
  /** Incidencia del desborde que empuja un ▶ / ■. */
  function pushedEv(r) {
    const p = r && r.pushed;
    if (!p) return [];
    return [{ type: 'delay', amber: true, jors: [p.jornada], text: 'Desborde de «' + p.who + '»: +' + p.minutes + ' min en ' + p.zone + (p.moved ? ' · ' + nEnt(p.moved, 'movida') : ' · nada que mover (bloqueado o en rojo)') + (p.kept ? ' · ' + keptTxt(p.kept) : '') }];
  }

  /** Jornadas que se ofrecen: las del festival (primera → última) y las que ya tengan bandas. */
  function jornadaOptions() {
    if (!FEST) return [];
    const set = new Set(C.eventDays(FEST));
    C.festivalDays(FEST, 'show').forEach(d => set.add(d));
    C.festivalDays(FEST, 'sc').forEach(d => set.add(d));
    return Array.from(set).sort();
  }

  // ── Pintado ──────────────────────────────────────────────────────────
  function renderAll() {
    renderLiveMenu();
    if ($('msg-zl')) renderMsgZones();
    const has = !!FEST;
    $('main').hidden = !has;
    $('empty').hidden = has;
    $('btn-export').disabled = !has;
    $('btn-undo').disabled = !UNDO.length;
    $('btn-undo').querySelector('span').textContent = UNDO.length ? 'Deshacer (' + UNDO.length + ')' : 'Deshacer';
    $('btn-undo').title = UNDO.length ? 'Deshacer (' + UNDO.length + '): ' + UNDO[UNDO.length - 1].m + ' (⌘Z)' : 'Nada que deshacer';
    $('fest-name').textContent = has ? ((FEST.event && FEST.event.nombre) || 'Evento sin nombre') : 'Sin evento';
    const d = has && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    $('mods').hidden = !d.total;
    $('mods').textContent = d.total + ' sin exportar';
    $('mods').title = d.total ? [d.added && d.added + ' banda(s) nueva(s)', d.removed && d.removed + ' borrada(s)', d.fields && d.fields + ' casilla(s) cambiada(s)', d.festival && 'datos del evento o zonas'].filter(Boolean).join(' · ') : '';
    renderTools();
    renderWarn();
    if (!$('cfg').hidden) renderConfig();
    // Sin entradas: en vez de la tabla vacía, la tarjeta de «Importar horario en 1 segundo»
    const empty = has && !(FEST.artists || []).length;
    $('list-empty').hidden = !empty;
    document.querySelector('.tblwrap').hidden = empty;
    if (has) { renderTable(); renderAddRow(); tick(); }
  }

  function renderTools() {
    document.querySelectorAll('#m-view [data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === CONFIG.mode); b.setAttribute('aria-checked', String(b.dataset.mode === CONFIG.mode)); });
    $('view-lbl').textContent = viewLabel();
    $('day-lbl').textContent = CONFIG.day === 'all' ? 'Todos' : fmtDay(CONFIG.day);
    renderDelayCats();
    // Pestañas de jornadas: «Todas» + de la primera a la última del festival (las vacías, atenuadas)
    const days = jornadaOptions();
    const withData = FEST ? C.festivalDays(FEST, CONFIG.mode) : [];
    const tab = (v, label, cls, title) => '<button role="tab" data-day="' + esc(v) + '" class="' + cls + (CONFIG.day === v ? ' on' : '') + '" aria-selected="' + (CONFIG.day === v) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
    let html = FEST ? tab('all', 'Todas', '', 'Todas las jornadas') : '';
    html += days.map(d => tab(d, fmtDay(d), withData.indexOf(d) < 0 ? 'vacia' : '', withData.indexOf(d) < 0 ? 'Sin ' + viewOf().what + ' todavía' : '')).join('');
    if (FEST && CONFIG.day !== 'all' && days.indexOf(CONFIG.day) < 0) html += tab(CONFIG.day, fmtDay(CONFIG.day), 'falta', 'Fuera de las jornadas del evento');
    $('days').innerHTML = html;
  }

  function renderWarn() {
    const w = $('warn');
    let msg = '';
    if (FEST && !(FEST.escenarios || []).length) msg = 'Este evento no tiene zonas. Créalas en Configuración › Zonas o desde la columna Zona de cualquier fila.';
    else if (DAY_MISSING) msg = 'El ' + fmtDay(DAY_MISSING) + ' todavía no tiene ' + viewOf().what + '. La Pantalla Live lo está avisando.';
    w.textContent = msg; w.hidden = !msg;
  }

  /** Zona tecleada → { state, id, created }. Vacío = sin zona. Si no existe, se crea (explícito: el regidor la ha escrito). */
  function resolveZone(state, name) {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n) return { ok: true, state: state, id: '', created: false };
    const hit = (state.escenarios || []).find(e => String(e.nombre).toLowerCase() === n.toLowerCase());
    if (hit) return { ok: true, state: state, id: hit.id, created: false };
    const r = C.addStage(state, n);
    if (!r.ok) return r;
    return { ok: true, state: r.state, id: r.id, created: true, name: n };
  }
  function zonesDatalist() {
    const h = (FEST && FEST.escenarios || []).map(e => '<option value="' + esc(e.nombre) + '"></option>').join('');
    if ($('zones-dl').innerHTML !== h) $('zones-dl').innerHTML = h;
  }

  function jornadaSelect(value, attrs) {
    const opts = jornadaOptions();
    if (value && opts.indexOf(value) < 0) opts.push(value);
    return '<select ' + attrs + '>' + (value ? '' : '<option value="" selected>— elige —</option>') +
      opts.sort().map(d => '<option value="' + d + '"' + (d === value ? ' selected' : '') + '>' + esc(fmtDay(d)) + '</option>').join('') + '</select>';
  }

  /** Selector de tipo de una fila: en una banda, la opción «banda» se llama Show o Soundcheck según la fila. */
  function tipoSelect(a, mode, attrs) {
    const t = C.tipoOf(a);
    const lbl = { banda: mode === 'sc' ? 'Soundcheck' : 'Show', tarea: 'Tarea', hito: 'Hito' };
    return '<select ' + attrs + ' class="tipo tipo-' + (t === 'banda' ? mode : t) + '">' + C.TIPOS.map(x => '<option value="' + x + '"' + (x === t ? ' selected' : '') + '>' + lbl[x] + '</option>').join('') + '</select>';
  }

  /** «1 entrada movida» / «3 entradas movidas». */
  function nEnt(n, adj) { return n + (n === 1 ? ' entrada ' + adj : ' entradas ' + adj + 's'); }
  function keptTxt(n) { return n === 1 ? '1 en rojo no se mueve' : n + ' en rojo no se mueven'; }
  // ── Regiduría en vivo: horas reales, Empezar / Terminar (opcionales) ──
  let MARGINS = [];
  /** Columna ESTIMADO / REAL (decisión 82): la calcula la app. Ámbar = distinto de lo previsto · rojo = entrada fija pisada. */
  function estCell(b) {
    if (!b || b.si === null) return '<td class="est"><span class="dash">—</span></td>';
    const hito = b.kind === 'hito';
    const dig = (x, p) => '<b class="' + (b.clash ? 'clash' : x !== p ? 'chg' : '') + '">' + C.fmtHM(x) + '</b>';
    const d = b.si - b.psi;
    let sub = '';
    if (b.clash) sub = '<small class="clash">pisada por ' + esc(b.clashWith) + '</small>';
    else if (b.live) sub = '<small class="chg">tiempo extra · +' + Math.round(b.sf - b.nf) + ' min</small>';
    else if (b.ri !== null || b.rf !== null) sub = '<small class="' + (b.delta ? 'chg' : '') + '">real' + (b.rf !== null && b.psf !== null && b.rf < b.psf ? ' · acaba ' + (b.psf - b.rf) + ' min antes' : '') + '</small>';
    else if (d) sub = '<small class="chg">' + (d > 0 ? '+' : '−') + Math.abs(d) + ' min · estimado</small>';
    const same = !b.clash && !b.live && b.ri === null && b.rf === null && !d && (hito || b.sf === b.psf);
    const tip = (b.ri !== null ? 'Inicio real ' + C.fmtHM(b.ri) + '. ' : '') + (b.rf !== null ? 'Fin real ' + C.fmtHM(b.rf) + '. ' : '') +
      (b.man ? 'Retraso manual +' + b.man + ' min. ' : '') + (b.push ? 'Desborde de la anterior: +' + b.push + ' min. ' : '') +
      (b.alargar ? 'TIEMPO EXTRA activado: puede gastar el colchón del cambio. ' : '') + (b.clash ? 'Está fija (DELAY rojo o bloqueada) y la anterior la pisa. ' : '') +
      'Previsto ' + C.fmtHM(b.psi) + (b.psf !== null ? ' → ' + C.fmtHM(b.psf) : '') + '.' + (!hito && C.isBand(b) ? ' Doble clic: corregir la hora real de inicio.' : '');
    return '<td class="est' + (same ? ' same' : '') + (b.live ? ' live' : '') + '" title="' + esc(tip) + '"><span class="estt">' + dig(b.si, b.psi) +
      (hito || b.sf === null ? '' : '<span class="arr">→</span>' + dig(b.sf, b.psf)) + '</span>' + sub + '</td>';
  }
  /** Botón TIEMPO EXTRA (antes «Alargar»): la banda puede pasarse de su hora; gasta el colchón y, pasado, retrasa lo que viene hasta ■. */
  /** Minutos que lleva de tiempo extra (con Tiempo extra activado y pasada su hora), o null. */
  function xtraOver(b, now) { return b && b.alargar && b.rf === null && b.nf !== null && now >= b.nf ? Math.max(0, Math.floor(now - b.nf)) : null; }
  function xtraBtn(b, compact) {
    return '<button class="xtrabtn' + (compact ? ' sq' : '') + (b.alargar ? ' on' : '') + '" data-act="stretch" data-key="' + esc(b.key) + '" data-on="' + (b.alargar ? '0' : '1') + '" title="' +
      (b.alargar ? 'TIEMPO EXTRA activado: puede pasarse de su hora; gasta el colchón del cambio y, pasado, retrasa lo que viene de su zona hasta que pulses ■. Clic: desactivar'
        : 'Tiempo extra: si va a pasarse de su hora, actívalo. Gasta el colchón del cambio y, pasado, retrasa lo que viene de su zona hasta que pulses ■. Sin activarlo, se para a su hora') +
      '"><svg class="ic"><use href="#i-stretch"/></svg>' + (compact ? '' : b.alargar ? 'Tiempo extra ✓' : 'Tiempo extra') + '</button>';
  }
  /** ▶ si no tiene inicio real. ■ si ya empezó (con ▶ o, sin ▶, porque ya es su hora: modo pasivo). Tiempo extra hasta ■. */
  function liveBtns(b, band) {
    if (!b || !band || b.rf !== null) return '';
    const stop = '<button class="delbtn livebtn on' + (b.ri === null ? ' pasv' : '') + '" data-act="stop" title="' + (b.ri === null ? 'Terminar ahora: fin real = ahora; el inicio se da por a su hora (' + C.fmtHM(b.si) + ')' : 'Terminar ahora: registra la hora real de fin') + '"><svg class="ic"><use href="#i-stop"/></svg></button>';
    const alg = xtraBtn(b, true);
    if (b.ri === null) return '<button class="delbtn livebtn" data-act="start" title="Empezar ahora: registra la hora real de inicio (opcional; sin pulsar, se da por a su hora)"><svg class="ic"><use href="#i-play"/></svg></button>' + stop + alg;
    return stop + alg;
  }
  function marginChip(m) {
    if (m.level === 'ok') return '<span class="mchip ok" title="Margen hasta el hito con el retraso actual (' + esc(m.band.name) + ' acaba ' + C.fmtHM(m.projEnd) + ')">Margen ' + m.margin + '′</span>';
    if (m.level === 'tight') return '<span class="mchip tight" title="' + esc(m.band.name) + ' acaba ' + C.fmtHM(m.projEnd) + '"><svg class="ic"><use href="#i-alert"/></svg>Margen ' + m.margin + '′</span>';
    return '<span class="mchip over" title="' + esc(m.band.name) + ' acaba ' + C.fmtHM(m.projEnd) + '"><svg class="ic"><use href="#i-alert"/></svg>Rebasado +' + (-m.margin) + '′</span>';
  }

  /** Tiempo extra desde el Panel. Pasada su hora (bis), pide confirmación con lo que va a pasar y queda en el log como BIS. */
  function applyStretch(key, on) {
    const r = M.stretchPlan(FEST, key, on, logNow());
    if (!r.ok) { toast(r.error, true); return; }
    const go = p => commitFestival(p.state, p.msg, { noTimes: true, ev: [{ type: 'buffer', amber: p.late !== null && p.late !== undefined, text: p.msg }] });
    if (r.late === null || r.late === undefined) { go(r); return; }
    modal('Rescatar el bis', '<p>' + esc(r.msg) + '</p>', [
      { label: 'Cancelar' },
      { label: 'Rescatar', kind: 'primary', run: () => { const p = M.stretchPlan(FEST, key, on, logNow()); if (!p.ok) { toast(p.error, true); return; } go(p); } }
    ]);
  }

  /** Corregir la hora REAL de inicio (doble clic en la columna de horas): si no se pudo pulsar ▶ a tiempo. */
  document.addEventListener('dblclick', e => {
    const td = e.target.closest && e.target.closest('td.est'); if (!td || !FEST) return;
    const tr = td.closest('tr'); if (!tr || !tr.dataset.key) return;
    const now = logNow(), b = C.buildBlocks(FEST, { mode: 'all', day: 'all', now }).find(x => x.key === tr.dataset.key);
    if (!b || !C.isBand(b)) return;
    if (b.ri === null && !(b.si !== null && b.si <= now)) { toast(b.name + ' aún no ha empezado: la hora real de inicio se corrige cuando ya ha empezado', true); return; }
    const cur = b.ri !== null ? b.ri : b.si;
    modal('Hora real de inicio · ' + b.name, '<p>' + (b.ri === null ? 'Sin ▶: se dio por empezada a su hora (' + C.fmtHM(b.si) + ').' : 'Inicio real registrado: ' + C.fmtHM(b.ri) + '.') +
      ' Pon la hora a la que empezó de verdad: el retraso de la zona y el log se recalculan.</p>' +
      '<div class="form"><label for="ri-t">Empezó a las</label><input id="ri-t" type="time" value="' + C.fmtHM(cur) + '"></div>', [
      { label: 'Cancelar' },
      { label: 'Corregir', kind: 'primary', run: () => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(($('ri-t').value || '').trim());
        if (!m || +m[1] > 23 || +m[2] > 59) { toast('Hora no válida', true); return false; }
        const hm = +m[1] * 60 + +m[2], base = Math.floor(cur / 1440) * 1440;
        const abs = [base - 1440, base, base + 1440].map(d => d + hm).sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur))[0];   // la más cercana (cruza medianoche)
        const r = M.editStartPlan(FEST, CONFIG, b.key, abs, logNow());
        if (!r.ok) { toast(r.error, true); return false; }
        commitFestival(r.state, r.msg, { noTimes: true, noReal: true, ev: [{ type: 'real', amber: true, text: r.logTxt + ' · Stage Manager' }] });
      } }
    ]);
  });

  /** Registra la hora real y, si desborda el colchón, empuja SOLO el desborde en lo autorizado (Retrasos ▾) de su zona.
   *  La regla está en mando.js (la misma para la tabla y para el mando del móvil). */
  function registerReal(tr, which) {
    const r = M.realPlan(FEST, CONFIG, tr.dataset.key, which, Math.floor(C.nowAbs()));
    if (!r.ok) { toast(r.error, true); return; }
    if (r.clashes.length) setTimeout(() => toast('Choque con entrada en rojo: ' + r.clashes.map(c => c.name + ' / ' + c.with).join(', '), true), 2800);
    commitFestival(r.state, r.msg, { noTimes: true, ev: pushedEv(r) });
  }

  /** Hitos que vienen (puertas, curfew…): tarjeta NEUTRA; ámbar solo si el margen baja de 15 min; rojo si se rebasa. */
  const HITO_MAX = 4;
  function hitoChips(nowInt) {
    if (!FEST) return '';
    const jor = C.activeJornada(FEST, nowInt);
    const margins = C.hitoMargins(FEST, C.buildBlocks(FEST, { mode: 'all', day: 'all', now: nowInt }), nowInt);
    return C.buildBlocks(FEST, { mode: 'all', day: jor, now: nowInt }).filter(b => b.kind === 'hito' && b.psi !== null && b.psi >= nowInt).slice(0, HITO_MAX).map(h => {
      const m = margins.find(x => x.hito.key === h.key), lv = m ? m.level : 'none';
      const cls = lv === 'over' ? 'over' : lv === 'tight' ? 'absorb' : 'hito';
      const tail = !m ? '' : lv === 'over' ? ' · rebasado +' + (-m.margin) + ' min' : ' · margen ' + m.margin + ' min';
      const tip = m ? m.band.name + ' acaba ' + C.fmtHM(m.projEnd) : 'Sin bandas antes en su zona';
      return '<span class="dchip ' + cls + '" title="' + esc(tip) + '"><svg class="ic"><use href="#' + (cls === 'hito' ? 'i-clock' : 'i-alert') + '"/></svg>' + esc(h.name) + ' ' + C.fmtHM(h.psi) + tail + '</span>';
    }).join('');
  }

  /** Barra de estado: desfase por zona (ámbar absorbiendo · rojo desborde · verde adelanto). */
  function renderDrift(nowInt) {
    MARGINS = C.hitoMargins(FEST, C.buildBlocks(FEST, { mode: 'all', day: 'all' }), nowInt);
    // Solo las zonas que van con retraso (acumulado o en vivo): si una zona no sale, va bien
    const html = (FEST ? C.delayByZone(FEST, nowInt) : []).map(z => M.delayPill(z)).filter(p => p.cls !== 'ok' && p.cls !== 'early').map(p => {
      const ic = p.cls === 'over' ? '#i-alert' : '#i-clock';
      return '<span class="dchip ' + p.cls + '" title="' + esc(p.title) + '"><svg class="ic"><use href="' + ic + '"/></svg>' + esc(p.text) + '</span>';
    }).join('');
    const tight = hitoChips(nowInt);
    // Avisos escritos a mano (Producción): delante; la ✕ es solo del Stage Manager
    const av = (Dt.getAvisos ? Dt.getAvisos() : []).map(a => '<span class="dchip absorb aviso" title="' + esc((a.from ? a.from + ' · ' : '') + (a.ms ? 'aviso puntual' : 'aviso permanente: solo se quita con la ✕')) + '"><svg class="ic"><use href="#i-msg"/></svg>' +
      esc(a.text) + '<button class="avx" type="button" data-aviso-x="' + esc(a.id) + '" title="Quitar aviso" aria-label="Quitar aviso"><svg class="ic"><use href="#i-x"/></svg></button></span>').join('');
    const h = av + html + tight + meteoChips(meteoState());
    if ($('drift').innerHTML !== h) $('drift').innerHTML = h;
  }

  /** LED DELAY: rojo si la entrada está fija o si su categoría está bloqueada en Retrasos. */
  function ledCell(a, b, band, mode) {
    const kind = b ? b.kind : (band ? mode : C.tipoOf(a));
    const catBlocked = isBlocked(kind, a.escenarioId || '');
    const fija = C.isFija(a), libre = C.isLibre(a);
    const red = fija || (!libre && catBlocked);
    const own = fija || libre;                         // decidido en esta entrada (por encima de su categoría)
    const title = (red ? 'Rojo: no se mueve con los retrasos' : 'Verde: se mueve con los retrasos') +
      (own ? ' (puesto en esta entrada)' : catBlocked ? ' (' + CAT_TXT[kind].toLowerCase() + ' bloqueados en Retrasos para esta zona)' : '') +
      '. Clic: pasar a ' + (red ? 'verde' : 'rojo');
    return '<td class="dl"><button class="led' + (red ? ' red' : '') + (own ? ' own' : '') + '" data-act="fija" data-red="' + (red ? '1' : '') + '" data-cat="' + (catBlocked ? '1' : '') + '" title="' + title + '" aria-label="Delay"></button></td>';
  }

  /** Modo Foco: micro-píldora del tipo, legible a distancia, con color fijo por tipo (show · prueba · tarea · hito). */
  const PILL_TXT = { show: 'SHOW', sc: 'PRUEBA', tarea: 'TAREA', hito: 'HITO' };
  function tipoPill(k) { return '<span class="tpill tp-' + k + '" aria-hidden="true">' + (PILL_TXT[k] || '') + '</span>'; }
  // Fila editable de una entrada (con o sin horario en la vista actual). b = su bloque (o null).
  function rowHtml(a, b, mods, isNew) {
    const mode = rowModeOf(b);
    const tipo = C.tipoOf(a), band = tipo === 'banda';
    const m = (mods[mode] || {})[a.id] || [];
    const v = k => C.fieldValue(a, mode, k);
    const isMod = k => m.indexOf(k) >= 0;
    const td = (k, cls, inner) => '<td class="' + cls + (isMod(k) ? ' mod' : '') + '"' + (isMod(k) ? ' title="Cambiado desde la última importación/exportación"' : '') + '>' + inner + '</td>';
    const inp = (k, ph) => '<input type="text" data-k="' + k + '" value="' + esc(v(k)) + '" data-orig="' + esc(v(k)) + '"' + (ph ? ' placeholder="' + ph + '"' : '') + ' autocomplete="off" spellcheck="false">';
    const esc0 = C.getEscenario(FEST, a.escenarioId);
    const scol = safeColor(esc0 && esc0.color, '#555');
    const col = hex6(C.artistColor(FEST, a), '#888888');
    const jor = C.jornadaOf(FEST, a, mode);
    const fecha = v('fecha');
    const real = (jor && fecha && fecha !== jor) ? '<span class="real" title="Empieza antes de la hora de corte: cuenta como la jornada anterior">fecha real ' + esc(fmtDay(fecha)) + '</span>' : '';
    let gap = '<span class="dash"' + (band ? '' : ' title="Las tareas y los hitos no tienen changeover ni solapes"') + '>—</span>';
    if (b && tipo === 'hito') { const hm = (MARGINS || []).find(x => x.hito.key === b.key); if (hm) gap = marginChip(hm); }
    if (b && band) {
      const co = C.changeoverBefore(ALL_MODE, ALL_MODE.find(x => x.key === b.key) || b, TAREAS);
      if (!co) gap = '<span class="dash" title="Primera actuación de su zona">—</span>';
      else if (co.mins < 0) gap = '<span class="gapbtn ovl" title="Solapa ' + (-co.mins) + ' min: empieza antes de que acabe ' + esc(co.prev.name) + '">−' + (-co.mins) + '′</span>';
      else gap = b.standby
        ? '<button class="gapbtn sb" data-act="standby" data-on="0" title="STANDBY · ' + co.mins + ' min. Pulsa para volver a CHANGEOVER"><svg class="ic"><use href="#i-pause"/></svg>' + co.mins + '′</button>'
        : co.idle
        ? '<button class="gapbtn idle" data-act="standby" data-on="1" title="Sin actividad · ' + co.mins + ' min: no es un cambio (misma banda, o hay una tarea de la zona en medio). Pulsa para marcarlo como STANDBY">— ' + co.mins + '′</button>'
        : '<button class="gapbtn" data-act="standby" data-on="1" title="CHANGEOVER · ' + co.mins + ' min. Pulsa para marcarlo como STANDBY (zona cerrada o descanso)"><svg class="ic"><use href="#i-swap"/></svg>' + co.mins + '′</button>';
    }
    const off = '<span class="dash" title="' + (tipo === 'hito' ? 'Un hito es un momento: no tiene fin ni CALL' : 'Las tareas no tienen CALL') + '">—</span>';
    const cls = [isNew ? 'nueva' : '', 'k-' + (band ? mode : tipo)].filter(Boolean).join(' ');
    return '<tr data-id="' + esc(a.id) + '" data-mode="' + mode + '"' + (b ? ' data-key="' + esc(b.key) + '"' : '') + ' class="' + cls + '">' +
      ledCell(a, b, band, mode) +
      '<td class="lv"><div class="rowbtns">' + liveBtns(b, band) + '</div></td>' +
      // Orden de hoja de ruta (decisión 85): jornada · previsto · real · tipo · zona · nombre · CALL · cambio · notas
      td('fecha', 'f', jornadaSelect(jor, 'data-k="jornada" data-orig="' + esc(jor) + '"') + real) +
      td('inicio', 't ti', inp('inicio')) +
      td('fin', 't', tipo === 'hito' ? off : inp('fin', '—')) +
      estCell(b) +
      td('tipo', 'tp', tipoSelect(a, mode, 'data-k="tipo" data-orig="' + tipo + '"')) +
      td('escenario', 'stage', '<input type="text" list="zones-dl" data-k="zona" value="' + esc(esc0 ? esc0.nombre : '') + '" data-orig="' + esc(esc0 ? esc0.nombre : '') + '" placeholder="' + (band ? '— zona —' : '— ninguna —') + '" style="--sc:' + scol + '" title="Elige una zona o escribe una nueva para crearla" autocomplete="off" spellcheck="false">') +
      '<td class="name' + (isMod('nombre') || isMod('color') ? ' mod' : '') + '"><div class="nm">' + tipoPill(band ? mode : tipo) +
        '<input type="color" data-k="color" value="' + col + '" data-orig="' + col + '" title="Color de la banda">' +
        '<input type="text" data-k="nombre" value="' + esc(a.nombre || '') + '" data-orig="' + esc(a.nombre || '') + '" autocomplete="off" spellcheck="false">' +
        (isNew ? '<span class="tag" title="Creada desde la última importación/exportación">NUEVA</span>' : '') + '</div></td>' +
      td('call', 't', band ? inp('call', '—') : off) +
      td('standby', 'gap', gap) +
      td('notas', 'n', inp('notas')) +
      '<td class="mo"><div class="more"><button class="delbtn morebtn" data-act="more" title="Más: duplicar, borrar"><svg class="ic"><use href="#i-dots"/></svg></button>' +
        '<div class="morep"><button class="delbtn dupbtn" data-act="dup" title="Duplicar en otra jornada"><svg class="ic"><use href="#i-copy"/></svg><span>Duplicar</span></button>' +
        '<button class="delbtn delb" data-act="del" title="Borrar ' + TIPO_TXT[tipo] + '"><svg class="ic"><use href="#i-trash"/></svg><span>Borrar</span></button></div></div></td>' +
      '</tr>';
  }

  // Lista de bandas del modo y día elegidos + las que aún no tienen horario en este modo
  function renderTable() {
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('#tbody, #tbody-sin') && ae.matches('input,select')) { pendingRender = true; return; }
    pendingRender = false;
    const mode = CONFIG.mode;
    const mods = ORIG ? { show: C.modifiedFields(ORIG, FEST, 'show'), sc: C.modifiedFields(ORIG, FEST, 'sc') } : {};
    const nuevas = new Set((ORIG ? C.newArtistIds(ORIG, FEST) : []).map(String));
    zonesDatalist();
    $('list-title').textContent = viewOf().title + (CONFIG.day === 'all' ? ' · todas las jornadas' : ' · ' + fmtDay(CONFIG.day));
    // Ancho del selector de escenario según el nombre más largo (que «Escenario Alhambra» se lea entero)
    const longest = Math.max(8, ...(FEST.escenarios || []).map(e => String(e.nombre || '').length));
    $('tbl').style.setProperty('--escw', 'calc(' + (Math.min(longest, 26) * 1.12).toFixed(1) + 'ch + 26px)');   // negrita: un poco más que 1ch por letra
    const rows = BLOCKS.map(b => {
      const a = FEST.artists.find(x => String(x.id) === String(b.id));
      return a ? rowHtml(a, b, mods, nuevas.has(String(a.id))) : '';
    });
    $('tbody').innerHTML = rows.join('') || '<tr><td colspan="13" class="hint" style="padding:16px">' +
      (FEST.artists.length ? 'No hay ' + viewOf().what + ' en esta jornada. Añádelos abajo.' : 'Todavía no hay nada. Añade la primera entrada en la fila de abajo.') + '</td></tr>';
    // Las vistas son FILTROS PUROS: Shows = solo shows, Soundchecks = solo soundchecks.
    // Solo en Jornada completa se listan las entradas sin ningún horario (si no, no se verían en ninguna parte).
    const sin = mode === 'all' ? FEST.artists.filter(a => !C.entersMode(a, 'all')) : [];
    $('tbody-sin').innerHTML = sin.length
      ? '<tr class="sec"><td colspan="13">Sin horario (' + sin.length + ') · elige jornada y escribe el inicio</td></tr>' + sin.map(a => rowHtml(a, null, mods, nuevas.has(String(a.id)))).join('')
      : '';
    markRows(Math.floor(C.nowAbs()));
  }

  // Fila de alta: mantiene escenario y jornada elegidos; no propone horas.
  function renderAddRow() {
    zonesDatalist();
    const sJor = $('add-jornada'), prevJor = sJor.value;
    const want = prevJor || (CONFIG.day !== 'all' ? CONFIG.day : '');
    sJor.outerHTML = jornadaSelect(jornadaOptions().indexOf(want) >= 0 ? want : '', 'id="add-jornada" data-f="jornada"');
    // Tipo de la fila de alta: en Shows/Soundchecks, por defecto el de la vista; en Jornada completa, el último elegido
    const sT = $('add-tipo');
    if (CONFIG.mode !== 'all' && sT.dataset.view !== CONFIG.mode) sT.value = CONFIG.mode;
    sT.dataset.view = CONFIG.mode;
    syncAddTipo();
  }

  const ADD_LABEL = { show: 'show', sc: 'soundcheck', tarea: 'tarea', hito: 'hito' };
  const ADD_PH = { show: 'Nombre de la banda', sc: 'Nombre de la banda', tarea: 'Tarea (p. ej. Comida técnicos)', hito: 'Hito (p. ej. Puertas, Curfew)' };
  /** Hito: sin fin ni CALL. Tarea: sin CALL. Las casillas que no aplican se desactivan. */
  function syncAddTipo() {
    const t = $('add-tipo').value;
    $('btn-add').lastChild.textContent = 'Añadir ' + ADD_LABEL[t];
    $('addm-t').textContent = 'Añadir ' + ADD_LABEL[t];
    $('add-nombre').placeholder = ADD_PH[t];
    $('add-fin').disabled = t === 'hito'; if (t === 'hito') $('add-fin').value = '';
    $('add-call').disabled = t === 'tarea' || t === 'hito'; if ($('add-call').disabled) $('add-call').value = '';
    $('add-call-hint').textContent = $('add-call').disabled ? 'las tareas y los hitos no llevan CALL'
      : 'vacío = ' + Dt.callMinsOf(FEST, CONFIG) + ' min antes del inicio (el de Configuración › Evento)';
    $('addrow').className = 'form addform k-' + t;
    updateAddHint();
  }

  function addValues() {
    const g = id => $(id).value;
    const t = g('add-tipo');
    return { tipo: t === 'tarea' || t === 'hito' ? t : 'banda', modo: t === 'sc' ? 'sc' : 'show',
      nombre: g('add-nombre'), escenarioId: g('add-escenario'), jornada: g('add-jornada'), inicio: g('add-inicio'),
      // Fin: hora (23:30) o duración con «+» (+60 = 60 min desde el inicio)
      fin: /^\s*\+/.test(g('add-fin')) ? '' : g('add-fin'), duracion: /^\s*\+/.test(g('add-fin')) ? g('add-fin').replace(/^\s*\+\s*/, '').trim() : '', call: g('add-call'), notas: g('add-notas') };
  }

  function updateAddHint() {
    const d = addValues(), ini = C.normHM(d.inicio);
    let h = '';
    if (ini && C.dayIndex(d.jornada) !== null) {
      const f = C.fechaFor(FEST, d.jornada, ini);
      if (f !== d.jornada) h = ini + ' es antes de la hora de corte (' + (FEST.event.dayCutoff || C.DEFAULT_CUTOFF) + '): jornada ' + fmtDay(d.jornada) + ', fecha real ' + fmtDay(f) + '.';
    }
    const dur = String(d.duracion || '').trim();
    if (ini && /^\d+$/.test(dur)) h += (h ? ' ' : '') + 'Fin: ' + C.fmtHM(C.parseHM(ini) + Number(dur)) + '.';
    $('add-hint').textContent = h;
  }

  function addBand() {
    document.querySelectorAll('#addrow .bad').forEach(x => x.classList.remove('bad'));
    const v = addValues();
    const z = resolveZone(FEST, $('add-escenario').value);
    if (!z.ok) { $('add-err').textContent = z.error; $('add-escenario').classList.add('bad'); return; }
    v.escenarioId = z.id;
    const r = C.addArtist(z.state, v.modo, v);
    if (!r.ok) {
      $('add-err').textContent = r.error;
      const f = r.field && document.querySelector('#addrow [data-f="' + (r.field === 'duracion' ? 'fin' : r.field) + '"]');
      if (f) { f.classList.add('bad'); f.focus(); }
      return;
    }
    $('add-err').textContent = '';
    const name = (r.state.artists.find(x => x.id === r.id) || {}).nombre || '';
    ['add-nombre', 'add-inicio', 'add-fin', 'add-call', 'add-notas'].forEach(id => { $(id).value = ''; });
    // Si la jornada nueva no es la que se está viendo, no se cambia el filtro: se avisa.
    const jor = $('add-jornada').value, t = $('add-tipo').value;
    const fuera = CONFIG.mode !== 'all' && t !== CONFIG.mode;
    commitFestival(r.state, 'Añadido (' + ADD_LABEL[t] + '): ' + name +
      (fuera ? ' · se ve en Jornada completa' : CONFIG.day !== 'all' && CONFIG.day !== jor ? ' (en ' + fmtDay(jor) + ', no en la jornada que estás viendo)' : ''));
    closeAdd();
    const row = document.querySelector('#tbody tr[data-id="' + r.id + '"]');
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'center' }); }
  }

  $('addrow').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); addBand(); }
  });
  $('addrow').addEventListener('input', e => { $('add-err').textContent = ''; e.target.classList.remove('bad'); updateAddHint(); });
  $('addrow').addEventListener('change', e => {
    e.target.classList.remove('bad');
    if (e.target.id === 'add-tipo') syncAddTipo(); else updateAddHint();
  });
  $('btn-add').addEventListener('click', addBand);
  /** Ventana «Añadir»: en medio de la pantalla; al aceptar, la entrada se coloca sola por su hora. */
  function openAdd() {
    if (!FEST) { toast('Primero crea el evento (o pega un horario: se crea solo)', true); askNew(); return; }
    closeMenus(); closeConfig();
    if (IMP) closeImport();
    setAddTabs('row');
    $('add-err').textContent = '';
    renderAddRow();
    $('addm').hidden = false;
    $('add-nombre').focus();
  }
  function closeAdd() { $('addm').hidden = true; }
  // «+ Añadir»: un solo modal con 2 pestañas (Pegar horario completo · Añadir 1 fila a mano). Abre en la última usada; la primera vez, Pegar.
  const ADDTAB_KEY = 'showtime.addtab';
  function setAddTabs(tab) {
    document.querySelectorAll('.addtabs [data-addtab]').forEach(b => { const on = b.dataset.addtab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    try { localStorage.setItem(ADDTAB_KEY, tab); } catch (e) {}
  }
  function lastAddTab() { try { return localStorage.getItem(ADDTAB_KEY) === 'row' ? 'row' : 'paste'; } catch (e) { return 'paste'; } }
  function openAddTab(tab) { if (tab === 'row') openAdd(); else openImport(''); }
  $('btn-new-row').addEventListener('click', () => openAddTab(lastAddTab()));
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-addtab]'); if (!b) return;
    if (b.dataset.addtab === 'row') { if (!FEST) { closeImport(); } openAdd(); }
    else { const keep = IMP ? IMP.text : ''; openImport(keep); }
  });
  $('addm-cancel').addEventListener('click', closeAdd);
  $('addm').addEventListener('click', e => { if (e.target.id === 'addm') closeAdd(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('addm').hidden) closeAdd(); });

  // Filas que suenan / siguientes / pasadas (solo clases: no rehace las casillas)
  function markRows(nowInt) {
    const playing = new Set(C.playingNow(BLOCKS, nowInt).concat(C.tasksNow(BLOCKS, nowInt)).map(b => b.key));
    const next = new Set(C.nextPerStage(BLOCKS, nowInt).map(b => b.key));
    document.querySelectorAll('#tbody tr[data-key]').forEach(tr => {
      const key = tr.dataset.key, b = BLOCKS.find(x => x.key === key);
      tr.classList.toggle('playing', playing.has(key));
      tr.classList.toggle('next', next.has(key));
      tr.classList.toggle('done', !!b && b.si !== null && !(b.alargar && b.rf === null) && C.blockEnd(b) <= nowInt);
      tr.classList.toggle('started', !!b && b.si !== null && nowInt >= b.si);     // ■ pasivo visible desde su hora (estimada)
      tr.classList.toggle('ended', !!b && C.isBand(b) && b.rf === null && !b.alargar && b.nf !== null && nowInt >= b.nf);   // sin Alargar: parada a su hora
    });
  }

  /** Bis rescatable por zona: la última banda que ya acabó (sin ■ ni Tiempo extra) y aún dentro de la ventana del bis.
   *  Busca en TODAS las jornadas: la que acabó puede ser de la jornada anterior (pasada la hora de corte). { zoneId: { b, late } } */
  function bisCands(nowInt) {
    const last = {};
    ALL_MODE.forEach(b => {
      if (!C.isBand(b) || b.rf !== null || b.alargar || b.nf === null || b.nf > nowInt) return;
      const z = b.stageId || '';
      if (!last[z] || b.nf > last[z].nf) last[z] = b;
    });
    const out = {};
    Object.keys(last).forEach(z => {
      const p = M.stretchPlan(FEST, last[z].key, true, nowInt);
      if (p.ok && p.late !== null && p.late !== undefined) out[z] = { b: last[z], late: p.late };
    });
    return out;
  }
  function bisBtnHtml(c) {
    return '<button class="xtrabtn bis" data-act="stretch" data-key="' + esc(c.b.key) + '" data-on="1" title="' + esc(c.b.name) + ' acabó hace ' + c.late + ' min: rescátala si hay bis (Tiempo extra tardío)"><svg class="ic"><use href="#i-undo"/></svg>Bis · ' + esc(c.b.name) + '</button>';
  }

  // Vista en vivo (mismas reglas que la Pantalla Live)
  function renderLive(nowMins, nowInt) {
    const order = id => { const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === id); return i < 0 ? 999 : i; };
    const rows = [];
    const kindTag = b => CONFIG.mode === 'all' && b.kind === 'sc' ? 'Soundcheck · ' : '';
    C.playingNow(BLOCKS, nowInt).forEach(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), p = C.progress(b, nowInt);
      rows.push({ o: order(b.stageId), h: '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + kindTag(b) + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + '</div>' +
        '<div class="v-rem" style="color:' + col + '">' + (xtraOver(b, nowInt) !== null ? 'TIEMPO EXTRA · +' + xtraOver(b, nowInt) + ' min' : p.remaining + ' min restantes' + (b.alargar && b.rf === null ? ' · tiempo extra' : '')) + '</div>' + (b.rf === null ? xtraBtn(b) : '') + '</div>' });
    });
    const bis = bisCands(nowInt), bisShown = new Set(), bisFor = z => { z = z || ''; if (!bis[z]) return ''; bisShown.add(z); return bisBtnHtml(bis[z]); };
    C.playingNow(BLOCKS, nowInt).forEach(b => bisShown.add(b.stageId || ''));   // la zona ya suena: ahí no se ofrece el bis
    C.changeoversNow(BLOCKS, nowMins, TAREAS).forEach(co => {
      const col = safeColor(co.stageColor || co.next.color, '#888');
      if (!co.standby && co.kind === 'idle') {      // hueco sin cambio real (decisión 76)
        rows.push({ o: order(co.stageId), h: '<div class="v-row co idle" style="--c:' + col + '"><div class="v-name" style="color:var(--muted)">— SIN ACTIVIDAD —' + (co.stage ? ' · ' + esc(co.stage) : '') + '</div>' +
          '<div class="v-meta">después <b>' + esc(co.next.name) + '</b> · ' + C.fmtHM(co.next.si) + '</div>' + (co.prev ? '' : bisFor(co.stageId)) + '</div>' });
        return;
      }
      rows.push({ o: order(co.stageId), h: '<div class="v-row co' + (co.standby ? ' sb' : '') + '" style="--c:' + col + '"><div class="v-name" style="color:' + (co.standby ? 'var(--muted)' : col) + '">' +
        (co.standby ? 'STANDBY' : 'CHANGEOVER') + (co.stage ? ' · ' + esc(co.stage) : '') + '</div>' +
        '<div class="v-meta">' + (co.standby ? 'después' : 'entra') + ' <b>' + esc(co.next.name) + '</b> · ' + C.fmtHM(co.next.si) + '</div>' +
        '<div class="v-rem">quedan ' + fmtCountdown(co.remaining) + '</div>' + bisFor(co.stageId) + '</div>' });
    });
    // Zonas cuya última banda acaba de terminar sin tarjeta de cambio (fin de la noche, o pasada la hora de corte): el bis sigue a mano
    Object.keys(bis).filter(z => !bisShown.has(z)).forEach(z => {
      const c = bis[z], col = safeColor(c.b.stageColor || c.b.color, '#888');
      rows.push({ o: order(z), h: '<div class="v-row co ended" style="--c:' + col + '"><div class="v-name" style="color:var(--muted)">ACABÓ · ' + esc(c.b.name) + (c.b.stage ? ' · ' + esc(c.b.stage) : '') + '</div>' +
        '<div class="v-meta">a las ' + C.fmtHM(c.b.nf) + ' · hace ' + c.late + ' min</div>' + bisBtnHtml(c) + '</div>' });
    });
    // Tareas en curso (operativa del día): debajo de los escenarios, sin cuenta de cambio
    C.tasksNow(BLOCKS, nowInt).forEach(b => {
      const p = C.progress(b, nowInt), nb = C.nextBandIn(BLOCKS, b.stageId, nowInt);
      rows.push({ o: b.stageId ? order(b.stageId) : 1000, h: '<div class="v-row tarea"><div class="v-name">Tarea · ' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + '–' + C.fmtHM(C.blockEnd(b)) + (b.stage ? ' · ' + esc(b.stage) : '') + ' · quedan ' + p.remaining + ' min</div>' +
        (nb ? '<div class="v-meta">después <b>' + esc(nb.name) + '</b> · ' + C.fmtHM(nb.si) + '</div>' : '') + '</div>' });
    });
    rows.sort((a, b) => a.o - b.o);
    const r = C.pickBlocks(BLOCKS, nowInt, 1);
    $('v-now').innerHTML = rows.length ? rows.map(x => x.h).join('') : '<div class="v-empty">' + (DAY_MISSING ? 'Jornada sin datos' : r.ended ? 'FIN DE JORNADA' : '—') + '</div>';

    const next = C.nextPerStage(BLOCKS, nowInt);
    $('v-next').innerHTML = next.length ? next.map(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), co = C.changeoverBefore(BLOCKS, b, TAREAS);
      const badge = co ? (co.mins < 0 ? 'Solapa ' + (-co.mins) + ' min' : b.standby ? 'Standby ' + co.mins + ' min' : co.idle ? '' : 'Cambio ' + co.mins + ' min') : '';
      return '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + kindTag(b) + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + (badge ? ' · ' + badge : '') + '</div></div>';   // sin Tiempo extra: solo tiene sentido para la que suena (o el bis)
    }).join('') : '<div class="v-empty">—</div>';

    const done = new Set(Dt.getCallDone());
    const calls = C.callList(BLOCKS, nowInt, Dt.callMinsOf(FEST, CONFIG), done);
    $('v-call').innerHTML = calls.length ? calls.map(b => {
      const col = safeColor(b.stageColor || b.color, '#ffc533');
      return '<div class="v-row v-call" style="--c:' + col + '"><div><div class="v-name" style="color:' + col + '">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + (b.stage ? esc(b.stage) + ' · ' : '') + 'en ' + Math.max(1, Math.round(b.si - nowInt)) + ' min · ' + C.fmtHM(b.si) + '</div></div>' +
        '<button class="okbtn" data-ck="' + esc(C.callKey(b)) + '" title="Marcar como avisado">OK</button></div>';
    }).join('') : '<div class="v-empty">—</div>';
    $('card-call').classList.toggle('hot', calls.length > 0);
  }

  function tick() {
    const d = new Date();
    $('clock').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    const nOpen = Array.from(LIVES.values()).filter(x => x && !x.closed).length;
    $('live-state').className = 'state ' + (nOpen ? 'on' : 'off');
    $('live-state').title = nOpen ? (nOpen === 1 ? '1 Pantalla Live abierta' : nOpen + ' Pantallas Live abiertas') : 'Ninguna Pantalla Live abierta';
    $('btn-live').title = 'Pantallas Live: Manager, Confidence (por zona) y Backstage';
    document.querySelectorAll('#m-live [data-on]').forEach(el => el.classList.toggle('on', liveOpen(el.dataset.on)));
    document.querySelectorAll('#m-live [data-close]').forEach(el => { el.hidden = !liveOpen(el.dataset.close); });
    if ($('lv-closeall')) $('lv-closeall').hidden = nOpen < 2;
    if ($('lv-standby')) {
      const on = standbyOn();
      $('lv-standby-on').classList.toggle('on', on);
      $('lv-standby-t').textContent = on ? 'Quitar Standby · volver a la vista' : 'Standby · Modo Cartel';
    }
    meteoTick();
    if (!FEST) return;
    logFoto();
    const mNow = Math.floor(C.nowAbs(d));
    if (LAST_MIN !== null && mNow !== LAST_MIN) { compute(); if (BLOCKS.some(b => b.alargar && b.rf === null)) renderTable(); }   // el estimado en directo (Alargar)
    LAST_MIN = mNow;
    renderMeteo();
    const nowMins = C.nowAbs(d), nowInt = Math.floor(nowMins);
    renderLive(nowMins, nowInt);
    renderDrift(nowInt);
    renderFlash();
    markRows(nowInt);
    renderDaybar(nowInt);
  }

  let LAST_MIN = null;
  // ── Edición en la lista ──────────────────────────────────────────────
  /** Aplica la casilla. `then` = casilla a la que iba el foco (para no perderlo al repintar). */
  function applyEdit(el, then) {
    const tr = el.closest('tr'); if (!tr || !document.body.contains(el)) return;
    const id = tr.dataset.id, k = el.dataset.k, rmode = tr.dataset.mode || 'show';
    if (!k || el.value === el.dataset.orig) { el.classList.remove('bad'); return; }
    if (k === 'zona') {
      const z = resolveZone(FEST, el.value);
      if (!z.ok) { el.classList.add('bad'); toast(z.error, true); return; }
      const rz = C.editArtist(z.state, id, rmode, 'escenario', z.id);
      if (!rz.ok) { el.classList.add('bad'); toast(rz.error, true); return; }
      el.dataset.orig = el.value;
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbody, #tbody-sin')) document.activeElement.blur();
      const nm = (rz.state.artists.find(a => String(a.id) === String(id)) || {}).nombre || '';
      commitFestival(rz.state, nm + ': zona → ' + (z.id ? (z.created ? z.name + ' (zona nueva creada)' : C.getEscenario(rz.state, z.id).nombre) : 'sin zona'));
      if (then) { const t = document.querySelector('tr[data-id="' + CSS.escape(then.id) + '"] [data-k="' + then.k + '"]'); if (t) t.focus(); }
      return;
    }
    const r = C.editArtist(FEST, id, rmode, k, el.value);
    if (!r.ok && k === 'tipo') el.value = el.dataset.orig;
    if (!r.ok) { el.classList.add('bad'); el.title = r.error; toast(r.error, true); return; }
    el.classList.remove('bad'); el.title = '';
    if (!r.changed) { el.value = el.dataset.orig; return; }
    const name = (r.state.artists.find(a => String(a.id) === String(id)) || {}).nombre || '';
    el.dataset.orig = el.value;      // evita aplicarlo dos veces (Intro + salir de la casilla)
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbody, #tbody-sin')) document.activeElement.blur();
    let shown = r.value || '—';
    if (k === 'jornada') shown = fmtDay(r.value);
    else if (k === 'escenario') { const e = C.getEscenario(r.state, r.value); shown = e ? e.nombre : 'sin zona'; }
    else if (k === 'tipo') shown = TIPO_TXT[r.value] + (CONFIG.mode !== 'all' && r.value !== 'banda' ? ' (se ve en Jornada completa)' : '');
    commitFestival(r.state, name + ': ' + KEY_LABEL[k] + ' → ' + shown);
    const row = document.querySelector('#tbody tr[data-id="' + CSS.escape(String(id)) + '"], #tbody-sin tr[data-id="' + CSS.escape(String(id)) + '"]');
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
    else if (k === 'jornada' || k === 'inicio') toast(name + ': ahora está en ' + fmtDay(C.jornadaOf(FEST, FEST.artists.find(a => String(a.id) === String(id)), rmode)) + ' (fuera de la jornada que estás viendo)');
    if (then) {
      const t = document.querySelector('tr[data-id="' + CSS.escape(then.id) + '"] [data-k="' + then.k + '"]');
      if (t) t.focus();
    }
  }
  function focusTarget(rel) {
    if (!rel || !rel.closest || !rel.dataset || !rel.dataset.k) return null;
    const tr = rel.closest('tr[data-id]');
    return tr ? { id: tr.dataset.id, k: rel.dataset.k } : null;
  }

  ['tbody', 'tbody-sin'].forEach(tid => {
    const tb = $(tid);
    tb.addEventListener('keydown', e => {
      const el = e.target;
      if (!el.matches('input[type=text]')) return;
      if (e.key === 'Enter') { e.preventDefault(); applyEdit(el); }
      else if (e.key === 'Escape') { e.preventDefault(); el.value = el.dataset.orig; el.classList.remove('bad'); el.blur(); }
    });
    // Salir de una casilla: se aplica (es igual de explícito que Intro). Si es inválida, se queda en rojo.
    tb.addEventListener('focusout', e => {
      const el = e.target;
      if (el.matches('input[type=text]')) applyEdit(el, focusTarget(e.relatedTarget));
      setTimeout(() => { if (pendingRender && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbody, #tbody-sin'))) renderTable(); }, 0);
    });
    tb.addEventListener('change', e => {
      const el = e.target;
      if (el.matches('select, input[type=color]')) applyEdit(el);
    });
    tb.addEventListener('click', e => {
      const lv = e.target.closest('[data-act="start"], [data-act="stop"]');
      if (lv) { registerReal(lv.closest('tr'), lv.dataset.act === 'start' ? 'i' : 'f'); return; }
      const mo = e.target.closest('[data-act="more"]');
      if (mo) { const m = mo.parentNode, on = !m.classList.contains('open'); document.querySelectorAll('.more.open').forEach(x => x.classList.remove('open')); m.classList.toggle('open', on); return; }
      const sg = e.target.closest('[data-act="stretch"]');
      if (sg) { applyStretch(sg.dataset.key || sg.closest('tr').dataset.key, sg.dataset.on === '1'); return; }
      const led = e.target.closest('[data-act="fija"]');
      if (led) {
        // Clic = el contrario de lo que se ve. Si coincide con lo que dice su categoría, la entrada vuelve a seguir a la categoría.
        const tr = led.closest('tr'), wantRed = !led.dataset.red, catRed = !!led.dataset.cat;
        const flag = wantRed === catRed ? null : (wantRed ? 'lock' : 'free');
        const r = C.setDelayFlag(FEST, tr.dataset.id, flag);
        const nm = (FEST.artists.find(x => String(x.id) === String(tr.dataset.id)) || {}).nombre || '';
        if (r.ok && r.changed) commitFestival(r.state, nm + ': DELAY ' + (wantRed ? 'rojo (no se mueve con los retrasos)' : 'verde (se mueve con los retrasos)') + (flag ? '' : ' · como su categoría'));
        return;
      }
      const sb = e.target.closest('[data-act="standby"]');
      if (sb) {
        const tr = sb.closest('tr'), id = tr.dataset.id, on = sb.dataset.on === '1';
        const r = C.setStandby(FEST, id, tr.dataset.mode || 'show', on);
        if (r.ok && r.changed) commitFestival(r.state, on ? 'Hueco marcado como STANDBY' : 'Hueco vuelve a CHANGEOVER');
        return;
      }
      document.querySelectorAll('.more.open').forEach(x => x.classList.remove('open'));
      const del = e.target.closest('[data-act="del"]');
      if (del) askDelete(del.closest('tr').dataset.id);
      const dup = e.target.closest('[data-act="dup"]');
      if (dup) askDuplicate(dup.closest('tr').dataset.id, dup.closest('tr').dataset.mode || 'show');
    });
  });

  function askDelete(id) {
    const a = FEST.artists.find(x => String(x.id) === String(id)); if (!a) return;
    const has = ['show', 'sc'].filter(m => C.entersMode(a, m)).map(m => m === 'sc' ? 'soundcheck' : 'show');
    const t = C.tipoOf(a);
    modal('Borrar ' + TIPO_TXT[t], '<p>¿Borrar <b>' + esc(a.nombre) + '</b>' + (has.length ? ' con su horario de ' + has.join(' y ') : '') + '?</p><p style="margin-top:8px">Se puede recuperar con Deshacer.</p>',
      [{ label: 'Cancelar' }, { label: 'Borrar', kind: 'danger', run: () => { const r = C.removeArtist(FEST, id); if (r.ok) commitFestival(r.state, 'Borrada: ' + a.nombre + ' (Deshacer para recuperarla)'); } }]);
  }

  // Duplicar en otra jornada: copia escenario, color y notas; la hora la escribe el regidor.
  function askDuplicate(id, rmode) {
    const a = FEST.artists.find(x => String(x.id) === String(id)); if (!a) return;
    const e0 = C.getEscenario(FEST, a.escenarioId), t = C.tipoOf(a);
    const html = '<p>Copia <b>' + esc(a.nombre) + '</b>' + (e0 ? ' (' + esc(e0.nombre) + ')' : '') + ' con su color y notas en otra jornada' + (t === 'banda' ? ' de ' + modeName(rmode) : ' (' + TIPO_TXT[t] + ')') + '.</p>' +
      '<div class="form" style="margin-top:12px">' +
      '<label for="d-nombre">Nombre</label><input id="d-nombre" type="text" value="' + esc(a.nombre) + '" autocomplete="off">' +
      '<label for="d-jor">Jornada</label>' + jornadaSelect('', 'id="d-jor"') +
      '<label for="d-ini">Inicio</label><input id="d-ini" type="text" placeholder="21:00" style="width:90px" autocomplete="off">' +
      '<label for="d-fin">Fin</label><div><input id="d-fin" type="text" placeholder="fin" style="width:90px" autocomplete="off"> o <input id="d-dur" type="text" inputmode="numeric" placeholder="min" style="width:70px" autocomplete="off"> min</div>' +
      '<label for="d-call">CALL</label><input id="d-call" type="text" placeholder="—" style="width:90px" autocomplete="off">' +
      '<div id="d-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
    modal('Duplicar en otra jornada', html, [{ label: 'Cancelar' }, { label: 'Duplicar', kind: 'primary', run: () => {
      const r = C.duplicateArtist(FEST, id, rmode, { nombre: $('d-nombre').value, jornada: $('d-jor').value, inicio: $('d-ini').value, fin: $('d-fin').value, duracion: $('d-dur').value, call: $('d-call').value });
      if (!r.ok) { $('d-err').textContent = r.error; return false; }
      const jor = $('d-jor').value;
      commitFestival(r.state, 'Duplicada: ' + a.nombre + ' en ' + fmtDay(jor) + (CONFIG.day !== 'all' && CONFIG.day !== jor ? ' (no es la jornada que estás viendo)' : ''));
    } }]);
    $('d-jor').focus();
  }

  // Aviso de fin de jornada: propone pasar a la siguiente, pero el cambio lo hace el regidor.
  let daybarKey = '';
  function renderDaybar(nowInt) {
    const r = FEST ? C.nextJornadaAfter(FEST, CONFIG.mode, CONFIG.day, nowInt) : null;
    const key = r ? r.done + '>' + r.next + '@' + CONFIG.mode : '';
    if (key === daybarKey) return;
    daybarKey = key;
    $('daybar').hidden = !r;
    if (!r) return;
    $('daybar-txt').textContent = cap(fmtDayLong(r.done)) + ' terminado · ¿pasar a ' + fmtDayLong(r.next) + '?';
    $('daybar-btn').textContent = 'Pasar a ' + fmtDay(r.next);
    $('daybar-btn').dataset.day = r.next;
  }
  function fmtDayLong(iso) {
    const i = C.dayIndex(iso);
    return i === null ? iso : new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  $('daybar-btn').addEventListener('click', e => {
    const d = e.currentTarget.dataset.day; if (!d) return;
    CONFIG = Dt.setConfig({ day: d }); compute(); renderAll();
    toast('Jornada: ' + fmtDay(d));
  });

  // TIEMPO EXTRA desde la tarjeta EN ESCENA
  ['v-now', 'v-next'].forEach(id => $(id).addEventListener('click', e => {
    const sg = e.target.closest('[data-act="stretch"]'); if (!sg) return;
    applyStretch(sg.dataset.key, sg.dataset.on === '1');
  }));

  // OK de CALL desde el Panel
  $('v-call').addEventListener('click', e => {
    const b = e.target.closest('.okbtn'); if (!b) return;
    Dt.markCallDone(b.dataset.ck, Math.floor(C.nowAbs()));
    logCallOk(b.dataset.ck, 'Stage Manager', 'panel');
    tick();
  });

  // ── Festival: nuevo y datos generales ────────────────────────────────
  function festForm(ev) {
    ev = ev || {};
    return '<div class="form">' +
      '<label for="f-nombre">Nombre</label><input id="f-nombre" type="text" value="' + esc(ev.nombre || '') + '" autocomplete="off">' +
      '<label for="f-ini">Primera jornada</label><input id="f-ini" type="date" value="' + esc(ev.fechaInicio || '') + '">' +
      '<label for="f-fin">Última jornada</label><input id="f-fin" type="date" value="' + esc(ev.fechaFin || '') + '">' +
      '<label for="f-cut">Hora de corte</label><input id="f-cut" type="text" value="' + esc(ev.dayCutoff || C.DEFAULT_CUTOFF) + '" style="width:90px">' +
      '<div class="note">Lo que empieza antes de esta hora cuenta como la jornada anterior (un DJ a las 02:00 del sábado es del viernes).</div>' +
      '<label for="f-call">Aviso CALL</label><div><input id="f-call" type="number" min="1" max="180" value="' + esc(ev.callMins || C.DEFAULT_CALL_MINS) + '" style="width:90px"> min antes del inicio</div>' +
      '<div class="note">Se usa cuando una banda no tiene hora de CALL escrita.</div>' +
      '<label for="f-comin">Changeover mínimo</label><div><input id="f-comin" type="number" min="0" max="180" value="' + esc(ev.coMin == null ? C.DEFAULT_CO_MIN : ev.coMin) + '" style="width:90px"> min</div>' +
      '<div class="note">Lo mínimo para cambiar de banda. Con retraso, lo que sobra del cambio por encima de este mínimo es el colchón. Se puede personalizar por zona.</div>' +
      '<div id="f-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
  }
  function readFestForm() {
    return { nombre: $('f-nombre').value, fechaInicio: $('f-ini').value, fechaFin: $('f-fin').value || $('f-ini').value, dayCutoff: $('f-cut').value, callMins: $('f-call').value, coMin: $('f-comin').value };
  }

  function askNew() {
    const d = FEST && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    let html = festForm({});
    if (d.total) html += '<div class="warnbox" style="margin-top:12px">El evento actual tiene ' + d.total + ' cambio(s) sin exportar y se sustituirá. Exporta antes si los quieres guardar.</div>';
    else if (FEST) html += '<p style="margin-top:12px">El evento actual («' + esc(FEST.event && FEST.event.nombre) + '») se sustituirá. Está guardado si lo exportaste.</p>';
    const acts = [{ label: 'Cancelar' }];
    if (d.total) acts.push({ label: 'Exportar el actual', run: () => { exportJSON(); setTimeout(askNew, 300); } });
    acts.push({ label: 'Crear evento', kind: 'primary', run: () => {
      const r = C.newFestival(readFestForm());
      if (!r.ok) { $('f-err').textContent = r.error; return false; }
      loadNew(r.state, 'Evento creado: ' + r.state.event.nombre + '. Ahora crea las zonas.');
      setTimeout(() => openConfig('stages'), 50);
    } });
    modal('Nuevo evento', html, acts);
  }

  // ── Configuración (panel lateral) ───────────────────────────────────
  function openConfig(section) {
    $('cfg').hidden = false; $('cfg-back').hidden = false;
    $('btn-cfg').setAttribute('aria-expanded', 'true');
    renderConfig();
    if (section) {
      const s = $('cfg-s-' + section);
      if (s) { s.scrollIntoView({ block: 'start' }); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
      const f = s && s.querySelector('input,select');
      if (f) f.focus();
    }
  }
  function closeConfig() {
    $('cfg').hidden = true; $('cfg-back').hidden = true;
    $('btn-cfg').setAttribute('aria-expanded', 'false');
  }
  $('btn-cfg').addEventListener('click', () => { if ($('cfg').hidden) openConfig(); else closeConfig(); });
  $('cfg-close').addEventListener('click', closeConfig);
  $('cfg-back').addEventListener('click', closeConfig);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').hidden && !$('cfg').hidden) closeConfig(); });

  function renderConfig() {
    // Festival
    if (FEST) {
      const box = $('cfg-fest');
      const ae = document.activeElement;
      if (!(ae && box.contains(ae))) {
        box.innerHTML = festForm(FEST.event) + '<div class="row end" style="margin-top:12px"><button id="f-save" class="btn primary">Guardar datos del evento</button></div>';
        $('f-save').addEventListener('click', saveFest);
        box.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveFest(); } }));
      }
      const sb = $('cfg-stages');
      if (!(ae && sb.contains(ae) && ae.matches('input[type=text]'))) { sb.innerHTML = stagesHtml(); bindStages(); }
    } else {
      $('cfg-fest').innerHTML = '<p class="hint">Sin evento cargado. Crea uno con «Nuevo evento» o ábrelo con «Abrir» (barra superior).</p>';
      $('cfg-stages').innerHTML = '<p class="hint">—</p>';
    }
    $('cfg-style-panel').value = panelStyle();
    $('cfg-style-live').value = CONFIG.style;
    fillMsgCfg();
    fillScreensCfg();
    fillMeteoCfg();
  }
  // Pantallas Live y vistas (2e-A)
  function fillScreensCfg() {
    const sc = CONFIG.screens || Vs.normScreens();
    document.querySelectorAll('#cfg-s-screens [data-sc]').forEach(el => {
      const [g, k] = el.dataset.sc.split('.');
      const v = k === 'all' ? (sc.ticker.delays && sc.ticker.hitos && sc.ticker.meteo) : sc[g][k];
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v;
    });
    const pv = $('sc-tprev'); pv.style.background = sc.ticker.bg; pv.style.color = sc.ticker.fg; pv.className = 'tkprev ' + sc.ticker.mode;
  }
  function saveScreens(el) {
    const sc = JSON.parse(JSON.stringify(CONFIG.screens || Vs.normScreens()));
    const [g, k] = el.dataset.sc.split('.');
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (k === 'all') { sc.ticker.delays = sc.ticker.hitos = sc.ticker.meteo = v; } else sc[g][k] = v;
    if (g === 'back' && !sc.back.cards && !sc.back.lines && !sc.back.ticker) { el.checked = true; toast('Backstage necesita al menos un bloque', true); return; }
    CONFIG = Dt.setConfig({ screens: sc }); fillScreensCfg();
  }
  document.querySelectorAll('#cfg-s-screens [data-sc]').forEach(el => el.addEventListener(el.type === 'color' ? 'input' : 'change', () => saveScreens(el)));
  function fillMsgCfg() {
    $('cfg-msg-bg').value = CONFIG.msgBg;
    $('cfg-msg-fg').value = CONFIG.msgFg;
    $('cfg-msg-secs').value = String(CONFIG.msgSecs);
    $('cfg-aviso-secs').value = String(CONFIG.avisoSecs);
    const pv = $('cfg-msg-prev');
    pv.style.setProperty('--mbg', CONFIG.msgBg); pv.style.setProperty('--mfg', CONFIG.msgFg);
  }

  function saveFest() {
    const r = C.updateEvent(FEST, readFestForm());
    if (!r.ok) { $('f-err').textContent = r.error; return; }
    if (CONFIG.callMins) CONFIG = Dt.setConfig({ callMins: null });   // un único aviso CALL: el del festival
    if (r.changed) { document.activeElement && document.activeElement.blur(); commitFestival(r.state, 'Datos del evento guardados', { skip: true }); }
    else toast('Sin cambios');
  }

  // ── Escenarios (dentro de Configuración) ─────────────────────────────
  function stagesHtml() {
    const st = FEST.escenarios || [];
    return (st.length ? '' : '<p class="hint" style="margin-bottom:6px">Todavía no hay zonas.</p>') +
      st.map((e, i) => {
        const n = C.stageUse(FEST, e.id);
        return '<div class="stg" data-id="' + esc(e.id) + '">' +
          '<input type="color" data-s="color" value="' + hex6(e.color, '#888888') + '" title="Color de la zona">' +
          '<input type="text" data-s="nombre" value="' + esc(e.nombre) + '" data-orig="' + esc(e.nombre) + '" autocomplete="off">' +

          '<button class="iconsq" data-s="up" title="Subir"' + (i === 0 ? ' disabled' : '') + '><svg class="ic"><use href="#i-up"/></svg></button>' +
          '<button class="iconsq" data-s="down" title="Bajar"' + (i === st.length - 1 ? ' disabled' : '') + '><svg class="ic"><use href="#i-down"/></svg></button>' +
          '<button class="delbtn" data-s="del" title="' + (n ? 'Tiene bandas: muévelas o bórralas antes' : 'Borrar zona') + '"' + (n ? ' disabled' : '') + '><svg class="ic"><use href="#i-trash"/></svg></button>' +
          '<div class="stg-meta"><span class="use">' + n + (n === 1 ? ' entrada' : ' entradas') + '</span>' +
          '<label class="comin" title="Changeover mínimo de esta zona (vacío = el del evento)">Changeover mínimo <input type="number" min="0" max="180" data-s="comin" value="' + (Number.isFinite(e.coMin) ? e.coMin : '') + '" placeholder="' + C.coMinFor({ event: FEST.event, escenarios: [] }, '') + '" data-orig="' + (Number.isFinite(e.coMin) ? e.coMin : '') + '"> min</label></div></div>';
      }).join('') +
      '<div class="stg" style="border:0;margin-top:8px"><input id="s-new" type="text" placeholder="Nueva zona (p. ej. Principal, Carpa, Catering)" autocomplete="off"><button id="s-add" class="btn primary"><svg class="ic"><use href="#i-plus"/></svg>Añadir</button></div>' +
      '<div id="s-err" class="err" style="margin:6px 0 0"></div>' +
      '<p class="hint" style="margin-top:8px">El orden es el de la Pantalla Live. Los cambios se aplican al momento y se pueden deshacer.</p>';
  }

  function stageCommit(r, msg, refocusNew) {
    if (!r.ok) { $('s-err').textContent = r.error; return; }
    if (r.changed === false) return;
    if (document.activeElement && $('cfg-stages').contains(document.activeElement)) document.activeElement.blur();
    commitFestival(r.state, msg);
    if (refocusNew && $('s-new')) $('s-new').focus();
  }

  function bindStages() {
    const body = $('cfg-stages');
    const add = () => stageCommit(C.addStage(FEST, $('s-new').value), 'Zona añadida', true);
    $('s-add').addEventListener('click', add);
    $('s-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    $('s-new').addEventListener('input', () => { $('s-err').textContent = ''; });
    body.querySelectorAll('.stg[data-id]').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-s="color"]').addEventListener('change', e => stageCommit(C.updateStage(FEST, id, { color: e.target.value }), 'Color de la zona cambiado'));
      const nm = row.querySelector('[data-s="nombre"]');
      const saveName = () => { if (nm.value !== nm.dataset.orig) stageCommit(C.updateStage(FEST, id, { nombre: nm.value }), 'Zona renombrada'); };
      nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } else if (e.key === 'Escape') { nm.value = nm.dataset.orig; } });
      nm.addEventListener('change', saveName);
      const cm = row.querySelector('[data-s="comin"]');
      const saveCm = () => { if (cm.value !== cm.dataset.orig) stageCommit(C.updateStage(FEST, id, { coMin: cm.value }), 'Changeover mínimo de la zona: ' + (cm.value === '' ? 'el del evento' : cm.value + ' min')); };
      cm.addEventListener('change', saveCm);
      cm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCm(); } });
      row.querySelector('[data-s="up"]').addEventListener('click', () => stageCommit(C.moveStage(FEST, id, -1), 'Orden cambiado'));
      row.querySelector('[data-s="down"]').addEventListener('click', () => stageCommit(C.moveStage(FEST, id, 1), 'Orden cambiado'));
      row.querySelector('[data-s="del"]').addEventListener('click', () => stageCommit(C.removeStage(FEST, id), 'Zona borrada'));
    });
  }

  // ── Estilos: Panel (preferencia de este equipo) y Pantalla Live (se envía a la Live) ──
  const PS_KEY = 'showtime.panel.style';
  function panelStyle() { try { return Dt.normStyle(JSON.parse(localStorage.getItem(PS_KEY) || '"clasico"')); } catch (e) { return 'clasico'; } }
  function applyPanelStyle(v) {
    v = Dt.normStyle(v);
    if (v === 'clasico') document.body.removeAttribute('data-ps'); else document.body.setAttribute('data-ps', v);
  }
  $('cfg-style-panel').addEventListener('change', e => {
    try { localStorage.setItem(PS_KEY, JSON.stringify(e.target.value)); } catch (err) {}
    applyPanelStyle(e.target.value);
    toast('Estilo del Dashboard: ' + e.target.selectedOptions[0].textContent);
  });
  $('cfg-style-live').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ style: e.target.value });
    toast('Estilo de la Pantalla Live: ' + e.target.selectedOptions[0].textContent);
  });
  applyPanelStyle(panelStyle());
  // Mensajes: colores y duración (se aplican al siguiente mensaje que se envíe)
  $('cfg-msg-bg').addEventListener('input', e => { CONFIG = Dt.setConfig({ msgBg: e.target.value }); fillMsgCfg(); });
  $('cfg-msg-fg').addEventListener('input', e => { CONFIG = Dt.setConfig({ msgFg: e.target.value }); fillMsgCfg(); });
  $('cfg-msg-secs').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ msgSecs: Number(e.target.value) }); fillMsgCfg();
    toast('Duración de los mensajes: ' + e.target.selectedOptions[0].textContent);
  });
  $('cfg-aviso-secs').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ avisoSecs: Number(e.target.value) }); fillMsgCfg();
    toast('Duración de los avisos puntuales: ' + e.target.selectedOptions[0].textContent + ' (los que ya están no cambian)');
  });
  $('cfg-msg-reset').addEventListener('click', () => { CONFIG = Dt.setConfig({ msgBg: '#000000', msgFg: '#ffb347' }); fillMsgCfg(); toast('Colores de los mensajes por defecto'); });

  // Archivo (barra superior)
  $('btn-new').addEventListener('click', () => { closeConfig(); askNew(); });
  $('btn-open').addEventListener('click', () => { closeConfig(); $('file').click(); });

  // ── Herramientas ─────────────────────────────────────────────────────
  document.querySelectorAll('#m-view [data-mode]').forEach(b => b.addEventListener('click', () => {
    CONFIG = Dt.setConfig({ mode: b.dataset.mode }); compute(); renderAll(); closeMenus();
  }));
  $('days').addEventListener('click', e => {
    const b = e.target.closest('button[data-day]'); if (!b) return;
    CONFIG = Dt.setConfig({ day: b.dataset.day }); compute(); renderAll(); closeMenus();
  });

  // ── Menús de la barra (cristal): hover o clic; se cierran al salir el cursor o con Esc ──
  const MENUS = Array.from(document.querySelectorAll('.menus .menu, #m-live'));
  function setMenu(m, on) { m.classList.toggle('open', on); m.querySelector('.mbtn').setAttribute('aria-expanded', String(on)); }
  function closeMenus(except) { MENUS.forEach(m => { if (m !== except) setMenu(m, false); }); }
  MENUS.forEach(m => {
    let tOpen = 0, tClose = 0;
    m.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tClose); tOpen = setTimeout(() => { closeMenus(m); setMenu(m, true); }, 120); });
    m.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tOpen); tClose = setTimeout(() => setMenu(m, false), 350); });
    m.querySelector('.mbtn').addEventListener('click', () => { clearTimeout(tOpen); const on = !m.classList.contains('open'); closeMenus(m); setMenu(m, on); });
    // Las acciones cierran el menú (los toggles de Retrasos no: se marcan varios seguidos)
    m.querySelectorAll('.mitem').forEach(it => it.addEventListener('click', () => setMenu(m, false)));
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.menus, #m-live')) closeMenus(); if (!e.target.closest('.more')) document.querySelectorAll('.more.open').forEach(x => x.classList.remove('open')); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  // ── Retrasos: categorías BLOQUEADAS («Bloquear retraso»). De entrada todo se mueve; lo marcado no. ──
  const CATS = ['show', 'sc', 'tarea', 'hito'];
  const CAT_TXT = { show: 'Shows', sc: 'Soundchecks', tarea: 'Tareas', hito: 'Hitos' };
  const EMPTY_BLOCK = () => ({ show: false, sc: false, tarea: false, hito: false });
  /** Bloqueos de un ámbito: 'all' (todas las zonas), un id de zona o '' (sin zona). */
  function blockOf(scope) { return Object.assign(EMPTY_BLOCK(), ((CONFIG.delayBlock || {})[scope]) || {}); }
  /** ¿Está bloqueada esta categoría en esta zona? (bloqueo global o de la zona) */
  function isBlocked(kind, zoneId) { return !!(blockOf('all')[kind] || blockOf(zoneId || '')[kind]); }
  function curScope() {
    const zs = (FEST && FEST.escenarios) || [];
    return CONFIG.delayZone && (CONFIG.delayZone === 'all' || CONFIG.delayZone === '' || zs.some(z => z.id === CONFIG.delayZone)) ? CONFIG.delayZone : 'all';
  }
  function renderDelayCats() {
    const zv = curScope(), g = blockOf('all'), own = blockOf(zv);
    const eff = k => !!(g[k] || own[k]);
    const all = CATS.every(eff);
    document.querySelectorAll('#delay-cats [data-cat]').forEach(b => {
      const k = b.dataset.cat, on = k === 'all' ? all : eff(k);
      const inh = zv !== 'all' && k !== 'all' && g[k];     // bloqueado para todas las zonas (no se quita desde una zona)
      b.classList.toggle('on', on); b.classList.toggle('inh', !!inh); b.setAttribute('aria-pressed', String(on));
      b.title = inh ? 'Bloqueado para todas las zonas: quítalo con «Todas las zonas»' : '';
    });
    const any = Object.keys(CONFIG.delayBlock || {}).some(sc => CATS.some(k => (CONFIG.delayBlock[sc] || {})[k]));
    $('delay-on').hidden = !any;
    const zs = (FEST && FEST.escenarios) || [];
    const hasNoZone = !!(FEST && FEST.artists.some(a => !a.escenarioId));
    const mark = sc => CATS.some(k => blockOf(sc)[k]) ? ' ·  bloqueos' : '';
    const zh = '<option value="all">Todas las zonas (global)' + mark('all') + '</option>' + zs.map(z => '<option value="' + esc(z.id) + '">' + esc(z.nombre) + mark(z.id) + '</option>').join('') +
      (hasNoZone ? '<option value="">Sin zona' + mark('') + '</option>' : '');
    if ($('delay-zone').innerHTML !== zh) $('delay-zone').innerHTML = zh;
    $('delay-zone').value = zv;
    $('m-delay').querySelector('.mbtn').title = any ? 'Hay categorías bloqueadas para los retrasos' : 'Todo se mueve con los retrasos (nada bloqueado)';
  }
  $('delay-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    const zv = curScope(), g = blockOf('all'), c = blockOf(zv);
    if (b.classList.contains('inh')) { toast('Bloqueado para todas las zonas: quítalo eligiendo «Todas las zonas»', true); return; }
    if (b.dataset.cat === 'all') { const v = !CATS.every(k => c[k] || (zv !== 'all' && g[k])); CATS.forEach(k => { if (!(zv !== 'all' && g[k])) c[k] = v; }); }
    else c[b.dataset.cat] = !c[b.dataset.cat];
    const blk = Object.assign({}, CONFIG.delayBlock || {}); blk[zv] = c;
    CONFIG = Dt.setConfig({ delayBlock: blk });
    if (FEST) { FEST = M.withBlk(FEST, CONFIG); Dt.setFestival(FEST); compute(); }   // el estimado respeta los bloqueos al momento
    renderDelayCats();
    renderTable();                         // los LED de la tabla reflejan el bloqueo
  });
  $('btn-delay').addEventListener('click', openDelayWindow);
  $('delay-zone').addEventListener('change', e => { CONFIG = Dt.setConfig({ delayZone: e.target.value }); renderDelayCats(); });

  // ── Ventana de retraso (nivel 2): minutos, ámbito, categorías y vista previa antes de aplicar ──
  function openDelayWindow() {
    if (!FEST) { toast('Primero crea o abre un evento', true); return; }
    closeMenus(); closeConfig();
    const zones = FEST.escenarios || [];
    const hasNoZone = FEST.artists.some(a => !a.escenarioId);
    const ZK = zones.map(z => z.id).concat(hasNoZone ? [''] : []);
    const z0 = CONFIG.delayZone && CONFIG.delayZone !== 'all' && zones.some(z => z.id === CONFIG.delayZone) ? [CONFIG.delayZone] : ZK.slice();
    // Jornada: la que se está viendo; si no, la de ahora si le queda algo; si no, la primera con algo pendiente
    const nowI = Math.floor(C.nowAbs());
    const pend = d => C.buildBlocks(FEST, { mode: 'all', day: d }).some(b => b.psi !== null && b.psi >= nowI);
    const jors = jornadaOptions();
    const jNow = C.jornadaOfAbs(FEST, nowI);
    const j0 = CONFIG.day !== 'all' ? CONFIG.day : pend(jNow) ? jNow : (jors.find(pend) || jNow);
    const W = { mins: 5, zones: z0, block: EMPTY_BLOCK(), day: j0, from: j0 === jNow ? C.fmtHM(nowI) : '' };
    const html = '<div class="dw">' +
      '<div class="dw-row"><span class="dw-l">Minutos</span><div class="dw-mins">' + [5, 10, 15].map(m => '<button class="dtb" data-m="' + m + '">+' + m + '</button>').join('') +
        '<label class="dw-n">+ <input id="dw-n" type="number" min="1" max="600" value="5"> min</label></div></div>' +
      '<div class="dw-row"><span class="dw-l">Zonas</span><div class="dtog" id="dw-zones"><button data-z="*">Todas</button>' + zones.map(z => '<button data-z="' + esc(z.id) + '">' + esc(z.nombre) + '</button>').join('') + (hasNoZone ? '<button data-z="">Sin zona</button>' : '') + '</div></div>' +
      '<div class="dw-row"><span class="dw-l">Jornada</span>' + jornadaSelect(W.day, 'id="dw-day"') + '<span class="dw-l" style="width:auto;margin-left:8px">desde</span><input id="dw-from" type="text" value="' + W.from + '" placeholder="inicio" style="width:80px"><span class="hint">vacío = toda la jornada · solo lo que aún no ha empezado</span></div>' +
      '<div class="dw-row"><span class="dw-l">Bloquear</span><span class="hint dw-hint">además de lo que ya está en rojo</span></div><div class="dw-row"><span class="dw-l"></span><div class="dtog block" id="dw-cats">' + ['all', 'show', 'sc', 'tarea', 'hito'].map(k => '<button data-cat="' + k + '">' + ({ all: 'Todos', show: 'Shows', sc: 'Soundchecks', tarea: 'Tareas', hito: 'Hitos' })[k] + '</button>').join('') + '</div></div>' +
      dwOverHtml(W.day, ZK) +
      '<div id="dw-prev" class="dw-prev"></div></div>';
    modal('Aplicar retraso en cascada', html, [{ label: 'Cancelar' }, { label: 'Aplicar retraso en cascada', kind: 'primary', run: () => {
      const r = dwCompute(W);
      if (!r || !r.moved.length) { toast('No hay nada que mover con esa selección', true); return false; }
      const zl = W.zones.length === ZK.length ? 'todas las zonas' : W.zones.map(z => z ? (C.getEscenario(FEST, z) || {}).nombre : 'sin zona').join(', ');
      const dmsg = 'Retraso +' + W.mins + ' min (' + zl + (W.from ? ', desde ' + C.normHM(W.from) : '') + '): ' + nEnt(r.moved.length, 'movida') + (r.kept.length ? ' · ' + keptTxt(r.kept.length) : '');
      commitFestival(r.state, dmsg, { noTimes: true, ev: [{ type: 'delay', text: dmsg, jors: [W.day], amber: true }] });
    } }], { wide: true });
    const box = $('modal-body');
    const paint = () => {
      box.querySelectorAll('.dtb').forEach(b => b.classList.toggle('on', +b.dataset.m === W.mins));
      const all = CATS.every(k => W.block[k]);
      box.querySelectorAll('#dw-cats [data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === 'all' ? all : !!W.block[b.dataset.cat]));
      box.querySelectorAll('#dw-zones [data-z]').forEach(b => b.classList.toggle('on', b.dataset.z === '*' ? W.zones.length === ZK.length : W.zones.indexOf(b.dataset.z) >= 0));
      const r = dwCompute(W);
      const prev = box.querySelector('#dw-prev');
      if (!r) { if (prev) prev.innerHTML = '<p class="err">Elige la jornada y una hora «desde» válida (HH:MM) o déjala vacía.</p>'; $('modal-actions').querySelector('.primary').disabled = true; return; }
      const rows = r.moved.map(m => '<tr><td>' + esc(m.name) + '</td><td class="dim">' + esc(m.stage || '—') + '</td><td class="dim">' + ({ show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Hito' })[m.kind] + '</td><td class="t">' + C.fmtHM(m.from) + '</td><td class="t to">' + C.fmtHM(m.to) + '</td></tr>').join('') +
        r.kept.map(k => '<tr class="kept"><td><span class="led red sm"></span>' + esc(k.name) + '</td><td class="dim">' + esc(k.stage || '—') + '</td><td class="dim">' + ({ show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Hito' })[k.kind] + '</td><td class="t">' + C.fmtHM(k.at) + '</td><td class="t">no se mueve</td></tr>').join('');
      if (prev) prev.innerHTML = (r.clashes.length ? '<div class="errbox"><svg class="ic"><use href="#i-alert"/></svg>' + r.clashes.map(c => esc(c.name) + ' choca con «' + esc(c.with) + '» (' + C.fmtHM(c.at) + ', DELAY rojo)').join('<br>') + '</div>' : '') +
        (rows ? '<table class="dw-t"><thead><tr><th>Entrada</th><th>Zona</th><th>Tipo</th><th>Antes</th><th>Después</th></tr></thead><tbody>' + rows + '</tbody></table>'
              : '<p class="hint">' + (!W.zones.length ? 'Marca qué zonas se retrasan.' : CATS.every(k => W.block[k]) ? 'Todas las categorías están bloqueadas.' : 'No hay entradas pendientes con esa selección.') + '</p>');
      $('modal-actions').querySelector('.primary').disabled = !r.moved.length;
      $('modal-actions').querySelector('.primary').textContent = r.moved.length ? 'Aplicar retraso en cascada (' + r.moved.length + ')' : 'Aplicar retraso en cascada';
    };
    box.querySelectorAll('.dtb').forEach(b => b.addEventListener('click', () => { W.mins = +b.dataset.m; $('dw-n').value = W.mins; paint(); }));
    $('dw-n').addEventListener('input', e => { const v = Math.round(+e.target.value); if (v >= 1 && v <= 600) { W.mins = v; paint(); } });
    $('dw-zones').addEventListener('click', e => {
      const b = e.target.closest('[data-z]'); if (!b) return;
      const z = b.dataset.z;
      if (z === '*') W.zones = W.zones.length === ZK.length ? [] : ZK.slice();
      else W.zones = W.zones.indexOf(z) >= 0 ? W.zones.filter(x => x !== z) : W.zones.concat([z]);
      paint();
    });
    $('dw-from').addEventListener('change', e => { W.from = e.target.value; paint(); });
    // Desbordes del día: aplicar los mismos minutos a otras zonas
    box.querySelectorAll('[data-over]').forEach(b => b.addEventListener('click', () => {
      W.mins = +b.dataset.over; $('dw-n').value = W.mins;
      W.zones = ZK.filter(z => z !== b.dataset.zone);
      if (W.day === C.jornadaOfAbs(FEST, logNow())) { W.from = C.fmtHM(logNow()); $('dw-from').value = W.from; }
      paint();
      toast('Desborde de ' + b.dataset.who + ': +' + W.mins + ' min a las demás zonas · revisa y aplica');
    }));
    $('dw-day').addEventListener('change', e => { W.day = e.target.value; paint(); });
    $('dw-cats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      if (b.dataset.cat === 'all') { const v = !CATS.every(k => W.block[k]); CATS.forEach(k => { W.block[k] = v; }); } else W.block[b.dataset.cat] = !W.block[b.dataset.cat];
      paint();
    });
    paint();
  }
  /** Desbordes de la jornada (bandas con Alargar que se pasaron del colchón): ya están en su zona; desde aquí, a otras. */
  function dwOverHtml(day, ZK) {
    const list = C.buildBlocks(FEST, { mode: 'all', day: day }).filter(b => C.isBand(b) && b.push > 0);
    if (!list.length) return '';
    return '<div class="dw-row top"><span class="dw-l">Desbordes</span><div class="dw-over">' + list.map(b =>
      '<div class="dwo"><span><b>' + esc(b.pushFrom) + '</b> · +' + b.push + ' min en ' + esc(b.stage || 'Sin zona') + ' <span class="hint">(ya aplicado en su zona)</span></span>' +
      (ZK.length > 1 ? '<button type="button" class="btn" data-over="' + b.push + '" data-zone="' + esc(b.stageId || '') + '" data-who="' + esc(b.pushFrom) + '">Aplicar a otras zonas</button>' : '') + '</div>').join('') + '</div></div>';
  }
  /** Calcula el retraso de la ventana (sin aplicarlo). «Desde» se toma en la jornada actual. */
  function dwCompute(W) {
    if (C.dayIndex(W.day) === null) return null;
    const hm = C.normHM(W.from); if (hm === null) return null;
    const jor = W.day;
    const from = hm ? C.toAbs(C.fechaFor(FEST, jor, hm), hm) : C.toAbs(jor, C.fmtHM(C.cutoffMins(FEST)));   // vacío: desde el inicio de la jornada
    // Bloqueos: los del menú Retrasos (por zona) + los que se marquen aquí solo para este retraso
    const cats = b => !W.block[b.kind] && !isBlocked(b.kind, b.stageId || '');
    void cats;
    return C.addRetraso(FEST, { minutes: W.mins, zone: W.zones, blocked: CONFIG.delayBlock || {}, extra: W.block, fromAbs: from, day: jor, at: logNow(), src: 'panel' });
  }
  $('btn-undo').addEventListener('click', undo);
  $('btn-new2').addEventListener('click', askNew);

  // ── Pantallas Live (ventanas): Manager · Confidence por zona · Backstage (2e-A) ──
  function liveName(vista, zona) { return 'showtime-live-' + vista + (vista === 'confidence' ? '-' + (zona || 'sinzona') : ''); }
  /** Zonas para Confidence: las del evento y «Sin zona» si hay bandas sin zona. */
  function renderLiveMenu() {
    const box = $('lv-zones'); if (!box) return;
    if (!FEST) { box.innerHTML = '<p class="mnote">Sin evento cargado.</p>'; return; }
    const zs = (FEST.escenarios || []).map(z => ({ id: z.id, name: z.nombre, color: z.color }));
    if (C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) zs.push({ id: '', name: 'Sin zona', color: '#888' });
    const h = zs.map(z => '<button class="mitem lvz" data-vista="confidence" data-zona="' + esc(z.id) + '"><i style="background:' + esc(safeColor(z.color, '#888')) + '"></i>' + esc(z.name) +
      '<span class="lvon" data-on="' + esc(liveName('confidence', z.id)) + '"></span>' +
      '<span class="lvx" role="button" data-close="' + esc(liveName('confidence', z.id)) + '" title="Cerrar esta ventana Live" hidden><svg class="ic"><use href="#i-x"/></svg></span></button>').join('');
    if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
  }
  /** Abre (o trae al frente) una Pantalla Live. Con un segundo monitor (Chrome/Edge/Brave), se abre en él. */
  async function openLive(vista, zona) {
    const v = Vs.normVista(vista), name = liveName(v, zona);
    const w0 = LIVES.get(name);
    if (w0 && !w0.closed) { try { w0.focus(); } catch (e) {} return; }
    let url = Vs.liveUrl('', v, v === 'confidence' ? (zona || '') : null), feats = 'popup=yes,width=1280,height=720', target = null;
    if ('getScreenDetails' in window) {
      try { const sd = await window.getScreenDetails(); target = Vs.pickScreen(sd.screens, sd.currentScreen); } catch (e) { target = null; }
      if (target) { feats = 'popup=yes,left=' + target.availLeft + ',top=' + target.availTop + ',width=' + target.availWidth + ',height=' + target.availHeight; url += '&aviso=f'; }
    } else url += '&aviso=arrastra';
    const label = Vs.VISTA_TXT[v] + (v === 'confidence' ? ' · ' + ((C.getEscenario(FEST, zona) || {}).nombre || 'Sin zona') : '');
    const done = w => {
      LIVES.set(name, w); Dt.addPeer(w); tick();
      toast(target ? 'Live ' + label + ' abierta en el monitor ' + (target.label || 'externo') + ' · pulsa F en ella para pantalla completa'
        : 'Live ' + label + ' abierta' + (url.indexOf('aviso=arrastra') > 0 ? ': arrástrala al monitor y pulsa F (este navegador no puede llevarla solo)' : ''));
    };
    const w = window.open(url, name, feats);
    if (w) { done(w); return; }
    // El permiso de pantallas pudo gastar el «clic»: un segundo clic la abre
    modal('Abrir la Pantalla Live', '<p>' + (target ? 'Listo para abrirla en el monitor <b>' + esc(target.label || 'externo') + '</b>.' : 'El navegador ha frenado la ventana.') + ' Pulsa «Abrir». Si no sale, permite las ventanas emergentes para Showtime (icono en la barra de direcciones).</p>', [
      { label: 'Cancelar' },
      { label: 'Abrir', kind: 'primary', run: () => { const w2 = window.open(url, name, feats); if (w2) done(w2); else toast('Ventana emergente bloqueada', true); } }
    ]);
  }
  /** Cierra una ventana Live (o todas) desde aquí, esté en el monitor que esté. */
  function closeLive(name) {
    const names = name ? [name] : Array.from(LIVES.keys());
    names.forEach(n => {
      const w = LIVES.get(n);
      try { if (w && !w.closed) w.postMessage({ app: 'showtime', type: 'closeLive' }, '*'); } catch (e) {}
      try { if (w && !w.closed) w.close(); } catch (e) {}
      LIVES.delete(n);
    });
    tick();
    toast(name ? 'Pantalla Live cerrada' : 'Pantallas Live cerradas');
  }
  // ── Standby / Modo Cartel: las Live abiertas desde aquí enseñan el cartel de Showtime y la hora ──
  const STB = new Map();   // nombre de la ventana → ¿en Standby? (lo confirma cada Live)
  function openLives() { return Array.from(LIVES.entries()).filter(([, w]) => w && !w.closed); }
  function standbyOn() { return openLives().some(([n]) => STB.get(n)); }
  function setStandby(on) {
    const open = openLives();
    if (!open.length) { toast('No hay ninguna Pantalla Live abierta: ábrela primero (Live ▾)', true); return; }
    open.forEach(([n, w]) => { try { w.postMessage({ app: 'showtime', type: 'standby', on: !!on }, '*'); } catch (e) {} STB.set(n, !!on); });
    tick();
    toast(on ? 'Standby: ' + (open.length === 1 ? 'la Pantalla Live muestra' : 'las ' + open.length + ' Pantallas Live muestran') + ' el cartel y la hora' : 'Standby quitado: las Pantallas Live vuelven a su vista');
  }
  // Cada Live avisa de su estado (también si el Standby se pone o se quita en ella, con la tecla S)
  window.addEventListener('message', e => {
    const m = e.data; if (!m || m.app !== 'showtime' || m.type !== 'standbyState') return;
    for (const [n, w] of LIVES) if (w === e.source) STB.set(n, !!m.on);
    tick();
  });
  document.addEventListener('click', e => {
    if (e.target.closest('#lv-standby')) { e.preventDefault(); e.stopPropagation(); closeMenus(); setStandby(!standbyOn()); return; }
    const x = e.target.closest('#m-live [data-close]');
    if (x) { e.preventDefault(); e.stopPropagation(); closeLive(x.dataset.close); return; }
    if (e.target.closest('#lv-closeall')) { closeLive(null); return; }
    const it = e.target.closest('#m-live [data-vista]'); if (!it) return;
    openLive(it.dataset.vista, it.dataset.zona);
  }, true);
  // Las Live que se abrieron antes de recargar el Dashboard se vuelven a presentar solas: se recuperan para el estado y la sincronización.
  let peerN = 0;
  if (Dt.onPeer) Dt.onPeer((w, m) => { let n = m && typeof m.name === 'string' ? m.name : ''; if (!n) { try { n = w.name; } catch (e) {} } LIVES.set(n || 'peer-' + (++peerN), w); tick(); });

  // ── Abrir / Exportar ─────────────────────────────────────────────────
  function readFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => askImport(String(fr.result || ''), file.name);
    fr.onerror = () => toast('No se pudo leer el archivo', true);
    fr.readAsText(file);
  }

  function askImport(text, fname) {
    const r = C.validateProject(text);
    if (!r.ok) {
      modal('No se puede abrir', '<div class="errbox">' + r.errors.map(esc).join('<br>') + '</div><p style="margin-top:10px">Archivo: ' + esc(fname) + '</p>', [{ label: 'Cerrar', kind: 'primary' }]);
      return;
    }
    const s = r.state, ev = s.event || {};
    // Sin evento abierto y archivo limpio: se abre directamente (no hay nada que perder ni que avisar)
    if (!FEST && !r.warnings.length) { loadNew(s, 'Evento abierto: ' + (ev.nombre || fname)); return; }
    const dShow = C.festivalDays(s, 'show'), dSc = C.festivalDays(s, 'sc');
    const nT = s.artists.filter(a => C.tipoOf(a) === 'tarea').length, nH = s.artists.filter(a => C.tipoOf(a) === 'hito').length;
    let html = '<p>Archivo: <b>' + esc(fname) + '</b></p><ul>' +
      '<li>Evento: <b>' + esc(ev.nombre || 'sin nombre') + '</b></li>' +
      '<li>' + (s.artists.length - nT - nH) + ' bandas · ' + (nT ? nT + ' tareas · ' : '') + (nH ? nH + ' hitos · ' : '') + s.escenarios.length + ' zonas</li>' +
      '<li>Shows: ' + (dShow.length ? dShow.map(fmtDay).map(esc).join(', ') : 'ninguno') + '</li>' +
      '<li>Soundchecks: ' + (dSc.length ? dSc.map(fmtDay).map(esc).join(', ') : 'ninguno') + '</li>' +
      '<li>Hora de corte: ' + esc(ev.dayCutoff || C.DEFAULT_CUTOFF) + ' · aviso CALL: ' + esc(ev.callMins || C.DEFAULT_CALL_MINS) + ' min</li></ul>';
    if (r.warnings.length) html += '<p style="margin-top:10px"><b>Avisos del archivo:</b></p><ul>' + r.warnings.slice(0, 12).map(w => '<li>' + esc(w) + '</li>').join('') + (r.warnings.length > 12 ? '<li>… y ' + (r.warnings.length - 12) + ' más</li>' : '') + '</ul>';
    html += '<p style="margin-top:10px">Al abrirlo, la jornada queda en <b>Todas</b>: elige la que quieras arriba.</p>';
    const n = FEST && ORIG ? C.diffSummary(ORIG, FEST).total : 0;
    const acts = [{ label: 'Cancelar' }];
    if (n) {
      html += '<div class="warnbox">' + (n === 1 ? 'Tienes 1 cambio sin exportar que se perderá. Exporta antes si lo quieres guardar.' : 'Tienes ' + n + ' cambios sin exportar que se perderán. Exporta antes si los quieres guardar.') + '</div>';
      acts.push({ label: 'Exportar los cambios', run: () => { exportJSON(); setTimeout(() => askImport(text, fname), 300); } });
      acts.push({ label: 'Abrir y perder cambios', kind: 'danger', run: () => loadNew(s, 'Evento abierto: ' + (ev.nombre || '')) });
    } else acts.push({ label: 'Abrir evento', kind: 'primary', run: () => loadNew(s, 'Evento abierto: ' + (ev.nombre || '')) });
    modal('Abrir evento', html, acts);
  }

  /** Sustituye el festival activo (abrir, crear o demo). Es la nueva referencia de «cambios sin exportar». */
  function loadNew(state, msg) {
    // Log del evento: el que venga dentro del archivo; si es el mismo evento que el abierto, sigue el que va más lleno;
    // si es otro evento, se empieza uno nuevo (el anterior queda como copia en este navegador).
    const fromFile = Lg && state.showtimeLog ? Lg.norm(state.showtimeLog) : null;
    delete state.showtimeLog;
    if (Lg) {
      const k = Lg.eventKey(state), same = !!(LOG && LOG.ev === k);
      if (fromFile && !(same && LOG.entries.length > fromFile.entries.length)) { if (!same) logArchive(); LOG = Object.assign(fromFile, { ev: k }); }
      else if (!same) { logArchive(); LOG = Lg.empty(state); }
      logSave();
    }
    FEST = state; ORIG = JSON.parse(JSON.stringify(state));
    UNDO.length = 0;
    Dt.setOriginal(ORIG);
    Dt.setFestival(FEST);
    CONFIG = Dt.setConfig({ day: 'all' });
    $('add-escenario').value = ''; if ($('add-jornada')) $('add-jornada').value = '';
    compute(); renderAll();
    toast(msg);
  }

  function exportJSON() {
    if (!FEST) return;
    const d = new Date();
    const slug = String((FEST.event && FEST.event.nombre) || 'evento').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';
    const name = slug + '-showtime-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
    const blob = new Blob([JSON.stringify(Lg && LOG ? Object.assign({}, FEST, { showtimeLog: LOG }) : FEST, null, 2)], { type: 'application/json' });   // con el log del evento
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    // Lo exportado pasa a ser la referencia: los cambios ya están guardados en ese archivo.
    ORIG = JSON.parse(JSON.stringify(FEST)); Dt.setOriginal(ORIG);
    renderAll();
    toast('Exportado: ' + name);
  }

  // ── Archivo › Exportar log del evento… (PDF por la impresión del navegador · TXT · CSV) ──
  const LX = { day: null, cats: { show: true, sc: true, tarea: true, hito: true, inc: true }, fmt: 'pdf' };
  function slugOf(st) { return String((st && st.event && st.event.nombre) || 'evento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento'; }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /** Abre el informe en una ventana y lanza la impresión («Guardar como PDF»). Si el navegador frena la ventana, va por un marco oculto. */
  function printReport(html) {
    const w = window.open('', 'showtime-log', 'popup=yes,width=1040,height=820');
    if (w) {
      w.document.open(); w.document.write(html); w.document.close();
      try { w.focus(); } catch (e) {}
      setTimeout(() => { try { w.print(); } catch (e) {} }, 350);
      return;
    }
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('No se pudo abrir la impresión', true); } setTimeout(() => f.remove(), 60000); }, 350);
  }
  function openLogExport() {
    if (!FEST || !Lg) { toast('Primero crea o abre un evento', true); return; }
    closeMenus(); closeConfig();
    logFoto();
    const days = Lg.reportDays(LOG, FEST), jNow = C.jornadaOfAbs(FEST, logNow());
    if (!LX.day || (LX.day !== 'all' && days.indexOf(LX.day) < 0)) LX.day = days.indexOf(jNow) >= 0 ? jNow : CONFIG.day !== 'all' && days.indexOf(CONFIG.day) >= 0 ? CONFIG.day : (days[0] || 'all');
    const CK = [['show', 'Shows'], ['sc', 'Soundchecks'], ['tarea', 'Tareas'], ['hito', 'Hitos / Eventos'], ['inc', 'Incidencias']];
    const html = '<div class="dw lx">' +
      '<div class="dw-row"><span class="dw-l">Jornada</span><select id="lx-day">' + days.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + (d === jNow ? ' · hoy' : '') + '</option>').join('') + '<option value="all">Todo el evento</option></select></div>' +
      '<div class="dw-row top"><span class="dw-l">Incluir</span><div class="dtog" id="lx-cats"><button type="button" data-c="all">Todos los tipos</button>' + CK.map(([k, t]) => '<button type="button" data-c="' + k + '">' + t + '</button>').join('') + '</div></div>' +
      '<div class="dw-row"><span class="dw-l"></span><span class="hint lx-hint">Incidencias: retrasos, horas reales que se salen del horario, mensajes a las pantallas, avisos del tiempo y su «Visto», altas, cambios y borrados.</span></div>' +
      '<div class="dw-row"><span class="dw-l">Formato</span><div class="dtog radio" id="lx-fmt"><button type="button" data-f="pdf">PDF</button><button type="button" data-f="txt">TXT</button><button type="button" data-f="csv">CSV</button></div></div>' +
      '<div class="dw-row"><span class="dw-l"></span><span class="hint" id="lx-fhint"></span></div>' +
      '<div id="lx-sum" class="lx-sum"></div></div>';
    modal('Exportar log del evento', html, [{ label: 'Cancelar' }, { label: 'Exportar', kind: 'primary', run: () => {
      const rep = Lg.report(LOG, FEST, { day: LX.day, cats: LX.cats, nowMs: Date.now() });
      if (!rep.sections.some(x => x.rows.length)) { toast('No hay nada que exportar con esos filtros', true); return false; }
      const d = new Date(), stamp = pad2(d.getHours()) + pad2(d.getMinutes());
      const base = slugOf(FEST) + '-log-' + (LX.day === 'all' ? 'evento' : LX.day) + '-' + stamp;
      if (LX.fmt === 'pdf') { printReport(Lg.toHtml(rep)); toast('Informe listo: en la impresión, elige «Guardar como PDF»'); }
      else if (LX.fmt === 'txt') { download(base + '.txt', Lg.toTxt(rep), 'text/plain;charset=utf-8'); toast('Exportado: ' + base + '.txt'); }
      else { download(base + '.csv', Lg.toCsv(rep), 'text/csv;charset=utf-8'); toast('Exportado: ' + base + '.csv'); }
    } }], { wide: true });
    const box = $('modal-body');
    const FH = { pdf: 'Se abre el informe y la ventana de impresión: elige «Guardar como PDF». Sin librerías y sin internet.', txt: 'Texto plano, para leer en cualquier sitio o pegar en un correo.', csv: 'Tabla para Excel o Numbers (separada por «;»).' };
    const paint = () => {
      $('lx-day').value = LX.day;
      const all = CK.every(([k]) => LX.cats[k]);
      box.querySelectorAll('#lx-cats [data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === 'all' ? all : !!LX.cats[b.dataset.c]));
      box.querySelectorAll('#lx-fmt [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === LX.fmt));
      $('lx-fhint').textContent = FH[LX.fmt];
      const rep = Lg.report(LOG, FEST, { day: LX.day, cats: LX.cats });
      const st = rep.sections.reduce((a, x) => { Object.keys(x.stats).forEach(k => { a[k] = (a[k] || 0) + x.stats[k]; }); return a; }, {});
      const sec = rep.sections[0];
      $('lx-sum').innerHTML = rep.sections.length && rep.sections.some(x => x.rows.length)
        ? '<b>' + (st.plan || 0) + '</b> previstas · <b class="' + (st.chg ? 'chg' : '') + '">' + (st.chg || 0) + '</b> con hora cambiada · <b class="' + (st.del ? 'chg' : '') + '">' + (st.del || 0) + '</b> borradas o movidas · <b class="' + (st.add ? 'chg' : '') + '">' + (st.add || 0) + '</b> añadidas · <b class="' + (st.inc ? 'chg' : '') + '">' + (st.inc || 0) + '</b> incidencias' +
          (LX.day !== 'all' && sec ? '<div class="hint">' + (sec.foto ? 'Previsto: el horario tal como estaba a las ' + C.fmtHM(sec.fotoAt) + ' (foto de la jornada).' : 'Esta jornada aún no tiene foto: lo previsto es el horario actual.') + '</div>' : '')
        : '<span class="hint">Nada que exportar con estos filtros.</span>';
      $('modal-actions').querySelector('.primary').disabled = !CK.some(([k]) => LX.cats[k]);
    };
    $('lx-day').addEventListener('change', e => { LX.day = e.target.value; paint(); });
    $('lx-cats').addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (b.dataset.c === 'all') { const v = !CK.every(([k]) => LX.cats[k]); CK.forEach(([k]) => { LX.cats[k] = v; }); }
      else LX.cats[b.dataset.c] = !LX.cats[b.dataset.c];
      paint();
    });
    $('lx-fmt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; LX.fmt = b.dataset.f; paint(); });
    paint();
  }
  $('btn-log').addEventListener('click', openLogExport);

  $('btn-import2').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
  $('btn-export').addEventListener('click', exportJSON);
  function askDemo() {
    modal('Evento de demostración', '<p>Carga un evento de ejemplo con horarios alrededor de la hora actual, para probar el Dashboard y la Pantalla Live.</p>',
      [{ label: 'Cancelar' }, { label: 'Cargar demo', kind: 'primary', run: () => loadNew(C.demoFestival(Math.floor(C.nowAbs())), 'Demo cargada') }]);
  }
  $('btn-demo').addEventListener('click', askDemo);
  // Tarjeta «Importar horario en 1 segundo» (sin evento o sin entradas)
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-ob]'); if (!b) return;
    const a = b.dataset.ob;
    if (a === 'paste') openImport('');
    else if (a === 'file') $('ob-file').click();
    else if (a === 'manual') openAdd();
  });
  $('ob-file').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });

  // Arrastrar y soltar en cualquier parte del Panel: .json → abrir evento; .csv/.tsv → Pegar horario
  let dragN = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) { dragN++; $('drop').hidden = false; } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); dragN = 0; $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleFile(f);
  });

  // ⌘V fuera de una casilla: abre «Pegar horario» con lo copiado (texto) o con el archivo copiado (p. ej. desde el Finder).
  // Con un modal, el panel de Configuración o un menú abiertos no hace nada (cada uno pega donde toca).
  function pasteShortcutOk(t) {
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
    if (!$('modal').hidden || !$('addm').hidden || !$('imp').hidden || !$('cfg').hidden) return false;
    if (document.querySelector('.menu.open')) return false;
    return true;
  }
  document.addEventListener('paste', e => {
    if (!pasteShortcutOk(e.target)) return;
    const cd = e.clipboardData, f = cd && cd.files && cd.files[0];
    e.preventDefault();
    if (f) { handleFile(f); return; }
    openImport(cd ? cd.getData('text/plain') : '');
  });

  // ── Pegar horario (ESPEC-2c A) ─────────────────────────────────────────
  // Todo lo que se lee se PROPONE en la vista previa; solo entra lo que el regidor deja marcado.
  const I = window.ShowtimeImport;
  let IMP = null;
  let impTimer = 0;

  /** notice: aviso arriba de la caja (p. ej. cómo pegar un PDF). Sin evento abierto se importa a un evento nuevo (IMP.fresh). */
  function openImport(text, notice) {
    closeConfig();
    if (!$('addm').hidden) closeAdd();
    // Por defecto, visibles y cambiables: la jornada que se está viendo (o la única del evento) y el único escenario si solo hay uno
    const days = FEST ? C.eventDays(FEST) : [], stg = FEST ? FEST.escenarios || [] : [];
    IMP = { text: text || '', mode: CONFIG.mode === 'sc' ? 'sc' : 'show', fresh: !FEST, base: FEST, jorTouched: false,
      defJor: FEST && CONFIG.day !== 'all' ? CONFIG.day : days.length === 1 ? days[0] : '', defEsc: stg.length === 1 ? stg[0].nombre : '',
      header: undefined, map: null, create: {}, extend: true, include: {}, edits: {}, read: null, pv: null };
    $('imp-notice').hidden = !notice; $('imp-notice').textContent = notice || '';
    setAddTabs('paste');
    $('imp-text').value = IMP.text;
    $('imp').hidden = false;
    impRecompute();
    $('imp-text').focus();
  }
  /** Zona por defecto escrita: { id } si ya existe (sin mirar mayúsculas ni acentos) o { name } si es nueva. */
  function impDefZone() {
    const v = String(IMP.defEsc || '').trim();
    if (!v) return { id: '', name: '' };
    const st = (IMP.base.escenarios || []).find(e => I.norm(e.nombre) === I.norm(v));
    return st ? { id: st.id, name: '' } : { id: '', name: v };
  }
  function closeImport() { $('imp').hidden = true; IMP = null; }

  function impResetRows() { IMP.include = {}; IMP.edits = {}; }

  function impRecompute() {
    if (!IMP) return;
    const forced = {};
    if (IMP.header !== undefined) forced.header = IMP.header;
    if (IMP.map) forced.map = IMP.map;
    if (IMP.fresh) {     // sin evento: uno provisional con las jornadas del horario (no se guarda hasta «Importar»)
      IMP.base = I.provisionalState(IMP.text, Math.floor(C.nowAbs()), forced);
      const days = C.eventDays(IMP.base);
      if (!IMP.jorTouched || days.indexOf(IMP.defJor) < 0) IMP.defJor = days.length === 1 ? days[0] : '';
    }
    const ctx = I.contextOf(IMP.base);
    let rd = I.read(IMP.text, ctx, forced);
    if (rd.kind === 'tabla' && IMP.map && rd.rows && IMP.map.length !== Math.max.apply(null, rd.rows.map(r => r.length))) {
      IMP.map = null; rd = I.read(IMP.text, ctx, IMP.header !== undefined ? { header: IMP.header } : {});
    }
    IMP.read = rd;
    const dz = impDefZone();
    IMP.pv = I.preview(IMP.base, rd.records, { mode: IMP.mode, ctx: ctx, defaultJornada: IMP.defJor, defaultStageId: dz.id, defaultStageName: dz.name,
      createStages: IMP.create, include: IMP.include, edits: IMP.edits });
    impRender();
  }

  function impRender() {
    const rd = IMP.read, pv = IMP.pv;
    // Origen detectado
    $('imp-kind').textContent = rd.kind === 'tabla' ? 'Tabla · ' + Math.max.apply(null, rd.rows.map(r => r.length)) + ' columnas · ' + ({ '\t': 'tabuladores', ';': 'punto y coma', ',': 'comas' }[rd.sep]) + ' · ' + rd.records.length + (rd.records.length === 1 ? ' fila' : ' filas')
      : rd.kind === 'texto' ? 'Texto libre · ' + rd.records.length + (rd.records.length === 1 ? ' línea con hora' : ' líneas con hora') : 'Esperando horario…';
    // Opciones
    document.querySelectorAll('#imp [data-imode]').forEach(b => b.classList.toggle('on', b.dataset.imode === IMP.mode));
    const jor = IMP.fresh ? C.eventDays(IMP.base) : jornadaOptions();
    $('imp-jor').innerHTML = '<option value="">— ninguna —</option>' + jor.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + '</option>').join('');
    $('imp-jor').value = IMP.defJor;
    const zl = (IMP.base.escenarios || []).map(e => '<option value="' + esc(e.nombre) + '"></option>').join('');
    if ($('imp-zones-dl').innerHTML !== zl) $('imp-zones-dl').innerHTML = zl;
    if (document.activeElement !== $('imp-esc') && $('imp-esc').value !== IMP.defEsc) $('imp-esc').value = IMP.defEsc;
    $('imp-head-l').hidden = rd.kind !== 'tabla';
    $('imp-head').checked = !!rd.hasHeader;
    // Mapeo de columnas (tablas)
    if (rd.kind === 'tabla') {
      const n = Math.max.apply(null, rd.rows.map(r => r.length));
      const data = rd.hasHeader ? rd.rows.slice(1) : rd.rows;
      let h = '';
      for (let c = 0; c < n; c++) {
        const head = rd.hasHeader ? (rd.rows[0][c] || '') : 'Columna ' + (c + 1);
        const ex = (data.find(r => (r[c] || '').trim()) || [])[c] || '';
        const k = rd.map[c] || 'ignorar';
        h += '<div class="imp-col' + (k === 'ignorar' ? ' ign' : '') + '"><div class="h" title="' + esc(head) + '">' + esc(head || '—') + '</div>' +
          '<div class="ex" title="' + esc(ex) + '">' + esc(ex || ' ') + '</div>' +
          '<select data-col="' + c + '">' + I.KEYS.map(x => '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + esc(I.KEY_LABEL[x]) + '</option>').join('') + '</select></div>';
      }
      $('imp-map').innerHTML = h;
    } else $('imp-map').innerHTML = '';
    // Escenarios nuevos y jornadas fuera del evento
    let nh = '';
    if (IMP.fresh) {
      const ev = IMP.base.event, d1 = fmtDay(ev.fechaInicio), d2 = fmtDay(ev.fechaFin);
      nh += '<span class="imp-fresh">Sin evento abierto: al importar se crea <b>«Evento sin nombre»</b> · ' + esc(d1 === d2 ? d1 : d1 + ' → ' + d2) + ' (nombre y fechas, luego en Configuración).</span>';
    }
    if (pv.newStages.length) {
      nh += '<span><b>' + pv.newStages.length + (pv.newStages.length === 1 ? ' zona nueva' : ' zonas nuevas') + ':</b></span>' +
        pv.newStages.map(s => { const k = I.norm(s); return '<label><input type="checkbox" data-newstage="' + esc(k) + '"' + (IMP.create[k] === false ? '' : ' checked') + '> crear «' + esc(s) + '»</label>'; }).join('');
    }
    if (pv.outside.length) nh += '<label><input type="checkbox" id="imp-extend"' + (IMP.extend ? ' checked' : '') + '> <b>Ampliar el evento</b> a ' + pv.outside.map(fmtDay).map(esc).join(', ') + '</label>';
    $('imp-new').innerHTML = nh;
    // Vista previa
    const head = '<thead><tr><th></th><th>Estado</th><th>Tipo</th><th>Zona</th><th>Nombre</th><th>Jornada</th><th>Inicio</th><th>Fin</th><th>CALL</th><th>Notas</th><th>Avisos</th></tr></thead>';
    if (!pv.rows.length) {
      $('imp-prev').innerHTML = head + '<tbody><tr><td colspan="11" class="vacio">' + (rd.kind === 'vacio' ? 'Pega un horario arriba o elige un archivo .csv / .tsv.' : 'No se ha encontrado ninguna fila con hora.') + '</td></tr></tbody>';
    } else {
      const dot = '<svg class="ic dot"><use href="#i-dot"/></svg>';
      const st = { ok: dot + 'OK', warn: dot + 'Revisar', err: dot + 'Error' };
      const inp = (r, k, v, cls) => '<td class="' + (cls || '') + '"><input type="text" data-row="' + r.idx + '" data-k="' + k + '" value="' + esc(v || '') + '" spellcheck="false" autocomplete="off"></td>';
      $('imp-prev').innerHTML = head + '<tbody>' + pv.rows.map(r =>
        '<tr class="st-' + r.status + (r.include ? '' : ' off') + '" title="' + esc(r.raw || '') + '">' +
        '<td class="chk"><input type="checkbox" data-inc="' + r.idx + '"' + (r.include ? ' checked' : '') + (r.status === 'err' ? ' disabled' : '') + '></td>' +
        '<td class="st">' + st[r.status] + (r.action === 'duplicada' ? '<div class="hint">ya existe</div>' : '') + '</td>' +
        '<td class="tp"><select data-row="' + r.idx + '" data-k="tipo" class="tipo tipo-' + r.tipo + '">' + I.TIPO_KEYS.map(k => '<option value="' + k + '"' + (k === r.tipo ? ' selected' : '') + '>' + I.TIPO_LABEL[k] + '</option>').join('') + '</select>' +
          (r.tipoWhy ? '<div class="hint" title="Tipo propuesto: compruébalo">por ' + esc(r.tipoWhy) + '</div>' : '') + '</td>' +
        inp(r, 'escenario', r.escenario, 'e') + inp(r, 'banda', r.banda, 'b') +
        inp(r, 'jornada', r.jornada ? fmtDay(r.jornada) : '') +
        inp(r, 'inicio', r.inicio, 't') + (r.tipo === 'hito' ? '<td class="t"><span class="dash">—</span></td>' : inp(r, 'fin', r.fin, 't')) +
        (r.tipo === 'show' || r.tipo === 'sc' ? inp(r, 'call', r.call, 't') : '<td class="t"><span class="dash">—</span></td>') + inp(r, 'notas', r.notas) +
        '<td class="av">' + r.errs.map(x => '<div class="e">' + esc(x) + '</div>').join('') + r.warns.map(x => '<div>' + esc(x) + '</div>').join('') + '</td></tr>').join('') + '</tbody>';
    }
    // Líneas ignoradas (texto libre)
    const ign = rd.ignored || [];
    $('imp-ign').hidden = !ign.length;
    if (ign.length) {
      const impIgn = $('imp-ign');
      const summary = impIgn ? impIgn.querySelector('summary') : null;
      const ul = impIgn ? impIgn.querySelector('ul') : null;
      if (summary) summary.textContent = ign.length + (ign.length === 1 ? ' línea sin hora ignorada' : ' líneas sin hora ignoradas');
      if (ul) ul.innerHTML = ign.map(l => '<li>Línea ' + l.n + ': ' + esc(l.line) + '</li>').join('');
    }
    // Resumen y botón
    const c = pv.counts;
    $('imp-sum').innerHTML = c.total ? '<span class="ok">' + c.ok + ' OK</span> · <span class="warn">' + c.warn + ' a revisar</span> · <span class="err">' + c.err + ' con error</span>' : '';
    $('imp-go').textContent = 'Importar ' + c.importar + (c.importar === 1 ? ' entrada' : ' entradas');
    $('imp-go').disabled = !c.importar;
  }

  let IMP_LAST = [];
  /** ¿La vista (all | show | sc) escondería alguno de estos tipos? «Shows» solo enseña shows; «Soundchecks», solo pruebas. */
  function hidesSome(mode, tipos) { return mode !== 'all' && Array.from(tipos || []).some(t => t !== mode); }
  /** «✓ 39 entradas importadas en 3 jornadas (8 shows · 8 pruebas · 23 tareas/hitos)» — solo lo que hay. */
  function importSummary(rows, added) {
    const n = Number.isFinite(added) ? added : rows.length, c = t => rows.filter(x => x.tipo === t).length;
    const jors = new Set(rows.map(x => x.jornada).filter(Boolean)).size;
    const parts = [[c('show'), 'show', 'shows'], [c('sc'), 'prueba', 'pruebas'], [c('tarea') + c('hito'), 'tarea/hito', 'tareas/hitos']].filter(p => p[0]).map(p => p[0] + ' ' + (p[0] === 1 ? p[1] : p[2]));
    return '✓ ' + n + (n === 1 ? ' entrada importada' : ' entradas importadas') + ' con éxito' + (jors > 1 ? ' en ' + jors + ' jornadas' : '') + (parts.length ? ' (' + parts.join(' · ') + ')' : '');
  }
  function impDoImport() {
    if (!IMP || !IMP.pv || !IMP.pv.counts.importar) return;
    const fresh = IMP.fresh, base = IMP.base;
    const r = I.apply(base, IMP.pv, { mode: IMP.mode, createStages: IMP.create, extendEvent: IMP.extend });
    IMP_LAST = IMP.pv.rows.filter(x => x.include && x.status !== 'err');
    const used = new Set(IMP.pv.rows.filter(x => x.include && x.status !== 'err').map(x => x.tipo));
    const hidden = hidesSome(CONFIG.mode, used);
    closeImport();
    let msg = 'Importado: ' + r.added + (r.added === 1 ? ' entrada nueva' : ' entradas nuevas');
    if (r.stagesCreated) msg += ', ' + r.stagesCreated + (r.stagesCreated === 1 ? ' zona nueva' : ' zonas nuevas');
    if (hidden) msg += ' · Ver: Todo';
    if (fresh) {   // evento nuevo: la referencia es el evento vacío, así lo importado cuenta como «sin exportar» y se puede deshacer
      loadNew(base, 'Evento creado');
      msg = 'Evento creado · ' + msg.charAt(0).toLowerCase() + msg.slice(1) + '. Ponle nombre en Configuración';
    }
    // La vista actual («Ver: Shows» / «Ver: Soundchecks») escondería parte de lo importado: se pasa a «Ver: Todo» para ver la foto completa
    if (hidden) CONFIG = Dt.setConfig({ mode: 'all' });
    commitFestival(r.state, msg);
    // Confirmación clara (2,5 s, en verde) y la tabla arriba para ver el evento recién importado
    toast(importSummary(IMP_LAST, r.added) + (hidden ? ' · Ver: Todo' : '') + (fresh ? ' · ponle nombre en Configuración' : ''), false, 2500);
    $('toast').classList.add('good');
    const tw = document.querySelector('.tblwrap'); if (tw && tw.scrollTo) tw.scrollTo({ top: 0, behavior: 'smooth' });
    if (r.errors.length) modal('Algunas filas no entraron', '<ul>' + r.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>', [{ label: 'Entendido', kind: 'primary' }]);
  }

  /** Lee .csv/.tsv/.txt: UTF-8 y, si salen caracteres raros, Windows-1252 (CSV de Excel en Windows). */
  function readTextFile(file, cb) {
    const fr = new FileReader();
    fr.onload = () => {
      const t = String(fr.result || '');
      if (t.indexOf('�') < 0) { cb(t); return; }
      const f2 = new FileReader();
      f2.onload = () => cb(String(f2.result || ''));
      f2.onerror = () => cb(t);
      f2.readAsText(file, 'windows-1252');
    };
    fr.onerror = () => toast('No se pudo leer el archivo', true);
    fr.readAsText(file, 'utf-8');
  }
  function loadImportFile(file) {
    readTextFile(file, t => setImportText(t.replace(/^﻿/, ''), 'Archivo leído: ' + file.name));
  }
  const isTableFile = f => /\.(csv|tsv|txt)$/i.test(f.name || '') || /text\/(csv|tab-separated-values|plain)/.test(f.type || '');
  const PDF_NOTICE = 'Para PDFs: abre el PDF, selecciona y copia el texto (⌘A, ⌘C) y pégalo aquí.';
  // Fotos y capturas: sin OCR (serían 5 MB de librería). El sistema ya lo hace: Texto en Vivo (Mac/iOS) o Google Lens (Android).
  const IMG_NOTICE = '💡 Para fotos y capturas: Selecciona el texto sobre la imagen con el ratón o el dedo (Texto en Vivo de Mac/iOS/Android), pulsa ⌘C y pégalo aquí con ⌘V.';
  /** Qué es un archivo: 'xlsx' | 'xls' | 'pdf' | 'json' | 'tabla' | '' (no se sabe leer). */
  function fileKind(f) {
    const n = String(f.name || '').toLowerCase(), t = String(f.type || '');
    if (/\.xlsx$/.test(n) || /spreadsheetml/.test(t)) return 'xlsx';
    if (/\.xls$/.test(n) || t === 'application/vnd.ms-excel') return 'xls';
    if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
    if (/\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?|avif)$/.test(n) || /^image\//.test(t)) return 'imagen';
    if (/\.json$/.test(n) || t === 'application/json') return 'json';
    if (isTableFile(f)) return 'tabla';
    return '';
  }
  /** Un archivo soltado, elegido o pegado: cada tipo a su sitio (todo pasa por la vista previa o por «Abrir evento»). */
  function handleFile(f) {
    const k = fileKind(f);
    if (k === 'tabla') { loadImportFile(f); return; }
    if (k === 'json') { readFile(f); return; }
    if (k === 'pdf') { openImport(IMP ? IMP.text : '', PDF_NOTICE); return; }
    if (k === 'imagen') { openImport(IMP ? IMP.text : '', IMG_NOTICE); return; }
    if (k === 'xls') { toast('Es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx o CSV, o copia y pega las celdas', true); return; }
    if (k === 'xlsx') { loadXlsx(f); return; }
    toast('No sé leer «' + (f.name || 'ese archivo') + '»: usa Excel (.xlsx), CSV, TSV, texto o el .json del evento', true);
  }
  function setImportText(t, msg) {
    if (!IMP) openImport('');
    IMP.text = t; IMP.map = null; IMP.header = undefined; impResetRows();
    $('imp-text').value = IMP.text;
    $('imp-notice').hidden = true;
    impRecompute();
    if (msg) toast(msg);
  }
  function loadXlsx(file) {
    const Xl = window.ShowtimeXlsx;
    const fr = new FileReader();
    fr.onload = () => {
      Xl.toTSV(fr.result).then(r => {
        if (!r.text) { toast('El Excel «' + file.name + '» no tiene datos', true); return; }
        // Una hoja por zona: se juntan las que son horarios con las mismas columnas (las de personal o turnos, fuera)
        const m = r.all && r.all.length > 1 ? I.mergeSheets(r.all, I.contextOf(FEST || { escenarios: [], artists: [] })) : null;
        if (m && m.used.length) setImportText(m.text, 'Excel leído: ' + file.name + ' · ' + (m.used.length === 1 ? 'hoja «' + m.used[0] + '»' : m.used.length + ' hojas (' + m.used.join(', ') + ')') + (m.skipped.length ? ' · sin horarios: ' + m.skipped.join(', ') : ''));
        else setImportText(r.text, 'Excel leído: ' + file.name + (r.sheets.length > 1 ? ' · hoja «' + r.sheet + '»' : ''));
      }).catch(e => toast(e.message || 'No se pudo leer el Excel', true));
    };
    fr.onerror = () => toast('No se pudo leer el archivo', true);
    fr.readAsArrayBuffer(file);
  }

  $('btn-paste').addEventListener('click', () => openImport(''));
  $('imp-close').addEventListener('click', closeImport);
  $('imp-cancel').addEventListener('click', closeImport);
  $('imp-go').addEventListener('click', impDoImport);
  $('imp-pick').addEventListener('click', () => $('imp-file').click());
  $('imp-file').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
  $('imp-text').addEventListener('paste', e => {
    const cd = e.clipboardData, f = cd && cd.files && cd.files[0];
    if (f && fileKind(f) === 'imagen' && !(cd.getData && cd.getData('text/plain'))) { e.preventDefault(); $('imp-notice').textContent = IMG_NOTICE; $('imp-notice').hidden = false; }
  });
  $('imp-text').addEventListener('input', () => {
    clearTimeout(impTimer);
    impTimer = setTimeout(() => { if (!IMP) return; IMP.text = $('imp-text').value; IMP.map = null; IMP.header = undefined; impResetRows(); impRecompute(); }, 250);
  });
  document.querySelectorAll('#imp [data-imode]').forEach(b => b.addEventListener('click', () => { IMP.mode = b.dataset.imode; impResetRows(); impRecompute(); }));
  $('imp-jor').addEventListener('change', e => { IMP.defJor = e.target.value; IMP.jorTouched = true; impRecompute(); });
  // «Zona por defecto»: se elige de la lista o se escribe una nueva (se crea al importar, para todas las filas sin zona)
  let impZoneTimer = null;
  const impSetZone = v => { if (!IMP) return; v = String(v || '').replace(/\s+/g, ' ').trim(); if (v === IMP.defEsc) return; IMP.defEsc = v; impRecompute(); };
  $('imp-esc').addEventListener('input', e => { clearTimeout(impZoneTimer); impZoneTimer = setTimeout(() => impSetZone(e.target.value), 300); });
  $('imp-esc').addEventListener('change', e => { clearTimeout(impZoneTimer); impSetZone(e.target.value); });
  $('imp-head').addEventListener('change', e => { IMP.header = e.target.checked; IMP.map = null; impResetRows(); impRecompute(); });
  $('imp-map').addEventListener('change', e => {
    const s = e.target.closest('select[data-col]'); if (!s) return;
    IMP.map = IMP.read.map.slice(); IMP.map[+s.dataset.col] = s.value; impResetRows(); impRecompute();
  });
  $('imp-new').addEventListener('change', e => {
    if (e.target.dataset.newstage) IMP.create[e.target.dataset.newstage] = e.target.checked;
    if (e.target.id === 'imp-extend') IMP.extend = e.target.checked;
    impRecompute();
  });
  $('imp-prev').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.inc !== undefined) { IMP.include[+el.dataset.inc] = el.checked; impRecompute(); return; }
    if (el.dataset.row === undefined) return;
    const i = +el.dataset.row; IMP.edits[i] = IMP.edits[i] || {}; IMP.edits[i][el.dataset.k] = el.value;
    if (el.dataset.k === 'escenario' || el.dataset.k === 'banda' || el.dataset.k === 'tipo') delete IMP.include[i];
    impRecompute();
  });
  $('imp-prev').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[type=text]')) { e.preventDefault(); e.target.blur(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && IMP && $('modal').hidden) closeImport(); });
  // Arrastrar un .csv/.tsv sobre la ventana de importar
  const impBox = $('imp').querySelector('.imp-box');
  impBox.addEventListener('dragover', e => { e.preventDefault(); impBox.classList.add('drag'); });
  impBox.addEventListener('dragleave', () => impBox.classList.remove('drag'));
  impBox.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); impBox.classList.remove('drag'); dragN = 0; $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });


  // ── Mensajes flash a la Pantalla Live (2c-C) ──────────────────────────
  function sendFlash(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    Dt.setFlash(t, MSG_TO, MSG_ZONES);
    logEvent('msg', '«' + t + '» → ' + Vs.targetsTxt(MSG_TO, MSG_ZONES, zoneLabel));
    closeMenus();
    $('msg-text').value = '';
    renderFlash();
    toast('Mensaje → ' + Vs.targetsTxt(MSG_TO, MSG_ZONES, zoneLabel) + ': «' + t + '»' + (liveOpen() ? '' : ' (no hay ninguna Live abierta en este Dashboard)'));
  }
  function flashLeftTxt(f) {
    const l = Dt.flashLeft(f);
    return l === null ? 'hasta retirarlo' : Math.ceil(l / 1000) + ' s';
  }
  function renderFlash() {
    const f = Dt.getFlash ? Dt.getFlash() : null;
    $('msg-on').hidden = !f;
    const cur = $('msg-cur');
    cur.hidden = !f;
    if (f) cur.innerHTML = '<span>En pantalla: <b>' + esc(f.text) + '</b> · ' + flashLeftTxt(f) + '</span><button class="btn" id="msg-off" type="button">Retirar</button>';
    const chip = $('drift').querySelector('.dchip.msg');
    if (chip) chip.remove();
    if (f) $('drift').insertAdjacentHTML('afterbegin', '<span class="dchip msg"><svg class="ic"><use href="#i-msg"/></svg>' + (f.to || f.zones ? esc(Vs.targetsTxt(f.to, f.zones, zoneLabel)) : 'Live') + ': «' + esc(f.text) + '»<button class="chipx" data-act="msg-off" title="Retirar el mensaje">Retirar</button></span>');
    // Columna izquierda (lo que hay en la Live): tarjeta del mensaje con su aspecto real y el botón para quitarlo
    const card = $('card-msg');
    card.hidden = !f;
    if (!f) { card.dataset.id = ''; return; }
    if (card.dataset.id !== f.id) {
      card.dataset.id = f.id;
      const bg = f.bg || '#000000', fg = f.fg || '#ffb347';
      $('v-msg').innerHTML = '<div class="msg-live" style="--mbg:' + bg + ';--mfg:' + fg + '">' + esc(f.text.toUpperCase()) + '</div>'
        + '<div class="msg-to">→ ' + esc(Vs.targetsTxt(f.to, f.zones, zoneLabel)) + '</div>'
        + '<div class="msg-foot"><span class="msg-left"></span><button class="btn" data-act="msg-off" type="button"><svg class="ic"><use href="#i-x"/></svg>Retirar</button></div>';
    }
    $('v-msg').querySelector('.msg-left').textContent = Dt.flashLeft(f) === null ? 'Hasta retirarlo' : 'Se cierra en ' + flashLeftTxt(f);
  }
  document.querySelectorAll('#m-msg .msgp').forEach(b => b.addEventListener('click', () => sendFlash(b.dataset.msg)));
  // Destino del mensaje: Todas · Confidence · Backstage · Manager (varios a la vez)
  function renderMsgTo() {
    document.querySelectorAll('#msg-to [data-to]').forEach(b => b.classList.toggle('on', b.dataset.to === 'all' ? !MSG_TO : !!(MSG_TO && MSG_TO.indexOf(b.dataset.to) >= 0)));
    renderMsgZones();
  }
  /** Zonas de Confidence que reciben el mensaje (solo si el mensaje va a Confidence y hay más de una zona). */
  function renderMsgZones() {
    const box = $('msg-zones'); if (!box) return;
    const zs = castZones(), show = (!MSG_TO || MSG_TO.indexOf('confidence') >= 0) && zs.length > 1;
    box.hidden = !show;
    if (MSG_ZONES) MSG_ZONES = Vs.normZones(MSG_ZONES.filter(id => zs.some(z => z.id === id)));
    const h = '<button data-z="*" class="' + (!MSG_ZONES ? 'on' : '') + '">Todas las zonas</button>' + zs.map(z => '<button data-z="' + esc(z.id) + '" class="' + (MSG_ZONES && MSG_ZONES.indexOf(z.id) >= 0 ? 'on' : '') + '">' + esc(z.name) + '</button>').join('');
    if ($('msg-zl').innerHTML !== h) $('msg-zl').innerHTML = h;
  }
  $('msg-zl').addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const z = b.dataset.z;
    if (z === '*') MSG_ZONES = null;
    else { const cur = MSG_ZONES ? MSG_ZONES.slice() : []; const i = cur.indexOf(z); if (i >= 0) cur.splice(i, 1); else cur.push(z); MSG_ZONES = cur.length === castZones().length ? null : Vs.normZones(cur); }
    renderMsgZones();
  });
  $('msg-to').addEventListener('click', e => {
    const b = e.target.closest('[data-to]'); if (!b) return;
    const t = b.dataset.to;
    if (t === 'all') MSG_TO = null;
    else { const cur = MSG_TO ? MSG_TO.slice() : []; const i = cur.indexOf(t); if (i >= 0) cur.splice(i, 1); else cur.push(t); MSG_TO = Vs.normTargets(cur); }
    renderMsgTo();
  });
  renderMsgTo();
  $('msg-form').addEventListener('submit', e => { e.preventDefault(); sendFlash($('msg-text').value); });
  document.addEventListener('click', e => {
    if (e.target.closest('#msg-off, [data-act="msg-off"]')) { Dt.setFlash(null); renderFlash(); toast('Mensaje retirado de la Pantalla Live'); }
  });

  // ── El tiempo (2e-B) ─────────────────────────────────────────────────
  // Solo el Dashboard pide el dato (Open-Meteo, URL propia o manual); las Live y los dispositivos lo reciben.
  // Avisos de PREVISIÓN e informativos: umbrales del regidor, «Visto» para que no insistan, nunca tocan escena ni horarios.
  const W = window.ShowtimeMeteo;
  const MT_ACK_KEY = 'showtime.meteoAck';
  let MT_BUSY = false, MT_LAST = 0, MT_ACT = [], MT_ACKS = {}, MT_HTML = '';
  try { MT_ACKS = JSON.parse(localStorage.getItem(MT_ACK_KEY) || '{}') || {}; } catch (e) { MT_ACKS = {}; }
  // Avisos ya apuntados en el log (misma regla que «Visto»: se vuelve a apuntar si empeora o si desaparece y vuelve)
  const MT_LOG_KEY = 'showtime.meteoLogged';
  let MT_LOGGED = {};
  try { MT_LOGGED = JSON.parse(localStorage.getItem(MT_LOG_KEY) || '{}') || {}; } catch (e) { MT_LOGGED = {}; }
  function mtLog(list, pending) {
    if (!FEST) return;
    let next = W.pruneAcks(MT_LOGGED, list), ch = JSON.stringify(next) !== JSON.stringify(MT_LOGGED);
    W.pendingAlerts(pending, next).forEach(a => { logEvent('meteo', 'Aviso (previsión): ' + a.text, { amber: true }); next = W.ack(next, a); ch = true; });
    MT_LOGGED = next;
    if (ch) { try { localStorage.setItem(MT_LOG_KEY, JSON.stringify(MT_LOGGED)); } catch (e) {} }
  }
  function mtCfg() { return CONFIG.meteo || W.normMeteo(); }
  function mtKey(c) { return c.source + '|' + c.lat + '|' + c.lon + '|' + c.url; }
  function mtSaveAcks() { try { localStorage.setItem(MT_ACK_KEY, JSON.stringify(MT_ACKS)); } catch (e) {} }
  async function meteoFetch(byHand) {
    const c = mtCfg();
    if (!c.on || MT_BUSY) return;
    MT_BUSY = true; MT_LAST = Date.now();
    const prev = Dt.getMeteo() || {}, key = mtKey(c);
    try {
      const snap = await W.fetchSnap(c, (u, o) => fetch(u, o));
      Dt.setMeteo({ snap, err: '', errAt: null, key });
      if (byHand) toast('El tiempo, actualizado');
    } catch (e) {
      // El último dato bueno se conserva (con su hora): así se ve «SIN DATOS DESDE HH:MM» y no un dato viejo como si fuera de ahora
      Dt.setMeteo({ snap: prev.key === key ? (prev.snap || null) : null, err: e.message || 'Error', errAt: Date.now(), key });
      if (byHand) toast('El tiempo: ' + (e.message || 'error'), true);
    }
    MT_BUSY = false;
    renderMeteo();
    if (!$('cfg').hidden) fillMeteoStatus();
  }
  /** Programa: cada «Actualizar cada» minutos (y al cambiar la fuente o el lugar). */
  function meteoTick() {
    const c = mtCfg();
    if (c.on && !MT_BUSY && Date.now() - MT_LAST >= c.refresh * 60000) meteoFetch(false);
  }
  /** Estado actual: dato, resumen y avisos (con histéresis). */
  function meteoState() {
    const c = mtCfg(), m = Dt.getMeteo();
    const snap = m && m.key === mtKey(c) ? m.snap : null;
    const now = Date.now();
    const sum = snap ? W.summary(snap, c, now) : null;
    const list = snap ? W.alerts(snap, c, now, MT_ACT) : [];
    MT_ACT = list.map(a => a.kind);
    const pr = W.pruneAcks(MT_ACKS, list);
    if (JSON.stringify(pr) !== JSON.stringify(MT_ACKS)) { MT_ACKS = pr; mtSaveAcks(); }
    const pending = W.pendingAlerts(list, MT_ACKS);
    if (c.on) mtLog(list, pending);
    return { c, m, snap, sum, list, pending };
  }
  const MT_SRC = { openmeteo: 'Open-Meteo · previsión', url: 'Estación propia', manual: 'Manual' };
  function mtNum(v, d) { return v === null || v === undefined ? '—' : (d ? W.fmt1(v) : String(Math.round(v))); }
  /** Chips de la barra de estado: solo lo que no se ha marcado «Visto» (y el aviso de datos viejos). */
  function meteoChips(st) {
    if (!st.c.on) return '';
    let h = '';
    if (st.sum && st.sum.stale) h += '<span class="dchip over" title="El último dato del tiempo es de las ' + W.hhmm(st.sum.at) + (st.m && st.m.err ? ' · ' + esc(st.m.err) : '') + '"><svg class="ic"><use href="#i-alert"/></svg>Meteo: ' + esc(st.sum.staleTxt) + '</span>';
    st.pending.forEach(a => {
      h += '<span class="dchip absorb mtchip" title="Previsión del modelo, no es un aviso oficial"><svg class="ic"><use href="#i-' + (a.kind === 'storm' ? 'storm' : a.kind === 'rain' ? 'rain' : a.kind === 'uv' ? 'sun' : a.kind === 'heat' ? 'thermo' : a.kind === 'aqi' ? 'cloud' : 'wind') + '"/></svg>Previsión · ' + esc(a.text) +
        '<button class="chipx" data-act="mt-ack" data-k="' + a.kind + '" title="Visto: no insiste salvo que empeore">Visto</button></span>';
    });
    return h;
  }
  /** Tarjeta METEO (columna izquierda, bajo CALL). */
  function renderMeteo() {
    const card = $('card-meteo');
    const st = meteoState(), c = st.c;
    card.hidden = !c.on;
    if (!c.on) { MT_HTML = ''; return st; }
    let h = '';
    const where = c.source === 'openmeteo' ? (c.place || (c.lat !== null ? c.lat + ', ' + c.lon : '')) : MT_SRC[c.source];
    if (!st.sum) {
      const need = c.source === 'openmeteo' && (c.lat === null || c.lon === null) ? 'Elige el lugar del evento' : c.source === 'url' && !c.url ? 'Falta la URL de la estación' : c.source === 'manual' ? 'Escribe los valores' : '';
      h = '<div class="mt-none">' + (need ? esc(need) + ' en <button class="linkbtn" data-act="mt-cfg">Configuración › Meteo</button>' : (st.m && st.m.err ? 'SIN DATOS · ' + esc(st.m.err) : 'Cargando…')) + '</div>';
    } else {
      const s = st.sum;
      h += '<div class="mt-now' + (s.stale ? ' stale' : '') + '"><svg class="ic mt-sky"><use href="#i-' + s.icon + '"/></svg><span class="mt-t">' + (s.temp === null ? '—' : Math.round(s.temp) + '°') + '</span><span class="mt-sk">' + esc(s.sky || '') + (where ? '<small>' + esc(where) + '</small>' : '') + '</span></div>';
      if (s.stale) h += '<div class="mt-stale"><svg class="ic"><use href="#i-alert"/></svg>' + esc(s.staleTxt) + (st.m && st.m.err ? '<small>' + esc(st.m.err) + '</small>' : '') + '</div>';
      h += '<div class="mt-grid">' +
        '<span><svg class="ic"><use href="#i-drop"/></svg>Lluvia <b>' + mtNum(s.rain, true) + '</b> mm/h</span>' +
        '<span><svg class="ic"><use href="#i-wind"/></svg>Viento <b>' + mtNum(s.wind) + '</b> km/h</span>' +
        '<span class="mt-gmax"><svg class="ic"><use href="#i-wind"/></svg>Ráfagas máx. <b>' + mtNum(s.gustMax !== null ? s.gustMax : s.gust) + '</b> km/h' +
          (s.gustMaxAt ? ' <small>· ' + W.hhmm(s.gustMaxAt) + '</small>' : '') + (st.snap.hours.length ? ' <small>(próx. ' + s.horizon + ' h)</small>' : ' <small>(ahora)</small>') + '</span>' +
        (s.uv !== null || s.uvMax !== null ? '<span><svg class="ic"><use href="#i-sun"/></svg>UV <b>' + mtNum(s.uvMax !== null ? s.uvMax : s.uv) + '</b> ' + W.uvText(s.uvMax !== null ? s.uvMax : s.uv) + '</span>' : '') +
        (c.th.aqiOn && s.aqi !== null ? '<span><svg class="ic"><use href="#i-cloud"/></svg>Aire <b>' + W.aqiText(s.aqi) + '</b></span>' : '') +
        '</div>';
      if (st.list.length) h += '<div class="mt-alerts">' + st.list.map(a => '<div class="mt-al' + (st.pending.indexOf(a) >= 0 ? ' new' : '') + '"><svg class="ic"><use href="#i-alert"/></svg><span>' + esc(a.text) + '</span>' +
        (st.pending.indexOf(a) >= 0 ? '<button class="chipx" data-act="mt-ack" data-k="' + a.kind + '">Visto</button>' : '<small>visto</small>') + '</div>').join('') + '</div>';
      h += '<div class="mt-foot">' + esc(MT_SRC[s.src] || '') + ' · dato ' + W.hhmm(s.at) + ' · previsión, no aviso oficial · <a href="' + W.AEMET_URL + '" target="_blank" rel="noopener">Avisos AEMET<svg class="ic"><use href="#i-ext"/></svg></a></div>';
    }
    if (h !== MT_HTML) { MT_HTML = h; $('v-meteo').innerHTML = h; }
    return st;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="mt-ack"]');
    if (b) {
      const st = meteoState(), a = st.list.find(x => x.kind === b.dataset.k);
      if (a) { MT_ACKS = W.ack(MT_ACKS, a); mtSaveAcks(); logEvent('meteo', 'Visto: ' + a.text); }
      renderMeteo(); if (FEST) renderDrift(Math.floor(C.nowAbs()));
      return;
    }
    if (e.target.closest('[data-act="mt-cfg"]')) openConfig('meteo');
  });

  // Configuración › Meteo
  function fillMeteoStatus() {
    const st = meteoState(), m = st.m;
    let t = '';
    if (!st.c.on) t = 'Apagado.';
    else if (st.sum) t = 'Último dato: ' + W.hhmm(st.sum.at) + (st.sum.stale ? ' · <b class="bad">' + esc(st.sum.staleTxt) + '</b>' : '') + (m && m.err ? ' · último intento: ' + esc(m.err) : '');
    else if (m && m.err) t = '<b class="bad">Sin datos</b> · ' + esc(m.err);
    else t = MT_BUSY ? 'Pidiendo el dato…' : 'Sin datos todavía.';
    $('mt-st').innerHTML = t;
  }
  function fillMeteoCfg() {
    const c = mtCfg(), ae = document.activeElement;
    const set = (el, v) => { if (el && el !== ae) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v === null || v === undefined ? '' : v; } };
    set($('mt-on'), c.on); set($('mt-src'), c.source); set($('mt-lat'), c.lat); set($('mt-lon'), c.lon); set($('mt-url'), c.url);
    set($('mt-ref'), String(c.refresh)); set($('mt-hz'), String(c.horizon));
    document.querySelectorAll('#cfg-s-meteo [data-mp]').forEach(el => set(el, c.map[el.dataset.mp]));
    document.querySelectorAll('#cfg-s-meteo [data-mn]').forEach(el => set(el, c.manual[el.dataset.mn]));
    document.querySelectorAll('#cfg-s-meteo [data-th]').forEach(el => set(el, el.dataset.th === 'aqi' ? String(c.th.aqi) : c.th[el.dataset.th]));
    document.querySelectorAll('#cfg-s-meteo .mt-g').forEach(g => { g.hidden = g.dataset.src !== c.source; });
    document.querySelectorAll('#cfg-s-meteo .mt-auto').forEach(el => { el.hidden = c.source === 'manual'; });
    $('mt-place').textContent = c.place ? c.place + (c.lat !== null ? ' · ' + c.lat + ', ' + c.lon : '') : '';
    $('mt-aemet').href = W.AEMET_URL;
    fillMeteoStatus();
  }
  function readMeteoCfg(extra) {
    const c = JSON.parse(JSON.stringify(mtCfg()));
    c.on = $('mt-on').checked; c.source = $('mt-src').value;
    c.lat = $('mt-lat').value; c.lon = $('mt-lon').value; c.url = $('mt-url').value.trim();
    c.refresh = Number($('mt-ref').value); c.horizon = Number($('mt-hz').value);
    document.querySelectorAll('#cfg-s-meteo [data-mp]').forEach(el => { c.map[el.dataset.mp] = el.value.trim(); });
    let manualChanged = false;
    document.querySelectorAll('#cfg-s-meteo [data-mn]').forEach(el => { const v = el.value === '' ? null : Number(el.value); if (v !== c.manual[el.dataset.mn]) manualChanged = true; c.manual[el.dataset.mn] = v; });
    if (manualChanged) c.manual.at = Date.now();
    document.querySelectorAll('#cfg-s-meteo [data-th]').forEach(el => { c.th[el.dataset.th] = el.type === 'checkbox' ? el.checked : el.value === '' ? null : Number(el.value); });
    return Object.assign(c, extra || {});
  }
  function saveMeteo(extra) {
    const before = mtCfg(), next = W.normMeteo(readMeteoCfg(extra));
    if ($('mt-url').value.trim() && !next.url) toast('La URL tiene que empezar por https://', true);
    CONFIG = Dt.setConfig({ meteo: next });
    const c = mtCfg();
    // Fuente, lugar, URL, calidad del aire o valores manuales nuevos: se pide el dato ya
    if (mtKey(c) !== mtKey(before) || c.th.aqiOn !== before.th.aqiOn || JSON.stringify(c.map) !== JSON.stringify(before.map) || c.manual.at !== before.manual.at || (c.on && !before.on)) MT_LAST = 0;
    fillMeteoCfg(); renderMeteo(); meteoTick();
  }
  document.querySelectorAll('#cfg-s-meteo input, #cfg-s-meteo select').forEach(el => {
    if (el.id === 'mt-q') return;
    el.addEventListener('change', () => saveMeteo());
  });
  async function meteoFind() {
    const q = $('mt-q').value.trim(); if (!q) return;
    $('mt-res').innerHTML = '<span class="hint">Buscando…</span>';
    try {
      const r = await fetch(W.geoUrl(q));
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      const list = W.parseGeo(await r.json());
      $('mt-res').innerHTML = list.length ? list.map((p, i) => '<button class="mt-pick" type="button" data-i="' + i + '"><b>' + esc(p.name) + '</b><small>' + esc(p.detail) + ' · ' + p.lat + ', ' + p.lon + '</small></button>').join('') : '<span class="hint">No se encuentra. Prueba con otro nombre o escribe las coordenadas.</span>';
      $('mt-res').querySelectorAll('.mt-pick').forEach(b => b.addEventListener('click', () => {
        const p = list[Number(b.dataset.i)];
        $('mt-lat').value = p.lat; $('mt-lon').value = p.lon; $('mt-res').innerHTML = ''; $('mt-q').value = '';
        saveMeteo({ place: p.name + (p.detail ? ' (' + p.detail + ')' : '') });
      }));
    } catch (e) { $('mt-res').innerHTML = '<span class="hint bad">No se ha podido buscar: ' + esc(e.message) + '. Escribe las coordenadas.</span>'; }
  }
  $('mt-find').addEventListener('click', meteoFind);
  $('mt-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); meteoFind(); } });
  $('mt-now').addEventListener('click', () => { if (!mtCfg().on) { toast('Activa primero «Mostrar el tiempo»', true); return; } meteoFetch(true); });

  // ── Emisión a los móviles (2d-A) y mando del regidor (2d-B) ──────────
  // El Mac publica el estado cifrado y firmado en dos repetidores públicos; los móviles lo leen con el QR de Staff.
  // El QR PRIVADO del regidor añade la clave del mando: solo esas órdenes se obedecen (y entran en el Deshacer).
  const Em = window.ShowtimeEmision, QR = window.ShowtimeQR;
  const EM_KEY = 'showtime.emision';          // { room, on } — la sala y sus claves solo viven en este navegador
  let EM = null, EMST = null, emRoom = null, emTab = 'staff', bigTab = 'staff';
  function emLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(EM_KEY) || 'null');
      if (!v || !Em || !Em.validRoom(v.room)) return null;
      if (!v.room.c) { v.room = Em.withCmdKey(v.room); localStorage.setItem(EM_KEY, JSON.stringify(v)); }   // sala de la 2d-A: se le añade la clave del mando
      if (!v.room.q) { v.room = Em.withProdKey(v.room); localStorage.setItem(EM_KEY, JSON.stringify(v)); }   // sala anterior: se le añade la clave propia de Producción
      return v;
    } catch (e) { return null; }
  }
  function emSave(on) { try { localStorage.setItem(EM_KEY, JSON.stringify({ room: emRoom, on: !!on })); } catch (e) {} }
  function emCan() { return !!(Em && QR && M && window.crypto && crypto.subtle && 'WebSocket' in window); }
  async function emStart(resumed) {
    if (!emCan()) { toast('Este navegador no permite la emisión cifrada', true); return; }
    if (EM) return;
    try {
      if (!emRoom) { const saved = emLoad(); emRoom = saved ? saved.room : await Em.newRoom(); }
      EM = new Em.Emisor({ room: emRoom, getSnapshot: Dt.getSnapshot, onCommand: emCommand, onStatus: st => { EMST = st; renderCast(); }, onProdMessage: emProdMessage });
      await EM.start(); emSave(true); renderCast(); renderChat(); emPushChat();
      toast(resumed ? 'Emisión reanudada (estaba activa antes de recargar el Dashboard)' : 'Emitiendo: escanea el QR con el dispositivo');
    } catch (e) { console.error(e); EM = null; renderCast(); toast('No se pudo empezar la emisión: ' + (e && e.message || e), true); }
  }
  async function emStop(quiet) {
    if (!EM) return;
    const e = EM; EM = null; EMST = null; emSave(false); renderCast(); renderChat();
    await e.stop();
    if (!quiet) toast('Emisión parada: los dispositivos muestran «Emisión detenida»');
  }
  function emRegen() {
    modal('Regenerar claves', '<p>Se crea una sala nueva con claves nuevas. <b>Todos los QR anteriores (Staff, Mando y Producción) dejan de funcionar</b>: habrá que escanear los nuevos.</p>', [
      { label: 'Cancelar' },
      { label: 'Regenerar', kind: 'primary', run: () => { (async () => {
        const was = !!EM; await emStop(true);
        emRoom = await Em.newRoom(); emSave(false);
        if (was) await emStart(); else renderCast();
        toast('Claves nuevas: los QR anteriores ya no sirven');
      })(); } }
    ]);
  }
  function emRegenCmd() {
    modal('Nueva clave del mando', '<p>El QR del mando anterior <b>deja de poder mandar</b> al Mac. Los QR de Staff y Producción siguen valiendo y la emisión no se corta.</p>', [
      { label: 'Cancelar' },
      { label: 'Nueva clave', kind: 'primary', run: () => { (async () => {
        emRoom = Em.newCmdKey(emRoom); emSave(!!EM);
        if (EM) await EM.setCmdKey(emRoom.c);
        renderCast(); toast('Clave del mando nueva: escanea otra vez el QR del mando');
      })(); } }
    ]);
  }

  /** Clave de Producción nueva: los QR de Producción anteriores dejan de valer (Staff y mando siguen; la emisión no se corta). */
  function emRegenProd(quitado) {
    const intro = quitado
      ? '<p><b>' + esc(quitado) + '</b> ya no está en la lista: el Dashboard ignora lo que mande con su nombre. Pero su QR sigue pudiendo <b>leer</b> la emisión y el chat de Producción. Para cortarle del todo, genera una clave nueva (el resto de Producción tendrá que volver a escanear su QR).</p>'
      : '<p>Los QR de Producción anteriores <b>dejan de funcionar</b>: no podrán leer el chat ni mandar nada. Staff y el mando siguen igual y la emisión no se corta.</p>';
    modal(quitado ? 'Quitar acceso a ' + quitado : 'Nueva clave de Producción', intro, [
      { label: quitado ? 'Ahora no' : 'Cancelar' },
      { label: 'Nueva clave', kind: 'primary', run: () => { (async () => {
        emRoom = Em.newProdKey(emRoom); emSave(!!EM);
        if (EM) await EM.setProdKey(emRoom.q);
        renderCast(); renderProducerList(); closeProducerQR();
        toast('Clave de Producción nueva: cada persona tiene que escanear su QR otra vez');
      })(); } }
    ]);
  }

  // Órdenes del mando: las mismas reglas que los botones del Panel (mando.js); todo entra en el Deshacer.
  async function emCommand(cmd) {
    const bad = M.checkCmd(cmd);
    if (bad) return { ok: false, msg: bad };
    const a = cmd.args || {};
    if (!FEST && ['flash', 'flashOff'].indexOf(cmd.op) < 0) return { ok: false, msg: 'No hay evento abierto en el Dashboard' };
    const at = Math.abs(Date.now() - cmd.t) < 120000 ? cmd.t : Date.now();     // la hora en que se pulsó en el móvil
    const abs = Math.floor(C.nowAbs(new Date(at)));
    const from = 'Desde el mando del Stage Manager · ';
    if (cmd.op === 'start' || cmd.op === 'stop') {
      const r = M.realPlan(FEST, CONFIG, a.key, cmd.op === 'start' ? 'i' : 'f', abs);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, from + r.msg, { src: 'mando', t: abs, noTimes: true, ev: pushedEv(r) });
      if (r.clashes.length) setTimeout(() => toast('Choque con entrada en rojo: ' + r.clashes.map(c => c.name + ' / ' + c.with).join(', '), true), 2800);
      return { ok: true, msg: r.msg + (r.clashes.length ? ' · ¡choque con entrada en rojo!' : '') };
    }
    if (cmd.op === 'onTime') {
      const r = M.onTimePlan(FEST, a.key, abs);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, from + r.msg, { src: 'mando', t: abs, noTimes: true, noReal: true, ev: [{ type: 'real', text: r.logTxt + ' · Stage Manager (mando)' }] });
      return { ok: true, msg: r.msg };
    }
    if (cmd.op === 'stretch') {
      const r = M.stretchPlan(FEST, a.key, a.on, abs);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, from + r.msg, { src: 'mando', t: abs, noTimes: true, ev: [{ type: 'buffer', amber: r.late !== null && r.late !== undefined, text: r.msg }] });
      return { ok: true, msg: r.msg };
    }
    if (cmd.op === 'delay') {
      const r = M.delayPlan(FEST, CONFIG, { minutes: a.minutes, zones: a.zones, from: a.from, src: 'mando' });
      if (!r.ok) return { ok: false, msg: r.error };
      if (M.delayStamp(r) !== a.stamp) return { ok: false, msg: 'El horario ha cambiado desde el resumen: revísalo y confirma otra vez', data: { stale: true } };
      if (!r.moved.length) return { ok: false, msg: 'No hay nada que mover con esa selección' };
      const zl = a.zones === 'all' ? 'todas las zonas' : a.zones.map(z => z ? ((C.getEscenario(FEST, z) || {}).nombre || z) : 'sin zona').join(', ');
      const msg = 'Retraso +' + r.minutes + ' min (' + zl + ', desde ' + C.fmtHM(Math.floor(a.from)) + '): ' + nEnt(r.moved.length, 'movida') + (r.kept.length ? ' · ' + keptTxt(r.kept.length) : '');
      commitFestival(r.state, from + msg, { src: 'mando', t: abs, noTimes: true, ev: [{ type: 'delay', text: msg, jors: [r.jornada], amber: true }] });
      return { ok: true, msg };
    }
    if (cmd.op === 'flash') {
      const t = String(a.text).replace(/\s+/g, ' ').trim();
      const to = Vs.normTargets(a.to), zs = Vs.normZones(a.zones);
      Dt.setFlash(t, to, zs); renderFlash(); toast(from + 'Mensaje → ' + Vs.targetsTxt(to, zs, zoneLabel) + ': «' + t + '»');
      logEvent('msg', '«' + t + '» → ' + Vs.targetsTxt(to, zs, zoneLabel), { src: 'mando', t: abs });
      return { ok: true, msg: 'Mensaje → ' + Vs.targetsTxt(to, zs, zoneLabel) + ': «' + t + '»' };
    }
    if (cmd.op === 'flashOff') {
      Dt.setFlash(null); renderFlash(); toast(from + 'Mensaje retirado');
      return { ok: true, msg: 'Mensaje retirado' };
    }
    if (cmd.op === 'callOk') {
      Dt.markCallDone(a.key, Math.floor(C.nowAbs())); logCallOk(a.key, 'Stage Manager (mando)', 'mando'); tick(); toast(from + 'CALL confirmado');
      return { ok: true, msg: 'CALL confirmado' };
    }
    return { ok: false, msg: 'Orden desconocida' };
  }

  // ── CALL OK: quién lo ha dado queda en el log (Stage Manager desde el Panel, el mando o una pantalla Live; o la persona de Producción) ──
  let CALL_LOGGED = new Set(Dt.getCallDone());   // OK ya apuntados (los que había al abrir no se reescriben)
  function bandOfKey(key) { return C.callKeyName(key); }
  function prodName(id) { const p = (typeof PRODUCERS !== 'undefined' ? PRODUCERS : []).find(x => x.id === id); return p ? p.name : id; }
  function logCallOk(key, who, src) {
    if (CALL_LOGGED.has(key)) return;   // el primero que lo da es el que queda apuntado
    CALL_LOGGED.add(key);
    logEvent('call', 'CALL OK · ' + bandOfKey(key) + ' · ' + who, { src });
  }
  /** OK que llegan de otra ventana (la Live del Stage Manager): se apuntan como suyos. Y se olvidan los que caducan. */
  function logLiveCallOks() {
    const now = Dt.getCallDone();
    now.forEach(k => logCallOk(k, 'Stage Manager (pantalla Live)', 'panel'));
    CALL_LOGGED.forEach(k => { if (now.indexOf(k) < 0) CALL_LOGGED.delete(k); });
  }

  // Quitar un aviso (✕ de su chip): solo desde aquí, el Dashboard del Stage Manager
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-aviso-x]'); if (!b) return;
    const id = b.dataset.avisoX, a = Dt.getAvisos().find(x => x.id === id);
    Dt.removeAviso(id);
    if (a) { logEvent('msg', 'Aviso retirado por el Stage Manager: «' + a.text + '»', { src: 'panel' }); toast('Aviso retirado'); }
    if (FEST) renderDrift(Math.floor(C.nowAbs()));
  });

  // ── Chat Producción ↔ Stage Manager: un canal común; cada mensaje con su autor. Se guarda aquí y se manda entero a Producción ──
  function hhmmOf(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function renderChat() {
    const list = Dt.getChat(), box = $('chat-list'); if (!box) return;
    box.innerHTML = list.slice(-100).map(m => '<div class="chat-list-item' + (m.sm ? ' sm' : '') + '"><div class="chat-list-item-from">' + esc(m.sm ? 'Stage Manager' : m.from) +
      '<small>' + hhmmOf(m.at) + '</small></div><div class="chat-list-item-text">' + esc(m.text) + '</div></div>').join('');
    $('chat-empty').hidden = list.length > 0;
    $('chat-off').hidden = !!EM;
    box.scrollTop = box.scrollHeight;
  }
  /** Manda el chat (últimos mensajes) a los enlaces de Producción. Solo con la emisión activa. */
  function emPushChat() {
    if (!EM || !EM.sendProd) return;
    EM.sendProd({ type: 'chatlog', list: Dt.getChat().slice(-Em.CHAT_SEND) }).catch(e => console.error(e));
  }
  $('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('chat-text');
    if (!Dt.addChat(inp.value, 'Stage Manager', '', true)) return;
    inp.value = ''; renderChat(); emPushChat();
  });
  $('m-chat').querySelector('.mbtn').addEventListener('click', () => { $('chat-on').hidden = true; renderChat(); });
  setInterval(() => { if (Dt.getChat().length) emPushChat(); }, 20000);   // quien se conecta tarde lo recibe en poco tiempo

  // Mensajes de Producción (llegan cifrados desde su Live): OK de CALL, mensajes a las pantallas y chat.
  function emProdMessage(raw) {
    const msg = Em && Em.cleanProdMsg ? Em.cleanProdMsg(raw) : null;
    if (!msg) return;
    if (!PRODUCERS.some(p => p.id === msg.from)) { toast('Mensaje de Producción ignorado: «' + msg.from + '» no está en la lista de Producción', true); return; }   // persona borrada o id inventado
    const who = 'Producción (' + prodName(msg.from) + ')';
    if (msg.type === 'call') {
      if (!FEST || !C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.callKey(b) === msg.key)) return;   // solo CALL que existen
      if (CALL_LOGGED.has(msg.key)) return;
      Dt.markCallDone(msg.key, Math.floor(C.nowAbs()));
      logCallOk(msg.key, who, 'produccion');
      tick(); toast('CALL OK · ' + bandOfKey(msg.key) + ' · ' + who);
    } else if (msg.type === 'flash') {
      const to = Vs.normTargets(msg.to);
      Dt.setFlash(msg.text, to, null); renderFlash();
      toast(who + ' → ' + Vs.targetsTxt(to, null, zoneLabel) + ': «' + msg.text + '»');
      logEvent('msg', '«' + msg.text + '» → ' + Vs.targetsTxt(to, null, zoneLabel) + ' · ' + who, { src: 'produccion' });
    } else if (msg.type === 'aviso') {
      if (!Dt.addAviso(msg.text, msg.perm, who)) return;
      if (FEST) renderDrift(Math.floor(C.nowAbs()));
      toast(who + ' · aviso ' + (msg.perm ? 'permanente' : 'puntual') + ': «' + msg.text + '»');
      logEvent('msg', 'Aviso ' + (msg.perm ? 'permanente' : 'puntual') + ': «' + msg.text + '» · ' + who, { src: 'produccion' });
    } else if (msg.type === 'chat') {
      Dt.addChat(msg.text, prodName(msg.from), msg.from, false);
      renderChat();
      if (!$('m-chat').classList.contains('open')) $('chat-on').hidden = false;   // sin leer
      if (CONFIG && CONFIG.prodChatPopup !== false) toast('Chat · ' + prodName(msg.from) + ': ' + msg.text.slice(0, 100));
      emPushChat();
    } else if (msg.type === 'chatsync') {
      emPushChat();
    }
  }

  function emLinksOn() { return EMST ? EMST.links.filter(l => l.state === 'on').length : 0; }
  function emStateHtml(kind) {
    const n = emLinksOn(), tot = EMST ? EMST.links.length : 2;
    const cls = n ? 'ok' : 'warn';
    const txt = n === 0 ? 'Conectando con los repetidores…' : n < tot ? 'En directo (' + n + ' de ' + tot + ' repetidores)' : 'En directo';
    const links = (EMST ? EMST.links : Em.BROKERS.map(b => ({ name: b.name, state: 'connecting' })))
      .map(l => '<span class="clink ' + (l.state === 'on' ? 'on' : '') + '" title="' + esc(l.state === 'on' ? 'Conectado' : l.err ? 'Sin conexión: ' + l.err : 'Conectando…') + '">' + esc(l.name) + '</span>').join('');
    const v = EMST ? EMST.viewers : 0, r = EMST ? EMST.remotes : 0;
    const who = kind === 'remote' ? (r ? '<b class="cok">Stage Manager conectado</b>' : 'Sin Stage Manager conectado') : kind === 'produccion' ? '<span>' + PRODUCERS.length + ' persona(s) de Producción</span>' : (v === 1 ? '1 dispositivo conectado' : v + ' dispositivos conectados');
    return '<div class="cstate"><span class="cdot ' + cls + '"></span><b>' + txt + '</b></div><div class="cview">' + who + '</div><div class="clinks">' + links + '</div>';
  }
  // QR de Staff por pantalla (2e-A): Manager · Confidence (con zona) · Backstage
  let CAST_VISTA = 'manager', CAST_ZONA = null;
  let PRODUCERS = [];  // Lista de personas de Producción: [{id, name}, ...]
  let PROD_DEFAULT_ID = null;  // ID para mostrar en la pestaña Producción
  let PROD_COUNTER = 0;  // Contador para generar IDs únicos
  let PROD_SEL = null;  // Persona elegida en la lista: «Ampliar» y «Copiar enlace» van con SU enlace
  const PROD_STORAGE_KEY = 'showtime.producers';
  function saveProducers() {
    try {
      localStorage.setItem(PROD_STORAGE_KEY, JSON.stringify({ producers: PRODUCERS, counter: PROD_COUNTER, defaultId: PROD_DEFAULT_ID }));
    } catch (e) {
      console.error('Error guardando productores:', e);
    }
  }
  function loadProducers() {
    try {
      const data = localStorage.getItem(PROD_STORAGE_KEY);
      if (data) {
        const p = JSON.parse(data);
        PRODUCERS = p.producers || [];
        PROD_COUNTER = p.counter || 0;
        PROD_DEFAULT_ID = p.defaultId || null;
      }
    } catch (e) {
      console.error('Error cargando productores:', e);
    }
  }
  function castZones() {
    if (!FEST) return [];
    const zs = (FEST.escenarios || []).map(z => ({ id: z.id, name: z.nombre }));
    if (C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) zs.push({ id: '', name: 'Sin zona' });
    return zs;
  }
  function emUrl(kind) {
    if (kind === 'remote') return Em.remoteUrl(emRoom);
    if (kind === 'produccion') {
      if (!PROD_DEFAULT_ID && PRODUCERS.length) PROD_DEFAULT_ID = PRODUCERS[0].id;
      const sel = PRODUCERS.some(p => p.id === PROD_SEL) ? PROD_SEL : PROD_DEFAULT_ID;
      return Em.productionUrl(emRoom, undefined, sel || 'Producción');
    }
    if (CAST_VISTA === 'confidence') { const zs = castZones(); if (!zs.some(z => z.id === CAST_ZONA)) CAST_ZONA = zs.length ? zs[0].id : ''; }
    return Em.staffUrl(emRoom, undefined, { vista: CAST_VISTA, zona: CAST_ZONA });
  }
  function renderProducerList() {
    const box = $('prod-list');
    if (!box) return;
    if (!PRODUCERS.length) {
      box.innerHTML = '<p class="mnote">Sin productores. Añade uno arriba.</p>';
      return;
    }
    box.innerHTML = PRODUCERS.map((p, i) => {
      return '<div class="prod-item' + (p.id === PROD_SEL ? ' active' : '') + '" data-prod-idx="' + i + '">'
        + '<div class="prod-info">'
        + '<div class="prod-name">' + esc(p.name) + '</div>'
        + '<div class="prod-id">' + esc(p.id) + '</div>'
        + '</div>'
        + '<button class="prod-del" type="button" data-prod-del="' + i + '" title="Eliminar">✕</button>'
        + '</div>';
    }).join('');
  }
  function addProducerFromInput(input) {
    const name = input.value.trim();
    if (!name) { toast('Nombre requerido'); return; }
    PROD_COUNTER++;
    const id = 'prod_' + String(PROD_COUNTER).padStart(3, '0');
    PRODUCERS.push({ id, name });
    if (!PROD_DEFAULT_ID) PROD_DEFAULT_ID = id;
    input.value = '';
    saveProducers();
    renderProducerList();
    renderCast();
  }
  function removeProducer(index) {
    if (index < 0 || index >= PRODUCERS.length) return;
    const removed = PRODUCERS[index];
    PRODUCERS.splice(index, 1);
    if (PROD_DEFAULT_ID === removed.id) {
      PROD_DEFAULT_ID = PRODUCERS.length ? PRODUCERS[0].id : null;
    }
    saveProducers();
    renderProducerList();
    renderCast();
    // El panel lateral no se queda con el QR de alguien borrado (ni con el índice corrido)
    const still = PRODUCERS.findIndex(x => x.id === PROD_SEL);
    if (still >= 0) showProducerQR(still); else closeProducerQR();
    if (emRoom) emRegenProd(removed.name || removed.id);   // borrar de la lista no le quita el QR: se ofrece cortar el acceso
  }
  function closeProducerQR() {
    const side = $('prod-qr-side');
    if (side) {
      side.innerHTML = ''; PROD_SEL = null;
      document.querySelectorAll('.prod-item').forEach(item => item.classList.remove('active'));
    }
  }
  /** Título del QR ampliado de Producción: dice de quién es (la persona elegida o, si no, la de por defecto). */
  function prodBigTitle() {
    const p = PRODUCERS.find(x => x.id === PROD_SEL) || PRODUCERS.find(x => x.id === PROD_DEFAULT_ID);
    return 'Producción' + (p ? ' · ' + p.name : '');
  }
  function showProducerQR(index) {
    if (index < 0 || index >= PRODUCERS.length) return;
    const p = PRODUCERS[index];
    const side = $('prod-qr-side');
    if (!side) return;
    let qr = '';
    if (Em && emRoom && window.ShowtimeQR) {
      const url = Em.productionUrl(emRoom, undefined, p.id);
      qr = window.ShowtimeQR.svg(url, { ecl: 'M', margin: 3 });
    }
    PROD_SEL = p.id;
    side.innerHTML = '<div class="prod-qr-content"><div class="prod-qr-header">' + esc(p.name) + '<span class="prod-id">' + esc(p.id) + '</span></div><div class="prod-qr-svg">' + qr + '</div>'
      + '<div class="prod-state"><span class="prod-stat-dot' + (EM ? '' : ' off') + '"></span><span>' + (EM ? 'En directo' : 'Emisión parada') + '</span></div>'
      + '<div class="prod-buttons"><button class="btn" type="button" data-act="cast-big" data-k="produccion"><svg class="ic"><use href="#i-expand"/></svg>Ampliar</button><button class="btn" type="button" data-act="cast-copy" data-k="produccion"><svg class="ic"><use href="#i-copy"/></svg>Copiar enlace</button><button class="btn ghost" type="button" data-act="prod-regen"><svg class="ic"><use href="#i-refresh"/></svg>Nueva clave…</button></div></div>';
    // Marca este productor como seleccionado
    document.querySelectorAll('.prod-item').forEach(item => item.classList.remove('active'));
    const selItem = document.querySelector('[data-prod-idx="' + index + '"]');
    if (selItem) selItem.classList.add('active');
  }
  function castPickHtml() {
    const zs = castZones();
    return '<div class="cpick"><div class="cseg">' + Vs.VISTAS.map(v => '<button type="button" data-cv="' + v + '" class="' + (CAST_VISTA === v ? 'on' : '') + '">' + Vs.VISTA_TXT[v] + '</button>').join('') + '</div>'
      + (CAST_VISTA === 'confidence' ? '<select class="czone" data-cz="1">' + zs.map(z => '<option value="' + esc(z.id) + '"' + (z.id === CAST_ZONA ? ' selected' : '') + '>' + esc(z.name) + '</option>').join('') + '</select>' : '')
      + '<span class="csub">' + esc(Vs.VISTA_SUB[CAST_VISTA]) + '</span></div>';
  }
  function paneHtml(kind) {
    const url = emUrl(kind);
    const side = kind === 'remote'
      ? '<button class="btn" type="button" data-act="cast-big" data-k="remote"><svg class="ic"><use href="#i-expand"/></svg>Ampliar</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="remote"><svg class="ic"><use href="#i-copy"/></svg>Copiar enlace</button>'
        + '<button class="btn ghost" type="button" data-act="cast-regencmd">Nueva clave del mando…</button>'
      : '<button class="btn" type="button" data-act="cast-big" data-k="staff"><svg class="ic"><use href="#i-expand"/></svg>Ampliar</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="staff"><svg class="ic"><use href="#i-copy"/></svg>Copiar enlace</button>'
        + '<button class="btn" type="button" data-act="cast-stop">Parar emisión</button>'
        + '<button class="btn ghost" type="button" data-act="cast-regen">Regenerar claves…</button>';
    const note = kind === 'remote'
      ? '<p class="cwarn"><svg class="ic"><use href="#i-alert"/></svg><span><b>Privado.</b> Quien tenga este QR puede mandar al Mac (▶ / ■, En hora, retrasos, mensajes, CALL). No lo compartas; si se escapa, «Nueva clave del mando».</span></p>'
      : '<p class="mnote">Abre la Pantalla Live en el dispositivo (móvil, tablet…), en solo lectura. Si el Mac se duerme o se cierra el Dashboard, la emisión se corta y los dispositivos lo avisan.</p>';
    if (kind === 'produccion') {
      return '<div class="cprod-split"><div class="cprod-left"><div class="cprod-add"><input type="text" id="prod-input" placeholder="Nombre productor…" /><button class="btn primary" type="button" data-act="prod-add-person"><svg class="ic"><use href="#i-plus"/></svg></button></div><div class="cprod-list" id="prod-list"></div><p class="mnote">Toca una persona para ver su QR. Ve la Live de Manager, confirma los CALL, manda mensajes y avisos y chatea contigo (sin tocar horarios).</p></div><div class="cprod-right"><div id="prod-qr-side" class="prod-qr-side"></div></div></div>';
    }
    return (kind === 'staff' ? castPickHtml() : '') + '<div class="cgrid"><div class="cqr" title="QR de ' + (kind === 'remote' ? 'Stage Manager' : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA]) + '">' + QR.svg(url, { ecl: 'M', margin: 3 }) + '</div>'
      + '<div class="cside"><div class="cst" data-k="' + kind + '"></div>' + side + '</div></div>' + note;
  }
  function renderCast() {
    if (!$('cast-staff')) return;
    const on = !!EM;
    $('cast-on').hidden = !on;
    $('cast-on').classList.toggle('warn', on && !emLinksOn());
    ['staff', 'remote', 'produccion'].forEach(kind => {
      const box = $('cast-' + kind);
      if (!emCan()) { box.innerHTML = '<p class="cintro">Este navegador no permite la emisión cifrada.</p>'; return; }
      if (!on) {
        box.dataset.url = '';
        box.innerHTML = (kind === 'remote'
          ? '<p class="cintro">Con el <b>mando del Stage Manager</b> manejas el Mac desde tu dispositivo: ▶ / ■, En hora, retrasos con resumen y Confirmar, mensajes y CALL. Necesita que la emisión esté activa.</p>'
          : kind === 'produccion'
          ? '<p class="cintro">Acceso para <b>Producción</b>: ver la Live de Manager, confirmar CALL, enviar mensajes y avisos y chatear con el Stage Manager. Necesita que la emisión esté activa.</p>'
          : '<p class="cintro">Emite el horario en directo a los dispositivos del equipo (técnicos, producción, managers…). Lo ven <b>solo en lectura</b>: nadie puede cambiar nada desde ellos.</p>')
          + '<div class="cbtns"><button class="btn primary" type="button" data-act="cast-start"><svg class="ic"><use href="#i-cast"/></svg>Empezar a emitir</button>'
          + (emRoom && kind === 'staff' ? '<button class="btn" type="button" data-act="cast-regen">Regenerar claves…</button>' : '') + '</div>'
          + '<p class="mnote">Necesita internet en el Mac y en los dispositivos (4G o Wi-Fi con salida). Todo va cifrado: los repetidores públicos solo ven datos ilegibles y no guardan nada.</p>';
        return;
      }
      // Producción: el panel solo se rehace si cambia la sala o su clave (no al elegir persona, que borraría su QR)
      const url = kind === 'produccion' ? Em.productionUrl(emRoom, undefined, '') : emUrl(kind);
      if (box.dataset.url !== url) { box.dataset.url = url; box.innerHTML = paneHtml(kind); if (kind === 'produccion') PROD_SEL = null; }
      if (kind === 'produccion') renderProducerList();
      else { const cst = box.querySelector('.cst'); if (cst) cst.innerHTML = emStateHtml(kind); }
    });
    if (!on) $('qr-big').hidden = true;
    else {
      const url = emUrl(bigTab);
      if ($('qr-big-svg').dataset.url !== url) { $('qr-big-svg').dataset.url = url; $('qr-big-svg').innerHTML = QR.svg(url, { ecl: 'M', margin: 4 }); }
      $('qr-big-t').textContent = bigTab === 'remote' ? 'Stage Manager · mando (privado)' : bigTab === 'produccion' ? prodBigTitle() : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA] + (CAST_VISTA === 'confidence' ? ' · ' + ((castZones().find(z => z.id === CAST_ZONA) || {}).name || '') : '') + ' · solo lectura';
      $('qr-big').classList.toggle('remote', bigTab === 'remote');
      $('qr-big-st').innerHTML = emStateHtml(bigTab);
    }
    // Pestaña del mando: punto si hay un mando conectado
    const rt = document.querySelector('#m-cast .ctab[data-tab="remote"]');
    if (rt) rt.classList.toggle('rlive', on && !!(EMST && EMST.remotes));
  }
  async function emCopy(kind) {
    const url = emUrl(kind);
    try { await navigator.clipboard.writeText(url); toast(kind === 'remote' ? 'Enlace del mando copiado (es privado)' : kind === 'produccion' ? 'Enlace de Producción copiado' : 'Enlace de Staff copiado'); }
    catch (e) { modal(kind === 'remote' ? 'Enlace del mando (privado)' : kind === 'produccion' ? 'Enlace de Producción' : 'Enlace de Staff', '<input type="text" readonly value="' + esc(url) + '" style="width:100%" onfocus="this.select()">', [{ label: 'Cerrar', kind: 'primary' }]); }
  }
  function setCastTab(tab) {
    emTab = tab;
    document.querySelectorAll('#m-cast .ctab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('cast-staff').hidden = tab !== 'staff'; $('cast-remote').hidden = tab !== 'remote'; $('cast-produccion').hidden = tab !== 'produccion';
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act^="cast-"], [data-act^="prod-"], #m-cast .ctab, #qr-big-x');
    if (!t) { if (e.target.id === 'qr-big') $('qr-big').hidden = true; return; }
    if (t.classList.contains('ctab')) { setCastTab(t.dataset.tab); return; }
    if (t.id === 'qr-big-x') { $('qr-big').hidden = true; return; }
    const a = t.dataset.act;
    if (a === 'cast-start') emStart();
    else if (a === 'cast-stop') emStop();
    else if (a === 'cast-regen') { closeMenus(); emRegen(); }
    else if (a === 'cast-regencmd') { closeMenus(); emRegenCmd(); }
    else if (a === 'cast-copy') emCopy(t.dataset.k || 'staff');
    else if (a === 'cast-big') { closeMenus(); bigTab = t.dataset.k || 'staff'; renderCast(); $('qr-big').hidden = false; }
    else if (a === 'prod-regen') { closeMenus(); emRegenProd(); }
    else if (a === 'prod-add-person') { const inp = $('prod-input'); if (inp) addProducerFromInput(inp); }
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-prod-del]');
    if (btn) { removeProducer(parseInt(btn.dataset.prodDel, 10)); return; }
    const item = e.target.closest('[data-prod-idx]');
    if (item) showProducerQR(parseInt(item.dataset.prodIdx, 10));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('qr-big').hidden = true;
      closeProducerQR();
    }
    if (e.key === 'Enter' && e.target.id === 'prod-input') {
      const btn = e.target.closest('.cprod-add').querySelector('[data-act="prod-add-person"]');
      if (btn) btn.click();
    }
  });
  document.addEventListener('click', e => { const b = e.target.closest('#cast-staff [data-cv]'); if (!b) return; CAST_VISTA = b.dataset.cv; renderCast(); });
  document.addEventListener('change', e => { if (e.target.matches('#cast-staff [data-cz]')) { CAST_ZONA = e.target.value; renderCast(); } });
  // Cada cambio guardado (en este Panel o llegado de la Live, p. ej. un OK de CALL) sale hacia los móviles
  const EM_KEYS = [Dt.KEYS.festival, Dt.KEYS.config, Dt.KEYS.callDone, Dt.KEYS.flash, Dt.KEYS.avisos, Dt.KEYS.meteo];
  Dt.onWrite(k => { if (EM && EM_KEYS.indexOf(k) >= 0) EM.push(); });
  (function () { renderChat(); loadProducers(); const saved = emLoad(); if (saved) emRoom = saved.room; renderCast(); if (saved && saved.on) emStart(true); })();

  // ── Sincronización con la Pantalla Live ──────────────────────────────
  Dt.onChange(type => {
    if (type === 'callDone') { logLiveCallOks(); tick(); return; }
    if (type === 'avisos') { if (FEST) renderDrift(Math.floor(C.nowAbs())); return; }
    if (type === 'chat') { renderChat(); return; }
    if (type === 'flash') { renderFlash(); return; }
    if (type === 'meteo') { renderMeteo(); return; }
    loadState(); renderAll();
  });

  // ── Atajos y ayuda («?» o ⌘/): lo que antes era texto fijo encima de la tabla ──
  function openHelp() {
    modal('Atajos y ayuda', '<dl class="keys">' +
      '<dt><kbd>Intro</kbd> o salir de la casilla</dt><dd>Aplica el cambio</dd>' +
      '<dt><kbd>Esc</kbd></dt><dd>Descarta lo que estabas escribiendo (y cierra menús y ventanas)</dd>' +
      '<dt><kbd>Tab</kbd></dt><dd>Pasa a la casilla siguiente</dd>' +
      '<dt>Doble clic en la hora real</dt><dd>Corrige la hora real de inicio de una banda que ya empezó</dd>' +
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>F</kbd></dt><dd>Modo foco: solo lo de directo, filas y letra más grandes</dd>' +
      '<dt><kbd>⌘</kbd> <kbd>/</kbd></dt><dd>Abre esta ayuda</dd>' +
      '</dl><p class="hint">Jornada = día del evento: lo que empieza antes de la hora de corte cuenta como la noche anterior. En la Pantalla Live: <kbd>F</kbd> pantalla completa · <kbd>V</kbd> cambia de vista.</p>',
      [{ label: 'Cerrar', kind: 'primary' }]);
  }
  $('btn-help').addEventListener('click', openHelp);
  $('btn-focus').addEventListener('click', () => { setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); } });
  applyFocus();
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === '?')) { e.preventDefault(); openHelp(); } });

  // ── Pantalla siempre encendida ───────────────────────────────────────
  // Sin reposo: botón con micro-LED (verde = activo). Se puede apagar; la elección se recuerda en este equipo.
  let wakeLock = null;
  const WAKE_KEY = 'showtime.wake';
  function wakeWanted() { try { return localStorage.getItem(WAKE_KEY) !== 'off'; } catch (e) { return true; } }
  function paintWake() {
    const b = $('wake'); if (!b) return;
    if (!('wakeLock' in navigator)) { b.hidden = true; return; }
    b.hidden = false; b.classList.toggle('on', !!wakeLock); b.setAttribute('aria-pressed', String(!!wakeLock));
  }
  async function requestWake() {
    if (!('wakeLock' in navigator) || !wakeWanted() || document.visibilityState !== 'visible' || wakeLock) { paintWake(); return; }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; paintWake(); });
    } catch (e) { wakeLock = null; }
    paintWake();
  }
  $('wake').addEventListener('click', async () => {
    if (wakeLock) {
      try { localStorage.setItem(WAKE_KEY, 'off'); } catch (e) {}
      const w = wakeLock; wakeLock = null;
      try { await w.release(); } catch (e) {}
      paintWake(); toast('Sin reposo desactivado: el equipo puede apagar la pantalla');
    } else {
      try { localStorage.removeItem(WAKE_KEY); } catch (e) {}
      await requestWake();
      toast(wakeLock ? 'Sin reposo activado: la pantalla no se apaga' : 'Este navegador no permite mantener la pantalla encendida', !wakeLock);
    }
  });
  document.addEventListener('visibilitychange', requestWake);
  document.addEventListener('pointerdown', requestWake);

  // ── Marca: pantalla de inicio (2,5 s o clic) y «Archivo › Acerca de Showtime…» ──
  let splashT = null;
  /** about = false: inicio (se va sola a los 2,5 s); true: «Acerca de» (hasta clic o Esc). */
  function showSplash(about) {
    const el = $('splash'), Mk = window.ShowtimeMarca; if (!el || !Mk) return;
    clearTimeout(splashT);
    el.className = 'splash' + (about ? ' about' : '');
    el.classList.remove('out');
    el.innerHTML = Mk.banner({ version: (window.ShowtimeEmision || {}).BUILD || '', footer: true }) + (about ? '<div class="splash-hint">Clic o Esc para cerrar</div>' : '');
    el.hidden = false;
    if (!about) splashT = setTimeout(hideSplash, SPLASH_MS);
  }
  function hideSplash() {
    const el = $('splash'); if (!el || el.hidden || el.classList.contains('out')) return;
    clearTimeout(splashT);
    el.classList.add('out');
    splashT = setTimeout(() => { el.hidden = true; el.classList.remove('out'); el.innerHTML = ''; }, 450);
  }
  $('splash').addEventListener('click', hideSplash);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('splash').hidden) { e.stopImmediatePropagation(); hideSplash(); } }, true);
  $('btn-about').addEventListener('click', () => { closeMenus(); showSplash(true); });

  // ── Arranque ─────────────────────────────────────────────────────────
  showSplash(false);
  loadState();
  logLoad();
  renderAll();
  tick();
  setInterval(tick, 1000);
  requestWake();
  // Almacenamiento lleno: aviso fijo (los cambios siguen en pantalla y en la emisión, pero no se guardan en este navegador)
  Dt.onSaveState(ok => {
    const w = $('savewarn'); if (!w) return;
    w.hidden = ok;
    if (ok) toast('Se vuelve a guardar con normalidad');
  });

  window.ShowtimePanel = { reload: () => { loadState(); renderAll(); }, _test: { emProdMessage, emRegenProd, hitoChips, emUrl, prodBigTitle, fileKind, handleFile, emCommand, importSummary, hidesSome, tipoPill, showSplash, hideSplash, setStandby, standbyOn, room: () => emRoom } };   // _test: solo para tests/control.test.js
})();
