// Minimal DXF reader: ENTITIES section -> LWPOLYLINE, LINE, ARC, MTEXT, TEXT
import fs from 'node:fs';

export function readDxf(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1]]);
  let i = pairs.findIndex(([c, v], k) => c === 2 && v.trim() === 'ENTITIES' && pairs[k - 1][1].trim() === 'SECTION');
  const ents = [];
  let cur = null;
  for (i++; i < pairs.length; i++) {
    const [c, raw] = pairs[i];
    const v = raw.trim();
    if (c === 0) {
      if (cur) ents.push(cur);
      if (v === 'ENDSEC') break;
      cur = { type: v, layer: '', pts: [], text: '' };
      continue;
    }
    if (!cur) continue;
    switch (c) {
      case 8: cur.layer = v; break;
      case 10: cur.pts.push([parseFloat(v), 0]); break;
      case 20: cur.pts[cur.pts.length - 1][1] = parseFloat(v); break;
      case 11: cur.p2 = [parseFloat(v), 0]; break;
      case 21: cur.p2[1] = parseFloat(v); break;
      case 40: cur.r = parseFloat(v); break;
      case 50: cur.a0 = parseFloat(v); break;
      case 51: cur.a1 = parseFloat(v); break;
      case 42: cur.bulge = true; break;
      case 70: cur.flags = parseInt(v, 10); break;
      case 1: case 3: cur.text += raw; break;
    }
  }
  return ents;
}

export function cleanText(t) {
  return t.replace(/\[A-Za-z][^;\{}]*;/g, '').replace(/\P/g, ' ').replace(/[{}]/g, '').trim();
}
