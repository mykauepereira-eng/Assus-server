-- 008: Atendente IA (tela 2206)
-- Conversas de WhatsApp, Instagram e Facebook Messenger respondidas pelo Claude, com o vendedor no controle.
-- Quem lê: quem tem a área 22 (CRM). Quem grava: só o servidor (função "atendente"), que confere o cargo.
-- Nada aqui altera dados existentes.

create table if not exists public.atd_conversas(
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('whatsapp','instagram','messenger','teste')),
  externo text not null,                    -- número do WhatsApp ou id do contato na Meta
  nome text not null default '',
  tel text not null default '',
  lead_id text not null default '',         -- lead em 2201 (docs: leads)
  estado text not null default 'robo' check (estado in ('robo','humano','transferido','encerrado')),
  pausado_ate timestamptz,                  -- o robô fica calado até aqui (vendedor assumiu ou pediu vendedor)
  motivo text not null default '',
  temperatura text not null default '',
  resumo text not null default '',
  dados jsonb not null default '{}'::jsonb, -- o que o atendente já sabe do cliente
  ultima_cliente timestamptz,               -- janela de 24 h do WhatsApp
  ultima timestamptz not null default now(),
  nao_lidas int not null default 0,
  criado timestamptz not null default now(),
  unique (canal, externo)
);
create index if not exists atd_conv_ultima_idx on public.atd_conversas(ultima desc);

create table if not exists public.atd_mensagens(
  id bigint generated always as identity primary key,
  conversa uuid not null references public.atd_conversas(id) on delete cascade,
  dir text not null check (dir in ('in','out')),
  autor text not null check (autor in ('cliente','robo','humano','sistema')),
  texto text not null default '',
  meta_id text,                             -- id da mensagem na Meta: a mesma mensagem nunca entra duas vezes
  por uuid,                                 -- quem da equipe enviou
  em timestamptz not null default now(),
  info jsonb not null default '{}'::jsonb
);
create unique index if not exists atd_msg_meta_uni on public.atd_mensagens(meta_id) where meta_id is not null;
create index if not exists atd_msg_conversa_idx on public.atd_mensagens(conversa, id desc);
create index if not exists atd_msg_em_idx on public.atd_mensagens(em);

create table if not exists public.atd_uso(
  mes text primary key,                     -- AAAA-MM
  respostas int not null default 0,
  entrada bigint not null default 0,
  saida bigint not null default 0,
  cache bigint not null default 0
);

alter table public.atd_conversas enable row level security;
alter table public.atd_mensagens enable row level security;
alter table public.atd_uso enable row level security;
drop policy if exists "atendente: lê conversas" on public.atd_conversas;
create policy "atendente: lê conversas" on public.atd_conversas for select to authenticated using (privado.pode_ler('22'));
drop policy if exists "atendente: lê mensagens" on public.atd_mensagens;
create policy "atendente: lê mensagens" on public.atd_mensagens for select to authenticated using (privado.pode_ler('22'));
drop policy if exists "atendente: lê uso" on public.atd_uso;
create policy "atendente: lê uso" on public.atd_uso for select to authenticated using (privado.pode_ler('22'));
revoke all on public.atd_conversas, public.atd_mensagens, public.atd_uso from anon;
revoke insert, update, delete on public.atd_conversas, public.atd_mensagens, public.atd_uso from authenticated;
grant select on public.atd_conversas, public.atd_mensagens, public.atd_uso to authenticated;

-- tempo real na tela 2206
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atd_conversas') then
    alter publication supabase_realtime add table public.atd_conversas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atd_mensagens') then
    alter publication supabase_realtime add table public.atd_mensagens;
  end if;
end $$;

-- token do webhook (verificação da Meta); trocado em 2206 pelo administrador
insert into public.app_segredos(nome, valor)
  values ('atendente', encode(extensions.gen_random_bytes(18), 'hex'))
  on conflict (nome) do nothing;
create or replace function public.gerar_token(p_nome text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not privado.eu_admin() then raise exception 'Somente o administrador pode gerar tokens.'; end if;
  if p_nome not in ('leads', 'atendente') then raise exception 'Token desconhecido.'; end if;
  insert into public.app_segredos(nome, valor) values (p_nome, v)
    on conflict (nome) do update set valor = excluded.valor, alterado = now();
  return v;
end $$;
revoke all on function public.gerar_token(text) from public, anon;
grant execute on function public.gerar_token(text) to authenticated;

-- mensagem que chega (ou eco de mensagem enviada pelo app da Meta): grava uma vez só
create or replace function public.atd_entrada(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.atd_conversas%rowtype; v_id bigint; v_h int;
begin
  if coalesce(p->>'canal','') not in ('whatsapp','instagram','messenger','teste') or coalesce(p->>'externo','') = '' then
    raise exception 'Mensagem sem canal ou contato.';
  end if;
  insert into public.atd_conversas(canal, externo, nome, tel)
    values (p->>'canal', left(p->>'externo', 120), left(coalesce(p->>'nome', ''), 120), left(regexp_replace(coalesce(p->>'tel', ''), '\D', '', 'g'), 20))
    on conflict (canal, externo) do update set
      nome = case when public.atd_conversas.nome = '' then excluded.nome else public.atd_conversas.nome end,
      tel = case when public.atd_conversas.tel = '' then excluded.tel else public.atd_conversas.tel end
    returning * into v_c;
  if coalesce((p->>'eco')::boolean, false) then
    insert into public.atd_mensagens(conversa, dir, autor, texto, meta_id, info)
      values (v_c.id, 'out', 'humano', left(coalesce(p->>'texto', ''), 4000), nullif(p->>'meta_id', ''), jsonb_build_object('via', 'app da Meta'))
      on conflict do nothing returning id into v_id;
    if v_id is null then return jsonb_build_object('dup', true); end if;
    v_h := least(greatest(coalesce((p->>'pausa_h')::int, 12), 1), 72);
    update public.atd_conversas set estado = 'humano', pausado_ate = now() + make_interval(hours => v_h), ultima = now() where id = v_c.id;
    return jsonb_build_object('conversa', v_c.id, 'msg', v_id, 'eco', true);
  end if;
  insert into public.atd_mensagens(conversa, dir, autor, texto, meta_id)
    values (v_c.id, 'in', 'cliente', left(coalesce(p->>'texto', ''), 4000), nullif(p->>'meta_id', ''))
    on conflict do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('dup', true); end if;
  update public.atd_conversas set ultima = now(), ultima_cliente = now(), nao_lidas = nao_lidas + 1,
    estado = case when estado = 'encerrado' then 'robo' else estado end
    where id = v_c.id;
  return jsonb_build_object('conversa', v_c.id, 'msg', v_id, 'eco', false);
end $$;

-- respostas e tokens do mês (limite de gasto)
create or replace function public.atd_contar(p_in bigint, p_out bigint, p_cache bigint) returns int
language sql security definer set search_path = '' as $$
  insert into public.atd_uso(mes, respostas, entrada, saida, cache)
    values (to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'), 1, greatest(p_in, 0), greatest(p_out, 0), greatest(p_cache, 0))
    on conflict (mes) do update set respostas = public.atd_uso.respostas + 1, entrada = public.atd_uso.entrada + excluded.entrada,
      saida = public.atd_uso.saida + excluded.saida, cache = public.atd_uso.cache + excluded.cache
    returning respostas $$;

-- leva o que o atendente descobriu para o lead em 2201 (cria na primeira vez, com o rodízio de vendedores)
create or replace function public.atd_lead(p_conv uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.atd_conversas%rowtype;
  v_agora bigint := (extract(epoch from now()) * 1000)::bigint;
  v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_tr boolean := coalesce((p->>'transferir')::boolean, false);
  v_origem text; v_canal_n text; v_nome text; v_tel text; v_int text; v_orc numeric; v_carro text := ''; v_nota text; v_upd jsonb;
  v_ld record; v_r jsonb; v_n bigint; v_num text; v_auto jsonb; v_lista jsonb; v_i int; v_resp text := ''; v_id text;
begin
  select * into v_c from public.atd_conversas where id = p_conv for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if v_c.canal = 'teste' then return jsonb_build_object('ok', true, 'teste', true); end if;
  v_origem := case v_c.canal when 'whatsapp' then 'whatsapp' when 'instagram' then 'instagram' else 'facebook' end;
  v_canal_n := case v_c.canal when 'whatsapp' then 'WhatsApp' when 'instagram' then 'Instagram' else 'Facebook' end;
  v_nome := left(coalesce(nullif(trim(p->>'nome'), ''), nullif(trim(v_c.nome), ''), 'Contato do ' || v_canal_n), 120);
  v_tel := coalesce(nullif(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), ''), nullif(v_c.tel, ''), '');
  v_int := left(trim(coalesce(p->>'interesse', '')), 200);
  begin v_orc := nullif(regexp_replace(coalesce(p->>'orcamento', ''), '[^0-9]', '', 'g'), '')::numeric; exception when others then v_orc := null; end;
  if coalesce(p->>'codigo_carro', '') <> '' then
    select d.id into v_carro from public.docs d where d.coll = 'carros' and upper(d.data->>'num') = upper(p->>'codigo_carro') limit 1;
    v_carro := coalesce(v_carro, '');
  end if;
  v_nota := 'Atendente IA (' || v_canal_n || '): ' || coalesce(nullif(trim(p->>'resumo'), ''), 'conversa em andamento')
    || case when coalesce(p->>'troca', '') <> '' then ' · troca: ' || (p->>'troca') else '' end
    || case when coalesce(p->>'pagamento', '') <> '' then ' · pagamento: ' || (p->>'pagamento') else '' end
    || case when coalesce(p->>'visita', '') <> '' then ' · visita: ' || (p->>'visita') else '' end
    || case when v_tr then ' · pediu vendedor: ' || coalesce(nullif(p->>'motivo', ''), 'sem motivo') else '' end;
  v_nota := left(v_nota, 1000);

  -- lead já ligado à conversa: completa o que faltava, sem apagar o que o vendedor escreveu
  if v_c.lead_id <> '' then
    select d.id, d.data into v_ld from public.docs d where d.coll = 'leads' and d.id = v_c.lead_id for update;
    if found then
      v_upd := jsonb_build_object('alt', v_agora, 'ia', jsonb_build_object('conv', p_conv, 'temp', coalesce(p->>'temperatura', ''), 'resumo', left(coalesce(p->>'resumo', ''), 400)));
      if coalesce(v_ld.data->>'interesse', '') = '' and v_int <> '' then v_upd := v_upd || jsonb_build_object('interesse', v_int); end if;
      if jsonb_typeof(v_ld.data->'orc') is distinct from 'number' and v_orc is not null then v_upd := v_upd || jsonb_build_object('orc', v_orc); end if;
      if coalesce(v_ld.data->>'carro', '') = '' and v_carro <> '' then v_upd := v_upd || jsonb_build_object('carro', v_carro); end if;
      if coalesce(v_ld.data->>'tel', '') = '' and v_tel <> '' then v_upd := v_upd || jsonb_build_object('tel', v_tel); end if;
      if coalesce(v_ld.data->>'nome', '') like 'Contato do %' and coalesce(trim(p->>'nome'), '') <> '' then v_upd := v_upd || jsonb_build_object('nome', left(trim(p->>'nome'), 120)); end if;
      if v_tr then
        v_upd := v_upd || jsonb_build_object('notas', coalesce(v_ld.data->'notas', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('t', v_agora, 'u', '', 'un', 'Atendente IA', 'tp', 'in', 'txt', v_nota)));
      end if;
      update public.docs set data = data || v_upd where coll = 'leads' and id = v_ld.id;
      if v_tr then
        v_id := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
        insert into public.docs(coll, id, data) values ('aud', v_id, jsonb_build_object('id', v_id, 't', v_agora, 'u', '', 'un', 'Atendente IA', 'tela', '2206',
          'acao', 'Atendente IA: chamou vendedor para ' || (v_ld.data->>'num') || ' · ' || coalesce(v_ld.data->>'nome', '') || ' (' || coalesce(nullif(p->>'motivo', ''), 'sem motivo') || ')', 'alvo', v_ld.id));
      end if;
      return jsonb_build_object('ok', true, 'id', v_ld.id, 'num', v_ld.data->>'num', 'resp', coalesce(v_ld.data->>'resp', ''), 'novo', false);
    end if;
  end if;

  -- WhatsApp (tem telefone): usa a captação de sempre, que não duplica lead do mesmo telefone
  if length(v_tel) >= 10 then
    v_r := public.criar_lead_externo(jsonb_build_object('nome', v_nome, 'tel', v_tel, 'origem', v_origem, 'interesse', v_int,
      'orcamento', coalesce(v_orc::text, ''), 'veiculo', coalesce(p->>'codigo_carro', ''), 'mensagem', v_nota, 'canal', 'atendente', 'ref', p_conv::text));
    update public.atd_conversas set lead_id = coalesce(v_r->>'id', '') where id = p_conv;
    if not coalesce((v_r->>'duplicado')::boolean, false) then
      update public.docs set data = data || jsonb_build_object('ia', jsonb_build_object('conv', p_conv, 'temp', coalesce(p->>'temperatura', ''), 'resumo', left(coalesce(p->>'resumo', ''), 400)))
        where coll = 'leads' and id = v_r->>'id';
    end if;
    return v_r || jsonb_build_object('novo', not coalesce((v_r->>'duplicado')::boolean, false));
  end if;

  -- Instagram e Messenger (sem telefone): cria o lead aqui, com o mesmo número e o mesmo rodízio
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
    'id', v_id, 'num', v_num, 'st', 'novo', 'nome', v_nome, 'tel', v_tel, 'email', '',
    'origem', v_origem, 'orc', v_orc, 'carro', v_carro, 'interesse', v_int,
    'prox', v_hoje, 'resp', v_resp, 'criado', v_agora, 'by', '', 'alt', v_agora,
    'notas', jsonb_build_array(jsonb_build_object('t', v_agora, 'u', '', 'un', 'Atendente IA', 'tp', 'in', 'txt', v_nota)),
    'ext', jsonb_build_object('canal', 'atendente', 'ref', p_conv::text),
    'ia', jsonb_build_object('conv', p_conv, 'temp', coalesce(p->>'temperatura', ''), 'resumo', left(coalesce(p->>'resumo', ''), 400)),
    'consent', false));
  insert into public.docs(coll, id, data) values ('aud', v_id || 'a', jsonb_build_object('id', v_id || 'a', 't', v_agora, 'u', '', 'un', 'Atendente IA',
    'tela', '2206', 'acao', 'Atendente IA: lead recebido (' || v_canal_n || '): ' || v_num || ' · ' || v_nome, 'alvo', v_id));
  update public.atd_conversas set lead_id = v_id where id = p_conv;
  return jsonb_build_object('ok', true, 'id', v_id, 'num', v_num, 'resp', v_resp, 'novo', true);
end $$;

-- LGPD: apaga mensagens mais velhas que o prazo escolhido em 2206 (padrão 180 dias) e as simulações antigas
create or replace function public.atd_limpar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_txt text; v_d int := 180; v_m int; v_c int; v_t int;
begin
  select data->'atd'->>'guardarDias' into v_txt from public.docs where coll = 'conf' and id = 'integ';
  if v_txt ~ '^\d{1,4}$' then v_d := least(greatest(v_txt::int, 7), 730); end if;
  delete from public.atd_mensagens where em < now() - make_interval(days => v_d);
  get diagnostics v_m = row_count;
  delete from public.atd_conversas c where c.ultima < now() - make_interval(days => v_d)
    and not exists (select 1 from public.atd_mensagens m where m.conversa = c.id);
  get diagnostics v_c = row_count;
  delete from public.atd_conversas where canal = 'teste' and ultima < now() - interval '7 days';
  get diagnostics v_t = row_count;
  return jsonb_build_object('dias', v_d, 'mensagens', v_m, 'conversas', v_c, 'simulacoes', v_t);
end $$;

revoke all on function public.atd_entrada(jsonb) from public, anon, authenticated;
revoke all on function public.atd_contar(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.atd_lead(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.atd_limpar() from public, anon, authenticated;
grant execute on function public.atd_entrada(jsonb) to service_role;
grant execute on function public.atd_contar(bigint, bigint, bigint) to service_role;
grant execute on function public.atd_lead(uuid, jsonb) to service_role;
grant execute on function public.atd_limpar() to service_role;

select cron.schedule('atendente-limpeza', '45 6 * * *', $$select public.atd_limpar()$$);
