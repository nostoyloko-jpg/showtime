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
    env.getEl('msgdock').hidden = true; env.getEl('pmodal').hidden = true;   // como en live.html
    D.cargar(env, MODULOS.slice(0, 4));
    env.win.ShowtimeEmision.Receptor.prototype.sendProdMessage = async function (m) { sent.push(m); return { ok: true, msg: 'Enviado' }; };
    D.cargar(env, MODULOS.slice(4));
    return { env, sent, body: env.getEl('body'), dock: env.getEl('msgdock'), title: () => env.win.document.title };
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
