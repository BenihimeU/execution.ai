alter table project_environments add column if not exists deployment_provider varchar(30) not null default 'github';
