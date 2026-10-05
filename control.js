/* Showtime — control.js · Panel de Control
 * El regidor crea y manda en los horarios: festival, escenarios y bandas se crean aquí.
 * REGLA DE ORO: nada se cambia solo. Cada cambio de datos lo hace el regidor con una acción explícita.
 * Las reglas de tiempo salen de core.js; el estado compartido y la sincronización, de datos.js.
 */
(function () {
  'use strict';
  const C = window.ShowtimeCore;
  const Dt = window.ShowtimeDatos;
  const $ = id => document.getElementById(id);

  // ── Estado (declarado antes de usarse) ───────────────────────────────
  let FEST = null, ORIG = null, CONFIG = Dt.getConfig();
  let BLOCKS = [], ALL_MODE = [], DAY_MISSING = '';
  const UNDO = [];                 // festivales anteriores (JSON), para «Deshacer»
  const UNDO_MAX = 30;
  let liveWin = null;
  let pendingRender = false;       // si llegan datos mientras se edita una casilla, se pinta al salir
  const KEY_LABEL = { nombre: 'nombre', escenario: 'escenario', color: 'color', jornada: 'jornada', fecha: 'fecha', inicio: 'inicio', fin: 'fin', call: 'CALL', notas: 'notas' };

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
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 4500 : 2600);
  }
  function modeName(m) { return (m || CONFIG.mode) === 'sc' ? 'soundcheck' : 'show'; }

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
    compute();
  }

  function compute() {
    if (!FEST) { BLOCKS = []; ALL_MODE = []; DAY_MISSING = ''; return; }
    const day = CONFIG.day || 'all';
    DAY_MISSING = (day !== 'all' && C.festivalDays(FEST, CONFIG.mode).indexOf(day) < 0) ? day : '';
    BLOCKS = DAY_MISSING ? [] : C.buildBlocks(FEST, { mode: CONFIG.mode, day: day });
    ALL_MODE = C.buildBlocks(FEST, { mode: CONFIG.mode, day: 'all' });
  }

  /** Aplica un festival nuevo hecho por el regidor: guarda deshacer, sincroniza y pinta. */
  function commitFestival(next, msg) {
    UNDO.push(JSON.stringify(FEST));
    if (UNDO.length > UNDO_MAX) UNDO.shift();
    FEST = next;
    Dt.setFestival(FEST);
    compute();
    renderAll();
    if (msg) toast(msg);
  }

  function undo() {
    if (!UNDO.length) return;
    FEST = JSON.parse(UNDO.pop());
    Dt.setFestival(FEST);
    compute(); renderAll();
    toast('Deshecho');
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
    const has = !!FEST;
    $('main').hidden = !has;
    $('empty').hidden = has;
    $('btn-export').disabled = !has;
    $('btn-undo').disabled = !UNDO.length;
    $('btn-undo').querySelector('span').textContent = UNDO.length ? 'Deshacer (' + UNDO.length + ')' : 'Deshacer';
    $('fest-name').textContent = has ? ((FEST.event && FEST.event.nombre) || 'Evento sin nombre') : 'Sin evento';
    const d = has && ORIG ? C.diffSummary(ORIG, FEST) : { total: 0 };
    $('mods').hidden = !d.total;
    $('mods').textContent = d.total + (d.total === 1 ? ' cambio sin exportar' : ' cambios sin exportar');
    $('mods').title = d.total ? [d.added && d.added + ' banda(s) nueva(s)', d.removed && d.removed + ' borrada(s)', d.fields && d.fields + ' casilla(s) cambiada(s)', d.festival && 'datos del evento o escenarios'].filter(Boolean).join(' · ') : '';
    renderTools();
    renderWarn();
    if (!$('cfg').hidden) renderConfig();
    if (has) { renderTable(); renderAddRow(); tick(); }
  }

  function renderTools() {
    $('mode-show').classList.toggle('on', CONFIG.mode === 'show');
    $('mode-sc').classList.toggle('on', CONFIG.mode === 'sc');
    // Pestañas de jornadas: «Todas» + de la primera a la última del festival (las vacías, atenuadas)
    const days = jornadaOptions();
    const withData = FEST ? C.festivalDays(FEST, CONFIG.mode) : [];
    const tab = (v, label, cls, title) => '<button role="tab" data-day="' + esc(v) + '" class="' + cls + (CONFIG.day === v ? ' on' : '') + '" aria-selected="' + (CONFIG.day === v) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
    let html = FEST ? tab('all', 'Todas', '', 'Todas las jornadas') : '';
    html += days.map(d => tab(d, fmtDay(d), withData.indexOf(d) < 0 ? 'vacia' : '', withData.indexOf(d) < 0 ? 'Sin ' + (CONFIG.mode === 'sc' ? 'soundchecks' : 'shows') + ' todavía' : '')).join('');
    if (FEST && CONFIG.day !== 'all' && days.indexOf(CONFIG.day) < 0) html += tab(CONFIG.day, fmtDay(CONFIG.day), 'falta', 'Fuera de las jornadas del evento');
    $('days').innerHTML = html;
  }

  function renderWarn() {
    const w = $('warn');
    let msg = '';
    if (FEST && !(FEST.escenarios || []).length) msg = 'Este evento no tiene escenarios. Créalos en Configuración › Escenarios antes de añadir bandas (o añade bandas sin escenario).';
    else if (DAY_MISSING) msg = 'El ' + fmtDay(DAY_MISSING) + ' todavía no tiene ' + (CONFIG.mode === 'sc' ? 'soundchecks' : 'shows') + '. La Pantalla Live lo está avisando.';
    w.textContent = msg; w.hidden = !msg;
  }

  // Opciones de escenario para un <select>
  function stageOptions(selected, allowNone) {
    const st = (FEST.escenarios || []);
    let h = (allowNone || !st.length || !selected) ? '<option value=""' + (!selected ? ' selected' : '') + '>' + (st.length ? '— elige —' : '— sin escenario —') + '</option>' : '';
    h += st.map(e => '<option value="' + esc(e.id) + '"' + (e.id === selected ? ' selected' : '') + '>' + esc(e.nombre) + '</option>').join('');
    return h;
  }
  function jornadaSelect(value, attrs) {
    const opts = jornadaOptions();
    if (value && opts.indexOf(value) < 0) opts.push(value);
    return '<select ' + attrs + '>' + (value ? '' : '<option value="" selected>— elige —</option>') +
      opts.sort().map(d => '<option value="' + d + '"' + (d === value ? ' selected' : '') + '>' + esc(fmtDay(d)) + '</option>').join('') + '</select>';
  }

  // Fila editable de una banda (con o sin horario en el modo actual)
  function rowHtml(a, b, mods, isNew) {
    const mode = CONFIG.mode;
    const m = mods[a.id] || [];
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
    let gap = '<span class="dash">—</span>';
    if (b) {
      const co = C.changeoverBefore(ALL_MODE, ALL_MODE.find(x => String(x.id) === String(b.id)) || b);
      if (!co) gap = '<span class="dash" title="Primera actuación de su escenario">—</span>';
      else if (co.mins < 0) gap = '<span class="gapbtn ovl" title="Empieza antes de que acabe ' + esc(co.prev.name) + '">Solapa ' + (-co.mins) + ' min</span>';
      else gap = b.standby
        ? '<button class="gapbtn sb" data-act="standby" data-on="0" title="Marcado como STANDBY. Pulsa para volver a CHANGEOVER"><svg class="ic"><use href="#i-pause"/></svg>Standby · ' + co.mins + ' min</button>'
        : '<button class="gapbtn" data-act="standby" data-on="1" title="CHANGEOVER. Pulsa para marcarlo como STANDBY (escenario cerrado o descanso)"><svg class="ic"><use href="#i-swap"/></svg>Cambio · ' + co.mins + ' min</button>';
    }
    return '<tr data-id="' + esc(a.id) + '"' + (isNew ? ' class="nueva"' : '') + '>' +
      td('escenario', 'stage', '<select data-k="escenario" data-orig="' + esc(a.escenarioId || '') + '" style="--sc:' + scol + '">' + stageOptions(a.escenarioId || '', !esc0) + '</select>') +
      '<td class="name' + (isMod('nombre') || isMod('color') ? ' mod' : '') + '"><div class="nm">' +
        '<input type="color" data-k="color" value="' + col + '" data-orig="' + col + '" title="Color de la banda">' +
        '<input type="text" data-k="nombre" value="' + esc(a.nombre || '') + '" data-orig="' + esc(a.nombre || '') + '" autocomplete="off" spellcheck="false">' +
        (isNew ? '<span class="tag" title="Creada desde la última importación/exportación">NUEVA</span>' : '') + '</div></td>' +
      td('fecha', 'f', jornadaSelect(jor, 'data-k="jornada" data-orig="' + esc(jor) + '"') + real) +
      td('inicio', 't', inp('inicio')) +
      td('fin', 't', inp('fin', '—')) +
      td('call', 't', inp('call', '—')) +
      td('notas', 'n', inp('notas')) +
      td('standby', 'gap', gap) +
      '<td><div class="rowbtns"><button class="delbtn dupbtn" data-act="dup" title="Duplicar en otra jornada"><svg class="ic"><use href="#i-copy"/></svg></button>' +
        '<button class="delbtn" data-act="del" title="Borrar banda"><svg class="ic"><use href="#i-trash"/></svg></button></div></td>' +
      '</tr>';
  }

  // Lista de bandas del modo y día elegidos + las que aún no tienen horario en este modo
  function renderTable() {
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('#tbody, #tbody-sin') && ae.matches('input,select')) { pendingRender = true; return; }
    pendingRender = false;
    const mode = CONFIG.mode;
    const mods = ORIG ? C.modifiedFields(ORIG, FEST, mode) : {};
    const nuevas = new Set((ORIG ? C.newArtistIds(ORIG, FEST) : []).map(String));
    $('list-title').textContent = (mode === 'sc' ? 'Soundchecks' : 'Shows') + (CONFIG.day === 'all' ? ' · todas las jornadas' : ' · ' + fmtDay(CONFIG.day));
    const rows = BLOCKS.map(b => {
      const a = FEST.artists.find(x => String(x.id) === String(b.id));
      return a ? rowHtml(a, b, mods, nuevas.has(String(a.id))) : '';
    });
    $('tbody').innerHTML = rows.join('') || '<tr><td colspan="9" class="hint" style="padding:16px">' +
      (FEST.artists.length ? 'No hay ' + (mode === 'sc' ? 'soundchecks' : 'shows') + ' en esta jornada. Añádelos abajo.' : 'Todavía no hay bandas. Añade la primera en la fila de abajo.') + '</td></tr>';
    const sin = FEST.artists.filter(a => !C.entersMode(a, mode));
    $('tbody-sin').innerHTML = sin.length
      ? '<tr class="sec"><td colspan="9">Sin horario de ' + modeName() + ' (' + sin.length + ') · elige jornada y escribe el inicio</td></tr>' + sin.map(a => rowHtml(a, null, mods, nuevas.has(String(a.id)))).join('')
      : '';
    markRows(Math.floor(C.nowAbs()));
  }

  // Fila de alta: mantiene escenario y jornada elegidos; no propone horas.
  function renderAddRow() {
    const sEsc = $('add-escenario'), prevEsc = sEsc.value;
    sEsc.innerHTML = stageOptions(prevEsc && C.getEscenario(FEST, prevEsc) ? prevEsc : '', true);
    const sJor = $('add-jornada'), prevJor = sJor.value;
    const want = prevJor || (CONFIG.day !== 'all' ? CONFIG.day : '');
    sJor.outerHTML = jornadaSelect(jornadaOptions().indexOf(want) >= 0 ? want : '', 'id="add-jornada" data-f="jornada"');
    $('btn-add').lastChild.textContent = 'Añadir ' + (CONFIG.mode === 'sc' ? 'soundcheck' : 'banda');
    $('add-nombre').placeholder = 'Nombre de la banda';
    updateAddHint();
  }

  function addValues() {
    const g = id => $(id).value;
    return { nombre: g('add-nombre'), escenarioId: g('add-escenario'), jornada: g('add-jornada'), inicio: g('add-inicio'),
      fin: g('add-fin'), duracion: g('add-duracion'), call: g('add-call'), notas: g('add-notas') };
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
    const r = C.addArtist(FEST, CONFIG.mode, addValues());
    if (!r.ok) {
      $('add-err').textContent = r.error;
      const f = r.field && document.querySelector('#addrow [data-f="' + r.field + '"]');
      if (f) { f.classList.add('bad'); f.focus(); }
      return;
    }
    $('add-err').textContent = '';
    const name = (r.state.artists.find(x => x.id === r.id) || {}).nombre || '';
    ['add-nombre', 'add-inicio', 'add-fin', 'add-duracion', 'add-call', 'add-notas'].forEach(id => { $(id).value = ''; });
    // Si la jornada nueva no es la que se está viendo, no se cambia el filtro: se avisa.
    const jor = $('add-jornada').value;
    commitFestival(r.state, 'Añadida: ' + name + (CONFIG.day !== 'all' && CONFIG.day !== jor ? ' (en ' + fmtDay(jor) + ', no en la jornada que estás viendo)' : ''));
    const row = document.querySelector('#tbody tr[data-id="' + r.id + '"]');
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
    $('add-nombre').focus();
  }

  $('addrow').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); addBand(); }
  });
  $('addrow').addEventListener('input', e => { $('add-err').textContent = ''; e.target.classList.remove('bad'); updateAddHint(); });
  $('addrow').addEventListener('change', e => { e.target.classList.remove('bad'); updateAddHint(); });
  $('btn-add').addEventListener('click', addBand);

  // Filas que suenan / siguientes / pasadas (solo clases: no rehace las casillas)
  function markRows(nowInt) {
    const playing = new Set(C.playingNow(BLOCKS, nowInt).map(b => String(b.id)));
    const next = new Set(C.nextPerStage(BLOCKS, nowInt).map(b => String(b.id)));
    document.querySelectorAll('#tbody tr[data-id]').forEach(tr => {
      const id = tr.dataset.id, b = BLOCKS.find(x => String(x.id) === id);
      tr.classList.toggle('playing', playing.has(id));
      tr.classList.toggle('next', next.has(id));
      tr.classList.toggle('done', !!b && b.si !== null && C.blockEnd(b) <= nowInt);
    });
  }

  // Vista en vivo (mismas reglas que la Pantalla Live)
  function renderLive(nowMins, nowInt) {
    const order = id => { const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === id); return i < 0 ? 999 : i; };
    const rows = [];
    C.playingNow(BLOCKS, nowInt).forEach(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), p = C.progress(b, nowInt);
      rows.push({ o: order(b.stageId), h: '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + '</div>' +
        '<div class="v-rem" style="color:' + col + '">' + p.remaining + ' min restantes</div></div>' });
    });
    C.changeoversNow(BLOCKS, nowMins).forEach(co => {
      const col = safeColor(co.stageColor || co.next.color, '#888');
      rows.push({ o: order(co.stageId), h: '<div class="v-row co' + (co.standby ? ' sb' : '') + '" style="--c:' + col + '"><div class="v-name" style="color:' + (co.standby ? 'var(--muted)' : col) + '">' +
        (co.standby ? 'STANDBY' : 'CHANGEOVER') + (co.stage ? ' · ' + esc(co.stage) : '') + '</div>' +
        '<div class="v-meta">' + (co.standby ? 'después' : 'entra') + ' <b>' + esc(co.next.name) + '</b> · ' + C.fmtHM(co.next.si) + '</div>' +
        '<div class="v-rem">quedan ' + fmtCountdown(co.remaining) + '</div></div>' });
    });
    rows.sort((a, b) => a.o - b.o);
    const r = C.pickBlocks(BLOCKS, nowInt, 1);
    $('v-now').innerHTML = rows.length ? rows.map(x => x.h).join('') : '<div class="v-empty">' + (DAY_MISSING ? 'Jornada sin datos' : r.ended ? 'FIN DE JORNADA' : '—') + '</div>';

    const next = C.nextPerStage(BLOCKS, nowInt);
    $('v-next').innerHTML = next.length ? next.map(b => {
      const col = safeColor(b.stageColor || b.color, '#888'), co = C.changeoverBefore(BLOCKS, b);
      const badge = co ? (co.mins < 0 ? 'Solapa ' + (-co.mins) + ' min' : (b.standby ? 'Standby ' : 'Cambio ') + co.mins + ' min') : '';
      return '<div class="v-row" style="--c:' + col + '"><div class="v-name">' + esc(b.name) + '</div>' +
        '<div class="v-meta">' + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + (b.stage ? ' · ' + esc(b.stage) : '') + (badge ? ' · ' + badge : '') + '</div></div>';
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
    const on = !!(liveWin && !liveWin.closed);
    $('live-state').className = 'state ' + (on ? 'on' : 'off');
    $('live-state').textContent = on ? 'Live abierta' : 'Live cerrada';
    $('btn-live').lastChild.textContent = on ? 'Traer Pantalla Live' : 'Abrir Pantalla Live';
    if (!FEST) return;
    const nowMins = C.nowAbs(d), nowInt = Math.floor(nowMins);
    renderLive(nowMins, nowInt);
    markRows(nowInt);
    renderDaybar(nowInt);
  }

  // ── Edición en la lista ──────────────────────────────────────────────
  /** Aplica la casilla. `then` = casilla a la que iba el foco (para no perderlo al repintar). */
  function applyEdit(el, then) {
    const tr = el.closest('tr'); if (!tr || !document.body.contains(el)) return;
    const id = tr.dataset.id, k = el.dataset.k;
    if (!k || el.value === el.dataset.orig) { el.classList.remove('bad'); return; }
    const r = C.editArtist(FEST, id, CONFIG.mode, k, el.value);
    if (!r.ok) { el.classList.add('bad'); el.title = r.error; toast(r.error, true); return; }
    el.classList.remove('bad'); el.title = '';
    if (!r.changed) { el.value = el.dataset.orig; return; }
    const name = (r.state.artists.find(a => String(a.id) === String(id)) || {}).nombre || '';
    el.dataset.orig = el.value;      // evita aplicarlo dos veces (Intro + salir de la casilla)
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbody, #tbody-sin')) document.activeElement.blur();
    let shown = r.value || '—';
    if (k === 'jornada') shown = fmtDay(r.value);
    else if (k === 'escenario') { const e = C.getEscenario(r.state, r.value); shown = e ? e.nombre : 'sin escenario'; }
    commitFestival(r.state, name + ': ' + KEY_LABEL[k] + ' → ' + shown);
    const row = document.querySelector('#tbody tr[data-id="' + CSS.escape(String(id)) + '"], #tbody-sin tr[data-id="' + CSS.escape(String(id)) + '"]');
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
    else if (k === 'jornada' || k === 'inicio') toast(name + ': ahora está en ' + fmtDay(C.jornadaOf(FEST, FEST.artists.find(a => String(a.id) === String(id)), CONFIG.mode)) + ' (fuera de la jornada que estás viendo)');
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
    tb.addEventListener('change', e => { if (e.target.matches('select, input[type=color]')) applyEdit(e.target); });
    tb.addEventListener('click', e => {
      const sb = e.target.closest('[data-act="standby"]');
      if (sb) {
        const id = sb.closest('tr').dataset.id, on = sb.dataset.on === '1';
        const r = C.setStandby(FEST, id, CONFIG.mode, on);
        if (r.ok && r.changed) commitFestival(r.state, on ? 'Hueco marcado como STANDBY' : 'Hueco vuelve a CHANGEOVER');
        return;
      }
      const del = e.target.closest('[data-act="del"]');
      if (del) askDelete(del.closest('tr').dataset.id);
      const dup = e.target.closest('[data-act="dup"]');
      if (dup) askDuplicate(dup.closest('tr').dataset.id);
    });
  });

  function askDelete(id) {
    const a = FEST.artists.find(x => String(x.id) === String(id)); if (!a) return;
    const has = ['show', 'sc'].filter(m => C.entersMode(a, m)).map(m => m === 'sc' ? 'soundcheck' : 'show');
    modal('Borrar banda', '<p>¿Borrar <b>' + esc(a.nombre) + '</b>' + (has.length ? ' con su horario de ' + has.join(' y ') : '') + '?</p><p style="margin-top:8px">Se puede recuperar con Deshacer.</p>',
      [{ label: 'Cancelar' }, { label: 'Borrar', kind: 'danger', run: () => { const r = C.removeArtist(FEST, id); if (r.ok) commitFestival(r.state, 'Borrada: ' + a.nombre + ' (Deshacer para recuperarla)'); } }]);
  }

  // Duplicar en otra jornada: copia escenario, color y notas; la hora la escribe el regidor.
  function askDuplicate(id) {
    const a = FEST.artists.find(x => String(x.id) === String(id)); if (!a) return;
    const e0 = C.getEscenario(FEST, a.escenarioId);
    const html = '<p>Copia <b>' + esc(a.nombre) + '</b>' + (e0 ? ' (' + esc(e0.nombre) + ')' : '') + ' con su color y notas en otra jornada de ' + modeName() + '.</p>' +
      '<div class="form" style="margin-top:12px">' +
      '<label for="d-nombre">Nombre</label><input id="d-nombre" type="text" value="' + esc(a.nombre) + '" autocomplete="off">' +
      '<label for="d-jor">Jornada</label>' + jornadaSelect('', 'id="d-jor"') +
      '<label for="d-ini">Inicio</label><input id="d-ini" type="text" placeholder="21:00" style="width:90px" autocomplete="off">' +
      '<label for="d-fin">Fin</label><div><input id="d-fin" type="text" placeholder="fin" style="width:90px" autocomplete="off"> o <input id="d-dur" type="text" inputmode="numeric" placeholder="min" style="width:70px" autocomplete="off"> min</div>' +
      '<label for="d-call">CALL</label><input id="d-call" type="text" placeholder="—" style="width:90px" autocomplete="off">' +
      '<div id="d-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
    modal('Duplicar en otra jornada', html, [{ label: 'Cancelar' }, { label: 'Duplicar', kind: 'primary', run: () => {
      const r = C.duplicateArtist(FEST, id, CONFIG.mode, { nombre: $('d-nombre').value, jornada: $('d-jor').value, inicio: $('d-ini').value, fin: $('d-fin').value, duracion: $('d-dur').value, call: $('d-call').value });
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

  // OK de CALL desde el Panel
  $('v-call').addEventListener('click', e => {
    const b = e.target.closest('.okbtn'); if (!b) return;
    Dt.markCallDone(b.dataset.ck, Math.floor(C.nowAbs()));
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
      '<div id="f-err" class="err" style="grid-column:1/-1;margin:0"></div></div>';
  }
  function readFestForm() {
    return { nombre: $('f-nombre').value, fechaInicio: $('f-ini').value, fechaFin: $('f-fin').value || $('f-ini').value, dayCutoff: $('f-cut').value, callMins: $('f-call').value };
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
      loadNew(r.state, 'Evento creado: ' + r.state.event.nombre + '. Ahora crea los escenarios.');
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
  }

  function saveFest() {
    const r = C.updateEvent(FEST, readFestForm());
    if (!r.ok) { $('f-err').textContent = r.error; return; }
    if (CONFIG.callMins) CONFIG = Dt.setConfig({ callMins: null });   // un único aviso CALL: el del festival
    if (r.changed) { document.activeElement && document.activeElement.blur(); commitFestival(r.state, 'Datos del evento guardados'); }
    else toast('Sin cambios');
  }

  // ── Escenarios (dentro de Configuración) ─────────────────────────────
  function stagesHtml() {
    const st = FEST.escenarios || [];
    return (st.length ? '' : '<p class="hint" style="margin-bottom:6px">Todavía no hay escenarios.</p>') +
      st.map((e, i) => {
        const n = C.stageUse(FEST, e.id);
        return '<div class="stg" data-id="' + esc(e.id) + '">' +
          '<input type="color" data-s="color" value="' + hex6(e.color, '#888888') + '" title="Color del escenario">' +
          '<input type="text" data-s="nombre" value="' + esc(e.nombre) + '" data-orig="' + esc(e.nombre) + '" autocomplete="off">' +
          '<span class="use">' + n + (n === 1 ? ' banda' : ' bandas') + '</span>' +
          '<button class="iconsq" data-s="up" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="iconsq" data-s="down" title="Bajar"' + (i === st.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="delbtn" data-s="del" title="' + (n ? 'Tiene bandas: muévelas o bórralas antes' : 'Borrar escenario') + '"' + (n ? ' disabled' : '') + '><svg class="ic"><use href="#i-trash"/></svg></button></div>';
      }).join('') +
      '<div class="stg" style="border:0;margin-top:8px"><input id="s-new" type="text" placeholder="Nuevo escenario (p. ej. Principal)" autocomplete="off"><button id="s-add" class="btn primary"><svg class="ic"><use href="#i-plus"/></svg>Añadir</button></div>' +
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
    const add = () => stageCommit(C.addStage(FEST, $('s-new').value), 'Escenario añadido', true);
    $('s-add').addEventListener('click', add);
    $('s-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    $('s-new').addEventListener('input', () => { $('s-err').textContent = ''; });
    body.querySelectorAll('.stg[data-id]').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-s="color"]').addEventListener('change', e => stageCommit(C.updateStage(FEST, id, { color: e.target.value }), 'Color del escenario cambiado'));
      const nm = row.querySelector('[data-s="nombre"]');
      const saveName = () => { if (nm.value !== nm.dataset.orig) stageCommit(C.updateStage(FEST, id, { nombre: nm.value }), 'Escenario renombrado'); };
      nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } else if (e.key === 'Escape') { nm.value = nm.dataset.orig; } });
      nm.addEventListener('change', saveName);
      row.querySelector('[data-s="up"]').addEventListener('click', () => stageCommit(C.moveStage(FEST, id, -1), 'Orden cambiado'));
      row.querySelector('[data-s="down"]').addEventListener('click', () => stageCommit(C.moveStage(FEST, id, 1), 'Orden cambiado'));
      row.querySelector('[data-s="del"]').addEventListener('click', () => stageCommit(C.removeStage(FEST, id), 'Escenario borrado'));
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
    toast('Estilo del panel: ' + e.target.selectedOptions[0].textContent);
  });
  $('cfg-style-live').addEventListener('change', e => {
    CONFIG = Dt.setConfig({ style: e.target.value });
    toast('Estilo de la Pantalla Live: ' + e.target.selectedOptions[0].textContent);
  });
  applyPanelStyle(panelStyle());

  // Archivo (barra superior)
  $('btn-new').addEventListener('click', () => { closeConfig(); askNew(); });
  $('btn-open').addEventListener('click', () => { closeConfig(); $('file').click(); });

  // ── Herramientas ─────────────────────────────────────────────────────
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    CONFIG = Dt.setConfig({ mode: b.dataset.mode }); compute(); renderAll();
  }));
  $('days').addEventListener('click', e => {
    const b = e.target.closest('button[data-day]'); if (!b) return;
    CONFIG = Dt.setConfig({ day: b.dataset.day }); compute(); renderAll();
  });
  $('btn-undo').addEventListener('click', undo);
  $('btn-new2').addEventListener('click', askNew);

  // ── Pantalla Live (ventana emergente) ────────────────────────────────
  function openLive() {
    if (liveWin && !liveWin.closed) { try { liveWin.focus(); } catch (e) {} return; }
    liveWin = window.open('live.html', 'showtime-live', 'popup=yes,width=1280,height=720');
    if (!liveWin) {
      modal('Ventana emergente bloqueada', '<p>El navegador no ha dejado abrir la Pantalla Live. Permite las ventanas emergentes para Showtime (icono en la barra de direcciones) y vuelve a pulsar el botón.</p>', [{ label: 'Entendido', kind: 'primary' }]);
      return;
    }
    Dt.addPeer(liveWin);
    tick();
  }
  $('btn-live').addEventListener('click', openLive);

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
    const dShow = C.festivalDays(s, 'show'), dSc = C.festivalDays(s, 'sc');
    let html = '<p>Archivo: <b>' + esc(fname) + '</b></p><ul>' +
      '<li>Evento: <b>' + esc(ev.nombre || 'sin nombre') + '</b></li>' +
      '<li>' + s.artists.length + ' bandas · ' + s.escenarios.length + ' escenarios</li>' +
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
    const blob = new Blob([JSON.stringify(FEST, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    // Lo exportado pasa a ser la referencia: los cambios ya están guardados en ese archivo.
    ORIG = JSON.parse(JSON.stringify(FEST)); Dt.setOriginal(ORIG);
    renderAll();
    toast('Exportado: ' + name);
  }

  $('btn-import2').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
  $('btn-export').addEventListener('click', exportJSON);
  function askDemo() {
    modal('Evento de demostración', '<p>Carga un evento de ejemplo con horarios alrededor de la hora actual, para probar el Panel y la Pantalla Live.</p>',
      [{ label: 'Cancelar' }, { label: 'Cargar demo', kind: 'primary', run: () => loadNew(C.demoFestival(Math.floor(C.nowAbs())), 'Demo cargada') }]);
  }
  $('btn-demo').addEventListener('click', askDemo);

  // Arrastrar y soltar el JSON en cualquier parte del Panel
  let dragN = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) { dragN++; $('drop').hidden = false; } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; if (e.dataTransfer && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

  // ── Sincronización con la Pantalla Live ──────────────────────────────
  Dt.onChange(type => {
    if (type === 'callDone') { tick(); return; }
    loadState(); renderAll();
  });

  // ── Pantalla siempre encendida ───────────────────────────────────────
  let wakeLock = null;
  async function requestWake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      $('wake').hidden = false;
      wakeLock.addEventListener('release', () => { wakeLock = null; $('wake').hidden = true; });
    } catch (e) { $('wake').hidden = true; }
  }
  document.addEventListener('visibilitychange', requestWake);
  document.addEventListener('pointerdown', requestWake);

  // ── Arranque ─────────────────────────────────────────────────────────
  loadState();
  renderAll();
  tick();
  setInterval(tick, 1000);
  requestWake();
  window.ShowtimePanel = { reload: () => { loadState(); renderAll(); } };
})();
