/* Tests de la jerarquía por escenario (dec. 149) y del CALL confirmado que desaparece en todas las pantallas.
 * Ordenador:  node tests/escenarios.test.js
 * Dashboard (control.js) y Live Manager / Backstage (live.js) en el navegador simulado (_dom.js), con reloj fijo.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('escenarios.test.js: solo en Node'); return; }
  const D = require('./_dom.js'), C = require('../core.js'), E = require('../emision.js'), V = require('../vistas.js');
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const MODULOS = ['i18n.js', 'core.js', 'meteo.js', 'datos.js', 'importar.js', 'xlsx.js', 'qr.js', 'emision.js', 'mando.js', 'vistas.js', 'log.js', 'marca.js', 'audio.js', 'control.js'];

  const d0 = new Date(); d0.setHours(23, 35, 0, 0);
  const T0 = d0.getTime(), ISO = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  /** Un escenario («Principal») con «The Kooks» en soundcheck 23:00–23:50; con dos, además «Alhambra»: hueco (Los X SC 21:00–22:00 → Los Y show 23:45) y CALL de Los Y. */
  function fest(two) {
    let s = C.newFestival({ nombre: 'Prueba', fechaInicio: ISO, fechaFin: ISO, dayCutoff: '06:00' }).state;
    s = C.addStage(s, 'Principal').state;
    s = C.addArtist(s, 'sc', { jornada: ISO, nombre: 'The Kooks', escenarioId: s.escenarios[0].id, inicio: '23:00', fin: '23:50' }).state;
    if (two) {
      s = C.addStage(s, 'Alhambra').state;
      s = C.addArtist(s, 'sc', { jornada: ISO, nombre: 'Los X', escenarioId: s.escenarios[1].id, inicio: '21:00', fin: '22:00' }).state;
      s = C.addArtist(s, 'show', { jornada: ISO, nombre: 'Los Y', escenarioId: s.escenarios[1].id, inicio: '23:45', fin: '23:59' }).state;
    }
    return s;
  }
  function dashboard(F) {
    const env = D.makeEnv({ cripto: true, now: T0, storage: { 'showtime.festival': JSON.stringify(F), 'showtime.config': JSON.stringify({ mode: 'all' }) } });
    env.win.CSS = { escape: x => String(x) };
    D.cargar(env, MODULOS);
    const last = id => (env.innerLog.filter(([n]) => n === id).slice(-1)[0] || ['', ''])[1];
    return { env, T: env.win.ShowtimePanel._test, last, read: k => { const v = env.storage.get(k); return v ? JSON.parse(v) : null; } };
  }
  async function live(vista, snap) {
    const room = await E.newRoom();
    const env = D.makeEnv({ cripto: true, now: T0, search: '?vista=' + vista, hash: E.staffUrl(room, 'http://x/').replace(/^[^#]*/, '') });
    env.getEl('msgdock').hidden = true; env.getEl('pmodal').hidden = true; env.getEl('chatdock').hidden = true;
    D.cargar(env, ['core.js', 'meteo.js', 'datos.js', 'emision.js']);
    env.win.ShowtimeEmision.Receptor.prototype.start = async function () {};
    D.cargar(env, ['vistas.js', 'marca.js', 'i18n.js', 'live.js']);
    env.win.ShowtimeDatos.loadSnapshot(snap); env.win.ShowtimeLive.reload();
    const last = id => (env.innerLog.filter(([n]) => n === id).slice(-1)[0] || ['', ''])[1];
    return { env, last };
  }
  const text = h => h.replace(/<[^>]+>/g, '\n').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').split('\n').map(x => x.trim()).filter(Boolean);
  /** Orden ZONA → contenido → tiempo en el texto pintado; la línea de tiempo no repite la zona. */
  function orden(h, zona, contenido, tiempo, msg) {
    const t = text(h).join('\n'), iz = t.indexOf(zona), ic = t.indexOf(contenido, iz), it = tiempo === null ? ic + 1 : t.indexOf(tiempo, ic + contenido.length);
    ok(iz >= 0 && ic > iz && it > ic, msg + ': «' + zona + '» → «' + contenido + '» → «' + tiempo + '» en: ' + t.replace(/\n/g, ' | ').slice(0, 220));
    if (tiempo === null) return;
    const linea = text(h).find(l => l.indexOf(tiempo) >= 0) || '';
    ok(linea.toUpperCase().indexOf(zona.toUpperCase()) < 0, msg + ': la línea de tiempo no repite la zona: ' + linea);
  }

  test('Un único escenario: «Principal» siempre arriba (Dashboard, Manager y Backstage) — zona → contenido → hora · minutos', async () => {
    const t = dashboard(fest(false)), vn = t.last('v-now');
    ok(/<div class="v-zone">Principal<\/div>/.test(vn), 'Dashboard: cabecera «Principal»');
    orden(vn, 'Principal', 'The Kooks', '23:00–23:50 · 15 min restantes', 'Dashboard · En escena');
    ok(/The Kooks<span class="v-kind"> · Soundcheck<\/span>/.test(vn), 'contenido: «The Kooks · Soundcheck»');
    const snap = JSON.parse(JSON.stringify(t.T.emSnapshot()));
    for (const v of ['manager', 'backstage']) {
      const L = await live(v, snap), h = L.last('now-list');
      ok(/<div class="tzone">PRINCIPAL<\/div>/.test(h), v + ': cabecera PRINCIPAL');
      orden(h, 'PRINCIPAL', 'THE KOOKS', '23:00–23:50', v + ' · EN ESCENA');
      ok(/15 min restantes/.test(h), v + ': minutos restantes en la última línea');
      eq(L.env.errors.length, 0, v + ': ' + L.env.errors.join(' | '));
    }
  });

  test('Varios escenarios: una cabecera por zona, en el orden de la configuración; con actividad y sin actividad', async () => {
    const t = dashboard(fest(true)), vn = t.last('v-now');
    eq((vn.match(/<div class="v-zone">/g) || []).length, 2, 'dos zonas');
    ok(vn.indexOf('>Principal<') < vn.indexOf('>Alhambra<'), 'Principal antes que Alhambra (orden de la configuración)');
    orden(vn, 'Principal', 'The Kooks', '23:00–23:50 · 15 min restantes', 'con actividad');
    orden(vn, 'Alhambra', '— Sin actividad —', null, 'sin actividad');
    const alh = vn.slice(vn.indexOf('>Alhambra<'));
    ok(!/Alhambra[\s\S]*Alhambra/.test(alh), 'la zona no se repite dentro de su grupo');
    orden(t.last('v-next'), 'Alhambra', 'Los Y', '23:45–23:59', 'Siguiente');
    orden(t.last('v-call'), 'Alhambra', 'Los Y', '23:45 · en 10 min', 'CALL');
    const snap = JSON.parse(JSON.stringify(t.T.emSnapshot()));
    for (const v of ['manager', 'backstage']) {
      const L = await live(v, snap), now = L.last('now-list');
      eq((now.match(/<div class="tzone">/g) || []).length, 2, v + ': dos zonas en EN ESCENA');
      orden(now, 'ALHAMBRA', '— Sin actividad —', null, v + ' · hueco');
      orden(L.last('next-list'), 'ALHAMBRA', 'LOS Y', '23:45–23:59', v + ' · SIGUIENTE');
      orden(L.last('call-list'), 'ALHAMBRA', 'LOS Y', '23:45', v + ' · CALL');
      ok(/en 10 min/.test(L.last('call-list')), v + ': CALL con sus minutos');
    }
  });

  test('Sin zona: «SIN ZONA» arriba (nada queda implícito); helper de grupos', () => {
    const g = V.zoneGroups([{ z: 'a', zn: 'Principal', zc: '#f00', h: '1' }, { z: 'a', zn: 'Principal', h: '2' }, { z: '', zn: '', h: '3' }]);
    eq(g.length, 2); eq(g[0].items.join(), '1,2', 'misma zona: una cabecera'); eq(g[1].name, '', 'sin zona: el que pinta pone «SIN ZONA»');
    ok(/esc\(g\.name \|\| tx\('SIN ZONA'\)\)/.test(D.src('control.js')) && /esc\(\(g\.name \|\| tx\('SIN ZONA'\)\)\.toUpperCase\(\)\)/.test(D.src('live.js')), 'Dashboard y Live');
    const I = require('../i18n.js'); eq(I.tx('SIN ZONA', null, 'en'), 'NO STAGE');
  });

  test('CALL con OK: fuera del Dashboard y de Manager; Backstage «AVISADO» (misma hora efectiva); el log conserva «CALL OK»', async () => {
    const t = dashboard(fest(true));
    const key = C.callKey(C.buildBlocks(fest(true), { mode: 'all', day: 'all' }).find(b => b.name === 'Los Y'));
    ok(/Los Y/.test(t.last('v-call')), 'antes: en la tarjeta CALL');
    t.env.fire('v-call', 'click', { target: { closest: q => q === '.okbtn' ? { dataset: { ck: key } } : null } });
    ok(!/Los Y/.test(t.last('v-call')), 'Dashboard: fuera');
    const snap = JSON.parse(JSON.stringify(t.T.emSnapshot()));
    for (const v of ['manager', 'backstage']) {
      const L = await live(v, snap), h = L.last('call-list');
      ok(v === 'manager' ? !/LOS Y/.test(h) : /LOS Y/.test(h) && /AVISADO/.test(h), v + (v === 'manager' ? ': fuera' : ': «AVISADO»'));
    }
    ok(((t.read('showtime.log') || {}).entries || []).some(e => e.type === 'call' && /Los Y/.test(JSON.stringify(e))), 'log: «CALL OK · Los Y»');
  });

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Escenarios: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
