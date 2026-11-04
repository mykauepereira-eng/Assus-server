-- 007: segurança extra
-- 1) identificador de registro só com letras, números e _ . : -  (nada que possa virar código na tela)
-- 2) nome de coleção simples
-- 3) cada registro com no máximo 512 KB (fotos ficam no armazenamento, não aqui)
-- 4) limite de envios por origem para o formulário público de leads
alter table public.docs drop constraint if exists docs_id_seguro;
alter table public.docs add constraint docs_id_seguro check (id ~ '^[A-Za-z0-9_.:-]{1,100}$');
alter table public.docs drop constraint if exists docs_coll_seguro;
alter table public.docs add constraint docs_coll_seguro check (coll ~ '^[a-z0-9_]{1,30}$');
alter table public.docs drop constraint if exists docs_tamanho;
alter table public.docs add constraint docs_tamanho check (pg_column_size(data) <= 524288);

create table if not exists public.limites(
  chave text primary key,
  n int not null default 0,
  ate timestamptz not null
);
alter table public.limites enable row level security;
revoke all on public.limites from anon, authenticated;

create or replace function public.conta_limite(p_chave text, p_max int, p_seg int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  delete from public.limites where ate < now();
  insert into public.limites(chave, n, ate) values (left(p_chave, 120), 1, now() + make_interval(secs => p_seg))
    on conflict (chave) do update set n = public.limites.n + 1
    returning n into v;
  return v <= p_max;
end $$;
revoke all on function public.conta_limite(text, int, int) from public, anon, authenticated;
grant execute on function public.conta_limite(text, int, int) to service_role;
