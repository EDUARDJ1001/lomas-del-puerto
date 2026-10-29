// Extrae los 53 lotes de pdfdata/pdfimport.dxf (PDFIMPORT del plano) -> data/lotes.json + data/plano-base.json
// Uso: node tools/extract-lotes.mjs
import fs from 'node:fs';
import { readDxf, cleanText } from './dxf.mjs';
import { faces, segmentsFrom, inside, area } from './polygonize.mjs';

const VRS_POR_M2 = 1.43424; // factor usado en el plano (170 m² = 243.82 vrs²)

// Correcciones al dibujo: líneas faltantes en el PDF original
const LINEAS_FALTANTES = [
  [[90.68, 134.52], [82.20, 139.77]], // frente del lote A-3
];

const ents = readDxf('pdfdata/pdfimport.dxf');
const segs = segmentsFrom(ents).concat(LINEAS_FALTANTES);
const F = faces(segs).filter(f => f.area > 50);
const T = ents.filter(x => x.type === 'MTEXT').map(x => ({ t: cleanText(x.text), p: x.pts[0] }));
const caraEn = p => F.filter(f => inside(p, f.ring)).sort((a, b) => a.area - b.area)[0];

// Los números de lote aparecen en orden: bloque A (1-18), B (1-21), C (1-14)
const etiquetas = [];
let bloque = null, anterior = 0;
for (const t of T) {
  if (!/^\d{1,2}( \d{1,2})?$/.test(t.t)) continue;
  if (t.t === '8' && Math.abs(t.p[0] - 162.1) < 0.5) continue; // "8" suelto sobre la calle
  const ns = t.t.split(' ').map(Number);
  if (ns[0] === 1) bloque = { null: 'A', A: 'B', B: 'C' }[bloque];
  ns.forEach((n, i) => etiquetas.push({ bloque, numero: n, p: t.p, compartida: ns.length > 1 ? i : -1 }));
  anterior = ns.at(-1);
}

const areasRotuladas = T.filter(t => /^AREA:[\d.]+M/i.test(t.t) && !/vrs/i.test(t.t)).map(t => ({ v: parseFloat(t.t.slice(5)), p: t.p }));
const usadas = new Set();
const lotes = [];
for (const e of etiquetas) {
  let f = caraEn(e.p);
  if (e.compartida > 0) { // "7 8": el segundo lote es el vecino al este con área ~170 sin asignar
    f = F.filter(c => !usadas.has(c) && Math.abs(c.area - 170) < 5)
      .map(c => ({ c, d: Math.hypot(centro(c.ring)[0] - e.p[0], centro(c.ring)[1] - e.p[1]) }))
      .sort((a, b) => a.d - b.d)[0].c;
  }
  if (!f) throw new Error(`Sin polígono para ${e.bloque}-${e.numero}`);
  usadas.add(f);
  const rot = areasRotuladas.filter(a => inside(a.p, f.ring)).map(a => a.v);
  const area_m2 = rot.length ? rot[0] : 170;
  lotes.push({
    id: `${e.bloque}-${e.numero}`, bloque: e.bloque, numero: e.numero,
    area_m2, area_vrs2: +(area_m2 * VRS_POR_M2).toFixed(2),
    area_dibujo_m2: +f.area.toFixed(2),
    lados_m: ladosAprox(f.ring),
    poligono: simplificar(f.ring).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]),
  });
}

function centro(r) { return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; }
// Quita vértices casi duplicados y colineales, de uno en uno: varios puntos muy juntos en una esquina
// parecen colineales entre sí y quitarlos todos a la vez borraba la esquina (lote B-9).
function simplificar(r) {
  const out = [...r];
  const desvio = (a, p, b) => { // distancia de p a la recta a-b
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return L < 1e-9 ? 0 : Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L;
  };
  for (let quitado = true; quitado && out.length > 3;) {
    quitado = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      if (Math.hypot(p[0] - b[0], p[1] - b[1]) < 0.15 || desvio(a, p, b) < 0.03) { out.splice(i, 1); quitado = true; break; }
    }
  }
  return out;
}

// Medidas por lado solo para lotes de 4 lados: se fusionan vértices con giro < 10° (llegada de linderos vecinos)
function ladosAprox(r) {
  const out = simplificar(r);
  for (let quitado = true; quitado && out.length > 4;) {
    quitado = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const giro = Math.abs(Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]));
      if (Math.min(giro, 2 * Math.PI - giro) < 10 * Math.PI / 180) { out.splice(i, 1); quitado = true; break; }
    }
  }
  if (out.length !== 4) return null;
  return out.map((p, i) => +Math.hypot(p[0] - out[(i + 1) % 4][0], p[1] - out[(i + 1) % 4][1]).toFixed(1));
}

// Calles: caras grandes que no son lotes (algunas vienen partidas en dos mitades por su línea central)
const calles = F.filter(f => !usadas.has(f) && f.area > 500);
const enCalle = p => calles.some(c => inside(p, c.ring));
// Un tramo con calle a ambos lados es eje central; con calle a un solo lado, borde
const ladosEnCalle = (a, b, t) => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / L * 0.3, (b[0] - a[0]) / L * 0.3];
  const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [enCalle([m[0] + n[0], m[1] + n[1]]), enCalle([m[0] - n[0], m[1] - n[1]])];
};
const redondear = s => s.map(p => p.map(v => +v.toFixed(2)));
const bordes = calles.flatMap(c => c.ring.map((p, i) => [p, c.ring[(i + 1) % c.ring.length]]))
  .filter(([a, b]) => ladosEnCalle(a, b, 0.5).filter(Boolean).length === 1).map(redondear);
// El eje va paralelo al borde más cercano; se descartan las uniones transversales entre tramos de calle
const paraleloAlBorde = ([a, b]) => {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = ([p, q]) => {
    const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    const t = Math.max(0, Math.min(1, ((m[0] - p[0]) * (q[0] - p[0]) + (m[1] - p[1]) * (q[1] - p[1])) / L2));
    return Math.hypot(m[0] - p[0] - t * (q[0] - p[0]), m[1] - p[1] - t * (q[1] - p[1]));
  };
  const [p, q] = bordes.reduce((best, s) => (dist(s) < dist(best) ? s : best));
  const cos = Math.abs((b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1])) /
    (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(q[0] - p[0], q[1] - p[1]));
  return cos > Math.cos(Math.PI / 4);
};
const ejes = segs.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.2 &&
  [0.25, 0.5, 0.75].every(t => ladosEnCalle(a, b, t).every(Boolean))).filter(paraleloAlBorde).map(redondear);

// Fondo: todas las líneas del dibujo dentro del marco (sin cuadro de áreas ni membrete)
const enMarco = ([x, y]) => x > 52 && x < 416 && y > 50 && y < 290 && !(x < 110 && y > 240); // sin rosa de los vientos
const base = {
  lineas: ents.filter(x => x.type === 'LWPOLYLINE' && x.layer === 'PDF_0' && x.pts.every(enMarco))
    .map(x => (x.flags & 1 ? [...x.pts, x.pts[0]] : x.pts).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])),
  calles: { superficies: calles.map(c => redondear(c.ring)), ejes, bordes },
  // MTEXT: punto de inserción arriba-izquierda, dirección en p2, altura en r
  textos: ents.filter(x => x.type === 'MTEXT' && /CALLE/.test(x.text)).map(x => ({
    texto: cleanText(x.text), p: x.pts[0].map(v => +v.toFixed(2)),
    angulo: +(Math.atan2(x.p2?.[1] ?? 0, x.p2?.[0] ?? 1) * 180 / Math.PI).toFixed(2), alto: +x.r.toFixed(2),
  })),
};

const orden = { A: 0, B: 1, C: 2 };
lotes.sort((a, b) => orden[a.bloque] - orden[b.bloque] || a.numero - b.numero);
fs.writeFileSync('data/lotes.json', JSON.stringify(lotes, null, 1));
fs.writeFileSync('data/plano-base.json', JSON.stringify(base));

const total = lotes.reduce((s, l) => s + l.area_m2, 0);
console.log(`lotes: ${lotes.length}  A:${lotes.filter(l => l.bloque === 'A').length} B:${lotes.filter(l => l.bloque === 'B').length} C:${lotes.filter(l => l.bloque === 'C').length}`);
console.log(`área total rotulada: ${total.toFixed(2)} m² (plano: 17,292.13)`);
for (const l of lotes) { const d = l.area_dibujo_m2 - l.area_m2; if (Math.abs(d) > 3) console.log(`  ${l.id}: rótulo ${l.area_m2} vs dibujo ${l.area_dibujo_m2} (${d.toFixed(1)})`); }
