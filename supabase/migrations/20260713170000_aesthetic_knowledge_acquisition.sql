-- Controlled aesthetic-knowledge acquisition workflow.
-- Candidates never become runtime standards automatically.

create table if not exists public.aesthetic_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  layer text not null check (layer in ('standard','internal','trend')),
  title text not null,
  publisher text not null default '',
  source_url text not null default '',
  source_type text not null default '',
  rights_status text not null default 'unverified' check (rights_status in ('unverified','public_reference','licensed','internal_original','restricted')),
  allowed_use text not null default '',
  owner text not null default '',
  review_due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aesthetic_knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.aesthetic_knowledge_sources(id) on delete set null,
  layer text not null check (layer in ('standard','internal','trend')),
  title text not null,
  source_url text not null default '',
  summary text not null,
  observation_facts jsonb not null default '[]'::jsonb,
  proposed_judgment text not null default '',
  reasoning text not null default '',
  applicable_conditions jsonb not null default '[]'::jsonb,
  unsuitable_conditions jsonb not null default '[]'::jsonb,
  positive_examples jsonb not null default '[]'::jsonb,
  counter_examples jsonb not null default '[]'::jsonb,
  related_styles jsonb not null default '[]'::jsonb,
  copyright_status text not null default 'unverified' check (copyright_status in ('unverified','public_reference','licensed','internal_original','restricted')),
  confidence integer not null default 0 check (confidence between 0 and 100),
  status text not null default 'pending_review' check (status in ('pending_review','needs_revision','approved_for_trial','rejected','published','archived')),
  submitted_by text not null,
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  review_reason text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aesthetic_knowledge_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.aesthetic_knowledge_candidates(id) on delete cascade,
  reviewer text not null,
  decision text not null check (decision in ('needs_revision','approved_for_trial','rejected')),
  professional_accuracy integer not null check (professional_accuracy between 0 and 100),
  evidence_quality integer not null check (evidence_quality between 0 and 100),
  copyright_clear boolean not null default false,
  safety_clear boolean not null default false,
  reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aesthetic_case_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.aesthetic_knowledge_candidates(id) on delete cascade,
  case_id text not null default '',
  evidence_role text not null check (evidence_role in ('positive','counter','boundary','failure')),
  observation text not null,
  outcome text not null default '',
  image_consent_status text not null default 'no_image' check (image_consent_status in ('no_image','internal_training','model_training','restricted')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists aesthetic_knowledge_candidates_status_idx on public.aesthetic_knowledge_candidates(status, created_at desc);
create index if not exists aesthetic_knowledge_reviews_candidate_idx on public.aesthetic_knowledge_reviews(candidate_id, created_at desc);
create index if not exists aesthetic_case_evidence_candidate_idx on public.aesthetic_case_evidence(candidate_id, evidence_role);

alter table public.aesthetic_knowledge_sources enable row level security;
alter table public.aesthetic_knowledge_candidates enable row level security;
alter table public.aesthetic_knowledge_reviews enable row level security;
alter table public.aesthetic_case_evidence enable row level security;

revoke all on public.aesthetic_knowledge_sources from anon, authenticated;
revoke all on public.aesthetic_knowledge_candidates from anon, authenticated;
revoke all on public.aesthetic_knowledge_reviews from anon, authenticated;
revoke all on public.aesthetic_case_evidence from anon, authenticated;

grant all on public.aesthetic_knowledge_sources to service_role;
grant all on public.aesthetic_knowledge_candidates to service_role;
grant all on public.aesthetic_knowledge_reviews to service_role;
grant all on public.aesthetic_case_evidence to service_role;
