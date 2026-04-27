-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 010: Tenancy + billing forward-compatibility
-- ============================================================
-- Purpose: add columns the persistence + platform-admin + billing
-- flows will need post-ACCA-certification, WITHOUT activating any
-- billing logic today. All existing rows get safe defaults.
--
-- This migration is additive only — no existing queries break.
-- ============================================================

-- ── PROJECTS: preserve frontend's "Residential" / "Commercial" tag ─────────
-- Frontend has been tracking type in localStorage only. Adding a column
-- so D1-backed projects retain it through sync.
ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'Residential';
-- Allowed values checked in app layer (free-form to support future types
-- like 'Municipal', 'Industrial', 'Mixed-Use' without schema churn).

-- ── ORGANISATIONS: billing status (free during beta, flipped post-cert) ───
-- Every existing org starts in free_beta. Post-ACCA-cert, new paid signups
-- land as 'trialing' or 'active'. Platform admin can grant free_beta at any
-- time for partner orgs (dogfooding, research, etc.).
ALTER TABLE organisations ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'free_beta';
-- Allowed: free_beta | trialing | active | past_due | canceled
-- Enforced in app layer (D1 ALTER cannot add CHECK on existing tables).

-- Existing stripe_cust_id column (migration 001) already handles Stripe linking
-- when we activate billing. seats_limit (migration 001) already throttles.

-- ── USERS: platform-admin flag (creator layer, above org-admin) ───────────
-- Orthogonal to `role` — a platform admin is ALSO admin of their own tenant
-- org for normal dogfooding. This flag only grants cross-org capabilities:
-- impersonation, cross-org metrics, plan/seat overrides, audit feed.
ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0;
-- 0 = regular user, 1 = platform admin (creator layer)

-- ── INDEXES ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orgs_billing_status ON organisations(billing_status);
CREATE INDEX IF NOT EXISTS idx_users_platform_admin ON users(is_platform_admin) WHERE is_platform_admin = 1;
