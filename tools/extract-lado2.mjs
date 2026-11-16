// Lado 2 del proyecto (plano "lotificación polígono 1B"): pdfdata/pdfimport-lado2.dxf
// Bloque A (19 lotes), bloque B (4), bloque C (10) y 5 locales comerciales, más calles y área verde.
// Lo llama tools/extract-lotes.mjs; las coordenadas quedan en metros del dibujo (X al este, Y al norte del papel)
// y el mapa las ubica con SITIO.plano2 (js/config.js).
import { readDxf, cleanText } from './dxf.mjs';
import { faces, segmentsFrom, inside, area } from './polygonize.mjs';
import { VRS_POR_M2, centro, simplificar, ladosAprox, trazarCalles, redondear } from './plano-utils.mjs';

export const SECTOR = '1B';

// Solo el terreno: sin la calle existente (x > 219, ya está en el mapa) ni el título (y < 40)
const enTerreno = ([x, y]) => x < 219 && y > 40;

export function extraerLado2(archivo = 'pdfdata/pdfimport-lado2.dxf') {
  const ents = readDxf(archivo);
  const segs = segmentsFrom(ents).filter(s => s.every(enTerreno));
  const F = faces(segs).filter(f => f.area > 20);
  const T = ents.filter(x => x.type === 'MTEXT').map(x => ({ t: cleanText(x.text), p: x.pts[0] }));
  const caraEn = p => F.filter(f => inside(p, f.ring)).sort((a, b) => a.area - b.area)[0];

  // Eje de la calle principal (entre los bloques A y C): lo que queda al norte es bloque C
  const eje = ([x, y]) => y - (91.1 + (x - 75.6) * (77 - 91.1) / (166.5 - 75.6));

  const lotes = [], usadas = new Set();
  for (const a of T.filter(t => /^AREA:\d/.test(t.t))) {
    const area_m2 = parseFloat(a.t.slice(5));
    let f = caraEn(a.p);
    // El número del lote va justo encima del rótulo de área
    const ref = [a.p[0] + 2, a.p[1] + 2.5];
    const num = T.filter(t => /^\d{1,2}$/.test(t.t) && inside(t.p, f.ring))
      .sort((x, y) => Math.hypot(x.p[0] - ref[0], x.p[1] - ref[1]) - Math.hypot(y.p[0] - ref[0], y.p[1] - ref[1]))[0];
    const local = T.some(t => t.t === 'LOCAL' && inside(t.p, f.ring));
    const c = centro(f.ring);
    const bloque = local ? 'L' : c[0] > 184 && c[1] > 75 ? 'B' : c[0] > 60 && eje(c) > 0 ? 'C' : 'A';
    let anillo = f.ring;
    // Correcciones al dibujo
    if (bloque === 'A' && +num.t === 15) { // una línea interior parte el lote 15 en dos: se unen
      const resto = caraEn([58, 69]);
      anillo = unir(f.ring, resto.ring);
      usadas.add(resto);
    }
    if (bloque === 'B' && +num.t === 2) { // su cara sale fundida con la calle: el lote es el rectángulo de 17 × 10 m
      anillo = rectanguloEn(f.ring, [189, 84], [207, 94.5]); // y la cara queda como calle (abajo se le recorta el lote)
    } else usadas.add(f);
    lotes.push({
      id: `${SECTOR}-${bloque}-${num.t}`, sector: SECTOR, bloque, numero: +num.t,
      ...(local ? { tipo: 'local' } : {}),
      area_m2, area_vrs2: +(area_m2 * VRS_POR_M2).toFixed(2),
      area_dibujo_m2: +Math.abs(area(anillo)).toFixed(2),
      lados_m: ladosAprox(anillo),
      poligono: simplificar(anillo).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]),
    });
  }

  const verde = caraEn(T.find(t => t.t === 'VERDE').p);
  usadas.add(verde);
  // Calles: el resto de las caras del terreno; la del extremo este trae dentro el lote B-2 y se le recorta
  const poligonosLotes = lotes.map(l => l.poligono);
  const calles = F.filter(f => !usadas.has(f) && f.area > 20).map(f => sinLotes(f.ring, poligonosLotes));
  const trazado = trazarCalles(calles, segs);

  const orden = { A: 0, B: 1, C: 2, L: 3 };
  lotes.sort((a, b) => orden[a.bloque] - orden[b.bloque] || a.numero - b.numero);

  const base = {
    lineas: ents.filter(x => x.type === 'LWPOLYLINE' && x.layer === 'PDF_0' && x.pts.every(enTerreno))
      .map(x => redondear(x.flags & 1 ? [...x.pts, x.pts[0]] : x.pts)),
    calles: trazado,
    verdes: [redondear(simplificar(verde.ring))],
    // Árboles dibujados en el área verde
    arboles: ents.filter(x => x.type === 'LWPOLYLINE' && x.layer === 'PDF_a_VEG' && x.pts.every(enTerreno))
      .map(x => redondear(x.flags & 1 ? [...x.pts, x.pts[0]] : x.pts)),
    textos: ents.filter(x => x.type === 'MTEXT' && cleanText(x.text) === 'CALLE').slice(0, 1).map(x => ({
      texto: 'CALLE', p: x.pts[0].map(v => +v.toFixed(2)),
      angulo: +(Math.atan2(x.p2?.[1] ?? 0, x.p2?.[0] ?? 1) * 180 / Math.PI).toFixed(2), alto: +x.r.toFixed(2),
    })),
  };

  const cuenta = b => lotes.filter(l => l.bloque === b).length;
  console.log(`lado 2: ${lotes.length}  A:${cuenta('A')} B:${cuenta('B')} C:${cuenta('C')} locales:${cuenta('L')}`);
  for (const l of lotes) { const d = l.area_dibujo_m2 - l.area_m2; if (Math.abs(d) > 3) console.log(`  ${l.id}: rótulo ${l.area_m2} vs dibujo ${l.area_dibujo_m2} (${d.toFixed(1)})`); }
  return { lotes, base };
}

// Une dos caras vecinas del mismo dibujo: se cancelan los tramos que comparten y se encadena el contorno
function unir(r1, r2) {
  const k = p => p.map(v => v.toFixed(4)).join(',');
  const tramos = new Map();
  for (const r of [r1, r2]) r.forEach((p, i) => tramos.set(k(p) + '>' + k(r[(i + 1) % r.length]), [p, r[(i + 1) % r.length]]));
  for (const key of [...tramos.keys()]) {
    const [a, b] = key.split('>');
    if (tramos.has(b + '>' + a)) { tramos.delete(key); tramos.delete(b + '>' + a); }
  }
  const desde = new Map([...tramos.values()].map(([p, q]) => [k(p), [p, q]]));
  const [inicio] = desde.values(), out = [];
  for (let t = inicio; t && out.length <= tramos.size; t = desde.get(k(t[1]))) {
    out.push(t[0]);
    if (k(t[1]) === k(inicio[0])) break;
  }
  return out;
}

// Vértices de la cara dentro de un recuadro, ordenados alrededor de su centro
function rectanguloEn(ring, [x0, y0], [x1, y1]) {
  const k = p => p.map(v => v.toFixed(3)).join(',');
  const pts = [...new Map(ring.filter(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1).map(p => [k(p), p])).values()];
  const c = centro(pts);
  return simplificar(pts.sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0])));
}

// Quita del contorno los rodeos que encierran un lote (el contorno pasa dos veces por el mismo vértice)
function sinLotes(ring, lotes) {
  const k = p => p.map(v => v.toFixed(2)).join(',');
  let r = [...ring];
  for (let cambio = true; cambio;) {
    cambio = false;
    for (let i = 0; i < r.length && !cambio; i++)
      for (let j = i + 1; j < r.length && !cambio; j++) {
        if (k(r[i]) !== k(r[j])) continue;
        const lazo = r.slice(i, j);
        if (lazo.length > 2 && lotes.some(l => inside(centro(l), lazo))) { r.splice(i + 1, j - i); cambio = true; }
      }
  }
  return simplificar(r);
}
