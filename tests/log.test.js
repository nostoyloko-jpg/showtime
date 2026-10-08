/* Tests del Event Log (log.js) — sin dependencias.
 * Ordenador:  node tests/log.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('../core.js') : window.ShowtimeCore;
  const M = isNode ? require('../mando.js') : window.ShowtimeMando;
  const L = isNode ? require('../log.js') : window.ShowtimeLog;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  const JOR = '2026-07-10', JOR2 = '2026-07-11';
  const at = hm => C.toAbs(hm < '06:00' ? JOR2 : JOR, hm);
  function fest() {
    let s = C.newFestival({ nombre: 'Prueba log', fechaInicio: JOR, fechaFin: JOR2, dayCutoff: '06:00', coMin: 15 }).state;
    s = C.addStage(s, 'Principal').state; s = C.addStage(s, 'Carpa').state;
    const P = s.escenarios[0].id, K = s.escenarios[1].id, ids = {};
    const add = (n, d) => { const r = C.addArtist(s, d.modo || 'show', Object.assign({ jornada: JOR, nombre: n }, d)); if (!r.ok) throw new Error(n + ': ' + r.error); s = r.state; ids[n] = r.id; };
    add('Prueba A', { modo: 'sc', escenarioId: P, inicio: '17:00', fin: '17:45' });
    add('Banda A', { escenarioId: P, inicio: '20:30', fin: '21:30' });
    add('Banda B', { escenarioId: P, inicio: '22:00', fin: '23:00' });
    add('Acústico', { escenarioId: K, inicio: '21:00', fin: '22:00' });
    add('Comida', { tipo: 'tarea', inicio: '14:00', fin: '15:00' });
    add('Curfew', { tipo: 'hito', inicio: '01:30' });
    return { s, P, K, ids };
  }
  const key = (s, name) => C.buildBlocks(s, { mode: 'all', day: 'all' }).find(b => b.name === name).key;
  const CFG = { delayBlock: { all: {} } };
  /** Simula el Dashboard: cada cambio pasa por L.commit con la hora y el origen. */
  function rig() {
    const F = fest();
    let log = L.empty(F.s), s = F.s;
    const go = (next, t, ctx) => { log = L.commit(log, s, next, Object.assign({ t: typeof t === 'number' ? t : at(t), src: 'panel' }, ctx || {})); s = next; };
    return { F, get s() { return s; }, get log() { return log; }, set log(v) { log = v; }, go };
  }

  // ── Foto del horario ──────────────────────────────────────────────────
  test('foto: una por jornada, con el horario de ANTES del primer cambio, y no se rehace', () => {
    const R = rig();
    R.log = L.ensureFoto(R.log, R.s, at('12:00'));
    const f = R.log.fotos[JOR]; ok(f, 'hay foto'); eq(f.at, at('12:00'));
    eq(f.items.length, 6, 'todo lo de la jornada con hora');
    const r = C.editArtist(R.s, R.F.ids['Banda A'], 'show', 'inicio', '20:45');
    R.go(r.state, '13:00');
    eq(R.log.fotos[JOR].at, at('12:00'), 'la foto no cambia');
    eq(R.log.fotos[JOR].items.find(i => i.name === 'Banda A').psi, at('20:30'), 'la foto guarda lo previsto');
  });

  test('foto: si el primer cambio llega antes que el reloj, la foto es del estado anterior', () => {
    const R = rig();
    const r = C.editArtist(R.s, R.F.ids['Banda A'], 'show', 'nombre', 'Banda Z');
    R.go(r.state, '12:00');
    eq(R.log.fotos[JOR].items.find(i => i.key === key(R.s, 'Banda Z')).name, 'Banda A');
  });

  // ── Qué se graba ──────────────────────────────────────────────────────
  test('■ pasivo: una sola entrada, ámbar, «acaba 20 min antes», con el origen', () => {
    const R = rig();
    const r = M.realPlan(R.s, CFG, key(R.s, 'Banda A'), 'f', at('21:10'));
    R.go(r.state, '21:10', { src: 'mando', noTimes: true });
    eq(R.log.entries.length, 1);
    const e = R.log.entries[0];
    eq(e.type, 'real'); eq(e.src, 'mando'); ok(e.amber); eq(e.t, at('21:10'));
    ok(/■ Show «Banda A» termina 21:10 \(inicio en hora, 20:30\) · acaba 20 min antes/.test(e.text), e.text);
    eq(e.jors.join(), JOR);
  });

  test('▶ tarde = ámbar; ▶ en hora = no ámbar', () => {
    const R = rig();
    R.go(M.realPlan(R.s, CFG, key(R.s, 'Banda A'), 'i', at('20:34')).state, '20:34', { noTimes: true });
    ok(R.log.entries[0].amber); ok(/empieza 20:34 · \+4 min/.test(R.log.entries[0].text), R.log.entries[0].text);
    R.go(M.realPlan(R.s, CFG, key(R.s, 'Acústico'), 'i', at('21:00')).state, '21:00', { noTimes: true });
    ok(!R.log.entries[1].amber); ok(/en hora/.test(R.log.entries[1].text));
  });

  test('retraso: una entrada con la orden, sin una línea por cada entrada movida', () => {
    const R = rig();
    const sh = C.addRetraso(R.s, { minutes: 10, zone: 'all', blocked: {}, fromAbs: at('19:00'), day: JOR, at: at('19:00') });
    ok(sh.moved.length >= 3);
    R.go(sh.state, '19:00', { noTimes: true, ev: [{ type: 'delay', text: 'Retraso +10 min (todas las zonas)', jors: [JOR], amber: true }] });
    eq(R.log.entries.length, 1); eq(R.log.entries[0].type, 'delay');
  });

  test('altas, borrados, renombrar y cambio de tipo; LED y STANDBY no se graban', () => {
    const R = rig();
    R.go(C.editArtist(R.s, R.F.ids['Banda B'], 'show', 'nombre', 'Banda Beta').state, '15:00');
    ok(/^«Banda B»: nombre «Banda B» → «Banda Beta»$/.test(R.log.entries[0].text), R.log.entries[0].text);
    R.go(C.removeArtist(R.s, R.F.ids['Acústico']).state, '15:01');
    eq(R.log.entries[1].type, 'del'); ok(/^Show «Acústico» · 21:00–22:00 · Carpa$/.test(R.log.entries[1].text), R.log.entries[1].text);
    R.go(C.addArtist(R.s, 'show', { jornada: JOR, nombre: 'Sorpresa', escenarioId: R.F.K, inicio: '21:10', fin: '21:40' }).state, '15:02');
    eq(R.log.entries[2].type, 'add'); ok(/^Show «Sorpresa» · 21:10–21:40 · Carpa$/.test(R.log.entries[2].text), R.log.entries[2].text);
    R.go(C.editArtist(R.s, R.F.ids['Comida'], 'show', 'tipo', 'hito').state, '15:03');
    eq(R.log.entries[3].type, 'edit'); ok(/tipo tarea → marcador/.test(R.log.entries[3].text), R.log.entries[3].text);
    const n = R.log.entries.length;
    R.go(C.setFija(R.s, R.F.ids['Banda A'], true).state, '15:04');
    R.go(C.setStandby(R.s, R.F.ids['Banda A'], 'show', true).state, '15:05');
    eq(R.log.entries.length, n, 'LED y STANDBY: nada');
  });

  test('nunca quita: Deshacer añade «Deshecho», y lo raro de un archivo se descarta', () => {
    const R = rig();
    R.go(C.removeArtist(R.s, R.F.ids['Acústico']).state, '15:00');
    R.log = L.record(R.log, [{ type: 'undo', text: 'Borrada: Acústico' }], { t: at('15:01'), src: 'panel' }, R.s);
    eq(R.log.entries.length, 2); eq(R.log.entries[1].jors.join(), JOR, 'sin jornada: la de su hora');
    ok(R.log.entries[1].n > R.log.entries[0].n);
    const back = L.norm(JSON.parse(JSON.stringify(Object.assign({}, R.log, { entries: R.log.entries.concat([{ t: 'x' }, null, { t: 1, text: 'a', type: 'hack' }]) }))));
    eq(back.entries.length, 2); eq(L.norm({ nada: 1 }), null);
  });

  test('retraso manual en el informe: previsto intacto, «Real / final» con el estimado y la orden a su hora', () => {
    const R = rig();
    R.log = L.ensureFoto(R.log, R.s, at('06:30'));
    const sh = C.addRetraso(R.s, { minutes: 10, zone: 'all', blocked: {}, fromAbs: at('19:00'), day: JOR, at: at('19:00') });
    R.go(sh.state, '19:00', { noTimes: true, ev: [{ type: 'delay', text: 'Retraso +10 min', jors: [JOR], amber: true }] });
    const s = L.report(R.log, R.s, { day: JOR }).sections[0];
    const b = s.rows.find(r => r.name === 'Banda B');
    eq(b.plan[0], at('22:00')); eq(b.fin[0], at('22:10')); ok(b.chg[0]);
    ok(/movida \+10 min/.test(L.toTxt(L.report(R.log, R.s, { day: JOR }))));
  });

  // ── Informe ───────────────────────────────────────────────────────────
  function day() {
    const R = rig();
    R.log = L.ensureFoto(R.log, R.s, at('06:30'));
    // Antes de la foto no hay nada; después: renombre, borrado, alta, ■ pasivo, retraso, mensaje
    R.go(C.editArtist(R.s, R.F.ids['Banda B'], 'show', 'nombre', 'Banda Beta').state, '16:00');
    R.go(C.removeArtist(R.s, R.F.ids['Acústico']).state, '16:05');
    R.go(C.addArtist(R.s, 'show', { jornada: JOR, nombre: 'Sorpresa', escenarioId: R.F.K, inicio: '21:10', fin: '21:40' }).state, '16:10');
    R.go(M.realPlan(R.s, CFG, key(R.s, 'Banda A'), 'f', at('21:10')).state, '21:10', { noTimes: true });
    R.log = L.record(R.log, [{ type: 'msg', text: '«ÚLTIMO TEMA» → Confidence' }], { t: at('21:05'), src: 'mando' }, R.s);
    return R;
  }

  test('informe: horario previsto + incidencias a su hora; borrada una vez y tachada; alta; renombre', () => {
    const R = day();
    const rep = L.report(R.log, R.s, { day: JOR, nowMs: Date.UTC(2026, 6, 10, 23) });
    eq(rep.sections.length, 1);
    const s = rep.sections[0]; ok(s.foto); eq(s.fotoAt, at('06:30'));
    const sched = s.rows.filter(r => r.r === 'sched');
    const ac = sched.filter(r => r.name === 'Acústico');
    eq(ac.length, 1, 'la borrada sale una vez'); eq(ac[0].status, 'deleted'); eq(ac[0].when, at('16:05')); eq(ac[0].t, at('21:00'), 'a su hora prevista');
    const so = sched.find(r => r.name === 'Sorpresa'); eq(so.status, 'added'); eq(so.when, at('16:10'));
    const bb = sched.find(r => r.name === 'Banda B'); eq(bb.newName, 'Banda Beta');
    const ba = sched.find(r => r.name === 'Banda A'); eq(ba.fin[1], at('21:10')); ok(ba.chg[1] && !ba.chg[0], 'solo el fin cambia');
    // Orden: estricto por hora; a igual hora, el horario antes que la incidencia
    const ts = s.rows.map(r => r.t); ok(ts.every((t, i) => !i || t >= ts[i - 1]), 'en orden');
    const i21 = s.rows.findIndex(r => r.r === 'inc' && r.type === 'msg');
    ok(s.rows[i21 - 1].t <= at('21:05'));
    eq(s.stats.del, 1); eq(s.stats.add, 1); eq(s.stats.chg, 1); eq(s.stats.inc, 5);
  });

  test('informe: lo cambiado ANTES de la foto ya es lo previsto (no es incidencia)', () => {
    const R = rig();
    R.go(C.editArtist(R.s, R.F.ids['Banda A'], 'show', 'inicio', '20:40').state, C.toAbs('2026-07-09', '23:00'));    // la víspera (jornada 9)
    R.log = L.ensureFoto(R.log, R.s, at('06:30'));
    const s = L.report(R.log, R.s, { day: JOR }).sections[0];
    eq(s.rows.filter(r => r.r === 'inc').length, 0);
    eq(s.rows.find(r => r.name === 'Banda A').plan[0], at('20:40'));
  });

  test('informe: filtros por tipo e incidencias; «Todo el evento» salta jornadas vacías', () => {
    const R = day();
    const only = L.report(R.log, R.s, { day: JOR, cats: { show: true, sc: false, tarea: false, hito: false, inc: false } }).sections[0];
    ok(only.rows.every(r => r.r === 'sched' && r.k === 'show'));
    const inc = L.report(R.log, R.s, { day: JOR, cats: { show: false, sc: false, tarea: false, hito: false, inc: true } }).sections[0];
    ok(inc.rows.length && inc.rows.every(r => r.r === 'inc'));
    const all = L.report(R.log, R.s, { day: 'all' });
    ok(all.sections.every(x => x.rows.length), 'sin secciones vacías');
    eq(all.sections[0].jornada, JOR);
  });

  test('sin foto: previsto = horario actual, y se dice', () => {
    const R = rig();
    const s = L.report(R.log, R.s, { day: JOR }).sections[0];
    ok(!s.foto); ok(/el horario actual/.test(L.toTxt(L.report(R.log, R.s, { day: JOR }))));
    eq(s.rows.filter(r => r.r === 'sched').length, 6);
  });

  test('formatos: TXT con >> y *, CSV para Excel (BOM y «;»), HTML escapado', () => {
    const R = day();
    R.log = L.record(R.log, [{ type: 'msg', text: '<script>alert(1)</script>; "a"' }], { t: at('21:20'), src: 'panel' }, R.s);
    const rep = L.report(R.log, R.s, { day: JOR });
    const txt = L.toTxt(rep);
    ok(/>> MENSAJE: «ÚLTIMO TEMA» → Confidence \(Mando del Stage Manager\)/.test(txt), 'incidencia en TXT');
    ok(/21:10\*/.test(txt), 'fin cambiado marcado con *');
    ok(/BORRADA 16:05/.test(txt));
    const csv = L.toCsv(rep);
    eq(csv.charCodeAt(0), 0xfeff, 'BOM'); ok(/^﻿Jornada;Hora;Fila;/.test(csv));
    ok(csv.indexOf('"<script>alert(1)</script>; ""a"""') > 0, 'comillas y «;» bien escapados');
    const html = L.toHtml(rep);
    ok(html.indexOf('<script>alert') < 0, 'HTML escapado'); ok(/BORRADA 16:05/.test(html)); ok(/@page/.test(html));
  });

  // ── Idioma: el informe en el idioma del Panel; los apuntes se guardan en español; lo escrito por la gente, intacto ──
  const I18 = () => (isNode ? require('../i18n.js') : window.ShowtimeI18n);
  function bothLangs(fn) {
    const I = I18(); if (!I) return;
    const R = day();
    R.log = L.record(R.log, [{ type: 'call', key: key(R.s, 'Banda A'), text: 'CALL OK · Banda A · Stage Manager (mando)' },
      { type: 'meteo', amber: true, text: 'Aviso (previsión): Viento medio 45 km/h ahora · umbral 40' },
      { type: 'real', text: 'Reconciliación: Zona Principal vuelve a EN HORA (absorbidos +10 min en changeover) · Banda A 20:30 · Stage Manager' },
      { type: 'buffer', key: key(R.s, 'Banda A'), text: 'BIS · Banda A: Tiempo extra tardío a las 21:40 (+5 min desde su fin, 21:35). Vuelve a estar en escena; gasta el colchón y, pasado, retrasa lo que viene de su zona hasta ■' },
      { type: 'delay', text: 'Retraso +15 min (Principal, desde 21:00): 1 entrada movida' }], { t: at('21:20'), src: 'panel' }, R.s);
    const rep = L.report(R.log, R.s, { day: JOR });
    try { I.setLang('en'); fn.en(L.toTxt(rep), L.toCsv(rep), L.toHtml(rep), R); } finally { I.setLang('es'); }
    fn.es(L.toTxt(rep), L.toCsv(rep), L.toHtml(rep), R);
  }
  test('idioma: TXT en inglés (título, columnas, tipos y sucesos) y en español como siempre', () => bothLangs({
    en: (txt, csv, html, R) => {
      ok(/^SHOWTIME · EVENT LOG · DAILY REPORT/.test(txt), 'título');
      ok(/TIME\s+TYPE\s+EVENT \/ ACTION · STAGE\s+PLANNED\s+ACTUAL\s+STATUS \/ USER/.test(txt), 'columnas');
      ok(/>> MESSAGE: “ÚLTIMO TEMA” → Confidence \(Stage Remote\)/.test(txt), 'el texto del mensaje no se toca');
      ok(/>> CALL CONFIRMED: CALL confirmed · Banda A · Stage Manager \(Stage Remote\) · Principal \(Dashboard\)/.test(txt), 'CALL confirmado + escenario + usuario');
      ok(/>> WEATHER ALERT: Weather alert \(forecast\): Mean wind 45 km\/h now · threshold 40/.test(txt), 'alerta meteo');
      ok(/>> RECONCILIATION: Reconciliation: Stage Principal back to ON TIME \(\+10 min absorbed in changeover\)/.test(txt), 'reconciliación');
      ok(/>> ENCORE: ENCORE · Banda A: late Extra time at 21:40/.test(txt), 'bis');
      ok(/>> DELAY: Manual delay: \+15 min on Principal \(from 21:00\): 1 entry moved/.test(txt), 'retraso manual');
      ok(/>> ACTUAL TIME: ■ Show “Banda A” ends 21:10 \(started on time, 20:30\)/.test(txt), 'fin real');
      ok(/DELETED 16:05/.test(txt) && /Summary: /.test(txt));
      ok(!/MENSAJE|BORRADA|Resumen|previstas/.test(txt), 'sin restos en español');
      ok(/^\ufeffDay;Time;Row;Type;Event \/ action;Stage;/.test(csv), 'CSV: cabecera');
      ok(/;Incident;Weather alert;Weather alert \(forecast\)/.test(csv), 'CSV: incidencia');
      ok(/<html lang="en">/.test(html) && /EVENT LOG · DAILY REPORT/.test(html) && /Event Log · Daily report/.test(html) && /\(new\)/.test(html), 'PDF: título, pie y «(new)»');
      ok(/Stage Remote/.test(html) && !/Mando del Stage Manager/.test(html), 'PDF: usuario');
      // lo guardado sigue en español
      ok(R.log.entries.every(e => !/Stage Remote|CALL confirmed/.test(e.text)), 'el log se guarda en español');
    },
    es: (txt, csv, html) => {
      ok(/^SHOWTIME · REGISTRO DE EVENTOS · INFORME DE JORNADA/.test(txt), 'título');
      ok(/HORA\s+TIPO\s+SUCESO \/ ACCIÓN · ESCENARIO\s+PREVISTO\s+REAL\s+ESTADO \/ USUARIO/.test(txt), 'columnas');
      ok(/>> MENSAJE: «ÚLTIMO TEMA» → Confidence \(Mando del Stage Manager\)/.test(txt));
      ok(/>> CALL CONFIRMADO: CALL OK · Banda A · Stage Manager \(mando\) · Principal \(Dashboard\)/.test(txt));
      ok(/>> ALERTA METEO: Aviso \(previsión\)/.test(txt) && />> RECONCILIACIÓN: Reconciliación:/.test(txt) && />> BIS: BIS · Banda A/.test(txt) && />> RETRASO: Retraso \+15 min/.test(txt));
      ok(/^\ufeffJornada;Hora;Fila;Tipo;Suceso \/ acción;Escenario;/.test(csv), 'CSV: cabecera');
      ok(/<html lang="es">/.test(html) && /Registro de eventos · Informe de jornada/.test(html) && /\(nueva\)/.test(html));
    }
  }));
  test('idioma: los sucesos de Tiempo extra y Extender prueba tienen su tipo; texto libre de la gente intacto', () => {
    const I = I18(); if (!I) return;
    const R = rig();
    R.log = L.record(R.log, [{ type: 'buffer', text: 'EXTENDER PRUEBA · Prueba A: Tiempo extra tardío a las 17:50 (+5 min desde su fin, 17:45). Vuelve a estar en escena; gasta el colchón y, pasado, retrasa lo que viene de su zona hasta ■' },
      { type: 'buffer', text: 'Banda A: TIEMPO EXTRA · puede gastar el colchón del cambio; pasado, retrasa lo que viene de su zona hasta ■' },
      { type: 'msg', text: 'Aviso puntual: «Comida en 10 min · traed hielo» · Producción (Marta)' }], { t: at('20:00'), src: 'produccion' }, R.s);
    I.setLang('en');
    try {
      const txt = L.toTxt(L.report(R.log, R.s, { day: JOR }));
      ok(/>> EXTEND SOUNDCHECK: EXTEND SOUNDCHECK · Prueba A: late Extra time at 17:50/.test(txt), 'extender prueba');
      ok(/>> EXTRA TIME: Banda A: EXTRA TIME enabled · may use the changeover buffer/.test(txt), 'tiempo extra');
      ok(/>> MESSAGE: One-off alert: “Comida en 10 min · traed hielo” · Production \(Marta\) \(Production\)/.test(txt), 'mensaje de Producción: su texto, intacto');
    } finally { I.setLang('es'); }
  });

  test('CALL OK: queda apuntado quién lo dio (Stage Manager o Producción) y sobrevive a recargar', () => {
    const R = rig();
    R.log = L.record(R.log, [{ type: 'call', text: 'CALL OK · Banda A · Stage Manager' }], { t: at('15:00'), src: 'panel' }, R.s);
    R.log = L.record(R.log, [{ type: 'call', text: 'CALL OK · Banda B · Producción (Marta)' }], { t: at('16:00'), src: 'produccion' }, R.s);
    R.log = L.record(R.log, [{ type: 'call', text: 'CALL OK · Banda C · Stage Manager (mando)' }], { t: at('17:00'), src: 'mando' }, R.s);
    const back = L.norm(JSON.parse(JSON.stringify(R.log)));   // como al recargar el Dashboard
    const calls = back.entries.filter(e => e.type === 'call');
    eq(calls.length, 3, 'las entradas de CALL no se pierden al recargar');
    eq(calls[0].src, 'panel'); eq(calls[1].src, 'produccion'); eq(calls[2].src, 'mando');
    ok(calls[1].text.indexOf('Producción (Marta)') > 0, 'el nombre de quien lo dio va en el texto');
    eq(L.SRC_TXT.produccion, 'Producción'); eq(L.TYPE_TXT.call, 'CALL confirmado');
  });

  test('noReal: la orden (En hora, corrección) pone su propio texto y no se duplica con el ▶ genérico', () => {
    const R = rig(), k = key(R.s, 'Banda A');
    const id = C.buildBlocks(R.s, { mode: 'all', day: 'all' }).find(b => b.name === 'Banda A').id;
    const next = C.setReal(R.s, id, 'show', 'i', at('20:34')).state;
    const a = L.commit(R.log, R.s, next, { t: at('20:50'), src: 'panel', noTimes: true });
    ok(a.entries.some(e => e.type === 'real' && /empieza 20:34/.test(e.text)), 'sin noReal: el ▶ genérico');
    const b = L.commit(R.log, R.s, next, { t: at('20:50'), src: 'panel', noTimes: true, noReal: true, ev: [{ type: 'real', text: 'Corrección de inicio real: «Banda A» 20:34 (antes 20:30, asumido) · Stage Manager' }] });
    const reals = b.entries.filter(e => e.type === 'real');
    eq(reals.length, 1); ok(/^Corrección de inicio real/.test(reals[0].text)); void k;
  });

  // ── Ejecutor ──────────────────────────────────────────────────────────
  let pass = 0; const fails = [];
  for (const [n, f] of tests) { try { f(); pass++; } catch (e) { fails.push([n, e.message]); } }
  const summary = 'Log: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
  if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); process.exitCode = fails.length ? 1 : 0; }
  else {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const box = document.createElement('div');
    box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
    document.getElementById('out').appendChild(box);
    window.__TEST_LOG__ = { pass, total: tests.length, fails };
  }
})();
