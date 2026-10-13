/* Showtime Document v1 · motor puro de horario efectivo (B0-impl P2-A; contrato B0 R4.3 §5.5, §5.6.1–5.6.4, §5.6.6).
 *
 *   Schedule.compute(doc, { now, activeLiveEntryIds }) → resultado calculado (nunca se guarda)
 *
 * Puro: no muta `doc` ni `activeLiveEntryIds`, no lee reloj ni almacenamiento, no usa la zona del dispositivo.
 * Mismo documento + mismo `now` + mismos ids activos → exactamente el mismo resultado.
 *
 * Modelo (una sola pasada sobre instantes UTC en ms, en el orden de `delays[]`, §5.6.1): cada ajuste ve el horario que dejaron
 * los anteriores (sus desplazamientos y los ▶ reales).
 *  - `delay`: +minutes a lo que, tras los ajustes anteriores, empieza desde `fromAt` en su `scope` y su jornada.
 *  - `changeover-stretch`: +minutes a su banda destino y a lo posterior de su zona y jornada.
 *  - `overtime` / `bis`: exceso de la banda frente a su fin sin ese ajuste (■ fijo; sin ■ crece con `now` solo si la entrada
 *    tiene directo activo). El colchón se mide hasta la siguiente banda de la zona tal como está en ese momento; lo que sobra
 *    se arrastra a todo lo cronológicamente posterior de la zona, también de la jornada siguiente (R4.1). ▶ manda: una banda
 *    que empezó antes de su estimado pasa menos arrastre, nunca por debajo de su horario previo a ese ajuste.
 *  - Pertenencia a un `delay` (R4.4-1.5): se compara `fromAt` con la POSICIÓN ESTABLE de cada entrada (plan + delay/stretch
 *    anteriores con sus minutos declarados), nunca con el arrastre dinámico de overtime/bis.
 *  - Recuperación por ▶ de B (R4.4-4): cuando la banda destino B de un delay/stretch tiene ▶, esos ajustes aplican solo su
 *    residual: retraso real = min(total declarado, ▶ − inicio base de B sin esos ajustes), repartido FIFO en el orden de delays[].
 *    Es derivado: minutes declarados, Log y documento no cambian.
 * Después se calcula el horario efectivo final y los choques (pisada en el efectivo y no en el plan).
 * La movilidad de cada entrada se decide por ajuste: `fixed` nunca, `free` siempre, `category` con la máscara de la foto
 * `blockPolicy` de ESE ajuste (zona → sin zona → all, sin mezclar campos); lo empezado antes del ajuste no se mueve.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const T = isNode ? require('./time.js') : root.ShowtimeV1Time;
  const Doc = isNode ? require('./document.js') : root.ShowtimeV1Document;

  const MIN = 60000;
  const DEFAULT_DURATION = 60 * MIN;                      // §5.2.1: sin `end`, 60 minutos estimados (nunca se guardan)
  const RANK = { show: 0, soundcheck: 0, task: 1, marker: 2 };
  const isBand = k => k === 'show' || k === 'soundcheck';
  const iso = ms => ms === null || ms === undefined ? null : T.formatUTC(ms);
  const mins = ms => Math.round(ms / MIN);

  /** ¿Está bloqueada esta entrada por la foto `blockPolicy` del ajuste? (§5.6.1: la máscara sustituye a `all`). */
  function maskBlocks(bp, e) {
    let m = bp.all;
    if (e.stageId !== null && bp.stages && Object.prototype.hasOwnProperty.call(bp.stages, e.stageId)) m = bp.stages[e.stageId];
    else if (e.stageId === null && bp.unzoned) m = bp.unzoned;
    return m[e.kind] === true;
  }
  /** Motivo por el que un ajuste NO mueve esta entrada, o null si la mueve. */
  function holdReason(adj, e) {
    if (e.startedAt !== null && e.startedAt <= adj.at) return 'started';     // §5.6.3-2: lo empezado no se mueve
    if (e.mode === 'fixed') return 'fixed';
    if (e.mode === 'free') return null;
    return maskBlocks(adj.blockPolicy, e) ? 'blocked' : null;
  }
  function parseNow(now) {
    if (typeof now === 'number' && Number.isFinite(now)) return Math.floor(now);
    if (typeof now === 'string') { const ms = T.parseUTC(now); if (ms !== null) return ms; }
    throw new TypeError('Schedule.compute: `now` es obligatorio (ms UTC o marca ISO-8601 en UTC con «Z»).');
  }

  /**
   * @param doc  Showtime Document v1 (se valida con document.js; uno inválido lanza error y no se calcula nada).
   * @param opts { now: ms UTC | 'YYYY-MM-DDTHH:MM[:SS]Z' (obligatorio),
   *               activeLiveEntryIds: Set|Array de entryId con directo activo en esta sesión (efímero; por defecto ninguno) }
   * @returns {
   *   now, timeZone,
   *   entries: [ ...una por entrada, en el orden de entries[] (nunca reordenado) ],
   *   zones:   [{ stageId|null, order: [entryId…] }]   orden cronológico efectivo por zona/grupo sin zona,
   *   adjustments: [{ delayId, kind, fromEntryId, declaredMinutes?, residualMinutes?, recoveredMinutes?, recovery? }]   en el orden de delays[]
   *   byId(id) → entrada calculada
   * }
   * Cada entrada: { id, kind, index, stageId, festivalDay, delayMode,
   *   planned:   { start, end, endEstimated, call, callAuto },
   *   effective: { start, end, call },
   *   startedAt, endedAt,                    hechos reales del documento
   *   shiftMinutes, startDeltaMinutes,       minutos sumados por ajustes · efectivo − planificado
   *   contributions: [{ delayId, kind, minutes, recoveredMinutes? }],   ajustes que la movieron (minutos vigentes; recoveredMinutes si hubo recuperación)
   *   held: [{ delayId, kind, reason: 'fixed'|'blocked'|'started' }],   ajustes que la alcanzaban y no la movieron
   *   clash: null | { withEntryId },        no se movió y queda pisada por la banda anterior de su zona (solo se marca)
   *   overrun: null | { delayId, kind, state: 'closed'|'growing'|'idle', excessMinutes, endWithoutOverrun,
   *                     cushionMinutes|null, thresholdMinutes|null, crossedCutoff } }
   */
  function compute(doc, opts) {
    const o = opts || {};
    const now = parseNow(o.now);
    const v = Doc.validate(doc);   // copia normalizada: el documento recibido nunca se toca
    if (!v.ok) throw new Error('Schedule.compute: documento no válido · ' + v.message);
    const P = v.doc.festival.project, ev = P.event;
    const active = new Set(o.activeLiveEntryIds ? Array.from(o.activeLiveEntryIds) : []);
    const ctx = { timeZone: ev.timeZone, dayCutoff: ev.dayCutoff, callMinutes: ev.callMinutes };
    const coMin = new Map(P.stages.map(s => [s.id, (s.changeoverMinutes !== undefined ? s.changeoverMinutes : ev.changeoverMinutes) * MIN]));
    const coMinOf = stageId => stageId === null ? ev.changeoverMinutes * MIN : (coMin.has(stageId) ? coMin.get(stageId) : ev.changeoverMinutes * MIN);

    // ── Base: plan resuelto en event.timeZone ───────────────────────────
    const E = P.entries.map((x, i) => {
      const r = T.resolvePlan(x.plan, ctx, x.kind);
      if (!r.ok) throw new Error('Schedule.compute: plan no resoluble en ' + x.id);   // imposible tras validar
      const marker = x.kind === 'marker';
      const end = marker ? null : (r.end !== null ? r.end : r.start + DEFAULT_DURATION);
      const a = x.actual || {};
      return {
        id: x.id, kind: x.kind, index: i, stageId: x.plan.stageId !== undefined ? x.plan.stageId : null, day: x.plan.date,
        mode: (x.rules && x.rules.delayMode) || 'category',
        S0: r.start, E0: end, endEstimated: !marker && r.end === null, C0: r.call, callAuto: r.callAuto,
        dur: marker ? 0 : end - r.start,
        startedAt: a.startedAt ? T.parseUTC(a.startedAt) : null, endedAt: a.endedAt ? T.parseUTC(a.endedAt) : null,
        off: 0, offStable: 0, contributions: [], held: [], clash: null, overrun: null
      };
    });
    const byId = new Map(E.map(e => [e.id, e]));
    const adjs = P.delays.map(d => Object.assign({}, d, { at: T.parseUTC(d.occurredAt), fromAtMs: d.fromAt ? T.parseUTC(d.fromAt) : null }));
    const orderKey = (a, b, sa, sb) => (sa - sb) || (RANK[a.kind] - RANK[b.kind]) || (a.index - b.index);   // §5.6.3-1
    const sameGroup = (a, b) => a.stageId === b.stageId && a.day === b.day;
    const addContrib = (e, adj, ms) => {
      const c = e.contributions.find(x => x.delayId === adj.id);
      if (c) c.ms += ms; else e.contributions.push({ delayId: adj.id, kind: adj.kind, ms });
    };
    const addHeld = (e, adj, reason) => { if (!e.held.some(h => h.delayId === adj.id)) e.held.push({ delayId: adj.id, kind: adj.kind, reason }); };

    // Instante «actual» de una entrada mientras se aplican ajustes: ▶ si existe; si no, plan + lo aplicado hasta ahora
    const est = e => e.S0 + e.off;
    const cur = e => e.startedAt !== null ? e.startedAt : est(e);
    const zoneOrder = k => E.filter(e => e.stageId === k).sort((a, b) => orderKey(a, b, est(a), est(b)));
    // Fin de una banda sin Tiempo extra/Bis con el horario aplicado hasta ahora (§5.6.3-3/4):
    // empezar tarde no la alarga; empezar antes adelanta su fin.
    const endNoOverrun = e => { const S = cur(e), x = est(e); return Math.max(S, Math.min(S, x) + e.dur); };
    const excessOf = (e, endEst) => {
      if (e.endedAt !== null) return { state: 'closed', O: Math.max(0, e.endedAt - endEst) };
      if (active.has(e.id)) return { state: 'growing', O: Math.max(0, now - endEst) };
      return { state: 'idle', O: 0 };                                                      // sin directo activo: 0, sin reloj
    };
    const move = (e, adj, ms) => {
      const why = holdReason(adj, e);
      if (why) { addHeld(e, adj, why); return false; }
      e.off += ms; addContrib(e, adj, ms); return true;
    };
    const overrunAdj = new Map();
    // Posición estable (R4.4 §A, §R4.4-1.5): plan + delay/changeover-stretch anteriores con sus minutos DECLARADOS;
    // sin hechos actual, sin residual, sin arrastre de overtime/bis. Es lo que se compara con fromAt.
    const stable = e => e.S0 + e.offStable;
    const isStatic = adj => adj.kind === 'delay' || adj.kind === 'changeover-stretch';
    const declared = adj => adj.minutes * MIN;

    /** Una pasada completa por delays[] en su orden (§5.6.1). minutesOf(adj) = ms que aplica ese ajuste (declarados o residual). */
    function applyAdjustments(minutesOf) {
      E.forEach(e => { e.off = 0; e.offStable = 0; e.contributions = []; e.held = []; e.cushionMs = undefined; });
      overrunAdj.clear();
      const moveStatic = (e, adj) => { if (move(e, adj, minutesOf(adj))) e.offStable += declared(adj); };
      adjs.forEach(adj => {
        if (adj.kind === 'delay') {
          const sc = adj.scope, ids = sc.stageIds || null, unz = ids ? sc.includeUnzoned === true : true;
          E.forEach(e => {
            if (e.day !== adj.festivalDay) return;                                         // nunca otra jornada
            if (e.stageId === null ? !unz : (ids && ids.indexOf(e.stageId) < 0)) return;    // fuera de scope
            if (stable(e) < adj.fromAtMs) return;                                         // establemente antes de «desde» (R4.4-1.5)
            moveStatic(e, adj);
          });
        } else if (adj.kind === 'changeover-stretch') {
          const t = byId.get(adj.fromEntryId);
          const group = E.filter(e => sameGroup(e, t)).sort((a, b) => orderKey(a, b, stable(a), stable(b)));
          group.slice(group.indexOf(t)).forEach(e => moveStatic(e, adj));              // la banda destino y lo posterior
        } else {
          // overtime / bis: exceso de la banda frente a su fin sin este ajuste, con el horario aplicado hasta ahora
          const X = byId.get(adj.fromEntryId);
          overrunAdj.set(X.id, adj);
          const endX = endNoOverrun(X), O = excessOf(X, endX).O;
          const list = zoneOrder(X.stageId), after = list.slice(list.indexOf(X) + 1);      // cronológico, transjornada (R4.1)
          let carry = null, cushion = null;    // null = aún no se ha llegado a la siguiente banda
          after.forEach(e => {
            if (isBand(e.kind)) {
              if (carry === null) {            // colchón hasta la siguiente banda, tal como está ahora
                cushion = Math.max(0, (cur(e) - endX) - coMinOf(X.stageId));
                carry = Math.max(0, O - cushion);
              }
              const base = est(e);
              const moved = carry > 0 && move(e, adj, carry);
              // ▶ manda: si empezó antes de su estimado, pasa menos arrastre (nunca por debajo de su horario previo)
              if (e.startedAt !== null && e.startedAt < base + (moved ? carry : 0)) carry = Math.max(0, Math.min(carry, e.startedAt - base));
            } else {
              const ms = carry === null ? Math.max(0, O - Math.max(0, cur(e) - endX)) : carry;   // tareas y marcadores
              if (ms > 0) move(e, adj, ms);
            }
          });
          X.cushionMs = cushion;
        }
      });
    }

    // ── Recuperación derivada por ▶ de B (R4.4-4): residual FIFO de los delay/changeover-stretch que citan a una banda empezada ──
    // Nada de esto se guarda: minutes declarados y Log quedan intactos; el residual se recalcula de los hechos y del orden de delays[].
    const residual = new Map();                                    // adj.id → ms efectivos (ausente = declarados)
    const declaredOf = new Map(adjs.filter(isStatic).map(a => [a.id, declared(a)]));
    const minutesOf = adj => residual.has(adj.id) ? residual.get(adj.id) : declared(adj);
    const recovery = new Map();                                    // B.id → { base, real, total }
    const citing = new Map();                                      // B.id → ajustes estáticos que la citan, en orden de delays[]
    adjs.filter(isStatic).forEach(adj => { const B = byId.get(adj.fromEntryId); if (B && B.startedAt !== null) { if (!citing.has(B.id)) citing.set(B.id, []); citing.get(B.id).push(adj); } });
    if (citing.size) {
      // Punto fijo: el inicio base de una B puede depender del residual de otra B' (si un ajuste de B' la alcanza)
      for (let round = 0; round <= citing.size; round++) {
        let changed = false;
        citing.forEach((list, Bid) => {
          const B = byId.get(Bid), suppressed = new Set(list.map(a => a.id));
          // Inicio base de B (§A): el horario vigente SIN las contribuciones de los ajustes que citan a B, nunca antes de su plan.
          // El ▶ de B se ignora durante este cálculo (C2-R1): la base conserva las causas de OTRAS bandas (sus delays, stretches,
          // overtime/bis y hechos) tal como alcanzarían a una B aún no empezada; el ▶ real solo entra después, en retrasoRealB.
          const startedAtB = B.startedAt; B.startedAt = null;
          applyAdjustments(adj => suppressed.has(adj.id) ? 0 : minutesOf(adj));
          const base = Math.max(B.S0, est(B));
          B.startedAt = startedAtB;
          const total = list.reduce((s, a) => s + declared(a), 0);
          let real = Math.min(total, Math.max(0, startedAtB - base));               // retrasoRealB, limitado al total declarado
          recovery.set(Bid, { base, real, total });
          list.forEach(adj => {                                                    // reparto FIFO: del más antiguo al más reciente
            const take = Math.min(declared(adj), real); real -= take;
            if (minutesOf(adj) !== take) { residual.set(adj.id, take); changed = true; }
          });
        });
        if (!changed) break;
      }
    }
    applyAdjustments(minutesOf);

    // ── Horario efectivo final ──
    E.forEach(e => {
      e.S = cur(e);
      if (isBand(e.kind)) {
        const endEst = endNoOverrun(e), adj = overrunAdj.get(e.id) || null;
        if (!adj) e.E = e.endedAt !== null ? Math.min(e.endedAt, endEst) : endEst;          // parada a su hora
        else {
          const x = excessOf(e, endEst);
          e.E = e.endedAt !== null ? e.endedAt : endEst + x.O;
          e.overrun = {
            delayId: adj.id, kind: adj.kind, state: x.state, excessMinutes: mins(x.O), endWithoutOverrun: iso(endEst),
            cushionMinutes: e.cushionMs === null || e.cushionMs === undefined ? null : mins(e.cushionMs),
            thresholdMinutes: x.state === 'growing' && x.O >= 60 * MIN ? Math.floor(x.O / (60 * MIN)) * 60 : null,
            crossedCutoff: x.state === 'growing' && T.festivalDay(now, ev.timeZone, ev.dayCutoff) > e.day
          };
        }
      } else e.E = e.kind === 'marker' ? null : (e.endedAt !== null ? e.endedAt : e.S + e.dur);
    });

    // ── Choques (§5.6.3-7): intersección NUEVA entre el intervalo efectivo de una banda y otra entrada de su zona
    //    (un marcador es un punto). Si ya se cruzaban en el plan, no es un choque nuevo. Se marca; nunca se corrige ni se guarda.
    //    · Banda contra tarea o marcador: cuenta cualquier intersección, empiece antes quien empiece (una banda que da ▶
    //      antes de tiempo pisa la tarea anterior).
    //    · Banda contra banda: la pisada es la que empieza después en el orden efectivo (la otra se alarga sobre ella).
    //    · Varias candidatas: withEntryId es la primera en el orden efectivo de la zona (inicio, categoría, posición en
    //      entries[]): la primera banda que la pisa.
    const meets = (aS, aE, bS, bE) => bE === null ? (aS <= bS && bS < aE) : (aS < bE && bS < aE);
    const zonesOut = [];
    const zoneKeys = [];
    E.forEach(e => { if (zoneKeys.indexOf(e.stageId) < 0) zoneKeys.push(e.stageId); });
    zoneKeys.forEach(k => {
      const list = E.filter(e => e.stageId === k).sort((a, b) => orderKey(a, b, a.S, b.S));
      zonesOut.push({ stageId: k, order: list.map(e => e.id) });
      list.forEach((e, i) => {
        const hit = list.find((P, j) => {
          if (P === e || !isBand(P.kind)) return false;
          if (isBand(e.kind) && j > i) return false;                                          // banda contra banda: pisa la anterior
          return meets(P.S, P.E, e.S, e.E) && !meets(P.S0, P.E0, e.S0, e.E0);
        });
        e.clash = hit ? { withEntryId: hit.id } : null;
      });
    });

    // ── Resultado (nada de esto se escribe en el documento: §5.6.6) ──
    const out = E.map(e => ({
      id: e.id, kind: e.kind, index: e.index, stageId: e.stageId, festivalDay: e.day, delayMode: e.mode,
      planned: { start: iso(e.S0), end: iso(e.E0), endEstimated: e.endEstimated, call: iso(e.C0), callAuto: e.callAuto },
      effective: { start: iso(e.S), end: iso(e.E), call: e.C0 === null ? null : iso(e.C0 + (e.S - e.S0)) },   // el CALL va con su entrada
      startedAt: iso(e.startedAt), endedAt: iso(e.endedAt),
      shiftMinutes: mins(e.contributions.reduce((s, c) => s + c.ms, 0)), startDeltaMinutes: mins(e.S - e.S0),
      contributions: e.contributions.map(c => { const o = { delayId: c.delayId, kind: c.kind, minutes: mins(c.ms) }; if (residual.has(c.delayId)) o.recoveredMinutes = mins(declaredOf.get(c.delayId) - c.ms); return o; }),
      held: e.held.map(h => Object.assign({}, h)),
      clash: e.clash, overrun: e.overrun
    }));
    const index = new Map(out.map(x => [x.id, x]));
    // Ajustes con su efecto vigente: residual y recuperación por ▶ de su B (solo salida; §R4.4-4.9)
    const adjustments = adjs.map(adj => {
      const o = { delayId: adj.id, kind: adj.kind, fromEntryId: adj.fromEntryId };
      if (isStatic(adj)) {
        const rec = recovery.get(adj.fromEntryId) || null;
        o.declaredMinutes = adj.minutes; o.residualMinutes = mins(minutesOf(adj)); o.recoveredMinutes = adj.minutes - o.residualMinutes;
        o.recovery = rec ? { baseStart: iso(rec.base), realDelayMinutes: mins(rec.real), totalDeclaredMinutes: mins(rec.total) } : null;
      }
      return o;
    });
    return { now: iso(now), timeZone: ev.timeZone, entries: out, zones: zonesOut, adjustments, byId: id => index.get(id) || null };
  }

  const api = { compute, DEFAULT_DURATION_MINUTES: 60 };
  if (isNode) module.exports = api;
  else root.ShowtimeV1Schedule = api;
})(typeof window !== 'undefined' ? window : this);
