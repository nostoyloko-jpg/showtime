/* Tests de live.js (Pantalla Live) — sin dependencias.
 * Ordenador:  node tests/live.test.js
 * Carga live.js en un navegador simulado (tests/_dom.js), como Dashboard, como Staff (QR) y como Producción (QR con «id»).
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('live.test.js: solo en Node (node tests/live.test.js)'); return; }
  const vm = require('vm');
  const D = require('./_dom.js'), E = require('../emision.js');
  const MODULOS = ['core.js', 'meteo.js', 'datos.js', 'emision.js', 'vistas.js', 'live.js'];

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  let ROOM = null;
  const hashOf = url => url.slice(url.indexOf('#'));
  /** Arranca live.js. opts: { hash, search }. El envío a Producción se intercepta (no hay red). */
  function arrancar(opts) {
    const env = D.makeEnv(Object.assign({ cripto: true }, opts));
    const sent = [];
    env.getEl('msgdock').hidden = true; env.getEl('pmodal').hidden = true; env.getEl('chatdock').hidden = true;   // como en live.html
    D.cargar(env, MODULOS.slice(0, 4));
    const ctl = { fail: false };
    env.win.ShowtimeEmision.Receptor.prototype.sendProdMessage = async function (m) { if (ctl.fail) return { ok: false, msg: 'Sin conexión' }; sent.push(m); return { ok: true, msg: 'Enviado' }; };
    env.win.ShowtimeEmision.Receptor.prototype.start = async function () { env.win._R = this; };
    D.cargar(env, MODULOS.slice(4));
    return { env, sent, ctl, R: () => env.win._R, body: env.getEl('body'), dock: env.getEl('msgdock'), title: () => env.win.document.title };
  }
  const clickOk = (t, key) => t.env.fire('document', 'click', { target: { closest: sel => sel === '.callok' ? { dataset: { ck: key } } : null } });

  test('live.js: la sintaxis es válida', () => { new vm.Script(D.src('live.js'), { filename: 'live.js' }); });

  test('Live del Dashboard: arranca sin errores y sin mandos de Producción', () => {
    const t = arrancar({});
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    ok(!t.body.classList.contains('prod')); eq(t.dock.hidden, true, 'el menú de mensajes no sale');
  });

  test('Live de Staff (QR, sin id): solo lectura, sin menú de mensajes ni OK de CALL', async () => {
    ROOM = ROOM || await E.newRoom();
    const t = arrancar({ hash: hashOf(E.staffUrl(ROOM, 'http://x/')) });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    ok(t.body.classList.contains('ro') && !t.body.classList.contains('prod'));
    eq(t.dock.hidden, true);
    clickOk(t, 'Banda A@1000');
    eq(t.sent.length, 0, 'Staff no manda nada');
  });

  test('Live de Producción (QR con id): activa sus mandos y el menú de mensajes', async () => {
    ROOM = ROOM || await E.newRoom();
    const t = arrancar({ hash: hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001')), search: '?vista=manager' });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    ok(t.body.classList.contains('ro') && t.body.classList.contains('prod'));
    eq(t.dock.hidden, false, 'el menú de mensajes sale');
    eq(t.title(), 'Showtime · Manager');
  });

  test('Producción: solo Manager y Backstage (Confidence se cambia por Manager)', async () => {
    ROOM = ROOM || await E.newRoom();
    const h = hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001'));
    eq(arrancar({ hash: h, search: '?vista=confidence' }).title(), 'Showtime · Manager');
    eq(arrancar({ hash: h, search: '?vista=backstage' }).title(), 'Showtime · Backstage');
    const t = arrancar({ hash: h, search: '?vista=manager' });
    const key = (k) => t.env.fire('document', 'keydown', { key: k, target: { tagName: 'BODY' } });
    key('v'); eq(t.title(), 'Showtime · Backstage'); key('v'); eq(t.title(), 'Showtime · Manager', 'la tecla V no pasa por Confidence');
  });

  test('Producción: el OK de CALL se manda al Dashboard con quién lo da', async () => {
    ROOM = ROOM || await E.newRoom();
    const t = arrancar({ hash: hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001')) });
    clickOk(t, 'Banda A@1000');
    await new Promise(r => setImmediate(r));
    eq(t.sent.length, 1); eq(JSON.stringify(t.sent[0]), JSON.stringify({ type: 'call', from: 'prod_001', key: 'Banda A@1000' }));
  });

  /** Escribe, pulsa Enviar (abre el modal) y, si se indica, elige una opción del modal. */
  async function enviar(t, text, opcion) {
    t.env.getEl('md-text').value = text;
    t.env.fire('md-form', 'submit', { preventDefault() {} });
    if (opcion) t.env.fire('pmodal', 'click', { target: { closest: sel => sel === '[data-pm]' ? { dataset: { pm: opcion } } : null } });
    await new Promise(r => setImmediate(r));
  }
  async function prod() { ROOM = ROOM || await E.newRoom(); return arrancar({ hash: hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001')) }); }

  test('Producción: al enviar sale el modal «¿Dónde lo mandas?» y no se manda nada hasta elegir', async () => {
    const t = await prod();
    await enviar(t, '   '); eq(t.env.getEl('pmodal').hidden, true, 'vacío: ni modal');
    await enviar(t, 'Abrid puertas');
    eq(t.env.getEl('pmodal').hidden, false, 'modal abierto'); eq(t.sent.length, 0, 'aún no se manda');
    eq(t.env.getEl('pm-txt').textContent, '«Abrid puertas»');
  });

  test('Producción: «Ventanas Live» manda el mensaje con el destino elegido', async () => {
    const t = await prod();
    await enviar(t, 'Abrid puertas', 'live');
    eq(t.sent.length, 1); eq(t.sent[0].type, 'flash'); eq(t.sent[0].from, 'prod_001'); eq(t.sent[0].text, 'Abrid puertas'); eq(t.sent[0].to.length, 0, 'sin elegir = todas');
    eq(t.env.getEl('pmodal').hidden, true, 'el modal se cierra');
    eq(t.env.getEl('md-text').value, '', 'el campo se vacía al enviar');
    t.env.fire('md-to', 'click', { target: { closest: () => ({ dataset: { to: 'backstage' } }) } });
    await enviar(t, 'Solo backstage', 'live');
    eq(t.sent[1].to.join(), 'backstage');
  });

  test('Producción: aviso puntual y aviso permanente', async () => {
    const t = await prod();
    await enviar(t, 'Lluvia en 10 min', 'aviso');
    eq(JSON.stringify(t.sent[0]), JSON.stringify({ type: 'aviso', from: 'prod_001', text: 'Lluvia en 10 min', perm: false }));
    await enviar(t, 'Prohibido fumar en backstage', 'perm');
    eq(t.sent[1].type, 'aviso'); eq(t.sent[1].perm, true);
  });

  test('Producción: «Cancelar» no manda nada y deja el texto', async () => {
    const t = await prod();
    await enviar(t, 'Borrador', 'no');
    eq(t.sent.length, 0); eq(t.env.getEl('md-text').value, 'Borrador'); eq(t.env.getEl('pmodal').hidden, true);
    await enviar(t, 'Borrador');
    t.env.fire('document', 'keydown', { key: 'Escape', target: { tagName: 'BODY' } });
    eq(t.env.getEl('pmodal').hidden, true, 'Escape cierra el modal'); eq(t.sent.length, 0);
  });

  test('Staff y Producción no pueden crear ni quitar avisos por su cuenta (solo lectura)', async () => {
    const t = await prod();
    eq(t.env.win.ShowtimeDatos.addAviso('hola', true, 'x'), null);
  });

  // ── Chat ─────────────────────────────────────────────────────────────
  const log = (...m) => ({ type: 'chatlog', list: m.map((x, i) => Object.assign({ id: 'm' + i, at: 1000 + i, from: '', pid: '', sm: false }, x)) });
  const chatHtml = t => t.env.getEl('cd-list').innerHTML;

  test('Chat: solo en Producción; al conectar pide el chat al Dashboard', async () => {
    ROOM = ROOM || await E.newRoom();
    const s = arrancar({ hash: hashOf(E.staffUrl(ROOM, 'http://x/')) }); eq(s.env.getEl('chatdock').hidden, true, 'Staff no tiene chat');
    const t = await prod();
    eq(t.env.getEl('chatdock').hidden, false, 'Producción tiene chat');
    t.R().o.onStatus({ state: 'live', links: [] });
    t.R().o.onStatus({ state: 'live', links: [] });
    await new Promise(r => setImmediate(r));
    eq(t.sent.filter(m => m.type === 'chatsync').length, 1, 'lo pide una vez al conectar');
  });

  test('Chat: muestra los mensajes (los míos como «Tú») y avisa de los nuevos con un punto', async () => {
    const t = await prod();
    t.env.getEl('cd-dot').hidden = true;
    t.R().o.onProdMessage(log({ text: 'Hola equipo', sm: true }, { text: 'Yo aquí', pid: 'prod_001', from: 'Marta' }, { text: 'Y yo', pid: 'prod_002', from: 'Luis' }));
    const h = chatHtml(t);
    ok(h.indexOf('Stage Manager') >= 0 && h.indexOf('Hola equipo') >= 0, 'mensaje del SM');
    ok(/cd-m me[^>]*><small>Tú/.test(h), 'el mío como «Tú»: ' + h.slice(0, 300));
    ok(h.indexOf('Luis') >= 0, 'otra persona de Producción con su nombre');
    eq(t.env.getEl('cd-dot').hidden, false, 'punto de sin leer');
    t.env.fire('cdbtn', 'click', {});
    eq(t.env.getEl('cd-dot').hidden, true, 'al abrir se quita');
    t.R().o.onProdMessage(log({ text: 'Hola equipo', sm: true }, { text: 'Yo aquí', pid: 'prod_001' }, { text: 'Y yo', pid: 'prod_002' }));
    eq(t.env.getEl('cd-dot').hidden, true, 'con el chat abierto no hay punto');
  });

  test('Chat: enviar sale con «enviando…» hasta que vuelve del Dashboard', async () => {
    const t = await prod();
    t.env.getEl('cd-text').value = '  ¿Abrimos   puertas? ';
    t.env.fire('cd-form', 'submit', { preventDefault() {} });
    await new Promise(r => setImmediate(r));
    const m = t.sent.filter(x => x.type === 'chat');
    eq(m.length, 1); eq(m[0].text, '¿Abrimos puertas?'); eq(m[0].from, 'prod_001');
    ok(chatHtml(t).indexOf('enviando…') >= 0, 'pendiente');
    eq(t.env.getEl('cd-text').value, '');
    t.R().o.onProdMessage({ type: 'chatlog', list: [{ id: 'x', at: Date.now(), from: 'Marta', pid: 'prod_001', text: '¿Abrimos puertas?', sm: false }] });
    ok(chatHtml(t).indexOf('enviando…') < 0, 'confirmado');
  });

  test('Chat: si no se puede enviar, el texto vuelve al campo', async () => {
    const t = await prod(); t.ctl.fail = true;
    t.env.getEl('cd-text').value = 'Sin red';
    t.env.fire('cd-form', 'submit', { preventDefault() {} });
    await new Promise(r => setImmediate(r));
    eq(t.env.getEl('cd-text').value, 'Sin red'); ok(chatHtml(t).indexOf('enviando…') < 0);
  });

  test('Chat: un chat manipulado no rompe nada', async () => {
    const t = await prod();
    t.R().o.onProdMessage({ type: 'chatlog', list: 'nada' }); t.R().o.onProdMessage(null);
    t.R().o.onProdMessage(log({ text: '<img src=x onerror=alert(1)>' }));
    ok(chatHtml(t).indexOf('<img') < 0, 'escapado');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });

  test('Menú de mensajes de Producción: no ofrece Confidence', () => {
    const html = D.src('live.html'), dock = html.slice(html.indexOf('id="msgdock"'), html.indexOf('<script src="core.js'));
    ok(dock.indexOf('data-to="manager"') > 0 && dock.indexOf('data-to="backstage"') > 0, 'faltan Manager/Backstage');
    ok(!/confidence/i.test(dock), 'el menú de Producción no debe nombrar Confidence');
  });

  test('Escribir «f» en el campo de mensaje no pone pantalla completa', async () => {
    ROOM = ROOM || await E.newRoom();
    const h = hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001'));
    const env = D.makeEnv({ cripto: true, hash: h }); let n = 0;
    env.win.document.documentElement = new Proxy(env.getEl('html'), { get(t, k) { return k === 'requestFullscreen' ? () => { n++; } : t[k]; } });
    D.cargar(env, MODULOS);
    env.fire('document', 'keydown', { key: 'f', target: { tagName: 'INPUT' } }); eq(n, 0, 'escribiendo');
    env.fire('document', 'keydown', { key: 'f', target: { tagName: 'BODY' } }); eq(n, 1, 'fuera del campo sí');
  });

  // ── Ejecutor asíncrono ──────────────────────────────────────────────
  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Live: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 50);
  })();
})();
