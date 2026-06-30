create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  user_name text not null check (user_name in ('Jaiden', 'Hansol', 'Jieun')),
  day_of_week integer not null check (day_of_week between 1 and 7),
  slot_time timestamptz not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_name, slot_time)
);

create index if not exists availability_slot_time_idx
  on public.availability (slot_time);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists availability_set_updated_at on public.availability;
create trigger availability_set_updated_at
before update on public.availability
for each row execute function public.set_updated_at();

alter table public.availability enable row level security;

drop policy if exists "Availability is readable by anyone" on public.availability;
create policy "Availability is readable by anyone"
on public.availability for select
to anon
using (true);

drop policy if exists "Availability is insertable by anyone" on public.availability;
create policy "Availability is insertable by anyone"
on public.availability for insert
to anon
with check (true);

drop policy if exists "Availability is updateable by anyone" on public.availability;
create policy "Availability is updateable by anyone"
on public.availability for update
to anon
using (true)
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.availability;
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Meeting',
  note text,
  starts_at timestamptz not null,
  duration_minutes integer not null default 60,
  attendees text[] not null default array['Jaiden', 'Hansol', 'Jieun']::text[],
  created_by text not null check (created_by in ('Jaiden', 'Hansol', 'Jieun')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_events
  add column if not exists duration_minutes integer not null default 60;

alter table public.schedule_events
  add column if not exists attendees text[] not null default array['Jaiden', 'Hansol', 'Jieun']::text[];

create index if not exists schedule_events_starts_at_idx
  on public.schedule_events (starts_at);

drop trigger if exists schedule_events_set_updated_at on public.schedule_events;
create trigger schedule_events_set_updated_at
before update on public.schedule_events
for each row execute function public.set_updated_at();

alter table public.schedule_events enable row level security;

drop policy if exists "Schedule events are readable by anyone" on public.schedule_events;
create policy "Schedule events are readable by anyone"
on public.schedule_events for select
to anon
using (true);

drop policy if exists "Schedule events are insertable by anyone" on public.schedule_events;
create policy "Schedule events are insertable by anyone"
on public.schedule_events for insert
to anon
with check (true);

drop policy if exists "Schedule events are updateable by anyone" on public.schedule_events;
create policy "Schedule events are updateable by anyone"
on public.schedule_events for update
to anon
using (true)
with check (true);

drop policy if exists "Schedule events are deleteable by anyone" on public.schedule_events;
create policy "Schedule events are deleteable by anyone"
on public.schedule_events for delete
to anon
using (true);

do $$
begin
  alter publication supabase_realtime add table public.schedule_events;
exception
  when duplicate_object then null;
end;
$$;
