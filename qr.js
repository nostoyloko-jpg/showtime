/* Showtime — qr.js
 * Generador de códigos QR propio, sin librerías (ISO/IEC 18004, modo byte, UTF-8).
 *   ShowtimeQR.encode(texto, { ecl: 'L'|'M'|'Q'|'H', mask: 0..7 }) → { version, size, ecl, mask, modules: [[bool]] }
 *   ShowtimeQR.svg(texto, { ecl, margin: 4, dark: '#000', light: '#fff' }) → '<svg …>' (vectorial, nítido a cualquier tamaño)
 * Sin opción de máscara elige la de menor penalización, como manda la norma.
 */
(function (root) {
  'use strict';

  const ECL = { L: 0, M: 1, Q: 2, H: 3 };
  const ECL_FORMAT = [1, 0, 3, 2];   // bits de formato de L, M, Q, H
  // Por versión (índice 0 sin uso): bytes de corrección por bloque y número de bloques. Filas: L, M, Q, H.
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  // ── Aritmética del cuerpo GF(256) y Reed-Solomon ─────────────────────
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift(); r.push(0);
      div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    }
    return r;
  }

  // ── Tamaños ──────────────────────────────────────────────────────────
  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const a = Math.floor(ver / 7) + 2; n -= (25 * a - 10) * a - 55; if (ver >= 7) n -= 36; }
    return n;
  }
  function dataCodewords(ver, e) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver]; }
  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const r = [6];
    for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  }

  // ── Bits de datos ────────────────────────────────────────────────────
  function dataBits(bytes, ver) {
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);                                   // modo byte
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    return bits;
  }
  function pickVersion(bytes, e) {
    for (let v = 1; v <= 40; v++) if (dataBits(bytes, v).length <= dataCodewords(v, e) * 8) return v;
    return 0;
  }

  // ── Matriz ───────────────────────────────────────────────────────────
  function Matrix(ver) {
    const size = ver * 4 + 17;
    this.ver = ver; this.size = size;
    this.m = Array.from({ length: size }, () => new Array(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array(size).fill(false));
  }
  Matrix.prototype.setFn = function (x, y, dark) { this.m[y][x] = dark; this.fn[y][x] = true; };

  function drawFunctionPatterns(M, e) {
    const s = M.size;
    for (let i = 0; i < s; i++) { M.setFn(6, i, i % 2 === 0); M.setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < s && y >= 0 && y < s) M.setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(s - 4, 3); finder(3, s - 4);
    const al = alignPositions(M.ver), n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) M.setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    drawFormat(M, e, 0);
    drawVersion(M);
  }
  function formatBits(e, mask) {
    const d = (ECL_FORMAT[e] << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  }
  function drawFormat(M, e, mask) {
    const b = formatBits(e, mask), s = M.size, bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) M.setFn(8, i, bit(i));
    M.setFn(8, 7, bit(6)); M.setFn(8, 8, bit(7)); M.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) M.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) M.setFn(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) M.setFn(8, s - 15 + i, bit(i));
    M.setFn(8, s - 8, true);   // módulo oscuro fijo
  }
  function versionBits(ver) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    return (ver << 12) | r;
  }
  function drawVersion(M) {
    if (M.ver < 7) return;
    const b = versionBits(M.ver);
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) !== 0, a = M.size - 11 + i % 3, c = Math.floor(i / 3);
      M.setFn(a, c, d); M.setFn(c, a, d);
    }
  }
  /** Recorrido en zigzag de los módulos de datos (de abajo a la derecha, en columnas de dos). */
  function dataOrder(M) {
    const out = [], s = M.size;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < s; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - v : v;
        if (!M.fn[y][x]) out.push([x, y]);
      }
    }
    return out;
  }
  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }
  function applyMask(M, mask) {
    for (let y = 0; y < M.size; y++) for (let x = 0; x < M.size; x++) if (!M.fn[y][x] && maskBit(mask, x, y)) M.m[y][x] = !M.m[y][x];
  }

  /** Penalización de la norma (N1 rachas, N2 bloques 2×2, N3 patrón tipo buscador, N4 equilibrio). */
  function penalty(m) {
    const s = m.length; let p = 0, dark = 0;
    const lines = [];
    for (let i = 0; i < s; i++) { lines.push(m[i]); lines.push(m.map(r => r[i])); }
    lines.forEach(L => {
      let run = 1;
      for (let i = 1; i <= s; i++) {
        if (i < s && L[i] === L[i - 1]) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      const str = L.map(b => b ? '1' : '0').join('');
      for (const pat of ['10111010000', '00001011101']) { let k = str.indexOf(pat); while (k >= 0) { p += 40; k = str.indexOf(pat, k + 1); } }
    });
    for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
      const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    m.forEach(r => r.forEach(b => { if (b) dark++; }));
    const total = s * s;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function encode(text, opts) {
    const o = opts || {};
    const e = ECL[o.ecl || 'M']; if (e === undefined) throw new Error('Nivel de corrección no válido');
    const bytes = utf8(String(text));
    const ver = o.version || pickVersion(bytes, e);
    if (!ver || dataBits(bytes, ver).length > dataCodewords(ver, e) * 8) throw new Error('Texto demasiado largo para un QR');
    // Datos + terminador + relleno
    const cap = dataCodewords(ver, e) * 8, bits = dataBits(bytes, ver);
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; data.length < cap / 8; pad ^= 0xEC ^ 0x11) data.push(pad);
    // Bloques + corrección, intercalados
    const nb = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen);
    const blocks = []; let k = 0;
    for (let i = 0; i < nb; i++) {
      const d = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += d.length;
      const ecc = rsRemainder(d, div);
      if (i < nShort) d.push(0);
      blocks.push(d.concat(ecc));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) cw.push(b[i]); });
    // Matriz
    const M = new Matrix(ver);
    drawFunctionPatterns(M, e);
    const order = dataOrder(M);
    order.forEach(([x, y], i) => { M.m[y][x] = i < cw.length * 8 ? ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1 : false; });
    let mask = o.mask;
    if (mask === undefined) {
      let best = Infinity;
      for (let t = 0; t < 8; t++) {
        applyMask(M, t); drawFormat(M, e, t);
        const pn = penalty(M.m);
        if (pn < best) { best = pn; mask = t; }
        applyMask(M, t);
      }
    }
    applyMask(M, mask); drawFormat(M, e, mask);
    return { version: ver, size: M.size, ecl: 'LMQH'[e], mask, modules: M.m };
  }

  function svg(text, opts) {
    const o = opts || {}, q = encode(text, o), mg = o.margin === undefined ? 4 : o.margin, n = q.size + mg * 2;
    let d = '';
    q.modules.forEach((row, y) => {
      for (let x = 0; x < q.size; x++) {
        if (!row[x]) continue;
        let w = 1; while (x + w < q.size && row[x + w]) w++;
        d += 'M' + (x + mg) + ' ' + (y + mg) + 'h' + w + 'v1h-' + w + 'z';
        x += w - 1;
      }
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="Código QR">'
      + '<rect width="' + n + '" height="' + n + '" fill="' + (o.light || '#fff') + '"/><path fill="' + (o.dark || '#000') + '" d="' + d + '"/></svg>';
  }

  const API = {
    encode, svg,
    // internos (para los tests)
    _: { ECC_PER_BLOCK, NUM_BLOCKS, ECL, gfMul, rsDivisor, rsRemainder, rawModules, dataCodewords, alignPositions, formatBits, versionBits, maskBit, dataOrder, Matrix, drawFunctionPatterns, utf8 }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeQR = API;
})(typeof window !== 'undefined' ? window : globalThis);
