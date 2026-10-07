/* Tests de xlsx.js — lector de Excel sin librerías.
 * Ordenador:  node tests/xlsx.test.js
 * Usa dos archivos reales (tests/fixtures: uno hecho con openpyxl y otro guardado por LibreOffice)
 * y libros fabricados aquí mismo (ZIP sin comprimir y comprimido) para los casos raros.
 */
(function () {
  'use strict';
  if (typeof module === 'undefined' || !module.exports) { console.log('xlsx.test.js: solo en Node (node tests/xlsx.test.js)'); return; }
  const fs = require('fs'), path = require('path'), zlib = require('zlib');
  const X = require('../xlsx.js'), I = require('../importar.js'), C = require('../core.js');
  const _ = X._;
  const tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + JSON.stringify(b) + ', salió ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }
  async function throwsAsync(fn, re, msg) { try { await fn(); } catch (e) { ok(re.test(e.message), (msg || '') + ' — error: ' + e.message); return; } throw new Error((msg || '') + ': esperaba un error'); }
  const fixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));

  /** ZIP mínimo (sin CRC: el lector no lo comprueba). deflate=true → método 8. */
  function makeZip(files, deflate) {
    const parts = [], central = []; let off = 0;
    Object.keys(files).forEach(name => {
      const raw = Buffer.from(files[name], 'utf8'), data = deflate ? zlib.deflateRawSync(raw) : raw, nb = Buffer.from(name, 'utf8');
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, nb, data); central.push(ch, nb); off += 30 + nb.length + data.length;
    });
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat(parts.concat([cd, end]));
  }
  const WB = (extra) => '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + (extra || '') + '<sheets><sheet name="Cartel" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const RELS = '<Relationships><Relationship Id="rId1" Type="worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>';
  const STYLES = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-F400]h:mm\\ AM/PM"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="20"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';

  test('Excel real (openpyxl): hoja «Horario» (se salta la portada vacía), horas y fechas legibles', async () => {
    const r = await X.toTSV(fixture('horario.xlsx'));
    eq(r.sheet, 'Horario'); eq(r.sheets.join(), 'Portada,Horario');
    const L = r.text.split('\n');
    eq(L[0], 'Día\tEscenario\tBanda\tInicio\tFin\tNotas');
    eq(L[1], '2026-07-10\tPrincipal\tLos Ácratas\t21:00\t22:15\tBackline propio');
    eq(L[2].split('\t')[2], 'Niña & Pastora', 'entidades XML'); eq(L[2].split('\t')[4], '00:30');
    eq(L[3].split('\t')[2], 'DJ <Set>');
    eq(L[4], 'vie 10\tCarpa\tPrueba Omega\t18:00\t18:45\tSC escrito como texto', 'texto tal cual');
  });
  test('Excel guardado por LibreOffice: mismo resultado', async () => {
    const a = await X.toTSV(fixture('horario.xlsx')), b = await X.toTSV(fixture('horario-lo.xlsx'));
    eq(b.text, a.text);
  });
  test('Del Excel a la vista previa de «Pegar horario»: 4 entradas, zonas nuevas y horas bien', async () => {
    const r = await X.toTSV(fixture('horario.xlsx'));
    let s = C.newFestival({ nombre: 'x', fechaInicio: '2026-07-10', fechaFin: '2026-07-11', dayCutoff: '06:00' }).state;
    const ctx = I.contextOf(s), rd = I.read(r.text, ctx), pv = I.preview(s, rd.records, { ctx });
    eq(rd.kind, 'tabla'); eq(pv.rows.length, 4);
    eq(pv.rows[0].banda, 'Los Ácratas'); eq(pv.rows[0].inicio, '21:00'); eq(pv.rows[0].fin, '22:15'); eq(pv.rows[0].jornada, '2026-07-10');
    eq(pv.newStages.join(), 'Principal,Carpa');
    eq(pv.rows[3].tipo, 'sc', '«Prueba» = soundcheck'); eq(pv.rows[3].jornada, '2026-07-10', '«vie 10» = el viernes 10 del evento');
  });
  test('Libro fabricado: texto en línea, booleano, número, estilos de hora (incl. formato propio) y fecha', async () => {
    const sheet = '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><r><t>Ban</t></r><r><t xml:space="preserve">da </t></r><rPh><t>X</t></rPh></is></c><c r="C1" t="inlineStr"><is><t>Hora</t></is></c></row>' +
      '<row r="2"><c r="A2" t="str"><v>Uno</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" s="1"><v>0.8854166666</v></c><c r="D2" s="2"><v>46213</v></c><c r="E2"><v>0.30000000000000004</v></c></row>' +
      '<row r="3"/><row r="4"><c r="C4" s="3"><v>0.99999</v></c></row>' +
      '</sheetData></worksheet>';
    for (const deflate of [false, true]) {
      const z = makeZip({ 'xl/workbook.xml': WB(), 'xl/_rels/workbook.xml.rels': RELS, 'xl/styles.xml': STYLES, 'xl/worksheets/sheet1.xml': sheet }, deflate);
      const r = await X.toTSV(z), L = r.text.split('\n');
      eq(L[0], 'Banda\t\tHora', 'texto enriquecido sin la fonética · celdas vacías en medio' + (deflate ? ' (comprimido)' : ''));
      eq(L[1], 'Uno\tVERDADERO\t21:15\t2026-07-10\t0.3');
      eq(L.length, 3, 'las filas vacías no cuentan');
      eq(L[2], '\t\t00:00', '23:59:59 redondea a 00:00');
    }
  });
  test('Fechas con el sistema 1904 (Excel antiguo de Mac)', async () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" s="2"><v>44751</v></c></row></sheetData></worksheet>';
    const z = makeZip({ 'xl/workbook.xml': WB('<workbookPr date1904="1"/>'), 'xl/_rels/workbook.xml.rels': RELS, 'xl/styles.xml': STYLES, 'xl/worksheets/sheet1.xml': sheet });
    eq((await X.toTSV(z)).text, '2026-07-10');
  });
  test('Archivos que no son .xlsx: mensaje claro (Excel antiguo .xls, un PDF, un ZIP cualquiera)', async () => {
    await throwsAsync(() => X.toTSV(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /Excel antiguo \(\.xls\)/);
    await throwsAsync(() => X.toTSV(Buffer.from('%PDF-1.7 hola')), /No es un archivo Excel/);
    await throwsAsync(() => X.toTSV(makeZip({ 'hola.txt': 'x' })), /No es un archivo Excel/);
  });
  test('Piezas: columnas, formatos de número y entidades', () => {
    eq(_.colIndex('A1'), 0); eq(_.colIndex('Z9'), 25); eq(_.colIndex('AA10'), 26); eq(_.colIndex('BC3'), 54);
    eq(_.fmtKind('hh:mm'), 't'); eq(_.fmtKind('dd/mm/yyyy'), 'd'); eq(_.fmtKind('yyyy-mm-dd hh:mm'), 'dt'); eq(_.fmtKind('0.00'), ''); eq(_.fmtKind('"Hora: "0'), '', 'texto entre comillas no cuenta');
    eq(_.fmtKind('[h]:mm'), 't'); eq(_.fmtKind('[Red]0.0'), '');
    eq(_.serialText(46213.875, 'dt'), '2026-07-10 21:00'); eq(_.serialText(46213.875, 't'), '21:00'); eq(_.serialText(46213, 'dt'), '2026-07-10');
    eq(_.unxml('a &amp; b &lt;c&gt; &#233; &#xF1;'), 'a & b <c> é ñ');
  });

  (async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } }
    console.log('Xlsx: ' + pass + '/' + tests.length + ' tests OK' + (fail ? ' — ' + fail + ' FALLAN' : ''));
    process.exitCode = fail ? 1 : 0;
  })();
})();
