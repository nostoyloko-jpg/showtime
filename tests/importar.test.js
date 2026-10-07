/* Tests de importar.js («Pegar horario»). Ordenador: node tests/importar.test.js · Navegador: tests/index.html */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const I = isNode ? require('../importar.js') : window.ShowtimeImport;
  const tests = [];
  const test = (n, f) => tests.push([n, f]);
  const fmt = v => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'esperaba ' + fmt(b) + ', salió ' + fmt(a)); };
  const deq = (a, b, m) => { if (fmt(a) !== fmt(b)) throw new Error((m ? m + ': ' : '') + 'esperaba ' + fmt(b) + ', salió ' + fmt(a)); };
  const ok = (v, m) => { if (!v) throw new Error(m || 'esperaba verdadero'); };
  const hm = t => (I.parseTime(t) || {}).hm || null;

  function evento() {
    let s = C.newFestival({ nombre: 'Prueba', fechaInicio: '2026-07-10', fechaFin: '2026-07-11' }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    return s;
  }
  const S = evento(), CTX = I.contextOf(S);
  const resumen = recs => recs.map(r => [r.banda, r.escenario, r.jornada, r.inicio, r.fin].join('/'));

  test('horas: todos los formatos de la especificación', () => {
    eq(hm('21:00'), '21:00'); eq(hm('21.00'), '21:00'); eq(hm('21h'), '21:00'); eq(hm('21h30'), '21:30');
    eq(hm('2100'), '21:00'); eq(hm('930'), '09:30'); eq(hm('21:00:00'), '21:00');
    eq(hm('9:00 PM'), '21:00'); eq(hm('9pm'), '21:00'); eq(hm('12:30 am'), '00:30'); eq(hm('12 pm'), '12:00');
  });
  test('horas: 24–29 se leen como madrugada (con aviso); basura y números sueltos no', () => {
    deq(I.parseTime('25:30'), { hm: '01:30', warn: '25:30 se lee como 01:30 (madrugada)' });
    eq(hm('12:60'), null); eq(hm('abc'), null); eq(hm('182'), null); eq(hm('31:00'), null); eq(hm(''), null);
  });
  test('rangos en una celda', () => {
    deq([I.parseRange('21:00-22:15').ini.hm, I.parseRange('21:00 – 22:15').fin.hm, I.parseRange('21h a 22h').fin.hm], ['21:00', '22:15', '22:00']);
    eq(I.parseRange('21:00'), null);
  });
  test('fechas: formatos de la especificación', () => {
    eq(I.parseDate('10/07', CTX).iso, '2026-07-10'); eq(I.parseDate('10-07-2026', CTX).iso, '2026-07-10');
    eq(I.parseDate('10-jul', CTX).iso, '2026-07-10'); eq(I.parseDate('10 jul', CTX).iso, '2026-07-10');
    eq(I.parseDate('vie 10', CTX).iso, '2026-07-10'); eq(I.parseDate('Viernes 10 de julio', CTX).iso, '2026-07-10');
    eq(I.parseDate('2026-07-11', CTX).iso, '2026-07-11'); eq(I.parseDate('11/7/26', CTX).iso, '2026-07-11');
  });
  test('fechas: día de la semana suelto solo si el evento tiene uno (con aviso); basura no', () => {
    eq(I.parseDate('sábado', CTX).iso, '2026-07-11'); ok(I.parseDate('sábado', CTX).warn);
    eq(I.parseDate('lunes', CTX), null); eq(I.parseDate('hola', CTX), null); eq(I.parseDate('31/02', CTX), null);
  });
  test('detecta tabla (tabulador, punto y coma, coma con comillas) o texto libre', () => {
    eq(I.detect('a\tb\nc\td').kind, 'tabla'); eq(I.detect('a\tb\nc\td').sep, '\t');
    eq(I.detect('a;b\nc;d').sep, ';');
    eq(I.detect('"Banda, la"," 21:00"\nOtra,22:00').sep, ',');
    eq(I.detect('21:00 Banda\n22:00 Otra').kind, 'texto'); eq(I.detect('  \n ').kind, 'vacio');
    deq(I.splitRow('"Banda, la",21:00,"Nota ""x"""', ','), ['Banda, la', '21:00', 'Nota "x"']);
  });
  test('tabla con cabecera: mapeo propuesto por nombres comunes (español e inglés, sin acentos)', () => {
    deq(I.guessHeader(['Artista', 'Escenario', 'Día', 'Inicio', 'Fin', 'Notas']), ['banda', 'escenario', 'jornada', 'inicio', 'fin', 'notas']);
    deq(I.guessHeader(['Artist', 'Stage', 'Date', 'Start', 'End', 'Comments']), ['banda', 'escenario', 'jornada', 'inicio', 'fin', 'notas']);
    deq(I.guessHeader(['Band', 'Hora inicio', 'Duración', 'Otra cosa']), ['banda', 'inicio', 'duracion', 'ignorar']);
    eq(I.guessHeader(['Los Ejemplos', 'Principal', '21:00', '22:15']), null, 'fila de datos');
  });
  test('tabla sin cabecera: mapeo propuesto por el contenido', () => {
    const rows = [['21:00', '22:15', 'Los Ejemplos', 'Principal'], ['21:30', '22:30', 'Banda Demo', 'Carpa']];
    deq(I.guessColumns(rows, CTX), ['inicio', 'fin', 'banda', 'escenario']);
    deq(I.guessColumns([['Los Ejemplos', '21:00-22:15', '75']], CTX).slice(0, 3), ['banda', 'inicio', 'duracion']);
  });
  test('lectura completa de un TSV pegado desde Excel', () => {
    const tsv = 'Artista\tEscenario\tDía\tInicio\tFin\nLos Ejemplos\tPrincipal\t10/07\t21:00\t22:15\nDJ Cierre\tClub\tvie 10\t02:00\t04:00';
    const r = I.read(tsv, CTX);
    eq(r.kind, 'tabla'); ok(r.hasHeader);
    deq(resumen(r.records), ['Los Ejemplos/Principal/2026-07-10/21:00/22:15', 'DJ Cierre/Club/2026-07-10/02:00/04:00']);
  });
  test('rango en la celda de inicio se separa (con aviso); horas no reconocidas dan error', () => {
    const r = I.read('Banda\tHora\nA\t21:00-22:15\nB\tmañana', CTX);
    eq(r.records[0].inicio, '21:00'); eq(r.records[0].fin, '22:15'); ok(r.records[0].warns.length);
    ok(r.records[1].errs[0].indexOf('no reconocida') > 0);
  });
  test('texto libre: cabeceras de día y escenario, rangos, paréntesis y escenario en la línea', () => {
    const txt = 'VIERNES 10 JULIO\nPRINCIPAL\n21:00-22:15 Los Ejemplos\n23:30 – 01:15 Cabeza de Cartel (Carpa)\nBlink 182 22:00\n\nSábado 11\n20:00 Banda Sábado Principal\nhola que tal';
    const r = I.read(txt, CTX);
    eq(r.kind, 'texto');
    deq(resumen(r.records), ['Los Ejemplos/Principal/2026-07-10/21:00/22:15', 'Cabeza de Cartel/Carpa/2026-07-10/23:30/01:15',
      'Blink 182/Principal/2026-07-10/22:00/', 'Banda Sábado/Principal/2026-07-11/20:00/']);
    deq(r.ignored, [{ n: 9, line: 'hola que tal' }]);
  });
  test('texto libre estilo WhatsApp', () => {
    const r = I.read('*Sáb 11*\n• 18h Apertura de puertas – Principal\n• 19:30 Grupo Local [Carpa]\n• 9pm Cabeza', CTX);
    deq(resumen(r.records), ['Apertura de puertas/Principal/2026-07-11/18:00/', 'Grupo Local/Carpa/2026-07-11/19:30/', 'Cabeza//2026-07-11/21:00/']);
  });
  test('vista previa: verde, ámbar (calculado, nuevo, madrugada) y rojo (faltan datos)', () => {
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\tFin\tDur\nA\tPrincipal\t10/07\t20:00\t21:00\t\nB\tClub\t10/07\t21:00\t\t45\nC\tCarpa\t10/07\t23:30\t01:00\t\n\tCarpa\t10/07\t20:00\t\t\nE\tCarpa\t\t\t\t', CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX });
    deq(pv.rows.map(r => r.status), ['ok', 'warn', 'warn', 'err', 'err']);
    eq(pv.rows[1].fin, '21:45'); deq(pv.newStages, ['Club']);
    ok(pv.rows[2].warns.some(w => /medianoche/.test(w)));
    deq(pv.counts, { total: 5, ok: 1, warn: 2, err: 2, importar: 3 });
  });
  test('vista previa: jornada por defecto, escenario por defecto y fuera del evento', () => {
    const recs = I.read('21:00 Uno\n22:00 Dos', CTX).records;
    eq(I.preview(S, recs, { mode: 'show', ctx: CTX }).rows[0].status, 'err', 'sin jornada ni escenario');
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX, defaultJornada: '2026-07-12', defaultStageId: 'esc1' });
    deq(pv.rows.map(r => r.status), ['warn', 'warn']); deq(pv.outside, ['2026-07-12']);
  });
  test('vista previa: igual en la misma jornada → aviso «Revisar» y sigue marcada; misma banda otro día → nueva sin aviso', () => {
    let s = C.addArtist(S, 'show', { nombre: 'Los Ejemplos', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\nlos ejemplos\tPrincipal\t10/07\t21:00\nLos Ejemplos\tPrincipal\t11/07\t21:00', CTX).records;
    const pv = I.preview(s, recs, { mode: 'show', ctx: CTX });
    eq(pv.rows[0].action, 'duplicada'); eq(pv.rows[0].include, true); eq(pv.rows[0].status, 'warn');
    eq(pv.rows[1].action, 'nueva'); eq(pv.rows[1].include, true);
  });
  test('soundcheck de una banda que ya tiene show → entrada NUEVA e independiente (cero fusiones)', () => {
    let s = C.addArtist(S, 'show', { nombre: 'Los Ejemplos', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\tFin\tCALL\nLos Ejemplos\tPrincipal\t10/07\t16:00\t16:45\t15:30', CTX).records;
    const pv = I.preview(s, recs, { mode: 'sc', ctx: CTX });
    eq(pv.rows[0].action, 'nueva'); eq(pv.rows[0].include, true);
    const ap = I.apply(s, pv, { mode: 'sc' });
    eq(ap.updated, 0); eq(ap.added, 1); eq(ap.state.artists.length, 2);
    const a = ap.state.artists[1];
    eq(a.soundcheckInicio, '16:00'); eq(a.soundcheckCall, '15:30'); eq(a.inicio, undefined, 'la nueva solo tiene soundcheck');
    eq(ap.state.artists[0].soundcheckInicio, undefined, 'la existente no se toca');
  });
  test('vista previa: solape con una banda existente del mismo escenario y jornada', () => {
    let s = C.addArtist(S, 'show', { nombre: 'Ya', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const pv = I.preview(s, I.read('21:30-22:30 Nueva Principal', CTX).records, { mode: 'show', ctx: CTX, defaultJornada: '2026-07-10' });
    ok(pv.rows[0].warns.some(w => /solapa con Ya/.test(w)));
  });
  test('ediciones en la vista previa se reinterpretan', () => {
    const recs = I.read('21:00 Uno Principal', CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX, defaultJornada: '2026-07-10', edits: { 0: { inicio: '2130', fin: '2230', banda: 'Uno bis' } } });
    eq(pv.rows[0].inicio, '21:30'); eq(pv.rows[0].fin, '22:30'); eq(pv.rows[0].banda, 'Uno bis');
  });
  test('aplicar: crea escenarios marcados, amplía el evento si se confirma y respeta la hora de corte', () => {
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\tFin\nA\tClub\t12/07\t02:00\t04:00\nB\tPrincipal\t10/07\t21:00\t22:00', CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX });
    const ap = I.apply(S, pv, { mode: 'show', extendEvent: true });
    eq(ap.added, 2); eq(ap.stagesCreated, 1); eq(ap.state.event.fechaFin, '2026-07-12');
    const a = ap.state.artists.find(x => x.nombre === 'A');
    eq(a.fecha, '2026-07-13'); eq(C.festivalDateOf(ap.state, a, false), '2026-07-12');
    eq(S.artists.length, 0, 'el original no se toca');
  });
  test('aplicar: sin crear el escenario nuevo → esas filas pasan a error y no entran', () => {
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\nA\tClub\t10/07\t21:00', CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX, createStages: { club: false } });
    eq(pv.rows[0].status, 'err'); eq(I.apply(S, pv, { mode: 'show', createStages: { club: false } }).added, 0);
  });

  test('entrada igual ya existente (mismo nombre, tipo y jornada): solo aviso «Revisar»; casilla marcada como las demás; no toma nada de la otra', () => {
    const s2 = C.addArtist(S, 'show', { nombre: 'Uno', escenarioId: S.escenarios[1].id, jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('VIERNES 10 JULIO\n21:00-22:00 Uno', I.contextOf(s2)).records;
    const pv = I.preview(s2, recs, { mode: 'show', ctx: I.contextOf(s2), defaultStageId: S.escenarios[0].id });
    eq(pv.rows[0].action, 'duplicada'); eq(pv.rows[0].escenario, 'Principal', 'escenario por defecto, no el de la otra'); eq(pv.rows[0].include, true); eq(pv.rows[0].status, 'warn');
  });

  test('separar palabras pegadas de PDF, con excepciones', () => {
    deq(I.splitGlued('19:00 LlegaOmega').text, '19:00 Llega Omega');
    eq(I.splitGlued('LlegaOmega').changes.length, 1);
    eq(I.splitGlued('Paul McCartney y MacDonald').text, 'Paul McCartney y MacDonald');
    eq(I.splitGlued('iPhone eBay DJ PA').text, 'iPhone eBay DJ PA');
    eq(I.splitGlued('ComidaTécnicosEscenario').text, 'Comida Técnicos Escenario');
    const t = I.read('VIERNES 10 JULIO\n15:00 LlegaOmega', CTX).records[0];
    eq(t.banda, 'Llega Omega'); ok(t.warns.some(w => /Palabras separadas/.test(w)), 'se avisa');
  });
  test('tipo propuesto: palabras clave, prefijo de prueba y columna Tipo', () => {
    const p = (b, x) => I.proposeTipo(Object.assign({ banda: b }, x || {}), 'show');
    eq(p('Apertura de puertas').tipo, 'hito'); eq(p('Curfew').tipo, 'hito'); eq(p('Llega Omega').tipo, 'hito');
    eq(p('Comida técnicos').tipo, 'tarea'); eq(p('Desmontaje').tipo, 'tarea'); eq(p('Prueba de luces').tipo, 'tarea');
    const sc = p('Prueba de sonido: Omega'); eq(sc.tipo, 'sc'); eq(sc.banda.trim(), 'Omega');
    eq(p('Omega (soundcheck)').tipo, 'sc'); eq(p('Omega (soundcheck)').banda.trim(), 'Omega');
    eq(p('Los Ejemplos').tipo, 'show'); eq(I.proposeTipo({ banda: 'Los Ejemplos' }, 'sc').tipo, 'sc');
    eq(p('Algo', { tipoTxt: 'Hito' }).tipo, 'hito'); eq(p('Algo', { tipoTxt: 'Prueba' }).tipo, 'sc');
  });
  test('hoja de ruta: tareas e hitos sin escenario ni solapes, bandas por tipo', () => {
    const txt = 'VIERNES 10 JULIO\n10:00-14:00 Montaje Principal\n14:00-15:00 Comida técnicos\n16:00-16:45 Prueba Uno (Principal)\n19:30 Apertura de puertas\n21:00-22:00 Uno (Principal)\n21:30-22:30 Dos (Principal)\n23:30 Curfew';
    const recs = I.read(txt, CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX });
    deq(pv.rows.map(r => r.tipo), ['tarea', 'tarea', 'sc', 'hito', 'show', 'show', 'hito']);
    eq(pv.rows[0].escenario, 'Principal', 'la tarea puede llevar escenario');
    eq(pv.rows[1].status, 'ok', 'tarea sin escenario: sin error');
    eq(pv.rows[3].fin, ''); eq(pv.rows[3].status, 'ok', 'hito sin fin ni escenario: OK');
    eq(pv.rows[2].banda, 'Uno'); ok(!pv.rows[2].warns.some(w => /solapa/i.test(w)), 'el soundcheck no solapa con el montaje');
    ok(!pv.rows[0].warns.some(w => /solapa/i.test(w)), 'la tarea no da solapes');
    ok(pv.rows[5].warns.some(w => /solapa con Uno/i.test(w)), 'las bandas sí');
    const ap = I.apply(S, pv, {});
    eq(pv.rows[4].action, 'nueva'); eq(ap.added, 7, 'cada línea, una entrada: la prueba y el show de Uno van por separado'); eq(ap.updated, 0);
    const st = ap.state;
    eq(st.artists.filter(a => a.showtimeTipo === 'hito').length, 2); eq(st.artists.filter(a => a.showtimeTipo === 'tarea').length, 2);
    const unos = st.artists.filter(a => a.nombre === 'Uno'); eq(unos.length, 2);
    ok(unos.some(a => a.soundcheckInicio === '16:00' && !a.inicio) && unos.some(a => a.inicio === '21:00' && !a.soundcheckInicio));
    eq(C.buildBlocks(st, { mode: 'all', day: '2026-07-10' }).length, 7);
  });
  test('tipo cambiado a mano en la vista previa', () => {
    const recs = I.read('VIERNES 10 JULIO\n16:00-16:45 Prueba Uno (Principal)', CTX).records;
    const pv = I.preview(S, recs, { mode: 'show', ctx: CTX, edits: { 0: { tipo: 'tarea' } } });
    eq(pv.rows[0].tipo, 'tarea'); eq(pv.rows[0].banda, 'Prueba Uno', 'con otro tipo, el nombre no se recorta');
  });

  test('cabecera de hoja de ruta con fecha y más texto', () => {
    const r = I.read('HOJA DE RUTA · VIERNES 10 JULIO\n21:00 Uno (Principal)\nContacto producción: 600 000 000', CTX);
    eq(r.records.length, 1); eq(r.records[0].jornada, '2026-07-10'); eq(r.ignored.length, 1);
  });

  test('hoja de ruta en PDF: columnas de notas, paréntesis, avisos *** y palabras de tarea/hito', () => {
    const txt = 'VIERNES 10 JULIO\n11:30                Llegada y descarga Omega                     Crew de artista + 4 hands\n' +
      '13:00 - 14:00        Linecheck monitores Uno\n14:30 - 15:30        Parada para comer técnicos locales (por turnos)\n' +
      '18:45 - 19:30        Prueba de sonido Omega (con Kiki y Antonio)\n19:30                Fin de pruebas\n' +
      '                *** Restricciones de PA hasta las 14:00 y entre las 16:00 y las 18:00 ***\n' +
      '21:45 - 23:30        CONCIERTO OMEGA 30.º ANIVERSARIO                     1 set * 105 min';
    const r = I.read(txt, CTX);
    const pv = I.preview(S, r.records, { mode: 'show', ctx: CTX, defaultStageId: S.escenarios[0].id });
    deq(pv.rows.map(x => x.tipo), ['tarea', 'tarea', 'tarea', 'sc', 'hito', 'show']);
    eq(pv.rows[0].banda, 'Llegada y descarga Omega'); eq(pv.rows[0].notas, 'Crew de artista + 4 hands');
    eq(pv.rows[2].notas, 'por turnos'); eq(pv.rows[2].escenario, S.escenarios[0].nombre, 'un paréntesis cualquiera no es un escenario: va la «Zona por defecto»');
    eq(pv.rows[3].banda, 'Omega'); eq(pv.rows[3].notas, 'con Kiki y Antonio');
    eq(pv.rows[5].banda, 'OMEGA 30.º ANIVERSARIO'); eq(pv.rows[5].notas, '1 set * 105 min');
    ok(r.ignored.some(l => /Restricciones/.test(l.line)), 'el aviso *** se ignora (y se lista)');
  });

  // ── Tablas reales de festival (ES / EN): celdas combinadas, turnos de regiduría, horas de prueba y de concierto ──
  // Copiado tal cual de Excel (Ctrl+C) — hoja «GIGANTE» de un festival: una cabecera por jornada, celdas combinadas
  // (la jornada y el turno solo en la primera fila), turnos del Stage Manager, pruebas por la mañana y conciertos por la noche.
  const GIGANTE = "GIGANTE\tHORARIO STAGE MANAGER\tARTISTA\tCITACION \tENTRADA ESCENARIO ARTISTAS\tSALIDA ESCENARIO ARTISTA\tCITACION TECNICOS CAMBIO ESCENARIO\tCONCIERTO\tDuracion\nJueves 27\t\"14:45 - 01:00\n(10:45 h.)\"\tLA CABRA MECANICA \t15:00 h.\t15:15 h.\t17:00 h.\t\t\t1:45 h.\n\t\tANGELA GONZALEZ \t16:15 h.\t16:30: h.\t18:30 h.\t\t\t2:00 h.\n\t\t\t\t\t\t\t\t\n\t\tANGELA GONZALEZ \t\t\t\t20:35 h.\t21:05 - 22:15\t1:10 h.\n\t\tLA CABRA MECANICA \t\t\t\t21:45 h.\t23.45 - 00:45\t1:10 h.\n\t\t\t\t\t\t\t\t\nGIGANTE\tHORARIO STAGE MANAGER\tARTISTA\tCITACION \tENTRADA ESCENARIO ARTISTAS\tSALIDA ESCENARIO ARTISTA\tCITACION TECNICOS CAMBIO ESCENARIO\tCONCIERTO\tDuracion\nViernes 28\t\"MAÑANA: 09:45 - 18:52\n(09:07 h.)\"\tAIKO\t10:00 h.\t10:00 h.\t11:15 h.\t\t\t1:15 h.\n\t\tLA MODA\t10:45 h.\t11:00 h.\t14:15 h.\t\t\t3:15 h.\n\t\tCOMIDA 14:30 - 15:50 (REVISAR)                        \t\t\t\t\t\t1:20 h.\n\t\tORTIGA\t16:00 h\t16:00 h.\t17:15 h.\t\t\t1:15 h.\n\tSTAGE TARDE\t\t\t\t\t\t\t\n\t\"TARDE: 18:22 - 03:30\n(09:07 h.)\"\tAIKO\t\t\t\t17:15 h.\t20:20 - 21:35 \t1:15 h.\n\t\tLA MODA\t\t\t\t21:05 h.\t23:00 - 00:30 \t1:30 h.\n\t\tORTIGA\t\t\t\t00:00 h.\t01:50 - 03:00\t1:10 h.\n\t\t\t\t\t\t\t\t\nGIGANTE\tHORARIO STAGE MANAGER\tARTISTA\tCITACION \tENTRADA ESCENARIO ARTISTAS\tSALIDA ESCENARIO ARTISTA\tCITACION TECNICOS CAMBIO ESCENARIO\tCONCIERTO\tDuracion\nSabado 29\t\"MAÑANA: 10:45 - 19:22\n(08:37 h.)\"\tCHIMO BAYO\t11:00 h.\t11:00 h.\t11:45 h.\t\t\t0:45 h.\n\t\tGINEBRAS\t11:45 h.\t11:45 h.\t13:45 h.\t\t\t2:00 h.\n\t\tCOMIDA 14:00 - 14:50 (REVISAR)                        \t\t\t\t\t\t0:50 h.\n\t\tQUERALT LAHOZ\t15:00 h.\t15:00 h.\t17:30 h.\t\t\t2:30 h.\n\tSTAGE TARDE\t\t\t\t\t\t\t\n\t\"TARDE: 18:55 - 03:30\n(08:37 h.)\"\tQUERALT LAHOZ\t\t\t\t19:50 h.\t20:20 - 21:35\t1:15 h.\n\t\tGINEBRAS\t\t\t\t21:05 h.\t23:00 - 00:15\t1:15 h.\n\t\tCHIMO BAYO\t\t\t\t23:45 h.\t01:35 - 03:00\t1:25 h.\n\t\t\t\t\t\t\t\t";
  const TARDE = r => r.inicio >= '19:00' || r.inicio < '06:00';
  function eventoGigante(conZona) {
    let s = C.newFestival({ nombre: 'Gigante', fechaInicio: '2026-08-27', fechaFin: '2026-08-29', dayCutoff: '06:00' }).state;
    if (conZona) s = C.addStage(s, 'GIGANTE').state;
    return s;
  }
  test('Festival real (hoja «GIGANTE» pegada de Excel): 3 jornadas, pruebas, comidas y conciertos con 0 errores', () => {
    const s = eventoGigante(true), ctx = I.contextOf(s), rd = I.read(GIGANTE, ctx), pv = I.preview(s, rd.records, { ctx });
    eq(rd.kind, 'tabla');
    deq(rd.map, ['jornada', 'ignorar', 'banda', 'call', 'pinicio', 'pfin', 'call', 'concierto', 'duracion'], 'columnas: HORARIO STAGE MANAGER se ignora; CITACION = CALL; entrada/salida a escenario = prueba; CONCIERTO = show');
    eq(rd.zone, 'GIGANTE', 'la zona es el título de la primera columna');
    eq(pv.counts.err, 0, 'cero errores: ' + pv.rows.filter(r => r.errs.length).map(r => r.banda + ': ' + r.errs.join('; ')).join(' | '));
    eq(pv.counts.importar, 18, '7 + 7 entradas de jueves… 4 + 7 + 7');
    const dia = d => pv.rows.filter(r => r.jornada === d);
    deq([dia('2026-08-27').length, dia('2026-08-28').length, dia('2026-08-29').length], [4, 7, 7], 'jueves 27 · viernes 28 · sábado 29 (relleno hacia abajo de la celda combinada)');
    ok(pv.rows.every(r => r.escenario === 'GIGANTE' && r.stageId), 'todas en la zona GIGANTE (la existente)');
    const sc = pv.rows.filter(r => r.tipo === 'sc'), show = pv.rows.filter(r => r.tipo === 'show'), tarea = pv.rows.filter(r => r.tipo === 'tarea');
    deq([sc.length, show.length, tarea.length], [8, 8, 2], 'pruebas · conciertos · comidas');
    ok(sc.every(r => !TARDE(r)) && show.every(TARDE), 'las pruebas por la mañana y los conciertos por la noche');
    const fila = (n, t, d) => pv.rows.find(r => r.banda === n && r.tipo === t && (!d || r.jornada === d));
    deq(['inicio', 'fin', 'call'].map(k => fila('LA CABRA MECANICA', 'sc')[k]), ['15:15', '17:00', '15:00'], 'prueba: entrada/salida a escenario y citación («15:15 h.»)');
    eq(fila('ANGELA GONZALEZ', 'sc').inicio, '16:30', '«16:30: h.» con el «:» de más');
    deq(['inicio', 'fin', 'call'].map(k => fila('ANGELA GONZALEZ', 'show')[k]), ['21:05', '22:15', '20:35'], 'concierto: rango entero en una celda y CALL de técnicos');
    deq(['inicio', 'fin'].map(k => fila('LA CABRA MECANICA', 'show')[k]), ['23:45', '00:45'], '«23.45 - 00:45» con punto');
    ok(fila('LA CABRA MECANICA', 'show').warns.some(w => /duración/.test(w)), 'la duración (1:10) no cuadra con el rango: aviso, mandan las horas');
    const comida = fila('COMIDA', 'tarea', '2026-08-28');
    deq([comida.inicio, comida.fin, comida.notas], ['14:30', '15:50', 'REVISAR'], '«COMIDA 14:30 - 15:50 (REVISAR)» = tarea con su horario');
    eq(fila('ORTIGA', 'show').jornada, '2026-08-28', '01:50 del viernes sigue en la jornada del viernes');
    ok(rd.ignored.some(x => /STAGE TARDE/.test(x.line)) && rd.ignored.filter(x => x.why === 'cabecera repetida').length === 2, 'subtítulos y cabeceras repetidas fuera, sin errores');
    const a = I.apply(s, pv, {});
    eq(a.added, 18); eq(a.errors.length, 0, a.errors.join(' | '));
  });
  test('Festival real sin evento abierto: el evento provisional sale del jueves 27 al sábado 29 y crea la zona GIGANTE', () => {
    const now = C.nowAbs(new Date(2026, 9, 7, 12, 0));                    // 7 de octubre de 2026: el jueves 27 más cercano es el de agosto
    const s = I.provisionalState(GIGANTE, now);
    deq([s.event.fechaInicio, s.event.fechaFin], ['2026-08-27', '2026-08-29']);
    const ctx = I.contextOf(s), rd = I.read(GIGANTE, ctx), pv = I.preview(s, rd.records, { ctx });
    eq(pv.counts.err, 0); eq(pv.counts.importar, 18); deq(pv.newStages, ['GIGANTE']);
    const a = I.apply(s, pv, {});
    eq(a.added, 18); eq(a.stagesCreated, 1);
  });
  test('Cabeceras en inglés: MAIN STAGE · STAGE MANAGER SHIFT · STAGE IN/OUT · SHOW (PM) · CREW CALL · LUNCH', () => {
    const t = 'MAIN STAGE\tSTAGE MANAGER SHIFT\tARTIST\tBAND CALL\tSTAGE IN\tSTAGE OUT\tCREW CALL\tSHOW\tDuration\n' +
      'Friday 28\t09:00 - 18:00\tTHE EXAMPLES\t10:00\t10:15\t11:00\t\t\t0:45\n' +
      '\t\tLUNCH / CATERING 14:00 - 15:00\t\t\t\t\t\t\n' +
      '\t\tTHE EXAMPLES\t\t\t\t20:30\t9:00 PM - 10:30 PM\t1:30 h\n' +
      '\tCREW HOURS\t\t\t\t\t\t\t\n';
    const s = eventoGigante(false), ctx = I.contextOf(s), rd = I.read(t, ctx), pv = I.preview(s, rd.records, { ctx });
    deq(rd.map, ['jornada', 'ignorar', 'banda', 'call', 'pinicio', 'pfin', 'call', 'concierto', 'duracion']);
    eq(rd.zone, 'MAIN STAGE');
    eq(pv.counts.err, 0, pv.rows.map(r => r.errs.join(';')).join(' | ')); eq(pv.rows.length, 3);
    deq(pv.rows.map(r => [r.tipo, r.banda, r.jornada, r.inicio, r.fin, r.call].join('/')),
      ['sc/THE EXAMPLES/2026-08-28/10:15/11:00/10:00', 'tarea/LUNCH / CATERING/2026-08-28/14:00/15:00/', 'show/THE EXAMPLES/2026-08-28/21:00/22:30/20:30']);
  });
  test('Prueba y concierto en la MISMA fila: dos entradas, cada CALL con la suya', () => {
    const t = 'Día\tBanda\tCitación\tEntrada escenario\tSalida escenario\tCitación técnicos\tConcierto\n27/08/2026\tUno\t15:00\t15:15\t16:00\t20:30\t21:00-22:00';
    const s = eventoGigante(true), ctx = I.contextOf(s), rd = I.read(t, ctx);
    deq(rd.records.map(r => [r.tipoCol, r.inicio, r.fin, r.call].join('/')), ['sc/15:15/16:00/15:00', 'show/21:00/22:00/20:30']);
  });
  test('Relleno hacia abajo de Jornada y Zona (celdas combinadas) y cambio de zona por fila de título', () => {
    const t = 'Zona\tDía\tBanda\tInicio\nPrincipal\t27/08/2026\tA\t20:00\n\t\tB\t21:00\n\t28/08/2026\tC\t20:00\nCarpa\t\tD\t22:00';
    const rd = I.read(t, I.contextOf(eventoGigante(false)));
    deq(rd.records.map(r => [r.banda, r.escenario, r.jornada].join('/')), ['A/Principal/2026-08-27', 'B/Principal/2026-08-27', 'C/Principal/2026-08-28', 'D/Carpa/2026-08-28']);
    const t2 = 'GIGANTE\tBanda\tInicio\nJueves 27\tA\t20:00\nVIBRAMAHOU\t\t\nJueves 27\tB\t21:00';
    const rd2 = I.read(t2, I.contextOf(eventoGigante(false)));
    deq(rd2.records.map(r => r.banda + '/' + r.escenario), ['A/GIGANTE', 'B/VIBRAMAHOU'], 'una fila con solo un nombre en la primera columna cambia la zona');
  });
  test('Cabeceras: turnos de personal y regiduría NO son zonas; «Entrada»/«Salida» sueltas con horas de prueba = turno', () => {
    ['HORARIO STAGE MANAGER', 'STAGE MANAGER SHIFT', 'TURNO', 'Turnos', 'CREW HOURS', 'REGIDURIA', 'Regiduría', 'HORAS TOTALES TURNO'].forEach(h => eq(I.headerKey(h), 'ignorar', h));
    [['CITACION TECNICOS CAMBIO ESCENARIO', 'call'], ['Crew call', 'call'], ['BAND CALL', 'call'], ['ENTRADA ESCENARIO ARTISTAS', 'pinicio'], ['SALIDA ESCENARIO ARTISTA', 'pfin'],
      ['Stage in', 'pinicio'], ['STAGE OUT', 'pfin'], ['Soundcheck', 'pinicio'], ['CONCIERTO', 'concierto'], ['Performance', 'concierto'], ['Set time', 'concierto'], ['Escenario', 'escenario'], ['Stage', 'escenario'], ['GIGANTE', null], ['PERSONAL', 'notas'], ['ACCIÓN', 'banda'], ['NOTA', 'notas'], ['HORA', 'inicio']]
      .forEach(([h, k]) => eq(I.headerKey(h), k, h));
    const t = 'Banda\tEntrada escenario\tSalida escenario\tEntrada\tSalida\nUno\t15:00\t16:00\t09:00\t18:00';
    deq(I.read(t, CTX).map, ['banda', 'pinicio', 'pfin', 'ignorar', 'ignorar']);
    deq(I.read('Banda\tEntrada\tSalida\nUno\t21:00\t22:00', CTX).map, ['banda', 'inicio', 'fin'], 'sin horas de prueba ni concierto, «Entrada»/«Salida» son inicio y fin');
  });
  test('Horas con «h.», duración «1:45 h.» y celdas de Excel entre comillas con salto de línea', () => {
    eq(hm('15:15 h.'), '15:15'); eq(hm('16:30: h.'), '16:30'); eq(hm('16:00 h'), '16:00'); eq(hm('9.45 h.'), '09:45'); eq(hm('21h'), '21:00');
    deq(['1:45 h.', '0:45', '3:00 h', '2h', '1,5 h', '75', '75 min', 'raro'].map(I.durMinutes), ['105', '45', '180', '120', '90', '75', '75', 'raro']);
    eq(I.joinQuotedLines('a\t"x\ny"\tb\nc\td'), 'a\t"x y"\tb\nc\td');
    eq(I.joinQuotedLines('a\t"sin cerrar\nb'), 'a\t"sin cerrar\nb', 'comillas sin cerrar: no se toca');
  });
  test('«Jueves 27» sin mes: el más cercano a hoy, y los siguientes junto al primero (con aviso)', () => {
    const ctx = { year: 2026, days: [], today: '2026-10-07' };
    const a = I.parseDate('Jueves 27', ctx);
    eq(a.iso, '2026-08-27'); ok(/sin mes/.test(a.warn));
    eq(I.parseDate('Viernes 28', ctx).iso, '2026-08-28');
    eq(I.parseDate('Thursday 27', { year: 2026, days: [], today: '2027-03-01' }).iso, '2027-05-27', 'en inglés y hacia delante si es lo más cercano');
    eq(I.parseDate('Jueves 27', { year: 2026, days: ['2026-08-27', '2026-08-28'] }).iso, '2026-08-27', 'con el evento abierto, su día (sin aviso)');
  });
  test('Libro con una hoja por zona: junta las de horario con las mismas columnas; la de personal, fuera', () => {
    const cab = z => z + '\tARTISTA\tENTRADA ESCENARIO\tSALIDA ESCENARIO\tCONCIERTO' + (z === 'VIBRAMAHOU' ? '\t\t' : '') + '\n';   // columnas vacías de más al final: da igual
    const sheets = [{ name: 'GIGANTE', text: cab('GIGANTE') + 'Jueves 27\tUno\t15:00\t16:00\t\n\tUno\t\t\t21:00-22:00' },
      { name: 'VIBRAMAHOU', text: cab('VIBRAMAHOU') + 'Jueves 27\tDos\t11:00\t12:00\t' },
      { name: 'PERSONAL', text: 'GIGANTE\tHORARIO STAGE MANAGER\tPERSONAL\nJueves 27\t14:45 - 01:00\tLUIS' },
      { name: 'Otra', text: 'Banda\tHora\nTres\t20:00' }];
    const ctx = { year: 2026, days: ['2026-08-27'] }, m = I.mergeSheets(sheets, ctx);
    deq(m.used, ['GIGANTE', 'VIBRAMAHOU']); deq(m.skipped, ['PERSONAL', 'Otra']);
    deq(I.read(m.text, ctx).records.map(r => r.banda + '/' + r.escenario + '/' + r.tipoCol), ['Uno/GIGANTE/sc', 'Uno/GIGANTE/show', 'Dos/VIBRAMAHOU/sc']);
  });

  // ── Hoja de ruta de gira (Roadbook) — Viva Suecia en Ponferrada, 05.09.2026 ─────────────────────────
  // Copiada del PDF pasado a Word: bloques de 2-3 líneas (hora · actividad · quién va), con «*» sueltos y líneas en blanco.
  const PONFERRADA = "08:45H\nSalida furgoneta MÚSICOS MADRID desde Plaza del Encuentro\nMÚSICOS MADRID + ¿NIC?\n09:00H\nTransfer Hotel - Recinto Crew 1 en furgo\nANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:15H\nParada para recogida furgoneta MÚSICOS MADRID en Chamartín\nMÚSICOS MADRID + JESS + NIC\n09:15H\nCitación en recinto para acceso trailers\nANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:30H\nDescarga equipos + montaje TARIMAS Y EQUIPOS PROVEEDORES\nGUIO + SARA + PROVEEDORES\n10:30H\nTransfer Hotel - Recinto Crew 2\nCREW\n10:45H\nMontaje equipos VS\n CREW\n14:00H a 15:30H\nCOMIDA CREW en recinto\n CREW\n13:45H\nCOMIDA BANDA + MÚSICOS\nJAIME + BANDA + MÚSICOS + NIC\n15:30H\n Linecheck\n CREW\n16:15H\nTransfer Hotel - Recinto Banda y músicos\nJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n16:30H\nPRUEBA VIVA SUECIA\nALL\n17:30H\nFin de pruebas + Cambio escenario\nCREW\n17:30H\nTransfer Recinto - Hotel Banda y músicos\n JAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n18:00H (a valorar si está antes)\nTransfer Recinto - Hotel Crew\nANA + CREW\n20:00H\nApertura de puertas\n\n* \n\n20:20H\nTransfer Hotel - Recinto Avanzada\nANA + BEA + LIDIA + SARA\n20:50H\nTransfer Hotel - Recinto Crew\nANA + CREW\n20:50H\nTransfer Hotel - Recinto Banda y músicos\nJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n21:00H\nCitación en recinto para show\nALL\n21:15H\nShow Paula Mattheus (45')\n\n* \n\n22:00H\nCambio escenario\nCREW\n22:30H\nSHOW VIVA SUECIA (90')\nALL\n";
  function eventoPonferrada() { return C.newFestival({ nombre: 'Viva Suecia · Ponferrada', fechaInicio: '2026-09-04', fechaFin: '2026-09-05', dayCutoff: '06:00' }).state; }
  test('Hoja de ruta en bloques (Ponferrada): 23 entradas limpias con tipo, horas y notas; 0 errores', () => {
    const s = eventoPonferrada(), ctx = I.contextOf(s), rd = I.read(PONFERRADA, ctx);
    const pv = I.preview(s, rd.records, { ctx, defaultJornada: '2026-09-05' });
    eq(rd.kind, 'texto'); eq(pv.counts.err, 0, pv.rows.filter(r => r.errs.length).map(r => r.banda + ': ' + r.errs).join(' | '));
    eq(pv.rows.length, 23, 'cada hora del sábado es una entrada (09:15, 17:30 y 20:50 traen dos)'); eq(rd.ignored.length, 0);
    const T = pv.rows.map(r => r.tipo), cuenta = t => T.filter(x => x === t).length;
    deq([cuenta('tarea'), cuenta('hito'), cuenta('sc'), cuenta('show')], [16, 4, 1, 2], 'tareas · hitos · prueba · shows');
    const fila = n => pv.rows.find(r => r.banda === n);
    deq(['tipo', 'inicio', 'notas'].map(k => fila('Salida furgoneta MÚSICOS MADRID desde Plaza del Encuentro')[k]), ['tarea', '08:45', 'MÚSICOS MADRID + ¿NIC?'], 'hora · actividad · quién va');
    deq(['tipo', 'inicio', 'fin'].map(k => fila('COMIDA CREW en recinto')[k]), ['tarea', '14:00', '15:30'], '«14:00H a 15:30H»');
    deq(['tipo', 'banda', 'notas'].map(k => pv.rows.find(r => r.tipo === 'sc')[k]), ['sc', 'VIVA SUECIA', 'ALL'], '«PRUEBA VIVA SUECIA» = soundcheck de Viva Suecia');
    eq(fila('Fin de pruebas + Cambio escenario').tipo, 'hito'); eq(fila('Citación en recinto para acceso trailers').tipo, 'hito');
    eq(fila('Apertura de puertas').tipo, 'hito'); eq(fila('Apertura de puertas').notas, '', 'el «*» suelto no es una nota');
    eq(fila('Cambio escenario').tipo, 'tarea'); eq(fila('Linecheck').tipo, 'tarea');
    deq(['tipo', 'inicio', 'fin'].map(k => fila('Paula Mattheus')[k]), ['show', '21:15', '22:00'], '«Show Paula Mattheus (45\')» → fin por la duración');
    deq(['tipo', 'inicio', 'fin'].map(k => fila('VIVA SUECIA') && pv.rows.find(r => r.tipo === 'show' && r.banda === 'VIVA SUECIA')[k]), ['show', '22:30', '00:00'], '«SHOW VIVA SUECIA (90\')»');
    eq(fila('Transfer Recinto - Hotel Crew').notas, 'a valorar si está antes · ANA + CREW', 'el paréntesis de la hora también a notas');
    ok(pv.rows.every(r => r.jornada === '2026-09-05'));
    const a = I.apply(s, pv, {}); eq(a.added, 23); eq(a.errors.length, 0, a.errors.join(' | '));
  });
  test('Hoja de ruta en bloques con la hora en negrita («**08:45H**») y fechas «05.09.2026»', () => {
    const t = 'HORARIOS SÁBADO 05.09.2026\n**08:45H**\n**Salida furgoneta**\nMÚSICOS\n**21:15H a 22:00H**\nShow Paula (45\')\n*** Aviso: sin pirotecnia ***';
    const rd = I.read(t, I.contextOf(eventoPonferrada()));
    deq(rd.records.map(r => [r.banda, r.jornada, r.inicio, r.fin, r.notas].join('/')), ['Salida furgoneta/2026-09-05/08:45//MÚSICOS', 'Show Paula/2026-09-05/21:15/22:00/']);
    ok(rd.ignored.some(x => /pirotecnia/.test(x.line)), 'un aviso entre *** sigue siendo un comentario');
  });
  test('La misma hoja de ruta copiada como tabla (HORA · ACCIÓN · NOTA, dos jornadas): notas no son zonas, TBC fuera', () => {
    const t = "HORARIOS VIERNES 04.09.2026\nHORA\tACCIÓN\tNOTA\n10:30H\tSalida furgoneta CREW desde Local (ojo recogidas en ruta)\tCREW\n12:00H\tSalida furgoneta BANDA desde Local\tBANDA (EXCEPTO JESS) + JAIME + ANTONIO ILLÁN\nEn ruta\tCOMIDA\tALL\n20:15H\tLlegada estimada a hotel\tALL\n21:30H\tCENA\tALL\nHORARIOS SÁBADO 05.09.2026\nHORA\tACCIÓN\tNOTA\n08:45H\tSalida furgoneta MÚSICOS MADRID desde Plaza del Encuentro\tMÚSICOS MADRID + ¿NIC?\n09:00H\tTransfer Hotel - Recinto Crew 1 en furgo\tANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:15H\tParada para recogida furgoneta MÚSICOS MADRID en Chamartín\tMÚSICOS MADRID + JESS + NIC\n09:15H\tCitación en recinto para acceso trailers\tANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:30H\tDescarga equipos + montaje TARIMAS Y EQUIPOS PROVEEDORES\tGUIO + SARA + PROVEEDORES\n10:30H\tTransfer Hotel - Recinto Crew 2\tCREW\n10:45H\tMontaje equipos VS\tCREW\n14:00H a 15:30H\tCOMIDA CREW en recinto\tCREW\n13:45H\tCOMIDA BANDA + MÚSICOS\tJAIME + BANDA + MÚSICOS + NIC\n15:30H\tLinecheck\tCREW\n16:15H\tTransfer Hotel - Recinto Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n16:30H\tPRUEBA VIVA SUECIA\tALL\n17:30H\tFin de pruebas + Cambio escenario\tCREW\n17:30H\tTransfer Recinto - Hotel Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n18:00H (a valorar si está antes)\tTransfer Recinto - Hotel Crew\tANA + CREW\n20:00H\tApertura de puertas\t-\n20:20H\tTransfer Hotel - Recinto Avanzada\tANA + BEA + LIDIA + SARA\n20:50H\tTransfer Hotel - Recinto Crew\tANA + CREW\n20:50H\tTransfer Hotel - Recinto Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n21:00H\tCitación en recinto para show\tALL\n21:15H\tShow Paula Mattheus (45')\t-\n22:00H\tCambio escenario\tCREW\n22:30H\tSHOW VIVA SUECIA (90')\tALL\n00:00H\tFin show + Inicio desmontaje\tCREW\nTBC, uno temprano\tTransfer Recinto - Hotel Banda y músicos\tANA + JAIME + BANDA + MÚSICOS\nTBC\tTransfer Recinto - Hotel Crew\tANA + JAIME + CREW\n";
    const s = eventoPonferrada(), ctx = I.contextOf(s), rd = I.read(t, ctx), pv = I.preview(s, rd.records, { ctx });
    deq(rd.map, ['inicio', 'banda', 'notas'], 'la columna de quién va son notas (antes salían 10 «zonas»)');
    eq(pv.newStages.length, 0); eq(pv.counts.err, 0, pv.rows.filter(r => r.errs.length).map(r => r.banda + ': ' + r.errs).join(' | '));
    deq([pv.rows.filter(r => r.jornada === '2026-09-04').length, pv.rows.filter(r => r.jornada === '2026-09-05').length], [4, 24], 'viernes 4 · sábado 5 (por las filas de título)');
    ok(rd.ignored.some(x => /En ruta/.test(x.why)) && rd.ignored.filter(x => /^sin hora/.test(x.why)).length === 3, 'En ruta y TBC: ignoradas (listadas)');
    eq(pv.rows.find(r => r.banda === 'Apertura de puertas').notas, '', 'el «-» de la nota no cuenta');
  });
  test('Hoja de ruta copiada como tabla SIN cabecera (lo de la captura): 23 entradas, la tercera columna son notas y no 10 zonas', () => {
    const t = "08:45H\tSalida furgoneta MÚSICOS MADRID desde Plaza del Encuentro\tMÚSICOS MADRID + ¿NIC?\n09:00H\tTransfer Hotel - Recinto Crew 1 en furgo\tANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:15H\tParada para recogida furgoneta MÚSICOS MADRID en Chamartín\tMÚSICOS MADRID + JESS + NIC\n09:15H\tCitación en recinto para acceso trailers\tANA + ¿ABELLÁN? + BEA + GUIO + LIDIA + SARA\n09:30H\tDescarga equipos + montaje TARIMAS Y EQUIPOS PROVEEDORES\tGUIO + SARA + PROVEEDORES\n10:30H\tTransfer Hotel - Recinto Crew 2\tCREW\n10:45H\tMontaje equipos VS\tCREW\n14:00H a 15:30H\tCOMIDA CREW en recinto\tCREW\n13:45H\tCOMIDA BANDA + MÚSICOS\tJAIME + BANDA + MÚSICOS + NIC\n15:30H\tLinecheck\tCREW\n16:15H\tTransfer Hotel - Recinto Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n16:30H\tPRUEBA VIVA SUECIA\tALL\n17:30H\tFin de pruebas + Cambio escenario\tCREW\n17:30H\tTransfer Recinto - Hotel Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n18:00H (a valorar si está antes)\tTransfer Recinto - Hotel Crew\tANA + CREW\n20:00H\tApertura de puertas\t-\n20:20H\tTransfer Hotel - Recinto Avanzada\tANA + BEA + LIDIA + SARA\n20:50H\tTransfer Hotel - Recinto Crew\tANA + CREW\n20:50H\tTransfer Hotel - Recinto Banda y músicos\tJAIME + BANDA + MÚSICOS + FURGO MADRID + NIC\n21:00H\tCitación en recinto para show\tALL\n21:15H\tShow Paula Mattheus (45')\t-\n22:00H\tCambio escenario\tCREW\n22:30H\tSHOW VIVA SUECIA (90')\tALL\n";
    const s = eventoPonferrada(), ctx = I.contextOf(s), rd = I.read(t, ctx), pv = I.preview(s, rd.records, { ctx, defaultJornada: '2026-09-05' });
    eq(rd.hasHeader, false); deq(rd.map, ['inicio', 'banda', 'notas']);
    eq(pv.newStages.length, 0, 'ninguna zona inventada'); eq(pv.counts.err, 0, pv.rows.filter(r => r.errs.length).map(r => r.banda + ': ' + r.errs).join(' | ')); eq(pv.rows.length, 23);
    eq(pv.rows.find(r => /Citación en recinto para show/.test(r.banda)).tipo, 'hito', 'antes salía como show');
  });
  test('Tipos de hoja de ruta: tarea frente a hito', () => {
    const tipo = n => I.proposeTipo({ banda: n }, 'show').tipo;
    [['Salida furgoneta CREW', 'tarea'], ['Transfer Hotel - Recinto', 'tarea'], ['Parada para recogida furgoneta', 'tarea'], ['Cambio escenario', 'tarea'], ['Linecheck', 'tarea'],
      ['Llegada y descarga Omega', 'tarea'], ['Fin de pruebas + Cambio escenario', 'hito'], ['Citación en recinto para show', 'hito'], ['Apertura de puertas', 'hito'],
      ['Fin show + Inicio desmontaje', 'hito'], ['PRUEBA VIVA SUECIA', 'sc'], ['Show Paula Mattheus', 'show'], ['Doors', 'hito'], ['Crew lunch', 'tarea']].forEach(([n, t]) => eq(tipo(n), t, n));
    eq(I.parseDate('05.09.2026').iso, '2026-09-05'); eq(I.parseDate('04.09.26').iso, '2026-09-04');
  });

  test('Vista previa: un hito nunca lleva el aviso de «sin fin»; shows, pruebas y tareas sin fin sí (se estiman 60 min)', () => {
    const t = '19:00 Apertura de puertas\n19:30 Citación en recinto\n20:00 Banda Uno\n17:00 Prueba de sonido Banda Uno\n13:00 Comida';
    const pv = I.preview(S, I.read(t, CTX).records, { ctx: CTX, defaultJornada: '2026-07-10', defaultStageId: S.escenarios[0].id });
    deq(pv.rows.map(r => r.tipo), ['hito', 'hito', 'show', 'sc', 'tarea']);
    const sinFin = r => r.warns.some(w => /Sin fin/.test(w));
    deq(pv.rows.map(sinFin), [false, false, true, true, true]);
    eq(pv.rows[2].warns.find(w => /Sin fin/.test(w)), 'Sin fin: se estiman 60 min');
    ok(pv.rows.slice(0, 2).every(r => r.status === 'ok' && r.fin === ''), 'los hitos, limpios');
  });
  test('«Zona por defecto»: se aplica a TODAS las filas sin zona (también tareas e hitos); las que traen zona, la conservan', () => {
    const t = '09:00 Transfer hotel - recinto\n19:00 Apertura de puertas\n20:00 Banda Uno\n21:00 Banda Dos (Carpa)';
    const P = S.escenarios[0], K = S.escenarios[1];
    const pv = I.preview(S, I.read(t, CTX).records, { ctx: CTX, defaultJornada: '2026-07-10', defaultStageId: P.id });
    deq(pv.rows.map(r => r.escenario), [P.nombre, P.nombre, P.nombre, K.nombre]);
    const sin = I.preview(S, I.read(t, CTX).records, { ctx: CTX, defaultJornada: '2026-07-10' });
    deq(sin.rows.map(r => r.escenario), ['', '', '', K.nombre], 'sin zona por defecto: las tareas quedan sin zona');
  });
  let pass = 0; const fails = [];
  tests.forEach(([n, f]) => { try { f(); pass++; } catch (e) { fails.push([n, e.message]); } });
  const summary = 'Importar: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
  if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); if (fails.length) process.exitCode = 1; }
  else {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const box = document.createElement('div');
    box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
    document.getElementById('out').appendChild(box);
    window.__TEST_IMPORT__ = { pass, total: tests.length, fails };
  }
})();
