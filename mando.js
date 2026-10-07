/* Showtime — mando.js  (Entrega 2d-B)
 * Reglas del mando del regidor, sin pantalla: las usan el Panel (para ejecutar las órdenes) y el móvil (para enseñar
 * lo mismo antes de mandarlas). Así el resumen que ve el regidor en el móvil es exactamente lo que hará el Mac.
 *
 *   targets / suggest      bandas de una zona que se pueden marcar y la que se propone (visible y cambiable)
 *   realPlan               ▶ Empezar / ■ Terminar: hora real y, si desborda el colchón, empuje SOLO del desborde (= Panel).
 *                          ■ sin ▶ (modo pasivo): el inicio se da por en hora (el programado) y el fin es ahora.
 *   onTimePlan             En hora: inicio real = su hora prevista; cancela el retraso que arrastraba la zona
 *   stretchPlan            Alargar: la banda puede gastar el colchón; pasado, suma al estimado hasta ■
 *   delayPlan              retraso +N (orden guardada; el previsto no cambia) con los bloqueos del menú Retrasos
 *   checkCmd               valida la forma de cada orden antes de tocar nada
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.ShowtimeCore;

  const OPS = ['start', 'stop', 'onTime', 'stretch', 'delay', 'flash', 'flashOff', 'callOk'];
  const OP_TXT = { start: '▶ Empezar', stop: '■ Terminar', onTime: 'En hora', stretch: 'Tiempo extra', delay: 'Retraso', flash: 'Mensaje', flashOff: 'Retirar mensaje', callOk: 'OK de CALL' };
  const CATS = ['show', 'sc', 'tarea', 'hito'];

  // ── Bloqueos del menú Retrasos (los mismos que usa el Panel) ──────────
  function blockOf(config, scope) { const b = ((config && config.delayBlock) || {})[scope] || {}; const o = {}; CATS.forEach(k => { o[k] = b[k] === true; }); return o; }
  function isBlocked(config, kind, zoneId) { return !!(blockOf(config, 'all')[kind] || blockOf(config, zoneId || '')[kind]); }
  /** ¿Se mueve este bloque por su categoría y su zona? (el LED de cada entrada va por encima, en core.movesWithDelay) */
  function catsFor(config, extra) { return b => !(extra && extra[b.kind]) && !isBlocked(config, b.kind, b.stageId || ''); }

  function allBlocks(state, now) { return state ? C.buildBlocks(state, Number.isFinite(now) ? { mode: 'all', day: 'all', now: now } : { mode: 'all', day: 'all' }) : []; }
  function nEnt(n, adj) { return n + (n === 1 ? ' entrada ' + adj : ' entradas ' + adj + 's'); }
  function keptTxt(n) { return n === 1 ? '1 en rojo no se mueve' : n + ' en rojo no se mueven'; }

  // ── Qué banda se marca ───────────────────────────────────────────────
  /** Bandas (shows y soundchecks con hora) de una zona ('' = sin zona) en la jornada de ese momento, en orden. */
  function targets(state, zoneId, nowAbs) {
    if (!state) return [];
    const jor = C.activeJornada(state, Math.floor(nowAbs));   // pasado el corte, si una banda sigue sonando, sigue su jornada
    return allBlocks(state, nowAbs).filter(b => C.isBand(b) && b.psi !== null && b.jornada === jor && (b.stageId || '') === (zoneId || ''))
      .sort((x, y) => x.pmi - y.pmi);
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
  /** ¿Ha llegado ya su hora de empezar (la ESTIMADA)? Modo pasivo: sin ▶ se da por empezada a esa hora. */
  function startedBySchedule(b, nowAbs) { return !!b && b.si !== null && Number.isFinite(nowAbs) && nowAbs >= b.si; }
  /** Qué se puede hacer con una banda:
   *  ▶ si no tiene inicio real · ■ si no tiene fin y ya empezó (con ▶ o, sin ▶, porque ya es su hora) y, sin Alargar, antes de su hora de acabar
   *  · En hora (inicio real = su hora prevista; cancela el retraso que arrastra) siempre que no haya terminado y no esté ya en hora
   *  · Alargar (gastar el colchón del cambio) si aún no ha terminado. */
  function actionsFor(b, nowAbs) {
    const open = !!b && b.rf === null;
    const onTime = open && b.pmi !== null && b.pmi !== undefined && b.ri !== b.pmi && !(b.ri === null && b.si === b.pmi);
    const ended = !b || (!b.alargar && Number.isFinite(nowAbs) && b.nf !== null && b.nf !== undefined && nowAbs >= b.nf);   // sin Alargar: parada a su hora
    return { start: open && !ended && b.ri === null, stop: open && !ended && (b.ri !== null || startedBySchedule(b, nowAbs)), onTime: onTime, stretch: open };
  }
  /** El estado con los bloqueos del menú Retrasos de este momento (el desborde los respeta). */
  function withBlk(state, config) {
    if (!state || !config || !config.delayBlock || JSON.stringify(state.showtimeBloqueos || {}) === JSON.stringify(config.delayBlock)) return state;
    return Object.assign({}, state, { showtimeBloqueos: JSON.parse(JSON.stringify(config.delayBlock)) });
  }
  function findBlock(state, key, now) { return allBlocks(state, now).find(b => b.key === key) || null; }

  /** Lo que una orden ha hecho al ESTIMADO de la zona (para el aviso y el log). */
  function zoneEffect(before, after, b) {
    const k = b.stageId || '', A = new Map(before.map(x => [x.key, x]));
    const moved = after.filter(x => x.key !== b.key && (x.stageId || '') === k && x.jornada === b.jornada && A.has(x.key) && x.si !== A.get(x.key).si);
    const next = after.filter(x => C.isBand(x) && x.key !== b.key && (x.stageId || '') === k && x.jornada === b.jornada && x.pmi > b.pmi).sort((x, y) => x.pmi - y.pmi)[0] || null;
    return { moved, next, nextBefore: next ? A.get(next.key) : null };
  }
  function effectTxt(eff) {
    const n = eff.next; if (!n) return '';
    const d = n.si - n.psi, ch = eff.nextBefore ? n.si - eff.nextBefore.si : 0;
    return ' · siguiente ' + n.name + ' ' + C.fmtHM(n.si) + (d ? ' (' + (d > 0 ? '+' : '−') + Math.abs(d) + ' sobre lo previsto)' : ' (en hora)') +
      (ch && eff.moved.length ? ' · ' + (ch > 0 ? '+' + ch : '−' + (-ch)) + ' min en ' + (eff.moved.length === 1 ? '1 entrada' : eff.moved.length + ' entradas') + ' de la zona' : '');
  }

  // ── ▶ / ■ (igual que los botones de la tabla del Panel) ───────────────
  /**
   * Registra la hora real. NO mueve el previsto de nadie: el estimado de la zona se recalcula solo (colchón y desborde).
   * ■ sin ▶ (modo pasivo): el inicio real es el estimado (se dio por empezada a su hora) y el fin, ahora.
   * → { ok, state, msg, clashes, passive, pushed } o { ok:false, error }
   */
  function realPlan(state0, config, key, which, abs) {
    const now = Math.floor(abs), state = withBlk(state0, config);
    const b0 = findBlock(state, key, now);
    if (!b0) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b0)) return { ok: false, error: 'Solo los shows y soundchecks tienen ▶ / ■' };
    if (which === 'i' && b0.ri !== null) return { ok: false, error: b0.name + ' ya tiene inicio real (' + C.fmtHM(b0.ri) + ')' };
    if (which === 'f' && b0.rf !== null) return { ok: false, error: b0.name + ' ya tiene fin real (' + C.fmtHM(b0.rf) + ')' };
    if (!b0.alargar && b0.rf === null && b0.nf !== null && now >= b0.nf) return { ok: false, error: b0.name + ' ya acabó a su hora (' + C.fmtHM(b0.nf) + '). Para que pueda pasarse, activa Tiempo extra antes' };
    if (which === 'f' && b0.ri !== null && now < b0.ri) return { ok: false, error: 'El fin (' + C.fmtHM(now) + ') no puede ser anterior al inicio real de ' + b0.name + ' (' + C.fmtHM(b0.ri) + '). ¿Cambio de hora? Corrige el inicio con doble clic en el Dashboard' };
    const passive = which === 'f' && b0.ri === null;
    if (passive && !startedBySchedule(b0, now)) return { ok: false, error: b0.name + ' aún no ha empezado' + (b0.si !== null ? ' (empieza a las ' + C.fmtHM(b0.si) + ')' : '') };
    const mode = b0.kind === 'sc' ? 'sc' : 'show';
    let r = passive ? C.setReal(state, b0.id, mode, 'i', b0.si) : { ok: true, state };
    if (r.ok) r = C.setReal(r.state, b0.id, mode, which, now);
    if (!r.ok) return { ok: false, error: r.error };
    const before = allBlocks(state, now), after = allBlocks(r.state, now);
    const b = after.find(x => x.key === key);
    let msg = b.name + (which === 'i' ? ': empieza ' : ': termina ') + C.fmtHM(now) + (passive ? ' (inicio ' + C.fmtHM(b.ri) + ', a su hora)' : '');
    if (which === 'i') { const d = now - b0.si; msg += d > 0 ? ' · sale ' + d + ' min tarde' : d < 0 ? ' · sale ' + (-d) + ' min antes de lo estimado' : ' · a su hora'; }
    else {
      const plan = b.pmf !== null ? b.pmf + (b.si - b.pmi) : null, dd = plan !== null ? now - plan : 0;   // fin esperado con su inicio real
      msg += dd < 0 ? ' · acaba ' + (-dd) + ' min antes: el tiempo se suma al cambio (no se adelanta nada)' : dd > 0 ? ' · ' + dd + ' min tarde' : ' · a su hora';
    }
    const eff = zoneEffect(before, after, b);
    msg += effectTxt(eff);

    const nb = eff.next, nbb = eff.nextBefore;
    // Desborde que deja fijado este ■ (con Alargar): lo que pasa del colchón a la siguiente de su zona
    const pushed = which === 'f' && nb && nb.push > 0 && nb.pushFrom === b.name ? { minutes: nb.push, moved: after.filter(x => (x.stageId || '') === (b.stageId || '') && x.jornada === b.jornada && x.pmi > b.pmi && x.si > x.pmi).length, kept: 0, zone: b.stage || 'Sin zona', who: b.name, jornada: b.jornada } : null;
    void nbb;
    const clashes = after.filter(x => x.clash && !(before.find(y => y.key === x.key) || {}).clash).map(x => ({ name: x.clashWith, with: x.name, at: x.si }));
    return { ok: true, state: r.state, msg, clashes, passive, pushed };
  }

  /** En hora: la banda empieza (o empezó) a su hora prevista → inicio real = previsto (+ retraso manual); el retraso que arrastraba se cancela. */
  function onTimePlan(state, key, abs) {
    const now = Number.isFinite(abs) ? Math.floor(abs) : Math.floor(C.nowAbs());
    const b = findBlock(state, key, now);
    if (!b) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b)) return { ok: false, error: 'Solo los shows y soundchecks' };
    if (b.rf !== null) return { ok: false, error: b.name + ' ya ha terminado (' + C.fmtHM(b.rf) + '): para corregirlo, Deshacer' };
    if (b.ri === b.pmi || (b.ri === null && b.si === b.pmi)) return { ok: false, error: b.name + ' ya está en hora' };
    const mode = b.kind === 'sc' ? 'sc' : 'show';
    const r = C.setReal(state, b.id, mode, 'i', b.pmi); if (!r.ok) return { ok: false, error: r.error };
    const before = allBlocks(state, now), after = allBlocks(r.state, now);
    const nb = after.find(x => x.key === key);
    const was = (b.ri !== null ? b.ri : b.si) - b.pmi;   // lo que llevaba de retraso (o de adelanto) antes de reconciliar
    const zona = b.stage || 'sin zona';
    const logTxt = 'Reconciliación: Zona ' + zona + ' vuelve a EN HORA (' + (was >= 0 ? 'absorbidos +' + was + ' min en changeover' : 'anulado un adelanto de ' + (-was) + ' min') + ') · ' + b.name + ' ' + C.fmtHM(b.pmi);
    return { ok: true, state: r.state, logTxt, absorbed: was, msg: b.name + ': en hora, empieza ' + C.fmtHM(b.pmi) + (b.si !== b.pmi ? ' (estaba estimada a las ' + C.fmtHM(b.si) + ')' : '') + effectTxt(zoneEffect(before, after, nb)) };
  }

  /** Ventana del bis: hasta que la siguiente banda de su zona dé ▶ y como mucho 15 min (o el colchón del cambio, si es mayor). */
  const BIS_MIN = 15;
  function bisWindow(state, b, now) {
    const list = allBlocks(state, now).filter(x => C.isBand(x) && x.psi !== null && x.jornada === b.jornada && (x.stageId || '') === (b.stageId || '') && x.pmi > b.pmi).sort((x, y) => x.pmi - y.pmi);
    const next = list[0] || null;
    const gap = next && next.psi !== null && b.psf !== null ? next.psi - b.psf : 0;
    return { next, max: Math.max(BIS_MIN, gap) };
  }

  /** Corregir la hora REAL de inicio (solo desde el Dashboard): p. ej. no se pudo pulsar ▶ a tiempo y se dio por empezada a su hora.
   *  Valida: no después de ahora ni del fin real, dentro de su jornada y sin pisar el fin real de la anterior de su zona. */
  function editStartPlan(state0, config, key, abs, nowAbs) {
    const now = Number.isFinite(nowAbs) ? Math.floor(nowAbs) : Math.floor(C.nowAbs()), state = withBlk(state0, config);
    const b = findBlock(state, key, now);
    if (!b) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b)) return { ok: false, error: 'Solo los shows y soundchecks tienen hora real' };
    if (!Number.isFinite(abs)) return { ok: false, error: 'Hora no válida' };
    const t = Math.floor(abs);
    if (t > now) return { ok: false, error: 'La hora real de inicio no puede ser posterior a ahora (' + C.fmtHM(now) + ')' };
    if (b.rf !== null && t >= b.rf) return { ok: false, error: 'Tiene que ser anterior a su fin real (' + C.fmtHM(b.rf) + ')' };
    if (C.jornadaOfAbs(state, t) !== b.jornada) return { ok: false, error: 'Esa hora cae fuera de su jornada' };
    const prev = allBlocks(state, now).filter(x => C.isBand(x) && x.key !== b.key && x.jornada === b.jornada && (x.stageId || '') === (b.stageId || '') && x.pmi < b.pmi && x.rf !== null).sort((x, y) => y.pmi - x.pmi)[0];
    if (prev && t < prev.rf) return { ok: false, error: 'Pisa el fin real de ' + prev.name + ' (' + C.fmtHM(prev.rf) + ')' };
    const old = b.ri !== null ? b.ri : b.si, assumed = b.ri === null;
    if (!assumed && t === b.ri) return { ok: false, error: b.name + ' ya tiene ese inicio real' };
    const r = C.setReal(state, b.id, b.kind === 'sc' ? 'sc' : 'show', 'i', t); if (!r.ok) return { ok: false, error: r.error };
    const before = allBlocks(state, now), after = allBlocks(r.state, now), nb = after.find(x => x.key === key);
    const logTxt = 'Corrección de inicio real: «' + b.name + '» ' + C.fmtHM(t) + ' (antes ' + C.fmtHM(old) + (assumed ? ', asumido' : '') + ')';
    return { ok: true, state: r.state, logTxt, msg: b.name + ': inicio real ' + C.fmtHM(t) + ' (antes ' + C.fmtHM(old) + (assumed ? ', asumido a su hora' : '') + ')' + effectTxt(zoneEffect(before, after, nb)) };
  }

  /** Alargar: la banda puede gastar el colchón del cambio; pasado, cada minuto suma al estimado de su zona hasta ■. */
  function stretchPlan(state, key, on, abs) {
    const now = Number.isFinite(abs) ? Math.floor(abs) : Math.floor(C.nowAbs());
    const b = findBlock(state, key, now);
    if (!b) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b)) return { ok: false, error: 'Solo los shows y soundchecks tienen Tiempo extra' };
    if (on && b.rf !== null) return { ok: false, error: b.name + ' ya ha terminado' };
    // Bis: pasada su hora (ya en cambio de escenario) se puede rescatar, pero solo dentro de la ventana y si la siguiente no ha dado ▶
    let late = null;
    if (on && !b.alargar && b.nf !== null && b.nf !== undefined && now >= b.nf) {
      const w = bisWindow(state, b, now);
      if (w.next && w.next.ri !== null) return { ok: false, error: w.next.name + ' ya ha empezado (▶ ' + C.fmtHM(w.next.ri) + '): el bis de ' + b.name + ' ya no se puede rescatar' };
      late = Math.floor(now - b.nf);
      if (late > w.max) return { ok: false, error: 'Han pasado ' + late + ' min desde el fin de ' + b.name + ' (' + C.fmtHM(b.nf) + '): el bis solo se puede rescatar en los primeros ' + w.max + ' min' };
    }
    const r = C.setAlargar(state, b.id, b.kind === 'sc' ? 'sc' : 'show', !!on); if (!r.ok) return { ok: false, error: r.error };
    if (!r.changed) return { ok: false, error: b.name + (on ? ' ya tiene Tiempo extra' : ' no tenía Tiempo extra') };
    if (late !== null) return { ok: true, state: r.state, late, msg: 'BIS · ' + b.name + ': Tiempo extra tardío a las ' + C.fmtHM(now) + ' (+' + late + ' min desde su fin, ' + C.fmtHM(b.nf) + '). Vuelve a estar en escena; gasta el colchón y, pasado, retrasa lo que viene de su zona hasta ■' };
    return { ok: true, state: r.state, msg: b.name + (on ? ': TIEMPO EXTRA · puede gastar el colchón del cambio; pasado, retrasa lo que viene de su zona hasta ■' : ': Tiempo extra desactivado') };
  }

  // ── Retraso desde el móvil ───────────────────────────────────────────
  /**
   * opts: { minutes, zones: 'all' | [ids] ('' = sin zona), from: minutos absolutos (lo que empieza desde aquí), day?, at?, src? }
   * Se guarda como ORDEN (el previsto no cambia; el estimado sí).
   * → { ok, state, moved, kept, clashes, jornada, summary } — lo mismo en el móvil (para el resumen) y en el Mac (para aplicar).
   */
  function delayPlan(state, config, opts) {
    const o = opts || {};
    const mins = Math.round(Number(o.minutes));
    if (!state) return { ok: false, error: 'Sin evento' };
    if (!(mins >= 1 && mins <= 600)) return { ok: false, error: 'Minutos de 1 a 600' };
    const from = Math.floor(Number(o.from));
    if (!Number.isFinite(from)) return { ok: false, error: 'Falta desde cuándo' };
    const day = o.day || C.activeJornada(state, from);
    const sh = C.addRetraso(state, { minutes: mins, zone: o.zones === 'all' || !o.zones ? 'all' : o.zones, blocked: (config && config.delayBlock) || {}, fromAbs: from, day, at: Number.isFinite(o.at) ? o.at : from, src: o.src, now: Number.isFinite(o.at) ? o.at : from });
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
      case 'stretch': return !str(a.key, 120) ? 'Falta la banda' : typeof a.on !== 'boolean' ? 'Falta si se activa o no' : null;
      case 'delay':
        if (!(Number.isInteger(a.minutes) && a.minutes >= 1 && a.minutes <= 600)) return 'Minutos de 1 a 600';
        if (!(a.zones === 'all' || (Array.isArray(a.zones) && a.zones.length && a.zones.length <= 50 && a.zones.every(z => typeof z === 'string' && z.length <= 80)))) return 'Zonas no válidas';
        if (!Number.isFinite(a.from)) return 'Falta desde cuándo';
        if (typeof a.stamp !== 'string' || a.stamp.length > 20000) return 'Falta el resumen confirmado';
        return null;
      case 'flash':
        if (!(typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= 140)) return 'Mensaje vacío o de más de 140 caracteres';
        if (a.to !== undefined && a.to !== null && !(Array.isArray(a.to) && a.to.length <= 3 && a.to.every(v => ['manager', 'confidence', 'backstage'].indexOf(v) >= 0))) return 'Destino del mensaje no válido';
        if (a.zones !== undefined && a.zones !== null && !(Array.isArray(a.zones) && a.zones.length <= 50 && a.zones.every(z => typeof z === 'string' && z.length <= 80))) return 'Zonas del mensaje no válidas';
        return null;
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

  const API = { withBlk, OPS, delayPill, OP_TXT, isBlocked, catsFor, targets, suggest, actionsFor, startedBySchedule, findBlock, realPlan, onTimePlan, stretchPlan, editStartPlan, bisWindow, BIS_MIN, delayPlan, delayStamp, checkCmd, };
  if (isNode) module.exports = API;
  else root.ShowtimeMando = API;
})(typeof window !== 'undefined' ? window : globalThis);
