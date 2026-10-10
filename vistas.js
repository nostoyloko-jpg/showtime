/* Showtime — vistas.js  (Entrega 2e-A)
 * Reglas puras de las 3 vistas de la Pantalla Live (sin pantalla, con tests):
 *   Manager    — cronograma completo (la Live de siempre).
 *   Confidence — monitor de escenario para músicos: una zona, cuenta atrás gigante con semáforo.
 *   Backstage  — camerinos / catering: tarjetas, 2 líneas de cronograma y cinta de avisos.
 * Además: ajustes de pantallas (normScreens), destinos de los mensajes flash, cinta de avisos y elección de monitor.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.ShowtimeCore;
  // Idioma (Fase 2): textos de la cinta en el idioma activo (el que manda el Panel). Sin i18n.js, en español.
  const I18 = () => root.ShowtimeI18n || (isNode ? (() => { try { return require('./i18n.js'); } catch (e) { return null; } })() : null);
  const tx = (s, v) => { const I = I18(); return I ? I.tx(s, v) : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s); };

  const VISTAS = ['manager', 'confidence', 'backstage'];
  const VISTA_TXT = { manager: 'Manager', confidence: 'Confidence', backstage: 'Backstage' };
  const VISTA_SUB = { manager: 'cronograma completo (FOH, regiduría)', confidence: 'monitor de escenario (músicos)', backstage: 'camerinos y catering (Smart TV)' };

  function normVista(v) { return VISTAS.indexOf(v) >= 0 ? v : 'manager'; }
  function nextVista(v) { return VISTAS[(VISTAS.indexOf(normVista(v)) + 1) % VISTAS.length]; }
  // Producción: solo Manager y Backstage (sin Confidence, que es el monitor de los músicos)
  const PROD_VISTAS = ['manager', 'backstage'];
  function normProdVista(v) { return PROD_VISTAS.indexOf(v) >= 0 ? v : 'manager'; }
  function nextProdVista(v) { return PROD_VISTAS[(PROD_VISTAS.indexOf(normProdVista(v)) + 1) % PROD_VISTAS.length]; }

  // ── Ajustes de pantallas (Configuración › Pantallas Live y vistas) ────
  const DEFAULT_SCREENS = {
    conf: { showWarn: 10, showDanger: 5, blink: true, blinkSpeed: 1, coWarn: 5, coDanger: 1, overBg: '#000000', overNum: '#ff3b30' },
    back: { cards: true, lines: true, ticker: true },
    ticker: { delays: true, hitos: true, meteo: true, mode: 'crawl', bg: '#000000', fg: '#ffb347', speed: 30 },
    park: { mins: 5 }   // dec. 131: reposo de las pantallas remotas sin emisión (0 = nunca)
  };
  // ── Filas de una ventana Manager (dec. 133): «auto» o un número fijo de filas que reparten el alto. Va en la URL de cada ventana ──
  const MGR_ROWS = ['auto', 2, 3, 4, 5, 6];
  const MGR_ROWS_TXT = { auto: 'Auto (según pantalla)', 2: '2 filas (grande)', 3: '3 filas', 4: '4 filas', 5: '5 filas', 6: '6 filas (compacto)' };
  /** Número de filas fijo (2–6) o null (auto: el reparto de siempre). */
  function normRows(v) { const n = Math.round(Number(v)); return v !== null && v !== '' && v !== 'auto' && n >= 2 && n <= 6 ? n : null; }
  const PARK_MINS = [5, 2, 10, 0];   // 5 = recomendado · 0 = nunca (mantener siempre el último horario)
  const PARK_END_MS = 3000;          // «Parar emisión» en el Dashboard → reposo a los 3 s
  /** Número con decimales (un decimal) entre lo y hi; lo que no sea número, al valor por defecto. */
  function num(v, d, lo, hi) { const n = Number(v); return v !== '' && v !== null && Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10 : d; }
  function int(v, d, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; }
  function hex(v, d) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d; }
  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function normScreens(s) {
    const D = DEFAULT_SCREENS, o = s || {}, c = o.conf || {}, b = o.back || {}, t = o.ticker || {};
    const conf = {
      showWarn: int(c.showWarn, D.conf.showWarn, 0, 180), showDanger: int(c.showDanger, D.conf.showDanger, 0, 180), blink: bool(c.blink, D.conf.blink),
      coWarn: int(c.coWarn, D.conf.coWarn, 0, 180), coDanger: int(c.coDanger, D.conf.coDanger, 0, 180),
      overBg: hex(c.overBg, D.conf.overBg), overNum: hex(c.overNum, D.conf.overNum),   // sobretiempo: fondo y números
      blinkSpeed: num(c.blinkSpeed, D.conf.blinkSpeed, 0.1, 5)   // segundos por parpadeo (libre: 0,1 a 5)
    };
    if (conf.showDanger > conf.showWarn) conf.showDanger = conf.showWarn;    // el rojo nunca antes que el ámbar
    if (conf.coDanger > conf.coWarn) conf.coDanger = conf.coWarn;
    return {
      conf,
      back: { cards: bool(b.cards, true), lines: bool(b.lines, true), ticker: bool(b.ticker, true) },
      ticker: { delays: bool(t.delays, true), hitos: bool(t.hitos, true), meteo: bool(t.meteo, true), mode: t.mode === 'static' ? 'static' : 'crawl',
        bg: hex(t.bg, D.ticker.bg), fg: hex(t.fg, D.ticker.fg), speed: num(t.speed, D.ticker.speed, 5, 120) },   // segundos por vuelta (libre: 5 a 120)
      park: { mins: PARK_MINS.indexOf(Number((o.park || {}).mins)) >= 0 && (o.park || {}).mins !== '' && (o.park || {}).mins !== null ? Number(o.park.mins) : D.park.mins }
    };
  }

  /** Reposo / Modo Parking de una pantalla remota (dec. 131). Solo maquetación: decide si se tapa la vista con el cartel.
   *  o: { vista, prod (Live de Producción), state ('connecting'|'live'|'stale'|'end'|'bad'), lastMsg, startedAt, endedAt, now, mins }
   *  · Confidence nunca (no distrae al músico) y Producción tampoco (es el móvil de una persona, con su chat).
   *  · Emisión parada en el Dashboard → a los 3 s. · Sin noticias (corte, Wi-Fi, Mac apagado o la tele se enciende sin emisión)
   *    → a los «mins» minutos desde el último dato (o desde que se abrió). · «Nunca» (0) → jamás. · Enlace no válido → no (que se vea el aviso).
   *  En cuanto vuelve un paquete (state 'live') se quita sola. */
  function parkState(o) {
    if (!o || o.prod || normVista(o.vista) !== o.vista || o.vista === 'confidence') return false;
    const mins = PARK_MINS.indexOf(Number(o.mins)) >= 0 ? Number(o.mins) : DEFAULT_SCREENS.park.mins, now = Number(o.now) || Date.now();
    if (!mins || o.state === 'live' || o.state === 'bad') return false;
    if (o.state === 'end') return now - (Number(o.endedAt) || now) >= PARK_END_MS;
    if (o.state === 'stale' || o.state === 'connecting') return now - (Number(o.lastMsg) || Number(o.startedAt) || now) >= mins * 60000;
    return false;
  }

  // ── Mensajes flash por destino ───────────────────────────────────────
  /** Destinos válidos de un mensaje: null = todas las pantallas; si no, lista de vistas. */
  function normTargets(to) {
    if (!Array.isArray(to)) return null;
    const t = VISTAS.filter(v => to.indexOf(v) >= 0);
    return t.length && t.length < VISTAS.length ? t : null;
  }
  /** Zonas de destino para las pantallas Confidence: null = todas; si no, lista de ids de zona ('' = sin zona). */
  function normZones(z) {
    if (!Array.isArray(z)) return null;
    const out = [];
    z.forEach(x => { if (typeof x === 'string' && x.length <= 80 && out.indexOf(x) < 0 && out.length < 50) out.push(x); });
    return out.length ? out : null;
  }
  /** ¿Se ve este mensaje en esta vista? En Confidence, además, solo en las zonas elegidas (si se eligieron). */
  function flashFor(f, vista, zona) {
    if (!f) return false;
    const v = normVista(vista);
    if (f.to && f.to.length && f.to.indexOf(v) < 0) return false;
    if (v === 'confidence' && f.zones && f.zones.length) return zona !== null && zona !== undefined && f.zones.indexOf(zona) >= 0;
    return true;
  }
  /** «Confidence (Principal) · Backstage», «Todas las pantallas · Confidence: Principal»… zoneName(id) da el nombre de una zona. */
  function targetsTxt(to, zones, zoneName) {
    const t = normTargets(to), z = normZones(zones), zn = z ? z.map(id => zoneName ? zoneName(id) : id).join(', ') : '';
    if (!t) return 'Todas las pantallas' + (z ? ' · Confidence: ' + zn : '');
    return t.map(v => VISTA_TXT[v] + (v === 'confidence' && z ? ' (' + zn + ')' : '')).join(' · ');
  }

  // ── Semáforo y cuenta atrás ──────────────────────────────────────────
  /** Nivel de una cuenta atrás (segundos que quedan) con los umbrales en minutos. */
  function level(remSec, warnMin, dangerMin) {
    if (remSec < 0) return 'over';
    if (remSec <= dangerMin * 60) return 'danger';
    if (remSec <= warnMin * 60) return 'warn';
    return 'ok';
  }
  /** «MM:SS» (o «H:MM:SS» desde una hora); negativo con «-». Hacia arriba, para que 00:00 sea el final exacto. */
  function fmtClock(sec) {
    if (sec === null || sec === undefined || Number.isNaN(sec)) return '--:--';
    const neg = sec < -0.001;
    let s = Math.round(Math.abs(sec));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60), r = s - m * 60, p = n => (n < 10 ? '0' : '') + n;
    return (neg ? '+' : '') + (h ? h + ':' + p(m) : p(m)) + ':' + p(r);   // sobretiempo: «+» = tiempo extra acumulado
  }

  function zonesWithBands(state, jor) {
    const ids = [];
    C.buildBlocks(state, { mode: 'all', day: jor }).forEach(b => { if (C.isBand(b) && b.psi !== null && ids.indexOf(b.stageId || '') < 0) ids.push(b.stageId || ''); });
    return ids;
  }
  function zoneName(state, id) { const e = C.getEscenario(state, id); return e ? e.nombre : tx('Sin zona'); }

  /**
   * Confidence de una zona en el instante `now` (minutos absolutos con decimales).
   * zoneId: id de la zona ('' = sin zona); null/undefined = sin elegir (si solo hay una zona con bandas, esa).
   * → { mode: 'show' | 'changeover' | 'wait' | 'end' | 'pickzone' | 'nofest', zoneId, zone, band, next, remSec, totalSec, frac, level, blink }
   *   show: banda en escena (con ▶ y sin ■, o según horario); la cuenta puede ser negativa (sobretiempo).
   *   changeover: entre la banda anterior y la siguiente, cuenta atrás hasta la siguiente.
   *   wait: antes de la primera banda del día, o hueco sin cambio real — misma banda SC→show o una tarea
   *         de la zona en medio (decisión 76) — (sin barra). STANDBY marcado a mano sale como changeover+standby.
   */
  function confidence(state, zoneId, now, screens) {
    if (!state) return { mode: 'nofest' };
    const S = normScreens(screens), n = now, jor = C.activeJornada(state, Math.floor(n));
    const zs = zonesWithBands(state, jor);
    let z = zoneId;
    if (z === null || z === undefined) { if (zs.length === 1) z = zs[0]; else return { mode: 'pickzone', zones: zs.map(id => ({ id, name: zoneName(state, id) })) }; }
    const base = { zoneId: z, zone: zoneName(state, z) };
    const dayB = C.buildBlocks(state, { mode: 'all', day: jor, now: n });
    const bands = dayB.filter(b => C.isBand(b) && b.psi !== null && (b.stageId || '') === z).sort((a, b) => a.si - b.si);
        // Sin Alargar, se para a su hora (aunque tenga ▶). Con Alargar, sigue hasta ■ y pasada su hora cuenta en rojo.
    const cur = bands.find(b => b.alargar && b.rf === null && b.si <= n && n >= (b.nf !== null && b.nf !== undefined ? b.nf : C.blockEnd(b))) || bands.find(b => b.rf === null && b.si <= n && n < (b.nf !== null && b.nf !== undefined ? b.nf : C.blockEnd(b)));
    if (cur) {
      const end = cur.nf !== null && cur.nf !== undefined ? cur.nf : C.blockEnd(cur);   // fin NOMINAL: pasado, cuenta en rojo
      const total = Math.max(1, (end - cur.si) * 60), rem = (end - n) * 60;
      const lv = level(rem, S.conf.showWarn, S.conf.showDanger);
      return Object.assign(base, { mode: 'show', band: cur, remSec: rem, totalSec: total, frac: Math.max(0, Math.min(1, rem / total)), level: lv, blink: lv === 'over' && S.conf.blink });
    }
    const next = bands.find(b => b.ri === null && b.rf === null && b.si > n);
    if (!next) return Object.assign(base, { mode: 'end' });
    const before = bands.filter(b => b !== next && b.si < next.si);
    const prev = before.length ? before[before.length - 1] : null;
    const rem = (next.si - n) * 60;
    if (!prev || (!next.standby && C.gapIdle(prev, next, dayB))) return Object.assign(base, { mode: 'wait', next, remSec: rem, totalSec: null, frac: null, level: 'ok' });
    const prevEnd = prev.rf !== null ? prev.rf : C.blockEnd(prev);
    const total = Math.max(1, (next.si - Math.min(prevEnd, n)) * 60);
    const lv = level(rem, S.conf.coWarn, S.conf.coDanger);
    return Object.assign(base, { mode: 'changeover', band: prev, next, standby: !!next.standby, remSec: rem, totalSec: total, frac: Math.max(0, Math.min(1, rem / total)), level: lv, blink: false });
  }

  // ── Cinta de avisos (Backstage) ──────────────────────────────────────
  /**
   * Avisos de la cinta en el instante `now`: retrasos por zona, hitos que vienen (con su margen) y el tiempo.
   * → [{ kind: 'aviso'|'delay'|'hito'|'meteo', level: 'ok'|'warn'|'over', text }]
   */
  function tickerItems(state, screens, now, meteo, avisos) {
    const t = normScreens(screens).ticker, out = [];
    // Avisos escritos a mano (Producción / Stage Manager): siempre delante, en ámbar
    (Array.isArray(avisos) ? avisos : []).forEach(a => { if (a && a.text) { const l = byLabel(a.by); out.push({ kind: 'aviso', level: 'warn', text: ((l ? l + ' ' : '') + String(a.text)).toUpperCase() }); } });
    if (!state) return out;
    const n = Math.floor(now), jor = C.activeJornada(state, n);
    if (t.delays && C.delayByZone) {
      const late = C.delayByZone(state, n).filter(z => z.acc > 0 || z.live > 0);
      late.forEach(z => out.push({ kind: 'delay', level: z.status === 'overflow' ? 'over' : 'warn',
        text: (z.zone || tx('Sin zona')).toUpperCase() + ' · ' + tx('RETRASO +{n} MIN', { n: z.acc }) + (z.live > 0 ? ' ' + tx('(+{n} EN VIVO)', { n: z.live }) : '') }));
      if (!late.length) out.push({ kind: 'delay', level: 'ok', text: tx('EN HORA · SIN INCIDENCIAS') });
      // Tiempo extra en curso (activado y pasada su hora)
      C.buildBlocks(state, { mode: 'all', day: jor, now: n }).filter(b => C.isBand(b) && b.alargar && b.rf === null && b.nf !== null && n >= b.nf && b.si <= n).forEach(b =>
        out.push({ kind: 'delay', level: 'warn', text: (b.stage || tx('Sin zona')).toUpperCase() + ' · ' + b.name.toUpperCase() + ' · ' + tx('TIEMPO EXTRA +{n} MIN', { n: Math.floor(n - b.nf) }) }));
    }
    if (t.hitos) {
      const all = C.buildBlocks(state, { mode: 'all', day: jor });
      all.filter(b => b.kind === 'hito' && b.psi !== null && b.psi >= n).forEach(h => {
        // En la cinta, solo el hito y su hora (sin el margen: es información de regiduría, no del público de camerinos)
        out.push({ kind: 'hito', level: 'ok', text: h.name.toUpperCase() + ' ' + C.fmtHM(h.psi) });
      });
    }
    // El tiempo (2e-B): lista de meteo.js (tickerList) o un solo aviso { level, text }
    if (t.meteo && meteo) (Array.isArray(meteo) ? meteo : [meteo]).forEach(m => { if (m && m.text) out.push({ kind: 'meteo', level: m.level || 'ok', text: String(m.text).toUpperCase() }); });
    return out;
  }

  /** CALL en Backstage: visibles desde su hora hasta que arranca el show, aunque ya tengan OK (salen como «avisado»). */
  /** Backstage: el CALL sigue a la vista hasta que arranca el show; con OK para su hora efectiva sale «AVISADO» (dec. 150).
   *  Si un retraso mueve esa hora, el OK ya no vale: vuelve a salir como CALL pendiente. */
  function backstageCalls(blocks, now, callMins, done) {
    const d = done instanceof Set ? done : new Set(done || []);
    return C.callList(blocks, now, callMins, []).map(b => ({ block: b, done: C.callIsDone(d, b, callMins) }));
  }
  /** Dec. 149 · jerarquía por escenario: filas ya ordenadas [{ z, zn, zc, h }] → grupos consecutivos por zona
   *  [{ z, name, color, items: [h] }]: el nombre de la zona UNA vez arriba y debajo sus filas (contenido → tiempo). */
  function zoneGroups(rows) {
    const out = [];
    (rows || []).forEach(r => {
      const z = r.z || '', last = out[out.length - 1];
      if (last && last.z === z) last.items.push(r.h);
      else out.push({ z, name: r.zn || '', color: r.zc || '', items: [r.h] });
    });
    return out;
  }

  // ── Enlaces y monitor externo ────────────────────────────────────────
  /** URL de una vista (con zona para Confidence) y, opcionalmente, el «#…» de la emisión. */
  function liveUrl(base, vista, zona, hash) {
    const v = normVista(vista);
    let q = '?vista=' + v;
    if (v === 'confidence' && zona !== null && zona !== undefined) q += '&zona=' + encodeURIComponent(zona);
    return (base || '') + 'live.html' + q + (hash || '');
  }
  function parseLive(search) {
    const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    return { vista: normVista(p.get('vista')), zona: p.has('zona') ? p.get('zona') : null };
  }
  /** Monitor de destino: uno que no sea en el que está el Dashboard; mejor externo (HDMI) que integrado. null si solo hay uno. */
  function pickScreen(screens, current) {
    const list = (screens || []).filter(s => s && s !== current && !(current && s.left === current.left && s.top === current.top && s.width === current.width && s.height === current.height));
    if (!list.length) return null;
    return list.find(s => !s.isInternal && !s.isPrimary) || list.find(s => !s.isInternal) || list.find(s => !s.isPrimary) || list[0];
  }

  /** «[Producción]» / «[Production]» o «[Zona]»: etiqueta pública del origen (dec. 106). '' sin etiqueta. */
  function byLabel(by) {
    if (!by) return '';
    if (by.k === 'prod') return '[' + tx('Producción') + ']';
    if (by.k === 'zone' && by.n) return '[' + String(by.n) + ']';
    return '';
  }
  const API = { byLabel, VISTAS, VISTA_TXT, VISTA_SUB, DEFAULT_SCREENS, normVista, nextVista, normProdVista, nextProdVista, normScreens, MGR_ROWS, MGR_ROWS_TXT, normRows, parkState, PARK_MINS, PARK_END_MS, normTargets, normZones, flashFor, targetsTxt,
    level, fmtClock, confidence, tickerItems, backstageCalls, zoneGroups, liveUrl, parseLive, pickScreen };
  if (isNode) module.exports = API;
  else root.ShowtimeVistas = API;
})(typeof window !== 'undefined' ? window : globalThis);
