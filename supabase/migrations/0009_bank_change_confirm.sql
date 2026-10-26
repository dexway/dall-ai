-- Bank detail changes wait here until the owner confirms by email. Server-only: no client policies.
create table if not exists bank_change_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  requested_by uuid not null,
  bank_name text, account_name text, account_number text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','applied','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists bank_change_requests_ws on bank_change_requests(workspace_id, status);
alter table bank_change_requests enable row level security;
