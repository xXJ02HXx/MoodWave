create table if not exists public.users (
  id bigserial primary key,
  username text unique not null,
  salt text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- Server uses service_role key, so RLS policies are optional for this demo setup.
