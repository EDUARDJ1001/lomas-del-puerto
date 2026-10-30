// Servidor estático para desarrollo: node tools/serve.mjs  ->  http://localhost:5180
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import lote from '../api/lote.mjs';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT) || 5180;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/lote/')) return lote(req, res); // en Vercel: rewrite de vercel.json a la función api/lote.mjs
  // Direcciones limpias como en Vercel (cleanUrls): /mapa -> mapa.html
  const file = path.join(root, url === '/' ? 'index.html' : path.extname(url) ? url : `${url}.html`);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('No encontrado');
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => {
  // Escucha en todas las interfaces: también accesible desde el celular en la misma red
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  for (const host of ['localhost', ...ips]) console.log(`http://${host}:${port}`);
});
