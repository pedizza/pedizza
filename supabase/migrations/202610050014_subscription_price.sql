-- Update the Pedizza monthly plan and retire open charges issued at the old price.
update public.subscription_plans
set price_cents=8990
where code='pedizza_monthly';

update private.billing_charges c
set status='expired'
from public.subscriptions s
join public.subscription_plans p on p.id=s.plan_id
where c.subscription_id=s.id
  and p.code='pedizza_monthly'
  and c.status in ('pending','creating')
  and c.amount_cents<>p.price_cents;
