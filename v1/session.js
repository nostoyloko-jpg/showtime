/* Showtime Document v1 · sesión del puesto (sin DOM).
 * Guarda el documento activo y lo persiste en showtime.v1.document. Toda operación valida primero y solo después
 * cambia el documento activo y el almacenamiento: un rechazo deja ambos exactamente como estaban (§9.2).
 * Lo vivo (Live, CALL OK, Standby, avisos…) no existe aquí: no es portable (§6.5) y llega en P2/P3.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const D = isNode ? require('./document.js') : root.ShowtimeV1Document;
  const S = isNode ? require('./storage.js') : root.ShowtimeV1Storage;

  function createSession(backend, rand) {
    const store = S.createStorage(backend);
    let doc = null;
    function commit(next) {
      const s = D.serializeDocument(next);
      if (!s.ok) return s;
      doc = next;
      store.set('document', s.text);
      return { ok: true };
    }
    return {
      get doc() { return doc; },
      /** Recupera el documento v1 guardado en este navegador (solo showtime.v1.document); si no es válido, se ignora. */
      restore() {
        const t = store.get('document');
        if (!t) return { ok: false, kind: 'empty' };
        const r = D.parseDocument(t);
        if (r.ok) doc = r.doc;
        return r;
      },
      create(opts) {
        const r = D.createDocument(opts, rand);
        if (!r.ok) return r;
        const c = commit(r.doc);
        return c.ok ? { ok: true, doc: r.doc } : c;
      },
      /** Abrir: clasifica y valida antes de tocar nada; solo un v1 válido sustituye al activo. */
      open(text) {
        const r = D.parseDocument(text);
        if (!r.ok) return r;
        const c = commit(r.doc);
        return c.ok ? { ok: true, doc: r.doc, warnings: r.warnings } : c;
      },
      duplicate() {
        if (!doc) return { ok: false, message: 'No hay festival abierto.' };
        const next = D.duplicateDocument(doc, rand);
        const c = commit(next);
        return c.ok ? { ok: true, doc: next } : c;
      },
      setTimeContext(change) {
        if (!doc) return { ok: false, message: 'No hay festival abierto.' };
        const r = D.setTimeContext(doc, change);
        if (!r.ok) return r;
        const c = commit(r.doc);
        return c.ok ? { ok: true, doc: r.doc } : c;
      },
      /** Texto, nombre y MIME para descargar; no cambia nada. */
      save() { return doc ? D.serializeDocument(doc) : { ok: false, message: 'No hay festival abierto.' }; },
      close() { doc = null; store.remove('document'); }
    };
  }
  const api = { createSession };
  if (isNode) module.exports = api;
  else root.ShowtimeV1Session = api;
})(typeof window !== 'undefined' ? window : this);
