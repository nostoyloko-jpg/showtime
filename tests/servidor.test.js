/* Tests de servidor.js (repetidor y servidor de la red local, dec. 115).  node tests/servidor.test.js */
(async function () {
  'use strict';
  const V = require('../servidor.js'), http = require('http'), net = require('net'), crypto = require('crypto');
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms, what) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 3000)) throw new Error('tiempo agotado: ' + (what || '')); await sleep(10); } }
  function get(port, path, method) {
    return new Promise((ok, ko) => { const r = http.request({ host: '127.0.0.1', port, path, method: method || 'GET' }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); }); r.on('error', ko); r.end(); });
  }
  /** Cliente WebSocket «a mano»: tramas enmascaradas y, si se pide, troceadas en fragmentos y en escrituras de pocos bytes. */
  function rawClient(port) {
    return new Promise((ok, ko) => {
      const s = net.connect(port, '127.0.0.1'), c = { s, got: [], buf: Buffer.alloc(0), mq: Buffer.alloc(0) };
      s.on('error', ko);
      s.on('connect', () => s.write('GET /mqtt HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n'));
      let up = false;
      s.on('data', d => {
        c.buf = Buffer.concat([c.buf, d]);
        if (!up) { const i = c.buf.indexOf('\r\n\r\n'); if (i < 0) return; c.head = c.buf.subarray(0, i).toString(); c.buf = c.buf.subarray(i + 4); up = true; ok(c); }
        while (c.buf.length >= 2) {
          let n = c.buf[1] & 127, h = 2; if (n === 126) { n = c.buf.readUInt16BE(2); h = 4; } if (c.buf.length < h + n) break;
          c.mq = Buffer.concat([c.mq, c.buf.subarray(h, h + n)]); c.buf = c.buf.subarray(h + n);
          const r = V.mqParse(c.mq); c.mq = Buffer.from(r.rest); r.packets.forEach(p => c.got.push(p));
        }
      });
    });
  }
  function frame(payload, op, fin) {
    const mask = crypto.randomBytes(4), n = payload.length, h = n < 126 ? Buffer.from([(fin === false ? 0 : 0x80) | op, 0x80 | n]) : Buffer.from([(fin === false ? 0 : 0x80) | op, 0x80 | 126, n >> 8, n & 255]);
    const d = Buffer.from(payload); for (let i = 0; i < n; i++) d[i] ^= mask[i & 3];
    return Buffer.concat([h, mask, d]);
  }
  const str = s => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
  const CONNECT = id => V.mqPacket(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 2, 0, 45]), str(id)]));
  const SUB = t => V.mqPacket(0x82, Buffer.concat([Buffer.from([0, 1]), str(t), Buffer.from([0])]));
  const PUB = (t, p) => V.mqPacket(0x30, Buffer.concat([str(t), Buffer.from(p)]));

  test('Archivos: solo la app; nada oculto, ni tests, ni fuera de la carpeta, ni el propio servidor', async () => {
    ok(V.safeFile('/live.html') && V.safeFile('/live.html').type.indexOf('text/html') === 0);
    ok(V.safeFile('/remote.html?b=1#sala=x'), 'con ? y #');
    ok(V.safeFile('/icons/icon-192.png'), 'subcarpetas de la app');
    eq(V.safeFile('/').full, require('path').join(V.ROOT, 'index.html'), '/ → index.html');
    ['/../secreto.txt', '/..%2F..%2Fetc%2Fpasswd', '/.git/config', '/.gitignore', '/tests/core.test.js', '/servidor.js', '/notas.txt', '/x.sh', '/%E0%A4%A', '/icons/../../x.js']
      .forEach(p => eq(V.safeFile(p), null, 'bloquea ' + p));
  });

  test('Temas MQTT con comodines', async () => {
    ok(V.topicMatch('showtime/v1/abc/s', 'showtime/v1/abc/s'));
    ok(!V.topicMatch('showtime/v1/abc/s', 'showtime/v1/abc/h'));
    ok(V.topicMatch('showtime/v1/+/s', 'showtime/v1/abc/s')); ok(V.topicMatch('showtime/#', 'showtime/v1/abc/s'));
    ok(!V.topicMatch('showtime/v1/abc', 'showtime/v1/abc/s'));
  });

  test('HTTP: sirve live.html y remote.html a los móviles; /showtime-local.json dice IP y puerto (con CORS para el Dashboard)', async () => {
    const S = V.createServer({ port: 0, host: '127.0.0.1' }), port = await S.listen();
    try {
      const a = await get(port, '/live.html'); eq(a.status, 200); ok(/<html/i.test(a.body)); eq(a.headers['x-content-type-options'], 'nosniff');
      eq((await get(port, '/remote.html')).status, 200);
      eq((await get(port, '/cripto.js')).status, 200, 'el cifrado de reserva se sirve');
      eq((await get(port, '/tests/emision.test.js')).status, 404); eq((await get(port, '/servidor.js')).status, 404); eq((await get(port, '/.git/HEAD')).status, 404);
      eq((await get(port, '/live.html', 'POST')).status, 405);
      const j = await get(port, '/showtime-local.json'); const o = JSON.parse(j.body);
      eq(o.app, 'showtime'); eq(o.port, port); ok(Array.isArray(o.ips)); eq(j.headers['access-control-allow-origin'], '*'); eq(j.headers['access-control-allow-private-network'], 'true');
      eq((await get(port, '/showtime-local.json', 'OPTIONS')).status, 204, 'pre-vuelo de Chrome (red local)');
    } finally { await S.close(); }
  });

  test('Repetidor: CONNECT/SUBSCRIBE/PUBLISH, reparto solo a quien escucha ese tema, PING; tramas troceadas y fragmentadas', async () => {
    const S = V.createServer({ port: 0, host: '127.0.0.1' }), port = await S.listen();
    try {
      const a = await rawClient(port), b = await rawClient(port), c = await rawClient(port);
      ok(/101 Switching Protocols/.test(a.head) && /Sec-WebSocket-Protocol: mqtt/.test(a.head), 'subprotocolo mqtt');
      [a, b, c].forEach((x, i) => x.s.write(frame(CONNECT('c' + i), 2)));
      await until(() => [a, b, c].every(x => x.got.some(p => p.type === 2)), 2000, 'CONNACK');
      a.s.write(frame(SUB('showtime/v1/sala/s'), 2)); b.s.write(frame(SUB('showtime/v1/sala/s'), 2)); c.s.write(frame(SUB('showtime/v1/otra/s'), 2));
      await until(() => [a, b, c].every(x => x.got.some(p => p.type === 9)), 2000, 'SUBACK');
      // Publicación troceada: un PUBLISH en dos fragmentos WebSocket, escritos byte a byte
      const pub = PUB('showtime/v1/sala/s', crypto.randomBytes(3000)), f = Buffer.concat([frame(pub.subarray(0, 1000), 2, false), frame(pub.subarray(1000), 0, true)]);
      for (let i = 0; i < f.length; i += 7) b.s.write(f.subarray(i, i + 7));
      await until(() => a.got.some(p => p.type === 3) && b.got.some(p => p.type === 3), 2000, 'reparto');
      eq(Buffer.compare(a.got.find(p => p.type === 3).body, pub.subarray(pub.length - (3000 + 2 + 'showtime/v1/sala/s'.length))), 0, 'mismos bytes');
      ok(!c.got.some(p => p.type === 3), 'otra sala no recibe');
      // Dos paquetes MQTT en una sola trama
      a.s.write(frame(Buffer.concat([PUB('showtime/v1/sala/s', 'x'), PUB('showtime/v1/sala/s', 'y')]), 2));
      await until(() => b.got.filter(p => p.type === 3).length === 3, 2000, 'dos en una trama');
      // Temas ajenos a Showtime: ni se suscriben ni se reparten
      c.s.write(frame(SUB('#'), 2)); await until(() => c.got.filter(p => p.type === 9).length === 2, 2000);
      eq(c.got.filter(p => p.type === 9)[1].body[2], 0x80, 'SUBACK con error para «#»');
      a.s.write(frame(PUB('otro/tema', 'z'), 2)); await sleep(80); ok(!c.got.some(p => p.type === 3));
      a.s.write(frame(Buffer.from([0xc0, 0]), 2)); await until(() => a.got.some(p => p.type === 13), 2000, 'PINGRESP');
      [a, b, c].forEach(x => x.s.destroy()); await until(() => S.broker.clients.size === 0, 2000, 'se van');
    } finally { await S.close(); }
  });

  test('Repetidor: se protege (sin CONNECT, sin máscara, paquete gigante → fuera)', async () => {
    const S = V.createServer({ port: 0, host: '127.0.0.1' }), port = await S.listen();
    try {
      const a = await rawClient(port); a.s.write(frame(PUB('showtime/v1/x/s', 'x'), 2)); await until(() => a.s.destroyed || S.broker.clients.size === 0, 2000, 'sin CONNECT');
      const b = await rawClient(port); b.s.write(Buffer.from([0x82, 2, 1, 2])); await until(() => S.broker.clients.size === 0, 2000, 'sin máscara');
      const c = await rawClient(port); c.s.write(frame(CONNECT('c'), 2));
      await until(() => c.got.length, 2000);
      c.s.write(frame(Buffer.from([0x30, 0xff, 0xff, 0xff, 0x7f]), 2)); await until(() => S.broker.clients.size === 0, 2000, 'paquete gigante');
      const bad = await get(port, '/mqtt'); eq(bad.status, 404, 'sin Upgrade no hay repetidor');
    } finally { await S.close(); }
  });

  test('Live y mando cargan el cifrado de reserva ANTES de emision.js; la PWA lo guarda; el Dashboard no lo necesita', async () => {
    const fs = require('fs'), path = require('path'), src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    ['live.html', 'remote.html'].forEach(f => { const h = src(f), a = h.indexOf('src="cripto.js?v='), b = h.indexOf('src="emision.js?v='); ok(a > 0 && a < b, f); });
    ok(/'cripto\.js', 'emision\.js'/.test(src('sw.js')), 'en la caché de la PWA');
    ok(/Em\.canView \? Em\.canView\(\)/.test(src('live.js')) && /Em\.canView \? Em\.canView\(\)/.test(src('remote.js')), 'Live y mando aceptan el cifrado de reserva');
    ok(/Em\.canEmit \? Em\.canEmit\(\)/.test(src('control.js')), 'el Dashboard exige WebCrypto (firma ECDSA)');
  });

  let pass = 0; const fails = [];
  for (const [n, f] of tests) { try { await f(); pass++; } catch (e) { fails.push([n, e.message]); } }
  fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m));
  console.log('Servidor local: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : ''));
  process.exitCode = fails.length ? 1 : 0;
})();
