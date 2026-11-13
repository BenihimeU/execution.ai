create table if not exists change_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  change_request_id uuid not null references change_requests(id) on delete cascade,
  provider_connection_id uuid not null references provider_connections(id),
  status varchar(50) not null default 'queued',
  current_step varchar(100) not null default 'queued',
  result jsonb not null default '{}'::jsonb,
  error jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by varchar(160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_request_id)
);
create index if not exists change_jobs_queue_idx on change_jobs (status, available_at, created_at);
