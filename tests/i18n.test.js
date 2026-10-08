/* Tests de i18n.js — sin dependencias.
 * Ordenador:  node tests/i18n.test.js   ·   node --test tests/i18n.test.js
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const I = isNode ? require('../i18n.js') : window.ShowtimeI18n;

  const NT = isNode ? require('node:test') : null;
  const tests = [];
  function test(name, fn) { if (NT) NT.test(name, fn); else tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const reset = () => I.setLang('es');

  test('i18n: diccionario completo en los dos idiomas (ninguna clave sin traducir)', () => {
    const m = I.missing();
    eq(m.en.join(', '), '', 'faltan en inglés');
    eq(m.es.join(', '), '', 'faltan en español');
    ok(I.keys('es').length > 20, 'hay claves');
    I.keys('en').forEach(k => ok(String(I.t(k, null, 'en')).length > 0 || k === 'print.printed', 'texto vacío: ' + k));
  });

  test('i18n: español por defecto; «en» → inglés; cualquier otro valor → español', () => {
    reset();
    eq(I.getLang(), 'es');
    eq(I.norm('en'), 'en'); eq(I.norm('fr'), 'es'); eq(I.norm(undefined), 'es');
    eq(I.t('print.cols.time'), 'Horario');
    eq(I.t('print.cols.time', null, 'en'), 'Time', 'pidiendo el idioma');
  });

  test('i18n: setLang cambia el idioma activo y avisa una sola vez', () => {
    reset();
    const seen = [];
    I.onChange(l => seen.push(l));
    ok(I.setLang('en'), 'cambia');
    ok(!I.setLang('en'), 'mismo idioma: no hace nada');
    eq(I.t('lang.short'), 'EN');
    eq(I.t('print.pills.hito'), 'MILESTONE');
    ok(I.setLang('es'));
    eq(seen.join(','), 'en,es');
  });

  test('i18n: clave que falta → la española, y si no existe, la propia clave', () => {
    const en = I.DICT.en.print, guard = en.brand;
    delete en.brand;
    try { eq(I.t('print.brand', null, 'en'), 'Showtime · Hoja de ruta', 'cae al español'); }
    finally { en.brand = guard; }
    eq(I.t('no.existe'), 'no.existe');
  });

  test('i18n: variables {n}', () => {
    const d = I.DICT.es.lang, guard = d.tmp;
    d.tmp = '{n} bloques de {zona}';
    try { eq(I.t('lang.tmp', { n: 3, zona: 'Principal' }), '3 bloques de Principal'); eq(I.t('lang.tmp', { n: 0 }), '0 bloques de {zona}', 'sin valor: se queda la marca'); }
    finally { if (guard === undefined) delete d.tmp; else d.tmp = guard; }
  });

  test('i18n: group devuelve la rama con huecos rellenos en español', () => {
    const g = I.group('print', 'en');
    eq(g.cols.time, 'Time'); eq(g.pills.tarea, 'TASK'); eq(g.footer, 'Showtime Stage Management');
    eq(I.group('print', 'es').footer, 'Showtime Regiduría');
  });

  test('i18n: apply traduce data-i18n, -title, -placeholder y -aria', () => {
    const mk = attrs => ({ a: Object.assign({}, attrs), textContent: 'x', getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.a[k] = v; } });
    const t1 = mk({ 'data-i18n': 'lang.label' }), t2 = mk({ 'data-i18n-title': 'lang.title' }), t3 = mk({ 'data-i18n-aria': 'lang.label' }), t4 = mk({ 'data-i18n-placeholder': 'lang.name' });
    const els = { '[data-i18n]': [t1], '[data-i18n-title]': [t2], '[data-i18n-placeholder]': [t4], '[data-i18n-aria]': [t3] };
    const rootEl = { querySelectorAll: sel => els[sel] || [] };
    I.setLang('en');
    try {
      eq(I.apply(rootEl), 4);
      eq(t1.textContent, 'Language'); ok(/Showtime language/.test(t2.a.title)); eq(t3.a['aria-label'], 'Language'); eq(t4.a.placeholder, 'English');
    } finally { reset(); }
  });

  let fail = 0;
  if (!NT) for (const [name, fn] of tests) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  }
  if (!NT) {
    console.log('\n' + (tests.length - fail) + '/' + tests.length + ' tests de idioma OK');
    if (fail && typeof process !== 'undefined') process.exitCode = 1;
  }
})();
