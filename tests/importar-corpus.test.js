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
  // ── Benchmark de 10 formatos (festivales FR/DE, running orders USA, WhatsApp, nombres trampa, sala con sesión de club, CSV
  //    internacional, bloques con escenario entre corchetes y noches que pasan las 06:00) ──────────────────────────────────
  const conNotas = r => linea(r) + ' | ' + r.notas;
  test('B1 · Parrilla multiescenario (una columna por escenario, huecos «—», pasada la medianoche)', () => {
    const { pv } = vista("HORA\tESCENARIO PRINCIPAL\tCARPA DANCE\tESCENARIO ACÚSTICO\n19:00 - 20:15\tVetusta Morla\tDJ Nano\tGuitarricadelafuente\n20:30 - 21:45\tThe Black Keys\tB Jones\tSilvia Pérez Cruz\n22:00 - 23:30\tArctic Monkeys\tWade\tDepedro\n23:45 - 01:15\tThe Prodigy\tPaco Osuna\t—\n01:30 - 03:00\t—\tAmelie Lens\t—", '2026-07-10');
    sinErrores(pv); eq(pv.rows.length, 12, '4 + 5 + 3 (los «—» son huecos, no bandas)');
    deq(pv.newStages, ['ESCENARIO PRINCIPAL', 'CARPA DANCE', 'ESCENARIO ACÚSTICO']);
    deq(pv.rows.filter(r => r.escenario === 'ESCENARIO ACÚSTICO').map(r => r.banda), ['Guitarricadelafuente', 'Silvia Pérez Cruz', 'Depedro']);
    const amelie = pv.rows.find(r => r.banda === 'Amelie Lens');
    deq([amelie.inicio, amelie.fin, amelie.jornada], ['01:30', '03:00', '2026-07-10'], 'la de las 01:30 sigue siendo de la jornada del 10');
    ok(pv.rows.every(r => r.tipo === 'show' && !r.warns.some(w => /misma celda/.test(w))), 'sin avisos de rango en la columna de horas');
  });
  test('B2 · Festival francés: portes, balances, déjeuner, concerts, tête d\'affiche, couvre-feu y zona en la cabecera', () => {
    const { pv } = vista("VENDREDI 19 JUIN 2026 - SCÈNE PRINCIPALE\n09:00 Ouverture des portes\n10:00 - 11:30 Balances / Soundcheck Gojira\n12:00 Déjeuner / Repas crew\n14:00 - 15:15 Concert Dagoba (75 min)\n16:00 - 17:30 Concert Mass Hysteria (90 min)\n18:30 - 20:00 Concert Gojira (90 min)\n21:00 - 23:00 Tête d'affiche: Iron Maiden (120 min)\n23:30 Couvre-feu son", '2026-06-19');
    sinErrores(pv);
    deq(pv.rows.map(conNotas), ['hito | Ouverture des portes | 09:00 | SCÈNE PRINCIPALE | ', 'sc | Gojira | 10:00-11:30 | SCÈNE PRINCIPALE | ', 'tarea | Déjeuner / Repas crew | 12:00 | SCÈNE PRINCIPALE | ',
      'show | Dagoba | 14:00-15:15 | SCÈNE PRINCIPALE | ', 'show | Mass Hysteria | 16:00-17:30 | SCÈNE PRINCIPALE | ', 'show | Gojira | 18:30-20:00 | SCÈNE PRINCIPALE | ',
      "show | Iron Maiden | 21:00-23:00 | SCÈNE PRINCIPALE | Tête d'affiche", 'hito | Couvre-feu son | 23:30 | SCÈNE PRINCIPALE | ']);
    ok(pv.rows.every(r => r.jornada === '2026-06-19'), '«VENDREDI 19 JUIN 2026»');
  });
  test('B3 · Festival alemán: Einlass, Mittagessen, Umbau, «Konzert:» y escenarios compuestos [Hauptbühne] / [Zeltbühne]', () => {
    const { pv } = vista("SAMSTAG, 15. AUGUST 2026\n10:00 Einlass\n11:00 - 12:00 Soundcheck Electric Callboy\n12:30 Mittagessen Crew\n14:00 - 15:00 Konzert: Blind Guardian [Hauptbühne]\n15:30 - 16:30 Umbau Bühne 1\n16:30 - 18:00 Konzert: Electric Callboy [Hauptbühne]\n18:30 - 20:00 Konzert: Kreator [Zeltbühne]\n22:00 Nachtruhe / Curfew", '2026-08-15');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['hito | Einlass | 10:00 | ', 'sc | Electric Callboy | 11:00-12:00 | ', 'tarea | Mittagessen Crew | 12:30 | ', 'show | Blind Guardian | 14:00-15:00 | Hauptbühne',
      'tarea | Umbau Bühne 1 | 15:30-16:30 | ', 'show | Electric Callboy | 16:30-18:00 | Hauptbühne', 'show | Kreator | 18:30-20:00 | Zeltbühne', 'hito | Nachtruhe / Curfew | 22:00 | ']);
    ok(pv.rows.every(r => r.jornada === '2026-08-15'), '«SAMSTAG, 15. AUGUST 2026»');
  });
  test('B4 · WhatsApp caótico: emojis, «h», puntos de relleno, «a» entre horas, duración «(45m)» y cierre', () => {
    const { pv, rd } = vista("🔥 HORARIOS CONFIRMADOS SÁBADO 18 DE JULIO 🔥\nOjo a los cambios de última hora 👇\n\n▶️ 18:00h ...... Apertura de Puertas\n▶️ 19:15h - 20:00h ...... Telonero Local (45m)\n▶️ 20:30h - 22:00h ...... Viva Suecia\n▶️ 22:30h - 00:00h ...... Arde Bogotá\n▶️ 00:30h a 02:00h ...... Elyella DJ Set\n⚠️ 02:30h ...... Cierre definitivo", '2026-07-18');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['hito | Apertura de Puertas | 18:00 | ', 'show | Telonero Local | 19:15-20:00 | ', 'show | Viva Suecia | 20:30-22:00 | ', 'show | Arde Bogotá | 22:30-00:00 | ',
      'show | Elyella DJ Set | 00:30-02:00 | ', 'hito | Cierre definitivo | 02:30 | ']);
    ok(pv.rows.every(r => r.jornada === '2026-07-18')); ok(rd.ignored.some(x => /Ojo a los cambios/.test(x.line)), 'la frase suelta no es una entrada');
  });
  test('B5 · Day sheet de gira en EE. UU.: AM/PM, vuelo, van, hotel, load-in, opener/headliner y bus call', () => {
    const { pv } = vista("MONDAY, OCTOBER 12TH 2026 – CHICAGO, IL\nVenue: The Metro\n08:30 AM Flight AA104 arrival at O'Hare\n09:30 AM Van pickup at terminal 3\n10:00 AM Hotel check-in (The Drake)\n12:30 PM Load-in & stage setup\n02:00 PM - 03:30 PM Soundcheck The National\n05:00 PM Dinner buyout\n06:30 PM Doors open\n07:30 PM - 08:15 PM Opener: Bartees Strange (45 mins)\n08:45 PM - 10:45 PM Headliner: The National (120 mins)\n11:30 PM Bus call / Load-out", '2026-10-12');
    sinErrores(pv);
    deq(pv.rows.map(conNotas), ["tarea | Flight AA104 arrival at O'Hare | 08:30 |  | ", 'tarea | Van pickup at terminal 3 | 09:30 |  | ', 'tarea | Hotel check-in | 10:00 |  | The Drake',
      'tarea | Load-in & stage setup | 12:30 |  | ', 'sc | The National | 14:00-15:30 |  | ', 'tarea | Dinner buyout | 17:00 |  | ', 'hito | Doors open | 18:30 |  | ',
      'show | Bartees Strange | 19:30-20:15 |  | Opener', 'show | The National | 20:45-22:45 |  | Headliner', 'hito | Bus call / Load-out | 23:30 |  | ']);
    ok(pv.rows.every(r => r.jornada === '2026-10-12'), '«MONDAY, OCTOBER 12TH 2026 – CHICAGO, IL»');
  });
  test('B6 · Nombres trampa: 091, Hotel Flamingo, 1975, !!!, Sunn O))), Catering (DJ Set) — todos shows en su escenario', () => {
    const { pv, rd } = vista("VIERNES 20 NOVIEMBRE\n18:00 Apertura\n18:30 - 19:15 091 (Escenario A)\n19:30 - 20:30 Hotel Flamingo (Escenario B)\n20:45 - 21:45 1975 (Escenario A)\n22:00 - 23:15 !!! (Chk Chk Chk) [Escenario A]\n23:30 - 00:45 Sunn O))) [Escenario B]\n01:00 - 02:30 Catering (DJ Set) [Carpa]", '2026-11-20');
    sinErrores(pv); eq(rd.production, false, 'un cartel, aunque salgan «Hotel» y «Catering»');
    deq(pv.rows.map(conNotas), ['hito | Apertura | 18:00 |  | ', 'show | 091 | 18:30-19:15 | Escenario A | ', 'show | Hotel Flamingo | 19:30-20:30 | Escenario B | ', 'show | 1975 | 20:45-21:45 | Escenario A | ',
      'show | !!! | 22:00-23:15 | Escenario A | Chk Chk Chk', 'show | Sunn O))) | 23:30-00:45 | Escenario B | ', 'show | Catering | 01:00-02:30 | Carpa | DJ Set']);
  });
  test('B7 · Sala de conciertos con doble sesión: pruebas, conciertos, desalojo y sesión de club hasta las 06:00', () => {
    const { pv } = vista("SÁBADO 24 OCTUBRE - SALA RIVIERA\n16:00 Acceso técnicos y montaje\n17:00 - 18:00 Prueba de sonido Grupo Invitado\n18:00 - 19:30 Prueba de sonido Los Enemigos\n20:00 Apertura de puertas\n20:45 - 21:30 Concierto: Grupo Invitado\n22:00 - 23:45 Concierto: Los Enemigos\n00:00 Desalojo concierto\n00:45 - 06:00 Sesión Clubbing: DJ Residentes", '2026-10-24');
    sinErrores(pv);
    deq(pv.rows.map(linea), ['tarea | Acceso técnicos y montaje | 16:00 | SALA RIVIERA', 'sc | Grupo Invitado | 17:00-18:00 | SALA RIVIERA', 'sc | Los Enemigos | 18:00-19:30 | SALA RIVIERA',
      'hito | Apertura de puertas | 20:00 | SALA RIVIERA', 'show | Grupo Invitado | 20:45-21:30 | SALA RIVIERA', 'show | Los Enemigos | 22:00-23:45 | SALA RIVIERA',
      'hito | Desalojo concierto | 00:00 | SALA RIVIERA', 'show | Sesión Clubbing: DJ Residentes | 00:45-06:00 | SALA RIVIERA']);
    ok(pv.rows.every(r => r.jornada === '2026-10-24'), 'la sesión de madrugada sigue siendo la noche del sábado 24');
  });
  test('B8 · CSV internacional (Master Tour / Eventival): columna Type, Personnel a notas y sitios de tareas fuera de las zonas', () => {
    const { pv, rd } = vista("Date,Start,End,Activity,Stage,Type,Personnel,Notes\n2026-08-14,09:00,10:30,Rigging & PA focus,Stage 1,Task,Audio Crew,Check left line array\n2026-08-14,11:00,12:30,Soundcheck Band A,Stage 1,Soundcheck,Band A + Sound Eng,Channel 1-32\n2026-08-14,13:00,14:30,Catering lunch,Backstage,Task,All Crew,VIP Area\n2026-08-14,18:00,18:00,Doors open,Recinto,Milestone,Security,Main gate\n2026-08-14,21:00,22:30,Band A,Stage 1,Show,Band A,Full production\n2026-08-14,23:00,00:30,Band B,Stage 1,Show,Band B,Pyro on track 5", '2026-08-14');
    sinErrores(pv);
    deq(rd.map, ['jornada', 'inicio', 'fin', 'banda', 'escenario', 'tipo', 'notas', 'notas']);
    deq(pv.rows.map(linea), ['tarea | Rigging & PA focus | 09:00-10:30 | Stage 1', 'sc | Band A | 11:00-12:30 | Stage 1', 'tarea | Catering lunch | 13:00-14:30 | ',
      'hito | Doors open | 18:00 | ', 'show | Band A | 21:00-22:30 | Stage 1', 'show | Band B | 23:00-00:30 | Stage 1']);
    deq(pv.newStages, ['Stage 1'], '«Backstage» y «Recinto» son sitios de tareas/hitos: a notas');
    eq(pv.rows[3].warns.length, 0, 'un hito con fin = inicio no avisa');
  });
  test('B9 · Bloques verticales con el escenario entre corchetes, notas y una hora DENTRO de una nota', () => {
    const { pv } = vista("DOMINGO 5 JULIO\n\n17:00H\nMontaje de backline\n[Escenario Ron Barceló]\nTécnicos de escenario + Backliners\n\n18:30H a 19:30H\nPrueba de sonido Second\n[Escenario Ron Barceló]\nSecond + FoH Eng\n\n20:00H\nApertura de puertas\nPúblico general\n\n21:00H (60')\nConcierto Shinova\n[Escenario Ron Barceló]\nCanales 1 al 28\n\n22:30H (90')\nConcierto Second\n[Escenario Ron Barceló]\nLanzar intro a las 22:29", '2026-07-05');
    sinErrores(pv); eq(pv.rows.length, 5, '«Lanzar intro a las 22:29» es una nota, no una entrada');
    deq(pv.rows.map(conNotas), ['tarea | Montaje de backline | 17:00 | Escenario Ron Barceló | Técnicos de escenario + Backliners', 'sc | Second | 18:30-19:30 | Escenario Ron Barceló | Second + FoH Eng',
      'hito | Apertura de puertas | 20:00 |  | Público general', 'show | Shinova | 21:00-22:00 | Escenario Ron Barceló | Canales 1 al 28', 'show | Second | 22:30-00:00 | Escenario Ron Barceló | Lanzar intro a las 22:29']);
  });
  test('B10 · Noche que pasa las 06:00: lo de las 07:00 es ya la jornada del domingo (con aviso)', () => {
    const { pv } = vista("NOCHE DEL SÁBADO 15 AL DOMINGO 16\n23:00 - 01:00 Warm Up: Resident DJ [Main Room]\n01:00 - 03:00 Richie Hawtin [Main Room]\n03:00 - 05:00 Carl Cox [Main Room]\n05:00 - 07:00 Jeff Mills [Main Room] (Cruza hora de corte 06:00)\n07:00 - 09:00 Afterparty: B2B Especial [Club Room]", '2026-08-15', '2026-08-16');
    sinErrores(pv);
    deq(pv.rows.map(r => conNotas(r) + ' | ' + r.jornada), ['show | Resident DJ | 23:00-01:00 | Main Room | Warm Up | 2026-08-15', 'show | Richie Hawtin | 01:00-03:00 | Main Room |  | 2026-08-15',
      'show | Carl Cox | 03:00-05:00 | Main Room |  | 2026-08-15', 'show | Jeff Mills | 05:00-07:00 | Main Room | Cruza hora de corte 06:00 | 2026-08-15',
      'show | B2B Especial | 07:00-09:00 | Club Room | Afterparty | 2026-08-16']);
    ok(pv.rows[4].warns.some(w => /La noche sigue pasadas las 06:00/.test(w)));
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
