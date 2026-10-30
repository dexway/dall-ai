-- Motion video plans can be generated on Higgsfield through the same budgeted, idempotent job pipeline
-- as calendar items: a job belongs to either a content item or one scene/edit of a motion plan.

alter table public.generation_jobs alter column item_id drop not null;
alter table public.generation_jobs add column if not exists motion_project_id uuid references public.motion_projects(id) on delete cascade;
alter table public.generation_jobs add column if not exists scene_key text;     -- "scene:0", "edit:1"
alter table public.generation_jobs drop constraint if exists generation_jobs_owner;
alter table public.generation_jobs add constraint generation_jobs_owner check (item_id is not null or motion_project_id is not null);
create index if not exists generation_jobs_motion on public.generation_jobs(motion_project_id) where motion_project_id is not null;

alter table public.creative_assets add column if not exists motion_project_id uuid references public.motion_projects(id) on delete set null;
