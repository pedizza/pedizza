create table if not exists public.menu_border_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  description text not null default '',
  image_path text,
  active boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);

create index if not exists menu_border_groups_tenant_order
  on public.menu_border_groups(tenant_id,sort_order,name)
  where archived_at is null;

drop trigger if exists touch_menu_border_groups on public.menu_border_groups;
create trigger touch_menu_border_groups before update on public.menu_border_groups
  for each row execute function private.touch_updated_at();

alter table public.menu_borders add column if not exists group_id uuid;
alter table public.menu_borders add column if not exists sort_order integer not null default 0;

insert into public.menu_border_groups(
  id,tenant_id,name,description,active,sort_order,archived_at,created_at,updated_at
)
select id,tenant_id,name,description,active,0,archived_at,created_at,updated_at
from public.menu_borders
on conflict(id) do nothing;

update public.menu_borders set group_id=id where group_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='menu_borders_group_fk'
  ) then
    alter table public.menu_borders
      add constraint menu_borders_group_fk
      foreign key(tenant_id,group_id)
      references public.menu_border_groups(tenant_id,id);
  end if;
end $$;

alter table public.menu_borders alter column group_id set not null;

create index if not exists menu_borders_group_order
  on public.menu_borders(tenant_id,group_id,sort_order,name)
  where archived_at is null;

create table if not exists public.menu_border_group_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  group_id uuid not null,
  category_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,group_id)
    references public.menu_border_groups(tenant_id,id),
  foreign key(tenant_id,category_id)
    references public.menu_categories(tenant_id,id),
  unique(tenant_id,id),
  unique(tenant_id,group_id,category_id)
);

create index if not exists menu_border_group_categories_tenant_group
  on public.menu_border_group_categories(tenant_id,group_id);

drop trigger if exists touch_menu_border_group_categories
  on public.menu_border_group_categories;
create trigger touch_menu_border_group_categories
  before update on public.menu_border_group_categories
  for each row execute function private.touch_updated_at();

insert into public.menu_border_group_categories(tenant_id,group_id,category_id)
select tenant_id,border_id,category_id
from public.menu_border_categories
on conflict(tenant_id,group_id,category_id) do nothing;

alter table public.menu_border_groups enable row level security;
alter table public.menu_border_group_categories enable row level security;

revoke all on public.menu_border_groups from anon,authenticated;
revoke all on public.menu_border_group_categories from anon,authenticated;
grant select,insert,update on public.menu_border_groups to authenticated;
grant select,insert,update,delete on public.menu_border_group_categories to authenticated;

drop policy if exists menu_border_groups_read on public.menu_border_groups;
create policy menu_border_groups_read on public.menu_border_groups
  for select to authenticated
  using(private.has_permission(tenant_id,'menu.view') and private.subscription_active(tenant_id));

drop policy if exists menu_border_groups_insert on public.menu_border_groups;
create policy menu_border_groups_insert on public.menu_border_groups
  for insert to authenticated
  with check(private.has_permission(tenant_id,'menu.edit') and private.subscription_active(tenant_id));

drop policy if exists menu_border_groups_update on public.menu_border_groups;
create policy menu_border_groups_update on public.menu_border_groups
  for update to authenticated
  using(private.has_permission(tenant_id,'menu.edit') and private.subscription_active(tenant_id))
  with check(private.has_permission(tenant_id,'menu.edit') and private.subscription_active(tenant_id));

drop policy if exists menu_border_group_categories_read on public.menu_border_group_categories;
create policy menu_border_group_categories_read on public.menu_border_group_categories
  for select to authenticated
  using(private.has_permission(tenant_id,'menu.view') and private.subscription_active(tenant_id));

drop policy if exists menu_border_group_categories_insert on public.menu_border_group_categories;
create policy menu_border_group_categories_insert on public.menu_border_group_categories
  for insert to authenticated
  with check(private.has_permission(tenant_id,'menu.edit') and private.subscription_active(tenant_id));

drop policy if exists menu_border_group_categories_delete on public.menu_border_group_categories;
create policy menu_border_group_categories_delete on public.menu_border_group_categories
  for delete to authenticated
  using(private.has_permission(tenant_id,'menu.edit') and private.subscription_active(tenant_id));
