/* Tests de control.js (Dashboard) — sin dependencias.
 * Ordenador:  node tests/control.test.js
 * Carga control.js (y sus módulos) en un navegador simulado (tests/_dom.js): comprueba que la sintaxis es válida,
 * que el arranque no lanza errores (p. ej. «p is not defined») y que Producción y el log funcionan.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('control.test.js: solo en Node (node tests/control.test.js)'); return; }
  const vm = require('vm');
  const D = require('./_dom.js'), C = require('../core.js');
  const MODULOS = ['core.js', 'meteo.js', 'datos.js', 'importar.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'control.js'];

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // Festival de prueba con fecha de HOY (los OK de CALL de días pasados caducan)
  const d = new Date(), JOR = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function fest() {
    let s = C.newFestival({ nombre: 'Prueba control', fechaInicio: JOR, fechaFin: JOR, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state;
    const r = C.addArtist(s, 'show', { jornada: JOR, nombre: 'Banda A', escenarioId: s.escenarios[0].id, inicio: '23:30', fin: '23:59' });
    if (!r.ok) throw new Error(r.error); s = r.state;
    const b = C.buildBlocks(s, { mode: 'all', day: 'all' }).find(x => x.name === 'Banda A');
    return { s, key: C.callKey(b) };
  }
  /** Dashboard arrancado con festival y una persona de Producción (Marta = prod_001). */
  function dashboard(extra) {
    const F = fest();
    const storage = Object.assign({ 'showtime.festival': JSON.stringify(F.s), 'showtime.producers': JSON.stringify({ producers: [{ id: 'prod_001', name: 'Marta' }], counter: 1, defaultId: 'prod_001' }) }, extra || {});
    const env = D.makeEnv({ cripto: true, storage });
    D.cargar(env, MODULOS);
    const read = k => { const v = env.storage.get(k); return v ? JSON.parse(v) : null; };
    const callLog = () => ((read('showtime.log') || {}).entries || []).filter(e => e.type === 'call');
    return { env, F, read, callLog, prod: env.win.ShowtimePanel._test.emProdMessage };
  }

  // ── Arranque ─────────────────────────────────────────────────────────
  test('control.js: la sintaxis es válida', () => { new vm.Script(D.src('control.js'), { filename: 'control.js' }); });

  test('control.js: arranca sin errores (navegador sin cifrado)', () => {
    const env = D.makeEnv(); D.cargar(env, MODULOS);
    ok(env.errors.length === 0, 'console.error durante el arranque: ' + env.errors.join(' | '));
  });

  test('control.js: arranca sin errores (navegador con cifrado)', () => {
    const env = D.makeEnv({ cripto: true }); D.cargar(env, MODULOS);
    ok(env.errors.length === 0, 'console.error durante el arranque: ' + env.errors.join(' | '));
  });

  test('control.js: arranca con un festival cargado y Producción', () => {
    const t = dashboard();
    ok(t.env.errors.length === 0, t.env.errors.join(' | '));
    t.env.innerLog.filter(x => x[0] === 'prod-list').forEach(x => ok(!/undefined/.test(x[1]), 'HTML con «undefined» en la lista de productores'));
  });

  test('control.js: ningún innerHTML se monta con variables sueltas (p, qr) fuera de su ámbito', () => {
    const malas = [];
    D.src('control.js').split('\n').forEach((l, i) => { if (/innerHTML\s*=\s*'<div style="text-align:center;width:100%">.*esc\(p\.name\)/.test(l)) malas.push(i + 1); });
    ok(malas.length === 0, 'bloque QR pegado por error en las líneas ' + malas.join(', '));
  });

  test('Producción: el panel QR es lateral (no modal)', () => {
    const s = D.src('control.js');
    ok(/cprod-split/.test(s) && /prod-qr-side/.test(s), 'falta el layout split-panel');
    ok(!/id="prod-qr-display"/.test(s.replace(/e\.target\.id === 'prod-qr-display'/, '')), 'queda el modal prod-qr-display');
  });

  // ── CALL OK: quién lo da queda en el log ────────────────────────────
  test('OK de CALL desde Producción: se marca y el log dice qué persona (por nombre)', () => {
    const t = dashboard();
    t.prod({ type: 'call', from: 'prod_001', key: t.F.key });
    ok((t.read('showtime.callDone') || []).indexOf(t.F.key) >= 0, 'el CALL queda marcado como avisado');
    const l = t.callLog();
    eq(l.length, 1); eq(l[0].src, 'produccion');
    ok(l[0].text.indexOf('Banda A') >= 0 && l[0].text.indexOf('Producción (Marta)') >= 0, 'texto: ' + l[0].text);
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });

  test('OK de CALL desde Producción: persona desconocida → sale su id', () => {
    const t = dashboard(); t.prod({ type: 'call', from: 'prod_099', key: t.F.key });
    ok(t.callLog()[0].text.indexOf('Producción (prod_099)') >= 0);
  });

  test('OK de CALL: un CALL que no existe, o un mensaje manipulado, no se marca ni se apunta', () => {
    const t = dashboard();
    t.prod({ type: 'call', from: 'prod_001', key: 'Fantasma@999999' });
    t.prod({ type: 'call', from: '<b>x</b>', key: t.F.key });
    t.prod({ type: 'call', from: 'prod_001', key: 5 });
    t.prod(null); t.prod('hola');
    eq((t.read('showtime.callDone') || []).length, 0); eq(t.callLog().length, 0);
  });

  test('OK de CALL: si lo dan dos veces, queda apuntado el primero (una sola entrada)', () => {
    const t = dashboard();
    t.prod({ type: 'call', from: 'prod_001', key: t.F.key }); t.prod({ type: 'call', from: 'prod_002', key: t.F.key });
    eq(t.callLog().length, 1); ok(t.callLog()[0].text.indexOf('Marta') >= 0, 'el primero es el que cuenta');
  });

  test('OK de CALL desde el Panel del Stage Manager: queda como «Stage Manager»', () => {
    const t = dashboard();
    t.env.fire('v-call', 'click', { target: { closest: sel => sel === '.okbtn' ? { dataset: { ck: t.F.key } } : null } });
    const l = t.callLog(); eq(l.length, 1); eq(l[0].src, 'panel');
    ok(l[0].text.indexOf('Stage Manager') >= 0 && l[0].text.indexOf('Producción') < 0, l[0].text);
  });

  test('OK de CALL dado en una pantalla Live del Stage Manager: se detecta y se apunta', () => {
    const t = dashboard();
    t.env.storage.set('showtime.callDone', JSON.stringify([t.F.key]));       // lo escribe la otra ventana
    t.env.fire('window', 'storage', { key: 'showtime.callDone' });           // y el navegador avisa al Dashboard
    const l = t.callLog(); eq(l.length, 1);
    ok(l[0].text.indexOf('Stage Manager (pantalla Live)') >= 0, l[0].text);
  });

  test('OK de CALL ya apuntado (Producción) no se vuelve a apuntar al avisar la otra ventana', () => {
    const t = dashboard();
    t.prod({ type: 'call', from: 'prod_001', key: t.F.key });
    t.env.fire('window', 'storage', { key: 'showtime.callDone' });
    eq(t.callLog().length, 1);
  });

  // ── Mensajes de Producción a las pantallas Live ─────────────────────
  test('Mensaje de Producción: sale en las Live (como los «custom») y queda en el log con su autor', () => {
    const t = dashboard();
    t.prod({ type: 'flash', from: 'prod_001', text: '  Abrid puertas  ', to: ['backstage'] });
    const f = t.read('showtime.flash');
    ok(f, 'mensaje activo'); eq(f.text, 'Abrid puertas'); eq(f.to.join(), 'backstage');
    const m = ((t.read('showtime.log') || {}).entries || []).filter(e => e.type === 'msg');
    eq(m.length, 1); eq(m[0].src, 'produccion'); ok(m[0].text.indexOf('Producción (Marta)') >= 0, m[0].text);
  });

  test('Mensaje de Producción: NUNCA va a Confidence (sin destino = Manager y Backstage)', () => {
    const t = dashboard();
    t.prod({ type: 'flash', from: 'prod_001', text: 'Hola', to: [] });
    eq(t.read('showtime.flash').to.join(), 'manager,backstage', 'sin destino');
    const t3 = dashboard();
    t3.prod({ type: 'flash', from: 'prod_001', text: 'Hola', to: ['manager', 'confidence', 'backstage'] });
    eq(t3.read('showtime.flash').to.join(), 'manager,backstage', 'pidiendo las tres');
    const t4 = dashboard();
    t4.prod({ type: 'flash', from: 'prod_001', text: 'Hola', to: ['confidence'] });
    eq(t4.read('showtime.flash'), null, 'pidiendo solo Confidence: no sale en ninguna pantalla');
  });

  test('Mensaje de Producción: vacío o manipulado no sale', () => {
    const t2 = dashboard();
    t2.prod({ type: 'flash', from: 'prod_001', text: '   ' }); t2.prod({ type: 'flash', from: '<x>', text: 'hola' });
    eq(t2.read('showtime.flash'), null);
  });

  // ── Avisos (puntual / permanente) ─────────────────────────────────────
  const avisos = t => (t.read('showtime.avisos') || []);
  test('Aviso puntual de Producción: se guarda, dura lo de Configuración › Mensajes y queda en el log', () => {
    const t = dashboard();
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Lluvia en 10 min', perm: false });
    const a = avisos(t); eq(a.length, 1); eq(a[0].text, 'Lluvia en 10 min'); ok(a[0].ms > 0, 'puntual: con duración'); eq(a[0].from, 'Producción (Marta)');
    const m = ((t.read('showtime.log') || {}).entries || []).filter(e => e.type === 'msg');
    eq(m.length, 1); eq(m[0].src, 'produccion'); ok(m[0].text.indexOf('Aviso puntual') === 0 && m[0].text.indexOf('Marta') > 0, m[0].text);
  });

  test('Aviso permanente: sin caducidad y varios a la vez', () => {
    const t = dashboard();
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Prohibido fumar', perm: true });
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Lluvia', perm: false });
    const a = avisos(t); eq(a.length, 2, 'se suman'); eq(a[0].ms, 0, 'permanente');
    const Dt = t.env.win.ShowtimeDatos;
    const viejo = a.map(x => Object.assign({}, x, { at: x.at - 3600 * 1000 }));   // una hora después
    t.env.storage.set('showtime.avisos', JSON.stringify(viejo));
    const v = Dt.getAvisos(); eq(v.length, 1, 'el puntual caduca solo'); eq(v[0].text, 'Prohibido fumar', 'el permanente sigue');
  });

  test('Avisos en el Dashboard: salen con su ✕ y la ✕ los quita (y lo apunta en el log)', () => {
    const t = dashboard();
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Prohibido fumar', perm: true });
    const html = t.env.innerLog.filter(x => x[0] === 'drift').map(x => x[1]).pop() || '';
    ok(html.indexOf('Prohibido fumar') >= 0 && html.indexOf('data-aviso-x="') >= 0, 'chip con ✕: ' + html.slice(0, 200));
    const id = avisos(t)[0].id;
    t.env.fire('document', 'click', { target: { id: '', matches: () => false, closest: sel => sel === '[data-aviso-x]' ? { dataset: { avisoX: id } } : null } });
    eq(t.env.win.ShowtimeDatos.getAvisos().length, 0, 'quitado');
    const m = ((t.read('showtime.log') || {}).entries || []).filter(e => e.text.indexOf('Aviso retirado') === 0);
    eq(m.length, 1); eq(m[0].src, 'panel');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });

  test('Avisos: viajan en la emisión (snapshot) y uno vacío o manipulado no entra', () => {
    const t = dashboard();
    t.prod({ type: 'aviso', from: 'prod_001', text: '   ' }); t.prod({ type: 'aviso', from: '<x>', text: 'hola' });
    eq(avisos(t).length, 0);
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Hola', perm: true });
    eq(t.env.win.ShowtimeDatos.getSnapshot().avisos.length, 1, 'los móviles y la Live de Producción lo reciben');
  });

  // ── Ejecutor ─────────────────────────────────────────────────────────
  let pass = 0, fail = 0;
  tests.forEach(([name, fn]) => {
    try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
  });
  console.log('Control: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
  if (fail) process.exitCode = 1;
})();
