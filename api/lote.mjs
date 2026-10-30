// /lote/A-1 → página mínima con vista previa para WhatsApp/Facebook (og:image = og/A-1.png) que redirige a /mapa?lote=A-1
// En Vercel corre como función (vercel.json la enlaza con /lote/:id); en local la usa tools/serve.mjs
import fs from 'node:fs';

const lotes = JSON.parse(fs.readFileSync(new URL('../data/lotes.json', import.meta.url), 'utf8'));
const fmt = n => n.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const id = (url.searchParams.get('id') || url.pathname.split('/').pop() || '').toUpperCase();
  const lote = lotes.find(l => l.id === id);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origen = `${req.headers['x-forwarded-proto'] || 'http'}://${host}`;
  const destino = lote ? `/mapa?lote=${lote.id}` : '/mapa';
  const titulo = lote ? `Lote ${lote.id} · Lomas del Puerto` : 'Lomas del Puerto · Lotes disponibles';
  const desc = lote
    ? `${fmt(lote.area_m2)} m² · ${fmt(lote.area_vrs2)} vrs² en Barrio Lomas del Puerto, Puerto Cortés.`
    : 'Lotes residenciales en Barrio Lomas del Puerto, Puerto Cortés.';
  const imagen = lote ? `${origen}/og/${lote.id}.png` : '';

  res.statusCode = lote ? 200 : 404;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=86400');
  res.end(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lomas del Puerto">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${origen}/lote/${lote ? lote.id : ''}">
${imagen ? `<meta property="og:image" content="${imagen}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${imagen}">` : ''}
<meta http-equiv="refresh" content="0; url=${destino}">
</head>
<body>
<script>location.replace(${JSON.stringify(destino)})</script>
<p><a href="${destino}">Ver ${lote ? `el lote ${lote.id}` : 'los lotes'} en el mapa</a></p>
</body>
</html>`);
}
