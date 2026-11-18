-- Ajustes generales del sitio (una sola fila): por ahora, la tarifa por vara² con la que el mapa calcula el precio
-- aproximado de los lotes sin precio propio. Se edita desde /admin → "Tarifa general".
-- Ya va incluido al final de schema.sql; este archivo sirve para agregarlo a una base ya creada. Se puede volver a ejecutar.
create table if not exists public.ajustes (
  id          int primary key default 1 check (id = 1),
  precio_vara numeric(12, 2) not null default 950 check (precio_vara > 0),
  updated_at  timestamptz not null default now()
);
insert into public.ajustes (id) values (1) on conflict (id) do nothing;

drop trigger if exists ajustes_updated_at on public.ajustes;
create trigger ajustes_updated_at before update on public.ajustes
  for each row execute function public.tocar_updated_at();

-- Cualquiera puede leer; solo los administradores pueden cambiarla
alter table public.ajustes enable row level security;
drop policy if exists "ajustes: lectura pública" on public.ajustes;
create policy "ajustes: lectura pública" on public.ajustes
  for select to anon, authenticated using (true);
drop policy if exists "ajustes: edición de administradores" on public.ajustes;
create policy "ajustes: edición de administradores" on public.ajustes
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

grant select on public.ajustes to anon, authenticated;
grant update on public.ajustes to authenticated;
