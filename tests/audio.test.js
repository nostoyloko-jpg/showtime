/* Tests de los avisos de audio locales y del chat urgente (dec. 145).
 * Ordenador:  node tests/audio.test.js
 * audio.js en Node (sin navegador) + el Dashboard simulado (_dom.js) con un AudioContext de mentira que cuenta notas.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('audio.test.js: solo en Node'); return; }
  const D = require('./_dom.js'), C = require('../core.js'), E = require('../emision.js'), W = require('../meteo.js');
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const MODULOS = ['i18n.js', 'core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'marca.js', 'audio.js', 'control.js'];
  const KEY = 'showtime.audioAlerts';

  /** AudioContext de mentira: cuenta osciladores (= notas) y su frecuencia. */
  function fakeAC(log, state) {
    return function () {
      this.state = state || 'running'; this.currentTime = 0; this.destination = {};
      this.resume = () => { this.state = 'running'; return Promise.resolve(); };
      this.createOscillator = () => { const o = { type: '', frequency: { value: 0 }, connect() {}, start() { log.push(o.frequency.value); }, stop() {} }; return o; };
      this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
    };
  }
  /** audio.js limpio en un contexto propio (window con o sin AudioContext). */
  function audioIn(win) {
    const env = D.makeEnv({ storage: win && win.storage }); if (win && win.AC) env.win.AudioContext = win.AC;
    D.cargar(env, ['audio.js']);
    return { A: env.win.ShowtimeAudio, env };
  }
  /** Dashboard simulado con reloj que se puede adelantar (clk.t, ms). */
  function dashboard(storage, AC, t0) {
    const env = D.makeEnv({ cripto: true, storage: Object.assign({ 'showtime.producers': JSON.stringify({ producers: [{ id: 'prod_001', name: 'Marta' }], counter: 1, defaultId: 'prod_001' }) }, storage || {}) });
    const clk = { t: Number.isFinite(t0) ? t0 : Date.UTC(2026, 6, 10, 12, 0, 0) };
    env.win.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clk.t); } static now() { return clk.t; } };
    if (AC) env.win.AudioContext = AC;
    D.cargar(env, MODULOS);
    return { env, clk, T: env.win.ShowtimePanel._test, A: env.win.ShowtimeAudio, adv(ms) { clk.t += ms; }, read: k => { const v = env.storage.get(k); return v ? JSON.parse(v) : null; } };
  }
  const GEST = { target: { closest: () => null, id: '' } };
  /** Evento de HOY (hora local del reloj simulado) con «Banda A» y su CALL (15 min antes) ya abierto a las 23:20. */
  function festCall(hora) {
    const d = new Date(hora), iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let s = C.newFestival({ nombre: 'Prueba audio', fechaInicio: iso, fechaFin: iso, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state;
    s = C.addArtist(s, 'show', { jornada: iso, nombre: 'Banda A', escenarioId: s.escenarios[0].id, inicio: '23:30', fin: '23:59' }).state;
    return s;
  }
  const at2320 = () => { const d = new Date(); d.setHours(23, 20, 0, 0); return d.getTime(); };

  // 1 · Preferencias: clave exacta, apagado por defecto, datos rotos o a medias normalizados
  test('1 · Preferencias en «showtime.audioAlerts»: apagado por defecto y datos rotos o a medias normalizados', () => {
    const { A } = audioIn();
    eq(A.KEY, KEY);
    const OFF4 = { call: false, overrun: false, meteo: false, urgent: false }, TEN4 = { call: 10, overrun: 10, meteo: 10, urgent: 10 };
    eq(JSON.stringify(A.normPrefs(null)), JSON.stringify({ on: false, call: true, overrun: true, meteo: true, urgent: true, rep: OFF4, every: TEN4 }), 'por defecto: interruptor apagado, casillas marcadas, «Repetir» apagado en los 4, 10 s');
    eq(A.normPrefs({ every: { call: 7 } }).every.call, 10, 'intervalo fuera de la lista → 10 s'); eq(A.normPrefs({ every: { meteo: 20 } }).every.meteo, 20); eq(A.normPrefs({ every: { call: '20' } }).every.call, 10, 'texto no vale');
    eq(JSON.stringify(A.normPrefs({ repeat: true, every: 20 }).rep), JSON.stringify(OFF4), 'los «repeat»/«every» globales de la v20261158 se ignoran');
    eq(A.normPrefs({ on: 'true', call: 0, meteo: false, urgent: null, extra: 1 }).on, false, 'cadena «true» no vale');
    const p = A.normPrefs({ on: 'true', call: 0, meteo: false, urgent: null, extra: 1 });
    ok(p.call === true && p.meteo === false && p.urgent === true && !('extra' in p), 'solo booleanos; lo demás, por defecto; campos ajenos fuera');
    eq(JSON.stringify(A.normPrefs([true])), JSON.stringify(A.DEFAULTS), 'un array no es un objeto de preferencias');
    ['{', '"x"', '42', 'null', '[]'].forEach(raw => { const { A: B } = audioIn({ storage: { [KEY]: raw } }); eq(JSON.stringify(B.load()), JSON.stringify(A.DEFAULTS), 'JSON roto o raro: ' + raw); });
    const { A: B, env } = audioIn({ storage: { [KEY]: '{"on":true}' } });
    ok(B.load().on === true && B.load().call === true, 'parcial: lo que falta, por defecto');
    B.save({ on: true, call: false, junk: 'x' });
    eq(env.storage.get(KEY), JSON.stringify({ on: true, call: false, overrun: true, meteo: true, urgent: true, rep: { call: false, overrun: false, meteo: false, urgent: false }, every: { call: 10, overrun: 10, meteo: 10, urgent: 10 } }), 'se guarda normalizado');
  });

  // 2 · Solo local: nada en festival, configuración, JSON exportado ni emisión
  test('2 · Local por dispositivo: la clave solo vive en audio.js; ni datos.js ni emision.js ni control.js la tocan', () => {
    ['datos.js', 'emision.js', 'control.js', 'core.js', 'live.js', 'remote.js', 'vistas.js'].forEach(f => {
      const code = D.src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      ok(!/audioAlerts/.test(code), f + ' no usa la clave (solo audio.js la lee y la escribe)');
    });
    const t = dashboard({ [KEY]: JSON.stringify({ on: true }) });
    t.env.getEl('au-on').checked = true; t.T.saveAudioCfg();
    const cfg = JSON.stringify(t.read('showtime.config') || {});
    ok(!/audio|urgent/i.test(cfg), 'la configuración del Panel (la que viaja) no lleva nada de audio');
    ok(!/audio/i.test(JSON.stringify(t.read('showtime.festival') || {})), 'el festival tampoco');
  });

  // 3 · Interruptor general + casilla
  test('3 · Suena solo con el interruptor general Y su casilla', () => {
    const { A } = audioIn();
    ok(!A.enabled(A.DEFAULTS, 'call'), 'apagado por defecto');
    ok(A.enabled({ on: true }, 'call') && A.enabled({ on: true }, 'urgent'), 'encendido: las casillas por defecto suenan');
    ok(!A.enabled({ on: true, overrun: false }, 'overrun'), 'casilla desmarcada');
    ok(!A.enabled({ on: true }, 'otra'), 'tipo desconocido');
  });

  // 4 · Flancos: nunca al cargar, una vez al entrar, otra si sale y vuelve
  test('4 · Detector: el primer vistazo arma sin sonar; suena al ENTRAR, no en cada tick; sale y vuelve → suena otra vez', () => {
    const { A } = audioIn(), e = A.edge();
    eq(e(['a', 'b']).length, 0, 'al cargar, lo que ya está no suena');
    eq(e(['a', 'b']).length, 0, 'mismo estado: nada');
    eq(e(['a', 'b', 'c']).join(), 'c', 'entra c');
    eq(e(['a', 'b', 'c']).length, 0, 'c sigue: no repite');
    eq(e(['a', 'b']).length, 0, 'c sale');
    eq(e(['a', 'b', 'c']).join(), 'c', 'c vuelve: suena otra vez');
    eq(e(null).length, 0); eq(e(['a']).join(), 'a', 'nulo cuenta como vacío');
  });

  // 5 · Meteo: «Visto» no se queda bloqueado; empeora de verdad → vuelve a sonar (umbral = el de meteo.js, no uno nuevo)
  test('5 · Meteo: visto no repite; si empeora según meteo.js vuelve a pendiente y suena; sin umbrales nuevos', () => {
    const { A } = audioIn(), e = A.edge();
    const al = v => [{ kind: 'gust', value: v }];
    let acks = {};
    const pend = list => W.pendingAlerts(list, acks).map(a => a.kind);
    e(pend([]));                                   // arma
    eq(e(pend(al(60))).join(), 'gust', 'entra la alerta pendiente → suena');
    acks = W.ack(acks, al(60)[0]);
    eq(e(pend(al(60))).length, 0, '«Visto»: sale de pendientes, no suena');
    eq(e(pend(al(62))).length, 0, 'misma alerta vista, un poco más (por debajo del empeoramiento de meteo.js): no suena');
    eq(e(pend(al(65))).join(), 'gust', 'empeora según meteo.js (+5 km/h): vuelve a pendiente → suena');
    ok(!/WORSE|\+ ?5/.test(D.src('audio.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'audio.js no define umbrales propios');
  });

  // 6 · Web Audio: sin soporte no falla; sin gesto no suena; tras gesto, tonos sintetizados
  test('6 · Web Audio: sin AudioContext no suena ni falla; sin gesto no suena; tras clic/tecla, tonos', () => {
    const { A } = audioIn();
    ok(!A.supported() && !A.unlock() && !A.play('call') && !A.alert('call'), 'sin Web Audio: nada y sin errores');
    const log = [], { A: B } = audioIn({ AC: fakeAC(log) });
    ok(B.supported(), 'con Web Audio');
    ok(!B.play('call') && log.length === 0, 'sin gesto (contexto sin crear): no suena');
    ok(B.unlock() && B.play('call') && log.join() === '660,880', 'tras el gesto: dos notas que suben');
    ok(!B.play('nada'), 'tipo desconocido: nada');
    ['call', 'overrun', 'meteo', 'urgent'].forEach(k => ok(B.TONES[k].notes.length >= 2, k + ': tono propio'));
    const log2 = [], { A: S } = audioIn({ AC: fakeAC(log2, 'suspended') });
    S.unlock(); ok(log2.length === 0, 'desbloquear no suena por sí solo');
    ok(!/<audio|['"][^'"]*\.(mp3|wav|ogg|m4a)['"]|new Audio\(/.test(D.src('audio.js')), 'sin ficheros de audio');
  });

  // 7 · urgent en la emisión: booleano estricto, texto intacto
  test('7 · Emisión: «urgent» es booleano estricto en el mensaje y en el hilo; el texto no cambia', () => {
    const m = u => E.cleanProdMsg(Object.assign({ type: 'chat', from: 'prod_001', text: '¡Corte de luz en Carpa!' }, u === undefined ? {} : { urgent: u }));
    eq(m(true).urgent, true); eq(m(true).text, '¡Corte de luz en Carpa!', 'texto tal cual');
    [false, 'true', 1, null, {}, undefined].forEach(v => eq(m(v).urgent, false, 'no es true: ' + JSON.stringify(v)));
    const l = E.cleanChatLog({ type: 'chatlog', list: [{ id: 'a', at: 1, text: 'x', urgent: true }, { id: 'b', at: 2, text: 'y', urgent: 'yes' }, { id: 'c', at: 3, text: 'z' }] });
    eq(l.map(x => x.urgent).join(), 'true,false,false', 'en el hilo: viejo o raro → false');
  });

  // 8 · Guardado en el Dashboard: urgent booleano; hilos viejos → false
  test('8 · Dashboard: el chat guarda «urgent» como booleano y los mensajes viejos cuentan como no urgentes', () => {
    const old = [{ id: 'v1', at: 1, from: 'Marta', pid: 'prod_001', text: 'viejo', sm: false }, { id: 'v2', at: 2, from: 'Marta', pid: 'prod_001', text: 'raro', sm: false, urgent: 'true' }];
    const t = dashboard({ 'showtime.chat': JSON.stringify(old) });
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: 'urgente de verdad', urgent: true });
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: 'normal' });
    const st = t.read('showtime.chat');
    eq(st.slice(-2).map(x => x.urgent).join(), 'true,false', 'guardados');
    eq(st[st.length - 2].text, 'urgente de verdad', 'texto intacto');
    const Dt = t.env.win.ShowtimeDatos;
    eq(Dt.getChat().map(x => x.urgent).join(), 'false,false,true,false', 'leídos: viejo y raro → false');
    ok(Dt.getChat().every(x => typeof x.urgent === 'boolean'), 'siempre booleano');
  });

  // 9 · Solo Producción marca; Dashboard y Mando solo muestran
  test('9 · Solo Producción marca «urgente» (triángulo SVG con aria-pressed); Dashboard y Mando solo lo muestran', () => {
    const live = D.src('live.html'), lj = D.src('live.js'), idx = D.src('index.html'), rem = D.src('remote.html'), rj = D.src('remote.js'), cj = D.src('control.js');
    ok(/<form id="cd-form"[^>]*><button id="cd-urg" class="iconbtn cd-urg" type="button" aria-pressed="false" title="Marcar como urgente" data-i18n-title><svg class="ic"><use href="#i-urg"\/><\/svg><\/button>/.test(live), 'conmutador en el chat de Producción');
    ok(/sendProdMessage\(\{ type: 'chat', from: PRODID, text, urgent \}\)/.test(lj), 'payload { type, from, text, urgent }');
    ok(/const urgent = urgOn\(\);/.test(lj) && /return !!b && b\.getAttribute\('aria-pressed'\) === 'true';/.test(lj), 'urgent sale de aria-pressed: booleano');
    ok(!/cd-urg|aria-pressed="false" title="Marcar como urgente"/.test(idx) && !/Marcar como urgente/.test(rem), 'ni el Dashboard ni el Mando tienen control para marcar');
    ok(!/urgent/.test(D.src('mando.js')), 'el mando no manda «urgent»');
    ok(/Dt\.addChat\(cmd\.args\.text, from, zone !== null \? 'mando:' \+ zone : 'mando', false\);/.test(cj), 'chat del mando: nunca urgente');
    ok(/if \(!Dt\.addChat\(inp\.value, 'Stage Manager', '', true\)\) return;/.test(cj), 'chat del Stage Manager: nunca urgente');
    const sym = s => (s.match(/<symbol id="i-urg"[^]*?<\/symbol>/) || [''])[0];
    ok(sym(idx) && sym(idx) === sym(live) && sym(idx) === sym(rem), 'el mismo SVG en las tres páginas');
    [cj, lj, rj].forEach((s, i) => ok(/role="img" aria-label="' \+ t \+ '"><title>' \+ t \+ '<\/title><use href="#i-urg"\/>/.test(s) && /m?\.?urgent === true|x\.urgent/.test(s), ['Dashboard', 'Producción', 'Mando'][i] + ': lo muestra'));
  });

  // 10 · Dashboard: suena al entrar (CALL, sobretiempo, meteo, urgente); configuración y PWA
  test('10 · Dashboard: suena al entrar en CALL/sobretiempo/meteo y con urgente recibido; apagado no suena; sección y PWA', () => {
    const log = [];
    const t = dashboard({ [KEY]: JSON.stringify({ on: true, meteo: false }) }, fakeAC(log));
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: 'antes del gesto', urgent: true });
    eq(log.length, 0, 'sin gesto todavía: no suena');
    t.env.fire('document', 'pointerdown', GEST);   // primer clic
    t.T.audioTick(null); t.adv(2000);              // sin evento: la lectura arma en silencio (nada activo)
    t.T.audioTick(['call-x'], [], []); eq(log.join(), '660,880', 'entra un CALL (transición real desde «nada activo»): tono CALL');
    log.length = 0; t.adv(2000); t.T.audioTick(['call-x', 'call-y'], [], []); eq(log.join(), '660,880', 'entra otro CALL: suena otra vez');
    log.length = 0; t.adv(2000); t.T.audioTick(['call-x', 'call-y'], [], []); eq(log.length, 0, 'mismo CALL: no repite');
    t.adv(2000); t.T.audioTick(['call-x', 'call-y'], ['blk1'], []); eq(log.join(), '440,440,440', 'sobretiempo');
    log.length = 0; t.adv(2000); t.T.audioTick(['call-x', 'call-y'], ['blk1'], ['gust']); eq(log.length, 0, 'meteo desmarcado: no suena');
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: 'normal' }); eq(log.length, 0, 'mensaje normal: no suena');
    t.adv(2000); t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: '¡ya!', urgent: true }); eq(log.join(), '988,988,988,1319', 'urgente: suena');
    log.length = 0; t.env.storage.set(KEY, JSON.stringify({ on: false }));
    t.adv(2000); t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: '¡otra!', urgent: true }); t.T.audioTick(['z'], ['q'], []); eq(log.length, 0, 'interruptor apagado: silencio');
    const cj = D.src('control.js');
    ok(/audioTick\(C\.callList\(LIVE, nowInt, Dt\.callMinsOf\(FEST, CONFIG\), new Set\(Dt\.getCallDone\(\)\)\)\.map\(b => \(\{ key: C\.callKey\(b\), label: b\.name \}\)\),/.test(cj), 'CALL: la misma ventana que la tarjeta CALL');
    ok(/LIVE\.filter\(b => xtraOver\(b, nowInt\) !== null\)\.map\(b => \(\{ key: b\.key, label: b\.name \}\)\),/.test(cj), 'sobretiempo: Tiempo extra pasado de su fin previsto (xtraOver)');
    ok(/mst && mst\.c\.on \? mst\.pending\.map\(a => \(\{ key: a\.kind, label: a\.text \}\)\) : \[\]\);/.test(cj), 'meteo: la cola de pendientes existente');
    const idx = D.src('index.html'), sec = idx.slice(idx.indexOf('<details class="cfg-s" id="cfg-s-audio">'), idx.indexOf('</details>', idx.indexOf('id="cfg-s-audio"')));
    ok(/title="Los avisos solo se reproducen en este dispositivo\." data-i18n data-i18n-title><input id="au-on" type="checkbox" role="switch"> Activar<\/label>/.test(sec), 'interruptor con el tooltip literal');
    eq((sec.match(/data-au="(\w+)"/g) || []).join(' '), 'data-au="call" data-au="overrun" data-au="meteo" data-au="urgent"', 'las 4 casillas');
    ok(!/class="note"|class="hint"/.test(sec), 'sin texto explicativo visible');
    ok(idx.indexOf('<script src="audio.js?v=') > 0 && idx.indexOf('<script src="audio.js?v=') < idx.indexOf('<script src="control.js?v='), 'audio.js antes de control.js');
    ok(/'audio\.js'/.test(D.src('sw.js')), 'en la precarga de la PWA');
    ok(!/audio\.js/.test(D.src('live.html')) && !/audio\.js/.test(D.src('remote.html')), 'solo en el Dashboard');
    const I = require('../i18n.js');
    eq(I.tx('Avisos de audio', null, 'en'), 'Audio alerts'); eq(I.tx('Los avisos solo se reproducen en este dispositivo.', null, 'en'), 'Alerts only play on this device.');
    eq(I.tx('Marcar como urgente', null, 'en'), 'Mark as urgent'); eq(I.tx('Urgente', null, 'en'), 'Urgent');
    const env2 = D.makeEnv({ storage: { [KEY]: JSON.stringify({ on: true }) } }); const log2 = []; env2.win.AudioContext = fakeAC(log2);
    D.cargar(env2, MODULOS); env2.fire('document', 'pointerdown', GEST);
    ok(log2.length === 0 && env2.errors.length === 0, 'al cargar (y tras el primer clic) no suena nada ni hay errores');
  });

  // ── Dec. 146 ─────────────────────────────────────────────────────────
  /** AudioContext de mentira que además cuenta los cortes (stop(0)). */
  function fakeAC2(rec) {
    rec.notes = rec.notes || []; rec.cuts = 0;
    return function () {
      this.state = 'running'; this.currentTime = 0; this.destination = {};
      this.resume = () => Promise.resolve();
      this.createOscillator = () => { const o = { type: '', frequency: { value: 0 }, connect() {}, disconnect() {}, start() { rec.notes.push(o.frequency.value); }, stop(t) { if (t === 0) rec.cuts++; } }; return o; };
      this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
    };
  }

  test('11 · Carga e importación silenciosas: arrancar, abrir o reemplazar con un CALL ya activo no llama al reproductor; un CALL nuevo después, sí', () => {
    const rec = {}, T0 = at2320(), F = festCall(T0);
    const t = dashboard({ 'showtime.festival': JSON.stringify(F), [KEY]: JSON.stringify({ on: true, repeat: true }) }, fakeAC2(rec), T0);
    eq(t.A.RING.size(), 0, 'al arrancar con el CALL de «Banda A» abierto: nada en la cola');
    t.env.fire('document', 'pointerdown', GEST); t.adv(1500); t.env.win.ShowtimePanel.reload();
    eq(rec.notes.length, 0, 'tras el primer clic y otra lectura: silencio (el CALL ya estaba)');
    const G = festCall(T0); G.event.nombre = 'Otro evento'; G.artists[0].nombre = 'Banda C';   // otro CALL ya abierto
    ok(C.callKey(C.buildBlocks(G, { mode: 'all', day: 'all' })[0]) !== C.callKey(C.buildBlocks(F, { mode: 'all', day: 'all' })[0]), 'el CALL del evento nuevo es otro');
    t.adv(1500); t.T.loadNew(G, 'Evento abierto');
    eq(rec.notes.length + t.A.RING.size(), 0, 'abrir / reemplazar el evento con un CALL activo: silencio y cola vacía');
    t.adv(1500); t.T.loadNew(JSON.parse(JSON.stringify(G)), 'Evento abierto');
    eq(rec.notes.length, 0, 'volver a abrir el mismo evento: silencio');
    const cj = D.src('control.js'), imp = cj.slice(cj.indexOf('function impDoImport'), cj.indexOf('function readTextFile'));
    ok(imp.indexOf('audioRearm();') > 0 && imp.indexOf('audioRearm();') < imp.indexOf('commitFestival(r.state, msg);'), 'importar (Pegar horario): rearme ANTES de pintar (renderAll lee el estado)');
    const ln = cj.slice(cj.indexOf('function loadNew'), cj.indexOf('function exportJSON'));
    ok(ln.indexOf('audioRearm();') > 0 && ln.indexOf('audioRearm();') < ln.indexOf('compute(); renderAll();'), 'abrir / crear / demo: rearme antes de pintar');
  });

  test('11b · Después de cargar, una transición real inactivo → activo suena UNA vez', () => {
    const rec = {}, T0 = at2320(), F = festCall(T0);
    const t = dashboard({ 'showtime.festival': JSON.stringify(F), [KEY]: JSON.stringify({ on: true }) }, fakeAC2(rec), T0);
    t.env.fire('document', 'pointerdown', GEST);
    const key = C.callKey(C.buildBlocks(F, { mode: 'all', day: 'all' })[0]);
    t.adv(1500); t.T.audioTick([{ key, label: 'Banda A' }], [], []); eq(rec.notes.length, 0, 'mismo estado de la carga: nada');
    t.adv(1500); t.T.audioTick([{ key, label: 'Banda A' }, { key: 'k2', label: 'Banda B' }], [], []); eq(rec.notes.join(), '660,880', 'entra Banda B: suena');
    t.adv(1500); t.T.audioTick([{ key, label: 'Banda A' }, { key: 'k2', label: 'Banda B' }], [], []); eq(rec.notes.join(), '660,880', 'y no repite (repetición apagada)');
  });

  test('12 · Muestra de los 4 tonos: con «Activar» apagado, corta la anterior, una sola muestra, no toca nada', () => {
    const rec = {}, t = dashboard({}, fakeAC2(rec));
    const before = t.env.storage.get(KEY);
    const fq = k => t.A.TONES[k].notes.map(n => n[0]).join();
    ['call', 'overrun', 'meteo', 'urgent'].forEach(k => { rec.notes = []; ok(t.T.audioPreview(k), k + ': suena'); eq(rec.notes.join(), fq(k), k + ': su tono, una vez'); });
    ok(rec.cuts > 0, 'cada muestra corta la anterior (una sola voz)');
    eq(t.env.storage.get(KEY), before, 'preferencias intactas (apagado)'); eq(t.A.RING.size(), 0, 'no crea avisos'); eq(t.A.load().on, false, 'no activa nada');
    ok(!t.T.audioPreview('nada'), 'tipo desconocido: nada');
    const idx = D.src('index.html');
    ['call', 'overrun', 'meteo', 'urgent'].forEach(k => ok(new RegExp('<button id="au-pv-' + k + '" class="au-pv" type="button" data-au-pv="' + k + '" title="Escuchar el tono" aria-label="Escuchar el tono" data-i18n-title data-i18n-aria><svg class="ic"><use href="#i-play"/></svg></button>').test(idx), k + ': botón SVG accesible'));
    const { A } = audioIn(); ok(!A.preview('call'), 'sin Web Audio: no falla');
  });

  test('13 · «Repetir» e intervalo independientes por tipo (apagado por defecto en los 4; intervalo solo con «Repetir»)', () => {
    const { A } = audioIn(), d = A.load();
    A.KINDS.forEach(k => { eq(d.rep[k], false, k + ': Repetir apagado'); eq(d.every[k], 10, k + ': 10 s'); });
    const p = { on: true, rep: { call: true, meteo: true }, every: { call: 5, meteo: 20 } };
    ok(A.repeats(p, 'call') && A.repeats(p, 'meteo') && !A.repeats(p, 'overrun') && !A.repeats(p, 'urgent'), 'cada tipo con su «Repetir»');
    ok(!A.repeats(Object.assign({}, p, { on: false }), 'call') && !A.repeats(Object.assign({}, p, { call: false }), 'call'), 'sin interruptor o sin su casilla, no repite');
    eq(A.everyOf(p, 'call'), 5); eq(A.everyOf(p, 'meteo'), 20); eq(A.everyOf(p, 'urgent'), 10);
    const rec = {}, t = dashboard({ [KEY]: JSON.stringify(p) }, fakeAC2(rec));
    t.env.fire('document', 'pointerdown', GEST); t.T.audioTick(null);
    t.adv(1000); t.T.audioTick(['c1'], ['o1'], ['gust']);            // entran los tres a la vez
    for (let i = 0; i < 50; i++) { t.adv(500); t.T.audioTick(['c1'], ['o1'], ['gust']); }   // 25 s
    const calls = rec.notes.filter(f => f === 660).length, overs = rec.notes.filter(f => f === 440).length / 3, mets = rec.notes.filter(f => f === 784).length;
    eq(overs, 1, 'Sobretiempo sin «Repetir»: una vez'); ok(calls >= 5 && calls <= 6, 'CALL cada 5 s (' + calls + ' en 25 s)'); ok(mets === 2, 'Meteo cada 20 s (' + mets + ' en 25 s)');
    const idx = D.src('index.html'), sec = idx.slice(idx.indexOf('id="cfg-s-audio"'), idx.indexOf('id="cfg-s-meteo"'));
    ['call', 'overrun', 'meteo', 'urgent'].forEach(k => ok(new RegExp('<span class="au-row"><label class="chk au-k" data-i18n><input id="au-' + k + '" data-au="' + k + '" type="checkbox"> [^<]+</label><button id="au-pv-' + k + '" class="au-pv"[^>]*>.*?</button><label class="chk au-rp" title="[^"]+" data-i18n data-i18n-title><input id="au-rep-' + k + '" type="checkbox"> Repetir</label><select id="au-ev-' + k + '" class="mini"[^>]*><option value="5">5 s</option><option value="10">10 s</option><option value="20">20 s</option><option value="30">30 s</option></select></span>').test(sec), k + ': fila compacta (casilla · ▷ · Repetir · intervalo)'));
    const cj = D.src('control.js'); ok(/ev\.disabled = !live \|\| !p\[k\] \|\| !p\.rep\[k\];/.test(cj), 'el intervalo solo está activo con «Repetir»');
    const env = D.makeEnv({ storage: { [KEY]: JSON.stringify({ on: true, rep: { meteo: true } }) } }); D.cargar(env, MODULOS);
    env.win.ShowtimePanel._test.fillAudioCfg();
    ok(env.getEl('au-ev-call').disabled === true && env.getEl('au-ev-meteo').disabled === false && env.getEl('au-rep-call').checked === false && env.getEl('au-rep-meteo').checked === true, 'pintado por tipo');
  });

  test('14 · Sin solapes: varios pendientes suenan de uno en uno y cada uno respeta su intervalo', () => {
    const played = [], R = audioIn().A.makeRing(k => { played.push(k); return 0.5; });
    const ev = k => ({ call: 10, overrun: 20 })[k] || 10;
    R.add({ id: 'a', kind: 'call', key: 'a', repeat: true }, 0); R.add({ id: 'b', kind: 'overrun', key: 'b', repeat: true }, 0); R.add({ id: 'c', kind: 'urgent', key: 'c', repeat: false }, 0);
    ok(!R.add({ id: 'a', kind: 'call', key: 'a', repeat: true }, 0), 'sin duplicados');
    eq(R.step(0, ev), 'a'); eq(R.step(300, ev), null, 'mientras suena «a», nada más');
    eq(R.step(800, ev), 'b'); eq(R.step(1000, ev), null); eq(R.step(1600, ev), 'c'); eq(R.step(2400, ev), null, 'vuelta acabada');
    eq(R.size(), 2, 'el de una vez sale al sonar');
    eq(R.step(9999, ev), null); eq(R.step(10000, ev), 'a', 'CALL a los 10 s'); eq(R.step(10800, ev), null, 'Sobretiempo aún no (20 s)'); eq(R.step(20000, ev), 'a', 'CALL otra vez a los 20 s'); eq(R.step(20800, ev), 'b', 'Sobretiempo a sus 20 s, después');
    eq(played.join(), 'call,overrun,urgent,call,call,overrun', 'nunca dos a la vez');
    R.hold(21500, 1); eq(R.step(22000, ev), null, 'una muestra ocupa la voz: el planificador espera');
  });

  test('15 · Sin barra genérica ni cola visible: no hay #au-bar, ni pastillas, ni «confirmar»', () => {
    const idx = D.src('index.html'), cj = D.src('control.js'), css = D.src('control.css');
    ok(!/au-bar|aubar|au-item|data-au-ok/.test(idx + cj + css), 'ni rastro de la barra de la v20261158');
    ok(!/renderAuBar|RING\.pending\(\)/.test(cj), 'el Dashboard no pinta la cola');
    ok(!/confirmar todo|Confirmar aviso/i.test(idx + cj + D.src('i18n.js')), 'ni «confirmar todo» ni «Confirmar aviso»');
    const rec = {}, t = dashboard({ [KEY]: JSON.stringify({ on: true, rep: { call: true, overrun: true, meteo: true, urgent: true } }) }, fakeAC2(rec));
    t.env.fire('document', 'pointerdown', GEST); t.T.audioTick(null); t.adv(1000); t.T.audioTick(['c1'], ['o1'], ['m1']);
    ok(!t.env.innerLog.some(([n, h]) => n === 'au-bar' || /au-item|data-au-ok/.test(h)), 'con avisos repitiéndose, no aparece ninguna barra');
  });

  test('16 · Se para desde el aviso que ya existe: OK de CALL, «Visto», ✓ local en EN ESCENA y en el mensaje urgente; sin cambiar su significado', () => {
    const rec = {}, all = { call: true, overrun: true, meteo: true, urgent: true };
    const t = dashboard({ [KEY]: JSON.stringify({ on: true, rep: all }) }, fakeAC2(rec));
    t.env.fire('document', 'pointerdown', GEST); t.T.audioTick(null);
    t.adv(1000); t.T.audioTick([{ key: 'k1', label: 'Banda A' }], [{ key: 'b9', label: 'Banda Z' }], [{ key: 'gust', label: 'Ráfagas' }]);
    t.adv(1000); t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: '¡Corte!', urgent: true });
    const uid = t.read('showtime.chat').slice(-1)[0].id;
    ['call:k1', 'overrun:b9', 'meteo:gust', 'urgent:' + uid].forEach(id => ok(t.A.RING.repeating(id), id + ': se repite'));
    // CALL: el OK de siempre lo saca de la ventana CALL → deja de repetirse (el audio solo reacciona)
    t.adv(1000); t.T.audioTick([], [{ key: 'b9', label: 'Banda Z' }], [{ key: 'gust', label: 'Ráfagas' }]);
    ok(!t.A.RING.repeating('call:k1'), 'CALL: OK → se para'); ok(!/data-au-ack="call|auAckBtn\('call/.test(D.src('control.js')), 'CALL: sin ✓ nuevo (usa su OK)');
    // Meteo: «Visto» lo saca de pendientes → se para
    t.adv(1000); t.T.audioTick([], [{ key: 'b9', label: 'Banda Z' }], []);
    ok(!t.A.RING.repeating('meteo:gust'), 'Meteo: «Visto» → se para'); ok(!/auAckBtn\('meteo/.test(D.src('control.js')), 'Meteo: sin ✓ nuevo (usa su «Visto»)');
    // Sobretiempo: ✓ local dentro de EN ESCENA (solo mientras se repite)
    ok(/data-au-ack="overrun:b9"/.test(t.T.auAckBtn('overrun:b9', 'Banda Z')), 'Sobretiempo: ✓ en su aviso');
    const callDone = t.env.storage.get('showtime.callDone'), chat = t.env.storage.get('showtime.chat'), fest = t.env.storage.get('showtime.festival'), log = t.env.storage.get('showtime.log');
    t.env.fire('document', 'click', { target: { closest: q => q === '[data-au-ack]' ? { dataset: { auAck: 'overrun:b9' } } : null } });
    ok(!t.A.RING.repeating('overrun:b9') && t.T.auAckBtn('overrun:b9') === '', 'Sobretiempo: ✓ → se para y el ✓ desaparece');
    t.adv(1000); t.T.audioTick([], [{ key: 'b9', label: 'Banda Z' }], []); ok(!t.A.RING.repeating('overrun:b9'), 'y no vuelve mientras siga en sobretiempo');
    eq(t.env.storage.get('showtime.festival'), fest, '✓ no termina la banda ni cambia el evento');
    ok(/tx\('TIEMPO EXTRA · \+\{n\} min', \{ n: xtraOver\(b, nowInt\) \}\) \+ auAckBtn\('overrun:' \+ b\.key, b\.name\)/.test(D.src('control.js')), 'el ✓ va dentro de «TIEMPO EXTRA · +N min» de EN ESCENA');
    // Urgente: ✓ local dentro del propio mensaje del chat
    t.T.renderChat(); const ch = t.env.innerLog.filter(([n]) => n === 'chat-list').slice(-1)[0][1];
    ok(new RegExp('data-au-ack="urgent:' + uid + '"').test(ch), 'Urgente: ✓ dentro del mensaje');
    ok(t.T.audioConfirm('urgent:' + uid) && !t.A.RING.repeating('urgent:' + uid), 'Urgente: ✓ → se para');
    const ch2 = t.env.innerLog.filter(([n]) => n === 'chat-list').slice(-1)[0][1];
    ok(!/data-au-ack=/.test(ch2) && /urg-i/.test(ch2), 'el ✓ desaparece; el triángulo de urgente sigue');
    eq(t.env.storage.get('showtime.chat'), chat, 'el mensaje, su «urgent» y el chat no cambian'); eq(t.env.storage.get('showtime.callDone'), callDone, 'sin OK de CALL'); eq(t.env.storage.get('showtime.log'), log, 'el log no cambia');
    ok(!/data-au-ack|au-ack/.test(D.src('live.js') + D.src('remote.js') + D.src('live.html') + D.src('remote.html')), 'Producción y Mando sin ✓ (urgent lo marca solo Producción)');
  });

  test('17 · Arranque silencioso; cambiar de jornada o de vista NO rearma; «Activar» OFF corta todo y al volver no suena nada', () => {
    const rec = {}, T0 = at2320(), F = festCall(T0);
    const t = dashboard({ 'showtime.festival': JSON.stringify(F), [KEY]: JSON.stringify({ on: true, rep: { call: true } }) }, fakeAC2(rec), T0);
    t.env.fire('document', 'pointerdown', GEST);
    const key = C.callKey(C.buildBlocks(F, { mode: 'all', day: 'all' })[0]);
    t.adv(1000); t.T.audioTick([{ key, label: 'Banda A' }], [], []); eq(rec.notes.length, 0, 'arranque con CALL activo: silencio');
    t.T.dayStep(1); t.adv(1000);
    t.T.audioTick([{ key, label: 'Banda A' }, { key: 'k2', label: 'Banda B' }], [], []);
    eq(rec.notes.join(), '660,880', 'tras cambiar de jornada no se rearma: lo que entra suena');
    const cj = D.src('control.js'); ok(/const sig = FEST && calls \? \(window\.ShowtimeLog \? window\.ShowtimeLog\.eventKey\(FEST\) : ''\) : null;/.test(cj), 'la firma es solo el evento (ni jornada ni vista)');
    ok(t.A.RING.repeating('call:k2'), 'se repite');
    const on = t.env.getEl('au-on'); on.checked = false; t.T.saveAudioCfg();
    eq(t.A.RING.size(), 0, 'OFF: nada pendiente'); ok(/if \(s\.on !== old\.on\) \{ AU\.stop\(\); AU\.RING\.clear\(\); audioRearm\(\); \}/.test(cj), 'OFF corta el sonido en curso');
    rec.notes = []; on.checked = true; t.T.saveAudioCfg();
    for (let i = 0; i < 4; i++) { t.adv(10000); t.T.audioTick([{ key, label: 'Banda A' }, { key: 'k2', label: 'Banda B' }], [], []); }
    eq(rec.notes.length + t.A.RING.size(), 0, 'ON otra vez: lo que ya estaba no suena');
  });

  test('18 · Preferencias siempre locales: por tipo en «showtime.audioAlerts»; nada viaja', () => {
    const t = dashboard({ [KEY]: JSON.stringify({ on: true }) });
    t.env.getEl('au-on').checked = true;
    ['call', 'overrun', 'meteo', 'urgent'].forEach(k => { t.env.getEl('au-' + k).checked = true; t.env.getEl('au-ev-' + k).value = '10'; });
    t.env.getEl('au-rep-call').checked = true; t.env.getEl('au-ev-call').value = '20'; t.env.getEl('au-rep-urgent').checked = true; t.env.getEl('au-ev-urgent').value = '5';
    t.T.saveAudioCfg();
    const p = t.read(KEY); ok(p.rep.call && p.rep.urgent && !p.rep.meteo && !p.rep.overrun && p.every.call === 20 && p.every.urgent === 5 && p.every.meteo === 10, 'guardado por tipo');
    ok(!/rep|every|audio|au-/i.test(JSON.stringify(t.read('showtime.config') || {})), 'configuración del Panel (la que viaja) limpia');
    ['datos.js', 'emision.js', 'live.js', 'remote.js', 'mando.js', 'vistas.js', 'core.js'].forEach(f => ok(!/RING|audioConfirm|au-ack|audioAlerts|ShowtimeAudio/.test(D.src(f)), f + ': sin rastro del audio local'));
    ok(!/audio\.js/.test(D.src('live.html') + D.src('remote.html')), 'Live, Producción, Mando, Confidence, Backstage y Staff no cargan audio.js');
    const E2 = E.cleanProdMsg({ type: 'chat', from: 'p', text: 'x', urgent: true, repeat: true, ack: true });
    eq(Object.keys(E2).sort().join(), 'from,text,type,urgent', 'el mensaje de Producción no admite campos del audio');
  });

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
    console.log('Audio: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
