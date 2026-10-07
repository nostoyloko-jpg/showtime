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
    conf: { showWarn: 10, showDanger: 5, blink: true, coWarn: 5, coDanger: 1 },
    back: { cards: true, lines: true, ticker: true },
    ticker: { delays: true, hitos: true, meteo: true, mode: 'crawl', bg: '#000000', fg: '#ffb347' }
  };
  function int(v, d, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; }
  function hex(v, d) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d; }
  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function normScreens(s) {
    const D = DEFAULT_SCREENS, o = s || {}, c = o.conf || {}, b = o.back || {}, t = o.ticker || {};
    const conf = {
      showWarn: int(c.showWarn, D.conf.showWarn, 0, 180), showDanger: int(c.showDanger, D.conf.showDanger, 0, 180), blink: bool(c.blink, D.conf.blink),
      coWarn: int(c.coWarn, D.conf.coWarn, 0, 180), coDanger: int(c.coDanger, D.conf.coDanger, 0, 180)
    };
    if (conf.showDanger > conf.showWarn) conf.showDanger = conf.showWarn;    // el rojo nunca antes que el ámbar
    if (conf.coDanger > conf.coWarn) conf.coDanger = conf.coWarn;
    return {
      conf,
      back: { cards: bool(b.cards, true), lines: bool(b.lines, true), ticker: bool(b.ticker, true) },
      ticker: { delays: bool(t.delays, true), hitos: bool(t.hitos, true), meteo: bool(t.meteo, true), mode: t.mode === 'static' ? 'static' : 'crawl',
        bg: hex(t.bg, D.ticker.bg), fg: hex(t.fg, D.ticker.fg) }
    };
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
    const neg = sec < 0;
    let s = neg ? Math.floor(-sec) : Math.ceil(sec);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60), r = s - m * 60, p = n => (n < 10 ? '0' : '') + n;
    return (neg ? '-' : '') + (h ? h + ':' + p(m) : p(m)) + ':' + p(r);
  }

  function zonesWithBands(state, jor) {
    const ids = [];
    C.buildBlocks(state, { mode: 'all', day: jor }).forEach(b => { if (C.isBand(b) && b.psi !== null && ids.indexOf(b.stageId || '') < 0) ids.push(b.stageId || ''); });
    return ids;
  }
  function zoneName(state, id) { const e = C.getEscenario(state, id); return e ? e.nombre : 'Sin zona'; }

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
    (Array.isArray(avisos) ? avisos : []).forEach(a => { if (a && a.text) out.push({ kind: 'aviso', level: 'warn', text: String(a.text).toUpperCase() }); });
    if (!state) return out;
    const n = Math.floor(now), jor = C.activeJornada(state, n);
    if (t.delays && C.delayByZone) {
      const late = C.delayByZone(state, n).filter(z => z.acc > 0 || z.live > 0);
      late.forEach(z => out.push({ kind: 'delay', level: z.status === 'overflow' ? 'over' : 'warn',
        text: (z.zone || 'Sin zona').toUpperCase() + ' · RETRASO +' + z.acc + ' MIN' + (z.live > 0 ? ' (+' + z.live + ' EN VIVO)' : '') }));
      if (!late.length) out.push({ kind: 'delay', level: 'ok', text: 'EN HORA · SIN INCIDENCIAS' });
      // Tiempo extra en curso (activado y pasada su hora)
      C.buildBlocks(state, { mode: 'all', day: jor, now: n }).filter(b => C.isBand(b) && b.alargar && b.rf === null && b.nf !== null && n >= b.nf && b.si <= n).forEach(b =>
        out.push({ kind: 'delay', level: 'warn', text: (b.stage || 'Sin zona').toUpperCase() + ' · ' + b.name.toUpperCase() + ' · TIEMPO EXTRA +' + Math.floor(n - b.nf) + ' MIN' }));
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
  function backstageCalls(blocks, now, callMins, done) {
    const d = done instanceof Set ? done : new Set(done || []);
    return C.callList(blocks, now, callMins, []).map(b => ({ block: b, done: C.callIsDone(d, b) }));
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

  const API = { VISTAS, VISTA_TXT, VISTA_SUB, DEFAULT_SCREENS, normVista, nextVista, normProdVista, nextProdVista, normScreens, normTargets, normZones, flashFor, targetsTxt,
    level, fmtClock, confidence, tickerItems, backstageCalls, liveUrl, parseLive, pickScreen };
  if (isNode) module.exports = API;
  else root.ShowtimeVistas = API;
})(typeof window !== 'undefined' ? window : globalThis);
