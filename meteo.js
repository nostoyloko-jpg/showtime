/* Showtime — meteo.js · El tiempo (2e-B)
 *
 * Fuentes: Open-Meteo (previsión de un modelo, gratis para uso no comercial, CC BY 4.0) · URL JSON propia
 * (p. ej. el anemómetro o la estación del evento) · valores manuales.
 *
 * REGLA DE ORO: los avisos son PREVISIÓN e INFORMATIVOS. No son avisos oficiales, no mandan mensajes a escena,
 * no tocan Confidence ni los horarios. Los umbrales los pone el regidor (viento y ráfagas, VACÍOS por defecto:
 * la cifra sale del plan de autoprotección o del fabricante de la estructura). Sin umbral escrito, no hay aviso.
 * Si los datos se quedan viejos se dice claro: «SIN DATOS DESDE HH:MM».
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;

  const OM_FC = 'https://api.open-meteo.com/v1/forecast';
  const OM_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  const OM_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  const AEMET_URL = 'https://www.aemet.es/es/eltiempo/prediccion/avisos';
  const ATTRIB = 'Data by Open-Meteo.com (CC BY 4.0) · Calidad del aire: Copernicus Atmosphere Monitoring Service';

  const SOURCES = ['openmeteo', 'url', 'manual'];
  const REFRESH = [5, 10, 15, 30];          // minutos
  const HORIZON = [1, 2, 3, 6, 12];         // horas de previsión que se miran para los avisos
  const AQI_TH = [60, 80, 100];             // Mala · Muy mala · Extremadamente mala (índice europeo)
  const DEFAULT_METEO = {
    on: false, source: 'openmeteo', place: '', lat: null, lon: null,
    url: '', map: { temp: '', rain: '', wind: '', gust: '', code: '' },
    manual: { temp: null, rain: null, wind: null, gust: null, uv: null, at: null },
    th: { wind: null, gust: null, rain: null, heat: null, storm: true, uvOn: true, uv: 8, aqiOn: false, aqi: 80 },
    horizon: 3, refresh: 15
  };
  // Margen para no encender y apagar un aviso cada vez que llega un dato (histéresis) y para volver a avisar si empeora
  const HYST = { gust: 5, wind: 5, rain: 1, heat: 1, uv: 1, aqi: 10, storm: 0 };
  const WORSE = { gust: 5, wind: 5, rain: 2, heat: 2, uv: 1, aqi: 10, storm: Infinity };

  // ── Ajustes ──────────────────────────────────────────────────────────
  function num(v, min, max) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
  }
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function pick(v, list, d) { return list.indexOf(Number(v)) >= 0 ? Number(v) : d; }

  function normMeteo(m) {
    const s = m || {}, D = DEFAULT_METEO, th = s.th || {}, mp = s.map || {}, mn = s.manual || {};
    return {
      on: s.on === true,
      source: SOURCES.indexOf(s.source) >= 0 ? s.source : D.source,
      place: str(s.place, 120),
      lat: num(s.lat, -90, 90), lon: num(s.lon, -180, 180),
      url: /^https:\/\//i.test(str(s.url, 500)) ? str(s.url, 500) : '',
      map: { temp: str(mp.temp, 120), rain: str(mp.rain, 120), wind: str(mp.wind, 120), gust: str(mp.gust, 120), code: str(mp.code, 120) },
      manual: { temp: num(mn.temp, -60, 70), rain: num(mn.rain, 0, 500), wind: num(mn.wind, 0, 400), gust: num(mn.gust, 0, 400), uv: num(mn.uv, 0, 20),
        at: Number.isFinite(mn.at) ? mn.at : null },
      th: {
        wind: num(th.wind, 1, 400), gust: num(th.gust, 1, 400), rain: num(th.rain, 0.1, 500), heat: num(th.heat, -60, 70),
        storm: th.storm !== false, uvOn: th.uvOn !== false, uv: num(th.uv, 1, 20) === null ? D.th.uv : num(th.uv, 1, 20),
        aqiOn: th.aqiOn === true, aqi: pick(th.aqi, AQI_TH, D.th.aqi)
      },
      horizon: pick(s.horizon, HORIZON, D.horizon),
      refresh: pick(s.refresh, REFRESH, D.refresh)
    };
  }
  /** Lo que se emite a los dispositivos de Staff: sin la URL propia ni su mapeo (pueden llevar una clave privada). */
  function publicMeteo(m) { const o = normMeteo(m); o.url = ''; o.map = { temp: '', rain: '', wind: '', gust: '', code: '' }; return o; }

  /** Minutos sin dato nuevo a partir de los cuales se avisa «SIN DATOS DESDE». */
  function staleMins(cfg) { const r = normMeteo(cfg).refresh; return Math.max(2 * r, r + 10); }

  // ── Fuentes ──────────────────────────────────────────────────────────
  const HOURLY = 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,weather_code,uv_index';
  const CURRENT = 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,weather_code';
  function ll(cfg) { return 'latitude=' + cfg.lat.toFixed(4) + '&longitude=' + cfg.lon.toFixed(4); }
  function forecastUrl(m) {
    const c = normMeteo(m); if (c.lat === null || c.lon === null) return '';
    return OM_FC + '?' + ll(c) + '&current=' + CURRENT + '&hourly=' + HOURLY + '&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT&past_hours=1&forecast_hours=24';
  }
  function airUrl(m) {
    const c = normMeteo(m); if (c.lat === null || c.lon === null) return '';
    return OM_AQ + '?' + ll(c) + '&current=european_aqi&hourly=european_aqi&timeformat=unixtime&timezone=GMT&forecast_hours=24';
  }
  function geoUrl(name) { return OM_GEO + '?name=' + encodeURIComponent(String(name || '').trim()) + '&count=6&language=es&format=json'; }

  function val(a, i) { const v = a && a[i]; return Number.isFinite(v) ? v : null; }
  function fin(v) { return Number.isFinite(v) ? v : null; }

  /** Respuesta de Open-Meteo (previsión + calidad del aire opcional) → dato normalizado. */
  function parseOpenMeteo(fc, aq, fetchedMs) {
    if (!fc || (!fc.current && !fc.hourly)) throw new Error('Open-Meteo no ha devuelto datos');
    const H = fc.hourly || {}, times = Array.isArray(H.time) ? H.time : [];
    const A = (aq && aq.hourly) || {}, aqT = Array.isArray(A.time) ? A.time : [];
    const aqiAt = {};
    aqT.forEach((t, i) => { const v = val(A.european_aqi, i); if (v !== null) aqiAt[t] = v; });
    const hours = times.map((t, i) => ({
      t: t * 1000, temp: val(H.temperature_2m, i), rain: val(H.precipitation, i), wind: val(H.wind_speed_10m, i),
      gust: val(H.wind_gusts_10m, i), code: val(H.weather_code, i), uv: val(H.uv_index, i), aqi: aqiAt[t] !== undefined ? aqiAt[t] : null
    }));
    const c = fc.current || {};
    const cur = { t: Number.isFinite(c.time) ? c.time * 1000 : fetchedMs, temp: fin(c.temperature_2m), rain: fin(c.precipitation), wind: fin(c.wind_speed_10m),
      gust: fin(c.wind_gusts_10m), code: fin(c.weather_code), uv: null, aqi: aq && aq.current ? fin(aq.current.european_aqi) : null };
    // UV de la hora en curso (Open-Meteo lo da por horas)
    const h0 = hours.filter(h => h.t <= cur.t).pop();
    if (h0) { cur.uv = h0.uv; if (cur.aqi === null) cur.aqi = h0.aqi; }
    return { src: 'openmeteo', t: fetchedMs, cur, hours };
  }

  /** Lee «a.b.0.c» de un JSON. */
  function getPath(obj, path) {
    if (!path) return null;
    let o = obj;
    for (const k of String(path).split('.')) { if (o === null || o === undefined) return null; o = o[/^\d+$/.test(k) && Array.isArray(o) ? Number(k) : k]; }
    const n = typeof o === 'string' ? Number(o.replace(',', '.')) : o;
    return Number.isFinite(n) ? n : null;
  }
  /** URL JSON propia (estación del evento) → dato normalizado (solo «ahora»). */
  function parseGeneric(json, map, fetchedMs) {
    const m = map || {};
    const cur = { t: fetchedMs, temp: getPath(json, m.temp), rain: getPath(json, m.rain), wind: getPath(json, m.wind), gust: getPath(json, m.gust),
      code: getPath(json, m.code), uv: null, aqi: null };
    if ([cur.temp, cur.rain, cur.wind, cur.gust].every(v => v === null)) throw new Error('No se ha encontrado ningún dato con las rutas indicadas');
    return { src: 'url', t: fetchedMs, cur, hours: [] };
  }
  /** Valores escritos a mano por el regidor. */
  function manualSnap(manual) {
    const m = normMeteo({ manual }).manual;
    if (m.at === null || [m.temp, m.rain, m.wind, m.gust, m.uv].every(v => v === null)) return null;
    return { src: 'manual', t: m.at, cur: { t: m.at, temp: m.temp, rain: m.rain, wind: m.wind, gust: m.gust, code: null, uv: m.uv, aqi: null }, hours: [] };
  }

  /** Pide el dato según la fuente. `fetchFn` = fetch del navegador. Devuelve el dato o lanza un Error en castellano. */
  async function fetchSnap(m, fetchFn, nowMs) {
    const c = normMeteo(m), now = nowMs || Date.now();
    if (c.source === 'manual') { const s = manualSnap(c.manual); if (!s) throw new Error('Sin valores manuales'); return s; }
    const get = async (url) => {
      let ctl = null, to = null;
      try { ctl = new AbortController(); to = setTimeout(() => ctl.abort(), 15000); } catch (e) {}
      try {
        const r = await fetchFn(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' });
        if (!r.ok) throw new Error('El servidor respondió ' + r.status);
        return await r.json();
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('Sin respuesta (15 s)');
        if (e && /JSON/i.test(e.message)) throw new Error('La respuesta no es JSON');
        if (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message)) throw new Error('Sin conexión o el servidor no permite leerlo desde el navegador');
        throw e;
      } finally { if (to) clearTimeout(to); }
    };
    if (c.source === 'url') {
      if (!c.url) throw new Error('Falta la URL (https://…)');
      return parseGeneric(await get(c.url), c.map, now);
    }
    if (c.lat === null || c.lon === null) throw new Error('Falta el lugar del evento');
    const fc = await get(forecastUrl(c));
    let aq = null;
    if (c.th.aqiOn) { try { aq = await get(airUrl(c)); } catch (e) { aq = null; } }   // sin calidad del aire no se pierde lo demás
    return parseOpenMeteo(fc, aq, now);
  }

  /** Busca lugares por nombre (geocodificación de Open-Meteo) → [{ name, detail, lat, lon }]. */
  function parseGeo(json) {
    return ((json && json.results) || []).filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).map(r => ({
      name: r.name || '', detail: [r.admin2, r.admin1, r.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '),
      lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4
    }));
  }

  // ── Textos ───────────────────────────────────────────────────────────
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function r0(v) { return Math.round(v); }
  function r1(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }
  /** Cielo según el código WMO → { icon, text }. */
  function sky(code) {
    const c = Number(code);
    if (!Number.isFinite(c)) return { icon: 'thermo', text: '' };
    if (c === 0) return { icon: 'sun', text: 'Despejado' };
    if (c === 1) return { icon: 'sun', text: 'Casi despejado' };
    if (c === 2) return { icon: 'csun', text: 'Parcialmente nuboso' };
    if (c === 3) return { icon: 'cloud', text: 'Cubierto' };
    if (c === 45 || c === 48) return { icon: 'cloud', text: 'Niebla' };
    if (c >= 51 && c <= 57) return { icon: 'rain', text: 'Llovizna' };
    if (c >= 61 && c <= 67) return { icon: 'rain', text: 'Lluvia' };
    if (c >= 71 && c <= 77) return { icon: 'snow', text: 'Nieve' };
    if (c >= 80 && c <= 82) return { icon: 'rain', text: 'Chubascos' };
    if (c === 85 || c === 86) return { icon: 'snow', text: 'Chubascos de nieve' };
    if (c === 95) return { icon: 'storm', text: 'Tormenta' };
    if (c === 96 || c === 99) return { icon: 'storm', text: 'Tormenta con granizo' };
    return { icon: 'cloud', text: '' };
  }
  function isStorm(code) { return code === 95 || code === 96 || code === 99; }
  function uvText(v) { return v >= 11 ? 'extremo' : v >= 8 ? 'muy alto' : v >= 6 ? 'alto' : v >= 3 ? 'moderado' : 'bajo'; }
  function aqiText(v) { return v > 100 ? 'extremadamente mala' : v > 80 ? 'muy mala' : v > 60 ? 'mala' : v > 40 ? 'moderada' : v > 20 ? 'razonable' : 'buena'; }

  // ── Resumen y avisos ─────────────────────────────────────────────────
  /** Puntos que se miran: «ahora» + las horas de la previsión hasta `horizon` horas. */
  function windowPoints(snap, horizonH, nowMs) {
    const out = [Object.assign({}, snap.cur, { now: true })];
    const from = nowMs - 3600000, to = nowMs + horizonH * 3600000;
    (snap.hours || []).forEach(h => { if (h.t > from && h.t <= to) out.push(h); });
    return out;
  }
  function maxOf(points, k) {
    let best = null;
    points.forEach(p => { const v = p[k]; if (v !== null && v !== undefined && (best === null || v > best.v)) best = { v, t: p.now ? null : p.t }; });
    return best;
  }

  /**
   * Resumen para tarjeta, píldora y cinta.
   * → null (sin dato) o { src, at, stale, staleTxt, temp, rain, wind, gust, gustMax, gustMaxAt, uv, uvMax, aqi, code, icon, sky }
   */
  function summary(snap, m, nowMs) {
    if (!snap || !snap.cur) return null;
    const c = normMeteo(m), now = nowMs || Date.now();
    const pts = windowPoints(snap, c.horizon, now);
    const g = maxOf(pts, 'gust'), u = maxOf(pts, 'uv');
    const stale = snap.src !== 'manual' && now - snap.t > staleMins(c) * 60000;
    const s = sky(snap.cur.code);
    return {
      src: snap.src, at: snap.t, stale, staleTxt: stale ? 'SIN DATOS DESDE ' + hhmm(snap.t) : '',
      temp: snap.cur.temp, rain: snap.cur.rain, wind: snap.cur.wind, gust: snap.cur.gust,
      gustMax: g ? g.v : null, gustMaxAt: g ? g.t : null, uv: snap.cur.uv, uvMax: u ? u.v : null, aqi: snap.cur.aqi,
      code: snap.cur.code, icon: s.icon, sky: s.text, horizon: c.horizon
    };
  }

  function whenTxt(t, nowMs) { return t === null || t === undefined || t - nowMs < 20 * 60000 ? 'AHORA' : 'HACIA LAS ' + hhmm(t); }

  /**
   * Avisos de PREVISIÓN según los umbrales del regidor. `prev` = tipos que ya estaban activos (histéresis).
   * → [{ kind: 'gust'|'wind'|'rain'|'heat'|'storm'|'uv'|'aqi', value, at, th, text, short }]
   *   text: para el Dashboard (con umbral) · short: para la píldora y la cinta (sin umbral).
   */
  function alerts(snap, m, nowMs, prev) {
    if (!snap || !snap.cur) return [];
    const c = normMeteo(m), now = nowMs || Date.now(), was = new Set(prev || []);
    const pts = windowPoints(snap, c.horizon, now), out = [];
    const lim = (k, th) => th === null ? null : (was.has(k) ? th - HYST[k] : th);
    const check = (kind, key, th, fmt) => {
      const l = lim(kind, th); if (l === null) return;
      const mx = maxOf(pts, key);
      if (mx && mx.v >= l) out.push(Object.assign({ kind, value: mx.v, at: mx.t, th }, fmt(mx.v, whenTxt(mx.t, now))));
    };
    check('gust', 'gust', c.th.gust, (v, w) => ({ short: 'RÁFAGAS ' + r0(v) + ' KM/H ' + w, text: 'Ráfagas ' + r0(v) + ' km/h ' + w.toLowerCase() + ' · umbral ' + r0(c.th.gust) }));
    check('wind', 'wind', c.th.wind, (v, w) => ({ short: 'VIENTO ' + r0(v) + ' KM/H ' + w, text: 'Viento medio ' + r0(v) + ' km/h ' + w.toLowerCase() + ' · umbral ' + r0(c.th.wind) }));
    check('rain', 'rain', c.th.rain, (v, w) => ({ short: 'LLUVIA ' + r1(v) + ' MM/H ' + w, text: 'Lluvia ' + r1(v) + ' mm/h ' + w.toLowerCase() + ' · umbral ' + r1(c.th.rain) }));
    check('heat', 'temp', c.th.heat, (v, w) => ({ short: 'CALOR ' + r0(v) + ' °C ' + w, text: 'Calor ' + r0(v) + ' °C ' + w.toLowerCase() + ' · umbral ' + r0(c.th.heat) }));
    if (c.th.storm) {
      const st = pts.find(p => isStorm(p.code));
      if (st) { const w = whenTxt(st.now ? null : st.t, now); out.push({ kind: 'storm', value: st.code, at: st.now ? null : st.t, th: null, short: 'TORMENTA ' + w, text: sky(st.code).text + ' ' + w.toLowerCase() }); }
    }
    if (c.th.uvOn) check('uv', 'uv', c.th.uv, (v, w) => ({ short: 'ÍNDICE UV ' + r0(v) + ' (' + uvText(v).toUpperCase() + ') ' + w, text: 'Índice UV ' + r0(v) + ' (' + uvText(v) + ') ' + w.toLowerCase() + ' · umbral ' + r0(c.th.uv) }));
    if (c.th.aqiOn) check('aqi', 'aqi', c.th.aqi, (v, w) => ({ short: 'CALIDAD DEL AIRE ' + aqiText(v).toUpperCase() + ' ' + w, text: 'Calidad del aire ' + aqiText(v) + ' (' + r0(v) + ') ' + w.toLowerCase() }));
    return out;
  }

  /** «Visto» del regidor: un aviso visto no insiste; vuelve si empeora. Los que ya no están se olvidan. */
  function pendingAlerts(list, acks) {
    return (list || []).filter(a => { const v = acks && acks[a.kind]; return v === undefined || v === null || a.value >= v + WORSE[a.kind]; });
  }
  function ack(acks, a) { const o = Object.assign({}, acks || {}); o[a.kind] = a.value; return o; }
  function pruneAcks(acks, list) {
    const on = new Set((list || []).map(a => a.kind)), o = {};
    Object.keys(acks || {}).forEach(k => { if (on.has(k)) o[k] = acks[k]; });
    return o;
  }

  /** Píldora de la Live Manager: una línea corta. */
  function pillText(sum) {
    if (!sum) return '';
    if (sum.stale) return sum.staleTxt;
    const p = [];
    if (sum.temp !== null) p.push(r0(sum.temp) + '°');
    if (sum.wind !== null) p.push('VIENTO ' + r0(sum.wind));
    if (sum.gustMax !== null) p.push('RÁF. MÁX ' + r0(sum.gustMax) + ' KM/H');
    else if (sum.gust !== null) p.push('RÁF. ' + r0(sum.gust) + ' KM/H');
    if (sum.rain !== null && sum.rain > 0) p.push('LLUVIA ' + r1(sum.rain));
    return p.join(' · ');
  }

  /** Avisos de la cinta (Backstage): el tiempo de ahora y los avisos (sin umbrales: es para camerinos). */
  function tickerList(sum, list) {
    if (!sum) return [];
    if (sum.stale) return [{ kind: 'meteo', level: 'warn', text: 'EL TIEMPO: ' + sum.staleTxt }];
    const p = [];
    if (sum.temp !== null) p.push(r0(sum.temp) + ' °C');
    if (sum.sky) p.push(sum.sky.toUpperCase());
    if (sum.rain !== null) p.push('LLUVIA ' + r1(sum.rain) + ' MM/H');
    if (sum.wind !== null) p.push('VIENTO ' + r0(sum.wind) + ' KM/H');
    if (sum.gustMax !== null) p.push('RÁFAGAS MÁX ' + r0(sum.gustMax) + ' KM/H');
    const out = p.length ? [{ kind: 'meteo', level: 'ok', text: p.join(' · ') }] : [];
    (list || []).forEach(a => out.push({ kind: 'meteo', level: 'warn', text: 'PREVISIÓN · ' + a.short }));
    return out;
  }

  const API = { OM_FC, OM_AQ, OM_GEO, AEMET_URL, ATTRIB, SOURCES, REFRESH, HORIZON, AQI_TH, DEFAULT_METEO,
    normMeteo, publicMeteo, staleMins, forecastUrl, airUrl, geoUrl, parseOpenMeteo, getPath, parseGeneric, manualSnap, fetchSnap, parseGeo,
    sky, uvText, aqiText, hhmm, summary, alerts, pendingAlerts, ack, pruneAcks, pillText, tickerList, fmt1: r1 };
  if (isNode) module.exports = API;
  else root.ShowtimeMeteo = API;
})(typeof window !== 'undefined' ? window : globalThis);
