/* Tests de qr.js — sin dependencias.
 * Ordenador:  node tests/qr.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const Q = isNode ? require('../qr.js') : window.ShowtimeQR;
  const _ = Q._;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  // ── Lector independiente (para comprobar lo que se genera) ────────────
  // Lee el formato, quita la máscara, recoge los bytes, deshace el intercalado,
  // comprueba que la corrección Reed-Solomon cuadra (síndromes = 0) y extrae el texto.
  function gfPow(e) { let r = 1; for (let i = 0; i < e; i++) r = _.gfMul(r, 2); return r; }
  function readQR(m) {
    const size = m.length, ver = (size - 17) / 4;
    const bit = (x, y) => m[y][x] ? 1 : 0;
    let f1 = 0, f2 = 0;
    [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]].forEach(([x, y], i) => { f1 |= bit(x, y) << i; });
    for (let i = 0; i < 8; i++) f2 |= bit(size - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) f2 |= bit(8, size - 15 + i) << i;
    if (f1 !== f2) throw new Error('las dos copias del formato no coinciden');
    let ecl = -1, mask = -1;
    for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) if (_.formatBits(e, k) === f1) { ecl = e; mask = k; }
    if (ecl < 0) throw new Error('formato no válido');
    if (ver >= 7) {
      let v1 = 0, v2 = 0;
      for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, c = Math.floor(i / 3); v1 |= bit(a, c) << i; v2 |= bit(c, a) << i; }
      if (v1 !== _.versionBits(ver) || v2 !== _.versionBits(ver)) throw new Error('información de versión incorrecta');
    }
    if (!m[size - 8][8]) throw new Error('falta el módulo oscuro');
    const M = new _.Matrix(ver); _.drawFunctionPatterns(M, ecl);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M.fn[y][x] && !(y === 8 || x === 8) && M.m[y][x] !== m[y][x]) throw new Error('patrón fijo alterado en ' + x + ',' + y);
    const bits = _.dataOrder(M).map(([x, y]) => (m[y][x] !== _.maskBit(mask, x, y)) ? 1 : 0);
    const raw = Math.floor(_.rawModules(ver) / 8), cw = [];
    for (let i = 0; i < raw; i++) cw.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));
    const nb = _.NUM_BLOCKS[ecl][ver], eccLen = _.ECC_PER_BLOCK[ecl][ver], nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const blocks = Array.from({ length: nb }, (x, j) => new Array(shortLen + (j < nShort ? 0 : 1)));
    let k = 0;
    for (let i = 0; i <= shortLen; i++) for (let j = 0; j < nb; j++) {
      if (i === shortLen - eccLen && j < nShort) continue;
      const idx = i > shortLen - eccLen && j < nShort ? i - 1 : i;
      if (idx < blocks[j].length) blocks[j][idx] = cw[k++];
    }
    const data = [];
    blocks.forEach(b => {
      for (let s = 0; s < eccLen; s++) {          // síndrome: el bloque evaluado en α^s debe dar 0
        const a = gfPow(s); let v = 0;
        b.forEach(c => { v = _.gfMul(v, a) ^ c; });
        if (v !== 0) throw new Error('la corrección de errores no cuadra');
      }
      data.push(...b.slice(0, b.length - eccLen));
    });
    const db = data.map(b => b.toString(2).padStart(8, '0')).join('');
    if (db.slice(0, 4) !== '0100') throw new Error('no es modo byte');
    const cl = ver <= 9 ? 8 : 16, n = parseInt(db.slice(4, 4 + cl), 2), out = [];
    for (let i = 0; i < n; i++) out.push(parseInt(db.slice(4 + cl + i * 8, 12 + cl + i * 8), 2));
    return { text: decodeURIComponent(out.map(b => '%' + b.toString(16).padStart(2, '0')).join('')), ecl: 'LMQH'[ecl], mask, ver };
  }

  // Referencia: el mismo enlace codificado por OpenCV 5 (versión 8, nivel M, máscara 2), filas en hexadecimal
  const REF_TEXT = 'https://nostoyloko-jpg.github.io/showtime/live.html#sala=Ab3dEf9hIjKlMnOp&k=0123456789abcdefghijkl&p=ZYXWVUTSRQPONMLKJIHGFE';
  const REF = [
    'fe0d157ca4bf8', '822d3f0bd7a08', 'baa70ac6a1ae8', 'bafe61453d2e8', 'badcbfe39c2e8', '82edca38fe208', 'feaaaaaaaabf8',
    '00c8fa33c2800', 'be3827e4193e0', '650f705694e40', 'f24a3d386fad8', '25c3d9ac829d8', 'c6c1f1c37c820', 'f04d25d20d230',
    'da6131b873158', '604344a359888', '5af6e1960df40', '69a992c358608', '03e0c3560ddd8', 'd42f8004e0f98', 'f3b3cbc13fe30',
    '04f1539e8c3b0', '8fcc2bf8fff88', '2899d63eb4898', '8a88dea358af0', '78b31227148c0', '6fcb9ffa6bf98', '34e1dc5f81448',
    '0ff4e1813de38', '401f3eb69dd60', '2b6c4f84e3f38', 'e8cbbab42e290', 'dadc33a9f3dc0', '04f8f1bca6c08', '6e7d564bd13d8',
    '04e9e586a4000', '3f7c484539eb0', '5c7867e755910', '47154348eb788', '717e004e469d0', 'e3feebf70dfe0', '00c3923f4c8d0',
    'fe7762a1b2af8', '82e9ce2af08d0', 'bad513e35afb8', 'bae5e263157f0', 'bafd95bdf2178', '8269066359a08', 'feba91160c458'
  ];

  test('igual que la referencia de OpenCV (v8 · M · máscara 2)', () => {
    const q = Q.encode(REF_TEXT, { ecl: 'M', mask: 2 });
    eq(q.version, 8); eq(q.size, 49);
    q.modules.forEach((row, y) => {
      const want = parseInt(REF[y], 16).toString(2).padStart(52, '0').slice(0, 49);
      eq(row.map(b => b ? '1' : '0').join(''), want, 'fila ' + y);
    });
  });

  test('capacidad de las tablas (versiones 1 y 40, los 4 niveles)', () => {
    const E = _.ECL;
    eq(_.dataCodewords(1, E.L), 19); eq(_.dataCodewords(1, E.M), 16); eq(_.dataCodewords(1, E.Q), 13); eq(_.dataCodewords(1, E.H), 9);
    eq(_.dataCodewords(40, E.L), 2956); eq(_.dataCodewords(40, E.M), 2334); eq(_.dataCodewords(40, E.Q), 1666); eq(_.dataCodewords(40, E.H), 1276);
    eq(_.rawModules(1), 208); eq(_.rawModules(40), 29648);
  });

  test('posiciones de alineación (versiones 2, 7, 32, 40)', () => {
    eq(_.alignPositions(1).join(), ''); eq(_.alignPositions(2).join(), '6,18'); eq(_.alignPositions(7).join(), '6,22,38');
    eq(_.alignPositions(32).join(), '6,34,60,86,112,138'); eq(_.alignPositions(40).join(), '6,30,58,86,114,142,170');
  });

  test('bits de formato y de versión (valores de la norma)', () => {
    eq(_.formatBits(_.ECL.M, 0), 0x5412); eq(_.formatBits(_.ECL.L, 4), 0x662F); eq(_.formatBits(_.ECL.H, 7), 0x083B);
    eq(_.versionBits(7), 0x07C94); eq(_.versionBits(40), 0x28C69);
  });

  test('se lee de vuelta: textos de 1 a 700 caracteres, 4 niveles, todas las máscaras', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_#&=?/:.';
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const texts = ['A', 'Ñandú · ¡Sí! ÚLTIMO TEMA', REF_TEXT];
    [9, 30, 60, 110, 180, 270, 400, 700].forEach(n => texts.push(Array.from({ length: n }, () => chars[Math.floor(rnd() * chars.length)]).join('')));
    let n = 0;
    texts.forEach((t, i) => ['L', 'M', 'Q', 'H'].forEach(ecl => {
      const q = Q.encode(t, { ecl, mask: (i + n) % 8 }); n++;
      const r = readQR(q.modules);
      eq(r.text, t, 'v' + q.version + ' ' + ecl); eq(r.ecl, ecl); eq(r.mask, q.mask);
    }));
    ok(n === 44);
  });

  test('máscara automática: la de menor penalización y legible', () => {
    const q = Q.encode(REF_TEXT);
    eq(q.ecl, 'M'); ok(q.mask >= 0 && q.mask < 8);
    eq(readQR(q.modules).text, REF_TEXT);
  });

  test('versión mínima que cabe', () => {
    eq(Q.encode('x'.repeat(14), { ecl: 'M' }).version, 1);
    eq(Q.encode('x'.repeat(15), { ecl: 'M' }).version, 2);
    eq(Q.encode('x'.repeat(2331), { ecl: 'M' }).version, 40);
  });

  test('demasiado largo: error claro', () => {
    let msg = '';
    try { Q.encode('x'.repeat(2332), { ecl: 'M' }); } catch (e) { msg = e.message; }
    ok(/demasiado largo/.test(msg), msg);
  });

  test('SVG: vectorial, con margen y colores', () => {
    const s = Q.svg('Showtime', { margin: 4, dark: '#111', light: '#fafafa' });
    ok(/^<svg [^>]*viewBox="0 0 29 29"/.test(s), 'v1 + margen 4 = 29');
    ok(s.indexOf('fill="#111"') > 0 && s.indexOf('fill="#fafafa"') > 0);
    ok(/<path [^>]*d="M\d/.test(s));
  });

  let pass = 0; const fails = [];
  tests.forEach(([n, f]) => { try { f(); pass++; } catch (e) { fails.push([n, e.message]); } });
  const summary = 'QR: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
  if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); if (fails.length) process.exitCode = 1; }
  else {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const box = document.createElement('div');
    box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
    document.getElementById('out').appendChild(box);
    window.__TEST_QR__ = { pass, total: tests.length, fails };
  }
})();
