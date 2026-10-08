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
  // Idioma (i18n, Fase 1): tx('Texto en español', { vars }) → en inglés, su traducción; en español, tal cual (i18n.js).
  const I18 = window.ShowtimeI18n;
  const tx = (s, v) => I18 ? I18.tx(s, v) : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s);
  const LOCALE = () => (I18 && I18.getLang() === 'en' ? 'en-GB' : 'es-ES');
  const txEs = (s, v) => I18 ? I18.tx(s, v, 'es') : tx(s, v);   // lo que queda escrito (Deshacer, log): siempre en español

  // ── Estado (declarado antes de usarse) ───────────────────────────────
  let FEST = null, ORIG = null, CONFIG = Dt.getConfig();
  let BLOCKS = [], ALL_MODE = [], TAREAS = [], DAY_MISSING = '';
  const UNDO = [];                 // festivales anteriores (JSON), para «Deshacer»
  const UNDO_MAX = 30;
  // Ventanas Live de este Dashboard: id (= nombre técnico de la ventana) → { w, name, vista, zona, standby }. Lo que dice cada ventana se actualiza en vivo.
  const WIN = new Map();
  const LIVE_NAMES_KEY = 'showtime.liveNames';   // { id: nombre } de las ventanas abiertas, para recordar el nombre tras recargar
  const VISTA_OPCIONES = [['manager', 'Manager'], ['confidence', 'Confidence'], ['backstage', 'Backstage']];
  const Vs = window.ShowtimeVistas;
  let MSG_TO = null;                  // destino de los mensajes flash: null = todas las pantallas; si no, lista de vistas
  let MSG_ZONES = null;               // zonas de las pantallas Confidence que lo reciben: null = todas
  function zoneLabel(id) { const z = FEST && C.getEscenario(FEST, id); return z ? z.nombre : tx('Sin zona'); }
  const SPLASH_MS = 2500;   // pantalla de inicio (se va sola; clic o Esc la cierran antes)
  let pendingRender = false;       // si llegan datos mientras se edita una casilla, se pinta al salir
  const KEY_LABEL = { nombre: 'nombre', escenario: 'zona', color: 'color', tipo: 'tipo', jornada: 'jornada', fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'CALL', notas: 'notas' };
  const TIPO_TXT = { banda: 'banda', tarea: 'tarea', hito: 'marcador' };
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
    return new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
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
    t.textContent = I18 && I18.txBack ? I18.txBack(msg) : tx(msg); t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;   // los avisos fijos se traducen solos
    clearTimeout(toastT); clearTimeout(toastOut);
    toastOut = setTimeout(() => t.classList.add('out'), Math.max(0, d - 300));
    toastT = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, d);
  }
  function modeName(m) { return (m || CONFIG.mode) === 'sc' ? 'soundcheck' : 'show'; }
  function viewOf(m) { return VIEW[m || CONFIG.mode] || VIEW.show; }
  function viewLabel() { return tx(viewOf().short || viewOf().title) + (focusOn() ? ' · ' + tx('Foco') : ''); }
  // ── Modo foco (para operar en directo a 1-2 m): menos columnas, filas y letra más grandes. Preferencia de este equipo ──
  const FOCUS_KEY = 'showtime.panel.focus';
  function focusOn() { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch (e) { return false; } }
  function applyFocus() {
    const on = focusOn(), b = document.getElementById('btn-focus');
    document.body.classList.toggle('focus', on);
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.title = tx(on ? 'Modo foco ACTIVO: solo lo de directo, filas y letra más grandes. Clic: activar / desactivar (⇧⌘F)' : 'Modo foco: solo lo de directo, filas y letra más grandes. Clic: activar / desactivar (⇧⌘F)'); }
    const l = document.getElementById('view-lbl'); if (l) l.textContent = viewLabel();
  }
  function setFocus(on) { try { if (on) localStorage.setItem(FOCUS_KEY, '1'); else localStorage.removeItem(FOCUS_KEY); } catch (e) {} applyFocus(); }
  /** Modo de los campos de una fila (show o soundcheck), según su bloque. */
  function rowModeOf(b) { return b && b.kind === 'sc' ? 'sc' : CONFIG.mode === 'sc' && !b ? 'sc' : 'show'; }

  // ── Modal propio (sin alert/confirm del navegador) ───────────────────
  // actions: [{ label, kind, run, keep }] — keep:true no cierra (p. ej. si el formulario tiene errores: run devuelve false).
  function modal(title, html, actions, opts) {
    $('modal-title').textContent = tx(title);
    $('modal-body').innerHTML = html;
    $('modal').querySelector('.modal-box').classList.toggle('wide', !!(opts && opts.wide));
    const box = $('modal-actions');
    box.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn' + (a.kind ? ' ' + a.kind : '');
      b.textContent = tx(a.label);
      b.addEventListener('click', () => {
        let res;
        try { res = a.run ? a.run() : undefined; }
        catch (err) {   // un fallo no deja el botón «muerto»: se ve en el propio modal (y en la consola)
          console.error(err);
          let m = $('modal-fail');
          if (!m) { m = document.createElement('div'); m.id = 'modal-fail'; m.className = 'warnbox'; m.style.marginTop = '12px'; $('modal-body').appendChild(m); }
          m.textContent = tx('No se pudo completar: {err}. Mándame una captura de este aviso.', { err: (err && err.message) || err });
          return;
        }
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
  /** Cerrar al pulsar fuera de la caja. Solo si el clic empezó y acabó en el fondo (así no se cierra al seleccionar texto y soltar fuera). */
  function backdropClose(el, fn) {
    let down = null;
    el.addEventListener('pointerdown', e => { down = e.target; });
    el.addEventListener('click', e => { if (e.target === el && down === el) fn(); down = null; });
  }
  backdropClose($('modal'), closeModal);
  backdropClose($('imp'), () => closeImport());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // ── Carga de estado y cálculo ────────────────────────────────────────
  function loadState() {
    FEST = Dt.getFestival();
    ORIG = Dt.getOriginal();
    CONFIG = Dt.getConfig();
    if (window.ShowtimeI18n && window.ShowtimeI18n.setLang(CONFIG.lang)) paintLang();   // el idioma puede cambiar desde otra ventana
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
  function commitFestival(next0, msg0, lctx) {
    // msg0: texto, o [plantilla, variables] para que el aviso salga en el idioma activo (Deshacer y log, en español)
    // o { es, ui }: el texto en español (Deshacer, log) y el del aviso ya traducido
    const obj = msg0 && typeof msg0 === 'object' && !Array.isArray(msg0);
    const mm = obj ? [msg0.ui] : Array.isArray(msg0) ? msg0 : [msg0], msg = obj ? msg0.es : mm[0] ? txEs(mm[0], mm[1]) : mm[0];
    const prev = FEST, next = M.withBlk(next0, CONFIG);   // los bloqueos del menú Retrasos viajan con el evento (el desborde los respeta)
    UNDO.push({ s: JSON.stringify(FEST), m: undoTxt(msg) });
    if (UNDO.length > UNDO_MAX) UNDO.shift();
    FEST = next;
    Dt.setFestival(FEST);
    logCommit(prev, next, lctx);
    compute();
    renderAll();
    if (msg) toast(tx(mm[0], mm[1] && mm[1].tr ? Object.assign({}, mm[1], mm[1].tr.reduce((o, k) => (o[k] = tx(mm[1][k]), o), {})) : mm[1]));   // tr: variables que también se traducen («tarea» → «task»)
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
    $('btn-undo').querySelector('span').textContent = UNDO.length ? tx('Deshacer ({n})', { n: UNDO.length }) : tx('Deshacer');
    $('btn-undo').title = UNDO.length ? tx('Deshacer ({n}): {what} (⌘Z)', { n: UNDO.length, what: UNDO[UNDO.length - 1].m }) : tx('Nada que deshacer');
    $('fest-name').textContent = has ? ((FEST.event && FEST.event.nombre) || tx('Evento sin nombre')) : tx('Sin evento');
    const d = has && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    $('mods').hidden = !d.total;
    $('mods').textContent = tx('{n} sin exportar', { n: d.total });
    $('mods').title = d.total ? [d.added && tx('{n} banda(s) nueva(s)', { n: d.added }), d.removed && tx('{n} borrada(s)', { n: d.removed }), d.fields && tx('{n} casilla(s) cambiada(s)', { n: d.fields }), d.festival && tx('datos del evento o zonas')].filter(Boolean).join(' · ') : '';
    renderTools();
    renderWarn();
    if (!$('cfg').hidden) renderConfig();
    // Sin entradas: en vez de la tabla vacía, la tarjeta de «Importar horario en 1 segundo»
    const empty = has && !(FEST.artists || []).length;
    $('list-empty').hidden = !empty;
    $('main').classList.toggle('vacia', empty);   // sin entradas: la columna de En escena/Siguiente/CALL (vacía) se esconde y la tarjeta queda centrada
    document.querySelector('.tblwrap').hidden = empty;
    if (has) { renderTable(); renderAddRow(); tick(); }
  }

  function renderTools() {
    document.querySelectorAll('#m-view [data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === CONFIG.mode); b.setAttribute('aria-checked', String(b.dataset.mode === CONFIG.mode)); });
    $('view-lbl').textContent = viewLabel();
    $('day-lbl').textContent = CONFIG.day === 'all' ? tx('Todos') : fmtDay(CONFIG.day);
    renderDelayCats();
    // Pestañas de jornadas: «Todas» + de la primera a la última del festival (las vacías, atenuadas)
    const days = jornadaOptions();
    const withData = FEST ? C.festivalDays(FEST, CONFIG.mode) : [];
    const tab = (v, label, cls, title) => '<button role="tab" data-day="' + esc(v) + '" class="' + cls + (CONFIG.day === v ? ' on' : '') + '" aria-selected="' + (CONFIG.day === v) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
    let html = FEST ? tab('all', tx('Todas'), '', tx('Todas las jornadas')) : '';
    html += days.map(d => tab(d, fmtDay(d), withData.indexOf(d) < 0 ? 'vacia' : '', withData.indexOf(d) < 0 ? tx('Sin {what} todavía', { what: tx(viewOf().what) }) : '')).join('');
    if (FEST && CONFIG.day !== 'all' && days.indexOf(CONFIG.day) < 0) html += tab(CONFIG.day, fmtDay(CONFIG.day), 'falta', tx('Fuera de las jornadas del evento'));
    $('days').innerHTML = html;
  }

  function renderWarn() {
    const w = $('warn');
    let msg = '';
    if (FEST && !(FEST.escenarios || []).length) msg = tx('Este evento no tiene zonas. Créalas en Configuración › Zonas o desde la columna Zona de cualquier fila.');
    else if (DAY_MISSING) msg = tx('El {dia} todavía no tiene {what}. La Pantalla Live lo está avisando.', { dia: fmtDay(DAY_MISSING), what: tx(viewOf().what) });
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
    const lbl = { banda: tx(mode === 'sc' ? 'Soundcheck' : 'Show'), tarea: tx('Tarea'), hito: tx('Marcador') };
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
    if (b.clash) sub = '<small class="clash">' + tx('pisada por {who}', { who: esc(b.clashWith) }) + '</small>';
    else if (b.live) sub = '<small class="chg">' + tx('tiempo extra · +{n} min', { n: Math.round(b.sf - b.nf) }) + '</small>';
    else if (b.ri !== null || b.rf !== null) sub = '<small class="' + (b.delta ? 'chg' : '') + '">' + tx('real') + (b.rf !== null && b.psf !== null && b.rf < b.psf ? tx(' · acaba {n} min antes', { n: b.psf - b.rf }) : '') + '</small>';
    else if (d) sub = '<small class="chg">' + (d > 0 ? '+' : '−') + tx('{n} min · estimado', { n: Math.abs(d) }) + '</small>';
    const same = !b.clash && !b.live && b.ri === null && b.rf === null && !d && (hito || b.sf === b.psf);
    const tip = (b.ri !== null ? tx('Inicio real {h}. ', { h: C.fmtHM(b.ri) }) : '') + (b.rf !== null ? tx('Fin real {h}. ', { h: C.fmtHM(b.rf) }) : '') +
      (b.man ? tx('Retraso manual +{n} min. ', { n: b.man }) : '') + (b.push ? tx('Desborde de la anterior: +{n} min. ', { n: b.push }) : '') +
      (b.alargar ? tx('TIEMPO EXTRA activado: puede gastar el colchón del cambio. ') : '') + (b.clash ? tx('Está fija (DELAY rojo o bloqueada) y la anterior la pisa. ') : '') +
      tx('Previsto {h}', { h: C.fmtHM(b.psi) }) + (b.psf !== null ? ' → ' + C.fmtHM(b.psf) : '') + '.' + (!hito && C.isBand(b) ? tx(' Doble clic: corregir la hora real de inicio.') : '');
    return '<td class="est' + (same ? ' same' : '') + (b.live ? ' live' : '') + '" title="' + esc(tip) + '"><span class="estt">' + dig(b.si, b.psi) +
      (hito || b.sf === null ? '' : '<span class="arr">→</span>' + dig(b.sf, b.psf)) + '</span>' + sub + '</td>';
  }
  /** Botón TIEMPO EXTRA (antes «Alargar»): la banda puede pasarse de su hora; gasta el colchón y, pasado, retrasa lo que viene hasta ■. */
  /** Minutos que lleva de tiempo extra (con Tiempo extra activado y pasada su hora), o null. */
  function xtraOver(b, now) { return b && b.alargar && b.rf === null && b.nf !== null && now >= b.nf ? Math.max(0, Math.floor(now - b.nf)) : null; }
  function xtraBtn(b, compact) {
    return '<button class="xtrabtn' + (compact ? ' sq' : '') + (b.alargar ? ' on' : '') + '" data-act="stretch" data-key="' + esc(b.key) + '" data-on="' + (b.alargar ? '0' : '1') + '" title="' +
      tx(b.alargar ? 'TIEMPO EXTRA activado: puede pasarse de su hora; gasta el colchón del cambio y, pasado, retrasa lo que viene de su zona hasta que pulses ■. Clic: desactivar'
        : 'Tiempo extra: si va a pasarse de su hora, actívalo. Gasta el colchón del cambio y, pasado, retrasa lo que viene de su zona hasta que pulses ■. Sin activarlo, se para a su hora') +
      '"><svg class="ic"><use href="#i-stretch"/></svg>' + (compact ? '' : tx(b.alargar ? 'Tiempo extra ✓' : 'Tiempo extra')) + '</button>';
  }
  /** ▶ si no tiene inicio real. ■ si ya empezó (con ▶ o, sin ▶, porque ya es su hora: modo pasivo). Tiempo extra hasta ■. */
  function liveBtns(b, band) {
    if (!b || !band || b.rf !== null) return '';
    const stop = '<button class="delbtn livebtn on' + (b.ri === null ? ' pasv' : '') + '" data-act="stop" title="' + (b.ri === null ? tx('Terminar ahora: fin real = ahora; el inicio se da por a su hora ({h})', { h: C.fmtHM(b.si) }) : tx('Terminar ahora: registra la hora real de fin')) + '"><svg class="ic"><use href="#i-stop"/></svg></button>';
    const alg = xtraBtn(b, true);
    if (b.ri === null) return '<button class="delbtn livebtn" data-act="start" title="' + tx('Empezar ahora: registra la hora real de inicio (opcional; sin pulsar, se da por a su hora)') + '"><svg class="ic"><use href="#i-play"/></svg></button>' + stop + alg;
    return stop + alg;
  }
  function marginChip(m) {
    const ends = tx('{who} acaba {h}', { who: esc(m.band.name), h: C.fmtHM(m.projEnd) });
    if (m.level === 'ok') return '<span class="mchip ok" title="' + tx('Margen hasta el marcador con el retraso actual ({ends})', { ends }) + '">' + tx('Margen {n}′', { n: m.margin }) + '</span>';
    if (m.level === 'tight') return '<span class="mchip tight" title="' + ends + '"><svg class="ic"><use href="#i-alert"/></svg>' + tx('Margen {n}′', { n: m.margin }) + '</span>';
    return '<span class="mchip over" title="' + ends + '"><svg class="ic"><use href="#i-alert"/></svg>' + tx('Rebasado +{n}′', { n: -m.margin }) + '</span>';
  }

  /** Tiempo extra desde el Panel. Pasada su hora (Bis / Extender prueba), pide confirmación con lo que va a pasar y queda en el log. */
  function applyStretch(key, on) {
    const r = M.stretchPlan(FEST, key, on, logNow(), CONFIG);
    if (!r.ok) { toast(r.error, true); return; }
    const go = p => commitFestival(p.state, p.msg, { noTimes: true, ev: [{ type: 'buffer', amber: p.late !== null && p.late !== undefined, text: p.msg }] });
    if (r.late === null || r.late === undefined) { go(r); return; }
    const sc = r.kind === 'sc';
    modal(i18t(sc ? 'bis.modalSc' : 'bis.modalShow'), '<p>' + esc(r.msg) + '</p>', [
      { label: 'Cancelar' },
      { label: i18t(sc ? 'bis.yesSc' : 'bis.yesShow'), kind: 'primary', run: () => { const p = M.stretchPlan(FEST, key, on, logNow(), CONFIG); if (!p.ok) { toast(p.error, true); return; } go(p); } }
    ]);
  }

  /** Corregir la hora REAL de inicio (doble clic en la columna de horas): si no se pudo pulsar ▶ a tiempo. */
  document.addEventListener('dblclick', e => {
    const td = e.target.closest && e.target.closest('td.est'); if (!td || !FEST) return;
    const tr = td.closest('tr'); if (!tr || !tr.dataset.key) return;
    const now = logNow(), b = C.buildBlocks(FEST, { mode: 'all', day: 'all', now }).find(x => x.key === tr.dataset.key);
    if (!b || !C.isBand(b)) return;
    if (b.ri === null && !(b.si !== null && b.si <= now)) { toast(tx('{who} aún no ha empezado: la hora real de inicio se corrige cuando ya ha empezado', { who: b.name }), true); return; }
    const cur = b.ri !== null ? b.ri : b.si;
    modal(tx('Hora real de inicio · {who}', { who: b.name }), '<p>' + (b.ri === null ? tx('Sin ▶: se dio por empezada a su hora ({h}).', { h: C.fmtHM(b.si) }) : tx('Inicio real registrado: {h}.', { h: C.fmtHM(b.ri) })) +
      tx(' Pon la hora a la que empezó de verdad: el retraso de la zona y el log se recalculan.') + '</p>' +
      '<div class="form"><label for="ri-t">' + tx('Empezó a las') + '</label><input id="ri-t" type="time" value="' + C.fmtHM(cur) + '"></div>', [
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
    if (r.clashes.length) setTimeout(() => toast(tx('Choque con entrada en rojo: {list}', { list: r.clashes.map(c => c.name + ' / ' + c.with).join(', ') }), true), 2800);
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
      const tail = !m ? '' : lv === 'over' ? tx(' · rebasado +{n} min', { n: -m.margin }) : tx(' · margen {n} min', { n: m.margin });
      const tip = m ? tx('{who} acaba {h}', { who: m.band.name, h: C.fmtHM(m.projEnd) }) : tx('Sin bandas antes en su zona');
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
    const av = (Dt.getAvisos ? Dt.getAvisos() : []).map(a => '<span class="dchip absorb aviso" title="' + esc((a.from ? a.from + ' · ' : '') + tx(a.ms ? 'aviso puntual' : 'aviso permanente: solo se quita con la ✕')) + '"><svg class="ic"><use href="#i-msg"/></svg>' +
      esc(a.text) + '<button class="avx" type="button" data-aviso-x="' + esc(a.id) + '" title="' + tx('Quitar aviso') + '" aria-label="' + tx('Quitar aviso') + '"><svg class="ic"><use href="#i-x"/></svg></button></span>').join('');
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
    const title = tx(red ? 'Rojo: no se mueve con los retrasos' : 'Verde: se mueve con los retrasos') +
      (own ? tx(' (puesto en esta entrada)') : catBlocked ? tx(' ({cat} bloqueados en Retrasos para esta zona)', { cat: tx(CAT_TXT[kind]).toLowerCase() }) : '') +
      tx(red ? '. Clic: pasar a verde' : '. Clic: pasar a rojo');
    return '<td class="dl"><button class="led' + (red ? ' red' : '') + (own ? ' own' : '') + '" data-act="fija" data-red="' + (red ? '1' : '') + '" data-cat="' + (catBlocked ? '1' : '') + '" title="' + title + '" aria-label="Delay"></button></td>';
  }

  /** Modo Foco: micro-píldora del tipo, legible a distancia, con color fijo por tipo (show · prueba · tarea · hito). */
  const PILL_TXT = { show: 'SHOW', sc: 'SOUNDCHECK', tarea: 'TAREA', hito: 'MARCADOR' };   // SOUNDCHECK en toda la app (terminología internacional)
  /** Texto de la píldora: SOUNDCHECK; en pantallas estrechas (CSS) se ve la forma corta SC. */
  function pillTxt(k) { return k === 'sc' ? '<span class="pl-l">SOUNDCHECK</span><span class="pl-s">SC</span>' : esc(tx(PILL_TXT[k] || '')); }
  function tipoPill(k) { return '<span class="tpill tp-' + k + '" aria-hidden="true">' + pillTxt(k) + '</span>'; }
  // Fila editable de una entrada (con o sin horario en la vista actual). b = su bloque (o null).
  function rowHtml(a, b, mods, isNew) {
    const mode = rowModeOf(b);
    const tipo = C.tipoOf(a), band = tipo === 'banda';
    const m = (mods[mode] || {})[a.id] || [];
    const v = k => C.fieldValue(a, mode, k);
    const isMod = k => m.indexOf(k) >= 0;
    const td = (k, cls, inner) => '<td class="' + cls + (isMod(k) ? ' mod' : '') + '"' + (isMod(k) ? ' title="' + tx('Cambiado desde la última importación/exportación') + '"' : '') + '>' + inner + '</td>';
    const inp = (k, ph) => '<input type="text" data-k="' + k + '" value="' + esc(v(k)) + '" data-orig="' + esc(v(k)) + '"' + (ph ? ' placeholder="' + ph + '"' : '') + ' autocomplete="off" spellcheck="false">';
    const esc0 = C.getEscenario(FEST, a.escenarioId);
    const scol = safeColor(esc0 && esc0.color, '#555');
    const col = hex6(C.artistColor(FEST, a), '#888888');
    const jor = C.jornadaOf(FEST, a, mode);
    const fecha = v('fecha');
    const real = (jor && fecha && fecha !== jor) ? '<span class="real" title="' + tx('Empieza antes de la hora de corte: cuenta como la jornada anterior') + '">' + tx('fecha real {d}', { d: esc(fmtDay(fecha)) }) + '</span>' : '';
    let gap = '<span class="dash"' + (band ? '' : ' title="' + tx('Las tareas y los marcadores no tienen changeover ni solapes') + '"') + '>—</span>';
    if (b && tipo === 'hito') { const hm = (MARGINS || []).find(x => x.hito.key === b.key); if (hm) gap = marginChip(hm); }
    if (b && band) {
      const co = C.changeoverBefore(ALL_MODE, ALL_MODE.find(x => x.key === b.key) || b, TAREAS);
      if (!co) gap = '<span class="dash" title="' + tx('Primera actuación de su zona') + '">—</span>';
      else if (co.mins < 0) gap = '<span class="gapbtn ovl" title="' + tx('Solapa {n} min: empieza antes de que acabe {who}', { n: -co.mins, who: esc(co.prev.name) }) + '">−' + (-co.mins) + '′</span>';
      else gap = b.standby
        ? '<button class="gapbtn sb" data-act="standby" data-on="0" title="' + tx('STANDBY · {n} min. Pulsa para volver a CHANGEOVER', { n: co.mins }) + '"><svg class="ic"><use href="#i-pause"/></svg>SB</button>'
        : co.idle
        ? '<button class="gapbtn idle" data-act="standby" data-on="1" title="' + tx('Sin actividad · {n} min: no es un cambio (misma banda, o hay una tarea de la zona en medio). Pulsa para marcarlo como STANDBY', { n: co.mins }) + '">— ' + co.mins + '′</button>'
        : '<button class="gapbtn" data-act="standby" data-on="1" title="' + tx('CHANGEOVER · {n} min. Pulsa para marcarlo como STANDBY (zona cerrada o descanso)', { n: co.mins }) + '"><svg class="ic"><use href="#i-swap"/></svg>' + co.mins + '′</button>';
    }
    const off = '<span class="dash" title="' + tx(tipo === 'hito' ? 'Un marcador es un momento: no tiene fin ni CALL' : 'Las tareas no tienen CALL') + '">—</span>';
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
      td('escenario', 'stage', '<input type="text" list="zones-dl" data-k="zona" value="' + esc(esc0 ? esc0.nombre : '') + '" data-orig="' + esc(esc0 ? esc0.nombre : '') + '" placeholder="' + tx(band ? '— zona —' : '— ninguna —') + '" style="--sc:' + scol + '" title="' + tx('Elige una zona o escribe una nueva para crearla') + '" autocomplete="off" spellcheck="false">') +
      '<td class="name' + (isMod('nombre') || isMod('color') ? ' mod' : '') + '"><div class="nm">' + tipoPill(band ? mode : tipo) +
        '<input type="color" data-k="color" value="' + col + '" data-orig="' + col + '" title="' + tx('Color de la banda') + '">' +
        '<input type="text" data-k="nombre" value="' + esc(a.nombre || '') + '" data-orig="' + esc(a.nombre || '') + '" autocomplete="off" spellcheck="false">' +
        (isNew ? '<span class="tag" title="' + tx('Creada desde la última importación/exportación') + '">' + tx('NUEVA') + '</span>' : '') + '</div></td>' +
      td('call', 't', band ? inp('call', '—') : off) +
      td('standby', 'gap', gap) +
      td('notas', 'n', inp('notas')) +
      '<td class="mo"><div class="more"><button class="delbtn morebtn" data-act="more" title="' + tx('Más: duplicar, borrar') + '"><svg class="ic"><use href="#i-dots"/></svg></button>' +
        '<div class="morep"><button class="delbtn dupbtn" data-act="dup" title="' + tx('Duplicar en otra jornada') + '"><svg class="ic"><use href="#i-copy"/></svg><span>' + tx('Duplicar') + '</span></button>' +
        '<button class="delbtn delb" data-act="del" title="' + tx('Borrar {what}', { what: tx(TIPO_TXT[tipo]) }) + '"><svg class="ic"><use href="#i-trash"/></svg><span>' + tx('Borrar') + '</span></button></div></div></td>' +
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
    $('list-title').textContent = tx(viewOf().title) + (CONFIG.day === 'all' ? ' · ' + tx('todas las jornadas') : ' · ' + fmtDay(CONFIG.day));
    // Ancho del selector de escenario según el nombre más largo (que «Escenario Alhambra» se lea entero)
    const longest = Math.max(8, ...(FEST.escenarios || []).map(e => String(e.nombre || '').length));
    $('tbl').style.setProperty('--escw', 'calc(' + (Math.min(longest, 26) * 1.12).toFixed(1) + 'ch + 26px)');   // negrita: un poco más que 1ch por letra
    const rows = BLOCKS.map(b => {
      const a = FEST.artists.find(x => String(x.id) === String(b.id));
      return a ? rowHtml(a, b, mods, nuevas.has(String(a.id))) : '';
    });
    $('tbody').innerHTML = rows.join('') || '<tr><td colspan="13" class="hint" style="padding:16px">' +
      (FEST.artists.length ? tx('No hay {what} en esta jornada. Añádelos abajo.', { what: tx(viewOf().what) }) : tx('Todavía no hay nada. Añade la primera entrada en la fila de abajo.')) + '</td></tr>';
    // Las vistas son FILTROS PUROS: Shows = solo shows, Soundchecks = solo soundchecks.
    // Solo en Jornada completa se listan las entradas sin ningún horario (si no, no se verían en ninguna parte).
    const sin = mode === 'all' ? FEST.artists.filter(a => !C.entersMode(a, 'all')) : [];
    $('tbody-sin').innerHTML = sin.length
      ? '<tr class="sec"><td colspan="13">' + tx('Sin horario ({n}) · elige jornada y escribe el inicio', { n: sin.length }) + '</td></tr>' + sin.map(a => rowHtml(a, null, mods, nuevas.has(String(a.id)))).join('')
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
  const ADD_PH = { show: 'Nombre de la banda', sc: 'Nombre de la banda', tarea: 'Tarea (p. ej. Comida técnicos)', hito: 'Marcador (p. ej. Puertas, Curfew)' };
  /** Hito: sin fin ni CALL. Tarea: sin CALL. Las casillas que no aplican se desactivan. */
  function syncAddTipo() {
    const t = $('add-tipo').value;
    $('btn-add').lastChild.textContent = tx('Añadir {what}', { what: tx(ADD_LABEL[t]) });
    $('addm-t').textContent = tx('Añadir {what}', { what: tx(ADD_LABEL[t]) });
    $('add-nombre').placeholder = tx(ADD_PH[t]);
    $('add-fin').disabled = t === 'hito'; if (t === 'hito') $('add-fin').value = '';
    $('add-call').disabled = t === 'tarea' || t === 'hito'; if ($('add-call').disabled) $('add-call').value = '';
    $('add-call-hint').textContent = $('add-call').disabled ? tx('las tareas y los marcadores no llevan CALL')
      : tx('vacío = {n} min antes del inicio (el de Configuración › Evento)', { n: Dt.callMinsOf(FEST, CONFIG) });
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
      if (f !== d.jornada) h = tx('{h} es antes de la hora de corte ({cut}): jornada {jor}, fecha real {fecha}.', { h: ini, cut: FEST.event.dayCutoff || C.DEFAULT_CUTOFF, jor: fmtDay(d.jornada), fecha: fmtDay(f) });
    }
    const dur = String(d.duracion || '').trim();
    if (ini && /^\d+$/.test(dur)) h += (h ? ' ' : '') + tx('Fin: {h}.', { h: C.fmtHM(C.parseHM(ini) + Number(dur)) });
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
    commitFestival(r.state, [fuera ? 'Añadido ({what}): {name} · se ve en Jornada completa' : CONFIG.day !== 'all' && CONFIG.day !== jor ? 'Añadido ({what}): {name} (en {dia}, no en la jornada que estás viendo)' : 'Añadido ({what}): {name}',
      { what: ADD_LABEL[t], name, dia: fmtDay(jor), tr: ['what'] }]);
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

  /** Bis (show) / Extender prueba (soundcheck) por zona: la última banda que ya acabó (sin ■ ni Tiempo extra) y aún dentro
   *  de la ventana (min(ajuste, cambio real), mando.js). Si la siguiente ya dio ▶, el botón sale desactivado; pasada la
   *  ventana, desaparece. Busca en TODAS las jornadas (pasada la hora de corte). { zoneId: { b, late, st } } */
  function bisCands(nowInt) {
    const last = {};
    ALL_MODE.forEach(b => {
      if (!C.isBand(b) || b.rf !== null || b.alargar || b.nf === null || b.nf > nowInt) return;
      const z = b.stageId || '';
      if (!last[z] || b.nf > last[z].nf) last[z] = b;
    });
    const out = {};
    Object.keys(last).forEach(z => {
      const st = M.bisState(FEST, last[z], nowInt, CONFIG);
      if (st.ok || st.reason === 'next') out[z] = { b: last[z], late: st.late, st: st };
    });
    return out;
  }
  const i18t = (k, v) => window.ShowtimeI18n ? window.ShowtimeI18n.t(k, v) : k;   // texto en el idioma activo
  function bisBtnHtml(c) {
    const st = c.st || { ok: true, kind: c.b.kind === 'sc' ? 'sc' : 'show', late: c.late, left: 0 }, sc = st.kind === 'sc';
    const label = i18t(sc ? 'bis.sc' : 'bis.show', { name: c.b.name });
    const title = st.ok ? i18t(sc ? 'bis.titleSc' : 'bis.titleShow', { name: c.b.name, late: st.late, left: st.left }) : i18t('bis.next', { next: st.next ? st.next.name : '' });
    return '<button class="xtrabtn bis' + (sc ? ' sc' : '') + '" data-act="stretch" data-key="' + esc(c.b.key) + '" data-on="1" title="' + esc(title) + '"' + (st.ok ? '' : ' disabled') + '><svg class="ic"><use href="#i-undo"/></svg>' + esc(label) + '</button>';
  }

  // Vista en vivo (mismas reglas que la Pantalla Live)
  function renderLive(nowMins, nowInt) {
    const order = id => { const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === id); return i < 0 ? 999 : i; };
    const rows = [];
    const kindTag = b => CONFIG.mode === 'all' && b.kind === 'sc' ? tx('Soundcheck') + ' · ' : '';
    C.playingNow(BLOCKS, nowInt).forEach(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), p = C.progress(b, nowInt);
      rows.push({ o: order(b.stageId), h: '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + kindTag(b) + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + '</div>' +
        '<div class="v-rem" style="color:' + col + '">' + (xtraOver(b, nowInt) !== null ? tx('TIEMPO EXTRA · +{n} min', { n: xtraOver(b, nowInt) }) : tx('{n} min restantes', { n: p.remaining }) + (b.alargar && b.rf === null ? ' · ' + tx('tiempo extra') : '')) + '</div>' + (b.rf === null ? xtraBtn(b) : '') + '</div>' });
    });
    const bis = bisCands(nowInt), bisShown = new Set(), bisFor = z => { z = z || ''; if (!bis[z]) return ''; bisShown.add(z); return bisBtnHtml(bis[z]); };
    C.playingNow(BLOCKS, nowInt).forEach(b => bisShown.add(b.stageId || ''));   // la zona ya suena: ahí no se ofrece el bis
    C.changeoversNow(BLOCKS, nowMins, TAREAS).forEach(co => {
      const col = safeColor(co.stageColor || co.next.color, '#888');
      if (!co.standby && co.kind === 'idle') {      // hueco sin cambio real (decisión 76)
        rows.push({ o: order(co.stageId), h: '<div class="v-row co idle" style="--c:' + col + '"><div class="v-name" style="color:var(--muted)">' + tx('— SIN ACTIVIDAD —') + (co.stage ? ' · ' + esc(co.stage) : '') + '</div>' +
          '<div class="v-meta">' + tx('después') + ' <b>' + esc(co.next.name) + '</b> · ' + C.fmtHM(co.next.si) + '</div>' + (co.prev ? '' : bisFor(co.stageId)) + '</div>' });
        return;
      }
      rows.push({ o: order(co.stageId), h: '<div class="v-row co' + (co.standby ? ' sb' : '') + '" style="--c:' + col + '"><div class="v-name" style="color:' + (co.standby ? 'var(--muted)' : col) + '">' +
        (co.standby ? 'STANDBY' : 'CHANGEOVER') + (co.stage ? ' · ' + esc(co.stage) : '') + '</div>' +
        '<div class="v-meta">' + tx(co.standby ? 'después' : 'entra') + ' <b>' + esc(co.next.name) + '</b> · ' + C.fmtHM(co.next.si) + '</div>' +
        '<div class="v-rem">' + tx('quedan {t}', { t: fmtCountdown(co.remaining) }) + '</div>' + bisFor(co.stageId) + '</div>' });
    });
    // Zonas cuya última banda acaba de terminar sin tarjeta de cambio (fin de la noche, o pasada la hora de corte): el bis sigue a mano
    Object.keys(bis).filter(z => !bisShown.has(z)).forEach(z => {
      const c = bis[z], col = safeColor(c.b.stageColor || c.b.color, '#888');
      rows.push({ o: order(z), h: '<div class="v-row co ended" style="--c:' + col + '"><div class="v-name" style="color:var(--muted)">' + tx('ACABÓ') + ' · ' + esc(c.b.name) + (c.b.stage ? ' · ' + esc(c.b.stage) : '') + '</div>' +
        '<div class="v-meta">' + tx('a las {h} · hace {n} min', { h: C.fmtHM(c.b.nf), n: c.late }) + '</div>' + bisBtnHtml(c) + '</div>' });
    });
    // Tareas en curso (operativa del día): debajo de los escenarios, sin cuenta de cambio
    C.tasksNow(BLOCKS, nowInt).forEach(b => {
      const p = C.progress(b, nowInt), nb = C.nextBandIn(BLOCKS, b.stageId, nowInt);
      rows.push({ o: b.stageId ? order(b.stageId) : 1000, h: '<div class="v-row tarea"><div class="v-name">' + tx('Tarea') + ' · ' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + '–' + C.fmtHM(C.blockEnd(b)) + (b.stage ? ' · ' + esc(b.stage) : '') + ' · ' + tx('quedan {n} min', { n: p.remaining }) + '</div>' +
        (nb ? '<div class="v-meta">' + tx('después') + ' <b>' + esc(nb.name) + '</b> · ' + C.fmtHM(nb.si) + '</div>' : '') + '</div>' });
    });
    rows.sort((a, b) => a.o - b.o);
    const r = C.pickBlocks(BLOCKS, nowInt, 1);
    $('v-now').innerHTML = rows.length ? rows.map(x => x.h).join('') : '<div class="v-empty">' + (DAY_MISSING ? tx('Jornada sin datos') : r.ended ? tx('FIN DE JORNADA') : '—') + '</div>';

    const next = C.nextPerStage(BLOCKS, nowInt);
    $('v-next').innerHTML = next.length ? next.map(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), co = C.changeoverBefore(BLOCKS, b, TAREAS);
      const badge = co ? (co.mins < 0 ? tx('Solapa {n} min', { n: -co.mins }) : b.standby ? tx('Standby {n} min', { n: co.mins }) : co.idle ? '' : tx('Cambio {n} min', { n: co.mins })) : '';
      return '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + kindTag(b) + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + (badge ? ' · ' + badge : '') + '</div></div>';   // sin Tiempo extra: solo tiene sentido para la que suena (o el bis)
    }).join('') : '<div class="v-empty">—</div>';

    const done = new Set(Dt.getCallDone());
    const calls = C.callList(BLOCKS, nowInt, Dt.callMinsOf(FEST, CONFIG), done);
    $('v-call').innerHTML = calls.length ? calls.map(b => {
      const col = safeColor(b.stageColor || b.color, '#ffc533');
      return '<div class="v-row v-call" style="--c:' + col + '"><div><div class="v-name" style="color:' + col + '">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + (b.stage ? esc(b.stage) + ' · ' : '') + tx('en {n} min', { n: Math.max(1, Math.round(b.si - nowInt)) }) + ' · ' + C.fmtHM(b.si) + '</div></div>' +
        '<button class="okbtn" data-ck="' + esc(C.callKey(b)) + '" title="' + tx('Marcar como avisado') + '">OK</button></div>';
    }).join('') : '<div class="v-empty">—</div>';
    $('card-call').classList.toggle('hot', calls.length > 0);
  }

  function tick() {
    const d = new Date();
    $('clock').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    const nOpen = openIds().length;
    $('live-state').className = 'state ' + (nOpen ? 'on' : 'off');
    $('live-state').title = nOpen ? (nOpen === 1 ? tx('1 Pantalla Live abierta') : tx('{n} Pantallas Live abiertas', { n: nOpen })) : tx('Ninguna Pantalla Live abierta');
    $('btn-live').title = tx('Pantallas Live: Manager, Confidence (por zona) y Backstage');
    if ($('lv-closeall')) $('lv-closeall').hidden = nOpen < 2;
    if ($('lv-standby')) {
      const on = standbyOn();
      $('lv-standby-on').classList.toggle('on', on);
      $('lv-standby-t').textContent = tx(on ? 'Quitar Standby en Confidence' : 'Standby en Confidence');
    }
    renderGestor();
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
      commitFestival(rz.state, [z.id ? (z.created ? '{name}: zona → {zona} (zona nueva creada)' : '{name}: zona → {zona}') : '{name}: zona → sin zona', { name: nm, zona: z.id ? (z.created ? z.name : C.getEscenario(rz.state, z.id).nombre) : '' }]);
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
    let shown = r.value || '—', trv = false;
    if (k === 'jornada') shown = fmtDay(r.value);
    else if (k === 'escenario') { const e = C.getEscenario(r.state, r.value); shown = e ? e.nombre : 'sin zona'; trv = !e; }
    else if (k === 'tipo') { shown = TIPO_TXT[r.value]; trv = true; }
    const fuera = k === 'tipo' && CONFIG.mode !== 'all' && r.value !== 'banda';
    commitFestival(r.state, [fuera ? '{name}: {campo} → {valor} (se ve en Jornada completa)' : '{name}: {campo} → {valor}', { name, campo: KEY_LABEL[k], valor: shown, tr: trv ? ['campo', 'valor'] : ['campo'] }]);
    const row = document.querySelector('#tbody tr[data-id="' + CSS.escape(String(id)) + '"], #tbody-sin tr[data-id="' + CSS.escape(String(id)) + '"]');
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
    else if (k === 'jornada' || k === 'inicio') toast(tx('{name}: ahora está en {dia} (fuera de la jornada que estás viendo)', { name, dia: fmtDay(C.jornadaOf(FEST, FEST.artists.find(a => String(a.id) === String(id)), rmode)) }));
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
        if (r.ok && r.changed) commitFestival(r.state, [wantRed ? '{n}: DELAY rojo (no se mueve con los retrasos){c}' : '{n}: DELAY verde (se mueve con los retrasos){c}', { n: nm, c: flag ? '' : ' · como su categoría', tr: ['c'] }]);
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
    modal(tx('Borrar {t}', { t: tx(TIPO_TXT[t]) }), '<p>' + tx(has.length ? '¿Borrar <b>{n}</b> con su horario de {h}?' : '¿Borrar <b>{n}</b>?', { n: esc(a.nombre), h: has.join(' ' + tx('y') + ' ') }) + '</p><p style="margin-top:8px">' + tx('Se puede recuperar con Deshacer.') + '</p>',
      [{ label: 'Cancelar' }, { label: 'Borrar', kind: 'danger', run: () => { const r = C.removeArtist(FEST, id); if (r.ok) commitFestival(r.state, ['Borrada: {n} (Deshacer para recuperarla)', { n: a.nombre }]); } }]);
  }

  // Duplicar en otra jornada: copia escenario, color y notas; la hora la escribe el regidor.
  function askDuplicate(id, rmode) {
    const a = FEST.artists.find(x => String(x.id) === String(id)); if (!a) return;
    const e0 = C.getEscenario(FEST, a.escenarioId), t = C.tipoOf(a);
    const html = '<p>' + tx(t === 'banda' ? 'Copia <b>{n}</b>{z} con su color y notas en otra jornada de {m}.' : 'Copia <b>{n}</b>{z} con su color y notas en otra jornada ({m}).', { n: esc(a.nombre), z: e0 ? ' (' + esc(e0.nombre) + ')' : '', m: t === 'banda' ? modeName(rmode) : tx(TIPO_TXT[t]) }) + '</p>' +
      '<div class="form" style="margin-top:12px">' +
      '<label for="d-nombre">' + tx('Nombre') + '</label><input id="d-nombre" type="text" value="' + esc(a.nombre) + '" autocomplete="off">' +
      '<label for="d-jor">' + tx('Jornada') + '</label>' + jornadaSelect('', 'id="d-jor"') +
      '<label for="d-ini">' + tx('Inicio') + '</label><input id="d-ini" type="text" placeholder="21:00" style="width:90px" autocomplete="off">' +
      '<label for="d-fin">' + tx('Fin') + '</label><div><input id="d-fin" type="text" placeholder="' + tx('fin') + '" style="width:90px" autocomplete="off"> ' + tx('o') + ' <input id="d-dur" type="text" inputmode="numeric" placeholder="min" style="width:70px" autocomplete="off"> min</div>' +
      '<label for="d-call">CALL</label><input id="d-call" type="text" placeholder="—" style="width:90px" autocomplete="off">' +
      '<div id="d-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
    modal('Duplicar en otra jornada', html, [{ label: 'Cancelar' }, { label: 'Duplicar', kind: 'primary', run: () => {
      const r = C.duplicateArtist(FEST, id, rmode, { nombre: $('d-nombre').value, jornada: $('d-jor').value, inicio: $('d-ini').value, fin: $('d-fin').value, duracion: $('d-dur').value, call: $('d-call').value });
      if (!r.ok) { $('d-err').textContent = r.error; return false; }
      const jor = $('d-jor').value;
      commitFestival(r.state, [CONFIG.day !== 'all' && CONFIG.day !== jor ? 'Duplicada: {n} en {d} (no es la jornada que estás viendo)' : 'Duplicada: {n} en {d}', { n: a.nombre, d: fmtDay(jor) }]);
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
    $('daybar-txt').textContent = tx('{a} terminado · ¿pasar a {b}?', { a: cap(fmtDayLong(r.done)), b: fmtDayLong(r.next) });
    $('daybar-btn').textContent = tx('Pasar a {d}', { d: fmtDay(r.next) });
    $('daybar-btn').dataset.day = r.next;
  }
  function fmtDayLong(iso) {
    const i = C.dayIndex(iso);
    return i === null ? iso : new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString(LOCALE(), { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  $('daybar-btn').addEventListener('click', e => {
    const d = e.currentTarget.dataset.day; if (!d) return;
    CONFIG = Dt.setConfig({ day: d }); compute(); renderAll();
    toast(tx('Jornada: {d}', { d: fmtDay(d) }));
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
      '<label for="f-nombre">' + tx('Nombre') + '</label><input id="f-nombre" type="text" value="' + esc(ev.nombre || '') + '" autocomplete="off">' +
      '<label for="f-ini">' + tx('Primera jornada') + '</label><input id="f-ini" type="date" value="' + esc(ev.fechaInicio || '') + '">' +
      '<label for="f-fin">' + tx('Última jornada') + '</label><input id="f-fin" type="date" value="' + esc(ev.fechaFin || '') + '">' +
      '<label for="f-cut">' + tx('Hora de corte') + '</label><input id="f-cut" type="text" value="' + esc(ev.dayCutoff || C.DEFAULT_CUTOFF) + '" style="width:90px">' +
      '<div class="note">' + tx('Lo que empieza antes de esta hora cuenta como la jornada anterior (un DJ a las 02:00 del sábado es del viernes).') + '</div>' +
      '<label for="f-call">' + tx('Aviso CALL') + '</label><div><input id="f-call" type="number" min="1" max="180" value="' + esc(ev.callMins || C.DEFAULT_CALL_MINS) + '" style="width:90px"> ' + tx('min antes del inicio') + '</div>' +
      '<div class="note">' + tx('Se usa cuando una banda no tiene hora de CALL escrita.') + '</div>' +
      '<label for="f-comin">' + tx('Changeover mínimo') + '</label><div><input id="f-comin" type="number" min="0" max="180" value="' + esc(ev.coMin == null ? C.DEFAULT_CO_MIN : ev.coMin) + '" style="width:90px"> min</div>' +
      '<div class="note">' + tx('Lo mínimo para cambiar de banda. Con retraso, lo que sobra del cambio por encima de este mínimo es el colchón. Se puede personalizar por zona.') + '</div>' +
      '<div id="f-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
  }
  function readFestForm() {
    return { nombre: $('f-nombre').value, fechaInicio: $('f-ini').value, fechaFin: $('f-fin').value || $('f-ini').value, dayCutoff: $('f-cut').value, callMins: $('f-call').value, coMin: $('f-comin').value };
  }

  function askNew() {
    const d = FEST && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    let html = festForm({});
    if (d.total) html += '<div class="warnbox" style="margin-top:12px">' + tx('El evento actual tiene {n} cambio(s) sin exportar y se sustituirá. Exporta antes si los quieres guardar.', { n: d.total }) + '</div>';
    else if (FEST) html += '<p style="margin-top:12px">' + tx('El evento actual («{name}») se sustituirá. Está guardado si lo exportaste.', { name: esc(FEST.event && FEST.event.nombre) }) + '</p>';
    const acts = [{ label: 'Cancelar' }];
    if (d.total) acts.push({ label: 'Exportar el actual', run: () => { exportJSON(); setTimeout(askNew, 300); } });
    acts.push({ label: 'Crear evento', kind: 'primary', run: () => {
      const r = C.newFestival(readFestForm());
      if (!r.ok) { $('f-err').textContent = r.error; return false; }
      loadNew(r.state, tx('Evento creado: {name}. Ahora crea las zonas.', { name: r.state.event.nombre }));
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
        box.innerHTML = festForm(FEST.event) + '<div class="row end" style="margin-top:12px"><button id="f-save" class="btn primary">' + tx('Guardar datos del evento') + '</button></div>';
        $('f-save').addEventListener('click', saveFest);
        box.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveFest(); } }));
      }
      const sb = $('cfg-stages');
      if (!(ae && sb.contains(ae) && ae.matches('input[type=text]'))) { sb.innerHTML = stagesHtml(); bindStages(); }
    } else {
      $('cfg-fest').innerHTML = '<p class="hint">' + tx('Sin evento cargado. Crea uno con «Nuevo evento» o ábrelo con «Abrir» (barra superior).') + '</p>';
      $('cfg-stages').innerHTML = '<p class="hint">—</p>';
    }
    $('cfg-style-panel').value = panelStyle();
    $('cfg-style-live').value = CONFIG.style;
    if ($('cfg-bis-win')) $('cfg-bis-win').value = String(CONFIG.bisWindow || 10);
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
    pv.style.setProperty('--tk-speed', (sc.ticker.speed * 0.3) + 's');   // la vista previa va proporcional (más corta)
    // referencia del parpadeo: el mismo número en el mismo color y ritmo que verá la Live
    const bp = $('sc-bprev');
    if (bp) { bp.style.setProperty('--blink-speed', sc.conf.blinkSpeed + 's'); bp.style.color = sc.conf.overNum; bp.classList.toggle('still', !sc.conf.blink); }
  }
  function saveScreens(el) {
    const sc = JSON.parse(JSON.stringify(CONFIG.screens || Vs.normScreens()));
    const [g, k] = el.dataset.sc.split('.');
    const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.dataset.num !== undefined) ? Number(el.value) : el.value;
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
    return (st.length ? '' : '<p class="hint" style="margin-bottom:6px">' + tx('Todavía no hay zonas.') + '</p>') +
      st.map((e, i) => {
        const n = C.stageUse(FEST, e.id);
        return '<div class="stg" data-id="' + esc(e.id) + '">' +
          '<input type="color" data-s="color" value="' + hex6(e.color, '#888888') + '" title="' + tx('Color de la zona') + '">' +
          '<input type="text" data-s="nombre" value="' + esc(e.nombre) + '" data-orig="' + esc(e.nombre) + '" autocomplete="off">' +

          '<button class="iconsq" data-s="up" title="' + tx('Subir') + '"' + (i === 0 ? ' disabled' : '') + '><svg class="ic"><use href="#i-up"/></svg></button>' +
          '<button class="iconsq" data-s="down" title="' + tx('Bajar') + '"' + (i === st.length - 1 ? ' disabled' : '') + '><svg class="ic"><use href="#i-down"/></svg></button>' +
          '<button class="delbtn" data-s="del" title="' + tx(n ? 'Tiene bandas: muévelas o bórralas antes' : 'Borrar zona') + '"' + (n ? ' disabled' : '') + '><svg class="ic"><use href="#i-trash"/></svg></button>' +
          '<div class="stg-meta"><span class="use">' + (n === 1 ? tx('1 entrada') : tx('{n} entradas', { n })) + '</span>' +
          '<label class="comin" title="' + tx('Changeover mínimo de esta zona (vacío = el del evento)') + '">' + tx('Changeover mínimo') + ' <input type="number" min="0" max="180" data-s="comin" value="' + (Number.isFinite(e.coMin) ? e.coMin : '') + '" placeholder="' + C.coMinFor({ event: FEST.event, escenarios: [] }, '') + '" data-orig="' + (Number.isFinite(e.coMin) ? e.coMin : '') + '"> min</label></div></div>';
      }).join('') +
      '<div class="stg" style="border:0;margin-top:8px"><input id="s-new" type="text" placeholder="' + tx('Nueva zona (p. ej. Principal, Carpa, Catering)') + '" autocomplete="off"><button id="s-add" class="btn primary"><svg class="ic"><use href="#i-plus"/></svg>' + tx('Añadir') + '</button></div>' +
      '<div id="s-err" class="err" style="margin:6px 0 0"></div>' +
      '<p class="hint" style="margin-top:8px">' + tx('El orden es el de la Pantalla Live. Los cambios se aplican al momento y se pueden deshacer.') + '</p>';
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
      const saveCm = () => { if (cm.value !== cm.dataset.orig) stageCommit(C.updateStage(FEST, id, { coMin: cm.value }), cm.value === '' ? 'Changeover mínimo de la zona: el del evento' : ['Changeover mínimo de la zona: {n} min', { n: cm.value }]); };
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
    toast(tx('Estilo del Dashboard: {s}', { s: e.target.selectedOptions[0].textContent }));
  });
  // Ventana de Bis / Extender prueba (5 · 10 · 15 min): viaja con la configuración al Mando
  $('cfg-bis-win').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ bisWindow: Number(e.target.value) });
    toast(i18t('bis.cfgToast', { n: CONFIG.bisWindow }));
    tick();
  });
  $('cfg-style-live').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ style: e.target.value });
    toast(tx('Estilo de la Pantalla Live: {s}', { s: e.target.selectedOptions[0].textContent }));
  });
  applyPanelStyle(panelStyle());

  // ── Idioma (i18n): lo manda este Panel. Va en CONFIG.lang (guardada en este navegador) y viaja con la emisión,
  //    así que las pantallas Live y el Mando lo siguen solos. Las hojas impresas salen en el idioma activo. ──
  function paintLang() {
    const I = window.ShowtimeI18n; if (!I) return;
    const L = I.getLang(), b = $('btn-lang');
    if (b) { b.textContent = I.t('lang.short'); b.title = I.t('lang.btnTitle'); b.setAttribute('aria-label', I.t('lang.btnTitle')); }
    document.querySelectorAll('#cfg-lang [data-l]').forEach(x => { const on = x.dataset.l === L; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function setAppLang(l) {
    const I = window.ShowtimeI18n; if (!I) return;
    l = I.norm(l);
    if (CONFIG.lang !== l) CONFIG = Dt.setConfig({ lang: l });
    if (I.setLang(l)) toast(I.t('lang.changed'));
    paintLang();
  }
  /** Al cambiar de idioma (aquí o desde otra ventana): se vuelve a pintar todo lo que escribe el JS. */
  let I18_READY = false;   // hasta que el Panel termina de arrancar, el idioma solo se aplica (se pinta al final)
  function relang() {
    if (!I18_READY) return;
    try {
      applyFocus(); paintLang(); renderAll();
      ['staff', 'remote', 'produccion'].forEach(k => { const bx = $('cast-' + k); if (bx) bx.dataset.url = ''; });   // los paneles de emisión se rehacen enteros
      if ($('qr-big-svg')) $('qr-big-svg').dataset.url = '';
      renderCast(); renderChat(); renderMsgTo();
      if ($('card-msg')) $('card-msg').dataset.id = '';
      renderFlash();
      MT_HTML = ''; renderMeteo();
      if (!$('cfg').hidden) fillMeteoStatus();
      paintWake();
      renderDelayCats();
      if (!$('addm').hidden) syncAddTipo();
      if (IMP && !$('imp').hidden && IMP.read) impRender();
      if (SPOT.open) spotRender();
    } catch (e) { console.error(e); }
  }
  if (I18) I18.onChange(relang);
  $('btn-lang').addEventListener('click', () => setAppLang(window.ShowtimeI18n && window.ShowtimeI18n.getLang() === 'es' ? 'en' : 'es'));
  $('cfg-lang').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (b) setAppLang(b.dataset.l); });
  if (window.ShowtimeI18n) window.ShowtimeI18n.setLang(CONFIG.lang);
  paintLang();
  // Mensajes: colores y duración (se aplican al siguiente mensaje que se envíe)
  $('cfg-msg-bg').addEventListener('input', e => { CONFIG = Dt.setConfig({ msgBg: e.target.value }); fillMsgCfg(); });
  $('cfg-msg-fg').addEventListener('input', e => { CONFIG = Dt.setConfig({ msgFg: e.target.value }); fillMsgCfg(); });
  $('cfg-msg-secs').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ msgSecs: Number(e.target.value) }); fillMsgCfg();
    toast(tx('Duración de los mensajes: {s}', { s: e.target.selectedOptions[0].textContent }));
  });
  $('cfg-aviso-secs').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ avisoSecs: Number(e.target.value) }); fillMsgCfg();
    toast(tx('Duración de los avisos puntuales: {s} (los que ya están no cambian)', { s: e.target.selectedOptions[0].textContent }));
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
  const CAT_TXT = { show: 'Shows', sc: 'Soundchecks', tarea: 'Tareas', hito: 'Marcadores' };
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
      b.title = inh ? tx('Bloqueado para todas las zonas: quítalo con «Todas las zonas»') : '';
    });
    const any = Object.keys(CONFIG.delayBlock || {}).some(sc => CATS.some(k => (CONFIG.delayBlock[sc] || {})[k]));
    $('delay-on').hidden = !any;
    const zs = (FEST && FEST.escenarios) || [];
    const hasNoZone = !!(FEST && FEST.artists.some(a => !a.escenarioId));
    const mark = sc => CATS.some(k => blockOf(sc)[k]) ? ' ·  ' + tx('bloqueos') : '';
    const zh = '<option value="all">' + tx('Todas las zonas (global)') + mark('all') + '</option>' + zs.map(z => '<option value="' + esc(z.id) + '">' + esc(z.nombre) + mark(z.id) + '</option>').join('') +
      (hasNoZone ? '<option value="">' + tx('Sin zona') + mark('') + '</option>' : '');
    if ($('delay-zone').innerHTML !== zh) $('delay-zone').innerHTML = zh;
    $('delay-zone').value = zv;
    $('m-delay').querySelector('.mbtn').title = tx(any ? 'Hay categorías bloqueadas para los retrasos' : 'Todo se mueve con los retrasos (nada bloqueado)');
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
      '<div class="dw-row"><span class="dw-l">' + tx('Minutos') + '</span><div class="dw-mins">' + [5, 10, 15].map(m => '<button class="dtb" data-m="' + m + '">+' + m + '</button>').join('') +
        '<label class="dw-n">+ <input id="dw-n" type="number" min="1" max="600" value="5"> min</label></div></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Zonas') + '</span><div class="dtog" id="dw-zones"><button data-z="*">' + tx('Todas') + '</button>' + zones.map(z => '<button data-z="' + esc(z.id) + '">' + esc(z.nombre) + '</button>').join('') + (hasNoZone ? '<button data-z="">' + tx('Sin zona') + '</button>' : '') + '</div></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Jornada') + '</span>' + jornadaSelect(W.day, 'id="dw-day"') + '<span class="dw-l" style="width:auto;margin-left:8px">' + tx('desde') + '</span><input id="dw-from" type="text" value="' + W.from + '" placeholder="' + tx('inicio') + '" style="width:80px"><span class="hint">' + tx('vacío = toda la jornada · solo lo que aún no ha empezado') + '</span></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Bloquear') + '</span><span class="hint dw-hint">' + tx('además de lo que ya está en rojo') + '</span></div><div class="dw-row"><span class="dw-l"></span><div class="dtog block" id="dw-cats">' + ['all', 'show', 'sc', 'tarea', 'hito'].map(k => '<button data-cat="' + k + '">' + tx(({ all: 'Todos', show: 'Shows', sc: 'Soundchecks', tarea: 'Tareas', hito: 'Marcadores' })[k]) + '</button>').join('') + '</div></div>' +
      dwOverHtml(W.day, ZK) +
      '<div id="dw-prev" class="dw-prev"></div></div>';
    modal('Aplicar retraso en cascada', html, [{ label: 'Cancelar' }, { label: 'Aplicar retraso en cascada', kind: 'primary', run: () => {
      const r = dwCompute(W);
      if (!r || !r.moved.length) { toast('No hay nada que mover con esa selección', true); return false; }
      const zl = W.zones.length === ZK.length ? 'todas las zonas' : W.zones.map(z => z ? (C.getEscenario(FEST, z) || {}).nombre : 'sin zona').join(', ');
      const dmsg = 'Retraso +' + W.mins + ' min (' + zl + (W.from ? ', desde ' + C.normHM(W.from) : '') + '): ' + nEnt(r.moved.length, 'movida') + (r.kept.length ? ' · ' + keptTxt(r.kept.length) : '');
      // El aviso, en el idioma activo (el log y Deshacer, en español)
      const zlU = W.zones.length === ZK.length ? tx('todas las zonas') : W.zones.map(z => z ? (C.getEscenario(FEST, z) || {}).nombre : tx('sin zona')).join(', ');
      const ui = tx('Retraso +{n} min ({zonas}{desde}): {mov}{kept}', { n: W.mins, zonas: zlU, desde: W.from ? tx(', desde {h}', { h: C.normHM(W.from) }) : '',
        mov: r.moved.length === 1 ? tx('1 entrada movida') : tx('{n} entradas movidas', { n: r.moved.length }),
        kept: r.kept.length ? ' · ' + (r.kept.length === 1 ? tx('1 en rojo no se mueve') : tx('{n} en rojo no se mueven', { n: r.kept.length })) : '' });
      commitFestival(r.state, { es: dmsg, ui }, { noTimes: true, ev: [{ type: 'delay', text: dmsg, jors: [W.day], amber: true }] });
    } }], { wide: true });
    const box = $('modal-body');
    const paint = () => {
      box.querySelectorAll('.dtb').forEach(b => b.classList.toggle('on', +b.dataset.m === W.mins));
      const all = CATS.every(k => W.block[k]);
      box.querySelectorAll('#dw-cats [data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === 'all' ? all : !!W.block[b.dataset.cat]));
      box.querySelectorAll('#dw-zones [data-z]').forEach(b => b.classList.toggle('on', b.dataset.z === '*' ? W.zones.length === ZK.length : W.zones.indexOf(b.dataset.z) >= 0));
      const r = dwCompute(W);
      const prev = box.querySelector('#dw-prev');
      if (!r) { if (prev) prev.innerHTML = '<p class="err">' + tx('Elige la jornada y una hora «desde» válida (HH:MM) o déjala vacía.') + '</p>'; $('modal-actions').querySelector('.primary').disabled = true; return; }
      const rows = r.moved.map(m => '<tr><td>' + esc(m.name) + '</td><td class="dim">' + esc(m.stage || '—') + '</td><td class="dim">' + tx(({ show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Marcador' })[m.kind]) + '</td><td class="t">' + C.fmtHM(m.from) + '</td><td class="t to">' + C.fmtHM(m.to) + '</td></tr>').join('') +
        r.kept.map(k => '<tr class="kept"><td><span class="led red sm"></span>' + esc(k.name) + '</td><td class="dim">' + esc(k.stage || '—') + '</td><td class="dim">' + tx(({ show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Marcador' })[k.kind]) + '</td><td class="t">' + C.fmtHM(k.at) + '</td><td class="t">' + tx('no se mueve') + '</td></tr>').join('');
      if (prev) prev.innerHTML = (r.clashes.length ? '<div class="errbox"><svg class="ic"><use href="#i-alert"/></svg>' + r.clashes.map(c => tx('{a} choca con «{b}» ({h}, DELAY rojo)', { a: esc(c.name), b: esc(c.with), h: C.fmtHM(c.at) })).join('<br>') + '</div>' : '') +
        (rows ? '<table class="dw-t"><thead><tr><th>' + tx('Entrada') + '</th><th>' + tx('Zona') + '</th><th>' + tx('Tipo') + '</th><th>' + tx('Antes') + '</th><th>' + tx('Después') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
              : '<p class="hint">' + tx(!W.zones.length ? 'Marca qué zonas se retrasan.' : CATS.every(k => W.block[k]) ? 'Todas las categorías están bloqueadas.' : 'No hay entradas pendientes con esa selección.') + '</p>');
      $('modal-actions').querySelector('.primary').disabled = !r.moved.length;
      $('modal-actions').querySelector('.primary').textContent = r.moved.length ? tx('Aplicar retraso en cascada ({n})', { n: r.moved.length }) : tx('Aplicar retraso en cascada');
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
      toast(tx('Desborde de {who}: +{n} min a las demás zonas · revisa y aplica', { who: b.dataset.who, n: W.mins }));
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
    return '<div class="dw-row top"><span class="dw-l">' + tx('Desbordes') + '</span><div class="dw-over">' + list.map(b =>
      '<div class="dwo"><span><b>' + esc(b.pushFrom) + '</b> · ' + tx('+{n} min en {zona}', { n: b.push, zona: esc(b.stage || tx('Sin zona')) }) + ' <span class="hint">' + tx('(ya aplicado en su zona)') + '</span></span>' +
      (ZK.length > 1 ? '<button type="button" class="btn" data-over="' + b.push + '" data-zone="' + esc(b.stageId || '') + '" data-who="' + esc(b.pushFrom) + '">' + tx('Aplicar a otras zonas') + '</button>' : '') + '</div>').join('') + '</div></div>';
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
  // Cada ventana tiene un id, un nombre que pone el regidor (se recuerda en este navegador) y una vista que se puede cambiar
  // desde el gestor («Live ▾ › Gestionar ventanas»). El standby es por ventana.
  function winNames() { try { return JSON.parse(localStorage.getItem(LIVE_NAMES_KEY)) || {}; } catch (e) { return {}; } }
  function saveWinName(id, name) {
    const n = winNames(); delete n[id]; n[id] = name;            // el último va al final: así se poda lo más viejo
    const keys = Object.keys(n); while (keys.length > 30) delete n[keys.shift()];
    try { localStorage.setItem(LIVE_NAMES_KEY, JSON.stringify(n)); } catch (e) {}
  }
  function forgetWinName(id) { const n = winNames(); if (!(id in n)) return; delete n[id]; try { localStorage.setItem(LIVE_NAMES_KEY, JSON.stringify(n)); } catch (e) {} }
  /** ¿Sigue abierta la ventana? Sin id: ¿hay alguna abierta desde este Dashboard? */
  function liveOpen(id) {
    if (id) { const x = WIN.get(id); return !!(x && x.w && !x.w.closed); }
    return Array.from(WIN.values()).some(x => x.w && !x.w.closed);
  }
  function openIds() { return Array.from(WIN.keys()).filter(id => liveOpen(id)); }
  /** Zonas para Confidence: las del evento y «Sin zona» si hay bandas sin zona. */
  function zonasLive() {
    const zs = FEST ? (FEST.escenarios || []).map(z => ({ id: z.id, name: z.nombre, color: z.color })) : [];
    if (FEST && C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) zs.push({ id: '', name: tx('Sin zona'), color: '#888' });
    return zs;
  }
  /** Menú de Live: solo las zonas para abrir Confidence (lo abierto se ve en el gestor). */
  function renderLiveMenu() {
    const box = $('lv-zones'); if (!box) return;
    if (!FEST) { box.innerHTML = '<p class="mnote">' + tx('Sin evento cargado.') + '</p>'; return; }
    const h = zonasLive().map(z => '<button class="mitem lvz" data-vista="confidence" data-zona="' + esc(z.id) + '"><i style="background:' + esc(safeColor(z.color, '#888')) + '"></i>' + esc(z.name) + '</button>').join('');
    if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
  }
  /** Abre una Pantalla Live nueva (cada vez una ventana nueva: puede haber varias de la misma vista). Con un segundo monitor, se abre en él. */
  async function openLive(vista, zona) {
    const v = Vs.normVista(vista), name = 'lv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let url = Vs.liveUrl('', v, v === 'confidence' ? (zona || '') : null), feats = 'popup=yes,width=1280,height=720', target = null;
    if ('getScreenDetails' in window) {
      try { const sd = await window.getScreenDetails(); target = Vs.pickScreen(sd.screens, sd.currentScreen); } catch (e) { target = null; }
      if (target) { feats = 'popup=yes,left=' + target.availLeft + ',top=' + target.availTop + ',width=' + target.availWidth + ',height=' + target.availHeight; url += '&aviso=f'; }
    } else url += '&aviso=arrastra';
    const label = Vs.VISTA_TXT[v] + (v === 'confidence' ? ' · ' + ((C.getEscenario(FEST, zona) || {}).nombre || tx('Sin zona')) : '');
    const done = w => {
      WIN.set(name, { w, name: label, vista: v, zona: v === 'confidence' ? (zona || '') : null, standby: false }); saveWinName(name, label); Dt.addPeer(w); tick();
      toast(target ? tx('Live {l} abierta en el monitor {m} · pulsa F en ella para pantalla completa', { l: label, m: target.label || tx('externo') })
        : url.indexOf('aviso=arrastra') > 0 ? tx('Live {l} abierta: arrástrala al monitor y pulsa F (este navegador no puede llevarla solo)', { l: label }) : tx('Live {l} abierta', { l: label }));
    };
    const w = window.open(url, name, feats);
    if (w) { done(w); return; }
    // El permiso de pantallas pudo gastar el «clic»: un segundo clic la abre
    modal('Abrir la Pantalla Live', '<p>' + (target ? tx('Listo para abrirla en el monitor <b>{m}</b>.', { m: esc(target.label || tx('externo')) }) : tx('El navegador ha frenado la ventana.')) + tx(' Pulsa «Abrir». Si no sale, permite las ventanas emergentes para Showtime (icono en la barra de direcciones).') + '</p>', [
      { label: 'Cancelar' },
      { label: 'Abrir', kind: 'primary', run: () => { const w2 = window.open(url, name, feats); if (w2) done(w2); else toast('Ventana emergente bloqueada', true); } }
    ]);
  }
  /** Cierra una ventana Live (o todas) desde aquí, esté en el monitor que esté. */
  function closeLive(id) {
    const ids = id ? [id] : Array.from(WIN.keys());
    ids.forEach(k => {
      const x = WIN.get(k);
      try { if (x && x.w && !x.w.closed) x.w.postMessage({ app: 'showtime', type: 'closeLive' }, '*'); } catch (e) {}
      try { if (x && x.w && !x.w.closed) x.w.close(); } catch (e) {}
      WIN.delete(k); forgetWinName(k);
    });
    tick();
    toast(id ? 'Ventana Live cerrada' : 'Ventanas Live cerradas');
  }
  /** Standby de UNA ventana (desde el gestor). Solo lo cambia esa ventana. */
  function setWinStandby(id, on) {
    const x = WIN.get(id); if (!x || !liveOpen(id)) return;
    x.standby = !!on;
    try { x.w.postMessage({ app: 'showtime', type: 'standby', on: !!on }, '*'); } catch (e) {}
    tick();
  }
  /** Cambia la vista (y la zona, si es Confidence) de UNA ventana desde el gestor. */
  function setWinVista(id, vista, zona) {
    const x = WIN.get(id); if (!x || !liveOpen(id)) return;
    x.vista = Vs.normVista(vista); x.zona = x.vista === 'confidence' ? (zona || '') : null;
    try { x.w.postMessage({ app: 'showtime', type: 'setVista', vista: x.vista, zona: x.zona }, '*'); } catch (e) {}
    tick();
  }
  // ── Standby / Modo Cartel: TODAS las Confidence (las de este Mac y las que van por QR) enseñan el cartel y la hora ──
  // Es un estado del evento (como los mensajes): viaja a las Live del Mac y va en la emisión. Manager y Backstage no cambian.
  function standbyOn() { const s = Dt.getStandby && Dt.getStandby(); return !!(s && s.on); }
  function setStandby(on) {
    Dt.setStandby(!!on);
    tick();
    toast(on ? 'Standby en Confidence: cartel y hora (también por QR)' : 'Standby en Confidence quitado: vuelve la cuenta atrás');
  }
  // ── Gestor de ventanas Live (Live ▾ › Gestionar ventanas…): nombre, vista (y zona) y standby de cada una ──
  let gvSig = null;
  function gestorVisible() { return !$('modal').hidden && $('modal-title').textContent === tx('Ventanas Live'); }
  function openGestor() { gvSig = null; modal('Ventanas Live', '<div id="gv"></div>', [], { wide: true }); renderGestor(); }
  function gvRowHtml(id) {
    const x = WIN.get(id);
    return '<div class="gv-row" data-id="' + esc(id) + '">' +
      '<input class="gv-name" type="text" maxlength="40" value="' + esc(x.name) + '" aria-label="' + tx('Nombre de la ventana') + '">' +
      '<select class="gv-vista" aria-label="' + tx('Vista') + '">' + VISTA_OPCIONES.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>' +
      '<select class="gv-zona" aria-label="' + tx('Zona') + '"></select>' +
      '<span class="gv-fs" aria-live="polite"></span>' +
      '<button class="gv-sb" type="button" data-gv="standby" aria-pressed="false"><i class="gv-led" aria-hidden="true"></i><span>Standby</span></button>' +
      '<button class="gv-x" type="button" data-gv="close" title="' + tx('Cerrar esta ventana') + '" aria-label="' + tx('Cerrar esta ventana') + '"><svg class="ic"><use href="#i-x"/></svg></button>' +
      '</div>';
  }
  /** Pone en cada fila lo que dice la ventana. No toca el nombre si lo estás escribiendo. */
  function gvSync(ids) {
    const box = $('gv'); if (!box) return;
    ids.forEach(id => {
      const x = WIN.get(id), row = Array.from(box.querySelectorAll('.gv-row')).find(r => r.dataset.id === id); if (!x || !row) return;
      const name = row.querySelector('.gv-name'), vs = row.querySelector('.gv-vista'), zs = row.querySelector('.gv-zona'), sb = row.querySelector('.gv-sb');
      if (name && document.activeElement !== name && name.value !== x.name) name.value = x.name;
      if (vs && vs.value !== x.vista) vs.value = x.vista;
      if (zs) {   // Manager y Backstage: el select queda deshabilitado con «—» (la rejilla no cambia)
        const conf = x.vista === 'confidence', want = conf ? zonasLive().map(z => '<option value="' + esc(z.id) + '">' + esc(z.name) + '</option>').join('') : '<option value="">—</option>';
        if (zs.dataset.h !== want) { zs.innerHTML = want; zs.dataset.h = want; }
        zs.disabled = !conf;
        const z = conf && x.zona != null ? x.zona : ''; if (zs.value !== z) zs.value = z;
      }
      const fe = row.querySelector('.gv-fs');
      if (fe) { const full = !!x.fs; fe.classList.toggle('on', full); fe.textContent = tx(full ? '⛶ Pantalla completa' : 'Ventana'); }
      if (sb) { const on = !!x.standby; sb.setAttribute('aria-pressed', String(on)); sb.classList.toggle('on', on); const t = sb.querySelector('span'); if (t) t.textContent = on ? 'STANDBY' : tx('Standby'); }
    });
  }
  function renderGestor() {
    if (!gestorVisible()) return;
    const box = $('gv'); if (!box) return;
    const ids = openIds(), sig = ids.join('|');
    if (sig !== gvSig) {
      gvSig = sig;
      const head = '<div class="gv-top"><div class="gv-seg"><button type="button" class="gv-segb" data-gv="all" data-on="1">' + tx('⏸ Todas en standby') + '</button><button type="button" class="gv-segb" data-gv="all" data-on="0">' + tx('▶ Reanudar todas') + '</button></div></div>';
      const hd = '<div class="gv-row gv-hd" aria-hidden="true"><span>' + tx('Nombre') + '</span><span>' + tx('Vista') + '</span><span>' + tx('Zona') + '</span><span>' + tx('Pantalla') + '</span><span>' + tx('Standby') + '</span><span></span></div>';
      const rows = ids.length ? hd + ids.map(gvRowHtml).join('') : '<p class="mnote gv-empty">' + tx('No hay ventanas Live abiertas desde este Dashboard.') + '</p>';
      const qr = '<div class="gv-qr"><div class="gv-qrh">' + tx('Pantallas QR') + '</div><p class="mnote">' + tx('Aún vacía: aquí irán las pantallas QR con la misma rejilla.') + '</p></div>';
      const foot = '<div class="gv-foot"><button type="button" class="btn" data-gv="new">' + tx('+ Abrir ventana Live') + '</button><button type="button" class="btn gv-close" data-gv="done">' + tx('Cerrar') + '</button></div>';
      box.innerHTML = head + '<div class="gv-list">' + rows + '</div>' + qr + foot;
    }
    gvSync(ids);
  }
  $('modal-body').addEventListener('change', e => {
    const t = e.target, row = t.closest && t.closest('.gv-row'); if (!row) return;
    const id = row.dataset.id, x = WIN.get(id); if (!x) return;
    if (t.classList.contains('gv-name')) {
      const n = String(t.value).replace(/\s+/g, ' ').trim().slice(0, 40) || x.name;
      x.name = n; t.value = n; saveWinName(id, n); return;
    }
    if (t.classList.contains('gv-vista') || t.classList.contains('gv-zona')) setWinVista(id, row.querySelector('.gv-vista').value, row.querySelector('.gv-zona').value);
  });
  $('modal-body').addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-gv]'); if (!b) return;
    if (b.dataset.gv === 'all') { openIds().forEach(id => setWinStandby(id, b.dataset.on === '1')); return; }
    if (b.dataset.gv === 'new') { openLive('manager', null); return; }
    if (b.dataset.gv === 'done') { closeModal(); return; }
    const row = b.closest('.gv-row'); if (!row) return;
    const id = row.dataset.id;
    if (b.dataset.gv === 'standby') setWinStandby(id, !(WIN.get(id) && WIN.get(id).standby));
    if (b.dataset.gv === 'close') closeLive(id);
  });
  document.addEventListener('click', e => {
    if (e.target.closest('#lv-standby')) { e.preventDefault(); e.stopPropagation(); closeMenus(); setStandby(!standbyOn()); return; }
    if (e.target.closest('#lv-gestor')) { e.preventDefault(); e.stopPropagation(); closeMenus(); openGestor(); return; }
    if (e.target.closest('#lv-closeall')) { closeLive(null); return; }
    const it = e.target.closest('#m-live [data-vista]'); if (!it) return;
    openLive(it.dataset.vista, it.dataset.zona);
  }, true);
  // Cada Live dice qué vista muestra, si está en standby y qué zona (al abrirse, al cambiar con la V y en el latido)
  window.addEventListener('message', e => {
    const m = e.data; if (!m || m.app !== 'showtime' || m.type !== 'vistaState') return;
    for (const x of WIN.values()) if (x.w === e.source) { x.vista = String(m.vista || x.vista || ''); x.zona = m.zona == null ? null : String(m.zona); x.standby = !!m.standby; x.fs = !!m.fs; }
    tick();
  });
  // Las ventanas que se abrieron antes de recargar el Dashboard se vuelven a presentar solas: se recuperan con su nombre.
  let peerN = 0;
  if (Dt.onPeer) Dt.onPeer((w, m) => {
    let id = m && typeof m.name === 'string' ? m.name : ''; if (!id) { try { id = w.name; } catch (e) {} }
    if (!id) id = 'peer-' + (++peerN);
    const old = WIN.get(id) || {};
    WIN.set(id, Object.assign({ name: winNames()[id] || 'Live', vista: '', zona: null, standby: false }, old, { w }));
    tick();
  });

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
      modal('No se puede abrir', '<div class="errbox">' + r.errors.map(esc).join('<br>') + '</div><p style="margin-top:10px">' + tx('Archivo: {f}', { f: esc(fname) }) + '</p>', [{ label: 'Cerrar' }]);
      return;
    }
    const s = r.state, ev = s.event || {};
    // Sin evento abierto y archivo limpio: se abre directamente (no hay nada que perder ni que avisar)
    if (!FEST && !r.warnings.length) { loadNew(s, tx('Evento abierto: {name}', { name: ev.nombre || fname })); return; }
    const dShow = C.festivalDays(s, 'show'), dSc = C.festivalDays(s, 'sc');
    const nT = s.artists.filter(a => C.tipoOf(a) === 'tarea').length, nH = s.artists.filter(a => C.tipoOf(a) === 'hito').length;
    let html = '<p>' + tx('Archivo: <b>{f}</b>', { f: esc(fname) }) + '</p><ul>' +
      '<li>' + tx('Evento: <b>{name}</b>', { name: esc(ev.nombre || tx('sin nombre')) }) + '</li>' +
      '<li>' + tx('{n} bandas', { n: s.artists.length - nT - nH }) + ' · ' + (nT ? tx('{n} tareas', { n: nT }) + ' · ' : '') + (nH ? tx('{n} marcadores', { n: nH }) + ' · ' : '') + tx('{n} zonas', { n: s.escenarios.length }) + '</li>' +
      '<li>Shows: ' + (dShow.length ? dShow.map(fmtDay).map(esc).join(', ') : tx('ninguno')) + '</li>' +
      '<li>Soundchecks: ' + (dSc.length ? dSc.map(fmtDay).map(esc).join(', ') : tx('ninguno')) + '</li>' +
      '<li>' + tx('Hora de corte: {cut} · aviso CALL: {n} min', { cut: esc(ev.dayCutoff || C.DEFAULT_CUTOFF), n: esc(ev.callMins || C.DEFAULT_CALL_MINS) }) + '</li></ul>';
    if (r.warnings.length) html += '<p style="margin-top:10px"><b>' + tx('Avisos del archivo:') + '</b></p><ul>' + r.warnings.slice(0, 12).map(w => '<li>' + esc(w) + '</li>').join('') + (r.warnings.length > 12 ? '<li>' + tx('… y {n} más', { n: r.warnings.length - 12 }) + '</li>' : '') + '</ul>';
    html += '<p style="margin-top:10px">' + tx('Al abrirlo, la jornada queda en <b>Todas</b>: elige la que quieras arriba.') + '</p>';
    const n = FEST && ORIG ? C.diffSummary(ORIG, FEST).total : 0;
    const acts = [{ label: 'Cancelar' }];
    if (n) {
      html += '<div class="warnbox">' + (n === 1 ? tx('Tienes 1 cambio sin exportar que se perderá. Exporta antes si lo quieres guardar.') : tx('Tienes {n} cambios sin exportar que se perderán. Exporta antes si los quieres guardar.', { n })) + '</div>';
      acts.push({ label: 'Exportar los cambios', run: () => { exportJSON(); setTimeout(() => askImport(text, fname), 300); } });
      acts.push({ label: 'Abrir y perder cambios', kind: 'danger', run: () => loadNew(s, tx('Evento abierto: {name}', { name: ev.nombre || '' })) });
    } else acts.push({ label: 'Abrir evento', kind: 'primary', run: () => loadNew(s, tx('Evento abierto: {name}', { name: ev.nombre || '' })) });
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
    toast(tx('Exportado: {f}', { f: name }));
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
    const CK = [['show', 'Shows'], ['sc', 'Soundchecks'], ['tarea', 'Tareas'], ['hito', 'Marcadores / Eventos'], ['inc', 'Incidencias']];
    const html = '<div class="dw lx">' +
      '<div class="dw-row"><span class="dw-l">' + tx('Jornada') + '</span><select id="lx-day">' + days.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + (d === jNow ? ' · ' + tx('hoy') : '') + '</option>').join('') + '<option value="all">' + tx('Todo el evento') + '</option></select></div>' +
      '<div class="dw-row top"><span class="dw-l">' + tx('Incluir') + '</span><div class="dtog" id="lx-cats"><button type="button" data-c="all">' + tx('Todos los tipos') + '</button>' + CK.map(([k, t]) => '<button type="button" data-c="' + k + '">' + tx(t) + '</button>').join('') + '</div></div>' +
      '<div class="dw-row"><span class="dw-l"></span><span class="hint lx-hint">' + tx('Incidencias: retrasos, horas reales que se salen del horario, mensajes a las pantallas, avisos del tiempo y su «Visto», altas, cambios y borrados.') + '</span></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Formato') + '</span><div class="dtog radio" id="lx-fmt"><button type="button" data-f="pdf">PDF</button><button type="button" data-f="txt">TXT</button><button type="button" data-f="csv">CSV</button></div></div>' +
      '<div class="dw-row"><span class="dw-l"></span><span class="hint" id="lx-fhint"></span></div>' +
      '<div id="lx-sum" class="lx-sum"></div></div>';
    modal('Exportar log del evento', html, [{ label: 'Cancelar' }, { label: 'Exportar', kind: 'primary', run: () => {
      const rep = Lg.report(LOG, FEST, { day: LX.day, cats: LX.cats, nowMs: Date.now() });
      if (!rep.sections.some(x => x.rows.length)) { toast('No hay nada que exportar con esos filtros', true); return false; }
      const d = new Date(), stamp = pad2(d.getHours()) + pad2(d.getMinutes());
      const base = slugOf(FEST) + '-log-' + (LX.day === 'all' ? tx('evento') : LX.day) + '-' + stamp;
      if (LX.fmt === 'pdf') { printReport(Lg.toHtml(rep)); toast('Informe listo: en la impresión, elige «Guardar como PDF»'); }
      else if (LX.fmt === 'txt') { download(base + '.txt', Lg.toTxt(rep), 'text/plain;charset=utf-8'); toast(tx('Exportado: {f}', { f: base + '.txt' })); }
      else { download(base + '.csv', Lg.toCsv(rep), 'text/csv;charset=utf-8'); toast(tx('Exportado: {f}', { f: base + '.csv' })); }
    } }], { wide: true });
    const box = $('modal-body');
    const FH = { pdf: 'Se abre el informe y la ventana de impresión: elige «Guardar como PDF». Sin librerías y sin internet.', txt: 'Texto plano, para leer en cualquier sitio o pegar en un correo.', csv: 'Tabla para Excel o Numbers (separada por «;»).' };
    const paint = () => {
      $('lx-day').value = LX.day;
      const all = CK.every(([k]) => LX.cats[k]);
      box.querySelectorAll('#lx-cats [data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === 'all' ? all : !!LX.cats[b.dataset.c]));
      box.querySelectorAll('#lx-fmt [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === LX.fmt));
      $('lx-fhint').textContent = tx(FH[LX.fmt]);
      const rep = Lg.report(LOG, FEST, { day: LX.day, cats: LX.cats });
      const st = rep.sections.reduce((a, x) => { Object.keys(x.stats).forEach(k => { a[k] = (a[k] || 0) + x.stats[k]; }); return a; }, {});
      const sec = rep.sections[0];
      $('lx-sum').innerHTML = rep.sections.length && rep.sections.some(x => x.rows.length)
        ? tx('<b>{a}</b> previstas · <b class="{ca}">{b}</b> con hora cambiada · <b class="{cb}">{c}</b> borradas o movidas · <b class="{cc}">{d}</b> añadidas · <b class="{cd}">{e}</b> incidencias',
            { a: st.plan || 0, b: st.chg || 0, c: st.del || 0, d: st.add || 0, e: st.inc || 0, ca: st.chg ? 'chg' : '', cb: st.del ? 'chg' : '', cc: st.add ? 'chg' : '', cd: st.inc ? 'chg' : '' }) +
          (LX.day !== 'all' && sec ? '<div class="hint">' + (sec.foto ? tx('Previsto: el horario tal como estaba a las {h} (foto de la jornada).', { h: C.fmtHM(sec.fotoAt) }) : tx('Esta jornada aún no tiene foto: lo previsto es el horario actual.')) + '</div>' : '')
        : '<span class="hint">' + tx('Nada que exportar con estos filtros.') + '</span>';
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
  /* ── Hoja de ruta imprimible (Running Order) · Fase 1: tabla ───────────── */
  const PR = { fmt: 'tabla', day: null, zone: 'all', kinds: { show: true, sc: true, tarea: true, hito: true }, orient: 'portrait', notes: true, call: true };
  const prKinds = () => Object.keys(PR.kinds).filter(k => PR.kinds[k]);
  function openPrint(fmt) {
    if (!FEST || !window.ShowtimePrint) { toast('Primero crea o abre un evento', true); return; }
    closeMenus(); closeConfig();
    if (fmt === 'tabla' || fmt === 'gantt') PR.fmt = fmt;
    const P = window.ShowtimePrint, days = P.daysOf(FEST, 'all');
    if (!PR.day || (PR.day !== 'all' && days.indexOf(PR.day) < 0)) PR.day = days.length === 1 ? days[0] : (days.indexOf(CONFIG.day) >= 0 ? CONFIG.day : 'all');
    const stages = FEST.escenarios || [];
    if (PR.zone !== 'all' && !stages.some(z => z.id === PR.zone)) PR.zone = 'all';
    const html = '<div class="dw pr">' +
      '<div class="dw-row"><span class="dw-l">' + tx('Formato') + '</span><div class="dtog radio" id="pr-fmt"><button type="button" class="' + (PR.fmt === 'tabla' ? 'on' : '') + '" data-f="tabla">' + tx('Tabla') + '</button><button type="button" class="' + (PR.fmt === 'gantt' ? 'on' : '') + '" data-f="gantt" title="' + tx('Cronograma de escenarios en horizontal') + '">' + tx('Cronograma') + '</button></div></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Jornada') + '</span><select id="pr-day">' + days.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + '</option>').join('') + (days.length > 1 ? '<option value="all">' + tx('Todas · 1 hoja por día') + '</option>' : '') + '</select></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Zona') + '</span><select id="pr-zone"><option value="all">' + tx('Todas las zonas') + '</option>' + stages.map(z => '<option value="' + esc(z.id) + '">' + esc(z.nombre) + '</option>').join('') + '</select></div>' +
      '<div class="dw-row top"><span class="dw-l">' + tx('Contenido') + '</span><div class="pr-kinds" id="pr-kinds">' +
        P.KINDS.map(k => '<label class="pr-ck"><input type="checkbox" data-k="' + k.k + '"> ' + esc(tx(k.label)) + '</label>').join('') +
        '<span class="pr-q"><button type="button" data-q="all">' + tx('Todos') + '</button><button type="button" data-q="show">' + tx('Solo Shows') + '</button></span></div></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Orientación') + '</span><select id="pr-orient"' + (PR.fmt === 'gantt' ? ' disabled title="' + tx('El cronograma es siempre horizontal') + '"' : '') + '><option value="portrait">' + tx('Vertical') + '</option><option value="landscape">' + tx('Horizontal') + '</option></select></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Columnas') + '</span><label class="pr-ck"><input type="checkbox" id="pr-call"' + (PR.fmt === 'gantt' ? ' disabled' : '') + '> ' + tx('Incluir hora de CALL') + '</label><label class="pr-ck"><input type="checkbox" id="pr-notes"' + (PR.fmt === 'gantt' ? ' disabled' : '') + '> ' + tx('Incluir notas operativas') + '</label></div>' +
      '<div id="pr-sum" class="lx-sum"></div></div>';
    modal('Hoja de ruta', html, [{ label: 'Cancelar' }, { label: 'Imprimir / Guardar PDF', kind: 'primary', run: () => {
      const rows = P.rowsOf(FEST, { day: PR.day, zone: PR.zone, kinds: prKinds() });
      if (!rows.length) { toast('No hay bloques con estos filtros', true); return false; }
      const dl = PR.day === 'all' ? days : [PR.day];
      const doc = P.html({ rows, days: dl, title: (FEST.event && FEST.event.nombre) || 'Evento', format: PR.fmt, orient: PR.fmt === 'gantt' ? 'landscape' : PR.orient, notes: PR.notes, call: PR.call, now: new Date(), full: prKinds().length === 4 });   // idioma: el activo de Showtime
      P.launch(doc);
      toast('Hoja lista: en la impresión, elige «Guardar como PDF»');
    } }], { wide: true });
    const paint = () => {
      $('pr-day').value = PR.day; $('pr-zone').value = PR.zone; $('pr-orient').value = PR.orient;
      document.querySelectorAll('#pr-kinds [data-k]').forEach(c => { c.checked = !!PR.kinds[c.dataset.k]; });
      $('pr-call').checked = PR.call; $('pr-notes').checked = PR.notes;
      const gantt = PR.fmt === 'gantt';
      $('pr-orient').disabled = gantt; $('pr-call').disabled = gantt; $('pr-notes').disabled = gantt;
      document.querySelectorAll('#pr-fmt [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === PR.fmt));
      const rows = P.rowsOf(FEST, { day: PR.day, zone: PR.zone, kinds: prKinds() });
      const dl = PR.day === 'all' ? days : [PR.day];
      const sm = P.summary(rows, dl);
      if (!prKinds().length) { $('pr-sum').innerHTML = '<span class="hint">' + tx('Marca al menos un tipo de bloque.') + '</span>'; $('modal-actions').querySelector('.primary').disabled = true; return; }
      $('pr-sum').innerHTML = tx(sm.hojas === 1 ? (gantt ? '<b>{n}</b> bloques · <b>{h}</b> hoja horizontales' : '<b>{n}</b> bloques · <b>{h}</b> hoja · letra <b>{l}</b>') : (gantt ? '<b>{n}</b> bloques · <b>{h}</b> hojas A4 horizontales' : '<b>{n}</b> bloques · <b>{h}</b> hojas A4 · letra <b>{l}</b>'), { n: sm.bloques, h: sm.hojas, l: sm.letra }) +
        '<div class="hint">' + tx(gantt ? 'Un carril por escenario, rango horario de cada jornada y marcadores en rojo. Horarios previstos.' : 'Horarios previstos (la escaleta), no los reales. Una jornada por hoja: cada una cabe en una A4.') + '</div>';
      $('modal-actions').querySelector('.primary').disabled = !rows.length;
    };
    $('pr-day').addEventListener('change', e => { PR.day = e.target.value; paint(); });
    $('pr-zone').addEventListener('change', e => { PR.zone = e.target.value; paint(); });
    $('pr-kinds').addEventListener('change', e => { const k = e.target.dataset.k; if (!k) return; PR.kinds[k] = e.target.checked; paint(); });
    $('pr-kinds').addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      Object.keys(PR.kinds).forEach(k => { PR.kinds[k] = b.dataset.q === 'all' ? true : k === 'show'; });
      paint();
    });
    $('pr-orient').addEventListener('change', e => { PR.orient = e.target.value; paint(); });
    $('pr-call').addEventListener('change', e => { PR.call = e.target.checked; paint(); });
    $('pr-notes').addEventListener('change', e => { PR.notes = e.target.checked; paint(); });
    $('pr-fmt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b || b.disabled) return; PR.fmt = b.dataset.f; paint(); });
    paint();
  }
  $('btn-print').addEventListener('click', () => openPrint());
  // ⌘P / Ctrl+P: la impresión de la página pasa a ser la hoja de ruta (la de la app sigue en el menú Archivo)
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPrint(); }
  });

  $('btn-import2').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
  $('btn-export').addEventListener('click', exportJSON);
  function askDemo() {
    modal('Evento de demostración', '<p>' + tx('Carga un evento de ejemplo con horarios alrededor de la hora actual, para probar el Dashboard y la Pantalla Live.') + '</p>',
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
    if (!$('modal').hidden || !$('addm').hidden || !$('imp').hidden || !$('cfg').hidden || chatPopOn) return false;
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
    $('imp-kind').textContent = rd.kind === 'tabla' ? tx(rd.records.length === 1 ? 'Tabla · {c} columnas · {s} · {n} fila' : 'Tabla · {c} columnas · {s} · {n} filas',
        { c: Math.max.apply(null, rd.rows.map(r => r.length)), s: tx({ '\t': 'tabuladores', ';': 'punto y coma', ',': 'comas' }[rd.sep]), n: rd.records.length })
      : rd.kind === 'texto' ? tx(rd.records.length === 1 ? 'Texto libre · {n} línea con hora' : 'Texto libre · {n} líneas con hora', { n: rd.records.length }) : tx('Esperando horario…');
    // Opciones
    document.querySelectorAll('#imp [data-imode]').forEach(b => b.classList.toggle('on', b.dataset.imode === IMP.mode));
    const jor = IMP.fresh ? C.eventDays(IMP.base) : jornadaOptions();
    $('imp-jor').innerHTML = '<option value="">' + tx('— ninguna —') + '</option>' + jor.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + '</option>').join('');
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
        const head = rd.hasHeader ? (rd.rows[0][c] || '') : tx('Columna {n}', { n: c + 1 });
        const ex = (data.find(r => (r[c] || '').trim()) || [])[c] || '';
        const k = rd.map[c] || 'ignorar';
        h += '<div class="imp-col' + (k === 'ignorar' ? ' ign' : '') + '"><div class="h" title="' + esc(head) + '">' + esc(head || '—') + '</div>' +
          '<div class="ex" title="' + esc(ex) + '">' + esc(ex || ' ') + '</div>' +
          '<select data-col="' + c + '">' + I.KEYS.map(x => '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + esc(tx(I.KEY_LABEL[x])) + '</option>').join('') + '</select></div>';
      }
      $('imp-map').innerHTML = h;
    } else $('imp-map').innerHTML = '';
    // Escenarios nuevos y jornadas fuera del evento
    let nh = '';
    if (IMP.fresh) {
      const ev = IMP.base.event, d1 = fmtDay(ev.fechaInicio), d2 = fmtDay(ev.fechaFin);
      nh += '<span class="imp-fresh">' + tx('Sin evento abierto: al importar se crea <b>«Evento sin nombre»</b> · {d} (nombre y fechas, luego en Configuración).', { d: esc(d1 === d2 ? d1 : d1 + ' → ' + d2) }) + '</span>';
    }
    if (pv.newStages.length) {
      nh += '<span><b>' + tx(pv.newStages.length === 1 ? '{n} zona nueva:' : '{n} zonas nuevas:', { n: pv.newStages.length }) + '</b></span>' +
        pv.newStages.map(s => { const k = I.norm(s); return '<label><input type="checkbox" data-newstage="' + esc(k) + '"' + (IMP.create[k] === false ? '' : ' checked') + '> ' + tx('crear «{s}»', { s: esc(s) }) + '</label>'; }).join('');
    }
    if (pv.outside.length) nh += '<label><input type="checkbox" id="imp-extend"' + (IMP.extend ? ' checked' : '') + '> ' + tx('<b>Ampliar el evento</b> a {d}', { d: pv.outside.map(fmtDay).map(esc).join(', ') }) + '</label>';
    $('imp-new').innerHTML = nh;
    // Vista previa
    const head = '<thead><tr><th></th>' + ['Estado', 'Tipo', 'Zona', 'Nombre', 'Jornada', 'Inicio', 'Fin', 'CALL', 'Notas', 'Avisos'].map(h => '<th>' + tx(h) + '</th>').join('') + '</tr></thead>';
    if (!pv.rows.length) {
      $('imp-prev').innerHTML = head + '<tbody><tr><td colspan="11" class="vacio">' + tx(rd.kind === 'vacio' ? 'Pega un horario arriba o elige un archivo .csv / .tsv.' : 'No se ha encontrado ninguna fila con hora.') + '</td></tr></tbody>';
    } else {
      const dot = '<svg class="ic dot"><use href="#i-dot"/></svg>';
      const st = { ok: dot + 'OK', warn: dot + tx('Revisar'), err: dot + tx('Error') };
      const inp = (r, k, v, cls) => '<td class="' + (cls || '') + '"><input type="text" data-row="' + r.idx + '" data-k="' + k + '" value="' + esc(v || '') + '" spellcheck="false" autocomplete="off"></td>';
      $('imp-prev').innerHTML = head + '<tbody>' + pv.rows.map(r =>
        '<tr class="st-' + r.status + (r.include ? '' : ' off') + '" title="' + esc(r.raw || '') + '">' +
        '<td class="chk"><input type="checkbox" data-inc="' + r.idx + '"' + (r.include ? ' checked' : '') + (r.status === 'err' ? ' disabled' : '') + '></td>' +
        '<td class="st">' + st[r.status] + (r.action === 'duplicada' ? '<div class="hint">' + tx('ya existe') + '</div>' : '') + '</td>' +
        '<td class="tp"><select data-row="' + r.idx + '" data-k="tipo" class="tipo tipo-' + r.tipo + '">' + I.TIPO_KEYS.map(k => '<option value="' + k + '"' + (k === r.tipo ? ' selected' : '') + '>' + tx(I.TIPO_LABEL[k]) + '</option>').join('') + '</select>' +
          (r.tipoWhy ? '<div class="hint" title="' + tx('Tipo propuesto: compruébalo') + '">' + tx('por {w}', { w: esc(r.tipoWhy) }) + '</div>' : '') + '</td>' +
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
      if (summary) summary.textContent = tx(ign.length === 1 ? '{n} línea sin hora ignorada' : '{n} líneas sin hora ignoradas', { n: ign.length });
      if (ul) ul.innerHTML = ign.map(l => '<li>' + tx('Línea {n}: {l}', { n: l.n, l: esc(l.line) }) + '</li>').join('');
    }
    // Resumen y botón
    const c = pv.counts;
    $('imp-sum').innerHTML = c.total ? tx('<span class="ok">{a} OK</span> · <span class="warn">{b} a revisar</span> · <span class="err">{c} con error</span>', { a: c.ok, b: c.warn, c: c.err }) : '';
    $('imp-go').textContent = tx(c.importar === 1 ? 'Importar {n} entrada' : 'Importar {n} entradas', { n: c.importar });
    $('imp-go').disabled = !c.importar;
  }

  let IMP_LAST = [];
  /** ¿La vista (all | show | sc) escondería alguno de estos tipos? «Shows» solo enseña shows; «Soundchecks», solo pruebas. */
  function hidesSome(mode, tipos) { return mode !== 'all' && Array.from(tipos || []).some(t => t !== mode); }
  /** «✓ 39 entradas importadas en 3 jornadas (8 shows · 8 pruebas · 23 tareas/hitos)» — solo lo que hay. */
  function importSummary(rows, added) {
    const n = Number.isFinite(added) ? added : rows.length, c = t => rows.filter(x => x.tipo === t).length;
    const jors = new Set(rows.map(x => x.jornada).filter(Boolean)).size;
    const parts = [[c('show'), 'show', 'shows'], [c('sc'), 'prueba', 'pruebas'], [c('tarea') + c('hito'), 'tarea/marcador', 'tareas/marcadores']].filter(p => p[0]).map(p => p[0] + ' ' + tx(p[0] === 1 ? p[1] : p[2]));
    return tx(n === 1 ? '✓ {n} entrada importada con éxito' : '✓ {n} entradas importadas con éxito', { n: n }) + (jors > 1 ? tx(' en {n} jornadas', { n: jors }) : '') + (parts.length ? ' (' + parts.join(' · ') + ')' : '');
  }
  function impDoImport() {
    if (!IMP || !IMP.pv || !IMP.pv.counts.importar) return;
    const fresh = IMP.fresh, base = IMP.base;
    const r = I.apply(base, IMP.pv, { mode: IMP.mode, createStages: IMP.create, extendEvent: IMP.extend });
    IMP_LAST = IMP.pv.rows.filter(x => x.include && x.status !== 'err');
    const used = new Set(IMP.pv.rows.filter(x => x.include && x.status !== 'err').map(x => x.tipo));
    const hidden = hidesSome(CONFIG.mode, used);
    closeImport();
    const impMsg = T => {   // T: tx (aviso, idioma activo) o txEs (Deshacer y log)
      let m = T(r.added === 1 ? 'Importado: {n} entrada nueva' : 'Importado: {n} entradas nuevas', { n: r.added });
      if (r.stagesCreated) m += T(r.stagesCreated === 1 ? ', {n} zona nueva' : ', {n} zonas nuevas', { n: r.stagesCreated });
      if (hidden) m += T(' · Ver: Todo');
      return fresh ? T('Evento creado · {m}. Ponle nombre en Configuración', { m: m.charAt(0).toLowerCase() + m.slice(1) }) : m;
    };
    const msg = { es: impMsg(txEs), ui: impMsg(tx) };
    if (fresh) loadNew(base, 'Evento creado');   // evento nuevo: la referencia es el evento vacío, así lo importado cuenta como «sin exportar» y se puede deshacer
    // La vista actual («Ver: Shows» / «Ver: Soundchecks») escondería parte de lo importado: se pasa a «Ver: Todo» para ver la foto completa
    if (hidden) CONFIG = Dt.setConfig({ mode: 'all' });
    commitFestival(r.state, msg);
    // Confirmación clara (2,5 s, en verde) y la tabla arriba para ver el evento recién importado
    toast(importSummary(IMP_LAST, r.added) + (hidden ? tx(' · Ver: Todo') : '') + (fresh ? tx(' · ponle nombre en Configuración') : ''), false, 2500);
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
    readTextFile(file, t => setImportText(t.replace(/^﻿/, ''), tx('Archivo leído: {f}', { f: file.name })));
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
    if (k === 'pdf') { openImport(IMP ? IMP.text : '', tx(PDF_NOTICE)); return; }
    if (k === 'imagen') { openImport(IMP ? IMP.text : '', tx(IMG_NOTICE)); return; }
    if (k === 'xls') { toast('Es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx o CSV, o copia y pega las celdas', true); return; }
    if (k === 'xlsx') { loadXlsx(f); return; }
    toast(tx('No sé leer «{f}»: usa Excel (.xlsx), CSV, TSV, texto o el .json del evento', { f: f.name || tx('ese archivo') }), true);
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
        if (!r.text) { toast(tx('El Excel «{f}» no tiene datos', { f: file.name }), true); return; }
        // Una hoja por zona: se juntan las que son horarios con las mismas columnas (las de personal o turnos, fuera)
        const m = r.all && r.all.length > 1 ? I.mergeSheets(r.all, I.contextOf(FEST || { escenarios: [], artists: [] })) : null;
        if (m && m.used.length) setImportText(m.text, tx('Excel leído: {f}', { f: file.name }) + ' · ' + (m.used.length === 1 ? tx('hoja «{s}»', { s: m.used[0] }) : tx('{n} hojas ({s})', { n: m.used.length, s: m.used.join(', ') })) + (m.skipped.length ? tx(' · sin horarios: {s}', { s: m.skipped.join(', ') }) : ''));
        else setImportText(r.text, tx('Excel leído: {f}', { f: file.name }) + (r.sheets.length > 1 ? ' · ' + tx('hoja «{s}»', { s: r.sheet }) : ''));
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
    if (f && fileKind(f) === 'imagen' && !(cd.getData && cd.getData('text/plain'))) { e.preventDefault(); $('imp-notice').textContent = tx(IMG_NOTICE); $('imp-notice').hidden = false; }
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
  /** Destinos del mensaje para la interfaz (el log los guarda en español). */
  const tgtUi = (to, zones) => { const s = Vs.targetsTxt(to, zones, zoneLabel); return s.indexOf('Todas las pantallas') === 0 ? tx('Todas las pantallas') + s.slice(19) : s; };
  function sendFlash(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    Dt.setFlash(t, MSG_TO, MSG_ZONES);
    logEvent('msg', '«' + t + '» → ' + Vs.targetsTxt(MSG_TO, MSG_ZONES, zoneLabel));
    closeMenus();
    $('msg-text').value = '';
    renderFlash();
    toast(tx('Mensaje → {to}: «{t}»', { to: tgtUi(MSG_TO, MSG_ZONES), t: t }) + (liveOpen() ? '' : tx(' (no hay ninguna Live abierta en este Dashboard)')));
  }
  function flashLeftTxt(f) {
    const l = Dt.flashLeft(f);
    return l === null ? tx('hasta retirarlo') : Math.ceil(l / 1000) + ' s';
  }
  function renderFlash() {
    const f = Dt.getFlash ? Dt.getFlash() : null;
    $('msg-on').hidden = !f;
    const cur = $('msg-cur');
    cur.hidden = !f;
    if (f) cur.innerHTML = '<span>' + tx('En pantalla: <b>{t}</b> · {l}', { t: esc(f.text), l: flashLeftTxt(f) }) + '</span><button class="btn" id="msg-off" type="button">' + tx('Retirar') + '</button>';
    const chip = $('drift').querySelector('.dchip.msg');
    if (chip) chip.remove();
    if (f) $('drift').insertAdjacentHTML('afterbegin', '<span class="dchip msg"><svg class="ic"><use href="#i-msg"/></svg>' + (f.to || f.zones ? esc(tgtUi(f.to, f.zones)) : 'Live') + ': «' + esc(f.text) + '»<button class="chipx" data-act="msg-off" title="' + tx('Retirar el mensaje') + '">' + tx('Retirar') + '</button></span>');
    // Columna izquierda (lo que hay en la Live): tarjeta del mensaje con su aspecto real y el botón para quitarlo
    const card = $('card-msg');
    card.hidden = !f;
    if (!f) { card.dataset.id = ''; return; }
    if (card.dataset.id !== f.id) {
      card.dataset.id = f.id;
      const bg = f.bg || '#000000', fg = f.fg || '#ffb347';
      $('v-msg').innerHTML = '<div class="msg-live" style="--mbg:' + bg + ';--mfg:' + fg + '">' + esc(f.text.toUpperCase()) + '</div>'
        + '<div class="msg-to">→ ' + esc(tgtUi(f.to, f.zones)) + '</div>'
        + '<div class="msg-foot"><span class="msg-left"></span><button class="btn" data-act="msg-off" type="button"><svg class="ic"><use href="#i-x"/></svg>' + tx('Retirar') + '</button></div>';
    }
    $('v-msg').querySelector('.msg-left').textContent = Dt.flashLeft(f) === null ? tx('Hasta retirarlo') : tx('Se cierra en {l}', { l: flashLeftTxt(f) });
  }
  document.querySelectorAll('#m-msg .msgp').forEach(b => b.addEventListener('click', () => sendFlash(tx(b.dataset.msg))));   // los mensajes rápidos salen en el idioma del Panel
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
    const h = '<button data-z="*" class="' + (!MSG_ZONES ? 'on' : '') + '">' + tx('Todas las zonas') + '</button>' + zs.map(z => '<button data-z="' + esc(z.id) + '" class="' + (MSG_ZONES && MSG_ZONES.indexOf(z.id) >= 0 ? 'on' : '') + '">' + esc(z.name) + '</button>').join('');
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
    W.pendingAlerts(pending, next).forEach(a => { logEvent('meteo', 'Aviso (previsión): ' + (a.textEs || a.text), { amber: true }); next = W.ack(next, a); ch = true; });
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
      if (byHand) toast(tx('El tiempo: {e}', { e: e.message || 'error' }), true);
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
    if (st.sum && st.sum.stale) h += '<span class="dchip over" title="' + tx('El último dato del tiempo es de las {h}', { h: W.hhmm(st.sum.at) }) + (st.m && st.m.err ? ' · ' + esc(tx(st.m.err)) : '') + '"><svg class="ic"><use href="#i-alert"/></svg>' + tx('Meteo') + ': ' + esc(st.sum.staleTxt) + '</span>';
    st.pending.forEach(a => {
      h += '<span class="dchip absorb mtchip" title="' + tx('Previsión del modelo, no es un aviso oficial') + '"><svg class="ic"><use href="#i-' + (a.kind === 'storm' ? 'storm' : a.kind === 'rain' ? 'rain' : a.kind === 'uv' ? 'sun' : a.kind === 'heat' ? 'thermo' : a.kind === 'aqi' ? 'cloud' : 'wind') + '"/></svg>' + tx('Previsión') + ' · ' + esc(a.text) +
        '<button class="chipx" data-act="mt-ack" data-k="' + a.kind + '" title="' + tx('Visto: no insiste salvo que empeore') + '">' + tx('Visto') + '</button></span>';
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
    const where = c.source === 'openmeteo' ? (c.place || (c.lat !== null ? c.lat + ', ' + c.lon : '')) : tx(MT_SRC[c.source]);
    if (!st.sum) {
      const need = c.source === 'openmeteo' && (c.lat === null || c.lon === null) ? 'Elige el lugar del evento' : c.source === 'url' && !c.url ? 'Falta la URL de la estación' : c.source === 'manual' ? 'Escribe los valores' : '';
      h = '<div class="mt-none">' + (need ? esc(tx(need)) + ' ' + tx('en') + ' <button class="linkbtn" data-act="mt-cfg">' + tx('Configuración › Meteo') + '</button>' : (st.m && st.m.err ? tx('SIN DATOS') + ' · ' + esc(tx(st.m.err)) : tx('Cargando…'))) + '</div>';
    } else {
      const s = st.sum;
      h += '<div class="mt-now' + (s.stale ? ' stale' : '') + '"><svg class="ic mt-sky"><use href="#i-' + s.icon + '"/></svg><span class="mt-t">' + (s.temp === null ? '—' : Math.round(s.temp) + '°') + '</span><span class="mt-sk">' + esc(s.sky || '') + (where ? '<small>' + esc(where) + '</small>' : '') + '</span></div>';
      const sn = W.sunNext(st.snap, Date.now());
      if (sn) {
        const fmt = t => { const tm = new Date(t), tomorrow = tm.toDateString() !== new Date().toDateString(); return '<b>' + W.hhmm(t) + '</b>' + (tomorrow ? ' <small>' + tx('mañana') + '</small>' : ''); };
        h += '<div class="mt-sun"><svg class="ic"><use href="#i-sun"/></svg>' + (sn.rise !== null ? tx('Amanece') + ' ' + fmt(sn.rise) : '') + (sn.rise !== null && sn.set !== null ? ' · ' : '') + (sn.set !== null ? tx('Se pone') + ' ' + fmt(sn.set) : '') + '</div>';
      }
      if (s.stale) h += '<div class="mt-stale"><svg class="ic"><use href="#i-alert"/></svg>' + esc(s.staleTxt) + (st.m && st.m.err ? '<small>' + esc(tx(st.m.err)) + '</small>' : '') + '</div>';
      h += '<div class="mt-grid">' +
        '<span><svg class="ic"><use href="#i-drop"/></svg>' + tx('Lluvia') + ' <b>' + mtNum(s.rain, true) + '</b> mm/h</span>' +
        '<span><svg class="ic"><use href="#i-wind"/></svg>' + tx('Viento') + ' <b>' + mtNum(s.wind) + '</b> km/h</span>' +
        '<span class="mt-gmax"><svg class="ic"><use href="#i-wind"/></svg>' + tx('Ráfagas máx.') + ' <b>' + mtNum(s.gustMax !== null ? s.gustMax : s.gust) + '</b> km/h' +
          (s.gustMaxAt ? ' <small>· ' + W.hhmm(s.gustMaxAt) + '</small>' : '') + (st.snap.hours.length ? ' <small>' + tx('(próx. {n} h)', { n: s.horizon }) + '</small>' : ' <small>' + tx('(ahora)') + '</small>') + '</span>' +
        (s.uv !== null || s.uvMax !== null ? '<span><svg class="ic"><use href="#i-sun"/></svg>UV <b>' + mtNum(s.uvMax !== null ? s.uvMax : s.uv) + '</b> ' + W.uvText(s.uvMax !== null ? s.uvMax : s.uv) + '</span>' : '') +
        (c.th.aqiOn && s.aqi !== null ? '<span><svg class="ic"><use href="#i-cloud"/></svg>' + tx('Aire') + ' <b>' + W.aqiText(s.aqi) + '</b></span>' : '') +
        '</div>';
      if (st.list.length) h += '<div class="mt-alerts">' + st.list.map(a => '<div class="mt-al' + (st.pending.indexOf(a) >= 0 ? ' new' : '') + '"><svg class="ic"><use href="#i-alert"/></svg><span>' + esc(a.text) + '</span>' +
        (st.pending.indexOf(a) >= 0 ? '<button class="chipx" data-act="mt-ack" data-k="' + a.kind + '">' + tx('Visto') + '</button>' : '<small>' + tx('visto') + '</small>') + '</div>').join('') + '</div>';
      h += '<div class="mt-foot">' + esc(tx(MT_SRC[s.src] || '')) + ' · ' + tx('dato {h} · previsión, no aviso oficial', { h: W.hhmm(s.at) }) + ' · <a href="' + W.AEMET_URL + '" target="_blank" rel="noopener">' + tx('Avisos AEMET') + '<svg class="ic"><use href="#i-ext"/></svg></a></div>';
    }
    if (h !== MT_HTML) { MT_HTML = h; $('v-meteo').innerHTML = h; }
    return st;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="mt-ack"]');
    if (b) {
      const st = meteoState(), a = st.list.find(x => x.kind === b.dataset.k);
      if (a) { MT_ACKS = W.ack(MT_ACKS, a); mtSaveAcks(); logEvent('meteo', 'Visto: ' + (a.textEs || a.text)); }
      renderMeteo(); if (FEST) renderDrift(Math.floor(C.nowAbs()));
      return;
    }
    if (e.target.closest('[data-act="mt-cfg"]')) openConfig('meteo');
  });

  // Configuración › Meteo
  function fillMeteoStatus() {
    const st = meteoState(), m = st.m;
    let t = '';
    if (!st.c.on) t = tx('Apagado.');
    else if (st.sum) t = tx('Último dato: {h}', { h: W.hhmm(st.sum.at) }) + (st.sum.stale ? ' · <b class="bad">' + esc(st.sum.staleTxt) + '</b>' : '') + (m && m.err ? tx(' · último intento: {e}', { e: esc(tx(m.err)) }) : '');
    else if (m && m.err) t = '<b class="bad">' + tx('Sin datos') + '</b> · ' + esc(tx(m.err));
    else t = tx(MT_BUSY ? 'Pidiendo el dato…' : 'Sin datos todavía.');
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
    $('mt-res').innerHTML = '<span class="hint">' + tx('Buscando…') + '</span>';
    try {
      const r = await fetch(W.geoUrl(q));
      if (!r.ok) throw new Error(tx('El servidor respondió {n}', { n: r.status }));
      const list = W.parseGeo(await r.json());
      $('mt-res').innerHTML = list.length ? list.map((p, i) => '<button class="mt-pick" type="button" data-i="' + i + '"><b>' + esc(p.name) + '</b><small>' + esc(p.detail) + ' · ' + p.lat + ', ' + p.lon + '</small></button>').join('') : '<span class="hint">' + tx('No se encuentra. Prueba con otro nombre o escribe las coordenadas.') + '</span>';
      $('mt-res').querySelectorAll('.mt-pick').forEach(b => b.addEventListener('click', () => {
        const p = list[Number(b.dataset.i)];
        $('mt-lat').value = p.lat; $('mt-lon').value = p.lon; $('mt-res').innerHTML = ''; $('mt-q').value = '';
        saveMeteo({ place: p.name + (p.detail ? ' (' + p.detail + ')' : '') });
      }));
    } catch (e) { $('mt-res').innerHTML = '<span class="hint bad">' + tx('No se ha podido buscar: {e}. Escribe las coordenadas.', { e: esc(e.message) }) + '</span>'; }
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
    } catch (e) { console.error(e); EM = null; renderCast(); toast(tx('No se pudo empezar la emisión: {e}', { e: e && e.message || e }), true); }
  }
  async function emStop(quiet) {
    if (!EM) return;
    const e = EM; EM = null; EMST = null; emSave(false); renderCast(); renderChat();
    await e.stop();
    if (!quiet) toast('Emisión parada: los dispositivos muestran «Emisión detenida»');
  }
  function emRegen() {
    modal('Regenerar claves', '<p>' + tx('Se crea una sala nueva con claves nuevas. <b>Todos los QR anteriores (Staff, Mando y Producción) dejan de funcionar</b>: habrá que escanear los nuevos.') + '</p>', [
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
    modal('Nueva clave del mando', '<p>' + tx('El QR del mando anterior <b>deja de poder mandar</b> al Mac. Los QR de Staff y Producción siguen valiendo y la emisión no se corta.') + '</p>', [
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
      ? '<p>' + tx('<b>{p}</b> ya no está en la lista: el Dashboard ignora lo que mande con su nombre. Pero su QR sigue pudiendo <b>leer</b> la emisión y el chat de Producción. Para cortarle del todo, genera una clave nueva (el resto de Producción tendrá que volver a escanear su QR).', { p: esc(quitado) }) + '</p>'
      : '<p>' + tx('Los QR de Producción anteriores <b>dejan de funcionar</b>: no podrán leer el chat ni mandar nada. Staff y el mando siguen igual y la emisión no se corta.') + '</p>';
    modal(quitado ? tx('Quitar acceso a {p}', { p: quitado }) : 'Nueva clave de Producción', intro, [
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
    const from = 'Desde el mando del Stage Manager · ', fromUi = tx(from);
    if (cmd.op === 'start' || cmd.op === 'stop') {
      const r = M.realPlan(FEST, CONFIG, a.key, cmd.op === 'start' ? 'i' : 'f', abs);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, { es: from + r.msg, ui: fromUi + r.msg }, { src: 'mando', t: abs, noTimes: true, ev: pushedEv(r) });
      if (r.clashes.length) setTimeout(() => toast(tx('Choque con entrada en rojo: {list}', { list: r.clashes.map(c => c.name + ' / ' + c.with).join(', ') }), true), 2800);
      return { ok: true, msg: r.msg + (r.clashes.length ? ' · ¡choque con entrada en rojo!' : '') };
    }
    if (cmd.op === 'onTime') {
      const r = M.onTimePlan(FEST, a.key, abs);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, { es: from + r.msg, ui: fromUi + r.msg }, { src: 'mando', t: abs, noTimes: true, noReal: true, ev: [{ type: 'real', text: r.logTxt + ' · Stage Manager (mando)' }] });
      return { ok: true, msg: r.msg };
    }
    if (cmd.op === 'stretch') {
      const r = M.stretchPlan(FEST, a.key, a.on, abs, CONFIG);
      if (!r.ok) return { ok: false, msg: r.error };
      commitFestival(r.state, { es: from + r.msg, ui: fromUi + r.msg }, { src: 'mando', t: abs, noTimes: true, ev: [{ type: 'buffer', amber: r.late !== null && r.late !== undefined, text: r.msg }] });
      return { ok: true, msg: r.msg };
    }
    if (cmd.op === 'delay') {
      const r = M.delayPlan(FEST, CONFIG, { minutes: a.minutes, zones: a.zones, from: a.from, src: 'mando' });
      if (!r.ok) return { ok: false, msg: r.error };
      if (M.delayStamp(r) !== a.stamp) return { ok: false, msg: 'El horario ha cambiado desde el resumen: revísalo y confirma otra vez', data: { stale: true } };
      if (!r.moved.length) return { ok: false, msg: 'No hay nada que mover con esa selección' };
      const zl = a.zones === 'all' ? 'todas las zonas' : a.zones.map(z => z ? ((C.getEscenario(FEST, z) || {}).nombre || z) : 'sin zona').join(', ');
      const msg = 'Retraso +' + r.minutes + ' min (' + zl + ', desde ' + C.fmtHM(Math.floor(a.from)) + '): ' + nEnt(r.moved.length, 'movida') + (r.kept.length ? ' · ' + keptTxt(r.kept.length) : '');
      commitFestival(r.state, { es: from + msg, ui: fromUi + msg }, { src: 'mando', t: abs, noTimes: true, ev: [{ type: 'delay', text: msg, jors: [r.jornada], amber: true }] });
      return { ok: true, msg };
    }
    if (cmd.op === 'flash') {
      const t = String(a.text).replace(/\s+/g, ' ').trim();
      const to = Vs.normTargets(a.to), zs = Vs.normZones(a.zones);
      Dt.setFlash(t, to, zs); renderFlash(); toast(fromUi + tx('Mensaje → {to}: «{t}»', { to: tgtUi(to, zs), t: t }));
      logEvent('msg', '«' + t + '» → ' + Vs.targetsTxt(to, zs, zoneLabel), { src: 'mando', t: abs });
      return { ok: true, msg: 'Mensaje → ' + Vs.targetsTxt(to, zs, zoneLabel) + ': «' + t + '»' };
    }
    if (cmd.op === 'flashOff') {
      Dt.setFlash(null); renderFlash(); toast(fromUi + tx('Mensaje retirado'));
      return { ok: true, msg: 'Mensaje retirado' };
    }
    if (cmd.op === 'callOk') {
      Dt.markCallDone(a.key, Math.floor(C.nowAbs())); logCallOk(a.key, 'Stage Manager (mando)', 'mando'); tick(); toast(fromUi + tx('CALL confirmado'));
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
    const list = Dt.getChat();
    const html = list.slice(-100).map(m => '<div class="chat-list-item' + (m.sm ? ' sm' : '') + '"><div class="chat-list-item-from">' + esc(m.sm ? 'Stage Manager' : m.from) +
      '<small>' + hhmmOf(m.at) + '</small></div><div class="chat-list-item-text">' + esc(m.text) + '</div></div>').join('');
    // la lista del menú y la de la ventana (si existe) muestran lo mismo
    [['chat-list', 'chat-empty', 'chat-off'], ['chat-list2', 'chat-empty2', 'chat-off2']].forEach(([l, e, o]) => {
      const box = $(l); if (!box || !$(e) || !$(o)) return;
      box.innerHTML = html; $(e).hidden = list.length > 0; $(o).hidden = !!EM;
      box.scrollTop = box.scrollHeight;   // siempre abajo, con el último mensaje
    });
  }
  /** Manda el chat (últimos mensajes) a los enlaces de Producción. Solo con la emisión activa. */
  function emPushChat() {
    if (!EM || !EM.sendProd) return;
    EM.sendProd({ type: 'chatlog', list: Dt.getChat().slice(-Em.CHAT_SEND) }).catch(e => console.error(e));
  }
  function sendChat(inp) {
    if (!Dt.addChat(inp.value, 'Stage Manager', '', true)) return;
    inp.value = ''; renderChat(); emPushChat();
  }
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); sendChat($('chat-text')); });
  $('chat-form2').addEventListener('submit', e => { e.preventDefault(); sendChat($('chat-text2')); });
  /** Ventana flotante del chat: se abre centrada; Esc, ✕ o clic fuera la cierran. */
  let chatPopOn = false;   // estado propio (no depende del atributo hidden)
  function openChatPop() { closeMenus(); $('chat-on').hidden = true; chatPopOn = true; $('chat-modal').hidden = false; renderChat(); $('chat-text2').focus(); }
  function closeChatPop() { chatPopOn = false; $('chat-modal').hidden = true; }
  $('chat-pop').addEventListener('click', e => { e.stopPropagation(); openChatPop(); });
  $('chat-x').addEventListener('click', closeChatPop);
  backdropClose($('chat-modal'), closeChatPop);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatPopOn) closeChatPop(); });
  $('m-chat').querySelector('.mbtn').addEventListener('click', () => { $('chat-on').hidden = true; renderChat(); });
  setInterval(() => { if (Dt.getChat().length) emPushChat(); }, 20000);   // quien se conecta tarde lo recibe en poco tiempo

  // Mensajes de Producción (llegan cifrados desde su Live): OK de CALL, mensajes a las pantallas y chat.
  function emProdMessage(raw) {
    const msg = Em && Em.cleanProdMsg ? Em.cleanProdMsg(raw) : null;
    if (!msg) return;
    if (!PRODUCERS.some(p => p.id === msg.from)) { toast(tx('Mensaje de Producción ignorado: «{p}» no está en la lista de Producción', { p: msg.from }), true); return; }   // persona borrada o id inventado
    const who = 'Producción (' + prodName(msg.from) + ')', whoUi = tx('Producción ({p})', { p: prodName(msg.from) });   // log en español; aviso en el idioma del Panel
    if (msg.type === 'call') {
      if (!FEST || !C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.callKey(b) === msg.key)) return;   // solo CALL que existen
      if (CALL_LOGGED.has(msg.key)) return;
      Dt.markCallDone(msg.key, Math.floor(C.nowAbs()));
      logCallOk(msg.key, who, 'produccion');
      tick(); toast('CALL OK · ' + bandOfKey(msg.key) + ' · ' + whoUi);
    } else if (msg.type === 'flash') {
      const to = Vs.normTargets(msg.to);
      Dt.setFlash(msg.text, to, null); renderFlash();
      toast(whoUi + ' → ' + tgtUi(to, null) + ': «' + msg.text + '»');
      logEvent('msg', '«' + msg.text + '» → ' + Vs.targetsTxt(to, null, zoneLabel) + ' · ' + who, { src: 'produccion' });
    } else if (msg.type === 'aviso') {
      if (!Dt.addAviso(msg.text, msg.perm, who)) return;
      if (FEST) renderDrift(Math.floor(C.nowAbs()));
      toast(tx(msg.perm ? '{w} · aviso permanente: «{t}»' : '{w} · aviso puntual: «{t}»', { w: whoUi, t: msg.text }));
      logEvent('msg', 'Aviso ' + (msg.perm ? 'permanente' : 'puntual') + ': «' + msg.text + '» · ' + who, { src: 'produccion' });
    } else if (msg.type === 'chat') {
      Dt.addChat(msg.text, prodName(msg.from), msg.from, false);
      renderChat();
      if (!$('m-chat').classList.contains('open') && !chatPopOn) $('chat-on').hidden = false;   // sin leer
      if (CONFIG && CONFIG.prodChatPopup !== false) toast(tx('Chat · {p}: {t}', { p: prodName(msg.from), t: msg.text.slice(0, 100) }));
      emPushChat();
    } else if (msg.type === 'chatsync') {
      emPushChat();
    }
  }

  function emLinksOn() { return EMST ? EMST.links.filter(l => l.state === 'on').length : 0; }
  function emStateHtml(kind) {
    const n = emLinksOn(), tot = EMST ? EMST.links.length : 2;
    const cls = n ? 'ok' : 'warn';
    const txt = n === 0 ? tx('Conectando con los repetidores…') : n < tot ? tx('En directo ({n} de {t} repetidores)', { n: n, t: tot }) : tx('En directo');
    const links = (EMST ? EMST.links : Em.BROKERS.map(b => ({ name: b.name, state: 'connecting' })))
      .map(l => '<span class="clink ' + (l.state === 'on' ? 'on' : '') + '" title="' + esc(l.state === 'on' ? tx('Conectado') : l.err ? tx('Sin conexión: {e}', { e: l.err }) : tx('Conectando…')) + '">' + esc(l.name) + '</span>').join('');
    const v = EMST ? EMST.viewers : 0, r = EMST ? EMST.remotes : 0;
    const who = kind === 'remote' ? (r ? '<b class="cok">' + tx('Stage Manager conectado') + '</b>' : tx('Sin Stage Manager conectado')) : kind === 'produccion' ? '<span>' + tx('{n} persona(s) de Producción', { n: PRODUCERS.length }) + '</span>' : tx(v === 1 ? '1 dispositivo conectado' : '{n} dispositivos conectados', { n: v });
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
    if (C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) zs.push({ id: '', name: tx('Sin zona') });
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
      box.innerHTML = '<p class="mnote">' + tx('Sin productores. Añade uno arriba.') + '</p>';
      return;
    }
    box.innerHTML = PRODUCERS.map((p, i) => {
      return '<div class="prod-item' + (p.id === PROD_SEL ? ' active' : '') + '" data-prod-idx="' + i + '">'
        + '<div class="prod-info">'
        + '<div class="prod-name">' + esc(p.name) + '</div>'
        + '<div class="prod-id">' + esc(p.id) + '</div>'
        + '</div>'
        + '<button class="prod-del" type="button" data-prod-del="' + i + '" title="' + tx('Eliminar') + '">✕</button>'
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
    return tx('Producción') + (p ? ' · ' + p.name : '');
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
      + '<div class="prod-state"><span class="prod-stat-dot' + (EM ? '' : ' off') + '"></span><span>' + tx(EM ? 'En directo' : 'Emisión parada') + '</span></div>'
      + '<div class="prod-buttons"><button class="btn" type="button" data-act="cast-big" data-k="produccion"><svg class="ic"><use href="#i-expand"/></svg>' + tx('Ampliar') + '</button><button class="btn" type="button" data-act="cast-copy" data-k="produccion"><svg class="ic"><use href="#i-copy"/></svg>' + tx('Copiar enlace') + '</button><button class="btn ghost" type="button" data-act="prod-regen"><svg class="ic"><use href="#i-refresh"/></svg>' + tx('Nueva clave…') + '</button></div></div>';
    // Marca este productor como seleccionado
    document.querySelectorAll('.prod-item').forEach(item => item.classList.remove('active'));
    const selItem = document.querySelector('[data-prod-idx="' + index + '"]');
    if (selItem) selItem.classList.add('active');
  }
  function castPickHtml() {
    const zs = castZones();
    return '<div class="cpick"><div class="cseg">' + Vs.VISTAS.map(v => '<button type="button" data-cv="' + v + '" class="' + (CAST_VISTA === v ? 'on' : '') + '">' + Vs.VISTA_TXT[v] + '</button>').join('') + '</div>'
      + (CAST_VISTA === 'confidence' ? '<select class="czone" data-cz="1">' + zs.map(z => '<option value="' + esc(z.id) + '"' + (z.id === CAST_ZONA ? ' selected' : '') + '>' + esc(z.name) + '</option>').join('') + '</select>' : '')
      + '<span class="csub">' + esc(tx(Vs.VISTA_SUB[CAST_VISTA])) + '</span></div>';
  }
  function paneHtml(kind) {
    const url = emUrl(kind);
    const side = kind === 'remote'
      ? '<button class="btn" type="button" data-act="cast-big" data-k="remote"><svg class="ic"><use href="#i-expand"/></svg>' + tx('Ampliar') + '</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="remote"><svg class="ic"><use href="#i-copy"/></svg>' + tx('Copiar enlace') + '</button>'
        + '<button class="btn ghost" type="button" data-act="cast-regencmd">' + tx('Nueva clave del mando…') + '</button>'
      : '<button class="btn" type="button" data-act="cast-big" data-k="staff"><svg class="ic"><use href="#i-expand"/></svg>' + tx('Ampliar') + '</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="staff"><svg class="ic"><use href="#i-copy"/></svg>' + tx('Copiar enlace') + '</button>'
        + '<button class="btn" type="button" data-act="cast-stop">' + tx('Parar emisión') + '</button>'
        + '<button class="btn ghost" type="button" data-act="cast-regen">' + tx('Regenerar claves…') + '</button>';
    const note = kind === 'remote'
      ? '<p class="cwarn"><svg class="ic"><use href="#i-alert"/></svg><span>' + tx('<b>Privado.</b> Quien tenga este QR puede mandar al Mac (▶ / ■, En hora, retrasos, mensajes, CALL). No lo compartas; si se escapa, «Nueva clave del mando».') + '</span></p>'
      : '<p class="mnote">' + tx('Abre la Pantalla Live en el dispositivo (móvil, tablet…), en solo lectura. Si el Mac se duerme o se cierra el Dashboard, la emisión se corta y los dispositivos lo avisan.') + '</p>';
    if (kind === 'produccion') {
      return '<div class="cprod-split"><div class="cprod-left"><div class="cprod-add"><input type="text" id="prod-input" placeholder="' + tx('Nombre productor…') + '" /><button class="btn primary" type="button" data-act="prod-add-person"><svg class="ic"><use href="#i-plus"/></svg></button></div><div class="cprod-list" id="prod-list"></div><p class="mnote">' + tx('Toca una persona para ver su QR. Ve la Live de Manager, confirma los CALL, manda mensajes y avisos y chatea contigo (sin tocar horarios).') + '</p></div><div class="cprod-right"><div id="prod-qr-side" class="prod-qr-side"></div></div></div>';
    }
    return (kind === 'staff' ? castPickHtml() : '') + '<div class="cgrid"><div class="cqr" title="' + tx('QR de {k}', { k: kind === 'remote' ? 'Stage Manager' : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA] }) + '">' + QR.svg(url, { ecl: 'M', margin: 3 }) + '</div>'
      + '<div class="cside"><div class="cst" data-k="' + kind + '"></div>' + side + '</div></div>' + note;
  }
  function renderCast() {
    if (!$('cast-staff')) return;
    const on = !!EM;
    $('cast-on').hidden = !on;
    $('cast-on').classList.toggle('warn', on && !emLinksOn());
    ['staff', 'remote', 'produccion'].forEach(kind => {
      const box = $('cast-' + kind);
      if (!emCan()) { box.innerHTML = '<p class="cintro">' + tx('Este navegador no permite la emisión cifrada.') + '</p>'; return; }
      if (!on) {
        box.dataset.url = '';
        box.innerHTML = (kind === 'remote'
          ? '<p class="cintro">' + tx('Con el <b>mando del Stage Manager</b> manejas el Mac desde tu dispositivo: ▶ / ■, En hora, retrasos con resumen y Confirmar, mensajes y CALL. Necesita que la emisión esté activa.') + '</p>'
          : kind === 'produccion'
          ? '<p class="cintro">' + tx('Acceso para <b>Producción</b>: ver la Live de Manager, confirmar CALL, enviar mensajes y avisos y chatear con el Stage Manager. Necesita que la emisión esté activa.') + '</p>'
          : '<p class="cintro">' + tx('Emite el horario en directo a los dispositivos del equipo (técnicos, producción, managers…). Lo ven <b>solo en lectura</b>: nadie puede cambiar nada desde ellos.') + '</p>')
          + '<div class="cbtns"><button class="btn primary" type="button" data-act="cast-start"><svg class="ic"><use href="#i-cast"/></svg>' + tx('Empezar a emitir') + '</button>'
          + (emRoom && kind === 'staff' ? '<button class="btn" type="button" data-act="cast-regen">' + tx('Regenerar claves…') + '</button>' : '') + '</div>'
          + '<p class="mnote">' + tx('Necesita internet en el Mac y en los dispositivos (4G o Wi-Fi con salida). Todo va cifrado: los repetidores públicos solo ven datos ilegibles y no guardan nada.') + '</p>';
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
      $('qr-big-t').textContent = bigTab === 'remote' ? tx('Stage Manager · mando (privado)') : bigTab === 'produccion' ? prodBigTitle() : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA] + (CAST_VISTA === 'confidence' ? ' · ' + ((castZones().find(z => z.id === CAST_ZONA) || {}).name || '') : '') + tx(' · solo lectura');
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
    catch (e) { modal(kind === 'remote' ? 'Enlace del mando (privado)' : kind === 'produccion' ? 'Enlace de Producción' : 'Enlace de Staff', '<input type="text" readonly value="' + esc(url) + '" style="width:100%" onfocus="this.select()">', [{ label: 'Cerrar' }]); }
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
  const EM_KEYS = [Dt.KEYS.festival, Dt.KEYS.config, Dt.KEYS.callDone, Dt.KEYS.flash, Dt.KEYS.avisos, Dt.KEYS.meteo, Dt.KEYS.standby];
  Dt.onWrite(k => { if (EM && EM_KEYS.indexOf(k) >= 0) EM.push(); });
  (function () { renderChat(); loadProducers(); const saved = emLoad(); if (saved) emRoom = saved.room; renderCast(); if (saved && saved.on) emStart(true); })();

  // ── Sincronización con la Pantalla Live ──────────────────────────────
  Dt.onChange(type => {
    if (type === 'callDone') { logLiveCallOks(); tick(); return; }
    if (type === 'avisos') { if (FEST) renderDrift(Math.floor(C.nowAbs())); return; }
    if (type === 'chat') { renderChat(); return; }
    if (type === 'flash') { renderFlash(); return; }
    if (type === 'meteo') { renderMeteo(); return; }
    if (type === 'standbyAll') { tick(); return; }
    loadState(); renderAll();
  });

  // ── Atajos y ayuda («?» o ⇧⌘7): lo que antes era texto fijo encima de la tabla ──
  function openHelp() {
    modal('Atajos y ayuda', '<dl class="keys">' +
      '<dt>' + tx('<kbd>Intro</kbd> o salir de la casilla') + '</dt><dd>' + tx('Aplica el cambio') + '</dd>' +
      '<dt><kbd>Esc</kbd></dt><dd>' + tx('Descarta lo que estabas escribiendo (y cierra menús y ventanas)') + '</dd>' +
      '<dt><kbd>Tab</kbd></dt><dd>' + tx('Pasa a la casilla siguiente') + '</dd>' +
      '<dt>' + tx('Doble clic en la hora real') + '</dt><dd>' + tx('Corrige la hora real de inicio de una banda que ya empezó') + '</dd>' +
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>F</kbd></dt><dd>' + tx('Modo foco: solo lo de directo, filas y letra más grandes') + '</dd>' +
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>C</kbd></dt><dd>' + tx('Alterna tema Alto Contraste (Escenario / Sol) al instante') + '</dd>' +
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>7</kbd></dt><dd>' + tx('Abre esta ayuda') + '</dd>' +
      '</dl><p class="hint">' + tx('Jornada = día del evento: lo que empieza antes de la hora de corte cuenta como la noche anterior. En la Pantalla Live: <kbd>F</kbd> pantalla completa · <kbd>V</kbd> cambia de vista.') + '</p>',
      [{ label: 'Cerrar' }]);
  }
  $('btn-help').addEventListener('click', openHelp);
  $('btn-focus').addEventListener('click', () => { setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); } });
  applyFocus();
  // ⇧⌘C: alterna el tema del Dashboard entre el normal y Escenario (alto contraste, para el sol). Recuerda el anterior.
  const PS_PREV_KEY = 'showtime.panel.style.prev';
  function togglePanelContrast() {
    const cur = panelStyle();
    let next;
    if (cur === 'escenario') {
      let prev = null; try { prev = JSON.parse(localStorage.getItem(PS_PREV_KEY) || 'null'); } catch (e) {}
      next = Dt.normStyle(prev && prev !== 'escenario' ? prev : 'raycast');
    } else {
      next = 'escenario';
      try { localStorage.setItem(PS_PREV_KEY, JSON.stringify(cur)); } catch (e) {}
    }
    try { localStorage.setItem(PS_KEY, JSON.stringify(next)); } catch (e) {}
    applyPanelStyle(next);
    const sel = $('cfg-style-panel'); if (sel) sel.value = next;
    toast(tx('Estilo del Dashboard: {s}', { s: next === 'escenario' ? tx('Escenario (Alto contraste)') : next === 'raycast' ? 'Raycast' : (sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : next) }), false, 2000);
  }
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); togglePanelContrast(); } });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Digit7' || e.key === '/' || e.key === '?')) { e.preventDefault(); openHelp(); } });

  // ── Pantalla siempre encendida ───────────────────────────────────────
  // Sin reposo: botón con micro-LED (verde = activo). Se puede apagar; la elección se recuerda en este equipo.
  // El estado del botón es la ELECCIÓN del usuario (wakeOn), no si el navegador tiene el bloqueo en este instante:
  // así el LED conmuta siempre al hacer clic. Con «off» explícito nada (ni tocar la app, ni volver a la pestaña) lo reactiva.
  const WAKE_KEY = 'showtime.wake';
  const WAKE_OK = 'wakeLock' in navigator;
  function wakeWanted() { try { return localStorage.getItem(WAKE_KEY) !== 'off'; } catch (e) { return true; } }
  let wakeOn = wakeWanted(), wakeLock = null, wakeBusy = false;
  function paintWake() {
    const b = $('wake'); if (!b) return;
    if (!WAKE_OK) { b.hidden = true; return; }
    b.hidden = false; b.classList.toggle('on', wakeOn); b.setAttribute('aria-pressed', String(wakeOn));
    const led = b.querySelector('.wled');   // el LED lleva su propio estado (Safari no siempre repinta el hijo al cambiar la clase del botón)
    if (led) { led.classList.toggle('on', wakeOn); led.style.backgroundColor = wakeOn ? 'var(--ok)' : '#5b5f67'; led.style.boxShadow = wakeOn ? '0 0 6px var(--ok)' : 'none'; }
    b.title = tx(wakeOn ? 'Sin reposo ACTIVO: el equipo no apaga la pantalla ni entra en reposo. Clic: desactivar'
      : 'Sin reposo apagado: el equipo puede apagar la pantalla. Clic: activar');
  }
  /** Pide el bloqueo de pantalla si el usuario lo quiere. Devuelve true si lo tiene. */
  async function requestWake() {
    if (!WAKE_OK || !wakeOn || document.visibilityState !== 'visible' || wakeLock || wakeBusy) { paintWake(); return !!wakeLock; }
    wakeBusy = true;
    let l = null;
    try { l = await navigator.wakeLock.request('screen'); } catch (e) { l = null; }
    wakeBusy = false;
    if (l && !wakeOn) { try { await l.release(); } catch (e) {} l = null; }   // se apagó mientras el navegador contestaba
    if (l) { wakeLock = l; l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; }); }
    paintWake();
    return !!l;
  }
  async function setWake(on) {
    wakeOn = !!on;
    try { if (wakeOn) localStorage.removeItem(WAKE_KEY); else localStorage.setItem(WAKE_KEY, 'off'); } catch (e) {}
    paintWake();
    if (!wakeOn) {
      const w = wakeLock; wakeLock = null;
      if (w) { try { await w.release(); } catch (e) {} }
      toast('Sin reposo desactivado: el equipo puede apagar la pantalla');
      return;
    }
    const got = await requestWake();
    toast(got ? 'Sin reposo activado: la pantalla no se apaga' : 'Sin reposo activado, pero el navegador aún no lo ha concedido: se vuelve a pedir al tocar la app', !got);
  }
  $('wake').addEventListener('click', () => setWake(!wakeOn));
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
    el.innerHTML = Mk.banner({ version: (window.ShowtimeEmision || {}).BUILD || '', footer: true }) + (about ? '<div class="splash-hint">' + tx('Clic o Esc para cerrar') + '</div>' : '');
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
  I18_READY = true;
  tick();
  setInterval(tick, 1000);
  requestWake();
  // Almacenamiento lleno: aviso fijo (los cambios siguen en pantalla y en la emisión, pero no se guardan en este navegador)
  Dt.onSaveState(ok => {
    const w = $('savewarn'); if (!w) return;
    w.hidden = ok;
    if (ok) toast('Se vuelve a guardar con normalidad');
  });

  // ── Paleta de comandos (⌘K / Ctrl+K o «/»): bandas, vistas y acciones; ⌘S, ⌘O y ⌘N con prioridad sobre el navegador ──
  const SPOT = { items: [], active: 0, open: false, q: '' };
  function spotNorm(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function spotSetDay(d) { CONFIG = Dt.setConfig({ day: d }); compute(); renderAll(); }
  function spotSetMode(m) { CONFIG = Dt.setConfig({ mode: m }); compute(); renderAll(); }
  function spotBands() {
    if (!FEST) return [];
    return C.buildBlocks(FEST, { mode: 'all', day: 'all' }).filter(b => C.isBand(b)).map(b => ({
      group: tx('Bandas'), label: b.name || tx('(sin nombre)'), sub: fmtDay(b.jornada) + ' · ' + C.fmtHM(b.si) + ' · ' + (b.stage || tx('Sin zona')),
      pill: '<span class="spot-pill tp-' + b.kind + '" aria-hidden="true">' + pillTxt(b.kind) + '</span>', kbd: '', search: (b.name || '') + ' ' + (b.stage || '') + ' ' + fmtDay(b.jornada),
      run: () => spotJump(b)
    }));
  }
  /** Vistas y acciones en el idioma del Panel (se buscan por el texto traducido y por las palabras en español). */
  function spotActions() {
    return spotActionsEs().map(a => Object.assign(a, { group: tx(a.group), label: tx(a.label), sub: a.sub ? tx(a.sub) : a.sub }));
  }
  function spotActionsEs() {
    return [
      { group: 'Vistas', label: 'Jornada completa', ic: 'i-clock', sub: 'Todos los días, todo el horario', search: 'jornada completa todo dia', run: () => { spotSetDay('all'); spotSetMode('all'); } },
      { group: 'Vistas', label: 'Shows', ic: 'i-stage', sub: 'Solo conciertos', search: 'shows conciertos', run: () => spotSetMode('show') },
      { group: 'Vistas', label: 'Soundchecks', ic: 'i-stage', sub: 'Solo soundchecks', search: 'soundchecks pruebas', run: () => spotSetMode('sc') },
      { group: 'Vistas', label: 'Modo Foco', ic: 'i-expand', kbd: '⇧⌘F', sub: focusOn() ? 'Activado · desactivar' : 'Solo lo de directo, letra grande', search: 'modo foco directo', run: () => { setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); } },
      { group: 'Vistas', label: 'Alto Contraste (Escenario / Sol)', ic: 'i-sun', kbd: '⇧⌘C', sub: panelStyle() === 'escenario' ? 'Activado · volver al tema anterior' : 'Para el sol en directo', search: 'alto contraste escenario sol', run: () => togglePanelContrast() },
      { group: 'Vistas', label: 'Standby en Confidence', ic: 'i-pause', sub: standbyOn() ? 'Activado · quitar' : 'Cartel y hora en las Confidence', search: 'standby confidence cartel', run: () => setStandby(!standbyOn()) },
      { group: 'Acciones', label: 'Imprimir hoja de ruta…', ic: 'i-print', kbd: '⌘P', sub: 'Tabla o cronograma, una hoja por jornada', search: 'imprimir hoja ruta pdf running order cronograma gantt daysheet', run: () => openPrint() },
      { group: 'Acciones', label: 'Exportar PDF', ic: 'i-print', sub: 'Hoja de ruta en tabla, lista para Guardar como PDF', search: 'exportar pdf hoja ruta tabla', run: () => openPrint('tabla') },
      { group: 'Acciones', label: 'Running Order', ic: 'i-print', sub: 'Tabla de horario por jornada', search: 'running order tabla horario daysheet', run: () => openPrint('tabla') },
      { group: 'Acciones', label: 'Importar horario', ic: 'i-paste', sub: 'Pegar o abrir un horario', search: 'importar pegar horario excel csv pdf', run: () => openImport('') },
      { group: 'Acciones', label: 'Guardar (exportar JSON)', ic: 'i-out', kbd: '⌘S', sub: 'Copia de seguridad del evento', search: 'guardar exportar json copia', run: () => { if (!FEST) toast('No hay evento abierto', true); else exportJSON(); } },
      { group: 'Acciones', label: 'Nuevo evento', ic: 'i-plus', kbd: '⌘N', sub: 'Empezar un evento vacío o desde un horario', search: 'nuevo evento crear', run: () => askNew() },
      { group: 'Acciones', label: 'Abrir evento', ic: 'i-in', kbd: '⌘O', sub: 'Abrir un .json de Showtime o Synapse', search: 'abrir evento json', run: () => $('file').click() },
      { group: 'Acciones', label: 'Configuración', ic: 'i-gear', sub: 'Estilos, zonas, mensajes y más', search: 'configuracion ajustes opciones', run: () => openConfig() },
      { group: 'Acciones', label: 'Atajos y ayuda', ic: 'i-dots', kbd: '⇧⌘7', sub: 'Lista de atajos', search: 'ayuda atajos teclas', run: () => openHelp() }
    ];
  }
  /** Lo que coincide con lo escrito (todas las palabras). Sin texto: vistas y acciones; con texto, también bandas. */
  function spotItems(q) {
    const words = spotNorm(q).trim().split(/\s+/).filter(Boolean);
    const hit = txt => words.every(w => spotNorm(txt).indexOf(w) >= 0);
    const bands = words.length ? spotBands().filter(b => hit(b.search)).slice(0, 12) : [];
    const acts = spotActions().filter(a => !words.length || hit(a.label + ' ' + a.search));
    return bands.concat(acts);
  }
  function spotRender() {
    SPOT.items = spotItems(SPOT.q);
    if (SPOT.active >= SPOT.items.length) SPOT.active = 0;
    const box = $('spot-list'); if (!box) return;
    if (!SPOT.items.length) { box.innerHTML = '<div class="spot-empty">' + tx('Nada coincide con «{q}»', { q: esc(SPOT.q) }) + '</div>'; return; }
    let g = null, h = '';
    SPOT.items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; h += '<div class="spot-g">' + esc(g) + '</div>'; }
      h += '<button type="button" class="spot-i' + (i === SPOT.active ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="spot-slot">' + (it.pill || (it.ic ? '<svg class="ic spot-ic" aria-hidden="true"><use href="#' + it.ic + '"/></svg>' : '')) + '</span>' +
        '<span class="spot-t">' + esc(it.label) + '</span>' +
        (it.sub ? '<span class="sm">' + esc(it.sub) + '</span>' : '') +
        (it.kbd ? '<kbd>' + esc(it.kbd) + '</kbd>' : '') + '</button>';
    });
    box.innerHTML = h;
    const on = box.querySelector('.spot-i.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function spotMove(d) {
    const n = SPOT.items.length; if (!n) return;
    SPOT.active = (SPOT.active + d + n) % n; spotRender();
  }
  function spotOpen() {
    closeMenus(); closeConfig && closeConfig();
    SPOT.open = true; SPOT.q = ''; SPOT.active = 0;
    $('spotlight').hidden = false; $('spot-q').value = ''; spotRender(); $('spot-q').focus();
  }
  function spotClose() { SPOT.open = false; $('spotlight').hidden = true; }
  function spotRun(i) { const it = SPOT.items[i]; if (!it) return; spotClose(); it.run(); }
  /** Salta a una banda: cambia la jornada o la vista si estaba oculta, la lleva al centro y la resalta con el flash. */
  function spotJump(b) {
    if (CONFIG.day !== 'all' && CONFIG.day !== b.jornada) CONFIG = Dt.setConfig({ day: b.jornada });
    if (CONFIG.mode !== 'all' && CONFIG.mode !== b.kind) CONFIG = Dt.setConfig({ mode: 'all' });
    compute(); renderAll();
    const row = b.key ? document.querySelector('#tbody tr[data-key="' + CSS.escape(b.key) + '"]') : null;
    if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); row.scrollIntoView({ block: 'center' }); }
    else toast('No se ve esa banda ahora', true);
  }
  function typingTarget(e) { const t = e.target || {}; return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t.isContentEditable; }
  $('spot-q').addEventListener('input', () => { SPOT.q = $('spot-q').value; SPOT.active = 0; spotRender(); });
  $('spot-q').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); spotMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); spotMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); spotRun(SPOT.active); }
  });
  $('spot-list').addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-i]'); if (b) spotRun(+b.dataset.i); });
  $('spotlight').addEventListener('click', e => { if (e.target === $('spotlight')) spotClose(); });
  document.addEventListener('keydown', e => {
    const k = String(e.key || '').toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && SPOT.open) { e.preventDefault(); spotClose(); return; }
    if (mod && !e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); SPOT.open ? spotClose() : spotOpen(); return; }
    if (!mod && !e.altKey && e.key === '/' && !typingTarget(e)) { e.preventDefault(); SPOT.open ? spotClose() : spotOpen(); return; }
    if (mod && !e.shiftKey && !e.altKey && k === 's') { e.preventDefault(); if (!FEST) toast('No hay evento abierto', true); else exportJSON(); return; }
    if (mod && !e.shiftKey && !e.altKey && k === 'o') { e.preventDefault(); $('file').click(); return; }
    if (mod && !e.shiftKey && !e.altKey && k === 'n') { e.preventDefault(); askNew(); return; }
  });
  window.ShowtimePanel = { reload: () => { loadState(); renderAll(); }, _test: { winState: () => Array.from(WIN.entries()).map(([id, x]) => ({ id, name: x.name, vista: x.vista, zona: x.zona, standby: !!x.standby, fs: x.fs })), setWinVista, setWinStandby, closeLive, openGestor, gestorVisible, emProdMessage, emRegenProd, hitoChips, emUrl, prodBigTitle, fileKind, handleFile, emCommand, importSummary, hidesSome, tipoPill, setWake, wakeState: () => ({ on: wakeOn, lock: !!wakeLock }), showSplash, hideSplash, setStandby, standbyOn, room: () => emRoom } };   // _test: solo para tests/control.test.js
})();
