/* Corpus de documentos variados para «Pegar horario» — que el importador no esté hecho a medida de uno o dos ejemplos.
 * Ordenador:  node tests/importar-corpus.test.js
 * Cada documento imita un formato real distinto (hoja de día inglesa, running order americano, cartel de WhatsApp, CSV de
 * una herramienta de producción, parrilla con una columna por escenario, hoja de ruta en bloques en inglés, tabla con
 * secciones por zona, cartel con puntos de relleno…). Lo que se comprueba es lo que vería el Stage Manager en la vista previa.
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const I = isNode ? require('../importar.js') : window.ShowtimeImport;
  const tests = [];
  const test = (n, f) => tests.push([n, f]);
  const fmt = v => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'esperaba ' + fmt(b) + ', salió ' + fmt(a)); };
  const deq = (a, b, m) => { if (fmt(a) !== fmt(b)) throw new Error((m ? m + ': ' : '') + '\n      esperaba ' + fmt(b) + '\n      salió    ' + fmt(a)); };
  const ok = (v, m) => { if (!v) throw new Error(m || 'esperaba verdadero'); };

  /** Evento vacío (sin zonas) de las fechas dadas; vista previa como en el Dashboard. */
  function vista(texto, desde, hasta, opts) {
    let s = C.newFestival({ nombre: 'Corpus', fechaInicio: desde, fechaFin: hasta || desde, dayCutoff: '06:00' }).state;
    ((opts && opts.zonas) || []).forEach(z => { s = C.addStage(s, z).state; });
    const ctx = Object.assign(I.contextOf(s), { today: desde });
    const rd = I.read(texto, ctx);
    const pv = I.preview(s, rd.records, Object.assign({ ctx, defaultJornada: (opts && opts.jor) || (desde === (hasta || desde) ? desde : '') }, opts || {}));
    return { rd, pv, s };
  }
  const linea = r => [r.tipo, r.banda, r.inicio + (r.fin ? '-' + r.fin : ''), r.escenario].join(' | ');
  const sinErrores = pv => eq(pv.counts.err, 0, 'errores: ' + pv.rows.filter(r => r.errs.length).map(r => (r.banda || r.raw) + ': ' + r.errs.join('; ')).join(' | '));

  test('Hoja de día inglesa (UK tour): load in, comidas, soundchecks, doors, sets con duración y curfew', () => {
    const t = 'DAY SHEET – FRIDAY 12 JUNE 2026\nVENUE: O2 Academy\n\n08:00 Load in\n12:00 Lunch\n14:00 - 15:00 Soundcheck HEADLINER\n15:15 - 15:45 Soundcheck SUPPORT\n' +
      '17:00 Dinner\n18:30 Doors\n19:30 - 20:00 SUPPORT (30 mins)\n20:30 - 22:00 HEADLINER\n22:30 Curfew\n23:00 Load out';
    const { pv } = vista(t, '2026-06-12');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['tarea | Load in | 08:00 | ', 'tarea | Lunch | 12:00 | ', 'sc | HEADLINER | 14:00-15:00 | ', 'sc | SUPPORT | 15:15-15:45 | ', 'tarea | Dinner | 17:00 | ',
      'hito | Doors | 18:30 | ', 'show | SUPPORT | 19:30-20:00 | ', 'show | HEADLINER | 20:30-22:00 | ', 'hito | Curfew | 22:30 | ', 'tarea | Load out | 23:00 | ']);
    ok(pv.rows.every(r => r.jornada === '2026-06-12'));
  });

  test('Running order americano: fecha con ordinal, AM/PM, «to», raya y «Doors:»', () => {
    const t = 'Saturday, September 5th\nDoors: 7:00 PM\nOpener — 7:30 PM to 8:00 PM\nMain act 8:30pm-10:00pm\nCurfew 11pm';
    const { pv } = vista(t, '2026-09-05');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['hito | Doors | 19:00 | ', 'show | Opener | 19:30-20:00 | ', 'show | Main act | 20:30-22:00 | ', 'hito | Curfew | 23:00 | ']);
    eq(pv.rows[0].jornada, '2026-09-05', '«Saturday, September 5th»');
  });

  test('Cartel de WhatsApp: emojis, cabecera de jornada con texto y «DJ Set:»', () => {
    const t = '🔥 CARTEL SÁBADO 11 DE JULIO 🔥\n▶️ 19:00 Apertura de puertas\n▶️ 20:00 Los Planetas\n▶️ 21:30 Vetusta Morla\n▶️ 23:15 DJ Set: Kiko Navarro';
    const { pv } = vista(t, '2026-07-10', '2026-07-12');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['hito | Apertura de puertas | 19:00 | ', 'show | Los Planetas | 20:00 | ', 'show | Vetusta Morla | 21:30 | ', 'show | DJ Set: Kiko Navarro | 23:15 | ']);
    ok(pv.rows.every(r => r.jornada === '2026-07-11'));
  });

  test('CSV de una herramienta de producción (Date, Start, End, Event, Location): los sitios de las tareas no son zonas', () => {
    const t = 'Date,Start,End,Event,Location,Notes\n2026-07-10,09:00,10:00,Crew breakfast,Hotel,\n2026-07-10,10:30,14:00,Load in + build,Main Stage,All crew\n' +
      '2026-07-10,16:00,16:45,Soundcheck – The Examples,Main Stage,\n2026-07-10,21:00,22:15,The Examples,Main Stage,';
    const { pv, rd } = vista(t, '2026-07-10');
    sinErrores(pv);
    deq(rd.map, ['jornada', 'inicio', 'fin', 'banda', 'escenario', 'notas']);
    deq(pv.rows.map(linea), ['tarea | Crew breakfast | 09:00-10:00 | ', 'tarea | Load in + build | 10:30-14:00 | Main Stage', 'sc | The Examples | 16:00-16:45 | Main Stage', 'show | The Examples | 21:00-22:15 | Main Stage']);
    deq(pv.newStages, ['Main Stage'], '«Hotel» no se crea como zona: es el sitio de una tarea');
    eq(pv.rows[0].notas, 'Hotel', 'el sitio queda en notas');
  });

  test('Parrilla con una columna por escenario (HORA · ESCENARIO 1 · ESCENARIO 2)', () => {
    const t = 'HORA\tESCENARIO 1\tESCENARIO 2\n20:00\tBanda A\tBanda B\n21:00\tBanda C\t\n22:00 - 23:30\tBanda D\tBanda E';
    const { pv } = vista(t, '2026-07-10');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['show | Banda A | 20:00 | ESCENARIO 1', 'show | Banda B | 20:00 | ESCENARIO 2', 'show | Banda C | 21:00 | ESCENARIO 1', 'show | Banda D | 22:00-23:30 | ESCENARIO 1', 'show | Banda E | 22:00-23:30 | ESCENARIO 2']);
    deq(pv.newStages, ['ESCENARIO 1', 'ESCENARIO 2']);
  });

  test('Hoja de ruta en bloques, en inglés (lobby call, drive, load in, notas de quién va)', () => {
    const t = 'MONDAY 14 SEPTEMBER\n10:00\nLobby call\nAll band & crew\n10:30 - 12:30\nDrive to venue\n13:00\nLoad in\nLocal crew x6\n20:00\nShow (75 min)\n';
    const { pv } = vista(t, '2026-09-14');
    sinErrores(pv);
    deq(pv.rows.map(r => linea(r) + ' | ' + r.notas), ['hito | Lobby call | 10:00 |  | All band & crew', 'tarea | Drive to venue | 10:30-12:30 |  | ', 'tarea | Load in | 13:00 |  | Local crew x6', 'show | Show | 20:00-21:15 |  | ']);
  });

  test('Tabla de dos columnas con secciones por zona («ESCENARIO PRINCIPAL», «CARPA»)', () => {
    const t = 'ESCENARIO PRINCIPAL\n20:00\tBanda A\n21:00\tBanda B\nCARPA\n20:30\tBanda C\nACTIVIDADES\n18:00\tTaller de percusión';
    const { pv } = vista(t, '2026-07-10');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['show | Banda A | 20:00 | ESCENARIO PRINCIPAL', 'show | Banda B | 21:00 | ESCENARIO PRINCIPAL', 'show | Banda C | 20:30 | CARPA', 'show | Taller de percusión | 18:00 | '], '«ACTIVIDADES» cierra la zona anterior (no es un escenario)');
  });

  test('Cartel con puntos de relleno y la hora al final («Los Planetas ........ 20:00h»)', () => {
    const t = 'VIERNES 10\nLos Planetas ........ 20:00h\nVetusta Morla ...... 21:30h\nDorian _____ 23:00';
    const { pv } = vista(t, '2026-07-10', '2026-07-11');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['show | Los Planetas | 20:00 | ', 'show | Vetusta Morla | 21:30 | ', 'show | Dorian | 23:00 | ']);
    eq(pv.rows[0].jornada, '2026-07-10');
  });

  test('Hoja de producción en una línea por entrada: lo desconocido es tarea, no show (rueda de prensa, meet & greet…)', () => {
    const t = '10:00 Rueda de prensa\n11:00 Meet & greet fans\n12:00 Entrevista Radio 3\n13:00 Comida\n17:00 Prueba de sonido Banda X\n21:00 Concierto Banda X';
    const { pv } = vista(t, '2026-07-10');
    deq(pv.rows.map(r => r.tipo), ['tarea', 'tarea', 'tarea', 'tarea', 'sc', 'show']);
  });

  test('Cartel solo de bandas, también con nombres que parecen tareas (Hotel Costes, Ave Fénix, The Press, Bus Stop): shows', () => {
    deq(vista('20:00 Banda Uno\n21:00 Banda Dos\n22:00 Banda Tres', '2026-07-10').pv.rows.map(r => r.tipo), ['show', 'show', 'show']);
    const { pv, rd } = vista('20:00 Hotel Costes\n21:00 Ave Fénix\n22:00 The Press\n23:00 Bus Stop\n00:30 Drive-By Truckers', '2026-07-10');
    eq(rd.production, false, 'es un cartel');
    deq(pv.rows.map(r => r.tipo), ['show', 'show', 'show', 'show', 'show']);
  });
  test('Day sheet: en una hoja de producción las palabras débiles sí son tareas (hotel, bus, prensa)', () => {
    const { pv, rd } = vista('09:00 Hotel checkout\n10:00 Bus to venue\n12:00 Load in\n13:00 Lunch\n15:00 Press\n18:00 Doors\n20:00 - 21:30 THE HEADLINERS', '2026-07-10');
    eq(rd.production, true);
    deq(pv.rows.map(r => r.tipo), ['tarea', 'tarea', 'tarea', 'tarea', 'tarea', 'hito', 'show'], 'y la banda sigue siendo show');
  });

  test('Tabla inglesa de festival (Artist · Day · Stage · Start · End) con AM/PM y changeovers', () => {
    const t = 'Artist\tDay\tStage\tStart\tEnd\nThe Examples\tFri 10 Jul\tMain\t9:00 PM\t10:15 PM\nChangeover\tFri 10 Jul\tMain\t10:15 PM\t10:45 PM\nOther Band\tSat 11 Jul\tTent\t8pm\t9pm';
    const { pv } = vista(t, '2026-07-10', '2026-07-11');
    sinErrores(pv);
    deq(pv.rows.map(r => linea(r) + ' | ' + r.jornada), ['show | The Examples | 21:00-22:15 | Main | 2026-07-10', 'tarea | Changeover | 22:15-22:45 | Main | 2026-07-10', 'show | Other Band | 20:00-21:00 | Tent | 2026-07-11']);
  });
  test('Texto de varias jornadas con cabeceras «DÍA 1 - VIERNES 10/07» y «Escenario: Carpa»', () => {
    const t = 'DÍA 1 - VIERNES 10/07\nEscenario: Principal\n21:00 – 22:15 Banda A\nEscenario: Carpa\n21:30 Banda B\nDÍA 2 - SÁBADO 11/07\n20:00 Banda C';
    const { pv } = vista(t, '2026-07-10', '2026-07-11');
    sinErrores(pv);
    deq(pv.rows.map(r => linea(r) + ' | ' + r.jornada), ['show | Banda A | 21:00-22:15 | Principal | 2026-07-10', 'show | Banda B | 21:30 | Carpa | 2026-07-10', 'show | Banda C | 20:00 | Carpa | 2026-07-11']);
  });
  test('Fechas y horas de todas partes', () => {
    const c = { year: 2026, days: [] };
    deq(['Saturday, September 5th', 'sábado 5 de septiembre de 2026', 'Sat 5 Sep', '5th September 2026', '2026-09-05', '05.09.2026', '5/9/2026'].map(x => (I.parseDate(x, c) || {}).iso),
      ['2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05']);
    eq(I.parseDate('09/25/2026', c).iso, '2026-09-25', 'mes/día americano si el «día» pasa de 12');
    const hm = x => (I.parseTime(x) || {}).hm || null;
    deq(['8:45 AM', '20h45', '20.45h', '20H45', '8.45pm', 'noon', 'midnight', 'mediodía', 'medianoche'].map(hm), ['08:45', '20:45', '20:45', '20:45', '20:45', '12:00', '00:00', '12:00', '00:00']);
    deq(['20:00 until 21:00', '20:00 till 21:00', '20:00 → 21:00', '20:00 ~ 21:00', '20:00 al 21:00'].map(x => { const r = I.parseRange(x); return r ? r.ini.hm + '-' + r.fin.hm : null; }), Array(5).fill('20:00-21:00'));
  });

  if (isNode) {
    let pass = 0; const fails = [];
    tests.forEach(([n, f]) => { try { f(); pass++; } catch (e) { fails.push([n, e.message]); } });
    fails.forEach(([n, m]) => console.log('  ✗ ' + n + '\n      ' + m));
    console.log('Importar (corpus): ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : ''));
    if (fails.length) process.exitCode = 1;
  }
})();
