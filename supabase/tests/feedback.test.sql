-- submit_feedback: per-IP and global daily limits, mapping the answers onto
-- columns, the "not empty" and achievements checks, and feedback going with a
-- deleted account. Runs as the owner (like the Edge Function's service role)
-- and is rolled back, so it's safe on the live project:
--   node supabase/tests/run-linked.mjs
begin;
create extension if not exists pgtap with schema extensions;
create temp table tap (at timestamptz default clock_timestamp(), line text) on commit drop;
insert into tap (line) select plan(11);

-- Per-IP limit of 2, global limit out of the way.
insert into tap (line) select is(
  public.submit_feedback('test-ip-a', null, '{"source":"summary","ease":4,"ease_comment":"setup took a while",
    "form_help":5,"achievements_unused":true,"use_again":4,"one_change":"more exercises",
    "context":{"exercise":"squat","reps":10},"app_version":"test"}', 2, 1000000)->>'ok',
  'true', 'first entry from an IP is stored');
insert into tap (line) select ok(
  (select ease = 4 and ease_comment = 'setup took a while' and form_help = 5 and achievements is null
      and achievements_unused and use_again = 4 and one_change = 'more exercises'
      and context->>'exercise' = 'squat' and user_id is null
   from public.feedback where ip_hash = 'test-ip-a'),
  '...with each answer in its column');
insert into tap (line) select is(
  public.submit_feedback('test-ip-a', null, '{"source":"settings","one_change":"second","app_version":"test"}', 2, 1000000)->>'ok',
  'true', 'second entry is within the limit');
insert into tap (line) select is(
  public.submit_feedback('test-ip-a', null, '{"source":"settings","one_change":"third","app_version":"test"}', 2, 1000000)->>'reason',
  'source_limit', 'third entry from the same IP is refused');
insert into tap (line) select is(
  (select count(*) from public.feedback where ip_hash = 'test-ip-a'), 2::bigint, '...and not stored');
insert into tap (line) select is(
  public.submit_feedback('test-ip-b', null, '{"source":"summary","form_help":2,"app_version":"test"}', 2, 1000000)->>'ok',
  'true', 'another IP has its own allowance');
insert into tap (line) select is(
  (select context from public.feedback where ip_hash = 'test-ip-b'), '{}'::jsonb, 'missing context defaults to {}');

-- Global limit: set it to what's already there in the last 24 hours.
insert into tap (line) select is(
  public.submit_feedback('test-ip-c', null, '{"source":"summary","use_again":5,"app_version":"test"}', 1000,
    (select count(*)::int from public.feedback where created_at > now() - interval '24 hours'))->>'reason',
  'global_limit', 'the global limit applies across IPs');

insert into tap (line) select throws_ok(
  $$select public.submit_feedback('test-ip-d', null, '{"source":"summary","app_version":"test"}', 1000, 1000000)$$,
  '23514', null, 'an entry with no answers is rejected');
insert into tap (line) select throws_ok(
  $$select public.submit_feedback('test-ip-d', null,
      '{"source":"summary","achievements":3,"achievements_unused":true,"app_version":"test"}', 1000, 1000000)$$,
  '23514', null, 'an achievements score and "didn''t use" together are rejected');

-- A signed-in tester's feedback goes with their account.
insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-4000-8000-000000000003', 'feedback@test.invalid', 'authenticated', 'authenticated');
select public.submit_feedback('test-ip-e', 'cccccccc-0000-4000-8000-000000000003',
  '{"source":"summary","ease":3,"app_version":"test"}', 1000, 1000000);
delete from auth.users where id = 'cccccccc-0000-4000-8000-000000000003';
insert into tap (line) select is(
  (select count(*) from public.feedback where ip_hash = 'test-ip-e'), 0::bigint, 'deleting an account deletes its feedback');

insert into tap (line) select * from finish();
select line from tap order by at;
rollback;
