-- Lifetime access is an explicit administrative grant, never user metadata.
alter table public.subscriptions add column lifetime_access boolean not null default false;
create or replace function private.subscription_active(t uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subscriptions s join public.tenants t1 on t1.id=s.tenant_id
 where s.tenant_id=t and s.status='active' and (s.lifetime_access or s.current_period_end>now())
 and not t1.manually_suspended)
$$;
