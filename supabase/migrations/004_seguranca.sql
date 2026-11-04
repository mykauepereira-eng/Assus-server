create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated, service_role;

create or replace function privado.eu_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo from public.profiles p where p.id = (select auth.uid())), false) $$;
create or replace function privado.eu_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and p.admin from public.profiles p where p.id = (select auth.uid())), false) $$;
create or replace function privado.pode_ler(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and (p.admin or p_area = any(p.rd)) from public.profiles p where p.id = (select auth.uid())), false) $$;
create or replace function privado.pode_gravar(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ativo and (p.admin or p_area = any(p.wr)) from public.profiles p where p.id = (select auth.uid())), false) $$;
revoke all on all functions in schema privado from public, anon;
grant execute on all functions in schema privado to authenticated, service_role;

drop policy if exists "perfis: leitura" on public.profiles;
create policy "perfis: leitura" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or privado.eu_ativo());
drop policy if exists "perfis: admin grava" on public.profiles;
create policy "perfis: admin grava" on public.profiles for insert to authenticated with check (privado.eu_admin());
drop policy if exists "perfis: admin altera" on public.profiles;
create policy "perfis: admin altera" on public.profiles for update to authenticated using (privado.eu_admin()) with check (privado.eu_admin());
drop policy if exists "perfis: admin exclui" on public.profiles;
create policy "perfis: admin exclui" on public.profiles for delete to authenticated using (privado.eu_admin() and id <> (select auth.uid()));

drop policy if exists "docs: leitura" on public.docs;
create policy "docs: leitura" on public.docs for select to authenticated using (
  case public.area_de(coll)
    when 'prefs' then id = (select auth.uid())::text
    when 'aud' then privado.eu_ativo() and (
         privado.pode_ler('33aud') or data->>'u' = (select auth.uid())::text or privado.pode_ler(public.area_tela(data->>'tela')))
    else privado.pode_ler(public.area_de(coll)) end);
drop policy if exists "docs: inclusão" on public.docs;
create policy "docs: inclusão" on public.docs for insert to authenticated with check (
  case public.area_de(coll)
    when 'prefs' then id = (select auth.uid())::text and privado.eu_ativo()
    when 'aud' then privado.eu_ativo() and coalesce(data->>'u','') in ('', (select auth.uid())::text)
    else privado.pode_gravar(public.area_de(coll)) end);
drop policy if exists "docs: alteração" on public.docs;
create policy "docs: alteração" on public.docs for update to authenticated
  using (case public.area_de(coll) when 'prefs' then id = (select auth.uid())::text when 'aud' then false else privado.pode_gravar(public.area_de(coll)) end)
  with check (case public.area_de(coll) when 'prefs' then id = (select auth.uid())::text when 'aud' then false else privado.pode_gravar(public.area_de(coll)) end);
drop policy if exists "docs: exclusão" on public.docs;
create policy "docs: exclusão" on public.docs for delete to authenticated
  using (case public.area_de(coll) when 'prefs' then id = (select auth.uid())::text when 'aud' then false else privado.pode_gravar(public.area_de(coll)) end);

drop policy if exists "segredos: admin lê" on public.app_segredos;
create policy "segredos: admin lê" on public.app_segredos for select to authenticated using (privado.eu_admin());
drop policy if exists "backups: admin lê" on public.backups;
create policy "backups: admin lê" on public.backups for select to authenticated using (privado.eu_admin());
drop policy if exists "cache: só servidor" on public.api_cache;
create policy "cache: só servidor" on public.api_cache for select to authenticated using (false);
drop policy if exists "anexos: ler" on storage.objects;
create policy "anexos: ler" on storage.objects for select to authenticated using (bucket_id = 'anexos' and privado.eu_ativo());
drop policy if exists "anexos: enviar" on storage.objects;
create policy "anexos: enviar" on storage.objects for insert to authenticated with check (bucket_id = 'anexos' and privado.pode_gravar('qdr'));
drop policy if exists "anexos: apagar" on storage.objects;
create policy "anexos: apagar" on storage.objects for delete to authenticated using (bucket_id = 'anexos' and privado.pode_gravar('qdr'));

create or replace function public.gerar_token(p_nome text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not privado.eu_admin() then raise exception 'Somente o administrador pode gerar tokens.'; end if;
  if p_nome not in ('leads') then raise exception 'Token desconhecido.'; end if;
  insert into public.app_segredos(nome, valor) values (p_nome, v)
    on conflict (nome) do update set valor = excluded.valor, alterado = now();
  return v;
end $$;
create or replace function public.fazer_backup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_d jsonb; v_kb int;
begin
  if (select auth.uid()) is not null and not privado.eu_admin() then raise exception 'Somente o administrador pode fazer backup.'; end if;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data, 'ver', ver) order by ord), '[]'::jsonb)
    into v_n, v_d from public.docs;
  v_kb := (octet_length(v_d::text) / 1024)::int;
  insert into public.backups(dia, registros, tamanho_kb, dados) values (current_date, v_n, v_kb, v_d)
    on conflict (dia) do update set criado = now(), registros = excluded.registros, tamanho_kb = excluded.tamanho_kb, dados = excluded.dados;
  delete from public.backups where dia < current_date - 14;
  return jsonb_build_object('dia', current_date, 'registros', v_n, 'tamanho_kb', v_kb);
end $$;
create or replace function public.saude() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (select auth.uid()) is not null and not privado.eu_admin() then null else jsonb_build_object(
    'docs', (select count(*) from public.docs),
    'por_colecao', (select jsonb_object_agg(coll, n) from (select coll, count(*) n from public.docs group by coll) x),
    'tamanho_kb', (select (sum(pg_column_size(d.data)) / 1024)::int from public.docs d),
    'usuarios', (select count(*) from public.profiles),
    'admins_ativos', (select count(*) from public.profiles where admin and ativo),
    'ultimo_backup', (select max(dia) from public.backups),
    'ultima_alteracao', (select max(alterado) from public.docs)
  ) end $$;

drop function if exists public.eu_ativo();
drop function if exists public.eu_admin();
drop function if exists public.pode_ler(text);
drop function if exists public.pode_gravar(text);

revoke all on function public.bootstrap_admin(text) from public, anon;
revoke all on function public.gerar_token(text) from public, anon;
revoke all on function public.fazer_backup() from public, anon;
revoke all on function public.saude() from public, anon;
revoke all on function public.put_docs(jsonb) from public, anon;
grant execute on function public.bootstrap_admin(text) to authenticated;
grant execute on function public.gerar_token(text) to authenticated;
grant execute on function public.fazer_backup() to authenticated, service_role;
grant execute on function public.saude() to authenticated, service_role;
grant execute on function public.put_docs(jsonb) to authenticated;
grant execute on function public.needs_setup() to anon, authenticated;
