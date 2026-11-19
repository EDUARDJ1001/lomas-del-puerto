-- Contabilidad (privada): clientes, ventas de lotes, pagos recibidos, gastos y saldo inicial del banco.
-- Se usa desde /admin → Contabilidad. Solo los administradores pueden leer o cambiar estas tablas:
-- el mapa público nunca ve nombres, montos ni pagos.
-- Ya va incluido al final de schema.sql; este archivo sirve para agregarlo a una base ya creada (después de ajustes.sql).
-- Se puede volver a ejecutar.

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
