/* Showtime · audio.js — avisos de audio LOCALES del Dashboard (dec. 145). 0 dependencias.
 *
 *  - Solo en ESTE dispositivo: las preferencias van en localStorage («showtime.audioAlerts»), nunca en la
 *    configuración del festival, ni en el JSON exportado, ni en la emisión. Otra pantalla no suena por esto.
 *  - Tonos sintetizados con Web Audio (sin ficheros). Sin AudioContext (navegador viejo, tests): no suena y no falla.
 *  - El navegador solo deja sonar tras un gesto: el contexto se crea/reanuda en el primer clic o tecla.
 *  - Suena al ENTRAR en un estado (CALL, sobretiempo, alerta meteo pendiente), nunca al cargar ni en cada tick:
 *    el primer vistazo arma el detector sin sonar. Lo que sale del estado y vuelve a entrar, vuelve a sonar.
 *  - Dec. 146: muestra de cada tono (preview, también con el interruptor apagado) y «Repetir hasta confirmar»
 *    (apagado por defecto): UNA cola local; los tonos suenan de uno en uno, nunca a la vez (makeRing).
 *
 *  Ordenador:  node --test tests/audio.test.js
 */
(function (root) {
  'use strict';

  const KEY = 'showtime.audioAlerts';
  const KINDS = ['call', 'overrun', 'meteo', 'urgent'];
  const EVERY = [5, 10, 20, 30];   // segundos entre repeticiones (dec. 146)
  const DEFAULTS = Object.freeze({ on: false, call: true, overrun: true, meteo: true, urgent: true, repeat: false, every: 10 });

  /** Preferencias limpias: cualquier cosa rara (JSON roto, tipos que no son booleanos, campos que faltan) → valor por defecto. */
  function normPrefs(p) {
    const o = Object.assign({}, DEFAULTS);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      ['on', 'repeat'].concat(KINDS).forEach(k => { if (typeof p[k] === 'boolean') o[k] = p[k]; });
      if (EVERY.indexOf(p.every) >= 0) o.every = p.every;
    }
    return o;
  }
  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function load() {
    const s = store(); if (!s) return normPrefs(null);
    try { return normPrefs(JSON.parse(s.getItem(KEY) || 'null')); } catch (e) { return normPrefs(null); }
  }
  function save(p) {
    const o = normPrefs(p), s = store();
    if (s) { try { s.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
    return o;
  }
  /** ¿Suena este tipo? Interruptor general Y su casilla. */
  function enabled(p, kind) { const o = normPrefs(p); return o.on && KINDS.indexOf(kind) >= 0 && o[kind] === true; }

  /** Detector de flancos: devuelve las claves que ENTRAN ahora. La primera llamada solo arma (nunca suena al cargar). */
  function edge() {
    let prev = null;
    return function (keys) {
      const now = new Set((keys || []).map(String));
      const fresh = prev === null ? [] : Array.from(now).filter(k => !prev.has(k));
      prev = now;
      return fresh;
    };
  }

  // ── Tonos (Web Audio) ─────────────────────────────────────────────────
  // [frecuencia Hz, inicio s, duración s]: cada tipo con un dibujo distinto, cortos (< 1 s) y sin estridencias.
  const TONES = {
    call:    { wave: 'sine',     notes: [[660, 0, 0.16], [880, 0.2, 0.22]] },                          // dos notas que suben
    overrun: { wave: 'triangle', notes: [[440, 0, 0.14], [440, 0.2, 0.14], [440, 0.4, 0.14]] },       // tres iguales, graves
    meteo:   { wave: 'sine',     notes: [[784, 0, 0.18], [523, 0.22, 0.28]] },                          // dos notas que bajan
    urgent:  { wave: 'square',   notes: [[988, 0, 0.09], [988, 0.13, 0.09], [988, 0.26, 0.09], [1319, 0.42, 0.2]] }  // ráfaga aguda
  };
  let ctx = null, VOICE = [];   // VOICE: osciladores del tono que suena ahora (una sola voz)
  /** Lo que dura un tono, en segundos (para encadenar sin solaparse). */
  function toneSecs(kind) { const t = TONES[kind]; return t ? Math.max.apply(null, t.notes.map(n => n[1] + n[2])) + 0.05 : 0; }
  function AC() { return root.AudioContext || root.webkitAudioContext || null; }
  function supported() { return !!AC(); }
  /** Solo desde un gesto del usuario (clic/tecla): crea o reanuda el contexto. */
  function unlock() {
    const A = AC(); if (!A) return false;
    try {
      if (!ctx) ctx = new A();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      return true;
    } catch (e) { ctx = null; return false; }
  }
  /** Corta al momento lo que esté sonando. Nunca lanza. */
  function stop() {
    VOICE.forEach(o => { try { o.stop(0); } catch (e) {} try { o.disconnect(); } catch (e) {} });
    VOICE = [];
  }
  /** Toca el tono si el contexto ya está desbloqueado (corta el anterior: una sola voz). Devuelve su duración en s, o 0. Nunca lanza. */
  function play(kind) {
    const t = TONES[kind]; if (!t || !ctx || ctx.state !== 'running') return 0;
    stop();
    try {
      const t0 = ctx.currentTime + 0.02;
      t.notes.forEach(([f, at, d]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = t.wave; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(t.wave === 'square' ? 0.12 : 0.3, t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + at); o.stop(t0 + at + d + 0.03);
        VOICE.push(o);
      });
      return toneSecs(kind);
    } catch (e) { return 0; }
  }
  /** Muestra de un tono desde Configuración (dec. 146): funciona con el interruptor apagado (el clic es el gesto),
   *  corta la muestra anterior y no toca preferencias, cola ni detectores. */
  function preview(kind) {
    if (!TONES[kind] || !unlock()) return false;
    if (ctx.state === 'running') return play(kind) > 0;
    if (ctx.resume) ctx.resume().then(() => play(kind)).catch(() => {});   // recién creado: suena en cuanto arranca
    return true;
  }

  /** Cola local de avisos (dec. 146). Un solo tono a la vez: step(now) toca el primero que toque y espera a que acabe.
   *  Avisos de una vez (repeat:false) salen al sonar; los repetitivos vuelven cada `every` s hasta confirmar o retirarse.
   *  playFn(kind) → duración en s (0 si no sonó). Solo memoria: nada se guarda ni se emite. */
  function makeRing(playFn) {
    let items = [], busyUntil = 0;
    const api = {
      /** it: { id, kind, key, label, repeat } · false si ya estaba */
      add(it, now) {
        if (!it || !TONES[it.kind] || items.some(x => x.id === it.id)) return false;
        items.push({ id: String(it.id), kind: it.kind, key: it.key === undefined ? null : String(it.key), label: String(it.label || ''), repeat: it.repeat === true, nextAt: now });
        return true;
      },
      /** Se retiran solos los de ese tipo cuyo estado ya no está activo (CALL con OK, banda con ■, meteo «Visto»…). */
      retain(kind, keys) { const k = new Set((keys || []).map(String)); const n = items.length; items = items.filter(x => x.kind !== kind || k.has(x.key)); return n !== items.length; },
      confirm(id) { const n = items.length; items = items.filter(x => x.id !== id); return n !== items.length; },
      dropKind(kind) { items = items.filter(x => x.kind !== kind); },
      dropRepeats() { items = items.filter(x => !x.repeat); },
      clear() { items = []; busyUntil = 0; },
      pending() { return items.filter(x => x.repeat).map(x => ({ id: x.id, kind: x.kind, label: x.label })); },
      size() { return items.length; },
      /** Toca como mucho UN tono si no hay otro sonando. Devuelve el id que sonó o null. */
      step(now, every) {
        if (now < busyUntil) return null;
        const it = items.find(x => x.nextAt <= now); if (!it) return null;
        const secs = playFn(it.kind) || 0;
        busyUntil = now + (secs ? Math.ceil(secs * 1000) + 250 : 0);
        if (it.repeat) it.nextAt = now + (EVERY.indexOf(every) >= 0 ? every : DEFAULTS.every) * 1000;
        else items = items.filter(x => x !== it);
        return it.id;
      },
      /** Una muestra ocupa la voz: la cola espera a que acabe. */
      hold(now, secs) { busyUntil = Math.max(busyUntil, now + Math.ceil((secs || 0) * 1000)); }
    };
    return api;
  }
  const RING = makeRing(k => play(k));
  /** Para el Dashboard: suena solo si está activado (preferencias leídas en el momento). */
  function alert(kind) { return enabled(load(), kind) ? play(kind) : false; }
  /** Engancha el desbloqueo al primer gesto (y a los siguientes, por si el navegador lo vuelve a suspender). */
  function armGestures(doc) {
    if (!doc || !doc.addEventListener) return;
    const go = () => { if (load().on) unlock(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(t => doc.addEventListener(t, go, { capture: true, passive: true }));
  }

  const API = { KEY, KINDS, EVERY, DEFAULTS, normPrefs, load, save, enabled, edge, supported, unlock, play, stop, preview, toneSecs, alert, armGestures, makeRing, RING, TONES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.ShowtimeAudio = API;
})(typeof window !== 'undefined' ? window : globalThis);
