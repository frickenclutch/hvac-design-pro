-- DUCT SYSTEMS (one per project, Manual D)
CREATE TABLE duct_systems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organisations(id),
    air_handler_model TEXT,
    blower_esp_inwg NUMERIC(5,3), -- external static pressure
    filter_drop_inwg NUMERIC(5,3),
    coil_drop_inwg NUMERIC(5,3),
    available_sp_inwg NUMERIC(5,3) GENERATED ALWAYS AS (blower_esp_inwg - filter_drop_inwg - coil_drop_inwg) STORED,
    duct_material TEXT DEFAULT 'flex_r8',
    supply_tel_ft NUMERIC(8,2), -- total effective length, supply
    return_tel_ft NUMERIC(8,2),
    friction_rate NUMERIC(6,4) GENERATED ALWAYS AS (
        CASE WHEN (supply_tel_ft + return_tel_ft) > 0 
        THEN (blower_esp_inwg - filter_drop_inwg - coil_drop_inwg) / ((coalesce(supply_tel_ft, 0) + coalesce(return_tel_ft,0)) / 100.0) 
        ELSE 0 END
    ) STORED
);

ALTER TABLE duct_systems ENABLE ROW LEVEL SECURITY;
CREATE POLICY ds_org_isolation ON duct_systems USING (org_id = current_setting('app.current_org_id')::UUID);

-- DUCT RUNS (one per supply register)
CREATE TABLE duct_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duct_system_id UUID NOT NULL REFERENCES duct_systems(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id),
    label TEXT NOT NULL,
    required_cfm NUMERIC(8,1),
    duct_diameter_in NUMERIC(5,2),
    velocity_fpm NUMERIC(8,1),
    is_critical_path BOOLEAN DEFAULT FALSE,
    fittings JSONB DEFAULT '[]' -- array of {type, qty, eq_ft_each}
);

-- Need to grab org_id from parent duct_system to enforce RLS easily, 
-- or we add org_id directly to duct_runs to keep querying simple and fast.
-- The tech spec omits org_id from duct_runs, so we will add it for strict RLS.
ALTER TABLE duct_runs ADD COLUMN org_id UUID REFERENCES organisations(id);
ALTER TABLE duct_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dr_org_isolation ON duct_runs USING (org_id = current_setting('app.current_org_id')::UUID);
