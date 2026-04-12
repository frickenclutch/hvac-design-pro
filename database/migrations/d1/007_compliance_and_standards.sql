-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 007: Code compliance, AHRI data, weather stations
-- ============================================================

-- AHRI EQUIPMENT DIRECTORY (cached AHRI certified data)
CREATE TABLE IF NOT EXISTS ahri_directory (
    id              TEXT PRIMARY KEY,
    ahri_ref_num    TEXT UNIQUE NOT NULL,           -- AHRI certificate reference
    manufacturer    TEXT NOT NULL,
    brand           TEXT,
    model_outdoor   TEXT NOT NULL,
    model_indoor    TEXT,
    model_coil      TEXT,
    system_type     TEXT NOT NULL,                  -- split_ac | heat_pump | packaged | mini_split
    nominal_tons    REAL,
    cooling_95_btuh INTEGER,                       -- cooling at 95F outdoor
    cooling_82_btuh INTEGER,                       -- cooling at 82F outdoor (part load)
    sensible_95_btuh INTEGER,
    heating_47_btuh INTEGER,                       -- heating at 47F outdoor
    heating_17_btuh INTEGER,                       -- heating at 17F outdoor
    seer2           REAL,
    eer_95          REAL,
    hspf2           REAL,
    cop_47          REAL,
    cop_17          REAL,
    refrigerant     TEXT,
    cfm_rated       INTEGER,
    sound_outdoor   REAL,                          -- dBA
    sound_indoor    REAL,                          -- dBA
    energy_star     INTEGER DEFAULT 0,             -- 1=yes
    cert_date       TEXT,                          -- certification date
    raw_data        TEXT,                          -- JSON: full AHRI record
    imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ahri_manufacturer ON ahri_directory(manufacturer);
CREATE INDEX idx_ahri_type ON ahri_directory(system_type);
CREATE INDEX idx_ahri_tonnage ON ahri_directory(nominal_tons);
CREATE INDEX idx_ahri_seer ON ahri_directory(seer2);
CREATE INDEX idx_ahri_brand ON ahri_directory(brand);

-- WEATHER STATIONS (ASHRAE design conditions by location)
-- This supplements the 106KB in-memory ashraeWeather.ts for persistence + larger dataset
CREATE TABLE IF NOT EXISTS weather_stations (
    id              TEXT PRIMARY KEY,
    station_id      TEXT UNIQUE NOT NULL,           -- WMO station number
    name            TEXT NOT NULL,
    state           TEXT,
    country         TEXT NOT NULL DEFAULT 'US',
    latitude        REAL NOT NULL,
    longitude       REAL NOT NULL,
    elevation_ft    REAL,
    climate_zone    TEXT,                           -- ASHRAE climate zone
    cooling_db_1    REAL,                          -- 1% cooling design dry-bulb
    cooling_wb_1    REAL,                          -- 1% cooling coincident wet-bulb
    cooling_db_04   REAL,                          -- 0.4% cooling design dry-bulb
    heating_db_994  REAL,                          -- 99.4% heating design dry-bulb
    heating_db_99   REAL,                          -- 99% heating design dry-bulb
    daily_range     TEXT,                          -- L | M | H
    hdd_65          INTEGER,                       -- heating degree days base 65F
    cdd_50          INTEGER,                       -- cooling degree days base 50F
    ground_temp_jan REAL,                          -- deep ground temp for below-grade
    ground_temp_jul REAL,
    raw_data        TEXT,                          -- JSON: full ASHRAE record
    imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_weather_state ON weather_stations(state);
CREATE INDEX idx_weather_zone ON weather_stations(climate_zone);
CREATE INDEX idx_weather_coords ON weather_stations(latitude, longitude);

-- COMPLIANCE CHECKS (code compliance results per project)
CREATE TABLE IF NOT EXISTS compliance_checks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    code_standard   TEXT NOT NULL                   -- IRC_2021 | IECC_2021 | ASHRAE_90_1 | Title24
                    CHECK (code_standard IN ('IRC_2021', 'IECC_2021', 'ASHRAE_90_1', 'Title24', 'NECB', 'EN_15603')),
    check_type      TEXT NOT NULL,                  -- envelope | mechanical | ventilation | duct
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'pass', 'fail', 'warning', 'not_applicable')),
    details         TEXT,                           -- JSON: {rule, requirement, actual_value, pass_criteria, message}
    calculation_id  TEXT REFERENCES calculations(id),  -- linked calculation
    checked_by      TEXT REFERENCES users(id),
    checked_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_compliance_project ON compliance_checks(project_id);
CREATE INDEX idx_compliance_standard ON compliance_checks(code_standard);
CREATE INDEX idx_compliance_status ON compliance_checks(status);
CREATE INDEX idx_compliance_org ON compliance_checks(org_id);

-- ZONING DEFINITIONS (multi-zone systems)
CREATE TABLE IF NOT EXISTS zones (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    duct_system_id  TEXT REFERENCES duct_systems(id),
    name            TEXT NOT NULL,                  -- e.g., 'Zone 1 - Upstairs'
    thermostat_id   TEXT,                           -- links to equipment/thermostat
    design_cooling_cfm REAL,
    design_heating_cfm REAL,
    damper_type     TEXT DEFAULT 'manual'
                    CHECK (damper_type IN ('manual', 'motorized', 'none')),
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_zones_project ON zones(project_id);
CREATE INDEX idx_zones_duct ON zones(duct_system_id);

-- Link table: rooms to zones (many-to-many)
CREATE TABLE IF NOT EXISTS room_zones (
    room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    zone_id         TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, zone_id)
);
