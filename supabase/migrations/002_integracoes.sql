create table if not exists public.app_segredos(
  nome text primary key,
  valor text not null,
  alterado timestamptz not null default now()
);
alter table public.app_segredos enable row level security;
drop policy if exists "segredos: admin lê" on public.app_segredos;
create policy "segredos: admin lê" on public.app_segredos for select to authenticated using (public.eu_admin());
grant select on public.app_segredos to authenticated;
insert into public.app_segredos(nome, valor)
  values ('leads', encode(extensions.gen_random_bytes(18), 'hex'))
  on conflict (nome) do nothing;

create or replace function public.gerar_token(p_nome text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not public.eu_admin() then raise exception 'Somente o administrador pode gerar tokens.'; end if;
  if p_nome not in ('leads') then raise exception 'Token desconhecido.'; end if;
  insert into public.app_segredos(nome, valor) values (p_nome, v)
    on conflict (nome) do update set valor = excluded.valor, alterado = now();
  return v;
end $$;
revoke all on function public.gerar_token(text) from public;
grant execute on function public.gerar_token(text) to authenticated;

create table if not exists public.api_cache(
  chave text primary key,
  valor jsonb not null,
  em timestamptz not null default now()
);
alter table public.api_cache enable row level security;

create or replace function public.criar_lead_externo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tel text := regexp_replace(coalesce(p->>'tel', ''), '\D', '', 'g');
  v_nome text := left(trim(coalesce(p->>'nome', '')), 120);
  v_email text := left(lower(trim(coalesce(p->>'email', ''))), 160);
  v_origem text := lower(coalesce(nullif(trim(p->>'origem'), ''), 'site'));
  v_msg text := left(trim(coalesce(p->>'mensagem', '')), 1000);
  v_agora bigint := (extract(epoch from now()) * 1000)::bigint;
  v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_ex record; v_n bigint; v_auto jsonb; v_lista jsonb; v_i int; v_resp text := '';
  v_id text; v_num text; v_carro text := ''; v_orc numeric := null; v_veic text;
begin
  if length(v_nome) < 2 then raise exception 'Informe o nome.'; end if;
  if v_tel = '' and v_email = '' then raise exception 'Informe telefone ou e-mail.'; end if;
  if v_origem not in ('instagram','facebook','whatsapp','olx','webmotors','icarros','mercadolivre','mobiauto','google','indicacao','loja','site','outro') then
    v_origem := 'outro';
  end if;
  begin v_orc := nullif(regexp_replace(coalesce(p->>'orcamento',''), '[^0-9.]', '', 'g'), '')::numeric; exception when others then v_orc := null; end;
  v_veic := upper(regexp_replace(coalesce(p->>'veiculo', p->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  if v_veic <> '' then
    select d.id into v_carro from public.docs d
      where d.coll = 'carros' and (d.data->>'placa' = v_veic or upper(d.data->>'num') = v_veic) limit 1;
    v_carro := coalesce(v_carro, '');
  end if;

  if length(v_tel) >= 10 then
    select d.id, d.data into v_ex from public.docs d
      where d.coll = 'leads' and coalesce(d.data->>'st','') not in ('ganho','perdido')
        and right(regexp_replace(coalesce(d.data->>'tel',''), '\D', '', 'g'), 10) = right(v_tel, 10)
      limit 1 for update;
    if found then
      update public.docs set data = jsonb_set(data, '{notas}', coalesce(data->'notas', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('t', v_agora, 'u', '', 'un', 'Captação automática', 'tp', 'in',
            'txt', 'Novo contato pelo canal ' || v_origem || case when v_msg <> '' then ': ' || v_msg else '' end)))
          || jsonb_build_object('alt', v_agora)
        where coll = 'leads' and id = v_ex.id;
      v_id := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
      insert into public.docs(coll, id, data) values ('aud', v_id, jsonb_build_object('id', v_id, 't', v_agora, 'u', '', 'un', 'Captação automática',
        'tela', '2201', 'acao', 'Novo contato de lead já existente: ' || (v_ex.data->>'num') || ' · ' || (v_ex.data->>'nome') || ' (' || v_origem || ')', 'alvo', v_ex.id));
      return jsonb_build_object('ok', true, 'id', v_ex.id, 'num', v_ex.data->>'num', 'duplicado', true);
    end if;
  end if;

  insert into public.docs(coll, id, data) values ('conf', 'seq', '{}'::jsonb) on conflict do nothing;
  update public.docs set data = jsonb_set(data, '{lead}', to_jsonb(coalesce((data->>'lead')::bigint, 0) + 1))
    where coll = 'conf' and id = 'seq' returning (data->>'lead')::bigint into v_n;
  v_num := 'LD' || lpad(v_n::text, 4, '0');

  select data into v_auto from public.docs where coll = 'conf' and id = 'auto';
  if coalesce((v_auto->'rodizio'->>'on')::boolean, false) then
    v_lista := coalesce(v_auto->'rodizio'->'users', '[]'::jsonb);
    if jsonb_array_length(v_lista) > 0 then
      insert into public.docs(coll, id, data) values ('conf', 'rodizio', '{"i":0}'::jsonb) on conflict do nothing;
      update public.docs set data = jsonb_build_object('i', coalesce((data->>'i')::int, 0) + 1)
        where coll = 'conf' and id = 'rodizio' returning (data->>'i')::int into v_i;
      v_resp := v_lista->>((v_i - 1) % jsonb_array_length(v_lista));
    end if;
  end if;

  v_id := substr(md5(random()::text || clock_timestamp()::text), 1, 7);
  insert into public.docs(coll, id, data) values ('leads', v_id, jsonb_build_object(
    'id', v_id, 'num', v_num, 'st', 'novo', 'nome', v_nome, 'tel', coalesce(p->>'tel', ''), 'email', v_email,
    'origem', v_origem, 'orc', v_orc, 'carro', v_carro, 'interesse', left(coalesce(p->>'interesse', ''), 200),
    'prox', v_hoje, 'resp', v_resp, 'criado', v_agora, 'by', '', 'alt', v_agora,
    'notas', case when v_msg <> '' then jsonb_build_array(jsonb_build_object('t', v_agora, 'u', '', 'un', 'Captação automática', 'tp', 'in', 'txt', v_msg)) else '[]'::jsonb end,
    'ext', jsonb_build_object('canal', coalesce(p->>'canal', ''), 'ref', coalesce(p->>'ref', '')),
    'consent', coalesce((p->>'consentimento')::boolean, false)));
  insert into public.docs(coll, id, data) values ('aud', v_id || 'a', jsonb_build_object('id', v_id || 'a', 't', v_agora, 'u', '', 'un', 'Captação automática',
    'tela', '2201', 'acao', 'Lead recebido (' || v_origem || '): ' || v_num || ' · ' || v_nome, 'alvo', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'num', v_num, 'duplicado', false, 'resp', v_resp);
end $$;
revoke all on function public.criar_lead_externo(jsonb) from public, anon, authenticated;
grant execute on function public.criar_lead_externo(jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('anexos', 'anexos', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do nothing;
drop policy if exists "anexos: ler" on storage.objects;
create policy "anexos: ler" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and public.eu_ativo());
drop policy if exists "anexos: enviar" on storage.objects;
create policy "anexos: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and public.pode_gravar('qdr'));
drop policy if exists "anexos: apagar" on storage.objects;
create policy "anexos: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and public.pode_gravar('qdr'));

create table if not exists public.backups(
  dia date primary key,
  criado timestamptz not null default now(),
  registros int not null,
  tamanho_kb int not null,
  dados jsonb not null
);
alter table public.backups enable row level security;
drop policy if exists "backups: admin lê" on public.backups;
create policy "backups: admin lê" on public.backups for select to authenticated using (public.eu_admin());
grant select on public.backups to authenticated;

create or replace function public.fazer_backup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_d jsonb; v_kb int;
begin
  if auth.uid() is not null and not public.eu_admin() then raise exception 'Somente o administrador pode fazer backup.'; end if;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data, 'ver', ver) order by ord), '[]'::jsonb)
    into v_n, v_d from public.docs;
  v_kb := (octet_length(v_d::text) / 1024)::int;
  insert into public.backups(dia, registros, tamanho_kb, dados) values (current_date, v_n, v_kb, v_d)
    on conflict (dia) do update set criado = now(), registros = excluded.registros, tamanho_kb = excluded.tamanho_kb, dados = excluded.dados;
  delete from public.backups where dia < current_date - 14;
  return jsonb_build_object('dia', current_date, 'registros', v_n, 'tamanho_kb', v_kb);
end $$;
revoke all on function public.fazer_backup() from public, anon;
grant execute on function public.fazer_backup() to authenticated, service_role;

create or replace function public.saude() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and not public.eu_admin() then null else jsonb_build_object(
    'docs', (select count(*) from public.docs),
    'por_colecao', (select jsonb_object_agg(coll, n) from (select coll, count(*) n from public.docs group by coll) x),
    'tamanho_kb', (select (sum(pg_column_size(d.data)) / 1024)::int from public.docs d),
    'usuarios', (select count(*) from public.profiles),
    'admins_ativos', (select count(*) from public.profiles where admin and ativo),
    'ultimo_backup', (select max(dia) from public.backups),
    'ultima_alteracao', (select max(alterado) from public.docs)
  ) end $$;
revoke all on function public.saude() from public, anon;
grant execute on function public.saude() to authenticated, service_role;
