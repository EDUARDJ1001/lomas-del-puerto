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
  estado      text not null default 'disponible',
  precio      numeric(12, 2),                        -- null = "A consultar"
  descripcion text not null default '',
  medidas     text,                                  -- null = medidas calculadas del plano
  fotos       text[] not null default '{}',          -- rutas dentro del bucket "fotos", p.ej. 'A-7/1.jpg'; la primera es la portada
  updated_at  timestamptz not null default now(),
  unique (bloque, numero)
);

-- Lado 2 (polígono 1B): ids '1B-A-1', bloques A, B, C y L (locales). Se puede volver a ejecutar en una base que ya existe.
alter table public.lotes add column if not exists sector text not null default ''; -- '' = primer plano, '1B' = lado 2
alter table public.lotes drop constraint if exists lotes_bloque_check;
alter table public.lotes add constraint lotes_bloque_check check (bloque in ('A', 'B', 'C', 'L'));
alter table public.lotes drop constraint if exists lotes_bloque_numero_key;
alter table public.lotes drop constraint if exists lotes_sector_bloque_numero_key;
alter table public.lotes add constraint lotes_sector_bloque_numero_key unique (sector, bloque, numero);
-- Estados: no_disponible = aún no está a la venta (gris en el mapa)
alter table public.lotes drop constraint if exists lotes_estado_check;
alter table public.lotes add constraint lotes_estado_check check (estado in ('disponible', 'reservado', 'vendido', 'no_disponible'));

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

-- Tarifa general (precio por vara²): lo mismo que supabase/ajustes.sql
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

-- Contabilidad (privada): lo mismo que supabase/contabilidad.sql

create table if not exists public.clientes (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (length(trim(nombre)) > 0),
  telefono  text not null default '',
  identidad text not null default '',
  nota      text not null default '',
  creado    timestamptz not null default now()
);

-- Una venta: un acuerdo con un cliente por uno o varios lotes.
-- contado: se debe el total desde la fecha de la venta.
-- cuotas: prima + "meses" cuotas mensuales desde "inicio_cuotas"; la cuota es (total − prima) / meses salvo que se fije "cuota".
create table if not exists public.ventas (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes (id) on delete restrict,
  fecha         date,
  tipo          text not null default 'contado' check (tipo in ('contado', 'cuotas')),
  prima         numeric(14, 2) not null default 0 check (prima >= 0),
  meses         int not null default 0 check (meses >= 0),
  cuota         numeric(14, 2) check (cuota > 0),
  inicio_cuotas date,
  nota          text not null default '',
  creado        timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Lotes de cada venta, con su precio (un lote solo puede estar en una venta: borrar la venta lo libera)
create table if not exists public.venta_lotes (
  lote_id     text primary key references public.lotes (id) on delete restrict,
  venta_id    uuid not null references public.ventas (id) on delete cascade,
  precio_vara numeric(12, 2) check (precio_vara >= 0), -- null = precio fijo escrito a mano
  precio      numeric(14, 2) not null check (precio >= 0)
);
create index if not exists venta_lotes_venta on public.venta_lotes (venta_id);

-- Pagos: se abonan a la cuenta del cliente (todas sus ventas juntas)
create table if not exists public.pagos (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  fecha      date,
  monto      numeric(14, 2) not null check (monto > 0),
  forma      text not null default '',  -- efectivo, transferencia, depósito…
  nota       text not null default '',
  creado     timestamptz not null default now()
);
create index if not exists pagos_cliente on public.pagos (cliente_id);

create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date,
  descripcion text not null check (length(trim(descripcion)) > 0),
  categoria   text not null default '',
  monto       numeric(14, 2) not null check (monto >= 0),
  nota        text not null default '',
  creado      timestamptz not null default now()
);

-- Banco: saldo con el que arranca la cuenta (después se suman pagos y se restan gastos)
alter table public.ajustes add column if not exists saldo_inicial numeric(14, 2) not null default 0;

drop trigger if exists ventas_updated_at on public.ventas;
create trigger ventas_updated_at before update on public.ventas
  for each row execute function public.tocar_updated_at();

-- Seguridad: todo solo para administradores (lectura incluida)
do $$
declare t text;
begin
  foreach t in array array['clientes', 'ventas', 'venta_lotes', 'pagos', 'gastos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: administradores" on public.%I', t, t);
    execute format('create policy "%s: administradores" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
