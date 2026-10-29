// Build planar faces from the PDF_0 linework and match each lot-number text to its face.
import { readDxf, cleanText } from './dxf.mjs';

export function segmentsFrom(ents, layer = 'PDF_0') {
  const segs = [];
  for (const x of ents) {
    if (x.type !== 'LWPOLYLINE' || x.layer !== layer) continue;
    const p = x.pts;
    for (let i = 0; i + 1 < p.length; i++) segs.push([p[i], p[i + 1]]);
    if (x.flags & 1 && p.length > 2) segs.push([p[p.length - 1], p[0]]);
  }
  return segs.filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6);
}

function intersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return [t, u];
}

// Extend dangling endpoints that stop just short of another segment (PDF linework often has tiny gaps).
function closeGaps(segs, tol) {
  for (const s of segs) {
    for (const end of [0, 1]) {
      const p = s[end], q = s[1 - end];
      const dir = [p[0] - q[0], p[1] - q[1]], L = Math.hypot(...dir);
      const ext = [p[0] + dir[0] / L * tol, p[1] + dir[1] / L * tol];
      let best = null;
      for (const o of segs) {
        if (o === s) continue;
        const hit = intersect(p, ext, o[0], o[1]);
        if (hit && hit[0] > 1e-6 && (!best || hit[0] < best)) best = hit[0];
      }
      if (best) s[end] = [p[0] + (ext[0] - p[0]) * best, p[1] + (ext[1] - p[1]) * best];
    }
  }
}

export function faces(segs, { snap = 0.02, gap = 0.3 } = {}) {
  closeGaps(segs, gap);
  const cuts = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const h = intersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (h) { cuts[i].push(h[0]); cuts[j].push(h[1]); }
    }
  const nodes = [], key = new Map();
  const nodeId = (p) => {
    const k = Math.round(p[0] / snap) + ',' + Math.round(p[1] / snap);
    if (!key.has(k)) { key.set(k, nodes.length); nodes.push(p); }
    return key.get(k);
  };
  const edges = new Set();
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map(t => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
      const q = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
      const u = nodeId(p), v = nodeId(q);
      if (u !== v) edges.add(u < v ? u + ':' + v : v + ':' + u);
    }
  });
  const adj = nodes.map(() => []);
  for (const e of edges) { const [u, v] = e.split(':').map(Number); adj[u].push(v); adj[v].push(u); }
  // prune dangling edges repeatedly
  let changed = true;
  while (changed) {
    changed = false;
    adj.forEach((ns, u) => { if (ns.length === 1) { const v = ns[0]; adj[u] = []; adj[v] = adj[v].filter(w => w !== u); changed = true; } });
  }
  const ang = (u, v) => Math.atan2(nodes[v][1] - nodes[u][1], nodes[v][0] - nodes[u][0]);
  adj.forEach((ns, u) => ns.sort((a, b) => ang(u, a) - ang(u, b)));
  const used = new Set(), out = [];
  for (let u = 0; u < nodes.length; u++)
    for (const v of adj[u]) {
      if (used.has(u + '>' + v)) continue;
      const ring = []; let a = u, b = v, guard = 0;
      while (!used.has(a + '>' + b) && guard++ < 10000) {
        used.add(a + '>' + b); ring.push(nodes[a]);
        const ns = adj[b], i = ns.indexOf(a);
        const c = ns[(i - 1 + ns.length) % ns.length]; // next edge clockwise -> traces faces CCW
        a = b; b = c;
      }
      const A = area(ring);
      if (A > 0) out.push({ ring, area: A });
    }
  return out;
}

export function area(r) { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return s / 2; }
export function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

