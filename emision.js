/* Showtime — emision.js  (Entrega 2d-A)
 * Emisión en directo a los móviles del equipo a través de dos repetidores públicos y gratuitos (MQTT por WebSocket).
 *
 *  - El Mac (Panel) es el único que publica el estado. Los móviles solo leen.
 *  - Cifrado de punta a punta: AES-GCM con una clave que viaja en el QR, en la parte «#…» de la URL
 *    (esa parte no llega a ningún servidor). El repetidor solo ve datos ilegibles.
 *  - Firma ECDSA P-256 del Mac: los móviles comprueban que cada mensaje lo ha firmado el Mac de esta sala
 *    (la huella de su clave pública va en el QR). Quien tenga el QR de Staff puede leer, pero no fabricar estados.
 *  - Nada queda guardado fuera: los repetidores solo reenvían (sin mensajes retenidos). Quien entra pide el estado
 *    y el Mac se lo vuelve a mandar.
 *
 *  Mando del regidor (2d-B): las órdenes del móvil del regidor van cifradas y FIRMADAS con una clave propia del mando
 *    (HMAC-SHA256, solo en su QR privado). El Mac solo obedece órdenes con esa firma, recientes y no repetidas,
 *    y contesta a cada una (hecho / motivo del rechazo).
 *
 *  Temas:  showtime/v1/<sala>/s  (Mac → móviles: estado, latido, fin, respuestas a órdenes)
 *          showtime/v1/<sala>/h  (móviles → Mac: «hola», presencia)
 *          showtime/v1/<sala>/c  (mando → Mac: órdenes)
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const cryptoObj = root.crypto && root.crypto.subtle ? root.crypto : (isNode ? require('crypto').webcrypto : null);
  const subtle = cryptoObj && cryptoObj.subtle;

  const PROTO = 'showtime/v1';
  const BROKERS = [
    { id: 'emqx', name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
    { id: 'hivemq', name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' }
  ];
  const PUBLIC_BASE = 'https://nostoyloko-jpg.github.io/showtime/';
  // Versión publicada: va en los enlaces de los QR para que el móvil no abra una copia vieja guardada en su caché
  // (súbela junto con los ?v= de index.html / live.html / remote.html).
  const BUILD = '20261020';
  const CHUNK = 24000;           // bytes por trozo (los repetidores públicos limitan el tamaño de mensaje)
  const BEAT_MS = 10000;         // latido del Mac
  const PRESENCE_MS = 30000;     // presencia de cada móvil
  const VIEWER_TTL = 75000;      // un móvil cuenta como conectado si se ha presentado en este tiempo
  const STALE_MS = 25000;        // sin noticias del Mac en este tiempo → «sin conexión con la sala»
  const RETRY = [1000, 2000, 5000, 10000, 15000];
  const K_STATE = 1, K_BEAT = 2, K_END = 3, K_ACK = 4, K_HELLO = 16, K_CMD = 32;
  const CMD_WINDOW = 120000;     // una orden con más de 2 min de diferencia con el reloj del Mac se rechaza
  const CMD_TIMEOUT = 8000;      // el mando espera la respuesta del Mac este tiempo
  const VER = 1;

  // ── Utilidades ───────────────────────────────────────────────────────
  const enc = new TextEncoder(), dec = new TextDecoder();
  function rand(n) { const a = new Uint8Array(n); cryptoObj.getRandomValues(a); return a; }
  function concat() {
    const parts = Array.from(arguments).map(p => p instanceof Uint8Array ? p : Uint8Array.from(p));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }
  function b64u(bytes) {
    let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); });
    return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
    const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  function sameBytes(a, b) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  function topic(sala, kind) { return PROTO + '/' + sala + '/' + kind; }
  function putUint(n, bytes) { const a = new Uint8Array(bytes); for (let i = bytes - 1; i >= 0; i--) { a[i] = n % 256; n = Math.floor(n / 256); } return a; }
  function getUint(a, o, bytes) { let n = 0; for (let i = 0; i < bytes; i++) n = n * 256 + a[o + i]; return n; }

  // ── MQTT 3.1.1, lo mínimo (QoS 0, sesión limpia) ─────────────────────
  function mqStr(s) { const b = enc.encode(s); return concat([b.length >> 8, b.length & 255], b); }
  function varLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
  function packet(first, body) { return concat([first], varLen(body.length), body); }
  const MQ = {
    connect(clientId, keepAlive) { return packet(0x10, concat(mqStr('MQTT'), [4, 0x02, keepAlive >> 8, keepAlive & 255], mqStr(clientId))); },
    subscribe(id, topics) { return packet(0x82, concat([id >> 8, id & 255], ...topics.map(t => concat(mqStr(t), [0])))); },
    publish(t, payload) { return packet(0x30, concat(mqStr(t), payload)); },
    ping() { return Uint8Array.from([0xC0, 0]); },
    disconnect() { return Uint8Array.from([0xE0, 0]); },
    /** Trocea un búfer en paquetes completos; lo que sobra se queda para el siguiente trozo. */
    parse(buf) {
      const packets = []; let o = 0;
      while (o + 2 <= buf.length) {
        let len = 0, mul = 1, i = o + 1, ok = false;
        for (let k = 0; k < 4 && i < buf.length; k++, i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { ok = true; i++; break; } }
        if (!ok || i + len > buf.length) break;
        packets.push({ type: buf[o] >> 4, flags: buf[o] & 15, body: buf.subarray(i, i + len) });
        o = i + len;
      }
      return { packets, rest: buf.subarray(o) };
    },
    readPublish(p) {
      const tl = (p.body[0] << 8) | p.body[1], t = dec.decode(p.body.subarray(2, 2 + tl));
      const qos = (p.flags >> 1) & 3;
      return { topic: t, payload: p.body.subarray(2 + tl + (qos ? 2 : 0)) };
    },
    readSubscribe(p) {
      const topics = []; let o = 2;
      while (o < p.body.length) { const l = (p.body[o] << 8) | p.body[o + 1]; topics.push(dec.decode(p.body.subarray(o + 2, o + 2 + l))); o += 3 + l; }
      return { id: (p.body[0] << 8) | p.body[1], topics };
    }
  };

  // ── Compresión ───────────────────────────────────────────────────────
  async function streamThrough(bytes, ts) {
    const s = new Blob([bytes]).stream().pipeThrough(ts);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function pack(obj) {
    const raw = enc.encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') { try { return concat([1], await streamThrough(raw, new CompressionStream('deflate-raw'))); } catch (e) {} }
    return concat([0], raw);
  }
  async function unpack(bytes) {
    let raw = bytes.subarray(1);
    if (bytes[0] === 1) raw = await streamThrough(raw, new DecompressionStream('deflate-raw'));
    return JSON.parse(dec.decode(raw));
  }

  // ── Trozos ───────────────────────────────────────────────────────────
  /** Cabecera de 10 bytes: marca de tiempo (6) · índice (2) · total (2). */
  function splitChunks(bytes, ts, size) {
    const sz = size || CHUNK, n = Math.max(1, Math.ceil(bytes.length / sz)), out = [];
    for (let i = 0; i < n; i++) out.push(concat(putUint(ts, 6), putUint(i, 2), putUint(n, 2), bytes.subarray(i * sz, (i + 1) * sz)));
    return out;
  }
  function Assembler() { this.ts = -1; this.parts = null; this.done = -1; }
  /** Devuelve { ts, bytes } cuando un estado está completo; ignora los anteriores al último aplicado. */
  Assembler.prototype.add = function (c) {
    if (c.length < 10) return null;
    const ts = getUint(c, 0, 6), i = getUint(c, 6, 2), n = getUint(c, 8, 2);
    if (!n || i >= n || ts <= this.done || ts < this.ts) return null;
    if (ts !== this.ts) { this.ts = ts; this.parts = new Array(n); }
    if (this.parts.length !== n) return null;
    this.parts[i] = c.subarray(10);
    for (let k = 0; k < n; k++) if (!this.parts[k]) return null;
    const bytes = concat(...this.parts); this.done = ts; this.parts = null;
    return { ts, bytes };
  };

  // ── Claves y sala ────────────────────────────────────────────────────
  const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN = { name: 'ECDSA', hash: 'SHA-256' };
  async function fingerprint(pubRaw) { return new Uint8Array(await subtle.digest('SHA-256', pubRaw)).slice(0, 16); }
  /** Sala nueva: id (12 bytes), clave de lectura AES-128, par de claves de firma del Mac. Todo se queda en el Mac. */
  async function newRoom() {
    const kp = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    return { v: 1, sala: b64u(rand(12)), k: b64u(rand(16)), c: b64u(rand(16)), pub: b64u(pub), p: b64u(await fingerprint(pub)), sk: await subtle.exportKey('jwk', kp.privateKey), at: Date.now() };
  }
  /** Salas de la 2d-A (sin clave de mando): se les añade una; el QR de Staff no cambia. */
  function withCmdKey(room) { return room && !room.c ? Object.assign({}, room, { c: b64u(rand(16)) }) : room; }
  /** Clave de mando nueva (el QR del regidor anterior deja de valer; el de Staff sigue). */
  function newCmdKey(room) { return Object.assign({}, room, { c: b64u(rand(16)) }); }
  function validRoom(r) { return !!(r && typeof r.sala === 'string' && r.sala.length === 16 && unb64u(r.k) && unb64u(r.k).length === 16 && unb64u(r.pub) && r.sk && r.p); }
  async function aesKey(k) { return subtle.importKey('raw', unb64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']); }
  async function hmacKey(c) { return subtle.importKey('raw', unb64u(c), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
  async function macKeys(room) {
    return { sala: room.sala, aes: await aesKey(room.k), pub: unb64u(room.pub), sk: await subtle.importKey('jwk', room.sk, ECDSA, false, ['sign']),
      cmd: room.c && unb64u(room.c) && unb64u(room.c).length === 16 ? await hmacKey(room.c) : null };
  }
  function aad(sala, kind) { return enc.encode(sala + '|' + kind); }

  /** Mac: mensaje cifrado y firmado. Marco: ver · tipo · clave pública (65) · firma (64) · iv (12) · cifrado. */
  async function seal(K, kind, plain) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(K.sala, kind) }, K.aes, plain));
    const sig = new Uint8Array(await subtle.sign(SIGN, K.sk, concat([VER, kind], iv, ct, enc.encode(K.sala))));
    return concat([VER, kind], K.pub, sig, iv, ct);
  }
  /** Móvil: claves de la sala a partir de lo que trae el QR. */
  async function viewerKeys(params) { return { sala: params.sala, aes: await aesKey(params.k), p: unb64u(params.p), verify: null, pubRaw: null, cmd: params.c ? await hmacKey(params.c) : null }; }
  /** Móvil: abre un mensaje del Mac. null si no es de esta sala, está alterado o no lo firma el Mac del QR. */
  async function openFrame(V, f) {
    try {
      if (!f || f.length < 2 + 65 + 64 + 12 + 16 || f[0] !== VER) return null;
      const kind = f[1], pub = f.subarray(2, 67), sig = f.subarray(67, 131), iv = f.subarray(131, 143), ct = f.subarray(143);
      if (!V.verify || !sameBytes(V.pubRaw, pub)) {
        if (!sameBytes(await fingerprint(pub), V.p)) return null;
        V.verify = await subtle.importKey('raw', pub, ECDSA, false, ['verify']); V.pubRaw = Uint8Array.from(pub);
      }
      if (!await subtle.verify(SIGN, V.verify, sig, concat([VER, kind], iv, ct, enc.encode(V.sala)))) return null;
      const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(V.sala, kind) }, V.aes, ct));
      return { kind, plain, iv: b64u(iv) };
    } catch (e) { return null; }
  }
  /** Móvil → Mac: «hola» cifrado con la clave de lectura (no firmado: solo sirve para pedir el estado y contar móviles). */
  async function sealHello(V, obj) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(V.sala, K_HELLO) }, V.aes, enc.encode(JSON.stringify(obj))));
    return concat([VER, K_HELLO], iv, ct);
  }
  async function openHello(K, f) {
    try {
      if (!f || f.length < 2 + 12 + 16 || f[0] !== VER || f[1] !== K_HELLO) return null;
      const iv = f.subarray(2, 14), ct = f.subarray(14);
      const o = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(K.sala, K_HELLO) }, K.aes, ct)));
      return o && typeof o.id === 'string' && o.id.length <= 32 ? o : null;
    } catch (e) { return null; }
  }

  /** Mando → Mac: orden cifrada (clave de lectura) y firmada con la clave del mando. Marco: ver · tipo · iv (12) · firma (32) · cifrado. */
  async function sealCmd(V, cmd) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(V.sala, K_CMD) }, V.aes, enc.encode(JSON.stringify(cmd))));
    const mac = new Uint8Array(await subtle.sign('HMAC', V.cmd, concat([VER, K_CMD], iv, ct, enc.encode(V.sala))));
    return concat([VER, K_CMD], iv, mac, ct);
  }
  /** Mac: abre una orden. null si no la firma el mando de esta sala o está alterada. */
  async function openCmd(K, f) {
    try {
      if (!K.cmd || !f || f.length < 2 + 12 + 32 + 16 || f[0] !== VER || f[1] !== K_CMD) return null;
      const iv = f.subarray(2, 14), mac = f.subarray(14, 46), ct = f.subarray(46);
      if (!await subtle.verify('HMAC', K.cmd, mac, concat([VER, K_CMD], iv, ct, enc.encode(K.sala)))) return null;
      const o = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(K.sala, K_CMD) }, K.aes, ct)));
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }
  /** Contra repeticiones: cada orden lleva id y hora; se rechaza si es vieja (o del futuro) y se ignora si ya llegó (por el otro repetidor). */
  function CmdGuard() { this.seen = new Map(); }
  CmdGuard.prototype.check = function (cmd, now) {
    const t = now === undefined ? Date.now() : now;
    this.seen.forEach((at, id) => { if (t - at > 10 * 60000) this.seen.delete(id); });
    if (!cmd || typeof cmd.id !== 'string' || cmd.id.length < 6 || cmd.id.length > 40 || !Number.isFinite(cmd.t)) return 'bad';
    if (this.seen.has(cmd.id)) return 'dup';
    this.seen.set(cmd.id, t);
    if (Math.abs(t - cmd.t) > CMD_WINDOW) return 'old';
    return 'ok';
  };

  // ── Enlaces del QR ───────────────────────────────────────────────────
  /** Base pública de la app: la carpeta de esta página si se sirve por http(s); si se abrió con doble clic, GitHub Pages. */
  function publicBase(loc) {
    const l = loc || (typeof location !== 'undefined' ? location : null);
    if (l && /^https?:$/.test(l.protocol) && !/^(localhost|127\.|\[::1\])/.test(l.hostname)) return l.origin + l.pathname.replace(/[^/]*$/, '');
    return PUBLIC_BASE;
  }
  /** opts (2e-A): { vista: 'manager'|'confidence'|'backstage', zona } → QR de Staff de esa pantalla (Manager = la de siempre). */
  function staffUrl(room, base, opts) {
    const o = opts || {}, v = o.vista === 'confidence' || o.vista === 'backstage' ? o.vista : null;
    const q = '?' + (v ? 'vista=' + v + (v === 'confidence' && o.zona !== null && o.zona !== undefined ? '&zona=' + encodeURIComponent(o.zona) : '') + '&' : '') + 'b=' + BUILD;
    return (base || publicBase()) + 'live.html' + q + '#sala=' + room.sala + '&k=' + room.k + '&p=' + room.p;
  }
  /** QR PRIVADO del regidor: lo mismo que el de Staff + la clave del mando. */
  function remoteUrl(room, base) { return (base || publicBase()) + 'remote.html?b=' + BUILD + '#sala=' + room.sala + '&k=' + room.k + '&p=' + room.p + '&c=' + room.c; }
  /** Lee «#sala=…&k=…&p=…». null si falta algo o no tiene el formato esperado. */
  function parseHash(hash) {
    const h = String(hash || '').replace(/^#/, ''), o = {};
    h.split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (!o.sala || !/^[A-Za-z0-9_-]{16}$/.test(o.sala)) return null;
    const k = unb64u(o.k), p = unb64u(o.p);
    if (!k || k.length !== 16 || !p || p.length !== 16) return null;
    const r = { sala: o.sala, k: o.k, p: o.p };
    if (o.c !== undefined) { const c = unb64u(o.c); if (!c || c.length !== 16) return null; r.c = o.c; }
    return r;
  }

  // ── Conexión con un repetidor ────────────────────────────────────────
  function Link(broker, opts) {
    this.b = broker; this.o = opts; this.ws = null; this.state = 'off'; this.stopped = true;
    this.buf = new Uint8Array(0); this.tries = 0; this.timer = null; this.pinger = null; this.err = '';
  }
  Link.prototype.start = function () { this.stopped = false; this.open(); };
  Link.prototype.open = function () {
    const WS = this.o.WebSocket || root.WebSocket;
    this.set('connecting');
    let ws;
    try { ws = new WS(this.b.url, ['mqtt']); } catch (e) { this.err = String(e && e.message || e); this.retry(); return; }
    this.ws = ws; ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.send(MQ.connect('st' + b64u(rand(9)), 45)); };
    ws.onmessage = ev => {
      const d = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data.buffer || ev.data);
      const r = MQ.parse(concat(this.buf, d)); this.buf = Uint8Array.from(r.rest);
      r.packets.forEach(p => {
        if (p.type === 2) {                                   // CONNACK
          if (p.body[1] !== 0) { this.err = 'rechazado (' + p.body[1] + ')'; try { ws.close(); } catch (e) {} return; }
          this.send(MQ.subscribe(1, this.o.topics));
          this.tries = 0; this.err = ''; this.set('on');
          clearInterval(this.pinger); this.pinger = setInterval(() => this.send(MQ.ping()), 30000);
        } else if (p.type === 3) { const m = MQ.readPublish(p); this.o.onMessage(m.topic, Uint8Array.from(m.payload), this); }
      });
    };
    ws.onerror = () => { this.err = this.err || 'no conecta'; };
    ws.onclose = () => { clearInterval(this.pinger); if (this.ws === ws) { this.ws = null; this.buf = new Uint8Array(0); } if (!this.stopped) this.retry(); else this.set('off'); };
  };
  Link.prototype.retry = function () {
    this.set('retry');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.stopped) this.open(); }, RETRY[Math.min(this.tries++, RETRY.length - 1)]);
  };
  Link.prototype.set = function (s) { if (this.state !== s) { this.state = s; if (this.o.onState) this.o.onState(this); } };
  Link.prototype.send = function (bytes) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(bytes); return true; } catch (e) {} } return false; };
  Link.prototype.publish = function (t, payload) { return this.state === 'on' && this.send(MQ.publish(t, payload)); };
  Link.prototype.stop = function () {
    this.stopped = true; clearTimeout(this.timer); clearInterval(this.pinger);
    if (this.ws) { this.send(MQ.disconnect()); try { this.ws.close(); } catch (e) {} }
    this.ws = null; this.set('off');
  };

  function linkStatus(links) { return links.map(l => ({ id: l.b.id, name: l.b.name, state: l.state, err: l.err })); }

  // ── Emisor (Mac) ─────────────────────────────────────────────────────
  /**
   * opts: { room, getSnapshot(): obj, onStatus(st), brokers?, WebSocket? }
   * st: { on, links:[{id,name,state}], viewers, lastTs }
   */
  function Emisor(opts) {
    this.o = opts; this.K = null; this.links = []; this.viewers = new Map(); this.remotes = new Map(); this.on = false; this.guard = new CmdGuard();
    this.lastTs = 0; this.pushT = null; this.lastPush = 0; this.beatT = null; this.busy = Promise.resolve();
  }
  Emisor.prototype.start = async function () {
    this.K = await macKeys(this.o.room);
    this.on = true;
    const brokers = this.o.brokers || BROKERS;
    this.links = brokers.map(b => new Link(b, {
      WebSocket: this.o.WebSocket, topics: [topic(this.K.sala, 'h'), topic(this.K.sala, 'c')],
      onMessage: (t, payload) => { if (t === topic(this.K.sala, 'c')) this.onCmd(payload); else this.onHello(payload); },
      onState: l => { if (l.state === 'on') this.push(0); this.status(); }
    }));
    this.links.forEach(l => l.start());
    this.beatT = setInterval(() => this.beat(), BEAT_MS);
    this.status();
  };
  Emisor.prototype.status = function () {
    const now = Date.now();
    this.viewers.forEach((t, id) => { if (now - t > VIEWER_TTL) this.viewers.delete(id); });
    this.remotes.forEach((t, id) => { if (now - t > VIEWER_TTL) this.remotes.delete(id); });
    if (this.o.onStatus) this.o.onStatus({ on: this.on, links: linkStatus(this.links), viewers: this.viewers.size, remotes: this.remotes.size, lastTs: this.lastTs });
  };
  /** Programa el envío del estado (agrupa cambios seguidos). */
  Emisor.prototype.push = function (delay) {
    if (!this.on) return;
    clearTimeout(this.pushT);
    this.pushT = setTimeout(() => { this.busy = this.busy.then(() => this.sendState()).catch(e => console.error(e)); }, delay === undefined ? 400 : delay);
  };
  Emisor.prototype.sendState = async function () {
    if (!this.on) return;
    const ts = Math.max(Date.now(), this.lastTs + 1);
    const chunks = splitChunks(await pack(this.o.getSnapshot()), ts);
    const frames = [];
    for (const c of chunks) frames.push(await seal(this.K, K_STATE, c));
    const t = topic(this.K.sala, 's');
    frames.forEach(f => this.links.forEach(l => l.publish(t, f)));
    this.lastTs = ts; this.lastPush = Date.now();
    this.status();
  };
  Emisor.prototype.beat = async function () {
    if (!this.on) return;
    const f = await seal(this.K, K_BEAT, enc.encode(JSON.stringify({ t: Date.now(), ts: this.lastTs })));
    this.links.forEach(l => l.publish(topic(this.K.sala, 's'), f));
    this.status();
  };
  Emisor.prototype.onHello = async function (payload) {
    const h = await openHello(this.K, payload);
    if (!h) return;
    const map = h.r ? this.remotes : this.viewers;
    const isNew = !map.has(h.id);
    map.set(h.id, Date.now());
    if (h.want) this.push(Math.max(0, 1500 - (Date.now() - this.lastPush)));   // como mucho un reenvío cada 1,5 s
    if (isNew || h.want) this.status();
  };
  /** Clave de mando nueva sin cortar la emisión (el QR de Staff sigue valiendo). */
  Emisor.prototype.setCmdKey = async function (c) { this.o.room = Object.assign({}, this.o.room, { c }); if (this.K) this.K.cmd = await hmacKey(c); this.remotes.clear(); this.status(); };
  /** Orden del mando: se comprueba (firma, hora, repetida), se ejecuta en el Mac (opts.onCommand) y se contesta. */
  Emisor.prototype.onCmd = async function (payload) {
    const cmd = await openCmd(this.K, payload);
    if (!cmd) return;                                         // sin la firma del mando: ni se contesta
    const g = this.guard.check(cmd);
    if (g === 'dup' || g === 'bad') return;
    let res;
    if (g === 'old') res = { ok: false, msg: 'Orden caducada (revisa la hora del móvil)' };
    else {
      if (cmd.from) this.remotes.set(String(cmd.from).slice(0, 32), Date.now());
      try { res = this.o.onCommand ? await this.o.onCommand(cmd) : { ok: false, msg: 'El Dashboard no acepta órdenes' }; }
      catch (e) { res = { ok: false, msg: 'Error en el Dashboard: ' + (e && e.message || e) }; }
    }
    await this.reply(cmd.id, res || { ok: false, msg: 'Sin respuesta' });
    this.status();
  };
  Emisor.prototype.reply = async function (id, res) {
    const f = await seal(this.K, K_ACK, enc.encode(JSON.stringify({ id, ok: !!res.ok, msg: String(res.msg || '').slice(0, 300), data: res.data || null })));
    this.links.forEach(l => l.publish(topic(this.K.sala, 's'), f));
  };
  /** Para la emisión: avisa a los móviles («emisión detenida») y cierra. */
  Emisor.prototype.stop = async function () {
    if (!this.on) return;
    clearTimeout(this.pushT); clearInterval(this.beatT);
    try { const f = await seal(this.K, K_END, enc.encode('{}')); this.links.forEach(l => l.publish(topic(this.K.sala, 's'), f)); } catch (e) {}
    this.on = false;
    await new Promise(r => setTimeout(r, 150));
    this.links.forEach(l => l.stop());
    this.viewers.clear();
    this.status();
  };

  // ── Receptor (móvil del equipo, solo lectura) ────────────────────────
  /**
   * opts: { params: {sala,k,p}, onSnapshot(obj, ts), onStatus(st), brokers?, WebSocket? }
   * st.state: 'connecting' (aún sin datos) · 'live' · 'stale' (sin noticias del Mac) · 'end' (emisión detenida)
   */
  function Receptor(opts) {
    this.o = opts; this.V = null; this.links = []; this.asm = new Assembler(); this.seen = [];
    this.id = b64u(rand(9)); this.applied = 0; this.lastMsg = 0; this.ended = false; this.lastAsk = 0; this.timers = []; this.pending = new Map();
  }
  Receptor.prototype.start = async function () {
    this.V = await viewerKeys(this.o.params);
    const brokers = this.o.brokers || BROKERS;
    this.links = brokers.map(b => new Link(b, {
      WebSocket: this.o.WebSocket, topics: [topic(this.V.sala, 's')],
      onMessage: (t, payload) => { this.queue = (this.queue || Promise.resolve()).then(() => this.onFrame(payload)).catch(e => console.error(e)); },
      onState: l => { if (l.state === 'on') this.hello(true, l); this.status(); }
    }));
    this.links.forEach(l => l.start());
    this.timers.push(setInterval(() => this.hello(false), PRESENCE_MS));
    this.timers.push(setInterval(() => this.status(), 2000));
    this.status();
  };
  Receptor.prototype.hello = async function (want, only) {
    if (want) this.lastAsk = Date.now();
    const f = await sealHello(this.V, { id: this.id, want: !!want, r: this.V.cmd ? 1 : 0 });
    (only ? [only] : this.links).forEach(l => l.publish(topic(this.V.sala, 'h'), f));
  };
  Receptor.prototype.onFrame = async function (payload) {
    const m = await openFrame(this.V, payload);
    if (!m) return;
    if (this.seen.indexOf(m.iv) >= 0) return;               // ya llegó por el otro repetidor
    this.seen.push(m.iv); if (this.seen.length > 200) this.seen.shift();
    this.lastMsg = Date.now();
    if (m.kind === K_STATE) {
      const r = this.asm.add(m.plain);
      if (r && r.ts > this.applied) { const obj = await unpack(r.bytes); this.applied = r.ts; this.ended = false; this.o.onSnapshot(obj, r.ts); }
    } else if (m.kind === K_BEAT) {
      const b = JSON.parse(dec.decode(m.plain));
      this.ended = false;
      if (b.ts > this.applied && Date.now() - this.lastAsk > 3000) this.hello(true);   // se perdió algo: pedirlo otra vez
    } else if (m.kind === K_END) this.ended = true;
    else if (m.kind === K_ACK) {
      const a = JSON.parse(dec.decode(m.plain)), p = this.pending.get(a.id);
      if (p) { this.pending.delete(a.id); clearTimeout(p.timer); p.resolve(a); }
    }
    this.status();
  };
  Receptor.prototype.state = function () {
    if (this.ended) return 'end';
    if (!this.applied) return 'connecting';
    return Date.now() - this.lastMsg > STALE_MS ? 'stale' : 'live';
  };
  Receptor.prototype.status = function () {
    if (this.o.onStatus) this.o.onStatus({ state: this.state(), links: linkStatus(this.links), lastMsg: this.lastMsg, applied: this.applied });
  };
  /** Mando: envía una orden al Mac y espera su respuesta ({ ok, msg }). Sin respuesta en 8 s → { ok:false }. */
  Receptor.prototype.command = async function (op, args) {
    if (!this.V || !this.V.cmd) return { ok: false, msg: 'Este enlace no es de mando' };
    const cmd = { id: b64u(rand(12)), t: Date.now(), from: this.id, op, args: args || {} };
    const f = await sealCmd(this.V, cmd);
    const live = this.links.filter(l => l.publish(topic(this.V.sala, 'c'), f)).length;
    if (!live) return { ok: false, msg: 'Sin conexión: la orden no ha salido' };
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(cmd.id); resolve({ ok: false, msg: 'El Mac no responde (¿Dashboard cerrado, sin internet o QR del mando renovado?)', timeout: true }); }, this.o.cmdTimeout || CMD_TIMEOUT);
      this.pending.set(cmd.id, { resolve, timer });
    });
  };
  Receptor.prototype.stop = function () { this.timers.forEach(t => clearInterval(t)); this.links.forEach(l => l.stop()); };

  const API = {
    BROKERS, PUBLIC_BASE, BUILD, PROTO, STALE_MS, VIEWER_TTL, CMD_WINDOW, K_STATE, K_BEAT, K_END, K_ACK, K_HELLO, K_CMD,
    newRoom, validRoom, withCmdKey, newCmdKey, staffUrl, remoteUrl, parseHash, publicBase, Emisor, Receptor, CmdGuard,
    // internos (para los tests)
    _: { b64u, unb64u, concat, MQ, varLen, pack, unpack, splitChunks, Assembler, macKeys, viewerKeys, seal, openFrame, sealHello, openHello, sealCmd, openCmd, fingerprint, topic, Link }
  };
  if (isNode) module.exports = API;
  else root.ShowtimeEmision = API;
})(typeof window !== 'undefined' ? window : globalThis);
