-- Content identity for uploads: the name+size external_id misses the same
-- file re-uploaded under another name (or re-saved byte-identical text).
-- ingestDocument now also dedups on a sha256 of the extracted content.
alter table documents add column if not exists content_hash text;
create index if not exists documents_content_hash_idx on documents(content_hash);
