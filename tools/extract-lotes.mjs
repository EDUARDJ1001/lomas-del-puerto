// Extrae los 75 lotes del primer plano de pdfdata/pdfimport-lado1-updt20nov.dxf (PDFIMPORT del plano actualizado al 20-nov-2026)
// -> data/lotes.json + data/plano-base.json, y con tools/extract-lado2.mjs los del lado 2 (pdfdata/pdfimport-lado2.dxf)
// -> data/lotes.json + data/plano-base-lado2.json
// Uso: node tools/extract-lotes.mjs
import fs from 'node:fs';
import { readDxf, cleanText } from './dxf.mjs';
import { faces, segmentsFrom, inside } from './polygonize.mjs';
import { VRS_POR_M2, centro, simplificar, trazarCalles } from './plano-utils.mjs';
import { extraerLado2 } from './extract-lado2.mjs';

// Lotes cuyo rótulo de área no se actualizó en el plano: C-22 (antes C-14) cedió terreno a B-21, pero su rótulo
// sigue en 743.42 m²; se usa el área del dibujo. Los demás usan su rótulo (los de 170 m² también, aunque el dibujo dé algo menos)
const AREA_DEL_DIBUJO = ['C-22'];

// Correcciones al dibujo: líneas faltantes en el PDF original
const LINEAS_FALTANTES = [
  [[90.68, 134.52], [82.20, 139.77]], // frente del lote A-3
];

// Cada versión del plano viene corrida respecto a la primera (pdfimport.dxf): se lleva al sistema de coordenadas
// original para que SITIO.plano (js/config.js) y las correcciones de arriba sigan valiendo
const DESPLAZAMIENTO = [17.954, 68.743];
const ents = readDxf('pdfdata/pdfimport-lado1-updt20nov.dxf');
for (const e of ents) {
  e.pts = e.pts.map(([x, y]) => [x + DESPLAZAMIENTO[0], y + DESPLAZAMIENTO[1]]);
  if (e.p2 && e.type !== 'MTEXT') e.p2 = [e.p2[0] + DESPLAZAMIENTO[0], e.p2[1] + DESPLAZAMIENTO[1]]; // en MTEXT p2 es una dirección
}
const segs = segmentsFrom(ents).concat(LINEAS_FALTANTES);
const F = faces(segs).filter(f => f.area > 50);
const T = ents.filter(x => x.type === 'MTEXT').map(x => ({ t: cleanText(x.text), p: x.pts[0], r: x.r }));
const caraEn = p => F.filter(f => inside(p, f.ring)).sort((a, b) => a.area - b.area)[0];

// Números de lote (letra de 2 m; las cotas sin unidad usan letra más chica), en orden: bloque A (1-18),
// B (1-21) y C (1-22; el 4 al 15 vienen al final)
const etiquetas = [];
let bloque = null;
for (const t of T) {
  if (!/^\d{1,2}( \d{1,2})?$/.test(t.t) || Math.abs(t.r - 2.01) > 0.05) continue;
  const ns = t.t.split(' ').map(Number);
  if (ns[0] === 1) bloque = { null: 'A', A: 'B', B: 'C' }[bloque];
  ns.forEach((n, i) => etiquetas.push({ bloque, numero: n, p: t.p, compartida: ns.length > 1 ? i : -1 }));
}

// Cotas de los lados ("17.00m", "10,20m", "18,6"): letra de menos de 2 m
const cotas = T.filter(t => t.r < 1.9 && /^\d+([.,]\d+)?\.?m?$/i.test(t.t))
  .map(t => ({ v: parseFloat(t.t.replace(',', '.')), p: t.p }));

// Lados del lote: se fusionan vértices con giro < 10° (llegada de linderos vecinos) y cada lado toma la cota
// escrita junto a él si coincide con el dibujo (±15 %); si no, su largo medido
function lados(ring) {
  const out = simplificar(ring);
  for (let quitado = true; quitado && out.length > 3;) {
    quitado = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const giro = Math.abs(Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]));
      const corto = Math.hypot(p[0] - b[0], p[1] - b[1]) < 1.5 || Math.hypot(p[0] - a[0], p[1] - a[1]) < 1.5;
      if (Math.min(giro, 2 * Math.PI - giro) < 10 * Math.PI / 180 || (corto && out.length > 4)) { out.splice(i, 1); quitado = true; break; }
    }
  }
  const dSeg = (m, a, b) => {
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = Math.max(0, Math.min(1, ((m[0] - a[0]) * (b[0] - a[0]) + (m[1] - a[1]) * (b[1] - a[1])) / L2));
    return Math.hypot(m[0] - a[0] - t * (b[0] - a[0]), m[1] - a[1] - t * (b[1] - a[1]));
  };
  const propias = cotas.filter(c => inside(c.p, ring));
  let conCota = 0;
  const res = out.map((a, i) => {
    const b = out[(i + 1) % out.length], largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const c = propias.map(c => ({ ...c, d: dSeg(c.p, a, b) })).filter(c => c.d < 4 && Math.abs(c.v - largo) / largo < 0.15).sort((x, y) => x.d - y.d)[0];
    if (c) conCota++;
    return +(c ? c.v : largo).toFixed(2);
  });
  return { lados: res, conCota };
}

const areasRotuladas = T.filter(t => /^AREA:[\d.]+M/i.test(t.t) && !/vrs/i.test(t.t)).map(t => ({ v: parseFloat(t.t.slice(5)), p: t.p }));
const usadas = new Set();
const lotes = [];
let sinCotas = 0;
for (const e of etiquetas) {
  let f = caraEn(e.p);
  if (e.compartida > 0) { // "7 8": el segundo lote es el vecino al este con área ~170 sin asignar
    f = F.filter(c => !usadas.has(c) && Math.abs(c.area - 170) < 5)
      .map(c => ({ c, d: Math.hypot(centro(c.ring)[0] - e.p[0], centro(c.ring)[1] - e.p[1]) }))
      .sort((a, b) => a.d - b.d)[0].c;
  }
  const id = `${e.bloque}-${e.numero}`;
  if (!f) throw new Error(`Sin polígono para ${id}`);
  if (usadas.has(f)) throw new Error(`${id} cae en un polígono ya usado`);
  usadas.add(f);
  // Rótulo de m² dentro del lote (algunos traen también el de vrs² mal marcado como m²): el más cercano al dibujo
  const rot = areasRotuladas.filter(a => inside(a.p, f.ring)).map(a => a.v).sort((a, b) => Math.abs(a - f.area) - Math.abs(b - f.area))[0];
  const area_m2 = AREA_DEL_DIBUJO.includes(id) || !rot ? +f.area.toFixed(2) : rot;
  const { lados: lados_m, conCota } = lados(f.ring);
  sinCotas += lados_m.length - conCota;
  lotes.push({
    id, bloque: e.bloque, numero: e.numero,
    area_m2, area_vrs2: +(area_m2 * VRS_POR_M2).toFixed(2),
    area_dibujo_m2: +f.area.toFixed(2),
    lados_m,
    poligono: simplificar(f.ring).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]),
  });
}

// Calles: caras grandes que no son lotes (algunas vienen partidas en dos mitades por su línea central)
const calles = F.filter(f => !usadas.has(f) && f.area > 500);
const trazado = trazarCalles(calles.map(c => c.ring), segs);

// Fondo: todas las líneas del dibujo dentro del marco (sin cuadro de áreas ni membrete)
const enMarco = ([x, y]) => x > 52 && x < 416 && y > 50 && y < 290 && !(x < 110 && y > 240); // sin rosa de los vientos
const base = {
  lineas: ents.filter(x => x.type === 'LWPOLYLINE' && x.layer === 'PDF_0' && x.pts.every(enMarco))
    .map(x => (x.flags & 1 ? [...x.pts, x.pts[0]] : x.pts).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])),
  calles: trazado,
  // MTEXT: punto de inserción arriba-izquierda, dirección en p2, altura en r
  textos: ents.filter(x => x.type === 'MTEXT' && /CALLE/.test(x.text)).map(x => ({
    texto: cleanText(x.text), p: x.pts[0].map(v => +v.toFixed(2)),
    angulo: +(Math.atan2(x.p2?.[1] ?? 0, x.p2?.[0] ?? 1) * 180 / Math.PI).toFixed(2), alto: +x.r.toFixed(2),
  })),
};

const orden = { A: 0, B: 1, C: 2 };
lotes.sort((a, b) => orden[a.bloque] - orden[b.bloque] || a.numero - b.numero);
// Lado 2 (polígono 1B): en su propio sistema de coordenadas, ubicado en el mapa con SITIO.plano2 (js/config.js)
const lado2 = extraerLado2();
fs.writeFileSync('data/lotes.json', JSON.stringify([...lotes, ...lado2.lotes], null, 1));
fs.writeFileSync('data/plano-base.json', JSON.stringify(base));
fs.writeFileSync('data/plano-base-lado2.json', JSON.stringify(lado2.base));

const total = lotes.reduce((s, l) => s + l.area_m2, 0);
console.log(`lotes: ${lotes.length}  A:${lotes.filter(l => l.bloque === 'A').length} B:${lotes.filter(l => l.bloque === 'B').length} C:${lotes.filter(l => l.bloque === 'C').length}`);
console.log(`área total: ${total.toFixed(2)} m²  ·  lados sin cota escrita (se usa el largo medido): ${sinCotas}`);
for (const l of lotes) { const d = l.area_dibujo_m2 - l.area_m2; if (Math.abs(d) > 3) console.log(`  ${l.id}: rótulo ${l.area_m2} vs dibujo ${l.area_dibujo_m2} (${d.toFixed(1)})`); }
