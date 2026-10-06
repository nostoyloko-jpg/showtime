/* Showtime — mando.js  (Entrega 2d-B)
 * Reglas del mando del regidor, sin pantalla: las usan el Panel (para ejecutar las órdenes) y el móvil (para enseñar
 * lo mismo antes de mandarlas). Así el resumen que ve el regidor en el móvil es exactamente lo que hará el Mac.
 *
 *   targets / suggest      bandas de una zona que se pueden marcar y la que se propone (visible y cambiable)
 *   realPlan               ▶ Empezar / ■ Terminar: hora real y, si desborda el colchón, empuje SOLO del desborde (= Panel)
 *   onTimePlan             En hora: borra ▶/■ de esa banda (Δ = 0) y mantiene los retrasos ya aplicados
 *   delayPlan              retraso +N con los bloqueos del menú Retrasos; resumen «mueve X · Y fijos»
 *   checkCmd               valida la forma de cada orden antes de tocar nada
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.ShowtimeCore;

  const OPS = ['start', 'stop', 'onTime', 'delay', 'flash', 'flashOff', 'callOk'];
  const OP_TXT = { start: '▶ Empezar', stop: '■ Terminar', onTime: 'En hora', delay: 'Retraso', flash: 'Mensaje', flashOff: 'Retirar mensaje', callOk: 'OK de CALL' };
  const CATS = ['show', 'sc', 'tarea', 'hito'];

  // ── Bloqueos del menú Retrasos (los mismos que usa el Panel) ──────────
  function blockOf(config, scope) { const b = ((config && config.delayBlock) || {})[scope] || {}; const o = {}; CATS.forEach(k => { o[k] = b[k] === true; }); return o; }
  function isBlocked(config, kind, zoneId) { return !!(blockOf(config, 'all')[kind] || blockOf(config, zoneId || '')[kind]); }
  /** ¿Se mueve este bloque por su categoría y su zona? (el LED de cada entrada va por encima, en core.movesWithDelay) */
  function catsFor(config, extra) { return b => !(extra && extra[b.kind]) && !isBlocked(config, b.kind, b.stageId || ''); }

  function allBlocks(state) { return state ? C.buildBlocks(state, { mode: 'all', day: 'all' }) : []; }
  function nEnt(n, adj) { return n + (n === 1 ? ' entrada ' + adj : ' entradas ' + adj + 's'); }
  function keptTxt(n) { return n === 1 ? '1 en rojo no se mueve' : n + ' en rojo no se mueven'; }

  // ── Qué banda se marca ───────────────────────────────────────────────
  /** Bandas (shows y soundchecks con hora) de una zona ('' = sin zona) en la jornada de ese momento, en orden. */
  function targets(state, zoneId, nowAbs) {
    if (!state) return [];
    const jor = C.jornadaOfAbs(state, Math.floor(nowAbs));
    return allBlocks(state).filter(b => C.isBand(b) && b.psi !== null && b.jornada === jor && (b.stageId || '') === (zoneId || ''))
      .sort((x, y) => x.psi - y.psi);
  }
  /** Banda que se PROPONE (el regidor la ve y puede cambiarla con ‹ ›):
   *  1) la que tiene ▶ y aún no ■; 2) la que suena según el horario; 3) la siguiente sin empezar; 4) la última. */
  function suggest(list, nowAbs) {
    if (!list.length) return null;
    const now = nowAbs;
    return list.find(b => b.ri !== null && b.rf === null)
      || list.find(b => b.rf === null && b.si <= now && now < C.blockEnd(b))
      || list.find(b => b.ri === null && b.si > now)
      || list[list.length - 1];
  }
  /** Qué se puede hacer con una banda: ▶ si no tiene inicio real; ■ si lo tiene y no fin; En hora si tiene algún registro. */
  function actionsFor(b) {
    return { start: !!b && b.ri === null, stop: !!b && b.ri !== null && b.rf === null, onTime: !!b && (b.ri !== null || b.rf !== null) };
  }
  function findBlock(state, key) { return allBlocks(state).find(b => b.key === key) || null; }

  // ── ▶ / ■ (igual que los botones de la tabla del Panel) ───────────────
  /**
   * Registra la hora real y, si desborda el colchón, empuja SOLO el desborde en lo autorizado de su zona.
   * → { ok, state, msg, clashes } o { ok:false, error }
   */
  function realPlan(state, config, key, which, abs) {
    const b0 = findBlock(state, key);
    if (!b0) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b0)) return { ok: false, error: 'Solo los shows y soundchecks tienen ▶ / ■' };
    if (which === 'i' && b0.ri !== null) return { ok: false, error: b0.name + ' ya tiene inicio real (' + C.fmtHM(b0.ri) + ')' };
    if (which === 'f' && b0.ri === null) return { ok: false, error: b0.name + ' aún no ha empezado (falta ▶)' };
    if (which === 'f' && b0.rf !== null) return { ok: false, error: b0.name + ' ya tiene fin real (' + C.fmtHM(b0.rf) + ')' };
    const now = Math.floor(abs);
    const mode = b0.kind === 'sc' ? 'sc' : 'show';
    const r = C.setReal(state, b0.id, mode, which, now);
    if (!r.ok) return { ok: false, error: r.error };
    let st = r.state, clashes = [];
    const blocks = allBlocks(st);
    const b = blocks.find(x => x.key === key);
    let msg = b.name + (which === 'i' ? ': empieza ' : ': termina ') + C.fmtHM(now);
    const dz = C.driftByZone(st, blocks, now).find(z => z.zoneId === (b.stageId || ''));
    if (dz && dz.block.key === key) {
      const d = dz.delta;
      if (d > 0 && dz.status === 'absorb') msg += ' · desfase +' + d + ' min, se absorbe en el cambio';
      else if (d < 0) msg += ' · adelanto ' + (-d) + ' min';
      else if (d === 0) msg += ' · en hora';
      else if (dz.status === 'overflow') {
        const sh = C.shiftEntries(st, { minutes: dz.overflow, zone: b.stageId || 'all', cats: catsFor(config), fromAbs: Math.max(now, b.psi + 1), day: b.jornada });
        if (sh.moved.length) { st = sh.state; msg += ' · desborde +' + dz.overflow + ' min: ' + nEnt(sh.moved.length, 'movida') + (sh.kept.length ? ' (' + keptTxt(sh.kept.length) + ')' : ''); }
        else msg += ' · desborde +' + dz.overflow + ' min (nada que mover en ' + (b.stage || 'su zona') + ': bloqueado o en rojo)';
        clashes = sh.clashes;
      }
    }
    return { ok: true, state: st, msg, clashes };
  }

  /** En hora (opción a): borra ▶ y ■ de esa banda; Δ = 0. Los retrasos ya aplicados al resto se quedan como están. */
  function onTimePlan(state, key) {
    const b = findBlock(state, key);
    if (!b) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (b.ri === null && b.rf === null) return { ok: false, error: b.name + ' no tiene registros: ya está en hora' };
    const mode = b.kind === 'sc' ? 'sc' : 'show';
    let r = C.setReal(state, b.id, mode, 'i', null); if (!r.ok) return { ok: false, error: r.error };
    r = C.setReal(r.state, b.id, mode, 'f', null); if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, state: r.state, msg: b.name + ': en hora (registros ▶/■ borrados; los retrasos aplicados se mantienen)' };
  }

  // ── Retraso desde el móvil ───────────────────────────────────────────
  /**
   * opts: { minutes, zones: 'all' | [ids] ('' = sin zona), from: minutos absolutos (lo que empieza desde aquí), day? }
   * → { ok, state, moved, kept, clashes, jornada, summary } — lo mismo en el móvil (para el resumen) y en el Mac (para aplicar).
   */
  function delayPlan(state, config, opts) {
    const o = opts || {};
    const mins = Math.round(Number(o.minutes));
    if (!state) return { ok: false, error: 'Sin evento' };
    if (!(mins >= 1 && mins <= 600)) return { ok: false, error: 'Minutos de 1 a 600' };
    const from = Math.floor(Number(o.from));
    if (!Number.isFinite(from)) return { ok: false, error: 'Falta desde cuándo' };
    const day = o.day || C.jornadaOfAbs(state, from);
    const sh = C.shiftEntries(state, { minutes: mins, zone: o.zones === 'all' || !o.zones ? 'all' : o.zones, cats: catsFor(config), fromAbs: from, day });
    const summary = 'mueve ' + sh.moved.length + ' · ' + sh.kept.length + (sh.kept.length === 1 ? ' fija' : ' fijas') + (sh.clashes.length ? ' · ' + sh.clashes.length + (sh.clashes.length === 1 ? ' choque' : ' choques') : '');
    return { ok: true, state: sh.state, moved: sh.moved, kept: sh.kept, clashes: sh.clashes, jornada: sh.jornada, summary, minutes: mins };
  }
  /** Huella del resumen: si en el Mac sale otra cosa (el horario cambió entre medias), no se aplica. */
  function delayStamp(p) { return p.moved.map(m => m.key + '>' + m.to).join(',') + '|' + p.kept.length; }

  // ── Forma de las órdenes ─────────────────────────────────────────────
  /** null si la orden es válida; si no, el motivo. */
  function checkCmd(cmd) {
    if (!cmd || typeof cmd !== 'object') return 'Orden vacía';
    if (OPS.indexOf(cmd.op) < 0) return 'Orden desconocida';
    const a = cmd.args || {};
    const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
    switch (cmd.op) {
      case 'start': case 'stop': case 'onTime': return str(a.key, 120) ? null : 'Falta la banda';
      case 'delay':
        if (!(Number.isInteger(a.minutes) && a.minutes >= 1 && a.minutes <= 600)) return 'Minutos de 1 a 600';
        if (!(a.zones === 'all' || (Array.isArray(a.zones) && a.zones.length && a.zones.length <= 50 && a.zones.every(z => typeof z === 'string' && z.length <= 80)))) return 'Zonas no válidas';
        if (!Number.isFinite(a.from)) return 'Falta desde cuándo';
        if (typeof a.stamp !== 'string' || a.stamp.length > 20000) return 'Falta el resumen confirmado';
        return null;
      case 'flash': return typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= 140 ? null : 'Mensaje vacío o de más de 140 caracteres';
      case 'flashOff': return null;
      case 'callOk': return str(a.key, 200) ? null : 'Falta el CALL';
    }
    return 'Orden desconocida';
  }

  // ── Píldora de retraso por zona (Panel y mando) ─────────────────────
  /** z = una fila de core.delayByZone → { cls: 'ok'|'early'|'acc'|'absorb'|'over', text, title } */
  function delayPill(z, zoneLabel) {
    const nm = zoneLabel || z.zone || 'Sin zona';
    const who = z.liveBlock ? z.liveBlock.name : '';
    const accT = 'Retraso acumulado: lo que viene va +' + z.acc + ' min respecto al horario original (retrasos y desbordes ya aplicados)';
    if (z.live > 0) {
      const over = z.status === 'overflow';
      return { cls: over ? 'over' : 'absorb', text: nm + ': +' + z.acc + ' min (+' + z.live + ' vivo)' + (over ? ' · buffer agotado' : ''),
        title: accT + '\nDesfase en vivo de ' + who + ': +' + z.live + ' min' + (over ? ' · desborda el cambio en +' + z.overflow + ' min' : ' · se absorbe en el cambio') };
    }
    if (z.acc > 0) return { cls: 'acc', text: nm + ': +' + z.acc + ' min', title: accT + (z.early ? '\nEn vivo: adelanto de ' + z.early + ' min' : '') };
    if (z.early > 0) return { cls: 'early', text: nm + ' · En hora (−' + z.early + ' vivo)', title: who + ' va ' + z.early + ' min adelantada' };
    return { cls: 'ok', text: nm + ' · En hora', title: 'Sin retraso acumulado ni desfase en vivo' };
  }

  const API = { OPS, delayPill, OP_TXT, isBlocked, catsFor, targets, suggest, actionsFor, findBlock, realPlan, onTimePlan, delayPlan, delayStamp, checkCmd };
  if (isNode) module.exports = API;
  else root.ShowtimeMando = API;
})(typeof window !== 'undefined' ? window : globalThis);
