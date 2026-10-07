/* Showtime — log.js · Event Log (caja negra de producción)
 *
 * Registro que SOLO AÑADE: nunca borra ni reescribe nada. Deshacer no quita entradas: añade «Deshecho: …».
 * Graba lo que pasa, con su hora y quién dio la orden (Panel o Mando regidor):
 *   · horas reales ▶ / ■ (también el ■ pasivo, con el inicio dado por en hora)
 *   · retrasos (manuales y desbordes) · mensajes a las pantallas · avisos del tiempo y su «Visto»
 *   · altas, cambios (nombre, tipo, zona, jornada, horas, CALL) y borrados de entradas
 * No graba el paso del tiempo ni los ajustes (LED, STANDBY, colores, configuración).
 *
 * «Previsto» = FOTO del horario al empezar cada jornada (o la primera vez que el Dashboard la ve abierta).
 * El informe intercala, en orden de hora, el horario previsto y las incidencias que han pasado desde esa foto.
 * Lo que cambió antes de la foto ya está dentro de ella: no sale como incidencia.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.ShowtimeCore;

  const VERSION = 1;
  const MAX = 20000;                 // tope de seguridad (un día normal son decenas o cientos)
  const SRC_TXT = { panel: 'Panel', mando: 'Mando regidor', produccion: 'Producción' };
  const KIND_TXT = { show: 'Show', sc: 'Soundcheck', tarea: 'Tarea', hito: 'Hito' };
  const TYPE_TXT = { real: 'Hora real', delay: 'Retraso', buffer: 'Tiempo extra', msg: 'Mensaje', call: 'CALL OK', meteo: 'Meteo', add: 'Alta', del: 'Borrado', edit: 'Cambio', undo: 'Deshecho' };
  const CATS = ['show', 'sc', 'tarea', 'hito', 'inc'];
  const CAT_TXT = { show: 'Shows', sc: 'Soundchecks', tarea: 'Tareas', hito: 'Hitos / Eventos', inc: 'Incidencias' };

  // ── Utilidades ────────────────────────────────────────────────────────
  const hm = v => v === null || v === undefined ? '—' : C.fmtHM(v);
  function devTxt(d) { return d === 0 ? 'en hora' : (d > 0 ? '+' : '−') + Math.abs(d) + ' min'; }
  function fmtDay(iso, long) {
    const i = C.dayIndex(iso);
    if (i === null) return iso || '—';
    const o = long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
    return new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString('es-ES', o);
  }
  function uniq(a) { return a.filter((x, i) => x && a.indexOf(x) === i); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ── El registro ───────────────────────────────────────────────────────
  /** Identidad del evento (para saber si un log es de este evento). */
  function eventKey(state) { const e = (state && state.event) || {}; return String(e.nombre || '') + '|' + String(e.fechaInicio || ''); }
  function empty(state) { return { v: VERSION, ev: eventKey(state), fotos: {}, entries: [], seq: 0 }; }
  /** Log válido o null (lo que venga de localStorage o de un .json). */
  function norm(x) {
    if (!x || typeof x !== 'object' || !Array.isArray(x.entries) || !x.fotos || typeof x.fotos !== 'object') return null;
    const entries = x.entries.filter(e => e && Number.isFinite(e.t) && typeof e.text === 'string' && TYPE_TXT[e.type])
      .map(e => ({ n: Number(e.n) || 0, t: Math.floor(e.t), src: SRC_TXT[e.src] ? e.src : 'panel', type: e.type, text: e.text.slice(0, 600),
        jors: Array.isArray(e.jors) ? e.jors.filter(j => C.dayIndex(j) !== null) : [], key: typeof e.key === 'string' ? e.key : undefined, amber: !!e.amber }));
    const fotos = {};
    Object.keys(x.fotos).forEach(j => {
      const f = x.fotos[j];
      if (C.dayIndex(j) !== null && f && Number.isFinite(f.at) && Array.isArray(f.items)) fotos[j] = { at: Math.floor(f.at), items: f.items.filter(i => i && typeof i.key === 'string') };
    });
    const seq = Math.max(Number(x.seq) || 0, entries.reduce((m, e) => Math.max(m, e.n), 0));
    return { v: VERSION, ev: typeof x.ev === 'string' ? x.ev : '', fotos, entries, seq };
  }

  /** Foto del horario de una jornada: lo programado en ese momento. */
  function itemOf(b) { return { key: b.key, id: b.id, kind: b.kind, name: b.name, stage: b.stage, stageId: b.stageId, psi: b.psi, psf: b.kind === 'hito' ? null : b.psf }; }
  function fotoOf(state, jor, at) {
    return { at: Math.floor(at), items: C.buildBlocks(state, { mode: 'all', day: jor }).filter(b => b.psi !== null).map(itemOf) };
  }
  /** Si la jornada de `now` aún no tiene foto, se hace ahora (con el estado de ANTES de cualquier cambio). */
  function ensureFoto(log, state, now) {
    if (!log || !state || !Number.isFinite(now)) return log;
    const j = C.jornadaOfAbs(state, Math.floor(now));
    if (log.fotos[j]) return log;
    const fotos = Object.assign({}, log.fotos); fotos[j] = fotoOf(state, j, now);
    return Object.assign({}, log, { fotos });
  }

  /** Añade entradas (nunca quita). ctx: { t (minutos absolutos), src }. Sin jornada: la de su hora. */
  function record(log, entries, ctx, state) {
    if (!log || !entries || !entries.length) return log;
    const c = ctx || {}, t = Math.floor(c.t);
    let seq = log.seq || 0;
    const add = entries.map(e => ({ n: ++seq, t, src: SRC_TXT[c.src] ? c.src : 'panel', type: e.type, text: String(e.text).slice(0, 600),
      jors: uniq(e.jors && e.jors.length ? e.jors : state ? [C.jornadaOfAbs(state, t)] : []), key: e.key, amber: !!e.amber }));
    let list = log.entries.concat(add);
    if (list.length > MAX) list = list.slice(list.length - MAX);
    return Object.assign({}, log, { entries: list, seq });
  }

  // ── Qué ha cambiado entre dos estados ────────────────────────────────
  function label(b) { return KIND_TXT[b.kind] + ' «' + b.name + '»'; }
  function span(b) { return hm(b.psi) + (b.kind !== 'hito' && b.psf !== null ? '–' + hm(b.psf) : ''); }
  /**
   * Entradas del log que salen de pasar de `prev` a `next`.
   * opts.noTimes: no se apuntan los cambios de hora/jornada uno a uno (los describe la orden: retraso, desborde).
   */
  function diff(prev, next, opts) {
    const o = opts || {}, out = [];
    if (!prev || !next) return out;
    const all = s => { const m = new Map(); C.buildBlocks(s, { mode: 'all', day: 'all' }).forEach(b => m.set(b.key, b)); return m; };
    const A = all(prev), B = all(next);
    const gone = Array.from(A.keys()).filter(k => !B.has(k)), born = Array.from(B.keys()).filter(k => !A.has(k));
    // Mismo id con otro tipo (tarea → hito, banda → tarea…): es un cambio de tipo, no un borrado + alta
    gone.slice().forEach(k => {
      const a = A.get(k), j = born.findIndex(k2 => B.get(k2).id === a.id);
      if (j < 0) return;
      const b = B.get(born[j]);
      out.push({ type: 'edit', key: b.key, jors: [a.jornada, b.jornada], text: label(a) + ': tipo ' + KIND_TXT[a.kind].toLowerCase() + ' → ' + KIND_TXT[b.kind].toLowerCase() });
      gone.splice(gone.indexOf(k), 1); born.splice(j, 1);
    });
    born.forEach(k => { const b = B.get(k); out.push({ type: 'add', key: k, jors: [b.jornada], text: label(b) + (b.psi !== null ? ' · ' + span(b) : ' · sin hora') + (b.stage ? ' · ' + b.stage : '') }); });
    gone.forEach(k => { const a = A.get(k); out.push({ type: 'del', key: k, jors: [a.jornada], text: label(a) + (a.psi !== null ? ' · ' + span(a) : '') + (a.stage ? ' · ' + a.stage : '') }); });
    // Nombre y zona son de la ENTRADA (una banda con show y soundcheck cambia los dos a la vez): una sola línea por entrada
    const seen = new Set();
    B.forEach((b, k) => {
      const a = A.get(k); if (!a || seen.has(a.id)) return;
      const ch = [];
      if (a.name !== b.name) ch.push('nombre «' + a.name + '» → «' + b.name + '»');
      if ((a.stageId || '') !== (b.stageId || '')) ch.push('zona ' + (a.stage || 'sin zona') + ' → ' + (b.stage || 'sin zona'));
      if (!ch.length) return;
      seen.add(a.id);
      const jors = []; B.forEach(x => { if (x.id === b.id) jors.push(x.jornada); }); A.forEach(x => { if (x.id === a.id) jors.push(x.jornada); });
      out.push({ type: 'edit', key: k, jors: uniq(jors), text: '«' + a.name + '»: ' + ch.join(' · ') });
    });
    B.forEach((b, k) => {
      const a = A.get(k); if (!a) return;
      const ch = [];
      if (!o.noTimes) {
        if (a.jornada !== b.jornada) ch.push('jornada ' + fmtDay(a.jornada) + ' → ' + fmtDay(b.jornada));
        if (a.psi !== b.psi) ch.push('inicio ' + hm(a.psi) + ' → ' + hm(b.psi));
        if (b.kind !== 'hito' && a.psf !== b.psf) ch.push('fin ' + hm(a.psf) + ' → ' + hm(b.psf));
      }
      if ((a.call || '') !== (b.call || '')) ch.push('CALL ' + (a.call || '—') + ' → ' + (b.call || '—'));
      if (ch.length) out.push({ type: 'edit', key: k, jors: [a.jornada, b.jornada], amber: !o.noTimes && (a.psi !== b.psi || a.psf !== b.psf), text: label(a) + ': ' + ch.join(' · ') });
      // Horas reales (▶ / ■)
      if (a.ri === b.ri && a.rf === b.rf) return;
      if (b.ri === null && b.rf === null) { out.push({ type: 'real', key: k, jors: [b.jornada], text: label(b) + ': registros ▶ / ■ borrados (vuelve a ir en hora)' }); return; }
      if (a.ri === null && a.rf === null && b.ri !== null && b.rf !== null) {      // ■ pasivo: inicio dado por en hora
        const d = b.rf - b.psf;
        out.push({ type: 'real', key: k, jors: [b.jornada], amber: d !== 0, text: '■ ' + label(b) + ' termina ' + hm(b.rf) + ' (inicio en hora, ' + hm(b.ri) + ') · ' + (d < 0 ? 'acaba ' + (-d) + ' min antes' : devTxt(d)) });
        return;
      }
      if (b.ri !== a.ri && b.ri !== null) { const d = b.ri - b.psi; out.push({ type: 'real', key: k, jors: [b.jornada], amber: d !== 0, text: '▶ ' + label(b) + ' empieza ' + hm(b.ri) + ' · ' + devTxt(d) }); }
      if (b.rf !== a.rf && b.rf !== null) { const d = b.rf - b.psf; out.push({ type: 'real', key: k, jors: [b.jornada], amber: d !== 0, text: '■ ' + label(b) + ' termina ' + hm(b.rf) + ' · ' + (d < 0 ? 'acaba ' + (-d) + ' min antes' : devTxt(d)) }); }
    });
    return out;
  }

  /**
   * Un cambio del festival hecho por el regidor. ctx: { t, src, ev: [entradas propias de la orden], noTimes, skip }
   * Primero la foto (con el estado de ANTES), luego lo que cambió y luego la orden (retraso, desborde…).
   */
  function commit(log, prev, next, ctx) {
    const c = ctx || {};
    let lg = ensureFoto(log, prev || next, c.t);
    if (c.skip) return lg;
    return record(lg, diff(prev, next, { noTimes: !!c.noTimes }).concat(c.ev || []), c, next || prev);
  }

  // ── Informe ───────────────────────────────────────────────────────────
  /** Jornadas que se pueden pedir: las del evento, las que tienen foto y las que salen en el log. */
  function reportDays(log, state) {
    const d = (state ? C.eventDays(state).concat(C.festivalDays(state, 'show'), C.festivalDays(state, 'sc'), C.festivalDays(state, 'all')) : [])
      .concat(log ? Object.keys(log.fotos) : []).concat(log ? [].concat.apply([], log.entries.map(e => e.jors)) : []);
    return uniq(d.filter(x => C.dayIndex(x) !== null)).sort();
  }

  function section(log, state, j, cats) {
    const foto = log && log.fotos[j] || null;
    const allNow = new Map(); C.buildBlocks(state, { mode: 'all', day: 'all' }).forEach(b => allNow.set(b.key, b));
    const cur = C.buildBlocks(state, { mode: 'all', day: j }).filter(b => b.psi !== null);
    const base = foto ? foto.items : cur.map(itemOf);
    const since = foto ? foto.at : -Infinity;
    const ents = log ? log.entries.filter(e => e.jors.indexOf(j) >= 0 && e.t >= since) : [];
    const lastOf = (type, key) => { for (let i = ents.length - 1; i >= 0; i--) if (ents[i].type === type && ents[i].key === key) return ents[i]; return null; };
    const rows = [], stats = { plan: 0, chg: 0, del: 0, add: 0, inc: 0 };
    const inBase = new Set(base.map(p => p.key));
    base.forEach(p => {
      if (!cats[p.kind]) return;
      stats.plan++;
      const b = allNow.get(p.key);
      const row = { r: 'sched', t: p.psi, k: p.kind, name: p.name, stage: p.stage, plan: [p.psi, p.psf] };
      if (!b || b.jornada !== j || b.psi === null) {
        const de = lastOf('del', p.key);
        Object.assign(row, { status: b && b.jornada !== j ? 'moved' : 'deleted', when: de ? de.t : null, movedTo: b && b.jornada !== j ? b.jornada : null, fin: [null, null], real: [false, false], chg: [false, false] });
        stats.del++;
      } else {
        const fs = b.si, fe = b.kind === 'hito' ? null : b.sf;
        const chg = [fs !== p.psi, b.kind !== 'hito' && fe !== p.psf];
        Object.assign(row, { status: 'ok', newName: b.name !== p.name ? b.name : null, newStage: (b.stageId || '') !== (p.stageId || '') ? (b.stage || 'sin zona') : null,
          fin: [fs, fe], real: [b.ri !== null, b.rf !== null], chg });
        if (chg[0] || chg[1]) stats.chg++;
      }
      rows.push(row);
    });
    if (foto) cur.filter(b => !inBase.has(b.key)).forEach(b => {
      if (!cats[b.kind]) return;
      const ae = lastOf('add', b.key) || lastOf('edit', b.key);
      rows.push({ r: 'sched', t: b.psi, k: b.kind, name: b.name, stage: b.stage, plan: [null, null], fin: [b.si, b.kind === 'hito' ? null : b.sf],
        real: [b.ri !== null, b.rf !== null], chg: [false, false], status: 'added', when: ae ? ae.t : null });
      stats.add++;
    });
    if (cats.inc) ents.forEach(e => { rows.push({ r: 'inc', t: e.t, n: e.n, type: e.type, text: e.text, src: e.src, amber: e.amber }); stats.inc++; });
    rows.sort((a, b) => (a.t - b.t) || (a.r === b.r ? (a.n || 0) - (b.n || 0) : a.r === 'sched' ? -1 : 1));
    return { jornada: j, foto: !!foto, fotoAt: foto ? foto.at : null, rows, stats };
  }

  /**
   * opts: { day: 'YYYY-MM-DD' | 'all', cats: { show, sc, tarea, hito, inc }, nowMs }
   * → { event, day, cats, generated, sections: [...] }  (con «Todo el evento», solo las jornadas con algo)
   */
  function report(log, state, opts) {
    const o = opts || {}, cats = {};
    CATS.forEach(k => { cats[k] = !o.cats || o.cats[k] !== false; });
    const days = o.day && o.day !== 'all' ? [o.day] : reportDays(log, state);
    let sections = days.map(j => section(log, state, j, cats));
    if (!o.day || o.day === 'all') sections = sections.filter(s => s.rows.length);
    return { event: (state && state.event && state.event.nombre) || 'Evento', day: o.day || 'all', cats, generated: o.nowMs || Date.now(), sections };
  }

  // ── Formatos ──────────────────────────────────────────────────────────
  function genTxt(ms) { const d = new Date(ms); return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' + C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes()); }
  function catsTxt(cats) { const on = CATS.filter(k => cats[k]); return on.length === CATS.length ? 'Todo' : on.map(k => CAT_TXT[k]).join(' · ') || 'nada'; }
  function stateTxt(r) {
    if (r.status === 'deleted') return 'BORRADA' + (r.when !== null ? ' ' + hm(r.when) : '');
    if (r.status === 'moved') return 'MOVIDA a ' + fmtDay(r.movedTo);
    if (r.status === 'added') return 'AÑADIDA' + (r.when !== null ? ' ' + hm(r.when) : '');
    const p = [];
    if (r.real[0] || r.real[1]) p.push('hora real');
    const di = r.chg[0] && r.plan[0] !== null ? r.fin[0] - r.plan[0] : null;
    const df = r.chg[1] && r.plan[1] !== null && r.plan[1] !== undefined && r.fin[1] !== null ? r.fin[1] - r.plan[1] : null;
    if (di !== null && df !== null && di === df) p.push('movida ' + devTxt(di));          // se desplaza entera (retraso)
    else {
      if (di !== null) p.push('inicio ' + devTxt(di));
      if (df !== null) p.push(df < 0 ? 'acaba ' + (-df) + ' min antes' : 'fin ' + devTxt(df));
    }
    return p.join(' · ');
  }
  function nameTxt(r) { return r.name + (r.newName ? ' → ' + r.newName : ''); }
  function stageTxt(r) { return (r.stage || '') + (r.newStage ? ' → ' + r.newStage : ''); }
  function rangeTxt(a, b, chg, mark) {
    if (a === null || a === undefined) return '';
    return hm(a) + (chg && chg[0] && mark ? mark : '') + (b !== null && b !== undefined ? '–' + hm(b) + (chg && chg[1] && mark ? mark : '') : '');
  }
  function secTitle(s) { return fmtDay(s.jornada, true); }
  function secNote(s) { return s.foto ? 'Previsto: el horario tal como estaba a las ' + hm(s.fotoAt) + ' (foto de la jornada)' : 'Previsto: el horario actual (esta jornada no tiene foto)'; }

  function toTxt(rep) {
    const L = [], pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
    L.push('SHOWTIME · LOG DEL EVENTO', '='.repeat(72), 'Evento:    ' + rep.event, 'Jornada:   ' + (rep.day === 'all' ? 'Todo el evento' : fmtDay(rep.day, true)),
      'Incluye:   ' + catsTxt(rep.cats), 'Generado:  ' + genTxt(rep.generated), '', 'Leyenda: * = hora distinta de la prevista · >> = incidencia', '');
    if (!rep.sections.length) L.push('(Sin nada que mostrar con estos filtros)');
    rep.sections.forEach(s => {
      L.push('', '── ' + secTitle(s).toUpperCase() + ' ' + '─'.repeat(Math.max(3, 66 - secTitle(s).length)), secNote(s), '');
      L.push(pad('HORA', 7) + pad('TIPO', 12) + pad('ENTRADA', 30) + pad('PREVISTO', 14) + pad('REAL', 15) + 'ESTADO');
      s.rows.forEach(r => {
        if (r.r === 'inc') { L.push(pad(hm(r.t), 7) + '>> ' + TYPE_TXT[r.type].toUpperCase() + ': ' + r.text + ' (' + SRC_TXT[r.src] + ')'); return; }
        const nm = nameTxt(r) + (r.stage || r.newStage ? ' · ' + stageTxt(r) : '');
        L.push(pad(hm(r.t), 7) + pad(KIND_TXT[r.k], 12) + pad(nm, 30) + pad(rangeTxt(r.plan[0], r.plan[1]), 14) + pad(r.status === 'deleted' || r.status === 'moved' ? '—' : rangeTxt(r.fin[0], r.fin[1], r.chg, '*'), 15) + stateTxt(r));
      });
      const st = s.stats;
      L.push('', 'Resumen: ' + st.plan + ' previstas · ' + st.chg + ' con hora cambiada · ' + st.del + ' borradas o movidas · ' + st.add + ' añadidas · ' + st.inc + ' incidencias');
    });
    return L.join('\n') + '\n';
  }

  function toCsv(rep) {
    const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [['Jornada', 'Hora', 'Fila', 'Tipo', 'Entrada / incidencia', 'Zona', 'Inicio previsto', 'Fin previsto', 'Inicio real', 'Fin real', 'Cambio de hora', 'Estado', 'Origen']];
    rep.sections.forEach(s => s.rows.forEach(r => {
      if (r.r === 'inc') { out.push([s.jornada, hm(r.t), 'Incidencia', TYPE_TXT[r.type], r.text, '', '', '', '', '', r.amber ? 'sí' : '', '', SRC_TXT[r.src]]); return; }
      const gone = r.status === 'deleted' || r.status === 'moved';
      out.push([s.jornada, hm(r.t), 'Horario', KIND_TXT[r.k], nameTxt(r), stageTxt(r), r.plan[0] !== null ? hm(r.plan[0]) : '', r.plan[1] !== null && r.plan[1] !== undefined ? hm(r.plan[1]) : '',
        gone || r.fin[0] === null ? '' : hm(r.fin[0]), gone || r.fin[1] === null || r.fin[1] === undefined ? '' : hm(r.fin[1]), r.chg[0] || r.chg[1] ? 'sí' : '', stateTxt(r), '']);
    }));
    return '﻿' + out.map(r => r.map(q).join(';')).join('\r\n') + '\r\n';   // BOM y «;»: Excel y Numbers en español lo abren directo
  }

  /** Página para imprimir / «Guardar como PDF» (sin librerías). */
  function toHtml(rep) {
    const kindCls = { show: 'k-show', sc: 'k-sc', tarea: 'k-tarea', hito: 'k-hito' };
    const t = (v, c) => '<span class="' + (c ? 'chg' : '') + '">' + hm(v) + '</span>';
    const rng = (a, b, ch) => a === null || a === undefined ? '<span class="mut">—</span>' : t(a, ch && ch[0]) + (b !== null && b !== undefined ? '<span class="mut">–</span>' + t(b, ch && ch[1]) : '');
    const secs = rep.sections.map(s => {
      const st = s.stats;
      const rows = s.rows.map(r => {
        if (r.r === 'inc') return '<tr class="inc' + (r.amber ? ' hot' : '') + '"><td class="h">' + hm(r.t) + '</td><td colspan="5"><span class="tag">' + esc(TYPE_TXT[r.type]) + '</span> ' + esc(r.text) + '<span class="src">' + esc(SRC_TXT[r.src]) + '</span></td></tr>';
        const gone = r.status === 'deleted' || r.status === 'moved';
        const stt = stateTxt(r);
        const badge = r.status === 'deleted' || r.status === 'moved' ? '<span class="tag">' + esc(stt) + '</span>' : r.status === 'added' ? '<span class="tag">' + esc(stt) + '</span>' : esc(stt);
        return '<tr class="' + (gone ? 'gone' : '') + (r.status === 'added' ? ' added' : '') + (r.chg[0] || r.chg[1] ? ' moved' : '') + '"><td class="h">' + hm(r.t) + '</td>' +
          '<td><span class="kind ' + kindCls[r.k] + '">' + esc(KIND_TXT[r.k]) + '</span></td>' +
          '<td class="nm"><b>' + esc(r.name) + '</b>' + (r.newName ? ' <span class="chg">→ ' + esc(r.newName) + '</span>' : '') + (r.stage || r.newStage ? '<small>' + esc(r.stage || '') + (r.newStage ? ' <span class="chg">→ ' + esc(r.newStage) + '</span>' : '') + '</small>' : '') + '</td>' +
          '<td class="tm">' + rng(r.plan[0], r.plan[1]) + '</td>' +
          '<td class="tm">' + (gone ? '<span class="mut">—</span>' : rng(r.fin[0], r.fin[1], r.chg)) + '</td>' +
          '<td class="st">' + badge + '</td></tr>';
      }).join('');
      return '<section><div class="sh"><h2>' + esc(secTitle(s)) + '</h2><p class="note">' + esc(secNote(s)) + '</p>' +
        '<div class="stats"><span><b>' + st.plan + '</b> previstas</span><span class="' + (st.chg ? 'hot' : '') + '"><b>' + st.chg + '</b> con hora cambiada</span><span class="' + (st.del ? 'hot' : '') + '"><b>' + st.del + '</b> borradas o movidas</span><span class="' + (st.add ? 'hot' : '') + '"><b>' + st.add + '</b> añadidas</span><span class="' + (st.inc ? 'hot' : '') + '"><b>' + st.inc + '</b> incidencias</span></div></div>' +
        (s.rows.length ? '<table><colgroup><col class="c-h"><col class="c-k"><col><col class="c-t"><col class="c-t"><col class="c-s"></colgroup><thead><tr><th>Hora</th><th>Tipo</th><th>Entrada · zona</th><th>Previsto</th><th>Real</th><th>Estado</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="empty">Nada que mostrar con estos filtros.</p>') + '</section>';
    }).join('');
    const title = 'Log · ' + rep.event + ' · ' + (rep.day === 'all' ? 'todo el evento' : fmtDay(rep.day));
    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + PRINT_CSS + '</style></head><body>' +
      '<div class="bar"><span>Vista para imprimir · en el diálogo, elige <b>Guardar como PDF</b></span><button onclick="window.print()">Imprimir / Guardar PDF</button></div>' +
      '<main><header><div class="brand">SHOWTIME · LOG DEL EVENTO</div><h1>' + esc(rep.event) + '</h1>' +
      '<dl><div><dt>Jornada</dt><dd>' + esc(rep.day === 'all' ? 'Todo el evento' : fmtDay(rep.day, true)) + '</dd></div><div><dt>Incluye</dt><dd>' + esc(catsTxt(rep.cats)) + '</dd></div><div><dt>Generado</dt><dd>' + esc(genTxt(rep.generated)) + '</dd></div></dl>' +
      '<p class="legend"><span class="sw chgsw">21:04</span> hora distinta de la prevista (con barra lateral) <span class="sw incsw"></span> incidencia (hora en que pasó) <span class="sw gonesw">Banda</span> borrada o movida</p></header>' +
      (secs || '<p class="empty">Nada que mostrar con estos filtros.</p>') + '</main></body></html>';
  }

  const PRINT_CSS = [
    '@page{size:A4;margin:14mm 12mm 16mm}',
    '@page{@bottom-left{content:"Showtime · Log del evento";font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#9ca3af}@bottom-right{content:counter(page) " / " counter(pages);font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#9ca3af}}',
    ':root{--ink:#14161b;--mut:#6b7280;--line:#e6e8ec;--soft:#f6f7f9;--amb:#b45309;--ambln:#f59e0b;--ambbg:#fff7eb;--sc:#7c3aed;--tarea:#2563eb}',
    '*{box-sizing:border-box}html,body{margin:0;background:#fff}',
    'body{font:9.4pt/1.38 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Inter,Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.bar{position:sticky;top:0;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:10px 20px;background:#14161b;color:#e5e7eb;font-size:13px;z-index:2}',
    '.bar button{font:600 13px inherit;background:#ffb347;color:#000;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}',
    '@media print{.bar{display:none}}',
    'main{max-width:190mm;margin:0 auto;padding:18px 0 30px}@media screen{main{padding:28px 20px 60px}}',
    'header{border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:6px}',
    '.brand{font-size:7.5pt;font-weight:700;letter-spacing:.16em;color:var(--mut)}',
    'h1{font-size:20pt;line-height:1.1;margin:4px 0 10px;letter-spacing:-.01em}',
    'dl{display:flex;flex-wrap:wrap;gap:6px 26px;margin:0}dl div{display:flex;gap:6px;align-items:baseline}dt{font-size:7.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}dd{margin:0;font-weight:600}',
    '.legend{margin:10px 0 0;font-size:8pt;color:var(--mut);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}',
    '.sw{display:inline-block;margin-left:10px}.sw:first-child{margin-left:0}.chgsw{color:var(--amb);font-weight:700;font-variant-numeric:tabular-nums}',
    '.incsw{width:18px;height:10px;background:var(--ambbg);border-left:3px solid var(--ambln)}.gonesw{text-decoration:line-through;color:#9ca3af}',
    'section{margin-top:18px}',
    '.sh{break-after:avoid}h2{font-size:13pt;margin:0}h2::first-letter{text-transform:uppercase}.note{margin:2px 0 6px;font-size:8pt;color:var(--mut)}',
    '.stats{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.stats span{font-size:8pt;padding:2px 8px;border-radius:20px;background:var(--soft);color:#374151}.stats span.hot{background:var(--ambbg);color:var(--amb)}',
    'table{width:100%;border-collapse:collapse;table-layout:fixed}',
    'col.c-h{width:13mm}col.c-k{width:22mm}col.c-t{width:25mm}col.c-s{width:34mm}',
    'thead th{font-size:7pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);text-align:left;padding:5px 6px;border-bottom:1.5px solid var(--ink)}',
    'td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}tr{break-inside:avoid}',
    'td.h,td.tm{font-variant-numeric:tabular-nums;white-space:nowrap}td.h{font-weight:700}',
    'td.nm b{font-weight:650}td.nm small{display:block;color:var(--mut);font-size:8pt}',
    '.kind{font-size:7.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase}.k-show{color:var(--ink)}.k-sc{color:var(--sc)}.k-tarea{color:var(--tarea)}.k-hito{color:var(--mut)}',
    '.mut{color:#9ca3af}.chg{color:var(--amb);font-weight:700}',
    'td.st{font-size:8pt;color:var(--mut)}tr.moved td.st{color:var(--amb)}',
    'tr.moved td.h{box-shadow:inset 3px 0 0 var(--amb);color:var(--amb)}',
    'tr.gone td{color:#9ca3af}tr.gone td.nm b{text-decoration:line-through}tr.gone .kind{color:#9ca3af}',
    'tr.added td.nm b::after{content:" (nueva)";font-weight:400;color:var(--amb)}',
    '.tag{display:inline-block;font-size:6.8pt;font-weight:800;letter-spacing:.07em;text-transform:uppercase;padding:1px 5px;border-radius:3px;border:1px solid currentColor;color:var(--amb);margin-right:4px;vertical-align:1px;white-space:nowrap}',
    'tr.inc td{background:var(--ambbg);border-bottom-color:#fde7c7}tr.inc td.h{border-left:3px solid var(--ambln);color:var(--amb)}',
    'tr.inc.hot td:last-child{font-weight:650}',
    '.src{float:right;margin-left:10px;font-size:7.5pt;color:var(--mut)}',
    '.empty{color:var(--mut);font-style:italic;padding:10px 0}'
  ].join('\n');

  const API = { VERSION, SRC_TXT, KIND_TXT, TYPE_TXT, CATS, CAT_TXT, eventKey, empty, norm, fotoOf, ensureFoto, record, diff, commit, reportDays, report, toTxt, toCsv, toHtml, fmtDay };
  if (isNode) module.exports = API;
  else root.ShowtimeLog = API;
})(typeof window !== 'undefined' ? window : globalThis);
