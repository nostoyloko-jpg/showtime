/* Showtime — marca.js · Identidad de marca (sin dependencias, sin imágenes: todo vectorial)
 * El mismo cartel en tres sitios: pantalla de inicio y «Acerca de Showtime…» (Dashboard) y Modo Cartel / Standby (Pantalla Live).
 *   ShowtimeMarca.banner({ version, footer })  → HTML del cartel ~3:1 (monograma ST, SHOWTIME · by Synapse Live,
 *                                                 Real-Time Show Control y líneas de tiempo fluyendo)
 *   ShowtimeMarca.monogram(cls)                → SVG del isotipo ST (S maciza)
 *   ShowtimeMarca.standbySearch(search, on)    → query de la Live con / sin «vista=standby» (guarda la vista de antes en «prev»)
 *   ShowtimeMarca.isStandby(search) · prevVista(search)
 * Estilos: marca.css (lo cargan index.html y live.html).
 */
(function (root) {
  'use strict';

  const NAME = 'SHOWTIME', BY = 'by Synapse Live', DESC = 'Real-Time Show Control';
  const FOOT = 'BUILT FOR LIFE ON STAGE · © 2026 Synapse Live';
  // Isotipo ST (S maciza), trazado del máster de 2048 px. Caja 1545 × 1094.
  const ST_VIEWBOX = '0 0 1545 1094';
  const ST_PATH = 'M234 0L0 215L0 337L535 784L401 898L195 724L0 724L0 866L219 1094L545 1094L784 864L784 702L265 276L393 168L596 342L784 342L784 225L535 0Z' +
    'M624 0L1545 0L1545 186L1279 186L1279 861L1032 1094L1032 189L831 186Z';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function monogram(cls) {
    return '<svg class="' + esc(cls || 'stm-mono') + '" viewBox="' + ST_VIEWBOX + '" aria-hidden="true" focusable="false"><path d="' + ST_PATH + '"/></svg>';
  }

  // ── Líneas de tiempo: entran rectas por la izquierda (difuminadas), se curvan y se ordenan en dos «carriles» con nodos ──
  const RAIL_A = 640, RAIL_B = 840;
  const LINES = [   // [y de entrada, x donde empieza la curva, y de salida, ¿destacada?]
    [214, 300, 96, 0], [240, 340, 124, 0], [266, 380, 168, 1], [292, 420, 214, 0], [318, 440, 268, 0],
    [344, 360, 330, 1], [370, 320, 380, 0], [396, 400, 420, 0], [422, 440, 460, 1], [448, 380, 500, 0]
  ];
  function linePath(l) {
    const y0 = l[0], x1 = l[1], y1 = l[2];
    return 'M0 ' + y0 + 'H' + x1 + 'C' + (x1 + 110) + ' ' + y0 + ' ' + (x1 + 70) + ' ' + y1 + ' ' + (x1 + 180) + ' ' + y1 + 'H1000';
  }
  function flow() {
    let s = '<svg class="stm-lines" viewBox="0 0 1000 600" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">';
    s += '<g class="stm-rails"><path d="M' + RAIL_A + ' 60V560"/><path d="M' + RAIL_B + ' 0V600"/>' +
      '<path d="M' + (RAIL_A - 6) + ' 150h12M' + (RAIL_B - 6) + ' 240h12M' + (RAIL_B + 40) + ' 310v24M500 300v18"/></g>';
    s += '<g class="stm-l">' + LINES.map(l => '<path d="' + linePath(l) + '"/>').join('') + '</g>';
    // Pulsos: un tramo claro que recorre la línea de derecha a izquierda
    s += '<g class="stm-p">' + LINES.map((l, i) => l[3] ? '<path pathLength="1000" style="animation-delay:' + (-i * 1.7).toFixed(1) + 's" d="' + linePath(l) + '"/>' : '').join('') + '</g>';
    s += '<g class="stm-n">' + LINES.map(l => '<circle cx="' + RAIL_A + '" cy="' + l[2] + '" r="4"/><circle cx="' + RAIL_B + '" cy="' + l[2] + '" r="4"' + (l[3] ? ' class="on"' : '') + '/>').join('') + '</g>';
    s += '<g class="stm-t"><text x="18" y="196">20:00</text><text x="250" y="196">21:00</text><text x="' + (RAIL_B - 70) + '" y="40">22:00</text></g>';
    return s + '</svg>';
  }

  /** Cartel completo. o: { version: '20261045' (opcional), footer: bool } */
  function banner(o) {
    const opt = o || {};
    return '<div class="stm" role="img" aria-label="' + esc(NAME + ' ' + BY + ' · ' + DESC) + '">' +
      '<div class="stm-glow"></div>' +
      '<div class="stm-flow">' + flow() + '</div>' +
      '<div class="stm-id">' + monogram('stm-mono') +
        '<div class="stm-name">' + NAME + '</div><div class="stm-by">' + esc(BY) + '</div><div class="stm-desc">' + esc(DESC) + '</div></div>' +
      (opt.version ? '<div class="stm-ver">v' + esc(opt.version) + '</div>' : '') +
      (opt.footer ? '<div class="stm-foot">' + esc(FOOT) + '</div>' : '') +
      '</div>';
  }

  // ── Modo Cartel (Standby) en la URL de la Live: «vista=standby&prev=<vista de antes>» ──
  function q(search) { return new URLSearchParams(String(search || '').replace(/^\?/, '')); }
  function isStandby(search) { return q(search).get('vista') === 'standby'; }
  function prevVista(search) { const p = q(search); return p.get('vista') === 'standby' ? (p.get('prev') || '') : (p.get('vista') || ''); }
  /** Devuelve la query («?…») con el Standby puesto o quitado. Al quitarlo, vuelve la vista de antes. */
  function standbySearch(search, on) {
    const p = q(search);
    const cur = p.get('vista');
    if (on) {
      if (cur !== 'standby') { if (cur) p.set('prev', cur); else p.delete('prev'); }
      p.set('vista', 'standby');
    } else if (cur === 'standby') {
      const prev = p.get('prev');
      p.delete('prev');
      if (prev) p.set('vista', prev); else p.delete('vista');
    }
    const s = p.toString();
    return s ? '?' + s : '';
  }
  /** «HH:MM» (sin segundos) para el reloj discreto del Standby. */
  function hhmm(d) { const x = d || new Date(); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); }

  const API = { NAME, BY, DESC, FOOT, ST_PATH, ST_VIEWBOX, monogram, flow, banner, isStandby, prevVista, standbySearch, hhmm };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeMarca = API;
})(typeof window !== 'undefined' ? window : globalThis);
