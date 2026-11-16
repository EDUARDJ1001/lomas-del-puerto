// Funciones compartidas por los extractores de lotes (tools/extract-lotes.mjs y tools/extract-lado2.mjs)
import { inside } from './polygonize.mjs';

export const VRS_POR_M2 = 1.43424; // factor usado en el plano (170 m² = 243.82 vrs²)

export function centro(r) { return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; }
export const redondear = s => s.map(p => p.map(v => +v.toFixed(2)));

// Quita vértices casi duplicados y colineales, de uno en uno: varios puntos muy juntos en una esquina
// parecen colineales entre sí y quitarlos todos a la vez borraba la esquina (lote B-9).
export function simplificar(r) {
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
export function ladosAprox(r) {
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

// Calles a partir de sus superficies: bordes (tramos con calle a un solo lado) y ejes centrales
// (líneas del dibujo con calle a ambos lados, paralelas al borde más cercano)
export function trazarCalles(calles, segs) {
  const enCalle = p => calles.some(c => inside(p, c));
  const ladosEnCalle = (a, b, t) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / L * 0.3, (b[0] - a[0]) / L * 0.3];
    const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [enCalle([m[0] + n[0], m[1] + n[1]]), enCalle([m[0] - n[0], m[1] - n[1]])];
  };
  const bordes = calles.flatMap(c => c.map((p, i) => [p, c[(i + 1) % c.length]]))
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
  return { superficies: calles.map(redondear), ejes, bordes };
}
