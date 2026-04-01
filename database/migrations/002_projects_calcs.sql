-- PROJECTS
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT NOT NULL DEFAULT 'US',
    climate_zone TEXT, -- ASHRAE climate zone e.g. '5A'
    standard TEXT NOT NULL DEFAULT 'ACCA', -- ACCA | ASHRAE | EN12831 | CSA_F280
    status TEXT NOT NULL DEFAULT 'active',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_org_isolation ON projects 
USING (org_id = current_setting('app.current_org_id')::UUID);

-- CALCULATIONS (immutable once computed — append-only audit log)
CREATE TABLE calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organisations(id),
    calc_type TEXT NOT NULL, -- MANUAL_J | MANUAL_D | MANUAL_S | AED
    version INT NOT NULL DEFAULT 1,
    inputs JSONB NOT NULL, -- full snapshot of all user inputs
    outputs JSONB, -- populated when status = 'complete'
    status TEXT NOT NULL DEFAULT 'pending',
    engine_version TEXT NOT NULL, -- e.g. '2.1.4' — ties result to engine release
    computed_by UUID REFERENCES users(id),
    computed_at TIMESTAMPTZ,
    duration_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for fast project-level latest-calc lookups
CREATE INDEX calc_project_latest ON calculations(project_id, calc_type, version DESC) WHERE status = 'complete';
