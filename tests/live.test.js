/* Tests de live.js (Pantalla Live) — sin dependencias.
 * Ordenador:  node tests/live.test.js
 * Carga live.js en un navegador simulado (tests/_dom.js), como Dashboard, como Staff (QR) y como Producción (QR con «id»).
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('live.test.js: solo en Node (node tests/live.test.js)'); return; }
  const vm = require('vm');
  const D = require('./_dom.js'), E = require('../emision.js');
  const MODULOS = ['core.js', 'meteo.js', 'datos.js', 'emision.js', 'vistas.js', 'marca.js', 'i18n.js', 'live.js'];

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  let ROOM = null;
  const hashOf = url => url.slice(url.indexOf('#'));
  /** Arranca live.js. opts: { hash, search }. El envío a Producción se intercepta (no hay red). */
  function arrancar(opts) {
    const env = D.makeEnv(Object.assign({ cripto: true }, opts));
    if (opts && opts.rec) {   // graba las propiedades CSS que pone live.js en <html> (p. ej. --info-w)
      const html = env.getEl('html'), st = { setProperty: (k, v) => { opts.rec[k] = v; }, removeProperty: k => { delete opts.rec[k]; }, getPropertyValue: k => opts.rec[k] || '' };
      env.win.document.documentElement = new Proxy(html, { get(t, k) { return k === 'style' ? st : t[k]; } });
    }
    const sent = [];
    if (opts && opts.opener) env.win.opener = opts.opener;
    env.getEl('msgdock').hidden = true; env.getEl('pmodal').hidden = true; env.getEl('chatdock').hidden = true;   // como en live.html
    D.cargar(env, MODULOS.slice(0, 4));
    const ctl = { fail: false };
    env.win.ShowtimeEmision.Receptor.prototype.sendProdMessage = async function (m) { if (ctl.fail) return { ok: false, msg: 'Sin conexión' }; sent.push(m); return { ok: true, msg: 'Enviado' }; };
    env.win.ShowtimeEmision.Receptor.prototype.start = async function () { env.win._R = this; };
    ctl.wakes = 0; env.win.ShowtimeEmision.Receptor.prototype.wake = function () { ctl.wakes++; };
    D.cargar(env, MODULOS.slice(4));
    return { env, sent, ctl, R: () => env.win._R, body: env.getEl('body'), dock: env.getEl('msgdock'), title: () => env.win.document.title };
  }
  test('Idioma: la Live sigue el idioma de la configuración del Panel', () => {
    eq(arrancar({ storage: { 'showtime.config': JSON.stringify({ lang: 'en' }) } }).env.win.ShowtimeI18n.getLang(), 'en');
    eq(arrancar({}).env.win.ShowtimeI18n.getLang(), 'es', 'sin nada: español');
  });
  // ── Idioma, Fase 2: las 4 vistas Live cambian al instante con el idioma que manda el Panel (emisión) y vuelven ──
  const snapL = (lang, fest, extra) => Object.assign({ festival: fest || null, config: { lang }, callDone: [], flash: null, avisos: [], meteo: null }, extra || {});
  async function staffL(search) { ROOM = ROOM || await E.newRoom(); return arrancar({ search, hash: hashOf(E.staffUrl(ROOM, 'http://x/')) }); }
  test('Idioma (Fase 2): Manager sin evento — cabecera, aviso y tarjetas pasan a inglés al llegar lang:en y vuelven con lang:es', async () => {
    const t = await staffL('?vista=manager'), Dt = t.env.win.ShowtimeDatos, I = t.env.win.ShowtimeI18n, el = id => t.env.getEl(id);
    Dt.loadSnapshot(snapL('es'));
    eq(el('evn-name').textContent, 'SIN EVENTO'); eq(el('banner').textContent, 'ESPERANDO LOS DATOS DE LA SALA…');
    ok(/SIN EVENTO CARGADO/.test(el('now-list').innerHTML));
    Dt.loadSnapshot(snapL('en'));
    eq(I.getLang(), 'en', 'el idioma llega con la emisión');
    eq(el('evn-name').textContent, 'NO EVENT'); eq(el('banner').textContent, 'WAITING FOR THE ROOM DATA…');
    ok(/NO EVENT LOADED/.test(el('now-list').innerHTML), 'EN ESCENA');
    eq(el('rlbl').textContent, 'auto height');
    Dt.loadSnapshot(snapL('es'));
    eq(el('evn-name').textContent, 'SIN EVENTO', 'vuelve al español'); ok(/SIN EVENTO CARGADO/.test(el('now-list').innerHTML));
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Idioma (Fase 2): Manager con evento — tarjetas EN ESCENA / SIGUIENTE / CALL en inglés', async () => {
    const t = await staffL('?vista=manager'), Dt = t.env.win.ShowtimeDatos, C = t.env.win.ShowtimeCore, el = id => t.env.getEl(id);
    const F = C.demoFestival(Math.floor(C.nowAbs()));
    Dt.loadSnapshot(snapL('en', F, { config: { lang: 'en', mode: 'all', day: 'all' } }));
    const now = el('now-list').innerHTML + el('next-list').innerHTML + el('call-list').innerHTML;
    ok(/min left|Finished|EXTRA TIME|CHANGEOVER|NO ACTIVITY/.test(now), 'textos de las tarjetas en inglés: ' + now.slice(0, 200));
    ok(!/restantes|Finalizado|SIN ACTIVIDAD|quedan /.test(now), 'sin español');
    Dt.loadSnapshot(snapL('es', F, { config: { lang: 'es', mode: 'all', day: 'all' } }));
    const es = el('now-list').innerHTML + el('next-list').innerHTML;
    ok(!/ min left|NO ACTIVITY/.test(es), 'vuelve al español');
  });
  test('Idioma (Fase 2): Backstage — la cinta en inglés (ON TIME · ALL CLEAR) y de vuelta', async () => {
    const t = await staffL('?vista=backstage'), Dt = t.env.win.ShowtimeDatos, C = t.env.win.ShowtimeCore, el = id => t.env.getEl(id);
    const F = C.demoFestival(Math.floor(C.nowAbs()));
    Dt.loadSnapshot(snapL('en', F));
    ok(/ON TIME · ALL CLEAR/.test(el('ticker').innerHTML), el('ticker').innerHTML.slice(0, 160));
    Dt.loadSnapshot(snapL('es', F));
    ok(/EN HORA · SIN INCIDENCIAS/.test(el('ticker').innerHTML), 'vuelve al español');
  });
  test('Origen (dec. 106): el mensaje en pantalla lleva [ZONA] / [PRODUCCIÓN] encima; la cinta, igual y en inglés [PRODUCTION]', async () => {
    const t = await staffL('?vista=backstage'), Dt = t.env.win.ShowtimeDatos, C = t.env.win.ShowtimeCore, el = id => t.env.getEl(id);
    const F = C.demoFestival(Math.floor(C.nowAbs()));
    const fl = (by, id) => ({ id, text: '5 minutos', at: Date.now(), ms: 0, to: null, zones: null, by });
    Dt.loadSnapshot(snapL('es', F, { flash: fl({ k: 'zone', n: 'Carpa' }, 'a1'), avisos: [{ id: 'x', text: 'Catering abierto', at: Date.now(), ms: 0, from: 'Producción (Marta)', by: { k: 'prod' } }] }));
    t.env.win.ShowtimeLive.reload();
    eq(el('flash-by').hidden, false); eq(el('flash-by').textContent, '[Carpa]'); eq(el('flash-txt').textContent, '5 MINUTOS');
    eq(t.env.errors.join(' | '), ''); ok(/\[PRODUCCIÓN\] CATERING ABIERTO/.test(el('ticker').innerHTML), 'cinta: ' + el('ticker').innerHTML.slice(0, 200));
    ok(!/Marta/.test(el('ticker').innerHTML), 'sin nombres en pantalla'); eq(t.env.errors.join(' | '), '');
    Dt.loadSnapshot(snapL('en', F, { flash: fl({ k: 'prod' }, 'a2'), avisos: [{ id: 'x', text: 'Catering open', at: Date.now(), ms: 0, by: { k: 'prod' } }] }));
    eq(el('flash-by').textContent, '[Production]');
    ok(/\[PRODUCTION\] CATERING OPEN/.test(el('ticker').innerHTML), el('ticker').innerHTML.slice(0, 200));
    Dt.loadSnapshot(snapL('es', F, { flash: fl(null, 'a3') }));
    eq(el('flash-by').hidden, true, 'del Dashboard: sin etiqueta');
  });
  test('Evento sin nombre: la Live dice «UNTITLED EVENT» / «Evento sin nombre» según el idioma', async () => {
    const t = await staffL('?vista=manager'), Dt = t.env.win.ShowtimeDatos, C = t.env.win.ShowtimeCore, el = id => t.env.getEl(id);
    const F = C.demoFestival(Math.floor(C.nowAbs())); F.event.nombre = C.UNNAMED;
    Dt.loadSnapshot(snapL('en', F)); eq(el('evn-name').textContent, 'Untitled event');
    Dt.loadSnapshot(snapL('es', F)); eq(el('evn-name').textContent, 'Evento sin nombre');
  });
  test('Idioma (Fase 2): Confidence — mensajes al músico en inglés y de vuelta', async () => {
    const t = await staffL('?vista=confidence'), Dt = t.env.win.ShowtimeDatos, el = id => t.env.getEl(id);
    Dt.loadSnapshot(snapL('en'));
    ok(/WAITING FOR THE ROOM DATA…/.test(el('conf').innerHTML), el('conf').innerHTML);
    Dt.loadSnapshot(snapL('es'));
    ok(/ESPERANDO LOS DATOS DE LA SALA…/.test(el('conf').innerHTML), 'vuelve al español');
  });
  test('Idioma (Fase 2): Standby — botón de salir en inglés; el descriptor es «Real-Time Show Control»', async () => {
    const t = await staffL('?vista=standby&prev=manager'), Dt = t.env.win.ShowtimeDatos, el = id => t.env.getEl(id);
    Dt.loadSnapshot(snapL('en'));
    ok(/Exit Standby \(S\)/.test(el('standby').innerHTML), 'en inglés');
    ok(/Real-Time Show Control/.test(el('standby').innerHTML), 'descriptor oficial');
    Dt.loadSnapshot(snapL('es'));
    ok(/Salir del Standby \(S\)/.test(el('standby').innerHTML), 'vuelve al español');
  });
  test('Idioma (Fase 2): Live del Mac — al cambiar el idioma en el Panel se repinta sin recargar', () => {
    const t = arrancar({ storage: { 'showtime.config': JSON.stringify({ lang: 'es' }) } }), I = t.env.win.ShowtimeI18n, el = id => t.env.getEl(id);
    eq(el('evn-name').textContent, 'SIN EVENTO');
    // el Panel guarda CONFIG.lang y avisa a sus ventanas (aquí, a mano: se escribe y se recarga como con el aviso del Panel)
    const panel = lang => { t.env.storage.set('showtime.config', JSON.stringify({ lang })); t.env.win.ShowtimeLive.reload(); };
    panel('en');
    eq(I.getLang(), 'en');
    eq(el('evn-name').textContent, 'NO EVENT'); ok(/NO EVENT LOADED/.test(el('now-list').innerHTML));
    panel('es');
    eq(el('evn-name').textContent, 'SIN EVENTO');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Idioma (Fase 2): todo texto marcado en live.html y todo texto fijo de live.js, vistas.js y meteo.js tiene traducción', () => {
    const I = require('../i18n.js'), h = D.src('live.html');
    const ent = x => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const list = []; let m;
    const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*")*)>([^<]*)/g;
    while ((m = tagRe.exec(h))) {
      [['title', 'title'], ['placeholder', 'placeholder'], ['aria', 'aria-label']].forEach(([d, a]) => {
        if (new RegExp(' data-i18n-' + d + '(?=[\\s/>]|$)').test(m[2])) { const v = new RegExp(' ' + a + '="([^"]*)"').exec(m[2]); if (v) list.push(ent(v[1])); }
      });
      if (/ data-i18n(?=[\s/>]|$)/.test(m[2]) && m[3].trim()) list.push(ent(m[3]).replace(/\s+/g, ' ').trim());
    }
    ok(list.length > 30, list.length + ' textos marcados');
    eq(list.filter(x => !I.txHas(x) && !/^(CALL|Manager|Backstage)$/.test(x)).join(' | '), '', 'live.html sin traducción');
    ['EN ESCENA', 'SIGUIENTE'].forEach(x => ok(new RegExp('data-i18n>' + x + '<').test(h), x + ' marcado'));
    // literales de tx('…') (también los dos lados de un ?:)
    ['live.js', 'vistas.js', 'meteo.js'].forEach(f => {
      const js = D.src(f).replace(/^\s*\/\/.*$/gm, '');
      const miss = []; const re = /\btx\((?:[^'()]*\?\s*)?'((?:[^'\\]|\\.)*)'(?:\s*:\s*'((?:[^'\\]|\\.)*)')?/g;
      while ((m = re.exec(js))) [m[1], m[2]].forEach(k => { if (k && /[A-Za-zÁÉÍÓÚáéíóúÑñ]{2}/.test(k) && !I.txHas(k) && !/^(SHOW|SOUNDCHECK|CALL)$/.test(k)) miss.push(k); });
      eq(miss.join(' | '), '', f + ': sin traducción');
    });
  });
  test('Idioma (Fase 2): vocabulario — tiempo extra «EXTRA TIME», desborde «OVERRUN», «+N MIN DELAY», marcadores «KEY TIME»', () => {
    const I = require('../i18n.js');
    eq(I.tx('TIEMPO EXTRA', null, 'en'), 'EXTRA TIME');
    ok(/OVERRUN/.test(I.tx('+{n} MIN · BUFFER AGOTADO (+{o})', { n: 5, o: 2 }, 'en')));
    eq(I.tx('RETRASO +{n} MIN', { n: 10 }, 'en'), '+10 MIN DELAY');
    eq(I.tx('EN HORA · SIN INCIDENCIAS', null, 'en'), 'ON TIME · ALL CLEAR');
    eq(I.t('print.pills.hito', null, 'en'), 'KEY TIME'); eq(I.t('print.pills.hito', null, 'es'), 'MARCADOR');
  });
  const clickOk = (t, key) => t.env.fire('document', 'click', { target: { closest: sel => sel === '.callok' ? { dataset: { ck: key } } : null } });

  test('Ancho del panel de info: automático y estable (medida a tamaño de referencia), mínimo 280 px y máximo 45 vw', () => {
    const src = D.src('live.js');
    ok(/const INFO_REF_NAME = 37, INFO_REF_TIME = 20, INFO_PAD = 80, INFO_MIN = 280;/.test(src), 'tamaños de referencia y margen');
    ok(/const nameSz = Math\.max\(INFO_REF_NAME, realSz\);/.test(src), 'mide el nombre al tamaño real si es mayor (Backstage)');
    ok(/Math\.max\(INFO_MIN, Math\.min\(need \+ INFO_PAD, hi\)\)/.test(src) && /const hi = window\.innerWidth \* 0\.55/.test(src), 'clamp: mín. 280 px, máx. 55 vw');
    ok(/\.toUpperCase\(\), 900, nameSz, fam\)/.test(src) && /C\.fmtHM\(b\.si\) \+ '–' \+ C\.fmtHM\(b\.sf\)/.test(src), 'mide el nombre (900) y el horario');
    const rec = {}, t = arrancar({ rec });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    eq(rec['--info-w'], '280px', 'sin datos: el mínimo de 280 px');
  });
  test('Ancho manual guardado gana al automático; doble clic en el tirador borra el manual y vuelve a automático', () => {
    const rec = {}, t = arrancar({ rec, storage: { 'showtime.live.infoW': '410' } });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    eq(rec['--info-w'], '410px', 'el ancho manual se aplica al arrancar');
    eq(t.env.storage.get('showtime.live.infoW'), '410', 'el manual sigue guardado al arrancar');
    const src = D.src('live.js');
    ok(/addEventListener\('dblclick', resetInfoAuto\)/.test(src), 'doble clic en el tirador');
    ok(/function resetInfoAuto\(\) \{\s*try \{ localStorage\.removeItem\(P\.infoW\); \} catch \(e\) \{\}\s*applyInfoWidth\(\)/.test(src), 'borra la preferencia y recalcula al instante');
    ok(/startInfoResize[\s\S]*pset\(P\.infoW/.test(src), 'arrastrar guarda el ancho manual');
  });
  test('Móvil en vertical: el ancho lo manda el CSS (36 vw), sin ancho automático en línea', () => {
    const src = D.src('live.js'), css = D.src('live.css');
    ok(/window\.matchMedia\('\(max-width:700px\) and \(orientation:portrait\)'\)\.matches/.test(src) && /root\.style\.removeProperty\('--info-w'\)/.test(src), 'en móvil vertical no se pone --info-w');
    ok(/@media \(max-width:700px\) and \(orientation:portrait\)\{\s*body\{height:auto[^}]*\}\s*body\{--info-w:36vw\}/.test(css), 'el CSS fija 36 vw en móvil vertical');
  });
  test('Ancho automático: se recalcula al cargar la jornada y al cambiar el tamaño de la ventana', () => {
    const src = D.src('live.js');
    ok(/CALL_DONE = new Set\(Dt\.getCallDone\(\)\);\n    applyInfoWidth\(\);/.test(src), 'al cargar la jornada');
    ok(/window\.addEventListener\('resize', applyInfoWidth\)/.test(src), 'al cambiar el tamaño');
    ok(!/\(function \(\) \{ const w = parseInt\(pget\(P\.infoW, 0\)\)/.test(src), 'sustituye al arranque antiguo');
  });
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

  test('QR de Producción antiguo (sin clave propia): no activa nada y pide escanear de nuevo', async () => {
    ROOM = ROOM || await E.newRoom();
    const u = E.productionUrl(ROOM, 'http://x/', 'prod_001');
    const t = arrancar({ hash: hashOf(u).replace('&q=' + ROOM.q, '') });
    ok(!t.body.classList.contains('prod'), 'sin modo Producción'); eq(t.dock.hidden, true, 'sin menú');
    eq(t.env.getEl('rx-t').textContent, 'ENLACE NO VÁLIDO · vuelve a escanear el QR');
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

  test('Pantalla que se vuelve a encender o red que vuelve: reconecta a fondo (Staff y Producción)', async () => {
    ROOM = ROOM || await E.newRoom();
    for (const h of [hashOf(E.staffUrl(ROOM, 'http://x/')), hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001'))]) {
      const t = arrancar({ hash: h });
      t.env.win.document.visibilityState = 'visible'; t.env.fire('document', 'visibilitychange', {});
      eq(t.ctl.wakes, 1, 'al volver a la pantalla');
      t.env.fire('window', 'online', {});
      eq(t.ctl.wakes, 2, 'al volver la red');
      t.env.win.document.visibilityState = 'hidden'; t.env.fire('document', 'visibilitychange', {});
      eq(t.ctl.wakes, 2, 'al irse a segundo plano, no');
    }
  });

  test('Teclado en pantalla: los docks de Producción suben con --kb (visualViewport) y el campo enfocado queda visible', () => {
    const css = D.src('live.css'), js = D.src('live.js');
    ok(/\.mdock\{[^}]*bottom:calc\(14px \+ var\(--sa-b\) \+ var\(--kb,0px\)\)/.test(css), 'menú de mensajes sube con el teclado (y respeta el borde seguro)');
    ok(/\.cdock\{[^}]*bottom:calc\(66px \+ var\(--sa-b\) \+ var\(--kb,0px\)\)/.test(css) || /\.cdock\{[^}]*bottom:calc\(66px \+ var\(--kb,0px\)\)/.test(css), 'chat sube con el teclado');
    ok(/\.pnote\{bottom:calc\(76px \+ var\(--sa-b\) \+ var\(--kb,0px\)\)\}/.test(css), 'aviso sube con el teclado');
    ok(/visualViewport/.test(js) && /setProperty\('--kb'/.test(js), 'mide el teclado con visualViewport');
    ok(/#md-text,#cd-text/.test(js), 'al enfocar el campo, se asegura que se vea');
  });
  test('Móvil: zonas seguras, 16 px en los campos, 44 px táctiles y contraste', () => {
    const css = D.src('live.css'), rc = D.src('remote.css');
    ['.mdock{left:calc(14px + var(--sa-l));bottom:calc(14px + var(--sa-b) + var(--kb,0px))}', '#zoomctl{right:calc(14px + var(--sa-r));bottom:calc(14px + var(--sa-b))}'].forEach(x => ok(css.indexOf(x) > 0, x));
    ok(/@media \(pointer:coarse\)\{[^@]*#md-text,#cd-text\{font-size:16px;height:44px\}/.test(css), 'campos de 16 px y 44 px');
    ok(/@media \(max-width:700px\)\{[^@]*#zoomctl\.open #dockbody\{flex-wrap:wrap/.test(css), 'el dock de la derecha no se sale en 390 px');
    ok(/--dim:#8a8f98/.test(css) && /--dim:rgba\(255,255,255,\.55\)/.test(rc), 'texto atenuado con contraste (gris pizarra, ≥ 4,5:1 sobre negro)');
    ok(/body\[data-lv="stage"\] \.mdock,body\[data-lv="stage"\] \.cdock/.test(css), 'docks con el estilo de la pantalla');
    ok(/input,select,textarea\{font-size:16px\}/.test(rc) && /\.act\.stop\{background:#d70015/.test(rc), 'mando: 16 px y TERMINAR legible');
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
  // ── Standby / Modo Cartel ──
  const keyOf = t => k => t.env.fire('document', 'keydown', { key: k, target: { tagName: 'BODY' } });
  test('Standby por la URL (vista=standby): el cartel a pantalla completa, reloj HH:MM y debajo la vista de antes', () => {
    const t = arrancar({ search: '?vista=standby&prev=backstage' });
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
    const sb = t.env.getEl('standby'), h = t.env.innerLog.filter(x => x[0] === 'standby').map(x => x[1]).pop() || '';
    eq(sb.hidden, false); ok(t.body.classList.contains('standby-on'));
    ok(/class="stm-name">SHOWTIME</.test(h) && /by Synapse Live/.test(h) && /Real-Time Show Control/.test(h) && /ENGINEERED FOR LIVE PRODUCTION/.test(h), 'el mismo cartel que el inicio');
    ok(/id="stb-clk" class="stb-clk"/.test(h)); ok(/^\d\d:\d\d$/.test(t.env.getEl('stb-clk').textContent), 'HH:MM sin segundos: ' + t.env.getEl('stb-clk').textContent);
    eq(t.title(), 'Showtime · Standby'); eq(t.body.dataset.vista, 'backstage', 'debajo sigue Backstage');
  });
  test('Standby con la tecla S (y Esc o S para salir); V no cambia la vista mientras tanto', () => {
    const t = arrancar({ search: '?vista=manager' }), key = keyOf(t);
    eq(t.env.getEl('standby').hidden, true, 'normal: sin cartel');
    key('s'); eq(t.env.getEl('standby').hidden, false);
    key('v'); eq(t.body.dataset.vista, 'confidence', 'V sigue cambiando la vista de debajo');
    eq(t.env.getEl('standby').hidden, false, 'y el cartel sigue puesto');
    key('S'); eq(t.env.getEl('standby').hidden, true); eq(t.title(), 'Showtime · Confidence', 'al salir ya se ve la vista nueva');
    key('s'); key('Escape'); eq(t.env.getEl('standby').hidden, true, 'Esc también sale');
  });
  const stbMsg = (t, on, at) => t.env.fire('window', 'message', { data: { app: 'showtime', type: 'standbyAll', standby: { on, at } }, source: {} });
  test('Standby del Dashboard (Live ▾): lo siguen las Confidence del Mac; Manager y Backstage no cambian', () => {
    const conf = arrancar({ search: '?vista=confidence&zona=z1' }), man = arrancar({ search: '?vista=manager' }), back = arrancar({ search: '?vista=backstage' });
    [conf, man, back].forEach(t => stbMsg(t, true, 1000));
    eq(conf.env.getEl('standby').hidden, false, 'Confidence: cartel');
    eq(man.env.getEl('standby').hidden, true, 'Manager: sigue igual'); eq(back.env.getEl('standby').hidden, true, 'Backstage: sigue igual');
    stbMsg(conf, false, 2000);
    eq(conf.env.getEl('standby').hidden, true, 'se quita y vuelve a la cuenta atrás'); eq(conf.body.dataset.vista, 'confidence');
  });
  test('Standby del Dashboard: la tecla S en una Confidence manda hasta la siguiente orden (y el mismo estado repetido no la pisa)', () => {
    const t = arrancar({ search: '?vista=confidence&zona=z1' });
    const key = k => t.env.fire('document', 'keydown', { key: k, target: { tagName: 'BODY' } });
    stbMsg(t, true, 1000); eq(t.env.getEl('standby').hidden, false);
    key('s'); eq(t.env.getEl('standby').hidden, true, 'S: esta pantalla sale');
    stbMsg(t, true, 1000); eq(t.env.getEl('standby').hidden, true, 'el mismo estado otra vez (p. ej. la emisión lo repite): no vuelve');
    stbMsg(t, true, 3000); eq(t.env.getEl('standby').hidden, false, 'una orden nueva del Dashboard: sí');
  });
  test('Standby del Dashboard: una Confidence que se abre (o llega con V) con el Standby puesto ya sale en cartel', () => {
    const st = { 'showtime.standby': JSON.stringify({ on: true, at: 5 }) };
    eq(arrancar({ search: '?vista=confidence&zona=z1', storage: Object.assign({}, st) }).env.getEl('standby').hidden, false, 'al abrir');
    const t = arrancar({ search: '?vista=backstage', storage: Object.assign({}, st) });
    eq(t.env.getEl('standby').hidden, true, 'Backstage no');
    t.env.fire('document', 'keydown', { key: 'v', target: { tagName: 'BODY' } });   // backstage → manager → confidence
    t.env.fire('document', 'keydown', { key: 'v', target: { tagName: 'BODY' } });
    eq(t.body.dataset.vista, 'confidence'); eq(t.env.getEl('standby').hidden, false, 'al pasar a Confidence');
  });
  test('Standby por QR: las Confidence de Staff lo reciben en la emisión (también al entrar tarde); Manager de Staff no', async () => {
    ROOM = ROOM || await E.newRoom();
    const h = hashOf(E.staffUrl(ROOM, 'http://x/'));
    const conf = arrancar({ search: '?vista=confidence&zona=z1', hash: h }), man = arrancar({ search: '?vista=manager', hash: h });
    const snap = on => ({ festival: null, config: {}, callDone: [], flash: null, avisos: [], meteo: null, standby: { on, at: on ? 7 : 8 } });
    [conf, man].forEach(t => t.env.win.ShowtimeDatos.loadSnapshot(snap(true)));
    eq(conf.env.getEl('standby').hidden, false, 'Confidence de Staff: cartel');
    eq(man.env.getEl('standby').hidden, true, 'Manager de Staff: no');
    conf.env.win.ShowtimeDatos.loadSnapshot(snap(false));
    eq(conf.env.getEl('standby').hidden, true, 'se quita');
    // la orden directa de ventana a ventana ya no existe: solo manda el estado del evento
    conf.env.fire('window', 'message', { data: { app: 'showtime', type: 'standby', on: true } });
    eq(conf.env.getEl('standby').hidden, true);
  });
  test('Standby: el botón de pantalla completa es el mismo de Confidence, en el mismo sitio (abajo a la derecha) y por encima del cartel', () => {
    const css = D.src('live.css') + D.src('marca.css');
    const z = re => +re.exec(css)[1];
    ok(/body\.standby-on \.cf-full\{display:flex!important;z-index:(\d+)\}/.test(css), 'se ve en el Standby');
    ok(z(/body\.standby-on \.cf-full\{display:flex!important;z-index:(\d+)\}/) > z(/\.standby\{position:fixed;inset:0;z-index:(\d+)/), 'por encima del cartel');
    ok(/\.cf-full\{right:calc\(14px \+ var\(--sa-r\)\);bottom:calc\(14px \+ var\(--sa-b\)\)\}/.test(css), 'abajo a la derecha, como en Confidence');
    ok(/body\.standby-on:has\(#cf-full\) \.stb-clk\{right:/.test(css), 'el reloj se aparta para no taparlo');
    ok(!/stb-full/.test(D.src('live.js') + css), 'sin un segundo botón en otro sitio');
    ok(/addEventListener\('pointerdown', reveal\)/.test(D.src('live.js')), 'en el móvil, un toque enseña «Salir del Standby»');
  });
  test('La Live avisa al Dashboard de la vista que muestra: al abrirse, al cambiar con V y en cada latido', () => {
    const got = [], opener = { closed: false, postMessage(m) { got.push(m); } };
    const t = arrancar({ search: '?vista=confidence&zona=z1', opener });
    ok(got.some(m => m.app === 'showtime' && m.type === 'vistaState' && m.vista === 'confidence'), 'al abrir');
    t.env.fire('document', 'keydown', { key: 'v', target: { tagName: 'BODY' } });
    const now = t.body.dataset.vista;
    ok(now !== 'confidence', 'V cambió la vista');
    ok(got.some(m => m.type === 'vistaState' && m.vista === now), 'al cambiar con V: ' + now);
    ok(got.filter(m => m.type === 'vistaState').length >= 2, 'y se repite en el latido');
  });
  test('Confidence en sobretiempo: solo parpadean los números; el fondo y los números se configuran', () => {
    const css = D.src('live.css'), js = D.src('live.js'), html = D.src('index.html');
    ok(!/cfbg/.test(css), 'sin parpadeo de fondo');
    ok(/\.conf\.lv-over\{background:var\(--ov-bg,#000\)\}/.test(css) && /\.conf\.lv-over \.cf-dig span\{color:var\(--ov-num,#ff3b30\)\}/.test(css), 'fondo y números desde las variables');
    ok(/setProperty\('--ov-bg', screensCfg\(\)\.conf\.overBg\)/.test(js) && /setProperty\('--ov-num', screensCfg\(\)\.conf\.overNum\)/.test(js), 'la Live aplica la configuración');
    ok(/data-sc="conf\.overBg"/.test(html) && /data-sc="conf\.overNum"/.test(html), 'Configuración tiene los dos colores');
  });
  test('Parpadeo del sobretiempo: la velocidad se configura (--blink-speed) y la usa la animación de los números', () => {
    const css = D.src('live.css'), js = D.src('live.js'), html = D.src('index.html');
    ok(/\.conf\.blink \.cf-dig span\{animation:cfdig var\(--blink-speed,1s\) steps\(1,end\) infinite\}/.test(css), 'la animación usa la velocidad');
    ok(/box\.style\.setProperty\('--blink-speed', screensCfg\(\)\.conf\.blinkSpeed \+ 's'\)/.test(js), 'la Live aplica la velocidad');
    ok(/data-sc="conf\.blinkSpeed"/.test(html), 'Configuración tiene el selector');
  });
  test('Cinta: la velocidad viene de la configuración (--tk-speed) y la animación la usa', () => {
    const css = D.src('live.css'), js = D.src('live.js');
    ok(/\.tk-track\{display:flex;width:max-content;animation:tkrun var\(--tk-speed,30s\) linear infinite/.test(css), 'animación con la variable');
    ok(/tk\.style\.setProperty\('--tk-speed', t\.speed \+ 's'\)/.test(js) && /t\.speed \+ JSON\.stringify/.test(js), 'la Live aplica la velocidad y la recalcula al cambiarla');
  });
  test('Telemetría: la Live avisa al Dashboard de su pantalla completa, y al instante al cambiar', () => {
    const got = [], opener = { closed: false, postMessage(m) { got.push(m); } };
    const t = arrancar({ search: '?vista=manager', opener });
    ok(got.some(m => m.type === 'vistaState' && m.fs === false), 'al abrir manda fs: false');
    const n = got.length;
    t.env.fire('document', 'fullscreenchange', {});
    ok(got.length > n && got[got.length - 1].type === 'vistaState', 'fullscreenchange: avisa al momento, sin esperar al latido');
    const src = D.src('live.js');
    ok(/addEventListener\('webkitfullscreenchange', reportVista\)/.test(src), 'también el evento de WebKit');
  });
  test('Gestor del Dashboard: la Live cambia de vista, de zona y de standby solo si se lo pide quien la abrió, y se lo confirma', () => {
    const got = [], opener = { closed: false, postMessage(m) { got.push(m); } };
    const t = arrancar({ search: '?vista=manager', opener });
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'setVista', vista: 'backstage' }, source: {} });
    eq(t.body.dataset.vista, 'manager', 'otra ventana: no');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'setVista', vista: 'confidence', zona: 'z2' }, source: opener });
    eq(t.body.dataset.vista, 'confidence', 'el Dashboard que la abrió: sí');
    ok(got.some(m => m.type === 'vistaState' && m.vista === 'confidence' && m.zona === 'z2'), 'confirma vista y zona');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'standby', on: true }, source: opener });
    eq(t.env.getEl('standby').hidden, false, 'standby puesto');
    ok(got.some(m => m.type === 'vistaState' && m.standby === true), 'confirma el standby');
    t.env.fire('window', 'message', { data: { app: 'showtime', type: 'standby', on: false }, source: opener });
    eq(t.env.getEl('standby').hidden, true, 'standby quitado');
  });
  test('Standby: los mensajes flash siguen saliendo por encima (z-index) y hay botón en la Live', () => {
    const css = D.src('marca.css'), lcss = D.src('live.css');
    const z = re => +re.exec(css + lcss)[1];
    ok(z(/\.standby\{position:fixed;inset:0;z-index:(\d+)/) < z(/#flash\{position:fixed;inset:0;z-index:(\d+)/), 'flash encima');
    ok(/<button id="stbbtn"[^>]*title="Standby · Modo Cartel/.test(D.src('live.html')), 'botón en los controles de la Live');
  });

  // ── Telemetría QR (dec. 103) y «Solo hoy» (dec. 105) ──
  test('Telemetría QR: el latido lleva la vista, la zona de Confidence, el tipo de dispositivo y el id de Producción', async () => {
    const c = await staffL('?vista=confidence&zona=esc1');
    let i = c.R().o.info();
    eq(i.v, 'confidence'); eq(i.z, 'esc1'); ok(['movil', 'tablet', 'ordenador'].indexOf(i.d) >= 0, 'tipo: ' + i.d); eq(i.p, null);
    const b = await staffL('?vista=backstage');
    i = b.R().o.info(); eq(i.v, 'backstage'); eq(i.z, null, 'sin zona fuera de Confidence');
    ROOM = ROOM || await E.newRoom();
    const p = arrancar({ search: '?vista=manager', hash: hashOf(E.productionUrl(ROOM, 'http://x/', 'prod_001')) });
    eq(p.R().o.info().p, 'prod_001'); eq(p.R().o.info().v, 'manager');
  });
  function festHoy(a, b) {
    const C = require('../core.js'), n = Math.floor(C.nowAbs()), hm = m => C.fmtHM(((m % 1440) + 1440) % 1440);
    const jor = C.jornadaOfAbs({ event: { dayCutoff: '06:00' } }, n + a);
    let s = C.newFestival({ nombre: 'Ciclo', fechaInicio: jor, fechaFin: jor, dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'Principal').state;
    s = C.addArtist(s, 'show', { jornada: jor, nombre: 'Banda', escenarioId: s.escenarios[0].id, inicio: hm(n + a), fin: hm(n + b) }).state;
    return { s, jor };
  }
  test('Solo hoy: jornada en curso → la Live normal; cerrada en el Dashboard → «JORNADA FINALIZADA»; al llegar la siguiente, vuelve', async () => {
    const t = await staffL('?vista=manager'), Dt = t.env.win.ShowtimeDatos, el = id => t.env.getEl(id);
    const { s, jor } = festHoy(-10, 60);
    Dt.loadSnapshot(snapL('es', s, { config: { lang: 'es', mode: 'all', day: jor }, scope: { day: jor, closed: false } }));
    eq(el('jfin').hidden, true, 'suena la banda: pantalla normal');
    Dt.loadSnapshot(snapL('es', Object.assign({}, s, { artists: [] }), { config: { lang: 'es', mode: 'all', day: jor }, scope: { day: jor, closed: true } }));
    eq(el('jfin').hidden, false, 'cerrada a mano');
    ok(/cerrada en el Dashboard/.test(el('jfin-sub').textContent) && /hasta que arranque la siguiente/.test(el('jfin-sub').textContent));
    Dt.loadSnapshot(snapL('en', Object.assign({}, s, { artists: [] }), { config: { lang: 'en', mode: 'all', day: jor }, scope: { day: jor, closed: true } }));
    ok(/closed on the Dashboard/.test(el('jfin-sub').textContent), 'en inglés: ' + el('jfin-sub').textContent);
    Dt.loadSnapshot(snapL('es', s, { config: { lang: 'es', mode: 'all', day: jor }, scope: { day: jor, closed: false } }));
    eq(el('jfin').hidden, true, 'reabierta (o la siguiente jornada)');
    eq(t.env.errors.length, 0, t.env.errors.join(' | '));
  });
  test('Solo hoy: al terminar todo lo del día (sin cerrar a mano) también sale «JORNADA FINALIZADA»; en las ventanas del Mac, nunca', async () => {
    const t = await staffL('?vista=backstage'), Dt = t.env.win.ShowtimeDatos, el = id => t.env.getEl(id);
    const { s, jor } = festHoy(-120, -60);
    Dt.loadSnapshot(snapL('es', s, { config: { lang: 'es', mode: 'all', day: jor }, scope: { day: jor, closed: false } }));
    eq(el('jfin').hidden, false, 'ya no queda nada');
    ok(/sin nada más por hoy/.test(el('jfin-sub').textContent));
    // Sin «scope» (emisión antigua) o en el Mac (sin QR): nada de esto
    Dt.loadSnapshot(snapL('es', s, { config: { lang: 'es', mode: 'all', day: jor } }));
    eq(el('jfin').hidden, true, 'sin scope: pantalla normal');
    const mac = arrancar({ storage: { 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ day: jor, mode: 'all' }) } });
    eq(mac.env.getEl('jfin').hidden, true, 'la Live del Mac no se cierra');
  });

  test('Dec. 116: con el Panel en «Tareas» o «Marcadores», la Live sigue enseñando la banda en escena (no se queda vacía)', async () => {
    const { s, jor } = festHoy(-10, 60);
    const vista = mode => { const t = arrancar({ storage: { 'showtime.festival': JSON.stringify(s), 'showtime.config': JSON.stringify({ day: jor, mode }) } }); return t.env.innerLog.map(x => x[1]).join(' ') + ' ' + JSON.stringify(t.env.getEl('cur-name') || {}); };
    const todo = vista('all');
    ok(/Banda|BANDA/.test(todo), 'en Todo se ve la banda');
    ['tarea', 'hito'].forEach(m => ok(/Banda|BANDA/.test(vista(m)), m + ': la Live no filtra por tipo'));
  });

  test('Dec. 118/119: Manager y Backstage en Studio con el diseño clásico; acabado fino solo donde se ve (Stage y el botón de Confidence)', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'live.css'), 'utf8');
    ok(/body:not\(\[data-lv\]\):is\(\[data-vista="manager"\],\[data-vista="backstage"\]\)\{\s*--bg:#0d0f14; --bg2:#0a0c10; --panel:rgba\(255,255,255,\.03\);[^}]*--accent:#e94560;[^}]*--call:#ffb347;/.test(css), 'colores clásicos solo en Manager y Backstage sin Stage');
    ok(/:where\(body\[data-lv="stage"\]\) \.tpanel-h\{display:flex;align-items:center;gap:10px;letter-spacing:\.18em;position:relative\}/.test(css), 'Stage: cabeceras');
    ok(/:where\(body\[data-lv="stage"\]\) #panel-next \.tpanel-h\{color:var\(--muted\)\}/.test(css), 'Stage: SIGUIENTE en blanco');
    ok(/:where\(body\[data-vista="confidence"\]:not\(\[data-lv\]\)\) \.iconbtn\{background:linear-gradient/.test(css), 'Confidence en Studio: botón de pantalla completa');
    ok(!/tpanel-h::before\{content/.test(css) && !/body\[data-lv="stage"\] \.tpanel-h::before/.test(css), 'sin iconos que luego se esconden (nada que deshacer)');
    ok(!/Neutro|Raycast/.test(css.slice(0, 400)), 'cabecera del archivo al día');
  });

  test('Dec. 133: filas fijas de una ventana Manager desde el gestor — en su URL (&filas=N), repartiendo el alto; − / + en la pantalla las deja', () => {
    const js = D.src('live.js');
    ok(/let ROWS = Vs\.normRows\(URLP\.get\('filas'\)\);/.test(js), 'se leen de la URL de esta ventana (sobreviven a recargarla)');
    ok(/const fixedRows = \(\) => VISTA === 'manager' && ROWS \? ROWS : 0;/.test(js), 'solo en Manager');
    ok(/if \(fixedRows\(\)\) return fixedRows\(\);/.test(js) && /if \(fixedRows\(\)\) return Math\.max\(ROW_STEPS\[0\], Math\.floor\(h \/ fixedRows\(\)\)\);/.test(js), 'N filas reparten el alto');
    ok(/if \(ROWS\) q\.set\('filas', String\(ROWS\)\); else q\.delete\('filas'\);/.test(js), 'se guardan en la URL');
    ok(/else if \(m\.type === 'setRows'\) setRows\(m\.filas\);/.test(js), 'orden del gestor (solo de quien la abrió)');
    ok(/if \(ROWS\) setRows\(null, true\);/.test(js), '− / + en la pantalla manda');
    ok(/filas: ROWS \|\| null, standby: STANDBY,/.test(js), 'lo cuenta al Dashboard');
  });

  test('Dec. 134: bajo el reloj, solo el nombre del evento (blanco, hasta 2 líneas); las tareas del cronograma siempre en cian', () => {
    const h = D.src('live.html'), js = D.src('live.js'), css = D.src('live.css');
    ok(/<div id="evn"><span id="evn-name"><\/span><\/div>/.test(h) && !/evn-mode/.test(h + js + css), 'fuera «JORNADA COMPLETA · »');
    ok(/#evn\{font-size:min\(5\.5cqw,1\.9vh\);font-weight:800;color:var\(--text\);[^}]*white-space:normal;line-height:1\.2;[^}]*-webkit-line-clamp:2/.test(css), 'blanco y hasta 2 líneas, sin «…» a mitad');
    ok(/const TASK_COL = '#7dd3fc';/.test(js) && /const col = task \? TASK_COL : safeColor\(block\.color, '#888'\);/.test(js), 'tarea: cian fijo, no el color de la zona');
    const t = arrancar({ storage: {} }); eq(t.env.getEl('evn-name').textContent, 'SIN EVENTO');
  });

  test('Dec. 135: las 4 columnas de arriba al 25 %; doble clic en un tirador las iguala; ↺ Restablecer deja la pantalla de fábrica', () => {
    const js = D.src('live.js'), css = D.src('live.css'), h = D.src('live.html');
    ok(/#clkbox\{flex:1 1 0;min-width:0;[^}]*padding:0 16px;border:1px solid transparent;/.test(css) && /\.tpanel\{flex:1 1 0;[^}]*min-width:0;/.test(css), 'reloj y paneles con el mismo reparto (y el mismo relleno + borde, si no el reloj sale 17 px más estrecho)');
    ok(/document\.querySelectorAll\('\.vsplit'\)\.forEach\(sp => sp\.addEventListener\('dblclick', resetTopCols\)\);/.test(js), 'doble clic en cualquier tirador');
    ok(/function resetTopCols\(\) \{\s*try \{ localStorage\.removeItem\(P\.topCols\); \} catch \(e\) \{\}\s*\['clkbox', 'panel-now', 'panel-next', 'panel-call'\]\.forEach/.test(js), 'borra los anchos guardados y los de la ventana');
    ok(/\[P\.topCols, P\.topH, P\.stripH, P\.infoW, P\.rowH, P\.zoom\]\.forEach\(k => \{ try \{ localStorage\.removeItem\(k\); \}/.test(js), 'Restablecer: anchos, alto de arriba, filas, ancho de info y zoom');
    ok(/<button id="resetbtn" class="txtbtn"[^>]*>↺ Reset<\/button>/.test(h) && /\$\('resetbtn'\)\.addEventListener\('click', resetLayout\)/.test(js), 'botón en el dock');
    ok(/else if \(m\.type === 'resetLayout'\) resetLayout\(\);/.test(js), 'y desde el gestor del Dashboard');
    eq(require('../i18n.js').tx('↺ Reset', null, 'es'), '↺ Reset'); eq(require('../i18n.js').tx('↺ Reset', null, 'en'), '↺ Reset', 'mismo texto en los dos idiomas (dec. 137)');
  });
  test('Dec. 132: el cartel del reposo y del Standby lleva el logo del evento (si no hay, el de Showtime) y se repinta si cambia', () => {
    const js = D.src('live.js'), css = D.src('live.css');
    ok(/const lg = C\.eventLogo \? C\.eventLogo\(FEST\) : '';\s*return lg \? '<div class="evlogo"><img src="' \+ esc\(lg\) \+ '"/.test(js) && /: Mk\.banner\(\{ version:/.test(js), 'logo o cartel de Showtime');
    eq((js.match(/posterHtml\(\)/g) || []).length, 3, 'una definición y dos usos: reposo y Standby');
    ok(/if \(lg !== POSTER_LOGO\) \{ POSTER_LOGO = lg; if \(STANDBY\) setTimeout\(renderStandby, 0\);/.test(js), 'cambia el logo con el cartel puesto: se repinta');
    ok(/\.evlogo img\{display:block;max-width:100%;max-height:100%;object-fit:contain\}/.test(css), 'centrado, sin deformar');
  });
  test('Dec. 131: reposo en Staff — cartel, hora local y «ESPERANDO EMISIÓN», decidido por Vs.parkState y quitado solo al volver', () => {
    const h = D.src('live.html'), js = D.src('live.js'), css = D.src('live.css');
    ok(/<div id="park" class="standby park" role="status" hidden><\/div>/.test(h), 'capa del reposo en live.html');
    ok(/setPark\(Vs\.parkState\(\{ vista: VISTA, prod: !!PRODID, state: s,/.test(js), 'la decide parkState con la vista y si es Producción');
    ok(/setInterval\(checkPark, 1000\)/.test(js) && /lastSt = st; endedAt = s === 'end' \? \(endedAt \|\| Date\.now\(\)\) : 0; checkPark\(\);/.test(js), 'se revisa cada segundo y con cada estado');
    ok(/tx\('ESPERANDO EMISIÓN'\)/.test(js) && /Mk\.banner\(/.test(js) && /Mk\.hhmm\(d\)/.test(js), 'cartel, hora local y pastilla');
    ok(/\.standby\.park\{z-index:450;background:#07080a;/.test(css) && /body\.park-on \.rx\{display:none\}/.test(css), 'fondo #07080a, por encima de todo, sin el aviso rojo');
    eq(require('../i18n.js').tx('ESPERANDO EMISIÓN', null, 'en'), 'WAITING FOR BROADCAST', 'en inglés');
  });


  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Live: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 50);
  })();
})();
