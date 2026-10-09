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
  // Idioma (Fase 2): textos en el idioma activo (lo manda el Panel). lang 'es' para lo que queda en el log.
  const I18 = () => root.ShowtimeI18n || (isNode ? (() => { try { return require('./i18n.js'); } catch (e) { return null; } })() : null);
  const tx = (s, v, l) => { const I = I18(); return I ? I.tx(s, v, l) : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s); };
  const enOn = l => { const I = I18(); return (l || (I ? I.getLang() : 'es')) === 'en'; };

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
    on: true, source: 'openmeteo', place: '', lat: null, lon: null,
    url: '', map: { temp: '', rain: '', wind: '', gust: '', code: '' },
    manual: { temp: null, rain: null, wind: null, gust: null, uv: null, at: null },
    th: { wind: null, gust: null, rain: null, heat: null, storm: true, uvOn: true, uv: 8, aqiOn: false, aqi: 80 },
    horizon: 3, refresh: 15, units: 'metric'
  };
  // ── Unidades (dec. 107): por dentro todo en métrico (°C, km/h, mm/h); se enseña y se escribe en la unidad elegida ──
  const UNITS = ['metric', 'imperial'];
  const imp = u => u === 'imperial';
  /** Métrico → unidad elegida. kind: 'temp' | 'wind' (también ráfagas) | 'rain'. */
  function toU(kind, v, units) {
    if (v === null || v === undefined || !imp(units)) return v;
    return kind === 'temp' ? v * 9 / 5 + 32 : kind === 'rain' ? v / 25.4 : v / 1.609344;
  }
  /** Unidad elegida → métrico (para guardar lo que escribe el regidor). */
  function fromU(kind, v, units) {
    if (v === null || v === undefined || !imp(units)) return v;
    return kind === 'temp' ? (v - 32) * 5 / 9 : kind === 'rain' ? v * 25.4 : v * 1.609344;
  }
  function unitOf(kind, units) { return kind === 'temp' ? (imp(units) ? '°F' : '°C') : kind === 'rain' ? (imp(units) ? 'in/h' : 'mm/h') : (imp(units) ? 'mph' : 'km/h'); }
  /** Solo la cifra, en la unidad elegida: temperatura y viento sin decimales; lluvia con 1 (mm) o 2 (in). */
  function numU(kind, v, units, l) {
    if (v === null || v === undefined) return '—';
    const x = toU(kind, v, units);
    if (kind !== 'rain') return String(Math.round(x));
    const d = imp(units) ? 100 : 10, s = (Math.round(x * d) / d).toString();
    return enOn(l) ? s : s.replace('.', ',');
  }
  /** Cifra y unidad («45 km/h», «28 mph», «0,05 in/h»; up = en mayúsculas para la cinta). */
  function fmtU(kind, v, units, l, up) { const u = unitOf(kind, units); return numU(kind, v, units, l) + ' ' + (up ? u.toUpperCase() : u); }
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
      on: s.on !== false,   // el tiempo sale por defecto; solo se oculta si se apaga en Configuración › Meteo
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
      refresh: pick(s.refresh, REFRESH, D.refresh),
      units: UNITS.indexOf(s.units) >= 0 ? s.units : 'metric'
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
    return OM_FC + '?' + ll(c) + '&current=' + CURRENT + '&hourly=' + HOURLY + '&daily=sunrise,sunset&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT&past_hours=1&forecast_hours=24';
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
    // Amanecer y puesta de sol (unix → ms), si Open-Meteo los manda
    const D = fc.daily || {}, toMs = a => (Array.isArray(a) ? a.map(v => (Number.isFinite(v) ? v * 1000 : null)).filter(v => v !== null) : []);
    const sun = (Array.isArray(D.sunrise) || Array.isArray(D.sunset)) ? { rise: toMs(D.sunrise), set: toMs(D.sunset) } : null;
    return { src: 'openmeteo', t: fetchedMs, cur, hours, sun };
  }
  /** Próximo amanecer y próxima puesta después de «ahora» (ms), o null si no hay dato. */
  function sunNext(snap, nowMs) {
    const s = snap && snap.sun; if (!s) return null;
    const now = nowMs || Date.now();
    const next = a => { const f = (a || []).filter(t => t > now).sort((x, y) => x - y); return f.length ? f[0] : null; };
    const rise = next(s.rise), set = next(s.set);
    return rise === null && set === null ? null : { rise, set };
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
  function r1(v, l) { const s = (Math.round(v * 10) / 10).toString(); return enOn(l) ? s : s.replace('.', ','); }
  /** Cielo según el código WMO → { icon, text }. */
  function sky(code, lang) {
    const c = Number(code);
    const S = (icon, text) => ({ icon, text: text ? tx(text, null, lang) : '' });
    if (!Number.isFinite(c)) return S('thermo', '');
    if (c === 0) return S('sun', 'Despejado');
    if (c === 1) return S('sun', 'Casi despejado');
    if (c === 2) return S('csun', 'Parcialmente nuboso');
    if (c === 3) return S('cloud', 'Cubierto');
    if (c === 45 || c === 48) return S('cloud', 'Niebla');
    if (c >= 51 && c <= 57) return S('rain', 'Llovizna');
    if (c >= 61 && c <= 67) return S('rain', 'Lluvia');
    if (c >= 71 && c <= 77) return S('snow', 'Nieve');
    if (c >= 80 && c <= 82) return S('rain', 'Chubascos');
    if (c === 85 || c === 86) return S('snow', 'Chubascos de nieve');
    if (c === 95) return S('storm', 'Tormenta');
    if (c === 96 || c === 99) return S('storm', 'Tormenta con granizo');
    return S('cloud', '');
  }
  function isStorm(code) { return code === 95 || code === 96 || code === 99; }
  function uvText(v, l) { return tx(v >= 11 ? 'extremo' : v >= 8 ? 'muy alto' : v >= 6 ? 'alto' : v >= 3 ? 'moderado' : 'bajo', null, l); }
  function aqiText(v, l) { return tx(v > 100 ? 'extremadamente mala' : v > 80 ? 'muy mala' : v > 60 ? 'mala' : v > 40 ? 'moderada' : v > 20 ? 'razonable' : 'buena', null, l); }

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
    // Puesta de sol de HOY, solo si aún no ha ocurrido (de noche no ocupa sitio)
    const sn = sunNext(snap, now), sameDay = sn && sn.set !== null && new Date(sn.set).toDateString() === new Date(now).toDateString();
    return {
      sunset: sameDay ? sn.set : null,
      src: snap.src, at: snap.t, stale, staleTxt: stale ? tx('SIN DATOS DESDE {h}', { h: hhmm(snap.t) }) : '',
      temp: snap.cur.temp, rain: snap.cur.rain, wind: snap.cur.wind, gust: snap.cur.gust,
      gustMax: g ? g.v : null, gustMaxAt: g ? g.t : null, uv: snap.cur.uv, uvMax: u ? u.v : null, aqi: snap.cur.aqi,
      code: snap.cur.code, icon: s.icon, sky: s.text, horizon: c.horizon, units: c.units
    };
  }

  function whenTxt(t, nowMs, l) { return t === null || t === undefined || t - nowMs < 20 * 60000 ? tx('AHORA', null, l) : tx('HACIA LAS {h}', { h: hhmm(t) }, l); }

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
    // short: píldora y cinta · text: Dashboard (con umbral) · textEs: el mismo en español, para el log del evento
    const check = (kind, key, th, fmt) => {
      const l = lim(kind, th); if (l === null) return;
      const mx = maxOf(pts, key);
      if (mx && mx.v >= l) {
        const ui = fmt(mx.v, whenTxt(mx.t, now), undefined), es = fmt(mx.v, whenTxt(mx.t, now, 'es'), 'es');
        out.push(Object.assign({ kind, value: mx.v, at: mx.t, th }, ui, { textEs: es.text }));
      }
    };
    // Cifras en la unidad elegida (dec. 107): «Ráfagas 45 km/h …» / «Gusts 28 mph …». El umbral, igual.
    const U = c.units, F = (k, v, L, up) => fmtU(k, v, U, L, up);
    check('gust', 'gust', c.th.gust, (v, w, L) => ({ short: tx('RÁFAGAS {_v} {w}', { _v: F('wind', v, L, true), w }, L), text: tx('Ráfagas {_v} {_n} {w} · umbral {_u}', { _v: numU('wind', v, U, L), _n: unitOf('wind', U), w: w.toLowerCase(), _u: F('wind', c.th.gust, L) }, L) }));
    check('wind', 'wind', c.th.wind, (v, w, L) => ({ short: tx('VIENTO {_v} {w}', { _v: F('wind', v, L, true), w }, L), text: tx('Viento medio {_v} {_n} {w} · umbral {_u}', { _v: numU('wind', v, U, L), _n: unitOf('wind', U), w: w.toLowerCase(), _u: F('wind', c.th.wind, L) }, L) }));
    check('rain', 'rain', c.th.rain, (v, w, L) => ({ short: tx('LLUVIA {_v} {w}', { _v: F('rain', v, L, true), w }, L), text: tx('Lluvia {_v} {_n} {w} · umbral {_u}', { _v: numU('rain', v, U, L), _n: unitOf('rain', U), w: w.toLowerCase(), _u: F('rain', c.th.rain, L) }, L) }));
    check('heat', 'temp', c.th.heat, (v, w, L) => ({ short: tx('CALOR {_v} {w}', { _v: F('temp', v, L, true), w }, L), text: tx('Calor {_v} {_n} {w} · umbral {_u}', { _v: numU('temp', v, U, L), _n: unitOf('temp', U), w: w.toLowerCase(), _u: F('temp', c.th.heat, L) }, L) }));
    if (c.th.storm) {
      const st = pts.find(p => isStorm(p.code));
      if (st) {
        const at = st.now ? null : st.t, w = whenTxt(at, now), wEs = whenTxt(at, now, 'es');
        out.push({ kind: 'storm', value: st.code, at, th: null, short: tx('TORMENTA {w}', { w }), text: sky(st.code).text + ' ' + w.toLowerCase(), textEs: sky(st.code, 'es').text + ' ' + wEs.toLowerCase() });
      }
    }
    if (c.th.uvOn) check('uv', 'uv', c.th.uv, (v, w, L) => ({ short: tx('ÍNDICE UV {v} ({t}) {w}', { v: r0(v), t: uvText(v, L).toUpperCase(), w }, L), text: tx('Índice UV {v} ({t}) {w} · umbral {u}', { v: r0(v), t: uvText(v, L), w: w.toLowerCase(), u: r0(c.th.uv) }, L) }));
    if (c.th.aqiOn) check('aqi', 'aqi', c.th.aqi, (v, w, L) => ({ short: tx('CALIDAD DEL AIRE {t} {w}', { t: aqiText(v, L).toUpperCase(), w }, L), text: tx('Calidad del aire {t} ({v}) {w}', { t: aqiText(v, L), v: r0(v), w: w.toLowerCase() }, L) }));
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
    const p = [], U = sum.units;
    if (sum.temp !== null) p.push(numU('temp', sum.temp, U) + '°');
    if (sum.wind !== null) p.push(tx('VIENTO {v}', { v: numU('wind', sum.wind, U) }));
    if (sum.gustMax !== null) p.push(tx('RÁF. MÁX {_v}', { _v: fmtU('wind', sum.gustMax, U, undefined, true) }));
    else if (sum.gust !== null) p.push(tx('RÁF. {_v}', { _v: fmtU('wind', sum.gust, U, undefined, true) }));
    if (sum.rain !== null && sum.rain > 0) p.push(tx('LLUVIA {v}', { v: numU('rain', sum.rain, U) }));
    if (sum.sunset) p.push(tx('PUESTA {h}', { h: hhmm(sum.sunset) }));
    return p.join(' · ');
  }

  /** Avisos de la cinta (Backstage): el tiempo de ahora y los avisos (sin umbrales: es para camerinos). */
  function tickerList(sum, list) {
    if (!sum) return [];
    if (sum.stale) return [{ kind: 'meteo', level: 'warn', text: tx('EL TIEMPO: {s}', { s: sum.staleTxt }) }];
    const p = [], U = sum.units;
    if (sum.temp !== null) p.push(fmtU('temp', sum.temp, U, undefined, true));
    if (sum.sky) p.push(sum.sky.toUpperCase());
    if (sum.rain !== null) p.push(tx('LLUVIA {_v}', { _v: fmtU('rain', sum.rain, U, undefined, true) }));
    if (sum.wind !== null) p.push(tx('VIENTO {_v}', { _v: fmtU('wind', sum.wind, U, undefined, true) }));
    if (sum.gustMax !== null) p.push(tx('RÁFAGAS MÁX {_v}', { _v: fmtU('wind', sum.gustMax, U, undefined, true) }));
    const out = p.length ? [{ kind: 'meteo', level: 'ok', text: p.join(' · ') }] : [];
    if (sum.sunset) out.push({ kind: 'meteo', level: 'ok', text: tx('PUESTA DE SOL {h}', { h: hhmm(sum.sunset) }) });
    (list || []).forEach(a => out.push({ kind: 'meteo', level: 'warn', text: tx('PREVISIÓN') + ' · ' + a.short }));
    return out;
  }

  const API = { OM_FC, OM_AQ, OM_GEO, AEMET_URL, ATTRIB, SOURCES, REFRESH, HORIZON, AQI_TH, DEFAULT_METEO,
    normMeteo, publicMeteo, staleMins, forecastUrl, airUrl, geoUrl, parseOpenMeteo, getPath, parseGeneric, manualSnap, fetchSnap, parseGeo,
    sky, uvText, aqiText, hhmm, sunNext, summary, alerts, pendingAlerts, ack, pruneAcks, pillText, tickerList, fmt1: r1, UNITS, toU, fromU, unitOf, numU, fmtU };
  if (isNode) module.exports = API;
  else root.ShowtimeMeteo = API;
})(typeof window !== 'undefined' ? window : globalThis);
