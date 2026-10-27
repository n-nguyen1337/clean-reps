-- Progression tracking: synced sets, plus the AI coach's per-user rate limit.
-- See PLAN-progress.md.

-- Sets --------------------------------------------------------------------

create table public.sets (
  id             uuid primary key,                -- generated on the device; makes uploads idempotent
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  schema_version smallint not null,
  exercise       text not null,
  started_at     timestamptz not null,
  duration_s     real,
  reps           smallint not null,
  clean_reps     smallint not null,
  partial_reps   smallint not null,
  avg_down_s     real,
  avg_up_s       real,
  faults         jsonb not null default '{}',
  body           jsonb not null,
  config         jsonb not null,                  -- the exercise config (limits) the set ran with
  rep_results    jsonb not null,
  app_version    text not null,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint sets_size check (pg_column_size(config) + pg_column_size(rep_results) < 200000)
);

create index sets_user_updated on public.sets (user_id, updated_at);
create index sets_user_exercise on public.sets (user_id, exercise, started_at);

-- The server clock drives the sync cursor, so device clock drift can't skip rows.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger sets_touch before insert or update on public.sets
  for each row execute function public.touch_updated_at();

alter table public.sets enable row level security;

create policy "Users read their own sets" on public.sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add their own sets" on public.sets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their own sets" on public.sets
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: deletes are soft (deleted_at) so they sync. Account deletion cascades from auth.users.

-- AI coach rate limit -----------------------------------------------------

create table public.coach_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create index coach_requests_user_time on public.coach_requests (user_id, created_at);
create index coach_requests_time on public.coach_requests (created_at);

-- RLS on with no policies: only the service role (the Edge Function) touches this table.
alter table public.coach_requests enable row level security;

-- Atomically checks the limits and records a request. Returns
-- {ok, request_id, remaining} or {ok: false, reason: 'user_limit' | 'global_limit'}.
create function public.claim_coach_request(p_user uuid, p_user_daily int, p_global_daily int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  used int;
  total int;
  new_id bigint;
begin
  -- Serialize claims per user so two parallel requests can't both take the last slot.
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  select count(*) into used from public.coach_requests
    where user_id = p_user and created_at > now() - interval '24 hours';
  if used >= p_user_daily then
    return jsonb_build_object('ok', false, 'reason', 'user_limit');
  end if;

  select count(*) into total from public.coach_requests
    where created_at > now() - interval '24 hours';
  if total >= p_global_daily then
    return jsonb_build_object('ok', false, 'reason', 'global_limit');
  end if;

  insert into public.coach_requests (user_id) values (p_user) returning id into new_id;
  return jsonb_build_object('ok', true, 'request_id', new_id, 'remaining', p_user_daily - used - 1);
end $$;

revoke execute on function public.claim_coach_request(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_coach_request(uuid, int, int) to service_role;
