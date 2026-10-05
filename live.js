/* Showtime — live.js · Pantalla Live
 * Lee el festival y la configuración de datos.js; las reglas de tiempo salen de core.js.
 * Sin manejadores en atributos HTML: todo con addEventListener (no hace falta exponer globales).
 */
(function () {
  'use strict';
  const C = window.ShowtimeCore;
  const Dt = window.ShowtimeDatos;
  const $ = id => document.getElementById(id);
  const URLP = new URLSearchParams(location.search);

  // ── Preferencias de ESTA pantalla (otra luz, otro monitor: van aparte del Panel) ──
  const P = {
    zoom: 'showtime.live.zoom', topH: 'showtime.live.topH', topCols: 'showtime.live.topCols',
    stripH: 'showtime.live.stripH', infoW: 'showtime.live.infoW'
  };
  function pget(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function pset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ── Estado (declarado ANTES de cualquier uso: `let` no se eleva) ──────
  let FEST = null, CONFIG = null, BLOCKS = [], CALL_MINS = 15, CALL_DONE = new Set(), DEMO = false;
  let NOFEST = false, DAY_MISSING = '';   // estados que se ENSEÑAN, nunca se corrigen solos
  let TIME_OFFSET = 0;
  let ACCENT = '#e94560', CALLC = '#ffb347';
  const ZOOM_STEPS = [20, 30, 45, 60, 90, 120, 180, 240, 360];
  let zIdx = (() => { const v = pget(P.zoom, 3); return (v >= 0 && v < ZOOM_STEPS.length) ? v : 3; })();
  let VISIBLE = ZOOM_STEPS[zIdx];
  const NX = 64;                 // px desde la izquierda donde va la aguja
  const STRIP_MIN_H = 110;       // alto mínimo legible de una barra
  let STRIP_H = pget(P.stripH, {}) || {};
  let stripCount = 0;

  // ── Utilidades ────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function safeColor(c, d) { return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(String(c || '').trim()) ? String(c).trim() : d; }
  function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
  const pad2 = C.pad2;

  // ── Carga de datos ───────────────────────────────────────────────────
  function load() {
    const stored = Dt.getFestival();
    DEMO = URLP.get('demo') === '1';             // la demo solo se ve si se pide
    if (DEMO) { if (!FEST || !FEST.__demo) { FEST = C.demoFestival(Math.floor(C.nowAbs())); FEST.__demo = true; } }
    else FEST = stored;
    NOFEST = !FEST;

    CONFIG = Dt.getConfig();
    if (URLP.get('estilo')) CONFIG.style = Dt.normStyle(URLP.get('estilo'));
    if (URLP.get('modo')) CONFIG.mode = /^(sc|soundcheck)$/.test(URLP.get('modo')) ? 'sc' : 'show';

    // Día elegido sin datos: se AVISA; no se cambia de día por cuenta propia.
    const day = CONFIG.day || 'all';
    DAY_MISSING = (!NOFEST && day !== 'all' && C.festivalDays(FEST, CONFIG.mode).indexOf(day) < 0) ? day : '';
    BLOCKS = (NOFEST || DAY_MISSING) ? [] : C.buildBlocks(FEST, { mode: CONFIG.mode, day: day });
    CALL_MINS = Dt.callMinsOf(FEST, CONFIG);
    CALL_DONE = new Set(Dt.getCallDone());

    $('evn-name').textContent = NOFEST ? 'SIN EVENTO' : (DEMO ? 'DEMO · ' : '') + ((FEST.event && FEST.event.nombre) || '');
    $('evn-mode').textContent = (CONFIG.mode === 'sc' ? 'SOUNDCHECK' : 'SHOW') + ' · ';
    const msg = NOFEST ? 'SIN EVENTO CARGADO · ábrelo en el Panel de Control'
      : DAY_MISSING ? 'EL ' + fmtDay(DAY_MISSING) + ' NO TIENE ' + (CONFIG.mode === 'sc' ? 'SOUNDCHECKS' : 'SHOWS') + ' · elige otro día'
      : '';
    $('banner').textContent = msg;
    $('banner').hidden = !msg;
    applyStyle(CONFIG.style);
  }

  function fmtDay(iso) {
    const i = C.dayIndex(iso);
    if (i === null) return iso;
    return new Date(Date.UTC(2000, 0, 1) + i * 864e5).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
  }

  function applyStyle(v) {
    v = Dt.normStyle(v);
    if (v === 'clasico') document.body.removeAttribute('data-lv'); else document.body.setAttribute('data-lv', v);
    ACCENT = cssVar('--accent') || '#e94560';
    CALLC = cssVar('--call') || '#ffb347';
  }

  // ── Desplazamiento en el tiempo y zoom ───────────────────────────────
  function setTimeOffset(m) {
    TIME_OFFSET = m;
    $('syncbtn').classList.toggle('off', Math.abs(m) > 0.5);
    const r = Math.round(m), a = Math.abs(r);
    $('offlbl').textContent = r === 0 ? '' : (r > 0 ? '+' : '-') + (a >= 60 ? Math.floor(a / 60) + 'h' + (a % 60 ? ' ' + (a % 60) + 'm' : '') : a + ' min');
    requestAnimationFrame(redraw);
  }
  function zoomLbl() { const m = VISIBLE; return m < 90 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''); }
  function setZoom(d) {
    zIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zIdx + d));
    VISIBLE = ZOOM_STEPS[zIdx];
    pset(P.zoom, zIdx);
    $('zlbl').textContent = zoomLbl();
    $('zmin').disabled = zIdx >= ZOOM_STEPS.length - 1;
    $('zmax').disabled = zIdx <= 0;
    requestAnimationFrame(redraw);
  }

  // ── Dibujo de una barra ──────────────────────────────────────────────
  function drawStrip(cv, block, nowMins, ended) {
    if (!cv) return;
    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

    const pxM = (W - NX) / VISIBLE;
    const leftMins = (nowMins + TIME_OFFSET) - NX / pxM;
    const xOf = m => (m - leftMins) * pxM;

    // Rejilla cada 5 min, etiquetas cada 10
    const startM = Math.ceil(leftMins / 5) * 5;
    for (let mi = startM; mi <= leftMins + VISIBLE + 5; mi += 5) {
      const x = xOf(mi);
      if (x < -2 || x > W + 2) continue;
      const i60 = mi % 60 === 0, i30 = mi % 30 === 0, i15 = mi % 15 === 0, i10 = mi % 10 === 0;
      ctx.strokeStyle = i60 ? 'rgba(255,255,255,.35)' : i30 ? 'rgba(255,255,255,.18)' : i15 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)';
      ctx.lineWidth = i60 ? 2 : i30 ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (i10) {
        ctx.fillStyle = i60 ? '#fff' : i30 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)';
        ctx.font = (i60 ? 'bold 16px ' : i30 ? 'bold 13px ' : '11px ') + FONT;
        ctx.fillText(C.fmtHM(mi), x + 5, i60 ? 22 : i30 ? 18 : 14);
      }
    }

    // Línea de CALL escrita (con su día correcto: callAbs, arreglo ESPEC §8)
    if (block && block.call && block.callAbs !== null && block.callAbs !== undefined) {
      const cx = xOf(block.callAbs);
      if (cx > 0 && cx < W) {
        ctx.save();
        ctx.strokeStyle = CALLC; ctx.globalAlpha = 0.65; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.95; ctx.fillStyle = CALLC;
        ctx.font = 'bold 12px ' + FONT;
        ctx.fillText('CALL ' + C.fmtHM(block.callAbs), cx + 4, H - 8);
        ctx.restore();
      }
    }

    if (block && block.si !== null && block.sf !== null) {
      const x1 = xOf(block.si), x2 = xOf(block.sf);
      const bh = H * 0.52, by = (H - bh) / 2, bw = x2 - x1;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = safeColor(block.color, '#888');
      const r = Math.min(10, bh / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x1, by, bw, bh, r); else ctx.rect(x1, by, bw, bh);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (bw > 50) {
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.font = 'bold 16px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.beginPath(); ctx.rect(Math.max(0, x1) + 8, by, Math.min(W, x2) - Math.max(0, x1) - 16, bh); ctx.clip();
        ctx.fillText(block.name.toUpperCase(), Math.max(x1, 0) + 12, by + bh / 2);
      }
      ctx.restore();
      const dur = Math.max(0, Math.round(block.sf - block.si));
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '11px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(dur + ' min', Math.min(W - 6, x2 - 2), by - 4);
      ctx.textAlign = 'left';
    } else if (!ended) {
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.font = '14px ' + FONT;
      ctx.textBaseline = 'middle';
      ctx.fillText('Sin evento', NX + 16, H / 2);
    }

    // Aguja en «ahora»
    const nx = xOf(nowMins);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5;
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(nx, 10, 7, 0, Math.PI * 2); ctx.fill();
  }

  // ── Panel de información de cada barra ──────────────────────────────
  function setInfo(i, block, label) {
    const s = document.querySelector('.strip[data-i="' + i + '"]');
    if (!s) return;
    s.querySelector('.lbl').textContent = label;
    const nm = s.querySelector('.aname'), tm = s.querySelector('.atime'), nt = s.querySelector('.anotes'), cl = s.querySelector('.acall');
    if (!block) { nm.textContent = '—'; tm.textContent = ''; nt.textContent = ''; cl.hidden = true; return; }
    nm.textContent = block.name.toUpperCase();
    tm.textContent = C.fmtHM(block.si) + '–' + C.fmtHM(block.sf);
    if (block.stage) {
      tm.appendChild(document.createTextNode('  ·  '));
      const sp = document.createElement('span');
      sp.className = 'astage';
      sp.style.color = safeColor(block.stageColor || block.color, '#888');
      sp.textContent = block.stage.toUpperCase();
      tm.appendChild(sp);
    }
    nt.textContent = block.notes || '';
    if (block.call && block.callAbs !== null) {
      cl.hidden = false;
      cl.querySelector('span').textContent = 'CALL ' + C.fmtHM(block.callAbs);
    } else cl.hidden = true;
  }

  // ── Barras dinámicas ─────────────────────────────────────────────────
  function visibleCount() { const h = $('bot').clientHeight; return Math.max(1, Math.floor(h / STRIP_MIN_H)); }

  function buildStrips(n) {
    const bot = $('bot');
    bot.innerHTML = '';
    const baseH = Math.max(STRIP_MIN_H, Math.floor(bot.clientHeight / Math.max(1, n)));
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'strip' + (i === 0 ? ' first' : '');
      s.dataset.i = i;
      s.innerHTML =
        '<div class="info">' +
          '<div class="ihead"><span class="lbl"></span><span class="acall" hidden><svg class="ic"><use href="#i-bell"/></svg><span></span></span></div>' +
          '<div class="aname">—</div><div class="atime"></div><div class="anotes"></div>' +
        '</div>' +
        '<div class="drag-handle" title="Arrastra para cambiar el ancho"></div>' +
        '<div class="cvsw"><canvas></canvas></div>' +
        '<div class="striph" title="Arrastra para ajustar el alto; doble clic: automático"></div>';
      // Alto FIJO: agrandar una barra empuja a las demás y aparece scroll.
      s.style.flex = '0 0 ' + (STRIP_H[i] || baseH) + 'px';
      bot.appendChild(s);
      s.querySelector('.drag-handle').addEventListener('pointerdown', startInfoResize);
      const h = s.querySelector('.striph');
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const startY = e.clientY, startH = s.getBoundingClientRect().height;
        drag(h, e, ev => {
          const nh = Math.max(60, startH + (ev.clientY - startY));
          s.style.flex = '0 0 ' + nh + 'px'; STRIP_H[i] = Math.round(nh);
          requestAnimationFrame(redraw);
        }, () => { pset(P.stripH, STRIP_H); requestAnimationFrame(redraw); });
      });
      h.addEventListener('dblclick', e => {
        e.preventDefault(); e.stopPropagation();
        delete STRIP_H[i]; pset(P.stripH, STRIP_H); buildStrips(stripCount); tick();
      });
    }
    stripCount = n;
  }

  /** Arrastre con puntero (ratón, dedo o lápiz). */
  function drag(handle, e, onMove, onEnd) {
    handle.classList.add('active');
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    function mv(ev) { onMove(ev); }
    function up() {
      handle.classList.remove('active');
      handle.removeEventListener('pointermove', mv);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (onEnd) onEnd();
    }
    handle.addEventListener('pointermove', mv);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function startInfoResize(e) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--info-w')) || 340;
    drag(e.currentTarget, e, ev => {
      const w = Math.max(120, Math.min(window.innerWidth * 0.72, startW + (ev.clientX - startX)));
      document.documentElement.style.setProperty('--info-w', w + 'px');
      requestAnimationFrame(redraw);
    }, () => {
      pset(P.infoW, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--info-w')));
    });
  }

  // ── Paneles de arriba ────────────────────────────────────────────────
  function stageHtml(name, col) {
    return name ? '&nbsp;&nbsp;&middot;&nbsp;&nbsp;<span class="tstage" style="color:' + col + '">' + esc(name.toUpperCase()) + '</span>' : '';
  }

  /** Cuenta atrás: mm:ss por debajo de una hora; si no, 1h 05m. */
  function fmtCountdown(mins) {
    const s = Math.max(0, Math.ceil(mins * 60));
    if (s >= 3600) { const m = Math.floor(s / 60); return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm'; }
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  // EN ESCENA: banda que suena (con minutos restantes)
  function playingHtml(b, nowInt) {
    const col = safeColor(b.stageColor || b.color, '#888');
    const p = C.progress(b, nowInt);
    return '<div class="trow" style="--c:' + col + '"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' +
      '<div class="tmeta">' + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + stageHtml(b.stage, col) + '</div>' +
      '<div class="trem" style="color:' + col + '">' + (p.remaining > 0 ? p.remaining + ' min restantes' : 'Finalizado') + '</div>' +
      '<div class="tbar"><div style="width:' + p.pct + '%;background:' + col + '"></div></div></div>';
  }

  // EN ESCENA: escenario en cambio (o en STANDBY si el regidor lo ha marcado), banda que entra y cuenta atrás
  function changeoverHtml(co) {
    const col = safeColor(co.stageColor || co.next.color, '#888');
    const sb = co.standby;
    return '<div class="trow co' + (sb ? ' sb' : '') + '" style="--c:' + col + '">' +
      '<div class="tname"><svg class="ic"><use href="' + (sb ? '#i-pause' : '#i-swap') + '"/></svg>' + (sb ? 'STANDBY' : 'CHANGEOVER') + '</div>' +
      (co.stage ? '<div class="tmeta"><span class="tstage" style="color:' + col + '">' + esc(co.stage.toUpperCase()) + '</span></div>' : '') +
      '<div class="tmeta entra">' + (sb ? 'después' : 'entra') + ' <b>' + esc(co.next.name.toUpperCase()) + '</b>&nbsp;&nbsp;&middot;&nbsp;&nbsp;' + C.fmtHM(co.next.si) + '</div>' +
      '<div class="trem">quedan ' + fmtCountdown(co.remaining) + '</div>' +
      '<div class="tbar"><div style="width:' + co.pct + '%;background:' + col + '"></div></div></div>';
  }

  // SIGUIENTE: tres líneas — nombre / horario · escenario / píldora de cambio (o standby)
  function nextHtml(b) {
    const col = safeColor(b.stageColor || b.color, '#888');
    const co = C.changeoverBefore(BLOCKS, b);
    let badge = '';
    if (co) badge = co.mins < 0
      ? '<div class="tbadge warn"><svg class="ic"><use href="#i-swap"/></svg>Solapa: ' + (-co.mins) + ' min</div>'
      : b.standby
        ? '<div class="tbadge sb"><svg class="ic"><use href="#i-pause"/></svg>Standby: ' + co.mins + ' min</div>'
        : '<div class="tbadge"><svg class="ic"><use href="#i-swap"/></svg>Cambio: ' + co.mins + ' min</div>';
    return '<div class="trow" style="--c:' + col + '"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' +
      '<div class="tmeta">' + C.fmtHM(b.si) + '–' + C.fmtHM(b.sf) + stageHtml(b.stage, col) + '</div>' + badge + '</div>';
  }

  /** Orden de escenarios: el del festival; sin escenario, al final. */
  function stageOrder(stageId) {
    const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === stageId);
    return i < 0 ? 999 : i;
  }

  function renderTopPanels(nowMins, nowInt, ended) {
    const playing = C.playingNow(BLOCKS, nowInt).map(b => ({ o: stageOrder(b.stageId), h: playingHtml(b, nowInt) }));
    const changing = C.changeoversNow(BLOCKS, nowMins).map(co => ({ o: stageOrder(co.stageId), h: changeoverHtml(co) }));
    const scene = playing.concat(changing).sort((a, b) => a.o - b.o);   // sort estable: misma posición, primero el que suena
    const next = C.nextPerStage(BLOCKS, nowInt);
    const calls = C.callList(BLOCKS, nowInt, CALL_MINS, CALL_DONE);
    const fin = '<div class="tempty fin">FIN DE JORNADA</div>', none = '<div class="tempty">—</div>';
    const empty = NOFEST ? '<div class="tempty fin">SIN EVENTO CARGADO</div>' : DAY_MISSING ? '<div class="tempty fin">DÍA SIN DATOS</div>' : (ended ? fin : none);
    $('now-list').innerHTML = scene.length ? scene.map(x => x.h).join('') : empty;
    $('next-list').innerHTML = next.length ? next.map(nextHtml).join('') : none;
    $('call-list').innerHTML = calls.map(b => {
      const col = safeColor(b.stageColor || b.color, CALLC);
      const falta = Math.max(1, Math.round(b.si - nowInt));
      return '<div class="trow callrow" style="--c:' + col + '"><div class="callmain">' +
        '<div class="tname fit" style="color:' + col + '">' + esc(b.name.toUpperCase()) + '</div>' +
        (b.stage ? '<div class="tmeta"><span class="tstage" style="color:' + col + '">' + esc(b.stage.toUpperCase()) + '</span></div>' : '') +
        '<div class="trem" style="color:' + col + '">en ' + falta + ' min &middot; ' + C.fmtHM(b.si) + '</div>' +
        '</div><button class="callok" data-ck="' + esc(C.callKey(b)) + '" title="Marcar como avisado">OK</button></div>';
    }).join('');
    $('panel-call').classList.toggle('hot', calls.length > 0);
    fitNames();
  }

  /** Nombres en 2 líneas como máximo: si no caben (o una palabra no cabe en el ancho),
   *  se reduce la letra por pasos hasta el 45 %. Solo maquetación, no cambia ningún dato.
   *  Se mide con el texto SIN recortar (clase .measuring) y se cuentan las líneas reales. */
  function fitNames() {
    document.querySelectorAll('#top .tname.fit').forEach(el => {
      el.classList.add('measuring');
      el.style.overflowWrap = '';
      const fits = () => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 1;
        return el.scrollHeight <= lh * 2 + 2 && el.scrollWidth <= el.clientWidth + 1;
      };
      let s = 1;
      el.style.setProperty('--fs', s);
      while (s > 0.45 && !fits()) { s = Math.round((s - 0.05) * 100) / 100; el.style.setProperty('--fs', s); }
      // Último recurso (una sola palabra enorme): partirla antes que cortarla.
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = 'anywhere';
      el.classList.remove('measuring');
    });
  }

  // ── Bucle principal ──────────────────────────────────────────────────
  function tick() {
    const d = new Date();
    const nowMins = C.nowAbs(d), nowInt = Math.floor(nowMins);
    $('clk').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    $('dat').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

    const n = visibleCount();
    if (n !== stripCount) buildStrips(n);
    const r = C.pickBlocks(BLOCKS, nowInt, n);
    r.list.forEach((b, i) => {
      setInfo(i, b, r.ended ? (i === 0 ? 'FIN DE JORNADA' : '') : C.stripLabel(i, r.playing));
      const cv = document.querySelector('.strip[data-i="' + i + '"] canvas');
      drawStrip(cv, b, nowMins, r.ended);
    });
    renderTopPanels(nowMins, nowInt, r.ended);
  }

  function redraw() {
    const nowMins = C.nowAbs(), nowInt = Math.floor(nowMins);
    const r = C.pickBlocks(BLOCKS, nowInt, stripCount || visibleCount());
    r.list.forEach((b, i) => drawStrip(document.querySelector('.strip[data-i="' + i + '"] canvas'), b, nowMins, r.ended));
  }

  // ── Interacción ──────────────────────────────────────────────────────
  // OK de CALL: se guarda (no vuelve al recargar) y se avisa a las demás ventanas.
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.callok');
    if (!btn || !btn.dataset.ck) return;
    CALL_DONE = new Set(Dt.markCallDone(btn.dataset.ck, Math.floor(C.nowAbs())));
    tick();
  });

  // Desplazamiento en el tiempo: arrastrar en horizontal sobre las barras (ratón o dedo), o rueda.
  (function initTimeScroll() {
    const bot = $('bot');
    bot.addEventListener('pointerdown', e => {
      if (e.target.closest('.striph, .drag-handle, button, input')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const startX = e.clientX, startOff = TIME_OFFSET;
      const pxM = () => { const cv = bot.querySelector('canvas'); return cv ? Math.max(1, cv.clientWidth - NX) / VISIBLE : 10; };
      function mv(ev) {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 3) bot.classList.add('dragging');
        setTimeOffset(startOff - dx / pxM());
      }
      function up() {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        bot.classList.remove('dragging');
      }
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
    bot.addEventListener('wheel', e => {
      const horiz = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horiz) return;
      e.preventDefault();
      setTimeOffset(TIME_OFFSET + (e.shiftKey ? e.deltaY : e.deltaX) * (VISIBLE / 600));
    }, { passive: false });
  })();

  // Divisores verticales de arriba (reloj | en escena | siguiente | call)
  (function initTopCols() {
    const clk = $('clkbox'), now = $('panel-now'), nxt = $('panel-next'), cal = $('panel-call');
    const w = pget(P.topCols, null);
    if (w) { if (w.clk) clk.style.flex = '0 0 ' + w.clk + 'px'; if (w.now) now.style.flex = '0 0 ' + w.now + 'px'; if (w.nxt) nxt.style.flex = '0 0 ' + w.nxt + 'px'; }
    document.querySelectorAll('.vsplit').forEach(sp => {
      sp.addEventListener('pointerdown', e => {
        e.preventDefault();
        const which = sp.dataset.vs;
        const left = which === '0' ? clk : which === '1' ? now : nxt;
        const right = which === '0' ? now : which === '1' ? nxt : cal;
        const startX = e.clientX, lw = left.getBoundingClientRect().width, rw = right.getBoundingClientRect().width;
        drag(sp, e, ev => {
          const dd = ev.clientX - startX, nl = lw + dd, nr = rw - dd;
          if (nl <= 120 || nr <= 120) return;
          left.style.flex = '0 0 ' + nl + 'px';
          right.style.flex = which === '2' ? '1 1 0' : '0 0 ' + nr + 'px';
        }, () => pset(P.topCols, {
          clk: Math.round(clk.getBoundingClientRect().width),
          now: Math.round(now.getBoundingClientRect().width),
          nxt: nxt.style.flex.indexOf('0 0') === 0 ? Math.round(nxt.getBoundingClientRect().width) : 0
        }));
      });
    });
  })();

  // Divisor horizontal: alto de la parte de arriba
  (function initHSplit() {
    const sp = $('hsplit');
    const saved = parseInt(pget(P.topH, 0));
    if (saved >= 90) document.documentElement.style.setProperty('--top-h', saved + 'px');
    sp.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startY = e.clientY, startH = $('top').getBoundingClientRect().height;
      drag(sp, e, ev => {
        const h = Math.max(90, Math.min(window.innerHeight - STRIP_MIN_H - 20, startH + (ev.clientY - startY)));
        document.documentElement.style.setProperty('--top-h', h + 'px');
        pset(P.topH, Math.round(h));
        requestAnimationFrame(tick);
      }, () => requestAnimationFrame(tick));
    });
  })();

  // Ancho guardado del panel de información
  (function () { const w = parseInt(pget(P.infoW, 0)); if (w >= 120) document.documentElement.style.setProperty('--info-w', w + 'px'); })();

  // Botones
  $('syncbtn').addEventListener('click', () => setTimeOffset(0));
  // Como en Stage Master: «+» = más minutos visibles, «−» = menos.
  $('zmin').addEventListener('click', () => setZoom(1));
  $('zmax').addEventListener('click', () => setZoom(-1));
  if (window.opener) { $('close').hidden = false; $('close').addEventListener('click', () => window.close()); }

  // Pantalla completa (botón o tecla F)
  function toggleFull() {
    const d = document;
    if (!d.fullscreenElement) { const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el); }
    else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  $('fullbtn').addEventListener('click', toggleFull);
  document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) toggleFull(); });
  document.addEventListener('fullscreenchange', () => {
    $('fullbtn').querySelector('use').setAttribute('href', document.fullscreenElement ? '#i-unfull' : '#i-full');
    requestAnimationFrame(tick);
  });

  // Pantalla siempre encendida (Wake Lock). Si el navegador no lo permite, no pasa nada.
  let wakeLock = null;
  async function requestWake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      $('wake').hidden = false;
      wakeLock.addEventListener('release', () => { wakeLock = null; $('wake').hidden = true; });
    } catch (e) { $('wake').hidden = true; }
  }
  document.addEventListener('visibilitychange', requestWake);
  document.addEventListener('pointerdown', requestWake);   // por si el navegador exige un gesto
  requestWake();

  // Cambios desde el Panel de Control (o desde otra Live)
  Dt.onChange(() => { load(); tick(); });
  window.ShowtimeLive = { applyStyle: v => { applyStyle(v); tick(); }, reload: () => { load(); tick(); } };

  // ── Arranque ─────────────────────────────────────────────────────────
  load();
  setZoom(0);
  tick();
  setInterval(tick, 1000);
  window.addEventListener('resize', () => requestAnimationFrame(tick));
  if (window.opener || !Dt.getFestival()) Dt.hello();   // pide los datos al Panel que la abrió (o a uno abierto)
})();
