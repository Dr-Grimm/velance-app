create table if not exists public.velance_workspace_snapshots (
  workspace_id text primary key,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_updated_at bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_velance_workspace_snapshots_owner
  on public.velance_workspace_snapshots (owner_user_id);

create or replace function public.velance_workspace_snapshots_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_velance_workspace_snapshots_updated_at
  on public.velance_workspace_snapshots;

create trigger trg_velance_workspace_snapshots_updated_at
before update on public.velance_workspace_snapshots
for each row
execute function public.velance_workspace_snapshots_set_updated_at();

alter table public.velance_workspace_snapshots enable row level security;

drop policy if exists "Users can read their own Velance snapshots"
  on public.velance_workspace_snapshots;
create policy "Users can read their own Velance snapshots"
on public.velance_workspace_snapshots
for select
using (auth.uid() = owner_user_id);

drop policy if exists "Users can insert their own Velance snapshots"
  on public.velance_workspace_snapshots;
create policy "Users can insert their own Velance snapshots"
on public.velance_workspace_snapshots
for insert
with check (auth.uid() = owner_user_id);

drop policy if exists "Users can update their own Velance snapshots"
  on public.velance_workspace_snapshots;
create policy "Users can update their own Velance snapshots"
on public.velance_workspace_snapshots
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);
