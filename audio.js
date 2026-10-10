/* Showtime · audio.js — avisos de audio LOCALES del Dashboard (dec. 145). 0 dependencias.
 *
 *  - Solo en ESTE dispositivo: las preferencias van en localStorage («showtime.audioAlerts»), nunca en la
 *    configuración del festival, ni en el JSON exportado, ni en la emisión. Otra pantalla no suena por esto.
 *  - Tonos sintetizados con Web Audio (sin ficheros). Sin AudioContext (navegador viejo, tests): no suena y no falla.
 *  - El navegador solo deja sonar tras un gesto: el contexto se crea/reanuda en el primer clic o tecla.
 *  - Suena al ENTRAR en un estado (CALL, sobretiempo, alerta meteo pendiente), nunca al cargar ni en cada tick:
 *    el primer vistazo arma el detector sin sonar. Lo que sale del estado y vuelve a entrar, vuelve a sonar.
 *
 *  Ordenador:  node --test tests/audio.test.js
 */
(function (root) {
  'use strict';

  const KEY = 'showtime.audioAlerts';
  const KINDS = ['call', 'overrun', 'meteo', 'urgent'];
  const DEFAULTS = Object.freeze({ on: false, call: true, overrun: true, meteo: true, urgent: true });

  /** Preferencias limpias: cualquier cosa rara (JSON roto, tipos que no son booleanos, campos que faltan) → valor por defecto. */
  function normPrefs(p) {
    const o = Object.assign({}, DEFAULTS);
    if (p && typeof p === 'object' && !Array.isArray(p)) ['on'].concat(KINDS).forEach(k => { if (typeof p[k] === 'boolean') o[k] = p[k]; });
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
  let ctx = null;
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
  /** Toca el tono si el contexto ya está desbloqueado. Nunca lanza. */
  function play(kind) {
    const t = TONES[kind]; if (!t || !ctx || ctx.state !== 'running') return false;
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
      });
      return true;
    } catch (e) { return false; }
  }
  /** Para el Dashboard: suena solo si está activado (preferencias leídas en el momento). */
  function alert(kind) { return enabled(load(), kind) ? play(kind) : false; }
  /** Engancha el desbloqueo al primer gesto (y a los siguientes, por si el navegador lo vuelve a suspender). */
  function armGestures(doc) {
    if (!doc || !doc.addEventListener) return;
    const go = () => { if (load().on) unlock(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(t => doc.addEventListener(t, go, { capture: true, passive: true }));
  }

  const API = { KEY, KINDS, DEFAULTS, normPrefs, load, save, enabled, edge, supported, unlock, play, alert, armGestures, TONES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.ShowtimeAudio = API;
})(typeof window !== 'undefined' ? window : globalThis);
