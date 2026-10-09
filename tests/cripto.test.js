/* Tests de cripto.js (cifrado de reserva de la red local, dec. 115): paridad byte a byte con WebCrypto.
 * Ordenador:  node tests/cripto.test.js     (usa el WebCrypto de Node como referencia)
 */
(async function () {
  'use strict';
  const J = require('../cripto.js'), wc = require('crypto').webcrypto, S = wc.subtle;
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const hex = b => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('hex');
  const unhex = h => Uint8Array.from(Buffer.from(h, 'hex'));
  const rnd = n => wc.getRandomValues(new Uint8Array(n));
  const rint = n => Math.floor(Math.random() * n);
  async function rejects(p) { try { await p; return false; } catch (e) { return true; } }

  test('SHA-256: vectores conocidos (NIST) y 2000 mensajes al azar idénticos a WebCrypto (todas las longitudes de relleno)', async () => {
    eq(hex(J.sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    eq(hex(J.sha256(Buffer.from('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    eq(hex(J.sha256(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    for (let i = 0; i < 2000; i++) {
      const m = rnd(i < 200 ? i : rint(3000));
      eq(hex(J.sha256(m)), hex(await S.digest('SHA-256', m)), 'longitud ' + m.length);
    }
    eq(hex(await J.subtle.digest({ name: 'SHA-256' }, Buffer.from('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'interfaz subtle');
  });

  test('HMAC-SHA256: RFC 4231 y 2000 firmas al azar idénticas a WebCrypto; verify acepta las buenas y rechaza las alteradas', async () => {
    eq(hex(J.hmac(new Uint8Array(20).fill(0x0b), Buffer.from('Hi There'))), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    eq(hex(J.hmac(Buffer.from('Jefe'), Buffer.from('what do ya want for nothing?'))), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    eq(hex(J.hmac(new Uint8Array(131).fill(0xaa), Buffer.from('Test Using Larger Than Block-Size Key - Hash Key First'))), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54', 'clave > 64 bytes');
    for (let i = 0; i < 2000; i++) {
      const key = rnd(i % 4 === 0 ? 16 : 1 + rint(100)), m = rnd(rint(600));
      const nk = await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      const jk = await J.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      const ns = new Uint8Array(await S.sign('HMAC', nk, m)), js = new Uint8Array(await J.subtle.sign('HMAC', jk, m));
      eq(hex(js), hex(ns), 'firma ' + i);
      ok(await J.subtle.verify('HMAC', jk, ns, m), 'verifica la de WebCrypto');
      ok(await S.verify('HMAC', nk, js, m), 'WebCrypto verifica la suya');
      if (i % 10 === 0) { const bad = Uint8Array.from(ns); bad[rint(32)] ^= 1 << rint(8); ok(!await J.subtle.verify('HMAC', jk, bad, m), 'alterada'); ok(!await J.subtle.verify('HMAC', jk, ns.subarray(0, 31), m), 'corta'); }
    }
  });

  test('AES-GCM: vectores NIST (casos 2, 3, 4) y 3000 cifrados al azar idénticos a WebCrypto (claves 128/192/256, con y sin datos asociados)', async () => {
    const K = new Uint8Array(16), IV = new Uint8Array(12);
    eq(hex(J.gcmEncrypt(K, IV, new Uint8Array(0), new Uint8Array(16))), '0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf', 'caso 2');
    const k3 = unhex('feffe9928665731c6d6a8f9467308308'), iv3 = unhex('cafebabefacedbaddecaf888');
    const p3 = unhex('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255');
    eq(hex(J.gcmEncrypt(k3, iv3, new Uint8Array(0), p3)), '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091473f5985'
      + '4d5c2af327cd64a62cf35abd2ba6fab4', 'caso 3');
    eq(hex(J.gcmEncrypt(k3, iv3, unhex('feedfacedeadbeeffeedfacedeadbeefabaddad2'), p3.subarray(0, 60))), '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091'
      + '5bc94fbc3221a5db94fae95ae7121a47', 'caso 4 (datos asociados)');
    for (let i = 0; i < 3000; i++) {
      const key = rnd([16, 16, 24, 32][i % 4]), iv = rnd(12), pt = rnd(i < 100 ? i : rint(2000)), aad = rnd(rint(4) ? rint(40) : 0);
      const alg = { name: 'AES-GCM', iv, additionalData: aad };
      const nk = await S.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']), jk = await J.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
      const nc = new Uint8Array(await S.encrypt(alg, nk, pt)), jc = new Uint8Array(await J.subtle.encrypt(alg, jk, pt));
      eq(hex(jc), hex(nc), 'cifrado ' + i + ' (' + key.length * 8 + ' bits, ' + pt.length + ' B)');
      eq(hex(await J.subtle.decrypt(alg, jk, nc)), hex(pt), 'descifra el de WebCrypto');
      eq(hex(await S.decrypt(alg, nk, jc)), hex(pt), 'WebCrypto descifra el suyo');
      if (i % 5 === 0) {
        const bad = Uint8Array.from(nc); bad[rint(bad.length)] ^= 1 << rint(8);
        ok(await rejects(J.subtle.decrypt(alg, jk, bad)), 'byte alterado → error (como WebCrypto)');
        if (aad.length) { const a2 = Uint8Array.from(aad); a2[0] ^= 1; ok(await rejects(J.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: a2 }, jk, nc)), 'otros datos asociados → error'); }
        const iv2 = Uint8Array.from(iv); iv2[11] ^= 1; ok(await rejects(J.subtle.decrypt({ name: 'AES-GCM', iv: iv2, additionalData: aad }, jk, nc)), 'otro IV → error');
      }
    }
    ok(await rejects(J.subtle.decrypt({ name: 'AES-GCM', iv: IV }, await J.subtle.importKey('raw', K, 'AES-GCM', false, ['decrypt']), new Uint8Array(15))), 'más corto que la etiqueta');
    ok(await rejects(J.subtle.importKey('raw', new Uint8Array(15), 'AES-GCM', false, ['encrypt'])), 'clave de 15 bytes');
    // Un paquete grande como una ráfaga de estado (contador de 32 bits recorriendo muchos bloques)
    const key = rnd(16), iv = rnd(12), big = rnd(60000), alg = { name: 'AES-GCM', iv, additionalData: rnd(20) };
    eq(hex(await J.subtle.encrypt(alg, await J.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']), big)), hex(await S.encrypt(alg, await S.importKey('raw', key, 'AES-GCM', false, ['encrypt']), big)), '60 KB');
  });

  test('ECDSA P-256: 400 firmas de WebCrypto verificadas en JS; mensaje, firma o clave alterados → falso', async () => {
    for (let i = 0; i < 40; i++) {
      const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const raw = new Uint8Array(await S.exportKey('raw', kp.publicKey));
      const jk = await J.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      for (let j = 0; j < 10; j++) {
        const m = rnd(rint(500)), sig = new Uint8Array(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, m));
        ok(await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, jk, sig, m), 'firma buena ' + i + '/' + j);
        const bs = Uint8Array.from(sig); bs[rint(64)] ^= 1 << rint(8);
        ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, jk, bs, m), 'firma alterada');
        const bm = Uint8Array.from(m.length ? m : [0]); bm[rint(bm.length)] ^= 1; if (m.length) ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, jk, sig, bm), 'mensaje alterado');
      }
    }
    const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), other = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const m = rnd(50), sig = new Uint8Array(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, m));
    const ko = await J.subtle.importKey('raw', new Uint8Array(await S.exportKey('raw', other.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ko, sig, m), 'otra clave → falso');
    const zero = new Uint8Array(64), nOrder = unhex('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    const kk = await J.subtle.importKey('raw', new Uint8Array(await S.exportKey('raw', kp.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kk, zero, m), 'r = s = 0 → falso');
    const rn = new Uint8Array(64); rn.set(nOrder); rn.set(sig.subarray(32), 32);
    ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kk, rn, m), 'r = n → falso');
    ok(!await J.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kk, sig.subarray(0, 63), m), 'firma corta → falso');
    const off = Uint8Array.from(new Uint8Array(await S.exportKey('raw', kp.publicKey))); off[64] ^= 1;
    ok(await rejects(J.subtle.importKey('raw', off, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])), 'punto fuera de la curva → error al importar');
    ok(await rejects(J.subtle.importKey('raw', new Uint8Array(33), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])), 'comprimida: no');
  });

  test('Límites: lo que el móvil nunca debe hacer (crear o firmar con ECDSA) falla con un error claro', async () => {
    ok(await rejects(J.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])), 'generateKey');
    ok(await rejects(J.subtle.importKey('jwk', {}, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])), 'importar jwk');
    ok(await rejects(J.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, {}, new Uint8Array(1))), 'firmar ECDSA');
    ok(await rejects(J.subtle.digest('SHA-1', new Uint8Array(1))), 'solo SHA-256');
    ok(await rejects(J.subtle.importKey('raw', new Uint8Array(16), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])), 'solo HMAC-SHA256');
    ok(await rejects(J.subtle.importKey('raw', new Uint8Array(65), { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify'])), 'solo P-256');
  });

  let pass = 0; const fails = [];
  for (const [n, f] of tests) { try { await f(); pass++; } catch (e) { fails.push([n, e.message]); } }
  fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m));
  console.log('Cripto (reserva JS = WebCrypto): ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : ''));
  process.exitCode = fails.length ? 1 : 0;
})();
