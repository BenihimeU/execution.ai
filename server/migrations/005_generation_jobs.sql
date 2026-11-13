create table if not exists application_blueprints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  status varchar(40) not null default 'approved',
  specification jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  provider_connection_id uuid not null references provider_connections(id),
  blueprint_id uuid references application_blueprints(id),
  idempotency_key text not null unique,
  status varchar(50) not null default 'queued',
  current_step varchar(100) not null default 'queued',
  result jsonb not null default '{}'::jsonb,
  error jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by varchar(160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_queue_idx on generation_jobs (status, available_at, created_at);
create index if not exists generation_jobs_project_idx on generation_jobs (project_id, created_at desc);
