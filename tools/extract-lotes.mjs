// Extrae los 53 lotes de pdfdata/pdfimport-lado1.dxf (PDFIMPORT del plano, con los cambios de B-21 y C-14) -> data/lotes.json + data/plano-base.json
// y, con tools/extract-lado2.mjs, los del lado 2 (pdfdata/pdfimport-lado2.dxf) -> data/lotes.json + data/plano-base-lado2.json
// Uso: node tools/extract-lotes.mjs
import fs from 'node:fs';
import { readDxf, cleanText } from './dxf.mjs';
import { faces, segmentsFrom, inside } from './polygonize.mjs';
import { VRS_POR_M2, centro, simplificar, ladosAprox, trazarCalles } from './plano-utils.mjs';
import { extraerLado2 } from './extract-lado2.mjs';

// Lotes cuyo rótulo de área no se actualizó en el plano corregido
const AREA_DEL_DIBUJO = ['C-14'];

// Correcciones al dibujo: líneas faltantes en el PDF original
const LINEAS_FALTANTES = [
  [[90.68, 134.52], [82.20, 139.77]], // frente del lote A-3
];

// El plano corregido viene corrido respecto al primero (pdfimport.dxf): se lleva al sistema de coordenadas
// original para que SITIO.plano (js/config.js) y las correcciones de abajo sigan valiendo
const DESPLAZAMIENTO = [4.239, 45.748];
const ents = readDxf('pdfdata/pdfimport-lado1.dxf');
for (const e of ents) {
  e.pts = e.pts.map(([x, y]) => [x + DESPLAZAMIENTO[0], y + DESPLAZAMIENTO[1]]);
  if (e.p2 && e.type !== 'MTEXT') e.p2 = [e.p2[0] + DESPLAZAMIENTO[0], e.p2[1] + DESPLAZAMIENTO[1]]; // en MTEXT p2 es una dirección
}
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
  const id = `${e.bloque}-${e.numero}`;
  // C-14: el plano corregido le quitó terreno (pasó a B-21) pero su rótulo sigue en 743.42; se usa el área del dibujo
  const area_m2 = AREA_DEL_DIBUJO.includes(id) ? +f.area.toFixed(2) : rot.length ? rot[0] : 170;
  lotes.push({
    id, bloque: e.bloque, numero: e.numero,
    area_m2, area_vrs2: +(area_m2 * VRS_POR_M2).toFixed(2),
    area_dibujo_m2: +f.area.toFixed(2),
    lados_m: ladosAprox(f.ring),
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
console.log(`área total rotulada: ${total.toFixed(2)} m² (plano corregido: 17,514.59 con el rótulo viejo de C-14)`);
for (const l of lotes) { const d = l.area_dibujo_m2 - l.area_m2; if (Math.abs(d) > 3) console.log(`  ${l.id}: rótulo ${l.area_m2} vs dibujo ${l.area_dibujo_m2} (${d.toFixed(1)})`); }
