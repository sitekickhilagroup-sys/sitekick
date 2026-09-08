-- 0025: Notes assistant — let a note link to any of the app's working objects,
-- not just task/project. Rather than re-widen a hard CHECK every time, drop the
-- entity_type check and validate the type in the app layer (app/actions/
-- comments.ts), which already checks the linked row exists. entity_type stays
-- 'task' | 'project' | 'invoice' | 'blocker' | 'general' by app validation.

alter table comments drop constraint if exists comments_entity_type_check;
