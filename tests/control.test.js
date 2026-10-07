/* Tests de control.js (Dashboard) — sin dependencias.
 * Ordenador:  node tests/control.test.js
 * Carga control.js (y sus módulos) en un navegador simulado (tests/_dom.js): comprueba que la sintaxis es válida,
 * que el arranque no lanza errores (p. ej. «p is not defined») y que Producción y el log funcionan.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('control.test.js: solo en Node (node tests/control.test.js)'); return; }
  const vm = require('vm');
  const D = require('./_dom.js'), C = require('../core.js'), E = require('../emision.js');
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
  function dashboard(extra, now) {
    const F = fest();
    const storage = Object.assign({ 'showtime.festival': JSON.stringify(F.s), 'showtime.producers': JSON.stringify({ producers: [{ id: 'prod_001', name: 'Marta' }, { id: 'prod_002', name: 'Luis' }], counter: 2, defaultId: 'prod_001' }) }, extra || {});
    const env = D.makeEnv({ cripto: true, storage, now });
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

  test('Producción: alguien que no está en la lista (borrado o id inventado) no puede dar OK ni mandar nada', () => {
    const t = dashboard();
    t.prod({ type: 'call', from: 'prod_099', key: t.F.key });
    t.prod({ type: 'aviso', from: 'prod_099', text: 'hola', perm: true });
    t.prod({ type: 'chat', from: 'prod_099', text: 'hola' });
    eq((t.read('showtime.callDone') || []).length, 0); eq(t.callLog().length, 0);
    eq((t.read('showtime.avisos') || []).length, 0); eq((t.read('showtime.chat') || []).length, 0);
    ok(/«prod_099» no está en la lista/.test(t.env.getEl('toast').textContent), 'avisa: ' + t.env.getEl('toast').textContent);
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
    const a = avisos(t); eq(a.length, 1); eq(a[0].text, 'Lluvia en 10 min'); eq(a[0].ms, 120000, 'puntual: 2 min por defecto'); eq(a[0].from, 'Producción (Marta)');
    t.env.win.ShowtimeDatos.setConfig({ avisoSecs: 300 });
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Otro', perm: false });
    eq(avisos(t)[1].ms, 300000, 'con la duración de Configuración');
    eq(t.env.win.ShowtimeDatos.setConfig({ avisoSecs: 7 }).avisoSecs, 120, 'valor raro → 2 min');
    t.env.getEl('cfg-aviso-secs').value = '600'; t.env.fire('cfg-aviso-secs', 'change', { target: { value: '600', selectedOptions: [{ textContent: '10 min' }] } });
    eq(t.env.win.ShowtimeDatos.getConfig().avisoSecs, 600, 'el selector de Configuración la cambia');
    const m = ((t.read('showtime.log') || {}).entries || []).filter(e => e.type === 'msg');
    eq(m.length, 2, 'uno por aviso'); eq(m[0].src, 'produccion'); ok(m[0].text.indexOf('Aviso puntual') === 0 && m[0].text.indexOf('Marta') > 0, m[0].text);
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

  // ── Chat Producción ↔ Stage Manager ─────────────────────────────────
  const chat = t => (t.read('showtime.chat') || []);
  test('Chat: lo que escribe Producción se guarda con su nombre y avisa (punto de sin leer)', () => {
    const t = dashboard();
    t.env.getEl('chat-on').hidden = true;
    t.prod({ type: 'chat', from: 'prod_001', text: '¿Abrimos puertas ya?' });
    const c = chat(t); eq(c.length, 1); eq(c[0].from, 'Marta'); eq(c[0].pid, 'prod_001'); eq(c[0].sm, false); eq(c[0].text, '¿Abrimos puertas ya?');
    eq(t.env.getEl('chat-on').hidden, false, 'punto de sin leer');
    const html = t.env.innerLog.filter(x => x[0] === 'chat-list').map(x => x[1]).pop() || '';
    ok(html.indexOf('¿Abrimos puertas ya?') >= 0 && html.indexOf('Marta') >= 0, html.slice(0, 200));
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });

  test('Chat: el Stage Manager responde desde el Dashboard', () => {
    const t = dashboard();
    t.env.getEl('chat-text').value = '  Sí, abrid  ';
    t.env.fire('chat-form', 'submit', { preventDefault() {} });
    const c = chat(t); eq(c.length, 1); eq(c[0].sm, true); eq(c[0].text, 'Sí, abrid'); eq(c[0].from, 'Stage Manager');
    eq(t.env.getEl('chat-text').value, '', 'el campo se vacía');
    t.env.getEl('chat-text').value = '   ';
    t.env.fire('chat-form', 'submit', { preventDefault() {} });
    eq(chat(t).length, 1, 'vacío no se manda');
  });

  test('Chat: abrir el menú quita el punto; «pásame el chat» sin emisión no falla', () => {
    const t = dashboard();
    t.prod({ type: 'chat', from: 'prod_001', text: 'hola' });
    eq(t.env.getEl('chat-on').hidden, false);
    // el botón del menú es un comodín: se dispara su manejador directamente
    const mb = t.env.getEl('m-chat'); ok(mb, 'menú');
    t.prod({ type: 'chatsync', from: 'prod_001' });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });

  test('Chat: NO viaja en la emisión general (Staff no lo recibe), y basura no entra', () => {
    const t = dashboard();
    t.prod({ type: 'chat', from: 'prod_001', text: 'privado' });
    ok(!('chat' in t.env.win.ShowtimeDatos.getSnapshot()), 'el snapshot no lleva el chat');
    t.prod({ type: 'chat', from: '<x>', text: 'hola' }); t.prod({ type: 'chat', from: 'prod_001', text: '   ' });
    eq(chat(t).length, 1);
  });

  // ── Tanda 1 ─────────────────────────────────────────────────────────
  test('Almacenamiento lleno: aviso fijo de «NO SE ESTÁ GUARDANDO» y se quita al recuperarse', () => {
    const t = dashboard();
    t.env.getEl('savewarn').hidden = true;
    const real = t.env.win.localStorage.setItem; let lleno = true;
    t.env.win.localStorage.setItem = (k, v) => { if (lleno) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return real(k, v); };
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Prueba', perm: true });
    eq(t.env.getEl('savewarn').hidden, false, 'aviso visible');
    lleno = false;
    t.prod({ type: 'aviso', from: 'prod_001', text: 'Otra', perm: true });
    eq(t.env.getEl('savewarn').hidden, true, 'se quita al volver a guardar');
  });
  test('La URL privada del tiempo no sale en la emisión (ni dentro de meteo.key)', () => {
    const t = dashboard({ 'showtime.meteo': JSON.stringify({ key: 'url|0|0|https://estacion.ejemplo/api?token=SECRETO', snap: { at: 1 } }) });
    const snap = t.env.win.ShowtimeDatos.getSnapshot();
    ok(JSON.stringify(snap).indexOf('SECRETO') < 0, 'sin la URL'); ok(snap.meteo && snap.meteo.snap, 'el dato del tiempo sí');
  });
  test('Doble clic en la hora de una banda que ya empezó: abre la corrección del inicio real', () => {
    const t = dashboard(), b = t.F.s && C.buildBlocks(t.F.s, { mode: 'all', day: 'all' })[0];
    const td = { closest: sel => sel === 'tr' ? { dataset: { key: b.key } } : null };
    t.env.fire('document', 'dblclick', { target: { closest: sel => sel === 'td.est' ? td : null } });
    // la banda de prueba es a las 23:30: si aún no ha empezado, lo dice; si ya empezó, abre el selector
    const ttl = t.env.getEl('modal-title').textContent, tst = t.env.getEl('toast').textContent;
    ok(ttl === 'Hora real de inicio · Banda A' || /Banda A aún no ha empezado/.test(tst), 'abre el selector o explica que aún no empezó: ' + ttl + ' / ' + tst);
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Quitar a una persona de Producción ofrece cortarle el acceso con una clave nueva', async () => {
    const room = await E.newRoom();
    const t = dashboard({ 'showtime.emision': JSON.stringify({ room, on: false }) });
    t.env.fire('document', 'click', { target: { closest: sel => sel === '[data-prod-del]' ? { dataset: { prodDel: '0' } } : null } });
    eq(t.env.getEl('modal-title').textContent, 'Quitar acceso a Marta');
    eq(JSON.parse(t.env.storage.get('showtime.producers')).producers.map(p => p.id).join(), 'prod_002', 'quitada de la lista');
  });

  // ── Tanda 2: interfaz ────────────────────────────────────────────────
  const HTML = D.src('index.html');
  const seccion = (abre, cierra) => { const i = HTML.indexOf(abre), j = HTML.indexOf(cierra, i); return i < 0 || j < 0 ? '' : HTML.slice(i, j); };
  test('Barra superior en 3 bloques: Archivo y Deshacer · filtros y acciones · Live, Sin reposo, reloj y ⚙', () => {
    const izq = seccion('<header class="bar">', 'class="bsep"'), centro = seccion('class="menus mcenter"', '<div class="bright">'), der = seccion('<div class="bright">', '</header>');
    ok(/class="brand"/.test(izq) && /id="m-file"/.test(izq) && /id="btn-undo"/.test(izq) && /id="mods"/.test(izq), 'izquierda');
    ['m-view', 'm-days', 'm-delay', 'm-msg', 'm-cast', 'm-chat'].forEach(id => ok(centro.indexOf('id="' + id + '"') > 0, 'centro: ' + id));
    ['m-live', 'id="wake"', 'id="clock"', 'id="btn-cfg"'].forEach(x => ok(der.indexOf(x) > 0, 'derecha: ' + x));
    ok(/<span class="mlbl">Ver:<\/span>/.test(HTML) && /<span class="mlbl">Día:<\/span>/.test(HTML), 'Ver: / Día:');
    ok(!/id="mods" class="chip warn"/.test(HTML), 'la píldora de cambios no es amarilla');
    ok(!/Configuración<\/button>/.test(der), '⚙ sin texto');
  });
  test('Sin subtítulo repetido ni texto fijo encima de la tabla: ayuda «?» y ⌘/', () => {
    const lh = seccion('<div class="list-h">', '<div class="tblwrap">');
    ok(/class="sr-only"/.test(lh), 'el título queda solo para lectores de pantalla');
    ok(lh.indexOf('Intro o salir de la casilla') < 0, 'el texto fijo ya no está');
    ok(/id="btn-help"/.test(lh) && !/class="btn primary addnew"/.test(lh), '«?» y Añadir neutro');
    const t = dashboard();
    t.env.fire('btn-help', 'click', {});
    eq(t.env.getEl('modal-title').textContent, 'Atajos y ayuda');
    ok(/Intro.*Esc/.test(t.env.getEl('modal-body').innerHTML), 'los atajos están en la ayuda');
    t.env.getEl('modal-title').textContent = '';
    t.env.fire('document', 'keydown', { key: '/', metaKey: true, preventDefault() {} });
    eq(t.env.getEl('modal-title').textContent, 'Atajos y ayuda', '⌘/');
  });
  test('Etiquetas cortas: «Ver: Todo» y «Día: Todos»', () => {
    const t = dashboard({ 'showtime.config': JSON.stringify({ mode: 'all', day: 'all' }) });
    eq(t.env.getEl('view-lbl').textContent, 'Todo'); eq(t.env.getEl('day-lbl').textContent, 'Todos');
  });
  test('Hitos: tarjeta neutra; ámbar solo con margen < 15 min; roja si se rebasa', () => {
    const J = '2026-07-10', at2 = h => C.toAbs(J, h);
    let s = C.newFestival({ nombre: 'x', fechaInicio: J, fechaFin: J, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'P').state; const P = s.escenarios[0].id;
    const add = o => { const r = C.addArtist(s, o.tipo === 'hito' ? 'show' : 'show', Object.assign({ jornada: J, escenarioId: P }, o)); if (!r.ok) throw new Error(r.error); s = r.state; };
    add({ nombre: 'Banda', inicio: '20:00', fin: '21:50' });
    add({ nombre: 'Puertas', tipo: 'hito', inicio: '22:00' });        // margen 10 → ámbar
    add({ nombre: 'Curfew', tipo: 'hito', inicio: '23:30' });         // margen 100 → neutro
    const t = dashboard({ 'showtime.festival': JSON.stringify(s) });
    const h = t.env.win.ShowtimePanel._test.hitoChips(at2('21:00'));
    ok(/dchip absorb[^>]*>.*Puertas 22:00 · margen 10 min/.test(h), 'puertas en ámbar: ' + h);
    ok(/dchip hito[^>]*>.*Curfew 23:30 · margen 100 min/.test(h), 'curfew neutro: ' + h);
    ok(!/Puertas/.test(t.env.win.ShowtimePanel._test.hitoChips(at2('22:05'))), 'los hitos que ya pasaron no salen');
  });
  test('Sin reposo: interruptor con LED; se puede apagar y la elección se recuerda', async () => {
    const F = fest();
    const env = D.makeEnv({ cripto: true, storage: { 'showtime.festival': JSON.stringify(F.s) } });
    let rel = 0;
    env.win.navigator.wakeLock = { request: async () => ({ release: async () => { rel++; }, addEventListener() {} }) };
    env.win.document.visibilityState = 'visible';
    D.cargar(env, MODULOS);
    await new Promise(r => setTimeout(r, 0));
    const w = env.getEl('wake');
    eq(w.hidden, false); ok(w.classList.contains('on'), 'activo al abrir');
    env.fire('wake', 'click', {}); await new Promise(r => setTimeout(r, 0));
    ok(!w.classList.contains('on'), 'apagado'); eq(rel, 1); eq(env.storage.get('showtime.wake'), 'off', 'se recuerda');
    env.fire('wake', 'click', {}); await new Promise(r => setTimeout(r, 0));
    ok(w.classList.contains('on'), 'encendido otra vez'); eq(env.storage.has('showtime.wake'), false);
  });
  test('Estilos del Dashboard: tabla limpia en reposo, Añadir neutro, Live en rojo y números tabulares', () => {
    const css = D.src('control.css');
    ok(/#tbl tbody td select\{[^}]*appearance:none/.test(css), 'sin flechas en reposo');
    ok(/#tbl tbody tr:hover td input\[type=text\],#tbl tbody tr:hover td select\{[^}]*border-color/.test(css), 'controles al pasar el ratón');
    ok(/\.btn\.addnew\{[^}]*background:#14151b/.test(css), 'Añadir neutro');
    ok(/#m-live \.mbtn\.btn\.primary\{background:var\(--live\)/.test(css), 'Live en rojo');
    ok(/\.bar \.clock\{[^}]*color:#fff[^}]*tabular-nums/.test(css), 'reloj blanco y tabular');
    ok(/--dim:#8a8f98/.test(css), 'texto atenuado con contraste');
  });

  // ── Tanda 2 (remate): modo foco, SIGUIENTE sin Tiempo extra, bis en el CHANGEOVER ──
  test('Modo foco: desde «Ver ▾» o ⇧⌘F; oculta Jornada, Tipo, Notas y «···»; se recuerda en este equipo', () => {
    const t = dashboard(), body = t.env.getEl('body');
    ok(!body.classList.contains('focus'), 'apagado de entrada');
    t.env.fire('btn-focus', 'click', {});
    ok(body.classList.contains('focus'), 'encendido'); eq(t.env.storage.get('showtime.panel.focus'), '1');
    ok(/· Foco$/.test(t.env.getEl('view-lbl').textContent), 'se ve en «Ver»: ' + t.env.getEl('view-lbl').textContent);
    t.env.fire('document', 'keydown', { key: 'F', metaKey: true, shiftKey: true, preventDefault() {} });
    ok(!body.classList.contains('focus'), '⇧⌘F lo apaga'); eq(t.env.storage.has('showtime.panel.focus'), false);
    const t2 = dashboard({ 'showtime.panel.focus': '1' });
    ok(t2.env.getEl('body').classList.contains('focus'), 'al volver a abrir, sigue en modo foco');
    const css = D.src('control.css');
    ['.c-jor', 'td.f', '.c-tp', 'td.tp', '.c-n', 'td.n', 'th.mo', 'td.mo'].forEach(c => ok(css.indexOf('body.focus #tbl ' + c) >= 0, 'oculta ' + c));
    ok(/body\.focus #tbl tbody td\{[^}]*font-size:16px/.test(css), 'letra más grande');
    ['class="c-jor"', 'class="c-tp"', 'class="c-n"', 'id="btn-focus"'].forEach(x => ok(HTML.indexOf(x) > 0, x));
  });
  /** Reloj simulado: varias horas fijas, incluida la franja delicada de 04:00 a 08:00 (corte a las 06:00) y la medianoche. */
  const RELOJES = [[2026, 6, 10, 12, 0], [2026, 6, 10, 23, 50], [2026, 6, 11, 0, 20], [2026, 6, 11, 5, 30], [2026, 6, 11, 6, 40]].map(a => new Date(a[0], a[1], a[2], a[3], a[4]).getTime());
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /** Festival alrededor de la hora simulada: cada banda en la jornada que le toca por su hora de inicio. */
  function festEn(nowMs, fn) {
    const n = Math.floor(C.nowAbs(new Date(nowMs))), cut = { event: { dayCutoff: '06:00' } }, hm = m => C.fmtHM(((m % 1440) + 1440) % 1440);
    const bandas = []; fn((nombre, a, b) => bandas.push({ nombre, a, b }));
    const jors = bandas.map(x => C.jornadaOfAbs(cut, n + x.a)).sort();
    let s = C.newFestival({ nombre: 'x', fechaInicio: jors[0], fechaFin: jors[jors.length - 1], dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'P').state; const P = s.escenarios[0].id;
    bandas.forEach(x => { const r = C.addArtist(s, 'show', { jornada: C.jornadaOfAbs(cut, n + x.a), nombre: x.nombre, escenarioId: P, inicio: hm(n + x.a), fin: hm(n + x.b) }); if (!r.ok) throw new Error(r.error); s = r.state; });
    return s;
  }
  const ultimo = (t, id) => t.env.innerLog.filter(x => x[0] === id).map(x => x[1]).pop() || '';
  test('SIGUIENTE: sin botón de Tiempo extra (solo para la que suena o el bis) · reloj simulado a 5 horas distintas', () => {
    RELOJES.forEach(now => {
      const t = dashboard({ 'showtime.festival': JSON.stringify(festEn(now, add => { add('Suena', -30, 30); add('Viene', 45, 105); })) }, now);
      const next = ultimo(t, 'v-next'), enEscena = ultimo(t, 'v-now'), h = hhmm(now);
      eq(t.env.getEl('clock').textContent.slice(0, 5), h, 'el Dashboard usa el reloj simulado');
      ok(/Viene/.test(next), h + ': la siguiente sale: ' + next.slice(0, 120));
      ok(!/data-act="stretch"/.test(next), h + ': sin Tiempo extra en SIGUIENTE');
      ok(/Suena/.test(enEscena) && /data-act="stretch"/.test(enEscena), h + ': en EN ESCENA sí: ' + enEscena.slice(0, 160));
      eq(t.env.errors.length, 0, h + ': ' + t.env.errors.join(' | '));
    });
  });
  test('CHANGEOVER: botón «↺ Bis» mientras la banda que acaba de terminar se puede rescatar · reloj simulado a 5 horas distintas', () => {
    RELOJES.forEach(now => {
      const h = hhmm(now);
      const t = dashboard({ 'showtime.festival': JSON.stringify(festEn(now, add => { add('Acaba', -25, -5); add('Entra', 10, 70); })) }, now);
      const co = ultimo(t, 'v-now');
      ok(/CHANGEOVER/.test(co) && /xtrabtn bis[^>]*data-act="stretch"/.test(co) && /#i-undo/.test(co) && /Bis · Acaba/.test(co), h + ': bis en el cambio: ' + co.slice(0, 300));
      // Si ya se le dio ■ (terminó de verdad), no hay bis que rescatar
      let s2 = festEn(now, add => { add('Acaba', -25, -5); add('Entra', 10, 70); });
      const ac = s2.artists.find(x => x.nombre === 'Acaba');
      s2 = C.setReal(C.setReal(s2, ac.id, 'show', 'i', Math.floor(C.nowAbs(new Date(now))) - 25).state, ac.id, 'show', 'f', Math.floor(C.nowAbs(new Date(now))) - 5).state;
      const t2 = dashboard({ 'showtime.festival': JSON.stringify(s2) }, now);
      ok(/CHANGEOVER/.test(ultimo(t2, 'v-now')) && !/xtrabtn bis/.test(ultimo(t2, 'v-now')), h + ': con ■ dado, sin bis');
    });
  });
  test('Toast del modo foco: efímero (2 s) y con fundido de salida', () => {
    const src = D.src('control.js'), css = D.src('control.css');
    ok(/toast\(focusOn\(\) \? 'Modo foco activado' : 'Modo foco desactivado', false, 2000\)/.test(src), '2 s al cambiar el modo foco');
    ok(/toastOut = setTimeout\(\(\) => t\.classList\.add\('out'\)/.test(src) && /\.toast\.out\{opacity:0/.test(css), 'se va con fundido');
    const t = dashboard(); t.env.fire('btn-focus', 'click', {});
    eq(t.env.getEl('toast').textContent, 'Modo foco activado'); eq(t.env.getEl('toast').hidden, false);
  });
  test('Botón Foco visible junto a «?» y Añadir: un clic, «Foco» ↔ «Foco activo»', () => {
    const lh = seccion('<div class="list-h">', '<div class="tblwrap">');
    ok(/id="btn-focus"[\s\S]*id="btn-help"[\s\S]*id="btn-new-row"/.test(lh), 'orden: Foco · ? · Añadir');
    ok(seccion('<div class="menu" id="m-view">', '<div class="menu" id="m-days">').indexOf('btn-focus') < 0, 'ya no está dentro de «Ver»');
    const t = dashboard(), b = t.env.getEl('btn-focus'), tx = { textContent: '' };
    b.querySelector = () => tx;   // el comodín no tiene hijos: se le da el texto del botón
    t.env.fire('btn-focus', 'click', {});
    ok(b.classList.contains('on')); eq(tx.textContent, 'Foco activo');
    t.env.fire('btn-focus', 'click', {});
    ok(!b.classList.contains('on')); eq(tx.textContent, 'Foco');
  });

  // ── Clave propia de Producción ─────────────────────────────────────────
  const tests2 = [];
  tests2.push(['Clave de Producción: una sala anterior (sin clave) recibe la suya al abrir el Dashboard; Staff y mando no cambian', async () => {
    const room = await E.newRoom(); delete room.q;
    const t = dashboard({ 'showtime.emision': JSON.stringify({ room, on: false }) });
    const saved = JSON.parse(t.env.storage.get('showtime.emision')).room;
    ok(saved.q && E._.unb64u(saved.q).length === 16, 'clave nueva guardada');
    eq(saved.k, room.k, 'la de Staff no cambia'); eq(saved.c, room.c, 'la del mando no cambia');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  }]);
  tests2.push(['Clave de Producción: «Regen» del panel de Producción pide confirmación', async () => {
    const t = dashboard();
    t.env.fire('document', 'click', { target: { id: '', closest: sel => sel.indexOf('[data-act^="prod-"]') >= 0 ? { dataset: { act: 'prod-regen' }, classList: { contains: () => false }, id: '' } : null } });
    eq(t.env.getEl('modal-title').textContent, 'Nueva clave de Producción');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  }]);

  // ── Ejecutor ─────────────────────────────────────────────────────────
  (async () => {
    let pass = 0, fail = 0;
    const all = tests.concat(tests2);
    for (const [name, fn] of all) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Control: ' + pass + '/' + all.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
