import json, re, sys, datetime
import os
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..') + os.sep
html=open(SRC+'live.html').read()
body=html[html.index('<body>')+len('<body>'):html.index('<script src="core.js"></script>')].strip()
css=open(SRC+'live.css').read()
core=open(SRC+'core.js').read()
live=open(SRC+'live.js').read()
SHIM=r'''/* Adaptador Synapse → Pantalla Live de Showtime: sustituye a datos.js dentro de la ventana emergente.
 * Los datos llegan de Synapse en window.__LIVE__ y con receiveUpdate(); estilo con applyLiveStyle(). */
(function () {
  'use strict';
  const STYLES = ['clasico', 'escenario', 'neutro', 'raycast'];
  function normStyle(v) { if (v === 'oled') v = 'raycast'; if (v === 'ambar') v = 'escenario'; return STYLES.indexOf(v) >= 0 ? v : 'clasico'; }
  const L = window.__LIVE__ || { fest: null, config: {} };
  const listeners = [];
  const KEY = 'smlive.callDone';
  function read() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function emit(t) { listeners.forEach(fn => { try { fn(t); } catch (e) { console.error(e); } }); }
  window.ShowtimeDatos = {
    normStyle: normStyle,
    getFestival: () => L.fest,
    getConfig: () => Object.assign({ mode: 'show', day: 'all', style: 'clasico', callMins: null }, L.config || {}, { style: normStyle(L.config && L.config.style) }),
    callMinsOf: (f, c) => { if (c && c.callMins) return c.callMins; const v = f && f.event && Number(f.event.callMins); return v > 0 ? v : 15; },
    getCallDone: read,
    markCallDone: (k, now) => {
      const l = read().filter(x => { const m = Number(String(x).split('@').pop()); return !isFinite(m) || m > (now || 0) - 2880; });
      if (l.indexOf(k) < 0) l.push(k);
      try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {}
      return l;
    },
    onChange: fn => { listeners.push(fn); },
    hello: () => {}
  };
  // Synapse → ventana
  window.receiveUpdate = function (p) { if (p && p.fest) { L.fest = p.fest; if (p.config) L.config = p.config; emit('festival'); } };
  window.tickFromParent = function () {};          // la ventana ya se actualiza sola cada segundo
  window.applyLiveStyle = function (v) { L.config = Object.assign({}, L.config, { style: normStyle(v) }); emit('config'); };
  try { const bc = new BroadcastChannel('sm-live'); bc.onmessage = e => { if (e.data && e.data.type === 'lvStyle') window.applyLiveStyle(e.data.v); }; } catch (e) {}
  window.addEventListener('storage', e => {
    if (e.key === KEY) { emit('callDone'); return; }
    if (e.key !== 'sm.settings') return;
    try { const v = JSON.parse(e.newValue || '{}').liveStyle; if (v) window.applyLiveStyle(v); } catch (err) {}
  });
})();
'''
def js_str(s):
    # JSON válido como literal JS; «</» escapado para no cerrar el <script> de index.html ni el de la ventana
    return json.dumps(s, ensure_ascii=False).replace('</', '<\\/').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
VER=datetime.date.today().isoformat()
MARK='Showtime Live -> Synapse (completo)'
NEW='''// ═══════════════════════════════════════════════════════════════════════════
// '''+MARK+''' · '''+VER+'''
// La ventana Live de Synapse usa EXACTAMENTE el código de la Pantalla Live de Showtime
// (live.html + live.css + core.js + live.js). Para actualizarla, se vuelve a generar este bloque.
// Las funciones antiguas quedan como buildLiveWindow_OLD / pushLiveUpdate_OLD (y liveWindowScript), sin uso.
// ═══════════════════════════════════════════════════════════════════════════
const ST_LIVE = {
  version: '''+json.dumps(VER)+''',
  css: '''+js_str(css)+''',
  body: '''+js_str(body)+''',
  core: '''+js_str(core)+''',
  shim: '''+js_str(SHIM)+''',
  live: '''+js_str(live)+'''
};
function stLiveStyle() {
  try { if (typeof liveStyle !== 'undefined' && liveStyle) return liveStyle; } catch (e) {}
  try { const s = JSON.parse(localStorage.getItem('sm.settings') || '{}'); if (s.liveStyle) return s.liveStyle; } catch (e) {}
  return 'clasico';
}
/** Datos para la ventana: el proyecto de Synapse (solo los campos de horarios) + modo, día y estilo. */
function stLivePayload() {
  const isSC = _liveWinMode === 'sc';
  const day = (isSC ? _scDay : _tlDay) || 'all';
  const ev = (S && S.event) || {};
  const keys = ['id', 'nombre', 'color', 'escenarioId', 'fecha', 'inicio', 'fin', 'notas', 'soundcheckFecha', 'soundcheckInicio', 'soundcheckFin', 'soundcheckCall', 'soundcheckNotas', 'showtimeCall', 'showtimeStandby', 'showtimeStandbySC'];
  const artists = ((S && S.artists) || []).map(a => { const o = {}; keys.forEach(k => { if (a[k] !== undefined) o[k] = a[k]; }); return o; });
  return {
    fest: { event: { nombre: ev.nombre || '', dayCutoff: ev.dayCutoff || '06:00', callMins: ev.callMins || 15 },
            escenarios: ((S && S.escenarios) || []).map(e => ({ id: e.id, nombre: e.nombre, color: e.color })), artists: artists },
    config: { mode: isSC ? 'sc' : 'show', day: day, style: stLiveStyle(), callMins: null }
  };
}
function buildLiveWindow() {
  if (!_liveWin || _liveWin.closed) return;
  const data = JSON.stringify(stLivePayload()).replace(/</g, '\\\\u003c');
  const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synapse Live</title><style>' + ST_LIVE.css + '</style></head><body>' + ST_LIVE.body +
    '<script>window.__LIVE__=' + data + ';<\\/script>' +
    '<script>' + ST_LIVE.core + '<\\/script><script>' + ST_LIVE.shim + '<\\/script><script>' + ST_LIVE.live + '<\\/script></body></html>';
  _liveWin.document.open();
  _liveWin.document.write(html);
  _liveWin.document.close();
}
function pushLiveUpdate() {
  if (!_liveWin || _liveWin.closed || !_liveWin.receiveUpdate) return;
  try { _liveWin.receiveUpdate(stLivePayload()); } catch (e) {}
}
// ═══ fin '''+MARK+''' ═══
'''
PATCHES=[
 {'id':'1','que':'Renombrar la buildLiveWindow antigua','buscar':'function buildLiveWindow(){','poner':'function buildLiveWindow_OLD(){'},
 {'id':'2','que':'Renombrar la pushLiveUpdate antigua y añadir el bloque nuevo delante','buscar':'function pushLiveUpdate(){','poner':NEW+'function pushLiveUpdate_OLD(){'},
]
OUT=os.path.dirname(os.path.abspath(__file__))+os.sep
open(OUT+'bloque-showtime-live.js','w').write(NEW)
js='''#!/usr/bin/env node
/* Parche «'''+MARK+'''» · '''+VER+'''
 * Deja la ventana Live de Synapse IGUAL que la Pantalla Live de Showtime (mismo código).
 * Uso:   node aplicar-parche-synapse-completo.js /ruta/a/index.html
 * Comprueba que cada trozo aparece EXACTAMENTE una vez; si no, no toca nada.
 * Guarda copia del original: index.html.antes-showtime-live
 * Vale tanto si ya se aplicó el parche anterior (synapse-live) como si no.
 * Si este parche ya está aplicado, ACTUALIZA solo su bloque a la versión nueva (copia: index.html.antes-actualizar-live).
 */
'use strict';
const fs = require('fs');
const MARK = '''+json.dumps(MARK)+''';
const VERSION = '''+json.dumps(VER)+''';
const PATCHES = '''+json.dumps(PATCHES, ensure_ascii=False)+''';
const FIN = '// ═══ fin ' + MARK + ' ═══\\n';
/** Si el parche ya está aplicado, sustituye SOLO el bloque nuevo (entre sus marcas) por la versión actual. */
function actualizar(texto) {
  const i = texto.indexOf('// ' + MARK + ' · ');
  const f = texto.indexOf(FIN);
  if (i < 0 || f < 0 || f < i) return { ok: false, errores: ['El bloque aplicado no tiene sus marcas de inicio y fin: no se toca nada.'] };
  const ini = texto.lastIndexOf('// ═══', i - 1);            // línea de adorno que va justo encima
  if (ini < 0 || texto.slice(ini, i).split('\\n').length !== 2) return { ok: false, errores: ['No encuentro el comienzo del bloque: no se toca nada.'] };
  const viejo = texto.slice(ini, f + FIN.length);
  if (viejo === PATCHES[1].poner.slice(0, PATCHES[1].poner.indexOf(FIN) + FIN.length)) return { ok: false, errores: ['Ya está en esta versión: no hay nada que actualizar.'] };
  const nuevo = PATCHES[1].poner.slice(0, PATCHES[1].poner.indexOf(FIN) + FIN.length);
  return { ok: true, texto: texto.slice(0, ini) + nuevo + texto.slice(f + FIN.length), actualizado: true };
}
function aplicar(texto) {
  if (texto.indexOf(MARK) >= 0) return actualizar(texto);
  const errores = [];
  PATCHES.forEach(p => { const n = texto.split(p.buscar).length - 1; if (n !== 1) errores.push('Paso ' + p.id + ' (' + p.que + '): «' + p.buscar + '» aparece ' + n + ' veces (debe ser 1).'); });
  if (errores.length) return { ok: false, errores };
  let out = texto;
  PATCHES.forEach(p => { out = out.replace(p.buscar, () => p.poner); });
  return { ok: true, texto: out };
}
if (require.main === module) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node aplicar-parche-synapse-completo.js /ruta/a/index.html'); process.exit(2); }
  const original = fs.readFileSync(ruta, 'utf8');
  const r = aplicar(original);
  if (!r.ok) { console.error('NO SE HA TOCADO NADA.\\n- ' + r.errores.join('\\n- ')); process.exit(1); }
  const copia = ruta + (r.actualizado ? '.antes-actualizar-live' : '.antes-showtime-live');
  fs.writeFileSync(copia, original);
  fs.writeFileSync(ruta, r.texto);
  console.log((r.actualizado ? 'Parche ACTUALIZADO a la versión ' : 'Parche aplicado (versión ') + VERSION + (r.actualizado ? '' : ')') + '. Copia del original: ' + copia);
  console.log('Ahora abre Synapse, abre la ventana Live (Show y Soundcheck), cambia de estilo y comprueba que pinta y que la consola no tiene errores.');
}
module.exports = { aplicar, actualizar, PATCHES, MARK };
'''
open(OUT+'aplicar-parche-synapse-completo.js','w').write(js)
print(len(NEW), len(js))
