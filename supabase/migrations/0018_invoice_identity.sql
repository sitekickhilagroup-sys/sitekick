-- Q7 (Noa, 2026-08-27): the same invoice number can legitimately recur for
-- the same vendor across different entities ("מדובר באותו סכום לכמה חשבוניות…
-- שהחשבוניות יהיו תלויות במספר חשבונית ופרויקט/אנטיטי") — SNO Solutions
-- invoice No.1 exists once per LLC. Identity is (vendor, number, entity).
-- NULL semantics stay Postgres-default (nulls distinct): numberless invoices
-- never collide in the DB — Add Invoice flags them needs_verification instead
-- of blocking, and the importer matches them explicitly (lib/import/tracker.ts).
alter table invoices drop constraint if exists invoices_vendor_id_number_key;
alter table invoices add constraint invoices_vendor_number_entity_key
  unique (vendor_id, number, entity);

-- Q10 (Noa): every column of her Invoices tab lives here too. Service Month
-- ("Sep 25", "Jan 2026") was the one column the importer dropped.
alter table invoices add column if not exists service_month text;
