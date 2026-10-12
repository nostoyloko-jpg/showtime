/* Showtime Document v1 · núcleo documental (B0-impl P1, contrato B0 R4.3).
 * node --test tests/v1-document.test.js   ·   node tests/v1-document.test.js
 * Cada rechazo se prueba con un documento válido ya abierto y un almacenamiento simulado (con datos de la web anterior):
 * documento activo y almacenamiento deben quedar idénticos (§9.2, §17.18). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const D = require('../v1/document.js');
const S = require('../v1/storage.js');
const Sess = require('../v1/session.js');

const FX = n => fs.readFileSync(path.join(__dirname, 'fixtures', 'v1', n), 'utf8');
const J = n => JSON.parse(FX(n));
const txt = o => JSON.stringify(o);
const get = (o, p) => p.reduce((x, k) => x == null ? undefined : x[k], o);
const M = (s, sc, t, m) => ({ show: s, soundcheck: sc, task: t, marker: m });

/** Generador determinista para las pruebas (en la app: crypto.getRandomValues). */
function seqRand(seed) { let x = seed || 1; return n => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; u[i] = x >>> 24; } return u; }; }

/** Almacenamiento simulado con datos de la web anterior y registro de cada acceso. */
const V71 = { 'showtime.festival': '{"event":{"nombre":"Viejo"},"artists":[],"escenarios":[]}', 'showtime.config': '{"lang":"es"}', 'showtime.callDone': '["x"]', 'showtime.log': '{"entries":[]}', 'otra.app': '1' };
class SpyStorage {
  constructor(init) { this.m = new Map(Object.entries(init || {})); this.touched = []; }
  getItem(k) { this.touched.push('get ' + k); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.touched.push('set ' + k); this.m.set(k, String(v)); }
  removeItem(k) { this.touched.push('remove ' + k); this.m.delete(k); }
  key(i) { this.touched.push('key ' + i); return Array.from(this.m.keys())[i] || null; }
  get length() { this.touched.push('length'); return this.m.size; }
  snapshot() { return JSON.stringify(Array.from(this.m.entries()).sort()); }
}
function openedSession(fixture) {
  const store = new SpyStorage(V71), s = Sess.createSession(store, seqRand(7));
  const r = s.open(FX(fixture || 'v1-basic.showtime'));
  assert.ok(r.ok, r.message);
  return { s, store };
}
/** Abre `text` sobre un documento válido abierto: debe rechazarse sin cambiar nada. */
function rejectsIntact(text, kind, re) {
  const { s, store } = openedSession();
  const before = { doc: txt(s.doc), store: store.snapshot() };
  const r = s.open(text);
  assert.equal(r.ok, false, 'debía rechazarse');
  if (kind) assert.equal(r.kind, kind, r.message);
  if (re) assert.match(r.message, re);
  assert.equal(txt(s.doc), before.doc, 'el documento abierto no cambia');
  assert.equal(store.snapshot(), before.store, 'el almacenamiento no cambia');
  return r;
}
const mutate = (fixture, fn) => { const o = J(fixture); fn(o); return txt(o); };
const invalid = (fixture, fn, re) => rejectsIntact(mutate(fixture, fn), 'invalid', re);

// ── 1 ───────────────────────────────────────────────────────────────────
test('1 · v1-basic: crear → validar → guardar → abrir sin pérdida; descarga .showtime con su MIME', () => {
  const store = new SpyStorage(V71), s = Sess.createSession(store, seqRand(3));
  const c = s.create({ name: '  Festival Sur  ', startDate: '2027-08-01', endDate: '2027-08-03', timeZone: 'Atlantic/Canary' });
  assert.ok(c.ok, c.message);
  assert.equal(s.doc.festival.project.event.name, 'Festival Sur', 'texto recortado');
  assert.match(s.doc.festivalId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v4 en minúsculas');
  assert.deepEqual(s.doc.eventLog, { logVersion: 1, snapshots: [], entries: [], nextSequence: 1 });
  const out = s.save();
  assert.ok(out.ok); assert.equal(out.mime, 'application/vnd.showtime+json'); assert.equal(out.fileName, 'Festival-Sur.showtime');
  const s2 = Sess.createSession(new SpyStorage(), seqRand(9)), r = s2.open(out.text);
  assert.ok(r.ok, r.message); assert.deepEqual(s2.doc, s.doc, 'abrir lo guardado devuelve lo mismo');
  // El fixture básico: colores en minúsculas y guardar/abrir estable
  const b = D.parseDocument(FX('v1-basic.showtime'));
  assert.ok(b.ok, b.message);
  assert.equal(b.doc.festival.project.stages[0].color, '#38bdf8');
  const again = D.parseDocument(D.serializeDocument(b.doc).text);
  assert.deepEqual(again.doc, b.doc);
  assert.equal(D.serializeDocument(again.doc).text, D.serializeDocument(b.doc).text, 'normalizar dos veces no cambia nada');
  // Crear con datos no válidos: no se crea nada
  const bad = s.create({ name: 'X', startDate: '2027-08-01', endDate: '2027-07-01', timeZone: 'Europe/Madrid' });
  assert.equal(bad.ok, false); assert.equal(s.doc.festival.project.event.name, 'Festival Sur');
  assert.equal(s.create({ name: '', startDate: '2027-08-01', timeZone: 'Europe/Madrid' }).ok, false);
  assert.equal(s.create({ name: 'X', startDate: '2027-08-01', timeZone: 'Hora/Local' }).ok, false);
  assert.equal(s.create({ name: 'X', startDate: '2027-01-01', endDate: '2027-05-01', timeZone: 'UTC' }).ok, false, 'más de 120 jornadas');
});

// ── 2 ───────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  language: 'es', style: 'studio',
  messages: { flash: { background: '#000000', foreground: '#ffb347', durationSeconds: 20 }, notice: { durationSeconds: 120 } },
  operations: { bisWindowMinutes: 10, delayBlocks: { all: M(false, false, false, false), stages: {} } },
  production: { people: [] },
  screens: {
    confidence: { showWarnMinutes: 10, showDangerMinutes: 5, changeoverWarnMinutes: 5, changeoverDangerMinutes: 1, blink: true, blinkSpeedSeconds: 1, overtimeBackground: '#000000', overtimeNumber: '#ff3b30' },
    backstage: { cards: true, lines: true, ticker: true },
    ticker: { delays: true, markers: true, weather: true, mode: 'crawl', background: '#000000', foreground: '#ffb347', speedSeconds: 30 },
    parking: { afterMinutes: 5 }
  },
  weather: { source: 'open-meteo', enabled: false, place: '', thresholds: { wind: null, gust: null, rain: null, heat: null, storm: true, uvEnabled: true, uv: 8, airQualityEnabled: false }, horizonHours: 3, refreshMinutes: 15, units: 'metric' }
};
test('2 · configuration {} y objetos parciales reciben exactamente los valores por defecto del §6.2 (Meteo desactivada)', () => {
  const b = D.parseDocument(FX('v1-basic.showtime'));
  assert.deepEqual(b.doc.festival.configuration, DEFAULT_CONFIG);
  const ev = b.doc.festival.project.event;
  assert.deepEqual([ev.dayCutoff, ev.callMinutes, ev.changeoverMinutes], ['06:00', 15, 15]);
  const p = D.parseDocument(mutate('v1-basic.showtime', o => {
    o.festival.configuration = { screens: { confidence: { showWarnMinutes: 20, blinkSpeedSeconds: 0.3 } }, weather: { thresholds: { uvEnabled: false, airQualityEnabled: true } }, messages: {} };
    delete o.festival.project.event.dayCutoff; delete o.festival.project.event.callMinutes;
  }));
  assert.ok(p.ok, p.message);
  const c = p.doc.festival.configuration;
  assert.equal(c.screens.confidence.showWarnMinutes, 20); assert.equal(c.screens.confidence.showDangerMinutes, 5); assert.equal(c.screens.confidence.blinkSpeedSeconds, 0.3);
  assert.ok(!('uv' in c.weather.thresholds), 'uv ausente con uvEnabled false'); assert.equal(c.weather.thresholds.airQuality, 80);
  assert.deepEqual(c.messages, DEFAULT_CONFIG.messages); assert.deepEqual(c.production, { people: [] });
  assert.deepEqual(c.operations.delayBlocks, { all: M(false, false, false, false), stages: {} }, 'stages {} y unzoned ausente');
  assert.equal(p.doc.festival.project.event.dayCutoff, '06:00'); assert.equal(p.doc.festival.project.event.callMinutes, 15);
  const w = D.parseDocument(mutate('v1-history.showtime', () => {}));
  assert.equal(w.doc.festival.configuration.weather.place, 'Madrid', 'place se guarda recortado');
});

// ── 3 ───────────────────────────────────────────────────────────────────
const UNKNOWN_PATHS = [
  ['xRoot'], ['festival', 'xFestival'], ['festival', 'project', 'xProject'], ['festival', 'configuration', 'xConf'],
  ['festival', 'configuration', 'screens', 'xScreens'], ['festival', 'configuration', 'screens', 'confidence', 'xConfidence'],
  ['festival', 'configuration', 'weather', 'xWeather'], ['festival', 'configuration', 'weather', 'thresholds', 'xTh'],
  ['festival', 'project', 'event', 'xEvent'], ['festival', 'project', 'event', 'branding', 'xBranding'],
  ['festival', 'project', 'stages', 0, 'xStage'], ['festival', 'project', 'entries', 0, 'xEntry'], ['festival', 'project', 'entries', 0, 'plan', 'xPlan'],
  ['festival', 'project', 'entries', 0, 'rules', 'linkedEntryId'], ['festival', 'project', 'entries', 3, 'actual', 'xActual'],
  ['festival', 'project', 'delays', 0, 'xDelay'], ['festival', 'project', 'delays', 0, 'scope', 'xScope'], ['festival', 'project', 'delays', 0, 'blockPolicy', 'xBlock'],
  ['eventLog', 'xLog'], ['eventLog', 'snapshots', 0, 'xSnap'], ['eventLog', 'snapshots', 0, 'entries', 0, 'xSnapEntry'], ['eventLog', 'snapshots', 0, 'entries', 0, 'plan', 'xSnapPlan'],
  ['eventLog', 'entries', 0, 'xEntryLog'], ['eventLog', 'entries', 0, 'data', 'xData'], ['protectedAccess']
];
test('3 · campos desconocidos en todos los niveles (§3.1) y protectedAccess: misma ruta y mismo valor JSON tras guardar y abrir', () => {
  const raw = J('v1-unknown-fields.showtime');
  const r = D.parseDocument(FX('v1-unknown-fields.showtime')); assert.ok(r.ok, r.message);
  const back = D.parseDocument(D.serializeDocument(r.doc).text).doc;
  UNKNOWN_PATHS.forEach(p => assert.deepEqual(get(back, p), get(raw, p), p.join('.')));
  assert.equal(back.festival.project.entries[0].rules.delayMode, 'category', 'linkedEntryId no tiene efecto ni sustituye nada');
  assert.ok(!('linkedEntryId' in back.festival.project.entries[1]), 'el soundcheck no recibe ningún vínculo');
  // Duplicar: se van con su contenedor (actual, delays, Log, bóveda); el resto se conserva
  const dup = D.duplicateDocument(r.doc, seqRand(5));
  const KEPT = UNKNOWN_PATHS.filter(p => ['eventLog', 'protectedAccess'].indexOf(p[0]) < 0 && p[2] !== 'delays' && p.indexOf('actual') < 0);
  KEPT.forEach(p => assert.deepEqual(get(dup, p), get(raw, p), 'Duplicar conserva ' + p.join('.')));
  assert.equal(get(dup, ['festival', 'project', 'entries', 0, 'rules', 'linkedEntryId']), 'sc-001', 'rules sigue: linkedEntryId también');
  assert.equal(get(dup, ['festival', 'project', 'entries', 3, 'actual']), undefined);
  assert.deepEqual(dup.festival.project.delays, []); assert.equal(dup.eventLog.xLog, undefined); assert.equal(dup.protectedAccess, undefined);
  // Una clave conocida con valor inválido no se conserva como extensión: rechaza
  invalid('v1-unknown-fields.showtime', o => { o.festival.configuration.style = 'dark'; }, /style/);
});

// ── 4 ───────────────────────────────────────────────────────────────────
test('4 · UUID en mayúsculas abre y se guarda en minúsculas; UUID inválido rechaza sin tocar nada', () => {
  const r = D.parseDocument(FX('v1-uuid-uppercase.showtime')); assert.ok(r.ok, r.message);
  assert.equal(r.doc.festivalId, '550e8400-e29b-41d4-a716-446655440000');
  assert.match(D.serializeDocument(r.doc).text, /"festivalId": "550e8400-e29b-41d4-a716-446655440000"/);
  const mixed = D.parseDocument(mutate('v1-basic.showtime', o => { o.festivalId = '550E8400-e29b-41D4-a716-446655440000'; }));
  assert.equal(mixed.doc.festivalId, '550e8400-e29b-41d4-a716-446655440000');
  invalid('v1-basic.showtime', o => { o.festivalId = '550e8400-e29b-41d4-a716-44665544000g'; }, /festivalId/);
  invalid('v1-basic.showtime', o => { o.festivalId = '550e8400e29b41d4a716446655440000'; }, /festivalId/);
});

// ── 5 ───────────────────────────────────────────────────────────────────
test('5 · JSON inválido, JSON ajeno, Showtime anterior a v1 y versión futura: cuatro mensajes distintos, sin tocar nada', () => {
  const msgs = [
    rejectsIntact(FX('invalid-json.txt'), 'invalid-json'),
    rejectsIntact(FX('foreign.json'), 'foreign'),
    rejectsIntact(FX('legacy-v20261171.json'), 'legacy', /anterior a v1/),
    rejectsIntact(FX('v1-future-version.showtime'), 'future', /posterior/)
  ].map(r => r.message);
  assert.equal(new Set(msgs).size, 4, 'mensajes distintos');
  rejectsIntact('[1,2,3]', 'foreign'); rejectsIntact('"texto"', 'foreign');
  rejectsIntact(txt({ format: 'otra-cosa', formatVersion: 1 }), 'foreign');
  rejectsIntact(mutate('v1-basic.showtime', o => { o.formatVersion = 0; }), 'invalid');
  rejectsIntact(mutate('v1-basic.showtime', o => { o.formatVersion = '1'; }), 'invalid');
  // Sin documento abierto, tampoco se guarda nada
  const store = new SpyStorage(V71), s = Sess.createSession(store);
  assert.equal(s.open(FX('v1-future-version.showtime')).ok, false);
  assert.equal(s.doc, null); assert.equal(store.snapshot(), new SpyStorage(V71).snapshot());
});

// ── 6 ───────────────────────────────────────────────────────────────────
test('6 · plan por kind: zona obligatoria para show/soundcheck con zonas, opcional en task/marker, campos prohibidos; Show y Soundcheck homónimos no se vinculan', () => {
  invalid('v1-basic.showtime', o => { delete o.festival.project.entries[0].plan.stageId; }, /necesita zona/);
  invalid('v1-basic.showtime', o => { delete o.festival.project.entries[1].plan.stageId; }, /soundcheck necesita zona/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].plan.stageId = 'nada'; }, /no existe/);
  const noStages = D.parseDocument(mutate('v1-basic.showtime', o => { o.festival.project.stages = []; o.festival.project.entries.forEach(e => delete e.plan.stageId); }));
  assert.ok(noStages.ok, noStages.message);
  invalid('v1-basic.showtime', o => { o.festival.project.stages = []; o.festival.project.entries.forEach(e => delete e.plan.stageId); o.festival.project.entries[3].plan.stageId = 'main'; }, /no existe/);
  const unz = D.parseDocument(FX('v1-basic.showtime'));
  assert.ok(!('stageId' in unz.doc.festival.project.entries[3].plan) && !('stageId' in unz.doc.festival.project.entries[4].plan), 'task y marker sin zona: válido');
  invalid('v1-basic.showtime', o => { o.festival.project.entries[4].plan.end = '20:30'; }, /marker no lleva fin/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[4].plan.end = null; }, /marker no lleva fin/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[3].plan.call = '09:30'; }, /task no lleva CALL/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[4].plan.call = ''; }, /marker no lleva CALL/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].plan.date = '2027-07-12'; }, /entre startDate y endDate/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].kind = 'banda'; }, /kind/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].name = '   '; }, /name/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[1].id = 'show-001'; }, /repetido/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].rules.delayMode = 'locked'; }, /delayMode/);
  invalid('v1-basic.showtime', o => { o.festival.project.stages[1].position = 0; }, /position/);
  // Homónimos: dos entradas, cada una con su plan; ninguna referencia a la otra
  const sh = unz.doc.festival.project.entries.filter(e => e.name === 'Luz Solar');
  assert.deepEqual(sh.map(e => e.kind + ':' + e.id), ['show:show-001', 'soundcheck:sc-001']);
  assert.ok(sh.every(e => JSON.stringify(e).indexOf(sh[0].id === e.id ? sh[1].id : sh[0].id) < 0), 'ninguna cita a la otra');
});

// ── 7 ───────────────────────────────────────────────────────────────────
test('7 · actual: ausente, {} y nulos = sin hecho (se limpian al guardar); endedAt solo y marker con hecho rechazan', () => {
  const r = D.parseDocument(mutate('v1-basic.showtime', o => {
    const E = o.festival.project.entries;
    E[0].actual = {}; E[1].actual = { startedAt: null, endedAt: null }; E[4].actual = { startedAt: null };
    E[3].actual = { startedAt: '2027-07-10T08:05Z', endedAt: null };
  }));
  assert.ok(r.ok, r.message);
  const E = r.doc.festival.project.entries;
  assert.ok(!('actual' in E[0]) && !('actual' in E[1]) && !('actual' in E[4]), 'formas vacías eliminadas');
  assert.deepEqual(E[3].actual, { startedAt: '2027-07-10T08:05:00Z' }, 'sin nulos y con segundos');
  assert.equal(D.hasHistory(r.doc), true, 'un actual con valor es historia');
  const empty = D.parseDocument(mutate('v1-basic.showtime', o => { o.festival.project.entries[0].actual = { startedAt: null }; }));
  assert.equal(D.hasHistory(empty.doc), false, 'un actual vacío no es historia');
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].actual = { endedAt: '2027-07-10T21:00:00Z' }; }, /necesita un inicio real/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].actual = { startedAt: '2027-07-10T21:00:00Z', endedAt: '2027-07-10T21:00:00Z' }; }, /posterior/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[4].actual = { startedAt: '2027-07-10T18:00:00Z' }; }, /marker no tiene hechos/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].actual = { startedAt: '2027-07-10 20:00' }; }, /UTC/);
});

// ── 8 ───────────────────────────────────────────────────────────────────
test('8 · horas en el documento: después de medianoche válido, hora repetida válida, hueco de cambio horario rechazado', () => {
  assert.ok(D.parseDocument(FX('v1-basic.showtime')).ok, 'show-002 a las 00:15 de la jornada del 10');
  assert.ok(D.parseDocument(FX('v1-time-dst-ambiguous.showtime')).ok);
  rejectsIntact(FX('v1-time-dst-gap.showtime'), 'invalid', /02:30 no existe el 2027-03-28/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].plan.end = '22:00'; }, /igual al inicio/);
  invalid('v1-basic.showtime', o => { o.festival.project.entries[0].plan.start = '24:00'; }, /HH:MM/);
  invalid('v1-basic.showtime', o => { o.festival.project.event.timeZone = '+02:00'; }, /IANA/);
});

// ── 9 ───────────────────────────────────────────────────────────────────
test('9 · festivalDay guardada coherente; los tres desajustes (ajuste, Log, snapshot) rechazan nombrando el elemento', () => {
  const h = D.parseDocument(FX('v1-history.showtime')); assert.ok(h.ok, h.message);
  invalid('v1-history.showtime', o => { o.festival.project.delays[2].festivalDay = '2027-07-11'; }, /«d3»/);
  invalid('v1-history.showtime', o => { o.eventLog.entries[8].festivalDay = '2027-07-11'; }, /sequence 9/);
  invalid('v1-history.showtime', o => { o.eventLog.snapshots[0].capturedAt = '2027-07-10T03:00:00Z'; }, /snapshot de 2027-07-10/);
  // Corte editado a mano con historia: una entrada de Log de las 07:00 locales del 11 (05:00Z) cambia de jornada
  invalid('v1-history.showtime', o => { o.festival.project.event.dayCutoff = '08:00'; }, /jornada/);
  invalid('v1-history.showtime', o => { o.festival.project.event.timeZone = 'America/New_York'; }, /jornada/);
});

// ── 10 ──────────────────────────────────────────────────────────────────
test('10 · configuración inválida de cada familia: rechazo sin tocar nada', () => {
  const C = (fn, re) => invalid('v1-history.showtime', o => fn(o.festival.configuration), re);
  C(c => { c.language = 'fr'; }, /language/);
  C(c => { c.messages = { flash: { background: '#FFF' } }; }, /background/);
  C(c => { c.messages = { flash: { foreground: 'red' } }; }, /foreground/);
  C(c => { c.messages = { flash: { durationSeconds: 15 } }; }, /durationSeconds/);
  C(c => { c.operations.bisWindowMinutes = 7; }, /bisWindowMinutes/);
  C(c => { c.screens = { confidence: { showWarnMinutes: 181 } }; }, /0 a 180/);
  C(c => { c.screens = { confidence: { showWarnMinutes: '10' } }; }, /entero/);
  C(c => { c.screens = { confidence: { showDangerMinutes: 12 } }; }, /peligro/);
  C(c => { c.screens = { confidence: { blinkSpeedSeconds: 0.15 } }; }, /un decimal/);
  C(c => { c.screens = { ticker: { speedSeconds: 4.9 } }; }, /speedSeconds/);
  C(c => { c.screens = { backstage: { cards: false, lines: false, ticker: false } }; }, /Al menos uno/);
  C(c => { c.screens = { parking: { afterMinutes: 3 } }; }, /afterMinutes/);
  C(c => { c.operations.delayBlocks.stages.fantasma = M(false, false, false, false); }, /fantasma.*no existe/);
  C(c => { c.operations.delayBlocks.all = { show: false, soundcheck: false, task: false }; }, /cuatro booleanos/);
  C(c => { c.operations.delayBlocks.unzoned = { show: false, soundcheck: false, task: false, marker: 'no' }; }, /cuatro booleanos/);
  C(c => { c.weather = { enabled: true }; }, /lat y lon/);
  C(c => { c.weather = { lat: 40 }; }, /juntas/);
  C(c => { c.weather.source = 'openmeteo'; }, /source/);
  C(c => { c.weather.thresholds = { wind: 0 }; }, /wind/);
  C(c => { c.weather.thresholds = { uvEnabled: false, uv: 5 }; }, /uv debe estar ausente/);
  C(c => { c.weather.thresholds = { airQualityEnabled: true, airQuality: 90 }; }, /airQuality/);
  C(c => { c.weather.place = 'x'.repeat(121); }, /120/);
  C(c => { c.production.people.push({ id: 'prod_7f3a9c21', name: 'Otra' }); }, /repetido/);
  C(c => { c.production.people.push({ id: 'con espacio', name: 'Otra' }); }, /Id de persona/);
  C(c => { c.production.people.push({ id: 'prod_x' }); }, /name/);
});

// ── 11 ──────────────────────────────────────────────────────────────────
test('11 · forma de delays[], snapshots y Log (sin calcular efectos): válidos se conservan; inválidos rechazan', () => {
  const h = D.parseDocument(FX('v1-history.showtime')); assert.ok(h.ok, h.message);
  const raw = J('v1-history.showtime');
  assert.deepEqual(h.doc.festival.project.delays.map(d => d.kind), ['delay', 'overtime', 'changeover-stretch', 'bis']);
  assert.deepEqual(h.doc.festival.project.delays, raw.festival.project.delays, 'se guardan tal cual: P1 no calcula ni escribe horarios efectivos');
  assert.deepEqual(h.doc.festival.project.entries.map(e => e.plan), D.parseDocument(FX('v1-basic.showtime')).doc.festival.project.entries.map(e => e.plan), 'el plan no cambia');
  assert.equal(h.doc.eventLog.entries[8].type, 'futuro-desconocido', 'tipo de Log desconocido aceptado y conservado');
  const X = (fn, re) => invalid('v1-history.showtime', o => fn(o.festival.project.delays, o), re);
  X(d => { d[0].kind = 'adelanto'; }, /kind/);
  X(d => { d[1].minutes = 5; }, /overtime no lleva minutes/);
  X(d => { d[1].scope = {}; }, /no lleva scope/);
  X(d => { delete d[0].fromAt; }, /fromAt/);
  X(d => { d[3].minutes = 16; }, /0 a 15/);
  X(d => { d[0].minutes = 0; }, /1 a 600/);
  X(d => { delete d[0].blockPolicy; }, /blockPolicy/);
  X(d => { delete d[0].blockPolicy.stages; }, /stages/);
  X(d => { d[0].blockPolicy.all = { show: true }; }, /cuatro booleanos/);
  X(d => { d[0].scope = { stageIds: [] }; }, /vacía/);
  X(d => { d[0].scope = { stageIds: ['nada'] }; }, /no existe/);
  X(d => { d[0].scope = { includeUnzoned: true }; }, /includeUnzoned/);
  X(d => { const t = d[0].occurredAt; d[0].occurredAt = d[1].occurredAt; d[1].occurredAt = t; d[0].fromAt = d[0].occurredAt; }, /orden/);
  X(d => { d[1].fromEntryId = 'nada'; }, /no existe/);
  X(d => { d[1].fromEntryId = 'task-001'; }, /show o un soundcheck/);
  X((d, o) => { o.festival.project.entries[1].plan.date = '2027-07-11'; }, /otra jornada/);
  X(d => { d[3].fromEntryId = 'show-001'; }, /un overtime o bis por entrada/);
  X((d, o) => { o.festival.project.entries[0].actual.endedAt = '2027-07-10T20:20:00Z'; }, /posterior a este ajuste/);
  X((d, o) => { o.festival.project.entries[2].actual = { startedAt: '2027-07-10T20:50:00Z' }; }, /ya había empezado/);
  const L = (fn, re) => invalid('v1-history.showtime', o => fn(o.eventLog), re);
  L(l => { l.snapshots.push(Object.assign({}, l.snapshots[0], { capturedAt: '2027-07-10T05:00:00Z' })); }, /repetido/);
  L(l => { l.snapshots.unshift({ festivalDay: '2027-07-11', capturedAt: '2027-07-11T04:30:00Z', entries: [] }); }, /orden de capturedAt/);
  L(l => { l.snapshots.push({ festivalDay: '2027-07-12', capturedAt: '2027-07-12T04:30:00Z', entries: [] }); }, /jornada del festival/);
  L(l => { l.entries[3].sequence = 3; }, /creciente/);
  L(l => { l.nextSequence = 10; }, /nextSequence/);
  L(l => { delete l.entries[6].data.confirmedBy; }, /confirmedBy/);
  L(l => { delete l.entries[6].data.confirmedBy.name; }, /name/);
  L(l => { delete l.entries[3].entryId; }, /necesita entryId/);
  L(l => { l.entries[2].data.kind = 'otro'; }, /kind/);
  L(l => { l.logVersion = 2; }, /logVersion/);
  L(l => { l.entries[0].id = 'log-2'; }, /repetido/);
});

// ── 12 ──────────────────────────────────────────────────────────────────
test('12 · logo: PNG/JPEG/WebP válidos; SVG saneado; inválido abre con aviso, sin logo, y el origen no se toca', () => {
  ['v1-logo-png.showtime', 'v1-logo-jpeg.showtime', 'v1-logo-webp.showtime'].forEach(f => {
    const r = D.parseDocument(FX(f)); assert.ok(r.ok, f); assert.deepEqual(r.warnings, [], f);
    assert.deepEqual(r.doc.festival.project.event.branding.logo, J(f).festival.project.event.branding.logo, f + ' sin cambios');
  });
  const sv = D.parseDocument(FX('v1-logo-svg-sanitized.showtime')); assert.ok(sv.ok);
  const svg = Buffer.from(sv.doc.festival.project.event.branding.logo.base64, 'base64').toString('utf8');
  assert.ok(!/script|onload|onclick|foreignObject|evil\.example|<div/i.test(svg), svg);
  assert.ok(/fill="url\(#g\)"/.test(svg) && /<use href="#g"\/>/.test(svg) && /^<svg /.test(svg), 'lo interno se conserva');
  assert.ok(!/script/i.test(D.serializeDocument(sv.doc).text), 'el guardado escribe la versión saneada');
  const path0 = path.join(__dirname, 'fixtures', 'v1', 'v1-logo-invalid.showtime'), before = fs.readFileSync(path0);
  const { s } = openedSession();
  const r = s.open(fs.readFileSync(path0, 'utf8'));
  assert.ok(r.ok, 'un logo inválido no invalida el documento');
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0].message, /logo no es válido/);
  assert.ok(!('logo' in s.doc.festival.project.event.branding), 'sin logo en memoria');
  assert.ok(!/base64/.test(s.save().text), 'la siguiente descarga ya no lo lleva');
  assert.ok(fs.readFileSync(path0).equals(before), 'el archivo de origen queda idéntico');
  const W = fn => D.parseDocument(mutate('v1-logo-png.showtime', o => fn(o.festival.project.event.branding)));
  assert.equal(W(b => { b.logo = 'no-objeto'; }).warnings.length, 1);
  assert.equal(W(b => { b.logo.base64 = '!!!'; }).warnings.length, 1, 'base64 incorrecto');
  assert.equal(W(b => { b.logo.mediaType = 'image/gif'; }).warnings.length, 1, 'tipo no admitido');
  assert.equal(W(b => { b.logo.base64 = Buffer.alloc(D.LOGO_MAX + 1, 0x89).fill(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), 0, 8).toString('base64'); }).warnings.length, 1, '262 145 bytes');
  assert.deepEqual(W(b => { b.logo.base64 = Buffer.alloc(D.LOGO_MAX, 0).fill(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), 0, 8).toString('base64'); }).warnings, [], 'exactamente 262 144 bytes: válido');
  assert.equal(W(b => { b.logo = { mediaType: 'image/svg+xml', base64: Buffer.from('<svg><g></svg>').toString('base64') }; }).warnings.length, 1, 'SVG mal formado');
  assert.equal(W(b => { b.logo = { mediaType: 'image/svg+xml', base64: Buffer.from('<html/>').toString('base64') }; }).warnings.length, 1, 'raíz distinta de svg');
  assert.equal(W(b => { b.logo = { mediaType: 'image/svg+xml', base64: Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>').toString('base64') }; }).warnings.length, 1, 'entidades propias');
  invalid('v1-logo-png.showtime', o => { o.festival.project.event.branding = 'texto'; }, /branding/);
});

// ── 13 ──────────────────────────────────────────────────────────────────
test('13 · Duplicar: identidad nueva; sin actual, delays, Log ni bóveda; conserva plan, reglas, orden y configuración; vuelve a admitir zona/corte', () => {
  const { s, store } = openedSession('v1-history.showtime');
  const orig = JSON.parse(txt(s.doc));
  assert.equal(D.hasHistory(s.doc), true);
  const before = { doc: txt(s.doc), store: store.snapshot() };
  const locked = s.setTimeContext({ dayCutoff: '05:00' });
  assert.equal(locked.ok, false); assert.match(locked.message, /historia/);
  assert.equal(txt(s.doc), before.doc); assert.equal(store.snapshot(), before.store, 'el rechazo no toca nada');
  const r = s.duplicate(); assert.ok(r.ok);
  const d = s.doc;
  assert.notEqual(d.festivalId, orig.festivalId); assert.match(d.festivalId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(d.eventLog, { logVersion: 1, snapshots: [], entries: [], nextSequence: 1 });
  assert.equal(d.protectedAccess, undefined); assert.deepEqual(d.festival.project.delays, []);
  assert.ok(d.festival.project.entries.every(e => !('actual' in e)));
  assert.deepEqual(d.festival.project.entries.map(e => [e.id, e.kind, e.name, e.plan, e.rules]), orig.festival.project.entries.map(e => [e.id, e.kind, e.name, e.plan, e.rules]), 'plan, reglas y orden de entries[]');
  assert.deepEqual(d.festival.configuration, orig.festival.configuration, 'configuración (Producción y menú de Retrasos incluidos)');
  assert.deepEqual(d.festival.project.event, orig.festival.project.event); assert.deepEqual(d.festival.project.stages, orig.festival.project.stages);
  assert.equal(D.hasHistory(d), false);
  const t = s.setTimeContext({ timeZone: 'Europe/Lisbon', dayCutoff: '05:00' });
  assert.ok(t.ok, t.message); assert.deepEqual([s.doc.festival.project.event.timeZone, s.doc.festival.project.event.dayCutoff], ['Europe/Lisbon', '05:00']);
  assert.equal(s.setTimeContext({ timeZone: 'Luna/Base' }).ok, false, 'el cambio sigue validándose');
  assert.equal(s.setTimeContext({ dayCutoff: '5:00' }).ok, false);
  // Un plan que deja de existir con la nueva zona (hueco) se rechaza igual
  const dst = Sess.createSession(new SpyStorage(), seqRand(2)); dst.open(mutate('v1-basic.showtime', o => {
    o.festival.project.event.startDate = o.festival.project.event.endDate = '2027-03-27';
    o.festival.project.entries = [{ id: 'x', kind: 'task', name: 'Noche', plan: { date: '2027-03-27', start: '02:30' } }];
    o.festival.project.event.timeZone = 'UTC';
  }));
  assert.equal(dst.setTimeContext({ timeZone: 'Europe/Madrid' }).ok, false);
  assert.equal(dst.doc.festival.project.event.timeZone, 'UTC');
});

// ── 14 ──────────────────────────────────────────────────────────────────
test('14 · aislamiento: solo claves showtime.v1.*; nunca lee, enumera, borra ni escribe claves showtime.* de la web anterior', () => {
  const store = new SpyStorage(V71), s = Sess.createSession(store, seqRand(11));
  s.restore();
  s.create({ name: 'A', startDate: '2027-07-10', timeZone: 'Europe/Madrid' });
  s.open(FX('v1-history.showtime')); s.open(FX('legacy-v20261171.json')); s.open('{roto');
  s.duplicate(); s.setTimeContext({ dayCutoff: '05:00' }); s.save();
  const s2 = Sess.createSession(store); assert.ok(s2.restore().ok, 'se recupera lo guardado en showtime.v1.document');
  s.close();
  assert.ok(store.touched.length > 0);
  store.touched.forEach(t => assert.match(t, /^(get|set|remove) showtime\.v1\./, t));
  Object.keys(V71).forEach(k => assert.equal(store.m.get(k), V71[k], k + ' intacta'));
  assert.equal(S.PREFIX, 'showtime.v1.'); assert.throws(() => S.keyOf('festival'));
  assert.deepEqual(S.createStorage(store).keys, ['showtime.v1.document']);
  // El código de v1 no menciona claves de la web anterior
  const dir = path.join(__dirname, '..', 'v1');
  fs.readdirSync(dir).filter(f => /\.(js|html|webmanifest)$/.test(f)).forEach(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/['"`]showtime\.(?!v1\.)/.test(src), f + ': ninguna clave «showtime.» que no sea v1');
    assert.ok(!/<script[^>]+src="\.\.\//.test(src), f + ': no carga código de la web anterior');
  });
  // Un almacenamiento bloqueado no rompe nada
  const blocked = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  const s3 = Sess.createSession(blocked, seqRand(4));
  assert.ok(s3.create({ name: 'Sin almacenamiento', startDate: '2027-07-10', timeZone: 'UTC' }).ok);
});

test('14b · Service Worker v1: caché «showtime.v1.*» propia; al activar solo borra cachés v1 antiguas, nunca las de la web anterior', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'v1', 'sw.js'), 'utf8');
  const stores = new Map([['showtime-20261172', 1], ['showtime-20261171', 1], ['showtime.v1.viejo', 1], ['otra-app', 1]]);
  const handlers = {};
  const self = { location: { href: 'https://x.test/showtime/v1/sw.js' }, registration: { scope: 'https://x.test/showtime/v1/' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: () => Promise.resolve() } };
  const caches = { keys: () => Promise.resolve(Array.from(stores.keys())), delete: k => Promise.resolve(stores.delete(k)), open: k => { stores.set(k, 1); return Promise.resolve({ add: () => Promise.resolve(), put: () => Promise.resolve(), match: () => Promise.resolve(null) }); } };
  const ctx = vm.createContext({ self, caches, URL, Request: function (u) { this.url = u; }, Response: { error: () => null }, fetch: () => Promise.reject(new Error('sin red')), setTimeout, clearTimeout, Promise });
  vm.runInContext(src, ctx);
  assert.match(vm.runInContext('CACHE', ctx), /^showtime\.v1\./);
  let wait; handlers.activate({ waitUntil: p => { wait = p; } }); await wait;
  assert.deepEqual(Array.from(stores.keys()).sort(), ['otra-app', 'showtime-20261171', 'showtime-20261172']);
  let responded = false;
  handlers.fetch({ request: { method: 'GET', url: 'https://x.test/showtime/index.html', mode: 'navigate' }, respondWith: () => { responded = true; } });
  assert.equal(responded, false, 'fuera de /v1/ no intercepta nada');
  handlers.fetch({ request: { method: 'GET', url: 'https://x.test/showtime/v1/app.js' }, respondWith: () => { responded = true; } });
  assert.equal(responded, true, 'dentro de /v1/ sí');
});

test('14c · página v1: identificada, explica que no abre ni migra JSON anteriores y solo carga sus propios módulos', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'v1', 'index.html'), 'utf8');
  assert.match(html, /<title>Showtime Document v1<\/title>/);
  assert.match(html, /no abre ni migra sus JSON/);
  assert.deepEqual((html.match(/<script src="([^"]+)"/g) || []).map(s => s.slice(13, -1)), ['time.js', 'document.js', 'storage.js', 'session.js', 'app.js']);
  assert.match(html, /accept="\.showtime,\.json/);
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'v1', 'manifest.webmanifest'), 'utf8'));
  assert.equal(man.scope, './'); assert.equal(man.name, 'Showtime Document v1');
  const app = fs.readFileSync(path.join(__dirname, '..', 'v1', 'app.js'), 'utf8');
  assert.match(app, /serviceWorker\.register\('sw\.js', \{ scope: '\.\/' \}\)/);
});

// ── R2 · snapshots y Event Log con estructuras conocidas validadas de verdad ──
test('R2-1 · snapshot: plan histórico de §5.2 con plan.date = festivalDay; zona ya borrada aceptada; claves desconocidas conservadas', () => {
  const r = D.parseDocument(FX('v1-log-shapes.showtime')); assert.ok(r.ok, r.message);
  const raw = J('v1-log-shapes.showtime');
  const snap = r.doc.eventLog.snapshots[1];
  assert.equal(snap.entries[0].plan.stageId, 'escenario-viejo', 'zona histórica que ya no existe: aceptada sin crearla');
  assert.ok(!r.doc.festival.project.stages.some(s => s.id === 'escenario-viejo'));
  assert.equal(snap.entries[0].plan.color, '#a78bfa', 'color normalizado');
  assert.equal(snap.entries[0].xEntrySnap, 2); assert.equal(snap.entries[0].plan.xPlanSnap, 1);
  assert.equal(snap.entries[1].plan.stageId, undefined, 'soundcheck histórico sin zona: aceptado');
  const again = D.parseDocument(D.serializeDocument(r.doc).text); assert.ok(again.ok, again.message);
  assert.deepEqual(again.doc.eventLog, r.doc.eventLog, 'guardar y volver a abrir conserva el Log');
  assert.deepEqual(r.doc.eventLog.entries.slice(10).map(e => e.data.before || e.data), raw.eventLog.entries.slice(10).map(e => e.data.before || e.data));

  const S0 = (fn, re) => invalid('v1-log-shapes.showtime', o => fn(o.eventLog.snapshots[1].entries, o.eventLog.snapshots[1]), re);
  S0(e => { e[0].plan.date = '2027-07-10'; }, /snapshots\[1\]\.entries\[0\]\.plan\.date.*solo recoge entradas con plan\.date 2027-07-11/);
  S0(e => { e.push({ entryId: 'm', kind: 'marker', name: 'M', plan: { date: '2027-07-11', start: '20:00', end: '21:00' } }); }, /entries\[2\]\.plan\.end.*marker no lleva fin/);
  S0(e => { e.push({ entryId: 'm', kind: 'marker', name: 'M', plan: { date: '2027-07-11', start: '20:00', end: null } }); }, /marker no lleva fin/);
  S0(e => { e.push({ entryId: 'm', kind: 'marker', name: 'M', plan: { date: '2027-07-11', start: '20:00', call: '' } }); }, /marker no lleva CALL/);
  S0(e => { e.push({ entryId: 't', kind: 'task', name: 'T', plan: { date: '2027-07-11', start: '10:00', call: '09:50' } }); }, /entries\[2\]\.plan\.call.*task no lleva CALL/);
  S0(e => { e.push({ entryId: 't', kind: 'task', name: 'T', plan: { date: '2027-07-11', start: '10:00', call: null } }); }, /task no lleva CALL/);
  S0(e => { e[0].plan.start = '24:00'; }, /plan\.start.*Hora no válida/);
  S0(e => { e[0].plan.end = e[0].plan.start; }, /plan\.end.*igual al inicio/);
  S0(e => { e[0].plan.stageId = ''; }, /plan\.stageId.*no vacío/);
  S0(e => { e[0].kind = 'banda'; }, /entries\[0\]\.kind/);
  S0(e => { e[0].name = '  '; }, /entries\[0\]\.name/);
  S0(e => { e[0].plan.color = '#fff'; }, /plan\.color/);
  S0(e => { e[0].plan.notes = 3; }, /plan\.notes/);
  // Hueco de cambio horario dentro de un snapshot (Madrid, 28 mar 2027)
  invalid('v1-basic.showtime', o => {
    o.festival.project.event.startDate = '2027-03-27'; o.festival.project.event.endDate = '2027-03-28'; o.festival.project.entries = [];
    o.eventLog.snapshots = [{ festivalDay: '2027-03-27', capturedAt: '2027-03-27T05:00:00Z', entries: [{ entryId: 'x', kind: 'task', name: 'Noche', plan: { date: '2027-03-27', start: '02:30' } }] }];
  }, /snapshots\[0\]\.entries\[0\]\.plan\.start.*no existe el 2027-03-28/);
});

test('R2-2 · Log entry-added / entry-deleted: { kind, name, plan } completo con plan histórico; rechazo no destructivo', () => {
  const LG = (fn, re) => invalid('v1-log-shapes.showtime', o => fn(o.eventLog.entries), re);
  LG(l => { l[0].data.after.plan.date = '2027-02-30'; }, /entries\[0\].*data\.after\.plan\.date.*Fecha no válida/);
  LG(l => { delete l[0].data.after.plan; }, /data\.after\.plan.*objeto/);
  LG(l => { l[0].data.after.plan = { date: '2027-07-10', start: '20:00', end: null }; }, /data\.after\.plan\.end.*marker no lleva fin/);
  LG(l => { l[0].data.after.kind = 'banda'; }, /data\.after\.kind/);
  LG(l => { l[0].data.after = { lo: 'que sea' }; }, /data\.after\.kind/);
  LG(l => { l[12].data.before.name = ''; }, /entries\[12\].*data\.before\.name.*Texto obligatorio/);
  LG(l => { l[12].data.before.name = '   '; }, /data\.before\.name/);
  LG(l => { l[12].data.before.kind = 'task'; l[12].data.before.plan.call = '18:40'; }, /data\.before\.plan\.call.*task no lleva CALL/);
  LG(l => { l[12].data.before.plan.start = '7:00'; }, /data\.before\.plan\.start/);
  LG(l => { delete l[12].data.before; }, /data\.before.*objeto/);
  // Un show histórico sin zona y con zona ya borrada se acepta; la clave desconocida se conserva
  const r = D.parseDocument(FX('v1-log-shapes.showtime'));
  assert.equal(r.doc.eventLog.entries[12].data.before.xDel, 1); assert.equal(r.doc.eventLog.entries[12].data.before.plan.xPlanHist, 'p');
  // Hueco de cambio horario en un entry-added
  invalid('v1-basic.showtime', o => {
    o.festival.project.event.startDate = '2027-03-27'; o.festival.project.event.endDate = '2027-03-28'; o.festival.project.entries = [];
    o.eventLog.entries = [{ id: 'l1', sequence: 1, occurredAt: '2027-03-27T09:00:00Z', festivalDay: '2027-03-27', type: 'entry-added', entryId: 'x', data: { after: { kind: 'task', name: 'Noche', plan: { date: '2027-03-27', start: '02:30' } } } }];
    o.eventLog.nextSequence = 2;
  }, /data\.after\.plan\.start.*no existe/);
});

test('R2-3 · Log entry-updated: solo kind/name/plan cambiados, mismo conjunto de claves, valores validados', () => {
  const r = D.parseDocument(FX('v1-log-shapes.showtime')); assert.ok(r.ok, r.message);
  assert.deepEqual(r.doc.eventLog.entries[10].data, { before: { plan: { start: '00:15', end: '01:30' } }, after: { plan: { start: '00:30', end: '01:45' } } });
  assert.equal(r.doc.eventLog.entries[11].data.xUpd, true, 'clave desconocida de data conservada (§3.1)');
  const U = (fn, re) => invalid('v1-log-shapes.showtime', o => fn(o.eventLog.entries[10].data, o.eventLog.entries[11].data), re);
  U(d => { d.before = { wat: 1 }; d.after = { wat: 2 }; }, /data\.before\.wat.*solo kind, name y plan/);
  U(d => { d.before.nope = 1; d.after.nope = 1; }, /data\.before\.nope/);
  U(d => { d.before = {}; d.after = {}; }, /data\.before.*al menos una/);
  U(d => { d.before = 'x'; }, /data\.before.*objeto/);
  U(d => { delete d.after; }, /data\.after.*objeto/);
  U((a, d) => { delete d.after.name; }, /entries\[11\].*mismas claves/);
  U(d => { d.after.name = 'Otra'; }, /mismas claves/);
  U((a, d) => { d.after.kind = 'band'; }, /data\.after\.kind/);
  U((a, d) => { d.before.name = ' '; }, /data\.before\.name/);
  U(d => { d.after.plan.start = '25:00'; }, /data\.after\.plan\.start/);
  U(d => { d.after.plan.color = 'red'; }, /data\.after\.plan\.color/);
  U(d => { d.after.plan.date = '2027-13-01'; }, /data\.after\.plan\.date/);
  U(d => { d.after.plan.stageId = ''; }, /data\.after\.plan\.stageId/);
  U(d => { d.before.plan = {}; d.after.plan = {}; }, /sin ningún campo/);
  // Campo incompatible con el kind cuando es determinable (el lado que cambia de tipo)
  U((a, d) => { d.before.plan = { end: '21:00' }; d.after.plan = { start: '20:00' }; }, /data\.before\.plan\.end.*marker no lleva fin/);
  U((a, d) => { d.before.plan = { start: '20:00' }; d.after.plan = { call: '19:00' }; }, /data\.after\.plan\.call.*task no lleva CALL/);
  // Diff con fecha y horas: se resuelve en event.timeZone
  U(d => { d.after.plan = { date: '2027-07-10', start: '22:00', end: '22:00' }; d.before.plan = { date: '2027-07-10', start: '21:00', end: '22:00' }; }, /data\.after\.plan\.end.*igual al inicio/);
  // Sin kind en el cambio no es determinable: un call en el diff se valida solo como hora
  const ok = mutate('v1-log-shapes.showtime', o => { o.eventLog.entries[10].data = { before: { plan: { call: '23:50' } }, after: { plan: { call: '23:55' } } }; });
  assert.ok(D.parseDocument(ok).ok);
});

test('R2-4 · Log delay-applied / delay-removed: delayId, kind, minutes según tipo y fromEntryName si hay entryId', () => {
  const r = D.parseDocument(FX('v1-log-shapes.showtime')); assert.ok(r.ok, r.message);
  const DL = (i, fn, re) => invalid('v1-log-shapes.showtime', o => fn(o.eventLog.entries[i], o.eventLog.entries[i].data), re);
  DL(14, (e, d) => { delete d.minutes; }, /entries\[14\].*data\.minutes.*entero de 1 a 600/);        // delay-removed · delay
  DL(13, (e, d) => { delete d.minutes; }, /entries\[13\].*data\.minutes.*entero de 0 a 15/);         // delay-removed · bis
  DL(16, (e, d) => { delete d.minutes; }, /entries\[16\].*data\.minutes/);                           // delay-applied · stretch
  DL(14, (e, d) => { d.kind = 'changeover-stretch'; delete d.minutes; }, /data\.minutes/);           // delay-removed · stretch
  DL(15, (e, d) => { d.minutes = 0; }, /entries\[15\].*overtime no lleva minutes/);                 // delay-removed · overtime
  DL(4, (e, d) => { d.minutes = 5; }, /entries\[4\].*overtime no lleva minutes/);                   // delay-applied · overtime
  DL(13, (e, d) => { delete d.fromEntryName; }, /entries\[13\].*fromEntryName.*Texto obligatorio/); // delay-removed con entryId
  DL(13, (e, d) => { d.fromEntryName = ' '; }, /fromEntryName/);
  DL(2, (e, d) => { delete d.fromEntryName; }, /entries\[2\].*fromEntryName/);                      // delay-applied con entryId
  DL(14, (e, d) => { delete d.delayId; }, /data\.delayId/);
  DL(14, (e, d) => { d.kind = 'retraso'; }, /data\.kind/);
  DL(13, (e, d) => { d.minutes = 16; }, /0 a 15/);
  DL(14, (e, d) => { d.minutes = '5'; }, /data\.minutes/);
  // Sin entryId, fromEntryName no es obligatorio; los tipos desconocidos siguen aceptando cualquier data
  assert.equal(r.doc.eventLog.entries[14].entryId, undefined);
  assert.deepEqual(r.doc.eventLog.entries[8].data, { lo: 'que sea' });
});

test('R2-5 · Service Worker v1: PRECACHE sin «./»; sin red, la navegación cae a index.html de la caché', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'v1', 'sw.js'), 'utf8');
  const store = new Map(), handlers = {};
  const self = { location: { href: 'https://x.test/showtime/v1/sw.js' }, registration: { scope: 'https://x.test/showtime/v1/' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: () => Promise.resolve() } };
  const key = x => typeof x === 'string' ? x : x.url;
  const cache = { add: r => { store.set(key(r), 'cached:' + key(r)); return Promise.resolve(); }, put: () => Promise.resolve(), match: r => Promise.resolve(store.has(key(r)) ? store.get(key(r)) : undefined) };
  const caches = { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve(cache) };
  const ctx = vm.createContext({ self, caches, URL, Request: function (u) { this.url = typeof u === 'string' ? u : u.url; }, Response: { error: () => 'error' }, fetch: () => Promise.reject(new Error('sin red')), setTimeout, clearTimeout, Promise });
  vm.runInContext(src, ctx);
  const pre = vm.runInContext('PRECACHE', ctx);
  assert.ok(pre.indexOf('./') < 0 && pre.indexOf('') < 0, 'sin «./» (servidor.js da 404 en /v1/)');
  assert.deepEqual(Array.from(pre).sort(), ['app.css', 'app.js', 'document.js', 'index.html', 'manifest.webmanifest', 'session.js', 'storage.js', 'time.js']);
  let wait; handlers.install({ waitUntil: p => { wait = p; } }); await wait;
  assert.ok(store.has('index.html'), 'index.html precacheado');
  let res; handlers.fetch({ request: { method: 'GET', url: 'https://x.test/showtime/v1/', mode: 'navigate' }, respondWith: p => { res = p; } });
  assert.equal(await res, 'cached:index.html', 'navegación sin red → index.html de la caché');
  handlers.fetch({ request: { method: 'GET', url: 'https://x.test/showtime/v1/nada.js', mode: 'no-cors' }, respondWith: p => { res = p; } });
  assert.equal(await res, 'error', 'un recurso no guardado sin red no se sustituye por la página');
});

// ── R3 · normalización de los datos conocidos del Log (§3.2) ──────────────
test('R3 · Log: marcas UTC de actual-* con segundos, confirmedBy.name y fromEntryName recortados, extensiones de confirmedBy conservadas, entrada sin mutar', () => {
  const raw = J('v1-log-shapes.showtime'), Lg = raw.eventLog.entries;
  assert.deepEqual([Lg[1].type, Lg[2].type, Lg[5].type, Lg[6].type, Lg[13].type], ['actual-start', 'delay-applied', 'actual-end', 'call-confirmed', 'delay-removed']);
  Lg[1].data.startedAt = '2027-07-10T08:05Z';
  Lg[5].data.endedAt = '2027-07-10T21:10Z';
  Lg[6].data.confirmedBy = { personId: 'prod_7f3a9c21', name: '  Marta  ', xConf: { a: [1, { b: null }], c: '  sin tocar  ' } };
  Lg[2].data.fromEntryName = '  Luz Solar ';
  Lg[13].data.fromEntryName = '\tBanda borrada  ';
  const frozen = JSON.stringify(raw);
  const check = (doc, when) => {
    const E = doc.eventLog.entries;
    assert.equal(E[1].data.startedAt, '2027-07-10T08:05:00Z', when + ': actual-start con :SSZ');
    assert.equal(E[5].data.endedAt, '2027-07-10T21:10:00Z', when + ': actual-end con :SSZ');
    assert.deepEqual(E[6].data.confirmedBy, { personId: 'prod_7f3a9c21', name: 'Marta', xConf: { a: [1, { b: null }], c: '  sin tocar  ' } }, when + ': name recortado, extensión intacta');
    assert.equal(E[2].data.fromEntryName, 'Luz Solar', when + ': delay-applied');
    assert.equal(E[13].data.fromEntryName, 'Banda borrada', when + ': delay-removed');
    assert.deepEqual(E[10].data, raw.eventLog.entries[10].data, when + ': entry-updated igual que en R2');
    assert.deepEqual(E[9].data, { text: 'Buenos días' }, when + ': message sin cambios');
  };
  const v = D.validate(raw); assert.ok(v.ok, v.message);
  assert.equal(JSON.stringify(raw), frozen, 'validate no muta la entrada');
  const r = D.parseDocument(frozen); assert.ok(r.ok, r.message);
  check(r.doc, 'parseDocument');
  const again = D.parseDocument(D.serializeDocument(r.doc).text); assert.ok(again.ok, again.message);
  check(again.doc, 'serializeDocument → parseDocument');
  assert.deepEqual(again.doc, r.doc, 'idempotente');
  assert.equal(JSON.stringify(raw), frozen, 'la entrada JSON original no cambia');
  // Los mensajes de texto no se normalizan en R3
  const m = D.parseDocument(mutate('v1-log-shapes.showtime', o => { o.eventLog.entries[9].data.text = '  hola  '; }));
  assert.equal(m.doc.eventLog.entries[9].data.text, '  hola  ');
});

// ── R2 revisado · retraso antes; Tiempo extra/Bis durante ─────────────────
test('R2-A · overtime/bis exigen una banda con ▶ anterior o igual a su occurredAt; rechazo no destructivo', () => {
  const P = o => o.festival.project;
  invalid('v1-schedule-overtime.showtime', o => { delete P(o).entries[0].actual; }, /delays\[0\].*overtime solo se aplica a una banda que ya ha empezado.*«o1» no tiene ▶/);
  invalid('v1-schedule-overtime.showtime', o => { delete P(o).entries[4].actual; }, /delays\[1\].*bis solo se aplica a una banda que ya ha empezado.*«p1» no tiene ▶/);
  invalid('v1-schedule-overtime.showtime', o => { P(o).entries[0].actual.startedAt = '2027-07-10T18:56:00Z'; }, /delays\[0\].*▶ de «o1» es posterior a este overtime/);
  invalid('v1-schedule-overtime.showtime', o => { P(o).entries[4].actual.startedAt = '2027-07-10T19:06:00Z'; }, /delays\[1\].*▶ de «p1» es posterior a este bis/);
  invalid('v1-schedule-overtime.showtime', o => { P(o).entries[0].actual = { startedAt: null }; }, /no tiene ▶/);
  // ▶ igual a occurredAt y ▶ anterior: válidos
  const eq = D.parseDocument(mutate('v1-schedule-overtime.showtime', o => { P(o).entries[0].actual.startedAt = P(o).delays[0].occurredAt; }));
  assert.ok(eq.ok, eq.message);
  assert.ok(D.parseDocument(FX('v1-schedule-overtime.showtime')).ok);
  // Los fixtures con Tiempo extra/Bis legítimos siguen validando
  fs.readdirSync(path.join(__dirname, 'fixtures', 'v1')).filter(f => /^v1-(schedule-|history|log-shapes)/.test(f)).forEach(f => {
    const r = D.parseDocument(FX(f)); assert.ok(r.ok, f + ': ' + r.message);
  });
  // Un delay sí puede aplicarse a una banda sin ▶ (retraso antes): sin cambio
  assert.ok(D.parseDocument(FX('v1-schedule-delay.showtime')).ok);
});
