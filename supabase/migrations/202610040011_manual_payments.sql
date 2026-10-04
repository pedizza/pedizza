-- Keep historical payments; remove automatic PIX from future orders.
update public.payment_methods set active=false,archived_at=coalesce(archived_at,now()) where type='pix_mercado_pago';
update private.oauth_states set used_at=now() where used_at is null;
update private.outbox set status='failed' where kind='payment' and status in ('pending','processing');
alter table public.payment_methods add constraint no_active_automatic_pix check(type<>'pix_mercado_pago' or not active);
