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

  test('i18n: español por defecto; inglés con lang:"en"', () => {
    const { s } = fest();
    const rows = P.rowsOf(s, { day: 'all', content: 'all' });
    const es = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', notes: true, call: true, now: new Date(2026, 6, 10) });
    const en = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', notes: true, call: true, now: new Date(2026, 6, 10), lang: 'en' });
    ok(es.indexOf('<html lang="es">') >= 0 && es.indexOf('>Horario<') >= 0 && es.indexOf('Pág 1/1') >= 0, 'es: cabeceras y pie');
    ok(es.indexOf('Escenario / zona') >= 0 && es.indexOf('Artista / actividad') >= 0, 'es: columnas');
    ok(en.indexOf('<html lang="en">') >= 0 && en.indexOf('>Time<') >= 0 && en.indexOf('>Duration<') >= 0, 'en: cabeceras');
    ok(en.indexOf('Stage / zone') >= 0 && en.indexOf('Artist / activity') >= 0 && en.indexOf('Notes / running order') >= 0, 'en: columnas');
    ok(en.indexOf('Printed: 10/07/2026') >= 0 && en.indexOf('Page 1/1') >= 0, 'en: pie');
    ok(en.indexOf('Horario') < 0 && en.indexOf('Impreso') < 0, 'en: sin rastro en español');
  });
  test('i18n: SOUNDCHECK en ambos idiomas; TASK/MILESTONE solo en inglés', () => {
    const rows = [G('Prueba A', 600, 630, 'Principal', 'sc'), G('Tarea B', 640, 660, 'Principal', 'tarea'), G('Hito C', 700, null, 'Principal', 'hito')];
    const es = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', now: new Date(2026, 6, 10) });
    const en = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', now: new Date(2026, 6, 10), lang: 'en' });
    ok(es.indexOf('>SOUNDCHECK<') >= 0 && es.indexOf('>TAREA<') >= 0 && es.indexOf('>HITO<') >= 0, 'es: píldoras');
    ok(en.indexOf('>SOUNDCHECK<') >= 0 && en.indexOf('>TASK<') >= 0 && en.indexOf('>MILESTONE<') >= 0, 'en: píldoras');
    ok(es.indexOf('PRUEBA') < 0, 'ya no aparece PRUEBA');
  });
  test('i18n: fecha en inglés, separador de noche bilingüe y cronograma traducido', () => {
    ok(P.dayLabel(J1, 'en').indexOf('2026') >= 0, 'en: lleva año');
    ok(P.dayLabel(J1, 'en') !== P.dayLabel(J1), 'en distinto de es');
    eq(P.dayLabel('all', 'en'), 'Whole event');
    eq(P.dayLabel('all'), 'Todo el evento');
    const rows = [G('Show A', 600, 660), G('Doors open', 1140, null, 'Principal', 'hito'), G('Show B', 1200, 1260)];
    const en = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', now: new Date(2026, 6, 10), lang: 'en' });
    ok(en.indexOf('class="pr-sep') < 0 && /<tr class="sep">/.test(en), 'en: separador en «Doors open»');
    const g = P.html({ rows, days: [J1], title: 'T', format: 'gantt', now: new Date(2026, 6, 10), lang: 'en' });
    ok(g.indexOf('stages') >= 0 && g.indexOf('blocks') >= 0 && g.indexOf('Timeline') >= 0, 'en: cronograma traducido');
  });
  test('html: una hoja por jornada con salto de página', () => {
    const { s } = fest();
    const rows = P.rowsOf(s, { day: 'all', content: 'all' });
    const doc = P.html({ rows, days: [J1, J2], title: 'Prueba print', orient: 'portrait', notes: true, call: true, now: new Date(2026, 6, 10, 9, 5) });
    eq((doc.match(/<section class="sheet /g) || []).length, 2, 'dos secciones');
    ok(doc.indexOf('break-before:page') >= 0 || doc.indexOf('.sheet+.sheet') >= 0, 'salto de página entre hojas');
    ok(doc.indexOf('Impreso: 10/07/2026') >= 0, 'fecha de impresión en el pie');
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
  test('gantt: carriles de igual altura (45–60 mm con 2 escenarios); hitos en pista superior; margen derecho', () => {
    const H = 164;
    const L = P.layoutGantt([G('A', 600, 660), G('B', 700, 760), G('C', 630, 700, 'Carpa', 'show', '#0284c7'),
      G('Fin de pruebas', 690, null, 'Principal', 'hito'), G('Apertura de puertas recinto', 1140, null, 'Principal', 'hito')], 273, H);
    eq(L.lanes.length, 2, 'dos carriles');
    eq(L.lanes[0].h.toFixed(2), L.lanes[1].h.toFixed(2), 'misma altura por escenario');
    const bottom = L.lanes[L.lanes.length - 1].y + L.lanes[L.lanes.length - 1].h;
    ok(L.lanes[0].h >= 45 && L.lanes[0].h <= 60, 'cada pista entre 45 y 60 mm');
    ok(bottom <= H - 1 && bottom > H * 0.7, 'los carriles ocupan la parte baja de la hoja');
    ok(L.lanes[0].h > 40, 'carriles altos (no tope de 22 mm)');
    const svg = P.ganttSvg(L);
    ok(!/rotate\(-90[^>]*fill="#991b1b"/.test(svg), 'hitos sin texto vertical');
    ok(L.LW === 14 && /rotate\(-90[^>]*>Principal</.test(svg), 'escenario en vertical en una columna de 14 mm');
    ok(L.hitos.length === 2 && L.hitos[0].y === undefined && svg.indexOf('Apertura recinto') >= 0, 'hitos con etiqueta horizontal');
    ok(L.x1 < L.W - 5, 'margen derecho para la última hora');
  });
  test('gantt: ningún bloque vacío; estrechos sin sitio → llamada numerada y leyenda', () => {
    const rows = [G('Montaje suelo escenario principal', 600, 615), G('Linecheck Lagartija Nick', 615, 640), G('Show largo con nombre', 700, 820, 'Principal', 'show', '#e11d48'),
      G('Pruebas', 900, 960, 'Carpa', 'sc', '#0284c7'), G('Fin', 1200, null, 'Principal', 'hito')];
    const L = P.layoutGantt(rows, 273, 164);
    ok(L.bars.every(b => b.lines.length || b.badge > 0), 'toda barra tiene texto o llamada');
    const called = L.bars.filter(b => b.badge > 0);
    ok(called.length >= 1 && called.every(b => b.w < 25), 'solo llevan llamada los estrechos');
    eq(L.legend.length, called.length, 'una entrada de leyenda por llamada');
    eq(called.map(b => b.badge).join(','), called.map((b, i) => i + 1).join(','), 'numeradas 1, 2, 3… por hora');
    ok(L.legend[0].text.indexOf('(10:00–10:15)') >= 0, 'leyenda con nombre y horario');
    ok(L.lanesBottom < L.legendTop, 'la leyenda va debajo de los carriles');
    L.bars.filter(b => b.w >= 25).forEach(b => ok(b.lines.length >= 2, 'ancho: nombre + horario'));
    const svg = P.ganttSvg(L);
    ok(svg.indexOf('<rect') >= 0 && L.bars.filter(b => b.mark).every(b => b.mark.shape), 'distintivo dibujado (no depende de la fuente)');
  });
  test('gantt: OMEGA no se trunca si cabe en 2 líneas; medida por carácter', () => {
    eq(P.wrapLines('OMEGA 30.º Aniversario', '', 32, 3, 3).join('|'), 'OMEGA 30.º|Aniversario', 'dos líneas sin «…»');
    ok(P.textW('iiii', 3) < P.textW('MMMM', 3), 'una i ocupa menos que una M');
    ok(P.textW('Ab', 3, true) > P.textW('Ab', 3), 'negrita más ancha');
  });
  test('gantt: hitos en 2 niveles alternos, recortados hasta el siguiente de su nivel', () => {
    const rows = [G('A', 600, 1300), G('Fin de pruebas del escenario principal', 1170, null, 'Principal', 'hito'),
      G('Apertura puertas', 1170, null, 'Principal', 'hito'), G('Apertura de puertas auditorio', 1200, null, 'Principal', 'hito'),
      G('Curfew de sonido', 1230, null, 'Principal', 'hito'), G('Curfew de camerinos', 1260, null, 'Principal', 'hito')];
    const L = P.layoutGantt(rows, 273, 164);
    eq(L.hitos.length, 4, 'agrupados por hora');
    eq(L.hitos.map(h => h.row).join(','), '0,1,0,1', 'niveles alternos');
    ok(L.hitos[0].label.indexOf('19:30') === 0, 'empieza por la hora');
    [0, 1].forEach(r => { const hs = L.hitos.filter(h => h.row === r); for (let i = 1; i < hs.length; i++) ok(hs[i - 1].endX <= hs[i].x, 'sin solape en el nivel ' + r); });
  });
  test('gantt: carriles en el orden de la configuración, aunque el de arriba empiece más tarde', () => {
    const z = (r, o) => Object.assign(r, { zoneOrder: o });
    const L = P.layoutGantt([z(G('Temprano', 600, 660, 'Carpa'), 1), z(G('Tarde', 1200, 1260, 'Principal'), 0), z(G('Sin config', 500, 560, 'Otra'), 1e6)], 273, 164);
    eq(L.lanes.map(l => l.name).join(','), 'Principal,Carpa,Otra', 'Principal arriba siempre; las desconocidas al final');
    const { s } = fest();
    const rows = P.rowsOf(s, { day: 'all', content: 'all' });
    ok(rows.length && rows.every(r => r.zoneOrder === 0 || r.zoneOrder === 1), 'rowsOf trae la posición de la zona en la configuración');
    ok(rows.some(r => r.zone === 'Principal' && r.zoneOrder === 0), 'Principal es la primera zona');
  });
  test('gantt: 3 geometrías de llamada (show [A] · soundcheck ① · tarea ◆1), también en la leyenda', () => {
    const rows = [G('Banda de apertura larga', 600, 610, 'Principal', 'show'), G('Otra banda larga', 610, 620, 'Principal', 'show'),
      G('Linecheck Lagartija', 620, 630, 'Principal', 'sc'), G('Montaje suelo escenario', 630, 640, 'Principal', 'tarea'),
      G('Descarga camiones', 640, 650, 'Principal', 'tarea'), G('Relleno', 660, 1200, 'Carpa', 'tarea')];
    const L = P.layoutGantt(rows, 273, 164);
    const m = L.bars.filter(b => b.mark).map(b => b.kind + ':' + b.mark.shape + ':' + b.mark.label).join(',');
    eq(m, 'show:square:A,show:square:B,sc:circle:1,tarea:diamond:1,tarea:diamond:2', 'letras en cuadrado, números en círculo y en rombo');
    eq(L.legend.map(it => it.mark.shape + it.mark.label).join(','), 'diamond1,diamond2,circle1,squareA,squareB', 'leyenda agrupada: tareas, soundchecks, shows');
    const svg = P.ganttSvg(L);
    ok(svg.indexOf('<polygon') >= 0 && svg.indexOf('<circle') >= 0 && />A<\/text>/.test(svg), 'rombo, círculo y cuadrado con letra en el SVG');
  });
  test('gantt: anclaje inteligente de hitos al final del día; solo el nombre principal', () => {
    const rows = [G('A', 1080, 1500), G('Apertura de puertas', 1200, null, 'Principal', 'hito'),
      G('Curfew de sonido', 1410, null, 'Principal', 'hito'), G('Curfew de camerinos (Hora exacta TBC)', 1470, null, 'Principal', 'hito')];
    const L = P.layoutGantt(rows, 273, 164);
    const h = L.hitos.find(x => x.time === '00:30');
    eq(h.anchor, 'end', '00:30 se escribe hacia la izquierda');
    eq(h.label, '00:30 Curfew de camerinos', 'completo y sin la nota entre paréntesis');
    eq(L.hitos.find(x => x.time === '20:00').anchor, 'start', 'los de antes de las 22:30, hacia la derecha');
    ok(L.hitos.find(x => x.time === '23:30').anchor === 'end', '23:30 también hacia la izquierda');
  });
  test('gantt: un hito que chocaría con los que vienen de la derecha cambia de lado', () => {
    const rows = [G('A', 690, 1470), G('Fin de pruebas', 1170, null, 'Principal', 'hito'), G('Apertura puertas', 1170, null, 'Principal', 'hito'),
      G('Apertura de puertas', 1260, null, 'Principal', 'hito'), G('Curfew de sonido', 1410, null, 'Principal', 'hito'),
      G('Curfew de camerinos', 1470, null, 'Principal', 'hito')];
    const L = P.layoutGantt(rows, 273, 164);
    eq(L.hitos[0].anchor, 'end', '19:30 pasa a escribirse hacia la izquierda');
    ok(L.hitos.every(h => h.label.indexOf('…') < 0), 'todas las etiquetas completas: ' + L.hitos.map(h => h.label).join(' | '));
  });
  test('gantt: hitos con solo el título limpio (sin «Hora exacta TBC» ni aclaraciones)', () => {
    eq(P.hitoName('Apertura de puertas auditorio Hora exacta TBC'), 'Apertura auditorio');
    eq(P.hitoName('Apertura de puertas recinto'), 'Apertura recinto');
    eq(P.hitoName('Apertura de puertas'), 'Apertura de puertas', 'sin nada detrás, se queda');
    eq(P.hitoName('Curfew de camerinos (Hora exacta TBC)'), 'Curfew de camerinos');
    eq(P.hitoName('Curfew de sonido - aprox.'), 'Curfew de sonido');
    eq(P.hitoName('Fin de pruebas por confirmar'), 'Fin de pruebas');
    eq(P.hitoName('Fin de pruebas'), 'Fin de pruebas');
  });
  test('gantt: sin torres: 2 líneas de nombre + horario; un texto truncado siempre acaba en «…»', () => {
    const rows = [G('Llegada y descarga Omega Crew de artista + crew local + 4 hands', 690, 810, 'Principal', 'tarea'), G('Relleno', 600, 1300, 'Carpa', 'tarea')];
    const L = P.layoutGantt(rows, 273, 164), b = L.bars.find(x => x.zone === 'Principal');
    ok(b.lines.length <= 3, 'como mucho 3 líneas: ' + JSON.stringify(b.lines));
    ok(b.lines.some(l => /…$/.test(l)), 'truncado con «…»');
    eq(b.lines[b.lines.length - 1], '11:30–13:30', 'el horario, abajo');
    eq(P.wrapLines('Llegada y descarga Omega', '', 16, 3, 2).join('|'), 'Llegada…', 'si «…» no cabe en la 2.ª línea, se quita esa línea');
  });
  test('gantt: un bloque de 1 h con el nombre que cabe en 2 líneas lleva el texto dentro, no una llamada', () => {
    const rows = [G('Concierto Alhambra', 1230, 1290, 'Secundario', 'show'), G('A', 690, 1470, 'Principal', 'tarea')];   // 11:30–00:30, como el NDB: 1 h ≈ 18 mm
    const L = P.layoutGantt(rows, 273, 164), b = L.bars.find(x => x.zone === 'Secundario');
    ok(b.w < 20, 'es un bloque de menos de 20 mm (' + b.w.toFixed(1) + ')');
    eq(b.lines.slice(0, 2).join(' '), 'Concierto Alhambra');
    ok(!b.mark, 'sin llamada');
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

  test('i18n: sin lang, la hoja sale en el idioma activo de Showtime', () => {
    const I = isNode ? require('../i18n.js') : window.ShowtimeI18n;
    const rows = [G('Show A', 600, 660)];
    I.setLang('en');
    try {
      const en = P.html({ rows, days: [J1], title: 'T', orient: 'portrait', now: new Date(2026, 6, 10) });
      ok(en.indexOf('Printed: 10/07/2026') >= 0 && en.indexOf('Showtime Stage Management') >= 0, 'inglés activo → hoja en inglés');
      ok(P.html({ rows, days: [J1], title: 'T', now: new Date(2026, 6, 10), lang: 'es' }).indexOf('Impreso:') >= 0, 'lang explícito manda');
    } finally { I.setLang('es'); }
    ok(P.html({ rows, days: [J1], title: 'T', now: new Date(2026, 6, 10) }).indexOf('Showtime Regiduría') >= 0, 'español por defecto');
  });
  test('dayLabel y printedAt', () => {
    ok(P.dayLabel(J1).indexOf('2026') < 0, 'no añade año');
    eq(P.dayLabel('all'), 'Todo el evento');
    eq(P.printedAt(new Date(2026, 0, 5, 7, 3)), '05/01/2026');
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
