create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  nome text not null default '',
  ativo boolean not null default true,
  admin boolean not null default false,
  rd text[] not null default '{}',
  wr text[] not null default '{}',
  criado timestamptz not null default now(),
  alterado timestamptz not null default now()
);

create or replace function public.area_de(p_coll text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_coll = 'fin' then '00'
    when p_coll in ('prod','serv','lav','cli','etp') then '11'
    when p_coll in ('leads','pessoas','agenda','posv') then '22'
    when p_coll in ('carros','aval','props') then 'veic'
    when p_coll in ('usr','cargos') then 'adm'
    when p_coll in ('quadros','cards') then 'qdr'
    when p_coll = 'conf' then 'conf'
    when p_coll = 'prefs' then 'prefs'
    when p_coll = 'aud' then 'aud'
    else 'outros' end $$;

create or replace function public.area_tela(p_tela text) returns text
language sql immutable set search_path = '' as $$
  select case left(coalesce(p_tela,''),2)
    when '00' then '00' when '11' then '11' when '22' then '22'
    when '33' then '33aud' when '44' then 'veic' when '55' then 'veic'
    when '66' then 'qdr' else '33aud' end $$;

create table if not exists public.docs(
  coll text not null,
  id text not null,
  data jsonb not null,
  ver bigint not null default 1,
  ord bigint generated always as identity,
  por uuid default auth.uid(),
  alterado timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists docs_ord_idx on public.docs(ord);
create index if not exists docs_coll_idx on public.docs(coll);
create index if not exists docs_aud_idx on public.docs(ord desc) where coll = 'aud';

create or replace function public.docs_carimbo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data then return old; end if;
    new.ver := old.ver + 1;
  else
    new.ver := 1;
  end if;
  new.alterado := now();
  new.por := coalesce(auth.uid(), new.por);
  return new;
end $$;
drop trigger if exists docs_carimbo on public.docs;
create trigger docs_carimbo before insert or update on public.docs
  for each row execute function public.docs_carimbo();

create or replace function public.eu_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo from public.profiles p where p.id = auth.uid()), false) $$;
create or replace function public.eu_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and p.admin from public.profiles p where p.id = auth.uid()), false) $$;
create or replace function public.pode_ler(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and (p.admin or p_area = any(p.rd)) from public.profiles p where p.id = auth.uid()), false) $$;
create or replace function public.pode_gravar(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and (p.admin or p_area = any(p.wr)) from public.profiles p where p.id = auth.uid()), false) $$;

alter table public.profiles enable row level security;
alter table public.docs enable row level security;

drop policy if exists "perfis: leitura" on public.profiles;
create policy "perfis: leitura" on public.profiles for select to authenticated
  using (id = auth.uid() or public.eu_ativo());
drop policy if exists "perfis: admin grava" on public.profiles;
create policy "perfis: admin grava" on public.profiles for insert to authenticated
  with check (public.eu_admin());
drop policy if exists "perfis: admin altera" on public.profiles;
create policy "perfis: admin altera" on public.profiles for update to authenticated
  using (public.eu_admin()) with check (public.eu_admin());
drop policy if exists "perfis: admin exclui" on public.profiles;
create policy "perfis: admin exclui" on public.profiles for delete to authenticated
  using (public.eu_admin() and id <> auth.uid());

drop policy if exists "docs: leitura" on public.docs;
create policy "docs: leitura" on public.docs for select to authenticated using (
  case public.area_de(coll)
    when 'prefs' then id = auth.uid()::text
    when 'aud' then public.eu_ativo() and (
         public.pode_ler('33aud') or data->>'u' = auth.uid()::text or public.pode_ler(public.area_tela(data->>'tela')))
    else public.pode_ler(public.area_de(coll)) end);

drop policy if exists "docs: inclusão" on public.docs;
create policy "docs: inclusão" on public.docs for insert to authenticated with check (
  case public.area_de(coll)
    when 'prefs' then id = auth.uid()::text and public.eu_ativo()
    when 'aud' then public.eu_ativo() and coalesce(data->>'u','') in ('', auth.uid()::text)
    else public.pode_gravar(public.area_de(coll)) end);

drop policy if exists "docs: alteração" on public.docs;
create policy "docs: alteração" on public.docs for update to authenticated
  using (case public.area_de(coll) when 'prefs' then id = auth.uid()::text when 'aud' then false else public.pode_gravar(public.area_de(coll)) end)
  with check (case public.area_de(coll) when 'prefs' then id = auth.uid()::text when 'aud' then false else public.pode_gravar(public.area_de(coll)) end);

drop policy if exists "docs: exclusão" on public.docs;
create policy "docs: exclusão" on public.docs for delete to authenticated
  using (case public.area_de(coll) when 'prefs' then id = auth.uid()::text when 'aud' then false else public.pode_gravar(public.area_de(coll)) end);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.docs, public.profiles to authenticated;

create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles) $$;

create or replace function public.bootstrap_admin(p_nome text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre antes de configurar.'; end if;
  lock table public.profiles in exclusive mode;
  if exists (select 1 from public.profiles) then raise exception 'O sistema já foi configurado.'; end if;
  insert into public.profiles(id, email, nome, ativo, admin, rd, wr)
  select u.id, coalesce(u.email,''), coalesce(nullif(trim(p_nome),''), u.email, 'Administrador'), true, true,
         array['00','11','22','veic','adm','conf','33aud','qdr'], array['00','11','22','veic','adm','conf','qdr']
  from auth.users u where u.id = auth.uid();
end $$;

create or replace function public.put_docs(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb; c record; nv bigint; saida jsonb := '[]'::jsonb; b text;
begin
  for r in select value from jsonb_array_elements(p_rows) loop
    b := r->>'base';
    select d.ver, d.data into c from public.docs d where d.coll = r->>'coll' and d.id = r->>'id' for update;
    if found then
      if c.data = r->'data' then
        saida := saida || jsonb_build_array(jsonb_build_object('coll', r->>'coll', 'id', r->>'id', 'conflict', false, 'ver', c.ver));
      elsif b is null or b::bigint <> c.ver then
        saida := saida || jsonb_build_array(jsonb_build_object('coll', r->>'coll', 'id', r->>'id', 'conflict', true, 'ver', c.ver, 'data', c.data));
      else
        update public.docs d set data = r->'data' where d.coll = r->>'coll' and d.id = r->>'id' returning d.ver into nv;
        saida := saida || jsonb_build_array(jsonb_build_object('coll', r->>'coll', 'id', r->>'id', 'conflict', false, 'ver', nv));
      end if;
    else
      insert into public.docs(coll, id, data) values (r->>'coll', r->>'id', r->'data') returning ver into nv;
      saida := saida || jsonb_build_array(jsonb_build_object('coll', r->>'coll', 'id', r->>'id', 'conflict', false, 'ver', nv));
    end if;
  end loop;
  return saida;
end $$;

revoke all on function public.needs_setup() from public;
revoke all on function public.bootstrap_admin(text) from public;
revoke all on function public.put_docs(jsonb) from public;
grant execute on function public.needs_setup() to anon, authenticated;
grant execute on function public.bootstrap_admin(text) to authenticated;
grant execute on function public.put_docs(jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
