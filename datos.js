/* Showtime — datos.js
 * Estado compartido entre el Panel de Control y la Pantalla Live, y sincronización.
 *
 * Guarda en el navegador (localStorage) y avisa a las otras ventanas por tres vías:
 *   1) mensaje directo entre ventanas (window.opener / ventana abierta) — funciona incluso
 *      con doble clic en Firefox, donde cada archivo local tiene su propio almacenamiento;
 *   2) BroadcastChannel('showtime');
 *   3) evento 'storage' (respaldo).
 * Los mensajes llevan los datos completos, así que no dependen de compartir almacenamiento.
 */
(function (root) {
  'use strict';

  const APP = 'showtime';
  const K = {
    festival: 'showtime.festival',     // proyecto Stage Master importado (con ajustes)
    config:   'showtime.config',       // { mode: show|sc|all, day, style, callMins }
    callDone: 'showtime.callDone',     // [callKey, ...] avisos marcados con OK
    original: 'showtime.original',     // copia del festival tal como se importó (para marcar cambios)
    flash:    'showtime.flash',        // mensaje flash activo en la Pantalla Live: { id, text, at (ms) } o null
    chat:     'showtime.chat',         // chat Producción ↔ Stage Manager: [{ id, at, from, pid, text, sm }] (NO va en la emisión general: solo a los enlaces de Producción)
    avisos:   'showtime.avisos',       // avisos escritos a mano (cinta de Backstage + barra del Dashboard): [{ id, text, at, ms (0 = permanente), from }]
    meteo:    'showtime.meteo'         // el tiempo (2e-B): { snap, err, errAt } — lo pide el Dashboard; la Live y los dispositivos lo leen
  };
  const STYLES = ['clasico', 'escenario', 'neutro', 'raycast'];
  const DEFAULT_CONFIG = { mode: 'show', day: 'all', style: 'clasico', callMins: null, msgBg: '#000000', msgFg: '#ffb347', msgSecs: 20, avisoSecs: 120 };
  const MSG_SECS = [10, 20, 30, 60, 0];   // 0 = hasta retirarlo
  const AVISO_SECS = [60, 120, 300, 600, 900];   // avisos puntuales en la cinta: la cinta tarda en dar la vuelta, necesitan más tiempo que un mensaje

  // Modo Staff (2d-A): la Live abierta desde el QR («live.html#sala=…») es SOLO LECTURA. Sus datos llegan por la
  // emisión y viven en memoria: no se mezclan con lo que este navegador tenga guardado ni se pueden cambiar.
  const READONLY = !!(root.location && /^#?(.*&)?sala=/.test(root.location.hash || ''));
  const mem = READONLY ? new Map() : null;
  const writeHooks = [];

  function read(key, fallback) {
    if (mem) { const v = mem.get(key); return v === undefined || v === null ? fallback : JSON.parse(v); }
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    if (mem) { mem.set(key, JSON.stringify(value)); return true; }
    let okw = true;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { okw = false; }
    writeHooks.forEach(fn => { try { fn(key); } catch (e) { console.error(e); } });   // p. ej. la emisión a los móviles
    return okw;
  }

  function normStyle(v) {
    if (v === 'oled') v = 'raycast';          // nombres antiguos de Stage Master
    if (v === 'ambar') v = 'escenario';
    return STYLES.indexOf(v) >= 0 ? v : 'clasico';
  }
  function normConfig(c) {
    const o = Object.assign({}, DEFAULT_CONFIG, c || {});
    o.mode = (o.mode === 'sc' || o.mode === 'soundcheck') ? 'sc' : o.mode === 'all' ? 'all' : 'show';
    o.style = normStyle(o.style);
    o.day = o.day || 'all';
    o.callMins = Number.isFinite(o.callMins) && o.callMins > 0 ? o.callMins : null;
    // Categorías BLOQUEADAS para los retrasos, por zona: { all: {…}, <idZona>: {…}, '': sin zona }. Por defecto nada: todo se mueve.
    let db = o.delayBlock || {};
    if (db.show !== undefined || db.sc !== undefined || db.tarea !== undefined || db.hito !== undefined) db = { all: db };   // formato anterior (solo global)
    const cb = x => ({ show: !!(x && x.show === true), sc: !!(x && x.sc === true), tarea: !!(x && x.tarea === true), hito: !!(x && x.hito === true) });
    o.delayBlock = {};
    Object.keys(db).forEach(k => { o.delayBlock[k] = cb(db[k]); });
    if (!o.delayBlock.all) o.delayBlock.all = cb({});
    delete o.delayCats;
    const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    if (!hex(o.msgBg)) o.msgBg = DEFAULT_CONFIG.msgBg;
    if (!hex(o.msgFg)) o.msgFg = DEFAULT_CONFIG.msgFg;
    o.msgSecs = MSG_SECS.indexOf(Number(o.msgSecs)) >= 0 ? Number(o.msgSecs) : DEFAULT_CONFIG.msgSecs;
    o.avisoSecs = AVISO_SECS.indexOf(Number(o.avisoSecs)) >= 0 ? Number(o.avisoSecs) : DEFAULT_CONFIG.avisoSecs;
    // Pantallas Live y vistas (2e-A): umbrales de Confidence, bloques de Backstage y cinta de avisos
    if (root.ShowtimeVistas) o.screens = root.ShowtimeVistas.normScreens(o.screens);
    if (root.ShowtimeMeteo) o.meteo = root.ShowtimeMeteo.normMeteo(o.meteo);   // el tiempo (2e-B): fuente, lugar y umbrales del regidor
    o.delayZone = typeof o.delayZone === 'string' ? o.delayZone : 'all';   // zona que se está editando en el menú Retrasos
    return o;
  }

  // ── Lectura / escritura ──────────────────────────────────────────────
  function getFestival() { return read(K.festival, null); }
  function getConfig() { return normConfig(read(K.config, null)); }
  function getOriginal() { return read(K.original, null); }
  function setOriginal(f) { write(K.original, f); }
  function getCallDone() { const a = read(K.callDone, []); return Array.isArray(a) ? a : []; }
  const FLASH_MS = 20000;   // duración por defecto (mensajes antiguos sin duración propia)
  /** Duración de un mensaje en ms (0 = hasta retirarlo). */
  function flashMs(f) { return f && Number.isFinite(f.ms) ? f.ms : FLASH_MS; }
  /** Milisegundos que le quedan (null si no se cierra solo). */
  function flashLeft(f) { const ms = flashMs(f); return ms ? Math.max(0, ms - (Date.now() - f.at)) : null; }
  /** Mensaje flash vigente (o null si no hay o ya caducó). */
  /** El tiempo: último dato recibido y último error ({ snap, err, errAt } o null). */
  function getMeteo() { const m = read(K.meteo, null); return m && typeof m === 'object' ? m : null; }
  function getFlash() { const f = read(K.flash, null); return f && f.text && (flashMs(f) === 0 || Date.now() - f.at < flashMs(f)) ? f : null; }

  /** Avisos vigentes: válidos y sin caducar (los permanentes, ms = 0, no caducan: solo los quita el Stage Manager). */
  const AVISOS_MAX = 20;
  function normAvisos(list, now) {
    if (!Array.isArray(list)) return [];
    return list.filter(a => a && typeof a.id === 'string' && typeof a.text === 'string' && a.text.trim() && Number.isFinite(a.at) && Number.isFinite(a.ms) && a.ms >= 0
      && (a.ms === 0 || now - a.at < a.ms)).slice(-AVISOS_MAX)
      .map(a => ({ id: a.id, text: a.text.slice(0, 140), at: a.at, ms: a.ms, from: typeof a.from === 'string' ? a.from.slice(0, 80) : '' }));
  }
  function getAvisos() { return normAvisos(read(K.avisos, []), Date.now()); }
  const CHAT_MAX = 300;
  function getChat() { const a = read(K.chat, []); return Array.isArray(a) ? a.filter(x => x && typeof x.text === 'string') : []; }

  /** Minutos de aviso efectivos: los de la configuración o, si no hay, los del festival. */
  function callMinsOf(festival, config) {
    if (config && config.callMins) return config.callMins;
    const v = festival && festival.event && Number(festival.event.callMins);
    return Number.isFinite(v) && v > 0 ? v : 15;
  }

  /** Quita avisos de hace más de 2 días (la clave termina en @minutosAbsolutos). */
  function pruneCallDone(list, nowAbs) {
    return list.filter(k => {
      const m = Number(String(k).split('@').pop());
      return !Number.isFinite(m) || m > nowAbs - 2880;
    });
  }

  // ── Sincronización ───────────────────────────────────────────────────
  let bc = null;
  if (!READONLY) { try { bc = new BroadcastChannel(APP); } catch (e) { bc = null; } }
  const peers = new Set();               // ventanas abiertas por esta (p. ej. la Live) o que nos han escrito
  const listeners = [], peerListeners = [];

  function addPeer(win) { if (win) peers.add(win); }
  function snapshot() { return { app: APP, type: 'snapshot', festival: getFestival(), config: getConfig(), callDone: getCallDone(), flash: getFlash(), avisos: getAvisos(), meteo: getMeteo() }; }

  function send(msg) {
    if (READONLY) return;
    const m = Object.assign({ app: APP }, msg);
    if (bc) { try { bc.postMessage(m); } catch (e) {} }
    const targets = Array.from(peers);
    if (root.opener && !root.opener.closed) targets.push(root.opener);
    targets.forEach(w => {
      if (!w || w.closed) { peers.delete(w); return; }
      try { w.postMessage(m, '*'); } catch (e) {}
    });
  }

  /** Aplica un mensaje recibido: lo guarda aquí y avisa a quien escuche. */
  function receive(m) {
    if (!m || m.app !== APP) return;
    if (m.type === 'festival') write(K.festival, m.festival);
    else if (m.type === 'config') write(K.config, normConfig(m.config));
    else if (m.type === 'callDone') write(K.callDone, m.callDone || []);
    else if (m.type === 'flash') write(K.flash, m.flash || null);
    else if (m.type === 'meteo') write(K.meteo, m.meteo || null);
    else if (m.type === 'avisos') write(K.avisos, normAvisos(m.avisos, Date.now()));
    else if (m.type === 'chat') write(K.chat, Array.isArray(m.chat) ? m.chat : []);
    else if (m.type === 'hello') { send(snapshot()); return; }
    else if (m.type === 'snapshot') {
      if (m.festival) write(K.festival, m.festival);
      if (m.config) write(K.config, normConfig(m.config));
      if (m.callDone) write(K.callDone, m.callDone);
      if (m.flash !== undefined) write(K.flash, m.flash);
      if (m.meteo !== undefined) write(K.meteo, m.meteo);
      if (m.avisos !== undefined) write(K.avisos, normAvisos(m.avisos, Date.now()));
    } else return;
    listeners.forEach(fn => { try { fn(m.type); } catch (e) { console.error(e); } });
  }

  if (bc) bc.onmessage = e => receive(e.data);
  // Mensaje directo de otra ventana: si no la conocíamos (p. ej. el Panel se recargó y perdió la Live),
  // se apunta como compañera y se le manda el estado completo. Así los cambios vuelven a llegarle al momento.
  if (!READONLY) root.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.app !== APP) return;
    const src = e.source;
    if (src && src !== root && src !== root.opener && !peers.has(src)) {
      peers.add(src);
      peerListeners.forEach(fn => { try { fn(src, m); } catch (err) { console.error(err); } });
      if (m.type === 'ping' || m.type === 'hello') { try { src.postMessage(snapshot(), '*'); } catch (err) {} }
    }
    if (m.type === 'ping') return;
    if (m.type === 'hello' && src && src !== root) { try { src.postMessage(snapshot(), '*'); } catch (err) {} return; }
    receive(m);
  });
  if (!READONLY) root.addEventListener('storage', e => {
    const type = e.key === K.festival ? 'festival' : e.key === K.config ? 'config' : e.key === K.callDone ? 'callDone' : e.key === K.flash ? 'flash' : e.key === K.meteo ? 'meteo' : e.key === K.avisos ? 'avisos' : e.key === K.chat ? 'chat' : null;
    if (type) listeners.forEach(fn => { try { fn(type); } catch (err) { console.error(err); } });
  });

  function onChange(fn) { listeners.push(fn); }
  /** Avisa de cada escritura en este navegador (cambios propios o recibidos de otra ventana). */
  function onWrite(fn) { writeHooks.push(fn); }
  /** Estado completo para la emisión. */
  function getSnapshot() {
    const c = getConfig();
    if (root.ShowtimeMeteo && c.meteo) c.meteo = root.ShowtimeMeteo.publicMeteo(c.meteo);   // sin la URL propia (puede llevar una clave)
    return { festival: getFestival(), config: c, callDone: getCallDone(), flash: read(K.flash, null), avisos: getAvisos(), meteo: getMeteo() };
  }
  /** Modo Staff: aplica el estado recibido por la emisión y avisa a la Live. */
  function loadSnapshot(s) {
    if (!READONLY || !s) return;
    write(K.festival, s.festival || null); write(K.config, normConfig(s.config)); write(K.callDone, Array.isArray(s.callDone) ? s.callDone : []); write(K.flash, s.flash || null);
    write(K.avisos, normAvisos(s.avisos, Date.now())); write(K.meteo, s.meteo || null);
    listeners.forEach(fn => { try { fn('snapshot'); } catch (e) { console.error(e); } });
  }
  function onPeer(fn) { peerListeners.push(fn); }
  /** La Live se presenta cada pocos segundos a la ventana que la abrió (barato; solo cuenta la primera vez). */
  function ping() { if (READONLY) return; if (root.opener && !root.opener.closed) { try { root.opener.postMessage({ app: APP, type: 'ping', name: String(root.name || '').slice(0, 80) }, '*'); } catch (e) {} } }

  // ── Cambios que se propagan ──────────────────────────────────────────
  function setFestival(f) { if (READONLY) return; write(K.festival, f); send({ type: 'festival', festival: f }); }
  function setConfig(patch) {
    if (READONLY) return getConfig();
    const c = normConfig(Object.assign(getConfig(), patch || {}));
    write(K.config, c); send({ type: 'config', config: c }); return c;
  }
  function markCallDone(key, nowAbs) {
    if (READONLY) return getCallDone();
    const list = pruneCallDone(getCallDone(), nowAbs || 0);
    if (list.indexOf(key) < 0) list.push(key);
    write(K.callDone, list); send({ type: 'callDone', callDone: list }); return list;
  }
  /** Mensaje flash a la Pantalla Live (texto) o retirarlo (null). `to`: vistas de destino (null = todas). */
  function setFlash(text, to, zones) {
    if (READONLY) return getFlash();
    const c = getConfig();   // colores y duración: los de este momento; si luego se cambian, este mensaje no cambia
    const Vv = root.ShowtimeVistas, tg = Vv ? Vv.normTargets(to) : null;
    const zs = Vv && (!tg || tg.indexOf('confidence') >= 0) ? Vv.normZones(zones) : null;   // zonas: solo cuentan para Confidence
    const f = text ? { id: Date.now().toString(36), text: String(text).slice(0, 140), at: Date.now(), ms: c.msgSecs * 1000, bg: c.msgBg, fg: c.msgFg, to: tg, zones: zs } : null;
    write(K.flash, f); send({ type: 'flash', flash: f });
    listeners.forEach(fn => { try { fn('flash'); } catch (e) { console.error(e); } });
    return f;
  }
  /** El tiempo: guarda el dato (o el error) y lo manda a las Live abiertas. Solo el Dashboard lo pide. */
  function setMeteo(m) { if (READONLY) return; write(K.meteo, m || null); send({ type: 'meteo', meteo: m || null }); }
  /** Aviso nuevo (puntual: dura lo de Configuración › Mensajes › Avisos puntuales, 2 min por defecto; permanente: hasta que lo quite el Stage Manager). Se suma a los que haya. */
  function addAviso(text, perm, from) {
    if (READONLY) return null;
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!t) return null;
    const c = getConfig(), now = Date.now();
    const a = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text: t, at: now, ms: perm ? 0 : c.avisoSecs * 1000, from: String(from || '').slice(0, 80) };
    const list = getAvisos().concat([a]).slice(-AVISOS_MAX);
    write(K.avisos, list); send({ type: 'avisos', avisos: list });
    listeners.forEach(fn => { try { fn('avisos'); } catch (e) { console.error(e); } });
    return a;
  }
  /** Mensaje de chat (solo el Dashboard lo guarda: los del productor llegan por la emisión y los del Stage Manager se escriben aquí). */
  function addChat(text, from, pid, sm) {
    if (READONLY) return null;
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!t) return null;
    const now = Date.now();
    const m = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), at: now, from: String(from || '').slice(0, 80), pid: String(pid || '').slice(0, 40), text: t, sm: !!sm };
    const list = getChat().concat([m]).slice(-CHAT_MAX);
    write(K.chat, list); send({ type: 'chat', chat: list });
    return m;
  }
  /** Quitar un aviso (solo el Dashboard del Stage Manager). */
  function removeAviso(id) {
    if (READONLY) return getAvisos();
    const list = getAvisos().filter(a => a.id !== id);
    write(K.avisos, list); send({ type: 'avisos', avisos: list });
    listeners.forEach(fn => { try { fn('avisos'); } catch (e) { console.error(e); } });
    return list;
  }
  /** Pide los datos a las otras ventanas (útil al abrir la Live con doble clic en Firefox). */
  function hello() { send({ type: 'hello' }); }

  root.ShowtimeDatos = {
    KEYS: K, STYLES, normStyle, normConfig,
    getFestival, getConfig, getCallDone, getFlash, setFlash, getAvisos, addAviso, removeAviso, normAvisos, getChat, addChat, getMeteo, setMeteo, FLASH_MS, MSG_SECS, AVISO_SECS, flashMs, flashLeft, callMinsOf, getOriginal, setOriginal,
    setFestival, setConfig, markCallDone, pruneCallDone,
    onChange, onPeer, addPeer, send, hello, ping,
    READONLY, onWrite, getSnapshot, loadSnapshot
  };
})(window);
