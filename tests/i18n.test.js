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
    eq(I.t('print.pills.hito'), 'KEY TIME');
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

  // ── Fase 1: textos de la interfaz con el español como clave (tx) ──────────────────────────────
  const UI = Object.assign({}, ...Object.keys(I.UI_EN).map(g => I.UI_EN[g]));
  test('tx: en español sale idéntico (también lo que no está en el diccionario); en inglés, traducido', () => {
    reset();
    eq(I.tx('Pegar horario'), 'Pegar horario', 'español: tal cual');
    eq(I.tx('Texto que no existe'), 'Texto que no existe');
    eq(I.tx('Importar {n} entradas', { n: 3 }), 'Importar 3 entradas', 'variables en español');
    I.setLang('en');
    try {
      eq(I.tx('Pegar horario'), 'Paste schedule');
      eq(I.tx('Importar {n} entradas', { n: 3 }), 'Import 3 entries');
      eq(I.tx('Texto que no existe'), 'Texto que no existe', 'sin traducción: cae al español, nunca en blanco');
      eq(I.tx('Pegar horario', null, 'es'), 'Pegar horario', 'pidiendo el español (log, Deshacer)');
      ok(I.txHas('Pegar horario') && !I.txHas('Texto que no existe'));
    } finally { reset(); }
  });
  test('tx: glosario oficial del Panel de Control', () => {
    const G = { 'Configuración': 'Settings', 'Emisión': 'Broadcast', 'Siguiente': 'Next', 'En escena': 'On stage', 'Marcadores': 'Key Times', 'Marcador': 'Key Time', 'Solo los conciertos': 'Shows only',
      'Modo Foco': 'Focus Mode', 'Tiempo extra': 'Extra time', 'Pegar horario': 'Paste schedule', 'Jornada': 'Day', 'Zona': 'Stage',
      'Retrasos': 'Delays', 'Deshacer': 'Undo', 'Soundchecks': 'Soundchecks', 'Exportar log del evento…': 'Export event log…' };
    Object.keys(G).forEach(k => eq(I.tx(k, null, 'en'), G[k], k));
    Object.keys(UI).forEach(k => ok(!/\b(Zone|Zones|Journey|Workday|Rehearsal|Emission|Configuration)\b/.test(UI[k]), 'fuera del glosario: ' + UI[k]));
  });
  test('tx: diccionario de la interfaz sano (grupos, sin huecos, mismas variables y etiquetas HTML que el español)', () => {
    ['panel', 'modals', 'toasts', 'spotlight'].forEach(g => ok(I.UI_EN[g] && Object.keys(I.UI_EN[g]).length > 10, 'grupo ' + g));
    ok(Object.keys(UI).length > 600, 'más de 600 textos');
    const vars = s => (String(s).match(/\{\w+\}/g) || []).sort().join(' ');
    const tags = s => (String(s).match(/<\/?[a-z]+/g) || []).sort().join(' ');
    Object.keys(UI).forEach(k => {
      ok(typeof UI[k] === 'string' && (UI[k].trim().length > 0 || !k.trim().length), 'traducción vacía: ' + k);
      eq(vars(UI[k]), vars(k), 'variables de «' + k + '»');
      eq(tags(UI[k]), tags(k), 'etiquetas HTML de «' + k + '»');
    });
    const seen = {};
    Object.keys(I.UI_EN).forEach(g => Object.keys(I.UI_EN[g]).forEach(k => { ok(!seen[k], 'repetido en ' + seen[k] + ' y ' + g + ': ' + k); seen[k] = g; }));
  });
  test('apply (modo texto): traduce los trozos de texto sin tocar los iconos, y vuelve al español', () => {
    const txt = v => ({ nodeType: 3, nodeValue: v }), icon = { nodeType: 1, nodeValue: null };
    const n1 = txt('  Pegar horario '), el = { childNodes: [icon, n1], getAttribute: () => '' };
    const at = { a: { title: 'Deshacer', 'data-i18n-title': '' }, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.a[k] = v; } };
    const els = { '[data-i18n]': [el], '[data-i18n-title]': [at] };
    const rootEl = { querySelectorAll: sel => els[sel] || [] };
    I.setLang('en');
    try {
      I.apply(rootEl);
      eq(n1.nodeValue, '  Paste schedule ', 'conserva los espacios'); eq(el.childNodes[0], icon, 'el icono sigue');
      eq(at.a.title, 'Undo');
      I.setLang('es'); I.apply(rootEl);
      eq(n1.nodeValue, '  Pegar horario ', 'vuelve al español original'); eq(at.a.title, 'Deshacer');
    } finally { reset(); }
  });

  test('Vocabulario oficial: Marcador / Key Time · Shows only · Daily report · Extra time · Overrun', () => {
    const E = k => I.tx(k, null, 'en');
    eq(E('Marcador'), 'Key Time'); eq(E('Marcadores'), 'Key Times'); eq(E('MARCADOR'), 'KEY TIME');
    eq(I.t('print.pills.hito', null, 'es'), 'MARCADOR'); eq(I.t('print.pills.hito', null, 'en'), 'KEY TIME');
    eq(E('Solo los conciertos'), 'Shows only'); eq(E('Solo conciertos'), 'Shows only');
    ok(/^Daily report/.test(E('Informe de la jornada: el horario previsto y, a su hora, lo que ha pasado (PDF, TXT o CSV)')));
    eq(E('Tiempo extra'), 'Extra time'); eq(E('TIEMPO EXTRA'), 'EXTRA TIME'); eq(E('Desbordes'), 'Overruns');
    Object.keys(UI).forEach(k => {
      ok(!/\b(Hitos?|HITOS?|hitos?)\b/.test(k), 'queda «hito» en español: ' + k);
      ok(!/milestone|concerts only|day report/i.test(UI[k]), 'vocabulario antiguo: ' + UI[k]);
    });
  });
  if (isNode) test('Fase 2: la cinta de Backstage (vistas.js) sigue el idioma activo', () => {
    const V = require('../vistas.js'), C = require('../core.js');
    const F = C.demoFestival(Math.floor(C.nowAbs())), now = C.nowAbs();
    const txt = () => V.tickerItems(F, null, now, null, []).map(x => x.text).join(' | ');
    ok(/EN HORA · SIN INCIDENCIAS/.test(txt()), txt());
    I.setLang('en');
    try { ok(/ON TIME · NO INCIDENTS/.test(txt()), txt()); } finally { reset(); }
    ok(/EN HORA · SIN INCIDENCIAS/.test(txt()), 'vuelve al español');
  });

  test('txBack: los apuntes del Registro de eventos (guardados en español) se leen en inglés; el texto de la gente no se toca', () => {
    const B = s => I.txBack(s, 'en');
    eq(I.txBack('▶ Show «OMEGA» empieza 21:45 · +5 min', 'es'), '▶ Show «OMEGA» empieza 21:45 · +5 min', 'en español, intacto');
    eq(B('▶ Show «OMEGA» empieza 21:45 · +5 min'), '▶ Show “OMEGA” starts 21:45 · +5 min');
    eq(B('■ Show «OMEGA» termina 23:30 · acaba 10 min antes'), '■ Show “OMEGA” ends 23:30 · ends 10 min early');
    eq(B('Reconciliación: Zona Escenario 1 vuelve a EN HORA (absorbidos +10 min en changeover) · Stage Manager'), 'Reconciliation: Stage Escenario 1 back to ON TIME (+10 min absorbed in changeover) · Stage Manager');
    eq(B('Retraso +15 min (Escenario Principal): 3 entradas movidas'), 'Manual delay: +15 min on Escenario Principal: 3 entries moved');
    eq(B('CALL OK · OMEGA · Producción (Marta)'), 'CALL confirmed · OMEGA · Production (Marta)');
    eq(B('OMEGA: TIEMPO EXTRA · puede gastar el colchón del cambio; pasado, retrasa lo que viene de su zona hasta ■'), 'OMEGA: EXTRA TIME enabled · may use the changeover buffer; beyond it, delays what follows on its stage until ■');
    eq(B('Aviso (previsión): Viento medio 45 km/h ahora · umbral 40'), 'Weather alert (forecast): Mean wind 45 km/h now · threshold 40');
    eq(B('«Comida · en 5 min, ya» → Todas las pantallas'), '“Comida · en 5 min, ya” → All screens', 'mensaje: su texto, tal cual');
    eq(B('«Banda B»: nombre «Banda B» → «Banda Beta» · zona Carpa → sin zona'), '“Banda B”: name “Banda B” → “Banda Beta” · stage Carpa → no stage');
    eq(B('Algo que no conoce nadie'), 'Algo que no conoce nadie', 'lo desconocido se queda como está');
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
