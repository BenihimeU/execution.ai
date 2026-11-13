alter table provider_connections add column if not exists status varchar(40) not null default 'connected';
alter table provider_connections add column if not exists last_error jsonb;
