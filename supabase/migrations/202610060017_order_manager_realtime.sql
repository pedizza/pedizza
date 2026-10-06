alter table public.store_settings
  drop constraint if exists store_settings_status_mode_check;

alter table public.store_settings
  add constraint store_settings_status_mode_check
  check(status_mode in ('automatic','forced_open','paused','forced_closed'));

create index if not exists orders_tenant_updated_idx
  on public.orders(tenant_id,updated_at desc);

create index if not exists orders_tenant_created_idx
  on public.orders(tenant_id,created_at desc,id);
