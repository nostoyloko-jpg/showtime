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
   *   byId(id) → entrada calculada
   * }
   * Cada entrada: { id, kind, index, stageId, festivalDay, delayMode,
   *   planned:   { start, end, endEstimated, call, callAuto },
   *   effective: { start, end, call },
   *   startedAt, endedAt,                    hechos reales del documento
   *   shiftMinutes, startDeltaMinutes,       minutos sumados por ajustes · efectivo − planificado
   *   contributions: [{ delayId, kind, minutes }],   ajustes que la movieron (los de arrastre, con lo recibido)
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
        off: 0, contributions: [], held: [], clash: null, overrun: null
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

    // ── Ajustes en el orden de delays[] (§5.6.1): cada uno ve el horario que dejaron los anteriores ──
    adjs.forEach(adj => {
      if (adj.kind === 'delay') {
        const sc = adj.scope, ids = sc.stageIds || null, unz = ids ? sc.includeUnzoned === true : true;
        E.forEach(e => {
          if (e.day !== adj.festivalDay) return;                                         // nunca otra jornada
          if (e.stageId === null ? !unz : (ids && ids.indexOf(e.stageId) < 0)) return;    // fuera de scope
          if (est(e) < adj.fromAtMs) return;                                            // empieza antes de «desde» (tras los ajustes anteriores)
          move(e, adj, adj.minutes * MIN);
        });
      } else if (adj.kind === 'changeover-stretch') {
        const t = byId.get(adj.fromEntryId);
        const group = E.filter(e => sameGroup(e, t)).sort((a, b) => orderKey(a, b, est(a), est(b)));
        group.slice(group.indexOf(t)).forEach(e => move(e, adj, adj.minutes * MIN));   // la banda destino y lo posterior
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
      contributions: e.contributions.map(c => ({ delayId: c.delayId, kind: c.kind, minutes: mins(c.ms) })),
      held: e.held.map(h => Object.assign({}, h)),
      clash: e.clash, overrun: e.overrun
    }));
    const index = new Map(out.map(x => [x.id, x]));
    return { now: iso(now), timeZone: ev.timeZone, entries: out, zones: zonesOut, byId: id => index.get(id) || null };
  }

  const api = { compute, DEFAULT_DURATION_MINUTES: 60 };
  if (isNode) module.exports = api;
  else root.ShowtimeV1Schedule = api;
})(typeof window !== 'undefined' ? window : this);
