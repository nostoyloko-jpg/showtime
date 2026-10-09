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
  const i18t = (k, v) => window.ShowtimeI18n ? window.ShowtimeI18n.t(k, v) : k;   // texto en el idioma activo (lo manda el Panel)
  // Idioma (Fase 3): tx('Texto en español') en el idioma que manda el Panel; back() traduce lo que llega ya escrito en español del Mac
  const I18 = window.ShowtimeI18n;
  const tx = (s, v) => I18 ? I18.tx(s, v) : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s);
  const back = s => I18 && I18.txBack ? I18.txBack(s) : s;
  const LOCALE = () => (I18 && I18.getLang() === 'en' ? 'en-GB' : 'es-ES');

  let FEST = null, CONFIG = null, ST = null, BUSY = false;
  let ZONE = (() => { try { return JSON.parse(localStorage.getItem(ZKEY)); } catch (e) { return null; } })();
  let SEL = null;           // banda elegida a mano (clave); null = la que se propone
  let R = null, SHEET = null;
  let MSG_TO = null;        // destino de los mensajes: null = todas; si no, lista de vistas
  let MSG_ZONES = null;     // zonas de las pantallas Confidence que lo reciben: null = todas

  // ── Enlace ───────────────────────────────────────────────────────────
  const params = Em && Em.parseHash(location.hash);
  if (!params || !params.c || !(Em.canView ? Em.canView() : window.crypto && crypto.subtle) || !('WebSocket' in window)) {   // red local: cifrado de reserva (dec. 115)
    $('bad').hidden = false; $('app').hidden = true; document.querySelector('.actbar').hidden = true;
    if (params && !params.c) $('bad-t').textContent = tx('Este es el QR de Staff (solo lectura). Para mandar, escanea el QR del Stage Manager (Dashboard › Pantallas y Emisión › Stage Manager).');
    return;
  }

  // Mando de UNA zona (dec. 102): la zona va en el enlace con su propia clave; el Mac rechaza lo que toque otra zona.
  // Aquí solo se ve y se maneja esa zona (sin selector), los retrasos son solo de ella y a Confidence solo va la suya.
  const LOCK = typeof params.z === 'string' && params.z ? params.z : null;
  if (LOCK) { ZONE = LOCK; MSG_ZONES = [LOCK]; }

  // ── Datos ────────────────────────────────────────────────────────────
  function load() {
    FEST = Dt.getFestival(); CONFIG = Dt.getConfig();
    if (window.ShowtimeI18n) window.ShowtimeI18n.setLang(CONFIG.lang);   // el idioma lo manda el Panel (llega con la emisión)
  }
  function now() { return C.nowAbs(); }
  function zones() {
    if (!FEST) return [];
    const z = (FEST.escenarios || []).map(e => ({ id: e.id, name: e.nombre, color: e.color }));
    if (C.buildBlocks(FEST, { mode: 'all', day: 'all' }).some(b => C.isBand(b) && !b.stageId)) z.push({ id: '', name: tx('Sin zona'), color: '#888' });
    return LOCK ? z.filter(x => x.id === LOCK) : z;
  }
  /** «Solo hoy» (dec. 105): la jornada que emite el Panel (null en emisiones antiguas: la del reloj). */
  function scopeDay() { const s = Dt.getScope ? Dt.getScope() : null; return s ? s.day : null; }
  function curZone(zs) { return zs.some(z => z.id === ZONE) ? ZONE : (zs[0] ? zs[0].id : null); }
  function zoneName(id) { const z = zones().find(x => x.id === id); return z ? z.name : tx('Sin zona'); }
  function current() {
    const zs = zones(), zid = curZone(zs);
    if (zid === null) return { list: [], band: null, zid };
    const list = M.targets(FEST, zid, now(), scopeDay());
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
    $('rx-t').textContent = tx(s === 'end' ? 'EMISIÓN DETENIDA' : s === 'stale' ? 'SIN CONEXIÓN CON EL MAC' : s === 'live' && on ? 'CONECTADO' : 'CONECTANDO…');
  }
  function render() {
    const n = now(), d = new Date();
    $('clk').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    renderRx();
    if (!FEST) { $('evn').textContent = tx(ST && ST.state === 'end' ? 'La emisión está parada en el Dashboard' : 'Esperando los datos del Mac…'); setActs(null); return; }
    const sc = Dt.getScope ? Dt.getScope() : null, jor = sc ? sc.day : C.activeJornada(FEST, Math.floor(n));
    $('evn').textContent = C.eventName(FEST, tx) + ' · ' + fmtDay(jor) + (sc && sc.closed ? ' · ' + tx('jornada cerrada en el Dashboard') : '');
    const zl = LOCK ? zones()[0] : null;
    $('zlock').hidden = !LOCK;
    if (LOCK) { $('zlock').textContent = zl ? zl.name : tx('Zona'); $('zlock').style.setProperty('--zc', (zl && zl.color) || '#888'); }

    // CALL activos
    const blocks = C.buildBlocks(FEST, { mode: 'all', day: 'all' });
    const calls = C.callList(blocks, n, Dt.callMinsOf(FEST, CONFIG), Dt.getCallDone()).filter(b => !LOCK || (b.stageId || '') === LOCK);
    const ch = calls.map(b => '<div class="call"><div class="call-i"><svg class="ic"><use href="#i-bell"/></svg></div><div class="call-t"><b>CALL ' + C.fmtHM(C.callAt(b, Dt.callMinsOf(FEST, CONFIG))) + ' · ' + esc(b.name) + '</b><span>' + esc(KIND[b.kind] || '') + ' ' + C.fmtHM(b.si) + (b.stage ? ' · ' + esc(b.stage) : '') + ' · ' + tx('faltan {t}', { t: fmtMin(b.si - n) }) + '</span></div>'
      + '<button class="tbtn callok" data-ck="' + esc(C.callKey(b)) + '"' + (live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-check"/></svg>' + tx('Confirmar') + '</button></div>').join('');
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
    if (!b) bh = '<div class="bempty">' + tx('Sin shows ni soundchecks hoy en {z}', { z: esc(zoneName(cur.zid)) }) + '</div>';
    else {
      let st = '';
      if (b.rf !== null) st = '<span class="bst done">' + tx('Terminada {h}', { h: C.fmtHM(b.rf) }) + '</span>';
      else if (b.live) st = '<span class="bst warn">' + tx('Tiempo extra · +{n} min · ■ cuando acabe', { n: Math.round(b.sf - b.nf) }) + '</span>';
      else if (b.ri !== null) st = '<span class="bst on">' + tx('En curso · quedan {t}', { t: fmtMin(b.nf - n) }) + '</span>';
      else if (b.si > n) st = '<span class="bst">' + tx('Empieza en {t}', { t: fmtMin(b.si - n) }) + '</span>';
      else if (n < C.blockEnd(b)) st = '<span class="bst on">' + tx('Sonando según el horario · ■ cuando acabe') + '</span>';
      else st = '<span class="bst">' + tx('Pasada sin registros') + '</span>';
      const est = b.si !== b.psi || b.sf !== b.psf || b.ri !== null || b.rf !== null;
      const real = est ? '<div class="breal ' + (b.clash ? 'clash' : 'late') + '">' + tx(b.ri !== null || b.rf !== null ? 'Real' : 'Estimado') + ' ' + C.fmtHM(b.si) + (b.sf !== null ? '–' + C.fmtHM(b.sf) : '') +
        (b.si !== b.psi ? ' · ' + deltaTxt(b.si - b.psi) + ' min' : '') + (b.clash ? ' · ' + tx('pisada por {n}', { n: esc(b.clashWith) }) : '') + '</div>' : '';
      // Acabada a su hora (sin ■ ni Tiempo extra): Bis (show) / Extender prueba (soundcheck) dentro de la ventana; si la
      // siguiente ya dio ▶, desactivado; pasada la ventana, nada. Si no ha acabado: TIEMPO EXTRA de siempre.
      const bs = FEST ? M.bisState(FEST, b, Math.floor(n), CONFIG) : { ok: false, reason: 'no' };
      const ended = b.rf === null && !b.alargar && b.nf !== null && b.nf !== undefined && n >= b.nf;
      let alg = '';
      if (ended && (bs.ok || bs.reason === 'next')) {
        const label = i18t(bs.kind === 'sc' ? 'bis.sc' : 'bis.show', { name: b.name });
        const sub = bs.ok ? i18t('bis.min', { n: bs.left }) : i18t('bis.next', { next: bs.next ? bs.next.name : '' });
        alg = '<button class="tbtn stretch bis" id="b-bis" data-kind="' + bs.kind + '"' + (bs.ok && live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-undo"/></svg>' +
          esc(label) + ' <small>' + esc(sub) + '</small></button>';
      } else if (b.rf === null && !ended) {
        alg = '<button class="tbtn stretch' + (b.alargar ? ' on' : '') + '" id="b-stretch" data-on="' + (b.alargar ? '0' : '1') + '"' + (live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-stretch"/></svg>' +
          tx(b.alargar ? 'TIEMPO EXTRA · ACTIVADO' : 'TIEMPO EXTRA') + '</button>';
      }
      bh = '<div class="bpos">' + tx(SEL ? 'ELEGIDA' : 'PROPUESTA') + ' · ' + tx('{i} de {n}', { i: i + 1, n: cur.list.length }) + (SEL ? ' · <button class="link" id="b-auto">' + tx('volver a la propuesta') + '</button>' : '') + '</div>'
        + '<div class="bkind">' + (KIND[b.kind] || '') + '</div><div class="bname" style="--bc:' + esc(b.color || '#888') + '">' + esc(b.name) + '</div>'
        + '<div class="btime">' + tx('Previsto') + ' ' + C.fmtHM(b.psi) + (b.psf !== null ? '–' + C.fmtHM(b.psf) : '') + '</div>' + real + st + alg;
    }
    if ($('band').dataset.h !== bh) { $('band').innerHTML = bh; $('band').dataset.h = bh; }

    // Retraso de la zona elegida: acumulado (+ desfase en vivo)
    const dz = C.delayByZone(FEST, n).find(z => z.zoneId === (cur.zid || ''));
    let dh = '';
    if (dz) { const p = M.delayPill(dz, zoneName(cur.zid)); dh = '<span class="dchip ' + p.cls + '">' + (p.cls === 'ok' || p.cls === 'early' ? '<svg class="ic"><use href="#i-check"/></svg>' : '') + esc(p.text) + '</span>'; }
    if ($('drift').dataset.h !== dh) { $('drift').innerHTML = dh; $('drift').dataset.h = dh; }
    $('delay-hint').textContent = LOCK ? tx('Solo {z} · lo que empiece desde las {h}', { z: zoneName(cur.zid), h: C.fmtHM(Math.floor(n)) }) : tx('Zona {z} (o todas, en el resumen) · lo que empiece desde las {h}', { z: zoneName(cur.zid), h: C.fmtHM(Math.floor(n)) });

    // Mensaje en pantalla
    const f = Dt.getFlash();
    const fh = f ? '<div class="fl-t"><span>' + tx('EN PANTALLA') + (f.to && f.to.length ? ' · ' + esc(f.to.map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(' · ')).toUpperCase() : '') + '</span><b>' + esc(f.text) + '</b><em>' + (Dt.flashLeft(f) === null ? tx('hasta retirarlo') : tx('se cierra en {n} s', { n: Math.ceil(Dt.flashLeft(f) / 1000) })) + '</em></div><button class="tbtn danger" id="flash-off"' + (live() && !BUSY ? '' : ' disabled') + '><svg class="ic"><use href="#i-x"/></svg>' + tx('Retirar') + '</button>' : '';
    if ($('flash-cur').dataset.h !== fh) { $('flash-cur').innerHTML = fh; $('flash-cur').dataset.h = fh; }
    $('flash-cur').hidden = !f;

    setActs(b, n);
    renderMsgZones();
    document.querySelectorAll('.tbtn[data-delay], .msgp, #msg-form .send').forEach(x => { x.disabled = !live() || BUSY; });
    if (SHEET && SHEET.refresh) SHEET.refresh();
  }
  function setActs(b, n) {
    const a = M.actionsFor(b, n), ok = live() && !BUSY;
    $('b-start').disabled = !(ok && a.start);
    $('b-stop').disabled = !(ok && a.stop);
    $('b-ontime').disabled = !(ok && a.onTime);
    document.body.classList.toggle('busy', BUSY);
  }
  function fmtDay(iso) {
    const i = C.dayIndex(iso);
    return i === null ? iso : new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  // ── Avisos ───────────────────────────────────────────────────────────
  let toastT = 0;
  function toast(msg, bad) {
    const t = $('toast'); t.textContent = back(msg); t.className = 'toast' + (bad ? ' bad' : ' good'); t.hidden = false;
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
    toast(tx(res.ok ? 'Hecho' : 'No se ha hecho') + ' · ' + back(res.msg), !res.ok);   // la respuesta del Mac llega en español: se traduce aquí
    render();
    return res;
  }
  function selBand() { return current().band; }
  $('b-start').addEventListener('click', () => { const b = selBand(); if (b) send('start', { key: b.key }); });
  $('b-stop').addEventListener('click', () => { const b = selBand(); if (b) send('stop', { key: b.key }); });
  $('b-ontime').addEventListener('click', () => {
    const b = selBand(); if (!b) return;
    openSheet({
      title: tx('En hora') + ' · ' + b.name,
      body: () => '<p class="big">' + tx(b.si !== b.pmi ? 'Empieza (o empezó) a su hora prevista: <b>{h}</b> (estaba estimada a las {e}).' : 'Empieza (o empezó) a su hora prevista: <b>{h}</b>.', { h: C.fmtHM(b.pmi), e: C.fmtHM(b.si) }) + '</p><p>' + tx('El retraso que arrastraba la zona <b>se cancela</b>. Los retrasos manuales (+5, +10…) se mantienen.') + '</p>',
      yes: tx('Sí, en hora'),
      run: () => send('onTime', { key: b.key })
    });
  });
  document.addEventListener('click', e => {
    const bb = e.target.closest('#b-bis');
    if (bb && !bb.disabled) {   // Bis / Extender prueba: se confirma antes, con lo que va a pasar (mismas reglas que el Mac)
      const b = selBand(); if (!b || !FEST) return;
      const p = M.stretchPlan(FEST, b.key, true, Math.floor(now()), CONFIG), sc = bb.dataset.kind === 'sc';
      if (!p.ok) { openSheet({ title: i18t(sc ? 'bis.sc' : 'bis.show', { name: b.name }), body: () => '<p class="big">' + esc(back(p.error)) + '</p>', can: () => false, run: () => null }); return; }
      openSheet({ title: i18t(sc ? 'bis.sc' : 'bis.show', { name: b.name }), body: () => '<p class="big">' + esc(back(p.msg)) + '</p>', yes: i18t(sc ? 'bis.yesSc' : 'bis.yesShow'), run: () => send('stretch', { key: b.key, on: true }) });
      return;
    }
    const sg = e.target.closest('#b-stretch');
    if (sg && !sg.disabled) {
      const b = selBand(); if (!b) return;
      send('stretch', { key: b.key, on: sg.dataset.on === '1' });
      return;
    }
    const ck = e.target.closest('.callok'); if (ck && !ck.disabled) { send('callOk', { key: ck.dataset.ck }); return; }
    if (e.target.closest('#flash-off')) { send('flashOff', {}); return; }
    const z = e.target.closest('.zchip'); if (z) { ZONE = z.dataset.z; SEL = null; try { localStorage.setItem(ZKEY, JSON.stringify(ZONE)); } catch (er) {} render(); return; }
    if (e.target.closest('#b-auto')) { SEL = null; render(); return; }
    const dl = e.target.closest('[data-delay]'); if (dl && !dl.disabled) { openDelay(dl.dataset.delay === 'n' ? null : +dl.dataset.delay); return; }
    const mp = e.target.closest('.msgp'); if (mp && !mp.disabled) send('flash', { text: tx(mp.dataset.msg), to: MSG_TO, zones: MSG_ZONES });   // los mensajes rápidos salen en el idioma del Panel
  });
  $('msg-to').addEventListener('click', e => {
    const b = e.target.closest('[data-to]'); if (!b) return;
    const t = b.dataset.to, V3 = ['manager', 'confidence', 'backstage'];
    if (t === 'all') MSG_TO = null;
    else { const cur = (MSG_TO || []).slice(); const i = cur.indexOf(t); if (i >= 0) cur.splice(i, 1); else cur.push(t); MSG_TO = cur.length && cur.length < 3 ? V3.filter(v => cur.indexOf(v) >= 0) : null; }
    document.querySelectorAll('#msg-to [data-to]').forEach(x => x.classList.toggle('on', x.dataset.to === 'all' ? !MSG_TO : !!(MSG_TO && MSG_TO.indexOf(x.dataset.to) >= 0)));
    renderMsgZones();
  });
  /** Zonas de Confidence que reciben el mensaje (si va a Confidence y hay más de una zona). */
  function renderMsgZones() {
    if (LOCK) { MSG_ZONES = [LOCK]; $('msg-zones').hidden = true; return; }   // a Confidence, solo la de su zona
    const zs = zones(), box = $('msg-zones');
    box.hidden = !((!MSG_TO || MSG_TO.indexOf('confidence') >= 0) && zs.length > 1);
    if (MSG_ZONES) { MSG_ZONES = MSG_ZONES.filter(id => zs.some(z => z.id === id)); if (!MSG_ZONES.length) MSG_ZONES = null; }
    const h = '<button data-z="*" class="' + (!MSG_ZONES ? 'on' : '') + '">' + tx('Todas') + '</button>' + zs.map(z => '<button data-z="' + esc(z.id) + '" class="' + (MSG_ZONES && MSG_ZONES.indexOf(z.id) >= 0 ? 'on' : '') + '" style="--zc:' + esc(z.color || '#888') + '">' + esc(z.name) + '</button>').join('');
    if ($('msg-zl').dataset.h !== h) { $('msg-zl').innerHTML = h; $('msg-zl').dataset.h = h; }
  }
  $('msg-zl').addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const z = b.dataset.z;
    if (z === '*') MSG_ZONES = null;
    else { const cur = (MSG_ZONES || []).slice(); const i = cur.indexOf(z); if (i >= 0) cur.splice(i, 1); else cur.push(z); MSG_ZONES = cur.length && cur.length < zones().length ? cur : null; }
    renderMsgZones();
  });
  $('prev').addEventListener('click', () => { const c = current(), i = c.list.indexOf(c.band); if (i > 0) { SEL = c.list[i - 1].key; render(); } });
  $('next').addEventListener('click', () => { const c = current(), i = c.list.indexOf(c.band); if (i >= 0 && i < c.list.length - 1) { SEL = c.list[i + 1].key; render(); } });
  $('msg-form').addEventListener('submit', async e => {
    e.preventDefault();
    const t = $('msg-text').value.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const r = await send('flash', { text: t, to: MSG_TO, zones: MSG_ZONES });
    if (r && r.ok) { $('msg-text').value = ''; $('msg-text').blur(); }
  });

  // ── Hoja de confirmación ─────────────────────────────────────────────
  function openSheet(o) {
    SHEET = o;
    $('sh-t').textContent = o.title;
    $('sh-yes').textContent = o.yes || tx('Confirmar');
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
      title: tx('Retraso en cascada'),
      yes: tx('Confirmar'),
      can: () => { const p = plan(); return p.ok && p.moved.length > 0; },
      body: () => {
        const p = plan();
        const head = (W.custom ? '<label class="nrow">+ <input id="d-n" type="number" inputmode="numeric" min="1" max="600" value="' + W.mins + '"> min</label>' : '<div class="dbig">+' + W.mins + ' min</div>')
          + (LOCK ? '' : '<div class="seg"><button data-sc="z" class="' + (W.all ? '' : 'on') + '">' + tx('Solo {z}', { z: esc(zoneName(zid)) }) + '</button><button data-sc="all" class="' + (W.all ? 'on' : '') + '">' + tx('Todas las zonas') + '</button></div>')
          + '<p class="dfrom">' + tx('Lo que empiece desde las {h} · respeta los DELAY en rojo y los bloqueos del Dashboard', { h: C.fmtHM(W.from) }) + '</p>';
        if (!p.ok) return head + '<p class="err">' + esc(back(p.error)) + '</p>';
        const sum = '<div class="dsum"><b>' + tx('mueve {n}', { n: p.moved.length }) + '</b> · ' + tx(p.kept.length === 1 ? '{n} fija' : '{n} fijas', { n: p.kept.length }) + (p.clashes.length ? ' · <span class="bad">' + tx(p.clashes.length === 1 ? '{n} choque' : '{n} choques', { n: p.clashes.length }) + '</span>' : '') + '</div>';
        const rows = p.moved.map(m => '<li><span>' + esc(m.name) + '</span><em>' + C.fmtHM(m.from) + ' → <b>' + C.fmtHM(m.to) + '</b></em></li>').join('')
          + p.kept.map(k => '<li class="kept"><span><i class="led"></i>' + esc(k.name) + '</span><em>' + C.fmtHM(k.at) + ' · ' + tx('no se mueve') + '</em></li>').join('');
        const cl = p.clashes.length ? '<div class="errbox"><svg class="ic"><use href="#i-alert"/></svg><span>' + p.clashes.map(c => tx('{n} choca con «{w}» ({h}, DELAY rojo)', { n: esc(c.name), w: esc(c.with), h: C.fmtHM(c.at) })).join('<br>') + '</span></div>' : '';
        return head + sum + cl + (rows ? '<ul class="dlist">' + rows + '</ul>' : '<p class="hint">' + tx('No hay nada pendiente que mover con esa selección.') + '</p>');
      },
      bind: () => {
        const n = $('d-n');
        if (n) n.addEventListener('input', () => { const v = Math.round(+n.value); if (v >= 1 && v <= 600) { W.mins = v; SHEET && SHEET.refresh(); } });
        document.querySelectorAll('#sh-b .seg button').forEach(b => b.addEventListener('click', () => { W.all = b.dataset.sc === 'all'; SHEET && SHEET.refresh(); }));
      },
      run: () => {
        const p = plan();
        if (!p.ok || !p.moved.length) return Promise.resolve({ ok: false, msg: tx('Nada que mover') });
        return send('delay', { minutes: W.mins, zones: W.all ? 'all' : [zid || ''], from: W.from, stamp: M.delayStamp(p) });
      },
      reopen: () => openDelay(W.custom ? null : W.mins)
    });
  }

  // ── Chat de Producción en el mando (dec. 104) ─────────────────────────
  // El hilo es el de Producción ↔ Stage Manager: llega entero del Mac (firmado) y se escribe con una orden firmada del mando.
  // Cada mensaje sale firmado «[Zona] Nombre» (el Mac pone la zona según la clave del mando, no el móvil).
  const NKEY = 'showtime.remote.name', CHAT_ON = !!params.q;
  let CHAT = [], CHAT_PEND = [], CHAT_SEEN = null, CHAT_OPEN = false;
  const myPid = LOCK ? 'mando:' + LOCK : 'mando';
  function myName() { try { return localStorage.getItem(NKEY) || ''; } catch (e) { return ''; } }
  function hhmm(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function chatIn(m) {
    const list = Em.cleanChatLog ? Em.cleanChatLog(m) : null; if (!list) return;
    const fresh = list.filter(x => !CHAT.some(y => y.id === x.id));
    CHAT = list;
    CHAT_PEND = CHAT_PEND.filter(p => !fresh.some(x => x.pid === myPid && x.text === p.text));   // ya ha llegado del Mac
    if (CHAT_SEEN === null) CHAT_SEEN = new Set(list.map(x => x.id));   // lo que ya había al conectar no cuenta como nuevo
    else if (fresh.length && !CHAT_OPEN && fresh.some(x => x.pid !== myPid)) $('chat-dot').hidden = false;
    renderChat();
  }
  function renderChat() {
    const box = $('chat-list'); if (!box) return;
    const sig = LOCK ? (zones()[0] || {}).name || tx('Zona') : 'Stage Manager';
    $('chat-sig').textContent = '[' + sig + ']';
    const items = CHAT.map(x => ({ from: x.sm ? 'Stage Manager' : x.from, at: x.at, text: x.text, me: x.pid === myPid, sm: x.sm, pend: false }))
      .concat(CHAT_PEND.map(p => ({ from: '[' + sig + '] ' + (myName() || 'Stage Manager'), at: p.at, text: p.text, me: true, pend: true })));
    const h = items.length ? items.map(x => '<div class="cmsg' + (x.me ? ' me' : '') + (x.sm ? ' sm' : '') + (x.pend ? ' pend' : '') + '"><b>' + esc(x.from) + '<small>' + hhmm(x.at) + '</small></b><span>' + esc(x.text) + '</span></div>').join('')
      : '<p class="csh-empty">' + tx('Sin mensajes todavía. Lo que escribas lo ven el Dashboard y Producción.') + '</p>';
    if (box.dataset.h !== h) { box.innerHTML = h; box.dataset.h = h; box.scrollTop = box.scrollHeight; }
  }
  function renderChatState() { const b = $('chat-form') && $('chat-form').querySelector('.send'); if (b) b.disabled = !live(); }
  function openChat() {
    CHAT_OPEN = true; $('chat-sheet').hidden = false; $('chat-dot').hidden = true;
    $('chat-name').value = myName(); renderChat(); renderChatState();
    if (R && live()) R.command('chatsync', {}).catch(() => {});   // pide el hilo al momento (si no, llega en el siguiente envío)
  }
  function closeChat() { CHAT_OPEN = false; $('chat-sheet').hidden = true; $('chat-text').blur(); }
  $('chat-dot').hidden = true; $('chat-sheet').hidden = true;
  if (!CHAT_ON) $('chat-fab').hidden = true; else document.body.classList.add('has-chat');   // QR del mando anterior (sin la clave de Producción): sin chat
  $('chat-fab').addEventListener('click', openChat);
  $('chat-x').addEventListener('click', closeChat);
  $('chat-sheet').addEventListener('click', e => { if (e.target.id === 'chat-sheet') closeChat(); });
  $('chat-name').addEventListener('change', () => { const v = $('chat-name').value.replace(/\s+/g, ' ').trim().slice(0, 40); $('chat-name').value = v; try { localStorage.setItem(NKEY, v); } catch (e) {} renderChat(); });
  $('chat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('chat-text'), text = inp.value.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text || !live()) return;
    const p = { text, at: Date.now() };
    CHAT_PEND.push(p); inp.value = ''; renderChat();
    let r; try { r = await R.command('chat', { text, name: myName() || null }); } catch (er) { r = { ok: false, msg: String(er && er.message || er) }; }
    if (!r || !r.ok) { CHAT_PEND = CHAT_PEND.filter(x => x !== p); if (!inp.value) inp.value = text; renderChat(); toast(tx('No se ha enviado') + ' · ' + back((r && r.msg) || ''), true); }
  });

  // ── Arranque ─────────────────────────────────────────────────────────
  load();
  Dt.onChange(() => { load(); render(); });
  R = new Em.Receptor({ params, onSnapshot: s => Dt.loadSnapshot(s), onStatus: st => { ST = st; renderRx(); setActs(FEST ? current().band : null, now()); renderChatState(); },
    info: () => ({ v: 'mando', s: LOCK, d: Em.devClass(navigator.userAgent, window.screen && window.screen.width) }),
    onProdMessage: m => chatIn(m) });
  R.start().catch(e => { console.error(e); toast(tx('No se pudo conectar: {e}', { e: e && e.message || e }), true); });
  // Al cambiar de idioma (llega con la emisión) se repinta todo al momento, sin recargar
  if (I18) I18.onChange(() => { ['calls', 'zones', 'band', 'drift', 'flash-cur', 'msg-zl'].forEach(id => { if ($(id)) $(id).dataset.h = ''; }); if (SHEET) { $('sh-b').dataset.h = ''; } render(); });
  // Pantalla que se enciende o red que vuelve: reconectar a fondo y pedir el estado
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') R.wake(); });
  window.addEventListener('online', () => R.wake());
  render();
  setInterval(render, 1000);
  // Pantalla encendida mientras el mando está abierto (si el navegador lo permite)
  let wl = null;
  async function wake() { if (!('wakeLock' in navigator) || wl || document.visibilityState !== 'visible') return; try { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } catch (e) {} }
  document.addEventListener('visibilitychange', wake); document.addEventListener('pointerdown', wake); wake();
  window.ShowtimeRemote = { send, current, chatIn, openChat, LOCK };
})();
