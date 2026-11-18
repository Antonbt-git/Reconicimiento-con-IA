-- =====================================================================
-- AURORA IX · Esquema Supabase (PostgreSQL) — ejecutar en SQL Editor
-- Cada tabla guarda el registro completo en `data` (jsonb) + columnas
-- indexadas para filtrar. Acceso solo para usuarios autenticados (RLS).
-- =====================================================================

-- 1) Perfiles y roles ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'operator' check (role in ('admin','operator','supervisor','auditor')),
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente al crear un usuario en Authentication.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          coalesce(new.raw_user_meta_data->>'role', 'operator'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rol del usuario actual (usado por las políticas).
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 2) Tablas de datos ------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['analyses','video_sessions','person_records','vision_events','alerts','audit_logs','export_records'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        mode text check (mode in ('REAL','SIMULATED')),
        status text,
        created_by uuid default auth.uid() references auth.users(id) on delete set null,
        data jsonb not null
      );
      create index if not exists %1$s_created_idx on public.%1$I (created_at desc);
      create index if not exists %1$s_status_idx on public.%1$I (status);
      alter table public.%1$I enable row level security;
      drop trigger if exists %1$s_touch on public.%1$I;
      create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at();
      drop policy if exists "%1$s_read" on public.%1$I;
      create policy "%1$s_read" on public.%1$I for select to authenticated using (true);
      drop policy if exists "%1$s_insert" on public.%1$I;
      create policy "%1$s_insert" on public.%1$I for insert to authenticated
        with check (public.my_role() in ('admin','operator','supervisor') or %1$L = 'audit_logs');
      drop policy if exists "%1$s_update" on public.%1$I;
      create policy "%1$s_update" on public.%1$I for update to authenticated
        using (public.my_role() in ('admin','operator','supervisor'));
    $f$, t);
  end loop;
end $$;

-- Borrado solo para administradores (registros de auditoría: nunca).
do $$
declare t text;
begin
  foreach t in array array['analyses','video_sessions','person_records','vision_events','alerts','export_records'] loop
    execute format('drop policy if exists "%1$s_delete" on public.%1$I; create policy "%1$s_delete" on public.%1$I for delete to authenticated using (public.my_role() = ''admin'');', t);
  end loop;
end $$;

-- 3) Configuración compartida (reglas, zonas, clases, umbrales) -----------
create table if not exists public.app_config (
  id text primary key default 'default',
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_config enable row level security;
drop policy if exists "config_read" on public.app_config;
create policy "config_read" on public.app_config for select to authenticated using (true);
drop policy if exists "config_write" on public.app_config;
create policy "config_write" on public.app_config for all to authenticated
  using (public.my_role() in ('admin','supervisor')) with check (public.my_role() in ('admin','supervisor'));
-- Fila pública mínima usada por el "ping" que evita la pausa del proyecto.
create table if not exists public.heartbeat (id int primary key, seen_at timestamptz default now());
insert into public.heartbeat (id) values (1) on conflict do nothing;
alter table public.heartbeat enable row level security;
drop policy if exists "heartbeat_read" on public.heartbeat;
create policy "heartbeat_read" on public.heartbeat for select to anon, authenticated using (true);

-- 4) Perfiles: cada uno lee todos (para mostrar nombres); solo admin cambia roles.
alter table public.profiles enable row level security;
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_admin" on public.profiles;
create policy "profiles_admin" on public.profiles for update to authenticated using (public.my_role() = 'admin');

-- 5) Hacer administrador a su primer usuario (cambie el correo):
-- update public.profiles set role = 'admin' where email = 'usted@empresa.com';
