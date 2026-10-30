-- Lomas del Puerto — esquema de Supabase
-- Ejecutar una vez en Supabase: SQL Editor → New query → pegar y Run. Después ejecutar seed.sql.
-- La geometría de los lotes sigue en data/lotes.json (sale del plano y no cambia);
-- aquí solo vive lo que se edita: estado, precio, descripción, medidas y fotos.

create table if not exists public.lotes (
  id          text primary key,                      -- 'A-7'
  bloque      text not null check (bloque in ('A', 'B', 'C')),
  numero      int  not null,
  area_m2     numeric(10, 2) not null,
  area_vrs2   numeric(10, 2) not null,
  estado      text not null default 'disponible' check (estado in ('disponible', 'reservado', 'vendido')),
  precio      numeric(12, 2),                        -- null = "A consultar"
  descripcion text not null default '',
  medidas     text,                                  -- null = medidas calculadas del plano
  fotos       text[] not null default '{}',          -- rutas dentro del bucket "fotos", p.ej. 'A-7/1.jpg'; la primera es la portada
  updated_at  timestamptz not null default now(),
  unique (bloque, numero)
);

create or replace function public.tocar_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists lotes_updated_at on public.lotes;
create trigger lotes_updated_at before update on public.lotes
  for each row execute function public.tocar_updated_at();

-- Administradores: las cuentas (correo y contraseña cifrada) las guarda Supabase Auth en auth.users.
-- Esta tabla solo marca cuáles de esas cuentas pueden editar. Alta de un administrador, después de crearlo en Authentication → Users:
--   insert into public.administradores (user_id, email) select id, email from auth.users where email = 'correo@ejemplo.com';
create table if not exists public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email   text not null,
  creado  timestamptz not null default now()
);
alter table public.administradores enable row level security;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administradores where user_id = auth.uid())
$$;

drop policy if exists "administradores: ver la propia fila" on public.administradores;
create policy "administradores: ver la propia fila" on public.administradores
  for select to authenticated using (user_id = auth.uid());

-- Seguridad: cualquiera puede leer; solo los administradores pueden editar
alter table public.lotes enable row level security;

drop policy if exists "lotes: lectura pública" on public.lotes;
create policy "lotes: lectura pública" on public.lotes
  for select to anon, authenticated using (true);

drop policy if exists "lotes: edición de administradores" on public.lotes;
create policy "lotes: edición de administradores" on public.lotes
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Fotos: bucket público de solo lectura; subir y borrar solo administradores
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos: subir (administradores)" on storage.objects;
create policy "fotos: subir (administradores)" on storage.objects
  for insert to authenticated with check (bucket_id = 'fotos' and public.es_admin());

drop policy if exists "fotos: reemplazar (administradores)" on storage.objects;
create policy "fotos: reemplazar (administradores)" on storage.objects
  for update to authenticated using (bucket_id = 'fotos' and public.es_admin());

drop policy if exists "fotos: borrar (administradores)" on storage.objects;
create policy "fotos: borrar (administradores)" on storage.objects
  for delete to authenticated using (bucket_id = 'fotos' and public.es_admin());
