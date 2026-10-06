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

  test('acciones posibles: ▶ sin inicio; ■ con inicio y sin fin; En hora con algún registro', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    let a = M.actionsFor(blk(F.s, 'Banda A')); ok(a.start && !a.stop && !a.onTime);
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('20:35')).state;
    a = M.actionsFor(blk(s1, 'Banda A')); ok(!a.start && a.stop && a.onTime);
    const s2 = M.realPlan(s1, CFG, k, 'f', at('21:35')).state;
    a = M.actionsFor(blk(s2, 'Banda A')); ok(!a.start && !a.stop && a.onTime);
    a = M.actionsFor(null); ok(!a.start && !a.stop && !a.onTime);
  });

  // ── ▶ / ■ ─────────────────────────────────────────────────────────────
  test('▶ tarde dentro del colchón: se absorbe, no se mueve nada', async () => {
    const F = fest();
    const r = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('20:40'));
    ok(r.ok); ok(/empieza 20:40/.test(r.msg) && /se absorbe/.test(r.msg), r.msg);
    eq(blk(r.state, 'Banda B').psi, at('22:00'));
  });

  test('▶ más tarde que el colchón: empuja SOLO el desborde, en su zona, sin lo rojo', async () => {
    const F = fest();
    const r = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('21:00'));   // +30; colchón 30 − 15 = 15 → desborde 15
    ok(r.ok, r.error); ok(/desborde \+15/.test(r.msg), r.msg);
    eq(C.fmtHM(blk(r.state, 'Banda B').psi), '22:15', 'Banda B +15');
    eq(C.fmtHM(blk(r.state, 'Cabeza').psi), '23:30', 'Cabeza (DELAY rojo) no se mueve');
    eq(C.fmtHM(blk(r.state, 'Acústico').psi), '21:00', 'la Carpa no se toca');
    eq(C.fmtHM(blk(r.state, 'Curfew').psi), '01:30', 'el hito sin zona no se toca');
  });

  test('▶ / ■ con bloqueo de Retrasos: lo bloqueado no se empuja', async () => {
    const F = fest();
    const cfg = { delayBlock: { all: {}, [F.P]: { show: true } } };
    const r = M.realPlan(F.s, cfg, key(F.s, 'Banda A'), 'i', at('21:00'));
    ok(r.ok); ok(/nada que mover/.test(r.msg), r.msg);
    eq(C.fmtHM(blk(r.state, 'Banda B').psi), '22:00');
  });

  test('▶ / ■ rechazos claros: dos veces, ■ sin ▶, hito, entrada borrada', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('20:35')).state;
    ok(/ya tiene inicio real/.test(M.realPlan(s1, CFG, k, 'i', at('20:36')).error));
    ok(/aún no ha empezado/.test(M.realPlan(F.s, CFG, k, 'f', at('21:30')).error));
    ok(/Solo los shows/.test(M.realPlan(F.s, CFG, key(F.s, 'Curfew'), 'i', at('01:30')).error));
    ok(/ya no está/.test(M.realPlan(F.s, CFG, '999:show', 'i', at('20:30')).error));
    const s2 = M.realPlan(s1, CFG, k, 'f', at('21:30')).state;
    ok(/ya tiene fin real/.test(M.realPlan(s2, CFG, k, 'f', at('21:31')).error));
  });

  test('■ de un soundcheck: registra su fin (campos de soundcheck)', async () => {
    const F = fest(), k = key(F.s, 'Prueba A', 'sc');
    let r = M.realPlan(F.s, CFG, k, 'i', at('17:05')); ok(r.ok);
    r = M.realPlan(r.state, CFG, k, 'f', at('17:50')); ok(r.ok);
    const b = blk(r.state, 'Prueba A');
    eq(C.fmtHM(b.ri), '17:05'); eq(C.fmtHM(b.rf), '17:50');
    eq(blk(r.state, 'Banda A').ri, null, 'el show de la misma entrada no se toca');
  });

  // ── En hora ───────────────────────────────────────────────────────────
  test('En hora (a): borra ▶/■ de la banda (Δ = 0) y MANTIENE los retrasos ya aplicados', async () => {
    const F = fest(), k = key(F.s, 'Banda A');
    const s1 = M.realPlan(F.s, CFG, k, 'i', at('21:00')).state;          // empuja Banda B a 22:15
    const r = M.onTimePlan(s1, k);
    ok(r.ok); ok(/en hora/.test(r.msg));
    const b = blk(r.state, 'Banda A'); eq(b.ri, null); eq(b.rf, null); ok(!b.delta, 'sin desfase');
    eq(C.fmtHM(blk(r.state, 'Banda B').psi), '22:15', 'el retraso aplicado se queda');
    ok(/ya está en hora/.test(M.onTimePlan(F.s, k).error), 'sin registros no hace nada');
  });

  // ── Retraso desde el móvil ────────────────────────────────────────────
  test('retraso de una zona: mueve lo pendiente de esa zona y cuenta las fijas', async () => {
    const F = fest();
    const p = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('21:00') });
    ok(p.ok); eq(p.moved.map(m => m.name).join(), 'Banda B'); eq(p.kept.length, 1); eq(p.summary, 'mueve 1 · 1 fija');
    eq(C.fmtHM(blk(p.state, 'Banda B').psi), '22:10'); eq(C.fmtHM(blk(p.state, 'Acústico').psi), '21:00');
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

  // ── Retraso acumulado por zona (barra del Panel y mando) ───────────────
  test('acumulado: se apunta la hora original al primer retraso y se suma con los siguientes', async () => {
    const F = fest();
    let s = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('20:00') }).state;
    s = M.delayPlan(s, CFG, { minutes: 5, zones: [F.P], from: at('20:00') }).state;
    const b = blk(s, 'Banda B'); eq(C.fmtHM(b.base), '22:00', 'hora original'); eq(C.fmtHM(b.psi), '22:15');
    const z = C.delayByZone(s, at('20:00'));
    eq(z.map(x => x.zone).join(), 'Principal,Carpa', 'zonas en orden');
    eq(z[0].acc, 15); eq(z[1].acc, 0, 'la Carpa no se ha movido');
    eq(blk(s, 'Cabeza').base, null, 'lo rojo no se mueve: sin hora original');
  });

  test('acumulado: cambiar la hora a mano es el nuevo horario de referencia', async () => {
    const F = fest();
    const s = M.delayPlan(F.s, CFG, { minutes: 10, zones: [F.P], from: at('20:00') }).state;
    const e = C.editArtist(s, F.ids['Banda B'], 'show', 'inicio', '22:30');
    eq(blk(e.state, 'Banda B').base, null);
    eq(C.delayByZone(e.state, at('20:00'))[0].acc, 10, 'quedan las otras movidas (Banda A)');
  });

  test('acumulado + vivo: desbordes empujados y desfase de la banda en curso', async () => {
    const F = fest();
    const r = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('21:00'));   // +30; desborde 15 empujado
    const z = C.delayByZone(r.state, at('21:05')).find(x => x.zoneId === F.P);
    eq(z.acc, 15, 'lo que viene va +15'); eq(z.live, 30, 'Banda A va +30'); eq(z.status, 'absorb', 'tras empujar el desborde, el resto cabe en el cambio');
    const p = M.delayPill(z); eq(p.cls, 'absorb'); eq(p.text, 'Principal: +15 min (+30 vivo)');
    // Desborde que no se pudo empujar (shows bloqueados en la zona): rojo
    const rb = M.realPlan(F.s, { delayBlock: { all: {}, [F.P]: { show: true } } }, key(F.s, 'Banda A'), 'i', at('21:00'));
    const pb = M.delayPill(C.delayByZone(rb.state, at('21:05')).find(x => x.zoneId === F.P));
    eq(pb.cls, 'over'); eq(pb.text, 'Principal: +0 min (+30 vivo) · buffer agotado');
    const r2 = M.realPlan(F.s, CFG, key(F.s, 'Banda A'), 'i', at('20:40'));
    const z2 = C.delayByZone(r2.state, at('20:45')).find(x => x.zoneId === F.P);
    const p2 = M.delayPill(z2); eq(p2.cls, 'absorb'); eq(p2.text, 'Principal: +0 min (+10 vivo)');
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
    eq(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: 'all', from: 100, stamp: 'x' } }), null);
    eq(M.checkCmd({ op: 'flash', args: { text: '5 MINUTOS' } }), null);
    eq(M.checkCmd({ op: 'flashOff' }), null);
    eq(M.checkCmd({ op: 'callOk', args: { key: 'Banda@1' } }), null);
    ok(M.checkCmd({ op: 'borrarTodo' })); ok(M.checkCmd({ op: 'start', args: {} }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 0, zones: 'all', from: 1, stamp: '' } }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: [], from: 1, stamp: '' } }));
    ok(M.checkCmd({ op: 'delay', args: { minutes: 5, zones: 'all', from: 1 } }), 'sin resumen confirmado no vale');
    ok(M.checkCmd({ op: 'flash', args: { text: 'x'.repeat(141) } }));
    ok(M.checkCmd(null));
  });

  // ── Canal de órdenes: firma, caducidad, repetidas ─────────────────────
  test('enlace del regidor: lleva la clave del mando; el de Staff no', async () => {
    const room = await E.newRoom();
    const st = E.staffUrl(room, E.PUBLIC_BASE), rm = E.remoteUrl(room, E.PUBLIC_BASE);
    ok(rm.indexOf(E.PUBLIC_BASE + 'remote.html#') === 0, rm);
    eq(E.parseHash(rm.slice(rm.indexOf('#'))).c, room.c); eq(E.parseHash(st.slice(st.indexOf('#'))).c, undefined);
    ok(st.indexOf(room.c) < 0, 'la clave del mando no va en el QR de Staff');
    eq(E.parseHash('#sala=AAAAAAAAAAAAAAAA&k=' + _.b64u(new Uint8Array(16)) + '&p=' + _.b64u(new Uint8Array(16)) + '&c=abc'), null, 'clave de mando mal formada');
    ok(Q.encode(rm, { ecl: 'M' }).version <= 9, 'QR del regidor versión ' + Q.encode(rm, { ecl: 'M' }).version);
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

  // ── Ejecutor asíncrono ────────────────────────────────────────────────
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
