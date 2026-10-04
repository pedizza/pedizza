alter table public.conversation_messages add column processed_at timestamptz;
alter table public.conversations add column bot_epoch integer not null default 0;
create table private.oauth_states(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),user_id uuid not null references public.profiles(id),state_hash text not null unique,expires_at timestamptz not null default now()+interval '10 minutes',used_at timestamptz);
alter table private.oauth_states enable row level security;
revoke all on private.oauth_states from public,anon,authenticated;
