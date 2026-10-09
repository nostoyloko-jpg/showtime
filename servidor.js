#!/usr/bin/env node
/* Showtime — servidor.js  (Transporte local 2d-C, dec. 115)
 * Emisión y mandos QR SIN internet: búnker, recinto sin cobertura, festival con la red saturada.
 *
 *   cd ~/Claude/SHOWTIME
 *   node servidor.js            (puerto 8765)   ·   node servidor.js 9000   (otro puerto)
 *
 * Hace dos cosas en el MISMO puerto, sin librerías (solo Node):
 *  1. Sirve la app a los móviles de la red Wi-Fi: http://<IP del Mac>:8765/live.html, remote.html…
 *  2. Hace de repetidor MQTT por WebSocket (ws://…:8765/mqtt), igual que los repetidores públicos de la nube:
 *     solo reenvía. Los datos van cifrados y firmados de punta a punta (dec. 55): este servidor no puede leerlos ni
 *     fabricarlos. Sin mensajes retenidos, nada se guarda.
 * Además, /showtime-local.json dice al Dashboard las IP del Mac (para el QR) y que el servidor está vivo.
 *
 * El Dashboard sigue abierto donde siempre (GitHub Pages / app instalada, en Chrome) y se conecta a ws://localhost:8765.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const ROOT = __dirname;
const MAX_PACKET = 512 * 1024;      // un paquete MQTT nunca pasa de esto (la app trocea a 24 KB)
const MAX_CLIENTS = 300;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

/** IPv4 de la red local del Mac (Wi-Fi / cable), las privadas primero. */
function lanIps() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => {
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }));
  const priv = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => (priv(b) ? 1 : 0) - (priv(a) ? 1 : 0));
}

// ── Archivos ──────────────────────────────────────────────────────────
/** Solo archivos de la app: nada que empiece por «.», ni tests, ni fuera de la carpeta. */
function safeFile(urlPath) {
  let p;
  try { p = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]); } catch (e) { return null; }
  if (p === '/' || p === '') p = '/index.html';
  const parts = p.split('/').filter(Boolean);
  if (!parts.length || parts.some(x => x.startsWith('.') || x === 'node_modules' || x === 'tests')) return null;
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!TYPES[ext] || parts[parts.length - 1] === 'servidor.js') return null;
  const full = path.resolve(ROOT, parts.join(path.sep));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return { full, type: TYPES[ext] };
}

// ── WebSocket (RFC 6455, lo justo) ───────────────────────────────────
function wsFrame(payload, opcode) {
  const n = payload.length, op = opcode === undefined ? 2 : opcode;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(Math.floor(n / 0x100000000), 2); h.writeUInt32BE(n >>> 0, 6); return h; })();
  return Buffer.concat([head, payload]);
}
/** Trocea lo recibido en tramas WebSocket (enmascaradas, como manda el estándar a los clientes). */
function wsParse(buf) {
  const frames = []; let o = 0;
  while (buf.length - o >= 2) {
    const b0 = buf[o], b1 = buf[o + 1], masked = b1 & 0x80; let n = b1 & 0x7f, h = 2;
    if (n === 126) { if (buf.length - o < 4) break; n = buf.readUInt16BE(o + 2); h = 4; }
    else if (n === 127) { if (buf.length - o < 10) break; n = buf.readUInt32BE(o + 2) * 0x100000000 + buf.readUInt32BE(o + 6); h = 10; }
    if (n > MAX_PACKET * 2) return { error: 'trama demasiado grande' };
    if (!masked) return { error: 'trama sin máscara' };
    if (buf.length - o < h + 4 + n) break;
    const mask = buf.subarray(o + h, o + h + 4), data = Buffer.from(buf.subarray(o + h + 4, o + h + 4 + n));
    for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
    frames.push({ fin: !!(b0 & 0x80), op: b0 & 0x0f, data });
    o += h + 4 + n;
  }
  return { frames, rest: buf.subarray(o) };
}

// ── MQTT 3.1.1 (lo que usa Showtime: CONNECT, SUBSCRIBE, PUBLISH QoS 0, PING, UNSUBSCRIBE, DISCONNECT) ──
function mqVarLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
function mqPacket(first, body) { return Buffer.concat([Buffer.from([first].concat(mqVarLen(body.length))), body]); }
function mqParse(buf) {
  const packets = []; let o = 0;
  while (buf.length - o >= 2) {
    let mul = 1, len = 0, i = o + 1, done = false;
    for (let k = 0; k < 4 && i < buf.length; k++, i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { done = true; i++; break; } }
    if (!done) { if (i - o > 4) return { error: 'longitud MQTT no válida' }; break; }
    if (len > MAX_PACKET) return { error: 'paquete MQTT demasiado grande' };
    if (buf.length - i < len) break;
    packets.push({ type: buf[o] >> 4, flags: buf[o] & 15, body: buf.subarray(i, i + len) });
    o = i + len;
  }
  return { packets, rest: buf.subarray(o) };
}
const mqStr = (b, o) => { const n = b.readUInt16BE(o); return { s: b.toString('utf8', o + 2, o + 2 + n), next: o + 2 + n }; };
/** Tema MQTT con comodines (+ un nivel, # el resto). */
function topicMatch(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false;
  }
  return f.length === t.length;
}

// ── Repetidor ────────────────────────────────────────────────────────
function Broker(log) { this.clients = new Set(); this.log = log || (() => {}); this.stats = { publish: 0, delivered: 0 }; }
Broker.prototype.attach = function (sock) {
  if (this.clients.size >= MAX_CLIENTS) { sock.destroy(); return null; }
  const c = { sock, wsBuf: Buffer.alloc(0), mqBuf: Buffer.alloc(0), frag: [], subs: [], connected: false, keep: 60, last: Date.now(), id: '' };
  this.clients.add(c);
  const bye = () => { if (this.clients.delete(c)) this.log('− ' + (c.id || 'cliente') + ' (' + this.clients.size + ' conectados)'); };
  sock.on('data', d => { try { this.onData(c, d); } catch (e) { this.kill(c, 'error: ' + e.message); } });
  sock.on('close', bye); sock.on('error', bye);
  sock.on('end', () => { bye(); try { sock.destroy(); } catch (e) {} });   // el servidor HTTP deja el socket «medio abierto»: se cierra del todo
  sock.setNoDelay(true);
  return c;
};
Broker.prototype.kill = function (c, why) { if (why) this.log('× ' + (c.id || 'cliente') + ': ' + why); try { c.sock.destroy(); } catch (e) {} this.clients.delete(c); };
Broker.prototype.send = function (c, bytes) { if (!c.sock.destroyed) c.sock.write(wsFrame(bytes)); };
Broker.prototype.onData = function (c, d) {
  c.last = Date.now();
  const r = wsParse(Buffer.concat([c.wsBuf, d]));
  if (r.error) return this.kill(c, r.error);
  c.wsBuf = Buffer.from(r.rest);
  for (const f of r.frames) {
    if (f.op === 8) { try { c.sock.end(wsFrame(Buffer.alloc(0), 8)); } catch (e) {} this.clients.delete(c); return; }
    if (f.op === 9) { c.sock.write(wsFrame(f.data, 10)); continue; }
    if (f.op === 10) continue;
    if (f.op === 1 || f.op === 2 || f.op === 0) {
      c.frag.push(f.data);
      if (!f.fin) continue;
      const data = Buffer.concat(c.frag); c.frag = [];
      this.onMqtt(c, data);
      if (c.sock.destroyed) return;
    }
  }
};
Broker.prototype.onMqtt = function (c, data) {
  const r = mqParse(Buffer.concat([c.mqBuf, data]));
  if (r.error) return this.kill(c, r.error);
  c.mqBuf = Buffer.from(r.rest);
  for (const p of r.packets) {
    if (!c.connected && p.type !== 1) return this.kill(c, 'sin CONNECT');
    if (p.type === 1) {                                  // CONNECT
      const proto = mqStr(p.body, 0); let o = proto.next + 2;   // + nivel y flags
      c.keep = p.body.readUInt16BE(o); o += 2;
      c.id = mqStr(p.body, o).s.slice(0, 40); c.connected = true;
      this.send(c, Buffer.from([0x20, 2, 0, 0]));
      this.log('+ ' + c.id + ' (' + this.clients.size + ' conectados)');
    } else if (p.type === 8) {                           // SUBSCRIBE
      const id = p.body.readUInt16BE(0); let o = 2; const codes = [];
      while (o < p.body.length) { const t = mqStr(p.body, o); o = t.next + 1; if (t.s.startsWith('showtime/') && t.s.length <= 200) { c.subs.push(t.s); codes.push(0); } else codes.push(0x80); }
      this.send(c, mqPacket(0x90, Buffer.from([id >> 8, id & 255].concat(codes))));
    } else if (p.type === 10) {                          // UNSUBSCRIBE
      const id = p.body.readUInt16BE(0); let o = 2;
      while (o < p.body.length) { const t = mqStr(p.body, o); o = t.next; c.subs = c.subs.filter(s => s !== t.s); }
      this.send(c, Buffer.from([0xb0, 2, id >> 8, id & 255]));
    } else if (p.type === 3) {                           // PUBLISH (QoS 0, sin retener)
      const t = mqStr(p.body, 0), qos = (p.flags >> 1) & 3;
      if (qos || !t.s.startsWith('showtime/')) continue;   // Showtime solo usa QoS 0 y sus temas
      this.stats.publish++;
      const out = mqPacket(0x30, p.body);
      this.clients.forEach(o => { if (o.connected && o.subs.some(s => topicMatch(s, t.s))) { this.send(o, out); this.stats.delivered++; } });
    } else if (p.type === 12) this.send(c, Buffer.from([0xd0, 0]));   // PINGREQ → PINGRESP
    else if (p.type === 14) { this.kill(c); return; }                   // DISCONNECT
  }
};
/** Conexiones mudas (más de 1,5 × su keepalive, como manda MQTT) se cierran. */
Broker.prototype.sweep = function (now) { this.clients.forEach(c => { if (now - c.last > (c.keep ? c.keep * 1500 : 600000)) this.kill(c, 'sin latido'); }); };

// ── Servidor HTTP + WebSocket ────────────────────────────────────────
function createServer(opts) {
  const o = opts || {}, port = o.port === undefined ? 8765 : o.port, log = o.log || (() => {});
  const broker = new Broker(log);
  const server = http.createServer((req, res) => {
    const u = String(req.url || '/').split('?')[0];
    if (u === '/showtime-local.json') {   // el Dashboard (en GitHub Pages o la app) pregunta: ¿estás? ¿qué IP tienes?
      res.writeHead(req.method === 'OPTIONS' ? 204 : 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' });
      if (req.method === 'OPTIONS') return res.end();
      return res.end(JSON.stringify({ app: 'showtime', port: server.address().port, ips: lanIps(), clients: broker.clients.size }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const f = safeFile(u);
    if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    fs.readFile(f.full, (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'], u = String(req.url || '').split('?')[0];
    if (u !== '/mqtt' || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n'
      + (protos.indexOf('mqtt') >= 0 ? 'Sec-WebSocket-Protocol: mqtt\r\n' : '') + '\r\n');
    broker.attach(sock);
  });
  const sweeper = setInterval(() => broker.sweep(Date.now()), 15000); sweeper.unref();
  return {
    server, broker,
    listen() { return new Promise((ok, ko) => { server.once('error', ko); server.listen(port, o.host || '0.0.0.0', () => ok(server.address().port)); }); },
    close() { clearInterval(sweeper); broker.clients.forEach(c => { try { c.sock.destroy(); } catch (e) {} }); return new Promise(ok => server.close(() => ok())); }
  };
}

module.exports = { createServer, safeFile, wsFrame, wsParse, mqParse, mqPacket, topicMatch, lanIps, Broker, ROOT };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8765;
  const hora = () => new Date().toTimeString().slice(0, 8);
  const S = createServer({ port, log: m => console.log(hora() + '  ' + m) });
  S.listen().then(p => {
    const ips = lanIps();
    console.log('\n  SHOWTIME · servidor local (sin internet)  ·  puerto ' + p + '\n');
    console.log('  Dashboard: ábrelo donde siempre (Chrome) › Pantallas y Emisión › Red Local Wi-Fi.');
    console.log('  Dispositivos (misma Wi-Fi):  ' + (ips.length ? ips.map(ip => 'http://' + ip + ':' + p + '/').join('  ·  ') : 'sin red: conecta el Mac a la Wi-Fi o al router'));
    console.log('\n  Deja esta ventana abierta durante el evento. Para parar: Ctrl+C\n');
  }).catch(e => {
    console.error(e && e.code === 'EADDRINUSE' ? '\n  El puerto ' + port + ' ya está en uso (¿hay otro servidor abierto?). Prueba: node servidor.js ' + (port + 1) + '\n' : e);
    process.exit(1);
  });
}
