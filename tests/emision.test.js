/* Tests de emision.js — sin dependencias y sin red (un repetidor MQTT de mentira dentro del propio test).
 * Ordenador:  node tests/emision.test.js
 * Navegador:  abrir tests/index.html con doble clic
 */
(function () {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('../emision.js') : window.ShowtimeEmision;
  const Q = isNode ? require('../qr.js') : window.ShowtimeQR;
  const _ = E._, MQ = _.MQ;

  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms, what) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 4000)) throw new Error('tiempo agotado: ' + (what || '')); await sleep(20); } }
  const enc = new TextEncoder();

  // ── Repetidor MQTT de mentira (en memoria) ────────────────────────────
  function FakeBroker(name) {
    this.name = name; this.clients = new Set(); this.down = false; this.log = [];
    const broker = this;
    this.WS = function (url, protocols) {
      const ws = this; ws.readyState = 0; ws.url = url; ws.subs = []; ws.buf = new Uint8Array(0);
      ws.send = bytes => broker.receive(ws, bytes);
      ws.close = () => { if (ws.readyState === 3) return; ws.readyState = 3; broker.clients.delete(ws); setTimeout(() => ws.onclose && ws.onclose({}), 0); };
      setTimeout(() => {
        if (broker.down) { ws.readyState = 3; ws.onerror && ws.onerror({}); ws.onclose && ws.onclose({}); return; }
        ws.readyState = 1; broker.clients.add(ws); ws.onopen && ws.onopen({});
      }, 0);
    };
  }
  FakeBroker.prototype.deliver = function (ws, bytes) { setTimeout(() => { if (ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: bytes.slice().buffer }); }, 0); };
  FakeBroker.prototype.receive = function (ws, bytes) {
    const r = MQ.parse(_.concat(ws.buf, bytes)); ws.buf = Uint8Array.from(r.rest);
    r.packets.forEach(p => {
      if (p.type === 1) this.deliver(ws, Uint8Array.from([0x20, 2, 0, 0]));
      else if (p.type === 8) { const s = MQ.readSubscribe(p); ws.subs.push(...s.topics); this.deliver(ws, Uint8Array.from([0x90, 3, s.id >> 8, s.id & 255, 0])); }
      else if (p.type === 3) {
        const m = MQ.readPublish(p); this.log.push(m.topic);
        const out = MQ.publish(m.topic, m.payload);
        this.clients.forEach(c => { if (c.subs.indexOf(m.topic) >= 0) this.deliver(c, out); });
      } else if (p.type === 12) this.deliver(ws, Uint8Array.from([0xD0, 0]));
    });
  };
  FakeBroker.prototype.kill = function () { this.down = true; Array.from(this.clients).forEach(c => c.close()); };
  /** Un WebSocket que reparte según la URL entre varios repetidores de mentira. */
  function multiWS(brokers) { return function (url, p) { const b = brokers.find(x => x.url === url); return new b.fake.WS(url, p); }; }

  // ── Básicos ───────────────────────────────────────────────────────────
  test('base64url ida y vuelta; rechaza caracteres raros', async () => {
    const b = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const s = _.b64u(b); ok(/^[A-Za-z0-9_-]+$/.test(s)); eq(Array.from(_.unb64u(s)).join(), Array.from(b).join());
    eq(_.unb64u('a+b/'), null);
  });

  test('MQTT: CONNECT exacto, longitudes variables y paquetes partidos', async () => {
    eq(Array.from(MQ.connect('ab', 45)).join(), [0x10, 14, 0, 4, 77, 81, 84, 84, 4, 2, 0, 45, 0, 2, 97, 98].join());
    eq(_.varLen(0).join(), '0'); eq(_.varLen(127).join(), '127'); eq(_.varLen(128).join(), '128,1');
    eq(_.varLen(16383).join(), '255,127'); eq(_.varLen(16384).join(), '128,128,1');
    const big = MQ.publish('a/b', new Uint8Array(20000));
    const half = MQ.parse(big.subarray(0, 9000)); eq(half.packets.length, 0); eq(half.rest.length, 9000);
    const both = MQ.parse(_.concat(big, MQ.ping())); eq(both.packets.length, 2); eq(both.packets[1].type, 12);
    const m = MQ.readPublish(both.packets[0]); eq(m.topic, 'a/b'); eq(m.payload.length, 20000);
    const s = MQ.readSubscribe(MQ.parse(MQ.subscribe(7, ['x/1', 'y/2'])).packets[0]); eq(s.id, 7); eq(s.topics.join(), 'x/1,y/2');
  });

  test('compresión: ida y vuelta, y ocupa menos', async () => {
    const obj = { artists: Array.from({ length: 200 }, (x, i) => ({ id: i, nombre: 'Banda ' + i, inicio: '21:00', notas: 'Ñ · ¡sí!' })) };
    const p = await _.pack(obj);
    ok(p.length < JSON.stringify(obj).length / 4, 'comprime (' + p.length + ')');
    eq(JSON.stringify(await _.unpack(p)), JSON.stringify(obj));
  });

  test('trozos: se rearman desordenados; los viejos y repetidos se ignoran', async () => {
    const data = new Uint8Array(60000).map((x, i) => i % 251);
    const ch = _.splitChunks(data, 1000, 24000); eq(ch.length, 3);
    const A = new _.Assembler();
    eq(A.add(ch[2]), null); eq(A.add(ch[0]), null);
    const r = A.add(ch[1]); ok(r && r.ts === 1000); eq(r.bytes.length, 60000); eq(r.bytes[59999], 59999 % 251);
    eq(A.add(ch[1]), null, 'repetido');
    eq(A.add(_.splitChunks(data, 999)[0]), null, 'más viejo');
    ok(A.add(_.splitChunks(new Uint8Array(5), 1001)[0]), 'uno más nuevo de un solo trozo');
  });

  // ── Cifrado y firma ───────────────────────────────────────────────────
  test('sala nueva: válida, enlace de Staff legible y QR pequeño', async () => {
    const room = await E.newRoom();
    ok(E.validRoom(room)); eq(room.sala.length, 16);
    const url = E.staffUrl(room, E.PUBLIC_BASE);
    ok(url.indexOf('https://nostoyloko-jpg.github.io/showtime/live.html?b=' + E.BUILD + '#sala=') === 0, 'con la versión para saltarse la caché: ' + url);
    const cu = E.staffUrl(room, E.PUBLIC_BASE, { vista: 'confidence', zona: 'esc1' });
    ok(cu.indexOf('live.html?vista=confidence&zona=esc1&b=' + E.BUILD + '#sala=' + room.sala) > 0, 'QR de Confidence con su zona: ' + cu);
    ok(E.staffUrl(room, E.PUBLIC_BASE, { vista: 'backstage' }).indexOf('live.html?vista=backstage&b=') > 0);
    ok(Q.encode(cu, { ecl: 'M' }).version <= 10, 'QR de Confidence versión ' + Q.encode(cu, { ecl: 'M' }).version);
    const p = E.parseHash(url.slice(url.indexOf('#')));
    eq(p.sala, room.sala); eq(p.k, room.k); eq(p.p, room.p);
    ok(Q.encode(url, { ecl: 'M' }).version <= 9, 'QR versión ' + Q.encode(url, { ecl: 'M' }).version);
    ok(url.indexOf(room.pub) < 0 && JSON.stringify(room.sk).length > 0 && url.indexOf(room.sk.d) < 0, 'la clave privada no va en el enlace');
  });

  test('enlace: rechaza datos incompletos o mal formados', async () => {
    eq(E.parseHash(''), null); eq(E.parseHash('#sala=abc&k=x&p=y'), null);
    eq(E.parseHash('#sala=AAAAAAAAAAAAAAAA&k=' + _.b64u(new Uint8Array(15)) + '&p=' + _.b64u(new Uint8Array(16))), null);
    ok(E.parseHash('#sala=AAAAAAAAAAAAAAAA&k=' + _.b64u(new Uint8Array(16)) + '&p=' + _.b64u(new Uint8Array(16))));
  });

  test('base pública: doble clic y localhost → GitHub Pages; https → su carpeta', async () => {
    eq(E.publicBase({ protocol: 'file:', hostname: '', origin: 'null', pathname: '/Users/x/SHOWTIME/index.html' }), E.PUBLIC_BASE);
    eq(E.publicBase({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8000', pathname: '/index.html' }), E.PUBLIC_BASE);
    eq(E.publicBase({ protocol: 'https:', hostname: 'ejemplo.org', origin: 'https://ejemplo.org', pathname: '/st/index.html' }), 'https://ejemplo.org/st/');
  });

  test('mensaje del Mac: se abre; alterado, de otra sala o firmado por otro → se descarta', async () => {
    const room = await E.newRoom(), K = await _.macKeys(room), V = await _.viewerKeys(room);
    const f = await _.seal(K, E.K_STATE, enc.encode('hola'));
    const m = await _.openFrame(V, f); ok(m); eq(new TextDecoder().decode(m.plain), 'hola');
    const bad = f.slice(); bad[bad.length - 1] ^= 1; eq(await _.openFrame(V, bad), null, 'alterado');
    const V2 = await _.viewerKeys(Object.assign({}, room, { sala: 'BBBBBBBBBBBBBBBB' })); eq(await _.openFrame(V2, f), null, 'otra sala');
    // Alguien con el QR de Staff (clave de lectura) intenta hacerse pasar por el Mac con su propia firma
    const fake = await E.newRoom(), Kf = await _.macKeys(Object.assign({}, fake, { sala: room.sala, k: room.k }));
    eq(await _.openFrame(V, await _.seal(Kf, E.K_STATE, enc.encode('falso'))), null, 'firma de otro');
    eq(await _.openFrame(V, new Uint8Array(10)), null, 'basura');
  });

  test('«hola» del móvil: el Mac lo abre; basura o clave equivocada → nada', async () => {
    const room = await E.newRoom(), K = await _.macKeys(room), V = await _.viewerKeys(room);
    const h = await _.openHello(K, await _.sealHello(V, { id: 'abc', want: true }));
    eq(h.id, 'abc'); eq(h.want, true);
    eq(await _.openHello(K, new Uint8Array(40)), null);
    const other = await E.newRoom(), Vo = await _.viewerKeys(Object.assign({}, other, { sala: room.sala }));
    eq(await _.openHello(K, await _.sealHello(Vo, { id: 'x' })), null);
  });

  // ── De punta a punta, con dos repetidores de mentira ──────────────────
  function rig(n) {
    const brokers = [{ id: 'a', name: 'A', url: 'wss://a.test/mqtt' }, { id: 'b', name: 'B', url: 'wss://b.test/mqtt' }];
    brokers.forEach(b => { b.fake = new FakeBroker(b.id); });
    return { brokers, WS: multiWS(brokers) };
  }
  function viewer(room, R, got) {
    const st = { snaps: [], status: null };
    const rx = new E.Receptor({ params: { sala: room.sala, k: room.k, p: room.p }, brokers: R.brokers, WebSocket: R.WS,
      onSnapshot: s => st.snaps.push(s), onStatus: s => { st.status = s; } });
    st.rx = rx; return st;
  }

  test('emisión: los móviles reciben el estado, los cambios y se cuentan', async () => {
    const R = rig(), room = await E.newRoom();
    let snap = { festival: { event: { nombre: 'Prueba' }, artists: [] }, config: { mode: 'show' }, callDone: [], flash: null };
    let est = null;
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => snap, onStatus: s => { est = s; } });
    await tx.start();
    const v1 = viewer(room, R), v2 = viewer(room, R);
    await v1.rx.start(); await v2.rx.start();
    await until(() => v1.snaps.length && v2.snaps.length, 4000, 'primer estado');
    eq(v1.snaps[v1.snaps.length - 1].festival.event.nombre, 'Prueba');
    await until(() => est && est.viewers === 2, 3000, 'dos móviles');
    eq(est.links.filter(l => l.state === 'on').length, 2);
    snap = Object.assign({}, snap, { flash: { id: 'x', text: '5 MINUTOS', at: Date.now() } });
    tx.push(0);
    await until(() => v1.snaps.some(s => s.flash && s.flash.text === '5 MINUTOS'), 3000, 'cambio');
    eq(v1.status.state, 'live');
    // Lo que circula por el repetidor no se puede leer
    ok(R.brokers[0].fake.log.every(t => t.indexOf('showtime/v1/' + room.sala + '/') === 0));
    await tx.stop();
    await until(() => v1.status.state === 'end', 3000, 'emisión detenida');
    v1.rx.stop(); v2.rx.stop();
  });

  test('emisión: si un repetidor se cae, llega por el otro (sin duplicar)', async () => {
    const R = rig(), room = await E.newRoom();
    let n = 0, snap = () => ({ n });
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => snap() });
    await tx.start();
    const v = viewer(room, R); await v.rx.start();
    await until(() => v.snaps.length >= 1, 4000, 'primer estado');
    const before = v.snaps.length;
    R.brokers[0].fake.kill();
    n = 7; tx.push(0);
    await until(() => v.snaps.some(s => s.n === 7), 3000, 'por el otro repetidor');
    await sleep(200);
    eq(v.snaps.filter(s => s.n === 7).length, 1, 'una sola vez');
    ok(v.snaps.length === before + 1);
    await tx.stop(); v.rx.stop();
  });

  test('emisión: estado grande (varios trozos) llega entero', async () => {
    const R = rig(), room = await E.newRoom();
    let seed = 1; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff).toString(36);
    const big = { artists: Array.from({ length: 4000 }, (x, i) => ({ id: i, nombre: rnd() + rnd(), notas: rnd() + rnd() + rnd() })) };
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => big });
    const v = viewer(room, R);
    await tx.start(); await v.rx.start();
    await until(() => v.snaps.length >= 1, 6000, 'estado grande');
    eq(v.snaps[0].artists.length, 4000); eq(v.snaps[0].artists[3999].notas, big.artists[3999].notas);
    await tx.stop(); v.rx.stop();
  });

  test('emisión: un intruso con el QR de Staff no puede colar un estado falso', async () => {
    const R = rig(), room = await E.newRoom();
    const tx = new E.Emisor({ room, brokers: R.brokers, WebSocket: R.WS, getSnapshot: () => ({ real: true }) });
    const v = viewer(room, R);
    await tx.start(); await v.rx.start();
    await until(() => v.snaps.length >= 1, 4000, 'estado real');
    const fake = await E.newRoom(), Kf = await _.macKeys(Object.assign({}, fake, { sala: room.sala, k: room.k }));
    const chunk = _.splitChunks(await _.pack({ real: false }), Date.now() + 99999)[0];
    const frame = await _.seal(Kf, E.K_STATE, chunk);
    const intruder = new R.brokers[1].fake.WS(R.brokers[1].url);
    await sleep(20);
    intruder.send(MQ.connect('intruso', 30)); intruder.send(MQ.publish(_.topic(room.sala, 's'), frame));
    await sleep(300);
    ok(v.snaps.every(s => s.real === true), 'solo estados del Mac');
    await tx.stop(); v.rx.stop();
  });

  // ── Producción: enlace y mensajes ─────────────────────────────────────
  test('Producción: el enlace es la Live de Manager con «id», y parseHash lo lee', async () => {
    const room = await E.newRoom();
    const url = E.productionUrl(room, E.PUBLIC_BASE, 'prod_001');
    ok(url.indexOf('live.html?vista=manager&b=' + E.BUILD + '#sala=' + room.sala) > 0, 'abre la Live de Manager: ' + url);
    ok(url.indexOf('produccion.html') < 0, 'ya no abre la página aparte');
    const p = E.parseHash(url.slice(url.indexOf('#')));
    eq(p.id, 'prod_001'); eq(p.sala, room.sala);
    ok(Q.encode(url, { ecl: 'M' }).version <= 10, 'QR versión ' + Q.encode(url, { ecl: 'M' }).version);
    eq(E.parseHash(url.slice(url.indexOf('#')).replace('id=prod_001', 'id=a%20b')), null, 'id con caracteres raros → enlace no válido');
    eq(E.parseHash(E.staffUrl(room, E.PUBLIC_BASE).replace(/^[^#]*/, '')).id, undefined, 'el enlace de Staff no lleva id');
  });

  test('Producción: cleanProdMsg valida lo que llega (entrada no fiable)', async () => {
    const C = E.cleanProdMsg;
    eq(JSON.stringify(C({ type: 'call', from: 'prod_001', key: 'Banda X@1230' })), JSON.stringify({ type: 'call', from: 'prod_001', key: 'Banda X@1230' }));
    eq(C({ type: 'call', from: 'prod_001', key: 'sinarroba' }), null, 'clave sin @');
    eq(C({ type: 'call', from: 'prod_001', key: 'x'.repeat(300) + '@1' }), null, 'clave enorme');
    eq(C({ type: 'call', key: 'A@1' }), null, 'sin quién lo manda');
    eq(C({ type: 'call', from: '<img onerror=1>', key: 'A@1' }), null, 'from con HTML');
    eq(C(null), null); eq(C('hola'), null); eq(C({ type: 'raro', from: 'p1' }), null);
    const f = C({ type: 'flash', from: 'p1', text: '  Hola  ', to: ['backstage', 'raro'] });
    eq(f.text, 'Hola'); eq(f.to.join(), 'backstage');
    eq(C({ type: 'flash', from: 'p1', text: 'x'.repeat(400) }).text.length, 140, 'máximo 140 como los mensajes del Dashboard');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola', to: ['manager', 'confidence', 'backstage'] }).to.join(), 'manager,backstage', 'NUNCA a Confidence, aunque lo pidan');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola', to: ['confidence', 'backstage'] }).to.join(), 'backstage', 'se quita Confidence y queda el resto');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola', to: ['confidence'] }), null, 'pedir solo Confidence: no se manda a ningún sitio');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola', to: ['raro'] }), null, 'destino desconocido: no se manda');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola', to: [] }).to.join(), 'manager,backstage', 'sin destino = Manager y Backstage');
    eq(C({ type: 'flash', from: 'p1', text: 'Hola' }).to.join(), 'manager,backstage', 'sin «to» = Manager y Backstage');
    eq(C({ type: 'flash', from: 'p1', text: '   ' }), null, 'mensaje vacío');
    eq(C({ type: 'chat', from: 'p1', text: 'ey' }).type, 'chat');
    eq(C({ from: 'p1', text: 'antiguo sin type' }).type, 'chat', 'formato antiguo del chat');
  });

  // ── Ejecutor asíncrono ────────────────────────────────────────────────
  (async () => {
    let pass = 0; const fails = [];
    for (const [n, f] of tests) { try { await f(); pass++; } catch (e) { fails.push([n, e.message]); } }
    const summary = 'Emisión: ' + pass + '/' + tests.length + ' tests OK' + (fails.length ? ' — ' + fails.length + ' FALLAN' : '');
    if (isNode) { fails.forEach(([n, m]) => console.log('✗ ' + n + '\n    ' + m)); console.log(summary); process.exitCode = fails.length ? 1 : 0; setTimeout(() => process.exit(), 50); }
    else {
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const box = document.createElement('div');
      box.innerHTML = '<h1 class="' + (fails.length ? 'bad' : 'good') + '">' + summary + '</h1>' + fails.map(([n, m]) => '<p class="bad"><b>✗ ' + esc(n) + '</b><br>' + esc(m) + '</p>').join('');
      document.getElementById('out').appendChild(box);
      window.__TEST_EMISION__ = { pass, total: tests.length, fails };
    }
  })();
})();
