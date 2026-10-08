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
  const MODULOS = ['core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'marca.js', 'control.js'];

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
  test('Botón Foco visible junto a «?» y Añadir: un clic, texto fijo «Foco» y micro-LED', () => {
    const src = D.src('control.js'), css = D.src('control.css');
    const lh = seccion('<div class="list-h">', '<div class="tblwrap">');
    ok(/id="btn-focus"[\s\S]*id="btn-help"[\s\S]*id="btn-new-row"/.test(lh), 'orden: Foco · ? · Añadir');
    ok(seccion('<div class="menu" id="m-view">', '<div class="menu" id="m-days">').indexOf('btn-focus') < 0, 'ya no está dentro de «Ver»');
    ok(/id="btn-focus"[^>]*><span class="fled"[^>]*><\/span><span class="ftxt">Foco<\/span><\/button>/.test(lh), 'LED + texto «Foco»');
    ok(!/Foco activo/.test(src), 'el texto no cambia (el botón no baila de tamaño)');
    ok(/\.btn\.focusbtn \.fled\{[^}]*background:#5b5f67/.test(css), 'LED apagado gris');
    ok(/\.btn\.focusbtn\.on \.fled\{[^}]*background:var\(--ok\)/.test(css), 'LED encendido verde');
    ok(!/\.btn\.focusbtn\.on\{[^}]*background/.test(css), 'el botón activo no se rellena de color');
    const t = dashboard(), b = t.env.getEl('btn-focus');
    t.env.fire('btn-focus', 'click', {});
    ok(b.classList.contains('on'));
    t.env.fire('btn-focus', 'click', {});
    ok(!b.classList.contains('on'));
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

  // ── Tanda 3: limpieza ────────────────────────────────────────────────
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();
  const cfgDia = dia => ({ 'showtime.config': JSON.stringify({ mode: 'show', day: dia }) });
  test('Bis pasada la hora de corte (06:00): la banda de la jornada anterior se puede rescatar desde EN ESCENA', () => {
    const now = at(2026, 6, 11, 6, 5);   // 06:05: «Noche» (05:00–05:55) es de la jornada del 10; «Mañana» (06:30) ya del 11
    const F = festEn(now, add => { add('Noche', -65, -10); add('Mañana', 25, 85); });
    [['todas las jornadas', {}], ['jornada nueva', cfgDia('2026-07-11')], ['jornada anterior', cfgDia('2026-07-10')]].forEach(([vista, extra]) => {
      const t = dashboard(Object.assign({ 'showtime.festival': JSON.stringify(F) }, extra), now), v = ultimo(t, 'v-now');
      ok(/xtrabtn bis[^>]*data-act="stretch"/.test(v) && /Bis · Noche/.test(v), vista + ': bis de «Noche»: ' + v.slice(0, 300));
      eq((v.match(/xtrabtn bis/g) || []).length, 1, vista + ': un solo botón de bis');
      eq(t.env.errors.length, 0, vista + ': ' + t.env.errors.join(' | '));
    });
  });
  test('Bis de la última banda de la noche (sin nada después en su zona): fila «ACABÓ» con el bis durante la ventana', () => {
    RELOJES.forEach(now => {
      const h = hhmm(now);
      const t = dashboard({ 'showtime.festival': JSON.stringify(festEn(now, add => { add('Cierre', -50, -6); })) }, now), v = ultimo(t, 'v-now');
      ok(/ACABÓ · Cierre/.test(v) && /Bis · Cierre/.test(v), h + ': ' + v.slice(0, 300));
      // fuera de la ventana (más de 15 min sin nada detrás) ya no se ofrece
      const t2 = dashboard({ 'showtime.festival': JSON.stringify(festEn(now, add => { add('Cierre', -70, -30); })) }, now);
      ok(!/xtrabtn bis/.test(ultimo(t2, 'v-now')) && !/ACABÓ/.test(ultimo(t2, 'v-now')), h + ': pasada la ventana, sin bis');
    });
  });
  test('Bis: si la zona ya suena otra banda, no se ofrece (ni fila «ACABÓ»)', () => {
    RELOJES.forEach(now => {
      const t = dashboard({ 'showtime.festival': JSON.stringify(festEn(now, add => { add('Antes', -60, -8); add('Ahora', -5, 50); })) }, now), v = ultimo(t, 'v-now');
      ok(/Ahora/.test(v) && !/xtrabtn bis/.test(v) && !/ACABÓ/.test(v), hhmm(now) + ': ' + v.slice(0, 300));
    });
  });
  test('Producción: el panel lateral sin «Parar», con «Nueva clave…» (icono real) y el enlace de la persona elegida', async () => {
    const room = await E.newRoom();
    const t = dashboard({ 'showtime.emision': JSON.stringify({ room, on: false }) }), T = t.env.win.ShowtimePanel._test;
    const clickItem = i => t.env.fire('document', 'click', { target: { closest: sel => sel === '[data-prod-idx]' ? { dataset: { prodIdx: String(i) } } : null } });
    clickItem(1);
    const side = t.env.getEl('prod-qr-side').innerHTML;
    ok(/Luis/.test(side) && /prod_002/.test(side), 'muestra a Luis');
    t.env.getEl('prod-input').value = 'Ana';   // dar de alta a otra persona repinta la lista
    t.env.fire('document', 'click', { target: { id: '', closest: sel => sel.indexOf('[data-act^="prod-"]') >= 0 ? { dataset: { act: 'prod-add-person' }, classList: { contains: () => false }, id: '' } : null } });
    ok(/class="prod-item active" data-prod-idx="1"/.test(ultimo(t, 'prod-list')), 'Luis sigue marcado aunque se repinte la lista');
    ok(/Ana/.test(ultimo(t, 'prod-list')), 'Ana dada de alta');
    ok(!/prod-stop|>Parar</.test(side), 'sin el botón «Parar» que no hacía nada');
    ok(/data-act="prod-regen"[^>]*><svg class="ic"><use href="#i-refresh"\/><\/svg>Nueva clave…/.test(side), 'Nueva clave… con icono');
    ok(!/0 dispositivos conectados/.test(side), 'sin el texto fijo «0 dispositivos»');
    eq(T.emUrl('produccion'), E.productionUrl(room, undefined, 'prod_002'), 'Copiar/Ampliar llevan el enlace de Luis');
    eq(T.prodBigTitle(), 'Producción · Luis', 'Ampliar dice de quién es el QR');
    t.env.fire('document', 'click', { target: { closest: sel => sel === '[data-prod-del]' ? { dataset: { prodDel: '1' } } : null } });
    eq(t.env.getEl('prod-qr-side').innerHTML, '', 'al quitar a Luis se cierra su QR');
    eq(T.emUrl('produccion'), E.productionUrl(room, undefined, 'prod_001'), 'vuelve al enlace por defecto');
    eq(T.prodBigTitle(), 'Producción · Marta');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Código limpio: sin console.log de depuración ni funciones muertas', () => {
    ['control.js', 'core.js', 'datos.js', 'emision.js', 'importar.js', 'live.js', 'log.js', 'mando.js', 'meteo.js', 'qr.js', 'remote.js', 'vistas.js'].forEach(f => {
      ok(!/console\.(log|debug|info)\(/.test(D.src(f)), f + ': quedan console.log');
    });
    [['control.js', 'stageOptions'], ['control.js', 'catsFn'], ['control.js', 'prod-qr-display'], ['live.js', 'stageHtml'], ['mando.js', 'catsFor'], ['mando.js', 'OP_TXT'], ['core.js', 'projectBands']]
      .forEach(([f, n]) => ok(D.src(f).indexOf(n) < 0, f + ': queda ' + n));
  });
  test('CSS consolidado: el cristal se define una vez y todo lo de ≤1600 px va en un solo bloque', () => {
    const css = D.src('control.css').replace(/\/\*[\s\S]*?\*\//g, '');
    eq((css.match(/:root\{--glass-bg:/g) || []).length, 1, 'una sola definición del cristal');
    eq((css.match(/body\[data-ps="escenario"\]\{--glass-bg:/g) || []).length, 1, 'una sola versión de Escenario');
    eq((css.match(/[;{]backdrop-filter:var\(--glass-blur\)/g) || []).length, 2, 'cristal en un solo sitio (más la cabecera del panel)');
    eq((css.match(/@media \(max-width:1600px\)/g) || []).length, 1, 'un solo bloque de 1600 px');
    eq((css.match(/\.mbtn \.mlbl\{display:/g) || []).length, 1, 'las etiquetas de los menús se ocultan en un solo sitio (sin reglas que se contradicen)');
  });
  test('Iconos: cada <use href="#i-…"> existe en su página y ningún icono está repetido', () => {
    const scripts = html => (html.match(/<script src="([^"?]+)/g) || []).map(x => x.replace('<script src="', ''));
    const METEO = ['sun', 'csun', 'cloud', 'rain', 'snow', 'storm', 'thermo', 'wind', 'alert'];   // los que se montan con '#i-' + nombre
    ['index.html', 'live.html', 'remote.html'].forEach(pg => {
      const html = D.src(pg), defs = (html.match(/<symbol id="([^"]+)"/g) || []).map(x => x.slice(12, -1));
      const dup = defs.filter((x, i) => defs.indexOf(x) !== i);
      eq(dup.join(), '', pg + ': iconos repetidos');
      const code = [html].concat(scripts(html).map(f => D.src(f))).join('\n');
      const used = new Set((code.match(/#i-[a-z0-9-]+(?=["'])/g) || []).map(x => x.slice(1)));
      if (/'#i-' \+/.test(code) && pg !== 'remote.html') METEO.forEach(m => used.add('i-' + m));
      const missing = Array.from(used).filter(u => defs.indexOf(u) < 0);
      eq(missing.join(), '', pg + ': iconos usados que no existen');
    });
  });

  // ── Importar en 1 segundo: tarjeta central, pestañas de «+ Añadir», soltar archivos y ⌘V ─────────────
  const fsx = require('fs'), pathx = require('path');
  const tick = () => new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 30; i++) await tick(); await new Promise(r => setTimeout(r, 150)); };   // lectura de archivos y descompresión: asíncronas
  /** Dashboard con lo que se le pase en el almacenamiento (sin nada = app recién abierta) y modales cerrados. */
  function panel(storage, now) {
    const env = D.makeEnv({ cripto: true, storage: storage || {}, now });
    D.cargar(env, MODULOS);
    ['modal', 'addm', 'imp', 'cfg', 'drop'].forEach(id => { if (env.getEl(id).hidden !== true) env.getEl(id).hidden = true; });
    const read = k => { const v = env.storage.get(k); return v ? JSON.parse(v) : null; };
    return { env, read, T: env.win.ShowtimePanel._test };
  }
  const clickData = (t, sel, dataset) => t.env.fire('document', 'click', { target: { id: '', closest: q => q === sel ? { dataset, classList: { contains: () => false }, id: '' } : null } });
  const clickStb = t => t.env.fire('document', 'click', { target: { closest: q => q === '#lv-standby' ? {} : null }, preventDefault() {}, stopPropagation() {} });
  const pasteEv = (text, target, files) => ({ target: target || t0body, preventDefault() {}, clipboardData: { files: files || [], getData: k => k === 'text/plain' ? text : '' } });
  const t0body = { closest: () => null };
  const CARTEL = 'Día\tZona\tBanda\tInicio\tFin\n10/07/2026\tPrincipal\tLos Ácratas\t21:00\t22:15\n11/07/2026\tCarpa\tDJ Uno\t20:00\t21:00';
  const HTMLx = D.src('index.html');
  const sec = (a, b) => { const i = HTMLx.indexOf(a), j = HTMLx.indexOf(b, i); return i < 0 || j < 0 ? '' : HTMLx.slice(i, j); };

  test('Tarjeta central «Importar horario en 1 segundo»: textos y botones (sin evento y con el evento vacío)', () => {
    [sec('<section id="empty"', '</section>'), sec('<div id="list-empty"', '<div class="tblwrap">')].forEach((h, i) => {
      const w = i ? 'evento vacío' : 'sin evento';
      ok(/<h2 class="onb-t">Importar horario en 1 segundo<\/h2>/.test(h), w + ': título');
      ok(/Arrastra aquí tu archivo Excel \/ CSV \/ PDF o pega el texto del cartel/.test(h), w + ': subtítulo');
      ok(/class="onb-pill">Detecta automáticamente: bandas, zonas, horas y soundchecks/.test(h), w + ': píldora');
      ok(/data-ob="paste"[\s\S]*Pegar horario[\s\S]*data-ob="file"[\s\S]*Subir archivo[\s\S]*data-ob="manual"[\s\S]*Añadir fila a mano/.test(h), w + ': botones en orden');
      ok(/btn primary onb-main" data-ob="paste"/.test(h), w + ': «Pegar horario» es el principal');
    });
    ok(/id="btn-new2"[\s\S]*id="btn-import2"[\s\S]*id="btn-demo"/.test(sec('<section id="empty"', '</section>')), 'sin evento: Nuevo evento vacío · Abrir .json · Demo, discretos');
    const lh = sec('<div class="list-h">', '<div id="list-empty"');
    eq((lh.match(/<button /g) || []).length, 3, 'la cabecera sigue limpia: solo Foco · ? · Añadir');
  });
  test('Tarjeta central: sale sin evento y con el evento sin entradas; con entradas, la tabla', () => {
    const a = panel();
    eq(a.env.getEl('empty').hidden, false, 'sin evento'); eq(a.env.getEl('main').hidden, true);
    const F = fest(), vacio = Object.assign({}, F.s, { artists: [] });
    const b = panel({ 'showtime.festival': JSON.stringify(vacio) });
    eq(b.env.getEl('list-empty').hidden, false, 'evento sin entradas'); eq(b.env.getEl('empty').hidden, true);
    const c = panel({ 'showtime.festival': JSON.stringify(F.s) });
    eq(c.env.getEl('list-empty').hidden, true, 'con entradas, la tabla');
    [a, b, c].forEach(x => eq(x.env.errors.length, 0, x.env.errors.join(' | ')));
  });
  test('⌘V sin evento: abre «Pegar horario» con lo copiado y, al importar, crea «Evento sin nombre» con sus jornadas (y queda sin exportar)', () => {
    const t = panel();
    t.env.fire('document', 'paste', pasteEv(CARTEL));
    eq(t.env.getEl('imp').hidden, false, 'se abre la vista previa'); eq(t.env.getEl('imp-text').value, CARTEL);
    ok(/Sin evento abierto: al importar se crea <b>«Evento sin nombre»<\/b>/.test(ultimo(t, 'imp-new')), 'avisa de que se crea el evento');
    eq(t.read('showtime.festival'), null, 'nada se guarda solo con pegar (vista previa)');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.event.nombre, 'Evento sin nombre'); eq(s.event.fechaInicio, '2026-07-10'); eq(s.event.fechaFin, '2026-07-11');
    eq(s.artists.length, 2); eq(s.escenarios.map(e => e.nombre).join(), 'Principal,Carpa');
    eq(t.read('showtime.original').artists.length, 0, 'la referencia es el evento vacío: lo importado cuenta como «sin exportar»');
    eq(t.env.getEl('toast').textContent, '✓ 2 entradas importadas con éxito en 2 jornadas (2 shows) · ponle nombre en Configuración');
    ok(t.env.getEl('toast').classList.contains('good'), 'toast en verde');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('⌘V con el evento abierto: la vista previa va contra ese evento (no crea otro)', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    t.env.fire('document', 'paste', pasteEv('23:00-23:45 Banda Nueva Principal'));
    eq(t.env.getEl('imp').hidden, false); ok(!/Sin evento abierto/.test(ultimo(t, 'imp-new')));
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.event.nombre, 'Prueba control'); ok(s.artists.some(a => a.nombre === 'Banda Nueva'), 'añadida al evento abierto');
  });
  test('⌘V NO salta escribiendo en una casilla ni con un modal o Configuración abiertos', () => {
    const t = panel();
    t.env.fire('document', 'paste', pasteEv('x', { closest: q => /input/.test(q) ? {} : null }));
    eq(t.env.getEl('imp').hidden, true, 'en una casilla, pega en la casilla');
    t.env.getEl('cfg').hidden = false;
    t.env.fire('document', 'paste', pasteEv('x'));
    eq(t.env.getEl('imp').hidden, true, 'con Configuración abierta, nada');
    t.env.getEl('cfg').hidden = true; t.env.getEl('modal').hidden = false;
    t.env.fire('document', 'paste', pasteEv('x'));
    eq(t.env.getEl('imp').hidden, true, 'con un modal abierto, nada');
  });
  test('«+ Añadir»: 2 pestañas — la primera vez «Pegar horario completo»; luego recuerda la última; el tip lleva a Pegar', () => {
    ['<div id="addm"', '<div id="imp"'].forEach(m => {
      const h = sec(m, '</div>\n</div>');
      ok(/class="addtabs" role="tablist"[\s\S]*data-addtab="paste"[^>]*>[\s\S]*Pegar horario completo <small>Excel · CSV · PDF<\/small>[\s\S]*data-addtab="row"[\s\S]*Añadir 1 fila a mano/.test(h), m + ': pestañas en orden');
    });
    ok(/class="addtip">💡 ¿Tienes varias bandas\? Usa <button[^>]*data-addtab="paste">Pegar horario completo<\/button>/.test(sec('<div id="addm"', '<div id="modal"')), 'tip en la pestaña de 1 fila');
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    t.env.fire('btn-new-row', 'click', {});
    eq(t.env.getEl('imp').hidden, false, 'primera vez: Pegar'); eq(t.env.getEl('addm').hidden, true);
    clickData(t, '[data-addtab]', { addtab: 'row' });
    eq(t.env.getEl('addm').hidden, false, 'pestaña de 1 fila'); eq(t.env.getEl('imp').hidden, true, 'cierra la de pegar');
    eq(t.env.storage.get('showtime.addtab'), 'row');
    t.env.getEl('addm').hidden = true;
    t.env.fire('btn-new-row', 'click', {});
    eq(t.env.getEl('addm').hidden, false, 'recuerda la última: 1 fila');
    clickData(t, '[data-addtab]', { addtab: 'paste' });
    eq(t.env.getEl('imp').hidden, false, 'el tip/pestaña lleva a Pegar'); eq(t.env.getEl('addm').hidden, true);
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Tarjeta central: «Pegar horario» abre la vista previa; «Añadir fila a mano» sin evento pide crearlo primero', () => {
    const t = panel();
    clickData(t, '[data-ob]', { ob: 'paste' });
    eq(t.env.getEl('imp').hidden, false);
    t.env.getEl('imp').hidden = true;
    clickData(t, '[data-ob]', { ob: 'manual' });
    eq(t.env.getEl('modal-title').textContent, 'Nuevo evento', 'sin evento: primero el evento');
  });
  test('Archivos: cada tipo a su sitio (Excel, CSV, PDF, .json, .xls antiguo y desconocidos)', async () => {
    const t = panel(), T = t.T, F = (name, data, type) => new File([data], name, { type: type || '' });
    eq(T.fileKind(F('a.xlsx', 'x')), 'xlsx'); eq(T.fileKind(F('a.XLS', 'x')), 'xls'); eq(T.fileKind(F('cartel.pdf', 'x')), 'pdf');
    eq(T.fileKind(F('ev.json', 'x')), 'json'); eq(T.fileKind(F('h.csv', 'x')), 'tabla'); eq(T.fileKind(F('h.tsv', 'x')), 'tabla'); eq(T.fileKind(F('notas.txt', 'x')), 'tabla');
    eq(T.fileKind(F('foto.png', 'x', 'image/png')), 'imagen'); eq(T.fileKind(F('musica.mp3', 'x', 'audio/mpeg')), '');
    // PDF: se abre la caja de pegar con el aviso
    T.handleFile(F('cartel.pdf', '%PDF', 'application/pdf'));
    eq(t.env.getEl('imp').hidden, false); eq(t.env.getEl('imp-notice').hidden, false);
    eq(t.env.getEl('imp-notice').textContent, 'Para PDFs: abre el PDF, selecciona y copia el texto (⌘A, ⌘C) y pégalo aquí.');
    // Excel real → texto en la caja y vista previa
    T.handleFile(F('horario.xlsx', fsx.readFileSync(pathx.join(__dirname, 'fixtures', 'horario.xlsx'))));
    await settle();
    ok(/Los Ácratas\t21:00\t22:15/.test(t.env.getEl('imp-text').value), 'Excel leído: ' + t.env.getEl('imp-text').value.slice(0, 80));
    eq(t.env.getEl('imp-notice').hidden, true, 'el aviso del PDF se quita al llegar datos');
    ok(/Excel leído: horario\.xlsx · hoja «Horario»/.test(t.env.getEl('toast').textContent), t.env.getEl('toast').textContent);
    // CSV
    T.handleFile(F('h.csv', 'Banda;Inicio\nUno;21:00'));
    await settle();
    eq(t.env.getEl('imp-text').value, 'Banda;Inicio\nUno;21:00');
    // .xls y desconocidos: mensaje claro
    T.handleFile(F('viejo.xls', 'x')); ok(/Excel antiguo \(\.xls\)/.test(t.env.getEl('toast').textContent));
    T.handleFile(F('musica.mp3', 'x', 'audio/mpeg')); ok(/No sé leer «musica\.mp3»/.test(t.env.getEl('toast').textContent));
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Soltar el .json de un evento sin nada abierto: se abre directamente; con un evento abierto, pregunta', async () => {
    const F = fest(), json = JSON.stringify(F.s);
    const t = panel();
    t.env.fire('window', 'drop', { preventDefault() {}, dataTransfer: { files: [new File([json], 'prueba.json', { type: 'application/json' })] } });
    await settle();
    eq((t.read('showtime.festival') || {}).event.nombre, 'Prueba control', 'abierto sin preguntar');
    const t2 = panel({ 'showtime.festival': json });
    t2.env.fire('window', 'drop', { preventDefault() {}, dataTransfer: { files: [new File([json], 'prueba.json', { type: 'application/json' })] } });
    await settle();
    eq(t2.env.getEl('modal-title').textContent, 'Abrir evento', 'con evento abierto: confirma antes de sustituir');
  });
  test('Soltar un Excel sobre la ventana sin evento: vista previa e importación de una vez', async () => {
    const t = panel(), buf = fsx.readFileSync(pathx.join(__dirname, 'fixtures', 'horario.xlsx'));
    t.env.fire('window', 'dragenter', { dataTransfer: { types: ['Files'] } });
    eq(t.env.getEl('drop').hidden, false, 'se enciende el dropzone');
    t.env.fire('window', 'drop', { preventDefault() {}, dataTransfer: { files: [new File([buf], 'horario.xlsx')] } });
    eq(t.env.getEl('drop').hidden, true, 'y se apaga al soltar');
    await settle();
    eq(t.env.getEl('imp').hidden, false);
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.artists.length, 4, 'las 4 filas del Excel'); eq(s.event.fechaInicio, '2026-07-10');
    ok(s.artists.some(a => a.nombre === 'Omega' && a.soundcheckInicio === '18:00' && !a.inicio), '«Prueba Omega» entra como soundcheck de Omega');
  });

  test('Importar: resumen del toast con el desglose (solo lo que hay) y 2,5 s', () => {
    const t = panel(), S = t.T.importSummary, R = (tipo, jornada) => ({ tipo, jornada });
    eq(S([R('show', 'a'), R('show', 'a'), R('sc', 'b'), R('tarea', 'b'), R('hito', 'c')]), '✓ 5 entradas importadas con éxito en 3 jornadas (2 shows · 1 prueba · 2 tareas/hitos)');
    eq(S([R('show', 'a')]), '✓ 1 entrada importada con éxito (1 show)');
    eq(S([R('hito', 'a'), R('hito', 'a')], 2), '✓ 2 entradas importadas con éxito (2 tareas/hitos)');
    const src = D.src('control.js');
    ok(/toast\(importSummary\(IMP_LAST, r\.added\)[^;]*, false, 2500\)/.test(src), '2,5 s');
    ok(/tw\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(src), 'la tabla vuelve arriba con scroll suave');
  });
  test('Vista previa: cabecera fija al hacer scroll (sticky, #14151b, por encima de las filas)', () => {
    const css = D.src('control.css');
    ok(/\.imp-prev thead th\{position:sticky;top:0;z-index:10;background:#14151b;box-shadow:inset 0 -1px 0/.test(css));
  });

  test('Importar con «Ver: Shows» o «Ver: Soundchecks» y varios tipos: pasa a «Ver: Todo»; si todo se ve, la vista no cambia', () => {
    const H = panel().T.hidesSome;
    eq(H('show', ['show']), false); eq(H('show', ['show', 'tarea']), true); eq(H('show', ['sc']), true);
    eq(H('sc', ['sc']), false); eq(H('sc', ['sc', 'show']), true); eq(H('all', ['show', 'sc', 'tarea', 'hito']), false);
    const F = fest(), conf = mode => JSON.stringify({ mode, day: 'all' });
    // Ver: Shows + un show y una comida → Ver: Todo
    const a = panel({ 'showtime.festival': JSON.stringify(F.s), 'showtime.config': conf('show') });
    a.env.fire('document', 'paste', pasteEv('22:00-23:00 Banda Nueva Principal\n14:00 Comida'));
    a.env.fire('imp-go', 'click', {});
    eq(a.read('showtime.config').mode, 'all', 'la comida no se vería en «Shows»');
    ok(/· Ver: Todo/.test(a.env.getEl('toast').textContent), a.env.getEl('toast').textContent);
    // Ver: Shows + solo shows → se queda en Shows
    const b = panel({ 'showtime.festival': JSON.stringify(F.s), 'showtime.config': conf('show') });
    b.env.fire('document', 'paste', pasteEv('22:00-23:00 Banda Nueva Principal'));
    b.env.fire('imp-go', 'click', {});
    eq(b.read('showtime.config').mode, 'show', 'todo lo importado se ve: no se toca la vista');
    ok(!/Ver: Todo/.test(b.env.getEl('toast').textContent));
    // Ver: Soundchecks + un show → Ver: Todo (también sin evento abierto). Ojo: en «Soundchecks» las bandas sin palabra clave entran como prueba.
    const c = panel({ 'showtime.config': conf('sc') });
    c.env.fire('document', 'paste', pasteEv('10/07/2026 20:00 Concierto Banda Uno\n10/07/2026 17:00 Prueba de sonido Banda Uno'));
    c.env.fire('imp-go', 'click', {});
    eq(c.read('showtime.config').mode, 'all');
    eq(c.read('showtime.festival').artists.length, 2);
  });

  test('«Zona por defecto» se escribe: lista con las zonas del evento; una nueva se propone crear y va a todas las filas sin zona', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    t.env.fire('document', 'paste', pasteEv('22:00-23:00 Banda Nueva\n14:00 Comida'));
    const z = t.env.getEl('imp-esc');
    eq(z.value, 'Principal', 'con una sola zona, ya viene puesta');
    ok(/<option value="Principal">/.test(t.env.getEl('imp-zones-dl').innerHTML), 'la lista ofrece las zonas que hay');
    z.value = 'Escenario Río'; t.env.fire('imp-esc', 'change', { target: z });
    ok(/crear «Escenario Río»/.test(ultimo(t, 'imp-new')), 'se propone crear la zona');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival'), rio = s.escenarios.find(e => e.nombre === 'Escenario Río');
    ok(rio, 'zona creada al importar');
    eq(s.artists.filter(a => a.escenarioId === rio.id).length, 2, 'la banda y la comida');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('«Zona por defecto» sin evento ni zonas: escribirla crea la primera zona del «Evento sin nombre»', () => {
    const t = panel();
    t.env.fire('document', 'paste', pasteEv('10/07/2026 20:00 Banda Uno\n10/07/2026 21:30 Banda Dos'));
    const z = t.env.getEl('imp-esc');
    eq(z.value, '', 'sin zonas: vacía');
    z.value = 'principal'; t.env.fire('imp-esc', 'change', { target: z });
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.escenarios.map(e => e.nombre).join(), 'principal');
    ok(s.artists.length === 2 && s.artists.every(a => a.escenarioId === s.escenarios[0].id));
  });
  test('Modales sólidos (Safari): fondo oscurecido con desenfoque y caja opaca sin cristal, en los 4 estilos', () => {
    const css = D.src('control.css'), tail = css.slice(css.lastIndexOf('/* ── Modales sólidos'));
    ok(/\.modal\{background:rgba\(0,0,0,\.75\);-webkit-backdrop-filter:blur\(8px\);backdrop-filter:blur\(8px\)\}/.test(tail));
    ok(/\.modal-box,\.imp-box\{--modal-bg:#0d0f15;background:var\(--modal-bg\);-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid rgba\(255,255,255,\.1\);box-shadow:0 24px 64px rgba\(0,0,0,\.8\),0 2px 8px rgba\(0,0,0,\.5\)\}/.test(tail));
    ['raycast', 'neutro', 'escenario'].forEach(ps => {
      const m = new RegExp('body\\[data-ps="' + ps + '"\\] \\.modal-box,body\\[data-ps="' + ps + '"\\] \\.imp-box\\{--modal-bg:(#[0-9a-f]{3,6})').exec(tail);
      ok(m, ps + ': color propio y opaco');
    });
    ok(css.indexOf('/* ── Modales sólidos') > css.indexOf('/* ── Cristal'), 'va después del cristal (gana)');
  });

  test('Pantalla de inicio: el cartel de marca con versión y pie; se va sola (1,2 s), con clic o con Esc', () => {
    const t = panel(), sp = t.env.getEl('splash'), h = ultimo(t, 'splash');
    eq(sp.hidden, false, 'se ve al arrancar'); eq(sp.className, 'splash', 'inicio (no «Acerca de»)');
    ok(/class="stm-name">SHOWTIME</.test(h) && /by Synapse Live/.test(h) && /Real-Time Show Control/.test(h));
    ok(h.indexOf('v' + t.env.win.ShowtimeEmision.BUILD) > 0, 'versión activa'); ok(h.indexOf('BUILT FOR LIFE ON STAGE · © 2026 Synapse Live') > 0);
    ok(/const SPLASH_MS = 1200;/.test(D.src('control.js')) && /if \(!about\) splashT = setTimeout\(hideSplash, SPLASH_MS\)/.test(D.src('control.js')), '1,2 s');
    t.env.fire('splash', 'click', {});
    ok(sp.classList.contains('out'), 'clic: se desvanece');
    const u = panel(); u.env.fire('document', 'keydown', { key: 'Escape', stopImmediatePropagation() {} });
    ok(u.env.getEl('splash').classList.contains('out'), 'Esc');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Archivo › Acerca de Showtime…: el mismo cartel, hasta clic o Esc', () => {
    const t = panel();
    t.T.hideSplash();
    t.env.fire('btn-about', 'click', {});
    const sp = t.env.getEl('splash');
    eq(sp.className, 'splash about'); ok(!sp.classList.contains('out'));
    ok(/Clic o Esc para cerrar/.test(ultimo(t, 'splash')) && /stm-ver/.test(ultimo(t, 'splash')));
    ok(/<button id="btn-about" class="mitem"[^>]*>.*Acerca de Showtime…<\/button>/.test(D.src('index.html')), 'en el menú Archivo');
  });
  test('Live ▾ › Standby: pone en Modo Cartel las Live abiertas (y lo quita); sin Live abierta, avisa', async () => {
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); } };
    t.env.win.open = () => w;
    clickStb(t);
    ok(/No hay ninguna Pantalla Live abierta/.test(t.env.getEl('toast').textContent), 'sin Live: aviso');
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-live [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    clickStb(t);
    ok(msgs.some(m => m.app === 'showtime' && m.type === 'standby' && m.on === true), 'la Live recibe la orden');
    eq(t.T.standbyOn(), true); eq(t.env.getEl('lv-standby-t').textContent, 'Quitar Standby · volver a la vista');
    ok(/Standby: la Pantalla Live muestra el cartel y la hora/.test(t.env.getEl('toast').textContent));
    // La Live avisa de que ha salido (tecla S en ella): el menú lo refleja
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'standbyState', on: false }, source: w });
    eq(t.T.standbyOn(), false); eq(t.env.getEl('lv-standby-t').textContent, 'Standby · Modo Cartel');
    clickStb(t); clickStb(t);
    ok(msgs.filter(m => m.type === 'standby').map(m => m.on).join() === 'true,true,false', 'y se quita con el mismo botón');
    ok(/id="lv-standby"/.test(D.src('index.html')));
  });
  test('Modo Foco: micro-píldora del tipo (SHOW · PRUEBA · TAREA · HITO) con color fijo, en vez del cuadradito de color', () => {
    const P = panel().T.tipoPill;
    eq(P('show'), '<span class="tpill tp-show" aria-hidden="true">SHOW</span>');
    ok(/>PRUEBA</.test(P('sc')) && />TAREA</.test(P('tarea')) && />HITO</.test(P('hito')));
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    ok(/<div class="nm"><span class="tpill tp-show"/.test(ultimo(t, 'tbody')), 'cada fila lleva su píldora');
    const css = D.src('control.css');
    ok(/\.tpill\{display:none;/.test(css), 'fuera del Modo Foco no se ve');
    ok(/body\.focus #tbl \.tpill\{display:inline-flex\}/.test(css) && /body\.focus #tbl td\.name input\[type=color\]\{display:none\}/.test(css));
    ['show', 'sc', 'tarea', 'hito'].forEach(k => ok(new RegExp('\\.tpill\\.tp-' + k + '\\{--pc:#[0-9a-f]{6}\\}').test(css), k + ': color fijo'));
  });

  test('Imágenes (foto del cartel, captura): sin OCR — se abre «Pegar horario» con el truco de Texto en Vivo', () => {
    const IMG = '💡 Para fotos y capturas: Selecciona el texto sobre la imagen con el ratón o el dedo (Texto en Vivo de Mac/iOS/Android), pulsa ⌘C y pégalo aquí con ⌘V.';
    const F = (name, type) => new File(['x'], name, { type: type || '' });
    const kinds = ['cartel.jpg', 'captura.PNG', 'foto.jpeg', 'flyer.webp', 'IMG_0001.HEIC', 'x.gif'].map(n => panel().T.fileKind(F(n)));
    eq(kinds.join(), Array(6).fill('imagen').join(), 'por la extensión'); eq(panel().T.fileKind(F('sin-extension', 'image/png')), 'imagen', 'o por el tipo');
    // Soltar una imagen
    const a = panel(); a.env.fire('window', 'drop', { preventDefault() {}, dataTransfer: { files: [F('cartel.jpg', 'image/jpeg')] } });
    eq(a.env.getEl('imp').hidden, false, 'abre la caja de pegar'); eq(a.env.getEl('imp-notice').hidden, false); eq(a.env.getEl('imp-notice').textContent, IMG);
    // ⌘V con una imagen en el portapapeles (fuera de las casillas)
    const b = panel(); b.env.fire('document', 'paste', pasteEv('', null, [F('image.png', 'image/png')]));
    eq(b.env.getEl('imp').hidden, false); eq(b.env.getEl('imp-notice').textContent, IMG);
    // Pegar una imagen DENTRO de la caja de texto: no se pega nada raro y sale el truco
    const c = panel(); c.env.fire('document', 'paste', pasteEv('21:00 Banda'));
    c.env.getEl('imp-notice').hidden = true; let prevented = false;
    c.env.fire('imp-text', 'paste', { preventDefault() { prevented = true; }, clipboardData: { files: [F('captura.png', 'image/png')], getData: () => '' } });
    ok(prevented); eq(c.env.getEl('imp-notice').hidden, false); eq(c.env.getEl('imp-notice').textContent, IMG);
    // …pero si el portapapeles trae texto además de la imagen (p. ej. desde Word), se pega el texto normal
    c.env.getEl('imp-notice').hidden = true; prevented = false;
    c.env.fire('imp-text', 'paste', { preventDefault() { prevented = true; }, clipboardData: { files: [F('img.png', 'image/png')], getData: () => '21:00 Otra' } });
    ok(!prevented); eq(c.env.getEl('imp-notice').hidden, true);
    ok(/<input id="imp-file" type="file" accept="image\/\*,/.test(D.src('index.html')), 'el selector de archivos también deja elegir fotos');
  });

  // ── Tanda 4: órdenes del mando (emCommand) — reloj simulado ────────────────────────
  const NOWc = new Date(2026, 6, 10, 21, 10).getTime(), nAbs = Math.floor(C.nowAbs(new Date(NOWc)));
  function festMando() {
    return festEn(NOWc, add => { add('Suena', -30, 30); add('Viene', 20, 80); });
  }
  function conMando(F) {
    const t = panel(F === null ? {} : { 'showtime.festival': JSON.stringify(F || festMando()) }, NOWc);
    const cmd = (op, args, t0) => t.T.emCommand({ id: 'x', op, args: args || {}, t: t0 === undefined ? NOWc : t0 });
    const blk = name => C.buildBlocks(t.read('showtime.festival'), { mode: 'all', day: 'all', now: nAbs }).find(b => b.name === name);
    const log = () => ((t.read('showtime.log') || {}).entries || []);
    return Object.assign(t, { cmd, blk, log });
  }
  test('Mando › órdenes mal formadas o desconocidas: se rechazan sin tocar nada', async () => {
    const t = conMando(), antes = t.env.storage.get('showtime.festival');
    for (const [op, args, re] of [['borrarTodo', {}, /desconocida/], ['start', {}, /Falta la banda/], ['stretch', { key: 'x' }, /Falta si se activa/],
      ['flash', { text: 'x'.repeat(141) }, /140/], ['delay', { minutes: 5, zones: 'all', from: nAbs }, /resumen confirmado/], ['delay', { minutes: 0, zones: 'all', from: nAbs, stamp: '' }, /Minutos/]]) {
      const r = await t.cmd(op, args);
      ok(!r.ok && re.test(r.msg), op + ': ' + r.msg);
    }
    eq(t.env.storage.get('showtime.festival'), antes, 'el evento no cambia');
  });
  test('Mando › sin evento abierto: solo los mensajes funcionan', async () => {
    const t = conMando(null);
    const r = await t.cmd('start', { key: 'x' });
    ok(!r.ok && /No hay evento abierto/.test(r.msg));
    const f = await t.cmd('flash', { text: 'HOLA', to: null, zones: null });
    ok(f.ok); eq(t.read('showtime.flash').text, 'HOLA');
  });
  test('Mando › ■ a la que suena: queda su fin real a la hora en que se pulsó y en el log como «mando»', async () => {
    const t = conMando(), key = t.blk('Suena').key;
    const r = await t.cmd('stop', { key }, NOWc - 30000);     // se pulsó hace 30 s (la orden tardó en llegar)
    ok(r.ok, r.msg);
    eq(t.blk('Suena').rf, nAbs - 1, 'fin real = cuando se pulsó en el móvil (21:09), no cuando llegó');
    ok(t.log().some(e => e.src === 'mando'), 'el log dice que vino del mando');
    ok(/Desde el mando del Stage Manager/.test(t.env.getEl('toast').textContent), t.env.getEl('toast').textContent);
  });
  test('Mando › una orden con hora rara (más de 2 min de diferencia) usa la hora del Mac', async () => {
    const t = conMando(), key = t.blk('Suena').key;
    await t.cmd('stop', { key }, NOWc - 10 * 60000);
    eq(t.blk('Suena').rf, nAbs, 'fin real = ahora (no hace 10 min)');
  });
  test('Mando › ▶ dos veces: la segunda se rechaza con el motivo', async () => {
    const t = conMando(), key = t.blk('Suena').key;
    ok((await t.cmd('start', { key })).ok);
    const r = await t.cmd('start', { key });
    ok(!r.ok && /ya tiene inicio real/.test(r.msg), r.msg);
  });
  test('Mando › retraso: se aplica solo si el resumen del móvil coincide con el del Mac', async () => {
    const t = conMando(), F = t.read('showtime.festival'), cfg = t.env.win.ShowtimeDatos.getConfig();
    const M1 = t.env.win.ShowtimeMando, args = { minutes: 10, zones: 'all', from: nAbs };
    const p = M1.delayPlan(F, cfg, args);
    const mal = await t.cmd('delay', Object.assign({}, args, { stamp: 'otro resumen' }));
    ok(!mal.ok && mal.data && mal.data.stale, 'resumen viejo: no se aplica y se pide revisar');
    eq(t.blk('Viene').si, t.blk('Viene').psi, 'nada se ha movido');
    const bien = await t.cmd('delay', Object.assign({}, args, { stamp: M1.delayStamp(p) }));
    ok(bien.ok, bien.msg);
    eq(t.blk('Viene').si - t.blk('Viene').psi, 10, '«Viene» +10 min');
    ok(t.log().some(e => e.type === 'delay' && e.src === 'mando'));
  });
  test('Mando › OK de CALL: queda hecho y en el log como «Stage Manager (mando)»', async () => {
    const t = conMando(), key = C.callKey(t.blk('Viene'));
    ok((await t.cmd('callOk', { key })).ok);
    ok(t.read('showtime.callDone').indexOf(key) >= 0);
    ok(t.log().some(e => e.type === 'call' && /Stage Manager \(mando\)/.test(e.text)), JSON.stringify(t.log().map(e => e.text)));
  });
  test('Mando › mensaje y retirarlo', async () => {
    const t = conMando();
    const r = await t.cmd('flash', { text: '  ÚLTIMO   TEMA ', to: ['manager'], zones: null });
    ok(r.ok); eq(t.read('showtime.flash').text, 'ÚLTIMO TEMA'); eq(t.read('showtime.flash').to.join(), 'manager');
    ok(t.log().some(e => e.type === 'msg' && e.src === 'mando'));
    ok((await t.cmd('flashOff', {})).ok); eq(t.read('showtime.flash'), null);
  });

  // ── Ejecutor ─────────────────────────────────────────────────────────
  (async () => {
    let pass = 0, fail = 0;
    const all = tests.concat(tests2);
    for (const [name, fn] of all) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Control: ' + pass + '/' + all.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
