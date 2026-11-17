-- IQtraining · database setup (run once in Supabase › SQL Editor)
-- Roles: admin (first account created), coach, rider, blocked.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text not null default 'rider' check (role in ('admin','coach','rider','blocked')),
  created_at timestamptz not null default now()
);

-- every new account gets a profile; the very first one is the admin
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
          case when not exists (select 1 from public.profiles) then 'admin' else 'rider' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- only the admin can change roles
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and coalesce(public.my_role(),'') <> 'admin' then
    raise exception 'only the admin can change roles';
  end if;
  return new;
end $$;
drop trigger if exists protect_role on public.profiles;
create trigger protect_role before update on public.profiles
  for each row execute function public.protect_role();

alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

-- shared team data: events/sheets, tracks, coach log, wind, who-was-there
create table if not exists public.docs (
  coll text not null,
  id text not null,
  data jsonb not null,
  owner uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
alter table public.docs enable row level security;

drop policy if exists "docs read" on public.docs;
create policy "docs read" on public.docs for select to authenticated
  using (public.my_role() in ('admin','coach','rider'));

drop policy if exists "docs insert" on public.docs;
create policy "docs insert" on public.docs for insert to authenticated
  with check (owner = auth.uid() and public.my_role() in ('admin','coach','rider'));

drop policy if exists "docs update" on public.docs;
create policy "docs update" on public.docs for update to authenticated
  using (owner = auth.uid() or public.my_role() in ('admin','coach')
         or (coll in ('config','days') and public.my_role() = 'rider'));

drop policy if exists "docs delete" on public.docs;
create policy "docs delete" on public.docs for delete to authenticated
  using ((owner = auth.uid() and public.my_role() in ('admin','coach','rider'))
         or public.my_role() in ('admin','coach'));

create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch();

-- live updates
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
