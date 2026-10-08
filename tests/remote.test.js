/* Tests de remote.js — mando táctil del Stage Manager.
 * Ordenador:  node tests/remote.test.js
 * Carga remote.js en el navegador simulado (tests/_dom.js) con el QR del mando y un Receptor de mentira
 * (sin red): se comprueba qué orden sale, cuándo NO sale y cómo se confirma. El reloj es simulado.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('remote.test.js: solo en Node (node tests/remote.test.js)'); return; }
  const vm = require('vm');
  const D = require('./_dom.js'), E = require('../emision.js'), C = require('../core.js'), M0 = require('../mando.js');
  const MODULOS = ['i18n.js', 'core.js', 'datos.js', 'emision.js', 'mando.js', 'vistas.js'];
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const tick = () => new Promise(r => setImmediate(r));

  const NOW = new Date(2026, 6, 10, 21, 10).getTime();            // viernes 10 de julio, 21:10 (reloj simulado)
  const hm = m => C.fmtHM(((m % 1440) + 1440) % 1440);
  /** Evento alrededor de las 21:10: «Suena» empezó a las 20:40 (sin ▶), «Viene» a las 21:30; otra zona con «Lejos». */
  function fest(fn) {
    const n = Math.floor(C.nowAbs(new Date(NOW)));
    let s = C.newFestival({ nombre: 'Prueba mando', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const [P, K] = s.escenarios.map(e => e.id);
    const add = (nombre, z, a, b) => { const r = C.addArtist(s, 'show', { jornada: '2026-07-10', nombre, escenarioId: z, inicio: hm(n + a), fin: hm(n + b) }); if (!r.ok) throw new Error(r.error); s = r.state; };
    (fn || (() => { add('Suena', P, -30, 30); add('Viene', P, 20, 80); add('Lejos', K, 60, 120); }))(add, P, K);
    return s;
  }
  let ROOM = null;
  /** Arranca el mando. kind: 'remote' (QR del mando) · 'staff' · 'nada'. */
  async function mando(opts) {
    const o = opts || {};
    ROOM = ROOM || await E.newRoom();
    const url = o.kind === 'staff' ? E.staffUrl(ROOM, 'http://x/') : E.remoteUrl(ROOM, 'http://x/');
    const env = D.makeEnv({ cripto: true, now: NOW, hash: o.kind === 'nada' ? '' : url.slice(url.indexOf('#')) });
    D.cargar(env, MODULOS);
    const sent = [], ctl = { reply: { ok: true, msg: 'Hecho en el Mac' }, wakes: 0, R: null };
    const P = env.win.ShowtimeEmision.Receptor.prototype;
    P.start = async function () { ctl.R = this; };
    P.command = async function (op, args) { sent.push({ op, args: JSON.parse(JSON.stringify(args)) }); await tick(); return ctl.reply; };
    P.wake = function () { ctl.wakes++; };
    env.getEl('sheet').hidden = true; env.getEl('bad').hidden = true;
    D.cargar(env, ['remote.js']);
    const t = { env, sent, ctl, Rm: env.win.ShowtimeRemote, Dt: env.win.ShowtimeDatos };
    if (o.fest !== null) t.Dt.loadSnapshot({ festival: o.fest || fest(), config: {}, callDone: [], flash: null, avisos: [] });
    t.status = (state, on) => ctl.R.o.onStatus({ state, links: [{ state: on === false ? 'off' : 'on' }, { state: 'off' }] });
    if (o.live !== false && ctl.R) t.status('live');
    return t;
  }
  const click = (t, sel, el) => t.env.fire('document', 'click', { target: { closest: q => q === sel ? el : null } });

  test('remote.js: la sintaxis es válida', () => { new vm.Script(D.src('remote.js'), { filename: 'remote.js' }); });
  test('Enlace sin claves o el QR de Staff: no hay mando (y dice cuál escanear)', async () => {
    const a = await mando({ kind: 'nada', fest: null });
    eq(a.env.getEl('bad').hidden, false); eq(a.env.getEl('app').hidden, true); eq(a.ctl.R, null, 'ni se conecta');
    const b = await mando({ kind: 'staff', fest: null });
    eq(b.env.getEl('bad').hidden, false);
    ok(/Este es el QR de Staff \(solo lectura\)/.test(b.env.getEl('bad-t').textContent));
  });
  test('Con el QR del mando: arranca, se conecta y propone la banda de su zona', async () => {
    const t = await mando();
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    const cur = t.Rm.current();
    eq(cur.band.name, 'Suena', 'propone la que suena según el horario');
    eq(t.env.getEl('rx-t').textContent, 'CONECTADO');
    ok(/Prueba mando/.test(t.env.getEl('evn').textContent));
  });
  test('▶ y ■ mandan la orden de la banda elegida; la respuesta del Mac sale en el aviso', async () => {
    const t = await mando(), key = t.Rm.current().band.key;
    t.env.fire('b-stop', 'click', {}); await tick(); await tick();
    eq(t.sent.length, 1); eq(t.sent[0].op, 'stop'); eq(t.sent[0].args.key, key);
    eq(t.env.getEl('toast').textContent, 'Hecho · Hecho en el Mac');
    t.ctl.reply = { ok: false, msg: 'Suena ya ha terminado' };
    t.env.fire('b-start', 'click', {}); await tick(); await tick();
    eq(t.env.getEl('toast').textContent, 'No se ha hecho · Suena ya ha terminado');
  });
  test('Sin conexión con el Mac: los botones se apagan', async () => {
    const t = await mando({ live: false });
    t.status('connecting', false);
    eq(t.env.getEl('b-start').disabled, true); eq(t.env.getEl('b-stop').disabled, true); eq(t.env.getEl('b-ontime').disabled, true);
    t.status('live');
    eq(t.env.getEl('b-stop').disabled, false, 'conectado: ■ disponible para la que suena');
    t.status('stale');
    eq(t.env.getEl('rx-t').textContent, 'SIN CONEXIÓN CON EL MAC');
  });
  test('Una orden cada vez: mientras espera respuesta no sale otra (doble toque)', async () => {
    const t = await mando();
    t.env.fire('b-stop', 'click', {}); t.env.fire('b-stop', 'click', {}); t.env.fire('b-start', 'click', {});
    await tick(); await tick();
    eq(t.sent.length, 1, 'solo la primera');
  });
  test('Elegir otra banda (‹ ›) y volver a la propuesta', async () => {
    const t = await mando();
    t.env.fire('next', 'click', {});
    eq(t.Rm.current().band.name, 'Viene');
    t.env.fire('b-start', 'click', {}); await tick(); await tick();
    eq(t.sent[0].args.key, t.Rm.current().band.key, 'la orden va a la elegida');
    click(t, '#b-auto', {});
    eq(t.Rm.current().band.name, 'Suena');
  });
  test('Cambiar de zona: propone la de esa zona y se recuerda en el móvil', async () => {
    const t = await mando(), carpa = t.Dt.getFestival().escenarios[1].id;
    click(t, '.zchip', { dataset: { z: carpa } });
    eq(t.Rm.current().band.name, 'Lejos');
    eq(t.env.storage.get('showtime.remote.zone'), JSON.stringify(carpa));
  });
  test('En hora: pide confirmar antes de mandar', async () => {
    const t = await mando();
    t.env.fire('b-ontime', 'click', {});
    eq(t.env.getEl('sheet').hidden, false); ok(/^En hora · Suena/.test(t.env.getEl('sh-t').textContent));
    eq(t.sent.length, 0, 'nada sale sin confirmar');
    t.env.fire('sh-yes', 'click', {}); await tick(); await tick();
    eq(t.sent.length, 1); eq(t.sent[0].op, 'onTime');
  });
  test('Retraso: resumen con las mismas reglas que el Mac y la «huella» del resumen va en la orden', async () => {
    const t = await mando();
    click(t, '[data-delay]', { dataset: { delay: '10' }, disabled: false });
    eq(t.env.getEl('sh-t').textContent, 'Retraso en cascada');
    ok(/mueve 1/.test(t.env.getEl('sh-b').innerHTML), 'mueve «Viene» (lo que empieza desde ahora en Principal): ' + t.env.getEl('sh-b').innerHTML.slice(0, 200));
    t.env.fire('sh-yes', 'click', {}); await tick(); await tick();
    eq(t.sent.length, 1); eq(t.sent[0].op, 'delay'); eq(t.sent[0].args.minutes, 10);
    const n = Math.floor(C.nowAbs(new Date(NOW))), p = M0.delayPlan(t.Dt.getFestival(), t.Dt.getConfig(), { minutes: 10, zones: t.sent[0].args.zones, from: n });
    eq(t.sent[0].args.stamp, M0.delayStamp(p), 'el Mac solo lo aplica si su resumen coincide');
  });
  test('Retraso rechazado porque el horario cambió: vuelve a enseñar el resumen nuevo', async () => {
    const t = await mando();
    t.ctl.reply = { ok: false, msg: 'El horario ha cambiado desde el resumen', data: { stale: true } };
    click(t, '[data-delay]', { dataset: { delay: '5' }, disabled: false });
    t.env.fire('sh-yes', 'click', {}); await tick(); await tick(); await tick();
    eq(t.env.getEl('sheet').hidden, false, 'el resumen se reabre'); eq(t.env.getEl('sh-t').textContent, 'Retraso en cascada');
  });
  test('Bis desde el mando: pasada su hora, pide confirmar el rescate', async () => {
    const t = await mando({ fest: fest((add, P) => { add('Acaba', P, -40, -5); add('Entra', P, 15, 75); }) });
    t.Dt.loadSnapshot({ festival: t.Dt.getFestival(), config: {}, callDone: [], flash: null, avisos: [] });
    // la propuesta es «Entra»: se elige «Acaba» (la anterior)
    if (t.Rm.current().band.name !== 'Acaba') t.env.fire('prev', 'click', {});
    eq(t.Rm.current().band.name, 'Acaba');
    ok(/id="b-bis"[^>]*data-kind="show"/.test(t.env.getEl('band').innerHTML) && /Bis · Acaba/.test(t.env.getEl('band').innerHTML), 'botón «Bis · Acaba»');
    ok(/5 min/.test(t.env.getEl('band').innerHTML), 'quedan 5 de los 10 min de la ventana');
    click(t, '#b-bis', { dataset: { kind: 'show' }, disabled: false });
    ok(/^Bis · Acaba/.test(t.env.getEl('sh-t').textContent), 'confirma el bis: ' + t.env.getEl('sh-t').textContent);
    eq(t.sent.length, 0);
    t.env.fire('sh-yes', 'click', {}); await tick(); await tick();
    eq(t.sent[0].op, 'stretch'); eq(t.sent[0].args.on, true);
  });
  test('Extender prueba desde el mando (soundcheck); con la siguiente ya en ▶, desactivado; pasada la ventana, nada', async () => {
    const n = Math.floor(C.nowAbs(new Date(NOW)));
    let s = fest((add, P) => { add('Entra', P, 15, 75); });
    const P = s.escenarios[0].id;
    const r = C.addArtist(s, 'sc', { jornada: '2026-07-10', nombre: 'Prueba Omega', modo: 'sc', escenarioId: P, inicio: hm(n - 40), fin: hm(n - 3) }); ok(r.ok, r.error); s = r.state;
    const t = await mando({ fest: s });
    if (t.Rm.current().band.name !== 'Prueba Omega') t.env.fire('prev', 'click', {});
    eq(t.Rm.current().band.name, 'Prueba Omega');
    ok(/data-kind="sc"/.test(t.env.getEl('band').innerHTML) && /Extender prueba · Prueba Omega/.test(t.env.getEl('band').innerHTML), 'botón «Extender prueba»: ' + t.env.getEl('band').innerHTML.slice(-300));
    // La siguiente da ▶: el botón sigue a la vista pero desactivado
    const e = C.buildBlocks(s, { mode: 'all', day: 'all' }).find(b => b.name === 'Entra');
    const s2 = C.setReal(s, e.id, 'show', 'i', n - 1).state;
    t.Dt.loadSnapshot({ festival: s2, config: {}, callDone: [], flash: null, avisos: [] });
    if (t.Rm.current().band.name !== 'Prueba Omega') t.env.fire('prev', 'click', {});
    ok(/id="b-bis"[^>]*disabled/.test(t.env.getEl('band').innerHTML) && /Entra ya ha empezado/.test(t.env.getEl('band').innerHTML), 'desactivado: ' + t.env.getEl('band').innerHTML.slice(-300));
    // Con ventana de 5 min (ajuste del Panel) y la prueba acabada hace 8: ni bis ni Tiempo extra
    const base3 = fest((add, P2) => { add('Entra', P2, 15, 75); });
    const s3 = C.addArtist(base3, 'sc', { jornada: '2026-07-10', nombre: 'Prueba Vieja', modo: 'sc', escenarioId: base3.escenarios[0].id, inicio: hm(n - 40), fin: hm(n - 8) });
    ok(s3.ok, s3.error);
    const t3 = await mando({ fest: s3.state });
    t3.Dt.loadSnapshot({ festival: s3.state, config: { bisWindow: 5 }, callDone: [], flash: null, avisos: [] });
    if (t3.Rm.current().band.name !== 'Prueba Vieja') t3.env.fire('prev', 'click', {});
    eq(t3.Rm.current().band.name, 'Prueba Vieja');
    ok(!/b-bis|b-stretch/.test(t3.env.getEl('band').innerHTML), 'pasada la ventana, sin botón');
  });
  test('OK de CALL y Retirar mensaje', async () => {
    const t = await mando();
    click(t, '.callok', { dataset: { ck: 'Viene@123' }, disabled: false }); await tick(); await tick();
    eq(t.sent[0].op, 'callOk'); eq(t.sent[0].args.key, 'Viene@123');
    click(t, '#flash-off', {}); await tick(); await tick();
    eq(t.sent[1].op, 'flashOff');
  });
  test('Idioma: el Mando sigue el idioma que manda el Panel por la emisión', async () => {
    const t = await mando();
    eq(t.env.win.ShowtimeI18n.getLang(), 'es');
    t.Dt.loadSnapshot({ festival: fest(), config: { lang: 'en' }, callDone: [], flash: null, avisos: [] });
    eq(t.env.win.ShowtimeI18n.getLang(), 'en', 'llega en el paquete de emisión');
    t.Dt.loadSnapshot({ festival: fest(), config: { lang: 'es' }, callDone: [], flash: null, avisos: [] });
    eq(t.env.win.ShowtimeI18n.getLang(), 'es');
  });
  test('Reconexión: al volver a la app (pantalla encendida) o recuperar la red, reconecta a fondo', async () => {
    const t = await mando();
    t.env.win.document.visibilityState = 'visible';
    t.env.fire('document', 'visibilitychange', {});
    t.env.fire('window', 'online', {});
    eq(t.ctl.wakes, 2);
  });

  test('Tablet en horizontal: dos columnas (info a la izquierda; Retraso y Mensaje a la derecha); la botonera SIEMPRE fija abajo', () => {
    const h = D.src('remote.html').toString(), c = D.src('remote.css').toString();
    const L = h.indexOf('class="col-l"'), R = h.indexOf('class="col-r"'), M = h.indexOf('</main>'), nav = h.indexOf('class="actbar"');
    ok(L > 0 && R > L && M > R, 'columnas dentro de main');
    ok(h.indexOf('id="calls"') > L && h.indexOf('id="band"') > L && h.indexOf('id="band"') < R, 'CALL y banda a la izquierda');
    ok(h.indexOf('data-delay="5"') > R && h.indexOf('id="msg-text"') > R && h.indexOf('id="msg-text"') < M, 'Retraso y Mensaje a escena a la derecha');
    ok(nav > M, 'la botonera está fuera de las columnas (fija abajo)');
    ok(/\.actbar\{position:fixed;left:0;right:0;bottom:0/.test(c), 'fija abajo');
    ok(!/\.actbar\{position:static/.test(c), 'en horizontal NO se suelta');
    ok(/@media \(orientation:landscape\) and \(min-width:900px\) and \(min-height:600px\)\{/.test(c), 'dos columnas solo en horizontal de tablet');
    ok(/\.col-l,\.col-r\{display:contents\}/.test(c), 'de pie no cambia la maquetación');
    ok(/main\{display:grid;grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,1fr\)/.test(c), 'dos columnas');
  });

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
    console.log('Mando (remote.js): ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
