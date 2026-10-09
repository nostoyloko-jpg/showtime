/* Showtime — cripto.js  (Transporte local 2d-C, dec. 115)
 * Cifrado de RESERVA, en JavaScript puro y sin librerías, para los móviles que abren Showtime por la red local
 * (http://192.168.x.x:8765). Esas páginas no son «contexto seguro» y el navegador les quita crypto.subtle; sin esto
 * no habría protocolo de la decisión 55.
 *
 *  - Mismos algoritmos y mismo formato de bytes que WebCrypto: SHA-256, HMAC-SHA256, AES-GCM (clave 128/192/256,
 *    IV de 12 bytes, etiqueta de 16 al final, datos asociados) y verificación ECDSA P-256 con SHA-256 (firma r‖s de 64 bytes).
 *  - Solo lo que necesita un móvil: abrir y comprobar lo que firma el Mac, y cifrar/firmar el «hola» y las órdenes.
 *    Crear claves ECDSA o firmar con ellas NO está (eso solo lo hace el Dashboard, que siempre tiene WebCrypto).
 *  - Solo se usa si el navegador no trae crypto.subtle. Probado contra WebCrypto con miles de vectores (tests/cripto.test.js).
 *  - Los números aleatorios siguen saliendo de crypto.getRandomValues, que el navegador sí da fuera de contexto seguro.
 */
(function (root) {
  'use strict';

  // ── Bytes ────────────────────────────────────────────────────────────
  function u8(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    throw new TypeError('Se esperaban bytes');
  }
  const ab = a => a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
  function err(name, msg) { const e = new Error(msg); e.name = name; return e; }

  // ── SHA-256 ──────────────────────────────────────────────────────────
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(data) {
    const m = u8(data), len = m.length, nb = ((len + 9 + 63) >> 6) << 6, p = new Uint8Array(nb);
    p.set(m); p[len] = 0x80;
    const bits = len * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    p[nb - 8] = hi >>> 24; p[nb - 7] = hi >>> 16; p[nb - 6] = hi >>> 8; p[nb - 5] = hi;
    p[nb - 4] = lo >>> 24; p[nb - 3] = lo >>> 16; p[nb - 2] = lo >>> 8; p[nb - 1] = lo;
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (p[o + 4 * i] << 24) | (p[o + 4 * i + 1] << 16) | (p[o + 4 * i + 2] << 8) | p[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
    return out;
  }

  // ── HMAC-SHA256 ──────────────────────────────────────────────────────
  function hmac(key, data) {
    let k = u8(key); if (k.length > 64) k = sha256(k);
    data = u8(data);
    const ip = new Uint8Array(64 + data.length), op = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) { const b = i < k.length ? k[i] : 0; ip[i] = b ^ 0x36; op[i] = b ^ 0x5c; }
    ip.set(u8(data), 64); op.set(sha256(ip), 64);
    return sha256(op);
  }
  /** Comparación sin atajos (tiempo constante con respecto al contenido). */
  function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

  // ── AES (cifrado de bloque) ──────────────────────────────────────────
  const SBOX = new Uint8Array(256);
  (function () {   // S-box generada (no tecleada): inverso en GF(2^8) + transformación afín
    const rotl = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff;
    let p = 1, q = 1;
    do {
      p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
      SBOX[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
    } while (p !== 1);
    SBOX[0] = 0x63;
  })();
  const xt = x => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
  function expandKey(key) {
    const nk = key.length / 4, nr = nk + 6, w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    let rcon = 1;
    for (let i = nk; i < 4 * (nr + 1); i++) {
      let t0 = w[4 * i - 4], t1 = w[4 * i - 3], t2 = w[4 * i - 2], t3 = w[4 * i - 1];
      if (i % nk === 0) { const x = t0; t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[x]; rcon = xt(rcon); }
      else if (nk > 6 && i % nk === 4) { t0 = SBOX[t0]; t1 = SBOX[t1]; t2 = SBOX[t2]; t3 = SBOX[t3]; }
      const j = 4 * (i - nk);
      w[4 * i] = w[j] ^ t0; w[4 * i + 1] = w[j + 1] ^ t1; w[4 * i + 2] = w[j + 2] ^ t2; w[4 * i + 3] = w[j + 3] ^ t3;
    }
    return { w, nr };
  }
  function encBlock(ks, inp, out) {
    const s = new Uint8Array(16), w = ks.w, nr = ks.nr, t = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = inp[i] ^ w[i];
    for (let r = 1; r <= nr; r++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) t[4 * c + row] = s[4 * ((c + row) % 4) + row];   // ShiftRows (columnas)
      if (r < nr) {
        for (let c = 0; c < 4; c++) {
          const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3], x = a0 ^ a1 ^ a2 ^ a3;
          s[4 * c] = a0 ^ x ^ xt(a0 ^ a1); s[4 * c + 1] = a1 ^ x ^ xt(a1 ^ a2); s[4 * c + 2] = a2 ^ x ^ xt(a2 ^ a3); s[4 * c + 3] = a3 ^ x ^ xt(a3 ^ a0);
        }
      } else s.set(t);
      const o = 16 * r; for (let i = 0; i < 16; i++) s[i] ^= w[o + i];
    }
    out.set(s);
  }

  // ── GCM ──────────────────────────────────────────────────────────────
  function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function gmul(X, H) {   // X·H en GF(2^128) (convención de GCM), 4 palabras de 32 bits
    let z0 = 0, z1 = 0, z2 = 0, z3 = 0, v0 = H[0], v1 = H[1], v2 = H[2], v3 = H[3];
    for (let i = 0; i < 128; i++) {
      if ((X[i >> 5] >>> (31 - (i & 31))) & 1) { z0 ^= v0; z1 ^= v1; z2 ^= v2; z3 ^= v3; }
      const lsb = v3 & 1;
      v3 = (v3 >>> 1) | (v2 << 31); v2 = (v2 >>> 1) | (v1 << 31); v1 = (v1 >>> 1) | (v0 << 31); v0 = v0 >>> 1;
      if (lsb) v0 ^= 0xe1000000;
    }
    X[0] = z0 >>> 0; X[1] = z1 >>> 0; X[2] = z2 >>> 0; X[3] = z3 >>> 0;
  }
  function ghash(H, aad, ct) {
    const Y = new Uint32Array(4);
    const feed = d => {
      for (let o = 0; o < d.length; o += 16) {
        const b = new Uint8Array(16); b.set(d.subarray(o, o + 16));
        Y[0] ^= be32(b, 0); Y[1] ^= be32(b, 4); Y[2] ^= be32(b, 8); Y[3] ^= be32(b, 12); gmul(Y, H);
      }
    };
    feed(aad); feed(ct);
    const la = aad.length * 8, lc = ct.length * 8;
    Y[0] ^= Math.floor(la / 0x100000000); Y[1] ^= la >>> 0; Y[2] ^= Math.floor(lc / 0x100000000); Y[3] ^= lc >>> 0; gmul(Y, H);
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) { out[4 * i] = Y[i] >>> 24; out[4 * i + 1] = Y[i] >>> 16; out[4 * i + 2] = Y[i] >>> 8; out[4 * i + 3] = Y[i]; }
    return out;
  }
  function gcmCore(key, iv, aad, data, decrypt) {
    if (iv.length !== 12) throw err('OperationError', 'IV de 12 bytes');
    const ks = expandKey(key), Hb = new Uint8Array(16); encBlock(ks, new Uint8Array(16), Hb);
    const H = new Uint32Array([be32(Hb, 0), be32(Hb, 4), be32(Hb, 8), be32(Hb, 12)]);
    const J0 = new Uint8Array(16); J0.set(iv); J0[15] = 1;
    const ctr = Uint8Array.from(J0), ksb = new Uint8Array(16), out = new Uint8Array(data.length);
    for (let o = 0; o < data.length; o += 16) {
      for (let i = 15; i >= 12; i--) { ctr[i] = (ctr[i] + 1) & 0xff; if (ctr[i]) break; }   // inc32
      encBlock(ks, ctr, ksb);
      const n = Math.min(16, data.length - o);
      for (let i = 0; i < n; i++) out[o + i] = data[o + i] ^ ksb[i];
    }
    const S = ghash(H, aad, decrypt ? data : out), EJ = new Uint8Array(16); encBlock(ks, J0, EJ);
    for (let i = 0; i < 16; i++) S[i] ^= EJ[i];
    return { out, tag: S };
  }
  function gcmEncrypt(key, iv, aad, pt) { const r = gcmCore(u8(key), u8(iv), u8(aad || new Uint8Array(0)), u8(pt), false); const o = new Uint8Array(r.out.length + 16); o.set(r.out); o.set(r.tag, r.out.length); return o; }
  function gcmDecrypt(key, iv, aad, ct) {
    const c = u8(ct); if (c.length < 16) throw err('OperationError', 'Cifrado demasiado corto');
    const body = c.subarray(0, c.length - 16), tag = c.subarray(c.length - 16);
    const r = gcmCore(u8(key), u8(iv), u8(aad || new Uint8Array(0)), body, true);
    if (!same(r.tag, tag)) throw err('OperationError', 'Etiqueta GCM no válida');
    return r.out;
  }

  // ── ECDSA P-256 (solo verificar) ─────────────────────────────────────
  const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;
  const md = (a, m) => { const r = a % m; return r < 0n ? r + m : r; };
  function inv(a, m) {   // inverso modular (Euclides extendido)
    let lo = 1n, hi = 0n, l = md(a, m), h = m;
    while (l > 1n) { const q = h / l; [lo, hi] = [hi - lo * q, lo]; [l, h] = [h - l * q, l]; }
    return md(lo, m);
  }
  const INF = null;
  function dbl(p) {   // Jacobianas, a = −3
    if (p === INF || p[1] === 0n) return INF;
    const [X, Y, Z] = p, d = md(Z * Z, P), g = md(Y * Y, P), be = md(X * g, P), al = md(3n * (X - d) * (X + d), P);
    const X3 = md(al * al - 8n * be, P), Z3 = md((Y + Z) * (Y + Z) - g - d, P), Y3 = md(al * (4n * be - X3) - 8n * g * g, P);
    return [X3, Y3, Z3];
  }
  function add(p, q) {
    if (p === INF) return q; if (q === INF) return p;
    const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q, z1 = md(Z1 * Z1, P), z2 = md(Z2 * Z2, P);
    const U1 = md(X1 * z2, P), U2 = md(X2 * z1, P), S1 = md(Y1 * z2 * Z2, P), S2 = md(Y2 * z1 * Z1, P);
    if (U1 === U2) return S1 === S2 ? dbl(p) : INF;
    const H = md(U2 - U1, P), R = md(S2 - S1, P), H2 = md(H * H, P), H3 = md(H2 * H, P), U1H2 = md(U1 * H2, P);
    const X3 = md(R * R - H3 - 2n * U1H2, P), Y3 = md(R * (U1H2 - X3) - S1 * H3, P), Z3 = md(H * Z1 * Z2, P);
    return [X3, Y3, Z3];
  }
  function affineX(p) { if (p === INF) return null; const zi = inv(p[2], P); return md(p[0] * zi * zi, P); }
  function onCurve(x, y) { return md(y * y - (x * x * x - 3n * x + B), P) === 0n; }
  function big(b) { let x = 0n; for (let i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]); return x; }
  /** Clave pública «raw» sin comprimir (0x04‖X‖Y, 65 bytes): se comprueba que está en la curva. */
  function pubPoint(raw) {
    const r = u8(raw);
    if (r.length !== 65 || r[0] !== 4) throw err('DataError', 'Clave pública P-256 no válida');
    const x = big(r.subarray(1, 33)), y = big(r.subarray(33));
    if (x >= P || y >= P || !onCurve(x, y)) throw err('DataError', 'La clave no está en la curva P-256');
    return [x, y, 1n];
  }
  function ecdsaVerify(Q, sig, msg) {
    const s8 = u8(sig); if (s8.length !== 64) return false;
    const r = big(s8.subarray(0, 32)), s = big(s8.subarray(32));
    if (r < 1n || r >= N || s < 1n || s >= N) return false;
    const e = big(sha256(msg)), w = inv(s, N), u1 = md(e * w, N), u2 = md(r * w, N);
    const G = [GX, GY, 1n], GQ = add(G, Q);   // Shamir: u1·G + u2·Q en una sola pasada
    let X = INF;
    for (let i = 255; i >= 0; i--) {
      X = dbl(X);
      const b1 = (u1 >> BigInt(i)) & 1n, b2 = (u2 >> BigInt(i)) & 1n;
      if (b1 && b2) X = add(X, GQ); else if (b1) X = add(X, G); else if (b2) X = add(X, Q);
    }
    const x = affineX(X);
    return x !== null && md(x, N) === r;
  }

  // ── Interfaz tipo crypto.subtle (lo que usa emision.js en un móvil) ────
  const nm = a => String(a && typeof a === 'object' ? a.name : a || '').toUpperCase();
  function hashOk(a) { const h = a && typeof a === 'object' ? a.hash : null; return !h || nm(h) === 'SHA-256'; }
  const subtle = {
    async digest(alg, data) { if (nm(alg) !== 'SHA-256') throw err('NotSupportedError', 'Solo SHA-256'); return ab(sha256(u8(data))); },
    async importKey(format, data, alg, extractable, usages) {
      if (format !== 'raw') throw err('NotSupportedError', 'Solo claves «raw» en el cifrado de reserva');
      const n = nm(alg), k = Uint8Array.from(u8(data));
      if (n === 'AES-GCM') { if ([16, 24, 32].indexOf(k.length) < 0) throw err('DataError', 'Clave AES no válida'); return { type: 'secret', algorithm: { name: 'AES-GCM', length: k.length * 8 }, usages: usages || [], _k: k }; }
      if (n === 'HMAC') { if (!hashOk(alg)) throw err('NotSupportedError', 'Solo HMAC-SHA256'); if (!k.length) throw err('DataError', 'Clave HMAC vacía'); return { type: 'secret', algorithm: { name: 'HMAC', hash: { name: 'SHA-256' } }, usages: usages || [], _k: k }; }
      if (n === 'ECDSA') { if (alg.namedCurve !== 'P-256') throw err('NotSupportedError', 'Solo P-256'); return { type: 'public', algorithm: { name: 'ECDSA', namedCurve: 'P-256' }, usages: usages || [], _q: pubPoint(k) }; }
      throw err('NotSupportedError', 'Algoritmo no disponible: ' + n);
    },
    async encrypt(alg, key, data) {
      if (nm(alg) !== 'AES-GCM' || !key || !key._k || key.algorithm.name !== 'AES-GCM') throw err('InvalidAccessError', 'Solo AES-GCM');
      if (alg.tagLength && alg.tagLength !== 128) throw err('NotSupportedError', 'Etiqueta de 128 bits');
      return ab(gcmEncrypt(key._k, alg.iv, alg.additionalData, data));
    },
    async decrypt(alg, key, data) {
      if (nm(alg) !== 'AES-GCM' || !key || !key._k || key.algorithm.name !== 'AES-GCM') throw err('InvalidAccessError', 'Solo AES-GCM');
      if (alg.tagLength && alg.tagLength !== 128) throw err('NotSupportedError', 'Etiqueta de 128 bits');
      return ab(gcmDecrypt(key._k, alg.iv, alg.additionalData, data));
    },
    async sign(alg, key, data) {
      if (nm(alg) === 'HMAC' && key && key.algorithm.name === 'HMAC') return ab(hmac(key._k, u8(data)));
      throw err('NotSupportedError', 'El cifrado de reserva no firma con ECDSA (eso lo hace el Dashboard)');
    },
    async verify(alg, key, sig, data) {
      const n = nm(alg);
      if (n === 'HMAC' && key && key.algorithm.name === 'HMAC') return same(hmac(key._k, u8(data)), u8(sig));
      if (n === 'ECDSA' && key && key._q) { if (!hashOk(alg)) throw err('NotSupportedError', 'Solo SHA-256'); return ecdsaVerify(key._q, u8(sig), u8(data)); }
      throw err('InvalidAccessError', 'Clave o algoritmo no válidos');
    },
    async generateKey() { throw err('NotSupportedError', 'Crear claves solo en el Dashboard (WebCrypto)'); },
    async exportKey() { throw err('NotSupportedError', 'Exportar claves solo en el Dashboard (WebCrypto)'); }
  };

  const API = { subtle, sha256, hmac, gcmEncrypt, gcmDecrypt, ecdsaVerify, pubPoint, _: { SBOX, encBlock, expandKey } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeCripto = API;
})(typeof window !== 'undefined' ? window : this);
