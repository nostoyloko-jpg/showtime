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
    if (o.zone) ROOM = E.withZoneKeys(ROOM, [o.zone]);
    const url = o.kind === 'staff' ? E.staffUrl(ROOM, 'http://x/') : E.remoteUrl(ROOM, 'http://x/', o.zone);
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

  // ── Mando de UNA zona (dec. 102) ──
  const zoneOf = (s, i) => s.escenarios[i].id;
  test('Mando de zona: solo ve su zona (sin selector), su etiqueta arriba y sus CALL; el telemetría dice qué zona es', async () => {
    const F = fest(), K = zoneOf(F, 1);
    const t = await mando({ fest: F, zone: K });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    eq(t.Rm.LOCK, K);
    eq(t.Rm.current().zid, K); eq(t.Rm.current().band.name, 'Lejos', 'propone la de SU zona');
    eq(t.env.getEl('zones').hidden, true, 'sin selector de zona');
    eq(t.env.getEl('zlock').hidden, false); eq(t.env.getEl('zlock').textContent, 'Carpa');
    const i = t.ctl.R.o.info(); eq(i.v, 'mando'); eq(i.s, K);
    ok(/Solo Carpa/.test(t.env.getEl('delay-hint').textContent), t.env.getEl('delay-hint').textContent);
  });
  test('Mando de zona: ▶ y retrasos van a su zona; los mensajes a Confidence, solo a la suya', async () => {
    const F = fest(), K = zoneOf(F, 1);
    const t = await mando({ fest: F, zone: K });
    t.env.fire('b-start', 'click', {}); await tick(); await tick();
    eq(t.sent[0].op, 'start'); eq(t.sent[0].args.key, t.Rm.current().band.key);
    t.env.fire('msg-text', 'input', {}); t.env.getEl('msg-text').value = 'HOLA';
    t.env.fire('msg-form', 'submit', { preventDefault() {} }); await tick(); await tick();
    const fl = t.sent.find(s => s.op === 'flash');
    eq(JSON.stringify(fl.args.zones), JSON.stringify([K]), 'Confidence: solo su zona');
    eq(t.env.getEl('msg-zones').hidden, true, 'sin elegir zonas');
    // Retraso: sin «Todas las zonas» en el resumen
    click(t, '[data-delay]', { dataset: { delay: '5' }, disabled: false }); await tick();
    ok(!/data-sc="all"/.test(t.env.getEl('sh-b').innerHTML), 'sin opción de todas las zonas');
  });
  test('Mando general (sin zona): como siempre, con selector y todas las zonas', async () => {
    const t = await mando();
    eq(t.Rm.LOCK, null); eq(t.env.getEl('zones').hidden, false); eq(t.env.getEl('zlock').hidden, true);
  });
  // ── Chat de Producción en el mando (dec. 104) ──
  test('Chat: botón flotante; el hilo llega del Mac, se pinta (míos a la derecha) y avisa con un punto si está cerrado', async () => {
    const F = fest(), K = zoneOf(F, 1);
    const t = await mando({ fest: F, zone: K });
    eq(t.env.getEl('chat-fab').hidden, false, 'el QR trae la clave de Producción: hay chat');
    t.ctl.R.o.onProdMessage({ type: 'chatlog', list: [{ id: 'a', at: 1, from: 'Marta', pid: 'prod_001', text: 'Hola', sm: false }] });
    eq(t.env.getEl('chat-dot').hidden, true, 'lo que ya había no cuenta como nuevo');
    t.ctl.R.o.onProdMessage({ type: 'chatlog', list: [{ id: 'a', at: 1, from: 'Marta', pid: 'prod_001', text: 'Hola', sm: false }, { id: 'b', at: 2, from: 'Marta', pid: 'prod_001', text: '¿Cambio?', sm: false }] });
    eq(t.env.getEl('chat-dot').hidden, false, 'mensaje nuevo con el chat cerrado: punto');
    t.env.fire('chat-fab', 'click', {}); await tick();
    eq(t.env.getEl('chat-sheet').hidden, false); eq(t.env.getEl('chat-dot').hidden, true);
    ok(t.sent.some(s => s.op === 'chatsync'), 'al abrir pide el hilo');
    ok(/¿Cambio\?/.test(t.env.getEl('chat-list').innerHTML));
    eq(t.env.getEl('chat-sig').textContent, '[Carpa]', 'firma de la zona');
  });
  test('Chat: enviar manda una orden firmada con el nombre; se ve al momento y no se duplica al llegar del Mac', async () => {
    const F = fest(), K = zoneOf(F, 1);
    const t = await mando({ fest: F, zone: K });
    t.env.fire('chat-fab', 'click', {}); await tick();
    t.env.getEl('chat-name').value = '  Ana  '; t.env.fire('chat-name', 'change', {});
    eq(t.env.storage.get('showtime.remote.name'), 'Ana', 'el nombre se recuerda');
    t.env.getEl('chat-text').value = 'Necesito pinza'; t.env.fire('chat-form', 'submit', { preventDefault() {} }); await tick(); await tick();
    const c = t.sent.find(s => s.op === 'chat');
    eq(c.args.text, 'Necesito pinza'); eq(c.args.name, 'Ana');
    ok(/cmsg me pend/.test(t.env.getEl('chat-list').innerHTML), 'pendiente, a la derecha');
    t.ctl.R.o.onProdMessage({ type: 'chatlog', list: [{ id: 'z', at: 5, from: '[Carpa] Ana', pid: 'mando:' + K, text: 'Necesito pinza', sm: false }] });
    const h = t.env.getEl('chat-list').innerHTML;
    eq((h.match(/Necesito pinza/g) || []).length, 1, 'sin duplicar'); ok(/cmsg me"/.test(h), 'mío');
    // Falla el envío: el texto vuelve al campo
    t.ctl.reply = { ok: false, msg: 'Sin conexión: la orden no ha salido' };
    t.env.getEl('chat-text').value = 'Otro'; t.env.fire('chat-form', 'submit', { preventDefault() {} }); await tick(); await tick();
    eq(t.env.getEl('chat-text').value, 'Otro'); ok(/No se ha enviado/.test(t.env.getEl('toast').textContent));
  });
  test('Chat: la hoja tiene altura fija con scroll interno y el campo fijo al pie', () => {
    const css = D.src('remote.css');
    ok(/\.csheet-box\{[^}]*height:min\(62dvh,560px\)[^}]*display:flex;flex-direction:column/.test(css), 'altura fija');
    ok(/\.csh-list\{flex:1 1 auto;min-height:0;overflow-y:auto/.test(css), 'la lista hace scroll');
    ok(/\.csh-f\{[^}]*flex:0 0 auto/.test(css), 'el campo queda al pie');
  });

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
  // ── Idioma, Fase 3: el Mando entero en el idioma que manda el Panel; cambia en caliente y vuelve ──
  const snapL = (t, lang, F) => t.Dt.loadSnapshot({ festival: F, config: { lang }, callDone: [], flash: null, avisos: [] });
  test('Idioma (Fase 3): banda, estado de conexión, pista de retraso y píldora en inglés al llegar lang:en, y de vuelta', async () => {
    const t = await mando(), F = fest(), el = id => t.env.getEl(id);
    snapL(t, 'en', F);
    eq(el('rx-t').textContent, 'CONNECTED');
    const band = el('band').innerHTML;
    ok(/SUGGESTED · 1 of 2/.test(band) && /Planned /.test(band) && /Playing as scheduled · ■ when it ends|In progress/.test(band) && /EXTRA TIME/.test(band), band);
    ok(!/PROPUESTA|Previsto|Sonando/.test(band), 'sin español');
    ok(/^Stage Principal \(or all, in the summary\) · what starts from \d\d:\d\d$/.test(el('delay-hint').textContent), el('delay-hint').textContent);
    ok(/Principal · On time/.test(el('drift').innerHTML), el('drift').innerHTML);
    snapL(t, 'es', F);
    eq(el('rx-t').textContent, 'CONECTADO');
    ok(/PROPUESTA · 1 de 2/.test(el('band').innerHTML) && /Principal · En hora/.test(el('drift').innerHTML), 'vuelve al español');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Idioma (Fase 3): la respuesta del Mac (en español) sale traducida; los mensajes rápidos salen en el idioma del Panel', async () => {
    const t = await mando(), F = fest();
    snapL(t, 'en', F); t.status('live');
    t.ctl.reply = { ok: false, msg: 'Suena ya ha terminado (21:00): para corregirlo, Deshacer' };
    t.env.fire('b-start', 'click', {}); await tick(); await tick();
    eq(t.env.getEl('toast').textContent, 'Not done · Suena has already finished (21:00): to fix it, Undo');
    t.ctl.reply = { ok: true, msg: 'Suena: empieza 21:10 · sale 30 min tarde' };
    t.env.fire('b-start', 'click', {}); await tick(); await tick();
    eq(t.env.getEl('toast').textContent, 'Done · Suena: starts 21:10 · starts 30 min late');
    click(t, '.msgp', { dataset: { msg: '5 MINUTOS' } }); await tick(); await tick();
    eq(t.sent[t.sent.length - 1].op, 'flash'); eq(t.sent[t.sent.length - 1].args.text, '5 MINUTES', 'el mensaje rápido, en inglés');
    snapL(t, 'es', F);
    click(t, '.msgp', { dataset: { msg: 'ÚLTIMO TEMA' } }); await tick(); await tick();
    eq(t.sent[t.sent.length - 1].args.text, 'ÚLTIMO TEMA');
  });
  test('Idioma (Fase 3): En hora y Retraso — la hoja de confirmación en inglés', async () => {
    const t = await mando(), F = fest();
    snapL(t, 'en', F); t.status('live');
    t.env.fire('b-ontime', 'click', {});
    ok(/^On time · Suena$/.test(t.env.getEl('sh-t').textContent), t.env.getEl('sh-t').textContent);
    eq(t.env.getEl('sh-yes').textContent, 'Yes, on time');
    ok(/Starts \(or started\) at its planned time/.test(t.env.getEl('sh-b').innerHTML));
    click(t, '[data-delay]', { dataset: { delay: '5' }, disabled: false });
    eq(t.env.getEl('sh-t').textContent, 'Cascading delay'); eq(t.env.getEl('sh-yes').textContent, 'Confirm');
    ok(/moves \d/.test(t.env.getEl('sh-b').innerHTML) && /All stages/.test(t.env.getEl('sh-b').innerHTML), t.env.getEl('sh-b').innerHTML.slice(0, 300));
  });
  test('Idioma (Fase 3): todo texto marcado en remote.html y todo tx() de remote.js tiene traducción; botonera START / FINISH / ON TIME', () => {
    const I = require('../i18n.js'), h = D.src('remote.html');
    const list = []; let m; const re = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*")*)>([^<]*)/g;
    while ((m = re.exec(h))) {
      [['aria', 'aria-label'], ['placeholder', 'placeholder'], ['title', 'title']].forEach(([d, a]) => { if (new RegExp(' data-i18n-' + d + '(?=[\\s/>]|$)').test(m[2])) { const v = new RegExp(' ' + a + '="([^"]*)"').exec(m[2]); if (v) list.push(v[1]); } });
      if (/ data-i18n(?=[\s/>]|$)/.test(m[2]) && m[3].trim()) list.push(m[3].trim());
    }
    ok(list.length > 20, list.length + ' textos');
    eq(list.filter(x => !I.txHas(x) && !/^(Confidence|Backstage|Manager)$/.test(x)).join(' | '), '', 'remote.html sin traducción');
    ['EMPEZAR', 'TERMINAR', 'EN HORA'].forEach(x => ok(new RegExp('<span data-i18n>' + x + '</span>').test(h), x + ' marcado'));
    eq(I.tx('EMPEZAR', null, 'en'), 'START'); eq(I.tx('TERMINAR', null, 'en'), 'FINISH'); eq(I.tx('EN HORA', null, 'en'), 'ON TIME');
    eq(I.tx('5 MINUTOS', null, 'en'), '5 MINUTES'); eq(I.tx('ÚLTIMO TEMA', null, 'en'), 'LAST SONG');
    const js = D.src('remote.js').replace(/^\s*\/\/.*$/gm, ''), miss = [];
    const rt = /\btx\((?:[^'()]*\?\s*)?'((?:[^'\\]|\\.)*)'(?:\s*:\s*'((?:[^'\\]|\\.)*)')?(?:\s*:\s*'((?:[^'\\]|\\.)*)')?(?:\s*:\s*'((?:[^'\\]|\\.)*)')?/g;
    while ((m = rt.exec(js))) [m[1], m[2], m[3], m[4]].forEach(k => { if (k && /[A-Za-zÁÉÍÓÚáéíóúÑñ]{2}/.test(k) && !I.txHas(k)) miss.push(k); });
    eq(miss.join(' | '), '', 'remote.js sin traducción');
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
