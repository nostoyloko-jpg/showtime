/* Showtime Document v1 · Service Worker propio de /v1/.
 * Caché propia («showtime.v1.*»): nunca abre, borra ni reclama cachés o recursos de la web anterior (sus cachés empiezan
 * por «showtime-»). Solo atiende peticiones GET del mismo origen dentro de su propio ámbito (/v1/).
 * Estrategia: red primero con tiempo límite; si no contesta, lo guardado.
 */
'use strict';
const VERSION = 'b0p1';
const CACHE = 'showtime.v1.' + VERSION;
const PREFIX = 'showtime.v1.';
const NET_TIMEOUT = 3000;
// Sin './': el servidor local (servidor.js) no sirve índice de carpeta y /v1/ da 404. La navegación sin red cae a index.html.
const PRECACHE = ['index.html', 'app.css', 'time.js', 'document.js', 'storage.js', 'session.js', 'app.js', 'manifest.webmanifest'];

function inScope(url) {
  const scope = new URL(self.registration ? self.registration.scope : './', self.location.href);
  return url.origin === scope.origin && url.pathname.indexOf(scope.pathname) === 0;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // Solo cachés v1 antiguas; jamás las «showtime-…» de la web anterior
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf(PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromNetwork(req) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT);
    fetch(new Request(req, { cache: 'no-cache' })).then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (err) { return; }
  if (!inScope(url)) return;   // fuera de /v1/: sin tocar
  e.respondWith(
    fromNetwork(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })).then(r => r || (req.mode === 'navigate' ? caches.open(CACHE).then(c => c.match('index.html')) : Response.error())))
  );
});
