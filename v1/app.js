/* Showtime Document v1 · interfaz mínima: crear, abrir, descargar, duplicar y cambiar zona/corte (sin historia).
 * Todo pasa por session.js: la interfaz nunca toca el documento ni el almacenamiento directamente.
 * No hay Live, CALL OK, Standby ni avisos: no son portables (§6.5) y llegan en P2/P3.
 */
(function () {
  'use strict';
  const D = window.ShowtimeV1Document, Sess = window.ShowtimeV1Session;
  const $ = id => document.getElementById(id);
  let backend = null;
  try { backend = window.localStorage; } catch (e) { backend = null; }   // modo privado o bloqueado: funciona sin persistir
  const session = Sess.createSession(backend, n => crypto.getRandomValues(new Uint8Array(n)));

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function show(id, text, cls) { const el = $(id); el.hidden = !text; el.textContent = text || ''; if (cls !== undefined) el.className = 'msg ' + cls; }
  function error(text) { show('msg', text, ''); }
  function ok(text) { show('msg', text, 'ok'); }
  function warnings(list) { show('warn', (list || []).map(w => w.message).join('\n'), 'warn'); }

  const KIND_TXT = { 'invalid-json': 'No es JSON válido', foreign: 'No es un Showtime Document', legacy: 'Showtime anterior a v1', future: 'Versión posterior', invalid: 'Showtime Document v1 no válido' };

  function render() {
    const doc = session.doc;
    $('current').hidden = !doc;
    if (!doc) return;
    const ev = doc.festival.project.event, P = doc.festival.project, L = doc.eventLog;
    const rows = [
      ['Nombre', ev.name], ['Jornadas', ev.startDate + ' → ' + ev.endDate], ['Zona horaria', ev.timeZone], ['Corte de jornada', ev.dayCutoff],
      ['Zonas · entradas', P.stages.length + ' · ' + P.entries.length], ['Ajustes · Log', P.delays.length + ' · ' + L.entries.length],
      ['Bóveda QR', doc.protectedAccess ? 'presente (cerrada, B1)' : 'no'], ['Identidad', doc.festivalId]
    ];
    $('cur-info').innerHTML = rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
    const locked = D.hasHistory(doc);
    $('tz-zone').value = ev.timeZone; $('tz-cut').value = ev.dayCutoff;
    $('tz-zone').disabled = $('tz-cut').disabled = $('tz-apply').disabled = locked;
    $('tz-lock').hidden = !locked;
  }

  const replaceOk = () => !session.doc || window.confirm('Se sustituirá el festival abierto. Si no lo has descargado, sus cambios se perderán en este navegador. ¿Continuar?');

  $('new-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!replaceOk()) return;
    const r = session.create({ name: $('new-name').value, startDate: $('new-start').value, endDate: $('new-end').value || $('new-start').value, timeZone: $('new-tz').value.trim() });
    warnings([]);
    if (!r.ok) { error(r.message); return; }
    ok('Festival creado.'); render();
  });

  $('open-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!replaceOk()) return;
    f.text().then(text => {
      const r = session.open(text);
      if (!r.ok) { warnings([]); error((KIND_TXT[r.kind] ? KIND_TXT[r.kind] + '. ' : '') + r.message + '\nEl festival abierto no ha cambiado.'); return; }
      ok('Abierto: ' + f.name); warnings(r.warnings); render();
    }, () => error('No se ha podido leer el archivo. El festival abierto no ha cambiado.'));
  });

  $('btn-save').addEventListener('click', () => {
    const s = session.save();
    if (!s.ok) { error(s.message); return; }
    const url = URL.createObjectURL(new Blob([s.text], { type: s.mime }));
    const a = document.createElement('a');
    a.href = url; a.download = s.fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ok('Descargado: ' + s.fileName);
  });

  $('btn-dup').addEventListener('click', () => {
    if (!window.confirm('Duplicar crea un festival nuevo (identidad nueva) con la escaleta, las reglas y la configuración; sin Log, hechos reales, ajustes ni bóveda QR. El original no cambia si lo has descargado. ¿Continuar?')) return;
    const r = session.duplicate();
    if (!r.ok) { error(r.message); return; }
    warnings([]); ok('Festival duplicado: identidad nueva. Descárgalo para conservarlo.'); render();
  });

  $('btn-close').addEventListener('click', () => {
    if (!window.confirm('¿Cerrar el festival? Se quita de este navegador (el archivo descargado no se toca).')) return;
    session.close(); warnings([]); ok('Festival cerrado.'); render();
  });

  $('tz-form').addEventListener('submit', e => {
    e.preventDefault();
    const r = session.setTimeContext({ timeZone: $('tz-zone').value.trim(), dayCutoff: $('tz-cut').value.trim() });
    if (!r.ok) { error(r.message); render(); return; }
    ok('Zona horaria y corte actualizados.'); render();
  });

  const r = session.restore();
  if (r.ok) warnings(r.warnings);
  render();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
})();
