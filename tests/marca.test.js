/* Tests de marca.js (cartel de inicio, «Acerca de» y Standby) y del paquete de iconos.
 * Ordenador:  node tests/marca.test.js
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('marca.test.js: solo en Node (node tests/marca.test.js)'); return; }
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const M = require('../marca.js');
  const ROOT = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(ROOT, f));
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

  test('marca.js: la sintaxis es válida', () => { new vm.Script(src('marca.js').toString(), { filename: 'marca.js' }); });

  test('Cartel: monograma ST, SHOWTIME · by Synapse Live, Real-Time Show Control; versión y pie solo si se piden', () => {
    const h = M.banner({ version: '20261045', footer: true });
    ok(h.indexOf('<path d="' + M.ST_PATH + '"/>') > 0, 'el isotipo ST');
    ok(/class="stm-name">SHOWTIME</.test(h)); ok(/class="stm-by">by Synapse Live</.test(h)); ok(/class="stm-desc">Real-Time Show Control</.test(h));
    ok(/class="stm-ver">v20261045</.test(h), 'versión activa');
    ok(h.indexOf('BUILT FOR LIFE ON STAGE · © 2026 Synapse Live') > 0, 'pie');
    ok(/class="stm-lines"/.test(h) && /class="stm-p"/.test(h), 'líneas de tiempo con pulsos');
    const solo = M.banner();
    ok(solo.indexOf('stm-ver') < 0 && solo.indexOf('stm-foot') < 0);
    ok(/role="img" aria-label="SHOWTIME by Synapse Live · Real-Time Show Control"/.test(solo), 'accesible');
  });
  test('Líneas de tiempo: fluyen de derecha a izquierda (el pulso va del final al principio del trazo)', () => {
    const css = src('marca.css').toString();
    ok(/@keyframes stmflow\{from\{stroke-dashoffset:-1000\}to\{stroke-dashoffset:0\}\}/.test(css));
    ok(/prefers-reduced-motion:reduce\)\{\.stm-p path\{animation:none/.test(css), 'sin animación si el sistema lo pide');
    ok(/mask-image:linear-gradient\(to right,transparent 0,#000 42%\)/.test(css), 'difuminado suave a la izquierda');
    ok(/\.stm\{[^}]*aspect-ratio:2\.6\/1/.test(css) && /background:var\(--stm-bg\)/.test(css) && /--stm-bg:#07080a/.test(css) && /border:1px solid rgba\(255,255,255,\.08\)/.test(css), 'panorámico, #07080a y hairline');
  });
  test('Standby en la URL de la Live: vista=standby y la vista de antes en «prev»; al quitarlo vuelve', () => {
    const on = M.standbySearch('?vista=confidence&zona=z1', true);
    eq(on, '?vista=standby&zona=z1&prev=confidence');
    ok(M.isStandby(on)); eq(M.prevVista(on), 'confidence');
    eq(M.standbySearch(on, true), on, 'dos veces: igual (no pierde la vista de antes)');
    eq(M.standbySearch(on, false), '?vista=confidence&zona=z1');
    eq(M.standbySearch('', true), '?vista=standby'); eq(M.standbySearch('?vista=standby', false), '');
    eq(M.standbySearch('?vista=manager&b=1', false), '?vista=manager&b=1', 'sin Standby, quitarlo no toca nada');
    ok(!M.isStandby('?vista=manager')); eq(M.prevVista('?vista=backstage'), 'backstage');
  });
  test('Reloj del Standby: HH:MM sin segundos', () => {
    eq(M.hhmm(new Date(2026, 9, 8, 9, 5, 59)), '09:05'); eq(M.hhmm(new Date(2026, 9, 8, 23, 59, 1)), '23:59');
  });

  // ── Iconos oficiales ST (S maciza) ──
  const png = f => { const b = src(f); ok(b.slice(1, 4).toString() === 'PNG', f + ' es PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  test('Iconos: 180, 192, 512 y maskable 512 con su tamaño exacto', () => {
    [['icons/icon-180.png', 180], ['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/icon-maskable-512.png', 512], ['marca/logo-st-2048.png', 2048]].forEach(([f, n]) => {
      const d = png(f); eq(d.w, n, f); eq(d.h, n, f);
    });
  });
  test('icon.svg: vectorial, fondo #07080a y el mismo isotipo que el cartel y el menú (sin imágenes incrustadas)', () => {
    const svg = src('icons/icon.svg').toString();
    ok(svg.indexOf('fill="#07080a"') > 0); ok(svg.indexOf('d="' + M.ST_PATH + '"') > 0); ok(svg.indexOf('<image') < 0 && svg.length < 1000);
    ok(src('index.html').toString().indexOf('<symbol id="i-st" viewBox="' + M.ST_VIEWBOX + '"><path fill="currentColor" d="' + M.ST_PATH + '"/>') > 0, 'icono del menú «Acerca de»');
    ok(src('marca/st.svg').toString().indexOf(M.ST_PATH) > 0, 'isotipo suelto para diseño');
  });
  test('marca.js y marca.css: en el Dashboard y en la Live (no en el mando), con la versión y en la caché sin conexión', () => {
    const v = /BUILD = '(\d+)'/.exec(src('emision.js').toString())[1];
    ['index.html', 'live.html'].forEach(f => {
      const h = src(f).toString();
      ok(h.indexOf('<script src="marca.js?v=' + v + '"></script>') > 0, f + ': marca.js');
      ok(h.indexOf('<link rel="stylesheet" href="marca.css?v=' + v + '">') > 0, f + ': marca.css');
      ok(h.indexOf('marca.js') < h.indexOf(f === 'index.html' ? 'control.js' : 'live.js'), f + ': antes que la app');
    });
    ok(src('remote.html').toString().indexOf('marca.') < 0);
    const sw = src('sw.js').toString();
    ok(/'marca\.js', 'marca\.css'/.test(sw));
  });

  let pass = 0, fail = 0;
  for (const [name, fn] of tests) { try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
  console.log('Marca: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
  process.exitCode = fail ? 1 : 0;
})();
