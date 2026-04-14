-- Migration 0002: Feedback system tables
-- Supports Mason feedback submissions with D1 persistence,
-- R2 attachment storage, and future ModernERP/ticketing integration.

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('bug','suggestion','question')),
  text TEXT NOT NULL,
  context TEXT,
  user_agent TEXT,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
  external_ticket_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_org ON feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback ON feedback_attachments(feedback_id);
