alter table invoices add column if not exists needs_verification boolean not null default false;
