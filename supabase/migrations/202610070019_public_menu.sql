-- Public, read-only catalogue links controlled by each store.
alter table public.store_settings
  add column public_menu_slug text,
  add column public_menu_enabled boolean not null default false;

update public.store_settings
set public_menu_slug = trim(both '-' from regexp_replace(
  coalesce(nullif(regexp_replace(
      translate(lower(display_name),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'),
      '[^a-z0-9]+', '-', 'g'), ''), 'pizzaria'),
  '(^-+|-+$)', '', 'g')) || '-' || left(tenant_id::text, 8);

alter table public.store_settings
  alter column public_menu_slug set not null;
alter table public.store_settings
  add constraint store_settings_public_menu_slug_check
  check (public_menu_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_menu_slug) between 3 and 80);
create unique index store_settings_public_menu_slug_unique
  on public.store_settings(public_menu_slug);

create function private.prepare_public_menu_slug()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.public_menu_slug is null or new.public_menu_slug = '' then
    new.public_menu_slug := trim(both '-' from regexp_replace(
      coalesce(nullif(regexp_replace(
        translate(lower(new.display_name),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'),
        '[^a-z0-9]+', '-', 'g'), ''), 'pizzaria'),
      '(^-+|-+$)', '', 'g')) || '-' || left(new.tenant_id::text, 8);
  end if;
  return new;
end
$$;

create trigger prepare_public_menu_slug
before insert on public.store_settings
for each row execute function private.prepare_public_menu_slug();
