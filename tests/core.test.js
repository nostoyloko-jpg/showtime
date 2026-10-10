/* Tests de core.js — sin dependencias.
 * Ordenador:  node tests/core.test.js        (o con otra zona: TZ=America/New_York node tests/core.test.js)
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('../core.js') : window.ShowtimeCore;

  // ── Mini ejecutor ─────────────────────────────────────────────────────
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function fmt(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + fmt(b) + ', salió ' + fmt(a)); }
  function deq(a, b, msg) { if (fmt(a) !== fmt(b)) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + fmt(b) + ', salió ' + fmt(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // ── Datos: copia de referencia/ejemplo-festival.json ──────────────────
  const FEST = {
    event: { nombre: 'Festival de Ejemplo', fechaInicio: '2026-07-10', fechaFin: '2026-07-11', dayCutoff: '06:00', callMins: 15 },
    escenarios: [ { id: 'esc1', nombre: 'Principal', color: '#e94560' }, { id: 'esc2', nombre: 'Carpa', color: '#4fc3f7' } ],
    artists: [
      { id: 1, nombre: 'Los Ejemplos', color: '#e94560', escenarioId: 'esc1', fecha: '2026-07-10', inicio: '21:00', fin: '22:15', notas: 'Intro con playback',
        soundcheckFecha: '2026-07-10', soundcheckInicio: '16:00', soundcheckFin: '16:45', soundcheckCall: '15:30', soundcheckNotas: 'Backline propio' },
      { id: 2, nombre: 'Banda Demo', color: '#4fc3f7', escenarioId: 'esc2', fecha: '2026-07-10', inicio: '21:30', fin: '22:30', notas: '',
        soundcheckFecha: '2026-07-10', soundcheckInicio: '17:00', soundcheckFin: '17:40', soundcheckCall: '16:40', soundcheckNotas: '' },
      { id: 3, nombre: 'Cabeza de Cartel', color: '#1de9b6', escenarioId: 'esc1', fecha: '2026-07-10', inicio: '23:30', fin: '01:15', notas: 'Pirotecnia al final',
        soundcheckFecha: '2026-07-10', soundcheckInicio: '18:00', soundcheckFin: '19:00', soundcheckCall: '17:30', soundcheckNotas: '' },
      { id: 4, nombre: 'DJ de Cierre', color: '#c77dff', escenarioId: 'esc2', fecha: '2026-07-11', inicio: '02:00', fin: '04:00', notas: 'Cuenta como jornada del 10 (antes de las 06:00)',
        soundcheckFecha: '', soundcheckInicio: '', soundcheckFin: '', soundcheckCall: '', soundcheckNotas: '' }
    ]
  };
  // 2026-07-10 = día 9687 desde 2000-01-01 (a mano: 26 años, 7 bisiestos → 9497; ene–jun 181 → 9678; +9)
  const D10 = 9687 * 1440, D11 = 9688 * 1440;
  const at = (base, hm) => base + C.parseHM(hm);
  const SHOW = C.buildBlocks(FEST, { mode: 'show', day: 'all' });
  const byName = n => SHOW.find(b => b.name === n);

  // ── Formato básico ────────────────────────────────────────────────────
  test('parseHM acepta y rechaza', () => {
    eq(C.parseHM('21:00'), 1260); eq(C.parseHM('7:05'), 425); eq(C.parseHM('00:00'), 0);
    eq(C.parseHM('24:00'), null); eq(C.parseHM('12:60'), null); eq(C.parseHM(''), null);
    eq(C.parseHM('ab'), null); eq(C.parseHM(null), null); eq(C.parseHM('21'), null);
  });
  test('fmtHM da la hora del día de un absoluto', () => {
    eq(C.fmtHM(at(D10, '21:05')), '21:05'); eq(C.fmtHM(at(D11, '01:15')), '01:15');
    eq(C.fmtHM(at(D10, '21:05') + 0.9), '21:05'); eq(C.fmtHM(-60), '23:00'); eq(C.fmtHM(null), '—');
  });

  // ── Minutos absolutos ─────────────────────────────────────────────────
  test('dayIndex: origen, fecha conocida, bisiesto y fechas imposibles', () => {
    eq(C.dayIndex('2000-01-01'), 0); eq(C.dayIndex('2026-07-10'), 9687);
    eq(C.dayIndex('2024-02-29') - C.dayIndex('2024-02-28'), 1);
    eq(C.dayIndex('2026-02-30'), null); eq(C.dayIndex(''), null); eq(C.dayIndex('10/07/2026'), null);
  });
  test('isoOfDay y shiftDate (también cambio de mes y de año)', () => {
    eq(C.isoOfDay(9687), '2026-07-10'); eq(C.shiftDate('2026-07-01', -1), '2026-06-30');
    eq(C.shiftDate('2027-01-01', -1), '2026-12-31'); eq(C.shiftDate('basura', -1), 'basura');
  });
  test('toAbs con fecha = días×1440 + hora; sin fecha, solo hora del día', () => {
    eq(C.toAbs('2026-07-10', '21:00'), D10 + 1260);
    eq(C.toAbs('', '21:00'), 1260); eq(C.toAbs('2026-07-10', ''), null);
  });
  test('cambio de hora (Madrid 29-mar y 25-oct 2026): los días siguen midiendo 1440', () => {
    eq(C.toAbs('2026-03-29', '00:00') - C.toAbs('2026-03-28', '00:00'), 1440);
    eq(C.toAbs('2026-10-25', '00:00') - C.toAbs('2026-10-24', '00:00'), 1440);
    eq(C.nowAbs(new Date(2026, 2, 29, 12, 0, 0)), C.toAbs('2026-03-29', '12:00'));
    eq(C.nowAbs(new Date(2026, 9, 25, 12, 0, 0)), C.toAbs('2026-10-25', '12:00'));
  });
  test('nowAbs está en la MISMA escala que los bloques (y lleva segundos)', () => {
    eq(C.nowAbs(new Date(2026, 6, 10, 21, 30, 0)), at(D10, '21:30'));
    eq(C.nowAbs(new Date(2026, 6, 11, 1, 50, 30)), at(D11, '01:50') + 0.5);
    ok(C.nowAbs(new Date(2026, 6, 11, 1, 50)) > at(D10, '23:30'), 'madrugada va después de la noche anterior, no a las 13:30');
  });

  // ── Cruce de medianoche ───────────────────────────────────────────────
  test('adjustEnd: 23:30–01:15 dura 105 min, no −1335', () => {
    const si = at(D10, '23:30'), sf = C.adjustEnd(si, C.toAbs('2026-07-10', '01:15'));
    eq(sf - si, 105); eq(sf, at(D11, '01:15'));
    eq(C.adjustEnd(100, 200), 200); eq(C.adjustEnd(null, 200), 200); eq(C.adjustEnd(100, null), null);
  });
  test('buildBlocks: el cabeza de cartel termina al día siguiente', () => {
    const b = byName('Cabeza de Cartel');
    eq(b.si, at(D10, '23:30')); eq(b.sf, at(D11, '01:15'));
  });

  // ── Día de festival ───────────────────────────────────────────────────
  test('festivalDateOf: el DJ de las 02:00 del 11 es jornada del 10', () => {
    eq(C.festivalDateOf(FEST, FEST.artists[3], false), '2026-07-10');
    eq(C.festivalDateOf(FEST, FEST.artists[0], false), '2026-07-10');
  });
  test('festivalDateOf: justo en la hora de corte ya es el día nuevo; corte propio', () => {
    eq(C.festivalDateOf(FEST, { fecha: '2026-07-11', inicio: '06:00' }), '2026-07-11');
    eq(C.festivalDateOf(FEST, { fecha: '2026-07-11', inicio: '05:59' }), '2026-07-10');
    eq(C.festivalDateOf({ event: { dayCutoff: '05:00' } }, { fecha: '2026-07-11', inicio: '05:30' }), '2026-07-11');
    eq(C.festivalDateOf({ event: { dayCutoff: 'xx' } }, { fecha: '2026-07-11', inicio: '05:30' }), '2026-07-10', 'corte inválido → 06:00');
  });
  test('festivalDateOf soundcheck: usa soundcheckFecha y, si falta, fecha; sin fecha → vacío', () => {
    eq(C.festivalDateOf(FEST, { fecha: '2026-07-11', soundcheckFecha: '', soundcheckInicio: '03:00' }, true), '2026-07-10');
    eq(C.festivalDateOf(FEST, { fecha: '2026-07-11', soundcheckFecha: '2026-07-12', soundcheckInicio: '16:00' }, true), '2026-07-12');
    eq(C.festivalDateOf(FEST, { fecha: '', inicio: '21:00' }, false), '');
  });
  test('festivalDays: jornadas del selector', () => {
    deq(C.festivalDays(FEST, 'show'), ['2026-07-10']); deq(C.festivalDays(FEST, 'sc'), ['2026-07-10']);
  });
  test('filtro de día: el 10 incluye al DJ de madrugada, el 11 queda vacío; el dibujo usa la hora real', () => {
    const d10 = C.buildBlocks(FEST, { mode: 'show', day: '2026-07-10' });
    eq(d10.length, 4); eq(d10[3].name, 'DJ de Cierre'); eq(d10[3].si, at(D11, '02:00'));
    eq(C.buildBlocks(FEST, { mode: 'show', day: '2026-07-11' }).length, 0);
  });

  // ── Conversión ────────────────────────────────────────────────────────
  test('buildBlocks show: orden, escenario, color, notas, sin CALL', () => {
    deq(SHOW.map(b => b.name), ['Los Ejemplos', 'Banda Demo', 'Cabeza de Cartel', 'DJ de Cierre']);
    const b = SHOW[1];
    eq(b.stage, 'Carpa'); eq(b.stageId, 'esc2'); eq(b.stageColor, '#4fc3f7'); eq(b.call, ''); eq(b.callAbs, null); eq(b.id, 2);
    eq(SHOW[0].notes, 'Intro con playback');
  });
  test('buildBlocks soundcheck: entran los que tienen inicio o CALL', () => {
    const sc = C.buildBlocks(FEST, { mode: 'sc', day: 'all' });
    deq(sc.map(b => b.name), ['Los Ejemplos', 'Banda Demo', 'Cabeza de Cartel']);
    eq(sc[0].call, '15:30'); eq(sc[0].callAbs, at(D10, '15:30')); eq(sc[0].notes, 'Backline propio');
    const solo = C.buildBlocks({ artists: [{ nombre: 'X', fecha: '2026-07-10', soundcheckCall: '14:00' }] }, { mode: 'sc' });
    eq(solo.length, 1); eq(solo[0].si, null); eq(solo[0].callAbs, at(D10, '14:00'));
  });
  test('color: sin color propio, el de la lista por posición', () => {
    const f = { artists: [{ nombre: 'A', fecha: '2026-07-10', inicio: '10:00' }, { nombre: 'B', fecha: '2026-07-10', inicio: '11:00' }] };
    deq(C.buildBlocks(f, {}).map(b => b.color), [C.ARTIST_COLORS[0], C.ARTIST_COLORS[1]]);
  });
  test('sin inicio va al final, no al principio', () => {
    const f = { artists: [{ nombre: 'SinHora', fecha: '2026-07-10', fin: '10:00' }, { nombre: 'A', fecha: '2026-07-10', inicio: '12:00' }] };
    deq(C.buildBlocks(f, {}).map(b => b.name), ['A', 'SinHora']);
  });

  // ── CALL tras medianoche (arreglo ESPEC §8) ───────────────────────────
  test('callAbsFor: CALL normal, CALL antes de medianoche para show después, y al revés', () => {
    eq(C.callAbsFor(at(D10, '16:00'), '15:30'), at(D10, '15:30'));
    eq(C.callAbsFor(at(D11, '00:30'), '23:30'), at(D10, '23:30'), 'víspera, no un día tarde');
    eq(C.callAbsFor(at(D10, '23:50'), '00:10'), at(D11, '00:10'));
    eq(C.callAbsFor(null, '14:00', '2026-07-10'), at(D10, '14:00'));
    eq(C.callAbsFor(at(D10, '16:00'), ''), null);
  });
  test('buildBlocks: soundcheck a las 00:30 con CALL 23:30 → CALL la víspera', () => {
    const f = { artists: [{ nombre: 'Noche', fecha: '2026-07-11', soundcheckInicio: '00:30', soundcheckFin: '01:00', soundcheckCall: '23:30' }] };
    const b = C.buildBlocks(f, { mode: 'sc' })[0];
    eq(b.callAbs, at(D10, '23:30')); ok(b.callAbs < b.si);
  });

  // ── En escena / Siguiente ─────────────────────────────────────────────
  test('en escena: varios a la vez (dos escenarios)', () => {
    deq(C.playingNow(SHOW, at(D10, '21:45')).map(b => b.name), ['Los Ejemplos', 'Banda Demo']);
    deq(C.playingNow(SHOW, at(D10, '20:00')), []);
  });
  test('en escena: inicio incluido, fin excluido', () => {
    ok(C.isPlaying(byName('Los Ejemplos'), at(D10, '21:00')));
    ok(!C.isPlaying(byName('Los Ejemplos'), at(D10, '22:15')));
  });
  test('en escena tras medianoche: el cabeza suena a las 00:30 y le quedan 45 min', () => {
    deq(C.playingNow(SHOW, at(D11, '00:30')).map(b => b.name), ['Cabeza de Cartel']);
    const p = C.progress(byName('Cabeza de Cartel'), at(D11, '00:30'));
    eq(p.remaining, 45); eq(Math.round(p.pct), 57);
  });
  test('sin fin se suponen 60 min', () => {
    const b = { name: 'X', si: 1000, sf: null };
    ok(C.isPlaying(b, 1059)); ok(!C.isPlaying(b, 1060)); eq(C.blockEnd(b), 1060);
  });
  test('siguiente: uno por escenario', () => {
    deq(C.nextPerStage(SHOW, at(D10, '20:00')).map(b => b.name), ['Los Ejemplos', 'Banda Demo']);
    deq(C.nextPerStage(SHOW, at(D10, '22:40')).map(b => b.name), ['Cabeza de Cartel', 'DJ de Cierre']);
    deq(C.nextPerStage(SHOW, at(D11, '05:00')), []);
  });
  test('siguiente: sin escenarios, todos cuentan como un grupo → solo el próximo', () => {
    const f = { artists: [1, 2, 3].map(i => ({ nombre: 'A' + i, fecha: '2026-07-10', inicio: (10 + i) + ':00' })) };
    deq(C.nextPerStage(C.buildBlocks(f, {}), at(D10, '09:00')).map(b => b.name), ['A1']);
  });
  test('siguiente: máximo 4', () => {
    const f = { artists: [1, 2, 3, 4, 5, 6].map(i => ({ nombre: 'A' + i, escenarioId: 'e' + i, fecha: '2026-07-10', inicio: (10 + i) + ':00' })) };
    f.escenarios = f.artists.map(a => ({ id: a.escenarioId, nombre: a.escenarioId }));
    eq(C.nextPerStage(C.buildBlocks(f, {}), at(D10, '09:00')).length, 4);
  });

  test('changeover: hueco con el anterior del mismo escenario (cruza medianoche)', () => {
    eq(C.changeoverBefore(SHOW, byName('Cabeza de Cartel')).mins, 75, '22:15 → 23:30');
    eq(C.changeoverBefore(SHOW, byName('Cabeza de Cartel')).prev.name, 'Los Ejemplos');
    eq(C.changeoverBefore(SHOW, byName('DJ de Cierre')).mins, 210, '22:30 → 02:00');
    eq(C.changeoverBefore(SHOW, byName('Los Ejemplos')), null, 'primero de su escenario');
  });

  test('changeover activo: escenario entre bandas, con banda que entra y tiempo restante', () => {
    const c = C.changeoversNow(SHOW, at(D10, '22:20'));
    eq(c.length, 1, 'Carpa sigue sonando (Banda Demo hasta 22:30)');
    eq(c[0].stage, 'Principal'); eq(c[0].prev.name, 'Los Ejemplos'); eq(c[0].next.name, 'Cabeza de Cartel');
    eq(c[0].remaining, 70); eq(c[0].total, 75); eq(Math.round(c[0].pct), 7);
    deq(C.changeoversNow(SHOW, at(D10, '22:40')).map(x => x.stage + '→' + x.next.name), ['Principal→Cabeza de Cartel', 'Carpa→DJ de Cierre']);
  });
  test('changeover: no hay antes de la primera banda del escenario (SIN ACTIVIDAD), ni si suena alguien, ni al final', () => {
    deq(C.changeoversNow(SHOW, at(D10, '21:10')).map(x => x.stage + ':' + x.kind + '→' + x.next.name), ['Carpa:idle→Banda Demo'], 'Principal suena; Carpa antes de su primera banda = sin actividad');
    eq(C.changeoversNow(SHOW, at(D10, '21:10'))[0].prev, null);
    deq(C.changeoversNow(SHOW, at(D11, '05:00')), []);
    const r = C.changeoversNow(SHOW, at(D10, '23:29') + 0.5);
    eq(r[0].remaining, 0.5, 'cuenta atrás con segundos');
  });

  // ── Decisión 76: CHANGEOVER solo entre dos bandas distintas seguidas ──
  const ALL76 = C.buildBlocks(FEST, { mode: 'all', day: 'all' });
  const allKey = k => ALL76.find(b => b.key === k);
  test('76: soundcheck → show de la misma banda no es changeover (sin actividad)', () => {
    // Principal: SC Los Ejemplos 16:00–16:45, SC Cabeza 18:00–19:00, show Los Ejemplos 21:00, show Cabeza 23:30
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists = f.artists.filter(a => a.id === 1);
    const B = C.buildBlocks(f, { mode: 'all', day: 'all' });
    const co = C.changeoverBefore(B, B.find(b => b.key === '1:show'));
    eq(co.prev.key, '1:sc'); ok(co.idle, 'misma entrada');
    const n = C.changeoversNow(B, at(D10, '17:00'));
    eq(n.length, 1); eq(n[0].kind, 'idle'); eq(n[0].next.key, '1:show');
  });
  test('76: entre dos bandas distintas sí es changeover; un hito en medio no lo rompe', () => {
    const co = C.changeoverBefore(ALL76, allKey('3:sc'));
    eq(co.prev.key, '1:sc'); ok(!co.idle);
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists.push({ id: 9, showtimeTipo: 'hito', nombre: 'Puertas', escenarioId: 'esc1', fecha: '2026-07-10', inicio: '17:00' });
    const B = C.buildBlocks(f, { mode: 'all', day: 'all' });
    ok(!C.changeoverBefore(B, B.find(b => b.key === '3:sc')).idle, 'hito no rompe');
    eq(C.changeoversNow(B, at(D10, '17:10')).find(x => x.stageId === 'esc1').kind, 'changeover');
  });
  test('105: «Solo hoy» — la copia para los QR lleva solo la jornada pedida (y la parte de ese día de cada banda)', () => {
    const f = JSON.parse(JSON.stringify(FEST));
    f.event.fechaFin = '2026-07-12';
    f.artists.push({ id: 5, nombre: 'Mañana', escenarioId: 'esc1', fecha: '2026-07-11', inicio: '21:00', fin: '22:00', soundcheckInicio: '17:00', soundcheckFin: '17:30' });
    f.artists.push({ id: 6, nombre: 'Prueba hoy, show mañana', escenarioId: 'esc2', fecha: '2026-07-11', inicio: '20:00', fin: '21:00', soundcheckFecha: '2026-07-10', soundcheckInicio: '19:00', soundcheckFin: '19:30', notas: 'privado' });
    f.artists.push({ id: 7, showtimeTipo: 'tarea', nombre: 'Carga mañana', escenarioId: 'esc1', fecha: '2026-07-11', inicio: '10:00', fin: '11:00' });
    f.showtimeRetrasos = [{ id: 'a', at: 1, minutes: 5, zones: 'all', day: '2026-07-10', from: D10 }, { id: 'b', at: 1, minutes: 5, zones: 'all', day: '2026-07-11', from: D11 }];
    const s = C.scopeToJornada(f, '2026-07-10');
    eq(s.artists.map(a => a.id).join(), '1,2,3,4,6', 'el DJ de las 02:00 es de la jornada del 10');
    const p6 = s.artists.find(a => a.id === 6);
    eq(p6.inicio, undefined, 'el show de mañana no viaja'); eq(p6.notas, undefined); eq(p6.soundcheckInicio, '19:00');
    eq(C.buildBlocks(s, { mode: 'sc', day: '2026-07-10' }).filter(b => b.id === 6).length, 1, 'su prueba de hoy sigue');
    eq(C.festivalDays(s, 'all').join(), '2026-07-10', 'solo hay un día');
    eq(s.showtimeRetrasos.map(d => d.id).join(), 'a');
    eq(f.artists.length, 7, 'el original no se toca');
    const m = C.scopeToJornada(f, '2026-07-11');
    eq(m.artists.map(a => a.id).sort().join(), '5,6,7');
    eq(C.buildBlocks(m, { mode: 'all', day: '2026-07-11' }).length, 4, 'show y prueba de Mañana, show del 6 y la tarea');
  });
  test('105: jornada terminada = nada sonando ni por llegar (con marcadores)', () => {
    eq(C.jornadaOver(FEST, '2026-07-10', at(D10, '22:00')), false);
    eq(C.jornadaOver(FEST, '2026-07-10', at(D11, '03:00')), false, 'el DJ sigue');
    eq(C.jornadaOver(FEST, '2026-07-10', at(D11, '04:30')), true);
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists.push({ id: 9, showtimeTipo: 'hito', nombre: 'Curfew', escenarioId: 'esc1', fecha: '2026-07-11', inicio: '05:00' });
    eq(C.jornadaOver(f, '2026-07-10', at(D11, '04:30')), false, 'falta el curfew');
    eq(C.jornadaOver(FEST, '2026-07-12', at(D11, '04:30')), false, 'día sin nada: no se da por terminado');
  });
  test('101: soundcheck → show de bandas DISTINTAS tampoco es changeover (sin actividad); show → show sí', () => {
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists = f.artists.filter(a => a.id === 1 || a.id === 3);   // Principal: SC 1, SC 3, show 1, show 3
    const B = C.buildBlocks(f, { mode: 'all', day: 'all' });
    const s1 = B.find(b => b.key === '1:show'), s3 = B.find(b => b.key === '3:show');
    const co1 = C.changeoverBefore(B, s1);
    eq(co1.prev.kind, 'sc'); ok(co1.idle, 'el anterior es un soundcheck (de otra banda): sin actividad');
    ok(!C.changeoverBefore(B, s3).idle, 'show → show de bandas distintas: changeover');
    ok(!C.changeoverBefore(B, B.find(b => b.key === '3:sc')).idle, 'soundcheck → soundcheck: changeover');
  });
  test('76: una tarea de la zona dentro del hueco lo deja en sin actividad; en curso, manda la tarea', () => {
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists.push({ id: 9, showtimeTipo: 'tarea', nombre: 'Montaje luces', escenarioId: 'esc1', fecha: '2026-07-10', inicio: '17:00', fin: '17:45' });
    f.artists.push({ id: 10, showtimeTipo: 'tarea', nombre: 'Limpieza Carpa', escenarioId: 'esc2', fecha: '2026-07-10', inicio: '16:50', fin: '17:50' });
    const B = C.buildBlocks(f, { mode: 'all', day: 'all' });
    ok(C.changeoverBefore(B, B.find(b => b.key === '3:sc')).idle, 'tarea de Principal en el hueco 16:45–18:00');
    eq(C.changeoversNow(B, at(D10, '17:10')).filter(x => x.stageId === 'esc1').length, 0, 'tarea en curso: no hay tarjeta de hueco');
    eq(C.changeoversNow(B, at(D10, '17:50')).find(x => x.stageId === 'esc1').kind, 'idle', 'tras la tarea: sin actividad');
    eq(C.nextBandIn(B, 'esc1', at(D10, '17:10')).key, '3:sc', 'después: la próxima banda de la zona');
    // En la vista de solo shows (sin tareas) se clasifica igual si se le pasan las tareas
    const S = C.buildBlocks(f, { mode: 'sc', day: 'all' });
    ok(!C.changeoverBefore(S, S.find(b => b.key === '3:sc')).idle, 'sin tareas en la lista: changeover');
    ok(C.changeoverBefore(S, S.find(b => b.key === '3:sc'), B).idle, 'con las tareas: sin actividad');
    eq(C.changeoversNow(S, at(D10, '17:10'), B).find(x => x.stageId === 'esc1').kind, 'idle', 'la tarea no se pinta: sale sin actividad');
  });
  test('76: el STANDBY manual se mantiene en cualquier hueco entre bandas', () => {
    const f = JSON.parse(JSON.stringify(FEST));
    f.artists = f.artists.filter(a => a.id === 1);
    const s = C.setStandby(f, 1, 'show', true).state;
    const n = C.changeoversNow(C.buildBlocks(s, { mode: 'all', day: 'all' }), at(D10, '17:00'));
    ok(n[0].standby); eq(n[0].kind, 'idle', 'el tipo no cambia; la marca manda en la etiqueta');
  });

  // ── CALL por margen ───────────────────────────────────────────────────
  test('CALL: sale con 10 min de margen; no con 16; sí justo en 15', () => {
    deq(C.callList(SHOW, at(D10, '20:50'), 15).map(b => b.name), ['Los Ejemplos']);
    deq(C.callList(SHOW, at(D10, '20:44'), 15), []);
    deq(C.callList(SHOW, at(D10, '20:45'), 15).map(b => b.name), ['Los Ejemplos']);
  });
  test('CALL: abierto tarde (faltan 2 min) sigue saliendo; a la hora en punto ya no (está en escena)', () => {
    deq(C.callList(SHOW, at(D10, '20:58'), 15).map(b => b.name), ['Los Ejemplos']);
    deq(C.callList(SHOW, at(D10, '21:00'), 15), []);
  });
  test('CALL: OK lo quita (Set o array de claves)', () => {
    const k = C.callKey(byName('Los Ejemplos'));
    eq(k, byName('Los Ejemplos').stageId + '|Los Ejemplos@' + at(D10, '21:00'), 'zona|nombre@minutos');
    eq(C.callKeyName(k), 'Los Ejemplos'); eq(C.callKeyName('Los Ejemplos@123'), 'Los Ejemplos', 'clave antigua');
    deq(C.callList(SHOW, at(D10, '20:50'), 15, ['Los Ejemplos@' + at(D10, '21:00')]), [], 'los OK guardados con la clave antigua siguen valiendo');
    deq(C.callList(SHOW, at(D10, '20:50'), 15, new Set([k])), []);
    deq(C.callList(SHOW, at(D10, '20:50'), 15, [k]), []);
  });
  test('CALL: tras medianoche y con callMins propio', () => {
    deq(C.callList(SHOW, at(D11, '01:50'), 15).map(b => b.name), ['DJ de Cierre']);
    deq(C.callList(SHOW, at(D10, '21:10'), 30).map(b => b.name), ['Banda Demo']);
  });

  // ── CALL en cascada (soundcheck con hora de CALL escrita) ──────────────
  const SC = C.buildBlocks(FEST, { mode: 'sc', day: 'all' });
  test('CALL cascada: con hora escrita, salta a esa hora exacta (no inicio − 15)', () => {
    deq(C.callList(SC, at(D10, '15:29'), 15), []);
    deq(C.callList(SC, at(D10, '15:30'), 15).map(b => b.name), ['Los Ejemplos']);
    deq(C.callList(SC, at(D10, '15:59'), 15).map(b => b.name), ['Los Ejemplos']);
    deq(C.callList(SC, at(D10, '16:00'), 15), [], 'al empezar la prueba deja de avisar');
    deq(C.callList(SC, at(D10, '16:39'), 15), []);
    deq(C.callList(SC, at(D10, '16:40'), 15).map(b => b.name), ['Banda Demo']);
  });
  test('CALL cascada: casilla vacía, «—» o inválida → inicio − minutos globales', () => {
    const mk = call => C.buildBlocks({ artists: [{ nombre: 'X', fecha: '2026-07-10', soundcheckInicio: '16:00', soundcheckCall: call }] }, { mode: 'sc' });
    ['', '—', 'xx'].forEach(c => {
      const bl = mk(c);
      eq(C.callAt(bl[0], 15), at(D10, '15:45'), 'call «' + c + '»');
      deq(C.callList(bl, at(D10, '15:44'), 15), []);
      eq(C.callList(bl, at(D10, '15:45'), 15).length, 1);
    });
  });
  test('CALL cascada: hora escrita posterior al inicio (error de datos) → se ignora', () => {
    const bl = C.buildBlocks({ artists: [{ nombre: 'X', fecha: '2026-07-10', soundcheckInicio: '16:00', soundcheckCall: '16:30' }] }, { mode: 'sc' });
    eq(C.callAt(bl[0], 15), at(D10, '15:45'));
  });
  test('CALL cascada: CALL 23:30 para prueba 00:30 avisa desde las 23:30 de la víspera', () => {
    const bl = C.buildBlocks({ artists: [{ nombre: 'N', fecha: '2026-07-11', soundcheckInicio: '00:30', soundcheckCall: '23:30' }] }, { mode: 'sc' });
    eq(C.callList(bl, at(D10, '23:30'), 15).length, 1);
    eq(C.callList(bl, at(D10, '23:29'), 15).length, 0);
  });

  // ── Barras de abajo ───────────────────────────────────────────────────
  test('barras: empiezan en el que suena', () => {
    const r = C.pickBlocks(SHOW, at(D10, '21:45'), 3);
    ok(r.playing); deq(r.list.map(b => b.name), ['Los Ejemplos', 'Banda Demo', 'Cabeza de Cartel']);
  });
  test('barras: sin nadie sonando, empiezan en el siguiente; huecos a null', () => {
    const r = C.pickBlocks(SHOW, at(D10, '22:40'), 3);
    ok(!r.playing); eq(r.list[0].name, 'Cabeza de Cartel'); eq(r.list[1].name, 'DJ de Cierre'); eq(r.list[2], null);
  });
  test('barras: con todo terminado → FIN DE JORNADA, barras vacías', () => {
    const r = C.pickBlocks(SHOW, at(D11, '05:00'), 2);
    ok(!r.playing); ok(r.ended); deq(r.list, [null, null]);
    ok(!C.pickBlocks(SHOW, at(D10, '20:00'), 1).ended, 'antes de empezar no es fin');
    ok(!C.pickBlocks([], at(D10, '20:00'), 1).ended, 'sin datos no es fin');
  });
  test('etiquetas de las barras', () => {
    eq(C.stripLabel(0, true), 'AHORA'); eq(C.stripLabel(0, false), 'SIGUIENTE');
    eq(C.stripLabel(1, true), 'SIGUIENTE'); eq(C.stripLabel(2, true), 'EN 2º LUGAR');
    eq(C.stripLabel(1, false), 'EN 2º LUGAR', 'sin nadie sonando no se repite SIGUIENTE'); eq(C.stripLabel(2, false), 'EN 3º LUGAR');
  });

  // ── Edición explícita (Panel de Control) ─────────────────────────────
  test('normHM: formatos aceptados, vacío/«—» y errores', () => {
    eq(C.normHM('21:30'), '21:30'); eq(C.normHM('2130'), '21:30'); eq(C.normHM('21.30'), '21:30'); eq(C.normHM('9:05'), '09:05');
    eq(C.normHM(''), ''); eq(C.normHM('—'), ''); eq(C.normHM('-'), '');
    eq(C.normHM('25:00'), null); eq(C.normHM('21:7'), null); eq(C.normHM('abc'), null);
  });
  test('editArtist: cambia solo el campo pedido, en un estado NUEVO', () => {
    const r = C.editArtist(FEST, 1, 'show', 'inicio', '2105');
    ok(r.ok); ok(r.changed); eq(r.value, '21:05');
    eq(r.state.artists[0].inicio, '21:05'); eq(FEST.artists[0].inicio, '21:00', 'el original no se toca');
    eq(r.state.artists[0].fin, '22:15');
    const r2 = C.editArtist(FEST, 1, 'sc', 'call', '15:10');
    eq(r2.state.artists[0].soundcheckCall, '15:10'); eq(r2.state.artists[0].inicio, '21:00');
    ok(!C.editArtist(FEST, 1, 'show', 'inicio', '21:00').changed, 'mismo valor → sin cambio');
  });
  test('editArtist: rechaza horas malas, inicio vacío, fecha mala y artista inexistente', () => {
    ok(!C.editArtist(FEST, 1, 'show', 'inicio', '').ok);
    ok(!C.editArtist(FEST, 1, 'show', 'fin', '99:99').ok);
    ok(!C.editArtist(FEST, 1, 'show', 'fecha', '2026-02-30').ok);
    ok(!C.editArtist(FEST, 999, 'show', 'inicio', '21:00').ok);
    ok(C.editArtist(FEST, 1, 'show', 'fin', '').ok, 'fin vacío se permite');
  });
  test('editArtist: CALL de show (campo Showtime) entra en la cascada; «—» lo borra', () => {
    const s = C.editArtist(FEST, 2, 'show', 'call', '21:00').state;
    const b = C.buildBlocks(s, { mode: 'show' }).find(x => x.name === 'Banda Demo');
    eq(b.call, '21:00'); eq(C.callAt(b, 15), at(D10, '21:00'));
    const s2 = C.editArtist(s, 2, 'show', 'call', '—').state;
    eq(C.buildBlocks(s2, { mode: 'show' }).find(x => x.name === 'Banda Demo').call, '');
  });
  test('editArtist soundcheck: fecha vacía usa la del show; al editarla se escribe soundcheckFecha', () => {
    eq(C.fieldValue(FEST.artists[3], 'sc', 'fecha'), '2026-07-11');
    const r = C.editArtist(FEST, 4, 'sc', 'fecha', '2026-07-10');
    eq(r.state.artists[3].soundcheckFecha, '2026-07-10'); eq(r.state.artists[3].fecha, '2026-07-11');
  });
  test('STANDBY manual: lo marca el regidor y cambia el CHANGEOVER por STANDBY', () => {
    const r = C.setStandby(FEST, 3, 'show', true);
    ok(r.ok); ok(r.changed); eq(r.state.artists[2].showtimeStandby, true); ok(!FEST.artists[2].showtimeStandby);
    const c = C.changeoversNow(C.buildBlocks(r.state, { mode: 'show' }), at(D10, '22:20'));
    ok(c[0].standby); eq(c[0].next.name, 'Cabeza de Cartel');
    ok(!C.changeoversNow(SHOW, at(D10, '22:20'))[0].standby, 'sin marcar → CHANGEOVER');
    const off = C.setStandby(r.state, 3, 'show', false);
    ok(!('showtimeStandby' in off.state.artists[2]));
    eq(C.setStandby(r.state, 3, 'sc', true).state.artists[2].showtimeStandby, true, 'el de show no se toca');
    eq(C.setStandby(r.state, 3, 'sc', true).state.artists[2].showtimeStandbySC, true);
  });
  test('modifiedFields / countModified: marca lo cambiado respecto al importado', () => {
    let s = C.editArtist(FEST, 1, 'show', 'inicio', '21:05').state;
    s = C.editArtist(s, 1, 'show', 'notas', 'Nuevo').state;
    s = C.setStandby(s, 3, 'show', true).state;
    s = C.editArtist(s, 2, 'sc', 'fin', '17:50').state;
    deq(C.modifiedFields(FEST, s, 'show'), { 1: ['inicio', 'notas'], 3: ['standby'] });
    deq(C.modifiedFields(FEST, s, 'sc'), { 2: ['fin'] });
    eq(C.countModified(FEST, s), 4); eq(C.countModified(FEST, FEST), 0);
  });

  test('demoFestival: válido, sin avisos y relativo a la hora dada', () => {
    const d = C.demoFestival(at(D10, '22:00'));
    const r = C.validateProject(d); ok(r.ok); deq(r.warnings, []);
    deq(C.playingNow(C.buildBlocks(d, {}), at(D10, '22:00')).map(b => b.name), ['Los Ejemplos', 'Banda Demo']);
  });

  // ── Editor propio: festival, escenarios y bandas ─────────────────────
  const mkFest = () => {
    let s = C.newFestival({ nombre: 'Fiesta', fechaInicio: '2026-07-10', fechaFin: '2026-07-11' }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa', '#4FC3F7').state;
    return s;
  };
  test('newFestival / checkEvent: valores por defecto y errores', () => {
    const r = C.newFestival({ nombre: '  Fiesta  ', fechaInicio: '2026-07-10', fechaFin: '2026-07-11' });
    ok(r.ok); eq(r.state.event.nombre, 'Fiesta'); eq(r.state.event.dayCutoff, '06:00'); eq(r.state.event.callMins, 15);
    deq(r.state.artists, []); deq(C.eventDays(r.state), ['2026-07-10', '2026-07-11']);
    ok(!C.newFestival({ nombre: '', fechaInicio: '2026-07-10' }).ok);
    ok(!C.newFestival({ nombre: 'X', fechaInicio: '2026-07-11', fechaFin: '2026-07-10' }).ok, 'fin antes que inicio');
    ok(!C.newFestival({ nombre: 'X', fechaInicio: '2026-07-10', dayCutoff: '29:00' }).ok);
    ok(!C.newFestival({ nombre: 'X', fechaInicio: '2026-07-10', callMins: 0 }).ok);
    eq(C.newFestival({ nombre: 'X', fechaInicio: '2026-07-10' }).state.event.fechaFin, '2026-07-10', 'un solo día');
  });
  test('Dec. 124: eventos de temporada hasta 120 jornadas (antes 31)', () => {
    eq(C.MAX_DAYS, 120);
    const r = C.newFestival({ nombre: 'Temporada', fechaInicio: '2026-06-01', fechaFin: '2026-09-28' });   // 120 días justos
    ok(r.ok, r.error); const d = C.eventDays(r.state);
    eq(d.length, 120); eq(d[0], '2026-06-01'); eq(d[119], '2026-09-28');
    const mas = C.newFestival({ nombre: 'Demasiado', fechaInicio: '2026-06-01', fechaFin: '2026-09-29' });
    ok(!mas.ok); eq(mas.error, 'Máximo 120 jornadas.');
    ok(C.newFestival({ nombre: 'Mes y medio', fechaInicio: '2026-06-01', fechaFin: '2026-07-15' }).ok, 'más de 31 ya vale');
    eq(C.eventDays({ event: { fechaInicio: '2026-06-01', fechaFin: '2027-06-01' } }).length, 120, 'datos fuera de rango: nunca más de 120');
  });
  test('escenarios: añadir, nombre repetido, color, mover, borrar solo si está vacío', () => {
    const s = mkFest();
    deq(s.escenarios.map(e => e.id + ':' + e.nombre), ['esc1:Principal', 'esc2:Carpa']);
    eq(s.escenarios[1].color, '#4fc3f7');
    ok(!C.addStage(s, 'principal').ok, 'repetido sin distinguir mayúsculas');
    eq(C.moveStage(s, 'esc2', -1).state.escenarios[0].id, 'esc2');
    ok(!C.moveStage(s, 'esc1', -1).ok);
    eq(C.updateStage(s, 'esc1', { nombre: 'Grande', color: '#123456' }).state.escenarios[0].nombre, 'Grande');
    ok(!C.updateStage(s, 'esc1', { nombre: 'Carpa' }).ok);
    const s2 = C.addArtist(s, 'show', { nombre: 'A', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '20:00', fin: '21:00' }).state;
    ok(!C.removeStage(s2, 'esc1').ok, 'con bandas no'); ok(C.removeStage(s2, 'esc2').ok);
  });
  test('addArtist: crea con su horario; duración calcula el fin; errores por campo', () => {
    const s = mkFest();
    const r = C.addArtist(s, 'show', { nombre: 'Banda', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '2130', duracion: '75', call: '21:00', notas: ' ojo ' });
    ok(r.ok); eq(r.id, 1);
    const a = r.state.artists[0];
    eq(a.fecha, '2026-07-10'); eq(a.inicio, '21:30'); eq(a.fin, '22:45'); eq(a.showtimeCall, '21:00'); eq(a.notas, 'ojo');
    eq(C.buildBlocks(r.state, {}).length, 1);
    eq(C.addArtist(r.state, 'show', { nombre: 'Otra', escenarioId: 'esc2', jornada: '2026-07-10', inicio: '22:00' }).id, 2);
    eq(C.addArtist(s, 'show', { nombre: '', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00' }).field, 'nombre');
    eq(C.addArtist(s, 'show', { nombre: 'X', escenarioId: '', jornada: '2026-07-10', inicio: '21:00' }).field, 'escenario');
    eq(C.addArtist(s, 'show', { nombre: 'X', escenarioId: 'esc1', jornada: '', inicio: '21:00' }).field, 'jornada');
    eq(C.addArtist(s, 'show', { nombre: 'X', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '' }).field, 'inicio');
    eq(C.addArtist(s, 'show', { nombre: 'X', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '22:00', duracion: '30' }).field, 'fin', 'fin y duración no cuadran');
    ok(C.addArtist(s, 'show', { nombre: 'X', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '21:00', fin: '21:30', duracion: '30' }).ok, 'si cuadran, vale');
  });
  test('addArtist: JORNADA + hora de madrugada → fecha real del día siguiente (hora de corte)', () => {
    const r = C.addArtist(mkFest(), 'show', { nombre: 'DJ', escenarioId: 'esc2', jornada: '2026-07-10', inicio: '02:00', duracion: '120' });
    const a = r.state.artists[0];
    eq(a.fecha, '2026-07-11'); eq(a.fin, '04:00');
    eq(C.festivalDateOf(r.state, a, false), '2026-07-10', 'sigue siendo jornada del 10');
    eq(C.buildBlocks(r.state, { day: '2026-07-10' })[0].si, at(D11, '02:00'));
  });
  test('addArtist soundcheck: escribe los campos de prueba, no los de show', () => {
    const a = C.addArtist(mkFest(), 'sc', { nombre: 'B', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '16:00', fin: '16:40', call: '15:30' }).state.artists[0];
    eq(a.soundcheckFecha, '2026-07-10'); eq(a.soundcheckInicio, '16:00'); eq(a.soundcheckCall, '15:30'); ok(!a.inicio && !a.fecha);
  });
  test('editArtist inicio: cruzar medianoche mantiene la jornada y ajusta la fecha', () => {
    const s = C.editArtist(FEST, 3, 'show', 'inicio', '00:10').state;   // Cabeza: 23:30 vie → 00:10
    eq(s.artists[2].fecha, '2026-07-11'); eq(C.festivalDateOf(s, s.artists[2], false), '2026-07-10');
    const back = C.editArtist(s, 3, 'show', 'inicio', '23:45').state;
    eq(back.artists[2].fecha, '2026-07-10');
  });
  test('editArtist jornada, nombre, escenario y color', () => {
    let s = C.editArtist(FEST, 4, 'show', 'jornada', '2026-07-11').state;   // DJ 02:00 → jornada del 11
    eq(s.artists[3].fecha, '2026-07-12');
    s = C.editArtist(s, 1, 'show', 'nombre', '  Nuevo  Nombre ').state; eq(s.artists[0].nombre, 'Nuevo Nombre');
    ok(!C.editArtist(s, 1, 'show', 'nombre', '  ').ok);
    eq(C.editArtist(s, 1, 'show', 'escenario', 'esc2').state.artists[0].escenarioId, 'esc2');
    ok(!C.editArtist(s, 1, 'show', 'escenario', 'nope').ok);
    eq(C.editArtist(s, 1, 'show', 'color', '#ABCDEF').state.artists[0].color, '#abcdef');
    ok(!('color' in C.editArtist(s, 1, 'show', 'color', '').state.artists[0]));
  });
  test('editArtist inicio sin jornada: lo pide antes (no se inventa la fecha)', () => {
    const s = C.addArtist(mkFest(), 'sc', { nombre: 'B', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '16:00' }).state;
    const r = C.editArtist(s, 1, 'show', 'inicio', '21:00');
    ok(!r.ok); eq(r.error, 'Elige primero la jornada.');
    const s2 = C.editArtist(s, 1, 'show', 'jornada', '2026-07-10').state;
    const r2 = C.editArtist(s2, 1, 'show', 'inicio', '21:00'); ok(r2.ok); eq(r2.state.artists[0].fecha, '2026-07-10');
  });
  test('jornadaOf: soundcheck sin datos propios no hereda la del show; con hora sí (formato Synapse)', () => {
    const s = C.addArtist(mkFest(), 'show', { nombre: 'A', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '00:10' }).state;
    eq(C.jornadaOf(s, s.artists[0], 'show'), '2026-07-10');
    eq(C.jornadaOf(s, s.artists[0], 'sc'), '', 'la elige el regidor');
    ok(!C.editArtist(s, 1, 'sc', 'inicio', '16:00').ok);
    eq(C.jornadaOf(FEST, { fecha: '2026-07-11', soundcheckInicio: '03:00' }, 'sc'), '2026-07-10');
  });

  test('varios días: el hueco entre la última del viernes y la primera del sábado NO es changeover', () => {
    let s = mkFest();
    s = C.addArtist(s, 'show', { nombre: 'Vie', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '23:00', fin: '01:00' }).state;
    s = C.addArtist(s, 'show', { nombre: 'Sab', escenarioId: 'esc1', jornada: '2026-07-11', inicio: '20:00', fin: '21:00' }).state;
    s = C.addArtist(s, 'show', { nombre: 'Sab2', escenarioId: 'esc1', jornada: '2026-07-11', inicio: '21:30', fin: '22:30' }).state;
    const all = C.buildBlocks(s, { day: 'all' });
    eq(all[1].jornada, '2026-07-11');
    eq(C.changeoverBefore(all, all[1]), null, 'primera del sábado: sin cambio previo');
    eq(C.changeoverBefore(all, all[2]).mins, 30);
    deq(C.changeoversNow(all, at(D11, '12:00')), [], 'el sábado a mediodía no hay CHANGEOVER de 8 h');
  });
  test('duplicateArtist: copia escenario, color y notas; hora nueva y otra jornada', () => {
    let s = mkFest();
    s = C.addArtist(s, 'show', { nombre: 'Banda', escenarioId: 'esc2', jornada: '2026-07-10', inicio: '21:00', fin: '22:00', notas: 'Backline propio', color: '#123456' }).state;
    const r = C.duplicateArtist(s, 1, 'show', { jornada: '2026-07-11', inicio: '19:00', duracion: '45' });
    ok(r.ok); eq(r.id, 2);
    const b = r.state.artists[1];
    eq(b.nombre, 'Banda'); eq(b.escenarioId, 'esc2'); eq(b.color, '#123456'); eq(b.notas, 'Backline propio');
    eq(b.fecha, '2026-07-11'); eq(b.inicio, '19:00'); eq(b.fin, '19:45');
    ok(!C.duplicateArtist(s, 1, 'show', { jornada: '2026-07-11', inicio: '' }).ok, 'la hora la pone el regidor');
  });
  test('nextJornadaAfter: aviso solo cuando la jornada elegida terminó y hay otra con bandas', () => {
    let s = mkFest();
    s = C.addArtist(s, 'show', { nombre: 'Vie', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '23:00', fin: '01:00' }).state;
    s = C.addArtist(s, 'show', { nombre: 'Sab', escenarioId: 'esc1', jornada: '2026-07-11', inicio: '20:00', fin: '21:00' }).state;
    eq(C.nextJornadaAfter(s, 'show', '2026-07-10', at(D11, '00:30')), null, 'aún suena');
    deq(C.nextJornadaAfter(s, 'show', '2026-07-10', at(D11, '01:30')), { done: '2026-07-10', next: '2026-07-11' });
    eq(C.nextJornadaAfter(s, 'show', '2026-07-11', at(D11, '23:00')), null, 'última jornada');
    eq(C.nextJornadaAfter(s, 'show', 'all', at(D11, '01:30')), null);
  });

  test('removeArtist y diffSummary (nuevas, borradas, campos, festival)', () => {
    let s = C.removeArtist(FEST, 2).state;
    eq(s.artists.length, 3); eq(FEST.artists.length, 4);
    s = C.addArtist(Object.assign(s, {}), 'show', { nombre: 'Nueva', escenarioId: 'esc1', jornada: '2026-07-10', inicio: '20:00' }).state;
    s = C.editArtist(s, 1, 'show', 'inicio', '21:05').state;
    s = C.updateEvent(s, { nombre: 'Otro' }).state;
    const d = C.diffSummary(FEST, s);
    eq(d.added, 1); eq(d.removed, 1); eq(d.fields, 1); eq(d.festival, 1); eq(d.total, 4);
    deq(C.newArtistIds(FEST, s), [5]);
    eq(C.diffSummary(FEST, FEST).total, 0);
  });

  // ── Importar ──────────────────────────────────────────────────────────
  test('validateProject: acepta el ejemplo sin avisos y no modifica el original', () => {
    const r = C.validateProject(FEST);
    ok(r.ok); deq(r.errors, []); deq(r.warnings, []);
    ok(r.state !== FEST); r.state.artists[0].nombre = 'cambiado'; eq(FEST.artists[0].nombre, 'Los Ejemplos');
  });
  test('validateProject: JSON roto, sin artistas, horas y escenarios malos', () => {
    ok(!C.validateProject('{roto').ok); ok(!C.validateProject({ event: {} }).ok);
    const r = C.validateProject({ artists: [{ nombre: 'Z', fecha: '2026-07-10', inicio: '25:00', escenarioId: 'nope' }] });
    ok(r.ok); eq(r.warnings.length, 2);
    const r2 = C.validateProject(JSON.stringify({ artists: [{ nombre: 'Y', inicio: '21:00' }] }));
    ok(r2.ok); eq(r2.warnings.length, 1, 'show sin fecha');
  });

  // ── Tipos de entrada y vista Jornada completa ──────────────────────
  const DIA = JSON.parse(JSON.stringify(FEST));
  DIA.artists.push(
    { id: 10, nombre: 'Puertas', showtimeTipo: 'hito', escenarioId: '', fecha: '2026-07-10', inicio: '19:30', fin: '', notas: '' },
    { id: 11, nombre: 'Curfew', showtimeTipo: 'hito', escenarioId: '', fecha: '2026-07-11', inicio: '04:30', fin: '05:00', notas: '' },
    { id: 12, nombre: 'Comida técnicos', showtimeTipo: 'tarea', escenarioId: 'esc1', fecha: '2026-07-10', inicio: '14:00', fin: '23:59', notas: '' }
  );
  const ALL = C.buildBlocks(DIA, { mode: 'all', day: '2026-07-10' });

  test('tipos: tipoOf y entersMode (tareas e hitos solo en Jornada completa)', () => {
    eq(C.tipoOf(DIA.artists[0]), 'banda'); eq(C.tipoOf(DIA.artists[4]), 'hito'); eq(C.tipoOf({ showtimeTipo: 'raro' }), 'banda');
    ok(!C.entersMode(DIA.artists[6], 'show')); ok(!C.entersMode(DIA.artists[6], 'sc')); ok(C.entersMode(DIA.artists[6], 'all'));
    eq(C.buildBlocks(DIA, { mode: 'show', day: 'all' }).length, 4, 'Shows: solo conciertos');
    eq(C.buildBlocks(DIA, { mode: 'sc', day: 'all' }).length, 3, 'Soundchecks: solo pruebas');
  });
  test('Vistas Tareas y Marcadores (dec. 116): filtros puros por tipo; nunca una banda; el directo sigue con la jornada completa', () => {
    const T = C.buildBlocks(DIA, { mode: 'tarea', day: 'all' }), H = C.buildBlocks(DIA, { mode: 'hito', day: 'all' });
    deq(T.map(b => b.name), ['Comida técnicos'], 'Tareas: solo tareas'); ok(T.every(b => b.kind === 'tarea'));
    deq(H.map(b => b.name), ['Puertas', 'Curfew'], 'Marcadores: solo hitos, en orden'); ok(H.every(b => b.kind === 'hito'));
    deq(C.entriesOf(DIA, 'tarea').map(e => e.kind), ['tarea']); deq(C.entriesOf(DIA, 'hito').map(e => e.kind), ['hito', 'hito']);
    ok(C.entriesOf(DIA, 'tarea').concat(C.entriesOf(DIA, 'hito')).every(e => !e.sc), 'ningún soundcheck ni show');
    ok(C.entersMode(DIA.artists[6], 'tarea') && !C.entersMode(DIA.artists[6], 'hito'), 'la tarea entra solo en su vista');
    ok(C.entersMode(DIA.artists[4], 'hito') && !C.entersMode(DIA.artists[4], 'tarea'), 'el hito, en la suya');
    ok(!C.entersMode(DIA.artists[0], 'tarea') && !C.entersMode(DIA.artists[0], 'hito'), 'una banda no entra en ninguna');
    ok(!C.entersMode({ showtimeTipo: 'tarea', nombre: 'Sin hora' }, 'tarea'), 'sin inicio no entra (sale en Sin horario de Todo)');
    deq(C.festivalDays(DIA, 'tarea'), ['2026-07-10']); deq(C.festivalDays(DIA, 'hito'), ['2026-07-10'], 'el curfew de las 04:30 es de la jornada del 10');
    eq(C.buildBlocks(DIA, { mode: 'hito', day: '2026-07-10' }).length, 2);
    // Sin regresión en las vistas de siempre
    eq(C.buildBlocks(DIA, { mode: 'show', day: 'all' }).length, 4); eq(C.buildBlocks(DIA, { mode: 'sc', day: 'all' }).length, 3); eq(C.buildBlocks(DIA, { mode: 'all', day: 'all' }).length, 10);
    // El directo nunca filtra por tareas / marcadores
    eq(C.engineMode('tarea'), 'all'); eq(C.engineMode('hito'), 'all'); eq(C.engineMode('show'), 'show'); eq(C.engineMode('sc'), 'sc'); eq(C.engineMode('all'), 'all');
    ok(C.isKindMode('tarea') && C.isKindMode('hito') && !C.isKindMode('show') && !C.isKindMode('all'));
  });
  test('Jornada completa: shows + soundchecks + tareas + hitos, en orden y con kind/key', () => {
    eq(ALL.length, 4 + 3 + 1 + 2, 'el curfew de las 04:30 es de la jornada del 10');
    deq(ALL.slice(0, 3).map(b => b.kind), ['tarea', 'sc', 'sc']);
    ok(ALL.every(b => b.key === b.id + ':' + b.kind));
    eq(new Set(ALL.map(b => b.key)).size, ALL.length, 'claves únicas aunque una banda salga dos veces');
    const p = ALL.find(b => b.name === 'Puertas'); eq(p.sf, null, 'un hito no tiene fin'); eq(C.blockEnd(p), p.si);
    deq(C.festivalDays(DIA, 'all'), ['2026-07-10']);
  });
  test('tareas e hitos no dan solapes, changeover, CALL ni EN ESCENA', () => {
    const t = ALL.find(b => b.kind === 'tarea');
    eq(C.changeoverBefore(ALL, t), null);
    const sc1 = ALL.find(b => b.kind === 'sc' && b.name === 'Los Ejemplos');
    eq(C.changeoverBefore(ALL, sc1), null, 'la tarea del mismo escenario no cuenta como banda anterior');
    deq(C.playingNow(ALL, at(D10, '15:00')), [], 'a las 15:00 solo hay una tarea');
    deq(C.tasksNow(ALL, at(D10, '15:00')).map(b => b.name), ['Comida técnicos']);
    ok(C.callList(ALL, at(D10, '19:25'), 15, []).every(b => C.isBand(b)));
    ok(C.nextPerStage(ALL, at(D10, '15:00')).every(b => C.isBand(b)));
  });
  test('Jornada completa: changeover entre soundcheck y show del mismo escenario', () => {
    const sh = ALL.find(b => b.kind === 'show' && b.name === 'Los Ejemplos');
    const co = C.changeoverBefore(ALL, sh);
    eq(co.prev.name, 'Cabeza de Cartel'); eq(co.prev.kind, 'sc'); eq(co.mins, 120);
  });
  test('pickBlocks: sin hitos y saltando lo que ya terminó', () => {
    const r = C.pickBlocks(ALL, at(D10, '16:30'), 4);
    eq(r.list[0].name, 'Comida técnicos', 'la tarea larga va primero (empezó antes)');
    eq(r.list[1].name, 'Los Ejemplos'); ok(r.list.every(b => !b || b.kind !== 'hito'));
    const r2 = C.pickBlocks(ALL, at(D10, '19:10'), 3);
    deq(r2.list.map(b => b && b.name), ['Comida técnicos', 'Los Ejemplos', 'Banda Demo'], 'los soundchecks ya terminados no salen');
  });
  test('hitosOf: hitos de la jornada en cualquier vista', () => {
    deq(C.hitosOf(DIA, '2026-07-10').map(b => b.name), ['Puertas', 'Curfew']);
    deq(C.hitosOf(DIA, '2026-07-11'), []);
  });
  test('addArtist: hito sin fin ni escenario, tarea sin CALL', () => {
    const s0 = C.newFestival({ nombre: 'X', fechaInicio: '2026-07-10' }).state;
    const s1 = C.addStage(s0, 'Principal').state;
    const h = C.addArtist(s1, 'all', { tipo: 'hito', nombre: 'Puertas', jornada: '2026-07-10', inicio: '19:30', fin: '20:00', call: '19:00' });
    ok(h.ok, h.error); const a = h.state.artists[0];
    eq(a.showtimeTipo, 'hito'); eq(a.fin, ''); eq(a.showtimeCall, ''); eq(a.escenarioId, '');
    const t = C.addArtist(h.state, 'all', { tipo: 'tarea', nombre: 'Montaje', jornada: '2026-07-10', inicio: '10:00', duracion: '90', call: '09:45' });
    ok(t.ok, t.error); eq(t.state.artists[1].fin, '11:30'); eq(t.state.artists[1].showtimeCall, '');
    ok(!C.addArtist(s1, 'all', { nombre: 'Banda', jornada: '2026-07-10', inicio: '21:00' }).ok, 'una banda sigue pidiendo escenario');
    const sc = C.addArtist(s1, 'all', { nombre: 'Banda', modo: 'sc', escenarioId: s1.escenarios[0].id, jornada: '2026-07-10', inicio: '16:00' });
    eq(sc.state.artists[0].soundcheckInicio, '16:00', 'en Jornada completa, modo elegido: soundcheck');
  });
  test('editArtist tipo: explícito, y desde la fila de soundcheck se lleva su horario', () => {
    const r = C.editArtist(DIA, 1, 'show', 'tipo', 'tarea');
    ok(r.ok && r.changed); eq(r.state.artists[0].showtimeTipo, 'tarea');
    eq(C.editArtist(r.state, 1, 'show', 'tipo', 'banda').state.artists[0].showtimeTipo, undefined);
    ok(!C.editArtist(DIA, 1, 'sc', 'tipo', 'tarea').ok, 'con show y soundcheck: desde la fila del show');
    const s = JSON.parse(JSON.stringify(DIA)); s.artists[0].inicio = ''; s.artists[0].fin = '';
    const r2 = C.editArtist(s, 1, 'sc', 'tipo', 'tarea'); ok(r2.ok, r2.error);
    const a = r2.state.artists[0]; eq(a.inicio, '16:00'); eq(a.fin, '16:45'); eq(a.soundcheckInicio, undefined);
    ok(!C.editArtist(DIA, 1, 'show', 'tipo', 'otro').ok);
    eq(C.diffSummary(DIA, r.state).fields, 1, 'el tipo cuenta como cambio');
  });

  test('stripLabels: por estado; las tareas no corren puestos', () => {
    const r = C.pickBlocks(ALL, at(D10, '16:30'), 4);
    deq(C.stripLabels(r.list, at(D10, '16:30')), ['TAREA · EN CURSO', 'AHORA', 'SIGUIENTE', 'EN 2º LUGAR']);
    const s = C.pickBlocks(SHOW, at(D10, '21:45'), 3);
    deq(C.stripLabels(s.list, at(D10, '21:45')), ['AHORA', 'AHORA', 'SIGUIENTE'], 'dos escenarios sonando: los dos AHORA');
    deq(C.stripLabels([null], 0), ['']);
  });

  test('DELAY (LED): rojo = fija; verde por defecto; cuenta como cambio', () => {
    ok(!C.isFija(DIA.artists[0]));
    const r = C.setFija(DIA, 1, true); ok(r.ok && r.changed); ok(C.isFija(r.state.artists[0]));
    eq(C.setFija(r.state, 1, true).changed, false);
    eq(C.setFija(r.state, 1, false).state.artists[0].showtimeFija, undefined);
    eq(C.diffSummary(DIA, r.state).fields, 1);
  });
  test('changeover mínimo: del evento (15 por defecto) o de la zona', () => {
    const s0 = C.newFestival({ nombre: 'X', fechaInicio: '2026-07-10' }).state;
    eq(s0.event.coMin, 15); eq(C.coMinFor(s0, ''), 15);
    const s1 = C.updateEvent(s0, { coMin: 20 }).state; eq(C.coMinFor(s1, ''), 20);
    ok(!C.updateEvent(s0, { coMin: 500 }).ok);
    const s2 = C.addStage(s1, 'Carpa').state; const id = s2.escenarios[0].id;
    eq(C.coMinFor(s2, id), 20, 'sin valor propio: el del evento');
    const s3 = C.updateStage(s2, id, { coMin: '10' }).state; eq(C.coMinFor(s3, id), 10);
    eq(C.coMinFor(C.updateStage(s3, id, { coMin: '' }).state, id), 20, 'vacío vuelve al del evento');
    ok(!C.updateStage(s3, id, { coMin: 'abc' }).ok);
    eq(C.coMinFor(FEST, 'esc1'), 15, 'evento antiguo sin coMin');
  });

  // ── Regiduría en vivo (2c-B) ─────────────────────────────────────────
  function vivo() {
    let s = C.newFestival({ nombre: 'Vivo', fechaInicio: '2026-07-10', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const P = s.escenarios[0].id, K = s.escenarios[1].id;
    const add = d => { const r = C.addArtist(s, d.modo || 'show', Object.assign({ jornada: '2026-07-10' }, d)); if (!r.ok) throw new Error(r.error); s = r.state; return r.id; };
    const ids = {
      A: add({ nombre: 'A', escenarioId: P, inicio: '20:00', fin: '21:00' }),
      B: add({ nombre: 'B', escenarioId: P, inicio: '21:30', fin: '22:30' }),
      T: add({ tipo: 'tarea', nombre: 'Cambio luces', escenarioId: P, inicio: '22:35', fin: '22:50' }),
      C: add({ nombre: 'C', escenarioId: P, inicio: '23:00', fin: '00:00' }),
      D: add({ nombre: 'D', escenarioId: P, inicio: '00:10', fin: '00:20' }),
      H: add({ tipo: 'hito', nombre: 'Curfew', inicio: '00:30' }),
      X: add({ nombre: 'X', escenarioId: K, inicio: '22:00', fin: '23:00' })
    };
    return { s, P, K, ids };
  }
  const V = vivo();
  const blocksOf = st => C.buildBlocks(st, { mode: 'all', day: '2026-07-10' });

  test('vivo: sin registrar nada, todo en hora (pasivo)', () => {
    deq(C.driftByZone(V.s, blocksOf(V.s), at(D10, '20:30')), []);
    const a = blocksOf(V.s).find(b => b.name === 'A'); eq(a.si, a.psi); eq(a.delta, null);
  });
  // Alargar y ■ a una hora: solo con Alargar una banda puede acabar después de su hora
  const alargarHasta = (st, id, hm) => C.setReal(C.setAlargar(st, id, 'show', true).state, id, 'show', 'f', at(D10, hm)).state;
  test('vivo: ▶ tarde SIN Alargar → se para a su hora (parada automática) y no retrasa nada', () => {
    const st = C.setReal(V.s, V.ids.A, 'show', 'i', at(D10, '20:20')).state;
    const b = blocksOf(st).find(x => x.name === 'A');
    eq(b.si, at(D10, '20:20')); eq(C.fmtHM(b.sf), '21:00', 'acaba a su hora'); eq(b.delta, 20);
    eq(C.fmtHM(blocksOf(st).find(x => x.name === 'B').si), '21:30');
    eq(C.driftByZone(st, blocksOf(st), at(D10, '20:30'))[0].status, 'ontime');
    eq(C.fmtHM(blocksOf(C.setReal(V.s, V.ids.A, 'show', 'f', at(D10, '21:20')).state).find(x => x.name === 'A').sf), '21:00', 'un fin real tardío sin Alargar no cuenta');
  });
  test('vivo: con Alargar, dentro del colchón se absorbe; más allá, desborde Δ−A; adelanto → early', () => {
    let st = alargarHasta(V.s, V.ids.A, '21:08');
    let d = C.driftByZone(st, blocksOf(st), at(D10, '21:10'))[0];
    eq(d.status, 'absorb'); eq(d.A, 15); eq(d.overflow, 0); eq(d.next.name, 'B');
    st = alargarHasta(V.s, V.ids.A, '21:20');
    d = C.driftByZone(st, blocksOf(st), at(D10, '21:21'))[0];
    eq(d.status, 'overflow'); eq(d.overflow, 5);
    const e = C.setReal(V.s, V.ids.A, 'show', 'i', at(D10, '19:55')).state;
    eq(C.driftByZone(e, blocksOf(e), at(D10, '20:00'))[0].status, 'early');
  });
  const ONLY_SHOWS = { all: { sc: true, tarea: true, hito: true } };     // menú Retrasos: tareas, hitos y SC bloqueados
  const est = (st, name, now) => C.buildBlocks(st, { mode: 'all', day: '2026-07-10', now: now }).find(b => b.name === name);
  test('vivo: el desborde va al ESTIMADO, solo en su zona, sin lo bloqueado ni las rojas (que no hacen de tope); el previsto no se toca', () => {
    let st = alargarHasta(V.s, V.ids.A, '21:20');   // +20; colchón 30 − 15 = 15 → desborde 5
    st = C.setFija(st, V.ids.C, true).state;
    st = Object.assign({}, st, { showtimeBloqueos: ONLY_SHOWS });
    const n = at(D10, '21:21');
    eq(C.fmtHM(est(st, 'B', n).si), '21:35'); eq(C.fmtHM(est(st, 'B', n).psi), '21:30', 'previsto intacto');
    eq(est(st, 'B', n).push, 5);
    eq(C.fmtHM(est(st, 'Cambio luces', n).si), '22:35', 'tarea bloqueada: no se mueve');
    eq(C.fmtHM(est(st, 'C', n).si), '23:00', 'C (rojo) no se mueve');
    eq(C.fmtHM(est(st, 'D', n).si), '00:15', 'D sí: el rojo no es tope');
    eq(C.fmtHM(est(st, 'X', n).si), '22:00', 'otra zona');
    eq(est(st, 'D', n).jornada, '2026-07-10');
    const z = C.delayByZone(st, n).find(x => x.zoneId === V.P);
    eq(z.status, 'overflow'); eq(z.live, 20); eq(z.overflow, 5); eq(z.acc, 5);
  });
  test('vivo: retraso MANUAL = orden guardada; estimado sí, previsto no; avisa de choques con rojas', () => {
    let st = C.setFija(V.s, V.ids.C, true).state;
    const r = C.addRetraso(st, { minutes: 40, zone: 'all', blocked: {}, fromAbs: at(D10, '21:00'), day: '2026-07-10', at: at(D10, '20:00') });
    ok(r.moved.some(m => m.name === 'Curfew') && r.moved.some(m => m.name === 'Cambio luces') && r.moved.some(m => m.name === 'X'));
    eq(r.state.showtimeRetrasos.length, 1); eq(r.order.minutes, 40);
    eq(C.fmtHM(est(r.state, 'B', at(D10, '20:00')).si), '22:10'); eq(C.fmtHM(est(r.state, 'B', at(D10, '20:00')).psi), '21:30');
    ok(r.clashes.some(c => c.name === 'B' && c.with === 'C'), 'B (22:10–23:10) pisa a C, que está en rojo');
    deq(r.kept.map(k => k.name), ['C']);
    eq(C.addRetraso(V.s, { minutes: 10, zone: 'all', blocked: { all: { show: true, sc: true, tarea: true, hito: true } }, fromAbs: at(D10, '21:00'), day: '2026-07-10' }).moved.length, 0, 'todo bloqueado: nada');
    eq(C.diffSummary(V.s, r.state).festival, 1, 'cuenta como cambio sin exportar');
  });
  test('vivo: retraso multizona (lista de zonas; \'\' = sin zona) y bloqueos de la orden', () => {
    const r = C.addRetraso(V.s, { minutes: 10, zone: [V.K, ''], blocked: ONLY_SHOWS, extra: { hito: false }, fromAbs: at(D10, '21:00'), day: '2026-07-10' });
    deq(r.moved.map(m => m.name).sort(), ['X'], 'Carpa; el curfew (sin zona) es hito y está bloqueado');
    const r2 = C.addRetraso(V.s, { minutes: 10, zone: [V.K, ''], blocked: {}, extra: { hito: true }, fromAbs: at(D10, '21:00'), day: '2026-07-10' });
    deq(r2.moved.map(m => m.name).sort(), ['X'], 'bloqueo extra solo para esta orden');
    eq(C.addRetraso(V.s, { minutes: 10, zone: [], blocked: {}, fromAbs: at(D10, '21:00'), day: '2026-07-10' }).moved.length, 0, 'ninguna zona = nada');
  });
  test('vivo: LED por entrada por encima de su categoría (verde forzado / rojo)', () => {
    let st = C.setDelayFlag(V.s, V.ids.T, 'free').state;
    st = C.setDelayFlag(st, V.ids.B, 'lock').state;
    const r = C.addRetraso(st, { minutes: 5, zone: V.P, blocked: ONLY_SHOWS, fromAbs: at(D10, '21:00'), day: '2026-07-10' });
    deq(r.moved.map(m => m.name), ['Cambio luces', 'C', 'D']); deq(r.kept.map(k => k.name), ['B']);
    eq(C.setDelayFlag(st, V.ids.T, null).state.artists.find(a => a.id === V.ids.T).showtimeLibre, undefined, 'null: vuelve a seguir a su categoría');
    eq(C.fieldValue(st.artists.find(a => a.id === V.ids.T), 'show', 'fija'), 'libre');
  });
  test('vivo: un retraso manual no mueve lo que ya había empezado', () => {
    const st = C.setReal(V.s, V.ids.B, 'show', 'i', at(D10, '21:31')).state;
    eq(C.addRetraso(st, { minutes: 5, zone: 'all', blocked: {}, fromAbs: at(D10, '21:00'), day: '2026-07-10', at: at(D10, '21:40') }).moved.some(m => m.name === 'B'), false);
  });
  test('vivo: ALARGAR — en directo gasta el colchón y, pasado, cada minuto suma al estimado hasta ■', () => {
    const st = C.setAlargar(V.s, V.ids.A, 'show', true).state;
    eq(C.fmtHM(est(st, 'B', at(D10, '21:10')).si), '21:30', 'A +10: cabe en el colchón (15)');
    eq(est(st, 'A', at(D10, '21:10')).live, true); eq(C.fmtHM(est(st, 'A', at(D10, '21:10')).sf), '21:10');
    eq(C.fmtHM(est(st, 'B', at(D10, '21:22')).si), '21:37', 'A +22: desborda 7');
    eq(C.fmtHM(est(st, 'C', at(D10, '21:22')).si), '23:07', 'y arrastra a lo que viene de la zona');
    const fin = C.setReal(st, V.ids.A, 'show', 'f', at(D10, '21:22')).state;
    eq(C.fmtHM(est(fin, 'B', at(D10, '23:59')).si), '21:37', 'tras ■ se queda fijo');
    eq(C.fmtHM(est(V.s, 'B', at(D10, '21:22')).si), '21:30', 'sin Alargar no se suma nada en directo (sin ■ acaba a su hora)');
  });
  test('vivo: recuperación — si la siguiente arranca ANTES de lo estimado, el retraso baja (nunca por debajo de lo previsto); acabar antes no adelanta', () => {
    let st = alargarHasta(V.s, V.ids.A, '21:30');     // +30 → desborde 15
    eq(C.fmtHM(est(st, 'B', at(D10, '21:31')).si), '21:45'); eq(C.fmtHM(est(st, 'C', at(D10, '21:31')).si), '23:15');
    st = C.setReal(st, V.ids.B, 'show', 'i', at(D10, '21:38')).state;           // B ▶ 7 min antes de lo estimado
    eq(C.fmtHM(est(st, 'C', at(D10, '21:38')).si), '23:08', 'el retraso baja a +8');
    const e = C.setReal(st, V.ids.B, 'show', 'f', at(D10, '22:00')).state;     // B acaba muy pronto
    eq(C.fmtHM(est(e, 'C', at(D10, '22:00')).si), '23:08', 'acabar antes no adelanta a C');
    const t = C.setReal(st, V.ids.B, 'show', 'i', null).state;
    eq(C.fmtHM(est(C.setReal(t, V.ids.B, 'show', 'i', at(D10, '21:20')).state, 'C', at(D10, '21:20')).si), '23:00', 'nunca antes de lo previsto');
  });
  test('vivo: márgenes de hitos con el retraso arrastrado (ámbar < 15, rojo rebasado)', () => {
    let m = C.hitoMargins(V.s, blocksOf(V.s), at(D10, '20:00'));
    eq(m.length, 1); eq(m[0].band.name, 'D'); eq(m[0].margin, 10); eq(m[0].level, 'tight');
    let st = alargarHasta(V.s, V.ids.B, '23:10');   // B alarga 40 min
    m = C.hitoMargins(st, blocksOf(st), at(D10, '23:10'));
    ok(m[0].margin < 0, 'C empuja a D más allá del curfew'); eq(m[0].level, 'over');
  });
  test('vivo: setReal borra con null; un hito no tiene hora real', () => {
    const st = C.setReal(V.s, V.ids.A, 'show', 'i', at(D10, '20:05')).state;
    eq(C.setReal(st, V.ids.A, 'show', 'i', null).state.artists[0].showtimeReal, undefined);
    ok(!C.setReal(V.s, V.ids.H, 'show', 'i', at(D10, '20:05')).ok);
  });

  // ── Ejecutar ──────────────────────────────────────────────────────────
  test('CALL: dos bandas con el mismo nombre a la misma hora en zonas distintas no comparten OK', () => {
    let s = C.newFestival({ nombre: 'x', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'A').state; s = C.addStage(s, 'B').state;
    const add = (st, n, z) => { const r = C.addArtist(st, 'show', { jornada: '2026-07-10', nombre: n, escenarioId: z, inicio: '22:00', fin: '23:00' }); if (!r.ok) throw new Error(r.error); return r.state; };
    s = add(s, 'DJ SET', s.escenarios[0].id); s = add(s, 'DJ SET', s.escenarios[1].id);
    const bl = C.buildBlocks(s, { mode: 'all', day: 'all' });
    ok(C.callKey(bl[0]) !== C.callKey(bl[1]), 'claves distintas');
    eq(C.callList(bl, C.toAbs('2026-07-10', '21:50'), 15, [C.callKey(bl[0])]).length, 1, 'un OK no quita el CALL de la otra zona');
  });
  test('Nombres numéricos en el JSON (p. ej. «1975») no rompen nada', () => {
    let s = C.newFestival({ nombre: 'x', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'A').state;
    s = C.addArtist(s, 'show', { jornada: '2026-07-10', nombre: 'tmp', escenarioId: s.escenarios[0].id, inicio: '22:00', fin: '23:00' }).state;
    s.artists[0].nombre = 1975; s.escenarios[0].nombre = 2;
    const b = C.buildBlocks(s, { mode: 'all', day: 'all' })[0];
    eq(b.name, '1975'); eq(b.stage, '2'); eq(b.name.toUpperCase(), '1975');
  });

  test('Colores: el arcoíris es para las bandas; tareas e hitos en gris de trabajo técnico (salvo color elegido a mano)', () => {
    const st = { artists: [
      { id: 1, nombre: 'Banda' }, { id: 2, nombre: 'Comida', showtimeTipo: 'tarea' }, { id: 3, nombre: 'Puertas', showtimeTipo: 'hito' },
      { id: 4, nombre: 'Montaje', showtimeTipo: 'tarea', color: '#123456' }, { id: 5, nombre: 'Otra banda' } ] };
    const col = i => C.artistColor(st, st.artists[i]);
    eq(col(0), C.ARTIST_COLORS[0]); eq(col(4), C.ARTIST_COLORS[4]);
    eq(col(1), C.TIPO_COLORS.tarea); eq(col(1), '#6b7280');
    eq(col(2), C.TIPO_COLORS.hito); eq(col(2), '#9ca3af');
    eq(col(3), '#123456', 'el color elegido a mano se respeta');
    ok(C.ARTIST_COLORS.indexOf(C.TIPO_COLORS.tarea) < 0 && C.ARTIST_COLORS.indexOf(C.TIPO_COLORS.hito) < 0, 'los grises no están en el arcoíris');
    const b = C.buildBlocks(Object.assign({ event: { fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }, escenarios: [] }, {
      artists: [{ id: 7, nombre: 'Comida', showtimeTipo: 'tarea', fecha: '2026-07-10', inicio: '14:00', fin: '15:00' }] }), { mode: 'all', day: 'all' });
    eq(b[0].color, '#6b7280', 'la Live también la pinta en gris');
  });

  test('Dec. 132: logo del evento (event.showtimeLogo) — poner, quitar, tope de tamaño, formatos; cuenta como «sin exportar» y sobrevive a «Guardar datos»', () => {
    const L = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let s = C.newFestival({ nombre: 'X', fechaInicio: '2026-10-10' }).state;
    eq(C.eventLogo(s), '', 'sin logo');
    const r = C.setEventLogo(s, L); ok(r.ok && r.changed); eq(C.eventLogo(r.state), L); eq(s.event.showtimeLogo, undefined, 'no toca el original');
    eq(C.diffSummary(s, r.state).festival, 1, 'cambio sin exportar');
    eq(C.eventLogo(C.updateEvent(r.state, { nombre: 'Y', fechaInicio: '2026-10-10' }).state), L, 'guardar los datos del evento no lo borra');
    const q = C.setEventLogo(r.state, ''); ok(q.ok && q.changed); eq('showtimeLogo' in q.state.event, false, 'quitado');
    ok(!C.setEventLogo(s, 'data:text/html;base64,PHNjcmlwdD4=').ok, 'solo imágenes');
    ok(!C.setEventLogo(s, 'https://x/y.png').ok, 'nada de enlaces externos');
    ok(C.setEventLogo(s, 'data:image/svg+xml;base64,PHN2Zy8+').ok, 'SVG sí (se pinta como <img>)');
    const big = 'data:image/png;base64,' + 'A'.repeat(C.LOGO_MAX); ok(!C.setEventLogo(s, big).ok && /demasiado grande/.test(C.setEventLogo(s, big).error), 'tope ~60 KB');
    eq(C.eventLogo({ event: { showtimeLogo: big } }), '', 'un .json con un logo enorme o raro: se ignora');
    ok(!C.setEventLogo(null, L).ok);
  });

  test('Dec. 134: las zonas nuevas no nacen rojas (paleta que empieza en azul); las que ya existen guardan su color', () => {
    eq(C.STAGE_COLORS.join(), '#38bdf8,#818cf8,#34d399,#fbbf24,#c084fc,#f472b6,#a78bfa,#2dd4bf');
    ok(!C.STAGE_COLORS.some(c => /^#(e94560|ff6363|ff3b30|ff6b6b)$/i.test(c)), 'ningún rojo');
    let s = C.newFestival({ nombre: 'X', fechaInicio: '2026-10-10' }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    eq(s.escenarios[0].color, '#38bdf8', 'la primera, azul'); eq(s.escenarios[1].color, '#818cf8');
    eq(C.addStage(s, 'Otra', '#e94560').state.escenarios[2].color, '#e94560', 'un color elegido a mano se respeta');
  });
  let pass = 0; const fails = [];
  tests.forEach(([name, fn]) => {
    try { fn(); pass++; } catch (e) { fails.push([name, e.message]); }
  });
  const summary = pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
  if (typeof module !== 'undefined' && module.exports) {
    fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m));
    console.log(summary);
    if (fails.length) process.exitCode = 1;
  } else {
    window.__TEST_RESULT__ = { pass, total: tests.length, fails };
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    document.getElementById('out').innerHTML =
      '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' +
      fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('') +
      tests.filter(([n]) => !fails.some(f => f[0] === n)).map(([n]) => '<p class="good">✓ ' + esc(n) + '</p>').join('');
  }
})();
