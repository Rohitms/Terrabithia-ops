-- Access is database-authoritative; JWT/user metadata never supplies an app role.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum ('admin', 'manager', 'sales', 'viewer');

create table public.allowed_emails (
  id uuid not null unique default gen_random_uuid(),
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  full_name text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  diff jsonb,
  created_at timestamptz not null default now()
);
create index activity_entity_idx on public.activity_log(entity_type, entity_id, created_at desc);
create index activity_actor_idx on public.activity_log(actor_id);

create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  join public.allowed_emails a on a.email = p.email
  where p.id = (select auth.uid()) and p.is_active and a.is_active and p.role = a.role
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() in ('admin', 'manager'), false)
$$;

create function private.sync_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare membership public.allowed_emails%rowtype;
begin
  -- Serialize onboarding with access changes so neither can overwrite newer access.
  perform pg_catalog.pg_advisory_xact_lock(7401001);
  if new.email is null then return new; end if;
  select * into membership from public.allowed_emails where email = lower(btrim(new.email));
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, lower(btrim(new.email)), left(new.raw_user_meta_data->>'full_name', 200),
    coalesce(membership.role, 'viewer'),
    coalesce(membership.is_active, false) and new.email_confirmed_at is not null)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name,
    role = excluded.role, is_active = excluded.is_active;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.sync_auth_profile();
create trigger on_auth_user_updated after update of email, email_confirmed_at, raw_user_meta_data on auth.users
  for each row execute function private.sync_auth_profile();

create function private.guard_access_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(7401001);
  if tg_op = 'UPDATE' and (new.email <> old.email or new.id <> old.id) then
    raise exception 'Access identity cannot be changed; deactivate and add the new email';
  end if;
  if tg_op <> 'INSERT' and old.role = 'admin' and old.is_active then
    if tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active then
      if not exists (select 1 from public.allowed_emails
        where email <> old.email and role = 'admin' and is_active) then
        raise exception 'The last active administrator cannot be removed';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger guard_access_change before insert or update or delete on public.allowed_emails
  for each row execute function private.guard_access_change();

create function private.sync_access_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_email text; target_id uuid; before_value jsonb; after_value jsonb;
begin
  if tg_op = 'UPDATE' and new.role = old.role and new.is_active = old.is_active then return new; end if;
  if tg_op <> 'INSERT' then before_value := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_value := to_jsonb(new); end if;
  target_email := coalesce(new.email, old.email);
  target_id := coalesce(new.id, old.id);
  update public.profiles p set
    role = case when tg_op = 'DELETE' then 'viewer'::public.app_role else new.role end,
    is_active = case when tg_op = 'DELETE' then false else new.is_active and u.email_confirmed_at is not null end
  from auth.users u where p.email = target_email and u.id = p.id;
  insert into public.activity_log (actor_id, entity_type, entity_id, action, diff)
  values (auth.uid(), 'user', target_id, 'access_' || lower(tg_op),
    jsonb_build_object('before', before_value, 'after', after_value));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger sync_access_change after insert or update or delete on public.allowed_emails
  for each row execute function private.sync_access_change();

create function public.set_user_access(target_email text, target_role public.app_role, active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(7401001);
  if private.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if target_email is null or length(target_email) > 320 or btrim(target_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or target_role is null or active is null then
    raise exception 'Valid email, role and active state are required' using errcode = '22023';
  end if;
  insert into public.allowed_emails (email, role, is_active)
  values (lower(btrim(target_email)), target_role, active)
  on conflict (email) do update set role = excluded.role, is_active = excluded.is_active;
end $$;

-- This RPC returns no row for denied users, even with a previously issued JWT.
create function public.get_my_access() returns setof public.profiles
language sql stable security invoker set search_path = '' as $$
  select p.* from public.profiles p
  where p.id = (select auth.uid()) and private.current_app_role() is not null
$$;

alter table public.allowed_emails enable row level security;
alter table public.profiles enable row level security;
alter table public.activity_log enable row level security;
revoke all on public.allowed_emails, public.profiles, public.activity_log from anon, authenticated;
grant select on public.allowed_emails, public.profiles, public.activity_log to authenticated;
grant all on public.allowed_emails, public.profiles, public.activity_log to service_role;
grant usage, select on sequence public.activity_log_id_seq to service_role;
create policy allowed_admin_read on public.allowed_emails for select to authenticated
  using ((select private.current_app_role()) = 'admin');
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.current_app_role()) = 'admin');
create policy activity_staff_read on public.activity_log for select to authenticated
  using ((select private.is_staff()));

revoke all on function private.current_app_role(), private.is_staff(), private.sync_auth_profile(),
  private.guard_access_change(), private.sync_access_change() from public, anon, authenticated;
grant execute on function private.current_app_role(), private.is_staff() to authenticated;
revoke all on function public.set_user_access(text, public.app_role, boolean), public.get_my_access() from public, anon;
grant execute on function public.set_user_access(text, public.app_role, boolean), public.get_my_access() to authenticated;
