-- In-app feedback from testers, signed in or not. Written only by the
-- `feedback` Edge Function; read it in the dashboard or the SQL editor.
-- Scores are 1-5; each question's comment is optional.

create table public.feedback (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  user_id             uuid references auth.users on delete cascade,  -- null when not signed in
  source              text not null check (source in ('summary', 'settings')),
  -- "How easy or difficult was it to complete your first workout using the app?"
  ease                smallint check (ease between 1 and 5),
  ease_comment        text check (char_length(ease_comment) <= 1000),
  -- "How useful was the app's feedback for helping you improve your exercise form?"
  form_help           smallint check (form_help between 1 and 5),
  form_help_comment   text check (char_length(form_help_comment) <= 1000),
  -- "How did the achievements affect your motivation to continue exercising?"
  achievements        smallint check (achievements between 1 and 5),
  achievements_unused boolean not null default false,               -- "I didn't use or notice the achievements"
  -- "How likely are you to use the app again?"
  use_again           smallint check (use_again between 1 and 5),
  use_again_comment   text check (char_length(use_again_comment) <= 1000),
  -- "If you could change only one thing about the app, what would it be?"
  one_change          text check (char_length(one_change) <= 2000),
  context             jsonb not null default '{}',                   -- exercise, reps, faults, model, device
  app_version         text not null check (char_length(app_version) <= 40),
  ip_hash             text not null,                                 -- salted, for rate limiting only
  constraint feedback_achievements_either check (not (achievements_unused and achievements is not null)),
  constraint feedback_not_empty check (achievements_unused or num_nonnulls(
    ease, ease_comment, form_help, form_help_comment, achievements,
    use_again, use_again_comment, one_change) > 0),
  constraint feedback_context_size check (pg_column_size(context) < 8000)
);

create index feedback_time on public.feedback (created_at);
create index feedback_ip_time on public.feedback (ip_hash, created_at);

-- RLS on with no policies: only the service role (the Edge Function) touches this table.
alter table public.feedback enable row level security;

-- Atomically checks the limits and records one entry. p_entry holds the answers
-- keyed by column name (validated by the Edge Function; the table's checks back
-- it up). Returns {ok, id} or {ok: false, reason: 'source_limit' | 'global_limit'}.
-- The source is the caller's IP hash, so signing in doesn't raise the limit.
create function public.submit_feedback(
  p_ip_hash text, p_user uuid, p_entry jsonb, p_source_daily int, p_global_daily int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  used int;
  total int;
  new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('feedback:' || p_ip_hash));

  select count(*) into used from public.feedback
    where ip_hash = p_ip_hash and created_at > now() - interval '24 hours';
  if used >= p_source_daily then
    return jsonb_build_object('ok', false, 'reason', 'source_limit');
  end if;

  select count(*) into total from public.feedback
    where created_at > now() - interval '24 hours';
  if total >= p_global_daily then
    return jsonb_build_object('ok', false, 'reason', 'global_limit');
  end if;

  insert into public.feedback (user_id, ip_hash, source, ease, ease_comment, form_help, form_help_comment,
                               achievements, achievements_unused, use_again, use_again_comment,
                               one_change, context, app_version)
  select p_user, p_ip_hash, e.source, e.ease, e.ease_comment, e.form_help, e.form_help_comment,
         e.achievements, coalesce(e.achievements_unused, false), e.use_again, e.use_again_comment,
         e.one_change, coalesce(e.context, '{}'), e.app_version
  from jsonb_populate_record(null::public.feedback, p_entry) e
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

revoke execute on function public.submit_feedback(text, uuid, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.submit_feedback(text, uuid, jsonb, int, int) to service_role;
