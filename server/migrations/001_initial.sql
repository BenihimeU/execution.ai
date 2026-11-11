create extension if not exists pgcrypto;
create table if not exists organizations (id uuid primary key default gen_random_uuid(), name varchar(120) not null, created_at timestamptz not null default now());
create table if not exists users (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, email varchar(320) not null unique, password_hash text not null, created_at timestamptz not null default now());
create table if not exists clients (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists projects (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, client_id uuid not null references clients(id) on delete cascade, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists clients_organization_id_idx on clients(organization_id);
create index if not exists projects_organization_id_idx on projects(organization_id);
create index if not exists projects_client_id_idx on projects(client_id);

