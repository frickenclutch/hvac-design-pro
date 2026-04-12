-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 009: Add user preferences and org default standard
-- ============================================================

-- User preferences (JSON object for theme, units, notification prefs, etc.)
ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT '{}';

-- Organisation default calculation standard
ALTER TABLE organisations ADD COLUMN default_standard TEXT DEFAULT 'ACCA';
