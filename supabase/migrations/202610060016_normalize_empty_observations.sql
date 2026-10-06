update public.cart_items
set observation=''
where lower(trim(observation)) in (
  'não',
  'nao',
  'nenhuma',
  'nenhuma observação',
  'nenhuma observacao',
  'sem',
  'sem observação',
  'sem observacao'
);

update public.order_items
set observation=''
where lower(trim(observation)) in (
  'não',
  'nao',
  'nenhuma',
  'nenhuma observação',
  'nenhuma observacao',
  'sem',
  'sem observação',
  'sem observacao'
);
