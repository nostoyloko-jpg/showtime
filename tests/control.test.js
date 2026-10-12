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
  // Las directivas de idioma (data-i18n*) no cuentan para la forma del HTML: los tests de maquetación miran el HTML sin ellas
  const noI18n = h => h.replace(/ data-i18n(?:-[a-z]+)?(?:="[^"]*")?/g, '');
  const srcRaw = D.src;
  D.src = f => (f === 'index.html' ? noI18n(srcRaw(f)) : srcRaw(f));
  const MODULOS = ['i18n.js', 'core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'marca.js', 'audio.js', 'control.js'];

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
    ok(/m\.id = 'modal-fail'/.test(s) && /'No se pudo completar: \{err\}/.test(s), 'el fallo se ve en el propio modal');
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
    ['m-view', 'm-days', 'm-delay', 'm-msg', 'm-chat'].forEach(id => ok(centro.indexOf('id="' + id + '"') > 0, 'centro: ' + id));
    ok(HTML.indexOf('id="m-cast"') < 0 && HTML.indexOf('id="m-live"') < 0, 'Live ▾ y Emisión ▾ ya no van por separado (dec. 109)');
    ['m-hub', 'id="wake"', 'id="clock"', 'id="btn-cfg"'].forEach(x => ok(der.indexOf(x) > 0, 'derecha: ' + x));
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
  test('Estilos del Dashboard: tabla limpia en reposo, Añadir neutro, Pantallas y Emisión neutro y números tabulares', () => {
    const css = D.src('control.css');
    ok(/#tbl tbody td select\{[^}]*appearance:none/.test(css), 'sin flechas en reposo');
    ok(/#tbl tbody tr:hover td input\[type=text\],#tbl tbody tr:hover td select\{[^}]*border-color/.test(css), 'controles al pasar el ratón');
    ok(/\.btn\.addnew\{[^}]*background:#14151b/.test(css), 'Añadir neutro');
    ok(/#m-hub \.mbtn\.hubbtn\{[^}]*background:#1c1e26/.test(css), 'botón maestro neutro (sin rojo)');
    ok(/\.bar \.clock\{[^}]*color:#fff[^}]*tabular-nums/.test(css), 'reloj blanco y tabular');
    ok(/--dim:#8a8f98/.test(css), 'texto atenuado con contraste');
  });

  // ── Tanda 2 (remate): modo foco, SIGUIENTE sin Tiempo extra, bis en el CHANGEOVER ──
  test('Modo foco: desde «Ver ▾» o ⇧⌘F; oculta Jornada, Tipo, Notas y «···»; se recuerda en este equipo', () => {
    const t = dashboard(), body = t.env.getEl('body');
    ok(!body.classList.contains('focus'), 'apagado de entrada');
    t.env.fire('btn-focus', 'click', {});
    ok(body.classList.contains('focus'), 'encendido'); eq(t.env.storage.get('showtime.panel.focus'), '1');
    ok(!/Foco/.test(t.env.getEl('view-lbl').textContent) && t.env.getEl('view-lbl').textContent === dashboard().env.getEl('view-lbl').textContent, '«Ver» dice solo la vista, sin «· Foco» (dec. 129): ' + t.env.getEl('view-lbl').textContent);
    t.env.fire('document', 'keydown', { key: 'F', metaKey: true, shiftKey: true, preventDefault() {} });
    ok(!body.classList.contains('focus'), '⇧⌘F lo apaga'); eq(t.env.storage.has('showtime.panel.focus'), false);
    const t2 = dashboard({ 'showtime.panel.focus': '1' });
    ok(t2.env.getEl('body').classList.contains('focus'), 'al volver a abrir, sigue en modo foco');
    const css = D.src('control.css');
    ['.c-jor', 'td.f', '.c-tp', 'td.tp', '.c-n', 'td.n', 'th.mo', 'td.mo'].forEach(c => ok(css.indexOf('body.focus #tbl ' + c) >= 0, 'oculta ' + c));
    ok(/body\.focus #tbl tbody td\{[^}]*font-size:16px/.test(css), 'letra más grande');
    ['class="c-jor"', 'class="c-tp"', 'class="c-n', 'id="btn-focus"'].forEach(x => ok(HTML.indexOf(x) > 0, x));
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
    eq((css.match(/body\[data-ps="stage"\]\{--glass-bg:/g) || []).length, 1, 'una sola versión de Stage');
    eq((css.match(/[;{]backdrop-filter:blur\(24px\) saturate\(160%\)/g) || []).length, 1, 'cristal en un solo sitio (literal, para Safari; dec. 119 quitó la versión con var() que nada aplicaba)');
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
  test('Evento sin nombre en inglés: «Untitled event» en la barra, en el aviso y en Configuración (casilla vacía); al guardar sigue sin nombre', () => {
    const p = panel({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    p.env.fire('document', 'paste', pasteEv(CARTEL));
    ok(/placeholder="Untitled event"/.test(ultimo(p, 'imp-new')), 'el campo de nombre, en inglés');
    p.env.fire('imp-go', 'click', {});
    eq(p.read('showtime.festival').event.nombre, 'Evento sin nombre', 'el JSON guarda el texto de siempre');
    eq(p.env.getEl('fest-name').textContent, 'Untitled event', 'y se ve traducido');
    const t = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    const C2 = t.env.win.ShowtimeCore, T = t.env.win.ShowtimePanel._test;
    const s0 = JSON.parse(t.env.storage.get('showtime.festival'));
    const un = Object.assign({}, s0, { event: Object.assign({}, s0.event, { nombre: C2.UNNAMED }) });
    const u = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }), 'showtime.festival': JSON.stringify(un) });
    eq(u.env.getEl('fest-name').textContent, 'Untitled event', 'barra en inglés');
    const e = dashboard({ 'showtime.festival': JSON.stringify(un) });
    eq(e.env.getEl('fest-name').textContent, 'Evento sin nombre', 'en español, igual que siempre');
    const js = D.src('control.js');
    ok(/value="' \+ esc\(C\.isUnnamed\(ev\.nombre\) \? '' : ev\.nombre\)/.test(js) && /placeholder="' \+ esc\(tx\('Evento sin nombre'\)\)/.test(js), 'Configuración: casilla vacía con el nombre traducido de fondo');
    ok(/n \|\| \(FEST && C\.isUnnamed\(FEST\.event && FEST\.event\.nombre\) && \$\('f-nombre'\)\.placeholder \? C\.UNNAMED : ''\)/.test(js), 'guardar sin escribir nombre: sigue sin nombre');
    eq(C2.eventName({ event: { nombre: '  ' } }, x => x === 'Evento sin nombre' ? 'Untitled event' : x), 'Untitled event');
    eq(C2.eventName({ event: { nombre: 'Noches' } }), 'Noches');
    ok(/title: C\.eventName\(FEST, tx\)/.test(js), 'la hoja impresa también');
  });
  test('Importar sin evento: el nombre escrito en la ventana es el del evento (sin «ponle nombre en Configuración»)', () => {
    const t = panel();
    t.env.fire('document', 'paste', pasteEv(CARTEL));
    t.env.fire('imp-new', 'input', { target: { id: 'imp-name', value: '  Noches del Botánico  ' } });
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.event.nombre, 'Noches del Botánico'); eq(s.artists.length, 2);
    ok(!/ponle nombre/.test(t.env.getEl('toast').textContent), t.env.getEl('toast').textContent);
    ok(((t.read('showtime.log') || {}).entries || []).length >= 0);
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('⌘V sin evento: abre «Pegar horario» con lo copiado y, al importar, crea «Evento sin nombre» con sus jornadas (y queda sin exportar)', () => {
    const t = panel();
    t.env.fire('document', 'paste', pasteEv(CARTEL));
    eq(t.env.getEl('imp').hidden, false, 'se abre la vista previa'); eq(t.env.getEl('imp-text').value, CARTEL);
    ok(/Sin evento abierto: al importar se crea un evento nuevo/.test(ultimo(t, 'imp-new')), 'avisa de que se crea el evento');
    ok(/id="imp-name"[^>]*placeholder="Evento sin nombre"/.test(ultimo(t, 'imp-new')), 'con su campo de nombre (vacío = «Evento sin nombre»)');
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
  test('Dec. 155 · sin pestañas: «+ Añadir» abre solo el alta manual; «Pegar horario completo» tiene una cabecera única; «showtime.addtab» ya no interviene', () => {
    const H = srcRaw('index.html'), js = D.src('control.js'), css = D.src('control.css');
    ok(!/addtabs|data-addtab|role="tablist" aria-label="Añadir"|class="addtip"/.test(H), 'ni pestañas ni el «tip» que saltaba de un modal a otro');
    ok(!/addtab|ADDTAB|setAddTabs|openAddTab|lastAddTab/.test(js.replace(/\/\/[^\n]*/g, '').replace(/localStorage\.removeItem\('showtime\.addtab'\)/, '')), 'ni su lógica');
    ok(/try \{ localStorage\.removeItem\('showtime\.addtab'\); \} catch \(e\) \{\}/.test(js), 'la preferencia antigua se borra');
    ok(!/\.addtabs|\.addtip/.test(css), 'ni sus estilos');
    ok(!/Tienes varias bandas|Several bands\? Use/.test(D.src('i18n.js')), 'ni su texto huérfano en i18n.js (ningún idioma)');
    ok(/<h2 id="imp-title" data-i18n><svg class="ic"><use href="#i-bolt"\/><\/svg>Pegar horario completo <small data-i18n>Excel · CSV · PDF<\/small><\/h2><button id="imp-close"/.test(H), 'cabecera única y visible del importador');
    eq((sec('<div id="imp"', '<datalist id="zones-dl">').match(/role="tab"/g) || []).length, 0, 'sin role="tab" en el importador');
    // Con evento: «+ Añadir» → alta manual, siempre (aunque haya una preferencia vieja guardada)
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s), 'showtime.addtab': 'paste' });
    eq(t.env.storage.get('showtime.addtab'), undefined, 'preferencia vieja borrada al arrancar');
    t.env.fire('btn-new-row', 'click', {});
    eq(t.env.getEl('addm').hidden, false, 'alta manual'); eq(t.env.getEl('imp').hidden, true, 'nunca el importador');
    eq(t.env.storage.get('showtime.addtab'), undefined, 'y no se vuelve a guardar');
    t.env.getEl('addm').hidden = true;
    t.env.fire('btn-new-row', 'click', {}); eq(t.env.getEl('addm').hidden, false, 'siempre el alta manual');
    // Con el importador abierto, nada lo cierra para abrir otro modal
    t.env.getEl('addm').hidden = true;
    t.env.fire('document', 'paste', pasteEv('23:00-23:45 Banda Nueva Principal'));
    eq(t.env.getEl('imp').hidden, false);
    clickData(t, '[data-ob]', { ob: 'manual' });
    eq(t.env.getEl('imp').hidden, false, 'el importador sigue abierto'); eq(t.env.getEl('addm').hidden, true, 'sin saltar al alta manual');
    eq(t.env.getEl('imp-text').value, '23:00-23:45 Banda Nueva Principal', 'y el borrador intacto');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  // ── Dec. 155 · fila manual dentro de «Pegar horario completo» (borrador único, se aplica entero con «Importar») ──
  const manFill = (t, o) => { ['tipo', 'nombre', 'zona', 'jor', 'ini', 'fin', 'call', 'notas'].forEach(k => { t.env.getEl('imp-m-' + k).value = o[k] !== undefined ? o[k] : (k === 'tipo' ? 'show' : ''); }); };
  const dump = t => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); };
  // ── v20261170 · Líneas no incluidas: «Necesitan revisión» (con horas, sin entrada segura) e «Ignoradas» (sin horario) ──
  const deq = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);
  const LIN_TXT = ['SÁBADO 11 JULIO 2026', '10:00 Montaje', 'Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00', 'Equipo local', '12:00-13:00 Prueba de sonido',
    'Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00', '*** Restricciones de PA hasta las 14:00 y entre las 16:00 y las 18:00 ***', '*** sin pirotecnia ***'].join('\n');
  const linBtn = (t, attr, k) => t.env.fire('imp-lines', 'click', { target: { closest: q => /data-lign|data-lman/.test(q) ? { dataset: { [attr]: k } } : null } });
  const revLis = t => (ultimo(t, 'imp-rev-list').match(/<li class="imp-revl" data-line="[^"]+">/g) || []).map(x => /data-line="([^"]+)"/.exec(x)[1]);
  test('Importador v20261170 · el curfew con horas NO es «línea sin hora ignorada»: necesita revisión, con su texto entero, el motivo y Ignorar / Añadir manualmente', () => {
    const t = panel(), T = t.env.win.ShowtimePanel._test;
    t.env.fire('document', 'paste', pasteEv(LIN_TXT));
    eq(t.env.getEl('imp-lines').hidden, false); eq(t.env.getEl('imp-rev').hidden, false);
    eq(t.env.getEl('imp-rev-h').textContent, 'Necesitan revisión (3)');
    const rev = ultimo(t, 'imp-rev-list');
    deq(revLis(t), ['3:1', '6:1', '7:1'], 'las dos líneas iguales se revisan por separado (identidad propia) y el aviso *** con horas también');
    ok(rev.indexOf('Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00</p>') > 0, 'el texto original completo');
    ok(/Tiene varias horas: no se sabe cuál es la de la entrada/.test(rev) && /Es un aviso con horas: no se convierte solo en una entrada/.test(rev), 'motivo breve y claro');
    ok(/data-lign="3:1" aria-label="Ignorar la línea 3">Ignorar<\/button><button type="button" class="btn imp-revb" data-lman="3:1" aria-label="Añadir manualmente la línea 3">Añadir manualmente<\/button>/.test(rev), 'dos botones con nombre accesible');
    ok(!/sin hora\b/i.test(rev + ultimo(t, 'imp-ign') + t.env.getEl('imp-ign').textContent), 'nunca «sin hora» («Sin horario» solo en las que no tienen ninguna hora)');
    // Ignoradas de verdad (sin ninguna hora), plegadas
    eq(t.env.getEl('imp-ign').hidden, false); eq(t.env.getEl('imp-ign').textContent, '2 líneas ignoradas');
    ok(/Línea 4: Equipo local <span class="imp-ignwhy">— Sin horario<\/span>/.test(ultimo(t, 'imp-ign')) && /Línea 8: \*\*\* sin pirotecnia \*\*\*/.test(ultimo(t, 'imp-ign')));
    // Las filas reconocidas, como siempre y sin bloqueo
    const pv = ultimo(t, 'imp-prev');
    ok(/value="Montaje"/.test(pv) && /value="Prueba de sonido"/.test(pv) && !/Curfew/.test(pv), 'la vista previa solo trae lo que SÍ se importa');
    ok(pv.indexOf('value="Montaje"') < pv.indexOf('value="Prueba de sonido"'), 'en su orden');
    eq(t.env.getEl('imp-go').title, 'Importar: 2 filas', 'las pendientes no bloquean Importar');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador v20261170 · Ignorar y Añadir manualmente: decisiones solo del borrador; cancelar deja la línea pendiente; añadir de verdad la resuelve; cambiar texto, mapeo o cabecera las reinicia', () => {
    const t = panel(), T = t.env.win.ShowtimePanel._test;
    const s0 = (() => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); })();
    t.env.fire('document', 'paste', pasteEv(LIN_TXT));
    // Ignorar la PRIMERA de dos líneas iguales: la otra sigue pendiente
    linBtn(t, 'lign', '3:1');
    deq(revLis(t), ['6:1', '7:1'], 'solo esa'); eq(t.env.getEl('imp-rev-h').textContent, 'Necesitan revisión (2)');
    ok(/Línea 3: Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00 <span class="imp-ignwhy">— Ignorada por ti<\/span>/.test(ultimo(t, 'imp-ign')), 'pasa a Ignoradas como decisión tuya');
    eq(t.env.getEl('imp-ign').textContent, '3 líneas ignoradas');
    eq(t.env.getEl('imp-text').value, LIN_TXT, 'el texto fuente, intacto');
    // Añadir manualmente: ficha de siempre con el texto en Nombre y nada inventado
    linBtn(t, 'lman', '6:1');
    eq(t.env.getEl('imp-man').hidden, false, 'abre la ficha manual');
    eq(t.env.getEl('imp-m-nombre').value, 'Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00', 'texto original en Nombre');
    ['zona', 'ini', 'fin', 'call', 'notas'].forEach(k => eq(t.env.getEl('imp-m-' + k).value, '', k + ': sin inventar'));
    // Ocultar la ficha: la línea sigue pendiente
    t.env.fire('imp-m-hide', 'click', {});
    eq(t.env.getEl('imp-man').hidden, true); deq(revLis(t), ['6:1', '7:1'], 'cancelada: sigue pendiente');
    // Una fila que no vale (hora imposible) no se añade: sigue pendiente
    linBtn(t, 'lman', '6:1'); t.env.getEl('imp-m-ini').value = '99:99'; t.env.fire('imp-m-add', 'click', {});
    ok(t.env.getEl('imp-m-err').textContent, 'error visible'); deq(revLis(t), ['6:1', '7:1'], 'sin añadir: sigue pendiente');
    // Abrir la ficha desde el pie (sin línea): añadir NO resuelve ninguna línea
    t.env.fire('imp-m-hide', 'click', {}); t.env.fire('imp-man-open', 'click', {});
    manFill(t, { nombre: 'Otra cosa', ini: '15:00' }); t.env.fire('imp-m-add', 'click', {});
    deq(revLis(t), ['6:1', '7:1'], 'una fila manual cualquiera no resuelve líneas');
    // Añadir de verdad desde la línea: resuelta y marcada como manual (no parece duplicada)
    t.env.fire('imp-m-hide', 'click', {}); linBtn(t, 'lman', '6:1'); t.env.getEl('imp-m-ini').value = '14:00'; t.env.fire('imp-m-add', 'click', {});
    eq(t.env.getEl('imp-m-err').textContent, ''); deq(revLis(t), ['7:1'], 'resuelta');
    ok(/Línea 6: Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00 <span class="imp-ignwhy">— Añadida a mano al borrador<\/span>/.test(ultimo(t, 'imp-ign')), 'marcada como añadida a mano');
    eq(t.env.getEl('imp-ign').textContent, '3 líneas ignoradas · 1 añadida a mano');
    eq(t.env.getEl('imp-rev-h').textContent, 'Necesitan revisión (1)');
    eq(t.env.getEl('imp-man-n').textContent, '2 filas manuales en el borrador');
    eq(t.env.getEl('imp-go').title, 'Importar: 4 filas', 'Montaje, Prueba y las dos manuales');
    // Cambiar Show/Soundcheck no toca las decisiones
    ok(/IMP\.mode = b\.dataset\.imode; impResetRows\(\); impRecompute\(\);/.test(D.src('control.js')), 'cambiar Show / Soundcheck no reinicia las decisiones');
    // Nada guardado hasta Importar
    const s1 = (() => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); })();
    eq(s1, s0, 'ni texto fuente, ni persistencia, ni evento');
    // Cambiar el texto fuente: decisiones reiniciadas (las filas manuales ya añadidas siguen en el borrador)
    T.setImportText(LIN_TXT + '\n');
    deq(revLis(t), ['3:1', '6:1', '7:1'], 'todo pendiente otra vez'); eq(t.env.getEl('imp-ign').textContent, '2 líneas ignoradas');
    // Importar: lo reconocido y lo manual entran; las pendientes no bloquean
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    ok(s, 'importado'); deq(s.artists.map(a => a.nombre).sort(), ['Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00', 'Montaje', 'Otra cosa', 'Prueba de sonido'].sort());
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador v20261170 · Restaurar: solo en «Ignorada por ti»; vuelve a «Necesitan revisión» en su sitio, con contadores y foco en su acción', () => {
    const t = panel();
    const st = () => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); }, s0 = st();
    t.env.fire('document', 'paste', pasteEv(LIN_TXT));
    // una manual añadida desde la línea 3 (no debe moverse al restaurar otra)
    linBtn(t, 'lman', '3:1'); t.env.getEl('imp-m-ini').value = '14:00'; t.env.fire('imp-m-add', 'click', {});
    linBtn(t, 'lign', '6:1'); linBtn(t, 'lign', '7:1');
    deq(revLis(t), [], 'nada pendiente'); eq(t.env.getEl('imp-rev').hidden, true);
    const ign = ultimo(t, 'imp-ign');
    deq((ign.match(/data-lres="[^"]+"/g) || []), ['data-lres="6:1"', 'data-lres="7:1"'], 'Restaurar solo en las ignoradas por ti');
    ok(/Línea 4: Equipo local <span class="imp-ignwhy">— Sin horario<\/span><\/li>/.test(ign) && /Añadida a mano al borrador<\/span><\/li>/.test(ign), 'sin Restaurar en las automáticas ni en la añadida a mano');
    ok(/data-lres="6:1" aria-label="Restaurar la línea 6">Restaurar<\/button>/.test(ign), 'botón con nombre accesible');
    ok(/<li class="imp-ign-dec"><div class="imp-ignrow"><span class="imp-igntxt">Línea 6: [^<]*<span class="imp-ignwhy">— Ignorada por ti<\/span><\/span><button type="button" class="btn imp-revb imp-res" data-lres="6:1"/.test(ign), 'texto a la izquierda y Restaurar detrás, en su propia columna');
    ok(/<li>Línea 4: Equipo local <span class="imp-ignwhy">— Sin horario<\/span><\/li>/.test(ign), 'las automáticas: sin fila de acciones ni hueco reservado');
    const cssR = D.src('control.css');
    ok(/\.imp-ignrow\{display:flex;flex-wrap:wrap;align-items:center;/.test(cssR) && /\.imp-ignrow \.imp-res\{flex:none;margin-left:auto\}/.test(cssR), 'Restaurar a la derecha, también si baja de línea');
    ok(/@media \(max-width:700px\)\{ \.imp-revl\{grid-template-columns:minmax\(0,1fr\)\} \.imp-revacts\{grid-column:1;grid-row:auto;justify-content:flex-end\} \}/.test(cssR), 'en estrecho, Ignorar / Añadir manualmente también bajan a la derecha (misma columna que Restaurar)');
    eq(t.env.getEl('imp-ign').textContent, '4 líneas ignoradas · 1 añadida a mano');
    // Restaurar la 6: vuelve a su sitio y el foco va a su Ignorar
    let foco = ''; t.env.getEl('imp-rev-list').querySelector = q => ({ focus() { foco = q; } });
    linBtn(t, 'lres', '6:1');
    deq(revLis(t), ['6:1'], 'pendiente otra vez'); eq(foco, '[data-lign="6:1"]', 'foco en la acción de esa línea');
    eq(t.env.getEl('imp-rev-h').textContent, 'Necesitan revisión (1)'); eq(t.env.getEl('imp-ign').textContent, '3 líneas ignoradas · 1 añadida a mano');
    // Restaurar la 7: queda DESPUÉS de la 6 (orden original del texto), no al final de la lista
    linBtn(t, 'lres', '7:1'); deq(revLis(t), ['6:1', '7:1']); eq(t.env.getEl('imp-rev-h').textContent, 'Necesitan revisión (2)');
    // en medio: ignorar la 6 y restaurarla la deja antes de la 7
    linBtn(t, 'lign', '6:1'); linBtn(t, 'lres', '6:1'); deq(revLis(t), ['6:1', '7:1'], 'en su posición original');
    // Restaurar no hace nada sobre una añadida a mano ni sobre una pendiente
    linBtn(t, 'lres', '3:1'); deq(revLis(t), ['6:1', '7:1']); ok(/Línea 3: [^<]*<span class="imp-ignwhy">— Añadida a mano al borrador/.test(ultimo(t, 'imp-ign')));
    delete t.env.getEl('imp-rev-list').querySelector;
    // Ni texto fuente, ni filas manuales, ni importación, ni persistencia
    eq(t.env.getEl('imp-text').value, LIN_TXT); eq(t.env.getEl('imp-man-n').textContent, '1 fila manual en el borrador');
    eq(t.env.getEl('imp-go').title, 'Importar: 3 filas'); eq(st(), s0);
    ok(/"Restaurar la línea \{n\}": "Restore line \{n\}"/.test(D.src('i18n.js')), 'EN');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador v20261170 · tabla: el curfew en la columna de actividad necesita revisión; cambiar el mapeo o la cabecera reinicia Ignorar', () => {
    const t = panel(), T = t.env.win.ShowtimePanel._test;
    const TAB = 'Hora\tActividad\tZona\n10:00\tMontaje\tPrincipal\n\tCurfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00\t\n12:00\tPrueba\tPrincipal';
    t.env.fire('document', 'paste', pasteEv(TAB));
    deq(revLis(t), ['2:1']); ok(/Curfew de sonido hasta las 14:00 y entre las 16:00 y las 18:00<\/p>/.test(ultimo(t, 'imp-rev-list')));
    ok(/value="Montaje"/.test(ultimo(t, 'imp-prev')) && /value="Prueba"/.test(ultimo(t, 'imp-prev')) && !/Curfew/.test(ultimo(t, 'imp-prev')));
    linBtn(t, 'lign', '2:1'); deq(revLis(t), [], 'ignorada'); eq(t.env.getEl('imp-rev').hidden, true);
    t.env.fire('imp-map', 'change', { target: { closest: () => ({ dataset: { col: '2' }, value: 'notas' }) } });
    deq(revLis(t), ['2:1'], 'mapeo cambiado: vuelve a estar pendiente');
    linBtn(t, 'lign', '2:1'); deq(revLis(t), []);
    t.env.fire('imp-head', 'change', { target: { checked: true } });
    deq(revLis(t), ['2:1'], 'cabecera cambiada: vuelve a estar pendiente');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador v20261170 · bloque de líneas no incluidas: debajo de la vista previa y antes de la ficha manual y el pie; ES/EN; táctil; sin «sin hora»', () => {
    const html = srcRaw('index.html'), css = D.src('control.css'), js = D.src('control.js'), i18n = D.src('i18n.js');
    const a = html.indexOf('id="imp-prevwrap"'), b = html.indexOf('id="imp-lines"'), c = html.indexOf('id="imp-man"'), d = html.indexOf('class="imp-foot"');
    ok(a < b && b < c && c < d, 'tabla · líneas no incluidas · ficha manual · pie');
    ok(/<section id="imp-lines" class="mcard imp-card imp-linescard" aria-labelledby="imp-lines-h" hidden>[\s\S]*?<details id="imp-ign" class="imp-ign" hidden>/.test(html), 'ignoradas en un plegable');
    ok(/\.imp-rev-list\{[^}]*max-height:min\(40vh,320px\);overflow:auto\}/.test(css), 'muchas pendientes: la lista se desplaza por dentro');
    ok(/\.imp-revb\{min-height:32px;/.test(css), 'botones de 32 px (táctil)');
    ok(!/sin hora ignorad/.test(js + i18n), 'el texto «sin hora ignorada» desaparece');
    ok(/"Necesitan revisión \(\{n\}\)": "Pending review \(\{n\}\)"/.test(i18n) && !/Necesita revisión/.test(js + i18n), 'rótulo fijo «Necesitan revisión (n)» / «Pending review (n)», también con 1');
    ['Líneas no incluidas', 'Necesitan revisión ({n})', 'Ignorar', 'Añadir manualmente', 'Ignorar la línea {n}', 'Añadir manualmente la línea {n}', 'Tiene varias horas: no se sabe cuál es la de la entrada',
      'Es un aviso con horas: no se convierte solo en una entrada', 'Tiene horas, pero no se puede convertir con seguridad en una entrada', 'Sin horario', 'Ignorada por ti', 'Añadida a mano al borrador',
      '{n} línea ignorada', '{n} líneas ignoradas', '{n} añadida a mano', '{n} añadidas a mano', 'Hora por confirmar ({x})'].forEach(k => ok(i18n.indexOf('"' + k + '": "') > 0, 'EN: ' + k));
  });
  test('Importador sin evento: pegar + fila manual en línea → nada se guarda hasta «Importar»; vista previa conjunta; se importa todo junto', () => {
    const t = panel(), T = t.env.win.ShowtimePanel._test;
    const s0 = dump(t), undo0 = t.env.getEl('btn-undo').disabled;
    t.env.fire('document', 'paste', pasteEv(CARTEL));
    t.env.fire('imp-new', 'input', { target: { id: 'imp-name', value: 'Noches' } });                      // nombre provisional
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '0', k: 'notas' }, value: 'Backline propio' } });   // edición de una fila pegada
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '1' }, checked: false } });                 // e inclusión quitada
    t.env.fire('imp-jor', 'change', { target: { value: '2026-07-11' } });                                    // jornada por defecto
    eq(t.env.getEl('imp-man').hidden, true, 'la ficha empieza plegada');
    ok(/<div class="imp-foot">[\s\S]*?<button id="imp-man-open"[^>]*>[\s\S]*?Añadir fila manual<\/button>/.test(srcRaw('index.html')), '«+ Añadir fila manual» visible, en el pie');
    t.env.fire('imp-man-open', 'click', {});
    eq(t.env.getEl('imp-man').hidden, false, 'se despliega dentro del importador'); eq(t.env.getEl('imp').hidden, false, 'sin cerrar #imp'); eq(t.env.getEl('addm').hidden, true, 'sin otro modal');
    manFill(t, { tipo: 'sc', nombre: 'Fila Mano', zona: 'Carpa', jor: '2026-07-11', ini: '19:00', fin: '+30', notas: 'a mano' });
    t.env.fire('imp-m-add', 'click', {});
    eq(t.env.getEl('imp-m-err').textContent, '', 'sin error');
    eq(t.env.getEl('imp-m-nombre').value, '', 'la ficha se limpia'); eq(t.env.getEl('imp-man').hidden, false, 'y sigue abierta para otra');
    eq(t.env.getEl('imp-man-n').textContent, '1 fila manual en el borrador');
    const pv = ultimo(t, 'imp-prev');
    ok(/value="Los Ácratas"/.test(pv) && /value="DJ Uno"/.test(pv) && /value="Fila Mano"/.test(pv), 'pegadas y manual juntas');
    ok(pv.indexOf('value="DJ Uno"') < pv.indexOf('value="Fila Mano"') && /<span class="man">manual<\/span>/.test(pv), 'la manual detrás, marcada');
    ok(/value="Backline propio"/.test(pv), 'la edición de la fila pegada se conserva');
    ok(/<input type="checkbox" data-inc="1">/.test(pv), 'la inclusión quitada se conserva');
    ok(/id="imp-name"[^>]*value="Noches"/.test(ultimo(t, 'imp-new')), 'el nombre provisional se conserva');
    eq(t.env.getEl('imp-jor').value, '2026-07-11', 'la jornada por defecto se conserva');
    eq(t.env.getEl('imp-text').value, CARTEL, 'el texto, intacto');
    eq(t.env.getEl('imp-go').title, 'Importar: 2 filas', 'total: Los Ácratas + la manual (DJ Uno desmarcada)');
    eq(dump(t), s0, 'hasta «Importar», nada en el almacén (ni evento, ni log, ni emisión)'); eq(t.read('showtime.festival'), null);
    eq(t.env.getEl('btn-undo').disabled, undo0, 'ni Deshacer');
    // Cambiar el texto pegado no se lleva la fila manual
    t.env.getEl('imp-text').value = CARTEL + '\n11/07/2026\tCarpa\tTres\t22:00\t23:00';
    T.setImportText(t.env.getEl('imp-text').value);
    ok(/value="Fila Mano"/.test(ultimo(t, 'imp-prev')) && /value="Tres"/.test(ultimo(t, 'imp-prev')), 'tras cambiar el texto, la manual sigue');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    ok(s, 'evento creado al importar'); eq(s.event.nombre, 'Noches');
    eq(s.artists.map(a => a.nombre).sort().join(), 'DJ Uno,Fila Mano,Los Ácratas,Tres', 'todo junto, de una vez');
    const sc = C.buildBlocks(s, { mode: 'sc', day: 'all' }).find(b => b.name === 'Fila Mano');
    ok(sc && sc.jornada === '2026-07-11' && sc.stage === 'Carpa', 'la manual entra como soundcheck, en su jornada y zona');
    ok(!C.buildBlocks(s, { mode: 'show', day: 'all' }).some(b => b.name === 'Fila Mano'), 'y no como show');
    eq(t.env.getEl('imp').hidden, true); eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador · jerarquía final: «+ Añadir fila manual» en el pie a la izquierda; Cancelar · Importar a la derecha; la ficha debajo de la vista previa', () => {
    const H = srcRaw('index.html'), css = D.src('control.css');
    const imp = H.slice(H.indexOf('<div id="imp"'), H.indexOf('<datalist id="zones-dl"'));
    ok(/<div class="imp-foot"><p id="imp-sum" class="imp-sum" role="status" aria-live="polite"><\/p><div class="imp-foot-row"><button id="imp-man-open" class="btn ghost imp-man-open" type="button" aria-expanded="false" aria-controls="imp-man" data-i18n><svg class="ic"><use href="#i-plus"\/><\/svg>Añadir fila manual<\/button><div class="imp-foot-acts"><button id="imp-cancel" class="btn" data-i18n>Cancelar<\/button><button id="imp-go" class="btn primary">Importar<\/button><\/div><\/div><\/div>/.test(imp), 'pie en dos niveles: resumen arriba; [+ Añadir fila manual] … [Cancelar] [Importar] debajo');
    eq((imp.match(/id="imp-man-open"/g) || []).length, 1, 'un solo botón (fuera de debajo de Opciones)');
    ok(imp.indexOf('imp-prevcard') < imp.indexOf('id="imp-man"') && imp.indexOf('id="imp-man"') < imp.indexOf('class="imp-foot"'), 'la ficha va DESPUÉS de la vista previa y justo encima del pie');
    ok(imp.indexOf('class="imp-opts"') < imp.indexOf('imp-prevcard') && !/imp-mapcard[\s\S]*id="imp-man"[\s\S]*imp-prevcard/.test(imp), 'nada de la ficha entre Opciones y Vista previa');
    ok(/\.imp-foot\{display:flex;flex-direction:column;gap:8px;position:sticky;bottom:calc\(-1 \* var\(--imp-pad,20px\)\);/.test(css) && /\.imp-foot-row\{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px\}/.test(css) && /\.imp-foot-acts\{display:flex;align-items:center;gap:8px;margin-left:auto\}/.test(css), 'dos niveles; Cancelar e Importar juntos a la derecha; si el pie envuelve, bajan juntas (Importar siempre a la vista)');
    ok(/\.imp-sum\{margin:0;padding-bottom:7px;border-bottom:1px solid var\(--hair[^)]*\)\);font-size:12px;/.test(css) && !/\.imp-sum\{[^}]*(background|border-radius)/.test(css), 'resumen discreto: raya fina, sin caja ni píldora');
    ok(/\.imp-sum \.s-exc\{color:var\(--call\)\} \.imp-sum \.s-err\{color:var\(--err\)\}/.test(css) && !/\.imp-sum \.s-imp\{/.test(css), 'solo Excluidas y Error llevan color');
    ok(/<button id="imp-m-add" class="btn" type="button"/.test(imp) && (imp.match(/class="btn primary"/g) || []).length === 1, 'Importar es la única acción primaria del importador');
  });
  test('Importador · varias filas manuales seguidas: al final de la vista previa en orden de incorporación; la ficha sigue abierta; total correcto; scroll a la nueva', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) }), s0 = dump(t);
    t.env.fire('document', 'paste', pasteEv('23:00-23:20 Banda Nueva Principal\n23:30-23:50 Otra Pegada Principal'));
    t.env.fire('imp-man-open', 'click', {});
    eq(t.env.getEl('imp-man').hidden, false, 'se abre desde el pie');
    const W = t.env.getEl('imp-prevwrap'); W.scrollTop = 0;
    manFill(t, { tipo: 'sc', nombre: 'Uno', zona: 'Principal', jor: JOR, ini: '18:00', fin: '18:30' }); t.env.fire('imp-m-add', 'click', {});
    eq(t.env.getEl('imp-m-tipo').value, 'sc', 'el tipo elegido se queda'); eq(t.env.getEl('imp-m-jor').value, JOR, 'y la jornada');
    eq(t.env.getEl('imp-m-nombre').value, '', 'nombre limpio para la siguiente'); eq(t.env.getEl('imp-man').hidden, false, 'la ficha sigue abierta');
    // v20261166: el scroll va hasta la fila nueva por su id estable (aquí, la última: debajo de lo visible)
    const pedidas = []; W.scrollTop = 0; W.clientHeight = 300; W.getBoundingClientRect = () => ({ top: 100, bottom: 400 });
    W.querySelector = q => { pedidas.push(q); return q === 'thead' ? { getBoundingClientRect: () => ({ height: 30 }) } : /^tr\[data-rid="m2"\]$/.test(q) ? { getBoundingClientRect: () => ({ top: 700, bottom: 730 }) } : null; };
    t.env.getEl('imp-m-nombre').value = 'Dos'; t.env.getEl('imp-m-zona').value = 'Principal'; t.env.getEl('imp-m-ini').value = '18:40'; t.env.getEl('imp-m-fin').value = '+20';
    t.env.fire('imp-m-add', 'click', {});
    ok(pedidas.indexOf('tr[data-rid="m2"]') >= 0, 'busca la fila nueva por su id estable'); eq(W.scrollTop, 330, 'la vista previa baja lo justo hasta la fila nueva (la última)');
    t.env.getEl('imp-m-nombre').value = 'Tres'; t.env.getEl('imp-m-zona').value = 'Principal'; t.env.getEl('imp-m-ini').value = '19:10'; t.env.getEl('imp-m-fin').value = '19:30';
    t.env.fire('imp-m-add', 'click', {});
    const pv = ultimo(t, 'imp-prev'), at = n => pv.indexOf('value="' + n + '"');
    ok(at('Banda Nueva') < at('Otra Pegada') && at('Otra Pegada') < at('Uno') && at('Uno') < at('Dos') && at('Dos') < at('Tres'), 'pegadas primero; manuales al final, en orden de incorporación');
    eq((pv.match(/<span class="man">manual<\/span>/g) || []).length, 3);
    eq(t.env.getEl('imp-man-n').textContent, '3 filas manuales en el borrador');
    eq(t.env.getEl('imp-go').title, 'Importar: 5 filas', '2 pegadas + 3 manuales');
    eq(dump(t), s0, 'nada guardado aún');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival'), sc = C.buildBlocks(s, { mode: 'sc', day: 'all' }).map(b => b.name);
    eq(s.artists.length, F.s.artists.length + 5); ok(['Uno', 'Dos', 'Tres'].every(n => sc.indexOf(n) >= 0), 'las tres manuales como soundcheck: ' + sc.join());
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador · resumen por FILAS: «Importar» siempre; «Excluidas» y «Error» solo si hay; avisos importables no son error; ES/EN y botón accesible', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) }), go = t.env.getEl('imp-go');
    const sum = () => t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, '');
    t.env.fire('btn-paste', 'click', {});
    eq(sum(), 'Importar: 0 filas', 'vacío: solo «Importar»'); eq(go.textContent, 'Importar'); eq(go.title, 'Importar: 0 filas'); eq(go.disabled, true);
    t.env.win.ShowtimePanel._test.setImportText('Banda\tZona\tInicio\tFin\nUno\tPrincipal\t23:00\t23:20\nDos\tPrincipal\t23:30\t23:50\n\tPrincipal\t21:00\t22:00\nTres\tZona Nueva\t20:00\t20:30');
    ok(/\d+ OK|a revisar|con error|To import|Rows with errors|entradas listas/.test(t.env.getEl('imp-sum').innerHTML) === false, 'nada de los textos de antes');
    const pv = ultimo(t, 'imp-prev');
    const nRows = (pv.match(/<tr class="st-/g) || []).length, nErr = (pv.match(/<tr class="st-err/g) || []).length;
    ok(nRows >= 3, 'filas: ' + nRows);
    const s1 = sum();
    ok(/^Importar: \d+ filas?/.test(s1) && !/Excluidas/.test(s1), 'sin excluidas: no sale «Excluidas»: ' + s1);
    eq(nRows, 4); eq(nErr, 1, 'una fila sin nombre');
    eq(s1, 'Importar: 3 filas · Error: 1 fila', 'error = filas con error (no mensajes), en singular; sin «Excluidas»');
    ok(/<span class="s-err">Error: 1 fila<\/span>/.test(t.env.getEl('imp-sum').innerHTML), 'con su color');
    ok((pv.match(/<tr class="st-warn/g) || []).length >= 1 && !new RegExp('Error: ' + (nErr + 1)).test(s1), 'las filas con advertencias cuentan en Importar');
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '0' }, checked: false } });
    ok(/· Excluidas: 1 fila(?: ·|$)/.test(sum()), 'desmarcar una: «Excluidas: 1 fila» (singular): ' + sum());
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '1' }, checked: false } });
    ok(/Excluidas: 2 filas/.test(sum()), 'plural: ' + sum());
    ok(/<span class="s-exc">Excluidas: 2 filas<\/span>/.test(t.env.getEl('imp-sum').innerHTML), 'con su color');
    const nImp = +sum().match(/^Importar: (\d+)/)[1];
    eq(go.title, 'Importar: ' + nImp + (nImp === 1 ? ' fila' : ' filas'), 'title con la cantidad'); eq(go.textContent, 'Importar', 'botón estable, sin número');
    ok(/\$\('imp-go'\)\.setAttribute\('aria-label', goLbl\)/.test(D.src('control.js')), 'aria-label = title');
    const cj = D.src('control.js');
    ok((cj.match(/(Excluidas|Error): \{n\} filas?'/g) || []).length === 4 && !/['"](Excluidas|Error): \d|Excluded: |Error: ' \+|Excluidas: ' \+/.test(cj), 'los textos del resumen solo como claves tx() de i18n.js (nada escrito a mano ni concatenado)');
    const src18 = D.src('i18n.js');
    ['"Excluidas: {n} fila": "Excluded: {n} row"', '"Excluidas: {n} filas": "Excluded: {n} rows"', '"Error: {n} fila": "Error: {n} row"', '"Error: {n} filas": "Error: {n} rows"'].forEach(x => ok(src18.indexOf(x) >= 0, 'pareja exacta en i18n.js: ' + x));
    const I = require('../i18n.js');
    [['Importar: {n} fila', 'Import: 1 row', 1], ['Importar: {n} filas', 'Import: 3 rows', 3], ['Excluidas: {n} fila', 'Excluded: 1 row', 1], ['Excluidas: {n} filas', 'Excluded: 2 rows', 2], ['Error: {n} fila', 'Error: 1 row', 1], ['Error: {n} filas', 'Error: 4 rows', 4], ['Importar', 'Import']].forEach(([k, en, n]) => eq(I.tx(k, { n }, 'en'), en));
    const i18 = D.src('i18n.js');
    ok(!/To import|Rows with errors|"Con error|entradas listas|Tienes varias bandas|Several bands\? Use/.test(i18), 'sin las variantes descartadas ni la clave huérfana');
    ok(!/"Importar \{n\} entrada|\{a\} OK<\/span>/.test(i18) && !/'Importar \{n\} entrada|\{a\} OK<\/span>/.test(D.src('control.js')), 'fuera los textos del pie anterior (sin claves huérfanas)');
    t.env.win.ShowtimePanel._test.setAppLang('en');
    ok(/^Import: \d+ rows? · Excluded: 2 rows/.test(sum()), 'en inglés: ' + sum()); eq(go.textContent, 'Import'); ok(/^Import: \d+ rows?$/.test(go.title));
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador · «Error ⓘ»: el detalle siempre cabe entero en pantalla (primera y última fila, motivo largo, tablet 768 px)', () => {
    const P = panel().env.win.ShowtimePanel._test.errPopPlace, inside = (p, w, h, vw, vh) => p.left >= 8 && p.top >= 8 && p.left + w <= vw - 8 && p.top + h <= vh - 8;
    // Primera fila, escritorio: a la derecha, pegado
    let p = P({ left: 80, right: 130, top: 300, bottom: 318 }, 220, 40, 1180, 820); eq(p.side, 'right'); eq(p.left, 130); ok(inside(p, 220, 40, 1180, 820));
    // Última fila pegada al pie de la pantalla: sube lo necesario, nunca se sale por abajo
    p = P({ left: 80, right: 130, top: 800, bottom: 818 }, 220, 60, 1180, 820); ok(inside(p, 220, 60, 1180, 820), 'última fila: entero (' + JSON.stringify(p) + ')');
    // Motivo largo en tablet vertical: ocupa como mucho el ancho de la pantalla menos márgenes y no se sale
    p = P({ left: 60, right: 110, top: 600, bottom: 618 }, 752, 90, 768, 1024); ok(inside(p, 752, 90, 768, 1024) && p.side === 'below', 'largo a 768 px: debajo, entero');
    p = P({ left: 60, right: 110, top: 990, bottom: 1010 }, 752, 90, 768, 1024); ok(inside(p, 752, 90, 768, 1024) && p.side === 'above', 'largo en la última fila a 768 px: encima, entero');
    // Botón con la tabla desplazada (parte fuera por la izquierda): se recoloca dentro
    p = P({ left: -30, right: 20, top: 400, bottom: 418 }, 752, 40, 768, 1024); ok(inside(p, 752, 40, 768, 1024));
  });
  test('Importador · detalle de Error fijado: no tapa Cancelar, Importar ni Excluir, y un toque en ellas actúa al primer gesto', () => {
    const P = panel().env.win.ShowtimePanel._test.errPopPlace;
    const hit = (p, w, h, a) => p.left < a.right && p.left + w > a.left && p.top < a.bottom && p.top + h > a.top;
    // Última fila a 768 px, motivo largo: el pie (Cancelar · Importar) justo debajo y «Excluir» bajo el botón
    const btn = { left: 60, right: 118, top: 860, bottom: 878 }, exc = { left: 56, top: 880, right: 126, bottom: 900 };
    const cancel = { left: 543, top: 924, right: 638, bottom: 974 }, go = { left: 638, top: 924, right: 731, bottom: 974 }, man = { left: 37, top: 930, right: 217, bottom: 970 };
    const avoid = [cancel, go, man, exc];
    let p = P(btn, 320, 72, 768, 1024, 8, avoid);
    ok(avoid.every(a => !hit(p, 320, 72, a)), 'motivo largo en la última fila: no tapa nada (' + JSON.stringify(p) + ')');
    ok(p.left >= 8 && p.left + 320 <= 760 && p.top >= 8 && p.top + 72 <= 1016, 'y entero en pantalla');
    p = P(btn, 700, 110, 768, 1024, 8, avoid);
    ok(avoid.every(a => !hit(p, 700, 110, a)) && p.side === 'above', 'aún más largo: encima, sin tapar nada');
    // «Excluir» asoma a la derecha del botón: el detalle se alinea por abajo y lo deja libre
    p = P({ left: 60, right: 100, top: 400, bottom: 418 }, 220, 60, 1180, 820, 8, [{ left: 56, top: 420, right: 140, bottom: 440 }]);
    ok(!hit(p, 220, 60, { left: 56, top: 420, right: 140, bottom: 440 }), 'no tapa el Excluir de su fila');
    // En el importador: con el detalle FIJADO, un toque en Cancelar / Excluir / Importar hace su acción a la primera
    const F = fest(), mk = () => { const t = panel({ 'showtime.festival': JSON.stringify(F.s) }); t.env.fire('btn-paste', 'click', {});
      t.env.win.ShowtimePanel._test.setImportText('Banda\tZona\tInicio\tFin\nUno\tPrincipal\t23:00\t23:20\n\tPrincipal\t21:00\t22:00'); return t; };
    const pin = t => { const at = {}; const b = { dataset: { errtip: '1', why: 'Falta el nombre de la banda' }, setAttribute: (k, v) => { at[k] = v; }, getBoundingClientRect: () => ({ left: 60, right: 110, top: 500, bottom: 520 }) };
      b.closest = q => q === '[data-errtip]' ? b : null; t.env.fire('imp-prev', 'click', { target: b }); ok(t.env.win.ShowtimePanel._test.errPop().pinned, 'detalle fijado'); return at; };
    const fuera = { closest: () => null };
    let t = mk(); pin(t);
    t.env.fire('imp-cancel', 'click', { target: fuera }); t.env.fire('document', 'click', { target: fuera });
    eq(t.env.getEl('imp').hidden, true, 'Cancelar: cierra el importador al primer toque'); ok(!t.env.win.ShowtimePanel._test.errPop().open, 'y el detalle con él');
    t = mk(); pin(t);
    const sum = () => t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, '');
    t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { exc: '1' } } : null } }); t.env.fire('document', 'click', { target: fuera });
    eq(sum(), 'Importar: 1 fila · Excluidas: 1 fila', 'Excluir: actúa al primer toque'); ok(!t.env.win.ShowtimePanel._test.errPop().open, 'el detalle se cierra como consecuencia');
    t = mk(); pin(t);
    t.env.fire('imp-go', 'click', { target: fuera }); t.env.fire('document', 'click', { target: fuera });
    eq(t.read('showtime.festival').artists.length, F.s.artists.length + 1, 'Importar: importa al primer toque (solo la válida)');
    eq(t.env.errors.length, 0);
    ok(/errPopAvoid\(btn\)/.test(D.src('control.js')) && /\$\('imp-cancel'\), \$\('imp-go'\), \$\('imp-man-open'\), act\]/.test(D.src('control.js')), 'el detalle esquiva Cancelar, Importar, Añadir fila manual y la acción de su fila');
    const zonaPop = D.src('control.js').slice(D.src('control.js').indexOf('function errPopShow'), D.src('control.js').indexOf('/** ¿Fila desmarcada a mano'));
    ok(!/stopPropagation/.test(zonaPop) && (zonaPop.match(/preventDefault/g) || []).length === 1 && /if \(e\.key !== 'Tab' \|\| e\.shiftKey[^\n]*\n[^\n]*e\.preventDefault\(\); c\.focus\(\);/.test(zonaPop), 'el detalle no consume ningún gesto (solo encamina Tab de Error a su acción contextual)');
  });
  // ── v20261166 · orden visual y ancho de columnas de la vista previa ──
  const SORT_TXT = 'Banda\tZona\tInicio\tFin\nÁlvaro\tPrincipal\t23:00\t23:40\nbanda 10\tPrincipal\t00:30\t01:00\nbanda 2\tPrincipal\t20:00\t21:00\n\tPrincipal\t21:00\t\nZeta\tPrincipal\t\t';
  const sortPanel = () => { const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) }); t.env.fire('btn-paste', 'click', {}); t.env.win.ShowtimePanel._test.setImportText(SORT_TXT); return { F, t }; };
  const ridsOf = t => (ultimo(t, 'imp-prev').match(/data-rid="[^"]+"/g) || []).map(x => x.slice(10, -1)).join(' ');
  const headOf = t => { const h = ultimo(t, 'imp-prev'); return h.slice(0, h.indexOf('</thead>')); };
  const sortClick = (t, k) => t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-sort]' ? { dataset: { sort: k } } : null } });
  test('Importador v20261166 · orden visual (puro): asc / desc / original, vacíos e incompletos al final, jornada + hora operativa, Tipo semántico, empates estables, texto natural', () => {
    const T = panel().env.win.ShowtimePanel._test, S = (rows, k, dir, lang) => T.impSortRows(rows, k ? { k, dir } : null, { cut: 360, lang: lang || 'es' }).map(r => r.id).join(' ');
    const J1 = '2026-07-10', J2 = '2026-07-11';
    const rows = [
      { id: 'a', idx: 0, tipo: 'tarea', banda: 'Álvaro', escenario: 'carpa', jornada: J1, inicio: '23:00', fin: '23:40', call: '', notas: '' },
      { id: 'b', idx: 1, tipo: 'show', banda: 'banda 10', escenario: 'Carpa', jornada: J1, inicio: '00:30', fin: '01:00', call: '00:00', notas: 'x' },
      { id: 'c', idx: 2, tipo: 'hito', banda: 'banda 2', escenario: 'Principal', jornada: J2, inicio: '20:00', fin: '21:00', call: '19:00', notas: '' },
      { id: 'd', idx: 3, tipo: 'sc', banda: '', escenario: '', jornada: '', inicio: '21:00', fin: '', call: '', notas: '' },
      { id: 'e', idx: 4, tipo: 'show', banda: 'zeta', escenario: 'carpa', jornada: J1, inicio: '', fin: '', call: '22:00', notas: 'ÉPICO' }];
    const snap = JSON.stringify(rows);
    // Horas: jornada operativa y, dentro, la hora tras el corte (06:00): 00:30 del 10 va después de 23:00 del 10; sin jornada o sin hora, al final
    eq(S(rows, 'inicio', 'asc'), 'a b c d e', 'Inicio ↑: 23:00 → 00:30 (misma jornada) → jornada siguiente; incompletos al final en su orden');
    eq(S(rows, 'inicio', 'desc'), 'c b a d e', 'Inicio ↓: incompletos siguen al final');
    eq(S(rows, null), 'a b c d e', 'sin orden: el original');
    eq(S(rows, 'fin', 'asc'), 'a b c d e', 'Fin ↑: 23:40 → 01:00 del día siguiente (misma jornada); el marcador (c) muestra «—» → vacío, al final');
    eq(S(rows, 'fin', 'desc'), 'b a c d e', 'Fin ↓; vacíos al final en su orden');
    eq(S(rows, 'call', 'asc'), 'e b a c d', 'CALL ↑: 22:00 antes que 00:00 (tras el corte, misma jornada); tareas y marcadores («—») al final');
    eq(S(rows, 'call', 'desc'), 'b e a c d', 'CALL ↓');
    eq(S(rows, 'jornada', 'asc'), 'a b e c d', 'Jornada ↑ (empates en orden original; sin jornada al final)');
    eq(S(rows, 'jornada', 'desc'), 'c a b e d', 'Jornada ↓ (empates en orden original; sin jornada al final)');
    eq(S(rows, 'tipo', 'asc'), 'b e d a c', 'Tipo ↑: Show → Soundcheck → Tarea → Marcador (empates estables)');
    eq(S(rows, 'tipo', 'desc'), 'c a d b e', 'Tipo ↓: al revés, empates estables');
    eq(S(rows, 'banda', 'asc'), 'a c b e d', 'Nombre ↑: natural (2 < 10), sin mayúsculas ni acentos; vacío al final');
    eq(S(rows, 'banda', 'desc'), 'e b c a d', 'Nombre ↓; vacío al final');
    eq(S(rows, 'escenario', 'asc'), 'a b e c d', 'Zona ↑: «carpa» = «Carpa» → empate estable');
    eq(S(rows, 'notas', 'asc'), 'e b a c d', 'Notas ↑: «ÉPICO» = «epico» < «x»; vacíos al final');
    eq(S(rows, 'banda', 'asc', 'en'), S(rows, 'banda', 'asc', 'es'), 'mismo orden en inglés');
    eq(S(rows, 'notas', 'desc', 'en'), 'b e a c d', 'Notas ↓ en inglés');
    eq(JSON.stringify(rows), snap, 'nunca muta las filas ni su orden');
  });
  test('Importador v20261166 · cabeceras: Tipo…Notas ordenan (botón real, aria-sort, ciclo asc → desc → original) y llevan tirador separado; casilla, Estado y Avisos no; rótulo de estado; ES/EN', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test;
    const h0 = headOf(t);
    ['tipo', 'escenario', 'banda', 'jornada', 'inicio', 'fin', 'call', 'notas'].forEach((k, n) => {
      ok(new RegExp('<th class="srt" data-colk="' + k + '"><button type="button" class="imp-sortbtn" data-sort="' + k + '" title="Ordenar por [^"]+ \\(ascendente\\)">[^<]+<svg class="ic so"[^>]*aria-hidden="true"[\\s\\S]*?</svg></button><button type="button" class="imp-colgrip" data-grip="' + (n + 2) + '" aria-expanded="false" aria-controls="imp-colctl" aria-label="Ancho de la columna [^"]+" title="Arrastra para cambiar el ancho; clic, Intro o Espacio para ajustarlo con − / \\+"></button></th>').test(h0), 'cabecera ' + k);
    });
    ok(/<thead><tr><th><\/th><th class="srt nogrip" data-colk="estado"><button type="button" class="imp-sortbtn" data-sort="estado"/.test(h0) && /<th>Avisos<\/th><\/tr>/.test(h0), 'casilla y Avisos: sin botón ni tirador; Estado (v20261167): botón sin tirador');
    eq((h0.match(/data-sort=/g) || []).length, 9); eq((h0.match(/data-grip=/g) || []).length, 8); ok(!/aria-sort/.test(h0), 'sin orden: ningún aria-sort');
    const orig = ridsOf(t);
    eq(orig, 'p0 p1 p2 p3 p4');
    sortClick(t, 'inicio');
    eq(ridsOf(t), 'p2 p3 p0 p1 p4', 'Inicio ↑: 20:00, 21:00, 23:00, 00:30 (misma jornada, tras el corte); sin hora al final');
    ok(/<th class="srt" data-colk="inicio" aria-sort="ascending"><button[^>]*title="Ordenado de forma ascendente\. Pulsa para descendente"/.test(headOf(t)), 'aria-sort ascending + título');
    eq(t.env.getEl('imp-sortnote').textContent, 'Vista ordenada por Inicio (ascendente). El orden de importación no cambia.');
    sortClick(t, 'inicio');
    ok(/data-colk="inicio" aria-sort="descending"><button[^>]*title="Ordenado de forma descendente\. Pulsa para volver al orden original"/.test(headOf(t)), 'aria-sort descending');
    eq(t.env.getEl('imp-sortnote').textContent, 'Vista ordenada por Inicio (descendente). El orden de importación no cambia.');
    sortClick(t, 'inicio');
    eq(ridsOf(t), orig, 'tercer clic: orden original'); ok(!/aria-sort/.test(headOf(t))); eq(t.env.getEl('imp-sortnote').textContent, 'Vista en el orden original.');
    sortClick(t, 'banda'); eq(ridsOf(t), 'p0 p2 p1 p4 p3', 'Nombre ↑: Álvaro, banda 2, banda 10, Zeta; sin nombre al final');
    sortClick(t, 'jornada'); ok(/data-colk="jornada" aria-sort="ascending"/.test(headOf(t)) && !/data-colk="banda" aria-sort/.test(headOf(t)), 'otra columna: empieza en ascendente y solo ella lleva aria-sort');
    // Clic en el tirador: NO ordena
    const antes = JSON.stringify(T.imp().sort);
    t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-grip]' ? { dataset: { grip: '4' } } : null } });
    eq(JSON.stringify(T.imp().sort), antes, 'el tirador no ordena');
    // Inglés
    T.setAppLang('en');
    ok(/data-sort="jornada" title="Sorted ascending\. Press for descending">Day/.test(headOf(t)), 'EN: título y rótulo de cabecera: ' + headOf(t).slice(0, 0));
    ok(/data-sort="banda" title="Sort by Name \(ascending\)">Name/.test(headOf(t)) && /data-grip="4" aria-expanded="false" aria-controls="imp-colctl" aria-label="Width of column Name" title="Drag to change the width; click, Enter or Space to adjust it with − \/ \+"/.test(headOf(t)), 'EN: tirador');
    eq(t.env.getEl('imp-sortnote').textContent, 'View sorted by Day (ascending). The import order does not change.');
    sortClick(t, 'jornada'); eq(t.env.getEl('imp-sortnote').textContent, 'View sorted by Day (descending). The import order does not change.');
    sortClick(t, 'jornada'); eq(t.env.getEl('imp-sortnote').textContent, 'View in original order.');
    T.setAppLang('es');
    const src = D.src('control.js'), a = src.indexOf('// ── v20261166'), z = src.indexOf('function impRender(');
    ok(a > 0 && z > a, 'bloque nuevo localizado');
    const bloque = src.slice(a, z);
    ok(!/'[A-ZÁÉÍÓÚ][a-záéíóúñ]+ [a-záéíóúñ]+[^']*'(?!\))/.test(bloque.replace(/tx\('[^']*'/g, '').replace(/l: '[^']*'/g, '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'ningún texto nuevo sin tx() en control.js');
    ok(!/touchstart/.test(src), 'sin touchstart');
  });
  test('Importador v20261166 · ordenar no cambia el borrador: IMP.pv.rows, lo que se importa y el Dashboard quedan en el orden original', () => {
    const run = sorted => {
      const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test;
      const pv0 = T.imp().pv.rows.map(r => r.idx).join(',');
      if (sorted) { sortClick(t, 'banda'); sortClick(t, 'banda'); eq(ridsOf(t), 'p4 p1 p2 p0 p3', 'vista ↓'); }
      eq(T.imp().pv.rows.map(r => r.idx).join(','), pv0, 'IMP.pv.rows intacto');
      t.env.fire('imp-go', 'click', {});
      return { arts: t.read('showtime.festival').artists.map(a => a.nombre).join('|'), dash: (ultimo(t, 'tbody').match(/banda 10|banda 2|Álvaro|Banda A/g) || []).join('|') };
    };
    const a = run(false), b = run(true);
    eq(b.arts, a.arts, 'misma secuencia importada'); ok(a.dash.length > 0); eq(b.dash, a.dash, 'Dashboard idéntico');
  });
  test('Importador v20261166 · un campo con foco no se recoloca; al confirmar (Intro) o al salir, la fila va a su sitio; texto: se recoloca al confirmar', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document;
    sortClick(t, 'tipo'); eq(ridsOf(t), 'p0 p1 p2 p3 p4', 'todas Show: empate → original');
    // El desplegable Tipo de la fila 1 tiene el foco y cambia a Marcador
    const sel = { dataset: { row: '1', k: 'tipo' }, value: 'hito', tagName: 'SELECT', matches: q => q === '#imp-prev tbody [data-row]' || q === 'select[data-row]' || q === 'tbody [data-row]', closest: q => q === '#imp-prev' ? {} : null };
    doc.activeElement = sel;
    t.env.fire('imp-prev', 'change', { target: sel });
    eq(T.imp().pv.rows[1].tipo, 'hito', 'el cambio se aplica');
    eq(ridsOf(t), 'p0 p1 p2 p3 p4', 'con el foco en su campo: la fila NO se mueve');
    ok(T.imp().held, 'orden retenido');
    let pd = 0; t.env.fire('imp-prev', 'keydown', { key: 'Enter', target: sel, preventDefault: () => { pd++; } });
    eq(ridsOf(t), 'p0 p2 p3 p4 p1', 'Intro: confirma y la fila va a su sitio (Marcador al final)'); eq(pd, 1); ok(!T.imp().held);
    // Otra vez: cambiar a Tarea con foco y salir del campo hacia fuera de la tabla
    sel.dataset.row = '2'; sel.value = 'tarea'; t.env.fire('imp-prev', 'change', { target: sel });
    eq(ridsOf(t), 'p0 p2 p3 p4 p1', 'retenida'); doc.activeElement = null;
    t.env.fire('imp-prev', 'focusout', { target: sel, relatedTarget: { closest: () => null } });
    eq(ridsOf(t), 'p0 p3 p4 p2 p1', 'al perder el foco: Tarea antes de Marcador');
    // Y saliendo hacia otro control de la tabla: se recoloca cuando el foco llega a él
    doc.activeElement = sel; sel.dataset.row = '0'; sel.value = 'sc'; t.env.fire('imp-prev', 'change', { target: sel });
    eq(ridsOf(t), 'p0 p3 p4 p2 p1', 'retenida');
    const otro = { closest: q => q === '#imp-prev' ? {} : null };
    t.env.fire('imp-prev', 'focusout', { target: sel, relatedTarget: otro }); eq(ridsOf(t), 'p0 p3 p4 p2 p1', 'aún no (el foco está llegando a otro control)');
    doc.activeElement = otro; t.env.fire('imp-prev', 'focusin', { target: otro });
    eq(ridsOf(t), 'p3 p4 p0 p2 p1', 'al llegar: Soundcheck tras los Show');
    // Texto (Nombre): el cambio llega al confirmar (Intro o salir: el campo ya no tiene el foco) → se recoloca a la vez
    doc.activeElement = null; sortClick(t, 'banda'); eq(ridsOf(t), 'p0 p2 p1 p4 p3');
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '0', k: 'banda' }, value: 'zz último' } });
    eq(ridsOf(t), 'p2 p1 p4 p0 p3', 'confirmado: «zz último» detrás de Zeta');
    // Al rehacer la tabla, el navegador quita el control enfocado (y avisa con focusout): eso no es «salir del campo»
    const src = D.src('control.js');
    ok(/IMP_PAINT = true;\s*try \{\s*\$\('imp-prev'\)\.innerHTML = /.test(src) && /\} finally \{ IMP_PAINT = false; \}/.test(src) && /if \(IMP_PAINT \|\| !IMP \|\| !IMP\.held/.test(src), 'el focusout del repintado no recoloca');
  });
  test('Importador v20261166 · fila manual con orden activo: se anexa al borrador como siempre, aparece en su sitio ordenado y la vista previa va hasta ella', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test;
    sortClick(t, 'banda');
    const W = t.env.getEl('imp-prevwrap'), pedidas = []; W.scrollTop = 500; W.clientHeight = 300; W.getBoundingClientRect = () => ({ top: 100, bottom: 400 });
    W.querySelector = q => { pedidas.push(q); return q === 'thead' ? { getBoundingClientRect: () => ({ height: 30 }) } : q === 'tr[data-rid="m1"]' ? { getBoundingClientRect: () => ({ top: 60, bottom: 90 }) } : null; };
    t.env.fire('imp-man-open', 'click', {});
    manFill(t, { nombre: 'Aaa', zona: 'Principal', ini: '18:00', fin: '18:30' }); t.env.fire('imp-m-add', 'click', {});
    eq(T.imp().manual.map(m => m.uid).join(), 'm1'); eq(T.imp().pv.rows[T.imp().pv.rows.length - 1].banda, 'Aaa', 'internamente: al final, como hoy');
    eq(ridsOf(t), 'm1 p0 p2 p1 p4 p3', 'en la vista: en su sitio ordenado');
    ok(pedidas.indexOf('tr[data-rid="m1"]') >= 0, 'busca su id estable'); eq(W.scrollTop, 500 - (130 - 60), 'sube hasta ella (bajo la cabecera fija)');
  });
  test('Importador v20261166 · anchos: solo mientras el importador está abierto; Restablecer columnas, Cancelar, Esc y un importador nuevo vuelven a los iniciales; tirador sin touchstart y con touch-action propio', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, tbl = t.env.getEl('imp-prev');
    // Sin medidas (entorno sin maquetación): el tirador no hace nada raro
    t.env.fire('imp-prev', 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, target: { closest: q => q === '[data-grip]' ? { dataset: { grip: '4' } } : null }, preventDefault() {} });
    eq(T.imp().colW, undefined, 'sin poder medir: no se fija nada'); eq(t.env.errors.length, 0);
    // Anchos ajustados (como tras arrastrar): Restablecer los quita
    const set = () => { T.imp().colW = Array(11).fill(100); T.imp().colMin = Array(11).fill(40); };
    set(); t.env.fire('imp-colreset', 'click', {}); eq(T.imp().colW, null, 'Restablecer columnas'); ok(!tbl._classes.has('colfix'), 'diseño automático'); eq(tbl.style.width, '');
    set(); t.env.fire('imp-cancel', 'click', {}); ok(!tbl._classes.has('colfix') && tbl.style.width === '', 'Cancelar: anchos iniciales');
    t.env.fire('btn-paste', 'click', {}); eq(T.imp().colW, undefined, 'importador nuevo: sin anchos ajustados'); eq(T.imp().sort, undefined, 'ni orden');
    set(); t.env.fire('document', 'keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); ok(T.imp() === null && !tbl._classes.has('colfix'), 'Esc: igual');
    const css = D.src('control.css');
    ok(/\.imp-colgrip\{[^}]*touch-action:none/.test(css) && !/\.imp-prev(wrap)?\{[^}]*touch-action/.test(css), 'touch-action:none SOLO en el tirador: la tabla hace scroll como siempre');
    ok(/\.imp-prev\.colfix\{table-layout:fixed\}/.test(css), 'con anchos ajustados, diseño fijo');
    ok(/<button id="imp-colreset" class="linkbtn imp-colreset" type="button"[^>]*>Restablecer columnas<\/button>/.test(D.src("index.html")), 'botón Restablecer columnas (i18n)');
    const I18 = t.env.win.ShowtimeI18n;
    eq(I18.tx('Restablecer columnas', null, 'en'), 'Reset columns');
    ['Ordenar por {_c} (ascendente)', 'Ordenado de forma ascendente. Pulsa para descendente', 'Ordenado de forma descendente. Pulsa para volver al orden original',
      'Vista ordenada por {_c} ({_d}). El orden de importación no cambia.', 'Vista en el orden original.', 'ascendente', 'descendente', 'Ancho de la columna {_c}',
      'Arrastra para cambiar el ancho; clic, Intro o Espacio para ajustarlo con − / +', 'Ancho de la columna {_c}: {n} píxeles (mínimo {m})', 'Estrechar {_c} 16 píxeles', 'Ensanchar {_c} 16 píxeles'].forEach(k => ok(I18.tx(k, null, 'en') !== k, 'EN: ' + k));
  });
  test('Importador v20261166 · tirador: botón real; clic sin arrastre, Intro o Espacio abren [ − ] N px [ + ] (16 px, mínimo real, sin máximo); arrastrar cambia el ancho; nada del enfoque numérico', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, h = headOf(t), src = D.src('control.js'), html = D.src('index.html'), css = D.src('control.css');
    ok(/<button type="button" class="imp-colgrip" data-grip="4" aria-expanded="false" aria-controls="imp-colctl" aria-label="Ancho de la columna Nombre" title="Arrastra para cambiar el ancho; clic, Intro o Espacio para ajustarlo con − \/ \+"><\/button><\/th>/.test(h), 'el tirador es un botón');
    eq((h.match(/data-grip=/g) || []).length, 8, 'una parada de Tab por tirador');
    ok(/<div id="imp-colctl" class="imp-colctl" role="group" hidden><button type="button" class="imp-colstep" data-colstep="-1">−<\/button><output id="imp-colw" class="imp-colw" aria-live="polite"><\/output><button type="button" class="imp-colstep" data-colstep="1">\+<\/button><\/div>/.test(html) && html.indexOf('id="imp-colctl"') < html.search(/class="[^"]*imp-box/), 'microcontrol con botones reales, fuera de la caja que recorta');
    // Nada del enfoque descartado
    ok(!/type="number"|aria-invalid|aria-value(now|min|max|text)|role="(spinbutton|slider|separator)"|inputmode="none"/.test(h + html.slice(html.indexOf('<div id="imp"'), html.indexOf('<div class="imp-foot"'))), 'sin input numérico, aria-invalid, rango ARIA ni roles de rango');
    ok(!/type="number" class="imp-colgrip"|aria-invalid|aria-value(now|min|max|text)|'spinbutton'|role="separator"/.test(src), 'ni en control.js');
    ok(!/input\.imp-colgrip|::-webkit-inner-spin-button/.test(css), 'ni sus estilos');
    const I18 = t.env.win.ShowtimeI18n, ks = I18.keys('es').concat(Object.keys(I18.UI_EN || {}).reduce((a, g) => a.concat(Object.keys(I18.UI_EN[g])), []));
    ['Arrastra o usa ← → para cambiar el ancho', '{_c}: {n} píxeles (mínimo {m})', '{n} píxeles'].forEach(k => ok(ks.indexOf(k) < 0 && I18.tx(k, null, 'en') === k, 'clave descartada fuera: ' + k));
    // Microcontrol (stub): tirador y piezas «reales»
    const W = T.imp(); W.colW = [24, 68, 126, 158, 160, 94, 73, 68, 68, 76, 220]; W.colMin = [24, 68, 126, 158, 87, 94, 73, 68, 68, 76, 220];
    const at = {}, g = { dataset: { grip: '4' }, at, setAttribute: (k, v) => { at[k] = v; }, getBoundingClientRect: () => ({ left: 400, right: 410, top: 100, bottom: 130 }) };
    let focoEn = null; g.focus = () => { focoEn = 'tirador'; }; g.closest = q => q === '[data-grip]' ? g : null;
    const mk = st => { const a2 = {}, b = { dataset: { colstep: String(st) }, a2, setAttribute: (k, v) => { a2[k] = v; }, getAttribute: k => a2[k], focus: () => { focoEn = st < 0 ? '−' : '+'; } }; b.closest = q => q === '[data-colstep]' ? b : q === '#imp-colctl' ? {} : null; return b; };
    const minus = mk(-1), plus = mk(1), box = t.env.getEl('imp-colctl'), prev = t.env.getEl('imp-prev');
    box.querySelector = q => /-1/.test(q) ? minus : plus; box.offsetWidth = 150; box.offsetHeight = 44; t.env.win.innerWidth = 1280; t.env.win.innerHeight = 800;
    prev.querySelectorAll = q => q === '[data-grip]' ? [g] : [];
    const clickGrip = det => t.env.fire('imp-prev', 'click', { target: g, detail: det });
    const step = b => t.env.fire('imp-colctl', 'click', { target: b });
    box.hidden = true; clickGrip(1);
    ok(box.hidden === false && at['aria-expanded'] === 'true', 'clic: abre; aria-expanded'); eq(t.env.getEl('imp-colw').textContent, '160 px');
    eq(box.getAttribute ? 'x' : 'x', 'x'); eq(minus.a2['aria-label'], 'Estrechar Nombre 16 píxeles'); eq(plus.a2['aria-label'], 'Ensanchar Nombre 16 píxeles'); eq(minus.a2['aria-disabled'], 'false');
    eq(focoEn, null, 'con ratón el foco no salta');
    step(minus); eq(W.colW[4], 144, '− estrecha 16'); eq(t.env.getEl('imp-colw').textContent, '144 px'); eq(at['aria-label'], 'Ancho de la columna Nombre: 144 píxeles (mínimo 87)', 'el tirador dice el valor verdadero');
    for (let k = 0; k < 10; k++) step(minus);
    eq(W.colW[4], 87, 'respeta el mínimo real'); eq(minus.a2['aria-disabled'], 'true', '− desactivado en el mínimo (sigue enfocable)');
    step(minus); eq(W.colW[4], 87);
    for (let k = 0; k < 200; k++) step(plus);
    eq(W.colW[4], 87 + 200 * 16, '+ sin máximo'); eq(t.env.getEl('imp-colw').textContent, '3287 px'); eq(minus.a2['aria-disabled'], 'false');
    clickGrip(1); ok(box.hidden && at['aria-expanded'] === 'false', 'otro clic en el tirador: cierra');
    // Intro / Espacio (click de teclado, detail 0): abre y lleva el foco dentro; Esc cierra y vuelve al tirador sin cerrar el importador
    clickGrip(0); ok(!box.hidden); eq(focoEn, '−', 'teclado: foco en −');
    let sp = 0; t.env.fire('imp-colctl', 'keydown', { key: 'Escape', target: minus, preventDefault() {}, stopPropagation() { sp++; } });
    ok(box.hidden && focoEn === 'tirador' && sp === 1 && T.imp(), 'Esc: cierra el microcontrol, vuelve al tirador; el importador sigue');
    clickGrip(0); t.env.fire('imp-colctl', 'keydown', { key: 'Tab', shiftKey: true, target: minus, preventDefault() {} }); ok(box.hidden && focoEn === 'tirador', 'Shift+Tab desde −: vuelve al tirador');
    // Arrastre con ratón: cambia el ancho y su clic final NO abre
    const down = (pt, x) => t.env.fire('imp-prev', 'pointerdown', { pointerType: pt, pointerId: 7, button: 0, clientX: x, target: g, preventDefault() {} });
    const move = x => t.env.fire('imp-prev', 'pointermove', { pointerId: 7, clientX: x });
    const up = () => t.env.fire('imp-prev', 'pointerup', { pointerId: 7 });
    W.colW[4] = 160; down('mouse', 500); move(540); up(); clickGrip(1);
    eq(W.colW[4], 200, 'arrastre: +40'); ok(box.hidden, 'el clic que cierra el arrastre no abre');
    down('mouse', 500); up(); clickGrip(1); ok(!box.hidden, 'clic sin moverse: abre'); clickGrip(1);
    // Dedo: si el navegador lo da por toque (hay «click»), se deshace el temblor y abre; si no hay click, es arrastre
    W.colW[4] = 160; down('touch', 500); move(502); up(); clickGrip(1);
    eq(W.colW[4], 160, 'toque con temblor: el ancho vuelve'); ok(!box.hidden, 'y abre'); clickGrip(1);
    down('touch', 500); move(560); up(); eq(W.colW[4], 220, 'arrastre con el dedo'); ok(box.hidden);
    // Restablecer columnas cierra el microcontrol
    clickGrip(1); t.env.fire('imp-colreset', 'click', {}); ok(box.hidden && W.colW === null);
    delete prev.querySelectorAll;
    ok(/\.imp-colgrip\{position:absolute;[^}]*width:10px;[^}]*touch-action:none/.test(css) && /\.imp-colstep\{[^}]*min-width:32px;height:32px/.test(css), 'tirador estrecho; − / + de 32 px');
    eq(t.env.errors.length, 0);
  });
  test('Importador v20261166 · preventivo: ningún tabindex positivo en la vista previa (el cálculo de Tab/Shift+Tab sigue el orden del documento)', () => {
    const { t } = sortPanel(), src = D.src('control.js'), html = D.src('index.html');
    sortClick(t, 'banda');
    const prev = ultimo(t, 'imp-prev'), imp = html.slice(html.indexOf('<div id="imp"'), html.indexOf('<div class="imp-foot"'));
    ok(prev.length > 0 && !/tabindex="\s*[1-9]/i.test(prev), 'tabla de la vista previa: sin tabindex positivo');
    ok(!/tabindex="\s*[1-9]/i.test(imp), 'importador (index.html): sin tabindex positivo');
    ok(!/tabindex="\s*[1-9]|tabIndex\s*=\s*[1-9]|setAttribute\('tabindex',\s*'?[1-9]/i.test(src), 'control.js no crea tabindex positivos');
    const tb = src.slice(src.indexOf('function impTabbables'), src.indexOf('function impTabKey'));
    ok(/querySelectorAll\('a\[href\], button, input, select, textarea, \[tabindex\]'\)\)\.filter\(/.test(tb) && !/\.sort\(/.test(tb) && /n\.tabIndex >= 0/.test(tb), 'orden del documento, sin reordenar');
  });
  test('Importador v20261166 · foco al editar: Tab / Shift+Tab / Intro / Tipo apuntan al destino por identidad estable y lo enfocan ya redibujado (con y sin orden); fuera de la tabla, orden normal', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document, prev = t.env.getEl('imp-prev');
    // Mini DOM: los controles de la tabla en orden de Tab; blur() hace lo que el navegador (change si cambió, luego focusout)
    let focused = null; const pedidos = [];
    const ctl = (ds, rid, fuera) => { const n = { dataset: ds, tabIndex: 0, disabled: false, value: ds.v, _v0: ds.v, getClientRects: () => [1], focus() { focused = n; },
      matches: q => !fuera && q === 'tbody input[type=text][data-row], tbody textarea.imp-wide, tbody select[data-row]' && ds.k !== undefined || (q === '#imp-prev tbody [data-row]' && ds.k !== undefined) || (q === 'tbody [data-row]' && ds.k !== undefined) || ((q === 'input[type=text]' || q === 'input[type=text], textarea.imp-wide') && ds.k && ds.k !== 'tipo') || (q === 'select[data-row]' && ds.k === 'tipo'),
      closest: q => q === '#imp-prev' ? (fuera ? null : {}) : q === 'tr[data-rid]' ? (rid ? { dataset: { rid } } : null) : null,
      blur() { if (doc.activeElement === n) doc.activeElement = null; if (n.value !== n._v0) t.env.fire('imp-prev', 'change', { target: n }); t.env.fire('imp-prev', 'focusout', { target: n, relatedTarget: null }); } };
      return n; };
    const f0b = ctl({ row: '0', k: 'banda', v: 'Álvaro' }, 'p0'), f0j = ctl({ row: '0', k: 'jornada', v: '' }, 'p0'), f0n = ctl({ row: '0', k: 'notas', v: '' }, 'p0');
    const c1 = ctl({ inc: '1' }, 'p1'), f1t = ctl({ row: '1', k: 'tipo', v: 'show' }, 'p1'), f1b = ctl({ row: '1', k: 'banda', v: 'banda 10' }, 'p1'), fuera = ctl({}, '', true);
    const lista = [f0b, f0j, f0n, c1, f1t, f1b, fuera];
    const qsa0 = doc.querySelectorAll; doc.querySelectorAll = q => q === 'a[href], button, input, select, textarea, [tabindex]' ? lista : qsa0(q);
    prev.querySelector = q => { pedidos.push(q); return { focus() { focused = { redibujado: q }; } }; };
    const tab = (n, shift) => { let pd = 0; doc.activeElement = n; focused = n; t.env.fire('imp-prev', 'keydown', { key: 'Tab', shiftKey: !!shift, target: n, preventDefault() { pd++; } }); return pd; };
    // 1) Sin orden: editar Nombre y Tab → el dato se aplica y el foco va a la Jornada de esa fila, ya redibujada
    f0b.value = 'Álvaro bis';
    eq(tab(f0b), 1, 'Tab interceptado (el destino se iba a rehacer)');
    eq(T.imp().pv.rows[0].banda, 'Álvaro bis', 'dato confirmado'); eq(ridsOf(t), 'p0 p1 p2 p3 p4', 'sin orden: misma posición');
    eq(JSON.stringify(focused), JSON.stringify({ redibujado: '[data-row="0"][data-k="jornada"]' }), 'foco en el siguiente control, redibujado');
    // 2) Con orden por Nombre: editar y Tab → la fila se recoloca y el foco la sigue (identidad, no posición)
    sortClick(t, 'banda'); eq(ridsOf(t), 'p0 p2 p1 p4 p3');
    f0b._v0 = 'Álvaro bis'; f0b.value = 'zz';
    eq(tab(f0b), 1); eq(T.imp().pv.rows[0].banda, 'zz'); eq(ridsOf(t), 'p2 p1 p4 p0 p3', 'recolocada al confirmar');
    eq(focused.redibujado, '[data-row="0"][data-k="jornada"]', 'el foco va a la Jornada de ESA fila, en su sitio nuevo');
    // 3) Shift+Tab: al anterior
    f0j._v0 = f0j.value = ''; f0b._v0 = f0b.value = 'zz';
    f0j.value = '';
    eq(tab(f0j, true), 1); eq(focused.redibujado, '[data-row="0"][data-k="banda"]', 'Shift+Tab: al Nombre de la misma fila');
    // 4) Extremo de fila: de Notas a la casilla de la fila siguiente (en el orden del documento)
    f0n.value = 'nota';
    eq(tab(f0n), 1); eq(T.imp().pv.rows[0].notas, 'nota'); eq(focused.redibujado, '[data-inc="1"]', 'Notas → casilla de la siguiente fila');
    eq(tab(c1, true), 0, 'desde la casilla (no es un campo de texto ni Tipo): el navegador');
    // 5) Último control antes de salir de la tabla: Tab sigue el orden normal (sin trampa)
    f1b._v0 = f1b.value = 'banda 10'; eq(tab(f1b), 0, 'destino fuera de la tabla: no se intercepta');
    // 6) Intro: confirma y el foco sigue en el mismo campo, redibujado
    sortClick(t, 'banda'); sortClick(t, 'banda'); eq(ridsOf(t), 'p0 p1 p2 p3 p4', 'sin orden');
    sortClick(t, 'banda');
    f1b.value = 'aaa'; doc.activeElement = f1b; let pd = 0;
    t.env.fire('imp-prev', 'keydown', { key: 'Enter', target: f1b, preventDefault() { pd++; } });
    eq(pd, 1); eq(T.imp().pv.rows[1].banda, 'aaa'); eq(ridsOf(t), 'p1 p2 p4 p0 p3', 'Intro: recolocada (aaa primero)');
    eq(focused.redibujado, '[data-row="1"][data-k="banda"]', 'Intro: el foco vuelve a su Nombre, ya en su sitio');
    // 7) Tipo: cambiado con foco (retenido), luego Tab → se recoloca y el foco va al siguiente (Nombre de esa fila)
    sortClick(t, 'tipo'); eq(ridsOf(t), 'p0 p1 p2 p3 p4');
    doc.activeElement = f1t; f1t.value = 'hito'; t.env.fire('imp-prev', 'change', { target: f1t });
    eq(ridsOf(t), 'p0 p1 p2 p3 p4', 'con foco: no se mueve'); f1t._v0 = 'hito';
    eq(tab(f1t), 1); eq(T.imp().pv.rows[1].tipo, 'hito'); eq(ridsOf(t), 'p0 p2 p3 p4 p1', 'al salir con Tab: Marcador al final');
    eq(focused.redibujado, '[data-row="1"][data-k="banda"]', 'el foco, en el Nombre de esa fila');
    doc.querySelectorAll = qsa0; delete prev.querySelector; doc.activeElement = null;
    eq(t.env.errors.length, 0);
  });
  // ── v20261166 · textos recortados: lectura pasiva (hover) y editor ampliado ──
  const LARGA = 'Backline compartido con la banda anterior; el técnico de monitores llega a las 18:00; catering en el camerino 3';
  const fakeInp = (t, o) => { const at = {}, cls = new Set(), ins = [], tr = { insertAdjacentHTML: (w, h) => ins.push([w, h]) };
    const n = { dataset: { row: o.row || '1', k: o.k || 'notas' }, value: o.v === undefined ? LARGA : o.v, defaultValue: o.v === undefined ? LARGA : o.v, scrollWidth: o.sw || 900, clientWidth: o.cw || 80,
      at, ins, cls, parentNode: {}, classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      setAttribute: (k, v) => { at[k] = v; }, removeAttribute: k => { delete at[k]; }, getAttribute: k => at[k],
      getBoundingClientRect: () => ({ left: 300, right: 380, top: 200, bottom: 228, width: 80, height: 28 }), offsetLeft: 4, offsetTop: 3,
      matches: q => q === '#imp-prev tbody input[type=text][data-row]' || q === 'input[type=text], textarea.imp-wide' || q === 'tbody input[type=text][data-row], tbody textarea.imp-wide, tbody select[data-row]' || q === '#imp-prev tbody [data-row]' || q === 'tbody [data-row]',
      closest: q => q === 'tr' ? tr : q === 'td' ? { classList: { add() {}, remove() {} } } : q === '#imp-prev' ? {} : null, after: ta => { n.ta = ta; } };
    return n; };
  test('Importador v20261166 · lectura pasiva: solo ratón, solo si el texto no cabe y el campo no tiene foco; detalle fuera de la caja, posición segura o en línea; sin title ni touchstart', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document;
    const html = D.src('index.html'), src = D.src('control.js');
    ok(/<div id="imp-errpop" class="imp-errpop" role="tooltip" hidden><\/div><div id="imp-cellpop" class="imp-errpop imp-cellpop" role="tooltip" hidden><\/div>/.test(html) && html.indexOf('id="imp-cellpop"') < html.search(/class="[^"]*imp-box/), 'detalle único, fuera de la caja con scroll (no se recorta)');
    ok(!/data-k="(escenario|banda|call|notas)"[^>]*title=/.test(ultimo(t, 'imp-prev')), 'sin title nativo en los campos');
    ok(!/touchstart/.test(src), 'sin touchstart');
    const pop = t.env.getEl('imp-cellpop'); pop.offsetWidth = 320; pop.offsetHeight = 60; t.env.win.innerWidth = 1280; t.env.win.innerHeight = 800;
    const over = (n, pt) => t.env.fire('imp-prev', 'pointerover', { pointerType: pt || 'mouse', target: n });
    // Texto que cabe / vacío / campo con foco / dedo: nada
    over(fakeInp(t, { v: 'corto', sw: 60, cw: 80 })); ok(!T.cellPop().open, 'cabe: sin detalle');
    over(fakeInp(t, { v: '' , sw: 0, cw: 80 })); ok(!T.cellPop().open, 'vacío: sin detalle');
    let a = fakeInp(t, {}); doc.activeElement = a; over(a); ok(!T.cellPop().open, 'con foco: sin detalle'); doc.activeElement = null;
    over(fakeInp(t, {}), 'touch'); over(fakeInp(t, {}), 'pen'); ok(!T.cellPop().open, 'dedo / lápiz: sin hover');
    // Largo: flotante con el texto completo; aria-describedby al detalle
    a = fakeInp(t, {}); over(a);
    ok(T.cellPop().open && !T.cellPop().inline && pop.hidden === false, 'texto recortado: detalle'); eq(pop.textContent, LARGA, 'contenido completo');
    eq(a.at['aria-describedby'], 'imp-cellpop', 'el campo lo describe'); eq(pop.style.left, '380px', 'pegado al campo (sin hueco)');
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: a, relatedTarget: { closest: q => /#imp-cellpop/.test(q) ? pop : null } }); ok(T.cellPop().open, 'del campo al detalle: sigue');
    t.env.fire('imp-cellpop', 'pointerleave', { pointerType: 'mouse', relatedTarget: a }); ok(T.cellPop().open, 'del detalle al campo: sigue');
    t.env.fire('imp-cellpop', 'pointerleave', { pointerType: 'mouse', relatedTarget: { closest: () => null } });
    ok(!T.cellPop().open && pop.hidden && a.at['aria-describedby'] === undefined, 'fuera de los dos: se cierra');
    // Nunca tapa acciones: con el pie y un Excluir donde iría, busca otra posición o va en línea
    over(a); t.env.fire('window', 'scroll', { target: { closest: () => null } }); ok(!T.cellPop().open, 'scroll: se cierra');
    // Sin sitio flotante (pantalla baja, texto muy largo): en línea, bajo su fila
    t.env.win.innerHeight = 300; pop.offsetWidth = 752; pop.offsetHeight = 290;
    a = fakeInp(t, {}); over(a);
    ok(T.cellPop().inline && pop.hidden === true, 'en línea'); eq(a.ins[0][0], 'afterend');
    ok(/^<tr id="imp-cellrow" class="imp-errrow imp-cellrow"><td colspan="11"><div id="imp-cellinline" class="imp-errinline" role="tooltip">Backline compartido/.test(a.ins[0][1]), 'fila en línea con el texto completo');
    eq(a.at['aria-describedby'], 'imp-cellinline');
    t.env.fire('window', 'scroll', { target: { closest: () => null } }); ok(T.cellPop().open, 'en línea va con su fila: el scroll no lo cierra');
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: a, relatedTarget: { closest: q => q === 'tr' ? a.closest('tr') : null } }); ok(T.cellPop().open, 'en línea: cruzar su fila hacia el detalle no lo cierra');
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: a, relatedTarget: { closest: () => null } }); ok(!T.cellPop().open, 'fuera: se cierra');
    // Con el detalle de Error fijado no se abre; y abrir Error cierra este
    t.env.win.innerHeight = 800; pop.offsetWidth = 320; pop.offsetHeight = 60;
    over(fakeInp(t, {})); ok(T.cellPop().open);
    const ep = t.env.getEl('imp-errpop'); ep.offsetWidth = 200; ep.offsetHeight = 40;
    const eb = { dataset: { errtip: '3', why: 'x' }, setAttribute() {}, getBoundingClientRect: () => ({ left: 60, right: 110, top: 500, bottom: 520 }) }; eb.closest = q => q === '[data-errtip]' ? eb : null;
    t.env.fire('imp-prev', 'click', { target: eb }); ok(!T.cellPop().open && T.errPop().pinned, 'Error abierto: un solo detalle');
    over(fakeInp(t, {})); ok(!T.cellPop().open, 'con Error fijado: sin hover');
    t.env.fire('imp-prev', 'click', { target: eb });
    eq(t.env.errors.length, 0);
  });
  test('Importador v20261166 · editor ampliado: se abre solo con texto recortado (al enfocar o cuando deja de caber); confirma al cerrarse por el camino de siempre; sin saltos de línea; no reordena mientras se edita', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document;
    const mkTA = () => { const at = {}, ta = { at, style: {}, value: '', className: '', dataset: {}, selectionStart: 0, scrollHeight: 60,
        setAttribute: (k, v) => { at[k] = v; if (k === 'data-row') ta.dataset.row = v; if (k === 'data-k') ta.dataset.k = v; }, focus() { doc.activeElement = ta; }, blur() { doc.activeElement = null; t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null }); }, select() { ta.sel = 'all'; }, setSelectionRange(s, e) { ta.sel = [s, e]; },
        getBoundingClientRect: () => ({ left: 300, right: 600, top: 200, bottom: 260 }), classList: { contains: c => c === 'imp-wide' } };
      ta.parentNode = { removeChild: () => { ta.parentNode = null; } };
      ta.matches = q => q === 'input[type=text], textarea.imp-wide' || q === 'tbody input[type=text][data-row], tbody textarea.imp-wide, tbody select[data-row]' || q === '#imp-prev tbody [data-row]' || q === 'tbody [data-row]';
      ta.closest = q => q === '#imp-prev' ? {} : q === 'tr[data-rid]' ? { dataset: { rid: 'p' + ta.dataset.row } } : null;
      return ta; };
    let tas = []; const ce0 = doc.createElement; doc.createElement = tag => { if (tag === 'textarea') { const x = mkTA(); tas.push(x); return x; } return ce0(tag); };
    // Corto: foco sin editor
    let a = fakeInp(t, { v: 'corto', sw: 60, cw: 80, row: '0', k: 'banda' });
    t.env.fire('imp-prev', 'focusin', { target: a }); ok(!T.impEd(), 'cabe: sin editor');
    sortClick(t, 'banda'); const ord = ridsOf(t);
    // Recortado: al enfocar con teclado, editor en el mismo hueco, todo seleccionado; el campo compacto se queda oculto y fuera del Tab
    a = fakeInp(t, { row: '0', k: 'banda', v: 'Álvaro con la orquesta sinfónica invitada' }); a.selectionStart = 5; a.selectionEnd = 12; a.selectionDirection = 'forward';
    t.env.fire('imp-prev', 'focusin', { target: a });
    let ta = tas[0]; ok(T.impEd() && T.impEd().k === 'banda', 'editor abierto'); ok(a.ta === ta, 'en el mismo hueco (justo tras el campo)');
    eq(ta.value, 'Álvaro con la orquesta sinfónica invitada'); eq(JSON.stringify(ta.sel), '[5,12]', 'hereda EXACTAMENTE la selección del campo compacto (nunca «todo»)');
    eq(ta.at['aria-label'], 'Editar Nombre (texto completo)', 'nombre accesible'); eq(ta.at['aria-describedby'], 'imp-edhint', 'descripción accesible');
    eq(ta.at['data-row'], '0'); eq(ta.at['data-k'], 'banda'); eq(ta.at.rows, '1');
    ok(a.cls.has('imp-wsrc') && a.at.tabindex === '-1' && a.at['aria-hidden'] === 'true', 'el compacto: oculto, fuera del Tab y del árbol accesible');
    // Hover con el editor abierto: no
    const over2 = n => t.env.fire('imp-prev', 'pointerover', { pointerType: 'mouse', target: n }); over2(fakeInp(t, { row: '2' })); ok(!T.cellPop().open, 'hover y editor no conviven');
    // Ordenado por Nombre: escribir no recoloca; su «change» nativo no confirma (lo hace el cierre)
    ta = tas[0]; ta.value = 'zz al final'; t.env.fire('imp-prev', 'input', { target: ta }); t.env.fire('imp-prev', 'change', { target: ta });
    eq(ridsOf(t), ord, 'mientras se edita, la fila no se mueve'); eq(T.imp().pv.rows[0].banda, 'Álvaro', 'aún sin confirmar');
    // Pegar con saltos: se queda en una línea
    ta.value = 'zz al final\nlínea 2\r\nlínea 3'; ta.selectionStart = 5; t.env.fire('imp-prev', 'input', { target: ta }); eq(ta.value, 'zz al final línea 2 línea 3', 'sin saltos de línea');
    // Salir (blur): confirma por el camino de siempre y vuelve el compacto
    doc.activeElement = null; t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null });
    ok(!T.impEd() && ta.parentNode === null && !a.cls.has('imp-wsrc') && a.at.tabindex === undefined && a.at['aria-hidden'] === undefined, 'editor cerrado, campo compacto de vuelta');
    eq(T.imp().pv.rows[0].banda, 'zz al final línea 2 línea 3', 'dato confirmado'); eq(ridsOf(t), 'p2 p1 p4 p0 p3', 'y recolocada al confirmar');
    // Sin cambios: se cierra sin confirmar nada
    a = fakeInp(t, { row: '2', k: 'notas' }); t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1];
    const notas0 = T.imp().pv.rows[2].notas; t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null }); ok(!T.impEd()); eq(T.imp().pv.rows[2].notas, notas0);
    // Con teclado y TODO seleccionado por el navegador (Tab): nunca se hereda; cursor al final, sin borrar nada al escribir
    a = fakeInp(t, { row: '0', k: 'banda', v: 'Álvaro con la orquesta sinfónica invitada' }); a.selectionStart = 0; a.selectionEnd = 41;
    t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1]; eq(JSON.stringify(ta.sel), '[41,41]', 'todo seleccionado por Tab → cursor al final');
    t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null });
    a = fakeInp(t, { row: '0', k: 'banda', v: 'Álvaro con la orquesta sinfónica invitada' }); a.selectionStart = a.selectionEnd = 0;
    t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1]; eq(JSON.stringify(ta.sel), '[41,41]', 'llegada por teclado con el cursor al principio → al final');
    t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null }); ok(!T.impEd());
    // Deja de caber al escribir: se abre conservando el cursor
    a = fakeInp(t, { row: '1', k: 'banda', v: 'banda 10', sw: 60, cw: 80 }); doc.activeElement = a;
    t.env.fire('imp-prev', 'focusin', { target: a }); ok(!T.impEd(), 'aún cabe');
    a.value = 'banda 10 con la orquesta'; a.scrollWidth = 200; a.selectionStart = a.selectionEnd = 24;
    t.env.fire('imp-prev', 'input', { target: a }); ta = tas[tas.length - 1];
    ok(T.impEd(), 'deja de caber: editor'); eq(JSON.stringify(ta.sel), '[24,24]', 'el cursor sigue donde estaba');
    // Intro: confirma, vuelve al campo COMPACTO (no se reabre)
    let pd = 0; const prev = t.env.getEl('imp-prev'), pedidos = []; prev.querySelector = q => { pedidos.push(q); return { focus() {} }; };
    t.env.fire('imp-prev', 'keydown', { key: 'Enter', shiftKey: true, target: ta, preventDefault() { pd++; } });
    eq(pd, 1, 'Intro (también Mayús+Intro) no mete salto'); ok(!T.impEd()); eq(T.imp().pv.rows[1].banda, 'banda 10 con la orquesta');
    ok(pedidos.indexOf('[data-row="1"][data-k="banda"]') >= 0, 'el foco vuelve a su campo');
    const src = D.src('control.js');
    ok(/IMP_NOEXP = true;[^\n]*\n\s*try \{ el\.blur\(\); if \(key && IMP\) impFocusTo\(key\); \} finally \{ IMP_NOEXP = false; \}/.test(src) && /if \(IMP_NOEXP \|\| IMP_PAINT \|\| !impCut\(n\)\) return;/.test(src), 'tras Intro el campo queda compacto');
    ok(/'tbody input\[type=text\]\[data-row\], tbody textarea\.imp-wide, tbody select\[data-row\]'/.test(src), 'Tab / Shift+Tab desde el editor: mismo cálculo que desde el campo');
    const css = D.src('control.css');
    ok(/\.imp-prev textarea\.imp-wide\{position:absolute;z-index:9;[^}]*white-space:pre-wrap;[^}]*\}/.test(css) && /\.imp-prev thead th\{position:sticky;top:0;z-index:10;/.test(css), 'editor por encima de las celdas y por debajo de la cabecera fija (dentro de la vista previa: el pie nunca queda tapado)');
    ok(/\.imp-prev td\.imp-wcell,\.imp-prev\.colfix td\.imp-wcell\{position:relative;overflow:visible\}/.test(css) && !/\.imp-prev(\.colfix)? (col|table)[^{]*\{[^}]*imp-wide/.test(css), 'no cambia el ancho de la columna ni de la tabla');
    ok(/<span id="imp-edhint" class="sr-only" data-i18n>Intro confirma\. El texto sigue siendo de una sola línea\.<\/span>/.test(D.src('index.html').replace(/ data-i18n(?=[ >])/g, ' data-i18n')) || /id="imp-edhint"/.test(D.src('index.html')), 'descripción del editor');
    const I18 = t.env.win.ShowtimeI18n;
    eq(I18.tx('Editar {_c} (texto completo)', { _c: 'Notes' }, 'en'), 'Edit Notes (full text)'); eq(I18.tx('Intro confirma. El texto sigue siendo de una sola línea.', null, 'en'), 'Enter confirms. The text stays on a single line.');
    // Ratón / dedo: espera a que el clic sitúe el cursor (en medio del texto) y el editor hereda esa posición
    pedidos.length = 0;
    a = fakeInp(t, { row: '2', k: 'notas' }); a.selectionStart = a.selectionEnd = 0;
    t.env.fire('imp-prev', 'pointerdown', { target: a, pointerType: 'mouse', button: 0 }); doc.activeElement = a;
    t.env.fire('imp-prev', 'focusin', { target: a }); ok(!T.impEd(), 'al enfocar con el puntero aún no (el navegador no ha puesto el cursor)');
    a.selectionStart = a.selectionEnd = 40;   // el navegador lo deja donde se hizo clic
    t.env.fire('imp-prev', 'click', { target: a }); ta = tas[tas.length - 1];
    ok(T.impEd(), 'tras el clic: editor'); eq(JSON.stringify(ta.sel), '[40,40]', 'el cursor, en medio del texto, donde se hizo clic');
    ta.value = LARGA.slice(0, 40) + 'X' + LARGA.slice(40);   // escribir no borra el resto
    // Clic directo en OTRO campo (largo, corto o Tipo) con el editor abierto: la tabla espera a que el navegador ponga el cursor del
    // clic en el destino; luego se repinta y el destino (redibujado) recibe EXACTAMENTE esa selección, nunca la posición 0
    let restaurado = null; prev.querySelector = q => { pedidos.push(q); return { value: LARGA, setSelectionRange(s1, e1, d1) { restaurado = { q, sel: [s1, e1, d1] }; }, focus() { if (restaurado && restaurado.q === q) restaurado.foco = true; else restaurado = { q, foco: true }; } }; };
    const dest = (k, row, tag) => { const d = { dataset: { row, k }, tagName: tag || 'INPUT', value: LARGA, matches: q => q === '#imp-prev tbody input[type=text][data-row], #imp-prev tbody select[data-row]', closest: q => q === 'tr[data-rid]' ? { dataset: { rid: 'p' + row } } : null, blur() { if (doc.activeElement === d) doc.activeElement = null; } }; return d; };
    const clicEn = (d, s0, e0, dir) => {   // la secuencia del navegador: pointerdown → (foco: el editor confirma) → cursor del clic → click
      t.env.fire('document', 'pointerdown', { target: d }); doc.activeElement = null;
      t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: d });
      doc.activeElement = d; if (s0 !== undefined) { d.selectionStart = s0; d.selectionEnd = e0; d.selectionDirection = dir || 'none'; }
      restaurado = null; t.env.fire('document', 'click', { target: d });
    };
    let d3 = dest('banda', '3'); clicEn(d3, 23, 23);
    ok(!T.impEd()); eq(T.imp().pv.rows[2].notas.indexOf('X'), 40, 'dato confirmado sin perder el resto');
    ok(restaurado && restaurado.q === '[data-row="3"][data-k="banda"]' && restaurado.foco, 'el foco va al campo donde se hizo clic, ya redibujado');
    eq(JSON.stringify(restaurado.sel), '[23,23,"none"]', 'con el cursor que puso el clic (no en 0)');
    // Selección parcial por arrastre en el destino: se conserva
    a = fakeInp(t, { row: '0', k: 'notas' }); doc.activeElement = a; t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1]; ta.value = 'cambio arrastre';
    clicEn(dest('notas', '4'), 12, 31, 'forward'); eq(JSON.stringify(restaurado.sel), '[12,31,"forward"]', 'selección parcial por arrastre intacta');
    // Tipo: entra al primer clic
    a = fakeInp(t, { row: '0', k: 'notas' }); doc.activeElement = a; t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1]; ta.value = 'cambio tipo';
    const dt = dest('tipo', '1', 'SELECT'); clicEn(dt); ok(restaurado && restaurado.q === '[data-row="1"][data-k="tipo"]' && restaurado.foco, 'clic en Tipo: entra al primer clic');
    // Sin cambios en el editor: nada que repintar; el navegador deja el foco y el cursor en el destino tal cual
    a = fakeInp(t, { row: '0', k: 'notas' }); doc.activeElement = a; t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1];
    const n1 = pedidos.length; clicEn(dest('banda', '3'), 9, 9); eq(pedidos.length, n1, 'sin repintado, sin restauración');
    // Botones (Excluir, Restaurar, Cancelar, Importar, + Añadir fila manual): la restauración de foco no los toca
    for (const b of [{ dataset: { exc: '1' } }, { dataset: { rest: '1' } }, { id: 'imp-cancel' }, { id: 'imp-go' }, { id: 'imp-man-open' }]) {
      b.matches = () => false; b.closest = () => null;
      a = fakeInp(t, { row: '0', k: 'notas' }); doc.activeElement = a; t.env.fire('imp-prev', 'focusin', { target: a }); ta = tas[tas.length - 1]; ta.value = 'otro ' + (b.id || JSON.stringify(b.dataset));
      const n0 = pedidos.length;
      t.env.fire('document', 'pointerdown', { target: b }); doc.activeElement = null; t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: null });
      eq(pedidos.length, n0, 'clic en ' + (b.id || JSON.stringify(b.dataset)) + ': sin robo de foco');
    }
    ok(!/\bta\.select\(\)/.test(src), 'nunca «seleccionar todo»');
    doc.createElement = ce0; delete prev.querySelector; doc.activeElement = null;
    eq(t.env.errors.length, 0);
  });
  test('Importador v20261166 · gesto hacia otro campo que NO acaba en click (pointercancel, captura perdida, ventana sin foco u oculta): repinta YA y una sola vez; foco solo si el destino lo tenía', () => {
    const { t } = sortPanel(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document, prev = t.env.getEl('imp-prev');
    const ce0 = doc.createElement; let tas = [];
    doc.createElement = tag => { if (tag !== 'textarea') return ce0(tag); const at = {}, ta = { at, style: {}, value: '', dataset: {}, scrollHeight: 30, classList: { contains: c => c === 'imp-wide' },
      setAttribute: (k, v) => { at[k] = v; if (k === 'data-row') ta.dataset.row = v; if (k === 'data-k') ta.dataset.k = v; }, focus() { doc.activeElement = ta; }, setSelectionRange() {}, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) };
      ta.parentNode = { removeChild: () => { ta.parentNode = null; } }; ta.matches = () => false; ta.closest = () => null; tas.push(ta); return ta; };
    let restaurado = null; prev.querySelector = q => ({ value: LARGA, setSelectionRange(s1, e1) { restaurado = { q, sel: [s1, e1] }; }, focus() { restaurado = Object.assign(restaurado || { q }, { foco: true }); } });
    const pinturas = () => t.env.innerLog.filter(x => x[0] === 'imp-prev').length;
    const dest = (k, row) => { const d = { dataset: { row, k }, tagName: 'INPUT', value: LARGA, selectionStart: 17, selectionEnd: 17, matches: q => q === '#imp-prev tbody input[type=text][data-row], #imp-prev tbody select[data-row]', closest: q => q === 'tr[data-rid]' ? { dataset: { rid: 'p' + row } } : null, blur() { if (doc.activeElement === d) doc.activeElement = null; } }; return d; };
    const gesto = (valor, conFoco) => {   // editor abierto en Notas de la fila 0, valor nuevo, pointerdown en el Nombre de la fila 3 → el editor confirma (repintado retenido)
      const a = fakeInp(t, { row: '0', k: 'notas' }); doc.activeElement = a; t.env.fire('imp-prev', 'focusin', { target: a });
      const ta = tas[tas.length - 1]; ta.value = valor; const d = dest('banda', '3');
      t.env.fire('document', 'pointerdown', { target: d }); doc.activeElement = null;
      t.env.fire('imp-prev', 'focusout', { target: ta, relatedTarget: d });
      if (conFoco) doc.activeElement = d;
      return d;
    };
    const casos = [['pointercancel', () => t.env.fire('document', 'pointercancel', {})],
      ['captura perdida', () => t.env.fire('document', 'lostpointercapture', {})],
      ['ventana sin foco', () => t.env.fire('window', 'blur', { target: t.env.win })],
      ['ventana oculta', () => { doc.visibilityState = 'hidden'; t.env.fire('document', 'visibilitychange', {}); doc.visibilityState = 'visible'; }]];
    casos.forEach(([nombre, cancela], n) => {
      [false, true].forEach(conFoco => {
        const v = 'confirmado ' + n + (conFoco ? ' F' : '');
        gesto(v, conFoco);
        const p0 = pinturas();
        eq(T.imp().pv.rows[0].notas === v, false, nombre + ': antes, retenido (aún sin repintar)');
        restaurado = null; cancela();
        eq(T.imp().pv.rows[0].notas, v, nombre + ': dato confirmado en la vista previa YA'); eq(pinturas() - p0, 1, nombre + ': un solo repintado');
        ok(new RegExp('value="' + v + '"').test(ultimo(t, 'imp-prev')), nombre + ': la tabla lo muestra');
        if (conFoco) ok(restaurado && restaurado.q === '[data-row="3"][data-k="banda"]' && restaurado.foco && JSON.stringify(restaurado.sel) === '[17,17]', nombre + ' con el destino enfocado: vuelve a él con su cursor');
        else eq(restaurado, null, nombre + ' sin foco en el destino: no se roba el foco');
        const p1 = pinturas(); t.env.fire('document', 'click', { target: { closest: () => null } }); cancela(); eq(pinturas(), p1, nombre + ': ni el click tardío ni otra cancelación repintan otra vez');
        doc.activeElement = null;
      });
    });
    // Si el click SÍ llega, el camino de siempre (cursor del navegador, repintado, restauración)
    const d = gesto('con click', true); d.selectionStart = 30; d.selectionEnd = 30; const p0 = pinturas(); restaurado = null;
    t.env.fire('document', 'click', { target: d });
    eq(T.imp().pv.rows[0].notas, 'con click'); ok(pinturas() - p0 >= 1); eq(JSON.stringify(restaurado.sel), '[30,30]');
    doc.createElement = ce0; delete prev.querySelector; doc.activeElement = null;
    eq(t.env.errors.length, 0);
  });
  test('Importador v20261167 · Estado ordena solo la vista: ↑ Error activo → Revisar → OK → Excluida; empates estables; Excluir / Restaurar recolocan al momento; ↓ y original; ES/EN; sin tirador', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) }), T = t.env.win.ShowtimePanel._test;
    const TXT = 'Banda\tZona\tInicio\tFin\nUno\tPrincipal\t20:00\t20:30\n\tPrincipal\t21:00\t21:30\nDos\tCarpa Nueva\t22:00\t22:30\nTres\tPrincipal\t25:99\t\nCuatro\tPrincipal\t18:00\t18:30\nCinco\tOtra\t19:00\t19:30';
    t.env.fire('btn-paste', 'click', {}); T.setImportText(TXT);
    eq(T.imp().pv.rows.map(r => r.status).join(' '), 'ok err warn err ok warn', 'estados de partida');
    const pv0 = T.imp().pv.rows.map(r => r.idx).join(','), orig = ridsOf(t);
    const excl = (attr, i) => t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { [attr]: String(i) } } : null } });
    // Cabecera: botón real, título, aria-sort; sin tirador, sin microcontrol, sin rango ARIA ni número
    const th = () => { const h = headOf(t); return h.slice(h.indexOf('<th class="srt nogrip"'), h.indexOf('</th>', h.indexOf('<th class="srt nogrip"')) + 5); };
    ok(/^<th class="srt nogrip" data-colk="estado"><button type="button" class="imp-sortbtn" data-sort="estado" title="Ordenar por Estado \(ascendente\)">Estado<svg class="ic so"[^>]*aria-hidden="true"[\s\S]*?<\/svg><\/button><\/th>$/.test(th()), 'Estado: botón real con su título');
    ok(!/data-grip|imp-colgrip|imp-colctl|aria-value|role="(spinbutton|slider|separator)"|type="number"/.test(th()), 'sin tirador, microcontrol, rango ARIA ni número');
    sortClick(t, 'estado');
    eq(ridsOf(t), 'p1 p3 p2 p5 p0 p4', '↑: Error activo (p1 p3) → Revisar (p2 p5) → OK (p0 p4), empates en orden de incorporación');
    ok(/data-colk="estado" aria-sort="ascending"><button[^>]*title="Ordenado de forma ascendente\. Pulsa para descendente"/.test(headOf(t)), 'aria-sort y título');
    eq(t.env.getEl('imp-sortnote').textContent, 'Vista ordenada por Estado (ascendente). El orden de importación no cambia.');
    // Excluir con Estado activo: pasa YA a «Excluida» (tras OK); Restaurar: vuelve a Error activo
    excl('exc', 3); eq(ridsOf(t), 'p1 p2 p5 p0 p4 p3', 'Excluir: al grupo Excluida, después de OK');
    excl('exc', 1); eq(ridsOf(t), 'p2 p5 p0 p4 p1 p3', 'dos excluidas: estables entre ellas');
    excl('rest', 3); eq(ridsOf(t), 'p3 p2 p5 p0 p4 p1', 'Restaurar: vuelve a Error activo');
    excl('rest', 1); eq(ridsOf(t), 'p1 p3 p2 p5 p0 p4');
    // Una fila válida desmarcada no cambia de grupo (sigue siendo OK)
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '0' }, checked: false } });
    eq(ridsOf(t), 'p1 p3 p2 p5 p0 p4', 'OK desmarcada: sigue en OK'); t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '0' }, checked: true } });
    // ↓ y orden original
    excl('exc', 3);
    sortClick(t, 'estado'); eq(ridsOf(t), 'p3 p0 p4 p2 p5 p1', '↓: Excluida → OK → Revisar → Error, empates estables');
    ok(/data-colk="estado" aria-sort="descending"/.test(headOf(t))); eq(t.env.getEl('imp-sortnote').textContent, 'Vista ordenada por Estado (descendente). El orden de importación no cambia.');
    sortClick(t, 'estado'); eq(ridsOf(t), orig, 'tercer clic: orden original'); ok(!/aria-sort/.test(headOf(t)));
    // EN
    T.setAppLang('en'); sortClick(t, 'estado');
    ok(/data-sort="estado" title="Sorted ascending\. Press for descending">Status/.test(headOf(t)), 'EN: Status + título');
    eq(t.env.getEl('imp-sortnote').textContent, 'View sorted by Status (ascending). The import order does not change.');
    T.setAppLang('es'); sortClick(t, 'estado'); sortClick(t, 'estado');
    // Nada del borrador cambia
    eq(T.imp().pv.rows.map(r => r.idx).join(','), pv0, 'IMP.pv.rows intacto');
    eq((headOf(t).match(/data-grip=/g) || []).length, 8, 'los tiradores siguen solo en las ocho columnas de datos');
    eq(t.env.errors.length, 0);
  });
  test('Importador v20261167 · ordenar por Estado no cambia lo importado ni el Dashboard', () => {
    const TXT = 'Banda\tZona\tInicio\tFin\nUno\tPrincipal\t20:00\t20:30\nDos\tCarpa Nueva\t22:00\t22:30\nCuatro\tPrincipal\t18:00\t18:30\nCinco\tOtra\t19:00\t19:30';
    const run = sorted => {
      const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) }), T = t.env.win.ShowtimePanel._test;
      t.env.fire('btn-paste', 'click', {}); T.setImportText(TXT);
      if (sorted) { sortClick(t, 'estado'); ok(ridsOf(t) !== 'p0 p1 p2 p3', 'la vista sí cambia'); }
      t.env.fire('imp-go', 'click', {});
      return { arts: t.read('showtime.festival').artists.map(a => a.nombre).join('|'), dash: (ultimo(t, 'tbody').match(/Banda A|Uno|Dos|Cuatro|Cinco/g) || []).join('|') };
    };
    const a = run(false), b = run(true);
    eq(b.arts, a.arts, 'misma secuencia importada'); ok(a.dash.length > 0); eq(b.dash, a.dash, 'Dashboard idéntico');
  });
  test('Importador v20261168 · pie fijo opaco: cubre desde la raya del resumen hasta el borde del cuadro (relleno inferior y lateral incluidos); nada de la tabla asoma; las acciones no se mueven', () => {
    const css = D.src('control.css');
    const box = (css.match(/\.imp-box\{[^}]*\}/) || [''])[0], foot = (css.match(/\.imp-foot\{[^}]*\}/) || [''])[0];
    ok(/--imp-pad:20px;padding:var\(--imp-pad\);/.test(box), 'el relleno del cuadro es una sola medida (--imp-pad)');
    ok(/position:sticky;bottom:calc\(-1 \* var\(--imp-pad,20px\)\);/.test(foot), 'pegado al BORDE del cuadro (no al borde del relleno, por donde asomaban las filas)');
    ok(/margin:0 calc\(-1 \* var\(--imp-pad,20px\)\) calc\(-1 \* var\(--imp-pad,20px\)\);padding:8px var\(--imp-pad,20px\) var\(--imp-pad,20px\);/.test(foot), 'ocupa también el relleno lateral e inferior; el relleno compensa: las acciones quedan donde estaban');
    ok(/background:var\(--modal-bg,#16191f\)/.test(foot) && /\.modal-box,\.imp-box,\.spot-box\{--modal-bg:#16191f;/.test(css) && /body\[data-ps="stage"\] \.modal-box,body\[data-ps="stage"\] \.imp-box,body\[data-ps="stage"\] \.spot-box\{--modal-bg:#000;/.test(css), 'fondo opaco en Panel y en Stage');
    ok(/z-index:20/.test(foot) && /\.imp-prev thead th\{position:sticky;top:0;z-index:10;/.test(css) && /\.imp-prev textarea\.imp-wide\{position:absolute;z-index:9;/.test(css), 'por encima de la tabla, su cabecera fija y el editor ampliado');
    ok(/scroll-padding-bottom:128px/.test(box), 'lo enfocado se sigue llevando por encima del pie');
  });
  test('Importador · detalle de Error sin sitio flotante (pantalla muy baja, motivo muy largo): se abre EN LÍNEA bajo su fila, no tapa nada y las acciones responden al primer toque', () => {
    const P = panel().env.win.ShowtimePanel._test.errPopPlace;
    // Pura: ninguna de las cinco posiciones cabe entera en la zona segura sin tapar nada → null (nunca «la que menos tapa»)
    eq(P({ left: 60, right: 110, top: 120, bottom: 138 }, 752, 260, 768, 300, 8, [{ left: 540, top: 250, right: 730, bottom: 292 }]), null, 'sin sitio: null');
    ok(!/sort\(\(x, y\) => over\(x\) - over\(y\)\)/.test(D.src('control.js')) && /return cands\.find\(c => inView\(c\) && over\(c\) === 0\) \|\| null;/.test(D.src('control.js')), 'fuera «la posición que menos tapa»');
    // Real (en el importador): pantalla de 300 px de alto y motivo muy largo
    const F = fest(), LARGO = 'Hora de inicio no reconocida: «' + 'muy largo '.repeat(40).trim() + '»';
    const mk = () => { const t = panel({ 'showtime.festival': JSON.stringify(F.s) }); t.env.fire('btn-paste', 'click', {});
      t.env.win.ShowtimePanel._test.setImportText('Banda\tZona\tInicio\tFin\nUno\tPrincipal\t23:00\t23:20\n\tPrincipal\t21:00\t22:00');
      t.env.win.innerWidth = 768; t.env.win.innerHeight = 300; const pop = t.env.getEl('imp-errpop'); pop.offsetWidth = 752; pop.offsetHeight = 260; return t; };
    const pin = (t, act) => { const at = {}, ins = []; const tr = { insertAdjacentHTML: (w, h) => ins.push([w, h]) };
      const b = { dataset: { errtip: '1', why: LARGO }, at, ins, setAttribute: (k, v) => { at[k] = v; }, getBoundingClientRect: () => ({ left: 60, right: 110, top: 120, bottom: 138 }) };
      const td = { querySelector: q => q === '[data-exc],[data-rest]' ? (act || null) : null };
      t.env.getEl('imp-errctx').hidden = true;   // nace oculta (atributo hidden del HTML insertado)
      b.closest = q => q === '[data-errtip]' ? b : q === 'tr' ? tr : q === 'td' ? td : null;
      t.env.fire('imp-prev', 'click', { target: b }); return b; };
    let t = mk(); const st = () => t.env.win.ShowtimePanel._test.errPop();
    let b = pin(t);
    ok(st().open && st().pinned && st().inline, 'fallback en línea');
    eq(t.env.getEl('imp-errpop').hidden, true, 'el flotante no se muestra (no tapa nada)');
    eq(b.ins.length, 1); eq(b.ins[0][0], 'afterend', 'justo debajo de su fila');
    ok(new RegExp('^<tr id="imp-errrow" class="imp-errrow"><td colspan="11"><button type="button" id="imp-errctx" class="linkbtn imp-rowact imp-errctx" data-exc="1" aria-describedby="imp-errinline" hidden>Excluir</button><div id="imp-errinline" class="imp-errinline" role="tooltip">Hora de inicio no reconocida: «muy largo').test(b.ins[0][1]) && b.ins[0][1].indexOf(LARGO) > 0, 'con el mismo motivo completo y su acción ARRIBA, hermana del diagnóstico');
    ok(!/role="tooltip"[^>]*>[^<]*<button/.test(b.ins[0][1]) && (b.ins[0][1].match(/<button/g) || []).length === 1, 'ningún botón dentro del role="tooltip"');
    eq(t.env.getEl('imp-errctx').hidden, false, 'sin poder ver su Excluir original: la acción contextual se muestra');
    eq(b.at['aria-expanded'], 'true'); eq(b.at['aria-controls'], 'imp-errinline', 'aria coherente: apunta al detalle en línea');
    t.env.fire('window', 'scroll', { target: { closest: () => null } }); ok(st().open, 'hacer scroll para leerlo no lo cierra (va con su fila)');
    t.env.fire('imp-prev', 'click', { target: b });
    ok(!st().open && b.at['aria-expanded'] === 'false' && b.at['aria-controls'] === 'imp-errpop', 'otro toque: se cierra (y aria vuelve)');
    // Con el detalle en línea abierto, el primer toque en cada acción funciona
    const fuera = { closest: () => null };
    pin(t); t.env.fire('imp-cancel', 'click', { target: fuera }); t.env.fire('document', 'click', { target: fuera });
    eq(t.env.getEl('imp').hidden, true, 'Cancelar al primer toque'); ok(!st().open);
    t = mk(); pin(t);
    t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { exc: '1' } } : null } });
    eq(t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, ''), 'Importar: 1 fila · Excluidas: 1 fila', 'Excluir al primer toque'); ok(!st().open, 'y el detalle desaparece');
    // La acción contextual ES la de la fila: mismo atributo → mismo handler (Excluir; y Restaurar en una excluida)
    t = mk(); pin(t);
    const ctxBtn = { dataset: { exc: '1' } }, ctxNode = { closest: q => q === '[data-exc],[data-rest]' ? ctxBtn : /#imp-errrow/.test(q) ? {} : null };
    t.env.fire('imp-prev', 'click', { target: ctxNode }); t.env.fire('document', 'click', { target: ctxNode });
    eq(t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, ''), 'Importar: 1 fila · Excluidas: 1 fila', 'Excluir contextual al primer toque'); ok(!st().open, 'y el detalle se cierra con la tabla rehecha');
    ok(/data-rest="1">Restaurar<\/button>/.test(ultimo(t, 'imp-prev')), 'la fila queda excluida con su Restaurar');
    t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { rest: '1' } } : null } });
    eq(t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, ''), 'Importar: 1 fila · Error: 1 fila', 'Restaurar (mismo handler) la devuelve a Error');
    // Restaurar: si la acción de la fila es Restaurar, la contextual también (mismo atributo y texto i18n)
    t = mk(); b = pin(t, { dataset: { rest: '1' }, getBoundingClientRect: () => ({ left: 0, right: 0, top: NaN, bottom: NaN }) });
    ok(/<button type="button" id="imp-errctx" class="linkbtn imp-rowact imp-errctx" data-rest="1" aria-describedby="imp-errinline" hidden>Restaurar<\/button>/.test(b.ins[0][1]), 'contextual = Restaurar');
    t.env.fire('imp-prev', 'click', { target: b });
    // Su Excluir original a la vista (dentro de la pantalla útil): la contextual NO aparece
    t = mk(); b = pin(t, { dataset: { exc: '1' }, getBoundingClientRect: () => ({ left: 120, right: 170, top: 140, bottom: 156 }) });
    ok(st().inline && t.env.getEl('imp-errctx').hidden === true, 'Excluir original visible: sin duplicado');
    t.env.fire('imp-prev', 'click', { target: b });
    t = mk(); b = pin(t, { dataset: { exc: '1' }, getBoundingClientRect: () => ({ left: 120, right: 170, top: 290, bottom: 306 }) });
    eq(t.env.getEl('imp-errctx').hidden, false, 'Excluir original cortado por abajo: aparece la contextual');
    t = mk(); pin(t); t.env.fire('imp-go', 'click', { target: fuera });
    eq(t.read('showtime.festival').artists.length, F.s.artists.length + 1, 'Importar al primer toque');
    // Teclado: foco visible en Error abre en línea; Tab llega a la acción contextual sin cerrar nada; salir del conjunto lo cierra
    t = mk();
    const rafQ = []; t.env.win.requestAnimationFrame = f => rafQ.push(f); const frame = () => rafQ.splice(0).forEach(f => f());
    const kb = () => { const at = {}, tr = { insertAdjacentHTML() {} }, td = { querySelector: () => null };
      const b = { dataset: { errtip: '1', why: LARGO }, at, setAttribute: (k, v) => { at[k] = v; }, matches: q => q === ':focus-visible', getBoundingClientRect: () => ({ left: 60, right: 110, top: 120, bottom: 138 }) };
      b.closest = q => q === '[data-errtip]' ? b : q === 'tr' ? tr : q === 'td' ? td : null; return b; };
    const ctxEl = t.env.getEl('imp-errctx'); let enfocada = 0; ctxEl.focus = () => { enfocada++; };
    const enCtx = { closest: q => q === '#imp-errrow' ? {} : null }, enDetalle = { closest: q => q === '#imp-errrow' ? {} : null };
    const tab = (target, shift) => { let pd = 0; t.env.fire('imp-prev', 'keydown', { key: 'Tab', shiftKey: !!shift, target, preventDefault: () => { pd++; } }); return pd; };
    b = kb(); ctxEl.hidden = true;
    t.env.fire('imp-prev', 'focusin', { target: b }); frame();
    ok(st().open && st().inline && !st().pinned && b.at['aria-expanded'] === 'true', 'foco de teclado en Error: detalle en línea, aria-expanded="true"');
    eq(ctxEl.hidden, false, 'su Excluir original no se ve: acción contextual visible');
    eq(tab(b, true), 0, 'Shift+Tab desde Error: orden normal'); eq(enfocada, 0);
    eq(tab(b), 1, 'Tab desde Error: va a la acción contextual'); eq(enfocada, 1);
    t.env.fire('imp-prev', 'focusout', { target: b, relatedTarget: enCtx });
    ok(st().open && b.at['aria-expanded'] === 'true', 'de Error a su acción contextual: sigue abierto y aria-expanded="true"');
    t.env.fire('imp-prev', 'focusout', { target: enCtx, relatedTarget: enDetalle }); ok(st().open, 'dentro del bloque: sigue abierto');
    t.env.fire('imp-prev', 'focusout', { target: enCtx, relatedTarget: b }); ok(st().open && b.at['aria-expanded'] === 'true', 'de vuelta a Error: sigue abierto');
    eq(tab(enCtx), 0, 'Tab desde la acción contextual: sin trampa, orden normal');
    t.env.fire('imp-prev', 'focusout', { target: enCtx, relatedTarget: { closest: () => null } });
    ok(!st().open && b.at['aria-expanded'] === 'false', 'el foco sale del conjunto: se cierra y aria-expanded="false"');
    b = kb(); t.env.fire('imp-prev', 'focusin', { target: b }); frame(); t.env.fire('imp-prev', 'focusout', { target: b, relatedTarget: null });
    ok(!st().open && b.at['aria-expanded'] === 'false', 'foco fuera desde Error: se cierra');
    // Enter/Espacio en la acción contextual (click de teclado, detail 0): mismo handler, actúa al primer intento y el foco pasa a la
    // acción nueva de su fila (Restaurar), desde donde Tab sigue el orden normal. Con puntero (detail ≥ 1) el foco no se mueve.
    const prev = t.env.getEl('imp-prev'), pedidos = []; let foco = 0;
    prev.querySelector = q => { pedidos.push(q); return { focus: () => { foco++; } }; };
    b = kb(); ctxEl.hidden = true; t.env.fire('imp-prev', 'focusin', { target: b }); frame(); eq(tab(b), 1);
    const ctxBoton = { id: 'imp-errctx', dataset: { exc: '1' } }, ctxDentro = { closest: q => q === '[data-exc],[data-rest]' ? ctxBoton : q === '#imp-errrow' ? {} : null };
    t.env.fire('imp-prev', 'click', { target: ctxDentro, detail: 0 });
    eq(t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, ''), 'Importar: 1 fila · Excluidas: 1 fila', 'Enter/Espacio en la contextual: Excluir al primer intento');
    ok(!st().open, 'el detalle se cierra con la tabla rehecha');
    eq(pedidos[pedidos.length - 1], 'td.st [data-rest="1"], td.st [data-exc="1"]', 'el foco va a la acción de su fila'); eq(foco, 1);
    t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { rest: '1' } } : null }, detail: 0 });
    eq(foco, 1, 'la acción ORIGINAL de la fila no toca el foco (sin cambios)');
    t.env.fire('imp-prev', 'click', { target: ctxDentro, detail: 1 }); eq(foco, 1, 'contextual con puntero: el foco no se mueve');
    delete prev.querySelector;
    // Sin acción contextual visible (su Excluir se ve) o con el detalle flotante: Tab no se toca
    b = kb(); ctxEl.hidden = true; t.env.fire('imp-prev', 'focusin', { target: b }); frame(); ctxEl.hidden = true; eq(tab(b), 0, 'acción contextual oculta: Tab normal');
    t.env.fire('imp-prev', 'focusout', { target: b, relatedTarget: null });
    t.env.win.innerHeight = 1024; t.env.getEl('imp-errpop').offsetHeight = 40; t.env.getEl('imp-errpop').offsetWidth = 200;
    b = kb(); t.env.fire('imp-prev', 'focusin', { target: b });
    // El scroll con el que el navegador enfoca el botón llega ANTES del fotograma: no hay nada abierto que cerrar
    t.env.fire('window', 'scroll', { target: { closest: () => null } }); ok(!st().open, 'antes del fotograma: aún cerrado');
    frame(); ok(st().open && !st().inline && b.at['aria-expanded'] === 'true' && t.env.getEl('imp-errpop').hidden === false, 'flotante por teclado: abierto, aria-expanded="true"');
    eq(tab(b), 0, 'flotante: Tab normal');
    // Un scroll real posterior del usuario lo cierra como siempre
    t.env.fire('window', 'scroll', { target: { closest: () => null } });
    ok(!st().open && b.at['aria-expanded'] === 'false' && t.env.getEl('imp-errpop').hidden === true, 'scroll del usuario después: se cierra y aria-expanded="false"');
    // Foco que se va antes del fotograma (Tab rápido): no se abre nada
    b = kb(); b.matches = () => false; t.env.fire('imp-prev', 'focusin', { target: b }); frame(); ok(!st().open, 'sin foco de teclado al llegar el fotograma: no se abre');
    // El mismo botón ya abierto: el fotograma no lo reabre
    b = kb(); t.env.fire('imp-prev', 'focusin', { target: b }); frame(); t.env.fire('imp-prev', 'focusin', { target: b }); frame(); ok(st().open && b.at['aria-expanded'] === 'true');
    t.env.fire('imp-prev', 'focusout', { target: b, relatedTarget: null }); ok(!st().open && b.at['aria-expanded'] === 'false', 'al dejar Error: se cierra');
    eq(t.env.errors.length, 0);
    eq(t.env.errors.length, 0);
  });
  test('Importador · filas con error: sin casilla engañosa; «Excluir» las pasa a Excluidas y «Restaurar» a Error; corregir crea la casilla (marcada o desmarcada); el resumen cuadra', () => {
    const T0 = panel().env.win.ShowtimePanel._test;
    // Reparto puro: cada fila en un solo grupo; solo una exclusión manual lleva a Excluidas
    const rows = [{ idx: 0, include: true, status: 'ok' }, { idx: 1, include: true, status: 'warn' }, { idx: 2, include: false, status: 'warn' },
      { idx: 3, include: false, status: 'err' }, { idx: 4, include: false, status: 'err' }];
    const off = new Set([2, 4]);
    eq(JSON.stringify(T0.impTally(rows, r => off.has(r.idx))), JSON.stringify({ imp: 2, exc: 2, err: 1, total: 5 }));
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    const sum = () => t.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, '');
    const pv = () => ultimo(t, 'imp-prev');
    const total = () => (pv().match(/<tr class="st-/g) || []).length;
    const nums = () => { const m = k => +((sum().match(new RegExp(k + ': (\\d+)')) || [0, 0])[1]); return m('Importar') + m('Excluidas') + m('Error'); };
    const cuadra = msg => eq(nums(), total(), msg + ' (' + sum() + ')');
    const fila = i => { const h = pv(), k = h.indexOf('<td class="chk"><', h.indexOf('<tr class="st-', [...h.matchAll(/<tr class="st-/g)][i].index)); return h.slice([...h.matchAll(/<tr class="st-/g)][i].index, h.indexOf('</tr>', k)); };
    const click = (attr, i) => t.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { [attr]: String(i) } } : null } });
    t.env.fire('btn-paste', 'click', {});
    // Fila 2: sin nombre (error); fila 3: hora imposible (error)
    t.env.win.ShowtimePanel._test.setImportText('Banda\tZona\tInicio\tFin\nUno\tPrincipal\t23:00\t23:20\nDos\tPrincipal\t23:30\t23:50\n\tPrincipal\t21:00\t22:00\nCuatro\tPrincipal\t25:99\t');
    eq(total(), 4); eq(sum(), 'Importar: 2 filas · Error: 2 filas'); cuadra('al empezar');
    // 1) Error: sin casilla (ni marcada ni desmarcada), hueco conservado y estado/causa legibles
    [2, 3].forEach(i => {
      const h = fila(i);
      ok(/^<tr class="st-err/.test(h) && !/type="checkbox"/.test(h), 'fila ' + i + ': sin casilla');
      ok(/<td class="chk"><span class="sr-only">Esta fila no se importará<\/span><\/td>/.test(h), 'fila ' + i + ': hueco de la casilla con su explicación accesible');
      ok(/<button type="button" class="imp-errbtn" data-errtip="\d+" data-why="[^"]+" aria-expanded="false" aria-controls="imp-errpop" aria-label="Error\. Esta fila no se importará\. [^"]+\. Mostrar detalle">Error <svg class="ic ii" viewBox="0 0 16 16" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><\/button><button type="button" class="linkbtn imp-rowact" data-exc="\d+">Excluir<\/button>/.test(h), 'fila ' + i + ': «Error» + icono SVG decorativo + «Excluir»');
      ok(!/ⓘ/.test(h), 'fila ' + i + ': sin el glifo de fuente');
      ok(!/No se importará hasta corregirla/.test(h), 'fila ' + i + ': sin la frase larga visible');
      ok(/data-k="banda"/.test(h) && /data-k="inicio"/.test(h), 'fila ' + i + ': sigue editable');
    });
    ok(/type="checkbox" data-inc="0" checked/.test(pv()) && /type="checkbox" data-inc="1" checked/.test(pv()), 'las válidas, con su casilla normal');
    ok(!/data-inc="\d+"[^>]*disabled/.test(pv()), 'ninguna casilla gris');
    // «Error ⓘ»: motivo concreto en el detalle y en el nombre accesible; toque/clic abre y cierra; hover y foco por CSS
    ok(/aria-label="Error\. Esta fila no se importará\. Falta el nombre de la banda\. Mostrar detalle"/.test(fila(2)) && /data-why="Falta el nombre de la banda"/.test(fila(2)), 'fila sin nombre: el motivo exacto');
    ok(/aria-label="Error\. Esta fila no se importará\. Hora de inicio no reconocida: «25:99»\. Mostrar detalle"/.test(fila(3)), 'fila con hora imposible: su motivo');
    ok(/<div class="e">Falta el nombre de la banda<\/div>/.test(fila(2)), 'Avisos conserva el diagnóstico completo');
    // Detalle flotante: aria-expanded sigue lo que se ve (hover, foco, toque); el ratón pasa del botón al detalle sin cerrarlo
    const pop = t.env.getEl('imp-errpop'); pop.offsetWidth = 200; pop.offsetHeight = 40;
    t.env.win.innerWidth = 768; t.env.win.innerHeight = 1024;
    const mkBtn = i => { const at = {}; const b = { dataset: { errtip: String(i), why: 'Falta el nombre de la banda' }, at, setAttribute: (k, v) => { at[k] = v; }, getBoundingClientRect: () => ({ left: 60, right: 110, top: 500, bottom: 520 }) }; b.closest = q => q === '[data-errtip]' ? b : null; return b; };
    const st = () => t.env.win.ShowtimePanel._test.errPop();
    const b2 = mkBtn(2), b3 = mkBtn(3), popNode = { closest: q => /#imp-errpop/.test(q) ? pop : null }, fuera = { closest: () => null };
    t.env.fire('imp-prev', 'pointerover', { pointerType: 'mouse', target: b2 });
    ok(st().open && pop.hidden === false && b2.at['aria-expanded'] === 'true', 'hover: se ve y aria-expanded="true"');
    eq(pop.textContent, 'Falta el nombre de la banda', 'con el motivo'); eq(pop.style.left, '110px', 'pegado a la derecha del botón (sin hueco)');
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: b2, relatedTarget: popNode });
    ok(st().open, 'del botón al detalle: no se cierra');
    t.env.fire('imp-errpop', 'pointerleave', { pointerType: 'mouse', relatedTarget: b2 });
    ok(st().open, 'del detalle al botón: tampoco');
    t.env.fire('imp-errpop', 'pointerleave', { pointerType: 'mouse', relatedTarget: fuera });
    ok(!st().open && pop.hidden === true && b2.at['aria-expanded'] === 'false', 'fuera de los dos: se cierra y aria-expanded="false"');
    t.env.fire('imp-prev', 'pointerover', { pointerType: 'mouse', target: b2 });
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: b2, relatedTarget: fuera });
    ok(!st().open && b2.at['aria-expanded'] === 'false', 'del botón a otro sitio: se cierra');
    const raf = []; t.env.win.requestAnimationFrame = f => raf.push(f); const frame = () => raf.splice(0).forEach(f => f());
    t.env.fire('imp-prev', 'focusin', { target: b3 });
    ok(!st().open, 'foco de teclado: aún no (espera al fotograma en que se asienta el foco y su scroll)');
    frame(); ok(st().open && b3.at['aria-expanded'] === 'true', 'foco de teclado: se ve y aria-expanded="true"');
    t.env.fire('imp-prev', 'focusout', { target: b3 });
    ok(!st().open && b3.at['aria-expanded'] === 'false', 'sin foco: se cierra');
    const s0 = sum();
    t.env.fire('imp-prev', 'click', { target: b2 });
    ok(st().open && st().pinned && b2.at['aria-expanded'] === 'true', 'toque/clic: lo fija');
    t.env.fire('imp-prev', 'pointerout', { pointerType: 'mouse', target: b2, relatedTarget: fuera }); ok(st().open, 'fijado: salir con el ratón no lo cierra');
    t.env.fire('imp-prev', 'click', { target: b2 });
    ok(!st().open && b2.at['aria-expanded'] === 'false', 'otro toque: lo cierra');
    t.env.fire('imp-prev', 'click', { target: b2 }); t.env.fire('imp-prev', 'click', { target: b3 });
    ok(st().open && b2.at['aria-expanded'] === 'false' && b3.at['aria-expanded'] === 'true', 'abrir otro cierra el anterior (un solo detalle, aria coherente)');
    t.env.fire('document', 'click', { target: fuera }); ok(!st().open, 'un clic fuera lo cierra');
    eq(sum(), s0, 'abrir el detalle no cambia nada del borrador');
    t.env.fire('imp-prev', 'pointerover', { pointerType: 'touch', target: b2 }); ok(!st().open, 'un dedo que pasa por encima (scroll) no lo abre');
    const css2 = D.src('control.css'), cj2 = D.src('control.js'), html2 = srcRaw('index.html');
    ok(/<div id="imp" class="modal" hidden>\s*<!--[^>]*-->\s*<div id="imp-errpop" class="imp-errpop" role="tooltip" hidden><\/div>/.test(html2), 'un solo detalle, fuera de la caja con scroll (no lo recorta nada)');
    ok(/\.imp-errpop\{position:fixed;[^}]*max-width:min\(320px,calc\(100vw - 16px\)\);[^}]*border:6px solid transparent;background-clip:padding-box;/.test(css2), 'fijo, nunca más ancho que la pantalla, con puente transparente al botón');
    ok(!/addEventListener\('touchstart'/.test(cj2) && !/title="[^"]*' \+ esc\(back\(r\.errs\[0\]/.test(cj2), 'sin touchstart y sin depender de title');
    ok(!/\.imp-errbtn\{[^}]*(border-radius|background:(?!none))/.test(css2), 'sin píldora');
    ok(!/data-errtip[\s\S]{0,400}Escape/.test(cj2), 'Esc no se intercepta');
    t.env.getEl('imp').hidden = false; t.env.fire('document', 'keydown', { key: 'Escape', target: { closest: () => null, tagName: 'BODY' }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); eq(t.env.getEl('imp').hidden, true, 'Esc sigue cerrando (y descartando) el importador');
    t.env.fire('btn-paste', 'click', {});
    t.env.win.ShowtimePanel._test.setImportText('Banda\tZona\tInicio\tFin\nUno\tPrincipal\t23:00\t23:20\nDos\tPrincipal\t23:30\t23:50\n\tPrincipal\t21:00\t22:00\nCuatro\tPrincipal\t25:99\t');
    // 2) Excluir → Excluidas (el detalle del error sigue a la vista) · Restaurar → Error
    click('exc', 2);
    eq(sum(), 'Importar: 2 filas · Excluidas: 1 fila · Error: 1 fila', 'Excluir: de Error a Excluidas'); cuadra('tras Excluir');
    let h = fila(2);
    ok(!/type="checkbox"/.test(h) && /Excluida<\/span><div class="why">Excluida a mano: no se importará<\/div><button type="button" class="linkbtn imp-rowact" data-rest="2">Restaurar<\/button>/.test(h), 'excluida: sin casilla, con «Restaurar»');
    ok(/<div class="e">Falta el nombre/.test(h), 'conserva visible su error mientras siga inválida');
    click('rest', 2);
    eq(sum(), 'Importar: 2 filas · Error: 2 filas', 'Restaurar: vuelve a Error pendiente'); cuadra('tras Restaurar');
    ok(/data-exc="2">Excluir</.test(fila(2)));
    // 3) Corregir desde Error pendiente → casilla normal MARCADA (importable)
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '2', k: 'banda' }, value: 'Tres' } });
    ok(/<input type="checkbox" data-inc="2" checked>/.test(fila(2)) && !/data-exc|data-rest/.test(fila(2)), 'corregida desde Error: casilla marcada');
    eq(sum(), 'Importar: 3 filas · Error: 1 fila'); cuadra('corregida desde Error');
    // 4) Corregir desde Excluida → casilla normal DESMARCADA (la exclusión explícita se respeta)
    click('exc', 3);
    eq(sum(), 'Importar: 3 filas · Excluidas: 1 fila');
    ok(!/Error/.test(sum()), 'una fila con error excluida no cuenta como Error');
    t.env.win.ShowtimePanel._test.setAppLang('en');
    eq(sum(), 'Import: 3 rows · Excluded: 1 row', 'en inglés'); ok(/data-rest="3">Restore</.test(fila(3)) && /Manually excluded: won’t be imported/.test(fila(3)));
    t.env.win.ShowtimePanel._test.setAppLang('es');
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '3', k: 'inicio' }, value: '23:55' } });
    ok(/<input type="checkbox" data-inc="3">/.test(fila(3)) && !/data-inc="3" checked/.test(fila(3)), 'corregida desde Excluida: casilla desmarcada');
    eq(sum(), 'Importar: 3 filas · Excluidas: 1 fila'); cuadra('corregida desde Excluida');
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '3', k: 'banda' }, value: 'Cuatro bis' } });
    ok(!/data-inc="3" checked/.test(fila(3)), 'tampoco una edición del nombre deshace la exclusión');
    // 5) Solo se importan las importables
    eq(t.env.getEl('imp-go').title, 'Importar: 3 filas');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.artists.length, F.s.artists.length + 3, 'entran Uno, Dos y Tres'); ok(!s.artists.some(a => /Cuatro/.test(a.nombre)), 'la excluida no entra');
    // i18n de los textos nuevos
    const I = require('../i18n.js');
    [['Excluir', 'Exclude'], ['Restaurar', 'Restore'], ['Excluida', 'Excluded'], ['Esta fila no se importará', 'This row won’t be imported'], ['Error. Esta fila no se importará. {_m}. Mostrar detalle', 'Error. This row won’t be imported. {_m}. Show details'], ['Excluida a mano: no se importará', 'Manually excluded: won’t be imported']].forEach(([es, en]) => eq(I.tx(es, null, 'en'), en));
    const cj = D.src('control.js');
    ok(!/['"](Exclude|Restore|Won’t be imported)/.test(cj), 'nada en inglés escrito en control.js');
    // Lo mismo para una fila MANUAL con error (excluir / restaurar por su id)
    const t2 = panel({ 'showtime.festival': JSON.stringify(F.s) }), sum2 = () => t2.env.getEl('imp-sum').innerHTML.replace(/<[^>]+>/g, '');
    t2.env.fire('document', 'paste', pasteEv('23:00-23:20 Uno Principal'));
    t2.env.fire('imp-man-open', 'click', {});
    manFill(t2, { nombre: 'Manual', zona: 'Principal', ini: '22:00', fin: '22:30' }); t2.env.fire('imp-m-add', 'click', {});
    t2.env.fire('imp-prev', 'change', { target: { dataset: { row: '1', k: 'banda' }, value: '' } });   // se rompe en la vista previa
    eq(sum2(), 'Importar: 1 fila · Error: 1 fila');
    const click2 = (attr, i) => t2.env.fire('imp-prev', 'click', { target: { closest: q => q === '[data-exc],[data-rest]' ? { dataset: { [attr]: String(i) } } : null } });
    click2('exc', 1); eq(sum2(), 'Importar: 1 fila · Excluidas: 1 fila', 'manual con error: Excluir');
    t2.env.fire('imp-prev', 'change', { target: { dataset: { row: '1', k: 'banda' }, value: 'Manual' } });
    ok(/<input type="checkbox" data-inc="1">/.test(ultimo(t2, 'imp-prev')), 'corregida tras excluir: desmarcada');
    eq(sum2(), 'Importar: 1 fila · Excluidas: 1 fila');
    eq(t.env.errors.length + t2.env.errors.length, 0);
  });
  test('Importador con evento abierto: pegar + fila manual no tocan el evento hasta «Importar»; después conserva sus filas y suma todo', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    const s0 = dump(t), n0 = F.s.artists.length;
    t.env.fire('document', 'paste', pasteEv('23:00-23:20 Banda Nueva Principal'));
    t.env.fire('imp-man-open', 'click', {});
    manFill(t, { nombre: 'Manual Uno', zona: 'Principal', ini: '22:00', fin: '22:30', call: '21:45' });
    t.env.fire('imp-m-add', 'click', {});
    manFill(t, { tipo: 'tarea', nombre: 'Cambio de backline', ini: '22:35', fin: '+10' });
    t.env.fire('imp-m-add', 'click', {});
    eq(t.env.getEl('imp-man-n').textContent, '2 filas manuales en el borrador');
    eq(t.env.getEl('imp-go').title, 'Importar: 3 filas');
    // Las filas manuales se editan y se marcan en la misma vista previa (índices detrás de las pegadas)
    t.env.fire('imp-prev', 'change', { target: { dataset: { row: '1', k: 'notas' }, value: 'Editada en la vista previa' } });
    ok(/value="Editada en la vista previa"/.test(ultimo(t, 'imp-prev')), 'edición de la fila manual');
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '2' }, checked: false } });
    eq(t.env.getEl('imp-go').title, 'Importar: 2 filas', 'desmarcada la tarea manual');
    t.env.fire('imp-prev', 'change', { target: { dataset: { inc: '2' }, checked: true } });
    eq(t.env.getEl('imp-go').title, 'Importar: 3 filas', 'y vuelta a marcar');
    eq(dump(t), s0, 'el evento y el almacén, sin tocar');
    t.env.fire('imp-go', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.artists.length, n0 + 3, 'las de antes + 1 pegada + 2 manuales');
    ok(s.artists.some(a => a.nombre === 'Banda A') && s.artists.some(a => a.nombre === 'Banda Nueva') && s.artists.some(a => a.nombre === 'Manual Uno') && s.artists.some(a => a.nombre === 'Cambio de backline'));
    eq(s.artists.find(a => a.nombre === 'Manual Uno').notas, 'Editada en la vista previa', 'con su edición');
    eq(s.event.nombre, 'Prueba control', 'mismo evento');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Importador: una fila manual inválida no se añade, avisa y no cierra ni borra el borrador; Cancelar descarta todo', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    t.env.fire('document', 'paste', pasteEv('23:00-23:20 Banda Nueva Principal'));
    t.env.fire('imp-man-open', 'click', {});
    manFill(t, { nombre: 'Buena', zona: 'Principal', ini: '21:00', fin: '21:30' }); t.env.fire('imp-m-add', 'click', {});
    const pv0 = ultimo(t, 'imp-prev');
    manFill(t, { nombre: '', zona: 'Principal', ini: '22:00' }); t.env.fire('imp-m-add', 'click', {});
    ok(/Falta el nombre/.test(t.env.getEl('imp-m-err').textContent), 'avisa: ' + t.env.getEl('imp-m-err').textContent);
    eq(t.env.getEl('imp-m-ini').value, '22:00', 'lo escrito en la ficha se queda para corregirlo');
    manFill(t, { nombre: 'Mala', zona: 'Principal', ini: '27:99' }); t.env.fire('imp-m-add', 'click', {});
    ok(/Hora de inicio no reconocida/.test(t.env.getEl('imp-m-err').textContent), 'hora inválida: ' + t.env.getEl('imp-m-err').textContent);
    eq(t.env.getEl('imp').hidden, false, 'el importador sigue abierto'); eq(t.env.getEl('imp-text').value, '23:00-23:20 Banda Nueva Principal', 'texto intacto');
    eq(t.env.getEl('imp-man-n').textContent, '1 fila manual en el borrador', 'la manual buena sigue'); eq(ultimo(t, 'imp-prev'), pv0, 'la vista previa no cambia');
    eq(t.env.getEl('imp-go').title, 'Importar: 2 filas');
    // Enter en la ficha = «Añadir al borrador»
    manFill(t, { nombre: 'Con Intro', zona: 'Principal', ini: '20:00', fin: '20:30' });
    let prevented = false; t.env.fire('imp-man', 'keydown', { key: 'Enter', target: { tagName: 'INPUT' }, preventDefault() { prevented = true; } });
    ok(prevented); eq(t.env.getEl('imp-go').title, 'Importar: 3 filas');
    // Cancelar descarta EXPLÍCITAMENTE el borrador entero
    const s0 = dump(t);
    t.env.fire('imp-cancel', 'click', {});
    eq(t.env.getEl('imp').hidden, true); eq(dump(t), s0, 'nada guardado');
    eq(t.env.getEl('imp-man').hidden, true, 'la ficha se pliega'); eq(t.env.getEl('imp-m-nombre').value, '', 'y se vacía');
    t.env.fire('document', 'paste', pasteEv('23:00-23:20 Otra Principal'));
    eq(t.env.getEl('imp-man-n').textContent, '', 'un borrador nuevo empieza sin filas manuales'); ok(!/Buena|Con Intro/.test(ultimo(t, 'imp-prev')));
    eq(t.read('showtime.festival').artists.length, F.s.artists.length, 'el evento, como estaba');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('«Horario a importar»: superficie de composición con la letra de Showtime (sin monoespaciada); solo aspecto, lo pegado queda literal', () => {
    const css = D.src('control.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = (css.match(/[^{}]*\{[^}]*\}/g) || []).filter(r => /\.imp-src textarea/.test(r.split('{')[0]));
    ok(rules.length >= 3, 'reglas de la caja: ' + rules.length);
    ok(!rules.some(r => /monospace|ui-monospace|SFMono|Menlo|Consolas|Courier/i.test(r)), 'ninguna fuente monoespaciada');
    ok(rules.some(r => /\.imp-box \.imp-src textarea\{[^}]*font-family:inherit;font-size:15px;line-height:1\.6;/.test(r)), 'letra de Showtime, 15 px, interlineado 1,6');
    ok(rules.some(r => /\.imp-box \.imp-src textarea\{[^}]*padding:14px 16px;border-radius:12px/.test(r)), 'aire y esquinas suaves');
    ok(rules.some(r => /:where\(body:not\(\[data-ps="stage"\]\)\) \.imp-box \.imp-src textarea\{background-color:rgba\(255,255,255,\.035\);border:1px solid rgba\(255,255,255,\.08\)\}/.test(r)), 'Studio: una sola superficie suave (no la caja negra del campo)');
    ok(rules.some(r => /\.imp-src textarea:focus\{[^}]*border-color:rgba\(255,255,255,\.38\)/.test(r)) && rules.some(r => /body\[data-ps="stage"\] \.imp-box \.imp-src textarea:focus\{[^}]*border-color:#FFD600/.test(r)), 'foco visible en Studio y en Stage');
    ok(rules.some(r => /body\[data-ps="stage"\] \.imp-box \.imp-src textarea\{background-color:#000;border:1px solid rgba\(255,214,0,\.35\);color:#fff\}/.test(r)), 'Stage: negro, texto blanco');
    ok(/<textarea id="imp-text" spellcheck="false"/.test(srcRaw('index.html')), 'el mismo textarea');
    // Lo pegado entra tal cual (saltos y tabulaciones) y la lectura no cambia
    const t = panel();
    t.env.fire('document', 'paste', pasteEv(CARTEL));
    eq(t.env.getEl('imp-text').value, CARTEL, 'literal, con tabuladores y saltos');
    ok(/Tabla · 5 columnas · tabuladores · 2 filas/.test(t.env.getEl('imp-kind').textContent), t.env.getEl('imp-kind').textContent);
  });
  test('Tarjeta central: «Pegar horario» abre la vista previa; «Añadir fila a mano» sin evento abre la ficha con lo mínimo del evento (sin otro modal)', () => {
    const t = panel();
    clickData(t, '[data-ob]', { ob: 'paste' });
    eq(t.env.getEl('imp').hidden, false);
    t.env.fire('imp-cancel', 'click', {});
    clickData(t, '[data-ob]', { ob: 'manual' });
    eq(t.env.getEl('addm').hidden, false, 'la ficha manual'); eq(t.env.getEl('modal').hidden, true, 'sin el modal «Crear evento»');
    eq(t.env.getEl('modal-title').textContent, '', 'nada de «Nuevo evento»');
    eq(t.env.getEl('add-newev').hidden, false, 'con el bloque del primer evento'); eq(t.env.getEl('add-target').hidden, true);
    eq(t.read('showtime.festival'), null, 'abrir la ficha no crea nada');
  });
  // ── Dec. 155 · ficha manual: «Añadiendo a: …» con evento; sin evento, crea evento + primera fila en una sola acción ──
  test('Ficha manual sin evento: nombre opcional y fecha editable; «Añadir» crea el evento y la primera fila a la vez (nada antes)', () => {
    const t = panel(), d0 = (() => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); })();
    clickData(t, '[data-ob]', { ob: 'manual' });
    ok(/^\d{4}-\d{2}-\d{2}$/.test(t.env.getEl('add-ev-fecha').value), 'fecha visible y rellena (hoy): ' + t.env.getEl('add-ev-fecha').value);
    ok(t.env.getEl('addm').classList.contains('noev'), 'sin evento, la jornada es la fecha del bloque');
    const H = srcRaw('index.html');
    ok(/<div id="add-newev"[\s\S]*id="add-ev-nombre"[^>]*placeholder="Evento sin nombre"[\s\S]*id="add-ev-fecha" type="date"[\s\S]*<div id="addrow"/.test(H), 'bloque compacto encima de la ficha');
    const fill = o => { t.env.getEl('add-tipo').value = o.tipo || 'show'; ['nombre', 'escenario', 'inicio', 'fin', 'call', 'notas'].forEach(k => { t.env.getEl('add-' + k).value = o[k] || ''; }); };
    // Primero inválida: no crea nada
    t.env.getEl('add-ev-nombre').value = 'Noches del Botánico'; t.env.getEl('add-ev-fecha').value = '2026-07-10';
    fill({ nombre: '', inicio: '21:00' }); t.env.fire('btn-add', 'click', {});
    ok(t.env.getEl('add-err').textContent, 'avisa: ' + t.env.getEl('add-err').textContent); eq(t.env.getEl('addm').hidden, false, 'la ficha sigue');
    const d1 = (() => { const o = {}; t.env.storage.forEach((v, k) => { o[k] = v; }); return JSON.stringify(o); })();
    eq(d1, d0, 'entrada inválida: ni evento ni nada guardado');
    t.env.getEl('add-ev-fecha').value = ''; fill({ nombre: 'Los Ácratas', inicio: '21:00' }); t.env.fire('btn-add', 'click', {});
    eq(t.env.getEl('add-err').textContent, 'Elige la fecha del evento'); eq(t.read('showtime.festival'), null, 'sin fecha, nada');
    // Válida: evento + primera fila
    t.env.getEl('add-ev-fecha').value = '2026-07-10';
    fill({ nombre: 'Los Ácratas', escenario: 'Principal', inicio: '21:00', fin: '+75' }); t.env.fire('btn-add', 'click', {});
    const s = t.read('showtime.festival');
    ok(s, 'evento creado al pulsar «Añadir»'); eq(s.event.nombre, 'Noches del Botánico'); eq(s.event.fechaInicio, '2026-07-10'); eq(s.event.fechaFin, '2026-07-10');
    eq(s.artists.length, 1); eq(s.artists[0].nombre, 'Los Ácratas'); eq(s.escenarios.map(e => e.nombre).join(), 'Principal');
    const b = C.buildBlocks(s, { mode: 'show', day: 'all' })[0]; ok(b && b.jornada === '2026-07-10' && b.stage === 'Principal', 'en su jornada y zona');
    eq(t.read('showtime.original').artists.length, 0, 'la referencia es el evento vacío: la fila cuenta como cambio sin exportar');
    eq(t.env.getEl('addm').hidden, true, 'la ficha se cierra'); eq(t.env.getEl('modal').hidden, true, 'sin otro modal');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    // Sin nombre: «Evento sin nombre»
    const t2 = panel(); clickData(t2, '[data-ob]', { ob: 'manual' });
    t2.env.getEl('add-ev-fecha').value = '2026-08-01'; t2.env.getEl('add-tipo').value = 'tarea';
    ['nombre', 'escenario', 'inicio', 'fin', 'call', 'notas'].forEach(k => { t2.env.getEl('add-' + k).value = ''; });
    t2.env.getEl('add-nombre').value = 'Montaje'; t2.env.getEl('add-inicio').value = '10:00';
    t2.env.fire('btn-add', 'click', {});
    eq(t2.read('showtime.festival').event.nombre, 'Evento sin nombre'); eq(t2.read('showtime.festival').event.fechaInicio, '2026-08-01');
  });
  test('Ficha manual con evento: «Añadiendo a: {evento}» solo informativo; añade la fila sin renombrar ni abrir otro modal', () => {
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s) });
    t.env.fire('btn-new-row', 'click', {});
    eq(t.env.getEl('addm').hidden, false);
    eq(t.env.getEl('add-target').hidden, false); eq(t.env.getEl('add-target').textContent, 'Añadiendo a: Prueba control');
    eq(t.env.getEl('add-newev').hidden, true, 'sin bloque de evento nuevo'); ok(!t.env.getEl('addm').classList.contains('noev'));
    ok(/<p id="add-target" class="add-target" hidden><\/p>/.test(srcRaw('index.html')), 'texto, no un campo: no se puede renombrar desde aquí');
    t.env.getEl('add-ev-nombre').value = 'Intento de renombrar';   // aunque quedara algo escrito en el bloque oculto
    t.env.getEl('add-tipo').value = 'show';
    ['nombre', 'escenario', 'inicio', 'fin', 'call', 'notas'].forEach(k => { t.env.getEl('add-' + k).value = ''; });
    t.env.getEl('add-nombre').value = 'Banda Mano'; t.env.getEl('add-escenario').value = 'Principal'; t.env.getEl('add-inicio').value = '22:00'; t.env.getEl('add-fin').value = '22:45';
    t.env.getEl('add-jornada').value = F.s.event.fechaInicio;
    t.env.fire('btn-add', 'click', {});
    const s = t.read('showtime.festival');
    eq(s.event.nombre, 'Prueba control', 'conserva su nombre'); eq(s.artists.length, F.s.artists.length + 1); ok(s.artists.some(a => a.nombre === 'Banda Mano'));
    eq(t.env.getEl('modal').hidden, true, 'sin otro modal'); eq(t.env.getEl('imp').hidden, true);
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    // En inglés
    t.env.win.ShowtimePanel._test.setAppLang && t.env.win.ShowtimePanel._test.setAppLang('en');
    t.env.fire('btn-new-row', 'click', {}); eq(t.env.getEl('add-target').textContent, 'Adding to: Prueba control');
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
    eq(S([R('show', 'a'), R('show', 'a'), R('sc', 'b'), R('tarea', 'b'), R('hito', 'c')]), '✓ 5 entradas importadas con éxito en 3 jornadas (2 shows · 1 prueba · 2 tareas/marcadores)');
    eq(S([R('show', 'a')]), '✓ 1 entrada importada con éxito (1 show)');
    eq(S([R('hito', 'a'), R('hito', 'a')], 2), '✓ 2 entradas importadas con éxito (2 tareas/marcadores)');
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
  test('Ventanas de cristal esmerilado (dec. 139 y 142; antes opacas por Safari): fondo oscurecido y desenfocado, caja al 74 %; Stage opaco', () => {
    const css = D.src('control.css'), tail = css.slice(css.lastIndexOf('/* ── Modales sólidos'));
    ok(/\.modal\{background:rgba\(0,0,0,\.45\);-webkit-backdrop-filter:blur\(16px\);backdrop-filter:blur\(16px\)\}/.test(tail), 'fondo de pantalla al 45 % y desenfocado (dec. 142)');
    ok(/\.modal-box,\.imp-box,\.spot-box\{--modal-bg:#16191f;background-color:rgba\(22,25,33,\.74\);background-image:linear-gradient\(180deg,rgba\(255,255,255,\.12\),rgba\(255,255,255,\.02\) 40%,transparent\);-webkit-backdrop-filter:blur\(28px\) saturate\(190%\);backdrop-filter:blur\(28px\) saturate\(190%\);border:1px solid rgba\(255,255,255,\.18\);/.test(tail) && !/\.modal-box,\.imp-box,\.spot-box\{[^}]*!important/.test(tail), 'Studio: cristal al 74 % (ventanas y ⌘K), sin !important para que Stage siga opaco');
    ok(/body\[data-ps="stage"\] \.modal-box,body\[data-ps="stage"\] \.imp-box,body\[data-ps="stage"\] \.spot-box\{--modal-bg:#000;background:#000;-webkit-backdrop-filter:none;backdrop-filter:none;border-color:#FFD600\}/.test(tail), 'Stage: negro opaco y borde amarillo (también ⌘K)');
    ok(css.indexOf('/* ── Modales sólidos') > css.indexOf('/* ── Cristal'), 'va después del cristal (gana)');
  });

  test('Pantalla de inicio: el cartel de marca con versión y pie; se va sola (2,5 s), con clic o con Esc', () => {
    const t = panel(), sp = t.env.getEl('splash'), h = ultimo(t, 'splash');
    eq(sp.hidden, false, 'se ve al arrancar'); eq(sp.className, 'splash', 'inicio (no «Acerca de»)');
    ok(/class="stm-name">SHOWTIME</.test(h) && /by Synapse Live/.test(h) && /Real-Time Show Control/.test(h));
    ok(h.indexOf('v' + t.env.win.ShowtimeEmision.BUILD) > 0, 'versión activa'); ok(h.indexOf('ENGINEERED FOR LIVE PRODUCTION · © 2026 Synapse Live') > 0);
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
    ok(/id="lv-standby"[\s\S]*Modo Cartel en cada Confidence \(también por QR\)/.test(D.src('index.html')));
  });
  test('Gestor de ventanas Live: cada Live tiene nombre, vista y standby; se cambian desde el gestor, se recuerdan y se cierran', async () => {
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); }, close() { this.closed = true; } };
    t.env.win.open = () => w;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
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
  test('Simulador de Confidence: monitor con banda, reloj monoespaciado y barra; botones Normal · Ámbar · Rojo · Sobretiempo · Flash', () => {
    const html = D.src('index.html'), css = D.src('control.css');
    ok(!/sc-bprev/.test(html), 'el relojito de antes ya no está');
    ok(/<div id="cfsim" class="cfsim lv-ok"/.test(html) && /id="cfsim-t"/.test(html) && /id="cfsim-fill"/.test(html) && /id="cfsim-fl"/.test(html), 'monitor: banda, reloj, barra y capa del mensaje');
    eq((html.match(/data-cfsim="(ok|warn|danger|over|flash)"/g) || []).join(','), 'data-cfsim="ok",data-cfsim="warn",data-cfsim="danger",data-cfsim="over",data-cfsim="flash"');
    ok(/\.cfsim-dig span\{font-family:ui-monospace/.test(css), 'reloj monoespaciado');
    ok(/\.cfsim\.lv-over\{background:var\(--ov-bg,#000\)\}/.test(css) && /\.cfsim\.lv-over \.cfsim-dig span\{color:var\(--ov-num,#ff3b30\)\}/.test(css), 'colores de sobretiempo');
    ok(/\.cfsim\.blink \.cfsim-dig span\{animation:cfsimdig var\(--blink-speed,1s\) steps\(1,end\) infinite\}/.test(css), 'parpadeo a la velocidad elegida');
    ok(/\.cfsim-flbox\{[^}]*background:var\(--mbg,#000\);border:3px solid var\(--mfg,#ffb347\)/.test(css), 'Flash con los colores de Mensajes');
  });
  test('Simulador de Confidence: refleja umbrales, parpadeo y colores de la configuración; los botones cambian el estado', () => {
    const t = panel({ 'showtime.config': JSON.stringify({ msgBg: '#112233', msgFg: '#ffee00', screens: { conf: { showWarn: 10, showDanger: 5, blink: true, blinkSpeed: 0.4, overBg: '#220000', overNum: '#00ff00' } } }) });
    const T = t.T, sc = t.env.win.ShowtimeVistas.normScreens({ conf: { showWarn: 10, showDanger: 5, blink: true, blinkSpeed: 0.4 } }), msg = { bg: '#112233', fg: '#ffee00' };
    eq(T.cfSimState('ok', sc, msg).t, '22:00'); eq(T.cfSimState('warn', sc, msg).t, '07:30', 'entre el ámbar y el rojo'); eq(T.cfSimState('danger', sc, msg).t, '03:30', 'por debajo del rojo');
    eq(T.cfSimState('over', sc, msg).cls, 'cfsim lv-over blink'); eq(T.cfSimState('over', sc, msg).t, '-02:15');
    const quieto = t.env.win.ShowtimeVistas.normScreens({ conf: { blink: false } });
    eq(T.cfSimState('over', quieto, msg).cls, 'cfsim lv-over', 'sin parpadeo si está apagado');
    const fl = T.cfSimState('flash', sc, msg); ok(fl.flash); eq(fl.msgBg, '#112233'); eq(fl.msgFg, '#ffee00');
    t.env.fire('document', 'click', { target: { closest: q => q === '[data-cfsim]' ? { dataset: { cfsim: 'over' } } : null } });
    eq(T.cfSim(), 'over'); eq(t.env.getEl('cfsim').className, 'cfsim lv-over blink'); eq(t.env.getEl('cfsim-t').textContent, '-02:15');
    t.env.fire('document', 'click', { target: { closest: q => q === '[data-cfsim]' ? { dataset: { cfsim: 'flash' } } : null } });
    eq(t.env.getEl('cfsim-fl').hidden, false); eq(t.env.getEl('cfsim-flt').textContent, '5 MINUTOS');
    t.env.fire('document', 'click', { target: { closest: q => q === '[data-cfsim]' ? { dataset: { cfsim: 'ok' } } : null } });
    eq(t.env.getEl('cfsim-fl').hidden, true); eq(t.env.getEl('cfsim').className, 'cfsim lv-ok');
    ok(/el\.dataset\.sc === 'conf\.blinkSpeed' \? 'input' : 'change'/.test(D.src('control.js')), 'la velocidad se ve al momento, mientras se escribe');
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
  test('Gestor: rejilla de 7 columnas (dec. 137: ↺ por ventana), píldora con micro-LED, cabecera y pie; en móvil, tres filas; «+ Abrir» abre Manager', async () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/\.gv-row\{display:grid;grid-template-columns:minmax\(120px,1fr\) 118px 180px 150px 105px 32px 32px;grid-template-areas:"name vista zona fs sb rst x";gap:8px/.test(css), 'rejilla fija: nombre, vista, zona, pantalla, standby, ✕');
    ok(/\.modal-box\.wide\{max-width:min\(880px,94vw\)\}/.test(css), 'modal ancho: cabe la rejilla sin scroll');
    ok(/@media \(max-width:700px\)\{ \.gv-row\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) auto auto;grid-template-areas:"name name rst x" "vista zona sb sb" "fs fs fs fs"\}/.test(css), 'móvil: tres filas, sin scroll');
    ok(/\.gv-sb\{height:34px;[^}]*border-radius:999px/.test(css) && /\.gv-led\{/.test(css), 'standby como píldora con micro-LED');
    ok(/\.gv-sb\.on \.gv-led\{[^}]*box-shadow/.test(css), 'LED encendido con resplandor');
    ok(/\.gv-row select:hover,\.gv-row select:focus\{background-image:url/.test(css) && /background-image:url\("data:image\/svg\+xml,[^"]*6f747e/.test(css), 'flecha sutil en reposo, más brillante en hover y focus');
    ok(/\.gv-row input,\.gv-row select\{height:32px/.test(css) && /\.gv-sb\{height:34px/.test(css) && /\.gv-x\{width:32px;height:32px/.test(css), 'altura: 32px en campos y ✕, 34px en la píldora');
    ok(/class="gv-row gv-hd"/.test(js) && /tx\('Nombre'\)/.test(js) && /tx\('Standby'\)/.test(js) && /\.gv-hd\{display:none\}/.test(css), 'cabecera NOMBRE · VISTA · ZONA · STANDBY en escritorio; oculta en móvil');
    ok(/\.gv-row select:disabled\{[^}]*border-color:transparent;background-color:transparent/.test(css), 'zona sin usar: «—» plano, sin caja');
    ok(/\.gv-foot \.gv-close\{background:#1c1e26;border:1px solid var\(--hair2\);color:#fff\}/.test(css) && /class="btn gv-close" data-gv="done"/.test(js), 'Cerrar en gris Raycast, sin rojo');
    ok(/\.gv-qr\{margin-top:0;padding-top:0;border-top:0\}/.test(css) && !/dashed/.test(css.slice(css.indexOf('.gv-qr{'), css.indexOf('.gv-qr{')+200)), 'QR dentro de su tarjeta (dec. 110): sin línea ni marco de puntos');
    ok(/data-gv="all" data-on="1">' \+ tx\('⏸ Todas en standby'\)/.test(js) && /data-gv="all" data-on="0">' \+ tx\('▶ Reanudar todas'\)/.test(js), 'cabecera: todas en standby / reanudar');
    ok(/data-gv="new">' \+ tx\('\+ Abrir ventana Live'\)/.test(js) && /data-gv="done"/.test(js), 'pie: abrir a la izquierda, cerrar a la derecha');
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
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    eq(t.T.winState()[0].fs, undefined, 'sin dato hasta que la ventana avisa (se ve como Ventana)');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'manager', zona: null, standby: false, fs: true }, source: w });
    eq(t.T.winState()[0].fs, true, 'la ventana dice que está en pantalla completa');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'manager', zona: null, standby: false, fs: false }, source: w });
    eq(t.T.winState()[0].fs, false, 'y que ya no');
    ok(/x\.fs = !!m\.fs/.test(js), 'el Dashboard guarda fs al recibir vistaState');
    ok(/<span class="gv-fs" aria-live="polite"><\/span>/.test(js) && /'⛶ Pantalla completa' : 'Ventana'/.test(js), 'la fila muestra ⛶ Pantalla completa o Ventana');
    ok(/<span>' \+ tx\('Pantalla'\) \+ '<\/span>/.test(js), 'cabecera con la columna PANTALLA');
    ok(/\.gv-fs\.on::before\{[^}]*box-shadow/.test(css) && /\.gv-fs\{[^}]*color:var\(--dim/.test(css), 'iluminado si está en completa; atenuado si es Ventana');
    ok(/fs: !!\(document\.fullscreenElement \|\| document\.webkitFullscreenElement\)/.test(live), 'la Live lee su estado de pantalla completa en reportVista');
  });
  test('Botones: primario blanco, peligro rojo solo para borrar, secundarios neutros; Pantallas y Emisión sin rojo', () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/\.btn\.primary\{background:#fff;border-color:#fff;color:#000;font-weight:700/.test(css), 'primario: blanco sólido con texto negro');
    ok(/\.btn\.danger\{background:#d9363e;border-color:#d9363e;color:#fff/.test(css), 'peligro: #d9363e con texto blanco');
    ok(/^\.btn\{[^}]*background:#1c1e26;color:#fff/m.test(css), 'secundario: fondo #1c1e26');
    ok(/\.hubled\{[^}]*background:#4a4d57/.test(css) && /\.hubled\.on\{background:#10b981/.test(css) && !/\.hubled[^{]*\{[^}]*(#ff3b30|#d9363e|var\(--live\))/.test(css), 'LED: gris o verde, nunca rojo');
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
    ok(/\.seg button\.on,\.days button\.on,\.dtb\.on\{background:rgba\(255,255,255,\.12\)/.test(css), 'segmentos activos en gris elevado');
    ok(/\.mitem\.on\{color:#fff;font-weight:700\}/.test(css) && /\.mitem\.on::after\{background:#fff\}/.test(css), 'menús: seleccionado en blanco, sin rojo');
    ok(/\.mpanel \.days button\.on\{background:rgba\(255,255,255,\.08\);color:#fff/.test(css), 'Día: seleccionado en blanco');
    ok(/td input:focus,td select:focus,\.imp-src textarea:focus[^{]*\{border-color:rgba\(255,255,255,\.35\);box-shadow:0 0 0 1px rgba\(255,255,255,\.15\)\}/.test(css), 'foco de campos en blanco translúcido');
    ok(!/\.focusitem|\.fbox/.test(css), 'el antiguo interruptor de foco ya no existe (dec. 117)');
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
    ok(/spot-pill tp-' \+ b\.kind/.test(js) && /\.spot-pill\.tp-show\{--pc:#ff5d73\}/.test(css), 'bandas: píldora de tipo (SHOW, PRUEBA, TAREA, MARCADOR)');
    ok(/ic: 'i-clock'/.test(js) && /ic: 'i-out'/.test(js), 'vistas y acciones: icono a la izquierda');
    const t = dashboard(); t.env.fire('document', 'keydown', { key: 'k', metaKey: true, preventDefault() {} });
    const html = t.env.getEl('spot-list').innerHTML;
    ok(/class="spot-g">Vistas</.test(html) && /class="spot-g">Acciones</.test(html), 'encabezados Vistas y Acciones');
    ok(/<button type="button" class="spot-i[^"]*" data-i="0"><span class="spot-slot"><svg class="ic spot-ic" aria-hidden="true"><use href="#i-clock"\/>/.test(html) && html.indexOf('spot-slot') < html.indexOf('spot-t'), 'icono a la izquierda de cada vista');
    ok(/<kbd>⇧⌘F<\/kbd>/.test(html) && /<kbd>⌘S<\/kbd>/.test(html), 'atajos en una sola etiqueta <kbd>');
  });
  // ── Gestor de pantallas: telemetría de los dispositivos QR (dec. 103) ──
  test('Gestor: dos secciones (monitores locales y dispositivos por QR); lista viva con vista, zona y hace cuánto', () => {
    const now = Date.now(), t = dashboard();
    const T = t.env.win.ShowtimePanel._test;
    ['modal', 'addm', 'imp', 'cfg', 'drop'].forEach(id => { t.env.getEl(id).hidden = true; });
    const zid = t.F.s.escenarios[0].id;
    T.openGestor();
    let html = t.env.getEl('gv').innerHTML;
    ok(/Monitores locales \(HDMI \/ Mac\)/.test(html) && /Dispositivos remotos por QR \(en vivo\)/.test(html), 'las dos secciones');
    ok(/La emisión está parada/.test(t.env.getEl('gv-qrl').innerHTML), 'sin emisión lo dice');
    T.fakeEm({ push() {} }, { links: [], viewers: 3, remotes: 1, devices: [
      { id: 'aaaa1111', t: now - 3000, first: 1, r: 0, v: 'confidence', z: zid, d: 'movil' },
      { id: 'bbbb2222', t: now - 30000, first: 2, r: 0, v: 'backstage', d: 'tablet' },
      { id: 'cccc3333', t: now - 1000, first: 3, r: 1, v: 'mando', s: zid, d: 'movil' },
      { id: 'dddd4444', t: now - 2000, first: 4, r: 0, v: 'manager', p: 'prod_001', d: 'ordenador' },
      { id: 'eeee5555', t: now - 50000, first: 5, r: 0, v: 'manager', d: 'movil' } ] });
    T.openGestor();
    const rows = t.env.getEl('gv-qrl').innerHTML;
    ok(/Confidence · Principal/.test(rows), 'Confidence con su zona');
    ok(/Backstage/.test(rows) && /hace 30 s/.test(rows) && /gq-dot late/.test(rows), 'un latido perdido: punto ámbar');
    ok(/Stage Manager · mando · Principal/.test(rows), 'el mando de la zona');
    ok(/Producción · Marta/.test(rows), 'Producción con su nombre');
    ok(!/eeee/.test(rows), 'sin latido en 45 s: fuera de la lista');
    ok(rows.indexOf('cccc') < rows.indexOf('aaaa') && rows.indexOf('aaaa') < rows.indexOf('bbbb'), 'orden: mando, Manager/Confidence, Backstage');
    ok(/Tablet/.test(rows) && /Móvil/.test(rows), 'tipo de dispositivo');
    eq(t.env.getEl('gv-qrn').textContent, '4 conectados');
    T.fakeEm(null, null);
  });
  // ── Unidades del tiempo (dec. 107) ──
  test('Meteo › Unidades: selector Métrico / Imperial; umbrales y valores manuales en la unidad elegida, guardados en métrico', () => {
    const h = D.src('index.html');
    ok(/<select id="mt-units"><option value="metric">Métrico \(°C, km\/h, mm\)<\/option><option value="imperial">Imperial \(°F, mph, in\)<\/option><\/select>/.test(h), 'selector');
    ok(/data-th="gust"[^>]*> <span class="mt-u" data-u="wind">km\/h<\/span>/.test(h) && /data-th="heat"[^>]*> <span class="mt-u" data-u="temp">°C<\/span>/.test(h), 'unidad junto a cada umbral');
    const T = panel().T;
    eq(T.mtIn('wind', 50, 'imperial'), '31'); eq(T.mtIn('temp', 30, 'imperial'), '86'); eq(T.mtIn('rain', 2, 'imperial'), '0.08'); eq(T.mtIn('wind', 50, 'metric'), '50');
    eq(T.mtOut('wind', '31', 50, 'imperial'), 50, 'sin tocar: se queda el guardado (sin redondeos)');
    ok(Math.abs(T.mtOut('wind', '40', 50, 'imperial') - 64.37376) < 1e-6, '40 mph → km/h');
    ok(Math.abs(T.mtOut('temp', '100', null, 'imperial') - 37.7778) < 1e-3, '100 °F → °C');
    eq(T.mtOut('rain', '', 3, 'imperial'), null, 'vacío = sin umbral');
    eq(D.src('control.js').indexOf("' <b>' + mtNum(s.wind) + '</b> km/h") < 0, true, 'la tarjeta ya no lleva km/h fijo');
  });
  test('Gestor: el menú dice «Gestionar pantallas y ventanas…»', () => {
    ok(/Gestionar pantallas y ventanas…/.test(D.src('index.html')));
  });
  // ── «Solo hoy» (dec. 105) ──
  test('Solo hoy: a los QR viaja solo la jornada activa del Panel; «Cerrar jornada» la vacía y queda en el log', () => {
    const t = conMando(festDosDias());
    const T = t.T, s = T.emSnapshot(), day = T.emDay();
    eq(s.scope.day, day); eq(s.scope.closed, false); eq(s.config.day, day, 'la Live del QR se queda en ese día');
    ok(s.festival.artists.every(a => a.nombre !== 'Mañana'), 'el día siguiente no viaja');
    ok(s.festival.artists.some(a => a.nombre === 'Suena'));
    // Panel con otro día elegido: manda ese
    t.env.storage.set('showtime.config', JSON.stringify(Object.assign({}, t.read('showtime.config') || {}, { day: C.shiftDate(day, 1) })));
    eq(T.emSnapshot().festival.artists.map(a => a.nombre).join(), 'Mañana', 'la jornada elegida en el Panel');
    t.env.storage.set('showtime.config', JSON.stringify(Object.assign({}, t.read('showtime.config'), { day: 'all' })));
    T.emCloseDay(true);
    const c = T.emSnapshot();
    eq(c.scope.closed, true); eq(c.festival.artists.length, 0, 'cerrada: no viaja ninguna entrada');
    ok(t.log().some(e => /Jornada cerrada en los QR: /.test(e.text)), 'en el log');
    eq(JSON.parse(t.env.storage.get('showtime.emision') || '{}').closed, day, 'se recuerda al recargar');
    T.emCloseDay(false);
    eq(T.emSnapshot().festival.artists.length > 0, true, 'reabierta');
  });
  test('Solo hoy: el bloque de seguridad de la emisión enseña la jornada y Cerrar / Reabrir jornada (y Regenerar claves)', () => {
    const t = conMando(festDosDias());
    t.T.setRoom({ sala: 'ABCDEFGHIJKLMNOP' }); t.T.fakeEm({ push() {}, setZoneKeys: async () => {} }, { links: [{ name: 'A', state: 'on' }], viewers: 0, remotes: 0, devices: [] });
    t.T.renderCastBar();
    const sec = () => t.env.getEl('cast-sec').innerHTML;
    ok(/Los QR ven solo hoy/.test(sec()) && /data-act="cast-closeday" data-on="1"/.test(sec()), sec());
    ok(/data-act="cast-regen"[\s\S]*Regenerar claves de acceso…/.test(sec()), 'regenerar claves');
    ok(!/cast-closeday/.test(t.T.emStateHtml('staff', true)) && !/cast-closeday/.test(t.T.emStateHtml('staff')), 'no dentro del QR');
    t.T.emCloseDay(true);
    ok(/Jornada cerrada en los QR/.test(sec()) && /Reabrir jornada/.test(sec()));
    t.T.fakeEm(null, null);
  });
  // ── Centro de Pantallas y Emisión (dec. 109) ──
  test('Pantallas y Emisión: un botón con LED verde (emisión o Live abierta) o gris; panel con señales locales arriba y emisión QR abajo', () => {
    const html = D.src('index.html');
    const hub = html.slice(html.indexOf('id="m-hub"'), html.indexOf('<button id="wake"'));
    ok(/Pantallas y Emisión/.test(hub) && /id="hub-led" class="hubled"/.test(hub), 'botón con su LED');
    const b1 = hub.indexOf('id="hub-local"'), b2 = hub.indexOf('id="hub-qr"');
    ok(b1 > 0 && b2 > b1, 'pestaña 1 (HDMI) y pestaña 2 (QR), dec. 132');
    const loc = hub.slice(b1, b2);
    ok(/data-vista="manager"/.test(loc) && /id="lv-zone"/.test(loc) && /data-vista="confidence"/.test(loc) && /data-vista="backstage"/.test(loc), 'Manager · Confidence con zona · Backstage, cada una con Abrir');
    ok(/id="lv-standby"/.test(loc) && /id="lv-gestor"/.test(loc), 'Standby y gestor');
    const em = hub.slice(b2);
    ok(/id="cast-bar"/.test(em) && />Camerinos \/ Staff</.test(em) && /data-tab="remote"/.test(em) && /data-tab="produccion"/.test(em) && /id="cast-sec"/.test(em), 'barra de emisión, 3 pestañas y seguridad');
    ok(/\.mpanel\.hub\{[^}]*width:480px/.test(D.src('control.css')), 'panel de 480 px');
    const t = dashboard();
    eq(t.env.getEl('hub-led').classList.contains('on'), false, 'sin emisión ni Live: gris');
    t.env.win.ShowtimePanel._test.fakeEm({ push() {} }, { links: [], devices: [] }); t.env.win.ShowtimePanel._test.renderHubLed(0);
    eq(t.env.getEl('hub-led').classList.contains('on'), true, 'emitiendo: verde');
    t.env.win.ShowtimePanel._test.fakeEm(null, null); t.env.win.ShowtimePanel._test.renderHubLed(1);
    eq(t.env.getEl('hub-led').classList.contains('on'), true, 'una Live abierta: verde');
  });
  test('Acabado: cabeceras en gris pizarra (sin rojo) y bloques en tarjetas, igual en Configuración, Pantallas y Emisión y el gestor', () => {
    const css = D.src('control.css'), html = D.src('index.html'), js = D.src('control.js');
    ok(/\.cfg-s h3\{font-size:11px;letter-spacing:\.12em;text-transform:uppercase;font-weight:700;color:#8a8f98;margin:0\}/.test(css), 'Configuración: eyebrow gris pizarra');
    ok(!/\.cfg-s h3\{[^}]*var\(--accent\)/.test(css), 'sin el rojo del acento');
    ok(/\.hub-h,\.gv-sec\{font-size:11px;letter-spacing:\.12em;text-transform:uppercase;font-weight:700;color:#8a8f98/.test(css), 'misma cabecera en el panel y en el gestor');
    ok(/\.hub-card,\.gv-card\{background:rgba\(255,255,255,\.03\);border:1px solid rgba\(255,255,255,\.08\);border-radius:10px;padding:4px 6px;margin-bottom:12px\}/.test(css), 'tarjeta común');
    ok(/\.hub-list>\*\+\*\{border-top:1px solid var\(--hair\)\}/.test(css), 'separadores de 1 px entre filas');
    const hub = html.slice(html.indexOf('id="m-hub"'), html.indexOf('<button id="wake"'));
    eq((hub.match(/class="hub-card/g) || []).length, 3, 'tres tarjetas: pantallas HDMI, acciones locales y emisión');
    const c1 = hub.indexOf('hub-card hub-list"'), c2 = hub.indexOf('hub-card hub-list hub-acts"'), c3 = hub.indexOf('hub-card hub-cast"');
    ok(c1 > 0 && c2 > c1 && c3 > c2, 'en ese orden');
    ok(/data-vista="manager"[\s\S]*data-vista="backstage"/.test(hub.slice(c1, c2)) && /id="lv-gestor"[\s\S]*id="lv-standby"/.test(hub.slice(c2, c3)) && /id="cast-bar"[\s\S]*id="cast-net"[\s\S]*class="ctabs"[\s\S]*id="cast-sec"/.test(hub.slice(c3)), 'cada cosa en su tarjeta');
    ok(/box\.innerHTML = loc \+ '<div class="gv-card">' \+ head/.test(js) && /<div class="gv-card"><div id="gv-qrl"/.test(js), 'gestor: Monitores locales y Dispositivos QR en tarjetas');
  });
  test('Pantallas y Emisión: Confidence se abre con la zona del selector; la barra de emisión dice sala y dispositivos', async () => {
    const t = panel({ 'showtime.festival': JSON.stringify(festDosDias()) }, NOWc), urls = [];
    const w = { closed: false, focus() {}, postMessage() {}, close() {} };
    t.env.win.open = u => { urls.push(u); return w; };
    const K = JSON.parse(t.env.storage.get('showtime.festival')).escenarios[1].id;
    t.env.getEl('lv-zone').value = K;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista: 'confidence' } } : null } });
    await new Promise(r => setImmediate(r));
    eq(t.T.winState()[0].vista, 'confidence'); eq(t.T.winState()[0].zona, K, 'la zona elegida');
    t.T.renderCastBar();
    ok(/data-act="cast-start"/.test(t.env.getEl('cast-bar').innerHTML) && /Emisión detenida/.test(t.env.getEl('cast-bar').innerHTML), 'parada: botón Empezar');
    t.T.setRoom({ sala: 'abcdEFGHIJKLMNOP' });
    t.T.fakeEm({ push() {} }, { links: [{ name: 'A', state: 'on' }], devices: [{ id: 'x', t: Date.now(), first: 1, r: 0, v: 'backstage' }, { id: 'y', t: Date.now(), first: 2, r: 0, v: 'manager' }] });
    t.T.renderCastBar();
    const bar = t.env.getEl('cast-bar').innerHTML;
    ok(/En directo/.test(bar) && /Sala ABCD/.test(bar) && /2 dispositivos conectados/.test(bar) && /data-act="cast-stop"/.test(bar), bar);
    t.T.fakeEm(null, null);
  });
  test('⇧⌘C: alterna Studio ↔ Stage (Modo Stage · Alto Contraste); queda en Configuración, en la ayuda y en ⌘K', () => {
    const t = dashboard();
    ok(/if \(Dt\.normStyle\(v\) === 'stage'\) document\.body\.setAttribute\('data-ps', 'stage'\); else document\.body\.removeAttribute\('data-ps'\)/.test(D.src('control.js')), 'Studio = sin atributo (es la base del CSS)');
    t.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    eq(t.read('showtime.panel.style'), 'stage', 'pasa a Stage');
    eq(t.env.getEl('toast').textContent, 'Modo Stage (Alto Contraste)', 'avisa');
    eq(t.env.getEl('cfg-style-panel').value, 'stage');
    t.env.fire('document', 'keydown', { key: 'c', ctrlKey: true, shiftKey: true, preventDefault() {} });
    eq(t.read('showtime.panel.style'), 'studio', 'otra vez: Studio'); eq(t.env.getEl('cfg-style-panel').value, 'studio');
    eq(t.env.getEl('toast').textContent, 'Modo Studio');
    // Migración automática de lo guardado con la versión anterior
    [['"clasico"', 'studio'], ['"neutro"', 'studio'], ['"raycast"', 'studio'], ['"escenario"', 'stage'], ['"basura"', 'studio']].forEach(([v, want]) => {
      const m = dashboard({ 'showtime.panel.style': v });
      m.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
      eq(m.read('showtime.panel.style'), want === 'stage' ? 'studio' : 'stage', v + ' se lee como ' + want);
    });
    const js = D.src('control.js');
    ok(/<dt><kbd>⇧<\/kbd> <kbd>⌘<\/kbd> <kbd>C<\/kbd><\/dt><dd>' \+ tx\('Modo Stage \(Alto Contraste\): alterna Studio y Stage al instante'\) \+ '<\/dd>/.test(js), 'en la ayuda');
    ok(/label: 'Modo Stage \(Alto Contraste\)', ic: 'i-sun', kbd: '⇧⌘C'/.test(js), 'en ⌘K');
    ok(js.indexOf('panel.style.prev') < 0 || /removeItem\('showtime\.panel\.style\.prev'\)/.test(js), 'sin «tema anterior» (solo hay dos)');
    const en = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    en.env.fire('document', 'keydown', { key: 'C', metaKey: true, shiftKey: true, preventDefault() {} });
    eq(en.env.getEl('toast').textContent, 'Stage Mode (High Contrast)');
  });
  test('Modales en tarjetas (dec. 111): Evento (2), Hoja de ruta (3) y Pegar horario (opciones y columnas), sin tocar ningún id', () => {
    const css = D.src('control.css'), js = D.src('control.js'), html = D.src('index.html');
    ok(/\.mcard\{background:rgba\(255,255,255,\.03\);border:1px solid rgba\(255,255,255,\.08\);border-radius:10px;padding:12px;margin-bottom:12px\}/.test(css), 'tarjeta');
    ok(/\.mcard-h\{font-size:11px;letter-spacing:\.12em;text-transform:uppercase;font-weight:700;color:#8a8f98/.test(css), 'cabecera gris pizarra');
    // Evento: Datos generales (nombre, jornadas, corte) y Tiempos de escenario (CALL y changeover con sus notas)
    const ff = js.slice(js.indexOf('function festForm('), js.indexOf('function readFestForm('));
    const a = ff.indexOf("tx('Datos generales')"), b = ff.indexOf("tx('Tiempos de escenario')");
    ok(a > 0 && b > a, 'dos tarjetas en orden');
    ['f-nombre', 'f-ini', 'f-fin', 'f-cut'].forEach(id => ok(ff.indexOf('id="' + id + '"') > a && ff.indexOf('id="' + id + '"') < b, id + ' en Datos generales'));
    ['f-call', 'f-comin'].forEach(id => ok(ff.indexOf('id="' + id + '"') > b, id + ' en Tiempos de escenario'));
    ok(ff.indexOf('Lo mínimo para cambiar de banda') > b, 'las notas dentro de su tarjeta');
    const t = panel(); t.env.fire('btn-new2', 'click', {});
    ok(/class="mcard"[\s\S]*Datos generales[\s\S]*id="f-nombre"[\s\S]*Tiempos de escenario[\s\S]*id="f-call"/.test(ultimo(t, 'modal-body')), 'Nuevo evento con las dos tarjetas');
    // Hoja de ruta: Formato y ámbito · Contenido · Opciones de salida
    const pr = js.slice(js.indexOf("const html = '<div class=\"dw pr\">'"), js.indexOf("modal('Hoja de ruta'"));
    const p1 = pr.indexOf("tx('Formato y ámbito')"), p2 = pr.indexOf("tx('Contenido')"), p3 = pr.indexOf("tx('Opciones de salida')");
    ok(p1 > 0 && p2 > p1 && p3 > p2, 'tres tarjetas en orden');
    ok(pr.indexOf('id="pr-fmt"') > p1 && pr.indexOf('id="pr-day"') < p2 && pr.indexOf('id="pr-zone"') < p2, 'formato, jornada y zona');
    ok(pr.indexOf('id="pr-kinds"') > p2 && pr.indexOf('id="pr-kinds"') < p3 && pr.indexOf('data-q="show"') < p3, 'tipos y Todos / Solo Shows');
    ok(pr.indexOf('id="pr-orient"') > p3 && pr.indexOf('id="pr-call"') > p3 && pr.indexOf('id="pr-notes"') > p3, 'orientación, CALL y notas');
    // Pegar horario
    ok(/class="mcard imp-card"><div class="mcard-h">Opciones de importación<\/div>\s*<div class="imp-opts">[\s\S]*id="imp-new"[\s\S]*class="mcard imp-card imp-mapcard"><div class="mcard-h">Columnas del archivo<\/div><div id="imp-map"/.test(html), 'opciones y columnas en tarjetas');
    ok(/\.imp-mapcard:has\(\.imp-map:empty\)\{display:none\}/.test(css), 'sin tabla, la tarjeta de columnas no sale');
  });
  test('Studio y Stage: dos modos, nada más (sin rastro de clasico, neutro, raycast ni escenario en el motor)', () => {
    const html = D.src('index.html');
    eq((html.match(/<option value="studio">Studio<\/option><option value="stage">Stage<\/option>/g) || []).length, 2, 'Dashboard y Live: solo Studio y Stage');
    ['control.css', 'live.css', 'control.js', 'live.js', 'datos.js', 'index.html'].forEach(f => {
      const s = D.src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      ok(!/data-(ps|lv)="(clasico|neutro|raycast|escenario)"|'(clasico|neutro|raycast)'|"(clasico|neutro|raycast)"/.test(s), f + ': queda un tema antiguo');
    });
    const css = D.src('control.css'), live = D.src('live.css');
    ok(/:root\{[^}]*--bg:#000; --bg2:#08090b; --panel:#0d0e11/.test(css), 'Dashboard: la base (:root) es Studio');
    ok(/:root\{[^}]*--bg:#000; --bg2:#000; --panel:#0d0e11/.test(live), 'Live: la base (:root) es Studio');
    ok(/--dim:#8a8f98/.test(css) && /--dim:#8a8f98/.test(live), 'gris pizarra en los dos');
    ok(!/#m-live/.test(css), 'sin reglas del botón Live antiguo');
    const sel = (s, a) => (s.match(new RegExp('\\[data-' + a + '="([a-z]+)"\\]', 'g')) || []).map(x => x.replace(/.*="|"\]/g, ''));
    eq([...new Set(sel(css, 'ps'))].join(), 'stage', 'Dashboard: el único modificador es Stage');
    eq([...new Set(sel(live, 'lv'))].join(), 'stage', 'Live: el único modificador es Stage');
  });
  test('Modo Foco: micro-píldora del tipo (SHOW · SOUNDCHECK · TAREA · MARCADOR) con color fijo, en vez del cuadradito de color', () => {
    const P = panel().T.tipoPill;
    eq(P('show'), '<span class="tpill tp-show" aria-hidden="true">SHOW</span>');
    ok(/>SOUNDCHECK</.test(P('sc')) && />TAREA</.test(P('tarea')) && />MARCADOR</.test(P('hito')));
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
    ok(alpha(/:root\{--glass-bg:rgba\(\d+,\d+,\d+,(\.\d+)\)/) >= 0.88, 'velo denso (Studio): sin desenfoque tampoco se leen las letras de detrás');
    ok(/body\[data-ps="stage"\]\{--glass-bg:#000;/.test(css), 'Stage: negro');
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
    ok(/'<button class="gapbtn sb" data-act="standby" data-on="0" title="' \+ tx\('STANDBY · \{n\} min\. Pulsa para volver a CHANGEOVER', \{ n: co\.mins \}\) \+ '"><svg class="ic"><use href="#i-pause"\/><\/svg>SB<\/button>'/.test(src));
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
  /** festMando + otra zona («Carpa», con «Lejos») y una banda al día siguiente («Mañana»). */
  function festDosDias() {
    let s = festMando();
    const j = C.jornadaOfAbs(s, nAbs), m = C.shiftDate(j, 1), hm = x => C.fmtHM(((x % 1440) + 1440) % 1440);
    s = C.updateEvent(s, { fechaFin: m }).state;
    s = C.addStage(s, 'Carpa').state;
    const P = s.escenarios[0].id, K = s.escenarios[1].id;
    for (const a of [{ jornada: j, nombre: 'Lejos', escenarioId: K, inicio: hm(nAbs + 60), fin: hm(nAbs + 120) }, { jornada: m, nombre: 'Mañana', escenarioId: P, inicio: '21:00', fin: '22:00' }]) {
      const r = C.addArtist(s, 'show', a); if (!r.ok) throw new Error(r.error); s = r.state;
    }
    return s;
  }
  function conMando(F) {
    const t = panel(F === null ? {} : { 'showtime.festival': JSON.stringify(F || festMando()) }, NOWc);
    const cmd = (op, args, t0) => t.T.emCommand({ id: 'x', op, args: args || {}, t: t0 === undefined ? NOWc : t0 });
    const blk = name => C.buildBlocks(t.read('showtime.festival'), { mode: 'all', day: 'all', now: nAbs }).find(b => b.name === name);
    const log = () => ((t.read('showtime.log') || {}).entries || []);
    return Object.assign(t, { cmd, blk, log });
  }
  // ── Mandos por zona (dec. 102) y chat en el mando (dec. 104) ──
  test('Mando de zona › solo toca su zona: ▶/■, retrasos y Confidence; lo de otra zona se rechaza sin tocar nada', async () => {
    const F = festDosDias(), t = conMando(F), K = F.escenarios[1].id, P = F.escenarios[0].id;
    const zc = (op, args) => t.T.emCommand({ id: 'x' + Math.random(), op, args: args || {}, t: NOWc, _z: K });
    const antes = t.env.storage.get('showtime.festival');
    let r = await zc('stop', { key: t.blk('Suena').key });
    ok(!r.ok && /solo de su zona/.test(r.msg), 'Suena es de Principal: ' + r.msg);
    r = await zc('delay', { minutes: 5, zones: 'all', from: nAbs, stamp: 'x' });
    ok(!r.ok && /solo de su zona/.test(r.msg), 'retraso a todas: no');
    r = await zc('delay', { minutes: 5, zones: [P], from: nAbs, stamp: 'x' });
    ok(!r.ok && /solo de su zona/.test(r.msg), 'retraso a otra zona: no');
    r = await zc('flash', { text: 'HOLA', to: null, zones: null });
    ok(!r.ok, 'mensaje a todas las Confidence: no');
    eq(t.env.storage.get('showtime.festival'), antes, 'el evento no cambia');
    r = await zc('flash', { text: 'HOLA', to: ['backstage'], zones: null });
    ok(r.ok, 'a Backstage sí (es de todos)');
    r = await zc('flash', { text: 'CARPA', to: ['confidence'], zones: [K] });
    ok(r.ok, 'a la Confidence de su zona sí');
    r = await zc('start', { key: t.blk('Lejos').key });
    ok(r.ok, 'su banda: ' + r.msg);
    ok(t.log().some(e => /Desde el mando del Stage Manager \(Carpa\)|mando/.test(JSON.stringify(e))), 'queda en el log');
    r = await t.T.emCommand({ id: 'zz', op: 'flashOff', args: {}, t: NOWc, _z: 'inventada' });
    ok(!r.ok && /ya no existe/.test(r.msg), 'zona borrada: no obedece');
    ok((await t.cmd('stop', { key: t.blk('Suena').key })).ok, 'el mando general sigue pudiendo con todo');
  });
  // ── Origen de mensajes y avisos (dec. 106) ──
  test('Origen: el mensaje de un mando de zona sale como «[Zona]»; los de Producción, «[Producción]»; el log guarda quién fue', async () => {
    const F = festDosDias(), K = F.escenarios[1].id, t = dashboard({ 'showtime.festival': JSON.stringify(F) }, NOWc);
    ['modal', 'addm', 'imp', 'cfg', 'drop'].forEach(id => { t.env.getEl(id).hidden = true; });
    t.T = t.env.win.ShowtimePanel._test; t.log = () => ((t.read('showtime.log') || {}).entries || []);
    let r = await t.T.emCommand({ id: 'f1', op: 'flash', args: { text: '5 MINUTOS', to: ['confidence'], zones: [K] }, t: NOWc, _z: K });
    ok(r.ok);
    eq(JSON.stringify(t.read('showtime.flash').by), JSON.stringify({ k: 'zone', n: 'Carpa' }));
    ok(/\[Carpa\]/.test(t.env.getEl('v-msg').innerHTML), 'tarjeta del Dashboard con la etiqueta');
    r = await t.T.emCommand({ id: 'f2', op: 'flash', args: { text: 'GENERAL', to: null, zones: null }, t: NOWc });
    eq(t.read('showtime.flash').by, null, 'mando general: sin etiqueta');
    t.prod({ type: 'flash', from: 'prod_001', text: 'Prensa en foso', to: ['backstage'] });
    eq(JSON.stringify(t.read('showtime.flash').by), JSON.stringify({ k: 'prod' }), 'Producción: voz colectiva');
    t.prod({ type: 'aviso', from: 'prod_002', text: 'Catering abierto', perm: true });
    const av = t.read('showtime.avisos').find(a => a.text === 'Catering abierto');
    eq(JSON.stringify(av.by), JSON.stringify({ k: 'prod' })); eq(av.from, 'Producción (Luis)', 'la ✕ y el log saben quién fue');
    ok(/<b class="byl">\[Producción\]<\/b> Catering abierto/.test(t.env.getEl('drift').innerHTML), 'chip del Dashboard');
    ok(t.log().some(e => /Catering abierto.*Producción \(Luis\)/.test(e.text)), 'el log con el nombre');
  });
  test('Mando de zona › chat firmado «[Zona] Nombre» en el hilo de Producción; sin nombre, «[Zona] Stage Manager»', async () => {
    const F = festDosDias(), t = conMando(F), K = F.escenarios[1].id;
    let r = await t.T.emCommand({ id: 'c1', op: 'chat', args: { text: 'Necesito pinza en monitores', name: 'Ana' }, t: NOWc, _z: K });
    ok(r.ok);
    r = await t.T.emCommand({ id: 'c2', op: 'chat', args: { text: 'Listos' }, t: NOWc, _z: K });
    r = await t.T.emCommand({ id: 'c3', op: 'chat', args: { text: 'General', name: 'Luis' }, t: NOWc });
    const chat = t.read('showtime.chat');
    eq(chat.map(m => m.from).join(' | '), '[Carpa] Ana | [Carpa] Stage Manager | [Stage Manager] Luis');
    eq(chat[0].sm, false); eq(chat[0].pid, 'mando:' + K);
    ok(/\[Carpa\] Ana/.test(t.env.getEl('chat-list').innerHTML), 'se ve en el chat del Panel');
    ok((await t.T.emCommand({ id: 'c4', op: 'chatsync', args: {}, t: NOWc, _z: K })).ok);
    ok(!(await t.T.emCommand({ id: 'c5', op: 'chat', args: { text: ' ' }, t: NOWc })).ok, 'vacío: no');
  });
  test('Emisión › Stage Manager: con varias zonas, un QR por zona (remote.html?stage=…) con su propia clave', async () => {
    const F = festDosDias(), t = conMando(F), K = F.escenarios[1].id;
    t.T.setRoom(await E.newRoom());
    t.T.fakeEm({ push() {}, setZoneKeys: async () => {} }, { links: [], viewers: 0, remotes: 0, devices: [] });
    eq(t.T.rmZones().length, 2);
    t.T.setRmZone(K);
    const url = t.T.emUrl('remote'), p = E.parseHash(url.slice(url.indexOf('#'))), room = t.T.room();
    ok(url.indexOf('remote.html?stage=' + K + '&') > 0, url);
    eq(p.z, K); eq(p.c, room.cz[K]); ok(room.cz[K] !== room.c, 'clave propia'); eq(p.q, room.q, 'chat de Producción');
    t.T.setRmZone(null);
    const g = t.T.emUrl('remote');
    ok(g.indexOf('stage=') < 0 && E.parseHash(g.slice(g.indexOf('#'))).c === room.c, 'el general sigue igual');
    t.T.fakeEm(null, null);
  });
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

  // ── Idioma, Fase 1: todo el Panel de Control traducido (index.html + control.js) ──────────────
  /** Textos que el HTML marca para traducir: data-i18n sin valor (cada trozo de texto propio) y -title/-placeholder/-aria sin valor. */
  function htmlI18nTexts(h) {
    const out = [], VOID = /^(input|br|meta|link|img|source|hr|wbr|col)$/;
    const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    const ent = x => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#10;/g, '\n');
    let m;
    while ((m = tagRe.exec(h))) {
      if (m[1]) continue;
      const attrs = m[3];
      [['title', 'title'], ['placeholder', 'placeholder'], ['aria', 'aria-label']].forEach(([d, a]) => {
        if (new RegExp(' data-i18n-' + d + '(?=[\\s/>]|$)').test(attrs)) { const v = new RegExp(' ' + a + '="([^"]*)"').exec(attrs); if (v && v[1].trim()) out.push(ent(v[1])); }
      });
      if (!/ data-i18n(?=[\s/>]|$)/.test(attrs)) continue;
      // trozos de texto propios del elemento (no los de sus hijos)
      let d = 0, j = tagRe.lastIndex; const re2 = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g; re2.lastIndex = j; let k;
      while ((k = re2.exec(h))) {
        if (!d) { const t = ent(h.slice(j, k.index)).replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
        if (k[1]) { if (!d) break; d--; } else if (!VOID.test(k[2]) && !/\/$/.test(k[3])) d++;
        j = re2.lastIndex;
      }
    }
    return out;
  }
  test('Idioma (Fase 1): todo texto marcado en index.html tiene traducción al inglés', () => {
    const I = require('../i18n.js'), h = srcRaw('index.html');
    const list = htmlI18nTexts(h);
    ok(list.length > 250, 'hay ' + list.length + ' textos marcados');
    const miss = list.filter(x => /[A-Za-zÁÉÍÓÚáéíóúÑñ]{2}/.test(x) && !I.txHas(x) && !/^(Live|OK|CALL|Showtime|Manager|Confidence|Backstage|Staff|SC|Raycast)$/.test(x));
    eq(miss.join(' | '), '', 'sin traducción');
    ok(/<span class="mlbl" data-i18n>Ver:<\/span>/.test(h) && /<h2 id="imp-title" data-i18n><svg class="ic"><use href="#i-bolt"\/><\/svg>Pegar horario completo/.test(h), 'directivas sin valor: el español es la clave');
  });
  test('Idioma (Fase 1): lo que reescribe el JS no lleva data-i18n (la traducción la pone control.js)', () => {
    const h = srcRaw('index.html'), js = D.src('control.js');
    const ids = new Set(); let m; const re = /\$\('([\w-]+)'\)\.(textContent|innerHTML)\s*=/g;
    while ((m = re.exec(js))) ids.add(m[1]);
    ids.forEach(id => { const tag = new RegExp('<[^>]*\\bid="' + id + '"[^>]*>').exec(h); ok(!tag || !/ data-i18n(?:-html)?(?=[\s>])/.test(tag[0]), '#' + id + ' lo escribe el JS'); });
    ['fest-name', 'clock', 'imp-go', 'btn-lang'].forEach(id => ok(ids.has(id) || id === 'btn-lang', id));
  });
  test('Idioma (Fase 1): todo texto fijo de control.js (tx, avisos, ventanas, botones, Deshacer) tiene traducción', () => {
    const I = require('../i18n.js');
    const js = D.src('control.js').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
function args(s, i) {   // s[i] es '(' → argumentos de nivel superior (texto)
  let d = 0, q = null, cur = ''; const out = [];
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (q) { cur += c; if (c === '\\') { cur += s[++j]; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    if (c === ')' || c === ']' || c === '}') { if (!d) { out.push(cur); return out; } d--; }
    if (c === ',' && !d) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return out;
}
/** Literales «sueltos» (también los dos lados de un ?: y el primero de [plantilla, vars]); no los comparados con === ni los concatenados. */
function lits(a) {
  if (/^\s*'(?:[^'\\]|\\.)*'\s*\+/.test(a) || /\+\s*'(?:[^'\\]|\\.)*'\s*$/.test(a)) return [];
  const out = []; let d = 0, br = [];
  const re = /'((?:[^'\\]|\\.)*)'|[(\[{]|[)\]}]/g; let m;
  while ((m = re.exec(a))) {
    const c = m[0];
    if (c === '(' || c === '[' || c === '{') { d++; br.push(c === '[' ? m.index : -1); }
    else if (c === ')' || c === ']' || c === '}') { d--; br.pop(); }
    else {
      const before = a.slice(0, m.index);
      if (/[!=]==\s*$/.test(before)) continue;
      if (!d || (d === 1 && br[0] >= 0 && /\[\s*(?:[^'\[\]]*\?\s*)?$/.test(before.slice(br[0])))) out.push(m[1].replace(/\\'/g, "'"));
    }
  }
  return out;
}
const found = new Set();
const re = /\b(tx|toast|modal|commitFestival|loadNew|stageCommit)\(/g; let m;
while ((m = re.exec(js))) {
  const a = args(js, m.index + m[0].length - 1), x = /^(tx|toast|modal)$/.test(m[1]) ? a[0] : a[1];
  if (x === undefined || (m[1] !== 'tx' && /^\s*tx\(/.test(x))) continue;
  lits(x).forEach(l => { if (/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(l)) found.add(l); });
}
const lab = /label: '((?:[^'\\]|\\.)*)'/g;
while ((m = lab.exec(js))) found.add(m[1]);
const miss = [...found].filter(k => !I.txHas(k) && !/^(OK|CALL|SC|Live|Raycast|Stage Manager|Staff)$/.test(k));
    ok(found.size > 450, found.size + ' textos');
    eq(miss.join(' | '), '', 'sin traducción');
  });
  test('Idioma (Fase 1): en inglés el Panel se pinta en inglés al momento; en español, idéntico al de siempre', () => {
    const es = dashboard(), en = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    [es, en].forEach(t => t.env.fire('btn-paste', 'click', {}));
    eq(es.env.getEl('imp-go').textContent, 'Importar', 'español'); eq(es.env.getEl('imp-go').title, 'Importar: 0 filas');
    eq(en.env.getEl('imp-go').textContent, 'Import', 'inglés'); eq(en.env.getEl('imp-go').title, 'Import: 0 rows');
    eq(en.env.getEl('imp-kind').textContent, 'Waiting for a schedule…');
    eq(es.env.getEl('imp-kind').textContent, 'Esperando horario…');
    // cambio en caliente: el aviso y lo que pinta el JS pasan al otro idioma sin recargar
    es.env.fire('btn-lang', 'click', {});
    eq(es.env.getEl('imp-go').textContent, 'Import', 'se repinta al cambiar a inglés'); eq(es.env.getEl('imp-go').title, 'Import: 0 rows');
    eq(es.env.getEl('toast').textContent, 'Language: English');
    es.env.fire('btn-lang', 'click', {});
    eq(es.env.getEl('imp-go').textContent, 'Importar', 'y vuelve al español');
  });
  test('Idioma (Fase 1): Deshacer y log siempre en español; el aviso, en el idioma del Panel', () => {
    const t = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    const r = t.env.win.ShowtimePanel._test.importSummary([{ tipo: 'show', jornada: 'x' }, { tipo: 'sc', jornada: 'x' }], 2);
    eq(r, '✓ 2 entries imported successfully (1 show · 1 soundcheck)');
    const js = D.src('control.js');
    ok(/msg = obj \? msg0\.es : mm\[0\] \? txEs\(mm\[0\], mm\[1\]\)/.test(js), 'Deshacer y log: txEs (español)');
    ok(/const msg = \{ es: impMsg\(txEs\), ui: impMsg\(tx\) \}/.test(js), 'importar: {es, ui}');
    ok(/sendFlash\(tx\(b\.dataset\.msg\)\)/.test(js), 'los mensajes rápidos salen en el idioma del Panel');
  });

  test('Idioma (Fase 4): errores de core.js y avisos del importador se enseñan en el idioma del Panel (txBack); el aviso también', () => {
    const js = D.src('control.js');
    ok(/const back = s => I18 && I18\.txBack \? I18\.txBack\(s\) : s;/.test(js), 'helper back()');
    ok((js.match(/textContent = back\((r|z)\.error\)/g) || []).length >= 6, 'errores de los formularios');
    ok(/r\.errs\.map\(x => '<div class="e">' \+ esc\(back\(x\)\)/.test(js) && /r\.warns\.map\(x => '<div>' \+ esc\(back\(x\)\)/.test(js), 'avisos de las filas al importar');
    ok(/r\.errors\.map\(e => esc\(back\(e\)\)\)/.test(js) && /esc\(back\(w\)\)/.test(js), 'abrir un .json: errores y avisos');
    ok(/t\.textContent = I18 && I18\.txBack \? I18\.txBack\(msg\) : tx\(msg\);/.test(js), 'el aviso (toast) pasa por txBack');
    const t = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    t.env.fire('btn-paste', 'click', {});
    eq(t.env.getEl('imp-go').textContent, 'Import');
  });

  test('Dec. 112: inputs/selects sin shorthand «background:» (no resetea repeat/size → sin mosaico de flechas); flechas blindadas', () => {
    const css = D.src('control.css');
    const bad = css.split('\n').filter(l => { const m = l.match(/^\s*([^{@]*)\{(.*)$/); return m && /\b(select|input)\b/.test(m[1]) && /(^|[;{])background:/.test(m[2]); });
    eq(bad.length, 0, 'reglas con background: en controles → ' + bad.join(' | ').slice(0, 300));
    ok(/\.gv-row select,#modal-body select,\.modal-box select,\.cfg select,\.imp-box select\{background-repeat:no-repeat!important;background-position:right 9px center!important;background-size:9px 6px!important\}/.test(css), 'gestor y modales: right 9px');
    ok(/#tbl tbody td select,td select\{background-repeat:no-repeat!important;[^}]*background-size:9px 6px!important\}/.test(css), 'tabla: no-repeat y 9×6');
    ok(/body\[data-ps="stage"\] \.gv-row select:disabled\{[^}]*background-image:none/.test(css), 'select deshabilitado sin flecha');
  });

  test('Dec. 112: Stage de alto contraste — tarjetas, textos críticos, controles y píldoras', () => {
    const css = D.src('control.css');
    ok(/body\[data-ps="stage"\] \.mcard,body\[data-ps="stage"\] \.hub-card,body\[data-ps="stage"\] \.gv-card,body\[data-ps="stage"\] \.imp-card,body\[data-ps="stage"\] \.card\{background-color:#0d0c04;border:1\.5px solid #FFD600;border-radius:10px\}/.test(css), 'tarjetas');
    ok(/body\[data-ps="stage"\] td\.name,[^{]*td\.t input,[^{]*td\.est \.estt[^{]*\{color:#fff;font-weight:700\}/.test(css), 'nombres y horas en blanco 700');
    ok(/body\[data-ps="stage"\] thead th\{color:#fff;font-weight:700\}/.test(css) && /body\[data-ps="stage"\] thead th\.est-h\{color:#FFD600\}/.test(css), 'cabeceras blancas, REAL amarilla');
    ok(/body\[data-ps="stage"\] select,[^{]*\.gv-row select\{background-color:#000;border:1\.5px solid rgba\(255,214,0,\.7\);color:#fff;font-weight:600\}/.test(css), 'controles');
    ok(/body\[data-ps="stage"\] \.tpill\{background:#000;border:1\.5px solid var\(--pc\)/.test(css), 'píldoras');
    const tail = css.slice(css.indexOf('Dec. 112 · Modo Stage'));
    ok(!/#8a8f98/i.test(tail), 'sin gris apagado en el bloque Stage');
    ok(!/body\[data-ps="stage"\] \.mcard\{background:#000/.test(css), 'regla antigua de .mcard eliminada');
  });

  test('Dec. 113: filas pasadas atenuadas, pero el aviso «pisada por» queda al 100 % en rojo #ff5252 y negrita (Studio y Stage)', () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/tbody tr\.done td:not\(\.gap\):not\(\.est\)\{opacity:\.5\}/.test(css), 'la celda REAL no se atenúa entera (la opacidad del padre no se deshace en el hijo)');
    ok(/tbody tr\.done td\.est>\*\{opacity:\.5\}/.test(css), 'el resto de REAL sí se atenúa');
    ok(/tbody tr\.done td\.est>small\.clash,tbody tr\.done td\.est>\.estt:has\(\.clash\)\{opacity:1\}/.test(css), 'aviso y horas en choque al 100 %');
    ok(/td\.est small\.clash,body\[data-ps="stage"\] td\.est small\.clash\{color:#ff5252;font-weight:800\}/.test(css), 'rojo brillante también en Stage (gana al amarillo de td.est small)');
    ok(/'<small class="clash">' \+ tx\('pisada por \{who\}'/.test(js), 'el aviso sigue en small.clash');
  });

  test('Dec. 115: transporte de la emisión — nube por defecto (sin cambios) o red local Wi-Fi (QR con la IP del Mac y repetidor en localhost)', () => {
    const t = dashboard(), T = t.env.win.ShowtimePanel._test;
    const room = { sala: 'ABCDEFGHIJKLMNOP', k: 'AAAAAAAAAAAAAAAAAAAAAA', p: 'BBBBBBBBBBBBBBBBBBBBBB', c: 'CCCCCCCCCCCCCCCCCCCCCC', q: 'DDDDDDDDDDDDDDDDDDDDDD' };
    T.setRoom(room);
    eq(T.net().mode, 'cloud', 'por defecto, nube'); eq(T.emBrokers(), undefined, 'nube: los repetidores de siempre');
    const nube = T.emUrl('staff'); ok(!/&l=/.test(nube) && !/192\.168/.test(nube), 'nube: QR de siempre ' + nube);
    eq(T.emLink('https://x/live.html#a'), 'https://x/live.html#a');
    ok(/data-net="mode"/.test(T.netHtml()) && !/data-net="host"/.test(T.netHtml()), 'nube: solo el selector');
    ok(/Nube \(Internet · por defecto\)/.test(T.netHtml()) && /Red Local Wi-Fi \(0 internet\)/.test(T.netHtml()));
    T.setNet({ mode: 'local', host: '192.168.1.45', port: 8765 });
    eq(T.emBrokers()[0].url, 'ws://localhost:8765/mqtt', 'el Dashboard habla con el servidor de su Mac');
    ['staff', 'remote', 'produccion'].forEach(k => { const u = T.emUrl(k); ok(u.indexOf('http://192.168.1.45:8765/') === 0 && /&l=192\.168\.1\.45:8765$/.test(u), k + ': ' + u); });
    ok(/data-net="host"[^>]*value="192\.168\.1\.45"/.test(T.netHtml()) && /data-net="port"/.test(T.netHtml()) && /data-net="detect"/.test(T.netHtml()), 'local: IP, puerto y Detectar');
    const bad = T.netNorm({ mode: 'local', host: 'mal host', port: 99999 }); eq(bad.host, ''); eq(bad.port, 8765, 'valores raros → por defecto');
    eq(T.netNorm({ mode: 'xx' }).mode, 'cloud');
    // Red local sin IP: no se enseña un QR que no lleva a ningún sitio
    T.setNet({ mode: 'local', host: '', port: 8765 }); T.fakeEm({ push() {}, setZoneKeys: async () => {} }, { links: [{ name: 'Red local', state: 'on' }], viewers: 0, remotes: 0, devices: [] });
    T.renderCast();
    ok(/falta la IP del Mac/.test(t.env.getEl('cast-staff').innerHTML), 'aviso en vez de QR');
    T.fakeEm(null, null);
    const html = D.src('index.html');
    ok(/<div class="hub-card hub-cast">\s*<div id="cast-bar" class="cast-bar"><\/div>\s*<div id="cast-net"/.test(html), 'selector en el Hub (bajo Empezar / Parar, dec. 132)'); ok(/id="cfg-s-net"[\s\S]*?id="cfg-net"/.test(html), 'y en Configuración › Emisión');
    const js = D.src('control.js');
    ok(/brokers: emBrokers\(\)/.test(js), 'el Emisor usa el transporte elegido');
    ok((js.match(/emLink\(Em\.(staff|remote|production)Url\(/g) || []).length === 5 && !/[^(]Em\.(staff|remote|production)Url\(/.test(js.replace(/emLink\(Em\./g, '')), 'todos los QR pasan por emLink');
    ok(/fetch\('http:\/\/localhost:' \+ NET\.port \+ '\/showtime-local\.json'/.test(js), 'detecta el servidor y su IP');
  });

  test('Dec. 116: Ver ▾ Tareas y Marcadores filtran SOLO la tabla; En escena, Siguiente y CALL siguen con la jornada completa', () => {
    let s = festEn(NOWc, add => { add('Suena', -30, 30); add('Viene', 10, 80); });   // CALL de Viene ya activo
    const j = C.jornadaOfAbs(s, nAbs), P = s.escenarios[0].id, hm = x => C.fmtHM(((x % 1440) + 1440) % 1440);
    s = C.addArtist(s, 'all', { tipo: 'tarea', jornada: j, nombre: 'Carga camión', escenarioId: P, inicio: hm(nAbs - 10), fin: hm(nAbs + 50) }).state;
    s = C.addArtist(s, 'all', { tipo: 'hito', jornada: j, nombre: 'Curfew', escenarioId: '', inicio: hm(nAbs + 120) }).state;
    const ver = mode => {
      const t = panel({ 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ mode, day: 'all' }) }, NOWc);
      return { t, tbody: ultimo(t, 'tbody'), now: ultimo(t, 'v-now'), next: ultimo(t, 'v-next'), call: ultimo(t, 'v-call'), cfg: t.read('showtime.config') || {} };
    };
    const base = ver('all'), ta = ver('tarea'), hi = ver('hito');
    ok(/Carga camión/.test(ta.tbody) && !/Suena|Viene|Curfew/.test(ta.tbody), 'Tareas: solo la tarea en la tabla');
    const filas = h => (h.match(/<tr data-id=/g) || []).length;
    eq(filas(ta.tbody), 1, 'Tareas: una fila'); eq(filas(hi.tbody), 1, 'Marcadores: una fila'); eq(filas(base.tbody), 4, 'Todo: las cuatro');
    ok(/Curfew/.test(hi.tbody) && /data-mode="show"[^>]*data-key="\d+:hito"/.test(hi.tbody), 'Marcadores: solo el marcador (su margen sí cita a la banda)');
    ok(/Suena/.test(ta.now) && /Suena/.test(hi.now), 'En escena sigue mostrando la banda que suena');
    eq(ta.now, base.now, 'En escena idéntico a Todo'); eq(hi.now, base.now);
    eq(ta.next, base.next, 'Siguiente idéntico a Todo'); eq(ta.call, base.call, 'CALL idéntico a Todo: no se pierde ningún aviso'); eq(hi.call, base.call);
    ok(/Viene/.test(base.call), 'el CALL de Viene está ahí: ' + base.call.slice(0, 200));
    eq(ta.t.env.getEl('view-lbl').textContent, 'Tareas'); eq(hi.t.env.getEl('view-lbl').textContent, 'Marcadores');
    ok(/Tareas/.test(ta.t.env.getEl('list-title').textContent) && /Marcadores/.test(hi.t.env.getEl('list-title').textContent), 'título de la lista');
    // datos.js acepta los modos; los raros siguen siendo Shows
    const Dt = ta.t.env.win.ShowtimeDatos;
    eq(Dt.normConfig({ mode: 'tarea' }).mode, 'tarea'); eq(Dt.normConfig({ mode: 'hito' }).mode, 'hito'); eq(Dt.normConfig({ mode: 'otra' }).mode, 'show');
    // Menú y paleta ⌘K
    const html = D.src('index.html'), js = D.src('control.js');
    ok(/data-mode="sc"[^\n]*Soundchecks<\/button>\s*<button class="mitem" data-mode="tarea" role="menuitemradio" title="Solo las tareas técnicas y de producción"[^>]*>Tareas<\/button>\s*<button class="mitem" data-mode="hito" role="menuitemradio" title="Solo los marcadores temporales y toques de queda"[^>]*>Marcadores<\/button>/.test(html), 'Ver ▾ con las 5 vistas');
    ok(/label: 'Tareas'[^\n]*spotSetMode\('tarea'\)/.test(js) && /label: 'Marcadores'[^\n]*spotSetMode\('hito'\)/.test(js), '⌘K: Tareas y Marcadores');
    ok(/tarea: \{ title: 'Tareas', what: 'tareas' \}, hito: \{ title: 'Marcadores', what: 'marcadores' \}/.test(js), 'VIEW ampliado');
    // La Live no se queda sin bandas aunque el Panel esté en Tareas / Marcadores
    ok(/if \(C\.engineMode\) CONFIG\.mode = C\.engineMode\(CONFIG\.mode\);/.test(D.src('live.js')), 'la Live usa la jornada completa');
    const I = ta.t.env.win.ShowtimeI18n;
    ['Tareas', 'Marcadores', 'Solo las tareas técnicas y de producción', 'Solo los marcadores temporales y toques de queda'].forEach(k => ok(I.txHas(k), 'EN: ' + k));
  });

  test('Dec. 116b: una Live con código anterior (abierta antes de actualizar) se recarga sola UNA vez; la de la misma versión, nunca', () => {
    const t = dashboard(), T = t.env.win.ShowtimePanel._test, B = t.env.win.ShowtimeEmision.BUILD;
    let n = 0; const vieja = { ShowtimeEmision: { BUILD: '20261126' }, location: { reload() { n++; } } };
    eq(T.refreshStale(vieja), true); eq(n, 1, 'recargada');
    eq(T.refreshStale(vieja), false); eq(n, 1, 'una sola vez (sin bucles si siguiera vieja)');
    let m = 0; eq(T.refreshStale({ ShowtimeEmision: { BUILD: B }, location: { reload() { m++; } } }), false); eq(m, 0, 'misma versión: nada');
    const ajena = {}; Object.defineProperty(ajena, 'ShowtimeEmision', { get() { throw new Error('SecurityError'); } });
    eq(T.refreshStale(ajena), false, 'otro origen: no se toca'); eq(T.refreshStale(null), false);
    ok(/Pantalla Live actualizada a la versión /.test(JSON.stringify(t.read('showtime.log') || {})), 'queda en el log');
  });

  test('Dec. 117: poda de CSS huérfano — fuera lo que nada usa; dentro lo que sí (QR del Hub, importador)', () => {
    const css = D.src('control.css'), html = D.src('index.html'), js = D.src('control.js');
    ['#m-cast', '.lvpanel', '.lvh', '.lvzones', '.lvz', '.lvnow', '.csoon', '.cbtns', '.focusitem', '.fbox', '.hub-h2', '.add-msg', '.cfg-files', '.filebar', '.gv-qrh', '.lvx', '.realc']
      .forEach(sel => ok(!new RegExp(sel.replace('.', '\\.') + '(?![\\w-])').test(css), 'fuera: ' + sel));
    ok(!/\.cseg\b/.test(css) && !/cseg/.test(js), 'fuera: .cseg (dec. 132: el QR de Staff y el mando eligen con un desplegable)');
    // Se quedan porque se usan (aunque estaban en la lista inicial)
    ['.cpick', '.czone', '.csub'].forEach(sel => { ok(css.indexOf(sel) >= 0, 'sigue: ' + sel); ok(js.indexOf(sel.slice(1)) >= 0, sel + ' lo usa el Hub'); });
    ok(/\.imp-prev tr\.st-ok/.test(css) && /'<tr class="st-' \+ r\.status/.test(js), '.st-ok/.st-warn/.st-err: filas del importador');
    ok(/\.lvon\.on/.test(css) && /id="lv-standby-on"/.test(html), '.lvon: «ABIERTA» del Standby');
  });

  test('Dec. 119: ninguna declaración CSS pisada por otra regla posterior con el mismo selector (control, live, remote)', () => {
    const MODERN = /dvh|svh|lvh|dvw|svw|cq[whib]|color-mix|env\(/i;
    const top = css => {   // reglas de primer nivel (sin @media / @supports / @keyframes)
      const c = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '""'), out = []; let d = 0, start = 0, sel = '', bs = 0;
      for (let i = 0; i < c.length; i++) {
        if (c[i] === '{') { if (d === 0) { sel = c.slice(start, i).trim(); bs = i + 1; } d++; }
        else if (c[i] === '}') { d--; if (d === 0) { if (sel[0] !== '@') out.push({ sels: sel.split(',').map(x => x.trim().replace(/\s+/g, ' ')), body: c.slice(bs, i) }); start = i + 1; } }
        else if (d === 0 && c[i] === ';') start = i + 1;
      }
      return out.map(r => { const ds = []; let p = 0, s0 = 0; const b = r.body + ';';
        for (let i = 0; i < b.length; i++) { if (b[i] === '(') p++; else if (b[i] === ')') p--; else if (b[i] === ';' && p === 0) { const seg = b.slice(s0, i); const k = seg.indexOf(':'); if (k > 0) ds.push({ k: seg.slice(0, k).trim().toLowerCase(), imp: /!important/i.test(seg), v: seg.slice(k + 1) }); s0 = i + 1; } }
        return { sels: r.sels, ds }; });
    };
    const pisadas = css => { const R = top(css), out = [];
      R.forEach((r, i) => r.ds.forEach(d => { if (d.k.startsWith('--')) return;
        if (r.sels.every(sl => R.slice(i + 1).some(r2 => r2.sels.indexOf(sl) >= 0 && r2.ds.some(d2 => d2.k === d.k && (d2.imp || !d.imp) && !MODERN.test(d2.v))))) out.push(r.sels.join(',').slice(0, 50) + ' {' + d.k + '}'); }));
      return out; };
    ['control.css', 'live.css', 'remote.css'].forEach(f => { const p = pisadas(D.src(f)); eq(p.length, 0, f + ': ' + p.slice(0, 5).join(' · ')); });
  });

  test('Dec. 120: píldoras de tipo con el mismo ancho (los nombres arrancan en la misma vertical en Foco) y Notas legibles en modo normal', () => {
    const css = D.src('control.css');
    ok(/\.tpill\{display:none;flex:0 0 106px;width:106px;box-sizing:border-box;text-align:center;align-items:center;justify-content:center;/.test(css), 'píldora de 106 px fijos');
    ok(!/\.tpill\{[^}]*min-width/.test(css), 'sin ancho mínimo que varíe según el texto');
    ok(/td\.n input:focus\{[^}]*width:max\(320px,calc\(100% - 6px\)\);max-width:none;/.test(css), 'al escribir se sigue ensanchando a 320 px (o al ancho de la columna si es mayor: v20261169)');
    ok(/body\.focus #tbl \.c-n,body\.focus #tbl td\.n,/.test(css), 'en Foco, Notas sigue oculta');
  });

  test('Dec. 121/122: Notas elástica (nunca obliga a desplazar) y la nota entera en una tarjeta flotante al pasar el ratón', () => {
    const css = D.src('control.css'), js = D.src('control.js');
    ok(/td\.n\{position:relative;min-width:88px\}/.test(css) && /td\.n input\{width:100%;min-width:88px\}/.test(css), 'sin ancho fijo: la columna crece con la pantalla');
    ok(!/td\.n(?![\w-])[^{]*\{[^}]*width:(96|140|170|200)px/.test(css), 'ningún ancho fijo que empuje la tabla');
    ok(/td\.n input:focus\{position:absolute;[^}]*width:max\(320px,calc\(100% - 6px\)\);max-width:none;z-index:6;/.test(css), 'al escribir flota a 320 px como mínimo; si la columna es más ancha, nunca se encoge');
    ok(/body\.focus #tbl \.c-n,body\.focus #tbl td\.n,/.test(css), 'en Foco sigue oculta');
    // Dec. 122: tarjeta flotante propia (.ntip), sin el aviso nativo del navegador
    ok(!/data-k="notas"[^>]*title=/.test(js) && !/k === 'notas' \? ' title=/.test(js), 'sin title nativo');
    ok(/td\('notas', 'n', inp\('notas'\) \+ \(v\('notas'\) \? '<span class="ntip" aria-hidden="true">' \+ esc\(v\('notas'\)\) \+ '<\/span>' : ''\)\)/.test(js), 'tarjeta junto al input, solo si hay nota');
    ok(/if \(tip\) \{ tip\.textContent = e\.target\.value; tip\.hidden = !e\.target\.value; \}/.test(js), 'la tarjeta sigue a lo que se escribe');
    ok(/\.ntip\{display:none;position:absolute;right:0;bottom:calc\(100% \+ 4px\);z-index:50;width:max-content;min-width:200px;max-width:340px;[^}]*pointer-events:none\}/.test(css), 'estilo de la tarjeta');
    ok(/td\.tipon:not\(:focus-within\) \.ntip:not\(\[hidden\]\)\{display:block\}/.test(css) && !/:hover \.ntip/.test(css), 'al pasar el ratón (solo ratón y si se corta: v20261169); al escribir, no');
    ok(/#tbl tbody tr:nth-child\(-n\+2\) td \.ntip\{bottom:auto;top:calc\(100% \+ 4px\)\}/.test(css), 'primeras filas: debajo (sin chocar con la cabecera fija)');
    ok(/body\[data-ps="stage"\] \.ntip\{background:#000;border:1\.5px solid rgba\(255,214,0,\.7\)\}/.test(css), 'Stage: negro y borde amarillo');
    const t = dashboard(), html = ultimo(t, 'tbody');
    ok(!/title="[^"]*" autocomplete/.test(html.match(/<td class="n[^"]*">[\s\S]*?<\/td>/) ? html.match(/<td class="n[^"]*">[\s\S]*?<\/td>/)[0] : ''), 'la celda de Notas no lleva title');
  });

  // ── v20261169 · Dashboard: anchos de Zona, Nombre y Notas (solo esta sesión) y lectura pasiva ──
  /** Mini DOM de la cabecera: una columna cualquiera + Zona, Nombre y Notas, con su tirador y su ↶. El ancho sale de style.width
   *  (nunca por debajo del mínimo real de la columna); «1px» devuelve ese mínimo, como mide el navegador. */
  function dwMini(t) {
    const doc = t.env.win.document, tbl = t.env.getEl('tbl'), box = t.env.getEl('dash-colctl'), F = { foco: '' };
    const set = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; v ? s.add(c) : s.delete(c); return v; } }; };
    const attrs = () => { const a = {}; return { a, setAttribute(n, v) { a[n] = String(v); }, getAttribute(n) { return n in a ? a[n] : null; }, removeAttribute(n) { delete a[n]; }, hasAttribute(n) { return n in a; } }; };
    const col = (k, base, min) => {
      const th = Object.assign(attrs(), { dataset: k ? { dwk: k } : {}, style: {}, classList: set(), getBoundingClientRect: () => ({ width: th.style.width === '1px' ? min : th.style.width ? Math.max(min, parseFloat(th.style.width)) : base }) });
      if (!k) return { th };
      const grip = Object.assign(attrs(), { dataset: { dgrip: k }, tabIndex: 0, disabled: false, classList: set(), getClientRects: () => [1], focus() { F.foco = 'grip-' + k; doc.activeElement = grip; },
        getBoundingClientRect: () => ({ left: 300, right: 310, top: 10, bottom: 40 }), closest: q => q === '[data-dgrip]' ? grip : null });
      const reset = Object.assign(attrs(), { dataset: { dreset: k }, hidden: true, focus() { F.foco = 'reset-' + k; doc.activeElement = reset; }, closest: q => q === '[data-dreset]' ? reset : null });
      th.querySelector = q => q === '[data-dgrip]' ? grip : q === '[data-dreset]' ? reset : null;
      return { th, grip, reset };
    };
    const C3 = { otra: col('', 120, 120), zona: col('zona', 176, 120), nombre: col('nombre', 199, 190), notas: col('notas', 136, 94) };
    const ths = [C3.otra.th, C3.zona.th, C3.nombre.th, C3.notas.th];
    tbl.querySelectorAll = q => q === 'thead th' ? ths : q === 'thead th[data-dwf]' ? ths.filter(x => x.hasAttribute('data-dwf')) : [];
    const qs0 = doc.querySelector, qsa0 = doc.querySelectorAll;
    doc.querySelector = q => { const m = /th\[data-dwk="(\w+)"\]/.exec(q); return m ? C3[m[1]].th : qs0(q); };
    const step = d => Object.assign(attrs(), { dataset: { dstep: d }, focus() { F.foco = d === '1' ? '+' : '−'; doc.activeElement = this; }, closest: q => q === '[data-dstep]' ? this : q === '#dash-colctl' ? box : null });
    const minus = step('-1'), plus = step('1'); minus.closest = q => q === '[data-dstep]' ? minus : q === '#dash-colctl' ? box : null; plus.closest = q => q === '[data-dstep]' ? plus : q === '#dash-colctl' ? box : null;
    minus.focus = () => { F.foco = '−'; doc.activeElement = minus; }; plus.focus = () => { F.foco = '+'; doc.activeElement = plus; };
    box.querySelector = q => q === '[data-dstep="-1"]' ? minus : q === '[data-dstep="1"]' ? plus : null;
    box.hidden = true;
    const fin = () => { delete tbl.querySelectorAll; delete box.querySelector; doc.querySelector = qs0; doc.querySelectorAll = qsa0; doc.activeElement = null; };
    const pe = (type, g, pt, x, y, extra) => t.env.fire('tbl', type, Object.assign({ pointerType: pt, pointerId: 9, button: 0, clientX: x, clientY: y || 0, target: g, preventDefault() {} }, extra || {}));
    return { C3, box, minus, plus, F, fin, pe, tbl, T: t.env.win.ShowtimePanel._test, w: k => C3[k].th.getBoundingClientRect().width };
  }
  test('Dashboard v20261169 · tirador de Zona, Nombre y Notas: arrastre solo cambia esa columna; clic limpio y toque (≤ 6 px) abren − / + al soltar, sin depender del click', () => {
    const t = dashboard(), M = dwMini(t), { C3, box, pe, T } = M;
    // Ratón: cualquier movimiento horizontal arrastra (no abre); el resto de columnas, congelado a su ancho
    pe('pointerdown', C3.zona.grip, 'mouse', 300); pe('pointermove', C3.zona.grip, 'mouse', 301); pe('pointermove', C3.zona.grip, 'mouse', 360); pe('pointerup', C3.zona.grip, 'mouse', 360);
    eq(T.dw().zona, 236, 'Zona +60'); ok(box.hidden, 'el arrastre no abre');
    eq(M.w('otra'), 120); eq(M.w('nombre'), 199); eq(M.w('notas'), 136); ok(C3.otra.th.hasAttribute('data-dwf') && C3.nombre.th.hasAttribute('data-dwf'), 'las demás, congeladas');
    ok(M.tbl._classes.has('dwfrz') && M.tbl._classes.has('dw-zona'), 'tabla sin el 100 % mientras haya un ancho propio');
    ok(!C3.zona.reset.hidden && C3.nombre.reset.hidden && C3.notas.reset.hidden, '↶ solo en la columna que cambió');
    // Ratón: clic limpio abre al soltar (sin «click» del navegador); otro clic cierra; el click real se ignora (sin doble apertura)
    pe('pointerdown', C3.nombre.grip, 'mouse', 300); pe('pointerup', C3.nombre.grip, 'mouse', 300);
    ok(!box.hidden && C3.nombre.grip.a['aria-expanded'] === 'true' && T.dwCtl() === 'nombre', 'clic limpio: abre');
    eq(t.env.getEl('dash-colw').textContent, '199 px'); eq(M.minus.a['aria-disabled'], 'false');
    t.env.fire('tbl', 'click', { target: C3.nombre.grip, detail: 1 }); ok(!box.hidden, 'el click que sigue no vuelve a conmutar');
    t.env.fire('dash-colctl', 'click', { target: M.plus }); eq(T.dw().nombre, 215, '+ 16 px'); ok(!C3.nombre.reset.hidden);
    pe('pointerdown', C3.nombre.grip, 'mouse', 300); pe('pointerup', C3.nombre.grip, 'mouse', 300); ok(box.hidden && C3.nombre.grip.a['aria-expanded'] === 'false', 'otro clic: cierra');
    // Dedo / lápiz: hasta 6 px horizontales es toque (abre al soltar, ancho intacto); más, arrastre (no abre); vertical, nada
    for (const pt of ['touch', 'pen']) {
      pe('pointerdown', C3.notas.grip, pt, 300, 20); pe('pointermove', C3.notas.grip, pt, 306, 23); pe('pointerup', C3.notas.grip, pt, 306, 23);
      ok(!box.hidden && T.dwCtl() === 'notas' && T.dw().notas === null, pt + ': temblor de 6 px = toque limpio, abre y no cambia el ancho');
      pe('pointerdown', C3.notas.grip, pt, 300, 20); pe('pointerup', C3.notas.grip, pt, 300, 20); ok(box.hidden, pt + ': otro toque cierra');
    }
    pe('pointerdown', C3.notas.grip, 'touch', 300, 20); pe('pointermove', C3.notas.grip, 'touch', 307, 20); pe('pointerup', C3.notas.grip, 'touch', 307, 20);
    eq(T.dw().notas, 143, 'dedo: 7 px ya es arrastre (+7)'); ok(box.hidden, 'y no abre');
    pe('pointerdown', C3.notas.grip, 'touch', 300, 20); pe('pointermove', C3.notas.grip, 'touch', 333, 20); pe('pointerup', C3.notas.grip, 'touch', 333, 20);
    eq(T.dw().notas, 176, 'arrastre largo (+33)'); ok(box.hidden);
    pe('pointerdown', C3.notas.grip, 'touch', 300, 20); pe('pointermove', C3.notas.grip, 'touch', 302, 40); pe('pointermove', C3.notas.grip, 'touch', 360, 80); pe('pointerup', C3.notas.grip, 'touch', 360, 80);
    eq(T.dw().notas, 176, 'gesto claramente vertical: no cambia nada'); ok(box.hidden, 'ni abre');
    // Gesto cancelado: no abre; si arrastraba, se queda el último ancho válido
    pe('pointerdown', C3.notas.grip, 'touch', 300, 20); pe('pointercancel', C3.notas.grip, 'touch', 300, 20); ok(box.hidden, 'cancelado sin moverse: no abre');
    pe('pointerdown', C3.notas.grip, 'touch', 300, 20); pe('pointermove', C3.notas.grip, 'touch', 330, 20); pe('lostpointercapture', C3.notas.grip, 'touch', 330, 20); pe('pointerup', C3.notas.grip, 'touch', 330, 20);
    eq(T.dw().notas, 206, 'cancelado arrastrando: se queda el último ancho'); ok(box.hidden, 'y no abre (ni con un pointerup tardío)');
    // Botón derecho del ratón: nada
    pe('pointerdown', C3.zona.grip, 'mouse', 300, 0, { button: 2 }); pe('pointerup', C3.zona.grip, 'mouse', 300); ok(box.hidden);
    // Mínimo real: nunca por debajo de lo que la columna necesita; − se desactiva (sigue enfocable)
    pe('pointerdown', C3.zona.grip, 'mouse', 300); pe('pointermove', C3.zona.grip, 'mouse', 0); pe('pointerup', C3.zona.grip, 'mouse', 0);
    eq(T.dw().zona, 120, 'no baja del mínimo medido');
    pe('pointerdown', C3.zona.grip, 'mouse', 300); pe('pointerup', C3.zona.grip, 'mouse', 300); eq(M.minus.a['aria-disabled'], 'true', '− desactivado en el mínimo');
    t.env.fire('dash-colctl', 'click', { target: M.minus }); eq(T.dw().zona, 120, '− desactivado no hace nada');
    for (let i = 0; i < 100; i++) t.env.fire('dash-colctl', 'click', { target: M.plus });
    eq(T.dw().zona, 1720, '+ sin máximo');
    M.fin(); eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Dashboard v20261169 · teclado y ↶ por columna: Intro/Espacio abren, Esc cierra, Tab no atrapa; ↶ devuelve SOLO esa columna a su ancho inicial y desaparece', () => {
    const t = dashboard(), M = dwMini(t), { C3, box, pe, T, F } = M, doc = t.env.win.document;
    const key = (k, target, extra) => { let pd = 0, sp = 0; t.env.fire(target === 'grip' ? 'tbl' : 'dash-colctl', 'keydown', Object.assign({ key: k, target: target === 'grip' ? C3.nombre.grip : target, preventDefault() { pd++; }, stopPropagation() { sp++; } }, extra || {})); return { pd, sp }; };
    ok(key('Enter', 'grip').pd === 1 && !box.hidden && F.foco === '−', 'Intro: abre con el foco en −');
    ok(key('Escape', M.minus).sp === 1 && box.hidden && F.foco === 'grip-nombre', 'Esc: cierra y vuelve al tirador (sin propagarse)');
    key(' ', 'grip'); ok(!box.hidden, 'Espacio: abre'); key(' ', 'grip'); ok(box.hidden, 'Espacio otra vez: cierra');
    key('Enter', 'grip'); key('Tab', M.minus, { shiftKey: true }); ok(box.hidden && F.foco === 'grip-nombre', 'Shift+Tab desde −: vuelve al tirador');
    // Tab desde +: cierra y sigue al control que va DESPUÉS del tirador (orden del documento)
    const sig = { tabIndex: 0, disabled: false, type: 'text', getClientRects: () => [1], closest: () => null, focus() { F.foco = 'siguiente'; } };
    doc.querySelectorAll = q => /button, input/.test(q) ? [C3.zona.grip, C3.nombre.grip, sig] : [];
    key('Enter', 'grip'); t.env.fire('dash-colctl', 'click', { target: M.plus }); let r = key('Tab', M.plus);
    ok(r.pd === 1 && box.hidden && F.foco === 'siguiente', 'Tab desde +: sale al siguiente control (no queda atrapado)');
    key('Enter', 'grip'); r = key('Tab', M.minus); ok(r.pd === 0 && !box.hidden, 'Tab desde −: lo hace el navegador (va a +)');
    key('Escape', M.minus);
    // Varias columnas cambiadas: cada ↶ devuelve solo la suya al ancho inicial exacto y desaparece
    pe('pointerdown', C3.zona.grip, 'mouse', 300); pe('pointermove', C3.zona.grip, 'mouse', 340); pe('pointerup', C3.zona.grip, 'mouse', 340);
    eq(T.dw().nombre, 215); eq(T.dw().zona, 216);
    doc.activeElement = C3.nombre.reset; t.env.fire('tbl', 'click', { target: C3.nombre.reset });
    eq(T.dw().nombre, null); eq(M.w('nombre'), 199, 'Nombre vuelve a su ancho inicial'); eq(T.dw().zona, 216, 'Zona sigue con el suyo');
    ok(C3.nombre.reset.hidden && !C3.zona.reset.hidden && F.foco === 'grip-nombre', '↶ de Nombre desaparece; el foco pasa a su tirador');
    ok(M.tbl._classes.has('dwfrz') && C3.nombre.th.hasAttribute('data-dwf'), 'mientras quede alguna, el resto sigue quieto');
    t.env.fire('tbl', 'click', { target: C3.zona.reset });
    ok(!M.tbl._classes.has('dwfrz') && !M.tbl._classes.has('dw-zona') && !M.tbl._classes.has('dw-nombre'), 'ninguna propia: tabla al 100 % otra vez');
    ok([C3.otra, C3.zona, C3.nombre, C3.notas].every(c => !c.th.style.width && !c.th.style.minWidth && !c.th.hasAttribute('data-dwf')), 'sin ningún ancho en línea: maquetación inicial exacta');
    ok([C3.zona, C3.nombre, C3.notas].every(c => c.reset.hidden), 'sin ↶');
    // Nombres verdaderos
    ok(/Nombre/.test(C3.nombre.grip.a['aria-label']) && /Nombre/.test(C3.nombre.reset.a['aria-label']), 'tirador y ↶ dicen su columna');
    M.fin(); eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Dashboard v20261169 · anchos SOLO de esta sesión: ni localStorage ni datos del evento; scroll, ventana y Modo Foco cierran el microcontrol', () => {
    const t = dashboard(), M = dwMini(t), { C3, box, pe, T } = M;
    const antes = Array.from(t.env.storage.entries()).map(x => x.join('=')).sort().join('|');
    pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointermove', C3.notas.grip, 'mouse', 380); pe('pointerup', C3.notas.grip, 'mouse', 380);
    eq(T.dw().notas, 216);
    eq(Array.from(t.env.storage.entries()).map(x => x.join('=')).sort().join('|'), antes, 'nada guardado (ni festival ni preferencias)');
    const src = D.src('control.js'), blk = src.slice(src.indexOf('const DCOLS = '), src.indexOf('// ── Pegar horario (ESPEC-2c A)'));
    ok(blk.length > 1000 && !/localStorage|sessionStorage|commitFestival|saveState|FEST\b/.test(blk), 'el bloque no toca almacenamiento ni el evento');
    // Recargar = otro arranque: vuelve el ancho inicial
    const t2 = dashboard(), M2 = dwMini(t2); eq(t2.env.win.ShowtimePanel._test.dw().notas, null, 'al recargar, ancho inicial'); M2.fin();
    // Cierres: scroll real de la vista, ventana, Modo Foco
    const wrap = { scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({}) };
    M.tbl.closest = q => q === '.tblwrap' ? wrap : null;
    pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointerup', C3.notas.grip, 'mouse', 300); ok(!box.hidden);
    t.env.fire('window', 'scroll', { target: wrap }); ok(!box.hidden, 'un scroll que no mueve la vista (medida propia) no cierra');
    wrap.scrollLeft = 40; t.env.fire('window', 'scroll', { target: wrap }); ok(box.hidden, 'scroll real: cierra');
    pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointerup', C3.notas.grip, 'mouse', 300);
    t.env.fire('window', 'resize', {}); ok(box.hidden, 'cambio de ventana: cierra'); eq(T.dw().notas, 216, 'y el ancho propio sigue');
    pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointerup', C3.notas.grip, 'mouse', 300);
    t.env.fire('document', 'pointerdown', { target: { closest: () => null } }); ok(box.hidden, 'pulsar fuera: cierra');
    ok(/function applyFocus\(\) \{[\s\S]*?try \{ dwRelayout\(\); \} catch \(e\) \{\}[\s\S]*?\n  \}/.test(src), 'Modo Foco: vuelve a tomar las demás columnas');
    delete M.tbl.closest; M.fin(); eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Dashboard v20261169 · carril fijo de ···: al cambiar SU ancho, el tirador nunca queda debajo (la vista se corre lo justo); el foco deja libre el carril', () => {
    const t = dashboard(), M = dwMini(t), { C3, pe, T } = M, doc = t.env.win.document;
    const props = {}, wrap = { scrollLeft: 0, scrollTop: 0, style: { setProperty: (k, v) => { props[k] = v; } }, getBoundingClientRect: () => ({}) };
    M.tbl.closest = q => q === '.tblwrap' ? wrap : null;
    let laneLeft = 290; const lane = { getBoundingClientRect: () => ({ left: laneLeft, width: 36 }) };
    const qs1 = doc.querySelector; doc.querySelector = q => q === '#tbl thead th.mo' ? lane : qs1(q);
    pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointermove', C3.notas.grip, 'mouse', 340); pe('pointerup', C3.notas.grip, 'mouse', 340);
    eq(T.dw().notas, 176); eq(wrap.scrollLeft, 20, 'tirador (borde 310) bajo el carril (290): la vista se corre 20 px');
    eq(props['--lanew'], '36px', 'ancho real del carril para el scroll-padding');
    laneLeft = 400; pe('pointerdown', C3.notas.grip, 'mouse', 300); pe('pointermove', C3.notas.grip, 'mouse', 310); pe('pointerup', C3.notas.grip, 'mouse', 310);
    eq(wrap.scrollLeft, 20, 'si el tirador ya está libre, la vista no se mueve');
    lane.getBoundingClientRect = () => ({ left: 0, width: 0 }); t.env.fire('window', 'resize', {}); eq(props['--lanew'], '0px', 'sin carril (Modo Foco): 0');
    delete M.tbl.closest; M.fin(); eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Dashboard v20261169 · lectura pasiva de Zona, Nombre y Notas: solo con ratón y solo si el texto está cortado; el toque edita; la ayuda de Zona sigue accesible', () => {
    const t = dashboard(), T = t.env.win.ShowtimePanel._test, doc = t.env.win.document;
    const celda = (k, cortado) => {
      const cls = new Set(), td = { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, _c: cls };
      const inp = { dataset: { k }, title: k === 'zona' ? 'Elige una zona o escribe una nueva para crearla' : '', scrollWidth: cortado ? 300 : 100, clientWidth: 120, closest: q => /td\.stage, td\.name, td\.n/.test(q) ? td : null };
      const tip = { hidden: false };
      td.querySelector = q => q === '.ntip' ? tip : /input/.test(q) ? inp : null; td.contains = n => n === inp || n === tip;
      return { td, inp, tip };
    };
    const over = (c, pt) => t.env.fire('tbody', 'pointerover', { pointerType: pt, target: c.inp });
    const out = (c, to) => t.env.fire('tbody', 'pointerout', { pointerType: 'mouse', target: c.inp, relatedTarget: to || null });
    const z = celda('zona', true), n = celda('nombre', false), nt = celda('notas', true);
    over(z, 'touch'); over(z, 'pen'); ok(!z.td._c.has('tipon'), 'dedo / lápiz: ningún detalle (un toque edita)');
    over(n, 'mouse'); ok(!n.td._c.has('tipon'), 'ratón sobre texto entero: nada');
    over(z, 'mouse'); ok(z.td._c.has('tipon') && T.dwTip() === z.td, 'ratón sobre Zona cortada: detalle');
    eq(z.inp.title, '', 'sin el rótulo nativo encima del detalle');
    out(z, z.tip); ok(z.td._c.has('tipon'), 'dentro de su celda sigue');
    out(z, null); ok(!z.td._c.has('tipon') && z.inp.title === 'Elige una zona o escribe una nueva para crearla', 'al salir se cierra y vuelve la ayuda');
    over(nt, 'mouse'); ok(nt.td._c.has('tipon'));
    t.env.fire('window', 'scroll', { target: {} }); ok(!nt.td._c.has('tipon'), 'scroll: se cierra');
    over(nt, 'mouse'); t.env.fire('tbody', 'focusin', { target: nt.inp }); ok(!nt.td._c.has('tipon'), 'al editar: se cierra');
    doc.activeElement = nt.inp; over(nt, 'mouse'); ok(!nt.td._c.has('tipon'), 'el campo que se edita no abre detalle'); doc.activeElement = null;
    nt.tip.hidden = true; over(nt, 'mouse'); ok(!nt.td._c.has('tipon'), 'sin texto: nada');
    // Marcado: detalle para Zona y Nombre (solo si hay texto), Notas igual que antes; ayuda de Zona también en aria-label
    const html = ultimo(t, 'tbody');
    ok(/data-k="zona"[^>]*aria-label="Zona: Elige una zona o escribe una nueva para crearla"/.test(html), 'nombre accesible de Zona: «Zona» + su ayuda, sin depender del title');
    ok(/data-k="zona"[^>]*><span class="ntip ntip-l" aria-hidden="true">Principal<\/span>/.test(html), 'Zona: nombre entero');
    ok(/data-k="nombre"[^>]*><span class="ntip ntip-l" aria-hidden="true">Banda A<\/span>/.test(html), 'Nombre: nombre entero');
    const css = D.src('control.css');
    ok(/td\.tipon:not\(:focus-within\) \.ntip:not\(\[hidden\]\)\{display:block\}/.test(css) && !/:hover \.ntip/.test(css), 'sin :hover (en tablet el toque emula hover)');
    ok(/tbody tr\.done td\.tipon:not\(\.gap\):not\(\.est\)\{opacity:1\}/.test(css) && /tbody tr\.done td\.stage\.tipon>:not\(\.ntip\),tbody tr\.done td\.n\.tipon>:not\(\.ntip\),tbody tr\.done td\.name\.tipon \.nm>:not\(\.ntip\)\{opacity:\.5\}/.test(css), 'detalle opaco también en filas pasadas (atenúa el contenido de la celda, no el detalle)');
    ok(/\.ntip\{[^}]*background:#0f1117;/.test(css) && !/\.ntip[^{]*\{[^}]*(backdrop-filter|rgba\([^)]*\)\s*;?\s*border-radius)/.test(css) && /body\[data-ps="stage"\] \.ntip\{background:#000;/.test(css), 'fondo sólido: oscuro en Studio, negro en Stage; sin blur');
    ok(/tbody tr\.done td\.n:focus-within:not\(\.gap\):not\(\.est\)\{opacity:1\}/.test(css), 'editor de Notas opaco y por encima en filas pasadas (solo mientras se edita; el resto de la fila sigue atenuado)');
    ok(/#tbl tbody td\.n\.mod input\[type=text\]:focus\{background-color:color-mix\(in srgb,#ffc533 8%,var\(--field\)\)!important\}/.test(css) && /#tbl tbody td\.n input\.bad:focus\{background-color:color-mix\(in srgb,#ff6b6b 12%,var\(--field\)\)!important\}/.test(css), 'editor de Notas modificada / inválida: tono mezclado con el fondo, sin transparencia');
    ok(/#tbl td\.stage,#tbl td\.name\{position:relative\}/.test(css) && /\.ntip\.ntip-l\{left:0;right:auto\}/.test(css) && /#tbl tbody tr:nth-child\(-n\+2\) td \.ntip\{bottom:auto;top:calc\(100% \+ 4px\)\}/.test(css), 'anclado a su celda; primeras filas por debajo');
    const src = D.src('control.js');
    ok(/\['zona', 'nombre', 'notas'\]\.indexOf\(e\.target\.dataset\.k\) < 0/.test(src), 'el detalle sigue a lo que se escribe en las tres');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Dashboard v20261169 · cabecera: títulos centrados (celdas igual); tirador fino y ↶ de 32 px solo en Zona, Nombre y Notas; acciones vacía; Foco y tablet intactos', () => {
    const html = D.src('index.html'), css = D.src('control.css'), i18n = D.src('i18n.js');
    const head = html.slice(html.indexOf('<table id="tbl">'), html.indexOf('</thead>'));
    eq((head.match(/data-dgrip=/g) || []).length, 3, 'tres tiradores'); eq((head.match(/data-dreset=/g) || []).length, 3, 'tres ↶');
    ['zona', 'nombre', 'notas'].forEach(k => ok(new RegExp('data-dwk="' + k + '"><span class="dwl"><span>[A-Za-z]+</span></span><button type="button" class="dw-reset" data-dreset="' + k + '" hidden></button><button type="button" class="dw-grip" data-dgrip="' + k + '" aria-expanded="false" aria-controls="dash-colctl"></button></th>').test(head), k + ': ↶ (oculto) antes del tirador'));
    ok(/<th class="mo"><\/th>\s*<\/tr>/.test(head), 'la última cabecera (acciones) sigue vacía');
    ok(!/Restablecer columnas/.test(head) && !/dw-reset[^>]*data-dreset="all"/.test(html), 'sin botón global');
    ok(/<div id="dash-colctl" class="imp-colctl" role="group" hidden><button type="button" class="imp-colstep" data-dstep="-1">−<\/button><output id="dash-colw" class="imp-colw" aria-live="polite"><\/output><button type="button" class="imp-colstep" data-dstep="1">\+<\/button><\/div>/.test(html), 'microcontrol propio, como el del importador');
    ok(html.indexOf('id="dash-colctl"') < html.indexOf('<div id="imp"'), 'fuera del importador (que va oculto)');
    ok(/#tbl thead th\{text-align:center\}/.test(css) && /^thead th\{[^}]*text-align:left;/m.test(css), 'títulos centrados solo en #tbl');
    ok(!/#tbl tbody td\{[^}]*text-align:center/.test(css), 'las celdas no cambian');
    ok(/#tbl thead th\.dwh \.dwl\{display:flex;justify-content:center\}/.test(css) && /#tbl thead th\.dwh \.dwl::before\{content:"";flex:0 1 42px;min-width:0\}/.test(css) && /#tbl thead th\.dwh \.dwl::after\{content:"";flex:0 0 42px\}/.test(css), 'título centrado con 42 px reservados siempre a la derecha (↶ + tirador): aparecer ↶ no mueve nada; sin sitio, cede el hueco izquierdo');
    ok(!/dwchg\{/.test(css), '↶ no cambia rellenos (sin salto al aparecer)');
    ok(/\.tblwrap\{scroll-padding-right:var\(--lanew,0px\)\}/.test(css), 'el foco deja libre el carril de ···');
    ok(/\.dw-grip\{position:absolute;top:0;right:0;bottom:0;width:10px;[^}]*touch-action:none/.test(css), 'tirador fino, sin scroll del navegador');
    ok(/\.dw-reset\{position:absolute;top:50%;right:10px;width:32px;height:32px;/.test(css) && /\.dw-reset::before\{content:"↶"\}/.test(css), '↶ discreto con zona táctil de 32 px, antes del tirador');
    ok(/#tbl\.dwfrz\{width:auto\}/.test(css) && /#tbl\.dw-zona td\.stage input\[type=text\]\{width:100%;max-width:none\}/.test(css), 'congelado y Zona que llena su ancho');
    ok(/body\.focus #tbl thead th\.c-name\{padding-left:128px\}/.test(css) && /body\.focus #tbl \.c-jor,body\.focus #tbl td\.f,body\.focus #tbl \.c-tp,body\.focus #tbl td\.tp,body\.focus #tbl \.c-n,body\.focus #tbl td\.n,body\.focus #tbl th\.mo,body\.focus #tbl td\.mo\{display:none\}/.test(css), 'Modo Foco igual');
    ok(/  #tbl td\.stage input\[type=text\]\{width:var\(--escw,140px\);min-width:104px;max-width:170px\}/.test(css) && /  td\.name\{min-width:150px\}/.test(css), 'portátil / tablet igual');
    ok(/"Restablecer el ancho de \{_c\}": "Reset width of \{_c\}"/.test(i18n), 'i18n del ↶');
    ok(/#tbl\{--escw:112px\}/.test(css) && !/setProperty\('--escw'/.test(D.src('control.js')), 'Zona: ancho base compacto y fijo, no crece con la zona más larga del evento');
    const js = D.src('control.js');
    ok(/function paintLang\(\) \{[\s\S]*?try \{ dwAria\(\); \} catch \(e\) \{\}[\s\S]*?\n  \}/.test(js) && /try \{ dwAria\(\); \} catch \(e\) \{\}   \/\/ nombres de tiradores/.test(js) && /markRows\(Math\.floor\(C\.nowAbs\(\)\)\);\n    try \{ dwLane\(\); \} catch \(e\) \{\}/.test(js), 'nombres de tirador y ↶ al cambiar de idioma');
  });

  test('Dec. 123: ⌘K busca por fecha — grupo Jornadas (resumen del día) y todas las entradas (shows, soundchecks, tareas y marcadores)', () => {
    let s = festDosDias();
    const j = C.jornadaOfAbs(s, nAbs), m = C.shiftDate(j, 1), P = s.escenarios[0].id;   // j = viernes 10/07/2026 · m = sábado 11/07
    s = C.addArtist(s, 'all', { tipo: 'tarea', jornada: m, nombre: 'Carga camión', escenarioId: P, inicio: '10:00', fin: '11:00' }).state;
    s = C.addArtist(s, 'all', { tipo: 'hito', jornada: m, nombre: 'Curfew', escenarioId: '', inicio: '23:30' }).state;
    const t = conMando(s), T = t.T;
    eq(T.spotItems('').filter(x => x.group === 'Jornadas' || x.group === 'Entradas').length, 0, 'sin texto: solo vistas y acciones');
    const days = T.spotDays();
    eq(days.length, 2, 'una por jornada'); eq(days[0].label, 'Viernes, 10 de julio de 2026'); eq(days[1].label, 'Sábado, 11 de julio de 2026');
    eq(days[0].sub, '3 shows'); eq(days[1].sub, '1 show · 1 tarea · 1 marcador');
    ['viernes', 'friday', '10/07', '10/7', '2026-07-10', 'julio', 'july', 'jul', '10 jul'].forEach(q => ok(T.spotItems(q).some(x => x.group === 'Jornadas' && /Viernes/.test(x.label)), 'jornada por «' + q + '»'));
    ok(!T.spotItems('sabado').some(x => x.group === 'Jornadas' && /Viernes/.test(x.label)), 'el sábado no saca el viernes');
    const sab = T.spotItems('11 jul').filter(x => x.group === 'Entradas').map(x => x.label).sort();
    eq(sab.join(','), 'Carga camión,Curfew,Mañana', 'por fecha salen también tareas y marcadores de ese día');
    ok(T.spotItems('carga').some(x => x.group === 'Entradas' && /tp-tarea/.test(x.pill)), 'una tarea, por su nombre, con su píldora');
    ok(T.spotItems('curfew').some(x => /tp-hito/.test(x.pill || '')), 'un marcador');
    const it = T.spotItems('sábado').find(x => x.group === 'Jornadas');
    it.run(); eq(t.read('showtime.config').day, m, 'elegir la jornada la pone en el Panel');
    // Orden: jornadas, entradas y luego acciones
    const g = T.spotItems('jul').map(x => x.group); ok(g.indexOf('Jornadas') < g.indexOf('Entradas'), 'jornadas primero');
  });

  test('Dec. 124: flechas ◀ / ▶ de jornada y menú de Día con cabeceras de mes (temporadas)', () => {
    let s = C.newFestival({ nombre: 'Temporada', fechaInicio: '2026-06-28', fechaFin: '2026-07-03', dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'P').state;
    s = C.addArtist(s, 'show', { jornada: '2026-06-29', nombre: 'Uno', escenarioId: s.escenarios[0].id, inicio: '21:00', fin: '22:00' }).state;
    const t = panel({ 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ mode: 'all', day: 'all' }) }, NOWc), T = t.T, el = id => t.env.getEl(id);
    eq(JSON.stringify(T.dayStep()), JSON.stringify({ prev: '2026-06-28', next: '2026-07-03' }), 'desde Todas: a la primera / la última');
    t.env.fire('day-next', 'click', {}); eq(t.read('showtime.config').day, '2026-07-03');
    eq(el('day-next').disabled, true, 'en la última, ▶ apagada'); eq(el('day-prev').disabled, false);
    t.env.fire('day-prev', 'click', {}); eq(t.read('showtime.config').day, '2026-07-02', 'una atrás');
    const html = ultimo(t, 'days');
    ok((html.match(/class="dmonth"/g) || []).length === 2 && /junio 2026<\/div>/.test(html) && /julio 2026<\/div>/.test(html), 'dos meses → dos cabeceras: ' + html.slice(0, 160));
    ok(html.indexOf('junio 2026') < html.indexOf('data-day="2026-06-28"') && html.indexOf('julio 2026') < html.indexOf('data-day="2026-07-01"') && html.indexOf('julio 2026') > html.indexOf('data-day="2026-06-30"'), 'cada cabecera antes de su primer día');
    ok(/data-day="2026-06-28" class="vacia/.test(html) && !/data-day="2026-06-29" class="vacia/.test(html), 'días libres atenuados');
    eq(T.monthLabel('2026-07-15'), 'julio 2026');
    const css = D.src('control.css');
    ok(/\.mpanel \.days\{[^}]*max-height:380px;overflow-x:hidden;overflow-y:auto\}/.test(css) && /\.days button\.vacia:not\(\.on\)\{opacity:\.55\}/.test(css), 'lista con scroll acotado y días libres al 55 %');
    ok(/\.dmonth\{position:sticky;top:0;/.test(css), 'cabecera de mes fija al desplazar');
    // Un solo mes y pocos días: sin cabeceras
    let c = C.newFestival({ nombre: 'Corto', fechaInicio: '2026-07-10', fechaFin: '2026-07-12', dayCutoff: '06:00' }).state;
    const t2 = panel({ 'showtime.festival': JSON.stringify(c) }, NOWc);
    ok(!/dmonth/.test(ultimo(t2, 'days')), 'evento corto: lista de siempre');
    eq(JSON.stringify(t2.T.dayStep()), JSON.stringify({ prev: '2026-07-10', next: '2026-07-12' }));
  });

  test('Dec. 125: «NOMBRE» alineado en Foco, flechas de día en un control agrupado y píldoras cortas en ⌘K', () => {
    const css = D.src('control.css'), js = D.src('control.js'), html = D.src('index.html');
    ok(/<th class="c-name[ "][^>]*><span class="dwl"><span>Nombre<\/span><\/span><button/.test(html) && /body\.focus #tbl thead th\.c-name\{padding-left:128px\}/.test(css), 'cabecera NOMBRE sobre el texto (128 px medidos: píldora 106 + hueco + relleno)');
    ok(/\.dstep\{display:inline-flex;align-items:stretch;border:1px solid var\(--hair2\);border-radius:8px;background:var\(--field\)\}/.test(css), 'grupo con borde y fondo');
    ok(!/\.dstep\{[^}]*overflow:hidden/.test(css), 'sin overflow:hidden: el menú de días no se recorta');
    ok(/\.dstep-b\.prev\{border-right:1px solid var\(--hair2\);/.test(css) && /\.dstep-b\.next\{border-left:1px solid var\(--hair2\);/.test(css), 'separadores');
    ok(/\.dstep \.menu#m-days\{border:0;border-radius:0;background:transparent\}/.test(css), 'el menú, integrado');
    ok(/function spotPillTxt\(k\) \{\s*if \(k === 'sc'\) return 'SC';\s*if \(k === 'hito'\) return tx\('MARC'\);\s*return tx\(PILL_TXT\[k\] \|\| ''\);/.test(js) && /esc\(spotPillTxt\(b\.kind\)\)/.test(js), '⌘K: SC y MARC (KT en inglés)');
    ok(/\.spot-pill\{[^}]*text-align:center;width:100%;box-sizing:border-box;/.test(css), 'la píldora llena su hueco de 62 px');
    ok(/\.dstep-b:hover:not\(:disabled\)\{color:#fff;background:rgba\(255,255,255,\.08\)\}/.test(css), 'flechas: realce al pasar');
    const tEn = dashboard({ 'showtime.config': JSON.stringify({ lang: 'en' }) });
    eq(tEn.env.win.ShowtimeI18n.tx('MARC'), 'KT', 'EN: KT');
    ok(/\.spot-pill\{[^}]*white-space:nowrap/.test(css) && !/\.spot-pill \.pl-l/.test(css), 'sin saltos de línea; fuera el truco de CSS anterior');
  });

  test('Dec. 126: en el Hub toda la fila abre su pantalla local, salvo el desplegable de zona y una fila apagada', async () => {
    const css = D.src('control.css'), js = D.src('control.js'), html = D.src('index.html');
    ['manager', 'confidence', 'backstage'].forEach(v => ok(new RegExp('<div class="hub-row" data-vista="' + v + '">').test(html), 'fila ' + v));
    ok(!/<button[^>]*hub-open[^>]*data-vista=/.test(html), 'el botón ya no lleva data-vista (lo hereda de su fila)');
    ok(/if \(e\.target\.closest\('select'\)\) return;/.test(js), 'el desplegable de zona no abre');
    ok(/\.hub-row\[data-vista\]\{cursor:pointer;user-select:none;-webkit-user-select:none;transition:background \.12s\}/.test(css) && /\.hub-row\[data-vista\]:hover\{background:rgba\(255,255,255,\.08\)\}/.test(css), 'cursor de mano y realce');
    const t = panel(); let n = 0; t.env.win.open = () => { n++; return { closed: false, focus() {}, postMessage() {}, close() {} }; };
    const row = (vista, over) => ({ target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista }, querySelector: s => s === 'button:disabled' && over === 'off' ? {} : null } : (q === 'select' && over === 'select' ? {} : null) } });
    t.env.fire('document', 'click', row('confidence', 'select')); await new Promise(r => setImmediate(r)); eq(n, 0, 'clic en el desplegable: no abre');
    t.env.fire('document', 'click', row('confidence', 'off')); await new Promise(r => setImmediate(r)); eq(n, 0, 'Confidence apagado (sin evento): la fila tampoco abre');
    t.env.fire('document', 'click', row('backstage')); await new Promise(r => setImmediate(r)); eq(n, 1, 'clic en la fila: abre');
  });

  test('Dec. 127: barra superior — Deshacer solo icono, «sin exportar» compacto, nombre del evento hasta 260 px y esquina derecha blindada', () => {
    const css = D.src('control.css'), html = D.src('index.html'), js = D.src('control.js');
    ok(/<button id="btn-undo" class="btn ghost icon" title="Deshacer \(⌘Z\)" aria-label="Deshacer"[^>]*><svg class="ic"><use href="#i-undo"\/><\/svg><\/button>/.test(html), 'Deshacer: solo icono, con título y etiqueta accesible');
    ok(!/btn-undo'\)\.querySelector\('span'\)/.test(js) && !/#btn-undo span/.test(css), 'sin el texto «Deshacer» ni sus reglas');
    ok(/#mods\{display:inline-block;width:8px;height:8px;[^}]*border-radius:50%;background:var\(--call\);box-shadow:0 0 6px rgba\(255,197,51,\.6\)/.test(css) && !/\.chip\.mods\{/.test(css), 'punto ámbar binario (dec. 128)');
    ok(/\.fest\{font-weight:600;[^}]*max-width:260px/.test(css) && /#fest-name\{max-width:260px\}/.test(css) && !/\.fest\{display:none\}/.test(css), 'el nombre del evento se ve (hasta 260 px)');
    ok(/\.bright\{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto\}/.test(css) && !/\.bright\{[^}]*margin-left:6px/.test(css), 'esquina derecha sin comprimir');
    ok(/@media \(max-width:1520px\)\{ \.mbtn \.mtxt\{display:none\} \.menus\.mcenter \.mbtn\{padding:0 8px\} \.dstep \.mbtn\{padding:0 10px\} \}/.test(css), 'portátil: menús del centro solo con icono');
    ok(/title="Chat con Producción"[^>]*><svg class="ic"><use href="#i-chat"\/>/.test(html) && /<symbol id="i-chat"/.test(html), 'Chat con su propio icono (no se confunde con Mensajes sin texto)');
    const F = fest(), t = panel({ 'showtime.festival': JSON.stringify(F.s), 'showtime.original': JSON.stringify(F.s) });
    const m = t.env.getEl('mods'); ok(m.hidden, 'sin cambios: oculto');
    const s = JSON.parse(JSON.stringify(F.s)); s.artists[0].nombre = 'Otro nombre';
    const t2 = panel({ 'showtime.festival': JSON.stringify(s), 'showtime.original': JSON.stringify(F.s) }), m2 = t2.env.getEl('mods');
    ok(!m2.hidden, 'con cambios: visible'); eq(m2.textContent, '', 'sin texto ni número: solo el punto');
    ok(/^Cambios sin exportar a JSON \(⌘S\) · 1 sin exportar · /.test(m2.title), 'qué ha cambiado, al pasar el ratón: ' + m2.title);
    eq(t2.env.getEl('fest-name').title, t2.env.getEl('fest-name').textContent, 'nombre entero al pasar el ratón');
  });

  test('Dec. 130: «Ver» con ancho fijo (sin salto de los menús vecinos al cambiar de vista)', () => {
    ok(/#view-lbl\{display:inline-block;min-width:96px;text-align:left\}/.test(D.src('control.css')));
  });

  test('Dec. 131/145: Configuración en 10 secciones plegables (<details>), Evento abierto; ajuste de reposo de las pantallas remotas', () => {
    const html = D.src('index.html'), css = D.src('control.css'), js = D.src('control.js');
    const cfg = html.slice(html.indexOf('<aside id="cfg"'), html.indexOf('</aside>', html.indexOf('<aside id="cfg"')));
    const ids = (cfg.match(/<details class="cfg-s" id="cfg-s-(\w+)"/g) || []).map(x => x.match(/cfg-s-(\w+)/)[1]);
    eq(ids.join(' '), 'lang fest stages live net styles screens msg audio meteo', 'las 10 (dec. 145 añade «Avisos de audio»), en orden');
    ok(!/<section class="cfg-s"/.test(cfg), 'ya no hay <section>');
    eq((cfg.match(/<details class="cfg-s" id="cfg-s-\w+" open>/g) || []).join(), '<details class="cfg-s" id="cfg-s-fest" open>', 'solo Evento abierto de entrada');
    eq((cfg.match(/<summary class="cfg-sum"><svg class="ic"><use href="#i-[a-z]+"\/><\/svg><h3[^>]*>[^<]+<\/h3><svg class="ic chev"><use href="#i-chev"\/><\/svg><\/summary>/g) || []).length, 10, 'cabecera: icono SVG (sin emojis, dec. 43), título y chevron');
    eq((cfg.match(/<details /g) || []).length, (cfg.match(/<\/details>/g) || []).length, 'bien cerradas');
    ok(/\.cfg-sum::-webkit-details-marker\{display:none\}/.test(css) && /\.cfg-sum\{[^}]*cursor:pointer;list-style:none;/.test(css) && /\.cfg-sum::marker\{content:''\}/.test(css), 'sin el triángulo del navegador');
    ok(/\.cfg-sum \.chev\{[^}]*transform:rotate\(-90deg\)/.test(css) && /\.cfg-s\[open\] > \.cfg-sum \.chev\{transform:none\}/.test(css), 'chevron que gira al abrir');
    ok(/\.cfg-s\{border-bottom:1px solid var\(--line\)\}/.test(css), 'filete entre secciones');
    ok(/if \(s\) s\.open = true;/.test(js), 'openConfig(sección) la abre (p. ej. «Configuración › Meteo»)');
    ok(/<select id="sc-park" data-sc="park\.mins" data-num><option value="5"[^>]*>5 minutos \(recomendado\)<\/option><option value="2"[^>]*>2 minutos<\/option><option value="10"[^>]*>10 minutos<\/option><option value="0"[^>]*>Nunca \(mantener siempre el último horario\)<\/option><\/select>/.test(html), 'selector de reposo en Pantallas y reposo');
    ok(/const \[g, k\] = el\.dataset\.sc\.split\('\.'\);/.test(js) && /el\.dataset\.num !== undefined\) \? Number\(el\.value\)/.test(js), 'se guarda como número en screens.park.mins (como el resto de ajustes de pantallas)');
  });

  test('Dec. 132: Hub en dos pestañas — Pantallas HDMI (Local) · Emisión y QR (Móviles); se recuerda la elegida; QR de un solo nivel', () => {
    const html = D.src('index.html'), css = D.src('control.css'), js = D.src('control.js');
    const hub = html.slice(html.indexOf('id="m-hub"'), html.indexOf('<button id="wake"'));
    ok(/<div class="htabs" role="tablist">\s*<button class="htab on" type="button" role="tab" data-htab="local"[^>]*><svg class="ic"><use href="#i-screen"\/><\/svg><span[^>]*>Pantallas HDMI \(Local\)<\/span><\/button>\s*<button class="htab" type="button" role="tab" data-htab="qr"[^>]*><svg class="ic"><use href="#i-cast"\/><\/svg><span[^>]*>Emisión y QR \(Móviles\)<\/span><i id="htab-led"/.test(hub), 'dos pestañas arriba, con iconos SVG');
    const loc = hub.slice(hub.indexOf('id="hub-local"'), hub.indexOf('id="hub-qr"')), qr = hub.slice(hub.indexOf('id="hub-qr"'));
    ok(/data-vista="manager"[\s\S]*id="lv-zone"[\s\S]*data-vista="backstage"[\s\S]*id="lv-gestor"[\s\S]*id="lv-standby"/.test(loc) && !/cast-/.test(loc), 'HDMI: filas y pie de acciones locales (v20261169: Gestionar antes que Standby); nada de QR');
    // v20261169: orden REAL del HTML (Tab y lector de pantalla = orden visual): Manager · Confidence · Backstage · Gestionar… · (separación) · Standby
    const acts = loc.slice(loc.indexOf('hub-card hub-list hub-acts"'));
    ok(/^hub-card hub-list hub-acts">\s*<button class="mitem lv" id="lv-gestor">[\s\S]*?<\/button>\s*<button class="mitem lvcloseall" id="lv-closeall" hidden>[\s\S]*?<\/button>\s*<button class="mitem lv lvstb lvsep" id="lv-standby"[\s\S]*?<\/button>\s*<\/div>/.test(acts), 'Gestionar (y Cerrar todas, si aparece) y, tras la separación, Standby el último');
    ok(/\.hub-acts>\.lvsep\{margin-top:6px;border-top-color:var\(--line2\)\}/.test(D.src('control.css')), 'separación solo visual (sin control nuevo)');
    ok(/id="hub-qr" role="tabpanel" hidden/.test(hub) && /id="cast-bar"[\s\S]*id="cast-net"[\s\S]*data-tab="staff"[\s\S]*data-tab="remote"[\s\S]*data-tab="produccion"[\s\S]*id="cast-sec"/.test(qr), 'QR: estado y Empezar/Parar, transporte, 3 botones y, al pie, jornada y claves');
    ok(!/class="hub-h"/.test(hub), 'sin las cabeceras de bloque (las pestañas las sustituyen)');
    ok(/\.htab\.on\{background:rgba\(255,255,255,\.1\);color:#fff\}/.test(css) && /\.hpane\[hidden\]\{display:none\}/.test(css), 'segmentado: activa con fondo translúcido y texto blanco');
    ok(/<select class="cvsel" data-cvs="1"/.test(js) && /<select class="czone" data-rzs="1"/.test(js), 'Staff y mando eligen pantalla y zona con un desplegable (sin segundo nivel de botones)');
    const t = panel(), el = id => t.env.getEl(id);
    eq(el('hub-local').hidden, false, 'de entrada, HDMI'); eq(el('hub-qr').hidden, true);
    t.env.fire('document', 'click', { stopPropagation() {}, target: { closest: q => q === '#m-hub .htab' ? { dataset: { htab: 'qr' } } : null } });
    eq(el('hub-local').hidden, true, 'pestaña QR'); eq(el('hub-qr').hidden, false); eq(t.env.storage.get('showtime.hub.tab'), 'qr', 'se recuerda');
    const t2 = panel({ 'showtime.hub.tab': 'qr' });
    eq(t2.env.getEl('hub-qr').hidden, false, 'al volver a abrir el Dashboard, la misma pestaña');
    // El desplegable del QR de Staff cambia la pantalla que abre el QR
    t.T.setRoom({ sala: 'abcdEFGHIJKLMNOP', k: 'k', p: 'p' }); t.T.fakeEm({ push() {}, setZoneKeys: async () => {} }, { links: [{ name: 'A', state: 'on' }], viewers: 0, remotes: 0, devices: [] });
    t.env.fire('document', 'change', { target: { matches: q => q === '#cast-staff [data-cvs]', value: 'backstage' } });
    ok(/vista=backstage/.test(el('cast-staff').dataset.url || ''), 'QR de Staff → Backstage: ' + el('cast-staff').dataset.url);
    t.T.fakeEm(null, null);
  });
  test('Dec. 132: logo del evento en Configuración › Evento — miniatura y Quitar; quitarlo se puede deshacer y queda sin exportar', () => {
    const L = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const F = fest(), s = JSON.parse(JSON.stringify(F.s)); s.event.showtimeLogo = L;
    const t = panel({ 'showtime.festival': JSON.stringify(s), 'showtime.original': JSON.stringify(s) });
    t.env.fire('btn-cfg', 'click', {});
    const h = t.env.getEl('cfg-fest').innerHTML;
    ok(h.indexOf('<img id="f-logo-img" src="' + L + '"') > 0 && /data-act="logo-del"/.test(h) && /Cambiar imagen/.test(h), 'miniatura, Cambiar y Quitar');
    ok(/accept="image\/png,image\/jpeg,image\/webp,image\/svg\+xml/.test(h), 'PNG, JPG, WebP y SVG');
    t.env.fire('document', 'click', { target: { closest: q => q === '[data-act="logo-del"]' ? {} : null } });
    return new Promise(r => setTimeout(r, 0)).then(() => {
      eq('showtimeLogo' in t.read('showtime.festival').event, false, 'quitado');
      eq(t.env.getEl('mods').hidden, false, 'cuenta como cambio sin exportar');
      const t3 = panel({ 'showtime.festival': JSON.stringify(F.s) }); t3.env.fire('btn-cfg', 'click', {});
      ok(/Subir imagen/.test(t3.env.getEl('cfg-fest').innerHTML) && !/f-logo-img/.test(t3.env.getEl('cfg-fest').innerHTML), 'sin logo: solo Subir imagen');
      const js = D.src('control.js');
      ok(/Math\.min\(1, 480 \/ img\.naturalWidth, 240 \/ img\.naturalHeight\)/.test(js) && /cv\.toDataURL\('image\/webp', 0\.86\)/.test(js), 'se reduce a 480×240 (WebP) al subir');
      ok(/logo: C\.eventLogo\(FEST\)/.test(js), 'la hoja impresa recibe el logo');
    });
  });

  test('Dec. 133: la fila en curso es un resalte neutro (blanco en Studio, amarillo en Stage), nunca rojo', () => {
    const css = D.src('control.css');
    ok(/tbody tr\.playing\{background:rgba\(255,255,255,\.05\);box-shadow:inset 3px 0 0 rgba\(255,255,255,\.45\)\}/.test(css), 'Studio: fondo y filete blancos');
    ok(/tbody tr\.playing td\.mo\{background:color-mix\(in srgb,#fff 5%,var\(--panel\)\)\}/.test(css), 'la columna fija, igual');
    ok(/body\[data-ps="stage"\] tbody tr\.playing\{background:rgba\(255,214,0,\.07\);box-shadow:inset 3px 0 0 #FFD600\}/.test(css), 'Stage: amarillo');
    ok(!/tr\.playing[^{]*\{[^}]*(--accent|#ff6363|#e94560)/.test(css), 'ninguna regla de la fila en curso usa el rojo del acento');
  });
  test('Dec. 133: Gestor — 3ª columna ZONA / FILAS: zona en Confidence, filas (Auto · 2–6) en Manager, «—» en Backstage; llega a la ventana y vuelve en su latido', async () => {
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); }, close() { this.closed = true; } };
    t.env.win.open = () => w;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    const [a] = t.T.winState();
    t.T.setWinRows(a.id, '4');
    ok(msgs.some(m => m.type === 'setRows' && m.filas === 4), 'la ventana Manager recibe 4 filas');
    eq(t.T.winState()[0].filas, 4);
    t.T.setWinRows(a.id, 'auto'); ok(msgs.some(m => m.type === 'setRows' && m.filas === null), 'Auto');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'vistaState', vista: 'manager', zona: null, filas: 5, standby: false }, source: w });
    eq(t.T.winState()[0].filas, 5, 'lo que dice la ventana (p. ej. tras recargarla) manda');
    const Vs = require('../vistas.js');
    eq(Vs.MGR_ROWS.join(), 'auto,2,3,4,5,6'); eq(Vs.normRows('4'), 4); eq(Vs.normRows('auto'), null); eq(Vs.normRows(9), null); eq(Vs.normRows(1), null); eq(Vs.normRows(null), null);
    eq(t.env.win.ShowtimeI18n.tx('Auto (según pantalla)', null, 'en'), 'Auto (fit screen)'); eq(t.env.win.ShowtimeI18n.tx('6 filas (compacto)', null, 'en'), '6 rows (compact)');
    eq(t.env.win.ShowtimeI18n.tx('Zona / Filas', null, 'en'), 'Stage / Rows'); eq(t.env.win.ShowtimeI18n.tx('Filas', null, 'en'), 'Rows');
    const js = D.src('control.js');
    ok(/hz\.textContent = tx\(m && !c \? 'Filas' : c && !m \? 'Zona' : 'Zona \/ Filas'\)/.test(js), 'cabecera según lo abierto: Filas · Zona · Zona / Filas');
    ok(/if \(t\.classList\.contains\('gv-zona'\) && x\.vista === 'manager'\) \{ setWinRows\(id, t\.value\);/.test(js), 'en Manager, la 3ª columna son las filas');
    ok(/zs\.disabled = !conf && !mgr;/.test(js), 'Backstage: deshabilitado con «—»');
  });

  test('Dec. 135: Gestor › ↺ Restablecer manda a cada ventana Live abierta que vuelva a su pantalla de fábrica', async () => {
    const t = panel(), msgs = [];
    const w = { closed: false, focus() {}, postMessage(m) { msgs.push(m); }, close() {} };
    t.env.win.open = () => w;
    t.env.fire('document', 'click', { target: { closest: q => q === '#m-hub [data-vista]' ? { dataset: { vista: 'manager' } } : null } });
    await new Promise(r => setImmediate(r));
    const [a] = t.T.winState(); t.T.setWinRows(a.id, '4');
    t.T.resetWinLayout(a.id);
    ok(msgs.some(m => m.type === 'resetLayout'), 'la ventana recibe la orden'); eq(t.T.winState()[0].filas, null, 'y vuelve a Auto');
    ok(/data-gv="reset"/.test(D.src('control.js')) && /openIds\(\)\.forEach\(id => resetWinLayout\(id\)\)/.test(D.src('control.js')), 'botón en la cabecera del gestor: todas las abiertas');
  });

  test('Dec. 136: todas las ventanas con el mismo acabado — degradado, tarjetas, campos de alto contraste; Pegar horario en 4 tarjetas', () => {
    const css = D.src('control.css'), html = D.src('index.html');
    ok(/\.modal-box,\.imp-box,\.spot-box\{/.test(css) && !/\n\.spot-box\{[^}]*background/.test(css), '⌘K, igual que las ventanas (una sola regla)');
    ok(css.indexOf(':where(body:not([data-ps="stage"])) :is(.modal-box,.imp-box) :is(input[type=text],input[type=number],input[type=date],input[type=time],input[type=search],input:not([type]),select,textarea):where(:not(:disabled)){background-color:#08090c;border:1px solid rgba(255,255,255,.12)}') >= 0, 'campos: fondo #08090c y borde nítido (background-color, dec. 112); Stage conserva su negro y amarillo');
    ok(/,select,textarea\):focus\{outline:none;border-color:rgba\(255,255,255,\.42\);box-shadow:0 0 0 3px rgba\(255,255,255,\.07\)\}/.test(css), 'halo blanco al escribir');
    const imp = html.slice(html.indexOf('<div id="imp"'), html.indexOf('<datalist id="zones-dl"'));
    eq((imp.match(/<div class="mcard-h"[^>]*>([^<]+)<\/div>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(' · '), 'Horario a importar · Opciones de importación · Columnas del archivo · Vista previa · Líneas no incluidas · Fila manual', 'Pegar horario: 4 tarjetas en orden y, debajo de la vista previa, las líneas no incluidas (v20261170, oculto si no hay) y la ficha manual (plegada hasta pedirla)');
    ok(/class="mcard imp-card imp-srccard">[\s\S]*id="imp-text"/.test(imp) && /class="mcard imp-card imp-prevcard"><div class="imp-prevhead"><div class="mcard-h"[^>]*>Vista previa<\/div>[\s\S]*?<\/div><div id="imp-prevwrap" class="imp-prevwrap"><table id="imp-prev"/.test(imp), 'texto y vista previa en su tarjeta; los id no cambian');
    ok(/\.imp-prevcard\{flex:1 0 auto;display:flex;flex-direction:column\}/.test(css) && /\.imp-prevwrap\{flex:1;min-height:120px;/.test(css), 'la vista previa ocupa el alto que sobra y nunca baja de su mínimo (dec. 155)');
    ok(/\.imp-box\{[^}]*overflow:auto;scroll-padding-bottom:128px\}/.test(css) && /\.imp-foot\{[^}]*position:sticky;bottom:calc\(-1 \* var\(--imp-pad,20px\)\);/.test(css), 'si no cabe, la ventana hace scroll y el pie queda a la vista');
  });

  test('Dec. 137: Gestor — ↺ por ventana (antes de ✕) y «↺ Reset» igual en los dos idiomas; el de arriba sigue siendo para todas', () => {
    const js = D.src('control.js');
    ok(/'<button class="gv-x gv-rst" type="button" data-gv="reset-one"[^']*'[^\n]*<use href="#i-undo"\/><\/svg><\/button>' \+\s*'<button class="gv-x" type="button" data-gv="close"/.test(js), '↺ justo antes de ✕');
    ok(/if \(b\.dataset\.gv === 'reset-one'\) \{ resetWinLayout\(id\); toast\('Pantalla Live restablecida: valores de fábrica'\); \}/.test(js), 'solo esa ventana');
    ok(/if \(b\.dataset\.gv === 'reset'\) \{ openIds\(\)\.forEach\(id => resetWinLayout\(id\)\);/.test(js), 'el de arriba, todas');
    ok(/<span>' \+ tx\('Standby'\) \+ '<\/span><span><\/span><span><\/span><\/div>'/.test(js), 'cabecera con 7 huecos');
    const I = require('../i18n.js');
    eq(I.tx('↺ Reset', null, 'es'), '↺ Reset'); eq(I.tx('↺ Reset', null, 'en'), '↺ Reset'); ok(!I.txHas('↺ Restablecer'), 'fuera el texto anterior');
    eq(I.tx('Restablecer esta ventana', null, 'en'), 'Reset this window');
  });

  test('Dec. 138: En escena del Dashboard — mismo criterio que la Live (tarea en 2 líneas, hueco con la zona como título, sin «después»)', () => {
    const js = D.src('control.js'), a = js.indexOf('hueco sin cambio real (decisión 76)'), blk = js.slice(a, js.indexOf('rows.sort((a, b) => a.o - b.o);', a));
    ok(/zn: co\.stage/.test(js) && /'<div class="v-row co idle" style="--c:' \+ col \+ '"><div class="v-meta">— ' \+ tx\('Sin actividad'\) \+ ' —<\/div>'/.test(blk), 'hueco: la zona arriba del grupo (dec. 149) y «— Sin actividad —»');
    ok(/'<div class="v-row tarea"><div class="v-name">' \+ esc\(b\.name\) \+ '<\/div>'/.test(blk) && !/tx\('Tarea'\) \+ ' · '/.test(blk), 'tarea: sin «Tarea ·»');
    const idleAndTask = blk.slice(0, blk.indexOf("rows.push(Object.assign(z, { h: '<div class=\"v-row co' + (co.standby")) + blk.slice(blk.indexOf('C.tasksNow('));
    ok(!/tx\('después'\)/.test(idleAndTask), 'sin «después» en el hueco ni en la tarea (CHANGEOVER y STANDBY lo conservan)');
  });

  test('Dec. 140: Gestor — al cambiar las filas de una Manager, aviso «N filas fijas» / «filas automáticas»', () => {
    ok(/toast\(filas \? tx\('Pantalla Live: \{n\} filas fijas', \{ n: filas \}\) : tx\('Pantalla Live: filas automáticas'\)\)/.test(D.src('control.js')));
    const I = require('../i18n.js'); eq(I.tx('Pantalla Live: {n} filas fijas', { n: 3 }, 'en'), 'Live screen: 3 fixed rows'); eq(I.tx('Pantalla Live: filas automáticas', null, 'en'), 'Live screen: automatic rows');
  });

  test('Dec. 143: Gestor — el reloj no pisa el desplegable que estás usando (vista y zona/filas responden al primer clic)', () => {
    const js = D.src('control.js');
    ok(/if \(vs && document\.activeElement !== vs && vs\.value !== x\.vista\) vs\.value = x\.vista;/.test(js), 'vista');
    ok(/if \(document\.activeElement !== zs\) \{\s*const z = conf \?/.test(js), 'zona / filas');
  });

  // ── Dec. 153 · estado sin evento (#empty) centrado de verdad: Grid a todo el hueco, sin desplazamientos ni transform ─────
  test('#empty: ocupa todo el hueco bajo la barra y centra la tarjeta con Grid; sin offsets, transform ni márgenes automáticos', () => {
    const css = D.src('control.css').replace(/\/\*[\s\S]*?\*\//g, ''), idx = D.src('index.html');
    const rules = sel => (css.match(new RegExp('(^|[}\\n])\\s*([^{}]*)\\{([^}]*)\\}', 'g')) || []).map(r => /([^{}]*)\{([^}]*)\}/.exec(r)).filter(Boolean)
      .filter(m => m[1].split(',').some(x => sel.test(x.trim()))).map(m => m[2]).join(';');
    ok(/<section id="empty" class="empty" hidden>\s*<div class="onb">/.test(idx), 'estructura: #empty > .onb, hermano de <main>');
    const em = rules(/^#empty$/);
    ok(/display:grid/.test(em) && /place-items:center/.test(em), '#empty: Grid con place-items:center');
    ok(/align-self:stretch/.test(em) && /(?:^|;)width:100%/.test(em) && /inline-size:100%/.test(em) && /min-width:0/.test(em) && /flex:1 1 auto/.test(em), 'se estira a todo el ancho y alto libres');
    ok(/grid-template-columns:minmax\(0,1fr\)/.test(em), 'una columna a todo el ancho (la tarjeta se centra dentro)');
    ok(/#empty\[hidden\]\{display:none\}/.test(css), 'oculto de verdad cuando hay evento');
    // Nada de centrar con trucos: ni transform/translate, ni left/right/margin fijos, ni márgenes automáticos dentro de #empty
    const all = rules(/^(#empty|\.empty)(\s|$|\[|>|:)/) + ';' + rules(/^(#empty|\.empty)\s+\.onb$/);
    ok(!/(?:^|;)\s*(?:transform|translate|rotate|scale)\s*:|translate\(|(?:^|;)\s*(left|right|inset)\s*:|margin-left\s*:\s*-?\d|margin-right\s*:\s*-?\d|position\s*:\s*(absolute|fixed|relative)/.test(all), 'sin desplazamientos ni transform: ' + all);
    ok(!/(?:^|;)\s*margin\s*:\s*[^;]*auto/.test(all), 'sin márgenes automáticos para centrar #empty');
    ok(!/^\.empty \.onb/m.test(css.replace(/\.empty \.onb-[ts]/g, '')), 'la tarjeta de #empty ya no se centra con margin:auto');
    ok(!/@media[^{]*\{[^@]*#empty/.test(css), 'sin valores por dispositivo');
    // Lo demás, igual: main.vacia y la tarjeta de evento sin entradas (#list-empty)
    ok(/\.list-empty \.onb\{margin:auto\}/.test(css), '#list-empty sigue como estaba');
    ok(/main\.vacia\{grid-template-columns:minmax\(0,1fr\)\}/.test(css) && /main\.vacia \.list-empty\{padding:16px 16px 9vh\}/.test(css), 'main.vacia sin tocar');
    ok(/\.onb\{width:min\(560px,100%\);/.test(css) && /body\[data-ps="stage"\] \.onb\{background:#000;/.test(css), 'la tarjeta (Studio y Stage) igual');
  });

  test('Barra superior: si no cabe, pasa a otra fila en vez de desbordar (el desborde ampliaba y alejaba la página en tablet vertical)', () => {
    const css = D.src('control.css').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(/\.bar\{flex-wrap:wrap;row-gap:6px\}/.test(css), '.bar con flex-wrap:wrap');
    ok(!/\.bar\{[^}]*flex-wrap:nowrap/.test(css) && !/\.bar\{[^}]*(min-width:\s*\d|width:\s*\d{3,}px)/.test(css), 'nada que la obligue a una línea o a un ancho fijo');
    ok(!/@media[^{]*orientation/.test(css), 'sin excepciones por orientación');
    ok(/\.bright\{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto\}/.test(css), 'el bloque de la derecha sigue entero (⚙, idioma, reloj) y a la derecha');
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
