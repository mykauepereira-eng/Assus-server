-- 006: pg_net fora do schema public (aviso do verificador de segurança). Nada depende dela ainda.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;
