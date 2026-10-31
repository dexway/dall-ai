-- Creative Studio, phase 1: Nigerian cultural intelligence. Research tasks (on demand from a business,
-- or shared ones the platform runs), the evidence they found, and a shared, versioned cultural memory
-- that only goes live after a platform admin approves it. Additive only: no existing table changes.
-- Shared memory rows never carry business data; a business's own findings stay on its own task.

create table if not exists public.ci_sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,                 -- "pulse.ng"
  kind text not null default 'blog' check (kind in ('blog','news','forum','comedy','reference','api','other')),
  allowed boolean not null default true,       -- false = never research from it
  terms_note text,                             -- why it's allowed (terms checked, licence, API)
  added_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ci_research_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade, -- null = shared platform research
  mode text not null default 'on_demand' check (mode in ('foundational','scheduled','trend','on_demand')),
  topic text not null check (length(topic) between 3 and 600),
  region text not null default 'Lagos',
  depth text not null default 'standard' check (depth in ('quick','standard','deep')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  stage text not null default 'queued',
  result jsonb,                                -- summary, opportunities (private to this business), memory used
  searches_used int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists ci_research_tasks_ws on public.ci_research_tasks(workspace_id, created_at desc);

create table if not exists public.ci_knowledge (
  id uuid primary key default gen_random_uuid(),
  key text not null,                           -- normalised title, one key many versions
  version int not null default 1,
  title text not null,
  meaning text not null,
  kind text not null check (kind in ('slang','situation','reference','trend','history','humour','custom')),
  lifespan text not null check (lifespan in ('evergreen','recurring','trending','historical')),
  region text not null default 'Nigeria',
  audience text not null default '',
  why_relatable text not null default '',
  example text not null default '',            -- an original example line, never copied content
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  usage_note text not null default '',         -- restrictions: sensitive, avoid with brands, etc.
  status text not null default 'pending_review' check (status in ('pending_review','trusted','rejected','retired')),
  task_id uuid references public.ci_research_tasks(id) on delete set null,
  reviewed_by uuid, reviewed_at timestamptz, review_note text,
  last_verified_at timestamptz not null default now(),
  refresh_due_at timestamptz,
  superseded_by uuid references public.ci_knowledge(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version)
);
create index if not exists ci_knowledge_status on public.ci_knowledge(status, kind);

create table if not exists public.ci_findings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ci_research_tasks(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  knowledge_id uuid references public.ci_knowledge(id) on delete set null,
  source_url text not null,
  source_title text,
  page_age text,                               -- as the search reported it
  excerpt text not null default '' check (length(excerpt) <= 400), -- short paraphrase, never whole posts
  status text not null default 'verified' check (status in ('verified','rejected')),
  reject_reason text,
  discovered_at timestamptz not null default now()
);
create index if not exists ci_findings_task on public.ci_findings(task_id);

alter table public.ci_sources enable row level security;
alter table public.ci_research_tasks enable row level security;
alter table public.ci_knowledge enable row level security;
alter table public.ci_findings enable row level security;
drop policy if exists ci_tasks_member_read on public.ci_research_tasks;
create policy ci_tasks_member_read on public.ci_research_tasks for select using (workspace_id is not null and public.is_member(workspace_id));
drop policy if exists ci_findings_member_read on public.ci_findings;
create policy ci_findings_member_read on public.ci_findings for select using (workspace_id is not null and public.is_member(workspace_id));
drop policy if exists ci_knowledge_trusted_read on public.ci_knowledge;
create policy ci_knowledge_trusted_read on public.ci_knowledge for select to authenticated using (status = 'trusted');
-- ci_sources: service role only. All writes go through the server.
