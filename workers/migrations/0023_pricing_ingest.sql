-- 0023_pricing_ingest.sql — inbound supplier price feed (DDI Inform → pricing_items).
--
-- WHY
-- Phase 1 of the pricing engine (0020) made CSV upload the only LIVE channel;
-- webhook/api sources merely registered. Real distributor pricing (DDI Inform)
-- arrives as a machine push — a scheduled job or middleware POSTing a JSON
-- price book — not as a human uploading a file. That push needs (a) a
-- credential the supplier's system presents, (b) somewhere to record when the
-- last feed landed and what it did, so admins can see the feed is alive.
--
-- WHAT
-- pricing_sources.ingest_token_hash — SHA-256 of the per-source bearer token a
--   supplier presents on POST /api/pricing/ingest/:sourceId. Stored HASHED,
--   never plaintext (same model as sessions.token): a D1 read yields no usable
--   credential. Issued/rotated by an org admin; the plaintext is shown once.
--   NULL = no token issued yet → the source cannot receive a feed.
-- pricing_sources.last_ingest_at — datetime of the last successful (non-dry-run)
--   feed; NULL until the first one lands.
-- pricing_sources.last_ingest_summary — JSON {loaded, skipped, at} of that feed,
--   surfaced in Settings → Pricing Engine.
--
-- The org owning a feed is DERIVED server-side from the pricing_sources row the
-- token matches — the request never names a tenant. Every subsequent query is
-- scoped by that org_id (tenant-scoping guard STRICT_TABLES already covers
-- pricing_sources + pricing_items).
--
-- WHY ALTER-ONLY: forward-authored columns on an existing table, same class as
-- 0019's avatar_key. A fresh rebuild runs 0020 CREATE (without them) then this
-- ALTER; production runs this ALTER. Both paths end identical.

ALTER TABLE pricing_sources ADD COLUMN ingest_token_hash TEXT;
ALTER TABLE pricing_sources ADD COLUMN last_ingest_at TEXT;
ALTER TABLE pricing_sources ADD COLUMN last_ingest_summary TEXT;

-- The public ingest endpoint looks a source up by its globally-unique id and
-- then compares the token hash; this index keeps a (future) hash-first lookup
-- O(log n) and makes the column's role explicit.
CREATE INDEX IF NOT EXISTS idx_pricing_sources_ingest_token ON pricing_sources(ingest_token_hash);
