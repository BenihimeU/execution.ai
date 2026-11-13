create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid not null references users(id),
  sequence integer not null,
  title varchar(180) not null,
  discussion text not null,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  repositories jsonb not null default '[]'::jsonb,
  status varchar(40) not null default 'draft',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence)
);

create index if not exists change_requests_project_idx on change_requests (project_id, created_at desc);
create index if not exists change_requests_organization_idx on change_requests (organization_id, status);
