/* Showtime — remote.js · Mando del regidor (Entrega 2d-B)
 * Se abre con el QR PRIVADO del regidor: remote.html#sala=…&k=…&p=…&c=…
 * Lee el estado por la emisión (como la Live de Staff) y manda órdenes FIRMADAS al Mac.
 * Nada cambia aquí directamente: el Panel ejecuta cada orden con sus reglas y contesta (hecho / motivo).
 * Regla de oro: la banda sobre la que se actúa se ve siempre y se puede cambiar; En hora y los retrasos piden Confirmar.
 */
(function () {
  'use strict';
  const C = window.ShowtimeCore, Dt = window.ShowtimeDatos, Em = window.ShowtimeEmision, M = window.ShowtimeMando;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const ZKEY = 'showtime.remote.zone';
  const KIND = { show: 'SHOW', sc: 'SOUNDCHECK' };

  let FEST = null, CONFIG = null, ST = null, BUSY = false;
  let ZONE = (() => { try { return JSON.parse(localStorage.getItem(ZKEY)); } catch (e) { return null; } })();
  let SEL = null;           // banda elegida a mano (clave); null = la que se propone
  let R = null, SHEET = null;

  // ── Enlace ───────────────────────────────────────────────────────────
  const params = Em && Em.parseHash(location.hash);
  if (!params || !params.c || !(window.crypto && crypto.subtle) || !('WebSocket' in window)) {
    $('bad').hidden = false; $('app').hidden = true; document.querySelector('.actbar').hidden = true;
    if (params && !params.c) $('bad-t').textContent = 'Este es el QR de Staff (solo lectura). Para mandar, escanea el QR del regidor (Panel › Emisión › Regidor · mando).';
    return;
  }

  // ── Datos ────────────────────────────────────────────────────────────
  function load() { FEST = Dt.getFestival(); CONFIG = Dt.getConfig(); }
  function now() { return C.nowAbs(); }
  function zones() {
    if (!FEST) return [];
    const z = (FEST.escenarios || []).map(e => ({ id: e.id, name: e.nombre, color: e.color }));
    if (C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) z.push({ id: '', name: 'Sin zona', color: '#888' });
    return z;
  }
  function curZone(zs) { return zs.some(z => z.id === ZONE) ? ZONE : (zs[0] ? zs[0].id : null); }
  function zoneName(id) { const z = zones().find(x => x.id === id); return z ? z.name : 'Sin zona'; }
  function current() {
    const zs = zones(), zid = curZone(zs);
    if (zid === null) return { list: [], band: null, zid };
    const list = M.targets(FEST, zid, now());
    let band = SEL ? list.find(b => b.key === SEL) || null : null;
    if (!band) { SEL = null; band = M.suggest(list, now()); }
    return { list, band, zid };
  }
  function live() { return ST && ST.state !== 'end' && ST.links.some(l => l.state === 'on') && !!FEST; }

  // ── Pintado ──────────────────────────────────────────────────────────
  function fmtMin(m) { m = Math.max(0, Math.round(m)); return m >= 60 ? Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'min' : m + ' min'; }
  function deltaTxt(d) { return d > 0 ? '+' + d : d < 0 ? '−' + (-d) : '±0'; }
  function renderRx() {
    const s = ST ? ST.state : 'connecting', on = ST ? ST.links.filter(l => l.state === 'on').length : 0;
    const rx = $('rx');
    rx.className = 'rx ' + (s === 'live' && on ? 'live' : s === 'end' ? 'end' : s === 'stale' ? 'stale' : 'connecting');
    $('rx-t').textContent = s === 'end' ? 'EMISIÓN DETENIDA' : s === 'stale' ? 'SIN CONEXIÓN CON EL MAC' : s === 'live' && on ? 'CONECTADO' : 'CONECTANDO…';
  }
  function render() {
    const n = now(), d = new Date();
    $('clk').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    renderRx();
    if (!FEST) { $('evn').textContent = ST && ST.state === 'end' ? 'La emisión está parada en el Panel' : 'Esperando los datos del Mac…'; setActs(null); return; }
    const jor = C.jornadaOfAbs(FEST, Math.floor(n));
    $('evn').textContent = ((FEST.event && FEST.event.nombre) || 'Evento') + ' · ' + fmtDay(jor);

    // CALL activos
    const blocks = C.buildBlocks(FEST, { mode: 'all', day: 'all' });
    const calls = C.callList(blocks, n, Dt.callMinsOf(FEST, CONFIG), Dt.getCallDone());
    const ch = calls.map(b => '<div class="call"><div class="call-i"><svg class="ic"><use href="#i-bell"/></svg></div><div class="call-t"><b>CALL ' + C.fmtHM(C.callAt(b, Dt.callMinsOf(FEST, CONFIG))) + ' · ' + esc(b.name) + '</b><span>' + esc(KIND[b.kind] || '') + ' ' + C.fmtHM(b.si) + (b.stage ? ' · ' + esc(b.stage) : '') + ' · faltan ' + fmtMin(b.si - n) + '</span></div>'
      + '<button class="tbtn callok" data-ck="' + esc(C.callKey(b)) + '"' + (live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-check"/></svg>Confirmar</button></div>').join('');
    if ($('calls').dataset.h !== ch) { $('calls').innerHTML = ch; $('calls').dataset.h = ch; }
    $('calls').hidden = !calls.length;

    // Zonas
    const zs = zones(), cur = current();
    const zh = zs.length > 1 ? zs.map(z => '<button class="zchip' + (z.id === cur.zid ? ' on' : '') + '" data-z="' + esc(z.id) + '" style="--zc:' + esc(z.color || '#888') + '">' + esc(z.name) + '</button>').join('') : '';
    if ($('zones').dataset.h !== zh) { $('zones').innerHTML = zh; $('zones').dataset.h = zh; }
    $('zones').hidden = zs.length <= 1;

    // Banda
    const b = cur.band, i = b ? cur.list.indexOf(b) : -1;
    $('prev').disabled = i <= 0; $('next').disabled = i < 0 || i >= cur.list.length - 1;
    let bh;
    if (!b) bh = '<div class="bempty">Sin shows ni soundchecks hoy en ' + esc(zoneName(cur.zid)) + '</div>';
    else {
      let st = '';
      if (b.rf !== null) st = '<span class="bst done">Terminada ' + C.fmtHM(b.rf) + '</span>';
      else if (b.ri !== null) st = '<span class="bst on">En curso · quedan ' + fmtMin(C.blockEnd(b) - n) + '</span>';
      else if (b.si > n) st = '<span class="bst">Empieza en ' + fmtMin(b.si - n) + '</span>';
      else if (n < C.blockEnd(b)) st = '<span class="bst warn">Debería estar sonando · sin ▶</span>';
      else st = '<span class="bst">Pasada sin registros</span>';
      const real = b.ri !== null ? '<div class="breal ' + (b.delta > 0 ? 'late' : b.delta < 0 ? 'early' : '') + '">Real ' + C.fmtHM(b.ri) + (b.rf !== null ? '–' + C.fmtHM(b.rf) : '') + ' · ' + deltaTxt(b.delta) + ' min</div>' : '';
      bh = '<div class="bpos">' + (SEL ? 'ELEGIDA' : 'PROPUESTA') + ' · ' + (i + 1) + ' de ' + cur.list.length + (SEL ? ' · <button class="link" id="b-auto">volver a la propuesta</button>' : '') + '</div>'
        + '<div class="bkind">' + (KIND[b.kind] || '') + '</div><div class="bname" style="--bc:' + esc(b.color || '#888') + '">' + esc(b.name) + '</div>'
        + '<div class="btime">Programado ' + C.fmtHM(b.psi) + (b.psf !== null ? '–' + C.fmtHM(b.psf) : '') + '</div>' + real + st;
    }
    if ($('band').dataset.h !== bh) { $('band').innerHTML = bh; $('band').dataset.h = bh; }

    // Desfase de la zona
    const dz = C.driftByZone(FEST, blocks, Math.floor(n)).find(z => z.zoneId === (cur.zid || ''));
    let dh = '';
    if (dz) {
      if (dz.status === 'overflow') dh = '<span class="dchip over">Buffer agotado · desborde +' + dz.overflow + ' min</span>';
      else if (dz.status === 'absorb') dh = '<span class="dchip absorb">Desfase +' + dz.delta + ' min · se absorbe en el cambio</span>';
      else if (dz.status === 'early') dh = '<span class="dchip early">Adelanto ' + (-dz.delta) + ' min</span>';
      else dh = '<span class="dchip ok">En hora</span>';
    }
    if ($('drift').dataset.h !== dh) { $('drift').innerHTML = dh; $('drift').dataset.h = dh; }
    $('delay-hint').textContent = 'Zona ' + zoneName(cur.zid) + ' (o todas, en el resumen) · lo que empiece desde las ' + C.fmtHM(Math.floor(n));

    // Mensaje en pantalla
    const f = Dt.getFlash();
    const fh = f ? '<div class="fl-t"><span>EN PANTALLA</span><b>' + esc(f.text) + '</b><em>' + (Dt.flashLeft(f) === null ? 'hasta retirarlo' : 'se cierra en ' + Math.ceil(Dt.flashLeft(f) / 1000) + ' s') + '</em></div><button class="tbtn danger" id="flash-off"' + (live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-x"/></svg>Retirar</button>' : '';
    if ($('flash-cur').dataset.h !== fh) { $('flash-cur').innerHTML = fh; $('flash-cur').dataset.h = fh; }
    $('flash-cur').hidden = !f;

    setActs(b);
    document.querySelectorAll('.tbtn[data-delay], .msgp, #msg-form .send').forEach(x => { x.disabled = !live() || BUSY; });
    if (SHEET && SHEET.refresh) SHEET.refresh();
  }
  function setActs(b) {
    const a = M.actionsFor(b), ok = live() && !BUSY;
    $('b-start').disabled = !(ok && a.start);
    $('b-stop').disabled = !(ok && a.stop);
    $('b-ontime').disabled = !(ok && a.onTime);
    document.body.classList.toggle('busy', BUSY);
  }
  function fmtDay(iso) {
    const i = C.dayIndex(iso);
    return i === null ? iso : new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  // ── Avisos ───────────────────────────────────────────────────────────
  let toastT = 0;
  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ' good'); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3500);
    try { if (navigator.vibrate) navigator.vibrate(bad ? [60, 60, 60] : 35); } catch (e) {}
  }

  // ── Órdenes ──────────────────────────────────────────────────────────
  async function send(op, args) {
    if (BUSY) return null;
    BUSY = true; render();
    let res;
    try { res = await R.command(op, args); } catch (e) { res = { ok: false, msg: String(e && e.message || e) }; }
    BUSY = false;
    toast((res.ok ? 'Hecho · ' : 'No se ha hecho · ') + res.msg, !res.ok);
    render();
    return res;
  }
  function selBand() { return current().band; }
  $('b-start').addEventListener('click', () => { const b = selBand(); if (b) send('start', { key: b.key }); });
  $('b-stop').addEventListener('click', () => { const b = selBand(); if (b) send('stop', { key: b.key }); });
  $('b-ontime').addEventListener('click', () => {
    const b = selBand(); if (!b) return;
    openSheet({
      title: 'Poner en hora · ' + b.name,
      body: () => '<p class="big">Se borran sus registros: <b>▶ ' + (b.ri !== null ? C.fmtHM(b.ri) : '—') + '</b> · <b>■ ' + (b.rf !== null ? C.fmtHM(b.rf) : '—') + '</b>. Su desfase vuelve a 0.</p><p>Los retrasos que ya se aplicaron al resto del horario <b>se mantienen</b>.</p>',
      yes: 'Sí, en hora',
      run: () => send('onTime', { key: b.key })
    });
  });
  document.addEventListener('click', e => {
    const ck = e.target.closest('.callok'); if (ck && !ck.disabled) { send('callOk', { key: ck.dataset.ck }); return; }
    if (e.target.closest('#flash-off')) { send('flashOff', {}); return; }
    const z = e.target.closest('.zchip'); if (z) { ZONE = z.dataset.z; SEL = null; try { localStorage.setItem(ZKEY, JSON.stringify(ZONE)); } catch (er) {} render(); return; }
    if (e.target.closest('#b-auto')) { SEL = null; render(); return; }
    const dl = e.target.closest('[data-delay]'); if (dl && !dl.disabled) { openDelay(dl.dataset.delay === 'n' ? null : +dl.dataset.delay); return; }
    const mp = e.target.closest('.msgp'); if (mp && !mp.disabled) send('flash', { text: mp.dataset.msg });
  });
  $('prev').addEventListener('click', () => { const c = current(), i = c.list.indexOf(c.band); if (i > 0) { SEL = c.list[i - 1].key; render(); } });
  $('next').addEventListener('click', () => { const c = current(), i = c.list.indexOf(c.band); if (i >= 0 && i < c.list.length - 1) { SEL = c.list[i + 1].key; render(); } });
  $('msg-form').addEventListener('submit', async e => {
    e.preventDefault();
    const t = $('msg-text').value.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const r = await send('flash', { text: t });
    if (r && r.ok) { $('msg-text').value = ''; $('msg-text').blur(); }
  });

  // ── Hoja de confirmación ─────────────────────────────────────────────
  function openSheet(o) {
    SHEET = o;
    $('sh-t').textContent = o.title;
    $('sh-yes').textContent = o.yes || 'Confirmar';
    o.refresh = () => {
      const h = o.body();
      if ($('sh-b').dataset.h !== h) { const ae = document.activeElement && document.activeElement.id; $('sh-b').innerHTML = h; $('sh-b').dataset.h = h; if (o.bind) o.bind(); if (ae && $(ae)) $(ae).focus(); }
      $('sh-yes').disabled = !live() || BUSY || (o.can ? !o.can() : false);
    };
    $('sh-b').dataset.h = '';
    $('sheet').hidden = false;
    o.refresh();
  }
  function closeSheet() { SHEET = null; $('sheet').hidden = true; }
  $('sh-no').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  $('sh-yes').addEventListener('click', async () => {
    if (!SHEET || $('sh-yes').disabled) return;
    const o = SHEET; closeSheet();
    const r = await o.run();
    if (r && !r.ok && r.data && r.data.stale && o.reopen) o.reopen();   // el horario cambió: se enseña el resumen nuevo
  });

  /** Retraso: resumen calculado con las MISMAS reglas que el Mac; si al llegar no coincide, el Mac no lo aplica. */
  function openDelay(mins) {
    const W = { mins: mins || 5, custom: !mins, all: false, from: Math.floor(now()) };
    const zid = current().zid;
    const plan = () => M.delayPlan(FEST, CONFIG, { minutes: W.mins, zones: W.all ? 'all' : [zid || ''], from: W.from });
    openSheet({
      title: 'Retraso en cascada',
      yes: 'Confirmar',
      can: () => { const p = plan(); return p.ok && p.moved.length > 0; },
      body: () => {
        const p = plan();
        const head = (W.custom ? '<label class="nrow">+ <input id="d-n" type="number" inputmode="numeric" min="1" max="600" value="' + W.mins + '"> min</label>' : '<div class="dbig">+' + W.mins + ' min</div>')
          + '<div class="seg"><button data-sc="z" class="' + (W.all ? '' : 'on') + '">Solo ' + esc(zoneName(zid)) + '</button><button data-sc="all" class="' + (W.all ? 'on' : '') + '">Todas las zonas</button></div>'
          + '<p class="dfrom">Lo que empiece desde las ' + C.fmtHM(W.from) + ' · respeta los DELAY en rojo y los bloqueos del Panel</p>';
        if (!p.ok) return head + '<p class="err">' + esc(p.error) + '</p>';
        const sum = '<div class="dsum"><b>mueve ' + p.moved.length + '</b> · ' + p.kept.length + (p.kept.length === 1 ? ' fija' : ' fijas') + (p.clashes.length ? ' · <span class="bad">' + p.clashes.length + (p.clashes.length === 1 ? ' choque' : ' choques') + '</span>' : '') + '</div>';
        const rows = p.moved.map(m => '<li><span>' + esc(m.name) + '</span><em>' + C.fmtHM(m.from) + ' → <b>' + C.fmtHM(m.to) + '</b></em></li>').join('')
          + p.kept.map(k => '<li class="kept"><span><i class="led"></i>' + esc(k.name) + '</span><em>' + C.fmtHM(k.at) + ' · no se mueve</em></li>').join('');
        const cl = p.clashes.length ? '<div class="errbox"><svg class="ic"><use href="#i-alert"/></svg><span>' + p.clashes.map(c => esc(c.name) + ' choca con «' + esc(c.with) + '» (' + C.fmtHM(c.at) + ', DELAY rojo)').join('<br>') + '</span></div>' : '';
        return head + sum + cl + (rows ? '<ul class="dlist">' + rows + '</ul>' : '<p class="hint">No hay nada pendiente que mover con esa selección.</p>');
      },
      bind: () => {
        const n = $('d-n');
        if (n) n.addEventListener('input', () => { const v = Math.round(+n.value); if (v >= 1 && v <= 600) { W.mins = v; SHEET && SHEET.refresh(); } });
        document.querySelectorAll('#sh-b .seg button').forEach(b => b.addEventListener('click', () => { W.all = b.dataset.sc === 'all'; SHEET && SHEET.refresh(); }));
      },
      run: () => {
        const p = plan();
        if (!p.ok || !p.moved.length) return Promise.resolve({ ok: false, msg: 'Nada que mover' });
        return send('delay', { minutes: W.mins, zones: W.all ? 'all' : [zid || ''], from: W.from, stamp: M.delayStamp(p) });
      },
      reopen: () => openDelay(W.custom ? null : W.mins)
    });
  }

  // ── Arranque ─────────────────────────────────────────────────────────
  load();
  Dt.onChange(() => { load(); render(); });
  R = new Em.Receptor({ params, onSnapshot: s => Dt.loadSnapshot(s), onStatus: st => { ST = st; renderRx(); setActs(FEST ? current().band : null); } });
  R.start().catch(e => { console.error(e); toast('No se pudo conectar: ' + (e && e.message || e), true); });
  render();
  setInterval(render, 1000);
  // Pantalla encendida mientras el mando está abierto (si el navegador lo permite)
  let wl = null;
  async function wake() { if (!('wakeLock' in navigator) || wl || document.visibilityState !== 'visible') return; try { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } catch (e) {} }
  document.addEventListener('visibilitychange', wake); document.addEventListener('pointerdown', wake); wake();
  window.ShowtimeRemote = { send, current };
})();
