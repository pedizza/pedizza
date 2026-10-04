-- All application mutations go through server routes that enforce permission,
-- audit, cross-record validation and optimistic concurrency. Browser reads and
-- Realtime remain protected by tenant RLS. Never grant a browser elevated writes.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' loop
  execute format('revoke insert,update,delete on public.%I from authenticated,anon',r.tablename);
 end loop;
end $$;
