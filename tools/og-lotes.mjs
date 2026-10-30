// Miniaturas para compartir (og:image): og/A-1.png … un recorte del plano con el lote marcado, 1200×630
// node tools/og-lotes.mjs   (usa Chrome o Edge sin ventana para tomar la captura)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const lotes = read('data/lotes.json');
const base = read('data/plano-base.json');

const navegador = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => p && fs.existsSync(p));
if (!navegador) throw new Error('No se encontró Chrome ni Edge; indica la ruta con CHROME=...');

const W = 1200, H = 630;
const fmt = (n, d = 2) => n.toLocaleString('es-HN', { minimumFractionDigits: d, maximumFractionDigits: d });
const pt = ([x, y]) => `${x},${-y}`;
const seg = segs => segs.map(([a, b]) => `M${pt(a)}L${pt(b)}`).join('');
const centro = p => p.reduce(([sx, sy], [x, y]) => [sx + x / p.length, sy + y / p.length], [0, 0]);

// Todo lo que no cambia entre lotes: calles, nombres de calles y bordes del plano
const fondo = [
  ...base.lineas.map(l => `<polyline class="base-line" points="${l.map(pt).join(' ')}"/>`),
  ...base.calles.superficies.map(s => `<polygon class="street" points="${s.map(pt).join(' ')}"/>`),
  `<path class="street-edge" d="${seg(base.calles.bordes)}"/>`,
  `<path class="street-center" d="${seg(base.calles.ejes)}"/>`,
  ...base.textos.map(t => `<text class="street-label" x="${t.p[0]}" y="${-t.p[1]}" dominant-baseline="hanging" transform="rotate(${-t.angulo} ${t.p[0]} ${-t.p[1]})">${t.texto}</text>`),
].join('');

const css = `
  body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #f4f2ec; font-family: Poppins, sans-serif; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .base-line { fill: none; stroke: #b9b4a6; stroke-width: .18; }
  .street { fill: #6b7075; stroke: #6b7075; stroke-width: .15; }
  .street-edge { fill: none; stroke: #3a3e42; stroke-width: .6; stroke-linecap: round; }
  .street-center { fill: none; stroke: #f5c400; stroke-width: .3; stroke-dasharray: 2.5 1.8; }
  .street-label { fill: #fff; font-size: 2px; font-weight: 600; paint-order: stroke; stroke: #6b7075; stroke-width: .8; }
  .lot { fill: #3f9f5f; stroke: #fff; stroke-width: .35; }
  .lot.sel { fill: #f2b33d; stroke: #1f2a24; stroke-width: .6; }
  .lot-label { font-size: 1.9px; font-weight: 600; text-anchor: middle; dominant-baseline: central; fill: #fff; }
  .lot-label.sel { font-size: 2.6px; fill: #1f2a24; }
  .card { position: absolute; left: 40px; bottom: 40px; padding: 26px 32px; border-radius: 18px; background: rgba(23, 34, 29, .92); color: #fff; }
  .card p { margin: 0; }
  .eyebrow { font-size: 18px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.7); }
  .titulo { font-size: 64px; font-weight: 600; line-height: 1.1; margin-top: 6px !important; }
  .area { font-size: 26px; color: rgba(255,255,255,.85); }`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-lotes-'));
fs.mkdirSync(path.join(root, 'og'), { recursive: true });

for (const l of lotes) {
  // Encuadre: el lote a la derecha del centro (la tarjeta ocupa la izquierda) y con vecinos alrededor
  const xs = l.poligono.map(p => p[0]), ys = l.poligono.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Alto mínimo 48 m; los lotes grandes se alejan lo necesario para verse completos en la mitad derecha
  const h = Math.max(48, (Math.max(...ys) - Math.min(...ys)) * 1.25, (Math.max(...xs) - Math.min(...xs)) * 2.2 * H / W);
  const w = h * W / H;
  const vb = [cx - w * 0.68, -cy - h / 2, w, h].join(' ');
  const lots = lotes.map(o => {
    const sel = o.id === l.id ? ' sel' : '';
    const [x, y] = centro(o.poligono);
    return `<polygon class="lot${sel}" points="${o.poligono.map(pt).join(' ')}"/><text class="lot-label${sel}" x="${x}" y="${-y}">${o.id}</text>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=block">
<style>${css}</style>
<svg viewBox="${vb}" preserveAspectRatio="xMidYMid slice">${fondo}${lots}</svg>
<div class="card">
  <p class="eyebrow">Lomas del Puerto · Puerto Cortés</p>
  <p class="titulo">Lote ${l.id}</p>
  <p class="area">${fmt(l.area_m2)} m² · ${fmt(l.area_vrs2)} vrs²</p>
</div>`;
  const archivo = path.join(tmp, `${l.id}.html`);
  fs.writeFileSync(archivo, html);
  execFileSync(navegador, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, '--virtual-time-budget=4000',
    `--screenshot=${path.join(root, 'og', `${l.id}.png`)}`, pathToFileURL(archivo).href,
  ], { stdio: 'ignore' });
  process.stdout.write(`${l.id} `);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nog/: ${lotes.length} miniaturas`);
