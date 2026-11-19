-- Borra TODOS los datos de contabilidad (clientes, ventas, lotes vendidos, pagos y gastos) y deja el saldo inicial en 0,
-- para volver a importar desde cero con pdfdata/importar-control.sql. No se puede deshacer.
-- No toca la tabla lotes: el estado de cada lote en el mapa público (disponible, vendido…) queda como está.
begin;
delete from public.pagos;
delete from public.venta_lotes;
delete from public.ventas;
delete from public.gastos;
delete from public.clientes;
update public.ajustes set saldo_inicial = 0 where id = 1;
commit;

-- Para revisar cuántos registros hay (antes o después):
-- select (select count(*) from public.clientes) clientes, (select count(*) from public.ventas) ventas,
--        (select count(*) from public.venta_lotes) lotes_vendidos, (select count(*) from public.pagos) pagos,
--        (select count(*) from public.gastos) gastos;
