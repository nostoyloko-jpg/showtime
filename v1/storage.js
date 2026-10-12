/* Showtime Document v1 · almacenamiento local aislado.
 * Solo existen claves con prefijo «showtime.v1.». No enumera el almacenamiento, no lee, no borra y no escribe ninguna
 * otra clave (en particular, ninguna «showtime.*» de la web anterior). backend: objeto con la interfaz de localStorage.
 */
(function (root) {
  'use strict';
  const PREFIX = 'showtime.v1.';
  const NAMES = ['document'];   // lista cerrada: añadir una clave nueva es un cambio deliberado
  function keyOf(name) {
    if (NAMES.indexOf(name) < 0) throw new Error('Clave v1 desconocida: ' + name);
    return PREFIX + name;
  }
  /** → { get(name), set(name, text), remove(name), keys } ; nunca lanza por un almacenamiento lleno o bloqueado. */
  function createStorage(backend) {
    const safe = fn => { try { return fn(); } catch (e) { return null; } };
    return {
      keys: NAMES.map(n => PREFIX + n),
      get: name => { const k = keyOf(name); return backend ? safe(() => backend.getItem(k)) : null; },
      set: (name, value) => { const k = keyOf(name); return backend ? safe(() => { backend.setItem(k, String(value)); return true; }) === true : false; },
      remove: name => { const k = keyOf(name); if (backend) safe(() => backend.removeItem(k)); }
    };
  }
  const api = { PREFIX, NAMES, createStorage, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShowtimeV1Storage = api;
})(typeof window !== 'undefined' ? window : this);
