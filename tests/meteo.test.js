/* Tests de meteo.js — sin dependencias ni red (respuestas de Open-Meteo de mentira).
 * Ordenador:  node tests/meteo.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const W = isNode ? require('../meteo.js') : window.ShowtimeMeteo;
  const V = isNode ? require('../vistas.js') : window.ShowtimeVistas;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  async function rejects(p, re, msg) { try { await p; } catch (e) { if (re.test(e.message)) return; throw new Error((msg || '') + ' error inesperado: ' + e.message); } throw new Error((msg || '') + ' esperaba un error'); }

  // ── Respuesta de mentira: «ahora» = 18:00 UTC; horas 17:00 … 23:00 ────
  const H0 = Date.UTC(2026, 6, 10, 17) / 1000, NOW = Date.UTC(2026, 6, 10, 18, 5);
  const hrs = n => Array.from({ length: n }, (_, i) => H0 + i * 3600);
  function fc(o) {
    const x = Object.assign({ gust: [20, 25, 30, 48, 62, 40, 30], wind: [10, 12, 15, 25, 30, 20, 15], rain: [0, 0, 0.2, 1.5, 4, 0, 0],
      temp: [27, 26, 25, 24, 22, 21, 20], code: [1, 2, 3, 61, 95, 3, 1], uv: [6, 4, 2, 1, 0, 0, 0] }, o || {});
    return {
      current: { time: H0 + 3600, temperature_2m: 26.4, precipitation: 0, wind_speed_10m: 12, wind_gusts_10m: 25, weather_code: 2 },
      hourly: { time: hrs(7), temperature_2m: x.temp, precipitation: x.rain, wind_speed_10m: x.wind, wind_gusts_10m: x.gust, weather_code: x.code, uv_index: x.uv }
    };
  }
  const aq = { current: { european_aqi: 35 }, hourly: { time: hrs(7), european_aqi: [30, 35, 50, 70, 85, 60, 40] } };
  const SNAP = W.parseOpenMeteo(fc(), aq, NOW);
  const CFG = th => W.normMeteo({ on: true, lat: 37.18, lon: -3.6, horizon: 3, th: th || {} });

  // ── Ajustes ───────────────────────────────────────────────────────────
  test('ajustes: viento y ráfagas VACÍOS por defecto; UV 8 sí; calidad del aire apagada', () => {
    const d = W.normMeteo();
    eq(d.on, true, 'el tiempo sale por defecto'); eq(W.normMeteo({ on: false }).on, false, 'apagado en Configuración: se respeta'); eq(d.th.gust, null); eq(d.th.wind, null); eq(d.th.rain, null); eq(d.th.heat, null);
    eq(d.th.storm, true); eq(d.th.uvOn, true); eq(d.th.uv, 8); eq(d.th.aqiOn, false); eq(d.th.aqi, 80);
    eq(d.horizon, 3); eq(d.refresh, 15); eq(d.source, 'openmeteo');
  });
  test('ajustes: límites, comas decimales, valores raros y solo https', () => {
    const m = W.normMeteo({ lat: '37,18', lon: 999, th: { gust: '55', rain: '2,5', uv: 'x', aqi: 70 }, horizon: 4, refresh: 7, url: 'http://x', source: 'raro' });
    eq(m.lat, 37.18); eq(m.lon, 180); eq(m.th.gust, 55); eq(m.th.rain, 2.5); eq(m.th.uv, 8); eq(m.th.aqi, 80);
    eq(m.horizon, 3); eq(m.refresh, 15); eq(m.url, ''); eq(m.source, 'openmeteo');
    eq(W.normMeteo({ url: 'https://estacion.example/api?k=1' }).url, 'https://estacion.example/api?k=1');
  });
  test('a los dispositivos de Staff no se emite la URL propia (puede llevar clave)', () => {
    const p = W.publicMeteo({ source: 'url', url: 'https://estacion.example/api?token=SECRETO', map: { gust: 'a.b' } });
    eq(p.url, ''); eq(p.map.gust, ''); eq(p.source, 'url');
  });
  test('Amanecer y puesta: se toma la próxima después de ahora; sin dato, nada', () => {
    const past = NOW / 1000 - 3600, fut1 = NOW / 1000 + 6 * 3600, fut2 = NOW / 1000 + 30 * 3600;
    const s = W.parseOpenMeteo(Object.assign(fc(), { daily: { sunrise: [past, fut2], sunset: [fut1, fut2 + 43200] } }), null, NOW);
    const n = W.sunNext(s, NOW);
    eq(n.rise, fut2 * 1000, 'amanecer: el siguiente'); eq(n.set, fut1 * 1000, 'puesta: la siguiente');
    eq(W.sunNext(W.parseOpenMeteo(fc(), null, NOW), NOW), null, 'sin daily: nada que mostrar');
  });
  test('URL de Open-Meteo: km/h, hora unix y las variables que se usan', () => {
    const u = W.forecastUrl(CFG());
    ok(u.indexOf('latitude=37.1800&longitude=-3.6000') > 0); ok(/wind_gusts_10m/.test(u)); ok(/uv_index/.test(u)); ok(/wind_speed_unit=kmh/.test(u)); ok(/timeformat=unixtime/.test(u));
    eq(W.forecastUrl({}), '', 'sin lugar no hay URL');
    ok(/european_aqi/.test(W.airUrl(CFG())));
    ok(/daily=sunrise,sunset/.test(u), 'pide amanecer y puesta');
  });

  // ── Lectura de datos ──────────────────────────────────────────────────
  test('Open-Meteo: «ahora», horas, UV de la hora en curso y calidad del aire', () => {
    eq(SNAP.src, 'openmeteo'); eq(SNAP.t, NOW); eq(SNAP.cur.temp, 26.4); eq(SNAP.cur.gust, 25); eq(SNAP.cur.uv, 4); eq(SNAP.cur.aqi, 35);
    eq(SNAP.hours.length, 7); eq(SNAP.hours[4].gust, 62); eq(SNAP.hours[4].aqi, 85);
    let threw = false; try { W.parseOpenMeteo({}, null, NOW); } catch (e) { threw = true; } ok(threw, 'respuesta vacía = error');
  });
  test('URL JSON propia: rutas con puntos e índices, números en texto', () => {
    const j = { data: { t: '21,5', w: { avg: 18, gust: 41 } }, list: [{ rain: 0.4 }] };
    const s = W.parseGeneric(j, { temp: 'data.t', wind: 'data.w.avg', gust: 'data.w.gust', rain: 'list.0.rain' }, NOW);
    eq(s.cur.temp, 21.5); eq(s.cur.wind, 18); eq(s.cur.gust, 41); eq(s.cur.rain, 0.4); eq(s.hours.length, 0);
    let threw = false; try { W.parseGeneric(j, { gust: 'no.existe' }, NOW); } catch (e) { threw = true; } ok(threw, 'ningún dato = error');
  });
  test('manual: solo con algún valor y su hora', () => {
    eq(W.manualSnap({ temp: 20 }), null, 'sin hora');
    const s = W.manualSnap({ gust: 70, at: NOW }); eq(s.src, 'manual'); eq(s.cur.gust, 70);
  });
  test('geocodificación: nombre, detalle sin repetir y coordenadas', () => {
    const r = W.parseGeo({ results: [{ name: 'Granada', admin1: 'Andalucía', admin2: 'Granada', country: 'España', latitude: 37.18817, longitude: -3.60667 }, { name: 'X' }] });
    eq(r.length, 1); eq(r[0].detail, 'Granada, Andalucía, España'); eq(r[0].lat, 37.1882);
  });
  test('fetchSnap: errores en castellano y sin calidad del aire no se pierde la previsión', async () => {
    await rejects(W.fetchSnap({ source: 'openmeteo' }, () => null, NOW), /Falta el lugar/);
    await rejects(W.fetchSnap({ source: 'url' }, () => null, NOW), /Falta la URL/);
    await rejects(W.fetchSnap({ source: 'manual' }, () => null, NOW), /Sin valores manuales/);
    await rejects(W.fetchSnap(CFG(), async () => ({ ok: false, status: 429 }), NOW), /429/);
    const m = Object.assign(CFG({ aqiOn: true }));
    const s = await W.fetchSnap(m, async u => /air-quality/.test(u) ? { ok: false, status: 500 } : { ok: true, json: async () => fc() }, NOW);
    eq(s.cur.gust, 25); eq(s.cur.aqi, null);
  });

  // ── Resumen ───────────────────────────────────────────────────────────
  test('resumen: ráfagas MÁXIMAS en las próximas horas, con su hora', () => {
    const s = W.summary(SNAP, CFG(), NOW);
    eq(s.gustMax, 62); eq(s.gustMaxAt, (H0 + 4 * 3600) * 1000, '21:00 UTC'); eq(s.temp, 26.4); eq(s.icon, 'csun'); eq(s.stale, false);
    eq(W.summary(SNAP, Object.assign(CFG(), { horizon: 1 }), NOW).gustMax, 30, 'con 1 h solo hasta las 19:00');
    eq(W.summary(null, CFG(), NOW), null);
  });
  test('SIN DATOS DESDE HH:MM: con refresco de 15 min, a los 30 min sin dato nuevo', () => {
    eq(W.staleMins({ refresh: 15 }), 30); eq(W.staleMins({ refresh: 5 }), 15);
    ok(!W.summary(SNAP, CFG(), NOW + 29 * 60000).stale);
    const s = W.summary(SNAP, CFG(), NOW + 31 * 60000);
    ok(s.stale); eq(s.staleTxt, 'SIN DATOS DESDE ' + W.hhmm(NOW));
    ok(!W.summary(W.manualSnap({ temp: 20, at: NOW }), CFG(), NOW + 86400000).stale, 'lo manual no caduca (lleva su hora)');
  });

  // ── Avisos (previsión, informativos) ──────────────────────────────────
  test('sin umbrales de viento no hay aviso de viento (regla de oro: la cifra la pone el regidor)', () => {
    const a = W.alerts(SNAP, CFG({ storm: false, uvOn: false }), NOW);
    eq(a.length, 0);
  });
  test('ráfagas: avisa con el máximo previsto y su hora; texto con umbral para el Dashboard', () => {
    const a = W.alerts(SNAP, CFG({ gust: 50, storm: false, uvOn: false }), NOW);
    eq(a.length, 1); eq(a[0].kind, 'gust'); eq(a[0].value, 62);
    eq(a[0].short, 'RÁFAGAS 62 KM/H HACIA LAS ' + W.hhmm((H0 + 4 * 3600) * 1000));
    ok(/umbral 50$/.test(a[0].text));
    eq(W.alerts(SNAP, CFG({ gust: 70, storm: false, uvOn: false }), NOW).length, 0);
  });
  test('«ahora» si es inminente; viento medio, lluvia, calor, tormenta, UV y aire', () => {
    const a = W.alerts(SNAP, CFG({ wind: 12, rain: 1, heat: 26, uv: 4, aqiOn: true, aqi: 80 }), NOW);
    const k = a.map(x => x.kind).join();
    eq(k, 'wind,rain,heat,storm,uv,aqi');
    eq(a.find(x => x.kind === 'heat').short, 'CALOR 26 °C AHORA');
    ok(/^TORMENTA HACIA LAS/.test(a.find(x => x.kind === 'storm').short));
    eq(a.find(x => x.kind === 'uv').short, 'ÍNDICE UV 4 (MODERADO) AHORA');
    ok(/MUY MALA/.test(a.find(x => x.kind === 'aqi').short));
    eq(W.alerts(SNAP, CFG({ storm: false, uvOn: false, aqiOn: false }), NOW).length, 0, 'apagados');
  });
  test('histéresis: un aviso activo no se apaga hasta bajar del umbral menos el margen', () => {
    const s = W.parseOpenMeteo(fc({ gust: [20, 25, 30, 47, 46, 40, 30] }), null, NOW);
    eq(W.alerts(s, CFG({ gust: 50, storm: false, uvOn: false }), NOW).length, 0, 'nuevo: 47 < 50');
    eq(W.alerts(s, CFG({ gust: 50, storm: false, uvOn: false }), NOW, ['gust']).length, 1, 'ya activo: 47 ≥ 45');
  });
  test('«Visto»: no insiste; vuelve si empeora; al desaparecer se olvida', () => {
    const a = W.alerts(SNAP, CFG({ gust: 50, storm: false, uvOn: false }), NOW);
    let acks = W.ack({}, a[0]);
    eq(W.pendingAlerts(a, acks).length, 0);
    const worse = [Object.assign({}, a[0], { value: 67 })];
    eq(W.pendingAlerts(worse, acks).length, 1, '+5 km/h vuelve a avisar');
    eq(Object.keys(W.pruneAcks(acks, [])).length, 0);
  });

  // ── Textos ────────────────────────────────────────────────────────────
  test('píldora y cinta: sin umbrales; «SIN DATOS DESDE» cuando caduca', () => {
    const s = W.summary(SNAP, CFG(), NOW);
    eq(W.pillText(s), '26° · VIENTO 12 · RÁF. MÁX 62 KM/H');
    const a = W.alerts(SNAP, CFG({ gust: 50, storm: false, uvOn: false }), NOW);
    const t = W.tickerList(s, a);
    eq(t.length, 2); eq(t[0].level, 'ok'); ok(/RÁFAGAS MÁX 62 KM\/H/.test(t[0].text)); eq(t[1].level, 'warn'); ok(/^PREVISIÓN · RÁFAGAS 62/.test(t[1].text));
    ok(!/UMBRAL/.test(t[1].text));
    const st = W.summary(SNAP, CFG(), NOW + 3600000);
    eq(W.pillText(st), st.staleTxt); eq(W.tickerList(st, a)[0].text, 'EL TIEMPO: ' + st.staleTxt);
  });
  test('cielo, UV y calidad del aire en palabras', () => {
    eq(W.sky(0).icon, 'sun'); eq(W.sky(95).icon, 'storm'); eq(W.sky(99).text, 'Tormenta con granizo'); eq(W.sky(63).text, 'Lluvia');
    eq(W.uvText(8), 'muy alto'); eq(W.uvText(11), 'extremo'); eq(W.aqiText(85), 'muy mala'); eq(W.aqiText(15), 'buena');
  });
  test('la cinta de Backstage incluye el tiempo y sus avisos (si está activado en la cinta)', () => {
    const s = W.summary(SNAP, CFG(), NOW), a = W.alerts(SNAP, CFG({ gust: 50 }), NOW);
    const items = V.tickerItems(null, null, 0, W.tickerList(s, a));
    eq(items.length, 0, 'sin evento no hay cinta');
    const st = { event: { nombre: 'x', fechaInicio: '2026-07-10', fechaFin: '2026-07-10', dayCutoff: '06:00' }, escenarios: [], artists: [] };
    const it = V.tickerItems(st, { ticker: { delays: false, hitos: false, meteo: true } }, 0, W.tickerList(s, a)).filter(x => x.kind === 'meteo');
    ok(it.length >= 2); eq(V.tickerItems(st, { ticker: { delays: false, hitos: false, meteo: false } }, 0, W.tickerList(s, a)).length, 0);
  });

  // ── Ejecutar ──────────────────────────────────────────────────────────
  (async () => {
    let pass = 0; const fails = [];
    for (const [n, f] of tests) { try { await f(); pass++; } catch (e) { fails.push([n, e.message]); } }
    const summary = 'Meteo: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
    if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); if (fails.length) process.exitCode = 1; }
    else {
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const box = document.createElement('div');
      box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
      document.getElementById('out').appendChild(box);
      window.__TEST_METEO__ = { pass, total: tests.length, fails };
    }
  })();
})();
