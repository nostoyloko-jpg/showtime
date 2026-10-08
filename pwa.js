/* Showtime — pwa.js · Registra el Service Worker (sw.js) para instalar la app y usarla sin conexión.
 * Solo por http(s) (GitHub Pages, servidor local): con doble clic (file://) el navegador no lo permite y no pasa nada.
 * Nunca recarga una pantalla abierta: la versión nueva se usa la próxima vez que se abra (regla de oro: nada cambia solo en directo).
 */
(function (root) {
  'use strict';
  function canRegister(loc, nav) { return !!(nav && 'serviceWorker' in nav && loc && /^https?:$/.test(loc.protocol)); }
  function register(loc, nav) {
    if (!canRegister(loc, nav)) return false;
    try { nav.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { return false; }
    return true;
  }
  const API = { canRegister, register };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.ShowtimePWA = API; register(root.location, root.navigator); }
})(typeof window !== 'undefined' ? window : globalThis);
