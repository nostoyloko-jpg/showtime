/* Showtime — xlsx.js
 * Lector de hojas de Excel (.xlsx) SIN librerías: abre el ZIP, descomprime con DecompressionStream del navegador
 * y convierte la primera hoja con datos en texto tabulado (TSV), que es lo que entiende «Pegar horario».
 *   ShowtimeXlsx.toTSV(arrayBuffer) → Promise<{ text, sheet, sheets: [nombres], all: [{ name, text }] (todas las hojas con datos) }>
 * Horas y fechas de Excel (números con formato de hora/fecha) salen como «21:30» y «2026-07-10».
 */
(function (root) {
  'use strict';

  // ── ZIP ──────────────────────────────────────────────────────────────
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  /** Índice del ZIP: { nombre: { method, size, offset } } (directorio central). */
  function zipIndex(bytes) {
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('No es un archivo Excel (.xlsx) válido');
    const n = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);
    const out = {}, dec = new TextDecoder('utf-8');
    for (let k = 0; k < n; k++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('El archivo Excel está dañado');
      const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32), off = u32(bytes, p + 42);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      out[name] = { method, size: csize, offset: off };
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede leer .xlsx: guarda la hoja como CSV o copia y pega las celdas');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Contenido de un archivo del ZIP como texto (o null si no está). */
  async function zipText(bytes, idx, name) {
    const e = idx[name];
    if (!e) return null;
    const lh = e.offset;
    if (u32(bytes, lh) !== 0x04034b50) throw new Error('El archivo Excel está dañado');
    const start = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
    const raw = bytes.subarray(start, start + e.size);
    const data = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error('Compresión no soportada en el .xlsx');
    return new TextDecoder('utf-8').decode(data);
  }

  // ── XML (lo justo, con expresiones: sin DOM para poder probarlo en node) ──
  function unxml(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? unxml(m[1]) : null; };
  /** Texto de un <si> / <is>: une los <t> (también los de texto enriquecido) y salta la fonética (<rPh>). */
  function richText(x) {
    const clean = x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '', m; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    while ((m = re.exec(clean))) out += m[1] ? unxml(m[1]) : '';
    return out;
  }

  function sharedStrings(xml) {
    if (!xml) return [];
    const out = []; let m; const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    while ((m = re.exec(xml))) out.push(m[1] ? richText(m[1]) : '');
    return out;
  }

  // Formatos de número: ¿hora, fecha o las dos?
  const BUILTIN_DATE = { 14: 'd', 15: 'd', 16: 'd', 17: 'd', 18: 't', 19: 't', 20: 't', 21: 't', 22: 'dt', 45: 't', 46: 't', 47: 't' };
  function fmtKind(code) {
    const c = String(code || '').replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '');
    const t = /[hs]/i.test(c), d = /[dy]/i.test(c);
    return t && d ? 'dt' : t ? 't' : d ? 'd' : '';
  }
  /** Para cada estilo de celda (índice s=): '' | 'd' | 't' | 'dt'. */
  function styleKinds(xml) {
    if (!xml) return [];
    const custom = {}; let m;
    const reF = /<numFmt\s[^>]*>/g;
    while ((m = reF.exec(xml))) custom[attr(m[0], 'numFmtId')] = attr(m[0], 'formatCode');
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!xfs) return [];
    const out = []; const reX = /<xf\s[^>]*?\/?>/g;
    while ((m = reX.exec(xfs[1]))) {
      const id = +attr(m[0], 'numFmtId') || 0;
      out.push(BUILTIN_DATE[id] || (custom[id] !== undefined ? fmtKind(custom[id]) : ''));
    }
    return out;
  }

  const pad2 = n => String(n).padStart(2, '0');
  /** Número de serie de Excel → «HH:MM», «AAAA-MM-DD» o «AAAA-MM-DD HH:MM». */
  function serialText(v, kind, date1904) {
    const days = Math.floor(v + 1e-9), frac = v - days;
    let mins = Math.round(frac * 1440); let dd = days;
    if (mins >= 1440) { mins -= 1440; dd++; }
    const hm = pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(base + dd * 86400000);
    const iso = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    if (kind === 't' || (kind === 'dt' && days === 0)) return hm;
    if (kind === 'd' || (kind === 'dt' && mins === 0)) return iso;
    return iso + ' ' + hm;
  }
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /** XML de una hoja → filas de celdas (texto). */
  function sheetRows(xml, ss, kinds, date1904) {
    const rows = []; let m;
    const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    while ((m = reRow.exec(xml))) {
      const cells = []; let c; let next = 0;
      const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while ((c = reC.exec(m[1]))) {
        const tag = '<c ' + c[1] + '>', body = c[2] || '';
        const ref = attr(tag, 'r'), ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        const t = attr(tag, 't'), s = +attr(tag, 's') || 0;
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body), v = vm ? unxml(vm[1]) : '';
        let txt = '';
        if (t === 's') txt = ss[+v] || '';
        else if (t === 'inlineStr') txt = richText(body);
        else if (t === 'str' || t === 'e') txt = v;
        else if (t === 'b') txt = v === '1' ? 'VERDADERO' : 'FALSO';
        else if (t === 'd') txt = v.replace('T', ' ').replace(/:\d\d(\.\d+)?Z?$/, '');
        else if (v !== '') {
          const num = Number(v);
          txt = kinds[s] && isFinite(num) ? serialText(num, kinds[s], date1904) : isFinite(num) ? String(Number(num.toPrecision(12))) : v;
        }
        cells[ci] = txt.replace(/[\t\r\n]+/g, ' ').trim();
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      if (cells.some(x => x)) rows.push(cells);
    }
    // Sin las columnas vacías del final (hojas con formato hasta la columna AG, sin datos)
    const used = rows.reduce((m, r) => { for (let i = r.length - 1; i >= 0; i--) if (r[i]) return Math.max(m, i + 1); return m; }, 0);
    return rows.map(r => r.slice(0, used));
  }

  /** .xlsx (ArrayBuffer o Uint8Array) → { text (TSV), sheet, sheets } — la primera hoja (en orden del libro) que tenga datos. */
  async function toTSV(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes.length < 4 || u32(bytes, 0) !== 0x04034b50) {
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('Es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx o CSV, o copia y pega las celdas');
      throw new Error('No es un archivo Excel (.xlsx) válido');
    }
    const idx = zipIndex(bytes);
    const wb = await zipText(bytes, idx, 'xl/workbook.xml');
    if (!wb) throw new Error('No es un archivo Excel (.xlsx) válido');
    const rels = (await zipText(bytes, idx, 'xl/_rels/workbook.xml.rels')) || '';
    const relTarget = {}; let m;
    const reR = /<Relationship\s[^>]*>/g;
    while ((m = reR.exec(rels))) {
      let tg = attr(m[0], 'Target') || '';
      tg = tg[0] === '/' ? tg.slice(1) : 'xl/' + tg;
      relTarget[attr(m[0], 'Id')] = tg.replace(/[^/]+\/\.\.\//g, '');
    }
    const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
    const sheets = []; const reS = /<sheet\s[^>]*>/g;
    while ((m = reS.exec(wb))) sheets.push({ name: attr(m[0], 'name') || '', path: relTarget[attr(m[0], 'r:id')] || '' });
    const ss = sharedStrings(await zipText(bytes, idx, 'xl/sharedStrings.xml'));
    const kinds = styleKinds(await zipText(bytes, idx, 'xl/styles.xml'));
    const all = [];
    for (const sh of sheets) {
      const xml = sh.path && await zipText(bytes, idx, sh.path);
      if (!xml) continue;
      const rows = sheetRows(xml, ss, kinds, date1904);
      if (rows.length) all.push({ name: sh.name, text: rows.map(r => r.join('\t')).join('\n') });
    }
    const f = all[0] || { name: '', text: '' };
    return { text: f.text, sheet: f.name, sheets: sheets.map(s => s.name), all };
  }

  const API = { toTSV, _: { zipIndex, sharedStrings, styleKinds, fmtKind, serialText, colIndex, sheetRows, unxml } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ShowtimeXlsx = API;
})(typeof window !== 'undefined' ? window : globalThis);
