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
  function dashboard(storage, AC) {
    const env = D.makeEnv({ cripto: true, storage: Object.assign({ 'showtime.producers': JSON.stringify({ producers: [{ id: 'prod_001', name: 'Marta' }], counter: 1, defaultId: 'prod_001' }) }, storage || {}) });
    if (AC) env.win.AudioContext = AC;
    D.cargar(env, MODULOS);
    return { env, T: env.win.ShowtimePanel._test, read: k => { const v = env.storage.get(k); return v ? JSON.parse(v) : null; } };
  }

  // 1 · Preferencias: clave exacta, apagado por defecto, datos rotos o a medias normalizados
  test('1 · Preferencias en «showtime.audioAlerts»: apagado por defecto y datos rotos o a medias normalizados', () => {
    const { A } = audioIn();
    eq(A.KEY, KEY);
    eq(JSON.stringify(A.normPrefs(null)), JSON.stringify({ on: false, call: true, overrun: true, meteo: true, urgent: true }), 'por defecto: interruptor apagado, casillas marcadas');
    eq(A.normPrefs({ on: 'true', call: 0, meteo: false, urgent: null, extra: 1 }).on, false, 'cadena «true» no vale');
    const p = A.normPrefs({ on: 'true', call: 0, meteo: false, urgent: null, extra: 1 });
    ok(p.call === true && p.meteo === false && p.urgent === true && !('extra' in p), 'solo booleanos; lo demás, por defecto; campos ajenos fuera');
    eq(JSON.stringify(A.normPrefs([true])), JSON.stringify(A.DEFAULTS), 'un array no es un objeto de preferencias');
    ['{', '"x"', '42', 'null', '[]'].forEach(raw => { const { A: B } = audioIn({ storage: { [KEY]: raw } }); eq(JSON.stringify(B.load()), JSON.stringify(A.DEFAULTS), 'JSON roto o raro: ' + raw); });
    const { A: B, env } = audioIn({ storage: { [KEY]: '{"on":true}' } });
    ok(B.load().on === true && B.load().call === true, 'parcial: lo que falta, por defecto');
    B.save({ on: true, call: false, junk: 'x' });
    eq(env.storage.get(KEY), JSON.stringify({ on: true, call: false, overrun: true, meteo: true, urgent: true }), 'se guarda normalizado');
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
    const GEST = { target: { closest: () => null, id: '' } };
    t.env.fire('document', 'pointerdown', GEST);   // primer clic
    t.T.audioTick(['call-x'], [], []); eq(log.length, 0, 'primer vistazo (sin evento al cargar, aún sin armar): arma sin sonar');
    t.T.audioTick(['call-x', 'call-y'], [], []); eq(log.join(), '660,880', 'entra un CALL: tono CALL');
    log.length = 0; t.T.audioTick(['call-x', 'call-y'], [], []); eq(log.length, 0, 'mismo CALL: no repite');
    t.T.audioTick(['call-x', 'call-y'], ['blk1'], []); eq(log.join(), '440,440,440', 'sobretiempo');
    log.length = 0; t.T.audioTick(['call-x', 'call-y'], ['blk1'], ['gust']); eq(log.length, 0, 'meteo desmarcado: no suena');
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: 'normal' }); eq(log.length, 0, 'mensaje normal: no suena');
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: '¡ya!', urgent: true }); eq(log.join(), '988,988,988,1319', 'urgente: suena');
    log.length = 0; t.env.storage.set(KEY, JSON.stringify({ on: false }));
    t.T.emProdMessage({ type: 'chat', from: 'prod_001', text: '¡otra!', urgent: true }); t.T.audioTick(['z'], ['q'], []); eq(log.length, 0, 'interruptor apagado: silencio');
    const cj = D.src('control.js');
    ok(/audioTick\(C\.callList\(LIVE, nowInt, Dt\.callMinsOf\(FEST, CONFIG\), new Set\(Dt\.getCallDone\(\)\)\)\.map\(C\.callKey\),/.test(cj), 'CALL: la misma ventana que la tarjeta CALL');
    ok(/LIVE\.filter\(b => xtraOver\(b, nowInt\) !== null\)\.map\(b => b\.key\),/.test(cj), 'sobretiempo: Tiempo extra pasado de su fin previsto (xtraOver)');
    ok(/mst && mst\.c\.on \? mst\.pending\.map\(a => a\.kind\) : \[\]\);/.test(cj), 'meteo: la cola de pendientes existente');
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

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
    console.log('Audio: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
