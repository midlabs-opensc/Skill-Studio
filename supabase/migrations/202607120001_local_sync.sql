create table if not exists public.skills (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.projects (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.runs (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.tests (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now());
alter table public.skills enable row level security; alter table public.projects enable row level security; alter table public.runs enable row level security; alter table public.tests enable row level security;
create policy "skills_owner" on public.skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_owner" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "runs_owner" on public.runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tests_owner" on public.tests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
