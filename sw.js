/* Showtime — sw.js · Service Worker (modo 100 % sin conexión)
 * Estrategia: RED PRIMERO con tiempo límite y caché de respaldo.
 *  - Con internet: siempre lo último (y se guarda una copia).
 *  - Sin internet o con «lie-fi» de festival (la red no contesta en 3 s): lo guardado, al momento.
 *  - Solo archivos de la propia app (mismo origen, GET). La emisión (WebSocket), el tiempo (Open-Meteo) y cualquier
 *    otra web pasan sin tocar.
 * VERSION: la misma que «?v=» en index/live/remote y BUILD en emision.js. Al cambiarla, la caché vieja se borra sola
 * (sin recargar ninguna pantalla: lo nuevo se usa la próxima vez que se abra).
 */
'use strict';
const VERSION = '20261044';
const CACHE = 'showtime-' + VERSION;
const NET_TIMEOUT = 3000;
const PRECACHE = [
  './', 'index.html', 'live.html', 'remote.html', 'manifest.webmanifest',
  'control.css', 'live.css', 'remote.css',
  'core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js',
  'control.js', 'live.js', 'remote.js', 'pwa.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  // Cada archivo por separado: si falta uno, los demás se guardan igual
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('showtime-') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Red con tiempo límite: si no contesta a tiempo, se rechaza (y entra la caché). */
function fromNetwork(req) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT);
    fetch(req).then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}
/** Lo guardado: la misma URL o, si no está, la misma ruta sin «?v=…» (la versión anti-caché). */
function fromCache(req) {
  return caches.open(CACHE).then(c => c.match(req).then(r => r || c.match(req, { ignoreSearch: true })))
    .then(r => r || (req.mode === 'navigate' ? caches.open(CACHE).then(c => c.match('index.html')) : null));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;            // emisión, el tiempo, otras webs: sin tocar
  e.respondWith(
    fromNetwork(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => fromCache(req).then(r => r || new Response('Sin conexión y sin copia guardada de ' + url.pathname, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});
