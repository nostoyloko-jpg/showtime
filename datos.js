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
    original: 'showtime.original'      // copia del festival tal como se importó (para marcar cambios)
  };
  const STYLES = ['clasico', 'escenario', 'neutro', 'raycast'];
  const DEFAULT_CONFIG = { mode: 'show', day: 'all', style: 'clasico', callMins: null };

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
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
    o.delayZone = typeof o.delayZone === 'string' ? o.delayZone : 'all';   // zona que se está editando en el menú Retrasos
    return o;
  }

  // ── Lectura / escritura ──────────────────────────────────────────────
  function getFestival() { return read(K.festival, null); }
  function getConfig() { return normConfig(read(K.config, null)); }
  function getOriginal() { return read(K.original, null); }
  function setOriginal(f) { write(K.original, f); }
  function getCallDone() { const a = read(K.callDone, []); return Array.isArray(a) ? a : []; }

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
  try { bc = new BroadcastChannel(APP); } catch (e) { bc = null; }
  const peers = new Set();               // ventanas abiertas por esta (p. ej. la Live) o que nos han escrito
  const listeners = [], peerListeners = [];

  function addPeer(win) { if (win) peers.add(win); }
  function snapshot() { return { app: APP, type: 'snapshot', festival: getFestival(), config: getConfig(), callDone: getCallDone() }; }

  function send(msg) {
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
    else if (m.type === 'hello') { send({ type: 'snapshot', festival: getFestival(), config: getConfig(), callDone: getCallDone() }); return; }
    else if (m.type === 'snapshot') {
      if (m.festival) write(K.festival, m.festival);
      if (m.config) write(K.config, normConfig(m.config));
      if (m.callDone) write(K.callDone, m.callDone);
    } else return;
    listeners.forEach(fn => { try { fn(m.type); } catch (e) { console.error(e); } });
  }

  if (bc) bc.onmessage = e => receive(e.data);
  // Mensaje directo de otra ventana: si no la conocíamos (p. ej. el Panel se recargó y perdió la Live),
  // se apunta como compañera y se le manda el estado completo. Así los cambios vuelven a llegarle al momento.
  root.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.app !== APP) return;
    const src = e.source;
    if (src && src !== root && src !== root.opener && !peers.has(src)) {
      peers.add(src);
      peerListeners.forEach(fn => { try { fn(src); } catch (err) { console.error(err); } });
      if (m.type === 'ping' || m.type === 'hello') { try { src.postMessage(snapshot(), '*'); } catch (err) {} }
    }
    if (m.type === 'ping') return;
    if (m.type === 'hello' && src && src !== root) { try { src.postMessage(snapshot(), '*'); } catch (err) {} return; }
    receive(m);
  });
  root.addEventListener('storage', e => {
    const type = e.key === K.festival ? 'festival' : e.key === K.config ? 'config' : e.key === K.callDone ? 'callDone' : null;
    if (type) listeners.forEach(fn => { try { fn(type); } catch (err) { console.error(err); } });
  });

  function onChange(fn) { listeners.push(fn); }
  function onPeer(fn) { peerListeners.push(fn); }
  /** La Live se presenta cada pocos segundos a la ventana que la abrió (barato; solo cuenta la primera vez). */
  function ping() { if (root.opener && !root.opener.closed) { try { root.opener.postMessage({ app: APP, type: 'ping' }, '*'); } catch (e) {} } }

  // ── Cambios que se propagan ──────────────────────────────────────────
  function setFestival(f) { write(K.festival, f); send({ type: 'festival', festival: f }); }
  function setConfig(patch) {
    const c = normConfig(Object.assign(getConfig(), patch || {}));
    write(K.config, c); send({ type: 'config', config: c }); return c;
  }
  function markCallDone(key, nowAbs) {
    const list = pruneCallDone(getCallDone(), nowAbs || 0);
    if (list.indexOf(key) < 0) list.push(key);
    write(K.callDone, list); send({ type: 'callDone', callDone: list }); return list;
  }
  /** Pide los datos a las otras ventanas (útil al abrir la Live con doble clic en Firefox). */
  function hello() { send({ type: 'hello' }); }

  root.ShowtimeDatos = {
    KEYS: K, STYLES, normStyle, normConfig,
    getFestival, getConfig, getCallDone, callMinsOf, getOriginal, setOriginal,
    setFestival, setConfig, markCallDone, pruneCallDone,
    onChange, onPeer, addPeer, send, hello, ping
  };
})(window);
