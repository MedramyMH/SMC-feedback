-- =====================================================================
--  SMC Maintenance Log — Supabase schema
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  It is safe to run again (uses IF NOT EXISTS / ON CONFLICT where possible).
-- =====================================================================

-- ---------- Interventions ------------------------------------------------
create table if not exists public.interventions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  status              text not null default 'open' check (status in ('open', 'done')),

  machine             text,          -- SMC1 … SMC8
  station             text,          -- Tape station, Clip station, Boards, Refill tape, Clip refill
  component           text,          -- Cassette 1…10, Conveyor 1…4, Asyrile, Scanners, Main cabinet, AI
  type                text,          -- Maintenance, Adjustment, Spare part, Code, Programming
  description         text,
  photos              text[] not null default '{}',   -- storage paths in the "photos" bucket

  time_mode           text not null default 'actual' check (time_mode in ('actual', 'manual')),
  start_time          timestamptz not null default now(),
  end_time            timestamptz,
  duration_min        integer check (duration_min is null or duration_min >= 0),

  repeat_of           uuid references public.interventions(id) on delete set null,
  last_reminder_at    timestamptz,                    -- last "is it finished?" reminder (avoids duplicates)

  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name     text,
  updated_by_name     text,
  closed_by_name      text
);

create index if not exists interventions_start_idx   on public.interventions (start_time desc);
create index if not exists interventions_status_idx  on public.interventions (status);
create index if not exists interventions_machine_idx on public.interventions (machine);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists interventions_touch on public.interventions;
create trigger interventions_touch before update on public.interventions
for each row execute function public.touch_updated_at();

alter table public.interventions enable row level security;

-- Every signed-in team member can see, add and edit interventions.
drop policy if exists "team can read"   on public.interventions;
drop policy if exists "team can insert" on public.interventions;
drop policy if exists "team can update" on public.interventions;
drop policy if exists "owner can delete" on public.interventions;

create policy "team can read"   on public.interventions for select to authenticated using (true);
create policy "team can insert" on public.interventions for insert to authenticated with check (created_by = auth.uid());
create policy "team can update" on public.interventions for update to authenticated using (true) with check (true);
-- Only the person who created an intervention can delete it.
create policy "owner can delete" on public.interventions for delete to authenticated using (created_by = auth.uid());

-- Live updates between phones
do $$
begin
  alter publication supabase_realtime add table public.interventions;
exception when duplicate_object then null;
end $$;

-- ---------- Per-user settings (reminder interval used by the push job) ----
create table if not exists public.user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  reminder_minutes  integer not null default 15 check (reminder_minutes >= 0),  -- 0 = off
  updated_at        timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Web-push subscriptions (one row per phone / browser) ---------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Photo storage (private bucket, team can read) ----------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "team read photos"   on storage.objects;
drop policy if exists "team upload photos" on storage.objects;
drop policy if exists "owner delete photos" on storage.objects;

create policy "team read photos"   on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "team upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "owner delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and owner = auth.uid());
