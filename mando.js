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
  // Idioma (Fase 3): los mensajes de las órdenes salen en español (quedan en el log y en Deshacer) y se traducen al
  // enseñarlos (txBack en el Panel y en el Mando). Solo la píldora de retraso, que no se guarda, sale ya traducida.
  const I18 = () => root.ShowtimeI18n || (isNode ? (() => { try { return require('./i18n.js'); } catch (e) { return null; } })() : null);
  const tx = (s, v) => { const I = I18(); return I ? I.tx(s, v) : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s); };

  const OPS = ['start', 'stop', 'onTime', 'stretch', 'delay', 'flash', 'flashOff', 'callOk', 'chat', 'chatsync'];
  const CATS = ['show', 'sc', 'tarea', 'hito'];

  // ── Bloqueos del menú Retrasos (los mismos que usa el Panel) ──────────
  function blockOf(config, scope) { const b = ((config && config.delayBlock) || {})[scope] || {}; const o = {}; CATS.forEach(k => { o[k] = b[k] === true; }); return o; }
  function isBlocked(config, kind, zoneId) { return !!(blockOf(config, 'all')[kind] || blockOf(config, zoneId || '')[kind]); }

  function allBlocks(state, now) { return state ? C.buildBlocks(state, Number.isFinite(now) ? { mode: 'all', day: 'all', now: now } : { mode: 'all', day: 'all' }) : []; }
  function nEnt(n, adj) { return n + (n === 1 ? ' entrada ' + adj : ' entradas ' + adj + 's'); }
  function keptTxt(n) { return n === 1 ? '1 en rojo no se mueve' : n + ' en rojo no se mueven'; }

  // ── Qué banda se marca ───────────────────────────────────────────────
  /** Bandas (shows y soundchecks con hora) de una zona ('' = sin zona) en la jornada de ese momento, en orden. */
  function targets(state, zoneId, nowAbs, jornada) {
    if (!state) return [];
    // pasado el corte, si una banda sigue sonando, sigue su jornada. Con «Solo hoy» (dec. 105) manda la jornada que emite el Panel.
    const jor = jornada && C.dayIndex(jornada) !== null ? jornada : C.activeJornada(state, Math.floor(nowAbs));
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

  /** Bis (shows) / Extender prueba (soundchecks): rescatar una banda que ya acabó, con Tiempo extra tardío.
   *  Ventana = min(ajuste del regidor, cambio real hasta la siguiente banda de su zona).
   *  Ajuste: CONFIG.bisWindow = 5 · 10 · 15 min (por defecto 10). Cambio real = inicio ESTIMADO de la siguiente − fin de esta.
   *  Si la siguiente ya dio ▶, se acabó. Tareas e hitos: nunca. */
  const BIS_OPTS = [5, 10, 15], BIS_DEFAULT = 10;
  function bisMinutes(cfg) { const v = Number(cfg && cfg.bisWindow); return BIS_OPTS.indexOf(v) >= 0 ? v : BIS_DEFAULT; }
  function bisWindow(state, b, now, cfg) {
    const list = allBlocks(state, now).filter(x => C.isBand(x) && x.psi !== null && x.jornada === b.jornada && (x.stageId || '') === (b.stageId || '') && x.pmi > b.pmi).sort((x, y) => x.pmi - y.pmi);
    const next = list[0] || null, cap = bisMinutes(cfg);
    const end = b.nf !== null && b.nf !== undefined ? b.nf : b.psf;
    const gap = next && next.si !== null && end !== null && end !== undefined ? Math.max(0, Math.floor(next.si - end)) : null;
    return { next, cap, gap, max: gap === null ? cap : Math.min(cap, gap) };
  }
  /** ¿Se puede rescatar ahora? → { ok, kind:'show'|'sc', late, left, max, reason: 'next' (la siguiente ya dio ▶) | 'expired' | 'no' } */
  function bisState(state, b, now, cfg) {
    if (!b || !C.isBand(b) || b.rf !== null || b.alargar || b.nf === null || b.nf === undefined || !(now >= b.nf)) return { ok: false, reason: 'no' };
    const w = bisWindow(state, b, now, cfg), late = Math.floor(now - b.nf), kind = b.kind === 'sc' ? 'sc' : 'show';
    if (w.next && w.next.ri !== null) return { ok: false, reason: 'next', kind, late, max: w.max, next: w.next };
    if (late > w.max) return { ok: false, reason: 'expired', kind, late, max: w.max };
    return { ok: true, kind, late, max: w.max, left: w.max - late, next: w.next };
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
  function stretchPlan(state, key, on, abs, cfg) {
    const now = Number.isFinite(abs) ? Math.floor(abs) : Math.floor(C.nowAbs());
    const b = findBlock(state, key, now);
    if (!b) return { ok: false, error: 'Esa entrada ya no está en el horario' };
    if (!C.isBand(b)) return { ok: false, error: 'Solo los shows y soundchecks tienen Tiempo extra' };
    if (on && b.rf !== null) return { ok: false, error: b.name + ' ya ha terminado' };
    // Bis / Extender prueba: pasada su hora se puede rescatar, solo dentro de la ventana y si la siguiente no ha dado ▶
    let late = null;
    const sc = b.kind === 'sc', what = sc ? 'la prueba de ' + b.name + ' ya no se puede extender' : 'el bis de ' + b.name + ' ya no se puede rescatar';
    if (on && !b.alargar && b.nf !== null && b.nf !== undefined && now >= b.nf) {
      const w = bisWindow(state, b, now, cfg);
      if (w.next && w.next.ri !== null) return { ok: false, error: w.next.name + ' ya ha empezado (▶ ' + C.fmtHM(w.next.ri) + '): ' + what };
      late = Math.floor(now - b.nf);
      if (late > w.max) return { ok: false, error: 'Han pasado ' + late + ' min desde el fin de ' + b.name + ' (' + C.fmtHM(b.nf) + '): ' + what + ' (ventana de ' + w.max + ' min' + (w.gap !== null && w.gap < w.cap ? ', lo que dura el cambio' : '') + ')' };
    }
    const r = C.setAlargar(state, b.id, b.kind === 'sc' ? 'sc' : 'show', !!on); if (!r.ok) return { ok: false, error: r.error };
    if (!r.changed) return { ok: false, error: b.name + (on ? ' ya tiene Tiempo extra' : ' no tenía Tiempo extra') };
    if (late !== null) return { ok: true, state: r.state, late, kind: sc ? 'sc' : 'show', msg: (sc ? 'EXTENDER PRUEBA · ' : 'BIS · ') + b.name + ': Tiempo extra tardío a las ' + C.fmtHM(now) + ' (+' + late + ' min desde su fin, ' + C.fmtHM(b.nf) + '). Vuelve a estar en escena; gasta el colchón y, pasado, retrasa lo que viene de su zona hasta ■' };
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
      case 'chat':
        if (!(typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= 300)) return 'Mensaje vacío o de más de 300 caracteres';
        if (a.name !== undefined && a.name !== null && !(typeof a.name === 'string' && a.name.length <= 40)) return 'Nombre no válido';
        return null;
      case 'chatsync': return null;
    }
    return 'Orden desconocida';
  }

  // ── Mando de UNA zona (dec. 102): solo toca lo suyo ──────────────────
  /** ¿Puede el mando de la zona `zone` dar esta orden? null = sí; si no, el motivo (en español: va al aviso y al log).
   *  zone null/undefined = mando general (todo). La zona la pone el Mac según la clave que firma, nunca el móvil. */
  function zoneDenied(state, cmd, zone) {
    if (zone === null || zone === undefined) return null;
    const a = (cmd && cmd.args) || {}, other = 'Este mando es solo de su zona: no puede tocar otras zonas';
    const inZone = b => !!b && (b.stageId || '') === zone;
    switch (cmd && cmd.op) {
      case 'start': case 'stop': case 'onTime': case 'stretch':
        return inZone(findBlock(state, a.key)) ? null : other;
      case 'callOk':
        return inZone(allBlocks(state).find(b => C.callKey(b) === a.key)) ? null : other;
      case 'delay':
        return Array.isArray(a.zones) && a.zones.length === 1 && a.zones[0] === zone ? null : other;
      case 'flash': {   // a Confidence, solo la de su zona (Manager y Backstage son de todos)
        const toConf = !a.to || a.to.indexOf('confidence') >= 0;
        return !toConf || (Array.isArray(a.zones) && a.zones.length === 1 && a.zones[0] === zone) ? null : other;
      }
    }
    return null;   // flashOff, chat, chatsync
  }
  /** Firma del chat del mando: «[Zona] Nombre» (sin nombre: «[Zona] Stage Manager»; mando general: «[Stage Manager] Nombre»). */
  function chatSign(zoneName, name) {
    const n = String(name || '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const z = String(zoneName || '').replace(/[\[\]]/g, '').trim().slice(0, 40) || 'Stage Manager';
    return '[' + z + '] ' + (n || 'Stage Manager');
  }

  // ── Píldora de retraso por zona (Panel y mando) ─────────────────────
  /** z = una fila de core.delayByZone → { cls: 'ok'|'early'|'acc'|'absorb'|'over', text, title } */
  function delayPill(z, zoneLabel) {
    const nm = zoneLabel || z.zone || tx('Sin zona');
    const who = z.liveBlock ? z.liveBlock.name : '';
    const accT = tx('Retraso acumulado: lo que viene va +{n} min respecto al horario original (retrasos y desbordes ya aplicados)', { n: z.acc });
    if (z.live > 0) {
      const over = z.status === 'overflow';
      return { cls: over ? 'over' : 'absorb', text: nm + ': ' + tx('+{a} min (+{l} vivo)', { a: z.acc, l: z.live }) + (over ? ' · ' + tx('buffer agotado') : ''),
        title: accT + '\n' + tx('Desfase en vivo de {w}: +{n} min', { w: who, n: z.live }) + ' · ' + (over ? tx('desborda el cambio en +{n} min', { n: z.overflow }) : tx('se absorbe en el cambio')) };
    }
    if (z.acc > 0) return { cls: 'acc', text: nm + ': +' + z.acc + ' min', title: accT + (z.early ? '\n' + tx('En vivo: adelanto de {n} min', { n: z.early }) : '') };
    if (z.early > 0) return { cls: 'early', text: nm + ' · ' + tx('En hora (−{n} vivo)', { n: z.early }), title: tx('{w} va {n} min adelantada', { w: who, n: z.early }) };
    return { cls: 'ok', text: nm + ' · ' + tx('En hora'), title: tx('Sin retraso acumulado ni desfase en vivo') };
  }

  const API = { withBlk, OPS, delayPill, isBlocked, targets, suggest, actionsFor, startedBySchedule, findBlock, realPlan, onTimePlan, stretchPlan, editStartPlan, bisWindow, bisState, bisMinutes, BIS_OPTS, BIS_DEFAULT, delayPlan, delayStamp, checkCmd, zoneDenied, chatSign };
  if (isNode) module.exports = API;
  else root.ShowtimeMando = API;
})(typeof window !== 'undefined' ? window : globalThis);
