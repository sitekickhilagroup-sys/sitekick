-- supabase/migrations/0019_substage_order_invoice_cancel.sql
-- Noa round 3 (2026-08-28 report) + Rotem QA round 2.
--
-- 1) Manual sub-stage ordering (Noa request #2 / bug #4): the list was ordered
--    by the template library's position, which drifts as templates get
--    appended — "2. Case accepted ואחריו 3. Completeness review" read as
--    activation order. `position` is a per-project override on the shared
--    template scale ×10 (see lib/process.ts substageSortKey); null = library
--    order.
-- 2) Dependencies line (Noa bug #5): free-text "after X · parallel to Y",
--    until a structured dependency model earns its keep. Shown under the
--    sub-stage name; today Noa writes this inside the note.
alter table project_substages add column if not exists position   int;
alter table project_substages add column if not exists depends_on text;

-- 3) Rotem: no way to void an invoice recorded by mistake (her two PREMISE
--    test rows). Off-chain terminal status like on_hold — excluded from the
--    open-invoices header/totals (page filters on
--    received/for_rowan_approval/approved), never deleted, so the audit
--    trail survives.
alter type invoice_status add value if not exists 'cancelled';
