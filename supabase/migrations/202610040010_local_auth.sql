-- Authentication owned by Pedizza; Supabase remains the PostgreSQL host.
create table private.accounts (
 id uuid primary key default gen_random_uuid(), email text not null unique check(email=lower(email)),
 password_hash text, email_verified_at timestamptz, created_at timestamptz not null default now(),
 mfa_secret text, mfa_pending_secret text, mfa_last_step bigint
);
-- Preserve existing profile UUIDs without modifying Supabase's managed auth schema.
insert into private.accounts(id,email) select id,'migrated-'||id::text||'@invalid.local' from public.profiles;
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add constraint profiles_id_fkey foreign key(id) references private.accounts(id) on delete cascade;
drop trigger if exists pedizza_on_auth_user_created on auth.users;
create table private.sessions(id uuid primary key default gen_random_uuid(),user_id uuid not null references private.accounts(id) on delete cascade,expires_at timestamptz not null,revoked_at timestamptz,mfa_verified_at timestamptz,created_at timestamptz not null default now());
create index sessions_user on private.sessions(user_id);
create table private.auth_tokens(token_hash text primary key,user_id uuid not null references private.accounts(id) on delete cascade,purpose text not null check(purpose in ('verify','reset')),expires_at timestamptz not null,used_at timestamptz);
create table private.files(bucket text not null,path text not null,tenant_id uuid not null references public.tenants(id),mime text not null,body bytea not null check(octet_length(body)<=20971520),created_at timestamptz not null default now(),primary key(bucket,path));
alter table private.accounts enable row level security;
alter table private.sessions enable row level security;
alter table private.auth_tokens enable row level security;
alter table private.files enable row level security;
revoke all on private.accounts,private.sessions,private.auth_tokens,private.files from public,anon,authenticated;
