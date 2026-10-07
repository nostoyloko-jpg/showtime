/* Navegador simulado para los tests de control.js y live.js (solo Node). Sin dependencias.
 * Los elementos del DOM son «comodines»: aceptan cualquier propiedad/llamada; solo se guarda lo que se les escribe.
 * No comprueba el aspecto, solo que el código no revienta y que hace lo que debe con los datos.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** opts: { cripto, hash, search, storage:{clave:valor}, now: ms (reloj simulado: la hora no depende de cuándo se pasen los tests) } */
function makeEnv(opts) {
  opts = opts || {};
  let DateC = Date;
  if (Number.isFinite(opts.now)) {
    const NOW = opts.now;
    DateC = class extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };
  }
  const errors = [], handlers = {}, innerLog = [], els = new Map();
  function stub(name) {
    const classes = new Set(), listeners = {};
    const store = { dataset: {}, hidden: false, value: '', textContent: '', checked: false, children: [], innerHTML: '', _name: name,
      classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c),
        toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); return v; } },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, _listeners: listeners, _classes: classes };
    const p = new Proxy(function () {}, {
      get(_, k) {
        if (k === Symbol.toPrimitive) return () => '';
        if (k in store) return store[k];
        if (k === 'querySelectorAll' || k === 'getElementsByTagName') return () => [];
        if (k === 'matches') return () => false;
        if (k === 'closest') return () => null;
        if (k === 'length') return 0;
        if (k === 'then') return undefined;
        if (k === 'forEach') return () => {};
        return p;
      },
      set(_, k, v) { store[k] = v; if (k === 'innerHTML') innerLog.push([name, String(v)]); return true; },
      apply() { return p; }, construct() { return p; }
    });
    return p;
  }
  const getEl = id => { if (!els.has(id)) els.set(id, stub(id)); return els.get(id); };
  const addEL = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
  const document = {
    getElementById: getEl, querySelector: () => stub('qs'), querySelectorAll: () => [], createElement: () => stub('new'),
    addEventListener: addEL, removeEventListener() {}, body: getEl('body'), documentElement: getEl('html'), head: getEl('head'),
    visibilityState: 'hidden', title: '', cookie: '', activeElement: null
  };
  const mem = new Map(Object.entries(opts.storage || {}));
  const localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => Array.from(mem.keys())[i] || null, get length() { return mem.size; } };
  const win = {
    document, localStorage, sessionStorage: localStorage, navigator: { userAgent: 'node', onLine: true },
    location: { href: 'http://localhost/index.html', hash: opts.hash || '', search: opts.search || '', origin: 'http://localhost', protocol: 'http:', hostname: 'localhost', host: 'localhost', pathname: '/index.html' },
    console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    addEventListener: addEL, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    BroadcastChannel: function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(v) {} }; },
    history: { replaceState() {} }, innerHeight: 800, innerWidth: 1280, devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => '' }), URLSearchParams,
    open() { return null; }, close() {}, print() {}, focus() {}, alert() {}, confirm: () => true, prompt: () => null,
    fetch: () => Promise.reject(new Error('sin red')), URL, Blob: function () {}, FileReader: function () {},
    Intl, Date: DateC, Math, JSON, Promise, Map, Set, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, Uint8Array, TextEncoder, TextDecoder, encodeURIComponent, decodeURIComponent,
    parseInt, parseFloat, isNaN, Symbol, WeakMap, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64')
  };
  if (opts.cripto) { win.crypto = require('crypto').webcrypto; win.WebSocket = function () {}; }
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  /** Dispara los manejadores de un elemento (por id) o del document/window. */
  function fire(target, type, ev) {
    const list = target === 'document' ? handlers[type] : target === 'window' ? handlers[type] : (getEl(target)._listeners[type] || []);
    (list || []).forEach(fn => fn(ev || {}));
  }
  return { ctx, win, errors, handlers, innerLog, getEl, fire, storage: mem };
}

function cargar(env, ficheros, sustituye) {
  ficheros.forEach(f => vm.runInContext((sustituye && sustituye[f]) || src(f), env.ctx, { filename: f }));
}

module.exports = { makeEnv, cargar, src, ROOT };
