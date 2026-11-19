// Importa a Supabase la contabilidad que se llevaba en el HTML de control (clientes, lotes vendidos, pagos y gastos).
// Uso: node tools/importar-control.mjs [pdfdata/control_lotes.html]
// Genera pdfdata/importar-control.sql (queda fuera del repositorio: lleva nombres y montos) para pegarlo una sola vez
// en el SQL Editor de Supabase, después de supabase/contabilidad.sql. Si ya hay clientes cargados, no hace nada.
import fs from 'node:fs';
import crypto from 'node:crypto';

const archivo = process.argv[2] || 'pdfdata/control_lotes.html';
const html = fs.readFileSync(archivo, 'utf8');
const json = html.match(/<script id="db" type="application\/json">([\s\S]*?)<\/script>/);
if (!json) throw new Error(`No encontré los datos (<script id="db">) en ${archivo}`);
const db = JSON.parse(json[1]);
const geom = new Map(JSON.parse(fs.readFileSync('data/lotes.json', 'utf8')).map(l => [l.id, l]));

const q = v => v == null || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const t = v => `'${String(v ?? '').replace(/'/g, "''")}'`; // texto no nulo
const r2 = n => Math.round(n * 100) / 100;

const uuid = new Map(db.clientes.map(c => [c.id, crypto.randomUUID()]));
const lineas = [];

lineas.push('insert into public.clientes (id, nombre, telefono, nota) values');
lineas.push(db.clientes.map(c => `  (${q(uuid.get(c.id))}, ${t(c.nombre)}, ${t(c.tel)}, ${t(c.nota)})`).join(',\n') + ';');

// Una venta por cliente con todos sus lotes; cada lote conserva su precio por vara²
const ventas = [], ventaLotes = [];
const porCliente = new Map();
for (const l of db.lotes.filter(l => l.cliente)) {
  const id = `${l.bloque}-${l.numero}`;
  const g = geom.get(id);
  if (!g) throw new Error(`El lote ${id} no está en data/lotes.json`);
  if (!porCliente.has(l.cliente)) porCliente.set(l.cliente, []);
  porCliente.get(l.cliente).push({ ...l, id, vrs: g.area_vrs2 });
}
for (const [cliente, ls] of porCliente) {
  const vid = crypto.randomUUID();
  const prima = r2(ls.reduce((s, l) => s + (l.prima || 0), 0)), meses = Math.max(...ls.map(l => l.meses || 0));
  const fecha = ls.map(l => l.fecha).filter(Boolean).sort()[0] || null;
  const nota = [...new Set(ls.map(l => l.nota).filter(Boolean))].join(' · ');
  ventas.push(`  (${q(vid)}, ${q(uuid.get(cliente))}, ${q(fecha)}, ${t(meses > 0 ? 'cuotas' : 'contado')}, ${prima}, ${meses}, ${t(nota)})`);
  for (const l of ls) ventaLotes.push(`  (${t(l.id)}, ${q(vid)}, ${l.precio || 0}, ${r2(l.vrs * (l.precio || 0))})`);
}
lineas.push('insert into public.ventas (id, cliente_id, fecha, tipo, prima, meses, nota) values');
lineas.push(ventas.join(',\n') + ';');
lineas.push('insert into public.venta_lotes (lote_id, venta_id, precio_vara, precio) values');
lineas.push(ventaLotes.join(',\n') + ';');

const pagos = db.pagos.filter(p => p.monto > 0);
if (pagos.length) {
  lineas.push('insert into public.pagos (cliente_id, fecha, monto, forma, nota) values');
  lineas.push(pagos.map(p => `  (${q(uuid.get(p.cliente))}, ${q(p.fecha)}, ${p.monto}, ${t(p.forma)}, ${t(p.nota || p.tipo)})`).join(',\n') + ';');
}
if (db.gastos.length) {
  lineas.push('insert into public.gastos (fecha, descripcion, monto, nota) values');
  lineas.push(db.gastos.map(g => `  (${q(g.fecha)}, ${t(g.desc || g.nota || 'Gasto')}, ${g.monto || 0}, ${t(g.desc ? g.nota : '')})`).join(',\n') + ';');
}
lineas.push(`update public.ajustes set saldo_inicial = ${db.cfg?.saldoInicial || 0} where id = 1;`);

const sql = `-- Generado por tools/importar-control.mjs desde ${archivo}. Pegar una sola vez en el SQL Editor de Supabase.
-- Lleva datos privados: no subir al repositorio.
begin;
do $$ begin
  if exists (select 1 from public.clientes) then
    raise exception 'Ya hay clientes cargados en la contabilidad: la importación no se vuelve a ejecutar.';
  end if;
end $$;
${lineas.join('\n')}
commit;
`;
fs.writeFileSync('pdfdata/importar-control.sql', sql);
console.log(`pdfdata/importar-control.sql: ${db.clientes.length} clientes, ${porCliente.size} ventas (${ventaLotes.length} lotes), ${pagos.length} pagos, ${db.gastos.length} gastos`);
