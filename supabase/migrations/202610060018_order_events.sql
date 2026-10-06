create or replace function private.notify_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify(
    'pedizza_orders',
    json_build_object(
      'tenantId', coalesce(new.tenant_id, old.tenant_id),
      'orderId', coalesce(new.id, old.id),
      'kind', lower(tg_op)
    )::text
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.notify_order_change() from public, anon, authenticated;

drop trigger if exists notify_order_change on public.orders;
create trigger notify_order_change
after insert or update or delete on public.orders
for each row execute function private.notify_order_change();
