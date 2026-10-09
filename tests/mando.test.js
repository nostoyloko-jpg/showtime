/* Tests del mando del regidor (mando.js + canal de órdenes de emision.js) — sin dependencias y sin red.
 * Ordenador:  node tests/mando.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const M = isNode ? require('../mando.js') : window.ShowtimeMando;
  const E = isNode ? require('../emision.js') : window.ShowtimeEmision;
  const Q = isNode ? require('../qr.js') : window.ShowtimeQR;
  const _ = E._, MQ = _.MQ;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function deq(a, b, msg) { eq(JSON.stringify(a), JSON.stringify(b), msg); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms, what) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 4000)) throw new Error('tiempo agotado: ' + (what || '')); await sleep(20); } }

  // ── Evento de prueba: jornada 10-jul, zona Principal y Carpa ──────────
  const JOR = '2026-07-10';
  const at = hm => C.toAbs(hm < '06:00' ? '2026-07-11' : JOR, hm);
  function fest() {
    let s = C.newFestival({ nombre: 'Prueba mando', fechaInicio: JOR, fechaFin: JOR, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const P = s.escenarios[0].id, K = s.escenarios[1].id, ids = {};
    const add = (n, d) => { const r = C.addArtist(s, d.modo || 'show', Object.assign({ jornada: JOR, nombre: n }, d)); if (!r.ok) throw new Error(n + ': ' + r.error); s = r.state; ids[n] = r.id; };
    add('Prueba A', { modo: 'sc', escenarioId: P, inicio: '17:00', fin: '17:45' });
    add('Banda A', { escenarioId: P, inicio: '20:30', fin: '21:30' });
    add('Banda B', { escenarioId: P, inicio: '22:00', fin: '23:00' });
    add('Cabeza', { escenarioId: P, inicio: '23:30', fin: '00:45' });
    add('Acústico', { escenarioId: K, inicio: '21:00', fin: '22:00' });
    add('Curfew', { tipo: 'hito', inicio: '01:30' });
    s = C.setFija(s, ids['Cabeza'], true).state;
    return { s, P, K, ids };
  }
  const key = (s, name, kind) => C.buildBlocks(s, { mode: 'all', day: 'all' }).find(b => b.name === name && (!kind || b.kind === kind)).key;
  const blk = (s, name) => C.buildBlocks(s, { mode: 'all', day: 'all' }).find(b => b.name === name);
  const CFG = { delayBlock: { all: {} } };

  // ── Mando de UNA zona (dec. 102) y chat (dec. 104) ──
  test('Mando de zona: zoneDenied deja solo lo de su zona (▶■, En hora, Alargar, CALL, retrasos, Confidence)', async () => {
    const { s, P, K } = fest(), z = (op, args) => M.zoneDenied(s, { op, args }, K);
    eq(z('start', { key: key(s, 'Acústico') }), null, 'su banda');
    ok(/solo de su zona/.test(z('stop', { key: key(s, 'Banda A') })), 'banda de otra zona');
    ok(z('onTime', { key: key(s, 'Banda B') }) && z('stretch', { key: key(s, 'Banda B'), on: true }), 'En hora / Alargar de otra zona');
    eq(z('callOk', { key: C.callKey(blk(s, 'Acústico')) }), null); ok(z('callOk', { key: C.callKey(blk(s, 'Cabeza')) }), 'CALL de otra zona');
    eq(z('delay', { zones: [K] }), null); ok(z('delay', { zones: 'all' })); ok(z('delay', { zones: [K, P] })); ok(z('delay', { zones: [P] }));
    eq(z('flash', { to: ['backstage', 'manager'] }), null, 'Manager/Backstage: de todos');
    eq(z('flash', { to: ['confidence'], zones: [K] }), null); ok(z('flash', { to: null, zones: null }), 'a todas las Confidence: no'); ok(z('flash', { to: ['confidence'], zones: [P] }));
    eq(z('flashOff', {}), null); eq(z('chat', { text: 'x' }), null);
    eq(M.zoneDenied(s, { op: 'stop', args: { key: key(s, 'Banda A') } }, null), null, 'mando general: todo');
    ok(z('start', { key: 'no-existe' }), 'banda que no existe: no');
  });
  test('Chat del mando: la orden se valida y la firma es «[Zona] Nombre»', async () => {
    eq(M.checkCmd({ op: 'chat', args: { text: 'Hola', name: 'Ana' } }), null);
    ok(M.checkCmd({ op: 'chat', args: { text: '   ' } })); ok(M.checkCmd({ op: 'chat', args: { text: 'x'.repeat(301) } })); ok(M.checkCmd({ op: 'chat', args: { text: 'x', name: 'n'.repeat(41) } }));
    eq(M.checkCmd({ op: 'chatsync', args: {} }), null);
    eq(M.chatSign('Escenario 2', 'Ana'), '[Escenario 2] Ana');
    eq(M.chatSign('Escenario 2', ''), '[Escenario 2] Stage Manager');
    eq(M.chatSign(null, 'Luis'), '[Stage Manager] Luis');
    eq(M.chatSign('Carpa', '[Admin] Pepe'), '[Carpa] Admin Pepe', 'no se pueden colar corchetes');
  });
  test('«Solo hoy»: targets usa la jornada que emite el Panel si se le pasa', async () => {
    const { s, P } = fest();
    eq(M.targets(s, P, at('20:00'), JOR).length, 4);
    eq(M.targets(s, P, at('20:00'), '2026-07-11').length, 0, 'otra jornada: nada');
  });

  // ── Qué banda se marca ────────────────────────────────────────────────
  test('bandas de la zona en la jornada, en orden (sin tareas ni hitos)', async () => {
    const F = fest();
    eq(M.targets(F.s, F.P, at('21:00')).map(b => b.name).join(), 'Prueba A,Banda A,Banda B,Cabeza');
    eq(M.targets(F.s, F.K, at('21:00')).map(b => b.name).join(), 'Acústico');
    eq(M.targets(F.s, F.P, at('02:00')).length, 4, 'a las 02:00 sigue siendo la jornada del 10');
  });

  test('propuesta: la registrada en curso > la que suena > la siguiente > la última', async () => {
    const F = fest(), list = n => M.targets(F.s, F.P, at(n));
    eq(M.suggest(list('20:45'), at('20:45')).name, 'Banda A', 'suena según horario');
    eq(M.suggest(list('21:40'), at('21:40')).name, 'Banda B', 'la siguiente');
    const s2 = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('20:50')).state;
    eq(M.suggest(M.targets(s2, F.P, at('21:45')), at('21:45')).name, 'Banda A', 'empezada y sin terminar manda');
    eq(M.suggest(list('03:00'), at('03:00')).name, 'Cabeza', 'todo pasado: la última');
  });

  test('acciones posibles: ▶ sin inicio; ■ desde su hora hasta que acaba (o hasta ■ con Alargar); En hora si no va en hora; Alargar hasta ■', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    let a = M.actionsFor(blk(F.s, 'Banda A'), at('20:00')); ok(a.start && !a.stop && !a.onTime && a.stretch, 'va en hora: no hace falta En hora');
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('20:35')).state;
    a = M.actionsFor(blk(s1, 'Banda A'), at('20:40')); ok(!a.start && a.stop && a.onTime && a.stretch);
    a = M.actionsFor(blk(F.s, 'Banda A'), at('21:31')); ok(!a.start && !a.stop && a.stretch, 'sin Alargar, pasada su hora ya acabó: sin ▶ ni ■');
    a = M.actionsFor(blk(M.stretchPlan(F.s, k, true, at('21:00')).state, 'Banda A'), at('21:31')); ok(a.stop, 'con Alargar, ■ hasta que acabe');
    const s2 = M.realPlan(s1, CFG, k, 'f', at('21:20')).state;
    a = M.actionsFor(blk(s2, 'Banda A'), at('21:40')); ok(!a.start && !a.stop && !a.onTime && !a.stretch, 'terminada: nada');
    a = M.actionsFor(null); ok(!a.start && !a.stop && !a.onTime && !a.stretch);
    a = M.actionsFor(blk(F.s, 'Banda A'), at('20:29')); ok(a.start && !a.stop, 'antes de su hora: solo ▶');
    a = M.actionsFor(blk(F.s, 'Banda A'), at('20:30')); ok(a.start && a.stop, 'a su hora: ▶ y ■');
  });

  test('■ sin ▶ (pasivo): inicio = el estimado, fin = ahora; acabar antes no adelanta nada', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const r = M.realPlan(F.s, CFG, k, 'f', at('21:10'));
    ok(r.ok, r.error); ok(r.passive);
    const b = blk(r.state, 'Banda A');
    eq(C.fmtHM(b.ri), '20:30', 'inicio dado por en hora'); eq(C.fmtHM(b.rf), '21:10'); eq(b.delta, -20);
    ok(/termina 21:10 \(inicio 20:30, a su hora\)/.test(r.msg) && /20 min antes/.test(r.msg), r.msg);
    eq(C.fmtHM(blk(r.state, 'Banda B').si), '22:00', 'la siguiente NO se adelanta (regla de oro)');
    eq(r.pushed, null);
    ok(/aún no ha empezado \(empieza a las 20:30\)/.test(M.realPlan(F.s, CFG, k, 'f', at('20:10')).error), 'antes de su hora no');
  });

  test('■ tarde: sin Alargar no existe (acabó a su hora); con Alargar, lo que pasa del colchón va al estimado', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    ok(/ya acabó a su hora \(21:30\).*Tiempo extra/.test(M.realPlan(F.s, CFG, k, 'f', at('21:55')).error));
    const r = M.realPlan(M.stretchPlan(F.s, k, true, at('21:00')).state, CFG, k, 'f', at('21:55'));   // +25 al fin; colchón 15 → desborde 10
    ok(r.ok, r.error); ok(/\+10 sobre lo previsto/.test(r.msg), r.msg);
    eq(C.fmtHM(blk(r.state, 'Banda B').si), '22:10'); eq(C.fmtHM(blk(r.state, 'Banda B').psi), '22:00');
    eq(r.pushed.minutes, 10); eq(r.pushed.who, 'Banda A');
  });

  // ── ▶ / ■ ─────────────────────────────────────────────────────────────
  test('▶ tarde dentro del colchón: se absorbe, no se mueve nada', async () => {
    const F = fest();
    const r = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('20:40'));
    ok(r.ok); ok(/empieza 20:40 · sale 10 min tarde · siguiente Banda B 22:00 \(en hora\)/.test(r.msg), r.msg);
    eq(blk(r.state, 'Banda B').si, at('22:00')); eq(r.pushed, null);
  });

  test('▶ tarde sin Alargar: se para a su hora, nadie se mueve; con Alargar, SOLO el desborde, en su zona, sin lo rojo', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const r0 = M.realPlan(F.s, CFG, k, 'i', at('21:00'));
    ok(r0.ok); eq(C.fmtHM(blk(r0.state, 'Banda A').sf), '21:30'); eq(C.fmtHM(blk(r0.state, 'Banda B').si), '22:00'); eq(r0.pushed, null);
    const r = M.realPlan(M.realPlan(M.stretchPlan(F.s, k, true, at('21:00')).state, CFG, k, 'i', at('21:00')).state, CFG, k, 'f', at('22:00'));   // +30 → desborde 15
    ok(r.ok, r.error); ok(/\+15 sobre lo previsto/.test(r.msg), r.msg);
    eq(C.fmtHM(blk(r.state, 'Banda B').si), '22:15', 'Banda B +15'); eq(C.fmtHM(blk(r.state, 'Banda B').psi), '22:00', 'previsto intacto');
    eq(C.fmtHM(blk(r.state, 'Cabeza').si), '23:30', 'Cabeza (DELAY rojo) no se mueve');
    eq(C.fmtHM(blk(r.state, 'Acústico').si), '21:00', 'la Carpa no se toca');
    eq(C.fmtHM(blk(r.state, 'Curfew').si), '01:30', 'el hito sin zona no se toca');
  });

  test('▶ / ■ con bloqueo de Retrasos: lo bloqueado no se empuja', async () => {
    const F = fest();
    const cfg = { delayBlock: { all: {}, [F.P]: { show: true } } };
    const kA = key(F.s, 'Banda A');
    const r = M.realPlan(M.stretchPlan(F.s, kA, true, at('21:00')).state, cfg, kA, 'f', at('22:00'));
    ok(r.ok, r.error); eq(C.fmtHM(blk(r.state, 'Banda B').si), '22:00');
    deq(r.state.showtimeBloqueos, cfg.delayBlock, 'los bloqueos viajan con el evento');
  });

  test('Alargar: activar/desactivar; con él, el directo gasta el colchón y luego suma al estimado hasta ■', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const r = M.stretchPlan(F.s, k, true, at('21:20')); ok(r.ok, r.error); ok(/TIEMPO EXTRA/.test(r.msg));
    ok(blk(r.state, 'Banda A').alargar);
    ok(/ya tiene Tiempo extra/.test(M.stretchPlan(r.state, k, true).error));
    const est = (st, n, t) => C.buildBlocks(st, { mode: 'all', day: 'all', now: at(t) }).find(b => b.name === n);
    eq(C.fmtHM(est(r.state, 'Banda B', '21:40').si), '22:00', '+10: en el colchón');
    eq(C.fmtHM(est(r.state, 'Banda B', '21:52').si), '22:07', '+22: desborda 7');
    eq(C.delayByZone(r.state, at('21:52')).find(z => z.zoneId === F.P).status, 'overflow');
    const off = M.stretchPlan(r.state, k, false); ok(off.ok); ok(!blk(off.state, 'Banda A').alargar);
    ok(!M.stretchPlan(F.s, key(F.s, 'Curfew'), true).ok, 'un hito no');
  });

  test('▶ / ■ rechazos claros: dos veces, hito, entrada borrada', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('20:35')).state;
    ok(/ya tiene inicio real/.test(M.realPlan(s1, CFG, k, 'i', at('20:36')).error));
    ok(/Solo los shows/.test(M.realPlan(F.s, CFG, key(F.s, 'Curfew'), 'i', at('01:30')).error));
    ok(/ya no está/.test(M.realPlan(F.s, CFG, '999:show', 'i', at('20:30')).error));
    const s2 = M.realPlan(s1, CFG, k, 'f', at('21:25')).state;
    ok(/ya tiene fin real/.test(M.realPlan(s2, CFG, k, 'f', at('21:26')).error));
  });

  test('■ de un soundcheck: registra su fin (campos de soundcheck)', async () => {
    const F = fest(), k = key(F.s, 'Prueba A', 'sc');
    let r = M.realPlan(F.s, CFG, k, 'i', at('17:05')); ok(r.ok);
    r = M.realPlan(r.state, CFG, k, 'f', at('17:40')); ok(r.ok, r.error);
    const b = blk(r.state, 'Prueba A');
    eq(C.fmtHM(b.ri), '17:05'); eq(C.fmtHM(b.rf), '17:40');
    eq(blk(r.state, 'Banda A').ri, null, 'el show de la misma entrada no se toca');
  });

  // ── En hora ───────────────────────────────────────────────────────────
  test('En hora: inicio real = su hora prevista y el retraso que arrastraba se cancela', async () => {
    const F = fest();
    const kA = key(F.s, 'Banda A');
    const s1 = M.realPlan(M.stretchPlan(F.s, kA, true, at('21:00')).state, CFG, kA, 'f', at('22:00')).state;   // Banda B estimada 22:15
    const kB = key(F.s, 'Banda B');
    ok(/ya está en hora/.test(M.onTimePlan(F.s, kB, at('21:50')).error), 'sin retraso: nada que cancelar');
    const r = M.onTimePlan(s1, kB, at('21:45'));   // se puede pulsar siempre (también antes de su hora)
    ok(r.ok, r.error); ok(/en hora, empieza 22:00 \(estaba estimada a las 22:15\)/.test(r.msg), r.msg);
    const b = blk(r.state, 'Banda B'); eq(C.fmtHM(b.ri), '22:00'); eq(b.si, b.psi);
    ok(/ya está en hora/.test(M.onTimePlan(r.state, kB, at('22:01')).error));
    const done = M.realPlan(r.state, CFG, kB, 'f', at('22:50')).state;
    ok(/ya ha terminado/.test(M.onTimePlan(done, kB, at('23:01')).error));
  });

  // ── Retraso desde el móvil ────────────────────────────────────────────
  test('retraso de una zona: estimado de lo pendiente de esa zona, cuenta las fijas; el previsto no cambia', async () => {
    const F = fest();
    const p = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('21:00') });
    ok(p.ok); eq(p.moved.map(m => m.name).join(), 'Banda B'); eq(p.kept.length, 1); eq(p.summary, 'mueve 1 · 1 fija');
    eq(C.fmtHM(blk(p.state, 'Banda B').si), '22:10'); eq(C.fmtHM(blk(p.state, 'Banda B').psi), '22:00');
    eq(C.fmtHM(blk(p.state, 'Acústico').si), '21:00'); eq(p.state.showtimeRetrasos.length, 1);
  });

  test('retraso de todas las zonas: incluye la Carpa y el hito sin zona; choques con lo rojo', async () => {
    const F = fest();
    const p = M.delayPlan(F.s, CFG, { minutes: 40, zones: 'all', from: at('20:00') });
    ok(p.ok);
    eq(p.moved.map(m => m.name).sort().join(), 'Acústico,Banda A,Banda B,Curfew');
    ok(p.clashes.some(c => c.name === 'Banda B' && c.with === 'Cabeza'), 'Banda B +40 invade a Cabeza (rojo)');
    ok(/choque/.test(p.summary), p.summary);
  });

  test('retraso: los bloqueos del menú Retrasos cuentan igual que en el Panel', async () => {
    const F = fest();
    const p = M.delayPlan(F.s, { delayBlock: { all: { hito: true } } }, { minutes: 5, zones: 'all', from: at('20:00') });
    ok(p.moved.every(m => m.kind !== 'hito')); ok(p.kept.some(k => k.name === 'Curfew'));
  });

  test('retraso: la huella del resumen cambia si el horario cambia entre medias', async () => {
    const F = fest(), o = { minutes: 5, zones: [F.P], from: at('21:00') };
    const st1 = M.delayStamp(M.delayPlan(F.s, CFG, o));
    eq(M.delayStamp(M.delayPlan(F.s, CFG, o)), st1, 'mismo horario → misma huella');
    const moved = C.editArtist(F.s, F.ids['Banda B'], 'show', 'inicio', '22:05');
    ok(moved.ok, moved.error);
    ok(M.delayStamp(M.delayPlan(moved.state, CFG, o)) !== st1, 'otro horario → otra huella');
    ok(!M.delayPlan(F.s, CFG, { minutes: 0, zones: 'all', from: at('21:00') }).ok);
    ok(!M.delayPlan(F.s, CFG, { minutes: 5, zones: 'all' }).ok);
  });

  // ── Retraso por zona (barra del Panel y mando) ─────────────────────────
  test('acumulado: los retrasos se suman en el estimado; lo rojo y las otras zonas no', async () => {
    const F = fest();
    let s = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('20:00') }).state;
    s = M.delayPlan(s, CFG, { minutes: 5, zones: [F.P], from: at('20:00') }).state;
    const b = blk(s, 'Banda B'); eq(C.fmtHM(b.psi), '22:00', 'previsto'); eq(C.fmtHM(b.si), '22:15', 'estimado');
    const z = C.delayByZone(s, at('20:00'));
    eq(z.map(x => x.zone).join(), 'Principal,Carpa', 'zonas en orden');
    eq(z[0].acc, 15); eq(z[1].acc, 0, 'la Carpa no se ha movido');
    eq(blk(s, 'Cabeza').si, blk(s, 'Cabeza').psi, 'lo rojo no se mueve');
  });

  test('cambiar la hora prevista a mano: el retraso aplicado sigue sumándose encima', async () => {
    const F = fest();
    const s = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('20:00') }).state;
    const e = C.editArtist(s, F.ids['Banda B'], 'show', 'inicio', '22:30');
    eq(C.fmtHM(blk(e.state, 'Banda B').si), '22:40');
    eq(C.delayByZone(e.state, at('20:00'))[0].acc, 10);
  });

  test('acumulado + vivo: desborde y desfase de la banda en curso', async () => {
    const F = fest();
    const kA = key(F.s, 'Banda A'), alg = M.stretchPlan(F.s, kA, true, at('21:00')).state;
    const r = M.realPlan(alg, CFG, kA, 'f', at('22:00'));   // alarga +30; desborde 15
    const z = C.delayByZone(r.state, at('22:05')).find(x => x.zoneId === F.P);
    eq(z.acc, 15, 'lo que viene va +15'); eq(z.live, 30, 'Banda A va +30'); eq(z.status, 'overflow'); eq(z.overflow, 15);
    const p = M.delayPill(z); eq(p.cls, 'over'); eq(p.text, 'Principal: +15 min (+30 vivo) · buffer agotado');
    // Desborde que no se puede pasar (shows bloqueados en la zona): rojo, sin acumulado
    const rb = M.realPlan(alg, { delayBlock: { all: {}, [F.P]: { show: true } } }, kA, 'f', at('22:00'));
    eq(C.fmtHM(blk(rb.state, 'Banda B').si), '22:00', 'shows bloqueados en la zona: el desborde no los mueve');
    eq(C.delayByZone(rb.state, at('22:05')).find(x => x.zoneId === F.P).acc, 0);
    const r2 = M.realPlan(alg, CFG, kA, 'f', at('21:40'));
    const p2 = M.delayPill(C.delayByZone(r2.state, at('21:45')).find(x => x.zoneId === F.P)); eq(p2.cls, 'absorb'); eq(p2.text, 'Principal: +0 min (+10 vivo)');
  });

  test('píldora: en hora, solo acumulado y adelanto', async () => {
    const F = fest();
    eq(M.delayPill(C.delayByZone(F.s, at('20:00'))[0]).text, 'Principal · En hora');
    eq(M.delayPill(C.delayByZone(F.s, at('20:00'))[0]).cls, 'ok');
    const s = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('20:00') }).state;
    const p = M.delayPill(C.delayByZone(s, at('20:00'))[0]); eq(p.cls, 'acc'); eq(p.text, 'Principal: +10 min');
    const e = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('20:27')).state;
    const pe = M.delayPill(C.delayByZone(e, at('20:30'))[0]); eq(pe.cls, 'early'); eq(pe.text, 'Principal · En hora (−3 vivo)');
    eq(M.delayPill(C.delayByZone(F.s, at('20:00'))[1], 'Carpa grande').text, 'Carpa grande · En hora', 'nombre propio de la zona');
  });

  // ── Forma de las órdenes ──────────────────────────────────────────────
  test('órdenes: válidas e inválidas', async () => {
    eq(M.checkCmd({ op: 'start', args: { key: '3:show' } }), null);
    eq(M.checkCmd({ op: 'stretch', args: { key: '3:show', on: true } }), null); ok(M.checkCmd({ op: 'stretch', args: { key: '3:show' } }));
    eq(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: 'all', from: 100, stamp: 'x' } }), null);
    eq(M.checkCmd({ op: 'flash', args: { text: '5 MINUTOS' } }), null);
    eq(M.checkCmd({ op: 'flashOff' }), null);
    eq(M.checkCmd({ op: 'callOk', args: { key: 'Banda@1' } }), null);
    ok(M.checkCmd({ op: 'borrarTodo' })); ok(M.checkCmd({ op: 'start', args: {} }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 0, zones: 'all', from: 1, stamp: '' } }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: [], from: 1, stamp: '' } }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: 'all', from: 1 } }), 'sin resumen confirmado no vale');
    ok(M.checkCmd({ op: 'flash', args: { text: 'x'.repeat(141) } }));
    eq(M.checkCmd({ op: 'flash', args: { text: 'ÚLTIMO TEMA', to: ['confidence'] } }), null, 'mensaje solo a Confidence');
    eq(M.checkCmd({ op: 'flash', args: { text: 'ÚLTIMO TEMA', to: ['confidence'], zones: ['esc1'] } }), null, 'a la Confidence de una zona');
    ok(M.checkCmd({ op: 'flash', args: { text: 'x', zones: 'esc1' } }), 'zonas mal formadas');
    ok(M.checkCmd({ op: 'flash', args: { text: 'x', to: ['camerino'] } }), 'destino desconocido');
    ok(M.checkCmd(null));
  });

  // ── Canal de órdenes: firma, caducidad, repetidas ─────────────────────
  test('enlace del regidor: lleva la clave del mando; el de Staff no', async () => {
    const room = await E.newRoom();
    const st = E.staffUrl(room, E.PUBLIC_BASE), rm = E.remoteUrl(room, E.PUBLIC_BASE);
    ok(rm.indexOf(E.PUBLIC_BASE + 'remote.html?b=' + E.BUILD + '#') === 0, rm);
    eq(E.parseHash(rm.slice(rm.indexOf('#'))).c, room.c); eq(E.parseHash(st.slice(st.indexOf('#'))).c, undefined);
    ok(st.indexOf(room.c) < 0, 'la clave del mando no va en el QR de Staff');
    eq(E.parseHash('#sala=AAAAAAAAAAAAAAAA&k=' + _.b64u(new Uint8Array(16)) + '&p=' + _.b64u(new Uint8Array(16)) + '&c=abc'), null, 'clave de mando mal formada');
    ok(Q.encode(rm, { ecl: 'M' }).version <= 10, 'QR del regidor versión ' + Q.encode(rm, { ecl: 'M' }).version);
    const old = Object.assign({}, room); delete old.c;
    ok(E.withCmdKey(old).c && E.withCmdKey(old).sala === room.sala, 'sala de la 2d-A: se le añade la clave sin cambiar la sala');
    ok(E.newCmdKey(room).c !== room.c && E.newCmdKey(room).k === room.k, 'nueva clave de mando: Staff sigue igual');
  });

  test('orden firmada: el Mac la abre; con la clave de Staff o alterada, no', async () => {
    const room = await E.newRoom(), K = await _.macKeys(room);
    const Vr = await _.viewerKeys({ sala: room.sala, k: room.k, p: room.p, c: room.c });
    const f = await _.sealCmd(Vr, { id: 'abcdefgh', t: Date.now(), op: 'flashOff', args: {} });
    eq((await _.openCmd(K, f)).op, 'flashOff');
    const bad = f.slice(); bad[bad.length - 1] ^= 1; eq(await _.openCmd(K, bad), null, 'alterada');
    // Alguien con el QR de Staff se inventa una clave de mando
    const Vs = await _.viewerKeys({ sala: room.sala, k: room.k, p: room.p, c: _.b64u(new Uint8Array(16)) });
    eq(await _.openCmd(K, await _.sealCmd(Vs, { id: 'zzzzzzzz', t: Date.now(), op: 'flashOff' })), null, 'sin la clave del mando');
    const K0 = await _.macKeys(Object.assign({}, room, { c: undefined }));
    eq(await _.openCmd(K0, f), null, 'un Mac sin clave de mando no obedece nada');
  });

  test('guardia: repetida se ignora, vieja o del futuro se rechaza', async () => {
    const g = new E.CmdGuard(), t = 1e12;
    eq(g.check({ id: 'orden-1', t }, t), 'ok');
    eq(g.check({ id: 'orden-1', t }, t + 10), 'dup', 'la misma por el otro repetidor');
    eq(g.check({ id: 'orden-2', t: t - E.CMD_WINDOW - 1 }, t), 'old');
    eq(g.check({ id: 'orden-3', t: t + E.CMD_WINDOW + 1 }, t), 'old');
    eq(g.check({ id: 'x', t }, t), 'bad'); eq(g.check({ id: 'orden-4' }, t), 'bad');
  });

  // ── De punta a punta, con dos repetidores de mentira ──────────────────
  function FakeBroker() {
    this.clients = new Set();
    const broker = this;
    this.WS = function (url) {
      const ws = this; ws.readyState = 0; ws.subs = []; ws.buf = new Uint8Array(0);
      ws.send = bytes => broker.receive(ws, bytes);
      ws.close = () => { if (ws.readyState === 3) return; ws.readyState = 3; broker.clients.delete(ws); setTimeout(() => ws.onclose && ws.onclose({}), 0); };
      setTimeout(() => { ws.readyState = 1; broker.clients.add(ws); ws.onopen && ws.onopen({}); }, 0);
    };
  }
  FakeBroker.prototype.deliver = function (ws, bytes) { setTimeout(() => { if (ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: bytes.slice().buffer }); }, 0); };
  FakeBroker.prototype.receive = function (ws, bytes) {
    const r = MQ.parse(_.concat(ws.buf, bytes)); ws.buf = Uint8Array.from(r.rest);
    r.packets.forEach(p => {
      if (p.type === 1) this.deliver(ws, Uint8Array.from([0x20, 2, 0, 0]));
      else if (p.type === 8) { const s = MQ.readSubscribe(p); ws.subs.push(...s.topics); this.deliver(ws, Uint8Array.from([0x90, 3, s.id >> 8, s.id & 255, 0])); }
      else if (p.type === 3) { const m = MQ.readPublish(p), out = MQ.publish(m.topic, m.payload); this.clients.forEach(c => { if (c.subs.indexOf(m.topic) >= 0) this.deliver(c, out); }); }
      else if (p.type === 12) this.deliver(ws, Uint8Array.from([0xD0, 0]));
    });
  };
  function rig() {
    const brokers = [{ id: 'a', name: 'A', url: 'wss://a.test/mqtt' }, { id: 'b', name: 'B', url: 'wss://b.test/mqtt' }];
    brokers.forEach(b => { b.fake = new FakeBroker(); });
    return { brokers, WS: function (url, p) { return new (brokers.find(x => x.url === url).fake.WS)(url, p); } };
  }

  test('mando → Mac: la orden se ejecuta UNA vez (llega por los dos repetidores) y contesta', async () => {
    const R = rig(), room = await E.newRoom(), got = [];
    let st = null;
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => ({ n: got.length }), onStatus: s => { st = s; },
      onCommand: async cmd => { got.push(cmd.op); return { ok: true, msg: 'hecho ' + cmd.op }; } });
    await tx.start();
    const rx = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p, c: room.c }, brokers: R.brokers, WebSocket: R.WS, onSnapshot: () => {} });
    await rx.start();
    await until(() => rx.links.every(l => l.state === 'on'), 3000, 'mando conectado');
    const res = await rx.command('flash', { text: '5 MINUTOS' });
    eq(res.ok, true); eq(res.msg, 'hecho flash');
    await sleep(150);
    eq(got.join(), 'flash', 'una sola vez');
    await until(() => st && st.remotes === 1, 3000, 'el Panel ve el mando conectado');
    eq(st.viewers, 0, 'el mando no cuenta como móvil de Staff');
    await tx.stop(); rx.stop();
  });

  test('mando: la respuesta de rechazo llega con su motivo', async () => {
    const R = rig(), room = await E.newRoom();
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => ({}), onCommand: async () => ({ ok: false, msg: 'Esa entrada ya no está', data: { stale: true } }) });
    await tx.start();
    const rx = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p, c: room.c }, brokers: R.brokers, WebSocket: R.WS, onSnapshot: () => {} });
    await rx.start(); await until(() => rx.links.some(l => l.state === 'on'), 3000);
    const res = await rx.command('start', { key: 'x' });
    eq(res.ok, false); eq(res.msg, 'Esa entrada ya no está'); eq(res.data.stale, true);
    await tx.stop(); rx.stop();
  });

  test('Staff no puede mandar: su orden no se ejecuta ni se contesta', async () => {
    const R = rig(), room = await E.newRoom(); let ran = 0;
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => ({}), onCommand: async () => { ran++; return { ok: true }; } });
    await tx.start();
    const fakeC = _.b64u(new Uint8Array(16).fill(7));
    const rx = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p, c: fakeC }, brokers: R.brokers, WebSocket: R.WS, onSnapshot: () => {}, cmdTimeout: 400 });
    await rx.start(); await until(() => rx.links.some(l => l.state === 'on'), 3000);
    const res = await rx.command('flashOff', {});
    eq(res.ok, false); ok(res.timeout, 'sin respuesta'); eq(ran, 0);
    const plain = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p }, brokers: R.brokers, WebSocket: R.WS, onSnapshot: () => {} });
    eq((await plain.command('flashOff', {})).ok, false, 'un enlace de Staff ni lo intenta');
    await tx.stop(); rx.stop();
  });

  test('orden caducada (reloj del móvil muy desfasado): se rechaza con aviso', async () => {
    const R = rig(), room = await E.newRoom(); let ran = 0;
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => ({}), onCommand: async () => { ran++; return { ok: true }; } });
    await tx.start();
    const rx = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p, c: room.c }, brokers: R.brokers, WebSocket: R.WS, onSnapshot: () => {} });
    await rx.start(); await until(() => rx.links.some(l => l.state === 'on'), 3000);
    const realNow = Date.now; Date.now = () => realNow() - 10 * 60000;    // el móvil va 10 min atrasado
    const p = rx.command('flashOff', {});
    Date.now = realNow;
    const res = await p;
    eq(res.ok, false); ok(/caducada/.test(res.msg), res.msg); eq(ran, 0);
    await tx.stop(); rx.stop();
  });

  // ── Tanda 1: hora de corte, cambio de hora, bis, corrección de inicio, En hora ──
  const at11 = hm => C.toAbs('2026-07-11', hm);
  function festTarde() {   // la última banda empieza tarde y sigue sonando pasada la hora de corte (06:00)
    const F = fest();
    let r = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Última', escenarioId: F.P, inicio: '04:30', fin: '05:30' }); F.s = r.state;
    F.s = C.setReal(C.setAlargar(F.s, r.id, 'show', true).state, r.id, 'show', 'i', at('05:15')).state;   // ▶ a las 05:15, con Tiempo extra y sin ■
    return F;
  }
  test('Hora de corte: la jornada activa sigue a la banda que suena, no al reloj', async () => {
    const F = festTarde();
    eq(C.jornadaOfAbs(F.s, at11('06:10')), '2026-07-11', 'el reloj ya está en la jornada siguiente');
    eq(C.activeJornada(F.s, at11('06:10')), JOR, 'pero la Última sigue sonando');
    ok(M.targets(F.s, F.P, at11('06:10')).some(b => b.name === 'Última'), 'el mando puede darle ■');
    const z = C.delayByZone(F.s, at11('06:10')).find(x => x.zoneId === F.P); ok(z && z.liveBlock && z.liveBlock.name === 'Última', 'los desfases siguen con ella');
    const F2 = fest(); eq(C.activeJornada(F2.s, at11('06:10')), '2026-07-11', 'si no suena nada, manda el reloj');
    eq(C.activeJornada(F.s, at11('20:00')), '2026-07-11', 'lejos del corte, el reloj');
    const fin = M.realPlan(F.s, CFG, key(F.s, 'Última'), 'f', at11('06:20')); ok(fin.ok, fin.error);
    eq(C.activeJornada(fin.state, at11('06:21')), '2026-07-11', 'con ■, se pasa a la jornada nueva');
  });

  test('Cambio de hora: un ■ anterior al inicio real no se guarda al revés', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('20:45')).state;
    const r = M.realPlan(M.stretchPlan(s1, k, true, at('20:50')).state, CFG, k, 'f', at('20:15'));   // el reloj ha retrocedido
    ok(!r.ok && /anterior al inicio real.*cambio de hora/i.test(r.error), r.error);
  });

  test('Bis: Tiempo extra pasada su hora; ventana = min(ajuste, cambio real), 10 min por defecto; si la siguiente dio ▶, no', async () => {
    const F = fest(), k = key(F.s, 'Banda A'), bA = blk(F.s, 'Banda A');
    const w = M.bisWindow(F.s, bA, at('21:35'));
    eq(w.cap, 10, 'por defecto, 10 min'); eq(w.gap, 30, 'cambio real 21:30 → 22:00'); eq(w.max, 10, 'min(10, 30)');
    eq(M.bisWindow(F.s, bA, at('21:35'), { bisWindow: 5 }).max, 5, 'ajuste 5');
    eq(M.bisWindow(F.s, bA, at('21:35'), { bisWindow: 15 }).max, 15, 'ajuste 15');
    eq(M.bisWindow(F.s, bA, at('21:35'), { bisWindow: 99 }).max, 10, 'valor raro → 10');
    const r = M.stretchPlan(F.s, k, true, at('21:40'));
    ok(r.ok, r.error); eq(r.late, 10); eq(r.kind, 'show'); ok(/^BIS · Banda A: Tiempo extra tardío a las 21:40 \(\+10 min desde su fin, 21:30\)/.test(r.msg), r.msg);
    ok(blk(r.state, 'Banda A').alargar, 'vuelve a estar en escena');
    ok(M.actionsFor(blk(r.state, 'Banda A'), at('21:41')).stop, 'y se le puede dar ■');
    const tarde = M.stretchPlan(F.s, k, true, at('21:41'));
    ok(!tarde.ok && /ventana de 10 min/.test(tarde.error), tarde.error);
    ok(M.stretchPlan(F.s, k, true, at('21:45'), { bisWindow: 15 }).ok, 'con ajuste de 15, a los 15 min sí');
    const bEmpezada = M.realPlan(F.s, CFG, key(F.s, 'Banda B'), 'i', at('21:35')).state;
    const tarde2 = M.stretchPlan(bEmpezada, k, true, at('21:36'));
    ok(!tarde2.ok && /Banda B ya ha empezado/.test(tarde2.error), tarde2.error);
    eq(M.bisState(bEmpezada, blk(bEmpezada, 'Banda A'), at('21:36')).reason, 'next', 'el botón se desactiva');
    const kA = key(F.s, 'Acústico');   // sin siguiente en su zona: la ventana del ajuste
    ok(M.stretchPlan(F.s, kA, true, at('22:10')).ok, 'a los 10 min, sí');
    ok(!M.stretchPlan(F.s, kA, true, at('22:11')).ok, 'a los 11, no');
    ok(M.stretchPlan(F.s, k, true, at('21:00')).late === undefined, 'antes de su hora no es bis');
  });
  test('Bis: un cambio corto acorta la ventana (nunca pisa a la siguiente)', async () => {
    const F = fest();
    const r = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Pegada', escenarioId: F.P, inicio: '21:35', fin: '21:55' }); ok(r.ok, r.error);
    const w = M.bisWindow(r.state, blk(r.state, 'Banda A'), at('21:31'), { bisWindow: 15 });
    eq(w.gap, 5); eq(w.max, 5, 'cambio de 5 min → ventana de 5');
    ok(M.stretchPlan(r.state, key(r.state, 'Banda A'), true, at('21:35'), { bisWindow: 15 }).ok, 'a los 5, sí');
    ok(!M.stretchPlan(r.state, key(r.state, 'Banda A'), true, at('21:36'), { bisWindow: 15 }).ok, 'a los 6, no');
  });
  test('Extender prueba (soundcheck): misma ventana; tareas e hitos, nunca', async () => {
    const F = fest(), b = blk(F.s, 'Prueba A');
    const st = M.bisState(F.s, b, at('17:50'));
    ok(st.ok, JSON.stringify(st)); eq(st.kind, 'sc'); eq(st.left, 5, 'quedan 5 de 10');
    const r = M.stretchPlan(F.s, b.key, true, at('17:50'));
    ok(r.ok, r.error); eq(r.kind, 'sc'); ok(/^EXTENDER PRUEBA · Prueba A/.test(r.msg), r.msg);
    eq(M.bisState(F.s, b, at('17:56')).reason, 'expired', 'cambio de 2 h 45, pero la ventana es la del ajuste');
    const t = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Descarga', tipo: 'tarea', escenarioId: F.P, inicio: '12:00', fin: '13:00' }); ok(t.ok, t.error);
    const bt = C.buildBlocks(t.state, { mode: 'all', day: 'all' }).find(x => x.name === 'Descarga');
    eq(M.bisState(t.state, bt, at('13:05')).reason, 'no', 'una tarea no tiene bis');
    ok(!M.stretchPlan(t.state, bt.key, true, at('13:05')).ok, 'ni Tiempo extra');
  });

  test('Corregir el inicio real: recalcula y deja texto para el log; valida la hora', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const r = M.editStartPlan(F.s, CFG, k, at('20:34'), at('20:50'));
    ok(r.ok, r.error); eq(blk(r.state, 'Banda A').ri, at('20:34'));
    eq(r.logTxt, 'Corrección de inicio real: «Banda A» 20:34 (antes 20:30, asumido)');
    const r2 = M.editStartPlan(r.state, CFG, k, at('20:36'), at('20:50'));
    eq(r2.logTxt, 'Corrección de inicio real: «Banda A» 20:36 (antes 20:34)');
    ok(/posterior a ahora/.test(M.editStartPlan(F.s, CFG, k, at('20:55'), at('20:50')).error));
    const conFin = M.realPlan(M.realPlan(F.s, CFG, k, 'i', at('20:30')).state, CFG, k, 'f', at('21:00')).state;
    ok(/anterior a su fin real/.test(M.editStartPlan(conFin, CFG, k, at('21:05'), at('21:10')).error));
    ok(/fuera de su jornada/.test(M.editStartPlan(F.s, CFG, k, C.toAbs('2026-07-09', '20:30'), at('20:50')).error));
    const aFin = M.realPlan(M.realPlan(M.stretchPlan(F.s, k, true, at('21:00')).state, CFG, k, 'i', at('20:30')).state, CFG, k, 'f', at('21:40')).state;
    ok(/Pisa el fin real de Banda A \(21:40\)/.test(M.editStartPlan(aFin, CFG, key(F.s, 'Banda B'), at('21:35'), at('22:10')).error));
  });

  test('En hora: el log dice qué zona vuelve a EN HORA y cuánto se absorbió', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const tarde = M.realPlan(F.s, CFG, k, 'i', at('20:40')).state;
    const r = M.onTimePlan(tarde, k, at('20:50'));
    ok(r.ok, r.error); eq(r.absorbed, 10);
    eq(r.logTxt, 'Reconciliación: Zona Principal vuelve a EN HORA (absorbidos +10 min en changeover) · Banda A 20:30');
    const pronto = M.realPlan(F.s, CFG, k, 'i', at('20:25')).state;
    ok(/anulado un adelanto de 5 min/.test(M.onTimePlan(pronto, k, at('20:40')).logTxt));
  });

  // ── Ejecutor asíncrono ────────────────────────────────────────────────
  // ── Idioma (Fase 3): la píldora sale en el idioma activo; los mensajes de las órdenes se guardan en español y se leen en inglés ──
  const I18 = () => (isNode ? require('../i18n.js') : window.ShowtimeI18n);
  test('idioma: píldora de retraso en inglés y de vuelta; los mensajes de las órdenes, en español (log) y traducidos al enseñarlos', () => {
    const I = I18(); if (!I) return;
    const F = fest();
    const kA = key(F.s, 'Banda A'), alg = M.stretchPlan(F.s, kA, true, at('21:00')).state;
    const r = M.realPlan(alg, CFG, kA, 'f', at('22:00'));
    const z = C.delayByZone(r.state, at('22:05')).find(x => x.zoneId === F.P);
    I.setLang('en');
    try {
      const p = M.delayPill(z);
      eq(p.text, 'Principal: +15 min (+30 live) · buffer exhausted');
      ok(/^Accumulated delay: what follows is \+15 min/.test(p.title), p.title);
      eq(M.delayPill(C.delayByZone(F.s, at('20:00'))[0]).text, 'Principal · On time');
      // ▶ tarde: el mensaje sigue en español (va al log y a Deshacer) y se lee en inglés
      const st = M.realPlan(F.s, CFG, kA, 'i', at('20:40'));
      ok(/^Banda A: empieza 20:40 · sale 10 min tarde/.test(st.msg), 'guardado en español: ' + st.msg);
      ok(/^Banda A: starts 20:40 · starts 10 min late/.test(I.txBack(st.msg)), I.txBack(st.msg));
      const ot = M.onTimePlan(F.s, kA, at('21:00'));
      eq(I.txBack(ot.error), 'Banda A is already on time');
      eq(I.txBack(M.checkCmd({ op: 'nada' })), 'Unknown command');
      ok(/^Reconciliation: Stage /.test(I.txBack(M.onTimePlan(st.state, kA, at('20:45')).logTxt)), 'reconciliación');
    } finally { I.setLang('es'); }
    eq(M.delayPill(z).text, 'Principal: +15 min (+30 vivo) · buffer agotado', 'vuelve al español');
  });

  (async () => {
    let pass = 0; const fails = [];
    for (const [n, f] of tests) { try { await f(); pass++; } catch (e) { fails.push([n, e.message]); } }
    const summary = 'Mando: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
    if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); process.exitCode = fails.length ? 1 : 0; setTimeout(() => process.exit(), 50); }
    else {
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const box = document.createElement('div');
      box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
      document.getElementById('out').appendChild(box);
      window.__TEST_MANDO__ = { pass, total: tests.length, fails };
    }
  })();
})();
