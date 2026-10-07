/* Tests de control.js — sin dependencias.
 * Ordenador:  node tests/control.test.js
 * Carga control.js (y sus módulos) en un navegador simulado: comprueba que la sintaxis es válida,
 * que el arranque no lanza errores (p. ej. «p is not defined») y que los paneles se dibujan.
 * Los elementos del DOM son «comodines»: no se comprueba el aspecto, solo que el código no revienta.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('control.test.js: solo en Node (node tests/control.test.js)'); return; }
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const ROOT = path.join(__dirname, '..');
  const MODULOS = ['core.js', 'meteo.js', 'datos.js', 'importar.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'control.js'];
  const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // ── Navegador simulado ───────────────────────────────────────────────
  function makeEnv(opts) {
    opts = opts || {};
    const errors = [], handlers = {}, innerLog = [];
    function stub(name) {
      const t = function () {};
      const store = { dataset: {}, hidden: false, value: '', textContent: '', checked: false, children: [], innerHTML: '', _name: name };
      const p = new Proxy(t, {
        get(_, k) {
          if (k === Symbol.toPrimitive) return () => '';
          if (k === 'innerHTML') return store.innerHTML;
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
        apply() { return p; },
        construct() { return p; }
      });
      return p;
    }
    const els = new Map();
    const getEl = id => { if (!els.has(id)) els.set(id, stub(id)); return els.get(id); };
    const addEL = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
    const document = {
      getElementById: getEl, querySelector: () => stub('qs'), querySelectorAll: () => [], createElement: () => stub('new'),
      addEventListener: addEL, removeEventListener() {}, body: stub('body'), documentElement: stub('html'), head: stub('head'),
      visibilityState: 'hidden', title: '', cookie: ''
    };
    const mem = new Map();
    const localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => Array.from(mem.keys())[i] || null, get length() { return mem.size; } };
    const win = {
      document, localStorage, sessionStorage: localStorage, navigator: { userAgent: 'node', onLine: true },
      location: { href: 'http://localhost/index.html', hash: '', search: '', origin: 'http://localhost', protocol: 'http:', host: 'localhost', pathname: '/index.html' },
      console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
      addEventListener: addEL, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      BroadcastChannel: function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(v) {} }; },
      open() { return null; }, close() {}, print() {}, focus() {}, alert() {}, confirm: () => true, prompt: () => null,
      fetch: () => Promise.reject(new Error('sin red')), URL, Blob: function () {}, FileReader: function () {},
      Intl, Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, Uint8Array, TextEncoder, TextDecoder, encodeURIComponent, decodeURIComponent,
      parseInt, parseFloat, isNaN, Symbol, WeakMap, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64')
    };
    if (opts.cripto) { win.crypto = require('crypto').webcrypto; win.WebSocket = function () {}; }
    win.window = win; win.self = win; win.globalThis = win;
    const ctx = vm.createContext(win);
    return { ctx, errors, handlers, innerLog, getEl };
  }

  function cargar(env, ficheros, sustituye) {
    ficheros.forEach(f => {
      const code = (sustituye && sustituye[f]) || src(f);
      vm.runInContext(code, env.ctx, { filename: f });
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────
  test('control.js: la sintaxis es válida', () => { new vm.Script(src('control.js'), { filename: 'control.js' }); });

  test('control.js: arranca sin errores (navegador sin cifrado)', () => {
    const env = makeEnv();
    cargar(env, MODULOS);
    ok(env.errors.length === 0, 'console.error durante el arranque: ' + env.errors.join(' | '));
  });

  test('control.js: arranca sin errores (navegador con cifrado)', () => {
    const env = makeEnv({ cripto: true });
    cargar(env, MODULOS);
    ok(env.errors.length === 0, 'console.error durante el arranque: ' + env.errors.join(' | '));
  });

  test('Producción: lista vacía y panel QR se dibujan sin errores', () => {
    const env = makeEnv({ cripto: true });
    cargar(env, MODULOS);
    const lista = env.innerLog.filter(x => x[0] === 'prod-list');
    // El panel de Producción solo se dibuja si existe #cast-produccion; basta con que no haya reventado
    ok(env.errors.length === 0, env.errors.join(' | '));
    lista.forEach(x => ok(!/undefined/.test(x[1]), 'HTML con «undefined» en la lista de productores'));
  });

  test('control.js: ningún innerHTML se monta con variables sueltas (p, qr) fuera de su ámbito', () => {
    // Detecta el fallo real: líneas con esc(p.name) donde p no existe en la función.
    const lineas = src('control.js').split('\n');
    const malas = [];
    lineas.forEach((l, i) => {
      if (/innerHTML\s*=\s*'<div style="text-align:center;width:100%">.*esc\(p\.name\)/.test(l)) malas.push(i + 1);
    });
    ok(malas.length === 0, 'bloque QR pegado por error en las líneas ' + malas.join(', '));
  });

  test('Producción: showProducerQR / paneHtml usan el panel lateral (no modal)', () => {
    const s = src('control.js');
    ok(/cprod-split/.test(s) && /prod-qr-side/.test(s), 'falta el layout split-panel');
    ok(!/id="prod-qr-display"/.test(s.replace(/e\.target\.id === 'prod-qr-display'/, '')), 'queda el modal prod-qr-display');
  });

  // ── Ejecutor ─────────────────────────────────────────────────────────
  let pass = 0, fail = 0;
  tests.forEach(([name, fn]) => {
    try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
  });
  console.log('Control: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
  if (fail) process.exitCode = 1;
})();
