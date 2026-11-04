-- Checkup do Atendente IA (só leitura). Rode depois do checkup.sql, com a migração 008 aplicada.
-- (Sem a 008, o Postgres responde que a tabela atd_conversas não existe: aplique a migração primeiro.)
with
cf as (select coalesce(data->'atd', '{}'::jsonb) a from public.docs where coll = 'conf' and id = 'integ')
select jsonb_build_object(
    'alertas', to_jsonb(array_remove(array[
      case when n.esperando_1h > 0 then n.esperando_1h || ' conversa(s) esperando vendedor há mais de 1 hora: veja 2206 → Esperando vendedor.' end,
      case when n.nao_entregues_7d > 0 then n.nao_entregues_7d || ' resposta(s) que não chegaram ao cliente nos últimos 7 dias: confira os tokens da Meta (2206 → Como ligar).' end,
      case when n.falhas_ia_7d > 0 then n.falhas_ia_7d || ' resposta(s) com erro da IA nos últimos 7 dias: confira a chave ANTHROPIC_API_KEY e os créditos no Console da Claude.' end,
      case when n.limite > 0 and n.respostas_mes >= n.limite * 0.8 then 'Atendente usou ' || n.respostas_mes || ' de ' || n.limite || ' respostas do mês: aumente o limite em 2206 ou espere o mês virar.' end,
      case when (select coalesce((a->>'on')::boolean, false) from cf) and n.conversas_7d = 0 then 'Robô ligado, mas nenhuma conversa nos últimos 7 dias: confira o webhook na Meta.' end
    ], null)),
    'numeros', to_jsonb(n)) as resultado
from (select
    (select count(*) from public.atd_conversas where estado = 'transferido' and ultima < now() - interval '1 hour') esperando_1h,
    (select count(*) from public.atd_mensagens where autor = 'robo' and coalesce(info->>'falha', '') <> '' and em > now() - interval '7 days') nao_entregues_7d,
    (select count(*) from public.atd_mensagens where autor = 'robo' and coalesce(info->>'erro', '') <> '' and em > now() - interval '7 days') falhas_ia_7d,
    (select count(*) from public.atd_conversas where canal <> 'teste' and ultima > now() - interval '7 days') conversas_7d,
    (select count(*) from public.atd_conversas where canal <> 'teste') conversas_total,
    coalesce((select respostas from public.atd_uso where mes = to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM')), 0) respostas_mes,
    coalesce((select (a->>'limiteMes')::int from cf), 1000) limite
  ) n;
