/* Tests de print.js — sin dependencias.
 * Ordenador:  node tests/print.test.js
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const P = isNode ? require('../print.js') : window.ShowtimePrint;

  // Con «node --test» (o «node tests/print.test.js») cada caso es un test de node:test; en el navegador, runner propio.
  const NT = isNode ? require('node:test') : null;
  const tests = [];
  function test(name, fn) { if (NT) NT.test(name, fn); else tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // ── Evento de prueba: dos jornadas, Principal y Carpa ─────────────────
  const J1 = '2026-07-10', J2 = '2026-07-11';
  function fest() {
    let s = C.newFestival({ nombre: 'Prueba print', fechaInicio: J1, fechaFin: J2, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const P1 = s.escenarios[0].id, K = s.escenarios[1].id, ids = {};
    const add = (n, d) => { const r = C.addArtist(s, d.modo || 'show', Object.assign({ nombre: n }, d)); if (!r.ok) throw new Error(n + ': ' + r.error); s = r.state; ids[n] = r.id; };
    add('Banda A', { jornada: J1, escenarioId: P1, inicio: '20:30', fin: '21:30', call: '20:00' });
    add('Banda B', { jornada: J1, escenarioId: P1, inicio: '22:00', fin: '23:00' });
    add('Acústico', { jornada: J1, escenarioId: K, inicio: '21:00', fin: '22:00' });
    add('Curfew', { jornada: J1, tipo: 'hito', escenarioId: P1, inicio: '23:30' });
    add('Banda C', { jornada: J2, escenarioId: P1, inicio: '21:00', fin: '22:00' });
    return { s, P1, K, ids };
  }

  test('kinds: casillas independientes (quitar tareas deja shows, pruebas e hitos)', () => {
    let { s, P: Pz } = (() => { const f = fest(); return { s: f.s, P: f.P1 }; })();
    const r = C.addArtist(s, 'show', { tipo: 'tarea', jornada: J1, nombre: 'Montaje backline', escenarioId: Pz, inicio: '16:00', fin: '17:00' });
    s = r.state;
    ok(P.rowsOf(s, { day: 'all', kinds: ['show', 'sc', 'tarea', 'hito'] }).some(x => x.kind === 'tarea'), 'la tarea entra con todo marcado');
    const sinTareas = P.rowsOf(s, { day: 'all', kinds: ['show', 'sc', 'hito'] });
    ok(sinTareas.length > 0 && sinTareas.every(x => x.kind !== 'tarea'), 'sin tareas: ninguna tarea');
    const soloShows = P.rowsOf(s, { day: 'all', kinds: ['show'] });
    eq(JSON.stringify(soloShows.map(r => r.name)), JSON.stringify(P.rowsOf(s, { day: 'all', content: 'solo' }).map(r => r.name)), 'kinds [show] = Solo Shows');
    eq(P.rowsOf(s, { day: 'all', kinds: [] }).length, 0, 'sin tipos → nada');
    eq(P.KINDS.map(k => k.k).join(','), 'show,sc,tarea,hito', 'cuatro casillas');
  });
  test('CONTENT: «Solo Shows» deja fuera pruebas, tareas e hitos', () => {
    const { s } = fest();
    const all = P.rowsOf(s, { day: 'all', content: 'all' });
    const solo = P.rowsOf(s, { day: 'all', content: 'solo' });
    ok(all.length > solo.length, 'todo debe tener más filas que solo shows');
    ok(solo.every(r => r.kind === 'show'), 'solo shows: todas de tipo show');
    ok(all.some(r => r.kind === 'hito'), 'todo incluye hitos');
  });

  test('rowsOf: filtra por jornada y por zona', () => {
    const { s, K } = fest();
    const d1 = P.rowsOf(s, { day: J1, content: 'all' });
    ok(d1.length > 0 && d1.every(r => r.jornada === J1), 'solo filas de la jornada pedida');
    const zk = P.rowsOf(s, { day: 'all', zone: K, content: 'all' });
    ok(zk.length === 1 && zk[0].name === 'Acústico', 'zona Carpa → solo Acústico, salió ' + zk.map(r => r.name));
  });

  test('rowsOf: horario, duración y CALL formateados', () => {
    const { s } = fest();
    const a = P.rowsOf(s, { day: J1, content: 'shows' }).find(r => r.name === 'Banda A');
    ok(a, 'Banda A presente');
    eq(a.start, '20:30'); eq(a.end, '21:30'); eq(a.dur, '60 min'); eq(a.call, '20:00');
    eq(a.kind, 'show');
  });

  test('densityFor: límites normal ≤14 · compact 15–22 · ultra-compact >22', () => {
    eq(P.densityFor(1).cls, 'density-normal'); eq(P.densityFor(14).cls, 'density-normal');
    eq(P.densityFor(15).cls, 'density-compact'); eq(P.densityFor(22).cls, 'density-compact');
    eq(P.densityFor(23).cls, 'density-ultra-compact'); eq(P.densityFor(90).cls, 'density-ultra-compact');
  });
  test('densityFor: letra 10pt → 8.5pt → 7.5pt', () => {
    eq(P.densityFor(10).fs, '10pt'); eq(P.densityFor(18).fs, '8.5pt'); eq(P.densityFor(30).fs, '7.5pt');
  });
  test('html: la sección lleva la clase de densidad de su jornada', () => {
    const rows = Array.from({ length: 16 }, (_, i) => ({ jornada: J1, start: '10:00', end: '11:00', dur: '60 min', call: '', zone: 'Z', zoneColor: '#000000', kind: 'show', name: 'B' + i, notes: '' }));
    const doc = P.html({ rows, days: [J1], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('class="sheet portrait density-compact"') >= 0, 'compact para 16 filas');
    ok(doc.indexOf('.density-ultra-compact{') >= 0, 'CSS de ultra-compact presente');
  });

  test('html: una hoja por jornada con salto de página', () => {
    const { s } = fest();
    const rows = P.rowsOf(s, { day: 'all', content: 'all' });
    const doc = P.html({ rows, days: [J1, J2], title: 'Prueba print', orient: 'portrait', notes: true, call: true, now: new Date(2026, 6, 10, 9, 5) });
    eq((doc.match(/<section class="sheet /g) || []).length, 2, 'dos secciones');
    ok(doc.indexOf('break-before:page') >= 0 || doc.indexOf('.sheet+.sheet') >= 0, 'salto de página entre hojas');
    ok(doc.indexOf('Impreso: 10/07/2026 09:05') >= 0, 'fecha de impresión en el pie');
    ok(doc.indexOf('Pág 1/2') >= 0 && doc.indexOf('Pág 2/2') >= 0, 'pie con Pág X/Y dentro de cada hoja');
    ok(doc.indexOf('<footer class="sheet-foot">') >= 0, 'pie como elemento HTML, no @page');
    ok(doc.indexOf('A4 portrait') >= 0, 'A4 vertical');
  });

  const R = (name, extra) => Object.assign({ jornada: J1, start: '10:00', end: '11:00', dur: '60 min', call: '', zone: 'Principal', zoneColor: '#e94560', kind: 'show', name, notes: '', aviso: false }, extra || {});
  test('html: incluye el ajuste de densidad al cargar (medición real en el navegador)', () => {
    const doc = P.html({ rows: [R('A')], days: [J1], title: 'X', orient: 'landscape' });
    ok(doc.indexOf("'density-min'") >= 0 && doc.indexOf("querySelectorAll('section.sheet')") >= 0, 'script de ajuste presente');
    ok(doc.indexOf('.density-min{') >= 0, 'clase density-min definida');
  });
  test('html: zona única → columna oculta y zona en la cabecera', () => {
    const doc = P.html({ rows: [R('A'), R('B')], days: [J1], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('<th>Escenario / zona</th>') < 0, 'sin columna de zona');
    ok(doc.indexOf('Zona: Principal') >= 0, 'zona en la cabecera');
  });
  test('html: varias zonas → la columna de zona se mantiene', () => {
    const doc = P.html({ rows: [R('A'), R('B', { zone: 'Carpa' })], days: [J1], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('<th>Escenario / zona</th>') >= 0, 'con columna de zona');
  });
  test('html: CALL solo aparece si alguna fila la tiene', () => {
    const none = P.html({ rows: [R('A')], days: [J1], title: 'X', orient: 'portrait', call: true });
    ok(none.indexOf('<th>CALL</th>') < 0, 'sin CALL en ninguna fila → columna oculta');
    const some = P.html({ rows: [R('A', { call: '09:45' })], days: [J1], title: 'X', orient: 'portrait', call: true });
    ok(some.indexOf('<th>CALL</th>') >= 0, 'con CALL → columna visible');
  });
  test('html: separador antes de «Apertura de puertas» (no en la primera fila)', () => {
    const doc = P.html({ rows: [R('Llegada', { kind: 'tarea' }), R('Apertura de puertas recinto', { kind: 'hito' }), R('Show')], days: [J1], title: 'X', orient: 'portrait' });
    eq((doc.match(/<tr class="sep">/g) || []).length, 1, 'un único separador');
    ok(doc.indexOf('<tr class="sep"><td class="t">19') < 0 && doc.indexOf('<tr class="sep">') < doc.indexOf('Apertura de puertas'), 'va justo antes de la apertura');
    const first = P.html({ rows: [R('Apertura de puertas')], days: [J1], title: 'X', orient: 'portrait' });
    ok(first.indexOf('class="sep"') < 0, 'no separa si es la primera fila');
  });
  test('html: aviso «*** … ***» ocupa todo el ancho', () => {
    const doc = P.html({ rows: [R('Llegada', { kind: 'tarea' }), R('*** Restricciones de PA hasta las 14:00 ***', { kind: 'hito', aviso: true })], days: [J1], title: 'X', orient: 'portrait', notes: true });
    ok(/<tr class="aviso"><td colspan="5">Restricciones de PA hasta las 14:00<\/td><\/tr>/.test(doc), 'fila de aviso con colspan total, sin asteriscos');
    ok(doc.indexOf('***') < 0, 'los asteriscos no se imprimen');
  });
  test('html: negrita en shows y curfews; tareas y pruebas en regular', () => {
    const doc = P.html({ rows: [R('Banda', { kind: 'show' }), R('Curfew de sonido', { kind: 'hito' }), R('Llegada', { kind: 'tarea' }), R('Prueba X', { kind: 'sc' })], days: [J1], title: 'X', orient: 'portrait' });
    eq((doc.match(/class="name strong"/g) || []).length, 2, 'show y curfew en negrita');
    eq((doc.match(/class="name"/g) || []).length, 2, 'tarea y prueba en regular');
  });
  test('html: nombre íntegro (sin recortar)', () => {
    const doc = P.html({ rows: [R('CONCIERTO OMEGA 30.º ANIVERSARIO: KIKI MORENTE & LAGARTIJA NICK')], days: [J1], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('CONCIERTO OMEGA 30.º ANIVERSARIO: KIKI MORENTE &amp; LAGARTIJA NICK') >= 0, 'nombre completo y escapado');
  });

  test('html: orientación horizontal y columnas opcionales', () => {
    const { s } = fest();
    const rows = P.rowsOf(s, { day: J1, content: 'all' });
    const doc = P.html({ rows, days: [J1], title: 'X', orient: 'landscape', notes: false, call: false });
    ok(doc.indexOf('A4 landscape') >= 0, 'A4 horizontal');
    ok(doc.indexOf('<th>CALL</th>') < 0, 'sin columna CALL');
    ok(doc.indexOf('Notas / operativa') < 0, 'sin columna notas');
    const withAll = P.html({ rows, days: [J1], title: 'X', orient: 'portrait', notes: true, call: true });
    ok(withAll.indexOf('<th>CALL</th>') >= 0 && withAll.indexOf('Notas / operativa') >= 0, 'con CALL y notas');
  });

  test('html: pastillas de tipo con el texto del spec', () => {
    const { s } = fest();
    const doc = P.html({ rows: P.rowsOf(s, { day: 'all', content: 'all' }), days: [J1, J2], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('>SHOW<') >= 0, 'SHOW');
    ok(doc.indexOf('>HITO<') >= 0, 'HITO');
  });

  test('html: escapa el texto del usuario (sin inyección)', () => {
    const rows = [{ jornada: J1, start: '20:00', end: '21:00', dur: '60 min', call: '', zone: '<img src=x>', zoneColor: '#000000', kind: 'show', name: '<script>alert(1)</script>', notes: '"a" & b' }];
    const doc = P.html({ rows, days: [J1], title: '<b>T</b>', orient: 'portrait', notes: true });
    ok(doc.indexOf('<script>alert') < 0, 'el nombre se escapa');
    ok(doc.indexOf('&lt;script&gt;') >= 0, 'escapado presente');
    ok(doc.indexOf('<img src=x>') < 0, 'zona escapada');
  });

  test('html: jornada sin filas muestra aviso y no rompe', () => {
    const doc = P.html({ rows: [], days: [J1], title: 'X', orient: 'portrait' });
    ok(doc.indexOf('Nada que imprimir') >= 0, 'aviso de vacío');
  });

  test('summary: cuenta bloques, hojas y letra según la jornada más cargada', () => {
    const { s } = fest();
    const rows = P.rowsOf(s, { day: 'all', content: 'all' });
    const sm = P.summary(rows, [J1, J2]);
    eq(sm.bloques, rows.length); eq(sm.hojas, 2);
    eq(sm.letra, P.densityFor(rows.filter(r => r.jornada === J1).length).fs);
    eq(P.summary(rows, [J1]).hojas, 1);
  });

  // ── Cronograma (Gantt) ─────────────────────────────────────────────────
  const G = (name, s, e, zone, kind, color) => ({ jornada: J1, start: '', end: '', dur: '', call: '', zone: zone || 'Principal', zoneColor: color || '#e94560', kind: kind || 'show', name, notes: '', aviso: false, s: s, e: e === undefined ? s + 60 : e });
  test('gantt: rango dinámico a horas completas con margen de 30 min', () => {
    const L = P.layoutGantt([G('A', 690), G('B', 980, 1030)], 273, 160);     // 11:30 … 17:10
    eq(L.a, 660, 'empieza 11:00 (690−30 = 660)');
    eq(L.b, 1080, 'acaba 18:00 (1030+30 → 1060 → 18:00)');
  });
  test('gantt: cuadrícula de 30 min si el rango cabe en 6 h; de 60 si no', () => {
    eq(P.layoutGantt([G('A', 600, 660), G('B', 700, 760)], 273, 160).step, 30, 'rango de 4 h');
    eq(P.layoutGantt([G('A', 600, 660), G('B', 1100, 1160)], 273, 160).step, 60, 'rango largo');
  });
  test('gantt: un carril por escenario; solapes en el mismo escenario van en sub-filas', () => {
    const L = P.layoutGantt([G('A', 700, 760), G('B', 730, 790), G('C', 800, 860, 'Carpa', 'show', '#0284c7')], 273, 160);
    eq(L.lanes.length, 2, 'dos escenarios');
    eq(L.lanes[0].rows, 2, 'Principal necesita 2 sub-filas (A y B se solapan)');
    eq(L.lanes[1].rows, 1, 'Carpa 1 fila');
  });
  test('gantt: barras proporcionales al tiempo y hitos como líneas', () => {
    const L = P.layoutGantt([G('A', 600, 720), G('Apertura', 780, null, 'Principal', 'hito')], 273, 160);
    const bar = L.bars[0];
    ok(Math.abs(bar.w / (L.x1 - L.x0) * (L.b - L.a) - 120) < 0.01, 'una hora de bloque = 120 min de eje');
    eq(L.hitos.length, 1, 'un hito');
    const svg = P.ganttSvg(L);
    ok(svg.indexOf('stroke="#dc2626"') >= 0 && svg.indexOf('stroke-dasharray="1.1,0.8"') >= 0, 'hito: línea roja discontinua');
    ok(svg.indexOf('<svg class="gantt"') === 0 && svg.indexOf('</svg>') > 0, 'SVG inline bien formado');
  });
  test('gantt: etiqueta que cabe o se trunca o desaparece', () => {
    eq(P.fitLabel('Show', '15:20–16:10', 60, 3), 'Show  15:20–16:10', 'cabe con horario');
    eq(P.fitLabel('Show', '15:20–16:10', 8, 3), 'Show', 'solo nombre');
    ok(P.fitLabel('Nombre muy largo de banda', '15:20', 12, 3).slice(-1) === '…', 'truncado con puntos');
    eq(P.fitLabel('Nombre', '15:20', 2, 3), '', 'no cabe nada');
  });
  test('gantt: el nombre se parte en líneas dentro de la barra, con «…» si no cabe', () => {
    eq(P.wrapLines('Llegada y descarga', '', 30, 4, 3).join('|'), 'Llegada y|descarga', 'dos líneas');
    eq(P.wrapLines('Uno dos tres cuatro cinco seis siete', '', 14, 4, 2).length, 2, 'máximo dos líneas');
    ok(P.wrapLines('Uno dos tres cuatro cinco seis siete', '', 14, 4, 2)[1].slice(-1) === '…', 'última línea con puntos');
    eq(P.wrapLines('Corta', '15:20', 40, 4, 3).join('|'), 'Corta|15:20', 'la hora va en su línea si cabe');
    eq(P.wrapLines('Algo', '15:20', 40, 4, 0).length, 0, 'sin líneas si no hay alto');
  });
  test('gantt: nunca parte palabras; «…» quita palabras enteras', () => {
    eq(P.wrapLines('Montaje suelo flamenco', '', 20, 3, 3).join('|'), 'Montaje|suelo|flamenco', 'palabras enteras');
    const t = P.wrapLines('Montaje suelo flamenco de la noche', '', 20, 3, 2);
    ok(t.length === 2 && t[1].slice(-1) === '…', 'truncado con «…»');
    ok(t.every(l => l.replace('…', '').split(' ').every(w => ['Montaje','suelo','flamenco','de','la','noche'].indexOf(w) >= 0)), 'ninguna palabra amputada');
    eq(P.cutWords('Apertura de puertas recinto', 20), 'Apertura de…', 'cut limpio en palabra');
  });
  test('gantt: carriles de igual altura que llenan el alto; hitos verticales; margen derecho', () => {
    const H = 164;
    const L = P.layoutGantt([G('A', 600, 660), G('B', 700, 760), G('C', 630, 700, 'Carpa', 'show', '#0284c7'),
      G('Fin de pruebas', 690, null, 'Principal', 'hito'), G('Apertura de puertas recinto', 1140, null, 'Principal', 'hito')], 273, H);
    eq(L.lanes.length, 2, 'dos carriles');
    eq(L.lanes[0].h.toFixed(2), L.lanes[1].h.toFixed(2), 'misma altura por escenario');
    const bottom = L.lanes[L.lanes.length - 1].y + L.lanes[L.lanes.length - 1].h;
    ok(Math.abs(bottom - (H - 1)) < 1.5, 'los carriles llegan casi al pie');
    ok(L.lanes[0].h > 40, 'carriles altos (no tope de 22 mm)');
    const svg = P.ganttSvg(L);
    ok(svg.indexOf('rotate(-90') >= 0, 'etiquetas de hito verticales');
    ok(L.x1 < L.W - 5, 'margen derecho para la última hora');
  });
  test('gantt: html con formato gantt → hojas apaisadas con SVG y pie', () => {
    const rows = [G('A', 690, 780), G('B', 900, 960, 'Carpa', 'show', '#0284c7')];
    const doc = P.html({ rows, days: [J1], title: 'Prueba', format: 'gantt', orient: 'portrait', now: new Date() });
    ok(doc.indexOf('A4 landscape') >= 0, 'apaisado aunque pidan vertical');
    ok(doc.indexOf('<svg class="gantt"') >= 0, 'SVG inline');
    ok(doc.indexOf('<footer class="sheet-foot">') >= 0 && doc.indexOf('Pág 1/1') >= 0, 'pie con paginación');
    ok(doc.indexOf('<table') < 0, 'no mezcla tabla');
  });
  test('gantt: sin bloques con hora → mensaje y no rompe', () => {
    const doc = P.html({ rows: [], days: [J1], title: 'X', format: 'gantt' });
    ok(doc.indexOf('Nada que dibujar') >= 0, 'aviso de vacío');
  });

  test('dayLabel y printedAt', () => {
    ok(P.dayLabel(J1).indexOf('2026') < 0, 'no añade año');
    eq(P.dayLabel('all'), 'Todo el evento');
    eq(P.printedAt(new Date(2026, 0, 5, 7, 3)), '05/01/2026 07:03');
  });

  let fail = 0;
  if (!NT) for (const [name, fn] of tests) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  }
  if (!NT) {
    console.log('\n' + (tests.length - fail) + '/' + tests.length + ' tests de impresión OK');
    if (fail) process.exitCode = 1;
  }
})();
