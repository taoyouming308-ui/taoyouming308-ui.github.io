create extension if not exists pgcrypto;

create table if not exists public.aesthetic_training_sessions (
  id text primary key,
  username text not null,
  store text not null default '',
  business_date date not null,
  case_id text not null default '',
  case_title text not null default '',
  status text not null default 'in_progress' check (status in ('in_progress','completed','expired')),
  current_goal text not null default 'outline',
  turn_count integer not null default 0,
  prompt_version text not null default 'coach-v1',
  strategy_version text not null default 'control-v1',
  model_version text not null default '',
  goal_states jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (username, business_date)
);

create table if not exists public.aesthetic_training_turns (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.aesthetic_training_sessions(id) on delete cascade,
  turn_index integer not null,
  employee_answer text not null default '',
  coach_message text not null default '',
  active_goal text not null default 'outline',
  response_type text not null default '',
  classification jsonb not null default '{}'::jsonb,
  repeated_pattern text not null default '',
  strategy_version text not null default 'control-v1',
  model_version text not null default '',
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

create table if not exists public.aesthetic_training_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique references public.aesthetic_training_sessions(id) on delete cascade,
  evaluator_version text not null,
  evaluator_model text not null,
  problem_tags jsonb not null default '[]'::jsonb,
  strategy_tags jsonb not null default '[]'::jsonb,
  initial_quality integer not null check (initial_quality between 0 and 100),
  final_quality integer not null check (final_quality between 0 and 100),
  improvement_score integer not null check (improvement_score between -100 and 100),
  professional_accuracy integer not null check (professional_accuracy between 0 and 100),
  guidance_quality integer not null check (guidance_quality between 0 and 100),
  evidence_growth integer not null check (evidence_growth between 0 and 100),
  safety_score integer not null check (safety_score between 0 and 100),
  effective boolean not null default false,
  failure_reason text not null default '',
  recommended_strategy text not null default '',
  evaluator_notes text not null default '',
  raw_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aesthetic_coach_strategies (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'candidate' check (status in ('control','candidate','experiment','active','rejected','rolled_back')),
  instructions text not null,
  source_evaluation_count integer not null default 0,
  validation_score numeric(6,2),
  experiment_percent integer not null default 0 check (experiment_percent between 0 and 100),
  minimum_samples integer not null default 100,
  minimum_accuracy integer not null default 90,
  minimum_safety integer not null default 95,
  minimum_improvement integer not null default 5,
  parent_version text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  rolled_back_at timestamptz
);

insert into public.aesthetic_coach_strategies
  (version, status, instructions, experiment_percent, minimum_samples, minimum_accuracy, minimum_safety, minimum_improvement)
values
  ('control-v1', 'control', '保持当前有剧本自由聊天：一次只处理一个关键点，先事实后判断，少给答案多追问。', 0, 100, 90, 95, 5)
on conflict (version) do nothing;

create table if not exists public.aesthetic_strategy_experiments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique references public.aesthetic_training_sessions(id) on delete cascade,
  strategy_version text not null references public.aesthetic_coach_strategies(version),
  cohort text not null check (cohort in ('control','experiment')),
  assigned_at timestamptz not null default now(),
  completed boolean not null default false,
  improvement_score integer,
  professional_accuracy integer,
  safety_score integer
);

create index if not exists aesthetic_sessions_store_date_idx on public.aesthetic_training_sessions(store, business_date desc);
create index if not exists aesthetic_sessions_user_date_idx on public.aesthetic_training_sessions(username, business_date desc);
create index if not exists aesthetic_turns_session_idx on public.aesthetic_training_turns(session_id, turn_index);
create index if not exists aesthetic_evaluations_created_idx on public.aesthetic_training_evaluations(created_at desc);
create index if not exists aesthetic_strategies_status_idx on public.aesthetic_coach_strategies(status, created_at desc);

alter table public.aesthetic_training_sessions enable row level security;
alter table public.aesthetic_training_turns enable row level security;
alter table public.aesthetic_training_evaluations enable row level security;
alter table public.aesthetic_coach_strategies enable row level security;
alter table public.aesthetic_strategy_experiments enable row level security;

revoke all on public.aesthetic_training_sessions from anon, authenticated;
revoke all on public.aesthetic_training_turns from anon, authenticated;
revoke all on public.aesthetic_training_evaluations from anon, authenticated;
revoke all on public.aesthetic_coach_strategies from anon, authenticated;
revoke all on public.aesthetic_strategy_experiments from anon, authenticated;

grant all on public.aesthetic_training_sessions to service_role;
grant all on public.aesthetic_training_turns to service_role;
grant all on public.aesthetic_training_evaluations to service_role;
grant all on public.aesthetic_coach_strategies to service_role;
grant all on public.aesthetic_strategy_experiments to service_role;
