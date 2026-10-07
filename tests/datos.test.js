/* Tests de datos.js — sincronización entre ventanas (Dashboard ↔ Pantallas Live) y reconexión.
 * Ordenador:  node tests/datos.test.js
 * Cada «ventana» es un contexto aparte con su propio almacenamiento (como Firefox con doble clic, donde cada archivo
 * local tiene el suyo). Se unen por un BroadcastChannel de mentira, por postMessage (ventana abierta / opener) o por
 * el evento «storage», igual que en el navegador.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('datos.test.js: solo en Node (node tests/datos.test.js)'); return; }
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'datos.js'), 'utf8');
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  /** Red de ventanas: BroadcastChannel compartido (si `bc`) y mensajes directos síncronos (como postMessage, pero sin esperar). */
  function red(opts) {
    const o = opts || {}, channels = [];
    function ventana(nombre, w) {
      w = w || {};
      const mem = new Map(Object.entries(w.storage || {})), handlers = {};
      const win = {
        name: nombre, closed: false, opener: null, location: { hash: w.hash || '' },
        localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => { if (win._full) throw new Error('QuotaExceededError'); mem.set(k, String(v)); }, removeItem: k => mem.delete(k) },
        addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
        postMessage(m, origin, from) { (handlers.message || []).forEach(fn => fn({ data: JSON.parse(JSON.stringify(m)), source: from || win._lastFrom || null })); },
        console: { error() {}, log() {} }, JSON, Date, Math, Array, Object, String, Number, Boolean, Map, Set, Error
      };
      win.BroadcastChannel = function (name) {
        if (!o.bc) throw new Error('sin BroadcastChannel');
        const ch = { name, owner: win, onmessage: null, postMessage(m) { channels.filter(c => c !== ch && c.name === name && !c.owner.closed).forEach(c => c.onmessage && c.onmessage({ data: JSON.parse(JSON.stringify(m)) })); }, close() {} };
        channels.push(ch); return ch;
      };
      win.window = win; win.self = win;
      vm.createContext(win);
      vm.runInContext(SRC, win, { filename: 'datos.js' });
      const Dt = win.ShowtimeDatos, cambios = [];
      Dt.onChange(t => cambios.push(t));
      win.fireStorage = key => (handlers.storage || []).forEach(fn => fn({ key }));
      return { win, Dt, mem, cambios, nombre, handlers };
    }
    /** Mensajes directos entre dos ventanas sabiendo quién es quién (source). */
    function enlazar(a, b) {
      const pa = a.win.postMessage, pb = b.win.postMessage;
      a.win.postMessage = (m, org, from) => pa.call(a.win, m, org, from || b.win);
      b.win.postMessage = (m, org, from) => pb.call(b.win, m, org, from || a.win);
    }
    return { ventana, enlazar };
  }
  const FEST = n => ({ event: { nombre: 'Evento ' + n, fechaInicio: '2026-07-10', fechaFin: '2026-07-10' }, escenarios: [], artists: [] });

  test('Dashboard → Live por BroadcastChannel: festival, configuración, CALL, mensaje y avisos llegan y se avisa', () => {
    const r = red({ bc: true }), dash = r.ventana('dash'), live = r.ventana('live');
    dash.Dt.setFestival(FEST(1));
    eq(live.Dt.getFestival().event.nombre, 'Evento 1'); ok(live.cambios.indexOf('festival') >= 0);
    dash.Dt.setConfig({ style: 'escenario' }); eq(live.Dt.getConfig().style, 'escenario');
    dash.Dt.markCallDone('Banda@1', 100); eq(live.Dt.getCallDone().join(), 'Banda@1');
    dash.Dt.setFlash('ÚLTIMO TEMA'); eq(live.Dt.getFlash().text, 'ÚLTIMO TEMA');
    dash.Dt.addAviso('Curfew 23:00', true, 'Producción'); eq(live.Dt.getAvisos()[0].text, 'Curfew 23:00');
    eq(live.cambios.join(), 'festival,config,callDone,flash,avisos');
  });
  test('Firefox con doble clic (sin BroadcastChannel ni almacenamiento compartido): la Live abierta recibe por mensaje directo', () => {
    const r = red({ bc: false }), dash = r.ventana('dash'), live = r.ventana('live');
    r.enlazar(dash, live);
    live.win.opener = dash.win;
    dash.Dt.addPeer(live.win);                    // la ventana que abrió el Dashboard
    dash.Dt.setFestival(FEST(2));
    eq(live.Dt.getFestival().event.nombre, 'Evento 2', 'llega aunque no compartan almacenamiento');
    live.Dt.markCallDone('X@1', 0);               // y al revés: el OK de CALL hecho en la Live vuelve al Dashboard por el opener
    eq(dash.Dt.getCallDone().join(), 'X@1');
  });
  test('Live recién abierta (o recargada): pide los datos (hello) y recibe el estado completo', () => {
    const r = red({ bc: true }), dash = r.ventana('dash');
    dash.Dt.setFestival(FEST(3)); dash.Dt.setConfig({ mode: 'all' }); dash.Dt.setFlash('HOLA'); dash.Dt.markCallDone('A@1', 0);
    const live = r.ventana('live');               // llega después: no tiene nada
    eq(live.Dt.getFestival(), null);
    live.Dt.hello();
    eq(live.Dt.getFestival().event.nombre, 'Evento 3'); eq(live.Dt.getConfig().mode, 'all'); eq(live.Dt.getFlash().text, 'HOLA'); eq(live.Dt.getCallDone().join(), 'A@1');
    ok(live.cambios.indexOf('snapshot') >= 0, 'avisa a la Live para repintar');
  });
  test('Dashboard recargado (perdió la Live): el ping de la Live la recupera, recibe el estado y vuelven a llegarle los cambios', () => {
    const r = red({ bc: false }), dash = r.ventana('dash', { storage: { 'showtime.festival': JSON.stringify(FEST(4)) } }), live = r.ventana('live');
    r.enlazar(dash, live);
    live.win.opener = dash.win; live.win.name = 'showtime-live-manager';
    const vistos = []; dash.Dt.onPeer((w, m) => vistos.push(m.name));
    live.Dt.ping();
    eq(vistos.join(), 'showtime-live-manager', 'el Dashboard la reconoce por su nombre');
    eq(live.Dt.getFestival().event.nombre, 'Evento 4', 'y le manda el estado completo');
    live.Dt.ping();
    eq(vistos.length, 1, 'solo cuenta la primera vez');
    dash.Dt.setFestival(FEST(5));
    eq(live.Dt.getFestival().event.nombre, 'Evento 5', 'los cambios vuelven a llegar al momento');
  });
  test('Respaldo por el evento «storage» (mismo navegador): avisa del tipo de cambio; claves ajenas, nada', () => {
    const r = red({ bc: false }), live = r.ventana('live');
    live.win.fireStorage('showtime.festival'); live.win.fireStorage('showtime.avisos'); live.win.fireStorage('otra.app');
    eq(live.cambios.join(), 'festival,avisos');
  });
  test('Mensajes de otra app o mal formados: se ignoran', () => {
    const r = red({ bc: true }), live = r.ventana('live');
    live.win.postMessage({ app: 'otra', type: 'festival', festival: FEST(9) });
    live.win.postMessage(null); live.win.postMessage({ app: 'showtime', type: 'raro' });
    eq(live.Dt.getFestival(), null); eq(live.cambios.length, 0);
  });
  test('Una ventana cerrada deja de recibir y no rompe nada', () => {
    const r = red({ bc: false }), dash = r.ventana('dash'), live = r.ventana('live');
    r.enlazar(dash, live); dash.Dt.addPeer(live.win);
    live.win.closed = true;
    dash.Dt.setFestival(FEST(6));
    eq(live.Dt.getFestival(), null, 'cerrada: no recibe');
    eq(dash.Dt.getFestival().event.nombre, 'Evento 6');
  });
  test('Live de Staff (QR, solo lectura): no escribe en este navegador ni manda nada; aplica lo que llega por la emisión', () => {
    const r = red({ bc: true }), dash = r.ventana('dash'), staff = r.ventana('staff', { hash: '#sala=abcdefghijklmnop&k=x&p=y' });
    ok(staff.Dt.READONLY);
    staff.Dt.setFestival(FEST(7)); staff.Dt.setFlash('NO'); staff.Dt.markCallDone('Z@1', 0);
    eq(dash.Dt.getFestival(), null, 'nada sale de la Live de Staff');
    eq(staff.mem.size, 0, 'nada se guarda en el almacenamiento del móvil');
    dash.Dt.setFestival(FEST(8));
    eq(staff.Dt.getFestival(), null, 'ni escucha el canal local: sus datos son los de la emisión');
    staff.Dt.loadSnapshot({ festival: FEST(10), config: { style: 'neutro' }, callDone: ['Q@1'], flash: null, avisos: [] });
    eq(staff.Dt.getFestival().event.nombre, 'Evento 10'); eq(staff.Dt.getConfig().style, 'neutro'); eq(staff.Dt.getCallDone().join(), 'Q@1');
    eq(staff.cambios.join(), 'snapshot');
  });
  test('Almacenamiento lleno: avisa al dejar de guardar y otra vez al recuperarse (los datos siguen saliendo a la Live)', () => {
    const r = red({ bc: true }), dash = r.ventana('dash'), live = r.ventana('live'), avisos = [];
    dash.Dt.onSaveState((okw, key) => avisos.push(okw + ':' + key));
    dash.win._full = true;
    dash.Dt.setFestival(FEST(11));
    eq(live.Dt.getFestival().event.nombre, 'Evento 11', 'la Live lo recibe igual');
    dash.Dt.setFestival(FEST(12));
    dash.win._full = false;
    dash.Dt.setFestival(FEST(13));
    eq(avisos.join(), 'false:showtime.festival,true:showtime.festival', 'un aviso al fallar y otro al volver (no uno por escritura)');
  });

  let pass = 0, fail = 0;
  tests.forEach(([name, fn]) => { try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } });
  console.log('Datos: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
  if (fail) process.exitCode = 1;
})();
