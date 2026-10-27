-- Row-level security: user A can't read, write or overwrite user B's rows, and
-- anon and signed-in users can't touch the coach rate limit.
-- Everything runs in one transaction and is rolled back, so it's safe on the
-- live project:  node supabase/tests/run-linked.mjs  (or `supabase test db` with Docker)
begin;
create extension if not exists pgtap with schema extensions;
-- Collect TAP output so the last select returns all of it: `db query` only
-- returns the last result set. pg_prove reads it just the same.
create temp table tap (at timestamptz default clock_timestamp(), line text) on commit drop;
grant insert, select on tap to anon, authenticated;
insert into tap (line) select plan(17);

-- Two users, each with one set (inserted as the owner, bypassing RLS) ------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rls-a@test.invalid', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'rls-b@test.invalid', 'authenticated', 'authenticated');

insert into public.sets (id, user_id, schema_version, exercise, started_at, reps, clean_reps,
                         partial_reps, body, config, rep_results, app_version)
select id, user_id, 1, 'squat', now(), 10, 8, 0, '{}', '{}', '[]', 'rls-test' from (values
  ('aaaaaaaa-1111-4000-8000-000000000001'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  ('bbbbbbbb-1111-4000-8000-000000000002'::uuid, 'bbbbbbbb-0000-4000-8000-000000000002'::uuid)
) v(id, user_id);

-- Anonymous ----------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

insert into tap (line) select is((select count(*) from public.sets), 0::bigint, 'anon sees no sets');
insert into tap (line) select throws_ok(
  $$insert into public.sets (id, user_id, schema_version, exercise, started_at, reps, clean_reps,
      partial_reps, body, config, rep_results, app_version)
    values (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002', 1, 'squat', now(), 1, 1, 0,
      '{}', '{}', '[]', 'rls-test')$$,
  '42501', null, 'anon cannot insert sets');

-- User A -------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into tap (line) select is((select count(*) from public.sets), 1::bigint, 'A sees exactly one set');
insert into tap (line) select is((select array_agg(distinct user_id) from public.sets),
  array['aaaaaaaa-0000-4000-8000-000000000001'::uuid], '...and only their own');
insert into tap (line) select is((select count(*) from public.sets where id = 'bbbbbbbb-1111-4000-8000-000000000002'),
  0::bigint, 'A cannot read B''s set by id');

insert into tap (line) select throws_ok(
  $$insert into public.sets (id, user_id, schema_version, exercise, started_at, reps, clean_reps,
      partial_reps, body, config, rep_results, app_version)
    values (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002', 1, 'squat', now(), 1, 1, 0,
      '{}', '{}', '[]', 'rls-test')$$,
  '42501', null, 'A cannot insert a set owned by B');

insert into tap (line) select lives_ok(
  $$insert into public.sets (id, schema_version, exercise, started_at, reps, clean_reps,
      partial_reps, body, config, rep_results, app_version)
    values ('aaaaaaaa-2222-4000-8000-000000000001', 1, 'pushup', now(), 5, 5, 0,
      '{}', '{}', '[]', 'rls-test')$$,
  'A can insert a set with user_id left to the default');
insert into tap (line) select is((select user_id from public.sets where id = 'aaaaaaaa-2222-4000-8000-000000000001'),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid, '...which defaults to A');

-- The app syncs with upsert, so this is the overwrite path that matters most.
insert into tap (line) select throws_ok(
  $$insert into public.sets (id, user_id, schema_version, exercise, started_at, reps, clean_reps,
      partial_reps, body, config, rep_results, app_version)
    values ('bbbbbbbb-1111-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 1,
      'squat', now(), 99, 0, 0, '{}', '{}', '[]', 'rls-test')
    on conflict (id) do update set reps = excluded.reps, user_id = excluded.user_id$$,
  '42501', null, 'A cannot overwrite B''s set by upserting its id');

-- RLS filters these silently (0 rows, no error); B's checks below show they had no effect.
update public.sets set reps = 99, deleted_at = now() where id = 'bbbbbbbb-1111-4000-8000-000000000002';
delete from public.sets where id = 'bbbbbbbb-1111-4000-8000-000000000002';
delete from public.sets where id = 'aaaaaaaa-1111-4000-8000-000000000001';

insert into tap (line) select is(
  (select count(*) from public.sets where id = 'aaaaaaaa-1111-4000-8000-000000000001'),
  1::bigint, 'A cannot hard-delete their own set either (deletes are soft)');

insert into tap (line) select throws_ok(
  $$update public.sets set user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    where id = 'aaaaaaaa-1111-4000-8000-000000000001'$$,
  '42501', null, 'A cannot hand their set to B');

-- Coach rate limit: service role only.
insert into tap (line) select is((select count(*) from public.coach_requests), 0::bigint, 'A sees no coach requests');
insert into tap (line) select throws_ok(
  $$insert into public.coach_requests (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501', null, 'A cannot write coach requests');
insert into tap (line) select throws_ok(
  $$select public.claim_coach_request('aaaaaaaa-0000-4000-8000-000000000001', 1000, 1000)$$,
  '42501', null, 'A cannot claim coach requests directly');

-- User B: their set is untouched -------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);

insert into tap (line) select is((select count(*) from public.sets), 1::bigint, 'B sees exactly one set (A''s delete missed it)');
insert into tap (line) select is((select reps from public.sets where id = 'bbbbbbbb-1111-4000-8000-000000000002'),
  10::smallint, 'B''s set still has its original reps (A''s update and upsert missed it)');
insert into tap (line) select ok((select deleted_at is null and user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
           from public.sets where id = 'bbbbbbbb-1111-4000-8000-000000000002'),
  'B''s set is still B''s and not soft-deleted');

insert into tap (line) select * from finish();
select line from tap order by at;
rollback;
