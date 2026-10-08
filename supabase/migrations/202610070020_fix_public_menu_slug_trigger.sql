-- Make automatic public slugs robust for store names made only of symbols.
create or replace function private.prepare_public_menu_slug()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  base_slug text;
begin
  if new.public_menu_slug is null or new.public_menu_slug = '' then
    base_slug := trim(both '-' from regexp_replace(
      translate(lower(new.display_name),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'),
      '[^a-z0-9]+', '-', 'g'));
    if base_slug = '' then
      base_slug := 'pizzaria';
    end if;
    new.public_menu_slug := base_slug || '-' || left(new.tenant_id::text, 8);
  end if;
  return new;
end
$$;
