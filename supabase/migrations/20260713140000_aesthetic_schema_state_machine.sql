-- Phase 1: additive-only AI output tracking and resumable session state machine.
-- Existing status/JSON fields remain intact for backward compatibility.

alter table public.aesthetic_training_sessions
  add column if not exists session_state text not null default 'created',
  add column if not exists state_version integer not null default 1,
  add column if not exists last_saved_at timestamptz not null default now(),
  add column if not exists paused_at timestamptz,
  add column if not exists resume_payload jsonb not null default '{}'::jsonb;

alter table public.aesthetic_training_sessions
  drop constraint if exists aesthetic_training_sessions_session_state_check;
alter table public.aesthetic_training_sessions
  add constraint aesthetic_training_sessions_session_state_check check (session_state in (
    'created', 'image_uploaded', 'observation_started', 'observation_completed',
    'person_analysis_started', 'person_analysis_completed', 'style_analysis_started',
    'style_analysis_completed', 'structure_analysis_started', 'structure_analysis_completed',
    'design_started', 'design_completed', 'communication_started',
    'communication_completed', 'evaluation_started', 'evaluation_completed',
    'paused', 'finished', 'failed'
  ));

create table if not exists public.aesthetic_model_outputs (
  id uuid primary key default gen_random_uuid(),
  session_id text references public.aesthetic_training_sessions(id) on delete set null,
  operation text not null,
  schema_version text not null,
  prompt_version text not null default '',
  model_version text not null default '',
  validation_status text not null check (validation_status in ('valid', 'repaired', 'failed')),
  validation_errors jsonb not null default '[]'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aesthetic_ability_history (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  session_id text references public.aesthetic_training_sessions(id) on delete set null,
  dimension text not null,
  level numeric(6,2) not null default 0,
  trend numeric(6,2) not null default 0,
  evidence text not null default '',
  source text not null default 'coach_turn',
  created_at timestamptz not null default now()
);

create index if not exists aesthetic_sessions_state_saved_idx
  on public.aesthetic_training_sessions(session_state, last_saved_at desc);
create index if not exists aesthetic_model_outputs_session_idx
  on public.aesthetic_model_outputs(session_id, created_at desc);
create index if not exists aesthetic_ability_history_user_idx
  on public.aesthetic_ability_history(username, created_at desc);

alter table public.aesthetic_model_outputs enable row level security;
alter table public.aesthetic_ability_history enable row level security;
revoke all on public.aesthetic_model_outputs from anon, authenticated;
revoke all on public.aesthetic_ability_history from anon, authenticated;
grant all on public.aesthetic_model_outputs to service_role;
grant all on public.aesthetic_ability_history to service_role;
