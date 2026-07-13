-- Expand knowledge governance into an aesthetic research institute.
-- Existing candidates remain valid and must pass AI triage, applicability review and case validation before publication.

alter table public.aesthetic_knowledge_candidates
  add column if not exists knowledge_domain text not null default 'style' check (knowledge_domain in ('visual','person','style','design','hair','training','scoring')),
  add column if not exists source_kind text not null default 'practice' check (source_kind in ('standard','paper','book','official_school','course','practice','case','trend','ai_hypothesis')),
  add column if not exists source_creator text not null default '',
  add column if not exists source_publisher text not null default '',
  add column if not exists source_year text not null default '',
  add column if not exists source_locator text not null default '',
  add column if not exists evidence_grade text not null default 'E' check (evidence_grade in ('A','B','C','D','E')),
  add column if not exists ai_assessment jsonb not null default '{}'::jsonb,
  add column if not exists applicability jsonb not null default '{}'::jsonb,
  add column if not exists validation_status text not null default 'not_started' check (validation_status in ('not_started','collecting_cases','ready_for_review','validated','failed')),
  add column if not exists published_entry_id text not null default '';

alter table public.aesthetic_knowledge_reviews
  add column if not exists applicability_scores jsonb not null default '{}'::jsonb,
  add column if not exists applicability_clear boolean not null default false,
  add column if not exists ai_assessment_reviewed boolean not null default false,
  add column if not exists case_validation_required boolean not null default true;

alter table public.aesthetic_case_evidence
  add column if not exists reviewer text not null default '',
  add column if not exists result text not null default 'pending' check (result in ('pending','supports','contradicts','inconclusive')),
  add column if not exists design_context jsonb not null default '{}'::jsonb;

create index if not exists aesthetic_knowledge_candidates_domain_idx
  on public.aesthetic_knowledge_candidates(knowledge_domain, status, created_at desc);

comment on column public.aesthetic_knowledge_candidates.ai_assessment is 'AI triage only; never authorizes publication.';
comment on column public.aesthetic_knowledge_candidates.applicability is 'Structured image-design applicability across person, style, design, hair, training and scoring.';
