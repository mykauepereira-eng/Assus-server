-- Checkup do sistema (só leitura): cópia da skill checkup-sistema-concessionaria.
with
s as (select public.saude() j),
b as (select max(dia) ultimo, count(*) n from public.backups),
cr as (select d.status, d.return_message, d.start_time
         from cron.job_run_details d join cron.job j using (jobid)
        where j.jobname = 'backup-diario' order by d.start_time desc limit 1),
n as (select
  (select count(*) from auth.users au where not exists (select 1 from public.profiles p where p.id = au.id)) login_sem_perfil,
  (select count(*) from public.profiles where admin and ativo) admins_ativos,
  (select count(*) from public.profiles where ativo) usuarios_ativos,
  (select count(*) from public.docs where public.area_de(coll) = 'outros') colecao_sem_area,
  (select count(*) from public.docs where jsonb_typeof(data) <> 'object') registro_quebrado,
  (select count(*) from public.docs where coll = 'leads' and coalesce(data->>'st','novo') not in ('ganho','perdido')
      and coalesce(data->>'resp','') = '') leads_abertos_sem_vendedor,
  (select count(*) from public.docs where coll = 'leads' and coalesce(data->>'st','novo') = 'novo'
      and alterado < now() - interval '1 day') leads_novos_parados_1dia,
  (select count(*) from public.docs where coll = 'carros' and data->>'st' = 'disp'
      and coalesce((data#>>'{preco,anun}')::numeric, 0) <= 0) carros_disponiveis_sem_preco,
  (select count(*) from public.docs where coll = 'aud' and alterado > now() - interval '7 days') acoes_ultimos_7_dias,
  (select count(*) from public.app_segredos where nome = 'leads') token_leads,
  (select pg_database_size(current_database()) / 1048576) banco_mb,
  (select coalesce(sum((metadata->>'size')::bigint), 0) / 1048576 from storage.objects where bucket_id = 'anexos') fotos_mb,
  (select count(*) from public.api_cache where em < now() - interval '30 days') cache_velho
)
select
  array_remove(array[
    case when n.admins_ativos = 0 and n.usuarios_ativos > 0 then 'Nenhum administrador ativo: ninguém consegue gerenciar usuários.' end,
    case when n.usuarios_ativos > 0 and (b.ultimo is null or b.ultimo < current_date - 1) then 'Backup atrasado: o último é de ' || coalesce(b.ultimo::text, 'nunca') || '.' end,
    case when cr.status is not null and cr.status <> 'succeeded' then 'A última execução do backup agendado falhou: ' || coalesce(cr.return_message, cr.status) end,
    case when n.login_sem_perfil > 0 then n.login_sem_perfil || ' login(s) sem perfil: a pessoa entra mas não vê nada.' end,
    case when n.colecao_sem_area > 0 then n.colecao_sem_area || ' registro(s) numa coleção sem área (area_de devolve outros): só o admin enxerga.' end,
    case when n.registro_quebrado > 0 then n.registro_quebrado || ' registro(s) com dados quebrados.' end,
    case when n.leads_abertos_sem_vendedor > 0 then n.leads_abertos_sem_vendedor || ' lead(s) aberto(s) sem vendedor: confira a fila do rodízio em 3306.' end,
    case when n.leads_novos_parados_1dia > 0 then n.leads_novos_parados_1dia || ' lead(s) novo(s) sem movimento há mais de 1 dia.' end,
    case when n.carros_disponiveis_sem_preco > 0 then n.carros_disponiveis_sem_preco || ' carro(s) disponível(is) sem preço de anúncio: não aparecem na vitrine.' end,
    case when n.token_leads = 0 then 'Token do formulário de leads sumiu: gere um novo em 3305.' end,
    case when n.banco_mb > 400 then 'Banco com ' || n.banco_mb || ' MB: perto do limite de 500 MB do plano grátis.' end,
    case when n.fotos_mb > 800 then 'Fotos com ' || n.fotos_mb || ' MB: perto do limite de 1 GB do plano grátis.' end
  ], null) as alertas,
  jsonb_build_object(
    'saude', s.j, 'ultimo_backup', b.ultimo, 'backups_guardados', b.n,
    'backup_agendado', jsonb_build_object('status', cr.status, 'quando', cr.start_time),
    'usuarios_ativos', n.usuarios_ativos, 'admins_ativos', n.admins_ativos, 'login_sem_perfil', n.login_sem_perfil,
    'leads_abertos_sem_vendedor', n.leads_abertos_sem_vendedor, 'leads_novos_parados_1dia', n.leads_novos_parados_1dia,
    'carros_disponiveis_sem_preco', n.carros_disponiveis_sem_preco, 'acoes_ultimos_7_dias', n.acoes_ultimos_7_dias,
    'banco_mb', n.banco_mb, 'fotos_mb', n.fotos_mb, 'cache_velho', n.cache_velho
  ) as numeros
from n cross join s cross join b left join cr on true;
