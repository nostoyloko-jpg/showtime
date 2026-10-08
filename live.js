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
  // ── Vista de esta ventana (2e-A): manager · confidence · backstage (?vista=…; tecla V para rotar) ──
  const Vs = window.ShowtimeVistas;
  // Producción: el enlace lleva «&id=…». Solo ve Manager y Backstage y tiene sus mandos (OK de CALL, mensajes).
  const _EM = window.ShowtimeEmision, _HP = _EM && _EM.parseHash(location.hash), PRODID = _HP && _HP.id ? _HP.id : null;
  const vistaOk = v => PRODID ? Vs.normProdVista(v) : Vs.normVista(v);
  const Mk = window.ShowtimeMarca;
  // Standby (Modo Cartel): «vista=standby&prev=<vista>»; debajo sigue la vista de antes
  let STANDBY = !!(Mk && Mk.isStandby(location.search));
  let VISTA = vistaOk(STANDBY ? Mk.prevVista(location.search) : URLP.get('vista'));
  let ZONA = URLP.has('zona') ? URLP.get('zona') : null;   // zona de Confidence (null = sin elegir)

  // ── Preferencias de ESTA pantalla (otra luz, otro monitor: van aparte del Panel) ──
  const P = {
    zoom: 'showtime.live.zoom', topH: 'showtime.live.topH', topCols: 'showtime.live.topCols',
    stripH: 'showtime.live.stripH', infoW: 'showtime.live.infoW', rowH: 'showtime.live.rowH'
  };
  function pget(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function pset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ── Estado (declarado ANTES de cualquier uso: `let` no se eleva) ──────
  let FEST = null, CONFIG = null, BLOCKS = [], HITOS = [], ALLB = [], MARG = {}, CALL_MINS = 15, CALL_DONE = new Set(), DEMO = false;
  const VIEW_TXT = { all: ['JORNADA COMPLETA', 'ENTRADAS'], show: ['SHOW', 'SHOWS'], sc: ['SOUNDCHECK', 'SOUNDCHECKS'] };
  let NOFEST = false, DAY_MISSING = '';   // estados que se ENSEÑAN, nunca se corrigen solos
  let TIME_OFFSET = 0;
  let ACCENT = '#e94560', CALLC = '#ffb347';
  const ZOOM_STEPS = [20, 30, 45, 60, 90, 120, 180, 240, 360];
  let zIdx = (() => { const v = pget(P.zoom, 3); return (v >= 0 && v < ZOOM_STEPS.length) ? v : 3; })();
  let VISIBLE = ZOOM_STEPS[zIdx];
  const NX = 64;                 // px desde la izquierda donde va la aguja
  const STRIP_MIN_H = 110;       // alto de una barra en automático (luego cada una se ajusta a mano)
  // Alto de TODAS las filas (− / +). 0 = automático (reparte el alto con filas de al menos 110 px).
  const ROW_STEPS = [44, 56, 70, 90, 110, 140, 180, 230];
  let ROW_H = (() => { const v = parseInt(pget(P.rowH, 0)); return ROW_STEPS.indexOf(v) >= 0 ? v : 0; })();
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
    if (URLP.get('modo')) CONFIG.mode = /^(sc|soundcheck)$/.test(URLP.get('modo')) ? 'sc' : /^(all|jornada|todo)$/.test(URLP.get('modo')) ? 'all' : 'show';
    const vt = VIEW_TXT[CONFIG.mode] || VIEW_TXT.show;

    // Día elegido sin datos: se AVISA; no se cambia de día por cuenta propia.
    const day = CONFIG.day || 'all';
    DAY_MISSING = (!NOFEST && day !== 'all' && C.festivalDays(FEST, CONFIG.mode).indexOf(day) < 0) ? day : '';
    BLOCKS = (NOFEST || DAY_MISSING) ? [] : C.buildBlocks(FEST, { mode: CONFIG.mode, day: day });
    // Hitos (puertas, curfew…): líneas de referencia en cualquier vista
    HITOS = (NOFEST || !C.hitosOf) ? [] : C.hitosOf(FEST, day);
    ALLB = NOFEST ? [] : C.buildBlocks(FEST, { mode: 'all', day: day });   // para desfases y márgenes (todas las categorías)
    CALL_MINS = Dt.callMinsOf(FEST, CONFIG);
    CALL_DONE = new Set(Dt.getCallDone());

    $('evn-name').textContent = NOFEST ? 'SIN EVENTO' : (DEMO ? 'DEMO · ' : '') + ((FEST.event && FEST.event.nombre) || '');
    $('evn-mode').textContent = vt[0] + ' · ';
    const msg = NOFEST ? (Dt.READONLY ? 'ESPERANDO LOS DATOS DE LA SALA…' : 'SIN EVENTO CARGADO · ábrelo en el Dashboard')
      : DAY_MISSING ? 'EL ' + fmtDay(DAY_MISSING) + ' NO TIENE ' + vt[1] + ' · elige otro día'
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
    $('docktag').textContent = $('offlbl').textContent;     // plegado, se sigue viendo que está desplazada
    requestAnimationFrame(tick);
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
  /** Color de un hito según su margen con el retraso actual (sin palabras mágicas: solo cuenta la hora). */
  function hitoColor(h) { const m = MARG[h.key]; return !m ? 'rgba(255,255,255,.85)' : m.level === 'over' ? '#ff3b30' : m.level === 'tight' ? CALLC : 'rgba(255,255,255,.85)'; }
  function hitoTag(h) { const m = MARG[h.key]; return !m || m.level === 'ok' ? '' : m.level === 'over' ? '  ·  REBASADO +' + (-m.margin) + ' MIN' : '  ·  MARGEN ' + m.margin + ' MIN'; }

  /** Hitos: línea vertical en todas las barras; en la primera, la píldora «19:30 PUERTAS». */
  function drawHitos(ctx, W, H, xOf, withPill, FONT) {
    HITOS.forEach(h => {
      const x = xOf(h.si);
      if (x < -200 || x > W + 2) return;
      const col = hitoColor(h);
      ctx.save();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.8; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.restore();
      if (!withPill) return;
      const txt = C.fmtHM(h.si) + '  ' + h.name.toUpperCase() + hitoTag(h);
      ctx.save();
      ctx.font = 'bold 13px ' + FONT;
      const tw = ctx.measureText(txt).width, pw = tw + 26, ph = 22, py = 3;   // arriba, en la cabecera (tapa la hora de la rejilla junto a ella)
      let px = x - 1;
      if (px + pw > W - 4) px = Math.max(4, x - pw + 1);           // cerca del borde: la píldora a la izquierda de la línea
      ctx.fillStyle = col; ctx.globalAlpha = 0.95;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 11); else ctx.rect(px, py, pw, ph);
      ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = col === '#ff3b30' ? '#fff' : '#0b0c0f'; ctx.textBaseline = 'middle';
      // banderita
      ctx.beginPath(); ctx.moveTo(px + 9, py + 5); ctx.lineTo(px + 9, py + ph - 5); ctx.moveTo(px + 9, py + 5); ctx.lineTo(px + 16, py + 8); ctx.lineTo(px + 9, py + 11);
      ctx.strokeStyle = col === '#ff3b30' ? '#fff' : '#0b0c0f'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillText(txt, px + 20, py + ph / 2 + 1);
      ctx.restore();
    });
  }

  function drawStrip(cv, block, nowMins, ended, idx) {
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

    // Barra baja (muchas filas): rejilla con menos texto y la barra ocupando casi todo el alto
    const compact = H < 72;
    // Rejilla cada 5 min, etiquetas cada 10 (en compacto, solo las medias y las horas)
    const startM = Math.ceil(leftMins / 5) * 5;
    // Etiquetas solo si caben (pantallas estrechas, p. ej. el móvil): cada 10, cada 30 o cada hora
    const lstep = Math.max(compact ? 30 : 10, pxM * 10 >= 46 ? 10 : pxM * 30 >= 46 ? 30 : 60);
    for (let mi = startM; mi <= leftMins + VISIBLE + 5; mi += 5) {
      const x = xOf(mi);
      if (x < -2 || x > W + 2) continue;
      const i60 = mi % 60 === 0, i30 = mi % 30 === 0, i15 = mi % 15 === 0, i10 = mi % 10 === 0;
      ctx.strokeStyle = i60 ? 'rgba(255,255,255,.35)' : i30 ? 'rgba(255,255,255,.18)' : i15 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)';
      ctx.lineWidth = i60 ? 2 : i30 ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (mi % lstep === 0) {
        ctx.fillStyle = i60 ? '#fff' : i30 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)';
        ctx.font = (compact ? (i60 ? 'bold 11px ' : '10px ') : i60 ? 'bold 16px ' : i30 ? 'bold 13px ' : '11px ') + FONT;
        ctx.fillText(C.fmtHM(mi), x + 4, compact ? 10 : i60 ? 22 : i30 ? 18 : 14);
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

    if (block && block.si !== null && (block.sf !== null || block.kind === 'tarea')) {
      const task = block.kind === 'tarea';
      const end = C.blockEnd(block);
      const x1 = xOf(block.si), x2 = xOf(end);
      const bh = compact ? Math.max(12, H - 22) * (task ? 0.8 : 1) : H * (task ? 0.36 : 0.52);
      const by = compact ? 14 + (Math.max(12, H - 22) - bh) / 2 : (H - bh) / 2, bw = x2 - x1;
      const col = safeColor(task ? (block.stageColor || '#7dd3fc') : block.color, '#888');
      ctx.save();
      const r = Math.min(10, bh / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x1, by, bw, bh, r); else ctx.rect(x1, by, bw, bh);
      if (task) {
        // Tarea: barra más fina, contorno y relleno suave (operativa, no actuación)
        ctx.globalAlpha = 0.22; ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
      } else { ctx.globalAlpha = 0.92; ctx.fillStyle = col; ctx.fill(); }
      ctx.globalAlpha = 1;
      if (bw > 50) {
        ctx.fillStyle = task ? col : 'rgba(255,255,255,.95)';
        ctx.font = 'bold ' + (compact ? 12 : task ? 14 : 16) + 'px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.beginPath(); ctx.rect(Math.max(0, x1) + 8, by, Math.min(W, x2) - Math.max(0, x1) - 16, bh); ctx.clip();
        ctx.fillText((task ? 'TAREA · ' : block.kind === 'sc' && CONFIG.mode === 'all' ? 'SOUNDCHECK · ' : '') + block.name.toUpperCase(), Math.max(x1, 0) + 12, by + bh / 2);
      }
      ctx.restore();
      const dur = Math.max(0, Math.round(end - block.si));
      if (!compact) {
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.font = '11px ' + FONT;
        ctx.textAlign = 'right';
        ctx.fillText(dur + ' min', Math.min(W - 6, x2 - 2), by - 4);
        ctx.textAlign = 'left';
      }
    } else if (!ended) {
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.font = '14px ' + FONT;
      ctx.textBaseline = 'middle';
      if (!compact) ctx.fillText('Sin evento', NX + 16, H / 2);
    }

    drawHitos(ctx, W, H, xOf, idx === 0, FONT);

    // Aguja en «ahora»
    const nx = xOf(nowMins);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5;
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(nx, compact ? 5 : 10, compact ? 4 : 7, 0, Math.PI * 2); ctx.fill();
  }

  // ── Panel de información de cada barra ──────────────────────────────
  function setInfo(i, block, label) {
    const s = document.querySelector('.strip[data-i="' + i + '"]');
    if (!s) return;
    s.querySelector('.lbl').textContent = label;
    const nm = s.querySelector('.aname'), tm = s.querySelector('.atime'), nt = s.querySelector('.anotes'), cl = s.querySelector('.acall');
    if (!block) { nm.textContent = '—'; tm.textContent = ''; nt.textContent = ''; cl.hidden = true; s.classList.remove('task'); return; }
    nm.textContent = block.name.toUpperCase();
    s.classList.toggle('task', block.kind === 'tarea');
    tm.textContent = (block.kind === 'sc' && CONFIG.mode === 'all' ? 'SOUNDCHECK  ·  ' : '') + C.fmtHM(block.si) + '–' + C.fmtHM(C.blockEnd(block));
    if (block.stage) {
      tm.appendChild(document.createTextNode('  ·  '));
      const sp = document.createElement('span');
      sp.className = 'astage';
      sp.style.color = safeColor(block.stageColor || block.color, '#888');
      sp.textContent = block.stage.toUpperCase();
      tm.appendChild(sp);
    }
    nt.textContent = block.notes || '';
    if (block.alargar && block.rf === null) {
      const xo = xtraOver(block, Math.floor(C.nowAbs()));
      nt.textContent = (xo !== null ? 'TIEMPO EXTRA · +' + xo + ' MIN' : 'TIEMPO EXTRA') + (block.notes ? '  ·  ' + block.notes : '');
    }
    if (block.kind === 'tarea' && C.isPlaying(block, Math.floor(C.nowAbs()))) {
      const p = C.progress(block, Math.floor(C.nowAbs()));
      nt.textContent = 'quedan ' + p.remaining + ' min' + (block.notes ? '  ·  ' + block.notes : '');
    }
    if (block.call && block.callAbs !== null) {
      cl.hidden = false;
      cl.querySelector('span').textContent = 'CALL ' + C.fmtHM(block.callAbs);
    } else cl.hidden = true;
  }

  // ── Barras dinámicas ─────────────────────────────────────────────────
  /** Filas que llenan la pantalla (para no dejar huecos): según el alto elegido o el automático. */
  function autoCount() { if (VISTA === 'backstage') return 2; const h = $('bot').clientHeight; return Math.max(1, Math.floor(h / (ROW_H || STRIP_MIN_H))); }
  /** Alto actual de una fila (el elegido o el automático). */
  function curRowH() { const h = $('bot').clientHeight; if (VISTA === 'backstage') return Math.max(60, Math.floor(h / 2)); return ROW_H || Math.max(STRIP_MIN_H, Math.floor(h / autoCount())); }
  /** − / +: un paso más bajo o más alto para todas las filas por igual. */
  function stepRowH(dir) {
    const cur = curRowH();
    const next = dir > 0 ? ROW_STEPS.find(v => v > cur) : ROW_STEPS.slice().reverse().find(v => v < cur);
    if (next) setRowH(next);
  }
  function setRowH(v) {
    ROW_H = ROW_STEPS.indexOf(v) >= 0 ? v : 0;
    pset(P.rowH, ROW_H);
    STRIP_H = {}; pset(P.stripH, STRIP_H);          // fuera los altos a mano: todas iguales
    $('rlbl').textContent = ROW_H ? 'alto ' + ROW_H : 'alto auto';
    $('rmin').disabled = curRowH() <= ROW_STEPS[0];
    $('rmax').disabled = curRowH() >= ROW_STEPS[ROW_STEPS.length - 1];
    buildStrips(visibleCount()); tick();
  }
  /** Una barra por cada entrada que queda (todo el horario, como siempre), al menos las que llenan el alto.
   *  Las que ya terminaron salen y las demás suben solas. Si no caben, la lista hace scroll. */
  function visibleCount() {
    if (VISTA === 'backstage') return 2;                  // Backstage: banda actual y siguiente
    const at = Math.floor(C.nowAbs()) + Math.round(TIME_OFFSET);
    const left = C.pickBlocks(BLOCKS, at, 500).list.filter(Boolean).length;
    return Math.max(autoCount(), left);
  }

  function buildStrips(n) {
    const bot = $('bot');
    bot.innerHTML = '';
    const baseH = curRowH();
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
  /** Cuenta atrás: mm:ss por debajo de una hora; si no, 1h 05m. */
  function fmtCountdown(mins) {
    const s = Math.max(0, Math.ceil(mins * 60));
    if (s >= 3600) { const m = Math.floor(s / 60); return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm'; }
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  /** Tarjetas de arriba: tipo y horario en una línea, escenario completo en otra (todo fluye, sin «…»). */
  const KIND_CARD = { show: 'SHOW', sc: 'SOUNDCHECK', tarea: 'TAREA' };
  function metaHtml(b, col) {
    const k = b.kind || 'show';
    return '<div class="tmeta tkline"><span class="tkind ' + k + '">' + (KIND_CARD[k] || 'SHOW') + '</span>&nbsp;&nbsp;&middot;&nbsp;&nbsp;' +
      C.fmtHM(b.si) + '–' + C.fmtHM(C.blockEnd(b)) + '</div>' +
      (b.stage ? '<div class="tmeta"><span class="tstage" style="color:' + col + '">' + esc(b.stage.toUpperCase()) + '</span></div>' : '');
  }

  /** Minutos de tiempo extra (activado y pasada su hora), o null. */
  function xtraOver(b, now) { return b && b.alargar && b.rf === null && b.nf !== null && b.nf !== undefined && now >= b.nf ? Math.max(0, Math.floor(now - b.nf)) : null; }
  // EN ESCENA: banda que suena (con minutos restantes)
  function playingHtml(b, nowInt) {
    const col = safeColor(b.stageColor || b.color, '#888');
    const p = C.progress(b, nowInt), xo = xtraOver(b, nowInt), xt = b.alargar && b.rf === null;
    if (xo !== null) return '<div class="trow xtra" style="--c:' + col + '"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' +
      metaHtml(b, col) +
      '<div class="trem xtra">TIEMPO EXTRA · +' + xo + ' MIN</div>' +
      '<div class="tbar"><div style="width:100%;background:#ffb347"></div></div></div>';
    return '<div class="trow" style="--c:' + col + '"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' +
      metaHtml(b, col) +
      '<div class="trem" style="color:' + col + '">' + (p.remaining > 0 ? p.remaining + ' min restantes' : 'Finalizado') + (xt ? '<span class="xtag">TIEMPO EXTRA</span>' : '') + '</div>' +
      '<div class="tbar"><div style="width:' + p.pct + '%;background:' + col + '"></div></div></div>';
  }

  // «después: BANDA · hh:mm» (la próxima banda de la zona)
  function despuesHtml(nb) {
    return nb ? '<div class="tmeta entra">después <b>' + esc(nb.name.toUpperCase()) + '</b>&nbsp;&nbsp;&middot;&nbsp;&nbsp;' + C.fmtHM(nb.si) + '</div>' : '';
  }

  // EN ESCENA: tarea en curso (operativa del día, solo en Jornada completa). Manda sobre el hueco de su zona (decisión 76)
  function taskHtml(b, nowInt) {
    const p = C.progress(b, nowInt);
    return '<div class="trow tarea"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' + metaHtml(b, '#7dd3fc') +
      despuesHtml(C.nextBandIn(BLOCKS, b.stageId, nowInt)) +
      '<div class="trem" style="color:#7dd3fc">quedan ' + p.remaining + ' min</div></div>';
  }

  // EN ESCENA: hueco de una zona. CHANGEOVER solo entre dos bandas distintas seguidas; STANDBY si el regidor lo marca;
  // si no, «— SIN ACTIVIDAD —» con la banda que viene (decisión 76)
  function changeoverHtml(co) {
    const col = safeColor(co.stageColor || co.next.color, '#888');
    const sb = co.standby, idle = !sb && co.kind === 'idle';
    const stage = co.stage ? '<div class="tmeta"><span class="tstage" style="color:' + col + '">' + esc(co.stage.toUpperCase()) + '</span></div>' : '';
    if (idle) return '<div class="trow co idle" style="--c:' + col + '"><div class="tname">— SIN ACTIVIDAD —</div>' + stage +
      despuesHtml(co.next) + '</div>';
    return '<div class="trow co' + (sb ? ' sb' : '') + '" style="--c:' + col + '">' +
      '<div class="tname"><svg class="ic"><use href="' + (sb ? '#i-pause' : '#i-swap') + '"/></svg>' + (sb ? 'STANDBY' : 'CHANGEOVER') + '</div>' + stage +
      '<div class="tmeta entra">' + (sb ? 'después' : 'entra') + ' <b>' + esc(co.next.name.toUpperCase()) + '</b>&nbsp;&nbsp;&middot;&nbsp;&nbsp;' + C.fmtHM(co.next.si) + '</div>' +
      '<div class="trem">quedan ' + fmtCountdown(co.remaining) + '</div>' +
      '<div class="tbar"><div style="width:' + co.pct + '%;background:' + col + '"></div></div></div>';
  }

  // SIGUIENTE: tres líneas — nombre / horario · escenario / píldora de cambio (o standby; sin píldora si no hay cambio real)
  function nextHtml(b) {
    const col = safeColor(b.stageColor || b.color, '#888');
    const co = C.changeoverBefore(BLOCKS, b, ALLB);
    let badge = '';
    if (co) badge = co.mins < 0
      ? '<div class="tbadge warn"><svg class="ic"><use href="#i-swap"/></svg>Solapa: ' + (-co.mins) + ' min</div>'
      : b.standby
        ? '<div class="tbadge sb"><svg class="ic"><use href="#i-pause"/></svg>Standby: ' + co.mins + ' min</div>'
        : co.idle ? ''
        : '<div class="tbadge"><svg class="ic"><use href="#i-swap"/></svg>Cambio: ' + co.mins + ' min</div>';
    return '<div class="trow" style="--c:' + col + '"><div class="tname fit">' + esc(b.name.toUpperCase()) + '</div>' +
      metaHtml(b, col) + badge + '</div>';
  }

  /** Orden de escenarios: el del festival; sin escenario, al final. */
  function stageOrder(stageId) {
    const i = ((FEST && FEST.escenarios) || []).findIndex(e => e.id === stageId);
    return i < 0 ? 999 : i;
  }

  function renderTopPanels(nowMins, nowInt, ended) {
    const playing = C.playingNow(BLOCKS, nowInt).map(b => ({ o: stageOrder(b.stageId), h: playingHtml(b, nowInt) }));
    const changing = C.changeoversNow(BLOCKS, nowMins, ALLB).map(co => ({ o: stageOrder(co.stageId), h: changeoverHtml(co) }));
    const tasks = (C.tasksNow ? C.tasksNow(BLOCKS, nowInt) : []).map(b => ({ o: b.stageId ? stageOrder(b.stageId) : 1000, h: taskHtml(b, nowInt) }));
    const scene = playing.concat(changing).concat(tasks).sort((a, b) => a.o - b.o);   // sort estable: misma posición, primero el que suena
    const next = C.nextPerStage(BLOCKS, nowInt);
    // Backstage: el CALL sigue a la vista hasta que arranca el show (con OK sale como «avisado»)
    const calls = VISTA === 'backstage' ? Vs.backstageCalls(BLOCKS, nowInt, CALL_MINS, CALL_DONE) : C.callList(BLOCKS, nowInt, CALL_MINS, CALL_DONE).map(b => ({ block: b, done: false }));
    const fin = '<div class="tempty fin">FIN DE JORNADA</div>', none = '<div class="tempty">—</div>';
    const empty = NOFEST ? '<div class="tempty fin">SIN EVENTO CARGADO</div>' : DAY_MISSING ? '<div class="tempty fin">DÍA SIN DATOS</div>' : (ended ? fin : none);
    const idle = (NOFEST || DAY_MISSING || ended) ? empty : '<div class="tempty idle">— SIN ACTIVIDAD —</div>';
    $('now-list').innerHTML = scene.length ? scene.map(x => x.h).join('') : idle;
    $('next-list').innerHTML = next.length ? next.map(nextHtml).join('') : none;
    $('call-list').innerHTML = calls.map(cb => {
      const b = cb.block;
      const col = safeColor(b.stageColor || b.color, CALLC);
      const falta = Math.max(1, Math.round(b.si - nowInt));
      return '<div class="trow callrow" style="--c:' + col + '"><div class="callmain">' +
        '<div class="tname fit" style="color:' + col + '">' + esc(b.name.toUpperCase()) + '</div>' +
        (b.stage ? '<div class="tmeta"><span class="tstage" style="color:' + col + '">' + esc(b.stage.toUpperCase()) + '</span></div>' : '') +
        '<div class="trem" style="color:' + col + '">en ' + falta + ' min &middot; ' + C.fmtHM(b.si) + '</div>' +
        '</div>' + (VISTA === 'backstage' ? (cb.done ? '<span class="calldone"><svg class="ic"><use href="#i-check"/></svg>AVISADO</span>' : '')
          : '<button class="callok" data-ck="' + esc(C.callKey(b)) + '" title="Marcar como avisado">OK</button>') + '</div>';
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
        return el.scrollHeight <= lh * 3 + 2 && el.scrollWidth <= el.clientWidth + 1;
      };
      let s = 1;
      el.style.setProperty('--fs', s);
      while (s > 0.45 && !fits()) { s = Math.round((s - 0.05) * 100) / 100; el.style.setProperty('--fs', s); }
      // Último recurso (una sola palabra enorme): partirla antes que cortarla.
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = 'anywhere';
      el.classList.remove('measuring');
    });
    // Si el contenido de una tarjeta no cabe en su alto, se reduce toda la letra de esa tarjeta (hasta el 55 %)
    document.querySelectorAll('#top .tpanel-b').forEach(box => {
      let ps = 1;
      box.style.setProperty('--ps', ps);
      while (ps > 0.55 && box.scrollHeight > box.clientHeight + 1) { ps = Math.round((ps - 0.05) * 100) / 100; box.style.setProperty('--ps', ps); }
    });
  }

  /** Barras: desde «ahora» o, si el regidor ha desplazado la línea de tiempo, desde la hora que está mirando.
   *  Desplazado, las etiquetas dicen qué es y a qué hora empieza (AHORA/SIGUIENTE solo valen para el momento real).
   *  Los paneles de arriba (EN ESCENA, SIGUIENTE, CALL) siguen siempre la hora real. */
  const KIND_TXT = { show: 'SHOW', sc: 'SOUNDCHECK', tarea: 'TAREA' };
  function pickView(nowInt, n) {
    const off = Math.round(TIME_OFFSET);
    if (Math.abs(off) < 1) {
      const r = C.pickBlocks(BLOCKS, nowInt, n);
      r.labels = C.stripLabels ? C.stripLabels(r.list, nowInt) : r.list.map((b, i) => C.stripLabel(i, r.playing));
      return r;
    }
    const at = nowInt + off;
    const r = C.pickBlocks(BLOCKS, at, n);
    r.labels = r.list.map(b => b ? (KIND_TXT[b.kind] || 'SHOW') + ' · ' + C.fmtHM(b.si) : '');
    return r;
  }

  /** Desfase por zona bajo el nombre del evento (ámbar absorbiendo · rojo desborde · verde adelanto). */
  function renderDrift(nowInt) {
    MARG = {};
    if (NOFEST || !C.driftByZone) { $('drift').innerHTML = ''; return; }
    C.hitoMargins(FEST, ALLB, nowInt).forEach(m => { MARG[m.hito.key] = m; });
    const zs = C.driftByZone(FEST, ALLB, nowInt).filter(z => z.status !== 'ontime');
    const h = zs.map(z => {
      const nm = esc((z.zone || 'SIN ZONA').toUpperCase());
      if (z.status === 'overflow') return '<div class="dz over">' + nm + ' · +' + z.delta + ' MIN · BUFFER AGOTADO (+' + z.overflow + ')</div>';
      if (z.status === 'absorb') return '<div class="dz absorb">' + nm + ' · +' + z.delta + ' MIN · ABSORBIENDO</div>';
      return '<div class="dz early">' + nm + ' · −' + (-z.delta) + ' MIN</div>';
    }).join('');
    if ($('drift').innerHTML !== h) $('drift').innerHTML = h;
  }

  // ── Bucle principal ──────────────────────────────────────────────────
  let LAST_MIN = null;
  function tick() {
    const d = new Date();
    const nowMins = C.nowAbs(d), nowInt = Math.floor(nowMins);
    if (LAST_MIN !== null && nowInt !== LAST_MIN && !NOFEST) load();   // cada minuto: el estimado (Alargar en directo) se recalcula
    LAST_MIN = nowInt;
    $('clk').textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (VISTA === 'confidence') { renderConf(); return; }   // Confidence: sin el tiempo (decisión 77)
    const mt = meteoNow();
    if (VISTA === 'backstage') renderTicker(nowMins, mt);
    renderMeteoPill(mt);
    $('dat').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

    renderDrift(nowInt);
    const n = visibleCount();
    if (n !== stripCount) buildStrips(n);
    const r = pickView(nowInt, n);
    const labels = r.labels;
    r.list.forEach((b, i) => {
      setInfo(i, b, r.ended ? (i === 0 ? 'FIN DE JORNADA' : '') : labels[i]);
      const cv = document.querySelector('.strip[data-i="' + i + '"] canvas');
      drawStrip(cv, b, nowMins, r.ended, i);
    });
    renderTopPanels(nowMins, nowInt, r.ended);
  }

  // ── El tiempo (2e-B): píldora discreta en Manager y aviso en la cinta de Backstage. Nunca en Confidence. ──
  const Wm = window.ShowtimeMeteo;
  let MT_ACT = [], mtKeyL = '';
  function meteoNow() {
    const c = CONFIG && CONFIG.meteo;
    if (!Wm || !c || !c.on) return null;
    const m = Dt.getMeteo ? Dt.getMeteo() : null, snap = m && m.snap, now = Date.now();
    const sum = snap ? Wm.summary(snap, c, now) : null;
    const list = snap ? Wm.alerts(snap, c, now, MT_ACT) : [];
    MT_ACT = list.map(a => a.kind);
    return { c, m, sum, list };
  }
  function renderMeteoPill(mt) {
    const el = $('meteo'); if (!el) return;
    let h = '', cls = 'mtpill';
    if (mt && VISTA === 'manager') {
      if (mt.sum) {
        cls += mt.sum.stale ? ' stale' : mt.list.length ? ' warn' : '';
        h = '<div class="mt-l1"><svg class="ic"><use href="#i-' + (mt.sum.stale ? 'alert' : mt.sum.icon) + '"/></svg>' +
          Wm.pillText(mt.sum).split(' · ').map(x => '<span>' + esc(x) + '</span>').join('<i>·</i>') + '</div>';
        if (!mt.sum.stale && mt.list.length) h += '<div class="mt-l2">PREVISIÓN · ' + esc(mt.list[0].short) + (mt.list.length > 1 ? ' · +' + (mt.list.length - 1) : '') + '</div>';
      } else if (mt.m && mt.m.err) { cls += ' stale'; h = '<div class="mt-l1"><svg class="ic"><use href="#i-alert"/></svg><span>EL TIEMPO: SIN DATOS</span></div>'; }
    }
    const k = cls + h;
    if (k !== mtKeyL) { mtKeyL = k; el.className = cls; el.innerHTML = h; }
  }

  function redraw() {
    const nowMins = C.nowAbs(), nowInt = Math.floor(nowMins);
    const r = pickView(nowInt, stripCount || visibleCount());
    r.list.forEach((b, i) => drawStrip(document.querySelector('.strip[data-i="' + i + '"] canvas'), b, nowMins, r.ended, i));
  }

  // ── Interacción ──────────────────────────────────────────────────────
  // OK de CALL: se guarda (no vuelve al recargar) y se avisa a las demás ventanas.
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.callok');
    if (!btn || !btn.dataset.ck) return;
    if (Dt.READONLY) { if (PRODID) prodSend({ type: 'call', from: PRODID, key: btn.dataset.ck }, 'OK de CALL enviado'); return; }   // Producción: lo manda al Dashboard, que lo apunta en el log
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

  $('rmax').addEventListener('click', () => stepRowH(1));
  $('rmin').addEventListener('click', () => stepRowH(-1));
  $('rlbl').addEventListener('click', () => setRowH(0));

  // Controles plegables: el cursor encima un momento los despliega; al irse, se pliegan. Al tocar, abre/cierra.
  (function initDock() {
    const dock = $('zoomctl'); let tOpen = 0, tClose = 0;
    const set = on => { dock.classList.toggle('open', on); $('dockbtn').setAttribute('aria-expanded', String(on)); };
    dock.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tClose); tOpen = setTimeout(() => set(true), 250); });
    dock.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tOpen); tClose = setTimeout(() => set(false), 600); });
    $('dockbtn').addEventListener('click', () => { clearTimeout(tOpen); set(!dock.classList.contains('open')); });
  })();
  if (window.opener) { $('close').hidden = false; $('close').addEventListener('click', () => window.close()); }

  // Pantalla completa (botón o tecla F)
  function toggleFull() {
    const d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) { const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el); }
    else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  $('fullbtn').addEventListener('click', toggleFull);
  // Confidence: botón propio de pantalla completa (allí no está el dock). Si el navegador no puede (iPhone), no se enseña.
  (function () {
    const b = $('cf-full'), d = document;
    if (!(d.fullscreenEnabled || d.webkitFullscreenEnabled)) { b.remove(); return; }
    b.addEventListener('click', toggleFull);
    const upd = () => b.querySelector('use').setAttribute('href', (d.fullscreenElement || d.webkitFullscreenElement) ? '#i-unfull' : '#i-full');
    d.addEventListener('fullscreenchange', upd); d.addEventListener('webkitfullscreenchange', upd);
  })();
  document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) toggleFull(); });
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
  Dt.onChange(type => { if (type === 'flash') { renderFlash(); return; } if (type === 'standbyAll') { followStandby(); return; } load(); if (type === 'snapshot') followStandby(); if (type === 'config' || type === 'snapshot') applyVista(); else tick(); });

  // ── Mensaje flash (2c-C) ─────────────────────────────────────────────
  let flashId = '';
  function renderFlash() {
    const f0 = Dt.getFlash ? Dt.getFlash() : null;
    const f = f0 && Vs.flashFor(f0, VISTA, ZONA) ? f0 : null;           // mensajes por destino (2e-A)
    const el = $('flash');
    if (!f) { if (!el.hidden) { el.hidden = true; flashId = ''; } return; }
    if (f.id !== flashId) {
      flashId = f.id;
      $('flash-txt').textContent = f.text.toUpperCase();
      const box = el.querySelector('.fl-box');
      if (f.bg) box.style.setProperty('--mbg', f.bg); else box.style.removeProperty('--mbg');
      if (f.fg) box.style.setProperty('--mfg', f.fg); else box.style.removeProperty('--mfg');
      el.querySelector('.fl-bar').hidden = Dt.flashLeft(f) === null;   // «hasta retirarlo»: sin cuenta atrás
      el.hidden = false;
      // tamaño: lo más grande posible sin salirse
      const t = $('flash-txt'); let fs = 22;
      t.style.fontSize = fs + 'vh';
      while (fs > 5 && (t.scrollWidth > t.clientWidth + 2 || t.scrollHeight > window.innerHeight * 0.62)) { fs -= 1; t.style.fontSize = fs + 'vh'; }
      el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink');
    }
    const left = Dt.flashLeft(f), ms = Dt.flashMs(f);
    if (left !== null) $('flash-prog').style.width = (left / ms * 100) + '%';
  }
  $('flash-x').addEventListener('click', () => { if (Dt.READONLY) return; if (Dt.setFlash) Dt.setFlash(null); renderFlash(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !Dt.READONLY && !$('flash').hidden && Dt.setFlash) { Dt.setFlash(null); renderFlash(); } });
  setInterval(() => { renderFlash(); if (VISTA === 'confidence') renderConf(); }, 250);
  window.ShowtimeLive = { applyStyle: v => { applyStyle(v); tick(); }, reload: () => { load(); tick(); } };

  // ── Producción: envío al Dashboard y menú de mensajes (izquierda) ──
  let PROD_R = null;
  function prodNote(txt, bad) {
    const el = $('pnote'); el.textContent = txt; el.classList.toggle('bad', !!bad); el.hidden = false;
    clearTimeout(prodNote.t); prodNote.t = setTimeout(() => { el.hidden = true; }, 3500);
  }
  /** Manda un mensaje cifrado al Dashboard por el canal de Producción y avisa del resultado. */
  async function prodSend(msg, okTxt) {
    if (!PROD_R) { prodNote('Sin conexión con el Dashboard', true); return false; }
    let r; try { r = await PROD_R.sendProdMessage(msg); } catch (e) { r = { ok: false, msg: 'No se pudo enviar' }; }
    prodNote(r.ok ? okTxt : (r.msg || 'Sin conexión'), !r.ok);
    return !!r.ok;
  }
  /** Menú plegado a la izquierda: se abre al pasar el cursor (o al tocar el icono) y se recoge solo. Mensajes igual que los «custom» del Dashboard. */
  function initProdDock() {
    const dock = $('msgdock'), input = $('md-text'); let tOpen = 0, tClose = 0, to = [];
    dock.hidden = false;
    const set = on => { dock.classList.toggle('open', on); $('mdbtn').setAttribute('aria-expanded', String(on)); };
    dock.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tClose); tOpen = setTimeout(() => set(true), 250); });
    dock.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; clearTimeout(tOpen); tClose = setTimeout(() => { if (document.activeElement !== input) set(false); }, 600); });
    input.addEventListener('blur', () => { tClose = setTimeout(() => { if (!dock.matches(':hover')) set(false); }, 600); });
    $('mdbtn').addEventListener('click', () => { clearTimeout(tOpen); set(!dock.classList.contains('open')); if (dock.classList.contains('open')) input.focus(); });
    const paint = () => document.querySelectorAll('#md-to [data-to]').forEach(b => b.classList.toggle('on', b.dataset.to === 'all' ? !to.length : to.indexOf(b.dataset.to) >= 0));
    $('md-to').addEventListener('click', e => {
      const b = e.target.closest('[data-to]'); if (!b) return;
      if (b.dataset.to === 'all') to = [];
      else { const i = to.indexOf(b.dataset.to); if (i >= 0) to.splice(i, 1); else to.push(b.dataset.to); if (to.length === 2) to = []; }   // Manager + Backstage = «Todas» (Producción nunca manda a Confidence)
      paint();
    });
    // Al enviar se elige dónde va: Ventanas Live (mensaje grande), aviso puntual o aviso permanente (cinta de Backstage + Dashboard)
    const pm = $('pmodal');
    const destTxt = () => !to.length ? 'Manager y Backstage' : to.map(v => Vs.VISTA_TXT[v]).join(' y ');
    const pmClose = () => { pm.hidden = true; };
    $('md-form').addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim(); if (!text) return;
      $('pm-txt').textContent = '«' + text + '»';
      $('pm-live-sub').textContent = 'Mensaje grande en ' + destTxt();
      pm.hidden = false;
    });
    pm.addEventListener('click', async e => {
      const b = e.target.closest('[data-pm]');
      if (!b) { if (e.target === pm) pmClose(); return; }
      const kind = b.dataset.pm, text = input.value.trim();
      pmClose();
      if (kind === 'no' || !text) return;
      const ok = kind === 'live'
        ? await prodSend({ type: 'flash', from: PRODID, text, to: to.slice() }, 'Mensaje enviado a las pantallas')
        : await prodSend({ type: 'aviso', from: PRODID, text, perm: kind === 'perm' }, kind === 'perm' ? 'Aviso permanente enviado' : 'Aviso enviado');
      if (ok) { input.value = ''; input.blur(); set(false); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pm.hidden) pmClose(); });
  }

  // ── Producción: chat con el Stage Manager (canal común; el Dashboard guarda el chat y lo manda entero) ──
  let CHAT = [], CHAT_PEND = [], CHAT_SEEN = null, chatAsked = false;
  const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  function renderChat() {
    const box = $('cd-list'); if (!box) return;
    const row = (m, pend) => '<div class="cd-m' + (m.pid === PRODID ? ' me' : '') + (m.sm ? ' sm' : '') + (pend ? ' pend' : '') + '"><small>' +
      esc(m.pid === PRODID ? 'Tú' : m.sm ? 'Stage Manager' : m.from) + ' · ' + (pend ? 'enviando…' : hhmm(m.at)) + '</small>' + esc(m.text) + '</div>';
    box.innerHTML = CHAT.length || CHAT_PEND.length ? CHAT.map(m => row(m)).join('') + CHAT_PEND.map(m => row(m, true)).join('') : '<div class="cd-empty">Sin mensajes todavía</div>';
    box.scrollTop = box.scrollHeight;
  }
  /** Llega el chat entero desde el Dashboard. */
  function chatIn(m) {
    const list = _EM && _EM.cleanChatLog ? _EM.cleanChatLog(m) : null;
    if (!list) return;
    CHAT = list;
    CHAT_PEND = CHAT_PEND.filter(p => !list.some(x => x.pid === PRODID && x.text === p.text && x.at >= p.at - 60000));
    const last = list.length ? list[list.length - 1].id : null;
    const open = $('chatdock').classList.contains('open');
    if (CHAT_SEEN === null) CHAT_SEEN = open ? last : (list.some(x => x.pid !== PRODID) ? '' : last);   // primera vez: aviso si hay algo que no es mío
    if (open) CHAT_SEEN = last;
    $('cd-dot').hidden = open || !last || last === CHAT_SEEN || list[list.length - 1].pid === PRODID;
    renderChat();
  }
  /** Al conectar con la sala, se pide el chat (no se guarda en el teléfono: llega del Dashboard). */
  function chatOnStatus(st) {
    if (!st || st.state !== 'live' || chatAsked || !PROD_R) return;
    chatAsked = true;
    PROD_R.sendProdMessage({ type: 'chatsync', from: PRODID }).catch(() => {});
  }
  function initChat() {
    const dock = $('chatdock'), input = $('cd-text');
    dock.hidden = false;
    const set = on => {
      dock.classList.toggle('open', on); $('cdbtn').setAttribute('aria-expanded', String(on));
      if (on) { CHAT_SEEN = CHAT.length ? CHAT[CHAT.length - 1].id : CHAT_SEEN; $('cd-dot').hidden = true; renderChat(); input.focus();
        if (PROD_R) PROD_R.sendProdMessage({ type: 'chatsync', from: PRODID }).catch(() => {}); }
    };
    $('cdbtn').addEventListener('click', () => set(!dock.classList.contains('open')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && dock.classList.contains('open') && $('pmodal').hidden) set(false); });
    $('cd-form').addEventListener('submit', async e => {
      e.preventDefault();
      const text = input.value.replace(/\s+/g, ' ').trim(); if (!text) return;
      const p = { text, at: Date.now(), pid: PRODID, from: '' };
      CHAT_PEND.push(p); input.value = ''; renderChat();
      let r; try { r = await PROD_R.sendProdMessage({ type: 'chat', from: PRODID, text }); } catch (err) { r = { ok: false }; }
      if (!r || !r.ok) { CHAT_PEND = CHAT_PEND.filter(x => x !== p); input.value = text; renderChat(); prodNote('No se pudo enviar: sin conexión', true); }
    });
    renderChat();
  }

  // ── Modo Staff (2d-A): Pantalla Live de solo lectura abierta desde el QR ──
  // Los datos llegan cifrados por la emisión del Mac; aquí no se puede cambiar nada (sin OK de CALL ni cerrar mensajes).
  function startStaff() {
    document.body.classList.add('ro');
    const Em = window.ShowtimeEmision, params = Em && Em.parseHash(location.hash), rx = $('rx');
    rx.hidden = false;
    const ago = s => s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h';
    function render(st) {
      const s = st ? st.state : 'bad';
      rx.className = 'rx ' + s;
      const t = st && st.lastMsg ? Math.round((Date.now() - st.lastMsg) / 1000) : 0;
      const nLinks = st ? st.links.filter(l => l.state === 'on').length : 0;
      $('rx-t').textContent = s === 'live' ? 'EN DIRECTO'
        : s === 'connecting' ? (nLinks ? 'ESPERANDO A LA SALA…' : 'CONECTANDO…')
        : s === 'stale' ? 'SIN CONEXIÓN CON LA SALA · último dato hace ' + ago(t)
        : s === 'end' ? 'EMISIÓN DETENIDA EN EL DASHBOARD'
        : 'ENLACE NO VÁLIDO · vuelve a escanear el QR';
      rx.title = st ? st.links.map(l => l.name + ': ' + (l.state === 'on' ? 'conectado' : 'sin conexión')).join(' · ') : '';
    }
    if (!params || !(window.crypto && crypto.subtle) || !('WebSocket' in window)) { render(null); return; }
    const R = new Em.Receptor({ params, onSnapshot: snap => Dt.loadSnapshot(snap), onStatus: st => { render(st); if (PRODID) chatOnStatus(st); }, onProdMessage: m => { if (PRODID) chatIn(m); } });
    if (PRODID) { PROD_R = R; document.body.classList.add('prod'); initProdDock(); initChat(); }
    R.start().catch(e => { console.error(e); render(null); });
    // Al volver a encender la pantalla (o volver a la pestaña), se reconecta a fondo y se pide el estado: nada de conexiones «zombi»
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') R.wake(); });
    window.addEventListener('online', () => R.wake());   // la red vuelve (cambio de Wi-Fi)
  }

  // ── Vistas (2e-A) ───────────────────────────────────────────────────
  const LIVE_ZONE = 'showtime.live.zona';
  function screensCfg() { return (CONFIG && CONFIG.screens) || Vs.normScreens(); }
  /** Aplica la vista: qué bloques se ven y cómo. Solo maquetación; no toca datos. */
  function applyVista() {
    document.body.dataset.vista = VISTA;
    const b = screensCfg().back;
    document.body.classList.toggle('bs-nocards', VISTA === 'backstage' && !b.cards);
    document.body.classList.toggle('bs-nolines', VISTA === 'backstage' && !b.lines);
    document.body.classList.toggle('bs-noticker', VISTA !== 'backstage' || !b.ticker);
    document.title = STANDBY ? 'Showtime · Standby' : 'Showtime · ' + Vs.VISTA_TXT[VISTA];
    tickerKey = '';
    if (VISTA !== 'confidence') { buildStrips(visibleCount()); }
    requestAnimationFrame(tick);
  }
  /** Cambia de vista sin recargar (tecla V): la URL se actualiza (el «#…» de la emisión se conserva). */
  function setVista(v) {
    VISTA = vistaOk(v);
    const q = new URLSearchParams(location.search);
    q.set('vista', VISTA); q.delete('prev');
    if (VISTA === 'confidence' && ZONA !== null) q.set('zona', ZONA); else q.delete('zona');
    try { history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); } catch (e) {}
    applyVista();
    if (VISTA === 'confidence') { const g = Dt.getStandby ? Dt.getStandby() : null; if (g && g.on && !STANDBY) setStandby(true); }   // llega a Confidence con el Standby del Dashboard puesto
  }
  document.addEventListener('keydown', e => {
    if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) {
      if (VISTA === 'manager' && ZONA === null) { const z = pget(LIVE_ZONE, null); if (z !== null) ZONA = z; }   // última zona elegida en esta pantalla
      if (STANDBY) return;   // en Standby, V no cambia nada por debajo
      setVista(PRODID ? Vs.nextProdVista(VISTA) : Vs.nextVista(VISTA));
    }
    if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) setStandby(!STANDBY);
    if (e.key === 'Escape' && STANDBY) setStandby(false);
  });

  // ── Standby / Modo Cartel ─────────────────────────────────────────────
  let stbClk = null, stbMove = 0;
  /** Pone o quita el Standby en ESTA ventana (tecla S, botón). La URL lo recuerda (al recargar sigue igual). */
  function setStandby(on) {
    if (!Mk) return;
    STANDBY = !!on;
    try { history.replaceState(null, '', location.pathname + Mk.standbySearch(location.search, STANDBY) + location.hash); } catch (e) {}
    renderStandby();
  }
  /** Standby del Dashboard (Live ▾ › Standby): solo lo siguen las Confidence, aquí y por QR. Se aplica cuando CAMBIA
   *  (cada orden lleva su hora): si luego alguien lo quita o lo pone a mano con la S en una pantalla, esa pantalla manda
   *  hasta la siguiente orden del Dashboard. */
  let stbAt = null;
  function followStandby() {
    const g = Dt.getStandby ? Dt.getStandby() : null;
    if (!g || VISTA !== 'confidence' || g.at === stbAt) return;
    stbAt = g.at;
    if (g.on !== STANDBY) setStandby(g.on);
  }
  function renderStandby() {
    const el = $('standby'); if (!el || !Mk) return;
    if ($('stbbtn')) $('stbbtn').setAttribute('aria-pressed', String(STANDBY));
    document.body.classList.toggle('standby-on', STANDBY);
    if (!STANDBY) { el.hidden = true; el.innerHTML = ''; clearInterval(stbClk); stbClk = null; document.title = 'Showtime · ' + Vs.VISTA_TXT[VISTA]; return; }
    el.innerHTML = Mk.banner({ version: (window.ShowtimeEmision || {}).BUILD || '', footer: true }) +
      '<div id="stb-clk" class="stb-clk"></div><button id="stb-x" class="stb-x" type="button">Salir del Standby (S)</button>';
    el.hidden = false;
    document.title = 'Showtime · Standby';
    const upd = () => { const c = $('stb-clk'); const t = Mk.hhmm(new Date()); if (c && c.textContent !== t) c.textContent = t; };
    upd(); clearInterval(stbClk); stbClk = setInterval(upd, 1000);
  }
  if ($('standby')) {
    $('standby').addEventListener('click', e => { if (e.target.closest && e.target.closest('#stb-x')) setStandby(false); });
    // El botón de salir y el cursor solo aparecen al mover el ratón o tocar la pantalla (en escena no se ve nada más)
    $('standby').addEventListener('pointermove', () => { $('standby').classList.add('moving'); clearTimeout(stbMove); stbMove = setTimeout(() => $('standby').classList.remove('moving'), 2500); });
  }
  if ($('stbbtn')) $('stbbtn').addEventListener('click', () => setStandby(!STANDBY));

  // Confidence: cuenta atrás gigante de UNA zona (la que lleva la URL o la que se elige aquí)
  let confKey = '';
  function renderConf() {
    if (VISTA !== 'confidence') return;
    const r = Vs.confidence(FEST, ZONA, C.nowAbs(), screensCfg());
    const d = new Date(), hhmm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const box = $('conf');
    if (r.mode === 'pickzone' || r.mode === 'nofest') {
      const k = r.mode + JSON.stringify(r.zones || []);
      if (confKey !== k) {
        confKey = k;
        box.className = 'conf pick';
        box.innerHTML = r.mode === 'nofest' ? '<div class="cf-msg">' + (Dt.READONLY ? 'ESPERANDO LOS DATOS DE LA SALA…' : 'SIN EVENTO CARGADO') + '</div>'
          : '<div class="cf-msg">CONFIDENCE · ELIGE LA ZONA DE ESTA PANTALLA</div><div class="cf-zones">' +
            r.zones.map(z => '<button class="cf-zone" data-z="' + esc(z.id) + '">' + esc(z.name.toUpperCase()) + '</button>').join('') + '</div>';
      }
      return;
    }
    let top = '', digits = '', foot = '', cls = 'conf ' + r.mode, frac = r.frac;
    const zn = esc((r.zone || '').toUpperCase());
    const kindTag = b => '<span class="cf-kind ' + (b.kind === 'sc' ? 'sc' : 'show') + '">' + (b.kind === 'sc' ? 'SOUNDCHECK' : 'SHOW') + '</span>';
    const prox = b => 'PRÓXIMO ' + (b.kind === 'sc' ? 'SOUNDCHECK' : 'SHOW') + ': <b>' + esc(b.name.toUpperCase()) + '</b> · ' + C.fmtHM(b.si);
    if (r.mode === 'show') {
      top = zn + ' · ' + kindTag(r.band) + ' · ' + esc(r.band.name.toUpperCase());
      digits = Vs.fmtClock(r.remSec); foot = hhmm;
      cls += ' lv-' + r.level + (r.blink ? ' blink' : '');
    } else if (r.mode === 'changeover') {
      top = zn + ' · ' + (r.standby ? 'STANDBY' : 'CHANGEOVER');
      digits = Vs.fmtClock(r.remSec);
      foot = hhmm + '<span class="cf-sep">·</span>' + prox(r.next);
      cls += ' lv-' + r.level;
    } else if (r.mode === 'wait') {
      top = zn + ' · EN ESPERA';
      digits = Vs.fmtClock(r.remSec);
      foot = hhmm + '<span class="cf-sep">·</span>' + prox(r.next);
      cls += ' lv-ok nobar';
    } else {
      top = zn; digits = hhmm; foot = 'FIN DE JORNADA'; cls += ' nobar';
    }
    const k = cls + '|' + top + '|' + foot;
    if (confKey !== k) {
      confKey = k;
      box.className = cls;
      box.innerHTML = '<div class="cf-top">' + top + '</div><div class="cf-dig"><span id="cf-d"></span></div>' +
        '<div class="cf-bar"><div id="cf-fill"></div></div><div class="cf-foot">' + foot + '</div>';
      fitConf();
    }
    const dEl = $('cf-d');
    if (dEl.textContent !== digits) { dEl.textContent = digits; dEl.parentNode.style.setProperty('--n', Math.max(5, digits.length)); }
    if (frac !== null && frac !== undefined) $('cf-fill').style.width = (frac * 100).toFixed(2) + '%';
  }
  /** Confidence: la línea de arriba y la de abajo se ajustan solas para caber enteras (sin «…»):
   *  primero se reduce la letra (hasta el 60 %); si aun así no cabe, pasa a dos líneas. */
  function fitConf() {
    document.querySelectorAll('#conf .cf-top, #conf .cf-foot').forEach(el => {
      el.style.fontSize = ''; el.style.whiteSpace = ''; el.style.lineHeight = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let k = 1;
      while (el.scrollWidth > el.clientWidth + 1 && k > 0.6) { k -= 0.05; el.style.fontSize = (base * k) + 'px'; }
      if (el.scrollWidth > el.clientWidth + 1) { el.style.whiteSpace = 'normal'; el.style.lineHeight = '1.15'; el.style.fontSize = (base * 0.7) + 'px'; }
    });
  }
  window.addEventListener('resize', () => { if (VISTA === 'confidence') fitConf(); });
  $('conf').addEventListener('click', e => {
    const b = e.target.closest('.cf-zone'); if (!b) return;
    ZONA = b.dataset.z; pset(LIVE_ZONE, ZONA); confKey = ''; setVista('confidence');
  });

  // Cinta de avisos (Backstage): retrasos, hitos y (en la 2e-B) el tiempo
  let tickerKey = '';
  function renderTicker(nowMins, mt) {
    const t = screensCfg().ticker;
    if (!screensCfg().back.ticker) return;
    const items = Vs.tickerItems(FEST, screensCfg(), nowMins, mt && Wm ? Wm.tickerList(mt.sum, mt.list) : null, Dt.getAvisos ? Dt.getAvisos() : []);
    const k = t.mode + t.bg + t.fg + JSON.stringify(items);
    if (k === tickerKey) return;
    tickerKey = k;
    const tk = $('ticker');
    tk.style.setProperty('--tbg', t.bg); tk.style.setProperty('--tfg', t.fg);
    tk.className = 'ticker ' + t.mode;
    const ic = { aviso: '#i-msg', delay: '#i-clock', hito: '#i-flag', meteo: '#i-sun' };
    const html = items.length ? items.map(x => '<span class="tk-it ' + x.kind + ' ' + x.level + '"><svg class="ic"><use href="' + ic[x.kind] + '"/></svg>' + esc(x.text) + '</span>').join('<span class="tk-sep"></span>')
      : '<span class="tk-it">SIN AVISOS</span>';
    if (t.mode === 'crawl') {
      tk.innerHTML = '<div class="tk-track"><div class="tk-run">' + html + '<span class="tk-sep"></span></div><div class="tk-run" aria-hidden="true">' + html + '<span class="tk-sep"></span></div></div>';
      const run = tk.querySelector('.tk-run');
      const secs = Math.max(12, run.scrollWidth / 90);           // ~90 px/s, siempre a la misma velocidad de lectura
      tk.querySelector('.tk-track').style.animationDuration = secs + 's';
    } else tk.innerHTML = '<div class="tk-static">' + html + '</div>';
  }

  // Aviso al abrir desde el Dashboard (monitor externo o arrastrar)
  (function () {
    const a = URLP.get('aviso'); if (!a) return;
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.innerHTML = a === 'arrastra' ? '<b>Arrastra esta ventana al monitor de escenario</b> y pulsa <kbd>F</kbd> para pantalla completa'
      : 'Pulsa <kbd>F</kbd> (o haz clic y pulsa F) para pantalla completa';
    document.body.appendChild(tip);
    const off = () => { tip.remove(); document.removeEventListener('fullscreenchange', off); };
    setTimeout(off, 12000); document.addEventListener('fullscreenchange', off);
  })();

  // El Dashboard puede cerrar esta ventana desde «Live ▾» (aunque esté en otro monitor)
  window.addEventListener('message', e => { const m = e.data; if (m && m.app === 'showtime' && m.type === 'closeLive' && !Dt.READONLY) { try { window.close(); } catch (er) {} } });

  // ── Arranque ─────────────────────────────────────────────────────────
  load();
  applyVista();
  if (STANDBY) setStandby(true); else renderStandby();
  followStandby();
  setZoom(0);
  setRowH(ROW_H);
  tick();
  setInterval(tick, 1000);
  window.addEventListener('resize', () => requestAnimationFrame(tick));
  if (Dt.READONLY) startStaff();
  if (window.opener || !Dt.getFestival()) Dt.hello();   // pide los datos al Panel que la abrió (o a uno abierto)
  // Si el Panel se recarga, pierde la referencia a esta ventana: el «ping» hace que la recupere y le reenvíe todo.
  if (window.opener && Dt.ping) setInterval(() => Dt.ping(), 2000);
})();
