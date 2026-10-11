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
  const back = s => I18 && I18.txBack ? I18.txBack(s) : s;   // avisos y errores que llegan escritos en español (core, importador, mando) → idioma activo

  // ── Estado (declarado antes de usarse) ───────────────────────────────
  let FEST = null, ORIG = null, CONFIG = Dt.getConfig();
  let BLOCKS = [], ALL_MODE = [], TAREAS = [], DAY_MISSING = '';
  // LIVE: bloques del DIRECTO (En escena, Siguiente, CALL, cambios, Bis). Con Shows / Soundchecks / Todo es lo mismo que BLOCKS;
  // con Tareas / Marcadores (que filtran solo la tabla) es la jornada completa: nunca se pierde un CALL ni un show en escena (dec. 116).
  let LIVE = [], LIVE_MISSING = '';
  const UNDO = [];                 // festivales anteriores (JSON), para «Deshacer»
  const UNDO_MAX = 30;
  // Ventanas Live de este Dashboard: id (= nombre técnico de la ventana) → { w, name, vista, zona, standby }. Lo que dice cada ventana se actualiza en vivo.
  const WIN = new Map();
  const LIVE_NAMES_KEY = 'showtime.liveNames';   // { id: nombre } de las ventanas abiertas, para recordar el nombre tras recargar
  const VISTA_OPCIONES = [['manager', 'Manager'], ['confidence', 'Confidence'], ['backstage', 'Backstage']];
  const Vs = window.ShowtimeVistas;
  // Dec. 152 · avisos meteo recién llegados (pista visual local «!»). Aquí arriba: loadNew() puede rearmar antes de llegar a renderMeteo.
  // Orden por llegada (dec. 152, L.A.): [{ id, at }] con la hora local de detección. Se guarda SOLO en este navegador
  // («showtime.meteoOrder», dec. 153), por contexto evento + fuente Meteo; nunca va al evento, la emisión, el log ni los datos
  // compartidos. null = la próxima lectura la recupera (mismo contexto) o fija la referencia, sin hora, «!» ni salto.
  let MT_ORDER = null, MT_CLEAN = false, MT_SAVED = '';   // MT_CLEAN: la próxima lectura ignora lo guardado (rearme)
  const MT_ORD_KEY = 'showtime.meteoOrder';
  const MT_NEW = new Set();    // ids con «!» puesto (se quita con hover o toque; nunca por tiempo)
  let MT_SIG;                  // evento de la lectura anterior (cambiar de evento rearma)
  let CALL_UNDO = null;   // dec. 148: { add: [OK de CALL que vuelven], del: [claves que se quitan] } para el paso de Deshacer de una edición
  const AU = window.ShowtimeAudio || null;   // avisos de audio locales (dec. 145, audio.js)
  const AU_EDGE = AU ? { call: AU.edge(), overrun: AU.edge(), meteo: AU.edge() } : null;   // el primer tick solo arma: nunca suena al cargar
  if (AU) AU.armGestures(document);   // el navegador solo deja sonar tras un clic o una tecla
  let MSG_TO = null;                  // destino de los mensajes flash: null = todas las pantallas; si no, lista de vistas
  let MSG_ZONES = null;               // zonas de las pantallas Confidence que lo reciben: null = todas
  function zoneLabel(id) { const z = FEST && C.getEscenario(FEST, id); return z ? z.nombre : tx('Sin zona'); }
  const SPLASH_MS = 2500;   // pantalla de inicio (se va sola; clic o Esc la cierran antes)
  let pendingRender = false;       // si llegan datos mientras se edita una casilla, se pinta al salir
  const KEY_LABEL = { nombre: 'nombre', escenario: 'zona', color: 'color', tipo: 'tipo', jornada: 'jornada', fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'CALL', notas: 'notas' };
  const TIPO_TXT = { banda: 'banda', tarea: 'tarea', hito: 'marcador' };
  // Vistas: Jornada completa (todo) · Shows · Soundchecks
  const VIEW = { all: { title: 'Jornada completa', short: 'Todo', what: 'entradas' }, show: { title: 'Shows', what: 'shows' }, sc: { title: 'Soundchecks', what: 'soundchecks' },
    tarea: { title: 'Tareas', what: 'tareas' }, hito: { title: 'Marcadores', what: 'marcadores' } };   // tarea / hito: dec. 116

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
  /** Solo la vista activa (dec. 129): el Modo Foco ya se ve en su botón con LED, no se repite en «Ver». */
  function viewLabel() { return tx(viewOf().short || viewOf().title); }
  // ── Modo foco (para operar en directo a 1-2 m): menos columnas, filas y letra más grandes. Preferencia de este equipo ──
  const FOCUS_KEY = 'showtime.panel.focus';
  function focusOn() { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch (e) { return false; } }
  function applyFocus() {
    const on = focusOn(), b = document.getElementById('btn-focus');
    document.body.classList.toggle('focus', on);
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.title = tx(on ? 'Modo foco ACTIVO: solo lo de directo, filas y letra más grandes. Clic: activar / desactivar (⇧⌘F)' : 'Modo foco: solo lo de directo, filas y letra más grandes. Clic: activar / desactivar (⇧⌘F)'); }
    const l = document.getElementById('view-lbl'); if (l) l.textContent = viewLabel();
    try { dwRelayout(); } catch (e) {}   // anchos propios del Dashboard: el resto se vuelve a tomar con las columnas de este modo
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
    if (!FEST) { BLOCKS = []; LIVE = []; LIVE_MISSING = ''; ALL_MODE = []; TAREAS = []; DAY_MISSING = ''; MARGINS = []; return; }
    const day = CONFIG.day || 'all', em = C.engineMode(CONFIG.mode);
    DAY_MISSING = (day !== 'all' && C.festivalDays(FEST, CONFIG.mode).indexOf(day) < 0) ? day : '';
    BLOCKS = DAY_MISSING ? [] : C.buildBlocks(FEST, { mode: CONFIG.mode, day: day });
    LIVE_MISSING = em === CONFIG.mode ? DAY_MISSING : (day !== 'all' && C.festivalDays(FEST, em).indexOf(day) < 0) ? day : '';
    LIVE = em === CONFIG.mode ? BLOCKS : LIVE_MISSING ? [] : C.buildBlocks(FEST, { mode: em, day: day });
    ALL_MODE = C.buildBlocks(FEST, { mode: em, day: 'all' });
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
    if (CALL_UNDO) { UNDO[UNDO.length - 1].cd = CALL_UNDO; CALL_UNDO = null; }   // dec. 148: el OK de CALL va en el MISMO paso de Deshacer
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
    if (u.cd) undoCallDone(u.cd);   // antes de pintar: el OK vuelve a la vez que la hora (sin sonido, sin apunte nuevo de «CALL OK»)
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
    $('btn-undo').title = UNDO.length ? tx('Deshacer ({n}): {what} (⌘Z)', { n: UNDO.length, what: UNDO[UNDO.length - 1].m }) : tx('Nada que deshacer');
    $('fest-name').textContent = has ? C.eventName(FEST, tx) : tx('Sin evento');
    $('fest-name').title = $('fest-name').textContent;   // si un nombre muy largo se recorta con «…», entero al pasar el ratón
    const d = has && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    $('mods').hidden = !d.total;
    // Indicador binario (dec. 128): solo un punto ámbar; qué ha cambiado, al pasar el ratón y para lectores de pantalla
    $('mods').textContent = '';
    $('mods').title = d.total ? [tx('Cambios sin exportar a JSON (⌘S)'), tx('{n} sin exportar', { n: d.total }), d.added && tx('{n} banda(s) nueva(s)', { n: d.added }), d.removed && tx('{n} borrada(s)', { n: d.removed }), d.fields && tx('{n} casilla(s) cambiada(s)', { n: d.fields }), d.festival && tx('datos del evento o zonas')].filter(Boolean).join(' · ') : '';
    $('mods').setAttribute('aria-label', $('mods').title);
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
    // Temporadas (dec. 124): con más de 7 jornadas o más de un mes, cabecera fija por mes («JULIO 2026»)
    const byMonth = days.length > 7 || new Set(days.map(d => d.slice(0, 7))).size > 1;
    let mes = '';
    html += days.map(d => {
      const head = byMonth && d.slice(0, 7) !== mes ? '<div class="dmonth" role="presentation">' + esc(monthLabel(d)) + '</div>' : '';
      mes = d.slice(0, 7);
      return head + tab(d, fmtDay(d), withData.indexOf(d) < 0 ? 'vacia' : '', withData.indexOf(d) < 0 ? tx('Sin {what} todavía', { what: tx(viewOf().what) }) : '');
    }).join('');
    if (FEST && CONFIG.day !== 'all' && days.indexOf(CONFIG.day) < 0) html += tab(CONFIG.day, fmtDay(CONFIG.day), 'falta', tx('Fuera de las jornadas del evento'));
    $('days').innerHTML = html;
    // Flechas ◀ / ▶ (dec. 124): jornada anterior / siguiente; desde «Todas», a la primera / la última
    const st = dayStep();
    $('day-prev').disabled = !st.prev; $('day-next').disabled = !st.next;
  }
  /** Mes y año de una jornada, en el idioma del Panel («julio de 2026» → «JULIO 2026» con CSS). */
  function monthLabel(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(iso || ''); if (!m) return '';
    return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString(LOCALE(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/\s+de\s+/i, ' ');
  }
  /** A qué jornada llevan las flechas: { prev, next } (null = flecha apagada). */
  function dayStep() {
    const days = FEST ? jornadaOptions() : [];
    if (!days.length) return { prev: null, next: null };
    const cur = CONFIG.day;
    if (!cur || cur === 'all') return { prev: days[0], next: days[days.length - 1] };
    const before = days.filter(d => d < cur), after = days.filter(d => d > cur);
    return { prev: before.length ? before[before.length - 1] : null, next: after.length ? after[0] : null };
  }
  function stepDay(dir) {
    const d = dayStep()[dir]; if (!d) return;
    CONFIG = Dt.setConfig({ day: d }); compute(); renderAll(); closeMenus();
  }
  $('day-prev').addEventListener('click', () => stepDay('prev'));
  $('day-next').addEventListener('click', () => stepDay('next'));
  // Con muchas jornadas, el menú se abre ya en la elegida (no en junio cuando estás en septiembre)
  document.querySelector('#m-days .mbtn').addEventListener('click', () => setTimeout(() => {
    const box = $('days'), on = box && box.querySelector('button.on');
    if (on && box.getBoundingClientRect) box.scrollTop += on.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2 + 16;
  }, 0));

  function renderWarn() {
    const w = $('warn');
    let msg = '';
    if (FEST && !(FEST.escenarios || []).length) msg = tx('Este evento no tiene zonas. Créalas en Configuración › Zonas o desde la columna Zona de cualquier fila.');
    else if (DAY_MISSING && C.isKindMode(CONFIG.mode)) msg = tx('El {dia} no tiene {what}.', { dia: fmtDay(DAY_MISSING), what: tx(viewOf().what) });   // la Live no filtra por tareas / marcadores
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
    modal(i18t(sc ? 'bis.modalSc' : 'bis.modalShow'), '<p>' + esc(back(r.msg)) + '</p>', [
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
      (a.by ? '<b class="byl">' + esc(Vs.byLabel(a.by)) + '</b> ' : '') + esc(a.text) + '<button class="avx" type="button" data-aviso-x="' + esc(a.id) + '" title="' + tx('Quitar aviso') + '" aria-label="' + tx('Quitar aviso') + '"><svg class="ic"><use href="#i-x"/></svg></button></span>').join('');
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
      td('escenario', 'stage', '<input type="text" list="zones-dl" data-k="zona" value="' + esc(esc0 ? esc0.nombre : '') + '" data-orig="' + esc(esc0 ? esc0.nombre : '') + '" placeholder="' + tx(band ? '— zona —' : '— ninguna —') + '" style="--sc:' + scol + '" title="' + tx('Elige una zona o escribe una nueva para crearla') + '" aria-label="' + tx('Zona') + ': ' + tx('Elige una zona o escribe una nueva para crearla') + '" autocomplete="off" spellcheck="false">' +
        (esc0 && esc0.nombre ? '<span class="ntip ntip-l" aria-hidden="true">' + esc(esc0.nombre) + '</span>' : '')) +   // nombre entero si se corta (v20261169)
      '<td class="name' + (isMod('nombre') || isMod('color') ? ' mod' : '') + '"><div class="nm">' + tipoPill(band ? mode : tipo) +
        '<input type="color" data-k="color" value="' + col + '" data-orig="' + col + '" title="' + tx('Color de la banda') + '">' +
        '<input type="text" data-k="nombre" value="' + esc(a.nombre || '') + '" data-orig="' + esc(a.nombre || '') + '" autocomplete="off" spellcheck="false">' +
        (a.nombre ? '<span class="ntip ntip-l" aria-hidden="true">' + esc(a.nombre) + '</span>' : '') +
        (isNew ? '<span class="tag" title="' + tx('Creada desde la última importación/exportación') + '">' + tx('NUEVA') + '</span>' : '') + '</div></td>' +
      td('call', 't', band ? inp('call', '—') : off) +
      td('standby', 'gap', gap) +
      td('notas', 'n', inp('notas') + (v('notas') ? '<span class="ntip" aria-hidden="true">' + esc(v('notas')) + '</span>' : '')) +   // nota entera en tarjeta flotante (dec. 122)
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
    // v20261169: Zona con ancho base compacto y estable (--escw: 112 px en control.css), sin crecer con la zona más larga del evento:
    // una zona larga se lee al pasar el ratón (si se corta) o ensanchando la columna a mano
    try { dwAria(); } catch (e) {}   // nombres de tiradores y ↶ en el idioma actual
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
    try { dwLane(); } catch (e) {}   // ancho real del carril de ··· ya con sus filas
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
      nombre: g('add-nombre'), escenarioId: g('add-escenario'), jornada: FEST ? g('add-jornada') : g('add-ev-fecha'), inicio: g('add-inicio'),
      // Fin: hora (23:30) o duración con «+» (+60 = 60 min desde el inicio)
      fin: /^\s*\+/.test(g('add-fin')) ? '' : g('add-fin'), duracion: /^\s*\+/.test(g('add-fin')) ? g('add-fin').replace(/^\s*\+\s*/, '').trim() : '', call: g('add-call'), notas: g('add-notas') };
  }

  function updateAddHint() {
    const d = addValues(), ini = C.normHM(d.inicio);
    let h = '';
    const ref = FEST || { event: { dayCutoff: C.DEFAULT_CUTOFF } };   // sin evento: el corte por defecto del que se creará
    if (ini && C.dayIndex(d.jornada) !== null) {
      const f = C.fechaFor(ref, d.jornada, ini);
      if (f !== d.jornada) h = tx('{h} es antes de la hora de corte ({cut}): jornada {jor}, fecha real {fecha}.', { h: ini, cut: ref.event.dayCutoff || C.DEFAULT_CUTOFF, jor: fmtDay(d.jornada), fecha: fmtDay(f) });
    }
    const dur = String(d.duracion || '').trim();
    if (ini && /^\d+$/.test(dur)) h += (h ? ' ' : '') + tx('Fin: {h}.', { h: C.fmtHM(C.parseHM(ini) + Number(dur)) });
    $('add-hint').textContent = h;
  }

  function addBand() {
    document.querySelectorAll('#addrow .bad, #add-newev .bad').forEach(x => x.classList.remove('bad'));
    const v = addValues();
    // Dec. 155: sin evento, se prepara (sin guardar nada) el evento nuevo con su nombre (vacío = «Evento sin nombre») y la fecha
    // de esta primera entrada. Solo se crea si la entrada también vale: evento + primera fila en una sola acción.
    let base = FEST, evName = '';
    if (!FEST) {
      const fecha = $('add-ev-fecha').value;
      evName = String($('add-ev-nombre').value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (C.dayIndex(fecha) === null) { $('add-err').textContent = tx('Elige la fecha del evento'); $('add-ev-fecha').classList.add('bad'); $('add-ev-fecha').focus(); return; }
      const nf = C.newFestival({ nombre: evName || C.UNNAMED, fechaInicio: fecha, fechaFin: fecha, dayCutoff: C.DEFAULT_CUTOFF });
      if (!nf.ok) { $('add-err').textContent = back(nf.error); return; }
      base = nf.state;
    }
    const z = resolveZone(base, $('add-escenario').value);
    if (!z.ok) { $('add-err').textContent = back(z.error); $('add-escenario').classList.add('bad'); return; }
    v.escenarioId = z.id;
    const r = C.addArtist(z.state, v.modo, v);
    if (!r.ok) {
      $('add-err').textContent = back(r.error);
      const f = r.field && document.querySelector('#addrow [data-f="' + (r.field === 'duracion' ? 'fin' : r.field) + '"]');
      if (f) { f.classList.add('bad'); f.focus(); }
      return;
    }
    $('add-err').textContent = '';
    if (!FEST) {   // la referencia es el evento vacío: la primera entrada cuenta como «sin exportar» y se puede deshacer
      loadNew(base, evName ? tx('Evento creado: {_e}', { _e: evName }) : tx('Evento creado'));
      $('add-ev-nombre').value = '';
    }
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
    if (!$('imp').hidden) return;   // dec. 155: nunca se salta de «Pegar horario» a otro modal (el borrador no se pierde)
    closeMenus(); closeConfig();
    $('add-err').textContent = '';
    // Dec. 155: con evento, solo se informa de a cuál se añade (no se renombra aquí); sin evento, la ficha trae lo mínimo para crearlo
    $('addm').classList.toggle('noev', !FEST);
    $('add-target').hidden = !FEST; $('add-newev').hidden = !!FEST;
    if (FEST) $('add-target').textContent = tx('Añadiendo a: {_e}', { _e: C.eventName(FEST, tx) });
    else if (C.dayIndex($('add-ev-fecha').value) === null) $('add-ev-fecha').value = C.jornadaOfAbs({ event: { dayCutoff: C.DEFAULT_CUTOFF } }, Math.floor(C.nowAbs()));
    renderAddRow();
    $('addm').hidden = false;
    $('add-nombre').focus();
  }
  function closeAdd() { $('addm').hidden = true; }
  // Dec. 155: «+ Añadir» abre SOLO el alta manual normal (sin pestañas). La preferencia antigua «showtime.addtab» ya no se usa: se borra.
  try { localStorage.removeItem('showtime.addtab'); } catch (e) {}
  $('btn-new-row').addEventListener('click', () => openAdd());
  $('addm-cancel').addEventListener('click', closeAdd);
  $('addm').addEventListener('click', e => { if (e.target.id === 'addm') closeAdd(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('addm').hidden) closeAdd(); });

  // Filas que suenan / siguientes / pasadas (solo clases: no rehace las casillas)
  function markRows(nowInt) {
    const playing = new Set(C.playingNow(LIVE, nowInt).concat(C.tasksNow(LIVE, nowInt)).map(b => b.key));
    const next = new Set(C.nextPerStage(LIVE, nowInt).map(b => b.key));
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

  // Dec. 149 · jerarquía por escenario en En escena, Siguiente y CALL: NOMBRE DE LA ZONA (una vez, en su color) → contenido →
  // hora · tiempo. «Principal» nunca queda implícito; sin zona, «SIN ZONA». La última línea no repite la zona.
  function zoneHtml(rows) {
    return Vs.zoneGroups(rows).map(g => '<div class="v-zg" style="--zc:' + (g.color || 'var(--muted)') + '"><div class="v-zone">' + esc(g.name || tx('SIN ZONA')) + '</div>' + g.items.join('') + '</div>').join('');
  }
  // Vista en vivo (mismas reglas que la Pantalla Live)
  function renderLive(nowMins, nowInt) {
    const order = id => { const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === id); return i < 0 ? 999 : i; };
    const rows = [];
    const zc = b => b && b.stage ? safeColor(b.stageColor || b.color, '#888') : '';
    const kindTxt = b => b.kind === 'sc' ? tx('Soundcheck') : b.kind === 'show' ? tx('Show') : '';
    const nameKind = b => esc(b.name) + (kindTxt(b) ? '<span class="v-kind"> · ' + esc(kindTxt(b)) + '</span>' : '');
    const span = b => C.fmtHM(b.si) + '–' + C.fmtHM(b.sf);
    C.playingNow(LIVE, nowInt).forEach(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), p = C.progress(b, nowInt), xo = xtraOver(b, nowInt);
      rows.push({ o: order(b.stageId), z: b.stageId, zn: b.stage, zc: zc(b), h: '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + nameKind(b) + (xo !== null ? auMuteBtn('overrun:' + b.key, b.name) : '') + '</div>' +   // silenciar: solo audio, lejos del botón Tiempo extra (dec. 148)
        '<div class="v-rem" style="color:' + col + '">' + span(b) + ' · ' + (xo !== null ? tx('TIEMPO EXTRA · +{n} min', { n: xo }) : tx('{n} min restantes', { n: p.remaining }) + (b.alargar && b.rf === null ? ' · ' + tx('tiempo extra') : '')) + '</div>' + (b.rf === null ? xtraBtn(b) : '') + '</div>' });
    });
    const bis = bisCands(nowInt), bisShown = new Set(), bisFor = z => { z = z || ''; if (!bis[z]) return ''; bisShown.add(z); return bisBtnHtml(bis[z]); };
    C.playingNow(LIVE, nowInt).forEach(b => bisShown.add(b.stageId || ''));   // la zona ya suena: ahí no se ofrece el bis
    C.changeoversNow(LIVE, nowMins, TAREAS).forEach(co => {
      const col = safeColor(co.stageColor || co.next.color, '#888'), z = { o: order(co.stageId), z: co.stageId, zn: co.stage, zc: co.stage ? col : '' };
      if (!co.standby && co.kind === 'idle') {      // hueco sin cambio real (decisión 76): zona arriba y «— Sin actividad —»
        rows.push(Object.assign(z, { h: '<div class="v-row co idle" style="--c:' + col + '"><div class="v-meta">— ' + tx('Sin actividad') + ' —</div>' + (co.prev ? '' : bisFor(co.stageId)) + '</div>' }));
        return;
      }
      rows.push(Object.assign(z, { h: '<div class="v-row co' + (co.standby ? ' sb' : '') + '" style="--c:' + col + '"><div class="v-name" style="color:' + (co.standby ? 'var(--muted)' : col) + '">' +
        (co.standby ? 'STANDBY' : 'CHANGEOVER') + ' · <span class="v-co">' + tx(co.standby ? 'después' : 'entra') + ' <b>' + esc(co.next.name) + '</b></span></div>' +
        '<div class="v-rem">' + C.fmtHM(co.next.si) + ' · ' + tx('quedan {t}', { t: fmtCountdown(co.remaining) }) + '</div>' + bisFor(co.stageId) + '</div>' }));
    });
    // Zonas cuya última banda acaba de terminar sin tarjeta de cambio (fin de la noche, o pasada la hora de corte): el bis sigue a mano
    Object.keys(bis).filter(z => !bisShown.has(z)).forEach(z => {
      const c = bis[z], col = safeColor(c.b.stageColor || c.b.color, '#888');
      rows.push({ o: order(z), z, zn: c.b.stage, zc: zc(c.b), h: '<div class="v-row co ended" style="--c:' + col + '"><div class="v-name" style="color:var(--muted)">' + tx('ACABÓ') + ' · ' + esc(c.b.name) + '</div>' +
        '<div class="v-meta">' + tx('a las {h} · hace {n} min', { h: C.fmtHM(c.b.nf), n: c.late }) + '</div>' + bisBtnHtml(c) + '</div>' });
    });
    // Tareas en curso (operativa del día): bajo su zona (o «SIN ZONA», al final), sin cuenta de cambio
    C.tasksNow(LIVE, nowInt).forEach(b => {
      const p = C.progress(b, nowInt);
      rows.push({ o: b.stageId ? order(b.stageId) : 1000, z: b.stageId || '', zn: b.stage, zc: b.stage ? '#7dd3fc' : '', h: '<div class="v-row tarea"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + '–' + C.fmtHM(C.blockEnd(b)) + ' · ' + tx('quedan {n} min', { n: p.remaining }) + '</div></div>' });
    });
    rows.sort((a, b) => a.o - b.o);
    const r = C.pickBlocks(LIVE, nowInt, 1);
    $('v-now').innerHTML = rows.length ? zoneHtml(rows) : '<div class="v-empty">' + (LIVE_MISSING ? tx('Jornada sin datos') : r.ended ? tx('FIN DE JORNADA') : '—') + '</div>';

    const next = C.nextPerStage(LIVE, nowInt);
    $('v-next').innerHTML = next.length ? zoneHtml(next.map(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), co = C.changeoverBefore(LIVE, b, TAREAS);
      const badge = co ? (co.mins < 0 ? tx('Solapa {n} min', { n: -co.mins }) : b.standby ? tx('Standby {n} min', { n: co.mins }) : co.idle ? '' : tx('Cambio {n} min', { n: co.mins })) : '';
      return { o: order(b.stageId), z: b.stageId, zn: b.stage, zc: zc(b), h: '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + nameKind(b) + '</div>' +
        '<div class="v-meta">' + span(b) + (badge ? ' · ' + badge : '') + '</div></div>' };   // sin Tiempo extra: solo tiene sentido para la que suena (o el bis)
    }).sort((a, b) => a.o - b.o)) : '<div class="v-empty">—</div>';

    const done = new Set(Dt.getCallDone());
    const calls = C.callList(LIVE, nowInt, Dt.callMinsOf(FEST, CONFIG), done);
    $('v-call').innerHTML = calls.length ? zoneHtml(calls.map(b => {
      const col = safeColor(b.stageColor || b.color, '#ffc533');
      return { o: order(b.stageId), z: b.stageId, zn: b.stage, zc: b.stage ? col : '', h: '<div class="v-row v-call" style="--c:' + col + '"><div><div class="v-name" style="color:' + col + '">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + ' · ' + tx('en {n} min', { n: Math.max(1, Math.round(b.si - nowInt)) }) + '</div></div>' +
        '<button class="okbtn" data-ck="' + esc(C.callKey(b)) + '" title="' + tx('Marcar como avisado') + '">OK</button></div>' };
    }).sort((a, b) => a.o - b.o)) : '<div class="v-empty">—</div>';
    $('card-call').classList.toggle('hot', calls.length > 0);
  }

  function tick() {
    const d = new Date();
    $('clock').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    const nOpen = openIds().length;
    renderHubLed(nOpen); renderCastBar();   // LED y «N dispositivos conectados», al segundo
    if ($('lv-closeall')) $('lv-closeall').hidden = nOpen < 2;
    if ($('lv-standby')) {
      const on = standbyOn();
      $('lv-standby-on').classList.toggle('on', on);
      $('lv-standby-t').textContent = tx(on ? 'Quitar Standby en Confidence' : 'Standby en Confidence');
    }
    renderGestor();
    meteoTick();
    if (!FEST) { audioTick(null); return; }   // sin evento: nada que vigilar (y la cola sigue con los urgentes)
    logFoto();
    const mNow = Math.floor(C.nowAbs(d));
    if (LAST_MIN !== null && mNow !== LAST_MIN) { compute(); if (LIVE.some(b => b.alargar && b.rf === null)) renderTable(); }   // el estimado en directo (Alargar)
    LAST_MIN = mNow;
    const mst = renderMeteo();
    const nowMins = C.nowAbs(d), nowInt = Math.floor(nowMins);
    stampCallOks();   // dec. 150: OK sin sello → se sella con su hora efectiva
    renderLive(nowMins, nowInt);
    const cmins = Dt.callMinsOf(FEST, CONFIG);
    audioTick(C.callList(LIVE, nowInt, cmins, new Set(Dt.getCallDone())).map(b => ({ key: C.callKey(b), label: b.name, at: C.callAt(b, cmins) })),   // misma ventana CALL que la tarjeta
      LIVE.filter(b => xtraOver(b, nowInt) !== null).map(b => ({ key: b.key, label: b.name })),                                            // Tiempo extra pasado de su fin previsto
      mst && mst.c.on ? mst.pending.map(a => ({ key: a.kind, label: a.text })) : []);                                                       // avisos meteo pendientes (sin «Visto»)
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
      callEditFix(FEST, rz.state, id, rmode, 'zona');   // el OK de CALL sigue con la banda (dec. 148)
      commitFestival(rz.state, [z.id ? (z.created ? '{name}: zona → {zona} (zona nueva creada)' : '{name}: zona → {zona}') : '{name}: zona → sin zona', { name: nm, zona: z.id ? (z.created ? z.name : C.getEscenario(rz.state, z.id).nombre) : '' }]);
      if (then) { const t = document.querySelector('tr[data-id="' + CSS.escape(then.id) + '"] [data-k="' + then.k + '"]'); if (t) t.focus(); }
      return;
    }
    const r = C.editArtist(FEST, id, rmode, k, el.value);
    if (!r.ok && k === 'tipo') el.value = el.dataset.orig;
    if (!r.ok) { el.classList.add('bad'); el.title = back(r.error); toast(r.error, true); return; }
    el.classList.remove('bad'); el.title = '';
    if (!r.changed) { el.value = el.dataset.orig; return; }
    const name = (r.state.artists.find(a => String(a.id) === String(id)) || {}).nombre || '';
    el.dataset.orig = el.value;      // evita aplicarlo dos veces (Intro + salir de la casilla)
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbody, #tbody-sin')) document.activeElement.blur();
    let shown = r.value || '—', trv = false;
    if (k === 'jornada') shown = fmtDay(r.value);
    else if (k === 'escenario') { const e = C.getEscenario(r.state, r.value); shown = e ? e.nombre : 'sin zona'; trv = !e; }
    else if (k === 'tipo') { shown = TIPO_TXT[r.value]; trv = true; }
    callEditFix(FEST, r.state, id, rmode, k);   // dec. 148: CALL reprogramado a mano → vuelve a avisar; otro campo → el OK sigue
    const fuera = k === 'tipo' && CONFIG.mode !== 'all' && (C.isKindMode(CONFIG.mode) ? r.value !== CONFIG.mode : r.value !== 'banda');
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
    tb.addEventListener('input', e => {   // el detalle de Zona, Nombre y Notas sigue a lo que se escribe (dec. 122; v20261169)
      if (!e.target.dataset || ['zona', 'nombre', 'notas'].indexOf(e.target.dataset.k) < 0) return;
      const td = e.target.closest('td'), tip = td && td.querySelector('.ntip');
      if (tip) { tip.textContent = e.target.value; tip.hidden = !e.target.value; }
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
      if (!r.ok) { $('d-err').textContent = back(r.error); return false; }
      const jor = $('d-jor').value;
      commitFestival(r.state, [CONFIG.day !== 'all' && CONFIG.day !== jor ? 'Duplicada: {n} en {d} (no es la jornada que estás viendo)' : 'Duplicada: {n} en {d}', { n: a.nombre, d: fmtDay(jor) }]);
    } }]);
    $('d-jor').focus();
  }

  // Aviso de fin de jornada: propone pasar a la siguiente, pero el cambio lo hace el regidor.
  let daybarKey = '';
  function renderDaybar(nowInt) {
    const r = FEST ? C.nextJornadaAfter(FEST, C.engineMode(CONFIG.mode), CONFIG.day, nowInt) : null;   // la jornada acaba cuando acaba TODO, no solo las tareas
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
    callOk(b.dataset.ck, 'Stage Manager', 'panel');   // dec. 150: OK para su hora efectiva (clave + sello)
    tick();
  });

  // ── Festival: nuevo y datos generales ────────────────────────────────
  function festForm(ev) {
    ev = ev || {};
    // Dos tarjetas (dec. 111): Datos generales · Tiempos de escenario (con sus notas dentro). Los id no cambian.
    return '<div class="mcard"><div class="mcard-h">' + tx('Datos generales') + '</div><div class="form">' +
      // Evento sin nombre: la casilla sale vacía con «Evento sin nombre» de fondo (en el idioma activo), no con el texto guardado
      '<label for="f-nombre">' + tx('Nombre') + '</label><input id="f-nombre" type="text" value="' + esc(C.isUnnamed(ev.nombre) ? '' : ev.nombre) + '"' + (ev.nombre && C.isUnnamed(ev.nombre) ? ' placeholder="' + esc(tx('Evento sin nombre')) + '"' : '') + ' autocomplete="off">' +
      '<label for="f-ini">' + tx('Primera jornada') + '</label><input id="f-ini" type="date" value="' + esc(ev.fechaInicio || '') + '">' +
      '<label for="f-fin">' + tx('Última jornada') + '</label><input id="f-fin" type="date" value="' + esc(ev.fechaFin || '') + '">' +
      '<label for="f-cut">' + tx('Hora de corte') + '</label><input id="f-cut" type="text" value="' + esc(ev.dayCutoff || C.DEFAULT_CUTOFF) + '" style="width:90px">' +
      '<div class="note">' + tx('Lo que empieza antes de esta hora cuenta como la jornada anterior (un DJ a las 02:00 del sábado es del viernes).') + '</div>' +
      '</div></div><div class="mcard"><div class="mcard-h">' + tx('Tiempos de escenario') + '</div><div class="form">' +
      '<label for="f-call">' + tx('Aviso CALL') + '</label><div><input id="f-call" type="number" min="1" max="180" value="' + esc(ev.callMins || C.DEFAULT_CALL_MINS) + '" style="width:90px"> ' + tx('min antes del inicio') + '</div>' +
      '<div class="note">' + tx('Se usa cuando una banda no tiene hora de CALL escrita.') + '</div>' +
      '<label for="f-comin">' + tx('Changeover mínimo') + '</label><div><input id="f-comin" type="number" min="0" max="180" value="' + esc(ev.coMin == null ? C.DEFAULT_CO_MIN : ev.coMin) + '" style="width:90px"> min</div>' +
      '<div class="note">' + tx('Lo mínimo para cambiar de banda. Con retraso, lo que sobra del cambio por encima de este mínimo es el colchón. Se puede personalizar por zona.') + '</div>' +
      '</div></div><div id="f-err" class="err" style="margin:0"></div>';
  }
  function readFestForm() {
    const n = String($('f-nombre').value || '').trim();   // vacío en un evento sin nombre: sigue sin nombre (se guarda el texto de siempre)
    return { nombre: n || (FEST && C.isUnnamed(FEST.event && FEST.event.nombre) && $('f-nombre').placeholder ? C.UNNAMED : ''), fechaInicio: $('f-ini').value, fechaFin: $('f-fin').value || $('f-ini').value, dayCutoff: $('f-cut').value, callMins: $('f-call').value, coMin: $('f-comin').value };
  }

  function askNew() {
    const d = FEST && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    let html = festForm({});
    if (d.total) html += '<div class="warnbox" style="margin-top:12px">' + tx('El evento actual tiene {n} cambio(s) sin exportar y se sustituirá. Exporta antes si los quieres guardar.', { n: d.total }) + '</div>';
    else if (FEST) html += '<p style="margin-top:12px">' + tx('El evento actual («{name}») se sustituirá. Está guardado si lo exportaste.', { name: esc(C.eventName(FEST, tx)) }) + '</p>';
    const acts = [{ label: 'Cancelar' }];
    if (d.total) acts.push({ label: 'Exportar el actual', run: () => { exportJSON(); setTimeout(askNew, 300); } });
    acts.push({ label: 'Crear evento', kind: 'primary', run: () => {
      const r = C.newFestival(readFestForm());
      if (!r.ok) { $('f-err').textContent = back(r.error); return false; }
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
      if (s) s.open = true;   // secciones plegables (dec. 131): la que se pide se abre
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
        box.innerHTML = festForm(FEST.event) + '<div class="row end" style="margin-top:12px"><button id="f-save" class="btn primary">' + tx('Guardar datos del evento') + '</button></div>' + logoHtml();
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
    fillMsgCfg(); fillAudioCfg();
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
    renderCfSim();
  }
  // ── Simulador del monitor Confidence: el estado elegido con los umbrales, el parpadeo y los colores de ESTOS ajustes ──
  let CFSIM = 'ok';
  const mmss = m => { const s = Math.max(0, Math.round(m * 60)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function cfSimState(st, sc, msg) {
    const c = sc.conf, w = Math.max(0, c.showWarn), d = Math.max(0, Math.min(c.showDanger, w));
    // Cifras de ejemplo dentro de cada tramo de ESTOS umbrales (ámbar a falta de w min, rojo a falta de d min)
    const ok = w + 12, warn = d < w ? (w + d) / 2 : w, danger = d > 0 ? Math.max(0.5, d - 1.5) : 0.5;
    const s = { ok: { t: mmss(ok), f: 0.75 }, warn: { t: mmss(warn), f: Math.max(0.08, warn / ok * 0.75) }, danger: { t: mmss(danger), f: Math.max(0.04, danger / ok * 0.75) }, over: { t: '-02:15', f: 1 }, flash: { t: mmss(ok), f: 0.75 } }[st] || {};
    return Object.assign(s, { cls: 'cfsim lv-' + (st === 'flash' ? 'ok' : st) + (st === 'over' && c.blink ? ' blink' : ''), flash: st === 'flash', msgBg: msg.bg, msgFg: msg.fg });
  }
  function renderCfSim() {
    const box = $('cfsim'); if (!box) return;
    const sc = CONFIG.screens || Vs.normScreens(), st = cfSimState(CFSIM, sc, { bg: CONFIG.msgBg, fg: CONFIG.msgFg });
    box.className = st.cls;
    box.style.setProperty('--ov-bg', sc.conf.overBg); box.style.setProperty('--ov-num', sc.conf.overNum); box.style.setProperty('--blink-speed', sc.conf.blinkSpeed + 's');
    box.style.setProperty('--mbg', st.msgBg); box.style.setProperty('--mfg', st.msgFg);
    $('cfsim-top').innerHTML = 'PRINCIPAL · <span class="k">SHOW</span> · ' + esc(tx('LA BANDA'));
    $('cfsim-t').textContent = st.t;
    $('cfsim-fill').style.width = Math.round(st.f * 100) + '%';
    const d = new Date(); $('cfsim-foot').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    $('cfsim-fl').hidden = !st.flash; $('cfsim-flt').textContent = tx('5 MINUTOS');
    document.querySelectorAll('[data-cfsim]').forEach(b => { const on = b.dataset.cfsim === CFSIM; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-cfsim]'); if (!b) return; CFSIM = b.dataset.cfsim; renderCfSim(); });
  function saveScreens(el) {
    const sc = JSON.parse(JSON.stringify(CONFIG.screens || Vs.normScreens()));
    const [g, k] = el.dataset.sc.split('.');
    const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.dataset.num !== undefined) ? Number(el.value) : el.value;
    if (k === 'all') { sc.ticker.delays = sc.ticker.hitos = sc.ticker.meteo = v; } else sc[g][k] = v;
    if (g === 'back' && !sc.back.cards && !sc.back.lines && !sc.back.ticker) { el.checked = true; toast('Backstage necesita al menos un bloque', true); return; }
    CONFIG = Dt.setConfig({ screens: sc }); fillScreensCfg();
  }
  document.querySelectorAll('#cfg-s-screens [data-sc]').forEach(el => el.addEventListener(el.type === 'color' || el.dataset.sc === 'conf.blinkSpeed' ? 'input' : 'change', () => {
    if (el.dataset.sc === 'conf.blinkSpeed' && !(Number(el.value) >= 0.1 && Number(el.value) <= 5)) return;   // mientras se escribe: solo cifras válidas
    saveScreens(el);
  }));
  function fillMsgCfg() {
    $('cfg-msg-bg').value = CONFIG.msgBg;
    $('cfg-msg-fg').value = CONFIG.msgFg;
    $('cfg-msg-secs').value = String(CONFIG.msgSecs);
    $('cfg-aviso-secs').value = String(CONFIG.avisoSecs);
    const pv = $('cfg-msg-prev');
    pv.style.setProperty('--mbg', CONFIG.msgBg); pv.style.setProperty('--mfg', CONFIG.msgFg);
    renderCfSim();   // el botón [Flash] del simulador usa estos colores
  }

  // ── Logo del evento (dec. 132): Configuración › Evento. Se reduce al subirlo y viaja en el .json y en la emisión ──
  function logoHtml() {
    const lg = C.eventLogo(FEST);
    return '<div class="logo-blk"><div class="fsub">' + tx('Logo del evento (reposo, Standby y hojas impresas)') + '</div><div class="logo-row">'
      + (lg ? '<span class="logo-th"><img id="f-logo-img" src="' + esc(lg) + '" alt="' + esc(tx('Logo del evento')) + '"></span>' : '')
      + '<label class="btn" for="f-logo"><svg class="ic"><use href="#i-folder"/></svg>' + tx(lg ? 'Cambiar imagen' : 'Subir imagen') + '</label>'
      + '<input id="f-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" hidden>'
      + (lg ? '<button type="button" class="btn ghost" data-act="logo-del"><svg class="ic"><use href="#i-x"/></svg>' + tx('Quitar') + '</button>' : '')
      + '</div><div class="note">' + tx('PNG, JPG, WebP o SVG. Se reduce a 480 × 240 px como máximo para que la emisión siga siendo ligera. Sin logo, el cartel de Showtime.') + '</div></div>';
  }
  /** Lee la imagen y la deja pequeña: SVG tal cual (si cabe); PNG/JPG/WebP reescalada a 480×240 como mucho (WebP, o PNG si el navegador no sabe). */
  function readLogo(file) {
    return new Promise((ok, ko) => {
      if (!file) return ko(new Error('Sin archivo'));
      const fr = new FileReader();
      fr.onerror = () => ko(new Error('No se pudo leer la imagen.'));
      fr.onload = () => {
        const url = String(fr.result || '');
        if (/^data:image\/svg\+xml;base64,/.test(url)) return ok(url);
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(url)) return ko(new Error('Formato no válido: PNG, JPG, WebP o SVG.'));
        const img = new Image();
        img.onerror = () => ko(new Error('No se pudo leer la imagen.'));
        img.onload = () => {
          const k = Math.min(1, 480 / img.naturalWidth, 240 / img.naturalHeight), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          let out = cv.toDataURL('image/webp', 0.86);
          if (!/^data:image\/webp/.test(out)) out = cv.toDataURL('image/png');   // navegador sin WebP: PNG
          if (out.length > C.LOGO_MAX) out = cv.toDataURL('image/webp', 0.7);
          ok(out);
        };
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }
  async function setLogo(file) {
    try {
      const url = file ? await readLogo(file) : '';
      const r = C.setEventLogo(FEST, url);
      if (!r.ok) { toast(r.error, true); return; }
      if (r.changed) commitFestival(r.state, url ? 'Logo del evento cargado' : 'Logo del evento quitado', { skip: true });
    } catch (e) { toast(e.message || 'No se pudo leer la imagen.', true); }
  }
  document.addEventListener('change', e => { if (e.target && e.target.id === 'f-logo') { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setLogo(f); } });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="logo-del"]')) setLogo(null); });
  function saveFest() {
    const r = C.updateEvent(FEST, readFestForm());
    if (!r.ok) { $('f-err').textContent = back(r.error); return; }
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
    if (!r.ok) { $('s-err').textContent = back(r.error); return; }
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
  function panelStyle() { try { return Dt.normStyle(JSON.parse(localStorage.getItem(PS_KEY) || '"studio"')); } catch (e) { return 'studio'; } }
  /** Studio es la base del CSS (:root): sin atributo. Stage es el único modificador: body[data-ps="stage"]. */
  function applyPanelStyle(v) {
    if (Dt.normStyle(v) === 'stage') document.body.setAttribute('data-ps', 'stage'); else document.body.removeAttribute('data-ps');
  }
  const STYLE_TXT = { studio: 'Studio', stage: 'Stage' };
  $('cfg-style-panel').addEventListener('change', e => {
    try { localStorage.setItem(PS_KEY, JSON.stringify(e.target.value)); } catch (err) {}
    applyPanelStyle(e.target.value);
    toast(tx('Estilo del Dashboard: {s}', { s: STYLE_TXT[Dt.normStyle(e.target.value)] }));
  });
  // Ventana de Bis / Extender prueba (5 · 10 · 15 min): viaja con la configuración al Mando
  $('cfg-bis-win').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ bisWindow: Number(e.target.value) });
    toast(i18t('bis.cfgToast', { n: CONFIG.bisWindow }));
    tick();
  });
  $('cfg-style-live').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ style: e.target.value });
    toast(tx('Estilo de la Pantalla Live: {s}', { s: STYLE_TXT[Dt.normStyle(e.target.value)] }));
  });
  applyPanelStyle(panelStyle());

  // ── Idioma (i18n): lo manda este Panel. Va en CONFIG.lang (guardada en este navegador) y viaja con la emisión,
  //    así que las pantallas Live y el Mando lo siguen solos. Las hojas impresas salen en el idioma activo. ──
  function paintLang() {
    const I = window.ShowtimeI18n; if (!I) return;
    const L = I.getLang(), b = $('btn-lang');
    if (b) { b.textContent = I.t('lang.short'); b.title = I.t('lang.btnTitle'); b.setAttribute('aria-label', I.t('lang.btnTitle')); }
    document.querySelectorAll('#cfg-lang [data-l]').forEach(x => { const on = x.dataset.l === L; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    try { dwAria(); } catch (e) {}   // tiradores y ↶ del Dashboard en el idioma nuevo (también sin evento cargado)
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
  const MENUS = Array.from(document.querySelectorAll('.menus .menu, #m-hub'));
  function setMenu(m, on) { m.classList.toggle('open', on); m.querySelector('.mbtn').setAttribute('aria-expanded', String(on)); }
  function closeMenus(except) { MENUS.forEach(m => { if (m !== except) setMenu(m, false); }); }
  MENUS.forEach(m => {
    let tOpen = 0, tClose = 0;
    m.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tClose); tOpen = setTimeout(() => { closeMenus(m); setMenu(m, true); }, 120); });
    m.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tOpen); tClose = setTimeout(() => setMenu(m, false), 350); });
    m.querySelector('.mbtn').addEventListener('click', () => {
      clearTimeout(tOpen); const on = !m.classList.contains('open'); closeMenus(m); setMenu(m, on);
    });
    // Las acciones cierran el menú (los toggles de Retrasos no: se marcan varios seguidos)
    m.querySelectorAll('.mitem').forEach(it => it.addEventListener('click', () => setMenu(m, false)));
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.menus, #m-hub')) closeMenus(); if (!e.target.closest('.more')) document.querySelectorAll('.more.open').forEach(x => x.classList.remove('open')); });
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
  /** Centro de Pantallas y Emisión (dec. 109): selector de zona para abrir Confidence (lo abierto se ve en el gestor). */
  function renderLiveMenu() {
    const sel = $('lv-zone'); if (!sel) return;
    const zs = FEST ? zonasLive() : [];
    const h = zs.length ? zs.map(z => '<option value="' + esc(z.id) + '">' + esc(z.name) + '</option>').join('') : '<option value="">' + tx('Sin zonas') + '</option>';
    if (sel.dataset.h !== h) { const keep = sel.value; sel.innerHTML = h; sel.dataset.h = h; if (zs.some(z => z.id === keep)) sel.value = keep; }
    sel.disabled = !zs.length;
    if ($('lv-conf')) $('lv-conf').disabled = !FEST;
  }
  /** LED del botón maestro: VERDE si hay emisión o alguna Live abierta; GRIS si no. Nunca rojo (el rojo es para alertas). */
  function renderHubLed(nOpen) {
    const led = $('hub-led'); if (!led) return;
    const n = nOpen === undefined ? openIds().length : nOpen, on = !!EM || n > 0;
    led.classList.toggle('on', on);
    if ($('htab-led')) $('htab-led').classList.toggle('on', !!EM);   // pestaña Emisión y QR: verde si se está emitiendo
    const parts = [];
    if (EM) parts.push(tx('Emitiendo por QR'));
    parts.push(n ? (n === 1 ? tx('1 Pantalla Live abierta') : tx('{n} Pantallas Live abiertas', { n: n })) : tx('Ninguna Pantalla Live abierta'));
    $('btn-hub').title = tx('Pantallas Live del Mac y emisión a dispositivos por QR') + ' · ' + parts.join(' · ');
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
  /** Filas fijas de UNA ventana Manager desde el gestor (dec. 133): 'auto' o 2–6. La ventana lo guarda en su URL y lo devuelve en su latido. */
  function setWinRows(id, v) {
    const x = WIN.get(id); if (!x || !liveOpen(id)) return;
    x.filas = Vs.normRows(v);
    try { x.w.postMessage({ app: 'showtime', type: 'setRows', filas: x.filas }, '*'); } catch (e) {}
    tick();
  }
  /** ↺ Restablecer UNA ventana (dec. 135): anchos, alturas, filas y zoom de fábrica. */
  function resetWinLayout(id) {
    const x = WIN.get(id); if (!x || !liveOpen(id)) return;
    x.filas = null;
    try { x.w.postMessage({ app: 'showtime', type: 'resetLayout' }, '*'); } catch (e) {}
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
  function gestorVisible() { return !$('modal').hidden && $('modal-title').textContent === tx('Pantallas y ventanas'); }
  function openGestor() { gvSig = null; modal('Pantallas y ventanas', '<div id="gv"></div>', [], { wide: true }); renderGestor(); }
  function gvRowHtml(id) {
    const x = WIN.get(id);
    return '<div class="gv-row" data-id="' + esc(id) + '">' +
      '<input class="gv-name" type="text" maxlength="40" value="' + esc(x.name) + '" aria-label="' + tx('Nombre de la ventana') + '">' +
      '<select class="gv-vista" aria-label="' + tx('Vista') + '">' + VISTA_OPCIONES.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>' +
      '<select class="gv-zona" aria-label="' + tx('Zona') + '"></select>' +
      '<span class="gv-fs" aria-live="polite"></span>' +
      '<button class="gv-sb" type="button" data-gv="standby" aria-pressed="false"><i class="gv-led" aria-hidden="true"></i><span>Standby</span></button>' +
      '<button class="gv-x gv-rst" type="button" data-gv="reset-one" title="' + esc(tx('Reset: anchos, alturas y zoom de fábrica para esta ventana')) + '" aria-label="' + esc(tx('Restablecer esta ventana')) + '"><svg class="ic"><use href="#i-undo"/></svg></button>' +
      '<button class="gv-x" type="button" data-gv="close" title="' + tx('Cerrar esta ventana') + '" aria-label="' + tx('Cerrar esta ventana') + '"><svg class="ic"><use href="#i-x"/></svg></button>' +
      '</div>';
  }
  /** Pone en cada fila lo que dice la ventana. No toca el nombre si lo estás escribiendo. */
  function gvSync(ids) {
    const box = $('gv'); if (!box) return;
    // Cabecera de la 3ª columna según lo que haya abierto: solo Manager → Filas · solo Confidence → Zona · mezcla (o ninguna) → Zona / Filas
    const hz = box.querySelector('.gv-hz');
    if (hz) { const vs = ids.map(id => (WIN.get(id) || {}).vista), m = vs.indexOf('manager') >= 0, c = vs.indexOf('confidence') >= 0; hz.textContent = tx(m && !c ? 'Filas' : c && !m ? 'Zona' : 'Zona / Filas'); }
    ids.forEach(id => {
      const x = WIN.get(id), row = Array.from(box.querySelectorAll('.gv-row')).find(r => r.dataset.id === id); if (!x || !row) return;
      const name = row.querySelector('.gv-name'), vs = row.querySelector('.gv-vista'), zs = row.querySelector('.gv-zona'), sb = row.querySelector('.gv-sb');
      if (name && document.activeElement !== name && name.value !== x.name) name.value = x.name;
      // dec. 143: los desplegables que estás usando no se tocan (el reloj repinta cada segundo y cerraba / pisaba la elección)
      if (vs && document.activeElement !== vs && vs.value !== x.vista) vs.value = x.vista;
      if (zs) {   // 3ª columna (dec. 133): Confidence → zona · Manager → filas de esa ventana · Backstage → «—» deshabilitado (la rejilla no cambia)
        const conf = x.vista === 'confidence', mgr = x.vista === 'manager';
        const want = conf ? zonasLive().map(z => '<option value="' + esc(z.id) + '">' + esc(z.name) + '</option>').join('')
          : mgr ? Vs.MGR_ROWS.map(r => '<option value="' + r + '">' + esc(tx(Vs.MGR_ROWS_TXT[r])) + '</option>').join('') : '<option value="">—</option>';
        if (zs.dataset.h !== want) { zs.innerHTML = want; zs.dataset.h = want; }
        zs.disabled = !conf && !mgr;
        const al = tx(mgr ? 'Filas' : 'Zona'); if (zs.getAttribute('aria-label') !== al) zs.setAttribute('aria-label', al);
        if (document.activeElement !== zs) {
          const z = conf ? (x.zona != null ? x.zona : '') : mgr ? String(x.filas || 'auto') : '';
          if (zs.value !== z) zs.value = z;
        }
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
      const head = '<div class="gv-top"><div class="gv-seg"><button type="button" class="gv-segb" data-gv="all" data-on="1">' + tx('⏸ Todas en standby') + '</button><button type="button" class="gv-segb" data-gv="all" data-on="0">' + tx('▶ Reanudar todas') + '</button><button type="button" class="gv-segb" data-gv="reset" title="' + esc(tx('Anchos, alturas, filas y zoom de fábrica en todas las ventanas Live abiertas')) + '">' + tx('↺ Reset') + '</button></div></div>';
      const hd = '<div class="gv-row gv-hd" aria-hidden="true"><span>' + tx('Nombre') + '</span><span>' + tx('Vista') + '</span><span class="gv-hz">' + tx('Zona / Filas') + '</span><span>' + tx('Pantalla') + '</span><span>' + tx('Standby') + '</span><span></span><span></span></div>';
      const rows = ids.length ? hd + ids.map(gvRowHtml).join('') : '<p class="mnote gv-empty">' + tx('No hay ventanas Live abiertas desde este Dashboard.') + '</p>';
      // Mismo acabado que el panel de Pantallas y Emisión: cabecera en gris pizarra y cada bloque en su tarjeta
      const loc = '<div class="gv-sec"><svg class="ic"><use href="#i-screen"/></svg><b>' + tx('Monitores locales (HDMI / Mac)') + '</b></div>';
      const qr = '<div class="gv-qr"><div class="gv-sec"><svg class="ic"><use href="#i-cast"/></svg><b>' + tx('Dispositivos remotos por QR (en vivo)') + '</b><span id="gv-qrn" class="gv-qrn"></span></div><div class="gv-card"><div id="gv-qrl" class="gv-qrl"></div></div></div>';
      const foot = '<div class="gv-foot"><button type="button" class="btn" data-gv="new">' + tx('+ Abrir ventana Live') + '</button><button type="button" class="btn gv-close" data-gv="done">' + tx('Cerrar') + '</button></div>';
      box.innerHTML = loc + '<div class="gv-card">' + head + '<div class="gv-list">' + rows + '</div></div>' + qr + foot;
    }
    gvSync(ids);
    renderGestorQr();
  }
  // ── Telemetría (dec. 103): los dispositivos abiertos por QR se presentan cada 20 s; sin latido en 45 s, fuera de la lista ──
  const DEV_TXT = { movil: 'Móvil', tablet: 'Tablet', ordenador: 'Ordenador' };
  function qrDevices(now) {
    const n = now === undefined ? Date.now() : now;
    return EM && EMST && Array.isArray(EMST.devices) ? EMST.devices.filter(d => n - d.t <= Em.VIEWER_TTL) : [];
  }
  function devLabel(d) {
    if (d.r) return tx('Stage Manager · mando') + ' · ' + (d.s ? zoneLabel(d.s) : tx('todas las zonas'));
    if (d.p) return tx('Producción') + ' · ' + prodName(d.p);
    const v = d.v && Vs.VISTA_TXT[d.v] ? Vs.VISTA_TXT[d.v] : tx('Pantalla Live');
    return v + (d.v === 'confidence' ? ' · ' + (d.z !== null && d.z !== undefined ? zoneLabel(d.z) : tx('sin zona elegida')) : '');
  }
  function agoTxt(s) { return s < 60 ? tx('hace {n} s', { n: s }) : tx('hace {n} min', { n: Math.floor(s / 60) }); }
  const DEV_ORDER = { mando: 0, manager: 1, confidence: 2, backstage: 3 };
  function renderGestorQr() {
    const box = $('gv-qrl'); if (!box) return;
    const now = Date.now(), list = qrDevices(now).slice().sort((a, b) => ((DEV_ORDER[a.r ? 'mando' : a.v] ?? 9) - (DEV_ORDER[b.r ? 'mando' : b.v] ?? 9)) || (a.first - b.first));
    const h = !EM ? '<p class="mnote">' + tx('La emisión está parada: Pantallas y Emisión ▾ › Empezar a emitir.') + '</p>'
      : !list.length ? '<p class="mnote">' + tx('Ningún dispositivo conectado por QR.') + '</p>'
      : list.map(d => {
        const s = Math.max(0, Math.round((now - d.t) / 1000));
        return '<div class="gq-row' + (d.r ? ' gq-sm' : '') + '" data-dev="' + esc(d.id) + '"><i class="gq-dot' + (s > PRESENCE_LATE ? ' late' : '') + '" aria-hidden="true"></i>'
          + '<span class="gq-v">' + esc(devLabel(d)) + '</span><span class="gq-d">' + esc(tx(DEV_TXT[d.d] || 'Dispositivo')) + ' <small>#' + esc(String(d.id).slice(0, 4)) + '</small></span>'
          + '<span class="gq-ago">' + agoTxt(s) + '</span></div>';
      }).join('');
    if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
    const n = $('gv-qrn'); if (n) n.textContent = EM && list.length ? tx(list.length === 1 ? '1 conectado' : '{n} conectados', { n: list.length }) : '';
  }
  const PRESENCE_LATE = 25;   // s sin latido: punto ámbar (un latido perdido); a los 45 s sale de la lista
  $('modal-body').addEventListener('change', e => {
    const t = e.target, row = t.closest && t.closest('.gv-row'); if (!row) return;
    const id = row.dataset.id, x = WIN.get(id); if (!x) return;
    if (t.classList.contains('gv-name')) {
      const n = String(t.value).replace(/\s+/g, ' ').trim().slice(0, 40) || x.name;
      x.name = n; t.value = n; saveWinName(id, n); return;
    }
    // 3ª columna (dec. 133): en Confidence es la zona; en Manager, las filas de esa ventana
    if (t.classList.contains('gv-zona') && x.vista === 'manager') { setWinRows(id, t.value); const filas = Vs.normRows(t.value); toast(filas ? tx('Pantalla Live: {n} filas fijas', { n: filas }) : tx('Pantalla Live: filas automáticas')); return; }
    if (t.classList.contains('gv-vista')) { const v = Vs.normVista(t.value); setWinVista(id, v, v === 'confidence' ? (x.zona != null ? x.zona : ((zonasLive()[0] || {}).id || '')) : null); return; }
    if (t.classList.contains('gv-zona')) setWinVista(id, x.vista, t.value);
  });
  $('modal-body').addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-gv]'); if (!b) return;
    if (b.dataset.gv === 'all') { openIds().forEach(id => setWinStandby(id, b.dataset.on === '1')); return; }
    if (b.dataset.gv === 'reset') { openIds().forEach(id => resetWinLayout(id)); toast('Pantallas Live restablecidas: anchos, alturas, filas y zoom de fábrica'); return; }
    if (b.dataset.gv === 'new') { openLive('manager', null); return; }
    if (b.dataset.gv === 'done') { closeModal(); return; }
    const row = b.closest('.gv-row'); if (!row) return;
    const id = row.dataset.id;
    if (b.dataset.gv === 'standby') setWinStandby(id, !(WIN.get(id) && WIN.get(id).standby));
    if (b.dataset.gv === 'close') closeLive(id);
    if (b.dataset.gv === 'reset-one') { resetWinLayout(id); toast('Pantalla Live restablecida: valores de fábrica'); }   // dec. 137: solo esta ventana
  });
  document.addEventListener('click', e => {
    if (e.target.closest('#lv-standby')) { e.preventDefault(); e.stopPropagation(); closeMenus(); setStandby(!standbyOn()); return; }
    if (e.target.closest('#lv-gestor')) { e.preventDefault(); e.stopPropagation(); closeMenus(); openGestor(); return; }
    if (e.target.closest('#lv-closeall')) { closeLive(null); return; }
    const it = e.target.closest('#m-hub [data-vista]'); if (!it) return;
    // Toda la fila abre (dec. 126), salvo el desplegable de zona y una fila con su botón apagado (Confidence sin evento)
    if (e.target.closest('select')) return;
    if (it.querySelector && it.querySelector('button:disabled')) return;
    closeMenus();
    openLive(it.dataset.vista, it.dataset.vista === 'confidence' ? (it.dataset.zona !== undefined ? it.dataset.zona : ($('lv-zone') ? $('lv-zone').value : '')) : null);
  }, true);
  // Cada Live dice qué vista muestra, si está en standby y qué zona (al abrirse, al cambiar con la V y en el latido)
  window.addEventListener('message', e => {
    const m = e.data; if (!m || m.app !== 'showtime' || m.type !== 'vistaState') return;
    for (const x of WIN.values()) if (x.w === e.source) { x.vista = String(m.vista || x.vista || ''); x.zona = m.zona == null ? null : String(m.zona); x.filas = Vs.normRows(m.filas); x.standby = !!m.standby; x.fs = !!m.fs; }
    tick();
  });
  // Las ventanas que se abrieron antes de recargar el Dashboard se vuelven a presentar solas: se recuperan con su nombre.
  let peerN = 0;
  /** Live abierta ANTES de actualizar Showtime (código viejo en memoria): se recarga sola con la versión nueva (dec. 116b).
   *  Una Live vieja no entiende los ajustes nuevos y podía devolverlos «arreglados» (Ver: Tareas → Shows). Misma carpeta = mismo
   *  origen: el Dashboard ve su versión. La recarga tarda ~1 s y conserva vista y zona (van en la URL y en el nombre). */
  const STALE = typeof WeakSet === 'function' ? new WeakSet() : null;   // una sola recarga por ventana: si aun así sigue vieja, no se insiste (sin bucles en un monitor)
  function refreshStale(w) {
    try {
      const b = w && w.ShowtimeEmision && w.ShowtimeEmision.BUILD;
      if (!b || !Em || b === Em.BUILD || !STALE || STALE.has(w)) return false;
      STALE.add(w);
      w.location.reload();
      logEvent('msg', 'Pantalla Live actualizada a la versión ' + Em.BUILD + ' (tenía la ' + b + ')', { src: 'panel' });
      toast(tx('Pantalla Live actualizada a la versión nueva'));
      return true;
    } catch (e) { return false; }   // otro origen (doble clic en Firefox): no se puede tocar
  }
  if (Dt.onPeer) Dt.onPeer((w, m) => {
    if (refreshStale(w)) return;   // vuelve a presentarse sola en cuanto cargue la versión nueva
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
      modal('No se puede abrir', '<div class="errbox">' + r.errors.map(e => esc(back(e))).join('<br>') + '</div><p style="margin-top:10px">' + tx('Archivo: {f}', { f: esc(fname) }) + '</p>', [{ label: 'Cerrar' }]);
      return;
    }
    const s = r.state, ev = s.event || {};
    // Sin evento abierto y archivo limpio: se abre directamente (no hay nada que perder ni que avisar)
    if (!FEST && !r.warnings.length) { loadNew(s, tx('Evento abierto: {name}', { name: ev.nombre ? C.eventName(s, tx) : fname })); return; }
    const dShow = C.festivalDays(s, 'show'), dSc = C.festivalDays(s, 'sc');
    const nT = s.artists.filter(a => C.tipoOf(a) === 'tarea').length, nH = s.artists.filter(a => C.tipoOf(a) === 'hito').length;
    let html = '<p>' + tx('Archivo: <b>{f}</b>', { f: esc(fname) }) + '</p><ul>' +
      '<li>' + tx('Evento: <b>{name}</b>', { name: esc(C.eventName(s, tx)) }) + '</li>' +
      '<li>' + tx('{n} bandas', { n: s.artists.length - nT - nH }) + ' · ' + (nT ? tx('{n} tareas', { n: nT }) + ' · ' : '') + (nH ? tx('{n} marcadores', { n: nH }) + ' · ' : '') + tx('{n} zonas', { n: s.escenarios.length }) + '</li>' +
      '<li>Shows: ' + (dShow.length ? dShow.map(fmtDay).map(esc).join(', ') : tx('ninguno')) + '</li>' +
      '<li>Soundchecks: ' + (dSc.length ? dSc.map(fmtDay).map(esc).join(', ') : tx('ninguno')) + '</li>' +
      '<li>' + tx('Hora de corte: {cut} · aviso CALL: {n} min', { cut: esc(ev.dayCutoff || C.DEFAULT_CUTOFF), n: esc(ev.callMins || C.DEFAULT_CALL_MINS) }) + '</li></ul>';
    if (r.warnings.length) html += '<p style="margin-top:10px"><b>' + tx('Avisos del archivo:') + '</b></p><ul>' + r.warnings.slice(0, 12).map(w => '<li>' + esc(back(w)) + '</li>').join('') + (r.warnings.length > 12 ? '<li>' + tx('… y {n} más', { n: r.warnings.length - 12 }) + '</li>' : '') + '</ul>';
    html += '<p style="margin-top:10px">' + tx('Al abrirlo, la jornada queda en <b>Todas</b>: elige la que quieras arriba.') + '</p>';
    const n = FEST && ORIG ? C.diffSummary(ORIG, FEST).total : 0;
    const acts = [{ label: 'Cancelar' }];
    if (n) {
      html += '<div class="warnbox">' + (n === 1 ? tx('Tienes 1 cambio sin exportar que se perderá. Exporta antes si lo quieres guardar.') : tx('Tienes {n} cambios sin exportar que se perderán. Exporta antes si los quieres guardar.', { n })) + '</div>';
      acts.push({ label: 'Exportar los cambios', run: () => { exportJSON(); setTimeout(() => askImport(text, fname), 300); } });
      acts.push({ label: 'Abrir y perder cambios', kind: 'danger', run: () => loadNew(s, tx('Evento abierto: {name}', { name: C.eventName(s, tx) })) });
    } else acts.push({ label: 'Abrir evento', kind: 'primary', run: () => loadNew(s, tx('Evento abierto: {name}', { name: C.eventName(s, tx) })) });
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
    audioRearm(); mtRearm();   // abrir / crear / demo: la primera lectura del evento nuevo no suena (dec. 146) ni marca «!» (dec. 152)
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
      '<div class="mcard"><div class="mcard-h">' + tx('Formato y ámbito') + '</div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Formato') + '</span><div class="dtog radio" id="pr-fmt"><button type="button" class="' + (PR.fmt === 'tabla' ? 'on' : '') + '" data-f="tabla">' + tx('Tabla') + '</button><button type="button" class="' + (PR.fmt === 'gantt' ? 'on' : '') + '" data-f="gantt" title="' + tx('Cronograma de escenarios en horizontal') + '">' + tx('Cronograma') + '</button></div></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Jornada') + '</span><select id="pr-day">' + days.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + '</option>').join('') + (days.length > 1 ? '<option value="all">' + tx('Todas · 1 hoja por día') + '</option>' : '') + '</select></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Zona') + '</span><select id="pr-zone"><option value="all">' + tx('Todas las zonas') + '</option>' + stages.map(z => '<option value="' + esc(z.id) + '">' + esc(z.nombre) + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div class="mcard"><div class="mcard-h">' + tx('Contenido') + '</div>' +
      '<div class="dw-row top"><span class="dw-l">' + tx('Incluir') + '</span><div class="pr-kinds" id="pr-kinds">' +
        P.KINDS.map(k => '<label class="pr-ck"><input type="checkbox" data-k="' + k.k + '"> ' + esc(tx(k.label)) + '</label>').join('') +
        '<span class="pr-q"><button type="button" data-q="all">' + tx('Todos') + '</button><button type="button" data-q="show">' + tx('Solo Shows') + '</button></span></div></div>' +
      '</div>' +
      '<div class="mcard"><div class="mcard-h">' + tx('Opciones de salida') + '</div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Orientación') + '</span><select id="pr-orient"' + (PR.fmt === 'gantt' ? ' disabled title="' + tx('El cronograma es siempre horizontal') + '"' : '') + '><option value="portrait">' + tx('Vertical') + '</option><option value="landscape">' + tx('Horizontal') + '</option></select></div>' +
      '<div class="dw-row"><span class="dw-l">' + tx('Columnas') + '</span><label class="pr-ck"><input type="checkbox" id="pr-call"' + (PR.fmt === 'gantt' ? ' disabled' : '') + '> ' + tx('Incluir hora de CALL') + '</label><label class="pr-ck"><input type="checkbox" id="pr-notes"' + (PR.fmt === 'gantt' ? ' disabled' : '') + '> ' + tx('Incluir notas operativas') + '</label></div>' +
      '</div>' +
      '<div id="pr-sum" class="lx-sum"></div></div>';
    modal('Hoja de ruta', html, [{ label: 'Cancelar' }, { label: 'Imprimir / Guardar PDF', kind: 'primary', run: () => {
      const rows = P.rowsOf(FEST, { day: PR.day, zone: PR.zone, kinds: prKinds() });
      if (!rows.length) { toast('No hay bloques con estos filtros', true); return false; }
      const dl = PR.day === 'all' ? days : [PR.day];
      const doc = P.html({ rows, days: dl, title: C.eventName(FEST, tx), logo: C.eventLogo(FEST), format: PR.fmt, orient: PR.fmt === 'gantt' ? 'landscape' : PR.orient, notes: PR.notes, call: PR.call, now: new Date(), full: prKinds().length === 4 });   // idioma: el activo de Showtime
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

  // ── v20261169 · Dashboard: ancho de Zona, Nombre y Notas SOLO para esta sesión (memoria; ni localStorage ni datos del evento) ──
  // Cada una tiene su tirador fino. Ratón: clic limpio abre − / +; cualquier movimiento horizontal arrastra. Dedo o lápiz: hasta
  // DW_TOQUE px de temblor horizontal es toque limpio (abre al soltar); más es arrastre (no abre); un gesto claramente vertical no hace
  // nada. No se usa el «click» del navegador: se decide en pointerup, una sola vez. Gesto cancelado: no abre; si ya arrastraba, se
  // queda el último ancho válido. ↶ de cada columna: solo si ESA cambió; la devuelve a su ancho inicial y desaparece.
  const DCOLS = [{ k: 'zona', l: 'Zona' }, { k: 'nombre', l: 'Nombre' }, { k: 'notas', l: 'Notas' }];
  const DW = { zona: null, nombre: null, notas: null };   // px (borde a borde de la cabecera) o null = ancho inicial
  const DW_PASO = 16, DW_TOQUE = 6;   // − / + de 16 px (como el importador); 6 px de temblor (decisión de L.A.)
  let DW_FRZ = false, DW_G = null;   // DW_G: gesto en curso sobre un tirador
  const DW0 = {};   // ancho de Zona, Nombre y Notas al congelar: al que vuelve cada ↶ mientras otra sigue con ancho propio
  const DWCTL = { g: null, k: '', pos: '' };
  const dwTh = k => document.querySelector('#tbl thead th[data-dwk="' + k + '"]');
  const dwLbl = k => { const c = DCOLS.find(x => x.k === k); return c ? tx(c.l) : ''; };
  const dwAny = () => DCOLS.some(c => DW[c.k] != null);
  function dwNow(k) { const th = dwTh(k), r = th && th.getBoundingClientRect ? th.getBoundingClientRect() : null; return r && Number.isFinite(r.width) ? r.width : 0; }
  /** Congela las demás columnas a su ancho de ESTE momento (tabla sin el 100 %): así un ancho propio solo cambia su columna. */
  function dwFreeze() {
    if (DW_FRZ) return;
    const tbl = $('tbl'), ths = Array.from(tbl.querySelectorAll('thead th'));
    const ws = ths.map(th => th.getBoundingClientRect ? th.getBoundingClientRect().width : 0);
    ths.forEach((th, i) => {
      const k = th.dataset.dwk;
      if (k) DW0[k] = ws[i] > 0 ? ws[i] : null;
      if (k && DW[k] != null) return;
      if (!(ws[i] > 0)) return;   // oculta (Modo Foco): no ocupa sitio
      th.setAttribute('data-dwf', ''); th.style.width = th.style.minWidth = ws[i] + 'px';
    });
    tbl.classList.add('dwfrz'); DW_FRZ = true;
  }
  function dwUnfreeze() {
    const tbl = $('tbl');
    Array.from(tbl.querySelectorAll('thead th[data-dwf]')).forEach(th => { th.removeAttribute('data-dwf'); th.style.width = th.style.minWidth = ''; });
    tbl.classList.remove('dwfrz'); DW_FRZ = false;
  }
  /** Pinta los anchos propios (y su ↶). Sin ninguno, la tabla vuelve EXACTAMENTE a su maquetación inicial. */
  function dwApply() {
    const tbl = $('tbl');
    DCOLS.forEach(c => {
      const th = dwTh(c.k), on = DW[c.k] != null;
      tbl.classList.toggle('dw-' + c.k, on);
      if (!th) return;
      th.classList.toggle('dwchg', on);
      const back = !on && DW_FRZ && DW0[c.k] ? DW0[c.k] : null;   // sin ancho propio y con el resto congelado: su ancho inicial exacto
      if (back) th.setAttribute('data-dwf', ''); else th.removeAttribute('data-dwf');
      th.style.width = th.style.minWidth = on ? DW[c.k] + 'px' : back ? back + 'px' : '';
      const rs = th.querySelector('[data-dreset]'); if (rs) rs.hidden = !on;
    });
    if (!dwAny()) dwUnfreeze();
    dwAria();
  }
  /** Mínimo REAL de la columna (lo que sus controles y su título necesitan): se mide, no se inventa. */
  function dwMin(k) {
    const th = dwTh(k); if (!th || !th.getBoundingClientRect) return 0;
    const wrap = dwWrap(), sl = wrap ? wrap.scrollLeft : 0;
    const w0 = th.style.width, m0 = th.style.minWidth;
    th.style.width = th.style.minWidth = '1px';
    const m = th.getBoundingClientRect().width;
    th.style.width = w0; th.style.minWidth = m0;
    if (wrap && wrap.scrollLeft !== sl) wrap.scrollLeft = sl;   // medir no mueve la vista (la tabla encoge un instante)
    return Number.isFinite(m) ? Math.ceil(m) : 0;
  }
  const dwWrap = () => { const t = $('tbl'), w = t && t.closest ? t.closest('.tblwrap') : null; return w && w.getBoundingClientRect ? w : null; };
  /** Posición de scroll de la vista: el microcontrol se cierra si la vista se mueve de verdad, no por una medida propia. */
  const dwScrollSig = () => { const w = dwWrap(); return (w ? w.scrollLeft + ',' + w.scrollTop : '') + ',' + (window.scrollX || 0) + ',' + (window.scrollY || 0); };
  function dwSet(k, w) {
    if (!Number.isFinite(w)) return;
    dwFreeze();
    DW[k] = Math.max(dwMin(k), Math.round(w));
    dwApply();
    dwClearLane(k);
    if (DWCTL.g && DWCTL.k === k) { dwCtlPaint(); dwCtlPlace(); DWCTL.pos = dwScrollSig(); }   // − al final de la tabla puede recolocar la vista: no cierra
  }
  function dwReset(k) {
    const th = dwTh(k), rs = th && th.querySelector('[data-dreset]'), had = rs && document.activeElement === rs;
    if (DWCTL.k === k) dwCtlClose(false);
    DW[k] = null; dwApply();
    if (had) { const g = th.querySelector('[data-dgrip]'); if (g && g.focus) g.focus(); }   // el foco no se pierde con el ↶ que se va
  }
  /** Carril fijo de ··· (a la derecha, encima de lo que se desplaza): su ancho real, para que el foco y «llevar a la vista» lo
   *  dejen libre (scroll-padding). En Modo Foco no hay carril: 0. */
  function dwLane() {
    const wrap = dwWrap(), m = document.querySelector('#tbl thead th.mo'), r = m && m.getBoundingClientRect ? m.getBoundingClientRect() : null;
    if (wrap && wrap.style && wrap.style.setProperty) wrap.style.setProperty('--lanew', (r && r.width > 0 ? Math.ceil(r.width) : 0) + 'px');
    return r && r.width > 0 ? r : null;
  }
  /** Al cambiar SU ancho (arrastre o − / +), el tirador nunca se queda debajo del carril de ···: la vista se corre lo justo. */
  function dwClearLane(k) {
    const wrap = dwWrap(), th = dwTh(k), g = th && th.querySelector('[data-dgrip]'), lane = dwLane();
    if (!wrap || !g || !lane || !g.getBoundingClientRect) return;
    const over = g.getBoundingClientRect().right - lane.left;
    if (over > 0) wrap.scrollLeft += Math.ceil(over);
  }
  /** Cambió la maquetación (ventana, rotación, Modo Foco): las demás columnas se vuelven a tomar con los anchos propios ya puestos. */
  function dwRelayout() {
    dwCtlClose(false);
    dwLane();
    if (!dwAny()) return;
    dwUnfreeze(); dwApply(); dwFreeze();
  }
  /** Nombres verdaderos: columna, ancho actual y mínimo real; ↶ dice qué columna devuelve. Sin medidas, sin cifras. */
  function dwAria() {
    DCOLS.forEach(c => {
      const th = dwTh(c.k); if (!th) return;
      const g = th.querySelector('[data-dgrip]'), rs = th.querySelector('[data-dreset]'), l = dwLbl(c.k), w = DW[c.k];
      if (g) {
        g.setAttribute('aria-label', w != null ? tx('Ancho de la columna {_c}: {n} píxeles (mínimo {m})', { _c: l, n: w, m: dwMin(c.k) }) : tx('Ancho de la columna {_c}', { _c: l }));
        g.title = tx('Arrastra para cambiar el ancho; clic, Intro o Espacio para ajustarlo con − / +');
      }
      if (rs) { rs.setAttribute('aria-label', tx('Restablecer el ancho de {_c}', { _c: l })); rs.title = rs.getAttribute('aria-label'); }
    });
  }
  // Microcontrol − / + (16 px; mínimo real; sin máximo), junto al tirador y dentro de la pantalla
  function dwCtlOpen(g, kb) {
    dwCtlClose(false);
    const k = g.dataset.dgrip; DWCTL.g = g; DWCTL.k = k;
    g.setAttribute('aria-expanded', 'true');
    const box = $('dash-colctl'); box.hidden = false;
    dwCtlPaint(); dwCtlPlace(); DWCTL.pos = dwScrollSig();
    if (kb) { const at = (DW[k] != null ? DW[k] : Math.round(dwNow(k))) <= dwMin(k); const b = box.querySelector('[data-dstep="' + (at ? 1 : -1) + '"]'); if (b && b.focus) b.focus(); }
  }
  function dwCtlClose(back) {
    const g = DWCTL.g; if (!g) return;
    DWCTL.g = null; DWCTL.k = '';
    if (g.setAttribute) g.setAttribute('aria-expanded', 'false');
    const box = $('dash-colctl'); if (box) box.hidden = true;
    if (back && g.focus) g.focus();
  }
  function dwCtlPaint() {
    if (!DWCTL.g) return;
    const k = DWCTL.k, l = dwLbl(k), w = DW[k] != null ? DW[k] : Math.round(dwNow(k)), min = dwMin(k), box = $('dash-colctl');
    box.setAttribute('aria-label', tx('Ancho de la columna {_c}', { _c: l }));
    $('dash-colw').textContent = tx('{n} px', { n: w });
    const minus = box.querySelector('[data-dstep="-1"]'), plus = box.querySelector('[data-dstep="1"]');
    if (minus) { minus.setAttribute('aria-label', tx('Estrechar {_c} 16 píxeles', { _c: l })); minus.setAttribute('aria-disabled', w <= min ? 'true' : 'false'); }
    if (plus) plus.setAttribute('aria-label', tx('Ensanchar {_c} 16 píxeles', { _c: l }));
  }
  function dwCtlPlace() {
    const box = $('dash-colctl'), g = DWCTL.g; if (!g || !box) return;
    const r = g.getBoundingClientRect ? g.getBoundingClientRect() : null;
    if (!r || ![r.left, r.top, r.right, r.bottom].every(Number.isFinite)) return;   // sin medidas (entorno sin maquetación)
    const w = box.offsetWidth || 0, h = box.offsetHeight || 0, vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    const m = document.querySelector('#tbl thead th.mo'), lr = m && m.getBoundingClientRect ? m.getBoundingClientRect() : null;
    const wr = dwWrap() ? dwWrap().getBoundingClientRect() : null, lane = lr && lr.width > 0 ? lr : null;
    // Nunca encima de los ··· de las filas (carril) ni de lo que hay sobre la tabla (Foco, ?, Añadir)
    const avoid = (lane ? [{ left: lane.left, right: lane.right, top: lane.top, bottom: vh }] : []).concat(wr && Number.isFinite(wr.top) ? [{ left: 0, right: vw, top: 0, bottom: wr.top }] : []);
    let p = errPopPlace(r, w, h, vw, vh, 8, avoid);
    if ((!p || p.side === 'left') && lane) {   // junto al carril: debajo, terminando antes de él (a la izquierda taparía su ↶)
      const q = { left: Math.max(8, Math.min(r.left, lane.left - 4 - w)), top: r.bottom };
      if (q.top + h <= vh - 8) p = q;
    }
    p = p || errPopPlace(r, w, h, vw, vh, 8, []) || { left: Math.max(8, Math.min(r.left, vw - w - 8)), top: Math.max(8, Math.min(r.bottom, vh - h - 8)) };
    box.style.left = Math.round(p.left) + 'px'; box.style.top = Math.round(p.top) + 'px';
  }
  function dwTabbables() {
    return Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter(n =>
      !n.disabled && n.tabIndex >= 0 && !(n.closest && n.closest('[hidden], [inert]')) && n.getClientRects && n.getClientRects().length > 0 && n.type !== 'hidden');
  }
  // Gesto sobre el tirador: decisión en pointerup (nunca con el «click», que se ignora: sin doble apertura)
  const dwHead = $('tbl');   // tiradores y ↶ viven en su cabecera
  dwHead.addEventListener('pointerdown', e => {
    const g = e.target.closest && e.target.closest('[data-dgrip]');
    if (!g || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const k = g.dataset.dgrip;
    DW_G = { id: e.pointerId, k, g, x: e.clientX, y: e.clientY, w: DW[k] != null ? DW[k] : dwNow(k), pt: e.pointerType || 'mouse', drag: false, vert: false };
    try { g.setPointerCapture(e.pointerId); } catch (err) {}
  });
  dwHead.addEventListener('pointermove', e => {
    const s = DW_G; if (!s || e.pointerId !== s.id || s.vert) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.drag) {
      if (s.pt === 'mouse' ? dx !== 0 : Math.abs(dx) > DW_TOQUE) { s.drag = true; dwCtlClose(false); if (s.g.classList) s.g.classList.add('drag'); }
      else if (s.pt !== 'mouse' && Math.abs(dy) > DW_TOQUE && Math.abs(dy) > Math.abs(dx)) { s.vert = true; return; }
      else return;
    }
    dwSet(s.k, s.w + dx);
  });
  dwHead.addEventListener('pointerup', e => {
    const s = DW_G; if (!s || e.pointerId !== s.id) return;
    DW_G = null; if (s.g.classList) s.g.classList.remove('drag');
    if (s.drag || s.vert) return;
    if (DWCTL.g === s.g) dwCtlClose(false); else dwCtlOpen(s.g, false);
  });
  const dwCancel = e => { const s = DW_G; if (!s || e.pointerId !== s.id) return; DW_G = null; if (s.g.classList) s.g.classList.remove('drag'); };   // no abre; el ancho se queda
  dwHead.addEventListener('pointercancel', dwCancel);
  dwHead.addEventListener('lostpointercapture', dwCancel);
  dwHead.addEventListener('keydown', e => {
    const g = e.target.closest && e.target.closest('[data-dgrip]');
    if (!g || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (DWCTL.g === g) dwCtlClose(false); else dwCtlOpen(g, true);
  });
  dwHead.addEventListener('click', e => {
    const rs = e.target.closest && e.target.closest('[data-dreset]');
    if (rs) { dwReset(rs.dataset.dreset); return; }
  });
  $('dash-colctl').addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-dstep]');
    if (!b || !DWCTL.g || b.getAttribute('aria-disabled') === 'true') return;
    const k = DWCTL.k, w = DW[k] != null ? DW[k] : Math.round(dwNow(k));
    dwSet(k, w + (+b.dataset.dstep) * DW_PASO);
  });
  $('dash-colctl').addEventListener('keydown', e => {
    if (!DWCTL.g) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dwCtlClose(true); return; }
    if (e.key !== 'Tab') return;
    const box = $('dash-colctl'), first = box.querySelector('[data-dstep="-1"]'), last = box.querySelector('[data-dstep="1"]');
    if (e.shiftKey && e.target === first) { e.preventDefault(); dwCtlClose(true); }
    else if (!e.shiftKey && e.target === last) {   // al siguiente control tras el tirador, en el orden normal: Tab no queda atrapado
      e.preventDefault(); const g = DWCTL.g, list = dwTabbables(), to = list[list.indexOf(g) + 1];
      dwCtlClose(false); if (to && to.focus) to.focus();
    }
  });
  $('dash-colctl').addEventListener('focusout', e => { const to = e.relatedTarget; if (DWCTL.g && to && !(to.closest && to.closest('#dash-colctl')) && to !== DWCTL.g) dwCtlClose(false); });
  document.addEventListener('pointerdown', e => { if (DWCTL.g && !(e.target.closest && (e.target.closest('#dash-colctl') || e.target.closest('[data-dgrip]') === DWCTL.g))) dwCtlClose(false); }, true);
  window.addEventListener('scroll', e => { if (DWCTL.g && !(e.target && e.target.closest && e.target.closest('#dash-colctl')) && dwScrollSig() !== DWCTL.pos) dwCtlClose(false); if (DTIP) dwTipOff(); }, true);
  window.addEventListener('resize', () => { if (DTIP) dwTipOff(); dwRelayout(); });
  // ── Lectura pasiva de Zona, Nombre y Notas: SOLO ratón y SOLO si el texto está cortado. En tablet no hay hover ni pulsación
  // larga: un toque edita como siempre. El detalle no recibe el puntero y se cierra al salir, al editar o al hacer scroll.
  let DTIP = null;
  const dwCut = n => !!n && n.scrollWidth > n.clientWidth + 1;
  function dwTipOff() {
    const td = DTIP; DTIP = null; if (!td) return;
    td.classList.remove('tipon');
    const z = td.querySelector('input[data-k="zona"]');
    if (z && z.dataset.dtitle !== undefined) { z.title = z.dataset.dtitle; delete z.dataset.dtitle; }   // vuelve la ayuda nativa
  }
  ['tbody', 'tbody-sin'].forEach(tid => {
    const tb = $(tid);
    tb.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const td = e.target.closest && e.target.closest('td.stage, td.name, td.n');
      if (!td || td === DTIP) return;
      dwTipOff();
      const inp = td.querySelector('input[type=text]'), tip = td.querySelector('.ntip');
      if (!inp || !tip || tip.hidden || inp === document.activeElement || !dwCut(inp)) return;
      DTIP = td; td.classList.add('tipon');
      if (inp.dataset.k === 'zona' && inp.title) { inp.dataset.dtitle = inp.title; inp.title = ''; }   // sin dos rótulos a la vez (la ayuda sigue en aria-label)
    });
    tb.addEventListener('pointerout', e => { if (DTIP && !(e.relatedTarget && DTIP.contains && DTIP.contains(e.relatedTarget))) dwTipOff(); });
    tb.addEventListener('focusin', () => { if (DTIP) dwTipOff(); });
  });
  dwAria(); dwLane();

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
      header: undefined, map: null, create: {}, extend: true, include: {}, edits: {}, read: null, pv: null, name: '',
      manual: [], mInc: {}, mEdits: {}, mSeq: 0, nPaste: 0 };   // dec. 155: filas manuales del borrador (solo en memoria)
    $('imp-notice').hidden = !notice; $('imp-notice').textContent = notice || '';
    impManShow(false); impManClear();
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
  /** Cerrar / Cancelar: descarta EXPLÍCITAMENTE el borrador entero (texto, mapa, ediciones y filas manuales). */
  function closeImport() { $('imp').hidden = true; IMP = null; IMP_DRAG = null; IMP_ED = null; IMP_EDPEND = null; impColCtlClose(false); impManShow(false); impManClear(); errPopHide(); cellPopHide(); impColApply(); }

  function impResetRows() { IMP.include = {}; IMP.edits = {}; }

  function impRecompute() {
    if (!IMP) return;
    // Un clic en un botón o casilla de la tabla con el editor ampliado abierto: el dato ya está confirmado, pero la tabla no se rehace
    // hasta que ese clic termine (si no, el botón desaparecería bajo el dedo y el clic se perdería)
    if (IMP_HOLD) { IMP_PEND = true; return; }
    IMP_PEND = false;
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
    // Dec. 155: las filas manuales van DETRÁS de las pegadas, en la misma vista previa. Sus casillas y ediciones se guardan por
    // su id propio (no por posición): cambiar el texto pegado no las toca.
    const n = rd.records.length, include = Object.assign({}, IMP.include), edits = Object.assign({}, IMP.edits);
    Object.keys(include).forEach(k => { if (+k >= n) delete include[k]; }); Object.keys(edits).forEach(k => { if (+k >= n) delete edits[k]; });
    IMP.manual.forEach((m, k) => { if (IMP.mInc[m.uid] !== undefined) include[n + k] = IMP.mInc[m.uid]; edits[n + k] = IMP.mEdits[m.uid]; });
    IMP.nPaste = n; IMP.incMap = include;   // casillas tal y como las dejó el regidor (false = desmarcada a mano)
    const dz = impDefZone();
    IMP.pv = I.preview(IMP.base, rd.records.concat(IMP.manual.map(m => m.rec)), { mode: IMP.mode, ctx: ctx, defaultJornada: IMP.defJor, defaultStageId: dz.id, defaultStageName: dz.name,
      createStages: IMP.create, include, edits });
    impRender();
  }

  // ── Dec. 155 · fila manual dentro del importador ─────────────────────
  /** Lo escrito en la ficha → registro como los del texto pegado (las horas se leen igual) y ediciones iniciales (tipo y nombre tal cual). */
  function impManRecord() {
    const v = id => String($(id).value || '').replace(/\s+/g, ' ').trim();
    const tipo = $('imp-m-tipo').value || 'show', fin = v('imp-m-fin'), dur = /^\+\s*\d+$/.test(fin) ? fin.replace(/\D/g, '') : '';
    const rec = I.interpret({ banda: v('imp-m-nombre'), escenario: v('imp-m-zona'), jornadaTxt: $('imp-m-jor').value || '', inicioTxt: v('imp-m-ini'),
      finTxt: dur ? '' : fin, duracion: dur, callTxt: v('imp-m-call'), notas: v('imp-m-notas'), raw: tx('Fila manual'), src: 'manual' }, I.contextOf(IMP.base));
    return { rec, ed: { tipo, banda: v('imp-m-nombre') } };
  }
  function impManShow(on) {
    $('imp-man').hidden = !on; $('imp-man-open').setAttribute('aria-expanded', String(!!on));
    if (on) {
      impManJor(); $('imp-m-err').textContent = '';
      try { $('imp-man').scrollIntoView({ block: 'nearest' }); } catch (e) {}   // la ficha está encima del pie: que se vea entera al abrirla (scroll-padding: el pie fijo no la tapa)
      $('imp-m-nombre').focus();
    }
  }
  function impManClear() {
    ['imp-m-nombre', 'imp-m-zona', 'imp-m-ini', 'imp-m-fin', 'imp-m-call', 'imp-m-notas'].forEach(id => { $(id).value = ''; });
    $('imp-m-err').textContent = '';
  }
  /** Jornadas de la ficha: «por defecto» (la del importador) y las del evento (o del evento provisional). */
  function impManJor() {
    if (!IMP) return;
    const jor = IMP.fresh ? C.eventDays(IMP.base) : jornadaOptions(), cur = $('imp-m-jor').value;
    $('imp-m-jor').innerHTML = '<option value="">' + tx('La jornada por defecto') + '</option>' + jor.map(d => '<option value="' + d + '">' + esc(fmtDay(d)) + '</option>').join('');
    $('imp-m-jor').value = jor.indexOf(cur) >= 0 ? cur : '';
  }
  /** «Añadir al borrador»: se valida con las MISMAS reglas que la vista previa. Si no vale, se dice por qué y no se toca nada más. */
  function impManAdd() {
    if (!IMP) return false;
    const { rec, ed } = impManRecord(), dz = impDefZone();
    const one = I.preview(IMP.base, [rec], { mode: IMP.mode, ctx: I.contextOf(IMP.base), defaultJornada: IMP.defJor, defaultStageId: dz.id, defaultStageName: dz.name,
      createStages: IMP.create, edits: { 0: ed } }).rows[0];
    if (one.status === 'err') { $('imp-m-err').textContent = one.errs.map(back).join(' · '); return false; }
    const uid = 'm' + (++IMP.mSeq);
    IMP.manual.push({ uid, rec }); IMP.mEdits[uid] = ed;
    impManClear(); impRecompute();   // tipo y jornada se quedan: listas de filas seguidas
    // La fila nueva es la última de la vista previa: su scroll interno baja hasta ella para que se vea el resultado
    // Con orden activo aparece en su sitio ordenado: el scroll de la vista previa va hasta ella por su id estable
    impScrollToRid(uid);
    try { $('imp-man').scrollIntoView({ block: 'nearest' }); } catch (e) {}   // la ficha entera a la vista, sin quedar bajo el pie fijo
    try { $('imp-m-nombre').focus({ preventScroll: true }); } catch (e) { $('imp-m-nombre').focus(); }
    return true;
  }
  $('imp-man-open').addEventListener('click', () => impManShow($('imp-man').hidden));
  $('imp-m-hide').addEventListener('click', () => impManShow(false));
  $('imp-m-add').addEventListener('click', impManAdd);
  $('imp-man').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); impManAdd(); } });

  // ── Dec. 155 · detalle de «Error ⓘ» ─────────────────────────────────
  // Un solo detalle flotante (#imp-errpop) fuera de la tabla y de la caja con scroll: se coloca junto al botón y DENTRO de la
  // pantalla (a la derecha; si no cabe, debajo; si tampoco, encima), así nunca se recorta ni obliga a desplazar la tabla.
  // Ratón: se abre al entrar en el botón y se mantiene al pasar al detalle (pegado al botón, sin hueco). Teclado: con el foco.
  // Toque: el clic lo fija y otro lo cierra. aria-expanded del botón dice siempre si está a la vista. Esc no se toca.
  const IC_INFO = ' <svg class="ic ii" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>';
  const ERRPOP = { btn: null, pinned: false, inline: false };
  /** Dónde va el detalle (px de pantalla). b: rect del botón; w, h: tamaño del detalle; vw, vh: pantalla; m: margen;
   *  avoid: rects que NO puede tapar (Cancelar, Importar, «Excluir» de la fila…). Prueba, en orden: a la derecha (arriba o abajo
   *  alineado con el botón), debajo, encima, a la izquierda; se queda con la primera entera en la zona segura que no tape nada.
   *  Si ninguna vale, devuelve null: el detalle se abre EN LÍNEA bajo su fila (nunca se tapa nada, ni en parte). Pura (tests). */
  function errPopPlace(b, w, h, vw, vh, m, avoid) {
    m = m === undefined ? 8 : m; avoid = (avoid || []).concat([b]);   // tampoco tapa su propio botón (con él se cierra)
    const fitX = x => Math.max(m, Math.min(x, vw - w - m)), fitY = y => Math.max(m, Math.min(y, vh - h - m));
    const cands = [{ left: b.right, top: fitY(b.top - 4), side: 'right' }, { left: b.right, top: fitY(b.bottom - h), side: 'right' },
      { left: fitX(b.left), top: b.bottom, side: 'below' }, { left: fitX(b.left), top: Math.max(m, b.top - h), side: 'above' },
      { left: fitX(b.left - w), top: fitY(b.top - 4), side: 'left' }];
    const inView = c => c.left >= m - 0.5 && c.top >= m - 0.5 && c.left + w <= vw - m + 0.5 && c.top + h <= vh - m + 0.5;
    const over = c => avoid.reduce((s, a) => s + Math.max(0, Math.min(c.left + w, a.right) - Math.max(c.left, a.left)) * Math.max(0, Math.min(c.top + h, a.bottom) - Math.max(c.top, a.top)), 0);
    return cands.find(c => inView(c) && over(c) === 0) || null;
  }
  /** Lo que el detalle nunca tapa: Cancelar, Importar, «+ Añadir fila manual» y la acción de su fila (Excluir / Restaurar). */
  function errPopAvoid(btn) {
    const td = btn.closest && btn.closest('td'), act = td && td.querySelector && td.querySelector('[data-exc],[data-rest]');
    return impRects([$('imp-cancel'), $('imp-go'), $('imp-man-open'), act]);
  }
  /** Rectángulos (+4 px) de lo que no se puede tapar; solo lo que está pintado. */
  function impRects(nodes) {
    return nodes.filter(n => n && n.getBoundingClientRect).map(n => {
      const r = n.getBoundingClientRect(); return { left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4 }; })
      .filter(a => [a.left, a.top, a.right, a.bottom].every(Number.isFinite) && a.right > a.left && a.bottom > a.top);
  }
  /** Zona segura (alto): la pantalla hasta el pie del importador (resumen y acciones no se tapan nunca). */
  function errPopSafeH() {
    const vh = window.innerHeight || 0, f = document.querySelector && document.querySelector('#imp .imp-foot'), r = f && f.getBoundingClientRect ? f.getBoundingClientRect() : null;
    return r && Number.isFinite(r.top) && r.top > 0 ? Math.min(vh, r.top) : vh;
  }
  /** ¿Se ve ENTERO en pantalla? Dentro de la vista previa y de la ventana del importador, por encima del pie y sin nada encima
   *  (hit test en su centro: la cabecera fija de la tabla también cuenta). Si no se puede medir, se da por NO visible. */
  function impInView(n) {
    try {
      if (!n || !n.getBoundingClientRect) return false;
      const r = n.getBoundingClientRect();
      if (![r.left, r.top, r.right, r.bottom].every(Number.isFinite) || !(r.bottom > r.top)) return false;
      let top = 0, bot = errPopSafeH();
      [$('imp-prevwrap'), document.querySelector && document.querySelector('#imp .imp-box')].forEach(c => {
        const q = c && c.getBoundingClientRect ? c.getBoundingClientRect() : null;
        if (q && Number.isFinite(q.top) && Number.isFinite(q.bottom)) { top = Math.max(top, q.top); bot = Math.min(bot, q.bottom); } });
      if (r.top < top - 0.5 || r.bottom > bot + 0.5) return false;
      if (typeof document.elementFromPoint === 'function') { const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); if (!h || !(h === n || (n.contains && n.contains(h)))) return false; }
      return true;
    } catch (e) { return false; }
  }
  function errPopShow(btn, pinned) {
    const pop = $('imp-errpop');
    cellPopHide();   // un solo detalle a la vez
    if (ERRPOP.btn) errPopHide();
    ERRPOP.btn = btn; ERRPOP.pinned = !!pinned; ERRPOP.inline = false;
    const why = (btn.dataset && btn.dataset.why) || '';
    pop.textContent = why;
    pop.hidden = false;
    const r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
    const p = errPopPlace(r, pop.offsetWidth || 0, pop.offsetHeight || 0, window.innerWidth || 0, errPopSafeH(), 8, errPopAvoid(btn));
    if (p) {
      pop.style.left = Math.round(p.left) + 'px'; pop.style.top = Math.round(p.top) + 'px'; pop.dataset.side = p.side;
      if (btn.setAttribute) btn.setAttribute('aria-controls', 'imp-errpop');
    } else {
      // Fallback determinista: ninguna posición flotante cabe sin tapar algo → el detalle se abre en línea, en una fila justo debajo
      // de la suya (dentro de la vista previa) y se hace scroll hasta que se lee entero. No tapa nada: ocupa su propio sitio.
      pop.hidden = true; ERRPOP.inline = true;
      const tr = btn.closest && btn.closest('tr');
      // Acción de su fila repetida ARRIBA del bloque (hermana del diagnóstico, nunca dentro del role="tooltip"): mismo atributo
      // (data-exc / data-rest), mismo handler de la vista previa, mismo texto. Nace oculta: solo se muestra si, tras el scroll,
      // la original no se ve entera.
      const td = btn.closest && btn.closest('td'), act = td && td.querySelector ? td.querySelector('[data-exc],[data-rest]') : null;
      const rest = !!(act && act.dataset && act.dataset.rest !== undefined);
      const idx = act && act.dataset ? (rest ? act.dataset.rest : act.dataset.exc) : (btn.dataset && btn.dataset.errtip);
      const ctx = '<button type="button" id="imp-errctx" class="linkbtn imp-rowact imp-errctx" ' + (rest ? 'data-rest' : 'data-exc') + '="' + esc(String(idx)) + '" aria-describedby="imp-errinline" hidden>' + esc(tx(rest ? 'Restaurar' : 'Excluir')) + '</button>';
      if (tr && tr.insertAdjacentHTML) tr.insertAdjacentHTML('afterend', '<tr id="imp-errrow" class="imp-errrow"><td colspan="11">' + ctx + '<div id="imp-errinline" class="imp-errinline" role="tooltip">' + esc(why) + '</div></td></tr>');
      // Scroll hasta leerlo, por encima del pie: si cabe entero, lo justo para verlo; si es más alto que el hueco, que empiece arriba
      // (alto útil = de la parte de arriba de la ventana del importador al pie)
      const el = $('imp-errrow'), box = document.querySelector && document.querySelector('#imp .imp-box');
      const toView = () => { try {
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null, need = r ? r.bottom - r.top : 0;
        const boxTop = box && box.getBoundingClientRect ? Math.max(0, box.getBoundingClientRect().top || 0) : 0, avail = errPopSafeH() - boxTop;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: need > avail ? 'start' : 'nearest' });
      } catch (e) {} };
      toView();
      // ¿Su Excluir / Restaurar se quedó fuera de la vista (o la fila entera)? → la acción aparece al inicio del bloque y se vuelve a
      // llevar el scroll: si el detalle es más alto que el hueco, el bloque empieza arriba, así que la acción queda a la vista
      if (!impInView(act)) { const c = $('imp-errctx'); if (c) { c.hidden = false; toView(); } }
      if (btn.setAttribute) btn.setAttribute('aria-controls', 'imp-errinline');
    }
    if (btn.setAttribute) btn.setAttribute('aria-expanded', 'true');
  }
  function errPopHide() {
    if (ERRPOP.btn && ERRPOP.btn.setAttribute) { ERRPOP.btn.setAttribute('aria-expanded', 'false'); ERRPOP.btn.setAttribute('aria-controls', 'imp-errpop'); }
    ERRPOP.btn = null; ERRPOP.pinned = false; ERRPOP.inline = false;
    const pop = $('imp-errpop'); if (pop) pop.hidden = true;
    const row = document.getElementById && document.getElementById('imp-errrow'); if (row && row.parentNode) row.parentNode.removeChild(row);
  }
  const inPop = n => !!(n && n.closest && n.closest('#imp-errpop, #imp-errrow'));
  $('imp-prev').addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest && e.target.closest('[data-errtip]'); if (b && ERRPOP.btn !== b) errPopShow(b, false);
  });
  $('imp-prev').addEventListener('pointerout', e => {   // salir del botón hacia el detalle (flotante o en línea) no lo cierra; hacia otro sitio, sí (si no está fijado)
    if (e.pointerType !== 'mouse' || ERRPOP.pinned || !ERRPOP.btn) return;
    const zone = n => inPop(n) || !!(n && n.closest && n.closest('[data-errtip]') === ERRPOP.btn);
    if (!zone(e.target) || zone(e.relatedTarget)) return;
    errPopHide();
  });
  $('imp-errpop').addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse' || ERRPOP.pinned) return;
    const to = e.relatedTarget; if (ERRPOP.btn && to && to.closest && to.closest('[data-errtip]') === ERRPOP.btn) return;
    errPopHide();
  });
  // Foco de TECLADO (focus-visible): un toque también enfoca el botón, pero ese gesto lo resuelve su clic (abrir en línea antes del
  // clic movería la tabla bajo el dedo y el toque caería en otro sitio). Se abre en el siguiente fotograma: el scroll con el que el
  // navegador trae el botón a la vista ya se ha asentado (sus eventos «scroll» van antes) y no cierra el detalle recién abierto;
  // solo si el botón sigue con foco de teclado y no hay ya un detalle suyo abierto.
  $('imp-prev').addEventListener('focusin', e => {
    const b = e.target.closest && e.target.closest('[data-errtip]'); if (!b) return;
    window.requestAnimationFrame(() => { if (IMP && ERRPOP.btn !== b && (!b.matches || b.matches(':focus-visible'))) errPopShow(b, false); });
  });
  // El conjunto «Error + su detalle en línea (y su acción contextual)» es uno solo para el foco: moverse dentro no lo cierra;
  // salir de él, sí (si no está fijado). Tab desde Error va a la acción contextual visible; desde ella, Tab sigue el orden normal.
  const inErrSet = n => !!(ERRPOP.btn && n && n.closest && (n.closest('#imp-errrow') || n.closest('[data-errtip]') === ERRPOP.btn));
  $('imp-prev').addEventListener('focusout', e => { if (ERRPOP.btn && !ERRPOP.pinned && inErrSet(e.target) && !inErrSet(e.relatedTarget)) errPopHide(); });
  $('imp-prev').addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.shiftKey || !ERRPOP.inline || !ERRPOP.btn || e.target !== ERRPOP.btn) return;
    const c = $('imp-errctx'); if (c && !c.hidden && c.focus) { e.preventDefault(); c.focus(); }
  });
  // Fijado: un clic fuera, o mover la ventana o la tabla, lo cierra (no se queda flotando en un sitio que ya no le toca)
  document.addEventListener('click', e => { if (ERRPOP.btn && !(e.target.closest && (e.target.closest('[data-errtip]') || inPop(e.target)))) errPopHide(); });
  window.addEventListener('scroll', e => { if (ERRPOP.btn && !ERRPOP.inline && !inPop(e.target)) errPopHide(); }, true);   // en línea se mueve con su fila
  window.addEventListener('resize', () => { if (ERRPOP.btn) errPopHide(); });

  /** ¿Fila desmarcada a mano por el regidor? (las demás se quieren importar; las que tienen error, cuando se corrijan) */
  function impOff(r) { return !!(IMP && IMP.incMap && IMP.incMap[r.idx] === false); }
  /** Dec. 155 · reparto del borrador en tres grupos EXCLUYENTES que suman siempre el total (cada fila, en uno solo):
   *  imp = entra al importar (marcada y válida, aunque tenga avisos); exc = desmarcada a mano (manda sobre el error);
   *  err = sigue marcada pero no se puede importar. */
  function impTally(rows, off) {
    const k = { imp: 0, exc: 0, err: 0, total: rows.length };
    rows.forEach(r => { if (r.include && r.status !== 'err') k.imp++; else if (off(r)) k.exc++; else k.err++; });
    return k;
  }
  // ── v20261166 · herramientas de la vista previa: orden SOLO visual y ancho de columnas ─────────────
  // Nada de esto toca el borrador: IMP.pv.rows, el orden pegado/manual y lo que entra al importar siguen igual.
  // Columnas de datos (ordenables y con tirador); i = posición en la tabla (0 casilla, 1 Estado … 10 Avisos).
  const IMP_COLS = [{ k: 'tipo', l: 'Tipo', i: 2 }, { k: 'escenario', l: 'Zona', i: 3 }, { k: 'banda', l: 'Nombre', i: 4 }, { k: 'jornada', l: 'Jornada', i: 5 },
    { k: 'inicio', l: 'Inicio', i: 6 }, { k: 'fin', l: 'Fin', i: 7 }, { k: 'call', l: 'CALL', i: 8 }, { k: 'notas', l: 'Notas', i: 9 }];
  // v20261167 · «Estado» también ordena (solo la vista) pero NO es columna de datos: sin tirador ni microcontrol de ancho
  const IMP_STCOL = { k: 'estado', l: 'Estado', i: 1, nogrip: true }, IMP_SORTCOLS = [IMP_STCOL].concat(IMP_COLS);
  const IMP_NCOL = 11, IMP_TIPO_ORDEN = ['show', 'sc', 'tarea', 'hito'];   // Show → Soundcheck → Tarea → Marcador
  const IMP_COL_PASO = 16;   // px por pulsación de − / + en el microcontrol del tirador (sin máximo)
  let IMP_DRAG = null, IMP_PAINT = false;   // IMP_PAINT: la tabla se está rehaciendo (el foco del control que se quita no cuenta como «salir»)
  // ── v20261166 · textos recortados en Zona, Nombre, CALL y Notas: lectura pasiva con ratón (hover) y editor ampliado al editar ──
  // Hover: solo ratón, solo si el texto no cabe y el campo no tiene foco; mismas reglas que el detalle de «Error ⓘ» (fuera de la caja
  // que recorta, posición segura, no tapa acciones; si no cabe flotante, en línea bajo la fila). Editor: el MISMO hueco del campo se
  // amplía (área de texto que ajusta líneas solo a la vista; el dato sigue siendo de una línea) sin cambiar el ancho de la columna.
  const IMP_WIDE_K = ['escenario', 'banda', 'call', 'notas'];
  const CELLPOP = { inp: null, inline: false };
  let IMP_ED = null, IMP_NOEXP = false, IMP_PTR = null, IMP_EDPEND = null, IMP_CLICKTO = null, IMP_CLICKEL = null, IMP_FOCUSSEL = null, IMP_HOLD = false, IMP_PEND = false, IMP_HOLDOWN = false;
  /** Selección del campo tal y como la dejó el navegador (cursor o trozo seleccionado). */
  const impSelOf = n => { try { return { s: n.selectionStart, e: n.selectionEnd, d: n.selectionDirection || 'none' }; } catch (e) { return null; } };
  /** ¿Campo de texto de una de esas cuatro columnas, en una fila de la vista previa? */
  function impWideK(n) { return !!(n && n.dataset && IMP_WIDE_K.indexOf(n.dataset.k) >= 0 && n.matches && n.matches('#imp-prev tbody input[type=text][data-row]')); }
  /** ¿Su texto (no vacío) no cabe a la vista? */
  function impCut(n) { return !!(n && String(n.value || '').trim() && Number(n.scrollWidth) > Number(n.clientWidth) + 1); }
  function impColName(k) { const c = IMP_COLS.find(x => x.k === k); return c ? tx(c.l) : ''; }
  /** Lo que el detalle de lectura nunca tapa: pie (Cancelar, Importar, + Añadir fila manual) y todos los Excluir / Restaurar. */
  function cellPopAvoid() {
    const acts = document.querySelectorAll ? Array.from(document.querySelectorAll('#imp-prev [data-exc], #imp-prev [data-rest], #imp-errctx')) : [];
    return impRects([$('imp-cancel'), $('imp-go'), $('imp-man-open')].concat(acts));
  }
  function cellPopShow(inp) {
    if (!IMP || IMP_ED || IMP_DRAG || (ERRPOP.btn && ERRPOP.pinned)) return;
    if (ERRPOP.btn) errPopHide();
    cellPopHide();
    const pop = $('imp-cellpop'), txt = String(inp.value || '');
    CELLPOP.inp = inp; CELLPOP.inline = false;
    pop.textContent = txt; pop.hidden = false;
    const r = inp.getBoundingClientRect ? inp.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
    const p = errPopPlace(r, pop.offsetWidth || 0, pop.offsetHeight || 0, window.innerWidth || 0, errPopSafeH(), 8, cellPopAvoid());
    if (p) { pop.style.left = Math.round(p.left) + 'px'; pop.style.top = Math.round(p.top) + 'px'; pop.dataset.side = p.side; }
    else {   // sin sitio flotante: en línea, justo bajo su fila (ocupa su propio sitio; no tapa nada)
      pop.hidden = true; CELLPOP.inline = true;
      const tr = inp.closest && inp.closest('tr');
      if (tr && tr.insertAdjacentHTML) tr.insertAdjacentHTML('afterend', '<tr id="imp-cellrow" class="imp-errrow imp-cellrow"><td colspan="11"><div id="imp-cellinline" class="imp-errinline" role="tooltip">' + esc(txt) + '</div></td></tr>');
    }
    if (inp.setAttribute) inp.setAttribute('aria-describedby', CELLPOP.inline ? 'imp-cellinline' : 'imp-cellpop');
  }
  function cellPopHide() {
    if (CELLPOP.inp && CELLPOP.inp.removeAttribute) CELLPOP.inp.removeAttribute('aria-describedby');
    CELLPOP.inp = null; CELLPOP.inline = false;
    const pop = $('imp-cellpop'); if (pop) pop.hidden = true;
    const row = document.getElementById && document.getElementById('imp-cellrow'); if (row && row.parentNode) row.parentNode.removeChild(row);
  }
  const inCellPop = n => !!(n && n.closest && n.closest('#imp-cellpop, #imp-cellrow'));
  /** Editor ampliado: un área de texto en el mismo hueco (el campo compacto se queda debajo, oculto, guardando el ancho de la celda). */
  function impEdOpen(inp, sel) {
    if (IMP_ED || !IMP || !inp.parentNode) return;
    cellPopHide(); if (ERRPOP.btn) errPopHide();
    const td = inp.closest('td'), ta = document.createElement('textarea');
    ta.className = 'imp-wide';
    ta.setAttribute('data-row', inp.dataset.row); ta.setAttribute('data-k', inp.dataset.k);
    ta.setAttribute('rows', '1'); ta.setAttribute('spellcheck', 'false'); ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('aria-label', tx('Editar {_c} (texto completo)', { _c: impColName(inp.dataset.k) }));
    ta.setAttribute('aria-describedby', 'imp-edhint');
    ta.value = String(inp.value || '');
    if (td && td.classList) td.classList.add('imp-wcell');
    inp.classList.add('imp-wsrc'); inp.setAttribute('tabindex', '-1'); inp.setAttribute('aria-hidden', 'true');
    inp.after(ta);
    IMP_ED = { ta, inp, td };
    impEdLayout();
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    // Hereda EXACTAMENTE la selección del campo compacto (nunca «seleccionar todo» por su cuenta)
    try { const n = ta.value.length, s = sel && Number.isFinite(sel.s) ? Math.min(sel.s, n) : n, f = sel && Number.isFinite(sel.e) ? Math.min(sel.e, n) : s; ta.setSelectionRange(s, f, (sel && sel.d) || 'none'); } catch (e) {}
  }
  /** Tamaño del editor: tan ancho como su texto, sin pasar del borde visible de la vista previa (si no cabe, ajusta líneas) y tan
   *  alto como haga falta dentro de lo visible (debajo de la cabecera fija); luego la vista previa se mueve lo justo para verlo. */
  function impEdLayout() {
    if (!IMP_ED) return;
    const { ta, inp } = IMP_ED, w = $('imp-prevwrap');
    try {
      const wr = w.getBoundingClientRect(), cr = inp.getBoundingClientRect(), cs = getComputedStyle(ta), px = v => parseFloat(v) || 0;
      if (![wr.left, wr.top, cr.left, cr.width].every(Number.isFinite)) return;
      const cv = impEdLayout.cv || (impEdLayout.cv = document.createElement('canvas')), cx = cv.getContext ? cv.getContext('2d') : null;
      let tw = 0; if (cx) { cx.font = cs.font; tw = Number(cx.measureText(ta.value).width) || 0; }
      const pad = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
      const avail = Math.max(cr.width, wr.left + w.clientWidth - 8 - cr.left);
      ta.style.left = inp.offsetLeft + 'px'; ta.style.top = inp.offsetTop + 'px';
      ta.style.width = Math.min(avail, Math.max(cr.width, Math.ceil(tw + pad + 2))) + 'px';
      const head = w.querySelector('thead'), hb = head && head.getBoundingClientRect ? Math.max(wr.top, head.getBoundingClientRect().bottom) : wr.top;
      const vb = wr.top + w.clientHeight, maxH = Math.max(cr.height, vb - hb - 8);
      ta.style.height = 'auto';
      const need = ta.scrollHeight + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      ta.style.height = Math.max(cr.height, Math.min(need, maxH)) + 'px'; ta.style.overflowY = need > maxH ? 'auto' : 'hidden';
      const r = ta.getBoundingClientRect();
      if (r.bottom > vb - 4) w.scrollTop += r.bottom - (vb - 4);
      else if (r.top < hb + 4) w.scrollTop -= (hb + 4) - r.top;
    } catch (e) {}
  }
  /** Cierra el editor y vuelve el campo compacto; si el texto cambió, se confirma como siempre (mismo camino que el «change»). */
  function impEdClose() {
    const ed = IMP_ED; if (!ed) return;
    IMP_ED = null;
    const { ta, inp, td } = ed, v = String(ta.value || '').replace(/[\r\n]+/g, ' ');
    inp.classList.remove('imp-wsrc'); inp.removeAttribute('tabindex'); inp.removeAttribute('aria-hidden');
    if (td && td.classList) td.classList.remove('imp-wcell');
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    if (v !== String(inp.defaultValue == null ? '' : inp.defaultValue)) { inp.value = v; impCellChange(inp); }
  }
  /** Identidad estable de una fila del borrador: pegada → «p<n>» (su lugar en el texto); manual → su id propio. */
  function impRid(r) { return IMP && r.idx >= IMP.nPaste && IMP.manual[r.idx - IMP.nPaste] ? IMP.manual[r.idx - IMP.nPaste].uid : 'p' + r.idx; }
  /** Valor con el que se ordena una celda; null = vacía o incompleta (va SIEMPRE al final).
   *  Horas: jornada operativa y, dentro, la hora del día operativo según el corte del evento (00:30 va detrás de 23:00);
   *  con hora pero sin jornada = incompleta. Lo que se ve como «—» (Fin de un marcador, CALL de tareas y marcadores) = vacío. */
  function impSortVal(r, k, cut) {
    // Estado ↑: Error activo → Revisar → OK → Excluida (error excluido a mano). Una fila válida desmarcada sigue siendo OK / Revisar.
    if (k === 'estado') return r.status === 'err' ? (impOff(r) ? 3 : 0) : r.status === 'warn' ? 1 : r.status === 'ok' ? 2 : null;
    if (k === 'tipo') { const t = IMP_TIPO_ORDEN.indexOf(r.tipo); return t < 0 ? null : t; }
    if (k === 'jornada') return C.dayIndex(r.jornada);
    if (k === 'inicio' || k === 'fin' || k === 'call') {
      if ((k === 'fin' && r.tipo === 'hito') || (k === 'call' && r.tipo !== 'show' && r.tipo !== 'sc')) return null;
      const d = C.dayIndex(r.jornada), t = C.parseHM(r[k]);
      return d === null || t === null ? null : d * 1440 + ((t - cut + 1440) % 1440);
    }
    const s = String(r[k] == null ? '' : r[k]).trim();
    return s || null;
  }
  /** Vista ordenada: una COPIA de rows (no la muta). sort = { k, dir: 'asc'|'desc' } o null (orden original).
   *  Texto: comparación natural sin mayúsculas ni acentos. Empates y vacíos: en el orden de incorporación. Pura (tests). */
  function impSortRows(rows, sort, o) {
    const v = rows.slice();
    if (!sort) return v;
    const coll = new Intl.Collator((o && o.lang) || 'es', { numeric: true, sensitivity: 'base' }), sgn = sort.dir === 'desc' ? -1 : 1, cut = (o && o.cut) || 0;
    const kv = v.map((r, n) => ({ r, n, x: impSortVal(r, sort.k, cut) }));
    kv.sort((a, b) => {
      if (a.x === null || b.x === null) return a.x === null && b.x === null ? a.n - b.n : a.x === null ? 1 : -1;
      const c = typeof a.x === 'number' ? a.x - b.x : coll.compare(a.x, b.x);
      return c ? sgn * c : a.n - b.n;
    });
    return kv.map(e => e.r);
  }
  const impLang = () => (window.ShowtimeI18n && window.ShowtimeI18n.getLang && window.ShowtimeI18n.getLang()) || 'es';
  /** Orden de la vista. Si el foco está en un campo de una fila (p. ej. su Tipo, cambiado con el desplegable), la vista NO se
   *  recoloca: se queda como estaba hasta confirmar (Intro) o perder el foco (release). */
  function impView(release) {
    const rows = IMP.pv.rows, a = document.activeElement;
    const sorted = impSortRows(rows, IMP.sort, { cut: C.cutoffMins(IMP.base), lang: impLang() });
    if (!release && IMP.sort && IMP.view && a && a.matches && a.matches('#imp-prev tbody [data-row]')) {
      const by = new Map(rows.map(r => [impRid(r), r])), keep = IMP.view.filter(id => by.has(id));
      if (keep.length === rows.length) { IMP.held = sorted.some((r, n) => impRid(r) !== keep[n]); return keep.map(id => by.get(id)); }
    }
    IMP.held = false; IMP.view = sorted.map(impRid);
    return sorted;
  }
  /** Controles a los que llega Tab, en orden del documento (la app no usa tabindex positivos). */
  function impTabbables() {
    return Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter(n =>
      !n.disabled && n.tabIndex >= 0 && !(n.closest && n.closest('[hidden], [inert]')) && n.getClientRects && n.getClientRects().length > 0 && !(n.type === 'hidden'));
  }
  /** Identidad estable de un destino de Tab dentro de la tabla: su control (fila por índice estable + campo) y su fila (data-rid). */
  function impTabKey(n) {
    if (!n || !n.dataset) return null;
    const d = n.dataset, tr = n.closest && n.closest('tr[data-rid]'), rid = tr && tr.dataset ? tr.dataset.rid : '';
    const sel = d.row !== undefined && d.k ? '[data-row="' + d.row + '"][data-k="' + d.k + '"]' : d.inc !== undefined ? '[data-inc="' + d.inc + '"]'
      : d.errtip !== undefined ? '[data-errtip="' + d.errtip + '"]' : d.exc !== undefined || d.rest !== undefined ? 'td.st [data-exc="' + (d.exc !== undefined ? d.exc : d.rest) + '"], td.st [data-rest="' + (d.exc !== undefined ? d.exc : d.rest) + '"]'
      : d.sort ? '[data-sort="' + d.sort + '"]' : d.grip !== undefined ? '[data-grip="' + d.grip + '"]' : '';
    return sel || rid ? { sel, rid } : null;
  }
  /** Enfoca el destino ya redibujado; si su control cambió de forma (p. ej. la fila dejó de tener error), el primero de su fila. */
  function impFocusTo(key, sel) {
    const t = $('imp-prev');
    let n = key.sel ? t.querySelector(key.sel) : null;
    if (!n && key.rid) { const tr = t.querySelector('tr[data-rid="' + key.rid + '"]'); n = tr && impTabbables().find(x => tr.contains && tr.contains(x)); }
    if (!n || !n.focus) return;
    // Con la selección que el navegador calculó para el clic (sel): se pone ANTES de enfocar y la hereda también el editor ampliado
    if (sel && n.setSelectionRange) { try { const L = String(n.value || '').length; n.setSelectionRange(Math.min(sel.s, L), Math.min(sel.e, L), sel.d || 'none'); } catch (e) {} IMP_FOCUSSEL = sel; }
    try { n.focus(); } finally { IMP_FOCUSSEL = null; }
  }
  /** Selector del control equivalente tras rehacer la tabla (el foco no se pierde). */
  function impFocusKey(a) {
    if (!a || !a.closest || !a.closest('#imp-prev') || !a.dataset) return null;
    const d = a.dataset;
    if (d.row !== undefined && d.k) return '[data-row="' + d.row + '"][data-k="' + d.k + '"]';
    if (d.inc !== undefined) return '[data-inc="' + d.inc + '"]';
    if (d.sort) return '[data-sort="' + d.sort + '"]';
    if (d.grip !== undefined) return '[data-grip="' + d.grip + '"]';
    return null;
  }
  const IC_SORT = s => '<svg class="ic so' + (s ? ' on' : '') + '" viewBox="0 0 10 12" aria-hidden="true" focusable="false">' +
    (s !== 'desc' ? '<path d="M5 1.5 8.5 5h-7z" fill="currentColor"' + (s ? '' : ' opacity=".45"') + '/>' : '') +
    (s !== 'asc' ? '<path d="M5 10.5 1.5 7h7z" fill="currentColor"' + (s ? '' : ' opacity=".45"') + '/>' : '') + '</svg>';
  /** Cabecera ordenable: botón real (Enter/Espacio) + tirador SEPARADO en el borde derecho. El tirador es un BOTÓN: arrastrarlo
   *  cambia el ancho; un clic sin arrastre (o Intro / Espacio) abre el microcontrol [ − ] 163 px [ + ] anclado a él. Sin rango ARIA. */
  function impTh(c) {
    const s = IMP.sort && IMP.sort.k === c.k ? IMP.sort.dir : '', lbl = tx(c.l);
    const ttl = s === 'asc' ? tx('Ordenado de forma ascendente. Pulsa para descendente') : s === 'desc' ? tx('Ordenado de forma descendente. Pulsa para volver al orden original') : tx('Ordenar por {_c} (ascendente)', { _c: lbl });
    return '<th class="srt' + (c.nogrip ? ' nogrip' : '') + '" data-colk="' + c.k + '"' + (s ? ' aria-sort="' + (s === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
      '<button type="button" class="imp-sortbtn" data-sort="' + c.k + '" title="' + esc(ttl) + '">' + lbl + IC_SORT(s) + '</button>' +
      (c.nogrip ? '</th>' : '<button type="button" class="imp-colgrip" data-grip="' + c.i + '" aria-expanded="false" aria-controls="imp-colctl" aria-label="' + esc(tx('Ancho de la columna {_c}', { _c: lbl })) + '" title="' + esc(tx('Arrastra para cambiar el ancho; clic, Intro o Espacio para ajustarlo con − / +')) + '"></button></th>');
  }
  /** Anchos: null = automáticos (los de siempre). Al primer ajuste se fijan los anchos actuales de las 11 columnas y la tabla pasa a
   *  diseño fijo; solo cambia la columna tocada. Mínimo de cada columna: su cabecera (texto, flecha y tirador) o su control. */
  function impColFreeze() {
    if (!IMP) return false;
    if (IMP.colW) return true;
    const m = impColMeasure();
    if (!m) return false;
    IMP.colMin = m.min; IMP.colW = m.w.slice();
    impColApply();
    return true;
  }
  /** Anchos actuales de las 11 columnas y mínimo real de cada una (null si no se puede medir). */
  function impColMeasure() {
    const t = $('imp-prev'), ths = Array.from(t.querySelectorAll('thead th'));
    if (ths.length !== IMP_NCOL) return null;
    const w = ths.map(th => th.getBoundingClientRect().width);
    if (!w.every(x => Number.isFinite(x) && x > 0)) return null;
    const px = v => parseFloat(v) || 0;
    const min = ths.map((th, i) => {
      const cs = getComputedStyle(th), b = th.querySelector('.imp-sortbtn');   // el tirador vive en el relleno derecho de la cabecera
      const head = (b ? b.scrollWidth : 0) + px(cs.paddingLeft) + px(cs.paddingRight);
      const td = t.querySelector('tbody tr[data-rid] > td:nth-child(' + (i + 1) + ')'), ctl = td && td.querySelector('input[type=text], select');
      const tcs = td ? getComputedStyle(td) : null, pad = tcs ? px(tcs.paddingLeft) + px(tcs.paddingRight) : 0;
      const ctrl = ctl ? (ctl.tagName === 'SELECT' ? ctl.offsetWidth : px(getComputedStyle(ctl).minWidth)) + pad : 0;
      return Math.min(w[i], Math.ceil(Math.max(head, ctrl)));   // nunca por encima de lo que ya mide: fijar no mueve nada
    });
    return { w, min };
  }
  function impColApply() {
    const t = $('imp-prev'), w = IMP && IMP.colW;
    t.classList.toggle('colfix', !!w);
    t.style.width = w ? w.reduce((s, x) => s + x, 0) + 'px' : '';
    Array.from(t.querySelectorAll('col')).forEach((c, i) => { c.style.width = w ? w[i] + 'px' : ''; });
    impGripAria();
  }
  /** El nombre de cada tirador dice sus valores VERDADEROS: columna, ancho actual y mínimo real (el que se aplica al arrastrar y
   *  con − / +). No hay máximo: no se anuncia ninguno. Sin medidas, queda el nombre sin cifras. */
  function impGripAria() {
    const t = $('imp-prev'), m = IMP && IMP.colW ? { w: IMP.colW, min: IMP.colMin } : IMP ? impColMeasure() : null;
    Array.from(t.querySelectorAll('[data-grip]')).forEach(g => {
      const i = +g.dataset.grip, col = IMP_COLS.find(x => x.i === i), c = col ? tx(col.l) : '', ok = m && Number.isFinite(m.w[i]);
      g.setAttribute('aria-label', ok ? tx('Ancho de la columna {_c}: {n} píxeles (mínimo {m})', { _c: c, n: Math.round(m.w[i]), m: Math.round(m.min[i]) }) : tx('Ancho de la columna {_c}', { _c: c }));
    });
  }
  function impColSet(i, w) {
    if (!IMP || !IMP.colW) return;
    IMP.colW[i] = Math.max(IMP.colMin[i] || 0, w);
    impColApply();
    if (COLCTL.g && COLCTL.i === i) { impColCtlPaint(); impColCtlPlace(); }
  }
  function impColReset() { if (!IMP) return; impColCtlClose(false); IMP.colW = null; IMP.colMin = null; IMP_DRAG = null; impColApply(); }
  // ── Microcontrol del tirador: [ − ] 163 px [ + ] (fuera de la caja que recorta; posición segura: no tapa acciones) ──
  const COLCTL = { g: null, i: -1 };
  function impColCtlOpen(g, kb) {
    if (!IMP || !impColFreeze()) return;
    impColCtlClose(false); cellPopHide(); if (ERRPOP.btn) errPopHide();
    COLCTL.g = g; COLCTL.i = +g.dataset.grip;
    g.setAttribute('aria-expanded', 'true');
    const box = $('imp-colctl'); box.hidden = false;
    impColCtlPaint();
    if (!impColCtlPlace()) { impColCtlClose(false); return; }
    if (kb) { const at = IMP.colW[COLCTL.i] <= (IMP.colMin[COLCTL.i] || 0); const b = box.querySelector('[data-colstep="' + (at ? 1 : -1) + '"]'); if (b && b.focus) b.focus(); }
  }
  function impColCtlClose(back) {
    const g = COLCTL.g; if (!g) return;
    COLCTL.g = null; COLCTL.i = -1;
    if (g.setAttribute) g.setAttribute('aria-expanded', 'false');
    const box = $('imp-colctl'); if (box) box.hidden = true;
    if (back && g.focus && g.isConnected !== false) g.focus();
  }
  /** Valores verdaderos: ancho actual en px; − desactivado (aria-disabled, sigue enfocable) en el mínimo real; + sin máximo. */
  function impColCtlPaint() {
    if (!COLCTL.g || !IMP || !IMP.colW) return;
    const i = COLCTL.i, col = IMP_COLS.find(x => x.i === i), c = col ? tx(col.l) : '', w = IMP.colW[i], min = IMP.colMin[i] || 0, box = $('imp-colctl');
    box.setAttribute('aria-label', tx('Ancho de la columna {_c}', { _c: c }));
    $('imp-colw').textContent = tx('{n} px', { n: Math.round(w) });
    const minus = box.querySelector('[data-colstep="-1"]'), plus = box.querySelector('[data-colstep="1"]');
    if (minus) { minus.setAttribute('aria-label', tx('Estrechar {_c} 16 píxeles', { _c: c })); minus.setAttribute('aria-disabled', w <= min ? 'true' : 'false'); }
    if (plus) plus.setAttribute('aria-label', tx('Ensanchar {_c} 16 píxeles', { _c: c }));
  }
  /** Junto al tirador, dentro de la pantalla y sin tapar el pie ni ningún Excluir / Restaurar (mismas reglas que los detalles). */
  function impColCtlPlace() {
    const box = $('imp-colctl'), g = COLCTL.g; if (!g || !box) return false;
    const r = g.getBoundingClientRect ? g.getBoundingClientRect() : null;
    if (!r || ![r.left, r.top, r.right, r.bottom].every(Number.isFinite)) return true;   // sin medidas (entorno sin maquetación)
    const p = errPopPlace(r, box.offsetWidth || 0, box.offsetHeight || 0, window.innerWidth || 0, errPopSafeH(), 8, cellPopAvoid());
    if (!p) return false;
    box.style.left = Math.round(p.left) + 'px'; box.style.top = Math.round(p.top) + 'px';
    return true;
  }
  /** Lleva el scroll INTERNO de la vista previa hasta la fila (por su id estable): lo justo para verla, bajo la cabecera fija. */
  function impScrollToRid(rid) {
    const w = $('imp-prevwrap'), tr = w && w.querySelector ? w.querySelector('tr[data-rid="' + rid + '"]') : null;
    if (!w || !tr || !tr.getBoundingClientRect || !w.getBoundingClientRect) return;
    const head = w.querySelector('thead'), hh = head && head.getBoundingClientRect ? head.getBoundingClientRect().height || 0 : 0;
    const wr = w.getBoundingClientRect(), r = tr.getBoundingClientRect();
    if (![wr.top, wr.bottom, r.top, r.bottom].every(Number.isFinite)) return;
    if (r.top < wr.top + hh) w.scrollTop -= (wr.top + hh) - r.top;
    else if (r.bottom > wr.top + w.clientHeight) w.scrollTop += r.bottom - (wr.top + w.clientHeight);
  }
  /** Rótulo del estado de orden (visible y anunciado): qué columna y en qué sentido; el orden de importación no cambia. */
  function impSortNote() {
    const n = $('imp-sortnote'); if (!n) return;
    const c = IMP && IMP.sort ? IMP_SORTCOLS.find(x => x.k === IMP.sort.k) : null;
    n.textContent = c ? tx('Vista ordenada por {_c} ({_d}). El orden de importación no cambia.', { _c: tx(c.l), _d: tx(IMP.sort.dir === 'asc' ? 'ascendente' : 'descendente') })
      : IMP && IMP.sortUsed ? tx('Vista en el orden original.') : '';
  }

  function impRender(release) {
    if (ERRPOP.btn) errPopHide();   // la tabla se rehace: el botón del detalle ya no existe
    cellPopHide(); IMP_ED = null; IMP_EDPEND = null; impColCtlClose(false);   // ni detalle, ni editor, ni microcontrol sobreviven al repintado
    IMP_DRAG = null;
    const act = document.activeElement, fkey = impFocusKey(act);
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
      // Sin evento abierto: el nombre se puede poner aquí mismo (vacío = «Evento sin nombre»)
      nh += '<label class="imp-name"><span>' + tx('Nombre del evento') + '</span><input id="imp-name" type="text" maxlength="80" autocomplete="off" spellcheck="false" placeholder="' + esc(tx('Evento sin nombre')) + '" value="' + esc(IMP.name || '') + '"></label>'
        + '<span class="imp-fresh">' + tx('Sin evento abierto: al importar se crea un evento nuevo · {d} (fechas y zonas, luego en Configuración).', { d: esc(d1 === d2 ? d1 : d1 + ' → ' + d2) }) + '</span>';
    }
    if (pv.newStages.length) {
      nh += '<span><b>' + tx(pv.newStages.length === 1 ? '{n} zona nueva:' : '{n} zonas nuevas:', { n: pv.newStages.length }) + '</b></span>' +
        pv.newStages.map(s => { const k = I.norm(s); return '<label><input type="checkbox" data-newstage="' + esc(k) + '"' + (IMP.create[k] === false ? '' : ' checked') + '> ' + tx('crear «{s}»', { s: esc(s) }) + '</label>'; }).join('');
    }
    if (pv.outside.length) nh += '<label><input type="checkbox" id="imp-extend"' + (IMP.extend ? ' checked' : '') + '> ' + tx('<b>Ampliar el evento</b> a {d}', { d: pv.outside.map(fmtDay).map(esc).join(', ') }) + '</label>';
    $('imp-new').innerHTML = nh;
    // Vista previa
    const head = '<colgroup>' + '<col>'.repeat(IMP_NCOL) + '</colgroup><thead><tr><th></th>' + impTh(IMP_STCOL) + IMP_COLS.map(impTh).join('') + '<th>' + tx('Avisos') + '</th></tr></thead>';
    if (!pv.rows.length) {
      $('imp-prev').innerHTML = head + '<tbody><tr><td colspan="11" class="vacio">' + tx(rd.kind === 'vacio' ? 'Pega un horario arriba, elige un archivo .csv / .tsv o añade una fila manual.' : 'No se ha encontrado ninguna fila con hora.') + '</td></tr></tbody>';
    } else {
      const dot = '<svg class="ic dot"><use href="#i-dot"/></svg>';
      const st = { ok: dot + 'OK', warn: dot + tx('Revisar'), err: dot + tx('Error') };
      const inp = (r, k, v, cls) => '<td class="' + (cls || '') + '"><input type="text" data-row="' + r.idx + '" data-k="' + k + '" value="' + esc(v || '') + '" spellcheck="false" autocomplete="off"></td>';
      IMP_PAINT = true;
      try {
      $('imp-prev').innerHTML = head + '<tbody>' + impView(release).map(r =>
        '<tr class="st-' + r.status + (r.include ? '' : ' off') + '" data-rid="' + esc(impRid(r)) + '" title="' + esc(r.raw || '') + '">' +
        // Dec. 155: una fila con error NO lleva casilla (se guarda el hueco): dice su estado y por qué, y se excluye o se restaura
        // con su botón. Al corregirla vuelve la casilla: marcada si estaba pendiente, desmarcada si se excluyó a mano.
        (r.status === 'err' ? '<td class="chk"><span class="sr-only">' + esc(tx(impOff(r) ? 'Excluida a mano: no se importará' : 'Esta fila no se importará')) + '</span></td>'
          : '<td class="chk"><input type="checkbox" data-inc="' + r.idx + '"' + (impOff(r) ? '' : ' checked') + '></td>') +
        '<td class="st">' + (r.status !== 'err' ? st[r.status]
          : impOff(r) ? '<span class="st-x">' + dot + esc(tx('Excluida')) + '</span><div class="why">' + esc(tx('Excluida a mano: no se importará')) + '</div><button type="button" class="linkbtn imp-rowact" data-rest="' + r.idx + '">' + esc(tx('Restaurar')) + '</button>'
          // «Error ⓘ» compacto: el motivo principal en un detalle FLOTANTE único (#imp-errpop, fuera de la tabla: nunca se recorta);
          // el diagnóstico completo sigue en Avisos. aria-expanded refleja siempre si el detalle está a la vista.
          : '<button type="button" class="imp-errbtn" data-errtip="' + r.idx + '" data-why="' + esc(back(r.errs[0] || '')) + '" aria-expanded="false" aria-controls="imp-errpop" aria-label="' +
            esc(tx('Error. Esta fila no se importará. {_m}. Mostrar detalle', { _m: back(r.errs[0] || '').replace(/[.\s]+$/, '') })) + '">' + esc(tx('Error')) + IC_INFO + '</button>' +
            '<button type="button" class="linkbtn imp-rowact" data-exc="' + r.idx + '">' + esc(tx('Excluir')) + '</button>') +
          (r.idx >= IMP.nPaste ? '<span class="man">' + tx('manual') + '</span>' : '') + (r.action === 'duplicada' ? '<div class="hint">' + tx('ya existe') + '</div>' : '') + '</td>' +
        '<td class="tp"><select data-row="' + r.idx + '" data-k="tipo" class="tipo tipo-' + r.tipo + '">' + I.TIPO_KEYS.map(k => '<option value="' + k + '"' + (k === r.tipo ? ' selected' : '') + '>' + tx(I.TIPO_LABEL[k]) + '</option>').join('') + '</select>' +
          (r.tipoWhy ? '<div class="hint" title="' + tx('Tipo propuesto: compruébalo') + '">' + tx('por {w}', { w: esc(r.tipoWhy) }) + '</div>' : '') + '</td>' +
        inp(r, 'escenario', r.escenario, 'e') + inp(r, 'banda', r.banda, 'b') +
        inp(r, 'jornada', r.jornada ? fmtDay(r.jornada) : '') +
        inp(r, 'inicio', r.inicio, 't') + (r.tipo === 'hito' ? '<td class="t"><span class="dash">—</span></td>' : inp(r, 'fin', r.fin, 't')) +
        (r.tipo === 'show' || r.tipo === 'sc' ? inp(r, 'call', r.call, 't') : '<td class="t"><span class="dash">—</span></td>') + inp(r, 'notas', r.notas) +
        '<td class="av">' + r.errs.map(x => '<div class="e">' + esc(back(x)) + '</div>').join('') + r.warns.map(x => '<div>' + esc(back(x)) + '</div>').join('') + '</td></tr>').join('') + '</tbody>';
      } finally { IMP_PAINT = false; }
    }
    impColApply(); impSortNote();
    // El foco sigue en el mismo control (rehecho); si la fila se recoloca al confirmar, el scroll la acompaña
    if (fkey) { const n = $('imp-prev').querySelector(fkey); if (n && n !== act && n.focus) { try { n.focus({ preventScroll: !(release && /data-row/.test(fkey)) }); } catch (e) { n.focus(); } } }
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
    // Filas manuales en el borrador (dec. 155)
    const nm = IMP.manual.length;
    $('imp-man-n').textContent = nm ? tx(nm === 1 ? '{n} fila manual en el borrador' : '{n} filas manuales en el borrador', { n: nm }) : '';
    if (!$('imp-man').hidden) impManJor();
    // Resumen y botón
    const c = pv.counts;
    // Dec. 155: resumen por FILAS (no por avisos), en tres grupos que no se pisan y suman el total del borrador.
    // «Importar» siempre; «Excluidas» y «Error» solo si hay. Los textos son claves de i18n.js (tx), no se escriben aquí.
    const k = impTally(pv.rows, impOff);
    const part = (one, many, n, cls) => '<span class="' + cls + '">' + esc(tx(n === 1 ? one : many, { n: n })) + '</span>';
    $('imp-sum').innerHTML = [part('Importar: {n} fila', 'Importar: {n} filas', k.imp, 's-imp')]
      .concat(k.exc ? [part('Excluidas: {n} fila', 'Excluidas: {n} filas', k.exc, 's-exc')] : [], k.err ? [part('Error: {n} fila', 'Error: {n} filas', k.err, 's-err')] : []).join(' · ');
    // Botón estable («Importar» / «Import»); la cantidad, en su title y aria-label
    const goLbl = tx(c.importar === 1 ? 'Importar: {n} fila' : 'Importar: {n} filas', { n: c.importar });
    $('imp-go').textContent = tx('Importar'); $('imp-go').title = goLbl; $('imp-go').setAttribute('aria-label', goLbl);
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
    const fresh = IMP.fresh, name = fresh ? String(IMP.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    let base = IMP.base;
    if (name) { const ev = C.updateEvent(base, { nombre: name }); if (ev.ok) base = ev.state; }   // nombre escrito en la ventana
    const r = I.apply(base, IMP.pv, { mode: IMP.mode, createStages: IMP.create, extendEvent: IMP.extend });
    IMP_LAST = IMP.pv.rows.filter(x => x.include && x.status !== 'err');
    const used = new Set(IMP.pv.rows.filter(x => x.include && x.status !== 'err').map(x => x.tipo));
    const hidden = hidesSome(CONFIG.mode, used);
    closeImport();
    const impMsg = T => {   // T: tx (aviso, idioma activo) o txEs (Deshacer y log)
      let m = T(r.added === 1 ? 'Importado: {n} entrada nueva' : 'Importado: {n} entradas nuevas', { n: r.added });
      if (r.stagesCreated) m += T(r.stagesCreated === 1 ? ', {n} zona nueva' : ', {n} zonas nuevas', { n: r.stagesCreated });
      if (hidden) m += T(' · Ver: Todo');
      if (fresh && name) return T('Evento «{_e}» creado · {m}', { _e: name, m: m.charAt(0).toLowerCase() + m.slice(1) });
      return fresh ? T('Evento creado · {m}. Ponle nombre en Configuración', { m: m.charAt(0).toLowerCase() + m.slice(1) }) : m;
    };
    const msg = { es: impMsg(txEs), ui: impMsg(tx) };
    if (fresh) loadNew(base, 'Evento creado');   // evento nuevo: la referencia es el evento vacío, así lo importado cuenta como «sin exportar» y se puede deshacer
    // La vista actual («Ver: Shows» / «Ver: Soundchecks») escondería parte de lo importado: se pasa a «Ver: Todo» para ver la foto completa
    if (hidden) CONFIG = Dt.setConfig({ mode: 'all' });
    audioRearm(); mtRearm();   // importar: lo que ya estaba activo en las entradas nuevas no suena (dec. 146; antes de pintar: renderAll lee el estado) ni marca «!»
    commitFestival(r.state, msg);
    // Confirmación clara (2,5 s, en verde) y la tabla arriba para ver el evento recién importado
    toast(importSummary(IMP_LAST, r.added) + (hidden ? tx(' · Ver: Todo') : '') + (fresh && !name ? tx(' · ponle nombre en Configuración') : ''), false, 2500);
    $('toast').classList.add('good');
    const tw = document.querySelector('.tblwrap'); if (tw && tw.scrollTo) tw.scrollTo({ top: 0, behavior: 'smooth' });
    if (r.errors.length) modal('Algunas filas no entraron', '<ul>' + r.errors.map(e => '<li>' + esc(back(e)) + '</li>').join('') + '</ul>', [{ label: 'Entendido', kind: 'primary' }]);
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
  $('imp-new').addEventListener('input', e => { if (IMP && e.target.id === 'imp-name') IMP.name = e.target.value; });
  $('imp-new').addEventListener('keydown', e => { if (e.target.id === 'imp-name' && e.key === 'Enter') { e.preventDefault(); impDoImport(); } });
  $('imp-new').addEventListener('change', e => {
    if (e.target.id === 'imp-name') { if (IMP) IMP.name = e.target.value; return; }
    if (e.target.dataset.newstage) IMP.create[e.target.dataset.newstage] = e.target.checked;
    if (e.target.id === 'imp-extend') IMP.extend = e.target.checked;
    impRecompute();
  });
  // Dec. 155: «Excluir» (fila con error → Excluidas, explícito) y «Restaurar» (vuelve a Error pendiente). Solo el borrador.
  $('imp-prev').addEventListener('click', e => {
    // «Error ⓘ»: el toque (o clic) fija / cierra su detalle. Es el «click» del navegador: un scroll o un arrastre no lo abren.
    // Tirador: clic sin arrastre, Intro o Espacio → microcontrol (abre / cierra). Ratón que se movió = arrastre (no abre). Dedo o
    // lápiz: si el navegador lo da por TOQUE (dispara «click», dentro de su propio margen), se deshace el temblor y se abre.
    let gr = e.target.closest && e.target.closest('[data-grip]');
    if (gr && gr.isConnected === false) gr = $('imp-prev').querySelector('[data-grip="' + gr.dataset.grip + '"]');   // tabla rehecha en este clic
    if (gr && IMP) {
      const gest = IMP_GEST; IMP_GEST = null;
      if (gest && gest.g === gr && gest.moved) { if (gest.pt === 'mouse') return; impColSet(gest.i, gest.w); }
      if (COLCTL.g === gr) impColCtlClose(false); else impColCtlOpen(gr, e.detail === 0);
      return;
    }
    const sb = e.target.closest && e.target.closest('[data-sort]');
    if (sb && IMP) {   // ascendente → descendente → orden original (solo la vista)
      const k = sb.dataset.sort, s = IMP.sort;
      IMP.sort = !s || s.k !== k ? { k, dir: 'asc' } : s.dir === 'asc' ? { k, dir: 'desc' } : null;
      IMP.sortUsed = true; impRender(true); return;
    }
    const tip = e.target.closest && e.target.closest('[data-errtip]');
    if (tip && IMP) {
      const live = tip.isConnected === false ? $('imp-prev').querySelector('[data-errtip="' + tip.dataset.errtip + '"]') : tip;   // tabla rehecha en este clic
      if (!live) return;
      if (ERRPOP.btn === live && ERRPOP.pinned) errPopHide(); else errPopShow(live, true); return;
    }
    const b = e.target.closest && e.target.closest('[data-exc],[data-rest]'); if (!b || !IMP) return;
    const i = +(b.dataset.exc !== undefined ? b.dataset.exc : b.dataset.rest), exc = b.dataset.exc !== undefined;
    // Acción contextual del detalle en línea activada con TECLADO (Enter/Espacio → click con detail 0): la tabla se rehace y el
    // botón desaparece; el foco pasa a la acción nueva de esa misma fila (Restaurar / Excluir) y Tab sigue desde ahí
    const kbCtx = b.id === 'imp-errctx' && e.detail === 0;
    const u = i >= IMP.nPaste && IMP.manual[i - IMP.nPaste] ? IMP.manual[i - IMP.nPaste].uid : null;
    if (u) { if (exc) IMP.mInc[u] = false; else delete IMP.mInc[u]; } else if (exc) IMP.include[i] = false; else delete IMP.include[i];
    impRecompute();
    if (kbCtx) { const n = $('imp-prev').querySelector && $('imp-prev').querySelector('td.st [data-rest="' + i + '"], td.st [data-exc="' + i + '"]'); if (n && n.focus) n.focus(); }
  });
  // El editor ampliado (y el campo compacto que guarda su hueco) confirman al cerrarse el editor, no con su «change» nativo
  $('imp-prev').addEventListener('change', e => { const c = e.target.classList; if (!(c && (c.contains('imp-wide') || c.contains('imp-wsrc')))) impCellChange(e.target); });
  function impCellChange(el) {
    // Fila manual (detrás de las pegadas): su casilla y sus ediciones van por su id
    const man = i => i >= IMP.nPaste && IMP.manual[i - IMP.nPaste] ? IMP.manual[i - IMP.nPaste].uid : null;
    if (el.dataset.inc !== undefined) { const i = +el.dataset.inc, u = man(i); if (u) IMP.mInc[u] = el.checked; else IMP.include[i] = el.checked; impRecompute(); return; }
    if (el.dataset.row === undefined) return;
    const i = +el.dataset.row, u = man(i);
    // Corregir datos nunca deshace una exclusión explícita (false se queda)
    if (u) { IMP.mEdits[u] = Object.assign({}, IMP.mEdits[u]); IMP.mEdits[u][el.dataset.k] = el.value; if (/^(escenario|banda|tipo)$/.test(el.dataset.k) && IMP.mInc[u] !== false) delete IMP.mInc[u]; impRecompute(); return; }
    IMP.edits[i] = IMP.edits[i] || {}; IMP.edits[i][el.dataset.k] = el.value;
    if ((el.dataset.k === 'escenario' || el.dataset.k === 'banda' || el.dataset.k === 'tipo') && IMP.include[i] !== false) delete IMP.include[i];
    impRecompute();
  }
  // Confirmar una edición rehace la tabla: Intro (confirmar y seguir en el mismo campo) y Tab / Shift+Tab (al control siguiente /
  // anterior) apuntan ANTES del repintado al control de destino por su identidad estable y lo enfocan ya redibujado.
  $('imp-prev').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input[type=text], textarea.imp-wide')) return;
    e.preventDefault();   // en el editor ampliado, Intro (también con Mayús) confirma: nunca mete un salto de línea
    const el = e.target, key = impTabKey(el);
    IMP_NOEXP = true;   // confirmado: el foco vuelve al campo COMPACTO (no se reabre el editor hasta que deje de caber al escribir)
    try { el.blur(); if (key && IMP) impFocusTo(key); } finally { IMP_NOEXP = false; }
  });
  $('imp-prev').addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !IMP) return;
    const el = e.target;
    if (!el.matches || !el.matches('tbody input[type=text][data-row], tbody textarea.imp-wide, tbody select[data-row]')) return;
    const list = impTabbables(), at = list.indexOf(el);
    if (at < 0) return;
    const to = list[at + (e.shiftKey ? -1 : 1)];
    if (!to || !(to.closest && to.closest('#imp-prev'))) return;   // fuera de la tabla (o no hay más): orden normal del navegador
    const key = impTabKey(to);
    if (!key) return;
    e.preventDefault();
    el.blur();   // confirma (change → repintado y recolocación si corresponde)
    if (IMP) impFocusTo(key);
  });
  // v20261166 · orden retenido mientras un campo tiene el foco: Intro en el desplegable lo confirma (la fila va a su sitio y el
  // foco la acompaña); salir del campo, también. Si el foco pasa a otro control de la tabla, se recoloca al llegar a él.
  $('imp-prev').addEventListener('keydown', e => {
    if (!IMP) return;
    if (e.key === 'Enter' && IMP.held && e.target.matches && e.target.matches('select[data-row]')) { e.preventDefault(); impRender(true); return; }
  });
  // Microcontrol: − / + (16 px; mínimo real; sin máximo). Esc lo cierra y vuelve al tirador; Tab sigue el orden del tirador.
  $('imp-colctl').addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-colstep]');
    if (!b || !COLCTL.g || !IMP || !IMP.colW || b.getAttribute('aria-disabled') === 'true') return;
    impColSet(COLCTL.i, IMP.colW[COLCTL.i] + (+b.dataset.colstep) * IMP_COL_PASO);
  });
  $('imp-colctl').addEventListener('keydown', e => {
    if (!COLCTL.g) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); impColCtlClose(true); return; }
    if (e.key !== 'Tab') return;
    const box = $('imp-colctl'), first = box.querySelector('[data-colstep="-1"]'), last = box.querySelector('[data-colstep="1"]');
    if (e.shiftKey && e.target === first) { e.preventDefault(); impColCtlClose(true); }
    else if (!e.shiftKey && e.target === last) {   // al siguiente control tras el tirador, en el orden normal
      e.preventDefault(); const g = COLCTL.g, list = impTabbables(), to = list[list.indexOf(g) + 1];
      impColCtlClose(false); if (to && to.focus) to.focus();
    }
  });
  $('imp-colctl').addEventListener('focusout', e => { const to = e.relatedTarget; if (COLCTL.g && to && !(to.closest && to.closest('#imp-colctl')) && to !== COLCTL.g) impColCtlClose(false); });
  document.addEventListener('pointerdown', e => { if (COLCTL.g && !(e.target.closest && (e.target.closest('#imp-colctl') || e.target.closest('[data-grip]') === COLCTL.g))) impColCtlClose(false); }, true);
  window.addEventListener('scroll', e => { if (COLCTL.g && !(e.target && e.target.closest && e.target.closest('#imp-colctl'))) impColCtlClose(false); }, true);
  window.addEventListener('resize', () => { if (COLCTL.g) impColCtlClose(false); });
  // Lectura pasiva (hover): SOLO ratón. En tablet no hay hover ni pulsación larga: un toque edita como siempre.
  $('imp-prev').addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const n = e.target;
    if (impWideK(n) && n !== CELLPOP.inp && n !== document.activeElement && impCut(n)) cellPopShow(n);
  });
  $('imp-prev').addEventListener('pointerout', e => {   // del campo a su detalle (flotante o en línea) no se cierra; a otro sitio, sí
    if (e.pointerType !== 'mouse' || !CELLPOP.inp) return;
    // En línea, el camino del campo a su detalle cruza el resto de su fila: la fila entera cuenta como zona
    const row = CELLPOP.inline && CELLPOP.inp.closest ? CELLPOP.inp.closest('tr') : null;
    const zone = n => n === CELLPOP.inp || inCellPop(n) || !!(row && n && n.closest && n.closest('tr') === row);
    if (zone(e.target) && !zone(e.relatedTarget)) cellPopHide();
  });
  $('imp-cellpop').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && CELLPOP.inp && e.relatedTarget !== CELLPOP.inp) cellPopHide(); });
  document.addEventListener('click', e => { if (CELLPOP.inp && !inCellPop(e.target)) cellPopHide(); });
  window.addEventListener('scroll', e => { if (CELLPOP.inp && !CELLPOP.inline && !inCellPop(e.target)) cellPopHide(); }, true);
  window.addEventListener('resize', () => { if (CELLPOP.inp) cellPopHide(); if (IMP_ED) impEdLayout(); });
  // Editor ampliado: al recibir el foco con el texto recortado, o cuando deja de caber al escribir
  $('imp-prev').addEventListener('pointerdown', e => { IMP_PTR = e.target; });
  document.addEventListener('keydown', () => { IMP_PTR = null; }, true);
  $('imp-prev').addEventListener('focusin', e => {
    const n = e.target;
    if (!impWideK(n)) return;
    cellPopHide();
    if (IMP_NOEXP || IMP_PAINT || !impCut(n)) return;
    // Con ratón o dedo, el navegador sitúa el cursor con el propio clic: se espera a que termine (click / pointerup) y el editor
    // hereda esa posición o selección. Con la selección de un clic ya calculada (tabla rehecha), esa. Con teclado (Tab / Shift+Tab)
    // nunca se hereda el «todo seleccionado» automático: cursor al final, listo para escribir sin borrar nada.
    if (IMP_PTR === n) IMP_EDPEND = n;
    else if (IMP_FOCUSSEL) impEdOpen(n, IMP_FOCUSSEL);
    else {
      const L = String(n.value || '').length, s = impSelOf(n);
      impEdOpen(n, s && s.e > s.s && !(s.s === 0 && s.e === L) ? s : { s: L, e: L, d: 'none' });   // un trozo seleccionado a propósito se respeta
    }
  });
  const impEdPending = () => { const n = IMP_EDPEND; IMP_EDPEND = null; if (n && !IMP_ED && n === document.activeElement && impCut(n)) impEdOpen(n, impSelOf(n)); };
  $('imp-prev').addEventListener('click', e => { if (IMP_EDPEND && e.target === IMP_EDPEND) impEdPending(); });
  document.addEventListener('pointerup', () => { if (!IMP_HOLD && IMP_EDPEND && IMP_EDPEND === document.activeElement) impEdPending(); });   // arrastre para seleccionar que acaba fuera del campo
  // Clic directo en otro campo de texto o Tipo con un editor abierto: se apunta el destino (su identidad) ANTES de que el editor
  // confirme y la tabla se rehaga. Solo campos de texto y Tipo: los botones siguen su camino.
  /** Repinta UNA vez lo ya confirmado. Si el destino del gesto tiene el foco, vuelve a él (redibujado) con su cursor / selección;
   *  si no lo tiene, el foco no se toca. */
  function impHoldRepaint(key, el, always) {
    const on = !!el && el === document.activeElement, sel = on ? impSelOf(el) : null;
    IMP_EDPEND = null;
    if (on && el.blur) el.blur();   // la fila confirmada se recoloca sin foco retenido (como con Tab)
    impRecompute();
    if (IMP && key && (on || always)) impFocusTo(key, sel);
  }
  /** El gesto no va a acabar en el «click» esperado (cancelado, captura perdida, ventana sin foco u oculta, otra tecla u otro
   *  gesto): el repintado pendiente se hace YA, una sola vez (IMP_HOLD se apaga antes). */
  const impHoldFlush = () => {
    if (!IMP_HOLD) return;
    IMP_HOLD = false;
    const key = IMP_CLICKTO, el = IMP_CLICKEL; IMP_CLICKTO = null; IMP_CLICKEL = null;
    if (IMP_PEND) impHoldRepaint(key, el, false);
  };
  document.addEventListener('keydown', impHoldFlush, true);
  document.addEventListener('lostpointercapture', impHoldFlush, true);
  window.addEventListener('blur', impHoldFlush);   // sin captura: solo el blur de la ventana (el de un campo no sube hasta aquí)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') impHoldFlush(); });
  document.addEventListener('pointerdown', e => {
    impHoldFlush();
    IMP_CLICKTO = null; IMP_CLICKEL = null;
    const n = e.target;
    if (!IMP_ED || n === IMP_ED.ta || !n.matches) return;
    // Otro campo de texto o Tipo: el editor confirma, pero la tabla no se rehace hasta que el navegador haya puesto el cursor (o la
    // selección) del clic en ese campo; entonces se guarda su identidad + selección, se repinta y se restaura exactamente
    if (n.matches('#imp-prev tbody input[type=text][data-row], #imp-prev tbody select[data-row]')) { IMP_CLICKTO = impTabKey(n); IMP_CLICKEL = n; IMP_HOLD = true; }
    // Botón o casilla de la tabla (Excluir, Restaurar, casilla, Error ⓘ, cabeceras, tiradores): el editor confirma, pero la tabla
    // espera a que termine el clic. Nada de esto toca el foco ni el clic: el botón hace lo suyo al primer clic.
    else if (n.closest && n.closest('#imp-prev') && n.closest('button, input[type=checkbox]') && !n.closest('[data-grip]')) IMP_HOLD = true;   // el tirador no quita el foco
  }, true);
  document.addEventListener('click', e => {
    if (!IMP_HOLD) return;
    IMP_HOLD = false;
    if (IMP_CLICKTO) {   // el clic acabó: el cursor / la selección del destino ya son los del navegador
      const key = IMP_CLICKTO, el = IMP_CLICKEL; IMP_CLICKTO = null; IMP_CLICKEL = null; IMP_HOLDOWN = true;
      const on = !!el && el === document.activeElement, sel = on ? impSelOf(el) : null;
      if (!IMP_PEND) { if (on && IMP_EDPEND === el) impEdPending(); return; }   // nada que repintar: el campo sigue siendo el mismo
      impHoldRepaint(key, el, true);   // el clic llegó: el foco vuelve al destino con lo que puso el navegador
      return;
    }
    const n = e.target;
    // Excluir / Restaurar / casilla rehacen la tabla ellos mismos (con el dato ya confirmado); el resto la ve rehecha antes
    IMP_HOLDOWN = !!(n && n.closest && n.closest('[data-exc], [data-rest], [data-inc]'));
    if (IMP_PEND && !IMP_HOLDOWN) impRecompute();
  }, true);
  document.addEventListener('click', () => { if (IMP_PEND && !IMP_HOLDOWN) impRecompute(); IMP_HOLDOWN = false; });
  document.addEventListener('pointercancel', impHoldFlush, true);
  $('imp-prev').addEventListener('input', e => {
    const n = e.target;
    if (IMP_ED && n === IMP_ED.ta) {   // un dato de una línea: lo pegado con saltos se queda en una línea
      if (/[\r\n]/.test(n.value)) { const p = n.selectionStart; n.value = n.value.replace(/\r\n?|\n/g, ' '); try { n.setSelectionRange(p, p); } catch (err) {} }
      impEdLayout(); return;
    }
    if (impWideK(n) && n === document.activeElement && !IMP_ED && impCut(n)) impEdOpen(n, { s: n.selectionStart, e: n.selectionEnd });
  });
  $('imp-prev').addEventListener('focusout', e => { if (!IMP_PAINT && IMP_ED && e.target === IMP_ED.ta) impEdClose(); });
  $('imp-prev').addEventListener('focusout', e => {
    if (IMP_PAINT || !IMP || !IMP.held || !(e.target.matches && e.target.matches('tbody [data-row]'))) return;
    const to = e.relatedTarget;
    if (to && to.closest && to.closest('#imp-prev')) IMP.resortIn = true; else impRender(true);
  });
  $('imp-prev').addEventListener('focusin', () => { if (!IMP_PAINT && IMP && IMP.resortIn) { IMP.resortIn = false; impRender(true); } });
  // Tirador: SOLO un arrastre que empieza en él cambia el ancho (touch-action: none en el tirador; el resto de la tabla hace
  // scroll como siempre). Con captura del puntero; un clic o un toque en el texto de la cabecera ordena, en el tirador no.
  $('imp-prev').addEventListener('pointerdown', e => {
    const g = e.target.closest && e.target.closest('[data-grip]');
    if (!g || !IMP || (e.pointerType === 'mouse' && e.button !== 0) || !impColFreeze()) return;
    e.preventDefault();
    const i = +g.dataset.grip;
    IMP_DRAG = { id: e.pointerId, i, x: e.clientX, w: IMP.colW[i], g, pt: e.pointerType, moved: false };
    try { g.setPointerCapture(e.pointerId); } catch (err) {}
    if (g.classList) g.classList.add('drag');
  });
  $('imp-prev').addEventListener('pointermove', e => {
    if (!IMP_DRAG || e.pointerId !== IMP_DRAG.id) return;
    if (e.clientX !== IMP_DRAG.x) { if (!IMP_DRAG.moved) impColCtlClose(false); IMP_DRAG.moved = true; }
    impColSet(IMP_DRAG.i, IMP_DRAG.w + e.clientX - IMP_DRAG.x);
  });
  let IMP_GEST = null;   // el último gesto sobre un tirador (para distinguir clic de arrastre)
  const impDragEnd = e => { if (!IMP_DRAG || e.pointerId !== IMP_DRAG.id) return; if (IMP_DRAG.g.classList) IMP_DRAG.g.classList.remove('drag'); IMP_GEST = IMP_DRAG; IMP_DRAG = null; };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => $('imp-prev').addEventListener(t, impDragEnd));
  $('imp-colreset').addEventListener('click', impColReset);
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
    if (f) $('drift').insertAdjacentHTML('afterbegin', '<span class="dchip msg"><svg class="ic"><use href="#i-msg"/></svg>' + (f.to || f.zones ? esc(tgtUi(f.to, f.zones)) : 'Live') + ': ' + (f.by ? esc(Vs.byLabel(f.by)) + ' ' : '') + '«' + esc(f.text) + '»<button class="chipx" data-act="msg-off" title="' + tx('Retirar el mensaje') + '">' + tx('Retirar') + '</button></span>');
    // Columna izquierda (lo que hay en la Live): tarjeta del mensaje con su aspecto real y el botón para quitarlo
    const card = $('card-msg');
    card.hidden = !f;
    if (!f) { card.dataset.id = ''; return; }
    if (card.dataset.id !== f.id) {
      card.dataset.id = f.id;
      const bg = f.bg || '#000000', fg = f.fg || '#ffb347';
      $('v-msg').innerHTML = '<div class="msg-live" style="--mbg:' + bg + ';--mfg:' + fg + '">' + (f.by ? '<small class="msg-by">' + esc(Vs.byLabel(f.by)) + '</small>' : '') + esc(f.text.toUpperCase()) + '</div>'
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
  /** Dec. 151–153 · avisos del tiempo: siempre TRES avisos consecutivos completos a la vista (aunque ocupen varias líneas) y,
   *  desde el cuarto, scroll dentro de la lista. El alto es el del grupo de tres consecutivos más alto, medido tal y como se
   *  pinta (idioma, estilo y ancho reales), nunca una cifra fija: ningún aviso posterior más alto queda cortado al llegar a él.
   *  El resumen y el pie no se tocan. L: la lista (por defecto, la de la tarjeta). */
  const MT_VIS = 3;
  function fitMtAlerts(L) {
    L = L || mtList();
    if (!L || !L.children) return null;
    const items = Array.from(L.children);
    L.classList.toggle('scroll', items.length > MT_VIS);   // primero el hueco de la barra: así se mide con el ancho que tendrá
    if (items.length <= MT_VIS) { L.style.maxHeight = ''; return null; }
    // medidas con decimales (getBoundingClientRect): con offsetTop/offsetHeight, redondeados, un aviso podía quedar 1 px cortado
    const top = x => x.getBoundingClientRect ? x.getBoundingClientRect().top : x.offsetTop, bot = x => x.getBoundingClientRect ? x.getBoundingClientRect().bottom : x.offsetTop + x.offsetHeight;
    let h = 0;
    for (let i = 0; i + MT_VIS - 1 < items.length; i++) h = Math.max(h, bot(items[i + MT_VIS - 1]) - top(items[i]));
    if (!(h > 0)) return null;   // tarjeta oculta: se medirá cuando se vea
    L.style.maxHeight = Math.ceil(h) + 'px';
    return Math.ceil(h);
  }
  function mtList() { return $('v-meteo').querySelector && $('v-meteo').querySelector('.mt-alerts'); }
  // ── Dec. 153 · scroll manual conservado por ANCLA SEMÁNTICA (no por píxeles): el aviso visible de arriba (su data-id) y
  //    cuánto asoma. Se guarda al hacer scroll y antes de repintar; después de repintar o de cambiar el alto de los avisos
  //    (idioma, Studio / Stage, ancho) se vuelve a poner ese aviso en el mismo sitio. Sin ancla (arriba del todo): nada.
  let MT_ANCHOR = null;   // { id, delta, next: [ids de debajo], px }
  const mtTopIn = (L, it) => it.getBoundingClientRect && L.getBoundingClientRect ? it.getBoundingClientRect().top - L.getBoundingClientRect().top + (L.scrollTop || 0) : it.offsetTop;
  const mtBotIn = (L, it) => it.getBoundingClientRect && L.getBoundingClientRect ? it.getBoundingClientRect().bottom - L.getBoundingClientRect().top + (L.scrollTop || 0) : it.offsetTop + it.offsetHeight;
  function mtAnchorSave(L) {
    L = L || mtList();
    if (!L || !L.children) return;
    const st = L.scrollTop || 0, items = Array.from(L.children);
    if (st <= 0) { MT_ANCHOR = null; return; }
    const i = items.findIndex(it => mtBotIn(L, it) > st);
    if (i < 0 || !items[i].dataset || !items[i].dataset.id) { MT_ANCHOR = null; return; }
    MT_ANCHOR = { id: items[i].dataset.id, delta: mtTopIn(L, items[i]) - st, next: items.slice(i + 1).map(x => x.dataset && x.dataset.id), px: st };
  }
  function mtAnchorApply(L) {
    L = L || mtList();
    if (!MT_ANCHOR || !L || !L.children) return;
    const items = Array.from(L.children), byId = id => items.find(x => x.dataset && x.dataset.id === id);
    const max = Math.max(0, (L.scrollHeight || 0) - (L.clientHeight || 0));
    let it = byId(MT_ANCHOR.id), target;
    if (it) target = mtTopIn(L, it) - MT_ANCHOR.delta;
    else {   // el aviso ancla ya no está: el siguiente que siga en la lista, arriba del todo; si no queda ninguno, los píxeles de antes
      const nx = MT_ANCHOR.next.map(byId).find(Boolean);
      target = nx ? mtTopIn(L, nx) : MT_ANCHOR.px;
    }
    target = Math.max(0, Math.min(max, target));
    if (Math.abs((L.scrollTop || 0) - target) >= 1) L.scrollTop = target;
  }
  /** Medir y mantener el ancla (cada tick, al cambiar el ancho o el estilo). */
  function mtLayout() { const L = mtList(); fitMtAlerts(L); mtAnchorApply(L); }
  // Cambia el ancho (ventana, columnas) o la tarjeta pasa a verse: se vuelve a medir
  if (typeof ResizeObserver === 'function') { try { new ResizeObserver(() => mtLayout()).observe($('v-meteo')); } catch (e) {} }
  window.addEventListener('resize', () => mtLayout());
  $('v-meteo').addEventListener('scroll', e => { if (e.target && e.target.classList && e.target.classList.contains('mt-alerts')) mtAnchorSave(e.target); }, true);
  /** Dec. 152: la próxima lectura de avisos solo fija la referencia (sin hora, «!» ni salto): carga, importación, otro evento,
   *  otra fuente, Meteo apagado. */
  function mtRearm() { MT_ORDER = null; MT_NEW.clear(); MT_CLEAN = true; MT_SAVED = ''; try { localStorage.removeItem(MT_ORD_KEY); } catch (e) {} }
  /** Cronología guardada para este contexto (evento + fuente Meteo); null si no hay o es de otro contexto. */
  function mtLoadOrder(ctx) {
    try {
      const o = JSON.parse(localStorage.getItem(MT_ORD_KEY) || 'null');
      if (!o || o.ctx !== ctx || !Array.isArray(o.order)) return null;
      const seen = new Set();
      return o.order.filter(e => e && typeof e.id === 'string' && !seen.has(e.id) && seen.add(e.id)).map(e => ({ id: e.id, at: Number.isFinite(e.at) ? e.at : null }));
    } catch (e) { return null; }
  }
  function mtSaveOrder(ctx) {
    const s = JSON.stringify({ ctx, order: MT_ORDER });
    if (s === MT_SAVED) return;
    MT_SAVED = s; try { localStorage.setItem(MT_ORD_KEY, s); } catch (e) {}
  }
  /** Identidad estable de cada aviso de una lectura: su tipo (W.alerts da uno por tipo); si algún día hubiera dos del mismo
   *  tipo, «tipo#2», «tipo#3»… en su orden. */
  function mtIds(list) { const n = {}; return list.map(a => { n[a.kind] = (n[a.kind] || 0) + 1; return n[a.kind] > 1 ? a.kind + '#' + n[a.kind] : a.kind; }); }
  const mtRowHead = id => ' data-id="' + esc(id) + '"><svg class="ic"><use href="#i-alert"/></svg>';
  const mtFresh = () => '<span class="mt-fresh" role="img" aria-label="' + esc(tx('Aviso recién llegado')) + '">!</span>';
  /** Quita el «!» de un aviso (hover o toque). Solo la pista visual local: no es «Visto», no toca el estado meteo, los datos
   *  compartidos ni el log. Sin repintar la tarjeta (sin parpadeo): se quita ese elemento y el HTML guardado queda igual que
   *  el que saldrá en el próximo repintado. No vuelve a salir. */
  function mtFreshOff(id, al) {
    if (!MT_NEW.delete(id)) return;
    const b = al && al.querySelector && al.querySelector('.mt-fresh'); if (b && b.remove) b.remove();
    MT_HTML = MT_HTML.split(mtRowHead(id) + mtFresh()).join(mtRowHead(id));
  }
  /** Un único scroll al final de la lista para que el aviso recién llegado (siempre el último) se vea entero (desde el cuarto). */
  function mtJump(L) {
    if (!L || !L.children || L.children.length <= MT_VIS) return;
    L.scrollTop = Math.max(0, (L.scrollHeight || 0) - (L.clientHeight || 0));
    mtAnchorSave(L);   // a partir de aquí, se conserva esta posición
  }
  /** Tarjeta METEO (columna izquierda, bajo CALL). */
  function renderMeteo() {
    const card = $('card-meteo');
    const st = meteoState(), c = st.c;
    card.hidden = !c.on;
    if (!c.on) { MT_HTML = ''; if (!MT_CLEAN || MT_ORDER) mtRearm(); return st; }   // apagado: al reactivar, referencia limpia
    const sig = (FEST && window.ShowtimeLog ? window.ShowtimeLog.eventKey(FEST) : '') + '|' + mtKey(c);   // contexto: evento + fuente
    if (sig !== MT_SIG) { MT_SIG = sig; MT_ORDER = null; MT_NEW.clear(); }   // otro contexto: lo guardado de otro no vale (referencia limpia)
    let jump = false;
    const ids = mtIds(st.list), byId = {}; ids.forEach((id, i) => { byId[id] = st.list[i]; });
    if (st.sum) {   // dec. 152: orden por llegada. Aviso real nuevo = una identidad que no estaba en la lectura anterior
      if (!MT_ORDER) {   // primera lectura: la cronología guardada de ESTE contexto (recarga) o, sin ella, solo referencia
        const saved = MT_CLEAN ? null : mtLoadOrder(sig);
        MT_CLEAN = false;
        // los que siguen activos conservan orden y hora; los que se fueron mientras tanto, fuera; los que no constan, sin hora
        MT_ORDER = saved ? saved.filter(e => byId[e.id]) : [];
        ids.forEach(id => { if (!MT_ORDER.some(e => e.id === id)) MT_ORDER.push({ id, at: null }); });
      } else {
        MT_ORDER = MT_ORDER.filter(e => byId[e.id]);   // el que se va sale de la lista (si vuelve, entrada nueva)
        const now = Date.now();
        ids.forEach(id => { if (!MT_ORDER.some(e => e.id === id)) { MT_ORDER.push({ id, at: now }); MT_NEW.add(id); jump = true; } });
      }
      MT_NEW.forEach(id => { if (!byId[id]) MT_NEW.delete(id); });
      mtSaveOrder(sig);
    }
    let h = '';
    const where = c.source === 'openmeteo' ? (c.place || (c.lat !== null ? c.lat + ', ' + c.lon : '')) : tx(MT_SRC[c.source]);
    if (!st.sum) {
      const need = c.source === 'openmeteo' && (c.lat === null || c.lon === null) ? 'Elige el lugar del evento' : c.source === 'url' && !c.url ? 'Falta la URL de la estación' : c.source === 'manual' ? 'Escribe los valores' : '';
      h = '<div class="mt-none">' + (need ? esc(tx(need)) + ' ' + tx('en') + ' <button class="linkbtn" data-act="mt-cfg">' + tx('Configuración › Meteo') + '</button>' : (st.m && st.m.err ? tx('SIN DATOS') + ' · ' + esc(tx(st.m.err)) : tx('Cargando…'))) + '</div>';
    } else {
      const s = st.sum;
      const U = c.units;   // unidades (dec. 107): métrico o imperial, solo al enseñar
      h += '<div class="mt-now' + (s.stale ? ' stale' : '') + '"><svg class="ic mt-sky"><use href="#i-' + s.icon + '"/></svg><span class="mt-t">' + (s.temp === null ? '—' : W.numU('temp', s.temp, U) + '°') + '</span><span class="mt-sk">' + esc(s.sky || '') + (where ? '<small>' + esc(where) + '</small>' : '') + '</span></div>';
      const sn = W.sunNext(st.snap, Date.now());
      if (sn) {
        const fmt = t => { const tm = new Date(t), tomorrow = tm.toDateString() !== new Date().toDateString(); return '<b>' + W.hhmm(t) + '</b>' + (tomorrow ? ' <small>' + tx('mañana') + '</small>' : ''); };
        h += '<div class="mt-sun"><svg class="ic"><use href="#i-sun"/></svg>' + (sn.rise !== null ? tx('Amanece') + ' ' + fmt(sn.rise) : '') + (sn.rise !== null && sn.set !== null ? ' · ' : '') + (sn.set !== null ? tx('Se pone') + ' ' + fmt(sn.set) : '') + '</div>';
      }
      if (s.stale) h += '<div class="mt-stale"><svg class="ic"><use href="#i-alert"/></svg>' + esc(s.staleTxt) + (st.m && st.m.err ? '<small>' + esc(tx(st.m.err)) + '</small>' : '') + '</div>';
      h += '<div class="mt-grid">' +
        '<span><svg class="ic"><use href="#i-drop"/></svg>' + tx('Lluvia') + ' <b>' + W.numU('rain', s.rain, U) + '</b> ' + W.unitOf('rain', U) + '</span>' +
        '<span><svg class="ic"><use href="#i-wind"/></svg>' + tx('Viento') + ' <b>' + W.numU('wind', s.wind, U) + '</b> ' + W.unitOf('wind', U) + '</span>' +
        '<span class="mt-gmax"><svg class="ic"><use href="#i-wind"/></svg>' + tx('Ráfagas máx.') + ' <b>' + W.numU('wind', s.gustMax !== null ? s.gustMax : s.gust, U) + '</b> ' + W.unitOf('wind', U) +
          (s.gustMaxAt ? ' <small>· ' + W.hhmm(s.gustMaxAt) + '</small>' : '') + (st.snap.hours.length ? ' <small>' + tx('(próx. {n} h)', { n: s.horizon }) + '</small>' : ' <small>' + tx('(ahora)') + '</small>') + '</span>' +
        (s.uv !== null || s.uvMax !== null ? '<span><svg class="ic"><use href="#i-sun"/></svg>UV <b>' + mtNum(s.uvMax !== null ? s.uvMax : s.uv) + '</b> ' + W.uvText(s.uvMax !== null ? s.uvMax : s.uv) + '</span>' : '') +
        (c.th.aqiOn && s.aqi !== null ? '<span><svg class="ic"><use href="#i-cloud"/></svg>' + tx('Aire') + ' <b>' + W.aqiText(s.aqi) + '</b></span>' : '') +
        '</div>';
      const rows = (MT_ORDER || ids.map(id => ({ id, at: null }))).filter(e => byId[e.id]).map(e => ({ e, a: byId[e.id] }));
      if (rows.length) h += '<div class="mt-alerts">' + rows.map(({ e, a }) => '<div class="mt-al' + (st.pending.indexOf(a) >= 0 ? ' new' : '') + '"' + mtRowHead(e.id) + (MT_NEW.has(e.id) ? mtFresh() : '') +
        (e.at ? '<time class="mt-at" title="' + esc(tx('Detectado a las {h}', { h: W.hhmm(e.at) })) + '">' + W.hhmm(e.at) + '</time>' : '') + '<span>' + esc(a.text) + '</span>' +
        (st.pending.indexOf(a) >= 0 ? '<button class="chipx" data-act="mt-ack" data-k="' + a.kind + '">' + tx('Visto') + '</button>' : '<small>' + tx('visto') + '</small>') + '</div>').join('') + '</div>';
      h += '<div class="mt-foot">' + esc(tx(MT_SRC[s.src] || '')) + ' · ' + tx('dato {h} · previsión, no aviso oficial', { h: W.hhmm(s.at) }) + ' · <a href="' + W.AEMET_URL + '" target="_blank" rel="noopener">' + tx('Avisos AEMET') + '<svg class="ic"><use href="#i-ext"/></svg></a></div>';
    }
    if (h !== MT_HTML) {
      if (!jump) mtAnchorSave();   // dec. 153: el aviso visible de arriba y cuánto asoma (no los píxeles)
      MT_HTML = h; $('v-meteo').innerHTML = h;
      const L1 = mtList();
      fitMtAlerts(L1);
      if (L1 && jump) mtJump(L1);   // dec. 152: solo cuando entra un aviso real nuevo; entonces no se conserva el scroll anterior
      else mtAnchorApply(L1);
    } else mtLayout();   // cada segundo: un cambio de estilo (Studio / Stage) o de letra también cambia el alto de los avisos
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
  // Dec. 152/153: el «!» se quita con el ratón encima del aviso, o con un TOQUE completo de un dedo (táctil o lápiz) sobre una
  // zona del aviso que no sea botón ni enlace. Toque = el ciclo real de pointer: down y up del MISMO dedo, sin otro dedo en
  // medio (pellizco), sin pointercancel (el navegador empieza un scroll o un gesto), sin scroll de la lista o la página entre
  // medias, y soltando dentro del mismo aviso. pointerdown solo no confirma nada. Sin umbrales propios de tiempo ni distancia.
  $('v-meteo').addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const al = e.target.closest && e.target.closest('.mt-al'); if (al && al.dataset.id) mtFreshOff(al.dataset.id, al);
  });
  // Dec. 154: al bajar sobre un aviso con «!» la tarjeta CAPTURA el puntero (setPointerCapture): el up llega aquí aunque se
  // suelte fuera. Limpieza idempotente en pointerup, pointercancel y lostpointercapture, y un respaldo global (window) que
  // solo limpia, nunca confirma: ningún pointerId queda colgado y el siguiente toque válido funciona.
  // Botones y enlaces («Visto», AEMET) no se capturan ni cuentan: su clic sigue llegando a ellos.
  const MT_V = $('v-meteo');
  const MT_TOUCH = new Set();   // dedos apoyados ahora mismo sobre la tarjeta
  let MT_TAP = null;            // { pid, id, al, cap } candidato a toque
  function mtTapOff() { MT_TAP = null; }
  /** Fin del ciclo de un puntero (up, cancel, pérdida de captura o respaldo global). Se puede llamar varias veces. */
  function mtTapEnd(pid) {
    MT_TOUCH.delete(pid);
    const t = MT_TAP; if (!t || t.pid !== pid) return;
    MT_TAP = null;
    try { if (t.cap && MT_V.hasPointerCapture && MT_V.hasPointerCapture(pid)) MT_V.releasePointerCapture(pid); } catch (e) {}
  }
  /** El aviso con ese data-id tal y como está pintado AHORA (un repintado durante el toque cambia el elemento). */
  function mtAlById(id) { const all = MT_V.querySelectorAll ? Array.from(MT_V.querySelectorAll('.mt-al')) : []; return all.find(x => x.dataset && x.dataset.id === id) || null; }
  MT_V.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    MT_TOUCH.add(e.pointerId);
    if (MT_TOUCH.size > 1) { MT_TAP = null; return; }   // multitáctil (pellizco): nada
    const al = e.target.closest && !e.target.closest('button, a') && e.target.closest('.mt-al');
    if (!(al && al.dataset && al.dataset.id && MT_NEW.has(al.dataset.id))) { MT_TAP = null; return; }
    MT_TAP = { pid: e.pointerId, id: al.dataset.id, al, cap: false };
    try { if (MT_V.setPointerCapture) { MT_V.setPointerCapture(e.pointerId); MT_TAP.cap = true; } } catch (err) {}
  });
  MT_V.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    const t = MT_TAP, solo = MT_TOUCH.size === 1 && MT_TOUCH.has(e.pointerId);
    mtTapEnd(e.pointerId);
    if (!t || !solo || t.pid !== e.pointerId) return;
    const al = mtAlById(t.id) || t.al, r = al.getBoundingClientRect ? al.getBoundingClientRect() : null;
    if (!r || !(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) return;   // soltó fuera: arrastre
    mtFreshOff(t.id, al);
  });
  MT_V.addEventListener('pointercancel', e => { mtTapEnd(e.pointerId); mtTapOff(); });
  MT_V.addEventListener('lostpointercapture', e => mtTapEnd(e.pointerId));
  window.addEventListener('pointerup', e => mtTapEnd(e.pointerId));       // respaldo: solo limpia (va después del de la tarjeta)
  window.addEventListener('pointercancel', e => { mtTapEnd(e.pointerId); mtTapOff(); });
  MT_V.addEventListener('scroll', mtTapOff, true);   // la lista se mueve entre down y up: era un scroll
  window.addEventListener('scroll', mtTapOff, true);

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
    // Valores manuales y umbrales: se enseñan en la unidad elegida; por dentro siguen en métrico (dec. 107)
    set($('mt-units'), c.units);
    document.querySelectorAll('#cfg-s-meteo .mt-u').forEach(el => { el.textContent = W.unitOf(el.dataset.u, c.units); });
    document.querySelectorAll('#cfg-s-meteo [data-mn]').forEach(el => set(el, mtIn(MT_KIND[el.dataset.mn], c.manual[el.dataset.mn], c.units)));
    document.querySelectorAll('#cfg-s-meteo [data-th]').forEach(el => set(el, el.dataset.th === 'aqi' ? String(c.th.aqi) : el.type === 'checkbox' ? c.th[el.dataset.th] : mtIn(MT_KIND[el.dataset.th], c.th[el.dataset.th], c.units)));
    document.querySelectorAll('#cfg-s-meteo .mt-g').forEach(g => { g.hidden = g.dataset.src !== c.source; });
    document.querySelectorAll('#cfg-s-meteo .mt-auto').forEach(el => { el.hidden = c.source === 'manual'; });
    $('mt-place').textContent = c.place ? c.place + (c.lat !== null ? ' · ' + c.lat + ', ' + c.lon : '') : '';
    $('mt-aemet').href = W.AEMET_URL;
    fillMeteoStatus();
  }
  // Casillas en la unidad elegida: si no se ha tocado la cifra, se queda el valor guardado (sin redondeos de ida y vuelta)
  const MT_KIND = { temp: 'temp', heat: 'temp', rain: 'rain', wind: 'wind', gust: 'wind', uv: null };
  function mtIn(kind, v, units) {
    if (v === null || v === undefined) return '';
    if (!kind) return v;
    const x = W.toU(kind, v, units), d = kind === 'rain' ? (units === 'imperial' ? 2 : 1) : kind === 'temp' ? 1 : 0;
    return String(Number(x.toFixed(d)));
  }
  function mtOut(kind, raw, stored, units) {
    if (raw === '' || raw === null || raw === undefined) return null;
    if (kind && String(raw) === mtIn(kind, stored, units)) return stored;
    const n = Number(raw);
    return kind ? W.fromU(kind, n, units) : n;
  }
  function readMeteoCfg(extra) {
    const c = JSON.parse(JSON.stringify(mtCfg()));
    // Unidades: lo PRIMERO que se lee es el selector (lo que ve el regidor manda). Las casillas se leen en la unidad que tenían.
    const unitsNow = $('mt-units') && W.UNITS.indexOf($('mt-units').value) >= 0 ? $('mt-units').value : c.units;
    c.on = $('mt-on').checked; c.source = $('mt-src').value;
    c.lat = $('mt-lat').value; c.lon = $('mt-lon').value; c.url = $('mt-url').value.trim();
    c.refresh = Number($('mt-ref').value); c.horizon = Number($('mt-hz').value);
    document.querySelectorAll('#cfg-s-meteo [data-mp]').forEach(el => { c.map[el.dataset.mp] = el.value.trim(); });
    let manualChanged = false;
    const U = c.units;   // lo escrito está en la unidad que había; la nueva solo cambia cómo se enseña
    document.querySelectorAll('#cfg-s-meteo [data-mn]').forEach(el => { const k = el.dataset.mn, v = mtOut(MT_KIND[k], el.value, c.manual[k], U); if (v !== c.manual[k]) manualChanged = true; c.manual[k] = v; });
    if (manualChanged) c.manual.at = Date.now();
    document.querySelectorAll('#cfg-s-meteo [data-th]').forEach(el => { const k = el.dataset.th; c.th[k] = el.type === 'checkbox' ? el.checked : k === 'aqi' ? Number(el.value) : mtOut(MT_KIND[k], el.value, c.th[k], U); });
    c.units = unitsNow;
    return Object.assign(c, extra || {});
  }
  function saveMeteo(extra) {
    const before = mtCfg(), raw = readMeteoCfg(extra), next = W.normMeteo(raw);
    next.units = raw.units === 'imperial' ? 'imperial' : 'metric';   // atómico: la unidad elegida se guarda tal cual, en el mismo paso
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
  let RM_ZONE = null;       // QR del mando que se enseña: null = general (todas las zonas) · id = mando de esa zona (dec. 102)
  let EM_CLOSED = null;     // jornada cerrada a mano para los QR («Cerrar jornada», dec. 105): fecha o null
  let EM_DAY = null;        // última jornada emitida (si cambia, se vuelve a emitir)
  function emLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(EM_KEY) || 'null');
      if (!v || !Em || !Em.validRoom(v.room)) return null;
      if (!v.room.c) { v.room = Em.withCmdKey(v.room); localStorage.setItem(EM_KEY, JSON.stringify(v)); }   // sala de la 2d-A: se le añade la clave del mando
      if (!v.room.q) { v.room = Em.withProdKey(v.room); localStorage.setItem(EM_KEY, JSON.stringify(v)); }   // sala anterior: se le añade la clave propia de Producción
      EM_CLOSED = typeof v.closed === 'string' ? v.closed : null;
      return v;
    } catch (e) { return null; }
  }
  function emSave(on) { try { localStorage.setItem(EM_KEY, JSON.stringify({ room: emRoom, on: !!on, closed: EM_CLOSED })); } catch (e) {} }
  // ── «Solo hoy» (dec. 105): a los QR solo viaja la jornada activa del Panel (la elegida; con «Todos los días», la del reloj) ──
  function emDay() {
    if (!FEST) return null;
    const cfg = Dt.getConfig(), d = cfg && cfg.day && cfg.day !== 'all' ? cfg.day : C.activeJornada(FEST, Math.floor(C.nowAbs()));
    return C.dayIndex(d) === null ? null : d;
  }
  function emSnapshot() {
    const s = Dt.getSnapshot(), day = emDay();
    EM_DAY = day;
    if (!s.festival || !day) return s;
    const closed = EM_CLOSED === day, f = C.scopeToJornada(s.festival, day);
    if (closed) { f.artists = []; f.showtimeRetrasos = []; }   // cerrada: no viaja ni una entrada
    return Object.assign({}, s, { festival: f, config: Object.assign({}, s.config, { day }), scope: { day, closed } });
  }
  /** Cerrar / reabrir la jornada en los QR (Staff, Camerinos, Producción y mando): enseñan «Jornada finalizada». Se reabre sola al cambiar de jornada. */
  function emCloseDay(on) {
    const day = emDay(); if (!day) return;
    EM_CLOSED = on ? day : null; emSave(!!EM);
    if (EM) EM.push(0);
    logEvent('msg', (on ? 'Jornada cerrada en los QR: ' : 'Jornada reabierta en los QR: ') + day, { src: 'panel' });
    toast(on ? 'Jornada cerrada: los dispositivos QR muestran «Jornada finalizada»' : 'Jornada reabierta en los dispositivos QR');
    renderCast();
  }
  // La jornada de los QR cambia con el reloj (hora de corte) o al elegir otro día en el Panel: se vuelve a emitir
  setInterval(() => { if (EM && emDay() !== EM_DAY) EM.push(0); }, 15000);
  /** Mandos por zona (dec. 102): cada zona del evento tiene su clave. Se crean al emitir (y al añadir zonas). */
  function rmZones() { return FEST ? (FEST.escenarios || []).map(z => ({ id: z.id, name: z.nombre, color: z.color })) : []; }
  function emZoneKeys() {
    if (!emRoom) return;
    const next = Em.withZoneKeys(emRoom, rmZones().map(z => z.id));
    if (next === emRoom) return;
    emRoom = next; emSave(!!EM);
    if (EM) EM.setZoneKeys(emRoom.cz).catch(e => console.error(e));
  }
  function emCan() { return !!(Em && QR && M && (Em.canEmit ? Em.canEmit() : window.crypto && crypto.subtle) && 'WebSocket' in window); }
  // ── Transporte: nube (repetidores públicos) o red local Wi-Fi sin internet (2d-C, dec. 115) ──
  // El Dashboard se queda donde está (GitHub Pages / app instalada) y habla con el servidor del Mac por ws://localhost:<puerto>.
  // Los QR apuntan a http://<IP del Mac>:<puerto>/…, que sirve la app a los dispositivos de la misma Wi-Fi.
  const NET_KEY = 'showtime.red';
  let NET = netLoad(), NET_ST = { ok: null, ips: [], at: 0, busy: false };
  function netNorm(v) {
    const o = v && typeof v === 'object' ? v : {};
    const port = Number.isInteger(+o.port) && +o.port >= 1 && +o.port <= 65535 ? +o.port : (Em && Em.LOCAL_PORT) || 8765;
    const host = typeof o.host === 'string' && Em && Em.hostPort && Em.hostPort(o.host.trim() + ':' + port) ? o.host.trim().toLowerCase() : '';
    return { mode: o.mode === 'local' ? 'local' : 'cloud', host, port };
  }
  function netLoad() { try { return netNorm(JSON.parse(localStorage.getItem(NET_KEY) || 'null')); } catch (e) { return netNorm(null); } }
  function netSave() { try { localStorage.setItem(NET_KEY, JSON.stringify(NET)); } catch (e) {} }
  function netLocal() { return NET.mode === 'local'; }
  /** IP del Mac para los QR: la escrita; si no, la del navegador (si el Dashboard se abrió desde la red local); si no, la que diga el servidor. */
  function netHost() {
    if (NET.host) return NET.host;
    if (typeof location !== 'undefined' && Em.isLocalHost && Em.isLocalHost(location.hostname)) return location.hostname.toLowerCase();
    return NET_ST.ips && NET_ST.ips[0] ? NET_ST.ips[0] : '';
  }
  /** Enlace de un QR con el transporte elegido (nube: el de siempre, sin tocar). */
  function emLink(url) { return netLocal() && netHost() ? Em.localUrl(url, netHost(), NET.port) : url; }
  /** Repetidores del Dashboard: nube (los de emision.js) o solo el servidor local del Mac. */
  function emBrokers() { return netLocal() ? [Em.localBroker('localhost', NET.port)] : undefined; }
  /** ¿Está el servidor local abierto en este Mac? (y sus IP de la Wi-Fi). */
  async function netDetect(force) {
    if (!netLocal() || NET_ST.busy || (!force && Date.now() - NET_ST.at < 15000) || typeof fetch !== 'function') return;
    NET_ST.busy = true;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, to = setTimeout(() => ctl && ctl.abort(), 2000);
      const r = await fetch('http://localhost:' + NET.port + '/showtime-local.json', { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      clearTimeout(to);
      const j = await r.json();
      NET_ST = { ok: !!(j && j.app === 'showtime'), ips: Array.isArray(j && j.ips) ? j.ips.filter(ip => Em.isLocalHost(ip)).slice(0, 4) : [], at: Date.now(), busy: false };
      if (NET_ST.ok && !NET.host && !netHost() && NET_ST.ips[0]) { NET.host = NET_ST.ips[0]; netSave(); }
    } catch (e) { NET_ST = { ok: false, ips: [], at: Date.now(), busy: false }; }
    renderNet(true); if (EM) renderCast();
  }
  /** Selector de transporte (en el Hub y en Configuración › Emisión): el mismo bloque en los dos sitios. */
  function netHtml() {
    const loc = netLocal(), h = netHost(), st = NET_ST.ok === true ? 'ok' : NET_ST.ok === false ? 'off' : 'wait';
    return '<div class="net-row"><label class="net-l">' + tx('Transporte') + '</label><select data-net="mode" aria-label="' + esc(tx('Transporte')) + '">'
      + '<option value="cloud"' + (loc ? '' : ' selected') + '>' + tx('Nube (Internet · por defecto)') + '</option>'
      + '<option value="local"' + (loc ? ' selected' : '') + '>' + tx('Red Local Wi-Fi (0 internet)') + '</option></select></div>'
      + (loc ? '<div class="net-row net-hp"><label class="net-l">' + tx('IP del Mac') + '</label><input type="text" data-net="host" inputmode="decimal" spellcheck="false" autocomplete="off" placeholder="192.168.1.45" value="' + esc(NET.host || '') + '">'
        + '<label class="net-l net-pl">' + tx('Puerto') + '</label><input type="number" data-net="port" min="1" max="65535" value="' + NET.port + '">'
        + '<button class="btn" type="button" data-net="detect">' + tx('Detectar') + '</button></div>'
        + '<div class="net-st ' + st + '"><i></i><span>' + (st === 'ok' ? tx('Servidor local activo') + (NET_ST.ips.length ? ' · ' + esc(NET_ST.ips.join(' · ')) : '')
          : st === 'off' ? tx('Servidor local no encontrado en este Mac. En Terminal: cd ~/Claude/SHOWTIME && node servidor.js') : tx('Buscando el servidor local…')) + '</span></div>'
        + '<p class="mnote">' + (h ? tx('Los QR abren http://{h}:{p}/ · los dispositivos deben estar en la misma Wi-Fi que el Mac.', { h: esc(h), p: NET.port })
          : tx('Escribe la IP del Mac en la Wi-Fi (Ajustes del Sistema › Wi-Fi › Detalles) o pulsa Detectar.')) + '</p>'
      : '');
  }
  function renderNet(force) {
    ['cast-net', 'cfg-net'].forEach(id => {
      const box = $(id); if (!box) return;
      if (!force && box.contains(document.activeElement) && document.activeElement && document.activeElement.tagName === 'INPUT') return;   // no pisar lo que se escribe
      const h = netHtml(); if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; }
    });
  }
  /** Cambiar el transporte con la emisión en marcha: se reconecta por el nuevo (las claves y los QR de nube siguen siendo los mismos). */
  async function netApply(prev) {
    netSave(); renderNet(true);
    if (netLocal()) netDetect(true);
    if (EM && prev !== JSON.stringify(NET)) { await emStop(true); await emStart(); }
    renderCast();
  }
  document.addEventListener('change', e => {
    const t = e.target.closest && e.target.closest('[data-net]'); if (!t) return;
    const prev = JSON.stringify(NET), k = t.dataset.net;
    if (k === 'mode') NET = netNorm(Object.assign({}, NET, { mode: t.value }));
    else if (k === 'port') { const p = +t.value; if (Number.isInteger(p) && p >= 1 && p <= 65535) { NET = netNorm(Object.assign({}, NET, { port: p })); NET_ST.at = 0; } else { toast(tx('Puerto no válido (1–65535)'), true); renderNet(true); return; } }
    else if (k === 'host') {
      const v = t.value.trim();
      if (v && !Em.hostPort(v + ':' + NET.port)) { toast(tx('IP o nombre no válido: {v}', { v: v }), true); renderNet(true); return; }
      NET = netNorm(Object.assign({}, NET, { host: v }));
    } else return;
    if (k === 'mode') logEvent('msg', 'Transporte de la emisión: ' + (netLocal() ? 'red local Wi-Fi' : 'nube'), { src: 'panel' });
    netApply(prev);
  });
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-net="detect"]'); if (t) { NET_ST.at = 0; netDetect(true); } });
  renderNet(true);
  async function emStart(resumed) {
    if (!emCan()) { toast('Este navegador no permite la emisión cifrada', true); return; }
    if (EM) return;
    try {
      if (!emRoom) { const saved = emLoad(); emRoom = saved ? saved.room : await Em.newRoom(); }
      emZoneKeys();
      EM = new Em.Emisor({ room: emRoom, brokers: emBrokers(), getSnapshot: emSnapshot, onCommand: emCommand, onStatus: st => { EMST = st; renderCast(); }, onProdMessage: emProdMessage });
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
    const z = RM_ZONE && rmZones().find(x => x.id === RM_ZONE);
    if (z) {
      modal(tx('Nueva clave del mando de {z}', { z: z.name }), '<p>' + tx('El QR del mando de <b>{z}</b> deja de poder mandar al Mac. Los mandos de las demás zonas, el general, Staff y Producción siguen valiendo y la emisión no se corta.', { z: esc(z.name) }) + '</p>', [
        { label: 'Cancelar' },
        { label: 'Nueva clave', kind: 'primary', run: () => { (async () => {
          emRoom = Em.newZoneKey(emRoom, z.id); emSave(!!EM);
          if (EM) await EM.setZoneKeys(emRoom.cz);
          renderCast(); toast(tx('Clave nueva del mando de {z}: escanea otra vez su QR', { z: z.name }));
        })(); } }
      ]);
      return;
    }
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
    // Mando de una zona (dec. 102): la zona la pone emision.js según la clave que firma; aquí solo se le deja tocar lo suyo
    const zone = typeof cmd._z === 'string' ? cmd._z : null;
    if (zone !== null && !rmZones().some(z => z.id === zone)) return { ok: false, msg: 'Esta zona ya no existe en el Dashboard' };
    if (zone !== null && FEST) { const den = M.zoneDenied(FEST, cmd, zone); if (den) return { ok: false, msg: den }; }
    if (cmd.op === 'chat' || cmd.op === 'chatsync') return emRemoteChat(cmd, zone);
    if (!FEST && ['flash', 'flashOff'].indexOf(cmd.op) < 0) return { ok: false, msg: 'No hay evento abierto en el Dashboard' };
    const at = Math.abs(Date.now() - cmd.t) < 120000 ? cmd.t : Date.now();     // la hora en que se pulsó en el móvil
    const abs = Math.floor(C.nowAbs(new Date(at)));
    const from = zone !== null ? 'Desde el mando del Stage Manager (' + zoneLabel(zone) + ') · ' : 'Desde el mando del Stage Manager · ';
    const fromUi = zone !== null ? tx('Desde el mando del Stage Manager ({_z})', { _z: zoneLabel(zone) }) + ' · ' : tx(from);
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
      Dt.setFlash(t, to, zs, zone !== null ? { k: 'zone', n: zoneLabel(zone) } : null); renderFlash(); toast(fromUi + tx('Mensaje → {to}: «{t}»', { to: tgtUi(to, zs), t: t }));
      logEvent('msg', '«' + t + '» → ' + Vs.targetsTxt(to, zs, zoneLabel), { src: 'mando', t: abs });
      return { ok: true, msg: 'Mensaje → ' + Vs.targetsTxt(to, zs, zoneLabel) + ': «' + t + '»' };
    }
    if (cmd.op === 'flashOff') {
      Dt.setFlash(null); renderFlash(); toast(fromUi + tx('Mensaje retirado'));
      return { ok: true, msg: 'Mensaje retirado' };
    }
    if (cmd.op === 'callOk') {
      callOk(a.key, 'Stage Manager (mando)', 'mando'); tick(); toast(fromUi + tx('CALL confirmado'));
      return { ok: true, msg: 'CALL confirmado' };
    }
    return { ok: false, msg: 'Orden desconocida' };
  }

  /** Chat desde el mando (dec. 104): firma «[Zona] Nombre» y va al hilo de Producción (lo ven el Panel, Producción y los mandos). */
  function emRemoteChat(cmd, zone) {
    if (cmd.op === 'chatsync') { emPushChat(); return { ok: true, msg: '' }; }
    const from = M.chatSign(zone !== null ? zoneLabel(zone) : null, cmd.args.name);
    const m = Dt.addChat(cmd.args.text, from, zone !== null ? 'mando:' + zone : 'mando', false);
    if (!m) return { ok: false, msg: 'Mensaje vacío' };
    renderChat();
    if (!$('m-chat').classList.contains('open') && !chatPopOn) $('chat-on').hidden = false;   // sin leer
    if (CONFIG && CONFIG.prodChatPopup !== false) toast(tx('Chat · {p}: {t}', { p: from, t: m.text.slice(0, 100) }));
    emPushChat();
    return { ok: true, msg: 'Enviado' };
  }

  // ── CALL OK: quién lo ha dado queda en el log (Stage Manager desde el Panel, el mando o una pantalla Live; o la persona de Producción) ──
  let CALL_LOGGED = new Set(Dt.getCallDone());   // OK ya apuntados (los que había al abrir no se reescriben)
  function bandOfKey(key) { return C.callKeyName(key); }
  function prodName(id) { const p = (typeof PRODUCERS !== 'undefined' ? PRODUCERS : []).find(x => x.id === id); return p ? p.name : id; }
  /** Dec. 150 · un OK de CALL vale para UNA hora efectiva de CALL: se guarda la clave y su sello («clave~minuto»). Si un retraso
   *  mueve esa hora, el CALL vuelve a pendiente (en todas las pantallas, porque el sello viaja con los OK); si se deshace y
   *  vuelve la hora, el OK vale otra vez. Apuntado en el log una vez por hora confirmada; el log nunca se borra. */
  function callAtOfKey(key) {
    const b = (LIVE || []).concat(ALL_MODE || []).find(x => C.isBand(x) && (C.callKey(x) === key || C.legacyCallKey(x) === key));
    return b ? C.callAt(b, Dt.callMinsOf(FEST, CONFIG)) : null;
  }
  function callOk(key, who, src) {
    const at = callAtOfKey(key), st = at !== null ? C.callStamp(key, at) : null, id = st || key, done = Dt.getCallDone();
    if (CALL_LOGGED.has(id) && done.indexOf(id) >= 0 && done.indexOf(key) >= 0) return false;   // ya tenía OK para esta hora
    const n = Math.floor(C.nowAbs());
    Dt.markCallDone(st ? [key, st] : key, n);
    if (!CALL_LOGGED.has(id)) { CALL_LOGGED.add(id); CALL_LOGGED.add(key); logEvent('call', 'CALL OK · ' + bandOfKey(key) + ' · ' + who, { src }); }
    return true;
  }
  /** OK sin sello (OK antiguo, o de una ventana con el código anterior): se sella con su hora efectiva de ahora, sin apuntarlo otra vez. */
  function stampCallOks() {
    const done = Dt.getCallDone(), cm = Dt.callMinsOf(FEST, CONFIG);
    LIVE.forEach(b => {
      if (!C.isBand(b)) return;
      const k = done.indexOf(C.callKey(b)) >= 0 ? C.callKey(b) : done.indexOf(C.legacyCallKey(b)) >= 0 ? C.legacyCallKey(b) : null;
      if (!k || done.some(x => String(x).indexOf(k + '~') === 0)) return;
      const at = C.callAt(b, cm); if (at === null) return;
      const st = C.callStamp(k, at); CALL_LOGGED.add(st); Dt.markCallDone(st, Math.floor(C.nowAbs()));
    });
  }
  /** Dec. 148 · OK de CALL y ediciones a mano en la tabla (antes de aplicar el cambio, para que todo se pinte ya con él):
   *  - el regidor escribe en CALL una hora VÁLIDA (anterior al inicio) y DISTINTA de la que tenía → se quita el OK de esa banda:
   *    vuelve a salir con su nueva hora en el Dashboard, Manager y Backstage. El sonido solo cuando entre de verdad en la
   *    ventana nueva (si al editar ya está dentro, no suena: AU_QUIET). El log de «CALL OK» no se borra.
   *  - misma hora, hora inválida u otro campo → el OK se queda. Si el otro campo cambia la clave del CALL (nombre, zona,
   *    inicio previsto), el OK pasa a la clave nueva. Los retrasos no pasan por aquí: no tocan el previsto ni la clave. */
  function undoCallDone(cd) {
    if (cd.del && cd.del.length) Dt.unmarkCallDone(Dt.getCallDone().filter(x => cd.del.some(k => x === k || String(x).indexOf(k + '~') === 0)).concat(cd.del));   // con sus sellos (dec. 150)
    (cd.add || []).forEach(k => { CALL_LOGGED.add(k); Dt.markCallDone(k, Math.floor(C.nowAbs())); });   // ya apuntados en su día: no se repite «CALL OK»
  }
  function callBlk(state, id, rmode) { return state ? C.buildBlocks(state, { mode: 'all', day: 'all' }).find(b => b.key === String(id) + ':' + rmode) || null : null; }
  function callEditFix(prev, next, id, rmode, k) {
    CALL_UNDO = null;
    const a = callBlk(prev, id, rmode), b = callBlk(next, id, rmode);
    if (!a || !b || !C.isBand(a) || !C.isBand(b) || !C.callIsDone(Dt.getCallDone(), a, Dt.callMinsOf(prev, CONFIG))) return null;
    const valid = b.callAbs !== null && b.callAbs !== undefined && Number.isFinite(b.callAbs) && b.callAbs < b.si;
    if (k === 'call' && valid && C.callAt(b, Dt.callMinsOf(next, CONFIG)) !== C.callAt(a, Dt.callMinsOf(prev, CONFIG))) {
      const base = [C.callKey(a), C.legacyCallKey(a), C.callKey(b), C.legacyCallKey(b)];
      const keys = Dt.getCallDone().filter(x => base.some(k => x === k || String(x).indexOf(k + '~') === 0));   // claves y sellos (dec. 150)
      CALL_UNDO = { add: keys.slice(), del: [] };   // Deshacer devuelve exactamente los OK que había
      Dt.unmarkCallDone(keys.concat(base)); keys.concat(base).forEach(x => CALL_LOGGED.delete(x));   // un OK nuevo se volverá a apuntar
      AU_QUIET.add(C.callKey(b));
      return 'reopen';
    }
    if (C.callKey(b) !== C.callKey(a)) {
      if (!C.callIsDone(Dt.getCallDone(), b, Dt.callMinsOf(next, CONFIG))) CALL_UNDO = { add: [], del: [C.callKey(b)] };
      CALL_LOGGED.add(C.callKey(b)); Dt.markCallDone(C.callKey(b), Math.floor(C.nowAbs())); return 'moved';
    }
    return 'kept';
  }
  /** OK que llegan de otra ventana (la Live del Stage Manager): se apuntan como suyos. Y se olvidan los que caducan. */
  function logLiveCallOks() {
    const now = Dt.getCallDone();
    now.forEach(k => {
      k = String(k); if (CALL_LOGGED.has(k)) return;
      CALL_LOGGED.add(k);
      if (!C.isCallStamp(k) && now.some(x => String(x).indexOf(k + '~') === 0)) return;   // con sello: se apunta por su sello
      logEvent('call', 'CALL OK · ' + bandOfKey(k.split('~')[0]) + ' · Stage Manager (pantalla Live)', { src: 'panel' });
    });
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
    const html = list.slice(-100).map(m => '<div class="chat-list-item' + (m.sm ? ' sm' : '') + (m.urgent === true ? ' urg' : '') + '"><div class="chat-list-item-from">' + (m.urgent === true ? urgIcon() : '') + esc(m.sm ? 'Stage Manager' : m.from) +
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
    if (!Dt.addChat(inp.value, 'Stage Manager', '', true)) return;   // vacío o solo lectura: no se envía y nada cambia
    inp.value = ''; audioUrgentAnswered(); renderChat(); emPushChat();
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

  /** Indicador de mensaje urgente (el mismo triángulo SVG en Producción, Dashboard y Mando). Solo se muestra: aquí no se marca. */
  function urgIcon() { const t = esc(tx('Urgente')); return '<svg class="ic urg-i" role="img" aria-label="' + t + '"><title>' + t + '</title><use href="#i-urg"/></svg>'; }

  // ── Avisos de audio locales (dec. 145): suenan solo en ESTE Dashboard. Preferencias en localStorage («showtime.audioAlerts»):
  //    nunca en la configuración del festival, ni en el JSON, ni en la emisión. Sin Web Audio, no suena y no falla.
  //    AU y AU_EDGE se declaran arriba (el primer tick puede llegar antes de esta línea).
  //    Dec. 146/147: el detector se rearma EN SILENCIO al arrancar, al abrir / importar / reemplazar el evento, sin evento y al
  //    apagar o encender «Activar»: la primera lectura de después solo arma. Cambiar de jornada o de vista NO rearma.
  //    Suena solo una transición real de inactivo → activo. Planificador único (AU.RING, sin interfaz): un tono detrás de otro.
  //    «Repetir» por tipo: vuelve cada N s (los suyos) hasta que se para DESDE EL AVISO QUE YA EXISTE: OK de CALL, «Visto»
  //    de meteo, ■ / ✓ local del sobretiempo en EN ESCENA, ✓ local del mensaje urgente en el chat. Esos controles no cambian.
  let AU_SIG;   // evento de la última lectura (undefined = aún ninguna)
  const AU_QUIET = new Set();
  let AU_PREVNOW;   // dec. 150: minuto de la lectura anterior: un CALL solo suena si su ventana se abre AHORA (no si reaparece dentro)   // dec. 148: CALL reprogramados que ya estaban dentro de su ventana al editar: no suenan hasta salir y volver a entrar
  function audioRearm() { if (AU_EDGE) ['call', 'overrun', 'meteo'].forEach(k => { AU_EDGE[k] = AU.edge(); }); }
  const auItems = list => (list || []).map(x => typeof x === 'string' ? { key: x, label: x } : x);
  /** Una lectura del estado. null = sin evento. Ítems: [{ key, label }] (o claves sueltas). */
  function audioTick(calls, overs, meteos) {
    if (!AU_EDGE) return;
    const sig = FEST && calls ? (window.ShowtimeLog ? window.ShowtimeLog.eventKey(FEST) : '') : null;
    if (sig !== AU_SIG) { AU_SIG = sig; audioRearm(); }   // otro evento o sin evento: se vuelve a armar en silencio (jornada y vista, no)
    const p = AU.load(), now = Date.now();
    [['call', calls], ['overrun', overs], ['meteo', meteos]].forEach(([k, raw]) => {
      const items = auItems(raw), fresh = new Set(AU_EDGE[k](items.map(x => x.key)));   // solo lo que ENTRA ahora
      if (k === 'call') {
        const here = new Set(items.map(x => String(x.key))); AU_QUIET.forEach(q => { if (!here.has(q)) AU_QUIET.delete(q); else fresh.delete(q); });
        // reaparece ya dentro de su ventana (OK que deja de valer por un retraso, hora reprogramada, Deshacer): sin sonido
        items.forEach(x => { if (Number.isFinite(x.at) && AU_PREVNOW !== undefined && x.at <= AU_PREVNOW) fresh.delete(String(x.key)); });
      }
      if (AU.enabled(p, k)) items.filter(x => fresh.has(String(x.key))).forEach(x => AU.RING.add({ id: k + ':' + x.key, kind: k, key: x.key, label: x.label, repeat: AU.repeats(p, k) }, now));
      AU.RING.retain(k, items.map(x => x.key));   // estado terminado (OK de CALL, ■, «Visto», fuera de ventana): se para solo
    });
    if (calls) AU_PREVNOW = Math.floor(C.nowAbs());
    audioStep(now);
  }
  function audioStep(now) { if (AU) { const p = AU.load(); AU.RING.step(now || Date.now(), k => AU.everyOf(p, k)); } }
  /** Urgente recibido de Producción (solo Producción lo marca): a la cola; con «Repetir», hasta que se responde en el Chat
   *  (dec. 152). Con el Chat abierto también se repite: abrirlo no responde. */
  function audioUrgent(m) {
    if (!AU) return;
    const p = AU.load(); if (!AU.enabled(p, 'urgent')) return;
    AU.RING.add({ id: 'urgent:' + m.id, kind: 'urgent', key: m.id, label: m.from, repeat: AU.repeats(p, 'urgent') }, Date.now());
    audioStep();
  }
  /** Dec. 152: un mensaje de Chat no vacío enviado bien desde este Dashboard (sendChat, el envío de siempre) para aquí la
   *  repetición de TODOS los urgentes pendientes. Abrir, pasar el ratón, enfocar o escribir sin enviar no cuentan. Solo audio
   *  local: el mensaje sigue siendo urgente; no toca el texto, «urgent», el log, la emisión ni los datos compartidos. */
  function audioUrgentAnswered() { if (AU) AU.RING.dropRepeats('urgent'); }
  /** Dec. 148: silenciar el sonido de sobretiempo. Control propio (altavoz tachado, no ✓), en la línea del nombre de EN ESCENA,
   *  fuera de cualquier botón que cambie el show. Solo mientras se repite. Solo detiene ese audio local: no toca la banda,
   *  ni el Tiempo extra, ni los tiempos, ni ningún dato. */
  function auMuteBtn(id, what) {
    if (!AU || !AU.RING.repeating(id)) return '';
    const t = esc(tx('Silenciar el sonido de sobretiempo') + (what ? ' · ' + what : ''));
    return '<button class="au-mute" type="button" data-au-ack="' + esc(id) + '" title="' + t + '" aria-label="' + t + '"><svg class="ic"><use href="#i-mute"/></svg></button>';
  }
  function audioConfirm(id) { if (!AU || !AU.RING.confirm(String(id))) return false; renderChat(); return true; }
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-au-ack]') : null; if (!b) return;
    if (e.stopPropagation) e.stopPropagation();
    if (audioConfirm(b.dataset.auAck)) b.remove && b.remove();
  });
  function fillAudioCfg() {
    const on = $('au-on'); if (!on) return;
    const p = AU ? AU.load() : null, live = !!(p && p.on);
    on.checked = live; on.disabled = !AU;
    (AU ? AU.KINDS : []).forEach(k => {
      const c = $('au-' + k), r = $('au-rep-' + k), ev = $('au-ev-' + k);
      if (c) { c.checked = p[k]; c.disabled = !live; }
      if (r) { r.checked = p.rep[k]; r.disabled = !live || !p[k]; }
      if (ev) { ev.value = String(p.every[k]); ev.disabled = !live || !p[k] || !p.rep[k]; }   // el intervalo solo vale con «Repetir»
    });
  }
  function saveAudioCfg() {
    if (!AU) return;
    const old = AU.load(), p = JSON.parse(JSON.stringify(old)); p.on = $('au-on').checked;
    AU.KINDS.forEach(k => {
      const c = $('au-' + k), r = $('au-rep-' + k), ev = $('au-ev-' + k);
      if (c) p[k] = !!c.checked;
      if (r) p.rep[k] = !!r.checked;
      if (ev && ev.value !== '') p.every[k] = Number(ev.value);
    });
    const s = AU.save(p);
    if (s.on !== old.on) { AU.stop(); AU.RING.clear(); audioRearm(); }   // apagar: silencio al momento y nada pendiente; volver a encender no suena lo que ya estaba
    if (s.on) AU.unlock();   // el cambio es un gesto: desbloquea ya
    AU.KINDS.forEach(k => { if (!s[k]) AU.RING.dropKind(k); else if (!s.rep[k]) AU.RING.dropRepeats(k); });   // tipo apagado o sin «Repetir»: deja de repetirse
    fillAudioCfg(); renderChat();
  }
  $('au-on').addEventListener('change', saveAudioCfg);
  (AU ? AU.KINDS : []).forEach(k => ['au-', 'au-rep-', 'au-ev-'].forEach(pre => { const el = $(pre + k); if (el) el.addEventListener('change', saveAudioCfg); }));
  /** Muestra de cada tono: suena aunque «Activar» esté apagado; corta la muestra anterior; no crea avisos ni toca nada más. */
  function audioPreview(kind) { if (!AU || !AU.preview(kind)) return false; AU.RING.hold(Date.now(), AU.toneSecs(kind)); return true; }
  (AU ? AU.KINDS : []).forEach(k => { const el = $('au-pv-' + k); if (el) el.addEventListener('click', e => { if (e && e.preventDefault) e.preventDefault(); audioPreview(k); }); });

  // Mensajes de Producción (llegan cifrados desde su Live): OK de CALL, mensajes a las pantallas y chat.
  function emProdMessage(raw) {
    const msg = Em && Em.cleanProdMsg ? Em.cleanProdMsg(raw) : null;
    if (!msg) return;
    if (!PRODUCERS.some(p => p.id === msg.from)) { toast(tx('Mensaje de Producción ignorado: «{p}» no está en la lista de Producción', { p: msg.from }), true); return; }   // persona borrada o id inventado
    const who = 'Producción (' + prodName(msg.from) + ')', whoUi = tx('Producción ({p})', { p: prodName(msg.from) });   // log en español; aviso en el idioma del Panel
    if (msg.type === 'call') {
      if (!FEST || !C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.callKey(b) === msg.key)) return;   // solo CALL que existen
      if (!callOk(msg.key, who, 'produccion')) return;   // ya tenía OK para esta hora
      tick(); toast('CALL OK · ' + bandOfKey(msg.key) + ' · ' + whoUi);
    } else if (msg.type === 'flash') {
      const to = Vs.normTargets(msg.to);
      Dt.setFlash(msg.text, to, null, { k: 'prod' }); renderFlash();
      toast(whoUi + ' → ' + tgtUi(to, null) + ': «' + msg.text + '»');
      logEvent('msg', '«' + msg.text + '» → ' + Vs.targetsTxt(to, null, zoneLabel) + ' · ' + who, { src: 'produccion' });
    } else if (msg.type === 'aviso') {
      if (!Dt.addAviso(msg.text, msg.perm, who, { k: 'prod' })) return;   // en pantalla «[Producción]»; en el log y en la ✕, quién fue
      if (FEST) renderDrift(Math.floor(C.nowAbs()));
      toast(tx(msg.perm ? '{w} · aviso permanente: «{t}»' : '{w} · aviso puntual: «{t}»', { w: whoUi, t: msg.text }));
      logEvent('msg', 'Aviso ' + (msg.perm ? 'permanente' : 'puntual') + ': «' + msg.text + '» · ' + who, { src: 'produccion' });
    } else if (msg.type === 'chat') {
      const cm = Dt.addChat(msg.text, prodName(msg.from), msg.from, false, msg.urgent === true);   // urgente: lo marca SOLO Producción (dec. 145)
      if (cm && cm.urgent === true) audioUrgent(cm);
      renderChat();
      if (!$('m-chat').classList.contains('open') && !chatPopOn) $('chat-on').hidden = false;   // sin leer
      if (CONFIG && CONFIG.prodChatPopup !== false) toast(tx('Chat · {p}: {t}', { p: prodName(msg.from), t: msg.text.slice(0, 100) }));
      emPushChat();
    } else if (msg.type === 'chatsync') {
      emPushChat();
    }
  }

  function emLinksOn() { return EMST ? EMST.links.filter(l => l.state === 'on').length : 0; }
  function emStateHtml(kind, big) {
    const n = emLinksOn(), tot = EMST ? EMST.links.length : 2;
    const cls = n ? 'ok' : 'warn';
    const txt = n === 0 ? tx('Conectando con los repetidores…') : n < tot ? tx('En directo ({n} de {t} repetidores)', { n: n, t: tot }) : tx('En directo');
    const links = (EMST ? EMST.links : (emBrokers() || Em.BROKERS).map(b => ({ name: b.name, state: 'connecting' })))
      .map(l => '<span class="clink ' + (l.state === 'on' ? 'on' : '') + '" title="' + esc(l.state === 'on' ? tx('Conectado') : l.err ? tx('Sin conexión: {e}', { e: l.err }) : tx('Conectando…')) + '">' + esc(l.name) + '</span>').join('');
    const v = EMST ? EMST.viewers : 0, r = kind === 'remote' ? qrDevices().filter(d => d.r && (RM_ZONE ? d.s === RM_ZONE : !d.s)).length : 0;
    const who = kind === 'remote' ? (r ? '<b class="cok">' + tx('Stage Manager conectado') + '</b>' : tx('Sin Stage Manager conectado')) : kind === 'produccion' ? '<span>' + tx('{n} persona(s) de Producción', { n: PRODUCERS.length }) + '</span>' : tx(v === 1 ? '1 dispositivo conectado' : '{n} dispositivos conectados', { n: v });
    return '<div class="cstate"><span class="cdot ' + cls + '"></span><b>' + txt + '</b></div><div class="cview">' + who + '</div><div class="clinks">' + links + '</div>' + '';
  }
  /** Barra de estado de la emisión: conectar / desconectar, sala y dispositivos conectados (telemetría). */
  function renderCastBar() {
    const bar = $('cast-bar'); if (!bar) return;
    let h;
    if (!emCan()) h = '<span class="cb-st"><i class="cb-led"></i>' + tx('Este navegador no permite la emisión cifrada.') + '</span>';
    else if (!EM) h = '<span class="cb-st"><i class="cb-led"></i><b>' + tx('Emisión detenida') + '</b></span><button class="btn primary" type="button" data-act="cast-start"><svg class="ic"><use href="#i-cast"/></svg>' + tx('Empezar a emitir') + '</button>';
    else {
      const n = qrDevices().length, links = emLinksOn();
      h = '<span class="cb-st"><i class="cb-led on' + (links ? '' : ' wait') + '"></i><b>' + tx(links ? 'En directo' : 'Conectando…') + '</b>'
        + (emRoom ? '<small>' + tx('Sala {s}', { s: esc(String(emRoom.sala).slice(0, 4).toUpperCase()) }) + '</small>' : '')
        + '<small class="cb-n">' + tx(n === 1 ? '1 dispositivo conectado' : '{n} dispositivos conectados', { n: n }) + '</small></span>'
        + '<button class="btn" type="button" data-act="cast-stop">' + tx('Parar emisión') + '</button>';
    }
    if (bar.dataset.h !== h) { bar.innerHTML = h; bar.dataset.h = h; }
    // Seguridad: cerrar / reabrir la jornada en los QR y regenerar las claves
    const sec = $('cast-sec'); if (!sec) return;
    const s = (EM ? emScopeHtml() : '') + (emRoom && emCan() ? '<button class="btn ghost" type="button" data-act="cast-regen"><svg class="ic"><use href="#i-refresh"/></svg>' + tx('Regenerar claves de acceso…') + '</button>' : '');
    if (sec.dataset.h !== s) { sec.innerHTML = s; sec.dataset.h = s; }
    sec.hidden = !s;
  }
  /** Jornada que ven los QR («Solo hoy») y el botón Cerrar / Reabrir jornada. */
  function emScopeHtml() {
    const day = emDay(); if (!day) return '';
    const closed = EM_CLOSED === day;
    return '<div class="cscope' + (closed ? ' closed' : '') + '"><span>' + tx(closed ? 'Jornada cerrada en los QR · {d}' : 'Los QR ven solo hoy · {d}', { d: fmtDay(day) }) + '</span>'
      + '<button class="btn" type="button" data-act="cast-closeday" data-on="' + (closed ? '0' : '1') + '">' + tx(closed ? 'Reabrir jornada' : 'Cerrar jornada') + '</button></div>';
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
    if (kind === 'remote') { if (RM_ZONE && !rmZones().some(z => z.id === RM_ZONE)) RM_ZONE = null; return emLink(Em.remoteUrl(emRoom, undefined, RM_ZONE)); }
    if (kind === 'produccion') {
      if (!PROD_DEFAULT_ID && PRODUCERS.length) PROD_DEFAULT_ID = PRODUCERS[0].id;
      const sel = PRODUCERS.some(p => p.id === PROD_SEL) ? PROD_SEL : PROD_DEFAULT_ID;
      return emLink(Em.productionUrl(emRoom, undefined, sel || 'Producción'));
    }
    if (CAST_VISTA === 'confidence') { const zs = castZones(); if (!zs.some(z => z.id === CAST_ZONA)) CAST_ZONA = zs.length ? zs[0].id : ''; }
    return emLink(Em.staffUrl(emRoom, undefined, { vista: CAST_VISTA, zona: CAST_ZONA }));
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
      const url = emLink(Em.productionUrl(emRoom, undefined, p.id));
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
    return '<div class="cpick"><select class="cvsel" data-cvs="1" aria-label="' + esc(tx('Pantalla que abre el QR')) + '">' + Vs.VISTAS.map(v => '<option value="' + v + '"' + (CAST_VISTA === v ? ' selected' : '') + '>' + Vs.VISTA_TXT[v] + '</option>').join('') + '</select>'
      + (CAST_VISTA === 'confidence' ? '<select class="czone" data-cz="1">' + zs.map(z => '<option value="' + esc(z.id) + '"' + (z.id === CAST_ZONA ? ' selected' : '') + '>' + esc(z.name) + '</option>').join('') + '</select>' : '')
      + '<span class="csub">' + esc(tx(Vs.VISTA_SUB[CAST_VISTA])) + '</span></div>';
  }
  /** Mando por zona: «Todas las zonas» (el general) o el de una zona (solo si el evento tiene varias). */
  function rmPickHtml() {
    const zs = rmZones(); if (zs.length < 2) return '';
    return '<div class="cpick"><select class="czone" data-rzs="1" aria-label="' + esc(tx('Zona del mando')) + '"><option value=""' + (RM_ZONE ? '' : ' selected') + '>' + tx('Todas las zonas') + '</option>'
      + zs.map(z => '<option value="' + esc(z.id) + '"' + (RM_ZONE === z.id ? ' selected' : '') + '>' + esc(z.name) + '</option>').join('') + '</select>'
      + '<span class="csub">' + esc(RM_ZONE ? tx('Solo ve y controla {z} (shows, pruebas, tiempos y su Confidence). Chat de Producción incluido.', { z: zoneLabel(RM_ZONE) }) : tx('Mando general: todas las zonas. Chat de Producción incluido.')) + '</span></div>';
  }
  function paneHtml(kind) {
    const url = emUrl(kind);
    const side = kind === 'remote'
      ? '<button class="btn" type="button" data-act="cast-big" data-k="remote"><svg class="ic"><use href="#i-expand"/></svg>' + tx('Ampliar') + '</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="remote"><svg class="ic"><use href="#i-copy"/></svg>' + tx('Copiar enlace') + '</button>'
        + '<button class="btn ghost" type="button" data-act="cast-regencmd">' + tx('Nueva clave del mando…') + '</button>'
      : '<button class="btn" type="button" data-act="cast-big" data-k="staff"><svg class="ic"><use href="#i-expand"/></svg>' + tx('Ampliar') + '</button>'
        + '<button class="btn" type="button" data-act="cast-copy" data-k="staff"><svg class="ic"><use href="#i-copy"/></svg>' + tx('Copiar enlace') + '</button>';
    const note = kind === 'remote'
      ? '<p class="cwarn"><svg class="ic"><use href="#i-alert"/></svg><span>' + tx('<b>Privado.</b> Quien tenga este QR puede mandar al Mac (▶ / ■, En hora, retrasos, mensajes, CALL). No lo compartas; si se escapa, «Nueva clave del mando».') + '</span></p>'
      : '<p class="mnote">' + tx('Abre la Pantalla Live en el dispositivo (móvil, tablet…), en solo lectura. Si el Mac se duerme o se cierra el Dashboard, la emisión se corta y los dispositivos lo avisan.') + '</p>';
    if (kind === 'produccion') {
      return '<div class="cprod-split"><div class="cprod-left"><div class="cprod-add"><input type="text" id="prod-input" placeholder="' + tx('Nombre productor…') + '" /><button class="btn primary" type="button" data-act="prod-add-person"><svg class="ic"><use href="#i-plus"/></svg></button></div><div class="cprod-list" id="prod-list"></div><p class="mnote">' + tx('Toca una persona para ver su QR. Ve la Live de Manager, confirma los CALL, manda mensajes y avisos y chatea contigo (sin tocar horarios).') + '</p></div><div class="cprod-right"><div id="prod-qr-side" class="prod-qr-side"></div></div></div>';
    }
    return (kind === 'staff' ? castPickHtml() : kind === 'remote' ? rmPickHtml() : '') + '<div class="cgrid"><div class="cqr" title="' + tx('QR de {k}', { k: kind === 'remote' ? 'Stage Manager' : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA] }) + '">' + QR.svg(url, { ecl: 'M', margin: 3 }) + '</div>'
      + '<div class="cside"><div class="cst" data-k="' + kind + '"></div>' + side + '</div></div>' + note;
  }
  function renderCast() {
    if (!$('cast-staff')) return;
    const on = !!EM;
    if (on) emZoneKeys();
    renderHubLed(); renderCastBar(); renderNet();
    if (netLocal()) netDetect();
    const noHost = netLocal() && !netHost();   // red local sin IP del Mac: un QR así no llevaría a ningún sitio
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
          + '<p class="mnote">' + (netLocal() ? tx('Red local: sin internet. El Mac y los dispositivos, en la misma Wi-Fi; el servidor local del Mac, abierto. Todo va cifrado igual que por la nube.')
            : tx('Necesita internet en el Mac y en los dispositivos (4G o Wi-Fi con salida). Todo va cifrado: los repetidores públicos solo ven datos ilegibles y no guardan nada.')) + '</p>';
        return;
      }
      if (noHost) { box.dataset.url = ''; box.innerHTML = '<p class="cwarn"><svg class="ic"><use href="#i-alert"/></svg><span>' + tx('Red local: falta la IP del Mac para los QR. Escríbela arriba o pulsa Detectar (con el servidor local abierto).') + '</span></p>'; return; }
      // Producción: el panel solo se rehace si cambia la sala o su clave (no al elegir persona, que borraría su QR)
      const url = kind === 'produccion' ? emLink(Em.productionUrl(emRoom, undefined, '')) : emUrl(kind);
      if (box.dataset.url !== url) { box.dataset.url = url; box.innerHTML = paneHtml(kind); if (kind === 'produccion') PROD_SEL = null; }
      if (kind === 'produccion') renderProducerList();
      else { const cst = box.querySelector('.cst'); if (cst) cst.innerHTML = emStateHtml(kind); }
    });
    if (!on || noHost) $('qr-big').hidden = true;
    else {
      const url = emUrl(bigTab);
      if ($('qr-big-svg').dataset.url !== url) { $('qr-big-svg').dataset.url = url; $('qr-big-svg').innerHTML = QR.svg(url, { ecl: 'M', margin: 4 }); }
      $('qr-big-t').textContent = bigTab === 'remote' ? tx('Stage Manager · mando (privado)') + (RM_ZONE ? ' · ' + zoneLabel(RM_ZONE) : '') : bigTab === 'produccion' ? prodBigTitle() : 'Staff · ' + Vs.VISTA_TXT[CAST_VISTA] + (CAST_VISTA === 'confidence' ? ' · ' + ((castZones().find(z => z.id === CAST_ZONA) || {}).name || '') : '') + tx(' · solo lectura');
      $('qr-big').classList.toggle('remote', bigTab === 'remote');
      $('qr-big-st').innerHTML = emStateHtml(bigTab, true);
    }
    // Pestaña del mando: punto si hay un mando conectado
    const rt = document.querySelector('#m-hub .ctab[data-tab="remote"]');
    if (rt) rt.classList.toggle('rlive', on && !!(EMST && EMST.remotes));
  }
  async function emCopy(kind) {
    const url = emUrl(kind);
    try { await navigator.clipboard.writeText(url); toast(kind === 'remote' ? 'Enlace del mando copiado (es privado)' : kind === 'produccion' ? 'Enlace de Producción copiado' : 'Enlace de Staff copiado'); }
    catch (e) { modal(kind === 'remote' ? 'Enlace del mando (privado)' : kind === 'produccion' ? 'Enlace de Producción' : 'Enlace de Staff', '<input type="text" readonly value="' + esc(url) + '" style="width:100%" onfocus="this.select()">', [{ label: 'Cerrar' }]); }
  }
  function setCastTab(tab) {
    emTab = tab;
    document.querySelectorAll('#m-hub .ctab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('cast-staff').hidden = tab !== 'staff'; $('cast-remote').hidden = tab !== 'remote'; $('cast-produccion').hidden = tab !== 'produccion';
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act^="cast-"], [data-act^="prod-"], #m-hub .ctab, #qr-big-x');
    if (!t) { if (e.target.id === 'qr-big') $('qr-big').hidden = true; return; }
    if (t.classList.contains('ctab')) { setCastTab(t.dataset.tab); return; }
    if (t.id === 'qr-big-x') { $('qr-big').hidden = true; return; }
    const a = t.dataset.act;
    if (a === 'cast-start') emStart();
    else if (a === 'cast-stop') emStop();
    else if (a === 'cast-regen') { closeMenus(); emRegen(); }
    else if (a === 'cast-regencmd') { closeMenus(); emRegenCmd(); }
    else if (a === 'cast-closeday') emCloseDay(t.dataset.on === '1');
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
  document.addEventListener('change', e => {
    if (e.target.matches('#cast-staff [data-cvs]')) { CAST_VISTA = Vs.normVista(e.target.value); renderCast(); }
    else if (e.target.matches('#cast-remote [data-rzs]')) { RM_ZONE = e.target.value || null; renderCast(); }
    else if (e.target.matches('#cast-staff [data-cz]')) { CAST_ZONA = e.target.value; renderCast(); }
  });
  // ── Pestañas del Hub (dec. 132): Pantallas HDMI (Local) · Emisión y QR (Móviles). La elegida se recuerda en este equipo ──
  const HUB_TAB_KEY = 'showtime.hub.tab';
  function hubTab() { try { return localStorage.getItem(HUB_TAB_KEY) === 'qr' ? 'qr' : 'local'; } catch (e) { return 'local'; } }
  function setHubTab(tab) {
    const t = tab === 'qr' ? 'qr' : 'local';
    try { localStorage.setItem(HUB_TAB_KEY, t); } catch (e) {}
    document.querySelectorAll('#m-hub .htab').forEach(b => { const on = b.dataset.htab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    if ($('hub-local')) $('hub-local').hidden = t !== 'local';
    if ($('hub-qr')) $('hub-qr').hidden = t !== 'qr';
  }
  setHubTab(hubTab());
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#m-hub .htab'); if (!b) return; e.stopPropagation(); setHubTab(b.dataset.htab); });
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
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>C</kbd></dt><dd>' + tx('Modo Stage (Alto Contraste): alterna Studio y Stage al instante') + '</dd>' +
      '<dt><kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>7</kbd></dt><dd>' + tx('Abre esta ayuda') + '</dd>' +
      '</dl><p class="hint">' + tx('Jornada = día del evento: lo que empieza antes de la hora de corte cuenta como la noche anterior. En la Pantalla Live: <kbd>F</kbd> pantalla completa · <kbd>V</kbd> cambia de vista.') + '</p>',
      [{ label: 'Cerrar' }]);
  }
  $('btn-help').addEventListener('click', openHelp);
  $('btn-focus').addEventListener('click', () => { setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); } });
  applyFocus();
  // ⇧⌘C: alterna el Dashboard entre Studio y Stage (alto contraste, para el sol). Con dos modos no hace falta recordar el anterior.
  function togglePanelContrast() {
    const next = panelStyle() === 'stage' ? 'studio' : 'stage';
    try { localStorage.setItem(PS_KEY, JSON.stringify(next)); localStorage.removeItem('showtime.panel.style.prev'); } catch (e) {}
    applyPanelStyle(next);
    const sel = $('cfg-style-panel'); if (sel) sel.value = next;
    toast(next === 'stage' ? tx('Modo Stage (Alto Contraste)') : tx('Modo Studio'), false, 2000);
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
  // ── Fechas en la paleta (dec. 123): «18», «18/07», «18/7», «julio», «july», «jul», «viernes», «friday», «2026-07-18» ──
  const SPOT_WD = { es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] };
  const SPOT_MO = { es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] };
  function spotIsoDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  /** Fecha completa en el idioma del Panel: «Viernes, 18 de julio de 2026» / «Friday, July 18, 2026». */
  function fmtDayFull(iso) {
    const d = spotIsoDate(iso); if (!d) return iso || '—';
    return cap(d.toLocaleDateString(LOCALE(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  }
  /** Todas las formas de escribir esa fecha, en español y en inglés (para buscar). */
  function spotDateWords(iso) {
    const d = spotIsoDate(iso); if (!d) return '';
    const dd = d.getUTCDate(), mm = d.getUTCMonth(), wd = d.getUTCDay();
    return [iso, dd, pad2(dd), dd + '/' + (mm + 1), pad2(dd) + '/' + pad2(mm + 1), dd + '/' + pad2(mm + 1), SPOT_WD.es[wd], SPOT_WD.en[wd],
      SPOT_MO.es[mm], SPOT_MO.en[mm], SPOT_MO.es[mm].slice(0, 3), SPOT_MO.en[mm].slice(0, 3), fmtDay(iso), fmtDayFull(iso)].join(' ');
  }
  /** Grupo «Jornadas»: una por cada día del evento (y los que tengan entradas), con su resumen de actividad. */
  function spotDays() {
    if (!FEST) return [];
    const set = new Set(C.eventDays(FEST)); C.festivalDays(FEST, 'all').forEach(x => set.add(x));
    const all = C.buildBlocks(FEST, { mode: 'all', day: 'all' });
    const KIND = [['show', '{n} show', '{n} shows'], ['sc', '{n} soundcheck', '{n} soundchecks'], ['tarea', '{n} tarea', '{n} tareas'], ['hito', '{n} marcador', '{n} marcadores']];
    return Array.from(set).sort().map(d => {
      const bl = all.filter(b => b.jornada === d);
      const sum = KIND.map(([k, one, many]) => { const n = bl.filter(b => b.kind === k).length; return n ? tx(n === 1 ? one : many, { n }) : ''; }).filter(Boolean).join(' · ');
      return { group: tx('Jornadas'), label: fmtDayFull(d), ic: 'i-clock', sub: sum || tx('Sin actividad'), search: spotDateWords(d) + ' jornada dia day', run: () => spotSetDay(d) };
    });
  }
  /** Píldora corta de la paleta (caben en 62 px): SC · SHOW · TAREA/TASK · MARC/KT. «Hito» no se usa en pantalla: el término oficial es Marcador (dec. 125b). */
  function spotPillTxt(k) {
    if (k === 'sc') return 'SC';
    if (k === 'hito') return tx('MARC');
    return tx(PILL_TXT[k] || '');
  }
  /** Todas las entradas (shows, soundchecks, tareas y marcadores), también por su fecha («18 jul», «viernes»). */
  function spotEntries() {
    if (!FEST) return [];
    return C.buildBlocks(FEST, { mode: 'all', day: 'all' }).map(b => ({
      group: tx('Entradas'), label: b.name || tx('(sin nombre)'), sub: fmtDay(b.jornada) + ' · ' + C.fmtHM(b.si) + ' · ' + (b.stage || tx('Sin zona')),
      pill: '<span class="spot-pill tp-' + b.kind + '" aria-hidden="true">' + esc(spotPillTxt(b.kind)) + '</span>', kbd: '',
      search: (b.name || '') + ' ' + (b.stage || '') + ' ' + spotDateWords(b.jornada),
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
      { group: 'Vistas', label: 'Tareas', ic: 'i-check', sub: 'Solo las tareas técnicas y de producción', search: 'ver tareas tasks operativa montaje comidas', run: () => spotSetMode('tarea') },
      { group: 'Vistas', label: 'Marcadores', ic: 'i-clock', sub: 'Solo los marcadores temporales y toques de queda', search: 'ver marcadores hitos key times puertas curfew toque de queda', run: () => spotSetMode('hito') },
      { group: 'Vistas', label: 'Modo Foco', ic: 'i-expand', kbd: '⇧⌘F', sub: focusOn() ? 'Activado · desactivar' : 'Solo lo de directo, letra grande', search: 'modo foco directo', run: () => { setFocus(!focusOn()); toast(focusOn() ? 'Modo foco activado' : 'Modo foco desactivado', false, 2000); } },
      { group: 'Vistas', label: 'Modo Stage (Alto Contraste)', ic: 'i-sun', kbd: '⇧⌘C', sub: panelStyle() === 'stage' ? 'Activado · volver a Studio' : 'Negro y amarillo para el sol en directo', search: 'stage alto contraste high contrast sol escenario studio', run: () => togglePanelContrast() },
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
  /** Lo que coincide con lo escrito (todas las palabras). Sin texto: vistas y acciones; con texto, también jornadas y entradas. */
  function spotItems(q) {
    const words = spotNorm(q).trim().split(/\s+/).filter(Boolean);
    const hit = txt => words.every(w => spotNorm(txt).indexOf(w) >= 0);
    const days = words.length ? spotDays().filter(d => hit(d.search)).slice(0, 8) : [];
    const ents = words.length ? spotEntries().filter(b => hit(b.search)).slice(0, 12) : [];
    const acts = spotActions().filter(a => !words.length || hit(a.label + ' ' + a.search));
    return days.concat(ents, acts);
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
  window.ShowtimePanel = { reload: () => { loadState(); renderAll(); }, _test: { winState: () => Array.from(WIN.entries()).map(([id, x]) => ({ id, name: x.name, vista: x.vista, zona: x.zona, filas: x.filas || null, standby: !!x.standby, fs: x.fs })), setWinVista, setWinRows, resetWinLayout, setWinStandby, closeLive, openGestor, gestorVisible, emProdMessage, emRegenProd, hitoChips, emUrl, prodBigTitle, fileKind, handleFile, emCommand, importSummary, hidesSome, tipoPill, setWake, wakeState: () => ({ on: wakeOn, lock: !!wakeLock }), showSplash, hideSplash, setStandby, standbyOn, room: () => emRoom,
    emSnapshot, emCloseDay, emDay, qrDevices, rmZones, setRmZone: z => { RM_ZONE = z; renderCast(); }, setRoom: r => { emRoom = r; }, fakeEm: (em, st) => { EM = em; EMST = st; }, emStateHtml, renderCastBar, renderHubLed, mtIn, mtOut, cfSimState, renderCfSim, cfSim: () => CFSIM,
    dayStep, monthLabel, spotItems, spotDays, spotEntries, fmtDayFull, refreshStale, net: () => NET, setNet: o => { NET = netNorm(o); }, netNorm, emLink, emBrokers, emUrl, netHtml, renderCast, audioTick, fillAudioCfg, saveAudioCfg, audioPreview, audioConfirm, audioRearm, audioUrgentAnswered, sendChat, fitMtAlerts, mtJump, mtFreshOff, mtRearm, setImportText, impTally, errPopPlace, impSortRows, imp: () => IMP, impEd: () => IMP_ED && { k: IMP_ED.inp.dataset.k, row: IMP_ED.inp.dataset.row }, cellPop: () => ({ open: !!CELLPOP.inp, inline: CELLPOP.inline }), errPop: () => ({ open: !!ERRPOP.btn, pinned: ERRPOP.pinned, inline: !!ERRPOP.inline }), mtAnchorSave, mtAnchorApply, mtAnchor: () => MT_ANCHOR, mtTapState: () => ({ touch: Array.from(MT_TOUCH), tap: MT_TAP && { pid: MT_TAP.pid, id: MT_TAP.id, cap: MT_TAP.cap } }), setAppLang, mtNew: () => Array.from(MT_NEW), mtIds, mtOrder: () => MT_ORDER && MT_ORDER.map(e => Object.assign({}, e)), auMuteBtn, renderChat, callEditFix, applyEdit, undo, loadNew, impDoImport, dw: () => Object.assign({}, DW), dwCtl: () => DWCTL.k, dwTip: () => DTIP } };   // _test: solo para tests/control.test.js
})();
