/* Showtime Document v1 · tiempo zonal (contrato B0 R4.3 §5.1, §5.2.2–5.2.4).
 * node --test tests/v1-time.test.js   ·   node tests/v1-time.test.js
 * Las expectativas se ejecutan además en procesos hijos con TZ=UTC, TZ=Pacific/Kiritimati y TZ=America/Los_Angeles:
 * ningún resultado puede depender de la zona del dispositivo. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('../v1/time.js');

const MAD = { timeZone: 'Europe/Madrid', dayCutoff: '06:00', callMinutes: 15 };
const iso = ms => ms === null ? null : T.formatUTC(ms);
const res = (plan, kind, ctx) => { const r = T.resolvePlan(plan, ctx || MAD, kind || 'show'); return r.ok ? { start: iso(r.start), end: iso(r.end), call: iso(r.call), callAuto: r.callAuto } : { error: r.rule }; };

// Tabla §5.2.3 (y casos de borde), con sus instantes UTC exactos
const CASES = [
  ['inicio después de medianoche', { date: '2027-07-10', start: '01:30' }, { start: '2027-07-10T23:30:00Z', end: null, call: '2027-07-10T23:15:00Z', callAuto: true }],
  ['inicio justo en el corte', { date: '2027-07-10', start: '06:00' }, { start: '2027-07-10T04:00:00Z', end: null, call: '2027-07-10T03:45:00Z', callAuto: true }],
  ['un minuto antes del corte', { date: '2027-07-10', start: '05:59' }, { start: '2027-07-11T03:59:00Z', end: null, call: '2027-07-11T03:44:00Z', callAuto: true }],
  ['fin que cruza medianoche', { date: '2027-07-10', start: '23:30', end: '00:45' }, { start: '2027-07-10T21:30:00Z', end: '2027-07-10T22:45:00Z', call: '2027-07-10T21:15:00Z', callAuto: true }],
  ['CALL que cruza medianoche', { date: '2027-07-10', start: '00:20', call: '23:50' }, { start: '2027-07-10T22:20:00Z', end: null, call: '2027-07-10T21:50:00Z', callAuto: false }],
  ['hora repetida: primera ocurrencia', { date: '2027-10-30', start: '02:30', end: '03:10', call: '02:10' }, { start: '2027-10-31T00:30:00Z', end: '2027-10-31T02:10:00Z', call: '2027-10-31T00:10:00Z', callAuto: false }],
  ['hueco: inicio inexistente', { date: '2027-03-27', start: '02:30' }, { error: 'start' }],
  ['hueco: fin inexistente', { date: '2027-03-27', start: '01:30', end: '02:15' }, { error: 'end' }],
  ['hueco: CALL inexistente', { date: '2027-03-27', start: '03:30', call: '02:30' }, { error: 'call' }],
  ['fin igual al inicio', { date: '2027-07-10', start: '22:00', end: '22:00' }, { error: 'end' }],
  ['fin igual al inicio el día del cambio de hora (23 h): sigue siendo inválido', { date: '2027-03-27', start: '23:00', end: '23:00' }, { error: 'end' }]
];

test('§5.2.3: inicio, fin y CALL con sus instantes UTC exactos (Europe/Madrid, corte 06:00)', () => {
  CASES.forEach(([name, plan, exp]) => assert.deepEqual(res(plan), exp, name));
});

test('§5.2.4: CALL automático = inicio − callMinutes (0 = a la hora); tareas y marcadores no tienen CALL', () => {
  assert.equal(res({ date: '2027-07-10', start: '22:00' }, 'show', Object.assign({}, MAD, { callMinutes: 0 })).call, '2027-07-10T20:00:00Z');
  assert.equal(res({ date: '2027-07-10', start: '22:00' }, 'soundcheck', Object.assign({}, MAD, { callMinutes: 30 })).call, '2027-07-10T19:30:00Z');
  assert.equal(res({ date: '2027-07-10', start: '22:00', end: '23:00' }, 'task').call, null);
  assert.equal(res({ date: '2027-07-10', start: '22:00' }, 'marker').call, null);
  assert.equal(res({ date: '2027-07-10', start: '22:00', call: '21:40' }).call, '2027-07-10T19:40:00Z', 'override explícito');
});

test('Corte 00:00: ninguna hora cae el día civil siguiente; corte 04:00: 03:59 sí', () => {
  assert.equal(res({ date: '2027-07-10', start: '00:30' }, 'show', Object.assign({}, MAD, { dayCutoff: '00:00' })).start, '2027-07-09T22:30:00Z');
  assert.equal(res({ date: '2027-07-10', start: '03:59' }, 'show', Object.assign({}, MAD, { dayCutoff: '04:00' })).start, '2027-07-11T01:59:00Z');
});

test('§5.1: festivalDay de un instante = fecha local, o la anterior si la hora es menor que el corte', () => {
  const fd = (s, cut) => T.festivalDay(T.parseUTC(s), 'Europe/Madrid', cut || '06:00');
  assert.equal(fd('2027-07-10T23:30:00Z'), '2027-07-10', '01:30 locales del 11 → jornada del 10');
  assert.equal(fd('2027-07-11T03:59:00Z'), '2027-07-10', '05:59 locales');
  assert.equal(fd('2027-07-11T04:00:00Z'), '2027-07-11', '06:00 locales: ya es la jornada del 11');
  assert.equal(fd('2027-07-11T03:00:00Z', '04:00'), '2027-07-11', 'con corte 04:00, las 05:00 locales son del 11');
  assert.equal(fd('2027-10-31T00:30:00Z'), '2027-10-30', 'hora repetida');
  assert.equal(T.festivalDay(T.parseUTC('2027-07-10T12:00:00Z'), 'Pacific/Kiritimati', '06:00'), '2027-07-10', 'UTC+14: 02:00 locales del 11 → jornada del 10');
  assert.equal(T.festivalDay(T.parseUTC('2027-07-10T18:00:00Z'), 'Pacific/Kiritimati', '06:00'), '2027-07-11', 'UTC+14: 08:00 locales del 11');
});

test('Formatos: fechas reales, HH:MM estrictas, UTC con Z (con o sin segundos), zonas IANA', () => {
  ['2027-02-29', '2027-13-01', '2027-1-01', '2027-04-31', '27-07-10', ''].forEach(d => assert.equal(T.isDate(d), false, d));
  ['2028-02-29', '2027-07-10'].forEach(d => assert.equal(T.isDate(d), true, d));
  ['24:00', '7:00', '07:60', '0700', ''].forEach(h => assert.equal(T.isHM(h), false, h));
  ['00:00', '23:59'].forEach(h => assert.equal(T.isHM(h), true, h));
  assert.equal(T.parseUTC('2027-07-10T20:03Z'), Date.UTC(2027, 6, 10, 20, 3));
  ['2027-07-10T20:03:00', '2027-07-10T20:03:00+02:00', '2027-07-10T20:03:00.000Z', '2027-02-30T00:00:00Z', '2027-07-10T24:00:00Z'].forEach(s => assert.equal(T.parseUTC(s), null, s));
  assert.equal(T.formatUTC(Date.UTC(2027, 6, 10, 20, 3)), '2027-07-10T20:03:00Z');
  ['Europe/Madrid', 'UTC', 'America/Argentina/Buenos_Aires'].forEach(z => assert.equal(T.isTimeZone(z), true, z));
  ['Mars/Olympus', '+01:00', '', 'Europe/ Madrid', 42].forEach(z => assert.equal(T.isTimeZone(z), false, String(z)));
});

test('Hora repetida y hueco: occurrences devuelve 2 y 0 instantes', () => {
  assert.deepEqual(T.occurrences('2027-10-31', '02:30', 'Europe/Madrid').map(iso), ['2027-10-31T00:30:00Z', '2027-10-31T01:30:00Z']);
  assert.deepEqual(T.occurrences('2027-03-28', '02:30', 'Europe/Madrid'), []);
  assert.deepEqual(T.occurrences('2027-07-10', '22:00', 'Europe/Madrid').map(iso), ['2027-07-10T20:00:00Z']);
});

test('Los mismos resultados con cualquier zona del proceso (TZ=UTC, Pacific/Kiritimati, America/Los_Angeles)', () => {
  const code = 'const T=require(' + JSON.stringify(path.join(__dirname, '..', 'v1', 'time.js')) + ');' +
    'const C=' + JSON.stringify(CASES.map(c => c[1])) + ';const M=' + JSON.stringify(MAD) + ';' +
    'const f=x=>x===null?null:T.formatUTC(x);' +
    'process.stdout.write(JSON.stringify(C.map(p=>{const r=T.resolvePlan(p,M,"show");return r.ok?{start:f(r.start),end:f(r.end),call:f(r.call),callAuto:r.callAuto}:{error:r.rule}}).concat([T.festivalDay(Date.UTC(2027,6,10,23,30),"Europe/Madrid","06:00")])))';
  const expected = JSON.stringify(CASES.map(c => c[2]).concat(['2027-07-10']));
  ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'].forEach(tz => {
    const out = execFileSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
    assert.equal(out, expected, 'TZ=' + tz);
  });
});

test('El código no construye fechas locales implícitas', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'v1', 'time.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/new Date\(\s*['"`]/.test(src), 'sin new Date(cadena)');
  assert.ok(!/new Date\([^)]*,[^)]*\)/.test(src), 'sin new Date(año, mes, …)');
  assert.ok(!/getHours|getDate\(|getMonth\(|getFullYear\(|getTimezoneOffset|toLocale/.test(src), 'sin getters locales');
});
