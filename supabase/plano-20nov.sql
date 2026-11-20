-- Plano actualizado del lado 1 (pdfdata/pdfimport-lado1-updt20nov.dxf, 20-nov-2026). Ejecutar UNA vez en el SQL Editor.
-- Bloque C renumerado: los antiguos C-4…C-7 se dividen en 12 lotes (C-4…C-15) y los antiguos C-8…C-14 pasan a C-16…C-22.
--   · C-16…C-22 reciben estado, precio, descripción, medidas y fotos de los antiguos C-8…C-14 (mismo terreno).
--   · C-5 y C-6 (parte del antiguo C-4) quedan con el estado de C-4 y se agregan a su venta con precio 0:
--     el total de esa venta no cambia.
--   · C-7…C-15 quedan disponibles, sin precio ni fotos. Las fotos de los antiguos C-5, C-6 y C-7 se quitan de los lotes;
--     los archivos siguen en Storage → fotos (carpetas C-5, C-6 y C-7) hasta borrarlos desde ahí.
-- Áreas nuevas de todos los lotes del lado 1 (cambian A-5, B-5, A-18, B-17 y el bloque C).
-- Las ventas registradas conservan sus lotes y precios.
begin;

do $$ begin
  if exists (select 1 from public.lotes where id = 'C-22') then
    raise exception 'Este cambio ya se aplicó (C-22 ya existe). No hace falta volver a ejecutarlo.';
  end if;
end $$;

-- 1. Lotes nuevos C-15…C-22
insert into public.lotes (id, sector, bloque, numero, area_m2, area_vrs2) values
  ('C-15', '', 'C', 15, 183.56, 263.27),
  ('C-16', '', 'C', 16, 636.07, 912.28),
  ('C-17', '', 'C', 17, 549.46, 788.06),
  ('C-18', '', 'C', 18, 491.71, 705.23),
  ('C-19', '', 'C', 19, 442.84, 635.14),
  ('C-20', '', 'C', 20, 387.55, 555.84),
  ('C-21', '', 'C', 21, 289.98, 415.9),
  ('C-22', '', 'C', 22, 671.69, 963.36);

-- 2. C-16…C-22 = antiguos C-8…C-14
update public.lotes n set estado = o.estado, precio = o.precio, descripcion = o.descripcion, medidas = o.medidas, fotos = o.fotos
from public.lotes o
where o.sector = '' and o.bloque = 'C' and o.numero between 8 and 14
  and n.sector = '' and n.bloque = 'C' and n.numero = o.numero + 8;

-- 3. C-7…C-14: lotes nuevos, disponibles y sin fotos
update public.lotes set estado = 'disponible', precio = null, descripcion = '', medidas = null, fotos = '{}'
where sector = '' and bloque = 'C' and numero between 7 and 14;

-- 4. C-5 y C-6 (antes parte de C-4): mismo estado que C-4, sin fotos
update public.lotes set estado = (select estado from public.lotes where id = 'C-4'), precio = null, descripcion = '', medidas = null, fotos = '{}'
where id in ('C-5', 'C-6');

-- 5. La venta de C-4 incluye ahora C-5 y C-6 (precio 0: el total de la venta no cambia)
insert into public.venta_lotes (lote_id, venta_id, precio_vara, precio)
select x.id, vl.venta_id, null, 0 from public.venta_lotes vl, (values ('C-5'), ('C-6')) x(id)
where vl.lote_id = 'C-4'
on conflict (lote_id) do nothing;

-- 6. Áreas del plano actualizado
update public.lotes l set area_m2 = v.m2, area_vrs2 = v.vrs
from (values
  ('A-1', 204.7, 293.59),
  ('A-2', 170, 243.82),
  ('A-3', 170, 243.82),
  ('A-4', 170, 243.82),
  ('A-5', 259.76, 372.56),
  ('A-6', 170, 243.82),
  ('A-7', 170, 243.82),
  ('A-8', 170, 243.82),
  ('A-9', 170, 243.82),
  ('A-10', 170, 243.82),
  ('A-11', 170, 243.82),
  ('A-12', 170, 243.82),
  ('A-13', 170, 243.82),
  ('A-14', 170, 243.82),
  ('A-15', 170, 243.82),
  ('A-16', 170, 243.82),
  ('A-17', 212.84, 305.26),
  ('A-18', 482.78, 692.42),
  ('B-1', 274.1, 393.13),
  ('B-2', 170, 243.82),
  ('B-3', 170, 243.82),
  ('B-4', 170, 243.82),
  ('B-5', 250.86, 359.79),
  ('B-6', 170, 243.82),
  ('B-7', 170, 243.82),
  ('B-8', 170, 243.82),
  ('B-9', 170, 243.82),
  ('B-10', 170, 243.82),
  ('B-11', 170, 243.82),
  ('B-12', 170, 243.82),
  ('B-13', 170, 243.82),
  ('B-14', 170, 243.82),
  ('B-15', 170, 243.82),
  ('B-16', 203.51, 291.88),
  ('B-17', 345.63, 495.72),
  ('B-18', 673.25, 965.6),
  ('B-19', 562.57, 806.86),
  ('B-20', 441.48, 633.19),
  ('B-21', 589.9, 846.06),
  ('C-1', 265.73, 381.12),
  ('C-2', 628.84, 901.91),
  ('C-3', 833.52, 1195.47),
  ('C-4', 244.77, 351.06),
  ('C-5', 247.75, 355.33),
  ('C-6', 258.2, 370.32),
  ('C-7', 216.12, 309.97),
  ('C-8', 247.68, 355.23),
  ('C-9', 256.3, 367.6),
  ('C-10', 226.53, 324.9),
  ('C-11', 240.83, 345.41),
  ('C-12', 254.75, 365.37),
  ('C-13', 216.15, 310.01),
  ('C-14', 215.3, 308.79),
  ('C-15', 183.56, 263.27),
  ('C-16', 636.07, 912.28),
  ('C-17', 549.46, 788.06),
  ('C-18', 491.71, 705.23),
  ('C-19', 442.84, 635.14),
  ('C-20', 387.55, 555.84),
  ('C-21', 289.98, 415.9),
  ('C-22', 671.69, 963.36)
) v(id, m2, vrs)
where l.id = v.id;

commit;
