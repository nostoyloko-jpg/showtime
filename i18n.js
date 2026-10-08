/* Showtime · i18n.js — idioma de toda la suite (Panel, pantallas Live, Mando e impresión). 0 dependencias.
 *
 *  - Diccionario por idioma (es / en), en árbol: t('print.cols.time') → «Horario» / «Time».
 *    Si una clave falta en inglés, sale la española (nunca una pantalla vacía); si falta en los dos, la propia clave.
 *  - El idioma lo manda el Panel: va en la configuración (CONFIG.lang, guardada en este navegador) y viaja con la
 *    emisión, así que las pantallas Live y el Mando lo siguen solos. Aquí solo se aplica: setLang(l).
 *  - HTML estático: data-i18n="clave" (texto), data-i18n-title, data-i18n-placeholder, data-i18n-aria (aria-label).
 *    El texto español se deja escrito en el HTML: sin JavaScript o antes de cargar, la página sale igual que siempre.
 *  - Variables: t('x', { n: 3 }) sustituye {n}.
 *
 *  Ordenador:  node tests/i18n.test.js
 */
(function (root) {
  'use strict';

  const LANGS = ['es', 'en'];

  const DICT = {
    es: {
      lang: {
        name: 'Español', short: 'ES', locale: 'es-ES',
        label: 'Idioma',
        title: 'Idioma de Showtime: Panel, pantallas Live, Mando y hojas impresas',
        note: 'Lo manda este Panel: las pantallas Live y el Mando cambian solos (también por la emisión).',
        btnTitle: 'Idioma: Español. Clic: English',
        changed: 'Idioma: Español'
      },
      print: {
        htmlLang: 'es', locale: 'es-ES',
        cols: { time: 'Horario', dur: 'Duración', call: 'CALL', zone: 'Escenario / zona', type: 'Tipo', name: 'Artista / actividad', notes: 'Notas / operativa' },
        pills: { show: 'SHOW', sc: 'SOUNDCHECK', tarea: 'TAREA', hito: 'HITO' },
        brand: 'Showtime · Hoja de ruta', brandGantt: 'Showtime · Cronograma', footer: 'Showtime Regiduría',
        printed: 'Impreso: ', page: 'Pág ', allDays: 'Todas las jornadas', noDay: 'Todo el evento',
        allStages: 'Todos los escenarios', full: 'Todo el horario', blocks: 'bloques', stages: 'escenarios',
        zone: 'Zona: ', noZone: 'Sin zona', empty: 'Nada que imprimir con estos filtros.', emptyGantt: 'Nada que dibujar con estos filtros.',
        legend: { tarea: 'Tareas técnicas', sc: 'Pruebas de sonido', show: 'Conciertos / Shows' }
      }
    },
    en: {
      lang: {
        name: 'English', short: 'EN', locale: 'en-GB',
        label: 'Language',
        title: 'Showtime language: Panel, Live screens, Stage remote and printed sheets',
        note: 'Set from this Panel: Live screens and the Stage remote follow it (also over the broadcast).',
        btnTitle: 'Language: English. Click: Español',
        changed: 'Language: English'
      },
      print: {
        htmlLang: 'en', locale: 'en-GB',
        cols: { time: 'Time', dur: 'Duration', call: 'CALL', zone: 'Stage / zone', type: 'Type', name: 'Artist / activity', notes: 'Notes / running order' },
        pills: { show: 'SHOW', sc: 'SOUNDCHECK', tarea: 'TASK', hito: 'MILESTONE' },
        brand: 'Showtime · Running order', brandGantt: 'Showtime · Timeline', footer: 'Showtime Stage Management',
        printed: 'Printed: ', page: 'Page ', allDays: 'All days', noDay: 'Whole event',
        allStages: 'All stages', full: 'Full schedule', blocks: 'blocks', stages: 'stages',
        zone: 'Stage: ', noZone: 'No stage', empty: 'Nothing to print with these filters.', emptyGantt: 'Nothing to draw with these filters.',
        legend: { tarea: 'Technical tasks', sc: 'Soundchecks', show: 'Shows' }
      }
    }
  };

  let cur = 'es';
  const listeners = [];

  /** «en» → inglés; cualquier otra cosa → español (el idioma por defecto). */
  function norm(l) { return l === 'en' ? 'en' : 'es'; }
  function getLang() { return cur; }

  function lookup(lang, key) {
    let o = DICT[lang];
    const parts = String(key).split('.');
    for (let i = 0; i < parts.length; i++) {
      if (o === null || typeof o !== 'object' || !(parts[i] in o)) return undefined;
      o = o[parts[i]];
    }
    return o;
  }

  /** Texto de una clave en el idioma activo (o en lang). Falta en inglés → español; falta en los dos → la clave. */
  function t(key, vars, lang) {
    const L = norm(lang || cur);
    let s = lookup(L, key);
    if (typeof s !== 'string') s = lookup('es', key);
    if (typeof s !== 'string') return String(key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    return s;
  }

  /** Rama entera del diccionario (p. ej. group('print', 'en')), con las claves que falten rellenas en español. */
  function group(prefix, lang) {
    const L = norm(lang || cur);
    const base = lookup('es', prefix), over = lookup(L, prefix);
    const merge = (a, b) => {
      if (a === null || typeof a !== 'object') return b !== undefined ? b : a;
      const out = {};
      Object.keys(a).forEach(k => { out[k] = merge(a[k], b && typeof b === 'object' ? b[k] : undefined); });
      return out;
    };
    return merge(base, over);
  }

  /** Traduce el HTML estático marcado con data-i18n*. */
  function apply(rootEl) {
    const r = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!r || !r.querySelectorAll) return 0;
    let n = 0;
    r.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); n++; });
    [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label']].forEach(([a, prop]) => {
      r.querySelectorAll('[' + a + ']').forEach(el => { el.setAttribute(prop, t(el.getAttribute(a))); n++; });
    });
    return n;
  }

  /** Cambia el idioma activo, traduce la página y avisa. Devuelve true si ha cambiado. */
  function setLang(l) {
    const L = norm(l);
    if (L === cur) return false;
    cur = L;
    if (typeof document !== 'undefined' && document.documentElement) { document.documentElement.lang = L; apply(document); }
    listeners.slice().forEach(fn => { try { fn(L); } catch (e) { console.error(e); } });
    return true;
  }
  function onChange(fn) { listeners.push(fn); }

  /** Claves (hojas) de un idioma, en forma «a.b.c». */
  function keys(lang) {
    const out = [];
    const walk = (o, p) => Object.keys(o).forEach(k => {
      const v = o[k], key = p ? p + '.' + k : k;
      if (v !== null && typeof v === 'object') walk(v, key); else out.push(key);
    });
    walk(DICT[norm(lang)], '');
    return out;
  }
  /** Claves que están en un idioma y no en el otro (para los tests: el diccionario siempre completo). */
  function missing() {
    const es = keys('es'), en = keys('en');
    return { en: es.filter(k => en.indexOf(k) < 0), es: en.filter(k => es.indexOf(k) < 0) };
  }

  const API = { LANGS, DICT, norm, getLang, setLang, onChange, t, group, apply, keys, missing };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeI18n = API;
})(typeof window !== 'undefined' ? window : globalThis);
