/* Showtime Document v1 · motor de horario efectivo (B0-impl P2-A; contrato B0 R4.3 §5.5, §5.6.1–5.6.4, §5.6.6).
 * node --test tests/v1-schedule.test.js
 * Tablas de instantes esperados entrada por entrada. Se escriben en hora local de Madrid (julio, UTC+2) con el formato
 * 'DD HH:MM' y se comparan con las marcas UTC que devuelve el motor. Reloj siempre inyectado. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Sch = require('../v1/schedule.js');
const D = require('../v1/document.js');

const FX = n => fs.readFileSync(path.join(__dirname, 'fixtures', 'v1', n), 'utf8');
const J = n => JSON.parse(FX(n));
/** 'DD HH:MM' en Madrid (julio 2027, UTC+2) → 'YYYY-MM-DDTHH:MM:SSZ' */
const L = s => { if (s === null) return null; const [dd, hm] = s.split(' '), [h, m] = hm.split(':').map(Number); return new Date(Date.UTC(2027, 6, +dd, h - 2, m)).toISOString().replace('.000Z', 'Z'); };
const run = (doc, now, active) => Sch.compute(doc, { now: L(now), activeLiveEntryIds: active ? new Set(active) : undefined });
/** rows: [id, inicio, fin, CALL] en local; null = sin valor */
function table(res, rows, label) {
  rows.forEach(([id, s, e, c]) => {
    const x = res.byId(id);
    assert.ok(x, label + ': falta ' + id);
    assert.deepEqual([x.effective.start, x.effective.end, x.effective.call], [L(s), L(e), L(c)], label + ' · ' + id);
  });
}
const contrib = (res, id) => res.byId(id).contributions.map(c => c.delayId + ':' + c.minutes);
const held = (res, id) => res.byId(id).held.map(h => h.delayId + ':' + h.reason);

// ── 1 ── Pureza ─────────────────────────────────────────────────────────
test('1 · pureza: no muta el documento ni activeLiveEntryIds; misma entrada → mismo resultado', () => {
  const doc = J('v1-schedule-overtime.showtime'), before = JSON.stringify(doc);
  const act = new Set(['o1']);
  const a = Sch.compute(doc, { now: L('10 23:05'), activeLiveEntryIds: act });
  const b = Sch.compute(doc, { now: Date.parse(L('10 23:05')), activeLiveEntryIds: ['o1'] });
  assert.equal(JSON.stringify(doc), before, 'documento intacto');
  assert.deepEqual(Array.from(act), ['o1'], 'activeLiveEntryIds intacto');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'ms o ISO: idéntico');
  assert.deepEqual(a.entries.map(e => e.id), doc.festival.project.entries.map(e => e.id), 'resultado en el orden de entries[]');
  assert.throws(() => Sch.compute(doc, {}), /now/);
  assert.throws(() => Sch.compute(doc, { now: '2027-07-10T20:00:00' }), /now/);
  const bad = J('v1-schedule-overtime.showtime'); bad.festival.project.delays[0].minutes = 5;
  assert.throws(() => Sch.compute(bad, { now: L('10 20:00') }), /no válido/);
});

// ── 2 ── delay ordinario ────────────────────────────────────────────────
test('2 · delay: scope {}, por zonas, includeUnzoned, fromAt, foto blockPolicy, free, fixed y ya empezada', () => {
  const r = run(J('v1-schedule-delay.showtime'), '10 20:00');
  table(r, [
    ['a0', '10 19:02', '10 19:45', '10 18:47'],   // ▶ 19:02 antes de d1 (19:30) y antes de su «desde» (a1, 20:00): no se mueve; su CALL va con su ▶
    ['a1', '10 20:10', '10 21:10', '10 19:55'],   // d1 +10
    ['a2', '10 21:40', '10 23:10', '10 21:10'],   // d1 +10; CALL escrito 21:00 se mueve con la entrada
    ['a3', '10 23:00', '11 00:00', '10 22:45'],   // fixed
    ['a4', '11 00:40', '11 01:40', '11 00:25'],   // free (y de la jornada del 10 aunque sea el día civil 11)
    ['b0', '10 20:40', '10 21:00', '10 20:25'],   // d1 +10; queda antes del fromAt de d2
    ['t3', '10 21:05', '10 21:15', null],         // 20:55 + d1 = 21:05, establemente ANTES de b1 (21:10, fromAt de d2): d2 no la alcanza (R4.4-1.5)
    ['b1', '10 21:15', '10 22:15', '10 21:00'],   // d1 +10, d2 +5
    ['t1', '10 21:10', '10 21:40', null],         // d1 +10; d2 la bloquea su máscara unzoned
    ['k1', '10 22:05', null, null],               // d1 bloqueado por all.marker; d2 +5 (unzoned.marker false)
    ['k3', '10 21:25', null, null],               // marcador de principal: stages.main.marker false sustituye a all
    ['t2', '10 22:00', '10 23:00', null],         // stages.main.task true; sin fin → 60 min estimados
    ['n1', '11 20:00', '11 21:00', '11 19:45']    // otra jornada: ningún delay de la del 10 la alcanza
  ], 'delay');
  assert.deepEqual(held(r, 'a0'), [], 'R4.4: d1 va «desde a1» (20:00); a0 (19:00) queda fuera del alcance, no retenida');
  // Lo empezado no se mueve (§5.6.3-2), con la B de R4.4: si a1 ya había dado ▶ cuando se dio d1, queda retenida y lo demás sigue
  const begun = J('v1-schedule-delay.showtime'); begun.festival.project.entries[0].actual = { startedAt: L('10 19:20') };
  const q = run(begun, '10 20:00');
  assert.deepEqual(held(q, 'a1'), ['d1:started']); assert.equal(q.byId('a1').effective.start, L('10 19:20'));
  // C2 (R4.4-4): a1 es la B de d1 y empezó antes de su base (20:00) → retraso real 0 → d1 queda con residual 0 para todas sus afectadas
  assert.deepEqual(contrib(q, 'a2'), ['d1:0']); assert.equal(q.byId('a2').effective.start, L('10 21:30'));
  assert.deepEqual(q.byId('a2').contributions[0].recoveredMinutes, 10);
  assert.deepEqual(held(r, 'a3'), ['d1:fixed']);
  assert.deepEqual(contrib(r, 'a4'), ['d1:10']);
  assert.deepEqual(contrib(r, 'b1'), ['d1:10', 'd2:5']);
  assert.deepEqual(contrib(r, 't3'), ['d1:10'], 't3 no recibe d2: queda antes de la posición estable de b1');
  assert.deepEqual(held(r, 't3'), [], 'y no es un bloqueo: simplemente no pertenece al delay');
  assert.deepEqual(held(r, 't1'), ['d2:blocked']);
  assert.equal(r.byId('t2').planned.endEstimated, true);
  assert.equal(r.byId('a2').planned.callAuto, false); assert.equal(r.byId('a1').planned.callAuto, true);
  // Choque: la fija queda pisada por la banda anterior movida; se marca, no se corrige
  assert.deepEqual(r.byId('a3').clash, { withEntryId: 'a2' });
  assert.equal(r.byId('a1').clash, null);
});

// ── 3 ── máscaras ───────────────────────────────────────────────────────
test('3 · máscaras: zona y unzoned sustituyen a all por completo; el menú actual no cambia una foto ya aplicada', () => {
  const doc = J('v1-schedule-delay.showtime');
  const base = run(doc, '10 20:00');
  // Cambiar el menú de Retrasos de la configuración no altera ningún ajuste ya aplicado
  doc.festival.configuration = { operations: { delayBlocks: { all: { show: true, soundcheck: true, task: true, marker: true }, stages: {}, unzoned: { show: true, soundcheck: true, task: true, marker: true } } } };
  assert.deepEqual(JSON.parse(JSON.stringify(run(doc, '10 20:00').entries)), JSON.parse(JSON.stringify(base.entries)));
  // Sin la máscara de principal, all (marker true, task false) vuelve a mandar en esa zona: nunca se mezclan campos
  const noMain = J('v1-schedule-delay.showtime'); noMain.festival.project.delays[0].blockPolicy.stages = {};
  const r = run(noMain, '10 20:00');
  assert.deepEqual(held(r, 'k3'), ['d1:blocked'], 'marcador de principal ahora bloqueado por all');
  assert.deepEqual(contrib(r, 't2'), ['d1:10'], 'tarea de principal ahora movida por all');
  // Una máscara de zona con todo en false mueve aunque all lo bloquee todo
  const allBlocked = J('v1-schedule-delay.showtime');
  allBlocked.festival.project.delays[0].blockPolicy = { all: { show: true, soundcheck: true, task: true, marker: true }, stages: { main: { show: false, soundcheck: false, task: false, marker: false } } };
  const q = run(allBlocked, '10 20:00');
  assert.deepEqual(contrib(q, 'a1'), ['d1:10']); assert.deepEqual(contrib(q, 't2'), ['d1:10']);
  assert.deepEqual(held(q, 'b0'), ['d1:blocked'], 'carpa sin máscara propia: all');
  assert.deepEqual(held(q, 'a4'), [], 'free se mueve aunque su máscara bloquee'); assert.deepEqual(contrib(q, 'a4'), ['d1:10']);
  // Foto que cita una zona ya borrada: válida e inocua
  const ghost = J('v1-schedule-delay.showtime'); ghost.festival.project.delays[0].blockPolicy.stages.borrada = { show: true, soundcheck: true, task: true, marker: true };
  assert.deepEqual(JSON.parse(JSON.stringify(run(ghost, '10 20:00').entries)), JSON.parse(JSON.stringify(base.entries)));
});

// ── 4 ── orden determinista ─────────────────────────────────────────────
test('4 · desempate: mismo inicio, categoría y zona → manda la posición en entries[]; invertirla invierte el resultado', () => {
  const doc = J('v1-schedule-stretch.showtime');
  const r = run(doc, '10 20:00');
  assert.deepEqual(r.zones.find(z => z.stageId === 'main').order, ['s1', 'tk', 'mk', 's2', 's2b', 'tk2', 's3', 's6', 's5']);
  assert.equal(r.byId('s2b').effective.start, L('10 21:40'), 's2b va detrás del destino (posición 9 > 1): se mueve');
  const inv = J('v1-schedule-stretch.showtime'), E = inv.festival.project.entries;
  const i = E.findIndex(e => e.id === 's2'), j = E.findIndex(e => e.id === 's2b');
  [E[i], E[j]] = [E[j], E[i]];
  const before = JSON.stringify(inv);
  const q = run(inv, '10 20:00');
  assert.deepEqual(q.zones.find(z => z.stageId === 'main').order.slice(3, 5), ['s2b', 's2']);
  assert.equal(q.byId('s2b').effective.start, L('10 21:30'), 'ahora va delante del destino: no se mueve');
  assert.equal(q.byId('s2').effective.start, L('10 21:40'));
  assert.equal(JSON.stringify(inv), before, 'calcular no reordena entries[]');
  // Ordenar la salida para mostrarla no afecta al cálculo siguiente
  q.entries.sort((a, b) => a.id < b.id ? -1 : 1);
  assert.deepEqual(run(inv, '10 20:00').entries.map(e => e.id), inv.festival.project.entries.map(e => e.id));
  // Empate banda / tarea / marcador al mismo inicio: banda → tarea → marcador
  const cat = J('v1-schedule-stretch.showtime');
  cat.festival.project.entries.push({ id: 'zz-m', kind: 'marker', name: 'M', plan: { stageId: 'main', date: '2027-07-10', start: '20:00' } },
    { id: 'zz-t', kind: 'task', name: 'T', plan: { stageId: 'main', date: '2027-07-10', start: '20:00' } });
  assert.deepEqual(run(cat, '10 20:00').zones.find(z => z.stageId === 'main').order.slice(0, 3), ['s1', 'zz-t', 'zz-m']);
});

// ── 5 ── hechos reales ──────────────────────────────────────────────────
test('5 · hechos reales: ▶ manda; empezar tarde no alarga; ■ antes acaba antes, ■ después no alarga sin Tiempo extra', () => {
  const doc = J('v1-schedule-actual.showtime');
  const r = run(doc, '10 22:00');
  table(r, [
    ['r1', '10 19:55', '10 20:50', '10 19:40'],   // ▶ 5 min antes, ■ antes del estimado
    ['r2', '10 21:40', '10 22:30', '10 21:25'],   // ▶ 10 tarde y ■ 22:50: para a su hora (22:30)
    ['r3', '10 22:50', '10 23:50', '10 22:35'],   // ▶ 10 antes, sin ■: su fin se adelanta con ella
    ['tk', '10 21:05', '10 21:30', null],         // tarea: ▶ y ■ reales
    ['tk2', '10 22:10', '10 23:10', null]         // tarea sin fin escrito: ▶ + 60 estimados
  ], 'hechos');
  assert.equal(r.byId('r2').startDeltaMinutes, 10); assert.equal(r.byId('r1').startDeltaMinutes, -5);
  assert.deepEqual(r.byId('r1').planned, { start: L('10 20:00'), end: L('10 21:00'), endEstimated: false, call: L('10 19:45'), callAuto: true });
  assert.ok(r.entries.every(e => e.overrun === null));
  // R2-B: tk2 (▶ 22:10, 60 min estimados) y r3 (▶ 22:50, antes de su plan) no se cruzaban en el plan (22:00–23:00 y 23:00):
  // en el efectivo sí → choque nuevo de la tarea con la banda. El resto, sin choque.
  assert.deepEqual(r.byId('tk2').clash, { withEntryId: 'r3' });
  assert.ok(r.entries.filter(e => e.id !== 'tk2').every(e => e.clash === null));
});

// ── 6 ── changeover del colchón ─────────────────────────────────────────
test('6 · colchón de Tiempo extra/Bis: changeover de la zona si existe; si no, el del evento', () => {
  const r = run(J('v1-schedule-overtime.showtime'), '10 20:30', ['o1']);
  assert.equal(r.byId('o1').overrun.cushionMinutes, 15, 'principal: evento 15 · hueco 30 − 15');
  assert.equal(r.byId('p1').overrun.cushionMinutes, 10, 'carpa: override 30 · hueco 40 − 30');
  assert.equal(r.byId('p2').effective.start, L('10 22:20'), 'Bis 50 − colchón 10 = 40');
  const noOverride = J('v1-schedule-overtime.showtime'); delete noOverride.festival.project.stages[1].changeoverMinutes;
  const q = run(noOverride, '10 20:30', ['o1']);
  assert.equal(q.byId('p1').overrun.cushionMinutes, 25, 'carpa hereda el del evento: 40 − 15');
  assert.equal(q.byId('p2').effective.start, L('10 22:05'), '50 − 25 = 25');
  const zero = J('v1-schedule-overtime.showtime'); zero.festival.project.stages[0].changeoverMinutes = 0;
  assert.equal(run(zero, '10 20:30', ['o1']).byId('o1').overrun.cushionMinutes, 30);
});

// ── 7 ── changeover-stretch ─────────────────────────────────────────────
test('7 · changeover-stretch: destino y lo posterior movible de su zona y jornada; lo de dentro del cambio y otras zonas no', () => {
  const r = run(J('v1-schedule-stretch.showtime'), '10 20:00');
  table(r, [
    ['s1', '10 20:00', '10 21:00', '10 19:45'],
    ['tk', '10 21:00', '10 21:20', null],         // dentro del cambio, antes del destino
    ['mk', '10 21:15', null, null],
    ['s2', '10 21:40', '10 22:40', '10 21:25'],   // destino +10
    ['s2b', '10 21:40', '10 21:55', '10 21:25'],
    ['tk2', '10 22:50', '10 23:50', null],
    ['s3', '10 23:00', '11 00:00', '10 22:45'],   // fixed
    ['s6', '10 23:10', '10 23:40', '10 22:55'],
    ['s4', '10 21:30', '10 22:30', '10 21:15'],   // otra zona
    ['s5', '11 21:30', '11 22:30', '11 21:15']    // otra jornada
  ], 'stretch');
  assert.deepEqual(contrib(r, 's2'), ['x1:10']); assert.equal(r.byId('s2').contributions[0].kind, 'changeover-stretch');
  assert.deepEqual(held(r, 's3'), ['x1:fixed']); assert.equal(r.byId('s3').clash, null, 'la anterior (s2b) acaba antes: sin choque');
});

// ── 8 ── overtime / bis con y sin directo activo ────────────────────────
test('8 · Tiempo extra activo: crece con el reloj (umbral +60/+120); sin directo activo = 0; con ■ queda fijo', () => {
  const doc = J('v1-schedule-overtime.showtime');
  const steps = [
    ['10 20:30', 0, null, [['o1', '10 20:00', '10 21:00', '10 19:45'], ['ot', '10 21:10', '10 21:20', null], ['o2', '10 21:30', '10 22:30', '10 21:15'], ['o3', '10 23:00', '11 00:00', '10 22:45']]],
    ['10 21:20', 20, null, [['o1', '10 20:00', '10 21:20', '10 19:45'], ['ot', '10 21:20', '10 21:30', null], ['o2', '10 21:35', '10 22:35', '10 21:20'], ['o3', '10 23:05', '11 00:05', '10 22:50']]],
    ['10 22:00', 60, 60, [['o1', '10 20:00', '10 22:00', '10 19:45'], ['ot', '10 22:00', '10 22:10', null], ['o2', '10 22:15', '10 23:15', '10 22:00'], ['o3', '10 23:45', '11 00:45', '10 23:30']]],
    ['10 23:05', 125, 120, [['o1', '10 20:00', '10 23:05', '10 19:45'], ['ot', '10 23:05', '10 23:15', null], ['o2', '10 23:20', '11 00:20', '10 23:05'], ['o3', '11 00:50', '11 01:50', '11 00:35']]]
  ];
  steps.forEach(([now, excess, threshold, rows]) => {
    const r = run(doc, now, ['o1']);
    const ov = r.byId('o1').overrun;
    assert.deepEqual([ov.state, ov.excessMinutes, ov.thresholdMinutes, ov.crossedCutoff], ['growing', excess, threshold, false], 'reloj ' + now);
    assert.equal(ov.endWithoutOverrun, L('10 21:00'));
    table(r, rows, 'activo ' + now);
  });
  // Sin directo activo: exceso 0, nada se propaga y no hay umbral (no se reanuda solo)
  const idle = run(doc, '10 23:05');
  assert.deepEqual([idle.byId('o1').overrun.state, idle.byId('o1').overrun.excessMinutes, idle.byId('o1').overrun.thresholdMinutes], ['idle', 0, null]);
  table(idle, [['o1', '10 20:00', '10 21:00', '10 19:45'], ['o2', '10 21:30', '10 22:30', '10 21:15'], ['o3', '10 23:00', '11 00:00', '10 22:45']], 'inactivo');
  // Con ■ el exceso queda fijo, esté o no activo y sea cual sea el reloj
  const closed = J('v1-schedule-overtime.showtime'); closed.festival.project.entries[0].actual.endedAt = L('10 21:40');
  [['10 21:45', ['o1']], ['11 03:00', ['o1']], ['11 03:00', []]].forEach(([now, act]) => {
    const r = run(closed, now, act);
    assert.deepEqual([r.byId('o1').overrun.state, r.byId('o1').overrun.excessMinutes, r.byId('o1').overrun.thresholdMinutes], ['closed', 40, null]);
    table(r, [['o1', '10 20:00', '10 21:40', '10 19:45'], ['ot', '10 21:40', '10 21:50', null], ['o2', '10 21:55', '10 22:55', '10 21:40'], ['o3', '10 23:25', '11 00:25', '10 23:10']], 'cerrado ' + now);
  });
  // Bis con ■ (carpa): fijo; ▶ temprano de p3 recupera arrastre, nunca por debajo del plan
  const r = run(doc, '10 20:30');
  assert.deepEqual([r.byId('p1').overrun.kind, r.byId('p1').overrun.state, r.byId('p1').overrun.excessMinutes], ['bis', 'closed', 50]);
  table(r, [['p1', '10 20:00', '10 21:50', '10 19:45'], ['p2', '10 22:20', '10 23:20', '10 22:05'], ['p3', '10 23:05', '11 00:05', '10 22:50'], ['p4', '11 00:35', '11 01:35', '11 00:20']], 'bis');
  assert.deepEqual(contrib(r, 'p4'), ['bi1:5'], 'p3 empezó 35 min antes de lo estimado: solo pasan 5');
  // Un ▶ anterior incluso al plan deja el arrastre en 0, nunca negativo
  const early = J('v1-schedule-overtime.showtime'); early.festival.project.entries[6].actual.startedAt = L('10 22:55');
  assert.equal(run(early, '10 20:30').byId('p4').effective.start, L('11 00:30'));
  // Una banda posterior bloqueada por la foto del ajuste no se mueve, se marca el choque y lo siguiente sí recibe el arrastre
  const blk = J('v1-schedule-overtime.showtime'); blk.festival.project.entries[1].rules = { delayMode: 'fixed' };
  const b = run(blk, '10 23:05', ['o1']);
  assert.equal(b.byId('o2').effective.start, L('10 21:30')); assert.deepEqual(held(b, 'o2'), ['ov1:fixed']);
  assert.deepEqual(b.byId('o2').clash, { withEntryId: 'o1' });
  assert.equal(b.byId('o3').effective.start, L('11 00:50'));
});

// ── 9 ── transjornada ───────────────────────────────────────────────────
test('9 · transjornada: el exceso de una banda abierta de D alcanza su zona en D+1; ni la otra zona, ni sin zona, ni el delay genérico', () => {
  const doc = J('v1-schedule-overtime-crosses-cutoff.showtime');
  const before = run(doc, '11 05:00', ['x1']);       // antes del corte: 260 min, aún dentro del colchón (425)
  assert.deepEqual([before.byId('x1').overrun.excessMinutes, before.byId('x1').overrun.thresholdMinutes, before.byId('x1').overrun.crossedCutoff], [260, 240, false]);
  assert.equal(before.byId('x1').overrun.cushionMinutes, 425, '08:00 − 00:40 − 15');
  table(before, [['x2', '11 08:00', '11 09:00', '11 07:45']], 'antes del corte');
  const after = run(doc, '11 09:00', ['x1']);        // pasado el corte: sigue creciendo, sin tope
  assert.deepEqual([after.byId('x1').overrun.excessMinutes, after.byId('x1').overrun.thresholdMinutes, after.byId('x1').overrun.crossedCutoff], [500, 480, true]);
  table(after, [
    ['x1', '10 23:10', '11 09:00', '10 22:55'],      // g1 +10 (jornada D) y abierta hasta el reloj
    ['x2', '11 09:15', '11 10:15', '11 09:00'],      // D+1, misma zona: 500 − 425 = 75
    ['y1', '11 08:00', '11 09:00', '11 07:45'],      // otra zona: nada
    ['u1', '11 08:00', '11 08:30', null]             // sin zona: nada
  ], 'transjornada');
  assert.deepEqual(contrib(after, 'x2'), ['ox:75'], 'el delay g1 de la jornada D no alcanza D+1');
  assert.deepEqual(contrib(after, 'x1'), ['g1:10']);
  // Sin directo activo: exceso 0 y sin propagación, también pasado el corte
  const idle = run(doc, '11 09:00');
  assert.deepEqual([idle.byId('x1').overrun.state, idle.byId('x1').overrun.excessMinutes, idle.byId('x1').overrun.crossedCutoff], ['idle', 0, false]);
  table(idle, [['x1', '10 23:10', '11 00:40', '10 22:55'], ['x2', '11 08:00', '11 09:00', '11 07:45']], 'inactivo');
  // Con ■ el exceso queda fijo y D+1 conserva el retraso
  const closed = J('v1-schedule-overtime-crosses-cutoff.showtime'); closed.festival.project.entries[0].actual.endedAt = L('11 09:00');
  const c = run(closed, '11 12:00');
  assert.deepEqual([c.byId('x1').overrun.state, c.byId('x1').overrun.excessMinutes], ['closed', 500]);
  table(c, [['x2', '11 09:15', '11 10:15', '11 09:00']], 'cerrado');
  // La foto del ajuste manda también en D+1: bloqueada no se mueve y queda pisada
  const blk = J('v1-schedule-overtime-crosses-cutoff.showtime'); blk.festival.project.delays[1].blockPolicy.stages = { main: { show: true, soundcheck: false, task: false, marker: false } };
  const b = run(blk, '11 09:00', ['x1']);
  assert.equal(b.byId('x2').effective.start, L('11 08:00')); assert.deepEqual(held(b, 'x2'), ['ox:blocked']);
  assert.deepEqual(b.byId('x2').clash, { withEntryId: 'x1' });
});

// ── 10 ── nada calculado se guarda ──────────────────────────────────────
test('10 · nada calculado se guarda: serializar después de calcular deja el documento igual y sin claves de cálculo', () => {
  ['v1-schedule-delay.showtime', 'v1-schedule-stretch.showtime', 'v1-schedule-actual.showtime', 'v1-schedule-overtime.showtime', 'v1-schedule-overtime-crosses-cutoff.showtime'].forEach(f => {
    const p = D.parseDocument(FX(f)); assert.ok(p.ok, f + ': ' + p.message);
    const before = D.serializeDocument(p.doc).text;
    Sch.compute(p.doc, { now: L('11 09:00'), activeLiveEntryIds: p.doc.festival.project.entries.map(e => e.id) });
    const after = D.serializeDocument(p.doc).text;
    assert.equal(after, before, f);
    const keys = new Set(); JSON.parse(after, (k, v) => { keys.add(k); return v; });
    ['effective', 'excessMinutes', 'cushionMinutes', 'thresholdMinutes', 'crossedCutoff', 'clash', 'overrun', 'shiftMinutes', 'startDeltaMinutes', 'contributions', 'held', 'activeLiveEntryIds', 'endWithoutOverrun']
      .forEach(k => assert.ok(!keys.has(k), f + ': sin clave calculada «' + k + '»'));
  });
});

// ── 11 ── zona del proceso ──────────────────────────────────────────────
test('11 · los mismos UTC con cualquier zona del proceso (TZ=UTC, Pacific/Kiritimati, America/Los_Angeles)', () => {
  const code = 'const S=require(' + JSON.stringify(path.join(__dirname, '..', 'v1', 'schedule.js')) + ');const fs=require("fs");' +
    'const out=["v1-schedule-delay.showtime","v1-schedule-overtime.showtime","v1-schedule-overtime-crosses-cutoff.showtime","v1-schedule-recovery.showtime"].map(f=>{' +
    'const d=JSON.parse(fs.readFileSync(' + JSON.stringify(path.join(__dirname, 'fixtures', 'v1')) + '+"/"+f,"utf8"));' +
    'if(f==="v1-schedule-recovery.showtime")d.festival.project.entries[2].actual={startedAt:"2027-07-10T20:07:00Z"};' +
    'const r=S.compute(d,{now:"2027-07-11T07:00:00Z",activeLiveEntryIds:["o1","x1"]});return [r.entries,r.adjustments]});' +
    'process.stdout.write(JSON.stringify(out))';
  const outs = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'].map(tz => execFileSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }) }).toString());
  assert.equal(outs[1], outs[0]); assert.equal(outs[2], outs[0]);
  const x = JSON.parse(outs[0])[2][0].find(e => e.id === 'x2');
  assert.equal(x.effective.start, L('11 09:15'));
  assert.equal(JSON.parse(outs[0])[3][1].find(a => a.delayId === 'd1').residualMinutes, 7, 'recuperación FIFO igual en cualquier TZ');
});

test('12 · el motor no construye fechas locales implícitas ni lee el reloj', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'v1', 'schedule.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/new Date\(|Date\.now|getHours|getDate\(|getTimezoneOffset|toLocale|localStorage|performance\.now/.test(src));
});

// ══ R1 ══════════════════════════════════════════════════════════════════
test('R1-1 · delays[] se aplica en su orden: un delay posterior a un overtime ve el horario que dejó el overtime', () => {
  const r = run(J('v1-schedule-order.showtime'), '10 22:00');
  table(r, [
    ['A', '10 20:00', '10 21:50', '10 19:45'],
    ['B', '10 22:15', '10 23:15', '10 22:00'],   // +35 del overtime (50 − colchón 15) y después +10 del delay
    ['C', '10 23:45', '11 00:45', '10 23:30']
  ], 'orden');
  assert.deepEqual(contrib(r, 'B'), ['ovA:35', 'dA:10'], 'contribuciones en el orden de delays[]');
  assert.deepEqual(contrib(r, 'C'), ['ovA:35', 'dA:10']);
  assert.deepEqual(r.byId('A').contributions, [], 'A ya había empezado y empieza antes de «desde»');
  assert.equal(r.byId('A').overrun.cushionMinutes, 15);
  // Con el orden contrario (el delay antes que el overtime) el resultado es otro: el colchón se mide contra B ya retrasada
  const rev = J('v1-schedule-order.showtime'), dl = rev.festival.project.delays;
  dl[1].occurredAt = L('10 20:50');
  rev.festival.project.delays = [dl[1], dl[0]];
  const q = run(rev, '10 22:00');
  assert.equal(q.byId('A').overrun.cushionMinutes, 25, '21:40 − 21:00 − 15');
  table(q, [['B', '10 22:05', '10 23:05', '10 21:50'], ['C', '10 23:35', '11 00:35', '10 23:20']], 'orden inverso');
  assert.deepEqual(contrib(q, 'B'), ['dA:10', 'ovA:25']);
});

test('R1-2 · cadena: el colchón de un overtime posterior se mide contra el horario ya efectivo (arrastre que pasó por una fija)', () => {
  const doc = J('v1-schedule-chain.showtime');
  const r = run(doc, '10 23:30');
  table(r, [
    ['A', '10 20:00', '10 21:50', '10 19:45'],
    ['B', '10 21:30', '10 23:00', '10 21:15'],   // fija: no se mueve, deja pasar el arrastre de A
    ['C', '10 23:35', '11 00:35', '10 23:20']    // +35 de A; el overtime de B (30) cabe en su colchón (23:35 − 22:30 − 15 = 50)
  ], 'cadena');
  assert.deepEqual(held(r, 'B'), ['ovA:fixed']);
  assert.deepEqual(contrib(r, 'C'), ['ovA:35'], 'B no añade nada');
  assert.deepEqual([r.byId('B').overrun.excessMinutes, r.byId('B').overrun.cushionMinutes, r.byId('B').overrun.endWithoutOverrun], [30, 50, L('10 22:30')]);
  // Variante con Bis cerrado en B: mismo punto inicial, alcance y cálculo
  const bis = J('v1-schedule-chain.showtime'); Object.assign(bis.festival.project.delays[1], { kind: 'bis', minutes: 5, occurredAt: L('10 22:35') });
  const b = run(bis, '10 23:30');
  assert.deepEqual([b.byId('B').overrun.kind, b.byId('B').overrun.state, b.byId('B').overrun.excessMinutes, b.byId('B').overrun.cushionMinutes], ['bis', 'closed', 30, 50]);
  assert.equal(b.byId('C').effective.start, L('10 23:35'));
  // Bis abierto en B (sin ■): solo crece con directo activo y solo pasa lo que excede el colchón de 50
  const open = J('v1-schedule-chain.showtime'); delete open.festival.project.entries[1].actual.endedAt;
  Object.assign(open.festival.project.delays[1], { kind: 'bis', minutes: 5, occurredAt: L('10 22:35') });
  [['10 23:20', ['B'], 'growing', 50, null, '10 23:35'], ['10 23:40', ['B'], 'growing', 70, 60, '10 23:55'], ['10 23:40', [], 'idle', 0, null, '10 23:35']].forEach(([now, act, state, ex, th, cStart]) => {
    const q = run(open, now, act);
    assert.deepEqual([q.byId('B').overrun.state, q.byId('B').overrun.excessMinutes, q.byId('B').overrun.thresholdMinutes], [state, ex, th], 'Bis abierto ' + now + ' ' + act);
    assert.equal(q.byId('C').effective.start, L(cStart), 'C con Bis abierto ' + now + ' ' + act);
  });
});

test('R1-3 · choques: tarea fija, tarea bloqueada y banda con ▶ real quedan pisadas y se marcan; lo no pisado sigue en null', () => {
  const doc = J('v1-schedule-clash.showtime'), before = JSON.stringify(doc);
  const r = run(doc, '10 22:00');
  table(r, [
    ['A', '10 20:00', '10 21:50', '10 19:45'],
    ['tk', '10 21:10', '10 21:20', null],
    ['tk2', '10 21:15', '10 21:25', null],
    ['B', '10 21:30', '10 22:30', '10 21:15'],   // ▶ 21:30 manda aunque el overtime (20:55) la habría movido
    ['tk3', '10 22:40', '10 22:50', null],
    ['C', '10 23:00', '11 00:00', '10 22:45']    // B empezó a su hora: no pasa arrastre
  ], 'choques');
  assert.deepEqual(r.byId('tk').clash, { withEntryId: 'A' }); assert.deepEqual(held(r, 'tk'), ['ovA:fixed']);
  assert.deepEqual(r.byId('tk2').clash, { withEntryId: 'A' }); assert.deepEqual(held(r, 'tk2'), ['ovA:blocked']);
  assert.deepEqual(r.byId('B').clash, { withEntryId: 'A' }); assert.deepEqual(held(r, 'B'), [], 'no está en held: la pisa su ▶, no un bloqueo');
  assert.equal(r.byId('tk3').clash, null); assert.equal(r.byId('C').clash, null); assert.equal(r.byId('A').clash, null);
  assert.equal(JSON.stringify(doc), before, 'el choque es solo salida calculada');
  // Sin el Tiempo extra nadie queda pisado
  const none = J('v1-schedule-clash.showtime'); none.festival.project.delays = []; delete none.festival.project.entries[0].actual.endedAt;
  assert.ok(run(none, '10 22:00').entries.every(e => e.clash === null));
  // Una tarea que en el plan ya estaba dentro de la banda no es un choque nuevo
  const inside = J('v1-schedule-clash.showtime'); inside.festival.project.entries[1].plan.start = '20:30'; inside.festival.project.entries[1].plan.end = '20:40';
  assert.equal(run(inside, '10 22:00').byId('tk').clash, null);
});

test('R1-4 · Bis sin ■: mismo cálculo, umbral y alcance que el Tiempo extra; inactivo = 0', () => {
  const ov = J('v1-schedule-overtime.showtime'), bis = J('v1-schedule-overtime.showtime');
  Object.assign(bis.festival.project.delays[0], { kind: 'bis', minutes: 3, occurredAt: L('10 21:03') });
  ['10 20:30', '10 21:20', '10 22:00', '10 23:05'].forEach(now => {
    const a = run(ov, now, ['o1']), b = run(bis, now, ['o1']);
    assert.equal(b.byId('o1').overrun.kind, 'bis');
    const strip = x => JSON.parse(JSON.stringify(x.entries)).map(e => { if (e.overrun) delete e.overrun.kind; e.contributions.forEach(c => delete c.kind); e.held.forEach(h => delete h.kind); return e; });
    assert.deepEqual(strip(b), strip(a), 'Bis abierto ≡ Tiempo extra · ' + now);
  });
  assert.deepEqual([run(bis, '10 23:05', ['o1']).byId('o1').overrun.excessMinutes, run(bis, '10 23:05', ['o1']).byId('o1').overrun.thresholdMinutes], [125, 120]);
  assert.deepEqual([run(bis, '10 23:05').byId('o1').overrun.state, run(bis, '10 23:05').byId('o1').overrun.excessMinutes], ['idle', 0]);
  // Transjornada con Bis abierto
  const cross = J('v1-schedule-overtime-crosses-cutoff.showtime'); Object.assign(cross.festival.project.delays[1], { kind: 'bis', minutes: 3, occurredAt: L('11 00:43') });
  const c = run(cross, '11 09:00', ['x1']);
  assert.deepEqual([c.byId('x1').overrun.kind, c.byId('x1').overrun.excessMinutes, c.byId('x1').overrun.crossedCutoff], ['bis', 500, true]);
  table(c, [['x2', '11 09:15', '11 10:15', '11 09:00'], ['y1', '11 08:00', '11 09:00', '11 07:45'], ['u1', '11 08:00', '11 08:30', null]], 'Bis transjornada');
});

test('R1-5 · soundcheck: banda independiente en la cadena; un Show homónimo no se relaciona con él', () => {
  const r = run(J('v1-schedule-order.showtime'), '10 22:00');
  table(r, [['SC', '11 01:15', '11 01:45', '11 01:00'], ['CC', '10 23:00', '11 00:00', '10 22:45']], 'soundcheck');
  assert.deepEqual(contrib(r, 'SC'), ['ovA:35', 'dA:10']);
  assert.deepEqual(contrib(r, 'CC'), [], 'el Show «Ce» de carpa no recibe nada por llamarse igual');
  // Fijar el Show «Ce» de principal no afecta al soundcheck «Ce»: el arrastre sigue pasando
  const fx = J('v1-schedule-order.showtime'); fx.festival.project.entries[2].rules = { delayMode: 'fixed' };
  const q = run(fx, '10 22:00');
  assert.equal(q.byId('C').effective.start, L('10 23:00')); assert.equal(q.byId('SC').effective.start, L('11 01:15'));
  // Y fijar el soundcheck no afecta al Show
  const fs2 = J('v1-schedule-order.showtime'); fs2.festival.project.entries[3].rules = { delayMode: 'fixed' };
  const z = run(fs2, '10 22:00');
  assert.equal(z.byId('SC').effective.start, L('11 00:30')); assert.equal(z.byId('C').effective.start, L('10 23:45'));
  // Un soundcheck con Tiempo extra empuja igual que un show
  const sco = J('v1-schedule-order.showtime');
  sco.festival.project.entries[3].actual = { startedAt: L('11 01:15'), endedAt: L('11 02:00') };
  sco.festival.project.entries.push({ id: 'D', kind: 'show', name: 'D', plan: { stageId: 'main', date: '2027-07-10', start: '01:30', end: '02:30' } });
  sco.festival.project.delays.push({ id: 'ovSC', kind: 'overtime', occurredAt: L('11 01:40'), festivalDay: '2027-07-10', fromEntryId: 'SC', blockPolicy: { all: { show: false, soundcheck: false, task: false, marker: false }, stages: {} } });
  const s = run(sco, '11 03:00');
  // SC sin overtime acabaría 01:45; ■ 02:00 → 15. D ya va +45 (02:15): colchón 02:15 − 01:45 − 15 = 15 → no pasa nada más
  assert.deepEqual([s.byId('SC').overrun.excessMinutes, s.byId('SC').overrun.cushionMinutes], [15, 15]);
  assert.equal(s.byId('D').effective.start, L('11 02:15'));
});

// ══ R2 revisado ═════════════════════════════════════════════════════════
/* Compromiso operativo para P2-B (no implementado aquí; el motor solo calcula):
 *   Show/Soundcheck sin ▶  → Retrasar +5/+10/personalizado permitido; Tiempo extra/Bis no (el validador lo rechaza).
 *   ▶ sin ■               → Retrasar esa banda y Estirar su cambio deshabilitados (también +5/+10/personalizado en su fila);
 *                           Tiempo extra según contexto; Bis solo dentro de su ventana. Retrasar entradas futuras de la zona
 *                           es otra acción, que empieza en la próxima entrada / un fromAt futuro y nunca mueve la banda en curso.
 *   con ■                 → no se reabre ni se retrasa; las correcciones son acciones explícitas posteriores.
 * Salvaguarda en el motor: holdReason(…'started'…) no mueve lo empezado antes de cada ajuste. */
test('R2-A · Schedule.compute rechaza un Tiempo extra/Bis sin ▶ o con ▶ posterior: nunca da un horario parcial', () => {
  const noStart = J('v1-schedule-overtime.showtime'); delete noStart.festival.project.entries[0].actual;
  const lateStart = J('v1-schedule-overtime.showtime'); lateStart.festival.project.entries[4].actual.startedAt = L('10 21:10');   // bis a las 21:05
  [noStart, lateStart].forEach(doc => {
    let out = 'sin lanzar';
    assert.throws(() => { out = Sch.compute(doc, { now: L('10 22:00'), activeLiveEntryIds: ['o1', 'p1'] }); }, /no válido/);
    assert.equal(out, 'sin lanzar', 'ningún resultado parcial');
  });
  // ▶ igual a occurredAt: válido y calcula igual que con ▶ anterior
  const eq = J('v1-schedule-overtime.showtime'); eq.festival.project.entries[0].actual.startedAt = L('10 20:55');
  const r = run(eq, '10 21:20', ['o1']);
  assert.equal(r.byId('o1').effective.start, L('10 20:55'));
  assert.equal(r.byId('o1').overrun.endWithoutOverrun, L('10 21:00'), '▶ 5 min tarde: no alarga (fin estimado 21:00)');
});

test('R2-B · choque por intersección efectiva nueva: una banda con ▶ adelantado pisa la tarea anterior', () => {
  const doc = J('v1-schedule-clash-early.showtime'), before = JSON.stringify(doc);
  const r = run(doc, '10 21:30');
  table(r, [
    ['tarea', '10 21:10', '10 21:40', null],
    ['B', '10 21:20', '10 22:20', '10 21:05'],      // ▶ manda: no se corrige
    ['mk', '10 21:30', null, null]
  ], 'intersección');
  // La tarea empieza ANTES que B: la detección compara intervalos, no depende del orden por inicio
  assert.deepEqual(r.zones[0].order.slice(0, 3), ['libre', 'tarea', 'B']);
  // Varias candidatas (B 21:20–22:20 y C 21:25–22:25 la cubren): se elige la primera en el orden efectivo de la zona
  assert.deepEqual(r.byId('tarea').clash, { withEntryId: 'B' });
  assert.deepEqual(r.byId('mk').clash, { withEntryId: 'B' }, 'marcador: su punto cae dentro de B');
  assert.deepEqual(r.byId('C').clash, { withEntryId: 'B' }, 'banda contra banda: la pisada es la que empieza después');
  assert.equal(r.byId('B').clash, null);
  assert.equal(r.byId('libre').clash, null);
  assert.deepEqual(r.byId('dentro').clash, { withEntryId: 'C' }, 'C no la cubría en el plan; B sí, así que B no cuenta');
  // Negativo: sin C, «dentro» solo se cruza con B, y ya se cruzaban en el plan → no es un choque nuevo
  const noC = J('v1-schedule-clash-early.showtime'); noC.festival.project.entries.splice(2, 1);
  const q = run(noC, '10 21:30');
  assert.equal(q.byId('dentro').clash, null);
  assert.deepEqual(q.byId('tarea').clash, { withEntryId: 'B' });
  assert.equal(JSON.stringify(doc), before, 'nada se guarda en el documento');
});

// ══ C2 · recuperación derivada por ▶ de B (R4.4-1.5, R4.4-4) ═══════════════════════════════════════════════════════
// v1-schedule-recovery: main A 20:00 · T1 21:30 · B 22:00–23:00 · T2 23:10 · C 23:30 ; carpa Y 20:30 · X 22:30.
// delays[]: d1 delay +10 desde B (main+carpa, fromAt 22:00) · s1 stretch +5 antes de B · dC delay +5 desde C (main, fromAt 23:45).
// Sin ▶: B 22:15 · T2 23:25 · C 23:50 · X 22:40 · T1/A/Y fuera (establemente antes de B). Base de B = 22:00 (plan).
const REC = 'v1-schedule-recovery.showtime';
const withStart = (id, hm, extra) => { const d = J(REC); d.festival.project.entries.find(e => e.id === id).actual = { startedAt: L(hm) }; if (extra) extra(d); return d; };
const adjOf = (r, id) => r.adjustments.find(a => a.delayId === id);
const resid = r => r.adjustments.filter(a => a.residualMinutes !== undefined).map(a => a.delayId + ':' + a.residualMinutes).join(' ');

test('C2-0 · sin ▶ de B: los ajustes aplican sus minutos declarados y no hay recuperación', () => {
  const r = run(J(REC), '10 21:50');
  table(r, [['B', '10 22:15', '10 23:15', '10 22:00'], ['T2', '10 23:25', '10 23:35', null], ['C', '10 23:50', '11 00:50', '10 23:35'], ['X', '10 22:40', '10 23:40', '10 22:25'], ['T1', '10 21:30', '10 21:40', null], ['Y', '10 20:30', '10 21:15', '10 20:15']], 'sin ▶');
  assert.equal(resid(r), 'd1:10 s1:5 dC:5');
  assert.equal(adjOf(r, 'd1').recovery, null); assert.equal(adjOf(r, 'd1').recoveredMinutes, 0);
  assert.ok(r.entries.every(e => e.contributions.every(c => c.recoveredMinutes === undefined)), 'sin recuperación no hay recoveredMinutes');
});

test('C2-1 · recuperación total: B empieza en su base o antes → residual 0 de d1 y s1 en todas sus afectadas; el delay sigue declarado', () => {
  ['10 22:00', '10 21:55'].forEach(hm => {
    const doc = withStart('B', hm), before = JSON.stringify(doc);
    const r = run(doc, '10 22:30');
    table(r, [['B', hm, hm === '10 22:00' ? '10 23:00' : '10 22:55', hm === '10 22:00' ? '10 21:45' : '10 21:40'], ['T2', '10 23:10', '10 23:20', null], ['C', '10 23:35', '11 00:35', '10 23:20'], ['X', '10 22:30', '10 23:30', '10 22:15']], '▶ ' + hm);
    assert.equal(resid(r), 'd1:0 s1:0 dC:5');
    assert.deepEqual(adjOf(r, 'd1').recovery, { baseStart: L('10 22:00'), realDelayMinutes: 0, totalDeclaredMinutes: 15 });
    assert.deepEqual(r.byId('X').contributions, [{ delayId: 'd1', kind: 'delay', minutes: 0, recoveredMinutes: 10 }], 'X pertenece a d1 (carpa en scope) y recupera los 10');
    assert.equal(JSON.stringify(doc), before, 'minutes declarados y documento intactos');
    assert.deepEqual(doc.festival.project.delays.map(d => d.minutes), [10, 5, 5]);
  });
});

test('C2-2 · recuperación parcial FIFO mixta: delay +10 y stretch +5, base 22:00, ▶ 22:07 → residual d1 = 7, s1 = 0', () => {
  const r = run(withStart('B', '10 22:07'), '10 22:30');
  assert.equal(resid(r), 'd1:7 s1:0 dC:5');
  assert.deepEqual([adjOf(r, 'd1').recoveredMinutes, adjOf(r, 's1').recoveredMinutes, adjOf(r, 's1').recovery.realDelayMinutes], [3, 5, 7]);
  table(r, [['B', '10 22:07', '10 23:07', '10 21:52'], ['T2', '10 23:17', '10 23:27', null], ['C', '10 23:42', '11 00:42', '10 23:27'], ['X', '10 22:37', '10 23:37', '10 22:22']], '▶ 22:07');
  assert.deepEqual(contrib(r, 'C'), ['d1:7', 's1:0', 'dC:5'], 'dC no es de B: conserva su contribución');
  // El tramo pasa al siguiente ajuste solo cuando el primero está lleno: ▶ 22:12 → d1 10, s1 2
  const q = run(withStart('B', '10 22:12'), '10 22:30');
  assert.equal(resid(q), 'd1:10 s1:2 dC:5');
  table(q, [['T2', '10 23:22', '10 23:32', null], ['C', '10 23:47', '11 00:47', '10 23:32'], ['X', '10 22:40', '10 23:40', '10 22:25']], '▶ 22:12');
  assert.deepEqual(contrib(q, 'X'), ['d1:10'], 'X no está en el stretch: no le llega su residual');
});

test('C2-3 · sin recuperación: ▶ de B en o después de su previsión completa (22:15) conserva los +10/+5 declarados', () => {
  ['10 22:15', '10 22:20'].forEach(hm => {
    const r = run(withStart('B', hm), '10 22:30');
    assert.equal(resid(r), 'd1:10 s1:5 dC:5', hm);
    assert.equal(adjOf(r, 'd1').recovery.realDelayMinutes, 15, 'retraso real limitado al total declarado');
    table(r, [['B', hm, '10 23:15', hm === '10 22:15' ? '10 22:00' : '10 22:05'], ['T2', '10 23:25', '10 23:35', null], ['C', '10 23:50', '11 00:50', '10 23:35'], ['X', '10 22:40', '10 23:40', '10 22:25']], hm);
  });
});

test('C2-4 · scopes distintos e interzona: el delay recupera su afectada de la otra zona; el stretch nunca la toca; cada ajuste solo su residual', () => {
  const r = run(withStart('B', '10 22:03'), '10 22:30');
  assert.equal(resid(r), 'd1:3 s1:0 dC:5');
  assert.deepEqual(contrib(r, 'X'), ['d1:3'], 'carpa: solo d1 (su scope la incluía), con su residual');
  assert.deepEqual(contrib(r, 'T2'), ['d1:3', 's1:0'], 'main: d1 y el stretch, cada uno con su residual');
  assert.deepEqual(contrib(r, 'C'), ['d1:3', 's1:0', 'dC:5']);
  assert.deepEqual(contrib(r, 'Y'), [], 'Y establemente antes de B: fuera de d1 (y fuera del stretch por zona)');
  assert.deepEqual(contrib(r, 'T1'), [], 'T1 antes de B en main: fuera de d1 y dentro del cambio → fuera del stretch');
  table(r, [['X', '10 22:33', '10 23:33', '10 22:18'], ['T2', '10 23:13', '10 23:23', null], ['C', '10 23:38', '11 00:38', '10 23:23']], 'interzona');
  // Un stretch sobre B con la carpa como scope no existe: s1 solo mueve main/jornada aunque d1 incluya carpa
  const only = J(REC); only.festival.project.delays = only.festival.project.delays.filter(d => d.id !== 'd1'); only.festival.project.entries[2].actual = { startedAt: L('10 22:02') };
  const q = run(only, '10 22:30');
  assert.equal(resid(q), 's1:2 dC:5'); assert.deepEqual(contrib(q, 'X'), []); assert.equal(q.byId('T2').effective.start, L('10 23:12'));
});

test('C2-5 · entradas iniciadas, otras causas y suelos: ▶ no mueve lo iniciado, no toca ajustes ajenos a B y nunca adelanta bajo base/plan', () => {
  // C ya empezó (▶ 23:50, a su hora prevista con todo) cuando B recupera: C queda fija, T2 y X recuperan
  const r = run(withStart('B', '10 22:00', d => { d.festival.project.entries.find(e => e.id === 'C').actual = { startedAt: L('10 23:50') }; }), '10 23:55');
  assert.equal(r.byId('C').effective.start, L('10 23:50')); assert.equal(r.byId('T2').effective.start, L('10 23:10')); assert.equal(r.byId('X').effective.start, L('10 22:30'));
  assert.equal(adjOf(r, 'dC').residualMinutes, 5, 'dC es de C: con C empezada 20 min tarde respecto a su base (23:30), conserva sus 5');
  // Dos B citadas a la vez (B ▶ 22:07, C ▶ 23:50): cada base se calcula SIN sus propios ajustes y con los residuales de la otra.
  // Base de C sin dC = 23:30 + 7 (residual d1) + 0 (s1) = 23:37 → retraso real 13, limitado a los 5 de dC.
  const two = run(withStart('B', '10 22:07', d => { d.festival.project.entries.find(e => e.id === 'C').actual = { startedAt: L('10 23:50') }; }), '10 23:55');
  assert.equal(resid(two), 'd1:7 s1:0 dC:5');
  assert.deepEqual([adjOf(two, 'd1').recovery.baseStart, adjOf(two, 'dC').recovery.baseStart, adjOf(two, 'dC').recovery.realDelayMinutes], [L('10 22:00'), L('10 23:37'), 5]);
  assert.equal(two.byId('T2').effective.start, L('10 23:17'));
  // Suelo: con B ▶ muy temprano (21:41, justo tras declararse el stretch) nada baja de su plan ni de su cálculo sin los ajustes de B
  const q = run(withStart('B', '10 21:41'), '10 22:30');
  assert.equal(resid(q), 'd1:0 s1:0 dC:5');
  table(q, [['X', '10 22:30', '10 23:30', '10 22:15'], ['T2', '10 23:10', '10 23:20', null], ['C', '10 23:35', '11 00:35', '10 23:20']], 'suelo');
  assert.ok(q.entries.every(e => Date.parse(e.effective.start) >= Date.parse(e.planned.start) || e.startedAt !== null), 'solo un ▶ real puede ir antes del plan');
  // Otra B con su propio delay no cambia por la recuperación de B: dC conserva +5 aunque B recupere todo
  assert.deepEqual(contrib(q, 'C'), ['d1:0', 's1:0', 'dC:5']);
});

test('C2-6 · corrección de inicio: cambiar actual.startedAt y recalcular solo cambia el residual derivado; nada se serializa ni muta', () => {
  const doc = withStart('B', '10 22:07');
  const r1 = run(doc, '10 22:30'); assert.equal(resid(r1), 'd1:7 s1:0 dC:5');
  doc.festival.project.entries.find(e => e.id === 'B').actual.startedAt = L('10 22:03');
  const snapshot = JSON.stringify(doc);
  const r2 = run(doc, '10 22:30'); assert.equal(resid(r2), 'd1:3 s1:0 dC:5');
  assert.equal(r2.byId('T2').effective.start, L('10 23:13')); assert.equal(r2.byId('X').effective.start, L('10 22:33'));
  assert.equal(JSON.stringify(doc), snapshot, 'compute no muta');
  const text = D.serializeDocument(D.parseDocument(JSON.stringify(doc)).doc).text;
  const keys = new Set(); JSON.parse(text, (k, v) => { keys.add(k); return v; });
  ['residualMinutes', 'recoveredMinutes', 'recovery', 'declaredMinutes', 'baseStart', 'realDelayMinutes', 'adjustments'].forEach(k => assert.ok(!keys.has(k), 'no se serializa ' + k));
  assert.deepEqual(JSON.parse(text).festival.project.delays.map(d => d.minutes), [10, 5, 5], 'minutes declarados intactos');
});

test('C2-7 · pertenencia estable frente a Tiempo extra: C establemente anterior a B no entra en el delay de B aunque el arrastre de A la sitúe después', () => {
  const doc = withStart('A', '10 20:00', d => {
    d.festival.project.delays.unshift({ id: 'ov', kind: 'overtime', occurredAt: L('10 20:55'), festivalDay: '2027-07-10', fromEntryId: 'A', blockPolicy: { all: { show: false, soundcheck: false, task: false, marker: false }, stages: {} } });
  });
  const r = run(doc, '10 22:30', ['A']);   // A lleva 90 min de exceso: T1 (tarea tras A) recibe 60 → 22:30, después de B estable (22:00)
  assert.equal(r.byId('A').overrun.excessMinutes, 90);
  assert.equal(r.byId('T1').effective.start, L('10 22:30'));
  assert.deepEqual(contrib(r, 'T1'), ['ov:60'], 'T1 es establemente anterior a B (21:30 < fromAt 22:00): d1 no la alcanza');
  assert.deepEqual(contrib(r, 'B'), ['ov:45', 'd1:10', 's1:5']);
  assert.equal(r.byId('B').effective.start, L('10 23:00'));
  // La regresión C1-R1 de t3 se conserva: establemente antes de b1, no recibe d2
  const t3 = run(J('v1-schedule-delay.showtime'), '10 20:00');
  assert.deepEqual(contrib(t3, 't3'), ['d1:10']); assert.equal(t3.byId('t3').effective.start, L('10 21:05'));
});

test('C2-8 · pureza y salida: el documento y activeLiveEntryIds no mutan; adjustments y recoveredMinutes son solo salida', () => {
  const doc = withStart('B', '10 22:07'), before = JSON.stringify(doc), act = new Set(['B']);
  const r = Sch.compute(doc, { now: L('10 22:30'), activeLiveEntryIds: act });
  assert.equal(JSON.stringify(doc), before); assert.deepEqual(Array.from(act), ['B']);
  assert.deepEqual(r.adjustments.map(a => a.delayId), ['d1', 's1', 'dC'], 'en el orden de delays[]');
  assert.deepEqual(adjOf(r, 'd1'), { delayId: 'd1', kind: 'delay', fromEntryId: 'B', declaredMinutes: 10, residualMinutes: 7, recoveredMinutes: 3, recovery: { baseStart: L('10 22:00'), realDelayMinutes: 7, totalDeclaredMinutes: 15 } });
  assert.deepEqual(JSON.parse(JSON.stringify(Sch.compute(doc, { now: L('10 22:30'), activeLiveEntryIds: ['B'] }))), JSON.parse(JSON.stringify(r)), 'determinista');
});

test('C2-R1 · la base de B no depende de su propio ▶: una A anterior cerrada en Tiempo extra deja la base en 22:45 sea cual sea el ▶ de B', () => {
  // A ▶ 20:00 · ■ 22:30 · overtime a las 20:55 (exceso 90, colchón hasta B 45 → +45): sin d1/s1 y sin ▶ de B, B queda a las 22:45
  const mk = bStart => withStart('A', '10 20:00', d => {
    d.festival.project.entries.find(e => e.id === 'A').actual.endedAt = L('10 22:30');
    if (bStart) d.festival.project.entries.find(e => e.id === 'B').actual = { startedAt: L(bStart) };
    d.festival.project.delays.unshift({ id: 'ov', kind: 'overtime', occurredAt: L('10 20:55'), festivalDay: '2027-07-10', fromEntryId: 'A', blockPolicy: { all: { show: false, soundcheck: false, task: false, marker: false }, stages: {} } });
  });
  const none = run(mk(null), '10 23:00');
  assert.deepEqual(contrib(none, 'B'), ['ov:45', 'd1:10', 's1:5']); assert.equal(none.byId('B').effective.start, L('10 23:00'));
  const r40 = run(mk('10 22:40'), '10 23:00'), r50 = run(mk('10 22:50'), '10 23:00');
  assert.equal(adjOf(r40, 'd1').recovery.baseStart, L('10 22:45'), '▶ 22:40: la base conserva la causa de A');
  assert.equal(adjOf(r50, 'd1').recovery.baseStart, L('10 22:45'), '▶ 22:50: misma base');
  assert.equal(adjOf(r40, 'd1').recovery.baseStart, adjOf(r50, 'd1').recovery.baseStart, 'el ▶ de B no cambia baseStart');
  assert.equal(resid(r40), 'd1:0 s1:0 dC:5'); assert.deepEqual([adjOf(r40, 'd1').recovery.realDelayMinutes], [0]);
  assert.equal(resid(r50), 'd1:5 s1:0 dC:5'); assert.deepEqual([adjOf(r50, 'd1').recovery.realDelayMinutes], [5]);
  // B conserva su ▶; A (ya iniciada y cerrada) sigue fija; X solo recibe el residual de d1
  [[r40, '10 22:40', '10 22:30'], [r50, '10 22:50', '10 22:35']].forEach(([r, b, x]) => {
    assert.equal(r.byId('B').effective.start, L(b)); assert.deepEqual([r.byId('A').effective.start, r.byId('A').effective.end], [L('10 20:00'), L('10 22:30')]);
    assert.equal(r.byId('X').effective.start, L(x)); assert.equal(r.byId('T2').effective.start, L('10 23:15'));
  });
  // Nada se muta ni se serializa
  const doc = mk('10 22:50'), before = JSON.stringify(doc); run(doc, '10 23:00'); assert.equal(JSON.stringify(doc), before);
  const text = D.serializeDocument(D.parseDocument(before).doc).text; const keys = new Set(); JSON.parse(text, (k, v) => { keys.add(k); return v; });
  ['residualMinutes', 'recoveredMinutes', 'recovery', 'baseStart', 'adjustments'].forEach(k => assert.ok(!keys.has(k), 'no se serializa ' + k));
});
