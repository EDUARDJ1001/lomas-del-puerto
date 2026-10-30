// Genera supabase/seed.sql con los 53 lotes (geometría de data/lotes.json + inventario de data/inventario.json)
// node tools/seed-supabase.mjs  →  pegar supabase/seed.sql en el SQL Editor de Supabase
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const lotes = read('data/lotes.json');
const inv = read('data/inventario.json');

const q = v => v == null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const arr = a => `array[${a.map(q).join(', ')}]::text[]`;

const filas = lotes.map(l => {
  const i = inv[l.id] || {};
  // Las fotos locales son 'fotos/A-7/1.jpg'; en el bucket "fotos" la ruta es 'A-7/1.jpg'
  const fotos = (i.fotos || []).map(f => f.replace(/^fotos\//, ''));
  return `  (${[q(l.id), q(l.bloque), l.numero, l.area_m2, l.area_vrs2,
    q(i.estado || 'disponible'), q(i.precio ?? null), q(i.descripcion || ''), q(i.medidas ?? null), arr(fotos)].join(', ')})`;
});

const sql = `-- Generado por tools/seed-supabase.mjs — carga inicial de los ${lotes.length} lotes.
-- Si un lote ya existe solo se actualizan sus áreas; estado, precio y fotos editados en Supabase se conservan.
insert into public.lotes (id, bloque, numero, area_m2, area_vrs2, estado, precio, descripcion, medidas, fotos) values
${filas.join(',\n')}
on conflict (id) do update set area_m2 = excluded.area_m2, area_vrs2 = excluded.area_vrs2;
`;

fs.writeFileSync(path.join(root, 'supabase/seed.sql'), sql);
console.log(`supabase/seed.sql: ${lotes.length} lotes`);
