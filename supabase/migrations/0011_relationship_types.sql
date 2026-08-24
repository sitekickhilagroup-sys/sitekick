-- The five relationship types the process spec requires and the enum lacked.
--
-- From "Required relationship types": Blocks prevents a named stage from
-- advancing; Required for is a prerequisite supported by evidence or a rule;
-- Affects may change scope or outcome without necessarily blocking; Related is
-- contextually connected only; Independent belongs to the same project but not
-- the same causal chain; Conditional applies only if a defined condition
-- becomes true.
--
-- Only 'blocks' existed. The nearest live values are weaker or broader claims:
-- 'supports' is not 'required_for', and 'unrelated' is broader than
-- 'independent', so both sets have to coexist rather than be renamed.
--
-- 'conditional' is what B Permit and the arborist report need: applicability
-- that is genuinely undecided until a condition resolves, which today can only
-- be expressed as a status rather than as a relationship.
--
-- Enum additions ship in their own migration because Postgres cannot use a new
-- value in the same transaction that adds it — the pattern 0003b and 0004b
-- already established here.

alter type relationship_type add value if not exists 'required_for';
alter type relationship_type add value if not exists 'affects';
alter type relationship_type add value if not exists 'related';
alter type relationship_type add value if not exists 'independent';
alter type relationship_type add value if not exists 'conditional';
