/* Tests de la app instalable y sin conexión (PWA): manifest, cabeceras, registro y Service Worker (sw.js).
 * Ordenador:  node tests/pwa.test.js
 * El Service Worker se ejecuta en un contexto aparte con caché, red y relojes de mentira: se comprueba qué contesta
 * con red, sin red, con una red que no responde («lie-fi» de festival) y qué deja pasar sin tocar.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('pwa.test.js: solo en Node (node tests/pwa.test.js)'); return; }
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const ROOT = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const PAGES = ['index.html', 'live.html', 'remote.html'];

  test('manifest.webmanifest: nombre, inicio, standalone, colores e iconos que existen', () => {
    const m = JSON.parse(src('manifest.webmanifest'));
    eq(m.name, 'Showtime — Regiduría en Directo'); eq(m.short_name, 'Showtime'); eq(m.start_url, './index.html'); eq(m.display, 'standalone');
    eq(m.background_color, '#07080a'); eq(m.theme_color, '#07080a');
    ok(m.icons.some(i => i.type === 'image/svg+xml'), 'SVG'); ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'), '192 y 512');
    ok(m.icons.some(i => i.purpose === 'maskable'), 'icono «maskable» (Android lo recorta en círculo)');
    m.icons.forEach(i => {
      ok(fs.existsSync(path.join(ROOT, i.src)), 'existe ' + i.src);
      if (i.type === 'image/png') {   // tamaño real del PNG (cabecera IHDR)
        const b = fs.readFileSync(path.join(ROOT, i.src));
        eq(b.readUInt32BE(16) + 'x' + b.readUInt32BE(20), i.sizes, i.src);
      }
    });
  });

  test('Cabeceras: el Dashboard enlaza el manifest; la Live y el mando NO (al añadirlos a la pantalla de inicio conservan su enlace con las claves)', () => {
    PAGES.forEach(p => {
      const h = src(p);
      ok(/<meta name="theme-color" content="#07080a">/.test(h), p + ': theme-color');
      ok(/<meta name="apple-mobile-web-app-capable" content="yes">/.test(h), p + ': apple capable');
      ok(/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/.test(h), p + ': barra translúcida');
      ok(/<link rel="apple-touch-icon" href="icons\/icon-180\.png">/.test(h), p + ': icono de iOS');
      ok(/viewport-fit=cover/.test(h), p + ': viewport-fit=cover (zonas seguras con la barra translúcida)');
      eq(/rel="manifest"/.test(h), p === 'index.html', p + ': manifest');
    });
    ok(/\.bar\{padding-top:max\(8px,env\(safe-area-inset-top/.test(src('control.css')), 'la barra del Dashboard no queda bajo el reloj del sistema');
  });

  test('pwa.js: en las 3 pantallas; registra sw.js solo por http(s) (con doble clic, file://, no hace nada)', () => {
    PAGES.forEach(p => ok(/<script src="pwa\.js\?v=\d+"><\/script>/.test(src(p)), p));
    const P = require('../pwa.js'), calls = [];
    const nav = { serviceWorker: { register: u => { calls.push(u); return Promise.resolve(); } } };
    eq(P.canRegister({ protocol: 'file:' }, nav), false); eq(P.register({ protocol: 'file:' }, nav), false);
    eq(P.canRegister({ protocol: 'https:' }, {}), false, 'navegador sin Service Worker');
    eq(P.register({ protocol: 'https:' }, nav), true); eq(P.register({ protocol: 'http:' }, nav), true);
    eq(calls.join(), 'sw.js,sw.js');
  });

  test('Versión: la del Service Worker es la misma que «?v=» de las pantallas y BUILD (al subir versión, caché nueva)', () => {
    const v = /const VERSION = '(\d+)'/.exec(src('sw.js'))[1];
    PAGES.forEach(p => (src(p).match(/\?v=(\d+)/g) || []).forEach(x => eq(x.slice(3), v, p)));
    eq(/BUILD = '?(\d+)/.exec(src('emision.js'))[1], v, 'BUILD de emision.js');
  });

  test('Precaché: todo lo que cargan las 3 pantallas está guardado, y todo lo guardado existe', () => {
    const pre = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(src('sw.js'))[1].replace(/'/g, '"'));
    const need = new Set(PAGES.concat(['manifest.webmanifest', 'pwa.js']));
    PAGES.forEach(p => { const h = src(p); let m; const re = /(?:src|href)="([^"#:]+?)(?:\?v=\d+)?"/g; while ((m = re.exec(h))) if (!/^(https?:|mailto:|data:)/.test(m[1]) && /\.(js|css|png|svg|webmanifest|html)$/.test(m[1])) need.add(m[1]); });
    need.forEach(f => ok(pre.indexOf(f) >= 0, 'falta en la precaché: ' + f));
    pre.filter(f => f !== './').forEach(f => ok(fs.existsSync(path.join(ROOT, f)), 'no existe: ' + f));
  });

  // ── El Service Worker, en marcha ─────────────────────────────────────
  /** Arranca sw.js con caché, red y relojes de mentira. net: 'on' | 'off' | 'cuelga' */
  function sw(opts) {
    const o = opts || {};
    const stores = new Map(), handlers = {}, log = { skip: 0, claim: 0, fetched: [], modes: [] };
    const keyOf = (r, ign) => { const u = new URL(typeof r === 'string' ? r : r.url, 'https://app.test/showtime/'); return ign ? u.origin + u.pathname : u.href; };
    function store(name) {
      if (!stores.has(name)) {
        const m = new Map();
        stores.set(name, {
          _m: m,
          add: async req => { if (o.net === 'off') throw new Error('sin red'); m.set(keyOf(req), new Response('pre:' + keyOf(req))); },
          put: async (req, res) => { m.set(keyOf(req), res); },
          match: async (req, op) => { if (m.has(keyOf(req))) return m.get(keyOf(req)).clone(); if (op && op.ignoreSearch) { for (const [k, v] of m) if (keyOf(k, true) === keyOf(req, true)) return v.clone(); } return undefined; }
        });
      }
      return stores.get(name);
    }
    const caches = { open: async n => store(n), keys: async () => Array.from(stores.keys()), delete: async n => stores.delete(n) };
    const fetch = req => {
      log.fetched.push(req.url); log.modes.push(req.cache);
      if (o.net === 'off') return Promise.reject(new TypeError('Failed to fetch'));
      if (o.net === 'cuelga') return new Promise(() => {});
      const r = new Response('red:' + req.url); Object.defineProperty(r, 'type', { value: 'basic' }); return Promise.resolve(r);
    };
    const timers = [];
    const self = {
      location: new URL('https://app.test/showtime/sw.js'),
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: () => { log.skip++; }, clients: { claim: () => { log.claim++; } }
    };
    // Como en el navegador: una URL relativa se resuelve desde la del Service Worker
    class SWRequest extends Request { constructor(u, init) { super(typeof u === 'string' ? new URL(u, self.location).href : u, init); } }
    const ctx = vm.createContext({ self, caches, fetch, Request: SWRequest, Response, URL, Promise, console,
      setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
    vm.runInContext(src('sw.js'), ctx, { filename: 'sw.js' });
    const VERSION = /const VERSION = '(\d+)'/.exec(src('sw.js'))[1];
    async function lifecycle(name) { let p; handlers[name]({ waitUntil: x => { p = x; } }); await p; }
    async function get(url, init) {
      const nav = init && init.mode === 'navigate';
      const req = new Request(new URL(url, 'https://app.test/showtime/').href, nav ? {} : init);
      if (nav) Object.defineProperty(req, 'mode', { value: 'navigate' });   // node no deja crearla así; el navegador, sí
      let resp = null; const ev = { request: req, respondWith: p => { resp = p; } };
      handlers.fetch(ev);
      if (!resp) return null;                       // no lo tocó: lo hace el navegador
      if (o.net === 'cuelga') { await new Promise(r => setImmediate(r)); timers.forEach(fn => fn()); }   // pasa el tiempo límite
      return resp.then(r => r.text().then(t => ({ status: r.status, text: t })));
    }
    return { stores, store, caches, lifecycle, get, log, VERSION, setNet: n => { o.net = n; } };
  }

  test('SW · versión nueva al momento: las páginas sin «?v=» se revalidan siempre con el servidor (Safari no sirve su copia vieja); lo versionado usa la caché normal', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install'); s.log.fetched.length = 0; s.log.modes.length = 0;
    const r = await s.get('index.html', { mode: 'navigate' });
    eq(r.text, 'red:https://app.test/showtime/index.html'); eq(s.log.modes[0], 'no-cache', 'la página');
    await s.get('manifest.webmanifest'); eq(s.log.modes[1], 'no-cache', 'el manifest');
    await s.get('control.js?v=' + s.VERSION); eq(s.log.modes[2], 'default', 'lo que lleva ?v=');
  });
  test('SW · instalar: guarda la precaché en «showtime-VERSION» y se activa sin esperar', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    const c = s.stores.get('showtime-' + s.VERSION);
    ok(c && c._m.size >= 20, 'precaché guardada: ' + (c && c._m.size));
    ok(c._m.has('https://app.test/showtime/control.js') && c._m.has('https://app.test/showtime/live.html'));
    eq(s.log.skip, 1);
  });
  test('SW · activar: borra las cachés viejas de Showtime (no las de otras apps) y toma el control', async () => {
    const s = sw({ net: 'on' });
    await s.caches.open('showtime-20200101'); await s.caches.open('otra-app');
    await s.lifecycle('install'); await s.lifecycle('activate');
    eq(Array.from(s.stores.keys()).sort().join(), ['otra-app', 'showtime-' + s.VERSION].sort().join());
    eq(s.log.claim, 1);
  });
  test('SW · con red: lo último de la red (y se guarda copia, también con «?v=»)', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    const r = await s.get('control.js?v=' + s.VERSION);
    eq(r.text, 'red:https://app.test/showtime/control.js?v=' + s.VERSION);
    ok(s.stores.get('showtime-' + s.VERSION)._m.has('https://app.test/showtime/control.js?v=' + s.VERSION), 'copia guardada');
  });
  test('SW · sin red: contesta la caché al momento (aunque la URL lleve otra «?v=»)', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    s.setNet('off');
    const r = await s.get('core.js?v=20990101');
    eq(r.status, 200); eq(r.text, 'pre:https://app.test/showtime/core.js');
  });
  test('SW · red que no contesta (lie-fi de festival): pasado el tiempo límite, la caché', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    s.setNet('cuelga');
    const r = await s.get('live.html');
    eq(r.text, 'pre:https://app.test/showtime/live.html');
    ok(/const NET_TIMEOUT = (\d+)/.exec(src('sw.js'))[1] <= 4000, 'espera como mucho unos segundos');
  });
  test('SW · sin red y sin copia: una página → el Dashboard guardado; un archivo → error claro (503)', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    s.setNet('off');
    eq((await s.get('cualquier-cosa.html', { mode: 'navigate' })).text, 'pre:https://app.test/showtime/index.html');
    const r = await s.get('no-existe.js');
    eq(r.status, 503); ok(/Sin conexión/.test(r.text));
  });
  test('SW · no toca: otras webs (el tiempo, la emisión), ni lo que no es GET', async () => {
    const s = sw({ net: 'on' });
    await s.lifecycle('install');
    eq(await s.get('https://api.open-meteo.com/v1/forecast?x=1'), null, 'Open-Meteo pasa sin tocar');
    eq(await s.get('https://broker.emqx.io/mqtt'), null, 'repetidores de la emisión');
    eq(await s.get('index.html', { method: 'POST', body: 'x' }), null, 'POST');
  });

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('PWA: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
