create table if not exists cicd_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  change_job_id uuid not null references change_jobs(id) on delete cascade,
  repository_type varchar(40),
  repository_name varchar(180) not null,
  workflow_run_id bigint not null,
  workflow_name varchar(180),
  commit_sha text,
  branch text not null,
  status varchar(40) not null,
  conclusion varchar(40),
  details_url text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_name, workflow_run_id)
);

create table if not exists project_environments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name varchar(80) not null,
  environment_type varchar(30) not null,
  deployment_strategy varchar(40) not null default 'workflow_dispatch',
  requires_approval boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  change_job_id uuid not null references change_jobs(id) on delete cascade,
  environment_id uuid not null references project_environments(id),
  repository_type varchar(40) not null,
  repository_name varchar(180) not null,
  branch text not null,
  commit_sha text,
  status varchar(40) not null default 'queued',
  workflow_run_id bigint,
  environment_url text,
  error jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cicd_runs_change_job_idx on cicd_runs(change_job_id, updated_at desc);
create index if not exists deployments_change_job_idx on deployments(change_job_id, created_at desc);

insert into project_environments (organization_id, project_id, name, environment_type, requires_approval)
select organization_id, id, 'Development', 'development', false from projects on conflict (project_id, name) do nothing;
insert into project_environments (organization_id, project_id, name, environment_type, requires_approval)
select organization_id, id, 'Test', 'test', true from projects on conflict (project_id, name) do nothing;
insert into project_environments (organization_id, project_id, name, environment_type, requires_approval)
select organization_id, id, 'Production', 'production', true from projects on conflict (project_id, name) do nothing;
