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
  test('vista previa: duplicada en la misma jornada → desmarcada; misma banda otro día → nueva', () => {
    let s = C.addArtist(S, 'show', { nombre: 'Los Ejemplos', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('Banda\tEscenario\tJornada\tInicio\nlos ejemplos\tPrincipal\t10/07\t21:00\nLos Ejemplos\tPrincipal\t11/07\t21:00', CTX).records;
    const pv = I.preview(s, recs, { mode: 'show', ctx: CTX });
    eq(pv.rows[0].action, 'duplicada'); eq(pv.rows[0].include, false);
    eq(pv.rows[1].action, 'nueva'); eq(pv.rows[1].include, true);
  });
  test('soundcheck de una banda que ya existe en show → completa la misma banda (no duplica)', () => {
    let s = C.addArtist(S, 'show', { nombre: 'Los Ejemplos', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('Banda\tJornada\tInicio\tFin\tCALL\nLos Ejemplos\t10/07\t16:00\t16:45\t15:30', CTX).records;
    const pv = I.preview(s, recs, { mode: 'sc', ctx: CTX });
    eq(pv.rows[0].action, 'completar'); eq(pv.rows[0].status, 'warn');
    const ap = I.apply(s, pv, { mode: 'sc' });
    eq(ap.updated, 1); eq(ap.added, 0); eq(ap.state.artists.length, 1);
    const a = ap.state.artists[0];
    eq(a.soundcheckInicio, '16:00'); eq(a.soundcheckFin, '16:45'); eq(a.soundcheckCall, '15:30'); eq(a.inicio, '21:00');
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

  test('banda repetida sin escenario: toma el de la banda existente y queda desmarcada', () => {
    const s2 = C.addArtist(S, 'show', { nombre: 'Uno', escenarioId: S.escenarios[1].id, jornada: '2026-07-10', inicio: '21:00', fin: '22:00' }).state;
    const recs = I.read('VIERNES 10 JULIO\n21:00-22:00 Uno', I.contextOf(s2)).records;
    const pv = I.preview(s2, recs, { mode: 'show', ctx: I.contextOf(s2) });
    eq(pv.rows[0].action, 'duplicada'); eq(pv.rows[0].escenario, 'Carpa'); eq(pv.rows[0].status, 'warn'); eq(pv.rows[0].include, false);
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
    eq(pv.rows[4].action, 'unir'); eq(ap.added, 6, '4 tareas/hitos + Uno (soundcheck) + Dos; el show de Uno se une'); eq(ap.updated, 1);
    const st = ap.state;
    eq(st.artists.filter(a => a.showtimeTipo === 'hito').length, 2); eq(st.artists.filter(a => a.showtimeTipo === 'tarea').length, 2);
    const uno = st.artists.find(a => a.nombre === 'Uno'); eq(uno.soundcheckInicio, '16:00'); eq(uno.inicio, '21:00');
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
    eq(pv.rows[2].notas, 'por turnos'); eq(pv.rows[2].escenario, '', 'un paréntesis cualquiera no es un escenario');
    eq(pv.rows[3].banda, 'Omega'); eq(pv.rows[3].notas, 'con Kiki y Antonio');
    eq(pv.rows[5].banda, 'OMEGA 30.º ANIVERSARIO'); eq(pv.rows[5].notas, '1 set * 105 min');
    ok(r.ignored.some(l => /Restricciones/.test(l.line)), 'el aviso *** se ignora (y se lista)');
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
