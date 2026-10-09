/* Tests de vistas.js — sin dependencias.
 * Ordenador:  node tests/vistas.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const V = isNode ? require('../vistas.js') : window.ShowtimeVistas;
  const M = isNode ? require('../mando.js') : window.ShowtimeMando;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // ── Evento de prueba: jornada 10-jul, Principal y Carpa ───────────────
  const JOR = '2026-07-10';
  const at = hm => C.toAbs(hm < '06:00' ? '2026-07-11' : JOR, hm);
  const atS = (hm, s) => at(hm) + s / 60;
  function fest() {
    let s = C.newFestival({ nombre: 'Prueba vistas', fechaInicio: JOR, fechaFin: JOR, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const P = s.escenarios[0].id, K = s.escenarios[1].id, ids = {};
    const add = (n, d) => { const r = C.addArtist(s, d.modo || 'show', Object.assign({ jornada: JOR, nombre: n }, d)); if (!r.ok) throw new Error(n + ': ' + r.error); s = r.state; ids[n] = r.id; };
    add('Banda A', { escenarioId: P, inicio: '20:30', fin: '21:30', call: '20:00' });
    add('Banda B', { escenarioId: P, inicio: '22:00', fin: '23:00' });
    add('Acústico', { escenarioId: K, inicio: '21:00', fin: '22:00' });
    add('Curfew', { tipo: 'hito', escenarioId: P, inicio: '23:30' });
    s = C.setFija(s, ids['Curfew'], true).state;            // el curfew no se mueve con los retrasos
    return { s, P, K, ids };
  }
  const key = (s, name) => C.buildBlocks(s, { mode: 'all', day: 'all' }).find(b => b.name === name).key;

  // ── Vistas y ajustes ──────────────────────────────────────────────────
  test('vistas: nombres válidos y la tecla V las rota en bucle', () => {
    eq(V.normVista('confidence'), 'confidence'); eq(V.normVista('raro'), 'manager'); eq(V.normVista(null), 'manager');
    eq(V.nextVista('manager'), 'confidence'); eq(V.nextVista('confidence'), 'backstage'); eq(V.nextVista('backstage'), 'manager');
  });

  test('ajustes de pantallas: valores por defecto, límites y el rojo nunca antes que el ámbar', () => {
    const d = V.normScreens();
    eq(d.conf.showWarn, 10); eq(d.conf.showDanger, 5); eq(d.conf.blink, true); eq(d.conf.coWarn, 5); eq(d.conf.coDanger, 1);
    ok(d.back.cards && d.back.lines && d.back.ticker); eq(d.ticker.mode, 'crawl');
    const x = V.normScreens({ conf: { showWarn: 3, showDanger: 8, blink: false, coWarn: 'x' }, back: { lines: false }, ticker: { mode: 'static', bg: '#FFFFFF', fg: 'rojo' } });
    eq(x.conf.showDanger, 3, 'rojo recortado al ámbar'); eq(x.conf.blink, false); eq(x.conf.coWarn, 5);
    eq(x.back.lines, false); eq(x.back.cards, true); eq(x.ticker.mode, 'static'); eq(x.ticker.bg, '#ffffff'); eq(x.ticker.fg, '#ffb347');
  });

  test('mensajes por destino: todas, una o varias pantallas', () => {
    eq(V.normTargets(null), null); eq(V.normTargets(['manager', 'confidence', 'backstage']), null, 'las tres = todas');
    eq(V.normTargets(['backstage', 'raro']).join(), 'backstage'); eq(V.normTargets([]), null);
    const f = { text: 'x', to: ['confidence'] };
    ok(V.flashFor(f, 'confidence')); ok(!V.flashFor(f, 'backstage')); ok(!V.flashFor(f, 'manager'));
    ok(V.flashFor({ text: 'x' }, 'backstage'), 'sin destino = todas'); ok(!V.flashFor(null, 'manager'));
    eq(V.targetsTxt(['confidence', 'backstage']), 'Confidence · Backstage'); eq(V.targetsTxt(null), 'Todas las pantallas');
  });

  test('mensajes por zona: solo las Confidence de las zonas elegidas (las demás pantallas, como siempre)', () => {
    const f = { text: 'ÚLTIMO TEMA', to: ['confidence', 'manager'], zones: ['esc1'] };
    ok(V.flashFor(f, 'confidence', 'esc1')); ok(!V.flashFor(f, 'confidence', 'esc2')); ok(!V.flashFor(f, 'confidence', null), 'Confidence sin zona elegida: no');
    ok(V.flashFor(f, 'manager', null), 'Manager no tiene zona: lo ve'); ok(!V.flashFor(f, 'backstage'));
    ok(V.flashFor({ text: 'x', zones: null }, 'confidence', 'esc2'), 'sin zonas = todas');
    eq(V.normZones(['a', 'a', 'b']).join(), 'a,b'); eq(V.normZones([]), null); eq(V.normZones('a'), null);
    const nm = id => ({ esc1: 'Principal', esc2: 'Carpa' })[id];
    eq(V.targetsTxt(['confidence'], ['esc1', 'esc2'], nm), 'Confidence (Principal, Carpa)');
    eq(V.targetsTxt(null, ['esc1'], nm), 'Todas las pantallas · Confidence: Principal');
  });

  // ── Semáforo y reloj ──────────────────────────────────────────────────
  test('semáforo: verde, ámbar, rojo y sobretiempo', () => {
    eq(V.level(11 * 60, 10, 5), 'ok'); eq(V.level(10 * 60, 10, 5), 'warn'); eq(V.level(5 * 60, 10, 5), 'danger');
    eq(V.level(1, 10, 5), 'danger'); eq(V.level(-1, 10, 5), 'over'); eq(V.level(0, 10, 5), 'danger');
  });

  test('cuenta atrás: MM:SS, horas, negativo y 00:00 justo al final', () => {
    eq(V.fmtClock(590), '09:50'); eq(V.fmtClock(0.2), '00:00', 'redondeo al segundo más cercano'); eq(V.fmtClock(0), '00:00');
    eq(V.fmtClock(5.00000000022), '00:05', 'flotantes: no se cuela un segundo de más'); eq(V.fmtClock(null), '--:--'); eq(V.fmtClock(NaN), '--:--');
    eq(V.fmtClock(-135), '+02:15', 'sobretiempo: +'); eq(V.fmtClock(-0.4), '+00:00'); eq(V.fmtClock(3700), '1:01:40');
  });

  // ── Confidence ────────────────────────────────────────────────────────
  test('Confidence: con dos zonas y sin elegir, pide zona (no adivina)', () => {
    const F = fest();
    const r = V.confidence(F.s, null, at('21:10'));
    eq(r.mode, 'pickzone'); eq(r.zones.map(z => z.name).join(), 'Principal,Carpa');
  });

  test('Confidence: show según horario, cuenta atrás y semáforo', () => {
    const F = fest();
    let r = V.confidence(F.s, F.P, at('20:45'));
    eq(r.mode, 'show'); eq(r.band.name, 'Banda A'); eq(r.zone, 'Principal');
    eq(V.fmtClock(r.remSec), '45:00'); eq(r.level, 'ok'); eq(r.totalSec, 3600); eq(Math.round(r.frac * 100), 75);
    eq(V.confidence(F.s, F.P, at('21:22')).level, 'warn');
    eq(V.confidence(F.s, F.P, atS('21:26', 30)).level, 'danger');
    r = V.confidence(F.s, F.K, at('21:30'));
    eq(r.band.name, 'Acústico', 'la otra zona va aparte');
  });

  test('Confidence: con ALARGAR (sin ▶) sigue en el show pasada su hora y cuenta sobretiempo en rojo; sin Alargar pasa al cambio', () => {
    const F = fest();
    const st = C.setAlargar(F.s, F.ids['Banda A'], 'show', true).state;
    let r = V.confidence(st, F.P, at('21:35'));
    eq(r.mode, 'show'); eq(r.band.name, 'Banda A'); eq(r.level, 'over'); eq(V.fmtClock(r.remSec), '+05:00');
    eq(V.confidence(F.s, F.P, at('21:35')).mode, 'changeover', 'sin Alargar: pasivo, acabó a su hora');
    r = V.confidence(C.setReal(st, F.ids['Banda A'], 'show', 'f', at('21:40')).state, F.P, at('21:41'));
    eq(r.mode, 'changeover'); eq(C.fmtHM(r.next.si), '22:00', '+10 cabe en el colchón');
  });

  test('Confidence: con ▶ y sin ■ pero sin Alargar, se para a su hora (pasa al cambio)', () => {
    const F = fest();
    const s = M.realPlan(F.s, {}, key(F.s, 'Banda A'), 'i', at('20:30')).state;
    eq(V.confidence(s, F.P, atS('21:32', 15)).mode, 'changeover');
  });

  test('Confidence: con Alargar y sin ■, sobretiempo en negativo y parpadeo', () => {
    const F = fest();
    const s = M.realPlan(M.stretchPlan(F.s, key(F.s, 'Banda A'), true, at('20:00')).state, {}, key(F.s, 'Banda A'), 'i', at('20:30')).state;
    const r = V.confidence(s, F.P, atS('21:32', 15));
    eq(r.mode, 'show'); eq(V.fmtClock(r.remSec), '+02:15'); eq(r.level, 'over'); eq(r.blink, true); eq(r.frac, 0);
    eq(V.confidence(s, F.P, atS('21:32', 15), { conf: { blink: false } }).blink, false, 'parpadeo apagado en Configuración');
  });

  test('Confidence: changeover con cuenta atrás hasta el siguiente y su semáforo', () => {
    const F = fest();
    let r = V.confidence(F.s, F.P, at('21:40'));
    eq(r.mode, 'changeover'); eq(r.next.name, 'Banda B'); eq(V.fmtClock(r.remSec), '20:00'); eq(r.totalSec, 30 * 60); eq(r.level, 'ok');
    eq(V.confidence(F.s, F.P, at('21:56')).level, 'warn'); eq(V.confidence(F.s, F.P, atS('21:59', 30)).level, 'danger');
    // ■ antes de tiempo: el changeover se cuenta desde el fin real
    const k = key(F.s, 'Banda A');
    let s = M.realPlan(F.s, {}, k, 'i', at('20:30')).state; s = M.realPlan(s, {}, k, 'f', at('21:20')).state;
    r = V.confidence(s, F.P, at('21:25'));
    eq(r.mode, 'changeover'); eq(r.totalSec, 40 * 60, 'de 21:20 a 22:00');
  });

  test('Confidence (decisión 76): tarea de la zona en el hueco = EN ESPERA; hito no rompe; STANDBY manda', () => {
    let F = fest();
    let s = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Montaje', tipo: 'tarea', escenarioId: F.P, inicio: '21:35', fin: '21:50' }).state;
    let r = V.confidence(s, F.P, at('21:40'));
    eq(r.mode, 'wait', 'tarea en curso en el hueco'); eq(r.next.name, 'Banda B'); eq(r.frac, null);
    eq(V.confidence(s, F.P, at('21:55')).mode, 'wait', 'después de la tarea sigue sin actividad');
    s = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Puertas', tipo: 'hito', escenarioId: F.P, inicio: '21:45' }).state;
    eq(V.confidence(s, F.P, at('21:40')).mode, 'changeover', 'un hito no rompe el changeover');
    s = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Montaje', tipo: 'tarea', escenarioId: F.K, inicio: '21:35', fin: '21:50' }).state;
    eq(V.confidence(s, F.P, at('21:40')).mode, 'changeover', 'la tarea de otra zona no cuenta');
    s = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Montaje', tipo: 'tarea', escenarioId: F.P, inicio: '21:35', fin: '21:50' }).state;
    s = C.setStandby(s, F.ids['Banda B'], 'show', true).state;
    r = V.confidence(s, F.P, at('21:40')); eq(r.mode, 'changeover'); ok(r.standby, 'STANDBY manual');
  });

  test('Confidence (decisión 76): soundcheck → show de la misma banda = EN ESPERA', () => {
    const F = fest();
    let s = C.editArtist(F.s, F.ids['Banda A'], 'sc', 'fecha', JOR).state;
    s = C.editArtist(s, F.ids['Banda A'], 'sc', 'inicio', '18:00').state; s = C.editArtist(s, F.ids['Banda A'], 'sc', 'fin', '18:45').state;
    const r = V.confidence(s, F.P, at('19:00'));
    eq(r.mode, 'wait'); eq(r.next.name, 'Banda A');
  });

  test('Confidence: antes de la primera banda (espera) y fin de jornada', () => {
    const F = fest();
    const w = V.confidence(F.s, F.P, at('19:00')); eq(w.mode, 'wait'); eq(w.next.name, 'Banda A'); eq(w.frac, null);
    eq(V.confidence(F.s, F.P, at('23:10')).mode, 'end');
    eq(V.confidence(null, F.P, at('20:00')).mode, 'nofest');
  });

  test('Confidence: con una sola zona con bandas, va directa', () => {
    let s = C.newFestival({ nombre: 'Uno', fechaInicio: JOR, fechaFin: JOR, dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'Única').state;
    s = C.addArtist(s, 'show', { jornada: JOR, nombre: 'Solo', escenarioId: s.escenarios[0].id, inicio: '20:00', fin: '21:00' }).state;
    const r = V.confidence(s, null, at('20:10')); eq(r.mode, 'show'); eq(r.band.name, 'Solo');
  });

  // ── Cinta de avisos ───────────────────────────────────────────────────
  test('cinta: en hora, hitos (solo nombre y hora) y retraso por zona', () => {
    const F = fest();
    let it = V.tickerItems(F.s, null, at('20:00'));
    eq(it[0].text, 'EN HORA · SIN INCIDENCIAS'); ok(it.some(x => x.kind === 'hito' && x.text === 'CURFEW 23:30'), 'el hito con su hora, sin margen: ' + JSON.stringify(it));
    const s = M.delayPlan(F.s, {}, { minutes: 20, zones: [F.P], from: at('20:00') }).state;
    it = V.tickerItems(s, null, at('20:00'));
    ok(it.some(x => x.kind === 'delay' && x.text === 'PRINCIPAL · RETRASO +20 MIN' && x.level === 'warn'), JSON.stringify(it));
    ok(it.every(x => !/MARGEN|REBASADO/.test(x.text)), 'la cinta nunca enseña márgenes');
  });

  test('cinta: los avisos llevan su origen ([PRODUCCIÓN] / [ZONA]); sin origen, solo el texto (dec. 106)', () => {
    const F = fest(), off = { ticker: { delays: false, hitos: false } };
    const it = V.tickerItems(F.s, off, at('20:00'), null, [{ text: 'Catering abierto', by: { k: 'prod' } }, { text: 'Foso libre', by: { k: 'zone', n: 'Carpa' } }, { text: 'Sin etiqueta' }]);
    eq(it.map(x => x.text).join(' | '), '[PRODUCCIÓN] CATERING ABIERTO | [CARPA] FOSO LIBRE | SIN ETIQUETA');
    eq(V.byLabel({ k: 'prod' }), '[Producción]'); eq(V.byLabel(null), ''); eq(V.byLabel({ k: 'zone', n: 'Escenario 2' }), '[Escenario 2]');
  });
  test('cinta: categorías apagadas y el tiempo cuando lo haya', () => {
    const F = fest();
    eq(V.tickerItems(F.s, { ticker: { delays: false, hitos: false } }, at('20:00')).length, 0);
    const it = V.tickerItems(F.s, { ticker: { delays: false, hitos: false } }, at('20:00'), { text: 'Despejado · 24°C' });
    eq(it.length, 1); eq(it[0].text, 'DESPEJADO · 24°C');
    eq(V.tickerItems(F.s, { ticker: { delays: false, hitos: false, meteo: false } }, at('20:00'), { text: 'x' }).length, 0);
  });

  test('Backstage: el CALL sigue visible hasta que arranca el show, marcado si ya se avisó', () => {
    const F = fest(), b = C.buildBlocks(F.s, { mode: 'all', day: 'all' });
    let c = V.backstageCalls(b, at('20:10'), 15, []);
    eq(c.length, 1); eq(c[0].block.name, 'Banda A'); eq(c[0].done, false);
    c = V.backstageCalls(b, at('20:10'), 15, [C.callKey(c[0].block)]);
    eq(c.length, 1, 'con OK sigue'); eq(c[0].done, true);
    eq(V.backstageCalls(b, at('20:31'), 15, []).length, 0, 'empezado: fuera');
  });

  // ── Enlaces y monitor ─────────────────────────────────────────────────
  test('enlaces de vista: con zona solo en Confidence; se leen de vuelta', () => {
    eq(V.liveUrl('https://x/', 'confidence', 'esc1', '#sala=1'), 'https://x/live.html?vista=confidence&zona=esc1#sala=1');
    eq(V.liveUrl('', 'backstage', 'esc1'), 'live.html?vista=backstage');
    eq(V.liveUrl('', 'confidence', ''), 'live.html?vista=confidence&zona=', 'sin zona = la de las entradas sin zona');
    const p = V.parseLive('?vista=confidence&zona=esc%201'); eq(p.vista, 'confidence'); eq(p.zona, 'esc 1');
    eq(V.parseLive('').vista, 'manager'); eq(V.parseLive('').zona, null);
  });

  test('monitor: elige el externo (HDMI), no el del Dashboard; null si solo hay uno', () => {
    const lap = { left: 0, top: 0, width: 1512, height: 982, isPrimary: true, isInternal: true };
    const tv = { left: 1512, top: 0, width: 1920, height: 1080, isPrimary: false, isInternal: false };
    const ipad = { left: -1024, top: 0, width: 1024, height: 768, isPrimary: false, isInternal: true };
    eq(V.pickScreen([lap, tv], lap), tv); eq(V.pickScreen([lap, ipad, tv], lap), tv);
    eq(V.pickScreen([lap], lap), null); eq(V.pickScreen([tv, lap], tv), lap, 'Dashboard en la tele: abre en el portátil');
  });

  test('Cinta: los avisos escritos a mano van delante, en ámbar y en mayúsculas', () => {
    const it = V.tickerItems(null, null, 0, null, [{ id: 'a', text: 'Lluvia en 10 min' }, { id: 'b', text: 'Prohibido fumar' }]);
    eq(it.length, 2, 'salen aunque no haya festival'); eq(it[0].kind, 'aviso'); eq(it[0].level, 'warn'); eq(it[0].text, 'LLUVIA EN 10 MIN'); eq(it[1].text, 'PROHIBIDO FUMAR');
    eq(V.tickerItems(null, null, 0, null).length, 0, 'sin avisos: nada');
    eq(V.tickerItems(null, null, 0, null, [{ id: 'c', text: '' }, null]).length, 0, 'avisos vacíos no salen');
  });

  test('Producción: solo ve Manager y Backstage (sin Confidence)', () => {
    eq(V.normProdVista('confidence'), 'manager'); eq(V.normProdVista('backstage'), 'backstage'); eq(V.normProdVista('rara'), 'manager'); eq(V.normProdVista(null), 'manager');
    eq(V.nextProdVista('manager'), 'backstage'); eq(V.nextProdVista('backstage'), 'manager'); eq(V.nextProdVista('confidence'), 'backstage');
  });

  test('Pasada la hora de corte, Confidence y la cinta siguen con la banda que suena', () => {
    const F = fest();
    let r = C.addArtist(F.s, 'show', { jornada: JOR, nombre: 'Última', escenarioId: F.P, inicio: '04:30', fin: '05:30' });
    const s = C.setReal(C.setAlargar(r.state, r.id, 'show', true).state, r.id, 'show', 'i', C.toAbs('2026-07-11', '05:15')).state;   // con Tiempo extra, sin ■
    const now = C.toAbs('2026-07-11', '06:10');
    const cf = V.confidence(s, F.P, now, null);
    eq(cf.mode, 'show', 'no «EN ESPERA» para mañana: ' + cf.mode);
    const sin = fest(); eq(V.confidence(sin.s, sin.P, now, null).mode === 'show', false, 'sin nada sonando, no');
  });

  test('Sobretiempo: fondo y números configurables (por defecto negro y rojo); valores no válidos vuelven al defecto', () => {
    const d = V.normScreens();
    eq(d.conf.overBg, '#000000'); eq(d.conf.overNum, '#ff3b30');
    const x = V.normScreens({ conf: { overBg: '#5A0000', overNum: 'rojo' } });
    eq(x.conf.overBg, '#5a0000'); eq(x.conf.overNum, '#ff3b30', 'texto no válido: defecto');
  });
  test('Parpadeo del sobretiempo: libre entre 0,1 y 5 s; por defecto 1 s', () => {
    eq(V.normScreens().conf.blinkSpeed, 1);
    eq(V.normScreens({ conf: { blinkSpeed: 2 } }).conf.blinkSpeed, 2);
    eq(V.normScreens({ conf: { blinkSpeed: '0.5' } }).conf.blinkSpeed, 0.5, 'también como texto');
    eq(V.normScreens({ conf: { blinkSpeed: 9 } }).conf.blinkSpeed, 5, 'fuera de rango: tope');
    eq(V.normScreens({ conf: { blinkSpeed: 'x' } }).conf.blinkSpeed, 1, 'no es número: normal');
  });
  test('Velocidad de la cinta: libre entre 5 y 120 s; por defecto 30', () => {
    eq(V.normScreens().ticker.speed, 30, 'por defecto 30 s');
    eq(V.normScreens({ ticker: { speed: 45 } }).ticker.speed, 45);
    eq(V.normScreens({ ticker: { speed: '18' } }).ticker.speed, 18, 'también como texto');
    eq(V.normScreens({ ticker: { speed: 7.5 } }).ticker.speed, 7.5, 'valor libre con decimales');
    eq(V.normScreens({ ticker: { speed: 500 } }).ticker.speed, 120, 'fuera de rango: tope');
    eq(V.normScreens({ ticker: { speed: 'x' } }).ticker.speed, 30, 'no es número: normal');
  });
  test('Cinta de Backstage: la puesta de sol sale como aviso del tiempo (si hay dato) y la vista Confidence no lleva meteo', () => {
    const sun = { sunset: Date.UTC(2026, 6, 10, 20, 5), temp: 25, sky: 'Despejado', rain: null, wind: null, gustMax: null, stale: false };
    const st = { event: { nombre: 'x', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }, escenarios: [], artists: [] };
    const W = isNode ? require('../meteo.js') : window.ShowtimeMeteo;
    const items = V.tickerItems(st, { ticker: { delays: false, hitos: false, meteo: true } }, 0, W.tickerList(sun, []));
    ok(items.some(x => x.kind === 'meteo' && /^PUESTA DE SOL \d{2}:\d{2}$/.test(x.text)), 'la puesta sale en la cinta');
    const conf = V.tickerItems(st, { ticker: { delays: false, hitos: false, meteo: true } }, 0, null);
    ok(!conf.some(x => x.kind === 'meteo'), 'sin meteo no hay nada de tiempo (Confidence queda limpia)');
  });
  test('Cinta: la última banda de la noche tocando con retraso NO sale como «EN HORA»', () => {
    const J = '2026-07-10', at2 = (d, h) => C.toAbs(d, h);
    let s = C.newFestival({ nombre: 'x', fechaInicio: J, fechaFin: J, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state;
    s = C.addArtist(s, 'show', { jornada: J, nombre: 'Última', escenarioId: s.escenarios[0].id, inicio: '04:30', fin: '05:30' }).state;
    const d = M.delayPlan(s, {}, { minutes: 60, zones: 'all', from: at2('2026-07-11', '04:00') });
    const it = V.tickerItems(d.state, null, at2('2026-07-11', '05:50'), null).map(x => x.text);
    ok(it.indexOf('EN HORA · SIN INCIDENCIAS') < 0, 'no dice en hora: ' + JSON.stringify(it));
    ok(it.some(x => /PRINCIPAL · RETRASO \+60 MIN/.test(x)), 'dice el retraso real: ' + JSON.stringify(it));
    ok(V.tickerItems(s, null, at2('2026-07-11', '04:50'), null).some(x => x.text === 'EN HORA · SIN INCIDENCIAS'), 'sin retraso, sí está en hora');
  });

  // ── Ejecutar ──────────────────────────────────────────────────────────
  let pass = 0; const fails = [];
  tests.forEach(([n, f]) => { try { f(); pass++; } catch (e) { fails.push([n, e.message]); } });
  const summary = 'Vistas: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
  if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); if (fails.length) process.exitCode = 1; }
  else {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const box = document.createElement('div');
    box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
    document.getElementById('out').appendChild(box);
    window.__TEST_VISTAS__ = { pass, total: tests.length, fails };
  }
})();
