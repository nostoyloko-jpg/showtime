/* Showtime Document v1 · tiempo zonal puro (contrato B0 R4.3, §5.1 y §5.2.2–5.2.4).
 *
 * Todo se resuelve con la zona IANA del documento (`event.timeZone`), nunca con la del dispositivo:
 *  - no se construye ningún Date a partir de una cadena local ni con new Date(año, mes, …);
 *  - la aritmética de calendario se hace con Date.UTC (fechas civiles, sin zona);
 *  - las horas locales se resuelven buscando las ocurrencias UTC exactas con Intl.DateTimeFormat (formatToParts).
 * Sin DOM ni dependencias: se carga igual en el navegador (window.ShowtimeV1Time) y en Node (require).
 */
(function (root) {
  'use strict';

  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/;

  // ── Fechas civiles (sin zona) ─────────────────────────────────────────
  /** 'YYYY-MM-DD' de un calendario gregoriano real → número de día (días desde 1970-01-01), o null. */
  function dayNumber(s) {
    const m = typeof s === 'string' && DATE_RE.exec(s);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;   // 2027-02-30 no existe
    return Math.round(t / DAY);
  }
  function isDate(s) { return dayNumber(s) !== null; }
  function dateOfDayNumber(n) {
    const d = new Date(n * DAY);
    return d.getUTCFullYear().toString().padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function addDays(date, n) { const k = dayNumber(date); return k === null ? null : dateOfDayNumber(k + n); }

  // ── Horas y marcas UTC ────────────────────────────────────────────────
  function isHM(s) { return typeof s === 'string' && HM_RE.test(s); }
  function hmMinutes(s) { const m = HM_RE.exec(s); return m ? +m[1] * 60 + +m[2] : null; }
  /** ISO-8601 UTC con «Z», con o sin segundos, valores reales → ms, o null. */
  function parseUTC(s) {
    const m = typeof s === 'string' && UTC_RE.exec(s);
    if (!m) return null;
    if (dayNumber(m[1] + '-' + m[2] + '-' + m[3]) === null) return null;
    const h = +m[4], mi = +m[5], se = m[6] === undefined ? 0 : +m[6];
    if (h > 23 || mi > 59 || se > 59) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], h, mi, se);
  }
  /** ms → 'YYYY-MM-DDTHH:MM:SSZ' (forma de guardado del §3.2). */
  function formatUTC(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  // ── Zona IANA ─────────────────────────────────────────────────────────
  const FMT = new Map();
  function formatter(tz) {
    let f = FMT.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      FMT.set(tz, f);
    }
    return f;
  }
  /** ¿Identificador IANA que reconoce el motor de zonas? Los desfases fijos («+01:00») no son identificadores IANA. */
  function isTimeZone(tz) {
    if (typeof tz !== 'string' || !tz || /^[+-]/.test(tz) || /\s/.test(tz)) return false;
    try { formatter(tz); return true; } catch (e) { return false; }
  }
  /** Hora local (fecha civil y minutos) de un instante UTC en la zona. */
  function localParts(ms, tz) {
    const p = {};
    formatter(tz).formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
    const hour = +p.hour === 24 ? 0 : +p.hour;   // algunos motores escriben 24:00
    return { date: p.year.padStart(4, '0') + '-' + p.month + '-' + p.day, minutes: hour * 60 + (+p.minute), second: +p.second };
  }
  function offsetAt(ms, tz) {
    const lp = localParts(ms, tz);
    return dayNumber(lp.date) * DAY + lp.minutes * MIN + lp.second * 1000 - ms;
  }
  /** Todas las ocurrencias UTC (ordenadas) de la hora local `hm` en la fecha civil `date`: [] = hueco de cambio horario,
   *  1 = normal, 2 = hora repetida. Determinista: prueba los desfases que la zona tiene alrededor de esa fecha. */
  function occurrences(date, hm, tz) {
    const k = dayNumber(date), mins = hmMinutes(hm);
    if (k === null || mins === null) return [];
    const wall = k * DAY + mins * MIN;   // la hora local escrita como si fuera UTC
    const offs = new Set();
    for (let d = -36; d <= 36; d += 6) offs.add(offsetAt(wall + d * HOUR, tz));
    const out = [];
    offs.forEach(o => {
      const t = wall - o, lp = localParts(t, tz);
      if (lp.date === date && lp.minutes === mins && lp.second === 0 && out.indexOf(t) < 0) out.push(t);
    });
    return out.sort((a, b) => a - b);
  }
  /** Primera ocurrencia (regla 6: una hora repetida es su primera ocurrencia) o null si no existe (regla 5). */
  function firstOccurrence(date, hm, tz) { const o = occurrences(date, hm, tz); return o.length ? o[0] : null; }

  // ── Jornada (§5.1) ────────────────────────────────────────────────────
  /** Jornada de un instante UTC: hora local < corte → día civil anterior. */
  function festivalDay(ms, tz, cutoff) {
    const lp = localParts(ms, tz);
    return lp.minutes < hmMinutes(cutoff) ? addDays(lp.date, -1) : lp.date;
  }

  // ── Plan (§5.2.2–5.2.4) ───────────────────────────────────────────────
  /** Resuelve inicio, fin y CALL de un plan. ctx: { timeZone, dayCutoff, callMinutes }.
   *  → { ok:true, start, end|null, call|null, callAuto:boolean } en ms UTC, o { ok:false, rule, message }. */
  function resolvePlan(plan, ctx, kind) {
    const tz = ctx.timeZone, cut = hmMinutes(ctx.dayCutoff);
    const D = plan.date, sMin = hmMinutes(plan.start);
    const startCivil = sMin < cut ? addDays(D, 1) : D;   // regla 1
    const start = firstOccurrence(startCivil, plan.start, tz);
    if (start === null) return fail('start', 'La hora de inicio ' + plan.start + ' no existe el ' + startCivil + ' en ' + tz + ' (cambio de hora).');
    let end = null;
    if (plan.end !== undefined) {   // regla 2: primer instante con esa hora estrictamente posterior al inicio
      const eMin = hmMinutes(plan.end);
      if (eMin === sMin) return fail('end', 'El fin no puede ser igual al inicio (' + plan.end + ').');
      let civil = startCivil, t = firstOccurrence(civil, plan.end, tz);
      if (t === null && eMin > sMin) return fail('end', 'La hora de fin ' + plan.end + ' no existe el ' + civil + ' en ' + tz + ' (cambio de hora).');
      if (t === null || t <= start) {
        civil = addDays(startCivil, 1); t = firstOccurrence(civil, plan.end, tz);
        if (t === null) return fail('end', 'La hora de fin ' + plan.end + ' no existe el ' + civil + ' en ' + tz + ' (cambio de hora).');
      }
      if (!(t > start && t < start + DAY)) return fail('end', 'El fin debe ser posterior al inicio y a menos de 24 h.');   // regla 4
      end = t;
    }
    let call = null, callAuto = false;
    if (plan.call !== undefined) {   // regla 3: último instante con esa hora anterior o igual al inicio
      const cMin = hmMinutes(plan.call);
      let civil = startCivil, t = firstOccurrence(civil, plan.call, tz);
      if (t === null && cMin <= sMin) return fail('call', 'La hora de CALL ' + plan.call + ' no existe el ' + civil + ' en ' + tz + ' (cambio de hora).');
      if (t === null || t > start) {
        civil = addDays(startCivil, -1); t = firstOccurrence(civil, plan.call, tz);
        if (t === null) return fail('call', 'La hora de CALL ' + plan.call + ' no existe el ' + civil + ' en ' + tz + ' (cambio de hora).');
      }
      call = t;
    } else if (kind === 'show' || kind === 'soundcheck') {   // §5.2.4: CALL automático, no se guarda
      call = start - (ctx.callMinutes || 0) * MIN; callAuto = true;
    }
    return { ok: true, start, end, call, callAuto };
    function fail(rule, message) { return { ok: false, rule, message }; }
  }

  const api = { MIN, HOUR, DAY, isDate, dayNumber, dateOfDayNumber, addDays, isHM, hmMinutes, parseUTC, formatUTC,
    isTimeZone, localParts, occurrences, firstOccurrence, festivalDay, resolvePlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShowtimeV1Time = api;
})(typeof window !== 'undefined' ? window : this);
