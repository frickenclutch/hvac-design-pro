-- ROOMS (Manual J room-by-room inputs)
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organisations(id),
    name TEXT NOT NULL,
    floor_area_sqft NUMERIC(10,2),
    ceiling_height NUMERIC(6,2),
    above_grade BOOLEAN DEFAULT TRUE,
    conditioned BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    meta JSONB DEFAULT '{}' -- wall types, insulation levels, etc.
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rooms_org_isolation ON rooms USING (org_id = current_setting('app.current_org_id')::UUID);

-- FENESTRATION (windows, glass doors, skylights per room)
CREATE TABLE fenestration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organisations(id),
    label TEXT,
    orientation INT NOT NULL, -- degrees 0-359 (0=North, 90=East...)
    area_sqft NUMERIC(8,2) NOT NULL,
    u_factor NUMERIC(5,3) NOT NULL,
    shgc NUMERIC(5,3) NOT NULL,
    has_interior_shade BOOLEAN DEFAULT FALSE,
    frame_type TEXT DEFAULT 'aluminum_thermal_break'
);

ALTER TABLE fenestration ENABLE ROW LEVEL SECURITY;
CREATE POLICY fene_org_isolation ON fenestration USING (org_id = current_setting('app.current_org_id')::UUID);

-- EQUIPMENT SELECTIONS
CREATE TABLE equipment_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organisations(id),
    ahri_ref_num TEXT,
    manufacturer TEXT NOT NULL,
    model_outdoor TEXT NOT NULL,
    model_indoor TEXT,
    nominal_tons NUMERIC(4,1),
    cooling_btuh INT, -- at ARI conditions
    sensible_btuh INT,
    heating_btuh INT,
    seer2 NUMERIC(5,1),
    hspf2 NUMERIC(5,1),
    eer NUMERIC(5,1),
    is_selected BOOLEAN DEFAULT FALSE,
    raw_ahri_data JSONB -- full AHRI record snapshot
);

ALTER TABLE equipment_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY equip_org_isolation ON equipment_selections USING (org_id = current_setting('app.current_org_id')::UUID);
