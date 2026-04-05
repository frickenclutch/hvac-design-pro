-- EXTENDED IDENTITY V2
-- Supports Full Multi-field Addresses, Phone Numbers, and Regional Coded Areas

ALTER TABLE organisations 
ADD COLUMN address_line1 TEXT,
ADD COLUMN address_line2 TEXT,
ADD COLUMN city TEXT,
ADD COLUMN state TEXT,
ADD COLUMN zip TEXT,
ADD COLUMN country TEXT DEFAULT 'US',
ADD COLUMN phone TEXT,
ADD COLUMN region_code TEXT NOT NULL DEFAULT 'NA_ASHRAE'; -- NA_ASHRAE | EU_EN | UK_CIBSE

ALTER TABLE users 
ADD COLUMN phone TEXT,
ADD COLUMN address_line1 TEXT,
ADD COLUMN address_line2 TEXT,
ADD COLUMN city TEXT,
ADD COLUMN state TEXT,
ADD COLUMN zip TEXT,
ADD COLUMN country TEXT DEFAULT 'US',
ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Add check constraint for valid region codes
ALTER TABLE organisations 
ADD CONSTRAINT check_region_code 
CHECK (region_code IN ('NA_ASHRAE', 'EU_EN', 'UK_CIBSE'));

COMMENT ON COLUMN organisations.region_code IS 'North America (ASHRAE) | Europe (EN) | UK (CIBSE)';
