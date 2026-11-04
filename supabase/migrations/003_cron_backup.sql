create extension if not exists pg_cron;
select cron.schedule('backup-diario', '15 6 * * *', $$select public.fazer_backup()$$);
