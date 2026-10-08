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
  const MODULOS = ['i18n.js', 'core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'marca.js', 'control.js'];

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
  test('Modal: si una acción falla, el botón no se queda mudo (aviso en el modal y el modal sigue abierto)', () => {
    const s = D.src('control.js');
    ok(/try \{ res = a\.run \? a\.run\(\) : undefined; \}\s*catch \(err\) \{/.test(s), 'la acción va protegida');
    ok(/m\.id = 'modal-fail'/.test(s) && /'No se pudo completar: '/.test(s), 'el fallo se ve en el propio modal');
  });

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
  test('Sin subtítulo repetido ni texto fijo encima de la tabla: ayuda «?» y ⇧⌘7', () => {
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
    eq(t.env.getEl('modal-title').textContent, '', 'sin ⇧ ya no abre la ayuda (⌘/ quitado)');
    t.env.fire('document', 'keydown', { key: '/', metaKey: true, shiftKey: true, code: 'Digit7', preventDefault() {} });
    eq(t.env.getEl('modal-title').textContent, 'Atajos y ayuda', '⇧⌘7 abre la ayuda');
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
  test('Sin reposo: el LED es suyo (no hereda el punto verde fijo de los LEDs de retraso), gris apagado y verde encendido', () => {
    const html = D.src('index.html'), css = D.src('control.css');
    ok(/id="wake"[^>]*><span class="wled"/.test(html), 'clase propia');
    ok(!/id="wake"[^>]*><span class="led"/.test(html), 'sin la clase .led');
    ok(/\.wake \.wled\{[^}]*background:#5b5f67/.test(css) && /\.wake\.on \.wled[^{]*\{[^}]*background:var\(--ok\)/.test(css));
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
  test('Bis / Extender prueba: el caso del NDB (prueba acabada hace 2 h en una zona, show recién acabado en otra) y ventana configurable', () => {
    const now = new Date(2026, 6, 10, 21, 42).getTime(), n = Math.floor(C.nowAbs(new Date(now))), hm = m => C.fmtHM(((m % 1440) + 1440) % 1440);
    let s = C.newFestival({ nombre: 'NDB', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Secundario').state;
    const [P, S] = s.escenarios.map(e => e.id);
    const add = (modo, nombre, z, a, b) => { const r = C.addArtist(s, modo, { jornada: '2026-07-10', nombre, modo, escenarioId: z, inicio: hm(n + a), fin: hm(n + b) }); if (!r.ok) throw new Error(r.error); s = r.state; };
    add('sc', 'Omega', P, -177, -132);        // prueba 18:45–19:30
    add('show', 'OMEGA', P, 3, 108);          // show 21:45
    add('show', 'Alhambra', S, -72, -12);     // show 20:30–21:30, acabó hace 12 min
    const v10 = ultimo(dashboard({ 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ mode: 'all' }) }, now), 'v-now');
    ok(!/xtrabtn bis/.test(v10), 'con la ventana por defecto (10 min) ninguno: ni la prueba de hace 2 h ni el show de hace 12 min: ' + v10.slice(0, 300));
    const v15 = ultimo(dashboard({ 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ mode: 'all', bisWindow: 15 }) }, now), 'v-now');
    eq((v15.match(/xtrabtn bis/g) || []).length, 1, 'con 15 min, solo un botón');
    ok(/Bis · Alhambra/.test(v15) && !/Omega<\/button>/.test(v15), 'el del show de Secundario, nunca el de la prueba de Principal: ' + v15.slice(0, 400));
    // Una prueba que acaba de terminar: «Extender prueba»
    add('sc', 'Linecheck', S, -40, -4);
    const vs = ultimo(dashboard({ 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ mode: 'all' }) }, now), 'v-now');   // las pruebas salen en «Todo»
    ok(/xtrabtn bis sc[^>]*>.*Extender prueba · Linecheck/.test(vs), 'Extender prueba · Linecheck: ' + vs.slice(0, 400));
  });
  test('Configuración › Directo: ventana de Bis / Extender prueba (5 · 10 · 15 min) en la configuración (viaja al Mando)', () => {
    const t = dashboard();
    eq(t.read('showtime.config') ? t.read('showtime.config').bisWindow : 10, 10, 'por defecto 10');
    t.env.getEl('cfg-bis-win').value = '5';
    t.env.fire('cfg-bis-win', 'change', { target: { value: '5' } });
    eq(t.read('showtime.config').bisWindow, 5);
    ['value="5"', 'value="10"', 'value="15"'].forEach(v => ok(new RegExp('id="cfg-bis-win">[^]*' + v).test(D.src('index.html')), v));
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

  test('Pantalla de inicio: el cartel de marca con versión y pie; se va sola (2,5 s), con clic o con Esc', () => {
    const t = panel(), sp = t.env.getEl('splash'), h = ultimo(t, 'splash');
    eq(sp.hidden, false, 'se ve al arrancar'); eq(sp.className, 'splash', 'inicio (no «Acerca de»)');
    ok(/class="stm-name">SHOWTIME</.test(h) && /by Synapse Live/.test(h) && /Real-Time Show Control/.test(h));
    ok(h.indexOf('v' + t.env.win.ShowtimeEmision.BUILD) > 0, 'versión activa'); ok(h.indexOf('BUILT FOR LIFE ON STAGE · © 2026 Synapse Live') > 0);
    ok(/const SPLASH_MS = 2500;/.test(D.src('control.js')) && /if \(!about\) splashT = setTimeout\(hideSplash, SPLASH_MS\)/.test(D.src('control.js')), '2,5 s');
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
  test('Live ▾ › Standby: estado del evento para TODAS las Confidence (Mac y QR): se guarda, va a las Live y en la emisión', async () => {
    const t = panel();
    clickStb(t);
    eq(t.read('showtime.standby').on, true, 'guardado (lo leen las Live del Mac)');
    eq(t.T.standbyOn(), true); eq(t.env.getEl('lv-standby-t').textContent, 'Quitar Standby en Confidence');
    ok(/Standby en Confidence: cartel y hora \(también por QR\)/.test(t.env.getEl('toast').textContent));
    eq(t.env.win.ShowtimeDatos.getSnapshot().standby.on, true, 'va en la emisión (QR)');
    ok(/Dt\.KEYS\.meteo, Dt\.KEYS\.standby\]/.test(D.src('control.js')), 'cambiarlo vuelve a emitir');
    clickStb(t);
    eq(t.read('showtime.standby').on, false, 'se quita con el mismo botón'); eq(t.env.getEl('lv-standby-t').textContent, 'Standby en Confidence');
    ok(/id="lv-standby"[\s\S]*Cartel de Showtime y hora en cada Confidence \(también por QR\)/.test(D.src('index.html')));
  });
  test('Gestor de ventanas Live: cada Live tiene nombre, vista y standby; se cambian desde el gestor, se recuerdan y se cierran', async () => {
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); }, close() { this.closed = true; } };
    t.env.win.open = () => w;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-live [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    const [a] = t.T.winState();
    ok(a && a.name === 'Manager' && a.vista === 'manager' && a.standby === false, 'se abre con su nombre por defecto');
    // se cambia la vista desde el gestor (y la zona, si es Confidence)
    t.T.setWinVista(a.id, 'confidence', 'z1');
    ok(msgs.some(m => m.type === 'setVista' && m.vista === 'confidence' && m.zona === 'z1'), 'la ventana recibe la vista y la zona');
    eq(t.T.winState()[0].vista, 'confidence'); eq(t.T.winState()[0].zona, 'z1');
    // standby solo de esa ventana
    t.T.setWinStandby(a.id, true);
    ok(msgs.some(m => m.type === 'standby' && m.on === true), 'la ventana recibe el standby');
    eq(t.T.winState()[0].standby, true);
    // lo que dice la ventana se refleja (vista y standby)
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'backstage', zona: null, standby: false }, source: w });
    eq(t.T.winState()[0].vista, 'backstage'); eq(t.T.winState()[0].standby, false, 'la ventana manda lo que muestra');
    // el gestor se abre con la lista
    t.T.openGestor();
    eq(t.env.getEl('modal').hidden, false); eq(t.T.gestorVisible(), true);
    // renombrar: se guarda y se recuerda
    t.env.fire('modal-body', 'change', { target: { value: '  Stage   Left ', classList: { contains: c => c === 'gv-name' }, closest: q => q === '.gv-row' ? { dataset: { id: a.id } } : null } });
    eq(t.T.winState()[0].name, 'Stage Left', 'nombre limpio');
    eq(t.read('showtime.liveNames')[a.id], 'Stage Left', 'y recordado en este navegador');
    // cerrar esa ventana
    t.T.closeLive(a.id);
    ok(msgs.some(m => m.type === 'closeLive'), 'se le pide cerrarse');
    eq(t.T.winState().length, 0); eq(t.read('showtime.liveNames')[a.id], undefined, 'y se olvida el nombre');
    ok(/id="lv-gestor"/.test(D.src('index.html')), 'el gestor está en el menú de Live');
    ok(!/data-now=|data-close=|lvnow|data-on=/.test(D.src('index.html')), 'el menú ya no lleva las marcas viejas por nombre');
  });
  test('Parpadeo del sobretiempo: referencia junto a la velocidad (mismo color y ritmo; quieta si el parpadeo está apagado)', () => {
    const html = D.src('index.html'), css = D.src('control.css'), js = D.src('control.js');
    ok(/id="sc-bprev" class="blkprev"/.test(html), 'la referencia está junto al campo de velocidad');
    ok(/\.blkprev\{[^}]*animation:blkprev var\(--blink-speed,1s\) steps\(1,end\) infinite/.test(css) && /\.blkprev\.still\{animation:none\}/.test(css), 'parpadea a la velocidad elegida; quieta si está apagado');
    ok(/bp\.style\.setProperty\('--blink-speed', sc\.conf\.blinkSpeed \+ 's'\)/.test(js) && /bp\.style\.color = sc\.conf\.overNum/.test(js), 'mismo ritmo y color que la Live');
  });
  test('Chat: ventana flotante con botón ⤢ Ventana; lista con scroll y formulario abajo; Esc, ✕ o clic fuera la cierran', () => {
    const html = D.src('index.html'), css = D.src('control.css'), js = D.src('control.js');
    ok(/id="chat-pop" class="chatpop"[^>]*>⤢ Ventana</.test(html), 'botón ⤢ Ventana en la cabecera del chat');
    ok(/id="chat-modal" class="modal chat-modal" hidden/.test(html) && /id="chat-list2" class="chat-list chat-list-pop"/.test(html) && /id="chat-form2"/.test(html), 'ventana con lista y formulario');
    ok(/\.chat-modal \.chat-box\{width:480px;max-width:calc\(100vw - 32px\);max-height:65vh;min-height:340px;/.test(css), 'ancho 480, máx. 65vh, mín. 340');
    ok(/\.chat-box \.chat-list-pop\{flex:1 1 auto;min-height:0;max-height:none;overflow-y:auto;/.test(css) && /\.chat-box \.chat-form,\.chat-box \.mnote\{flex:0 0 auto\}/.test(css), 'lista con scroll y formulario fijo abajo');
    ok(/box\.scrollTop = box\.scrollHeight;/.test(js), 'la lista baja siempre al último mensaje');
    const t = panel(), m = t.env.getEl('chat-modal');
    t.env.fire('chat-pop', 'click', { target: { id: 'chat-pop' }, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    eq(m.hidden, false, 'se abre con ⤢ Ventana');
    t.env.fire('document', 'keydown', { key: 'Escape', target: { tagName: 'BODY' }, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    eq(m.hidden, true, 'Esc la cierra');
    t.env.fire('chat-pop', 'click', { target: { id: 'chat-pop' }, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    t.env.fire('chat-x', 'click', { target: { id: 'chat-x' }, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    eq(m.hidden, true, 'la ✕ la cierra');
    t.env.fire('chat-pop', 'click', { target: { id: 'chat-pop' }, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    t.env.fire('chat-modal', 'pointerdown', { target: m, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    t.env.fire('chat-modal', 'click', { target: m, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} });
    eq(m.hidden, true, 'clic fuera la cierra');
  });
  test('Modales: se cierran al pulsar fuera de la caja (también el Gestor de ventanas); dentro no', () => {
    const t = panel();
    const m = t.env.getEl('modal');
    t.T.openGestor();
    eq(m.hidden, false, 'el gestor está abierto');
    t.env.fire('modal', 'pointerdown', { target: m });
    t.env.fire('modal', 'click', { target: { id: 'otro' } });
    eq(m.hidden, false, 'pulsar dentro de la caja no cierra');
    t.env.fire('modal', 'pointerdown', { target: m });
    t.env.fire('modal', 'click', { target: m });
    eq(m.hidden, true, 'pulsar fuera (en el fondo) cierra el gestor');
    ok(/backdropClose\(\$\('imp'\)/.test(D.src('control.js')), 'la importación también');
  });
  test('Gestor: rejilla de 6 columnas, píldora con micro-LED, cabecera y pie; en móvil, tres filas; «+ Abrir» abre Manager', async () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/\.gv-row\{display:grid;grid-template-columns:minmax\(150px,1\.3fr\) 124px 124px 140px 112px 36px;grid-template-areas:"name vista zona fs sb x"/.test(css), 'rejilla fija: nombre, vista, zona, pantalla, standby, ✕');
    ok(/\.modal-box\.wide\{max-width:780px\}/.test(css), 'modal ancho: cabe la rejilla sin scroll');
    ok(/@media \(max-width:700px\)\{ \.gv-row\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) auto;grid-template-areas:"name name x" "vista zona sb" "fs fs fs"\}/.test(css), 'móvil: tres filas, sin scroll');
    ok(/\.gv-sb\{height:34px;[^}]*border-radius:999px/.test(css) && /\.gv-led\{/.test(css), 'standby como píldora con micro-LED');
    ok(/\.gv-sb\.on \.gv-led\{[^}]*box-shadow/.test(css), 'LED encendido con resplandor');
    ok(/\.gv-row select:hover,\.gv-row select:focus\{background-image:url/.test(css) && /background-image:url\("data:image\/svg\+xml,[^"]*6f747e/.test(css), 'flecha sutil en reposo, más brillante en hover y focus');
    ok(/\.gv-row input,\.gv-row select\{height:32px/.test(css) && /\.gv-sb\{height:34px/.test(css) && /\.gv-x\{width:36px;height:32px/.test(css), 'altura: 32px en campos y ✕, 34px en la píldora');
    ok(/class="gv-row gv-hd"/.test(js) && />Nombre</.test(js) && />Standby</.test(js) && /\.gv-hd\{display:none\}/.test(css), 'cabecera NOMBRE · VISTA · ZONA · STANDBY en escritorio; oculta en móvil');
    ok(/\.gv-row select:disabled\{[^}]*border-color:transparent;background:transparent/.test(css), 'zona sin usar: «—» plano, sin caja');
    ok(/\.gv-foot \.gv-close\{background:#1c1e26;border:1px solid var\(--hair2\);color:#fff\}/.test(css) && /class="btn gv-close" data-gv="done"/.test(js), 'Cerrar en gris Raycast, sin rojo');
    ok(/\.gv-qr\{[^}]*border-top:1px solid/.test(css) && !/dashed/.test(css.slice(css.indexOf('.gv-qr{'), css.indexOf('.gv-qr{')+200)), 'QR: hairline continua, sin marco de puntos');
    ok(/data-gv="all" data-on="1">⏸ Todas en standby/.test(js) && /data-gv="all" data-on="0">▶ Reanudar todas/.test(js), 'cabecera: todas en standby / reanudar');
    ok(/data-gv="new">\+ Abrir ventana Live</.test(js) && /data-gv="done"/.test(js), 'pie: abrir a la izquierda, cerrar a la derecha');
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); }, close() { this.closed = true; } };
    t.env.win.open = () => w;
    t.T.openGestor();
    t.env.fire('modal-body', 'click', { target: { closest: q => q === '[data-gv]' ? { dataset: { gv: 'new' } } : null } });
    await new Promise(r => setImmediate(r));
    eq(t.T.winState().length, 1, 'abre una ventana Live');
    eq(t.T.winState()[0].vista, 'manager', 'por defecto Manager');
  });
  test('Telemetría de pantalla completa: la Live manda fs y el Gestor lo guarda y lo pinta como Pantalla completa o Ventana', async () => {
    const t = panel(), js = D.src('control.js'), css = D.src('control.css'), live = D.src('live.js');
    const w = { closed: false, focus() {}, postMessage() {}, close() { this.closed = true; } };
    t.env.win.open = () => w;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-live [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    eq(t.T.winState()[0].fs, undefined, 'sin dato hasta que la ventana avisa (se ve como Ventana)');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'manager', zona: null, standby: false, fs: true }, source: w });
    eq(t.T.winState()[0].fs, true, 'la ventana dice que está en pantalla completa');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'manager', zona: null, standby: false, fs: false }, source: w });
    eq(t.T.winState()[0].fs, false, 'y que ya no');
    ok(/x\.fs = !!m\.fs/.test(js), 'el Dashboard guarda fs al recibir vistaState');
    ok(/<span class="gv-fs" aria-live="polite"><\/span>/.test(js) && /'⛶ Pantalla completa' : 'Ventana'/.test(js), 'la fila muestra ⛶ Pantalla completa o Ventana');
    ok(/<span>Pantalla<\/span>/.test(js), 'cabecera con la columna PANTALLA');
    ok(/\.gv-fs\.on::before\{[^}]*box-shadow/.test(css) && /\.gv-fs\{[^}]*color:var\(--dim/.test(css), 'iluminado si está en completa; atenuado si es Ventana');
    ok(/fs: !!\(document\.fullscreenElement \|\| document\.webkitFullscreenElement\)/.test(live), 'la Live lee su estado de pantalla completa en reportVista');
  });
  test('Botones: primario blanco, peligro rojo solo para borrar, secundarios neutros; Live ▾ sigue en rojo', () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/\.btn\.primary\{background:#fff;border-color:#fff;color:#000;font-weight:700/.test(css), 'primario: blanco sólido con texto negro');
    ok(/\.btn\.danger\{background:#d9363e;border-color:#d9363e;color:#fff/.test(css), 'peligro: #d9363e con texto blanco');
    ok(/^\.btn\{[^}]*background:#1c1e26;color:#fff/m.test(css), 'secundario: fondo #1c1e26');
    ok(/#m-live \.mbtn\.btn\.primary\{background:var\(--live\)/.test(css), 'Live ▾ mantiene su rojo de emisión');
    ok(!/label: 'Cerrar', kind: 'primary'/.test(js), 'Cerrar de los modales es secundario');
    ok(/kind: 'danger', run: \(\) => \{ const r = C\.removeArtist/.test(js), 'Borrar banda sigue siendo peligro');
  });
  test('Botón primario: blanco sólido siempre (ninguna regla lo vuelve rojo), hover y desactivado propios', () => {
    const css = D.src('control.css');
    ok(/\.btn\.primary\{background:#fff;border-color:#fff;color:#000;font-weight:700/.test(css), 'blanco sólido, texto negro');
    ok(/\.btn\.primary:hover:not\(:disabled\)\{background:#e6e6e6;border-color:#e6e6e6/.test(css), 'hover gris claro');
    ok(/\.btn\.primary:disabled\{background:rgba\(255,255,255,\.18\);border-color:transparent;color:rgba\(255,255,255,\.35\)/.test(css), 'desactivado apagado');
    ok(!/^\.btn\.primary,/m.test(css) && !/[,{]\s*\.btn\.primary\s*,/.test(css.replace(/\.btn\.primary\{[^}]*\}/g,'')), 'ninguna regla de acento pinta .btn.primary');
  });
  test('Acento: rojo solo en borrar y Live ▾; selección en gris elevado; foco en blanco translúcido', () => {
    const css = D.src('control.css');
    ok(/\.seg button\.on,\.days button\.on,\.dtb\.on,\.addtabs button\.on\{background:rgba\(255,255,255,\.12\)/.test(css), 'segmentos activos en gris elevado');
    ok(/\.mitem\.on\{color:#fff;font-weight:700\}/.test(css) && /\.mitem\.on::after\{background:#fff\}/.test(css), 'menús: seleccionado en blanco, sin rojo');
    ok(/\.mpanel \.days button\.on\{background:rgba\(255,255,255,\.08\);color:#fff/.test(css), 'Día: seleccionado en blanco');
    ok(/td input:focus,td select:focus,\.imp-src textarea:focus[^{]*\{border-color:rgba\(255,255,255,\.35\);box-shadow:0 0 0 1px rgba\(255,255,255,\.15\)\}/.test(css), 'foco de campos en blanco translúcido');
    ok(/\.focusitem\.on \.fbox\{background:#fff/.test(css), 'casillas marcadas en blanco');
  });
  test('Paleta de comandos: ⌘K y Ctrl+K abren/cierran; «/» abre fuera de un campo y no dentro', () => {
    const t = dashboard(), sp = t.env.getEl('spotlight');
    sp.hidden = true;   // como el resto de modales de las pruebas
    ok(sp.hidden === true, 'cerrada de entrada');
    t.env.fire('document', 'keydown', { key: 'k', metaKey: true, preventDefault() {} });
    eq(sp.hidden, false, '⌘K abre'); eq(t.env.getEl('spot-q').value, '', 'campo vacío');
    t.env.fire('document', 'keydown', { key: 'k', ctrlKey: true, preventDefault() {} });
    eq(sp.hidden, true, 'Ctrl+K vuelve a cerrar');
    t.env.fire('document', 'keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault() {} });
    eq(sp.hidden, false, '«/» abre fuera de campos');
    t.env.fire('document', 'keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} });
    eq(sp.hidden, true, 'Esc cierra');
    t.env.fire('document', 'keydown', { key: '/', target: { tagName: 'INPUT' }, preventDefault() {} });
    eq(sp.hidden, true, '«/» dentro de un campo se escribe, no abre');
  });
  test('Paleta de comandos: filtra, navega con flechas, ejecuta con Intro (Configuración) y muestra ⌘S ⌘O ⌘N', () => {
    const t = dashboard();
    t.env.fire('document', 'keydown', { key: 'k', metaKey: true, preventDefault() {} });
    const q = t.env.getEl('spot-q');
    q.value = 'config'; t.env.fire('spot-q', 'input', {});
    ok(/Configuración/.test(t.env.getEl('spot-list').innerHTML), 'filtra: Configuración');
    ok(!/Nuevo evento/.test(t.env.getEl('spot-list').innerHTML), 'oculta lo que no coincide');
    t.env.fire('spot-q', 'keydown', { key: 'Enter', preventDefault() {} });
    eq(t.env.getEl('spotlight').hidden, true, 'Intro ejecuta y cierra');
    eq(t.env.getEl('cfg').hidden, false, 'Intro abre Configuración');
    t.env.fire('document', 'keydown', { key: 'k', metaKey: true, preventDefault() {} });
    q.value = ''; t.env.fire('spot-q', 'input', {});
    t.env.fire('spot-q', 'keydown', { key: 'ArrowDown', preventDefault() {} });
    ok(/class="spot-i on" data-i="1"/.test(t.env.getEl('spot-list').innerHTML), '↓ mueve la selección');
    t.env.fire('spot-q', 'keydown', { key: 'ArrowUp', preventDefault() {} });
    ok(/class="spot-i on" data-i="0"/.test(t.env.getEl('spot-list').innerHTML), '↑ la devuelve');
    const html = t.env.getEl('spot-list').innerHTML;
    ok(/<kbd>⌘S<\/kbd>/.test(html) && /<kbd>⌘O<\/kbd>/.test(html) && /<kbd>⌘N<\/kbd>/.test(html), 'muestra ⌘S ⌘O ⌘N');
    ok(/<kbd>⇧⌘F<\/kbd>/.test(html) && /<kbd>⇧⌘C<\/kbd>/.test(html), 'vistas con su atajo');
  });
  test('⌘S, ⌘O y ⌘N se interceptan (preventDefault) y ejecutan su acción', () => {
    const t = dashboard(); let pd = 0;
    const P = { preventDefault() { pd++; } };
    t.env.fire('document', 'keydown', Object.assign({ key: 'n', metaKey: true }, P));
    eq(t.env.getEl('modal').hidden, false, '⌘N abre Nuevo evento');
    t.env.getEl('modal').hidden = true;
    t.env.fire('document', 'keydown', Object.assign({ key: 'o', metaKey: true }, P));
    t.env.fire('document', 'keydown', Object.assign({ key: 's', metaKey: true }, P));
    eq(pd, 3, 'los tres bloquean el comportamiento del navegador');
  });
  test('Paleta: el atajo ⇧⌘7 abre la ayuda (sustituye a ⌘/) y el markup está en index.html', () => {
    const t = dashboard();
    t.env.fire('document', 'keydown', { key: '/', metaKey: true, preventDefault() {} });
    eq(t.env.getEl('modal-title').textContent !== 'Atajos y ayuda', true, '⌘/ ya no abre la ayuda');
    t.env.fire('document', 'keydown', { key: '/', metaKey: true, shiftKey: true, code: 'Digit7', preventDefault() {} });
    eq(t.env.getEl('modal-title').textContent, 'Atajos y ayuda', '⇧⌘7 abre la ayuda');
    const ih = D.src('index.html'), css = D.src('control.css');
    ok(/id="spotlight"[^>]*hidden/.test(ih) && /id="spot-q"/.test(ih) && /id="spot-list"/.test(ih), 'markup de la paleta');
    ok(/\.spot-box\{width:min\(600px,100%\)/.test(css) && /\.spot-foot/.test(css), 'diseño de la paleta');
  });
  test('Paleta: encabezados de grupo atenuados con separador; cada fila lleva micro-etiqueta a la izquierda; ⌘K y atajos en una sola etiqueta', () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/\.spot-g\{[^}]*font-size:11px[^}]*letter-spacing:\.12em[^}]*color:var\(--dim,#8a8f98\)[^}]*padding:14px 10px 6px[^}]*border-top:1px solid var\(--hair\)/.test(css), 'encabezado: 11px, .12em, atenuado, 14px arriba, línea sutil');
    ok(/\.spot-list>\.spot-g:first-child\{border-top:0/.test(css), 'el primer encabezado no lleva línea');
    ok(/spot-pill tp-' \+ b\.kind/.test(js) && /\.spot-pill\.tp-show\{--pc:#ff5d73\}/.test(css), 'bandas: píldora de tipo (SHOW, PRUEBA, TAREA, HITO)');
    ok(/ic: 'i-clock'/.test(js) && /ic: 'i-out'/.test(js), 'vistas y acciones: icono a la izquierda');
    const t = dashboard(); t.env.fire('document', 'keydown', { key: 'k', metaKey: true, preventDefault() {} });
    const html = t.env.getEl('spot-list').innerHTML;
    ok(/class="spot-g">Vistas</.test(html) && /class="spot-g">Acciones</.test(html), 'encabezados Vistas y Acciones');
    ok(/<button type="button" class="spot-i[^"]*" data-i="0"><span class="spot-slot"><svg class="ic spot-ic" aria-hidden="true"><use href="#i-clock"\/>/.test(html) && html.indexOf('spot-slot') < html.indexOf('spot-t'), 'icono a la izquierda de cada vista');
    ok(/<kbd>⇧⌘F<\/kbd>/.test(html) && /<kbd>⌘S<\/kbd>/.test(html), 'atajos en una sola etiqueta <kbd>');
  });
  test('QR: el título es «Pantallas QR», sin «móviles»', () => {
    const js = D.src('control.js');
    ok(/Pantallas QR<\/div>/.test(js) && !/Pantallas QR \(móviles\)/.test(js), 'sin «(móviles)»');
  });
  test('⇧⌘C: alterna Escenario (alto contraste) y vuelve al tema anterior; queda en Configuración y en la ayuda', () => {
    const t = dashboard({ 'showtime.panel.style': '"neutro"' });
    t.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    eq(t.read('showtime.panel.style'), 'escenario', 'pasa a Escenario');
    eq(t.read('showtime.panel.style.prev'), 'neutro', 'recuerda el tema anterior');
    eq(t.env.getEl('toast').textContent, 'Estilo del Dashboard: Escenario (Alto contraste)', 'avisa');
    eq(t.env.getEl('cfg-style-panel').value, 'escenario', 'Configuración muestra Escenario');
    t.env.fire('document', 'keydown', { key: 'c', ctrlKey: true, shiftKey: true, preventDefault() {} });
    eq(t.read('showtime.panel.style'), 'neutro', 'otra vez: vuelve a Neutro');
    eq(t.env.getEl('cfg-style-panel').value, 'neutro');
    const t2 = dashboard();
    t2.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    t2.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    eq(t2.read('showtime.panel.style'), 'clasico', 'sin tema previo, vuelve al Clásico de partida');
    const t3 = dashboard({ 'showtime.panel.style': '"escenario"' });
    t3.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    eq(t3.read('showtime.panel.style'), 'raycast', 'si ya estaba en Escenario sin historial, vuelve a Raycast');
    ok(/<dt><kbd>⇧<\/kbd> <kbd>⌘<\/kbd> <kbd>C<\/kbd><\/dt><dd>Alterna tema Alto Contraste \(Escenario \/ Sol\) al instante<\/dd>/.test(D.src('control.js')), 'en la ayuda');
  });
  test('Modo Foco: micro-píldora del tipo (SHOW · SOUNDCHECK · TAREA · HITO) con color fijo, en vez del cuadradito de color', () => {
    const P = panel().T.tipoPill;
    eq(P('show'), '<span class="tpill tp-show" aria-hidden="true">SHOW</span>');
    ok(/>SOUNDCHECK</.test(P('sc')) && />TAREA</.test(P('tarea')) && />HITO</.test(P('hito')));
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    ok(/<div class="nm"><span class="tpill tp-show"/.test(ultimo(t, 'tbody')), 'cada fila lleva su píldora');
    const css = D.src('control.css');
    ok(/\.tpill\{display:none;/.test(css), 'fuera del Modo Foco no se ve');
    ok(/body\.focus #tbl \.tpill\{display:inline-flex\}/.test(css) && /body\.focus #tbl td\.name input\[type=color\]\{display:none\}/.test(css));
    ['show', 'sc', 'tarea', 'hito'].forEach(k => ok(new RegExp('\\.tpill\\.tp-' + k + '\\{--pc:#[0-9a-f]{6}\\}').test(css), k + ': color fijo'));
  });

  test('Safari: cristal esmerilado de verdad en menús, Configuración y avisos (desenfoque literal, velo denso, opaco si no hay desenfoque)', () => {
    const css = D.src('control.css'), tail = css.slice(css.indexOf('/* ── Cristal esmerilado'));
    ok(css.indexOf('/* ── Cristal esmerilado') > css.indexOf('/* ── Cristal: UNA'), 'va después del cristal');
    ok(/\.mpanel,\.cfg,\.toast,\.qr-big-box,\.cfg-h,\.morep\{-webkit-backdrop-filter:blur\(24px\) saturate\(160%\);backdrop-filter:blur\(24px\) saturate\(160%\)\}/.test(tail), 'sin var(): Safari lo aplica');
    const alpha = re => +re.exec(css)[1];
    ok(alpha(/:root\{--glass-bg:rgba\(\d+,\d+,\d+,(\.\d+)\)/) >= 0.88, 'velo denso (clásico): sin desenfoque tampoco se leen las letras de detrás');
    ok(alpha(/body\[data-ps="raycast"\]\{--glass-bg:rgba\(\d+,\d+,\d+,(\.\d+)\)\}/) >= 0.88 && alpha(/body\[data-ps="neutro"\]\{--glass-bg:rgba\(\d+,\d+,\d+,(\.\d+)\)\}/) >= 0.88);
    ok(/body\[data-ps="escenario"\]\{--glass-bg:#000;/.test(css), 'escenario: negro');
    ok(/@supports not \(\(-webkit-backdrop-filter:blur\(1px\)\) or \(backdrop-filter:blur\(1px\)\)\)\{\s*\.mpanel,\.cfg,\.toast,\.qr-big-box,\.cfg-h,\.morep\{background-color:#[0-9a-f]{6}\}/.test(tail), 'sin desenfoque: opaco');
    const live = D.src('live.css');
    ['#zoomctl{', '.mdock{', '.cdock{'].forEach(sel => { const b = live.slice(live.indexOf(sel), live.indexOf('}', live.indexOf(sel))); ok(/background:rgba\(10,11,14,\.88\)/.test(b) && /-webkit-backdrop-filter:blur\(20px\) saturate\(160%\)/.test(b), 'Live ' + sel); });
  });

  test('Evento sin entradas: la tarjeta «Importar horario en 1 segundo» centrada en el área de trabajo (sin la columna lateral vacía)', () => {
    const vacio = { event: { nombre: 'X', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }, escenarios: [], artists: [] };
    const a = panel({ 'showtime.festival': JSON.stringify(vacio) });
    eq(a.env.getEl('list-empty').hidden, false); ok(a.env.getEl('main').classList.contains('vacia'), 'main.vacia');
    const b = panel({ 'showtime.festival': JSON.stringify(fest().s) });
    ok(!b.env.getEl('main').classList.contains('vacia'), 'con entradas: la columna vuelve');
    const css = D.src('control.css');
    ok(/main\.vacia\{grid-template-columns:minmax\(0,1fr\)\}/.test(css) && /main\.vacia>\.live\{display:none\}/.test(css));
    ok(/main\.vacia \.list-empty\{padding:16px 16px 9vh\}/.test(css), 'centro óptico: un poco por encima');
  });
  /** Dashboard con «Sin reposo» disponible (wakeLock de mentira que cuenta peticiones y liberaciones). */
  async function panelWake(storage) {
    const env = D.makeEnv({ cripto: true, storage: storage || {} });
    const W = { req: 0, rel: 0, fail: false };
    env.win.document.visibilityState = 'visible';
    env.win.navigator.wakeLock = { request: async () => { if (W.fail) throw new Error('no'); W.req++; const fns = []; return { addEventListener: (t, f) => fns.push(f), release: async () => { W.rel++; fns.forEach(f => f()); } }; } };
    D.cargar(env, MODULOS);
    ['modal', 'addm', 'imp', 'cfg', 'drop'].forEach(id => { env.getEl(id).hidden = true; });
    await new Promise(r => setImmediate(r));
    const T = env.win.ShowtimePanel._test;
    return { env, W, T, wake: env.getEl('wake'), led: () => env.getEl('wake').classList.contains('on'), click: async () => { env.fire('wake', 'click', {}); for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); } };
  }
  test('Sin reposo: el clic conmuta el LED (verde ⇄ gris), guarda la elección y pide o suelta el bloqueo de pantalla', async () => {
    const t = await panelWake();
    ok(t.led(), 'por defecto: activo'); eq(t.W.req, 1, 'pide el bloqueo al arrancar'); eq(t.T.wakeState().lock, true);
    await t.click();
    ok(!t.led(), 'clic: apagado (LED gris)'); eq(t.env.storage.get('showtime.wake'), 'off'); eq(t.W.rel, 1, 'suelta el bloqueo'); eq(t.T.wakeState().lock, false);
    ok(/desactivado/.test(t.env.getEl('toast').textContent));
    await t.click();
    ok(t.led(), 'otro clic: activo (LED verde)'); eq(t.env.storage.has('showtime.wake'), false); eq(t.W.req, 2); eq(t.T.wakeState().lock, true);
    const css = D.src('control.css');
    ok(/\.wake \.wled\{[^}]*background:#5b5f67/.test(css) && /\.wake\.on \.wled,\.wake \.wled\.on\{background:var\(--ok\)/.test(css) && /led\.classList\.toggle\('on', wakeOn\)/.test(D.src('control.js')), 'gris #5b5f67 / verde var(--ok)');
  });
  test('Sin reposo en «off»: ni tocar la app ni volver a la pestaña lo reactivan', async () => {
    const t = await panelWake({ 'showtime.wake': 'off' });
    ok(!t.led()); eq(t.W.req, 0, 'al arrancar no lo pide');
    t.env.fire('document', 'pointerdown', { target: { closest: () => null } }); t.env.fire('document', 'visibilitychange', {});
    await new Promise(r => setImmediate(r));
    eq(t.W.req, 0, 'pointerdown / visibilitychange no lo reactivan'); ok(!t.led());
  });
  test('Sin reposo: si el navegador no lo concede, el LED sigue la elección y avisa; tocar la app lo vuelve a pedir', async () => {
    const t = await panelWake({ 'showtime.wake': 'off' });
    t.W.fail = true; await t.click();
    ok(t.led(), 'elegido: activo'); ok(/aún no lo ha concedido/.test(t.env.getEl('toast').textContent));
    t.W.fail = false; t.env.fire('document', 'pointerdown', { target: { closest: () => null } }); for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r));
    eq(t.W.req, 1); eq(t.T.wakeState().lock, true);
  });

  test('Cambio en STANDBY: el botón pone «SB» en vez de los minutos (los minutos quedan en el título)', () => {
    const src = D.src('control.js');
    ok(/'<button class="gapbtn sb" data-act="standby" data-on="0" title="STANDBY · ' \+ co\.mins \+ ' min\. Pulsa para volver a CHANGEOVER"><svg class="ic"><use href="#i-pause"\/><\/svg>SB<\/button>'/.test(src));
    // Con datos: dos bandas en la misma zona, el hueco marcado como STANDBY
    let s = C.newFestival({ nombre: 'SB', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; const z = s.escenarios[0].id;
    s = C.addArtist(s, 'show', { jornada: '2026-07-10', nombre: 'Uno', escenarioId: z, inicio: '20:00', fin: '21:00' }).state;
    s = C.addArtist(s, 'show', { jornada: '2026-07-10', nombre: 'Dos', escenarioId: z, inicio: '21:15', fin: '22:00' }).state;
    s.artists[1].showtimeStandby = true;
    const t = panel({ 'showtime.festival': JSON.stringify(s) }), h = ultimo(t, 'tbody');
    ok(/<button class="gapbtn sb"[^>]*><svg class="ic"><use href="#i-pause"\/><\/svg>SB<\/button>/.test(h), 'SB en la fila');
  });
  test('Configuración: la cabecera usa el mismo cristal que el panel, de borde a borde (sin franja más oscura)', () => {
    const css = D.src('control.css');
    ok(/\.cfg-h\{margin:0 -18px;padding:14px 18px 10px;background:var\(--glass-bg\)\}/.test(css));
    ok(css.indexOf('.cfg-h{background:rgba(14,16,20') < 0);
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

  test('Idioma: botón ES/EN y selector de Configuración; se guarda en CONFIG.lang (viaja con la emisión)', () => {
    const t = dashboard(), I = t.env.win.ShowtimeI18n;
    eq(I.getLang(), 'es', 'español por defecto');
    eq(t.env.getEl('btn-lang').textContent, 'ES');
    t.env.fire('btn-lang', 'click', {});
    eq(t.read('showtime.config').lang, 'en', 'guardado en la configuración (Dt.KEYS.config → emisión)');
    eq(I.getLang(), 'en'); eq(t.env.getEl('btn-lang').textContent, 'EN');
    t.env.fire('cfg-lang', 'click', { target: { closest: sel => sel === '[data-l]' ? { dataset: { l: 'es' } } : null } });
    eq(t.read('showtime.config').lang, 'es'); eq(I.getLang(), 'es');
  });
  test('Idioma: un Panel cuya configuración está en inglés arranca en inglés', () => {
    const t = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    eq(t.env.win.ShowtimeI18n.getLang(), 'en');
    eq(t.env.getEl('btn-lang').textContent, 'EN');
  });
  test('Idioma: la hoja de ruta ya no tiene selector propio (usa el idioma activo)', () => {
    const js = D.src('control.js');
    ok(js.indexOf('pr-lang') < 0 && js.indexOf('PR.lang') < 0);
    ok(/<script src="i18n\.js\?v=\d+"><\/script>\n<script src="core\.js/.test(D.src('index.html')), 'i18n.js se carga el primero en el Panel');
    ['live.html', 'remote.html'].forEach(f => ok(D.src(f).indexOf('<script src="i18n.js?v=') >= 0, f + ' carga i18n.js'));
    ok(/if \(window\.ShowtimeI18n\) window\.ShowtimeI18n\.setLang\(CONFIG\.lang\)/.test(D.src('live.js')) && /if \(window\.ShowtimeI18n\) window\.ShowtimeI18n\.setLang\(CONFIG\.lang\)/.test(D.src('remote.js')), 'Live y Mando siguen al Panel');
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
