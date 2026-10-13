/* Showtime Document v1 · modelo puro (contrato B0 R4.3 canónico).
 *
 * Validación cerrada y no destructiva (§3–§7), valores por defecto (§5, §6.2), normalización al guardar, creación,
 * Duplicar (§10) y clasificación de lo que no es v1 (§9.3–§9.4). Sin DOM: se carga en el navegador
 * (window.ShowtimeV1Document) y en Node (require). Nada de aquí lee ni escribe almacenamiento.
 *
 * Fronteras de P1: valida la FORMA de delays[], Log y snapshots, pero no calcula horarios efectivos, Live, avisos ni
 * snapshots nuevos (P2/P3). El documento devuelto es siempre una copia nueva: la entrada nunca se modifica.
 */
(function (root) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./time.js') : root.ShowtimeV1Time;

  const FORMAT = 'showtime-document';
  const VERSION = 1;
  const MIME = 'application/vnd.showtime+json';
  const EXT = '.showtime';
  const MAX_DAYS = 120;
  const LOGO_MAX = 262144;
  const KINDS = ['show', 'soundcheck', 'task', 'marker'];
  const DELAY_KINDS = ['delay', 'overtime', 'bis', 'changeover-stretch'];
  const DELAY_MODES = ['category', 'free', 'fixed'];
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const PERSON_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const ENTRY_LOG_TYPES = ['entry-added', 'entry-updated', 'entry-deleted', 'actual-start', 'actual-end', 'actual-end-retracted', 'standby-started', 'standby-ended', 'call-confirmed', 'delay-applied', 'delay-removed'];

  // ── Errores ───────────────────────────────────────────────────────────
  /** Error de validación: el documento entero se rechaza. path: dónde; message: qué regla, en español, sin volcar datos. */
  function DocError(path, message) { this.name = 'DocError'; this.path = path; this.message = message; }
  DocError.prototype = Object.create(Error.prototype);
  function fail(path, message) { throw new DocError(path, message); }

  // ── Utilidades ────────────────────────────────────────────────────────
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  /** Copia las claves desconocidas tal cual (§3.1): mismo objeto, mismo valor JSON. */
  function unknownKeys(src, known, out) { Object.keys(src).forEach(k => { if (known.indexOf(k) < 0) out[k] = clone(src[k]); }); return out; }
  const isInt = v => typeof v === 'number' && Number.isInteger(v);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isDec1 = v => isNum(v) && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
  const q = s => '«' + String(s).slice(0, 60) + '»';

  function reqObj(v, path) { if (!isObj(v)) fail(path, 'Debe ser un objeto.'); return v; }
  function reqArr(v, path) { if (!Array.isArray(v)) fail(path, 'Debe ser una lista.'); return v; }
  function text(v, path) { if (typeof v !== 'string' || !v.trim()) fail(path, 'Texto obligatorio: no puede estar vacío.'); return v.trim(); }
  function optString(v, path) { if (typeof v !== 'string') fail(path, 'Debe ser texto.'); return v; }
  function ident(v, path) { if (typeof v !== 'string' || v === '') fail(path, 'Identificador: texto no vacío.'); return v; }
  function date(v, path) { if (!T.isDate(v)) fail(path, 'Fecha no válida (YYYY-MM-DD, fecha real).'); return v; }
  function hm(v, path) { if (!T.isHM(v)) fail(path, 'Hora no válida (HH:MM, de 00:00 a 23:59).'); return v; }
  function utc(v, path) { const ms = T.parseUTC(v); if (ms === null) fail(path, 'Marca de tiempo no válida (ISO-8601 en UTC con «Z»).'); return ms; }
  function color(v, path) { if (typeof v !== 'string' || !COLOR_RE.test(v)) fail(path, 'Color no válido: # y 6 dígitos hexadecimales.'); return v.toLowerCase(); }
  function int(v, path, min, max) { if (!isInt(v) || v < min || v > max) fail(path, 'Debe ser un entero de ' + min + ' a ' + max + '.'); return v; }
  function bool(v, path) { if (typeof v !== 'boolean') fail(path, 'Debe ser verdadero o falso.'); return v; }
  function oneOf(v, list, path) { if (list.indexOf(v) < 0) fail(path, 'Valor no admitido: ' + list.map(x => JSON.stringify(x)).join(', ') + '.'); return v; }
  function unique(list, keyOf, path, what) {
    const seen = new Set();
    list.forEach((x, i) => { const k = keyOf(x); if (seen.has(k)) fail(path + '[' + i + ']', what + ' repetido: ' + q(k) + '.'); seen.add(k); });
  }

  // ── Raíz y clasificación (§3, §9.2–§9.4) ─────────────────────────────
  /** Lee el texto de un archivo. Nunca adivina ni convierte: clasifica.
   *  → { ok:true, doc, warnings } · { ok:false, kind:'invalid-json'|'foreign'|'legacy'|'future'|'invalid', message, path? } */
  function parseDocument(textIn) {
    let raw;
    try { raw = JSON.parse(String(textIn).replace(/^\uFEFF/, '')); }
    catch (e) { return { ok: false, kind: 'invalid-json', message: 'El archivo no es JSON válido: está dañado o no es texto JSON.' }; }
    if (!isObj(raw)) return { ok: false, kind: 'foreign', message: 'Es JSON, pero no es un Showtime Document.' };
    if (!has(raw, 'format')) {
      if (isObj(raw.event) && Array.isArray(raw.artists) && Array.isArray(raw.escenarios))
        return { ok: false, kind: 'legacy', message: 'Es un JSON de Showtime anterior a v1. Showtime Document v1 no lo abre ni lo migra.' };
      return { ok: false, kind: 'foreign', message: 'Es JSON, pero no es un Showtime Document.' };
    }
    if (raw.format !== FORMAT) return { ok: false, kind: 'foreign', message: 'Es JSON, pero no es un Showtime Document.' };
    if (!isInt(raw.formatVersion) || raw.formatVersion < 1) return { ok: false, kind: 'invalid', path: 'formatVersion', message: 'formatVersion: debe ser un entero positivo.' };
    if (raw.formatVersion > VERSION)
      return { ok: false, kind: 'future', message: 'Es un Showtime Document de una versión posterior (' + raw.formatVersion + '). Esta versión no lo abre, no lo rebaja ni lo guarda.' };
    const r = validate(raw);
    if (!r.ok) return { ok: false, kind: 'invalid', path: r.path, message: r.message };
    return { ok: true, doc: r.doc, warnings: r.warnings };
  }

  /** Valida un documento v1 completo y devuelve su forma normalizada (copia nueva).
   *  → { ok:true, doc, warnings } · { ok:false, path, message } */
  function validate(raw) {
    try {
      const warnings = [];
      const doc = normalizeRoot(raw, warnings);
      return { ok: true, doc, warnings };
    } catch (e) {
      if (e instanceof DocError) return { ok: false, path: e.path, message: (e.path ? e.path + ': ' : '') + e.message };
      throw e;
    }
  }

  function normalizeRoot(raw, warnings) {
    reqObj(raw, '');
    if (raw.format !== FORMAT) fail('format', 'Debe ser exactamente "' + FORMAT + '".');
    if (raw.formatVersion !== VERSION) fail('formatVersion', 'Esta versión solo conoce la 1.');
    if (typeof raw.festivalId !== 'string' || !UUID_RE.test(raw.festivalId)) fail('festivalId', 'UUID no válido (36 caracteres hexadecimales 8-4-4-4-12).');
    const out = unknownKeys(raw, ['format', 'formatVersion', 'festivalId', 'festival', 'eventLog', 'protectedAccess'], {});
    out.format = FORMAT; out.formatVersion = VERSION; out.festivalId = raw.festivalId.toLowerCase();
    const fest = reqObj(raw.festival, 'festival');
    const f = unknownKeys(fest, ['project', 'configuration'], {});
    const ctx = {};
    f.project = normalizeProject(reqObj(fest.project, 'festival.project'), ctx);
    f.configuration = normalizeConfiguration(reqObj(fest.configuration, 'festival.configuration'), ctx);
    out.festival = f;
    out.eventLog = normalizeLog(reqObj(raw.eventLog, 'eventLog'), ctx);
    if (has(raw, 'protectedAccess')) out.protectedAccess = clone(reqObj(raw.protectedAccess, 'protectedAccess'));   // opaco (§8)
    filterLogo(out.festival.project.event, warnings);   // §5.7: el único campo que no invalida el documento
    return out;
  }

  // ── Proyecto (§5) ─────────────────────────────────────────────────────
  function normalizeProject(p, ctx) {
    const out = unknownKeys(p, ['event', 'stages', 'entries', 'delays'], {});
    out.event = normalizeEvent(reqObj(p.event, 'festival.project.event'), ctx);
    out.stages = normalizeStages(reqArr(p.stages, 'festival.project.stages'), ctx);
    out.entries = normalizeEntries(reqArr(p.entries, 'festival.project.entries'), ctx);
    out.delays = normalizeDelays(reqArr(p.delays, 'festival.project.delays'), ctx);
    return out;
  }

  function normalizeEvent(e, ctx) {
    const P = 'festival.project.event';
    const out = unknownKeys(e, ['name', 'startDate', 'endDate', 'timeZone', 'dayCutoff', 'callMinutes', 'changeoverMinutes', 'branding'], {});
    out.name = text(e.name, P + '.name');
    out.startDate = date(e.startDate, P + '.startDate');
    out.endDate = date(e.endDate, P + '.endDate');
    const days = T.dayNumber(out.endDate) - T.dayNumber(out.startDate) + 1;
    if (days < 1) fail(P + '.endDate', 'La última jornada no puede ser anterior a la primera.');
    if (days > MAX_DAYS) fail(P + '.endDate', 'Como máximo ' + MAX_DAYS + ' jornadas.');
    if (!T.isTimeZone(e.timeZone)) fail(P + '.timeZone', 'Zona horaria IANA no reconocida (p. ej. Europe/Madrid).');
    out.timeZone = e.timeZone;
    out.dayCutoff = has(e, 'dayCutoff') ? hm(e.dayCutoff, P + '.dayCutoff') : '06:00';
    out.callMinutes = has(e, 'callMinutes') ? int(e.callMinutes, P + '.callMinutes', 0, 180) : 15;
    out.changeoverMinutes = has(e, 'changeoverMinutes') ? int(e.changeoverMinutes, P + '.changeoverMinutes', 0, 180) : 15;
    if (has(e, 'branding')) {
      const b = reqObj(e.branding, P + '.branding');
      out.branding = unknownKeys(b, ['logo'], {});
      if (has(b, 'logo')) out.branding.logo = clone(b.logo);   // se filtra al final (§5.7)
    }
    Object.assign(ctx, { timeZone: out.timeZone, dayCutoff: out.dayCutoff, callMinutes: out.callMinutes, startDate: out.startDate, endDate: out.endDate });
    return out;
  }

  function normalizeStages(list, ctx) {
    const P = 'festival.project.stages';
    const out = list.map((s, i) => {
      const p = P + '[' + i + ']';
      reqObj(s, p);
      const o = unknownKeys(s, ['id', 'name', 'color', 'position', 'changeoverMinutes'], {});
      o.id = ident(s.id, p + '.id');
      o.name = text(s.name, p + '.name');
      o.color = color(s.color, p + '.color');
      o.position = int(s.position, p + '.position', 0, Number.MAX_SAFE_INTEGER);
      if (has(s, 'changeoverMinutes')) o.changeoverMinutes = int(s.changeoverMinutes, p + '.changeoverMinutes', 0, 180);
      return o;
    });
    unique(out, s => s.id, P, 'id de zona');
    unique(out, s => s.position, P, 'position de zona');
    ctx.stageIds = new Set(out.map(s => s.id));
    return out;
  }

  // Campos de plan por kind (§5.2.1)
  const PLAN_FIELDS = {
    show: { end: true, call: true }, soundcheck: { end: true, call: true }, task: { end: true, call: false }, marker: { end: false, call: false }
  };
  function entryLabel(P, i, e) { return P + '[' + i + ']' + (isObj(e) && typeof e.id === 'string' && e.id ? ' (id ' + q(e.id) + ')' : ''); }

  function normalizeEntries(list, ctx) {
    const P = 'festival.project.entries';
    const out = list.map((e, i) => {
      const p = entryLabel(P, i, e);
      reqObj(e, p);
      const o = unknownKeys(e, ['id', 'kind', 'name', 'plan', 'actual', 'rules'], {});
      o.id = ident(e.id, p + '.id');
      o.kind = oneOf(e.kind, KINDS, p + '.kind');
      o.name = text(e.name, p + '.name');
      o.plan = normalizePlan(reqObj(e.plan, p + '.plan'), o.kind, p + '.plan', ctx);
      if (has(e, 'actual')) { const a = normalizeActual(e.actual, o.kind, p + '.actual'); if (a) o.actual = a; }
      if (has(e, 'rules')) {
        const r = reqObj(e.rules, p + '.rules');
        o.rules = unknownKeys(r, ['delayMode'], {});   // rules.linkedEntryId no es v1: se conserva sin efecto (§5.4)
        if (has(r, 'delayMode')) o.rules.delayMode = oneOf(r.delayMode, DELAY_MODES, p + '.rules.delayMode');
      }
      return o;
    });
    unique(out, e => e.id, P, 'id de entrada');
    ctx.entries = new Map(out.map(e => [e.id, e]));
    return out;
  }

  const PLAN_KEYS = ['stageId', 'date', 'start', 'end', 'call', 'notes', 'color'];
  /** Plan de una entrada viva del proyecto (§5.2): zonas existentes, zona obligatoria para bandas y jornada en rango. */
  function normalizePlan(pl, kind, p, ctx) { return planShape(pl, kind, p, ctx, 'live'); }
  /** Plan histórico (snapshot, Log entry-added/entry-deleted): misma forma por kind y misma resolución horaria (§5.2.1–5.2.2),
   *  pero la zona citada puede no existir hoy y no se exige zona a una banda (puede venir de una estructura ya borrada). */
  function historicalPlan(pl, kind, p, ctx) { return planShape(pl, kind, p, ctx, 'history'); }
  /** mode: 'live' | 'history' | 'diff' (entry-updated: solo los campos cambiados; kind null si no es determinable). */
  function planShape(pl, kind, p, ctx, mode) {
    reqObj(pl, p);
    const F = kind ? PLAN_FIELDS[kind] : null;
    const o = unknownKeys(pl, PLAN_KEYS, {});
    const band = kind === 'show' || kind === 'soundcheck';
    if (has(pl, 'stageId')) {
      ident(pl.stageId, p + '.stageId');
      if (mode === 'live' && !ctx.stageIds.has(pl.stageId)) fail(p + '.stageId', 'La zona ' + q(pl.stageId) + ' no existe.');
      o.stageId = pl.stageId;   // en historia, la zona citada puede no existir ya
    } else if (mode === 'live' && band && ctx.stageIds.size) fail(p + '.stageId', 'Un ' + kind + ' necesita zona cuando el festival tiene zonas.');
    if (mode !== 'diff' || has(pl, 'date')) o.date = date(pl.date, p + '.date');
    if (mode === 'live' && (T.dayNumber(o.date) < T.dayNumber(ctx.startDate) || T.dayNumber(o.date) > T.dayNumber(ctx.endDate))) fail(p + '.date', 'La jornada debe estar entre startDate y endDate.');
    if (mode !== 'diff' || has(pl, 'start')) o.start = hm(pl.start, p + '.start');
    // Campo prohibido presente (también null o "") → inválido (§5.2.1)
    if (has(pl, 'end')) { if (F && !F.end) fail(p + '.end', 'Un ' + kind + ' no lleva fin.'); o.end = hm(pl.end, p + '.end'); }
    if (has(pl, 'call')) { if (F && !F.call) fail(p + '.call', 'Un ' + kind + ' no lleva CALL.'); o.call = hm(pl.call, p + '.call'); }
    if (has(pl, 'notes')) o.notes = optString(pl.notes, p + '.notes');
    if (has(pl, 'color')) o.color = color(pl.color, p + '.color');
    if (has(o, 'date') && has(o, 'start')) {   // §5.2.2: reglas 1–7 en event.timeZone
      const r = T.resolvePlan(o, ctx, kind || 'task');
      if (!r.ok) fail(p + '.' + r.rule, r.message);
    }
    return o;
  }

  /** §5.3: ausente, {} y nulos = sin hecho real. Devuelve la forma mínima o null. */
  function normalizeActual(a, kind, p) {
    reqObj(a, p);
    const o = unknownKeys(a, ['startedAt', 'endedAt'], {});
    let s = null, e = null;
    if (has(a, 'startedAt') && a.startedAt !== null) { s = utc(a.startedAt, p + '.startedAt'); o.startedAt = T.formatUTC(s); }
    if (has(a, 'endedAt') && a.endedAt !== null) { e = utc(a.endedAt, p + '.endedAt'); o.endedAt = T.formatUTC(e); }
    if (e !== null && s === null) fail(p + '.endedAt', 'Un fin real necesita un inicio real.');
    if (e !== null && !(e > s)) fail(p + '.endedAt', 'El fin real debe ser posterior al inicio real.');
    if (kind === 'marker' && (s !== null || e !== null)) fail(p, 'Un marker no tiene hechos reales.');
    return Object.keys(o).length ? o : null;
  }

  // ── delays[] (§5.6): forma y referencias; el efecto lo calcula P2 ─────
  function mask(v, p) {
    reqObj(v, p);
    const keys = Object.keys(v);
    if (keys.length !== 4 || KINDS.some(k => typeof v[k] !== 'boolean')) fail(p, 'Máscara: exactamente los cuatro booleanos show, soundcheck, task y marker.');
    return { show: v.show, soundcheck: v.soundcheck, task: v.task, marker: v.marker };
  }
  function normalizeDelays(list, ctx) {
    const P = 'festival.project.delays';
    let prev = -Infinity;
    const openPerEntry = new Map();
    const out = list.map((d, i) => {
      const p = entryLabel(P, i, d);
      reqObj(d, p);
      const o = unknownKeys(d, ['id', 'kind', 'occurredAt', 'festivalDay', 'minutes', 'scope', 'fromEntryId', 'fromAt', 'blockPolicy'], {});
      o.id = ident(d.id, p + '.id');
      o.kind = oneOf(d.kind, DELAY_KINDS, p + '.kind');
      const at = utc(d.occurredAt, p + '.occurredAt'); o.occurredAt = T.formatUTC(at);
      if (at < prev) fail(p + '.occurredAt', 'Los ajustes deben estar en orden de aplicación (occurredAt no decreciente).');
      prev = at;
      o.festivalDay = date(d.festivalDay, p + '.festivalDay');
      const calc = T.festivalDay(at, ctx.timeZone, ctx.dayCutoff);
      if (calc !== o.festivalDay) fail(p + '.festivalDay', 'El ajuste ' + q(o.id) + ' dice jornada ' + o.festivalDay + ', pero su occurredAt corresponde a la jornada ' + calc + '.');
      const k = o.kind;
      // minutes
      if (k === 'overtime') { if (has(d, 'minutes')) fail(p + '.minutes', 'Un overtime no lleva minutes (lo mide el ■).'); }
      else if (k === 'bis') o.minutes = int(d.minutes, p + '.minutes', 0, 15);
      else o.minutes = int(d.minutes, p + '.minutes', 1, 600);
      // scope y fromAt
      if (k === 'delay') {
        const sc = reqObj(d.scope, p + '.scope');
        o.scope = unknownKeys(sc, ['stageIds', 'includeUnzoned'], {});
        if (has(sc, 'stageIds')) {
          const ids = reqArr(sc.stageIds, p + '.scope.stageIds');
          if (!ids.length) fail(p + '.scope.stageIds', 'Lista de zonas vacía: usa {} para todas.');
          ids.forEach((id, j) => { ident(id, p + '.scope.stageIds[' + j + ']'); if (!ctx.stageIds.has(id)) fail(p + '.scope.stageIds[' + j + ']', 'La zona ' + q(id) + ' no existe.'); });
          unique(ids, x => x, p + '.scope.stageIds', 'Zona');
          o.scope.stageIds = ids.slice();
          if (has(sc, 'includeUnzoned')) o.scope.includeUnzoned = bool(sc.includeUnzoned, p + '.scope.includeUnzoned');
        } else if (has(sc, 'includeUnzoned')) fail(p + '.scope.includeUnzoned', 'includeUnzoned solo acompaña a stageIds ({} ya incluye todo).');
        o.fromAt = T.formatUTC(utc(d.fromAt, p + '.fromAt'));
      } else {
        if (has(d, 'scope')) fail(p + '.scope', 'Un ' + k + ' no lleva scope (es la zona de su entrada).');
        if (has(d, 'fromAt')) fail(p + '.fromAt', 'Un ' + k + ' no lleva fromAt.');
      }
      // fromEntryId (R4.4): todo ajuste, también un delay, lleva una banda destino show/soundcheck existente
      {
        if (!has(d, 'fromEntryId')) fail(p + '.fromEntryId', 'Un ' + k + ' necesita su banda destino (fromEntryId): un show o un soundcheck.');
        const id = ident(d.fromEntryId, p + '.fromEntryId');
        const e = ctx.entries.get(id);
        if (!e) fail(p + '.fromEntryId', 'La entrada ' + q(id) + ' no existe.');
        if (e.kind !== 'show' && e.kind !== 'soundcheck') fail(p + '.fromEntryId', 'Un ' + k + ' solo se aplica a un show o un soundcheck (' + q(id) + ' es ' + e.kind + ').');
        // Jornada: delay y changeover-stretch, exactamente la del ajuste. overtime/bis admiten además la jornada inmediatamente
        // anterior (banda abierta que cruza el corte, R4.4): el ▶ ≤ occurredAt y el ■ > occurredAt de abajo son lo que la hace «abierta».
        if (e.plan.date !== o.festivalDay) {
          const transcut = (k === 'overtime' || k === 'bis') && e.plan.date === T.addDays(o.festivalDay, -1);
          if (!transcut) fail(p + '.fromEntryId', 'La entrada ' + q(id) + ' es de otra jornada (' + e.plan.date + '; el ajuste es de ' + o.festivalDay + ').');
        }
        const act = e.actual || {}, began = act.startedAt ? T.parseUTC(act.startedAt) : null, en = act.endedAt ? T.parseUTC(act.endedAt) : null;
        if ((k === 'overtime' || k === 'bis')) {
          if (openPerEntry.has(id)) fail(p, 'Como máximo un overtime o bis por entrada (' + q(id) + ').');
          openPerEntry.set(id, true);
          // Retraso antes; Tiempo extra/Bis durante (decisión de L.A., precisión de §5.6.2 para la próxima revisión canónica):
          // la banda tiene que haber dado ▶ no después de que se aplicara el ajuste.
          if (began === null) fail(p, 'Un ' + k + ' solo se aplica a una banda que ya ha empezado: ' + q(id) + ' no tiene ▶ (actual.startedAt).');
          if (began > at) fail(p, 'El ▶ de ' + q(id) + ' es posterior a este ' + k + ': un ' + k + ' solo existe con la banda ya empezada.');
          if (en !== null && !(en > at)) fail(p, 'El ■ de ' + q(id) + ' debe ser posterior a este ajuste.');
        }
        if (k === 'changeover-stretch' && began !== null && began <= at) fail(p, 'No se estira el cambio de una banda que ya había empezado.');
        o.fromEntryId = id;
      }
      // blockPolicy (foto completa)
      const bp = reqObj(d.blockPolicy, p + '.blockPolicy');
      o.blockPolicy = unknownKeys(bp, ['all', 'stages', 'unzoned'], {});
      o.blockPolicy.all = mask(bp.all, p + '.blockPolicy.all');
      const st = reqObj(bp.stages, p + '.blockPolicy.stages');
      o.blockPolicy.stages = {};
      Object.keys(st).forEach(s => { if (!s) fail(p + '.blockPolicy.stages', 'Clave de zona vacía.'); o.blockPolicy.stages[s] = mask(st[s], p + '.blockPolicy.stages.' + s); });   // foto: la zona puede no existir ya
      if (has(bp, 'unzoned')) o.blockPolicy.unzoned = mask(bp.unzoned, p + '.blockPolicy.unzoned');
      return o;
    });
    unique(out, d => d.id, P, 'id de ajuste');
    return out;
  }

  // ── Configuración (§6) ────────────────────────────────────────────────
  const E = (v, d) => ({ t: 'enum', v, d }), I = (min, max, d) => ({ t: 'int', min, max, d }), D1 = (min, max, d) => ({ t: 'dec1', min, max, d });
  const B = d => ({ t: 'bool', d }), C = d => ({ t: 'color', d }), O = f => ({ t: 'obj', f });
  const CONF = O({
    language: E(['es', 'en'], 'es'),
    style: E(['studio', 'stage'], 'studio'),
    messages: O({
      flash: O({ background: C('#000000'), foreground: C('#ffb347'), durationSeconds: E([0, 10, 20, 30, 60], 20) }),
      notice: O({ durationSeconds: E([60, 120, 300, 600, 900], 120) })
    }),
    operations: O({ bisWindowMinutes: E([5, 10, 15], 10), delayBlocks: { t: 'delayBlocks' } }),
    production: O({ people: { t: 'people' } }),
    screens: O({
      confidence: O({ showWarnMinutes: I(0, 180, 10), showDangerMinutes: I(0, 180, 5), changeoverWarnMinutes: I(0, 180, 5), changeoverDangerMinutes: I(0, 180, 1),
        blink: B(true), blinkSpeedSeconds: D1(0.1, 5, 1), overtimeBackground: C('#000000'), overtimeNumber: C('#ff3b30') }),
      backstage: O({ cards: B(true), lines: B(true), ticker: B(true) }),
      ticker: O({ delays: B(true), markers: B(true), weather: B(true), mode: E(['crawl', 'static'], 'crawl'), background: C('#000000'), foreground: C('#ffb347'), speedSeconds: D1(5, 120, 30) }),
      parking: O({ afterMinutes: E([0, 2, 5, 10], 5) })
    }),
    weather: { t: 'weather' }
  });

  function confValue(spec, v, p, ctx) {
    const absent = v === undefined;
    switch (spec.t) {
      case 'enum': return absent ? spec.d : oneOf(v, spec.v, p);
      case 'int': return absent ? spec.d : int(v, p, spec.min, spec.max);
      case 'dec1': if (absent) return spec.d; if (!isDec1(v) || v < spec.min - 1e-9 || v > spec.max + 1e-9) fail(p, 'Debe ser un número de ' + spec.min + ' a ' + spec.max + ' con un decimal como máximo.'); return Math.round(v * 10) / 10;
      case 'bool': return absent ? spec.d : bool(v, p);
      case 'color': return absent ? spec.d : color(v, p);
      case 'obj': {
        const src = absent ? {} : reqObj(v, p);
        const o = unknownKeys(src, Object.keys(spec.f), {});
        Object.keys(spec.f).forEach(k => { o[k] = confValue(spec.f[k], src[k], p + '.' + k, ctx); });
        return o;
      }
      case 'delayBlocks': {
        const src = absent ? {} : reqObj(v, p);
        const o = unknownKeys(src, ['all', 'stages', 'unzoned'], {});
        o.all = has(src, 'all') ? mask(src.all, p + '.all') : { show: false, soundcheck: false, task: false, marker: false };
        o.stages = {};
        if (has(src, 'stages')) {
          const st = reqObj(src.stages, p + '.stages');
          Object.keys(st).forEach(s => { if (!ctx.stageIds.has(s)) fail(p + '.stages.' + s, 'La zona ' + q(s) + ' no existe.'); o.stages[s] = mask(st[s], p + '.stages.' + s); });
        }
        if (has(src, 'unzoned')) o.unzoned = mask(src.unzoned, p + '.unzoned');
        return o;
      }
      case 'people': {
        const list = absent ? [] : reqArr(v, p);
        const out = list.map((x, i) => {
          const pp = p + '[' + i + ']';
          reqObj(x, pp);
          const o = unknownKeys(x, ['id', 'name'], {});
          if (typeof x.id !== 'string' || !PERSON_ID_RE.test(x.id)) fail(pp + '.id', 'Id de persona: 1 a 64 caracteres A-Z, a-z, 0-9, «_» o «-».');
          o.id = x.id; o.name = text(x.name, pp + '.name');
          return o;
        });
        unique(out, x => x.id, p, 'id de persona');
        return out;
      }
      case 'weather': return normalizeWeather(absent ? {} : reqObj(v, p), p);
    }
    throw new Error('spec');
  }

  function normalizeWeather(w, p) {
    const o = unknownKeys(w, ['source', 'enabled', 'place', 'lat', 'lon', 'thresholds', 'horizonHours', 'refreshMinutes', 'units'], {});
    o.source = has(w, 'source') ? oneOf(w.source, ['open-meteo'], p + '.source') : 'open-meteo';
    o.enabled = has(w, 'enabled') ? bool(w.enabled, p + '.enabled') : false;
    if (has(w, 'lat') !== has(w, 'lon')) fail(p + (has(w, 'lat') ? '.lon' : '.lat'), 'lat y lon van juntas: las dos o ninguna.');
    if (has(w, 'lat')) {
      if (!isNum(w.lat) || w.lat < -90 || w.lat > 90) fail(p + '.lat', 'Latitud de -90 a 90.');
      if (!isNum(w.lon) || w.lon < -180 || w.lon > 180) fail(p + '.lon', 'Longitud de -180 a 180.');
      o.lat = w.lat; o.lon = w.lon;
    }
    if (o.enabled && !has(w, 'lat')) fail(p + '.enabled', 'Para activar la Meteo hacen falta lat y lon.');
    if (has(w, 'place')) {
      if (typeof w.place !== 'string' || Array.from(w.place).length > 120 || /[\u0000-\u001f\u007f]/.test(w.place)) fail(p + '.place', 'Lugar: texto de hasta 120 caracteres, sin caracteres de control.');
      o.place = w.place.trim();
    } else o.place = '';
    const th = has(w, 'thresholds') ? reqObj(w.thresholds, p + '.thresholds') : {};
    const P2 = p + '.thresholds', t = unknownKeys(th, ['wind', 'gust', 'rain', 'heat', 'storm', 'uvEnabled', 'uv', 'airQualityEnabled', 'airQuality'], {});
    const nul = (k, min, max) => { if (!has(th, k) || th[k] === null) return null; if (!isNum(th[k]) || th[k] < min || th[k] > max) fail(P2 + '.' + k, 'null o un número de ' + min + ' a ' + max + '.'); return th[k]; };
    t.wind = nul('wind', 1, 400); t.gust = nul('gust', 1, 400); t.rain = nul('rain', 0.1, 500); t.heat = nul('heat', -60, 70);
    t.storm = has(th, 'storm') ? bool(th.storm, P2 + '.storm') : true;
    t.uvEnabled = has(th, 'uvEnabled') ? bool(th.uvEnabled, P2 + '.uvEnabled') : true;
    if (t.uvEnabled) t.uv = has(th, 'uv') ? int(th.uv, P2 + '.uv', 1, 20) : 8;
    else if (has(th, 'uv')) fail(P2 + '.uv', 'Con uvEnabled false, uv debe estar ausente.');
    t.airQualityEnabled = has(th, 'airQualityEnabled') ? bool(th.airQualityEnabled, P2 + '.airQualityEnabled') : false;
    if (t.airQualityEnabled) t.airQuality = has(th, 'airQuality') ? oneOf(th.airQuality, [60, 80, 100], P2 + '.airQuality') : 80;
    else if (has(th, 'airQuality')) fail(P2 + '.airQuality', 'Con airQualityEnabled false, airQuality debe estar ausente.');
    o.thresholds = t;
    o.horizonHours = has(w, 'horizonHours') ? oneOf(w.horizonHours, [1, 2, 3, 6, 12], p + '.horizonHours') : 3;
    o.refreshMinutes = has(w, 'refreshMinutes') ? oneOf(w.refreshMinutes, [5, 10, 15, 30], p + '.refreshMinutes') : 15;
    o.units = has(w, 'units') ? oneOf(w.units, ['metric', 'imperial'], p + '.units') : 'metric';
    return o;
  }

  function normalizeConfiguration(c, ctx) {
    const P = 'festival.configuration';
    const o = confValue(CONF, c, P, ctx);
    // Reglas entre campos, después de los valores por defecto
    const cf = o.screens.confidence;
    if (cf.showDangerMinutes > cf.showWarnMinutes) fail(P + '.screens.confidence.showDangerMinutes', 'El peligro no puede ser mayor que el aviso (' + cf.showWarnMinutes + ').');
    if (cf.changeoverDangerMinutes > cf.changeoverWarnMinutes) fail(P + '.screens.confidence.changeoverDangerMinutes', 'El peligro no puede ser mayor que el aviso (' + cf.changeoverWarnMinutes + ').');
    const bs = o.screens.backstage;
    if (!bs.cards && !bs.lines && !bs.ticker) fail(P + '.screens.backstage', 'Al menos uno de cards, lines o ticker debe estar activo.');
    return o;
  }

  // ── Event Log (§7) ────────────────────────────────────────────────────
  function normalizeLog(l, ctx) {
    const P = 'eventLog';
    const out = unknownKeys(l, ['logVersion', 'snapshots', 'entries', 'nextSequence'], {});
    if (l.logVersion !== 1) fail(P + '.logVersion', 'Esta versión solo conoce logVersion 1.');
    out.logVersion = 1;
    // Snapshots
    let prevCap = -Infinity;
    out.snapshots = reqArr(l.snapshots, P + '.snapshots').map((s, i) => {
      const p = P + '.snapshots[' + i + ']';
      reqObj(s, p);
      const o = unknownKeys(s, ['festivalDay', 'capturedAt', 'entries'], {});
      o.festivalDay = date(s.festivalDay, p + '.festivalDay');
      const at = utc(s.capturedAt, p + '.capturedAt'); o.capturedAt = T.formatUTC(at);
      if (at < prevCap) fail(p + '.capturedAt', 'Los snapshots van en orden de capturedAt.');
      prevCap = at;
      const calc = T.festivalDay(at, ctx.timeZone, ctx.dayCutoff);
      if (calc !== o.festivalDay) fail(p + '.festivalDay', 'El snapshot de ' + o.festivalDay + ' tiene un capturedAt de la jornada ' + calc + '.');
      if (T.dayNumber(o.festivalDay) < T.dayNumber(ctx.startDate) || T.dayNumber(o.festivalDay) > T.dayNumber(ctx.endDate)) fail(p + '.festivalDay', 'Un snapshot solo existe para una jornada del festival.');
      o.entries = reqArr(s.entries, p + '.entries').map((e, j) => {
        const pe = p + '.entries[' + j + ']';
        reqObj(e, pe);
        const x = unknownKeys(e, ['entryId', 'kind', 'name', 'plan'], {});
        x.entryId = ident(e.entryId, pe + '.entryId');
        x.kind = oneOf(e.kind, KINDS, pe + '.kind');
        x.name = text(e.name, pe + '.name');
        x.plan = historicalPlan(e.plan, x.kind, pe + '.plan', ctx);
        if (x.plan.date !== o.festivalDay) fail(pe + '.plan.date', 'Un snapshot de ' + o.festivalDay + ' solo recoge entradas con plan.date ' + o.festivalDay + ' (tiene ' + x.plan.date + ').');
        return x;
      });
      return o;
    });
    unique(out.snapshots, s => s.festivalDay, P + '.snapshots', 'Snapshot de la jornada');
    // Entradas
    let prevSeq = 0;
    const endsById = new Map();   // actual-end ya normalizados (id → { entryId, endedAt }): solo para validar actual-end-retracted; no persiste
    out.entries = reqArr(l.entries, P + '.entries').map((e, i) => {
      const p = P + '.entries[' + i + ']' + (isObj(e) && isInt(e.sequence) ? ' (sequence ' + e.sequence + ')' : '');
      reqObj(e, p);
      const o = unknownKeys(e, ['id', 'sequence', 'occurredAt', 'festivalDay', 'type', 'entryId', 'stageId', 'data'], {});
      o.id = ident(e.id, p + '.id');
      o.sequence = int(e.sequence, p + '.sequence', 1, Number.MAX_SAFE_INTEGER);
      if (o.sequence <= prevSeq) fail(p + '.sequence', 'sequence debe ser estrictamente creciente.');
      prevSeq = o.sequence;
      const at = utc(e.occurredAt, p + '.occurredAt'); o.occurredAt = T.formatUTC(at);
      o.festivalDay = date(e.festivalDay, p + '.festivalDay');
      const calc = T.festivalDay(at, ctx.timeZone, ctx.dayCutoff);
      if (calc !== o.festivalDay) fail(p + '.festivalDay', 'La entrada de Log ' + o.sequence + ' dice jornada ' + o.festivalDay + ', pero su occurredAt corresponde a la jornada ' + calc + '.');
      if (typeof e.type !== 'string' || !e.type) fail(p + '.type', 'Tipo de Log: texto no vacío.');
      o.type = e.type;
      if (has(e, 'entryId')) o.entryId = ident(e.entryId, p + '.entryId');
      else if (ENTRY_LOG_TYPES.indexOf(e.type) >= 0) fail(p + '.entryId', 'Un ' + e.type + ' necesita entryId.');
      if (has(e, 'stageId')) o.stageId = ident(e.stageId, p + '.stageId');   // historia: no tiene que existir hoy
      o.data = checkLogData(o, reqObj(e.data, p + '.data'), p + '.data', ctx, endsById);
      if (o.type === 'actual-end') endsById.set(o.id, { entryId: o.entryId, endedAt: o.data.endedAt });
      return o;
    });
    unique(out.entries, e => e.id, P + '.entries', 'id de Log');
    out.nextSequence = int(l.nextSequence, P + '.nextSequence', 1, Number.MAX_SAFE_INTEGER);
    if (out.nextSequence <= prevSeq) fail(P + '.nextSequence', 'nextSequence debe ser mayor que toda sequence emitida (' + prevSeq + ').');
    return out;
  }

  /** Devuelve una copia de data con las estructuras conocidas del tipo validadas y normalizadas; el resto de claves
   *  (y todo el data de un tipo desconocido, §7.2) se conserva tal cual (§3.1). */
  function checkLogData(e, src, p, ctx, endsById) {
    const d = clone(src);
    // entry-added / entry-deleted: { kind, name, plan } completo, plan histórico (§7.1)
    const full = (x, pp) => {
      reqObj(x, pp);
      const o = unknownKeys(x, ['kind', 'name', 'plan'], {});
      o.kind = oneOf(x.kind, KINDS, pp + '.kind');
      o.name = text(x.name, pp + '.name');
      o.plan = historicalPlan(x.plan, o.kind, pp + '.plan', ctx);
      return o;
    };
    switch (e.type) {
      case 'entry-added': d.after = full(src.after, p + '.after'); break;
      case 'entry-deleted': d.before = full(src.before, p + '.before'); break;
      case 'entry-updated': {
        // Solo las claves cambiadas de kind, name y plan; el mismo conjunto en before y after
        const side = (x, pp) => {
          reqObj(x, pp);
          const keys = Object.keys(x);
          if (!keys.length) fail(pp, 'Debe contener al menos una de kind, name o plan.');
          keys.forEach(k => { if (['kind', 'name', 'plan'].indexOf(k) < 0) fail(pp + '.' + k, 'Clave no admitida en una actualización: solo kind, name y plan.'); });
          return keys.slice().sort().join(',');
        };
        const kb = side(src.before, p + '.before'), ka = side(src.after, p + '.after');
        if (kb !== ka) fail(p + '.after', 'before y after deben tener las mismas claves (before: ' + kb + '; after: ' + ka + ').');
        ['before', 'after'].forEach(w => {
          const x = src[w], pp = p + '.' + w, o = {};
          if (has(x, 'kind')) o.kind = oneOf(x.kind, KINDS, pp + '.kind');
          if (has(x, 'name')) o.name = text(x.name, pp + '.name');
          // kind de ese lado: solo es determinable si la actualización lo cambia
          if (has(x, 'plan')) o.plan = planShape(x.plan, has(o, 'kind') ? o.kind : null, pp + '.plan', ctx, 'diff');
          d[w] = o;
        });
        if (has(d.before, 'plan') && !Object.keys(d.before.plan).length && !Object.keys(d.after.plan).length) fail(p + '.after.plan', 'Un cambio de plan sin ningún campo.');
        break;
      }
      case 'delay-applied': case 'delay-removed': {
        ident(src.delayId, p + '.delayId');
        const k = oneOf(src.kind, DELAY_KINDS, p + '.kind');
        // minutes: obligatorio y en el rango de su tipo (§5.6.2) para delay, bis y changeover-stretch; prohibido en overtime
        if (k === 'overtime') { if (has(src, 'minutes')) fail(p + '.minutes', 'Un overtime no lleva minutes.'); }
        else if (k === 'bis') int(src.minutes, p + '.minutes', 0, 15);
        else int(src.minutes, p + '.minutes', 1, 600);
        d.fromEntryName = text(src.fromEntryName, p + '.fromEntryName');   // R4.4: foto legible de la banda destino, siempre
        break;
      }
      case 'actual-start':
        d.startedAt = T.formatUTC(utc(src.startedAt, p + '.startedAt'));   // §3.2: se guarda con segundos
        if (has(src, 'previousStartedAt')) d.previousStartedAt = T.formatUTC(utc(src.previousStartedAt, p + '.previousStartedAt'));   // corrección (R4.4)
        break;
      case 'actual-end':
        d.endedAt = T.formatUTC(utc(src.endedAt, p + '.endedAt'));
        if (has(src, 'previousEndedAt')) d.previousEndedAt = T.formatUTC(utc(src.previousEndedAt, p + '.previousEndedAt'));
        break;
      case 'actual-end-retracted': {
        // R4.4: deshace un ■ ya registrado. Cita por id un actual-end ANTERIOR en el Log de la misma entrada (el índice se construye
        // en orden de secuencia, así que una referencia a una entrada posterior, inexistente, de otra entrada o de otro tipo no resuelve).
        const ref = ident(src.undoneLogId, p + '.undoneLogId');
        if (!endsById || !endsById.has(ref)) fail(p + '.undoneLogId', 'Debe citar un actual-end anterior del Log (' + q(ref) + ' no lo es).');
        const undone = endsById.get(ref);
        if (undone.entryId !== e.entryId) fail(p + '.undoneLogId', 'El actual-end ' + q(ref) + ' es de otra entrada.');
        d.endedAt = T.formatUTC(utc(src.endedAt, p + '.endedAt'));
        // R4.4-7.4-5 / R4.4-8: endedAt es la hora que se retira, exactamente la registrada en el actual-end citado
        if (d.endedAt !== undone.endedAt) fail(p + '.endedAt', 'Debe coincidir con la hora del actual-end retirado ' + q(ref) + ' (' + undone.endedAt + ').');
        break;
      }
      case 'call-confirmed': {
        const c = reqObj(src.confirmedBy, p + '.confirmedBy');
        if (typeof c.personId !== 'string' || !PERSON_ID_RE.test(c.personId)) fail(p + '.confirmedBy.personId', 'personId no válido.');
        d.confirmedBy.name = text(c.name, p + '.confirmedBy.name');   // recortado; el resto de confirmedBy (clon profundo) se conserva
        break;
      }
      case 'message': case 'weather-alert': optString(src.text, p + '.text'); break;
      default: break;   // standby-*, y tipos desconocidos (§7.2): solo los campos mínimos
    }
    return d;
  }

  // ── Logo (§5.7): se filtra al abrir y nunca invalida el documento ─────
  function b64decode(s) {
    if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function b64encode(u) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u).toString('base64');
    let bin = ''; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  }
  const startsWith = (u, sig) => sig.every((b, i) => u[i] === b);
  function sniff(u) {
    if (startsWith(u, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
    if (startsWith(u, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(u, [0x52, 0x49, 0x46, 0x46]) && u.length >= 12 && String.fromCharCode(u[8], u[9], u[10], u[11]) === 'WEBP') return 'image/webp';
    return null;
  }
  /** Devuelve { logo } (posiblemente saneado) o { warning } para quitarlo. */
  function checkLogo(logo) {
    const bad = m => ({ warning: 'El logo no es válido (' + m + '): no se muestra y no se volverá a guardar.' });
    if (!isObj(logo)) return bad('no es un objeto { mediaType, base64 }');
    const mt = logo.mediaType;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].indexOf(mt) < 0) return bad('tipo no admitido');
    const bytes = b64decode(logo.base64);
    if (!bytes) return bad('base64 incorrecto');
    if (bytes.length > LOGO_MAX) return bad('más de 256 KiB');
    if (mt !== 'image/svg+xml') {
      if (sniff(bytes) !== mt) return bad('los bytes no corresponden a ' + mt);
      return { logo: Object.assign(unknownKeys(logo, ['mediaType', 'base64'], {}), { mediaType: mt, base64: logo.base64 }) };
    }
    let txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return bad('SVG con texto no UTF-8'); }
    const clean = sanitizeSVG(txt);
    if (clean === null) return bad('SVG no saneable');
    const enc = b64encode(new TextEncoder().encode(clean));
    return { logo: Object.assign(unknownKeys(logo, ['mediaType', 'base64'], {}), { mediaType: mt, base64: enc }), sanitized: clean !== txt };
  }
  function filterLogo(event, warnings) {
    if (!event.branding || !has(event.branding, 'logo')) return;
    const r = checkLogo(event.branding.logo);
    if (r.warning) { delete event.branding.logo; warnings.push({ path: 'festival.project.event.branding.logo', message: r.warning }); }
    else event.branding.logo = r.logo;
  }

  // ── SVG: análisis XML mínimo y saneado (sin DOM, igual en Node y navegador) ──
  const NAME = '[A-Za-z_:][-A-Za-z0-9_.:]*';
  const ENT_OK = /&(?:#\d+|#x[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g;
  function entitiesOk(s) { return s.replace(ENT_OK, '').indexOf('&') < 0; }
  /** Analiza XML bien formado → árbol { name, attrs:[[k,v]], kids:[] } (texto: string; CDATA: {cdata}) o null. */
  function parseXML(src) {
    let i = 0;
    const len = src.length, stack = [{ name: '#doc', attrs: [], kids: [] }];
    const tagRe = new RegExp('^<(' + NAME + ')'), attrRe = new RegExp('^\\s+(' + NAME + ')\\s*=\\s*(?:"([^"<]*)"|\'([^\'<]*)\')');
    while (i < len) {
      const top = stack[stack.length - 1];
      if (src.startsWith('<!--', i)) { const j = src.indexOf('-->', i + 4); if (j < 0) return null; i = j + 3; continue; }
      if (src.startsWith('<![CDATA[', i)) { const j = src.indexOf(']]>', i); if (j < 0 || stack.length < 2) return null; top.kids.push({ cdata: src.slice(i + 9, j) }); i = j + 3; continue; }
      if (src.startsWith('<?', i)) { const j = src.indexOf('?>', i); if (j < 0) return null; i = j + 2; continue; }
      if (src.startsWith('<!', i)) return null;   // DOCTYPE / entidades propias: no saneable
      if (src.startsWith('</', i)) {
        const m = new RegExp('^</(' + NAME + ')\\s*>').exec(src.slice(i, i + 300));
        if (!m || stack.length < 2 || top.name !== m[1]) return null;
        stack.pop(); i += m[0].length; continue;
      }
      if (src[i] === '<') {
        const rest = src.slice(i);
        const m = tagRe.exec(rest); if (!m) return null;
        const el = { name: m[1], attrs: [], kids: [] }, seen = new Set();
        let k = m[0].length, a;
        while ((a = attrRe.exec(rest.slice(k)))) {
          const v = a[2] !== undefined ? a[2] : a[3];
          if (seen.has(a[1]) || !entitiesOk(v)) return null;
          seen.add(a[1]); el.attrs.push([a[1], v]); k += a[0].length;
        }
        const end = /^\s*(\/?)>/.exec(rest.slice(k)); if (!end) return null;
        if (stack.length === 1 && stack[0].kids.some(x => typeof x === 'object' && x.name)) return null;   // un solo elemento raíz
        top.kids.push(el); i += k + end[0].length;
        if (!end[1]) stack.push(el);
        continue;
      }
      const j = src.indexOf('<', i), t = src.slice(i, j < 0 ? len : j);
      if (!entitiesOk(t)) return null;
      if (stack.length === 1) { if (t.trim()) return null; } else top.kids.push(t);
      i = j < 0 ? len : j;
    }
    if (stack.length !== 1) return null;
    const rootEl = stack[0].kids.filter(x => typeof x === 'object' && x.name);
    return rootEl.length === 1 ? rootEl[0] : null;
  }
  const local = n => n.slice(n.lastIndexOf(':') + 1).toLowerCase();
  const externalUrl = v => /url\(\s*['"]?\s*(?!#)/i.test(v) || /@import/i.test(v);
  const DROP_EL = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'handler', 'listener'];
  function cleanEl(el) {
    const attrs = el.attrs.filter(([k, v]) => {
      const lk = local(k);
      if (/^on/i.test(lk)) return false;
      if (lk === 'href' || lk === 'src') return /^\s*#/.test(v);   // solo referencias internas
      if (externalUrl(v)) return false;
      if (/^\s*(javascript|data|vbscript):/i.test(v)) return false;
      return true;
    });
    const kids = [];
    el.kids.forEach(x => {
      if (typeof x === 'string') kids.push(x);
      else if (x.cdata !== undefined) { if (local(el.name) !== 'style' || !externalUrl(x.cdata)) kids.push(x); }
      else if (DROP_EL.indexOf(local(x.name)) < 0 && !(local(x.name) === 'style' && x.kids.some(k => (typeof k === 'string' ? k : k.cdata || '').match(/url\(\s*['"]?\s*(?!#)|@import/i)))) kids.push(cleanEl(x));
    });
    return { name: el.name, attrs, kids };
  }
  function serialize(el) {
    const a = el.attrs.map(([k, v]) => ' ' + k + '="' + v.replace(/"/g, '&quot;') + '"').join('');
    if (!el.kids.length) return '<' + el.name + a + '/>';
    return '<' + el.name + a + '>' + el.kids.map(x => typeof x === 'string' ? x : x.cdata !== undefined ? '<![CDATA[' + x.cdata + ']]>' : serialize(x)).join('') + '</' + el.name + '>';
  }
  /** SVG saneado (texto) o null si no es XML bien formado con raíz <svg>. */
  function sanitizeSVG(src) {
    const rootEl = parseXML(String(src).replace(/^\uFEFF/, ''));
    if (!rootEl || local(rootEl.name) !== 'svg') return null;
    return serialize(cleanEl(rootEl));
  }

  // ── Creación, identidad, historia, Duplicar ───────────────────────────
  /** UUID v4 con un generador seguro: rand(n) → Uint8Array(n) aleatorio (crypto.getRandomValues). */
  function uuidV4(rand) {
    const b = rand(16);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function defaultRand(n) {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof require === 'function' ? require('crypto').webcrypto : null);
    return c.getRandomValues(new Uint8Array(n));
  }
  /** Festival v1 nuevo: { name, startDate, endDate, timeZone, dayCutoff? } → { ok, doc } | { ok:false, path, message }. */
  function createDocument(opts, rand) {
    const o = opts || {};
    const ev = { name: o.name, startDate: o.startDate, endDate: o.endDate || o.startDate, timeZone: o.timeZone };
    if (o.dayCutoff !== undefined) ev.dayCutoff = o.dayCutoff;
    const raw = {
      format: FORMAT, formatVersion: VERSION, festivalId: uuidV4(rand || defaultRand),
      festival: { project: { event: ev, stages: [], entries: [], delays: [] }, configuration: {} },
      eventLog: emptyLog()
    };
    const r = validate(raw);
    return r.ok ? { ok: true, doc: r.doc } : r;
  }
  function emptyLog() { return { logVersion: 1, snapshots: [], entries: [], nextSequence: 1 }; }

  /** §5.1.1: ¿hay historia? (Log, snapshots, actual con valor o delays). */
  function hasHistory(doc) {
    const L = doc.eventLog, P = doc.festival.project;
    return L.entries.length > 0 || L.snapshots.length > 0 || P.delays.length > 0 || P.entries.some(e => e.actual && (e.actual.startedAt || e.actual.endedAt));
  }
  /** Cambia timeZone y/o dayCutoff solo si no hay historia; valida el resultado entero. */
  function setTimeContext(doc, change) {
    if (hasHistory(doc)) return { ok: false, path: 'festival.project.event', message: 'El festival ya tiene historia (Log, snapshot, hechos reales o ajustes): la zona horaria y el corte de jornada no se pueden cambiar.' };
    const next = clone(doc), ev = next.festival.project.event;
    if (change.timeZone !== undefined) ev.timeZone = change.timeZone;
    if (change.dayCutoff !== undefined) ev.dayCutoff = change.dayCutoff;
    const r = validate(next);
    return r.ok ? { ok: true, doc: r.doc } : r;
  }

  /** §10 Duplicar festival: plantilla limpia, nunca muta el original. */
  function duplicateDocument(doc, rand) {
    const next = clone(doc);
    next.festivalId = uuidV4(rand || defaultRand);
    next.eventLog = emptyLog();
    delete next.protectedAccess;
    next.festival.project.entries.forEach(e => { delete e.actual; });
    next.festival.project.delays = [];
    const r = validate(next);
    if (!r.ok) throw new Error('Duplicar produjo un documento inválido: ' + r.message);
    return r.doc;
  }

  // ── Guardado ──────────────────────────────────────────────────────────
  /** Texto a guardar (forma normalizada). Nunca escribe un documento que se rechazaría al abrirlo. */
  function serializeDocument(doc) {
    const r = validate(doc);
    if (!r.ok) return r;
    return { ok: true, text: JSON.stringify(r.doc, null, 2) + '\n', mime: MIME, fileName: fileNameFor(r.doc) };
  }
  function fileNameFor(doc) {
    const base = String(doc.festival.project.event.name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'festival';
    return base + EXT;
  }

  const api = { FORMAT, VERSION, MIME, EXT, LOGO_MAX, KINDS, DELAY_KINDS, parseDocument, validate, createDocument, duplicateDocument,
    hasHistory, setTimeContext, serializeDocument, fileNameFor, uuidV4, sanitizeSVG, checkLogo, emptyLog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShowtimeV1Document = api;
})(typeof window !== 'undefined' ? window : this);
